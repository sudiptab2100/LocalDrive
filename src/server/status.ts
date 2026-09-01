import type { ServerStatus } from '../shared/types.js'

/** Live server status, updated by the server manager and read by API routes. */
let status: ServerStatus = {
  running: false,
  port: 0,
  host: '0.0.0.0',
  hostname: '',
  urls: [],
  startedAt: null,
  activeConnections: 0,
  https: false,
  httpsPort: 0
}

export function setStatus(patch: Partial<ServerStatus>): void {
  status = { ...status, ...patch }
}

export function getStatus(): ServerStatus {
  return status
}
