'use strict';

/*
 * Google sign-in: identity only. A session must survive being offline, must not
 * accept a token minted for another application, and must never carry backup
 * data or credentials.
 *
 * Run: node test/identity.test.js   (from the server directory)
 */

const assert = require('assert');
const http = require('http');

const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/MemoryStore');
const { verifyGoogleIdToken } = require('../src/identity');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([name, true]);
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push([name, false]);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

function googleResponse(claims) {
  return async () => ({ ok: true, json: async () => claims });
}

const validClaims = {
  iss: 'https://accounts.google.com',
  aud: 'client-a.apps.googleusercontent.com',
  sub: '1234567890',
  email: 'Owner@Example.com',
  email_verified: 'true',
  name: 'Owner',
  exp: Math.floor(Date.now() / 1000) + 3600,
};

async function request(server, method, path, body, token) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function main() {
  await check('accepts a valid Google token', async () => {
    const profile = await verifyGoogleIdToken('t', {
      clientIds: ['client-a.apps.googleusercontent.com'],
      fetchImpl: googleResponse(validClaims),
    });
    assert.strictEqual(profile.email, 'owner@example.com');
    assert.strictEqual(profile.subject, '1234567890');
  });

  await check('rejects a token issued for another application', async () => {
    await assert.rejects(
      verifyGoogleIdToken('t', {
        clientIds: ['client-a.apps.googleusercontent.com'],
        fetchImpl: googleResponse({ ...validClaims, aud: 'someone-else.apps.googleusercontent.com' }),
      }),
      /different application/
    );
  });

  await check('rejects an unverified email', async () => {
    await assert.rejects(
      verifyGoogleIdToken('t', { fetchImpl: googleResponse({ ...validClaims, email_verified: 'false' }) }),
      /not verified/
    );
  });

  await check('rejects an expired token', async () => {
    await assert.rejects(
      verifyGoogleIdToken('t', { fetchImpl: googleResponse({ ...validClaims, exp: Math.floor(Date.now() / 1000) - 10 }) }),
      /expired/
    );
  });

  await check('rejects a forged issuer', async () => {
    await assert.rejects(
      verifyGoogleIdToken('t', { fetchImpl: googleResponse({ ...validClaims, iss: 'evil.example.com' }) }),
      /issuer/
    );
  });

  // End-to-end through the HTTP API.
  const store = new MemoryStore();
  await store.init();
  const config = { ...loadConfig({ JWT_SECRET: 'test-secret' }), googleClientIds: [] };
  const app = createApp({
    config,
    store,
    verifyIdToken: async (idToken) => {
      if (idToken !== 'token') throw new Error('google rejected the sign-in token');
      return { subject: validClaims.sub, email: 'owner@example.com', name: 'Owner', picture: null };
    },
  });
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  let session = null;
  await check('sign-in creates a user and returns a session', async () => {
    const response = await request(server, 'POST', '/v1/auth/google', {
      idToken: 'token',
      device: { id: 'device-1', name: 'Reception PC', platform: 'win32', appVersion: '0.1.1' },
    });
    assert.strictEqual(response.status, 200);
    assert.ok(response.body.token, 'expected a session token');
    assert.strictEqual(response.body.user.email, 'owner@example.com');
    session = response.body.token;
  });

  await check('the session identifies the user and their devices', async () => {
    const response = await request(server, 'GET', '/v1/me', null, session);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.user.email, 'owner@example.com');
    assert.strictEqual(response.body.devices.length, 1);
    assert.strictEqual(response.body.devices[0].name, 'Reception PC');
  });

  await check('signing in again reuses the same user', async () => {
    await request(server, 'POST', '/v1/auth/google', {
      idToken: 'token',
      device: { id: 'device-2', name: 'Laptop', platform: 'win32' },
    });
    const response = await request(server, 'GET', '/v1/me', null, session);
    assert.strictEqual(response.body.user.id, 'google:1234567890');
    assert.strictEqual(response.body.devices.length, 2);
  });

  await check('rejects a request without a session', async () => {
    const response = await request(server, 'GET', '/v1/me', null, null);
    assert.strictEqual(response.status, 401);
  });

  await check('a tenant token cannot be used as a user session', async () => {
    const { issueToken } = require('../src/auth');
    const tenantToken = issueToken(config, { id: 'demo-tenant', planId: 'starter', status: 'active' });
    const response = await request(server, 'GET', '/v1/me', null, tenantToken);
    assert.strictEqual(response.status, 403);
  });

  await check('rejects an invalid sign-in token', async () => {
    const response = await request(server, 'POST', '/v1/auth/google', { idToken: 'forged' });
    assert.strictEqual(response.status, 401);
  });

  server.close();

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('IDENTITY TEST ERROR', error);
  process.exit(2);
});
