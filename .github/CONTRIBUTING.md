# Contributing to Loqui

Open issues and pull requests at https://github.com/snowopsdev/loqui. Keep changes focused on local-first personal workflows, Linux x86_64, and Apple Silicon macOS. Preserve existing content on provider failures and avoid silent local-to-remote fallback.

Follow the development commands in README.md. Before submitting, run tests, lint, type checking, locale validation, and the renderer build. Native or packaging changes also need platform checks. Do not commit credentials, recordings, personal databases, downloaded models, generated installers, or copyrighted third-party artwork without redistribution rights.

New UI icons use the existing Lucide adapter. Edit branding SVG masters and regenerate exports with `npm run assets:generate`. Document new network destinations and dependency licenses. Report vulnerabilities privately as described in SECURITY.md.

Release PRs update package.json, package-lock.json, and CHANGELOG.md together. Public releases are reviewed drafts, never automatic publications.
