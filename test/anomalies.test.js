'use strict';

/*
 * Anomaly wording (desktop/anomalies.js).
 *
 * Shipped bug in 0.0.2: the desktop app treated every `anomaly` event as a
 * possible repository reset. When retention clean-up failed — after the
 * snapshot had already saved — users saw "undefined% of data was re-uploaded.
 * The destination may have been reset."
 *
 * Run: node test/anomalies.test.js   (from the repo root)
 */

const { describeAnomaly } = require('../desktop/anomalies');

const results = [];
const check = (name, cond, detail) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
};

const gc = describeAnomaly({ kind: 'anomaly', type: 'gc-failed', sourceName: 'Tally Data', storageLabel: 'drive://Store', message: 'quota' });
const gcText = `${gc.log} ${gc.notify && gc.notify.title} ${gc.notify && gc.notify.body}`;
check('a clean-up failure does not claim data was re-uploaded', !/re-uploaded/i.test(gcText), gcText);
check('a clean-up failure does not suggest a reset', !/reset/i.test(gcText), gcText);
check('a clean-up failure never prints undefined', !/undefined/.test(gcText), gcText);
check('a clean-up failure says the backup was saved', /saved/i.test(gc.notify.title) && /backed up/i.test(gc.notify.body));
check('a clean-up failure keeps the cause in the log', gc.log.includes('quota'));

const reset = describeAnomaly({ kind: 'anomaly', type: 'possible-repository-reset', sourceName: 'Tally Data', storageLabel: 'drive://Store', percentReuploaded: 97 });
check('a repository reset still warns', reset.notify && reset.notify.tone === 'failed');
check('a repository reset quotes the real figure', reset.notify.body.includes('97%'));

const unknown = describeAnomaly({ kind: 'anomaly', type: 'something-new', sourceName: 'X' });
check('an unknown anomaly is logged', unknown.log.includes('something-new'));
check('an unknown anomaly raises no alarm', unknown.notify === null);

const bare = describeAnomaly();
check('a malformed event does not throw or print undefined', !/undefined/.test(bare.log), bare.log);

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
