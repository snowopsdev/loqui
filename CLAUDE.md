# Loqui architecture notes

Electron main owns SQLite, credentials, native runtimes, provider requests, and updates. React/TypeScript renderers communicate through typed preload IPC. Keep local and remote provider choices explicit and preserve content on failures.

Read README.md for development commands, docs/PRIVACY.md for network/storage behavior, and docs/RELEASING.md for release procedures. Run tests with Node SQLite, then rebuild for Electron before packaging. Never use personal profiles in tests.
