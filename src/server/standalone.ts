import { join } from 'path'
import { getServerManager } from './index.js'
import { getPaths, loadConfig } from './config.js'
import { bus, EVENTS } from './events.js'
import { formatConnectionBanner, type AdminCreds } from './util/report.js'

/**
 * Run the LocalDrive server on its own (no Electron) for development and
 * testing. Usage: `npm run server:dev`. Honours LOCALDRIVE_HOME to isolate
 * config/data for tests, and serves both the client web UI (`out/webui`) and
 * the admin control panel (`out/admin`) so `/admin` works in dev.
 */
async function main(): Promise<void> {
  const paths = getPaths()
  const manager = getServerManager({
    webuiDir: process.env.LOCALDRIVE_WEBUI ?? join(process.cwd(), 'out', 'webui'),
    adminDir: process.env.LOCALDRIVE_ADMIN ?? join(process.cwd(), 'out', 'admin')
  })

  const print = (created?: AdminCreds | null): void => {
    console.log(
      formatConnectionBanner(manager.getStatus(), loadConfig(), {
        configDir: paths.configDir,
        created: created ?? null,
        headless: true
      })
    )
  }

  const created = manager.bootstrap()
  await manager.start()
  print(created)

  // Live-reprint whenever the server status (port/HTTPS/LAN addresses) or the
  // config changes, so the terminal always shows current connection details.
  const reprint = (): void => print()
  bus.on(EVENTS.statusChanged, reprint)
  bus.on(EVENTS.configChanged, reprint)

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down gracefully…')
    bus.off(EVENTS.statusChanged, reprint)
    bus.off(EVENTS.configChanged, reprint)
    await manager.shutdown()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  console.error('Failed to start LocalDrive server:', e)
  process.exit(1)
})
