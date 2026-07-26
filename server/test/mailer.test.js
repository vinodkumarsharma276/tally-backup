'use strict';

/*
 * Offline test of the company email relay: the app asks the control plane to
 * send a report FROM the company address to the customer's recipient, with no
 * email credentials on the client. Uses the dev mailer (no external service).
 *
 * Run: node server/test/mailer.test.js   (from the repo root)
 */

const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/MemoryStore');
const { createVendingProvider } = require('../src/vending');
const { createBillingProvider } = require('../src/billing');
const { DevMailer } = require('../src/mailer');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/seed');

const { ManagedControlPlaneClient } = require('../../src/versioning/ManagedControlPlaneClient');

async function main() {
  const config = loadConfig({
    STORE: 'memory',
    VENDING_PROVIDER: 'dev',
    BILLING_PROVIDER: 'dev',
    MAILER_PROVIDER: 'dev',
    MAILER_FROM: 'Backup Genie <no-reply@backupgenie.app>',
    NODE_ENV: 'test',
  });
  const store = new MemoryStore();
  await store.init();
  await seedDemo(store);
  const mailer = new DevMailer(config);
  const app = createApp({
    config,
    store,
    vendingProvider: createVendingProvider(config),
    billingProvider: createBillingProvider(config),
    mailer,
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

    const result = await client.sendEmailReport({
      to: 'customer@example.com',
      subject: 'Backup Genie Report — Backup successful',
      html: '<h1>Backup complete</h1>',
    });
    check('relay accepts and sends', result.ok === true && result.provider === 'dev');
    check('sent from company address', mailer.sent.length === 1 && mailer.sent[0].from === 'Backup Genie <no-reply@backupgenie.app>');
    check('sent to customer recipient', mailer.sent[0].to === 'customer@example.com');

    // Validation: bad recipient rejected.
    let badErr = null;
    try { await client.sendEmailReport({ to: 'not-an-email', subject: 's', html: '<p>x</p>' }); } catch (error) { badErr = error; }
    check('invalid recipient rejected (400)', badErr && badErr.status === 400);

    // Auth required.
    let authErr = null;
    try {
      const resp = await fetch(`${base}/v1/notify/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }),
      });
      authErr = resp.status;
    } catch { authErr = null; }
    check('unauthenticated send rejected (401)', authErr === 401);

    // Full desktop path: sendReport renders + relays a real backup report.
    const { sendReport } = require('../../src/utils/reportEmail');
    const before = mailer.sent.length;
    await sendReport({
      config: {
        email: { enabled: true, mode: 'company', to: 'owner@example.com', subject: 'Backup Genie Report', relay: { controlPlaneUrl: base, tenantId: 'demo-tenant', licenseKey: 'DEMO-LICENSE-KEY-123' } },
        storageProfiles: {},
      },
      status: 'success',
      result: { totalFilesProcessed: 12, totalBytes: 5_000_000, totalNewBytes: 1_000_000, totalChunks: 40, totalNewChunks: 8, duration: 2000, sources: [], driveLinks: [] },
    });
    const relayed = mailer.sent[mailer.sent.length - 1];
    check('sendReport relays a rendered report', mailer.sent.length === before + 1 && relayed.to === 'owner@example.com');
    check('report subject reflects success', /Backup successful/.test(relayed.subject));
    check('report html is versioned template', /Deduplication saved|restore point/i.test(relayed.html));
  } finally {
    server.close();
    await store.close();
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('MAILER E2E ERROR', error);
  process.exit(2);
});
