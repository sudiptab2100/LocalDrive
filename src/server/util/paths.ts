import { normalizeApiPath } from './fs-safe.js'

/** Parent directory of an API path. `a/b/c` -> `a/b`, `a` -> ``. */
export function parentOf(path: string): string {
  const norm = normalizeApiPath(path)
  const idx = norm.lastIndexOf('/')
  return idx === -1 ? '' : norm.slice(0, idx)
}

/** Final path segment. `a/b/c` -> `c`. */
export function baseName(path: string): string {
  const norm = normalizeApiPath(path)
  const idx = norm.lastIndexOf('/')
  return idx === -1 ? norm : norm.slice(idx + 1)
}
