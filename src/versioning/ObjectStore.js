'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const GZIP_MAGIC0 = 0x1f;
const GZIP_MAGIC1 = 0x8b;

/**
 * ObjectStore — content-addressed storage for chunks ("the objects/ folder").
 *
 * Each unique chunk is stored exactly once, named by its own SHA-256 hash and
 * sharded by the first 2 hex chars: objects/ab/abcdef...  This gives:
 *   - deduplication (identical content -> identical key -> stored once)
 *   - immutability (content cannot change without changing its name)
 *   - integrity (re-hash on read; mismatch => corruption)
 *   - "upload only the diff" via put-if-absent (skip chunks already present)
 *
 * Chunks are gzip-compressed on write. On read we detect gzip by magic bytes,
 * so the store tolerates a mix of compressed/uncompressed objects.
 */
class ObjectStore {
  /**
   * @param {object} backend Storage backend (exists/put/get/list/delete).
   * @param {object} [opts]
   * @param {boolean} [opts.gzip=true] Compress chunks on write.
   * @param {number} [opts.gzipLevel=6] zlib level (1-9).
   */
  constructor(backend, opts = {}) {
    this.backend = backend;
    this.gzip = opts.gzip !== false;
    this.gzipLevel = opts.gzipLevel || 6;
    this.prefix = 'objects';
  }

  _key(hash) {
    return `${this.prefix}/${hash.slice(0, 2)}/${hash}`;
  }

  /** Does a chunk already exist in the store? */
  async has(hash) {
    return this.backend.exists(this._key(hash));
  }

  /**
   * Store a chunk if not already present (put-if-absent).
   * @returns {Promise<{stored: boolean, storedBytes: number}>}
   */
  async put(hash, buffer) {
    if (await this.has(hash)) {
      return { stored: false, storedBytes: 0 };
    }
    const payload = this.gzip ? await gzip(buffer, { level: this.gzipLevel }) : buffer;
    await this.backend.put(this._key(hash), payload);
    return { stored: true, storedBytes: payload.length };
  }

  /**
   * Fetch and verify a chunk by hash. Throws if the content does not match its
   * address (corruption / wrong object).
   * @returns {Promise<Buffer>}
   */
  async get(hash) {
    const raw = await this.backend.get(this._key(hash));
    const data =
      raw.length >= 2 && raw[0] === GZIP_MAGIC0 && raw[1] === GZIP_MAGIC1
        ? await gunzip(raw)
        : raw;
    const actual = crypto.createHash('sha256').update(data).digest('hex');
    if (actual !== hash) {
      throw new Error(`ObjectStore integrity error: expected ${hash}, got ${actual}`);
    }
    return data;
  }

  /** Delete a chunk by hash. */
  async delete(hash) {
    await this.backend.delete(this._key(hash));
  }

  /** List all chunk hashes currently in the store. */
  async listHashes() {
    const keys = await this.backend.list(`${this.prefix}/`);
    return keys.map((k) => k.split('/').pop());
  }
}

module.exports = ObjectStore;
