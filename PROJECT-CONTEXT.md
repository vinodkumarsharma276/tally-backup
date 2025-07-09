# Tally Backup Pro - Project Context for GitHub Copilot

## Quick Context Summary
This is a **Node.js application** for backing up Tally software data to **Google Drive** with incremental backup, deduplication, and scheduled execution capabilities.

## Current Project State
- **Status**: Production-ready, professionally cleaned codebase
- **Version**: 1.0.0 (obfuscated release package available)
- **Last Major Update**: July 2025 - Comprehensive cleanup and daily logging implementation

## Key Features
- **Incremental Backup**: Only backs up files that have changed since the last backup
- **Google Drive Integration**: Uploads backups to a dedicated Google Drive folder
- **Deduplication**: Reduces storage usage by identifying and handling duplicate data
- **Scheduled Execution**: Configurable cron job scheduler (default: 8 PM daily)
- **File Change Detection**: Monitors file modifications using checksums and timestamps
- **Daily Log Rotation**: Winston with daily rotate file (30-day retention)
- **Email Notifications**: Success/failure notifications with backup statistics
- **Error Handling**: Robust error handling and retry mechanisms

## Project Structure
```
├── index.js                    # Main entry point
├── setup-wizard.js            # Interactive setup for first-time users
├── install-tally-backup.bat   # Windows installation script
├── COMPLETE-GUIDE.md          # Comprehensive documentation
├── README.md                  # Quick start guide
├── package.json               # Dependencies and scripts
├── bin/                       # CLI utilities
│   ├── manual-backup.js       # Manual backup execution
│   ├── restore.js             # Restore operations
│   ├── status.js              # Status checking
│   └── tally-backup.js        # Main CLI entry
├── config/                    # Configuration files
│   ├── config.json            # Main configuration
│   ├── credentials.json       # Google Drive credentials
│   └── token.json             # OAuth tokens
├── src/                       # Core application source
│   ├── TallyBackup.js         # Main backup orchestrator
│   ├── TallyRestore.js        # Restore functionality
│   ├── GoogleDriveService.js  # Google Drive API integration
│   ├── EmailService.js        # Email notification service
│   ├── BackupState.js         # Backup state management
│   └── utils/                 # Utility modules
│       ├── ConfigPathManager.js  # Path resolution (dev vs installed)
│       ├── FileUtils.js       # File operations
│       └── logger.js          # Winston logging with daily rotation
├── data/                      # Runtime data (installed: Documents/TallyBackupApp/)
│   ├── backup-state.json      # Backup state tracking
│   ├── deduplication-index.json # Deduplication cache
│   └── file-snapshot.json     # File change tracking
├── logs/                      # Log files (installed: Documents/TallyBackupApp/)
│   ├── tally-backup-YYYY-MM-DD.log  # Daily application logs
│   └── error-YYYY-MM-DD.log   # Daily error logs
├── temp/                      # Temporary files during backup
└── releases/                  # Distribution packages
    ├── tally-backup-pro-1.0.0-obfuscated.tgz  # Obfuscated release
    └── INSTALLATION-GUIDE-OBFUSCATED.md       # Installation guide
```

## Key Technologies
- **googleapis**: Google Drive API integration
- **node-cron**: Task scheduling
- **crypto-js**: File hashing for change detection
- **winston + winston-daily-rotate-file**: Logging with daily rotation
- **fs-extra**: Enhanced file system operations
- **chokidar**: File system monitoring
- **archiver**: File compression and archiving
- **nodemailer**: Email notifications

## Important Architecture Notes

### Directory Management
- **Development**: All paths relative to project root
- **Installed**: Paths resolve to `Documents/TallyBackupApp/` via `ConfigPathManager`
- **ConfigPathManager**: Singleton pattern, handles dev vs installed environment detection

### Logging System
- **Daily Rotation**: Logs rotate daily with 30-day retention
- **Compression**: Old logs automatically compressed
- **Location**: `Documents/TallyBackupApp/logs/` (never in node_modules)
- **Files**: `tally-backup-YYYY-MM-DD.log` and `error-YYYY-MM-DD.log`

### Backup Operations
- **Sources**: Configurable in `config.json` with operation type (backup/restore)
- **Change Detection**: SHA256 checksums + file timestamps
- **Cloud Storage**: Google Drive with folder organization
- **Incremental**: Only changed files processed
- **Compression**: Configurable compression levels

## Recent Major Changes (July 2025)
1. **Codebase Cleanup**: Removed 25+ obsolete files, test files, Docker configs
2. **CLI Consolidation**: Moved utilities to `bin/` directory with fixed require paths
3. **Documentation**: Created `COMPLETE-GUIDE.md`, updated `README.md`
4. **Logging Enhancement**: Implemented daily log rotation, fixed directory resolution
5. **Installation**: Enhanced Windows installation with proper directory management
6. **Release Package**: Created obfuscated distribution package
7. **Version Control**: Updated `.gitignore` to track releases folder

## Common Tasks for Copilot

### When Working on This Project:
1. **Configuration**: Main config in `config/config.json` with sources, schedules, email settings
2. **Path Resolution**: Always use `ConfigPathManager.getInstance()` for path resolution
3. **Logging**: Use the singleton logger from `src/utils/logger.js`
4. **Error Handling**: Follow existing patterns with retries and email notifications
5. **File Operations**: Use `FileUtils.js` for consistent file handling
6. **Testing**: Run via `node index.js` or use VS Code task "Start Tally Backup Service"

### Key Files to Reference:
- `src/TallyBackup.js` - Main backup logic
- `src/utils/ConfigPathManager.js` - Path resolution
- `src/utils/logger.js` - Logging setup
- `config/config.json` - All configuration
- `install-tally-backup.bat` - Installation process

## Current Configuration Example
- **Backup Sources**: Tally Data (backup), Customer-Data (restore)
- **Schedule**: Daily at 8 PM (0 20 * * *)
- **Email**: Gmail SMTP with success/failure notifications
- **Google Drive**: 100MB max file size, 5-minute timeout
- **Retention**: 30 daily, 12 weekly, 12 monthly backups

## Installation Locations
- **Development**: `c:\Users\vinodsharma\Personal_Workspace\tally-backup`
- **Installed**: `Documents/TallyBackupApp/` (config, data, logs, temp)
- **Package**: Global npm install from obfuscated .tgz file

---
**Usage**: Copy and paste relevant sections of this context into a new Copilot Chat session to quickly restore project understanding.
