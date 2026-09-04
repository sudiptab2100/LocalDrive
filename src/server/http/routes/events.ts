import { Router } from 'express'
import type { Response } from 'express'
import { requireAdmin } from '../middleware.js'
import { bus, EVENTS } from '../../events.js'
import { getStatus } from '../../status.js'

/**
 * Server-Sent Events stream of app-wide changes, so the admin web panel stays
 * live (drives, registrations, access requests, server status, config) exactly
 * like the desktop app's IPC push events. Admin-only; the browser's EventSource
 * authenticates via the same-origin `ld_token` cookie.
 */
export const eventsRouter = Router()

eventsRouter.get('/', requireAdmin, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering so events flush immediately.
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders?.()

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data ?? {})}\n\n`)
  }

  // Prime the client with the current status.
  send('statusChanged', getStatus())

  const onDrives = (): void => send('drivesChanged', {})
  const onReg = (info: unknown): void => send('registrationsChanged', info)
  const onAccess = (info: unknown): void => send('accessRequestsChanged', info)
  const onStatus = (s: unknown): void => send('statusChanged', s)
  const onConfig = (c: unknown): void => send('configChanged', c)

  bus.on(EVENTS.drivesChanged, onDrives)
  bus.on(EVENTS.registrationsChanged, onReg)
  bus.on(EVENTS.accessRequestsChanged, onAccess)
  bus.on(EVENTS.statusChanged, onStatus)
  bus.on(EVENTS.configChanged, onConfig)

  // Keep-alive comment so idle connections aren't dropped by intermediaries.
  const ka = setInterval(() => res.write(': ping\n\n'), 25000)
  ka.unref?.()

  const cleanup = (): void => {
    clearInterval(ka)
    bus.off(EVENTS.drivesChanged, onDrives)
    bus.off(EVENTS.registrationsChanged, onReg)
    bus.off(EVENTS.accessRequestsChanged, onAccess)
    bus.off(EVENTS.statusChanged, onStatus)
    bus.off(EVENTS.configChanged, onConfig)
  }
  req.on('close', cleanup)
  ;(res as Response).on('close', cleanup)
})
