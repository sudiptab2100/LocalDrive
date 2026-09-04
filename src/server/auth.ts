import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes } from 'crypto'
import { getDb } from './db/index.js'
import { loadConfig } from './config.js'
import { sanitizeHomeName } from './util/fs-safe.js'
import type { User, Role, Permission, Acl, UserStatus } from '../shared/types.js'

/** Users, sessions (JWT), and per-folder RBAC. */

const RANK: Record<Permission, number> = { read: 1, write: 2, admin: 3 }

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10)
}
export function verifyPassword(pw: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(pw, hash)
  } catch {
    return false
  }
}

function rowToUser(r: any): User {
  return {
    id: r.id,
    username: r.username,
    role: r.role,
    createdAt: r.created_at,
    home: r.home ?? '',
    status: (r.status ?? 'active') as UserStatus
  }
}

/** Return a home folder name unique across users, appending -2, -3, … if taken. */
export function ensureUniqueHome(base: string, excludeUserId?: number): string {
  const db = getDb()
  const taken = (candidate: string): boolean => {
    const row = excludeUserId
      ? db.prepare('SELECT 1 FROM users WHERE home = ? AND id <> ?').get(candidate, excludeUserId)
      : db.prepare('SELECT 1 FROM users WHERE home = ?').get(candidate)
    return !!row
  }
  if (!taken(base)) return base
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}-${i}`
    if (!taken(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/**
 * Deterministic userspace folder name for a username. This is the portability
 * key: the same username maps to the same folder on any serving PC, so a user's
 * space travels with the drive. No per-PC uniqueness suffix — collisions are
 * rejected at account creation instead (see `isHomeTaken`).
 */
export function homeNameFor(username: string): string {
  return sanitizeHomeName(username)
}

/** Whether a userspace folder name is already claimed by another user. */
export function isHomeTaken(home: string, excludeUserId?: number): boolean {
  if (!home) return false
  const db = getDb()
  const row = excludeUserId
    ? db.prepare('SELECT 1 FROM users WHERE home = ? AND id <> ?').get(home, excludeUserId)
    : db.prepare('SELECT 1 FROM users WHERE home = ?').get(home)
  if (row) return true
  // Admins store home='' (whole-share sentinel) but use their username-derived
  // name as their personal space in "My space" view, so reserve those too.
  const admins = db.prepare("SELECT id, username FROM users WHERE role = 'admin'").all() as {
    id: number
    username: string
  }[]
  return admins.some((a) => a.id !== excludeUserId && sanitizeHomeName(a.username) === home)
}

export function createUser(
  username: string,
  password: string,
  role: Role = 'user',
  status: UserStatus = 'active'
): User {
  const db = getDb()
  const uname = username.trim()
  const home = role === 'admin' ? '' : homeNameFor(uname)
  // Reject a username whose deterministic folder name collides with an existing
  // user — the folder name must stay a stable, unique portability key.
  if (home && isHomeTaken(home)) {
    throw new Error('That username is too similar to an existing account. Please choose another.')
  }
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, home, status) VALUES (?,?,?,?,?)')
    .run(uname, hashPassword(password), role, home, status)
  return getUserById(Number(info.lastInsertRowid))!
}

/** Self-registered account awaiting admin approval (no ACL/home dir until approved). */
export function createPendingUser(username: string, password: string): User {
  return createUser(username, password, 'user', 'pending')
}

export function listPendingUsers(): User[] {
  return (
    getDb().prepare("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at").all() as any[]
  ).map(rowToUser)
}

/** Flip a pending account to active. Provisioning (home dir/ACL) is done by the caller. */
export function approveUser(id: number): User | null {
  getDb().prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id)
  return getUserById(id)
}

export function getUserById(id: number): User | null {
  const r = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)
  return r ? rowToUser(r) : null
}

export function getUserByName(username: string): User | null {
  const r = getDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username.trim())
  return r ? rowToUser(r) : null
}

export function listUsers(): User[] {
  return (getDb().prepare('SELECT * FROM users ORDER BY username').all() as any[]).map(rowToUser)
}

export function deleteUser(id: number): void {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

export function setUserPassword(id: number, password: string): void {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id)
}

export function setUserRole(id: number, role: Role): void {
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
}

export function setUserHome(id: number, home: string): void {
  getDb().prepare('UPDATE users SET home = ? WHERE id = ?').run(home, id)
}

export function authenticate(username: string, password: string): User | null {
  const r = getDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username.trim()) as any
  if (!r) return null
  if (!verifyPassword(password, r.password_hash)) return null
  return rowToUser(r)
}

/** Create a default admin the first time the app runs; returns the temp password. */
export function bootstrapAdmin(): { username: string; password: string } | null {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c
  if (count > 0) return null
  const password = randomBytes(6).toString('base64url')
  createUser('admin', password, 'admin')
  return { username: 'admin', password }
}

// ---- Sessions -------------------------------------------------------------

export function signToken(user: User): string {
  const cfg = loadConfig()
  return jwt.sign({ uid: user.id, role: user.role }, cfg.jwtSecret, { expiresIn: '30d' })
}

export function verifyToken(token: string): User | null {
  try {
    const cfg = loadConfig()
    const payload = jwt.verify(token, cfg.jwtSecret) as { uid: number }
    return getUserById(payload.uid)
  } catch {
    return null
  }
}

// ---- RBAC -----------------------------------------------------------------

export function setAcl(
  userId: number,
  driveUuid: string,
  pathPrefix: string,
  permission: Permission
): void {
  getDb()
    .prepare(
      `INSERT INTO acls (user_id, drive_uuid, path_prefix, permission)
       VALUES (?,?,?,?)
       ON CONFLICT(user_id, drive_uuid, path_prefix)
       DO UPDATE SET permission = excluded.permission`
    )
    .run(userId, driveUuid, pathPrefix.replace(/^\/+|\/+$/g, ''), permission)
}

export function removeAcl(id: number): void {
  getDb().prepare('DELETE FROM acls WHERE id = ?').run(id)
}

export function listAcls(userId?: number): Acl[] {
  const db = getDb()
  const rows = userId
    ? db.prepare('SELECT * FROM acls WHERE user_id = ?').all(userId)
    : db.prepare('SELECT * FROM acls').all()
  return (rows as any[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    driveUuid: r.drive_uuid,
    pathPrefix: r.path_prefix,
    permission: r.permission
  }))
}

/**
 * Effective permission for a user on a drive path. Admins get admin everywhere.
 * Otherwise the most specific matching ACL prefix wins; ties take the highest.
 */
export function effectivePermission(
  user: User,
  driveUuid: string,
  path: string
): Permission | null {
  if (user.role === 'admin') return 'admin'
  const norm = path.replace(/^\/+|\/+$/g, '')
  const acls = getDb()
    .prepare('SELECT path_prefix, permission FROM acls WHERE user_id = ? AND drive_uuid = ?')
    .all(user.id, driveUuid) as { path_prefix: string; permission: Permission }[]

  let best: { specificity: number; perm: Permission } | null = null
  for (const a of acls) {
    const prefix = a.path_prefix
    const matches = prefix === '' || norm === prefix || norm.startsWith(prefix + '/')
    if (!matches) continue
    const specificity = prefix === '' ? 0 : prefix.split('/').length
    if (
      !best ||
      specificity > best.specificity ||
      (specificity === best.specificity && RANK[a.permission] > RANK[best.perm])
    ) {
      best = { specificity, perm: a.permission }
    }
  }
  return best?.perm ?? null
}

export function hasPermission(
  user: User,
  driveUuid: string,
  path: string,
  need: Permission
): boolean {
  const eff = effectivePermission(user, driveUuid, path)
  return eff != null && RANK[eff] >= RANK[need]
}

/**
 * The path prefix a user is confined to on a drive: '' for admins (whole
 * drive), their private home folder for a provisioned user, or null when the
 * user has no access to the drive at all. Used to present each user's home as
 * their root and to keep them out of everyone else's files.
 */
export function getUserHome(user: User, driveUuid: string): string | null {
  if (user.role === 'admin') return ''
  if (!user.home) return null
  const row = getDb()
    .prepare('SELECT 1 FROM acls WHERE user_id = ? AND drive_uuid = ? AND path_prefix = ? LIMIT 1')
    .get(user.id, driveUuid, user.home)
  return row ? user.home : null
}
