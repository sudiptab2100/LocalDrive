# Data model & persistence

LocalDrive persists three kinds of state: a **SQLite metadata DB** and a **config
file** (both in the app‑support dir), and the **actual files** on each shared drive.
Everything needed to restore after a restart lives outside the process, so a
stop/crash/restart never loses data.

## Locations
| What | Path |
| --- | --- |
| App‑support dir (`configDir`) | `~/Library/Application Support/LocalDrive/` (override: `LOCALDRIVE_HOME`) |
| Config file | `<configDir>/config.json` |
| SQLite DB | `<configDir>/localdrive.db` (+ `-wal`, `-shm`) |
| Logs | `<configDir>/logs/main.log` |
| TLS material | `<configDir>/tls/` (`ca.crt`, `ca.key`, `server.crt`, `server.key`, `leaf.json`) |
| In‑progress uploads (tus) | `<configDir>/uploads/` |
| Per‑drive share root | `<mount>/LocalDrive/` (name = `config.shareRootName`) |
| Per‑user home | `<mount>/LocalDrive/<home>/` |
| Per‑drive app data | `<mount>/.localdrive/` |

Paths are created on demand by `getPaths()` / `ensureDriveLayout*()`.

## SQLite schema (`src/server/db/index.ts`)
Opened with `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`. WAL is
flushed to the main DB file via `checkpoint()` on every server stop.

### `users`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `username` | TEXT UNIQUE | case‑insensitive uniqueness via `idx_users_username_nocase` |
| `password_hash` | TEXT | bcrypt |
| `role` | TEXT | `admin` \| `user` (default `user`) |
| `created_at` | TEXT | `datetime('now')` |
| `home` | TEXT | migration v2 — private folder name; `''` for admins |
| `status` | TEXT | migration v3 — `active` \| `pending` |

### `drives` — the drive registry
| Column | Type | Notes |
| --- | --- | --- |
| `uuid` | TEXT PK | Volume UUID, `name:<hash>` fallback, or `folder:<hash>` for custom folders |
| `label` | TEXT | volume name / folder basename |
| `last_mount_path` | TEXT | last known mount path (for offline reattach + custom folders) |
| `filesystem` | TEXT | e.g. APFS/exFAT, or `Folder` |
| `external` | INTEGER | 1 = external/removable |
| `registered` | INTEGER | 1 = shared by the admin |
| `first_seen` / `last_seen` | TEXT | timestamps |

### `acls` — per‑folder RBAC
`(id, user_id→users, drive_uuid, path_prefix, permission)` with
`UNIQUE(user_id, drive_uuid, path_prefix)` and `ON DELETE CASCADE`.
`path_prefix = ''` means the whole drive; `permission ∈ {read, write, admin}`.

### `shares` — public share links *(schema present; API not yet wired — see features.md)*
`(id, token UNIQUE, drive_uuid, path, permission, password_hash, expires_at, created_by,
created_at)`.

### `activity` — audit log
`(id, ts, user_id, username, action, detail, ip)` with `idx_activity_ts (ts DESC)`.
Written by `logActivity(action, {...})`. Actions include `login`, `login_failed`,
`login_pending`, `register`, `register_pending`, `mkdir`, `delete`, `upload`,
`drive_register`, `drive_unregister`, `server_start`, `server_stop`, `https_error`,
`user_create`/`user_delete`/`user_approve`.

### `stats` — counters
`(key PRIMARY KEY, value INTEGER)`. Bumped via `bumpStat(key, by)`; read via `getStats()`.
Known keys: `bytes_in`, `bytes_out`, `uploads`, `downloads`.

### `file_index` + `file_fts` — search
- `file_index (drive_uuid, path, name, is_dir, size, mtime_ms, mime)`, PK
  `(drive_uuid, path)`, plus `idx_file_name`.
- `file_fts` — FTS5 virtual table `(name, path, drive_uuid UNINDEXED)`.
- Populated lazily: **every directory listing indexes its entries** (`indexEntries`);
  rename/move/delete prune stale rows (`removeFromIndex`). So search coverage grows as
  folders are browsed. `.localdrive` is never indexed.

### `meta`
`(key PRIMARY KEY, value)` — holds `schema_version`.

### Migrations
Additive and idempotent, run in `getDb()`: add `users.home` (v2), add `users.status` +
the case‑insensitive username index (v3). New migrations should follow the same pattern
(guard with `PRAGMA table_info` / `IF NOT EXISTS`, never destructive).

## Config file (`src/server/config.ts`)
`config.json` is the persisted `AppConfig`. Loaded with `loadConfig()` (fills defaults,
generates + persists `jwtSecret` on first run) and written atomically via `saveConfig()`
(temp file + `rename`).

| Key | Default | Meaning |
| --- | --- | --- |
| `port` | `4820` | HTTP listen port |
| `host` | `0.0.0.0` | bind address (`127.0.0.1` = this Mac only) |
| `jwtSecret` | generated | JWT signing secret (persisted, never shipped) |
| `registeredDriveUuids` | `[]` | (legacy hint; the DB `registered` flag is source of truth) |
| `shareRootName` | `LocalDrive` | share‑root folder name created on each drive |
| `autoStart` | `true` | start the server when the app launches |
| `httpsEnabled` | `false` | serve the encrypted HTTPS listener too |
| `httpsPort` | `4843` | HTTPS port when enabled |
| `registrationEnabled` | `true` | allow self‑registration from the web login |
| `autoApproveRegistrations` | `false` | activate self‑registrations immediately |

`AppConfigView` (in `shared/ipc.ts`) is the subset exposed to the desktop Settings UI
(everything except `jwtSecret`/`registeredDriveUuids`).

## On-disk drive layout
When a drive is registered (`ensureDriveLayout*`), this structure is created on it:
```
<mount>/
  LocalDrive/                 ← share root (config.shareRootName)
    <home>/                   ← one private folder per non‑admin user
  .localdrive/                ← hidden app data, never listed/served/indexed
    tmp/                      ← same‑filesystem staging for atomic finalizes
    thumbs/                   ← cached WebP thumbnails (sha1 of path:mtime:size)
    trash/                    ← reserved (see features.md)
    versions/                 ← reserved (see features.md)
    users.json                ← portable, secret‑free user manifest (username/home/role)
```
`users.json` lets basic account info travel with the drive; it **never** contains
password hashes.

## Identity & confinement quick reference
- **Drive identity** is the stable `uuid` (survives remount/rename). Custom folders use a
  `folder:<sha1(path)>` UUID and are dropped from the registry on unregister (physical
  volumes keep a `registered=0` row).
- **User identity** for files is the `home` folder name (`sanitizeHomeName(username)`,
  unique via `-2`, `-3`, … suffixes). Non‑admins are confined to `LocalDrive/<home>/`;
  admins have `home = ''` (whole share). See [security-rbac.md](security-rbac.md).

## Related
- Access control & scoping: [security-rbac.md](security-rbac.md)
- Where these are read/written: [http-api.md](http-api.md), [architecture.md](architecture.md)
