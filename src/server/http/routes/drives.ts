import { Router } from 'express'
import { syncDrives, registerDrive, unregisterDrive } from '../../drives/registry.js'
import { requireAuth, requireAdmin } from '../middleware.js'
import { getUserHome } from '../../auth.js'
import { provisionDriveForAllUsers, ensureUserProvisioned } from '../../provisioning.js'
import { logActivity } from '../../db/index.js'

export const drivesRouter = Router()

// Drives the current user can see (registered + provisioned for them).
drivesRouter.get('/', requireAuth, async (req, res) => {
  const user = req.user!
  // Self-heal any missing per-drive access so a user always sees every shared
  // drive, then list. Idempotent and cheap when already fully provisioned.
  await ensureUserProvisioned(user)
  const all = await syncDrives()
  const visible = all.filter((d) => d.registered && getUserHome(user, d.uuid) != null)
  res.json({ drives: visible })
})

// Admin: every detected drive (registered or not) for management.
drivesRouter.get('/all', requireAdmin, async (_req, res) => {
  const drives = await syncDrives()
  res.json({ drives })
})

drivesRouter.post('/register', requireAdmin, async (req, res) => {
  const { uuid } = req.body ?? {}
  if (!uuid) {
    res.status(400).json({ error: 'Missing uuid' })
    return
  }
  try {
    const drive = await registerDrive(String(uuid))
    await provisionDriveForAllUsers(String(uuid))
    logActivity('drive_register', { userId: req.user!.id, detail: drive.label })
    res.json({ drive })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

drivesRouter.post('/unregister', requireAdmin, (req, res) => {
  const { uuid } = req.body ?? {}
  if (!uuid) {
    res.status(400).json({ error: 'Missing uuid' })
    return
  }
  unregisterDrive(String(uuid))
  logActivity('drive_unregister', { userId: req.user!.id, detail: String(uuid) })
  res.json({ ok: true })
})
