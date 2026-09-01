import { useEffect, useMemo, useState } from 'react'
import type { DriveInfo, Role } from '@shared/types'
import type { DashboardData, ConnectInfo, UserWithAcls, AppConfigView } from '@shared/ipc'
import { formatBytes, formatDate, usagePct } from './util'

const ld = () => window.ld

/** Short badge/label for why a drive can't be shared. */
function unshareableLabel(reason: DriveInfo['unshareableReason']): string | null {
  if (reason === 'system') return 'System'
  if (reason === 'diskimage') return 'Disk image'
  if (reason === 'readonly') return 'Read-only'
  return null
}

// ---------------------------------------------------------------- Drives ---
export function DrivesPanel({
  drives,
  onChange
}: {
  drives: DriveInfo[]
  onChange: () => void
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [showUnshareable, setShowUnshareable] = useState<boolean>(
    () => localStorage.getItem('ld.showUnshareable') === '1'
  )

  useEffect(() => {
    localStorage.setItem('ld.showUnshareable', showUnshareable ? '1' : '0')
  }, [showUnshareable])

  const act = async (fn: () => Promise<unknown>, uuid: string): Promise<void> => {
    setBusy(uuid)
    try {
      await fn()
      onChange()
    } finally {
      setBusy(null)
    }
  }

  // A drive can be shared only if it's online and shareable — read-only mounts,
  // the macOS system/startup volume, and disk-image mounts can't host a share.
  const canShare = (d: DriveInfo): boolean => d.online && d.shareable !== false

  const sorted = useMemo(
    () => [...drives].sort((a, b) => Number(b.external) - Number(a.external)),
    [drives]
  )
  // Registered drives always show (already shared, even if offline); otherwise
  // hide drives that can't be shared unless the user opts to reveal them.
  const visible = useMemo(
    () => sorted.filter((d) => showUnshareable || d.registered || canShare(d)),
    [sorted, showUnshareable]
  )
  const hiddenCount = sorted.length - visible.length

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Storage Drives</h2>
        <p className="muted">
          Register an external USB/HDD/SSD to share it on your network, or share any folder on this
          Mac. Registered drives are reattached automatically by their unique ID after unplug/replug
          or restart.
        </p>
        <div className="drive-actions">
          <button
            className="btn primary"
            disabled={busy === '__add__'}
            onClick={() => act(() => ld().drives.addFolder(), '__add__')}
          >
            + Share a folder…
          </button>
          <label
            className="small muted"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={showUnshareable}
              onChange={(e) => setShowUnshareable(e.target.checked)}
            />
            Show drives that can’t be shared
          </label>
          {hiddenCount > 0 && !showUnshareable && (
            <span className="small muted">
              {hiddenCount} hidden (can’t be shared or offline)
            </span>
          )}
        </div>
      </div>
      {visible.length === 0 && (
        <div className="empty">
          {sorted.length === 0
            ? 'No drives detected. Plug one in, or “Share a folder…” to use any folder.'
            : 'No shareable drives right now. Tick “Show drives that can’t be shared” to see every detected volume.'}
        </div>
      )}
      <div className="drive-grid">
        {visible.map((d) => (
          <div className={`drive-card ${d.registered ? 'registered' : ''}`} key={d.uuid}>
            <div className="drive-top">
              <div className="drive-name" title={d.uuid}>
                {d.label}
              </div>
              <div className="badges">
                {d.custom ? (
                  <span className="badge">Folder</span>
                ) : d.external ? (
                  <span className="badge">External</span>
                ) : (
                  <span className="badge muted">Internal</span>
                )}
                {(() => {
                  const label = unshareableLabel(d.unshareableReason)
                  return label ? <span className="badge off">{label}</span> : null
                })()}
                <span className={`badge ${d.online ? 'ok' : 'off'}`}>{d.online ? 'Online' : 'Offline'}</span>
              </div>
            </div>
            <div className="muted small">{d.mountPath || 'not mounted'}</div>
            <div className="usage">
              <div className="usage-bar">
                <span style={{ width: `${usagePct(d.totalBytes, d.freeBytes)}%` }} />
              </div>
              <div className="small muted">
                {formatBytes(d.totalBytes && d.freeBytes != null ? d.totalBytes - d.freeBytes : null)} used ·{' '}
                {formatBytes(d.freeBytes)} free · {formatBytes(d.totalBytes)} total
              </div>
            </div>
            <div className="drive-actions">
              {d.registered ? (
                <button
                  className="btn danger"
                  disabled={busy === d.uuid}
                  onClick={() => act(() => ld().drives.unregister(d.uuid), d.uuid)}
                >
                  {d.custom ? 'Remove' : 'Unshare'}
                </button>
              ) : (
                <button
                  className="btn primary"
                  disabled={busy === d.uuid || !canShare(d)}
                  title={
                    !d.online
                      ? 'Drive is offline'
                      : d.shareable === false
                        ? `Can’t be shared — ${unshareableLabel(d.unshareableReason) ?? 'unavailable'}`
                        : undefined
                  }
                  onClick={() => act(() => ld().drives.register(d.uuid), d.uuid)}
                >
                  Share this drive
                </button>
              )}
              <button className="btn" disabled={!d.online} onClick={() => ld().drives.reveal(d.uuid)}>
                Reveal
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- Dashboard ---
export function DashboardPanel(): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const d = await ld().dashboard()
      if (alive) setData(d)
    }
    load()
    const t = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!data) return <div className="panel"><div className="empty">Loading…</div></div>

  return (
    <div className="panel">
      <div className="stat-row">
        <Stat label="Uploads" value={String(data.transfers.uploads)} />
        <Stat label="Downloads" value={String(data.transfers.downloads)} />
        <Stat label="Received" value={formatBytes(data.transfers.bytesIn)} />
        <Stat label="Sent" value={formatBytes(data.transfers.bytesOut)} />
        <Stat label="Users" value={String(data.usersCount)} />
      </div>

      <h3>Shared drives</h3>
      {data.drives.length === 0 && <div className="empty">No shared drives yet.</div>}
      {data.drives.map((d) => (
        <div className="usage" key={d.uuid}>
          <div className="row-between">
            <strong>{d.label}</strong>
            <span className="small muted">{formatBytes(d.freeBytes)} free of {formatBytes(d.totalBytes)}</span>
          </div>
          <div className="usage-bar">
            <span style={{ width: `${usagePct(d.totalBytes, d.freeBytes)}%` }} />
          </div>
        </div>
      ))}

      <h3>Recent activity</h3>
      <div className="activity">
        {data.activity.length === 0 && <div className="empty">No activity yet.</div>}
        {data.activity.map((a) => (
          <div className="activity-row" key={a.id}>
            <span className="tag">{a.action}</span>
            <span className="muted small">{a.username || '—'}</span>
            <span className="grow small">{a.detail || ''}</span>
            <span className="muted small">{formatDate(a.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

// ------------------------------------------------------------------ Users --
export function UsersPanel(): JSX.Element {
  const [users, setUsers] = useState<UserWithAcls[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [error, setError] = useState('')

  const load = async (): Promise<void> => setUsers(await ld().users.list())
  useEffect(() => {
    load()
  }, [])

  const create = async (): Promise<void> => {
    setError('')
    if (!username || !password) return setError('Username and password required')
    try {
      await ld().users.create(username.trim(), password, role)
      setUsername('')
      setPassword('')
      setRole('user')
      load()
    } catch (e) {
      setError((e as Error).message || 'Could not create user')
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Users</h2>
        <p className="muted">
          Create accounts. Each user automatically gets a private folder named after them on every
          shared drive, and can only see inside their own folder. Admins can access everything.
        </p>
      </div>

      <div className="card">
        <h3>Add user</h3>
        <div className="form-row">
          <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn primary" onClick={create}>
            Add
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      {users.map((u) => (
        <UserRow key={u.id} user={u} onChange={load} />
      ))}
    </div>
  )
}

function UserRow({
  user,
  onChange
}: {
  user: UserWithAcls
  onChange: () => void
}): JSX.Element {
  return (
    <div className="card">
      <div className="row-between">
        <div>
          <strong>{user.username}</strong> <span className="tag">{user.role}</span>
          {user.role !== 'admin' && user.home && (
            <div className="small muted">Private home: LocalDrive/{user.home}/ on every shared drive</div>
          )}
        </div>
        <div className="row-gap">
          <button
            className="btn"
            onClick={async () => {
              const pw = prompt(`New password for ${user.username}`)
              if (pw) await ld().users.setPassword(user.id, pw)
            }}
          >
            Set password
          </button>
          <button
            className="btn"
            onClick={async () => {
              await ld().users.setRole(user.id, user.role === 'admin' ? 'user' : 'admin')
              onChange()
            }}
          >
            Make {user.role === 'admin' ? 'user' : 'admin'}
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              if (confirm(`Delete ${user.username}?`)) {
                await ld().users.remove(user.id)
                onChange()
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Connect ---
export function ConnectPanel(): JSX.Element {
  const [info, setInfo] = useState<ConnectInfo | null>(null)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    ld().connect().then(setInfo)
  }, [])

  if (!info) return <div className="panel"><div className="empty">Start the server to get a connection link.</div></div>

  const copy = (url: string): void => {
    navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Connect a device</h2>
        <p className="muted">Scan the QR code on your phone, or open a link in any browser on the same WiFi.</p>
      </div>
      <div className="connect">
        {info.qr && <img className="qr" src={info.qr} alt="Connect QR" />}
        <div className="urls">
          {info.urls.length === 0 && <div className="empty">Server is not running.</div>}
          {info.urls.map((u) => (
            <div className="url-row" key={u}>
              <code className="grow">{u}</code>
              <button className="btn small" onClick={() => copy(u)}>
                {copied === u ? 'Copied!' : 'Copy'}
              </button>
              <button className="btn small" onClick={() => ld().openExternal(u)}>
                Open
              </button>
            </div>
          ))}
          <div className="small muted">
            To mount as a drive, use WebDAV at <code>{(info.urls[0] || '') + '/dav'}</code>
          </div>
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- Settings ---
export function SettingsPanel(): JSX.Element {
  const [cfg, setCfg] = useState<AppConfigView | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ld().config.get().then(setCfg)
  }, [])

  if (!cfg) return <div className="panel"><div className="empty">Loading…</div></div>

  const save = async (): Promise<void> => {
    const next = await ld().config.set(cfg)
    setCfg(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Settings</h2>
        <p className="muted">Changes to port or bind address take effect after restarting the server.</p>
      </div>
      <div className="card">
        <label className="field">
          <span>Port</span>
          <input
            type="number"
            value={cfg.port}
            onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Bind address</span>
          <select value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })}>
            <option value="0.0.0.0">0.0.0.0 (share on the whole LAN)</option>
            <option value="127.0.0.1">127.0.0.1 (this Mac only)</option>
          </select>
        </label>
        <label className="field">
          <span>Share folder name</span>
          <input
            value={cfg.shareRootName}
            onChange={(e) => setCfg({ ...cfg, shareRootName: e.target.value })}
          />
        </label>
        <label className="field-row">
          <input
            type="checkbox"
            checked={cfg.autoStart}
            onChange={(e) => setCfg({ ...cfg, autoStart: e.target.checked })}
          />
          <span>Start the server automatically when the app launches</span>
        </label>
        <button className="btn primary" onClick={save}>
          {saved ? 'Saved!' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
