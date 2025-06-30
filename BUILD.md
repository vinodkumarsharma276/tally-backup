# 🚀 Building Distribution Packages

The distribution packages (`dist/` and `releases/` folders) are **not included in the Git repository** due to their large size (100+ MB). Instead, they are built locally when needed.

## 📦 How to Build Distribution Packages

### Prerequisites
```bash
# Make sure you have pkg installed globally
npm install -g pkg

# Or use npx (pkg will be installed automatically)
```

### Build All Distribution Packages
```bash
# This creates Windows, Linux, macOS executables and distribution packages
npm run build-release
```

### Build Executables Only
```bash
# This creates just the standalone executables
npm run build
```

## 📁 What Gets Generated

After running `npm run build-release`, you'll get:

### `dist/` folder (Standalone Executables):
- `tally-backup-win.exe` (108 MB) - Windows executable
- `tally-backup-linux` (117 MB) - Linux executable  
- `tally-backup-macos` (122 MB) - macOS executable

### `releases/` folder (Distribution Packages):
- `tally-backup-pro-1.0.0-windows.zip` (23 MB) - Windows installer package
- `tally-backup-pro-1.0.0-linux.tar.gz` (27 MB) - Linux installer package
- `tally-backup-pro-1.0.0-source.zip` (50 KB) - Source code package
- `tally-backup-pro-1.0.0-docker.zip` (20 KB) - Docker deployment package

## ⚠️ Important Notes

1. **Build packages locally** - Don't commit `dist/` or `releases/` to Git
2. **Share built packages** - Send the ZIP/TAR files to your users
3. **Clean builds** - Delete `dist/` and `releases/` folders before rebuilding
4. **Size considerations** - Executables are large due to bundled Node.js runtime

## 🔄 Quick Development Workflow

```bash
# For development/testing
npm start                    # Run the backup service
npm run backup              # Manual backup
npm run setup-auth         # Setup Google Drive

# For distribution
npm run build-release       # Build all packages
# Share files from releases/ folder with users
```

## 📋 User Installation

Once built, users can install using:

**Windows**: Extract ZIP → Run `install.bat` as admin → Run `tally-backup setup-wizard`

**Linux**: Extract TAR → Run `./install.sh` → Run `tally-backup setup-wizard`
