const path = require('path');

async function uninstallWindowsService() {
  try {
    const Service = require('node-windows').Service;
    
    const svc = new Service({
      name: 'Tally Backup Pro',
      script: path.join(__dirname, '..', 'index.js')
    });

    svc.on('uninstall', () => {
      console.log('✅ Tally Backup Pro service uninstalled successfully!');
    });

    console.log('🗑️  Uninstalling Tally Backup Pro service...');
    svc.uninstall();

  } catch (error) {
    console.error('❌ Failed to uninstall Windows service:', error.message);
    
    // Try to remove scheduled task
    const { exec } = require('child_process');
    exec('schtasks /delete /tn "Tally Backup Pro" /f', (error, stdout, stderr) => {
      if (!error) {
        console.log('✅ Scheduled task removed successfully!');
      }
    });
  }
}

async function uninstallLinuxService() {
  try {
    const Service = require('node-linux').Service;
    
    const svc = new Service({
      name: 'tally-backup-pro',
      script: path.join(__dirname, '..', 'index.js')
    });

    svc.on('uninstall', () => {
      console.log('✅ Tally Backup Pro service uninstalled successfully!');
    });

    console.log('🗑️  Uninstalling Tally Backup Pro service...');
    svc.uninstall();

  } catch (error) {
    console.error('❌ Failed to uninstall Linux service:', error.message);
    
    // Try to remove from cron
    const { exec } = require('child_process');
    exec('crontab -l | grep -v "tally-backup" | crontab -', (error, stdout, stderr) => {
      if (!error) {
        console.log('✅ Cron job removed successfully!');
      }
    });
  }
}

async function uninstallService() {
  console.log('🗑️  Uninstalling Tally Backup Pro Service...\n');
  
  if (process.platform === 'win32') {
    await uninstallWindowsService();
  } else {
    await uninstallLinuxService();
  }
}

if (require.main === module) {
  uninstallService();
}

module.exports = uninstallService;
