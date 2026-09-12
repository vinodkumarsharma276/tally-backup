'use strict';

const assert = require('node:assert/strict');
const { assertBackupEdition, assertProfileChanges } = require('../src/utils/EditionPolicy');
const config = {
  storageProfiles: { drive: { type: 'google_drive' } },
  backup: { sources: [{ name: 'Documents', operation: 'backup', storageProfile: 'drive' }] },
};
assert.doesNotThrow(() => assertBackupEdition(config));
assert.doesNotThrow(() => assertBackupEdition({ ...config, backup: { sources: [...config.backup.sources, { ...config.backup.sources[0], name: 'Photos' }] } }));
assert.throws(() => assertBackupEdition({ ...config, storageProfiles: { ...config.storageProfiles, second: { type: 'google_drive' } } }), /one Google Drive/);
for (const type of ['local', 'network', 's3', 'azure_blob', 'managed']) {
  assert.throws(() => assertBackupEdition({ ...config, storageProfiles: { drive: { type } } }), /Google Drive only/);
}
assert.throws(() => assertBackupEdition({ ...config, backup: { sources: [{ ...config.backup.sources[0], storageProfiles: ['drive', 'drive'] }] } }), /one Google Drive destination/);
assert.throws(() => assertBackupEdition({ ...config, backup: { sources: [{ ...config.backup.sources[0], mode: 'mirror' }] } }), /exact folder copies/);
assert.throws(() => assertBackupEdition({ ...config, backup: { sources: [{ operation: 'backup' }] } }), /legacy default Drive/);
assert.doesNotThrow(() => assertBackupEdition({ backup: { sources: [{ operation: 'backup' }] } }));
const legacy = { storageProfiles: { archive: { type: 'local', rootDir: '/archive' } }, backup: { sources: [{ operation: 'restore', storageProfile: 'archive' }] } };
assert.doesNotThrow(() => assertBackupEdition(legacy));
assert.doesNotThrow(() => assertProfileChanges(legacy, legacy));
assert.throws(() => assertProfileChanges(legacy), /must use Google Drive/);
console.log('15/15 checks passed');