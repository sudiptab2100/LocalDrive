# Security & access control

This is the most important page to internalize before touching auth, files, uploads,
or WebDAV. The model has three layers: **authentication** (who are you),
**authorization / RBAC** (what may you do), and **confinement / scoping** (what root do
you even see). All three are enforced for **both** the web API and WebDAV.

## Authentication (`src/server/auth.ts`, `http/middleware.ts`)
- **Passwords**: bcrypt (`bcryptjs`, cost 10). Never logged or returned.
- **Web sessions**: a JWT (`jsonwebtoken`, 30‑day expiry, signed with `config.jwtSecret`)
  delivered as an **httpOnly** cookie named `ld_token` (`SameSite=Lax`, `Path=/`, `Secure`
  only on TLS requests so HTTP logins still work in dual mode). `POST /api/auth/login`
  sets it; `POST /api/auth/logout` clears it.
- **Bearer**: `Authorization: Bearer <jwt>` is also accepted (same token).
- **WebDAV**: HTTP **Basic** auth, validated against the same bcrypt accounts.
- **Resolution order** (`resolveUserRaw`): `Bearer` → `Basic` → `ld_token` cookie.
- **Pending accounts are blocked everywhere**: `resolveUser` returns a user only if
  `status === 'active'`. This single choke point blocks web, bearer, **and** WebDAV Basic
  for accounts awaiting approval.
- **Middleware**: `attachUser` (sets `req.user`), `requireAuth` (401), `requireAdmin`
  (403), `requirePermission(need)` (reads `drive` + `path` from query/body and checks RBAC).

## First-run admin
`bootstrapAdmin()` runs once when the users table is empty: it creates an `admin` with a
random one‑time password and returns it (shown once in the desktop app / standalone log).
Admins have `home = ''` and implicit `admin` permission everywhere.

## Self-registration & approval (`http/routes/auth.ts`)
- `GET /api/auth/config` → `{ registrationEnabled }` (login screen shows/hides sign‑up).
- `POST /api/auth/register` (gated by `config.registrationEnabled`):
  - Validates: username ≥ 3 chars and sanitizes to a non‑empty home; password ≥ 6 chars;
    case‑insensitive duplicate check.
  - If `autoApproveRegistrations`: create an **active** user, provision homes, sign them in
    (set cookie), emit `registrationsChanged{pending:false}`.
  - Else: create a **pending** user (no home/ACL yet), emit
    `registrationsChanged{pending:true}` → the desktop app shows a notification + badge.
- Admin approves from the desktop Users tab (or `POST /api/users/:id/approve`), which flips
  status to `active` and runs `provisionUserHome`.

## RBAC — ACLs & effective permission (`src/server/auth.ts`)
- Permissions rank: `read (1) < write (2) < admin (3)`.
- An **ACL** = `(user, drive_uuid, path_prefix, permission)`. `path_prefix = ''` = whole
  drive.
- **`effectivePermission(user, drive, path)`**:
  - Admins → `admin` everywhere (short‑circuit).
  - Otherwise, among the user's ACLs on that drive, the **most specific** matching prefix
    wins (specificity = number of path segments; `''` = 0). Ties break toward the **higher**
    permission. Returns `null` if nothing matches.
- **`hasPermission(user, drive, path, need)`** = `effectivePermission ≥ need`.

## Per-user home & confinement (`http/scope.ts`, `util/fs-safe.ts`)
This is why a normal user "sees their own files as the drive root":
- **`getUserHome(user, drive)`** → `''` for admins; the user's `home` folder if they have
  an ACL for it on that drive; otherwise `null` (no access → drive hidden).
- **`driveScope(req, drive)`** → `null` if no access, else `{ home, in(clientPath),
  out(fullPath) }`:
  - **`in`** = `scopeIn(home, p)`: prefixes `home`, normalizes, returns `null` on `../`
    escape. Maps a client (home‑relative) path to a full drive path.
  - **`out`** = `scopeOut(home, full)`: strips the `home` prefix so responses stay
    relative to the user's private root.
- **`safeResolve(root, rel)`** (`fs-safe.ts`) is the last line of defense: resolves a
  relative path against a trusted root and returns `null` if it escapes. `resolveInDrive`
  uses it for every physical access.

**Rule:** never build a filesystem path from client input without `scopeIn`/`scopeOut`
(logical confinement) **and** `safeResolve`/`resolveInDrive` (physical confinement). Route
handlers additionally block operating on the home root itself (e.g. you can't rename or
delete your own home folder: `full === scope.home` is rejected).

### Provisioning (`src/server/provisioning.ts`)
Sharing is **uniform**: registering a drive gives **every active non‑admin user** a
`write` ACL on their `home` + a physical `LocalDrive/<home>/` folder; creating/approving a
user provisions them on **every** registered drive. `backfillHomesAndProvision()` runs at
server start to reconcile (assign missing homes, provision, and strip stale whole‑drive
grants), and `ensureUserProvisioned(user)` re‑reconciles the caller on every
`GET /api/drives` (idempotent; fills only missing per‑drive ACLs) — guaranteeing a user
always sees every registered drive. There is currently **no UI to grant a specific
drive/subfolder to a specific user** even though `setAcl` / `POST /api/users/acls` support
it — see [features.md](features.md).

## WebDAV specifics (`src/server/webdav.ts`)
- Each registered online drive is mounted at a stable, slugified URL segment shared by all
  users: `/dav/<DriveName>/` (collisions get a `-<uuid6>` suffix).
- A **per‑user** webdav-server is built lazily and cached, with each drive's filesystem
  **physically rooted at that user's home** (admins get the share root). So a user can
  never see outside their home over WebDAV — mirroring `driveScope`.
- A custom `PrivilegeManager` maps WebDAV privilege checks onto `hasPermission` (prefixing
  the home back on, since the FS is home‑rooted). The virtual root `/dav/` lists the
  caller's drives.
- Requests without valid Basic credentials get a mount‑less "anonymous" handler so
  protocol handshakes (OPTIONS → DAV headers) work and resource methods get a proper 401
  challenge. Pending/unknown users also get the anon handler (blocked).
- **History/gotcha**: normal users used to 401 because the old code mounted the whole share
  root and denied them at the drive‑root collection (they have no ACL for it). Keep mounts
  home‑rooted.

## Optional HTTPS / local CA (`src/server/tls.ts`)
- mkcert‑style: a long‑lived **root CA** (~10y) signs a short‑lived **leaf** server cert
  (397 days — the max iOS/Safari accept). Install the **root CA once per device** (Settings
  → reveal/download, or `GET /api/cert`) for a trusted padlock.
- The leaf's SubjectAltNames cover loopback, every LAN IPv4, `localhost`, the bare
  hostname, and `<name>.local`. `ensureLeaf` **auto‑reissues** the leaf when files are
  missing, the SANs drift (IP changed), or it's within 30 days of expiry — the CA is
  untouched, so clients never need to re‑trust.
- Material persists under `<configDir>/tls/` (private keys written `0600`). Enabling HTTPS
  is dual‑mode: HTTP stays up; a cert‑generation failure degrades to HTTP‑only.
- `GET /api/cert` is intentionally **unauthenticated** (the CA cert is public and needed
  before a device can trust the server).

## Threat-model notes
- Plain HTTP sends credentials in the clear on the LAN — HTTPS is the mitigation.
- `host` defaults to `0.0.0.0` (whole LAN); `127.0.0.1` restricts to the host Mac.
- Path traversal is defended in depth (`scopeIn` + `safeResolve` + `isSafeName`).
- `.localdrive/` and dotfiles/AppleDouble `._` are never listed/served/indexed (dotfiles
  only via explicit `?hidden=1`, and never `.localdrive`).

## Related
- Endpoint‑by‑endpoint auth notes: [http-api.md](http-api.md)
- Schema for `users`/`acls`/`shares`: [data-model.md](data-model.md)
