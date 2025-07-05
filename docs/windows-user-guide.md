# Tally Backup Pro - Windows User Guide

## 🚀 Quick Start Guide

### After Installation

1. **Double-click** the "Tally Backup Config" shortcut on your desktop
   - OR go to Start Menu → Tally Backup Pro → Configuration Tool

2. **Choose Option 1**: Initial Setup Wizard (first time)

3. **Follow the step-by-step setup**:
   - Google Drive authentication
   - Configure backup/restore sources
   - Set up email notifications (optional)

4. **Test your configuration** with a manual backup

---

## 📂 Configuration Locations

### Program Files
- **Executable**: `C:\Program Files\TallyBackupPro\tally-backup.exe`
- **Config Tool**: `C:\Program Files\TallyBackupPro\windows-config-tool.bat`

### Data Files (User Data)
- **Configuration**: `C:\ProgramData\TallyBackupPro\config\config.json`
- **Logs**: `C:\ProgramData\TallyBackupPro\logs\`
- **Backup State**: `C:\ProgramData\TallyBackupPro\data\`

---

## 🔧 Configuration Methods

### Method 1: Configuration Tool (Recommended)
```
Double-click: "Tally Backup Config" desktop shortcut
```

**Features:**
- ✅ User-friendly menu interface
- ✅ Step-by-step wizards
- ✅ Built-in validation
- ✅ No technical knowledge required

### Method 2: Command Line
```cmd
# Open Command Prompt and run:
tally-backup setup-wizard    # Complete setup wizard
tally-backup setup-auth      # Google Drive authentication
tally-backup setup-sources   # Configure backup/restore sources
tally-backup setup-email     # Email notifications
```

### Method 3: Manual Editing (Advanced)
```
Edit: C:\ProgramData\TallyBackupPro\config\config.json
```
⚠️ **Warning**: Requires JSON knowledge. Backup the file first!

---

## 🔄 Backup vs Restore Configuration

### Backup Sources (Local → Google Drive)
**Example**: Backup your Tally data to Google Drive
```json
{
  "name": "Tally Data",
  "operation": "backup",
  "sourcePath": "C:\\Users\\YourName\\Documents\\Tally",
  "backupFolderName": "Tally Backup"
}
```

### Restore Sources (Google Drive → Local)
**Example**: Download shared files from Google Drive
```json
{
  "name": "Shared Documents",
  "operation": "restore", 
  "sourcePath": "C:\\Users\\YourName\\Downloads\\SharedDocs",
  "backupFolderName": "Shared Folder"
}
```

---

## 🎯 Common Configuration Examples

### Example 1: Tally Backup Only
```json
{
  "backup": {
    "sources": [
      {
        "name": "Tally Data",
        "operation": "backup",
        "sourcePath": "C:\\Tally\\Data",
        "backupFolderName": "Tally Backup"
      }
    ]
  }
}
```

### Example 2: Mixed Backup and Restore
```json
{
  "backup": {
    "sources": [
      {
        "name": "Tally Data",
        "operation": "backup",
        "sourcePath": "C:\\Tally\\Data", 
        "backupFolderName": "Tally Backup"
      },
      {
        "name": "Shared Reports",
        "operation": "restore",
        "sourcePath": "C:\\Users\\YourName\\Downloads\\Reports",
        "backupFolderName": "Company Reports"
      }
    ]
  }
}
```

### Example 3: Multiple Backups
```json
{
  "backup": {
    "sources": [
      {
        "name": "Tally Data",
        "operation": "backup",
        "sourcePath": "C:\\Tally\\Data",
        "backupFolderName": "Tally Backup"
      },
      {
        "name": "Documents",
        "operation": "backup", 
        "sourcePath": "C:\\Users\\YourName\\Documents",
        "backupFolderName": "My Documents"
      }
    ]
  }
}
```

---

## 🔐 Google Drive Setup

### Prerequisites
1. **Google Account** with sufficient Drive storage
2. **Google Cloud Project** with Drive API enabled
3. **OAuth Credentials** downloaded as `credentials.json`

### Step-by-Step Authentication
1. Run Configuration Tool → Option 2 (Configure Authentication)
2. Place your `credentials.json` in the config folder when prompted
3. Visit the provided Google authorization URL
4. Grant permissions to your Google Drive
5. Copy the authorization code
6. Paste it back in the configuration tool

---

## 📧 Email Notifications

### Gmail Setup (Most Common)
1. **Enable 2-Factor Authentication** on your Google account
2. **Generate App Password**:
   - Go to Google Account Settings
   - Security → 2-Step Verification → App passwords
   - Generate password for "Tally Backup Pro"
3. **Configure in tool**:
   - Host: `smtp.gmail.com`
   - Port: `587`
   - Username: Your Gmail address
   - Password: The generated app password (not your regular password)

### Other Email Providers
- **Outlook**: `smtp-mail.outlook.com:587`
- **Yahoo**: `smtp.mail.yahoo.com:587`
- **Custom SMTP**: Contact your IT administrator

---

## 🏃‍♂️ Running Backups

### Automatic (Scheduled)
- Configured during setup (default: 8 PM daily)
- Runs in background as Windows service
- Sends email notifications

### Manual (On-Demand)
```cmd
# Using Configuration Tool
Configuration Tool → Option 6: Manual Backup

# Using Command Line
tally-backup backup

# Using Desktop Shortcut
Double-click "Tally Backup Pro" desktop shortcut
```

---

## 📊 Monitoring & Status

### Check Backup Status
```cmd
# Using Configuration Tool
Configuration Tool → Option 7: Check Status

# Using Command Line  
tally-backup status
```

### View Logs
```cmd
# Open log folder
explorer "C:\ProgramData\TallyBackupPro\logs"

# View latest log
notepad "C:\ProgramData\TallyBackupPro\logs\tally-backup.log"
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. "Config file not found"
**Solution**: Run the installer again or manually create config folder

#### 2. "Google Drive authentication failed"  
**Solution**: 
- Re-run authentication setup
- Check credentials.json file location
- Verify Google Cloud project settings

#### 3. "Path does not exist" for restore sources
**Solution**: This is normal - folders are created automatically during restore

#### 4. "Permission denied" errors
**Solution**: 
- Run as Administrator
- Check folder permissions
- Ensure antivirus isn't blocking

#### 5. Email notifications not working
**Solution**:
- Test email configuration first
- Check app password (not regular password for Gmail)
- Verify SMTP settings

### Getting Help
1. **Check logs** first: `C:\ProgramData\TallyBackupPro\logs\`
2. **Run configuration tool** for guided troubleshooting
3. **Contact support** with log files if needed

---

## 🔄 Updating

### Automatic Updates
- Download new version
- Run installer (will preserve existing configuration)
- Configuration and data are maintained

### Manual Updates
1. **Backup your config**: Copy `C:\ProgramData\TallyBackupPro\config\`
2. **Uninstall old version**
3. **Install new version**
4. **Restore config** if needed

---

## 🗑️ Uninstalling

1. **Stop service** (if running)
2. **Run uninstaller**: `C:\Program Files\TallyBackupPro\uninstall.bat`
3. **Manual cleanup** (if needed):
   - Delete `C:\Program Files\TallyBackupPro\`
   - Delete `C:\ProgramData\TallyBackupPro\`
   - Remove from PATH environment variable

---

## 💡 Tips for Success

### Security
- ✅ Use App Passwords for email (never regular passwords)
- ✅ Keep credentials.json secure
- ✅ Regularly review Google Drive permissions

### Performance  
- ✅ Schedule backups during off-hours
- ✅ Exclude temporary files from backup sources
- ✅ Monitor disk space usage

### Reliability
- ✅ Test restore process periodically  
- ✅ Monitor email notifications
- ✅ Check logs regularly
- ✅ Keep multiple backup destinations if critical

---

**Need Help?** Use the Configuration Tool - it's designed to guide you through everything!
