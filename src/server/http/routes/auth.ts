import { Router } from 'express'
import { authenticate, signToken, bootstrapAdmin } from '../../auth.js'
import { logActivity } from '../../db/index.js'
import { AUTH_COOKIE, requireAuth } from '../middleware.js'

export const authRouter = Router()

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
  const token = signToken(user)
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Only mark Secure on TLS requests so HTTP logins keep working in dual mode.
    secure: req.secure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  })
  logActivity('login', { userId: user.id, username: user.username, ip: req.ip })
  res.json({ token, user })
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
