'use strict';

/*
 * Offline end-to-end test of the managed-storage foundation (E1 + E2).
 * Boots the control plane (memory store + dev vending provider) on an ephemeral
 * port and drives it with the real desktop ManagedControlPlaneClient and backend
 * factory. No cloud accounts or network required.
 *
 * Run: node server/test/e2e.js   (from the repo root)
 */

const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/MemoryStore');
const { createVendingProvider } = require('../src/vending');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/seed');

const { ManagedControlPlaneClient } = require('../../src/versioning/ManagedControlPlaneClient');
const { createBackend } = require('../../src/versioning/backends');
const S3Backend = require('../../src/versioning/backends/S3Backend');

const GB = 1024 * 1024 * 1024;

async function main() {
  const config = loadConfig({
    VENDING_PROVIDER: 'dev',
    STORE: 'memory',
    LEASE_TTL_SECONDS: '3600',
    VENDING_MASTER_SECRET: 'test-master',
    MANAGED_BUCKET: 'tally-managed-dev',
    MANAGED_REGION: 'us-east-1',
    NODE_ENV: 'test',
  });
  const store = new MemoryStore();
  await store.init();
  await seedDemo(store);
  const app = createApp({ config, store, vendingProvider: createVendingProvider(config) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const results = [];
  const check = (name, cond) => {
    results.push([name, !!cond]);
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  };

  try {
    const client = new ManagedControlPlaneClient({
      baseUrl: base,
      tenantId: 'demo-tenant',
      licenseKey: 'DEMO-LICENSE-KEY-123',
    });

    const lease = await client.getStorageLease();
    check('lease prefix scoped to tenant', lease.prefix === 'tenants/demo-tenant');
    check('lease returns credentials', !!(lease.credentials && lease.credentials.accessKeyId && lease.credentials.secretAccessKey));
    check('lease expiry in the future', new Date(lease.expiresAt).getTime() > Date.now());
    check('active tenant is writable', lease.writable === true);
    check('lease is s3 provider', lease.provider === 's3');

    let badErr = null;
    try {
      const bad = new ManagedControlPlaneClient({ baseUrl: base, tenantId: 'demo-tenant', licenseKey: 'WRONG-KEY' });
      await bad.getStorageLease();
    } catch (error) { badErr = error; }
    check('invalid license rejected (401)', badErr && badErr.status === 401);

    const creds = await client.getAwsCredentials();
    check('aws credential provider yields expiration Date', creds.expiration instanceof Date);
    const forced = await client.getStorageLease({ force: true });
    check('forced lease refresh works', !!(forced.credentials && forced.credentials.accessKeyId));

    await client.reportUsage({ bytesStored: 10 * GB, bytesUploaded: 2 * GB });
    const usage = await client.getUsage();
    check('metering records bytesStored', usage.bytesStored === 10 * GB);
    check('quota percent computed (pro=100GB -> ~10%)', usage.percent > 9 && usage.percent < 11);

    await client.reportUsage({ bytesStored: 200 * GB });
    const overLease = await client.getStorageLease({ force: true });
    check('over-quota lease is read-only', overLease.writable === false);

    await store.upsertTenant({ id: 'demo-tenant', status: 'suspended' });
    let suspErr = null;
    try { await client.getStorageLease({ force: true }); } catch (error) { suspErr = error; }
    check('suspended subscription returns 402', suspErr && suspErr.status === 402);

    // Factory builds a scoped S3Backend from a managed profile (no network I/O).
    await store.upsertTenant({ id: 'demo-tenant', status: 'active', bytesStored: 0 });
    const origInit = S3Backend.prototype.init;
    S3Backend.prototype.init = async function noop() { this.knownKeys = new Set(); };
    try {
      const managedConfig = {
        storageProfiles: {
          'managed-test': { type: 'managed', controlPlaneUrl: base, tenantId: 'demo-tenant', licenseKey: 'DEMO-LICENSE-KEY-123' },
        },
      };
      const built = await createBackend({ config: managedConfig, source: { storageProfile: 'managed-test' } });
      check('factory builds S3Backend for managed', built.backend instanceof S3Backend);
      check('factory uses managed bucket', built.backend.bucket === 'tally-managed-dev');
      check('factory scopes to tenant prefix', built.backend.prefix === 'tenants/demo-tenant');
      check('managed storage label', built.storageLabel === 'managed://demo-tenant');
      check('factory exposes control-plane client', !!built.controlPlane);
    } finally {
      S3Backend.prototype.init = origInit;
    }
  } finally {
    server.close();
    await store.close();
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('E2E ERROR', error);
  process.exit(2);
});
