const cron = require('node-cron');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./utils/logger');
const FileUtils = require('./utils/FileUtils');
const GoogleDriveService = require('./GoogleDriveService');
const BackupState = require('./BackupState');
const EmailService = require('./EmailService');

class TallyBackup {
    constructor(config) {
        this.config = config;
        this.isRunning = false;
        this.cronJob = null;
        this.googleDrive = null;
        this.backupState = null;
        this.emailService = null;
        this.tempDir = path.join(process.cwd(), 'temp', `backup-${Date.now()}`);
    }

    /**
     * Initialize the backup system
     */
    async initialize() {
        try {
            logger.info('Initializing Tally Backup system...');

            // Initialize Google Drive service first
            this.googleDrive = new GoogleDriveService(this.config.googleDrive);
            await this.googleDrive.initialize();

            // Initialize backup state with Google Drive restore capability
            this.backupState = new BackupState(path.join(process.cwd(), 'data'));
            await this.backupState.initializeWithGoogleDriveRestore(this.googleDrive);

            // Initialize email service
            if (this.config.email) {
                this.emailService = new EmailService(this.config.email);
                await this.emailService.initialize();
            }

            // Ensure temp directory exists
            await FileUtils.ensureDirectory(this.tempDir);

            // Pre-validate and create restore destination folders
            await this.validateAndCreateRestoreDestinations();

            logger.info('Tally Backup system initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize backup system:', error);
            throw error;
        }
    }

    /**
     * Start the backup scheduler
     */
    async start() {
        try {
            await this.initialize();

            logger.info(`Starting backup scheduler with cron: ${this.config.backup.schedule}`);
            
            // Validate cron expression
            if (!cron.validate(this.config.backup.schedule)) {
                throw new Error(`Invalid cron expression: ${this.config.backup.schedule}`);
            }

            // Schedule backup job
            this.cronJob = cron.schedule(this.config.backup.schedule, async () => {
                if (!this.isRunning) {
                    await this.runBackup();
                } else {
                    logger.warn('Backup already in progress, skipping scheduled run');
                }
            }, {
                scheduled: false,
                timezone: 'Asia/Kolkata' // Adjust timezone as needed
            });

            this.cronJob.start();
            logger.info('Backup scheduler started successfully');

            // Run initial backup if no previous backup exists
            if (!this.backupState.state.lastSuccessfulBackup) {
                logger.info('No previous backup found, running initial backup...');
                await this.runBackup();
            }

            // Keep the process running
            this.keepAlive();

        } catch (error) {
            logger.error('Failed to start backup scheduler:', error);
            throw error;
        }
    }

    /**
     * Stop the backup scheduler
     */
    async stop() {
        try {
            logger.info('Stopping backup scheduler...');
            
            if (this.cronJob) {
                this.cronJob.stop();
                this.cronJob = null;
            }

            if (this.isRunning) {
                logger.info('Waiting for current backup to complete...');
                // Wait for current backup to finish
                while (this.isRunning) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Cleanup temp files
            await FileUtils.cleanupTempFiles(this.tempDir);

            logger.info('Backup scheduler stopped');
        } catch (error) {
            logger.error('Error while stopping backup scheduler:', error);
        }
    }

    /**
     * Run backup process for multiple sources (both backup and restore operations)
     */
    async runBackup() {
        if (this.isRunning) {
            logger.warn('Backup already in progress');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();
        let overallStats = {
            totalFilesProcessed: 0,
            totalFilesUploaded: 0,
            totalFilesDownloaded: 0,
            totalSize: 0,
            totalDuration: 0,
            success: false,
            sources: [],
            driveLinks: []
        };

        try {
            logger.info('Starting backup process for multiple sources...');

            // Process each source configuration
            for (const sourceConfig of this.config.backup.sources) {
                logger.info(`Processing ${sourceConfig.operation} operation: ${sourceConfig.name} (${sourceConfig.sourcePath})`);
                
                let sourceStats;
                if (sourceConfig.operation === 'backup') {
                    sourceStats = await this.runBackupForSource(sourceConfig);
                    overallStats.totalFilesUploaded += sourceStats.filesUploaded;
                    
                    // Add Google Drive link for backup folders
                    const driveLink = this.generateDriveLinkForFolder(sourceConfig.backupFolderName);
                    overallStats.driveLinks.push({
                        name: sourceConfig.name,
                        folderName: sourceConfig.backupFolderName,
                        operation: 'backup',
                        link: driveLink
                    });
                } else if (sourceConfig.operation === 'restore') {
                    sourceStats = await this.runRestoreForSource(sourceConfig);
                    overallStats.totalFilesDownloaded += sourceStats.filesDownloaded;
                    
                    // Add Google Drive link for restore source folders
                    const driveLink = this.generateDriveLinkForFolder(sourceConfig.backupFolderName);
                    overallStats.driveLinks.push({
                        name: sourceConfig.name,
                        folderName: sourceConfig.backupFolderName,
                        operation: 'restore',
                        link: driveLink
                    });
                }
                
                overallStats.sources.push({
                    name: sourceConfig.name,
                    operation: sourceConfig.operation,
                    sourcePath: sourceConfig.sourcePath,
                    backupFolderName: sourceConfig.backupFolderName,
                    ...sourceStats
                });
                
                // Aggregate overall stats
                overallStats.totalFilesProcessed += sourceStats.filesProcessed;
                overallStats.totalSize += sourceStats.totalSize;
            }

            const endTime = Date.now();
            overallStats.totalDuration = endTime - startTime;
            overallStats.success = true;

            // Update backup state
            this.backupState.updateLastBackup(overallStats);

            logger.info(`Backup completed successfully in ${(overallStats.totalDuration / 1000).toFixed(2)}s`);
            logger.info(`Total files processed: ${overallStats.totalFilesProcessed}, uploaded: ${overallStats.totalFilesUploaded}, downloaded: ${overallStats.totalFilesDownloaded}`);
            logger.info(`Total size: ${FileUtils.formatFileSize(overallStats.totalSize)}`);

            // Save overall state and backup to Google Drive
            await this.backupState.saveAllWithGoogleDriveBackup(this.googleDrive);

            logger.info(`Backup completed successfully in ${(overallStats.totalDuration / 1000).toFixed(2)}s`);
            logger.info(`Total files processed: ${overallStats.totalFilesProcessed}, uploaded: ${overallStats.totalFilesUploaded}, downloaded: ${overallStats.totalFilesDownloaded}`);
            logger.info(`Total size: ${FileUtils.formatFileSize(overallStats.totalSize)}`);

            // Send success email with multiple drive links
            if (this.emailService) {
                await this.emailService.sendBackupSuccessWithMultipleLinks(overallStats, overallStats.driveLinks);
            }

            return overallStats;

        } catch (error) {
            const endTime = Date.now();
            overallStats.totalDuration = endTime - startTime;
            overallStats.success = false;

            logger.error('Backup failed:', error);
            
            // Send failure email
            if (this.emailService) {
                await this.emailService.sendBackupFailure(error, overallStats);
            }

            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Run backup process for a single source
     */
    async runBackupForSource(sourceConfig) {
        const startTime = Date.now();
        let backupStats = {
            filesProcessed: 0,
            filesUploaded: 0,
            totalSize: 0,
            duration: 0,
            success: false
        };

        try {
            logger.info(`Starting backup for source: ${sourceConfig.name}`);

            // Ensure backup folder exists for this source
            const backupFolderId = await this.googleDrive.ensureBackupFolder(sourceConfig.backupFolderName);

            // Step 1: Scan source directory
            const currentFiles = await FileUtils.scanDirectory(sourceConfig.sourcePath);
            backupStats.filesProcessed = currentFiles.length;

            // Step 2: Compare with previous snapshot to find changes
            const previousFiles = this.backupState.getPreviousFileSnapshot(sourceConfig.name);
            const changes = FileUtils.compareFileSnapshots(currentFiles, previousFiles);

            // Step 3: Process changed files
            const filesToBackup = [...changes.added, ...changes.modified];
            const filesToDelete = changes.deleted;
            
            if (filesToBackup.length === 0 && filesToDelete.length === 0) {
                logger.info(`No files to backup or delete for ${sourceConfig.name}, mirror is up to date`);
                backupStats.success = true;
                return backupStats;
            }

            // Step 4: Sync files to mirror
            const syncResult = await this.syncMirrorFolder(filesToBackup, filesToDelete, sourceConfig.sourcePath, backupFolderId);
            backupStats.filesUploaded = syncResult.filesUploaded;
            backupStats.totalSize = syncResult.totalSize;

            // Step 5: Update file snapshot for this source
            this.backupState.updateFileSnapshot(currentFiles, sourceConfig.name);

            // Step 6: Update deduplication index
            await this.updateDeduplicationIndex(filesToBackup);

            const endTime = Date.now();
            backupStats.duration = endTime - startTime;
            backupStats.success = true;

            // Step 7: Save state and backup to Google Drive
            await this.backupState.saveAllWithGoogleDriveBackup(this.googleDrive);

            logger.info(`Backup for ${sourceConfig.name} completed successfully in ${(backupStats.duration / 1000).toFixed(2)}s`);
            logger.info(`Files processed: ${backupStats.filesProcessed}, uploaded: ${backupStats.filesUploaded}`);
            logger.info(`Total size: ${FileUtils.formatFileSize(backupStats.totalSize)}`);

            return backupStats;

        } catch (error) {
            const endTime = Date.now();
            backupStats.duration = endTime - startTime;
            backupStats.success = false;
            
            logger.error(`Backup failed for ${sourceConfig.name}:`, error);
            throw error;
        }
    }

    /**
     * Run restore process for a single source (Google Drive to local)
     */
    async runRestoreForSource(sourceConfig) {
        const startTime = Date.now();
        let restoreStats = {
            filesProcessed: 0,
            filesDownloaded: 0,
            totalSize: 0,
            duration: 0,
            success: false
        };

        try {
            logger.info(`Starting restore for source: ${sourceConfig.name}`);
            
            // Ensure the Google Drive folder exists
            const backupFolderId = await this.googleDrive.ensureBackupFolder(sourceConfig.backupFolderName);
            
            // Get all files from the Google Drive folder
            const driveFiles = await this.listFilesInBackupFolder(backupFolderId);
            restoreStats.filesProcessed = driveFiles.length;
            
            logger.info(`Found ${driveFiles.length} files in Google Drive folder '${sourceConfig.backupFolderName}'`);
            
            if (driveFiles.length === 0) {
                logger.info(`No files to restore from '${sourceConfig.backupFolderName}'`);
                restoreStats.success = true;
                return restoreStats;
            }

            // Ensure target directory exists with comprehensive logging
            logger.info(`Ensuring destination directory exists: ${sourceConfig.sourcePath}`);
            
            // Check if directory exists first
            const directoryExists = await fs.pathExists(sourceConfig.sourcePath);
            if (!directoryExists) {
                logger.info(`Creating destination directory: ${sourceConfig.sourcePath}`);
                await FileUtils.ensureDirectory(sourceConfig.sourcePath);
                logger.info(`Successfully created destination directory: ${sourceConfig.sourcePath}`);
            } else {
                logger.info(`Destination directory already exists: ${sourceConfig.sourcePath}`);
            }
            
            // Verify the directory is writable
            try {
                await fs.access(sourceConfig.sourcePath, fs.constants.W_OK);
                logger.info(`Destination directory is writable: ${sourceConfig.sourcePath}`);
            } catch (error) {
                throw new Error(`Destination directory is not writable: ${sourceConfig.sourcePath}. Please check permissions.`);
            }
            
            // Download all files
            let downloadedCount = 0;
            for (const file of driveFiles) {
                const localPath = path.join(sourceConfig.sourcePath, file.relativePath);
                
                // Ensure parent directory exists
                await FileUtils.ensureDirectory(path.dirname(localPath));
                
                // Download file
                await this.downloadFile(file.id, localPath);
                
                downloadedCount++;
                restoreStats.totalSize += file.size;
                
                if (downloadedCount % 10 === 0) {
                    logger.info(`Downloaded ${downloadedCount}/${driveFiles.length} files for '${sourceConfig.name}'...`);
                }
            }

            restoreStats.filesDownloaded = downloadedCount;
            restoreStats.success = true;
            
            const endTime = Date.now();
            restoreStats.duration = endTime - startTime;
            
            logger.info(`Restore completed for ${sourceConfig.name}:`);
            logger.info(`- Files downloaded: ${restoreStats.filesDownloaded}`);
            logger.info(`- Total size: ${FileUtils.formatFileSize(restoreStats.totalSize)}`);
            logger.info(`- Duration: ${(restoreStats.duration / 1000).toFixed(2)}s`);
            
            return restoreStats;
            
        } catch (error) {
            const endTime = Date.now();
            restoreStats.duration = endTime - startTime;
            restoreStats.success = false;
            
            logger.error(`Restore failed for ${sourceConfig.name}:`, error);
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
     * Generate Google Drive link for a specific folder
     */
    generateDriveLinkForFolder(folderName) {
        try {
            // Get the folder ID for the specific backup folder
            const folderId = this.googleDrive.backupFolderIds?.[folderName];
            if (folderId) {
                return `https://drive.google.com/drive/folders/${folderId}`;
            }
            return 'https://drive.google.com/drive/my-drive';
        } catch (error) {
            logger.error('Failed to generate drive link for folder:', error);
            return 'https://drive.google.com/drive/my-drive';
        }
    }

    /**
     * Group files into chunks based on size
     */
    groupFilesIntoChunks(files, maxChunkSize) {
        const chunks = [];
        let currentChunk = [];
        let currentChunkSize = 0;

        for (const file of files) {
            if (currentChunkSize + file.size > maxChunkSize && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentChunkSize = 0;
            }

            currentChunk.push(file);
            currentChunkSize += file.size;
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    /**
     * Update deduplication index
     */
    async updateDeduplicationIndex(files) {
        for (const file of files) {
            const isDuplicate = this.backupState.isFileDeduplicated(file.hash);
            
            if (isDuplicate) {
                logger.logDeduplication(file.path, file.size, file.size);
            }
            
            this.backupState.addToDeduplicationIndex(file.hash, file.path, file.size);
        }

        // Cleanup old entries
        this.backupState.cleanupDeduplicationIndex();
    }

    /**
     * Cleanup old backups based on retention policy
     */
    async cleanupOldBackups() {
        try {
            const retentionDays = this.config.retention.keepDailyBackups;
            await this.googleDrive.cleanupOldBackups(retentionDays);
        } catch (error) {
            logger.warn('Failed to cleanup old backups:', error.message);
        }
    }

    /**
     * Get backup statistics
     */
    getStats() {
        return this.backupState ? this.backupState.getStats() : null;
    }

    /**
     * Run backup manually
     */
    async runManualBackup() {
        logger.info('Starting manual backup...');
        
        // Initialize the system if not already done
        if (!this.backupState || !this.googleDrive) {
            await this.initialize();
        }
        
        return await this.runBackup();
    }

    /**
     * Get Google Drive backup folder link
     */
    async getGoogleDriveLink() {
        try {
            if (!this.googleDrive || !this.googleDrive.backupFolderId) {
                return null;
            }

            // Generate shareable link to the backup folder
            return `https://drive.google.com/drive/folders/${this.googleDrive.backupFolderId}`;
        } catch (error) {
            logger.warn('Failed to generate Google Drive link:', error.message);
            return null;
        }
    }

    /**
     * Generate Google Drive link for backup folders
     */
    generateDriveLink() {
        if (this.config.backup.sources.length === 1) {
            // Single source - return direct link to that folder
            const sourceName = this.config.backup.sources[0].name;
            const folderId = this.googleDrive.backupFolders.get(this.config.backup.sources[0].backupFolderName);
            return folderId ? `https://drive.google.com/drive/folders/${folderId}` : 'https://drive.google.com/drive/my-drive';
        } else {
            // Multiple sources - return link to main Google Drive
            return 'https://drive.google.com/drive/my-drive';
        }
    }

    /**
     * Keep the process alive
     */
    keepAlive() {
        const keepAliveInterval = setInterval(() => {
            // Log status every hour
            const stats = this.getStats();
            if (stats) {
                logger.info(`Backup service running - Total backups: ${stats.totalBackups}, Success rate: ${(stats.successRate * 100).toFixed(1)}%`);
            }
        }, 60 * 60 * 1000); // 1 hour

        // Handle process termination
        process.on('SIGINT', () => {
            clearInterval(keepAliveInterval);
        });

        process.on('SIGTERM', () => {
            clearInterval(keepAliveInterval);
        });
    }

    /**
     * Validate and create restore destination folders during initialization
     */
    async validateAndCreateRestoreDestinations() {
        try {
            logger.info('Validating and creating restore destination folders...');
            
            const restoreSources = this.config.backup.sources.filter(source => source.operation === 'restore');
            
            if (restoreSources.length === 0) {
                logger.info('No restore sources configured, skipping folder validation');
                return;
            }
            
            logger.info(`Found ${restoreSources.length} restore source(s) to validate`);
            
            for (const source of restoreSources) {
                logger.info(`Validating restore destination: ${source.name} -> ${source.sourcePath}`);
                
                try {
                    // Check if directory exists
                    const directoryExists = await fs.pathExists(source.sourcePath);
                    if (!directoryExists) {
                        logger.info(`Creating restore destination directory: ${source.sourcePath}`);
                        await FileUtils.ensureDirectory(source.sourcePath);
                        logger.info(`Successfully created restore destination: ${source.sourcePath}`);
                    } else {
                        logger.info(`Restore destination already exists: ${source.sourcePath}`);
                    }
                    
                    // Verify the directory is writable
                    await fs.access(source.sourcePath, fs.constants.W_OK);
                    logger.info(`Restore destination is writable: ${source.sourcePath}`);
                    
                    // Create a test file to ensure we can write to the directory
                    const testFilePath = path.join(source.sourcePath, '.tally-backup-test');
                    await fs.writeFile(testFilePath, 'test');
                    await fs.remove(testFilePath);
                    
                    logger.info(`✅ Restore destination validated successfully: ${source.name}`);
                    
                } catch (error) {
                    logger.error(`❌ Failed to validate restore destination '${source.name}': ${error.message}`);
                    throw new Error(`Cannot create or write to restore destination '${source.sourcePath}' for source '${source.name}'. Please check permissions and disk space.`);
                }
            }
            
            logger.info('All restore destination folders validated successfully');
            
        } catch (error) {
            logger.error('Failed to validate restore destinations:', error);
            throw error;
        }
    }
}

module.exports = TallyBackup;
