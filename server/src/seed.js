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

module.exports = { seedDemo };
