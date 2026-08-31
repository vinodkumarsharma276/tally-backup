'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Website enquiries are persisted before the notification email is sent, so a
 * mail outage can never lose a lead. Stores are pluggable the same way the
 * tenant store and vending providers are.
 *
 * Every store implements: async save(enquiry) -> { id }
 */

function newId() {
  return `enq_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
}

class MemoryEnquiryStore {
  constructor() {
    this.name = 'memory';
    this.saved = [];
  }

  async save(enquiry) {
    const record = { id: newId(), ...enquiry };
    this.saved.push(record);
    return { id: record.id };
  }

  async list() {
    return this.saved.slice();
  }
}

/** Append-only JSONL on local disk. Durable enough for a single small node. */
class FileEnquiryStore {
  constructor(config) {
    this.name = 'file';
    this.file = path.resolve(config.contact.filePath);
  }

  async save(enquiry) {
    const record = { id: newId(), ...enquiry };
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await fs.promises.appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8');
    return { id: record.id };
  }
}

/**
 * Google Cloud Firestore. The SDK is an optional dependency so the service still
 * starts without it when CONTACT_STORE is anything else.
 */
class FirestoreEnquiryStore {
  constructor(config) {
    this.name = 'firestore';
    this.config = config;
    this.collection = config.contact.firestore.collection;
    this.db = null;
  }

  _client() {
    if (this.db) return this.db;
    let Firestore;
    try {
      ({ Firestore } = require('@google-cloud/firestore'));
    } catch {
      throw new Error(
        'CONTACT_STORE=firestore requires the @google-cloud/firestore optional dependency. Run `npm install` in server/.'
      );
    }
    const { projectId, credentialsJson, databaseId } = this.config.contact.firestore;
    const options = {};
    if (projectId) options.projectId = projectId;
    if (databaseId) options.databaseId = databaseId;
    // Inline service-account JSON suits PaaS hosts with no writable filesystem;
    // otherwise fall back to GOOGLE_APPLICATION_CREDENTIALS / workload identity.
    if (credentialsJson) {
      let parsed;
      try {
        parsed = JSON.parse(credentialsJson);
      } catch {
        throw new Error('FIRESTORE_CREDENTIALS_JSON is not valid JSON.');
      }
      options.credentials = { client_email: parsed.client_email, private_key: parsed.private_key };
      if (!options.projectId && parsed.project_id) options.projectId = parsed.project_id;
    }
    this.db = new Firestore(options);
    return this.db;
  }

  async save(enquiry) {
    const id = newId();
    await this._client().collection(this.collection).doc(id).set({ id, ...enquiry });
    return { id };
  }
}

function createEnquiryStore(config) {
  switch ((config.contact.store || 'none').toLowerCase()) {
    case 'firestore':
      return new FirestoreEnquiryStore(config);
    case 'file':
      return new FileEnquiryStore(config);
    case 'memory':
      return new MemoryEnquiryStore();
    case 'none':
    default:
      return null;
  }
}

module.exports = { createEnquiryStore, MemoryEnquiryStore, FileEnquiryStore, FirestoreEnquiryStore };
