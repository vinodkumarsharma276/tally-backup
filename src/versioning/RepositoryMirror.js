'use strict';

// Everything a repository consists of. Data objects are immutable and content
// addressed; the pointer files change every run and must be copied last, so a
// mirror never claims a snapshot whose chunks have not arrived yet.
const DATA_PREFIXES = ['objects', 'packs', 'snapshots'];
const POINTER_FILES = ['refs.json', 'repo.json'];

async function listRepositoryKeys(backend) {
  const keys = [];
  for (const prefix of DATA_PREFIXES) {
    keys.push(...(await backend.list(prefix).catch(() => [])));
  }
  return keys;
}

/**
 * Copies a repository onto another backend, skipping objects already present.
 * Used to bring an additional destination up to date without re-reading and
 * re-chunking the original files.
 */
async function mirrorRepository({ from, to, onProgress, logger }) {
  const dataKeys = await listRepositoryKeys(from);
  const stats = { copied: 0, skipped: 0, bytes: 0, total: dataKeys.length };

  for (const key of dataKeys) {
    if (await to.exists(key).catch(() => false)) {
      stats.skipped += 1;
    } else {
      const buffer = await from.get(key);
      await to.put(key, buffer);
      stats.copied += 1;
      stats.bytes += buffer.length;
    }
    if (onProgress) {
      onProgress({
        phase: 'mirror',
        processed: stats.copied + stats.skipped,
        total: stats.total,
        bytes: stats.bytes,
      });
    }
  }

  for (const key of POINTER_FILES) {
    if (!(await from.exists(key).catch(() => false))) continue;
    await to.put(key, await from.get(key));
  }

  if (logger) {
    logger.info(
      `Mirror complete: ${stats.copied} object(s) copied, ${stats.skipped} already present.`
    );
  }
  return stats;
}

module.exports = { mirrorRepository, listRepositoryKeys, DATA_PREFIXES, POINTER_FILES };
