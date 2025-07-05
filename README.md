# Tally Backup

An automated backup solution for Tally software data to Google Drive with incremental backup, deduplication, and intelligent scheduling capabilities.

> **📦 For Distribution**: To create standalone installer packages for Windows/Linux, see [BUILD.md](BUILD.md) for build instructions.

## Features

- 🔄 **Incremental Backup**: Only backs up changed files after the initial full backup
- ☁️ **Google Drive Integration**: Secure cloud storage with automatic folder organization
- 🗜️ **Deduplication**: Advanced file deduplication to minimize storage usage
- ⏰ **Scheduled Execution**: Configurable cron-based scheduler (default: 8 PM daily)
- 🔍 **File Change Detection**: Monitors file modifications using checksums and timestamps
- 📊 **Comprehensive Logging**: Detailed logging with Winston for monitoring and debugging
- 🛡️ **Error Handling**: Robust error handling with retry mechanisms
- 📈 **Statistics Tracking**: Detailed backup statistics and health monitoring
- 🔒 **Snapshot Redundancy**: Backup state stored both locally and in Google Drive
- 🚀 **Disaster Recovery**: Complete system recovery even if local files are lost
- 📧 **Email Notifications**: Automatic email reports for backup success/failure with Google Drive links
- 📂 **Multiple Source Support**: Backup multiple folders to separate Google Drive directories
- 🔄 **Reverse Backup**: Restore data from Google Drive to local directories
- 🎯 **Selective Restore**: Choose specific backup sources or restore all at once
- 🖥️ **Interactive Restore**: User-friendly menu for restore operations
- 📝 **Command Line Restore**: Scriptable restore operations with multiple options

## Prerequisites

1. **Node.js**: Version 14.0.0 or higher
2. **Google Drive API**: Enabled in Google Cloud Console
3. **Google Drive Credentials**: Downloaded credentials.json file

## Installation

1. Clone or download this repository
2. Install dependencies:

   ```bash
   npm install
   ```

## Setup

### 1. Google Drive API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google Drive API
4. Create credentials (OAuth 2.0 Client ID)
5. Download the credentials file as `credentials.json`
6. Place `credentials.json` in the `config/` directory

### 2. Authentication

Run the authentication setup:

```bash
npm run setup-auth
```

Follow the instructions to:

1. Visit the provided URL
2. Grant necessary permissions
3. Copy the authorization code
4. Run the command again with the code

### 3. Configuration

Edit `config/config.json` to customize settings:

```json
{
  "backup": {
    "sources": [
      {
        "name": "Tally Data",
        "sourcePath": "D:\\Tally Data\\TALLY.ERP9",
        "backupFolderName": "Tally Backup"
      },
      {
        "name": "Documents",
        "sourcePath": "C:\\Users\\YourName\\Documents",
        "backupFolderName": "Documents Backup"
      },
      {
        "name": "Projects",
        "sourcePath": "C:\\Users\\YourName\\Projects",
        "backupFolderName": "Projects Backup"
      }
    ],
    "schedule": "0 20 * * *",                    // Cron expression (8 PM daily)
    "maxRetries": 3,
    "retryDelay": 5000,
    "compressionLevel": 6,
    "chunkSizeMB": 50
  },
  "googleDrive": {
    "credentialsPath": "./config/credentials.json",
    "tokenPath": "./config/token.json",
    "maxFileSize": 104857600,
    "uploadTimeout": 300000
  },
  "retention": {
    "keepDailyBackups": 30,
    "keepWeeklyBackups": 12,
    "keepMonthlyBackups": 12
  },
  "email": {
    "enabled": false,
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": false,
      "auth": {
        "user": "your-email@gmail.com",
        "pass": "your-app-password"
      }
    },
    "from": "your-email@gmail.com",
    "to": "recipient@gmail.com",
    "subject": "Tally Backup Report",
    "sendOnSuccess": true,
    "sendOnFailure": true,
    "includeStats": true,
    "includeDriveLink": true
  }
}
```

### 4. Multiple Source Configuration (Optional)

Configure multiple backup sources using the interactive setup:

```bash
npm run setup-sources
```

This will help you:

- Add multiple source folders for backup
- Configure unique Google Drive folder names for each source
- Edit or remove existing sources
- Migrate from single source to multiple sources

### 5. Email Notifications (Optional)

Configure email notifications to receive backup reports:

```bash
npm run setup-email
```

**For Gmail users:**

1. Enable 2-factor authentication on your Google account
2. Generate an "App Password" for Tally Backup Pro
3. Use the App Password instead of your regular Gmail password

## Usage

### Start Scheduled Backup Service

```bash
npm start
```

This starts the backup scheduler that will run according to your configured schedule.

### Manual Backup

```bash
npm run backup
```

Run a backup immediately without waiting for the scheduled time.

### Check Status

```bash
npm run status
```

View detailed backup statistics, health status, and system information.

### Test Email Notifications

```bash
npm run test-email
```

Send a test email to verify your email configuration is working correctly.

## Restore Operations

Tally Backup Pro provides comprehensive restore capabilities to recover your data from Google Drive backups.

### Interactive Restore Mode

```bash
npm run restore
```

This opens an interactive menu with the following options:

- **Restore all sources to original locations**: Restores all backup sources to their original paths
- **Restore specific source to original location**: Choose a specific source to restore to its original path
- **Restore specific source to custom location**: Choose a specific source and specify a custom restore path
- **List backup contents**: Browse the contents of any backup source without downloading
- **Quit**: Exit the restore menu

### Command Line Restore

#### List Available Backups

```bash
node restore.js --list
```

Shows all available backup sources with file counts and sizes.

#### Restore All Sources

```bash
node restore.js --all
```

Restores all backup sources to their original locations.

#### Restore Specific Source

```bash
# Restore to original location
node restore.js --source "Tally Data"

# Restore to custom location
node restore.js --source "Tally Data" "C:\RestoreFolder"
```

#### Get Help

```bash
node restore.js --help
```

Shows detailed usage information for all restore options.

### Restore Features

- **Multiple Source Support**: Restore individual sources or all sources at once
- **Flexible Destinations**: Restore to original locations or custom directories
- **Progress Tracking**: Real-time progress updates during restore operations
- **File Integrity**: Preserves original file structure and metadata
- **Selective Restore**: Choose specific backup sources to restore
- **Content Preview**: Browse backup contents before downloading
- **Comprehensive Logging**: Detailed logs of all restore operations

## How It Works

### Mirror Backup Approach

The system maintains a **single folder mirror** of your Tally data in Google Drive, preserving the exact folder structure and file organization.

### Initial Backup

1. Scans the entire Tally data directory
2. Uploads all files individually to Google Drive
3. Preserves original folder structure in "Tally Backup" folder
4. Creates file snapshots and deduplication index for future comparisons

### Incremental Backups (Mirror Synchronization)

1. Scans source directory for changes
2. Compares with previous file snapshot using checksums and timestamps
3. Identifies three types of changes:
   - **Added files**: New files that didn't exist before
   - **Modified files**: Files that have changed since last backup
   - **Deleted files**: Files that were removed from local directory
4. Synchronizes the Google Drive mirror:
   - **Uploads** new and modified files
   - **Deletes** files that were removed locally
   - **Preserves** unchanged files
5. Updates file snapshots and deduplication data
6. **Backs up system files** (snapshots, state) to Google Drive for redundancy

### Snapshot Backup & Recovery

- **Local + Cloud Storage**: File snapshots are stored both locally and in Google Drive
- **Automatic Restore**: If local snapshots are lost, they're automatically restored from Google Drive
- **System Folder**: Metadata is stored in a hidden `.tally-backup-system` folder in Google Drive
- **Disaster Recovery**: Complete system recovery possible even if local files are lost

### File Deletion Handling

- **True Mirror Sync**: When you delete files from your local Tally folder, they are automatically deleted from Google Drive
- **Maintains Consistency**: The Google Drive backup always reflects your current local folder state
- **Safe Operation**: Only removes files that are confirmed to be deleted locally

### Deduplication

- Uses SHA256 hashing to identify duplicate content
- Tracks file blocks to avoid storing identical data multiple times
- Provides significant space savings for repetitive data
- Reports deduplication statistics and savings

## File Structure

```text
tally-backup/
├── config/
│   ├── config.json          # Main configuration
│   ├── credentials.json     # Google Drive API credentials
│   └── token.json          # OAuth tokens (auto-generated)
├── src/
│   ├── utils/
│   │   ├── logger.js       # Logging utilities
│   │   └── FileUtils.js    # File operation utilities
│   ├── TallyBackup.js      # Main backup orchestrator
│   ├── TallyRestore.js     # Restore operations manager
│   ├── GoogleDriveService.js # Google Drive integration
│   ├── BackupState.js      # State management
│   └── EmailService.js     # Email notification service
├── data/                   # Local backup metadata
├── logs/                   # Application logs
├── temp/                   # Temporary files (auto-cleanup)
├── index.js               # Main entry point
├── manual-backup.js       # Manual backup script
├── restore.js             # Restore operations script
├── status.js             # Status checking script
├── setup-auth.js         # Authentication setup
├── setup-sources.js      # Multi-source configuration
└── setup-email.js        # Email configuration
```

## Logging

The application creates detailed logs in the `logs/` directory:

- `tally-backup.log`: All application logs
- `error.log`: Error-specific logs

Log levels: error, warn, info, debug

## Monitoring

The application provides comprehensive monitoring:

- **Backup Statistics**: Success/failure rates, file counts, sizes
- **Deduplication Metrics**: Space savings, duplicate detection
- **Performance Tracking**: Backup duration, upload speeds
- **Health Checks**: System status, error detection

## Error Handling

- **Automatic Retries**: Failed operations are retried with exponential backoff
- **Graceful Degradation**: Continues operation even if some files fail
- **Comprehensive Logging**: All errors are logged with context
- **State Recovery**: Can resume from interruptions

## Security

- **OAuth 2.0**: Secure authentication with Google Drive
- **Token Management**: Automatic token refresh and secure storage
- **File Integrity**: Checksum verification for all operations
- **No Plain Text Passwords**: Uses secure token-based authentication

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Ensure credentials.json is in config/ directory
   - Run `npm run setup-auth` to refresh tokens
   - Check Google Drive API is enabled

2. **Permission Errors**
   - Ensure the application has read access to Tally data directory
   - Check Google Drive storage permissions

3. **Network Issues**
   - Check internet connectivity
   - Verify firewall settings allow HTTPS connections
   - Consider adjusting upload timeout in config

4. **Storage Issues**
   - Check Google Drive storage quota
   - Review retention policy settings
   - Monitor deduplication effectiveness

### Getting Help

Check the logs in `logs/` directory for detailed error information. Use `npm run status` to get current system health.

## Multiple Source Support

The system now supports backing up multiple source folders to different backup folders in Google Drive. This allows you to:

- **Backup different types of data** (e.g., Tally data, Documents, Projects) to separate folders
- **Organize your backups** by keeping different data types in their own Google Drive folders
- **Maintain separate versioning** for each source folder

### Configuration

In your `config/config.json`, you can define multiple sources in the `backup.sources` array:

```json
{
  "backup": {
    "sources": [
      {
        "name": "Tally Data",              // Friendly name for logging
        "sourcePath": "D:\\Tally Data\\TALLY.ERP9",
        "backupFolderName": "Tally Backup"  // Google Drive folder name
      },
      {
        "name": "Documents",
        "sourcePath": "C:\\Users\\YourName\\Documents",
        "backupFolderName": "Documents Backup"
      },
      {
        "name": "Projects",
        "sourcePath": "C:\\Users\\YourName\\Projects",
        "backupFolderName": "Projects Backup"
      }
    ]
  }
}
```

### Multiple Source Features

- **Independent Processing**: Each source is processed separately with its own change detection
- **Separate Snapshots**: File snapshots are maintained separately for each source
- **Individual Statistics**: Backup statistics are tracked per source
- **Organized Storage**: Each source gets its own folder in Google Drive

### Multiple Source Usage

All existing commands work the same way:

```bash
# Backup all configured sources
npm run backup

# View status for all sources
npm run status

# Start scheduled backups for all sources
npm start
```

The system will process each source sequentially and provide detailed statistics for each one in the logs and email notifications.

## License

ISC License

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Note**: This application is designed specifically for Tally software data backup. Ensure you have proper permissions to access and backup the Tally data directory.
