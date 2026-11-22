# Backup Genie — Complete Guide

Everything needed to install, configure, run and restore Backup Genie.

1. [System requirements](#system-requirements)
2. [Installing](#installing)
3. [First run](#first-run)
4. [Storage](#storage)
5. [Sources](#sources)
6. [Scheduling](#scheduling)
7. [Restoring](#restoring)
8. [Email reports](#email-reports)
9. [Where your files live](#where-your-files-live)
10. [Configuration reference](#configuration-reference)
11. [Troubleshooting](#troubleshooting)
12. [Command line](#command-line)

---

## System requirements

- **Windows 10 or 11** (primary). Linux `.AppImage` and `.deb` builds are published
  alongside each release; macOS is on the roadmap.
- **Internet connection** for off-site storage and email reports.
- **A Google account** with enough Drive space for your data. Backup Genie only ever
  touches the folder it creates — the `drive.file` scope means it cannot see the rest of
  your Drive.
- No Node.js install required. Everything is bundled in the installer.

## Installing

Download the installer from the
[Releases page](https://github.com/vinodkumarsharma276/tally-backup/releases/latest) and
run it.

- **Windows** — `Backup-Genie-Starter-Setup.exe`. You can choose the install location.
  Desktop and Start Menu shortcuts are created. Because the build is not yet
  code-signed, SmartScreen shows a warning: **More info → Run anyway**.
- **Linux** — mark the `.AppImage` executable and run it, or
  `sudo apt install ./Backup-Genie-<version>.deb`.

The app registers itself to start with Windows and runs from the notification area, so
scheduled backups keep working after a reboot. Updates are checked automatically and
installed from the same release feed.

### Upgrading from the old "Tally Backup" install

Nothing to do. On first start the app moves `Documents\TallyBackupApp\` to
`Documents\BackupGenie\`, keeping your settings, history and local state. If a file is
locked at that moment the old folder is left in place and a fresh one is created — the
app never fails to start because of this.

## First run

The app opens on **Overview**. Work down the sidebar:

1. **Storage** — connect where backups go.
2. **Sources** — pick the folders to protect.
3. **Settings** — email reports, schedule defaults, startup behaviour.
4. **Overview → Back up now** — run the first backup and watch it.

The first run uploads everything; it is the slow one. Every run after that uploads only
the chunks that changed, which is usually a small fraction.

## Storage

**Storage** page → **Add storage**.

### Google Drive

1. Choose **Google Drive** and click **Connect Google**. A browser window opens for
   consent; the app never sees your password.
2. Set **Drive folder** — the name of the folder that will hold the backup store. It is
   created if it does not exist.
3. **Test connection** writes, reads back and deletes a probe object, so a
   misconfiguration surfaces here rather than at 8 PM.

Each storage profile remembers which Google account owns it, so report links always point
at the right account.

The Starter edition allows **one** Google Drive profile. Every backup source uses it.

### Other providers

The engine also ships backends for local folders, network shares (SMB/UNC), Amazon S3 and
S3-compatible services (Cloudflare R2, Backblaze B2, Wasabi, MinIO), Azure Blob, and the
managed tier. In Starter these can be used to **restore** data you already have, but not
as backup destinations.

### What the store looks like

```
<store root>/
  objects/          content-addressed chunks, sharded two hex characters deep
  snapshots/        one manifest per restore point
  refs.json         the list of restore points and the "latest" pointer
```

Do not edit, rename or move anything inside the store by hand. The app writes a marker
file to recognise its own repositories and refuses to write into a folder that looks like
something else — that guard is what stops it from ever overwriting unrelated data.

## Sources

**Sources** page → **Add source**. Per source:

| Field | Meaning |
| --- | --- |
| **Name** | Shown in reports, history and restore lists |
| **Operation** | **Backup** (local → storage) or **Restore** (storage → local) |
| **Folders** | One or more folders to protect; each can carry a label |
| **Storage** | Which storage profile this source uses |
| **Schedule** | When it runs, per source |
| **Enabled** | Turn a source off without deleting it; disabled sources are skipped everywhere |
| **Report recipients** | Optional per-source addresses; falls back to the address in Settings |

Add as many sources as you like. Close the application that writes the data (Tally, your
database, your design tool) before a run if it keeps files exclusively locked — otherwise
those files are skipped and reported.

## Scheduling

Each source carries its own schedule. The scheduler lives inside the app, which starts
with Windows and sits in the notification area.

**Missed runs are caught up.** If the machine was off or asleep when a backup was due, it
runs when the machine comes back, as long as it is within the grace window (48 hours by
default). Catch-ups are queued one at a time so several overdue sources cannot all start
at once.

Hover the tray icon for progress; click it to open the window. Backups run while you are
logged in. If you need runs while logged out, install the app as a Windows service
(`npm run install-windows-service` from a source checkout).

## Restoring

**Restore** page:

1. Pick the source.
2. Pick a restore point. Each one shows its timestamp, file count and size.
3. Pick a destination folder. **Use an empty folder.**
4. Run it, then **Open restored folder**.

A restore reassembles the *complete* folder as it stood at that moment — not just the
files that changed that day — so applications that need their whole data directory
present will open it normally.

**Safety:** the app refuses to restore into a folder that is a live backup source, unless
you explicitly force it. This is deliberate: it stops a restore from overwriting the data
you are protecting.

Test a restore before you need one. A backup you have never restored is a hypothesis, not
a backup.

## Email reports

**Settings → Email reports.**

- **Company relay (default)** — reports are sent through Backup Genie's own service. You
  need no mail account, no app password and no SMTP settings.
- **Your own SMTP** — supply host, port, user and password if you would rather send from
  your own server. The password goes to the OS credential vault, never to the config file.

**Send test email** confirms the whole path before you rely on it.

Reports carry: operation, restore-point id, files and total size, new versus deduplicated
chunks, amount actually uploaded, duration, restore points retained, the next scheduled
run, and a link to the storage folder for every enabled source. Success and failure
reports can be toggled independently.

## Where your files live

| What | Where |
| --- | --- |
| Settings | `Documents\BackupGenie\config\config.json` |
| Local state | `Documents\BackupGenie\data\` |
| Logs | `Documents\BackupGenie\logs\` |
| Scratch space | `Documents\BackupGenie\temp\` |
| Secrets | The OS credential vault (Windows Credential Manager, via `keytar`) |

Logs rotate daily and are kept for 30 days: `tally-backup-YYYY-MM-DD.log` for everything,
`error-YYYY-MM-DD.log` for failures only. The **Logs** page tails them inside the app.

**Secrets are never written to `config.json`.** Where a credential would go, the file
holds a reference such as `secret:config.google.oauth.token`, and the real value lives in
the OS vault. If you are migrating an old install that had a password in plain text, run
`node tools/migrate-secrets.js` from a source checkout, then rotate that password.

## Configuration reference

You do not normally edit this file — the app writes it. It is documented because support
sometimes needs to read it.

```jsonc
{
  "desktop": {
    "autoStart": true,          // start with Windows
    "minimizeToTray": true,
    "notifications": true,
    "schedulerEnabled": true
  },

  "storageProfiles": {
    "My Drive": { "type": "google_drive", "rootFolderName": "Backup Genie Store" }
    // other types: local | network | s3 | azure_blob | managed
  },

  "backup": {
    "sources": [
      {
        "name": "Accounts",
        "operation": "backup",       // or "restore"
        "enabled": true,
        "sourcePaths": [{ "path": "C:\\Accounts", "label": "" }],
        "storageProfile": "My Drive",
        "schedule": "0 20 * * *",    // cron, Asia/Kolkata
        "restore": {                 // restore-type sources only
          "mode": "manual",          // or "scheduled"
          "snapshotId": "latest",
          "cleanDest": false
        }
      }
    ],
    "schedule": "0 20 * * *",        // default for sources without their own
    "concurrency": 8,                // parallel chunk transfers
    "compressionLevel": 6,
    "catchUpMissed": true,
    "catchUpWithinHours": 48
  },

  "retention": {
    "keepDailyBackups": 30           // restore points kept; the rest are collected
  },

  "logging": { "level": "info", "maxFiles": 30, "maxSize": "20m" },

  "email": {
    "enabled": false,
    "mode": "company",               // "company" relay, or your own SMTP
    "to": "",
    "sendOnSuccess": true,
    "sendOnFailure": true,
    "includeStats": true,
    "includeDriveLink": true
  }
}
```

Raising `concurrency` speeds up a run until the storage provider starts rate-limiting; 8
is a good default for Google Drive. `keepDailyBackups` is what bounds your storage —
lowering it frees space at the next garbage collection.

## Troubleshooting

**"Connect Google" does not complete.** The consent window needs a browser and outbound
HTTPS on port 443. Check a proxy or firewall, then try again. If the account previously
authorised an older build, remove the app under
[Google account permissions](https://myaccount.google.com/permissions) and reconnect.

**A backup fails with "storage profile not found".** The source points at a profile that
was renamed or deleted. Open **Sources**, pick the profile again, and save.

**The app refuses to write to a folder.** It found something there that is not one of its
own repositories. Point it at an empty folder, or accept the repository from the
**Storage** page if you are certain it is yours.

**Some files were skipped.** They were locked by another application. Close whatever is
writing them — the accounting package, the database — and run again.

**Drive quota is full.** Either free space in Drive, or lower `keepDailyBackups` so the
next garbage-collection pass releases the chunks that older restore points were holding.

**Reports are not arriving.** Use **Send test email** first. If you are on your own SMTP,
antivirus mail-scanning (Norton in particular) has been known to break TLS on port 587 —
switch to the company relay to rule it out.

**Scheduled runs are not happening.** Confirm the app is running in the notification area
and that **start with Windows** is on in Settings. The scheduler runs inside the app; if
the app is closed, nothing fires.

**Nothing above matches.** Check `Documents\BackupGenie\logs\error-<today>.log` — the
failure is almost always named there in one line.

## Command line

The desktop app is the supported interface. From a source checkout, the same engine is
driveable directly for automation and debugging. Config resolves from `--config <path>`,
then the `TALLY_CONFIG` environment variable, then `config/config_test.json`:

```bash
node bin/versioned-backup.js --config config/config.json
node bin/versioned-backup.js --source "Accounts"
node bin/versioned-restore.js --source "Accounts" --snapshot latest --dest ./restored
node bin/versioned-restore.js --all --dry-run
node bin/versioned-verify.js
node tools/versioned-backup.js verify "<original>" "<restored>"
```

`--dry-run` reports what a restore would do and writes nothing. `verify` compares two
folders byte for byte and prints `RESULT: IDENTICAL` when they match.

> The older `tally-backup` CLI (`bin/tally-backup.js`, `index.js`, the `setup-*.js`
> scripts and `install-tally-backup.bat`) predates the desktop app and the versioned
> engine. It is kept for the legacy mirror flow and is not the supported path for new
> installs.

---

**Support** — [contact@udgamai.com](mailto:contact@udgamai.com). Please attach
`Documents\BackupGenie\logs\error-<date>.log` when reporting a failure.
