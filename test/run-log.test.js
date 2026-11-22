'use strict';

/*
 * Per-run activity logs (desktop/runLog.js).
 *
 * The Activity logs page used to show only the current run — its view was
 * cleared whenever a new run started — plus a tail of the shared daily log, so
 * a past run's output could not be looked at again. Each backup and restore now
 * writes logs/runs/<runId>.log.
 *
 * Run: node test/run-log.test.js   (from the repo root)
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');

const {
  isRunId,
  runLogPath,
  createRunLog,
  readRunLog,
  listRunLogIds,
  readOrphanRuns,
  mergeRuns,
  pruneRunLogs,
} = require('../desktop/runLog');

const DIR = path.join(__dirname, '..', 'temp', 'run-log-test');
const DAY = 24 * 60 * 60 * 1000;

const results = [];
const check = (name, cond, detail) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
};

const newId = () => crypto.randomUUID();

async function main() {
  await fs.remove(DIR);

  // --- Path safety: the id comes from the renderer -------------------------
  check('a UUID is a run id', isRunId(newId()));
  check('a traversal path is not a run id', !isRunId('../../config/config'));
  check('a Windows traversal path is not a run id', !isRunId('..\\..\\secrets'));
  check('non-strings are not run ids', !isRunId(null) && !isRunId(42) && !isRunId(''));
  let threw = false;
  try { runLogPath(DIR, '../../etc/passwd'); } catch { threw = true; }
  check('building a path from a bad id throws', threw);
  let readThrew = false;
  try { await readRunLog(DIR, '../../config/config'); } catch { readThrew = true; }
  check('reading with a bad id throws instead of reading a file', readThrew);

  // --- A completed run -----------------------------------------------------
  const doneId = newId();
  const done = createRunLog(DIR, {
    runId: doneId,
    type: 'backup',
    origin: 'scheduled',
    sourceName: 'Tally Data',
    startedAt: new Date(Date.now() - 65 * 1000).toISOString(),
  });
  for (let i = 1; i <= 200; i += 1) done.write(`line ${i}`);
  await done.close({ status: 'failed', code: 1 });
  done.write('written after close');
  await new Promise((resolve) => setTimeout(resolve, 20));

  const raw = await fs.readFile(runLogPath(DIR, doneId), 'utf8');
  const order = raw.split('\n').filter((l) => /^line \d+$/.test(l)).map((l) => Number(l.slice(5)));
  check('every line is written, in order', order.length === 200 && order.every((n, i) => n === i + 1), `${order.length} lines`);
  check('writes after close are dropped', !raw.includes('written after close'));
  check('the file carries machine-readable meta', raw.startsWith('#meta {'));
  check('the file carries an end record', /\n#end \{.*"status":"failed"/.test(raw));

  const read = await readRunLog(DIR, doneId);
  check('reading hides the #meta and #end records', !read.lines.some((l) => l.startsWith('#')));
  check('the readable header names the run', /^── Backup started · Tally Data · scheduled · /.test(read.lines[0]), read.lines[0]);
  check('the readable footer gives outcome and exit code', /Backup failed · .* · exit code 1 · 1m \d+s ──$/.test(read.lines[read.lines.length - 1]), read.lines[read.lines.length - 1]);
  check('the reader is told the file path', read.file === runLogPath(DIR, doneId));

  const capped = await readRunLog(DIR, doneId, { maxLines: 50 });
  check('long logs are capped to the newest lines', capped.truncated && capped.lines.length === 50);
  check('capping keeps the end, where failures are', capped.lines[capped.lines.length - 1].includes('Backup failed'));

  const missing = await readRunLog(DIR, newId());
  check('a run with no file reads as empty, not an error', missing.exists === false && missing.lines.length === 0);

  // --- A cancelled run -----------------------------------------------------
  const stoppedId = newId();
  const stopped = createRunLog(DIR, { runId: stoppedId, type: 'restore', profileName: 'Office NAS', startedAt: new Date().toISOString() });
  stopped.write('restoring');
  await stopped.close({ status: 'failed', code: null, signal: 'SIGTERM' });
  const stoppedRead = await readRunLog(DIR, stoppedId);
  check('a cancelled run says it was stopped', stoppedRead.lines.some((l) => l.includes('stopped (SIGTERM)')));
  check('a restore is labelled as one', stoppedRead.lines[0].startsWith('── Restore started · Office NAS'));

  // --- An interrupted run: the app died before close() ---------------------
  const crashedId = newId();
  const crashed = createRunLog(DIR, { runId: crashedId, type: 'backup', sourceName: 'Books', origin: 'manual', startedAt: new Date(Date.now() - 1000).toISOString() });
  crashed.write('uploading…');
  await new Promise((resolve) => setTimeout(resolve, 50)); // let it flush, never close

  const ids = await listRunLogIds(DIR);
  check('every run with a file is listed', ids.has(doneId) && ids.has(stoppedId) && ids.has(crashedId));

  const orphans = await readOrphanRuns(DIR, [crashedId]);
  check('an unfinished run is read back with its metadata', orphans[0]?.meta?.sourceName === 'Books');
  check('an unfinished run has no end record', orphans[0]?.end === null);

  // --- What the picker shows -----------------------------------------------
  const currentId = newId();
  await fs.writeFile(runLogPath(DIR, currentId), '#meta {}\n');
  const t = (minutesAgo) => new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  const merged = mergeRuns({
    history: [
      { runId: doneId, type: 'backup', status: 'failed', sourceName: 'Tally Data', startedAt: t(30) },
      { type: 'backup', status: 'success', sourceName: 'Legacy', startedAt: t(60) }, // from before run logs
    ],
    logIds: new Set([doneId, crashedId, currentId]),
    orphans: [{ runId: crashedId, meta: { type: 'backup', sourceName: 'Books', startedAt: t(10) }, end: null }],
    current: { runId: currentId, type: 'restore', sourceName: 'Tally Data', startedAt: t(1) },
  });
  check('the newest run comes first', merged[0].runId === currentId, merged.map((r) => r.sourceName).join(', '));
  check('the run in progress is marked running', merged[0].status === 'running' && merged[0].hasLog);
  check('a run that never finished is marked interrupted', merged.find((r) => r.runId === crashedId)?.status === 'interrupted');
  check('a finished run keeps its recorded status', merged.find((r) => r.runId === doneId)?.status === 'failed');
  check('a run from before run logs is kept but has no log', merged.some((r) => r.sourceName === 'Legacy' && r.hasLog === false));

  const dup = mergeRuns({
    history: [{ runId: currentId, type: 'backup', status: 'success', startedAt: t(1) }],
    logIds: new Set([currentId]),
    orphans: [{ runId: currentId, meta: {}, end: null }],
    current: { runId: currentId, type: 'backup', startedAt: t(1) },
  });
  check('a run is never listed twice', dup.length === 1, `${dup.length} entries`);

  // --- Retention -----------------------------------------------------------
  const old = Date.now() - 40 * DAY;
  await fs.utimes(runLogPath(DIR, doneId), new Date(old), new Date(old));
  await fs.utimes(runLogPath(DIR, stoppedId), new Date(old), new Date(old));
  const removed = await pruneRunLogs(DIR, new Set([doneId]));
  check('an old log whose run is still in history is kept', await fs.pathExists(runLogPath(DIR, doneId)));
  check('an old log whose run left history is removed', !(await fs.pathExists(runLogPath(DIR, stoppedId))));
  check('a recent interrupted run is kept to be looked at', await fs.pathExists(runLogPath(DIR, crashedId)));
  check('prune reports what it removed', removed === 1, `${removed}`);

  await fs.remove(DIR);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
