import { getServerManager } from './index.js'
import { getPaths } from './config.js'

/**
 * Run the LocalDrive server on its own (no Electron) for development and
 * testing. Usage: `npm run server:dev`. Honours LOCALDRIVE_HOME to isolate
 * config/data for tests.
 */
async function main(): Promise<void> {
  const paths = getPaths()
  const manager = getServerManager({ webuiDir: process.env.LOCALDRIVE_WEBUI })

  const created = manager.bootstrap()
  const status = await manager.start()

  console.log('─'.repeat(56))
  console.log(' LocalDrive server running')
  console.log(' Config dir :', paths.configDir)
  for (const url of status.urls) console.log(' URL        :', url)
  if (created) {
    console.log(' Admin user :', created.username)
    console.log(' Admin pass :', created.password, '(shown once)')
  }
  console.log('─'.repeat(56))

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down gracefully…')
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
