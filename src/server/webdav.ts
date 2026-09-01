import { v2 as webdav } from 'webdav-server'
import type { RequestHandler } from 'express'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { authenticate, getUserByName, getUserHome, hasPermission } from './auth.js'
import type { Permission, User } from '../shared/types.js'

/**
 * WebDAV access layer. Lets users mount their registered drives in Finder,
 * Windows Explorer or Android apps using their LocalDrive account.
 *
 * Each user gets a view that is **rooted at their private home folder**, exactly
 * like the web API's driveScope: a normal user who connects to `/dav/<Drive>/`
 * sees their own files as the drive root (no `<username>` subfolder, and no
 * other users' folders), while admins see the whole share. This is why WebDAV
 * used to 401 for normal users — the old code mounted the whole share root and
 * denied them at the drive-root collection, which they have no ACL for.
 *
 * Permissions are still enforced against the same RBAC rules (`hasPermission`)
 * as the web API.
 */

export interface WebdavMount {
  uuid: string
  name: string // URL-safe mount segment
  shareRoot: string
}

function slug(label: string): string {
  return (
    label
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'drive'
  )
}

/** Build a WebDAV express handler serving the given drives, or null if none. */
export function buildWebdav(
  drives: { uuid: string; label: string; shareRoot: string }[]
): RequestHandler | null {
  const usable = drives.filter((d) => d.shareRoot)
  if (usable.length === 0) return null

  // Stable, collision-free mount name per drive, shared across all users so the
  // URL for a drive (`/dav/<name>/`) is the same for everyone.
  const nameByUuid = new Map<string, string>()
  const usedNames = new Set<string>()
  for (const d of usable) {
    let name = slug(d.label)
    if (usedNames.has(name)) name = `${name}-${d.uuid.slice(0, 6)}`
    usedNames.add(name)
    nameByUuid.set(d.uuid, name)
  }

  // Authenticate against LocalDrive accounts (bcrypt via authenticate()).
  const userManager: any = {
    getDefaultUser: (cb: (user: any) => void) =>
      cb({ uid: 'anonymous', username: 'anonymous', isDefaultUser: true, isAdministrator: false }),
    getUserByNamePassword: (name: string, password: string, cb: (e: Error | null, u?: any) => void) => {
      const u = authenticate(name, password)
      if (!u) return cb(new Error('Invalid credentials'))
      cb(null, {
        uid: String(u.id),
        username: u.username,
        isDefaultUser: false,
        isAdministrator: u.role === 'admin'
      })
    }
  }

  // One WebDAV server per user, built lazily and cached. A user's mounts are
  // physically rooted at their home folder so they can never see outside it.
  const cache = new Map<string, RequestHandler>()

  function buildForUser(owner: User): RequestHandler {
    const mountToDrive = new Map<string, { uuid: string; home: string }>()

    // Map WebDAV privilege checks onto our per-folder RBAC. `fullPath` is
    // home-relative (because the filesystem is rooted at the user's home), so we
    // prefix the home back on before consulting hasPermission.
    class LocalDrivePrivilege extends (webdav as any).PrivilegeManager {
      _can(
        fullPath: any,
        user: any,
        _resource: any,
        privilege: string,
        cb: (e: Error | null, ok: boolean) => void
      ): void {
        if (!user || user.isDefaultUser) return cb(null, false)
        const our = getUserByName(user.username)
        if (!our) return cb(null, false)
        const need: Permission = privilege.startsWith('canWrite') ? 'write' : 'read'
        const parts = fullPath.toString().split('/').filter(Boolean)
        // Virtual root (`/dav/`): let authenticated users list their drives.
        // webdav-server bypasses _can for admins but not for normal users, so
        // without this a normal user's `PROPFIND /dav/` would 401.
        if (parts.length === 0) return cb(null, need === 'read')
        const info = mountToDrive.get(parts[0])
        if (!info) return cb(null, false)
        const rel = parts.slice(1).join('/')
        const full = info.home ? (rel ? `${info.home}/${rel}` : info.home) : rel
        cb(null, hasPermission(our, info.uuid, full, need))
      }
    }

    const server = new webdav.WebDAVServer({
      httpAuthentication: new webdav.HTTPBasicAuthentication(userManager, 'LocalDrive'),
      privilegeManager: new LocalDrivePrivilege() as any
    })

    for (const d of usable) {
      let home = ''
      if (owner.role !== 'admin') {
        const h = getUserHome(owner, d.uuid)
        if (h == null) continue // no access to this drive -> don't mount it
        home = h
      }
      const rootPath = home ? join(d.shareRoot, home) : d.shareRoot
      try {
        // Ensure the home dir exists (it may have been provisioned while the
        // drive was offline). Best-effort — mirrors ensureUserHomeDir.
        mkdirSync(rootPath, { recursive: true })
      } catch {
        /* ignore — read-only/offline media */
      }
      const name = nameByUuid.get(d.uuid)!
      mountToDrive.set(name, { uuid: d.uuid, home })
      try {
        server.setFileSystemSync('/' + name, new webdav.PhysicalFileSystem(rootPath))
      } catch {
        /* skip drives that fail to mount */
      }
    }

    return webdav.extensions.express('/dav', server) as unknown as RequestHandler
  }

  function challenge(res: any): void {
    res.statusCode = 401
    res.setHeader('WWW-Authenticate', 'Basic realm="LocalDrive"')
    res.end('Authentication required')
  }

  // Per-request wrapper: pick (or build) the caller's home-scoped server. We
  // decode only the username here (no bcrypt) to choose the server; the server's
  // own HTTP Basic auth still validates the password, so routing by an
  // unverified username is safe — a wrong password is rejected there with 401.
  return (req, res, next) => {
    const header = String(req.headers['authorization'] || '')
    const m = /^Basic\s+(.+)$/i.exec(header)
    if (!m) return challenge(res)
    let username = ''
    try {
      username = Buffer.from(m[1], 'base64').toString('utf8').split(':')[0]
    } catch {
      return challenge(res)
    }
    const owner = getUserByName(username)
    if (!owner) return challenge(res) // unknown user: don't cache attacker-supplied names
    let handler = cache.get(owner.username)
    if (!handler) {
      handler = buildForUser(owner)
      cache.set(owner.username, handler)
    }
    return handler(req, res, next)
  }
}
