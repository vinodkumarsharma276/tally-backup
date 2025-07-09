const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs-extra');

// Dynamically determine if we're in a package or development environment
let logsDir;
try {
    // Try to use ConfigPathManager for proper path resolution
    const configManager = require('./ConfigPathManager');
    logsDir = configManager.getLogsDir();
    
    // Ensure directories exist
    configManager.ensureDirectories();
    
    console.log(`Logger initialized with logs directory: ${logsDir}`);
} catch (error) {
    console.error('Failed to initialize ConfigPathManager:', error.message);
    // Fallback to relative path if ConfigPathManager fails
    const baseDir = path.join(__dirname, '..', '..');
    logsDir = path.join(baseDir, 'logs');
    console.log(`Logger falling back to relative path: ${logsDir}`);
}

// Ensure logs directory exists
fs.ensureDirSync(logsDir);

// Custom format for log messages
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
        let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        if (stack) {
            log += '\n' + stack;
        }
        return log;
    })
);

// Create logger instance with daily rotation
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // Console transport
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            )
        }),
        
        // Daily rotating file transport for all logs
        new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'tally-backup-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '30d', // Keep 30 days of logs
            createSymlink: true,
            symlinkName: path.join(logsDir, 'tally-backup-current.log')
        }),
        
        // Daily rotating file transport for errors only
        new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '30d', // Keep 30 days of error logs
            createSymlink: true,
            symlinkName: path.join(logsDir, 'error-current.log')
        })
    ]
});

// Add backup-specific logging methods
logger.logBackupStart = (sourcePath) => {
    logger.info(`Starting backup process for: ${sourcePath}`);
};

logger.logBackupComplete = (stats) => {
    logger.info(`Backup completed successfully:
    - Files processed: ${stats.filesProcessed}
    - Files uploaded: ${stats.filesUploaded}
    - Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB
    - Duration: ${stats.duration}ms`);
};

logger.logBackupError = (error, context = '') => {
    logger.error(`Backup failed${context ? ` (${context})` : ''}: ${error.message}`, { error });
};

logger.logFileProcessed = (filePath, action, size) => {
    logger.debug(`File ${action}: ${filePath} (${(size / 1024).toFixed(2)} KB)`);
};

logger.logDeduplication = (filePath, savedSize, totalSize) => {
    const percentage = ((savedSize / totalSize) * 100).toFixed(1);
    logger.info(`Deduplication: ${filePath} - ${percentage}% saved (${(savedSize / 1024 / 1024).toFixed(2)} MB)`);
};

module.exports = logger;
