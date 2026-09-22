# Onboarding browser preview

The development renderer includes a browser-only preview of the Loqui setup flow. It uses an in-memory Electron bridge, sample workspace data, and simulated setup states. It never requests credentials, calls a provider, downloads a model, or reads desktop data.

Start the renderer with `npm run dev:renderer`, then open:

```text
http://127.0.0.1:5183/?preview=onboarding
```

The preview toolbar can restart setup, jump to any step, choose a scenario, and switch the simulated platform. Links can also select those values directly:

```text
http://127.0.0.1:5183/?preview=onboarding&step=cleanup&scenario=codex-missing&platform=macos
```

Supported steps are `welcome`, `speech`, `cleanup`, `try`, `shortcuts`, and `finish`. Supported scenarios are `fresh`, `ready`, `downloading`, `download-interrupted`, `microphone-denied`, `codex-missing`, `codex-expired`, `invalid-provider-key`, `cleanup-failed`, and `insufficient-memory`. Platforms are `macos` and `linux`. Unknown values fall back to the welcome, fresh, macOS defaults.

Preview progress is stored under `loqui.onboarding.preview.*` browser-storage keys. The toolbar’s restart control clears only that preview namespace and does not touch the desktop profile.
