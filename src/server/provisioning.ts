import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'
import { getDb } from './db/index.js'
import {
  listUsers,
  getUserById,
  setAcl,
  setUserHome,
  ensureUniqueHome
} from './auth.js'
import { sanitizeHomeName } from './util/fs-safe.js'
import { getShareRoot, getDriveAppDir } from './drives/registry.js'
import type { User } from '../shared/types.js'

/**
 * Per-user home provisioning. Every non-admin user gets a private folder named
 * after them inside each shared drive's LocalDrive/ root, plus an ACL that
 * confines them to it. ACLs are always written (so a user's drive shows up
 * immediately in the web UI), while the physical folder is created best-effort
 * — offline drives are created lazily on first access instead.
 */

function registeredDriveUuids(): string[] {
  return (getDb().prepare('SELECT uuid FROM drives WHERE registered = 1').all() as {
    uuid: string
  }[]).map((r) => r.uuid)
}

/** Create <drive>/LocalDrive/<home> if the drive is online. Best-effort. */
export async function ensureUserHomeDir(uuid: string, home: string): Promise<void> {
  if (!home) return
  try {
    const root = await getShareRoot(uuid)
    const dir = join(root, home)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch {
    /* drive offline — will be created lazily on next access */
  }
}

/**
 * Write a portable, secret-free user manifest to <drive>/.localdrive/users.json
 * so basic account info travels with the drive. Never contains password hashes.
 */
async function writeUsersManifest(uuid: string): Promise<void> {
  try {
    const appDir = await getDriveAppDir(uuid)
    if (!existsSync(appDir)) mkdirSync(appDir, { recursive: true })
    const users = listUsers()
      .filter((u) => u.role !== 'admin')
      .map((u) => ({ username: u.username, home: u.home, role: u.role, createdAt: u.createdAt }))
    const payload = JSON.stringify({ updatedAt: new Date().toISOString(), users }, null, 2)
    const tmp = join(appDir, `.users.${randomBytes(4).toString('hex')}.tmp`)
    writeFileSync(tmp, payload)
    renameSync(tmp, join(appDir, 'users.json'))
  } catch {
    /* drive offline or read-only — skip */
  }
}

/** Provision one user's home + ACL on every registered drive. */
export async function provisionUserHome(user: User): Promise<void> {
  if (user.role === 'admin' || !user.home) return
  const uuids = registeredDriveUuids()
  for (const uuid of uuids) {
    setAcl(user.id, uuid, user.home, 'write')
    await ensureUserHomeDir(uuid, user.home)
  }
  for (const uuid of uuids) await writeUsersManifest(uuid)
}

/** Provision every non-admin user's home on a newly-registered drive. */
export async function provisionDriveForAllUsers(uuid: string): Promise<void> {
  for (const u of listUsers()) {
    if (u.role === 'admin' || !u.home) continue
    setAcl(u.id, uuid, u.home, 'write')
    await ensureUserHomeDir(uuid, u.home)
  }
  await writeUsersManifest(uuid)
}

/**
 * Startup reconcile: assign a home to any legacy user missing one, provision
 * every non-admin user on every registered drive, and remove any leftover
 * whole-drive grants so existing users are confined to their home.
 */
export async function backfillHomesAndProvision(): Promise<void> {
  const db = getDb()

  for (const u of listUsers()) {
    if (u.role === 'admin' || u.home) continue
    setUserHome(u.id, ensureUniqueHome(sanitizeHomeName(u.username), u.id))
  }

  const uuids = registeredDriveUuids()
  for (const u0 of listUsers()) {
    if (u0.role === 'admin') continue
    const u = getUserById(u0.id)
    if (!u || !u.home) continue
    for (const uuid of uuids) {
      setAcl(u.id, uuid, u.home, 'write')
      await ensureUserHomeDir(uuid, u.home)
      db.prepare("DELETE FROM acls WHERE user_id = ? AND drive_uuid = ? AND path_prefix = ''").run(
        u.id,
        uuid
      )
    }
  }

  for (const uuid of uuids) await writeUsersManifest(uuid)
}
