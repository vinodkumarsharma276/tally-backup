'use strict';

// Runs every suite in test/ and fails if any of them does.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const suites = fs.readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort();

let failed = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [path.join(dir, suite)], { encoding: 'utf8' });
  const summary = (result.stdout || '').trim().split('\n').filter((line) => /checks passed/.test(line)).pop();
  if (result.status === 0) {
    console.log(`ok   ${suite.padEnd(38)} ${summary || ''}`);
  } else {
    failed += 1;
    console.log(`FAIL ${suite}`);
    console.log((result.stdout || '') + (result.stderr || ''));
  }
}

console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
