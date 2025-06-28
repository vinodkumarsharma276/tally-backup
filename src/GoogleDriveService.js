const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils/logger');

class GoogleDriveService {
    constructor(config) {
        this.config = config;
        this.drive = null;
        this.auth = null;
        this.backupFolderId = null;
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

            // Ensure backup folder exists
            await this.ensureBackupFolder();
            
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
        
        IMPORTANT: If you see "App isn't verified" error, follow these steps:
        1. Click "Advanced" or "Go to Tally Backup Client (unsafe)"
        2. Or publish your OAuth consent screen in Google Cloud Console
        
        After authorization, you'll receive a code. Please run:
        node setup-auth.js <authorization_code>`);

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
    async ensureBackupFolder() {
        try {
            // Search for existing backup folder
            const response = await this.drive.files.list({
                q: `name='${this.config.backupFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)'
            });

            if (response.data.files.length > 0) {
                this.backupFolderId = response.data.files[0].id;
                logger.info(`Using existing backup folder: ${this.config.backupFolderName} (${this.backupFolderId})`);
            } else {
                // Create new backup folder
                const folderMetadata = {
                    name: this.config.backupFolderName,
                    mimeType: 'application/vnd.google-apps.folder'
                };

                const folder = await this.drive.files.create({
                    resource: folderMetadata,
                    fields: 'id'
                });

                this.backupFolderId = folder.data.id;
                logger.info(`Created new backup folder: ${this.config.backupFolderName} (${this.backupFolderId})`);
            }
        } catch (error) {
            logger.error('Failed to ensure backup folder:', error);
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
        try {
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
        } catch (error) {
            logger.error(`Failed to create folder ${folderName}:`, error);
            throw error;
        }
    }

    /**
     * List files in Google Drive folder
     */
    async listFiles(folderId = null, query = '') {
        try {
            const parentId = folderId || this.backupFolderId;
            const q = `'${parentId}' in parents and trashed=false ${query ? `and ${query}` : ''}`;

            const response = await this.drive.files.list({
                q: q,
                fields: 'files(id, name, size, modifiedTime, mimeType)',
                orderBy: 'modifiedTime desc'
            });

            return response.data.files;
        } catch (error) {
            logger.error('Failed to list files:', error);
            throw error;
        }
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
}

module.exports = GoogleDriveService;
