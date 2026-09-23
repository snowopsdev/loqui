# Loqui verification

Version 0.1.0-beta.1: implementation/local verification in progress; not approved for release. The dated evidence below is a historical record, not a fresh pass of the current checkout. Track remaining public-source and release gates in [PUBLICATION.md](PUBLICATION.md). Earlier personal-fork smoke results do not establish renamed-app or signed-update acceptance.

Required evidence:

- Tests, lint, types, locales, renderer build, hosted Ubuntu 22.04 x64/macOS 26 arm64 packaging, native architecture and packaged SQLite checks.
- Fresh Loqui profile; Whispr Personal data untouched; development data separate.
- Dictation, assistant, notes, meetings, history, search, and offline persistence after model downloads.
- Codex discovery/sign-in, streaming/cancellation, provider-failure content preservation.
- Branding in onboarding/settings, permissions, menus/tray, installers and package metadata; small/light/dark icon review.
- Update disclosure/off switch, stable/beta selection, offline/backoff, interrupted/canceled downloads, integrity failures, active-work/save blocking, no ordinary-quit installation.
- Actual signed beta-to-beta Mac and installed AppImage updates preserve notes/settings/credentials/models.
- Mac Developer ID signatures, notarization, stapling and Gatekeeper acceptance.
- Real microphone, hotkey, paste and meeting-audio checks on both desktop platforms.
- Failed build/signing cannot assemble a complete draft; published retry cannot overwrite artifacts.
- Publication secret/provenance audits, branch protection and private vulnerability reporting.

Publication audit: the inherited history contained 124 Nucleo icons. The approved publication process uses a separate sanitized copy, retaining the original repository. Historical commit IDs differ. Nine exact historical documentation/permission-identifier false positives are reviewed and retained in `.gitleaksignore`.

## Local evidence (2026-09-18)

- Full Node suite after SQLite upgrade: 3,698 passed, 27 skipped (89 native database tests plus 3,609 other passing tests). New updater/identity/source-integrity tests cover cancellation, channel selection, late events, restart blocking, saving failures, and archive content changes.
- Lint: no errors; two existing icon Fast Refresh warnings. Types, locales and renderer build pass. Actionlint validates all workflows. npm audit reports zero known vulnerabilities after updating better-sqlite3 and the adm-zip override.
- Linux development package executes its actual bundled SQLite binding. Isolated desktop smoke passes account-free setup, Codex setup availability, offline persistence/search, and no upstream service/update requests.
- Apple Silicon development DMG/ZIP build, packaged SQLite, and 21 account-free/offline desktop smoke checks pass on a Mac. Ad-hoc signature validation and archive integrity pass. This is not Developer ID/notarization/Gatekeeper validation.
- Working-tree secret scan is clear. Original history scan is clear after nine exact reviewed false-positive fingerprints. Sanitized publication history also scans clean across 1,909 reachable commits; restricted Nucleo/Yowza paths and upstream tags are absent.
- Hosted CI, repository settings, secure Apple credentials, real signed updates, and microphone/hotkey/paste/meeting hardware checks remain pending. GitHub CLI authentication is required for creation/push and repository configuration.

Local toolchains: Linux Node 24.21.0, Electron 41.10.5; Mac build shell Node 24.14.0, Electron 41.10.5, Apple Silicon, macOS SDK 26.5. Hosted CI is configured for Node 24.21.0 on both platforms and has not yet run.

Release assembly dry-run with the actual development installers produced SBOM, notices, metadata and checksums; all SHA-256 checks pass. Missing-platform input is rejected. These unsigned/ad-hoc artifacts are local tests, not publishable signed releases.

## Public-source review (2026-09-23)

The scoped audit of `main` at `8bd2f5c0` reviewed 2,248 reachable commits and 15,717 unique blobs. Its initial zero-finding secret report was incorrectly described as unsuppressed. The final scan at `60d3f46f` with `.gitleaksignore` absent surfaced the same nine reviewed historical false positives; exact fingerprints have been restored. See [PUBLICATION.md](PUBLICATION.md#source-audit-evidence-2026-09-23) for the corrected scope and retained historical binary exception. Repeat scans after changing the intended publication refs.

Documentation now distinguishes planned release targets from released installers, records the actual retention/credential boundaries, and covers development, support, contribution, moderation, and public-source gates. This does not constitute fresh hardware, signing, or hosted-CI validation. Live GitHub access remains unverified.

Local checks of the uncommitted public-preparation changes also pass:

- Repository suite: 3,619 passed, 27 skipped, zero failures. The seven subsequently added GitHub-configuration fixture tests also pass; they verify offline preview, preflight rejection, partial-failure handling, and idempotent tag policies without changing GitHub.
- Lint: zero errors and the two existing icon Fast Refresh warnings. Type checking, locale validation, renderer build, Actionlint, and whitespace checks pass. The renderer retains its existing large-chunk warning.
- Publication hygiene passes. A temporary copy of 1,409 tracked/unignored working-tree files passed Gitleaks with suppressions disabled; the final configuration-helper changes were scanned separately. No private data or full audit reports are committed.
- `npm audit --omit=dev` reports zero known production vulnerabilities. This is a dependency-advisory result, not a comprehensive security assessment.

No remote settings, public push, signing operation, or new hardware acceptance check was performed during this preparation pass.

## Checklist implementation (2026-09-23)

The subsequent readiness pass ran the complete suite on the pinned Node **24.21.0**: **3,644 passed, 27 skipped, zero failures**. Lint, types, locales, renderer compilation, publication hygiene, and Actionlint passed. The existing two icon lint warnings and renderer chunk-size warning remain.

Thirteen repository-configuration fixtures verify protection enforcement and read-only reporting. Twelve release fixtures cover incomplete artifacts, invalid checksums, unreleased versions, and unsafe retries. Assembly with existing development installers and an actual npm SBOM verified 25 assets in isolated staging; the original packages and metadata were unchanged. These checks do not establish signing or hardware acceptance.

Maintainer authentication succeeded and the independent public `snowopsdev/loqui` repository was created. Source publication at `d4ef6c86` preserved sanitized history and published no release tags. GitHub API readbacks passed all repository protection checks, including administrator-enforced branch protection, private reporting, secret protection, immutable releases, and tag-only reviewed release access with administrator bypass disabled. Six signing-secret names remained absent; no signing operation was attempted. Current hosted-CI and release progress is recorded in [PUBLICATION.md](PUBLICATION.md).
