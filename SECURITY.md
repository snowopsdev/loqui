# Security policy

## Supported versions

Loqui is preparing its first beta series. Security fixes target the latest `0.1.0-beta` code and subsequent supported releases; older development builds have no backport commitment. Keep Loqui and its supported Codex CLI version current. Published installers and their validation status are listed in [Releases](https://github.com/snowopsdev/loqui/releases), when available.

## Reporting a vulnerability

Use GitHub's [private vulnerability report](https://github.com/snowopsdev/loqui/security/advisories/new) when that feature is enabled. If it is unavailable, open an issue requesting a private security contact **without disclosing the vulnerability or exploit details**. Do not post a proof of concept publicly before maintainers have a chance to assess it.

Include the affected version/commit and platform, minimal reproduction, expected and actual behavior, likely impact, and whether the attack requires local access, a selected provider, or remote input. Use synthetic data. Never attach provider keys, Codex session files, personal databases, recordings, signing certificates, or access tokens.

Maintainers will assess reports and coordinate remediation on a best-effort basis. There is no guaranteed response time or bug-bounty program.

## Security boundaries

Loqui runs desktop software and local model runtimes with the user's permissions. Its database and recordings are not application-encrypted. Stored provider keys use the OS-backed credential/encryption facilities described in [privacy documentation](docs/PRIVACY.md); Codex manages separate authentication files in its isolated profile. Local malware or a compromised user account is outside the protection these facilities provide.

Remote providers receive the inputs required for the selected task. Custom endpoints, imported models, URL imports, and optional calendar integrations expand the inputs and services the application uses. Report unexpected provider calls, credential exposure, or content loss as potential security issues.

Release credentials belong only in the protected GitHub `release` environment. Fork pull requests must run without them. Published versions are immutable; corrections require a new version. Repository security settings and signed-release validation are tracked in the [publication checklist](docs/PUBLICATION.md).
