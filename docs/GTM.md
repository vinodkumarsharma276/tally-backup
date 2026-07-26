# VE Tally Backup — Go-To-Market (Phase C)

Working GTM reference. Numbers are placeholders — replace with your validated cloud
costs and local pricing before launch.

## 1. Positioning
**"Automatic, versioned, off-site backup for Tally — set it once, restore any day."**

- For non-technical Tally users: no scripts, no cloud accounts, no manual copies.
- Versioned restore points (not just a mirror): recover yesterday, last week, or the
  day before a corruption — deduplicated so only changed data is uploaded.
- Two ways to buy: **bring your own storage** (Google Drive / S3 / NAS) or **managed
  cloud** (we host it, metered, paid).

## 2. Ideal customer profile (ICP)
- SMB businesses and accounting/CA firms running Tally on Windows.
- 1–20 seats; data sets from a few hundred MB to several GB.
- Pain: manual/no backups, USB copies, fear of ransomware/disk failure/theft.

## 3. Packaging & pricing (SKUs)
| SKU | What | Price basis |
| --- | --- | --- |
| **BYOS** (software-only) | App + versioned engine to the customer's own Drive/S3/NAS | Flat annual license per device |
| **Managed Starter** | + 25 GB hosted, encrypted, off-site | Monthly/annual; cloud cost × 2–4 margin |
| **Managed Pro** | + 100 GB | Monthly/annual |
| **Managed Business** | + 500 GB | Monthly/annual |

- Managed backing store: Cloudflare R2 / Backblaze B2 (cheap, near-zero egress) →
  best margin; AWS S3 as a premium "named" tier.
- Upsell path: land on **BYOS**, convert non-technical users to **Managed**.

## 4. Funnel
1. **Acquire**: Tally user communities, CA/accountant networks, YouTube how-tos,
   local resellers, SEO ("Tally backup to cloud", "Tally data recovery").
2. **Activate**: one-click installer → **onboarding wizard** → first backup in
   minutes. Time-to-first-backup is the north-star activation metric.
3. **Convert**: free BYOS trial or time-limited; in-app "Upgrade to Managed" when
   they lack reliable storage or hit friction.
4. **Retain**: reliable scheduled backups, email reports, restore drills; quota
   warnings at 80% → upsell to a bigger plan.
5. **Expand**: multi-company/multi-device, firm-wide plans for CAs managing many
   clients.

## 5. Trust & objection handling
- **Security**: OS credential vault for secrets, TLS + at-rest encryption, tenant
  isolation with short-lived scoped credentials (see COMPLIANCE.md).
- **"Is my data safe/compliant?"**: DPDP-aligned, data-residency choice, clear
  retention and erasure. Publish a Privacy Policy + DPA.
- **"What if I stop paying?"**: uploads pause but data is retained through a grace
  period before suspension — no surprise data loss.
- **Code-signed installer** + auto-update for a trustworthy install experience.

## 6. Launch checklist
- [ ] Pricing validated against real R2/B2 cost per GB + request pricing (packs cut
      request cost — factor into margin)
- [ ] Published, verified Google OAuth client (BYOS Drive) — see B3
- [ ] Code-signing certificate applied to the installer — see B4/B5
- [ ] Auto-update feed live on the release repo — see auto-update section
- [ ] Payment provider (Razorpay/Stripe) live keys + webhook wired to the control plane
- [ ] Privacy Policy, Terms, DPA published; support/grievance contact
- [ ] Landing page with the two SKUs + a "restore in 60 seconds" demo
- [ ] Onboarding email sequence + in-app upgrade prompts

## 7. Key metrics
- Time-to-first-backup, activation rate, BYOS→Managed conversion, GB stored per
  tenant, gross margin per managed GB, monthly churn, restore success rate.
