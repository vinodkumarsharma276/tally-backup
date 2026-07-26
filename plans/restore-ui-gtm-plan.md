# Plan: Config-driven Restore + Electron GUI + Go-to-Market

Three workstreams:
1. Config-driven local **RESTORE** for the versioned engine, reusing the `operation` pattern.
2. An **Electron desktop app** (Windows-first + Mac) that edits config & runs backup/restore, distributed as a signed installer.
3. A **sales & marketing** playbook (deferred teaching until software is operational).

## Decisions locked (from user)
- Restore reuses existing `backup.sources[]` + `operation:"restore"` pattern; `sourcePath` IS the local destination (no new field). Add a NEW `restore` sub-key for nature + cadence (manual + scheduled).
- Validate restore by restoring the versioned store `Tally Backup New` → a fresh local folder.
- UI shell = Electron (native window + tray + auto-update). Windows first, Mac too. Keep background service / Task Scheduler for unattended runs.
- Every source gets an `enabled` (bool, default true) key; disabled sources are skipped.
- Daily scheduled runs must show LIVE progress via a system-**tray icon** (chosen over popping a cmd window): hover tooltip = % + GB + ETA; click = open progress window.
- Revamp email to versioned terminology + include Drive links for BOTH backup AND restore folders of all ACTIVE (enabled) sources.
- **Pluggable storage destinations** beyond Google Drive — local folder, network/NAS (SMB/UNC), and other clouds (Amazon S3 + S3-compatible, OneDrive). Engine is already backend-agnostic (`exists/put/get/list/delete`); add backends + a factory + named storage profiles + per-provider auth.
- **Storage tenancy choice** surfaced at onboarding + pricing: (1) BYOS = customer's own Drive/S3/local/NAS (Phase D), vs (2) MANAGED = vendor-hosted cloud (Phase E), a paid subscription add-on. Managed backing store DEFAULT = Cloudflare R2 / Backblaze B2 (S3-compatible → reuses S3Backend; cheap/zero egress = best margin); AWS S3 optional premium "named" tier; Azure Blob/GCS later. Encryption v1 = server-side at rest (SSE); client-side zero-knowledge = roadmap.
- **Assisted onboarding** — double-click installer; first-run config done by the shop owner OR a vendor employee (on-site/remote). Support config export/import bundle (or a setup code) for remote assist.

---

## PHASE A — Config-driven local Restore (versioned)

Goal: a source with `operation:"restore"` pulls the LATEST (or pinned) snapshot from the Drive versioned store named by `backupFolderName` and reassembles it into `sourcePath`. Supports manual trigger and an independent schedule. Engine already exists & is verified (`VersionedBackup.restore` + tools restore `--drive`); work is the config wiring + cadence + runner + tests.

### Config schema addition (per restore source in `backup.sources[]`)
- existing: `name`, `operation:"restore"`, `sourcePath` (= DESTINATION), `backupFolderName` (= Drive store to restore FROM)
- NEW `enabled` (bool, default true) — present on ALL sources (backup + restore); disabled ⇒ skipped.
- NEW optional `restore` object:
  - `mode`: `"manual"` | `"scheduled"` (default `"manual"`)
  - `schedule`: cron string (used when `mode=="scheduled"`; independent of `backup.schedule`)
  - `snapshotId`: `"latest"` | `"<id>"` (default `"latest"`)
  - `cleanDest`: bool (default false) — if true, empty the dest dir before restore (mirror semantics)
  - `timezone`: optional (default `Asia/Kolkata`)

### Steps
- **A0.** Add `enabled` (default true) to every source in `config_test.json`/`config.json`. Both runners filter out `enabled === false` sources BEFORE dispatch.
- **A1.** Add a restore runner `bin/versioned-restore.js` (mirror of `bin/versioned-backup.js` structure):
  - `resolveConfigPath()` (same as backup runner: `--config` | `TALLY_CONFIG` | `config/config_test.json`)
  - load config; init `GoogleDriveService` once.
  - select restore sources: `config.backup.sources.filter(s => s.operation === 'restore')`.
  - CLI selectors: `--source "<name>"` (one), `--all` (default), `--snapshot <id|latest>` override, `--dest <path>` override, `--dry-run` (list snapshot + file count, no writes).
  - per source: `new GoogleDriveBackend({rootFolderName: source.backupFolderName})`; `backend.init()`; build `VersionedBackup`; resolve `snapshotId` (`source.restore.snapshotId || 'latest'`); if `cleanDest`: `fs.emptyDir(dest)`; call `engine.restore(id, source.sourcePath, {onProgress: renderProgress})`.
  - reuse the wrap-proof `renderProgress` (factor it into a shared helper, see A4).
  - email summary via `EmailService` (add a method or reuse success template).
- **A2.** Pre-flight dest validation (reuse legacy idea from `src/TallyBackup.js` `validateAndCreateRestoreDestinations`): ensure dest dir exists + writable before restoring; never restore onto the live BACKUP source path. Guard: refuse if `dest === any backup source.sourcePath` unless `--force` (avoid clobbering live data).
- **A3.** Scheduling integration:
  - Add a headless scheduler entry (extend `index.js` OR new `bin/scheduler.js`) that registers: backup cron (`backup.schedule`) → runs `bin/versioned-backup.js` logic; one cron PER restore source where `restore.mode=="scheduled"` (`restore.schedule`).
  - node-cron, timezone `Asia/Kolkata`. The Windows service / Task Scheduler keeps this alive.
  - Manual-mode restore sources are NOT scheduled; only run on demand (CLI/UI).
- **A4.** Refactor: extract `renderProgress` into `src/utils/cliProgress.js` (used by `bin/versioned-backup.js`, `bin/versioned-restore.js`, `tools/versioned-backup.js`) — single wrap-safe implementation.
- **A5.** `package.json` scripts: add `"restore-versioned": "node bin/versioned-restore.js"`, `"restore-versioned-manual": "node bin/versioned-restore.js --source"`.

### Relevant files
- `src/versioning/VersionedBackup.js` — `restore(idOrLatest, destDir, {onProgress})` (DONE/verified).
- `src/versioning/SnapshotStore.js` — `resolveId/read/list/readRefs`.
- `src/versioning/backends/GoogleDriveBackend.js` — `init()` guard allows versioned store only.
- `bin/versioned-backup.js` — template for the new runner (config load, per-source backend, email).
- `src/TallyBackup.js` `validateAndCreateRestoreDestinations()` — reuse dest-validation pattern.
- `config/config_test.json` — add `restore` sub-key to a restore source; for TEST set `operation:"restore"`, `backupFolderName:"Tally Backup New"`, `sourcePath:"temp/restore-config-test"`.
- `index.js` / `src/TallyBackup.js` `start()` — scheduler wiring for per-source restore cron.

### Verification
1. Manual restore runner restores latest snapshot of `Tally Backup New` into the configured dest.
2. `node tools/versioned-backup.js verify "Tally Data Day2" "<dest>"` → **RESULT: IDENTICAL**.
3. Dry-run prints snapshot id + file/byte counts, writes nothing.
4. `cleanDest=true` empties dest first; `cleanDest=false` overwrites in place.
5. Scheduled mode: set a near-future cron, confirm it fires once and emails summary.
6. Guard: attempt restore with `dest == backup sourcePath` → blocked without `--force`.

---

## PHASE B — Electron desktop app + distribution

Goal: non-technical user double-clicks a desktop icon, sees a native window (Electron), can: set folders/email/schedule, toggle legacy-mirror vs versioned flow, Run Backup Now, Restore (pick a restore point), view live progress + logs, manage Drive auth. Background service keeps unattended backups running. Ship signed installers (Win NSIS + Mac dmg) with auto-update.

### Architecture
- Electron main process (Node) = control plane. Renderer (HTML/CSS/JS, light framework e.g. Vite+React or plain) = UI. Heavy work (backup/restore) runs in a forked child process (`fork bin/versioned-backup.js` / `bin/versioned-restore.js`) so the UI stays responsive; stream stdout/progress → IPC → renderer.
- Reuse ALL existing Node modules directly (`ConfigPathManager`, `GoogleDriveService`, `VersionedBackup`, `EmailService`, `BackupState`). No rewrite of core logic.
- Background scheduling stays in the existing node-windows service / Task Scheduler running a headless scheduler (Phase A3). Electron app is the editor/monitor; on config save it signals the service to reload (touch a flag file or restart the service).

### Steps
- **B1. UI/server foundation** (works in dev before packaging): add `desktop/main.js` (Electron main), `desktop/preload.js` (contextBridge IPC), `ui/` (renderer). IPC surface: getConfig, saveConfig, runBackupNow (fork runner), runRestore (fork restore runner), listSnapshots, getStatus, tailLogs, startAuth, testEmail. Progress: child prints progress JSON lines; main parses → `webContents.send` → renderer bar. Screens: Dashboard, Config, Flow toggle, Restore points, Logs, Auth, Schedule editor.
- **B2. Secrets hardening** (required before distribution): move Gmail app password + OAuth token + credentials out of plaintext `config.json` into OS secure storage (Electron `safeStorage` DPAPI/Keychain or keytar). Migration on first run.
- **B3. OAuth productization**: one Google Cloud project; consent screen verified for production; scope stays `drive.file`; each customer authorizes their own Drive via loopback + PKCE; add privacy policy + branding.
- **B4. Packaging & installers** (electron-builder): Windows NSIS .exe (+ shortcuts + scheduler service/Task Scheduler), Mac dmg/pkg + LaunchAgent + notarization; auto-update via electron-updater.
- **B5. Code signing / trust**: Windows OV/EV cert (avoid SmartScreen); Apple Developer ID + notarization (avoid Gatekeeper).
- **B6. First-run onboarding wizard** (replaces inquirer `setup-*.js`): pick Tally data folder(s), CHOOSE STORAGE TENANCY (BYOS vs MANAGED + plan), sign in / enter keys / pick path, set schedule, send test email. ASSISTED ONBOARDING: owner OR vendor employee can run it; support config export/import bundle (or setup code).
- **B7. Daily-run progress feedback — system-tray icon** (chosen over cmd window). Electron Tray API + nativeImage: idle / running / success / error states. Hover tooltip with %/GB/ETA; click opens progress window; completion balloon. Optional "Show console" advanced toggle. **SESSION-0 caveat**: a Windows service runs headless (no UI) → can't show a tray icon. Resolution (v1): run scheduler + workers INSIDE the Electron app, auto-started at login, living in the tray (backups run while logged in). If logged-out runs needed later: headless worker service + tray companion in the user session reading worker progress.
- **B8. Email revamp** (templates currently use OLD mirror wording): rewrite `generateSuccessEmailWithMultipleLinks` + failure template in `src/EmailService.js` to versioned terms — per active source: operation, snapshot id in IST, files, total size, NEW vs CHURN chunks, dedup %, uploaded/restored MB, duration, retention/GC (restore points kept), next scheduled run (IST). Include Drive folder link for BOTH backup AND restore folders of every ENABLED source. Honor `config.email.includeDriveLink`/`includeStats`; subject reflects backup vs restore.

### Relevant files
- NEW: `desktop/main.js`, `desktop/preload.js`, `ui/*` (renderer), electron-builder config in `package.json`.
- `src/utils/ConfigPathManager.js` — `getConfigPath`/load/save; installed paths `~/Documents/TallyBackupApp`.
- `bin/versioned-backup.js`, `bin/versioned-restore.js` — forked by the app for work + progress streaming.
- `scripts/install-windows-service-pro.js`, `install-linux-service-pro.js`, `setup-task-scheduler.bat` — reuse/extend; add Mac LaunchAgent installer.
- `src/GoogleDriveService.js`, `setup-auth.js` / `tools/auth.js` — wrap OAuth loopback for in-app sign-in.
- `src/EmailService.js` — `generateSuccessEmailWithMultipleLinks` (~283), `sendBackupSuccessWithMultipleLinks` (~257), `generateFailureEmail` (~170): rewrite to versioned wording + enabled-source Drive links.
- `package.json` — add deps: electron, electron-builder, electron-updater, keytar (or use safeStorage); add build/ config + dist scripts.

### Verification
1. `npm run dev:desktop` opens the window; Config screen reads/writes config via `ConfigPathManager`.
2. Run Backup Now → forks runner → live progress in UI → snapshot appears in Restore points.
3. Restore point → pick dest → restore → verify IDENTICAL.
4. Secrets: confirm Gmail/OAuth no longer in plaintext `config.json` after migration.
5. electron-builder produces a signed Windows .exe; install on a clean VM (no Node) → app launches, scheduler registered, unattended backup runs at scheduled time.
6. Auto-update: bump version, publish, confirm self-update.
7. TRAY: scheduled run shows running state + tooltip; click opens window; completion balloon.
8. EMAIL: versioned wording + IST + new/churn/dedup + GC/restore points + next run + Drive links for every enabled source.
9. ENABLED: set a source `enabled:false` → skipped by runner and absent from email links.

---

## PHASE C — Sales & Marketing playbook (Tally backup SaaS, India SMB)

**DEFERRED by user: do the in-depth sales/marketing teaching AFTER the software is fully operational.** Outline kept for reference; run a dedicated GTM/teaching session later.

- **ICP**: Tally-using SMBs/retailers/shops, CAs/accountants, Tally resale partners.
- **Positioning**: "Never lose your Tally data — automatic, versioned, encrypted daily backups to YOUR own Google Drive. Restore any day in minutes."
- **Pricing**: annual subscription per company/seat + tiers (Basic/Pro/Multi-company); optional one-time + AMC. Free 14–30 day trial.
- **Channels**: (1) Tally Solution Partners / resellers (co-sell, rev-share) — biggest lever; (2) CAs & accountants (referral program); (3) digital — Google Search ads on "tally backup", YouTube how-tos, WhatsApp/Telegram SMB groups; (4) local IT/AMC vendors.
- **Funnel**: awareness → free trial → self-serve onboarding (the Electron wizard) → paid → retention.
- **Trust**: data-security page, testimonials, "your data in your Drive" message, restore demo video.
- **Metrics**: trial→paid conversion, CAC, LTV, churn, payback. Start with 10 design-partner shops.
- **Gating items**: Google OAuth verification + privacy policy; code-signing; basic SLA/support docs.

---

## PHASE D — Pluggable storage destinations (beyond Google Drive)

Goal: let the user choose WHERE the versioned store lives: Google Drive (existing), a local folder, a network/NAS drive (SMB/UNC), or other clouds (Amazon S3 + S3-compatible, OneDrive). The engine is ALREADY storage-agnostic — `VersionedBackup`/`ObjectStore`/`SnapshotStore` only call backend `exists/put/get/list/delete`. So restore/dedup/GC work identically on every backend. Work = new backend classes + a factory + config "storage profiles" + per-provider auth + secret storage + UI.

### Config approach — named, reusable storage profiles (top-level), referenced by sources
- `storageProfiles`: `{ "<name>": { type, ...type-specific fields, secretRef } }`
- Each source: replace Drive-only `backupFolderName` with `storageProfile: "<name>"` + `rootPath` (the folder/prefix within that storage). Keep `backupFolderName` as a backward-compat alias mapping to a default `google_drive` profile + root, so existing configs keep working.
- Optional `destinations: ["<profileA>", "<profileB>"]` per source for 3-2-1 redundancy (further consideration).

### Auth models
- **A) Static API keys** — Amazon S3 and all S3-compatible (Backblaze B2, Wasabi, Cloudflare R2, MinIO): user creates Access Key ID + Secret in the provider console and pastes them in (+ region + bucket, + endpoint for non-AWS). No browser/OAuth. Simplest + most reliable for unattended servers. Store keys in OS secure store. Tip: least-privilege IAM user limited to the backup bucket.
- **B) OAuth 2.0 + refresh token** — Google Drive (DONE), OneDrive (Microsoft Graph / Azure AD), Dropbox: "Connect" → browser consent → loopback code → access + refresh tokens. Requires registering one app per provider + production verification. OneDrive: Azure AD app registration, MSAL, scope `Files.ReadWrite.AppFolder` or `Files.ReadWrite`.
- **C) OS / network credentials** — local FS and SMB/NAS: OS handles access. Mapped drive (`Z:\`) or UNC (`\\server\share`) needs no app auth if already authenticated; optionally store an SMB user/pass and run `net use` first, or rely on Windows Credential Manager. Verify writable at init.

### Backends & steps
- **D1. Local + Network/NAS**: REUSE existing `LocalFsBackend` for type `"local"` (local dir) AND type `"smb"/"network"` (UNC path or mapped drive). Add pre-init SMB connect (optional creds via `net use`) + writable + free-space checks. Trivial — biggest value for least effort.
- **D2. S3Backend** (NEW `src/versioning/backends/S3Backend.js`) via `@aws-sdk/client-s3`: exists=HeadObject, put=PutObject, get=GetObject(stream→buffer), list=ListObjectsV2(prefix, paginate), delete=DeleteObject. Config: `{ bucket, region, endpoint?, forcePathStyle?, accessKeyId(secretRef), secretAccessKey(secretRef), prefix }`. Build an in-memory key Set by listing the `objects/` prefix once at init (like the Drive listing cache) so put-if-absent dedup is cheap. One backend covers AWS + all S3-compatible providers.
- **D3. OneDriveBackend** (NEW `src/versioning/backends/OneDriveBackend.js`) via Microsoft Graph + `@azure/msal-node`: app-folder or path-addressed items; refresh-token flow mirroring `GoogleDriveService`; upload via PUT /content (simple PUT fine for ~256KB chunks).
- **D4. Backend factory** (NEW `src/versioning/backends/index.js` → `createBackend(profile, secrets, driveService?)`): `switch(profile.type){ google_drive | local | smb | s3 | onedrive }`. Runners and the Electron app call the factory instead of `new GoogleDriveBackend`.
- **D5. Secret resolution**: each profile has a `secretRef`; actual keys/tokens live in OS secure store (Phase B2), never plaintext.
- **D6. UI** (Electron, Phase B): "Storage destinations" screen — add/edit profiles, pick provider, run the right auth flow, "Test connection" probe (write+read+delete), then assign a profile per source.

### Relevant files
- `src/versioning/backends/LocalFsBackend.js` (reuse for local + NAS), `GoogleDriveBackend.js` (reference).
- NEW: `src/versioning/backends/S3Backend.js`, `OneDriveBackend.js`, `index.js` (factory).
- `bin/versioned-backup.js`, `bin/versioned-restore.js` — swap direct `new GoogleDriveBackend` for `createBackend()`.
- `src/GoogleDriveService.js` — pattern for the OAuth/refresh-token flow to mirror for OneDrive.
- `config/config_test.json`, `config.json` — add `storageProfiles` + per-source `storageProfile`/`rootPath`.
- `package.json` — add deps: `@aws-sdk/client-s3`, `@azure/msal-node` + `@microsoft/microsoft-graph-client`. Local/NAS need no new deps.

### Verification
Per backend type: run backup → restore latest → `tools/versioned-backup.js verify` ⇒ **RESULT: IDENTICAL**, for: (1) local folder, (2) NAS/UNC path, (3) S3 (real AWS or MinIO/Backblaze), (4) OneDrive. Confirm dedup (second day uploads only delta) and GC work on each. "Test connection" probe succeeds/fails clearly with bad creds.

Effort/priority order: Local + NAS (trivial) → S3 & S3-compatible (easy, key auth, many providers) → OneDrive (OAuth + Azure app + verification).

---

## PHASE E — Managed cloud storage (vendor-hosted, metered, paid add-on)

Goal: offer YOUR cloud as a paid storage tier so non-technical customers don't need their own Drive/S3. Customer picks storage tenancy at onboarding: BYOS (Phase D) or MANAGED (this phase). **HARD RULE: master cloud keys NEVER ship in the desktop app** — access is vended short-lived + prefix-scoped by a control plane.

### Decisions
- Managed backing store DEFAULT = Cloudflare R2 / Backblaze B2 (S3-compatible → reuses S3Backend; cheap/zero egress, best margin). Optional premium "named" tier = AWS S3. Azure Blob / GCS later if demanded.
- Encryption v1 = server-side at rest (SSE-S3/SSE-KMS or equiv). Roadmap = optional client-side zero-knowledge per-customer key (must solve key-recovery UX; lost key = lost data).
- Tenant isolation = single bucket, prefix-per-tenant `tenants/<tenantId>/...`; access scoped by STS/SAS/short-lived token to that prefix only.

### Components (server infrastructure, beyond the desktop app)
- **E1. Control-plane API** (vendor-hosted): accounts, subscription/billing status, license/device activation, CREDENTIAL VENDING (AWS/R2/B2: STS AssumeRole / GetFederationToken; Azure: SAS; GCS: short-lived token) scoped to `tenants/<id>/*`, ~1h TTL, app auto-refreshes. Master creds stay server-side only. Make it HA.
- **E2. Desktop integration**: NEW storage profile type `"managed"` — app authenticates to control-plane (account login + license key), fetches temp creds, uses the EXISTING S3Backend pointed at the managed bucket+prefix. Factory refreshes creds before expiry mid-run.
- **E3. Metering & quota**: control-plane records bytes stored + uploaded per tenant; reconcile via bucket inventory. Enforce plan quota; warn at 80/100%; handle overage.
- **E4. Billing**: Razorpay (India) / Stripe subscriptions; plan→quota map (e.g., 25 / 100 / 500 GB tiers); dunning + grace period; on lapse, pause new uploads but retain data N days.
- **E5. Cost controls**: lifecycle old chunks to cheaper storage class; consider PACK FILES (combine many ~256KB chunks into larger pack objects + a pack index) for the managed tier to cut per-request costs. Packing = ObjectStore enhancement; managed-tier optimization, optional for BYOS.
- **E6. Compliance/ops**: privacy policy + data-processing terms; India DPDP Act; data-residency region choice; SSE key rotation; audit logging; uptime monitoring.

### Pricing/packaging
Two SKUs at onboarding — BYOS (software-only, cheaper) vs MANAGED (software + storage, tiered GB, price = your cloud cost × 2–4 margin). Upsell: start BYOS → convert non-technical users to Managed.

### Relevant files / additions
- `src/versioning/backends/S3Backend.js` (Phase D) — reused for R2/B2/AWS via endpoint; managed tier adds a creds-provider hook.
- NEW storage profile type `"managed"` + control-plane client (fetch+refresh temp creds) wired in the backend factory.
- NEW `server/` control-plane (separate deployable; NOT bundled in the desktop installer).
- Electron onboarding: "Choose storage" step → BYOS vs Managed.

### Verification
1. Control-plane vends scoped temp creds; app writes/reads ONLY its tenant prefix; cross-tenant denied.
2. Backup + restore + verify IDENTICAL against the managed bucket using vended creds.
3. Creds auto-refresh across a long run without interruption.
4. Quota enforced; metering matches bucket usage within tolerance.
5. Subscription lapse pauses uploads; data retained through grace period.

Sequencing: ship BYOS (Phase D) FIRST; build Phase E AFTER the control-plane infra is stood up.

---

## Cross-cutting decisions & scope
- Reuse existing operation-based source pattern; no breaking changes to backup flow.
- Restore engine reused as-is (already verified byte-identical from Drive).
- Keep legacy mirror flow available behind the UI "flow toggle"; default new installs to versioned.
- Out of scope (now): web/SaaS multi-tenant portal, mobile app. (Multi-cloud/local/NAS destinations are now IN scope — Phase D. Dropbox/Box can follow the same backend pattern later.)

## Open considerations (recommendations)
1. Service config reload: restart service on config save (Option A, recommended for v1) vs file-watch reload (Option B).
2. Restore overwrite semantics default: `cleanDest=false` (safe, in-place overwrite). Mirror delete only when explicitly enabled.
3. Renderer stack: plain HTML+JS (zero build) vs Vite+React (recommended for maintainability).

---

## Handoff & implementation notes (for the implementing model/dev)

### Mandatory STOP-GATE / model-selection protocol (per section)
Before STARTING each Phase/section, the implementing agent MUST:
1. STOP and do NOT write any code yet.
2. Tell the user the upcoming section name + its difficulty tier (LOW / MEDIUM / HIGH-security-critical).
3. RECOMMEND which model tier executes this section well (mapping below) and why.
4. WAIT for the user to choose/confirm the model. Only AFTER the user confirms, proceed.
5. At the END of the section, STOP again, report what was done + verification results, and repeat the gate for the next section.

**Context note:** user has 1M-context available for ALL models, so context size is NOT the deciding factor — recommend based on REASONING + code-gen quality + security-risk, not token budget.

### Model-tier recommendation per section
- **LOW / mechanical** → a cost-efficient model is fine: Phase A (restore wiring + enabled + cadence), D1 (local/NAS reuse), B8 (email rewrite), A4 (progress refactor).
- **MEDIUM** → a capable mid/strong model: D2 (S3Backend), B1 (Electron UI + IPC), B7 (tray).
- **HIGH / security-critical** → strongest available frontier model + HUMAN review (do not auto-merge): D3 (OneDrive OAuth), B2 (secret storage), B4/B5 (packaging + code-signing + notarization), and ESPECIALLY Phase E (credential vending, tenant isolation, billing) = data-breach risk if wrong.

### How to execute well with ANY model
- Work PHASE-BY-PHASE and step-by-step; do not attempt the whole plan in one shot. Commit after each step.
- READ before WRITE: open the referenced files (and `src/versioning/*`, `bin/versioned-*.js`) to copy existing patterns. The plan gives WHAT/WHERE + verification, not every line; follow established code style.
- After each change: run error checks, then the listed verification (esp. `tools/versioned-backup.js verify` must print RESULT: IDENTICAL for any backup/restore work).
- Honor the locked Decisions; don't re-litigate solved choices.
- Consult repo memory (concurrency-race fix, dedup expectations, progress-bar wrap fix, account isolation) to avoid repeating past bugs.

### Human-only steps no model can do (external consoles)
Google OAuth consent-screen verification + privacy policy; Azure AD app registration (OneDrive); AWS/R2/B2 accounts, buckets, IAM policies; Apple Developer ID + notarization; Windows code-signing cert purchase; payment provider (Razorpay/Stripe) account + webhooks; DNS/hosting for the control plane.

### Recommended build order
A → D1/D2 (BYOS local/NAS/S3) → B (Electron + tray + email + secrets) → E (Managed, after control plane stood up). Phase C teaching deferred until software is operational.
