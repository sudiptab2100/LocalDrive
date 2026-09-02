import { Router } from 'express'
import {
  listUsers,
  createUser,
  deleteUser,
  setUserPassword,
  setUserRole,
  listAcls,
  setAcl,
  removeAcl,
  getUserById,
  approveUser
} from '../../auth.js'
import { requireAdmin } from '../middleware.js'
import { provisionUserHome } from '../../provisioning.js'
import { bus, EVENTS } from '../../events.js'
import { logActivity } from '../../db/index.js'
import type { Permission, Role } from '../../../shared/types.js'

export const usersRouter = Router()

usersRouter.use(requireAdmin)

usersRouter.get('/', (_req, res) => {
  const users = listUsers()
  const acls = listAcls()
  res.json({
    users: users.map((u) => ({ ...u, acls: acls.filter((a) => a.userId === u.id) }))
  })
})

usersRouter.post('/', async (req, res) => {
  const { username, password, role } = req.body ?? {}
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' })
  try {
    const user = createUser(String(username), String(password), (role as Role) || 'user')
    await provisionUserHome(user)
    logActivity('user_create', { userId: req.user!.id, detail: user.username })
    res.json({ user })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message || 'Could not create user' })
  }
})

usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  if (id === req.user!.id) return res.status(400).json({ error: 'Cannot delete yourself' })
  const target = getUserById(id)
  deleteUser(id)
  logActivity('user_delete', { userId: req.user!.id, detail: target?.username })
  // Rejecting a pending request should refresh the admin's approvals view.
  if (target?.status === 'pending') {
    bus.emit(EVENTS.registrationsChanged, { pending: false, username: target.username })
  }
  res.json({ ok: true })
})

// Approve a pending self-registration: activate + provision the user's home.
usersRouter.post('/:id/approve', async (req, res) => {
  const id = Number(req.params.id)
  const user = getUserById(id)
  if (!user) return res.status(404).json({ error: 'No such user' })
  if (user.status === 'active') return res.json({ user })
  const approved = approveUser(id)!
  await provisionUserHome(approved)
  logActivity('user_approve', { userId: req.user!.id, detail: approved.username })
  bus.emit(EVENTS.registrationsChanged, { pending: false, username: approved.username })
  res.json({ user: approved })
})

usersRouter.post('/:id/password', (req, res) => {
  const id = Number(req.params.id)
  const { password } = req.body ?? {}
  if (!password) return res.status(400).json({ error: 'Missing password' })
  if (!getUserById(id)) return res.status(404).json({ error: 'No such user' })
  setUserPassword(id, String(password))
  res.json({ ok: true })
})

usersRouter.post('/:id/role', (req, res) => {
  const id = Number(req.params.id)
  const { role } = req.body ?? {}
  if (role !== 'admin' && role !== 'user') return res.status(400).json({ error: 'Invalid role' })
  setUserRole(id, role as Role)
  res.json({ ok: true })
})

// ---- Per-folder permissions ----------------------------------------------
usersRouter.get('/acls', (_req, res) => {
  res.json({ acls: listAcls() })
})

usersRouter.post('/acls', (req, res) => {
  const { userId, drive, pathPrefix = '', permission } = req.body ?? {}
  if (!userId || !drive || !permission) return res.status(400).json({ error: 'Missing fields' })
  if (!['read', 'write', 'admin'].includes(permission))
    return res.status(400).json({ error: 'Invalid permission' })
  setAcl(Number(userId), String(drive), String(pathPrefix), permission as Permission)
  res.json({ ok: true })
})

usersRouter.delete('/acls/:id', (req, res) => {
  removeAcl(Number(req.params.id))
  res.json({ ok: true })
})
