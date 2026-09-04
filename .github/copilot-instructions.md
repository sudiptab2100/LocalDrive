# LocalDrive — Copilot working brief

> Auto-loaded into every Copilot session. Keep it short; deep detail lives in
> [`docs/`](../docs/README.md). Read the relevant `docs/` page before changing an area.

## What this is
A **macOS Electron app** that turns an external USB/HDD/SSD (or any folder) into a
**private Wi‑Fi/LAN network drive**. Devices on the same network access it via a
**browser PWA** and via **WebDAV** (mount in Finder/Explorer/Android). It supports
multiple drives with hot‑plug, per‑user private home folders with RBAC, resumable
uploads, thumbnails/preview, search, optional self‑signed HTTPS, self‑registration
with admin approval, and **graceful no‑data‑loss restart**.

## Tech stack
- **Electron 33** (main + preload + renderer), **React 18**, **TypeScript (strict, ESM)**.
- Build: **electron-vite** (app) + **Vite** (web PWA) + **electron-builder** (DMG/zip).
- Server: **Express 4**, **better-sqlite3** (WAL), **webdav-server**, **@tus/server**
  (resumable uploads), **sharp** (thumbnails), **archiver** (ZIP), **bonjour-service**
  (mDNS), **node-forge** (local CA/TLS), **bcryptjs** + **jsonwebtoken** (auth).
- Web client uploads via **Uppy core + @uppy/tus** (custom on‑brand UI, not the Uppy Dashboard).

## Repo map (see `docs/project-structure.md`)
```
src/main/      Electron main: tray, window, IPC handlers, /Volumes hot‑plug watcher, lifecycle
src/preload/   contextBridge — exposes window.ld (typed by src/shared/ipc.ts)
src/renderer/  Desktop control center (React): Dashboard/Drives/Users/Connect/Settings tabs
src/webui/     Client PWA served to browsers (React + Uppy/tus); App.tsx is the root
src/server/    Embedded HTTP/WebDAV server: auth/RBAC, drives registry+detect, file ops,
               tus uploads, search (SQLite FTS), discovery, TLS, config, db, lifecycle
src/shared/    Cross-process contracts: ipc.ts (IPC channels + LocalDriveApi) and types.ts
```
The server runs **inside** the Electron main process (via `ServerManager`), and can
also run standalone (`npm run server:dev`) with no Electron for fast iteration.

## Golden-path commands
```bash
npm run dev            # run the desktop app (electron-vite) in development
npm run server:dev     # run ONLY the server (tsx watch), no Electron — fastest loop
npm run typecheck      # tsc for node + web (run the matching one after edits)
npm run build          # build web PWA + electron bundles into out/
npm run dist           # produce release/ DMG + zip (electron-builder)
```
- After **web UI** edits: `npm run typecheck:web` then `npm run build`.
- After **server/main** edits: `npm run typecheck:node`.
- Only run targeted checks/builds relevant to what you changed.

## Non‑negotiable invariants (details in `docs/conventions.md` + `docs/security-rbac.md`)
- **No data loss on restart.** Writes are atomic (temp on same FS → `rename`); the DB is
  WAL with a checkpoint on stop; `ServerManager.stop()` drains in‑flight requests. Never
  write user files directly to their final path — use `finalizeUpload`/`moveAtomic`.
- **Path confinement is mandatory.** All user paths go through `safeResolve` /
  `scopeIn` / `scopeOut` (`src/server/util/fs-safe.ts` + `http/scope.ts`). Never join a
  client path onto a drive root without them.
- **Opt‑in per‑drive access.** After login, non‑admins see all registered drives but have
  no drive access by default; they request each drive and an admin approves in the desktop
  Users tab (or `autoApproveAccessRequests` grants instantly). Approval creates or reuses
  deterministic `LocalDrive/<home>/` and grants a `write` ACL; `GET /api/drives` only
  annotates access and never self‑provisions.
- **Per‑user home + RBAC.** Non‑admins are ACL‑gated and confined to `LocalDrive/<home>/`
  for drives they were granted. Admins implicitly access every drive; the web UI offers an
  `ld_view` cookie toggle (`admin` whole share by default, `user` = own space only) that
  can only restrict admins. WebDAV stays whole‑share for admins. Enforce with
  `hasPermission` / `driveScope` for **both** the web API and WebDAV.
- **Pending accounts cannot authenticate** anywhere — `resolveUser` treats non‑`active`
  users as unauthenticated (web, bearer, and WebDAV Basic).
- **`.localdrive/` is internal** (tmp/thumbs/trash/versions + `users.json`) and is never
  listed, indexed, or served. Dotfiles/AppleDouble `._` are hidden unless `?hidden=1`.
- **Keep the IPC contract in sync.** Changing `window.ld` means editing `src/shared/ipc.ts`,
  `src/preload/index.ts`, and the `ipcMain.handle` in `src/main/index.ts` together.

## Deploy / install (proven workflow — `docs/build-deploy.md`)
Docs-only changes need none of this. For shipping app changes:
1. `for v in /Volumes/LocalDrive*; do [ -d "$v" ] && hdiutil detach "$v" -force; done`
2. `npm run dist`
3. Stop the running app: `pgrep -fl "/Applications/LocalDrive.app/Contents/MacOS/LocalDrive"`
   then `kill -9 <LITERAL numeric pid>` (SIGKILL, a literal pid — never `pkill`/`killall`).
4. `rm -rf /Applications/LocalDrive.app && cp -R release/mac-arm64/LocalDrive.app /Applications/ && xattr -dr com.apple.quarantine /Applications/LocalDrive.app && open -a /Applications/LocalDrive.app`
5. Poll health: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4820/api/health` → `200`.
6. Confirm the served bundle matches the build: compare `curl -s http://127.0.0.1:4820/ | grep -o 'assets/index-[A-Za-z0-9_]*\.js'` with `ls out/webui/assets/index-*.js`.

## Git
- Remote `github.com/sudiptab2100/LocalDrive`, branch **`main`**. Rebase before push
  (`git fetch -q origin && git rebase origin/main && git push origin main`).
- Commit trailer (unless told otherwise):
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

## Knowledge base index
Start at [`docs/README.md`](../docs/README.md). Key pages:
[architecture](../docs/architecture.md) ·
[project-structure](../docs/project-structure.md) ·
[data-model](../docs/data-model.md) ·
[security-rbac](../docs/security-rbac.md) ·
[http-api](../docs/http-api.md) ·
[ipc-api](../docs/ipc-api.md) ·
[frontend](../docs/frontend.md) ·
[build-deploy](../docs/build-deploy.md) ·
[features](../docs/features.md) ·
[conventions](../docs/conventions.md) ·
[glossary](../docs/glossary.md)
