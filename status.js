#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');
const BackupState = require('./src/BackupState');
const logger = require('./src/utils/logger');

/**
 * Backup status script
 * Usage: node status.js
 */

async function showBackupStatus() {
    try {
        console.log('\n=== Tally Backup Status ===\n');
        
        const backupState = new BackupState(path.join(process.cwd(), 'data'));
        await backupState.initialize();
        
        const stats = backupState.getStats();
        
        // Basic statistics
        console.log('📊 Backup Statistics:');
        console.log(`   Total Backups: ${stats.totalBackups}`);
        console.log(`   Failed Backups: ${stats.failedBackups}`);
        console.log(`   Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);
        console.log(`   Total Files Backed Up: ${stats.totalFilesBackedUp.toLocaleString()}`);
        console.log(`   Total Size Backed Up: ${(stats.totalSizeBackedUp / 1024 / 1024 / 1024).toFixed(2)} GB`);
        
        // Last backup information
        if (stats.lastSuccessfulBackup) {
            const lastBackup = new Date(stats.lastSuccessfulBackup);
            console.log(`\n📅 Last Successful Backup: ${lastBackup.toLocaleString()}`);
            
            const timeSinceLastBackup = Date.now() - stats.lastSuccessfulBackup;
            const hoursSince = Math.floor(timeSinceLastBackup / (1000 * 60 * 60));
            console.log(`   Time Since Last Backup: ${hoursSince} hours ago`);
        } else {
            console.log('\n📅 No successful backups found');
        }
        
        // Deduplication statistics
        const dedupe = stats.deduplication;
        console.log('\n🗜️  Deduplication Statistics:');
        console.log(`   Unique Files: ${dedupe.uniqueFiles.toLocaleString()}`);
        console.log(`   Deduplicated Files: ${dedupe.deduplicatedFiles.toLocaleString()}`);
        console.log(`   Space Saved: ${(dedupe.spaceSaved / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   Deduplication Ratio: ${(dedupe.deduplicationRatio * 100).toFixed(1)}%`);
        
        // File snapshot information
        console.log('\n📁 File Tracking:');
        console.log(`   Files in Snapshot: ${stats.fileSnapshotSize.toLocaleString()}`);
        
        // Check if logs exist
        const logsDir = path.join(process.cwd(), 'logs');
        if (await fs.pathExists(logsDir)) {
            const logFiles = await fs.readdir(logsDir);
            console.log('\n📝 Log Files:');
            for (const logFile of logFiles) {
                const logPath = path.join(logsDir, logFile);
                const logStats = await fs.stat(logPath);
                console.log(`   ${logFile}: ${(logStats.size / 1024).toFixed(2)} KB (${logStats.mtime.toLocaleDateString()})`);
            }
        }
        
        // Health check
        console.log('\n🔍 Health Check:');
        const issues = [];
        
        if (stats.failedBackups > 0) {
            issues.push(`${stats.failedBackups} failed backup(s)`);
        }
        
        if (stats.lastSuccessfulBackup) {
            const hoursSinceBackup = (Date.now() - stats.lastSuccessfulBackup) / (1000 * 60 * 60);
            if (hoursSinceBackup > 48) {
                issues.push(`Last backup was ${Math.floor(hoursSinceBackup)} hours ago`);
            }
        } else {
            issues.push('No successful backups found');
        }
        
        if (issues.length === 0) {
            console.log('   ✅ All systems operational');
        } else {
            console.log('   ⚠️  Issues detected:');
            issues.forEach(issue => console.log(`      • ${issue}`));
        }
        
        console.log('\n');
        
    } catch (error) {
        console.error('Failed to get backup status:', error.message);
        process.exit(1);
    }
}

showBackupStatus();
