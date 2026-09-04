import { Router } from 'express'
import { isAbsolute } from 'path'
import { syncDrives, registerDrive, registerFolder, unregisterDrive } from '../../drives/registry.js'
import { requireAuth, requireAdmin } from '../middleware.js'
import { getUserHome } from '../../auth.js'
import { getAccessMap, requestAccess } from '../../access.js'
import { logActivity } from '../../db/index.js'
import type { DriveInfo } from '../../../shared/types.js'

export const drivesRouter = Router()

// Every registered drive the caller can see. Access is opt-in: a non-admin sees
// all registered drives but each is annotated with an `access` state
// (granted/pending/denied/none). Admins implicitly have access to every drive.
drivesRouter.get('/', requireAuth, async (req, res) => {
  const user = req.user!
  const all = await syncDrives()
  const registered = all.filter((d) => d.registered)
  if (user.role === 'admin') {
    res.json({ drives: registered.map((d) => ({ ...d, access: 'granted' as const })) })
    return
  }
  const map = getAccessMap(user.id)
  const drives: DriveInfo[] = registered.map((d) => {
    const granted = getUserHome(user, d.uuid) != null
    const st = map[d.uuid]
    const access: DriveInfo['access'] = granted
      ? 'granted'
      : st === 'pending'
        ? 'pending'
        : st === 'denied'
          ? 'denied'
          : 'none'
    return { ...d, access }
  })
  res.json({ drives })
})

// A user asks for access to a drive (admin approves later, unless auto-approve).
drivesRouter.post('/request-access', requireAuth, async (req, res) => {
  const user = req.user!
  const { uuid } = req.body ?? {}
  if (!uuid) {
    res.status(400).json({ error: 'Missing uuid' })
    return
  }
  if (user.role === 'admin') {
    res.json({ access: 'granted' })
    return
  }
  try {
    const access = await requestAccess(user, String(uuid))
    res.json({ access })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
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

// Register any absolute folder path on the server as a shared drive. The web
// panel uses this (browsers have no native folder picker) with a typed path;
// the desktop app uses a native dialog. Admin-only.
drivesRouter.post('/register-folder', requireAdmin, async (req, res) => {
  const path = String(req.body?.path ?? '').trim()
  if (!path) {
    res.status(400).json({ error: 'Missing path' })
    return
  }
  if (!isAbsolute(path)) {
    res.status(400).json({ error: 'Path must be absolute' })
    return
  }
  try {
    const drive = await registerFolder(path)
    logActivity('drive_register', { userId: req.user!.id, detail: drive.label })
    res.json({ drive })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})
