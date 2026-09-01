import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc.js'
import type { LocalDriveApi } from '../shared/ipc.js'
import type { Role, Permission } from '../shared/types.js'

const api: LocalDriveApi = {
  server: {
    status: () => ipcRenderer.invoke(IPC.serverStatus),
    start: () => ipcRenderer.invoke(IPC.serverStart),
    stop: () => ipcRenderer.invoke(IPC.serverStop),
    restart: () => ipcRenderer.invoke(IPC.serverRestart),
    bootstrap: () => ipcRenderer.invoke(IPC.serverBootstrap),
    onStatus: (cb) => {
      const h = (_e: unknown, s: any): void => cb(s)
      ipcRenderer.on(IPC.evtStatus, h)
      return () => ipcRenderer.removeListener(IPC.evtStatus, h)
    }
  },
  drives: {
    listAll: () => ipcRenderer.invoke(IPC.drivesListAll),
    register: (uuid: string) => ipcRenderer.invoke(IPC.driveRegister, uuid),
    addFolder: () => ipcRenderer.invoke(IPC.driveAddFolder),
    unregister: (uuid: string) => ipcRenderer.invoke(IPC.driveUnregister, uuid),
    reveal: (uuid: string) => ipcRenderer.invoke(IPC.driveReveal, uuid),
    onChange: (cb) => {
      const h = (): void => cb()
      ipcRenderer.on(IPC.evtDrivesChanged, h)
      return () => ipcRenderer.removeListener(IPC.evtDrivesChanged, h)
    }
  },
  users: {
    list: () => ipcRenderer.invoke(IPC.usersList),
    create: (username: string, password: string, role: Role) =>
      ipcRenderer.invoke(IPC.userCreate, { username, password, role }),
    remove: (id: number) => ipcRenderer.invoke(IPC.userDelete, id),
    setPassword: (id: number, password: string) =>
      ipcRenderer.invoke(IPC.userSetPassword, { id, password }),
    setRole: (id: number, role: Role) => ipcRenderer.invoke(IPC.userSetRole, { id, role }),
    setAcl: (userId: number, drive: string, pathPrefix: string, permission: Permission) =>
      ipcRenderer.invoke(IPC.aclSet, { userId, drive, pathPrefix, permission }),
    removeAcl: (id: number) => ipcRenderer.invoke(IPC.aclRemove, id)
  },
  dashboard: () => ipcRenderer.invoke(IPC.dashboard),
  connect: () => ipcRenderer.invoke(IPC.connectInfo),
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    set: (patch) => ipcRenderer.invoke(IPC.configSet, patch)
  },
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  platform: process.platform
}

contextBridge.exposeInMainWorld('ld', api)
