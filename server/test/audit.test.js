'use strict';

/*
 * Offline test of E6 hardening: audit logging of security-relevant actions and
 * JWT key rotation (tokens signed with the previous secret still verify).
 *
 * Run: node server/test/audit.test.js   (from the repo root)
 */

const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/MemoryStore');
const { createVendingProvider } = require('../src/vending');
const { createBillingProvider } = require('../src/billing');
const { MemoryAuditLog } = require('../src/audit');
const { issueToken, verifyToken } = require('../src/auth');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/seed');

const { ManagedControlPlaneClient } = require('../../src/versioning/ManagedControlPlaneClient');

async function main() {
  const config = loadConfig({
    STORE: 'memory',
    VENDING_PROVIDER: 'dev',
    BILLING_PROVIDER: 'dev',
    MANAGED_BUCKET: 'tally-managed-dev',
    MANAGED_REGION: 'us-east-1',
    NODE_ENV: 'test',
  });
  const store = new MemoryStore();
  await store.init();
  await seedDemo(store);
  const audit = new MemoryAuditLog();
  const app = createApp({
    config,
    store,
    vendingProvider: createVendingProvider(config),
    billingProvider: createBillingProvider(config),
    audit,
  });
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
    const client = new ManagedControlPlaneClient({ baseUrl: base, tenantId: 'demo-tenant', licenseKey: 'DEMO-LICENSE-KEY-123' });
    await client.getStorageLease();
    await client.reportUsage({ bytesStored: 1024, bytesUploaded: 512 });

    // Failed auth attempt.
    try {
      const bad = new ManagedControlPlaneClient({ baseUrl: base, tenantId: 'demo-tenant', licenseKey: 'WRONG' });
      await bad.getStorageLease();
    } catch { /* expected */ }

    const actions = audit.entries.map((e) => e.action);
    check('audit records auth.token granted', audit.entries.some((e) => e.action === 'auth.token' && e.outcome === 'granted'));
    check('audit records auth.token denied', audit.entries.some((e) => e.action === 'auth.token' && e.outcome === 'denied'));
    check('audit records credentials.vend', actions.includes('credentials.vend'));
    check('audit records usage.report', actions.includes('usage.report'));
    check('audit entries carry tenantId + timestamp', audit.entries.every((e) => e.ts && ('tenantId' in e)));

    // Key rotation: a token signed with the previous secret still verifies.
    const rotated = { ...config, jwtSecret: 'new-secret', jwtSecretPrevious: config.jwtSecret };
    const oldToken = issueToken(config, { id: 'demo-tenant', planId: 'pro', status: 'active' });
    const claims = verifyToken(rotated, oldToken);
    check('previous-secret token still verifies after rotation', claims.sub === 'demo-tenant');
    const newToken = issueToken(rotated, { id: 'demo-tenant', planId: 'pro', status: 'active' });
    check('new-secret token verifies', verifyToken(rotated, newToken).sub === 'demo-tenant');
    let retired = null;
    try { verifyToken({ ...config, jwtSecret: 'brand-new', jwtSecretPrevious: 'also-new' }, oldToken); } catch (e) { retired = e; }
    check('token rejected once both secrets rotated away', !!retired);
  } finally {
    server.close();
    await store.close();
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('AUDIT E2E ERROR', error);
  process.exit(2);
});
