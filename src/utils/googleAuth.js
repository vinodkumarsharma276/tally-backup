'use strict';

const { hasSecret } = require('./SecretStore');

/**
 * Google account resolution per storage profile.
 *
 * The app originally kept a single Google token shared by every Drive profile,
 * which meant two profiles named after two different Google accounts silently
 * wrote to the same Drive. A profile now gets its own token, stored beside the
 * shared one under a derived name. Profiles that were never reconnected keep
 * using the shared token, so existing setups continue to work.
 */

function slug(value) {
  return String(value || '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function sharedTokenRef(config) {
  return (config && config.googleDrive && config.googleDrive.tokenPath) || '';
}

/** Where this profile's own token lives, or null when tokens are file-based. */
function profileTokenRef(config, profileName) {
  const base = String(sharedTokenRef(config));
  if (!profileName || !base.startsWith('secret:')) return null;
  return `${base}.${slug(profileName)}`;
}

/** The googleDrive config a profile should use for reading its account. */
async function googleConfigFor(config, profileName) {
  const base = (config && config.googleDrive) || {};
  const ref = profileTokenRef(config, profileName);
  if (ref && (await hasSecret(ref))) return { ...base, tokenPath: ref };
  return base;
}

/** Where "Connect Google" should write the token for this profile. */
function connectTokenRef(config, profileName) {
  return profileTokenRef(config, profileName) || sharedTokenRef(config);
}

/** True when the profile has its own account rather than the shared one. */
async function hasOwnAccount(config, profileName) {
  const ref = profileTokenRef(config, profileName);
  return !!ref && (await hasSecret(ref));
}

module.exports = { googleConfigFor, connectTokenRef, profileTokenRef, hasOwnAccount };
