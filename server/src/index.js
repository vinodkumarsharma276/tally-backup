'use strict';

try { require('dotenv').config(); } catch { /* dotenv optional */ }

const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { createVendingProvider } = require('./vending');
const { createBillingProvider } = require('./billing');
const { createUsageLister, ReconciliationService } = require('./reconciliation');
const { createAuditLog } = require('./audit');
const { createMailer } = require('./mailer');
const { createApp } = require('./app');
const { seedDemo } = require('./seed');

async function main() {
  const config = loadConfig();
  const store = await createStore(config);
  if (config.nodeEnv !== 'production') {
    await seedDemo(store);
  }
  const vendingProvider = createVendingProvider(config);
  const billingProvider = createBillingProvider(config);
  const audit = createAuditLog(config);
  const mailer = createMailer(config);
  const app = createApp({ config, store, vendingProvider, billingProvider, audit, mailer });

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[control-plane] listening on :${config.port} ` +
      `(store=${config.store}, vending=${config.vendingProvider}, billing=${config.billing.provider}, env=${config.nodeEnv})`
    );
  });

  // Sweep grace periods -> suspended hourly.
  const graceSweep = setInterval(() => {
    Promise.resolve(store.expireGracePeriods(Date.now())).catch(() => {});
  }, 60 * 60 * 1000);
  graceSweep.unref();

  // Optional metering reconciliation against the bucket inventory.
  const lister = createUsageLister(config);
  let reconcileTimer = null;
  if (lister && config.reconciliation.intervalMinutes > 0) {
    const service = new ReconciliationService({ store, lister });
    reconcileTimer = setInterval(() => {
      service.reconcileAll().catch((error) => console.error('[reconcile] failed:', error.message));
    }, config.reconciliation.intervalMinutes * 60 * 1000);
    reconcileTimer.unref();
    console.log(`[control-plane] reconciliation every ${config.reconciliation.intervalMinutes}m (${config.reconciliation.provider})`);
  }

  const shutdown = async () => {
    clearInterval(graceSweep);
    if (reconcileTimer) clearInterval(reconcileTimer);
    server.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[control-plane] failed to start:', error);
    process.exit(1);
  });
}

module.exports = { main };
