import { EventEmitter } from 'events'

/** Lightweight app-wide event bus (e.g. drive registry changes). */
export const bus = new EventEmitter()

export const EVENTS = {
  drivesChanged: 'drives-changed',
  registrationsChanged: 'registrations-changed',
  accessRequestsChanged: 'access-requests-changed'
} as const
