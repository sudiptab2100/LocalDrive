// Shared types used by the server, Electron main, and the front-ends.

export type Role = 'admin' | 'user'
export type Permission = 'read' | 'write' | 'admin'

export interface User {
  id: number
  username: string
  role: Role
  createdAt: string
  /** Filesystem-safe folder name for this user's private home ('' for admins). */
  home: string
}

export interface DriveInfo {
  /** Stable identity across remounts (Volume UUID when available, else a hash). */
  uuid: string
  /** Human label, e.g. "My SSD". */
  label: string
  /** Current mount path, e.g. "/Volumes/My SSD". Null when offline. */
  mountPath: string | null
  filesystem: string | null
  totalBytes: number | null
  freeBytes: number | null
  /** Whether the drive is currently connected. */
  online: boolean
  /** Whether the user registered this drive for sharing. */
  registered: boolean
  /** External/removable vs internal. */
  external: boolean
  /** True when this is a user-picked folder rather than a physical volume. */
  custom?: boolean
  /** Whether the volume is mounted read/write. */
  writable?: boolean
  /** Whether this drive can be shared (writable, not a system or disk-image mount). */
  shareable?: boolean
  /** Why a drive can't be shared, for the UI. Null/undefined when shareable. */
  unshareableReason?: 'readonly' | 'system' | 'diskimage' | null
}

export interface FileEntry {
  name: string
  /** POSIX path relative to the drive share root, using "/" separators. */
  path: string
  isDir: boolean
  size: number
  mtimeMs: number
  mime: string | null
}

export interface Acl {
  id: number
  userId: number
  driveUuid: string
  /** Path prefix within the drive this rule applies to ("" = whole drive). */
  pathPrefix: string
  permission: Permission
}

export interface ServerStatus {
  running: boolean
  port: number
  host: string
  /** e.g. "MacName.local" */
  hostname: string
  urls: string[]
  startedAt: string | null
  activeConnections: number
  /** Whether the encrypted HTTPS listener is active. */
  https: boolean
  /** Port the HTTPS listener is bound to (when `https` is true). */
  httpsPort: number
}

export interface TransferStat {
  bytesIn: number
  bytesOut: number
  uploads: number
  downloads: number
}

export interface ActivityRecord {
  id: number
  ts: string
  userId: number | null
  username: string | null
  action: string
  detail: string | null
  ip: string | null
}

export interface AuthResult {
  token: string
  user: User
}

export interface ApiError {
  error: string
}
