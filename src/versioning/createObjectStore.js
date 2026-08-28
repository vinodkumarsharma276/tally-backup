'use strict';

const ObjectStore = require('./ObjectStore');
const PackedObjectStore = require('./PackedObjectStore');

/**
 * Selects the object-store layout for a storage profile.
 *
 * Packed mode bundles many chunks into a few large files. On Google Drive that
 * is the difference between ~12,000 API calls per backup and a few dozen, which
 * is what keeps a large backup under Drive's per-user rate limit.
 *
 * The layout cannot be changed once a repository holds data: a packed reader
 * cannot see loose `objects/` chunks and vice versa, so flipping it would both
 * re-upload everything and hide existing restore points. `resolveObjectStore`
 * therefore detects the layout already in use, and only applies the default to
 * a repository that is still empty.
 */

const PACKED_BY_DEFAULT = new Set(['google_drive', 'managed']);

function isPacked(profile = {}) {
  return profile.packed === true || PACKED_BY_DEFAULT.has(profile.type);
}

function buildStore(layout, backend, profile, opts) {
  const gzip = opts.gzip !== false;
  if (layout === 'packed') {
    return new PackedObjectStore(backend, {
      gzip,
      targetPackBytes: profile.targetPackBytes || opts.targetPackBytes,
    });
  }
  return new ObjectStore(backend, { gzip });
}

async function detectLayout(backend, profile = {}) {
  if (typeof profile.packed === 'boolean') return profile.packed ? 'packed' : 'objects';

  // Cheap: the pack index folder holds one small file per pack.
  const packIndexes = await backend.list('packs/idx').catch(() => []);
  if (packIndexes.length) return 'packed';

  // refs.json only exists once a snapshot has been written, so its presence
  // means this repository already committed to the loose-object layout.
  const hasHistory = await backend.exists('refs.json').catch(() => false);
  if (hasHistory) return 'objects';

  return isPacked(profile) ? 'packed' : 'objects';
}

/** Layout chosen from the profile alone; prefer resolveObjectStore. */
function createObjectStore(backend, profile = {}, opts = {}) {
  return buildStore(isPacked(profile) ? 'packed' : 'objects', backend, profile, opts);
}

/** Layout chosen from what the repository already contains. */
async function resolveObjectStore(backend, profile = {}, opts = {}) {
  return buildStore(await detectLayout(backend, profile), backend, profile, opts);
}

module.exports = { createObjectStore, resolveObjectStore, detectLayout, isPacked };
