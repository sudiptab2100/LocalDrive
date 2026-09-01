import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdir, statfs } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import * as plist from 'simple-plist'
import type { DriveInfo } from '../../shared/types.js'

const execFileAsync = promisify(execFile)

interface DiskutilInfo {
  VolumeUUID?: string
  VolumeName?: string
  FilesystemName?: string
  FilesystemType?: string
  Internal?: boolean
  Ejectable?: boolean
  RemovableMedia?: boolean | string
  MountPoint?: string
  TotalSize?: number
  FreeSpace?: number
  Size?: number
  Writable?: boolean
  WritableVolume?: boolean
  BusProtocol?: string
}

async function diskutilInfo(mountPoint: string): Promise<DiskutilInfo | null> {
  try {
    const { stdout } = await execFileAsync('diskutil', ['info', '-plist', mountPoint], {
      maxBuffer: 4 * 1024 * 1024
    })
    return plist.parse(stdout) as unknown as DiskutilInfo
  } catch {
    return null
  }
}

/** Base directory of mounted volumes (overridable for tests). */
function volumesDir(): string {
  return process.env.LOCALDRIVE_VOLUMES_DIR || '/Volumes'
}

function stableUuid(info: DiskutilInfo | null, mountPoint: string, name: string): string {
  if (info?.VolumeUUID) return info.VolumeUUID
  // Fall back to a deterministic id from the volume name (FAT/exFAT often lack UUIDs).
  return 'name:' + createHash('sha1').update(name).digest('hex').slice(0, 16)
}

/**
 * Enumerate currently mounted volumes under /Volumes and describe each one.
 * External/removable drives are flagged so the UI can prioritise them.
 */
export async function detectDrives(): Promise<DriveInfo[]> {
  let names: string[]
  const base = volumesDir()
  try {
    names = await readdir(base)
  } catch {
    return []
  }

  const results: DriveInfo[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const mountPath = join(base, name)
    const info = await diskutilInfo(mountPath)

    let totalBytes: number | null = info?.TotalSize ?? info?.Size ?? null
    let freeBytes: number | null = info?.FreeSpace ?? null
    if (totalBytes == null || freeBytes == null) {
      try {
        const s = await statfs(mountPath)
        totalBytes = s.blocks * s.bsize
        freeBytes = s.bavail * s.bsize
      } catch {
        /* leave nulls */
      }
    }

    const external =
      info == null
        ? true // best effort: unknown volumes under /Volumes are usually external
        : Boolean(info.Internal === false || info.Ejectable || info.RemovableMedia)

    // Classify whether the drive can actually be shared. Read-only volumes
    // (DMG installers, the sealed system volume) can't host the LocalDrive
    // layout, the macOS system/startup volume shouldn't be shared, and
    // disk-image mounts are transient installer media. When diskutil doesn't
    // say, assume writable/shareable rather than hiding a usable drive.
    const writable = info?.WritableVolume ?? info?.Writable ?? true
    const system = info?.MountPoint === '/'
    const diskImage = info?.BusProtocol === 'Disk Image'
    const shareable = writable && !system && !diskImage
    const unshareableReason: DriveInfo['unshareableReason'] = system
      ? 'system'
      : diskImage
        ? 'diskimage'
        : !writable
          ? 'readonly'
          : null

    results.push({
      uuid: stableUuid(info, mountPath, name),
      label: info?.VolumeName || name,
      mountPath,
      filesystem: info?.FilesystemName || info?.FilesystemType || null,
      totalBytes,
      freeBytes,
      online: true,
      registered: false,
      external,
      writable,
      shareable,
      unshareableReason
    })
  }
  return results
}

/** Look up a single online drive by its stable UUID. */
export async function findDriveByUuid(uuid: string): Promise<DriveInfo | null> {
  const drives = await detectDrives()
  return drives.find((d) => d.uuid === uuid) ?? null
}
