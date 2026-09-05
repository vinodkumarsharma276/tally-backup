'use strict';

try { require('dotenv').config(); } catch { /* dotenv optional */ }

const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { createVendingProvider } = require('./vending');
const { createBillingProvider } = require('./billing');
const { createUsageLister, ReconciliationService } = require('./reconciliation');
const { createAuditLog } = require('./audit');
const { createMailer } = require('./mailer');
const { createEnquiryStore } = require('./contact');
const { createApp } = require('./app');
const { seedDemo, seedConfiguredTenants } = require('./seed');

async function main() {
  const config = loadConfig();
  const store = await createStore(config);
  if (config.nodeEnv !== 'production') {
    await seedDemo(store);
  }
  // Declared tenants are seeded in every environment, including production.
  const seededTenants = await seedConfiguredTenants(store, config);
  if (seededTenants.length) {
    console.log(`[control-plane] seeded ${seededTenants.length} tenant(s): ${seededTenants.join(', ')}`);
  }
  const vendingProvider = createVendingProvider(config);
  const billingProvider = createBillingProvider(config);
  const audit = createAuditLog(config);
  const mailer = createMailer(config);
  const enquiryStore = createEnquiryStore(config);
  const app = createApp({ config, store, vendingProvider, billingProvider, audit, mailer, enquiryStore });

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[control-plane] listening on :${config.port} ` +
      `(store=${config.store}, vending=${config.vendingProvider}, billing=${config.billing.provider}, ` +
      `enquiries=${enquiryStore ? enquiryStore.name : 'none'}, env=${config.nodeEnv})`
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

  // Cloud Run (and most orchestrators) send SIGTERM, then SIGKILL ~10s later.
  // Draining in-flight requests first avoids resetting a backup mid-vend.
  const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS || 8000);
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[control-plane] ${signal} received, draining connections`);
    clearInterval(graceSweep);
    if (reconcileTimer) clearInterval(reconcileTimer);
    const forced = setTimeout(() => {
      console.error('[control-plane] drain timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forced.unref();
    await new Promise((resolve) => server.close(resolve));
    try {
      await store.close();
    } catch (error) {
      console.error('[control-plane] store close failed:', error.message);
    }
    clearTimeout(forced);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A control plane must not disappear because of one bad request.
  process.on('unhandledRejection', (reason) => {
    console.error('[control-plane] unhandled rejection:', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('[control-plane] uncaught exception:', error);
  });
  server.on('error', (error) => {
    console.error('[control-plane] server error:', error.message);
  });
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[control-plane] failed to start:', error);
    process.exit(1);
  });
}

module.exports = { main };
