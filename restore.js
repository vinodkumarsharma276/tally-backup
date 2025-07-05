#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');
const GoogleDriveService = require('./src/GoogleDriveService');
const logger = require('./src/utils/logger');
const readline = require('readline');

/**
 * Enhanced restore script for the multi-source mirror backup system
 * This downloads backup folders from Google Drive to local directories
 */
class TallyRestore {
    constructor() {
        this.config = require('./config/config.json');
        this.googleDrive = null;
        this.backupFolders = new Map(); // Map of folder name to folder ID
    }

    async initialize() {
        try {
            logger.info('Initializing restore service...');
            
            this.googleDrive = new GoogleDriveService(this.config.googleDrive);
            await this.googleDrive.initialize();
            
            // Load backup folder information
            await this.loadBackupFolders();
            
            logger.info('Restore service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize restore service:', error);
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
     * List all available backup sources
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
     * Interactive restore menu
     */
    async showRestoreMenu() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const question = (text) => new Promise((resolve) => rl.question(text, resolve));

        try {
            console.log('\n🔄 Tally Backup Restore Menu');
            console.log('============================\n');

            const sources = await this.listBackupSources();
            
            if (sources.length === 0) {
                console.log('❌ No backup sources found in Google Drive');
                return;
            }

            console.log('Available backup sources:');
            sources.forEach((source, index) => {
                console.log(`${index + 1}. ${source.name} (${source.backupFolderName})`);
                console.log(`   Files: ${source.fileCount}, Size: ${this.formatFileSize(source.totalSize)}`);
                console.log(`   Original path: ${source.sourcePath}\n`);
            });

            console.log('Options:');
            console.log('A. Restore all sources to original locations');
            console.log('B. Restore specific source to original location');
            console.log('C. Restore specific source to custom location');
            console.log('D. List backup contents only');
            console.log('Q. Quit\n');

            const choice = await question('Enter your choice (A/B/C/D/Q): ');

            switch (choice.toUpperCase()) {
                case 'A':
                    await this.handleRestoreAllSources();
                    break;
                case 'B':
                    await this.handleRestoreSpecificSource(sources, true);
                    break;
                case 'C':
                    await this.handleRestoreSpecificSource(sources, false);
                    break;
                case 'D':
                    await this.handleListBackupContents(sources);
                    break;
                case 'Q':
                    console.log('Goodbye!');
                    break;
                default:
                    console.log('Invalid choice. Please try again.');
                    await this.showRestoreMenu();
            }
        } catch (error) {
            console.error('Error in restore menu:', error);
        } finally {
            rl.close();
        }
    }

    /**
     * Interactive restore menu
     */
    async showRestoreMenu() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const question = (text) => new Promise((resolve) => rl.question(text, resolve));

        try {
            console.log('\n🔄 Tally Backup Restore Menu');
            console.log('============================\n');

            const sources = await this.listBackupSources();
            
            if (sources.length === 0) {
                console.log('❌ No backup sources found in Google Drive');
                return;
            }

            console.log('Available backup sources:');
            sources.forEach((source, index) => {
                console.log(`${index + 1}. ${source.name} (${source.backupFolderName})`);
                console.log(`   Files: ${source.fileCount}, Size: ${this.formatFileSize(source.totalSize)}`);
                console.log(`   Original path: ${source.sourcePath}\n`);
            });

            console.log('Options:');
            console.log('A. Restore all sources to original locations');
            console.log('B. Restore specific source to original location');
            console.log('C. Restore specific source to custom location');
            console.log('D. List backup contents only');
            console.log('Q. Quit\n');

            const choice = await question('Enter your choice (A/B/C/D/Q): ');

            switch (choice.toUpperCase()) {
                case 'A':
                    await this.handleRestoreAllSources(rl);
                    break;
                case 'B':
                    await this.handleRestoreSpecificSource(sources, true, rl);
                    break;
                case 'C':
                    await this.handleRestoreSpecificSource(sources, false, rl);
                    break;
                case 'D':
                    await this.handleListBackupContents(sources, rl);
                    break;
                case 'Q':
                    console.log('Goodbye!');
                    break;
                default:
                    console.log('Invalid choice. Please try again.');
                    rl.close();
                    await this.showRestoreMenu();
                    return;
            }
        } catch (error) {
            console.error('Error in restore menu:', error);
        } finally {
            rl.close();
        }
    }

    async handleRestoreAllSources(rl) {
        try {
            const confirm = await this.askConfirmation('This will restore all sources to their original locations. Continue?', rl);
            if (!confirm) return;

            const result = await this.restoreAllSources();
            
            console.log('\n✅ All sources restored successfully!');
            result.results.forEach(r => {
                console.log(`📁 ${r.sourceName}: ${r.filesRestored} files, ${this.formatFileSize(r.totalSize)}`);
            });
            
        } catch (error) {
            console.error('❌ Restore failed:', error.message);
        }
    }

    async handleRestoreSpecificSource(sources, useOriginalPath, rl) {
        const question = (text) => new Promise((resolve) => rl.question(text, resolve));
        
        try {
            const sourceIndex = parseInt(await question('Enter source number: ')) - 1;

            if (sourceIndex < 0 || sourceIndex >= sources.length) {
                console.log('Invalid source number.');
                return;
            }

            const selectedSource = sources[sourceIndex];
            const folderInfo = this.backupFolders.get(selectedSource.backupFolderName);
            
            let outputPath = folderInfo.sourcePath;
            if (!useOriginalPath) {
                outputPath = await question(`Enter destination path (default: ${folderInfo.sourcePath}): `) || folderInfo.sourcePath;
            }

            const confirm = await this.askConfirmation(`Restore '${selectedSource.name}' to '${outputPath}'?`, rl);
            if (!confirm) return;

            const result = await this.restoreSourceToDirectory(folderInfo, outputPath);
            
            console.log(`\n✅ '${result.sourceName}' restored successfully!`);
            console.log(`📁 Files: ${result.filesRestored}`);
            console.log(`💾 Size: ${this.formatFileSize(result.totalSize)}`);
            console.log(`📂 Location: ${result.outputPath}`);
            
        } catch (error) {
            console.error('❌ Restore failed:', error.message);
        }
    }

    async handleListBackupContents(sources, rl) {
        const question = (text) => new Promise((resolve) => rl.question(text, resolve));
        
        try {
            const sourceIndex = parseInt(await question('Enter source number to list contents: ')) - 1;

            if (sourceIndex < 0 || sourceIndex >= sources.length) {
                console.log('Invalid source number.');
                return;
            }

            const selectedSource = sources[sourceIndex];
            const folderInfo = this.backupFolders.get(selectedSource.backupFolderName);
            const files = await this.listFilesInBackupFolder(folderInfo.id);
            
            console.log(`\n📂 Contents of '${selectedSource.name}' backup:`);
            console.log('=' .repeat(50));
            
            if (files.length === 0) {
                console.log('No files found in this backup.');
                return;
            }

            files.forEach(file => {
                console.log(`📄 ${file.relativePath}`);
                console.log(`   Size: ${this.formatFileSize(file.size)}`);
                console.log(`   Modified: ${new Date(file.modifiedTime).toLocaleString()}\n`);
            });
            
        } catch (error) {
            console.error('❌ Failed to list contents:', error.message);
        }
    }

    async askConfirmation(message, rl) {
        if (rl) {
            const question = (text) => new Promise((resolve) => rl.question(text, resolve));
            const answer = await question(`${message} (y/N): `);
            return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
        } else {
            const tempRl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise(resolve => 
                tempRl.question(`${message} (y/N): `, resolve)
            );
            
            tempRl.close();
            return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
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
        const restore = new TallyRestore();
        await restore.initialize();
        
        // Check for command line arguments
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            // Interactive mode
            await restore.showRestoreMenu();
        } else if (args[0] === '--all') {
            // Restore all sources to original locations
            console.log('🔄 Restoring all sources to original locations...');
            const result = await restore.restoreAllSources();
            console.log('✅ All sources restored successfully!');
            console.log(`� Total files: ${result.totalFilesRestored}`);
            console.log(`💾 Total size: ${restore.formatFileSize(result.totalSizeRestored)}`);
        } else if (args[0] === '--source' && args[1]) {
            // Restore specific source
            const sourceName = args[1];
            const outputPath = args[2] || null;
            
            const sources = await restore.listBackupSources();
            const source = sources.find(s => s.name === sourceName || s.backupFolderName === sourceName);
            
            if (!source) {
                console.error(`❌ Source '${sourceName}' not found`);
                console.log('Available sources:');
                sources.forEach(s => console.log(`  - ${s.name} (${s.backupFolderName})`));
                process.exit(1);
            }
            
            const folderInfo = restore.backupFolders.get(source.backupFolderName);
            const targetPath = outputPath || folderInfo.sourcePath;
            
            console.log(`🔄 Restoring '${source.name}' to '${targetPath}'...`);
            const result = await restore.restoreSourceToDirectory(folderInfo, targetPath);
            
            console.log(`✅ '${result.sourceName}' restored successfully!`);
            console.log(`📁 Files: ${result.filesRestored}`);
            console.log(`💾 Size: ${restore.formatFileSize(result.totalSize)}`);
            console.log(`📂 Location: ${result.outputPath}`);
        } else if (args[0] === '--list') {
            // List available sources
            const sources = await restore.listBackupSources();
            console.log('� Available backup sources:');
            sources.forEach(source => {
                console.log(`\n${source.name} (${source.backupFolderName})`);
                console.log(`  Files: ${source.fileCount}`);
                console.log(`  Size: ${restore.formatFileSize(source.totalSize)}`);
                console.log(`  Original path: ${source.sourcePath}`);
            });
        } else {
            // Show help
            console.log('🔄 Tally Backup Restore Tool');
            console.log('Usage:');
            console.log('  node restore.js                    # Interactive mode');
            console.log('  node restore.js --all              # Restore all sources to original locations');
            console.log('  node restore.js --source <name>    # Restore specific source to original location');
            console.log('  node restore.js --source <name> <path>  # Restore specific source to custom path');
            console.log('  node restore.js --list             # List available backup sources');
        }
        
    } catch (error) {
        console.error('❌ Restore failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = TallyRestore;
