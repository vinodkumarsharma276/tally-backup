'use strict';

/**
 * Company mailer: sends report emails FROM the company address to the customer's
 * recipient. The provider credentials live on the server only. The desktop app
 * never sends mail directly and never holds a password.
 *
 * Providers: dev (records in memory / logs, for offline tests), resend, sendgrid.
 */

/** Providers with a structured API need a list; SMTP takes the string as-is. */
function recipients(to) {
  return String(to || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

class DevMailer {
  constructor(config) {
    this.config = config;
    this.sent = [];
  }

  async send({ to, subject, html, replyTo }) {
    const message = { from: this.config.mailer.from, to, subject, replyTo, at: new Date().toISOString() };
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

  async send({ to, subject, html, replyTo }) {
    if (!this.config.mailer.apiKey) throw new Error('MAILER_API_KEY is required for the resend provider.');
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.mailer.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.config.mailer.from, to: recipients(to), subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Resend send failed (${resp.status}): ${detail || 'no details'}`);
    }
    const body = await resp.json().catch(() => ({}));
    return { id: body.id, provider: 'resend' };
  }
}

class SendgridMailer {
  constructor(config) {
    this.config = config;
  }

  async send({ to, subject, html, replyTo }) {
    if (!this.config.mailer.apiKey) throw new Error('MAILER_API_KEY is required for the sendgrid provider.');
    // Parse "Name <email>" or a bare address for SendGrid's structured `from`.
    const match = /<([^>]+)>/.exec(this.config.mailer.from);
    const fromEmail = match ? match[1] : this.config.mailer.from;
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.mailer.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: recipients(to).map((email) => ({ email })) }],
        from: { email: fromEmail },
        ...(replyTo ? { reply_to: { email: replyTo } } : {}),
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`SendGrid send failed (${resp.status}): ${detail || 'no details'}`);
    }
    return { id: resp.headers.get('x-message-id') || undefined, provider: 'sendgrid' };
  }
}

class SmtpMailer {
  constructor(config) {
    this.config = config;
    this.transporter = null;
  }

  _transport() {
    if (this.transporter) return this.transporter;
    const { host, port, secure, user, pass } = this.config.mailer.smtp;
    if (!host) throw new Error('MAILER_SMTP_HOST is required for the smtp provider.');
    const nodemailer = require('nodemailer');
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
    return this.transporter;
  }

  async send({ to, subject, html, replyTo }) {
    const info = await this._transport().sendMail({ from: this.config.mailer.from, to, subject, html, replyTo });
    return { id: info.messageId, provider: 'smtp' };
  }

  async verify() {
    await this._transport().verify();
    return true;
  }
}

function createMailer(config) {
  switch ((config.mailer.provider || 'dev').toLowerCase()) {
    case 'smtp':
      return new SmtpMailer(config);
    case 'resend':
      return new ResendMailer(config);
    case 'sendgrid':
      return new SendgridMailer(config);
    case 'dev':
    default:
      return new DevMailer(config);
  }
}

module.exports = { createMailer, DevMailer, ResendMailer, SendgridMailer, SmtpMailer };
