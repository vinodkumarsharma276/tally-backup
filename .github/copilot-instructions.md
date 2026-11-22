# Copilot Instructions

**Backup Genie** — a Windows-first Electron desktop app that takes automatic, versioned,
deduplicated off-site backups of arbitrary folders and restores any folder to any retained
past day. Node.js throughout; React for the renderer.

The repository is named `tally-backup` and the package is `tally-backup-pro` because the
product began as a Tally-specific backup CLI. **It is no longer Tally-specific.** Treat
any file still using that branding as legacy.

📖 **Read [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) before non-trivial work.** It holds
the full architecture, the config schema, the invariants and the legacy map. This file is
the short version.

## Where things are

- `src/versioning/` — the engine: FastCDC chunker, content-addressed object store,
  snapshot store, GC, and the storage backends. Backends share one contract:
  `exists / put / get / list / delete`.
- `bin/versioned-*.js` — headless runners the desktop app forks.
- `desktop/` + `ui/` — Electron main process and React renderer.
- `server/` — managed-tier control plane, a **separate deployable**, never bundled.
- `site/` — marketing site; all copy lives in `site/src/content.js`.
- `test/` — the spec. `npm test` runs every suite.

## Rules that matter

1. **Verify byte-identical restores.** Any change touching backup or restore must be
   checked with `node tools/versioned-backup.js verify "<original>" "<restored>"`, which
   must print `RESULT: IDENTICAL`.
2. **Never put secrets in `config.json`.** Use `secret:<key>` references resolved through
   `SecretStore` (OS vault), or `env:<NAME>`. A test fails the build otherwise.
3. **Master cloud keys never ship in the desktop app.** Managed storage uses short-lived,
   prefix-scoped leases vended by the control plane.
4. **Resolve every path through `ConfigPathManager`** (singleton; handles dev vs installed
   and the legacy folder migration). Never build paths by hand.
5. **Create backends through `createBackend()`** in `src/versioning/backends/index.js`,
   never directly.
6. **Respect the safety guards** — the mirror-collision guard, the `repo.json` identity
   marker, and the refusal to restore over a live backup source. They exist because each
   one already prevented a real data-loss incident.
7. **Enforce edition limits at run time**, in `EditionPolicy`, not only in the UI.
8. **Skip sources with `enabled === false`** everywhere: runners, scheduler, email.
9. **Use the singleton logger** (`src/utils/logger.js`) and the shared progress renderer
   (`src/utils/cliProgress.js`). Do not hand-roll either.
10. **Do not extend the legacy surface** — `index.js`, `bin/tally-backup.js`,
    `src/TallyBackup.js`, `src/TallyRestore.js`, the root `setup-*.js` wizards. New work
    belongs in the versioned engine and the desktop app.

## When writing code here

- Read the neighbouring modules first and follow their style; the codebase is consistent.
- Large data sets (multi-GB folders, thousands of chunks) are the normal case — keep
  operations streaming and bounded, and respect the configured concurrency.
- Network calls need retries and clear, human-readable failure messages. Error text is
  read by non-technical customers, so name the fix, not just the fault.
- Add or extend a suite in `test/` with any behaviour change.
- `main` takes no direct pushes; ship through a PR with CI green.
