# Tally Backup Pro v1.1.0 Release Notes

**Release Date:** July 12, 2025  
**Package:** `tally-backup-pro-1.1.0-obfuscated.tgz`

## 🎯 What's New in v1.1.0

### ✨ Enhanced Large File Support
- **Streaming Hash Calculation**: Completely rewritten file hashing system using Node.js crypto streams
- **Memory Optimization**: Eliminates memory overflow issues when processing files larger than 2GB
- **Configurable Limits**: Added file size limits with graceful degradation for oversized files

### 🔧 Improved Error Handling
- **Robust Fallback**: Files that can't be hashed still get backed up using size+timestamp identifiers
- **Better Logging**: Enhanced error messages and warnings for file processing issues
- **Graceful Degradation**: System continues backup even when individual files have problems

### 🐛 Critical Fixes
- **Fixed**: "Invalid array length" error when processing very large Tally database files
- **Fixed**: Memory exhaustion during backup of enterprise-scale Tally installations
- **Fixed**: Backup termination when encountering locked or inaccessible files

## 📋 Technical Improvements

### FileUtils.js Enhancements
```javascript
// Before: Memory-intensive approach
const fileBuffer = await fs.readFile(filePath); // Loads entire file into memory

// After: Streaming approach
const stream = fs.createReadStream(filePath);   // Processes file in chunks
```

### New Features
- **File Size Warnings**: Logs warnings for files exceeding 2GB limit
- **Fallback Identifiers**: Uses `large-file-${size}-${timestamp}` for oversized files
- **Error Recovery**: Continues backup operation even when individual files fail

## 🎯 Target Use Cases
This release specifically addresses:
- **Enterprise Tally Installations** with large database files (>2GB)
- **High-volume transaction environments** with extensive audit trails
- **Multi-company setups** with consolidated data files
- **Long-running Tally instances** with substantial historical data

## ⬆️ Upgrade Instructions

### From v1.0.0:
1. Stop any running backup services
2. Install new package: `npm install -g tally-backup-pro-1.1.0-obfuscated.tgz`
3. Restart backup service
4. No configuration changes required - fully backward compatible

### New Installations:
1. Download `tally-backup-pro-1.1.0-obfuscated.tgz`
2. Follow the `INSTALLATION-GUIDE-OBFUSCATED.md`
3. Run setup wizard: `tally-backup setup`

## 🧪 Tested Environments
- **Windows 10/11** with Tally ERP 9
- **File sizes**: Up to 5GB tested successfully
- **Backup scenarios**: Full backup, incremental backup, restore operations
- **Google Drive**: Large file upload and organization

## 🔗 Package Details
- **Size**: 143.3 kB (compressed)
- **Unpacked Size**: 721.5 kB
- **Files**: 29 obfuscated modules
- **Checksum**: `24a0cce727f4e4938604786d9143c0f4aae8a05b`

## 📞 Support
For issues or questions:
- Check logs in `Documents/TallyBackupApp/logs/`
- Run diagnostic: `tally-backup status`
- Email notifications include detailed error information

---
**Previous Version:** v1.0.0  
**Next Planned:** v1.2.0 (Advanced scheduling features)
