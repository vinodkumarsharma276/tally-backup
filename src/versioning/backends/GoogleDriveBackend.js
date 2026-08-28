'use strict';

const { Readable } = require('stream');
const logger = require('../../utils/logger');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_MIME = 'application/octet-stream';
const MAX_RATE_LIMIT_RETRIES = 8;

// Everything the versioned store is allowed to put in a repository root:
// loose-object layout, packed layout, and the repository identity marker.
const VERSIONED_ENTRIES = new Set(['objects', 'packs', 'snapshots', 'refs.json', 'repo.json']);

// Drive reports throttling inconsistently: sometimes as `errors[].reason`,
// sometimes only as prose ("User rate limit exceeded."), and the HTTP status
// may be 403 or 429. Match on any of them rather than one shape.
function isRateLimitError(err) {
  if (!err) return false;
  const status = err.code || err.status || (err.response && err.response.status);
  const apiError = err.response && err.response.data && err.response.data.error;
  const haystack = [
    ...(err.errors || []).map((e) => e && e.reason),
    ...(((apiError && apiError.errors) || []).map((e) => e && e.reason)),
    apiError && apiError.status,
    apiError && apiError.message,
    err.message,
  ]
    .filter(Boolean)
    .join(' ');
  if (!/rate.?limit|quota.?exceeded|too many requests|resource_exhausted|backendError|internal error/i.test(haystack)) {
    return false;
  }
  return status === 403 || status === 429 || status === 500 || status === 503 || !status;
}

/**
 * GoogleDriveBackend — storage backend that maps object keys onto a Google
 * Drive folder hierarchy, implementing the same interface as LocalFsBackend:
 *   exists(key) / put(key, buffer) / get(key) / list(prefix) / delete(key)
 *
 * Keys are posix paths (e.g. "objects/ab/abcd...", "snapshots/<id>.json",
 * "refs.json"). Drive is not a path filesystem (files are looked up by
 * name+parent), so we keep two caches to avoid an API call per chunk:
 *   - folderCache:    posix dir path  -> Drive folderId
 *   - folderListings: Drive folderId  -> Map(childName -> {id, mimeType, size})
 * Each folder is listed at most once (paginated) and the listing is updated in
 * memory as we put/delete, so thousands of put-if-absent checks become cheap.
 */
class GoogleDriveBackend {
  /**
   * @param {object} driveService Initialized GoogleDriveService.
   * @param {object} opts
   * @param {string} opts.rootFolderName Top-level Drive folder for this store.
   */
  constructor(driveService, opts = {}) {
    if (!driveService) throw new Error('GoogleDriveBackend requires a GoogleDriveService.');
    if (!opts.rootFolderName) throw new Error('GoogleDriveBackend requires rootFolderName.');
    this.driveService = driveService;
    this.rootFolderName = opts.rootFolderName;
    this.allowMixed = !!opts.allowMixed; // override the mirror-collision guard
    this.rootFolderId = null;
    this.folderCache = new Map(); // posix dir -> folderId
    this.folderListings = new Map(); // folderId -> Map(name -> {id, mimeType, size})
    this.listPromises = new Map(); // folderId -> in-flight Promise<listing>
    this.dirCreatePromises = new Map(); // posix dir -> in-flight Promise<folderId>
  }

  get drive() {
    return this.driveService.drive;
  }

  async _retry(fn) {
    // driveService.apiCall handles transient network errors; we add backoff for
    // Drive rate-limiting (403 rateLimitExceeded / userRateLimitExceeded, 429),
    // which can occur under concurrent uploads.
    let attempt = 0;
    for (;;) {
      try {
        return await this.driveService.apiCall(fn);
      } catch (err) {
        if (!isRateLimitError(err) || attempt >= MAX_RATE_LIMIT_RETRIES) throw err;
        // Drive quotas refill on a rolling 60s window, so waiting is worthwhile.
        const delay = Math.min(2 ** attempt * 1000 + Math.random() * 500, 60000);
        attempt += 1;
        logger.warn(
          `Google Drive rate limit hit (${err.message}). Waiting ${Math.round(delay / 1000)}s ` +
            `before retry ${attempt}/${MAX_RATE_LIMIT_RETRIES}.`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  /** Resolve/create the root folder. Must be called once before use. */
  async init() {
    this.rootFolderId = await this.driveService.ensureBackupFolder(this.rootFolderName);
    this.folderCache.set('', this.rootFolderId);
    await this._guardNotAMirror();
    return this.rootFolderId;
  }

  // Refuse to use a root folder that already holds non-versioned content (e.g.
  // a legacy mirror with DATA/VHA/TDL). Pass { allowMixed: true } to override.
  async _guardNotAMirror() {
    const children = await this._listFolder(this.rootFolderId);
    const foreign = [...children.keys()].filter((name) => !VERSIONED_ENTRIES.has(name));
    if (foreign.length > 0 && !this.allowMixed) {
      const sample = foreign.slice(0, 5).join(', ');
      throw new Error(
        `Refusing to use Drive folder "${this.rootFolderName}": it contains non-versioned ` +
          `content (${sample}${foreign.length > 5 ? ', ...' : ''}). The versioned store needs its ` +
          `own dedicated folder. Choose a different backupFolderName, or pass allowMixed:true to override.`
      );
    }
  }

  static _split(key) {
    const i = key.lastIndexOf('/');
    if (i < 0) return { dir: '', name: key };
    return { dir: key.slice(0, i), name: key.slice(i + 1) };
  }

  async _listFolder(folderId) {
    if (this.folderListings.has(folderId)) return this.folderListings.get(folderId);
    // De-duplicate concurrent listings of the same folder so callers share one
    // round-trip (and one listing object), avoiding redundant API calls.
    if (this.listPromises.has(folderId)) return this.listPromises.get(folderId);
    const p = (async () => {
      const map = new Map();
      let pageToken;
      do {
        const resp = await this._retry(() =>
          this.drive.files.list({
            q: `'${folderId}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, mimeType, size)',
            pageSize: 1000,
            pageToken: pageToken || undefined,
          })
        );
        for (const f of resp.data.files || []) {
          map.set(f.name, { id: f.id, mimeType: f.mimeType, size: f.size ? Number(f.size) : 0 });
        }
        pageToken = resp.data.nextPageToken;
      } while (pageToken);
      this.folderListings.set(folderId, map);
      return map;
    })();
    this.listPromises.set(folderId, p);
    try {
      return await p;
    } finally {
      this.listPromises.delete(folderId);
    }
  }

  async _createFolder(name, parentId) {
    const resp = await this._retry(() =>
      this.drive.files.create({
        resource: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        fields: 'id, name',
      })
    );
    return resp.data;
  }

  /**
   * Resolve a posix dir path to a Drive folderId. Creates missing folders when
   * `create` is true; returns null when a folder is missing and create=false.
   */
  async _resolveDir(dirPosix, create) {
    if (dirPosix === '' || dirPosix === '.') return this.rootFolderId;
    if (this.folderCache.has(dirPosix)) return this.folderCache.get(dirPosix);

    const segments = dirPosix.split('/').filter(Boolean);
    let parentId = this.rootFolderId;
    let pathSoFar = '';
    for (const seg of segments) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
      const resolved = await this._resolveChild(parentId, seg, pathSoFar, create);
      if (resolved == null) return null;
      parentId = resolved;
    }
    return parentId;
  }

  /**
   * Resolve a single child folder `name` under `parentId` (whose full posix
   * path is `pathSoFar`). When it must be created, the creation is memoized per
   * path so concurrent callers share ONE folder instead of each racing to
   * create their own duplicate (Drive allows same-named folders).
   */
  async _resolveChild(parentId, name, pathSoFar, create) {
    if (this.folderCache.has(pathSoFar)) return this.folderCache.get(pathSoFar);

    const listing = await this._listFolder(parentId);
    const entry = listing.get(name);
    if (entry && entry.mimeType === FOLDER_MIME) {
      this.folderCache.set(pathSoFar, entry.id);
      return entry.id;
    }
    if (!create) return null;

    // Serialize creation: the first caller creates the folder, concurrent
    // callers for the same path await the same promise.
    let p = this.dirCreatePromises.get(pathSoFar);
    if (!p) {
      p = (async () => {
        // Re-check under the lock in case another caller created it meanwhile.
        const fresh = (await this._listFolder(parentId)).get(name);
        if (fresh && fresh.mimeType === FOLDER_MIME) {
          this.folderCache.set(pathSoFar, fresh.id);
          return fresh.id;
        }
        const created = await this._createFolder(name, parentId);
        listing.set(name, { id: created.id, mimeType: FOLDER_MIME, size: 0 });
        this.folderListings.set(created.id, new Map()); // brand-new -> empty
        this.folderCache.set(pathSoFar, created.id);
        return created.id;
      })();
      this.dirCreatePromises.set(pathSoFar, p);
      p.catch(() => {}).finally(() => {
        if (this.dirCreatePromises.get(pathSoFar) === p) this.dirCreatePromises.delete(pathSoFar);
      });
    }
    return p;
  }

  async exists(key) {
    const { dir, name } = GoogleDriveBackend._split(key);
    const folderId = await this._resolveDir(dir, false);
    if (!folderId) return false;
    const listing = await this._listFolder(folderId);
    return listing.has(name);
  }

  async put(key, buffer) {
    const { dir, name } = GoogleDriveBackend._split(key);
    const folderId = await this._resolveDir(dir, true);
    const listing = await this._listFolder(folderId);
    const existing = listing.get(name);

    let resp;
    if (existing) {
      resp = await this._retry(() =>
        this.drive.files.update({
          fileId: existing.id,
          media: { mimeType: FILE_MIME, body: Readable.from(buffer) },
          fields: 'id, size',
        })
      );
    } else {
      resp = await this._retry(() =>
        this.drive.files.create({
          resource: { name, parents: [folderId] },
          media: { mimeType: FILE_MIME, body: Readable.from(buffer) },
          fields: 'id, size',
        })
      );
    }
    listing.set(name, { id: resp.data.id, mimeType: FILE_MIME, size: buffer.length });
  }

  async get(key) {
    const { dir, name } = GoogleDriveBackend._split(key);
    const folderId = await this._resolveDir(dir, false);
    if (!folderId) throw new Error(`Drive get: folder missing for ${key}`);
    const listing = await this._listFolder(folderId);
    const entry = listing.get(name);
    if (!entry) throw new Error(`Drive get: object not found ${key}`);
    const resp = await this._retry(() =>
      this.drive.files.get({ fileId: entry.id, alt: 'media' }, { responseType: 'arraybuffer' })
    );
    return Buffer.from(resp.data);
  }

  async delete(key) {
    const { dir, name } = GoogleDriveBackend._split(key);
    const folderId = await this._resolveDir(dir, false);
    if (!folderId) return;
    const listing = await this._listFolder(folderId);
    const entry = listing.get(name);
    if (!entry) return;
    await this._retry(() => this.drive.files.delete({ fileId: entry.id }));
    listing.delete(name);
  }

  /** Recursively list all object keys (posix) under `prefix`. */
  async list(prefix) {
    const dirPosix = prefix.replace(/\/+$/, '');
    const folderId = await this._resolveDir(dirPosix, false);
    if (!folderId) return [];
    const out = [];
    const walk = async (fid, pathPrefix) => {
      const listing = await this._listFolder(fid);
      for (const [name, entry] of listing) {
        const childKey = pathPrefix ? `${pathPrefix}/${name}` : name;
        if (entry.mimeType === FOLDER_MIME) await walk(entry.id, childKey);
        else out.push(childKey);
      }
    };
    await walk(folderId, dirPosix);
    return out;
  }
}

module.exports = GoogleDriveBackend;
