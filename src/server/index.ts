import http from 'http'
import { join } from 'path'
import type { Socket } from 'net'
import { createApp, setWebdavHandler } from './http/app.js'
import { loadConfig, localHostname, type AppConfig } from './config.js'
import { getDb, checkpoint, closeDb, logActivity } from './db/index.js'
import { bootstrapAdmin } from './auth.js'
import { backfillHomesAndProvision } from './provisioning.js'
import { syncDrives, listRegisteredDrives, getShareRoot } from './drives/registry.js'
import { buildWebdav } from './webdav.js'
import { startDiscovery, stopDiscovery } from './discovery.js'
import { setStatus, getStatus } from './status.js'
import { buildUrls } from './util/net.js'
import { bus, EVENTS } from './events.js'
import type { ServerStatus } from '../shared/types.js'

export interface ServerManagerOptions {
  webuiDir?: string
}

/**
 * Owns the lifecycle of the embedded HTTP server. Supports graceful stop and
 * restart with no data loss: it stops accepting new connections, drains
 * in-flight requests, checkpoints the database, and tears down cleanly.
 */
export class ServerManager {
  private server: http.Server | null = null
  private sockets = new Set<Socket>()
  private webuiDir: string
  private starting = false
  private pendingBootstrap: { username: string; password: string } | null | undefined

  constructor(opts: ServerManagerOptions = {}) {
    this.webuiDir = opts.webuiDir || join(process.cwd(), 'out', 'webui')
    // Rebuild WebDAV mounts whenever the set of registered drives changes.
    bus.on(EVENTS.drivesChanged, () => {
      if (this.server) this.rebuildWebdav().catch(() => {})
    })
  }

  isRunning(): boolean {
    return this.server != null
  }

  getStatus(): ServerStatus {
    return getStatus()
  }

  /** First-run admin bootstrap; returns temp credentials if created.
   * Cached so both the main process and the renderer can read the one-time
   * credentials within a single app run. */
  bootstrap(): { username: string; password: string } | null {
    getDb()
    if (this.pendingBootstrap === undefined) {
      this.pendingBootstrap = bootstrapAdmin()
    }
    return this.pendingBootstrap
  }

  async rebuildWebdav(): Promise<void> {
    const registered = await listRegisteredDrives()
    const mounts: { uuid: string; label: string; shareRoot: string }[] = []
    for (const d of registered) {
      if (!d.online) continue
      try {
        mounts.push({ uuid: d.uuid, label: d.label, shareRoot: await getShareRoot(d.uuid) })
      } catch {
        /* offline / unavailable */
      }
    }
    setWebdavHandler(buildWebdav(mounts))
  }

  async start(): Promise<ServerStatus> {
    if (this.server || this.starting) return getStatus()
    this.starting = true
    try {
      const config: AppConfig = loadConfig()
      getDb() // ensure DB + schema
      await syncDrives()
      await backfillHomesAndProvision()
      await this.rebuildWebdav()

      const app = createApp({ webuiDir: this.webuiDir })
      const server = http.createServer(app)

      server.on('connection', (socket) => {
        this.sockets.add(socket)
        socket.on('close', () => this.sockets.delete(socket))
      })

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, () => {
          server.removeListener('error', reject)
          resolve()
        })
      })

      this.server = server
      const hostname = localHostname()
      startDiscovery(config.port)
      setStatus({
        running: true,
        port: config.port,
        host: config.host,
        hostname,
        urls: buildUrls(config.port, hostname),
        startedAt: new Date().toISOString(),
        activeConnections: 0
      })
      logActivity('server_start', { detail: `port ${config.port}` })
      return getStatus()
    } finally {
      this.starting = false
    }
  }

  /** Graceful shutdown. Waits up to `drainMs` for in-flight requests. */
  async stop(drainMs = 8000): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    stopDiscovery()

    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      server.close(() => done())
      // Give active requests time to finish, then force-close lingering sockets.
      const timer = setTimeout(() => {
        for (const s of this.sockets) s.destroy()
        this.sockets.clear()
        done()
      }, drainMs)
      timer.unref?.()
    })

    // Persist everything so a restart loses nothing.
    checkpoint()
    setStatus({ running: false, urls: [], startedAt: null, activeConnections: 0 })
    logActivity('server_stop', {})
  }

  async restart(): Promise<ServerStatus> {
    await this.stop()
    return this.start()
  }

  /** Final cleanup on app quit. */
  async shutdown(): Promise<void> {
    await this.stop(3000)
    closeDb()
  }
}

let manager: ServerManager | null = null

export function getServerManager(opts?: ServerManagerOptions): ServerManager {
  if (!manager) manager = new ServerManager(opts)
  return manager
}
