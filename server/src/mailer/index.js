'use strict';

/**
 * Company mailer: sends report emails FROM the company address to the customer's
 * recipient. The provider credentials live on the server only. The desktop app
 * never sends mail directly and never holds a password.
 *
 * Providers: dev (records in memory / logs, for offline tests), resend, sendgrid.
 */

class DevMailer {
  constructor(config) {
    this.config = config;
    this.sent = [];
  }

  async send({ to, subject, html }) {
    const message = { from: this.config.mailer.from, to, subject, at: new Date().toISOString() };
    this.sent.push({ ...message, html });
    // eslint-disable-next-line no-console
    console.log(`[mailer:dev] would send "${subject}" from ${message.from} to ${to}`);
    return { id: `dev-${this.sent.length}`, provider: 'dev' };
  }
}

class ResendMailer {
  constructor(config) {
    this.config = config;
  }

  async send({ to, subject, html }) {
    if (!this.config.mailer.apiKey) throw new Error('MAILER_API_KEY is required for the resend provider.');
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.mailer.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.config.mailer.from, to: [to], subject, html }),
    });
    if (!resp.ok) throw new Error(`Resend send failed: ${resp.status}`);
    const body = await resp.json().catch(() => ({}));
    return { id: body.id, provider: 'resend' };
  }
}

class SendgridMailer {
  constructor(config) {
    this.config = config;
  }

  async send({ to, subject, html }) {
    if (!this.config.mailer.apiKey) throw new Error('MAILER_API_KEY is required for the sendgrid provider.');
    // Parse "Name <email>" or a bare address for SendGrid's structured `from`.
    const match = /<([^>]+)>/.exec(this.config.mailer.from);
    const fromEmail = match ? match[1] : this.config.mailer.from;
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.mailer.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    if (!resp.ok) throw new Error(`SendGrid send failed: ${resp.status}`);
    return { id: resp.headers.get('x-message-id') || undefined, provider: 'sendgrid' };
  }
}

function createMailer(config) {
  switch ((config.mailer.provider || 'dev').toLowerCase()) {
    case 'resend':
      return new ResendMailer(config);
    case 'sendgrid':
      return new SendgridMailer(config);
    case 'dev':
    default:
      return new DevMailer(config);
  }
}

module.exports = { createMailer, DevMailer, ResendMailer, SendgridMailer };
