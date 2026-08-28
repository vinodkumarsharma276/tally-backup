'use strict';

/*
 * Repository identity: detects a destination that was emptied, deleted, or
 * swapped for a different location, instead of silently starting a new backup
 * history and re-uploading everything.
 *
 * Run: node test/repo-marker.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');

const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const { verifyRepository, acceptRepository, readMarker, MARKER_KEY } = require('../src/versioning/RepoMarker');

const ROOT = path.join(__dirname, '..', 'temp', 'repo-marker-e2e');
const STORE_A = path.join(ROOT, 'driveA');
const STORE_B = path.join(ROOT, 's3B');
const STATE = path.join(ROOT, 'repo-state.json');

async function main() {
  await fs.remove(ROOT);
  const results = [];
  const check = (name, cond) => {
    results.push([name, !!cond]);
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  };

  const a = new LocalFsBackend(STORE_A);
  const b = new LocalFsBackend(STORE_B);
  const opts = { profileName: 'primary', statePath: STATE };

  // 1. First ever use: create and remember the repository.
  const first = await verifyRepository({ backend: a, ...opts });
  check('first run creates a repository', first.status === 'created' && !!first.marker.id);
  check('marker written to the destination', !!(await readMarker(a)));

  // 2. Normal repeat run.
  const second = await verifyRepository({ backend: a, ...opts });
  check('repeat run recognises the same repository', second.status === 'ok');

  // 3. Destination emptied / folder deleted in the cloud.
  await fs.remove(path.join(STORE_A, MARKER_KEY));
  const deleted = await verifyRepository({ backend: a, ...opts });
  check('deleted repository is detected (not silently re-created)', deleted.status === 'missing');
  check('previous repository id is remembered', deleted.knownId === first.marker.id);

  // 4. Provider changed / profile recreated pointing somewhere else.
  await verifyRepository({ backend: b, profileName: 'other', statePath: STATE }); // seed B
  const swapped = await verifyRepository({ backend: b, ...opts });
  check('different destination is detected as a mismatch', swapped.status === 'mismatch');

  // 5. Explicit opt-in to start fresh (the --force-new-repository path).
  await acceptRepository({ backend: b, ...opts });
  const afterAccept = await verifyRepository({ backend: b, ...opts });
  check('accepting the new location clears the warning', afterAccept.status === 'ok');

  // 6. Adopting an existing repository made by another machine (new PC restore).
  const fresh = new LocalFsBackend(path.join(ROOT, 'existing'));
  await verifyRepository({ backend: fresh, profileName: 'seed', statePath: STATE });
  const adopted = await verifyRepository({ backend: fresh, profileName: 'newMachine', statePath: STATE });
  check('existing repository is adopted on a new machine', adopted.status === 'adopted');

  await fs.remove(ROOT);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('REPO MARKER ERROR', error);
  process.exit(2);
});
