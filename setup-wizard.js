#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const configPathManager = require('./src/utils/ConfigPathManager');

/**
 * Setup Wizard for Tally Backup Pro
 * Interactive setup for first-time users with bidirectional sync support
 */

async function main() {
  console.log('🧙‍♂️ Tally Backup Pro Setup Wizard');
  console.log('===================================');
  
  try {
    const inquirer = await import('inquirer');
    
    // Welcome message
    console.log('\n👋 Welcome to Tally Backup Pro!');
    console.log('This wizard will help you set up automated backups and restores.');
    console.log('You can configure both:');
    console.log('  📤 Backup: Local folders → Google Drive');
    console.log('  📥 Restore: Google Drive → Local folders');
    console.log('');
    
    // Check if config already exists
    const mainConfigPath = configPathManager.getConfigPath();
    const mainConfigExists = await fs.pathExists(mainConfigPath);
    
    if (mainConfigExists) {
      console.log('📋 Existing Configuration Detected');
      console.log('----------------------------------');
      console.log('✅ Found existing config.json file');
      console.log('💡 Tip: If you want to start fresh, delete config/config.json first');
      console.log('🔧 Tip: You can manually edit config/config.json for advanced settings');
      console.log('');
      
      const proceed = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'useExisting',
          message: 'Use existing configuration and skip setup?',
          default: true
        }
      ]);
      
      if (proceed.useExisting) {
        console.log('✅ Using existing configuration. Skipping to authentication and service setup...');
        // Skip to authentication and service setup
        await handleExistingConfig();
        return;
      } else {
        console.log('⚠️  Proceeding with wizard will create new configuration');
        console.log('   (existing config will be backed up)');
        
        // Backup existing config
        const backupPath = path.join(process.cwd(), 'config', `config.backup.${Date.now()}.json`);
        await fs.copy(mainConfigPath, backupPath);
        console.log(`📄 Backed up existing config to: ${path.basename(backupPath)}`);
      }
    }
    
    // Step 1: Basic Configuration
    console.log('📋 Step 1: Basic Configuration');
    console.log('------------------------------');
    
    const basicConfig = await inquirer.default.prompt([
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
    console.log('💡 Service mode runs Tally Backup as an automated scheduler:');
    console.log('   • Runs 24/7 in the background');
    console.log('   • Automatically starts with Windows');
    console.log('   • Executes backups on your schedule');
    console.log('   • No manual intervention required');
    console.log('');
    
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
    
    // Step 4: Source Configuration
    console.log('\n📁 Step 4: Source Configuration');
    console.log('--------------------------------');
    
    const sourceConfig = await inquirer.default.prompt([
      {
        type: 'input',
        name: 'tallyPath',
        message: 'Tally data folder path:',
        default: process.platform === 'win32' ? 'C:\\Tally\\Data' : '/opt/tally/data',
        validate: (input) => {
          if (!input.trim()) {
            return 'Please enter a valid folder path';
          }
          return true;
        }
      }
    ]);
    
    // Combine all configuration
    const config = {
      ...basicConfig,
      ...sourceConfig
    };
    
    // Check if configuration already exists
    const configPath = path.join(process.cwd(), 'config', 'config.json');
    const configExists = await fs.pathExists(configPath);
    
    if (configExists) {
      console.log('\n📋 Configuration Found');
      console.log('----------------------');
      console.log('✅ Found existing config.json file');
      
      // Load and display existing config
      try {
        const existingConfig = await fs.readJson(configPath);
        console.log('\n📊 Current Configuration:');
        
        // Display backup sources
        if (existingConfig.backup && existingConfig.backup.sources) {
          console.log('   Backup Sources:');
          existingConfig.backup.sources.forEach((source, index) => {
            console.log(`     ${index + 1}. ${source.name} (${source.operation})`);
            console.log(`        Path: ${source.sourcePath}`);
            console.log(`        Folder: ${source.backupFolderName}`);
          });
        }
        
        // Display schedule
        if (existingConfig.backup && existingConfig.backup.schedule) {
          console.log(`   Schedule: ${existingConfig.backup.schedule}`);
        }
        
        // Display other key settings
        if (existingConfig.deduplication && existingConfig.deduplication.enabled !== undefined) {
          console.log(`   Deduplication: ${existingConfig.deduplication.enabled ? 'Enabled' : 'Disabled'}`);
        }
        
        if (existingConfig.email && existingConfig.email.enabled !== undefined) {
          console.log(`   Email Notifications: ${existingConfig.email.enabled ? 'Enabled' : 'Disabled'}`);
        }
        
        console.log('\n✅ Using existing configuration. Skipping config creation.');
      } catch (error) {
        console.log('⚠️  Error reading existing config:', error.message);
        console.log('Creating new configuration...');
        await createConfiguration(config);
      }
    } else {
      console.log('\n📝 Creating new configuration...');
      await createConfiguration(config);
    }
    
    // Setup Google Drive authentication
    if (driveSetup.hasCredentials || await fs.pathExists(path.join(process.cwd(), 'config', 'credentials.json'))) {
      await setupGoogleDriveAuth();
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
    
    // Load and display final configuration summary
    try {
      const finalConfig = await fs.readJson(configPath);
      console.log('\n📋 Final Configuration Summary:');
      
      // Display backup sources
      if (finalConfig.backup && finalConfig.backup.sources) {
        console.log('   📤 Backup Sources:');
        finalConfig.backup.sources.forEach((source, index) => {
          console.log(`     ${index + 1}. ${source.name} (${source.operation})`);
          console.log(`        Path: ${source.sourcePath}`);
        });
      }
      
      // Display schedule
      if (finalConfig.backup && finalConfig.backup.schedule) {
        console.log(`   ⏰ Schedule: ${finalConfig.backup.schedule}`);
      }
      
      // Display key settings
      if (finalConfig.deduplication && finalConfig.deduplication.enabled !== undefined) {
        console.log(`   🔄 Deduplication: ${finalConfig.deduplication.enabled ? 'Enabled' : 'Disabled'}`);
      }
      
      if (finalConfig.email && finalConfig.email.enabled !== undefined) {
        console.log(`   📧 Email Notifications: ${finalConfig.email.enabled ? 'Enabled' : 'Disabled'}`);
      }
      
      console.log(`   🚀 Installation: ${serviceSetup.installType}`);
      
    } catch (error) {
      // Fallback to wizard inputs if config can't be read
      console.log('\n📋 Summary:');
      console.log(`   Tally Path: ${config.tallyPath}`);
      console.log(`   Schedule: ${config.schedule}`);
      console.log(`   Compression: ${config.enableCompression ? 'Enabled' : 'Disabled'}`);
      console.log(`   Deduplication: ${config.enableDeduplication ? 'Enabled' : 'Disabled'}`);
      console.log(`   Installation: ${serviceSetup.installType}`);
    }
    
    console.log('\n🎯 What to do next:');
    if (serviceSetup.installType === 'service') {
      console.log('   🚀 Your backups will run automatically on schedule!');
      console.log('   📊 Monitor service: node status.js');
      console.log('   📋 View logs: check logs/tally-backup.log');
      console.log('   🔧 Service control: Use Windows Services Manager');
      console.log('   ⚙️  Service name: "TallyBackupPro"');
    } else if (serviceSetup.installType === 'manual') {
      console.log('   🔄 Run backup: npm run backup');
      console.log('   📊 Check status: npm run status');
      console.log('   📋 View logs: check logs/tally-backup.log');
      console.log('   🔧 Manual restore: npm run restore');
    }
    
    console.log('   🧪 Test restore: npm run restore --dry-run');
    console.log('   ❓ Get help: npm run --help');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

async function createConfiguration(config) {
  console.log('\n📝 Creating configuration...');
  
  await configPathManager.ensureDirectories();
  
  // Expand environment variables in path
  let tallyPath = config.tallyPath;
  if (process.platform === 'win32') {
    // Replace environment variables properly
    tallyPath = tallyPath.replace(/%USERNAME%/g, process.env.USERNAME || process.env.USER || '');
    tallyPath = tallyPath.replace(/%USERPROFILE%/g, process.env.USERPROFILE || process.env.HOME || '');
    tallyPath = tallyPath.replace(/%APPDATA%/g, process.env.APPDATA || '');
    tallyPath = tallyPath.replace(/%LOCALAPPDATA%/g, process.env.LOCALAPPDATA || '');
    tallyPath = tallyPath.replace(/%PROGRAMDATA%/g, process.env.PROGRAMDATA || '');
    tallyPath = tallyPath.replace(/%PROGRAMFILES%/g, process.env.PROGRAMFILES || '');
  } else {
    tallyPath = tallyPath.replace('$USER', process.env.USER || '');
    tallyPath = tallyPath.replace('$HOME', process.env.HOME || '');
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
  
  const configPath = configPathManager.getConfigPath();
  await fs.writeJson(configPath, configData, { spaces: 2 });
  
  console.log(`✅ Configuration saved to ${configPath}`);
}

async function installService() {
  try {
    if (process.platform === 'win32') {
      console.log('Installing Windows service...');
      
      // Check if the service script exists
      const serviceScriptPath = path.join(process.cwd(), 'scripts', 'install-windows-service-pro.js');
      if (!await fs.pathExists(serviceScriptPath)) {
        console.log('⚠️  Service script not found. Skipping service installation.');
        console.log('You can install the service manually later using:');
        console.log('   npm run install-service');
        return;
      }
      
      execSync('node scripts/install-windows-service-pro.js', { 
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env
      });
    } else if (process.platform === 'linux') {
      console.log('Installing Linux service...');
      console.log('⚠️  Administrator privileges required...');
      
      // Check if the service script exists
      const serviceScriptPath = path.join(process.cwd(), 'scripts', 'install-linux-service-pro.js');
      if (!await fs.pathExists(serviceScriptPath)) {
        console.log('⚠️  Service script not found. Skipping service installation.');
        console.log('You can install the service manually later using:');
        console.log('   npm run install-service');
        return;
      }
      
      execSync('sudo node scripts/install-linux-service-pro.js', { 
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env
      });
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

async function handleExistingConfig() {
  try {
    // Load existing config
    const configPath = path.join(process.cwd(), 'config', 'config.json');
    const existingConfig = await fs.readJson(configPath);
    
    console.log('\n📊 Current Configuration:');
    
    // Display backup sources
    if (existingConfig.backup && existingConfig.backup.sources) {
      console.log('   📤 Backup Sources:');
      existingConfig.backup.sources.forEach((source, index) => {
        console.log(`     ${index + 1}. ${source.name} (${source.operation})`);
        console.log(`        Path: ${source.sourcePath}`);
        console.log(`        Folder: ${source.backupFolderName}`);
      });
    }
    
    // Display schedule
    if (existingConfig.backup && existingConfig.backup.schedule) {
      console.log(`   ⏰ Schedule: ${existingConfig.backup.schedule}`);
    }
    
    // Display other key settings
    if (existingConfig.deduplication && existingConfig.deduplication.enabled !== undefined) {
      console.log(`   🔄 Deduplication: ${existingConfig.deduplication.enabled ? 'Enabled' : 'Disabled'}`);
    }
    
    if (existingConfig.email && existingConfig.email.enabled !== undefined) {
      console.log(`   📧 Email Notifications: ${existingConfig.email.enabled ? 'Enabled' : 'Disabled'}`);
    }
    
    // Show Google Drive status
    const credentialsPath = path.join(process.cwd(), 'config', 'credentials.json');
    const tokenPath = path.join(process.cwd(), 'config', 'token.json');
    const hasCredentials = await fs.pathExists(credentialsPath);
    const hasToken = await fs.pathExists(tokenPath);
    
    if (hasCredentials && hasToken) {
      console.log('   ☁️  Google Drive: Ready');
    } else {
      console.log('   ☁️  Google Drive: Needs Setup');
    }
    
    // Continue with authentication and service setup
    await continueWithAuthAndService();
    
  } catch (error) {
    console.log('⚠️  Error reading existing config:', error.message);
    console.log('Please check your config/config.json file and fix any syntax errors.');
    process.exit(1);
  }
}

async function continueWithAuthAndService() {
  try {
    const inquirer = await import('inquirer');
    
    // Check current Google Drive authentication status
    const credentialsPath = path.join(process.cwd(), 'config', 'credentials.json');
    const tokenPath = path.join(process.cwd(), 'config', 'token.json');
    
    const hasCredentials = await fs.pathExists(credentialsPath);
    const hasToken = await fs.pathExists(tokenPath);
    
    // Google Drive Setup
    console.log('\n☁️  Google Drive Authentication Status');
    console.log('------------------------------------');
    
    if (hasCredentials && hasToken) {
      console.log('✅ Google Drive authentication is already configured');
      console.log('   Credentials: Found');
      console.log('   Token: Found');
      
      const driveSetup = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'reconfigureAuth',
          message: 'Do you want to reconfigure Google Drive authentication?',
          default: false
        }
      ]);
      
      if (driveSetup.reconfigureAuth) {
        await setupGoogleDriveAuth();
      }
    } else {
      console.log('⚠️  Google Drive authentication needs to be configured');
      console.log(`   Credentials: ${hasCredentials ? 'Found' : 'Missing'}`);
      console.log(`   Token: ${hasToken ? 'Found' : 'Missing'}`);
      
      const driveSetup = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'setupAuth',
          message: 'Set up Google Drive authentication now?',
          default: true
        }
      ]);
      
      if (driveSetup.setupAuth) {
        await setupGoogleDriveAuth();
      }
    }
    
    // Service Installation
    console.log('\n🔧 Service Installation');
    console.log('----------------------');
    
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
    
    // Install service
    if (serviceSetup.installType === 'service') {
      console.log('\n🚀 Installing system service...');
      await installService();
    } else if (serviceSetup.installType === 'docker') {
      console.log('\n🐳 Docker setup instructions:');
      await showDockerInstructions();
    }
    
    // Final summary
    console.log('\n✅ Setup completed successfully!');
    console.log('\n🎯 What to do next:');
    if (serviceSetup.installType === 'service') {
      console.log('   🚀 Your backups will run automatically on schedule!');
      console.log('   📊 Monitor service: node status.js');
      console.log('   📋 View logs: check logs/tally-backup.log');
      console.log('   🔧 Service control: Use Windows Services Manager');
      console.log('   ⚙️  Service name: "TallyBackupPro"');
    } else if (serviceSetup.installType === 'manual') {
      console.log('   🔄 Run backup: npm run backup');
      console.log('   📊 Check status: npm run status');
      console.log('   📋 View logs: check logs/tally-backup.log');
      console.log('   🔧 Manual restore: npm run restore');
    }
    
    console.log('   🧪 Test restore: npm run restore --dry-run');
    console.log('   ❓ Get help: npm run --help');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

async function setupGoogleDriveAuth() {
  const credentialsPath = path.join(process.cwd(), 'config', 'credentials.json');
  const tokenPath = path.join(process.cwd(), 'config', 'token.json');
  
  // Check if credentials file exists
  if (await fs.pathExists(credentialsPath)) {
    console.log('\n🔐 Setting up Google Drive authentication...');
    try {
      // Check if auth script exists
      const authScriptPath = path.join(process.cwd(), 'setup-auth-enhanced.js');
      if (!await fs.pathExists(authScriptPath)) {
        console.log('⚠️  Auth script not found. Please run setup-auth manually.');
        console.log('   npm run setup-auth');
      } else {
        // Remove existing token if reconfiguring
        if (await fs.pathExists(tokenPath)) {
          console.log('🔄 Removing existing token for fresh authentication...');
          await fs.remove(tokenPath);
        }
        
        execSync('node setup-auth-enhanced.js', { 
          stdio: 'inherit',
          cwd: process.cwd(),
          env: process.env
        });
      }
    } catch (error) {
      console.log('⚠️  Authentication setup failed. You can run it manually later:');
      console.log('   npm run setup-auth');
    }
  } else {
    console.log('\n📖 To set up Google Drive authentication:');
    console.log('1. Go to: https://console.cloud.google.com/');
    console.log('2. Create a new project or select existing one');
    console.log('3. Enable Google Drive API');
    console.log('4. Create credentials (OAuth 2.0 Client ID)');
    console.log('5. Download the JSON file as config/credentials.json');
    console.log('6. Run: npm run setup-auth');
    console.log('\nFor detailed instructions, see: SETUP.md');
  }
}

main().catch(console.error);
