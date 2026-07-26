'use strict';

const logger = require('../utils/logger');

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

/**
 * Desktop client for the managed-storage control plane. Authenticates with a
 * tenant id + license key, fetches a short-lived, prefix-scoped storage lease,
 * caches it, and transparently refreshes it before expiry. Designed to feed the
 * AWS SDK v3 `credentials` provider hook so long backups refresh mid-run.
 */
class ManagedControlPlaneClient {
  constructor({ baseUrl, tenantId, licenseKey, fetchImpl } = {}) {
    if (!baseUrl) throw new Error('Managed storage requires a control-plane URL.');
    if (!tenantId) throw new Error('Managed storage requires a tenant id.');
    if (!licenseKey) throw new Error('Managed storage requires a license key.');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.tenantId = tenantId;
    this.licenseKey = licenseKey;
    this.fetch = fetchImpl || globalThis.fetch;
    if (!this.fetch) throw new Error('global fetch is unavailable; Node 18+ or a fetch polyfill is required.');
    this._token = null;
    this._tokenExpiresAt = 0;
    this._lease = null;
    this._authPromise = null;
    this._leasePromise = null;
  }

  async _request(path, { method = 'GET', body, token } = {}) {
    const resp = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!resp.ok) {
      const error = new Error(data.error || `control-plane ${resp.status}`);
      error.status = resp.status;
      error.body = data;
      throw error;
    }
    return data;
  }

  async _authenticate() {
    if (this._token && Date.now() < this._tokenExpiresAt - REFRESH_SKEW_MS) return this._token;
    if (this._authPromise) return this._authPromise;
    this._authPromise = (async () => {
      const result = await this._request('/v1/auth/token', {
        method: 'POST',
        body: { tenantId: this.tenantId, licenseKey: this.licenseKey },
      });
      this._token = result.token;
      this._tokenExpiresAt = Date.now() + (result.expiresIn || 900) * 1000;
      return this._token;
    })();
    try {
      return await this._authPromise;
    } finally {
      this._authPromise = null;
    }
  }

  _leaseValid() {
    return this._lease && Date.now() < new Date(this._lease.expiresAt).getTime() - REFRESH_SKEW_MS;
  }

  async getStorageLease({ force = false } = {}) {
    if (!force && this._leaseValid()) return this._lease;
    if (this._leasePromise) return this._leasePromise;
    this._leasePromise = (async () => {
      const token = await this._authenticate();
      const lease = await this._request('/v1/credentials', { method: 'POST', token });
      this._lease = lease;
      logger.info(
        `Managed storage lease acquired for ${this.tenantId} (prefix ${lease.prefix}, ` +
        `expires ${lease.expiresAt}, writable=${lease.writable})`
      );
      return lease;
    })();
    try {
      return await this._leasePromise;
    } finally {
      this._leasePromise = null;
    }
  }

  /**
   * AWS SDK v3 credential provider. Returns credentials with an `expiration` so
   * the SDK refreshes automatically; also self-refreshes the lease when stale.
   */
  async getAwsCredentials() {
    const lease = await this.getStorageLease();
    const c = lease.credentials || {};
    return {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      sessionToken: c.sessionToken || undefined,
      expiration: c.expiration ? new Date(c.expiration) : undefined,
    };
  }

  async getUsage() {
    const token = await this._authenticate();
    return this._request('/v1/usage', { token });
  }

  async reportUsage({ bytesStored, bytesUploaded } = {}) {
    const token = await this._authenticate();
    return this._request('/v1/usage/report', {
      method: 'POST',
      token,
      body: { bytesStored, bytesUploaded },
    });
  }

  /**
   * Ask the control plane to send a backup report email FROM the company address
   * to the customer's recipient. No email credentials ever live on the client.
   */
  async sendEmailReport({ to, subject, html } = {}) {
    const token = await this._authenticate();
    return this._request('/v1/notify/email', {
      method: 'POST',
      token,
      body: { to, subject, html },
    });
  }
}

module.exports = { ManagedControlPlaneClient, REFRESH_SKEW_MS };
