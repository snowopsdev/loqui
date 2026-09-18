# Loqui verification

Version 0.1.0-beta.1: implementation/local verification in progress; not approved for release. Earlier personal-fork smoke results do not establish renamed-app or signed-update acceptance.

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

Publication audit: inherited history contains 124 Nucleo icons; user approved a separate sanitized publication copy, retaining the original repository. Historical commit IDs will differ. Nine initial secret-scan findings were reviewed as YOUR_KEY documentation placeholders or a local permission constant; .gitleaksignore records exact fingerprints only.

## Local evidence (2026-09-18)

- Full Node suite after SQLite upgrade: 3,698 passed, 27 skipped (89 native database tests plus 3,609 other passing tests). New updater/identity/source-integrity tests cover cancellation, channel selection, late events, restart blocking, saving failures, and archive content changes.
- Lint: no errors; two existing icon Fast Refresh warnings. Types, locales and renderer build pass. Actionlint validates all workflows. npm audit reports zero known vulnerabilities after updating better-sqlite3 and the adm-zip override.
- Linux development package executes its actual bundled SQLite binding. Isolated desktop smoke passes account-free setup, Codex setup availability, offline persistence/search, and no upstream service/update requests.
- Apple Silicon development DMG/ZIP build, packaged SQLite, and 21 account-free/offline desktop smoke checks pass on a Mac. Ad-hoc signature validation and archive integrity pass. This is not Developer ID/notarization/Gatekeeper validation.
- Working-tree secret scan is clear. Original history scan is clear after nine exact reviewed false-positive fingerprints. Sanitized publication history also scans clean across 1,909 reachable commits; restricted Nucleo/Yowza paths and upstream tags are absent.
- Hosted CI, repository settings, secure Apple credentials, real signed updates, and microphone/hotkey/paste/meeting hardware checks remain pending. GitHub CLI authentication is required for creation/push and repository configuration.

Local toolchains: Linux Node 24.21.0, Electron 41.10.5; Mac build shell Node 24.14.0, Electron 41.10.5, Apple Silicon, macOS SDK 26.5. Hosted CI is configured for Node 24.21.0 on both platforms and has not yet run.

Release assembly dry-run with the actual development installers produced SBOM, notices, metadata and checksums; all SHA-256 checks pass. Missing-platform input is rejected. These unsigned/ad-hoc artifacts are local tests, not publishable signed releases.
