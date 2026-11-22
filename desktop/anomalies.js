'use strict';

/*
 * Turns an `anomaly` event from a runner into what the desktop app logs and
 * tells the user.
 *
 * Runners emit several kinds of anomaly, distinguished by `type`. Each needs
 * its own wording: treating them all as a repository reset once showed
 * "undefined% of data was re-uploaded. The destination may have been reset."
 * for a run whose snapshot had saved fine and only its clean-up had failed.
 *
 * Pure on purpose — no Electron — so it runs under `npm test`.
 */

function describeAnomaly(event = {}) {
  const source = event.sourceName || 'A backup';

  if (event.type === 'possible-repository-reset') {
    return {
      log: `Anomaly: possible repository reset for '${event.sourceName}' (${event.percentReuploaded}% re-uploaded to ${event.storageLabel}).`,
      notify: {
        title: 'Check your backup storage',
        body: `${source}: ${event.percentReuploaded}% of data was re-uploaded. The destination may have been reset.`,
        tone: 'failed',
      },
    };
  }

  if (event.type === 'gc-failed') {
    // The restore point is already committed when clean-up runs, so this is a
    // warning about disk space, not about the backup.
    return {
      log: `Backup of '${event.sourceName}' saved, but clean-up on ${event.storageLabel} did not finish: ${event.message}`,
      notify: {
        title: 'Backup saved — clean-up incomplete',
        body: `${source} was backed up. Removing old restore points did not finish and will be retried next run.`,
        tone: 'success',
      },
    };
  }

  // Unknown types are recorded but never shown as an alarm: a message we have
  // not written cannot be trusted to be accurate.
  return {
    log: `Anomaly: ${event.type || 'unknown'}${event.sourceName ? ` for '${event.sourceName}'` : ''}.`,
    notify: null,
  };
}

module.exports = { describeAnomaly };
