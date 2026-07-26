'use strict';

const crypto = require('crypto');

function toIso(unixSeconds) {
  return unixSeconds ? new Date(Number(unixSeconds) * 1000).toISOString() : undefined;
}

/**
 * Stripe billing provider. Stripe signs webhooks with a `Stripe-Signature`
 * header of the form `t=<ts>,v1=<hex>` where the signature is
 * HMAC-SHA256(`<ts>.<rawBody>`, webhookSecret). Verification is production-ready
 * (no SDK required); map Stripe price ids via BILLING_PLAN_MAP.
 */
class StripeBillingProvider {
  constructor(config) {
    this.config = config;
    this.toleranceSeconds = 5 * 60;
  }

  get signatureHeader() {
    return 'stripe-signature';
  }

  verifyWebhook(rawBody, signatureHeader, secret = this.config.billing.webhookSecret) {
    if (!signatureHeader) return false;
    let timestamp = null;
    const signatures = [];
    for (const part of String(signatureHeader).split(',')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key === 't') timestamp = value;
      else if (key === 'v1') signatures.push(value);
    }
    if (!timestamp || signatures.length === 0) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > this.toleranceSeconds) return false;
    const signed = `${timestamp}.${rawBody.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    return signatures.some((sig) => {
      const sigBuf = Buffer.from(sig, 'utf8');
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    });
  }

  parseEvent(payload) {
    const type = payload && payload.type;
    const object = payload && payload.data && payload.data.object;
    if (!object) return { type: 'ignored' };
    const metadata = object.metadata || {};
    const priceId = object.items && object.items.data && object.items.data[0] && object.items.data[0].price && object.items.data[0].price.id;
    const planId = this.config.billing.planMap[priceId] || metadata.planId || undefined;

    if (type === 'invoice.payment_failed') {
      return { type: 'payment_failed', tenantId: metadata.tenantId, subscriptionId: object.subscription, planId };
    }
    if (type === 'customer.subscription.deleted') {
      return { type: 'cancelled', tenantId: metadata.tenantId, subscriptionId: object.id, planId };
    }
    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const statusMap = { active: 'activated', trialing: 'activated', past_due: 'payment_failed', unpaid: 'payment_failed', canceled: 'cancelled' };
      const normalized = statusMap[object.status];
      if (!normalized) return { type: 'ignored' };
      return {
        type: normalized,
        tenantId: metadata.tenantId,
        subscriptionId: object.id,
        planId,
        currentPeriodEnd: toIso(object.current_period_end),
      };
    }
    return { type: 'ignored' };
  }
}

module.exports = { StripeBillingProvider };
