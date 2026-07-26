'use strict';

const crypto = require('crypto');

/**
 * Development vending provider. Returns an S3-shaped, prefix-scoped credential
 * lease WITHOUT contacting a cloud provider, so the full desktop -> control-plane
 * -> S3Backend loop can be exercised offline.
 *
 * If DEV_S3_ACCESS_KEY_ID / DEV_S3_SECRET_ACCESS_KEY are set, those real static
 * credentials are passed through (point MANAGED_ENDPOINT at a local MinIO / real
 * S3 to perform genuine read/write I/O). Otherwise deterministic, clearly-fake
 * credentials are synthesised — enough to validate wiring and refresh logic.
 */
class DevProvider {
  constructor(config) {
    this.config = config;
  }

  async vend({ tenantId, prefix, ttlSeconds, readOnly = false }) {
    const ttl = ttlSeconds || this.config.leaseTtlSeconds;
    const expiration = new Date(Date.now() + ttl * 1000).toISOString();

    let credentials;
    if (this.config.devS3.accessKeyId && this.config.devS3.secretAccessKey) {
      credentials = {
        accessKeyId: this.config.devS3.accessKeyId,
        secretAccessKey: this.config.devS3.secretAccessKey,
        sessionToken: undefined,
        expiration,
      };
    } else {
      const seed = `${tenantId}:${prefix}:${Math.floor(Date.now() / (ttl * 1000))}`;
      const secret = crypto.createHmac('sha256', this.config.vendingMasterSecret).update(seed).digest('hex');
      const session = crypto
        .createHmac('sha256', this.config.vendingMasterSecret)
        .update(`session:${seed}`)
        .digest('base64');
      credentials = {
        accessKeyId: `DEV${crypto.createHash('sha1').update(tenantId).digest('hex').slice(0, 13).toUpperCase()}`,
        secretAccessKey: secret,
        sessionToken: session,
        expiration,
      };
    }

    return {
      provider: 's3',
      bucket: this.config.managed.bucket,
      region: this.config.managed.region,
      endpoint: this.config.managed.endpoint || undefined,
      forcePathStyle: this.config.managed.forcePathStyle,
      prefix,
      readOnly: !!readOnly,
      credentials,
      expiresAt: expiration,
    };
  }
}

module.exports = { DevProvider };
