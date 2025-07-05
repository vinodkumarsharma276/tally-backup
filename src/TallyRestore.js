const path = require('path');
const fs = require('fs-extra');
const GoogleDriveService = require('./GoogleDriveService');
const logger = require('./utils/logger');

/**
 * TallyRestore - Restore backup data from Google Drive to local directories
 * Supports multiple backup sources with flexible restore options
 */
class TallyRestore {
    constructor(config) {
        this.config = config;
        this.googleDrive = null;
        this.backupFolders = new Map(); // Map of folder name to folder info
    }

    /**
     * Initialize the restore service
     */
    async initialize() {
        try {
            logger.info('Initializing TallyRestore service...');
            
            this.googleDrive = new GoogleDriveService(this.config.googleDrive);
            await this.googleDrive.initialize();
            
            // Load backup folder information
            await this.loadBackupFolders();
            
            logger.info('TallyRestore service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize TallyRestore service:', error);
            throw error;
        }
    }

    /**
     * Load backup folder information from Google Drive
     */
    async loadBackupFolders() {
        try {
            for (const source of this.config.backup.sources) {
                const folderId = await this.googleDrive.ensureBackupFolder(source.backupFolderName);
                this.backupFolders.set(source.backupFolderName, {
                    id: folderId,
                    name: source.name,
                    sourcePath: source.sourcePath,
                    backupFolderName: source.backupFolderName
                });
            }
            logger.info(`Loaded ${this.backupFolders.size} backup folders`);
        } catch (error) {
            logger.error('Failed to load backup folders:', error);
            throw error;
        }
    }

    /**
     * List all available backup sources with their statistics
     */
    async listBackupSources() {
        const sources = [];
        for (const [folderName, folderInfo] of this.backupFolders) {
            const files = await this.listFilesInBackupFolder(folderInfo.id);
            sources.push({
                name: folderInfo.name,
                backupFolderName: folderInfo.backupFolderName,
                sourcePath: folderInfo.sourcePath,
                folderId: folderInfo.id,
                fileCount: files.length,
                totalSize: files.reduce((sum, file) => sum + file.size, 0)
            });
        }
        return sources;
    }

    /**
     * List files in a specific backup folder
     */
    async listFilesInBackupFolder(folderId) {
        try {
            const allFiles = [];
            await this._listFilesRecursively(folderId, '', allFiles);
            return allFiles;
        } catch (error) {
            logger.error(`Failed to list files in backup folder ${folderId}:`, error);
            throw error;
        }
    }

    /**
     * Recursively list files in folder structure
     */
    async _listFilesRecursively(folderId, currentPath, fileList) {
        try {
            const response = await this.googleDrive.drive.files.list({
                q: `'${folderId}' in parents and trashed=false`,
                fields: 'files(id, name, size, mimeType, modifiedTime)'
            });

            for (const item of response.data.files) {
                const relativePath = currentPath ? path.join(currentPath, item.name) : item.name;
                
                if (item.mimeType === 'application/vnd.google-apps.folder') {
                    // Recursively process folders
                    await this._listFilesRecursively(item.id, relativePath, fileList);
                } else {
                    // Add file to list
                    fileList.push({
                        id: item.id,
                        name: item.name,
                        relativePath: relativePath,
                        size: parseInt(item.size) || 0,
                        modifiedTime: new Date(item.modifiedTime).getTime()
                    });
                }
            }
        } catch (error) {
            logger.error(`Failed to list files recursively in folder ${folderId}:`, error);
            throw error;
        }
    }

    /**
     * Restore all sources to their original locations
     */
    async restoreAllSources() {
        try {
            logger.info('Starting restore of all sources...');
            
            const results = [];
            let totalFilesRestored = 0;
            let totalSizeRestored = 0;
            
            for (const [folderName, folderInfo] of this.backupFolders) {
                const result = await this.restoreSourceToOriginalLocation(folderInfo);
                results.push(result);
                totalFilesRestored += result.filesRestored;
                totalSizeRestored += result.totalSize;
            }
            
            logger.info(`All sources restored successfully:`);
            logger.info(`- Total files restored: ${totalFilesRestored}`);
            logger.info(`- Total size restored: ${this.formatFileSize(totalSizeRestored)}`);
            
            return {
                results,
                totalFilesRestored,
                totalSizeRestored
            };
            
        } catch (error) {
            logger.error('Failed to restore all sources:', error);
            throw error;
        }
    }

    /**
     * Restore a specific source to its original location
     */
    async restoreSourceToOriginalLocation(folderInfo) {
        return await this.restoreSourceToDirectory(folderInfo, folderInfo.sourcePath);
    }

    /**
     * Restore a specific source to a custom directory
     */
    async restoreSourceToDirectory(folderInfo, outputPath) {
        try {
            logger.info(`Starting restore of '${folderInfo.name}' to: ${outputPath}`);
            
            // Ensure output directory exists
            await fs.ensureDir(outputPath);
            
            // Get all files from this backup folder
            const files = await this.listFilesInBackupFolder(folderInfo.id);
            logger.info(`Found ${files.length} files in '${folderInfo.name}' backup`);
            
            let filesRestored = 0;
            let totalSize = 0;
            
            for (const file of files) {
                const localPath = path.join(outputPath, file.relativePath);
                
                // Ensure parent directory exists
                await fs.ensureDir(path.dirname(localPath));
                
                // Download file
                await this.downloadFile(file.id, localPath);
                
                filesRestored++;
                totalSize += file.size;
                
                if (filesRestored % 10 === 0) {
                    logger.info(`Restored ${filesRestored}/${files.length} files for '${folderInfo.name}'...`);
                }
            }
            
            logger.info(`'${folderInfo.name}' restore completed successfully:`);
            logger.info(`- Files restored: ${filesRestored}`);
            logger.info(`- Total size: ${this.formatFileSize(totalSize)}`);
            logger.info(`- Output directory: ${outputPath}`);
            
            return {
                sourceName: folderInfo.name,
                filesRestored,
                totalSize,
                outputPath
            };
            
        } catch (error) {
            logger.error(`Restore failed for '${folderInfo.name}':`, error);
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
     * Get backup source by name or folder name
     */
    getBackupSource(sourceName) {
        // Try to find by name first
        for (const [folderName, folderInfo] of this.backupFolders) {
            if (folderInfo.name === sourceName) {
                return folderInfo;
            }
        }
        
        // Try to find by backup folder name
        return this.backupFolders.get(sourceName);
    }

    /**
     * Format file size for display
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

module.exports = TallyRestore;
