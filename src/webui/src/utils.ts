import type { FileEntry } from '@shared/types'

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

export function parentPath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, '')
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '' : normalized.slice(0, index)
}

export function joinPath(base: string, name: string): string {
  const cleanBase = base.replace(/^\/+|\/+$/g, '')
  const cleanName = name.replace(/^\/+|\/+$/g, '')
  return cleanBase ? `${cleanBase}/${cleanName}` : cleanName
}

export function iconFor(entry: Pick<FileEntry, 'isDir' | 'mime' | 'name'>): string {
  if (entry.isDir) return '📁'
  const mime = entry.mime ?? ''
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎞️'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime === 'application/pdf' || ext === 'pdf') return '📕'
  if (isTextLike(entry)) return '📄'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️'
  return '📦'
}

export function isTextLike(entry: Pick<FileEntry, 'mime' | 'name'>): boolean {
  const mime = entry.mime ?? ''
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  return mime.startsWith('text/') || [
    'txt', 'md', 'json', 'csv', 'log', 'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'yml', 'yaml', 'toml', 'ini', 'env', 'sh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sql'
  ].includes(ext)
}
