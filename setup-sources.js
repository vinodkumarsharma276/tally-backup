const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function setupSources() {
    console.log('🔧 Multiple Source Configuration Setup');
    console.log('=====================================');
    console.log('💡 This will help you configure multiple backup sources');
    console.log('📂 Each source will be backed up to its own folder in Google Drive\n');

    try {
        const configPath = path.join(__dirname, 'config', 'config.json');
        let config;

        // Load existing config
        if (await fs.pathExists(configPath)) {
            config = await fs.readJson(configPath);
        } else {
            console.log('❌ Config file not found. Please run "npm install" first.');
            process.exit(1);
        }

        // Initialize sources array if it doesn't exist
        if (!config.backup.sources) {
            config.backup.sources = [];
        }

        // Add operation field to existing sources if missing (backward compatibility)
        config.backup.sources.forEach(source => {
            if (!source.operation) {
                source.operation = 'backup'; // Default to backup for existing sources
            }
        });

        console.log('Current sources:');
        if (config.backup.sources.length === 0) {
            console.log('  (No sources configured)');
        } else {
            config.backup.sources.forEach((source, index) => {
                const operationIcon = source.operation === 'backup' ? '⬆️' : '⬇️';
                const operationText = source.operation === 'backup' ? 'Backup' : 'Restore';
                console.log(`  ${index + 1}. ${operationIcon} ${source.name} (${operationText}): ${source.sourcePath} → ${source.backupFolderName}`);
            });
        }

        console.log('\nOptions:');
        console.log('1. Add new source');
        console.log('2. Remove source');
        console.log('3. Edit source');
        console.log('4. Save and exit');

        const choice = await question('Choose an option (1-4): ');

        switch (choice) {
            case '1':
                await addSource(config);
                break;
            case '2':
                await removeSource(config);
                break;
            case '3':
                await editSource(config);
                break;
            case '4':
                await saveConfig(config, configPath);
                console.log('✅ Configuration saved successfully!');
                process.exit(0);
                break;
            default:
                console.log('❌ Invalid choice. Please try again.');
                await setupSources();
        }

        // Continue with the setup
        await setupSources();

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
}

async function addSource(config) {
    console.log('\n📂 Adding new source...');
    
    const name = await question('Enter source name (e.g., "Tally Data", "Documents"): ');
    
    console.log('\nOperation type:');
    console.log('1. Backup (Local → Google Drive)');
    console.log('2. Restore (Google Drive → Local)');
    const operationChoice = await question('Choose operation (1 or 2): ');
    
    const operation = operationChoice === '2' ? 'restore' : 'backup';
    
    let sourcePath, backupFolderName;
    
    if (operation === 'backup') {
        sourcePath = await question('Enter local source path (e.g., "C:\\\\Users\\\\YourName\\\\Documents"): ');
        backupFolderName = await question('Enter Google Drive folder name (e.g., "Documents Backup"): ');
        
        // Validate source path for backup
        if (!await fs.pathExists(sourcePath)) {
            console.log(`⚠️  Warning: Source path does not exist: ${sourcePath}`);
            const proceed = await question('Do you want to add it anyway? (y/n): ');
            if (proceed.toLowerCase() !== 'y') {
                return;
            }
        }
    } else {
        sourcePath = await question('Enter local destination path (e.g., "C:\\\\Users\\\\YourName\\\\Downloads\\\\FromGoogleDrive"): ');
        backupFolderName = await question('Enter Google Drive source folder name (e.g., "Shared Documents"): ');
    }

    const newSource = {
        name: name.trim(),
        operation: operation,
        sourcePath: sourcePath.trim(),
        backupFolderName: backupFolderName.trim()
    };

    config.backup.sources.push(newSource);
    console.log(`✅ Added ${operation} source: ${name} → ${backupFolderName}`);
}

async function removeSource(config) {
    if (config.backup.sources.length === 0) {
        console.log('❌ No sources to remove.');
        return;
    }

    console.log('\n🗑️  Remove source...');
    config.backup.sources.forEach((source, index) => {
        const operationIcon = source.operation === 'backup' ? '⬆️' : '⬇️';
        const operationText = source.operation === 'backup' ? 'Backup' : 'Restore';
        console.log(`  ${index + 1}. ${operationIcon} ${source.name} (${operationText}): ${source.sourcePath} → ${source.backupFolderName}`);
    });

    const choice = await question('Enter source number to remove (or 0 to cancel): ');
    const index = parseInt(choice) - 1;

    if (index >= 0 && index < config.backup.sources.length) {
        const removed = config.backup.sources.splice(index, 1)[0];
        console.log(`✅ Removed source: ${removed.name}`);
    } else if (choice !== '0') {
        console.log('❌ Invalid choice.');
    }
}

async function editSource(config) {
    if (config.backup.sources.length === 0) {
        console.log('❌ No sources to edit.');
        return;
    }

    console.log('\n✏️  Edit source...');
    config.backup.sources.forEach((source, index) => {
        const operationIcon = source.operation === 'backup' ? '⬆️' : '⬇️';
        const operationText = source.operation === 'backup' ? 'Backup' : 'Restore';
        console.log(`  ${index + 1}. ${operationIcon} ${source.name} (${operationText}): ${source.sourcePath} → ${source.backupFolderName}`);
    });

    const choice = await question('Enter source number to edit (or 0 to cancel): ');
    const index = parseInt(choice) - 1;

    if (index >= 0 && index < config.backup.sources.length) {
        const source = config.backup.sources[index];
        
        const newName = await question(`Enter name [${source.name}]: `);
        
        console.log('\nOperation type:');
        console.log('1. Backup (Local → Google Drive)');
        console.log('2. Restore (Google Drive → Local)');
        const operationChoice = await question(`Choose operation (1 or 2) [${source.operation === 'backup' ? '1' : '2'}]: `);
        
        const newOperation = operationChoice === '2' ? 'restore' : (operationChoice === '1' ? 'backup' : source.operation);
        
        const newSourcePath = await question(`Enter source path [${source.sourcePath}]: `);
        const newBackupFolderName = await question(`Enter Google Drive folder name [${source.backupFolderName}]: `);

        if (newName.trim()) source.name = newName.trim();
        if (newOperation) source.operation = newOperation;
        if (newSourcePath.trim()) source.sourcePath = newSourcePath.trim();
        if (newBackupFolderName.trim()) source.backupFolderName = newBackupFolderName.trim();

        console.log(`✅ Updated source: ${source.name}`);
    } else if (choice !== '0') {
        console.log('❌ Invalid choice.');
    }
}

async function saveConfig(config, configPath) {
    // Remove old single source configuration if it exists
    if (config.backup.sourcePath) {
        delete config.backup.sourcePath;
    }
    if (config.googleDrive.backupFolderName) {
        delete config.googleDrive.backupFolderName;
    }

    await fs.writeJson(configPath, config, { spaces: 2 });
}

// Run if called directly
if (require.main === module) {
    setupSources().finally(() => {
        rl.close();
    });
}

module.exports = setupSources;

// ✅ REVERSE BACKUP CAPABILITY IMPLEMENTED
// 
// The requested reverse backup functionality has been successfully implemented:
// 
// 1. Enhanced restore.js with TallyRestore class
// 2. Multiple restore options:
//    - Interactive mode: npm run restore
//    - List backups: npm run restore-list or node restore.js --list
//    - Restore all: npm run restore-all or node restore.js --all
//    - Restore specific source: node restore.js --source "Source Name"
//    - Restore to custom path: node restore.js --source "Source Name" "Path"
// 
// 3. Features implemented:
//    - Multi-source restore support (matches multi-source backup)
//    - Selective restore (choose specific sources)
//    - Flexible destination paths (original or custom)
//    - Interactive user interface
//    - Command-line interface for scripting
//    - Content browsing without downloading
//    - Progress tracking and detailed logging
//    - File structure preservation
// 
// 4. New files created:
//    - src/TallyRestore.js - Core restore functionality
//    - Enhanced restore.js - Command-line and interactive interface
// 
// 5. Documentation updated:
//    - README.md with comprehensive restore documentation
//    - Package.json with new restore scripts
// 
// The system now supports full bi-directional backup and restore operations
// between local directories and Google Drive, with support for multiple sources.

// 📧 EMAIL ENHANCEMENT REQUEST: Multiple Google Drive Links
// The report in the email doesn't contain the right google drive link. Create multiple google drive link for muliple backup folder