import type {
  ServerStatus,
  DriveInfo,
  User,
  Acl,
  AccessRequest,
  Permission,
  Role,
  ActivityRecord
} from './types.js'

/** IPC channel names shared between the Electron main and renderer. */
export const IPC = {
  serverStatus: 'server:status',
  serverStart: 'server:start',
  serverStop: 'server:stop',
  serverRestart: 'server:restart',
  serverBootstrap: 'server:bootstrap',
  drivesListAll: 'drives:listAll',
  driveRegister: 'drives:register',
  driveAddFolder: 'drives:addFolder',
  driveUnregister: 'drives:unregister',
  driveReveal: 'drives:reveal',
  usersList: 'users:list',
  userCreate: 'users:create',
  userDelete: 'users:delete',
  userApprove: 'users:approve',
  userSetPassword: 'users:setPassword',
  userSetRole: 'users:setRole',
  aclSet: 'acl:set',
  aclRemove: 'acl:remove',
  accessReqList: 'access:list',
  accessReqApprove: 'access:approve',
  accessReqDeny: 'access:deny',
  dashboard: 'app:dashboard',
  connectInfo: 'app:connect',
  configGet: 'config:get',
  configSet: 'config:set',
  certReveal: 'cert:reveal',
  openExternal: 'app:openExternal',
  // main -> renderer push events
  evtStatus: 'evt:status',
  evtDrivesChanged: 'evt:drivesChanged',
  evtRegistrationsChanged: 'evt:registrationsChanged',
  evtAccessRequestsChanged: 'evt:accessRequestsChanged'
} as const

export interface UserWithAcls extends User {
  acls: Acl[]
}

export interface DashboardData {
  transfers: { bytesIn: number; bytesOut: number; uploads: number; downloads: number }
  drives: Pick<DriveInfo, 'uuid' | 'label' | 'online' | 'totalBytes' | 'freeBytes'>[]
  server: ServerStatus
  activity: ActivityRecord[]
  usersCount: number
}

export interface ConnectInfo {
  urls: string[]
  hostname: string
  qr: string
}

export interface AppConfigView {
  port: number
  host: string
  autoStart: boolean
  shareRootName: string
  httpsEnabled: boolean
  httpsPort: number
  registrationEnabled: boolean
  autoApproveRegistrations: boolean
  autoApproveAccessRequests: boolean
}

/** Surface exposed on `window.ld` in the renderer via the preload bridge. */
export interface LocalDriveApi {
  server: {
    status(): Promise<ServerStatus>
    start(): Promise<ServerStatus>
    stop(): Promise<ServerStatus>
    restart(): Promise<ServerStatus>
    bootstrap(): Promise<{ username: string; password: string } | null>
    onStatus(cb: (s: ServerStatus) => void): () => void
  }
  drives: {
    listAll(): Promise<DriveInfo[]>
    register(uuid: string): Promise<DriveInfo[]>
    addFolder(): Promise<DriveInfo[]>
    unregister(uuid: string): Promise<DriveInfo[]>
    reveal(uuid: string): Promise<void>
    onChange(cb: () => void): () => void
  }
  users: {
    list(): Promise<UserWithAcls[]>
    create(username: string, password: string, role: Role): Promise<User>
    remove(id: number): Promise<void>
    approve(id: number): Promise<User>
    setPassword(id: number, password: string): Promise<void>
    setRole(id: number, role: Role): Promise<void>
    setAcl(userId: number, drive: string, pathPrefix: string, permission: Permission): Promise<void>
    removeAcl(id: number): Promise<void>
    onRegistrationsChanged(cb: (info: { pending: boolean; username: string }) => void): () => void
  }
  access: {
    list(): Promise<AccessRequest[]>
    approve(id: number): Promise<void>
    deny(id: number): Promise<void>
    onChange(cb: (info: { pending: boolean; username: string; drive?: string }) => void): () => void
  }
  dashboard(): Promise<DashboardData>
  connect(): Promise<ConnectInfo>
  config: {
    get(): Promise<AppConfigView>
    set(patch: Partial<AppConfigView>): Promise<AppConfigView>
  }
  /** Reveal the root CA certificate file in the OS file manager. */
  revealCert(): Promise<void>
  openExternal(url: string): Promise<void>
  platform: string
}
