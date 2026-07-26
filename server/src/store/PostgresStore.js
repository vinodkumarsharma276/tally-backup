'use strict';

const { hashLicense, verifyLicense } = require('../util/hash');
const { DEFAULT_PLANS } = require('./MemoryStore');

/**
 * PostgreSQL store (production). Mirrors the SqliteStore contract using the `pg`
 * optional dependency. BIGINT columns come back as strings from pg, so byte
 * counts are coerced with Number() (safe up to ~9 PB).
 */
class PostgresStore {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async init() {
    let Pg;
    try {
      Pg = require('pg');
    } catch (error) {
      throw new Error('STORE=postgres requires the pg optional dependency. Run `npm install` in server/.');
    }
    if (!this.config.databaseUrl) throw new Error('STORE=postgres requires DATABASE_URL.');
    this.pool = new Pg.Pool({ connectionString: this.config.databaseUrl });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        quota_bytes BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        email TEXT,
        license_salt TEXT NOT NULL,
        license_hash TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        bytes_stored BIGINT NOT NULL DEFAULT 0,
        bytes_uploaded BIGINT NOT NULL DEFAULT 0,
        subscription_id TEXT,
        subscription_provider TEXT,
        current_period_end TIMESTAMPTZ,
        grace_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        usage_updated_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS tenants_subscription_id_idx ON tenants (subscription_id);
    `);
    const { rows } = await this.pool.query('SELECT COUNT(*)::int AS n FROM plans');
    if (rows[0].n === 0) {
      for (const plan of DEFAULT_PLANS) {
        await this.pool.query('INSERT INTO plans (id, name, quota_bytes) VALUES ($1, $2, $3)', [plan.id, plan.name, plan.quotaBytes]);
      }
    }
  }

  async close() {
    if (this.pool) await this.pool.end();
  }

  async upsertPlan(plan) {
    await this.pool.query(
      'INSERT INTO plans (id, name, quota_bytes) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, quota_bytes = EXCLUDED.quota_bytes',
      [plan.id, plan.name, plan.quotaBytes]
    );
    return this.getPlan(plan.id);
  }

  async getPlan(planId) {
    const { rows } = await this.pool.query('SELECT id, name, quota_bytes FROM plans WHERE id = $1', [planId]);
    if (!rows[0]) return null;
    return { id: rows[0].id, name: rows[0].name, quotaBytes: Number(rows[0].quota_bytes) };
  }

  async createTenant({ id, email, licenseKey, planId, status = 'active' }) {
    const { salt, hash } = hashLicense(licenseKey);
    await this.pool.query(
      'INSERT INTO tenants (id, email, license_salt, license_hash, plan_id, status) VALUES ($1, $2, $3, $4, $5, $6) ' +
      'ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, license_salt = EXCLUDED.license_salt, ' +
      'license_hash = EXCLUDED.license_hash, plan_id = EXCLUDED.plan_id, status = EXCLUDED.status',
      [id, email, salt, hash, planId, status]
    );
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
      bytesStored: Number(row.bytes_stored),
      bytesUploaded: Number(row.bytes_uploaded),
      subscriptionId: row.subscription_id,
      subscriptionProvider: row.subscription_provider,
      currentPeriodEnd: row.current_period_end,
      graceUntil: row.grace_until,
      createdAt: row.created_at,
    };
  }

  async getTenant(id) {
    const { rows } = await this.pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    return this._rowToTenant(rows[0]);
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
    await this.pool.query(
      'UPDATE tenants SET bytes_stored = $1, bytes_uploaded = $2, usage_updated_at = now() WHERE id = $3',
      [nextStored, nextUploaded, tenantId]
    );
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
    let i = 1;
    for (const [key, column] of Object.entries(map)) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = $${i}`);
        values.push(patch[key]);
        i += 1;
      }
    }
    if (sets.length) {
      values.push(tenantId);
      await this.pool.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${i}`, values);
    }
    return this.getTenant(tenantId);
  }

  async getTenantBySubscription(subscriptionId) {
    if (!subscriptionId) return null;
    const { rows } = await this.pool.query('SELECT * FROM tenants WHERE subscription_id = $1', [subscriptionId]);
    return this._rowToTenant(rows[0]);
  }

  async expireGracePeriods(nowMs = Date.now()) {
    const result = await this.pool.query(
      "UPDATE tenants SET status = 'suspended' WHERE status = 'grace' AND grace_until IS NOT NULL AND grace_until <= $1",
      [new Date(nowMs).toISOString()]
    );
    return result.rowCount;
  }

  async listTenants() {
    const { rows } = await this.pool.query('SELECT * FROM tenants');
    return rows.map((row) => this._rowToTenant(row));
  }
}

module.exports = { PostgresStore };
