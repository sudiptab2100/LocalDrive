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
  const urls = new Set<string>()
  urls.add(`http://${hostname}:${port}`)
  for (const ip of lanAddresses()) urls.add(`http://${ip}:${port}`)
  return [...urls]
}
