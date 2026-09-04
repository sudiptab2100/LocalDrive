import { Router } from 'express'
import { requireAdmin } from '../middleware.js'
import { loadConfig, saveConfig, toConfigView, type AppConfig } from '../../config.js'
import { getServerManager } from '../../index.js'
import { bus, EVENTS } from '../../events.js'
import { logActivity } from '../../db/index.js'

/**
 * App configuration for the admin web panel. Mirrors the desktop IPC
 * (`config:get/set`) with full parity — including the restart-requiring keys
 * (port/host/HTTPS). Changing a restart key triggers a real server restart so
 * the web panel can do everything the desktop app can. Admin-only.
 */
export const configRouter = Router()

configRouter.use(requireAdmin)

const RESTART_KEYS = ['port', 'host', 'httpsEnabled', 'httpsPort'] as const
type Key = keyof AppConfig

function isRestartKey(k: string): boolean {
  return (RESTART_KEYS as readonly string[]).includes(k)
}

/** Validate + coerce a single incoming config value. Returns the coerced value
 * or throws with a human-readable message. */
function coerce(key: string, value: unknown): unknown {
  switch (key) {
    case 'port':
    case 'httpsPort': {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${key} must be 1–65535`)
      return n
    }
    case 'host': {
      const s = String(value).trim()
      if (!s) throw new Error('Bind address is required')
      return s
    }
    case 'shareRootName': {
      const s = String(value).trim()
      if (!s) throw new Error('Share folder name is required')
      if (/[\\/]/.test(s)) throw new Error('Share folder name cannot contain slashes')
      return s
    }
    case 'autoStart':
    case 'httpsEnabled':
    case 'registrationEnabled':
    case 'autoApproveRegistrations':
    case 'autoApproveAccessRequests':
      return Boolean(value)
    default:
      // Unknown / protected key (e.g. jwtSecret, registeredDriveUuids): ignore.
      return undefined
  }
}

configRouter.get('/', (_req, res) => {
  res.json(toConfigView(loadConfig()))
})

configRouter.patch('/', async (req, res) => {
  const patch = (req.body ?? {}) as Record<string, unknown>
  const current = loadConfig()
  const next: AppConfig = { ...current }
  let restartNeeded = false

  try {
    for (const [k, v] of Object.entries(patch)) {
      const coerced = coerce(k, v)
      if (coerced === undefined) continue
      if (isRestartKey(k) && coerced !== current[k as Key]) restartNeeded = true
      ;(next as unknown as Record<string, unknown>)[k] = coerced
    }
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
    return
  }

  saveConfig(next)
  logActivity('config_update', { userId: req.user!.id, detail: Object.keys(patch).join(',') })
  const view = toConfigView(next)
  bus.emit(EVENTS.configChanged, view)

  const willRestart = restartNeeded && getServerManager().isRunning()
  res.json({ config: view, restarted: willRestart })
  if (willRestart) {
    setImmediate(() => {
      getServerManager()
        .restart()
        .catch(() => {})
    })
  }
})
