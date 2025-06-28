#!/usr/bin/env node

const GoogleDriveService = require('./src/GoogleDriveService');
const config = require('./config/config.json');
const logger = require('./src/utils/logger');

/**
 * Authentication setup script for Google Drive API
 * Usage: node setup-auth.js <authorization_code>
 */

async function setupAuthentication() {
    try {
        const authCode = process.argv[2];
        
        if (!authCode) {
            logger.info('='.repeat(50));
            logger.info('Google Drive Authentication Setup');
            logger.info('='.repeat(50));
            
            // Initialize Google Drive service to get auth URL
            const driveService = new GoogleDriveService(config.googleDrive);
            
            // Load credentials and setup auth
            const credentials = await driveService.loadCredentials();
            const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
            driveService.auth = new (require('googleapis').google.auth.OAuth2)(
                client_id, 
                client_secret, 
                redirect_uris[0]
            );

            const authUrl = driveService.auth.generateAuthUrl({
                access_type: 'offline',
                scope: ['https://www.googleapis.com/auth/drive.file']
            });

            logger.info('1. Please visit this URL to authorize the application:');
            logger.info(`   ${authUrl}`);
            logger.info('2. After authorization, you will receive a code.');
            logger.info('3. Run this script again with the code:');
            logger.info('   node setup-auth.js <authorization_code>');
            
            return;
        }

        // Save the authorization token
        logger.info('Setting up authentication with provided code...');
        
        const driveService = new GoogleDriveService(config.googleDrive);
        const credentials = await driveService.loadCredentials();
        const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
        
        driveService.auth = new (require('googleapis').google.auth.OAuth2)(
            client_id, 
            client_secret, 
            redirect_uris[0]
        );

        await driveService.saveToken(authCode);
        
        logger.info('✅ Authentication successful!');
        logger.info('You can now run the backup application:');
        logger.info('   npm start');
        
    } catch (error) {
        logger.error('❌ Authentication failed:', error);
        
        if (error.message.includes('access_denied') || error.message.includes('verification')) {
            logger.info('');
            logger.info('🔒 OAuth Consent Screen Issue Detected');
            logger.info('This happens when your app is in "Testing" mode in Google Cloud Console.');
            logger.info('');
            logger.info('📋 Quick Solutions:');
            logger.info('1. Add your email as a test user in Google Cloud Console:');
            logger.info('   - Go to APIs & Services → OAuth consent screen');
            logger.info('   - Scroll to "Test users" section');
            logger.info('   - Click "ADD USERS" and add your Gmail address');
            logger.info('');
            logger.info('2. OR when you see the warning in browser:');
            logger.info('   - Click "Advanced"');
            logger.info('   - Click "Go to Tally Backup Client (unsafe)"');
            logger.info('   - This is safe since you created the app yourself');
            logger.info('');
            logger.info('📖 See OAUTH-TROUBLESHOOTING.md for detailed solutions');
        } else {
            logger.info('Please make sure:');
            logger.info('1. You have a valid credentials.json file in the config directory');
            logger.info('2. The authorization code is correct and not expired');
            logger.info('3. You have enabled the Google Drive API in Google Cloud Console');
        }
        
        process.exit(1);
    }
}

setupAuthentication();
