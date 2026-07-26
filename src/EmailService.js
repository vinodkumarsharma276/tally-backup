const nodemailer = require('nodemailer');
const logger = require('./utils/logger');
const { resolveSecretValue } = require('./utils/SecretStore');

const BRAND = 'Backup Genie';
const COLORS = {
  bg: '#0b1820',
  card: '#0f2129',
  border: '#1c2f3a',
  text: '#dbe8ee',
  muted: '#9fb3bd',
  accent: '#2bbc7f',
  accentDark: '#12503a',
  danger: '#e05656',
  dangerDark: '#5e2020',
  warn: '#e6a23c',
};

class EmailService {
  constructor(config) {
    this.config = config || {};
    this.transporter = null;
  }

  /**
   * Initialize the SMTP transporter. Email is optional, so failures are logged
   * rather than thrown.
   */
  async initialize() {
    try {
      if (!this.config.enabled) {
        logger.info('Email notifications are disabled');
        return;
      }
      const password = await resolveSecretValue(this.config.smtp.auth.pass);
      this.transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure,
        auth: { user: this.config.smtp.auth.user, pass: password },
      });
      await this.transporter.verify();
      logger.info('Email service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize email service:', error);
    }
  }

  /**
   * Send a successful backup report. Accepts the full versioned backup result
   * object (see bin/versioned-backup.js `overall`).
   */
  async sendBackupSuccessWithMultipleLinks(result, driveLinks = []) {
    try {
      if (!this.config.enabled || !this.config.sendOnSuccess || !this.transporter) return;
      const normalized = this.normalizeResult(result, driveLinks);
      const subject = `${this.config.subject || `${BRAND} Report`} — Backup successful`;
      await this.sendEmail(subject, this.generateReportEmail('success', normalized));
      logger.info('Backup success email sent successfully');
    } catch (error) {
      logger.error('Failed to send backup success email:', error);
    }
  }

  /**
   * Backwards-compatible single-destination success entry point.
   */
  async sendBackupSuccess(result, driveLink = null) {
    const links = driveLink ? [{ name: 'Backup', link: driveLink, operation: 'backup' }] : [];
    return this.sendBackupSuccessWithMultipleLinks(result, links);
  }

  /**
   * Send a failed backup report.
   */
  async sendBackupFailure(error, result = null) {
    try {
      if (!this.config.enabled || !this.config.sendOnFailure || !this.transporter) return;
      const normalized = this.normalizeResult(result, []);
      normalized.error = (error && error.message) || String(error || 'Unknown error');
      const subject = `${this.config.subject || `${BRAND} Report`} — Backup failed`;
      await this.sendEmail(subject, this.generateReportEmail('failure', normalized));
      logger.info('Backup failure email sent successfully');
    } catch (sendError) {
      logger.error('Failed to send backup failure email:', sendError);
    }
  }

  /**
   * Send a test email to confirm SMTP delivery works.
   */
  async sendTestEmail() {
    if (!this.transporter) {
      throw new Error('Email service is not initialized. Check SMTP settings and try again.');
    }
    const subject = `${this.config.subject || `${BRAND} Report`} — Test email`;
    await this.sendEmail(subject, this.generateTestEmail());
    logger.info('Test email sent successfully');
  }

  async sendEmail(subject, html) {
    if (!this.transporter) throw new Error('Email service is not initialized.');
    await this.transporter.sendMail({
      from: this.config.from,
      to: this.config.to,
      subject,
      html,
    });
  }

  /**
   * Coerce the various result shapes the app has used over time into a single
   * predictable structure for the templates.
   */
  normalizeResult(result, driveLinks = []) {
    const r = result || {};
    const sources = Array.isArray(r.sources) ? r.sources : [];
    const totalChunks = Number(r.totalChunks || sources.reduce((sum, s) => sum + Number(s.totalChunks || 0), 0));
    const newChunks = Number(
      r.totalNewChunks !== undefined
        ? r.totalNewChunks
        : r.filesUploaded || sources.reduce((sum, s) => sum + Number(s.newChunks || 0), 0)
    );
    const links = (Array.isArray(driveLinks) && driveLinks.length ? driveLinks : r.driveLinks) || [];
    return {
      filesProtected: Number(r.totalFilesProcessed || sources.reduce((sum, s) => sum + Number(s.fileCount || 0), 0)),
      totalBytes: Number(r.totalSize || sources.reduce((sum, s) => sum + Number(s.totalBytes || 0), 0)),
      newBytes: Number(r.totalNewBytes || sources.reduce((sum, s) => sum + Number(s.newBytesStored || 0), 0)),
      totalChunks,
      newChunks,
      dedupPercent: totalChunks > 0 ? Math.max(0, Math.min(100, (1 - newChunks / totalChunks) * 100)) : 0,
      duration: Number(r.duration || 0),
      sources,
      links: links.filter((link) => link && link.link),
    };
  }

  // ---- Templates -------------------------------------------------------------

  wrap(headerColor, badge, title, subtitle, body) {
    return `
    <div style="background:${COLORS.bg};padding:24px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
        <div style="background:${headerColor};padding:26px 30px;color:#04150d;">
          <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;font-weight:700;">${BRAND}</div>
          <div style="font-size:23px;font-weight:800;margin-top:6px;">${badge} ${title}</div>
          <div style="font-size:13px;margin-top:4px;opacity:.85;">${subtitle}</div>
        </div>
        <div style="padding:26px 30px;color:${COLORS.text};">
          ${body}
          <div style="margin-top:26px;padding-top:18px;border-top:1px solid ${COLORS.border};color:${COLORS.muted};font-size:12px;line-height:1.6;">
            <div>Generated ${this.formatDate(new Date())}</div>
            <div>${BRAND} · Versioned, deduplicated backups</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  statTile(label, value, accent) {
    return `
      <td style="padding:6px;" width="33%">
        <div style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:11px;padding:14px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:${COLORS.muted};">${label}</div>
          <div style="font-size:19px;font-weight:800;margin-top:5px;color:${accent || COLORS.text};">${value}</div>
        </div>
      </td>`;
  }

  summaryGrid(data) {
    const noChange = data.newChunks === 0;
    return `
      <table style="width:100%;border-collapse:separate;border-spacing:0;margin:0 -6px;">
        <tr>
          ${this.statTile('Files protected', String(data.filesProtected), COLORS.text)}
          ${this.statTile('New data uploaded', this.formatBytes(data.newBytes), COLORS.accent)}
          ${this.statTile('Total data size', this.formatBytes(data.totalBytes), COLORS.text)}
        </tr>
        <tr>
          ${this.statTile('Deduplication saved', `${data.dedupPercent.toFixed(1)}%`, COLORS.accent)}
          ${this.statTile('Duration', this.formatDuration(data.duration), COLORS.text)}
          ${this.statTile('Restore points', String(data.sources.length ? data.sources.length : 1), COLORS.text)}
        </tr>
      </table>
      <div style="margin-top:16px;background:${noChange ? 'rgba(230,162,60,.08)' : 'rgba(43,188,127,.08)'};border-left:4px solid ${noChange ? COLORS.warn : COLORS.accent};border-radius:8px;padding:13px 15px;color:${COLORS.text};font-size:13px;line-height:1.55;">
        ${noChange
          ? 'No changes were detected since the last backup. A new restore point was recorded and your data is fully protected.'
          : `A new restore point was created. Only <strong>${this.formatBytes(data.newBytes)}</strong> of changed data was uploaded thanks to deduplication — the rest was already stored.`}
      </div>`;
  }

  sourceRows(sources) {
    if (!sources.length) return '';
    const rows = sources
      .map((source) => {
        const snapshot = source.snapshotId ? String(source.snapshotId) : '—';
        const kept =
          source.gc && source.gc.keptSnapshots !== undefined ? `${source.gc.keptSnapshots} restore points kept` : '';
        return `
          <div style="padding:14px 16px;border-bottom:1px solid ${COLORS.border};">
            <div style="font-weight:700;color:${COLORS.text};font-size:14px;">↑ ${this.escape(source.name)}</div>
            <div style="color:${COLORS.muted};font-size:12.5px;line-height:1.6;margin-top:4px;">
              Destination: ${this.escape(source.storageLabel || 'Storage')}<br>
              ${Number(source.fileCount || 0)} files · ${this.formatBytes(source.newBytesStored || 0)} new · ${this.formatBytes(source.totalBytes || 0)} total<br>
              Restore point: <span style="font-family:monospace;color:${COLORS.text};">${this.escape(snapshot)}</span>${kept ? ` · ${kept}` : ''}
            </div>
          </div>`;
      })
      .join('');
    return `
      <h3 style="color:${COLORS.text};font-size:15px;margin:26px 0 10px;">Protected sources</h3>
      <div style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">${rows}</div>`;
  }

  linkButtons(links) {
    if (!this.config.includeDriveLink || !links.length) return '';
    const buttons = links
      .map(
        (link) => `
          <a href="${this.escape(link.link)}" style="display:inline-block;margin:6px 8px 0 0;padding:10px 18px;background:${COLORS.accent};color:#04150d;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;">
            Open ${this.escape(link.name || link.folderName || 'backup')}
          </a>`
      )
      .join('');
    return `
      <h3 style="color:${COLORS.text};font-size:15px;margin:26px 0 8px;">Open your backup</h3>
      <div>${buttons}</div>`;
  }

  generateReportEmail(status, data) {
    if (status === 'failure') {
      const body = `
        <div style="background:rgba(224,86,86,.1);border-left:4px solid ${COLORS.danger};border-radius:8px;padding:14px 16px;color:${COLORS.text};font-size:13px;">
          <div style="font-weight:700;color:#f2a3a3;margin-bottom:6px;">Error details</div>
          <div style="font-family:monospace;background:${COLORS.bg};padding:11px;border-radius:6px;word-break:break-word;">${this.escape(data.error || 'Unknown error')}</div>
        </div>
        ${data.filesProtected || data.sources.length
          ? `<h3 style="color:${COLORS.text};font-size:15px;margin:24px 0 10px;">Progress before failure</h3>${this.summaryGrid(data)}`
          : ''}
        ${this.sourceRows(data.sources)}
        <div style="margin-top:22px;background:rgba(230,162,60,.08);border-left:4px solid ${COLORS.warn};border-radius:8px;padding:13px 15px;color:${COLORS.text};font-size:13px;line-height:1.6;">
          <strong style="color:#f2c98a;">What to check</strong>
          <ul style="margin:8px 0 0;padding-left:18px;color:${COLORS.muted};">
            <li>Internet connection and access to the storage destination</li>
            <li>Available space at the destination</li>
            <li>Storage credentials in Settings, then run a manual backup to retry</li>
            <li>Activity logs in the app for the full error</li>
          </ul>
        </div>`;
      return this.wrap(COLORS.danger, '⚠', 'Backup failed', 'Your latest backup did not finish.', body);
    }

    const body = `
      ${this.config.includeStats !== false ? this.summaryGrid(data) : ''}
      ${this.sourceRows(data.sources)}
      ${this.linkButtons(data.links)}`;
    return this.wrap(COLORS.accent, '✓', 'Backup successful', 'A new restore point was created and verified.', body);
  }

  generateTestEmail() {
    const body = `
      <p style="color:${COLORS.muted};font-size:14px;line-height:1.6;margin:0 0 18px;">
        This is a test message from ${BRAND}. If you can read this, email reports are configured correctly and
        you will receive a report after each backup.
      </p>
      <table style="width:100%;border-collapse:separate;border-spacing:0;margin:0 -6px;">
        <tr>
          ${this.statTile('SMTP host', this.escape(this.config.smtp?.host || '—'), COLORS.text)}
          ${this.statTile('Port', String(this.config.smtp?.port || '—'), COLORS.text)}
          ${this.statTile('Sends to', this.escape(this.config.to || '—'), COLORS.text)}
        </tr>
      </table>`;
    return this.wrap(COLORS.accent, '✓', 'Email is working', 'Test message delivered successfully.', body);
  }

  // ---- Formatting helpers ----------------------------------------------------

  escape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Number(bytes) || 0;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size.toFixed(index < 2 ? 0 : 2)} ${units[index]}`;
  }

  formatDuration(ms) {
    const seconds = Math.round((Number(ms) || 0) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return `${minutes}m ${rest}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  formatDate(date) {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }

  // Legacy alias retained for any external callers.
  formatFileSize(bytes) {
    return this.formatBytes(bytes);
  }
}

module.exports = EmailService;
