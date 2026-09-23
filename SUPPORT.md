# Getting help with Loqui

Loqui is an early open-source project maintained on a best-effort basis. There is no guaranteed support response time. Linux x86_64 and Apple Silicon macOS are the release targets; Windows and Intel Mac packages are not currently supported.

For setup, build, or provider problems, first read the [README](README.md), [troubleshooting guide](TROUBLESHOOTING.md), and [development guide](docs/DEVELOPMENT.md). Check [existing issues](https://github.com/snowopsdev/loqui/issues) before opening a new question or bug report.

A useful report includes:

- Loqui version or commit, OS version, architecture, and installation type.
- What you expected, what happened, and minimal steps to reproduce it.
- Whether the problem occurs with local models, a named remote provider, or Codex; include the model/CLI version, never credentials.
- For Linux desktop integration, the desktop environment and X11/Wayland session.
- A screenshot or short log excerpt with private content removed.

Use sample dictation and notes when reproducing a bug. Do not upload full profiles, personal databases, recordings, provider keys, calendar tokens, Codex login files, signing certificates, or unreviewed diagnostic archives. Review screenshots for account names and private text.

Report possible vulnerabilities using [SECURITY.md](SECURITY.md) instead of a public issue. Provider billing, subscription entitlements, and third-party account access are handled by the provider; Loqui cannot grant access or change those limits.
