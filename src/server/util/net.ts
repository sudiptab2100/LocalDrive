import { networkInterfaces } from 'os'

/** All non-internal IPv4 addresses (the LAN IPs clients can connect to). */
export function lanAddresses(): string[] {
  const nets = networkInterfaces()
  const out: string[] = []
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}

export function buildUrls(port: number, hostname: string): string[] {
  const isPrivate = (ip: string): boolean =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  // Prefer common private-LAN IPs (the WiFi address) over VPN/other interfaces.
  const ips = lanAddresses().sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)))
  const urls = new Set<string>()
  // IP URLs come first: they work on every client (including Android, which
  // often cannot resolve mDNS) and never change on Bonjour name collisions.
  for (const ip of ips) urls.add(`http://${ip}:${port}`)
  // The "<name>.local" mDNS hostname is convenient on Apple/most modern OSes but
  // needs Bonjour and its numeric suffix can drift, so it is listed last.
  urls.add(`http://${hostname}:${port}`)
  return [...urls]
}

/** Most broadly-compatible URL for a QR code: prefer a LAN IP over the .local name. */
export function pickQrUrl(urls: string[], port: number): string {
  return (
    urls.find((u) => /:\/\/\d{1,3}(?:\.\d{1,3}){3}:/.test(u)) ||
    urls[0] ||
    `http://localhost:${port}`
  )
}
