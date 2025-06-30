const path = require('path');
const fs = require('fs-extra');
const os = require('os');

async function postInstall() {
  try {
    console.log('🚀 Setting up Tally Backup Pro...\n');
    
    // Create user data directory
    const userDataDir = path.join(os.homedir(), '.tally-backup-pro');
    await fs.ensureDir(userDataDir);
    await fs.ensureDir(path.join(userDataDir, 'config'));
    await fs.ensureDir(path.join(userDataDir, 'data'));
    await fs.ensureDir(path.join(userDataDir, 'logs'));
    
    console.log(`📁 User data directory created: ${userDataDir}`);
    
    // Copy default config if it doesn't exist
    const configPath = path.join(userDataDir, 'config', 'config.json');
    if (!await fs.pathExists(configPath)) {
      const defaultConfig = {
        backup: {
          sourcePath: process.platform === 'win32' 
            ? path.join(os.homedir(), 'Documents', 'Tally')
            : path.join(os.homedir(), 'Tally'),
          schedule: '0 20 * * *',
          maxRetries: 3,
          retryDelay: 5000,
          compressionLevel: 6,
          chunkSizeMB: 50
        },
        googleDrive: {
          credentialsPath: path.join(userDataDir, 'config', 'credentials.json'),
          tokenPath: path.join(userDataDir, 'config', 'token.json'),
          backupFolderName: 'Tally Backup',
          maxFileSize: 104857600,
          uploadTimeout: 300000
        },
        logging: {
          level: 'info',
          maxFiles: 10,
          maxSize: '10MB',
          logPath: path.join(userDataDir, 'logs')
        }
      };
      
      await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
      console.log('⚙️  Default configuration created');
    }
    
    // Create credentials example
    const credentialsExamplePath = path.join(userDataDir, 'config', 'credentials.example.json');
    const credentialsExample = {
      "web": {
        "client_id": "your-client-id.apps.googleusercontent.com",
        "project_id": "your-project-id",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": "your-client-secret",
        "redirect_uris": ["http://localhost"]
      }
    };
    
    await fs.writeJson(credentialsExamplePath, credentialsExample, { spaces: 2 });
    
    console.log('\n✅ Tally Backup Pro setup completed!\n');
    console.log('📋 Next Steps:');
    console.log('1. 🔑 Setup Google Drive credentials:');
    console.log(`   Copy your credentials.json to: ${path.join(userDataDir, 'config', 'credentials.json')}`);
    console.log('2. 🔐 Authenticate with Google Drive:');
    console.log('   tally-backup setup-auth');
    console.log('3. 🧪 Test backup:');
    console.log('   tally-backup backup');
    console.log('4. 🔧 Install as service:');
    console.log('   tally-backup install-service');
    console.log('\n📁 Configuration directory: ' + userDataDir);
    console.log('📖 Documentation: https://github.com/your-username/tally-backup-pro');
    
  } catch (error) {
    console.error('❌ Post-install setup failed:', error.message);
  }
}

if (require.main === module) {
  postInstall();
}

module.exports = postInstall;
