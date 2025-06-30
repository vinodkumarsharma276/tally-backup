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
    "sourcePath": "D:\\Tally Data\\TALLY.ERP9",  // Your Tally data path
    "schedule": "0 20 * * *",                    // Cron expression (8 PM daily)
    "maxRetries": 3,
    "retryDelay": 5000,
    "compressionLevel": 6,
    "chunkSizeMB": 50
  },
  "googleDrive": {
    "backupFolderName": "Tally-Backup",
    "maxFileSize": 104857600,
    "uploadTimeout": 300000
  },
  "retention": {
    "keepDailyBackups": 30,
    "keepWeeklyBackups": 12,
    "keepMonthlyBackups": 12
  }
}
```

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

## How It Works

### Initial Backup
1. Scans the entire Tally data directory
2. Creates compressed archives (chunks) of the data
3. Uploads to Google Drive in organized folders
4. Creates file snapshots and deduplication index

### Incremental Backups
1. Scans source directory for changes
2. Compares with previous file snapshot using checksums
3. Identifies added, modified, and deleted files
4. Only backs up changed files, reducing time and storage
5. Updates file snapshots and deduplication data

### Deduplication
- Uses SHA256 hashing to identify duplicate content
- Tracks file blocks to avoid storing identical data multiple times
- Provides significant space savings for repetitive data
- Reports deduplication statistics and savings

## File Structure

```
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
│   ├── GoogleDriveService.js # Google Drive integration
│   └── BackupState.js      # State management
├── data/                   # Local backup metadata
├── logs/                   # Application logs
├── temp/                   # Temporary files (auto-cleanup)
├── index.js               # Main entry point
├── manual-backup.js       # Manual backup script
├── status.js             # Status checking script
└── setup-auth.js         # Authentication setup
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
