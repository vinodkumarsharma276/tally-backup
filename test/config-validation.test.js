'use strict';

/*
 * Saving settings must fail only for genuinely unusable sources, and must say
 * which source and what is missing. A multi-folder source whose first slot is
 * blank is still valid.
 *
 * Run: node test/config-validation.test.js   (from the repo root)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');

// validateConfig lives in the Electron main file, which cannot be required
// outside Electron, so the function is extracted from the source.
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
const start = mainSource.indexOf('function validateConfig(');
const end = mainSource.indexOf('\nasync function loadConfig(');
// eslint-disable-next-line no-new-func
const validateConfig = new Function(`${mainSource.slice(start, end)}\nreturn validateConfig;`)();

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push([name, true]);
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push([name, false]);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

const base = (sources) => ({ backup: { sources } });

check('a normal backup source saves', () => {
  validateConfig(base([{ name: 'Tally', operation: 'backup', sourcePath: 'C:/data' }]));
});

check('a multi-folder source saves', () => {
  validateConfig(base([{
    name: 'Companies',
    operation: 'backup',
    sourcePath: '',
    sourcePaths: [{ path: 'C:/acme' }, { path: 'C:/beta' }],
  }]));
});

check('plain-string folder lists still save', () => {
  validateConfig(base([{ name: 'Old', operation: 'backup', sourcePath: '', sourcePaths: ['C:/data'] }]));
});

check('an exact-copy source saves', () => {
  validateConfig(base([{ name: 'Copy', operation: 'backup', mode: 'mirror', sourcePath: 'C:/data' }]));
});

check('a source with no folder is rejected by name', () => {
  assert.throws(
    () => validateConfig(base([{ name: 'Tally', operation: 'backup', sourcePath: '' }])),
    /"Tally" needs a folder to back up/
  );
});

check('a blank folder list is rejected', () => {
  assert.throws(
    () => validateConfig(base([{ name: 'Tally', operation: 'backup', sourcePath: '', sourcePaths: [{ path: '   ' }] }])),
    /needs a folder to back up/
  );
});

check('a restore source gets restore wording', () => {
  assert.throws(
    () => validateConfig(base([{ name: 'Recover', operation: 'restore', sourcePath: '' }])),
    /needs a restore destination folder/
  );
});

check('an unnamed source is identified by position', () => {
  assert.throws(
    () => validateConfig(base([{ operation: 'backup', sourcePath: 'C:/data' }])),
    /Source 1 needs a display name/
  );
});

check('duplicate names are still rejected', () => {
  assert.throws(
    () => validateConfig(base([
      { name: 'Same', operation: 'backup', sourcePath: 'C:/a' },
      { name: 'Same', operation: 'backup', sourcePath: 'C:/b' },
    ])),
    /Duplicate source name/
  );
});

check('an unsupported operation is still rejected', () => {
  assert.throws(
    () => validateConfig(base([{ name: 'X', operation: 'sync', sourcePath: 'C:/a' }])),
    /Unsupported source operation/
  );
});

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
