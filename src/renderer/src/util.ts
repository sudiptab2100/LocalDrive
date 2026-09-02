export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(input: string | number): string {
  const d = typeof input === 'number' ? new Date(input) : new Date(input + 'Z')
  if (isNaN(d.getTime())) return String(input)
  return d.toLocaleString()
}

export function usagePct(total?: number | null, free?: number | null): number {
  if (!total || free == null) return 0
  return Math.min(100, Math.max(0, Math.round(((total - free) / total) * 100)))
}

export function timeAgo(input: string | number): string {
  const d = typeof input === 'number' ? new Date(input) : new Date(input + 'Z')
  const ms = d.getTime()
  if (isNaN(ms)) return String(input)
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return formatDate(input)
}
