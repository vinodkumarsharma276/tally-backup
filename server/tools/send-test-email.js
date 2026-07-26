#!/usr/bin/env node
'use strict';

/*
 * Send a one-off test email using the configured company mailer, straight from
 * server/.env — no running server or auth token needed. Handy for verifying a
 * Resend / SendGrid key end to end.
 *
 * Usage:
 *   npm run send-test-email -- you@example.com
 *   (with MAILER_PROVIDER=dev it just logs instead of sending)
 */

try { require('dotenv').config(); } catch { /* dotenv optional */ }

const { loadConfig } = require('../src/config');
const { createMailer } = require('../src/mailer');

async function main() {
  const to = process.argv[2] || process.env.TEST_EMAIL_TO;
  if (!to) {
    console.error('Usage: npm run send-test-email -- you@example.com');
    process.exit(1);
  }
  const config = loadConfig();
  const mailer = createMailer(config);
  console.log(`Provider : ${config.mailer.provider}`);
  console.log(`From     : ${config.mailer.from}`);
  console.log(`To       : ${to}`);
  const result = await mailer.send({
    to,
    subject: 'Backup Genie — test email',
    html:
      '<div style="font-family:Segoe UI,Arial,sans-serif">' +
      '<h1 style="color:#2bbc7f">✓ Backup Genie email works</h1>' +
      '<p>This is a test message sent from your company mailer.</p></div>',
  });
  console.log('Sent OK  :', JSON.stringify(result));
}

main().catch((error) => {
  console.error('Send failed:', error.message);
  process.exit(1);
});
