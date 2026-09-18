<p align="center"><img src="src/assets/brand/social.png" alt="Loqui — Your voice. Your models. Your words." width="900"></p>

# Loqui

Local-first dictation, assistant conversations, notes, meetings, transcription history, and search. Choose local models, your own provider API keys, or your ChatGPT subscription through Codex for text tasks. Speech recognition and text processing have independent selections.

Loqui is an independent fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr), based on `6d56d75e7e13ec47009e573e9ff4cded0d0ccc61`. Upstream MIT attribution is retained. Loqui has no OpenWhispr account, billing, team service, sharing, cloud backup, synchronization, or telemetry upload.

## Install

The first release is **0.1.0-beta.1**. Download reviewed releases from [snowopsdev/loqui](https://github.com/snowopsdev/loqui/releases). Draft builds are not public releases.

- **Apple Silicon macOS 14.2 or newer:** open the signed, notarized DMG and drag Loqui into Applications. Grant microphone and Accessibility permissions when prompted. Meeting capture may require system-audio permission.
- **Linux x86_64:** make the AppImage executable and launch it. The tar.gz is a portable alternative. Automatic paste depends on your desktop session and tools such as ydotool, wtype, xdotool, wl-clipboard, or xclip. See [troubleshooting](TROUBLESHOOTING.md).

Windows and Intel Mac releases are not supported in this release series. Linux hardware and desktop compatibility varies; a GUI session is required.

## Choose your models

Setup offers local English Parakeet speech recognition and optional Qwen3.5 2B quantized text cleanup. Models download only when selected. Whisper and multilingual speech alternatives remain available; compatible GGUF text models can be imported and load-tested in the app. Local diarization and embeddings support meetings and search. Local workflows can operate offline after their models are ready.

For remote providers, save your own API key and select a model independently for each text task. Keys are encrypted in the main process. A failed request never silently changes to another provider. Failed cleanup keeps the original transcript.

For **ChatGPT subscription access**, install **Codex CLI 0.154.x or 0.155.x**, choose **Codex (ChatGPT)** during setup or in Language Models, connect ChatGPT, then choose a discovered model. Codex uses official managed sign-in through `codex app-server`. Its separate Loqui profile does not copy existing Codex login files. Codex supports cleanup, translation, chat, note formatting, and meeting summaries; speech and embeddings use their own providers. Dynamic-tool compatibility is covered by protocol fixtures; wider CLI versions require validation before support is expanded.

## Updates and privacy

After onboarding, automatic update checks and downloads are enabled by default. Turn them off in System settings. You choose when to restart; Loqui blocks update installation during active work and saves pending edits first. AppImage and signed Mac installations support in-app installation; tarball users receive a download link. Stable installations exclude betas unless selected, and automatic downgrades are disabled.

Loqui uses a fresh `io.github.snowopsdev.loqui` application profile and credential service. Development uses a separate profile; beta and stable share the production profile. Model caches use `loqui-snowopsdev`. Loqui never imports, moves, or deletes Whispr Personal data. See [privacy and network behavior](docs/PRIVACY.md).

## Build and contribute

Use the exact Node version in `.node-version` and the committed lockfile:

```sh
npm ci --ignore-scripts
node scripts/install-platform-deps.cjs
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run prepare:platform
npm run native:electron
npm run build:renderer
npm run pack
```

Build on the target architecture. `npm run build:linux` creates AppImage and tar.gz; `npm run build:mac` creates development DMG and ZIP on Apple Silicon. Development Mac packages are ad-hoc signed. Public releases require the protected signing workflow.

For development after platform preparation, run `npm run dev`. Node tests and Electron require separate SQLite rebuilds; do not share their native bindings. `npm run assets:generate` regenerates icons from the SVG masters. See [contributing](.github/CONTRIBUTING.md), [release procedures](docs/RELEASING.md), [security](SECURITY.md), and [verification status](docs/VERIFICATION.md).

## Attribution

Application source and original Loqui artwork are MIT licensed. Dependencies and model weights retain their own licenses; see [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md), and [runtime asset manifest](runtime-assets.json). Loqui is not affiliated with OpenWhispr or OpenAI.
