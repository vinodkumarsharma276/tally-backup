# HAND-OFF: Phase 1 Completed & Ready for Phase 2 (UI + Field Test)

> Paste this entire file into the next Copilot chat to restore full state.
> Active Workspace path: `c:\Users\vinodsharma\personal_workspace\tally-backup`

---

## 1. Project Context & Progress
We are shifting from a **legacy overwrite-mirror backup** (which kept no history and let Yesterday get overwritten) to a **Git-like versioned backup** on Google Drive.

### Achievements in this Session:
1. **Phase 0 (Completed)**: Ran FastCDC measurement on real Tally Data (Day1 vs Day2). Determined that **256 KB average chunking + gzip** is the optimal design. It fits 15 GB for 30 days easily (~2.5 GB projected storage), gets a healthy ~74% content dedup + ~74% gzip compression, and avoids the Drive API overhead of smaller 64 KB chunks.
2. **Phase 1 Core Engine (Completed & Validated)**: Built a generic, storage-agnostic content-addressed versioned backup engine in [src/versioning/](src/versioning/):
   - [src/versioning/Chunker.js](src/versioning/Chunker.js): FastCDC (deterministic gear hash) file splitter.
   - [src/versioning/ObjectStore.js](src/versioning/ObjectStore.js): CAS engine (`objects/ab/abcdef...`). Handles compression (with magic-byte compression detection) and SHA-256 integrity verification.
   - [src/versioning/SnapshotStore.js](src/versioning/SnapshotStore.js): Manifest maker (`snapshots/<id>.json` + `refs.json`).
   - [src/versioning/VersionedBackup.js](src/versioning/VersionedBackup.js): The orchestrator. Now runs with **8x async concurrency** for uploads and a **concurrent prefetch engine** for downloads. Both verified locally to produce byte-identical restores (checked with an independent folder verification tool). Contains automatic mark-and-sweep garbage collection.
3. **Storage Backends Developed**:
   - [src/versioning/backends/LocalFsBackend.js](src/versioning/backends/LocalFsBackend.js): Map to local directory (used for testing).
   - [src/versioning/backends/GoogleDriveBackend.js](src/versioning/backends/GoogleDriveBackend.js): Full, production-ready Drive mapper. Implements an in-memory directory cache + per-folder metadata list cache to keep `has(chunk_id)` checks extremely fast and within safe Google Drive API request quotas. Added a **strict safety guard**: it refuses to initialize inside any directory containing legacy un-versioned directories (like `DATA/`, `VHA/`, `TDL/`) so it can never overwrite or corrupt the legacy mirror folder.
4. **Tooling & Isolation Complete**:
   - [tools/versioned-backup.js](tools/versioned-backup.js): Fully-featured CLI supporting local or Drive backend (`--drive`). Maps progress, throughput, and ETA smoothly to stdout using a custom CLI progress engine.
   - [bin/versioned-backup.js](bin/versioned-backup.js): Production-ready backend scheduled script. Handles backup, GC step, and email dispatch.
   - **Account/Token Isolation**: Configured [config/config_test.json](config/config_test.json) to point to [config/token_test.json](config/token_test.json).
   - [tools/auth.js](tools/auth.js) (`npm run auth-test`): Interactive OAuth tool that binds `vinodipdelhi@gmail.com` to the test token, keeping the production `token.json` (`vinodkhoraa@gmail.com`) untouched.

---

## 2. Resolved Production Incidents
- **Stray Chunks Cleaned**: An early test run uploaded stray chunks into the production "Tally Backup" folder. This has been recursively deleted, and the folder remains pure legacy mirror.
- **Safety Guard Active**: The safety guard in `GoogleDriveBackend.js` now guarantees that `VersionedBackup` will throw an error rather than write chunks into any folder holding mirror files.

---

## 3. Account Status (IMPORTANT)
The testing environment is configured to run fully isolated on **`vinodipdelhi@gmail.com`**:
- **Drive Storage**: Uses `config/token_test.json` (signed in as `vinodipdelhi` via the custom `auth.js` helper). Runs backups inside `Tally Backup New`.
- **Email Dispatch**: Standard SMTP authenticated as `vinodipdelhi@gmail.com` with a validated app password. Runs successfully.
- **Project Scope**: App appears to be in **"In production"** publishing state in GCP, which is why `vinodipdelhi` could authenticate without being explicitly listed as a Test User. Refresh token will not expire in 7 days (long-lived).

---

## 4. Current Work State & Testing Steps

The current code is fully synchronous, validated, and syntactically sound. The local workspace has the target test folders:
- `Tally Data Day1/` (Baseline data, ~3.10 GB)
- `Tally Data Day2/` (Mutated data, ~3.11 GB)

### Immediate Next Steps for the Next Chat:

#### Step 1: Run the Google Drive Day-1 Baseline
Run the versioned baseline upload to `vinodipdelhi`'s Google Drive. This will upload ~830 MB of compressed chunks, create `snapshots/` and `refs.json`, and send the report email:
```powershell
npm run backup-versioned
```
*(You will see the shiny new concurrent progress bar showing %, chunk metrics, and ETA.)*

#### Step 2: Test Day-2 Concurrency & Delta
Once Day1 completes:
1. Open [config/config_test.json](config/config_test.json) and change `sourcePath` from `.../Tally Data Day1` to `.../Tally Data Day2`.
2. Run again: `npm run backup-versioned`
3. **Verify expected outcome**: The runner should report ~7,153 chunks checked, but **only ~981 chunks (58.19 MB) uploaded** as the rest of the chunks are deduplicated on Drive. It should send another success email.

#### Step 3: Test a Drive-authenticated Restore
Restore tomorrow's backup into a separate location using the CLI tool:
```powershell
node tools/versioned-backup.js restore latest "temp/drive-restore" --drive
```
*(This downloads gzipped chunks concurrently and reassembles them.)*

Verify correctness:
```powershell
node tools/versioned-backup.js verify "Tally Data Day2" "temp/drive-restore"
```
*(Must output `RESULT: IDENTICAL`.)*

---

## 5. UI Requirements (Phase 2 Goal)
The user has requested a **Full Local UI** to manage the software before commercial selling.
- **Tech Stack**: Lightweight Express server running localhost-only, accessible via browser (`npm run ui`).
- **Features Required**:
  1. **Config Editor**: Visual settings adjustment (folders, email, targets, concurrency) writing back to the config files using `ConfigPathManager.js`.
  2. **Flow Toggle**: High-level switch between the legacy "Overwrite Mirror" process and the new "Git-like versioned history" process.
  3. **Scheduler Integration**: Edit/trigger cron schedules, and interface with Windows Task Scheduler (reusing/calling the existing `scripts/setup-task-scheduler.bat`).
  4. **Run Now**: Button to trigger a manual run with active status streaming.
  5. **Logs & Status View**: View live backup outputs and list available historical restore points.
  6. **Secret Storage**: Move Gmail app passwords and OAuth files into secure storage or isolate them.
