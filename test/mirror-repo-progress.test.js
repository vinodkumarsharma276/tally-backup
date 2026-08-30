'use strict';

/*
 * Multi-destination progress. The copy stage previously emitted field names the
 * renderer did not understand, so the bar sat at 0% while data was moving.
 *
 * Run: node test/mirror-repo-progress.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');
const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const { mirrorRepository } = require('../src/versioning/RepositoryMirror');

const ROOT = path.join(__dirname, '..', 'temp', 'mirror-repo-progress');
const FROM = path.join(ROOT, 'from');
const TO = path.join(ROOT, 'to');

const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

async function main() {
  await fs.remove(ROOT);
  const from = new LocalFsBackend(FROM);
  for (let i = 0; i < 6; i += 1) await from.put(`objects/ab/chunk-${i}`, Buffer.alloc(1000, i));
  await from.put('refs.json', Buffer.from('{"snapshots":[],"latest":null}'));

  const events = [];
  await mirrorRepository({ from, to: new LocalFsBackend(TO), onProgress: (p) => events.push({ ...p }) });

  check('progress was reported', events.length === 6);

  // The renderer divides processedBytes by totalBytes; anything else shows 0%.
  check('uses the field names the renderer reads',
    events.every((e) => Number.isFinite(e.processedBytes) && Number.isFinite(e.totalBytes) && e.totalBytes > 0));

  const percents = events.map((e) => (e.processedBytes / e.totalBytes) * 100);
  check('progress is never NaN', percents.every((p) => Number.isFinite(p)));
  check('progress rises from low to 100', percents[0] < 50 && Math.round(percents[percents.length - 1]) === 100);
  check('progress only moves forward', percents.every((p, i) => i === 0 || p >= percents[i - 1]));
  check('reports item counts, not bytes', events.every((e) => e.unit === 'items'));
  check('reports the copy phase', events.every((e) => e.phase === 'copy'));
  check('reports bytes transferred separately', events[events.length - 1].newBytesStored > 0);

  await fs.remove(ROOT);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('MIRROR REPO PROGRESS TEST ERROR', error);
  process.exit(2);
});
