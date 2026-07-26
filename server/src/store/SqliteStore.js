'use strict';

const path = require('path');
const fs = require('fs');
const { hashLicense, verifyLicense } = require('../util/hash');
const { DEFAULT_PLANS } = require('./MemoryStore');

/**
 * SQLite-backed store (development / small production) using better-sqlite3.
 * Loaded lazily so the dependency is only required when STORE=sqlite.
 */
class SqliteStore {
  constructor(config) {
    this.config = config;
    this.db = null;
  }

  async init() {
    let Database;
    try {
      Database = require('better-sqlite3');
    } catch (error) {
      throw new Error(
        'STORE=sqlite requires the better-sqlite3 optional dependency. Run `npm install` in server/, or use STORE=memory.'
      );
    }
    const file = path.resolve(this.config.sqlitePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        quota_bytes INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        email TEXT,
        license_salt TEXT NOT NULL,
        license_hash TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        bytes_stored INTEGER NOT NULL DEFAULT 0,
        bytes_uploaded INTEGER NOT NULL DEFAULT 0,
        subscription_id TEXT,
        subscription_provider TEXT,
        current_period_end TEXT,
        grace_until TEXT,
        created_at TEXT NOT NULL,
        usage_updated_at TEXT
      );
    `);
    // Forward-compat: add subscription columns to pre-existing databases.
    for (const column of [
      'subscription_id TEXT',
      'subscription_provider TEXT',
      'current_period_end TEXT',
      'grace_until TEXT',
    ]) {
      try {
        this.db.exec(`ALTER TABLE tenants ADD COLUMN ${column}`);
      } catch (error) {
        // Column already exists.
      }
    }
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM plans').get().n;
    if (count === 0) {
      const insert = this.db.prepare('INSERT INTO plans (id, name, quota_bytes) VALUES (?, ?, ?)');
      for (const plan of DEFAULT_PLANS) insert.run(plan.id, plan.name, plan.quotaBytes);
    }
  }

  async close() {
    if (this.db) this.db.close();
  }

  async upsertPlan(plan) {
    this.db
      .prepare(
        'INSERT INTO plans (id, name, quota_bytes) VALUES (@id, @name, @quotaBytes) ' +
        'ON CONFLICT(id) DO UPDATE SET name=@name, quota_bytes=@quotaBytes'
      )
      .run(plan);
    return this.getPlan(plan.id);
  }

  async getPlan(planId) {
    const row = this.db.prepare('SELECT id, name, quota_bytes AS quotaBytes FROM plans WHERE id = ?').get(planId);
    return row || null;
  }

  async createTenant({ id, email, licenseKey, planId, status = 'active' }) {
    const { salt, hash } = hashLicense(licenseKey);
    this.db
      .prepare(
        'INSERT INTO tenants (id, email, license_salt, license_hash, plan_id, status, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ' +
        'email=excluded.email, license_salt=excluded.license_salt, license_hash=excluded.license_hash, ' +
        'plan_id=excluded.plan_id, status=excluded.status'
      )
      .run(id, email, salt, hash, planId, status, new Date().toISOString());
    return this.getTenant(id);
  }

  _rowToTenant(row) {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      licenseSalt: row.license_salt,
      licenseHash: row.license_hash,
      planId: row.plan_id,
      status: row.status,
      bytesStored: row.bytes_stored,
      bytesUploaded: row.bytes_uploaded,
      subscriptionId: row.subscription_id,
      subscriptionProvider: row.subscription_provider,
      currentPeriodEnd: row.current_period_end,
      graceUntil: row.grace_until,
      createdAt: row.created_at,
    };
  }

  async getTenant(id) {
    return this._rowToTenant(this.db.prepare('SELECT * FROM tenants WHERE id = ?').get(id));
  }

  async authenticateTenant(tenantId, licenseKey) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) return null;
    if (!verifyLicense(licenseKey, tenant.licenseSalt, tenant.licenseHash)) return null;
    return tenant;
  }

  async setUsage(tenantId, { bytesStored, bytesUploadedDelta = 0 }) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) throw new Error('tenant not found');
    const nextStored = typeof bytesStored === 'number' ? Math.max(0, bytesStored) : tenant.bytesStored;
    const nextUploaded = (tenant.bytesUploaded || 0) + Math.max(0, bytesUploadedDelta);
    this.db
      .prepare('UPDATE tenants SET bytes_stored = ?, bytes_uploaded = ?, usage_updated_at = ? WHERE id = ?')
      .run(nextStored, nextUploaded, new Date().toISOString(), tenantId);
    return this.getUsage(tenantId);
  }

  async getUsage(tenantId) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) throw new Error('tenant not found');
    const plan = (await this.getPlan(tenant.planId)) || { quotaBytes: 0 };
    const quotaBytes = plan.quotaBytes || 0;
    const bytesStored = tenant.bytesStored || 0;
    const percent = quotaBytes > 0 ? Math.min(100, (bytesStored / quotaBytes) * 100) : 0;
    return {
      tenantId,
      planId: tenant.planId,
      status: tenant.status,
      bytesStored,
      bytesUploaded: tenant.bytesUploaded || 0,
      quotaBytes,
      percent,
      warn: quotaBytes > 0 && bytesStored / quotaBytes >= 0.8,
      overQuota: quotaBytes > 0 && bytesStored >= quotaBytes,
    };
  }

  async listTenants() {
    return this.db.prepare('SELECT * FROM tenants').all().map((row) => this._rowToTenant(row));
  }

  async setSubscription(tenantId, patch = {}) {
    const map = {
      status: 'status',
      planId: 'plan_id',
      subscriptionId: 'subscription_id',
      subscriptionProvider: 'subscription_provider',
      currentPeriodEnd: 'current_period_end',
      graceUntil: 'grace_until',
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(patch[key]);
      }
    }
    if (sets.length) {
      values.push(tenantId);
      this.db.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    return this.getTenant(tenantId);
  }

  async getTenantBySubscription(subscriptionId) {
    if (!subscriptionId) return null;
    return this._rowToTenant(this.db.prepare('SELECT * FROM tenants WHERE subscription_id = ?').get(subscriptionId));
  }

  async expireGracePeriods(nowMs = Date.now()) {
    const nowIso = new Date(nowMs).toISOString();
    const result = this.db
      .prepare("UPDATE tenants SET status = 'suspended' WHERE status = 'grace' AND grace_until IS NOT NULL AND grace_until <= ?")
      .run(nowIso);
    return result.changes;
  }
}

module.exports = { SqliteStore };
