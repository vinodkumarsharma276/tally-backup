'use strict';

const fs = require('fs-extra');
const path = require('path');

const Chunker = require('./Chunker');
const ObjectStore = require('./ObjectStore');
const SnapshotStore = require('./SnapshotStore');

/**
 * VersionedBackup — orchestrates Git-like versioned backup on top of a storage
 * backend: chunk -> store-missing-chunks -> write-snapshot, restore-any-day,
 * list, and retention garbage collection.
 *
 * Storage-agnostic: pass any backend implementing exists/put/get/list/delete
 * (LocalFsBackend now; GoogleDriveBackend later).
 */
class VersionedBackup {
  /**
   * @param {object} opts
   * @param {object} opts.backend Storage backend.
   * @param {object} [opts.chunker] Chunker instance (defaults to 256 KB avg).
   * @param {object} [opts.objectStore] ObjectStore (defaults gzip on).
   * @param {object} [opts.snapshotStore] SnapshotStore.
   * @param {object} [opts.logger] Optional logger ({info,warn,error}).
   */
  constructor(opts) {
    if (!opts || !opts.backend) throw new Error('VersionedBackup requires a backend.');
    this.backend = opts.backend;
    this.chunker = opts.chunker || new Chunker({ avg: 256 * 1024 });
    this.objectStore = opts.objectStore || new ObjectStore(this.backend, { gzip: true });
    this.snapshotStore = opts.snapshotStore || new SnapshotStore(this.backend);
    this.log = opts.logger || console;
    this.concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 8;
  }

  /** Recursively list files under `dir` as posix-relative paths. */
  async _walk(dir) {
    const out = [];
    const walk = async (d) => {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) out.push(full);
      }
    };
    await walk(dir);
    return out.sort();
  }

  /**
   * Back up `sourceDir` into a new snapshot.
   * @returns {Promise<object>} stats including snapshotId.
   */
  async backup(sourceDir, { source = path.basename(sourceDir), onProgress } = {}) {
    const started = Date.now();
    const root = path.resolve(sourceDir);
    if (!(await fs.pathExists(root))) throw new Error(`Source not found: ${root}`);

    const files = await this._walk(root);

    // Pre-pass: stat all files for the grand total size (drives the progress bar).
    const fileStats = [];
    let grandTotalBytes = 0;
    for (const file of files) {
      const st = await fs.stat(file);
      fileStats.push(st);
      grandTotalBytes += st.size;
    }

    const manifest = {};
    let totalBytes = 0;
    let totalChunks = 0;
    let newChunks = 0;
    let newBytesStored = 0;
    let filesDone = 0;

    // Bounded-concurrency upload pool — parallelises Drive round-trips so the
    // backup is fast and progress visibly advances.
    const concurrency = this.concurrency;
    let inFlight = 0;
    const waiters = [];
    const acquire = () =>
      inFlight < concurrency
        ? ((inFlight += 1), Promise.resolve())
        : new Promise((res) => waiters.push(res)).then(() => {
            inFlight += 1;
          });
    const release = () => {
      inFlight -= 1;
      const next = waiters.shift();
      if (next) next();
    };

    const pending = new Set();
    const seen = new Set(); // hashes already scheduled this run (avoid duplicate uploads)
    let uploadError = null;

    const schedule = async (hash, buffer) => {
      await acquire();
      const task = (async () => {
        try {
          const res = await this.objectStore.put(hash, buffer);
          if (res.stored) {
            newChunks += 1;
            newBytesStored += res.storedBytes;
          }
        } catch (e) {
          if (!uploadError) uploadError = e;
        } finally {
          release();
        }
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
    };

    let lastEmit = 0;
    const emit = (force) => {
      const now = Date.now();
      if (!force && now - lastEmit < 200) return;
      lastEmit = now;
      if (onProgress) {
        onProgress({
          processedBytes: totalBytes,
          totalBytes: grandTotalBytes,
          filesDone,
          fileCount: files.length,
          totalChunks,
          newChunks,
          newBytesStored,
          elapsedMs: now - started,
        });
      }
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rel = path.relative(root, file).split(path.sep).join('/');
      const chunks = [];

      await this.chunker.chunkFile(file, async ({ hash, size, buffer }) => {
        chunks.push(hash);
        totalChunks += 1;
        totalBytes += size;
        if (!seen.has(hash)) {
          seen.add(hash);
          await schedule(hash, buffer);
        }
        if (uploadError) throw uploadError;
        emit(false);
      });

      filesDone += 1;
      manifest[rel] = { size: fileStats[i].size, mtime: fileStats[i].mtimeMs, chunks };
      emit(false);
    }

    // Drain remaining in-flight uploads.
    while (pending.size > 0) await Promise.race(pending);
    if (uploadError) throw uploadError;
    // Flush any buffered pack (packed object stores) so all chunks are durable
    // before the snapshot that references them is written.
    if (typeof this.objectStore.flush === 'function') await this.objectStore.flush();
    emit(true);

    const id = SnapshotStore.newId();
    const snapshot = {
      id,
      createdAt: new Date().toISOString(),
      source,
      chunkParams: { avg: this.chunker.avg, min: this.chunker.min, max: this.chunker.max },
      fileCount: files.length,
      totalBytes,
      totalChunks,
      files: manifest,
    };
    await this.snapshotStore.write(snapshot);

    const stats = {
      snapshotId: id,
      source,
      fileCount: files.length,
      totalBytes,
      totalChunks,
      newChunks,
      newBytesStored,
      durationMs: Date.now() - started,
    };
    this.log.info(
      `Backup '${source}' -> snapshot ${id}: ${files.length} files, ` +
        `${totalChunks} chunks, ${newChunks} new (${(newBytesStored / 1048576).toFixed(2)} MB uploaded)`
    );
    return stats;
  }

  /**
   * Restore a snapshot ("latest" or an id) into `destDir` (must be empty/new).
   * Reassembles each file from its chunks; never writes to the live source.
   */
  async restore(snapshotIdOrLatest, destDir, { onProgress } = {}) {
    const started = Date.now();
    const id = await this.snapshotStore.resolveId(snapshotIdOrLatest);
    const snapshot = await this.snapshotStore.read(id);
    const dest = path.resolve(destDir);
    await fs.ensureDir(dest);

    const totalBytes = snapshot.totalBytes || 0;
    const fileCount = Object.keys(snapshot.files).length;
    const conc = this.concurrency;
    let filesWritten = 0;
    let bytesWritten = 0;
    let lastEmit = 0;
    const emit = (force) => {
      const now = Date.now();
      if (!force && now - lastEmit < 200) return;
      lastEmit = now;
      if (onProgress) {
        onProgress({ processedBytes: bytesWritten, totalBytes, filesDone: filesWritten, fileCount, elapsedMs: now - started });
      }
    };

    for (const [rel, meta] of Object.entries(snapshot.files)) {
      const outPath = path.join(dest, ...rel.split('/'));
      await fs.ensureDir(path.dirname(outPath));
      const handle = await fs.open(outPath, 'w');
      try {
        const hashes = meta.chunks;
        // Prefetch up to `conc` chunks ahead (parallel downloads), but write
        // them strictly in order so the file is reassembled correctly with
        // bounded memory.
        const inflight = new Map(); // index -> Promise<Buffer>
        let nextToFetch = 0;
        const fill = () => {
          while (nextToFetch < hashes.length && inflight.size < conc) {
            const idx = nextToFetch++;
            inflight.set(idx, this.objectStore.get(hashes[idx])); // verifies integrity
          }
        };
        fill();
        for (let i = 0; i < hashes.length; i++) {
          const buf = await inflight.get(i);
          inflight.delete(i);
          await fs.write(handle, buf, 0, buf.length);
          bytesWritten += buf.length;
          fill();
          emit(false);
        }
      } finally {
        await fs.close(handle);
      }
      // Best-effort preserve modification time.
      if (meta.mtime) await fs.utimes(outPath, new Date(), new Date(meta.mtime)).catch(() => {});
      filesWritten += 1;
      emit(false);
    }
    emit(true);

    const stats = { snapshotId: id, dest, filesWritten, bytesWritten, durationMs: Date.now() - started };
    this.log.info(`Restore ${id} -> ${dest}: ${filesWritten} files, ${(bytesWritten / 1048576).toFixed(2)} MB`);
    return stats;
  }

  /** List snapshot summaries (oldest -> newest). */
  async list() {
    return this.snapshotStore.list();
  }

  /**
   * Retention + mark-and-sweep garbage collection.
   * Deletes snapshots older than `keepDays` (always keeps the latest), then
   * deletes any chunk not referenced by a surviving snapshot.
   * @returns {Promise<object>} gc stats.
   */
  async gc({ keepDays = 30, dryRun = false } = {}) {
    const refs = await this.snapshotStore.readRefs();
    const all = refs.snapshots.slice();
    if (all.length === 0) return { deletedSnapshots: 0, deletedChunks: 0, keptSnapshots: 0 };

    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const latestId = refs.latest;
    const survivors = [];
    const expired = [];
    for (const s of all) {
      const ts = new Date(s.createdAt).getTime();
      if (s.id === latestId || ts >= cutoff) survivors.push(s);
      else expired.push(s);
    }

    // MARK: collect all chunk hashes referenced by surviving snapshots.
    const referenced = new Set();
    for (const s of survivors) {
      const snap = await this.snapshotStore.read(s.id);
      for (const meta of Object.values(snap.files)) {
        for (const h of meta.chunks) referenced.add(h);
      }
    }

    // SWEEP: any stored chunk not referenced is garbage.
    const allHashes = await this.objectStore.listHashes();
    const garbage = allHashes.filter((h) => !referenced.has(h));

    let packCompaction = null;
    if (!dryRun) {
      for (const s of expired) await this.snapshotStore.delete(s.id);
      if (typeof this.objectStore.gc === 'function') {
        // Pack-aware compaction (delete/rewrite packs by liveness).
        packCompaction = await this.objectStore.gc(referenced);
      } else {
        for (const h of garbage) await this.objectStore.delete(h);
      }
    }

    const stats = {
      keepDays,
      dryRun,
      keptSnapshots: survivors.length,
      deletedSnapshots: expired.length,
      referencedChunks: referenced.size,
      deletedChunks: garbage.length,
      packCompaction,
    };
    this.log.info(
      `GC (${dryRun ? 'dry-run' : 'applied'}): kept ${survivors.length} snapshots, ` +
        `deleted ${expired.length} snapshots, ${garbage.length} orphan chunks`
    );
    return stats;
  }
}

module.exports = VersionedBackup;
