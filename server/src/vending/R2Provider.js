'use strict';

/**
 * Cloudflare R2 vending provider (production-ready code; needs a real account to
 * validate live). R2 has no STS; instead the control plane mints S3-compatible
 * temporary access credentials scoped to a bucket + prefix via the Cloudflare
 * `temp-access-credentials` API, with read-only vs read-write permission.
 *
 * Requires R2_ACCOUNT_ID, R2_API_TOKEN, R2_PARENT_ACCESS_KEY_ID, R2_BUCKET.
 * Master credentials stay server-side; only the short-lived scoped token is
 * returned to the desktop app.
 */
class R2Provider {
  constructor(config) {
    this.config = config;
  }

  _endpoint() {
    return this.config.managed.endpoint || `https://${this.config.r2.accountId}.r2.cloudflarestorage.com`;
  }

  async vend({ tenantId, prefix, ttlSeconds, readOnly = false }) {
    const { accountId, apiToken, parentAccessKeyId, bucket } = this.config.r2;
    if (!accountId || !apiToken || !parentAccessKeyId || !bucket) {
      throw new Error('R2 provider requires R2_ACCOUNT_ID, R2_API_TOKEN, R2_PARENT_ACCESS_KEY_ID and R2_BUCKET.');
    }
    const ttl = Math.max(900, Math.min(3600, ttlSeconds || this.config.leaseTtlSeconds));
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/temp-access-credentials`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket,
          parentAccessKeyId,
          permission: readOnly ? 'object-read-only' : 'object-read-write',
          ttlSeconds: ttl,
          prefixes: [`${prefix.replace(/\/+$/, '')}/`],
        }),
      }
    );
    if (!resp.ok) throw new Error(`R2 temp-access-credentials failed: ${resp.status}`);
    const body = await resp.json();
    const result = body.result || body;
    const expiration = new Date(Date.now() + ttl * 1000).toISOString();
    return {
      provider: 's3',
      bucket,
      region: 'auto',
      endpoint: this._endpoint(),
      forcePathStyle: true,
      prefix,
      readOnly: !!readOnly,
      credentials: {
        accessKeyId: result.accessKeyId,
        secretAccessKey: result.secretAccessKey,
        sessionToken: result.sessionToken,
        expiration,
      },
      expiresAt: expiration,
    };
  }
}

module.exports = { R2Provider };
