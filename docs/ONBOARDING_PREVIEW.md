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

Supported steps are `welcome` (Hello), `speech` (Voice), `try` (Say something), `cleanup`, `shortcuts`, and `finish` (Ready). Supported scenarios are `fresh`, `ready`, `downloading`, `download-interrupted`, `microphone-denied`, `codex-missing`, `codex-expired`, `invalid-provider-key`, `cleanup-failed`, `insufficient-memory`, `accessibility-missing`, `nothing-heard`, `low-disk`, and `multilingual`. Platforms are `macos` and `linux`. Unknown values fall back to the welcome, fresh, macOS defaults.

| Scenario                                                 | Bridge behaviour                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `fresh`                                                  | Default voice not installed. Download advances 7% every 400 ms.                               |
| `ready`                                                  | Default voice installed; other catalog voices retain their own status.                        |
| `downloading`                                            | Default voice download rehydrates from 35%.                                                   |
| `download-interrupted`                                   | First attempt fails at 42% with `ECONNRESET`, retaining the 35% written. Retry resumes there. |
| `microphone-denied`                                      | Current correlated take emits `NotAllowedError` before any listening.                         |
| `nothing-heard`                                          | Levels stay at 0.003; stopping emits `NO_AUDIO`.                                              |
| `insufficient-memory`                                    | Reports 4 GiB memory; stopping emits `INSUFFICIENT_MEMORY`.                                   |
| `cleanup-failed`                                         | Returns “um remind me to send the draft before lunch” with `cleanup: "failed"`.               |
| `accessibility-missing`                                  | On macOS, Accessibility is not granted; shortcut presses never arrive.                        |
| `low-disk`                                               | Reports 412 MB free disk.                                                                     |
| `multilingual`                                           | Reports locales `["es-ES", "en-US"]`.                                                         |
| `codex-missing`, `codex-expired`, `invalid-provider-key` | Existing `personalInference` sample behaviour stays unchanged; no real requests.              |

Hold **Hold shortcut** in the toolbar to press the dictation shortcut. Tap mode toggles recording on press; set `activationMode` to `push` in storage to hold-to-talk.

Downloads use each known catalog model’s byte size and a monotonic event sequence across attempts. Concurrent calls receive `DOWNLOAD_IN_PROGRESS`; they never replace the active transfer. Cancel/reset settle pending work once and discard that transfer’s bytes; only network interruption retains bytes for Retry. Trial events carry the original `demoId` and string `takeId`, including delayed levels/results and cancellation. Cancel is discarded with no Undo until the shared Plan 04 ownership/hold contract is integrated in Task 22. These metadata are separate from future recording `sessionId` and workspace lifecycle events.

At this checkpoint the legacy Speech preview still renders its own simulated presentation; Task 13 replaces that branch with the shared bridge consumer. The bridge is independently exercised through the actual download hooks now.

Preview progress is stored under `loqui.onboarding.preview.*` browser-storage keys. The toolbar’s restart control clears only that preview namespace and does not touch the desktop profile.

For welcome-screen design review, open `?preview=welcome-designs&design=1`, `design=2`, or `design=3`. Design 02 renders the same welcome component used by the desktop app; the other two remain preview-only concepts. The toolbar can switch designs and themes without changing desktop settings.

For the remaining five steps, open `?preview=onboarding-designs&design=1&step=speech&scenario=fresh&platform=macos`. The toolbar compares three coherent directions across Speech, Cleanup, Try dictation, Use anywhere, and Ready. Direction 01 is now used by the real onboarding flow alongside the selected Welcome screen; 02 emphasizes practice and concrete examples; 03 is a compact setup sheet. Controls and readiness outcomes on the concept pages remain simulated. Use `?preview=onboarding&step=speech` to review Direction 01 with the real onboarding components and browser-simulated services.
