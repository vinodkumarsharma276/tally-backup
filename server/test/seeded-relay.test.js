'use strict';

/*
 * Offline test of the report-email relay for a real install: a tenant declared
 * via SEED_TENANTS authenticates and sends a backup report to the recipients the
 * customer configured in their own app. Nothing is read from repo config.
 *
 * Run: node server/test/seeded-relay.test.js   (from the repo root)
 */

const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/MemoryStore');
const { createVendingProvider } = require('../src/vending');
const { DevMailer } = require('../src/mailer');
const { createApp } = require('../src/app');
const { seedConfiguredTenants } = require('../src/seed');

const { sendReport } = require('../../src/utils/reportEmail');

async function main() {
  const config = loadConfig({
    NODE_ENV: 'production',
    STORE: 'memory',
    VENDING_PROVIDER: 'dev',
    MAILER_PROVIDER: 'dev',
    MAILER_FROM: 'Backup Genie <vinodelectronics1994@gmail.com>',
    SEED_TENANTS: JSON.stringify([
      { id: 'install-001', licenseKey: 'INSTALL-001-KEY', planId: 'starter', email: 'owner@example.com' },
    ]),
  });
  const store = new MemoryStore();
  await store.init();
  const seeded = await seedConfiguredTenants(store, config);

  const mailer = new DevMailer(config);
  const app = createApp({ config, store, vendingProvider: createVendingProvider(config), billingProvider: null, mailer });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const results = [];
  const check = (name, cond) => { results.push([name, !!cond]); console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };

  try {
    check('tenant seeded in production', seeded.length === 1 && seeded[0] === 'install-001');
    check('demo tenant is NOT seeded in production', !(await store.authenticateTenant('demo-tenant', 'DEMO-LICENSE-KEY-123')));

    // The customer's own config: recipients they typed into their installed app.
    const customerConfig = {
      email: {
        enabled: true,
        mode: 'company',
        to: ['vinodkhoraa@example.com', 'owner@example.com'],
        subject: 'Backup Genie Report',
        relay: { controlPlaneUrl: base, tenantId: 'install-001', licenseKey: 'INSTALL-001-KEY' },
      },
      storageProfiles: {},
    };

    await sendReport({
      config: customerConfig,
      status: 'success',
      result: { totalFilesProcessed: 42, totalBytes: 9_000_000, totalNewBytes: 1_200_000, totalChunks: 60, totalNewChunks: 9, duration: 4000, sources: [], driveLinks: [] },
    });

    check('one email per configured recipient', mailer.sent.length === 2);
    check('delivered to the customer addresses', mailer.sent.map((m) => m.to).sort().join(',') === 'owner@example.com,vinodkhoraa@example.com');
    check('sent from the company address', mailer.sent.every((m) => m.from === 'Backup Genie <vinodelectronics1994@gmail.com>'));
    check('subject reflects success', /Backup successful/.test(mailer.sent[0].subject));

    // A wrong licence key must not be able to relay mail through us.
    const before = mailer.sent.length;
    await sendReport({
      config: { ...customerConfig, email: { ...customerConfig.email, relay: { controlPlaneUrl: base, tenantId: 'install-001', licenseKey: 'WRONG-KEY' } } },
      status: 'success',
      result: { totalFilesProcessed: 1, totalBytes: 1, totalNewBytes: 1, totalChunks: 1, totalNewChunks: 1, duration: 1, sources: [], driveLinks: [] },
    });
    check('bad licence key cannot relay', mailer.sent.length === before);
  } finally {
    server.close();
    await store.close();
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error('SEEDED RELAY TEST ERROR', error); process.exit(2); });
