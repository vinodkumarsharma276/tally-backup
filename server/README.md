# VE Tally Backup — Managed Storage Control Plane

A **separate deployable** service (NOT bundled in the desktop installer) that powers the
optional **Managed** storage tier: tenant authentication, short-lived + prefix-scoped
credential vending, and metering/quota.

> **Hard rule:** master cloud keys never ship in the desktop app. The app authenticates to
> this control plane and receives temporary, tenant-scoped credentials (~1h TTL) that it
> refreshes automatically.

## Run locally (offline, no cloud accounts)

```bash
cd server
npm install            # express + jsonwebtoken (optional: better-sqlite3, pg, @aws-sdk/client-sts)
cp .env.example .env   # defaults use in-memory store + dev vending provider
npm start              # listens on :8787, seeds a demo tenant in non-production
npm test               # offline end-to-end test of the whole loop
```

Demo tenant (dev only): `tenantId = demo-tenant`, `licenseKey = DEMO-LICENSE-KEY-123`, plan `pro` (100 GB).

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/healthz` | — | Liveness |
| POST | `/v1/auth/token` | tenantId + licenseKey | Exchange for a short-lived bearer token |
| POST | `/v1/credentials` | Bearer | Vend prefix-scoped storage lease (`tenants/<id>/*`) |
| GET | `/v1/usage` | Bearer | Current usage + quota |
| POST | `/v1/usage/report` | Bearer | Desktop reports `bytesStored` + `bytesUploaded` after a run |
| POST | `/v1/billing/webhook/:provider` | Signature | Subscription lifecycle (activate / renew / payment-failed / cancel) |

Lease shape (all providers): `{ provider:'s3', bucket, region, endpoint, forcePathStyle, prefix,
credentials:{ accessKeyId, secretAccessKey, sessionToken?, expiration }, expiresAt, writable, quota }`.

## Configuration (`.env`)

- `STORE` = `memory` (default) | `sqlite` | `postgres` — pluggable persistence (`src/store/`).
- `VENDING_PROVIDER` = `dev` (default, offline) | `aws-sts` | `b2` | `r2` — pluggable vending (`src/vending/`).
- `MAILER_PROVIDER` = `dev` (default, offline) | `smtp` | `resend` | `sendgrid` — how report emails are sent
  from the company address (`src/mailer/`). Use `smtp` to point at any vendor (Brevo, Zoho ZeptoMail,
  Amazon SES, Mailjet…) with config only — no code change. `MAILER_ADMIN_BCC` optionally copies every
  report to your ops address.
- `MANAGED_BUCKET` / `MANAGED_REGION` / `MANAGED_ENDPOINT` — the managed S3-compatible bucket
  (Cloudflare R2 / Backblaze B2 recommended for cost).
- `DEV_S3_*` — optional real static creds so the dev provider can drive a local MinIO / real S3
  for genuine I/O testing.

## Status vs. the Phase E plan

| Item | Status |
| --- | --- |
| E1 control-plane API + credential vending | **Implemented** (dev provider real; AWS-STS + B2 scaffolded) |
| E2 desktop `managed` profile + refresh client | **Implemented** (`src/versioning/ManagedControlPlaneClient.js`, backend factory) |
| E3 metering & quota | **Implemented** — usage report + bucket-inventory reconciliation service; 80% warn, 100% over-quota -> server vends a **read-only** lease (AWS-STS policy / B2 capabilities); desktop pauses uploads |
| E4 billing (Razorpay / Stripe) | **Implemented** — signed webhooks drive subscription state (active/grace/suspended) + plan->quota; dunning grace period + expiry sweep. Real API keys only needed to go live |
| E5 pack files / lifecycle | **Implemented** (desktop) — `PackedObjectStore` combines chunks into packs + pack-aware GC; auto-enabled for the managed tier |
| E6 compliance / ops | **Implemented** — audit logging (auth / vend / billing / usage), JWT key rotation, data-residency config; see COMPLIANCE.md |

## Production TODO

- Implement `AwsStsProvider` / `B2Provider` / `R2Provider` against real accounts; keep master creds server-side only.
- `PostgresStore` is implemented (`STORE=postgres` + `DATABASE_URL`); validate against a real database.
- Server-side quota enforcement is active via read-only vended credentials (AWS-STS policy / B2 & R2 permissions).
- Billing webhooks; dunning + grace period (`GRACE_RETENTION_DAYS`).
- TLS termination, rate limiting, audit logging (implemented), HA deployment.
