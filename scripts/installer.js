#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Cross-platform installer for Tally Backup Pro
 * Handles NPM installation, configuration, and service setup
 */

const packageJson = require('../package.json');
const VERSION = packageJson.version;

console.log(`🚀 Tally Backup Pro v${VERSION} Installer`);
console.log('=====================================');

async function main() {
  try {
    const platform = process.platform;
    console.log(`🖥️  Platform: ${platform}`);
    
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 14) {
      console.error('❌ Node.js 14.0.0 or later is required');
      console.log(`Current version: ${nodeVersion}`);
      console.log('Please update Node.js: https://nodejs.org/');
      process.exit(1);
    }
    
    console.log(`✅ Node.js ${nodeVersion} detected`);
    
    // Check if this is a global installation
    const isGlobal = process.argv.includes('--global') || __dirname.includes('node_modules');
    
    if (isGlobal) {
      await globalInstallation();
    } else {
      await localInstallation();
    }
    
  } catch (error) {
    console.error('❌ Installation failed:', error.message);
    process.exit(1);
  }
}

async function globalInstallation() {
  console.log('\n📦 Global Installation Mode');
  console.log('===========================');
  
  try {
    // Check if tally-backup command is available
    execSync('tally-backup --version', { stdio: 'pipe' });
    console.log('✅ Tally Backup Pro is already installed globally');
  } catch (error) {
    console.log('❌ Tally Backup Pro not found in PATH');
    console.log('\nTo install globally, run:');
    console.log('   npm install -g tally-backup-pro');
    return;
  }
  
  // Create user data directory
  const userDataDir = getUserDataDirectory();
  await fs.ensureDir(userDataDir);
  console.log(`📁 User data directory: ${userDataDir}`);
  
  // Setup configuration
  await setupConfiguration(userDataDir);
  
  console.log('\n🔧 Next Steps:');
  console.log('1. Run: tally-backup setup-auth');
  console.log('2. Run: tally-backup init');
  console.log('3. Run: tally-backup install-service (optional)');
}

async function localInstallation() {
  console.log('\n📁 Local Installation Mode');
  console.log('==========================');
  
  const currentDir = process.cwd();
  console.log(`📁 Installation directory: ${currentDir}`);
  
  // Install dependencies if needed
  if (!await fs.pathExists(path.join(currentDir, 'node_modules'))) {
    console.log('📦 Installing dependencies...');
    execSync('npm install', { stdio: 'inherit' });
  }
  
  // Setup configuration
  await setupConfiguration(currentDir);
  
  console.log('\n🔧 Next Steps:');
  console.log('1. Run: npm run setup-auth');
  console.log('2. Edit config/config.json');
  console.log('3. Run: npm start');
  console.log('4. Run: npm run install-service (optional)');
}

async function setupConfiguration(baseDir) {
  console.log('\n⚙️  Setting up configuration...');
  
  const configDir = path.join(baseDir, 'config');
  const dataDir = path.join(baseDir, 'data');
  const logsDir = path.join(baseDir, 'logs');
  const tempDir = path.join(baseDir, 'temp');
  
  // Create directories
  await fs.ensureDir(configDir);
  await fs.ensureDir(dataDir);
  await fs.ensureDir(logsDir);
  await fs.ensureDir(tempDir);
  
  // Copy default configuration if it doesn't exist
  const configPath = path.join(configDir, 'config.json');
  if (!await fs.pathExists(configPath)) {
    const defaultConfig = {
      "tallyDataPath": process.platform === 'win32' 
        ? "C:\\Users\\%USERNAME%\\Documents\\Tally" 
        : "/home/$USER/Tally",
      "googleDrive": {
        "folderId": null,
        "folderName": "Tally Backup"
      },
      "backup": {
        "schedule": "0 20 * * *",
        "enabled": true,
        "compression": false,
        "maxBackups": 30
      },
      "deduplication": {
        "enabled": true,
        "hashAlgorithm": "sha256"
      },
      "logging": {
        "level": "info",
        "maxFiles": 10,
        "maxSize": "10m"
      }
    };
    
    await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
    console.log('✅ Default configuration created');
  }
  
  // Copy credentials template if it doesn't exist
  const credentialsPath = path.join(configDir, 'credentials.example.json');
  if (!await fs.pathExists(credentialsPath)) {
    const credentialsTemplate = {
      "installed": {
        "client_id": "your-client-id.apps.googleusercontent.com",
        "project_id": "your-project-id",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": "your-client-secret",
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"]
      }
    };
    
    await fs.writeJson(credentialsPath, credentialsTemplate, { spaces: 2 });
    console.log('✅ Credentials template created');
  }
  
  console.log('✅ Configuration setup complete');
}

function getUserDataDirectory() {
  const os = require('os');
  const platform = process.platform;
  
  if (platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'TallyBackupPro');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'TallyBackupPro');
  } else {
    return path.join(os.homedir(), '.tally-backup-pro');
  }
}

main().catch(console.error);
