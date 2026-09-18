# Privacy and network behavior

Notes, folders, conversations, meetings, dictionary, snippets, and transcription history live in the local SQLite database. There is no hosted Loqui backend, account, analytics upload, remote backup, or synchronization.

Local model inference stays on this computer. Downloading a selected model contacts its listed source, usually Hugging Face or GitHub. Bundled runtimes and small support models are obtained during the build from the exact sources and hashes in `runtime-assets.json`.

Remote speech and text providers receive the inputs necessary for the task you select. Provider API keys stay in the main process's encrypted credential store; renderers use credential references. Codex subscription requests use the official Codex app-server and managed ChatGPT sign-in. Provider terms, availability, and account limits apply. Loqui does not automatically fall back to a remote provider.

After setup, automatic update checks/downloads contact GitHub for `snowopsdev/loqui` releases and GitHub's artifact CDN. Disable automatic updates in System settings to stop these checks. Offline failures do not interrupt local workflows. No GitHub credential is embedded in the app.

Optional URL imports contact the selected website; provider-native search contacts the selected provider. Optional Google/Microsoft calendar connections require independently configured OAuth applications and a loopback completion page. Apple Calendar uses local OS permissions. Loqui does not proxy requests through OpenWhispr.

Production profile: the platform application-data directory plus `io.github.snowopsdev.loqui`. Development adds `-development`. Credential service: `io.github.snowopsdev.loqui`. Model cache: the OS/user cache location plus `loqui-snowopsdev`. `LOQUI_CACHE_ROOT` can explicitly select another model-cache directory; unpackaged tests can use `LOQUI_PROFILE_DIR`. These settings do not migrate another app's data.

Logs, exports, and screenshots can contain private content. Review and redact them before attaching to a public issue. Deleting an app does not necessarily delete its profile or system credential entries.
