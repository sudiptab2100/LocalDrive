import { Router } from 'express'
import { getDb } from '../../db/index.js'
import { getDashboard } from '../../dashboard.js'
import { requireAuth, requireAdmin } from '../middleware.js'
import type { ActivityRecord } from '../../../shared/types.js'

export const statsRouter = Router()

// Dashboard snapshot: transfers, drive usage, server status, recent activity.
statsRouter.get('/', requireAuth, async (req, res) => {
  res.json(await getDashboard(req.user!.role === 'admin'))
})

statsRouter.get('/activity', requireAdmin, (_req, res) => {
  const activity = getDb()
    .prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 200')
    .all() as ActivityRecord[]
  res.json({ activity })
})
