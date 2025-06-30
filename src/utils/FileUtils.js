const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const CryptoJS = require('crypto-js');
const { glob } = require('glob');
const archiver = require('archiver');
const logger = require('./logger');

class FileUtils {
    /**
     * Calculate file hash for change detection
     * @param {string} filePath - Path to the file
     * @param {string} algorithm - Hash algorithm (default: SHA256)
     * @returns {Promise<string>} - File hash
     */
    static async calculateFileHash(filePath, algorithm = 'SHA256') {
        try {
            const fileBuffer = await fs.readFile(filePath);
            
            if (algorithm === 'SHA256') {
                return CryptoJS.SHA256(CryptoJS.lib.WordArray.create(fileBuffer)).toString();
            } else {
                const hash = crypto.createHash(algorithm.toLowerCase());
                hash.update(fileBuffer);
                return hash.digest('hex');
            }
        } catch (error) {
            logger.error(`Failed to calculate hash for ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Get file statistics including hash and modification time
     * @param {string} filePath - Path to the file
     * @returns {Promise<Object>} - File statistics
     */
    static async getFileStats(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const hash = await this.calculateFileHash(filePath);
            
            return {
                path: filePath,
                size: stats.size,
                modifiedTime: stats.mtime.getTime(),
                hash: hash,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile()
            };
        } catch (error) {
            logger.error(`Failed to get stats for ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Scan directory and get all files with their statistics
     * @param {string} dirPath - Directory path to scan
     * @param {Array<string>} excludePatterns - Patterns to exclude
     * @returns {Promise<Array>} - Array of file statistics
     */
    static async scanDirectory(dirPath, excludePatterns = []) {
        try {
            logger.info(`Scanning directory: ${dirPath}`);
            
            const files = [];
            const pattern = path.join(dirPath, '**', '*').replace(/\\/g, '/');
            
            const matches = await glob(pattern, { 
                ignore: excludePatterns,
                nodir: true,
                dot: true
            });

            for (const filePath of matches) {
                try {
                    const fileStats = await this.getFileStats(filePath);
                    files.push(fileStats);
                    
                    if (files.length % 100 === 0) {
                        logger.debug(`Scanned ${files.length} files...`);
                    }
                } catch (fileError) {
                    logger.warn(`Skipping file ${filePath}: ${fileError.message}`);
                }
            }
            
            logger.info(`Directory scan completed: ${files.length} files found`);
            return files;
        } catch (error) {
            logger.error(`Failed to scan directory ${dirPath}:`, error);
            throw error;
        }
    }

    /**
     * Compare two file lists and identify changes
     * @param {Array} currentFiles - Current file list
     * @param {Array} previousFiles - Previous file list
     * @returns {Object} - Changes summary
     */
    static compareFileSnapshots(currentFiles, previousFiles) {
        const previousMap = new Map(previousFiles.map(f => [f.path, f]));
        const currentMap = new Map(currentFiles.map(f => [f.path, f]));
        
        const changes = {
            added: [],
            modified: [],
            deleted: [],
            unchanged: []
        };

        // Check for added and modified files
        for (const [filePath, currentFile] of currentMap) {
            const previousFile = previousMap.get(filePath);
            
            if (!previousFile) {
                changes.added.push(currentFile);
            } else if (previousFile.hash !== currentFile.hash || 
                      previousFile.modifiedTime !== currentFile.modifiedTime) {
                changes.modified.push(currentFile);
            } else {
                changes.unchanged.push(currentFile);
            }
        }

        // Check for deleted files
        for (const [filePath, previousFile] of previousMap) {
            if (!currentMap.has(filePath)) {
                changes.deleted.push(previousFile);
            }
        }

        logger.info(`File changes detected:
        - Added: ${changes.added.length}
        - Modified: ${changes.modified.length}
        - Deleted: ${changes.deleted.length}
        - Unchanged: ${changes.unchanged.length}`);

        return changes;
    }

    /**
     * Create compressed archive of files
     * @param {Array} files - List of files to archive
     * @param {string} outputPath - Output archive path
     * @param {Object} options - Archive options
     * @returns {Promise<Object>} - Archive statistics
     */
    static async createArchive(files, outputPath, options = {}) {
        return new Promise((resolve, reject) => {
            try {
                const output = fs.createWriteStream(outputPath);
                const archive = archiver('zip', {
                    zlib: { level: options.compressionLevel || 6 }
                });

                let totalSize = 0;
                let compressedSize = 0;

                output.on('close', () => {
                    compressedSize = archive.pointer();
                    const stats = {
                        filesCount: files.length,
                        totalSize: totalSize,
                        compressedSize: compressedSize,
                        compressionRatio: totalSize > 0 ? (compressedSize / totalSize) : 0,
                        outputPath: outputPath
                    };
                    
                    logger.info(`Archive created: ${outputPath}
                    - Files: ${stats.filesCount}
                    - Original size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB
                    - Compressed size: ${(stats.compressedSize / 1024 / 1024).toFixed(2)} MB
                    - Compression ratio: ${(stats.compressionRatio * 100).toFixed(1)}%`);
                    
                    resolve(stats);
                });

                archive.on('error', (error) => {
                    logger.error(`Archive creation failed: ${error.message}`);
                    reject(error);
                });

                archive.pipe(output);

                // Add files to archive
                for (const file of files) {
                    if (fs.existsSync(file.path)) {
                        const relativePath = path.relative(options.basePath || path.dirname(file.path), file.path);
                        archive.file(file.path, { name: relativePath });
                        totalSize += file.size;
                    }
                }

                archive.finalize();
            } catch (error) {
                logger.error(`Failed to create archive: ${error.message}`);
                reject(error);
            }
        });
    }

    /**
     * Clean up temporary files
     * @param {string} tempDir - Temporary directory path
     */
    static async cleanupTempFiles(tempDir) {
        try {
            if (await fs.pathExists(tempDir)) {
                await fs.remove(tempDir);
                logger.info(`Cleaned up temporary files: ${tempDir}`);
            }
        } catch (error) {
            logger.warn(`Failed to cleanup temp files: ${error.message}`);
        }
    }

    /**
     * Ensure directory exists
     * @param {string} dirPath - Directory path
     */
    static async ensureDirectory(dirPath) {
        try {
            await fs.ensureDir(dirPath);
        } catch (error) {
            logger.error(`Failed to ensure directory ${dirPath}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get human-readable file size
     * @param {number} bytes - Size in bytes
     * @returns {string} - Formatted size string
     */
    static formatFileSize(bytes) {
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

module.exports = FileUtils;
