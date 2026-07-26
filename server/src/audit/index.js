'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Audit logging for the control plane. Records security-relevant actions
 * (authentication, credential vending, billing events, usage reports) as
 * append-only JSON lines. Best-effort: a logging failure never breaks a request.
 *
 * Sinks: none | console | file | memory (tests).
 */

function nowIso() {
  return new Date().toISOString();
}

class NullAuditLog {
  record() {}
}

class ConsoleAuditLog {
  record(action, details = {}) {
    // eslint-disable-next-line no-console
    console.log(`[audit] ${JSON.stringify({ ts: nowIso(), action, ...details })}`);
  }
}

class MemoryAuditLog {
  constructor() {
    this.entries = [];
  }

  record(action, details = {}) {
    this.entries.push({ ts: nowIso(), action, ...details });
  }
}

class FileAuditLog {
  constructor(file) {
    this.file = path.resolve(file);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
    } catch {
      // best effort
    }
  }

  record(action, details = {}) {
    const line = `${JSON.stringify({ ts: nowIso(), action, ...details })}\n`;
    fs.appendFile(this.file, line, () => {});
  }
}

function createAuditLog(config) {
  switch ((config.audit.sink || 'none').toLowerCase()) {
    case 'file':
      return new FileAuditLog(config.audit.file);
    case 'console':
      return new ConsoleAuditLog();
    case 'memory':
      return new MemoryAuditLog();
    case 'none':
    default:
      return new NullAuditLog();
  }
}

module.exports = { createAuditLog, NullAuditLog, ConsoleAuditLog, MemoryAuditLog, FileAuditLog };
