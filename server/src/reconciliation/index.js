'use strict';

/**
 * Metering reconciliation: the authoritative bytesStored per tenant is the sum
 * of object sizes under `tenants/<id>/` in the managed bucket. Client-reported
 * usage is a fast-path; this job corrects drift (failed runs, deletions, GC).
 */

class S3UsageLister {
  constructor(config) {
    this.config = config;
    this._client = null;
  }

  _s3() {
    if (this._client) return this._client;
    let S3;
    try {
      S3 = require('@aws-sdk/client-s3');
    } catch (error) {
      throw new Error('RECONCILE_PROVIDER=s3 requires @aws-sdk/client-s3. Run `npm install` in server/.');
    }
    this._S3 = S3;
    // Master credentials come from the server environment (default AWS chain),
    // never from the desktop app.
    this._client = new S3.S3Client({
      region: this.config.managed.region,
      endpoint: this.config.managed.endpoint || undefined,
      forcePathStyle: this.config.managed.forcePathStyle,
    });
    return this._client;
  }

  async listTenantBytes(tenantId, prefix) {
    const client = this._s3();
    let total = 0;
    let token;
    do {
      const resp = await client.send(
        new this._S3.ListObjectsV2Command({
          Bucket: this.config.managed.bucket,
          Prefix: `${prefix}/`,
          ContinuationToken: token,
        })
      );
      for (const obj of resp.Contents || []) total += obj.Size || 0;
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    return total;
  }
}

function createUsageLister(config) {
  switch ((config.reconciliation.provider || 'none').toLowerCase()) {
    case 's3':
      return new S3UsageLister(config);
    case 'none':
    default:
      return null;
  }
}

class ReconciliationService {
  constructor({ store, lister, logger = console }) {
    this.store = store;
    this.lister = lister;
    this.logger = logger;
  }

  async reconcileTenant(tenantId) {
    const bytes = await this.lister.listTenantBytes(tenantId, `tenants/${tenantId}`);
    return this.store.setUsage(tenantId, { bytesStored: bytes });
  }

  async reconcileAll() {
    const tenants = await this.store.listTenants();
    const results = [];
    for (const tenant of tenants) {
      try {
        results.push(await this.reconcileTenant(tenant.id));
      } catch (error) {
        if (this.logger && this.logger.warn) {
          this.logger.warn(`[reconcile] tenant ${tenant.id} failed: ${error.message}`);
        }
      }
    }
    return results;
  }
}

module.exports = { S3UsageLister, createUsageLister, ReconciliationService };
