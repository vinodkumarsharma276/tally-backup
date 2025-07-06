#!/usr/bin/env node

const GoogleDriveService = require('./src/GoogleDriveService');
const configPathManager = require('./src/utils/ConfigPathManager');
const logger = require('./src/utils/logger');
const http = require('http');
const url = require('url');
const { exec } = require('child_process');

/**
 * Enhanced authentication setup script for Google Drive API
 * Usage: 
 *   node setup-auth-enhanced.js                    # Interactive mode with local server
 *   node setup-auth-enhanced.js <authorization_code> # Manual code input
 */

async function setupAuthenticationWithServer() {
    try {
        const authCode = process.argv[2];
        
        // Load configuration
        const config = await configPathManager.loadConfig();
        
        if (!authCode) {
            logger.info('='.repeat(60));
            logger.info('Google Drive Authentication Setup (Enhanced)');
            logger.info('='.repeat(60));
            
            // Initialize Google Drive service to get auth URL
            const driveService = new GoogleDriveService(config.googleDrive);
            
            // Load credentials and setup auth
            const credentials = await driveService.loadCredentials();
            const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
            
            // Use a local server redirect URI
            const redirectUri = 'http://localhost:3000/oauth2callback';
            driveService.auth = new (require('googleapis').google.auth.OAuth2)(
                client_id, 
                client_secret, 
                redirectUri
            );

            const authUrl = driveService.auth.generateAuthUrl({
                access_type: 'offline',
                scope: ['https://www.googleapis.com/auth/drive.file']
            });

            logger.info('Starting temporary local server to capture authorization code...');
            
            // Create temporary server to capture the code
            const server = await createTempServer(driveService);
            
            logger.info('1. Opening authorization URL in your default browser...');
            logger.info(`   If it doesn't open automatically, visit: ${authUrl}`);
            logger.info('2. Complete the authorization in your browser');
            logger.info('3. The code will be captured automatically');
            logger.info('');
            logger.info('Waiting for authorization...');
            
            // Open URL in default browser
            const start = process.platform === 'darwin' ? 'open' : 
                         process.platform === 'win32' ? 'start' : 'xdg-open';
            exec(`${start} "${authUrl}"`);
            
            return;
        }

        // Manual code input (fallback)
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
            logger.info('');
            logger.info('Manual fallback:');
            logger.info('1. Visit the authorization URL manually');
            logger.info('2. Copy the code from the redirected URL');
            logger.info('3. Run: node setup-auth.js <code>');
        }
        
        process.exit(1);
    }
}

/**
 * Create temporary server to capture OAuth callback
 */
function createTempServer(driveService) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                const parsedUrl = url.parse(req.url, true);
                
                if (parsedUrl.pathname === '/oauth2callback') {
                    const { code, error } = parsedUrl.query;
                    
                    if (error) {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end(`
                            <html>
                                <body>
                                    <h1>❌ Authorization Failed</h1>
                                    <p>Error: ${error}</p>
                                    <p>Please check the console for more details and try again.</p>
                                </body>
                            </html>
                        `);
                        server.close();
                        reject(new Error(`Authorization failed: ${error}`));
                        return;
                    }
                    
                    if (code) {
                        logger.info('✅ Authorization code received successfully!');
                        
                        try {
                            await driveService.saveToken(code);
                            
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(`
                                <html>
                                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                                        <h1 style="color: green;">✅ Authentication Successful!</h1>
                                        <p>Your Tally Backup application has been authorized successfully.</p>
                                        <p>You can now close this window and return to the terminal.</p>
                                        <p><strong>Next step:</strong> Run <code>npm start</code> to begin backups.</p>
                                    </body>
                                </html>
                            `);
                            
                            server.close();
                            logger.info('Authentication completed successfully!');
                            logger.info('You can now run: npm start');
                            resolve();
                            
                        } catch (tokenError) {
                            res.writeHead(500, { 'Content-Type': 'text/html' });
                            res.end(`
                                <html>
                                    <body>
                                        <h1>❌ Token Save Failed</h1>
                                        <p>Error: ${tokenError.message}</p>
                                        <p>Please check the console for more details.</p>
                                    </body>
                                </html>
                            `);
                            server.close();
                            reject(tokenError);
                        }
                    }
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not found');
                }
            } catch (serverError) {
                logger.error('Server error:', serverError);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                server.close();
                reject(serverError);
            }
        });

        server.listen(3000, 'localhost', () => {
            logger.info('Temporary server started on http://localhost:3000');
            resolve(server);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.warn('Port 3000 is in use. Please use manual method:');
                logger.warn('1. Visit the authorization URL');
                logger.warn('2. Copy the code from the URL after authorization');
                logger.warn('3. Run: node setup-auth.js <code>');
                reject(new Error('Port 3000 is already in use'));
            } else {
                reject(err);
            }
        });

        // Auto-close server after 5 minutes
        setTimeout(() => {
            server.close();
            logger.warn('Authentication timeout. Server closed.');
            reject(new Error('Authentication timeout'));
        }, 5 * 60 * 1000);
    });
}

setupAuthenticationWithServer();
