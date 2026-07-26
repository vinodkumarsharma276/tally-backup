'use strict';

/*
 * Offline test of E4 billing: subscription lifecycle via signed webhooks, plan
 * -> quota changes, dunning grace period, grace expiry -> suspended, and real
 * Razorpay/Stripe signature verification + event parsing. No external services.
 *
 * Run: node server/test/billing.test.js   (from the repo root)
 */

const crypto = require('crypto');
const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/MemoryStore');
const { createVendingProvider } = require('../src/vending');
const { createBillingProvider } = require('../src/billing');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/seed');
const { RazorpayBillingProvider } = require('../src/billing/RazorpayBillingProvider');
const { StripeBillingProvider } = require('../src/billing/StripeBillingProvider');

const { ManagedControlPlaneClient } = require('../../src/versioning/ManagedControlPlaneClient');

const GB = 1024 * 1024 * 1024;
const WEBHOOK_SECRET = 'dev-webhook-secret';

async function main() {
  const config = loadConfig({
    STORE: 'memory',
    VENDING_PROVIDER: 'dev',
    BILLING_PROVIDER: 'dev',
    BILLING_WEBHOOK_SECRET: WEBHOOK_SECRET,
    GRACE_RETENTION_DAYS: '15',
    MANAGED_BUCKET: 'tally-managed-dev',
    MANAGED_REGION: 'us-east-1',
    NODE_ENV: 'test',
  });
  const store = new MemoryStore();
  await store.init();
  await seedDemo(store);
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

  const post = async (raw, sig) => {
    const resp = await fetch(`${base}/v1/billing/webhook/dev`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tally-signature': sig },
      body: raw,
    });
    return { status: resp.status, body: await resp.json().catch(() => ({})) };
  };
  const sign = (raw) => crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  const send = (event) => {
    const raw = JSON.stringify(event);
    return post(raw, sign(raw));
  };

  const client = new ManagedControlPlaneClient({ baseUrl: base, tenantId: 'demo-tenant', licenseKey: 'DEMO-LICENSE-KEY-123' });

  try {
    // 1. Activate on the Business plan.
    const activated = await send({ type: 'activated', tenantId: 'demo-tenant', subscriptionId: 'sub_1', planId: 'business' });
    check('activated webhook accepted', activated.status === 200 && activated.body.status === 'active');
    const usage1 = await client.getUsage();
    check('plan upgraded to business (500GB)', usage1.planId === 'business' && usage1.quotaBytes === 500 * GB);
    const lease1 = await client.getStorageLease({ force: true });
    check('active subscription is writable', lease1.writable === true);

    // 2. Payment failure, resolved by subscriptionId only -> grace.
    const failed = await send({ type: 'payment_failed', subscriptionId: 'sub_1' });
    check('payment_failed -> grace', failed.status === 200 && failed.body.status === 'grace');
    check('grace sets graceUntil', !!failed.body.graceUntil);
    const lease2 = await client.getStorageLease({ force: true });
    check('grace pauses uploads (read-only)', lease2.writable === false);

    // 3. Grace expiry -> suspended.
    const expired = await store.expireGracePeriods(Date.now() + 16 * 86400 * 1000);
    check('grace period expires to suspended', expired === 1);
    let suspErr = null;
    try { await client.getStorageLease({ force: true }); } catch (error) { suspErr = error; }
    check('suspended blocks credential vending (402)', suspErr && suspErr.status === 402);

    // 4. Renewal reactivates.
    const renewed = await send({ type: 'renewed', subscriptionId: 'sub_1', planId: 'business' });
    check('renewal reactivates', renewed.status === 200 && renewed.body.status === 'active');
    const lease3 = await client.getStorageLease({ force: true });
    check('reactivated subscription writable again', lease3.writable === true);

    // 5. Invalid signature rejected.
    const bad = await post(JSON.stringify({ type: 'cancelled', tenantId: 'demo-tenant' }), 'deadbeef');
    check('invalid webhook signature rejected (400)', bad.status === 400);

    // 6. Razorpay signature verification + parsing (production-ready).
    const rzp = new RazorpayBillingProvider({ billing: { webhookSecret: 'whsec', planMap: { plan_X: 'business' }, provider: 'razorpay' } });
    const rzpBody = JSON.stringify({
      event: 'subscription.charged',
      payload: { subscription: { entity: { id: 'sub_rzp', notes: { tenantId: 'demo-tenant' }, plan_id: 'plan_X', current_end: 1900000000 } } },
    });
    const rzpSig = crypto.createHmac('sha256', 'whsec').update(rzpBody).digest('hex');
    check('razorpay signature verifies', rzp.verifyWebhook(Buffer.from(rzpBody), rzpSig));
    const rzpEvent = rzp.parseEvent(JSON.parse(rzpBody));
    check('razorpay event normalised', rzpEvent.type === 'renewed' && rzpEvent.tenantId === 'demo-tenant' && rzpEvent.planId === 'business');

    // 7. Stripe signature verification + parsing (production-ready).
    const stripe = new StripeBillingProvider({ billing: { webhookSecret: 'whsec', planMap: { price_1: 'pro' }, provider: 'stripe' } });
    const stripeBody = JSON.stringify({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_s', status: 'past_due', metadata: { tenantId: 'demo-tenant' }, items: { data: [{ price: { id: 'price_1' } }] }, current_period_end: 1900000000 } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const stripeSig = crypto.createHmac('sha256', 'whsec').update(`${ts}.${stripeBody}`).digest('hex');
    check('stripe signature verifies', stripe.verifyWebhook(Buffer.from(stripeBody), `t=${ts},v1=${stripeSig}`));
    const stripeEvent = stripe.parseEvent(JSON.parse(stripeBody));
    check('stripe event normalised', stripeEvent.type === 'payment_failed' && stripeEvent.tenantId === 'demo-tenant' && stripeEvent.planId === 'pro');
  } finally {
    server.close();
    await store.close();
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('BILLING E2E ERROR', error);
  process.exit(2);
});
