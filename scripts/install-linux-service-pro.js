#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

/**
 * Linux Service Installation Script
 * Creates systemd service for Tally Backup Pro with automatic startup
 */

const SERVICE_NAME = 'tally-backup-pro';
const SERVICE_DESCRIPTION = 'Tally Backup Pro - Automated backup service for Tally software data to Google Drive';

async function installLinuxService() {
  try {
    console.log('🐧 Installing Tally Backup Pro as Linux Service...');
    
    // Check if systemd is available
    try {
      execSync('which systemctl', { stdio: 'pipe' });
    } catch (error) {
      console.error('❌ systemd not found. This script requires systemd.');
      console.log('\nFor systems without systemd, you can:');
      console.log('1. Use cron for scheduling: crontab -e');
      console.log('2. Add: 0 20 * * * /path/to/tally-backup backup');
      process.exit(1);
    }

    // Check if running as root or with sudo
    if (process.getuid && process.getuid() !== 0) {
      console.error('❌ This script must be run with sudo privileges');
      console.log('\nPlease run: sudo node scripts/install-linux-service-pro.js');
      process.exit(1);
    }

    // Get current directory and main script path
    const currentDir = process.cwd();
    const mainScript = path.join(currentDir, 'index.js');
    const nodeExec = execSync('which node', { encoding: 'utf8' }).trim();
    
    if (!await fs.pathExists(mainScript)) {
      console.error('❌ index.js not found in current directory');
      console.log('Please run this script from the Tally Backup Pro directory');
      process.exit(1);
    }

    // Determine the user who should run the service
    const serviceUser = process.env.SUDO_USER || 'root';
    const serviceGroup = serviceUser;
    
    // Create systemd service file
    const serviceContent = `[Unit]
Description=${SERVICE_DESCRIPTION}
After=network.target network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=${serviceUser}
Group=${serviceGroup}
WorkingDirectory=${currentDir}
ExecStart=${nodeExec} ${mainScript}
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${currentDir}

# Environment
Environment=NODE_ENV=production
Environment=TALLY_BACKUP_SERVICE=true

# Resource limits
LimitNOFILE=65536
MemoryMax=2G

[Install]
WantedBy=multi-user.target
`;

    const servicePath = `/etc/systemd/system/${SERVICE_NAME}.service`;
    
    console.log('📝 Creating systemd service file...');
    await fs.writeFile(servicePath, serviceContent);
    
    console.log('🔄 Reloading systemd daemon...');
    execSync('systemctl daemon-reload', { stdio: 'inherit' });
    
    console.log('✅ Enabling service for automatic startup...');
    execSync(`systemctl enable ${SERVICE_NAME}`, { stdio: 'inherit' });
    
    console.log('🚀 Starting service...');
    execSync(`systemctl start ${SERVICE_NAME}`, { stdio: 'inherit' });
    
    // Wait a moment and check status
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const status = execSync(`systemctl is-active ${SERVICE_NAME}`, { encoding: 'utf8' }).trim();
      if (status === 'active') {
        console.log('✅ Service installed and started successfully!');
      } else {
        console.log('⚠️  Service installed but not running. Check status with:');
        console.log(`   sudo systemctl status ${SERVICE_NAME}`);
      }
    } catch (error) {
      console.log('⚠️  Service installed but there might be an issue. Check status with:');
      console.log(`   sudo systemctl status ${SERVICE_NAME}`);
    }
    
    console.log('\n📋 Service Information:');
    console.log(`   Name: ${SERVICE_NAME}`);
    console.log(`   Description: ${SERVICE_DESCRIPTION}`);
    console.log(`   User: ${serviceUser}`);
    console.log(`   Working Directory: ${currentDir}`);
    console.log(`   Service File: ${servicePath}`);
    
    console.log('\n💡 Service Management Commands:');
    console.log(`   Status: sudo systemctl status ${SERVICE_NAME}`);
    console.log(`   Start:  sudo systemctl start ${SERVICE_NAME}`);
    console.log(`   Stop:   sudo systemctl stop ${SERVICE_NAME}`);
    console.log(`   Restart: sudo systemctl restart ${SERVICE_NAME}`);
    console.log(`   Logs:   sudo journalctl -u ${SERVICE_NAME} -f`);
    console.log(`   Disable: sudo systemctl disable ${SERVICE_NAME}`);
    console.log(`   Remove: sudo rm ${servicePath} && sudo systemctl daemon-reload`);

  } catch (error) {
    console.error('❌ Installation failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Ensure you are running with sudo privileges');
    console.log('2. Check if systemd is available: which systemctl');
    console.log('3. Verify Node.js is installed: which node');
    console.log('4. Check service logs: sudo journalctl -u tally-backup-pro');
    process.exit(1);
  }
}

async function main() {
  if (process.platform === 'win32') {
    console.error('❌ This script is for Linux only');
    console.log('For Windows, use: npm run install-service');
    process.exit(1);
  }

  await installLinuxService();
}

main().catch(console.error);
