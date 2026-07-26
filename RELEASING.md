# Releasing Backup Genie

Releases are built and published automatically by GitHub Actions
([.github/workflows/release.yml](.github/workflows/release.yml)) when you push a
version tag. This builds **Windows + Linux** installers and attaches them to a
single GitHub Release.

## Cut a release

```powershell
# 1. Bump the version in package.json (must be higher than the last release)
#    e.g. 0.1.1 -> 0.1.2
# 2. Commit the bump
git add package.json
git commit -m "release: 0.1.2"

# 3. Push main, then push a matching tag (this triggers the build)
git push origin main
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

## Optional repo secrets (Settings → Secrets and variables → Actions)

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
