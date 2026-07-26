'use strict';

/**
 * SnapshotStore — per-day manifests ("snapshots/") plus a small index
 * ("refs.json").
 *
 * A snapshot is the COMPLETE recipe to reconstruct the source folder as of one
 * run. It lists every file (changed or not) and the ordered chunk hashes that
 * make up that file, so any day can be restored independently — no diff chain.
 *
 * Snapshot shape:
 * {
 *   id, createdAt, source, chunkParams,
 *   fileCount, totalBytes, totalChunks,
 *   files: { "<relPath>": { size, mtime, chunks: ["<hash>", ...] } }
 * }
 *
 * refs.json shape:
 * { latest: "<id>", snapshots: [ { id, createdAt, source, fileCount, totalBytes } ] }
 */
class SnapshotStore {
  /** @param {object} backend Storage backend (exists/put/get/list/delete). */
  constructor(backend) {
    this.backend = backend;
    this.prefix = 'snapshots';
    this.refsKey = 'refs.json';
  }

  /** Generate a filesystem/Drive-safe snapshot id from the current time. */
  static newId(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
  }

  _key(id) {
    return `${this.prefix}/${id}.json`;
  }

  /** Write a snapshot manifest and update refs.json. */
  async write(snapshot) {
    await this.backend.put(this._key(snapshot.id), Buffer.from(JSON.stringify(snapshot)));
    const refs = await this.readRefs();
    refs.snapshots = refs.snapshots.filter((s) => s.id !== snapshot.id);
    refs.snapshots.push({
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      source: snapshot.source,
      fileCount: snapshot.fileCount,
      totalBytes: snapshot.totalBytes,
    });
    refs.snapshots.sort((a, b) => a.id.localeCompare(b.id));
    refs.latest = refs.snapshots[refs.snapshots.length - 1].id;
    await this.writeRefs(refs);
    return snapshot.id;
  }

  /** Read a full snapshot manifest by id. */
  async read(id) {
    const buf = await this.backend.get(this._key(id));
    return JSON.parse(buf.toString('utf8'));
  }

  /** Delete a snapshot manifest and update refs.json. */
  async delete(id) {
    await this.backend.delete(this._key(id));
    const refs = await this.readRefs();
    refs.snapshots = refs.snapshots.filter((s) => s.id !== id);
    refs.latest = refs.snapshots.length
      ? refs.snapshots[refs.snapshots.length - 1].id
      : null;
    await this.writeRefs(refs);
  }

  /** List snapshot summaries (sorted oldest -> newest). */
  async list() {
    const refs = await this.readRefs();
    return refs.snapshots;
  }

  async readRefs() {
    if (!(await this.backend.exists(this.refsKey))) {
      return { latest: null, snapshots: [] };
    }
    const buf = await this.backend.get(this.refsKey);
    const refs = JSON.parse(buf.toString('utf8'));
    if (!Array.isArray(refs.snapshots)) refs.snapshots = [];
    return refs;
  }

  async writeRefs(refs) {
    await this.backend.put(this.refsKey, Buffer.from(JSON.stringify(refs, null, 2)));
  }

  /** Resolve "latest" (or a literal id) to a concrete snapshot id. */
  async resolveId(idOrLatest) {
    if (idOrLatest && idOrLatest !== 'latest') return idOrLatest;
    const refs = await this.readRefs();
    if (!refs.latest) throw new Error('No snapshots exist yet.');
    return refs.latest;
  }
}

module.exports = SnapshotStore;
