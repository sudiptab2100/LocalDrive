import express, { type Express, type RequestHandler } from 'express'
import { existsSync } from 'fs'
import { join } from 'path'
import { attachUser, requireAuth } from './middleware.js'
import { authRouter } from './routes/auth.js'
import { drivesRouter } from './routes/drives.js'
import { filesRouter } from './routes/files.js'
import { uploadRouter } from './routes/uploads.js'
import { searchRouter } from './routes/search.js'
import { statsRouter } from './routes/stats.js'
import { usersRouter } from './routes/users.js'
import { getStatus } from '../status.js'
import { qrDataUrl } from '../discovery.js'
import { pickQrUrl } from '../util/net.js'

/** Holder allowing the WebDAV handler to be swapped when drives change. */
let webdavHandler: RequestHandler | null = null
export function setWebdavHandler(h: RequestHandler | null): void {
  webdavHandler = h
}

export interface AppOptions {
  webuiDir?: string
}

export function createApp(opts: AppOptions = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)

  // Identify the user early (cookie / bearer / basic) for all routes.
  app.use(attachUser)

  // Raw-body routes must come before the JSON parser.
  app.use('/api/upload', uploadRouter)
  // WebDAV must see the full `/dav/...` URL, so mount at root and gate by prefix.
  app.use((req, res, next) => {
    if (!req.path.startsWith('/dav')) return next()
    if (webdavHandler) return webdavHandler(req, res, next)
    res.status(503).json({ error: 'WebDAV not available (no registered drives)' })
  })

  app.use(express.json({ limit: '5mb' }))

  // Health check (unauthenticated).
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, status: getStatus() })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/drives', drivesRouter)
  app.use('/api/files', filesRouter)
  app.use('/api/search', searchRouter)
  app.use('/api/stats', statsRouter)
  app.use('/api/users', usersRouter)

  // Connection info + QR code for easy device onboarding.
  app.get('/api/connect', requireAuth, async (_req, res) => {
    const status = getStatus()
    const primary = pickQrUrl(status.urls, status.port)
    res.json({ urls: status.urls, hostname: status.hostname, qr: await qrDataUrl(primary) })
  })

  // Serve the client PWA and fall back to index.html for client-side routing.
  const webuiDir = opts.webuiDir
  if (webuiDir && existsSync(webuiDir)) {
    app.use(express.static(webuiDir))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/dav')) return next()
      const index = join(webuiDir, 'index.html')
      if (existsSync(index)) return res.sendFile(index)
      next()
    })
  } else {
    app.get('/', (_req, res) => {
      res.type('html').send(
        '<h1>LocalDrive server is running</h1><p>The web UI has not been built yet. Run <code>npm run build:webui</code>.</p>'
      )
    })
  }

  // JSON error handler.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message || 'Internal error' })
  })

  return app
}
