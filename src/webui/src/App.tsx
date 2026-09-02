import { Dashboard, ProgressBar } from '@uppy/react'
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'
import type { DriveInfo, FileEntry, User, RegisterResult } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiRequestError, api, fileUrl, zipUrl, type SearchHit } from './api'
import { formatBytes, formatDate, iconFor, isTextLike, joinPath, parentPath } from './utils'

type Theme = 'dark' | 'light'
type ViewMode = 'grid' | 'list'

interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

const textDecoderLimit = 1024 * 1024

export function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('localdrive-theme') as Theme) || 'dark')
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [currentDriveId, setCurrentDriveId] = useState('')
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [appError, setAppError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('localdrive-view') as ViewMode) || 'list')
  const [showHidden, setShowHidden] = useState<boolean>(() => localStorage.getItem('localdrive-hidden') === '1')
  const [preview, setPreview] = useState<FileEntry | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [showUploader, setShowUploader] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [connectQr, setConnectQr] = useState<string | null>(null)

  const currentDrive = drives.find((drive) => drive.uuid === currentDriveId) ?? null

  const toast = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items, { id, kind, message }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4500)
  }, [])

  const refreshDrives = useCallback(async () => {
    const response = await api.drives()
    setDrives(response.drives)
    setCurrentDriveId((existing) => {
      if (existing && response.drives.some((drive) => drive.uuid === existing)) return existing
      const online = response.drives.find((drive) => drive.online)
      return online?.uuid || response.drives[0]?.uuid || ''
    })
  }, [])

  const refreshList = useCallback(async () => {
    if (!currentDriveId) {
      setEntries([])
      return
    }
    setLoading(true)
    setAppError('')
    try {
      const response = await api.list(currentDriveId, currentPath, showHidden)
      setEntries(response.entries)
      setSelected(new Set())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load files'
      setAppError(message)
      toast('error', message)
    } finally {
      setLoading(false)
    }
  }, [currentDriveId, currentPath, showHidden, toast])

  const uppy = useMemo(() => {
    const instance = new Uppy({ autoProceed: false })
    instance.use(Tus, {
      endpoint: '/api/upload',
      withCredentials: true,
      chunkSize: 5 * 1024 * 1024,
      allowedMetaFields: ['filename', 'drive', 'path']
    })
    return instance
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('localdrive-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('localdrive-view', viewMode)
  }, [viewMode])

  useEffect(() => {
    localStorage.setItem('localdrive-hidden', showHidden ? '1' : '0')
  }, [showHidden])

  useEffect(() => {
    api.me()
      .then(({ user: currentUser }) => {
        setUser(currentUser)
        return refreshDrives()
      })
      .catch((error) => {
        if (!(error instanceof ApiRequestError) || error.status !== 401) {
          toast('error', error instanceof Error ? error.message : 'Could not check session')
        }
      })
      .finally(() => setAuthChecked(true))
  }, [refreshDrives, toast])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useEffect(() => {
    uppy.setMeta({ drive: currentDriveId, path: currentPath })
  }, [uppy, currentDriveId, currentPath])

  useEffect(() => {
    const onFileAdded = (file: { id: string; name?: string }) => {
      uppy.setFileMeta(file.id, { filename: file.name ?? 'upload', drive: currentDriveId, path: currentPath })
    }
    const onComplete = () => {
      toast('success', 'Upload complete')
      void refreshList()
    }
    const onError = (_file: unknown, error: Error) => toast('error', error.message || 'Upload failed')
    uppy.on('file-added', onFileAdded)
    uppy.on('complete', onComplete)
    uppy.on('upload-error', onError)
    return () => {
      uppy.off('file-added', onFileAdded)
      uppy.off('complete', onComplete)
      uppy.off('upload-error', onError)
    }
  }, [uppy, currentDriveId, currentPath, refreshList, toast])

  useEffect(() => () => uppy.destroy(), [uppy])

  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 2) {
      setSearchHits([])
      return
    }
    const controller = new AbortController()
    const handle = window.setTimeout(() => {
      setSearching(true)
      api.search(query, currentDriveId || undefined, showHidden)
        .then((response) => setSearchHits(response.hits))
        .catch((error) => {
          if (!controller.signal.aborted) toast('error', error instanceof Error ? error.message : 'Search failed')
        })
        .finally(() => setSearching(false))
    }, 300)
    return () => {
      controller.abort()
      window.clearTimeout(handle)
    }
  }, [searchQuery, currentDriveId, showHidden, toast])

  const onLogin = async (username: string, password: string) => {
    const result = await api.login(username, password)
    setUser(result.user)
    await refreshDrives()
  }

  const onRegister = async (username: string, password: string): Promise<RegisterResult> => {
    const result = await api.register(username, password)
    // Auto-approved registrations sign the user in immediately (cookie already set).
    if (!result.pending && result.user) {
      setUser(result.user)
      await refreshDrives()
    }
    return result
  }

  const logout = async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      setDrives([])
      setEntries([])
      setCurrentDriveId('')
      setCurrentPath('')
    }
  }

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation()
      toast('success', success)
      await refreshList()
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Action failed')
    }
  }

  const makeFolder = () => {
    if (!currentDriveId) return
    const name = window.prompt('New folder name')?.trim()
    if (name) void mutate(() => api.mkdir(currentDriveId, currentPath, name), 'Folder created')
  }

  const renameEntry = (entry: FileEntry) => {
    const newName = window.prompt('Rename to', entry.name)?.trim()
    if (newName && newName !== entry.name) void mutate(() => api.rename(currentDriveId, entry.path, newName), 'Renamed')
  }

  const deletePaths = (paths: string[]) => {
    if (!paths.length || !window.confirm(`Delete ${paths.length} item${paths.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    void mutate(() => api.delete(currentDriveId, paths), 'Deleted')
  }

  const moveOrCopy = (mode: 'move' | 'copy', paths: string[]) => {
    if (!paths.length) return
    const dest = window.prompt(`${mode === 'move' ? 'Move' : 'Copy'} to folder path`, currentPath)?.trim()
    if (dest === undefined) return
    void mutate(() => (mode === 'move' ? api.move(currentDriveId, paths, dest) : api.copy(currentDriveId, paths, dest)), mode === 'move' ? 'Moved' : 'Copied')
  }

  const openDownload = (url: string) => {
    window.location.assign(url)
  }

  const selectedPaths = Array.from(selected)
  const filesOnly = entries.filter((entry) => !entry.isDir)
  const previewIndex = preview ? filesOnly.findIndex((entry) => entry.path === preview.path) : -1

  const openSearchHit = (hit: SearchHit) => {
    setSearchQuery('')
    setSearchHits([])
    if (hit.drive !== currentDriveId) setCurrentDriveId(hit.drive)
    setCurrentPath(hit.isDir ? hit.path : parentPath(hit.path))
    if (!hit.isDir) toast('info', 'Opened the containing folder. Select the file to preview it.')
  }

  const loadConnect = async () => {
    setShowConnect((value) => !value)
    if (connectQr) return
    try {
      const response = await api.connect()
      setConnectQr(response.qr)
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not load QR code')
    }
  }

  if (!authChecked) return <Splash />
  if (!user) return <LoginScreen onLogin={onLogin} onRegister={onRegister} toast={toast} />

  // Non-admins are confined to their own home, which the server presents as the
  // root "/". Hide drive internals (name, capacity) and show it simply as "Home".
  const confined = user.role !== 'admin'

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setCurrentPath('')} aria-label={confined ? 'Go to your home' : 'Go to drive root'}>
          <img src="/icons/icon-192.png" alt="" />
          <span>LocalDrive</span>
        </button>
        <div className="topbar-center">
          {(!confined || drives.length > 1) && (
            <select
              className="drive-select"
              value={currentDriveId}
              onChange={(event) => {
                setCurrentDriveId(event.target.value)
                setCurrentPath('')
              }}
              aria-label={confined ? 'Current location' : 'Current drive'}
            >
              {drives.length === 0 && <option value="">No drives shared</option>}
              {drives.map((drive, index) => (
                <option key={drive.uuid} value={drive.uuid}>
                  {confined ? `My Files${drives.length > 1 ? ` ${index + 1}` : ''}` : drive.label}{drive.online ? '' : ' (offline)'}
                </option>
              ))}
            </select>
          )}
          <div className="search-wrap">
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search files…" aria-label="Search files" />
            {(searchHits.length > 0 || searching) && (
              <div className="search-panel">
                {searching && <div className="muted pad">Searching…</div>}
                {!searching && searchHits.map((hit) => (
                  <button key={`${hit.drive}:${hit.path}`} onClick={() => openSearchHit(hit)}>
                    <span>{hit.isDir ? '📁' : '📄'}</span>
                    <span><strong>{hit.name}</strong><small>{hit.path || 'Root'}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="topbar-tools">
          <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle color theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="icon-button hide-mobile" onClick={loadConnect} aria-label="Connect another device">▦</button>
          <div className="user-menu">
            <span>{user.username}</span>
            <button onClick={logout}>Logout</button>
          </div>
        </div>
      </header>

      {showConnect && (
        <aside className="connect-card">
          <button className="close" onClick={() => setShowConnect(false)}>×</button>
          <h3>Connect another device</h3>
          {connectQr ? <img src={connectQr} alt="Connection QR code" /> : <p>Loading QR…</p>}
          <p className="muted">Scan on a phone or tablet connected to this WiFi network.</p>
          <p className="muted small">The QR points to this Mac's IP, so it opens on any device — including Android, where <code>.local</code> names often don't resolve.</p>
          <p className="muted small">To mount as a drive instead, use a WebDAV client (not a browser) at <code>{location.origin + '/dav'}</code> and sign in with your username &amp; password.</p>
        </aside>
      )}

      <main className="main">
        <section className="toolbar panel">
          <Breadcrumb rootLabel={confined ? 'Home' : currentDrive?.label || 'Drive'} path={currentPath} onNavigate={setCurrentPath} />
          <div className="toolbar-actions">
            <button
              className="icon-btn"
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              aria-label={viewMode === 'grid' ? 'List view' : 'Grid view'}
              title={viewMode === 'grid' ? 'List view' : 'Grid view'}
              data-tip={viewMode === 'grid' ? 'List view' : 'Grid view'}
            >
              {viewMode === 'grid' ? <IconList /> : <IconGrid />}
            </button>
            <button
              className={`icon-btn${showHidden ? ' active' : ''}`}
              onClick={() => setShowHidden((value) => !value)}
              aria-label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
              aria-pressed={showHidden}
              title={showHidden ? 'Hide hidden' : 'Show hidden'}
              data-tip={showHidden ? 'Hide hidden' : 'Show hidden'}
            >
              {showHidden ? <IconEyeOff /> : <IconEye />}
            </button>
            <button
              className="icon-btn"
              onClick={makeFolder}
              disabled={!currentDriveId || currentDrive?.online === false}
              aria-label="New folder"
              title="New folder"
              data-tip="New folder"
            >
              <IconFolderPlus />
            </button>
            <button
              className="icon-btn primary"
              onClick={() => setShowUploader(true)}
              disabled={!currentDriveId || currentDrive?.online === false}
              aria-label="Upload"
              title="Upload"
              data-tip="Upload"
            >
              <IconUpload />
            </button>
          </div>
        </section>

        {currentDrive && !confined && (
          <section className="drive-card panel">
            <div>
              <strong>{currentDrive.label}</strong>
              <span className={currentDrive.online ? 'status online' : 'status offline'}>{currentDrive.online ? 'Online' : 'Offline'}</span>
            </div>
            <div className="drive-meter" aria-label="Drive usage">
              <span style={{ width: usagePercent(currentDrive) }} />
            </div>
            <small>{formatBytes((currentDrive.totalBytes ?? 0) - (currentDrive.freeBytes ?? 0))} used of {formatBytes(currentDrive.totalBytes)}</small>
          </section>
        )}

        {selected.size > 0 && (
          <section className="bulkbar">
            <strong>{selected.size} selected</strong>
            <button onClick={() => openDownload(zipUrl(currentDriveId, selectedPaths))}>Download ZIP</button>
            <button onClick={() => moveOrCopy('move', selectedPaths)}>Move</button>
            <button onClick={() => moveOrCopy('copy', selectedPaths)}>Copy</button>
            <button className="danger" onClick={() => deletePaths(selectedPaths)}>Delete</button>
            <button onClick={() => setSelected(new Set())}>Clear</button>
          </section>
        )}

        <DropZone uppy={uppy} disabled={!currentDriveId || currentDrive?.online === false} onOpen={() => setShowUploader(true)}>
          <section className="browser panel">
            {currentDrive?.online === false && (
              <div className="state">
                <h3>{confined ? 'Your files are offline right now' : `“${currentDrive.label}” is offline`}</h3>
                <p>This storage isn’t connected right now. Plug it back into the host Mac — it reconnects automatically by its unique ID and your files are exactly where you left them.</p>
                <button className="primary" onClick={refreshDrives}>Check again</button>
              </div>
            )}
            {currentDrive?.online !== false && loading && <StateMessage title="Loading files…" />}
            {currentDrive?.online !== false && !loading && appError && <StateMessage title="Could not load this folder" detail={appError} />}
            {!loading && !appError && entries.length === 0 && drives.length === 0 && (
              confined ? (
                <div className="state onboarding">
                  <h3>No storage available yet</h3>
                  <p>Your personal space shows up here as soon as an administrator shares a drive with LocalDrive. Check back shortly.</p>
                  <button className="primary" onClick={refreshDrives}>Refresh</button>
                </div>
              ) : (
                <div className="state onboarding">
                  <h3>No drives shared yet</h3>
                  <p>Storage shows up here as soon as a drive is shared from the LocalDrive app on the host Mac.</p>
                  <ol>
                    <li>Open the <strong>LocalDrive</strong> app on the Mac running this server (click its menu-bar icon).</li>
                    <li>Plug in your <strong>USB / HDD / SSD</strong>, then open the <strong>Drives</strong> tab.</li>
                    <li>Press <strong>“Share this drive”</strong> — it appears here instantly.</li>
                  </ol>
                  <button className="primary" onClick={refreshDrives}>Refresh</button>
                </div>
              )
            )}
            {currentDrive?.online !== false && !loading && !appError && entries.length === 0 && drives.length > 0 && <StateMessage title="This folder is empty" detail="Drag files here or use Upload to add something." />}
            {currentDrive?.online !== false && !loading && !appError && entries.length > 0 && (
              viewMode === 'grid' ? (
                <div className="grid">
                  {entries.map((entry) => (
                    <FileTile
                      key={entry.path}
                      entry={entry}
                      drive={currentDriveId}
                      checked={selected.has(entry.path)}
                      onToggle={() => toggleSelected(setSelected, entry.path)}
                      onOpen={() => entry.isDir ? setCurrentPath(entry.path) : setPreview(entry)}
                      onDownload={() => openDownload(entry.isDir ? zipUrl(currentDriveId, [entry.path]) : fileUrl('download', currentDriveId, entry.path))}
                      onRename={() => renameEntry(entry)}
                      onDelete={() => deletePaths([entry.path])}
                      onMove={() => moveOrCopy('move', [entry.path])}
                      onCopy={() => moveOrCopy('copy', [entry.path])}
                    />
                  ))}
                </div>
              ) : (
                <FileTable
                  entries={entries}
                  drive={currentDriveId}
                  selected={selected}
                  onToggle={(path) => toggleSelected(setSelected, path)}
                  onOpen={(entry) => entry.isDir ? setCurrentPath(entry.path) : setPreview(entry)}
                  onDownload={(entry) => openDownload(entry.isDir ? zipUrl(currentDriveId, [entry.path]) : fileUrl('download', currentDriveId, entry.path))}
                  onRename={renameEntry}
                  onDelete={(entry) => deletePaths([entry.path])}
                  onMove={(entry) => moveOrCopy('move', [entry.path])}
                  onCopy={(entry) => moveOrCopy('copy', [entry.path])}
                />
              )
            )}
          </section>
        </DropZone>
      </main>

      {showUploader && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="upload-modal">
            <button className="close" onClick={() => setShowUploader(false)}>×</button>
            <h2>Upload to {currentPath || 'root'}</h2>
            <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} height={420} />
            <ProgressBar uppy={uppy} />
          </div>
        </div>
      )}

      {preview && (
        <PreviewModal
          entry={preview}
          drive={currentDriveId}
          onClose={() => setPreview(null)}
          onDownload={() => openDownload(fileUrl('download', currentDriveId, preview.path))}
          onPrevious={previewIndex > 0 ? () => setPreview(filesOnly[previewIndex - 1]) : undefined}
          onNext={previewIndex >= 0 && previewIndex < filesOnly.length - 1 ? () => setPreview(filesOnly[previewIndex + 1]) : undefined}
        />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((item) => <div key={item.id} className={`toast ${item.kind}`}>{item.message}</div>)}
      </div>
    </div>
  )
}

function Splash() {
  return <div className="splash"><img src="/icons/icon-192.png" alt="" /><p>Opening LocalDrive…</p></div>
}

function LoginScreen({ onLogin, onRegister, toast }: { onLogin: (username: string, password: string) => Promise<void>; onRegister: (username: string, password: string) => Promise<RegisterResult>; toast: (kind: Toast['kind'], message: string) => void }) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingMsg, setPendingMsg] = useState('')
  const [canRegister, setCanRegister] = useState(false)

  useEffect(() => {
    api
      .authConfig()
      .then((c) => setCanRegister(c.registrationEnabled))
      .catch(() => setCanRegister(false))
  }, [])

  const swap = (next: 'signin' | 'register') => {
    setMode(next)
    setError('')
    setPassword('')
    setConfirm('')
    setShowPw(false)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    const u = username.trim()
    if (!u) {
      setError('Enter a username')
      return
    }
    if (mode === 'register') {
      if (password.length < 6) {
        setError('Password must be at least 6 characters')
        return
      }
      if (password !== confirm) {
        setError('Passwords do not match')
        return
      }
    }
    setLoading(true)
    try {
      if (mode === 'signin') {
        await onLogin(u, password)
        toast('success', 'Signed in')
      } else {
        const result = await onRegister(u, password)
        if (result.pending) {
          setPendingMsg(result.message || 'Your account is awaiting admin approval.')
        } else {
          toast('success', 'Account created')
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : mode === 'signin' ? 'Login failed' : 'Registration failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const registering = mode === 'register'

  if (pendingMsg) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <img src="/icons/icon-192.png" alt="" />
          <h1>Request sent</h1>
          <div className="pending-block">
            <span className="pending-check">✓</span>
            <p>{pendingMsg}</p>
          </div>
          <button
            className="primary"
            onClick={() => {
              setPendingMsg('')
              swap('signin')
            }}
          >
            Back to sign in
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <img src="/icons/icon-192.png" alt="" />
        <h1>LocalDrive</h1>
        {canRegister && (
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={!registering}
              className={!registering ? 'active' : ''}
              onClick={() => swap('signin')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={registering}
              className={registering ? 'active' : ''}
              onClick={() => swap('register')}
            >
              Create account
            </button>
          </div>
        )}
        <p className="login-sub">
          {registering
            ? 'Request an account — an admin will approve access.'
            : 'Sign in to browse shared drives on this network.'}
        </p>
        {error && <div className="form-error">{error}</div>}
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <span className="pw-field">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPw ? 'text' : 'password'}
              autoComplete={registering ? 'new-password' : 'current-password'}
              required
            />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)} tabIndex={-1}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        {registering && (
          <label>
            Confirm password
            <input
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              required
            />
          </label>
        )}
        <button className="primary" disabled={loading}>
          {loading ? (registering ? 'Creating…' : 'Signing in…') : registering ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

function Breadcrumb({ rootLabel, path, onNavigate }: { rootLabel: string; path: string; onNavigate: (path: string) => void }) {
  const segments = path ? path.split('/') : []
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <button onClick={() => onNavigate('')}>{rootLabel}</button>
      {segments.map((segment, index) => {
        const segmentPath = segments.slice(0, index + 1).join('/')
        return <button key={segmentPath} onClick={() => onNavigate(segmentPath)}>{segment}</button>
      })}
    </nav>
  )
}

function DropZone({ uppy, disabled, onOpen, children }: { uppy: Uppy; disabled: boolean; onOpen: () => void; children: React.ReactNode }) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const addFiles = (files: FileList) => {
    Array.from(files).forEach((file) => {
      try {
        uppy.addFile({ name: file.name, type: file.type, data: file })
      } catch {
        // Uppy reports duplicates and validation errors through its UI.
      }
    })
    onOpen()
  }

  return (
    <div
      className={`drop-shell ${dragging ? 'dragging' : ''}`}
      onDragEnter={(event) => {
        if (disabled) return
        event.preventDefault()
        depth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault()
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        if (disabled) return
        event.preventDefault()
        depth.current = 0
        setDragging(false)
        addFiles(event.dataTransfer.files)
      }}
    >
      {children}
      {dragging && <div className="drop-overlay"><strong>Drop to upload</strong><span>Files will be uploaded to this folder.</span></div>}
    </div>
  )
}

function FileTile(props: {
  entry: FileEntry; drive: string; checked: boolean; onToggle: () => void; onOpen: () => void; onDownload: () => void; onRename: () => void; onDelete: () => void; onMove: () => void; onCopy: () => void
}) {
  const { entry, drive } = props
  return (
    <article className="file-tile">
      <label className="check"><input type="checkbox" checked={props.checked} onChange={props.onToggle} onClick={(event) => event.stopPropagation()} /></label>
      <button className="file-open" onClick={props.onOpen}>
        <Thumb entry={entry} drive={drive} />
        <strong title={entry.name}>{entry.name}</strong>
        <small>{entry.isDir ? 'Folder' : formatBytes(entry.size)}</small>
      </button>
      <ItemActions {...props} />
    </article>
  )
}

function FileTable(props: {
  entries: FileEntry[]; drive: string; selected: Set<string>; onToggle: (path: string) => void; onOpen: (entry: FileEntry) => void; onDownload: (entry: FileEntry) => void; onRename: (entry: FileEntry) => void; onDelete: (entry: FileEntry) => void; onMove: (entry: FileEntry) => void; onCopy: (entry: FileEntry) => void
}) {
  return (
    <div className="table-wrap">
      <table className="file-table">
        <thead><tr><th></th><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead>
        <tbody>
          {props.entries.map((entry) => (
            <tr key={entry.path}>
              <td><input type="checkbox" checked={props.selected.has(entry.path)} onChange={() => props.onToggle(entry.path)} /></td>
              <td><button className="row-name" onClick={() => props.onOpen(entry)}><span>{iconFor(entry)}</span>{entry.name}</button></td>
              <td>{entry.isDir ? 'Folder' : formatBytes(entry.size)}</td>
              <td>{formatDate(entry.mtimeMs)}</td>
              <td><ItemActions entry={entry} onDownload={() => props.onDownload(entry)} onRename={() => props.onRename(entry)} onDelete={() => props.onDelete(entry)} onMove={() => props.onMove(entry)} onCopy={() => props.onCopy(entry)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Thumb({ entry, drive }: { entry: FileEntry; drive: string }) {
  const [failed, setFailed] = useState(false)
  if (!entry.isDir && entry.mime?.startsWith('image/') && !failed) {
    return <img className="thumb image" src={fileUrl('thumb', drive, entry.path, { size: 256 })} alt="" onError={() => setFailed(true)} />
  }
  return <span className="thumb icon">{iconFor(entry)}</span>
}

function ItemActions(props: { entry: FileEntry; onDownload: () => void; onRename: () => void; onDelete: () => void; onMove: () => void; onCopy: () => void }) {
  return (
    <div className="actions">
      <button title="Download" aria-label={`Download ${props.entry.name}`} onClick={props.onDownload}>⬇</button>
      <OverflowMenu
        label={`More actions for ${props.entry.name}`}
        items={[
          { label: 'Rename', icon: '✎', onSelect: props.onRename },
          { label: 'Move', icon: '↪', onSelect: props.onMove },
          { label: 'Copy', icon: '⧉', onSelect: props.onCopy },
          { label: 'Delete', icon: '⌫', onSelect: props.onDelete, danger: true }
        ]}
      />
    </div>
  )
}

function OverflowMenu({ label, items }: { label: string; items: Array<{ label: string; icon: string; onSelect: () => void; danger?: boolean }> }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="overflow-menu" ref={menuRef}>
      <button type="button" className="menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((value) => !value)}>⋯</button>
      {open && (
        <div className="menu-popover" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : undefined}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PreviewModal({ entry, drive, onClose, onDownload, onPrevious, onNext }: { entry: FileEntry; drive: string; onClose: () => void; onDownload: () => void; onPrevious?: () => void; onNext?: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const raw = fileUrl('raw', drive, entry.path)
  const mime = entry.mime ?? ''
  const ext = entry.name.split('.').pop()?.toLowerCase()

  useEffect(() => {
    setText(null)
    setError('')
    if (!isTextLike(entry)) return
    fetch(raw, { credentials: 'include', headers: { Range: `bytes=0-${textDecoderLimit - 1}` } })
      .then((response) => {
        if (!response.ok) throw new Error('Could not load text preview')
        return response.text()
      })
      .then(setText)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load text preview'))
  }, [entry, raw])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="preview-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><h2>{entry.name}</h2><span>{formatBytes(entry.size)} • {formatDate(entry.mtimeMs)}</span></div>
          <div className="preview-controls">
            <button onClick={onPrevious} disabled={!onPrevious}>‹</button>
            <button onClick={onNext} disabled={!onNext}>›</button>
            <button onClick={onDownload}>Download</button>
            <button className="close" onClick={onClose}>×</button>
          </div>
        </header>
        <div className="preview-body">
          {mime.startsWith('image/') && <img src={raw} alt={entry.name} />}
          {mime.startsWith('video/') && <video controls src={raw} />}
          {mime.startsWith('audio/') && <audio controls src={raw} />}
          {(mime === 'application/pdf' || ext === 'pdf') && <iframe src={raw} title={entry.name} />}
          {isTextLike(entry) && (error ? <StateMessage title="Preview unavailable" detail={error} /> : <pre>{text ?? 'Loading preview…'}</pre>)}
          {!mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/') && mime !== 'application/pdf' && ext !== 'pdf' && !isTextLike(entry) && (
            <StateMessage title="No preview available" detail="Download this file to open it with another app." />
          )}
        </div>
      </div>
    </div>
  )
}

function StateMessage({ title, detail }: { title: string; detail?: string }) {
  return <div className="state"><h3>{title}</h3>{detail && <p>{detail}</p>}</div>
}

function toggleSelected(setSelected: React.Dispatch<React.SetStateAction<Set<string>>>, path: string) {
  setSelected((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
}

function usagePercent(drive: DriveInfo): string {
  if (!drive.totalBytes || drive.freeBytes === null) return '0%'
  return `${Math.max(0, Math.min(100, ((drive.totalBytes - drive.freeBytes) / drive.totalBytes) * 100))}%`
}

// ---- Toolbar icons (inline, dependency-free; inherit currentColor) ----
const svgProps = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

function IconGrid() {
  return (
    <svg {...svgProps}>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
    </svg>
  )
}

function IconList() {
  return (
    <svg {...svgProps}>
      <path d="M6.5 5h10.5M6.5 10h10.5M6.5 15h10.5" />
      <circle cx="3" cy="5" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="3" cy="10" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="3" cy="15" r="0.95" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconEye() {
  return (
    <svg {...svgProps}>
      <path d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z" />
      <circle cx="10" cy="10" r="2.3" />
    </svg>
  )
}

function IconEyeOff() {
  return (
    <svg {...svgProps}>
      <path d="M8 4.8A7 7 0 0 1 10 4.6c5.2 0 8.2 5.4 8.2 5.4a13.4 13.4 0 0 1-2.4 2.9" />
      <path d="M5.1 5.9A13.2 13.2 0 0 0 1.8 10S4.8 15.4 10 15.4a7 7 0 0 0 2.9-.6" />
      <path d="M8.3 8.3a2.4 2.4 0 0 0 3.4 3.4" />
      <path d="M2.6 2.6l14.8 14.8" />
    </svg>
  )
}

function IconFolderPlus() {
  return (
    <svg {...svgProps}>
      <path d="M2.6 6A1.5 1.5 0 0 1 4.1 4.5h3.1L8.8 6.4H15.9A1.5 1.5 0 0 1 17.4 7.9v5.6A1.5 1.5 0 0 1 15.9 15H4.1A1.5 1.5 0 0 1 2.6 13.5Z" />
      <path d="M10 9v3.4M8.3 10.7h3.4" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg {...svgProps}>
      <path d="M10 13.2V4.6" />
      <path d="M6.4 8.2 10 4.6l3.6 3.6" />
      <path d="M3.8 13v1.4A1.6 1.6 0 0 0 5.4 16h9.2a1.6 1.6 0 0 0 1.6-1.6V13" />
    </svg>
  )
}
