'use strict';

const MB = 1048576;
const PROGRESS_PREFIX = '@@TALLY_PROGRESS@@';

function emitMachineProgress(operation, payload) {
  if (process.env.TALLY_PROGRESS_JSON !== '1') return false;
  process.stdout.write(`${PROGRESS_PREFIX}${JSON.stringify({ operation, ...payload })}\n`);
  return true;
}

function renderLine(line) {
  const cols = (process.stdout && process.stdout.columns) || 80;
  let output = line;
  if (output.length > cols - 1) output = output.slice(0, cols - 1);
  process.stdout.write(`\r\x1b[2K${output}`);
}

function formatEta(processedBytes, totalBytes, elapsedMs) {
  const rate = elapsedMs > 0 ? processedBytes / (elapsedMs / 1000) : 0;
  const remainS = rate > 0 ? (totalBytes - processedBytes) / rate : 0;
  return remainS >= 60 ? `${Math.round(remainS / 60)}m` : `${Math.round(remainS)}s`;
}

function renderBackupProgress(p) {
  if (emitMachineProgress('backup', p)) return;
  const pct = p.totalBytes ? p.processedBytes / p.totalBytes : 0;
  const width = 28;
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)));
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
  const mb = (b) => (b / MB).toFixed(0);
  const eta = formatEta(p.processedBytes, p.totalBytes, p.elapsedMs);
  renderLine(
    `[${bar}] ${(pct * 100).toFixed(1)}% | ${mb(p.processedBytes)}/${mb(p.totalBytes)} MB | ` +
      `${p.filesDone}/${p.fileCount} files | ${mb(p.newBytesStored || 0)} MB up | ETA ${eta}`
  );
}

function renderRestoreProgress(p) {
  if (emitMachineProgress('restore', p)) return;
  const pct = p.totalBytes ? p.processedBytes / p.totalBytes : 0;
  const width = 28;
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)));
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
  const mb = (b) => (b / MB).toFixed(0);
  const eta = formatEta(p.processedBytes, p.totalBytes, p.elapsedMs);
  renderLine(
    `[${bar}] ${(pct * 100).toFixed(1)}% | ${mb(p.processedBytes)}/${mb(p.totalBytes)} MB | ` +
      `${p.filesDone}/${p.fileCount} files | ETA ${eta}`
  );
}

function finishProgress() {
  if (process.env.TALLY_PROGRESS_JSON !== '1') process.stdout.write('\n');
}

module.exports = {
  renderBackupProgress,
  renderRestoreProgress,
  finishProgress,
  PROGRESS_PREFIX,
};