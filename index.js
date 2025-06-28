#!/usr/bin/env node

const path = require('path');
const TallyBackup = require('./src/TallyBackup');
const logger = require('./src/utils/logger');
const config = require('./config/config.json');

async function main() {
    try {
        logger.info('='.repeat(60));
        logger.info('Starting Tally Backup Application');
        logger.info('='.repeat(60));
        
        const backup = new TallyBackup(config);
        
        // Handle process termination gracefully
        process.on('SIGINT', async () => {
            logger.info('Received SIGINT, shutting down gracefully...');
            await backup.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('Received SIGTERM, shutting down gracefully...');
            await backup.stop();
            process.exit(0);
        });

        // Start the backup scheduler
        await backup.start();
        
    } catch (error) {
        logger.error('Failed to start backup application:', error);
        process.exit(1);
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = main;
