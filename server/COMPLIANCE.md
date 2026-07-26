# VE Tally Backup — Compliance & Operations (Managed Tier)

This document covers privacy, data protection, residency, retention, encryption,
audit, and key-rotation practices for the **managed** storage tier. It is a
working reference for the control plane operator, not legal advice — have counsel
review the customer-facing Privacy Policy and Data Processing Addendum (DPA).

## 1. Roles & scope
- **Controller**: the customer (Tally user) who owns the accounting data.
- **Processor**: VE Tally Backup (operator of the control plane + managed bucket).
- **Sub-processors**: the object-storage provider (Cloudflare R2 / Backblaze B2 /
  AWS S3), the payment provider (Razorpay / Stripe), and hosting/infra. Maintain a
  current sub-processor list in the customer DPA.

## 2. Data inventory
| Data | Where | Purpose |
| --- | --- | --- |
| Backup content (chunks/packs) | Managed bucket, `tenants/<id>/` prefix | The backup service |
| Tenant record (id, email, plan, usage, subscription) | Control-plane store | Auth, billing, quota |
| License key | Stored as a salted **scrypt hash** (never plaintext) | Authentication |
| Audit log (auth, credential vending, billing, usage) | `AUDIT_FILE` / sink | Security & forensics |
| Payment identifiers (subscription id) | Control-plane store | Billing lifecycle |

Card/bank details are handled **only** by the payment provider; the control plane
never stores them.

## 3. India DPDP Act (2023) alignment
- **Lawful basis / consent**: obtain consent at onboarding for processing backup
  data on the managed tier; record consent + timestamp.
- **Purpose limitation**: data is used solely to provide backup/restore.
- **Data minimisation**: only the tenant record + hashed license + usage counters.
- **Data principal rights**: support access, correction, and erasure requests
  (see §6). Provide a grievance/contact channel.
- **Breach notification**: on a confirmed breach, notify the Data Protection Board
  and affected principals per statutory timelines. Use the audit log for scoping.
- **Children's data**: the product targets businesses; do not knowingly onboard
  minors' personal data.

## 4. Data residency
- Backup content is stored in the region set by `DATA_REGION` (default the managed
  bucket region). Offer region choice at signup where the storage provider supports
  it; document the chosen region in the customer's DPA.
- The control-plane database and audit log should be co-located in the same region.

## 5. Encryption & key management
- **In transit**: TLS to the control plane and to the object store.
- **At rest (v1)**: server-side encryption (SSE-S3 / provider-managed keys).
- **Roadmap**: optional client-side zero-knowledge encryption (customer-held key);
  requires a key-recovery UX (a lost key = unrecoverable data).
- **Secret rotation**:
  - **JWT signing** — set `JWT_SECRET` to the new value and `JWT_SECRET_PREVIOUS`
    to the old one; tokens signed with the old secret keep verifying until they
    expire (`TOKEN_TTL_SECONDS`). Remove the previous secret after the window.
  - **Vending master credentials** — rotate the cloud master key/role credentials
    on the server only; the desktop app never holds them and picks up new
    short-lived leases automatically.
  - **Webhook secret** — rotate `BILLING_WEBHOOK_SECRET` in step with the payment
    provider dashboard.

## 6. Tenant isolation & least privilege
- One bucket, prefix-per-tenant `tenants/<id>/`. Vended credentials are scoped to
  that prefix only (AWS-STS session policy / B2 & R2 permission + prefix), read+write
  when active and within quota, **read-only** when over quota or in dunning.
- Cross-tenant access is denied at the credential layer, not just in application code.

## 7. Retention & lifecycle
- On subscription lapse: uploads pause (read-only lease); data is **retained** for
  `GRACE_RETENTION_DAYS`, after which the tenant is suspended and data is eligible
  for deletion per the terms.
- Backup retention within a tenant follows the snapshot retention policy
  (`keepDailyBackups`), enforced by pack-aware GC.
- **Erasure request**: delete the tenant prefix from the bucket, delete the tenant
  record, and retain only the minimal audit trail required for legal/financial
  compliance.

## 8. Audit logging
- Security-relevant actions are recorded as append-only JSON lines: `auth.token`
  (granted/denied), `credentials.vend`, `usage.report`, `billing.webhook`, each with
  timestamp, tenant id, and client IP.
- Ship the audit log to durable, access-controlled storage in production
  (`AUDIT_SINK=file` + log shipping). Restrict read access; monitor for anomalies.

## 9. Operations checklist
- [ ] TLS termination + HSTS in front of the control plane
- [ ] Rate limiting on `/v1/auth/token` and `/v1/credentials`
- [ ] `STORE=postgres` with backups + PITR; audit log shipped off-host
- [ ] Uptime + error-rate monitoring and alerting; on-call runbook
- [ ] Least-privilege IAM for the reconciliation/master credentials
- [ ] Documented incident-response + breach-notification procedure
- [ ] Sub-processor list + DPA kept current
