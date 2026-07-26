'use strict';

const crypto = require('crypto');
const { timingEqual } = require('./DevBillingProvider');

function toIso(unixSeconds) {
  return unixSeconds ? new Date(Number(unixSeconds) * 1000).toISOString() : undefined;
}

/**
 * Razorpay billing provider. Razorpay signs webhooks with
 * HMAC-SHA256(rawBody, webhookSecret) as a hex digest in `x-razorpay-signature`.
 * Signature verification is production-ready; wire real plan ids via
 * BILLING_PLAN_MAP (razorpay plan_id -> internal plan id).
 */
class RazorpayBillingProvider {
  constructor(config) {
    this.config = config;
  }

  get signatureHeader() {
    return 'x-razorpay-signature';
  }

  verifyWebhook(rawBody, signature, secret = this.config.billing.webhookSecret) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return timingEqual(expected, signature);
  }

  parseEvent(payload) {
    const entity = payload && payload.payload && payload.payload.subscription && payload.payload.subscription.entity;
    const event = payload && payload.event;
    const map = {
      'subscription.activated': 'activated',
      'subscription.authenticated': 'activated',
      'subscription.resumed': 'activated',
      'subscription.charged': 'renewed',
      'subscription.pending': 'payment_failed',
      'subscription.halted': 'payment_failed',
      'subscription.cancelled': 'cancelled',
      'subscription.completed': 'cancelled',
    };
    if (!entity || !map[event]) return { type: 'ignored' };
    return {
      type: map[event],
      tenantId: entity.notes && entity.notes.tenantId,
      subscriptionId: entity.id,
      planId: this.config.billing.planMap[entity.plan_id] || undefined,
      currentPeriodEnd: toIso(entity.current_end),
    };
  }
}

module.exports = { RazorpayBillingProvider };
