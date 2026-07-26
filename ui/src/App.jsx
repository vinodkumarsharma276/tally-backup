import React, { useEffect, useMemo, useRef, useState } from 'react';

const api = window.tallyDesktop;
const PAGES = [
  ['overview', 'Overview', '⌂'],
  ['sources', 'Backup & restore', '⇄'],
  ['storage', 'Storage', '◫'],
  ['restore', 'Restore points', '↶'],
  ['logs', 'Activity logs', '≡'],
  ['settings', 'Settings', '⚙'],
];

function cx(...values) {
  return values.filter(Boolean).join(' ');
}

function bytes(value = 0) {
  if (!Number.isFinite(Number(value))) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(value);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function displayDate(value) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function storageName(type) {
  return {
    google_drive: 'Google Drive',
    local: 'Local folder',
    network: 'Network / NAS',
    s3: 'Amazon S3 compatible',
    azure_blob: 'Azure Blob',
    managed: 'Managed cloud',
  }[type] || type || 'Storage';
}

function Pill({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Button({ variant = 'primary', busy, children, className, ...props }) {
  return (
    <button className={cx('button', `button-${variant}`, className)} disabled={busy || props.disabled} {...props}>
      {busy && <span className="spinner" />}
      {children}
    </button>
  );
}

function Field({ label, hint, action, className, ...props }) {
  return (
    <label className={cx('field', className)}>
      <span className="field-label">{label}{action}</span>
      <input {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function SelectField({ label, children, ...props }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select {...props}>{children}</select>
    </label>
  );
}

function EmptyState({ icon = '○', title, text, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function ProgressPanel({ operation, progress, operationLogs, onCancel }) {
  if (!operation && !progress) return null;
  const total = Number(progress?.totalBytes || 0);
  const processed = Number(progress?.processedBytes || 0);
  const percent = total ? Math.min(100, (processed / total) * 100) : operation?.status === 'success' ? 100 : 0;
  const status = operation?.status || 'running';
  return (
    <section className={cx('progress-panel', `progress-${status}`)}>
      <div className="progress-topline">
        <div>
          <div className="eyebrow">{operation?.type === 'restore' ? 'Restoring data' : 'Backup in progress'}</div>
          <h3>{status === 'success' ? 'Completed successfully' : status === 'failed' ? 'Operation failed' : 'Your data is being protected'}</h3>
        </div>
        {status === 'running' && <Button variant="ghost" onClick={onCancel}>Stop</Button>}
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
      <div className="progress-metrics">
        <strong>{percent.toFixed(1)}%</strong>
        <span>{bytes(processed)} of {bytes(total)}</span>
        <span>{progress?.filesDone || 0} / {progress?.fileCount || 0} files</span>
        {progress?.newBytesStored !== undefined && <span>{bytes(progress.newBytesStored)} uploaded</span>}
      </div>
      {operationLogs.length > 0 && <div className="progress-message">{operationLogs[operationLogs.length - 1]}</div>}
    </section>
  );
}

function Overview({ config, operation, progress, operationLogs, startBackup, cancelOperation, setPage }) {
  const sources = config.backup?.sources || [];
  const enabled = sources.filter((source) => source.enabled !== false);
  const backups = enabled.filter((source) => source.operation === 'backup');
  const restores = enabled.filter((source) => source.operation === 'restore');
  const profileCount = Object.keys(config.storageProfiles || {}).length;
  const retention = config.retention?.keepDailyBackups || 30;

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div className="hero-copy">
          <Pill tone="success">System ready</Pill>
          <h2>Your data, protected automatically.</h2>
          <p>Versioned backups preserve every restore point while uploading only data that changed.</p>
          <div className="hero-actions">
            <Button onClick={startBackup} disabled={Boolean(operation?.status === 'running')}>Run backup now</Button>
            <Button variant="secondary" onClick={() => setPage('restore')}>Restore data</Button>
          </div>
        </div>
        <div className="shield-visual">
          <div className="shield-ring ring-one" />
          <div className="shield-ring ring-two" />
          <div className="shield-core">✓</div>
          <span>Protected</span>
        </div>
      </section>

      <ProgressPanel operation={operation} progress={progress} operationLogs={operationLogs} onCancel={cancelOperation} />

      <section className="metric-grid">
        <article className="metric-card"><span className="metric-icon green">↑</span><div><b>{backups.length}</b><span>Active backups</span></div></article>
        <article className="metric-card"><span className="metric-icon blue">↶</span><div><b>{restores.length}</b><span>Restore jobs</span></div></article>
        <article className="metric-card"><span className="metric-icon violet">◫</span><div><b>{profileCount}</b><span>Storage options</span></div></article>
        <article className="metric-card"><span className="metric-icon amber">◷</span><div><b>{retention} days</b><span>Restore history</span></div></article>
      </section>

      <section className="card">
        <div className="section-heading">
          <div><span className="eyebrow">Configured jobs</span><h3>Backup and restore sources</h3></div>
          <Button variant="ghost" onClick={() => setPage('sources')}>Manage</Button>
        </div>
        <div className="source-summary-list">
          {enabled.map((source) => (
            <div className="source-summary" key={source.name}>
              <div className={cx('source-badge', source.operation)}>{source.operation === 'backup' ? '↑' : '↓'}</div>
              <div className="source-summary-main"><strong>{source.name}</strong><span>{source.sourcePath}</span></div>
              <div className="source-summary-meta"><Pill tone={source.operation === 'backup' ? 'success' : 'info'}>{source.operation}</Pill><span>{source.storageProfile || source.backupFolderName}</span></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Sources({ config, setConfig, chooseDirectory }) {
  const sources = config.backup?.sources || [];
  const profiles = Object.keys(config.storageProfiles || {});
  const update = (index, patch) => setConfig((current) => ({
    ...current,
    backup: {
      ...current.backup,
      sources: current.backup.sources.map((source, i) => i === index ? { ...source, ...patch } : source),
    },
  }));
  const remove = (index) => setConfig((current) => ({
    ...current,
    backup: { ...current.backup, sources: current.backup.sources.filter((_, i) => i !== index) },
  }));
  const add = () => setConfig((current) => ({
    ...current,
    backup: {
      ...current.backup,
      sources: [...current.backup.sources, {
        name: `Source ${current.backup.sources.length + 1}`,
        enabled: true,
        operation: 'backup',
        sourcePath: '',
        storageProfile: profiles[0] || '',
      }],
    },
  }));

  return (
    <div className="page-stack">
      <div className="page-title-row"><div><span className="eyebrow">Data jobs</span><h2>Backup & restore sources</h2><p>Choose what to protect, where to store it, and when restores should run.</p></div><Button onClick={add}>+ Add source</Button></div>
      {sources.map((source, index) => (
        <article className="card source-editor" key={`${source.name}-${index}`}>
          <div className="source-editor-head">
            <div className={cx('source-badge', source.operation)}>{source.operation === 'backup' ? '↑' : '↓'}</div>
            <div><h3>{source.name || 'Unnamed source'}</h3><span>{source.operation === 'backup' ? 'Local data → storage' : 'Storage → local folder'}</span></div>
            <label className="toggle"><input type="checkbox" checked={source.enabled !== false} onChange={(event) => update(index, { enabled: event.target.checked })} /><span /></label>
          </div>
          <div className="form-grid three">
            <Field label="Display name" value={source.name || ''} onChange={(event) => update(index, { name: event.target.value })} />
            <SelectField label="Operation" value={source.operation} onChange={(event) => update(index, { operation: event.target.value, restore: event.target.value === 'restore' ? (source.restore || { mode: 'manual', snapshotId: 'latest', cleanDest: false, timezone: 'Asia/Kolkata' }) : source.restore })}>
              <option value="backup">Backup</option><option value="restore">Restore</option>
            </SelectField>
            <SelectField label="Storage profile" value={source.storageProfile || ''} onChange={(event) => update(index, { storageProfile: event.target.value })}>
              <option value="">Choose storage…</option>{profiles.map((name) => <option key={name}>{name}</option>)}
            </SelectField>
          </div>
          <div className="path-row">
            <Field label={source.operation === 'backup' ? 'Source folder' : 'Restore destination'} value={source.sourcePath || ''} onChange={(event) => update(index, { sourcePath: event.target.value })} />
            <Button variant="secondary" onClick={async () => { const selected = await chooseDirectory(source.sourcePath); if (selected) update(index, { sourcePath: selected }); }}>Browse</Button>
          </div>
          {source.operation === 'restore' && (
            <div className="subpanel">
              <div className="form-grid three">
                <SelectField label="Restore mode" value={source.restore?.mode || 'manual'} onChange={(event) => update(index, { restore: { ...source.restore, mode: event.target.value } })}><option value="manual">Manual</option><option value="scheduled">Scheduled</option></SelectField>
                <Field label="Snapshot" value={source.restore?.snapshotId || 'latest'} onChange={(event) => update(index, { restore: { ...source.restore, snapshotId: event.target.value } })} />
                {source.restore?.mode === 'scheduled' && <Field label="Cron schedule" value={source.restore?.schedule || ''} onChange={(event) => update(index, { restore: { ...source.restore, schedule: event.target.value } })} />}
              </div>
              <label className="check-row"><input type="checkbox" checked={source.restore?.cleanDest === true} onChange={(event) => update(index, { restore: { ...source.restore, cleanDest: event.target.checked } })} /><span>Clear destination before restoring</span></label>
            </div>
          )}
          <div className="card-footer"><Button variant="danger-ghost" onClick={() => remove(index)}>Remove source</Button></div>
        </article>
      ))}
    </div>
  );
}

const publicProfileFields = {
  google_drive: [['rootFolderName', 'Drive folder']],
  local: [['rootDir', 'Local destination']],
  network: [['rootDir', 'UNC / mapped drive path']],
  s3: [['bucket', 'Bucket'], ['region', 'Region'], ['endpoint', 'Endpoint'], ['prefix', 'Prefix']],
  azure_blob: [['accountUrl', 'Account URL'], ['containerName', 'Container'], ['prefix', 'Prefix']],
  managed: [['controlPlaneUrl', 'Control plane URL'], ['tenantId', 'Account / tenant ID']],
};

function Storage({ config, setConfig, chooseDirectory, testStorage, startGoogleAuth, testingProfile }) {
  const profiles = config.storageProfiles || {};
  const secretStatus = config._secretStatus || { storageProfiles: {} };
  const update = (name, patch) => setConfig((current) => ({ ...current, storageProfiles: { ...current.storageProfiles, [name]: { ...current.storageProfiles[name], ...patch } } }));
  const updateAuth = (name, patch) => setConfig((current) => ({
    ...current,
    storageProfiles: {
      ...current.storageProfiles,
      [name]: {
        ...current.storageProfiles[name],
        auth: { ...(current.storageProfiles[name].auth || {}), ...patch },
      },
    },
  }));
  const rename = (oldName, newName) => {
    if (!newName || newName === oldName || profiles[newName]) return;
    setConfig((current) => {
      const nextProfiles = { ...current.storageProfiles };
      nextProfiles[newName] = nextProfiles[oldName];
      delete nextProfiles[oldName];
      return {
        ...current,
        storageProfiles: nextProfiles,
        backup: { ...current.backup, sources: current.backup.sources.map((source) => source.storageProfile === oldName ? { ...source, storageProfile: newName } : source) },
      };
    });
  };
  const addProfile = () => {
    let name = 'new-local-storage';
    let count = 2;
    while (profiles[name]) name = `new-local-storage-${count++}`;
    setConfig((current) => ({ ...current, storageProfiles: { ...current.storageProfiles, [name]: { type: 'local', rootDir: '' } } }));
  };

  return (
    <div className="page-stack">
      <div className="page-title-row"><div><span className="eyebrow">Destinations</span><h2>Storage</h2><p>Connect customer-owned or managed storage and test access before a backup.</p></div><Button onClick={addProfile}>+ Add storage</Button></div>
      <div className="storage-grid">
        {Object.entries(profiles).map(([name, profile]) => (
          <article className="card storage-card" key={name}>
            <div className="storage-head"><div className={`provider-logo provider-${profile.type}`}>{profile.type === 'google_drive' ? 'G' : profile.type === 'azure_blob' ? 'A' : profile.type === 's3' ? 'S3' : profile.type === 'network' ? 'N' : profile.type === 'managed' ? 'VE' : 'L'}</div><div><h3>{name}</h3><span>{storageName(profile.type)}</span></div><Pill tone={profile.tenancy === 'managed' ? 'violet' : 'neutral'}>{profile.tenancy || 'customer'}</Pill></div>
            <div className="form-grid">
              <Field label="Profile name" defaultValue={name} onBlur={(event) => rename(name, event.target.value.trim())} />
              <SelectField label="Provider" value={profile.type} onChange={(event) => update(name, { type: event.target.value })}>
                <option value="google_drive">Google Drive</option><option value="local">Local folder</option><option value="network">Network / NAS</option><option value="s3">S3 compatible</option><option value="azure_blob">Azure Blob</option><option value="managed">Managed cloud</option>
              </SelectField>
            </div>
            {(publicProfileFields[profile.type] || []).map(([key, label]) => (
              <div className={key === 'rootDir' ? 'path-row compact' : ''} key={key}>
                <Field label={label} value={profile[key] || ''} onChange={(event) => update(name, { [key]: event.target.value })} />
                {key === 'rootDir' && <Button variant="secondary" onClick={async () => { const selected = await chooseDirectory(profile[key]); if (selected) update(name, { [key]: selected }); }}>Browse</Button>}
              </div>
            ))}
            {profile.type === 'network' && <div className="form-grid secret-fields"><Field label="Network username" value={profile.auth?.username || ''} onChange={(event) => updateAuth(name, { username: event.target.value })} /><Field type="password" label="Network password" value={profile.auth?.password || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter password'} onChange={(event) => updateAuth(name, { password: event.target.value })} /></div>}
            {profile.type === 's3' && <div className="form-grid secret-fields"><Field type="password" label="Access key ID" value={profile.auth?.accessKeyId || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter access key'} onChange={(event) => updateAuth(name, { accessKeyId: event.target.value })} /><Field type="password" label="Secret access key" value={profile.auth?.secretAccessKey || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter secret key'} onChange={(event) => updateAuth(name, { secretAccessKey: event.target.value })} /></div>}
            {profile.type === 'managed' && <div className="form-grid secret-fields"><Field type="password" label="License key" value={profile.auth?.licenseKey || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter license key'} onChange={(event) => updateAuth(name, { licenseKey: event.target.value })} /></div>}
            {profile.type === 'azure_blob' && <><SelectField label="Azure authentication" value={profile.auth?.mode || 'interactive'} onChange={(event) => updateAuth(name, { mode: event.target.value })}><option value="interactive">Microsoft interactive sign-in</option><option value="default">Azure development credential</option><option value="managed_identity">Managed identity</option><option value="sas">SAS token</option></SelectField>{profile.auth?.mode === 'sas' && <Field type="password" label="SAS token" value={profile.auth?.sasToken || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter SAS token'} onChange={(event) => updateAuth(name, { sasToken: event.target.value })} />}</>}
            <div className={cx('credential-note', (profile.type === 'google_drive' ? secretStatus.googleToken : secretStatus.storageProfiles?.[name]) && 'credential-stored')}>
              <span>{(profile.type === 'google_drive' ? secretStatus.googleToken : secretStatus.storageProfiles?.[name]) ? '✓' : '○'}</span>
              {profile.type === 'google_drive'
                ? `${secretStatus.googleToken ? 'Your Google account is connected. Authorization is stored securely in the OS vault.' : 'Click "Connect Google" to authorize your own Google account.'}`
                : secretStatus.storageProfiles?.[name]
                  ? 'Credentials are stored in the operating system credential vault.'
                  : ['local'].includes(profile.type) ? 'This provider does not require a password.' : 'Enter credentials and save to move them into secure OS storage.'}
            </div>
            <div className="card-footer storage-actions">
              <Button variant="secondary" busy={testingProfile === name} onClick={() => testStorage(name)}>Test connection</Button>
              {profile.type === 'google_drive' && <Button variant="ghost" onClick={startGoogleAuth}>Connect Google</Button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Restore({ config, snapshots, snapshotsMeta, loadSnapshots, startRestore, chooseDirectory, operation }) {
  const restoreSources = (config.backup?.sources || []).filter((source) => source.operation === 'restore' && source.enabled !== false);
  const [sourceName, setSourceName] = useState(restoreSources[0]?.name || '');
  const [snapshotId, setSnapshotId] = useState('latest');
  const [destination, setDestination] = useState(restoreSources[0]?.sourcePath || '');
  useEffect(() => {
    const source = restoreSources.find((item) => item.name === sourceName);
    if (source) setDestination(source.sourcePath || '');
  }, [sourceName]);

  if (!restoreSources.length) return <EmptyState icon="↶" title="No restore source configured" text="Add an enabled restore source first." />;
  return (
    <div className="page-stack">
      <div className="page-title-row"><div><span className="eyebrow">Recovery</span><h2>Restore points</h2><p>Browse complete historical snapshots and restore one into a safe local folder.</p></div><Button variant="secondary" onClick={() => loadSnapshots(sourceName)}>Refresh</Button></div>
      <section className="card restore-controls">
        <div className="form-grid three">
          <SelectField label="Restore job" value={sourceName} onChange={(event) => { setSourceName(event.target.value); setSnapshotId('latest'); }}>
            {restoreSources.map((source) => <option key={source.name}>{source.name}</option>)}
          </SelectField>
          <SelectField label="Restore point" value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)}>
            <option value="latest">Latest available</option>{snapshots.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>{displayDate(snapshot.createdAt)} · {snapshot.fileCount} files</option>)}
          </SelectField>
          <div className="field"><span className="field-label">Storage</span><div className="static-field">{snapshotsMeta || 'Load restore points'}</div></div>
        </div>
        <div className="path-row"><Field label="Restore destination" value={destination} onChange={(event) => setDestination(event.target.value)} /><Button variant="secondary" onClick={async () => { const selected = await chooseDirectory(destination); if (selected) setDestination(selected); }}>Browse</Button></div>
        <div className="restore-warning"><strong>Safe restore</strong><span>Choose a separate folder. The engine blocks restoring over an active backup source.</span></div>
        <Button onClick={() => startRestore({ sourceName, snapshotId, destPath: destination })} disabled={operation?.status === 'running'}>Start restore</Button>
      </section>
      <section className="card">
        <div className="section-heading"><div><span className="eyebrow">Available history</span><h3>{snapshots.length} restore points</h3></div></div>
        {snapshots.length ? <div className="snapshot-list">{snapshots.map((snapshot, index) => <button className={cx('snapshot-row', snapshotId === snapshot.id && 'selected')} key={snapshot.id} onClick={() => setSnapshotId(snapshot.id)}><span className="timeline-dot" /><div><strong>{index === 0 ? 'Latest · ' : ''}{displayDate(snapshot.createdAt)}</strong><span>{snapshot.source} · {snapshot.fileCount} files · {bytes(snapshot.totalBytes)}</span></div><span className="snapshot-id">{snapshot.id}</span></button>)}</div> : <EmptyState title="Load restore points" text="Choose a restore source and click Refresh." />}
      </section>
    </div>
  );
}

function Logs({ logs, refreshLogs, operationLogs }) {
  const lines = [...logs, ...operationLogs].slice(-400);
  return <div className="page-stack"><div className="page-title-row"><div><span className="eyebrow">Diagnostics</span><h2>Activity logs</h2><p>Readable operational history for troubleshooting and support.</p></div><Button variant="secondary" onClick={refreshLogs}>Refresh logs</Button></div><section className="log-viewer">{lines.length ? lines.map((line, index) => <div className="log-line" key={`${index}-${line}`}><span>{String(index + 1).padStart(3, '0')}</span><code>{line}</code></div>) : <EmptyState title="No logs yet" text="Run a backup or storage test to see activity here." />}</section></div>;
}

function Settings({ config, setConfig, testEmail, emailTesting, schedulerState, systemInfo, onOpenWizard, updateState, checkForUpdates, installUpdate }) {
  const backup = config.backup || {};
  const retention = config.retention || {};
  const email = config.email || {};
  const desktop = config.desktop || {};
  const smtp = email.smtp || {};
  const auth = smtp.auth || {};
  const updateBackup = (patch) => setConfig((current) => ({ ...current, backup: { ...current.backup, ...patch } }));
  const updateRetention = (patch) => setConfig((current) => ({ ...current, retention: { ...current.retention, ...patch } }));
  const updateEmail = (patch) => setConfig((current) => ({ ...current, email: { ...current.email, ...patch } }));
  const updateDesktop = (patch) => setConfig((current) => ({ ...current, desktop: { ...current.desktop, ...patch } }));
  const updateSmtp = (patch) => updateEmail({ smtp: { ...smtp, ...patch } });
  const updateAuth = (patch) => updateSmtp({ auth: { ...auth, ...patch } });
  return <div className="page-stack"><div className="page-title-row"><div><span className="eyebrow">Preferences</span><h2>Settings</h2><p>Control backup timing, retention, concurrency, and notifications.</p></div></div>
    <section className="card"><div className="section-heading"><div><span className="eyebrow">Desktop behavior</span><h3>Tray & startup</h3></div><div className="section-heading-actions"><Button variant="secondary" onClick={onOpenWizard}>Re-run setup</Button><Pill tone={schedulerState?.enabled ? 'success' : 'neutral'}>{schedulerState?.enabled ? `${schedulerState.jobs.length} schedules active` : 'Schedules paused'}</Pill></div></div>
      <div className="preference-list">
        <label className="preference-row"><div><strong>Start when I sign into Windows</strong><span>Launch hidden in the notification area so scheduled backups can run.</span></div><label className="toggle"><input type="checkbox" checked={desktop.autoStart !== false} onChange={(event) => updateDesktop({ autoStart: event.target.checked })} /><span /></label></label>
        <label className="preference-row"><div><strong>Keep running in the notification area</strong><span>Closing the window hides it; choose Quit from the tray menu to stop.</span></div><label className="toggle"><input type="checkbox" checked={desktop.minimizeToTray !== false} onChange={(event) => updateDesktop({ minimizeToTray: event.target.checked })} /><span /></label></label>
        <label className="preference-row"><div><strong>Show completion notifications</strong><span>Receive success, failure, and skipped-job alerts.</span></div><label className="toggle"><input type="checkbox" checked={desktop.notifications !== false} onChange={(event) => updateDesktop({ notifications: event.target.checked })} /><span /></label></label>
        <label className="preference-row"><div><strong>Run configured schedules</strong><span>Pause this to keep manual backup and restore available without automatic jobs.</span></div><label className="toggle"><input type="checkbox" checked={desktop.schedulerEnabled !== false} onChange={(event) => updateDesktop({ schedulerEnabled: event.target.checked })} /><span /></label></label>
      </div>
      {!systemInfo?.packaged && <div className="credential-note">Auto-start is applied by the installed application. Development mode does not register a login item.</div>}
      {schedulerState?.errors?.length > 0 && <div className="scheduler-errors">{schedulerState.errors.map((error) => <span key={error}>{error}</span>)}</div>}
      {schedulerState?.jobs?.length > 0 && <div className="schedule-list">{schedulerState.jobs.map((job) => <div key={`${job.label}-${job.expression}`}><strong>{job.label}</strong><span>{job.expression}</span><em>{job.timezone}</em></div>)}</div>}
    </section>
    <section className="card"><div className="section-heading"><div><span className="eyebrow">Automation</span><h3>Schedule & performance</h3></div></div><div className="form-grid three"><Field label="Backup cron" value={backup.schedule || ''} onChange={(event) => updateBackup({ schedule: event.target.value })} hint="Example: 0 20 * * * = daily at 8 PM" /><Field type="number" min="1" max="32" label="Concurrent transfers" value={backup.concurrency || 8} onChange={(event) => updateBackup({ concurrency: Number(event.target.value) })} /><Field type="number" min="1" label="Daily retention (days)" value={retention.keepDailyBackups || 30} onChange={(event) => updateRetention({ keepDailyBackups: Number(event.target.value) })} /></div></section>
    <section className="card"><div className="section-heading"><div><span className="eyebrow">Notifications</span><h3>Email reports</h3></div><label className="toggle"><input type="checkbox" checked={email.enabled === true} onChange={(event) => updateEmail({ enabled: event.target.checked })} /><span /></label></div><div className="form-grid three"><Field label="SMTP host" value={smtp.host || ''} onChange={(event) => updateSmtp({ host: event.target.value })} /><Field type="number" label="Port" value={smtp.port || 587} onChange={(event) => updateSmtp({ port: Number(event.target.value) })} /><Field label="Account" value={auth.user || ''} onChange={(event) => updateAuth({ user: event.target.value })} /><Field type="password" label="App password" value={auth.pass || ''} placeholder={config._secretStatus?.emailPassword ? 'Stored securely' : 'Enter app password'} onChange={(event) => updateAuth({ pass: event.target.value })} /><Field label="Send report to" value={email.to || ''} onChange={(event) => updateEmail({ to: event.target.value })} /><Field label="Subject" value={email.subject || ''} onChange={(event) => updateEmail({ subject: event.target.value })} /></div><div className={cx('credential-note', config._secretStatus?.emailPassword && 'credential-stored')}><span>{config._secretStatus?.emailPassword ? '✓' : '○'}</span>{config._secretStatus?.emailPassword ? 'SMTP password is stored in the operating system credential vault.' : 'The password will be moved to secure OS storage when saved.'}</div><div className="card-footer"><Button variant="secondary" busy={emailTesting} onClick={testEmail}>Send test email</Button></div></section>
    <section className="card"><div className="section-heading"><div><span className="eyebrow">Maintenance</span><h3>Updates</h3></div><Pill tone={updateState?.status === 'downloaded' ? 'success' : updateState?.status === 'error' ? 'warn' : 'neutral'}>{({ idle: 'Up to date', none: 'Up to date', checking: 'Checking…', available: 'Downloading', downloading: 'Downloading', downloaded: 'Ready to install', error: 'Check failed', unsupported: 'Installed app only' }[updateState?.status] || 'Up to date')}</Pill></div>
      <div className="preference-list">
        <div className="preference-row"><div><strong>Current version</strong><span>Backup Genie {systemInfo?.version || ''}</span></div>{updateState?.status === 'downloaded' ? <Button variant="primary" onClick={installUpdate}>Restart to update</Button> : <Button variant="secondary" busy={updateState?.status === 'checking'} onClick={checkForUpdates}>Check for updates</Button>}</div>
        {updateState?.status === 'downloading' && <div className="preference-row"><div><strong>Downloading update</strong><span>{updateState.progress || 0}% complete</span></div></div>}
        {updateState?.status === 'downloaded' && <div className="credential-note credential-stored"><span>✓</span>Version {updateState.version} will install automatically when you quit, or click Restart to update now.</div>}
        {updateState?.status === 'error' && <div className="credential-note"><span>!</span>{updateState.error || 'Could not check for updates.'}</div>}
        {!systemInfo?.packaged && <div className="credential-note">Automatic updates are only active in the installed application.</div>}
      </div>
    </section>
  </div>;
}

const STORAGE_OPTIONS = [
  { type: 'managed', title: 'Managed cloud', desc: 'Our hosted, paid storage — no cloud account needed.', icon: 'BG' },
  { type: 'google_drive', title: 'Google Drive', desc: 'Back up to your own Google Drive account.', icon: 'G' },
  { type: 'local', title: 'Local / external drive', desc: 'A second drive or folder on this PC.', icon: 'L' },
  { type: 'network', title: 'Network / NAS', desc: 'A shared folder or NAS device.', icon: 'N' },
  { type: 's3', title: 'Amazon S3 / compatible', desc: 'AWS S3, Backblaze B2, Wasabi, R2, MinIO.', icon: 'S3' },
  { type: 'azure_blob', title: 'Azure Blob', desc: 'Microsoft Azure Blob Storage.', icon: 'A' },
];

const SCHEDULE_PRESETS = [
  ['0 20 * * *', 'Every day at 8:00 PM'],
  ['0 21 * * *', 'Every day at 9:00 PM'],
  ['0 22 * * *', 'Every day at 10:00 PM'],
  ['0 13 * * *', 'Every day at 1:00 PM'],
  ['0 */6 * * *', 'Every 6 hours'],
];

const WIZARD_STEPS = ['Welcome', 'Data folder', 'Storage', 'Connect', 'Schedule', 'Notifications', 'First backup', 'Done'];

function providerConfigured(p) {
  if (p.type === 'managed') return !!(p.controlPlaneUrl && p.tenantId && p.licenseKey);
  if (p.type === 'google_drive') return !!p.rootFolderName;
  if (p.type === 'local' || p.type === 'network') return !!p.rootDir;
  if (p.type === 's3') return !!(p.bucket && p.region && p.accessKeyId && p.secretAccessKey);
  if (p.type === 'azure_blob') return !!(p.accountUrl && p.containerName && (p.azureMode !== 'sas' || p.sasToken));
  return false;
}

function initWizardDraft(base) {
  const src = (base.backup?.sources || []).find((s) => s.operation === 'backup');
  return {
    tallyPath: src?.sourcePath || '',
    provider: {
      type: 'google_drive', rootFolderName: 'Backup Genie', rootDir: '', bucket: '', region: 'ap-south-1',
      endpoint: '', prefix: 'backup-genie', accessKeyId: '', secretAccessKey: '', accountUrl: '', containerName: '',
      azureMode: 'interactive', sasToken: '', tenantId: '', authUsername: '', authPassword: '',
      controlPlaneUrl: '', licenseKey: '',
    },
    schedule: base.backup?.schedule || '0 20 * * *',
    retention: base.retention?.keepDailyBackups || 30,
    email: { enabled: false, to: '' },
  };
}

function buildOnboardingConfig(base, draft, complete) {
  const p = draft.provider;
  const existingPrimary = base.storageProfiles?.primary || {};
  const profile = { type: p.type, secretId: existingPrimary.secretId || 'primary' };
  if (p.type === 'google_drive') profile.rootFolderName = p.rootFolderName || 'Backup Genie';
  if (p.type === 'local' || p.type === 'network') profile.rootDir = p.rootDir;
  if (p.type === 'network') {
    const auth = {};
    if (p.authUsername) auth.username = p.authUsername;
    if (p.authPassword) auth.password = p.authPassword;
    if (Object.keys(auth).length) profile.auth = auth;
  }
  if (p.type === 's3') {
    profile.bucket = p.bucket;
    profile.region = p.region;
    if (p.endpoint) profile.endpoint = p.endpoint;
    profile.prefix = p.prefix || 'backup-genie';
    profile.auth = { accessKeyId: p.accessKeyId, secretAccessKey: p.secretAccessKey };
  }
  if (p.type === 'azure_blob') {
    profile.accountUrl = p.accountUrl;
    profile.containerName = p.containerName;
    if (p.prefix) profile.prefix = p.prefix;
    const auth = { mode: p.azureMode || 'interactive' };
    if (p.azureMode === 'sas') auth.sasToken = p.sasToken;
    if (p.tenantId) auth.tenantId = p.tenantId;
    profile.auth = auth;
  }
  if (p.type === 'managed') {
    profile.controlPlaneUrl = p.controlPlaneUrl;
    profile.tenantId = p.tenantId;
    profile.auth = { licenseKey: p.licenseKey };
  }

  const backupSource = { name: 'My Data', enabled: true, operation: 'backup', sourcePath: draft.tallyPath, storageProfile: 'primary' };
  if (p.type === 'google_drive') backupSource.backupFolderName = p.rootFolderName || 'Backup Genie';
  const otherSources = (base.backup?.sources || []).filter((s) => s.name !== 'My Data');

  const email = draft.email.enabled
    ? {
        ...(base.email || {}), enabled: true, mode: 'company',
        to: draft.email.to, subject: base.email?.subject || 'Backup Genie Report',
        sendOnSuccess: true, sendOnFailure: true, includeStats: true, includeDriveLink: true,
      }
    : { ...(base.email || {}), enabled: false };

  return {
    ...base,
    storageProfiles: { ...(base.storageProfiles || {}), primary: profile },
    backup: { ...(base.backup || {}), sources: [backupSource, ...otherSources], schedule: draft.schedule || '0 20 * * *', concurrency: base.backup?.concurrency || 8 },
    retention: { ...(base.retention || {}), keepDailyBackups: Number(draft.retention) || 30 },
    email,
    onboarding: { completed: complete ? true : Boolean(base.onboarding?.completed), version: 1 },
  };
}

function WizardProviderDetails({ provider, setProvider, chooseDirectory }) {
  const set = (patch) => setProvider((current) => ({ ...current, ...patch }));
  if (provider.type === 'managed') {
    return (
      <>
        <Field label="Control plane URL" value={provider.controlPlaneUrl} onChange={(e) => set({ controlPlaneUrl: e.target.value })} hint="Provided with your Managed subscription, e.g. https://cloud.backupgenie.app" />
        <div className="form-grid secret-fields">
          <Field label="Account / tenant ID" value={provider.tenantId} onChange={(e) => set({ tenantId: e.target.value })} />
          <Field type="password" label="License key" value={provider.licenseKey} onChange={(e) => set({ licenseKey: e.target.value })} />
        </div>
      </>
    );
  }
  if (provider.type === 'google_drive') {
    return <Field label="Drive folder name" value={provider.rootFolderName} onChange={(e) => set({ rootFolderName: e.target.value })} hint="A dedicated folder created in your Google Drive." />;
  }
  if (provider.type === 'local' || provider.type === 'network') {
    return (
      <>
        <div className="path-row">
          <Field label={provider.type === 'network' ? 'Network path (\\\\server\\share or mapped drive)' : 'Backup folder on this PC'} value={provider.rootDir} onChange={(e) => set({ rootDir: e.target.value })} />
          <Button variant="secondary" onClick={async () => { const s = await chooseDirectory(provider.rootDir); if (s) set({ rootDir: s }); }}>Browse</Button>
        </div>
        {provider.type === 'network' && (
          <div className="form-grid secret-fields">
            <Field label="Network username (optional)" value={provider.authUsername} onChange={(e) => set({ authUsername: e.target.value })} />
            <Field type="password" label="Network password (optional)" value={provider.authPassword} onChange={(e) => set({ authPassword: e.target.value })} />
          </div>
        )}
      </>
    );
  }
  if (provider.type === 's3') {
    return (
      <>
        <div className="form-grid"><Field label="Bucket" value={provider.bucket} onChange={(e) => set({ bucket: e.target.value })} /><Field label="Region" value={provider.region} onChange={(e) => set({ region: e.target.value })} /></div>
        <div className="form-grid"><Field label="Endpoint (optional — R2 / B2 / MinIO)" value={provider.endpoint} onChange={(e) => set({ endpoint: e.target.value })} /><Field label="Prefix" value={provider.prefix} onChange={(e) => set({ prefix: e.target.value })} /></div>
        <div className="form-grid secret-fields"><Field type="password" label="Access key ID" value={provider.accessKeyId} onChange={(e) => set({ accessKeyId: e.target.value })} /><Field type="password" label="Secret access key" value={provider.secretAccessKey} onChange={(e) => set({ secretAccessKey: e.target.value })} /></div>
      </>
    );
  }
  if (provider.type === 'azure_blob') {
    return (
      <>
        <div className="form-grid"><Field label="Account URL" value={provider.accountUrl} onChange={(e) => set({ accountUrl: e.target.value })} hint="https://<account>.blob.core.windows.net" /><Field label="Container" value={provider.containerName} onChange={(e) => set({ containerName: e.target.value })} /></div>
        <div className="form-grid"><Field label="Prefix" value={provider.prefix} onChange={(e) => set({ prefix: e.target.value })} /><SelectField label="Authentication" value={provider.azureMode} onChange={(e) => set({ azureMode: e.target.value })}><option value="interactive">Microsoft sign-in</option><option value="default">Azure default credential</option><option value="managed_identity">Managed identity</option><option value="sas">SAS token</option></SelectField></div>
        {provider.azureMode === 'sas' && <Field type="password" label="SAS token" value={provider.sasToken} onChange={(e) => set({ sasToken: e.target.value })} />}
        {provider.azureMode === 'interactive' && <Field label="Tenant ID (optional)" value={provider.tenantId} onChange={(e) => set({ tenantId: e.target.value })} />}
      </>
    );
  }
  return null;
}

function OnboardingWizard({ baseConfig, onSavedConfig, onFinish, operation, progress, operationLogs, notify }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => initWizardDraft(baseConfig));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const lastStep = WIZARD_STEPS.length - 1;
  const chooseDirectory = (defaultPath) => api.chooseDirectory({ defaultPath });
  const setProvider = (updater) => setDraft((current) => ({ ...current, provider: typeof updater === 'function' ? updater(current.provider) : { ...current.provider, ...updater } }));
  const scheduleValues = SCHEDULE_PRESETS.map(([value]) => value);

  const stepValid = (index) => {
    if (index === 1) return !!draft.tallyPath;
    if (index === 3) return providerConfigured(draft.provider);
    if (index === 4) return !!draft.schedule;
    if (index === 5) return !draft.email.enabled || !!draft.email.to;
    return true;
  };
  const canSkip = (index) => index === 5 || index === 6;

  const persist = async (complete = false) => {
    const built = buildOnboardingConfig(baseConfig, draft, complete);
    const result = await api.saveConfig(built);
    onSavedConfig(result.config);
    return result;
  };
  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await persist(false);
      const result = await api.testStorage('primary');
      setTestResult({ ok: true, message: `${storageName(result.profileType)} connection successful.` });
    } catch (error) {
      setTestResult({ ok: false, message: error.message });
    } finally {
      setTesting(false);
    }
  };
  const connectGoogle = async () => {
    setTestResult(null);
    try {
      await persist(false);
      await api.startOperation({ type: 'auth-google' });
      setTestResult({ ok: true, message: 'Google sign-in opened in your browser. Finish it, then Test connection.' });
    } catch (error) {
      setTestResult({ ok: false, message: error.message });
    }
  };
  const runFirstBackup = async () => {
    try { await persist(false); await api.startOperation({ type: 'backup' }); }
    catch (error) { notify(error.message, 'error'); }
  };
  const finish = async () => {
    setSaving(true);
    try { await persist(true); onFinish(); }
    catch (error) { notify(error.message, 'error'); setSaving(false); }
  };

  const renderStep = () => {
    if (step === 0) {
      return (
        <div className="wizard-welcome">
          <div className="wizard-hero-mark">🛡️</div>
          <h2>Welcome to Backup Genie</h2>
          <p>This quick setup protects your data with automatic, versioned backups. It takes about a minute — you can change everything later in Settings.</p>
          <ul className="wizard-check-list">
            <li>Pick the folder that holds your data</li>
            <li>Choose where backups are stored</li>
            <li>Set a daily schedule and start your first backup</li>
          </ul>
        </div>
      );
    }
    if (step === 1) {
      return (
        <div className="wizard-step-body">
          <span className="eyebrow">Step 1</span>
          <h2>Where is the data you want to back up?</h2>
          <p>Select the folder that contains the data you want to protect (for example, your accounting or business data folder).</p>
          <div className="path-row">
            <Field label="Data folder" value={draft.tallyPath} onChange={(e) => setDraft((d) => ({ ...d, tallyPath: e.target.value }))} />
            <Button variant="secondary" onClick={async () => { const s = await chooseDirectory(draft.tallyPath); if (s) setDraft((d) => ({ ...d, tallyPath: s })); }}>Browse</Button>
          </div>
        </div>
      );
    }
    if (step === 2) {
      return (
        <div className="wizard-step-body">
          <span className="eyebrow">Step 2</span>
          <h2>Where should backups be stored?</h2>
          <p>Choose a destination. You can add more later.</p>
          <div className="wizard-choice-grid">
            {STORAGE_OPTIONS.map((option) => (
              <button key={option.type} className={cx('wizard-choice', draft.provider.type === option.type && 'selected')} onClick={() => setProvider({ type: option.type })}>
                <span className={`provider-logo provider-${option.type}`}>{option.icon}</span>
                <strong>{option.title}</strong>
                <span className="wizard-choice-desc">{option.desc}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (step === 3) {
      return (
        <div className="wizard-step-body">
          <span className="eyebrow">Step 3</span>
          <h2>Connect {storageName(draft.provider.type)}</h2>
          <p>Enter the details, then test the connection before continuing.</p>
          <div className="wizard-fields"><WizardProviderDetails provider={draft.provider} setProvider={setProvider} chooseDirectory={chooseDirectory} /></div>
          <div className="wizard-inline-actions">
            <Button variant="secondary" busy={testing} disabled={!providerConfigured(draft.provider)} onClick={runTest}>Test connection</Button>
            {draft.provider.type === 'google_drive' && <Button variant="ghost" onClick={connectGoogle}>Connect Google</Button>}
          </div>
          {testResult && <div className={cx('wizard-result', testResult.ok ? 'ok' : 'error')}><span>{testResult.ok ? '✓' : '!'}</span>{testResult.message}</div>}
          <div className="credential-note"><span>🔒</span>Any password, key, or token is stored in the operating system credential vault, never in plain text.</div>
        </div>
      );
    }
    if (step === 4) {
      return (
        <div className="wizard-step-body">
          <span className="eyebrow">Step 4</span>
          <h2>How often should we back up?</h2>
          <p>Pick a schedule and how many days of history to keep.</p>
          <div className="form-grid">
            <SelectField label="How often" value={scheduleValues.includes(draft.schedule) ? draft.schedule : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setDraft((d) => ({ ...d, schedule: e.target.value })); }}>
              {SCHEDULE_PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="custom">Custom schedule…</option>
            </SelectField>
            <Field type="number" min="1" label="Days of history to keep" value={draft.retention} onChange={(e) => setDraft((d) => ({ ...d, retention: Number(e.target.value) }))} />
          </div>
          <Field label="Cron expression" value={draft.schedule} onChange={(e) => setDraft((d) => ({ ...d, schedule: e.target.value }))} hint="Advanced: standard cron format (minute hour day month weekday)." />
        </div>
      );
    }
    if (step === 5) {
      const email = draft.email;
      const setEmail = (patch) => setDraft((d) => ({ ...d, email: { ...d.email, ...patch } }));
      return (
        <div className="wizard-step-body">
          <span className="eyebrow">Step 5 · Optional</span>
          <h2>Email reports</h2>
          <p>Get a report emailed after each backup. Reports are sent from Backup Genie — you only need to provide your email address.</p>
          <label className="preference-row"><div><strong>Email me backup reports</strong><span>We send them from Backup Genie to the address below.</span></div><label className="toggle"><input type="checkbox" checked={email.enabled} onChange={(e) => setEmail({ enabled: e.target.checked })} /><span /></label></label>
          {email.enabled && (
            <Field label="Send reports to" value={email.to} onChange={(e) => setEmail({ to: e.target.value })} hint="The email address where you want to receive backup reports." />
          )}
        </div>
      );
    }
    if (step === 6) {
      const running = operation?.status === 'running';
      return (
        <div className="wizard-step-body">
          <span className="eyebrow">Step 6 · Optional</span>
          <h2>Run your first backup</h2>
          <p>Start a backup now to confirm everything works. Large data sets can take a while — you can skip and let the schedule run it later.</p>
          <Button onClick={runFirstBackup} disabled={running}>{running ? 'Backup running…' : 'Run first backup now'}</Button>
          <ProgressPanel operation={operation} progress={progress} operationLogs={operationLogs} onCancel={api.cancelOperation} />
        </div>
      );
    }
    return (
      <div className="wizard-welcome">
        <div className="wizard-hero-mark">✓</div>
        <h2>You're all set</h2>
        <p>Backup Genie will protect your data on the schedule you chose and stay ready in the notification area.</p>
        <div className="wizard-summary">
          <div><span>Data folder</span><strong>{draft.tallyPath || 'Not set'}</strong></div>
          <div><span>Storage</span><strong>{storageName(draft.provider.type)}</strong></div>
          <div><span>Schedule</span><strong>{(SCHEDULE_PRESETS.find(([v]) => v === draft.schedule) || [])[1] || draft.schedule}</strong></div>
          <div><span>History</span><strong>{draft.retention} days</strong></div>
          <div><span>Email reports</span><strong>{draft.email.enabled ? 'On' : 'Off'}</strong></div>
        </div>
      </div>
    );
  };

  return (
    <div className="wizard-overlay">
      <div className="wizard">
        <aside className="wizard-sidebar">
          <div className="brand"><div className="brand-mark">BG</div><div><strong>Backup Genie</strong><span>Guided setup</span></div></div>
          <ol className="wizard-steps">
            {WIZARD_STEPS.map((label, index) => (
              <li key={label} className={cx(index === step && 'active', index < step && 'done')}><span>{index < step ? '✓' : index + 1}</span>{label}</li>
            ))}
          </ol>
          <div className="wizard-tip">Everything here can be changed later in Settings.</div>
        </aside>
        <div className="wizard-main">
          <div className="wizard-body">{renderStep()}</div>
          <div className="wizard-footer">
            <div>{step > 0 && <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button>}</div>
            <div className="wizard-footer-right">
              {canSkip(step) && <Button variant="secondary" onClick={() => setStep((s) => s + 1)}>Skip</Button>}
              {step < lastStep
                ? <Button disabled={!stepValid(step)} onClick={() => setStep((s) => s + 1)}>Continue</Button>
                : <Button busy={saving} onClick={finish}>Finish setup</Button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const initialConfigLoaded = useRef(false);
  const [page, setPage] = useState('overview');
  const [config, setConfig] = useState(null);
  const [configFile, setConfigFile] = useState('');
  const [systemInfo, setSystemInfo] = useState(null);
  const [schedulerState, setSchedulerState] = useState({ enabled: false, jobs: [], errors: [] });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [operation, setOperation] = useState(null);
  const [progress, setProgress] = useState(null);
  const [operationLogs, setOperationLogs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsMeta, setSnapshotsMeta] = useState('');
  const [testingProfile, setTestingProfile] = useState('');
  const [emailTesting, setEmailTesting] = useState(false);
  const [toast, setToast] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [updateState, setUpdateState] = useState({ status: 'idle' });

  const notify = (message, tone = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4200);
  };

  useEffect(() => {
    Promise.all([api.getConfig(), api.getSystemInfo(), api.getOperationStatus(), api.getLogs(180), api.getSchedulerStatus(), api.getUpdateStatus()])
      .then(([configResult, info, status, initialLogs, initialScheduler, initialUpdate]) => {
        initialConfigLoaded.current = false;
        setConfig(configResult.config);
        setConfigFile(configResult.path);
        setSystemInfo(info);
        setOperation(status);
        setLogs(initialLogs);
        setSchedulerState(initialScheduler || { enabled: false, jobs: [], errors: [] });
        if (initialUpdate) setUpdateState(initialUpdate);
        if (!configResult.config.onboarding?.completed) setShowWizard(true);
      })
      .catch((error) => notify(error.message, 'error'));
    const unsubProgress = api.onProgress((payload) => setProgress(payload));
    const unsubLog = api.onOperationLog((payload) => setOperationLogs((current) => [...current.slice(-249), payload.line]));
    const unsubState = api.onOperationState((state) => {
      setOperation(state);
      if (state.status === 'running') {
        setProgress(null);
        setOperationLogs([]);
      } else {
        notify(state.status === 'success' ? 'Operation completed successfully.' : 'Operation failed. Check Activity logs.', state.status === 'success' ? 'success' : 'error');
        api.getLogs(180).then(setLogs);
      }
    });
    const unsubScheduler = api.onSchedulerState((state) => setSchedulerState(state));
    const unsubUpdate = api.onUpdateState((state) => setUpdateState(state));
    return () => { unsubProgress(); unsubLog(); unsubState(); unsubScheduler(); unsubUpdate(); };
  }, []);

  useEffect(() => {
    if (!config) return;
    if (!initialConfigLoaded.current) {
      initialConfigLoaded.current = true;
      setDirty(false);
      return;
    }
    setDirty(true);
  }, [config]);
  const enabledBackupCount = useMemo(() => (config?.backup?.sources || []).filter((source) => source.enabled !== false && source.operation === 'backup').length, [config]);

  const applySecureSaveResult = (result) => {
    if (result.scheduler) setSchedulerState(result.scheduler);
    if (result.config) {
      initialConfigLoaded.current = false;
      setConfig(result.config);
    }
    setDirty(false);
  };

  const persistIfNeeded = async () => {
    if (!dirty) return null;
    const result = await api.saveConfig(config);
    applySecureSaveResult(result);
    return result;
  };

  const save = async () => {
    setSaving(true);
    try { const result = await api.saveConfig(config); applySecureSaveResult(result); notify('Configuration saved securely.'); }
    catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  };
  const chooseDirectory = (defaultPath) => api.chooseDirectory({ defaultPath });
  const startBackup = async () => {
    try {
      if (!enabledBackupCount) throw new Error('Enable at least one backup source first.');
      await persistIfNeeded();
      await api.startOperation({ type: 'backup' });
    } catch (error) { notify(error.message, 'error'); }
  };
  const startRestore = async (request) => {
    try {
      await persistIfNeeded();
      await api.startOperation({ type: 'restore', ...request });
    } catch (error) { notify(error.message, 'error'); }
  };
  const startGoogleAuth = async () => {
    try { await api.startOperation({ type: 'auth-google' }); }
    catch (error) { notify(error.message, 'error'); }
  };
  const testStorage = async (name) => {
    setTestingProfile(name);
    try {
      await persistIfNeeded();
      const result = await api.testStorage(name);
      notify(`${storageName(result.profileType)} connection successful.`);
    } catch (error) { notify(error.message, 'error'); }
    finally { setTestingProfile(''); }
  };
  const loadSnapshots = async (sourceName) => {
    try { const result = await api.listSnapshots(sourceName); setSnapshots(result.snapshots); setSnapshotsMeta(result.storageLabel); }
    catch (error) { notify(error.message, 'error'); }
  };
  const refreshLogs = () => api.getLogs(300).then(setLogs).catch((error) => notify(error.message, 'error'));
  const checkForUpdates = async () => {
    try { const state = await api.checkForUpdates(); setUpdateState(state); if (state.status === 'unsupported') notify('Updates are only available in the installed app.', 'error'); }
    catch (error) { notify(error.message, 'error'); }
  };
  const installUpdate = () => api.installUpdate();
  const testEmail = async () => {
    setEmailTesting(true);
    try { await persistIfNeeded(); await api.testEmail(); notify('Test email sent.'); }
    catch (error) { notify(error.message, 'error'); }
    finally { setEmailTesting(false); }
  };

  if (!config) return <div className="loading-screen"><div className="brand-mark large">BG</div><div className="loading-bar"><span /></div><p>Preparing your backup workspace…</p></div>;

  if (showWizard) {
    return (
      <OnboardingWizard
        baseConfig={config}
        onSavedConfig={(saved) => { initialConfigLoaded.current = false; setConfig(saved); }}
        onFinish={() => setShowWizard(false)}
        operation={operation}
        progress={progress}
        operationLogs={operationLogs}
        notify={notify}
      />
    );
  }

  let content;
  if (page === 'overview') content = <Overview {...{ config, operation, progress, operationLogs, startBackup, cancelOperation: api.cancelOperation, setPage }} />;
  if (page === 'sources') content = <Sources {...{ config, setConfig, chooseDirectory }} />;
  if (page === 'storage') content = <Storage {...{ config, setConfig, chooseDirectory, testStorage, startGoogleAuth, testingProfile }} />;
  if (page === 'restore') content = <Restore {...{ config, snapshots, snapshotsMeta, loadSnapshots, startRestore, chooseDirectory, operation }} />;
  if (page === 'logs') content = <Logs {...{ logs, refreshLogs, operationLogs }} />;
  if (page === 'settings') content = <Settings {...{ config, setConfig, testEmail, emailTesting, schedulerState, systemInfo, onOpenWizard: () => setShowWizard(true), updateState, checkForUpdates, installUpdate }} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">BG</div><div><strong>Backup Genie</strong><span>Business protection</span></div></div>
        <nav>{PAGES.map(([key, label, icon]) => <button key={key} className={cx(page === key && 'active')} onClick={() => setPage(key)}><span>{icon}</span>{label}</button>)}</nav>
        <div className="sidebar-status"><span className={cx('status-pulse', schedulerState.enabled ? '' : 'paused')} /><div><strong>{schedulerState.enabled ? 'Schedules active' : 'Schedules paused'}</strong><span>{schedulerState.jobs.length} jobs · Version {systemInfo?.version || '1.1.0'}</span></div></div>
      </aside>
      <main>
        <header className="topbar"><div><h1>{PAGES.find(([key]) => key === page)?.[1]}</h1><span className="config-path" title={configFile}>{configFile}</span></div><div className="topbar-actions"><Pill tone={operation?.status === 'running' ? 'info' : 'success'}>{operation?.status === 'running' ? 'Running' : 'Ready'}</Pill><Button variant={dirty ? 'primary' : 'secondary'} busy={saving} onClick={save}>{dirty ? 'Save changes' : 'Saved'}</Button></div></header>
        {(updateState.status === 'available' || updateState.status === 'downloading' || updateState.status === 'downloaded') && (
          <div className={cx('update-banner', updateState.status === 'downloaded' && 'ready')}>
            <span className="update-dot" />
            <div className="update-banner-text">
              {updateState.status === 'downloaded'
                ? `Version ${updateState.version} is ready to install.`
                : updateState.status === 'downloading'
                  ? `Downloading update… ${updateState.progress || 0}%`
                  : `Version ${updateState.version} is available and downloading.`}
            </div>
            {updateState.status === 'downloaded' && <Button variant="primary" onClick={installUpdate}>Restart to update</Button>}
          </div>
        )}
        <div className="content">{content}</div>
      </main>
      {toast && <div className={cx('toast', `toast-${toast.tone}`)}><span>{toast.tone === 'error' ? '!' : '✓'}</span>{toast.message}</div>}
    </div>
  );
}
