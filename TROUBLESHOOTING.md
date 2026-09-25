# Troubleshooting

- Codex: install supported CLI 0.154.x, 0.155.x, or 0.156.x and Refresh the provider panel. Common user-local/Homebrew paths are searched. ChatGPT sign-in is separate from API keys.
- Mac capture/paste: check Loqui microphone, Accessibility and system-audio permissions in System Settings, then restart.
- Linux paste: verify your desktop's ydotool/wtype/xdotool and clipboard utilities. Wayland may need ydotoold/uinput configuration. Do not run Loqui as root.
- Models: download/select a model or import a compatible GGUF; verify readiness before going offline. Cleanup failures retain the original transcript.
- SQLite ABI: `npm run native:node` before tests; `npm run native:electron` before Electron.
- Update restart: finish recording, meetings, processing and downloads; pending edits must save. Do not delete data to repair an update.
- Tarball updates: use the Releases link. AppImage and signed Mac installs support automatic installation.

See [the support guide](SUPPORT.md) for what to include in a public bug report and how to redact private information.
