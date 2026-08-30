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

const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

const TIMEZONES = (() => {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return all.length ? all : [SYSTEM_TIMEZONE, 'Asia/Kolkata', 'UTC'];
})();

function TimezoneField({ value, onChange, hint }) {
  return (
    <SelectField label="Time zone" value={value || SYSTEM_TIMEZONE} onChange={onChange} hint={hint}>
      {!TIMEZONES.includes(value || SYSTEM_TIMEZONE) && <option value={value}>{value}</option>}
      {TIMEZONES.map((zone) => (
        <option key={zone} value={zone}>
          {zone === SYSTEM_TIMEZONE ? `${zone} (this computer)` : zone}
        </option>
      ))}
    </SelectField>
  );
}

function displayDate(value) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: SYSTEM_TIMEZONE,
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

function RunHistory({ runHistory, refreshHistory, openFolder }) {
  const [days, setDays] = useState('7');
  const cutoff = days === 'all' ? 0 : Date.now() - Number(days) * 86400000;
  const rows = (runHistory || []).filter((run) => new Date(run.completedAt || run.startedAt).getTime() >= cutoff);

  return (
    <section className="card">
      <div className="section-heading">
        <div><span className="eyebrow">History</span><h3>Recent activity</h3></div>
        <div className="section-heading-actions">
          <select value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">Everything</option>
          </select>
          <Button variant="ghost" onClick={refreshHistory}>Refresh</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No runs in this period" text="Backups and restores appear here once they finish." />
      ) : (
        <div className="history-list">
          {rows.map((run, index) => (
            <div className="history-row" key={`${run.completedAt}-${index}`}>
              <span className={cx('history-dot', run.status)} />
              <div className="history-main">
                <strong>{run.type === 'restore' ? 'Restore' : 'Backup'}{run.sourceName ? ` · ${run.sourceName}` : ''}</strong>
                <span>{displayDate(run.completedAt || run.startedAt)} · {run.origin === 'scheduled' ? 'Scheduled' : 'Manual'}{run.durationMs ? ` · ${Math.max(1, Math.round(run.durationMs / 1000))}s` : ''}</span>
              </div>
              <div className="history-meta">
                <Pill tone={run.status === 'success' ? 'success' : 'warn'}>{run.status === 'success' ? 'Succeeded' : 'Failed'}</Pill>
                {run.type === 'restore' && run.destPath && (
                  <Button variant="ghost" onClick={() => openFolder(run.destPath)}>Open folder</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Overview({ config, operation, progress, operationLogs, startBackup, startRestore, cancelOperation, setPage, openFolder, runHistory, refreshHistory, lastRestorePath }) {
  const sources = config.backup?.sources || [];
  const running = operation?.status === 'running';
  const enabled = sources.filter((source) => source.enabled !== false);
  const backups = enabled.filter((source) => source.operation === 'backup');
  const restores = enabled.filter((source) => source.operation === 'restore');
  const profileCount = Object.keys(config.storageProfiles || {}).length;
  // Retention varies per storage profile, so a single global figure would mislead.
  const lastBackup = (runHistory || []).find((run) => run.type === 'backup' && run.status === 'success');
  const lastRunLabel = lastBackup ? displayDate(lastBackup.completedAt).split(',')[0] : 'None yet';

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div className="hero-copy">
          <Pill tone="success">System ready</Pill>
          <h2>Your data, protected automatically.</h2>
          <p>Versioned backups preserve every restore point while uploading only data that changed.</p>
          <div className="hero-actions">
            <Button onClick={() => startBackup()} disabled={running}>Back up all sources</Button>
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

      {operation?.type === 'restore' && operation?.status === 'success' && (lastRestorePath || operation.destPath) && (
        <section className="card restore-done">
          <div>
            <strong>Your files are restored.</strong>
            <span>{lastRestorePath || operation.destPath}</span>
          </div>
          <Button onClick={() => openFolder(lastRestorePath || operation.destPath)}>Open restored folder</Button>
        </section>
      )}

      <section className="metric-grid">
        <article className="metric-card"><span className="metric-icon green">↑</span><div><b>{backups.length}</b><span>Active backups</span></div></article>
        <article className="metric-card"><span className="metric-icon blue">↶</span><div><b>{restores.length}</b><span>Restore jobs</span></div></article>
        <article className="metric-card"><span className="metric-icon violet">◫</span><div><b>{profileCount}</b><span>Storage options</span></div></article>
        <article className="metric-card"><span className="metric-icon amber">◷</span><div><b>{lastRunLabel}</b><span>Last backup</span></div></article>
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
              <div className="source-actions">
                {source.operation === 'backup' ? (
                  <Button variant="secondary" disabled={running} onClick={() => startBackup(source.name)}>Back up</Button>
                ) : (
                  <>
                    <Button variant="ghost" onClick={() => openFolder(source.sourcePath)}>Open folder</Button>
                    <Button variant="secondary" disabled={running} onClick={() => startRestore({ sourceName: source.name, snapshotId: source.restore?.snapshotId || 'latest', destPath: source.sourcePath })}>Restore</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <RunHistory runHistory={runHistory} refreshHistory={refreshHistory} openFolder={openFolder} />
    </div>
  );
}

function profileSummary(profile) {
  if (!profile) return 'No storage selected';
  const prefix = profile.prefix || profile.rootPrefix;
  if (profile.type === 'google_drive') return `Google Drive folder “${profile.rootFolderName || '—'}”`;
  if (profile.type === 'local') return `This computer: ${profile.rootDir || '—'}`;
  if (profile.type === 'network') return `Network: ${profile.rootDir || '—'}`;
  if (profile.type === 's3') return `S3 ${profile.bucket || '—'}${prefix ? `/${prefix}` : ''}`;
  if (profile.type === 'azure_blob') return `Azure ${profile.containerName || '—'}${prefix ? `/${prefix}` : ''}`;
  if (profile.type === 'managed') return `Managed cloud (${profile.tenantId || '—'})`;
  return storageName(profile.type);
}

// A source may run at several times a day; older configs held a single cron.
function schedulesOf(source, fallback) {
  if (Array.isArray(source.schedules) && source.schedules.length) return source.schedules;
  if (source.schedule) return [source.schedule];
  return fallback ? [fallback] : [DEFAULT_SCHEDULE];
}

// A backup source may write to several destinations; older configs used one.
function destinationsOf(source) {
  if (Array.isArray(source.storageProfiles) && source.storageProfiles.length) return source.storageProfiles;
  return source.storageProfile ? [source.storageProfile] : [];
}

function defaultLabel(folderPath) {
  const parts = String(folderPath || '').replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || 'folder';
}

// Folders are stored as { path, label }; older configs used plain strings.
function folderEntries(source) {
  const raw = source.sourcePaths && source.sourcePaths.length ? source.sourcePaths : [source.sourcePath || ''];
  return raw.map((entry) => (typeof entry === 'string' ? { path: entry, label: '' } : { path: entry?.path || '', label: entry?.label || '' }));
}

function foldersPatch(list) {
  return { sourcePaths: list, sourcePath: list[0]?.path || '' };
}

function setFolder(list, index, patch) {
  return foldersPatch(list.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
}

function removeFolder(list, index) {
  return foldersPatch(list.filter((_, i) => i !== index));
}

function addFolder(list) {
  return foldersPatch([...list, { path: '', label: '' }]);
}

function Sources({ config, setConfig, chooseDirectory, googleAccount, notify, openFolder, onRestore }) {
  const [snapshotOptions, setSnapshotOptions] = useState({});
  const [loadingSnapshots, setLoadingSnapshots] = useState('');
  const loadSnapshots = async (index, source) => {
    if (!source.storageProfile) {
      notify('Choose a storage profile first.', 'error');
      return;
    }
    setLoadingSnapshots(String(index));
    try {
      const result = await api.listSnapshotsByProfile(source.storageProfile);
      setSnapshotOptions((current) => ({ ...current, [index]: result }));
      if (!result.snapshots.length) notify('No restore points found in that storage yet.', 'error');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoadingSnapshots('');
    }
  };
  const sources = config.backup?.sources || [];
  const profiles = Object.keys(config.storageProfiles || {});
  const updateProfile = (profileName, patch) => setConfig((current) => ({
    ...current,
    storageProfiles: {
      ...current.storageProfiles,
      [profileName]: { ...current.storageProfiles[profileName], ...patch },
    },
  }));
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
      sources: [{
        name: `Source ${current.backup.sources.length + 1}`,
        enabled: true,
        operation: 'backup',
        sourcePath: '',
        storageProfile: profiles[0] || '',
      }, ...current.backup.sources],
    },
  }));

  return (
    <div className="page-stack">
      <div className="page-title-row"><div><span className="eyebrow">Data jobs</span><h2>Backup & restore sources</h2><p>Choose what to protect, where to store it, and when restores should run.</p></div><Button onClick={add}>+ Add source</Button></div>
      <div className="source-grid">
      {sources.map((source, index) => (
        <article className="card source-editor" key={`source-${index}`}>
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
            {source.operation === 'backup' && (
              <SelectField
                label="Backup type"
                value={source.mode === 'mirror' ? 'mirror' : 'versioned'}
                onChange={(event) => {
                  const mode = event.target.value === 'mirror' ? 'mirror' : 'versioned';
                  if (mode !== 'mirror') { update(index, { mode }); return; }
                  // Drop cloud destinations that an exact copy cannot write to.
                  const kept = destinationsOf(source).filter((name) =>
                    ['local', 'network'].includes((config.storageProfiles || {})[name]?.type)
                  );
                  update(index, { mode, storageProfiles: kept, storageProfile: kept[0] || '' });
                }}
              >
                <option value="versioned">Versioned — keeps daily restore points</option>
                <option value="mirror">Exact copy — a plain folder you can open</option>
              </SelectField>
            )}
            {source.operation === 'backup' ? (
              <div className="field">
                <span className="field-label">Destinations</span>
                <div className="destination-list">
                  {profiles
                    .filter((profileName) => {
                      // An exact copy writes plain files, so only folders qualify.
                      if (source.mode !== 'mirror') return true;
                      const type = (config.storageProfiles || {})[profileName]?.type;
                      return type === 'local' || type === 'network';
                    })
                    .map((profileName) => {
                    const selected = destinationsOf(source);
                    const checked = selected.includes(profileName);
                    return (
                      <label className="check-row" key={profileName}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...selected, profileName]
                              : selected.filter((n) => n !== profileName);
                            update(index, { storageProfiles: next, storageProfile: next[0] || '' });
                          }}
                        />
                        <span>{profileName}</span>
                      </label>
                    );
                  })}
                </div>
                {source.mode === 'mirror' && !profiles.some((name) => ['local', 'network'].includes((config.storageProfiles || {})[name]?.type)) && (
                  <span className="field-hint warn">No folder storage yet. Add a local folder on the Storage page.</span>
                )}
                {destinationsOf(source).length > 1 && (
                  <span className="field-hint">This source is copied to {destinationsOf(source).length} destinations, each keeping its own restore points.</span>
                )}
                {destinationsOf(source).length === 0 && <span className="field-hint">Choose at least one destination.</span>}
                {source.mode === 'mirror' && (
                  <span className="field-hint warn">
                    An exact copy needs a folder on this computer or a network share, and uses only the first destination.
                  </span>
                )}
              </div>
            ) : (
              <SelectField label="Restore from (storage)" value={source.storageProfile || ''} onChange={(event) => update(index, { storageProfile: event.target.value })}>
                <option value="">Choose storage…</option>{profiles.map((name) => <option key={name}>{name}</option>)}
              </SelectField>
            )}
          </div>
          {source.operation === 'backup' && destinationsOf(source).length > 0 && (
            <div className="subpanel destination-detail">
              <span className="field-label">Where this lands</span>
              {destinationsOf(source).map((profileName) => {
                const profile = (config.storageProfiles || {})[profileName];
                if (!profile) {
                  return <span className="field-hint warn" key={profileName}>{profileName} no longer exists. Pick another destination.</span>;
                }
                if (profile.type === 'google_drive') {
                  return (
                    <Field
                      key={profileName}
                      label={`Google Drive folder — ${profileName}`}
                      value={profile.rootFolderName || ''}
                      placeholder="Backup Genie"
                      onChange={(event) => updateProfile(profileName, { rootFolderName: event.target.value })}
                      hint="Created in your Drive if it does not exist. Shared by every source using this storage."
                    />
                  );
                }
                return (
                  <div className="static-row" key={profileName}>
                    <span>{profileName}</span>
                    <strong>{profileSummary(profile)}</strong>
                  </div>
                );
              })}
            </div>
          )}
          {source.operation === 'backup' ? (
            <div className="folder-list">
              <span className="field-label">Folders to back up</span>
              {folderEntries(source).map((entry, fi, list) => (
                <div className="folder-row" key={`folder-${fi}`}>
                  <Field
                    label={fi === 0 ? 'Folder' : `Folder ${fi + 1}`}
                    value={entry.path}
                    onChange={(event) => update(index, setFolder(list, fi, { path: event.target.value }))}
                  />
                  {list.length > 1 && (
                    <Field
                      label="Store as"
                      value={entry.label}
                      placeholder={defaultLabel(entry.path)}
                      onChange={(event) => update(index, setFolder(list, fi, { label: event.target.value }))}
                    />
                  )}
                  <Button variant="secondary" onClick={async () => {
                    const selected = await chooseDirectory(entry.path);
                    if (selected) update(index, setFolder(list, fi, { path: selected }));
                  }}>Browse</Button>
                  {list.length > 1 && (
                    <Button variant="danger-ghost" onClick={() => update(index, removeFolder(list, fi))}>Remove</Button>
                  )}
                </div>
              ))}
              <Button variant="ghost" className="add-folder" onClick={() => update(index, addFolder(folderEntries(source)))}>+ Add another folder</Button>
              {folderEntries(source).length > 1 && (
                <span className="field-hint">Each folder is stored under its own sub-folder ("Store as"), so identically named files never collide. A restore recreates them side by side.</span>
              )}
            </div>
          ) : (
            <div className="path-row with-open">
              <Field label="Restore destination" value={source.sourcePath || ''} onChange={(event) => update(index, { sourcePath: event.target.value })} />
              <Button variant="secondary" onClick={async () => { const selected = await chooseDirectory(source.sourcePath); if (selected) update(index, { sourcePath: selected }); }}>Browse</Button>
              <Button variant="ghost" onClick={() => openFolder(source.sourcePath)}>Open folder</Button>
            </div>
          )}
          {source.operation === 'backup' && (
            <div className="subpanel">
              <span className="field-label">Schedule</span>
              {schedulesOf(source, config.backup?.schedule).map((expression, slot) => {
                const list = schedulesOf(source, config.backup?.schedule);
                return (
                  <div className="schedule-slot" key={`schedule-${slot}`}>
                    <ScheduleEditor
                      value={expression}
                      onChange={(next) => {
                        const updated = list.map((item, i) => (i === slot ? next : item));
                        update(index, { schedules: updated, schedule: updated[0] });
                      }}
                    />
                    {list.length > 1 && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          const updated = list.filter((_, i) => i !== slot);
                          update(index, { schedules: updated, schedule: updated[0] });
                        }}
                      >
                        Remove this time
                      </button>
                    )}
                  </div>
                );
              })}
              <Button
                variant="ghost"
                onClick={() => {
                  const updated = [...schedulesOf(source, config.backup?.schedule), DEFAULT_SCHEDULE];
                  update(index, { schedules: updated, schedule: updated[0] });
                }}
              >
                + Add another time
              </Button>
            </div>
          )}
          <div className="subpanel">
            <span className="field-label">Email reports for this source</span>
            {(source.notifyTo || []).map((address, ri) => (
              <div className="folder-row" key={`notify-${ri}`}>
                <Field
                  label={ri === 0 ? 'Send to' : `Send to ${ri + 1}`}
                  value={address}
                  onChange={(event) => update(index, { notifyTo: (source.notifyTo || []).map((a, i) => (i === ri ? event.target.value : a)) })}
                />
                <Button variant="danger-ghost" onClick={() => update(index, { notifyTo: (source.notifyTo || []).filter((_, i) => i !== ri) })}>Remove</Button>
              </div>
            ))}
            <div className="notify-actions">
              <Button variant="ghost" onClick={() => update(index, { notifyTo: [...(source.notifyTo || []), ''] })}>+ Add recipient</Button>
              {googleAccount?.email && !(source.notifyTo || []).includes(googleAccount.email) && (
                <Button variant="ghost" onClick={() => update(index, { notifyTo: [...(source.notifyTo || []), googleAccount.email] })}>+ Add {googleAccount.email}</Button>
              )}
            </div>
            {(source.notifyTo || []).length === 0 && (
              <span className="field-hint">No recipients — reports for this source fall back to the address in Settings.</span>
            )}
          </div>
          {source.operation === 'restore' && (
            <div className="subpanel">
              <div className="form-grid three">
                <SelectField label="Restore mode" value={source.restore?.mode || 'manual'} onChange={(event) => update(index, { restore: { ...source.restore, mode: event.target.value } })}><option value="manual">Manual</option><option value="scheduled">Scheduled</option></SelectField>
                <SelectField label="Restore point" value={source.restore?.snapshotId || 'latest'} onChange={(event) => update(index, { restore: { ...source.restore, snapshotId: event.target.value } })}>
                  <option value="latest">Latest available</option>
                  {(snapshotOptions[index]?.snapshots || []).map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>{displayDate(snapshot.createdAt)} · {snapshot.fileCount} files · {bytes(snapshot.totalBytes)}</option>
                  ))}
                  {source.restore?.snapshotId && source.restore.snapshotId !== 'latest' && !(snapshotOptions[index]?.snapshots || []).some((s) => s.id === source.restore.snapshotId) && (
                    <option value={source.restore.snapshotId}>{source.restore.snapshotId}</option>
                  )}
                </SelectField>
                {source.restore?.mode === 'scheduled' && <Field label="Cron schedule" value={source.restore?.schedule || ''} onChange={(event) => update(index, { restore: { ...source.restore, schedule: event.target.value } })} />}
              </div>
              <div className="notify-actions">
                <Button variant="secondary" busy={loadingSnapshots === String(index)} onClick={() => loadSnapshots(index, source)}>Browse restore points</Button>
                <span className="field-hint">Reading from {snapshotOptions[index]?.storageLabel || profileSummary((config.storageProfiles || {})[source.storageProfile])}</span>
              </div>
              <label className="check-row"><input type="checkbox" checked={source.restore?.cleanDest === true} onChange={(event) => update(index, { restore: { ...source.restore, cleanDest: event.target.checked } })} /><span>Clear destination before restoring</span></label>
            </div>
          )}
          <div className="card-footer">
            {source.operation === 'backup' && source.mode !== 'mirror' && destinationsOf(source).length > 0 && (
              <Button variant="secondary" onClick={() => onRestore(source)}>Restore this backup…</Button>
            )}
            <Button variant="danger-ghost" onClick={() => remove(index)}>Remove source</Button>
          </div>
        </article>
      ))}
      </div>
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

// Seeds the fields a provider needs so a profile can't be saved half-configured.
function providerDefaults(type, profileName, profile) {
  const patch = { type };
  if (type === 'google_drive' && !profile.rootFolderName) patch.rootFolderName = profileName || 'Backup Genie';
  if (type === 's3' && !profile.prefix) patch.prefix = 'backup-genie';
  if (type === 'azure_blob' && !profile.auth?.mode) patch.auth = { ...(profile.auth || {}), mode: 'interactive' };
  return patch;
}

const requiredProfileFields = {
  google_drive: ['rootFolderName'],
  local: ['rootDir'],
  network: ['rootDir'],
  s3: ['bucket', 'region'],
  azure_blob: ['accountUrl', 'containerName'],
  managed: ['controlPlaneUrl', 'tenantId'],
};

function missingProfileFields(profile) {
  return (requiredProfileFields[profile.type] || []).filter((key) => !String(profile[key] || '').trim());
}

// Only providers proven end-to-end are offered; the rest stay visible but disabled.
const SUPPORTED_PROVIDERS = ['google_drive', 'local'];
const PROVIDER_CHOICES = [
  ['google_drive', 'Google Drive'],
  ['local', 'Local folder'],
  ['network', 'Network / NAS'],
  ['s3', 'S3 compatible'],
  ['azure_blob', 'Azure Blob'],
  ['managed', 'Managed cloud'],
];

function profileFacts(profile, googleAccount) {
  const facts = [];
  const prefix = profile.prefix || profile.rootPrefix;
  if (profile.type === 'google_drive') {
    facts.push([
      'Account',
      !googleAccount?.email
        ? 'Not connected'
        : googleAccount.ownAccount
          ? googleAccount.email
          : `${googleAccount.email} (shared — click “Connect Google” to use another)`,
    ]);
    facts.push(['Drive folder', profile.rootFolderName || '—']);
    if (googleAccount?.quotaLimit) {
      facts.push(['Drive storage', `${bytes(googleAccount.quotaUsed)} of ${bytes(googleAccount.quotaLimit)} used`]);
    }
  } else if (profile.type === 'local' || profile.type === 'network') {
    facts.push(['Location', profile.rootDir || '—']);
    if (profile.auth?.username) facts.push(['Signs in as', profile.auth.username]);
  } else if (profile.type === 's3') {
    facts.push(['Bucket', profile.bucket || '—']);
    facts.push(['Region', profile.region || '—']);
    if (profile.endpoint) facts.push(['Endpoint', profile.endpoint]);
    if (prefix) facts.push(['Path prefix', prefix]);
  } else if (profile.type === 'azure_blob') {
    facts.push(['Storage account', profile.accountName || profile.accountUrl || '—']);
    facts.push(['Container', profile.containerName || '—']);
    facts.push(['Sign-in', { interactive: 'Microsoft sign-in', default: 'Azure default credential', managed_identity: 'Managed identity', sas: 'SAS token' }[profile.auth?.mode || 'interactive']]);
    if (profile.auth?.loginHint) facts.push(['Account', profile.auth.loginHint]);
    if (prefix) facts.push(['Path prefix', prefix]);
  } else if (profile.type === 'managed') {
    facts.push(['Service', profile.controlPlaneUrl || '—']);
    facts.push(['Account ID', profile.tenantId || '—']);
  }
  return facts;
}

function Storage({ config, setConfig, chooseDirectory, testStorage, verifyStorage, verifyingProfile, startGoogleAuth, testingProfile, notify, googleAccounts }) {
  const profiles = config.storageProfiles || {};
  const secretStatus = config._secretStatus || { storageProfiles: {} };
  // A profile only becomes fixed once it has a backup history to protect.
  const profilesInUse = config._profilesInUse || [];
  const usedBy = (name) => (config.backup?.sources || []).filter((source) => destinationsOf(source).includes(name)).map((source) => source.name);
  // Extra copies mirror the main destination, so their own retention never applies.
  const usedAsCopy = (name) => (config.backup?.sources || []).some((source) => destinationsOf(source).indexOf(name) > 0);
  const removeProfile = (name) => {
    const inUse = usedBy(name);
    if (inUse.length) {
      notify(`"${name}" is still used by: ${inUse.join(', ')}. Change those sources first.`, 'error');
      return;
    }
    setConfig((current) => {
      const next = { ...current.storageProfiles };
      delete next[name];
      return { ...current, storageProfiles: next };
    });
  };
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
        backup: {
          ...current.backup,
          sources: current.backup.sources.map((source) => {
            const next = destinationsOf(source).map((profileName) => (profileName === oldName ? newName : profileName));
            if (!next.includes(newName)) return source;
            return {
              ...source,
              storageProfile: next[0],
              ...(Array.isArray(source.storageProfiles) && source.storageProfiles.length ? { storageProfiles: next } : {}),
            };
          }),
        },
      };
    });
  };
  const [unlockedProvider, setUnlockedProvider] = useState('');

  const addProfile = (type) => {
    const base = type === 'google_drive' ? 'new-google-drive' : 'new-local-storage';
    let name = base;
    let count = 2;
    while (profiles[name]) name = `${base}-${count++}`;
    setConfig((current) => ({
      ...current,
      storageProfiles: {
        ...current.storageProfiles,
        [name]: type === 'google_drive'
          ? { type: 'google_drive', rootFolderName: name }
          : { type: 'local', rootDir: '' },
      },
    }));
  };

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div><span className="eyebrow">Destinations</span><h2>Storage</h2><p>Connect customer-owned storage and test access before a backup. The provider is chosen when you add a profile and cannot be changed later.</p></div>
        <div className="notify-actions">
          <Button variant="secondary" onClick={() => addProfile('google_drive')}>+ Google Drive</Button>
          <Button onClick={() => addProfile('local')}>+ Local folder</Button>
        </div>
      </div>
      <div className="storage-grid">
        {Object.entries(profiles).map(([name, profile]) => (
          <article className="card storage-card" key={name}>
            <div className="storage-head"><div className={`provider-logo provider-${profile.type}`}>{profile.type === 'google_drive' ? 'G' : profile.type === 'azure_blob' ? 'A' : profile.type === 's3' ? 'S3' : profile.type === 'network' ? 'N' : profile.type === 'managed' ? 'VE' : 'L'}</div><div><h3>{name}</h3><span>{storageName(profile.type)}</span></div><Pill tone={profile.tenancy === 'managed' ? 'violet' : 'neutral'}>{profile.tenancy || 'customer'}</Pill></div>
            <div className="form-grid">
              <Field label="Profile name" defaultValue={name} onBlur={(event) => rename(name, event.target.value.trim())} />
              <div className="field">
                <span className="field-label">Provider</span>
                <select value={profile.type} disabled={profilesInUse.includes(name) && unlockedProvider !== name} onChange={(event) => update(name, providerDefaults(event.target.value, name, profile))}>
                  {PROVIDER_CHOICES.map(([value, label]) => (
                    <option key={value} value={value} disabled={!SUPPORTED_PROVIDERS.includes(value) && profile.type !== value}>
                      {SUPPORTED_PROVIDERS.includes(value) ? label : `${label} — not available yet`}
                    </option>
                  ))}
                </select>
                {!profilesInUse.includes(name) ? (
                  <span className="field-hint">You can change this until the first backup runs.</span>
                ) : unlockedProvider === name ? (
                  <span className="field-hint warn">This profile already holds backups. Restore points saved in the old location will not appear here.</span>
                ) : (
                  <span className="field-hint">
                    Fixed so an existing backup history can never be pointed at a different location.{' '}
                    <button type="button" className="link-button" onClick={() => setUnlockedProvider(name)}>Change provider</button>
                  </span>
                )}
              </div>
            </div>
            {(publicProfileFields[profile.type] || []).map(([key, label]) => (
              <div className={key === 'rootDir' ? 'path-row compact' : ''} key={key}>
                <Field label={label} value={profile[key] || ''} onChange={(event) => update(name, { [key]: event.target.value })} />
                {key === 'rootDir' && <Button variant="secondary" onClick={async () => { const selected = await chooseDirectory(profile[key]); if (selected) update(name, { [key]: selected }); }}>Browse</Button>}
              </div>
            ))}
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field
                type="number"
                min="1"
                max="30"
                label="Restore history (days)"
                value={profile.keepDailyBackups || config.retention?.keepDailyBackups || 30}
                onChange={(event) => {
                  const days = Math.min(30, Math.max(1, Number(event.target.value) || 1));
                  update(name, { keepDailyBackups: days });
                }}
                hint={usedAsCopy(name)
                  ? 'This storage is an extra copy, so it follows the main destination’s history.'
                  : 'Restore points older than this are removed from this storage (1–30 days).'}
              />
            </div>
            {profile.type === 'network' && <div className="form-grid secret-fields"><Field label="Network username" value={profile.auth?.username || ''} onChange={(event) => updateAuth(name, { username: event.target.value })} /><Field type="password" label="Network password" value={profile.auth?.password || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter password'} onChange={(event) => updateAuth(name, { password: event.target.value })} /></div>}
            {profile.type === 's3' && <div className="form-grid secret-fields"><Field type="password" label="Access key ID" value={profile.auth?.accessKeyId || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter access key'} onChange={(event) => updateAuth(name, { accessKeyId: event.target.value })} /><Field type="password" label="Secret access key" value={profile.auth?.secretAccessKey || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter secret key'} onChange={(event) => updateAuth(name, { secretAccessKey: event.target.value })} /></div>}
            {profile.type === 'managed' && <div className="form-grid secret-fields"><Field type="password" label="License key" value={profile.auth?.licenseKey || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter license key'} onChange={(event) => updateAuth(name, { licenseKey: event.target.value })} /></div>}
            {profile.type === 'azure_blob' && <><SelectField label="Azure authentication" value={profile.auth?.mode || 'interactive'} onChange={(event) => updateAuth(name, { mode: event.target.value })}><option value="interactive">Microsoft interactive sign-in</option><option value="default">Azure development credential</option><option value="managed_identity">Managed identity</option><option value="sas">SAS token</option></SelectField>{profile.auth?.mode === 'sas' && <Field type="password" label="SAS token" value={profile.auth?.sasToken || ''} placeholder={secretStatus.storageProfiles?.[name] ? 'Stored securely' : 'Enter SAS token'} onChange={(event) => updateAuth(name, { sasToken: event.target.value })} />}</>}
            {!SUPPORTED_PROVIDERS.includes(profile.type) && (
              <div className="profile-warning">
                <span>!</span>
                {storageName(profile.type)} is not available yet. Backups using this profile will not run — use Google Drive or a local folder.
              </div>
            )}
            {missingProfileFields(profile).length > 0 && (
              <div className="profile-warning">
                <span>!</span>
                This profile is incomplete — backups using it will fail. Fill in: {missingProfileFields(profile).map((key) => (publicProfileFields[profile.type] || []).find(([k]) => k === key)?.[1] || key).join(', ')}.
              </div>
            )}
            <dl className="storage-facts">
              {profileFacts(profile, googleAccounts[name]).map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd title={String(value)}>{value}</dd></div>
              ))}
              <div><dt>Used by</dt><dd>{usedBy(name).length ? usedBy(name).join(', ') : 'No sources yet'}</dd></div>
            </dl>
            <div className={cx('credential-note', (profile.type === 'google_drive' ? googleAccounts[name]?.ownAccount : secretStatus.storageProfiles?.[name]) && 'credential-stored')}>
              <span>{(profile.type === 'google_drive' ? googleAccounts[name]?.ownAccount : secretStatus.storageProfiles?.[name]) ? '✓' : '○'}</span>
              {profile.type === 'google_drive'
                ? googleAccounts[name]?.ownAccount
                  ? `This profile is connected to ${googleAccounts[name].email}. Authorization is stored securely in the OS vault.`
                  : 'This profile has no Google account of its own yet. Click “Connect Google” and sign in with the account whose Drive should hold these backups.'
                : secretStatus.storageProfiles?.[name]
                  ? 'Credentials are stored in the operating system credential vault.'
                  : ['local'].includes(profile.type) ? 'This provider does not require a password.' : 'Enter credentials and save to move them into secure OS storage.'}
            </div>
            <div className="card-footer storage-actions">
              <Button variant="danger-ghost" onClick={() => removeProfile(name)}>Remove</Button>
              <Button variant="secondary" busy={testingProfile === name} disabled={missingProfileFields(profile).length > 0} onClick={() => testStorage(name)}>Test connection</Button>
              <Button variant="secondary" busy={verifyingProfile === name} disabled={missingProfileFields(profile).length > 0} onClick={() => verifyStorage(name)}>Verify backup</Button>
              {profile.type === 'google_drive' && <Button variant="ghost" onClick={() => startGoogleAuth(name)}>{googleAccounts[name]?.email ? 'Use another account' : 'Connect Google'}</Button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function RestoreCard({ entry, onRestore }) {
  const [profileName, setProfileName] = useState(entry.destinations[0]);
  const [points, setPoints] = useState(null);
  const [storageLabel, setStorageLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (name) => {
    setBusy(true);
    try {
      const result = await api.listSnapshotsByProfile(name);
      setPoints(result.snapshots || []);
      setStorageLabel(result.storageLabel || '');
    } catch (error) {
      setPoints([]);
      setStorageLabel(error.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(profileName); }, [profileName]);

  const latest = points && points[0];
  return (
    <article className="card restore-card">
      <div className="source-editor-head">
        <div className="source-icon restore">↶</div>
        <div>
          <h3>{entry.label}</h3>
          <span>{storageLabel || profileName}</span>
        </div>
      </div>
      {entry.destinations.length > 1 && (
        <SelectField label="Restore from" value={profileName} onChange={(event) => setProfileName(event.target.value)}>
          {entry.destinations.map((name, i) => (
            <option key={name} value={name}>{name}{i === 0 ? ' — main destination' : ' — copy'}</option>
          ))}
        </SelectField>
      )}
      <dl className="storage-facts">
        <div><dt>Restore points</dt><dd>{points === null ? 'Loading…' : points.length}</dd></div>
        <div><dt>Most recent</dt><dd>{latest ? displayDate(latest.createdAt) : '—'}</dd></div>
        <div><dt>Protected folders</dt><dd>{rootLabels(latest).join(', ') || '—'}</dd></div>
        <div><dt>Size</dt><dd>{latest ? bytes(latest.totalBytes) : '—'}</dd></div>
      </dl>
      <div className="card-footer">
        <Button variant="secondary" busy={busy} onClick={() => load(profileName)}>Refresh</Button>
        <Button disabled={!points || points.length === 0} onClick={() => onRestore(entry.source, profileName)}>Restore…</Button>
      </div>
    </article>
  );
}

// A snapshot from a multi-folder backup namespaces each folder it captured.
function rootLabels(snapshot) {
  if (!snapshot) return [];
  return (snapshot.roots || [])
    .map((root) => root.namespace || (root.path || '').split(/[\\/]/).filter(Boolean).pop())
    .filter(Boolean);
}

function Restore({ config, onRestore, openFolder }) {
  // Restore points belong to backup jobs; a separate restore job is optional.
  // Only jobs that could actually hold restore points: enabled, versioned, and
  // pointing at a storage profile that is finished being set up.
  const usable = (profileName) => {
    const profile = (config.storageProfiles || {})[profileName];
    return !!profile && missingProfileFields(profile).length === 0;
  };
  const backupSources = (config.backup?.sources || [])
    .filter((source) => source.operation === 'backup' && source.mode !== 'mirror' && source.enabled !== false)
    .map((source) => ({ source, destinations: destinationsOf(source).filter(usable) }))
    .filter((entry) => entry.destinations.length > 0);
  const restoreJobs = (config.backup?.sources || []).filter((source) => source.operation === 'restore' && source.enabled !== false);
  const entries = [
    ...backupSources.map(({ source, destinations }) => ({
      key: source.name,
      label: source.name,
      destinations,
      source,
    })),
    ...restoreJobs.map((source) => ({
      key: `job:${source.name}`,
      label: `${source.name} (restore job)`,
      destinations: [source.storageProfile].filter((name) => name && usable(name)),
      source,
    })),
  ].filter((entry) => entry.destinations.length > 0);

  if (!entries.length) {
    return <EmptyState icon="↶" title="Nothing backed up yet" text="Add a backup source, then its restore points appear here." />;
  }
  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Recovery</span>
          <h2>Restore points</h2>
          <p>Every backup keeps its own history. Pick one and choose the day you want back.</p>
        </div>
      </div>
      <div className="source-grid">
        {entries.map((entry) => (
          <RestoreCard key={entry.key} entry={entry} onRestore={onRestore} />
        ))}
      </div>
    </div>
  );
}

function Logs({ logs, refreshLogs, operationLogs }) {
  const lines = [...logs, ...operationLogs].slice(-400);
  return <div className="page-stack"><div className="page-title-row"><div><span className="eyebrow">Diagnostics</span><h2>Activity logs</h2><p>Readable operational history for troubleshooting and support.</p></div><Button variant="secondary" onClick={refreshLogs}>Refresh logs</Button></div><section className="log-viewer">{lines.length ? lines.map((line, index) => <div className="log-line" key={`${index}-${line}`}><span>{String(index + 1).padStart(3, '0')}</span><code>{line}</code></div>) : <EmptyState title="No logs yet" text="Run a backup or storage test to see activity here." />}</section></div>;
}

function Settings({ config, setConfig, testEmail, emailTesting, schedulerState, systemInfo, onOpenWizard, updateState, checkForUpdates, installUpdate, openFolder }) {
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
      {schedulerState?.jobs?.length > 0 && <div className="schedule-list">{schedulerState.jobs.map((job) => <div key={`${job.label}-${job.expression}`}><strong>{job.label}</strong><span>{describeSchedule(job.expression)}</span><em>{job.timezone}</em></div>)}</div>}
    </section>
    <section className="card"><div className="section-heading"><div><span className="eyebrow">Automation</span><h3>Defaults &amp; performance</h3></div></div><div className="form-grid three"><TimezoneField value={backup.timezone} onChange={(event) => updateBackup({ timezone: event.target.value })} hint="Schedules run in this time zone." /><Field type="number" min="1" max="32" label="Concurrent transfers" value={backup.concurrency || 8} onChange={(event) => updateBackup({ concurrency: Number(event.target.value) })} /><Field type="number" min="0" max="60" label="Warn me before a backup (minutes)" value={backup.warnBeforeMinutes ?? 5} onChange={(event) => updateBackup({ warnBeforeMinutes: Math.min(60, Math.max(0, Number(event.target.value) || 0)) })} hint="Reminds you to save and close files. 0 turns it off." /><Field type="number" min="1" max="30" label="Default restore history (days)" value={retention.keepDailyBackups || 30} onChange={(event) => updateRetention({ keepDailyBackups: Math.min(30, Math.max(1, Number(event.target.value) || 1)) })} hint="Used by storage profiles that do not set their own." /></div><span className="field-hint">Each backup source has its own schedule, set on the Backup &amp; restore page.</span></section>
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
    <section className="card">
      <div className="section-heading"><div><span className="eyebrow">Account</span><h3>Backup Genie service</h3></div></div>
      <Field
        label="Service address"
        value={config.account?.controlPlaneUrl || ''}
        placeholder="Not used — leave blank"
        onChange={(event) => setConfig((current) => ({ ...current, account: { ...current.account, controlPlaneUrl: event.target.value.trim() } }))}
        hint="Optional. Only needed if your organisation runs a Backup Genie account service for signing in across devices. Backups, restores and email reports all work without it."
      />
    </section>
    <section className="card">
      <div className="section-heading"><div><span className="eyebrow">Diagnostics</span><h3>Files on this computer</h3></div></div>
      <div className="preference-list">
        <div className="preference-row"><div><strong>Logs</strong><span>{systemInfo?.logsPath || '—'}</span></div><Button variant="secondary" onClick={() => openFolder(systemInfo?.logsPath)}>Open</Button></div>
        <div className="preference-row"><div><strong>Settings file</strong><span>{systemInfo?.configPath || '—'}</span></div><Button variant="secondary" onClick={() => openFolder(systemInfo?.configPath)}>Open</Button></div>
        <div className="preference-row"><div><strong>App data</strong><span>{systemInfo?.dataPath || '—'}</span></div><Button variant="secondary" onClick={() => openFolder(systemInfo?.dataPath)}>Open</Button></div>
      </div>
    </section>
  </div>;
}

const STORAGE_OPTIONS = [
  { type: 'google_drive', title: 'Google Drive', desc: 'Back up to your own Google Drive account.', icon: 'G' },
  { type: 'local', title: 'Local / external drive', desc: 'A second drive or folder on this PC.', icon: 'L' },
];

const WEEKDAYS = [['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']];
const DEFAULT_SCHEDULE = '0 20 * * *';

// Cron stays the stored format (the scheduler reads it); these translate it to
// and from the day/time controls people actually understand.
function parseSchedule(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, weekday] = parts;
  const base = { time: '20:00', weekday: '1', day: '1', everyHours: 6 };
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (everyHours && minute === '0' && dayOfMonth === '*' && month === '*' && weekday === '*') {
    return { ...base, frequency: 'hourly', everyHours: Number(everyHours[1]) };
  }
  if (month !== '*' || !/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  if (dayOfMonth === '*' && weekday === '*') return { ...base, frequency: 'daily', time };
  if (dayOfMonth === '*' && /^[0-6]$/.test(weekday)) return { ...base, frequency: 'weekly', time, weekday };
  if (weekday === '*' && /^\d{1,2}$/.test(dayOfMonth)) return { ...base, frequency: 'monthly', time, day: dayOfMonth };
  return null;
}

function buildSchedule(parts) {
  const [hour, minute] = String(parts.time || '20:00').split(':').map((n) => Number(n) || 0);
  if (parts.frequency === 'hourly') return `0 */${parts.everyHours || 6} * * *`;
  if (parts.frequency === 'weekly') return `${minute} ${hour} * * ${parts.weekday || '1'}`;
  if (parts.frequency === 'monthly') return `${minute} ${hour} ${parts.day || '1'} * *`;
  return `${minute} ${hour} * * *`;
}

function formatClock(time) {
  const [hour, minute] = String(time || '').split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return time;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function ordinal(n) {
  const value = Number(n);
  const suffix = value % 10 === 1 && value !== 11 ? 'st' : value % 10 === 2 && value !== 12 ? 'nd' : value % 10 === 3 && value !== 13 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function describeSchedule(expr) {
  if (!expr) return 'No schedule';
  const parts = parseSchedule(expr);
  if (!parts) return `Advanced schedule (${expr})`;
  if (parts.frequency === 'hourly') return `Every ${parts.everyHours} hours`;
  if (parts.frequency === 'weekly') {
    return `Every ${(WEEKDAYS.find(([value]) => value === parts.weekday) || [, 'Monday'])[1]} at ${formatClock(parts.time)}`;
  }
  if (parts.frequency === 'monthly') return `The ${ordinal(parts.day)} of every month at ${formatClock(parts.time)}`;
  return `Every day at ${formatClock(parts.time)}`;
}

function ScheduleEditor({ value, onChange }) {
  const parts = parseSchedule(value);
  const [advanced, setAdvanced] = useState(!parts);
  const current = parts || parseSchedule(DEFAULT_SCHEDULE);
  const set = (patch) => onChange(buildSchedule({ ...current, ...patch }));

  if (advanced) {
    return (
      <div className="schedule-editor">
        <Field
          label="Advanced schedule"
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          hint="Cron format: minute hour day month weekday"
        />
        <span className="field-hint">
          {describeSchedule(value)}{' '}
          <button type="button" className="link-button" onClick={() => { setAdvanced(false); if (!parts) onChange(DEFAULT_SCHEDULE); }}>
            Use simple settings
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="schedule-editor">
      <div className="form-grid">
        <SelectField label="How often" value={current.frequency} onChange={(event) => set({ frequency: event.target.value })}>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
          <option value="hourly">Every few hours</option>
        </SelectField>
        {current.frequency === 'hourly' ? (
          <SelectField label="Run every" value={String(current.everyHours)} onChange={(event) => set({ everyHours: Number(event.target.value) })}>
            {[1, 2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n} hours</option>)}
          </SelectField>
        ) : (
          <Field type="time" label="At what time" value={current.time} onChange={(event) => set({ time: event.target.value })} />
        )}
        {current.frequency === 'weekly' && (
          <SelectField label="On which day" value={current.weekday} onChange={(event) => set({ weekday: event.target.value })}>
            {WEEKDAYS.map(([value_, label]) => <option key={value_} value={value_}>{label}</option>)}
          </SelectField>
        )}
        {current.frequency === 'monthly' && (
          <SelectField label="On which date" value={String(current.day)} onChange={(event) => set({ day: event.target.value })}>
            {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((day) => <option key={day} value={day}>{ordinal(day)}</option>)}
          </SelectField>
        )}
      </div>
      <span className="field-hint">
        {describeSchedule(value)}{' '}
        <button type="button" className="link-button" onClick={() => setAdvanced(true)}>Advanced</button>
      </span>
    </div>
  );
}

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
    sourceName: src?.name || '',
    sourceNameEdited: !!src?.name,
    provider: {
      type: 'google_drive', rootFolderName: 'Backup Genie', rootDir: '', bucket: '', region: 'ap-south-1',
      endpoint: '', prefix: 'backup-genie', accessKeyId: '', secretAccessKey: '', accountUrl: '', containerName: '',
      azureMode: 'interactive', sasToken: '', tenantId: '', authUsername: '', authPassword: '',
      controlPlaneUrl: '', licenseKey: '',
    },
    schedule: base.backup?.schedule || '0 20 * * *',
    timezone: base.backup?.timezone || SYSTEM_TIMEZONE,
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

  const backupSource = {
    name: (draft.sourceName || '').trim() || defaultLabel(draft.tallyPath) || 'My Data',
    enabled: true,
    operation: 'backup',
    sourcePath: draft.tallyPath,
    storageProfile: 'primary',
  };
  if (p.type === 'google_drive') backupSource.backupFolderName = p.rootFolderName || 'Backup Genie';
  const otherSources = (base.backup?.sources || []).filter((s) => s.name !== 'My Data');

  const email = draft.email.enabled
    ? {
        ...(base.email || {}), enabled: true, mode: 'smtp',
        to: draft.email.to, subject: base.email?.subject || 'Backup Genie Report',
        sendOnSuccess: true, sendOnFailure: true, includeStats: true, includeDriveLink: true,
      }
    : { ...(base.email || {}), enabled: false };

  return {
    ...base,
    storageProfiles: { ...(base.storageProfiles || {}), primary: profile },
    backup: { ...(base.backup || {}), sources: [backupSource, ...otherSources], schedule: draft.schedule || '0 20 * * *', timezone: draft.timezone || SYSTEM_TIMEZONE, concurrency: base.backup?.concurrency || 8 },
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

function OnboardingWizard({ baseConfig, onSavedConfig, onFinish, operation, progress, operationLogs, notify, theme, onToggleTheme }) {
  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const goToStep = (next) => {
    setStep(next);
    setMaxVisited((current) => Math.max(current, next));
  };
  const [draft, setDraft] = useState(() => initWizardDraft(baseConfig));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [wizardError, setWizardError] = useState('');
  const lastStep = WIZARD_STEPS.length - 1;
  const chooseDirectory = (defaultPath) => api.chooseDirectory({ defaultPath });
  const setProvider = (updater) => setDraft((current) => ({ ...current, provider: typeof updater === 'function' ? updater(current.provider) : { ...current.provider, ...updater } }));

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
    setWizardError('');
    try {
      await persist(false);
      const missing = missingProfileFields(buildOnboardingConfig(baseConfig, draft, false).storageProfiles.primary || {});
      if (missing.length) throw new Error(`Finish setting up your storage first (missing: ${missing.join(', ')}).`);
      await api.startOperation({ type: 'backup' });
    } catch (error) {
      setWizardError(error.message);
      notify(error.message, 'error');
    }
  };
  const finish = async () => {
    setSaving(true);
    setWizardError('');
    try { await persist(true); onFinish(); }
    catch (error) { setWizardError(error.message); notify(error.message, 'error'); setSaving(false); }
  };
  // Setup is optional: everything here can be configured later in Settings.
  const skipSetup = async () => {
    setSaving(true);
    setWizardError('');
    try {
      const result = await api.saveConfig({ ...baseConfig, onboarding: { completed: true, version: 1 } });
      onSavedConfig(result.config);
      onFinish();
    } catch (error) { setWizardError(error.message); setSaving(false); }
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
      const samePath = (draft.tallyPath || '').trim().toLowerCase();
      const priorTargets = samePath
        ? (baseConfig.backup?.sources || []).filter(
            (s) => s.operation === 'backup' && (s.sourcePath || '').trim().toLowerCase() === samePath
          )
        : [];
      return (
        <div className="wizard-step-body">
          <span className="eyebrow">Step 1</span>
          <h2>Where is the data you want to back up?</h2>
          <p>Select the folder that contains the data you want to protect (for example, your accounting or business data folder).</p>
          <div className="path-row">
            <Field label="Data folder" value={draft.tallyPath} onChange={(e) => setDraft((d) => ({ ...d, tallyPath: e.target.value }))} />
            <Button variant="secondary" onClick={async () => {
              const s = await chooseDirectory(draft.tallyPath);
              if (!s) return;
              // Name the job after the folder unless the user typed their own.
              setDraft((d) => ({ ...d, tallyPath: s, sourceName: d.sourceNameEdited ? d.sourceName : defaultLabel(s) }));
            }}>Browse</Button>
          </div>
          <Field
            label="Name this backup"
            value={draft.sourceName}
            placeholder={draft.tallyPath ? defaultLabel(draft.tallyPath) : 'My Data'}
            onChange={(e) => setDraft((d) => ({ ...d, sourceName: e.target.value, sourceNameEdited: true }))}
            hint="Shown in reports and on the Overview page, for example “Tally Data”."
          />
          {priorTargets.length > 0 && (
            <div className="prior-targets">
              <strong>This folder is already backed up to:</strong>
              <ul>
                {priorTargets.map((s, i) => {
                  const profile = (baseConfig.storageProfiles || {})[s.storageProfile] || {};
                  return (
                    <li key={`${s.name}-${i}`}>
                      <span className={`provider-logo provider-${profile.type || 'local'}`}>
                        {profile.type === 'google_drive' ? 'G' : profile.type === 'azure_blob' ? 'A' : profile.type === 's3' ? 'S3' : profile.type === 'network' ? 'N' : profile.type === 'managed' ? 'BG' : 'L'}
                      </span>
                      <div>
                        <strong>{s.storageProfile || 'Unnamed storage'}</strong>
                        <span>{storageName(profile.type)}{profile.rootFolderName ? ` · ${profile.rootFolderName}` : ''}{profile.rootDir ? ` · ${profile.rootDir}` : ''}{profile.bucket ? ` · ${profile.bucket}` : ''}{profile.containerName ? ` · ${profile.containerName}` : ''}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <span className="prior-targets-hint">Choose a different destination on the next step to add another copy, or keep using one of these.</span>
            </div>
          )}
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
          <ScheduleEditor value={draft.schedule} onChange={(next) => setDraft((d) => ({ ...d, schedule: next }))} />
          <div className="form-grid" style={{ marginTop: 14 }}>
            <TimezoneField
              value={draft.timezone}
              onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
              hint="Taken from this computer. Change it if your business runs elsewhere."
            />
            <Field type="number" min="1" max="30" label="Days of history to keep" value={draft.retention} onChange={(e) => setDraft((d) => ({ ...d, retention: Number(e.target.value) }))} />
          </div>
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
          <div><span>Backup name</span><strong>{(draft.sourceName || '').trim() || defaultLabel(draft.tallyPath) || 'My Data'}</strong></div>
          <div><span>Storage</span><strong>{storageName(draft.provider.type)}</strong></div>
          <div><span>Schedule</span><strong>{describeSchedule(draft.schedule)}</strong></div>
          <div><span>Time zone</span><strong>{draft.timezone || SYSTEM_TIMEZONE}</strong></div>
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
          <div className="brand"><div className="brand-mark">BG</div><div><strong>Backup Genie</strong><span>Guided setup</span></div><button className="theme-toggle" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={onToggleTheme}>{theme === 'dark' ? '☀' : '☾'}</button></div>
          <ol className="wizard-steps">
            {WIZARD_STEPS.map((label, index) => (
              <li key={label} className={cx(index === step && 'active', index < step && 'done', index <= maxVisited && 'navigable')}>
                <button type="button" disabled={index > maxVisited} onClick={() => index <= maxVisited && setStep(index)}>
                  <span>{index < step ? '✓' : index + 1}</span>{label}
                </button>
              </li>
            ))}
          </ol>
          <div className="wizard-tip">Everything here can be changed later in Settings.</div>
        </aside>
        <div className="wizard-main">
          <div className="wizard-body">{renderStep()}</div>
          {wizardError && (
            <div className="wizard-error">
              <strong>Could not save your settings.</strong>
              <span>{wizardError}</span>
            </div>
          )}
          <div className="wizard-footer">
            <div>
              {step > 0 && <Button variant="ghost" onClick={() => goToStep(step - 1)}>Back</Button>}
              <Button variant="ghost" busy={saving} onClick={skipSetup}>Skip setup</Button>
            </div>
            <div className="wizard-footer-right">
              {canSkip(step) && <Button variant="secondary" onClick={() => goToStep(step + 1)}>Skip</Button>}
              {step < lastStep
                ? <Button disabled={!stepValid(step)} onClick={() => goToStep(step + 1)}>Continue</Button>
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
  const [verifyingProfile, setVerifyingProfile] = useState('');
  const [emailTesting, setEmailTesting] = useState(false);
  const [toast, setToast] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [updateState, setUpdateState] = useState({ status: 'idle' });
  const [theme, setTheme] = useState(() => localStorage.getItem('bg-theme') || 'dark');
  const [googleAccounts, setGoogleAccounts] = useState({});
  const [session, setSession] = useState({ signedIn: false, user: null });
  const [offlineMode, setOfflineMode] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [repoConflict, setRepoConflict] = useState(null);
  const [backupWarning, setBackupWarning] = useState(null);
  const [acceptingRepo, setAcceptingRepo] = useState(false);

  // Event subscriptions are registered once, so they must not close over the
  // config from the first render (which is still null).
  const configRef = useRef(config);
  configRef.current = config;

  // Each Drive profile can hold a different Google account.
  const googleAccount = Object.values(googleAccounts).find(Boolean) || null;
  const refreshGoogleAccount = (profileName, from = configRef.current) => {
    const names = profileName
      ? [profileName]
      : Object.entries(from?.storageProfiles || {})
          .filter(([, profile]) => profile.type === 'google_drive')
          .map(([name]) => name);
    names.forEach((name) => {
      Promise.resolve(api.getGoogleAccount?.(name))
        .then((info) => setGoogleAccounts((current) => ({ ...current, [name]: info || null })))
        .catch(() => {});
    });
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bg-theme', theme);
  }, [theme]);

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
        refreshGoogleAccount(null, configResult.config);
      })
      .catch((error) => notify(error.message, 'error'));
    Promise.resolve(api.getSession?.()).then((info) => info && setSession(info)).catch(() => {});
    refreshHistory();
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
        refreshHistory();
        refreshGoogleAccount();
      }
    });
    const unsubScheduler = api.onSchedulerState((state) => setSchedulerState(state));
    const unsubUpdate = api.onUpdateState((state) => setUpdateState(state));
    const unsubAuth = api.onAuthState?.((state) => {
      notify(state.status === 'success' ? 'Google account connected.' : 'Google sign-in did not complete.', state.status === 'success' ? 'success' : 'error');
      refreshGoogleAccount(state.profileName || undefined);
    });
    const unsubRepo = api.onRepoConflict?.((payload) => setRepoConflict(payload));
    const unsubWarning = api.onBackupWarning?.((payload) => setBackupWarning(payload));
    return () => { unsubProgress(); unsubLog(); unsubState(); unsubScheduler(); unsubUpdate(); unsubAuth?.(); unsubRepo?.(); unsubWarning?.(); };
  }, []);

  useEffect(() => {
    if (page === 'storage') refreshGoogleAccount();
  }, [page]);

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
  const openFolder = async (targetPath) => {
    if (!targetPath) {
      notify('No folder is set for this job yet.', 'error');
      return;
    }
    // shell.openPath resolves to '' on success, or a message on failure.
    const failure = await api.openPath(targetPath);
    if (failure) notify(`Could not open ${targetPath}: ${failure}`, 'error');
  };
  const startBackup = async (sourceName) => {
    try {
      if (!enabledBackupCount) throw new Error('Enable at least one backup source first.');
      const blocked = (config.backup?.sources || [])
        .filter((source) => source.enabled !== false && source.operation !== 'restore')
        .filter((source) => !sourceName || source.name === sourceName)
        .flatMap((source) => destinationsOf(source).map((profileName) => ({ source, profileName })))
        .filter(({ profileName }) => {
          const profile = (config.storageProfiles || {})[profileName];
          return !profile || !SUPPORTED_PROVIDERS.includes(profile.type) || missingProfileFields(profile).length > 0;
        });
      if (blocked.length) {
        const { source, profileName } = blocked[0];
        const profile = (config.storageProfiles || {})[profileName];
        throw new Error(
          profile && !SUPPORTED_PROVIDERS.includes(profile.type)
            ? `"${source.name}" cannot run: ${storageName(profile.type)} is not available yet.`
            : `"${source.name}" cannot run: storage "${profileName}" is not finished. Open Storage and complete it.`
        );
      }
      await persistIfNeeded();
      setPage('overview');
      await api.startOperation(sourceName ? { type: 'backup', sourceName } : { type: 'backup' });
    } catch (error) { notify(error.message, 'error'); }
  };
  const startRestore = async (request) => {
    try {
      await persistIfNeeded();
      await api.startOperation({ type: 'restore', ...request });
    } catch (error) { notify(error.message, 'error'); }
  };
  const [restoreDialog, setRestoreDialog] = useState(null);
  const [lastRestorePath, setLastRestorePath] = useState('');
  const [runHistory, setRunHistory] = useState([]);
  const refreshHistory = () => Promise.resolve(api.getRunHistory?.()).then((rows) => setRunHistory(rows || [])).catch(() => {});
  const loadRestorePoints = async (profileName, source) => {
    setRestoreDialog((current) => current && { ...current, profileName, loading: true, points: [], roots: [], selectedRoots: [] });
    try {
      const [result, defaultDir] = await Promise.all([
        api.listSnapshotsByProfile(profileName),
        api.getDefaultRestoreDir?.(source.name) ?? '',
      ]);
      const points = result.snapshots || [];
      const newest = points[0];
      setRestoreDialog((current) => current && ({
        ...current,
        loading: false,
        points,
        storageLabel: result.storageLabel,
        snapshotId: newest?.id || '',
        roots: rootLabels(newest),
        selectedRoots: rootLabels(newest),
        destPath: current.destPath || defaultDir,
      }));
    } catch (error) {
      notify(error.message, 'error');
      setRestoreDialog((current) => current && { ...current, loading: false, points: [] });
    }
  };
  const openRestoreDialog = async (source, profileName) => {
    const destinations = destinationsOf(source);
    const chosen = profileName || destinations[0];
    setRestoreDialog({
      source,
      destinations,
      profileName: chosen,
      points: [],
      roots: [],
      selectedRoots: [],
      loading: true,
      destPath: '',
      snapshotId: '',
    });
    loadRestorePoints(chosen, source);
  };
  const chooseRestorePoint = async (snapshotId) => {
    setRestoreDialog((current) => current && { ...current, snapshotId });
    const { profileName } = restoreDialog;
    try {
      const detail = await api.getSnapshotDetail?.(profileName, snapshotId);
      if (!detail) return;
      const labels = rootLabels(detail);
      setRestoreDialog((current) => current && ({ ...current, roots: labels, selectedRoots: labels }));
    } catch { /* keep whatever the list already told us */ }
  };
  const runRestore = async () => {
    const { source, profileName, snapshotId, destPath, roots, selectedRoots } = restoreDialog;
    if (!destPath) { notify('Choose where to restore the files.', 'error'); return; }
    if (roots.length > 1 && selectedRoots.length === 0) { notify('Choose at least one folder to restore.', 'error'); return; }
    setRestoreDialog(null);
    try {
      await persistIfNeeded();
      setLastRestorePath(destPath);
      setPage('overview');
      await api.startOperation({
        type: 'restore',
        profileName,
        snapshotId,
        destPath,
        sourceName: source.name,
        roots: roots.length > 1 && selectedRoots.length < roots.length ? selectedRoots : [],
      });
    } catch (error) { notify(error.message, 'error'); }
  };

  const signIn = async () => {
    setSigningIn(true);
    try {
      setSession(await api.signIn());
      notify('Signed in.');
    } catch (error) { notify(error.message, 'error'); }
    finally { setSigningIn(false); }
  };
  const cancelSignIn = async () => {
    try { await api.cancelSignIn?.(); } catch { /* the flow may have finished already */ }
    setSigningIn(false);
  };
  const signOut = async () => {
    try { setSession(await api.signOut()); notify('Signed out. Backups continue to run.'); }
    catch (error) { notify(error.message, 'error'); }
  };
  const startGoogleAuth = async (profileName) => {
    try {
      await persistIfNeeded();
      await api.startOperation({ type: 'auth-google', profileName });
    } catch (error) { notify(error.message, 'error'); }
  };
  const testStorage = async (name) => {
    setTestingProfile(name);
    try {
      await persistIfNeeded();
      const result = await api.testStorage(name);
      notify(`${storageName(result.profileType)} connection successful.`);
      if (result.profileType === 'google_drive') refreshGoogleAccount(name);
    } catch (error) { notify(error.message, 'error'); }
    finally { setTestingProfile(''); }
  };
  const verifyStorage = async (name) => {
    setVerifyingProfile(name);
    try {
      await persistIfNeeded();
      const result = await api.verifyRepository(name);
      notify(
        result.ok
          ? result.checkedSnapshots
            ? `Verified ${result.checkedSnapshots} restore point(s) — nothing missing.`
            : 'Nothing backed up here yet, so there is nothing to check.'
          : `${result.missingChunks} piece(s) of data are missing across ${result.damagedSnapshots.length} restore point(s).`,
        result.ok ? 'success' : 'error'
      );
    } catch (error) { notify(error.message, 'error'); }
    finally { setVerifyingProfile(''); }
  };
  const loadSnapshotsByProfile = async (profileName) => {
    if (!profileName) { setSnapshots([]); setSnapshotsMeta(''); return; }
    try {
      await persistIfNeeded();
      const result = await api.listSnapshotsByProfile(profileName);
      setSnapshots(result.snapshots);
      setSnapshotsMeta(result.storageLabel);
    } catch (error) { setSnapshots([]); notify(error.message, 'error'); }
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

  // Accounts are optional: with no service configured the app is fully usable.
  if (!session.signedIn && !offlineMode && session.signInAvailable) {
    return (
      <div className="loading-screen sign-in-screen">
        <div className="brand-mark large">BG</div>
        <h1>Backup Genie</h1>
        <p>Sign in to manage your backups. Scheduled backups keep running either way.</p>
        <div className="sign-in-actions">
          <Button busy={signingIn} onClick={signIn}>Sign in with Google</Button>
          {signingIn
            ? <Button variant="secondary" onClick={cancelSignIn}>Cancel</Button>
            : <Button variant="secondary" onClick={() => setOfflineMode(true)}>Continue offline</Button>}
        </div>
        {signingIn && <p className="sign-in-hint">Finish signing in using the browser window that just opened.</p>}
        {toast && <div className={cx('toast', toast.tone)}>{toast.message}</div>}
      </div>
    );
  }

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
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
    );
  }

  let content;
  if (page === 'overview') content = <Overview {...{ config, operation, progress, operationLogs, startBackup, startRestore, cancelOperation: api.cancelOperation, setPage, openFolder, runHistory, refreshHistory, lastRestorePath }} />;
  if (page === 'sources') content = <Sources {...{ config, setConfig, chooseDirectory, googleAccount, notify, openFolder, onRestore: openRestoreDialog }} />;
  if (page === 'storage') content = <Storage {...{ config, setConfig, chooseDirectory, testStorage, verifyStorage, verifyingProfile, startGoogleAuth, testingProfile, notify, googleAccounts }} />;
  if (page === 'restore') content = <Restore {...{ config, onRestore: openRestoreDialog, openFolder }} />;
  if (page === 'logs') content = <Logs {...{ logs, refreshLogs, operationLogs }} />;
  if (page === 'settings') content = <Settings {...{ config, setConfig, testEmail, emailTesting, schedulerState, systemInfo, onOpenWizard: () => setShowWizard(true), updateState, checkForUpdates, installUpdate, openFolder }} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">BG</div><div><strong>Backup Genie</strong><span>Business protection</span></div></div>
        <nav>{PAGES.map(([key, label, icon]) => <button key={key} className={cx(page === key && 'active')} onClick={() => setPage(key)}><span>{icon}</span>{label}</button>)}</nav>
        <div className="sidebar-account">
          {session.signedIn ? (
            <>
              <div className="account-avatar">{(session.user?.name || session.user?.email || '?').slice(0, 1).toUpperCase()}</div>
              <div className="account-detail">
                <strong title={session.user?.email}>{session.user?.name || session.user?.email}</strong>
                <span title={session.user?.email}>{session.user?.email}</span>
              </div>
              <button type="button" className="account-signout" onClick={signOut}>Sign out</button>
            </>
          ) : session.signInAvailable ? (
            <>
              <div className="account-detail">
                <strong>Not signed in</strong>
                <span>Backups still run as normal.</span>
              </div>
              <Button variant="secondary" busy={signingIn} onClick={signIn}>Sign in</Button>
            </>
          ) : (
            <div className="account-detail">
              <strong>This computer</strong>
              <span>Backups run locally. No account needed.</span>
            </div>
          )}
        </div>
        <div className="sidebar-status"><span className={cx('status-pulse', schedulerState.enabled ? '' : 'paused')} /><div><strong>{schedulerState.enabled ? 'Schedules active' : 'Schedules paused'}</strong><span>{schedulerState.jobs.length} jobs · Version {systemInfo?.version || '1.1.0'}</span></div></div>
      </aside>
      <main>
        <header className="topbar"><div><h1>{PAGES.find(([key]) => key === page)?.[1]}</h1><span className="config-path" title={configFile}>{configFile}</span></div><div className="topbar-actions"><button className="theme-toggle" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '☾'}</button><Pill tone={operation?.status === 'running' ? 'info' : 'success'}>{operation?.status === 'running' ? 'Running' : 'Ready'}</Pill><Button variant={dirty ? 'primary' : 'secondary'} busy={saving} onClick={save}>{dirty ? 'Save changes' : 'Saved'}</Button></div></header>
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
      {backupWarning && (
        <div className="modal-overlay">
          <div className="modal">
            <span className="eyebrow">Backup starting soon</span>
            <h2>Please save and close your files</h2>
            <p>
              “{backupWarning.sourceName}” will be backed up in about {backupWarning.minutes} minutes.
              Files that are open and unsaved may be copied in a half-written state, so save your work now.
            </p>
            <div className="modal-actions">
              <Button onClick={() => setBackupWarning(null)}>I have saved my work</Button>
            </div>
          </div>
        </div>
      )}
      {restoreDialog && (
        <div className="modal-overlay">
          <div className="modal">
            <span className="eyebrow">Restore</span>
            <h2>Restore “{restoreDialog.source.name}”</h2>
            {restoreDialog.loading ? (
              <p>Reading restore points from {restoreDialog.profileName}…</p>
            ) : restoreDialog.points.length === 0 ? (
              <p>No restore points found in {restoreDialog.profileName} yet. Run a backup first.</p>
            ) : (
              <>
                <p>Pick the day you want back. Files are copied to a new folder, never over your live data.</p>
                {restoreDialog.destinations.length > 1 && (
                  <SelectField
                    label="Restore from"
                    value={restoreDialog.profileName}
                    onChange={(event) => loadRestorePoints(event.target.value, restoreDialog.source)}
                  >
                    {restoreDialog.destinations.map((name, i) => (
                      <option key={name} value={name}>{name}{i === 0 ? ' — main destination' : ' — copy'}</option>
                    ))}
                  </SelectField>
                )}
                <SelectField
                  label="Restore point"
                  value={restoreDialog.snapshotId}
                  onChange={(event) => chooseRestorePoint(event.target.value)}
                >
                  {restoreDialog.points.map((point, i) => (
                    <option key={point.id} value={point.id}>
                      {displayDate(point.createdAt)}{i === 0 ? ' — most recent' : ''}
                    </option>
                  ))}
                </SelectField>
                {restoreDialog.roots.length > 1 && (
                  <div className="field">
                    <span className="field-label">Folders to restore</span>
                    <div className="destination-list">
                      {restoreDialog.roots.map((root) => (
                        <label className="check-row" key={root}>
                          <input
                            type="checkbox"
                            checked={restoreDialog.selectedRoots.includes(root)}
                            onChange={(event) => setRestoreDialog((current) => ({
                              ...current,
                              selectedRoots: event.target.checked
                                ? [...current.selectedRoots, root]
                                : current.selectedRoots.filter((item) => item !== root),
                            }))}
                          />
                          <span>{root}</span>
                        </label>
                      ))}
                    </div>
                    <span className="field-hint">This backup covers several folders. Restore all of them, or just the one you need.</span>
                  </div>
                )}
                <div className="path-row">
                  <Field
                    label="Restore into"
                    value={restoreDialog.destPath}
                    onChange={(event) => setRestoreDialog((current) => ({ ...current, destPath: event.target.value }))}
                    hint="Defaults to your Downloads folder."
                  />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      const selected = await chooseDirectory(restoreDialog.destPath);
                      if (selected) setRestoreDialog((current) => ({ ...current, destPath: selected }));
                    }}
                  >
                    Browse
                  </Button>
                </div>
              </>
            )}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setRestoreDialog(null)}>Cancel</Button>
              {!restoreDialog.loading && restoreDialog.points.length > 0 && (
                <Button onClick={runRestore}>Restore files</Button>
              )}
            </div>
          </div>
        </div>
      )}
      {repoConflict && (
        <div className="modal-overlay">
          <div className="modal">
            <span className="eyebrow warn">Backup stopped — action needed</span>
            <h2>{repoConflict.status === 'missing' ? 'Your backup history was not found' : 'This destination holds a different backup'}</h2>
            <p>
              {repoConflict.status === 'missing'
                ? <>The storage for <strong>{repoConflict.profileName}</strong> no longer contains the backup repository. It was most likely deleted, emptied, or moved.</>
                : <>The storage for <strong>{repoConflict.profileName}</strong> now contains a different backup repository than this computer used before.</>}
            </p>
            <div className="modal-facts">
              <div><span>Storage</span><strong>{repoConflict.storageLabel}</strong></div>
              <div><span>Source</span><strong>{repoConflict.sourceName}</strong></div>
            </div>
            <div className="modal-note">
              <strong>Your old restore points were not deleted by Backup Genie.</strong> They live in the original location. If the folder was removed by mistake, restore it (check the cloud provider's trash) or point this profile back at the original location — the history will reappear.
            </div>
            <p className="modal-warning">Starting a new history keeps your files safe going forward, but earlier restore points will no longer be listed for this source.</p>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setRepoConflict(null)}>Cancel — I'll check the storage</Button>
              <Button
                busy={acceptingRepo}
                onClick={async () => {
                  setAcceptingRepo(true);
                  try {
                    await api.acceptRepository(repoConflict.profileName);
                    setRepoConflict(null);
                    notify('Starting a new backup history at this location.');
                    await api.startOperation({ type: 'backup', sourceName: repoConflict.sourceName });
                  } catch (error) {
                    notify(error.message, 'error');
                  } finally {
                    setAcceptingRepo(false);
                  }
                }}
              >Start a new backup history here</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
