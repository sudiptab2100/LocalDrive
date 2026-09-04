# Frontend guide

Two independent React 18 + TypeScript frontends live in this repo. They share **no**
code and have different jobs.

| | Web PWA (`src/webui`) | Desktop control center (`src/renderer`) |
| --- | --- | --- |
| Who | End users on phones/laptops over Wi‑Fi | The Mac operator running the app |
| Transport | HTTP (`src/webui/src/api.ts`) + tus uploads | Electron IPC (`window.ld`) — see [ipc-api.md](ipc-api.md) |
| Built by | `vite.webui.config.ts` → `out/webui` (PWA) | electron‑vite renderer → `out/renderer` |
| Entry | `src/webui/src/main.tsx` → `App.tsx` | `src/renderer/src/main.tsx` → `App.tsx` |

---

## Web PWA — `src/webui/src/App.tsx`
A single‑file file browser (~1.3k lines) plus small components. It's an installable PWA
(`vite-plugin-pwa`, `autoUpdate`) so users can "Add to Home Screen".

### Top-level state (all in `App`)
`theme` · `user` / `authChecked` · `drives` / `currentDriveId` / `currentPath` /
`entries` / `loading` · `selected` (a `Set` of names) · `viewMode` (`grid`|`list`) ·
`adminViewMode` (`admin`|`user`) · `showHidden` · `preview` · `toasts` · `searchQuery` /
`searchHits` / `searching` /
`showSearch` · `showUploader` · `dialog` (mkdir/rename/confirm) · `showConnect` /
`connectQr`.

**Persisted in `localStorage`:** `localdrive-theme` (default `dark`), `localdrive-view`
(default `list`), `localdrive-hidden`.

### Data flow
- On mount: `api.me()` establishes the session (cookie), then `api.drives()` and an
  initial `api.list(...)`. A `401` anywhere sends the user back to the `Login` view
  (handled by inspecting `ApiRequestError.status`).
- **Keeping the drive list live:** browsers aren't on the Electron event bus, so they get
  no push when drives are shared/unshared. A dedicated effect refetches `api.drives()` on
  window `focus` and `visibilitychange` (when visible) plus a ~20s interval while visible,
  so newly shared drives appear without a manual reload. `refreshDrives()` preserves the
  current selection.
- Navigation sets `currentDriveId`/`currentPath`. Selecting a non‑granted drive shows the
  request‑access panel (`none` → request button, `pending` → waiting/check again,
  `denied` → declined/request again) instead of calling `api.list`. Granted drives list
  files normally. Admins can switch **Admin view** ↔ **My space**, which writes the
  restrict‑only `ld_view` cookie and refetches. Breadcrumbs are derived from `currentPath`.
- All server calls go through the typed **`api`** object in `src/webui/src/api.ts`
  (`credentials: 'include'`), which throws `ApiRequestError(status)` on non‑2xx.

### Uploads (Uppy + tus)
- A single **`Uppy`** instance (`@uppy/core`) with the **`@uppy/tus`** plugin pointed at
  `endpoint: '/api/upload'`, `autoProceed: false`.
- Per‑file metadata (`filename`, `drive`, `path`) is set from the current location so the
  server stages + atomically finalizes into the right home dir (see
  [http-api.md](http-api.md#uploads-tus)).
- Two entry points share the instance: the **`UploadModal`** (button) and a full‑window
  **`DropZone`** (drag‑and‑drop). Uploads are **resumable** across network drops.

### Toolbar (icon buttons with hover tooltips)
Rendered as `.icon-button`s with `data-tip` tooltips (no text labels), spaced to fill the
row on mobile: **Grid/List** toggle, **Show Hidden**, **New Folder**, **Upload**, and
**Search** (opens an inline search field; the old always‑on search bar was removed).
Selection reveals a **bulk action bar** (download‑zip / move / copy / delete).

### Other UI
- **Login** component: `signin` / `register` modes, show/hide password, and a
  `canRegister` flag from `api.authConfig()` that hides the Register tab when
  self‑registration is disabled. A pending registration shows an "awaiting approval"
  message instead of logging in.
- **Preview** modal: inline images via `/api/files/raw`, text via a fetch; other types
  offer download.
- **Connect** modal: shows the QR code / URLs from `api.connect()`.
- **Drive access**: non‑admins see all registered drives but locked ones are marked with
  🔒 and use `api.requestAccess(uuid)` (`POST /api/drives/request-access`).
- **Theming**: `data-theme` on `<html>`; dark/light toggle. CSS lives in
  `src/webui/src/styles.css` with mobile breakpoints (the UI was explicitly reworked to be
  mobile‑friendly, including the modals).
- **Toasts** for success/error feedback.

---

## Desktop renderer — `src/renderer/src/App.tsx`
The operator's control center. A `topbar` (server status dot + Start/Stop/Restart), a
first‑run **bootstrap** banner showing the one‑time admin credentials, and five tabs:

| Tab | Component (`components.tsx`) | Purpose |
| --- | --- | --- |
| Dashboard | `DashboardPanel` | Transfer totals, drive capacity, recent activity (`ld.dashboard()`) |
| Drives | `DrivesPanel` | Register/unregister detected drives, add a custom folder, reveal in Finder |
| Users | `UsersPanel` | Create/approve/delete users, reset password, change role; pending account and drive access request queues; auto‑approve drive access switch |
| Connect | `ConnectPanel` | URLs + QR for onboarding clients; reveal CA cert |
| Settings | `SettingsPanel` | Edit `AppConfigView` (port, host, autostart, HTTPS, registration settings) |

- State comes entirely from **`window.ld`** (no HTTP). Live updates via the push
  subscriptions `onStatus`, `drives.onChange`, `users.onRegistrationsChanged`, and
  `access.onChange` — account and drive access events drive the **pending badge** on the
  Users tab.
- UI primitives (buttons, modals, fields, confirm dialogs) live in
  `src/renderer/src/ui.tsx`; panel styles in `src/renderer/src/styles.css`.

## Related
- API/IPC contracts: [http-api.md](http-api.md), [ipc-api.md](ipc-api.md).
- Feature status (what's wired vs roadmap): [features.md](features.md).
