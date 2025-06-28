# Copilot Instructions

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

This is a Node.js application for backing up Tally software data to Google Drive with the following features:

## Key Features:
- **Incremental Backup**: Only backs up files that have changed since the last backup
- **Google Drive Integration**: Uploads backups to a dedicated Google Drive folder
- **Deduplication**: Reduces storage usage by identifying and handling duplicate data
- **Scheduled Execution**: Configurable cron job scheduler (default: 8 PM daily)
- **File Change Detection**: Monitors file modifications using checksums and timestamps
- **Comprehensive Logging**: Detailed logging with Winston for monitoring and debugging
- **Error Handling**: Robust error handling and retry mechanisms

## Project Structure:
- `src/` - Main application source code
- `config/` - Configuration files
- `logs/` - Application log files
- `temp/` - Temporary files during backup process
- `data/` - Local data storage for backup metadata

## Technologies Used:
- **googleapis**: Google Drive API integration
- **node-cron**: Task scheduling
- **crypto-js**: File hashing for change detection
- **winston**: Logging framework
- **fs-extra**: Enhanced file system operations
- **chokidar**: File system monitoring
- **archiver**: File compression and archiving

## Configuration:
- Google Drive API credentials required
- Configurable backup source path (Tally data directory)
- Adjustable backup schedule
- Customizable retention policies

When working with this codebase, focus on:
1. Maintaining efficient file operations for large datasets (2GB+)
2. Implementing proper error handling for network operations
3. Ensuring secure credential management
4. Optimizing for incremental backup performance
5. Following Node.js best practices for async operations
