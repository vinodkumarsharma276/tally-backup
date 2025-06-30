#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Service Uninstaller Script
 * Removes Tally Backup Pro service from Windows or Linux
 */

async function uninstallWindowsService() {
  try {
    console.log('🪟 Uninstalling Tally Backup Pro Windows Service...');
    
    // Check if running as administrator
    try {
      execSync('net session >nul 2>&1', { stdio: 'pipe' });
    } catch (error) {
      console.error('❌ This script must be run as Administrator');
      process.exit(1);
    }

    const SERVICE_NAME = 'TallyBackupPro';
    
    // Check if service exists
    try {
      const services = execSync('sc query type=service state=all', { encoding: 'utf8' });
      if (!services.includes(SERVICE_NAME)) {
        console.log('ℹ️  Service not found. Nothing to uninstall.');
        return;
      }
    } catch (error) {
      console.log('ℹ️  Cannot query services. Service may not exist.');
      return;
    }

    // Try to use node-windows first
    try {
      const Service = require('node-windows').Service;
      const svc = new Service({
        name: SERVICE_NAME,
        script: path.join(process.cwd(), 'index.js')
      });

      svc.on('uninstall', () => {
        console.log('✅ Service uninstalled successfully!');
      });

      svc.on('error', (error) => {
        console.log('⚠️  Node-windows uninstall failed, trying manual method...');
        manualWindowsUninstall(SERVICE_NAME);
      });

      console.log('🗑️  Stopping and uninstalling service...');
      svc.uninstall();
      
    } catch (error) {
      console.log('⚠️  node-windows not available, using manual method...');
      manualWindowsUninstall(SERVICE_NAME);
    }

  } catch (error) {
    console.error('❌ Windows service uninstall failed:', error.message);
    process.exit(1);
  }
}

function manualWindowsUninstall(serviceName) {
  try {
    // Stop the service
    console.log('🛑 Stopping service...');
    try {
      execSync(`sc stop ${serviceName}`, { stdio: 'pipe' });
      // Wait for service to stop
      setTimeout(() => {}, 3000);
    } catch (error) {
      console.log('ℹ️  Service was not running');
    }

    // Delete the service
    console.log('🗑️  Deleting service...');
    execSync(`sc delete ${serviceName}`, { stdio: 'inherit' });
    
    console.log('✅ Service uninstalled successfully!');
  } catch (error) {
    console.error('❌ Manual uninstall failed:', error.message);
    console.log('\nTry running these commands manually:');
    console.log(`   sc stop ${serviceName}`);
    console.log(`   sc delete ${serviceName}`);
  }
}

async function uninstallLinuxService() {
  try {
    console.log('🐧 Uninstalling Tally Backup Pro Linux Service...');
    
    // Check if running as root
    if (process.getuid && process.getuid() !== 0) {
      console.error('❌ This script must be run with sudo privileges');
      console.log('Please run: sudo node scripts/uninstall-service-pro.js');
      process.exit(1);
    }

    const SERVICE_NAME = 'tally-backup-pro';
    const servicePath = `/etc/systemd/system/${SERVICE_NAME}.service`;
    
    // Check if service file exists
    if (!await fs.pathExists(servicePath)) {
      console.log('ℹ️  Service not found. Nothing to uninstall.');
      return;
    }

    // Stop the service
    console.log('🛑 Stopping service...');
    try {
      execSync(`systemctl stop ${SERVICE_NAME}`, { stdio: 'pipe' });
    } catch (error) {
      console.log('ℹ️  Service was not running');
    }

    // Disable the service
    console.log('🚫 Disabling service...');
    try {
      execSync(`systemctl disable ${SERVICE_NAME}`, { stdio: 'pipe' });
    } catch (error) {
      console.log('ℹ️  Service was not enabled');
    }

    // Remove service file
    console.log('🗑️  Removing service file...');
    await fs.remove(servicePath);

    // Reload systemd
    console.log('🔄 Reloading systemd daemon...');
    execSync('systemctl daemon-reload', { stdio: 'inherit' });

    console.log('✅ Service uninstalled successfully!');
    
  } catch (error) {
    console.error('❌ Linux service uninstall failed:', error.message);
    console.log('\nTry running these commands manually:');
    console.log(`   sudo systemctl stop ${SERVICE_NAME}`);
    console.log(`   sudo systemctl disable ${SERVICE_NAME}`);
    console.log(`   sudo rm /etc/systemd/system/${SERVICE_NAME}.service`);
    console.log('   sudo systemctl daemon-reload');
    process.exit(1);
  }
}

async function main() {
  try {
    if (process.platform === 'win32') {
      await uninstallWindowsService();
    } else if (process.platform === 'linux') {
      await uninstallLinuxService();
    } else {
      console.error('❌ Unsupported platform:', process.platform);
      process.exit(1);
    }

    console.log('\n💡 Service has been uninstalled.');
    console.log('You can still run backups manually using:');
    console.log('   node manual-backup.js');
    console.log('   or');
    console.log('   tally-backup backup');
    
  } catch (error) {
    console.error('❌ Uninstall failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
