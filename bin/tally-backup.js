#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const fs = require('fs-extra');
const pkg = require('../package.json');
const configPathManager = require('../src/utils/ConfigPathManager');

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

program
  .command('schedule')
  .description('Schedule automated backups')
  .option('-t, --time <time>', 'Set backup time (24-hour format, e.g., 21:00)', '21:00')
  .action(async (options) => {
    const cron = require('node-cron');
    const fs = require('fs-extra');
    
    console.log('⏰ Setting up scheduled backup...');
    console.log(`📅 Backup will run daily at ${options.time}`);
    
    // Parse time
    const [hours, minutes] = options.time.split(':').map(Number);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      console.log('❌ Invalid time format. Please use HH:MM (24-hour format)');
      return;
    }
    
    const cronExpression = `${minutes} ${hours} * * *`;
    
    // Create a scheduler script
    const schedulerScript = `
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Tally Backup Scheduler started');
console.log('⏰ Backup scheduled for ${options.time} daily');

cron.schedule('${cronExpression}', () => {
  console.log('\\n🔄 Starting scheduled backup...');
  
  const backupProcess = spawn('npx', ['tally-backup', 'backup'], {
    stdio: 'inherit',
    shell: true
  });
  
  backupProcess.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Scheduled backup completed successfully');
    } else {
      console.log('❌ Scheduled backup failed');
    }
  });
});

// Keep the scheduler running
process.on('SIGINT', () => {
  console.log('\\n🛑 Tally Backup Scheduler stopped');
  process.exit(0);
});
`;
    
    const schedulerPath = path.join(process.cwd(), 'scheduler.js');
    await fs.writeFile(schedulerPath, schedulerScript);
    
    console.log('✅ Scheduler created successfully');
    console.log('📁 Scheduler file:', schedulerPath);
    console.log('');
    console.log('🎯 To start the scheduler:');
    console.log('   node scheduler.js');
    console.log('');
    console.log('💡 To run scheduler in background:');
    console.log('   node scheduler.js &');
  });

program
  .command('test-email')
  .description('Test email notification settings')
  .action(async () => {
    try {
      const config = await configPathManager.loadConfig();
      
      if (!config.email || !config.email.enabled) {
        console.log('❌ Email notifications are not configured');
        console.log('💡 Run setup-wizard to configure email settings');
        return;
      }
      
      const EmailService = require('../src/EmailService');
      const emailService = new EmailService(config.email);
      
      console.log('📧 Testing email configuration...');
      
      await emailService.sendTestEmail();
      
      console.log('✅ Test email sent successfully');
      console.log('📮 Check your inbox for the test email');
      
    } catch (error) {
      console.log('❌ Email test failed:', error.message);
      console.log('💡 Please check your email configuration in config.json');
    }
  });

async function createProjectStructure(config) {
  // Create directories using ConfigPathManager
  await configPathManager.ensureDirectories();

  // Check if config files already exist
  const configExists = await fs.pathExists(configPathManager.getConfigPath());
  const credentialsExists = await fs.pathExists(configPathManager.getCredentialsPath());
  const tokenExists = await fs.pathExists(configPathManager.getTokenPath());

  if (configExists && credentialsExists && tokenExists) {
    console.log('📁 Project structure already exists');
    console.log('⚙️  Configuration files found - skipping creation');
    console.log('🔑 Google Drive credentials already configured');
    return;
  }

  // Create config file only if it doesn't exist
  if (!configExists) {
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
        credentialsPath: configPathManager.getCredentialsPath(),
        tokenPath: configPathManager.getTokenPath(),
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

    await fs.writeJson(configPathManager.getConfigPath(), configData, { spaces: 2 });
    console.log(`⚙️  Configuration saved to ${configPathManager.getConfigPath()}`);
  } else {
    console.log('⚙️  Configuration file already exists - skipping');
  }

  // Create credentials example only if credentials.json doesn't exist
  if (!credentialsExists) {
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
    console.log('� Please add your Google credentials to config/credentials.json');
  } else {
    console.log('🔑 Google Drive credentials already configured');
  }

  console.log('📁 Project structure created');
}

program.parse();

// If no command was provided (e.g., double-clicked), show interactive menu
if (process.argv.length === 2) {
  showInteractiveMenu();
}

async function showInteractiveMenu() {
  console.log('\n' + '='.repeat(60));
  console.log('    🚀 Tally Backup Pro - Interactive Menu');
  console.log('='.repeat(60));
  console.log('\nWelcome! Choose an option:');
  console.log('\n1. 🔧 Setup Wizard (First time setup)');
  console.log('2. 🔑 Setup Google Drive Authentication');
  console.log('3. 📂 Configure Backup Sources');
  console.log('4. 📧 Setup Email Notifications');
  console.log('5. ▶️  Run Manual Backup Now');
  console.log('6. 📊 Check Backup Status');
  console.log('7. 🔄 Start Backup Scheduler');
  console.log('8. 🛠️  Install as Windows Service');
  console.log('9. ❌ Exit');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question('\nEnter your choice (1-9): ', async (choice) => {
    rl.close();
    
    switch(choice) {
      case '1':
        console.log('\n🔧 Starting Setup Wizard...');
        const setupWizard = require('../setup-wizard.js');
        break;
      case '2':
        console.log('\n🔑 Setting up Google Drive Authentication...');
        const setupAuth = require('../setup-auth-enhanced');
        await setupAuth();
        break;
      case '3':
        console.log('\n📂 Configuring Backup Sources...');
        const setupSources = require('../setup-sources');
        await setupSources();
        break;
      case '4':
        console.log('\n📧 Setting up Email Notifications...');
        const setupEmail = require('../setup-email');
        await setupEmail();
        break;
      case '5':
        console.log('\n▶️  Running Manual Backup...');
        const manualBackup = require('../manual-backup');
        await manualBackup();
        break;
      case '6':
        console.log('\n📊 Checking Backup Status...');
        require('../status');
        break;
      case '7':
        console.log('\n🔄 Starting Backup Scheduler...');
        require('../index');
        break;
      case '8':
        console.log('\n🛠️  Installing as Windows Service...');
        const installService = require('../scripts/install-service');
        await installService();
        break;
      case '9':
        console.log('\n👋 Goodbye!');
        process.exit(0);
        break;
      default:
        console.log('\n❌ Invalid choice. Please try again.');
        setTimeout(() => showInteractiveMenu(), 1000);
    }
  });
}
