# Contributing to Loqui

Loqui welcomes bug reports, documentation improvements, accessibility fixes, and focused pull requests. Its scope is a local-first personal voice workspace for Linux x86_64 and Apple Silicon macOS. Read the [code of conduct](../CODE_OF_CONDUCT.md) and use the [support guide](../SUPPORT.md) for questions and bug reports. Report vulnerabilities through the [security policy](../SECURITY.md), not public bug reports.

## Before a change

Check existing issues and pull requests at [snowopsdev/loqui](https://github.com/snowopsdev/loqui). Describe larger changes in an issue before investing in implementation so scope and compatibility can be discussed. Documentation, small fixes, and reproducible bug reports do not need advance approval.

Keep the following behavior intact:

- Speech and text providers are independent choices. Never silently send local work to a remote or separately billed service.
- Preserve user content when inference, authentication, permissions, or downloads fail.
- Treat the local personal workspace as authoritative; no hosted account or service should be necessary for local use.
- Keep provider execution and credential handling behind the existing main-process interfaces. Do not expose secrets through renderer APIs or logs.
- Make microphone, permission, model download, and remote-provider actions explicit to the user.

## Develop and verify

Follow [development and packaging](../docs/DEVELOPMENT.md) for Node, native dependencies, browser preview, and Electron setup. The [onboarding preview guide](../docs/ONBOARDING_PREVIEW.md) covers simulated states without credentials or downloads.

Before submitting code, run tests, lint, type checking, locale validation, the renderer build, and `npm run publication:check` for tracked-file hygiene. Rebuild SQLite for Node before tests and for Electron before desktop testing. Native or packaging changes also need the relevant platform checks. Record hardware testing separately from browser and automated tests, including checks you could not perform.

Use existing components, accessibility labels, keyboard interactions, design tokens, and the Lucide icon adapter. Keep translatable text in the existing locale system. Update documentation for new settings, network destinations, storage behavior, or platform requirements.

## Pull requests

Keep each pull request focused. Explain the user-facing problem, the resulting behavior, and how it was verified. Include before/after screenshots for visual changes using sample data. Add meaningful regression tests for changed behavior and document unresolved limitations. Do not mark a hardware or signing check as passed based only on a browser simulation or an ad-hoc build.

Follow the project's formatting rules. Retain the lockfile when changing dependencies. Do not commit credentials, session files, recordings, private databases, model weights, installers, local logs, or personal test artifacts. Only include assets with redistribution rights and preserve license/provenance notices.

Contributions are provided under the repository's [MIT license](../LICENSE). Third-party dependencies and assets keep their own licenses. Do not remove upstream attribution or add artwork copied from paid libraries.

## Releases

Release PRs update `package.json`, `package-lock.json`, and `CHANGELOG.md` together. Only reviewed Loqui tags produce release drafts; maintainers publish them after validation. See the [release procedure](../docs/RELEASING.md) and [verification record](../docs/VERIFICATION.md). Do not publish upstream release tags or place signing material in a pull request.
