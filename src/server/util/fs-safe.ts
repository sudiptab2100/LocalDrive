import { resolve, sep, normalize } from 'path'

/** Convert any path to POSIX separators for consistent API paths. */
export function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/**
 * Safely join a user-supplied relative path onto a trusted root, guaranteeing
 * the result stays inside the root (prevents `../` path traversal).
 * Returns the absolute resolved path, or null if it would escape.
 */
export function safeResolve(root: string, relPath: string): string | null {
  const cleaned = normalize(relPath || '').replace(/^([/\\])+/, '')
  const abs = resolve(root, cleaned)
  const rootResolved = resolve(root)
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
    return null
  }
  return abs
}

/** Reject file/folder names that could escape or break the filesystem. */
export function isSafeName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false
  return true
}

/** Normalise an API path to a leading-slash-free POSIX path. */
export function normalizeApiPath(p: string): string {
  return toPosix(normalize('/' + (p || '')))
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/** Windows/FAT reserved device names that can't be used as folder names. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
])

/**
 * Derive a filesystem-safe folder name for a user's private home directory from
 * their username. Lowercased, ASCII-folded, and stripped of characters that
 * FAT/exFAT or Windows reject. Always returns a non-empty, non-reserved name.
 */
export function sanitizeHomeName(username: string): string {
  let base = (username || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
  if (!base) base = 'user'
  if (RESERVED_NAMES.has(base)) base = 'user-' + base
  return base.slice(0, 48).replace(/[-_.]+$/, '') || 'user'
}

/**
 * Translate a client-supplied, home-relative path into a full drive-relative
 * path by prefixing the user's home folder. Returns null if the result would
 * escape the home (path traversal). `home === ''` means no confinement (admin).
 */
export function scopeIn(home: string, clientPath: string): string | null {
  const full = normalizeApiPath((home ? home + '/' : '') + (clientPath || ''))
  if (!home) return full
  if (full !== home && !full.startsWith(home + '/')) return null
  return full
}

/**
 * Strip the user's home prefix from a full drive-relative path so the client
 * only ever sees paths relative to its private root. `home === ''` is identity.
 */
export function scopeOut(home: string, fullPath: string): string {
  const p = normalizeApiPath(fullPath)
  if (!home) return p
  if (p === home) return ''
  if (p.startsWith(home + '/')) return p.slice(home.length + 1)
  return p
}
