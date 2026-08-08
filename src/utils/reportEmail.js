'use strict';

const EmailService = require('../EmailService');
const { ManagedControlPlaneClient } = require('../versioning/ManagedControlPlaneClient');
const { resolveSecretValue } = require('./SecretStore');
const logger = require('./logger');

/**
 * Resolve the control-plane relay identity used to send company emails:
 * an explicit `email.relay` block, or fall back to a managed storage profile's
 * control-plane URL + license.
 */
function resolveRelayIdentity(config) {
  const relay = (config.email && config.email.relay) || null;
  if (relay && relay.controlPlaneUrl && relay.tenantId) {
    return { controlPlaneUrl: relay.controlPlaneUrl, tenantId: relay.tenantId, licenseKey: relay.licenseKey };
  }
  const profiles = (config && config.storageProfiles) || {};
  for (const profile of Object.values(profiles)) {
    if (profile.type === 'managed' && profile.controlPlaneUrl && profile.tenantId) {
      return {
        controlPlaneUrl: profile.controlPlaneUrl,
        tenantId: profile.tenantId,
        licenseKey: (profile.auth && profile.auth.licenseKey) || profile.licenseKey,
      };
    }
  }
  return null;
}

/**
 * Recipients for a run: the source's own list when set, otherwise the global one.
 */
function recipientsFor(config, source) {
  const raw = (source && source.notifyTo) || (config.email && config.email.to) || [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(list.map((value) => String(value).trim()).filter(Boolean))];
}

/**
 * Send a backup report. In `company` mode the report is rendered locally and
 * handed to the control plane, which sends it FROM the company address (no email
 * credentials on the client). Otherwise the legacy SMTP path is used.
 */
async function sendReport({ config, status, result, error, source }) {
  const email = config && config.email;
  if (!email || !email.enabled) return;
  if (status === 'success' && email.sendOnSuccess === false) return;
  if (status === 'failure' && email.sendOnFailure === false) return;

  const recipients = recipientsFor(config, source);

  if (email.mode === 'company') {
    if (recipients.length === 0) {
      logger.warn('Company email is enabled but no recipient is configured; skipping report.');
      return;
    }
    const identity = resolveRelayIdentity(config);
    if (!identity) {
      logger.warn('Company email is enabled but no relay was found (email.relay or a managed profile); skipping report.');
      return;
    }
    const licenseKey = await resolveSecretValue(identity.licenseKey, { required: false });
    if (!identity.controlPlaneUrl || !identity.tenantId || !licenseKey) {
      logger.warn('Company email relay is missing controlPlaneUrl/tenantId/licenseKey; skipping report.');
      return;
    }

    const svc = new EmailService(email); // rendering only; no SMTP transport needed
    const normalized = svc.normalizeResult(result, result && result.driveLinks);
    let html;
    let subject;
    const label = source && source.name ? ` (${source.name})` : '';
    if (status === 'failure') {
      normalized.error = (error && error.message) || String(error || 'Unknown error');
      html = svc.generateReportEmail('failure', normalized);
      subject = `${email.subject || 'Backup Genie Report'}${label} — Backup failed`;
    } else {
      html = svc.generateReportEmail('success', normalized);
      subject = `${email.subject || 'Backup Genie Report'}${label} — Backup successful`;
    }

    const client = new ManagedControlPlaneClient({
      baseUrl: identity.controlPlaneUrl,
      tenantId: identity.tenantId,
      licenseKey,
    });
    for (const to of recipients) {
      try {
        await client.sendEmailReport({ to, subject, html });
        logger.info(`Report email sent via company relay to ${to}`);
      } catch (sendError) {
        logger.warn(`Company relay email to ${to} failed: ${sendError.message}`);
      }
    }
    return;
  }

  // Legacy customer-provided SMTP path.
  const svc = new EmailService({ ...email, to: recipients.join(', ') });
  await svc.initialize();
  if (status === 'failure') await svc.sendBackupFailure(error, result);
  else await svc.sendBackupSuccessWithMultipleLinks(result, result && result.driveLinks);
}

module.exports = { sendReport, resolveRelayIdentity, recipientsFor };
