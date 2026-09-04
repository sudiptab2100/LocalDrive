# HTTP & WebDAV API reference

Base URL: `http://<host>:4820` (and `https://<host>:4843` when HTTPS is enabled).
All `/api/*` JSON routes are defined under `src/server/http/`. Unless noted, requests
authenticate via the `ld_token` cookie or `Authorization: Bearer <jwt>`; errors return
`{ "error": string }` with a 4xx/5xx status.

Common concepts:
- **`drive`** = a registered drive `uuid`.
- **`path`** = **home‑relative** POSIX path (what the client sees; `''`/`/` = the caller's
  root). The server maps it to a full drive path via `driveScope` and strips it back on
  the way out. For admins in the web UI, the `ld_view` cookie can restrict scope from
  whole‑share (`admin`, default/absent) to their own userspace (`user`); it never widens
  non‑admin access. See [security-rbac.md](security-rbac.md).
- **Hidden files**: dotfiles / macOS `._` sidecars are excluded unless `hidden=1`;
  `.localdrive` is *always* excluded.

## Auth — `/api/auth` (`routes/auth.ts`)
| Method | Path | Auth | Body / query | Returns |
| --- | --- | --- | --- | --- |
| POST | `/login` | public | `{ username, password }` | `{ token, user }` + sets `ld_token`; `401` invalid, `403 {pending:true}` if awaiting approval |
| GET | `/config` | public | — | `{ registrationEnabled }` |
| POST | `/register` | public | `{ username, password }` | `{ pending:true, message }` **or** `{ pending:false, token, user }` (auto‑approve). `403` if closed; `409` duplicate; `400` validation |
| POST | `/logout` | public | — | `{ ok:true }`, clears cookie |
| GET | `/me` | auth | — | `{ user }` |
| GET | `/bootstrap` | public | — | `{ created: {username,password} \| null }` (first‑run only) |

Validation on register: username ≥ 3 chars and sanitizes to a non‑empty home; password ≥ 6.

## Drives — `/api/drives` (`routes/drives.ts`)
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/` | auth | Returns **all registered drives** as `{ drives: DriveInfo[] }` (includes `totalBytes`/`freeBytes` and `access: 'granted' | 'pending' | 'denied' | 'none'`). Admins are all `granted`; non‑admins are `granted` only if `getUserHome(user,uuid) != null`, otherwise the state comes from `getAccessMap` or `none`. No self‑provisioning. |
| GET | `/all` | **admin** | Every detected drive (registered or not) for management. |
| POST | `/register` | **admin** | `{ uuid }` → registers the drive and emits drive changes; it does not grant user access. `400` if not found / unshareable. |
| POST | `/request-access` | auth | `{ uuid }` → non‑admins request that registered drive; returns `{ access: 'pending' }` or `{ access: 'granted' }` if auto‑approved. Admins return `{ access:'granted' }`. `400` on missing/invalid uuid. |
| POST | `/unregister` | **admin** | `{ uuid }` → unshare (custom folders are removed entirely). |

Adding a **custom folder** and revealing a drive are desktop‑only (IPC), not HTTP — see
[ipc-api.md](ipc-api.md).

## Files — `/api/files` (`routes/files.ts`)
All require auth **and** an RBAC check (`hasPermission`) on the scoped path. Mutations
that target an entry check `write` on its **parent**, and refuse to act on the home root.

| Method | Path | Perm | Params | Notes |
| --- | --- | --- | --- | --- |
| GET | `/list` | read | `?drive&path&hidden` | `{ path, entries: FileEntry[] }`; folders first, then name sort; also refreshes the search index. |
| POST | `/mkdir` | write | `{ drive, path, name }` | Creates `path/name` (validated by `isSafeName`). |
| POST | `/rename` | write (parent) | `{ drive, path, newName }` | Refuses the home root. |
| POST | `/move` | write (dest + each source parent) | `{ drive, sources[], dest }` | Same drive; `dest=''` = root. |
| POST | `/copy` | read (source) + write (dest) | `{ drive, sources[], dest }` | Recursive copy. |
| POST | `/delete` | write (parent) | `{ drive, paths[] }` | Recursive delete; refuses the home root. |
| GET | `/download` | read | `?drive&path` | Streams as attachment; supports HTTP `Range` (206). |
| GET | `/raw` | read | `?drive&path` | Same but `Content-Disposition: inline` (for preview). |
| GET | `/zip` | read (each) | `?drive&paths` | `paths` = newline‑separated; streams a ZIP (archiver). |
| GET | `/thumb` | read | `?drive&path&size` | WebP thumbnail for images (sharp), `size` clamped 32–512, cached under `.localdrive/thumbs`. `415` for non‑images. |

`download`/`raw`/`zip` bump `bytes_out`/`downloads` stats on completion.

## Uploads (tus) — `/api/upload` (`routes/uploads.ts`)  {#uploads-tus}
Resumable, chunked uploads via the **tus** protocol (`@tus/server` + `FileStore`). Mounted
**before** the JSON body parser (needs the raw stream). The web client uses Uppy core +
`@uppy/tus`.

- **Metadata** the client must send: `filename`, `drive`, `path` (home‑relative dest dir).
- **Auth** (`onIncomingRequest`): every tus request (create/patch/head) must resolve to an
  active user, else `401`.
- **Authorization** (`onUploadCreate`): `drive` present, `getUserHome != null`, and
  `write` permission on the scoped destination, else `403`.
- **Finalize** (`onUploadFinish`): `finalizeUpload` moves the staged file
  (`<configDir>/uploads/<id>`) onto the drive **atomically** (`moveAtomic`: same‑FS
  `rename`, cross‑device copy‑to‑temp‑then‑rename), removes the tus sidecar, and bumps
  `bytes_in`/`uploads`. An interrupted upload can resume; a crash never leaves a partial
  file at the destination.

## Search — `/api/search` (`routes/search.ts`)
| Method | Path | Auth | Params | Notes |
| --- | --- | --- | --- | --- |
| GET | `/` | auth | `?q&drive?&hidden?` | FTS5 prefix match on filename over the lazily‑built index. |

Results are filtered to the caller's home and read permission, with the home prefix
stripped; `.localdrive` and (unless `hidden=1`) dotfiles are excluded. Capped at 100 hits.
Returns `{ query, hits: {drive,name,path,isDir}[] }`.

## Stats — `/api/stats` (`routes/stats.ts`)
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/` | auth | The dashboard snapshot (`getDashboard`). Admin‑only fields (activity log, users count) are included only for admins. |

## Users & ACLs — `/api/users` (`routes/users.ts`, **admin‑only**)
| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/` | — | `{ users: (User & {acls})[] }` |
| POST | `/` | `{ username, password, role? }` | Create a user with deterministic home; no drive ACLs are granted. `409` on username or sanitized home collision. |
| DELETE | `/:id` | — | Delete (can't delete yourself; rejecting a pending user emits an event). |
| POST | `/:id/approve` | — | Activate a pending user; drive access remains opt‑in/requested separately. |
| POST | `/:id/password` | `{ password }` | Reset password. |
| POST | `/:id/role` | `{ role }` | `admin` \| `user`. |
| GET | `/acls` | — | List all ACLs. |
| POST | `/acls` | `{ userId, drive, pathPrefix?, permission }` | Upsert an ACL. *(Endpoint exists but no desktop UI calls it yet — see [features.md](features.md).)* |
| DELETE | `/acls/:id` | — | Remove an ACL. |

## Utility routes (in `app.ts`)
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | public | `{ ok:true, status: ServerStatus }` — used by the deploy health poll. |
| GET | `/api/cert` | public | Root CA cert (`application/x-x509-ca-cert`) for client trust install; `404` if HTTPS never enabled. |
| GET | `/api/connect` | auth | `{ urls, hostname, qr }` (QR data URL for onboarding). |

## WebDAV — `/dav` (`src/server/webdav.ts`)
- Mount a drive at `http://<host>:4820/dav/<DriveName>/` with a WebDAV client, signing in
  with a LocalDrive username + password (HTTP Basic).
- Each account is **rooted at its own home** (admins get the whole share); permissions use
  the same RBAC as the API. Pending accounts are rejected.
- Returns `503` when no drives are registered. See
  [security-rbac.md](security-rbac.md#webdav-specifics-srcserverwebdavts) for internals.

## Static PWA
Any non‑`/api`, non‑`/dav` path serves the built web app (`out/webui`) with an
`index.html` SPA fallback.

## Related
- Client wrapper for these routes: `src/webui/src/api.ts` (see [frontend.md](frontend.md)).
- Auth/permission semantics: [security-rbac.md](security-rbac.md).
