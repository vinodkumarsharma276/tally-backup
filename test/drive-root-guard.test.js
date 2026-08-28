'use strict';

/*
 * The Drive root guard must accept everything the versioned store itself
 * writes, and still refuse a folder holding unrelated content. The allow-list
 * has drifted before (it predated repo.json and the packed layout), so it is
 * checked against the names the store actually uses.
 *
 * Run: node test/drive-root-guard.test.js   (from the repo root)
 */

const assert = require('assert');
const GoogleDriveBackend = require('../src/versioning/backends/GoogleDriveBackend');
const { MARKER_KEY } = require('../src/versioning/RepoMarker');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push([name, true]);
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push([name, false]);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function backendWith(names, opts = {}) {
  const backend = new GoogleDriveBackend({ drive: {} }, { rootFolderName: 'store', ...opts });
  backend.rootFolderId = 'root';
  backend._listFolder = async () =>
    new Map(names.map((name) => [name, { id: name, mimeType: name.includes('.') ? 'text/plain' : FOLDER_MIME }]));
  return backend;
}

async function guardError(names, opts) {
  try {
    await backendWith(names, opts)._guardNotAMirror();
    return null;
  } catch (error) {
    return error;
  }
}

async function main() {
  check('repo.json marker key is what the guard expects', () => {
    assert.strictEqual(MARKER_KEY, 'repo.json');
  });

  const loose = await guardError(['objects', 'snapshots', 'refs.json']);
  check('accepts a loose-object repository', () => assert.strictEqual(loose, null));

  // The failure reported from a real run.
  const marked = await guardError(['objects', 'snapshots', 'refs.json', 'repo.json']);
  check('accepts a repository with the identity marker', () => assert.strictEqual(marked, null));

  const packed = await guardError(['packs', 'snapshots', 'refs.json', 'repo.json']);
  check('accepts a packed repository', () => assert.strictEqual(packed, null));

  const markerOnly = await guardError(['repo.json']);
  check('accepts a freshly initialised repository', () => assert.strictEqual(markerOnly, null));

  const mirror = await guardError(['DATA', 'VHA', 'TDL']);
  check('still refuses a legacy mirror folder', () => {
    assert.ok(mirror, 'expected the guard to throw');
    assert.match(mirror.message, /non-versioned content \(DATA, VHA, TDL\)/);
  });

  const mixed = await guardError(['objects', 'refs.json', 'Holiday photos']);
  check('still refuses a folder with unrelated files', () => {
    assert.ok(mixed, 'expected the guard to throw');
    assert.match(mixed.message, /Holiday photos/);
  });

  const overridden = await guardError(['DATA', 'VHA'], { allowMixed: true });
  check('allowMixed still overrides the guard', () => assert.strictEqual(overridden, null));

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('GUARD TEST ERROR', error);
  process.exit(2);
});
