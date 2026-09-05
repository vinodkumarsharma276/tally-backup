'use strict';

// Environment-driven configuration with safe development defaults.
function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function loadConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: int(env.PORT, 8787),
    jwtSecret: env.JWT_SECRET || 'dev-insecure-jwt-secret',
    // For zero-downtime secret rotation: tokens signed with the previous secret
    // still verify until they expire.
    jwtSecretPrevious: env.JWT_SECRET_PREVIOUS || '',
    tokenTtlSeconds: int(env.TOKEN_TTL_SECONDS, 900),
    // Sessions outlive tokens so a machine stays signed in while offline.
    userTokenTtlSeconds: int(env.USER_TOKEN_TTL_SECONDS, 30 * 24 * 60 * 60),
    googleClientIds: String(env.GOOGLE_CLIENT_IDS || '').split(',').map((value) => value.trim()).filter(Boolean),
    leaseTtlSeconds: int(env.LEASE_TTL_SECONDS, 3600),
    // Data residency: the region customer data is stored in (compliance).
    dataRegion: env.DATA_REGION || env.MANAGED_REGION || 'us-east-1',
    store: env.STORE || 'memory',
    sqlitePath: env.SQLITE_PATH || './data/control-plane.db',
    databaseUrl: env.DATABASE_URL || '',
    vendingProvider: env.VENDING_PROVIDER || 'dev',
    vendingMasterSecret: env.VENDING_MASTER_SECRET || 'dev-master-secret',
    managed: {
      bucket: env.MANAGED_BUCKET || 'tally-managed-dev',
      region: env.MANAGED_REGION || 'us-east-1',
      endpoint: env.MANAGED_ENDPOINT || '',
      forcePathStyle: bool(env.MANAGED_FORCE_PATH_STYLE, false),
    },
    devS3: {
      accessKeyId: env.DEV_S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.DEV_S3_SECRET_ACCESS_KEY || '',
    },
    awsSts: {
      roleArn: env.AWS_STS_ROLE_ARN || '',
      region: env.AWS_REGION || 'us-east-1',
    },
    b2: {
      keyId: env.B2_KEY_ID || '',
      applicationKey: env.B2_APPLICATION_KEY || '',
      bucketId: env.B2_BUCKET_ID || '',
    },
    r2: {
      accountId: env.R2_ACCOUNT_ID || '',
      apiToken: env.R2_API_TOKEN || '',
      parentAccessKeyId: env.R2_PARENT_ACCESS_KEY_ID || '',
      bucket: env.R2_BUCKET || '',
    },
    billing: {
      provider: env.BILLING_PROVIDER || 'dev',
      webhookSecret: env.BILLING_WEBHOOK_SECRET || 'dev-webhook-secret',
      // Maps a billing-provider plan/price id -> internal plan id (starter|pro|business).
      planMap: safeJson(env.BILLING_PLAN_MAP, {}),
    },
    reconciliation: {
      provider: env.RECONCILE_PROVIDER || 'none', // none | s3
      intervalMinutes: int(env.RECONCILE_INTERVAL_MINUTES, 0),
    },
    audit: {
      sink: env.AUDIT_SINK || (env.NODE_ENV === 'production' ? 'file' : 'console'), // file | console | none
      file: env.AUDIT_FILE || './data/audit.log',
    },
    mailer: {
      // How the company sends report emails FROM its own address. Credentials
      // live here on the server only, never in the desktop app.
      provider: env.MAILER_PROVIDER || 'dev', // dev | smtp | resend | sendgrid
      from: env.MAILER_FROM || 'Backup Genie <no-reply@backupgenie.app>',
      apiKey: env.MAILER_API_KEY || '',
      // Optional monitoring copy of every report; disclose this in the privacy policy.
      adminBcc: env.MAILER_ADMIN_BCC || '',
      // Generic SMTP relay works with Brevo, Zoho, SES, Mailjet, Resend, etc.
      smtp: {
        host: env.MAILER_SMTP_HOST || '',
        port: int(env.MAILER_SMTP_PORT, 587),
        secure: bool(env.MAILER_SMTP_SECURE, false),
        user: env.MAILER_SMTP_USER || '',
        pass: env.MAILER_SMTP_PASS || '',
      },
    },
    // Public website enquiry form (site/ -> POST /v1/contact).
    contact: {
      // Where enquiries are delivered. Comma-separated for several recipients.
      // Empty disables email notification (enquiries are still persisted).
      inbox: String(env.CONTACT_INBOX || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .join(','),
      // Exact browser origins allowed to POST the form (CORS allow-list).
      allowedOrigins: String(env.CONTACT_ALLOWED_ORIGINS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      // Simple abuse brake: max submissions per IP per hour.
      maxPerHour: int(env.CONTACT_MAX_PER_HOUR, 5),
      // Durable record of every enquiry, written before the email is sent.
      store: env.CONTACT_STORE || 'none', // none | memory | file | firestore
      filePath: env.CONTACT_FILE || './data/enquiries.jsonl',
      firestore: {
        projectId: env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '',
        collection: env.CONTACT_FIRESTORE_COLLECTION || 'enquiries',
        databaseId: env.FIRESTORE_DATABASE_ID || '',
        // Inline service-account JSON for hosts without a writable filesystem.
        credentialsJson: env.FIRESTORE_CREDENTIALS_JSON || '',
      },
    },
    graceRetentionDays: int(env.GRACE_RETENTION_DAYS, 15),
    // Real installs that may authenticate, declared as JSON:
    //   [{"id":"acme","licenseKey":"...","planId":"pro","email":"..."}]
    // Re-seeded on every boot so identities survive cold starts while the
    // tenant store is still in-memory.
    seedTenants: (() => {
      const parsed = safeJson(env.SEED_TENANTS, []);
      return Array.isArray(parsed) ? parsed : [];
    })(),
    // Log one line per HTTP request. Off by default so tests stay quiet.
    requestLog: bool(env.REQUEST_LOG, env.NODE_ENV === 'production'),
  };
}

module.exports = { loadConfig };
