const cron = require('node-cron');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./utils/logger');
const FileUtils = require('./utils/FileUtils');
const GoogleDriveService = require('./GoogleDriveService');
const BackupState = require('./BackupState');

class TallyBackup {
    constructor(config) {
        this.config = config;
        this.isRunning = false;
        this.cronJob = null;
        this.googleDrive = null;
        this.backupState = null;
        this.tempDir = path.join(process.cwd(), 'temp', `backup-${Date.now()}`);
    }

    /**
     * Initialize the backup system
     */
    async initialize() {
        try {
            logger.info('Initializing Tally Backup system...');

            // Initialize backup state
            this.backupState = new BackupState(path.join(process.cwd(), 'data'));
            await this.backupState.initialize();

            // Initialize Google Drive service
            this.googleDrive = new GoogleDriveService(this.config.googleDrive);
            await this.googleDrive.initialize();

            // Ensure temp directory exists
            await FileUtils.ensureDirectory(this.tempDir);

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
     * Run backup process
     */
    async runBackup() {
        if (this.isRunning) {
            logger.warn('Backup already in progress');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();
        let backupStats = {
            filesProcessed: 0,
            filesUploaded: 0,
            totalSize: 0,
            duration: 0,
            success: false
        };

        try {
            this.backupState.startBackup();
            logger.logBackupStart(this.config.backup.sourcePath);

            // Step 1: Scan source directory
            const currentFiles = await this.scanSourceDirectory();
            backupStats.filesProcessed = currentFiles.length;

            // Step 2: Compare with previous snapshot to find changes
            const previousFiles = this.backupState.getPreviousFileSnapshot();
            const changes = FileUtils.compareFileSnapshots(currentFiles, previousFiles);

            // Step 3: Process changed files
            const filesToBackup = [...changes.added, ...changes.modified];
            const filesToDelete = changes.deleted;
            
            if (filesToBackup.length === 0 && filesToDelete.length === 0) {
                logger.info('No files to backup or delete, mirror is up to date');
                backupStats.success = true;
                return backupStats;
            }

            // Step 4: Sync files to mirror
            const syncResult = await this.syncMirrorFolder(filesToBackup, filesToDelete);
            backupStats.filesUploaded = syncResult.filesUploaded;
            backupStats.totalSize = syncResult.totalSize;

            // Step 5: Update file snapshot
            this.backupState.updateFileSnapshot(currentFiles);

            // Step 6: Update deduplication index
            await this.updateDeduplicationIndex(filesToBackup);

            // Step 7: Save state
            await this.backupState.saveAll();

            // Step 8: No cleanup needed for mirror approach

            backupStats.success = true;
            backupStats.duration = Date.now() - startTime;
            
            this.backupState.completeBackup(backupStats);
            logger.logBackupComplete(backupStats);

        } catch (error) {
            backupStats.duration = Date.now() - startTime;
            this.backupState.failBackup();
            logger.logBackupError(error);
            throw error;
        } finally {
            this.isRunning = false;
            await this.backupState.saveAll();
            await FileUtils.cleanupTempFiles(this.tempDir);
        }

        return backupStats;
    }

    /**
     * Scan source directory for files
     */
    async scanSourceDirectory() {
        const excludePatterns = [
            '**/node_modules/**',
            '**/temp/**',
            '**/logs/**',
            '**/.git/**',
            '**/Thumbs.db',
            '**/.DS_Store'
        ];

        return await FileUtils.scanDirectory(this.config.backup.sourcePath, excludePatterns);
    }

    /**
     * Sync files to Google Drive mirror folder
     */
    async syncMirrorFolder(filesToUpload, filesToDelete = []) {
        logger.info(`Syncing mirror folder:`);
        logger.info(`- Files to upload: ${filesToUpload.length}`);
        logger.info(`- Files to delete: ${filesToDelete.length}`);
        
        let filesUploaded = 0;
        let totalSize = 0;

        try {
            // Upload/Update files
            for (const file of filesToUpload) {
                const relativePath = path.relative(this.config.backup.sourcePath, file.path);
                
                await this.googleDrive.uploadFileToMirror(file.path, relativePath);
                
                filesUploaded++;
                totalSize += file.size;

                // Log progress
                if (filesUploaded % 10 === 0) {
                    logger.info(`Synced ${filesUploaded}/${filesToUpload.length} files...`);
                }
            }

            // Delete removed files
            for (const file of filesToDelete) {
                const relativePath = path.relative(this.config.backup.sourcePath, file.path);
                await this.googleDrive.deleteFileFromMirror(relativePath);
            }

            logger.info(`Mirror sync completed:`);
            logger.info(`- Files uploaded/updated: ${filesUploaded}`);
            logger.info(`- Files deleted: ${filesToDelete.length}`);
            logger.info(`- Total size: ${FileUtils.formatFileSize(totalSize)}`);

            return {
                filesUploaded,
                totalSize
            };

        } catch (error) {
            logger.error('Mirror sync failed:', error);
            throw error;
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
}

module.exports = TallyBackup;
