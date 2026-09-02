import { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, dialog } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, watch, appendFileSync, type FSWatcher } from 'fs'
import { tmpdir } from 'os'
import { getServerManager } from '../server/index.js'
import { loadConfig, saveConfig, getPaths } from '../server/config.js'
import { detectDrives } from '../server/drives/detect.js'
import { syncDrives, registerDrive, registerFolder, unregisterDrive, driveMountPath } from '../server/drives/registry.js'
import {
  listUsers,
  listAcls,
  createUser,
  deleteUser,
  approveUser,
  getUserById,
  setUserPassword,
  setUserRole,
  setAcl,
  removeAcl
} from '../server/auth.js'
import { provisionUserHome, provisionDriveForAllUsers } from '../server/provisioning.js'
import { getDashboard } from '../server/dashboard.js'
import { qrDataUrl } from '../server/discovery.js'
import { pickQrUrl } from '../server/util/net.js'
import { getStatus } from '../server/status.js'
import { getCaCertPath } from '../server/tls.js'
import { bus, EVENTS } from '../server/events.js'
import { IPC, type UserWithAcls } from '../shared/ipc.js'
import type { Role, Permission } from '../shared/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = !!process.env.ELECTRON_RENDERER_URL

/** Append startup/runtime errors to a log file so failures in the packaged
 * app (which has no attached terminal) are diagnosable. */
function logError(kind: string, err: unknown): void {
  const line = `[${new Date().toISOString()}] ${kind}: ${
    (err as Error)?.stack || String(err)
  }\n`
  try {
    appendFileSync(join(getPaths().logDir, 'main.log'), line)
  } catch {
    try {
      appendFileSync(join(tmpdir(), 'localdrive-main.log'), line)
    } catch {
      /* last resort: give up quietly */
    }
  }
  console.error(kind, err)
}

process.on('uncaughtException', (e) => logError('uncaughtException', e))
process.on('unhandledRejection', (e) => logError('unhandledRejection', e))

function dialogError(err: unknown): void {
  try {
    dialog.showErrorBox(
      'LocalDrive could not start its server',
      `${(err as Error)?.message || String(err)}\n\nSee the log for details:\n${join(
        getPaths().logDir,
        'main.log'
      )}`
    )
  } catch {
    /* dialog unavailable */
  }
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let volumesWatcher: FSWatcher | null = null

function resolveResource(...names: string[]): string {
  const candidates = isDev
    ? [join(process.cwd(), ...names)]
    : [join(process.resourcesPath, ...names), join(process.cwd(), ...names)]
  return candidates.find((p) => existsSync(p)) || candidates[0]
}

function preloadPath(): string {
  const base = join(__dirname, '../preload')
  for (const f of ['index.mjs', 'index.js', 'index.cjs']) {
    const p = join(base, f)
    if (existsSync(p)) return p
  }
  return join(base, 'index.mjs')
}

function webuiDir(): string {
  return isDev
    ? join(process.cwd(), 'out', 'webui')
    : resolveResource('webui')
}

const manager = getServerManager({ webuiDir: webuiDir() })

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

function pushStatus(): void {
  mainWindow?.webContents.send(IPC.evtStatus, getStatus())
  updateTrayMenu()
}

// ---- Window & tray --------------------------------------------------------
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (e) => {
    // Keep running in the tray instead of quitting on window close.
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
}

function trayImage(): Electron.NativeImage {
  const p = resolveResource('build', 'trayTemplate.png')
  const img = existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty()
  img.setTemplateImage(true)
  return img
}

function updateTrayMenu(): void {
  if (!tray) return
  const status = getStatus()
  const url = status.urls[0] || ''
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status.running ? `Running · ${url}` : 'Stopped', enabled: false },
      { type: 'separator' },
      { label: 'Open LocalDrive', click: () => showWindow() },
      status.running
        ? { label: 'Stop Server', click: () => manager.stop().then(pushStatus) }
        : { label: 'Start Server', click: () => manager.start().then(pushStatus) },
      { label: 'Restart Server', enabled: status.running, click: () => manager.restart().then(pushStatus) },
      { type: 'separator' },
      {
        label: 'Quit LocalDrive',
        click: () => {
          ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.setToolTip(status.running ? `LocalDrive · ${url}` : 'LocalDrive · stopped')
}

function createTray(): void {
  tray = new Tray(trayImage())
  tray.on('click', () => showWindow())
  updateTrayMenu()
}

// ---- Watch external drive plug/unplug -------------------------------------
function watchVolumes(): void {
  const dir = process.env.LOCALDRIVE_VOLUMES_DIR || '/Volumes'
  try {
    volumesWatcher = watch(dir, { persistent: false }, () => {
      // Debounced re-sync + notify renderer of the change.
      setTimeout(async () => {
        await syncDrives().catch(() => {})
        mainWindow?.webContents.send(IPC.evtDrivesChanged)
      }, 600)
    })
  } catch {
    /* watching is best-effort */
  }
}

// ---- IPC ------------------------------------------------------------------
function registerIpc(): void {
  ipcMain.handle(IPC.serverStatus, () => getStatus())
  ipcMain.handle(IPC.serverStart, async () => {
    const s = await manager.start()
    notify('LocalDrive', 'Server started')
    pushStatus()
    return s
  })
  ipcMain.handle(IPC.serverStop, async () => {
    await manager.stop()
    notify('LocalDrive', 'Server stopped')
    pushStatus()
    return getStatus()
  })
  ipcMain.handle(IPC.serverRestart, async () => {
    const s = await manager.restart()
    pushStatus()
    return s
  })
  ipcMain.handle(IPC.serverBootstrap, () => manager.bootstrap())

  ipcMain.handle(IPC.drivesListAll, () => syncDrives())
  ipcMain.handle(IPC.driveRegister, async (_e, uuid: string) => {
    await registerDrive(uuid)
    await provisionDriveForAllUsers(uuid)
    return syncDrives()
  })
  ipcMain.handle(IPC.driveAddFolder, async () => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a folder to share on your network',
      message: 'Pick any folder to use as LocalDrive storage',
      properties: ['openDirectory', 'createDirectory']
    }
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return syncDrives()
    const drive = await registerFolder(res.filePaths[0])
    await provisionDriveForAllUsers(drive.uuid)
    return syncDrives()
  })
  ipcMain.handle(IPC.driveUnregister, async (_e, uuid: string) => {
    unregisterDrive(uuid)
    return syncDrives()
  })
  ipcMain.handle(IPC.driveReveal, async (_e, uuid: string) => {
    const mount = await driveMountPath(uuid)
    if (mount) shell.openPath(mount)
  })

  ipcMain.handle(IPC.usersList, (): UserWithAcls[] => {
    const acls = listAcls()
    return listUsers().map((u) => ({ ...u, acls: acls.filter((a) => a.userId === u.id) }))
  })
  ipcMain.handle(IPC.userCreate, async (_e, p: { username: string; password: string; role: Role }) => {
    const user = createUser(p.username, p.password, p.role)
    await provisionUserHome(user)
    return user
  })
  ipcMain.handle(IPC.userDelete, (_e, id: number) => {
    const target = getUserById(id)
    deleteUser(id)
    // Rejecting a pending request should refresh the admin's approvals view.
    if (target?.status === 'pending') {
      bus.emit(EVENTS.registrationsChanged, { pending: false, username: target.username })
    }
  })
  ipcMain.handle(IPC.userApprove, async (_e, id: number) => {
    const user = approveUser(id)
    if (user) {
      await provisionUserHome(user)
      bus.emit(EVENTS.registrationsChanged, { pending: false, username: user.username })
    }
    return user
  })
  ipcMain.handle(IPC.userSetPassword, (_e, p: { id: number; password: string }) =>
    setUserPassword(p.id, p.password)
  )
  ipcMain.handle(IPC.userSetRole, (_e, p: { id: number; role: Role }) => setUserRole(p.id, p.role))
  ipcMain.handle(
    IPC.aclSet,
    (_e, p: { userId: number; drive: string; pathPrefix: string; permission: Permission }) =>
      setAcl(p.userId, p.drive, p.pathPrefix, p.permission)
  )
  ipcMain.handle(IPC.aclRemove, (_e, id: number) => removeAcl(id))

  ipcMain.handle(IPC.dashboard, () => getDashboard(true))
  ipcMain.handle(IPC.connectInfo, async () => {
    const status = getStatus()
    const primary = pickQrUrl(status.urls, status.port)
    return { urls: status.urls, hostname: status.hostname, qr: await qrDataUrl(primary) }
  })

  ipcMain.handle(IPC.configGet, () => {
    const c = loadConfig()
    return {
      port: c.port,
      host: c.host,
      autoStart: c.autoStart,
      shareRootName: c.shareRootName,
      httpsEnabled: c.httpsEnabled,
      httpsPort: c.httpsPort,
      registrationEnabled: c.registrationEnabled,
      autoApproveRegistrations: c.autoApproveRegistrations
    }
  })
  ipcMain.handle(IPC.configSet, (_e, patch: Record<string, unknown>) => {
    const c = loadConfig()
    const next = { ...c, ...patch }
    saveConfig(next)
    return {
      port: next.port,
      host: next.host,
      autoStart: next.autoStart,
      shareRootName: next.shareRootName,
      httpsEnabled: next.httpsEnabled,
      httpsPort: next.httpsPort,
      registrationEnabled: next.registrationEnabled,
      autoApproveRegistrations: next.autoApproveRegistrations
    }
  })

  ipcMain.handle(IPC.certReveal, () => {
    const p = getCaCertPath()
    if (existsSync(p)) shell.showItemInFolder(p)
    else shell.openPath(dirname(p))
  })

  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))
}

// ---- Lifecycle ------------------------------------------------------------
const singleLock = app.requestSingleInstanceLock()
if (!singleLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    getPaths()
    try {
      registerIpc()
    } catch (e) {
      logError('registerIpc', e)
    }
    try {
      createWindow()
      createTray()
      watchVolumes()
    } catch (e) {
      logError('ui-init', e)
    }

    bus.on(EVENTS.drivesChanged, () => mainWindow?.webContents.send(IPC.evtDrivesChanged))
    bus.on(EVENTS.registrationsChanged, (info: { pending: boolean; username: string }) => {
      mainWindow?.webContents.send(IPC.evtRegistrationsChanged, info)
      if (info?.pending) {
        notify('New account request', `${info.username} is waiting for your approval`)
      }
    })

    // First-run admin credentials + optional auto-start. Guarded so a failure
    // here is recorded and surfaced rather than silently aborting startup.
    let created: { username: string; password: string } | null = null
    try {
      created = manager.bootstrap()
      const config = loadConfig()
      if (config.autoStart) {
        await manager.start()
        pushStatus()
      }
    } catch (e) {
      logError('server-bootstrap', e)
      dialogError(e)
    }
    if (created) {
      notify('LocalDrive is ready', `Admin login: ${created.username} / ${created.password}`)
    }

    app.on('activate', () => showWindow())
  })

  app.on('window-all-closed', () => {
    // Stay alive in the tray on macOS.
  })

  app.on('before-quit', async (e) => {
    if ((app as unknown as { didShutdown?: boolean }).didShutdown) return
    e.preventDefault()
    ;(app as unknown as { didShutdown?: boolean }).didShutdown = true
    volumesWatcher?.close()
    await manager.shutdown().catch(() => {})
    app.quit()
  })
}
