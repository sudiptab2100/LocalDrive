import type {
  DriveInfo,
  ServerStatus,
  Role,
  Permission,
  AccessRequest
} from '@shared/types'
import type {
  LocalDriveApi,
  UserWithAcls,
  DashboardData,
  ConnectInfo,
  AppConfigView
} from '@shared/ipc'

/**
 * HTTP-backed implementation of `LocalDriveApi` for the admin web control panel.
 * It exposes the exact same surface as the desktop preload bridge (`window.ld`),
 * so the shared renderer UI (`src/renderer/src`) runs unchanged in the browser.
 * Every call maps to an admin-only endpoint on the same origin; the `ld_token`
 * cookie authenticates automatically. Live updates arrive over SSE.
 */

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) ||
      `Request failed (${res.status})`
    throw new Error(String(msg))
  }
  return data as T
}

// ---- SSE hub --------------------------------------------------------------
type Listener = (data: unknown) => void
const channels: Record<string, Set<Listener>> = {
  statusChanged: new Set(),
  drivesChanged: new Set(),
  registrationsChanged: new Set(),
  accessRequestsChanged: new Set(),
  configChanged: new Set()
}
let source: EventSource | null = null

function ensureSource(): void {
  if (source) return
  source = new EventSource('/api/events', { withCredentials: true })
  for (const name of Object.keys(channels)) {
    source.addEventListener(name, (e: MessageEvent) => {
      let payload: unknown = {}
      try {
        payload = e.data ? JSON.parse(e.data) : {}
      } catch {
        payload = {}
      }
      channels[name].forEach((cb) => cb(payload))
    })
  }
}

function subscribe(channel: keyof typeof channels, cb: Listener): () => void {
  ensureSource()
  channels[channel].add(cb)
  return () => channels[channel].delete(cb)
}

/** Announce that the server has moved/stopped so the shell can prompt to reconnect. */
function notifyReconnect(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent('ld:reconnect', { detail }))
}

/** Best-effort URL to reach the panel after a port/HTTPS change, from this client. */
function reconnectUrl(cfg: AppConfigView): string {
  const secure = cfg.httpsEnabled
  const scheme = secure ? 'https' : window.location.protocol.replace(':', '')
  const port = secure ? cfg.httpsPort : cfg.port
  return `${scheme}://${window.location.hostname}:${port}/admin/`
}

export const httpApi: LocalDriveApi = {
  server: {
    status: async () => (await req<{ ok: boolean; status: ServerStatus }>('GET', '/api/health')).status,
    start: async () => (await req<{ status: ServerStatus }>('POST', '/api/server/start')).status,
    stop: async () => {
      const r = await req<{ status: ServerStatus }>('POST', '/api/server/stop')
      notifyReconnect({ stopped: true })
      return r.status
    },
    restart: async () => {
      const r = await req<{ status: ServerStatus }>('POST', '/api/server/restart')
      notifyReconnect({ url: window.location.href })
      return r.status
    },
    bootstrap: async () => null,
    onStatus: (cb) => subscribe('statusChanged', (d) => cb(d as ServerStatus))
  },
  drives: {
    listAll: async () => (await req<{ drives: DriveInfo[] }>('GET', '/api/drives/all')).drives,
    register: async (uuid: string) => {
      await req('POST', '/api/drives/register', { uuid })
      return (await req<{ drives: DriveInfo[] }>('GET', '/api/drives/all')).drives
    },
    addFolder: async (path?: string) => {
      if (!path || !path.trim()) throw new Error('Enter an absolute folder path to share')
      await req('POST', '/api/drives/register-folder', { path: path.trim() })
      return (await req<{ drives: DriveInfo[] }>('GET', '/api/drives/all')).drives
    },
    unregister: async (uuid: string) => {
      await req('POST', '/api/drives/unregister', { uuid })
      return (await req<{ drives: DriveInfo[] }>('GET', '/api/drives/all')).drives
    },
    reveal: async () => {
      /* No Finder in a browser — the desktop-only affordance is hidden in web. */
    },
    onChange: (cb) => subscribe('drivesChanged', () => cb())
  },
  users: {
    list: async () => (await req<{ users: UserWithAcls[] }>('GET', '/api/users')).users,
    create: async (username: string, password: string, role: Role) =>
      (await req<{ user: UserWithAcls }>('POST', '/api/users', { username, password, role })).user,
    remove: async (id: number) => {
      await req('DELETE', `/api/users/${id}`)
    },
    approve: async (id: number) =>
      (await req<{ user: UserWithAcls }>('POST', `/api/users/${id}/approve`)).user,
    setPassword: async (id: number, password: string) => {
      await req('POST', `/api/users/${id}/password`, { password })
    },
    setRole: async (id: number, role: Role) => {
      await req('POST', `/api/users/${id}/role`, { role })
    },
    setAcl: async (userId: number, drive: string, pathPrefix: string, permission: Permission) => {
      await req('POST', '/api/users/acls', { userId, drive, pathPrefix, permission })
    },
    removeAcl: async (id: number) => {
      await req('DELETE', `/api/users/acls/${id}`)
    },
    onRegistrationsChanged: (cb) =>
      subscribe('registrationsChanged', (d) => cb(d as { pending: boolean; username: string }))
  },
  access: {
    list: async () => (await req<{ requests: AccessRequest[] }>('GET', '/api/access')).requests,
    approve: async (id: number) => {
      await req('POST', `/api/access/${id}/approve`)
    },
    deny: async (id: number) => {
      await req('POST', `/api/access/${id}/deny`)
    },
    onChange: (cb) =>
      subscribe('accessRequestsChanged', (d) =>
        cb(d as { pending: boolean; username: string; drive?: string })
      )
  },
  dashboard: async () => req<DashboardData>('GET', '/api/stats'),
  connect: async () => req<ConnectInfo>('GET', '/api/connect'),
  config: {
    get: async () => req<AppConfigView>('GET', '/api/config'),
    set: async (patch) => {
      const r = await req<{ config: AppConfigView; restarted: boolean }>(
        'PATCH',
        '/api/config',
        patch
      )
      if (r.restarted) notifyReconnect({ url: reconnectUrl(r.config) })
      return r.config
    }
  },
  revealCert: async () => {
    /* Desktop-only (reveal in Finder). The web panel offers Download instead. */
  },
  openExternal: async (url: string) => {
    window.open(url, '_blank', 'noopener')
  },
  platform: 'web'
}
