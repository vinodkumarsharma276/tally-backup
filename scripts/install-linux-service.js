const path = require('path');
const fs = require('fs-extra');
const os = require('os');

async function installLinuxService() {
  try {
    const Service = require('node-linux').Service;
    
    // Create the service object
    const svc = new Service({
      name: 'tally-backup-pro',
      description: 'Automated Tally backup service with Google Drive sync',
      script: path.join(__dirname, '..', 'index.js'),
      user: process.env.USER || 'root',
      group: process.env.USER || 'root'
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
      console.log(`   User: ${svc.user}`);
      console.log('\n🔧 Service Management:');
      console.log('   Status: sudo systemctl status tally-backup-pro');
      console.log('   Start: sudo systemctl start tally-backup-pro');
      console.log('   Stop: sudo systemctl stop tally-backup-pro');
      console.log('   Logs: sudo journalctl -u tally-backup-pro -f');
      console.log('   Uninstall: tally-backup uninstall-service');
    });

    // Install the service
    console.log('📦 Installing Tally Backup Pro as Linux service...');
    svc.install();

  } catch (error) {
    console.error('❌ Failed to install Linux service:', error.message);
    console.log('\n🔧 Manual Installation Alternative:');
    await createLinuxCronJob();
  }
}

async function createLinuxCronJob() {
  try {
    const scriptPath = path.join(__dirname, '..', 'index.js');
    const cronJob = `0 20 * * * /usr/bin/node "${scriptPath}" >> /var/log/tally-backup.log 2>&1`;
    
    console.log('📋 Creating cron job...');
    
    const { exec } = require('child_process');
    
    // Get current crontab
    exec('crontab -l', (error, stdout, stderr) => {
      let currentCrontab = '';
      if (!error) {
        currentCrontab = stdout;
      }
      
      // Check if job already exists
      if (currentCrontab.includes('tally-backup') || currentCrontab.includes(scriptPath)) {
        console.log('⚠️  Cron job already exists');
        return;
      }
      
      // Add new cron job
      const newCrontab = currentCrontab + '\n' + cronJob + '\n';
      
      // Write new crontab
      const { spawn } = require('child_process');
      const crontab = spawn('crontab', ['-']);
      
      crontab.stdin.write(newCrontab);
      crontab.stdin.end();
      
      crontab.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Cron job created successfully!');
          console.log('📋 Job Details:');
          console.log(`   Schedule: Daily at 8:00 PM`);
          console.log(`   Script: ${scriptPath}`);
          console.log(`   Logs: /var/log/tally-backup.log`);
          console.log('\n🔧 Cron Management:');
          console.log('   List: crontab -l');
          console.log('   Edit: crontab -e');
          console.log('   Remove: crontab -e (delete the tally-backup line)');
        } else {
          console.error('❌ Failed to create cron job');
        }
      });
    });
    
  } catch (error) {
    console.error('❌ Failed to create cron job:', error.message);
  }
}

async function createSystemdService() {
  try {
    const scriptPath = path.join(__dirname, '..', 'index.js');
    const serviceName = 'tally-backup-pro';
    
    const serviceContent = `[Unit]
Description=Tally Backup Pro - Automated backup service
After=network.target

[Service]
Type=simple
User=${process.env.USER || 'root'}
ExecStart=/usr/bin/node "${scriptPath}"
Restart=always
RestartSec=10
Environment=NODE_ENV=production
WorkingDirectory=${path.dirname(scriptPath)}

[Install]
WantedBy=multi-user.target`;

    const servicePath = `/etc/systemd/system/${serviceName}.service`;
    
    console.log('📋 Creating systemd service...');
    
    // Write service file
    await fs.writeFile(servicePath, serviceContent);
    
    const { exec } = require('child_process');
    
    // Reload systemd and enable service
    exec('systemctl daemon-reload && systemctl enable tally-backup-pro', (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Failed to enable service:', error.message);
        console.log('💡 You may need to run with sudo privileges');
        return;
      }
      
      console.log('✅ Systemd service created and enabled!');
      console.log('📋 Service Details:');
      console.log(`   Name: ${serviceName}`);
      console.log(`   File: ${servicePath}`);
      console.log(`   Script: ${scriptPath}`);
      console.log('\n🔧 Service Management:');
      console.log(`   Start: sudo systemctl start ${serviceName}`);
      console.log(`   Stop: sudo systemctl stop ${serviceName}`);
      console.log(`   Status: sudo systemctl status ${serviceName}`);
      console.log(`   Logs: sudo journalctl -u ${serviceName} -f`);
    });
    
  } catch (error) {
    console.error('❌ Failed to create systemd service:', error.message);
    console.log('🔄 Falling back to cron job...');
    await createLinuxCronJob();
  }
}

async function installService() {
  console.log('🚀 Installing Tally Backup Pro Service for Linux...\n');
  
  if (process.platform === 'win32') {
    console.log('❌ This installer is for Linux only.');
    console.log('💡 For Windows, use: tally-backup install-service');
    return;
  }

  // Check if running as root/sudo for systemd
  if (process.getuid && process.getuid() === 0) {
    console.log('🔧 Installing as systemd service...');
    await createSystemdService();
  } else {
    console.log('⚠️  Root privileges not available.');
    console.log('🔄 Installing as cron job for current user...');
    await createLinuxCronJob();
  }
}

if (require.main === module) {
  installService();
}

module.exports = installService;
