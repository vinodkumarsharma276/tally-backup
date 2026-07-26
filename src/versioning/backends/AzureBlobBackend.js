'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

function normalizePrefix(prefix) {
  return (prefix || '').replace(/^\/+|\/+$/g, '');
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

class AzureBlobBackend {
  constructor(opts = {}) {
    if (!opts.accountUrl) throw new Error('AzureBlobBackend requires accountUrl.');
    if (!opts.containerName) throw new Error('AzureBlobBackend requires containerName.');

    this.accountUrl = opts.accountUrl.replace(/\/+$/, '');
    this.containerName = opts.containerName;
    this.prefix = normalizePrefix(opts.prefix || opts.rootPrefix);
    this.knownKeys = null;

    const serviceUrl = opts.sasToken
      ? `${this.accountUrl}?${String(opts.sasToken).replace(/^\?/, '')}`
      : this.accountUrl;
    this.serviceClient = new BlobServiceClient(serviceUrl, opts.credential || undefined);
    this.containerClient = this.serviceClient.getContainerClient(this.containerName);
  }

  _key(key) {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  _stripPrefix(blobName) {
    if (!this.prefix) return blobName;
    return blobName.startsWith(`${this.prefix}/`)
      ? blobName.slice(this.prefix.length + 1)
      : blobName;
  }

  async init() {
    if (this.knownKeys) return;
    if (!(await this.containerClient.exists())) {
      throw new Error(
        `Azure Blob container not found or inaccessible: ${this.containerName} (${this.accountUrl})`
      );
    }

    this.knownKeys = new Set();
    const listPrefix = this.prefix ? `${this.prefix}/` : undefined;
    for await (const blob of this.containerClient.listBlobsFlat({ prefix: listPrefix })) {
      this.knownKeys.add(this._stripPrefix(blob.name));
    }
  }

  async exists(key) {
    await this.init();
    if (this.knownKeys.has(key)) return true;
    const exists = await this.containerClient.getBlobClient(this._key(key)).exists();
    if (exists) this.knownKeys.add(key);
    return exists;
  }

  async put(key, buffer) {
    const blob = this.containerClient.getBlockBlobClient(this._key(key));
    await blob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
      concurrency: 4,
    });
    await this.init();
    this.knownKeys.add(key);
  }

  async get(key) {
    const response = await this.containerClient.getBlobClient(this._key(key)).download();
    if (!response.readableStreamBody) {
      throw new Error(`Azure Blob download returned no body for ${key}`);
    }
    return streamToBuffer(response.readableStreamBody);
  }

  async delete(key) {
    await this.containerClient.getBlobClient(this._key(key)).deleteIfExists({
      deleteSnapshots: 'include',
    });
    await this.init();
    this.knownKeys.delete(key);
  }

  async list(prefix) {
    await this.init();
    const normalized = (prefix || '').replace(/\/+$/g, '');
    return [...this.knownKeys].filter(
      (key) => key === normalized || key.startsWith(`${normalized}/`)
    );
  }
}

module.exports = AzureBlobBackend;