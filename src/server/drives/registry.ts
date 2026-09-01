import { join, basename } from 'path'
import { mkdirSync, existsSync, statfsSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { getDb } from '../db/index.js'
import { loadConfig } from '../config.js'
import { detectDrives } from './detect.js'
import { safeResolve } from '../util/fs-safe.js'
import { bus, EVENTS } from '../events.js'
import type { DriveInfo } from '../../shared/types.js'

/**
 * Drive registry: reconciles physically-detected drives with the persisted
 * registry in SQLite. Drives are identified by a stable UUID so unplug/replug
 * and app restarts reattach automatically with no data loss.
 */

export interface RegistryDrive extends DriveInfo {}

/**
 * Custom folders (any directory the user picks, e.g. on the internal disk) are
 * stored in the same registry as physical drives but identified by a
 * "folder:"-prefixed UUID so they are never confused with detected volumes.
 */
const CUSTOM_PREFIX = 'folder:'

export function isCustomUuid(uuid: string): boolean {
  return uuid.startsWith(CUSTOM_PREFIX)
}

function folderUuid(absPath: string): string {
  return CUSTOM_PREFIX + createHash('sha1').update(absPath).digest('hex').slice(0, 16)
}

function folderStatus(path: string): { online: boolean; totalBytes: number | null; freeBytes: number | null } {
  try {
    const s = statfsSync(path)
    return { online: true, totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize }
  } catch {
    return { online: false, totalBytes: null, freeBytes: null }
  }
}

/** Detect online drives and upsert their metadata into the registry. */
export async function syncDrives(): Promise<RegistryDrive[]> {
  const db = getDb()
  const online = await detectDrives()

  const upsert = db.prepare(`
    INSERT INTO drives (uuid, label, last_mount_path, filesystem, external, last_seen)
    VALUES (@uuid, @label, @mountPath, @filesystem, @external, datetime('now'))
    ON CONFLICT(uuid) DO UPDATE SET
      label = excluded.label,
      last_mount_path = excluded.last_mount_path,
      filesystem = COALESCE(excluded.filesystem, drives.filesystem),
      external = excluded.external,
      last_seen = datetime('now')
  `)
  const tx = db.transaction((drives: DriveInfo[]) => {
    for (const d of drives) {
      upsert.run({
        uuid: d.uuid,
        label: d.label,
        mountPath: d.mountPath,
        filesystem: d.filesystem,
        external: d.external ? 1 : 0
      })
    }
  })
  tx(online)

  return listDrives(online)
}

/** Merge the persisted registry with the current online set. */
export function listDrives(online?: DriveInfo[]): RegistryDrive[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT uuid, label, last_mount_path, filesystem, external, registered FROM drives')
    .all() as {
    uuid: string
    label: string
    last_mount_path: string | null
    filesystem: string | null
    external: number
    registered: number
  }[]

  const onlineMap = new Map((online ?? []).map((d) => [d.uuid, d]))

  return rows.map((r) => {
    const live = onlineMap.get(r.uuid)
    if (!live && isCustomUuid(r.uuid) && r.last_mount_path) {
      const st = folderStatus(r.last_mount_path)
      return {
        uuid: r.uuid,
        label: r.label,
        mountPath: r.last_mount_path,
        filesystem: r.filesystem ?? 'Folder',
        totalBytes: st.totalBytes,
        freeBytes: st.freeBytes,
        online: st.online,
        registered: Boolean(r.registered),
        external: false,
        custom: true,
        writable: true,
        shareable: st.online,
        unshareableReason: null
      }
    }
    return {
      uuid: r.uuid,
      label: r.label,
      mountPath: live?.mountPath ?? r.last_mount_path,
      filesystem: r.filesystem,
      totalBytes: live?.totalBytes ?? null,
      freeBytes: live?.freeBytes ?? null,
      online: Boolean(live),
      registered: Boolean(r.registered),
      external: Boolean(r.external),
      custom: isCustomUuid(r.uuid),
      writable: live?.writable,
      shareable: live?.shareable,
      unshareableReason: live?.unshareableReason ?? null
    }
  })
}

/** List only registered drives, merged with live status. */
export async function listRegisteredDrives(): Promise<RegistryDrive[]> {
  const all = await syncDrives()
  return all.filter((d) => d.registered)
}

/** Mark a drive as shared and prepare its on-disk folder structure. */
export async function registerDrive(uuid: string): Promise<RegistryDrive> {
  const all = await syncDrives()
  const drive = all.find((d) => d.uuid === uuid)
  if (!drive) throw new Error('Drive not found. Plug it in and try again.')
  if (drive.online && drive.shareable === false) {
    const why =
      drive.unshareableReason === 'system'
        ? 'the macOS system volume'
        : drive.unshareableReason === 'diskimage'
          ? 'a disk image'
          : 'read-only'
    throw new Error(`This drive can't be shared — it's ${why}.`)
  }
  const db = getDb()
  db.prepare('UPDATE drives SET registered = 1 WHERE uuid = ?').run(uuid)
  ensureDriveLayout(uuid)
  bus.emit(EVENTS.drivesChanged)
  return listDrives(await detectDrives()).find((d) => d.uuid === uuid)!
}

export function unregisterDrive(uuid: string): void {
  const db = getDb()
  // Custom folders are not auto-detected, so drop them entirely on unregister
  // (leaving a registered=0 row would just be dead clutter in the drive list).
  if (isCustomUuid(uuid)) {
    db.prepare('DELETE FROM drives WHERE uuid = ?').run(uuid)
  } else {
    db.prepare('UPDATE drives SET registered = 0 WHERE uuid = ?').run(uuid)
  }
  bus.emit(EVENTS.drivesChanged)
}

/**
 * Register any local folder (e.g. on the internal disk) as a shared storage
 * location. Lets the app be used without an external drive attached.
 */
export async function registerFolder(absPath: string, label?: string): Promise<RegistryDrive> {
  if (!absPath || !existsSync(absPath)) throw new Error('Folder not found')
  if (!statSync(absPath).isDirectory()) throw new Error('Please choose a folder, not a file')
  const uuid = folderUuid(absPath)
  const name = (label && label.trim()) || basename(absPath) || 'Shared Folder'
  getDb()
    .prepare(
      `INSERT INTO drives (uuid, label, last_mount_path, filesystem, external, registered, last_seen)
       VALUES (?, ?, ?, 'Folder', 0, 1, datetime('now'))
       ON CONFLICT(uuid) DO UPDATE SET
         label = excluded.label,
         last_mount_path = excluded.last_mount_path,
         registered = 1,
         last_seen = datetime('now')`
    )
    .run(uuid, name, absPath)
  ensureDriveLayoutAt(absPath)
  bus.emit(EVENTS.drivesChanged)
  return listDrives(await detectDrives()).find((d) => d.uuid === uuid)!
}

/** Current mount path for an online drive, or null when offline. */
export async function driveMountPath(uuid: string): Promise<string | null> {
  if (isCustomUuid(uuid)) {
    const row = getDb().prepare('SELECT last_mount_path FROM drives WHERE uuid = ?').get(uuid) as
      | { last_mount_path: string | null }
      | undefined
    return row?.last_mount_path && existsSync(row.last_mount_path) ? row.last_mount_path : null
  }
  const d = (await detectDrives()).find((x) => x.uuid === uuid)
  return d?.mountPath ?? null
}

/** Absolute path to the user-visible share root on a drive. Throws if offline. */
export async function getShareRoot(uuid: string): Promise<string> {
  const mount = await driveMountPath(uuid)
  if (!mount) throw new Error('Drive is offline')
  const cfg = loadConfig()
  const root = join(mount, cfg.shareRootName)
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

/** Absolute path to the hidden per-drive app data dir (tmp/thumbs/trash). */
export async function getDriveAppDir(uuid: string): Promise<string> {
  const mount = await driveMountPath(uuid)
  if (!mount) throw new Error('Drive is offline')
  return join(mount, '.localdrive')
}

function ensureDriveLayoutAt(mount: string): void {
  const cfg = loadConfig()
  const dirs = [
    join(mount, cfg.shareRootName),
    join(mount, '.localdrive'),
    join(mount, '.localdrive', 'tmp'),
    join(mount, '.localdrive', 'thumbs'),
    join(mount, '.localdrive', 'trash'),
    join(mount, '.localdrive', 'versions')
  ]
  for (const d of dirs) if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

export function ensureDriveLayout(uuid: string): void {
  const db = getDb()
  const row = db.prepare('SELECT last_mount_path FROM drives WHERE uuid = ?').get(uuid) as
    | { last_mount_path: string | null }
    | undefined
  if (row?.last_mount_path && existsSync(row.last_mount_path)) {
    ensureDriveLayoutAt(row.last_mount_path)
  }
}

/**
 * Resolve an API path (drive-relative) to a safe absolute filesystem path
 * inside the drive's share root. Returns null on traversal attempts.
 */
export async function resolveInDrive(uuid: string, relPath: string): Promise<string | null> {
  const root = await getShareRoot(uuid)
  return safeResolve(root, relPath)
}
