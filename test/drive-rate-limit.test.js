'use strict';

/*
 * Google Drive throttling: the backend must recognise every shape Drive uses to
 * report a rate limit, and must not retry genuine failures.
 *
 * Run: node test/drive-rate-limit.test.js   (from the repo root)
 */

const assert = require('assert');
const GoogleDriveBackend = require('../src/versioning/backends/GoogleDriveBackend');

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

function backendWithFailures(errors) {
  let call = 0;
  const driveService = {
    drive: {},
    async apiCall(fn) {
      const failure = errors[call];
      call += 1;
      if (failure) throw failure;
      return fn();
    },
  };
  const backend = new GoogleDriveBackend(driveService, { rootFolderName: 'x' });
  return { backend, calls: () => call };
}

// The exact error from the failed run: prose message, no errors[] array.
const proseRateLimit = Object.assign(new Error('User rate limit exceeded.'), { code: 403 });
const reasonRateLimit = Object.assign(new Error('Rate Limit Exceeded'), {
  code: 403,
  errors: [{ reason: 'userRateLimitExceeded' }],
});
const gaxiosShape = Object.assign(new Error('Quota exceeded'), {
  response: { status: 429, data: { error: { status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded' }] } } },
});
const notFound = Object.assign(new Error('File not found'), { code: 404 });
const authFailure = new Error('Authentication token expired. Please run setup-auth.js to re-authenticate.');

async function main() {
  // Speed the backoff up so the test stays fast.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => realSetTimeout(fn, 0);

  const prose = backendWithFailures([proseRateLimit]);
  const proseResult = await prose.backend._retry(() => 'done');
  check('retries a prose "User rate limit exceeded." error', () => {
    assert.strictEqual(proseResult, 'done');
    assert.strictEqual(prose.calls(), 2);
  });

  const reason = backendWithFailures([reasonRateLimit, reasonRateLimit]);
  const reasonResult = await reason.backend._retry(() => 'done');
  check('retries an errors[].reason rate limit', () => {
    assert.strictEqual(reasonResult, 'done');
    assert.strictEqual(reason.calls(), 3);
  });

  const gaxios = backendWithFailures([gaxiosShape]);
  const gaxiosResult = await gaxios.backend._retry(() => 'done');
  check('retries a gaxios response.data.error shape', () => {
    assert.strictEqual(gaxiosResult, 'done');
    assert.strictEqual(gaxios.calls(), 2);
  });

  const missing = backendWithFailures([notFound]);
  let threw = null;
  try {
    await missing.backend._retry(() => 'done');
  } catch (error) {
    threw = error;
  }
  check('does not retry a genuine 404', () => {
    assert.strictEqual(threw, notFound);
    assert.strictEqual(missing.calls(), 1);
  });

  const auth = backendWithFailures([authFailure]);
  let authThrew = null;
  try {
    await auth.backend._retry(() => 'done');
  } catch (error) {
    authThrew = error;
  }
  check('does not retry an auth failure', () => {
    assert.strictEqual(authThrew, authFailure);
    assert.strictEqual(auth.calls(), 1);
  });

  // Sustained throttling must eventually surface rather than loop forever.
  const forever = backendWithFailures(Array(20).fill(proseRateLimit));
  let gaveUp = null;
  try {
    await forever.backend._retry(() => 'done');
  } catch (error) {
    gaveUp = error;
  }
  check('gives up after the retry budget', () => {
    assert.strictEqual(gaveUp, proseRateLimit);
    assert.strictEqual(forever.calls(), 9); // 1 initial + 8 retries
  });

  global.setTimeout = realSetTimeout;

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('RATE LIMIT TEST ERROR', error);
  process.exit(2);
});
