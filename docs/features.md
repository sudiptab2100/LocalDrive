# Feature catalog & status

Legend: ✅ implemented & wired · 🟡 partial / backend‑only · 🗺️ roadmap (scaffolding
present, not wired). When you touch an area, **update this file** so the roadmap stays
honest.

## Core storage & sharing
| Feature | Status | Notes |
| --- | --- | --- |
| Turn an external drive/folder into a Wi‑Fi network drive | ✅ | HTTP browser UI + WebDAV |
| Multiple drives registered at once | ✅ | Each has its own `uuid`; switch in both UIs |
| Add a **custom folder** (not just `/Volumes`) as a drive | ✅ | Desktop only (`drives.addFolder`) |
| Hot‑plug detect / online‑offline | ✅ | `/Volumes` watcher → `drivesChanged`; WebDAV remounts without restart |
| Down/up with **no data loss** | ✅ | Atomic writes, WAL checkpoint, socket drain — see [conventions.md](conventions.md) |
| Per‑user private home on every drive | ✅ | Uniform auto‑provisioning (see below) |

## Access from client devices
| Feature | Status | Notes |
| --- | --- | --- |
| Browser file manager (list/upload/download/rename/move/copy/delete/mkdir) | ✅ | [http-api.md](http-api.md) |
| Installable **PWA** | ✅ | `vite-plugin-pwa`, add‑to‑home‑screen |
| **Resumable** chunked uploads | ✅ | tus + Uppy; survives network drops |
| Drag‑and‑drop upload | ✅ | Full‑window drop zone |
| ZIP download of a selection | ✅ | `/api/files/zip` |
| Image thumbnails / inline preview | ✅ | `sharp` WebP thumbs, cached |
| Full‑text **search** by filename | ✅ | SQLite FTS5, lazily indexed |
| Grid / list views, hidden‑file toggle, dark/light theme | ✅ | Persisted in `localStorage` |
| **WebDAV** mount (`/dav/<Drive>/`) | ✅ | Per‑user rooted; HTTP Basic; works on Android/desktop clients |
| Connect helper (URLs + **QR code**) | ✅ | `/api/connect`, desktop Connect tab |
| Phone photo auto‑backup | ✅ | Via a WebDAV auto‑upload client on the phone (documented workflow, not a bespoke server feature) |

## Accounts, security, admin
| Feature | Status | Notes |
| --- | --- | --- |
| Username/password login (bcrypt + JWT cookie) | ✅ | [security-rbac.md](security-rbac.md) |
| First‑run auto‑created admin (one‑time creds) | ✅ | `bootstrap()` |
| **Self‑registration** with admin approval | ✅ | Pending users blocked until approved |
| **Auto‑approve** registrations toggle | ✅ | `autoApproveRegistrations` in Settings |
| Roles: admin / user | ✅ | Admins bypass ACLs |
| Per‑user home **confinement** | ✅ | `driveScope` + `safeResolve` |
| RBAC ACLs (`read`/`write`/`admin`, path‑prefix) | 🟡 | Engine + endpoints exist; **no desktop UI** grants selective per‑user/per‑drive ACLs yet — provisioning is uniform |
| Self‑signed **HTTPS** with local CA | ✅ | `tls.ts`; `/api/cert` to trust; auto‑reissue leaf |
| Activity log + transfer stats | ✅ | Dashboard |

### How multi‑drive sharing actually works (important)
Sharing is **automatic and uniform**, not selective:
- Registering a drive provisions a private `LocalDrive/<home>/` folder **and** a `write`
  ACL for **every** active non‑admin user.
- Creating/approving a user provisions them on **every** registered drive.
- `backfillHomesAndProvision()` reconciles this at startup, and `GET /api/drives`
  self‑heals per request via `ensureUserProvisioned()` — so a user is **guaranteed** to
  see every registered drive even if an earlier provisioning step was missed.
- Web clients aren't on the Electron event bus, so the web UI refetches the drive list on
  focus/visibility (+ a light interval); newly shared drives appear without a reload.
- There is currently **no UI** to share a specific drive/subfolder with a specific user.
  The ACL model and `POST /api/users/acls` endpoint support it — wiring a UI is the
  natural next step. Every non‑admin user sees each drive by its real name with its own
  space card.

## Roadmap / not‑yet‑wired (scaffolding present)
| Item | Status | Evidence |
| --- | --- | --- |
| Public **share links** | 🗺️ | `shares` table exists in the schema; no route/UI |
| **Trash** / recycle bin | 🗺️ | `.localdrive/trash/` dir reserved; deletes are permanent today |
| File **versioning** | 🗺️ | `.localdrive/versions/` dir reserved; not written |
| Selective ACL management UI | 🗺️ | Backend ready (see above) |

> If you implement one of these, move it up the table and update
> [data-model.md](data-model.md) / [http-api.md](http-api.md) accordingly.

## Related
- Deep security semantics: [security-rbac.md](security-rbac.md)
- On‑disk layout & tables: [data-model.md](data-model.md)
