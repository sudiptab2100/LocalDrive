# Build, run & deploy

`localdrive` v0.1.0 · Electron entry `./out/main/index.cjs` · packaged with
electron‑builder (appId `com.localdrive.app`, `productName` **LocalDrive**), **mac arm64**
DMG + zip into `release/`.

## npm scripts (`package.json`)
| Script | Command | Use |
| --- | --- | --- |
| `dev` | `electron-vite dev` | Run the full desktop app (main+preload+renderer) with HMR |
| `build:webui` | `vite build --config vite.webui.config.ts` | Build the web PWA → `out/webui` |
| `build` | `build:webui` then `electron-vite build` | Full production build of all bundles |
| `server:dev` | `tsx watch src/server/standalone.ts` | Run **just the server** (no Electron), auto‑reload |
| `server:start` | `tsx src/server/standalone.ts` | Run the server once, standalone |
| `typecheck:node` | `tsc -p tsconfig.node.json` | Type‑check main/preload/server/shared |
| `typecheck:web` | `tsc -p tsconfig.web.json` | Type‑check renderer + webui |
| `typecheck` | both of the above | **Run before shipping** |
| `rebuild` | `electron-builder install-app-deps` | Rebuild native modules for Electron's ABI |
| `package` | `build` then `electron-builder --dir` | Unpacked app (no installer) |
| `dist` | `build` then `electron-builder` | **DMG + zip** in `release/` |
| `postinstall` | `electron-builder install-app-deps` | Runs automatically after `npm install` |

Standalone server env vars: `LOCALDRIVE_HOME` (data/config dir) and `LOCALDRIVE_WEBUI`
(path to a built web UI to serve).

## Build system
Two Vite configs, by design:
- **`electron.vite.config.ts`** — three targets (main, preload, renderer). Main/preload
  emit CommonJS **`.cjs`** (hence `main: out/main/index.cjs`); renderer is a normal web
  bundle → `out/renderer`.
- **`vite.webui.config.ts`** — the standalone PWA. Uses `vite-plugin-pwa`
  (`registerType: autoUpdate`) with `navigateFallbackDenylist` for `/api` and `/dav` so
  the service worker never shadows server routes. Output → `out/webui`.

TS project split: **`tsconfig.node.json`** (Node/Electron/server + `src/shared`) and
**`tsconfig.web.json`** (browser code). Both are `strict`, ESM, path alias `@shared/*`.

## Packaging (electron-builder)
- `asar: true`, but **`asarUnpack`** for native modules that can't run from the archive:
  `better-sqlite3`, `sharp`, `@img/**`.
- **`extraResources`** copies `out/webui` → `Resources/webui` (the server serves it in
  production) and `build` → `Resources/build`.
- `files`: `out/**/*` + `package.json`. Mac target: dmg + zip, **arm64**, icon
  `build/icon.png`.
- The app is **unsigned** → first launch needs quarantine cleared (see
  [conventions.md](conventions.md#operational-gotchas)).

## Deploy playbook (proven install → verify → push)
Use this to ship a code change to the local `/Applications` install. **Docs‑only changes
skip all of this** — just commit & push.

1. **Detach stale DMG mounts:** `hdiutil detach` any `/Volumes/LocalDrive*`.
2. **Build the installer:** `npm run dist` (produces `release/mac-arm64/LocalDrive.app`).
3. **Quit the running app:** find it with `pgrep -fl LocalDrive`, then
   `kill -9 <PID>` using the **literal** numeric pid. **Never** `pkill`/`killall`
   (project rule — name‑based kills are forbidden).
4. **Install:** `rm -rf /Applications/LocalDrive.app` then
   `cp -R release/mac-arm64/LocalDrive.app /Applications/`, clear quarantine with
   `xattr -dr com.apple.quarantine /Applications/LocalDrive.app`, and `open` it.
5. **Verify health:** poll `GET http://localhost:4820/api/health` until `200`.
6. **Verify the served bundle** matches the fresh build: the hashed asset the server
   returns (e.g. `index-XXXX.js`) should equal the one in `out/webui/assets/`.
7. **Push:** `git fetch && git rebase origin/main && git push origin main`.

## Repo / CI facts
- Git repo: `github.com/sudiptab2100/LocalDrive`, default branch **`main`**.
- No CI workflows configured; typecheck + the deploy verification above are the gates.

## Related
- What each output file is: [project-structure.md](project-structure.md).
- Runtime wiring the build produces: [architecture.md](architecture.md).
