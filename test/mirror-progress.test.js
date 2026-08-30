'use strict';

/*
 * Progress must be truthful: the total is known before copying starts, it never
 * moves, and progress rises from 0 to 100 exactly once. The earlier version
 * grew the total while copying, so it sat near 100% the whole time.
 *
 * Run: node test/mirror-progress.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');
const MirrorBackup = require('../src/MirrorBackup');

const ROOT = path.join(__dirname, '..', 'temp', 'mirror-progress');
const SRC = path.join(ROOT, 'src');
const DEST = path.join(ROOT, 'dest');
const silent = { info() {}, warn() {}, error() {} };

const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

async function main() {
  await fs.remove(ROOT);
  // Several folders with different sizes, like a real data directory.
  for (const folder of ['a', 'b', 'c']) {
    await fs.ensureDir(path.join(SRC, folder));
    for (let i = 0; i < 4; i += 1) {
      await fs.writeFile(path.join(SRC, folder, `f${i}.dat`), 'x'.repeat(1000 * (i + 1)));
    }
  }

  const mirror = new MirrorBackup({ logger: silent });
  const events = [];
  await mirror.run([SRC], DEST, { onProgress: (p) => events.push({ ...p }) });

  check('progress was reported', events.length === 12);

  const totals = new Set(events.map((e) => e.totalBytes));
  check('the total never changes mid-run', totals.size === 1);

  const fileCounts = new Set(events.map((e) => e.fileCount));
  check('the file count never changes mid-run', fileCounts.size === 1);

  const percents = events.map((e) => (e.processedBytes / e.totalBytes) * 100);
  check('progress starts below halfway', percents[0] < 50);
  check('progress ends at 100%', Math.round(percents[percents.length - 1]) === 100);
  check('progress only moves forward', percents.every((p, i) => i === 0 || p >= percents[i - 1]));
  check('progress is never over 100%', percents.every((p) => p <= 100.0001));

  // The old bug: every event sat at ~100% because the total grew in step.
  const stuckAtFull = percents.slice(0, -1).filter((p) => p > 99).length;
  check('progress does not sit at 100% throughout', stuckAtFull === 0);

  // A second run copies nothing, but must still report full progress.
  const repeat = [];
  const stats = await mirror.run([SRC], DEST, { onProgress: (p) => repeat.push({ ...p }) });
  check('unchanged re-run copies nothing', stats.copiedFiles === 0 && stats.skippedFiles === 12);
  check('skipped files still count as progress',
    repeat.length > 0 && Math.round((repeat[repeat.length - 1].processedBytes / repeat[repeat.length - 1].totalBytes) * 100) === 100);

  await fs.remove(ROOT);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('MIRROR PROGRESS TEST ERROR', error);
  process.exit(2);
});
