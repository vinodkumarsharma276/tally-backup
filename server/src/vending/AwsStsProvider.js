'use strict';

/**
 * AWS STS vending provider (scaffold). Uses AssumeRole with an inline session
 * policy that scopes access to a single tenant prefix, so the vended credentials
 * can only touch `tenants/<id>/*` in the managed bucket. Master credentials stay
 * server-side (in the role trust / instance profile), never in the desktop app.
 *
 * Requires the @aws-sdk/client-sts optional dependency and AWS_STS_ROLE_ARN.
 */
class AwsStsProvider {
  constructor(config) {
    this.config = config;
    this._client = null;
  }

  _sts() {
    if (this._client) return this._client;
    let STS;
    try {
      STS = require('@aws-sdk/client-sts');
    } catch (error) {
      throw new Error('VENDING_PROVIDER=aws-sts requires @aws-sdk/client-sts. Run `npm install` in server/.');
    }
    this._client = new STS.STSClient({ region: this.config.awsSts.region });
    this._STS = STS;
    return this._client;
  }

  _sessionPolicy(prefix, readOnly) {
    const bucket = this.config.managed.bucket;
    const scoped = prefix.replace(/\/+$/, '');
    const objectActions = readOnly ? ['s3:GetObject'] : ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'];
    return JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'TenantObjects',
          Effect: 'Allow',
          Action: objectActions,
          Resource: [`arn:aws:s3:::${bucket}/${scoped}/*`],
        },
        {
          Sid: 'TenantList',
          Effect: 'Allow',
          Action: ['s3:ListBucket'],
          Resource: [`arn:aws:s3:::${bucket}`],
          Condition: { StringLike: { 's3:prefix': [`${scoped}/*`] } },
        },
      ],
    });
  }

  async vend({ tenantId, prefix, ttlSeconds, readOnly = false }) {
    if (!this.config.awsSts.roleArn) throw new Error('AWS_STS_ROLE_ARN is not configured.');
    const client = this._sts();
    const ttl = Math.max(900, Math.min(43200, ttlSeconds || this.config.leaseTtlSeconds));
    const result = await client.send(
      new this._STS.AssumeRoleCommand({
        RoleArn: this.config.awsSts.roleArn,
        RoleSessionName: `tenant-${tenantId}`.slice(0, 64),
        DurationSeconds: ttl,
        Policy: this._sessionPolicy(prefix, readOnly),
      })
    );
    const c = result.Credentials;
    return {
      provider: 's3',
      bucket: this.config.managed.bucket,
      region: this.config.managed.region,
      endpoint: this.config.managed.endpoint || undefined,
      forcePathStyle: this.config.managed.forcePathStyle,
      prefix,
      readOnly: !!readOnly,
      credentials: {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken,
        expiration: new Date(c.Expiration).toISOString(),
      },
      expiresAt: new Date(c.Expiration).toISOString(),
    };
  }
}

module.exports = { AwsStsProvider };
