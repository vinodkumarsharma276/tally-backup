'use strict';

/*
 * Resolves the OAuth *client* (application) credentials used to talk to Google.
 *
 * For a distributed desktop application, the OAuth client_id / client_secret are
 * NOT confidential the way a server secret is — Google's installed-app model
 * explicitly treats them as public, because they are shipped inside the binary.
 * This lets every customer authorise their OWN Google account without creating a
 * Google Cloud project themselves.
 *
 * Resolution order (first match wins):
 *   1. Environment variables TALLY_GOOGLE_CLIENT_ID / TALLY_GOOGLE_CLIENT_SECRET
 *      (useful for CI, and for overriding the bundled client during testing).
 *   2. A bundled client file `google-oauth-client.json`, looked up next to the
 *      app source and in the packaged resources directory. This file is
 *      git-ignored and injected at build time so real credentials never land in
 *      source control.
 *
 * The file may be in either the raw Google download shape ({ "installed": {...} }
 * or { "web": {...} }) or a flat { client_id, client_secret } object.
 */

const fs = require('fs-extra');
const path = require('path');

function normalize(node, source) {
  if (!node) return null;
  const clientId = node.client_id || node.clientId;
  const clientSecret = node.client_secret || node.clientSecret;
  if (!clientId || !clientSecret) return null;
  return { client_id: clientId, client_secret: clientSecret, source };
}

function fromFile(file) {
  try {
    if (!file || !fs.pathExistsSync(file)) return null;
    const raw = fs.readJsonSync(file);
    return normalize(raw.installed || raw.web || raw, file);
  } catch (error) {
    return null;
  }
}

function candidateFiles() {
  const files = [];
  // Development / packaged: <appRoot>/config/google-oauth-client.json
  files.push(path.join(__dirname, '..', '..', 'config', 'google-oauth-client.json'));
  // Packaged via electron-builder extraResources
  if (process.resourcesPath) {
    files.push(path.join(process.resourcesPath, 'google-oauth-client.json'));
    files.push(path.join(process.resourcesPath, 'app', 'config', 'google-oauth-client.json'));
  }
  return files;
}

/**
 * Return the bundled/default OAuth client credentials, or null when none are
 * configured (in which case the app requires a per-customer credentials file).
 * @returns {{ client_id: string, client_secret: string, source: string } | null}
 */
function loadDefaultOAuthClient() {
  const envId = process.env.TALLY_GOOGLE_CLIENT_ID;
  const envSecret = process.env.TALLY_GOOGLE_CLIENT_SECRET;
  if (envId && envSecret) {
    return { client_id: envId, client_secret: envSecret, source: 'env' };
  }
  for (const file of candidateFiles()) {
    const resolved = fromFile(file);
    if (resolved) return resolved;
  }
  return null;
}

module.exports = { loadDefaultOAuthClient };
