const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');

// Use project root directory for logs
const baseDir = path.join(__dirname, '..', '..');

// Ensure logs directory exists
const logsDir = path.join(baseDir, 'logs');
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

// Create logger instance
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
        
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(logsDir, 'tally-backup.log'),
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 10,
            tailable: true
        }),
        
        // Separate file for errors
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true
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
