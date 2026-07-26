'use strict';

const { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

function normalizePrefix(prefix) {
  return (prefix || '').replace(/^\/+|\/+$/g, '');
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

class S3Backend {
  constructor(opts = {}) {
    if (!opts.bucket) throw new Error('S3Backend requires bucket.');
    if (!opts.region) throw new Error('S3Backend requires region.');

    this.bucket = opts.bucket;
    this.prefix = normalizePrefix(opts.prefix || opts.rootPrefix);
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint || undefined,
      forcePathStyle: !!opts.forcePathStyle,
      credentials: opts.credentials,
    });
    this.knownKeys = null;
  }

  _key(key) {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  _stripPrefix(fullKey) {
    if (!this.prefix) return fullKey;
    return fullKey.startsWith(`${this.prefix}/`) ? fullKey.slice(this.prefix.length + 1) : fullKey;
  }

  async init() {
    if (this.knownKeys) return;
    this.knownKeys = new Set();
    let token;
    do {
      const resp = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix ? `${this.prefix}/` : undefined,
          ContinuationToken: token,
        })
      );
      for (const obj of resp.Contents || []) {
        if (obj.Key) this.knownKeys.add(this._stripPrefix(obj.Key));
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
  }

  async exists(key) {
    await this.init();
    if (this.knownKeys.has(key)) return true;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this._key(key) }));
      this.knownKeys.add(key);
      return true;
    } catch (error) {
      const status = error && (error.$metadata && error.$metadata.httpStatusCode);
      const code = error && (error.name || error.Code || error.code);
      if (status === 404 || /NotFound|NoSuchKey/i.test(code || '')) return false;
      throw error;
    }
  }

  async put(key, buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this._key(key),
        Body: buffer,
        ContentType: 'application/octet-stream',
      })
    );
    await this.init();
    this.knownKeys.add(key);
  }

  async get(key) {
    const resp = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this._key(key) })
    );
    return streamToBuffer(resp.Body);
  }

  async delete(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this._key(key) }));
    await this.init();
    this.knownKeys.delete(key);
  }

  async list(prefix) {
    await this.init();
    const normalized = (prefix || '').replace(/\/+$/g, '');
    return [...this.knownKeys].filter((key) => key === normalized || key.startsWith(`${normalized}/`));
  }
}

module.exports = S3Backend;