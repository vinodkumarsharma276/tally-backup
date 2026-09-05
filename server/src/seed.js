'use strict';

// Seeds a demo tenant for local development / testing. Safe to call repeatedly.
async function seedDemo(store) {
  await store.createTenant({
    id: 'demo-tenant',
    email: 'demo@vetally.in',
    licenseKey: 'DEMO-LICENSE-KEY-123',
    planId: 'pro',
    status: 'active',
  });
}

/**
 * Seeds tenants declared in config (SEED_TENANTS). Re-run on every boot, which
 * is what makes real installs usable while the tenant store is in-memory: the
 * identities come back after a cold start instead of vanishing with it.
 */
async function seedConfiguredTenants(store, config) {
  const tenants = Array.isArray(config.seedTenants) ? config.seedTenants : [];
  const seeded = [];
  for (const tenant of tenants) {
    if (!tenant || !tenant.id || !tenant.licenseKey) continue;
    await store.createTenant({
      id: String(tenant.id),
      email: tenant.email || null,
      licenseKey: String(tenant.licenseKey),
      planId: tenant.planId || 'starter',
      status: tenant.status || 'active',
    });
    seeded.push(String(tenant.id));
  }
  return seeded;
}

module.exports = { seedDemo, seedConfiguredTenants };
