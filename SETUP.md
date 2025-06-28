# Quick Setup Guide

## Step 1: Google Drive API Setup

1. **Create Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Note down the project ID

2. **Enable Google Drive API**
   - In the Google Cloud Console, go to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click on it and press "Enable"

3. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client ID"
   - Choose "Desktop application" as application type
   - Give it a name (e.g., "Tally Backup Client")
   - Download the credentials JSON file

4. **Setup Credentials**
   - Rename the downloaded file to `credentials.json`
   - Place it in the `config/` directory of this project

## Step 2: Configure Tally Path

Edit `config/config.json` and update the `sourcePath` to point to your Tally data directory:

```json
{
  "backup": {
    "sourcePath": "D:\\Tally Data\\TALLY.ERP9"  // Update this path
  }
}
```

Common Tally data paths:
- `C:\\Users\\[Username]\\Documents\\Tally.ERP9\\Data`
- `D:\\Tally Data\\TALLY.ERP9`
- `C:\\Tally\\Data`

## Step 3: Authentication

Run the authentication setup:
```bash
npm run setup-auth
```

## Step 4: Test Backup

Run a manual backup to test:
```bash
npm run backup
```

## Step 5: Start Service

Start the scheduled backup service:
```bash
npm start
```

## Verification

Check backup status:
```bash
npm run status
```

## Troubleshooting

- **Error: credentials.json not found**: Make sure the file is in `config/` directory
- **Authentication failed**: Run `npm run setup-auth` again
- **Path not found**: Verify the Tally data path in config.json
- **Permission denied**: Run as administrator or check folder permissions
