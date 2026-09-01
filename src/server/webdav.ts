import { v2 as webdav } from 'webdav-server'
import type { RequestHandler } from 'express'
import { authenticate, getUserByName, hasPermission } from './auth.js'
import type { Permission } from '../shared/types.js'

/**
 * WebDAV access layer. Lets users mount their registered drives in Finder,
 * Windows Explorer or Android apps using their LocalDrive account. Permissions
 * are enforced against the same RBAC rules as the web API.
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

  const mountToDrive = new Map<string, string>()

  // Authenticate against LocalDrive accounts.
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

  // Map WebDAV privilege checks onto our per-folder RBAC.
  class LocalDrivePrivilege extends (webdav as any).PrivilegeManager {
    _can(fullPath: any, user: any, _resource: any, privilege: string, cb: (e: Error | null, ok: boolean) => void): void {
      if (!user || user.isDefaultUser) return cb(null, false)
      const our = getUserByName(user.username)
      if (!our) return cb(null, false)
      const parts = fullPath.toString().split('/').filter(Boolean)
      const mount = parts[0]
      const driveUuid = mount ? mountToDrive.get(mount) : undefined
      if (!driveUuid) return cb(null, false)
      const rel = parts.slice(1).join('/')
      const need: Permission = privilege.startsWith('canWrite') ? 'write' : 'read'
      cb(null, hasPermission(our, driveUuid, rel, need))
    }
  }

  const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPBasicAuthentication(userManager, 'LocalDrive'),
    privilegeManager: new LocalDrivePrivilege() as any
  })

  const used = new Set<string>()
  for (const d of usable) {
    let name = slug(d.label)
    if (used.has(name)) name = `${name}-${d.uuid.slice(0, 6)}`
    used.add(name)
    mountToDrive.set(name, d.uuid)
    try {
      server.setFileSystemSync('/' + name, new webdav.PhysicalFileSystem(d.shareRoot))
    } catch {
      /* skip drives that fail to mount */
    }
  }

  return webdav.extensions.express('/dav', server) as unknown as RequestHandler
}
