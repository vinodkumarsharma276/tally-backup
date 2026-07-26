'use strict';

/**
 * Backblaze B2 vending provider (scaffold). B2 has no STS; instead the control
 * plane mints a short-lived *restricted application key* (b2_create_key) scoped
 * to the tenant prefix (namePrefix) with a validity window. The B2 S3-compatible
 * endpoint then accepts that key via S3Backend.
 *
 * Requires B2_KEY_ID / B2_APPLICATION_KEY / B2_BUCKET_ID. Implemented with the
 * native B2 API over fetch; fill in and test against a real B2 account.
 */
class B2Provider {
  constructor(config) {
    this.config = config;
  }

  async _authorize() {
    const token = Buffer.from(`${this.config.b2.keyId}:${this.config.b2.applicationKey}`).toString('base64');
    const resp = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
      headers: { Authorization: `Basic ${token}` },
    });
    if (!resp.ok) throw new Error(`B2 authorize failed: ${resp.status}`);
    return resp.json();
  }

  async vend({ tenantId, prefix, ttlSeconds, readOnly = false }) {
    if (!this.config.b2.keyId || !this.config.b2.applicationKey || !this.config.b2.bucketId) {
      throw new Error('B2 provider requires B2_KEY_ID, B2_APPLICATION_KEY and B2_BUCKET_ID.');
    }
    const auth = await this._authorize();
    const ttl = ttlSeconds || this.config.leaseTtlSeconds;
    const capabilities = readOnly
      ? ['listFiles', 'readFiles']
      : ['listFiles', 'readFiles', 'writeFiles', 'deleteFiles'];
    const resp = await fetch(`${auth.apiInfo.storageApi.apiUrl}/b2api/v3/b2_create_key`, {
      method: 'POST',
      headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: auth.accountId,
        capabilities,
        keyName: `tenant-${tenantId}`.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 100),
        validDurationInSeconds: Math.min(86400, ttl),
        bucketId: this.config.b2.bucketId,
        namePrefix: prefix,
      }),
    });
    if (!resp.ok) throw new Error(`B2 create key failed: ${resp.status}`);
    const key = await resp.json();
    const expiration = new Date(Date.now() + Math.min(86400, ttl) * 1000).toISOString();
    return {
      provider: 's3',
      bucket: this.config.managed.bucket,
      region: this.config.managed.region,
      endpoint: this.config.managed.endpoint || undefined, // B2 S3 endpoint
      forcePathStyle: this.config.managed.forcePathStyle,
      prefix,
      readOnly: !!readOnly,
      credentials: {
        accessKeyId: key.applicationKeyId,
        secretAccessKey: key.applicationKey,
        sessionToken: undefined,
        expiration,
      },
      expiresAt: expiration,
    };
  }
}

module.exports = { B2Provider };
