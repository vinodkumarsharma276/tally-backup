'use strict';

const fs = require('fs-extra');
const path = require('path');

/**
 * LocalFsBackend — a storage backend that stores keyed objects on the local
 * filesystem. Implements the minimal backend interface consumed by ObjectStore
 * and SnapshotStore:
 *
 *   exists(key) -> Promise<boolean>
 *   put(key, buffer) -> Promise<void>
 *   get(key) -> Promise<Buffer>
 *   list(prefix) -> Promise<string[]>   // keys (posix) under prefix
 *   delete(key) -> Promise<void>
 *
 * Keys are always posix-style relative paths, e.g. "objects/ab/abcd...",
 * "snapshots/2026-...json", "refs.json". A future GoogleDriveBackend will
 * implement the same interface so the engine is storage-agnostic.
 */
class LocalFsBackend {
  /**
   * @param {string} rootDir Absolute path to the store root.
   */
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  _toPath(key) {
    return path.join(this.rootDir, ...key.split('/'));
  }

  async exists(key) {
    return fs.pathExists(this._toPath(key));
  }

  async put(key, buffer) {
    const p = this._toPath(key);
    await fs.ensureDir(path.dirname(p));
    // atomic-ish write: temp then rename
    const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, buffer);
    await fs.move(tmp, p, { overwrite: true });
  }

  async get(key) {
    return fs.readFile(this._toPath(key));
  }

  async delete(key) {
    await fs.remove(this._toPath(key));
  }

  /**
   * List all object keys (posix) below `prefix`. Returns [] if prefix missing.
   */
  async list(prefix) {
    const base = this._toPath(prefix);
    if (!(await fs.pathExists(base))) return [];
    const out = [];
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) {
          const rel = path.relative(this.rootDir, full).split(path.sep).join('/');
          out.push(rel);
        }
      }
    };
    const stat = await fs.stat(base);
    if (stat.isDirectory()) await walk(base);
    else out.push(prefix);
    return out;
  }
}

module.exports = LocalFsBackend;
