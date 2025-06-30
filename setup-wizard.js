#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Setup Wizard for Tally Backup Pro
 * Interactive setup for first-time users
 */

async function main() {
  console.log('🧙‍♂️ Tally Backup Pro Setup Wizard');
  console.log('==================================');
  
  try {
    const inquirer = await import('inquirer');
    
    // Welcome message
    console.log('\n👋 Welcome to Tally Backup Pro!');
    console.log('This wizard will help you set up automated backups for your Tally data.\n');
    
    // Step 1: Basic Configuration
    console.log('📋 Step 1: Basic Configuration');
    console.log('------------------------------');
    
    const config = await inquirer.default.prompt([
      {
        type: 'input',
        name: 'tallyPath',
        message: 'Path to your Tally data folder:',
        default: process.platform === 'win32' 
          ? 'C:\\Users\\%USERNAME%\\Documents\\Tally' 
          : '/home/$USER/Tally',
        validate: (input) => {
          if (!input.trim()) return 'Please enter a valid path';
          return true;
        }
      },
      {
        type: 'input',
        name: 'schedule',
        message: 'Backup schedule (cron format):',
        default: '0 20 * * *',
        validate: (input) => {
          const cronRegex = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;
          if (!cronRegex.test(input.trim())) {
            return 'Please enter a valid cron expression (e.g., "0 20 * * *" for 8 PM daily)';
          }
          return true;
        }
      },
      {
        type: 'confirm',
        name: 'enableCompression',
        message: 'Enable backup compression (recommended for large datasets)?',
        default: false
      },
      {
        type: 'confirm',
        name: 'enableDeduplication',
        message: 'Enable deduplication to save storage space?',
        default: true
      }
    ]);
    
    // Step 2: Google Drive Setup
    console.log('\n☁️  Step 2: Google Drive Setup');
    console.log('-----------------------------');
    
    const driveSetup = await inquirer.default.prompt([
      {
        type: 'confirm',
        name: 'hasCredentials',
        message: 'Do you have Google Drive API credentials?',
        default: false
      }
    ]);
    
    if (!driveSetup.hasCredentials) {
      console.log('\n📖 To get Google Drive API credentials:');
      console.log('1. Go to: https://console.cloud.google.com/');
      console.log('2. Create a new project or select existing one');
      console.log('3. Enable Google Drive API');
      console.log('4. Create credentials (OAuth 2.0 Client ID)');
      console.log('5. Download the JSON file as credentials.json');
      console.log('\nFor detailed instructions, see: SETUP.md\n');
      
      const proceed = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'continue',
          message: 'Have you placed credentials.json in the config folder?',
          default: false
        }
      ]);
      
      if (!proceed.continue) {
        console.log('\n⏸️  Setup paused. Please get your credentials and run this wizard again.');
        process.exit(0);
      }
    }
    
    // Step 3: Service Installation
    console.log('\n🔧 Step 3: Service Installation');
    console.log('------------------------------');
    
    const serviceSetup = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'installType',
        message: 'How would you like to run Tally Backup Pro?',
        choices: [
          { name: 'Install as system service (recommended)', value: 'service' },
          { name: 'Manual execution only', value: 'manual' },
          { name: 'Docker container', value: 'docker' }
        ],
        default: 'service'
      }
    ]);
    
    // Create configuration
    await createConfiguration(config);
    
    // Setup Google Drive authentication
    if (driveSetup.hasCredentials || await fs.pathExists(path.join(process.cwd(), 'config', 'credentials.json'))) {
      console.log('\n🔐 Setting up Google Drive authentication...');
      try {
        execSync('node setup-auth-enhanced.js', { stdio: 'inherit' });
      } catch (error) {
        console.log('⚠️  Authentication setup failed. You can run it manually later:');
        console.log('   npm run setup-auth');
      }
    }
    
    // Install service
    if (serviceSetup.installType === 'service') {
      console.log('\n🚀 Installing system service...');
      await installService();
    } else if (serviceSetup.installType === 'docker') {
      console.log('\n🐳 Docker setup instructions:');
      await showDockerInstructions();
    }
    
    // Final steps
    console.log('\n✅ Setup completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   Tally Path: ${config.tallyPath}`);
    console.log(`   Schedule: ${config.schedule}`);
    console.log(`   Compression: ${config.enableCompression ? 'Enabled' : 'Disabled'}`);
    console.log(`   Deduplication: ${config.enableDeduplication ? 'Enabled' : 'Disabled'}`);
    console.log(`   Installation: ${serviceSetup.installType}`);
    
    console.log('\n🎯 What to do next:');
    if (serviceSetup.installType === 'service') {
      console.log('   • Your backups will run automatically');
      console.log('   • Check status: tally-backup status');
      console.log('   • View logs: check logs/tally-backup.log');
    } else if (serviceSetup.installType === 'manual') {
      console.log('   • Run backup: tally-backup backup');
      console.log('   • Check status: tally-backup status');
      console.log('   • View logs: check logs/tally-backup.log');
    }
    
    console.log('   • Test restore: tally-backup restore --dry-run');
    console.log('   • Get help: tally-backup --help');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

async function createConfiguration(config) {
  console.log('\n📝 Creating configuration...');
  
  const configDir = path.join(process.cwd(), 'config');
  await fs.ensureDir(configDir);
  
  // Expand environment variables in path
  let tallyPath = config.tallyPath;
  if (process.platform === 'win32') {
    tallyPath = tallyPath.replace('%USERNAME%', process.env.USERNAME || process.env.USER);
  } else {
    tallyPath = tallyPath.replace('$USER', process.env.USER);
  }
  
  const configData = {
    "tallyDataPath": tallyPath,
    "googleDrive": {
      "folderId": null,
      "folderName": "Tally Backup"
    },
    "backup": {
      "schedule": config.schedule,
      "enabled": true,
      "compression": config.enableCompression,
      "maxBackups": 30
    },
    "deduplication": {
      "enabled": config.enableDeduplication,
      "hashAlgorithm": "sha256"
    },
    "logging": {
      "level": "info",
      "maxFiles": 10,
      "maxSize": "10m"
    }
  };
  
  const configPath = path.join(configDir, 'config.json');
  await fs.writeJson(configPath, configData, { spaces: 2 });
  
  console.log('✅ Configuration saved to config/config.json');
}

async function installService() {
  try {
    if (process.platform === 'win32') {
      console.log('Installing Windows service...');
      execSync('node scripts/install-windows-service-pro.js', { stdio: 'inherit' });
    } else if (process.platform === 'linux') {
      console.log('Installing Linux service...');
      console.log('⚠️  Administrator privileges required...');
      execSync('sudo node scripts/install-linux-service-pro.js', { stdio: 'inherit' });
    } else {
      console.log('⚠️  Service installation not supported on this platform');
      console.log('You can run backups manually or use cron for scheduling');
    }
  } catch (error) {
    console.log('⚠️  Service installation failed:', error.message);
    console.log('You can install it manually later using:');
    console.log('   npm run install-service');
  }
}

async function showDockerInstructions() {
  console.log('\n🐳 Docker Setup Instructions:');
  console.log('1. Make sure Docker is installed and running');
  console.log('2. Edit docker-compose.yml with your Tally data path');
  console.log('3. Run: docker-compose up -d');
  console.log('4. Setup auth: docker-compose exec tally-backup npm run setup-auth');
  console.log('5. Check logs: docker-compose logs -f');
  
  // Create docker-compose.yml if it doesn't exist
  const dockerComposePath = path.join(process.cwd(), 'docker-compose.yml');
  if (!await fs.pathExists(dockerComposePath)) {
    const dockerComposeContent = `version: '3.8'

services:
  tally-backup:
    build: .
    container_name: tally-backup-pro
    restart: unless-stopped
    volumes:
      - ./config:/app/config
      - ./data:/app/data
      - ./logs:/app/logs
      - /path/to/your/tally/data:/app/tally-data:ro
    environment:
      - NODE_ENV=production
      - TZ=Asia/Kolkata
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
`;
    
    await fs.writeFile(dockerComposePath, dockerComposeContent);
    console.log('✅ Created docker-compose.yml');
  }
}

main().catch(console.error);
