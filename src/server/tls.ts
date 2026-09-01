import forge from 'node-forge'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { getPaths, localHostname } from './config.js'
import { lanAddresses } from './util/net.js'
import { hostname } from 'os'

/**
 * Self-signed TLS material for the optional HTTPS listener.
 *
 * Uses a small **local certificate authority** (mkcert-style): a long-lived root
 * CA is generated once, then a short-lived leaf server certificate is issued and
 * signed by it. Clients install the *root CA* a single time to get a trusted
 * padlock everywhere; the leaf can then be re-issued freely whenever the LAN IP
 * changes (SubjectAltNames drift) without any device having to re-trust anything.
 *
 * Everything is persisted under `<configDir>/tls/` so it survives restarts.
 */

const CA_CN = 'LocalDrive Local CA'
const LEAF_CN = 'LocalDrive'
const CA_DAYS = 3650 // ~10 years
const LEAF_DAYS = 397 // Safari/iOS reject longer server (leaf) certificates
const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // reissue when <30 days remain

export interface TlsMaterial {
  /** Leaf private key (PEM). */
  key: string
  /** Leaf certificate (PEM). */
  cert: string
  /** Root CA certificate (PEM), supplied as the chain. */
  ca: string
}

interface TlsPaths {
  dir: string
  caCert: string
  caKey: string
  leafCert: string
  leafKey: string
  meta: string
}

interface LeafMeta {
  sans: string[]
  notAfter: string
}

function tlsPaths(): TlsPaths {
  const dir = join(getPaths().configDir, 'tls')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return {
    dir,
    caCert: join(dir, 'ca.crt'),
    caKey: join(dir, 'ca.key'),
    leafCert: join(dir, 'server.crt'),
    leafKey: join(dir, 'server.key'),
    meta: join(dir, 'leaf.json')
  }
}

/** Positive random serial number as a hex string (avoids negative DER integers). */
function randomSerial(): string {
  return '00' + forge.util.bytesToHex(forge.random.getBytesSync(16))
}

interface SanEntry {
  /** node-forge altName type: 2 = DNS, 7 = IP. */
  type: number
  value?: string
  ip?: string
}

/**
 * Current SubjectAltName set: loopback + every LAN IPv4, plus localhost, the
 * bare hostname and the `.local` mDNS name so the cert is valid however a client
 * reaches the server.
 */
function currentSans(): { altNames: SanEntry[]; canonical: string[] } {
  const dns = new Set<string>(['localhost'])
  const bare = hostname().replace(/\.local$/, '').replace(/\.lan$/, '')
  if (bare) dns.add(bare)
  dns.add(localHostname())

  const ips = new Set<string>(['127.0.0.1', '::1'])
  for (const ip of lanAddresses()) ips.add(ip)

  const altNames: SanEntry[] = []
  const canonical: string[] = []
  for (const d of dns) {
    altNames.push({ type: 2, value: d })
    canonical.push(`DNS:${d}`)
  }
  for (const ip of ips) {
    altNames.push({ type: 7, ip })
    canonical.push(`IP:${ip}`)
  }
  canonical.sort()
  return { altNames, canonical }
}

interface CertKey {
  certPem: string
  keyPem: string
  cert: forge.pki.Certificate
  key: forge.pki.rsa.PrivateKey
}

function subjectAttrs(cn: string): forge.pki.CertificateField[] {
  return [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'LocalDrive' }
  ]
}

function writePrivate(path: string, pem: string): void {
  writeFileSync(path, pem, { encoding: 'utf8', mode: 0o600 })
}

/** Generate a fresh self-signed root CA. */
function generateCA(): CertKey {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  const now = new Date()
  cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  cert.validity.notAfter = new Date(now.getTime() + CA_DAYS * 24 * 60 * 60 * 1000)
  const attrs = subjectAttrs(CA_CN)
  cert.setSubject(attrs)
  cert.setIssuer(attrs) // self-signed
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    cert,
    key: keys.privateKey,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey)
  }
}

/** Load the persisted CA, or generate and persist a new one. */
function ensureCA(): CertKey {
  const p = tlsPaths()
  if (existsSync(p.caCert) && existsSync(p.caKey)) {
    const certPem = readFileSync(p.caCert, 'utf8')
    const keyPem = readFileSync(p.caKey, 'utf8')
    return {
      certPem,
      keyPem,
      cert: forge.pki.certificateFromPem(certPem),
      key: forge.pki.privateKeyFromPem(keyPem)
    }
  }
  const ca = generateCA()
  writeFileSync(p.caCert, ca.certPem, 'utf8')
  writePrivate(p.caKey, ca.keyPem)
  return ca
}

/** Issue a new leaf certificate signed by the CA, valid for the given SANs. */
function issueLeaf(ca: CertKey, altNames: SanEntry[]): { certPem: string; keyPem: string; notAfter: Date } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  const now = new Date()
  cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const notAfter = new Date(now.getTime() + LEAF_DAYS * 24 * 60 * 60 * 1000)
  cert.validity.notAfter = notAfter
  cert.setSubject(subjectAttrs(LEAF_CN))
  cert.setIssuer(ca.cert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' }
  ])
  cert.sign(ca.key, forge.md.sha256.create())
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    notAfter
  }
}

function readMeta(path: string): LeafMeta | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LeafMeta
  } catch {
    return null
  }
}

/**
 * Ensure a valid leaf certificate exists for the current network identity,
 * reissuing it when it is missing, its SANs drifted (IP change), or it is near
 * expiry. The CA is untouched, so reissuing never requires a client re-trust.
 */
function ensureLeaf(ca: CertKey): { certPem: string; keyPem: string } {
  const p = tlsPaths()
  const { altNames, canonical } = currentSans()
  const meta = readMeta(p.meta)
  const filesPresent = existsSync(p.leafCert) && existsSync(p.leafKey)
  const sansMatch = meta != null && JSON.stringify(meta.sans) === JSON.stringify(canonical)
  const fresh =
    meta != null && new Date(meta.notAfter).getTime() - Date.now() > RENEW_WINDOW_MS

  if (filesPresent && sansMatch && fresh) {
    return { certPem: readFileSync(p.leafCert, 'utf8'), keyPem: readFileSync(p.leafKey, 'utf8') }
  }

  const leaf = issueLeaf(ca, altNames)
  writeFileSync(p.leafCert, leaf.certPem, 'utf8')
  writePrivate(p.leafKey, leaf.keyPem)
  writeFileSync(p.meta, JSON.stringify({ sans: canonical, notAfter: leaf.notAfter.toISOString() }, null, 2), 'utf8')
  return { certPem: leaf.certPem, keyPem: leaf.keyPem }
}

/**
 * Load HTTPS key material, generating the CA and/or leaf certificate as needed.
 * Returns the leaf key + cert and the CA cert (as the chain).
 */
export function loadTlsMaterial(): TlsMaterial {
  const ca = ensureCA()
  const leaf = ensureLeaf(ca)
  return { key: leaf.keyPem, cert: leaf.certPem, ca: ca.certPem }
}

/**
 * The root CA certificate PEM for client installation, or null if it has not
 * been generated yet (HTTPS never enabled). Never generates on read.
 */
export function getCaCertPem(): string | null {
  const p = tlsPaths()
  if (!existsSync(p.caCert)) return null
  try {
    return readFileSync(p.caCert, 'utf8')
  } catch {
    return null
  }
}

/** Absolute path to the root CA certificate file (for "reveal in Finder"). */
export function getCaCertPath(): string {
  return tlsPaths().caCert
}
