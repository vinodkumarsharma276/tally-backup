# Releasing Backup Genie

Releases are built and published automatically by GitHub Actions
([.github/workflows/release.yml](.github/workflows/release.yml)) when you push a
version tag. This builds **Windows + Linux** installers and attaches them to a
single GitHub Release.

## Cut a release

`main` accepts no direct pushes, so the version bump goes through a pull request.

### Option A — Actions (recommended)

**Actions → Release → Run workflow**, enter the version (e.g. `0.1.2`). CI runs the
test suites, bumps `package.json`, pushes the commit to `main` over SSH using the
`RELEASE_SSH_KEY` deploy key, tags it and builds the installers.

### Option B — by hand

```powershell
# 1. Bump the version on a branch (must be higher than the last release)
git switch -c release/0.1.2
npm version 0.1.2 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: 0.1.2"
git push -u origin HEAD

# 2. Merge it (CI must pass)
gh pr create --fill
gh pr merge --squash --delete-branch --auto

# 3. Tag the merged commit to trigger the build
git switch main; git pull
git tag v0.1.2
git push origin v0.1.2
```

Watch progress under the repo's **Actions** tab. When it finishes, the release
appears under **Releases** with:

- `Backup-Genie-Setup-<version>.exe` + `latest.yml` (Windows)
- `Backup-Genie-<version>.AppImage` + `Backup-Genie-<version>.deb` + `latest-linux.yml` (Linux)
- `.blockmap` files (for smaller delta updates)

## Rules

- **Version only goes up.** Auto-update ignores equal/lower versions.
- The **tag must match** the package.json version, prefixed with `v` (e.g. `v0.1.2`).
- The repo must be **Public** for anonymous download + auto-update to work.
- `1.0.0` is reserved for the first public/stable launch.

## Installing (for testers / customers)

- **Windows** → run `Backup-Genie-Setup-<version>.exe`. Unsigned builds show a
  SmartScreen warning: **More info → Run anyway** (until a code-signing cert is added).
- **Linux** → run the `.AppImage` (mark executable), or `sudo apt install ./Backup-Genie-<version>.deb`.

## Repo secrets (Settings → Secrets and variables → Actions)

- `RELEASE_SSH_KEY` — **required for Option A.** Private half of the repo's
  write-enabled deploy key ("Release automation"). `main` grants ruleset bypass to
  deploy keys only, so this is what lets the workflow push the version bump. No
  human, including an admin, can push to `main`. To rotate: delete the deploy key
  under Settings → Deploy keys, generate a new `ed25519` pair, add the public half
  with write access, and replace this secret with the private half.
- `GOOGLE_OAUTH_CLIENT` — contents of `config/google-oauth-client.json`, so shipped
  builds can "Connect Google" (the file is git-ignored, so CI injects it).
- `CSC_LINK` + `CSC_KEY_PASSWORD` — Windows code-signing certificate, to remove the
  SmartScreen warning.

## Local build (no publish)

```powershell
npm run build:desktop      # Windows installer into releases/desktop/
npm run build:desktop:dir  # unpacked app (faster, no installer)
```

The laptop publish path (`npm run publish:desktop`) still exists and is guarded to
the `main` branch, but the tag-push CI flow above is the recommended way to release.