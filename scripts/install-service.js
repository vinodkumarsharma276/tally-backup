const path = require('path');
const fs = require('fs-extra');

async function installWindowsService() {
  try {
    const Service = require('node-windows').Service;
    
    // Create the service object
    const svc = new Service({
      name: 'Tally Backup Pro',
      description: 'Automated Tally backup service with Google Drive sync',
      script: path.join(__dirname, '..', 'index.js'),
      nodeOptions: [
        '--harmony',
        '--max_old_space_size=4096'
      ],
      env: {
        name: "NODE_ENV",
        value: "production"
      }
    });

    // Listen for the "install" event
    svc.on('install', () => {
      console.log('✅ Tally Backup Pro service installed successfully!');
      console.log('🚀 Starting service...');
      svc.start();
    });

    // Listen for the "start" event
    svc.on('start', () => {
      console.log('✅ Tally Backup Pro service started successfully!');
      console.log('📋 Service Details:');
      console.log(`   Name: ${svc.name}`);
      console.log(`   Description: ${svc.description}`);
      console.log(`   Script: ${svc.script}`);
      console.log('\n🔧 Service Management:');
      console.log('   Start: net start "Tally Backup Pro"');
      console.log('   Stop: net stop "Tally Backup Pro"');
      console.log('   Uninstall: tally-backup uninstall-service');
    });

    // Install the service
    console.log('📦 Installing Tally Backup Pro as Windows service...');
    svc.install();

  } catch (error) {
    console.error('❌ Failed to install Windows service:', error.message);
    console.log('\n🔧 Manual Installation Alternative:');
    console.log('1. Use Task Scheduler to run the backup script daily');
    console.log('2. Run: schtasks /create /tn "Tally Backup" /tr "node ' + path.join(__dirname, '..', 'index.js') + '" /sc daily /st 20:00');
  }
}

async function createWindowsTaskScheduler() {
  try {
    const scriptPath = path.join(__dirname, '..', 'index.js');
    const taskName = 'Tally Backup Pro';
    
    console.log('📋 Creating Windows Task Scheduler entry...');
    
    const { exec } = require('child_process');
    const command = `schtasks /create /tn "${taskName}" /tr "node \\"${scriptPath}\\"" /sc daily /st 20:00 /f`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Failed to create scheduled task:', error.message);
        return;
      }
      
      console.log('✅ Windows Task Scheduler entry created successfully!');
      console.log('📋 Task Details:');
      console.log(`   Name: ${taskName}`);
      console.log(`   Schedule: Daily at 8:00 PM`);
      console.log(`   Script: ${scriptPath}`);
      console.log('\n🔧 Task Management:');
      console.log(`   View: schtasks /query /tn "${taskName}"`);
      console.log(`   Run: schtasks /run /tn "${taskName}"`);
      console.log(`   Delete: schtasks /delete /tn "${taskName}" /f`);
    });
    
  } catch (error) {
    console.error('❌ Failed to create scheduled task:', error.message);
  }
}

async function installService() {
  console.log('🚀 Installing Tally Backup Pro Service for Windows...\n');
  
  if (process.platform !== 'win32') {
    console.log('❌ This installer is for Windows only.');
    console.log('💡 For Linux, use: systemctl or cron');
    return;
  }

  // Check if running as administrator
  const { exec } = require('child_process');
  exec('net session', (error) => {
    if (error) {
      console.log('⚠️  Administrator privileges required for service installation.');
      console.log('🔄 Falling back to Task Scheduler...\n');
      createWindowsTaskScheduler();
    } else {
      installWindowsService();
    }
  });
}

if (require.main === module) {
  installService();
}

module.exports = installService;
