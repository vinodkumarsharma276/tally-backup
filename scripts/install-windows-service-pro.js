#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Windows Service Installation Script
 * Creates Windows service for Tally Backup Pro with automatic startup
 */

const SERVICE_NAME = 'TallyBackupPro';
const SERVICE_DISPLAY_NAME = 'Tally Backup Pro Service';
const SERVICE_DESCRIPTION = 'Automated backup service for Tally software data to Google Drive';

async function installWindowsService() {
  try {
    console.log('🪟 Installing Tally Backup Pro as Windows Service...');
    
    // Check if running as administrator
    try {
      execSync('net session >nul 2>&1', { stdio: 'pipe' });
    } catch (error) {
      console.error('❌ This script must be run as Administrator');
      console.log('\nTo run as Administrator:');
      console.log('1. Right-click Command Prompt');
      console.log('2. Select "Run as administrator"');
      console.log('3. Navigate to this directory');
      console.log('4. Run this script again');
      process.exit(1);
    }

    // Install node-windows if not present
    try {
      require('node-windows');
    } catch (error) {
      console.log('📦 Installing node-windows...');
      execSync('npm install node-windows', { stdio: 'inherit' });
    }

    const Service = require('node-windows').Service;
    
    // Get current directory and main script path
    const mainScript = path.join(process.cwd(), 'index.js');
    
    if (!await fs.pathExists(mainScript)) {
      console.error('❌ index.js not found in current directory');
      console.log('Please run this script from the Tally Backup Pro directory');
      process.exit(1);
    }

    // Create service object
    const svc = new Service({
      name: SERVICE_NAME,
      description: SERVICE_DESCRIPTION,
      script: mainScript,
      nodeOptions: [
        '--max-old-space-size=4096'
      ],
      env: [
        {
          name: 'NODE_ENV',
          value: 'production'
        },
        {
          name: 'TALLY_BACKUP_SERVICE',
          value: 'true'
        }
      ],
      wait: 2,
      grow: 0.5,
      maxRestarts: 10
    });

    // Event handlers
    svc.on('install', () => {
      console.log('✅ Service installed successfully!');
      console.log('🚀 Starting service...');
      svc.start();
    });

    svc.on('start', () => {
      console.log('✅ Service started successfully!');
      console.log('\n📋 Service Information:');
      console.log(`   Name: ${SERVICE_NAME}`);
      console.log(`   Display Name: ${SERVICE_DISPLAY_NAME}`);
      console.log(`   Status: Running`);
      console.log(`   Startup Type: Automatic`);
      console.log('\n💡 Service Management:');
      console.log('   View logs: Event Viewer > Windows Logs > Application');
      console.log('   Control: Services.msc or Task Manager > Services');
      console.log('   Uninstall: npm run uninstall-service');
    });

    svc.on('error', (error) => {
      console.error('❌ Service installation failed:', error.message);
    });

    // Check if service already exists
    const services = execSync('sc query type=service state=all', { encoding: 'utf8' });
    if (services.includes(SERVICE_NAME)) {
      console.log('⚠️  Service already exists. Stopping and removing...');
      try {
        execSync(`sc stop ${SERVICE_NAME}`, { stdio: 'pipe' });
        await new Promise(resolve => setTimeout(resolve, 2000));
        execSync(`sc delete ${SERVICE_NAME}`, { stdio: 'pipe' });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        // Service might not be running, continue
      }
    }

    // Install the service
    console.log('📦 Installing service...');
    svc.install();

  } catch (error) {
    console.error('❌ Installation failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Ensure you are running as Administrator');
    console.log('2. Check if Node.js is properly installed');
    console.log('3. Verify all files are present in the directory');
    console.log('4. Check Windows Event Viewer for detailed errors');
    process.exit(1);
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('❌ This script is for Windows only');
    console.log('For Linux, use: npm run install-linux-service');
    process.exit(1);
  }

  await installWindowsService();
}

main().catch(console.error);
