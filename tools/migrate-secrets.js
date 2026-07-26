#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs-extra');
const { migrateConfigSecrets } = require('../src/utils/ConfigSecrets');

async function writeAtomic(target, config) {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeJson(temporary, config, { spaces: 2 });
  await fs.move(temporary, target, { overwrite: true });
}

(async () => {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const configPaths = (requested.length ? requested : ['config/config.json', 'config/config_test.json'])
    .map((item) => path.resolve(item));
  const migrations = [];

  // First store every config's values in its own vault namespace. Shared
  // credential files remain until all configs have been processed successfully.
  for (const configPath of configPaths) {
    if (!(await fs.pathExists(configPath))) continue;
    const original = await fs.readJson(configPath);
    const migration = await migrateConfigSecrets(original, configPath, { removeLegacyFiles: false });
    migrations.push({ configPath, ...migration });
  }

  for (const migration of migrations) {
    if (migration.changed) await writeAtomic(migration.configPath, migration.config);
  }

  const legacyFiles = new Set(migrations.flatMap((item) => item.deletedFiles));
  for (const file of legacyFiles) await fs.remove(file);

  for (const migration of migrations) {
    console.log(
      `${path.basename(migration.configPath)}: migrated ${migration.migrated.length} secret(s)`
    );
  }
  console.log(`Removed ${legacyFiles.size} plaintext credential file(s).`);
})().catch((error) => {
  console.error(`Secret migration failed: ${error.message}`);
  process.exit(1);
});