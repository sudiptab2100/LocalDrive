# IPC contract (`window.ld`)

The desktop **renderer** never talks HTTP to the server; it calls the main process
through a `contextBridge` API exposed as **`window.ld`**. Three files define this
contract and must be edited **together**:

1. **`src/shared/ipc.ts`** — the `IPC` channel‑name map, the `LocalDriveApi` type (the
   shape of `window.ld`), and IPC view types.
2. **`src/preload/index.ts`** — implements `LocalDriveApi` as thin `ipcRenderer.invoke`
   wrappers (+ `on/removeListener` for push events) and calls `exposeInMainWorld('ld', …)`.
3. **`src/main/index.ts`** — `registerIpc()` provides the matching `ipcMain.handle(...)`
   for every channel and pushes events via `mainWindow.webContents.send(...)`.

Add a feature by adding a channel to `IPC`, a method to `LocalDriveApi`, a wrapper in
preload, and a handler in main — then type‑check (`npm run typecheck:node`).

## `window.ld` surface (`LocalDriveApi`)

### `ld.server`
| Method | IPC channel | Main handler behavior |
| --- | --- | --- |
| `status()` | `server:status` | `getStatus()` |
| `start()` | `server:start` | `manager.start()` + notify + `pushStatus()` |
| `stop()` | `server:stop` | `manager.stop()` + notify + `pushStatus()` |
| `restart()` | `server:restart` | `manager.restart()` + `pushStatus()` |
| `bootstrap()` | `server:bootstrap` | `manager.bootstrap()` → one‑time admin creds or `null` |
| `onStatus(cb)` | `evt:status` (push) | Subscribe to status changes; returns an unsubscribe fn |

### `ld.drives`
| Method | IPC channel | Behavior |
| --- | --- | --- |
| `listAll()` | `drives:listAll` | `syncDrives()` → `DriveInfo[]` (all detected) |
| `register(uuid)` | `drives:register` | `registerDrive` → `syncDrives()`; does not grant user access |
| `addFolder()` | `drives:addFolder` | Native folder picker → `registerFolder` |
| `unregister(uuid)` | `drives:unregister` | `unregisterDrive` → `syncDrives()` |
| `reveal(uuid)` | `drives:reveal` | Open the drive's mount in Finder |
| `onChange(cb)` | `evt:drivesChanged` (push) | Fires on hot‑plug or registry change |

### `ld.users`
| Method | IPC channel | Behavior |
| --- | --- | --- |
| `list()` | `users:list` | `UserWithAcls[]` (users + their ACLs) |
| `create(username,password,role)` | `users:create` | `createUser`; deterministic home, no drive ACL grants |
| `remove(id)` | `users:delete` | Delete; if the target was pending, emits a registrations event |
| `approve(id)` | `users:approve` | `approveUser` + registration event; drive access remains opt‑in |
| `setPassword(id,password)` | `users:setPassword` | Reset password |
| `setRole(id,role)` | `users:setRole` | `admin` \| `user` |
| `setAcl(userId,drive,pathPrefix,permission)` | `acl:set` | Upsert an ACL |
| `removeAcl(id)` | `acl:remove` | Delete an ACL |
| `onRegistrationsChanged(cb)` | `evt:registrationsChanged` (push) | `{ pending, username }` |

### `ld.access`
| Method | IPC channel | Behavior |
| --- | --- | --- |
| `list()` | `access:list` | `listPendingAccessRequests()` → `AccessRequest[]` |
| `approve(id)` | `access:approve` | `approveAccessRequest(id)` → grants `write` ACL and creates/reuses the user's drive folder |
| `deny(id)` | `access:deny` | `denyAccessRequest(id)` → marks denied and revokes the home ACL |
| `onChange(cb)` | `evt:accessRequestsChanged` (push) | Subscribe to drive access request changes |

### Top-level
| Method | IPC channel | Behavior |
| --- | --- | --- |
| `dashboard()` | `app:dashboard` | `getDashboard(true)` (admin snapshot) → `DashboardData` |
| `connect()` | `app:connect` | `{ urls, hostname, qr }` |
| `config.get()` | `config:get` | `AppConfigView` |
| `config.set(patch)` | `config:set` | Merge + `saveConfig` → new `AppConfigView` (including `autoApproveAccessRequests`) |
| `revealCert()` | `cert:reveal` | Reveal the root CA file in Finder |
| `openExternal(url)` | `app:openExternal` | `shell.openExternal` |
| `platform` | — | `process.platform` (set at preload time) |

## Push events (main → renderer)
Delivered with `webContents.send(channel, payload)` and consumed via the `on*`
subscriptions above (each returns an unsubscribe function):
- **`evt:status`** — `ServerStatus` whenever the server starts/stops/restarts
  (`pushStatus()` also refreshes the tray menu).
- **`evt:drivesChanged`** — no payload; fired by the `/Volumes` watcher and by
  `bus.emit(EVENTS.drivesChanged)`.
- **`evt:registrationsChanged`** — `{ pending: boolean, username: string }`; drives the
  desktop pending‑approvals badge and a notification when `pending` is true.
- **`evt:accessRequestsChanged`** — access request change payload; main forwards it to the
  renderer, refreshes pending counts, and shows "New access request — <user> wants <drive>"
  notifications for new pending requests.

## IPC view types (`src/shared/ipc.ts`)
- **`UserWithAcls`** = `User & { acls: Acl[] }`.
- **`DashboardData`** = `{ transfers, drives[], server, activity[], usersCount }`.
- **`ConnectInfo`** = `{ urls, hostname, qr, addresses, httpsEnabled, port, httpsPort }`.
  The `addresses`/`httpsEnabled`/`port`/`httpsPort` fields let the Connect panel compose a
  URL client-side from three dropdowns (protocol · host · service) and render the QR in the
  browser; `urls`/`qr` remain for back-compat/fallback.
- **`AppConfigView`** = the settings subset of `AppConfig` (no `jwtSecret`, no
  `registeredDriveUuids`), including `autoApproveAccessRequests`.
- **`AccessRequest`** = pending drive request item shown in the desktop Users tab.

## Notes
- The renderer runs with `contextIsolation: true` and `sandbox: false`; `window.ld` is the
  only exposed surface. Keep secrets and Node APIs out of the renderer.
- IPC handlers call server modules **directly** (same process) — there's no HTTP hop for
  the desktop UI, so these operations work even when the HTTP server is stopped.

## Related
- The equivalent HTTP surface for browser clients: [http-api.md](http-api.md).
- Where these are consumed: [frontend.md](frontend.md).
