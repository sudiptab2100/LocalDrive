import { Router } from 'express'
import {
  authenticate,
  signToken,
  bootstrapAdmin,
  createUser,
  createPendingUser,
  getUserByName
} from '../../auth.js'
import { provisionUserHome } from '../../provisioning.js'
import { loadConfig } from '../../config.js'
import { sanitizeHomeName } from '../../util/fs-safe.js'
import { bus, EVENTS } from '../../events.js'
import { logActivity } from '../../db/index.js'
import { AUTH_COOKIE, requireAuth } from '../middleware.js'

export const authRouter = Router()

const COOKIE_OPTS = (secure: boolean) =>
  ({
    httpOnly: true,
    sameSite: 'lax' as const,
    // Only mark Secure on TLS requests so HTTP logins keep working in dual mode.
    secure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }) as const

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' })
    return
  }
  const user = authenticate(String(username), String(password))
  if (!user) {
    logActivity('login_failed', { username: String(username), ip: req.ip })
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }
  if (user.status === 'pending') {
    logActivity('login_pending', { userId: user.id, username: user.username, ip: req.ip })
    res.status(403).json({ error: 'Your account is awaiting admin approval.', pending: true })
    return
  }
  const token = signToken(user)
  res.cookie(AUTH_COOKIE, token, COOKIE_OPTS(req.secure))
  logActivity('login', { userId: user.id, username: user.username, ip: req.ip })
  res.json({ token, user })
})

// Public registration flow config, so the login screen can show/hide sign-up.
authRouter.get('/config', (_req, res) => {
  const cfg = loadConfig()
  res.json({ registrationEnabled: cfg.registrationEnabled })
})

// Self-registration. Creates a pending account (or an active one when
// auto-approve is enabled, in which case the user is signed in immediately).
authRouter.post('/register', async (req, res) => {
  const cfg = loadConfig()
  if (!cfg.registrationEnabled) {
    res.status(403).json({ error: 'Registrations are currently closed.' })
    return
  }
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' })
    return
  }
  if (username.length < 3) {
    res.status(400).json({ error: 'Username must be at least 3 characters' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' })
    return
  }
  if (!sanitizeHomeName(username)) {
    res.status(400).json({ error: 'Username must contain letters or numbers' })
    return
  }
  // Case-insensitive duplicate check (matches active or pending accounts).
  if (getUserByName(username)) {
    res.status(409).json({ error: 'That username is already taken' })
    return
  }

  if (cfg.autoApproveRegistrations) {
    const user = createUser(username, password, 'user', 'active')
    await provisionUserHome(user)
    const token = signToken(user)
    res.cookie(AUTH_COOKIE, token, COOKIE_OPTS(req.secure))
    logActivity('register', {
      userId: user.id,
      username: user.username,
      ip: req.ip,
      detail: 'auto-approved'
    })
    bus.emit(EVENTS.registrationsChanged, { pending: false, username: user.username })
    res.json({ pending: false, token, user })
    return
  }

  const user = createPendingUser(username, password)
  logActivity('register_pending', { userId: user.id, username: user.username, ip: req.ip })
  bus.emit(EVENTS.registrationsChanged, { pending: true, username: user.username })
  res.json({ pending: true, message: 'Your account is awaiting admin approval.' })
})

authRouter.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' })
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

// Surface the first-run admin credentials once, for the desktop app to show.
authRouter.get('/bootstrap', (_req, res) => {
  const created = bootstrapAdmin()
  res.json({ created })
})
