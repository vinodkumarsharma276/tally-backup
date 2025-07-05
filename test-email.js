const EmailService = require('./src/EmailService');
const GoogleDriveService = require('./src/GoogleDriveService');
const config = require('./config/config.json');

async function testEmail() {
    console.log('🧪 Testing Email Service...\n');

    if (!config.email || !config.email.enabled) {
        console.log('❌ Email is disabled in config. Please run "npm run setup-email" first.');
        return;
    }

    try {
        // Initialize Google Drive service to get real backup folder ID
        console.log('🔗 Initializing Google Drive service to get backup folder link...');
        const googleDrive = new GoogleDriveService(config.googleDrive);
        await googleDrive.initialize();

        // Initialize email service
        const emailService = new EmailService(config.email);
        await emailService.initialize();

        // Test backup success email
        const mockBackupStats = {
            filesProcessed: 200,
            filesUploaded: 5,
            totalSize: 1024 * 1024 * 2.5, // 2.5 MB
            duration: 15000, // 15 seconds
            success: true
        };

        // Generate real Google Drive link
        const driveLink = `https://drive.google.com/drive/folders/${googleDrive.backupFolderId}`;
        console.log(`📂 Using real backup folder link: ${driveLink}`);

        console.log('📧 Sending test backup success email...');
        await emailService.sendBackupSuccess(mockBackupStats, driveLink);

        console.log('✅ Test email sent successfully!');
        console.log(`📧 Check your inbox: ${config.email.to}`);
        console.log('💡 If you don\'t see the email, check your spam folder.');

    } catch (error) {
        console.error('❌ Email test failed:', error.message);
        console.log('\n💡 Common issues:');
        console.log('- Invalid Gmail credentials');
        console.log('- Need to use App Password instead of regular password');
        console.log('- Check if 2-factor authentication is enabled');
        console.log('- Verify SMTP settings');
        console.log('- Google Drive credentials not configured');
        console.log('- Backup folder not found in Google Drive');
    }
}

// Run test if called directly
if (require.main === module) {
    testEmail();
}

module.exports = testEmail;
