# LocalDrive

Turn an external USB/HDD/SSD into a **private WiFi network drive**, controlled from a
native macOS app. Any device on the same WiFi (iPhone, iPad, Android, Mac, Windows) can
browse, upload, download, and stream your files through a browser or by mounting the drive
over WebDAV. The server can stop, crash, and restart with **no data loss**, and new drives
can be added at any time.

## Highlights

- **Native macOS app** (Electron) — a menu‑bar/tray control center. No Xcode required.
- **Two ways for clients to connect**
  - **Web UI** — an installable, mobile‑first PWA with dark mode (open `http://<your-mac>.local:<port>`).
  - **WebDAV** — mount as a normal drive in Finder / Windows Explorer / Android.
- **Accounts + per‑folder permissions (RBAC)** — read / read‑write / admin per user, per folder.
- **Resumable, large uploads** (tus protocol via Uppy) — pause/resume, drag‑and‑drop, progress.
- **Bulk actions + streaming ZIP** download of selected files/folders.
- **Thumbnails & inline preview** for images, PDFs, text, audio, and video (HTTP range requests).
- **Search** across filenames (SQLite FTS).
- **Multi‑drive + hot‑add** — drives are identified by a stable ID, so unplug/replug and
  restarts reattach automatically. Offline drives are flagged, never lost.
- **Discovery + QR connect** — Bonjour/mDNS advertising and a QR code to connect phones fast.
- **Dashboard** — storage per drive, transfer stats, activity log, connected sessions.
- **Graceful, no‑data‑loss restart** — atomic writes, WAL database with checkpoint on stop,
  and a drain‑then‑close shutdown.

## Requirements

- macOS on Apple Silicon (arm64).
- Node.js 20+ and npm (for building from source).
- An external USB/HDD/SSD to share.

## Getting started (from source)

```bash
npm install          # installs deps and rebuilds native modules for Electron
npm run dev          # run the desktop app in development
```

### Build a double‑clickable app

```bash
npm run package      # unpacked .app  -> release/mac-arm64/LocalDrive.app
npm run dist         # DMG + zip       -> release/
```

> The app is not code‑signed. On first launch, right‑click the app → **Open**, or allow it
> under **System Settings → Privacy & Security**.

## Using it

1. Launch **LocalDrive**. On first run it creates an **admin** account and shows the
   one‑time password — save it.
2. Go to the **Drives** tab and **Share** the external drive you want to serve.
3. Press **Start server** (top‑right). The status bar shows your address, e.g.
   `http://MyMac.local:8088`.
4. On another device on the same WiFi:
   - Open the **Connect** tab and scan the **QR code**, or type the URL into a browser.
   - Or mount the WebDAV URL (`http://MyMac.local:8088/dav`) in your file manager.
5. Create users and grant per‑folder access in the **Users** tab.

Files are stored on the drive under a `LocalDrive/` folder; per‑drive metadata (index,
thumbnails, in‑progress uploads) lives in a hidden `.localdrive/` folder on the same drive.
Central settings, accounts, and the drive registry live in
`~/Library/Application Support/LocalDrive/`.

## Project layout

```
src/
  main/        Electron main process (tray, window, IPC, drive hot‑plug watcher)
  preload/     contextBridge API exposed to the renderer (window.ld)
  renderer/    Desktop control‑center UI (React)
  webui/       Client web PWA served to browsers (React + Uppy)
  server/      Embedded HTTP/WebDAV server, auth/RBAC, file ops, uploads, discovery
  shared/      Types and the IPC contract shared across all of the above
```

## Scripts

| Script                | What it does                                             |
| --------------------- | ------------------------------------------------------- |
| `npm run dev`         | Run the Electron app in development                     |
| `npm run build`       | Build the web PWA + Electron bundles into `out/`        |
| `npm run build:webui` | Build only the client PWA                               |
| `npm run server:dev`  | Run the server standalone (no Electron) with hot reload |
| `npm run typecheck`   | Type‑check the whole codebase                           |
| `npm run package`     | Produce an unpacked `.app`                              |
| `npm run dist`        | Produce a DMG + zip                                     |
| `npm run rebuild`     | Rebuild native modules for Electron                     |

## Security notes

- Web sessions use a signed, httpOnly cookie; WebDAV uses HTTP Basic/Digest.
- **WebDAV Basic auth is cleartext over plain HTTP on your LAN.** A self‑signed **TLS/HTTPS**
  option is the recommended near‑term add‑on; keep the server on a trusted network until then.
- Bind address defaults to `0.0.0.0` (whole LAN). Switch to `127.0.0.1` in **Settings** to
  restrict access to this Mac only.

## Roadmap ideas

Public share links (expiry + password), trash/version history, self‑signed HTTPS, phone
photo auto‑backup, two‑way sync client, media transcoding, per‑user quotas + SMART health
alerts, duplicate finder, guest drop‑box links, and secure off‑LAN access (Tailscale/WireGuard).

## License

MIT
