'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const GZIP0 = 0x1f;
const GZIP1 = 0x8b;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * PackedObjectStore — drop-in alternative to ObjectStore that combines many
 * small chunks into larger "pack" objects to cut per-request costs on object
 * stores that bill per request (S3 / R2 / B2), which matters most for the
 * managed tier.
 *
 * Layout:
 *   packs/<packId>          the concatenated (gzip-per-chunk) pack blob
 *   packs/idx/<packId>.json { v, packId, entries: { <hash>: [offset, length] } }
 *
 * Interface matches ObjectStore (has/put/get/delete/listHashes) plus:
 *   flush()          write any buffered chunks as a final pack (call after backup)
 *   gc(referenced)   pack-aware compaction (delete/rewrite packs by liveness)
 *
 * Dedup uses an in-memory chunk->location index built from the pack indexes.
 * Reads fetch the containing pack (small LRU cache) and slice out the chunk,
 * verifying its SHA-256. A given storage location must be used consistently in
 * packed OR unpacked mode — the two layouts are not mixed.
 */
class PackedObjectStore {
  constructor(backend, opts = {}) {
    this.backend = backend;
    this.gzip = opts.gzip !== false;
    this.gzipLevel = opts.gzipLevel || 6;
    this.targetPackBytes = opts.targetPackBytes || 16 * 1024 * 1024; // 16 MB
    this.maxCachedPacks = opts.maxCachedPacks || 4;
    this.packPrefix = 'packs';
    this.idxPrefix = 'packs/idx';

    this._index = null; // Map<hash, { packId, off, len }>
    this._loadPromise = null;
    this._buffer = []; // [{ hash, data }]
    this._pending = new Set(); // hashes buffered but not yet flushed
    this._pendingBytes = 0;
    this._lock = Promise.resolve();
    this._packCache = new Map(); // packId -> Buffer (LRU)
  }

  _packKey(id) { return `${this.packPrefix}/${id}`; }
  _idxKey(id) { return `${this.idxPrefix}/${id}.json`; }

  // Serialises critical sections (buffer mutation, flush, gc) so concurrent
  // puts never corrupt the in-progress pack.
  _withLock(fn) {
    const run = this._lock.then(fn, fn);
    this._lock = run.then(() => {}, () => {});
    return run;
  }

  async load() {
    if (this._index) return;
    if (!this._loadPromise) {
      this._loadPromise = (async () => {
        const index = new Map();
        let keys = [];
        try { keys = await this.backend.list(`${this.idxPrefix}/`); } catch { keys = []; }
        for (const key of keys) {
          const base = key.split('/').pop();
          if (!base || !base.endsWith('.json')) continue;
          const packId = base.slice(0, -5);
          let raw;
          try { raw = await this.backend.get(this._idxKey(packId)); } catch { continue; }
          let doc;
          try { doc = JSON.parse(raw.toString('utf8')); } catch { continue; }
          for (const [hash, loc] of Object.entries(doc.entries || {})) {
            index.set(hash, { packId, off: loc[0], len: loc[1] });
          }
        }
        this._index = index;
      })();
    }
    try { await this._loadPromise; } finally { this._loadPromise = null; }
  }

  async has(hash) {
    await this.load();
    return this._index.has(hash) || this._pending.has(hash);
  }

  async put(hash, buffer) {
    await this.load();
    if (this._index.has(hash) || this._pending.has(hash)) return { stored: false, storedBytes: 0 };
    const payload = this.gzip ? await gzip(buffer, { level: this.gzipLevel }) : buffer;
    let stored = false;
    let doFlush = false;
    await this._withLock(() => {
      if (this._index.has(hash) || this._pending.has(hash)) return; // lost the race
      this._buffer.push({ hash, data: payload });
      this._pending.add(hash);
      this._pendingBytes += payload.length;
      stored = true;
      if (this._pendingBytes >= this.targetPackBytes) doFlush = true;
    });
    if (doFlush) await this.flush();
    return { stored, storedBytes: stored ? payload.length : 0 };
  }

  async flush() {
    await this._withLock(async () => {
      if (this._buffer.length === 0) return;
      const items = this._buffer;
      this._buffer = [];
      this._pendingBytes = 0;

      const entries = {};
      const parts = [];
      let off = 0;
      for (const { hash, data } of items) {
        entries[hash] = [off, data.length];
        parts.push(data);
        off += data.length;
      }
      const blob = Buffer.concat(parts, off);
      const packId = sha256(blob).slice(0, 40);
      await this.backend.put(this._packKey(packId), blob);
      await this.backend.put(this._idxKey(packId), Buffer.from(JSON.stringify({ v: 1, packId, entries }), 'utf8'));
      // Transition buffered hashes -> durable index.
      for (const [hash, loc] of Object.entries(entries)) {
        this._index.set(hash, { packId, off: loc[0], len: loc[1] });
        this._pending.delete(hash);
      }
    });
  }

  async _getPack(packId) {
    const cached = this._packCache.get(packId);
    if (cached) {
      this._packCache.delete(packId);
      this._packCache.set(packId, cached); // LRU touch
      return cached;
    }
    const blob = await this.backend.get(this._packKey(packId));
    this._packCache.set(packId, blob);
    while (this._packCache.size > this.maxCachedPacks) {
      this._packCache.delete(this._packCache.keys().next().value);
    }
    return blob;
  }

  async get(hash) {
    await this.load();
    const loc = this._index.get(hash);
    if (!loc) throw new Error(`PackedObjectStore: chunk not found: ${hash}`);
    const blob = await this._getPack(loc.packId);
    const slice = blob.subarray(loc.off, loc.off + loc.len);
    const data = slice.length >= 2 && slice[0] === GZIP0 && slice[1] === GZIP1 ? await gunzip(slice) : Buffer.from(slice);
    const actual = sha256(data);
    if (actual !== hash) {
      throw new Error(`PackedObjectStore integrity error: expected ${hash}, got ${actual}`);
    }
    return data;
  }

  async delete() {
    throw new Error('PackedObjectStore does not support per-chunk delete; use gc(referenced).');
  }

  async listHashes() {
    await this.load();
    return [...this._index.keys()];
  }

  /**
   * Pack-aware garbage collection. For each pack: keep if fully referenced,
   * delete if fully unreferenced, rewrite (dropping dead chunks) if partial.
   */
  async gc(referenced) {
    await this.load();
    return this._withLock(async () => {
      const byPack = new Map();
      for (const [hash, loc] of this._index) {
        if (!byPack.has(loc.packId)) byPack.set(loc.packId, []);
        byPack.get(loc.packId).push({ hash, off: loc.off, len: loc.len });
      }
      let deletedChunks = 0;
      let deletedPacks = 0;
      let rewrittenPacks = 0;

      for (const [packId, chunks] of byPack) {
        const live = chunks.filter((c) => referenced.has(c.hash));
        const dead = chunks.length - live.length;
        if (dead === 0) continue;

        if (live.length === 0) {
          await this.backend.delete(this._packKey(packId));
          await this.backend.delete(this._idxKey(packId));
          for (const c of chunks) this._index.delete(c.hash);
          this._packCache.delete(packId);
          deletedChunks += dead;
          deletedPacks += 1;
          continue;
        }

        // Partial: rewrite the pack with only the live chunks.
        const blob = await this._getPack(packId);
        const parts = [];
        const entries = {};
        let off = 0;
        for (const c of live) {
          const slice = Buffer.from(blob.subarray(c.off, c.off + c.len));
          entries[c.hash] = [off, c.len];
          parts.push(slice);
          off += c.len;
        }
        const newBlob = Buffer.concat(parts, off);
        const newPackId = sha256(newBlob).slice(0, 40);
        await this.backend.put(this._packKey(newPackId), newBlob);
        await this.backend.put(this._idxKey(newPackId), Buffer.from(JSON.stringify({ v: 1, packId: newPackId, entries }), 'utf8'));
        if (newPackId !== packId) {
          await this.backend.delete(this._packKey(packId));
          await this.backend.delete(this._idxKey(packId));
        }
        this._packCache.delete(packId);
        for (const c of chunks) this._index.delete(c.hash);
        for (const [hash, loc] of Object.entries(entries)) {
          this._index.set(hash, { packId: newPackId, off: loc[0], len: loc[1] });
        }
        deletedChunks += dead;
        rewrittenPacks += 1;
      }
      return { deletedChunks, deletedPacks, rewrittenPacks };
    });
  }
}

module.exports = PackedObjectStore;
