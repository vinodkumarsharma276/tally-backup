const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils/logger');

class BackupState {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.stateFile = path.join(dataDir, 'backup-state.json');
        this.snapshotFile = path.join(dataDir, 'file-snapshot.json');
        this.dedupeFile = path.join(dataDir, 'deduplication-index.json');
        this.state = {
            lastBackupTime: null,
            lastSuccessfulBackup: null,
            totalBackups: 0,
            failedBackups: 0,
            totalFilesBackedUp: 0,
            totalSizeBackedUp: 0
        };
        this.fileSnapshots = new Map(); // Map of sourceName -> fileSnapshot
        this.deduplicationIndex = new Map();
    }

    /**
     * Initialize backup state
     */
    async initialize() {
        try {
            await fs.ensureDir(this.dataDir);
            await this.loadState();
            await this.loadFileSnapshot();
            await this.loadDeduplicationIndex();
            logger.info('Backup state initialized');
        } catch (error) {
            logger.error('Failed to initialize backup state:', error);
            throw error;
        }
    }

    /**
     * Load backup state from file
     */
    async loadState() {
        try {
            if (await fs.pathExists(this.stateFile)) {
                this.state = await fs.readJson(this.stateFile);
                logger.info('Loaded existing backup state');
            } else {
                logger.info('No existing backup state found, starting fresh');
            }
        } catch (error) {
            logger.warn('Failed to load backup state, starting fresh:', error.message);
            this.state = {
                lastBackupTime: null,
                lastSuccessfulBackup: null,
                totalBackups: 0,
                failedBackups: 0,
                totalFilesBackedUp: 0,
                totalSizeBackedUp: 0
            };
        }
    }

    /**
     * Save backup state to file
     */
    async saveState() {
        try {
            await fs.writeJson(this.stateFile, this.state, { spaces: 2 });
        } catch (error) {
            logger.error('Failed to save backup state:', error);
            throw error;
        }
    }

    /**
     * Load file snapshot from file
     */
    async loadFileSnapshot() {
        try {
            if (await fs.pathExists(this.snapshotFile)) {
                const snapshotData = await fs.readJson(this.snapshotFile);
                
                // Convert to Map of Maps for multiple sources
                this.fileSnapshots = new Map();
                for (const [sourceName, sourceData] of Object.entries(snapshotData)) {
                    this.fileSnapshots.set(sourceName, new Map(Object.entries(sourceData)));
                }
                
                const totalEntries = Array.from(this.fileSnapshots.values()).reduce((sum, map) => sum + map.size, 0);
                logger.info(`Loaded file snapshots with ${totalEntries} total entries across ${this.fileSnapshots.size} sources`);
            } else {
                logger.info('No existing file snapshot found');
            }
        } catch (error) {
            logger.warn('Failed to load file snapshot:', error.message);
            this.fileSnapshots = new Map();
        }
    }

    /**
     * Save file snapshot to file
     */
    async saveFileSnapshot() {
        try {
            const snapshotData = {};
            for (const [sourceName, sourceSnapshot] of this.fileSnapshots.entries()) {
                snapshotData[sourceName] = Object.fromEntries(sourceSnapshot);
            }
            await fs.writeJson(this.snapshotFile, snapshotData, { spaces: 2 });
        } catch (error) {
            logger.error('Failed to save file snapshot:', error);
            throw error;
        }
    }

    /**
     * Load deduplication index from file
     */
    async loadDeduplicationIndex() {
        try {
            if (await fs.pathExists(this.dedupeFile)) {
                const dedupeData = await fs.readJson(this.dedupeFile);
                this.deduplicationIndex = new Map(Object.entries(dedupeData));
                logger.info(`Loaded deduplication index with ${this.deduplicationIndex.size} entries`);
            } else {
                logger.info('No existing deduplication index found');
            }
        } catch (error) {
            logger.warn('Failed to load deduplication index:', error.message);
            this.deduplicationIndex = new Map();
        }
    }

    /**
     * Save deduplication index to file
     */
    async saveDeduplicationIndex() {
        try {
            const dedupeData = Object.fromEntries(this.deduplicationIndex);
            await fs.writeJson(this.dedupeFile, dedupeData, { spaces: 2 });
        } catch (error) {
            logger.error('Failed to save deduplication index:', error);
            throw error;
        }
    }

    /**
     * Update file snapshot with current files
     */
    updateFileSnapshot(files) {
        this.fileSnapshot.clear();
        for (const file of files) {
            this.fileSnapshot.set(file.path, {
                hash: file.hash,
                size: file.size,
                modifiedTime: file.modifiedTime,
                lastBackup: Date.now()
            });
        }
    }

    /**
     * Get previous file snapshot as array
     */
    getPreviousFileSnapshot(sourceName = 'default') {
        if (!this.fileSnapshots.has(sourceName)) {
            return [];
        }
        
        const snapshot = this.fileSnapshots.get(sourceName);
        return Array.from(snapshot.entries()).map(([path, data]) => ({
            path,
            hash: data.hash,
            size: data.size,
            modifiedTime: data.modifiedTime
        }));
    }

    /**
     * Update file snapshot for a specific source
     */
    updateFileSnapshot(files, sourceName = 'default') {
        const snapshot = new Map();
        
        files.forEach(file => {
            snapshot.set(file.path, {
                hash: file.hash,
                size: file.size,
                modifiedTime: file.modifiedTime
            });
        });
        
        this.fileSnapshots.set(sourceName, snapshot);
        logger.info(`Updated file snapshot for source: ${sourceName} (${files.length} files)`);
    }

    /**
     * Check if file is deduplicated
     */
    isFileDeduplicated(fileHash) {
        return this.deduplicationIndex.has(fileHash);
    }

    /**
     * Add file to deduplication index
     */
    addToDeduplicationIndex(fileHash, filePath, size) {
        if (!this.deduplicationIndex.has(fileHash)) {
            this.deduplicationIndex.set(fileHash, {
                firstSeen: Date.now(),
                paths: [filePath],
                size: size,
                backupCount: 1
            });
        } else {
            const entry = this.deduplicationIndex.get(fileHash);
            if (!entry.paths.includes(filePath)) {
                entry.paths.push(filePath);
            }
            entry.backupCount++;
            this.deduplicationIndex.set(fileHash, entry);
        }
    }

    /**
     * Get deduplication statistics
     */
    getDeduplicationStats() {
        let totalSize = 0;
        let deduplicatedSize = 0;
        let deduplicatedFiles = 0;

        for (const [hash, data] of this.deduplicationIndex) {
            totalSize += data.size * data.backupCount;
            deduplicatedSize += data.size;
            if (data.backupCount > 1) {
                deduplicatedFiles += data.backupCount - 1;
            }
        }

        return {
            uniqueFiles: this.deduplicationIndex.size,
            deduplicatedFiles,
            totalOriginalSize: totalSize,
            actualStorageSize: deduplicatedSize,
            spaceSaved: totalSize - deduplicatedSize,
            deduplicationRatio: totalSize > 0 ? (totalSize - deduplicatedSize) / totalSize : 0
        };
    }

    /**
     * Start backup session
     */
    startBackup() {
        this.state.lastBackupTime = Date.now();
        this.state.totalBackups++;
    }

    /**
     * Complete successful backup
     */
    completeBackup(stats) {
        this.state.lastSuccessfulBackup = Date.now();
        this.state.totalFilesBackedUp += stats.filesProcessed || 0;
        this.state.totalSizeBackedUp += stats.totalSize || 0;
    }

    /**
     * Record failed backup
     */
    failBackup() {
        this.state.failedBackups++;
    }

    /**
     * Update last backup with overall statistics
     */
    updateLastBackup(stats) {
        this.state.lastBackupTime = Date.now();
        this.state.totalBackups++;
        
        if (stats.success) {
            this.state.lastSuccessfulBackup = Date.now();
            this.state.totalFilesBackedUp += stats.totalFilesProcessed || stats.filesProcessed || 0;
            this.state.totalSizeBackedUp += stats.totalSize || 0;
        } else {
            this.state.failedBackups++;
        }
        
        logger.info(`Updated backup state: Total backups: ${this.state.totalBackups}, Success rate: ${((this.state.totalBackups - this.state.failedBackups) / this.state.totalBackups * 100).toFixed(1)}%`);
    }

    /**
     * Get backup statistics
     */
    getStats() {
        const dedupeStats = this.getDeduplicationStats();
        
        return {
            ...this.state,
            deduplication: dedupeStats,
            fileSnapshotSize: this.fileSnapshot.size,
            successRate: this.state.totalBackups > 0 ? 
                ((this.state.totalBackups - this.state.failedBackups) / this.state.totalBackups) : 0
        };
    }

    /**
     * Clean up old entries from deduplication index
     */
    cleanupDeduplicationIndex(maxAge = 90 * 24 * 60 * 60 * 1000) { // 90 days
        const cutoffTime = Date.now() - maxAge;
        let cleanedCount = 0;

        for (const [hash, data] of this.deduplicationIndex) {
            if (data.firstSeen < cutoffTime && data.backupCount === 1) {
                this.deduplicationIndex.delete(hash);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.info(`Cleaned up ${cleanedCount} old entries from deduplication index`);
        }
    }

    /**
     * Save all state data
     */
    async saveAll() {
        await Promise.all([
            this.saveState(),
            this.saveFileSnapshot(),
            this.saveDeduplicationIndex()
        ]);
    }

    /**
     * Initialize backup state with Google Drive restore capability
     * @param {GoogleDriveService} googleDriveService - Google Drive service instance
     */
    async initializeWithGoogleDriveRestore(googleDriveService) {
        try {
            await fs.ensureDir(this.dataDir);
            
            // Try to restore snapshots from Google Drive if local files don't exist
            if (!await fs.pathExists(this.snapshotFile)) {
                logger.info('Local snapshot not found, trying to restore from Google Drive...');
                await googleDriveService.restoreSnapshotFromGoogleDrive('file-snapshot.json', this.snapshotFile);
            }
            
            if (!await fs.pathExists(this.dedupeFile)) {
                logger.info('Local deduplication index not found, trying to restore from Google Drive...');
                await googleDriveService.restoreSnapshotFromGoogleDrive('deduplication-index.json', this.dedupeFile);
            }
            
            if (!await fs.pathExists(this.stateFile)) {
                logger.info('Local backup state not found, trying to restore from Google Drive...');
                await googleDriveService.restoreSnapshotFromGoogleDrive('backup-state.json', this.stateFile);
            }
            
            // Load all state files
            await this.loadState();
            await this.loadFileSnapshot();
            await this.loadDeduplicationIndex();
            
            logger.info('Backup state initialized with Google Drive restore capability');
        } catch (error) {
            logger.error('Failed to initialize backup state with Google Drive restore:', error);
            throw error;
        }
    }

    /**
     * Save all state files and backup to Google Drive
     * @param {GoogleDriveService} googleDriveService - Google Drive service instance
     */
    async saveAllWithGoogleDriveBackup(googleDriveService) {
        try {
            // Save all files locally first
            await this.saveAll();
            
            // Backup to Google Drive
            await googleDriveService.backupSnapshotToGoogleDrive(this.snapshotFile, 'file-snapshot.json');
            await googleDriveService.backupSnapshotToGoogleDrive(this.dedupeFile, 'deduplication-index.json');
            await googleDriveService.backupSnapshotToGoogleDrive(this.stateFile, 'backup-state.json');
            
            logger.info('All backup state files saved locally and backed up to Google Drive');
        } catch (error) {
            logger.error('Failed to save backup state with Google Drive backup:', error);
            throw error;
        }
    }
}

module.exports = BackupState;
