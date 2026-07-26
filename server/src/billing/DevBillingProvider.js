'use strict';

const crypto = require('crypto');

function timingEqual(a, b) {
  const ba = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Development billing provider. Verifies an HMAC-SHA256 hex signature over the
 * raw body (header `x-tally-signature`) and expects an already-normalised event
 * body, so the full subscription lifecycle can be tested offline.
 *
 * Normalised event: { type, tenantId?, subscriptionId?, planId?, currentPeriodEnd? }
 * type in { activated, renewed, payment_failed, cancelled }.
 */
class DevBillingProvider {
  constructor(config) {
    this.config = config;
  }

  get signatureHeader() {
    return 'x-tally-signature';
  }

  sign(rawBody, secret = this.config.billing.webhookSecret) {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }

  verifyWebhook(rawBody, signature, secret = this.config.billing.webhookSecret) {
    return timingEqual(this.sign(rawBody, secret), signature);
  }

  parseEvent(payload) {
    const known = new Set(['activated', 'renewed', 'payment_failed', 'cancelled']);
    return {
      type: known.has(payload.type) ? payload.type : 'ignored',
      tenantId: payload.tenantId,
      subscriptionId: payload.subscriptionId,
      planId: payload.planId,
      currentPeriodEnd: payload.currentPeriodEnd,
    };
  }
}

module.exports = { DevBillingProvider, timingEqual };
