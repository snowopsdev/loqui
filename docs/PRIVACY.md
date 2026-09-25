# Privacy and network behavior

Loqui is a local-first desktop application. It has no hosted Loqui account, analytics upload, remote backup, or synchronization service. Local processing and remote provider processing are separate choices; choosing a local model does not make every optional feature offline.

## Content and retention

Notes, folders, conversations, meetings, dictionary entries, snippets, and transcription history are stored in the local workspace. Audio and downloaded models also use local files.

On a fresh profile:

- Local transcription history is enabled.
- Transcripts have no automatic expiry (`transcriptRetentionDays = 0`).
- Retained dictation audio expires after 30 days.
- Discarded transcriptions are not saved by default.

Change retention in **Privacy & Data**, or turn off local history during onboarding. Retention controls are not a blanket deletion policy for notes, conversations, meetings, exports, or backups. Changing a preference should not be treated as proof that all previously stored content has been erased. The onboarding trial suppresses automatic history/audio retention and automatic paste.

The SQLite database, recordings, and exports are not encrypted by Loqui. Protect the computer, OS account, and backups accordingly. Logs, screenshots, exports, and diagnostics may contain private content; review and redact them before sharing in a public issue.

## Storage and credentials

Product identity is defined in [`src/config/product.json`](../src/config/product.json).

| Data                                    | Default location or service                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Packaged workspace                      | Platform application-data directory plus `io.github.snowopsdev.loqui`                          |
| Development workspace                   | Platform application-data directory plus `io.github.snowopsdev.loqui-development`              |
| Packaged provider credential service    | `io.github.snowopsdev.loqui`                                                                   |
| Development provider credential service | `io.github.snowopsdev.loqui-development`                                                       |
| Model cache                             | `~/.cache/loqui-snowopsdev`, or the corresponding absolute `XDG_CACHE_HOME` directory on Linux |
| Development model cache                 | Same location rule with `loqui-snowopsdev-development`                                         |
| Codex state                             | `codex/` and `codex-workspace/` within the Loqui profile                                       |

Provider credentials saved by the application use the main-process credential store. It uses AES-256-GCM with a key stored in the OS credential service, or Electron's `safeStorage` fallback when necessary. Protection depends on the OS and the available credential backend. Environment variables and manually created configuration files are not made private merely by launching Loqui.

Codex authentication is separate from provider API keys. Loqui starts `codex app-server` with its own profile and file-based Codex credential storage; it does not copy an existing CLI session. Treat the entire Codex profile as sensitive.

`LOQUI_CACHE_ROOT` explicitly selects another model-cache location. Unpackaged development/test runs can use `LOQUI_PROFILE_DIR` to select a separate profile. These overrides do not migrate another application's data. Beta and stable Loqui releases share the production profile. Loqui does not import, move, or delete OpenWhispr or Whispr Personal data.

Uninstalling the application may leave its profile, model cache, and OS credential entries. Review what you need to retain before deleting any of them; local deletion does not remove independent backups or copies already sent to a provider.

## When network requests occur

| Feature                             | Destination and data                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Selected model download             | The model's configured source and redirects, usually Hugging Face or GitHub; no recording is needed to download a model                                                                                                                                                                    |
| Remote speech recognition           | The selected provider receives audio and request settings                                                                                                                                                                                                                                  |
| Remote text generation or cleanup   | The selected provider receives the task input and context supplied to that feature                                                                                                                                                                                                         |
| Codex CLI verification              | GitHub’s `openai/codex` release API and asset CDN receive the CLI version and platform in release paths; no task content or credentials are sent. Verified binary digests are kept in memory for the current app session; first verification after restarting Loqui requires GitHub again. |
| ChatGPT through Codex               | Codex's managed sign-in and inference services receive authentication and selected task content                                                                                                                                                                                            |
| Provider connection/model checks    | The selected provider receives credentials and a model-list request or connection-test input                                                                                                                                                                                               |
| Automatic/manual update checks      | GitHub and its asset CDN for `snowopsdev/loqui` releases                                                                                                                                                                                                                                   |
| URL imports                         | The requested website and any redirects/media sources needed to retrieve it                                                                                                                                                                                                                |
| Provider-native web search          | The selected search-capable provider receives the query and relevant task context                                                                                                                                                                                                          |
| Optional Google/Microsoft calendars | Provider authentication and calendar APIs; calendar/account data is stored locally                                                                                                                                                                                                         |

Provider terms, retention, availability, billing, and account limits apply to remote requests. Loqui does not silently switch local processing to a remote provider. Cleanup failure preserves the raw transcript.

Local inference stays on this computer. Download selected models before going offline. Bundled runtimes and support models are obtained during development/release preparation; their pinned sources and licenses are recorded in [`runtime-assets.json`](../runtime-assets.json).

## Updates and calendars

Automatic update checks and downloads are enabled by default after onboarding. Checks run when due at startup and approximately daily; failures use bounded retry delays. Disable automatic updates in **System** settings. No GitHub credential is embedded in the application. Installation requires **Restart to Update** and is blocked while relevant work or saving is active.

Optional Google and Microsoft connections require independently configured OAuth applications. OAuth completion uses a local loopback page; it does not redirect through OpenWhispr. Apple Calendar uses local OS permissions. Connecting a calendar can schedule background synchronization while the connection remains configured; disconnect it to stop that integration.

The [network inventory](network-allowlist.md) explains why these destinations are not a single fixed firewall allowlist. The [security policy](../SECURITY.md) covers private reporting.
