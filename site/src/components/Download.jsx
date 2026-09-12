import { useEffect, useState } from 'react';
import { company, product } from '../content.js';
import { Reveal } from '../useReveal.jsx';
import edition from '../../../shared/edition.json';
import icon from '../../../assets/branding/icon-192.png';

export default function Download() {
  const [release, setRelease] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let active = true;
    setRelease({ status: 'loading' });
    fetch(product.releaseApiUrl, { signal: controller.signal })
      .then(async response => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('Release lookup failed');
        return response.json();
      })
      .then(data => {
        const asset = data?.assets?.find(item => item.name === 'Backup-Genie-Starter-Setup.exe' && item.state === 'uploaded');
        if (active) setRelease(asset && !data.draft && !data.prerelease
          ? { status: 'ready', version: data.tag_name, size: asset.size, url: `${product.repoUrl}/releases/download/${encodeURIComponent(data.tag_name)}/Backup-Genie-Starter-Setup.exe` }
          : { status: 'pending' });
      })
      .catch(() => { if (active) setRelease({ status: 'error' }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  return <section className="section download-section" id="download">
    <div className="container download-layout">
      <img src={icon} width="96" height="96" alt="" />
      <Reveal className="section-head">
        <span className="eyebrow">Windows · Early access</span>
        <h2>Backup Genie {edition.name}</h2>
        <p>Install it yourself. Back up your folders to your own Google Drive.</p>
        <ul className="download-facts">
          <li>{edition.maxGoogleDriveProfiles} Google Drive profile per installation</li>
          <li>Multiple source folders, scheduled backups and versioned restore</li>
          <li>No local, NAS, S3, Azure or additional Drive backup destinations</li>
          <li>Company email reporting requires account activation; backup works without it</li>
        </ul>
        <div className="hero-actions">
          {release.status === 'ready'
            ? <a className="btn btn-primary" href={release.url}>Download for Windows</a>
            : <button className="btn btn-primary" disabled>{release.status === 'loading' ? 'Checking release...' : 'Installer not available yet'}</button>}
          <a className="btn btn-secondary" href={`mailto:${company.email}`}>Contact us</a>
          {release.status === 'error' && <button className="btn btn-ghost" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
        </div>
        <p className="download-status" role="status">
          {release.status === 'ready' ? `${release.version} · Windows x64 · ${Math.ceil(release.size / 1048576)} MB`
            : release.status === 'pending' ? 'The Starter installer is awaiting publication. Earlier unrestricted releases are not offered here.'
              : release.status === 'error' ? 'GitHub could not be reached. Please retry shortly.' : 'Looking for the latest Starter installer.'}
        </p>
        <p className="download-status">Early-access builds may show a Windows publisher warning. Keep a separate copy of important data while evaluating.</p>
      </Reveal>
    </div>
  </section>;
}