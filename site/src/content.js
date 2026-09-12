/**
 * Single source of truth for every word, link and number on the marketing site.
 * Edit this file (not the components) to update copy, address or roadmap status.
 */

export const company = {
  name: 'Udgam AI',
  tagline: 'Practical software for businesses that cannot afford to lose data.',
  website: 'https://udgam.ai',
  productLine: 'Udgam AI Product Line',
  // TODO: replace with the registered business address before launch.
  address: {
    lines: ['[Business address line 1]', '[Business address line 2]', '[City, State, PIN]'],
    country: 'India',
  },
  email: 'contact@udgamai.com',
  support: 'contact@udgamai.com',
  showRegisteredOffice: false,
  phone: '',
  // TODO: replace with the registered entity details before launch.
  legalName: 'Udgam AI',
  gstin: '',
};

export const product = {
  name: 'Backup Genie',
  downloadsEnabled: false,
  version: 'v0.0.1',
  versionLabel: 'Starter · Early access',
  headline: 'Any folder. Any day. Back in one click.',
  subhead:
    'Backup Genie takes automatic, versioned, off-site backups of any folder on your machine — documents, accounts, design files, databases, project archives — deduplicated so only what changed is uploaded, and restorable to any past day.',
  downloadUrl: 'https://github.com/vinodkumarsharma276/tally-backup/releases/latest/download/Backup-Genie-Starter-Setup.exe',
  releaseApiUrl: 'https://api.github.com/repos/vinodkumarsharma276/tally-backup/releases/latest',
  docsUrl: 'https://github.com/vinodkumarsharma276/tally-backup#readme',
  repoUrl: 'https://github.com/vinodkumarsharma276/tally-backup',
};

export const stats = [
  { value: 60, suffix: 's', label: 'Typical time to first backup' },
  { value: 90, suffix: '%', label: 'Less uploaded after day one, thanks to dedup' },
  { value: 30, suffix: '+', label: 'Restore points kept by default' },
  { value: 1, suffix: '', label: 'Google Drive profile in Starter' },
];

export const features = [
  {
    icon: '📁',
    title: 'Any folder, any file type',
    body:
      'Add as many source folders as you like — accounts data, documents, code, CAD, media, database dumps, server configs. If Windows can see it, Backup Genie can protect it.',
  },
  {
    icon: '🕒',
    title: 'Restore any past day',
    body:
      'Every run creates a versioned snapshot, not a mirror. Roll a whole folder back to yesterday, last week, or the day before someone overwrote it.',
  },
  {
    icon: '⚡',
    title: 'Incremental & deduplicated',
    body:
      'Content-defined chunking means a 2 GB file that changed by a few MB uploads a few MB — fast runs and small storage bills, even on large binary files.',
  },
  {
    icon: '☁️',
    title: 'Your own Google Drive',
    body:
      'Starter connects to one Google Drive storage profile. Back up multiple source folders to that destination. Other storage providers and extra destinations are not included in this edition.',
  },
  {
    icon: '📅',
    title: 'Set it once, report by email',
    body:
      'Runs quietly on a schedule from the notification area, survives reboots as a Windows service, and emails a report after every run — so you hear about a problem from your inbox, not from a disaster.',
  },
  {
    icon: '🔐',
    title: 'Secrets stay in the vault',
    body:
      'Credentials live in the OS credential vault, transfers are TLS-protected, and cloud keys are never shipped inside the installer.',
  },
];

export const steps = [
  {
    n: '01',
    title: 'Install',
    body: product.downloadsEnabled
      ? 'Download the Windows Starter installer and run setup. No scripts or command line needed.'
      : 'Contact us about early access to the Windows Starter edition. Public downloads are not yet available.',
  },
  {
    n: '02',
    title: 'Pick your folders',
    body: 'Connect your Google Drive and add the folders worth keeping. All sources use your one Drive destination.',
  },
  {
    n: '03',
    title: 'Pick a schedule',
    body: 'Nightly at 8 PM by default. Change it, add more slots, or run on demand any time.',
  },
  {
    n: '04',
    title: 'Restore when it matters',
    body: 'Browse the timeline, pick a day, restore the whole folder to a safe location.',
  },
];

/**
 * status: 'live' shows a green "Available now" chip; everything else renders as
 * a roadmap card with the given label.
 */
export const roadmap = [
  {
    status: 'live',
    label: 'In v0.0.1',
    title: 'Versioned backup & restore engine',
    body: 'Incremental, deduplicated snapshots of any folder, with point-in-time restore, verification and retention.',
  },
  {
    status: 'live',
    label: 'In v0.0.1',
    title: 'Scheduling, tray app & email reports',
    body: 'Background scheduler, desktop notifications and per-run report emails from our servers.',
  },
  {
    status: 'live',
    label: 'In v0.0.1',
    title: 'Multiple sources, one Google Drive',
    body: 'Starter protects multiple folders using one Google Drive profile. Restore points and scheduling remain available.',
  },
  {
    status: 'planned',
    label: 'Not in Starter',
    title: 'More providers and destinations',
    body: 'S3, Azure Blob, NAS, local storage and multiple destinations are reserved for future editions. Availability and pricing are not yet announced.',
  },
  {
    status: 'next',
    label: 'Next up',
    title: 'SISU — Sign-in & Sign-up accounts',
    body:
      'A Backup Genie account that follows you across machines: sign up once, sign in anywhere, and carry your profiles, schedules and restore history with you.',
  },
  {
    status: 'next',
    label: 'Next up',
    title: 'Data hiding',
    body:
      'Keep sensitive folders invisible to everyone but the people you name — hidden from casual browsing on the machine and unreadable in the backup store.',
  },
  {
    status: 'planned',
    label: 'Planned',
    title: 'Access control & roles',
    body:
      'Owner, operator and viewer roles so a staff member can run a backup without being able to change destinations, delete snapshots or restore data.',
  },
  {
    status: 'planned',
    label: 'Planned',
    title: 'Managed cloud tier',
    body:
      'Encrypted, metered storage we host and operate. No Drive quota, no S3 console — just a plan and a usage meter.',
  },
  {
    status: 'planned',
    label: 'Planned',
    title: 'macOS & Linux builds',
    body:
      'The engine already runs cross-platform. Native installers and tray apps for macOS and Linux follow the Windows release.',
  },
  {
    status: 'exploring',
    label: 'Exploring',
    title: 'Fleet dashboard for teams',
    body:
      'One web view for firms and IT teams managing many machines: last run, health, quota and alerts across every device.',
  },
];

export const useCases = [
  { icon: '📒', label: 'Accounting data (Tally, Busy, Zoho)' },
  { icon: '📄', label: 'Documents & contracts' },
  { icon: '🎨', label: 'Design, CAD & media projects' },
  { icon: '💾', label: 'Database dumps & app data' },
  { icon: '💻', label: 'Source code & repositories' },
  { icon: '📷', label: 'Photo & video archives' },
  { icon: '⚙️', label: 'Server & machine configuration' },
  { icon: '🗄️', label: 'Shared network drives' },
];

export const audiences = [
  {
    title: 'Small & medium businesses',
    body:
      'Accounts, invoices, contracts and shared drives. One disk failure should not cost you a financial year.',
  },
  {
    title: 'Accounting & professional firms',
    body:
      'Tally, Busy or spreadsheet-based books across dozens of client machines — one standard policy, and evidence that it ran.',
  },
  {
    title: 'Studios, agencies & engineers',
    body:
      'Design files, CAD, footage, source code and project archives that are far too big to copy in full every night.',
  },
  {
    title: 'Developers & small IT teams',
    body:
      'Database dumps, server configs and app data, versioned off-site on a schedule without writing a single backup script.',
  },
  {
    title: 'Multi-branch operations',
    body: 'Protect folders on each machine with its own Starter installation and one Google Drive profile.',
  },
  {
    title: 'Anyone with irreplaceable files',
    body:
      'Photos, records, research, personal archives. If losing it would ruin your week, it belongs in Backup Genie.',
  },
];

export const faqs = [
  {
    q: 'What can Backup Genie back up?',
    a: 'Any folder on the machine. Documents, accounting data, design and CAD files, media, source code, database dumps, server configuration — whatever you point it at. It handles very large binary files well, which is why accounting and design teams tend to find it first.',
  },
  {
    q: 'Do I have to close the applications using those files?',
    a: 'No. Backup Genie reads your folders on a schedule and captures a consistent snapshot. Restores are written to a separate location, so your live folder is never overwritten by surprise.',
  },
  {
    q: 'Where exactly does my data go?',
    a: 'The Starter download backs up to your own Google Drive, using one storage profile per installation. Multiple source folders can share that profile. Other providers and multiple backup destinations are not included.',
  },
  {
    q: 'How much storage will it use?',
    a: 'Far less than daily full copies. Data is split into chunks and only new chunks are uploaded, so a large file that changes slightly each day costs a few MB per day, not a few GB.',
  },
  {
    q: 'Is my data encrypted?',
    a: 'Transfers are TLS-protected and storage credentials are kept in the operating system credential vault rather than in config files. The managed tier adds encryption at rest and tenant isolation.',
  },
  {
    q: 'What is in v0.0.1 versus the roadmap?',
    a: 'Starter includes versioned backup and restore, scheduling, multiple source folders and one Google Drive profile. Company email reports require a provisioned account and licence key. Extra storage providers, SISU, data hiding and access control are not included.',
  },
  {
    q: 'Can I try it before paying?',
    a: product.downloadsEnabled
      ? 'Yes. Download the Starter edition for Windows and connect your Google Drive. You can install it yourself; contact us for help or to activate company email reporting. No payment is required for this early-access evaluation.'
      : 'Contact us about an early-access evaluation of Starter for Windows. Public downloads are not yet available. Company email reporting requires activation.',
  },
];

export const nav = [
  ...(product.downloadsEnabled ? [{ href: '#download', label: 'Download' }] : []),
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#roadmap', label: 'Roadmap' },
  { href: '#faq', label: 'FAQ' },
  { href: '#contact', label: 'Contact' },
];

/**
 * POST target for the enquiry form (the control plane's public /v1/contact
 * endpoint). Set VITE_CONTACT_API at build time; when empty the form falls back
 * to opening the visitor's mail client so the page is never a dead end.
 */
export const contactEndpoint = import.meta.env.VITE_CONTACT_API || '';
