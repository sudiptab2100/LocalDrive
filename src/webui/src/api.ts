import type { AuthResult, DriveInfo, FileEntry, ServerStatus, TransferStat, ActivityRecord, User } from '@shared/types'

export interface ListResponse {
  path: string
  entries: FileEntry[]
}

export interface SearchHit {
  drive: string
  name: string
  path: string
  isDir: boolean
}

export interface SearchResponse {
  query: string
  hits: SearchHit[]
}

export interface ConnectInfo {
  urls: string[]
  hostname: string
  qr: string
}

export interface StatsResponse {
  transfers?: TransferStat
  drives?: DriveInfo[]
  server?: ServerStatus
  activity?: ActivityRecord[]
  usersCount?: number
}

export class ApiRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

const jsonHeaders = { 'Content-Type': 'application/json' }

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: init.body ? { ...jsonHeaders, ...(init.headers ?? {}) } : init.headers
  })

  if (!response.ok) {
    let message = response.statusText || 'Request failed'
    try {
      const payload = (await response.json()) as { error?: string }
      message = payload.error || message
    } catch {
      // Keep the HTTP status text when the body is not JSON.
    }
    throw new ApiRequestError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function params(values: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null) search.set(key, String(value))
  })
  return search.toString()
}

export const api = {
  login(username: string, password: string) {
    return request<AuthResult>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  },
  logout() {
    return request<{ ok?: true }>('/api/auth/logout', { method: 'POST' })
  },
  me() {
    return request<{ user: User }>('/api/auth/me')
  },
  drives() {
    return request<{ drives: DriveInfo[] }>('/api/drives')
  },
  list(drive: string, path: string, hidden?: boolean) {
    return request<ListResponse>(`/api/files/list?${params({ drive, path, hidden: hidden ? '1' : undefined })}`)
  },
  mkdir(drive: string, path: string, name: string) {
    return request<{ ok: true }>('/api/files/mkdir', { method: 'POST', body: JSON.stringify({ drive, path, name }) })
  },
  rename(drive: string, path: string, newName: string) {
    return request<{ ok: true }>('/api/files/rename', { method: 'POST', body: JSON.stringify({ drive, path, newName }) })
  },
  move(drive: string, sources: string[], dest: string) {
    return request<{ ok: true }>('/api/files/move', { method: 'POST', body: JSON.stringify({ drive, sources, dest }) })
  },
  copy(drive: string, sources: string[], dest: string) {
    return request<{ ok: true }>('/api/files/copy', { method: 'POST', body: JSON.stringify({ drive, sources, dest }) })
  },
  delete(drive: string, paths: string[]) {
    return request<{ ok: true }>('/api/files/delete', { method: 'POST', body: JSON.stringify({ drive, paths }) })
  },
  search(query: string, drive?: string, hidden?: boolean) {
    return request<SearchResponse>(`/api/search?${params({ q: query, drive, hidden: hidden ? '1' : undefined })}`)
  },
  connect() {
    return request<ConnectInfo>('/api/connect')
  },
  stats() {
    return request<StatsResponse>('/api/stats')
  }
}

export function fileUrl(kind: 'download' | 'raw' | 'thumb', drive: string, path: string, extra?: Record<string, string | number>): string {
  const endpoint = kind === 'download' ? '/api/files/download' : kind === 'raw' ? '/api/files/raw' : '/api/files/thumb'
  return `${endpoint}?${params({ drive, path, ...extra })}`
}

export function zipUrl(drive: string, paths: string[]): string {
  return `/api/files/zip?${params({ drive, paths: paths.join('\n') })}`
}
