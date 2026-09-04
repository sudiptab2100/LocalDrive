import { homedir, hostname } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'

/**
 * Central application configuration and paths. Everything the app needs to
 * restore its state after a restart lives under the config dir, so nothing is
 * lost when the server stops and starts again.
 */

export interface AppConfig {
  port: number
  /** Bind address. 0.0.0.0 exposes on the LAN. */
  host: string
  /** JWT signing secret, generated once and persisted. */
  jwtSecret: string
  /** Registered drive UUIDs the user chose to share. */
  registeredDriveUuids: string[]
  /** The share root folder name created on each drive. */
  shareRootName: string
  /** Whether to auto-start the server when the app launches. */
  autoStart: boolean
  /** Serve an encrypted HTTPS listener (self-signed local CA) alongside HTTP. */
  httpsEnabled: boolean
  /** Port for the HTTPS listener when enabled. */
  httpsPort: number
  /** Allow visitors to self-register an account from the web UI. */
  registrationEnabled: boolean
  /** When true, self-registered accounts become active immediately (no manual approval). */
  autoApproveRegistrations: boolean
  /** When true, per-drive access requests are granted immediately (no manual approval). */
  autoApproveAccessRequests: boolean
}

const DEFAULTS: Omit<AppConfig, 'jwtSecret'> = {
  port: 4820,
  host: '0.0.0.0',
  registeredDriveUuids: [],
  shareRootName: 'LocalDrive',
  autoStart: true,
  httpsEnabled: false,
  httpsPort: 4843,
  registrationEnabled: true,
  autoApproveRegistrations: false,
  autoApproveAccessRequests: false
}

export interface Paths {
  configDir: string
  configFile: string
  dbFile: string
  logDir: string
}

let cachedPaths: Paths | null = null

export function getPaths(overrideDir?: string): Paths {
  if (cachedPaths && !overrideDir) return cachedPaths
  const base =
    overrideDir ||
    process.env.LOCALDRIVE_HOME ||
    join(homedir(), 'Library', 'Application Support', 'LocalDrive')
  const paths: Paths = {
    configDir: base,
    configFile: join(base, 'config.json'),
    dbFile: join(base, 'localdrive.db'),
    logDir: join(base, 'logs')
  }
  if (!existsSync(paths.configDir)) mkdirSync(paths.configDir, { recursive: true })
  if (!existsSync(paths.logDir)) mkdirSync(paths.logDir, { recursive: true })
  if (!overrideDir) cachedPaths = paths
  return paths
}

export function loadConfig(paths = getPaths()): AppConfig {
  let stored: Partial<AppConfig> = {}
  if (existsSync(paths.configFile)) {
    try {
      stored = JSON.parse(readFileSync(paths.configFile, 'utf8'))
    } catch {
      stored = {}
    }
  }
  const config: AppConfig = {
    ...DEFAULTS,
    jwtSecret: stored.jwtSecret || randomBytes(32).toString('hex'),
    ...stored,
    // Ensure arrays/defaults are well-formed even if the file is partial.
    registeredDriveUuids: stored.registeredDriveUuids ?? DEFAULTS.registeredDriveUuids
  }
  // Persist immediately so a freshly generated secret survives restarts.
  saveConfig(config, paths)
  return config
}

export function saveConfig(config: AppConfig, paths = getPaths()): void {
  const tmp = paths.configFile + '.tmp'
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
  // Atomic replace to avoid a half-written config on crash.
  renameSync(tmp, paths.configFile)
}

export function localHostname(): string {
  const h = hostname()
  // macOS advertises "<name>.local" via Bonjour.
  if (h.endsWith('.local')) return h
  return `${h.replace(/\.lan$/, '')}.local`
}
