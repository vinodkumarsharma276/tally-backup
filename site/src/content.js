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
  email: 'hello@backupgenie.app',
  support: 'support@backupgenie.app',
  phone: '',
  // TODO: replace with the registered entity details before launch.
  legalName: 'Udgam AI',
  gstin: '',
};

export const product = {
  name: 'Backup Genie',
  version: 'v0.0.1',
  versionLabel: 'Early access',
  headline: 'Any folder. Any day. Back in one click.',
  subhead:
    'Backup Genie takes automatic, versioned, off-site backups of any folder on your machine — documents, accounts, design files, databases, project archives — deduplicated so only what changed is uploaded, and restorable to any past day.',
  downloadUrl: 'https://github.com/vinodkumarsharma276/tally-backup/releases/latest',
  docsUrl: 'https://github.com/vinodkumarsharma276/tally-backup#readme',
  repoUrl: 'https://github.com/vinodkumarsharma276/tally-backup',
};

export const stats = [
  { value: 60, suffix: 's', label: 'Typical time to first backup' },
  { value: 90, suffix: '%', label: 'Less uploaded after day one, thanks to dedup' },
  { value: 30, suffix: '+', label: 'Restore points kept by default' },
  { value: 5, suffix: '', label: 'Storage targets supported' },
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
    title: 'Your storage or ours',
    body:
      'Bring your own Google Drive, Amazon S3, Azure Blob, NAS or local disk — or use our managed, encrypted cloud and skip the setup entirely. Send one folder to several places at once.',
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
    body: 'One signed installer for Windows. No scripts, no command line, no cloud console.',
  },
  {
    n: '02',
    title: 'Pick your folders',
    body: 'Add any folders worth keeping and choose where the copies should go. Several sources, several destinations.',
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
    title: 'Multi-source, multi-destination',
    body: 'Many source folders to Google Drive, Amazon S3, Azure Blob, network shares and local disks — several at once.',
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
    body: 'Several machines, several destinations, one consistent restore story across all of them.',
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
    a: 'Wherever you choose. Backup Genie supports your own Google Drive, Amazon S3, Azure Blob, a NAS or network share, and plain local or external disks. You can send the same source folder to more than one destination.',
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
    a: 'v0.0.1 ships the backup, restore, scheduling, multi-source, multi-destination and reporting engine. Accounts (SISU), data hiding and access control are on the roadmap and are marked as such above — we do not sell what is not built yet.',
  },
  {
    q: 'Can I try it before paying?',
    a: 'Yes. Early access builds are free to evaluate on your own storage. Tell us about your setup through the form below and we will send you a build and a walkthrough.',
  },
];

export const nav = [
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
