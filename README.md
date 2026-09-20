# Backup Genie

**Any folder. Any day. Back in one click.**

Backup Genie takes automatic, **versioned**, off-site backups of any folder on your
machine — accounts data, documents, design files, database dumps, project archives —
deduplicated so only what actually changed is uploaded, and restorable to any past day.

It is not a mirror. Every run writes a new restore point, so you can roll a folder back
to yesterday, to last week, or to the day before someone overwrote it.

> **Status: `v0.0.1` — Starter edition, early access.** Public downloads are not yet
> enabled. See [Editions](#editions) for what Starter includes.

---

## How it works

1. **Chunk** — every file is split with content-defined chunking (FastCDC, 256 KB
   average). A 2 GB file that changed by a few MB produces a few MB of new chunks.
2. **Store** — new chunks are gzipped, hashed (SHA-256) and written once to a
   content-addressed store. Chunks already present are never re-uploaded.
3. **Snapshot** — each run writes a manifest listing *every* file in the folder and the
   chunks it is made of. Unchanged files cost nothing but a line in the manifest.
4. **Restore** — pick a restore point, pick a destination, and the chunks are pulled and
   reassembled into a complete, intact folder. Your live folder is never overwritten in
   place.
5. **Collect** — retention keeps the last N restore points (30 by default) and a
   mark-and-sweep pass deletes chunks nothing references any more.

---

## Install

Download the Windows installer from the
[Releases page](https://github.com/vinodkumarsharma276/tally-backup/releases/latest) and
run it. Linux `.AppImage` and `.deb` builds are attached to the same release.

Builds are not yet code-signed, so Windows SmartScreen will warn on first run:
**More info → Run anyway**.

The app installs itself to start with Windows and lives in the notification area. Your
settings, logs and local state go to `Documents\BackupGenie\`.

## First run

1. **Storage** — connect a Google Drive account and name a folder for the backup store.
2. **Sources** — add the folders you want protected. Each source picks a storage
   destination and a schedule.
3. **Settings** — turn on email reports. By default they are relayed through our
   service, so you do not need a mail password of your own.
4. **Overview → Back up now** — watch the first run, then leave it to the scheduler.

Full walkthrough, configuration reference and troubleshooting:
**[COMPLETE-GUIDE.md](COMPLETE-GUIDE.md)**.

## Restore

**Restore** page → choose a source → choose a restore point → choose an empty
destination folder. The app refuses to restore on top of a folder that is itself a live
backup source unless you force it.

---

## Editions

`shared/edition.json` decides what a build allows, and
[`src/utils/EditionPolicy.js`](src/utils/EditionPolicy.js) enforces it at run time — not
just in the UI.

**Starter** (current build):

- one Google Drive storage profile, used by every backup source
- as many source folders as you like, all going to that one destination
- versioned backups only (no exact-copy mode)
- other providers (S3, Azure Blob, network shares, local folders) remain usable for
  **restoring** existing data, but not as backup destinations

S3 / Azure Blob / NAS destinations, multiple destinations per source, and the managed
cloud tier are implemented in the engine and reserved for future editions.

---

## Repository layout

| Path | What it is |
| --- | --- |
| [`src/versioning/`](src/versioning/) | The engine: chunker, object store, snapshot store, GC, storage backends |
| [`src/`](src/) | Google Drive service, email, secrets, config paths, logging |
| [`bin/`](bin/) | Headless runners the desktop app forks: backup, restore, scheduler, verify |
| [`desktop/`](desktop/) | Electron main process, preload, tray, Google sign-in |
| [`ui/`](ui/) | React renderer (Overview, Sources, Storage, Restore, Settings, Logs) |
| [`server/`](server/) | Managed-tier control plane — a **separate deployable**, not bundled in the installer |
| [`site/`](site/) | Marketing site (all copy lives in `site/src/content.js`) |
| [`tools/`](tools/) | Developer CLIs: versioned backup/restore/verify, chunk measurement, OAuth, secret migration |
| [`test/`](test/) | Node test suites, run by `npm test` |

Deeper architecture notes, invariants and gotchas: **[PROJECT-CONTEXT.md](PROJECT-CONTEXT.md)**.

## Development

```bash
npm install
npm run dev:desktop     # Vite renderer + Electron, with hot reload
npm test                # every suite in test/
```

Other useful scripts:

```bash
npm run build:desktop       # Windows installer into releases/desktop/
npm run build:desktop:dir   # unpacked app, faster, no installer
npm run site:dev            # marketing site locally
npm run test-storage        # probe a configured storage profile end to end
```

The headless runners can be driven directly. They resolve their config from
`--config <path>`, then `TALLY_CONFIG`, then `config/config_test.json`:

```bash
node bin/versioned-backup.js --config config/config.json
node bin/versioned-restore.js --source "Accounts" --snapshot latest --dest ./restored
node tools/versioned-backup.js verify "<original>" "<restored>"
```

`verify` must print `RESULT: IDENTICAL` for any change that touches backup or restore.

## Releasing

`main` takes no direct pushes. Releases are cut by tagging a merged version bump; CI
builds the Windows and Linux installers and attaches them to a GitHub Release. See
**[RELEASING.md](RELEASING.md)**.

## Documentation map

| Document | Audience |
| --- | --- |
| [COMPLETE-GUIDE.md](COMPLETE-GUIDE.md) | End users — install, configure, restore, troubleshoot |
| [PROJECT-CONTEXT.md](PROJECT-CONTEXT.md) | Developers and AI assistants — architecture and invariants |
| [RELEASING.md](RELEASING.md) | Cutting and publishing a release |
| [server/README.md](server/README.md) | Running and deploying the control plane |
| [server/COMPLIANCE.md](server/COMPLIANCE.md) | Security, audit and data-residency posture |
| [docs/GTM.md](docs/GTM.md) | Positioning, pricing and launch checklist |
| [plans/restore-ui-gtm-plan.md](plans/restore-ui-gtm-plan.md) | The phased plan this product was built against |

## Licence

Commercial — all rights reserved. Backup Genie is a product of Udgam AI.
