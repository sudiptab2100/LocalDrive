import type { ServerStatus } from '../../shared/types.js'
import type { AppConfig } from '../config.js'

export interface AdminCreds {
  username: string
  password: string
}

export interface BannerOptions {
  /** Absolute path of the config/data directory, shown for operator reference. */
  configDir?: string
  /** First-run admin credentials to print once (only when just created). */
  created?: AdminCreds | null
  /** Tag the banner as a headless (no-window) session. */
  headless?: boolean
}

const LINE = '─'.repeat(60)

/**
 * Render the multi-line connection banner shown in the terminal for headless
 * runs (both the Electron `--headless` host and the dev `standalone.ts`).
 * Reprint it whenever `statusChanged`/`configChanged` fire so the terminal
 * always reflects the live port, HTTPS state, and LAN addresses.
 */
export function formatConnectionBanner(
  status: ServerStatus,
  config: AppConfig,
  opts: BannerOptions = {}
): string {
  const lines: string[] = []
  lines.push(LINE)
  lines.push(`  LocalDrive server ${status.running ? 'running' : 'stopped'}${opts.headless ? '  ·  headless' : ''}`)
  lines.push(LINE)
  lines.push(`  Status     : ${status.running ? 'online' : 'offline'}`)
  lines.push(`  Bind host  : ${status.host}`)
  lines.push(`  HTTP port  : ${status.port}`)
  if (status.https) lines.push(`  HTTPS port : ${status.httpsPort}`)
  lines.push(`  Share name : ${config.shareRootName}`)
  if (opts.configDir) lines.push(`  Config dir : ${opts.configDir}`)
  lines.push(`  Active     : ${status.activeConnections} connection(s)`)

  if (status.running && status.urls.length) {
    lines.push('')
    lines.push('  Web UI (clients):')
    for (const url of status.urls) lines.push(`    • ${url}`)
    lines.push('')
    lines.push('  Admin control panel:')
    for (const url of status.urls) lines.push(`    • ${url}/admin`)
  }

  if (opts.created) {
    lines.push('')
    lines.push('  Admin account created — save these (shown once):')
    lines.push(`    user     : ${opts.created.username}`)
    lines.push(`    password : ${opts.created.password}`)
  }

  lines.push(LINE)
  return lines.join('\n')
}
