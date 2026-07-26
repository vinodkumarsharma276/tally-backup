#!/usr/bin/env node
'use strict';

/*
 * Safety guard: only allow publishing a release from the `main` branch.
 * electron-builder itself ignores git branches (it uploads whatever is on disk),
 * so this check runs before publish and aborts on any other branch.
 */

const { execSync } = require('child_process');

const ALLOWED = 'main';

let branch = '';
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
} catch (error) {
  console.error('\nguard-branch: this folder is not a git repository (or git is unavailable).');
  console.error('Publishing is only allowed from a proper git checkout on the "main" branch.\n');
  process.exit(1);
}

if (branch !== ALLOWED) {
  console.error(`\n✗ Refusing to publish from branch "${branch}".`);
  console.error(`  Releases may only be published from "${ALLOWED}".`);
  console.error(`  Switch with:  git checkout ${ALLOWED}\n`);
  process.exit(1);
}

console.log(`guard-branch: on "${branch}" — OK to publish.`);
