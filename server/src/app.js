'use strict';

const express = require('express');
const { issueToken, requireAuth } = require('./auth');
const { applyBillingEvent } = require('./subscription');
const { NullAuditLog } = require('./audit');

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

/**
 * Builds the Express app. Dependencies (config, store, vending provider,
 * billing provider, audit log) are injected so tests can supply a MemoryStore +
 * dev providers with no external services.
 */
function createApp({ config, store, vendingProvider, billingProvider, audit = new NullAuditLog(), mailer = null }) {
  const app = express();

  app.get('/healthz', (req, res) => res.json({ ok: true, service: 've-tally-control-plane' }));

  // Billing webhooks need the RAW body for signature verification, so this route
  // is registered before the JSON body parser.
  if (billingProvider) {
    app.post('/v1/billing/webhook/:provider?', express.raw({ type: '*/*' }), async (req, res, next) => {
      try {
        const signature = req.headers[billingProvider.signatureHeader];
        if (!billingProvider.verifyWebhook(req.body, signature)) {
          return res.status(400).json({ error: 'invalid signature' });
        }
        let payload;
        try {
          payload = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body);
        } catch {
          return res.status(400).json({ error: 'invalid json' });
        }
        const event = billingProvider.parseEvent(payload);
        const result = await applyBillingEvent(store, config, event);
        audit.record('billing.webhook', { provider: req.params.provider || config.billing.provider, type: event.type, tenantId: result.tenantId, applied: result.applied, ip: clientIp(req) });
        res.json({ ok: true, ...result });
      } catch (error) {
        next(error);
      }
    });
  }

  app.use(express.json({ limit: '256kb' }));

  // Exchange tenant id + license key for a short-lived bearer token.
  app.post('/v1/auth/token', async (req, res, next) => {
    try {
      const { tenantId, licenseKey } = req.body || {};
      if (!tenantId || !licenseKey) return res.status(400).json({ error: 'tenantId and licenseKey are required' });
      const tenant = await store.authenticateTenant(tenantId, licenseKey);
      if (!tenant) {
        audit.record('auth.token', { tenantId, outcome: 'denied', ip: clientIp(req) });
        return res.status(401).json({ error: 'invalid tenant or license key' });
      }
      const token = issueToken(config, tenant);
      audit.record('auth.token', { tenantId: tenant.id, outcome: 'granted', ip: clientIp(req) });
      res.json({ token, tokenType: 'Bearer', expiresIn: config.tokenTtlSeconds, tenantId: tenant.id, planId: tenant.planId, status: tenant.status });
    } catch (error) {
      next(error);
    }
  });

  const auth = requireAuth(config);

  // Vend short-lived, prefix-scoped storage credentials for this tenant.
  app.post('/v1/credentials', auth, async (req, res, next) => {
    try {
      const tenant = await store.getTenant(req.tenantId);
      if (!tenant) return res.status(404).json({ error: 'tenant not found' });
      if (tenant.status === 'suspended') {
        audit.record('credentials.vend', { tenantId: req.tenantId, outcome: 'denied', reason: 'suspended', ip: clientIp(req) });
        return res.status(402).json({ error: 'subscription suspended', status: 'suspended' });
      }
      const usage = await store.getUsage(req.tenantId);
      const prefix = `tenants/${req.tenantId}`;
      const writable = tenant.status === 'active' && !usage.overQuota;
      // Server-side enforcement: over-quota / non-active tenants get a read-only
      // lease so new uploads are actually denied at the credential level.
      const lease = await vendingProvider.vend({
        tenantId: req.tenantId,
        prefix,
        ttlSeconds: config.leaseTtlSeconds,
        readOnly: !writable,
      });
      audit.record('credentials.vend', { tenantId: req.tenantId, outcome: 'granted', writable, percent: Math.round(usage.percent), ip: clientIp(req) });
      res.json({
        ...lease,
        tenantId: req.tenantId,
        status: tenant.status,
        writable,
        quota: {
          bytesStored: usage.bytesStored,
          quotaBytes: usage.quotaBytes,
          percent: usage.percent,
          warn: usage.warn,
          overQuota: usage.overQuota,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/usage', auth, async (req, res, next) => {
    try {
      res.json(await store.getUsage(req.tenantId));
    } catch (error) {
      next(error);
    }
  });

  // Send a backup report email FROM the company address to the customer's
  // recipient. The customer never provides email credentials; the mailer's
  // API key lives on the server only.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  app.post('/v1/notify/email', auth, async (req, res, next) => {
    try {
      if (!mailer) return res.status(503).json({ error: 'email sending is not configured' });
      const { to, subject, html } = req.body || {};
      if (!to || !EMAIL_RE.test(String(to))) return res.status(400).json({ error: 'a valid recipient "to" is required' });
      if (!subject || !html) return res.status(400).json({ error: 'subject and html are required' });
      if (String(html).length > 512 * 1024) return res.status(413).json({ error: 'email too large' });
      const result = await mailer.send({ to, subject: String(subject), html: String(html) });
      audit.record('notify.email', { tenantId: req.tenantId, to, provider: result.provider, ip: clientIp(req) });
      res.json({ ok: true, id: result.id, provider: result.provider });
    } catch (error) {
      next(error);
    }
  });

  // The desktop app reports metering after a run: absolute bytesStored + delta uploaded.
  app.post('/v1/usage/report', auth, async (req, res, next) => {
    try {
      const { bytesStored, bytesUploaded } = req.body || {};
      const usage = await store.setUsage(req.tenantId, {
        bytesStored: typeof bytesStored === 'number' ? bytesStored : undefined,
        bytesUploadedDelta: typeof bytesUploaded === 'number' ? bytesUploaded : 0,
      });
      audit.record('usage.report', { tenantId: req.tenantId, bytesStored: usage.bytesStored, ip: clientIp(req) });
      res.json(usage);
    } catch (error) {
      next(error);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    res.status(500).json({ error: error.message || 'internal error' });
  });

  return app;
}

module.exports = { createApp };
