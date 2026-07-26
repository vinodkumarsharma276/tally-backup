'use strict';

const { DevBillingProvider } = require('./DevBillingProvider');
const { RazorpayBillingProvider } = require('./RazorpayBillingProvider');
const { StripeBillingProvider } = require('./StripeBillingProvider');

/**
 * Billing provider factory. Every provider exposes:
 *   signatureHeader                          -> string header name
 *   verifyWebhook(rawBodyBuffer, sig, secret) -> boolean
 *   parseEvent(payloadObject)                 -> { type, tenantId?, subscriptionId?, planId?, currentPeriodEnd? }
 * where type in { activated, renewed, payment_failed, cancelled, ignored }.
 */
function createBillingProvider(config) {
  switch ((config.billing.provider || 'dev').toLowerCase()) {
    case 'razorpay':
      return new RazorpayBillingProvider(config);
    case 'stripe':
      return new StripeBillingProvider(config);
    case 'dev':
    default:
      return new DevBillingProvider(config);
  }
}

module.exports = { createBillingProvider };
