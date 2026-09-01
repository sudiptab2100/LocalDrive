import type { Request } from 'express'
import { getUserHome } from '../auth.js'
import { scopeIn, scopeOut } from '../util/fs-safe.js'
import { ensureUserHomeDir } from '../provisioning.js'

/**
 * Confinement scope for the calling user on a drive. Translates between the
 * client's home-relative paths (which always start at "/") and the real
 * drive-relative paths, so a user only ever sees inside their own home.
 */
export interface DriveScope {
  /** '' for admins (whole drive), else the user's home folder prefix. */
  home: string
  /** Map a client (home-relative) path to a full drive path, or null if it escapes. */
  in: (clientPath: string) => string | null
  /** Map a full drive path back to a client (home-relative) path. */
  out: (fullPath: string) => string
}

/**
 * Resolve the calling user's scope for a drive, or null when they have no
 * access. Lazily ensures the user's home folder exists so first access always
 * works even if the drive was offline when the user/drive was provisioned.
 */
export async function driveScope(req: Request, driveUuid: string): Promise<DriveScope | null> {
  const user = req.user
  if (!user) return null
  const home = getUserHome(user, driveUuid)
  if (home == null) return null
  if (home) await ensureUserHomeDir(driveUuid, home)
  return {
    home,
    in: (p: string) => scopeIn(home, p),
    out: (p: string) => scopeOut(home, p)
  }
}
