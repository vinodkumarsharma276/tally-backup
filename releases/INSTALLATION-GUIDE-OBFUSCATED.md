# Tally Backup Pro Installation Guide (Obfuscated)

## Quick Installation

### Prerequisites
- Node.js 14.0.0 or higher
- npm package manager
- Internet connection

### Installation Steps

1. **Install globally**:
   ```bash
   npm install -g ./tally-backup-pro-1.1.0-obfuscated.tgz
   ```

2. **Run setup wizard**:
   ```bash
   tally-backup setup
   ```

3. **Start backup service**:
   ```bash
   tally-backup start
   ```

## Alternative Installation Methods

### Local Installation
```bash
# Extract and install locally
tar -xzf tally-backup-pro-1.1.0-obfuscated.tgz
cd package
npm install
node setup-wizard.js
```

### Manual Installation
```bash
# Extract to desired location
mkdir tally-backup-pro
tar -xzf tally-backup-pro-1.1.0-obfuscated.tgz -C tally-backup-pro --strip-components=1
cd tally-backup-pro
npm install
```

## Configuration

### 1. Setup Google Drive Authentication
Run the setup wizard to configure Google Drive access:
```bash
tally-backup setup-auth
```

### 2. Configure Backup Sources
Add your Tally data directories:
```bash
tally-backup setup-sources
```

### 3. Setup Email Notifications (Optional)
Configure email alerts:
```bash
tally-backup setup-email
```

## Usage

### Manual Backup
```bash
tally-backup backup
```

### Check Status
```bash
tally-backup status
```

### Restore Data
```bash
tally-backup restore
```

### Install as Service
```bash
tally-backup install-service
```

## Troubleshooting

### Common Issues
1. **Permission Errors**: Run as administrator (Windows) or use sudo (Linux)
2. **Node.js Version**: Ensure Node.js 14+ is installed
3. **Google Drive Access**: Complete OAuth setup properly
4. **Firewall**: Allow Node.js through firewall

### Support
- Check logs in the logs/ directory
- Run `tally-backup status` for diagnostics
- Verify configuration with `tally-backup test-email`

## Security Notes (Obfuscated Version)

- This is an obfuscated version with enhanced source code protection
- Source code is heavily scrambled and difficult to reverse engineer
- All functionality remains the same as the standard version
- Use this version when source code protection is important
- Keep your Google Drive credentials secure
- Use strong passwords for email configuration
- Regular updates recommended

## Version Information
- Package: tally-backup-pro-1.1.0-obfuscated.tgz
- Version: 1.1.0
- Build Type: Obfuscated
- Node.js Required: 14.0.0+
