'use strict';

/*
 * Offline test of E3: metering reconciliation against a (fake) bucket inventory,
 * 80% warn threshold, 100% over-quota -> server-side read-only lease enforcement,
 * and the AWS-STS read-only session policy. No external services.
 *
 * Run: node server/test/quota.test.js   (from the repo root)
 */

const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/MemoryStore');
const { createVendingProvider } = require('../src/vending');
const { createBillingProvider } = require('../src/billing');
const { ReconciliationService } = require('../src/reconciliation');
const { AwsStsProvider } = require('../src/vending/AwsStsProvider');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/seed');

const { ManagedControlPlaneClient } = require('../../src/versioning/ManagedControlPlaneClient');

const GB = 1024 * 1024 * 1024;

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
  await seedDemo(store); // demo-tenant, plan pro (100 GB)
  const app = createApp({
    config,
    store,
    vendingProvider: createVendingProvider(config),
    billingProvider: createBillingProvider(config),
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

  // Fake bucket-inventory lister with a mutable byte count.
  let inventoryBytes = 0;
  const lister = { listTenantBytes: async () => inventoryBytes };
  const reconcile = new ReconciliationService({ store, lister, logger: { warn() {} } });

  const client = new ManagedControlPlaneClient({ baseUrl: base, tenantId: 'demo-tenant', licenseKey: 'DEMO-LICENSE-KEY-123' });

  try {
    // 1. Reconcile drift: inventory is authoritative.
    inventoryBytes = 40 * GB;
    const usage1 = await reconcile.reconcileTenant('demo-tenant');
    check('reconcile sets bytesStored from inventory', usage1.bytesStored === 40 * GB);
    check('40% is under warn threshold', usage1.warn === false && usage1.overQuota === false);
    const lease1 = await client.getStorageLease({ force: true });
    check('under quota lease is writable', lease1.writable === true && lease1.readOnly === false);

    // 2. Cross the 80% warn threshold.
    inventoryBytes = 85 * GB;
    const usage2 = await reconcile.reconcileTenant('demo-tenant');
    check('85% raises warn flag', usage2.warn === true && usage2.overQuota === false);
    const lease2 = await client.getStorageLease({ force: true });
    check('warn level still writable', lease2.writable === true && lease2.quota.warn === true);

    // 3. Exceed quota -> server vends a read-only lease.
    inventoryBytes = 120 * GB;
    const usage3 = await reconcile.reconcileTenant('demo-tenant');
    check('120% flagged overQuota', usage3.overQuota === true);
    const lease3 = await client.getStorageLease({ force: true });
    check('over-quota lease is read-only (enforced)', lease3.writable === false && lease3.readOnly === true);
    check('over-quota surfaced in lease.quota', lease3.quota.overQuota === true && lease3.quota.percent === 100);

    // 4. reconcileAll walks every tenant.
    inventoryBytes = 10 * GB;
    const all = await reconcile.reconcileAll();
    check('reconcileAll processes tenants', all.length === 1 && all[0].bytesStored === 10 * GB);

    // 5. AWS-STS read-only session policy excludes writes.
    const sts = new AwsStsProvider(config);
    const rwPolicy = sts._sessionPolicy('tenants/demo-tenant', false);
    const roPolicy = sts._sessionPolicy('tenants/demo-tenant', true);
    check('read-write policy allows PutObject', /s3:PutObject/.test(rwPolicy));
    check('read-only policy denies PutObject/DeleteObject', !/s3:PutObject/.test(roPolicy) && !/s3:DeleteObject/.test(roPolicy) && /s3:GetObject/.test(roPolicy));
  } finally {
    server.close();
    await store.close();
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('QUOTA E2E ERROR', error);
  process.exit(2);
});
