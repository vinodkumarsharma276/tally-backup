'use strict';

/*
 * One log file per backup or restore run.
 *
 * The daily application log interleaves every run, and the live view in the
 * app only ever held the current run — it was cleared whenever a new one
 * started — so a past run's output could not be looked at again. Each run now
 * writes its own file, logs/runs/<runId>.log, which the Activity logs page
 * lists and opens.
 *
 * File layout:
 *   #meta {"runId":…,"type":…,"sourceName":…,"origin":…,"startedAt":…}
 *   ── Backup started · <source> · scheduled · 2026-11-22 15:00:01 ──
 *   <every line the run printed>
 *   ── Backup failed · 2026-11-22 15:14:35 · exit code 1 · 14m 34s ──
 *   #end {"status":"failed","code":1,…}
 *
 * The `#` lines are for the app and are hidden in the viewer. A file with no
 * `#end` belongs to a run that never finished — the app quit, crashed or the
 * machine lost power — which is exactly the run whose log matters most, so it
 * is listed as "interrupted" rather than dropped.
 *
 * Pure Node on purpose — no Electron — so it runs under `npm test`.
 */

const path = require('path');
const fs = require('fs-extra');

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META = '#meta ';
const END = '#end ';
const DAY_MS = 24 * 60 * 60 * 1000;

function isRunId(value) {
  return typeof value === 'string' && RUN_ID.test(value);
}

function runLogPath(dir, runId) {
  // The id arrives from the renderer. Accepting nothing but a UUID keeps it
  // from naming a file outside the runs folder.
  if (!isRunId(runId)) throw new Error('Invalid run id.');
  return path.join(dir, `${runId}.log`);
}

const pad = (n) => String(n).padStart(2, '0');

// Local time in the same shape as the application log's own timestamps.
function stamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const kindLabel = (type) => (type === 'restore' ? 'Restore' : 'Backup');

/**
 * Starts the log for a run. Writes are queued and flushed in order without
 * blocking the main process; anything written after close() is dropped.
 * Logging must never break the operation, so every failure is swallowed.
 */
function createRunLog(dir, meta) {
  const file = runLogPath(dir, meta.runId);
  const started = new Date(meta.startedAt || Date.now());
  const what = meta.sourceName || meta.profileName;
  const header =
    `${META}${JSON.stringify(meta)}\n` +
    `── ${kindLabel(meta.type)} started${what ? ` · ${what}` : ''} · ${meta.origin || 'manual'} · ${stamp(started)} ──\n`;

  let chain = fs.ensureDir(dir).then(() => fs.writeFile(file, header)).catch(() => {});
  let pending = [];
  let scheduled = false;
  let closed = false;

  const flush = () => {
    scheduled = false;
    if (!pending.length) return;
    const text = `${pending.join('\n')}\n`;
    pending = [];
    chain = chain.then(() => fs.appendFile(file, text)).catch(() => {});
  };

  return {
    file,
    write(line) {
      if (closed) return;
      pending.push(String(line));
      if (!scheduled) {
        scheduled = true;
        setImmediate(flush);
      }
    },
    /** Writes the footer and the `#end` record. Resolves once both are on disk. */
    close(end = {}) {
      if (closed) return chain;
      closed = true;
      flush();
      const completedAt = end.completedAt || new Date().toISOString();
      const ms = new Date(completedAt).getTime() - started.getTime();
      const outcome = end.status === 'success' ? 'completed' : 'failed';
      const details = [
        stamp(new Date(completedAt)),
        end.signal ? `stopped (${end.signal})` : `exit code ${end.code ?? 'unknown'}`,
        duration(ms),
      ].filter(Boolean).join(' · ');
      const record = { status: end.status, code: end.code ?? null, signal: end.signal || null, completedAt, durationMs: ms };
      chain = chain
        .then(() => fs.appendFile(file, `── ${kindLabel(meta.type)} ${outcome} · ${details} ──\n${END}${JSON.stringify(record)}\n`))
        .catch(() => {});
      return chain;
    },
  };
}

/** The readable lines of one run's log, newest `maxLines` at most. */
async function readRunLog(dir, runId, { maxLines = 5000 } = {}) {
  const file = runLogPath(dir, runId);
  if (!(await fs.pathExists(file))) return { exists: false, file, lines: [], truncated: false };
  const all = (await fs.readFile(file, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith(META) && !line.startsWith(END));
  const truncated = all.length > maxLines;
  return { exists: true, file, lines: truncated ? all.slice(-maxLines) : all, truncated };
}

/** Run ids that have a log file on disk. */
async function listRunLogIds(dir) {
  if (!(await fs.pathExists(dir))) return new Set();
  const ids = (await fs.readdir(dir))
    .filter((name) => name.endsWith('.log'))
    .map((name) => name.slice(0, -4))
    .filter(isRunId);
  return new Set(ids);
}

/**
 * Reads the metadata of runs that have a log but no history entry. Only these
 * are parsed — a run in the history already carries everything the list needs.
 */
async function readOrphanRuns(dir, runIds) {
  const out = [];
  for (const runId of runIds) {
    let lines;
    try {
      lines = (await fs.readFile(runLogPath(dir, runId), 'utf8')).split(/\r?\n/);
    } catch {
      continue;
    }
    let meta = null;
    let end = null;
    try {
      if (lines[0] && lines[0].startsWith(META)) meta = JSON.parse(lines[0].slice(META.length));
    } catch { /* unreadable header: still list the run, with what we know */ }
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i -= 1) {
      if (lines[i].startsWith(END)) {
        try { end = JSON.parse(lines[i].slice(END.length)); } catch { /* treat as unfinished */ }
        break;
      }
    }
    out.push({ runId, meta, end });
  }
  return out;
}

/**
 * Everything the run picker shows, newest first: the run in progress, finished
 * runs from the history, and runs that left a log but never finished.
 */
function mergeRuns({ history = [], logIds = new Set(), orphans = [], current = null }) {
  const runs = [];
  const seen = new Set();

  if (current && current.runId) {
    runs.push({ ...current, status: 'running', hasLog: logIds.has(current.runId) });
    seen.add(current.runId);
  }
  for (const entry of history) {
    if (entry.runId && seen.has(entry.runId)) continue;
    if (entry.runId) seen.add(entry.runId);
    runs.push({ ...entry, hasLog: !!entry.runId && logIds.has(entry.runId) });
  }
  for (const { runId, meta, end } of orphans) {
    if (seen.has(runId)) continue;
    seen.add(runId);
    runs.push({
      runId,
      type: meta?.type || 'backup',
      origin: meta?.origin || null,
      sourceName: meta?.sourceName || null,
      profileName: meta?.profileName || null,
      startedAt: meta?.startedAt || null,
      completedAt: end?.completedAt || null,
      durationMs: end?.durationMs ?? null,
      status: end?.status || 'interrupted',
      hasLog: true,
    });
  }

  const time = (run) => new Date(run.startedAt || run.completedAt || 0).getTime() || 0;
  return runs.sort((a, b) => time(b) - time(a));
}

/**
 * Deletes logs no longer worth keeping. A log stays while its run is still in
 * the history, and for `maxAgeDays` regardless — so an interrupted run's log
 * survives long enough to be looked at even though it has no history entry.
 */
async function pruneRunLogs(dir, keepIds, { maxAgeDays = 30, now = Date.now() } = {}) {
  let removed = 0;
  for (const runId of await listRunLogIds(dir)) {
    if (keepIds.has(runId)) continue;
    const file = runLogPath(dir, runId);
    try {
      const { mtimeMs } = await fs.stat(file);
      if (now - mtimeMs > maxAgeDays * DAY_MS) {
        await fs.remove(file);
        removed += 1;
      }
    } catch { /* already gone */ }
  }
  return removed;
}

module.exports = {
  isRunId,
  runLogPath,
  createRunLog,
  readRunLog,
  listRunLogIds,
  readOrphanRuns,
  mergeRuns,
  pruneRunLogs,
};
