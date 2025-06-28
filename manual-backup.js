#!/usr/bin/env node

const TallyBackup = require('./src/TallyBackup');
const logger = require('./src/utils/logger');
const config = require('./config/config.json');

/**
 * Manual backup script
 * Usage: node manual-backup.js
 */

async function runManualBackup() {
    try {
        logger.info('='.repeat(60));
        logger.info('Starting Manual Tally Backup');
        logger.info('='.repeat(60));
        
        const backup = new TallyBackup(config);
        
        // Run backup
        const stats = await backup.runManualBackup();
        
        if (stats.success) {
            logger.info('\n✅ Manual backup completed successfully!');
            logger.info(`Files processed: ${stats.filesProcessed}`);
            logger.info(`Files uploaded: ${stats.filesUploaded}`);
            logger.info(`Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
            logger.info(`Duration: ${(stats.duration / 1000).toFixed(2)} seconds`);
        } else {
            logger.error('\n❌ Manual backup failed!');
            process.exit(1);
        }
        
    } catch (error) {
        logger.error('Manual backup failed:', error);
        process.exit(1);
    }
}

runManualBackup();
