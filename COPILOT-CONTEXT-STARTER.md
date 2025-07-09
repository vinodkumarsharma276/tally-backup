# Quick Copilot Context Starter for Tally Backup Pro

Copy and paste this into a new GitHub Copilot Chat session to quickly establish context:

---

**PROJECT CONTEXT:**

I'm working on "Tally Backup Pro" - a Node.js application for backing up Tally software data to Google Drive with incremental backup, deduplication, and scheduled execution.

**KEY DETAILS:**
- Production-ready codebase (v1.0.0) with obfuscated release package
- Technologies: Node.js, Google Drive API, Winston logging, node-cron scheduling
- Features: Incremental backup, daily log rotation, email notifications, cloud storage
- Architecture: ConfigPathManager handles dev vs installed paths, singleton logger pattern
- Installation: Windows batch installer moves config/data/logs to Documents/TallyBackupApp/

**CURRENT STRUCTURE:**
```
├── src/TallyBackup.js (main backup logic)
├── src/utils/ConfigPathManager.js (path resolution)
├── src/utils/logger.js (daily rotating logs)
├── config/config.json (sources, schedule, email)
├── bin/ (CLI utilities)
└── releases/ (obfuscated distribution package)
```

**RECENT CHANGES (July 2025):**
- Major cleanup: removed 25+ obsolete files
- Daily log rotation with winston-daily-rotate-file
- Enhanced installation with proper directory management
- CLI utilities moved to bin/ with fixed require paths
- Created comprehensive documentation and release package

**WHEN HELPING:**
- Use ConfigPathManager.getInstance() for all path operations
- Follow existing error handling patterns with retries
- Reference config/config.json for backup sources and settings
- Main entry: index.js, backup logic: src/TallyBackup.js
- Installed location: Documents/TallyBackupApp/ (not node_modules)

---

**QUICK COMMANDS:**
- Run: `node index.js` or VS Code task "Start Tally Backup Service"
- Manual backup: `node bin/manual-backup.js`
- Check status: `node bin/status.js`
- Restore: `node bin/restore.js`

Now you can ask specific questions about the codebase, features, or help with modifications!
