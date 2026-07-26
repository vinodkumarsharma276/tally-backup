'use strict';

const fs = require('fs-extra');
const GoogleDriveService = require('../src/GoogleDriveService');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const GoogleDriveBackend = require('../src/versioning/backends/GoogleDriveBackend');

(async () => {
  const cfg = await fs.readJson('config/config_test.json');
  const root = cfg.backup.sources[0].backupFolderName;
  const ds = new GoogleDriveService(cfg.googleDrive);
  await ds.initialize();
  const backend = new GoogleDriveBackend(ds, { rootFolderName: root });
  await backend.init();
  const ss = new SnapshotStore(backend);

  const d1 = await ss.read('2026-06-26T09-49-57-712Z');
  const d2 = await ss.read('2026-06-27T09-39-19-535Z');

  const setOf = (snap) => {
    const s = new Set();
    for (const f of Object.values(snap.files)) for (const h of f.chunks) s.add(h);
    return s;
  };
  const s1 = setOf(d1);
  const s2 = setOf(d2);

  let inBoth = 0;
  let onlyD2 = 0;
  for (const h of s2) {
    if (s1.has(h)) inBoth++;
    else onlyD2++;
  }

  console.log('Day1 unique chunks            :', s1.size);
  console.log('Day2 unique chunks            :', s2.size);
  console.log('Day2 chunks ALSO in Day1      :', inBoth, '(should have deduplicated)');
  console.log('Day2 chunks NOT in Day1       :', onlyD2, '(truly new)');
  console.log('True dedup rate of Day2       :', ((inBoth / s2.size) * 100).toFixed(1) + '%');

  // Per-file breakdown: which files contributed the most "new" chunks.
  const rows = [];
  for (const [rel, meta] of Object.entries(d2.files)) {
    let neu = 0;
    for (const h of meta.chunks) if (!s1.has(h)) neu++;
    rows.push({ rel, chunks: meta.chunks.length, neu, sizeMB: (meta.size / 1048576).toFixed(1) });
  }
  rows.sort((a, b) => b.neu - a.neu);
  console.log('\nTop 12 files by new chunks:');
  for (const r of rows.slice(0, 12)) {
    console.log(`  new=${String(r.neu).padStart(5)} / ${String(r.chunks).padStart(5)} chunks  ${r.sizeMB} MB  ${r.rel}`);
  }
})().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
