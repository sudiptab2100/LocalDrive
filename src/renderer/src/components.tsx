import { useEffect, useMemo, useState } from 'react'
import type { DriveInfo, Role, AccessRequest } from '@shared/types'
import type { DashboardData, ConnectInfo, UserWithAcls, AppConfigView } from '@shared/ipc'
import { formatBytes, formatDate, timeAgo, usagePct } from './util'
import {
  Avatar,
  ConfirmDialog,
  Menu,
  Modal,
  PasswordInput,
  Switch,
  useToast,
  type MenuItem
} from './ui'

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
        <div className="head-actions">
          <button
            className="btn primary"
            disabled={busy === '__add__'}
            onClick={() => act(() => ld().drives.addFolder(), '__add__')}
          >
            + Share a folder…
          </button>
          <label className="check-label small muted">
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
interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  run: () => Promise<void>
}

export function UsersPanel(): JSX.Element {
  const [users, setUsers] = useState<UserWithAcls[]>([])
  const [accessReqs, setAccessReqs] = useState<AccessRequest[]>([])
  const [cfg, setCfg] = useState<AppConfigView | null>(null)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [pwUser, setPwUser] = useState<UserWithAcls | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const toast = useToast()

  const load = async (): Promise<void> => setUsers(await ld().users.list())
  const loadAccess = async (): Promise<void> => setAccessReqs(await ld().access.list())
  useEffect(() => {
    load()
    loadAccess()
    ld().config.get().then(setCfg)
    const off = ld().users.onRegistrationsChanged(() => load())
    const offAccess = ld().access.onChange(() => loadAccess())
    return () => {
      off()
      offAccess()
    }
  }, [])

  const pending = users.filter((u) => u.status === 'pending')
  const active = users.filter((u) => u.status !== 'pending')
  const adminCount = active.filter((u) => u.role === 'admin').length
  const shareRoot = cfg?.shareRootName || 'LocalDrive'
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? active.filter((u) => u.username.toLowerCase().includes(q)) : active
  }, [active, query])

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    try {
      await fn()
      toast('success', ok)
      load()
    } catch (e) {
      toast('error', (e as Error).message || 'Something went wrong')
    }
  }

  const actAccess = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    try {
      await fn()
      toast('success', ok)
      loadAccess()
      load()
    } catch (e) {
      toast('error', (e as Error).message || 'Something went wrong')
    }
  }

  const doConfirm = async (): Promise<void> => {
    if (!confirmState) return
    setConfirmBusy(true)
    try {
      await confirmState.run()
      setConfirmState(null)
    } catch (e) {
      toast('error', (e as Error).message || 'Something went wrong')
    } finally {
      setConfirmBusy(false)
    }
  }

  const askDelete = (u: UserWithAcls): void =>
    setConfirmState({
      title: `Delete ${u.username}?`,
      message: `This permanently removes ${u.username}'s account. Any files already stored on the drive are left untouched.`,
      confirmLabel: 'Delete',
      danger: true,
      run: async () => {
        await ld().users.remove(u.id)
        toast('success', `Deleted ${u.username}`)
        load()
      }
    })

  const askRole = (u: UserWithAcls): void => {
    const toAdmin = u.role !== 'admin'
    setConfirmState({
      title: toAdmin ? `Make ${u.username} an admin?` : `Make ${u.username} a standard user?`,
      message: toAdmin
        ? 'Admins can see every drive and manage all users and settings.'
        : 'They will lose admin access and only see their own private folder.',
      confirmLabel: toAdmin ? 'Make admin' : 'Make user',
      danger: false,
      run: async () => {
        await ld().users.setRole(u.id, toAdmin ? 'admin' : 'user')
        toast('success', `${u.username} is now ${toAdmin ? 'an admin' : 'a standard user'}`)
        load()
      }
    })
  }

  const askReject = (u: UserWithAcls): void =>
    setConfirmState({
      title: `Reject ${u.username}?`,
      message: `This deletes ${u.username}'s registration request. They can register again later.`,
      confirmLabel: 'Reject',
      danger: true,
      run: async () => {
        await ld().users.remove(u.id)
        toast('info', `Rejected ${u.username}`)
        load()
      }
    })

  const toggle = async (patch: Partial<AppConfigView>, ok: string): Promise<void> => {
    if (!cfg) return
    setCfg({ ...cfg, ...patch })
    try {
      setCfg(await ld().config.set(patch))
      toast('success', ok)
    } catch (e) {
      toast('error', (e as Error).message || 'Could not save setting')
      setCfg(await ld().config.get())
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          Users
          {pending.length > 0 && <span className="badge">{pending.length}</span>}
        </h2>
        <p className="muted">
          Users see every shared drive but must request access to each one. When you approve a
          request, they get a private folder named after them on that drive and can only see inside
          their own folder. Admins can access everything.
        </p>
      </div>

      {accessReqs.length > 0 && (
        <div className="card accent-card">
          <div className="card-head">
            <h3>
              Drive access requests <span className="badge">{accessReqs.length}</span>
            </h3>
            <p className="small muted">
              These users asked for access to a drive. Approving creates (or reuses) their private
              folder on that drive.
            </p>
          </div>
          <div className="user-list">
            {accessReqs.map((r) => (
              <div className="user-row" key={r.id}>
                <Avatar name={r.username} />
                <div className="user-row-main">
                  <div className="user-row-top">
                    <span className="user-name">{r.username}</span>
                    <span className="role-badge">{r.driveLabel}</span>
                    {r.existingSpace && (
                      <span className="role-badge ok" title="A folder for this user already exists on the drive">
                        space exists
                      </span>
                    )}
                  </div>
                  <div className="user-sub muted">Requested {timeAgo(r.requestedAt)}</div>
                </div>
                <div className="row-gap">
                  <button
                    className="btn primary small"
                    onClick={() =>
                      actAccess(
                        () => ld().access.approve(r.id),
                        `Granted ${r.username} access to ${r.driveLabel}`
                      )
                    }
                  >
                    Approve
                  </button>
                  <button
                    className="btn danger small"
                    onClick={() =>
                      actAccess(
                        () => ld().access.deny(r.id),
                        `Denied ${r.username} access to ${r.driveLabel}`
                      )
                    }
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="card accent-card">
          <div className="card-head">
            <h3>
              Pending approvals <span className="badge">{pending.length}</span>
            </h3>
            <p className="small muted">
              These people registered from the web sign-in page and can’t log in until you approve
              them.
            </p>
          </div>
          <div className="user-list">
            {pending.map((u) => (
              <div className="user-row" key={u.id}>
                <Avatar name={u.username} />
                <div className="user-row-main">
                  <div className="user-row-top">
                    <span className="user-name">{u.username}</span>
                    <span className="role-badge warn">pending</span>
                  </div>
                  <div className="user-sub muted">Registered {timeAgo(u.createdAt)}</div>
                </div>
                <div className="row-gap">
                  <button
                    className="btn primary small"
                    onClick={() => act(() => ld().users.approve(u.id), `Approved ${u.username}`)}
                  >
                    Approve
                  </button>
                  <button className="btn danger small" onClick={() => askReject(u)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cfg && (
        <div className="card">
          <div className="card-head">
            <h3>Registration</h3>
          </div>
          <div className="switch-row">
            <div className="switch-copy">
              <div className="switch-title">Allow web sign-ups</div>
              <div className="small muted">
                People can request an account from the web sign-in page.
              </div>
            </div>
            <Switch
              checked={cfg.registrationEnabled}
              onChange={(v) =>
                toggle(
                  { registrationEnabled: v },
                  v ? 'Web sign-ups enabled' : 'Web sign-ups disabled'
                )
              }
            />
          </div>
          <div className={`switch-row ${cfg.registrationEnabled ? '' : 'is-disabled'}`}>
            <div className="switch-copy">
              <div className="switch-title">Auto-approve new sign-ups</div>
              <div className="small muted">
                New accounts can sign in immediately — no manual approval.
              </div>
            </div>
            <Switch
              checked={cfg.autoApproveRegistrations}
              disabled={!cfg.registrationEnabled}
              onChange={(v) =>
                toggle(
                  { autoApproveRegistrations: v },
                  v ? 'Auto-approval on' : 'Auto-approval off'
                )
              }
            />
          </div>
        </div>
      )}

      {cfg && (
        <div className="card">
          <div className="card-head">
            <h3>Drive access</h3>
          </div>
          <div className="switch-row">
            <div className="switch-copy">
              <div className="switch-title">Auto-approve drive access requests</div>
              <div className="small muted">
                Approve every drive access request automatically — users get their folder without
                waiting.
              </div>
            </div>
            <Switch
              checked={cfg.autoApproveAccessRequests}
              onChange={(v) =>
                toggle(
                  { autoApproveAccessRequests: v },
                  v ? 'Auto-approval on' : 'Auto-approval off'
                )
              }
            />
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-head">
          <div className="chips">
            <span className="chip">
              {active.length} {active.length === 1 ? 'user' : 'users'}
            </span>
            <span className="chip">
              {adminCount} admin{adminCount === 1 ? '' : 's'}
            </span>
            {pending.length > 0 && <span className="chip warn">{pending.length} pending</span>}
          </div>
          <div className="section-actions">
            <input
              className="search"
              placeholder="Search users…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn primary" onClick={() => setShowAdd(true)}>
              + Add user
            </button>
          </div>
        </div>

        <div className="user-list">
          {filtered.length === 0 ? (
            <div className="empty">
              {query ? `No users match “${query}”.` : 'No users yet.'}
            </div>
          ) : (
            filtered.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                adminCount={adminCount}
                shareRoot={shareRoot}
                onResetPassword={setPwUser}
                onToggleRole={askRole}
                onDelete={askDelete}
              />
            ))
          )}
        </div>
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onCreated={load} />}
      {pwUser && <ResetPasswordModal user={pwUser} onClose={() => setPwUser(null)} />}
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel}
        danger={confirmState?.danger}
        busy={confirmBusy}
        onConfirm={doConfirm}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}

function UserRow({
  user,
  adminCount,
  shareRoot,
  onResetPassword,
  onToggleRole,
  onDelete
}: {
  user: UserWithAcls
  adminCount: number
  shareRoot: string
  onResetPassword: (u: UserWithAcls) => void
  onToggleRole: (u: UserWithAcls) => void
  onDelete: (u: UserWithAcls) => void
}): JSX.Element {
  const isOnlyAdmin = user.role === 'admin' && adminCount === 1
  const items: MenuItem[] = [
    { label: 'Reset password…', onClick: () => onResetPassword(user) },
    {
      label: user.role === 'admin' ? 'Make standard user' : 'Make admin',
      onClick: () => onToggleRole(user),
      disabled: isOnlyAdmin,
      title: isOnlyAdmin ? 'This is the only admin' : undefined
    },
    {
      label: 'Delete…',
      danger: true,
      onClick: () => onDelete(user),
      disabled: isOnlyAdmin,
      title: isOnlyAdmin ? 'You can’t delete the only admin' : undefined
    }
  ]
  return (
    <div className="user-row">
      <Avatar name={user.username} />
      <div className="user-row-main">
        <div className="user-row-top">
          <span className="user-name">{user.username}</span>
          <span className={`role-badge ${user.role}`}>{user.role}</span>
        </div>
        {user.role !== 'admin' && user.home ? (
          <div className="user-sub">
            Home: {shareRoot}/{user.home}/
          </div>
        ) : (
          <div className="user-sub muted">Full access to all drives</div>
        )}
      </div>
      <Menu items={items} />
    </div>
  )
}

function AddUserModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}): JSX.Element {
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError('')
    const u = username.trim()
    if (!u) return setError('Enter a username')
    if (password.length < 6) return setError('Password must be at least 6 characters')
    if (password !== confirmPw) return setError('Passwords don’t match')
    setBusy(true)
    try {
      await ld().users.create(u, password, role)
      toast('success', `Created ${u}`)
      onCreated()
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Could not create user')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="Add user"
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            Create user
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="fld">
          <span className="fld-label">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. alex"
            autoComplete="off"
          />
        </label>
        <label className="fld">
          <span className="fld-label">Password</span>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            autoComplete="new-password"
          />
        </label>
        <label className="fld">
          <span className="fld-label">Confirm password</span>
          <PasswordInput
            value={confirmPw}
            onChange={setConfirmPw}
            placeholder="Re-enter password"
            autoComplete="new-password"
          />
        </label>
        <label className="fld">
          <span className="fld-label">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">Standard user (private folder only)</option>
            <option value="admin">Admin (full access)</option>
          </select>
        </label>
        {error && <div className="error">{error}</div>}
      </div>
    </Modal>
  )
}

function ResetPasswordModal({
  user,
  onClose
}: {
  user: UserWithAcls
  onClose: () => void
}): JSX.Element {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError('')
    if (password.length < 6) return setError('Password must be at least 6 characters')
    if (password !== confirmPw) return setError('Passwords don’t match')
    setBusy(true)
    try {
      await ld().users.setPassword(user.id, password)
      toast('success', `Password updated for ${user.username}`)
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Could not update password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={`Reset password — ${user.username}`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            Update password
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="fld">
          <span className="fld-label">New password</span>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            autoFocus
            autoComplete="new-password"
          />
        </label>
        <label className="fld">
          <span className="fld-label">Confirm new password</span>
          <PasswordInput
            value={confirmPw}
            onChange={setConfirmPw}
            placeholder="Re-enter password"
            autoComplete="new-password"
          />
        </label>
        {error && <div className="error">{error}</div>}
      </div>
    </Modal>
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
            The IP link works on any device on this WiFi. The <code>.local</code> name needs
            Bonjour/mDNS — fine on Apple devices and most modern OSes, but on Android or older
            Windows use the IP link.
          </div>
          <div className="small muted">
            To mount as a network drive, use a WebDAV client (macOS Finder ▸ ⌘K, Windows ▸ “Map
            network drive”, or a mobile WebDAV app) — <strong>not a browser</strong> — at{' '}
            <code>{(info.urls[0] || '') + '/dav'}</code>, then sign in with your LocalDrive
            username &amp; password.
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

        <div className="divider" />

        <label className="field-row">
          <input
            type="checkbox"
            checked={cfg.httpsEnabled}
            onChange={(e) => setCfg({ ...cfg, httpsEnabled: e.target.checked })}
          />
          <span>Enable HTTPS (encrypted — install the certificate on each device)</span>
        </label>
        {cfg.httpsEnabled && (
          <>
            <label className="field">
              <span>HTTPS port</span>
              <input
                type="number"
                value={cfg.httpsPort}
                onChange={(e) => setCfg({ ...cfg, httpsPort: Number(e.target.value) })}
              />
            </label>
            <div className="btn-row">
              <button
                className="btn small"
                onClick={() => ld().openExternal(`http://localhost:${cfg.port}/api/cert`)}
              >
                Download certificate
              </button>
              <button className="btn small" onClick={() => ld().revealCert()}>
                Reveal certificate file
              </button>
            </div>
            <details className="cert-help small muted">
              <summary>How to install the certificate on a device</summary>
              <ul>
                <li>
                  <strong>iPhone / iPad:</strong> open the HTTPS link in Safari, allow the profile
                  download, then Settings ▸ General ▸ VPN &amp; Device Management to install it, and
                  Settings ▸ General ▸ About ▸ Certificate Trust Settings to switch it on.
                </li>
                <li>
                  <strong>Android:</strong> Settings ▸ Security ▸ Encryption &amp; credentials ▸
                  Install a certificate ▸ CA certificate, then choose the downloaded file.
                </li>
                <li>
                  <strong>macOS:</strong> double-click the file, add it to the login keychain, then
                  set it to “Always Trust”.
                </li>
                <li>
                  <strong>Windows:</strong> double-click ▸ Install Certificate ▸ Local Machine ▸
                  place it in “Trusted Root Certification Authorities”.
                </li>
              </ul>
            </details>
            <div className="small muted">
              Restart the server (Server tab) after enabling HTTPS or changing the HTTPS port.
            </div>
          </>
        )}

        <button className="btn primary" onClick={save}>
          {saved ? 'Saved!' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
