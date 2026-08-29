const path = require('path');
const fs = require('fs-extra');
const os = require('os');

const APP_FOLDER = 'BackupGenie';
const LEGACY_APP_FOLDER = 'TallyBackupApp';

/**
 * Configuration Path Manager
 * Handles config file paths for both development and global npm installation
 */
class ConfigPathManager {
  constructor() {
    // Determine if we're running from local npm installation or local development
    const isDevelopment = fs.pathExistsSync(path.join(__dirname, '../../config/config.json'));
    
    if (isDevelopment) {
      // For local development, use relative paths
      this.baseConfigDir = path.join(__dirname, '../..');
    } else {
      const documents = path.join(os.homedir(), 'Documents');
      this.baseConfigDir = path.join(documents, APP_FOLDER);
      ConfigPathManager._migrateLegacyFolder(path.join(documents, LEGACY_APP_FOLDER), this.baseConfigDir);
    }
    
    this.configDir = path.join(this.baseConfigDir, 'config');
    this.dataDir = path.join(this.baseConfigDir, 'data');
    this.logsDir = path.join(this.baseConfigDir, 'logs');
    this.tempDir = path.join(this.baseConfigDir, 'temp');
  }

  // Installs made before the rename keep their settings, history and state.
  static _migrateLegacyFolder(legacyDir, targetDir) {
    try {
      if (!fs.pathExistsSync(legacyDir) || fs.pathExistsSync(targetDir)) return;
      fs.moveSync(legacyDir, targetDir);
    } catch {
      // A locked file must never stop the app from starting; the old folder
      // simply stays where it is and a fresh one is created.
    }
  }

  /**
   * Ensure all necessary directories exist
   */
  async ensureDirectories() {
    await fs.ensureDir(this.configDir);
    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(this.logsDir);
    await fs.ensureDir(this.tempDir);
  }

  /**
   * Get path to config.json
   */
  getConfigPath() {
    return path.join(this.configDir, 'config.json');
  }

  /**
   * Get path to credentials.json
   */
  getCredentialsPath() {
    return path.join(this.configDir, 'credentials.json');
  }

  /**
   * Get path to token.json
   */
  getTokenPath() {
    return path.join(this.configDir, 'token.json');
  }

  /**
   * Get path to backup state file
   */
  getBackupStatePath() {
    return path.join(this.dataDir, 'backup-state.json');
  }

  /**
   * Get path to file snapshot
   */
  getFileSnapshotPath() {
    return path.join(this.dataDir, 'file-snapshot.json');
  }

  /**
   * Get path to deduplication index
   */
  getDeduplicationIndexPath() {
    return path.join(this.dataDir, 'deduplication-index.json');
  }

  /**
   * Get logs directory
   */
  getLogsDir() {
    return this.logsDir;
  }

  /**
   * Get temp directory
   */
  getTempDir() {
    return this.tempDir;
  }

  /**
   * Get base directory (Documents/TallyBackup for global install, project root for dev)
   */
  getBaseDir() {
    return this.baseConfigDir;
  }

  /**
   * Load config.json with proper path resolution
   */
  async loadConfig() {
    const configPath = this.getConfigPath();
    
    if (!(await fs.pathExists(configPath))) {
      throw new Error(`Configuration file not found: ${configPath}\nPlease run 'tally-backup init' or 'tally-backup setup-wizard' first.`);
    }
    
    return await fs.readJson(configPath);
  }

  /**
   * Save config.json with proper path resolution
   */
  async saveConfig(config) {
    await this.ensureDirectories();
    const configPath = this.getConfigPath();
    await fs.writeJson(configPath, config, { spaces: 2 });
    return configPath;
  }

  /**
   * Copy template config files from npm package to user directory (for installs)
   */
  async initializeFromTemplate() {
    await this.ensureDirectories();
    
    // For development: use ../config
    // For installed: use node_modules/tally-backup-pro/config
    const isDevelopment = fs.pathExistsSync(path.join(__dirname, '../../config/config.json'));
    
    let packageConfigDir;
    if (isDevelopment) {
      packageConfigDir = path.join(__dirname, '../config');
    } else {
      // For installed package, look in node_modules
      packageConfigDir = path.join(process.cwd(), 'node_modules', 'tally-backup-pro', 'config');
    }
    
    // Copy template files if they exist in the package
    const templateFiles = ['config.json', 'credentials.example.json'];
    
    for (const file of templateFiles) {
      const sourcePath = path.join(packageConfigDir, file);
      const destPath = path.join(this.configDir, file);
      
      if (await fs.pathExists(sourcePath) && !(await fs.pathExists(destPath))) {
        await fs.copy(sourcePath, destPath);
        console.log(`📋 Copied template: ${file}`);
      }
    }
  }
}

// Export singleton instance
module.exports = new ConfigPathManager();
