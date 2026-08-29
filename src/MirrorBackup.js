'use strict';

const path = require('path');
const fs = require('fs-extra');

/**
 * MirrorBackup — a plain, browsable copy of a folder.
 *
 * Unlike the versioned engine there are no chunks and no restore points: the
 * destination is an ordinary folder you can open directly. Files are copied
 * only when missing or changed (size or modified time), so repeat runs are
 * cheap. Because it keeps no history it cannot recover an earlier version of a
 * file, and a deletion or corruption in the source reaches the copy on the next
 * run — that trade-off is the point of offering both modes.
 */
class MirrorBackup {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  static _isInside(child, parent) {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  /** Refuses destinations that would copy a folder into itself. */
  static assertSafePair(sourceDir, destDir) {
    if (MirrorBackup._isInside(destDir, sourceDir)) {
      throw new Error(
        `The copy destination is inside the folder being copied (${destDir}). Choose a folder outside ${sourceDir}.`
      );
    }
    if (MirrorBackup._isInside(sourceDir, destDir)) {
      throw new Error(
        `The folder being copied is inside the destination (${sourceDir}). Choose a different destination.`
      );
    }
  }

  async _walk(root, base = '') {
    const out = [];
    const entries = await fs.readdir(path.join(root, base), { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? path.join(base, entry.name) : entry.name;
      if (entry.isDirectory()) out.push(...(await this._walk(root, rel)));
      else if (entry.isFile()) out.push(rel);
    }
    return out;
  }

  static async _needsCopy(sourcePath, destPath) {
    const target = await fs.stat(destPath).catch(() => null);
    if (!target) return true;
    const origin = await fs.stat(sourcePath);
    // Whole seconds: some filesystems store coarser timestamps than others.
    return origin.size !== target.size || Math.floor(origin.mtimeMs / 1000) !== Math.floor(target.mtimeMs / 1000);
  }

  /**
   * @param {Array<string|{path:string,label:string}>} folders Source folders.
   * @param {string} destRoot Destination folder.
   * @param {object} [opts]
   * @param {boolean} [opts.prune=false] Delete files at the destination that no
   *   longer exist in the source. Off by default: a mirror that deletes can
   *   erase the only remaining copy of a file.
   */
  async run(folders, destRoot, { onProgress, prune = false } = {}) {
    const list = (Array.isArray(folders) ? folders : [folders]).filter(Boolean);
    if (list.length === 0) throw new Error('No source folder was provided.');

    const roots = [];
    const used = new Set();
    for (const item of list) {
      const root = path.resolve(typeof item === 'string' ? item : item.path);
      let namespace = list.length > 1 ? (typeof item === 'string' ? path.basename(root) : item.label || path.basename(root)) : '';
      if (namespace) {
        let candidate = namespace;
        let n = 2;
        while (used.has(candidate)) candidate = `${namespace}-${n++}`;
        used.add(candidate);
        namespace = candidate;
      }
      MirrorBackup.assertSafePair(root, destRoot);
      roots.push({ root, namespace });
    }

    const started = Date.now();
    const stats = { fileCount: 0, copiedFiles: 0, skippedFiles: 0, copiedBytes: 0, totalBytes: 0, deletedFiles: 0 };
    const keep = new Set();

    for (const { root, namespace } of roots) {
      if (!(await fs.pathExists(root))) throw new Error(`Folder to copy was not found: ${root}`);
      const files = await this._walk(root);
      for (const rel of files) {
        const sourcePath = path.join(root, rel);
        const relKey = namespace ? path.join(namespace, rel) : rel;
        const destPath = path.join(destRoot, relKey);
        keep.add(path.resolve(destPath));

        const size = (await fs.stat(sourcePath)).size;
        stats.fileCount += 1;
        stats.totalBytes += size;

        if (await MirrorBackup._needsCopy(sourcePath, destPath)) {
          await fs.ensureDir(path.dirname(destPath));
          await fs.copy(sourcePath, destPath, { preserveTimestamps: true, overwrite: true });
          stats.copiedFiles += 1;
          stats.copiedBytes += size;
        } else {
          stats.skippedFiles += 1;
        }

        if (onProgress) {
          onProgress({
            phase: 'mirror',
            filesDone: stats.copiedFiles + stats.skippedFiles,
            fileCount: stats.fileCount,
            processedBytes: stats.copiedBytes,
            totalBytes: stats.totalBytes,
            elapsedMs: Date.now() - started,
          });
        }
      }
    }

    if (prune && (await fs.pathExists(destRoot))) {
      for (const rel of await this._walk(destRoot)) {
        const full = path.resolve(path.join(destRoot, rel));
        if (!keep.has(full)) {
          await fs.remove(full);
          stats.deletedFiles += 1;
        }
      }
    }

    stats.durationMs = Date.now() - started;
    return stats;
  }
}

module.exports = MirrorBackup;
