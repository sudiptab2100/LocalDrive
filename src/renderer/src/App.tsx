import { useCallback, useEffect, useState } from 'react'
import type { DriveInfo, ServerStatus } from '@shared/types'
import { DashboardPanel, DrivesPanel, UsersPanel, ConnectPanel, SettingsPanel } from './components'

type Tab = 'dashboard' | 'drives' | 'users' | 'connect' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'drives', label: 'Drives' },
  { id: 'users', label: 'Users' },
  { id: 'connect', label: 'Connect' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [bootstrap, setBootstrap] = useState<{ username: string; password: string } | null>(null)

  const refreshDrives = useCallback(async () => {
    setDrives(await window.ld.drives.listAll())
  }, [])

  const refreshPending = useCallback(async () => {
    const us = await window.ld.users.list()
    setPendingCount(us.filter((u) => u.status === 'pending').length)
  }, [])

  useEffect(() => {
    window.ld.server.status().then(setStatus)
    refreshDrives()
    refreshPending()
    window.ld.server.bootstrap().then((b) => b && setBootstrap(b))
    const offStatus = window.ld.server.onStatus(setStatus)
    const offDrives = window.ld.drives.onChange(refreshDrives)
    const offReg = window.ld.users.onRegistrationsChanged(refreshPending)
    return () => {
      offStatus()
      offDrives()
      offReg()
    }
  }, [refreshDrives, refreshPending])

  const control = async (fn: () => Promise<ServerStatus>): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await fn())
    } finally {
      setBusy(false)
    }
  }

  const running = status?.running ?? false

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">LD</div>
          <div>
            <div className="title">LocalDrive</div>
            <div className="subtitle">
              <span className={`dot ${running ? 'on' : 'off'}`} />
              {running ? `Running · ${status?.hostname}:${status?.port}` : 'Stopped'}
              {running && status ? ` · ${status.activeConnections} active` : ''}
            </div>
          </div>
        </div>
        <div className="controls">
          {running ? (
            <>
              <button className="btn" disabled={busy} onClick={() => control(window.ld.server.restart)}>
                Restart
              </button>
              <button className="btn danger" disabled={busy} onClick={() => control(window.ld.server.stop)}>
                Stop
              </button>
            </>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => control(window.ld.server.start)}>
              Start server
            </button>
          )}
        </div>
      </header>

      {bootstrap && (
        <div className="bootstrap">
          <div>
            <strong>Admin account created.</strong> Save these credentials — the password is shown only once.
            <div className="creds">
              user: <code>{bootstrap.username}</code> · password: <code>{bootstrap.password}</code>
            </div>
          </div>
          <button className="btn small" onClick={() => setBootstrap(null)}>
            Got it
          </button>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'users' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'dashboard' && <DashboardPanel />}
        {tab === 'drives' && <DrivesPanel drives={drives} onChange={refreshDrives} />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'connect' && <ConnectPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  )
}
