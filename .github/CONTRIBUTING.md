# Contributing to Loqui

Open issues and pull requests at https://github.com/snowopsdev/loqui. Keep changes focused on local-first personal workflows, Linux x86_64, and Apple Silicon macOS. Preserve existing content on provider failures and avoid silent local-to-remote fallback.

Follow the development commands in README.md. Before submitting, run tests, lint, type checking, locale validation, and the renderer build. Native or packaging changes also need platform checks. Do not commit credentials, recordings, personal databases, downloaded models, generated installers, or copyrighted third-party artwork without redistribution rights.

## Browser UI preview

After installing dependencies, run `npm run dev:renderer` and open `http://127.0.0.1:5183/`. Without Electron, the development server opens the main workspace with sample notes and history. Use **Show setup** to review onboarding and the theme button to compare appearances. Sample note edits are kept in memory until reload; browser settings use that browser's storage and do not affect a desktop profile.

For a preview on another computer over a trusted network, run `npm run dev:renderer -- --host 0.0.0.0` and open `http://<development-host-address>:5183/` on the client. The server must stay running. `127.0.0.1` on the client refers to the client itself unless you configure port forwarding. Keep the development server off the public internet.

This preview is for UI review: recording, system permissions, Codex sign-in, provider requests, model downloads, updates, and filesystem operations require Electron. It does not connect a browser to the host's desktop APIs, data, or credentials. The browser adapter is excluded from production builds and never replaces an existing Electron preload bridge. Use `npm run dev` for desktop functionality.

New UI icons use the existing Lucide adapter. Edit branding SVG masters and regenerate exports with `npm run assets:generate`. Document new network destinations and dependency licenses. Report vulnerabilities privately as described in SECURITY.md.

Release PRs update package.json, package-lock.json, and CHANGELOG.md together. Public releases are reviewed drafts, never automatic publications.
