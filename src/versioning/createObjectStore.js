'use strict';

const ObjectStore = require('./ObjectStore');
const PackedObjectStore = require('./PackedObjectStore');

/**
 * Selects the object-store layout for a storage profile. Packed mode (pack
 * files) is used when a profile opts in (`packed: true`) or for the managed
 * tier by default, to cut per-request costs. All other profiles keep the
 * one-object-per-chunk layout for backward compatibility.
 */
function isPacked(profile = {}) {
  return profile.packed === true || profile.type === 'managed';
}

function createObjectStore(backend, profile = {}, opts = {}) {
  const gzip = opts.gzip !== false;
  if (isPacked(profile)) {
    return new PackedObjectStore(backend, { gzip, targetPackBytes: profile.targetPackBytes || opts.targetPackBytes });
  }
  return new ObjectStore(backend, { gzip });
}

module.exports = { createObjectStore, isPacked };
