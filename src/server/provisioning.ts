import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'
import { listUsers, setUserHome, homeNameFor, isHomeTaken, ensureUniqueHome } from './auth.js'
import { getShareRoot, getDriveAppDir } from './drives/registry.js'

/**
 * Userspace provisioning helpers for the opt-in access model.
 *
 * A user gets access to a drive only when an admin approves their request (see
 * `src/server/access.ts`). At that point the user's private folder —
 * `LocalDrive/<home>/`, where `<home>` is the deterministic, username-derived
 * name — is **reused if it already exists** (so a drive shared from another PC
 * reconnects the user to their existing data) or created if missing. Nothing
 * here grants access on its own; it only manages folders + the portable
 * manifest.
 */

/** Create <drive>/LocalDrive/<home> if the drive is online, reusing it if present. */
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

/** Whether a user's folder already exists on a drive (best-effort; false when offline). */
export async function userSpaceExists(uuid: string, home: string): Promise<boolean> {
  if (!home) return false
  try {
    const root = await getShareRoot(uuid)
    return existsSync(join(root, home))
  } catch {
    return false
  }
}

/**
 * Write a portable, secret-free user manifest to <drive>/.localdrive/users.json
 * so basic account info travels with the drive. Never contains password hashes.
 */
export async function writeUsersManifest(uuid: string): Promise<void> {
  try {
    const appDir = await getDriveAppDir(uuid)
    if (!existsSync(appDir)) mkdirSync(appDir, { recursive: true })
    const users = listUsers()
      .filter((u) => u.role !== 'admin' && u.status === 'active')
      .map((u) => ({ username: u.username, home: u.home, role: u.role, createdAt: u.createdAt }))
    const payload = JSON.stringify({ updatedAt: new Date().toISOString(), users }, null, 2)
    const tmp = join(appDir, `.users.${randomBytes(4).toString('hex')}.tmp`)
    writeFileSync(tmp, payload)
    renameSync(tmp, join(appDir, 'users.json'))
  } catch {
    /* drive offline or read-only — skip */
  }
}

/**
 * Startup reconcile: give every non-admin user a deterministic, username-based
 * home folder name (the portability key). Legacy users missing a home get one;
 * legacy suffixed homes are normalized to the deterministic name when it is
 * free. This never grants drive access and never moves on-disk data — access is
 * always opt-in via an admin-approved request.
 */
export async function backfillHomes(): Promise<void> {
  for (const u of listUsers()) {
    if (u.role === 'admin') continue
    const desired = homeNameFor(u.username)
    if (!u.home) {
      // Assign a home; fall back to a unique suffix only if the deterministic
      // name is already claimed by a different legacy user.
      setUserHome(u.id, isHomeTaken(desired, u.id) ? ensureUniqueHome(desired, u.id) : desired)
    } else if (u.home !== desired && !isHomeTaken(desired, u.id)) {
      setUserHome(u.id, desired)
    }
  }
}
