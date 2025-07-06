#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

/**
 * Build Release Script
 * Creates distribution packages for Windows, Linux, and macOS
 * 
 * Usage:
 *   node build-release.js [environment] [options]
 *
 * Environments:
 *   windows     - Build Windows package only
 *   linux       - Build Linux package only
 *   source      - Build source package only
 *   docker      - Build Docker package only
 *   npm         - Build NPM package only
 *   obfuscated  - Build obfuscated NPM package
 *   all         - Build all packages (default)
 * 
 * Options:
 *   --obfuscate - Obfuscate source code for security
 *   --no-npm    - Skip NPM package creation
 */

const VERSION = require('../package.json').version;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const RELEASE_DIR = path.join(__dirname, '..', 'releases');
const OBFUSCATED_DIR = path.join(DIST_DIR, 'obfuscated');

// Parse command line arguments
const args = process.argv.slice(2);
const targetEnvironment = args[0] || 'all';
const shouldObfuscate = args.includes('--obfuscate') || targetEnvironment === 'obfuscated';
const skipNpm = args.includes('--no-npm');

const validEnvironments = ['windows', 'linux', 'source', 'docker', 'npm', 'obfuscated', 'all'];

// Show help if requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🏗️  Tally Backup Pro - Build Release Script

Usage: node build-release.js [environment] [options]

Environments:
  windows     - Build Windows package only
  linux       - Build Linux package only  
  source      - Build source package only
  docker      - Build Docker package only
  npm         - Build NPM package only
  obfuscated  - Build obfuscated NPM package
  all         - Build all packages (default)

Options:
  --obfuscate  - Obfuscate source code for security
  --no-npm     - Skip NPM package creation
  -h, --help   - Show this help message

Examples:
  node build-release.js npm
  node build-release.js obfuscated
  node build-release.js windows --obfuscate
  npm run build-release
`);
  process.exit(0);
}

if (!validEnvironments.includes(targetEnvironment)) {
  console.error(`❌ Invalid environment: ${targetEnvironment}`);
  console.log('Valid environments: ' + validEnvironments.join(', '));
  console.log('Use --help for more information');
  process.exit(1);
}

console.log('🏗️  Building Tally Backup Pro v' + VERSION);
console.log('Target: ' + targetEnvironment);
if (shouldObfuscate) console.log('🔒 Obfuscation: ENABLED');
console.log('================================');

async function main() {
  try {
    // Clean and create directories
    await fs.remove(DIST_DIR);
    await fs.remove(RELEASE_DIR);
    await fs.ensureDir(DIST_DIR);
    await fs.ensureDir(RELEASE_DIR);

    // Build and package for Node.js distribution
    console.log('📦 Packaging Node.js application...');
    
    // Create NPM package
    if ((targetEnvironment === 'all' || targetEnvironment === 'source' || targetEnvironment === 'npm') && !skipNpm) {
      await createNpmPackage();
    }

    // Create obfuscated package
    if (targetEnvironment === 'obfuscated' || shouldObfuscate) {
      await createObfuscatedPackage();
    }

    // Create release packages based on target environment
    switch (targetEnvironment) {
      case 'windows':
        await createWindowsPackage();
        break;
      case 'linux':
        await createLinuxPackage();
        break;
      case 'source':
        await createSourcePackage();
        break;
      case 'docker':
        await createDockerPackage();
        break;
      case 'npm':
        // Already handled above
        break;
      case 'obfuscated':
        // Already handled above
        break;
      case 'all':
      default:
        await createWindowsPackage();
        await createLinuxPackage();
        await createSourcePackage();
        await createDockerPackage();
        break;
    }

    console.log('\n✅ Release build completed successfully!');
    console.log(`📁 Release packages created in: ${RELEASE_DIR}`);
    
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

async function createNpmPackage() {
  console.log('📦 Creating NPM package...');
  
  try {
    // Create NPM package
    const result = execSync('npm pack', { encoding: 'utf8' });
    const packageFile = result.trim();
    
    // Move to releases directory
    const srcPath = path.join(__dirname, '..', packageFile);
    const destPath = path.join(RELEASE_DIR, packageFile);
    
    if (await fs.pathExists(srcPath)) {
      await fs.move(srcPath, destPath);
      console.log(`  ✅ NPM package created: ${packageFile}`);
      
      // Create installation guide
      await createInstallationGuide(packageFile);
    } else {
      console.error('  ❌ NPM package file not found');
    }
    
  } catch (error) {
    console.error('Failed to create NPM package:', error.message);
    throw error;
  }
}

async function createObfuscatedPackage() {
  console.log('🔒 Creating obfuscated package...');
  
  try {
    // Check if obfuscator is available
    try {
      execSync('npx javascript-obfuscator --version', { stdio: 'ignore' });
    } catch (error) {
      console.log('  📥 Installing javascript-obfuscator...');
      execSync('npm install javascript-obfuscator --save-dev', { stdio: 'inherit' });
    }
    
    // Create obfuscated directory
    await fs.ensureDir(OBFUSCATED_DIR);
    
    // Copy specific files and directories (not the entire project)
    const projectRoot = path.join(__dirname, '..');
    const itemsToCopy = [
      'src',
      'config',
      'scripts',
      'bin',
      'docs',
      'data',
      'index.js',
      'manual-backup.js',
      'restore.js',
      'status.js',
      'setup-wizard.js',
      'setup-auth.js',
      'setup-auth-enhanced.js',
      'setup-email.js',
      'setup-sources.js',
      'test-email.js',
      'test-gdrive.js',
      'test-gdrive-contents.js',
      'test-missing-folder.js',
      'force-clean-backup.js',
      'package.json',
      'README.md',
      'SETUP.md',
      'docker-compose.yml',
      'Dockerfile'
    ];
    
    for (const item of itemsToCopy) {
      const srcPath = path.join(projectRoot, item);
      const destPath = path.join(OBFUSCATED_DIR, item);
      
      if (await fs.pathExists(srcPath)) {
        await fs.copy(srcPath, destPath);
        console.log(`  ✓ Copied ${item}`);
      }
    }
    
    // Obfuscate JavaScript files
    const jsFiles = [
      'index.js',
      'manual-backup.js',
      'restore.js',
      'status.js',
      'setup-wizard.js',
      'setup-auth.js',
      'setup-auth-enhanced.js',
      'setup-email.js',
      'setup-sources.js',
      'test-email.js',
      'test-gdrive.js',
      'test-gdrive-contents.js',
      'test-missing-folder.js',
      'force-clean-backup.js',
      'bin/tally-backup.js'
    ];
    
    // Obfuscate src directory files
    const srcFiles = await getAllJsFiles(path.join(OBFUSCATED_DIR, 'src'));
    const scriptFiles = await getAllJsFiles(path.join(OBFUSCATED_DIR, 'scripts'));
    
    const allFiles = [...jsFiles.map(f => path.join(OBFUSCATED_DIR, f)), ...srcFiles, ...scriptFiles];
    
    for (const file of allFiles) {
      if (await fs.pathExists(file)) {
        console.log(`  🔒 Obfuscating ${path.relative(OBFUSCATED_DIR, file)}`);
        try {
          const obfuscateCmd = `npx javascript-obfuscator "${file}" --output "${file}" --compact true --control-flow-flattening true --dead-code-injection true --string-array true --string-array-shuffle true --string-array-threshold 0.8 --transform-object-keys true --unicode-escape-sequence true`;
          execSync(obfuscateCmd, { stdio: 'pipe' });
        } catch (error) {
          console.warn(`  ⚠️  Could not obfuscate ${file}: ${error.message}`);
        }
      }
    }
    
    // Create NPM package from obfuscated code
    const originalDir = process.cwd();
    process.chdir(OBFUSCATED_DIR);
    
    try {
      const result = execSync('npm pack', { encoding: 'utf8' });
      const packageFile = result.trim();
      
      // Move to releases directory with obfuscated prefix
      const obfuscatedName = packageFile.replace('.tgz', '-obfuscated.tgz');
      const destPath = path.join(RELEASE_DIR, obfuscatedName);
      
      await fs.move(path.join(OBFUSCATED_DIR, packageFile), destPath);
      console.log(`  ✅ Obfuscated package created: ${obfuscatedName}`);
      
      // Create installation guide for obfuscated package
      await createInstallationGuide(obfuscatedName, true);
      
    } finally {
      process.chdir(originalDir);
    }
    
  } catch (error) {
    console.error('Failed to create obfuscated package:', error.message);
    throw error;
  }
}

async function getAllJsFiles(dir) {
  const files = [];
  
  if (!(await fs.pathExists(dir))) {
    return files;
  }
  
  const items = await fs.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      const subFiles = await getAllJsFiles(fullPath);
      files.push(...subFiles);
    } else if (item.isFile() && item.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

async function createInstallationGuide(packageFile, isObfuscated = false) {
  const guideName = isObfuscated ? 'INSTALLATION-GUIDE-OBFUSCATED.md' : 'INSTALLATION-GUIDE.md';
  const guidePath = path.join(RELEASE_DIR, guideName);
  
  const guide = `# Tally Backup Pro Installation Guide${isObfuscated ? ' (Obfuscated)' : ''}

## Quick Installation

### Prerequisites
- Node.js 14.0.0 or higher
- npm package manager
- Internet connection

### Installation Steps

1. **Install globally**:
   \`\`\`bash
   npm install -g ./${packageFile}
   \`\`\`

2. **Run setup wizard**:
   \`\`\`bash
   tally-backup setup
   \`\`\`

3. **Start backup service**:
   \`\`\`bash
   tally-backup start
   \`\`\`

## Alternative Installation Methods

### Local Installation
\`\`\`bash
# Extract and install locally
tar -xzf ${packageFile}
cd package
npm install
node setup-wizard.js
\`\`\`

### Manual Installation
\`\`\`bash
# Extract to desired location
mkdir tally-backup-pro
tar -xzf ${packageFile} -C tally-backup-pro --strip-components=1
cd tally-backup-pro
npm install
\`\`\`

## Configuration

### 1. Setup Google Drive Authentication
Run the setup wizard to configure Google Drive access:
\`\`\`bash
tally-backup setup-auth
\`\`\`

### 2. Configure Backup Sources
Add your Tally data directories:
\`\`\`bash
tally-backup setup-sources
\`\`\`

### 3. Setup Email Notifications (Optional)
Configure email alerts:
\`\`\`bash
tally-backup setup-email
\`\`\`

## Usage

### Manual Backup
\`\`\`bash
tally-backup backup
\`\`\`

### Check Status
\`\`\`bash
tally-backup status
\`\`\`

### Restore Data
\`\`\`bash
tally-backup restore
\`\`\`

### Install as Service
\`\`\`bash
tally-backup install-service
\`\`\`

## Troubleshooting

### Common Issues
1. **Permission Errors**: Run as administrator (Windows) or use sudo (Linux)
2. **Node.js Version**: Ensure Node.js 14+ is installed
3. **Google Drive Access**: Complete OAuth setup properly
4. **Firewall**: Allow Node.js through firewall

### Support
- Check logs in the logs/ directory
- Run \`tally-backup status\` for diagnostics
- Verify configuration with \`tally-backup test-email\`

## Security Notes${isObfuscated ? ' (Obfuscated Version)' : ''}

${isObfuscated ? 
`- This is an obfuscated version with enhanced source code protection
- Source code is heavily scrambled and difficult to reverse engineer
- All functionality remains the same as the standard version
- Use this version when source code protection is important` :
`- Standard NPM package with bundled source code
- Source code is visible but bundled with dependencies
- For enhanced security, consider the obfuscated version`}
- Keep your Google Drive credentials secure
- Use strong passwords for email configuration
- Regular updates recommended

## Version Information
- Package: ${packageFile}
- Version: ${VERSION}
- Build Type: ${isObfuscated ? 'Obfuscated' : 'Standard'}
- Node.js Required: 14.0.0+
`;

  await fs.writeFile(guidePath, guide);
  console.log(`  ✅ Installation guide created: ${guideName}`);
}

async function createWindowsPackage() {
  console.log('🪟 Creating Windows package...');
  
  const winDir = path.join(RELEASE_DIR, 'windows');
  await fs.ensureDir(winDir);
  
  // This is a Node.js application package - no standalone executable
  console.log('  Creating Node.js application package');
  
  // Copy essential directories and files needed for installation
  const essentialItems = [
    'config',     // Configuration templates
    'scripts',    // All scripts including manual-backup.bat
    'src',        // Source code for Node.js execution
    'bin',        // CLI tools
    'manual-backup.js',  // Manual backup script
    'status.js',         // Status script
    'test-email.js',     // Email test script
    'setup-wizard.js',   // Setup wizard
    'setup-sources.js',  // Source setup
    'setup-email.js',    // Email setup
    'restore.js',        // Restore script
    'package.json',      // Package info
    'index.js'           // Main entry point
  ];

  for (const item of essentialItems) {
    const srcPath = path.join(__dirname, '..', item);
    const destPath = path.join(winDir, item);
    
    if (await fs.pathExists(srcPath)) {
      await fs.copy(srcPath, destPath);
      console.log(`  ✓ Copied ${item}`);
    } else {
      console.log(`  ⚠️  ${item} not found, skipping`);
    }
  }

  // Copy Windows configuration tool
  await fs.copy(
    path.join(__dirname, 'windows-config-tool.bat'),
    path.join(winDir, 'windows-config-tool.bat')
  );

  // Copy installer files
  const installerFiles = [
    'install.bat',
    'install-user.bat', 
    'install-windows.bat',
    'tally-backup-launcher.bat',
    'windows-installer.bat'
  ];

  for (const file of installerFiles) {
    const srcPath = path.join(__dirname, file);
    const destPath = path.join(winDir, file);
    if (await fs.pathExists(srcPath)) {
      await fs.copy(srcPath, destPath);
      console.log(`  ✓ Copied ${file}`);
    } else {
      console.log(`  ⚠️  ${file} not found, skipping`);
    }
  }

  // Copy Windows user guide
  const userGuidePath = path.join(__dirname, '..', 'docs', 'windows-user-guide.md');
  if (await fs.pathExists(userGuidePath)) {
    await fs.copy(userGuidePath, path.join(winDir, 'WINDOWS-USER-GUIDE.md'));
  }
  
  // Copy installer README
  const installerReadmePath = path.join(__dirname, 'INSTALLER-README.md');
  if (await fs.pathExists(installerReadmePath)) {
    await fs.copy(installerReadmePath, path.join(winDir, 'INSTALLER-README.md'));
  }
  
  // Create README for Windows
  const windowsReadme = `# Tally Backup Pro - Windows Installation

## 🚀 Quick Start (Recommended)

**For most users:**
1. Run **windows-installer.bat**
2. Choose "2. User Installation"
3. Follow the configuration wizard

**For servers/multi-user:**
1. Right-click Command Prompt → "Run as administrator"
2. Run **windows-installer.bat**
3. Choose "1. System Installation"

## 📦 What's Included

- **Node.js Application** - Professional backup solution (Node.js required)
- **windows-installer.bat** - Interactive installer with guided setup
- **windows-config-tool.bat** - Configuration and management tool
- **INSTALLER-README.md** - Detailed installation guide
- **WINDOWS-USER-GUIDE.md** - Complete user documentation

## 🎯 Installation Options

| Option | Best For | Requirements | Location |
|--------|----------|-------------|----------|
| **User Install** | Personal computers | Node.js + Current user | User profile |
| **System Install** | Servers, multi-user | Node.js + Administrator | Program Files |
| **Portable** | Testing, temporary | Node.js | Current folder |

## 🛠️ After Installation

1. **Configure:** Use windows-config-tool.bat
2. **Setup Google Drive:** Follow the authentication wizard
3. **Start Backups:** Service runs automatically

## 📖 Need Help?

- **Quick Setup:** INSTALLER-README.md
- **Complete Guide:** WINDOWS-USER-GUIDE.md
- **Configuration:** Use windows-config-tool.bat

---
**Ready? Run windows-installer.bat to get started!**

### Option 3: Manual Installation
1. Ensure Node.js 18+ is installed on your system
2. Copy all files to desired folder
3. Run: npm install (first time only)
4. Run: node manual-backup.js --help

## After Installation
1. Use the desktop shortcut "Tally Backup Config"
2. Or run: windows-config-tool.bat
3. Follow the setup wizard for Google Drive setup

## System Requirements
- Windows 10 or later
- Node.js 18 or later
- Internet connection for Google Drive access
- Sufficient disk space for Tally data backup

## Troubleshooting
- If install.bat fails, try install-user.bat directly
- For system installation, right-click install-windows.bat and "Run as administrator"
- Make sure Node.js is in your PATH
- Check WINDOWS-USER-GUIDE.md for detailed instructions

For support, visit: https://github.com/your-username/tally-backup-pro
`;
  
  await fs.writeFile(path.join(winDir, 'README.txt'), windowsReadme);
  
  // Create ZIP package
  await createZipPackage(winDir, `tally-backup-pro-${VERSION}-windows.zip`);
  
  // Clean up extracted files after ZIP creation
  await fs.remove(winDir);
  console.log(`  🧹 Cleaned up staging directory: windows/`);
}

async function createLinuxPackage() {
  console.log('🐧 Creating Linux package...');
  
  const linuxDir = path.join(RELEASE_DIR, 'linux');
  await fs.ensureDir(linuxDir);
  
  // This is a Node.js application package - no standalone executable
  console.log('  Creating Node.js application package');
  
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

# Copy application files for Node.js execution
cp -r . "$INSTALL_DIR/"
echo "Installed Node.js application files"

# Copy config templates
mkdir -p "$CONFIG_DIR"
cp -r config/* "$CONFIG_DIR/"

echo ""
echo "Installation completed successfully!"
echo "Make sure Node.js is installed on your system"
echo "Run: npm install (first time only)"
echo "Then run: node manual-backup.js --help"
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
