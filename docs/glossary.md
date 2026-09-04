# Glossary

Domain terms used across LocalDrive's code and docs.

- **Drive** — a storage location LocalDrive shares: an external `/Volumes` mount **or** a
  user‑picked custom folder. Identified by a stable **`uuid`**.
- **Detected vs registered** — *detected* drives are everything enumerated under
  `/Volumes` (via `detect.ts`); a drive becomes **registered** (shared) only when an admin
  registers it. `registry.ts` reconciles the two against the DB `registered` flag.
- **Custom folder** — a drive backed by an arbitrary directory the operator picks, rather
  than a whole volume. Its `uuid` is derived as `folder:<hash>`.
- **Share root / `shareRootName`** — the top‑level folder LocalDrive creates on each drive
  to hold user data. Default name **`LocalDrive`** (`<mount>/LocalDrive/`).
- **Userspace / home** — a user's deterministic private subfolder under the share root on
  a given drive: `<mount>/LocalDrive/<home>/`, where `homeNameFor(username) =
  sanitizeHomeName(username)`. New users are rejected if the sanitized name collides; the
  stable name and `.localdrive/users.json` make the space portable across Macs.
- **Confinement** — restricting a non‑admin user so every path they request is forced
  inside their home. Implemented by **`driveScope`** (`scopeIn`/`scopeOut` translate
  between home‑relative client paths and full drive paths) plus **`safeResolve`** /
  **`resolveInDrive`**, which reject traversal (`..`) escapes.
- **Home‑relative path** — the path a client sends/sees (`''` = their root). The server
  maps it to a real filesystem path and strips the home prefix on responses. Admins
  operate on the whole share in Admin view and their own userspace in My space.
- **Access request** — a non‑admin's opt‑in request for one registered drive. Pending or
  denied state lives in `access_requests`; approval grants a `write` ACL on the user's
  userspace and creates or reuses the folder.
- **Provisioning** — current provisioning is limited to deterministic home folder
  reuse/creation (`ensureUserHomeDir`), portable manifest writes, and startup
  `backfillHomes()` normalization. Granting access is done by the access request approval
  flow, not by drive registration or user creation.
- **ACL (access control list)** — a row `(user, drive, path_prefix, permission)` granting
  a **permission** at/under a path prefix.
- **Permission** — one of `read` < `write` < `admin` (ranked). **`effectivePermission`**
  picks the most‑specific matching ACL prefix (ties resolve to the higher permission);
  admins are `admin` everywhere.
- **Role** — account‑level `admin` or `user`. Admins bypass ACLs and see management APIs;
  `user` accounts are confined and ACL‑checked.
- **View mode / `ld_view` cookie** — web‑UI admin scope toggle. `admin` (or absent) means
  whole share; `user` means the admin's own userspace. Non‑admins are always ACL‑gated, so
  the cookie can only restrict an admin and never elevates access. WebDAV has no toggle.
- **Auto‑approve access** — `autoApproveAccessRequests`; when enabled, drive access
  requests are granted immediately instead of waiting in the desktop Users tab.
- **Pending / active (status)** — a self‑registered account starts **pending** and is
  blocked from all auth until an admin **approves** it (or `autoApproveRegistrations` is
  on), at which point it becomes **active**.
- **Bootstrap** — first‑run creation of the initial admin account; the generated password
  is shown **once** in the desktop banner.
- **ServerManager** — the object (in `src/server/index.ts`) that owns the embedded
  Express/WebDAV server lifecycle: `start` / `stop(drainMs)` / `restart` / `bootstrap`
  and status.
- **Embedded server** — the HTTP/WebDAV server runs **inside** the Electron main process;
  it can also run standalone via `npm run server:dev`.
- **tus** — the resumable‑upload protocol used for `/api/upload` (server: `@tus/server`;
  client: Uppy `@uppy/tus`).
- **Atomic write / `moveAtomic`** — write to a temp file on the same filesystem then
  `rename` into place (falling back to copy‑temp‑then‑rename across devices), so readers
  never see a partial file — central to the **no‑data‑loss** guarantee.
- **WAL / checkpoint** — SQLite Write‑Ahead Logging mode; `checkpoint()` on stop flushes
  the WAL so the DB is consistent across restarts.
- **`.localdrive/`** — per‑drive metadata dir (`tmp`, `thumbs`, `trash`, `versions`,
  `users.json`) that is **never** shared, indexed, or listed to clients.
- **Local CA / leaf cert** — for opt‑in HTTPS, `tls.ts` runs a private certificate
  authority (via `node-forge`) that signs the server's leaf certificate; clients trust the
  CA once (downloaded from `/api/cert`), and the leaf auto‑reissues without re‑trust.
- **File index / FTS** — `file_index` table + `file_fts` (SQLite FTS5) powering filename
  search; populated lazily as directories are listed.
- **Registry** — `registry.ts`, the module reconciling detected drives with the DB and
  emitting `drivesChanged`.
- **Standalone mode** — running just the server (no Electron) for development, honoring
  `LOCALDRIVE_HOME` and `LOCALDRIVE_WEBUI`.

## Related
- [architecture.md](architecture.md) · [data-model.md](data-model.md) ·
  [security-rbac.md](security-rbac.md)
