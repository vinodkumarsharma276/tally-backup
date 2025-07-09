# Tally Backup Pro - Complete Installation & Setup Guide

## Table of Contents
1. [System Requirements](#system-requirements)
2. [Installation](#installation)
3. [Initial Setup](#initial-setup)
4. [Scheduling Backups](#scheduling-backups)
5. [Google Drive Authentication](#google-drive-authentication)
6. [Configuration](#configuration)
7. [Usage](#usage)
8. [Troubleshooting](#troubleshooting)
9. [Advanced Features](#advanced-features)

## System Requirements

- **Operating System**: Windows 10/11, Linux, or macOS
- **Node.js**: Version 14.0.0 or higher
- **npm**: Comes with Node.js
- **Internet Connection**: Required for Google Drive sync
- **Google Account**: For backup storage

## Installation

### Windows Installation (Recommended)

1. **Download Files**:
   - `tally-backup-pro-1.0.0-obfuscated.tgz`
   - `install-tally-backup.bat`

2. **Place in Downloads Folder**:
   ```
   C:\Users\[Username]\Downloads\
   ├── tally-backup-pro-1.0.0-obfuscated.tgz
   └── install-tally-backup.bat
   ```

3. **Run Installation**:
   - Navigate to Downloads folder
   - Run `install-tally-backup.bat`
   - Follow the on-screen instructions

4. **Installation Location**:
   ```
   C:\Users\[Username]\Documents\TallyBackupApp\
   ```

### Alternative Installation Methods

#### Global npm Installation
```bash
npm install -g tally-backup-pro-1.0.0-obfuscated.tgz
```

#### Local npm Installation
```bash
mkdir TallyBackupApp
cd TallyBackupApp
npm install path/to/tally-backup-pro-1.0.0-obfuscated.tgz
```

#### Docker Installation
```bash
docker-compose up -d
```

## Initial Setup

### 1. Initialize Configuration
```bash
npx tally-backup init
```

### 2. Setup Google Drive Authentication
```bash
npx tally-backup setup-auth
```

### 3. Run Initial Backup Test
```bash
npx tally-backup backup
```

### 4. Verify Status
```bash
npx tally-backup status
```

## Scheduling Backups

### Option 1: Windows Task Scheduler (Recommended)

**Setup**:
```bash
# From TallyBackupApp directory
setup-task-scheduler.bat
```

**Features**:
- Runs automatically even after system restart
- Daily backup at 9:00 PM
- Comprehensive logging
- Easy management through Windows Task Scheduler

**Management**:
```bash
# View task
schtasks /query /tn "Tally Backup Pro - Daily Backup"

# Delete task
schtasks /delete /tn "Tally Backup Pro - Daily Backup" /f

# Run manually
schtasks /run /tn "Tally Backup Pro - Daily Backup"
```

### Option 2: Node.js Scheduler

**Setup**:
```bash
npx tally-backup schedule --time 21:00
```

**Run**:
```bash
node scheduler.js
```

**Background Execution**:
```bash
# Windows
start /b node scheduler.js

# Linux/macOS
node scheduler.js &
```

### Option 3: Windows Service

**Install**:
```bash
npx tally-backup install-service
```

**Manage**:
```bash
# Start service
net start TallyBackupService

# Stop service
net stop TallyBackupService

# Uninstall service
npx tally-backup uninstall-service
```

## Google Drive Authentication

### Initial Setup

1. **Run Setup Command**:
   ```bash
   npx tally-backup setup-auth
   ```

2. **Follow Browser Instructions**:
   - Browser will open automatically
   - Login to your Google account
   - Grant permissions to Tally Backup Pro
   - Return to terminal when complete

3. **Verify Authentication**:
   ```bash
   npx tally-backup status
   ```

### Troubleshooting Authentication

#### Token Expired
```bash
# Re-authenticate
npx tally-backup setup-auth

# Or delete and recreate
rm config/token.json
npx tally-backup setup-auth
```

#### Permission Issues
- Ensure Google Drive API is enabled
- Check quota limits in Google Cloud Console
- Verify OAuth consent screen configuration

#### Network Issues
- Check firewall settings
- Verify proxy configuration
- Ensure outbound HTTPS (443) is allowed

## Configuration

### Configuration Files

#### `config/config.json`
```json
{
  "sources": [
    {
      "name": "Tally Data",
      "path": "C:\\Users\\[Username]\\Documents\\Tally",
      "enabled": true
    }
  ],
  "destinations": [
    {
      "name": "Customer-Data",
      "path": "C:\\Users\\[Username]\\Documents\\Customer-Data",
      "enabled": true
    }
  ],
  "email": {
    "enabled": false,
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": false
    }
  },
  "schedule": {
    "enabled": true,
    "time": "21:00",
    "frequency": "daily"
  }
}
```

#### `config/credentials.json`
```json
{
  "installed": {
    "client_id": "your-client-id",
    "client_secret": "your-client-secret",
    "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"]
  }
}
```

### Email Notifications

#### Setup Email
```bash
npx tally-backup setup-email
```

#### Test Email
```bash
npx tally-backup test-email
```

#### Email Configuration
```json
{
  "email": {
    "enabled": true,
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
    "to": ["admin@company.com", "backup-alerts@company.com"],
    "notifications": {
      "success": true,
      "failure": true,
      "summary": true
    }
  }
}
```

## Usage

### Manual Operations

#### Run Backup
```bash
npx tally-backup backup
```

#### Restore Data
```bash
# Restore to default location
npx tally-backup restore

# Restore to specific location
npx tally-backup restore "C:\RestoreLocation"
```

#### Check Status
```bash
npx tally-backup status
```

#### View Help
```bash
npx tally-backup --help
```

### Log Files

#### Application Logs
```
TallyBackupApp/logs/
├── app.log              # General application logs
├── backup.log           # Backup operation logs
├── error.log            # Error logs
└── scheduled-backup.log # Scheduled task logs
```

#### View Recent Logs
```bash
# Windows
type logs\app.log
type logs\backup.log

# Linux/macOS
cat logs/app.log
tail -f logs/backup.log
```

## Troubleshooting

### Common Issues

#### Installation Problems

**Node.js Not Found**:
- Download and install Node.js from https://nodejs.org/
- Restart command prompt after installation
- Verify with `node --version`

**Permission Denied**:
- Run command prompt as administrator
- Check folder permissions
- Ensure antivirus isn't blocking installation

#### Backup Failures

**Google Drive Connection Failed**:
```bash
# Re-authenticate
npx tally-backup setup-auth

# Check network connectivity
ping drive.googleapis.com
```

**File Access Denied**:
- Ensure Tally software is closed
- Check file permissions
- Run as administrator if needed

**Insufficient Storage**:
- Check Google Drive storage quota
- Clean up old backup files
- Consider upgrading Google Drive plan

#### Scheduling Issues

**Task Not Running**:
- Check if task is enabled in Task Scheduler
- Verify user account has proper permissions
- Check system time and timezone

**Backup Fails When Scheduled**:
- Ensure paths are absolute (not relative)
- Check if user is logged in (for Interactive tasks)
- Review scheduled task logs

### Advanced Troubleshooting

#### Enable Debug Logging
```bash
# Set environment variable
set DEBUG=tally-backup:*

# Run with verbose output
npx tally-backup backup --verbose
```

#### Clear Cache and Reset
```bash
# Remove all local state
rm -rf data/
rm config/token.json

# Reinitialize
npx tally-backup init
npx tally-backup setup-auth
```

#### Check System Resources
```bash
# Check disk space
dir C: /-c

# Check memory usage
tasklist /fi "imagename eq node.exe"

# Check network connectivity
telnet smtp.gmail.com 587
```

## Advanced Features

### Cloud-First Architecture

Tally Backup Pro uses a cloud-first approach:
- Always downloads fresh state from Google Drive before backup
- Never trusts local cache for backup decisions
- Automatically cleans up local state after backup
- Ensures consistency across multiple installations

### Deduplication

- Automatic file deduplication based on content hash
- Reduces storage usage significantly
- Maintains file integrity while optimizing space
- Works across multiple backup sources

### Incremental Backups

- Only backs up changed files
- Compares file checksums and timestamps
- Handles file moves and renames efficiently
- Maintains complete backup history

### Multi-Source Support

```json
{
  "sources": [
    {
      "name": "Tally Data",
      "path": "C:\\Tally",
      "enabled": true
    },
    {
      "name": "Documents",
      "path": "C:\\Documents",
      "enabled": true
    }
  ]
}
```

### Custom Scheduling

```bash
# Daily at specific time
npx tally-backup schedule --time 14:30

# Weekly backups
npx tally-backup schedule --time 22:00 --frequency weekly

# Custom cron expression
npx tally-backup schedule --cron "0 */6 * * *"  # Every 6 hours
```

### Service Installation

#### Windows Service
```bash
# Install
npx tally-backup install-service

# Configure
sc config TallyBackupService start= auto

# Monitor
sc query TallyBackupService
```

#### Linux Systemd Service
```bash
# Install
sudo npx tally-backup install-service

# Enable auto-start
sudo systemctl enable tally-backup

# Monitor
systemctl status tally-backup
```

#### Docker Deployment

##### Docker Compose
```yaml
version: '3.8'
services:
  tally-backup:
    build: .
    volumes:
      - ./config:/app/config
      - ./data:/app/data
      - ./logs:/app/logs
      - /path/to/tally/data:/data/source
    environment:
      - NODE_ENV=production
      - BACKUP_SCHEDULE=0 21 * * *
    restart: unless-stopped
```

##### Environment Variables
```bash
# Backup schedule
BACKUP_SCHEDULE=0 21 * * *

# Log level
LOG_LEVEL=info

# Google Drive settings
GDRIVE_FOLDER_NAME=TallyBackup

# Email settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
```

### Monitoring and Alerts

#### Health Checks
```bash
# Check service health
npx tally-backup status --health

# Detailed diagnostics
npx tally-backup status --verbose
```

#### Custom Monitoring
```javascript
// monitor.js
const { exec } = require('child_process');

setInterval(() => {
  exec('npx tally-backup status --json', (error, stdout) => {
    const status = JSON.parse(stdout);
    if (!status.healthy) {
      // Send alert
      console.log('Backup service unhealthy!');
    }
  });
}, 300000); // Check every 5 minutes
```

---

## Support

For additional support:
- Check logs in `TallyBackupApp/logs/`
- Review configuration in `TallyBackupApp/config/`
- Run diagnostics with `npx tally-backup status --verbose`

## Version Information

**Current Version**: 1.0.0
**Node.js Requirement**: >= 14.0.0
**Supported Platforms**: Windows 10/11, Linux, macOS

## Windows-Specific Configuration

### Default Installation Paths

After installation, files are located at:
- **Application**: `C:\Users\[Username]\Documents\TallyBackupApp\`
- **Configuration**: `C:\Users\[Username]\Documents\TallyBackupApp\config\`
- **Logs**: `C:\Users\[Username]\Documents\TallyBackupApp\logs\`
- **Data**: `C:\Users\[Username]\Documents\TallyBackupApp\data\`

### Windows Task Scheduler Setup

For robust scheduling on Windows, use the Task Scheduler:

1. **Run Setup Script**:
   ```cmd
   # From installation directory
   setup-task-scheduler.bat
   ```

2. **Manual Task Scheduler Setup**:
   - Open Task Scheduler (`taskschd.msc`)
   - Create Basic Task
   - Set trigger (Daily at 8:00 PM)
   - Set action: Start a program
   - Program: `node`
   - Arguments: `bin/tally-backup.js backup`
   - Start in: `C:\Users\[Username]\Documents\TallyBackupApp`

### Common Windows Paths

Typical Tally data locations:
- **Tally 9**: `C:\Tally9\Data\`
- **TallyPrime**: `C:\Users\[Username]\Documents\TallyPrime\`
- **Custom Installation**: Check your Tally installation directory

### Windows Firewall

If you encounter connection issues:
1. Open Windows Defender Firewall
2. Allow Node.js through firewall
3. Ensure outbound HTTPS (port 443) is allowed
