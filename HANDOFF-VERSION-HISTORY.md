# HAND-OFF: Add Git-like Version History to Tally Backup

> Paste this whole file into the new Copilot chat to restore full context.
> IMPLEMENT in the SOURCE repo: `c:\Users\vinodsharma\personal_workspace\tally-backup`
> (we own that source). THIS folder, `TallyBackupShop`, is only the deployed runtime
> copy that consumes the OBFUSCATED package — do NOT implement features here.

---

## 1. One-line goal
Back up a local **Tally** data folder to **Google Drive** with **Git-like version history**,
so we can restore the **complete, intact Tally company folder as of any past day** (not just
the latest mirror). Google Drive only. Keep it simple.

## 2. Scope decisions (LOCKED)
- ✅ We OWN the source (Vinod wrote it), at `..\tally-backup`. Refactor it; do NOT rebuild.
- ✅ Target storage = **Google Drive only** (no S3/Azure/Electron/commercial — those earlier
  "overkill" ideas are intentionally PARKED).
- ✅ Drive plan = **FREE 15 GB** → sub-file **content-defined chunking (CDC) is MANDATORY**.
- ✅ Retention = keep **30 days** of history.
- ✅ **MEASURE real chunk-delta on actual Tally files FIRST**, before building the engine.

## 3. Why this is needed (the Tally specifics)
- A Tally company's data lives as MANY files PLUS one (or few) **big binary file(s)**
  (`*.1800`, `*.TSF`) that only Tally understands.
- Every day Tally REWRITES the entire big file even if only a few KB of transactions changed
  → new mtime + new whole-file hash.
- Tally requires the WHOLE company folder present to open a company. So any restore must
  reproduce the COMPLETE folder for the chosen day, not just that day's changed files.

## 4. How the app works TODAY (verified in source)
Entry: `src/TallyBackup.js > runBackupForSource()`:
1. `FileUtils.scanDirectory()` → files with **whole-file SHA256** + size + mtime.
2. `getGoogleDriveSnapshot()` → pull previous `file-snapshot.json` from Drive.
3. `FileUtils.compareFileSnapshots()` → added / modified / deleted / unchanged
   (modified = whole-file hash OR mtime differs). See `src/utils/FileUtils.js:144`.
4. `syncMirrorFolder()` (`src/TallyBackup.js:740`) → upload changed files into ONE Drive
   "mirror" folder (`googleDrive.uploadFileToMirror`, keeps relative path), delete removed.
- **Net effect:** Drive = a single LIVE MIRROR of the latest state. Yesterday is OVERWRITTEN.
  → **No history.** `deduplication-index.json` is only bookkeeping; uploads still send whole files.

Key source files (in `..\tally-backup`):
- `src/TallyBackup.js` — orchestrator (backup + mirror sync).
- `src/TallyRestore.js` — restore (currently downloads the mirror folder).
- `src/GoogleDriveService.js` — Drive API (upload/download/list, snapshot put/get).
- `src/BackupState.js` — state: `backup-state.json`, `file-snapshot.json`, dedup index.
- `src/utils/FileUtils.js` — hashing + `scanDirectory` + `compareFileSnapshots`.
- `src/utils/ConfigPathManager.js` — dev vs installed path resolution.
- `config/config.json` — sources, schedule, retention, email.
- Stack: Node ≥14, `googleapis`, `crypto`, `fs-extra`, `archiver`, `winston`, `node-cron`.

## 5. The CRITICAL insight: UPLOAD vs STORAGE
- **Upload/bandwidth** = bytes sent per night. **Storage** = bytes KEPT over time.
- TODAY (overwrite): uploads ~2 GB/night BUT overwrites → storage stays flat ~2.24 GB.
  That flat storage is ONLY possible because there is NO history.
- ADDING history ⇒ cannot overwrite ⇒ must KEEP old versions ⇒ storage grows.
  - Whole-file granularity → +~2 GB per retained day → 30 days ≈ 60 GB. ❌ blows 15 GB.
- "Why 2 GB and not a couple MB?" Tally rewrites the whole big file, so whole-file diff
  counts the ENTIRE file as changed. To store only the few MB that truly differ, we must
  diff INSIDE the file = sub-file chunking / binary-diff.
- ⇒ For FREE 15 GB + history + big daily-rewritten file, **CDC chunking is mandatory**.
  BUT savings are DATA-DEPENDENT (only helps if Tally edits localized regions; if it
  reshuffles the whole file, even CDC stores a lot) → that's why we MEASURE first.

Reference numbers (from prod logs, `.\logs\tally-backup-2026-06-19.log`):
total folder ~2.24 GB, 95 files, ~37 "modified"/day, nightly run ~5–6 min.

## 6. Target architecture (snapshots + content-addressed chunk store)
Leave the LOCAL Tally folder exactly as Tally wants (untouched, single folder).
Change only the Drive layout:

```
<DriveRoot>/
  objects/                  # content-addressed: each unique CHUNK stored once, by hash
     ab/abcdef…             # sharded by first 2 hex chars
  snapshots/
     2026-06-20T20-00.json  # manifest = COMPLETE folder state that day:
                            #   { relativePath: { chunks:[hash...], size, mtime } }
  refs.json                 # list of snapshots + "latest" pointer
```

- **Backup (new):** scan → for each file, FastCDC-split into chunks → upload only chunks
  NOT already in `objects/` → write a `snapshots/<ts>.json` manifest referencing ALL files
  (changed + unchanged) by their chunk hashes. Unchanged files reuse existing chunks → not
  re-uploaded.
- **Restore "as of day X" (new):** read `snapshots/X.json` → for each file, download+concat
  its chunks → write to a NEW empty folder = complete, intact Tally folder. ✅ Never overwrite
  the live Tally folder in place.
- **Retention + GC:** keep 30 days of snapshots; mark all chunks referenced by kept
  snapshots; delete unreferenced chunks (safe: chunks are immutable + content-addressed).

## 7. Implementation phases
- **Phase 0 — MEASURE FIRST (do this before building the engine):**
  - Build standalone `measure-chunks.js` (no Drive, no app changes): takes the Tally folder
    path, FastCDC-chunks every file (start ~1 MB avg), stores chunk hashes in a local
    SQLite/JSON DB, and on each daily re-run reports: total size, per-file chunk counts,
    **new/changed bytes that day**, and **projected 30-day storage** + suggested chunk size.
  - Run it on 2–3 CONSECUTIVE days (after Tally's daily update) to get real day-over-day delta.
  - Decision gate: if ~tens of MB/day → 15 GB is fine. If ~GB/day → revisit retention or
    paid Drive before proceeding.
  - Also (housekeeping): fix plaintext Gmail password in `config/config.json`; clean ~340
    stale `temp\backup-*` folders in this runtime copy.
- **Phase 1 — Versioned engine WITH chunking:** `Chunker` (FastCDC), `ObjectStore` (Drive
  `objects/`, put-if-absent by chunk hash), `SnapshotStore` (`snapshots/*.json` + `refs.json`).
  Refactor `runBackupForSource()` to chunk→upload-missing→write-manifest; replace
  mirror-overwrite with append-snapshot. Update `TallyRestore.js` to list + reassemble a
  chosen snapshot into a new folder. CLI: `restore --list`, `restore --at <date|id> --to <path>`.
- **Phase 2 — Retention + GC:** snapshot-aware retention + chunk mark-and-sweep.
- **Phase 3 — Tuning:** optional gzip of chunks (archiver dep), chunk-size tuning from
  Phase 0 data, parallel uploads.
- **Phase 4 — Verify:** backup 3 days → restore day 1 → confirm Tally OPENS the restored
  company folder; confirm Drive stays within 15 GB at 30-day retention.

## 8. Immediate next step for the new chat
1. Open VS Code at the SOURCE repo `c:\Users\vinodsharma\personal_workspace\tally-backup`.
2. Place the real Tally data folder somewhere accessible (e.g. `.\sample-data\` — add to
   `.gitignore`, do NOT commit real data).
3. Ask the agent to build **`measure-chunks.js`** (Phase 0) and run it against that folder.
4. Re-run it the next day to capture the real daily delta, then decide Phase 1 chunk size.

## 9. Open questions still to confirm
- Q4: Restore UX — CLI only (current) or a minimal UI later?
- Q5: First full backup uploads the whole ~2.24 GB once (baseline); only changed chunks
  after that. OK?
- Q6: Where will the real Tally data live for testing on the dev machine? (no D: drive here)

## 10. PARKED (explicitly out of scope now)
- Commercialization / installer / licensing / Electron UI.
- Multiple storage backends (S3 / Azure / own blob storage) / adopting restic/kopia.
Revisit only AFTER the Google-Drive version-history core works.

---
### Side notes (known issues in THIS runtime copy `TallyBackupShop`)
- `config/config.json` holds a PLAINTEXT Gmail app password → move to secret/env; rotate it.
- `credentials.json` / `token.json` hold live Google OAuth secrets → never commit.
- Recent email failures were: (a) Norton 360 SSL/email scanning breaking TLS, (b) an expired
  Gmail app password — both resolved. Backups themselves were always succeeding.
