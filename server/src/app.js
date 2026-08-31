'use strict';

const express = require('express');
const { issueToken, requireAuth } = require('./auth');
const { verifyGoogleIdToken, issueUserToken } = require('./identity');
const { applyBillingEvent } = require('./subscription');
const { NullAuditLog } = require('./audit');

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

// Enquiry text is user-controlled and ends up inside an HTML email.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fixed-window, per-IP counter. Good enough to blunt form spam on one node. */
function createRateLimiter(maxPerHour) {
  const hits = new Map();
  return function allow(key) {
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000;
    const recent = (hits.get(key) || []).filter((t) => t > windowStart);
    if (recent.length >= maxPerHour) return false;
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, list] of hits) if (!list.some((t) => t > windowStart)) hits.delete(k);
    }
    return true;
  };
}

/**
 * Builds the Express app. Dependencies (config, store, vending provider,
 * billing provider, audit log) are injected so tests can supply a MemoryStore +
 * dev providers with no external services.
 */
function createApp({ config, store, vendingProvider, billingProvider, audit = new NullAuditLog(), mailer = null, enquiryStore = null, verifyIdToken = verifyGoogleIdToken }) {
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

  // Sign in with Google. Identity only: no backup data or credentials are sent.
  app.post('/v1/auth/google', async (req, res, next) => {
    try {
      const { idToken, device } = req.body || {};
      if (!idToken) return res.status(400).json({ error: 'idToken is required' });
      let profile;
      try {
        profile = await verifyIdToken(idToken, { clientIds: config.googleClientIds });
      } catch (error) {
        audit.record('auth.google', { outcome: 'denied', reason: error.message, ip: clientIp(req) });
        return res.status(401).json({ error: error.message });
      }
      const user = await store.upsertUser({
        provider: 'google',
        providerSubject: profile.subject,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      });
      if (device && device.id) {
        await store.upsertDevice({
          id: String(device.id),
          userId: user.id,
          name: device.name || null,
          platform: device.platform || null,
          appVersion: device.appVersion || null,
        });
      }
      audit.record('auth.google', { outcome: 'granted', userId: user.id, ip: clientIp(req) });
      res.json({
        token: issueUserToken(config, user),
        tokenType: 'Bearer',
        user: { id: user.id, email: user.email, name: user.name, picture: user.picture },
      });
    } catch (error) {
      next(error);
    }
  });

  // Current session: who is signed in and which machines they use.
  app.get('/v1/me', auth, async (req, res, next) => {
    try {
      if (req.claims?.kind !== 'user') return res.status(403).json({ error: 'not a user session' });
      const user = await store.getUser(req.claims.sub);
      if (!user) return res.status(404).json({ error: 'user not found' });
      res.json({
        user: { id: user.id, email: user.email, name: user.name, picture: user.picture },
        devices: await store.listDevices(user.id),
      });
    } catch (error) {
      next(error);
    }
  });

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
      if (config.mailer.adminBcc) {
        mailer
          .send({ to: config.mailer.adminBcc, subject: `[${req.tenantId}] ${subject}`, html: String(html) })
          .catch(() => {});
      }
      audit.record('notify.email', { tenantId: req.tenantId, to, provider: result.provider, ip: clientIp(req) });
      res.json({ ok: true, id: result.id, provider: result.provider });
    } catch (error) {
      next(error);
    }
  });

  // Public enquiry form on the marketing site. No auth (anonymous visitors),
  // so it is protected by an origin allow-list, a honeypot and a rate limit.
  const contactAllowed = createRateLimiter(config.contact?.maxPerHour ?? 5);
  const originAllowed = (origin) => !!origin && (config.contact?.allowedOrigins || []).includes(origin);

  app.options('/v1/contact', (req, res) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin)) return res.status(403).end();
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '86400');
    res.status(204).end();
  });

  app.post('/v1/contact', async (req, res, next) => {
    try {
      const origin = req.headers.origin;
      if (origin) {
        if (!originAllowed(origin)) return res.status(403).json({ error: 'origin not allowed' });
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
      }
      const inbox = config.contact?.inbox;
      const canEmail = !!(mailer && inbox);
      if (!canEmail && !enquiryStore) return res.status(503).json({ error: 'the enquiry form is not configured yet' });

      const body = req.body || {};
      // Honeypot: a real browser never fills the hidden field. Answer 200 so
      // bots get no signal about why it failed.
      if (body.website) return res.json({ ok: true });

      const oneLine = (value, max) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
      const name = oneLine(body.name, 120);
      const email = String(body.email || '').trim();
      const message = String(body.message || '').trim();
      if (!name) return res.status(400).json({ error: 'a name is required' });
      if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'a valid email is required' });
      if (message.length < 10 || message.length > 4000) return res.status(400).json({ error: 'please write a short message (10-4000 characters)' });

      const ip = clientIp(req);
      if (!contactAllowed(ip || 'unknown')) return res.status(429).json({ error: 'too many enquiries from this address, please email us directly' });

      const fields = {
        Name: name,
        Email: email,
        Business: oneLine(body.company, 160),
        Phone: oneLine(body.phone, 40),
        Topic: oneLine(body.topic, 80) || 'General',
        Product: oneLine(body.product, 80),
        Source: oneLine(body.source, 80) || 'website',
        IP: ip,
      };
      const rows = Object.entries(fields)
        .filter(([, value]) => value)
        .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#667;">${escapeHtml(label)}</td><td style="padding:4px 0;"><b>${escapeHtml(value)}</b></td></tr>`)
        .join('');
      const html =
        `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">` +
        `<h2 style="margin:0 0 12px">New website enquiry</h2>` +
        `<table style="border-collapse:collapse;margin-bottom:16px">${rows}</table>` +
        `<div style="white-space:pre-wrap;border-left:3px solid #2bbc7f;padding-left:12px">${escapeHtml(message)}</div>` +
        `</div>`;

      // Persist first, notify second: a mail outage must never lose a lead.
      let stored = null;
      let storeError = null;
      if (enquiryStore) {
        try {
          stored = await enquiryStore.save({
            name,
            email,
            company: fields.Business,
            phone: fields.Phone,
            topic: fields.Topic,
            product: fields.Product,
            source: fields.Source,
            message,
            ip,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 400),
            receivedAt: new Date().toISOString(),
            emailed: false,
          });
        } catch (error) {
          storeError = error;
          audit.record('contact.store_failed', { store: enquiryStore.name, reason: error.message, ip });
          if (!canEmail) return next(error);
        }
      }

      let emailProvider = null;
      if (canEmail) {
        try {
          const result = await mailer.send({
            to: inbox,
            subject: `Website enquiry — ${fields.Topic} — ${name}`,
            html,
            replyTo: email,
          });
          emailProvider = result.provider;
        } catch (error) {
          audit.record('contact.email_failed', { reason: error.message, stored: !!stored, ip });
          // Only fail the visitor's request if nothing was persisted either.
          if (!stored) return next(error);
        }
      }

      audit.record('contact.submit', {
        id: stored?.id,
        topic: fields.Topic,
        email,
        stored: stored ? enquiryStore.name : (storeError ? 'failed' : 'none'),
        provider: emailProvider,
        ip,
      });
      res.json({ ok: true, id: stored?.id });
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
