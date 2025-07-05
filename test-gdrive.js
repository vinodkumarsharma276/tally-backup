const GoogleDriveService = require('./src/GoogleDriveService');
const config = require('./config/config.json');

async function testGoogleDrive() {
    try {
        const gd = new GoogleDriveService(config.googleDrive);
        await gd.initialize();
        
        console.log('Main backup folder contents:');
        const files = await gd.listFiles();
        files.forEach(f => {
            console.log(`- ${f.name} (${f.mimeType === 'application/vnd.google-apps.folder' ? 'FOLDER' : 'FILE'})`);
        });
        
        // Check if system folder exists
        const systemFolder = files.find(f => f.name === '.tally-backup-system');
        if (systemFolder) {
            console.log('\nSystem folder contents:');
            const systemFiles = await gd.listFiles(systemFolder.id);
            systemFiles.forEach(f => {
                console.log(`- ${f.name} (${f.size} bytes)`);
            });
        }
        
    } catch (error) {
        console.error('Error:', error);
    }
}

testGoogleDrive();
