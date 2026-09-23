# Releasing Loqui

Release targets: Linux x86_64 and Apple Silicon macOS. Repository: `snowopsdev/loqui`. First planned version: `0.1.0-beta.1`. Never push upstream release tags. This is the release procedure, not a statement that a signed release already exists. See the [publication checklist](PUBLICATION.md) and [verification record](VERIFICATION.md) for pending gates.

## Repository setup

Publish only after the audit passes. Keep the original repository and upstream remote. The sanitized publication copy removes restricted assets from historical commits while retaining authorship and MIT attribution. Historical IDs change; retain its commit map locally. Push `main` and explicitly named Loqui tags, never `--mirror` or `--tags`.

After authenticating GitHub CLI and pushing the sanitized main branch, run `node scripts/configure-github.cjs` to review the proposed settings, then `node scripts/configure-github.cjs --apply` to apply them, including immutable releases. Verify its results in GitHub; a local configuration file does not establish that remote protections are enabled.

Run `node scripts/configure-github.cjs --check` for read-only verification. It checks protection settings and signing-secret names without reading their values. Missing signing secrets leave releases pending even when source protections pass. In GitHub's **Settings → Environments → release**, disable **Allow administrators to bypass configured protection rules**. The REST write schema does not expose that setting, so the setup command requires a confirmed readback rather than assuming it was applied.

Protect main, including administrators: require the **CI** status, pull requests, and resolved conversations; disallow force pushes/deletion. Enable dependency alerts, secret scanning/push protection where available, and private vulnerability reporting. Restrict the **release** environment to `v*` tags only and require a reviewer. The setup command removes other environment branch/tag policies. Never use a personal computer as a public self-hosted runner.

## Secure Apple configuration

Add these secrets in GitHub Settings → Environments → **release**:

| Secret                     | Value                                                         |
| -------------------------- | ------------------------------------------------------------- |
| `MAC_CERTIFICATE_BASE64`   | Base64 of Developer ID Application .p12 including private key |
| `MAC_CERTIFICATE_PASSWORD` | .p12 password                                                 |
| `MAC_SIGNING_IDENTITY`     | Exact `Developer ID Application: … (TEAMID)` identity         |
| `APPLE_API_KEY_BASE64`     | Base64 of App Store Connect notarization .p8 API key          |
| `APPLE_API_KEY_ID`         | API key ID                                                    |
| `APPLE_API_ISSUER`         | API issuer ID                                                 |

Use GitHub's secure secret entry or `gh secret set --env release` with file/stdin input. Never paste secrets into chat, issues, source, command arguments, or logs. Signing uses a temporary keychain removed at job completion. Missing credentials fail the job.

## Version and reviewed draft

1. Release PR: update package.json, package-lock.json, and CHANGELOG.md together, removing the changelog’s unreleased marker only when acceptance is complete. Run checks and review acceptance evidence.
2. Merge to main, create the matching version tag on that commit, and push that tag explicitly.
3. Release CI verifies version agreement, main ancestry, and repository. Both platforms build without signing credentials. A protected Mac job signs, notarizes, staples, packages, and verifies the app.
4. Only after both platforms and signing pass, a protected job assembles installers, update metadata/blockmaps, SHA256SUMS, notices, CycloneDX SBOM, runtime manifest, and GitHub build provenance into one draft.
5. Review artifacts and test signed beta-to-beta Mac and installed AppImage updates with content preservation. Manually publish the draft. Publication does not rebuild it.

Published versions are immutable. Corrections get new versions. Workflow dispatch retries an existing tag (use `gh workflow run release.yml --repo snowopsdev/loqui --ref v0.1.0-beta.1 -f tag=v0.1.0-beta.1`) and rejects published releases; only unpublished draft artifacts can be replaced. Specify the repository explicitly because a checkout retaining an `upstream` remote can otherwise direct GitHub CLI commands there. Beta tags are prereleases with separate beta metadata. Never manually publish an incomplete draft.

## Build stages

`npm ci --ignore-scripts` precedes explicit Electron/runtime setup. Node SQLite tests run before rebuilding the binding for Electron. Helper compilation, pinned runtime preparation, renderer build, and packaging are separate stages. Routine quality CI downloads no speech/text models; platform jobs obtain runtime support models.

Caches hold npm downloads, verified archives, Electron/build-tool downloads, and native outputs keyed by source/toolchain. Never share node_modules or native SQLite binaries across runtimes/platforms. Downloaded archives are hashed before use. Refresh runtime-assets.json deliberately on runtime upgrades.

See [VERIFICATION.md](VERIFICATION.md) for hardware and signed-update acceptance evidence. Hosted CI alone cannot establish microphone, hotkey, paste, or meeting-capture behavior.

Gitiles regenerates WebRTC tar timestamps. That one manifest entry uses `hashKind: tar-contents-v1`: SHA-256 authenticates sorted paths, entry types, modes, links, and every file's bytes before extraction. Other archives are verified byte-for-byte. Archive metadata changes cannot bypass content verification.
