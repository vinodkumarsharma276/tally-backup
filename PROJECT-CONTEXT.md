# Backup Genie — Architecture & Project Context

Orientation for developers and AI assistants working in this repository. For end-user
instructions see [COMPLETE-GUIDE.md](COMPLETE-GUIDE.md); for the product story see
[README.md](README.md).

---

## What this is

**Backup Genie** (a product of Udgam AI) — a Windows-first desktop application that takes
automatic, versioned, deduplicated off-site backups of arbitrary folders, and restores any
folder to any retained past day.

It began as "Tally Backup Pro", a CLI that mirrored a Tally data folder to Google Drive.
That lineage explains the repository name, the `tally-backup` package name and the
surviving legacy files. The product is no longer Tally-specific.

**Current state:** `v0.0.1`, Starter edition, pre-launch. Public downloads are disabled
(`product.downloadsEnabled` in `site/src/content.js`).

**Business model:** BYOS (customer's own Drive/S3/NAS, flat licence) and a Managed tier
(vendor-hosted metered storage). See [docs/GTM.md](docs/GTM.md).

---

## The engine — `src/versioning/`

Storage-agnostic, content-addressed, git-like. This is the heart of the product.

| Module | Role |
| --- | --- |
| `Chunker.js` | FastCDC content-defined splitting, deterministic gear hash |
| `ObjectStore.js` | Content-addressed store: `objects/<2 hex>/<hash>`, gzip with magic-byte detection, SHA-256 integrity verification, put-if-absent |
| `PackedObjectStore.js` | Combines many small chunks into pack objects to cut per-request cost; pack-aware GC. Auto-enabled for the managed tier |
| `createObjectStore.js` | Picks plain vs packed store for a profile |
| `SnapshotStore.js` | Manifests at `snapshots/<id>.json` plus `refs.json`; `resolveId` / `read` / `list` / `readRefs` |
| `VersionedBackup.js` | Orchestrator: scan → chunk → upload-missing → write manifest; concurrent restore prefetch; mark-and-sweep GC |
| `RepoMarker.js` | `repo.json` identity marker: create / verify / adopt a repository |
| `RepositoryMirror.js` | Copies a whole repository between backends |
| `ManagedControlPlaneClient.js` | Fetches and refreshes short-lived managed-tier credentials |

### Store layout

```
<root>/
  repo.json             identity marker
  objects/ab/abcdef…    chunks, content-addressed, immutable
  snapshots/<id>.json   one manifest per restore point (EVERY file, by chunk hash)
  refs.json             snapshot list + "latest" pointer
```

A manifest lists every file in the source, changed or not, so any single snapshot
restores a complete folder. Unchanged files cost a manifest entry and no upload.

### Backends — `src/versioning/backends/`

Every backend implements the same five-method contract: `exists / put / get / list /
delete`. Because of that, restore, dedup and GC behave identically everywhere.

`GoogleDriveBackend` · `LocalFsBackend` (also serves network/SMB) · `S3Backend` (AWS and
all S3-compatible: R2, B2, Wasabi, MinIO) · `AzureBlobBackend` · `managed` (vends
credentials from the control plane, then reuses `S3Backend`).

`backends/index.js` is the factory: `createBackend({ config, source, driveService, flags })`
resolves the storage profile, handles secrets, connects SMB shares on Windows, and returns
`{ backend, storageLabel, profile }`. **Runners and the desktop app must go through the
factory — never construct a backend directly.**

---

## Application layers

**Desktop** — `desktop/main.js` (Electron main, ~1.3k lines: scheduler, tray, updates,
run history, IPC), `desktop/preload.js` (contextBridge), `desktop/session.js`,
`desktop/googleSignIn.js`, `desktop/trayIcon.js`, `desktop/default-config.json` (what
ships to a fresh install).

**Renderer** — `ui/src/App.jsx`, React + Vite. Six pages: Overview, Sources, Storage,
Restore, Settings, Logs.

**Runners** — `bin/versioned-backup.js`, `versioned-restore.js`, `versioned-scheduler.js`,
`versioned-verify.js`. Headless, forked as child processes by the desktop app; they stream
progress as machine-readable lines that main parses and relays over IPC. They are also the
supported automation entry points.

**Services** — `src/GoogleDriveService.js`, `src/EmailService.js`,
`src/utils/reportEmail.js`, `src/utils/SecretStore.js`, `src/utils/ConfigPathManager.js`,
`src/utils/EditionPolicy.js`, `src/utils/logger.js`, `src/utils/cliProgress.js`.

**Control plane** — `server/`. A **separate deployable** (Cloud Run, `asia-south1`), never
bundled in the installer. Licence auth, prefix-scoped credential vending, metering and
quota, billing webhooks, audit logging, the website contact endpoint, and the company
email relay. See [server/README.md](server/README.md).

**Site** — `site/`, React, deployed to GitHub Pages by `.github/workflows/site.yml`. All
copy, links and numbers live in `site/src/content.js` — edit that file, not the components.

---

## Invariants — do not break these

1. **`verify` must print `RESULT: IDENTICAL`.** Any change touching backup or restore is
   verified with `node tools/versioned-backup.js verify "<original>" "<restored>"`. This
   is the project's non-negotiable correctness gate.
2. **Chunking is 256 KB average, gzipped.** Locked by the Phase-0 measurement on real
   data (~74% dedup + ~74% compression). Smaller chunks blow up Drive API request counts.
   Do not retune without re-running `tools/measure-chunks.js`.
3. **Secrets never touch `config.json`.** Values are `secret:<key>` references resolved
   through `SecretStore` (OS vault via `keytar`) or `env:<NAME>`. `test/shipped-defaults.test.js`
   fails the build if a credential, personal path or developer host appears in the shipped
   default config.
4. **Master cloud keys never ship in the desktop app.** The managed tier gets short-lived
   (~1h), prefix-scoped (`tenants/<id>/*`) leases from the control plane, refreshed
   mid-run. Over quota, the server vends a read-only lease and the desktop pauses uploads.
5. **Never write into a folder that is not ours.** `GoogleDriveBackend._guardNotAMirror()`
   refuses to initialise inside a directory holding foreign entries (a legacy mirror's
   `DATA/`, `VHA/`, `TDL/`); `RepoMarker` verifies `repo.json` identity and requires an
   explicit adopt on mismatch. Override only via `allowMixed: true`, deliberately.
6. **Storage probes stay inside the versioned layout.** `testStorageProfile` writes to
   `objects/__probe__/…` because Drive does not remove folders when their last child goes,
   and a top-level probe folder would later trip the mirror-collision guard.
7. **Restore never overwrites a live backup source** without `--force`.
   `validateRestoreDestination` enforces this.
8. **Edition limits are enforced at run time**, in `EditionPolicy.assertBackupEdition` /
   `assertProfileChanges`, not only in the UI. Starter: one Google Drive profile, one
   destination per source, versioned only, all sources on the same profile.
9. **All paths go through `ConfigPathManager`.** It is a singleton that detects dev
   (`config/config.json` present beside the repo) versus installed
   (`Documents/BackupGenie/`), and silently migrates a legacy `Documents/TallyBackupApp/`
   folder on first start. Never build these paths by hand.
10. **Disabled sources are skipped everywhere** — runners, scheduler, email links.
    `enabled === false` is filtered before dispatch.
11. **Config resolution order is fixed**: `--config <path>` → `TALLY_CONFIG` →
    `config/config_test.json`.
12. **`main` takes no direct pushes.** Ship through a PR; CI must pass. Releases are cut
    by tagging a merged version bump ([RELEASING.md](RELEASING.md)).

---

## Config shape

Written by the desktop app to `Documents/BackupGenie/config/config.json`; the shipped
default is `desktop/default-config.json`.

- `desktop` — `autoStart`, `minimizeToTray`, `notifications`, `schedulerEnabled`
- `storageProfiles` — named, reusable: `{ "<name>": { type, …type fields } }`, where
  `type` is `google_drive | local | network | s3 | azure_blob | managed`
- `backup.sources[]` — `name`, `operation` (`backup` | `restore`), `enabled`,
  `sourcePaths[]` (or legacy `sourcePath`), `storageProfile` (or `storageProfiles[]` for
  3-2-1 fan-out), per-source `schedule`, and for restore sources a `restore` sub-object
  (`mode`, `snapshotId`, `cleanDest`). `mode: "mirror"` selects plain folder-copy via
  `MirrorBackup.js` (local/network destinations only; blocked in Starter)
- `backup` — `schedule`, `concurrency` (8), `compressionLevel`, `catchUpMissed`,
  `catchUpWithinHours` (48)
- `retention.keepDailyBackups` — restore points kept; GC frees the rest
- `email` — `mode: "company"` (control-plane relay, the shipped default) or own SMTP
- `googleDrive`, `logging`, `account`

Backward compatibility: a source's old Drive-only `backupFolderName` still maps to a
default `google_drive` profile. Keep that path working.

---

## Working in this repo

```bash
npm install
npm run dev:desktop   # Vite renderer + Electron
npm test              # every suite in test/ (scripts/run-tests.js)
npm run site:dev
```

- **Read before you write.** Copy the patterns in `src/versioning/*` and `bin/versioned-*.js`
  rather than inventing new ones.
- **Tests are the spec.** `test/` covers edition policy, repo markers, multi-source and
  multi-destination fan-out, per-profile retention, selective-root restore, Drive rate
  limiting and root guards, mirror mode, email reporting, config migration and shipped
  defaults. Add a suite with any behaviour change.
- **CI** (`.github/workflows/ci.yml`) runs the engine suite and the control-plane suite
  separately on Node 24, on every PR and push to `main`. `keytar` needs `libsecret` on
  Linux; Electron's binary download is skipped.
- **Logging** — the singleton in `src/utils/logger.js`. Daily rotation, 30-day retention,
  `tally-backup-%DATE%.log` and `error-%DATE%.log` under the resolved logs directory.
- **Progress output** — `src/utils/cliProgress.js` is the single wrap-safe implementation
  shared by every runner and tool. Do not hand-roll another.

### Developer tools — `tools/`

| Tool | Purpose |
| --- | --- |
| `versioned-backup.js` | Full-featured CLI: backup, restore, verify, test-storage, against any backend |
| `measure-chunks.js` | Phase-0 chunk-delta measurement; the basis for the 256 KB decision |
| `auth.js` | Interactive OAuth against a named config, for isolated test accounts |
| `migrate-secrets.js` | Moves plaintext credentials out of an old config into the OS vault |

### Legacy surface — present but not the supported path

`index.js`, `bin/tally-backup.js`, `bin/manual-backup.js`, `bin/restore.js`,
`bin/status.js`, `src/TallyBackup.js`, `src/TallyRestore.js`, the root `setup-*.js`
wizards and `install-tally-backup.bat` all predate the desktop app and the versioned
engine. They still carry pre-rebrand branding and the old flat config schema. Do not
extend them; new work belongs in the versioned engine and the desktop app.

---

## Where the product is going

Implemented per [plans/restore-ui-gtm-plan.md](plans/restore-ui-gtm-plan.md): Phase A
(config-driven restore), B (Electron, tray, secrets, packaging), D (pluggable backends),
E (managed control plane).

Announced next, per `site/src/content.js`: sign-in/sign-up accounts, data hiding, access
control and roles, the managed cloud tier, macOS and Linux builds, a fleet dashboard.

Launch blockers, per [docs/GTM.md](docs/GTM.md): Windows code-signing certificate,
verified Google OAuth consent screen, live payment keys, Privacy Policy / Terms / DPA, and
the business address and legal-entity placeholders still sitting as TODOs in
`site/src/content.js`.
