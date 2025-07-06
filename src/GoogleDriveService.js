const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils/logger');

class GoogleDriveService {
    constructor(config) {
        this.config = config;
        this.drive = null;
        this.auth = null;
        this.backupFolders = new Map(); // Map of folderName -> folderId
        this.backupFolderIds = {}; // Object to track folder IDs for link generation
    }

    /**
     * Initialize Google Drive service
     */
    async initialize() {
        try {
            logger.info('Initializing Google Drive service...');
            
            // Load credentials
            const credentials = await this.loadCredentials();
            
            // Setup OAuth2 client
            const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
            this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

            // Load token
            await this.loadToken();

            // Initialize Drive API
            this.drive = google.drive({ version: 'v3', auth: this.auth });

            logger.info('Google Drive service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize Google Drive service:', error);
            throw error;
        }
    }

    /**
     * Load Google Drive API credentials
     */
    async loadCredentials() {
        const credentialsPath = path.resolve(this.config.credentialsPath);
        
        if (!await fs.pathExists(credentialsPath)) {
            throw new Error(`Credentials file not found: ${credentialsPath}. Please download it from Google Cloud Console.`);
        }

        return await fs.readJson(credentialsPath);
    }

    /**
     * Load stored authentication token
     */
    async loadToken() {
        const tokenPath = path.resolve(this.config.tokenPath);
        
        if (await fs.pathExists(tokenPath)) {
            const token = await fs.readJson(tokenPath);
            this.auth.setCredentials(token);
            logger.info('Loaded existing authentication token');
        } else {
            await this.getNewToken();
        }
    }

    /**
     * Get new authentication token
     */
    async getNewToken() {
        const authUrl = this.auth.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/drive.file']
        });

        logger.warn(`Authentication required. Please visit this URL and authorize the application:
        ${authUrl}
        
        IMPORTANT: After authorization, you'll be redirected to localhost.
        The page may show "This site can't be reached" - that's normal!
        
        Look at the URL in your browser address bar. It will look like:
        http://localhost:3000/oauth2callback?code=4/0AY0e-g7...&scope=...
        
        Copy the code between 'code=' and '&scope' and run:
        node setup-auth.js <authorization_code>
        
        If you see "App isn't verified" error:
        1. Click "Advanced" or "Go to Tally Backup Client (unsafe)"
        2. Or add your email as test user in Google Cloud Console`);

        throw new Error('Authentication required. Please run setup-auth.js first.');
    }

    /**
     * Save authentication token
     */
    async saveToken(code) {
        try {
            const { tokens } = await this.auth.getToken(code);
            this.auth.setCredentials(tokens);
            
            const tokenPath = path.resolve(this.config.tokenPath);
            await fs.writeJson(tokenPath, tokens);
            
            logger.info('Authentication token saved successfully');
        } catch (error) {
            if (error.message.includes('access_denied')) {
                logger.error('Authentication was denied. Common causes:');
                logger.error('1. OAuth consent screen is in "Testing" mode - only approved testers can access');
                logger.error('2. User clicked "Cancel" during authorization');
                logger.error('3. App verification is required by Google');
                logger.error('');
                logger.error('Solutions:');
                logger.error('- Add your email as a test user in Google Cloud Console');
                logger.error('- Or publish the OAuth consent screen (requires verification for sensitive scopes)');
                logger.error('- Or click "Advanced" -> "Go to [App Name] (unsafe)" during authorization');
            }
            logger.error('Failed to save authentication token:', error);
            throw error;
        }
    }

    /**
     * Ensure backup folder exists in Google Drive
     */
    async ensureBackupFolder(folderName) {
        try {
            // Check if folder already exists in cache
            if (this.backupFolders.has(folderName)) {
                return this.backupFolders.get(folderName);
            }

            let folderId;

            // Search for existing backup folder
            const response = await this.apiCall(
                () => this.drive.files.list({
                    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                    fields: 'files(id, name)'
                })
            );

            if (response.data.files.length > 0) {
                folderId = response.data.files[0].id;
                logger.info(`Using existing backup folder: ${folderName} (${folderId})`);
            } else {
                // Create new backup folder
                const folderMetadata = {
                    name: folderName,
                    mimeType: 'application/vnd.google-apps.folder'
                };

                const folder = await this.apiCall(
                    () => this.drive.files.create({
                        resource: folderMetadata,
                        fields: 'id'
                    })
                );

                folderId = folder.data.id;
                logger.info(`Created new backup folder: ${folderName} (${folderId})`);
            }

            // Cache the folder ID
            this.backupFolders.set(folderName, folderId);
            this.backupFolderIds[folderName] = folderId; // For link generation
            return folderId;
        } catch (error) {
            logger.error(`Failed to ensure backup folder '${folderName}':`, error);
            throw error;
        }
    }

    /**
     * Upload file to Google Drive
     */
    async uploadFile(filePath, fileName, parentFolderId = null) {
        try {
            const fileSize = (await fs.stat(filePath)).size;
            
            if (fileSize > this.config.maxFileSize) {
                return await this.uploadLargeFile(filePath, fileName, parentFolderId);
            }

            logger.info(`Uploading file: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

            const fileMetadata = {
                name: fileName,
                parents: [parentFolderId || this.backupFolderId]
            };

            const media = {
                mimeType: 'application/octet-stream',
                body: fs.createReadStream(filePath)
            };

            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, size'
            });

            logger.info(`File uploaded successfully: ${fileName} (${response.data.id})`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to upload file ${fileName}:`, error);
            throw error;
        }
    }

    /**
     * Upload large file using resumable upload
     */
    async uploadLargeFile(filePath, fileName, parentFolderId = null) {
        try {
            const fileSize = (await fs.stat(filePath)).size;
            logger.info(`Uploading large file: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

            const fileMetadata = {
                name: fileName,
                parents: [parentFolderId || this.backupFolderId]
            };

            const media = {
                mimeType: 'application/octet-stream',
                body: fs.createReadStream(filePath)
            };

            // Use resumable upload for large files
            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, size',
                uploadType: 'resumable'
            });

            logger.info(`Large file uploaded successfully: ${fileName} (${response.data.id})`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to upload large file ${fileName}:`, error);
            throw error;
        }
    }

    /**
     * Create folder in Google Drive
     */
    async createFolder(folderName, parentFolderId = null) {
        return await this.executeWithRetry(async () => {
            const folderMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId || this.backupFolderId]
            };

            const response = await this.drive.files.create({
                resource: folderMetadata,
                fields: 'id, name'
            });

            logger.info(`Folder created: ${folderName} (${response.data.id})`);
            return response.data;
        }, `creating folder ${folderName}`);
    }

    /**
     * List files in Google Drive folder
     */
    async listFiles(folderId = null, query = '') {
        return await this.executeWithRetry(async () => {
            const parentId = folderId || this.backupFolderId;
            const q = `'${parentId}' in parents and trashed=false ${query ? `and ${query}` : ''}`;

            const response = await this.drive.files.list({
                q: q,
                fields: 'files(id, name, size, modifiedTime, mimeType)',
                orderBy: 'modifiedTime desc'
            });

            return response.data.files;
        }, `listing files in folder ${folderId || this.backupFolderId}`);
    }

    /**
     * Delete file from Google Drive
     */
    async deleteFile(fileId) {
        try {
            await this.drive.files.delete({
                fileId: fileId
            });
            
            logger.info(`File deleted: ${fileId}`);
        } catch (error) {
            logger.error(`Failed to delete file ${fileId}:`, error);
            throw error;
        }
    }

    /**
     * Get storage usage information
     */
    async getStorageUsage() {
        try {
            const response = await this.drive.about.get({
                fields: 'storageQuota'
            });

            const quota = response.data.storageQuota;
            return {
                used: parseInt(quota.usage),
                limit: parseInt(quota.limit),
                usedInDrive: parseInt(quota.usageInDrive),
                usedInDriveTrash: parseInt(quota.usageInDriveTrash)
            };
        } catch (error) {
            logger.error('Failed to get storage usage:', error);
            throw error;
        }
    }

    /**
     * Clean up old backups based on retention policy
     */
    async cleanupOldBackups(retentionDays = 30) {
        try {
            logger.info(`Cleaning up backups older than ${retentionDays} days...`);
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            
            const files = await this.listFiles();
            const oldFiles = files.filter(file => 
                new Date(file.modifiedTime) < cutoffDate
            );

            for (const file of oldFiles) {
                await this.deleteFile(file.id);
                logger.info(`Deleted old backup: ${file.name}`);
            }

            logger.info(`Cleanup completed: ${oldFiles.length} old backups deleted`);
        } catch (error) {
            logger.error('Failed to cleanup old backups:', error);
            throw error;
        }
    }

    /**
     * Upload individual file to mirror folder maintaining folder structure
     */
    async uploadFileToMirror(localFilePath, relativePath, backupFolderId) {
        try {
            const targetFolderId = await this.ensureFolderStructure(path.dirname(relativePath), backupFolderId);
            const fileName = path.basename(relativePath);
            
            // Check if file already exists
            const existingFile = await this.findFileInFolder(fileName, targetFolderId);
            
            const fileMetadata = {
                name: fileName,
                parents: [targetFolderId]
            };

            const media = {
                mimeType: 'application/octet-stream',
                body: fs.createReadStream(localFilePath)
            };

            let response;
            if (existingFile) {
                // Update existing file
                delete fileMetadata.parents; // Can't change parents on update
                response = await this.drive.files.update({
                    fileId: existingFile.id,
                    resource: fileMetadata,
                    media: media,
                    fields: 'id, name, size'
                });
                logger.info(`Updated file in mirror: ${relativePath}`);
            } else {
                // Create new file
                response = await this.drive.files.create({
                    resource: fileMetadata,
                    media: media,
                    fields: 'id, name, size'
                });
                logger.info(`Uploaded new file to mirror: ${relativePath}`);
            }

            return response.data;
        } catch (error) {
            logger.error(`Failed to upload file to mirror ${relativePath}:`, error);
            throw error;
        }
    }

    /**
     * Delete file from mirror
     */
    async deleteFileFromMirror(relativePath, backupFolderId) {
        try {
            const folderPath = path.dirname(relativePath);
            const fileName = path.basename(relativePath);
            
            const folderId = await this.findFolderByPath(folderPath, backupFolderId);
            if (!folderId) {
                logger.warn(`Folder not found for deletion: ${folderPath}`);
                return;
            }

            const file = await this.findFileInFolder(fileName, folderId);
            if (file) {
                await this.deleteFile(file.id);
                logger.info(`Deleted file from mirror: ${relativePath}`);
            } else {
                logger.warn(`File not found for deletion: ${relativePath}`);
            }
        } catch (error) {
            logger.error(`Failed to delete file from mirror ${relativePath}:`, error);
            throw error;
        }
    }

    /**
     * Ensure folder structure exists in Google Drive
     */
    async ensureFolderStructure(relativeFolderPath, rootFolderId) {
        try {
            if (!relativeFolderPath || relativeFolderPath === '.' || relativeFolderPath === '') {
                return rootFolderId;
            }

            const pathParts = relativeFolderPath.split(path.sep).filter(part => part);
            let currentFolderId = rootFolderId;

            for (const folderName of pathParts) {
                const existingFolder = await this.findFileInFolder(folderName, currentFolderId, 'application/vnd.google-apps.folder');
                
                if (existingFolder) {
                    currentFolderId = existingFolder.id;
                } else {
                    const newFolder = await this.createFolderInParent(folderName, currentFolderId);
                    currentFolderId = newFolder.id;
                }
            }

            return currentFolderId;
        } catch (error) {
            logger.error(`Failed to ensure folder structure ${relativeFolderPath}:`, error);
            throw error;
        }
    }

    /**
     * Create folder in specific parent
     */
    async createFolderInParent(folderName, parentId) {
        try {
            const fileMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentId]
            };

            const response = await this.drive.files.create({
                resource: fileMetadata,
                fields: 'id, name'
            });

            logger.info(`Created folder: ${folderName} in parent ${parentId}`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to create folder ${folderName}:`, error);
            throw error;
        }
    }

    /**
     * Find file in specific folder
     */
    async findFileInFolder(fileName, folderId, mimeType = null) {
        try {
            let query = `'${folderId}' in parents and name='${fileName}' and trashed=false`;
            if (mimeType) {
                query += ` and mimeType='${mimeType}'`;
            }

            const response = await this.drive.files.list({
                q: query,
                fields: 'files(id, name, size, mimeType)'
            });

            return response.data.files && response.data.files.length > 0 ? response.data.files[0] : null;
        } catch (error) {
            logger.error(`Failed to find file ${fileName} in folder ${folderId}:`, error);
            throw error;
        }
    }

    /**
     * Find folder by relative path
     */
    async findFolderByPath(relativePath, rootFolderId) {
        try {
            if (!relativePath || relativePath === '.' || relativePath === '') {
                return rootFolderId;
            }

            const pathParts = relativePath.split(path.sep).filter(part => part);
            let currentFolderId = rootFolderId;

            for (const folderName of pathParts) {
                const folder = await this.findFileInFolder(folderName, currentFolderId, 'application/vnd.google-apps.folder');
                if (!folder) {
                    return null;
                }
                currentFolderId = folder.id;
            }

            return currentFolderId;
        } catch (error) {
            logger.error(`Failed to find folder by path ${relativePath}:`, error);
            throw error;
        }
    }

    /**
     * List all files in mirror with their relative paths
     */
    async listMirrorFiles() {
        try {
            const allFiles = [];
            await this._listFilesRecursively(this.backupFolderId, '', allFiles);
            return allFiles;
        } catch (error) {
            logger.error('Failed to list mirror files:', error);
            throw error;
        }
    }

    /**
     * Recursively list files in folder structure
     */
    async _listFilesRecursively(folderId, currentPath, fileList) {
        try {
            const response = await this.drive.files.list({
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
     * Backup snapshot files to Google Drive
     * @param {string} snapshotFilePath - Path to local snapshot file
     * @param {string} fileName - Name for the backup file
     */
    async backupSnapshotToGoogleDrive(snapshotFilePath, fileName) {
        try {
            if (!await fs.pathExists(snapshotFilePath)) {
                logger.warn(`Snapshot file not found: ${snapshotFilePath}`);
                return;
            }

            // Create a hidden folder for system files
            const systemFolderId = await this.ensureSystemFolder();
            
            // Check if snapshot already exists
            const existingFile = await this.findFileInFolder(fileName, systemFolderId);
            
            const fileMetadata = {
                name: fileName,
                parents: [systemFolderId]
            };

            const media = {
                mimeType: 'application/json',
                body: fs.createReadStream(snapshotFilePath)
            };

            if (existingFile) {
                // Update existing snapshot
                delete fileMetadata.parents;
                await this.drive.files.update({
                    fileId: existingFile.id,
                    resource: fileMetadata,
                    media: media
                });
                logger.info(`Updated snapshot backup: ${fileName}`);
            } else {
                // Create new snapshot backup
                await this.drive.files.create({
                    resource: fileMetadata,
                    media: media
                });
                logger.info(`Created snapshot backup: ${fileName}`);
            }
        } catch (error) {
            logger.error(`Failed to backup snapshot ${fileName}:`, error);
            throw error;
        }
    }

    /**
     * Restore snapshot file from Google Drive
     * @param {string} fileName - Name of the backup file
     * @param {string} localFilePath - Path to restore the file to
     */
    async restoreSnapshotFromGoogleDrive(fileName, localFilePath) {
        try {
            const systemFolderId = await this.ensureSystemFolder();
            const file = await this.findFileInFolder(fileName, systemFolderId);
            
            if (!file) {
                logger.info(`No snapshot backup found: ${fileName}`);
                return false;
            }

            // Download the file
            const response = await this.drive.files.get({
                fileId: file.id,
                alt: 'media'
            });

            // Ensure local directory exists
            await fs.ensureDir(path.dirname(localFilePath));
            
            // Convert response data to string if it's an object (for JSON files)
            let fileContent = response.data;
            if (typeof fileContent === 'object') {
                fileContent = JSON.stringify(fileContent, null, 2);
            }
            
            // Write the file
            await fs.writeFile(localFilePath, fileContent, 'utf8');
            logger.info(`Restored snapshot from backup: ${fileName}`);
            
            return true;
        } catch (error) {
            logger.error(`Failed to restore snapshot ${fileName}:`, error);
            return false;
        }
    }

    /**
     * Ensure system folder exists for storing metadata files
     */
    async ensureSystemFolder() {
        try {
            const systemFolderName = '.tally-backup-system';
            
            // Search for system folder at root level
            const response = await this.drive.files.list({
                q: `name='${systemFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)'
            });
            
            if (response.data.files.length > 0) {
                return response.data.files[0].id;
            } else {
                // Create new system folder at root level
                const folderMetadata = {
                    name: systemFolderName,
                    mimeType: 'application/vnd.google-apps.folder'
                };

                const folder = await this.drive.files.create({
                    resource: folderMetadata,
                    fields: 'id'
                });

                logger.info(`Created system folder: ${systemFolderName} (${folder.data.id})`);
                return folder.data.id;
            }
        } catch (error) {
            logger.error('Failed to ensure system folder:', error);
            throw error;
        }
    }

    /**
     * Check if token is expired and handle refresh
     */
    async handleTokenExpiry(error) {
        if (error.message && (error.message.includes('invalid_grant') || error.message.includes('Token has been expired'))) {
            logger.warn('Authentication token has expired. Requesting new authentication...');
            
            // Clear the expired token
            const tokenPath = path.resolve(this.config.tokenPath);
            if (await fs.pathExists(tokenPath)) {
                await fs.remove(tokenPath);
            }
            
            // Request new token
            await this.getNewToken();
            return true;
        }
        
        if (error.code === 401 || error.status === 401) {
            logger.warn('Authentication failed. Token may be expired or invalid.');
            
            // Clear the token and request new one
            const tokenPath = path.resolve(this.config.tokenPath);
            if (await fs.pathExists(tokenPath)) {
                await fs.remove(tokenPath);
            }
            
            await this.getNewToken();
            return true;
        }
        
        return false;
    }

    /**
     * Wrapper for API calls with automatic token refresh
     */
    async executeWithRetry(apiCall, context = '') {
        try {
            return await apiCall();
        } catch (error) {
            logger.error(`API call failed${context ? ` (${context})` : ''}: ${error.message}`);
            
            // Check if this is a token expiry error
            const wasTokenExpired = await this.handleTokenExpiry(error);
            if (wasTokenExpired) {
                // Token was expired and we've requested a new one
                // Don't retry automatically - let the user re-authenticate
                throw new Error('Authentication token expired. Please run setup-auth.js to re-authenticate.');
            }
            
            // Re-throw other errors
            throw error;
        }
    }

    /**
     * Wrapper for Google API calls with retry logic
     */
    async apiCall(apiFunction, ...args) {
        let retries = 3;
        while (retries > 0) {
            try {
                return await apiFunction(...args);
            } catch (error) {
                const errorMessage = error.message || '';
                
                if (errorMessage.includes('getaddrinfo ENOTFOUND') ||
                    errorMessage.includes('socket hang up') ||
                    errorMessage.includes('ECONNRESET') ||
                    errorMessage.includes('ETIMEDOUT')) {
                    
                    logger.warn(`API call failed (${retries} retries left): ${errorMessage}`);
                    retries--;
                    
                    if (retries > 0) {
                        // Exponential backoff
                        const delay = Math.pow(2, 4 - retries) * 1000;
                        logger.info(`Retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }
                
                throw error;
            }
        }
        
        return await apiFunction(...args);
    }
}

module.exports = GoogleDriveService;
