'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');

/**
 * Identity marker for a backup repository.
 *
 * A repository writes `repo.json` (a stable UUID) at its root the first time it
 * is used. The client remembers which UUID each storage profile pointed at, so a
 * later run can tell the difference between "same repository as before" and
 * "this location is empty or now holds something else" — the cases that would
 * otherwise silently discard every restore point and re-upload everything.
 */

const MARKER_KEY = 'repo.json';
const FORMAT_VERSION = 1;

async function readMarker(backend) {
  if (!(await backend.exists(MARKER_KEY))) return null;
  try {
    const raw = await backend.get(MARKER_KEY);
    const marker = JSON.parse(raw.toString('utf8'));
    return marker && marker.id ? marker : null;
  } catch {
    return null;
  }
}

async function createMarker(backend, { label } = {}) {
  const marker = {
    id: crypto.randomUUID(),
    version: FORMAT_VERSION,
    app: 'Backup Genie',
    label: label || undefined,
    createdAt: new Date().toISOString(),
  };
  await backend.put(MARKER_KEY, Buffer.from(JSON.stringify(marker, null, 2)));
  return marker;
}

async function readState(statePath) {
  try {
    return (await fs.readJson(statePath)) || {};
  } catch {
    return {};
  }
}

async function writeState(statePath, state) {
  await fs.ensureDir(path.dirname(statePath));
  await fs.writeJson(statePath, state, { spaces: 2 });
}

/**
 * Compare the repository at `backend` with the one this profile used last time.
 * @returns {Promise<{status:'created'|'adopted'|'ok'|'missing'|'mismatch', marker:object|null, knownId:string|null}>}
 */
async function verifyRepository({ backend, profileName, statePath, adopt = true }) {
  const state = await readState(statePath);
  const knownId = state[profileName] || null;
  const marker = await readMarker(backend);

  if (!marker) {
    if (knownId) return { status: 'missing', marker: null, knownId };
    const created = await createMarker(backend, { label: profileName });
    if (adopt) {
      state[profileName] = created.id;
      await writeState(statePath, state);
    }
    return { status: 'created', marker: created, knownId: null };
  }

  if (!knownId) {
    if (adopt) {
      state[profileName] = marker.id;
      await writeState(statePath, state);
    }
    return { status: 'adopted', marker, knownId: null };
  }

  if (marker.id !== knownId) return { status: 'mismatch', marker, knownId };
  return { status: 'ok', marker, knownId };
}

/** Accept the repository currently at this location as the profile's new one. */
async function acceptRepository({ backend, profileName, statePath }) {
  const marker = (await readMarker(backend)) || (await createMarker(backend, { label: profileName }));
  const state = await readState(statePath);
  state[profileName] = marker.id;
  await writeState(statePath, state);
  return marker;
}

module.exports = { MARKER_KEY, readMarker, createMarker, verifyRepository, acceptRepository };
