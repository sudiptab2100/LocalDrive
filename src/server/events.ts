import { EventEmitter } from 'events'

/** Lightweight app-wide event bus (e.g. drive registry changes). */
export const bus = new EventEmitter()

export const EVENTS = {
  drivesChanged: 'drives-changed',
  registrationsChanged: 'registrations-changed',
  accessRequestsChanged: 'access-requests-changed',
  /** Server status changed (start/stop/restart, or LAN addresses changed). */
  statusChanged: 'status-changed',
  /** App configuration was saved. */
  configChanged: 'config-changed'
} as const
