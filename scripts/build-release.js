#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

/**
 * Build Release Script
 * Creates distribution packages for Windows, Linux, and macOS
 */

const VERSION = require('../package.json').version;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const RELEASE_DIR = path.join(__dirname, '..', 'releases');

console.log('🏗️  Building Tally Backup Pro v' + VERSION);
console.log('================================');

async function main() {
  try {
    // Clean and create directories
    await fs.remove(DIST_DIR);
    await fs.remove(RELEASE_DIR);
    await fs.ensureDir(DIST_DIR);
    await fs.ensureDir(RELEASE_DIR);

    // Build executables
    console.log('📦 Building standalone executables...');
    try {
      // Try using npx first, then fall back to local or global pkg
      try {
        execSync('npx pkg . --targets node18-win-x64,node18-linux-x64,node18-macos-x64 --output dist/tally-backup', { stdio: 'inherit' });
      } catch (error) {
        console.log('Trying global pkg...');
        execSync('pkg . --targets node18-win-x64,node18-linux-x64,node18-macos-x64 --output dist/tally-backup', { stdio: 'inherit' });
      }
    } catch (error) {
      console.error('Failed to build executables:', error.message);
      console.log('Installing pkg and trying again...');
      execSync('npm install -g pkg', { stdio: 'inherit' });
      execSync('pkg . --targets node18-win-x64,node18-linux-x64,node18-macos-x64 --output dist/tally-backup', { stdio: 'inherit' });
    }

    // Create release packages
    await createWindowsPackage();
    await createLinuxPackage();
    await createSourcePackage();
    await createDockerPackage();

    console.log('\n✅ Release build completed successfully!');
    console.log(`📁 Release packages created in: ${RELEASE_DIR}`);
    
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

async function createWindowsPackage() {
  console.log('🪟 Creating Windows package...');
  
  const winDir = path.join(RELEASE_DIR, 'windows');
  await fs.ensureDir(winDir);
  
  // Copy executable
  await fs.copy(
    path.join(DIST_DIR, 'tally-backup-win.exe'),
    path.join(winDir, 'tally-backup.exe')
  );
  
  // Copy config templates
  await fs.copy(
    path.join(__dirname, '..', 'config'),
    path.join(winDir, 'config')
  );

  // Copy Windows configuration tool
  await fs.copy(
    path.join(__dirname, 'windows-config-tool.bat'),
    path.join(winDir, 'windows-config-tool.bat')
  );

  // Copy Windows user guide
  await fs.copy(
    path.join(__dirname, '..', 'docs', 'windows-user-guide.md'),
    path.join(winDir, 'WINDOWS-USER-GUIDE.md')
  );
  
  // Create Windows installer script
  const installerScript = `@echo off
echo Installing Tally Backup Pro v${VERSION}
echo ================================

REM Create installation directory
if not exist "%PROGRAMFILES%\\TallyBackupPro" mkdir "%PROGRAMFILES%\\TallyBackupPro"

REM Copy files
copy "tally-backup.exe" "%PROGRAMFILES%\\TallyBackupPro\\"
copy "windows-config-tool.bat" "%PROGRAMFILES%\\TallyBackupPro\\"
xcopy "config" "%PROGRAMFILES%\\TallyBackupPro\\config\\" /E /I

REM Add to PATH
setx PATH "%PATH%;%PROGRAMFILES%\\TallyBackupPro" /M

REM Create desktop shortcut
echo Creating desktop shortcuts...
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\\Desktop\\Tally Backup Pro.lnk'); $Shortcut.TargetPath = '%PROGRAMFILES%\\TallyBackupPro\\tally-backup.exe'; $Shortcut.Arguments = 'status'; $Shortcut.Save()"

powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\\Desktop\\Tally Backup Config.lnk'); $Shortcut.TargetPath = '%PROGRAMFILES%\\TallyBackupPro\\windows-config-tool.bat'; $Shortcut.Save()"

echo.
echo Installation completed successfully!
echo.
echo To configure Tally Backup Pro:
echo   1. Run: "%PROGRAMFILES%\\TallyBackupPro\\windows-config-tool.bat"
echo   2. Or use the desktop shortcut
echo   3. Follow the setup wizard
echo.
pause
`;
  
  await fs.writeFile(path.join(winDir, 'install.bat'), installerScript);
  
  // Create README for Windows
  const windowsReadme = `# Tally Backup Pro - Windows Installation

## Quick Start
1. Run install.bat as Administrator
2. Open Command Prompt
3. Run: tally-backup init
4. Follow the setup wizard

## Manual Installation
1. Copy tally-backup.exe to a folder in your PATH
2. Copy config folder to the same location
3. Run: tally-backup init

## System Requirements
- Windows 10 or later
- Internet connection for Google Drive access
- Sufficient disk space for Tally data backup

For detailed instructions, visit: https://github.com/your-username/tally-backup-pro
`;
  
  await fs.writeFile(path.join(winDir, 'README.txt'), windowsReadme);
  
  // Create ZIP package
  await createZipPackage(winDir, `tally-backup-pro-${VERSION}-windows.zip`);
}

async function createLinuxPackage() {
  console.log('🐧 Creating Linux package...');
  
  const linuxDir = path.join(RELEASE_DIR, 'linux');
  await fs.ensureDir(linuxDir);
  
  // Copy executable
  await fs.copy(
    path.join(DIST_DIR, 'tally-backup-linux'),
    path.join(linuxDir, 'tally-backup')
  );
  
  // Make executable
  await fs.chmod(path.join(linuxDir, 'tally-backup'), 0o755);
  
  // Copy config templates
  await fs.copy(
    path.join(__dirname, '..', 'config'),
    path.join(linuxDir, 'config')
  );
  
  // Create Linux installer script
  const installerScript = `#!/bin/bash
echo "Installing Tally Backup Pro v${VERSION}"
echo "================================"

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "Installing globally..."
   INSTALL_DIR="/usr/local/bin"
   CONFIG_DIR="/etc/tally-backup"
else
   echo "Installing for current user..."
   INSTALL_DIR="$HOME/.local/bin"
   CONFIG_DIR="$HOME/.config/tally-backup"
   mkdir -p "$INSTALL_DIR"
fi

# Copy executable
cp tally-backup "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/tally-backup"

# Copy config templates
mkdir -p "$CONFIG_DIR"
cp -r config/* "$CONFIG_DIR/"

# Add to PATH if not already there
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> ~/.bashrc
    echo "Added $INSTALL_DIR to PATH in ~/.bashrc"
fi

echo ""
echo "Installation completed successfully!"
echo "Restart your terminal or run: source ~/.bashrc"
echo "Then run: tally-backup init"
`;
  
  await fs.writeFile(path.join(linuxDir, 'install.sh'), installerScript);
  await fs.chmod(path.join(linuxDir, 'install.sh'), 0o755);
  
  // Create README for Linux
  const linuxReadme = `# Tally Backup Pro - Linux Installation

## Quick Start
1. Run: chmod +x install.sh
2. Run: ./install.sh
3. Restart terminal or run: source ~/.bashrc
4. Run: tally-backup init

## Manual Installation
1. Copy tally-backup to /usr/local/bin (system-wide) or ~/.local/bin (user)
2. Make executable: chmod +x tally-backup
3. Copy config folder to ~/.config/tally-backup/
4. Add to PATH if needed

## System Requirements
- Linux distribution with glibc 2.17+
- Internet connection for Google Drive access
- Sufficient disk space for Tally data backup

For detailed instructions, visit: https://github.com/your-username/tally-backup-pro
`;
  
  await fs.writeFile(path.join(linuxDir, 'README.txt'), linuxReadme);
  
  // Create TAR.GZ package
  await createTarPackage(linuxDir, `tally-backup-pro-${VERSION}-linux.tar.gz`);
}

async function createSourcePackage() {
  console.log('📄 Creating source package...');
  
  const sourceDir = path.join(RELEASE_DIR, 'source');
  await fs.ensureDir(sourceDir);
  
  // Copy source files (excluding node_modules, dist, logs, etc.)
  const filesToCopy = [
    'src',
    'config',
    'bin',
    'scripts',
    'package.json',
    'README.md',
    'DISTRIBUTION.md',
    'SETUP.md',
    'BUILD.md',
    'index.js',
    'manual-backup.js',
    'restore.js',
    'status.js',
    'setup-auth.js',
    'setup-auth-enhanced.js',
    'setup-wizard.js',
    'setup-email.js',
    'setup-sources.js',
    'test-email.js',
    'Dockerfile',
    'docker-compose.yml'
  ];
  
  for (const file of filesToCopy) {
    const srcPath = path.join(__dirname, '..', file);
    const destPath = path.join(sourceDir, file);
    
    if (await fs.pathExists(srcPath)) {
      await fs.copy(srcPath, destPath);
    }
  }
  
  // Create source README
  const sourceReadme = `# Tally Backup Pro - Source Installation

## Requirements
- Node.js 14.0.0 or later
- npm or yarn package manager

## Installation
1. Extract this package
2. Run: npm install
3. Run: npm run setup-auth
4. Configure config/config.json
5. Run: npm start

## Development
- Run: npm run backup (manual backup)
- Run: npm run restore (restore from backup)
- Run: npm run status (check backup status)

## Building Executables
- Run: npm run build

For detailed instructions, visit: https://github.com/your-username/tally-backup-pro
`;
  
  await fs.writeFile(path.join(sourceDir, 'README.txt'), sourceReadme);
  
  // Create ZIP package
  await createZipPackage(sourceDir, `tally-backup-pro-${VERSION}-source.zip`);
}

async function createDockerPackage() {
  console.log('🐳 Creating Docker package...');
  
  const dockerDir = path.join(RELEASE_DIR, 'docker');
  await fs.ensureDir(dockerDir);
  
  // Copy Docker files
  await fs.copy(
    path.join(__dirname, '..', 'Dockerfile'),
    path.join(dockerDir, 'Dockerfile')
  );
  
  await fs.copy(
    path.join(__dirname, '..', 'docker-compose.yml'),
    path.join(dockerDir, 'docker-compose.yml')
  );
  
  // Copy necessary source files
  const filesToCopy = [
    'src',
    'config',
    'package.json',
    'index.js',
    'manual-backup.js',
    'restore.js',
    'status.js',
    'setup-wizard.js',
    'setup-email.js',
    'setup-sources.js'
  ];
  
  for (const file of filesToCopy) {
    const srcPath = path.join(__dirname, '..', file);
    const destPath = path.join(dockerDir, file);
    
    if (await fs.pathExists(srcPath)) {
      await fs.copy(srcPath, destPath);
    }
  }
  
  // Create Docker README
  const dockerReadme = `# Tally Backup Pro - Docker Deployment

## Quick Start with Docker Compose
1. Update docker-compose.yml with your Tally data path
2. Run: docker-compose up -d
3. Setup authentication: docker-compose exec tally-backup npm run setup-auth
4. Check logs: docker-compose logs -f

## Manual Docker Build
1. Build image: docker build -t tally-backup-pro .
2. Run container: docker run -d -v /path/to/tally:/app/tally-data tally-backup-pro

## Configuration
- Mount your Tally data directory to /app/tally-data
- Mount config directory for persistent configuration
- Expose port 3000 for web interface (if enabled)

For detailed instructions, visit: https://github.com/your-username/tally-backup-pro
`;
  
  await fs.writeFile(path.join(dockerDir, 'README.txt'), dockerReadme);
  
  // Create ZIP package
  await createZipPackage(dockerDir, `tally-backup-pro-${VERSION}-docker.zip`);
}

async function createZipPackage(sourceDir, filename) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(path.join(RELEASE_DIR, filename));
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`  ✅ ${filename} (${(archive.pointer() / 1024 / 1024).toFixed(2)} MB)`);
      resolve();
    });
    
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function createTarPackage(sourceDir, filename) {
  const tarPath = path.join(RELEASE_DIR, filename);
  execSync(`tar -czf "${tarPath}" -C "${sourceDir}" .`, { stdio: 'inherit' });
  const stats = await fs.stat(tarPath);
  console.log(`  ✅ ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(console.error);
