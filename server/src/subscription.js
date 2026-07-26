'use strict';

/**
 * Applies a normalised billing event to a tenant's subscription state.
 *
 * State model:
 *   active     -> writable, within quota
 *   grace      -> dunning after a failed payment; uploads paused (read-only),
 *                 data retained until graceUntil (GRACE_RETENTION_DAYS)
 *   suspended  -> cancelled or grace expired; no credentials vended (402)
 */
async function applyBillingEvent(store, config, event) {
  if (!event || event.type === 'ignored') return { applied: 'ignored' };

  let tenantId = event.tenantId;
  if (!tenantId && event.subscriptionId) {
    const found = await store.getTenantBySubscription(event.subscriptionId);
    tenantId = found && found.id;
  }
  if (!tenantId) return { applied: 'no-tenant' };
  const tenant = await store.getTenant(tenantId);
  if (!tenant) return { applied: 'no-tenant' };

  switch (event.type) {
    case 'activated':
    case 'renewed': {
      const patch = { status: 'active', graceUntil: null, subscriptionProvider: config.billing.provider };
      if (event.subscriptionId) patch.subscriptionId = event.subscriptionId;
      if (event.planId) patch.planId = event.planId;
      if (event.currentPeriodEnd) patch.currentPeriodEnd = event.currentPeriodEnd;
      await store.setSubscription(tenantId, patch);
      return { applied: event.type, tenantId, status: 'active', planId: patch.planId || tenant.planId };
    }
    case 'payment_failed': {
      const graceUntil = new Date(Date.now() + config.graceRetentionDays * 86400 * 1000).toISOString();
      await store.setSubscription(tenantId, { status: 'grace', graceUntil });
      return { applied: 'payment_failed', tenantId, status: 'grace', graceUntil };
    }
    case 'cancelled': {
      await store.setSubscription(tenantId, { status: 'suspended', graceUntil: null });
      return { applied: 'cancelled', tenantId, status: 'suspended' };
    }
    default:
      return { applied: 'ignored' };
  }
}

module.exports = { applyBillingEvent };
