'use strict';

const { hashLicense, verifyLicense } = require('../util/hash');

// Default plan catalogue (quota in bytes). Tune for real pricing.
const GB = 1024 * 1024 * 1024;
const DEFAULT_PLANS = [
  { id: 'starter', name: 'Starter', quotaBytes: 25 * GB },
  { id: 'pro', name: 'Pro', quotaBytes: 100 * GB },
  { id: 'business', name: 'Business', quotaBytes: 500 * GB },
];

/**
 * In-memory store — the reference implementation of the store interface and the
 * default for tests. Not durable; use SqliteStore/PostgresStore in production.
 */
class MemoryStore {
  constructor() {
    this.plans = new Map();
    this.tenants = new Map();
    this.users = new Map();
    this.devices = new Map();
  }

  async init() {
    for (const plan of DEFAULT_PLANS) this.plans.set(plan.id, { ...plan });
  }

  async close() {}

  async upsertPlan(plan) {
    this.plans.set(plan.id, { ...this.plans.get(plan.id), ...plan });
    return this.plans.get(plan.id);
  }

  async getPlan(planId) {
    return this.plans.get(planId) || null;
  }

  async upsertTenant(tenant) {
    const existing = this.tenants.get(tenant.id) || {};
    const merged = {
      status: 'active',
      bytesStored: 0,
      bytesUploaded: 0,
      createdAt: new Date().toISOString(),
      ...existing,
      ...tenant,
    };
    this.tenants.set(tenant.id, merged);
    return merged;
  }

  async createTenant({ id, email, licenseKey, planId, status = 'active' }) {
    const { salt, hash } = hashLicense(licenseKey);
    return this.upsertTenant({ id, email, licenseSalt: salt, licenseHash: hash, planId, status });
  }

  async getTenant(id) {
    return this.tenants.get(id) || null;
  }

  async authenticateTenant(tenantId, licenseKey) {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;
    if (!verifyLicense(licenseKey, tenant.licenseSalt, tenant.licenseHash)) return null;
    return tenant;
  }

  async setUsage(tenantId, { bytesStored, bytesUploadedDelta = 0 }) {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error('tenant not found');
    if (typeof bytesStored === 'number') tenant.bytesStored = Math.max(0, bytesStored);
    tenant.bytesUploaded = (tenant.bytesUploaded || 0) + Math.max(0, bytesUploadedDelta);
    tenant.usageUpdatedAt = new Date().toISOString();
    return this.getUsage(tenantId);
  }

  async getUsage(tenantId) {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error('tenant not found');
    const plan = this.plans.get(tenant.planId) || { quotaBytes: 0 };
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
    return [...this.tenants.values()];
  }

  async setSubscription(tenantId, patch = {}) {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error('tenant not found');
    for (const key of ['status', 'planId', 'subscriptionId', 'subscriptionProvider', 'currentPeriodEnd', 'graceUntil']) {
      if (patch[key] !== undefined) tenant[key] = patch[key];
    }
    tenant.subscriptionUpdatedAt = new Date().toISOString();
    return tenant;
  }

  async getTenantBySubscription(subscriptionId) {
    if (!subscriptionId) return null;
    for (const tenant of this.tenants.values()) {
      if (tenant.subscriptionId === subscriptionId) return tenant;
    }
    return null;
  }

  async upsertUser({ provider = 'google', providerSubject, email, name, picture }) {
    const id = `${provider}:${providerSubject}`;
    const existing = this.users.get(id) || { id, provider, providerSubject, createdAt: new Date().toISOString() };
    const merged = { ...existing, email, name, picture, lastSeenAt: new Date().toISOString() };
    this.users.set(id, merged);
    return merged;
  }

  async getUser(id) {
    return this.users.get(id) || null;
  }

  async upsertDevice({ id, userId, name, platform, appVersion }) {
    const key = `${userId}:${id}`;
    const existing = this.devices.get(key) || { id, userId, firstSeenAt: new Date().toISOString() };
    const merged = { ...existing, name, platform, appVersion, lastSeenAt: new Date().toISOString() };
    this.devices.set(key, merged);
    return merged;
  }

  async listDevices(userId) {
    return [...this.devices.values()].filter((device) => device.userId === userId);
  }

  async expireGracePeriods(nowMs = Date.now()) {
    let expired = 0;
    for (const tenant of this.tenants.values()) {
      if (tenant.status === 'grace' && tenant.graceUntil && new Date(tenant.graceUntil).getTime() <= nowMs) {
        tenant.status = 'suspended';
        tenant.subscriptionUpdatedAt = new Date().toISOString();
        expired += 1;
      }
    }
    return expired;
  }
}

module.exports = { MemoryStore, DEFAULT_PLANS };
