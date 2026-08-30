'use strict';

/*
 * The pre-backup reminder is a second cron shifted earlier than the backup.
 * Getting the shift wrong would warn at the wrong time, or on the wrong day.
 *
 * Run: node test/backup-reminder.test.js   (from the repo root)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
const start = main.indexOf('function shiftCronEarlier(');
const end = main.indexOf('\nasync function configureSchedules(');
// eslint-disable-next-line no-new-func
const shiftCronEarlier = new Function(`${main.slice(start, end)}\nreturn shiftCronEarlier;`)();

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

check('shifts a daily schedule back by the given minutes', () => {
  assert.strictEqual(shiftCronEarlier('0 20 * * *', 5), '55 19 * * *');
});

check('stays within the same hour when it can', () => {
  assert.strictEqual(shiftCronEarlier('30 14 * * *', 5), '25 14 * * *');
});

check('keeps the weekday of a weekly schedule', () => {
  assert.strictEqual(shiftCronEarlier('0 9 * * 1', 15), '45 8 * * 1');
});

check('keeps the date of a monthly schedule', () => {
  assert.strictEqual(shiftCronEarlier('0 6 15 * *', 10), '50 5 15 * *');
});

check('produces a valid cron expression', () => {
  assert.ok(cron.validate(shiftCronEarlier('0 20 * * *', 5)));
  assert.ok(cron.validate(shiftCronEarlier('0 9 * * 1', 15)));
});

check('refuses to wrap onto the previous day', () => {
  // 00:02 minus 5 minutes would be 23:57 the day before, which may be a day
  // the backup does not even run.
  assert.strictEqual(shiftCronEarlier('2 0 * * *', 5), null);
});

check('skips step schedules it cannot shift safely', () => {
  assert.strictEqual(shiftCronEarlier('0 */6 * * *', 5), null);
});

check('rejects malformed expressions', () => {
  assert.strictEqual(shiftCronEarlier('not a cron', 5), null);
  assert.strictEqual(shiftCronEarlier('0 20 * *', 5), null);
});

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
