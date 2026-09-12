'use strict';

const edition = require('../../shared/edition.json');

function assertBackupEdition(config) {
  const profiles = config.storageProfiles || {};
  const driveProfiles = Object.entries(profiles).filter(([, profile]) => profile.type === 'google_drive');
  if (driveProfiles.length > edition.maxGoogleDriveProfiles) {
    throw new Error('Backup Genie Starter supports one Google Drive storage profile. Keep one Drive profile before running backups. Existing backup data is not deleted.');
  }
  const used = new Set();
  for (const source of config.backup?.sources || []) {
    if (source.enabled === false || source.operation === 'restore') continue;
    if (source.mode === 'mirror') throw new Error('Backup Genie Starter supports versioned Google Drive backups only, not exact folder copies.');
    const destinations = Array.isArray(source.storageProfiles) && source.storageProfiles.length
      ? source.storageProfiles : [source.storageProfile || ''];
    if (destinations.length > 1) throw new Error('Backup Genie Starter supports one Google Drive destination per backup.');
    for (const name of destinations) {
      if (name && !profiles[name]) throw new Error(`Storage profile not found: ${name}`);
      const type = name ? profiles[name].type : 'google_drive';
      if (!edition.backupProviders.includes(type)) throw new Error('Backup Genie Starter backs up to Google Drive only. Other providers remain available for restoring existing data.');
      if (!name && driveProfiles.length) throw new Error('Select the single Google Drive profile for every backup source; a legacy default Drive cannot be used alongside it.');
      used.add(name);
    }
  }
  if (used.size > 1) throw new Error('All Starter backup sources must use the same Google Drive profile.');
}

function assertProfileChanges(config, previous = {}) {
  const profiles = config.storageProfiles || {};
  if (Object.values(profiles).filter(profile => profile.type === 'google_drive').length > edition.maxGoogleDriveProfiles) {
    throw new Error('Backup Genie Starter supports only one Google Drive storage profile.');
  }
  for (const [name, profile] of Object.entries(profiles)) {
    if (!edition.backupProviders.includes(profile.type) && JSON.stringify(profile) !== JSON.stringify(previous.storageProfiles?.[name])) {
      throw new Error('New or changed storage profiles must use Google Drive in Backup Genie Starter.');
    }
  }
}

module.exports = { edition, assertBackupEdition, assertProfileChanges };