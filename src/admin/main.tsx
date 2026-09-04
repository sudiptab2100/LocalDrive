import React, { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { User } from '@shared/types'
import App from '@renderer/App'
import { ToastProvider } from '@renderer/ui'
import { httpApi } from './ld-http'
import '@renderer/styles.css'
import './admin.css'

// Install the HTTP-backed data layer as `window.ld` before the shared desktop
// App mounts, so the identical renderer UI runs unchanged in the browser.
window.ld = httpApi

type Phase = 'loading' | 'login' | 'denied' | 'ready'

async function fetchMe(): Promise<User | null> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if (!res.ok) return null
    const data = (await res.json()) as { user?: User }
    return data.user ?? null
  } catch {
    return null
  }
}

async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    /* best-effort */
  }
}

function AdminLogin({
  onReady,
  onDenied
}: {
  onReady: () => void
  onDenied: () => void
}): JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('Enter your admin username and password')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      })
      const data = (await res.json().catch(() => ({}))) as { user?: User; error?: string }
      if (!res.ok) {
        setError(data.error || 'Invalid credentials')
        return
      }
      if (data.user?.role !== 'admin') {
        await logout()
        onDenied()
        return
      }
      onReady()
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-head">
          <div className="logo">LD</div>
          <div>
            <div className="auth-title">LocalDrive Admin</div>
            <div className="auth-sub">Control panel · administrators only</div>
          </div>
        </div>
        <div className="form-grid">
          <label className="fld">
            <span className="fld-label">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              spellCheck={false}
            />
          </label>
          <label className="fld">
            <span className="fld-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <div className="auth-note">
          Use the admin credentials printed in the server terminal on first run.
        </div>
      </form>
    </div>
  )
}

function AdminDenied(): JSX.Element {
  return (
    <div className="admin-denied">
      <div className="auth-card">
        <div className="auth-title">Administrators only</div>
        <div className="auth-sub" style={{ marginTop: 8 }}>
          This account doesn’t have admin access. Sign in with an administrator account to use the
          control panel.
        </div>
        <button
          className="btn primary"
          style={{ marginTop: 16 }}
          onClick={() => window.location.reload()}
        >
          Back to sign in
        </button>
      </div>
    </div>
  )
}

function ReconnectBanner(): JSX.Element | null {
  const [info, setInfo] = useState<{ url?: string; stopped?: boolean } | null>(null)
  useEffect(() => {
    const onEvt = (e: Event): void => {
      setInfo(((e as CustomEvent).detail as { url?: string; stopped?: boolean }) || {})
    }
    window.addEventListener('ld:reconnect', onEvt)
    return () => window.removeEventListener('ld:reconnect', onEvt)
  }, [])
  if (!info) return null
  return (
    <div className="admin-reconnect">
      {info.stopped ? (
        <span>Server stopped from this panel. Restart it from the host to reconnect.</span>
      ) : (
        <span>
          Server restarting…{' '}
          {info.url ? (
            <>
              reconnect at <a href={info.url}>{info.url}</a>
            </>
          ) : (
            'reconnecting shortly.'
          )}
        </span>
      )}
      <button className="btn small" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}

function AdminRoot(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')

  const check = useCallback(async () => {
    const user = await fetchMe()
    if (!user) {
      setPhase('login')
      return
    }
    if (user.role !== 'admin') {
      await logout()
      setPhase('denied')
      return
    }
    setPhase('ready')
  }, [])

  useEffect(() => {
    check()
  }, [check])

  if (phase === 'loading') {
    return (
      <div className="admin-auth">
        <div className="auth-sub">Loading…</div>
      </div>
    )
  }
  if (phase === 'login') {
    return <AdminLogin onReady={() => setPhase('ready')} onDenied={() => setPhase('denied')} />
  }
  if (phase === 'denied') {
    return <AdminDenied />
  }
  return (
    <ToastProvider>
      <App />
      <ReconnectBanner />
    </ToastProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AdminRoot />
  </React.StrictMode>
)
