#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const fs = require('fs-extra');
const pkg = require('../package.json');

const program = new Command();

program
  .name('tally-backup')
  .description('Professional Tally backup solution with Google Drive sync')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize Tally Backup in current directory')
  .action(async () => {
    console.log('🚀 Initializing Tally Backup Pro...');
    
    const inquirer = await import('inquirer');
    
    const answers = await inquirer.default.prompt([
      {
        type: 'input',
        name: 'tallyPath',
        message: 'Enter path to your Tally data folder:',
        default: process.platform === 'win32' 
          ? 'C:\\Users\\%USERNAME%\\Documents\\Tally' 
          : '/home/$USER/Tally'
      },
      {
        type: 'input',
        name: 'schedule',
        message: 'Enter backup schedule (cron format):',
        default: '0 20 * * *'
      },
      {
        type: 'confirm',
        name: 'installService',
        message: 'Install as system service for automatic startup?',
        default: true
      }
    ]);

    // Create project structure
    await createProjectStructure(answers);
    
    console.log('✅ Tally Backup Pro initialized successfully!');
    console.log('\nNext steps:');
    console.log('1. Run: tally-backup setup-auth');
    console.log('2. Run: tally-backup backup (test backup)');
    if (answers.installService) {
      console.log('3. Run: tally-backup install-service');
    }
  });

program
  .command('setup-wizard')
  .description('Interactive setup wizard for first-time configuration')
  .action(async () => {
    const setupWizard = require('../setup-wizard.js');
    // The setup wizard will handle everything
  });

program
  .command('setup-auth')
  .description('Setup Google Drive authentication')
  .action(async () => {
    const setupAuth = require('../setup-auth-enhanced');
    await setupAuth();
  });

program
  .command('backup')
  .description('Run manual backup')
  .action(async () => {
    const manualBackup = require('../manual-backup');
    await manualBackup();
  });

program
  .command('restore [output-path]')
  .description('Restore backup to specified directory')
  .action(async (outputPath) => {
    const restore = require('../restore');
    const targetPath = outputPath || path.join(process.cwd(), 'restored-tally-data');
    
    const SimpleRestore = require('../restore');
    const restoreService = new SimpleRestore();
    await restoreService.initialize();
    await restoreService.restoreToDirectory(targetPath);
  });

program
  .command('status')
  .description('Show backup status and statistics')
  .action(async () => {
    require('../status');
  });

program
  .command('start')
  .description('Start backup scheduler')
  .action(async () => {
    require('../index');
  });

program
  .command('install-service')
  .description('Install as system service')
  .action(async () => {
    const installService = require('../scripts/install-service');
    await installService();
  });

program
  .command('uninstall-service')
  .description('Uninstall system service')
  .action(async () => {
    const uninstallService = require('../scripts/uninstall-service');
    await uninstallService();
  });

async function createProjectStructure(config) {
  // Create directories
  await fs.ensureDir('config');
  await fs.ensureDir('data');
  await fs.ensureDir('logs');
  await fs.ensureDir('temp');

  // Create config file
  const configData = {
    backup: {
      sourcePath: config.tallyPath.replace('%USERNAME%', process.env.USERNAME || process.env.USER),
      schedule: config.schedule,
      maxRetries: 3,
      retryDelay: 5000,
      compressionLevel: 6,
      chunkSizeMB: 50
    },
    googleDrive: {
      credentialsPath: "./config/credentials.json",
      tokenPath: "./config/token.json",
      backupFolderName: "Tally Backup",
      maxFileSize: 104857600,
      uploadTimeout: 300000
    },
    logging: {
      level: "info",
      maxFiles: 10,
      maxSize: "10MB"
    }
  };

  await fs.writeJson('config/config.json', configData, { spaces: 2 });

  // Create credentials example
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

  await fs.writeJson('config/credentials.example.json', credentialsExample, { spaces: 2 });

  console.log('📁 Project structure created');
  console.log('⚙️  Configuration saved to config/config.json');
  console.log('🔑 Please add your Google credentials to config/credentials.json');
}

program.parse();
