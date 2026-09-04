import { Router } from 'express'
import { requireAdmin } from '../middleware.js'
import { getServerManager } from '../../index.js'
import { getStatus } from '../../status.js'

/**
 * Server lifecycle control for the admin web panel — the same Start/Stop/Restart
 * the desktop app exposes over IPC. Admin-only.
 *
 * Stop/Restart tear down the very sockets serving this request, so the JSON
 * reply is flushed first and the action runs on the next tick.
 */
export const serverRouter = Router()

serverRouter.use(requireAdmin)

serverRouter.post('/start', async (_req, res) => {
  const status = await getServerManager().start()
  res.json({ status })
})

serverRouter.post('/stop', (_req, res) => {
  res.json({ status: { ...getStatus(), running: false }, stopping: true })
  setImmediate(() => {
    getServerManager()
      .stop()
      .catch(() => {})
  })
})

serverRouter.post('/restart', (_req, res) => {
  res.json({ status: getStatus(), restarting: true })
  setImmediate(() => {
    getServerManager()
      .restart()
      .catch(() => {})
  })
})
