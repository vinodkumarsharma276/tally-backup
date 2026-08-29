# Tally Backup Pro

Professional automated backup solution for Tally software data to Google Drive with incremental backup, deduplication, and scheduling capabilities.

## 🚀 Quick Start

### Windows Installation (Recommended)

1. **Download the package**: `tally-backup-pro-1.0.0-obfuscated.tgz`
2. **Place in Downloads folder**
3. **Run**: `install-tally-backup.bat`
4. **Follow the installation wizard**

### Key Features

- **Incremental Backup**: Only backs up files that have changed
- **Google Drive Integration**: Secure cloud storage
- **Deduplication**: Reduces storage usage
- **Scheduled Execution**: Automated daily backups
- **Comprehensive Logging**: Detailed monitoring
- **Email Notifications**: Backup status reports

### After Installation

```bash
# Initialize configuration
npx tally-backup init

# Setup Google Drive authentication
npx tally-backup setup-auth

# Run first backup
npx tally-backup backup

# Setup daily scheduling
npx tally-backup schedule --time 20:00
```

## 📖 Complete Documentation

For detailed installation, configuration, and usage instructions, see **[COMPLETE-GUIDE.md](COMPLETE-GUIDE.md)**.

## 🔧 Available Commands

- `npx tally-backup init` - Initialize configuration
- `npx tally-backup setup-auth` - Setup Google Drive authentication
- `npx tally-backup setup-wizard` - Interactive setup wizard
- `npx tally-backup backup` - Run backup now
- `npx tally-backup restore` - Restore from backup
- `npx tally-backup schedule --time HH:MM` - Setup scheduled backups
- `npx tally-backup status` - Show backup status
- `npx tally-backup test-email` - Test email notifications

## 🆘 Support

For troubleshooting and advanced configuration, refer to the complete guide or contact support.

## 📄 License

Commercial license - All rights reserved.
x
