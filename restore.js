#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');
const GoogleDriveService = require('./src/GoogleDriveService');
const logger = require('./src/utils/logger');

/**
 * Simple restore script for the mirror backup system
 * This downloads the entire "Tally Backup" folder from Google Drive
 */
class SimpleRestore {
    constructor() {
        this.config = require('./config/config.json');
        this.googleDrive = null;
    }

    async initialize() {
        try {
            logger.info('Initializing restore service...');
            
            this.googleDrive = new GoogleDriveService(this.config.googleDrive);
            await this.googleDrive.initialize();
            
            logger.info('Restore service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize restore service:', error);
            throw error;
        }
    }

    /**
     * Restore entire mirror to local directory
     */
    async restoreToDirectory(outputPath) {
        try {
            logger.info(`Starting restore to: ${outputPath}`);
            
            // Ensure output directory exists
            await fs.ensureDir(outputPath);
            
            // Get all files from mirror
            const mirrorFiles = await this.googleDrive.listMirrorFiles();
            logger.info(`Found ${mirrorFiles.length} files in mirror`);
            
            let filesRestored = 0;
            let totalSize = 0;
            
            for (const file of mirrorFiles) {
                const localPath = path.join(outputPath, file.relativePath);
                
                // Ensure parent directory exists
                await fs.ensureDir(path.dirname(localPath));
                
                // Download file
                await this.downloadFile(file.id, localPath);
                
                filesRestored++;
                totalSize += file.size;
                
                if (filesRestored % 10 === 0) {
                    logger.info(`Restored ${filesRestored}/${mirrorFiles.length} files...`);
                }
            }
            
            logger.info(`Restore completed successfully:`);
            logger.info(`- Files restored: ${filesRestored}`);
            logger.info(`- Total size: ${this.formatFileSize(totalSize)}`);
            logger.info(`- Output directory: ${outputPath}`);
            
            return {
                filesRestored,
                totalSize,
                outputPath
            };
            
        } catch (error) {
            logger.error('Restore failed:', error);
            throw error;
        }
    }

    /**
     * Download file from Google Drive
     */
    async downloadFile(fileId, outputPath) {
        try {
            const response = await this.googleDrive.drive.files.get({
                fileId: fileId,
                alt: 'media'
            }, { responseType: 'stream' });

            const writer = fs.createWriteStream(outputPath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(outputPath));
                writer.on('error', reject);
            });
        } catch (error) {
            logger.error(`Failed to download file ${fileId}:`, error);
            throw error;
        }
    }

    /**
     * Format file size
     */
    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
}

// Main execution
async function main() {
    try {
        const outputPath = process.argv[2] || path.join(__dirname, 'restored-tally-data');
        
        console.log('🔄 Tally Data Restore');
        console.log('===================');
        
        const restore = new SimpleRestore();
        await restore.initialize();
        
        const result = await restore.restoreToDirectory(outputPath);
        
        console.log('✅ Restore completed successfully!');
        console.log(`📁 Files restored to: ${result.outputPath}`);
        console.log(`📊 Files: ${result.filesRestored}`);
        console.log(`💾 Size: ${restore.formatFileSize(result.totalSize)}`);
        
    } catch (error) {
        console.error('❌ Restore failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = SimpleRestore;
