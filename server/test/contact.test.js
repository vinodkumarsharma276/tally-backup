'use strict';

/*
 * Offline test of the public website enquiry form endpoint: origin allow-list,
 * validation, honeypot, HTML escaping and the per-IP rate limit.
 *
 * Run: node server/test/contact.test.js   (from the repo root)
 */

const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/MemoryStore');
const { createVendingProvider } = require('../src/vending');
const { DevMailer } = require('../src/mailer');
const { createApp } = require('../src/app');

const ORIGIN = 'https://vinodkumarsharma276.github.io';

async function main() {
  const config = loadConfig({
    STORE: 'memory',
    VENDING_PROVIDER: 'dev',
    MAILER_PROVIDER: 'dev',
    CONTACT_INBOX: 'sales@backupgenie.app',
    CONTACT_ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
    CONTACT_MAX_PER_HOUR: '2',
    NODE_ENV: 'test',
  });
  const store = new MemoryStore();
  await store.init();
  const mailer = new DevMailer(config);
  const app = createApp({ config, store, vendingProvider: createVendingProvider(config), billingProvider: null, mailer });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const results = [];
  const check = (name, cond) => {
    results.push([name, !!cond]);
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  };

  const post = (body, headers = {}) =>
    fetch(`${base}/v1/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    });

  const valid = {
    name: 'Asha Rao',
    email: 'asha@example.com',
    company: 'Rao & Co',
    topic: 'Early access',
    message: 'We run Tally on four machines and want nightly backups to our own Drive.',
  };

  try {
    const ok = await post(valid);
    check('accepts a valid enquiry', ok.status === 200);
    check('emails the configured inbox', mailer.sent.length === 1 && mailer.sent[0].to === 'sales@backupgenie.app');
    check('replies go to the enquirer', mailer.sent[0].replyTo === 'asha@example.com');
    check('cors header echoes the allowed origin', ok.headers.get('access-control-allow-origin') === ORIGIN);

    const foreign = await post(valid, { Origin: 'https://evil.example.com' });
    check('rejects a foreign origin (403)', foreign.status === 403);

    const preflight = await fetch(`${base}/v1/contact`, { method: 'OPTIONS', headers: { Origin: ORIGIN } });
    check('preflight allowed for the site origin', preflight.status === 204);

    const badEmail = await post({ ...valid, email: 'nope' });
    check('rejects an invalid email (400)', badEmail.status === 400);

    const shortMessage = await post({ ...valid, message: 'hi' });
    check('rejects an empty message (400)', shortMessage.status === 400);

    const before = mailer.sent.length;
    const honeypot = await post({ ...valid, website: 'http://spam.example' });
    check('honeypot silently drops bots', honeypot.status === 200 && mailer.sent.length === before);

    const injection = await post({ ...valid, message: '<script>alert(1)</script> please call me' });
    check('escapes html in the message', injection.status === 200 && !/<script>/.test(mailer.sent[mailer.sent.length - 1].html));

    const limited = await post(valid);
    check('rate limit kicks in (429)', limited.status === 429);

    // With no inbox configured the endpoint must not silently swallow enquiries.
    const offConfig = loadConfig({ STORE: 'memory', MAILER_PROVIDER: 'dev', NODE_ENV: 'test' });
    const offApp = createApp({ config: offConfig, store, vendingProvider: createVendingProvider(offConfig), billingProvider: null, mailer: new DevMailer(offConfig) });
    const offServer = await new Promise((resolve) => {
      const s = offApp.listen(0, () => resolve(s));
    });
    const offResp = await fetch(`http://127.0.0.1:${offServer.address().port}/v1/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    });
    offServer.close();
    check('unconfigured form reports 503', offResp.status === 503);
  } finally {
    server.close();
    await store.close();
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('CONTACT TEST ERROR', error);
  process.exit(2);
});
