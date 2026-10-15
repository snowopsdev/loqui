# Loqui UI/UX Plan 04 — Voice Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every voice moment legible, recoverable and honest about where data goes. This plan delivers:
- one notice system;
- words-first error recovery;
- undoable cancel that keeps D3;
- the Condensation pill with locality;
- the Agent violet orbit;
- the soft sound family;
- the notch-drop meeting prompt;
- the meeting recorder as a pill state.

**Architecture:**
- **Pure modules hold the logic:**
  - `notices.ts` is the notice store.
  - `hotkeyLeases.js` owns temporary global shortcuts in main.
  - `dictationSession.js` pins each recording's route.
  - `dictationDisclosure.js` decides who demonstrably received data.
  - `cancelBuffer.js` holds a cancelled recording in RAM and zeroes it.
  - `voicePillPresentation.js` gains the stage, footprint and ownership model.
  - `condensation.ts` handles word commits and the cleanup diff.
  - `meetingPresence.js` and `linuxRecordingNotification.js` hold the main-process meeting state.
- **React renders the result.** `VoicePill`, `NoticeStack`, `WordsFirstCard`, `CondensationWords`, `AgentOrbit` and `MeetingCapsule` draw what the pure modules decide.
- **Audio stays in the AudioManager; windows and the system stay in main.** `AudioManager` keeps owning audio, so the session snapshot and the cancel buffer live there. Electron main owns the overlay windows, the tray, global shortcuts, native notifications and the quit sequence, and is touched only for those.

**Tech Stack:** React 19, Tailwind CSS 4, TypeScript and JS (ESM), Zustand settings store, Electron 44 main process, `@homebridge/dbus-native` (already a dependency), Web Audio. Tests run on Node `node:test` with `tsx`, `react-dom/server` (`test/helpers/harness/reactSsr.js`), and the Vite SSR renderer harness (`test/lib/rendererTestHarness.js`, `test/helpers/harness/audioManager.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`. It covers D1, D2, D3, D4, D9 and D10, the Plan 04 row in §3, §4, and contracts §5.1–§5.4.
- Visual reference: `design-explorations/loqui-uiux-review.html#ch-voice`. Source: `design-explorations/loqui-uiux-review/parts/03-voice.html` (sibling worktree `t3-5038e8e6`). The picked variant cards are R1 C (lines 207–217), R6 B (412–422), R8 B (502–512), R10 A (859–868), R11 B (667–677), R12 A (708–718) and R14 B (810–820).
- Audit: `.omc/research/ui-review/audit-voice.md` in the same sibling worktree.
- Independent review this revision answers: `.omc/research/ui-review/reviews/plan-04-codex.md` (sibling worktree).

---

## Review response

This revision answers the independent review (`plan-04-codex.md`: 2 Critical, 14 Important, 3 Minor; the report body lists M1–M3). Every finding is closed in a named task. None is disputed. Two findings received a different fix from the one the report suggested, and the reasons are given in the table.

| Finding | Status | Where | How |
|---|---|---|---|
| **C1** cancel path writes audio to disk with retention off | Closed | Task 8 | The cancel buffer holds the **raw** segments, or PCM frames plus fallback segments, as owned RAM copies. No FFmpeg merge runs while it is held. The only cancel-time merge is in `_closeCancelled`, behind `shouldSaveDiscardedRecording`, which is the retention gate. A test with two segments and retention off rejects any merge or save. Task 20 Step 3 checks the temp directory on a real recording. A merge or local-engine temp file **already in flight** when Esc lands predates the cancel, and is removed when that step ends. PRIVACY.md and Task 20 say so. |
| **C2** Undo can use a different route | Closed | Tasks 6, 8 | Each recording captures a frozen, credential-free `DictationSession` at start (route, model, endpoint, prompts, and the Agent and translation intents). Every routing read in the pipeline goes through `this.settings()`, which pins the snapshot, and a source guard test enforces this. The explicit cleanup provider and endpoint replace `ReasoningService`'s live fallback. Undo applies the held session. Tests cover local→remote and provider A→B through the real `processAudio` and `processWithOpenAIAPI`. Sealed mode is re-checked before restore, and main still enforces it. |
| **I1** late bytes not zeroed; Blobs reachable | Closed | Task 8 | The buffer owns every byte copy, zeroes copies that arrive after it closed, and swallows rejections. Source references are dropped at cancel: `segmentChunks`, `_batchSegments`, the streaming fallback chunks and segments, the session's `_sessionAudio` (which a completed dictation also clears), and `lastAudioBlob` only when it belongs to the same session. A newer session is never cleared. Tested for late bytes, rejection, replacement and residual references. PRIVACY.md states the Blob distinction honestly. |
| **I2** streaming and merge-time cancels lacked Undo | Closed | Task 8 | Streaming Undo replays the held PCM frames through the **same** streaming provider at 4× real time, then runs the normal finalization. This works for Deepgram and AssemblyAI too, which have no batch endpoint. Merge-time and processing-time batch cancels hold the raw segments registered before the merge. There are tests per path. A startup cancel, before any audio exists, has nothing to restore. **Different fix:** the report suggested re-transcribing through a batch endpoint; that would change the route (and does not exist for two providers), so replay stays on the streaming route. |
| **I3** restore not atomic; no Esc in restored processing | Closed | Tasks 8, 9 | `restoreCancelled` claims the buffer and enters `isProcessing` synchronously, before any await. Esc bumps a restore generation that every await checks, so an Esc before the pipeline starts puts the recording back in its window, and an Esc during it re-holds the audio. Every failure settles idle. Esc is registered from lifecycle transitions (busy ↔ idle), not from a successful mic start. Tests: a start during a pending restore, byte rejection, and Undo→processing→Esc. |
| **I4** stage selection ignores native visibility and ownership | Closed | Tasks 10, 11, 17 | `resolvePillOwnership(stage)` returns `holdsWindow`, `interactive` and `outranksFooter`. That one policy feeds auto-hide (`shouldAutoHidePill`), Assistant footer suppression, `resolveVoicePillInteraction` (mac and Windows click-through, and the Linux input region), and the show-when-hidden branch. Tested with auto-hide on, Assistant final actions, and Live Transcript or Assistant mounted. |
| **I5** "already received" is not egress evidence | Closed | Task 7 | With Plan 07, only main's `EgressNotice { phase: "sent" }` for this session's `correlationId` and a content payload counts (`attested`). Without Plan 07, evidence is recorded only after the transport hand-off (`dispatched`), and the copy then says "may have received". Startup failures, main rejections (`dispatched: false`) and Sealed blocks record nothing. Translation, cleanup, Agent and vision are instrumented. Loopback custom endpoints resolve to the device through Plan 03's resolver. |
| **I6** no cross-window Undo for Plan 05; disclosure shapes disagree | Closed | Tasks 7, 9; CCR-5, CCR-6 | There are `cancelled` and `cancelClosed` demo statuses with sanitised fields, `windowManager.sendUndoCancelDictation(sessionId)` (a request/reply to the overlay that returns `UndoResult`), and `lastCancelledDictation`. One `RemoteDisclosure` type (target id + payload + evidence) and one label helper serve Plans 04, 05 and 07. A two-window contract test covers the round trip. |
| **I7** temporary hotkeys lack main ownership | Closed | Tasks 2, 9, 18 | `hotkeyLeases.js` gives each temporary shortcut a main-owned lease. It is released on release, TTL, owner destruction, renderer crash and navigation. Registration is serialised per slot, so a late registration after release is undone and a newer lease is never unregistered by an older result. The UI shows a shortcut only when main reports `held`. Temporary slots never go to KGlobalAccel. The meeting prompt uses a lease too. |
| **I8** Linux notification races; fallback without Stop | Closed (fallback Stop moves to the tray) | Task 16 | The notification uses the bundled `@homebridge/dbus-native`, not a host CLI. Its lifetime is serialised by generation: a late id is closed, signals are subscribed first, and `NotificationClosed`, service loss and teardown are handled. Stop is bound to the meeting session. Where the server has no `actions` capability or no service, the tray's "Stop meeting recording" is the Stop, and a never-expiring notification says so. **Different fix:** Electron cannot add buttons on Linux, so a fallback notification with a Stop button is impossible. The platform question is Open question 4. |
| **I9** quit flush not wired | Closed | Task 9 | `before-quit` awaits `flushDictationBeforeQuit({ timeoutMs: 3000 })`, a token-bound request/reply to the overlay, before teardown. A dead renderer times out, and its RAM is gone with it. With retention off, the flush only zeroes. The test replies only after a delayed flush settles. |
| **I10** failed Retry cleanup dismisses its own alert | Closed | Tasks 1, 4 | `runNoticeAction` dismisses only the revision it started on. Notices are `busy` while an action runs, and repeat activations are ignored. An integration test runs the real store and the real retry. |
| **I11** secondary actions discarded | Closed | Task 3 | A chip with more than one action gets an accessible "More" disclosure (`aria-expanded`, `aria-controls`) listing every other action. The test renders and finds the secondary controls. |
| **I12** `openSettingsAt` path ignored | Closed | Task 4 | The path is carried end to end: main waits for a freshly created control panel to load, preload passes the payload, `ControlPanel` validates it against Plan 03's grammar and sets the section, and `SettingsModal` re-applies a section that arrives while it is open. |
| **I13** `words` contract permits expiry | Closed | Task 1 | `NoticeInput` is discriminated: `words` is typed only on alerts. At runtime, words on any kind make an alert that never expires. Tested. |
| **I14** presence loss treated as "saved" | Closed | Tasks 16, 17 | Presence is liveness only. `stopRecording` reports an explicit `MeetingOutcome` after the transcript write and the main stop settle: saved, `failed: save`, or `failed: stop`. Owner loss is `failed: ownerLost`. The pill announces only outcomes. Tested with a failed write and duplicate stops. |
| **M1** countdown regex fails | Closed | Task 11 | The test asserts each style declaration independently of order. |
| **M2** `onDismiss` semantics undefined | Closed | Task 1 | `onDismiss(reason)` fires exactly once per revision, with `user`, `action`, `timeout`, `replaced` or `evicted`. Each reason is tested. |
| **M3** non-concrete verification commands | Closed | Tasks 3, 19, 20 | The deletion gate is a quoted `rg` over imports only, excluding the files being removed. The missing-service case is tested by injection, never by mutating the host. Plan 02's behaviours are checked by name. There is a recorded macOS / X11 / Wayland matrix. The card-height regression is ported to `WordsFirstCard`. |

**Second review (independent, after the PR opened).** A second reviewer traced Tasks 1, 2, 6, 7, 8, 9 and 16 against the repo. All 24 findings are fixed in this revision. None is disputed.

| # | Finding | Fix |
|---|---|---|
| 1 | Session snapshot read `entry.store`; the real key is `storeKeys`, so Agent, vision and translation went unpinned | Task 6 reads `storeKeys`; the coverage test asserts exact membership |
| 2 | A stale `_activeSession` pinned a new streaming start to the old provider | Task 6 ends the session at every idle edge and resolves the start-time provider from live settings; test changes provider between two starts |
| 3 | Task 8 fixtures could not pass (window length, 256-byte minimum) | Real-size blobs with distinct fills, `_receivedAudioData`, a 2 s recording |
| 4 | A failed or cancelled replay left `isStreaming` set | `_replayStreamingSession` owns its state in try/finally, checks the restore generation per batch, stops the provider and re-holds the audio |
| 5 | `restoreCancelled` outlived the 2 s bridge | It returns `UndoResult` after the claim and pre-checks; the pipeline runs detached as `_restoreRun` |
| 6 | Esc during streaming finalization had no Undo | `_holdStreamingSession()` runs from `cancelProcessing` too; tested |
| 7 | Esc during the restore's awaits was lost | `_restoreGeneration` is bumped by both cancel paths and checked after each await; the pipeline is created at claim; tested |
| 8 | Late evidence was dropped; restore discarded it | Evidence records into the tracker captured before each await (batch, text, streaming); restore reuses `buffer.tracker` |
| 9 | In-flight merge temp files were unaddressed | Documented as a pre-existing step's file in PRIVACY.md, Task 8 "Known limit" and Task 20 |
| 10 | `_processingAudio` never existed | Replaced by `_sessionAudio`, released at cancel and on settle |
| 11 | Streaming frames survived a completed dictation | `_dropSessionAudio()` zeroes and clears them after finalization |
| 12 | Streaming duration read after `recordingStartTime` was nulled | The hold runs first; the >30 s window is tested |
| 13 | `setOnChange` existed only in prose | In the Task 7 tracker, with a late-evidence test |
| 14 | `onCancelledChange(state, closed)` was not in Task 8 | Task 8 emits the close reason itself |
| 15 | `onProcessingStage` was never emitted | Task 7 emits it from `processAudio` and the streaming finalize |
| 16 | `before-quit` could deadlock on a null `windowManager` | `(windowManager?.flushDictationBeforeQuit?.(…) ?? Promise.resolve())` |
| 17 | The Escape slot had no owner watch | Installed from `register-cancel-hotkey` (Task 2) |
| 18 | ⌥Z or ⌥↵ shown after main released the lease | Main sends `pill-hotkey-released`; `usePillHotkey` drops `held` |
| 19 | A refused Undo destroyed the audio | Sealed, busy and cancelled restores reopen the window |
| 20 | The Sealed pre-check skipped vision | `assistantVision` is checked when screen context is on |
| 21 | An empty meeting reported "save failed" | `persisted = !attempted || saveOk`; tested |
| 22 | The resident notification close was not awaited | Registered with `sidecarRegistry`, which `shutdownAll` awaits |
| 23 | Disclosure kept a single target | `RemoteDisclosure.alsoSentTo`, with "parts of this dictation" copy |
| 24 | Expired Undo had no notice; two error surfaces | Every refusal raises exactly one notice, `expired` included; a refusal never calls `onError` |

The three weak tests it named are rewritten: the other-session `lastAudioBlob` test sets the owner before the cancel, the TTL test asserts the clamped delay, and the `_processingAudio` assertion is gone.

**Cross-plan items from the review's conflict table:**
- **03.** Route-change receipts with Undo keep 7 s (`NOTICE_DURATION_MS.receiptWithAction`). `openSettingsAt` uses Plan 03's `settingsPath` grammar and its `SettingsModal` parser. `providerId` (CCR-7) is accepted in Plan 03's revision.
- **05.** Plan 04 owns and tests the bridge (CCR-5). Plan 05 keeps its new demo events when it rebases onto this plan's hook changes.
- **06.** Cancellation is **not** a broadcast dictation-lifecycle edge. It is a separate hook field (`cancelled`) plus the demo/bridge events, so Plan 06's lifecycle forwarding is untouched. Any toast Plan 06 adds is migrated by the guard test in Task 5, which runs on the final combined tree.
- **07.** One disclosure shape and one correlation id (CCR-6). Main's Sealed enforcement stays authoritative, and Undo pre-checks it but never bypasses it.

---

## Contract change requests

Plan 04 owns §5.2 and §5.3. These are the exact shapes this plan ships. The owner applies them to the spec and notifies Plans 05 and 07. Task 21 confirms the merged spec matches before the PR. Shared types live in `src/types/dictation.ts`, created in Task 7, so consumers import them instead of restating them.

**CCR-1 (§5.2), the `cancelled` state.** Every cancel that captured audio has an Undo window, including streaming and merge-time cancels. A cancel before any audio exists produces no `cancelled` state.

```ts
export interface CancelledState {
  sessionId: string;              // the dictation session (also the correlationId, CCR-6)
  undoUntil: number;              // epoch ms the window closes; frozen while paused
  paused: boolean;                // the pointer rests on the pill
  remainingMs: number;            // what is left of the window
  remoteAlreadySent: RemoteDisclosure | null;   // CCR-6; updates while the window is open
}
export type UndoResult =
  | { restored: true; sessionId: string }
  | { restored: false; sessionId: string | null; reason: "expired" | "busy" | "sealed" | "routeUnavailable" | "noAudio" | "unavailable" };
```

`undoCancel(): Promise<boolean>` keeps the §5.2 signature. When it returns `false`, exactly one notice explains the reason. The earlier draft's `remotePayload` field and its `undoUntil: 0` sentinel are withdrawn.

`UndoResult` semantics:
- `restored: true` means the recording was claimed and its pipeline started. It does not wait for the transcript.
- `expired` means no window is open for that session: it closed, or another cancel replaced it.
- `busy` means a dictation is running, or Esc cancelled the restore before its pipeline started.
- `sealed` means Sealed mode blocks a route the recording needs.
- `noAudio` means the held bytes were empty or could not be read.
- `routeUnavailable` means the recorded streaming provider is gone.
- `unavailable` means the bridge could not reach the overlay (CCR-5).

On `busy` and `sealed` the recording goes back into its window, and a fresh `cancelled` state is emitted, so the user can try again.

**CCR-2 (§5.2), the meeting recorder.** The `meetingRecording` pill state carries liveness only. Saving is a separate, explicit outcome.

```ts
export interface MeetingPresence { sessionId: string; startedAt: number; interruption: "systemAudio" | "mic" | null; quiet: boolean }
export type MeetingOutcome =
  | { sessionId: string; kind: "saved"; durationMs: number; noteId: string | null }
  | { sessionId: string; kind: "failed"; reason: "save" | "stop" | "ownerLost" };
```

**CCR-3 (§5.2), `useAudioRecording` return additions.** These are read-only:

```ts
cancelled: CancelledState | null;
undoCancel(): Promise<boolean>;
pauseUndo(): void;
resumeUndo(): void;
processingStage: "transcribing" | "cleaning" | null;
outcome: { sessionId: string; kind: "pasted"; words: number; at: number } | { sessionId: string; kind: "failed"; at: number } | null;
meetingRecording: MeetingPresence | null;
```

**CCR-4 (§5.3), `notify()`.**

```ts
export type NoticeKind = "receipt" | "notice" | "alert";
export type NoticeRemoval = "user" | "action" | "timeout" | "replaced" | "evicted";
export interface NoticeAction { label: string; onClick: () => void | Promise<void>; primary?: boolean; keepOpen?: boolean }
interface NoticeBase { title: string; body?: string; actions?: NoticeAction[]; persistent?: boolean; id?: string;
  details?: TechnicalErrorDetailsData; onDismiss?: (reason: NoticeRemoval) => void }
export type NoticeInput =
  | (NoticeBase & { kind: "alert"; words?: string })
  | (NoticeBase & { kind: "receipt" | "notice"; words?: never });
export function notify(input: NoticeInput): string;
export function dismissNotice(id: string, reason?: NoticeRemoval): void;
export function useNotices(): readonly Notice[];   // Notice adds id, revision, createdAt, expiresAt, remainingMs, busy
```

The semantics:
- **Lifetimes.** A receipt lasts 3.5 s, or 7 s when it carries an action. A notice or alert lasts 10 s. A notice or alert never expires when `persistent`, and an alert never expires when it carries `words`. Words on any other kind are promoted to an alert.
- **Replacement.** The same `id` replaces the earlier notice and bumps its `revision`.
- **Actions.** An action dismisses only the revision it began on. Repeat activation is ignored while the notice is `busy`.
- **`onDismiss`.** It fires exactly once per revision, with the removal reason.
- **Cap.** At most three notices are visible.

**CCR-5 (§5.2), the cross-window Undo bridge for Plan 05.** The trial records in the overlay window, and the control panel drives it.
- **Overlay → main → control panel.** These go on `onboarding-demo-event`. Main sanitises them with `sanitizeCancelledDemoFields`:

  ```ts
  | { kind: "dictation" | "assistant"; status: "cancelled"; sessionId: string; cancelled: CancelledState }  // on open, pause, resume, new evidence
  | { kind: "dictation" | "assistant"; status: "cancelClosed"; sessionId: string; reason: "expired" | "restored" | "replaced" | "flushed" }
  // A successful Undo is followed by the existing { status: "processing" } event.
  ```

- **Control panel → main → overlay.**

  ```js
  windowManager.sendUndoCancelDictation(sessionId?: string): Promise<UndoResult>;
  // Request/reply on undo-cancel-request / undo-cancel-reply, bound to the overlay's webContents and a token.
  // Times out after 2 s with { restored: false, sessionId, reason: "unavailable" }. restoreCancelled answers
  // after its claim and pre-checks (CCR-1), so a slow transcription never trips the timeout.
  windowManager.lastCancelledDictation: { sessionId: string } | null;
  ```

- **For Plan 05.** Its `onboarding-demo-undo-cancel` handler calls `windowManager.sendUndoCancelDictation(windowManager.lastCancelledDictation?.sessionId)`, and returns `result.restored`. Its `OnboardingDemoEvent` uses `cancelled: CancelledState`, not the earlier `undoUntil` / `remoteAlreadySent?: string` pair. Its copy renders `cancelled.remoteAlreadySent` with `disclosureCopy` (CCR-6), so local speech with remote cleanup reads "…received the text".

**CCR-6 (§5.2 / §5.4), one disclosure shape, settled with Plan 07.**

```ts
export type DisclosurePayload = "audio" | "text" | "image";
export interface RemoteDisclosure {
  target: string;                         // provider id ("openai", "custom"), or "host:<hostname>" for the user's own server
  payload: DisclosurePayload;             // strongest seen: audio > image > text
  evidence: "attested" | "dispatched";    // attested = Plan 07 EgressNotice; dispatched = renderer saw the transport hand-off
  alsoSentTo: string[];                   // other targets of the same session, strongest evidence first; [] when one
}
// src/helpers/dictationDisclosure.js
dispatchTargetLabel(target, t): string;   // providerDisplayLabel for providers, the host for "host:…"
disclosureCopy(disclosure, t): string;    // "{{provider}} already received the audio." / "…may have received…";
                                          // with alsoSentTo: "OpenAI, Anthropic already received parts of this dictation."
```

- **Correlation.** The `correlationId` Plan 07 asked for (its CCR-3) is the dictation session id. It is carried on the BYOK transcription payload, the realtime and per-provider streaming start options, and every cleanup, Agent, vision and translation text request of that recording.
- **Evidence.** When Plan 07's `privacy.onEgress` exists, only a `{ phase: "sent" }` notice with this session's `correlationId` and payload `audio`, `text` or `image` sets `evidence: "attested"`. `metadata` (token fetches) never counts. Without Plan 07, evidence is recorded only after the transport hand-off.
- **Amendment to Plan 07's CCR-3.** `remoteAlreadySent` is a `RemoteDisclosure`, not a display-name string. Main has no user-locale `t()`, and Plan 01's review requires `providerDisplayLabel(providerId, t)` for every shown provider name. The flight recorder keeps its own `EgressEvent` rows unchanged.
- **Naming.** Plan 07's `EgressNotice` is an IPC event type, unrelated to the §5.3 notice tier. Any user-facing egress message is shown through `notify({ kind: "receipt" | "notice" })`, with text from `disclosureCopy`.

**CCR-7 (§5.1, owner Plan 03): `ResolvedRoute.providerId: string | null`.** Plan 03's revision has accepted this. `routeProviderLabel` (Task 11) uses it unconditionally once present. Until then, it falls back to `route.provider`.

## Open questions for the owner

Each question has a default that the plan implements. A different answer changes only the task named.

1. **Live words and "Show transcription preview" (Task 12).** The default shows Condensation words above the pill whenever streaming partials exist, even with the preview setting off. Words on screen matter when screen sharing. Should the row honour that setting (off by default), or get its own?
2. **R11 B mini pill width (Task 18).** The card text says 168 px, but the mock CSS uses 224 px. "Meeting? Start notes ⌥⌘M" does not fit in 168 px at 12.5 px, so the plan uses 224 px.
3. **Global shortcuts beyond ⌥Z.** The plan adds two more, each leased only while its surface shows, and displayed only while main holds it:
   - ⌥↵ "Paste again" while a words card is up (Task 3);
   - ⌥⌘M (Ctrl+Alt+M) "Start notes" while a meeting prompt is up (Task 18).

   Are those combinations acceptable?
4. **Linux without notification actions (Task 16).** Electron cannot add buttons to Linux notifications, and some notification servers do not support actions. On those desktops, Stop lives in the tray menu and the pill. The resident notification is a never-expiring message that points there. Acceptable, or should the plan add a native helper?
5. **Linux and the on-screen setting (Tasks 16, 17).** By default, the tray dot and the resident notification appear on Linux whenever a meeting records. "Show meeting recorder on screen" governs only the pill. Should the setting also suppress the notification?
6. **"Retry cleanup" (Task 4).** After a raw paste the pasted text cannot be rewritten in another app, so Retry copies the cleaned text and says so. History keeps the raw text. Is that the expected behaviour?
7. **Words-card primary colour (Task 3).** The R6 B mock paints "Paste again" orange. D1 reserves orange for voice controls, so the plan uses the ink button.
8. **Crash inside the undo window.** With "Save discarded" on, the audio is saved when the window closes. A normal quit flushes it (Task 9), but a crash inside the 5–10 s window loses that one recording. A crash-proof save would mean writing to disk at cancel, which D3 forbids.
9. **Streaming Undo pacing (Task 8).** The replay sends at 4× real time. A provider that rejects faster-than-real-time input fails that Undo. The audio goes back into its window, so the words are not lost, but that Undo cannot succeed. Should the replay drop to 1× (slower Undo for long dictations)?
10. **A cancel while a step is already writing a temp file (Task 8).** If Esc lands while main is already merging segments, or while a local engine is already reading its input, that step's temp file exists until the step ends, usually under a second. The plan documents this in PRIVACY.md rather than killing FFmpeg or the engine mid-write. Is that acceptable, or should the merge IPC become abortable?

## Plan 01 review hand-offs (shipped at `172f9df` on `snowopsdev/feat/uiux-foundations`)

Plan 01's final review sent four items to this plan. Each is folded into the task named below.

1. **Provider names.** Every provider name in the pill or in a notice comes from `providerDisplayLabel(providerId, t)` (`src/lib/locality.ts`), which localises the "Custom endpoint" and "Unknown provider" fallbacks. `providerDisplayName` is for logs only.
   - Task 7 records provider **ids**, and `dispatchTargetLabel` / `disclosureCopy` render them.
   - Tasks 11 and 13 render route providers through `routeProviderLabel(route, t)`.
2. **Two leftover motion and colour rules.** These are `.assistant-response-content-updating` (an exit) and `.thinking-shimmer-text` (cool hues). Task 14 moves the first onto `--motion-ease-exit`, and the second onto the foreground and muted tokens.
3. **Meeting card Start button.** It starts a recording, so it is a live-voice control under D1 and keeps `Button variant="live"`. The `bg-primary/10` tile behind the mark is removed. Both are recorded in Task 18 and in DESIGN.md.
4. **`LevelBars` internals.** Callers pass inline readers (`readLevel` is held in a ref). Task 13's radial ticks reuse `nextLevelBarsFrame`, `LEVEL_BARS_SILENCE_FLOOR` and the flat reduced-motion phase. Tasks 11 and 19 replace the old waveforms.

## Before you start (dependency check)

Plan 04 executes after Plans 01, 02 and 03 have merged (spec §3). Plan 02 changes the same toast, Esc and meeting-interruption code that this plan replaces. Verify before Task 1:

```bash
rg -n "export function providerDisplayLabel" src/lib/locality.ts
rg -n "export function nextLevelBarsFrame|export const LEVEL_BARS_SILENCE_FLOOR" src/components/ui/levelBarsMath.ts
ls src/lib/locality.ts src/lib/routes.ts src/components/ui/LevelBars.tsx src/components/ui/LocalityRing.tsx src/utils/contrast.ts test/helpers/harness/cssTokens.js
rg -n -- "--motion-ease-exit|--color-live:" src/index.css
rg -n "variant.*live" src/components/ui/button.tsx
rg -n "export function (useResolvedRoute|resolveRoute|buildRouteSnapshot)" src/lib/routes.ts
rg -n "providerId" src/lib/routes.ts
rg -ln "new Notification\(" src/helpers main.js
```

Expected:
- every file exists;
- the tokens and the `live` variant are present;
- `routes.ts` exports `useResolvedRoute`, `resolveRoute` and `buildRouteSnapshot`, and carries `providerId`;
- Plan 02's native notification module is present.

If `routes.ts` or Plan 02's module is missing, the dependency has not merged. Stop and report. If Plan 07's `window.electronAPI.privacy` is absent, nothing breaks: disclosure falls back to `dispatched` evidence, and Undo's Sealed pre-check is skipped (main still enforces Sealed mode once Plan 07 ships).

**Plan 02 overlap.** Plan 02 owns VO-Q6, VO-Q8, VO-Q9 and VO-Q16. This plan deletes `Toast.tsx`, `toastPresentation.js` and `DictationErrorCard.tsx` (Task 5), and carries their rules forward:
- Q6: words alerts never expire (Task 1).
- Q9: live regions and a visible close (Task 3).
- Q8: Esc is armed until idle, now owned by the lifecycle (Task 9).

Plan 02's Q16 native interruption notifications are untouched. Task 16's resident recording notification is separate. Task 20 Step 2 re-checks all four.

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md). Every new IPC method gets a `preload.js` entry and a `src/types/electron.ts` type, plus a `src/preview/browserPreview.ts` stub when the renderer calls it unguarded. Main-side request/reply goes through `requestFromRenderer` (token, sender, timeout).
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. A dictation's route is pinned by its session at recording start, and Undo replays that route. Content is preserved on every failure.
- **D3, cancel (owner-confirmed):**
  - Cancel is instant, with no confirmation dialog.
  - The undo window is 5 s, or 10 s when the recording is over 30 s. Hover pauses it. ⌥Z or a click restores.
  - Every cancel that captured audio gets Undo: recording, mic recovery, segment merge, transcription and cleanup (batch); recording and finalization (streaming).
  - The cancelled recording is held **in RAM only**: no file, and no temp file (no FFmpeg merge). It is never persisted unless retention already saves discarded audio (`shouldSaveDiscardedRecording`).
  - When the window closes, every owned byte is zeroed, including bytes that finish copying afterwards, and no reference to a source Blob remains.
  - Undo replays the session's original route, never current settings. Sealed mode blocks a non-device Undo.
  - Esc is armed whenever the pipeline is busy, including an Undo-started processing phase, and released at idle.
  - If a provider received the audio or text, the copy says so. Main-attested evidence reads "already received", renderer-only evidence reads "may have received", and nothing is said when nothing was dispatched.
- **Temporary global shortcuts** (⌥Z, ⌥↵, ⌥⌘M) are main-owned leases (Task 2). They are released on disable, TTL, owner loss and navigation, and shown only while held.
- **D2, the meeting recorder:**
  - It is a state of the existing pill window, never a second always-on-top window.
  - Linux adds a tray recording state, with Stop in the tray menu, and a resident notification with Stop where the notification server supports actions.
  - "Show meeting recorder on screen" defaults to on.
  - "Saved" is announced only from an explicit outcome, never from presence disappearing.
- Condensation words render on their own layer above the bars. The bars are never clipped by words (D9). Agent Mode ships without the frame glyph (D9, VO-R8 owner note).
- Orange (`variant="live"`, `--color-live`) is only for record, stop, mic, send-by-voice, the pill and meters (D1). Notice and card primaries use the default ink `Button`.
- The pill window stays 208×120 (`PILL_WINDOW_SIZE`) for every pill-only state. No pill footprint may exceed 184 px wide. Recording edges never call `setBounds`.
- One ownership policy (`resolvePillOwnership`) decides auto-hide, footer suppression and pill input for long-lived stages (Task 10).
- Provider names shown in the pill or in notices come from `providerDisplayLabel(providerId, t)`. `providerDisplayName` is for logs only.
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night. Never put white text on `#FF5A1F`.
- **Motion tokens.** Motion uses the Plan 01 tokens (`--motion-*`, springs as `linear()`) for every transition and every enter or exit. The exceptions are literal values the picked specs fix:
  - loop periods: the 1.6 s comet, 2.4 s and 1.2 s orbit, 1.2 s dot and 2 s shimmer;
  - choreography beats: 140/220 ms word landing, the 600 ms underline, 640 ms with `--motion-spring-bounce`, and the 260 ms nudge.

  Ambient loops (breathe, dot pulse) may use `ease-in-out`, per the audit §4.1 mapping. Every loop is gated to its active state. Reduced motion keeps opacity and colour and drops transforms. No `cubic-bezier(0.4, 0, 1, 1)`.
- Every visible string goes through i18n, with keys in all 12 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`), including every CLDR plural category `i18n:check` asks for. `npm run i18n:check` passes.
- Use logical properties for RTL. The exception is anchors that track the pill's physical screen dock (`data-direction` / `horizontalDirection`): the pill notice stack, the pill caption and the pill tooltip stay physical.
- Tests: `npm run native:node` once, then `npm test -- <files>`. Run `npm run native:electron` before launching the app. Never use personal profiles, and never mutate the host system (uninstalling binaries, for example), in tests or verification.
- Before the PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`, `npm run format:check`.
- `--shadow-card` and `--shadow-elevated` exist only under `.dark`. Every `box-shadow` that uses them carries a light fallback.
- DESIGN.md is the source of truth (D10). Each task that changes a documented surface updates DESIGN.md in the same commit.

## Review Focus

These are the five failure modes most likely to bite a person, each pinned by a test in the owning task.

1. **Settings change during the undo window.** The user switches STT from local to OpenAI, then presses ⌥Z. They expect the restored dictation to stay on the device. Pinned in Task 8 (`audioManagerCancelBuffer.test.js`, "Undo restores through the session's route even after settings move to a provider") and Task 6 (`audioManagerSessionRoute.test.js`, "audio recorded on-device stays on-device…", "provider A stays provider A…").
2. **Cancel after a microphone change, retention off.** Two recorded segments, then Esc. They expect nothing on disk, temp files included, and every byte zeroed when the window closes. Pinned in Task 8 ("two segments, retention off: no merge, no write, every byte zeroed (C1)", "bytes that arrive after the buffer was zeroed are zeroed on arrival (I1)").
3. **Undo, then Esc, then a new dictation.** They expect Esc to cancel the restored processing, and a new hotkey press during a pending restore not to start a second pipeline. Pinned in Task 8 ("Undo is claimed synchronously…", "Esc while a restore waits for its bytes cancels it and puts the recording back (I3)") and Task 9 ("Esc is owned by the lifecycle…, including an Undo-started processing phase").
4. **⌥Z or ⌥↵ leaking after the affordance is gone.** This includes a renderer reload and a backend that answers late. They expect the shortcut back in other apps. Pinned in Task 2 (`hotkeyLeases.test.js`, "released while registration is pending…", "the owner's renderer going away releases every lease it holds") and Task 9 ("⌥Z is leased while a window is open and released when it closes").
5. **The control panel crashes mid-meeting.** They expect the pill to stop showing a timer and to say the recorder stopped unexpectedly, never "Meeting saved". Pinned in Task 16 (`meetingPresence.test.js`, "presence clears when the owner goes away, and that is reported as ownerLost, never saved"; `meetingStopOutcome.test.js`, "a failed transcript write is a failed outcome…") and Task 17 ("the pill never announces 'saved' because presence vanished").

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/components/ui/notices.ts` | Notice store and `notify()` (§5.3, CCR-4) | 1 |
| `src/helpers/hotkeyLeases.js`, `src/hooks/usePillHotkey.ts` | Main-owned temporary shortcuts | 2 |
| `src/components/ui/NoticeStack.tsx`, `NoticeChip.tsx`, `WordsFirstCard.tsx`, `src/styles/notices.css` | R14 B chips with "More", R6 B card | 3 |
| `src/components/voiceNotices.ts`, `src/helpers/retryDictationCleanup.js`, `src/utils/settingsDeepLink.ts`, `*NoticeListener.tsx` | VO-Q7, VO-Q21, the Settings deep link | 4 |
| Toast removal | Finish the §5.3 migration | 5 |
| `src/helpers/dictationSession.js` | Route snapshot and correlation id per recording | 6 |
| `src/types/dictation.ts`, `src/helpers/dictationDisclosure.js` | Shared §5.2 types; attested or dispatched disclosure | 7 |
| `src/helpers/cancelBuffer.js` (+ `audioManager.js`) | RAM-only cancel buffer and same-route Undo (D3) | 8 |
| `src/helpers/rendererRequest.js`, `src/hooks/useAudioRecording.js`, `src/hooks/useUndoCancelHotkey.ts`, `main.js` | §5.2 lifecycle, Esc ownership, Undo bridge, quit flush | 9 |
| `src/helpers/voicePillPresentation.js` | Stage, footprint and ownership model; VO-Q5, Q12, Q18 | 10 |
| `VoicePill.tsx`, `pillLocality.ts`, `PillCaption.tsx`, `useRecentOutcome.ts` | Condensation pill, locality ring, undo capsule | 11 |
| `condensation.ts`, `CondensationWords.tsx` | R1 C word layer (D9) | 12 |
| `AgentOrbit.tsx`, `agentOrbitMath.ts`, `useAgentAnswering.ts` | R8 B violet orbit | 13 |
| `PillTooltip.tsx`, `pillTooltipLines.ts`, CSS | VO-Q14, Q19, Q20 and the Plan 01 leftovers | 14 |
| `src/utils/dictationCues.js`, settings | R10 A soft family | 15 |
| `meetingPresence.js`, `linuxRecordingNotification.js`, `freedesktopNotifications.js`, `trayRecordingIcon.js`, `meetingRecordingStore.ts` | D2 relay, explicit outcome, tray, Linux notification | 16 |
| `MeetingCapsule.tsx`, `useMeetingRecordingPresence.ts`, settings | R12 A capsule as a pill state | 17 |
| `MeetingNotificationOverlay.tsx`, `MeetingNotificationCard.tsx`, `windowManager.js`, `windowConfig.js` | R11 B notch drop, VO-Q10, the leased ⌥⌘M | 18 |
| `NoteRecordControl.tsx`, `MeetingRecordingPill.tsx`, `MeetingRecordingMount.tsx`, `ChatInput.tsx`, `MeetingTranscriptChat.tsx` | LevelBars everywhere, VO-Q11, Q13, Q15 | 19 |
| Whole plan | Verification, D3 audit, platform matrix | 20 |
| Spec confirmation, PR body | Contracts and PR | 21 |

---

### Task 1: Notice store and the `notify()` API

Covers §5.3 (the logic half) and VO-R14 B (lifetimes, cap, stagger). It also closes review findings I10 (a replaced notice is never dismissed by the action that replaced it), I13 (`words` only on alerts, and never expiring) and M2 (removal reasons, each delivered exactly once).

**Files:**
- Create: `src/components/ui/notices.ts`
- Modify: `src/components/ui/TechnicalErrorDetails.tsx`. Move the `TechnicalErrorDetailsData` interface here from `src/components/ui/useToast.ts:5`.
- Modify: `src/components/ui/useToast.ts:5`. Replace the interface with `export type { TechnicalErrorDetailsData } from "./TechnicalErrorDetails";` until Task 5 deletes the file.
- Test: `test/components/notices.test.js`

**Interfaces:**
- Produces the §5.3 contract (CCR-4). Every later task and Plans 03, 05, 06 and 07 import these.

  ```ts
  export type NoticeKind = "receipt" | "notice" | "alert";
  export type NoticeRemoval = "user" | "action" | "timeout" | "replaced" | "evicted";
  export interface NoticeAction { label: string; onClick: () => void | Promise<void>; primary?: boolean; keepOpen?: boolean }
  interface NoticeBase {
    title: string; body?: string; actions?: NoticeAction[]; persistent?: boolean;
    id?: string; details?: TechnicalErrorDetailsData;
    /** Called exactly once per notice revision, with why it left. */
    onDismiss?: (reason: NoticeRemoval) => void;
  }
  /** `words` is recovered user content: only an alert may carry it, and an alert with words never expires. */
  export type NoticeInput =
    | (NoticeBase & { kind: "alert"; words?: string })
    | (NoticeBase & { kind: "receipt" | "notice"; words?: never });
  export type Notice = NoticeInput & {
    id: string; revision: number; createdAt: number; expiresAt: number | null;
    remainingMs: number | null; busy: boolean;
  };
  export const NOTICE_DURATION_MS: { receipt: 3500; receiptWithAction: 7000; notice: 10000; alert: 10000 };
  export const NOTICE_MAX_VISIBLE = 3;
  export const NOTICE_STAGGER_MS = 40;
  export function noticeLifetimeMs(input: NoticeInput): number | null;
  export function notify(input: NoticeInput): string;              // returns the id
  export function dismissNotice(id: string, reason?: NoticeRemoval): void;  // reason defaults to "user"
  export function pauseNotice(id: string): void;
  export function resumeNotice(id: string): void;
  export function runNoticeAction(id: string, action: NoticeAction): Promise<void>;
  export function visibleNotices(list: readonly Notice[]): Notice[];
  export function staggerIndex(list: readonly Notice[], id: string): number; // 0..2
  export function getNotices(): readonly Notice[];
  export function subscribeNotices(listener: () => void): () => void;
  export function useNotices(): readonly Notice[];
  export function __setNoticeClockForTests(clock?: NoticeClock): void;
  ```

- Semantics, all pinned by tests:
  - A receipt that carries an action (for example "Undo") lives 7 s. Plan 03's route-change receipts keep their 7 s Undo window.
  - A `notify()` with an existing `id` replaces that notice. It bumps `revision`, and calls the old revision's `onDismiss("replaced")`.
  - `runNoticeAction` dismisses only the revision it started on. If the action published a replacement under the same id (for example, a failed retry), the replacement survives (I10).
  - While an action is running, the notice is `busy`. Repeated activations are ignored, so an unsafe operation never runs twice concurrently.
  - Content safety: a `words` value on a receipt or notice is a type error. At runtime it is promoted to an alert, so recovered content never expires silently (I13).

- [ ] **Step 1: Write the failing test**

Create `test/components/notices.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/notices.ts");

function fakeClock() {
  let now = 1_000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

async function fresh(t) {
  const m = await load();
  const clock = fakeClock();
  m.__setNoticeClockForTests(clock);
  t.after(() => m.__setNoticeClockForTests());
  return { m, clock };
}

test("receipts expire after 3.5s, undoable receipts after 7s, notices and alerts after 10s", async (t) => {
  const { m, clock } = await fresh(t);
  m.notify({ kind: "receipt", title: "Pasted" });
  m.notify({ kind: "receipt", title: "Route changed", actions: [{ label: "Undo", onClick() {} }] });
  m.notify({ kind: "notice", title: "Pasted without cleanup" });
  clock.advance(3_500);
  assert.deepEqual(m.getNotices().map((n) => n.title), ["Route changed", "Pasted without cleanup"]);
  clock.advance(3_500);
  assert.deepEqual(m.getNotices().map((n) => n.title), ["Pasted without cleanup"]);
  clock.advance(3_000);
  assert.equal(m.getNotices().length, 0);
});

test("persistent notices and alerts that carry words never schedule a timer", async (t) => {
  const { m, clock } = await fresh(t);
  m.notify({ kind: "notice", title: "Model changed", persistent: true });
  m.notify({ kind: "alert", title: "Couldn't paste", words: "hello there" });
  assert.equal(clock.pending(), 0);
  clock.advance(60_000);
  assert.equal(m.getNotices().length, 2);
  assert.equal(m.noticeLifetimeMs({ kind: "alert", title: "x", words: "" }), 10_000);
});

test("content on any kind is never allowed to expire (I13)", async (t) => {
  const { m, clock } = await fresh(t);
  // A JS caller (or a cast) that puts words on a notice gets an alert, not a 10s chip.
  m.notify({ kind: "notice", title: "Recovered", words: "keep me" });
  clock.advance(60_000);
  const [n] = m.getNotices();
  assert.equal(n.kind, "alert");
  assert.equal(n.words, "keep me");
  assert.equal(n.expiresAt, null);
});

test("the same id replaces the earlier notice, bumps its revision and reports 'replaced' once", async (t) => {
  const { m } = await fresh(t);
  const reasons = [];
  const first = m.notify({ id: "cleanup-failed", kind: "notice", title: "A", onDismiss: (r) => reasons.push(`A:${r}`) });
  const second = m.notify({ id: "cleanup-failed", kind: "notice", title: "B", onDismiss: (r) => reasons.push(`B:${r}`) });
  assert.equal(first, "cleanup-failed");
  assert.equal(second, "cleanup-failed");
  assert.deepEqual(m.getNotices().map((n) => [n.title, n.revision]), [["B", 2]]);
  m.dismissNotice("cleanup-failed");
  m.dismissNotice("cleanup-failed");
  assert.deepEqual(reasons, ["A:replaced", "B:user"]);
});

test("a fourth notice evicts the oldest expiring one with reason 'evicted'; persistent ones survive", async (t) => {
  const { m } = await fresh(t);
  const reasons = [];
  m.notify({ kind: "notice", title: "keep", persistent: true });
  m.notify({ kind: "receipt", title: "old", onDismiss: (r) => reasons.push(`old:${r}`) });
  m.notify({ kind: "receipt", title: "mid" });
  m.notify({ kind: "receipt", title: "new" });
  assert.deepEqual(m.getNotices().map((n) => n.title), ["keep", "mid", "new"]);
  assert.deepEqual(reasons, ["old:evicted"]);
});

test("timeouts report 'timeout' exactly once", async (t) => {
  const { m, clock } = await fresh(t);
  const reasons = [];
  m.notify({ kind: "receipt", title: "Pasted", onDismiss: (r) => reasons.push(r) });
  clock.advance(10_000);
  assert.deepEqual(reasons, ["timeout"]);
});

test("visibleNotices shows the newest three when persistent notices overflow", async (t) => {
  const { m } = await fresh(t);
  for (const title of ["a", "b", "c", "d"]) m.notify({ kind: "alert", title, persistent: true });
  assert.equal(m.getNotices().length, 4);
  assert.deepEqual(m.visibleNotices(m.getNotices()).map((n) => n.title), ["b", "c", "d"]);
});

test("hover pause freezes the countdown; resume keeps the remaining time", async (t) => {
  const { m, clock } = await fresh(t);
  const id = m.notify({ kind: "receipt", title: "Pasted" });
  clock.advance(3_000);
  m.pauseNotice(id);
  clock.advance(20_000);
  assert.equal(m.getNotices().length, 1);
  m.resumeNotice(id);
  clock.advance(499);
  assert.equal(m.getNotices().length, 1);
  clock.advance(1);
  assert.equal(m.getNotices().length, 0);
});

test("an action dismisses its own revision with reason 'action', unless keepOpen", async (t) => {
  const { m } = await fresh(t);
  const reasons = [];
  let ran = 0;
  const id = m.notify({ kind: "notice", title: "x", onDismiss: (r) => reasons.push(r) });
  await m.runNoticeAction(id, { label: "Go", onClick: () => { ran++; } });
  await m.runNoticeAction(id, { label: "Go", onClick: () => { ran++; } });
  assert.equal(ran, 1, "a dismissed notice runs nothing");
  assert.deepEqual(reasons, ["action"]);
  const kept = m.notify({ kind: "alert", title: "y" });
  await m.runNoticeAction(kept, { label: "Retry", keepOpen: true, onClick: () => {} });
  assert.equal(m.getNotices().length, 1);
});

test("a replacement published by the action survives the action's own dismissal (I10)", async (t) => {
  const { m } = await fresh(t);
  const id = m.notify({ id: "cleanup-failed", kind: "notice", title: "Pasted without cleanup" });
  await m.runNoticeAction(id, {
    label: "Retry cleanup",
    onClick: async () => {
      // The retry fails again and explains why, under the same id.
      m.notify({ id: "cleanup-failed", kind: "alert", title: "Cleanup failed again" });
    },
  });
  assert.deepEqual(m.getNotices().map((n) => [n.title, n.revision]), [["Cleanup failed again", 2]]);
});

test("a notice is busy while its action runs and ignores repeated activation", async (t) => {
  const { m } = await fresh(t);
  let release;
  let runs = 0;
  const gate = new Promise((r) => (release = r));
  const id = m.notify({ kind: "alert", title: "Couldn't paste" });
  const action = { label: "Paste again", keepOpen: true, onClick: async () => { runs++; await gate; } };
  const first = m.runNoticeAction(id, action);
  assert.equal(m.getNotices()[0].busy, true);
  await m.runNoticeAction(id, action);
  release();
  await first;
  assert.equal(runs, 1);
  assert.equal(m.getNotices()[0].busy, false);
});

test("a failing action still dismisses its revision and rethrows", async (t) => {
  const { m } = await fresh(t);
  const id = m.notify({ kind: "notice", title: "x" });
  await assert.rejects(m.runNoticeAction(id, { label: "Boom", onClick: () => { throw new Error("nope"); } }), /nope/);
  assert.equal(m.getNotices().length, 0);
});

test("notices that arrive in the same 40ms window stagger 0, 1, 2", async (t) => {
  const { m, clock } = await fresh(t);
  const a = m.notify({ kind: "receipt", title: "a" });
  clock.advance(10);
  const b = m.notify({ kind: "receipt", title: "b" });
  clock.advance(10);
  const c = m.notify({ kind: "receipt", title: "c" });
  assert.deepEqual([a, b, c].map((id) => m.staggerIndex(m.getNotices(), id)), [0, 1, 2]);
  clock.advance(500);
  const d = m.notify({ kind: "receipt", title: "d" });
  const list = m.getNotices();
  assert.equal(list.some((n) => n.id === a), false); // capped at three
  assert.deepEqual([b, c, d].map((id) => m.staggerIndex(list, id)), [0, 1, 0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/notices.test.js`
Expected: FAIL with `Cannot find module '../../src/components/ui/notices.ts'`.

- [ ] **Step 3: Implement**

1. In `src/components/ui/TechnicalErrorDetails.tsx`, add the interface that `useToast.ts:5-10` defines today. Copy its body verbatim and export it. Remove the local `import type { TechnicalErrorDetailsData } …` line from that file.
2. In `src/components/ui/useToast.ts`, replace the interface with `export type { TechnicalErrorDetailsData } from "./TechnicalErrorDetails";`.
3. Create `src/components/ui/notices.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { TechnicalErrorDetailsData } from "./TechnicalErrorDetails";

// One notice system with three tiers (DESIGN.md "Notices"):
// - receipt: something happened as asked; it times out.
// - notice: something changed or degraded; it waits when `persistent`.
// - alert: words or work are at risk; role="alert"; it never times out while
//   it carries recovered words.
// A plain module store (not React context), so non-React code such as
// AudioManager callbacks and listeners can call notify() directly.

export type NoticeKind = "receipt" | "notice" | "alert";
export type NoticeRemoval = "user" | "action" | "timeout" | "replaced" | "evicted";

export interface NoticeAction {
  label: string;
  onClick: () => void | Promise<void>;
  /** The chip shows the first primary action inline; the rest live behind "More". */
  primary?: boolean;
  /** Keep the notice up after the action runs (e.g. "Paste again" that may fail). */
  keepOpen?: boolean;
}

interface NoticeBase {
  title: string;
  body?: string;
  actions?: NoticeAction[];
  persistent?: boolean;
  /** Stable id: a later notify() with the same id replaces this notice. */
  id?: string;
  details?: TechnicalErrorDetailsData;
  /** Called exactly once per revision, with the reason it left. */
  onDismiss?: (reason: NoticeRemoval) => void;
}

export type NoticeInput =
  | (NoticeBase & { kind: "alert"; words?: string })
  | (NoticeBase & { kind: "receipt" | "notice"; words?: never });

export type Notice = NoticeInput & {
  id: string;
  revision: number;
  createdAt: number;
  expiresAt: number | null;
  /** Set while hover-paused; the countdown resumes from here. */
  remainingMs: number | null;
  /** An action is running; buttons render disabled and repeat activation is ignored. */
  busy: boolean;
};

export interface NoticeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const NOTICE_DURATION_MS = {
  receipt: 3500,
  receiptWithAction: 7000,
  notice: 10000,
  alert: 10000,
} as const;
export const NOTICE_MAX_VISIBLE = 3;
export const NOTICE_STAGGER_MS = 40;

const realClock: NoticeClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let clock: NoticeClock = realClock;
let notices: readonly Notice[] = [];
let seq = 0;
const revisions = new Map<string, number>();
const timers = new Map<string, unknown>();
const listeners = new Set<() => void>();

function emit(next: readonly Notice[]): void {
  notices = next;
  listeners.forEach((listener) => listener());
}

function clearTimer(id: string): void {
  if (!timers.has(id)) return;
  clock.clearTimeout(timers.get(id));
  timers.delete(id);
}

function schedule(id: string, ms: number): void {
  clearTimer(id);
  timers.set(
    id,
    clock.setTimeout(() => dismissNotice(id, "timeout"), ms)
  );
}

/** Recovered words are content at risk: whatever kind the caller asked for, they make an alert. */
function normalize(input: NoticeInput): NoticeInput {
  if (input.words && input.kind !== "alert") return { ...input, kind: "alert" } as NoticeInput;
  return input;
}

export function noticeLifetimeMs(input: NoticeInput): number | null {
  if (input.persistent) return null;
  if (input.kind === "alert" && input.words) return null;
  if (input.kind === "receipt" && input.actions?.length) return NOTICE_DURATION_MS.receiptWithAction;
  return NOTICE_DURATION_MS[input.kind];
}

function remove(target: Notice, reason: NoticeRemoval): void {
  clearTimer(target.id);
  emit(notices.filter((n) => n !== target));
  target.onDismiss?.(reason);
}

export function notify(raw: NoticeInput): string {
  const input = normalize(raw);
  const id = input.id ?? `notice-${++seq}`;
  const revision = (revisions.get(id) ?? 0) + 1;
  revisions.set(id, revision);
  const previous = notices.find((n) => n.id === id);
  const lifetime = noticeLifetimeMs(input);
  const now = clock.now();
  const notice = {
    ...input,
    id,
    revision,
    createdAt: now,
    expiresAt: lifetime === null ? null : now + lifetime,
    remainingMs: null,
    busy: false,
  } as Notice;
  let next = [...notices.filter((n) => n.id !== id), notice];
  const evicted: Notice[] = [];
  // Over the cap, the oldest notice that may expire leaves first. Persistent
  // notices queue (visibleNotices shows the newest three).
  while (next.length > NOTICE_MAX_VISIBLE) {
    const victim = next.find((n) => n.expiresAt !== null && n.id !== id);
    if (!victim) break;
    clearTimer(victim.id);
    evicted.push(victim);
    next = next.filter((n) => n !== victim);
  }
  if (lifetime === null) clearTimer(id);
  else schedule(id, lifetime);
  emit(next);
  previous?.onDismiss?.("replaced");
  evicted.forEach((n) => n.onDismiss?.("evicted"));
  return id;
}

export function dismissNotice(id: string, reason: NoticeRemoval = "user"): void {
  const target = notices.find((n) => n.id === id);
  if (target) remove(target, reason);
}

function replace(target: Notice, patch: Partial<Notice>): void {
  emit(notices.map((n) => (n === target ? ({ ...n, ...patch } as Notice) : n)));
}

export function pauseNotice(id: string): void {
  const n = notices.find((x) => x.id === id);
  if (!n || n.expiresAt === null || n.remainingMs !== null) return;
  clearTimer(id);
  replace(n, { remainingMs: Math.max(0, n.expiresAt - clock.now()) });
}

export function resumeNotice(id: string): void {
  const n = notices.find((x) => x.id === id);
  if (!n || n.remainingMs === null) return;
  const ms = n.remainingMs;
  replace(n, { remainingMs: null, expiresAt: clock.now() + ms });
  schedule(id, ms);
}

/**
 * Runs an action against the revision that was on screen when it was
 * pressed. Only that revision is dismissed afterwards: an action that
 * publishes a replacement under the same id (a failed retry explaining
 * itself) keeps the replacement on screen.
 */
export async function runNoticeAction(id: string, action: NoticeAction): Promise<void> {
  const started = notices.find((n) => n.id === id);
  if (!started || started.busy) return;
  replace(started, { busy: true });
  try {
    await action.onClick();
  } finally {
    const current = notices.find((n) => n.id === id);
    if (current && current.revision === started.revision) {
      if (action.keepOpen) replace(current, { busy: false });
      else remove(current, "action");
    }
  }
}

export function visibleNotices(list: readonly Notice[]): Notice[] {
  return list.slice(-NOTICE_MAX_VISIBLE);
}

/** Position within a burst of notices that arrived inside one stagger window. */
export function staggerIndex(list: readonly Notice[], id: string): number {
  const visible = visibleNotices(list);
  const at = visible.findIndex((n) => n.id === id);
  if (at < 0) return 0;
  let index = 0;
  for (let i = at; i > 0; i -= 1) {
    if (visible[i].createdAt - visible[i - 1].createdAt > NOTICE_STAGGER_MS) break;
    index += 1;
  }
  return Math.min(index, NOTICE_MAX_VISIBLE - 1);
}

export function getNotices(): readonly Notice[] {
  return notices;
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotices(): readonly Notice[] {
  return useSyncExternalStore(subscribeNotices, getNotices, getNotices);
}

/** Test seam: swap the clock and clear all state. Call with no argument to restore. */
export function __setNoticeClockForTests(next?: NoticeClock): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  clock = next ?? realClock;
  notices = [];
  seq = 0;
  revisions.clear();
}
```

The `replace(started, { busy: true })` call above swaps in a new object, so the `started` reference used for the revision check is the pre-busy snapshot. The comparison uses `revision`, never object identity, so this is correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/notices.test.js test/components/rtlMotion.test.js`
Expected: PASS. `rtlMotion` still imports `Toast`, and must stay green until Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/notices.ts src/components/ui/TechnicalErrorDetails.tsx src/components/ui/useToast.ts test/components/notices.test.js
git commit -m "feat(voice): notice store with typed content, revisions and removal reasons"
```

---

### Task 2: Main-owned temporary hotkey leases

Covers review finding I7. ⌥Z (undo cancel), ⌥↵ (paste again) and ⌥⌘M (start meeting notes) are global shortcuts held only while their affordance is on screen. React cleanup must not be the only release path. A renderer that reloads, crashes or navigates releases its leases in main. A registration that resolves after it was released is undone. Registration is serialised per slot, so a late result can never unregister a newer lease. The UI shows a shortcut only when main reports it **held**.

**Files:**
- Create: `src/helpers/hotkeyLeases.js` (main, CommonJS)
- Modify: `src/helpers/hotkeyManager.js`:
  - add `isTemporarySlot(slotName)`;
  - use it where the code special-cases `"cancel"` today: the multi-hotkey log (line 215), the KDE branch (line 269) and `unregisterSlot` (line 343).
  
  Temporary slots therefore always go through `globalShortcut`, never KGlobalAccel, which persists across crashes (the comment at lines 269–271).
- Modify: `src/helpers/ipcHandlers.js`. Add `acquire-pill-hotkey` and `release-pill-hotkey` next to `register-cancel-hotkey` (lines 3510–3521), plus a once-per-webContents owner watch.
- Modify: `src/helpers/windowManager.js`. In the constructor, add `this.hotkeyLeases = createHotkeyLeases({ hotkeyManager: this.hotkeyManager })`. In `mainWindow.on("closed")` (lines 2016–2020), add `this.hotkeyLeases.releaseOwner(<the closed window's webContents id>)`. Capture `const ownerId = this.mainWindow.webContents.id` when the window is created.
- Modify: `preload.js`, `src/types/electron.ts`, `src/preview/browserPreview.ts`
- Create: `src/hooks/usePillHotkey.ts`
- Test: `test/helpers/hotkeyLeases.test.js`

**Interfaces:**
- Produces (main):

  ```js
  // src/helpers/hotkeyLeases.js
  const PILL_HOTKEY_ACCELERATORS = { undoCancel: "Alt+Z", noticePrimary: "Alt+Enter", meetingAccept: "CommandOrControl+Alt+M" };
  const LEASE_MAX_TTL_MS = { undoCancel: 120_000, noticePrimary: 60_000, meetingAccept: 120_000 };
  createHotkeyLeases({ hotkeyManager, setTimer?, clearTimer? }): {
    acquire({ slot, ownerId, ttlMs?, onPress, onRelease? }): Promise<{ leaseId: number; held: boolean; reason?: "released" | "conflict" | "error" }>;
    // onRelease(reason: "released" | "ttl" | "superseded" | "owner") runs once when a lease that was acquired ends, whoever ended it.
    release(leaseId: number, ownerId?: string | number): void;   // ownerId, when given, must match
    releaseOwner(ownerId: string | number): void;
    isHeld(leaseId: number): boolean;
  }
  ```

  Main-process code such as the meeting prompt (Task 18) acquires with `ownerId: "main:meeting-prompt"`.
- Produces (renderer):

  ```ts
  export type PillHotkeySlot = "undoCancel" | "noticePrimary";
  export function usePillHotkey(slot: PillHotkeySlot, enabled: boolean, onPress: () => void, options?: { ttlMs?: number }): { held: boolean };
  // electronAPI
  acquirePillHotkey?: (slot: PillHotkeySlot, options?: { ttlMs?: number }) => Promise<{ leaseId: number; held: boolean; reason?: string }>;
  onPillHotkeyReleased?: (callback: (released: { slot: PillHotkeySlot; leaseId: number }) => void) => () => void;
  releasePillHotkey?: (leaseId: number) => Promise<void>;
  onPillHotkeyPressed?: (cb: (press: { slot: PillHotkeySlot; leaseId: number }) => void) => () => void;
  ```

  The renderer never chooses the accelerator; main owns the table.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/hotkeyLeases.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();
const { createHotkeyLeases } = require("../../src/helpers/hotkeyLeases.js");

function fakeManager() {
  const registered = new Map();
  const log = [];
  const pending = [];
  return {
    log,
    registered,
    // Each registration resolves only when the test says so (KDE/GNOME await).
    registerSlot(slot, accelerator, callback) {
      log.push(`+${slot}:${accelerator}`);
      return new Promise((resolve) => {
        pending.push((ok = true) => {
          if (ok) registered.set(slot, callback);
          resolve(ok ? { success: true } : { success: false, reason: "conflict" });
        });
      });
    },
    unregisterSlot(slot) {
      log.push(`-${slot}`);
      registered.delete(slot);
    },
    settle(ok = true) {
      pending.shift()(ok);
    },
    pendingCount: () => pending.length,
  };
}

function fakeTimers() {
  let seq = 0;
  const timers = new Map();
  const delays = [];
  return {
    delays,
    setTimer: (fn, ms) => (delays.push(ms), timers.set(++seq, fn), seq),
    clearTimer: (id) => timers.delete(id),
    fireAll: () => [...timers.values()].forEach((fn) => fn()),
  };
}

const tick = () => new Promise((r) => setImmediate(r));

test("a lease is held only after main registers it, and the accelerator is main's", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const p = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  hm.settle();
  const r = await p;
  assert.equal(r.held, true);
  assert.deepEqual(hm.log, ["+temp:undoCancel:Alt+Z"]);
  assert.equal(leases.isHeld(r.leaseId), true);
});

test("released while registration is pending: the late registration is undone", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const p = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  leases.release(1); // lease ids start at 1; the renderer releases on unmount before the answer
  hm.settle(); // KDE/GNOME answer arrives after the release
  const r = await p;
  await tick();
  assert.equal(r.held, false);
  assert.equal(r.reason, "released");
  assert.equal(hm.registered.has("temp:undoCancel"), false);
});

test("a newer lease for the same slot is never unregistered by an older late result", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const first = leases.acquire({ slot: "noticePrimary", ownerId: 7, onPress() {} });
  const second = leases.acquire({ slot: "noticePrimary", ownerId: 7, onPress() {} });
  await tick();
  // The superseded first lease never reaches the backend; only the second registers.
  assert.equal(hm.pendingCount(), 1);
  hm.settle();
  assert.equal((await first).held, false);
  assert.equal((await second).held, true);
  assert.equal(hm.registered.has("temp:noticePrimary"), true);
});

test("the owner's renderer going away releases every lease it holds", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const a = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  hm.settle();
  const b = leases.acquire({ slot: "noticePrimary", ownerId: 7, onPress() {} });
  await tick();
  hm.settle();
  await Promise.all([a, b]);
  leases.releaseOwner(7);
  await tick();
  assert.equal(hm.registered.size, 0);
});

test("ttl is enforced by main and clamped per slot", async () => {
  const hm = fakeManager();
  const timers = fakeTimers();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...timers });
  const released = [];
  const p = leases.acquire({ slot: "noticePrimary", ownerId: 7, ttlMs: 10 * 60_000, onPress() {}, onRelease: (r) => released.push(r) });
  await tick();
  hm.settle();
  await p;
  assert.deepEqual(timers.delays, [60_000], "a ten-minute request is clamped to the slot's maximum");
  timers.fireAll();
  await tick();
  assert.equal(hm.registered.has("temp:noticePrimary"), false);
  assert.deepEqual(released, ["ttl"], "the owner is told, so the UI stops showing ⌥↵");
});

test("a superseded or owner-lost lease tells its owner exactly once", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const released = [];
  const first = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {}, onRelease: (r) => released.push(["a", r]) });
  await tick();
  hm.settle();
  await first;
  const second = leases.acquire({ slot: "undoCancel", ownerId: 8, onPress() {}, onRelease: (r) => released.push(["b", r]) });
  await tick();
  hm.settle();
  await second;
  leases.releaseOwner(8);
  leases.releaseOwner(8);
  assert.deepEqual(released, [["a", "superseded"], ["b", "owner"]]);
});

test("a conflict reports not held, so the UI hides the shortcut", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const p = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  hm.settle(false);
  const r = await p;
  assert.equal(r.held, false);
  assert.equal(r.reason, "conflict");
});

test("a press is delivered only while the lease is live; another owner cannot release it", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  let presses = 0;
  const p = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress: () => presses++ });
  await tick();
  hm.settle();
  const { leaseId } = await p;
  leases.release(leaseId, 99);
  hm.registered.get("temp:undoCancel")();
  assert.equal(presses, 1);
  leases.release(leaseId, 7);
  assert.equal(leases.isHeld(leaseId), false);
});

test("temporary slots never go to KGlobalAccel on KDE", async () => {
  const { default: HotkeyManagerMaybe, ...rest } = require("../../src/helpers/hotkeyManager.js");
  const HotkeyManager = HotkeyManagerMaybe ?? rest.HotkeyManager ?? require("../../src/helpers/hotkeyManager.js");
  const kdeCalls = [];
  const manager = Object.assign(Object.create(HotkeyManager.prototype), {
    useKDE: true,
    kdeManager: { registerKeybinding: async () => kdeCalls.push("kde") },
    slots: new Map(),
    setupShortcuts: () => ({ success: true }),
  });
  await manager.registerSlot("temp:undoCancel", "Alt+Z", () => {});
  assert.deepEqual(kdeCalls, []);
  assert.equal(HotkeyManager.prototype.isTemporarySlot.call(manager, "cancel"), true);
  assert.equal(HotkeyManager.prototype.isTemporarySlot.call(manager, "temp:meetingAccept"), true);
  assert.equal(HotkeyManager.prototype.isTemporarySlot.call(manager, "dictation"), false);
});
```

`hotkeyManager.js` exports its class in some shape. Check it first (`grep -n "module.exports" src/helpers/hotkeyManager.js`), and simplify the first two lines of the last test to that one form. If `registerSlot` touches more prototype state on the default branch (`_ensureSlot`, `_findSlotConflict`), add those fields to the `Object.assign` object. Keep the assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/hotkeyLeases.test.js`
Expected: FAIL with `Cannot find module '…/hotkeyLeases.js'`.

- [ ] **Step 3: Implement the lease module**

`src/helpers/hotkeyLeases.js`:

```js
// Temporary global shortcuts (⌥Z undo, ⌥↵ paste again, ⌥⌘M start notes) are
// leased, not registered. Main owns the accelerator table, the lifetime and
// the release: a lease ends when its owner releases it, when its TTL runs
// out, or when the owning renderer goes away. Registration is serialised per
// slot so a late answer from an async backend can never undo a newer lease.
const PILL_HOTKEY_ACCELERATORS = {
  undoCancel: "Alt+Z",
  noticePrimary: "Alt+Enter",
  meetingAccept: "CommandOrControl+Alt+M",
};
const LEASE_MAX_TTL_MS = { undoCancel: 120_000, noticePrimary: 60_000, meetingAccept: 120_000 };

function createHotkeyLeases({ hotkeyManager, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let seq = 0;
  const leases = new Map(); // leaseId -> lease
  const current = new Map(); // slot -> leaseId
  const queues = new Map(); // slot -> Promise (serialises register/unregister)

  const slotName = (slot) => `temp:${slot}`;
  const enqueue = (slot, op) => {
    const next = (queues.get(slot) ?? Promise.resolve()).then(op, op);
    queues.set(slot, next.catch(() => {}));
    return next;
  };

  function release(leaseId, ownerId, reason = "released") {
    const lease = leases.get(leaseId);
    if (!lease || !lease.active) return;
    if (ownerId !== undefined && lease.ownerId !== ownerId) return;
    lease.active = false;
    if (lease.timer) clearTimer(lease.timer);
    leases.delete(leaseId);
    try {
      lease.onRelease?.(reason);
    } catch {
      // A failed notification must not keep the shortcut registered.
    }
    if (current.get(lease.slot) === leaseId) {
      current.delete(lease.slot);
      void enqueue(lease.slot, () => {
        // Only unregister if no newer lease took the slot meanwhile.
        if (!current.has(lease.slot)) hotkeyManager.unregisterSlot(slotName(lease.slot));
      });
    }
  }

  async function acquire({ slot, ownerId, ttlMs, onPress, onRelease }) {
    const accelerator = PILL_HOTKEY_ACCELERATORS[slot];
    if (!accelerator) return { leaseId: 0, held: false, reason: "error" };
    const previous = current.get(slot);
    if (previous) release(previous, undefined, "superseded");
    const leaseId = ++seq;
    const lease = { leaseId, slot, ownerId, onRelease, active: true, held: false, timer: null };
    leases.set(leaseId, lease);
    current.set(slot, leaseId);
    const ttl = Math.min(Number(ttlMs) > 0 ? Number(ttlMs) : LEASE_MAX_TTL_MS[slot], LEASE_MAX_TTL_MS[slot]);
    lease.timer = setTimer(() => release(leaseId, undefined, "ttl"), ttl);

    return enqueue(slot, async () => {
      if (!lease.active) return { leaseId, held: false, reason: "released" };
      let ok = false;
      let reason = "error";
      try {
        const result = await hotkeyManager.registerSlot(slotName(slot), accelerator, () => {
          if (lease.active) onPress();
        });
        ok = result?.success !== false;
        if (!ok) reason = result?.reason === "conflict" || result?.error ? "conflict" : "error";
      } catch {
        ok = false;
      }
      if (!lease.active) {
        // Released while the backend was answering: undo a late success,
        // unless a newer lease already owns the slot.
        if (ok && !current.has(slot)) hotkeyManager.unregisterSlot(slotName(slot));
        return { leaseId, held: false, reason: "released" };
      }
      lease.held = ok;
      return ok ? { leaseId, held: true } : { leaseId, held: false, reason };
    });
  }

  function releaseOwner(ownerId) {
    for (const lease of [...leases.values()]) if (lease.ownerId === ownerId) release(lease.leaseId, undefined, "owner");
  }

  return {
    acquire,
    release,
    releaseOwner,
    isHeld: (leaseId) => Boolean(leases.get(leaseId)?.active && leases.get(leaseId)?.held),
  };
}

module.exports = { createHotkeyLeases, PILL_HOTKEY_ACCELERATORS, LEASE_MAX_TTL_MS };
```

In the "newer lease" test, the superseded first lease's queued registration runs with `lease.active === false`, so it returns `released` without registering. The second lease registers. This is why `acquire` checks `lease.active` before calling the backend.

- [ ] **Step 4: Temporary slots in `hotkeyManager.js`**

Add this method to the class:

```js
  // Temporary slots live only while an on-screen affordance shows. They stay
  // on globalShortcut on every desktop: a KGlobalAccel binding would outlive
  // a crash (see the KDE branch comment).
  isTemporarySlot(slotName) {
    return slotName === "cancel" || String(slotName).startsWith("temp:");
  }
```

Replace the three `slotName !== "cancel"` conditions (lines 215, 269 and 343) with `!this.isTemporarySlot(slotName)`. `LINUX_NATIVE_TAP_SLOTS` never contains `temp:*`, so the GNOME and Hyprland branches already skip them.

- [ ] **Step 5: IPC, owner watch and preload**

`src/helpers/ipcHandlers.js`, after the `unregister-cancel-hotkey` handler (line 3521):

```js
    const watchedLeaseOwners = new WeakSet();
    const watchLeaseOwner = (contents) => {
      if (watchedLeaseOwners.has(contents)) return;
      watchedLeaseOwners.add(contents);
      const id = contents.id;
      const releaseAll = () => {
        this.windowManager.hotkeyLeases.releaseOwner(id);
        // The Escape slot is registered by the same renderer (Task 9); it goes with it.
        if (this._cancelHotkeyOwnerId === id) {
          this._cancelHotkeyOwnerId = null;
          this.windowManager.hotkeyManager.unregisterSlot("cancel");
        }
      };
      contents.once("destroyed", releaseAll);
      contents.on("render-process-gone", releaseAll);
      contents.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) releaseAll();
      });
    };

    ipcMain.handle("acquire-pill-hotkey", async (event, slot, options = {}) => {
      if (slot !== "undoCancel" && slot !== "noticePrimary") return { leaseId: 0, held: false, reason: "error" };
      const mainWindow = this.windowManager.mainWindow;
      if (!mainWindow || event.sender !== mainWindow.webContents) return { leaseId: 0, held: false, reason: "error" };
      watchLeaseOwner(event.sender);
      const contents = event.sender;
      const current = { leaseId: 0 };
      return this.windowManager.hotkeyLeases.acquire({
        slot,
        ownerId: contents.id,
        ttlMs: Number(options?.ttlMs) || undefined,
        onPress: () => {
          if (!contents.isDestroyed()) contents.send("pill-hotkey-pressed", { slot, leaseId: current.leaseId });
        },
        onRelease: () => {
          if (!contents.isDestroyed()) contents.send("pill-hotkey-released", { slot, leaseId: current.leaseId });
        },
      }).then((result) => {
        current.leaseId = result.leaseId;
        return result;
      });
    });

    ipcMain.handle("release-pill-hotkey", (event, leaseId) => {
      this.windowManager.hotkeyLeases.release(Number(leaseId), event.sender.id);
    });
```

`current` is per call, so a press or release is tagged with the lease it belongs to. A release that fires before `acquire` resolves carries `leaseId: 0`; the hook ignores it, and `acquire` then reports `held: false` with reason `released`. The navigation listener uses the same `details` shape as `meetingTranscriptionLifecycle.js:17-28`.

The Escape slot needs the same owner watch, even when no lease was ever taken (finding 17). Move `watchedLeaseOwners` / `watchLeaseOwner` above the `register-cancel-hotkey` handler (line 3510), and change that handler and its pair to:

```js
    ipcMain.handle("register-cancel-hotkey", async (event, key) => {
      const hotkeyManager = this.windowManager.hotkeyManager;
      const mainWindow = this.windowManager.mainWindow;
      watchLeaseOwner(event.sender);
      this._cancelHotkeyOwnerId = event.sender.id;
      return hotkeyManager.registerSlot("cancel", key, () => {
        mainWindow?.webContents?.send("cancel-hotkey-pressed");
      });
    });

    ipcMain.handle("unregister-cancel-hotkey", async () => {
      this._cancelHotkeyOwnerId = null;
      this.windowManager.hotkeyManager.unregisterSlot("cancel");
      return { success: true };
    });
```

`preload.js`, after `unregisterCancelHotkey` (line 543):

```js
  acquirePillHotkey: (slot, options) => ipcRenderer.invoke("acquire-pill-hotkey", slot, options),
  releasePillHotkey: (leaseId) => ipcRenderer.invoke("release-pill-hotkey", leaseId),
  onPillHotkeyPressed: registerListener("pill-hotkey-pressed", (callback) => (_event, press) => callback(press)),
  onPillHotkeyReleased: registerListener("pill-hotkey-released", (callback) => (_event, released) => callback(released)),
```

Add the types from the Interfaces block to `src/types/electron.ts`, inside the `electronAPI` interface next to `registerCancelHotkey`. Add no-op stubs to `src/preview/browserPreview.ts`: `acquirePillHotkey: async () => ({ leaseId: 0, held: false })`, `releasePillHotkey: async () => {}`, `onPillHotkeyPressed: () => () => {}` and `onPillHotkeyReleased: () => () => {}`.

`src/hooks/usePillHotkey.ts`:

```ts
import { useEffect, useRef, useState } from "react";

export type PillHotkeySlot = "undoCancel" | "noticePrimary";

/**
 * Leases a global shortcut from main while `enabled`. `held` is what main
 * reports; show the shortcut only when it is true (the accelerator may be
 * taken by another app). Main also releases the lease if this renderer goes
 * away, and enforces the TTL even if this component never unmounts.
 */
export function usePillHotkey(
  slot: PillHotkeySlot,
  enabled: boolean,
  onPress: () => void,
  options: { ttlMs?: number } = {}
): { held: boolean } {
  const [held, setHeld] = useState(false);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const ttlMs = options.ttlMs;

  useEffect(() => {
    if (!enabled) return;
    const api = window.electronAPI;
    let leaseId = 0;
    let disposed = false;
    const off = api?.onPillHotkeyPressed?.((press) => {
      if (press.slot === slot && press.leaseId === leaseId) onPressRef.current();
    });
    // Main ended the lease (TTL, a newer lease, a crash elsewhere): stop showing the shortcut.
    const offReleased = api?.onPillHotkeyReleased?.((released) => {
      if (released.slot === slot && released.leaseId === leaseId) {
        leaseId = 0;
        setHeld(false);
      }
    });
    void api?.acquirePillHotkey?.(slot, { ttlMs }).then((result) => {
      if (disposed) {
        void api?.releasePillHotkey?.(result.leaseId);
        return;
      }
      leaseId = result.leaseId;
      setHeld(result.held);
    });
    return () => {
      disposed = true;
      off?.();
      offReleased?.();
      setHeld(false);
      if (leaseId) void api?.releasePillHotkey?.(leaseId);
    };
  }, [slot, enabled, ttlMs]);

  return { held };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- test/helpers/hotkeyLeases.test.js`
Expected: PASS. Also run the existing hotkey suites: `npm test -- "test/helpers/hotkey*.test.js"`.

- [ ] **Step 7: Commit**

```bash
git add src/helpers/hotkeyLeases.js src/helpers/hotkeyManager.js src/helpers/ipcHandlers.js src/helpers/windowManager.js preload.js src/types/electron.ts src/preview/browserPreview.ts src/hooks/usePillHotkey.ts test/helpers/hotkeyLeases.test.js
git commit -m "feat(voice): main-owned leases for temporary global shortcuts"
```

---

### Task 3: Notice chips, the words-first card and the pill notice slot

Covers VO-R14 B and VO-R6 B (the card), and carries Plan 02's VO-Q9 rules forward. Also closes I11: every action stays reachable, because a chip with more than one action gets an accessible "More" disclosure.

**Files:**
- Create: `src/components/ui/NoticeChip.tsx`
- Create: `src/components/ui/WordsFirstCard.tsx`
- Create: `src/components/ui/NoticeStack.tsx`
- Create: `src/styles/notices.css`. Add `@import "./styles/notices.css";` to `src/index.css`, directly after `@import "./styles/dictation-panel.css";` at line 3.
- Modify: `src/utils/windowSizeLadder.js`
- Modify: `src/helpers/windowConfig.js:139-157` (add `WITH_NOTICES`)
- Modify: `src/hooks/useMainWindowSizeOwner.js`. Rename the inputs `toastCount` and `dictationErrorActionCount` to `noticeCount` and `wordsCardVisible`.
- Modify: `src/App.jsx`. Mount the pill stack and feed the ladder.
- Modify: `src/AppRouter.jsx:64-78`. Mount the panel stack in the control-panel branch, so it covers both onboarding and the main view.
- Modify: `src/locales/*/translation.json`. Add a top-level `"notices"` object.
- Modify: `DESIGN.md`. Add a `### Notices` section after `### Voice Pill`.
- Test: `test/components/noticeStack.test.js`
- Test: `test/helpers/windowSizeLadder.test.js`. This file already exists; update it in Step 1.

**Interfaces:**
- Consumes everything from Task 1, and `usePillHotkey` (Task 2).
- Produces:

  ```tsx
  export function NoticeStack(props: { placement: "pill" | "panel"; horizontalDirection?: "left" | "right"; primaryHotkeyLabel?: string | null }): JSX.Element | null;
  export function NoticeChip(props: { notice: Notice; stagger: number; defaultExpanded?: boolean }): JSX.Element;
  export function WordsFirstCard(props: { notice: Notice; onHeight?: (px: number) => void; hotkeyLabel?: string | null }): JSX.Element;
  export function useNoticeWindowState(): { noticeCount: number; wordsCardVisible: boolean };
  ```

  ```js
  // windowSizeLadder.js
  resolveMainWindowSizeKey({ panelOpen, menuOpen, noticeCount, compactPill, wordsCardVisible }): string
  ```

  The new size key is `WITH_NOTICES` = `{ width: 400, height: 168 }`.

- [ ] **Step 1: Write the failing tests**

Create `test/components/noticeStack.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const notices = () => import("../../src/components/ui/notices.ts");

const base = { createdAt: 0, expiresAt: null, remainingMs: null, revision: 1, busy: false };

test("receipts and notices are polite status chips; alerts are role=alert", async () => {
  const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
  const receipt = renderStatic(NoticeChip, { notice: { ...base, id: "a", kind: "receipt", title: "Pasted", body: "into Slack" }, stagger: 0 });
  const alert = renderStatic(NoticeChip, {
    notice: { ...base, id: "b", kind: "alert", title: "Couldn't paste into Slack", actions: [{ label: "Retry", primary: true, onClick() {} }] },
    stagger: 1,
  });
  assert.match(receipt, /role="status"/);
  assert.match(receipt, /data-kind="receipt"/);
  assert.match(alert, /role="alert"/);
  assert.match(alert, />Retry</);
  assert.match(alert, /--notice-stagger:1/);
});

test("every chip has a visible, labelled close button (VO-Q9)", async () => {
  const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
  const html = renderStatic(NoticeChip, { notice: { ...base, id: "c", kind: "notice", title: "Model changed", persistent: true }, stagger: 0 });
  assert.match(html, /<button[^>]*class="notice-chip__close"[^>]*aria-label="[^"]+"/);
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/notices.css"), "utf8");
  assert.doesNotMatch(css, /\.notice-chip__close\s*\{[^}]*opacity:\s*0[;\s]/);
});

test("every action stays reachable: secondary actions sit behind an accessible More (I11)", async () => {
  const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
  const notice = {
    ...base, id: "cleanup-failed", kind: "notice", title: "Pasted without cleanup",
    actions: [{ label: "Retry cleanup", primary: true, onClick() {} }, { label: "Settings", onClick() {} }],
  };
  const collapsed = renderStatic(NoticeChip, { notice, stagger: 0 });
  assert.match(collapsed, />Retry cleanup</);
  assert.match(collapsed, /<button[^>]*class="notice-chip__more"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(collapsed, />Settings</);
  const expanded = renderStatic(NoticeChip, { notice, stagger: 0, defaultExpanded: true });
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /role="group"[^>]*>.*>Settings</s);
  const single = renderStatic(NoticeChip, { notice: { ...notice, actions: [notice.actions[0]] }, stagger: 0 });
  assert.doesNotMatch(single, /notice-chip__more/);
});

test("buttons are disabled while the notice's action is running", async () => {
  const { NoticeChip } = await import("../../src/components/ui/NoticeChip.tsx");
  const html = renderStatic(NoticeChip, {
    notice: { ...base, id: "x", kind: "alert", title: "Couldn't paste", busy: true, actions: [{ label: "Retry", primary: true, onClick() {} }] },
    stagger: 0,
  });
  assert.match(html, /<button[^>]*class="notice-chip__action"[^>]*disabled=""/);
});

test("the words-first card shows the words as the headline, selectable and draggable", async () => {
  const { WordsFirstCard } = await import("../../src/components/ui/WordsFirstCard.tsx");
  const html = renderStatic(WordsFirstCard, {
    notice: {
      ...base,
      id: "dictation-error",
      kind: "alert",
      title: "Couldn't paste into Slack",
      words: "Hey Maya, can you move the design review to Thursday at 2?",
      actions: [{ label: "Paste again", primary: true, onClick() {} }],
    },
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /class="words-card__words"[^>]*draggable="true"/);
  assert.match(html, /Hey Maya, can you move the design review/);
  assert.match(html, />Paste again</);
  assert.match(html, /data-copy=""/);
});

test("the stack shows at most three chips; a words card owns the pill slot", async (t) => {
  const m = await notices();
  m.__setNoticeClockForTests();
  t.after(() => m.__setNoticeClockForTests());
  for (const title of ["one", "two", "three", "four"]) m.notify({ kind: "notice", title, persistent: true });
  const { NoticeStack } = await import("../../src/components/ui/NoticeStack.tsx");
  const chipsOnly = renderStatic(NoticeStack, { placement: "pill", horizontalDirection: "right" });
  assert.equal((chipsOnly.match(/class="notice-chip"/g) || []).length, 3);
  assert.match(chipsOnly, /data-placement="pill"/);

  m.notify({ kind: "alert", title: "Couldn't paste", words: "keep me" });
  const pill = renderStatic(NoticeStack, { placement: "pill", horizontalDirection: "right" });
  assert.match(pill, /class="words-card"/);
  // In the 168px pill slot the card owns the space; chips wait until it is dismissed.
  assert.equal((pill.match(/class="notice-chip"/g) || []).length, 0);
  const panel = renderStatic(NoticeStack, { placement: "panel" });
  assert.match(panel, /class="words-card"/);
  assert.equal((panel.match(/class="notice-chip"/g) || []).length, 3);
});

test("chip CSS uses the motion tokens and no ease-in", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/notices.css"), "utf8");
  assert.match(css, /animation:\s*notice-in var\(--motion-base\) var\(--motion-ease-enter\)/);
  assert.match(css, /animation-delay:\s*calc\(var\(--notice-stagger\) \* 40ms\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.notice-chip[\s\S]*transform:\s*none/);
});

```

Update the existing `test/helpers/windowSizeLadder.test.js`:
- In every `resolveMainWindowSizeKey({...})` call, and in the ladder-domain loop, rename `toastCount` to `noticeCount` and `dictationErrorActionCount` (a count) to `wordsCardVisible` (a boolean: `> 0` becomes `true`).
- Retitle "a toast outranks the listening pill so both fit" to "notices outrank the listening pill so both fit", and expect `"WITH_NOTICES"` wherever it expected `"WITH_TOAST"`.
- Leave the `DICTATION_ERROR` geometry tests alone until Task 5.

Then append:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/windowSizeLadder.js");

test("notices grow the pill window to WITH_NOTICES, below menus and panels", async () => {
  const { resolveMainWindowSizeKey } = await load();
  assert.equal(resolveMainWindowSizeKey({ noticeCount: 1 }), "WITH_NOTICES");
  assert.equal(resolveMainWindowSizeKey({ noticeCount: 1, menuOpen: true }), "EXPANDED");
  assert.equal(resolveMainWindowSizeKey({ noticeCount: 2, panelOpen: true }), "ASSISTANT");
  assert.equal(resolveMainWindowSizeKey({ noticeCount: 0, compactPill: true }), "RECORDING");
});

test("a words card takes the transcript-height error slot", async () => {
  const { resolveMainWindowSizeKey } = await load();
  assert.equal(resolveMainWindowSizeKey({ wordsCardVisible: true, noticeCount: 1 }), "DICTATION_ERROR_WITH_TRANSCRIPT");
});

test("WITH_NOTICES fits three 32px chips with 6px gaps above the dock inset", () => {
  // Read as text: windowConfig.js is a main-process module.
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../src/helpers/windowConfig.js"), "utf8");
  const match = src.match(/WITH_NOTICES:\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}/);
  assert.ok(match, "WITH_NOTICES is declared in WINDOW_SIZES");
  assert.equal(Number(match[1]), 400);
  assert.ok(Number(match[2]) >= 3 * 32 + 2 * 6 + 12 + 40);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/components/noticeStack.test.js test/helpers/windowSizeLadder.test.js`
Expected: FAIL. `NoticeChip.tsx` is not found, and `resolveMainWindowSizeKey({ noticeCount: 1 })` returns `"BASE"`.

- [ ] **Step 3: Implement the chip, card and stack**

`src/components/ui/NoticeChip.tsx`:

```tsx
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Info, X } from "../icons";
import { dismissNotice, pauseNotice, resumeNotice, runNoticeAction, type Notice } from "./notices";

const ICONS = { receipt: Check, notice: Info, alert: AlertTriangle } as const;

/**
 * One 32px line per message (VO-R14 B): icon, title, muted body, the primary
 * action inline, then "More" when there are other actions, then close. "More"
 * expands the chip in place with every other action (I11), so a notice never
 * hides an action its sender relies on.
 */
export function NoticeChip({
  notice,
  stagger,
  defaultExpanded = false,
}: {
  notice: Notice;
  stagger: number;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = ICONS[notice.kind];
  const actions = notice.actions ?? [];
  const primary = actions.find((a) => a.primary) ?? actions[0];
  const secondary = actions.filter((a) => a !== primary);
  const moreId = `notice-more-${notice.id}`;
  return (
    <div
      className="notice-chip"
      data-kind={notice.kind}
      data-expanded={expanded ? "true" : undefined}
      role={notice.kind === "alert" ? "alert" : "status"}
      aria-live={notice.kind === "alert" ? "assertive" : "polite"}
      style={{ "--notice-stagger": stagger } as CSSProperties}
      onMouseEnter={() => pauseNotice(notice.id)}
      onMouseLeave={() => resumeNotice(notice.id)}
    >
      <div className="notice-chip__row">
        <span className="notice-chip__icon" aria-hidden="true">
          <Icon size={12} />
        </span>
        <b className="notice-chip__title">{notice.title}</b>
        {notice.body ? <span className="notice-chip__body">{notice.body}</span> : null}
        {primary ? (
          <button
            type="button"
            className="notice-chip__action"
            disabled={notice.busy}
            onClick={() => void runNoticeAction(notice.id, primary)}
          >
            {primary.label}
          </button>
        ) : null}
        {secondary.length > 0 ? (
          <button
            type="button"
            className="notice-chip__more"
            aria-expanded={expanded ? "true" : "false"}
            aria-controls={moreId}
            aria-label={t("notices.moreActions")}
            onClick={() => setExpanded((v) => !v)}
          >
            ⋯
          </button>
        ) : null}
        <button
          type="button"
          className="notice-chip__close"
          aria-label={t("notices.dismiss")}
          onClick={() => dismissNotice(notice.id)}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {expanded && secondary.length > 0 ? (
        <div id={moreId} className="notice-chip__more-actions" role="group" aria-label={t("notices.moreActions")}>
          {secondary.map((action) => (
            <button
              key={action.label}
              type="button"
              className="notice-chip__secondary"
              disabled={notice.busy}
              onClick={() => void runNoticeAction(notice.id, action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

`src/components/ui/WordsFirstCard.tsx`:

```tsx
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "../icons";
import { Button } from "./button";
import { dismissNotice, runNoticeAction, type Notice } from "./notices";

/**
 * VO-R6 B: the card *is* the transcript. The error is a one-line chip above
 * the recovered words; the words are selectable and draggable straight into
 * the target field. Primary actions use the ink Button (D1: orange is for
 * voice controls only).
 */
export function WordsFirstCard({
  notice,
  onHeight,
  hotkeyLabel = null,
}: {
  notice: Notice;
  onHeight?: (px: number) => void;
  hotkeyLabel?: string | null;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const words = notice.words ?? "";

  useLayoutEffect(() => {
    if (rootRef.current && onHeight) onHeight(Math.ceil(rootRef.current.getBoundingClientRect().height));
  }, [words, notice.title, onHeight]);

  const copy = async () => {
    await window.electronAPI?.writeClipboard?.(words);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section ref={rootRef} className="words-card" role="alert" aria-live="assertive">
      <span className="words-card__chip">
        <AlertTriangle size={11} aria-hidden="true" />
        {notice.body ? `${notice.title} · ${notice.body}` : notice.title}
      </span>
      <p
        className="words-card__words"
        draggable="true"
        title={t("notices.wordsCard.dragHint")}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", words);
          e.dataTransfer.effectAllowed = "copy";
          e.currentTarget.classList.add("is-drag");
        }}
        onDragEnd={(e) => e.currentTarget.classList.remove("is-drag")}
      >
        {words}
      </p>
      <div className="words-card__actions">
        {(notice.actions ?? []).map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.primary ? "default" : "outline"}
            disabled={notice.busy}
            onClick={() => void runNoticeAction(notice.id, action)}
          >
            {action.label}
            {action.primary && hotkeyLabel ? <kbd className="words-card__kbd">{hotkeyLabel}</kbd> : null}
          </Button>
        ))}
        <Button size="sm" variant="outline" data-copy="" onClick={() => void copy()}>
          {copied ? t("notices.wordsCard.copied") : t("notices.wordsCard.copy")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissNotice(notice.id)}>
          {t("notices.dismiss")}
        </Button>
      </div>
      <p className="words-card__hint">{t("notices.wordsCard.hint")}</p>
    </section>
  );
}
```

Check that `Button` supports `size="sm"` and the `outline` and `ghost` variants:

```bash
grep -n 'size:\|outline\|ghost' src/components/ui/button.tsx
```

If a name differs, use the closest existing one. Do not add variants here.

`src/components/ui/NoticeStack.tsx`:

```tsx
import { useCallback } from "react";
import { NoticeChip } from "./NoticeChip";
import { WordsFirstCard } from "./WordsFirstCard";
import { staggerIndex, useNotices, visibleNotices } from "./notices";

export function useNoticeWindowState(): { noticeCount: number; wordsCardVisible: boolean } {
  const list = useNotices();
  const wordsCardVisible = list.some((n) => n.kind === "alert" && !!n.words);
  return { noticeCount: list.filter((n) => !(n.kind === "alert" && n.words)).length, wordsCardVisible };
}

/**
 * Pill placement anchors the stack beside the pill on its inner side, newest
 * nearest the pill (column-reverse). Panel placement is a bottom-end stack.
 */
export function NoticeStack({
  placement,
  horizontalDirection = "right",
  primaryHotkeyLabel = null,
}: {
  placement: "pill" | "panel";
  horizontalDirection?: "left" | "right";
  /** Shown on the card's primary only while the global hotkey is actually held. */
  primaryHotkeyLabel?: string | null;
}) {
  const list = useNotices();
  const card = list.find((n) => n.kind === "alert" && !!n.words) ?? null;
  // The pill slot is 168px tall; a words card fills it, so chips queue
  // behind the card there. The control panel has room for both.
  const chips =
    placement === "pill" && card ? [] : visibleNotices(list.filter((n) => n !== card));
  const reportHeight = useCallback(
    (px: number) => {
      if (placement === "pill") void window.electronAPI?.resizeDictationErrorWindowToContent?.(px);
    },
    [placement]
  );
  if (!card && chips.length === 0) return null;
  return (
    <div className="notice-stack" data-placement={placement} data-direction={horizontalDirection}>
      {card ? <WordsFirstCard notice={card} onHeight={reportHeight} hotkeyLabel={primaryHotkeyLabel} /> : null}
      {chips
        .slice()
        .reverse()
        .map((notice) => (
          <NoticeChip key={notice.id} notice={notice} stagger={staggerIndex(list, notice.id)} />
        ))}
    </div>
  );
}
```

`src/styles/notices.css`. The values come from showcase lines 774–780, 366–376 and 749–762, translated to tokens:

```css
/* Notices (DESIGN.md "Notices"): receipt, notice, alert. */
.notice-stack {
  position: fixed;
  z-index: 100;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none;
}
.notice-stack > * {
  pointer-events: auto;
}
/* Beside the 40px pill on its inner side: pill inset 12 + 40 + 10 gap. The
   pill docks to a physical screen edge (data-direction mirrors the dock, not
   the text direction), so these anchors are physical on purpose; the panel
   stack below is logical. */
.notice-stack[data-placement="pill"] {
  bottom: 12px;
  left: 62px;
  right: 10px;
}
.notice-stack[data-placement="pill"][data-direction="left"] {
  left: 10px;
  right: 62px;
  align-items: flex-end;
}
.notice-stack[data-placement="panel"] {
  bottom: 20px;
  inset-inline-end: 20px;
  align-items: flex-end;
}

.notice-chip {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  border-radius: 16px;
  background: var(--color-popover);
  color: var(--color-popover-foreground);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-elevated, 0 8px 24px rgb(0 0 0 / 0.14));
  font: 500 12px/1 var(--font-family-sans);
  white-space: nowrap;
  animation: notice-in var(--motion-base) var(--motion-ease-enter) both;
  animation-delay: calc(var(--notice-stagger) * 40ms);
}
.notice-chip__row {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding-inline: 6px 5px;
}
.notice-chip__more,
.notice-chip__secondary {
  flex: none;
  height: 22px;
  padding-inline: 8px;
  border-radius: 999px;
  color: var(--color-popover-foreground);
  background: color-mix(in oklch, var(--color-foreground) 8%, transparent);
  font: 600 11px/1 var(--font-family-sans);
}
.notice-chip__more-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 0 8px 7px 33px;
}
.notice-chip button:disabled {
  opacity: 0.55;
  cursor: progress;
}
.notice-chip[data-kind="notice"] {
  border-color: color-mix(in oklch, var(--color-warning) 55%, transparent);
}
.notice-chip[data-kind="alert"] {
  border-color: color-mix(in oklch, var(--color-destructive) 60%, transparent);
}
.notice-chip__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: color-mix(in oklch, currentColor 10%, transparent);
}
.notice-chip[data-kind="receipt"] .notice-chip__icon {
  color: var(--color-success);
}
.notice-chip[data-kind="notice"] .notice-chip__icon {
  color: var(--color-warning);
}
.notice-chip[data-kind="alert"] .notice-chip__icon {
  color: var(--color-destructive);
}
.notice-chip__title {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.notice-chip__body {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-muted-foreground);
}
.notice-chip__action {
  flex: none;
  height: 22px;
  padding-inline: 8px;
  border-radius: 999px;
  background: var(--color-cta);
  color: var(--color-cta-foreground);
  font: 700 11px/1 var(--font-family-sans);
}
.notice-chip__close {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  opacity: 0.7;
}
.notice-chip__close:hover,
.notice-chip__close:focus-visible {
  opacity: 1;
}

.words-card {
  width: 100%;
  padding: 10px 11px;
  border-radius: 20px;
  background: var(--color-popover);
  color: var(--color-popover-foreground);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-elevated, 0 8px 24px rgb(0 0 0 / 0.14));
  animation: notice-in var(--motion-base) var(--motion-ease-enter) both;
}
.words-card__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 999px;
  font: 600 12px/1 var(--font-family-sans);
  color: var(--color-destructive);
  background: color-mix(in oklch, var(--color-destructive) 14%, transparent);
}
.words-card__words {
  margin: 8px 0 9px;
  padding-block: 8px;
  padding-inline: 9px 24px;
  border-radius: 11px;
  background: color-mix(in oklch, var(--color-foreground) 7%, transparent);
  font: 400 13px/1.4 var(--font-family-sans);
  cursor: grab;
  user-select: text;
  transition:
    transform var(--motion-instant) var(--motion-ease-std),
    box-shadow var(--motion-instant) var(--motion-ease-std);
}
.words-card__words.is-drag {
  transform: scale(1.03);
  box-shadow: var(--shadow-elevated, 0 8px 24px rgb(0 0 0 / 0.14));
}
.words-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.words-card__kbd {
  margin-inline-start: 6px;
  font: 700 10px/1 var(--font-family-sans);
  opacity: 0.7;
}
.words-card__hint {
  margin-top: 7px;
  font: 500 12px/1.3 var(--font-family-sans);
  color: var(--color-muted-foreground);
}

@keyframes notice-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .notice-chip,
  .words-card {
    animation: notice-fade var(--motion-fast) linear both;
    animation-delay: 0ms;
    transform: none;
  }
  .words-card__words.is-drag {
    transform: none;
  }
}
@keyframes notice-fade {
  from {
    opacity: 0;
  }
}
```

Run `grep -n -- "--font-family-sans\|--shadow-elevated\|--color-warning\|--color-success\|--color-popover:" src/index.css` to check the token names. If a token is named differently, use the existing name. Plan 01 defines `--color-cta` and `--color-cta-foreground`.

- [ ] **Step 4: Ladder, window size and mounting**

1. `src/helpers/windowConfig.js`: add `WITH_NOTICES: { width: 400, height: 168 },` after `WITH_MENU` in `WINDOW_SIZES` (line 154). Leave `WITH_TOAST` in place until Task 5. Also add `"WITH_NOTICES"` to the `resizeMainWindow` size-key union in `src/types/electron.ts` (lines 1409–1416).
2. `src/utils/windowSizeLadder.js`: replace the whole file with:

```js
// Single owner of the pill window's size priority: panel > words card > menu
// > notices > compact listening pill > base. The assistant panel must never be
// collapsed by a notice dismissing underneath it, nor the listening pill
// clipped by a menu closing — higher states always win.
export const SIZE_RANK = {
  BASE: 0,
  RECORDING: 1,
  DICTATION_ERROR_WITH_TRANSCRIPT: 3,
  WITH_MENU: 4,
  WITH_NOTICES: 5,
  EXPANDED: 6,
  ASSISTANT: 7,
};

export function resolveMainWindowSizeKey({
  panelOpen = false,
  menuOpen = false,
  noticeCount = 0,
  compactPill = false,
  wordsCardVisible = false,
} = {}) {
  if (panelOpen) return "ASSISTANT";
  if (wordsCardVisible) return "DICTATION_ERROR_WITH_TRANSCRIPT";
  if (menuOpen && (noticeCount > 0 || compactPill)) return "EXPANDED";
  if (menuOpen) return "WITH_MENU";
  if (noticeCount > 0) return "WITH_NOTICES";
  if (compactPill) return "RECORDING";
  return "BASE";
}
```

3. `src/hooks/useMainWindowSizeOwner.js`: rename the destructured inputs `toastCount` to `noticeCount` and `dictationErrorActionCount` to `wordsCardVisible`. Pass them through to `resolveMainWindowSizeKey` under the new names. Rename the returned `dictationErrorPillHandoffActive` to `wordsCardHandoffActive`. Keep its logic, keyed on `wordsCardVisible` instead of `dictationErrorActionCount > 0`. Then run:

```bash
grep -rn "toastCount\|dictationErrorActionCount\|dictationErrorPillHandoffActive" src test
```

Rename each hit in `useMainWindowSizeOwner.js`, `App.jsx` and `test/hooks/dictationErrorAutoHide.test.js`. Leave the `useToast()` destructuring in `App.jsx:64-65` alone; Task 5 removes it.

4. `src/App.jsx`:
   - Import `NoticeStack` and `useNoticeWindowState`.
   - Under the existing `useToast()` line, add `const { noticeCount, wordsCardVisible } = useNoticeWindowState();`.
   - In the props to `useMainWindowSizeOwner` (lines 312–325), pass `noticeCount: noticeCount + toastCount` and `wordsCardVisible: wordsCardVisible || dictationErrorActionCount > 0`. The `+ toastCount` and `|| dictationErrorActionCount` terms disappear in Task 5.
   - Define `const noticesOnScreen = noticeCount + toastCount > 0 || wordsCardVisible;` and use it everywhere `toastCount > 0` gates interactivity (line 329), auto-hide (line 411) and `useLinuxPillInteractivity` (line 621). `noticeCount` deliberately excludes the words card, so without `wordsCardVisible` the card would sit in a click-through window, and auto-hide would hide the recovered words.
   - Render `<NoticeStack placement="pill" horizontalDirection={voiceHorizontalDirection} />` as the last child of `div.dictation-window` (line 626).
   - R6 B keeps the pill visible next to the card. Change `dictationErrorSuppressesPill` (around line 593) to `const dictationErrorSuppressesPill = false;`, then delete that constant, the `data-dictation-error-suppressed` attribute (line 635), and its use in `resolvePillVisualSuppression` (pass `dictationErrorSuppressed: false`). Remove the parameter from `resolvePillVisualSuppression` in `voicePillPresentation.js:388` only if no other caller passes it (`grep -rn dictationErrorSuppressed src test`).
   - ⌥↵ "Paste again" uses a main-owned hotkey lease from Task 2, with a 60 s lifetime enforced by main. The card never auto-dismisses, and a global Alt+Enter must not be stolen indefinitely. The shortcut is shown only while main reports it held (I7):

     ```js
       const noticeHotkey = usePillHotkey(
         "noticePrimary",
         wordsCardVisible,
         () => {
           const card = getNotices().find((n) => n.kind === "alert" && n.words);
           const primary = card?.actions?.find((a) => a.primary);
           if (card && primary) void runNoticeAction(card.id, primary);
         },
         { ttlMs: 60_000 }
       );
     ```

     Pass `primaryHotkeyLabel={noticeHotkey.held ? (getCachedPlatform() === "darwin" ? "⌥↵" : "Alt+Enter") : null}` to `<NoticeStack placement="pill" …>`. `getCachedPlatform` comes from `src/utils/platform.ts`.
5. `src/AppRouter.jsx`: in the `isControlPanel` branch (lines 64–78), wrap the existing ternary in a fragment and render `<NoticeStack placement="panel" />` after it. The panel stack then shows in onboarding (Plan 05's trial raises notices there) as well as in `ControlPanel`.

- [ ] **Step 5: Locale strings and DESIGN.md**

Add this to `src/locales/en/translation.json` as a top-level `"notices"` object. Add the same English text to the other 11 locales.

```json
"notices": {
  "dismiss": "Dismiss",
  "moreActions": "More actions",
  "wordsCard": {
    "copy": "Copy",
    "copied": "Copied",
    "hint": "Drag the words into your app, or paste again.",
    "dragHint": "Drag into the field you were typing in"
  }
}
```

In `DESIGN.md`, add after `### Voice Pill`:

```markdown
### Notices

Three tiers, one look (VO-R14 B). Chips are 32px lines that hug the pill on its inner side; newest sits nearest the pill; at most three show.

| Tier | Use | Lifetime | ARIA |
|---|---|---|---|
| Receipt | pasted, copied, restored, mic back | 3.5 s | `role="status"` |
| Notice | cleanup skipped, model changed, fallbacks | 10 s, or until acknowledged when `persistent` | `role="status"` |
| Alert | words or work at risk | 10 s; never while it carries recovered words | `role="alert"` |

An alert that carries recovered words renders the **words-first card**: the transcript is the headline, selectable and draggable; the error is a one-line chip above it; primary is "Paste again" (⌥↵). Primaries use the ink button, never orange. Close is always visible. Motion: enter `--motion-base --motion-ease-enter`, 8 px rise, 40 ms stagger for bursts; reduced motion fades only.
```

- [ ] **Step 6: Keep the card-height regression**

`test/helpers/voiceSurfaceGeometry.test.js:84-152` pins how the dictation-error card reports its measured height so the native window grows to fit it. Port those cases to `WordsFirstCard`. Its `onHeight` must call `resizeDictationErrorWindowToContent` with the card's measured height, and `fitDictationErrorContentWindowToWorkArea` still clamps it. Keep every existing expectation and change only the component under test.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- test/components/noticeStack.test.js test/helpers/windowSizeLadder.test.js test/helpers/voiceSurfaceGeometry.test.js test/hooks/dictationErrorAutoHide.test.js test/helpers/voicePillPresentation.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/NoticeChip.tsx src/components/ui/WordsFirstCard.tsx src/components/ui/NoticeStack.tsx src/styles/notices.css src/index.css src/utils/windowSizeLadder.js src/helpers/windowConfig.js src/hooks/useMainWindowSizeOwner.js src/App.jsx src/AppRouter.jsx src/helpers/voicePillPresentation.js src/locales DESIGN.md test
git commit -m "feat(voice): pill-anchored notice chips and the words-first card"
```

---
### Task 4: Voice notices: cleanup, Tinfoil, dictation errors, meeting and main-process notices

Covers VO-Q7, VO-Q21 and VO-R6 B (wiring), plus the voice-side half of the §5.3 migration. It also closes two review findings:
- I12: the Settings action opens the route's actual section;
- I10: a failed Retry cleanup leaves its explanation on screen. This is pinned end to end against the real store.

**Files:**
- Create: `src/components/voiceNotices.ts`. Pure builders, so the listeners stay thin and testable.
- Create: `src/helpers/retryDictationCleanup.js`
- Rename (`git mv`): `src/components/CleanupFailureToastListener.tsx` becomes `src/components/CleanupFailureNoticeListener.tsx`
- Rename (`git mv`): `src/components/TinfoilModelSwitchToastListener.tsx` becomes `src/components/TinfoilModelSwitchNoticeListener.tsx`
- Rename (`git mv`): `src/components/GpuPackMigrationToastListener.tsx` becomes `src/components/GpuPackMigrationNoticeListener.tsx`
- Rename (`git mv`): `src/components/notes/BackgroundActionToastListener.tsx` becomes `src/components/notes/BackgroundActionNoticeListener.tsx`. Update its import in `ControlPanel.tsx:862`.
- Modify: `src/renderApp.jsx:6-8,33-35` (listener imports and mounts)
- Modify: `src/stores/cleanupFailureStore.ts:3-16`. Add `rawText?: string` to `CleanupFailure`.
- Modify: `src/hooks/useAudioRecording.js`. Change the signature, migrate every `toast(` call, and attach `rawText` at line 659.
- Modify: `src/hooks/useMainProcessNotifications.tsx`. Change the signature to `({ t })` and migrate all four calls.
- Modify: `src/components/MeetingRecordingMount.tsx` (calls at 84, 101, 129, 178, 185, and the dismiss subscription at 150–159)
- Modify: `src/App.jsx`:
  - line 209: `useAudioRecording(toast, {` becomes `useAudioRecording({`
  - line 386: `refuse()`
  - lines 343–347: `dismissByPresentation`
  - the `useMainProcessNotifications` call
- Modify: `src/components/OnboardingFlow.tsx:747`
- Modify: `src/helpers/windowManager.js:2240-2245`. `openSettings()` becomes `openSettings(settingsPath?)`, and waits for a freshly created control panel to finish loading before it sends.
- Modify: `src/helpers/ipcHandlers.js`, `preload.js`, `src/types/electron.ts` and `src/preview/browserPreview.ts`. Add `openSettingsAt(settingsPath)`, and widen `onShowSettings`.
- Modify: `src/components/ControlPanel.tsx:284-289`. The `onShowSettings` subscriber applies the section.
- Modify: `src/components/SettingsModal.tsx:111-114`. Re-apply `initialSection` when it changes while the modal is already open.
- Create: `src/utils/settingsDeepLink.ts`
- Test: `test/components/settingsDeepLink.test.js`
- Modify: the 6 hook tests that call `useAudioRecording(…, {…})` (listed in Step 5)
- Modify: `src/locales/*/translation.json` (`notices.*` keys)
- Test: `test/components/voiceNotices.test.js`
- Test: `test/helpers/retryDictationCleanup.test.js`
- Test: `test/helpers/cleanupFailureToast.test.js`. Read it first, then rewrite its expectations against `buildCleanupFailureNotice`.

**Interfaces:**
- Consumes `notify`, `dismissNotice`, `NoticeInput` and `NoticeAction` (Task 1), and `useResolvedRoute` from `src/lib/routes.ts` (§5.1).
- Produces:

  ```ts
  // src/components/voiceNotices.ts
  type T = (key: string, options?: Record<string, unknown>) => string;
  export function buildCleanupFailureNotice(failure: CleanupFailure, t: T, actions: { retry: () => Promise<void>; openSettings: () => void }): NoticeInput;
  export function buildModelSwitchNotice(change: { from: string; to: string }, t: T, actions: { openSettings: () => void }): NoticeInput;
  export function buildDictationErrorNotice(input: { title: string; description?: string; words?: string }, t: T, actions: { retry: () => void; pasteAgain: (words: string) => Promise<void> }): NoticeInput;
  ```

  ```js
  // src/helpers/retryDictationCleanup.js
  export async function retryDictationCleanup(rawText, deps?): Promise<"cleaned" | "unchanged" | "failed">; // deps default loads lazily
  ```

  ```ts
  // electronAPI
  openSettingsAt?: (settingsPath: string) => Promise<void>;
  ```

  `useAudioRecording(options)`: the `toast` parameter is removed. `useMainProcessNotifications({ t })`.

- [ ] **Step 1: Write the failing tests**

Create `test/components/voiceNotices.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const t = (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key);
const load = () => import("../../src/components/voiceNotices.ts");

test("cleanup failure is an amber notice with Retry cleanup first, never red (VO-Q7)", async () => {
  const { buildCleanupFailureNotice } = await load();
  const notice = buildCleanupFailureNotice(
    { message: "Qwen3.5 2B timed out after 30s", rawText: "hello" },
    t,
    { retry: async () => {}, openSettings: () => {} }
  );
  assert.equal(notice.kind, "notice");
  assert.equal(notice.id, "cleanup-failed");
  assert.equal(notice.title, "notices.cleanupFailed.title");
  assert.equal(notice.body, "Qwen3.5 2B timed out after 30s");
  assert.deepEqual(notice.actions.map((a) => [a.label, !!a.primary]), [
    ["notices.cleanupFailed.retry", true],
    ["notices.cleanupFailed.settings", false],
  ]);
});

test("cleanup failure without the raw words offers Settings only", async () => {
  const { buildCleanupFailureNotice } = await load();
  const notice = buildCleanupFailureNotice({ message: "x" }, t, { retry: async () => {}, openSettings: () => {} });
  assert.deepEqual(notice.actions.map((a) => a.label), ["notices.cleanupFailed.settings"]);
});

test("a model the user did not pick is a persistent notice with Accept (VO-Q21)", async () => {
  const { buildModelSwitchNotice } = await load();
  const notice = buildModelSwitchNotice({ from: "gpt-oss-120b", to: "Qwen3 235B" }, t, { openSettings: () => {} });
  assert.equal(notice.kind, "notice");
  assert.equal(notice.persistent, true);
  assert.equal(notice.id, "tinfoil-model-switch");
  assert.deepEqual(notice.actions.map((a) => a.label), ["notices.modelChanged.accept", "notices.modelChanged.choose"]);
  assert.match(notice.body, /gpt-oss-120b/);
});

test("a dictation error with recovered words becomes the words-first card", async () => {
  const { buildDictationErrorNotice } = await load();
  const withWords = buildDictationErrorNotice(
    { title: "Couldn't paste into Slack", description: "couldn't reach app", words: "Hey Maya" },
    t,
    { retry: () => {}, pasteAgain: async () => {} }
  );
  assert.equal(withWords.kind, "alert");
  assert.equal(withWords.words, "Hey Maya");
  assert.equal(withWords.actions[0].label, "notices.actions.pasteAgain");
  assert.equal(withWords.actions[0].keepOpen, true);

  const noWords = buildDictationErrorNotice({ title: "We didn't hear anything" }, t, { retry: () => {}, pasteAgain: async () => {} });
  assert.equal(noWords.words, undefined);
  assert.equal(noWords.actions[0].label, "common.retry");
});

test("a failed Retry cleanup leaves its explanation on screen (I10, real store)", async (t) => {
  const notices = await import("../../src/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  t.after(() => notices.__setNoticeClockForTests());
  const { buildCleanupFailureNotice } = await load();
  const { retryDictationCleanup } = await import("../../src/helpers/retryDictationCleanup.js");
  const deps = {
    processText: async () => { throw new Error("timeout"); },
    writeClipboard: async () => {},
    notify: notices.notify,
    t: (k) => k,
  };
  const id = notices.notify(
    buildCleanupFailureNotice({ message: "x", rawText: "raw words" }, t, {
      retry: async () => { await retryDictationCleanup("raw words", deps); },
      openSettings: () => {},
    })
  );
  const retry = notices.getNotices()[0].actions.find((a) => a.primary);
  await notices.runNoticeAction(id, retry);
  const [left] = notices.getNotices();
  assert.equal(left.kind, "alert");
  assert.equal(left.title, "notices.cleanupFailed.retryFailed");
});
```

Create `test/helpers/retryDictationCleanup.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/helpers/retryDictationCleanup.js");

function deps(processText) {
  const calls = { clipboard: [], notices: [] };
  return {
    calls,
    deps: {
      processText,
      writeClipboard: async (text) => calls.clipboard.push(text),
      notify: (n) => calls.notices.push(n),
      t: (k) => k,
    },
  };
}

test("a successful retry copies the cleaned text and leaves a receipt", async () => {
  const { retryDictationCleanup } = await load();
  const { calls, deps: d } = deps(async () => "Hey Maya, see you at 2.");
  assert.equal(await retryDictationCleanup("hey maya see you at two", d), "cleaned");
  assert.deepEqual(calls.clipboard, ["Hey Maya, see you at 2."]);
  assert.equal(calls.notices[0].kind, "receipt");
  assert.equal(calls.notices[0].title, "notices.cleanupFailed.cleaned");
});

test("an unchanged result copies nothing and says so", async () => {
  const { retryDictationCleanup } = await load();
  const { calls, deps: d } = deps(async (text) => text);
  assert.equal(await retryDictationCleanup("already clean", d), "unchanged");
  assert.deepEqual(calls.clipboard, []);
  assert.equal(calls.notices[0].title, "notices.cleanupFailed.noChanges");
});

test("a second failure keeps the raw words and raises an alert", async () => {
  const { retryDictationCleanup } = await load();
  const { calls, deps: d } = deps(async () => {
    throw Object.assign(new Error("timeout"), { messageKey: undefined });
  });
  assert.equal(await retryDictationCleanup("raw words", d), "failed");
  assert.deepEqual(calls.clipboard, []);
  assert.equal(calls.notices[0].kind, "alert");
  assert.equal(calls.notices[0].body, "timeout");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/components/voiceNotices.test.js test/helpers/retryDictationCleanup.test.js`
Expected: FAIL with `Cannot find module '…/voiceNotices.ts'` and `…/retryDictationCleanup.js`.

- [ ] **Step 3: Implement the builders and the retry helper**

`src/components/voiceNotices.ts`:

```ts
import type { NoticeInput } from "./ui/notices";
import type { CleanupFailure } from "../stores/cleanupFailureStore";

type T = (key: string, options?: Record<string, unknown>) => string;

/** VO-Q7: dictation succeeded, cleanup did not. Amber, actionable, not an error. */
export function buildCleanupFailureNotice(
  failure: CleanupFailure,
  t: T,
  actions: { retry: () => Promise<void>; openSettings: () => void }
): NoticeInput {
  const body = failure.messageKey ? t(failure.messageKey, failure.messageParams) : failure.message;
  return {
    id: "cleanup-failed",
    kind: "notice",
    title: t("notices.cleanupFailed.title"),
    ...(body ? { body } : {}),
    ...(failure.technicalDetails ? { details: failure.technicalDetails } : {}),
    actions: [
      ...(failure.rawText
        ? [{ label: t("notices.cleanupFailed.retry"), primary: true, onClick: actions.retry }]
        : []),
      { label: t("notices.cleanupFailed.settings"), onClick: actions.openSettings },
    ],
  };
}

/** VO-Q21: a provider retired the model; the switch waits for acknowledgement. */
export function buildModelSwitchNotice(
  change: { from: string; to: string },
  t: T,
  actions: { openSettings: () => void }
): NoticeInput {
  return {
    id: "tinfoil-model-switch",
    kind: "notice",
    persistent: true,
    title: t("notices.modelChanged.title"),
    body: t("reasoning.tinfoil.modelRetired", change),
    actions: [
      { label: t("notices.modelChanged.accept"), primary: true, onClick: () => {} },
      { label: t("notices.modelChanged.choose"), onClick: actions.openSettings },
    ],
  };
}

/** VO-R6 B: words first. Without words it is a plain alert with Retry. */
export function buildDictationErrorNotice(
  input: { title: string; description?: string; words?: string },
  t: T,
  actions: { retry: () => void; pasteAgain: (words: string) => Promise<void> }
): NoticeInput {
  const words = input.words?.trim() || undefined;
  return {
    id: "dictation-error",
    kind: "alert",
    title: input.title,
    ...(input.description ? { body: input.description } : {}),
    ...(words ? { words } : {}),
    actions: words
      ? [
          {
            label: t("notices.actions.pasteAgain"),
            primary: true,
            keepOpen: true,
            onClick: () => actions.pasteAgain(words),
          },
        ]
      : [{ label: t("common.retry"), primary: true, onClick: actions.retry }],
  };
}
```

`src/helpers/retryDictationCleanup.js`. It mirrors the cleanup call in `ControlPanel.tsx:532-551`:

```js
import { getAgentName } from "../utils/agentName";

// Defaults load lazily so unit tests that pass `deps` never pull in i18n
// (and every locale) or the notice store.
async function loadDefaultDeps() {
  const [{ default: i18n }, { notify }] = await Promise.all([
    import("../i18n"),
    import("../components/ui/notices"),
  ]);
  return {
    processText: defaultProcessText,
    writeClipboard: (text) => window.electronAPI?.writeClipboard?.(text),
    notify,
    t: (key, options) => i18n.t(key, options),
  };
}

async function defaultProcessText(rawText) {
  const [{ default: ReasoningService }, { getEffectiveCleanupModel, getSettings }] =
    await Promise.all([import("../services/ReasoningService"), import("../stores/settingsStore")]);
  const model = getEffectiveCleanupModel();
  if (!model) throw Object.assign(new Error("No cleanup model"), { messageKey: "notices.cleanupFailed.noModel" });
  return ReasoningService.processText(rawText, model, getAgentName(), {
    disableThinking: getSettings().cleanupDisableThinking,
    requireCompleteOutput: true,
  });
}

/**
 * Re-run cleanup on words that were already pasted raw. The pasted text cannot
 * be replaced in another app, so the cleaned text goes to the clipboard and a
 * receipt says so. The raw words are never touched on failure.
 */
export async function retryDictationCleanup(rawText, deps) {
  const { processText, writeClipboard, notify, t } = deps ?? (await loadDefaultDeps());
  try {
    const cleaned = await processText(rawText);
    if (typeof cleaned !== "string" || !cleaned.trim() || cleaned.trim() === rawText.trim()) {
      notify({ kind: "receipt", title: t("notices.cleanupFailed.noChanges") });
      return "unchanged";
    }
    await writeClipboard(cleaned);
    notify({
      kind: "receipt",
      title: t("notices.cleanupFailed.cleaned"),
      body: t("notices.cleanupFailed.cleanedBody"),
    });
    return "cleaned";
  } catch (error) {
    notify({
      id: "cleanup-failed",
      kind: "alert",
      title: t("notices.cleanupFailed.retryFailed"),
      body: error?.messageKey ? t(error.messageKey) : String(error?.message ?? error),
    });
    return "failed";
  }
}
```

Check `src/utils/agentName` and `src/i18n` (`grep -n "export" src/utils/agentName.* src/i18n.*`). `ControlPanel.tsx:11` already imports `getAgentName` from `../utils/agentName`.

- [ ] **Step 4: Settings deep link, end to end (I12)**

Today the path dies twice:
- `preload.js:916` drops the `show-settings` payload;
- the `ControlPanel.tsx:284-289` subscriber only calls `setShowSettings(true)`.

On top of that, `SettingsModal` applies `initialSection` only on the closed→open edge (lines 111–114). Plan 03 defines the grammar (`"<section>/<subTab>"`) and makes `SettingsModal` parse it (Plan 03 clarification 10). This step carries the path all the way there.

1. Add to `test/components/settingsDeepLink.test.js`:

   ```js
   const assert = require("node:assert/strict");
   const fs = require("node:fs");
   const path = require("node:path");
   const test = require("node:test");

   const repoRoot = path.join(__dirname, "../..");
   const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

   test("only Plan 03's settingsPath grammar is accepted", async () => {
     const { parseSettingsDeepLink } = await import("../../src/utils/settingsDeepLink.ts");
     assert.equal(parseSettingsDeepLink({ path: "llms/cleanup" }), "llms/cleanup");
     assert.equal(parseSettingsDeepLink({ path: "privacyData" }), "privacyData");
     for (const bad of [null, {}, { path: "" }, { path: "../x" }, { path: "a/b/c" }, { path: "javascript:alert(1)" }, { path: 7 }]) {
       assert.equal(parseSettingsDeepLink(bad), undefined, JSON.stringify(bad));
     }
   });

   test("the payload survives preload and reaches the modal", () => {
     assert.match(read("preload.js"), /onShowSettings: registerListener\("show-settings", \(callback\) => \(_event, payload\) => callback\(payload\)\)/);
     const panel = read("src/components/ControlPanel.tsx");
     assert.match(panel, /onShowSettings\?\.\(\(payload\) => \{\s*setSettingsSection\(parseSettingsDeepLink\(payload\)\);\s*setShowSettings\(true\);/);
     // An already-open modal must move to the new section too.
     assert.match(read("src/components/SettingsModal.tsx"), /useEffect\(\(\) => \{\s*if \(open && initialSection\)/);
   });

   test("a control panel created for the deep link is loaded before the path is sent", () => {
     const wm = read("src/helpers/windowManager.js");
     const body = wm.slice(wm.indexOf("async openSettings("), wm.indexOf("async openSettings(") + 900);
     assert.match(body, /did-finish-load/);
     assert.match(body, /send\("show-settings", \{ path/);
   });
   ```

2. Create `src/utils/settingsDeepLink.ts`:

   ```ts
   // Plan 03's settingsPath grammar: "<section>" or "<section>/<subTab>",
   // letters only. Anything else opens Settings at its default section.
   const SETTINGS_PATH = /^[A-Za-z]+(?:\/[A-Za-z]+)?$/;

   export function parseSettingsDeepLink(payload: unknown): string | undefined {
     const value = (payload as { path?: unknown } | null)?.path;
     return typeof value === "string" && SETTINGS_PATH.test(value) ? value : undefined;
   }
   ```

3. `src/helpers/windowManager.js`. Replace `openSettings()` (lines 2240–2245) with:

   ```js
     async openSettings(settingsPath = null) {
       const existed = Boolean(this.controlPanelWindow && !this.controlPanelWindow.isDestroyed());
       await this.createControlPanelWindow();
       const contents = this.controlPanelWindow?.webContents;
       if (!contents) return;
       // A window created just now has no listener yet; wait for its first load.
       if (!existed && contents.isLoading()) {
         await new Promise((resolve) => contents.once("did-finish-load", resolve));
       }
       contents.send("show-settings", { path: typeof settingsPath === "string" ? settingsPath : null });
     }
   ```

   The menu callers (lines 165, 1347, 2228 and 2231) keep calling `openSettings()` with no argument.

4. `src/helpers/ipcHandlers.js`, near the other control-panel handlers:

   ```js
       ipcMain.handle("open-settings-at", (_event, settingsPath) => this.windowManager.openSettings(settingsPath));
   ```

5. `preload.js`:
   - add `openSettingsAt: (settingsPath) => ipcRenderer.invoke("open-settings-at", settingsPath),`;
   - change line 916 to `onShowSettings: registerListener("show-settings", (callback) => (_event, payload) => callback(payload)),`.

   `electron.ts`:
   - add `openSettingsAt?: (settingsPath: string) => Promise<void>;`;
   - widen `onShowSettings` (line 1490) to `(callback: (payload?: { path: string | null }) => void) => () => void`.

   `browserPreview.ts`: add `openSettingsAt: async () => {}`.
6. `src/components/ControlPanel.tsx:284-289`:

   ```tsx
     useEffect(() => {
       const cleanup = window.electronAPI?.onShowSettings?.((payload) => {
         setSettingsSection(parseSettingsDeepLink(payload));
         setShowSettings(true);
       });
       return () => cleanup?.();
     }, []);
   ```

   This also clears a stale section left from an earlier open, because a payload with no path sets `undefined`.
7. `src/components/SettingsModal.tsx`. After the existing open-edge logic (lines 111–114), add:

   ```tsx
     // A deep link that arrives while Settings is already open moves it too.
     useEffect(() => {
       if (open && initialSection) {
         // same resolution the open-edge branch uses
         applyInitialSection(initialSection);
       }
       // eslint-disable-next-line react-hooks/exhaustive-deps -- re-apply only when the request changes
     }, [initialSection]);
   ```

   `applyInitialSection` is the body of the existing branch at lines 111–114. It sets the section from `resolveSection(initialSection)`, and the sub-tab per Plan 03's parser. Extract it into a local function and call it from both places.

- [ ] **Step 5: Migrate the voice-side call sites**

1. **Listeners.** `git mv` the four files above, then rewrite the bodies.

   **`CleanupFailureNoticeListener.tsx`.** Keep the store drain exactly as today (lines 12–26), including the `showDictationPanel()` pre-step. Replace the `toast({...})` (lines 28–36) with:

   ```tsx
   const cleanupRoute = useResolvedRoute("dictationCleanup");
   // …inside the effect, after the drain:
   notify(
     buildCleanupFailureNotice(failure, t, {
       retry: async () => {
         if (failure.rawText) await retryDictationCleanup(failure.rawText);
       },
       openSettings: () => void window.electronAPI?.openSettingsAt?.(cleanupRoute.settingsPath),
     })
   );
   ```

   **`TinfoilModelSwitchNoticeListener.tsx`.** Inside the `consumeTinfoilModelSwitches()` loop, call `notify(buildModelSwitchNotice({ from, to }, t, { openSettings: () => void window.electronAPI?.openSettingsAt?.(cleanupRoute.settingsPath) }))`, with `cleanupRoute = useResolvedRoute("dictationCleanup")`.

   **`GpuPackMigrationNoticeListener.tsx`.** Use `notify({ kind: "notice", persistent: true, title: t("app.toasts.gpuPackMigration.title"), body: … })`. The body is whatever the current description key is.

   **`BackgroundActionNoticeListener.tsx`.** Use `notify({ kind: "alert", title: t("notes.enhance.title"), body: description })`.

   In `src/renderApp.jsx`, change the three imports (lines 6–8) and mounts (lines 33–35) to the new names. Update the import in `ControlPanel.tsx:862` for the background listener.

2. **`src/stores/cleanupFailureStore.ts`.** Add `rawText?: string;` to `CleanupFailure` (lines 3–16).

3. **`src/hooks/useAudioRecording.js`:**
   - Signature, line 32: `export const useAudioRecording = (options = {}) => {`. Delete the `toast` parameter. The destructure on lines 58–69 is unchanged except that `onShowTranscript` is removed: the words card replaces "View transcript". Remove its use in `App.jsx` too.
   - `showDictationError` (lines 300–331) becomes:

     ```js
     const showDictationError = ({ title, description, transcript = "" }) => {
       const recoverAssistant = Boolean(audioManagerRef.current?.voiceAgentRequested);
       onDictationError?.({ recoverAssistant });
       notify(
         buildDictationErrorNotice(
           { title, description, words: getRecoverableTranscript(transcript) },
           t,
           {
             retry: () => performStartRecording(lastStartOptionsRef.current),
             pasteAgain: async (words) => {
               const pasted = await audioManagerRef.current?.safePaste(words, {
                 restoreClipboard: false,
                 allowClipboardFallback: true,
               });
               if (pasted) {
                 dismissNotice("dictation-error");
                 notify({ kind: "receipt", title: t("notices.pasted") });
               }
             },
           }
         )
       );
     };
     ```

     Callers that pass `duration` keep compiling, because the argument is ignored. Remove `duration` from those call sites (`grep -n "showDictationError(" src/hooks/useAudioRecording.js`).
   - Line 363, mic disconnected: `notify({ id: "mic", kind: "notice", title: t("hooks.audioRecording.micDisconnected.title"), body: t("hooks.audioRecording.micDisconnected.description") })`. Keep the existing description key.
   - Line 370, mic restored: `notify({ id: "mic", kind: "receipt", title: t("hooks.audioRecording.micRestored.title") })`. The same id replaces the disconnected notice.
   - Line 400, screen context skipped: `notify({ kind: "notice", title, body })` with the same title and description as today.
   - Line 516, partial transcription: `notify({ kind: "notice", title, body })`.
   - Line 666, fallback: `notify({ kind: "notice", title, body })`.
   - Line 682, translation fallback (destructive today): `notify({ kind: "alert", title, body })`.
   - Line 659: `if (result.cleanupFailure) recordCleanupFailure({ ...result.cleanupFailure, rawText: result.text });`.
   - Add the imports `import { notify, dismissNotice } from "../components/ui/notices";` and `import { buildDictationErrorNotice } from "../components/voiceNotices";`.
   - Remove `toast` from every hook dependency array (`grep -n "\btoast\b" src/hooks/useAudioRecording.js`, around line 801). ESLint's `react-hooks/exhaustive-deps` flags the stale entry.
4. **`src/hooks/useMainProcessNotifications.tsx`.** Change the signature to `({ t })`, then migrate each call:

   | Line | New call | Extra changes |
   |---|---|---|
   | 20 | `notify({ kind: "notice", … })` | |
   | 31 | `notify({ kind: "notice", … })` | |
   | 40 | `notify({ kind: "notice", …, actions: [{ label: t("common.retry"), primary: true, onClick: <the existing button's onClick body> }] })` | |
   | 70 | `notify({ kind: "receipt", …, actions: [{ label: t("common.undo"), primary: true, onClick: <the existing Undo body> }] })` | Change `common.undo` to the key the existing button uses. |

   Any `dismiss(id)` becomes `dismissNotice(id)`. Toast ids returned by `toast(...)` become the return value of `notify(...)`.
5. **`src/components/MeetingRecordingMount.tsx`:**

   | Line | Old toast | New call | Extra changes |
   |---|---|---|---|
   | 84 | destructive | `alert` | |
   | 101 | 8 s | `notice` | |
   | 129 | interruption | `notify({ id: "meeting-interruption", kind: "notice", persistent: !interruption.recovering, title, body, actions })` | Replace the stop button `createElement` with `{ label: t("notes.editor.stop"), primary: true, onClick: () => void stopRecording() }`, only when it is `systemAudioStopped`. |
   | 150–159 | dismiss subscription | `dismissNotice("meeting-interruption")` | |
   | 178 | mic disconnected | `notify({ id: "meeting-mic", kind: "notice", … })` | |
   | 185 | mic restored | `notify({ id: "meeting-mic", kind: "receipt", … })` | |

   Leave the focus gating and any Plan 02 native notification exactly as Plan 02 left them.
6. **`src/App.jsx`:**
   - Line 209 becomes `useAudioRecording({`.
   - `refuse()` (lines 383–389) uses `notify({ kind: "notice", title: t(messageKey) })`.
   - Lines 343–347 call `dismissNotice("dictation-error")` instead of `dismissByPresentation("dictation-error")`.
   - Lines 88–91: `dismissDictationError` becomes `React.useCallback(() => dismissNotice("dictation-error"), [])`.
   - The `useMainProcessNotifications` call becomes `useMainProcessNotifications({ t })`.
7. **`src/components/OnboardingFlow.tsx:747`.** Change it to `const recording = useAudioRecording({ trialMode: true, onDemoEvent });`. Remove the `toast` destructure only if nothing else in the file uses it (`grep -n "toast" src/components/OnboardingFlow.tsx`).
8. **Hook tests.** Change each call to the new single-argument form:
   - `test/helpers/useAudioRecordingMicPrecache.test.js:62`
   - `test/helpers/useAudioRecordingPreparingReset.test.js:96`
   - `test/helpers/useAudioRecordingCleanupFallback.test.js:78`
   - `test/helpers/useAudioRecordingInitialization.test.js:18`
   - `test/helpers/useAudioRecordingClipboardPersistence.test.js:153`

   For example, `useAudioRecording(() => {}, { onDemoEvent: () => {} })` becomes `useAudioRecording({ onDemoEvent: () => {} })`.

   `test/helpers/useAudioRecordingForceStop.test.js:134` collected toasts. Read the notices through the same Vite module graph the hook uses:

   ```js
   const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
   notices.__setNoticeClockForTests();
   // …render with useAudioRecording({ onDemoEvent: NOOP }) …
   const toasts = notices.getNotices(); // replaces the pushed array
   ```

   Then change each assertion on `toasts[i].title` or `.description` to `.title` or `.body`. Change `presentation: "dictation-error"` checks to `id === "dictation-error"`.

Locale keys (en). Add these under the `"notices"` object from Task 3, and mirror them into the 11 other locales:

```json
"pasted": "Pasted",
"actions": { "pasteAgain": "Paste again" },
"cleanupFailed": {
  "title": "Pasted without cleanup",
  "retry": "Retry cleanup",
  "settings": "Settings",
  "cleaned": "Cleaned text copied",
  "cleanedBody": "Paste it where you want it.",
  "noChanges": "Cleanup made no changes",
  "retryFailed": "Cleanup failed again. Your words are unchanged.",
  "noModel": "Choose a cleanup model in Settings."
},
"modelChanged": { "title": "Model changed", "accept": "Accept", "choose": "Choose another" }
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- test/components/voiceNotices.test.js test/components/settingsDeepLink.test.js test/helpers/retryDictationCleanup.test.js test/helpers/cleanupFailureToast.test.js "test/helpers/useAudioRecording*.test.js" test/components/meetingInterruptionWarning.test.js test/hooks/dictationErrorAutoHide.test.js`
Expected: PASS. `meetingInterruptionWarning.test.js` mocks the toast. If it fails on `toast`, read it, load `notices.ts` through its Vite server, and assert on `getNotices()` as in item 8.

- [ ] **Step 7: Commit**

```bash
git add -A src/components src/utils/settingsDeepLink.ts src/helpers/windowManager.js src/helpers/retryDictationCleanup.js src/stores/cleanupFailureStore.ts src/hooks src/App.jsx src/renderApp.jsx src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/preview/browserPreview.ts src/locales test
git commit -m "feat(voice): voice notices: cleanup retry, model switch, words-first errors"
```

---

### Task 5: Finish the notice migration and delete the toast system

Covers the rest of §5.3: "Plan 04 migrates those call sites."

**Files:**
- Modify the remaining call sites, which are 33 calls in 10 files. Line numbers are from today's tree, so re-run the grep in Step 1.

| File:line | Today | Becomes |
|---|---|---|
| `ControlPanel.tsx:297` | default, 10 s | `notice` |
| `ControlPanel.tsx:322`, `:378` | success | `receipt` |
| `ControlPanel.tsx:329`, `:405`, `:411`, `:612`, `:619` | destructive | `alert` |
| `ControlPanel.tsx:490`, `:561` | destructive cleanup failed | `notice`, title `notices.cleanupFailed.title` (VO-Q7 parity) |
| `ControlPanel.tsx:604` | default | `receipt` |
| `SettingsPage.tsx:542`, `:710` | success | `receipt` |
| `SettingsPage.tsx:1151` | default | `receipt` |
| `SettingsPage.tsx:1379` | destructive | `alert` |
| `SettingsPage.tsx:1425` | destructive, 15 s | `alert`, `persistent: true` |
| `DeveloperSection.tsx:28`, `:67`, `:84`, `:106` | destructive | `alert` |
| `DeveloperSection.tsx:57`, `:98` | success | `receipt` |
| `DictionaryView.tsx:110` | destructive | `alert` |
| `chat/ChatInput.tsx:76` | destructive | `alert` |
| `notes/PersonalNotesView.tsx:521` | destructive | `alert` |
| `notes/SpacesTree.tsx:72` | destructive | `alert` |
| `notes/overview/SpaceIconButton.tsx:28` | destructive | `alert` |
| `dictation/AssistantPanel.tsx:175` | destructive | `alert` |
| `hooks/useModelDownload.ts:302`, `:352`, `:416`, `:426`, `:439`, `:472` | default | `receipt` (deleted/cancelled) or `notice` (download in progress) |

- Delete: `src/components/ui/Toast.tsx`, `src/components/ui/useToast.ts`, `src/helpers/toastPresentation.js`, `src/components/dictation/DictationErrorCard.tsx`, and the `.toast-*` rules and `toast-enter`/`toast-progress` keyframes in `src/index.css:1083-1130`.
- Delete: `test/helpers/toastPresentation.test.js`
- Modify: `src/renderApp.jsx`. Remove `ToastProvider`.
- Modify: `src/App.jsx`. Remove `useToast()` and the `+ toastCount` / `|| dictationErrorActionCount` bridges from Task 3.
- Modify: `src/helpers/windowConfig.js`. Remove `WITH_TOAST` and `DICTATION_ERROR`, keep `DICTATION_ERROR_WITH_TRANSCRIPT`, and rename nothing else.
- Modify: `test/helpers/windowSizeLadder.test.js`. Delete the tests that read `WINDOW_SIZES.DICTATION_ERROR` ("dictation error windows share the assistant width…"), and keep a check that `DICTATION_ERROR_WITH_TRANSCRIPT.width === ASSISTANT.width`.
- Modify the tests that import the toast system (`grep -rln "useToast\|ui/Toast\|toastPresentation\|DictationErrorCard" test`):
  - `rtlMotion.test.js`
  - `spaceEmoji.test.js`
  - `orukeetOrganization.test.js`
  - `modelDownloadErrors.test.js`
  - `spacesTreeNoteActionClearance.test.js`
  - `assistantPanel.test.js`
  - `voiceSurfaceGeometry.test.js`
- Test: `test/components/noToastLeft.test.js`

**Interfaces:**
- Consumes `notify` and `NoticeInput` (Task 1).
- Mapping rule, used for every row above:
  - `variant: "success"` → `kind: "receipt"`.
  - default/no variant → `kind: "notice"`.
  - `variant: "destructive"` → `kind: "alert"`.
  - `duration >= 15000` or `duration: 0` → `persistent: true`.
  - `description` → `body`.
  - `technicalDetails` → `details`.
  - An `action` React node → `actions: [{ label, onClick, primary: true }]`.
  - Shorter custom `duration` values are dropped; the tier lifetime applies.

- [ ] **Step 1: Write the failing guard test**

Create `test/components/noToastLeft.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("no renderer code imports the retired toast system", () => {
  const offenders = walk(path.join(repoRoot, "src")).filter((file) =>
    /from\s+["'][^"']*(ui\/Toast|useToast|toastPresentation|DictationErrorCard)["']/.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(offenders.map((f) => path.relative(repoRoot, f)), []);
});

test("no component calls a bare toast()", () => {
  const offenders = walk(path.join(repoRoot, "src")).filter((file) =>
    /(^|[^.\w])toast\(\{/m.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(offenders.map((f) => path.relative(repoRoot, f)), []);
});

test("the toast files are gone and notices own the surface", () => {
  for (const gone of ["src/components/ui/Toast.tsx", "src/components/ui/useToast.ts", "src/helpers/toastPresentation.js", "src/components/dictation/DictationErrorCard.tsx"]) {
    assert.equal(fs.existsSync(path.join(repoRoot, gone)), false, gone);
  }
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.doesNotMatch(css, /\.toast-|@keyframes toast-/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/components/noToastLeft.test.js`
Expected: FAIL. The first test lists about ten files, including `ControlPanel.tsx`.

- [ ] **Step 3: Migrate**

1. Run `grep -rn "toast(\|useToast\|ToastProvider" src` and work file by file using the mapping rule. Each `const { toast } = useToast();` line disappears, and each file imports `notify` from the correct relative path to `src/components/ui/notices`. Example (`DeveloperSection.tsx:28`):

   ```tsx
   // before
   toast({ title: t("developerSection.toasts.loadFailed.title"), description: t("developerSection.toasts.loadFailed.description"), variant: "destructive" });
   // after
   notify({ kind: "alert", title: t("developerSection.toasts.loadFailed.title"), body: t("developerSection.toasts.loadFailed.description") });
   ```

   `ControlPanel.tsx:490` and `:561` are the history "retry cleanup" failures. Use `notify({ id: "cleanup-failed", kind: "notice", title: t("notices.cleanupFailed.title"), body: <same description> })` so the history path and the dictation path read the same.
2. Delete the four files and `test/helpers/toastPresentation.test.js`. Remove `ToastProvider` from `src/renderApp.jsx` (lines 10, 32 and 37). Its children move up one level inside `SettingsProvider`.
3. In `src/App.jsx`:
   - Delete the `useToast()` line (64–65).
   - Line 173: `useAssistantPanel({ dictationErrorActionCount, … })`. Rename that option to `wordsCardVisible: boolean` in `src/hooks/useAssistantPanel.js` (`grep -n dictationErrorActionCount src/hooks/useAssistantPanel.js`). Turn its `> 0` checks into the boolean, and pass `wordsCardVisible`.
   - Lines 256–258: keep the effect and its ordering comment (it must run before the size owner), but key it on the card: `useEffect(() => { if (wordsCardVisible) handleDictationError(); }, [wordsCardVisible, handleDictationError]);`.
   - Change `noticeCount + toastCount > 0 || wordsCardVisible` to `noticeCount > 0 || wordsCardVisible`.
   - Change `wordsCardVisible || dictationErrorActionCount > 0` to `wordsCardVisible`.
4. In `src/helpers/windowConfig.js`, delete `WITH_TOAST` and `DICTATION_ERROR` from `WINDOW_SIZES`, and remove both from the `resizeMainWindow` union in `src/types/electron.ts`. Then run `grep -rn "WITH_TOAST\|\"DICTATION_ERROR\"" src test` and fix every hit: `windowManager.js` size checks and `voiceSurfaceGeometry.test.js`.
5. Delete every toast rule and keyframe in `src/index.css`, starting around line 1083: `.toast-surface`, `.toast-enter`, `@keyframes toast-enter`, `toast-progress`, `toast-border-progress`, and the reduced-motion toast rules. Use `grep -n "toast" src/index.css` to find them all; do not stop at line 1130.
6. `test/components/rtlMotion.test.js` reads the `Toast.tsx` source and the toast CSS. Rewrite those assertions against the notice equivalents: `.notice-stack[data-placement="panel"]` uses `inset-inline-end`, and `@keyframes notice-in` rises on the Y axis only. Do not just delete them.
7. For each listed test that imported toast modules: if it mounted `ToastProvider` only to satisfy `useToast`, delete the provider wrapper. If it asserted a toast, load `notices.ts` through the same module system and assert on `getNotices()`. Use `await import("../../src/components/ui/notices.ts")` for SSR tests and `vite.ssrLoadModule("/components/ui/notices.ts")` for Vite-harness tests.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck && npm run i18n:check`
Expected: PASS. Any remaining failure names a call site or test you missed; fix it with the mapping rule.

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "refactor(ui): migrate every toast to notify() and remove the toast system"
```

---
### Task 6: Dictation sessions and the route snapshot

Closes review finding C2 and lays the groundwork for C1, I2 and I5. Every recording becomes a **dictation session**, with:
- an id, which is also the `correlationId` Plan 07 asked for (its CCR-3);
- an immutable, credential-free snapshot of every setting that decides where the audio and text go, taken when recording starts;
- the recording's intents (Agent, translation, screen context, selection).

The processing pipeline reads routing settings **only** from the session. A settings change during processing, during the undo window, or between cancel and Undo can therefore never move the audio to a different provider, and local audio can never go remote. Credentials are not in the snapshot. Main resolves API keys live by provider id (`ipcHandlers.js:8068-8075`), and the renderer-held keys are read live, so revoking a key makes the request fail explicitly instead of silently switching.

**Files:**
- Create: `src/helpers/dictationSession.js`
- Modify: `src/helpers/audioManager.js`:
  - start the session in `startRecording` (≈1141) and `startStreamingRecording` (≈3430);
  - add `settings()` and the `_activeSession` plumbing;
  - make every read site listed in Step 4 take its routing settings from the session.
- Modify: `src/services/ReasoningService.ts:65-141`. An explicit `config.provider` / `baseUrl` / `lanUrl` is always honoured, and dictation now always passes them. Add `config.settingsView`, which local-provider prompts read instead of live settings.
- Modify: `src/services/BaseReasoningService.ts:33-58`. The `get*` helpers prefer `config.settingsView`.
- Modify: `src/config/prompts/index.ts:17-21`. `resolvePrompt(kind, opts)` accepts `opts.customPrompts`.
- Test: `test/helpers/dictationSession.test.js`
- Test: `test/helpers/audioManagerSessionRoute.test.js`

**Interfaces:**
- Consumes `INFERENCE_SCOPES` (`src/config/inferenceScopes.ts:20-100`) and `selectResolvedLLMConfig` (`settingsStore.ts:2629`).
- Produces:

  ```js
  // src/helpers/dictationSession.js
  export const SESSION_ROUTE_KEYS: readonly string[];   // every settings-store key that decides a dictation route or its prompt
  export function isCredentialKey(key: string): boolean; // /apikey|secret|token|clientid|password|credential/i
  export function captureDictationSession({ settings, intents, agentName, id?, now? }): DictationSession;
  export function sessionSettings(session: DictationSession, live: object): object; // live, overlaid with the snapshot
  // DictationSession (frozen):
  // { id: string; startedAt: number; settings: Readonly<Record<string, unknown>>; agentName: string;
  //   intents: { voiceAgentRequested: boolean; translationRequested: boolean; streaming: boolean;
  //              streamingProviderName: string | null; assistantSelectionContext: unknown } }
  ```

  ```js
  // AudioManager
  beginDictationSession(intents): DictationSession;   // called at both start paths
  settings(): object;                                 // sessionSettings(this._activeSession, getSettings()) or getSettings()
  get activeSession(): DictationSession | null;
  ```

- Every later task uses `session.id` as the correlation id. Task 8 stores the whole session in the undo hold.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/dictationSession.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/helpers/dictationSession.js");

const live = {
  useLocalWhisper: true,
  localTranscriptionProvider: "nvidia",
  parakeetModel: "parakeet-tdt-0.6b-v3",
  cloudTranscriptionProvider: "openai",
  cloudTranscriptionModel: "gpt-4o-mini-transcribe",
  useCleanupModel: true,
  cleanupMode: "providers",
  cleanupProvider: "anthropic",
  customPrompts: { dictationAgent: "Be brief." },
  openaiApiKey: "sk-live",
  customTranscriptionApiKey: "k",
  theme: "dark",
};

test("the snapshot is frozen, credential-free and covers every route key", async () => {
  const { captureDictationSession, SESSION_ROUTE_KEYS, isCredentialKey } = await load();
  const session = captureDictationSession({
    settings: live,
    intents: { voiceAgentRequested: false, translationRequested: true, streaming: false, streamingProviderName: null },
    agentName: "Loqui",
    id: "rec-1",
    now: 5,
  });
  assert.equal(session.id, "rec-1");
  assert.equal(Object.isFrozen(session), true);
  assert.equal(Object.isFrozen(session.settings), true);
  assert.equal(session.settings.cleanupProvider, "anthropic");
  assert.equal("theme" in session.settings, false, "only routing and prompt keys are captured");
  for (const key of Object.keys(session.settings)) assert.equal(isCredentialKey(key), false, key);
  assert.equal(SESSION_ROUTE_KEYS.some(isCredentialKey), false);
  assert.equal(session.intents.translationRequested, true);
});

test("the session view keeps the snapshot's route and the live credentials", async () => {
  const { captureDictationSession, sessionSettings } = await load();
  const session = captureDictationSession({ settings: live, intents: {}, agentName: "Loqui" });
  const changed = { ...live, useLocalWhisper: false, cloudTranscriptionProvider: "groq", openaiApiKey: "sk-rotated" };
  const view = sessionSettings(session, changed);
  assert.equal(view.useLocalWhisper, true, "local stays local");
  assert.equal(view.cloudTranscriptionProvider, "openai", "provider A stays provider A");
  assert.equal(view.openaiApiKey, "sk-rotated", "credentials are never frozen");
});

test("every inference scope the dictation pipeline uses is covered", async () => {
  const { SESSION_ROUTE_KEYS } = await load();
  const { INFERENCE_SCOPES } = await import("../../src/config/inferenceScopes.ts");
  for (const scope of ["dictationCleanup", "dictationAgent", "dictationAgentVision", "dictationTranslation"]) {
    const keys = Object.values(INFERENCE_SCOPES[scope].storeKeys);
    assert.ok(keys.length >= 6, `${scope} has store keys`);
    for (const key of keys) {
      if (/apikey|secret/i.test(key)) continue;
      assert.ok(SESSION_ROUTE_KEYS.includes(key), `${scope}: ${key}`);
    }
  }
  // Spot checks that would fail if the scope maps were read from the wrong property.
  for (const key of ["translationProvider", "translationRemoteUrl", "dictationAgentRemoteUrl", "dictationAgentVisionProvider", "cleanupCloudMode"]) {
    assert.ok(SESSION_ROUTE_KEYS.includes(key), key);
  }
  assert.equal(SESSION_ROUTE_KEYS.includes("dictationAgent"), false, "fallbackScope is not a settings key");
});
```

Create `test/helpers/audioManagerSessionRoute.test.js`. It drives the **real** `processAudio` / `processWithOpenAIAPI` code, and stubs only the leaf transports:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");

const LOCAL = {
  useLocalWhisper: true, localTranscriptionProvider: "nvidia", parakeetModel: "parakeet-tdt-0.6b-v3",
  cloudTranscriptionProvider: "openai", cloudTranscriptionModel: "whisper-1", transcriptionMode: "providers",
  cloudTranscriptionMode: "byok", useCleanupModel: false, openaiApiKey: "sk", groqApiKey: "gk",
};

async function setup(t, settings) {
  const loaded = await loadAudioManager(t, { cachePrefix: "openwhispr-session-route-", settingsKey: "__sessionRouteSettings", settings });
  const { captureDictationSession } = await loaded.vite.ssrLoadModule("/helpers/dictationSession.js");
  const calls = { local: 0, byok: [] };
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    transcribeAudioFileByok: async (payload) => {
      calls.byok.push(payload);
      return { success: true, text: "hello" };
    },
    cancelUploadTranscription: () => {},
  };
  const manager = Object.assign(Object.create(loaded.AudioManager.prototype), {
    isProcessing: true,
    _processingCancellationGeneration: 0,
    _localSpeechGateState: null,
    processWithLocalParakeet: async () => {
      calls.local += 1;
      return { success: true, text: "hello", source: "local-parakeet" };
    },
    processTranscription: async (text) => text,
    onTranscriptionComplete: () => {},
    onStateChange: () => {},
  });
  // If processAudio reaches another helper needing a stub, add it to the object above.
  return { ...loaded, manager, calls, captureDictationSession };
}

const blob = () => new Blob([new Uint8Array(256)], { type: "audio/webm" });

test("audio recorded on-device stays on-device even if settings switch to a provider", async (t) => {
  const { manager, calls, captureDictationSession, setSettings } = await setup(t, LOCAL);
  manager._activeSession = captureDictationSession({ settings: LOCAL, intents: {}, agentName: "Loqui" });
  setSettings({ ...LOCAL, useLocalWhisper: false }); // user switches to OpenAI mid-flight
  await manager.processAudio(blob(), { durationSeconds: 2 });
  assert.equal(calls.local, 1);
  assert.equal(calls.byok.length, 0, "nothing was uploaded");
});

test("provider A stays provider A when settings change to provider B", async (t) => {
  const remoteA = { ...LOCAL, useLocalWhisper: false, cloudTranscriptionProvider: "openai" };
  const { manager, calls, captureDictationSession, setSettings } = await setup(t, remoteA);
  manager._activeSession = captureDictationSession({ settings: remoteA, intents: {}, agentName: "Loqui" });
  setSettings({ ...remoteA, cloudTranscriptionProvider: "groq", cloudTranscriptionModel: "whisper-large-v3" });
  await manager.processAudio(blob(), { durationSeconds: 2 });
  assert.equal(calls.byok[0].provider, "openai");
  assert.equal(calls.byok[0].correlationId, manager._activeSession.id);
});

test("Agent and translation intents come from the session, not from live flags", async (t) => {
  const { manager, captureDictationSession } = await setup(t, LOCAL);
  const session = captureDictationSession({
    settings: LOCAL,
    intents: { voiceAgentRequested: true, translationRequested: false },
    agentName: "Loqui",
  });
  manager.voiceAgentRequested = false;
  manager.applySessionIntents(session);
  assert.equal(manager.voiceAgentRequested, true);
  assert.equal(manager.translationRequested, false);
  assert.equal(manager._activeSession, session);
});

test("a new streaming start resolves its provider from live settings, not the previous session", async (t) => {
  const remote = { ...LOCAL, useLocalWhisper: false, cloudTranscriptionProvider: "deepgram", deepgramApiKey: "d" };
  const { manager, setSettings } = await setup(t, remote);
  manager.beginDictationSession({ streaming: true, streamingProviderName: "deepgram" });
  manager._endDictationSession(manager.activeSession);
  setSettings({ ...remote, cloudTranscriptionProvider: "assemblyai", assemblyaiApiKey: "a" });
  assert.equal(manager.activeSession, null);
  assert.equal(manager.getStreamingProviderName(), "assemblyai");
});

test("no routing read in the dictation pipeline bypasses the session", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../src/helpers/audioManager.js"), "utf8");
  const methods = [
    "processAudio", "processWithLocalWhisper", "processWithLocalParakeet", "processWithOpenAIAPI",
    "getTranscriptionModel", "processTranscription", "processTranscriptionCore", "isReasoningAvailable",
    "processWithReasoningModel", "processAgentCommand", "runTranslationChain", "consumeSelectionCapture",
    "_finalizeStreamingRecording", "getStreamingProviderName", "getKeyterms", "getCustomDictionaryPrompt",
    "finalizeChineseScript",
  ];
  for (const name of methods) {
    const start = src.search(new RegExp(`\\n  (?:async )?${name}\\(`));
    assert.ok(start > 0, `${name} exists`);
    const end = src.indexOf("\n  }\n", start);
    const body = src.slice(start, end);
    assert.doesNotMatch(body, /\bgetSettings\(\)/, `${name} reads live settings`);
    assert.doesNotMatch(body, /\bgetEffectiveCleanupModel\(\)/, `${name} reads the live cleanup model`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/dictationSession.test.js test/helpers/audioManagerSessionRoute.test.js`
Expected: FAIL with `Cannot find module '…/dictationSession.js'`.

- [ ] **Step 3: Implement `dictationSession.js`**

```js
import { INFERENCE_SCOPES } from "../config/inferenceScopes";

// Every settings-store key that decides where a dictation's audio or text
// goes, or what prompt it is sent with. Credentials are never captured:
// main resolves keys live by provider id, and renderer-held keys are read
// live, so a revoked key fails the request instead of rerouting it.
const STT_KEYS = [
  "useLocalWhisper", "localTranscriptionProvider", "whisperModel", "parakeetModel", "cohereModel",
  "transcriptionMode", "cloudTranscriptionMode", "cloudTranscriptionProvider", "cloudTranscriptionModel",
  "cloudTranscriptionBaseUrl", "remoteTranscriptionUrl", "remoteTranscriptionModel", "remoteTranscriptionType",
  "cortiEnvironment", "cortiTenant", "preferredLanguage", "translationSourceLanguage",
  "translationTargetLanguage", "chineseScriptPreference", "customDictionary",
];
const TEXT_FLAG_KEYS = [
  "useCleanupModel", "cleanupMode", "cleanupProvider", "cleanupModel", "cleanupCloudBaseUrl",
  "cleanupRemoteUrl", "cleanupDisableThinking", "useDictationAgent", "dictationAgentMode",
  "useDictationAgentVisionModel", "dictationAgentVisionModel", "dictationAgentVisionCloudBaseUrl",
  "useDictationTranslation", "snippets", "customPrompts", "uiLanguage", "autoPasteEnabled",
  "voiceAgentScreenContext",
];
const DICTATION_SCOPES = ["dictationCleanup", "dictationAgent", "dictationAgentVision", "dictationTranslation"];

export function isCredentialKey(key) {
  return /apikey|secret|token|clientid|password|credential/i.test(key);
}

// Each scope's settings keys live under `storeKeys` (inferenceScopes.ts:3-19).
function scopeKeys(scope) {
  return Object.values(INFERENCE_SCOPES[scope]?.storeKeys ?? {});
}

export const SESSION_ROUTE_KEYS = Object.freeze(
  [...new Set([...STT_KEYS, ...TEXT_FLAG_KEYS, ...DICTATION_SCOPES.flatMap(scopeKeys)])].filter(
    (key) => !isCredentialKey(key)
  )
);

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export function captureDictationSession({ settings, intents = {}, agentName = "", id, now = Date.now() }) {
  const snapshot = {};
  for (const key of SESSION_ROUTE_KEYS) {
    if (settings[key] !== undefined) snapshot[key] = structuredClone(settings[key]);
  }
  return deepFreeze({
    id: id ?? crypto.randomUUID(),
    startedAt: now,
    settings: snapshot,
    agentName,
    intents: {
      voiceAgentRequested: Boolean(intents.voiceAgentRequested),
      translationRequested: Boolean(intents.translationRequested),
      streaming: Boolean(intents.streaming),
      streamingProviderName: intents.streamingProviderName ?? null,
      assistantSelectionContext: intents.assistantSelectionContext ?? null,
    },
  });
}

/** Live settings with every route key pinned to the session's snapshot. */
export function sessionSettings(session, live) {
  return session ? { ...live, ...session.settings } : live;
}
```

- [ ] **Step 4: Thread the session through `AudioManager`**

1. **Plumbing.** Add `import { captureDictationSession, sessionSettings } from "./dictationSession";`, then add these methods near `getStreamingProviderName` (≈822):

   ```js
     beginDictationSession(intents = {}) {
       const live = getSettings();
       this._activeSession = captureDictationSession({
         settings: live,
         intents: {
           voiceAgentRequested: this.voiceAgentRequested,
           translationRequested: this.translationRequested,
           assistantSelectionContext: this.assistantSelectionContext ?? null,
           ...intents,
         },
         agentName: typeof window !== "undefined" && window.localStorage ? getAgentName() : "OpenWhispr",
       });
       return this._activeSession;
     }

     get activeSession() {
       return this._activeSession ?? null;
     }

     /** Routing reads go through here: live settings pinned to the active session. */
     settings() {
       return sessionSettings(this._activeSession ?? null, getSettings());
     }

     applySessionIntents(session) {
       this._activeSession = session;
       this.voiceAgentRequested = session.intents.voiceAgentRequested;
       this.translationRequested = session.intents.translationRequested;
       this.assistantSelectionContext = session.intents.assistantSelectionContext;
     }
   ```

   The `applySessionIntents` assignments must not go through `setVoiceAgentRequested`, because that setter (`:707-720`) also clears pending selection and screen state.
2. **Start points.**
   - In `startRecording`, after the guard at `:1145-1153` passes, call `this.beginDictationSession({ streaming: false, streamingProviderName: null });`.
   - In `startStreamingRecording`, after its guard (`:3419-3427`), resolve the provider from **live** settings before the new session exists, then begin it:

     ```js
         this._activeSession = null; // never let the previous session's pin leak into a new start
         const streamingProviderName = resolveStreamingProviderName({ settings: getSettings(), context: "dictation" });
         this.beginDictationSession({ streaming: true, streamingProviderName });
     ```

   - **A session ends at the idle edge.** Add:

     ```js
       _endDictationSession(session) {
         if (session && this._activeSession === session) this._activeSession = null;
       }
     ```

     Call `this._endDictationSession(this._activeSession)` in three places:
     - in `_settleProcessingPipeline` (≈1735) when it settles the active pipeline;
     - in the `finally` of `stopStreamingRecording` (3745–3760) where it reports idle;
     - in the idle branch of `cancelRecording` / `cancelStreamingRecording` (Task 8 hands the session to the cancel buffer first).

     Between dictations, `settings()` is plain live settings, so warm-up and the next start never see a stale pin.
3. **Read sites.** Each line below reads live settings today. Change each to `this.settings()`, or pass the view, and keep everything else the same.

   | Site | Change |
   |---|---|
   | `processAudio` `:1777` | `const settings = this.settings();` |
   | `processWithLocalWhisper` `:1953`, `:1960-1961` | `getEffectiveSttLanguage(this.settings())`, `getWhisperPrompt(this.settings())`. `getCustomDictionaryPrompt` (`:570`) uses `getDictionaryHintWords(this.settings())` |
   | `processWithLocalParakeet` `:2147` | `getEffectiveSttLanguage(this.settings())` |
   | `processWithOpenAIAPI` `:2912` | `const settings = this.settings();`, and add `correlationId: this._activeSession?.id ?? null` to the payload (`:2934-2951`) |
   | `getTranscriptionModel` `:2992` | `const s = this.settings();` |
   | `getKeyterms` `:2907` | `this.settings().customDictionary` |
   | `processTranscriptionCore` `:2594-2600` | `const settings = this.settings();`, `const cleanupModel = selectResolvedLLMConfig(settings, "dictationCleanup").model;`, `const agentName = this._activeSession?.agentName ?? getAgentName();` (import `selectResolvedLLMConfig` from the settings store) |
   | `isReasoningAvailable` `:2444` | `const s = this.settings();` and `ReasoningService.isAvailable(s)` (see 5) |
   | `processWithReasoningModel` `:2248` | `dictationAgentPrompt(this.settings(), agentName)` |
   | `_bankPanelAgentCommand` `:2301` | `this.settings()` |
   | `consumeSelectionCapture` `:768-777` | `probeEditable: Boolean(this.settings().autoPasteEnabled)` |
   | `processAgentCommand` `:2345` | `this.settings().autoPasteEnabled` |
   | `finalizeChineseScript` `:608` / `getEffectiveOutputLanguage` `:584` | default `settings = this.settings()` |
   | `getStreamingProviderName` `:822` | `return this._activeSession?.intents.streamingProviderName ?? resolveStreamingProviderName({ settings: this.settings(), context: "dictation" })` |
   | `_finalizeStreamingRecording` `:4006` | `this.settings()` |
   | streaming `provider.start` options (`:3586-3603`) | `settings: this.settings()`, and add `correlationId: this._activeSession.id` to `buildStreamingSessionOptions(...)` |

   Then run `grep -n "getSettings()\|getEffectiveCleanupModel()" src/helpers/audioManager.js`. Every remaining hit must be outside the dictation pipeline: retention (`getEffectiveRetentionPreferences`), analytics, `shouldUseStreaming` (decided before the session exists), preview UI, and save paths. The source guard test above names the pipeline methods.

   Two latent identifiers. `warmupStreamingConnection` (`:3254`) and the `provider.start` call (`:3593`) reference `usesKeywords` and `dictionary`, which are declared only inside `processWithOpenAIAPI` (`:2924-2925`). While you are editing the `provider.start` options, define both locally at that site:
   - `const usesKeywords = false;` (realtime providers take keyterms, not a prompt);
   - `const dictionary = this.getCustomDictionaryArray?.() ?? [];`.

   Do the same in `warmupStreamingConnection`. `test/helpers/audioManagerStreamingFinalization.test.js` must stay green.
4. **Explicit cleanup route.**
   - In `resolveReasoningRoute` (`:214-220`), give `cleanupConfig` the provider and endpoint that `ReasoningService.processText` used to fill in implicitly (`ReasoningService.ts:70-87`). Compute them from the `settings` argument, which is now the session view:

     ```js
       const cleanupConfig = {
         inferenceScope: /** @type {const} */ ("dictationCleanup"),
         disableThinking: settings.cleanupDisableThinking,
         temperature: cleanupTemperature,
         requireCompleteOutput: true,
         provider:
           settings.cleanupMode === "local" ? "local"
           : settings.cleanupMode === "self-hosted" ? "lan"
           : settings.cleanupProvider,
         baseUrl: settings.cleanupCloudBaseUrl,
         lanUrl: settings.cleanupMode === "self-hosted" ? settings.cleanupRemoteUrl : undefined,
         settingsView: settings,
       };
     ```

   - Agent and translation configs already carry `provider` / `lanUrl` / `baseUrl` / `credentialRef` (`dictationAgentInference.js:36-48`, `dictationTranslationInference.js:30-41`). Add `settingsView: settings` to each in `resolveReasoningRoute`, and add `correlationId: this._activeSession?.id` where the route config is handed to `processWithReasoningModel` / `processAgentCommand` / `runTranslationChain`.
5. **ReasoningService and prompts.**
   - `ReasoningService.processText` (`:65-141`): replace `const settings = getSettings();` with `const settings = config.settingsView ?? getSettings();`. The implicit branch stays for non-dictation callers.
   - `isAvailable(settingsView?)`: read `settingsView ?? getSettings()`.
   - `requestConfig` (`:34-62`): add `correlationId: config.correlationId ?? null` to the request object.
   - `BaseReasoningService.get*` (`:33-58`): each getter reads `this.config?.settingsView ?? getSettings()`. If the getters do not receive `config`, change their signatures to take it from `processText`, the only caller on this path.
   - `src/config/prompts/index.ts`: `resolvePrompt(kind, opts)` uses `opts.customPrompts ?? useSettingsStore.getState().customPrompts`.
   - `dictationAgentPrompt(settings, agentName)` (`audioManager.js:140-147`) and the translate prompt in `resolveReasoningRoute` (`:231-247`) pass `customPrompts: settings.customPrompts`.
6. **Correlation id across IPC.**
   - `src/helpers/ipcHandlers.js:7964-7989`: add `correlationId` to the destructured `transcribe-audio-file-byok` arguments and pass it to the job registration and to any egress gate call Plan 07 has installed.
   - `src/helpers/personalInference.js` `validateRequest` (`:93-130`): accept an optional `correlationId` string of at most 100 characters.
   - `src/types/personalInferenceTypes.ts` `TextRequest`: add `correlationId?: string | null`.
   - `buildStreamingSessionOptions` (`dictationStreamingRouting.js:47-70`) passes `correlationId` through, and the hardened `dictation-realtime-start` allowlist (`ipcHandlers.js`, see the #1624 comment at `:300-302`) admits it. The per-provider start channels (Deepgram, AssemblyAI, Gemini, Corti) admit it too.
   - `test/helpers/audioManagerStreamingRouting.test.js` pins that allowlist; extend it with the new field.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/dictationSession.test.js test/helpers/audioManagerSessionRoute.test.js "test/helpers/audioManager*.test.js" "test/helpers/useAudioRecording*.test.js" "test/services/*.test.js"`
Expected: PASS. If an existing reasoning test asserted the implicit cleanup provider, update it to the explicit config: the provider and endpoint are the same values, now passed in.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/dictationSession.js src/helpers/audioManager.js src/services src/config/prompts/index.ts src/helpers/ipcHandlers.js src/helpers/personalInference.js src/types/personalInferenceTypes.ts src/helpers/dictationStreamingRouting.js test
git commit -m "feat(voice): dictation sessions pin their route at recording start"
```

---

### Task 7: Who already received it: shared types and attested disclosure

Closes review finding I5, and settles the disclosure shape with Plan 07 (CCR-6).

"OpenAI already received the audio" is a claim about egress, so main must attest it. When Plan 07's egress gate is present, a disclosure is recorded only when main emits a `{ phase: "sent" }` `EgressNotice` with this session's `correlationId` and a content payload. When it is absent, which happens only if Plan 07 has not merged, the renderer records evidence only **after** a request has actually been handed to the transport. That means after `provider.start()` succeeded, or after a transcription or text request returned or failed *after* dispatch. The copy then says "may have received", never "already received".

Startup failures, main-side validation rejections and Sealed-mode blocks record nothing. Translation, cleanup, Agent and vision requests are covered, not only speech. Provider-mode custom endpoints on loopback resolve to the device through Plan 03's resolver (clarification 9), so they never produce a disclosure.

**Files:**
- Create: `src/types/dictation.ts`. These are the shared §5.2 types (CCR-1 to CCR-3, CCR-6) that Plans 05 and 07 import.
- Create: `src/helpers/dictationDisclosure.js`
- Modify: `src/helpers/dictationSession.js`. `captureDictationSession` also stores `session.routes`: the Plan 03 `ResolvedRoute` for `dictationStt`, `dictationCleanup`, `translation`, `voiceAssistant` and `assistantVision`, resolved from the snapshot.
- Modify: `src/helpers/audioManager.js`:
  - add the per-session disclosure tracker;
  - attach main's egress feed;
  - record route evidence at the four dispatch points in Step 4.
- Modify: `src/helpers/ipcHandlers.js` `transcribe-audio-file-byok` (`:7964-8009`). Return `dispatched: false` on every path that fails **before** the provider request is sent: validation, a missing key, an unsupported route, or a Sealed block.
- Test: `test/helpers/dictationDisclosure.test.js`

**Interfaces:**
- Produces `src/types/dictation.ts`:

  ```ts
  export type DisclosurePayload = "audio" | "text" | "image";
  export type DisclosureTask = "dictationStt" | "dictationCleanup" | "translation" | "voiceAssistant" | "assistantVision";
  /** Who already received part of a dictation. `target` is a provider id ("openai", "custom") or "host:<hostname>"
   *  for the user's own server on the network. Render it with dispatchTargetLabel(target, t). */
  export interface RemoteDisclosure {
    target: string;
    payload: DisclosurePayload;          // strongest seen: audio > image > text
    evidence: "attested" | "dispatched"; // attested = main's EgressNotice; dispatched = transport hand-off seen by the renderer
    alsoSentTo: string[];                // every other target that received part of this dictation (never hidden)
  }
  export interface CancelledState {
    sessionId: string;
    undoUntil: number;                   // epoch ms the window closes; frozen while paused
    paused: boolean;
    remainingMs: number;                 // what is left of the window (equals undoUntil - now when running)
    remoteAlreadySent: RemoteDisclosure | null;
  }
  export type UndoResult =
    | { restored: true; sessionId: string }
    | { restored: false; sessionId: string | null; reason: "expired" | "busy" | "sealed" | "routeUnavailable" | "noAudio" | "unavailable" };
  export type DictationOutcome =
    | { sessionId: string; kind: "pasted"; words: number; at: number }
    | { sessionId: string; kind: "failed"; at: number };
  export interface MeetingPresence { sessionId: string; startedAt: number; interruption: "systemAudio" | "mic" | null; quiet: boolean }
  export type MeetingOutcome =
    | { sessionId: string; kind: "saved"; durationMs: number; noteId: string | null }
    | { sessionId: string; kind: "failed"; reason: "save" | "stop" | "ownerLost" };
  ```

- Produces `src/helpers/dictationDisclosure.js`:

  ```js
  export const PAYLOAD_RANK = { text: 1, image: 2, audio: 3 };
  export function disclosureTargetFor(route, settingsView): string | null; // null = stays on this device
  export function dispatchTargetLabel(target, t): string;                  // providerDisplayLabel, or the bare host
  export function disclosureCopy(d, t): string;                            // the caption text
  export function createDisclosureTracker({ session, onChange }): {
    record({ task, payload, evidence }): void; get(): RemoteDisclosure | null; attested(): boolean;
    setOnChange(fn): void; dispose(): void;
  };
  export function attachEgressEvidence(tracker, sessionId, privacyApi?): () => void; // no-op when Plan 07 is absent
  ```

- [ ] **Step 1: Write the failing test**

Create `test/helpers/dictationDisclosure.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const load = () => import("../../src/helpers/dictationDisclosure.js");
const route = (id, locality, providerId = null) => ({ id, locality, providerId, provider: null, state: { status: "ready" } });
const session = (routes) => ({ id: "rec-1", routes, settings: { remoteTranscriptionUrl: "http://gpu-box.lan:8080/v1", cleanupRemoteUrl: "http://10.0.0.5:11434/v1" } });

test("targets come from the session's resolved route: device is silent, network is a host, remote is a provider id", async () => {
  const { disclosureTargetFor } = await load();
  const s = session({});
  assert.equal(disclosureTargetFor(route("dictationStt", "device"), s.settings), null);
  assert.equal(disclosureTargetFor(route("dictationStt", "network"), s.settings), "host:gpu-box.lan:8080");
  assert.equal(disclosureTargetFor(route("dictationCleanup", "network"), s.settings), "host:10.0.0.5:11434");
  assert.equal(disclosureTargetFor(route("dictationStt", "remote", "openai"), s.settings), "openai");
  assert.equal(disclosureTargetFor(route("dictationStt", "remote", null), s.settings), "", "unknown remote still discloses");
});

test("a loopback custom endpoint resolves to the device and never discloses (Plan 03 clarification 9)", async () => {
  const { disclosureTargetFor } = await load();
  // Plan 03's resolver reports provider-mode custom on localhost as device.
  assert.equal(disclosureTargetFor(route("dictationCleanup", "device", null), {}), null);
});

test("labels are localised through providerDisplayLabel", async () => {
  const { dispatchTargetLabel, disclosureCopy } = await load();
  const t = (k, o) => (o ? `${k}|${o.provider}` : k);
  assert.equal(dispatchTargetLabel("openai", t), "OpenAI");
  assert.equal(dispatchTargetLabel("host:gpu-box.lan:8080", t), "gpu-box.lan:8080");
  assert.equal(dispatchTargetLabel("custom", t), "locality.customEndpoint");
  assert.equal(dispatchTargetLabel("", t), "locality.unknownProvider");
  assert.equal(disclosureCopy({ target: "openai", payload: "audio", evidence: "attested", alsoSentTo: [] }, t), "pill.caption.remoteAudio|OpenAI");
  assert.equal(disclosureCopy({ target: "anthropic", payload: "text", evidence: "dispatched", alsoSentTo: [] }, t), "pill.caption.mayHaveText|Anthropic");
  assert.equal(
    disclosureCopy({ target: "openai", payload: "audio", evidence: "attested", alsoSentTo: ["anthropic"] }, t),
    "pill.caption.remoteSeveral|OpenAI, Anthropic"
  );
});

test("every receiver is named; the primary is the strongest evidence, then the strongest payload", async () => {
  const { createDisclosureTracker } = await load();
  const s = session({
    dictationStt: route("dictationStt", "device"),
    translation: route("translation", "remote", "anthropic"),
    dictationCleanup: route("dictationCleanup", "remote", "openai"),
  });
  const seen = [];
  const tracker = createDisclosureTracker({ session: s, onChange: (d) => seen.push(d) });
  tracker.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" }); // local STT: nothing
  assert.equal(tracker.get(), null);
  tracker.record({ task: "translation", payload: "text", evidence: "dispatched" });
  assert.deepEqual(tracker.get(), { target: "anthropic", payload: "text", evidence: "dispatched", alsoSentTo: [] });
  tracker.record({ task: "dictationCleanup", payload: "text", evidence: "attested" });
  assert.deepEqual(tracker.get(), { target: "openai", payload: "text", evidence: "attested", alsoSentTo: ["anthropic"] });
  assert.equal(seen.length, 2);
});

test("an attested receiver is never downgraded by a later renderer-side guess", async () => {
  const { createDisclosureTracker } = await load();
  const s = session({ dictationStt: route("dictationStt", "remote", "openai") });
  const tracker = createDisclosureTracker({ session: s });
  tracker.record({ task: "dictationStt", payload: "audio", evidence: "attested" });
  tracker.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" });
  assert.deepEqual(tracker.get(), { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: [] });
});

test("setOnChange redirects later evidence to a new listener (cancel window updates)", async () => {
  const { createDisclosureTracker } = await load();
  const s = session({ dictationStt: route("dictationStt", "remote", "openai") });
  const tracker = createDisclosureTracker({ session: s });
  const seen = [];
  tracker.setOnChange((d) => seen.push(d.evidence));
  tracker.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" });
  tracker.record({ task: "dictationStt", payload: "audio", evidence: "attested" });
  assert.deepEqual(seen, ["dispatched", "attested"]);
});

test("main's egress feed records only this session's content payloads", async () => {
  const { createDisclosureTracker, attachEgressEvidence } = await load();
  const s = session({ dictationStt: route("dictationStt", "remote", "openai") });
  const tracker = createDisclosureTracker({ session: s });
  const bus = new EventEmitter();
  const privacy = { onEgress: (cb) => (bus.on("n", cb), () => bus.off("n", cb)) };
  const off = attachEgressEvidence(tracker, "rec-1", privacy);
  bus.emit("n", { phase: "sent", task: "dictationStt", host: "api.openai.com", payload: "metadata", correlationId: "rec-1", ts: 1, ticketId: 1 });
  bus.emit("n", { phase: "sent", task: "dictationStt", host: "api.openai.com", payload: "audio", correlationId: "rec-2", ts: 1, ticketId: 2 });
  assert.equal(tracker.get(), null, "token fetches and other sessions do not count");
  bus.emit("n", { phase: "sent", task: "dictationStt", host: "api.openai.com", payload: "audio", correlationId: "rec-1", ts: 1, ticketId: 3 });
  assert.deepEqual(tracker.get(), { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: [] });
  assert.equal(tracker.attested(), true);
  off();
  assert.equal(attachEgressEvidence(tracker, "rec-1", undefined)(), undefined, "absent Plan 07 is a no-op");
});
```

Add these AudioManager cases to the same file. They use the `loadAudioManager` harness and the session from Task 6.

```js
const { loadAudioManager } = require("./harness/audioManager");

async function managerWith(t, electronAPI) {
  const loaded = await loadAudioManager(t, { cachePrefix: "openwhispr-disclosure-", settingsKey: "__disclosureSettings",
    settings: { useLocalWhisper: false, cloudTranscriptionProvider: "openai", transcriptionMode: "providers", openaiApiKey: "sk" } });
  loaded.window.electronAPI = { ...loaded.window.electronAPI, cancelUploadTranscription: () => {}, ...electronAPI };
  const manager = Object.assign(Object.create(loaded.AudioManager.prototype), { getTranscriptionModel: () => "whisper-1" });
  manager.beginDictationSession({});
  return manager;
}

test("a request main rejected before dispatch discloses nothing", async (t) => {
  const manager = await managerWith(t, {
    transcribeAudioFileByok: async () => ({ success: false, dispatched: false, code: "SEALED_BLOCKED" }),
  });
  await manager.processWithOpenAIAPI(new Blob([new Uint8Array(8)]), {}, () => false).catch(() => {});
  assert.equal(manager.getDisclosure(), null);
});

test("a request that reached the provider discloses as dispatched", async (t) => {
  const manager = await managerWith(t, { transcribeAudioFileByok: async () => ({ success: false, error: "429", status: 429 }) });
  await manager.processWithOpenAIAPI(new Blob([new Uint8Array(8)]), {}, () => false).catch(() => {});
  assert.deepEqual(manager.getDisclosure(), { target: "openai", payload: "audio", evidence: "dispatched", alsoSentTo: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/dictationDisclosure.test.js`
Expected: FAIL with `Cannot find module '…/dictationDisclosure.js'`.

- [ ] **Step 3: Implement the types and the tracker**

Create `src/types/dictation.ts` with exactly the Interfaces block above.

Create `src/helpers/dictationDisclosure.js`:

```js
import { providerDisplayLabel } from "../lib/locality";

export const PAYLOAD_RANK = { text: 1, image: 2, audio: 3 };

// The user's own server is named by host; every other non-device route by
// provider id. Network-route URLs come from the session's own snapshot.
const NETWORK_URL_KEY = {
  dictationStt: "remoteTranscriptionUrl",
  dictationCleanup: "cleanupRemoteUrl",
  translation: "translationRemoteUrl",
  voiceAssistant: "dictationAgentRemoteUrl",
  assistantVision: "dictationAgentRemoteUrl",
};

export function disclosureTargetFor(route, settingsView = {}) {
  if (!route || route.locality === "device") return null;
  if (route.locality === "network") {
    try {
      return `host:${new URL(settingsView[NETWORK_URL_KEY[route.id]]).host}`;
    } catch {
      return "host:";
    }
  }
  return route.providerId ?? "";
}

export function dispatchTargetLabel(target, t) {
  if (typeof target === "string" && target.startsWith("host:")) return target.slice(5) || t("locality.network");
  return providerDisplayLabel(target, t);
}

export function disclosureCopy(d, t) {
  if (d.alsoSentTo?.length) {
    // Several receivers: name them all rather than hide any (one string, not one per payload).
    const providers = [d.target, ...d.alsoSentTo].map((x) => dispatchTargetLabel(x, t)).join(", ");
    return t(d.evidence === "attested" ? "pill.caption.remoteSeveral" : "pill.caption.mayHaveSeveral", { provider: providers });
  }
  const noun = d.payload === "audio" ? "Audio" : d.payload === "image" ? "Image" : "Text";
  const key = d.evidence === "attested" ? `pill.caption.remote${noun}` : `pill.caption.mayHave${noun}`;
  return t(key, { provider: dispatchTargetLabel(d.target, t) });
}

const EVIDENCE_RANK = { dispatched: 1, attested: 2 };

export function createDisclosureTracker({ session, onChange } = {}) {
  let listener = onChange;
  const byTarget = new Map(); // target -> { payload, evidence }
  let attested = false;
  let current = null;
  const settingsView = session?.settings ?? {};
  const summarize = () => {
    const entries = [...byTarget.entries()].sort(
      ([, a], [, b]) =>
        EVIDENCE_RANK[b.evidence] - EVIDENCE_RANK[a.evidence] || PAYLOAD_RANK[b.payload] - PAYLOAD_RANK[a.payload]
    );
    if (!entries.length) return null;
    const [[target, top], ...rest] = entries;
    return { target, payload: top.payload, evidence: top.evidence, alsoSentTo: rest.map(([t]) => t) };
  };
  return {
    record({ task, payload, evidence }) {
      if (!PAYLOAD_RANK[payload]) return; // "metadata" never counts
      const target = disclosureTargetFor(session?.routes?.[task], settingsView);
      if (target === null) return;
      if (evidence === "attested") attested = true;
      const prev = byTarget.get(target);
      const next = {
        payload: prev && PAYLOAD_RANK[prev.payload] > PAYLOAD_RANK[payload] ? prev.payload : payload,
        evidence: prev?.evidence === "attested" ? "attested" : evidence,
      };
      if (prev && prev.payload === next.payload && prev.evidence === next.evidence) return;
      byTarget.set(target, next);
      current = summarize();
      listener?.(current);
    },
    get: () => current,
    attested: () => attested,
    setOnChange(fn) {
      listener = fn;
    },
    dispose() {
      byTarget.clear();
      current = null;
      listener = undefined;
    },
  };
}

/** Plan 07's main-attested egress: `sent` notices for this session's correlation id. */
export function attachEgressEvidence(tracker, sessionId, privacyApi = globalThis.window?.electronAPI?.privacy) {
  if (!privacyApi?.onEgress) return () => undefined;
  return privacyApi.onEgress((notice) => {
    if (notice?.phase !== "sent" || notice.correlationId !== sessionId) return;
    tracker.record({ task: notice.task, payload: notice.payload, evidence: "attested" });
  });
}
```

Check the remote-URL key names for the agent and translation scopes in `inferenceScopes.ts` (`grep -n "RemoteUrl" src/config/inferenceScopes.ts`), and correct the `translation` and agent entries in `NETWORK_URL_KEY` if they differ. The session snapshot contains them because `SESSION_ROUTE_KEYS` includes every key of those scopes (Task 6).

In `captureDictationSession` (`dictationSession.js`), resolve the session's routes once, from the snapshot:

```js
import { buildRouteSnapshot, resolveRoute } from "../lib/routes";
const DISCLOSURE_TASKS = ["dictationStt", "dictationCleanup", "translation", "voiceAssistant", "assistantVision"];
// …inside captureDictationSession, after `snapshot` is built:
const routeSnapshot = buildRouteSnapshot({ ...settings, ...snapshot });
const routes = Object.fromEntries(DISCLOSURE_TASKS.map((id) => [id, resolveRoute(routeSnapshot, id)]));
// …and add `routes` to the frozen session object.
```

`buildRouteSnapshot` and `resolveRoute` are Plan 03 exports (Plan 03, "Additive exports"). If `buildRouteSnapshot` needs main-process facts as a second argument, pass `{}`: unknown facts never downgrade a route (Plan 03 clarification 2), and the tracker reads only `locality` and `providerId`.

- [ ] **Step 4: Record evidence in `AudioManager`**

1. **Tracker per session.** In `beginDictationSession` (Task 6), and in `applySessionIntents(session, { tracker } = {})`:

   ```js
     this._detachEgress?.();
     // A restored session keeps the evidence gathered before its cancel (Task 8 passes buffer.tracker).
     this._disclosure = tracker ?? createDisclosureTracker({ session: this._activeSession });
     this._detachEgress = attachEgressEvidence(this._disclosure, this._activeSession.id);
   ```

   Never dispose a tracker here: a cancel buffer may own it (Task 8). The buffer disposes it when its window closes.

   Add `getDisclosure() { return this._disclosure?.get() ?? null; }`. Cancel paths (Task 8) read it when they build `CancelledState`.
2. **Route evidence.** These record only when no attested feed exists; the tracker enforces that.
   - **Streaming.** In `startStreamingRecording`, capture `const tracker = this._disclosure;` before `await provider.start(...)`. Once it resolves with `res.success` (`:3594`), call `tracker?.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" })`. Audio frames are already buffered in main by then (`ipcHandlers.js:7053-7055`). A thrown or unsuccessful start records nothing. A cancel during the connect moves `this._disclosure` into the cancel buffer (Task 8), and the captured tracker still records onto that cancelled session. Task 8's replay records the same way.
   - **Batch STT.** In `processWithOpenAIAPI`, capture `const tracker = this._disclosure;` **before** the `await`. After `transcribeAudioFileByok` settles (`:2952`), call `tracker?.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" })` unless `result?.dispatched === false`. A thrown IPC error records only if `error?.dispatched !== false`. Recording into the captured tracker means evidence that settles after a cancel still lands on the cancelled session (whose buffer now owns that tracker), never on the next session.
   - **Text (cleanup, agent, vision, translation).** Wrap the three call sites that hand a request to `ReasoningService`: `processWithReasoningModel` (`:2199`), `processAgentCommand`'s call (`:2419`) and both `runTranslationChain` steps (`:2507`, `:2518`). Use this helper:

     ```js
       async _dispatchText(task, payload, run) {
         const tracker = this._disclosure; // the session that sent it, even if it is cancelled meanwhile
         try {
           const result = await run();
           tracker?.record({ task, payload, evidence: "dispatched" });
           return result;
         } catch (error) {
           if (error?.dispatched !== false) tracker?.record({ task, payload, evidence: "dispatched" });
           throw error;
         }
       }
     ```

     Use these task values:
     - cleanup → `"dictationCleanup"`;
     - the translate step → `"translation"`;
     - agent → `"voiceAssistant"`, plus a second `record({ task: "assistantVision", payload: "image" })` when the agent request carried `screenContext`.

     Local routes resolve to a `null` target, so local cleanup or agent calls record nothing.
3. **Processing stage.** The hook shows "Transcribing…" and "Cleaning up" from this callback (Tasks 9, 10).
   - In `setCallbacks` (`:629`), add `onProcessingStage = undefined` to the destructure and `this.onProcessingStage = onProcessingStage;` to the body.
   - Emit `this.onProcessingStage?.("transcribing")` at the top of `processAudio` (after `const wasCancelled = …`, `:1775`) and right after the streaming finalize reports processing (`≈3886`).
   - Emit `this.onProcessingStage?.("cleaning")` in `processTranscriptionCore` directly before the cleanup or translation request (`≈2689`), when `route.kind !== "agent"`. Agent turns show the orbit instead.

   Add a test to `dictationDisclosure.test.js`:

   ```js
   test("the cleaning stage is announced before the cleanup request", () => {
     const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../src/helpers/audioManager.js"), "utf8");
     const core = src.slice(src.indexOf("async processTranscriptionCore("), src.indexOf("async processTranscriptionCore(") + 9000);
     assert.ok(core.indexOf('onProcessingStage?.("cleaning")') > 0);
     assert.ok(core.indexOf('onProcessingStage?.("cleaning")') < core.indexOf("processWithReasoningModel("));
   });
   ```
4. **`dispatched: false` in main.** In `transcribe-audio-file-byok` (`ipcHandlers.js:7964-8009`), every `return { success: false, … }` or thrown error before the provider HTTP call carries `dispatched: false`. This covers validation, missing credentials, `resolveTranscriptionRoute` errors and Plan 07's Sealed block. In `personalInference.js`, do the same for `validateRequest` rejections and for credential-status failures before the provider call: rejected promises carry `error.dispatched = false`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/dictationDisclosure.test.js test/helpers/dictationSession.test.js test/helpers/audioManagerSessionRoute.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/dictation.ts src/helpers/dictationDisclosure.js src/helpers/dictationSession.js src/helpers/audioManager.js src/helpers/ipcHandlers.js src/helpers/personalInference.js test/helpers/dictationDisclosure.test.js
git commit -m "feat(voice): disclosure is attested by main, or recorded only after dispatch"
```

---

### Task 8: The RAM-only cancel buffer and same-route Undo (D3)

Closes review findings C1, I1, I2 and the AudioManager half of I3. The owner-confirmed D3 rules this task must satisfy, each with its test:

| D3 rule | How | Pinned by |
|---|---|---|
| Held in RAM only, never on disk (temp files included) unless retention already saves discarded audio | The buffer holds the **raw** recorded segments (batch) or PCM frames plus fallback segments (streaming) as owned byte copies. Nothing calls `mergeAudioSegments` (FFmpeg temp files, `ffmpegUtils.js:474-509`) while holding. A merge happens only after Undo (the audio is then a normal dictation again) or at expiry when `shouldSaveDiscardedRecording` allows saving | "two segments, retention off: no merge, no write, every byte zeroed (C1)". A merge already running in main when the cancel lands is the one exception (see "Known limit", Step 4) |
| Zeroed on expiry, including late bytes, and no Blob stays reachable | Every byte copy is owned by the buffer. A copy that finishes after the buffer closed is zeroed on arrival, and rejected copies are swallowed. Source Blob references (`segmentChunks`, `_batchSegments`, `_streamingFallbackSegments`, `streamingFallbackChunks`, `_sessionAudio`, and `lastAudioBlob` when it belongs to the cancelled session) are dropped at cancel. Immutable browser Blobs cannot be overwritten; they become unreachable and the browser frees them | "late bytes are zeroed", "only the cancelled session's lastAudioBlob is released (I1)" |
| Undo replays the original route | The buffer carries the frozen `DictationSession` (Task 6). Restore applies it, so every read goes through the snapshot. Main still enforces Sealed mode, and the renderer pre-checks it to fail explicitly | "Undo restores through the session's route even after settings move to a provider (C2)", "streaming Undo replays the frames through the same provider…", "Sealed mode refuses a non-device Undo and keeps the recording held" |
| Every cancel path gets Undo | Recording, mic recovery, segment merge, transcription and cleanup (batch); recording and finalization (streaming). A cancel during startup, before any audio exists, has nothing to restore and shows no Undo | one test per path |
| Esc and new starts during restore | Restore claims the buffer and enters `isProcessing` **synchronously**, before any await. A start is rejected by the existing guard, and Esc is lifecycle-owned (Task 9) | "Undo is claimed synchronously…", "Esc while a restore waits for its bytes cancels it and puts the recording back (I3)" |

**Streaming Undo replays through the same streaming provider.** Batch endpoints are not used: Deepgram and AssemblyAI have none (`STREAMING_ONLY_PROVIDERS`), and a different endpoint would be a different route. The buffer keeps the exact 16 kHz PCM frames that were sent to the provider, and restore opens a new session with the same provider and options. It replays the frames at 4× real time (main buffers frames while connecting, `ipcHandlers.js:7053-7055`), then runs the normal streaming finalization. The fallback WebM segments are kept only to give history the same audio file a normal streaming dictation saves.

**Files:**
- Create: `src/helpers/cancelBuffer.js`
- Modify: `src/helpers/audioManager.js`:
  - the cancel paths: `cancelRecording` (1605–1640), `discardBatchRecording` (1641–1646), `cancelProcessing` (1745–1770) and `cancelStreamingRecording` (3781–3843);
  - `finalizeBatchRecording` (1407–1503): register the session's raw segments before the merge;
  - streaming capture: `startStreamingRecording` (3415–3706), the worklet `port.onmessage` (3500) and the fallback recorder (3335–3373);
  - `_finalizeStreamingRecording` (3846–4082): a `replay` mode that tolerates the missing microphone objects;
  - `lastAudioBlob` ownership (1447, 3935);
  - new methods `restoreCancelled`, `pauseCancelHold`, `resumeCancelHold`, `flushCancelHold`, `_replayStreamingSession`;
  - delete `persistDiscardedBatchRecording` (1675–1722), which `_closeCancelled` replaces.
- Modify: `docs/PRIVACY.md`. Add the undo paragraph after the paragraph at line 16.
- Test: `test/helpers/cancelBuffer.test.js`
- Test: `test/helpers/audioManagerCancelBuffer.test.js`

**Interfaces:**
- Consumes `DictationSession`, `applySessionIntents`, `settings()` (Task 6), `getDisclosure()` and the session's disclosure tracker (Task 7), `CancelledState`, `UndoResult` (`src/types/dictation.ts`, Task 7), `shouldSaveDiscardedRecording`, and `canStartDictation` (`src/utils/dictationReadiness.ts:19-29`).
- Produces:

  ```js
  // src/helpers/cancelBuffer.js
  export const UNDO_WINDOW_MS = 5000, LONG_UNDO_WINDOW_MS = 10000, LONG_RECORDING_SECONDS = 30;
  export const REPLAY_BATCH_FRAMES = 4, REPLAY_PACE_MS = 50; // 4×800-sample frames per 50 ms ≈ 4× real time
  export function undoWindowMs(durationSeconds: number | null): number;
  export function createCancelBuffer({ session, kind: "batch" | "streaming", mimeType, durationSeconds, analyticsOccurredAt, tracker }): CancelBuffer;
  // CancelBuffer: { session, kind, mimeType, durationSeconds, analyticsOccurredAt, tracker,
  //   adoptBlob(blob, role: "segment" | "fallback"): void; adoptFrames(frames: Int16Array[]): void;
  //   ready(): Promise<void>; bytes(role): Uint8Array[]; frames(): Int16Array[]; zero(): void; isZeroed(): boolean }
  export function createUndoWindow({ now?, setTimer?, clearTimer?, onClose }): {
    open(buffer): void; peek(): CancelBuffer | null; take(): CancelBuffer | null;
    pause(): void; resume(): void; expireNow(): Promise<void>;
    state(): { undoUntil: number; paused: boolean; remainingMs: number } | null;
  };
  // onClose(buffer, reason: "expired" | "replaced" | "flushed") may return a promise; the buffer is zeroed after it settles.
  ```

  ```js
  // AudioManager
  restoreCancelled(sessionId?: string): Promise<UndoResult>; // settles once the pipeline starts; the run is this._restoreRun
  pauseCancelHold(): void; resumeCancelHold(): void;
  flushCancelHold(): Promise<void>;                 // persist if retention allows, then zero (shutdown, Task 9)
  // emits onCancelledChange(CancelledState) whenever the window opens, pauses, resumes or gets new
  // disclosure evidence, and onCancelledChange(null, { sessionId, reason }) when it closes,
  // reason: "expired" | "replaced" | "flushed" | "restored"
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/cancelBuffer.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { deferred } = require("./harness/deferred");

const load = () => import("../../src/helpers/cancelBuffer.js");
const session = { id: "rec-1", settings: {}, intents: {}, routes: {} };
const blobOf = (bytes) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer });

function timers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => (pending.set(++seq, { fn, at: now + ms }), seq),
    clearTimer: (id) => pending.delete(id),
    async advance(ms) {
      now += ms;
      for (const [id, t] of [...pending]) if (t.at <= now) (pending.delete(id), t.fn());
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    },
  };
}

test("the window is 5s, or 10s past 30s of audio", async () => {
  const { undoWindowMs } = await load();
  assert.deepEqual([undoWindowMs(4), undoWindowMs(30), undoWindowMs(30.5), undoWindowMs(null)], [5000, 5000, 10000, 5000]);
});

test("the buffer owns copies of every source and zeroes them", async () => {
  const { createCancelBuffer } = await load();
  const buffer = createCancelBuffer({ session, kind: "batch", mimeType: "audio/webm", durationSeconds: 4 });
  buffer.adoptBlob(blobOf([1, 2]), "segment");
  buffer.adoptBlob(blobOf([3]), "segment");
  const frame = new Int16Array([5, 6]);
  buffer.adoptFrames([frame]);
  await buffer.ready();
  const [a, b] = buffer.bytes("segment");
  assert.deepEqual([...a, ...b], [1, 2, 3]);
  buffer.zero();
  assert.deepEqual([...a, ...b, ...frame], [0, 0, 0, 0, 0]);
  assert.equal(buffer.isZeroed(), true);
  assert.deepEqual(buffer.bytes("segment"), []);
});

test("bytes that arrive after the buffer was zeroed are zeroed on arrival (I1)", async () => {
  const { createCancelBuffer } = await load();
  const late = deferred();
  const buffer = createCancelBuffer({ session, kind: "batch", mimeType: "audio/webm", durationSeconds: 4 });
  buffer.adoptBlob({ arrayBuffer: () => late.promise }, "segment");
  buffer.zero();
  const arriving = new Uint8Array([7, 8, 9]);
  late.resolve(arriving.buffer);
  await buffer.ready();
  assert.deepEqual([...arriving], [0, 0, 0]);
  assert.deepEqual(buffer.bytes("segment"), []);
});

test("a rejected copy never throws and never leaves a slot", async () => {
  const { createCancelBuffer } = await load();
  const buffer = createCancelBuffer({ session, kind: "batch", mimeType: "audio/webm", durationSeconds: 4 });
  buffer.adoptBlob({ arrayBuffer: () => Promise.reject(new Error("gone")) }, "segment");
  await buffer.ready();
  assert.deepEqual(buffer.bytes("segment"), []);
});

test("the window closes on time, zeroes after onClose settles, and reports why", async () => {
  const { createCancelBuffer, createUndoWindow } = await load();
  const clock = timers();
  const closed = [];
  const win = createUndoWindow({ ...clock, onClose: async (buf, reason) => closed.push([buf.session.id, reason, buf.isZeroed()]) });
  const buffer = createCancelBuffer({ session, kind: "batch", mimeType: "audio/webm", durationSeconds: 4 });
  buffer.adoptBlob(blobOf([1]), "segment");
  win.open(buffer);
  assert.deepEqual(win.state(), { undoUntil: 5000, paused: false, remainingMs: 5000 });
  await clock.advance(4999);
  assert.equal(closed.length, 0);
  await clock.advance(1);
  assert.deepEqual(closed, [["rec-1", "expired", false]], "onClose sees the bytes");
  assert.equal(buffer.isZeroed(), true, "then they are zeroed");
  assert.equal(win.peek(), null);
});

test("pause freezes the window; resume continues; a newer cancel replaces the older one", async () => {
  const { createCancelBuffer, createUndoWindow } = await load();
  const clock = timers();
  const closed = [];
  const win = createUndoWindow({ ...clock, onClose: (b, reason) => closed.push([b.session.id, reason]) });
  const first = createCancelBuffer({ session, kind: "batch", mimeType: "audio/webm", durationSeconds: 45 });
  win.open(first);
  await clock.advance(4000);
  win.pause();
  assert.deepEqual(win.state(), { undoUntil: 10000, paused: true, remainingMs: 6000 });
  await clock.advance(60_000);
  assert.equal(closed.length, 0);
  win.resume();
  assert.deepEqual(win.state(), { undoUntil: 70000, paused: false, remainingMs: 6000 });
  win.open(createCancelBuffer({ session: { ...session, id: "rec-2" }, kind: "batch", mimeType: "audio/webm", durationSeconds: 1 }));
  await clock.advance(0);
  assert.deepEqual(closed, [["rec-1", "replaced"]]);
});

test("take() ends the window without closing it; expireNow is idempotent", async () => {
  const { createCancelBuffer, createUndoWindow } = await load();
  const clock = timers();
  let closes = 0;
  const win = createUndoWindow({ ...clock, onClose: () => closes++ });
  const buffer = createCancelBuffer({ session, kind: "batch", mimeType: "audio/webm", durationSeconds: 4 });
  win.open(buffer);
  assert.equal(win.take(), buffer);
  await clock.advance(20_000);
  assert.equal(closes, 0);
  win.open(createCancelBuffer({ session, kind: "batch", mimeType: "audio/webm", durationSeconds: 4 }));
  await win.expireNow();
  await win.expireNow();
  assert.equal(closes, 1);
});
```

Create `test/helpers/audioManagerCancelBuffer.test.js`. It drives the real cancel and restore methods, and stubs only the leaf transports and the MediaRecorder.

Fixtures follow the real guards:
- Blobs are at least `MIN_AUDIO_BYTES` (256, `recordingGuard.js:8`), so `mergeRecordedSegments` keeps them.
- `_receivedAudioData` is set.
- `recordingStartTime` is two seconds in the past, so the window is the 5 s one.

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");
const { deferred } = require("./harness/deferred");

const RETAIN = { saveDiscardedTranscriptions: true, dataRetentionEnabled: true, audioRetentionDays: 30 };
const LOCAL = {
  useLocalWhisper: true, localTranscriptionProvider: "nvidia", parakeetModel: "parakeet-tdt-0.6b-v3",
  cloudTranscriptionProvider: "openai", transcriptionMode: "providers", useCleanupModel: false,
  saveDiscardedTranscriptions: false, dataRetentionEnabled: true, audioRetentionDays: 30, openaiApiKey: "sk",
};

// 300-byte audio whose every byte is `fill`, so a test can tell segments apart.
const blob = (fill) => new Blob([new Uint8Array(300).fill(fill)], { type: "audio/webm" });
const firstByte = (bytes) => bytes[0];
const allZero = (bytes) => bytes.every((b) => b === 0);

async function setup(t, settings = LOCAL) {
  const loaded = await loadAudioManager(t, { cachePrefix: "openwhispr-cancel-buffer-", settingsKey: "__cancelBufferSettings", settings });
  const { createUndoWindow } = await loaded.vite.ssrLoadModule("/helpers/cancelBuffer.js");
  let now = 0;
  let seq = 0;
  const pending = new Map();
  const clock = {
    now: () => now,
    setTimer: (fn, ms) => (pending.set(++seq, { fn, at: now + ms }), seq),
    clearTimer: (id) => pending.delete(id),
  };
  const advance = async (ms) => {
    now += ms;
    for (const [id, e] of [...pending]) if (e.at <= now) (pending.delete(id), e.fn());
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  };
  const io = { merges: 0, saves: 0, local: 0, byok: [], streamStarts: [], streamSends: 0, cancelled: [], closed: [] };
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    mergeAudioSegments: async (payload) => {
      io.merges += 1; // FFmpeg temp files in main
      return { success: true, buffer: new Uint8Array(payload[0].buffer).buffer, mimeType: "audio/webm" };
    },
    transcribeAudioFileByok: async (p) => (io.byok.push(p), { success: true, text: "hi" }),
    cancelUploadTranscription: () => {},
    dismissDictationPreview: () => {},
    privacy: { getSealed: async () => false },
  };
  const manager = Object.assign(Object.create(loaded.AudioManager.prototype), {
    _undoWindowFactory: (opts) => createUndoWindow({ ...clock, ...opts }),
    _processingCancellationGeneration: 0,
    _streamingCancellationGeneration: 0,
    _streamingSessionGeneration: 0,
    _localSpeechGateState: null,
    _receivedAudioData: true,
    _batchSegments: [],
    audioChunks: [],
    micRecovery: { stop() {} },
    teardownSpeechGate() {},
    cleanupPreview() {},
    _closeBatchPcmTap() {},
    _markCaptureStreamReleased() {},
    onStateChange: () => {},
    onCancelledChange: (s, closed) => {
      io.cancelled.push(s);
      if (closed) io.closed.push(closed);
    },
    onTranscriptionComplete: () => {},
    saveDiscardedTranscription: async () => {
      io.saves += 1;
    },
    processWithLocalParakeet: async () => (io.local += 1, { success: true, text: "hi", source: "local-parakeet" }),
    processTranscription: async (text) => text,
  });
  // If a real method reaches another helper that needs a stub, add it above; keep the assertions.
  return { ...loaded, manager, io, advance };
}

function startBatch(manager, segmentFills, chunkFill) {
  manager.beginDictationSession({ streaming: false });
  manager.isRecording = true;
  manager.recordingStartTime = Date.now() - 2000;
  manager._batchSegments = segmentFills.map(blob);
  const recorder = { state: "recording", stream: null, onstop: null, stop() { this.state = "inactive"; this.onstop?.(); } };
  manager.mediaRecorder = recorder;
  manager.audioChunks = [blob(chunkFill)];
  return recorder;
}

test("two segments, retention off: no merge, no write, every byte zeroed (C1)", async (t) => {
  const { manager, io, advance } = await setup(t);
  startBatch(manager, [1, 2], 3);
  manager.cancelRecording();
  await advance(0);
  assert.equal(io.cancelled.at(-1).sessionId, manager._undo.peek().session.id);
  const held = manager._undo.peek();
  await held.ready();
  const views = held.bytes("segment");
  assert.deepEqual(views.map(firstByte), [1, 2, 3]);
  await advance(5000);
  assert.equal(io.merges, 0, "FFmpeg (temp files) never ran");
  assert.equal(io.saves, 0);
  assert.ok(views.every(allZero), "zeroed");
  assert.equal(io.cancelled.at(-1), null);
  assert.deepEqual(io.closed.at(-1), { sessionId: held.session.id, reason: "expired" });
});

test("retention on: expiry merges and saves exactly once, then zeroes", async (t) => {
  const { manager, io, advance, setSettings } = await setup(t, { ...LOCAL, ...RETAIN });
  setSettings({ ...LOCAL, ...RETAIN });
  startBatch(manager, [1, 2], 3);
  manager.cancelRecording();
  await advance(5000);
  assert.equal(io.merges, 1, "the merge is allowed only because retention saves discarded audio");
  assert.equal(io.saves, 1);
});

test("only the cancelled session's lastAudioBlob is released (I1)", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [], 2);
  manager.lastAudioBlob = blob(9);
  manager._lastAudioSessionId = manager.activeSession.id;
  manager.cancelRecording();
  await advance(0);
  assert.equal(manager.lastAudioBlob, null, "the cancelled session's audio is unreachable");
  assert.deepEqual(manager._batchSegments, []);
  assert.deepEqual(manager.audioChunks, []);

  const other = await setup(t);
  startBatch(other.manager, [], 2);
  const newer = blob(7);
  other.manager.lastAudioBlob = newer;
  other.manager._lastAudioSessionId = "a-different-session";
  other.manager.cancelRecording();
  await other.advance(5000);
  assert.equal(other.manager.lastAudioBlob, newer, "another session's audio is never cleared");
});

test("a cancel during the segment merge holds the raw segments (merge-time cancel)", async (t) => {
  const { manager, io, advance } = await setup(t);
  manager.beginDictationSession({ streaming: false });
  manager.isRecording = true;
  manager.recordingStartTime = Date.now() - 2000;
  manager._batchSegments = [blob(1), blob(2)];
  const merge = deferred();
  manager.mergeRecordedSegments = () => merge.promise;
  const finalizing = manager.finalizeBatchRecording(null);
  await advance(0);
  assert.equal(manager.cancelProcessing(), true);
  await advance(0);
  const held = manager._undo.peek();
  await held.ready();
  assert.equal(held.kind, "batch");
  assert.deepEqual(held.bytes("segment").map(firstByte), [1, 2]);
  merge.resolve(blob(3));
  await finalizing;
  assert.equal(io.local, 0, "the abandoned pipeline transcribed nothing");
});

test("a cancel during transcription holds the raw segments, not the merged blob", async (t) => {
  const { manager, advance } = await setup(t);
  manager.beginDictationSession({ streaming: false });
  manager.isRecording = true;
  manager.recordingStartTime = Date.now() - 2000;
  manager._batchSegments = [blob(4)];
  const stt = deferred();
  manager.processWithLocalParakeet = () => stt.promise;
  const finalizing = manager.finalizeBatchRecording(null);
  await advance(0);
  assert.equal(manager.cancelProcessing(), true);
  await advance(0);
  const held = manager._undo.peek();
  await held.ready();
  assert.deepEqual(held.bytes("segment").map(firstByte), [4]);
  assert.equal(manager._sessionAudio ?? null, null, "the session's audio references were released");
  stt.resolve({ success: true, text: "late" });
  await finalizing;
});

test("a cancel during startup, before any audio exists, offers nothing to undo", async (t) => {
  const { manager, io, advance } = await setup(t);
  manager.cancelRecording(); // no recorder, not recording
  await advance(0);
  assert.equal(io.cancelled.length, 0);
  assert.equal(manager._undo?.peek() ?? null, null);
});

test("Undo restores through the session's route even after settings move to a provider (C2)", async (t) => {
  const { manager, io, advance, setSettings } = await setup(t);
  startBatch(manager, [], 3);
  const sessionId = manager.activeSession.id;
  manager.cancelRecording();
  await advance(0);
  setSettings({ ...LOCAL, useLocalWhisper: false }); // switch to OpenAI during the window
  const result = await manager.restoreCancelled(sessionId);
  assert.deepEqual(result, { restored: true, sessionId });
  await manager._restoreRun;
  assert.equal(io.local, 1);
  assert.equal(io.byok.length, 0, "local audio never left the device");
});

test("Undo is claimed synchronously: a start during a pending restore is rejected (I3)", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  const gate = deferred();
  held.ready = () => gate.promise;
  const restoring = manager.restoreCancelled();
  assert.equal(manager.isProcessing, true, "busy before any await");
  assert.equal(await manager.startRecording(), false);
  gate.resolve();
  await restoring;
  await manager._restoreRun;
});

test("Esc while a restore waits for its bytes cancels it and puts the recording back (I3)", async (t) => {
  const { manager, io, advance } = await setup(t);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  const gate = deferred();
  held.ready = () => gate.promise;
  const restoring = manager.restoreCancelled();
  manager.cancelProcessing(); // Esc
  gate.resolve();
  const result = await restoring;
  assert.equal(result.restored, false);
  assert.equal(manager.isProcessing, false);
  assert.equal(io.local, 0, "nothing was transcribed or pasted");
  assert.equal(manager._undo.peek(), held, "the recording is held again, not lost");
});

test("a restore whose bytes fail settles idle and says so", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  held.ready = async () => {
    throw new Error("boom");
  };
  const result = await manager.restoreCancelled();
  assert.equal(result.restored, false);
  assert.equal(result.reason, "noAudio");
  assert.equal(manager.isProcessing, false);
  assert.equal(held.isZeroed(), true);
});

test("Sealed mode refuses a non-device Undo and keeps the recording held", async (t) => {
  const { manager, window: win, advance } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  win.electronAPI.privacy = { getSealed: async () => true };
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  assert.equal((await manager.restoreCancelled()).reason, "sealed");
  assert.equal(manager._undo.peek(), held, "content is preserved on refusal");
  assert.equal(held.isZeroed(), false);
  assert.equal(manager.isProcessing, false);
});

function streamingManager(manager) {
  manager.beginDictationSession({ streaming: true, streamingProviderName: "openai-realtime" });
  manager._sessionAudio = {
    session: manager.activeSession, kind: "streaming",
    frames: [new Int16Array([1, 2]), new Int16Array([3])],
    fallbackChunks: [blob(5)], fallbackSegments: [],
    mimeType: "audio/webm", durationSeconds: null, analyticsOccurredAt: "x",
  };
  manager.isStreaming = true;
  manager.recordingStartTime = Date.now() - 40_000;
  manager.cleanupStreamingAudio = () => {};
  manager.cleanupStreamingListeners = () => {};
  manager.getStreamingProvider = () => ({ stop: async () => ({}) });
}

test("a streaming cancel while recording holds the frames, with the long window for >30 s", async (t) => {
  const { manager, io, advance } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  const held = manager._undo.peek();
  assert.equal(held.kind, "streaming");
  assert.equal(held.frames().length, 2);
  assert.equal(io.cancelled.at(-1).remainingMs, 10_000, "duration was read before recordingStartTime was cleared");
});

test("a streaming cancel during finalization (Esc → cancelProcessing) holds the frames too (I2)", async (t) => {
  const { manager, advance } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  streamingManager(manager);
  manager.isProcessing = true;
  manager._streamingStopPromise = new Promise(() => {}); // finalization in flight
  manager._requestStreamingCancellation = () => {};
  assert.equal(manager.cancelProcessing(), true);
  await advance(0);
  assert.equal(manager._undo.peek().kind, "streaming");
});

test("streaming Undo replays the frames through the same provider and cleans up after itself", async (t) => {
  const { manager, io, advance, window: win } = await setup(t, { ...LOCAL, useLocalWhisper: false, cloudTranscriptionModel: "gpt-4o-mini-transcribe" });
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  const held = manager._undo.peek();
  win.electronAPI.dictationRealtimeStart = async (opts) => (io.streamStarts.push(opts), { success: true });
  win.electronAPI.dictationRealtimeSend = () => (io.streamSends += 1);
  win.electronAPI.dictationRealtimeStop = async () => ({});
  manager._finalizeStreamingRecording = async (sessionId, { replay } = {}) => {
    assert.equal(replay, true);
    assert.equal(typeof sessionId, "number");
  };
  manager._attachStreamingListeners = () => {};
  const result = await manager.restoreCancelled();
  assert.equal(result.restored, true);
  await manager._restoreRun;
  assert.equal(io.streamStarts[0].provider, "openai-realtime");
  assert.equal(io.streamStarts[0].correlationId, held.session.id);
  assert.equal(io.streamSends, 2);
  assert.equal(held.isZeroed(), true);
  assert.equal(manager.isStreaming, false, "a finished replay never leaves the manager stuck");
});

test("a replay whose provider refuses to start leaves the manager usable and re-holds the audio", async (t) => {
  const { manager, io, advance, window: win } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  win.electronAPI.dictationRealtimeStart = async () => ({ success: false, error: "429" });
  win.electronAPI.dictationRealtimeStop = async () => ({});
  manager._attachStreamingListeners = () => {};
  await manager.restoreCancelled();
  await manager._restoreRun;
  assert.equal(manager.isStreaming, false);
  assert.equal(manager.isProcessing, false);
  assert.equal(manager._undo.peek()?.kind, "streaming", "the audio is offered for Undo again");
  assert.equal(io.streamSends, 0);
});

test("flush persists once when retention allows; with retention off it only zeroes", async (t) => {
  const on = await setup(t, { ...LOCAL, ...RETAIN });
  on.setSettings({ ...LOCAL, ...RETAIN });
  startBatch(on.manager, [], 3);
  on.manager.cancelRecording();
  await on.advance(0);
  await on.manager.flushCancelHold();
  await on.manager.flushCancelHold();
  assert.equal(on.io.saves, 1);
  assert.deepEqual(on.io.closed.at(-1).reason, "flushed");
});
```

`startRecording()` in the I3 test runs the real guard (`:1145-1153`). If the prototype instance lacks a field that guard reads, add it to `setup`. The streaming tests replace the provider-facing leaves (`cleanupStreamingAudio`, `cleanupStreamingListeners`, `_attachStreamingListeners`, the `dictationRealtime*` IPC). The cancel, hold and replay logic under test is real.


- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/cancelBuffer.test.js test/helpers/audioManagerCancelBuffer.test.js`
Expected: FAIL with `Cannot find module '…/cancelBuffer.js'`.

- [ ] **Step 3: Implement `cancelBuffer.js`**

```js
// D3: a cancelled dictation is held in RAM only, for a short undo window, and
// zeroed when the window closes. The buffer owns byte copies of every source;
// a copy that completes after the buffer was zeroed is zeroed on arrival.
export const UNDO_WINDOW_MS = 5000;
export const LONG_UNDO_WINDOW_MS = 10000;
export const LONG_RECORDING_SECONDS = 30;
export const REPLAY_BATCH_FRAMES = 4;
export const REPLAY_PACE_MS = 50;

export function undoWindowMs(durationSeconds) {
  return Number(durationSeconds) > LONG_RECORDING_SECONDS ? LONG_UNDO_WINDOW_MS : UNDO_WINDOW_MS;
}

export function createCancelBuffer({ session, kind, mimeType, durationSeconds, analyticsOccurredAt, tracker = null }) {
  const owned = []; // { role, bytes: Uint8Array }
  const frames = []; // Int16Array, transferred from the worklet
  const pending = new Set();
  let zeroed = false;

  return {
    session,
    kind,
    mimeType: mimeType || "audio/webm",
    durationSeconds,
    analyticsOccurredAt,
    tracker,
    adoptBlob(blob, role) {
      if (!blob) return;
      const copy = Promise.resolve()
        .then(() => blob.arrayBuffer())
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          if (zeroed) bytes.fill(0);
          else owned.push({ role, bytes });
        })
        .catch(() => {});
      pending.add(copy);
      copy.finally(() => pending.delete(copy));
    },
    adoptFrames(list) {
      for (const frame of list) {
        if (zeroed) frame.fill(0);
        else frames.push(frame);
      }
    },
    async ready() {
      while (pending.size) await Promise.all([...pending]);
    },
    bytes: (role) => owned.filter((o) => o.role === role).map((o) => o.bytes),
    frames: () => [...frames],
    zero() {
      zeroed = true;
      owned.forEach((o) => o.bytes.fill(0));
      owned.length = 0;
      frames.forEach((f) => f.fill(0));
      frames.length = 0;
    },
    isZeroed: () => zeroed,
  };
}

export function createUndoWindow({
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onClose,
} = {}) {
  let current = null; // { buffer, expiresAt, remainingMs, timer }

  const close = async (entry, reason) => {
    try {
      await onClose?.(entry.buffer, reason);
    } finally {
      entry.buffer.zero();
    }
  };

  const end = (reason) => {
    if (!current) return Promise.resolve();
    const entry = current;
    current = null;
    clearTimer(entry.timer);
    return close(entry, reason);
  };

  return {
    open(buffer) {
      if (current) void end("replaced");
      const ms = undoWindowMs(buffer.durationSeconds);
      current = { buffer, expiresAt: now() + ms, remainingMs: null, timer: setTimer(() => void end("expired"), ms) };
    },
    peek: () => current?.buffer ?? null,
    take() {
      if (!current) return null;
      const { buffer, timer } = current;
      clearTimer(timer);
      current = null;
      return buffer;
    },
    pause() {
      if (!current || current.remainingMs !== null) return;
      clearTimer(current.timer);
      current.remainingMs = Math.max(0, current.expiresAt - now());
    },
    resume() {
      if (!current || current.remainingMs === null) return;
      const ms = current.remainingMs;
      current.remainingMs = null;
      current.expiresAt = now() + ms;
      current.timer = setTimer(() => void end("expired"), ms);
    },
    expireNow: () => end("flushed"),
    state() {
      if (!current) return null;
      const paused = current.remainingMs !== null;
      return {
        undoUntil: paused ? now() + current.remainingMs : current.expiresAt,
        paused,
        remainingMs: paused ? current.remainingMs : Math.max(0, current.expiresAt - now()),
      };
    },
  };
}
```

- [ ] **Step 4: Session audio and the cancel paths in `AudioManager`**

1. **Imports and the window.** Add `import { createCancelBuffer, createUndoWindow, REPLAY_BATCH_FRAMES, REPLAY_PACE_MS } from "./cancelBuffer";` and `import { canStartDictation } from "../utils/dictationReadiness";`. Then add:

   ```js
     _undoWindow() {
       const factory = this._undoWindowFactory ?? createUndoWindow;
       return (this._undo ??= factory({ onClose: (buffer, reason) => this._closeCancelled(buffer, reason) }));
     }

     _emitCancelled(buffer) {
       const state = this._undo?.state();
       if (!state || this._undo.peek() !== buffer) return;
       this.onCancelledChange?.({
         sessionId: buffer.session.id,
         ...state,
         remoteAlreadySent: buffer.tracker?.get() ?? null,
       });
     }

     _openCancelled(buffer) {
       this._undoWindow().open(buffer);
       // Evidence that settles after the cancel (an upload that finished
       // sending, an attested egress notice) updates the copy while open.
       buffer.tracker?.setOnChange(() => this._emitCancelled(buffer));
       this._emitCancelled(buffer);
     }

     async _closeCancelled(buffer, reason) {
       this.onCancelledChange?.(null, { sessionId: buffer.session.id, reason });
       buffer.tracker?.dispose();
       if (reason === "replaced" && this._undo?.peek()) this._emitCancelled(this._undo.peek());
       await buffer.ready();
       if (!shouldSaveDiscardedRecording(getSettings(), buffer.durationSeconds)) return; // zeroed by the window
       const role = buffer.kind === "streaming" ? "fallback" : "segment";
       const blobs = buffer.bytes(role).map((bytes) => new Blob([bytes], { type: buffer.mimeType }));
       if (blobs.length === 0) return;
       try {
         // Disk is allowed here only because retention already saves discarded audio.
         const merged = blobs.length === 1 ? blobs[0] : await this.mergeRecordedSegments(blobs);
         if (merged) await this.saveDiscardedTranscription(merged, buffer.durationSeconds, buffer.analyticsOccurredAt);
       } catch (error) {
         logger.warn("Failed to save discarded recording", { error: error.message }, "audio");
       }
     }

     /** Move the active session, its tracker and its audio into a new buffer; release every other reference. */
     _bufferForSession(kind, { durationSeconds, analyticsOccurredAt, mimeType }) {
       const session = this._activeSession;
       const buffer = createCancelBuffer({
         session, kind, mimeType: mimeType || this.recordingMimeType,
         durationSeconds, analyticsOccurredAt, tracker: this._disclosure,
       });
       this._disclosure = null; // the buffer owns the tracker now
       if (this._lastAudioSessionId === session.id) {
         this.lastAudioBlob = null;
         this._lastAudioSessionId = null;
       }
       if (this._sessionAudio?.session === session) this._sessionAudio = null;
       this._endDictationSession(session); // Task 6
       return buffer;
     }
   ```

   Task 9 relies on `onCancelledChange(state, closed)`. `closed` is passed only when the state goes to `null`, as `{ sessionId, reason }`, where reason is `"expired" | "replaced" | "flushed" | "restored"`.
2. **`lastAudioBlob` ownership.** At both assignments (`:1447` batch, `:3935` streaming), also set `this._lastAudioSessionId = this._activeSession?.id ?? null;`.
3. **Batch cancel while recording** (`cancelRecording`, 1611–1631). Replace the snapshot/`persistDiscardedBatchRecording` wiring:

   ```js
     if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
       const recorder = this.mediaRecorder;
       const snapshot = this.takeDiscardedBatchSnapshot();
       const buffer = this._bufferForSession("batch", snapshot);
       for (const segment of snapshot.segments) buffer.adoptBlob(segment, "segment");
       snapshot.segments.length = 0;
       this.mediaRecorder.onstop = () => {
         recorder.stream?.getTracks().forEach((track) => track.stop());
         // The final dataavailable has landed: take the open segment and drop
         // every reference to its Blob chunks.
         buffer.adoptBlob(new Blob(snapshot.chunks, { type: snapshot.mimeType }), "segment");
         snapshot.chunks.length = 0;
       };
       this.resetDiscardedBatchRecordingState();
       recorder.stop();
       if (recorder.stream) {
         recorder.stream.getTracks().forEach((track) => track.stop());
         this._markCaptureStreamReleased();
       }
       this._openCancelled(buffer);
       return true;
     }
   ```

   `takeDiscardedBatchSnapshot` returns the live `segmentChunks` array (it is `this.audioChunks`) and the `_batchSegments` array, so clearing them releases the Blobs.

   At the top of `cancelRecording` and `cancelProcessing`, add `this._restoreGeneration = (this._restoreGeneration ?? 0) + 1;`. A restore waiting on an `await` sees the change and stands down (Step 5).
4. **`discardBatchRecording`** (mic died, 1641–1646):

   ```js
     discardBatchRecording() {
       const snapshot = this.takeDiscardedBatchSnapshot();
       this.resetDiscardedBatchRecordingState();
       const buffer = this._bufferForSession("batch", snapshot);
       for (const segment of snapshot.segments) buffer.adoptBlob(segment, "segment");
       if (snapshot.chunks.length) buffer.adoptBlob(new Blob(snapshot.chunks, { type: snapshot.mimeType }), "segment");
       snapshot.segments.length = 0;
       snapshot.chunks.length = 0;
       this._openCancelled(buffer);
     }
   ```

   Cancel during mic recovery ends in one of these two paths once the swap settles (`replaceBatchMic` `finally`, 1533–1541), so it gets Undo. Delete `persistDiscardedBatchRecording`; no caller remains.
5. **Merge-time and processing-time cancel (batch).** In `finalizeBatchRecording`:
   - Move the `durationSeconds` / `analyticsOccurredAt` computation (1458–1461) above the merge, before line 1431.
   - Directly after `segments` is built (1425–1428), add:

     ```js
       this._sessionAudio = {
         session: this._activeSession, kind: "batch", segments,
         mimeType: this.recordingMimeType, durationSeconds, analyticsOccurredAt,
       };
     ```

   - `_settleProcessingPipeline` (≈1735) sets `this._sessionAudio = null` when it settles the active pipeline. A completed dictation keeps no undo copy.
6. **Streaming capture.**
   - In `startStreamingRecording`, after `beginDictationSession(...)` (Task 6):

     ```js
       this._streamingFallbackSegments = [];
       this._sessionAudio = {
         session: this._activeSession, kind: "streaming", frames: [],
         fallbackChunks: null, fallbackSegments: this._streamingFallbackSegments,
         mimeType: "audio/webm", durationSeconds: null, analyticsOccurredAt: new Date().toISOString(),
       };
     ```

     The existing reset at `:3469` moves here.
   - In `startStreamingFallbackRecorder` (3335), after `this.streamingFallbackChunks = chunks;`, add `if (this._sessionAudio?.kind === "streaming") this._sessionAudio.fallbackChunks = chunks;`.
   - In the worklet handler (3500), after `provider.send(event.data);`, add `this._sessionAudio?.frames?.push(new Int16Array(event.data));`. `send` structured-clones the buffer across IPC, so the renderer keeps ownership of `event.data`.
   - **A completed streaming dictation drops its copy.** At the end of `_finalizeStreamingRecording`, and in the `finally` of `stopStreamingRecording` (3745–3760), call `this._dropSessionAudio()`:

     ```js
       _dropSessionAudio() {
         const held = this._sessionAudio;
         if (!held) return;
         held.frames?.forEach((frame) => frame.fill(0));
         if (held.frames) held.frames.length = 0;
         this._sessionAudio = null;
       }
     ```

7. **Streaming hold, shared by both streaming cancel paths:**

   ```js
     _holdStreamingSession() {
       const held = this._sessionAudio;
       if (held?.kind !== "streaming" || held.session !== this._activeSession || !held.frames.length) return false;
       // Read the duration before any cancel path clears recordingStartTime.
       held.durationSeconds = this.recordingStartTime ? (Date.now() - this.recordingStartTime) / 1000 : held.durationSeconds;
       const buffer = this._bufferForSession("streaming", held);
       buffer.adoptFrames(held.frames.splice(0));
       for (const segment of held.fallbackSegments.splice(0)) buffer.adoptBlob(segment, "fallback");
       if (held.fallbackChunks?.length) {
         buffer.adoptBlob(new Blob(held.fallbackChunks, { type: "audio/webm" }), "fallback");
         held.fallbackChunks.length = 0;
       }
       this._openCancelled(buffer);
       return true;
     }
   ```

   - **Recording path.** In `cancelStreamingRecording` (3781), call `this._holdStreamingSession();` as the first statement after `_requestStreamingCancellation()`. That is before `this.recordingStartTime = null` (`:3792`) and before `_streamingFallbackSegments` is reset (`:3803`).
   - **Finalization path.** In `cancelProcessing` (1745), the hook's Esc while a streaming dictation finalises. Before `if (this._streamingStopPromise) return true;`, call `this._holdStreamingSession();`. `_finalizeStreamingRecording` computes its own duration before clearing the start time (`:3871-3874`). Keep `recordingStartTime` until after this call.

   A streaming session with no frames yet (cancelled during startup) has nothing to hold and opens no window.
8. **Batch hold in `cancelProcessing`.** After the streaming call above, and after the generation bump:

   ```js
       const held = this._sessionAudio;
       if (held?.kind === "batch" && held.session === this._activeSession) {
         const buffer = this._bufferForSession("batch", held);
         for (const segment of held.segments) buffer.adoptBlob(segment, "segment");
         held.segments.length = 0;
         this._openCancelled(buffer);
       }
   ```

9. **A new recording finalizes any open window first.** At the very start of `startRecording()` and `startStreamingRecording()`, before the guards: `if (this._undo?.peek()) void this._undo.expireNow();`.

**Known limit (also in PRIVACY.md and Task 20).** These cases predate the cancel, so the buffer cannot unwrite them:
- A cancel can land while main is already merging segments (`merge-audio-segments` writes an FFmpeg temp directory, removed in its `finally`, `ffmpegUtils.js:474-552`).
- A local engine may already have written its own temporary input.

The buffer itself never writes. Those files belong to the processing step that was already running, and are removed when that step ends. An abandoned pipeline's local variables (its merged Blob, `metadata.rawWav`) become unreachable when its in-flight await settles.

- [ ] **Step 5: Restore**

`restoreCancelled` claims the recording synchronously, finishes its pre-checks, and returns an `UndoResult`. The pipeline then runs detached, as `this._restoreRun`, so the cross-window bridge (2 s, Task 9) gets an answer even when transcription takes longer.

A refusal before the pipeline starts (sealed, busy, a cancel that arrived meanwhile) puts the recording back in its window. Undo never costs the user their words.

```js
  async restoreCancelled(sessionId) {
    const buffer = this._undo?.peek();
    if (!buffer || (sessionId && buffer.session.id !== sessionId)) {
      return { restored: false, sessionId: sessionId ?? null, reason: "expired" };
    }
    if (!canStartDictation(this.getState())) {
      return { restored: false, sessionId: buffer.session.id, reason: "busy" };
    }
    // Claim before any await (I3): the window closes, the lifecycle is busy.
    this._undo.take();
    const generation = (this._restoreGeneration = (this._restoreGeneration ?? 0) + 1);
    this.isProcessing = true;
    this.onStateChange?.({ isRecording: false, isProcessing: true });
    this.onCancelledChange?.(null, { sessionId: buffer.session.id, reason: "restored" });

    const settleIdle = () => {
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    };
    const refuse = (reason, { keep }) => {
      settleIdle();
      if (keep) this._openCancelled(buffer); // content is preserved
      else buffer.zero();
      return { restored: false, sessionId: buffer.session.id, reason };
    };

    try {
      await buffer.ready();
    } catch {
      return refuse("noAudio", { keep: false });
    }
    if (generation !== this._restoreGeneration) return refuse("busy", { keep: true });
    if (await this._sealedBlocks(buffer.session)) return refuse("sealed", { keep: true });
    if (generation !== this._restoreGeneration) return refuse("busy", { keep: true });
    const empty = buffer.kind === "streaming" ? !buffer.frames().length : !buffer.bytes("segment").length;
    if (empty) return refuse("noAudio", { keep: false });
    if (buffer.kind === "streaming" && !STREAMING_PROVIDERS[buffer.session.intents.streamingProviderName]) {
      return refuse("routeUnavailable", { keep: true }); // never re-route; the window keeps the words until it ends
    }

    this.applySessionIntents(buffer.session, { tracker: buffer.tracker }); // Task 7 keeps the evidence
    this._restoreRun = (buffer.kind === "streaming" ? this._replayStreamingSession(buffer, generation) : this._restoreBatch(buffer))
      .catch((error) => {
        logger.warn("Undo could not run the original route", { error: error?.message }, "audio");
        this.onError?.(error);
      })
      .finally(() => buffer.zero());
    return { restored: true, sessionId: buffer.session.id };
  }

  async _restoreBatch(buffer) {
    const blobs = buffer.bytes("segment").map((bytes) => new Blob([bytes], { type: buffer.mimeType }));
    buffer.zero(); // the Blobs are the restored dictation's own audio now
    // Re-register the audio first, so an Esc during this restore re-holds it (Step 4.8).
    this._sessionAudio = {
      session: buffer.session, kind: "batch", segments: blobs, mimeType: buffer.mimeType,
      durationSeconds: buffer.durationSeconds, analyticsOccurredAt: buffer.analyticsOccurredAt,
    };
    const pipeline = this._startProcessingPipeline(); // Esc bumps its generation (cancelProcessing)
    const audio = blobs.length === 1 ? blobs[0] : await this.mergeRecordedSegments(blobs);
    await this.processAudio(
      audio,
      { durationSeconds: buffer.durationSeconds, analyticsOccurredAt: buffer.analyticsOccurredAt, restoredFromCancel: true },
      pipeline
    );
  }

  async _sealedBlocks(session) {
    const sealed = await window.electronAPI?.privacy?.getSealed?.().catch(() => true);
    if (!sealed) return false;
    const routes = session.routes ?? {};
    const { intents, settings } = session;
    const used = [
      routes.dictationStt,
      settings.useCleanupModel ? routes.dictationCleanup : null,
      intents.translationRequested ? routes.translation : null,
      intents.voiceAgentRequested ? routes.voiceAssistant : null,
      intents.voiceAgentRequested && settings.voiceAgentScreenContext ? routes.assistantVision : null,
    ];
    return used.some((r) => r && r.locality !== "device" && r.state?.status !== "off");
  }

  pauseCancelHold() {
    const buffer = this._undo?.peek();
    if (!buffer) return;
    this._undo.pause();
    this._emitCancelled(buffer);
  }

  resumeCancelHold() {
    const buffer = this._undo?.peek();
    if (!buffer) return;
    this._undo.resume();
    this._emitCancelled(buffer);
  }

  flushCancelHold() {
    return this._undo?.expireNow() ?? Promise.resolve();
  }
```

- `processAudio(audio, metadata, pipeline)` returns early when `_activeProcessingPipeline !== pipeline` (`:1773-1774`), and `wasCancelled()` is true once `cancelProcessing` bumps the generation. An Esc during a batch restore therefore stops the pipeline, and Step 4.8 re-holds `_sessionAudio`.
- `getSealed` failing is treated as sealed, failing closed like Plan 07's own `getSealed`. When Plan 07 has not merged, `privacy` is `undefined` and nothing is blocked.

Streaming replay. It owns its streaming state from start to finish, so a failure can never leave `isStreaming` set:

```js
  async _replayStreamingSession(buffer, generation) {
    const { session } = buffer;
    const providerName = session.intents.streamingProviderName;
    const provider = STREAMING_PROVIDERS[providerName];
    const sessionId = (this._activeStreamingSessionId = ++this._streamingSessionGeneration);
    // Keep a copy for an Esc mid-replay (Step 4.7) before the buffer is zeroed.
    this._sessionAudio = {
      session, kind: "streaming", frames: buffer.frames().map((f) => f.slice()),
      fallbackChunks: null, fallbackSegments: buffer.bytes("fallback").map((b) => new Blob([b], { type: "audio/webm" })),
      mimeType: "audio/webm", durationSeconds: buffer.durationSeconds, analyticsOccurredAt: buffer.analyticsOccurredAt,
    };
    this._streamingFallbackSegments = this._sessionAudio.fallbackSegments;
    let started = false;
    try {
      this.isStreaming = true;
      this._attachStreamingListeners(sessionId);
      const settings = this.settings();
      const tracker = this._disclosure;
      const res = await provider.start(
        buildStreamingSessionOptions({
          providerName, settings,
          language: this.getEffectiveSttLanguage(settings),
          keyterms: this.getKeyterms(),
          voiceAgentRequested: session.intents.voiceAgentRequested,
          correlationId: session.id,
        })
      );
      if (!res?.success) throw Object.assign(new Error(res?.error || "Streaming start failed"), { code: res?.code });
      started = true;
      tracker?.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" });
      const frames = buffer.frames();
      for (let i = 0; i < frames.length; i += REPLAY_BATCH_FRAMES) {
        if (generation !== this._restoreGeneration) throw Object.assign(new Error("Undo cancelled"), { code: "TRANSCRIPTION_CANCELLED" });
        for (const frame of frames.slice(i, i + REPLAY_BATCH_FRAMES)) provider.send(frame.buffer.slice(0));
        await new Promise((resolve) => setTimeout(resolve, REPLAY_PACE_MS));
      }
      buffer.zero();
      this._streamingStopPromise = this._finalizeStreamingRecording(sessionId, { replay: true });
      await this._streamingStopPromise;
    } catch (error) {
      if (started) await provider?.stop?.().catch(() => {});
      // Nothing was transcribed: offer the same audio for Undo again.
      if (!started || error?.code === "TRANSCRIPTION_CANCELLED") this._holdStreamingSession();
      if (error?.code !== "TRANSCRIPTION_CANCELLED") throw error;
    } finally {
      this._streamingStopPromise = null;
      if (this._activeStreamingSessionId === sessionId) this._activeStreamingSessionId = null;
      this.isStreaming = false;
      if (this.isProcessing) {
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false, isStreaming: false });
      }
      this._endDictationSession(session);
    }
  }
```

- Extract the listener registration (`:3511-3556`) from `startStreamingRecording` into `_attachStreamingListeners(sessionId)`, and call it from both places.
- Change `_finalizeStreamingRecording(sessionId)` to `_finalizeStreamingRecording(sessionId, { replay = false } = {})`. When `replay` is true, skip the mic-swap wait (`:3888`), the worklet flush (`:3894-3905`) and the fallback-recorder finish (`:3920-3921`). Each of those touches objects a replay never created. Null-guard the remaining reads of `this.streamingProcessor` / `this.streamingFallbackRecorder`.
- `_holdStreamingSession` requires `this._activeSession === held.session`. `applySessionIntents` set it at restore, so a failed or cancelled replay re-holds. A buffer re-held this way is a fresh window over the copy taken above.

- [ ] **Step 6: `docs/PRIVACY.md`**

Add this as its own paragraph after the paragraph at line 16 ("Change retention in **Privacy & Data**…"):

```markdown
When you cancel a dictation, Loqui keeps that recording in memory for 5 seconds (10 seconds for recordings over 30 seconds) so you can undo the cancel. It is never written to disk, not even as a temporary file, unless you have turned on saving discarded transcriptions. When the window ends, Loqui overwrites its copy of the audio and releases the recording. Undo sends the audio along the same route it was recorded for, never to a provider you chose afterwards. If a provider had already received the audio or text before you cancelled, Loqui says so. One case predates the cancel: if Loqui was already combining a recording's parts, or a local engine was already reading it, when you cancelled, that step's temporary file is removed when the step finishes, as it would be for any dictation.
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- test/helpers/cancelBuffer.test.js test/helpers/audioManagerCancelBuffer.test.js test/helpers/audioManagerCancelLifecycle.test.js test/helpers/audioManagerStreamingFinalization.test.js test/helpers/discardedRecording.test.js`
Expected: PASS. `audioManagerCancelLifecycle.test.js` may have asserted that `persistDiscardedBatchRecording` ran on cancel. Rewrite that expectation: the save happens at window close, and only when retention allows it.

- [ ] **Step 8: Commit**

```bash
git add src/helpers/cancelBuffer.js src/helpers/audioManager.js src/helpers/dictationDisclosure.js docs/PRIVACY.md test/helpers/cancelBuffer.test.js test/helpers/audioManagerCancelBuffer.test.js test/helpers/audioManagerCancelLifecycle.test.js
git commit -m "feat(voice): RAM-only cancel buffer with same-route Undo on every cancel path"
```

---

### Task 9: Lifecycle in `useAudioRecording`, Esc ownership, the cross-window Undo bridge and the shutdown flush (§5.2)

This task closes four review findings:
- the renderer half of I3: Esc follows the lifecycle, so an Undo that starts a processing phase is cancellable with Esc;
- I6: Plan 05's cross-window Undo bridge (CCR-5);
- I9: the cancel window is flushed on a normal quit, through a bounded main→renderer handshake;
- the ⌥Z lease from Task 2.

**Files:**
- Create: `src/helpers/rendererRequest.js` (main). A token, sender and timeout request/reply helper, generalised from `_prepareRendererForMainWindowResize` (`windowManager.js:345-370`).
- Modify: `src/helpers/windowManager.js`. Add `sendUndoCancelDictation(sessionId?)`, `flushDictationBeforeQuit({ timeoutMs })` and `lastCancelledDictation`.
- Modify: `main.js:1472-1479`. `before-quit` flushes the dictation window before teardown.
- Modify: `src/helpers/onboardingInputPolicy.js` and `src/helpers/ipcHandlers.js:1059-1080`. The demo channel accepts `cancelled` and `cancelClosed`, with sanitised fields.
- Modify: `preload.js`, `src/types/electron.ts`, `src/preview/browserPreview.ts`
- Modify: `src/hooks/useAudioRecording.js`
- Create: `src/hooks/useUndoCancelHotkey.ts`
- Modify: `src/App.jsx`. Global Esc also cancels processing; ⌥Z.
- Test: `test/helpers/rendererRequest.test.js`
- Test: `test/helpers/undoBridge.test.js` (two-window contract)
- Test: `test/helpers/useAudioRecordingLifecycle.test.js`

**Interfaces:**
- Consumes `restoreCancelled`, `pauseCancelHold`, `resumeCancelHold`, `flushCancelHold`, and `onCancelledChange(state | null, closed?)` (Task 8). It also consumes `CancelledState`, `UndoResult` and `DictationOutcome` (Task 7), and `usePillHotkey` (Task 2).
- Produces (§5.2, CCR-1 to CCR-5):

  ```ts
  // useAudioRecording(options) return gains:
  cancelled: CancelledState | null;
  undoCancel(): Promise<boolean>;      // false: exactly one notice explains why (UndoResult.reason)
  pauseUndo(): void;
  resumeUndo(): void;
  processingStage: "transcribing" | "cleaning" | null;
  outcome: DictationOutcome | null;
  ```

  ```ts
  // Onboarding demo channel (overlay → main → control panel), new statuses:
  | { kind; status: "cancelled"; sessionId: string; cancelled: CancelledState }  // on open, pause, resume and new evidence
  | { kind; status: "cancelClosed"; sessionId: string; reason: "expired" | "restored" | "replaced" | "flushed" }
  // After a successful Undo, the existing "processing" status follows.
  ```

  ```js
  // main
  windowManager.sendUndoCancelDictation(sessionId?: string): Promise<UndoResult>;  // 2 s round trip to the overlay
  windowManager.lastCancelledDictation: { sessionId: string } | null;              // from the demo/pill events
  windowManager.flushDictationBeforeQuit({ timeoutMs }): Promise<boolean>;         // true when the overlay acknowledged
  // src/helpers/rendererRequest.js
  requestFromRenderer({ ipcMain, webContents, channel, replyChannel, payload, timeoutMs, fallback }): Promise<unknown>;
  ```

  ```ts
  // electronAPI (overlay)
  onUndoCancelRequest?: (cb: (req: { token: number; sessionId: string | null }) => void) => () => void;
  replyUndoCancel?: (token: number, result: UndoResult) => void;
  onDictationFlushRequest?: (cb: (req: { token: number }) => void) => () => void;
  replyDictationFlush?: (token: number) => void;
  reportCancelledDictation?: (event: { sessionId: string; open: boolean }) => void;
  ```

  Plan 05 calls `windowManager.sendUndoCancelDictation(windowManager.lastCancelledDictation?.sessionId)` from its `onboarding-demo-undo-cancel` handler, and maps `UndoResult.restored === false` to hiding Undo.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/rendererRequest.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { requestFromRenderer } = require("../../src/helpers/rendererRequest.js");

function fakes() {
  const ipcMain = new EventEmitter();
  const sent = [];
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel, payload) => sent.push([channel, payload]),
  });
  return { ipcMain, webContents, sent };
}

test("the reply from the requested window, with the matching token, resolves the request", async () => {
  const { ipcMain, webContents, sent } = fakes();
  const p = requestFromRenderer({ ipcMain, webContents, channel: "req", replyChannel: "rep", payload: { a: 1 }, timeoutMs: 1000, fallback: "late" });
  const [, { token }] = sent[0];
  ipcMain.emit("rep", { sender: { id: 99 } }, token, "spoofed"); // another window
  ipcMain.emit("rep", { sender: webContents }, token + 1, "stale"); // another request
  ipcMain.emit("rep", { sender: webContents }, token, "ok");
  assert.equal(await p, "ok");
  assert.equal(ipcMain.listenerCount("rep"), 0);
});

test("a dead or silent renderer resolves to the fallback after the timeout", async () => {
  const { ipcMain, webContents } = fakes();
  assert.equal(await requestFromRenderer({ ipcMain, webContents, channel: "req", replyChannel: "rep", timeoutMs: 10, fallback: "timeout" }), "timeout");
  const destroyed = Object.assign(new EventEmitter(), { isDestroyed: () => true, send() {} });
  assert.equal(await requestFromRenderer({ ipcMain, webContents: destroyed, channel: "req", replyChannel: "rep", timeoutMs: 1000, fallback: "gone" }), "gone");
});
```

Create `test/helpers/undoBridge.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");

test("Undo from another window round-trips to the overlay and returns its result", async () => {
  const { EventEmitter } = require("node:events");
  const { requestFromRenderer } = require("../../src/helpers/rendererRequest.js");
  const ipcMain = new EventEmitter();
  // The overlay renderer: answers an undo request with its UndoResult.
  const overlay = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel, { token, sessionId }) => {
      if (channel === "undo-cancel-request") {
        setImmediate(() => ipcMain.emit("undo-cancel-reply", { sender: overlay }, token, { restored: true, sessionId }));
      }
    },
  });
  const result = await requestFromRenderer({
    ipcMain, webContents: overlay, channel: "undo-cancel-request", replyChannel: "undo-cancel-reply",
    payload: { sessionId: "rec-7" }, timeoutMs: 2000,
    fallback: { restored: false, sessionId: "rec-7", reason: "unavailable" },
  });
  assert.deepEqual(result, { restored: true, sessionId: "rec-7" });
});

test("the demo channel accepts cancelled and cancelClosed with sanitised fields", async () => {
  const { ONBOARDING_DEMO_STATUSES, sanitizeCancelledDemoFields } = require("../../src/helpers/onboardingInputPolicy.js");
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelled"));
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelClosed"));
  const clean = sanitizeCancelledDemoFields({
    sessionId: "rec-7",
    cancelled: {
      sessionId: "rec-7", undoUntil: 5000, paused: false, remainingMs: 5000,
      remoteAlreadySent: { target: "openai", payload: "audio", evidence: "attested", extra: "x" }, junk: 1,
    },
    reason: "nope",
  });
  assert.deepEqual(clean, {
    sessionId: "rec-7",
    cancelled: { sessionId: "rec-7", undoUntil: 5000, paused: false, remainingMs: 5000,
      remoteAlreadySent: { target: "openai", payload: "audio", evidence: "attested" } },
  });
  assert.equal(sanitizeCancelledDemoFields({ sessionId: "x".repeat(200) }).sessionId, undefined);
  assert.equal(sanitizeCancelledDemoFields({ sessionId: "rec-7", reason: "restored" }).reason, "restored");
});

test("normal quit flushes the cancel window before teardown", () => {
  const main = fs.readFileSync(path.join(repoRoot, "main.js"), "utf8");
  const handler = main.slice(main.indexOf('app.on("before-quit"'), main.indexOf('app.on("before-quit"') + 700);
  // windowManager is nullable in main.js; a throw here would leave the app unable to quit.
  assert.match(handler, /\(windowManager\?\.flushDictationBeforeQuit\?\.\(\{ timeoutMs: \d+ \}\) \?\? Promise\.resolve\(\)\)\.finally\(\(\) => \{\s*performSyncTeardown\(\);/);
});
```

Create `test/helpers/useAudioRecordingLifecycle.test.js`. It uses the hook harness from `useAudioRecordingPreparingReset.test.js`, with a fake manager whose callbacks the test fires:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { deferred } = require("./harness/deferred");

const FAKE = `
export default class FakeAudioManager {
  constructor() { this.voiceAgentRequested = false; this.translationRequested = false; this.sttConfig = { success: true }; globalThis.__am = this; this.calls = []; }
  getState() { return { isRecording: this.recording === true, isProcessing: this.processing === true }; }
  setCallbacks(cb) { this.cb = cb; }
  setVoiceAgentRequested(v) { this.voiceAgentRequested = v; }
  setAssistantSelectionContext() {}
  setTranslationRequested(v) { this.translationRequested = v; }
  shouldUseStreaming() { return false; }
  prepareMicCapture() {} cancelPreparedMicCapture() {} cleanup() {}
  async startRecording() { this.recording = true; return true; }
  async restoreCancelled(sessionId) { this.calls.push(["restore", sessionId]); return globalThis.__restoreResult ?? { restored: true, sessionId }; }
  pauseCancelHold() { this.calls.push(["pause"]); }
  resumeCancelHold() { this.calls.push(["resume"]); }
  flushCancelHold() { this.calls.push(["flush"]); return globalThis.__flush?.promise ?? Promise.resolve(); }
}`;

async function mount(t, electronAPI = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__am;
    delete globalThis.__restoreResult;
    delete globalThis.__flush;
  });
  const noop = () => () => {};
  const listeners = {};
  const on = (name) => (cb) => ((listeners[name] = cb), () => delete listeners[name]);
  const log = [];
  const demo = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noop, onToggleVoiceAgent: noop, onToggleTranslation: noop, onStartDictation: noop,
        onPrepareDictation: noop, onCancelDictationPreparation: noop, onStopDictation: noop,
        dictationLifecycleStateChanged: () => {}, captureDictationTarget: async () => ({}),
        registerCancelHotkey: (k) => log.push(`+${k}`),
        unregisterCancelHotkey: () => log.push("-esc"),
        acquirePillHotkey: async (slot) => (log.push(`+${slot}`), { leaseId: 1, held: true }),
        releasePillHotkey: async () => log.push("-lease"),
        onPillHotkeyPressed: noop,
        onUndoCancelRequest: on("undo"),
        replyUndoCancel: (token, result) => log.push(["undo-reply", token, result]),
        onDictationFlushRequest: on("flush"),
        replyDictationFlush: (token) => log.push(["flush-reply", token]),
        reportCancelledDictation: (e) => log.push(["report", e]),
        ...electronAPI,
      },
    },
  });
  const container = installHookDom(t);
  globalThis.requestAnimationFrame = (cb) => (cb(), 1);
  const vite = await createRendererServer(t, { cachePrefix: "openwhispr-lifecycle-", mockModules: { "/helpers/audioManager": FAKE } });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { useUndoCancelHotkey } = await vite.ssrLoadModule("/hooks/useUndoCancelHotkey.ts");
  const ref = {};
  function Harness() {
    ref.api = useAudioRecording({ onDemoEvent: (e) => demo.push(e) });
    useUndoCancelHotkey(ref.api.cancelled, ref.api.undoCancel);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return { ref, log, demo, listeners, vite };
}

const fire = (name, ...args) => React.act(async () => globalThis.__am.cb[name](...args));
const STATE = { sessionId: "rec-1", undoUntil: 5000, paused: false, remainingMs: 5000, remoteAlreadySent: null };

test("cancelled mirrors the manager and reaches the onboarding demo channel", async (t) => {
  const { ref, demo } = await mount(t);
  await fire("onCancelledChange", STATE);
  assert.deepEqual(ref.api.cancelled, STATE);
  assert.deepEqual(demo.at(-1), { kind: "dictation", status: "cancelled", sessionId: "rec-1", cancelled: STATE });
  await fire("onCancelledChange", null, { sessionId: "rec-1", reason: "expired" });
  assert.equal(ref.api.cancelled, null);
  assert.deepEqual(demo.at(-1), { kind: "dictation", status: "cancelClosed", sessionId: "rec-1", reason: "expired" });
});

test("Esc is owned by the lifecycle: armed while recording or processing, including an Undo-started processing phase", async (t) => {
  const { log } = await mount(t);
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  // Undo: idle → processing, never recording
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  assert.deepEqual(log.filter((e) => typeof e === "string" && /Escape|esc/.test(e)), ["+Escape", "-esc", "+Escape", "-esc"]);
});

test("another window's Undo request is answered with the manager's UndoResult", async (t) => {
  const { log, listeners } = await mount(t);
  await React.act(async () => listeners.undo({ token: 4, sessionId: "rec-1" }));
  assert.deepEqual(log.find((e) => Array.isArray(e) && e[0] === "undo-reply"), ["undo-reply", 4, { restored: true, sessionId: "rec-1" }]);
});

test("the quit flush replies only after the manager's flush settles", async (t) => {
  const { log, listeners } = await mount(t);
  globalThis.__flush = deferred();
  await React.act(async () => listeners.flush({ token: 9 }));
  assert.equal(log.some((e) => Array.isArray(e) && e[0] === "flush-reply"), false);
  await React.act(async () => globalThis.__flush.resolve());
  assert.deepEqual(log.find((e) => Array.isArray(e) && e[0] === "flush-reply"), ["flush-reply", 9]);
});

test("a failed Undo returns false and explains itself in a notice", async (t) => {
  const { ref, vite } = await mount(t);
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  globalThis.__restoreResult = { restored: false, sessionId: "rec-1", reason: "sealed" };
  await fire("onCancelledChange", STATE);
  let ok;
  await React.act(async () => {
    ok = await ref.api.undoCancel();
  });
  assert.equal(ok, false);
  // Same module instance the hook imported, so this is the notice it raised.
  assert.equal(notices.getNotices().at(-1).title, "notices.undo.sealed");
  assert.equal(notices.getNotices().filter((n) => n.title.startsWith("notices.undo.")).length, 1, "one surface, not two");
});

test("an Undo that arrives after the window closed says so (CCR-1)", async (t) => {
  const { ref, vite } = await mount(t);
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  globalThis.__restoreResult = { restored: false, sessionId: null, reason: "expired" };
  let ok;
  await React.act(async () => {
    ok = await ref.api.undoCancel();
  });
  assert.equal(ok, false);
  assert.equal(notices.getNotices().at(-1).title, "notices.undo.expired");
});

test("⌥Z is leased while a window is open and released when it closes", async (t) => {
  const { log } = await mount(t);
  await fire("onCancelledChange", STATE);
  await new Promise((r) => setImmediate(r));
  await fire("onCancelledChange", null, { sessionId: "rec-1", reason: "expired" });
  assert.deepEqual(log.filter((e) => e === "+undoCancel" || e === "-lease"), ["+undoCancel", "-lease"]);
});
```


That asserts on the same instance the hook used.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/rendererRequest.test.js test/helpers/undoBridge.test.js test/helpers/useAudioRecordingLifecycle.test.js`
Expected: FAIL with `Cannot find module '…/rendererRequest.js'`.

- [ ] **Step 3: Main side**

`src/helpers/rendererRequest.js`:

```js
// Main → renderer request with a reply: bound to one webContents, one token,
// and a timeout that resolves to `fallback` (never rejects), so a dead or
// reloading renderer cannot stall quit or an Undo click.
let tokens = 0;

function requestFromRenderer({ ipcMain, webContents, channel, replyChannel, payload = {}, timeoutMs, fallback = null }) {
  if (!webContents || webContents.isDestroyed()) return Promise.resolve(fallback);
  const token = ++tokens;
  return new Promise((resolve) => {
    const finish = (value) => {
      ipcMain.removeListener(replyChannel, listener);
      clearTimeout(timer);
      resolve(value);
    };
    const listener = (event, replyToken, value) => {
      if (event.sender !== webContents || replyToken !== token) return;
      finish(value);
    };
    const timer = setTimeout(() => finish(fallback), timeoutMs);
    ipcMain.on(replyChannel, listener);
    webContents.send(channel, { ...payload, token });
  });
}

module.exports = { requestFromRenderer };
```

`src/helpers/windowManager.js`:

```js
  sendUndoCancelDictation(sessionId = this.lastCancelledDictation?.sessionId ?? null) {
    return requestFromRenderer({
      ipcMain,
      webContents: this.mainWindow?.webContents,
      channel: "undo-cancel-request",
      replyChannel: "undo-cancel-reply",
      payload: { sessionId },
      timeoutMs: 2000,
      fallback: { restored: false, sessionId, reason: "unavailable" },
    });
  }

  async flushDictationBeforeQuit({ timeoutMs }) {
    const ack = await requestFromRenderer({
      ipcMain,
      webContents: this.mainWindow?.webContents,
      channel: "dictation-flush-request",
      replyChannel: "dictation-flush-reply",
      timeoutMs,
      fallback: false,
    });
    return ack === true;
  }
```

Import `ipcMain` from `electron` if `windowManager.js` does not already. Add `this.lastCancelledDictation = null;` in the constructor. Set it from a new `ipcMain.on("report-cancelled-dictation", (event, { sessionId, open }))` in `ipcHandlers.js`, which accepts only `mainWindow.webContents` as the sender and stores `open ? { sessionId } : null`.

`main.js:1472-1479`:

```js
let isShuttingDown = false;
app.on("before-quit", (event) => {
  if (updateExit || isShuttingDown) return;
  isShuttingDown = true;
  event.preventDefault();
  // D3: an open cancel window is persisted (only if retention saves discarded
  // audio) and zeroed before the app exits. A dead renderer times out.
  (windowManager?.flushDictationBeforeQuit?.({ timeoutMs: 3000 }) ?? Promise.resolve()).finally(() => {
    performSyncTeardown();
    sidecarRegistry.shutdownAll().finally(() => app.exit(0));
  });
});
```

The `windowManager.js:104-107` `before-quit` listener (`isQuitting = true` and `unregisterAll()`) still runs first and needs no change. The flush does not need hotkeys.

`src/helpers/onboardingInputPolicy.js`. Add `"cancelled"` and `"cancelClosed"` to `ONBOARDING_DEMO_STATUSES`, and export this:

```js
const CLOSE_REASONS = new Set(["expired", "restored", "replaced", "flushed"]);
const PAYLOADS = new Set(["audio", "text", "image"]);
const EVIDENCE = new Set(["attested", "dispatched"]);
const id = (v) => (typeof v === "string" && v.length > 0 && v.length <= 128 ? v : undefined);
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : undefined);

function sanitizeCancelledDemoFields(event = {}) {
  const out = {};
  if (id(event.sessionId)) out.sessionId = event.sessionId;
  if (CLOSE_REASONS.has(event.reason)) out.reason = event.reason;
  const c = event.cancelled;
  if (c && id(c.sessionId) && num(c.undoUntil) !== undefined && num(c.remainingMs) !== undefined) {
    const d = c.remoteAlreadySent;
    out.cancelled = {
      sessionId: c.sessionId,
      undoUntil: c.undoUntil,
      paused: Boolean(c.paused),
      remainingMs: c.remainingMs,
      remoteAlreadySent:
        d && typeof d.target === "string" && d.target.length <= 128 && PAYLOADS.has(d.payload) && EVIDENCE.has(d.evidence)
          ? { target: d.target, payload: d.payload, evidence: d.evidence }
          : null,
    };
  }
  return out;
}
```

In `ipcHandlers.js:1059-1080` (`onboarding-demo-publish`), spread `...sanitizeCancelledDemoFields(event)` into the broadcast object. Plan 05 extends the same handler (its CCR 1) and must keep this sanitiser.

`preload.js` (overlay APIs):

```js
  onUndoCancelRequest: registerListener("undo-cancel-request", (cb) => (_e, req) => cb(req)),
  replyUndoCancel: (token, result) => ipcRenderer.send("undo-cancel-reply", token, result),
  onDictationFlushRequest: registerListener("dictation-flush-request", (cb) => (_e, req) => cb(req)),
  replyDictationFlush: (token) => ipcRenderer.send("dictation-flush-reply", token, true),
  reportCancelledDictation: (event) => ipcRenderer.send("report-cancelled-dictation", event),
```

Add the types from the Interfaces block, and no-op stubs in `browserPreview.ts`.

- [ ] **Step 4: The hook**

In `src/hooks/useAudioRecording.js`:

1. **State.**

   ```js
     const [cancelled, setCancelled] = useState(null);
     const [processingStage, setProcessingStage] = useState(null);
     const [outcome, setOutcome] = useState(null);
     const escHeldRef = useRef(false);
   ```

2. **Callbacks** (inside `setCallbacks`):

   ```js
       onCancelledChange: (state, closed) => {
         setCancelled(state);
         if (state) {
           onDemoEventRef.current?.({ kind: demoKindRef.current, status: "cancelled", sessionId: state.sessionId, cancelled: state });
           window.electronAPI?.reportCancelledDictation?.({ sessionId: state.sessionId, open: true });
         } else if (closed) {
           onDemoEventRef.current?.({ kind: demoKindRef.current, status: "cancelClosed", sessionId: closed.sessionId, reason: closed.reason });
           window.electronAPI?.reportCancelledDictation?.({ sessionId: closed.sessionId, open: false });
         }
       },
       onProcessingStage: (stage) => setProcessingStage(stage),
   ```

   Task 8 already passes the reason with every close: `_closeCancelled` passes `{ sessionId, reason }`, and `restoreCancelled` passes `reason: "restored"` when it claims the recording. A refused restore reopens the window, which emits a fresh `cancelled` state.
3. **Esc follows the lifecycle (I3).** Delete every `registerCancelHotkey` / `unregisterCancelHotkey` call in the hook: lines 196, 214, 259, 342 and 818. Then add this as the first statement of `onStateChange`:

   ```js
         const busy = Boolean(isRecording || isProcessing);
         if (busy && !escHeldRef.current) {
           escHeldRef.current = true;
           window.electronAPI?.registerCancelHotkey?.("Escape");
         } else if (!busy && escHeldRef.current) {
           escHeldRef.current = false;
           window.electronAPI?.unregisterCancelHotkey?.();
           setProcessingStage(null);
         }
   ```

   On unmount, the existing cleanup releases it: add `if (escHeldRef.current) window.electronAPI?.unregisterCancelHotkey?.();` to the effect cleanup at `:786-800`. Main also releases the `cancel` slot if the renderer goes away: Task 2's owner watch covers it, installed from `register-cancel-hotkey` itself.
4. **Outcome.**
   - Paste success (`:657-660`): `setOutcome({ sessionId: audioManagerRef.current?.activeSession?.id ?? "", kind: "pasted", words: countWords(result.text), at: Date.now() });`
   - `showDictationError` (Task 4): `setOutcome({ sessionId: audioManagerRef.current?.activeSession?.id ?? "", kind: "failed", at: Date.now() });`
   - Module scope: `const countWords = (text) => (text.trim() ? text.trim().split(/\s+/u).length : 0);`
5. **Undo, pause, bridge, flush.**

   ```js
     const restore = useCallback(async (sessionId) => {
       const result = (await audioManagerRef.current?.restoreCancelled?.(sessionId ?? undefined)) ?? {
         restored: false, sessionId: sessionId ?? null, reason: "unavailable",
       };
       // The only error surface for a refused Undo. restoreCancelled never calls onError for a
       // refusal; a failure after a successful claim goes through the normal dictation error path.
       if (!result.restored) {
         notify({ id: "undo-failed", kind: "alert", title: t(`notices.undo.${result.reason}`) });
       }
       return result;
     }, [t]);
     const undoCancel = useCallback(async () => (await restore(cancelledRef.current?.sessionId)).restored, [restore]);
     const pauseUndo = useCallback(() => audioManagerRef.current?.pauseCancelHold?.(), []);
     const resumeUndo = useCallback(() => audioManagerRef.current?.resumeCancelHold?.(), []);

     useEffect(() => {
       const offUndo = window.electronAPI?.onUndoCancelRequest?.(async ({ token, sessionId }) => {
         window.electronAPI?.replyUndoCancel?.(token, await restore(sessionId));
       });
       const offFlush = window.electronAPI?.onDictationFlushRequest?.(({ token }) => {
         Promise.resolve(audioManagerRef.current?.flushCancelHold?.())
           .catch(() => {})
           .finally(() => window.electronAPI?.replyDictationFlush?.(token));
       });
       return () => {
         offUndo?.();
         offFlush?.();
       };
     }, [restore]);
   ```

   Keep `const cancelledRef = useRef(null); cancelledRef.current = cancelled;` next to the state.
6. Add `cancelled, undoCancel, pauseUndo, resumeUndo, processingStage, outcome` to the return object (`:877-893`).

`src/hooks/useUndoCancelHotkey.ts`:

```ts
import type { CancelledState } from "../types/dictation";
import { usePillHotkey } from "./usePillHotkey";

/** ⌥Z restores the cancelled dictation; leased from main only while its window is open (D3). */
export function useUndoCancelHotkey(cancelled: CancelledState | null, undoCancel: () => Promise<boolean>) {
  return usePillHotkey("undoCancel", cancelled !== null, () => {
    void undoCancel();
  });
}
```

A window paused by hover can outlive the 120 s `undoCancel` lease. Main then sends `pill-hotkey-released` and `held` turns false (Task 2), so Task 11 stops showing "⌥Z". The Undo button still works.

`src/App.jsx`:
- Destructure the six new fields.
- Call `const undoHotkey = useUndoCancelHotkey(cancelled, undoCancel);`. Task 11 shows "⌥Z" only while `undoHotkey.held`.
- Make the global Esc handler (`:364-369`) cover processing:

  ```js
      return window.electronAPI.onCancelHotkeyPressed(() => {
        if (isRecordingRef.current) cancelRecording();
        else if (isProcessingRef.current) cancelProcessing();
      });
  ```

  Add `const isProcessingRef = useRef(isProcessing); isProcessingRef.current = isProcessing;` next to `isRecordingRef`.

Locale keys (`notices.undo`, all 12 locales):

```json
"undo": {
  "sealed": "Undo blocked: Sealed mode is on and this recording's route leaves the device.",
  "routeUnavailable": "Couldn't undo: the route this was recorded for is no longer available.",
  "noAudio": "Couldn't undo: the recording was empty.",
  "busy": "Finish the current dictation, then undo.",
  "expired": "Too late to undo: that recording was already discarded.",
  "unavailable": "Couldn't reach the dictation window to undo."
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/rendererRequest.test.js test/helpers/undoBridge.test.js test/helpers/useAudioRecordingLifecycle.test.js "test/helpers/useAudioRecording*.test.js" test/helpers/preloadOnboardingBridge.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/rendererRequest.js src/helpers/windowManager.js main.js src/helpers/onboardingInputPolicy.js src/helpers/ipcHandlers.js src/helpers/audioManager.js preload.js src/types/electron.ts src/preview/browserPreview.ts src/hooks/useAudioRecording.js src/hooks/useUndoCancelHotkey.ts src/App.jsx src/locales test
git commit -m "feat(voice): lifecycle-owned Esc, cross-window Undo bridge and a quit flush"
```

---

### Task 10: Pill stage model, footprints and faster entrances

Covers the VO-R1 C state model, VO-Q5, VO-Q12 (timing) and VO-Q18. It also closes review finding I4: one ownership policy decides, for every pill stage, whether the stage holds the native window, takes input, and outranks Assistant footer suppression. Auto-hide, footer suppression, click-through and the Linux input region all read that one policy.

**Files:**
- Modify: `src/helpers/voicePillPresentation.js`:
  - `VOICE_PILL_FOOTPRINT` (9–12)
  - `LISTENING_ENTRANCE_TIMING` (21–36)
  - `LIVE_TRANSCRIPT_ENTRANCE_TIMING` (96–107)
  - `getLiveTranscriptEntranceTimeline` (109–123)
  - `resolveVoiceActivityPresentation` (241–260)
  - new `resolvePillStage`, `PILL_OUTCOME_BEAT_MS` and `VOICE_PILL_MAX_WIDTH`
  - new `resolvePillOwnership` and `shouldAutoHidePill`
  - `resolveVoicePillInteraction` (328–346) and `shouldSuppressPillForAssistantActions` (368–376) take the ownership into account
- Modify: `test/helpers/voicePillPresentation.test.js`. Update the ordering test at line 320 and add new tests.

**Interfaces:**
- Produces:

  ```js
  export const VOICE_PILL_FOOTPRINT: {
    idle: {40,40}; recording: {98,36}; transcribing: {144,36}; cleaning: {144,36};
    pasted: {164,36}; cancelled: {160,36}; meeting: {124,36}; meetingInterrupted: {184,36};
  };
  export const VOICE_PILL_MAX_WIDTH = 184;
  export const PILL_OUTCOME_BEAT_MS = 700;
  export type PillStage = "recording" | "unavailable" | "thinking" | "transcribing" | "cleaning" | "cancelled" | "pasted" | "failed" | "meeting";
  export function resolvePillStage(input: {
    isRecording: boolean; micUnavailable: boolean; isProcessing: boolean;
    processingStage: "transcribing" | "cleaning" | null; agentMode: boolean;
    cancelled: { undoUntil: number } | null; recentOutcome: { kind: "pasted" | "failed" } | null;
    meetingRecording: object | null; showMeetingRecorder: boolean;
  }): PillStage | null;
  ```

  ```js
  export function resolvePillOwnership(stage: PillStage | null): { holdsWindow: boolean; interactive: boolean; outranksFooter: boolean };
  export function shouldAutoHidePill(input: {
    floatingIconAutoHide: boolean; isRecording: boolean; isVisuallyProcessing: boolean; noticesOnScreen: boolean;
    wordsCardHandoffActive: boolean; assistantMounted: boolean; liveTranscriptMounted: boolean; ownership: { holdsWindow: boolean };
  }): boolean;
  // resolveVoicePillInteraction gains `ownership`; shouldSuppressPillForAssistantActions gains `ownership`.
  ```

  The ownership policy:

  | Stage | holdsWindow | interactive | outranksFooter | Why |
  |---|---|---|---|---|
  | `cancelled` | yes | yes | yes | Undo must stay reachable for the whole 5–10 s window (D3) |
  | `pasted`, `failed` | yes | no | no | The 700 ms beat must not be cut by the 500 ms auto-hide |
  | `meeting` | yes | yes | yes | Stop must be visible and clickable while a meeting records (D2) |
  | everything else | no | no | no | Existing rules apply unchanged |

  `resolveVoiceActivityPresentation` now returns `activeState: "transcribing"` (not `"thinking"`) for non-agent processing.

- [ ] **Step 1: Write the failing tests**

Append to `test/helpers/voicePillPresentation.test.js`:

```js
test("press to first bar is one expansion, with no hold (VO-Q5)", async () => {
  const { getListeningEntranceTimeline, LISTENING_ENTRANCE_TIMING } = await load();
  const timeline = getListeningEntranceTimeline();
  assert.equal(timeline.expandAtMs, 0);
  assert.equal(timeline.waveformAtMs, LISTENING_ENTRANCE_TIMING.expansionMs);
  assert.ok(timeline.waveformAtMs <= 300);
  // The Agent footer handoff still needs its hold.
  assert.ok(getListeningEntranceTimeline({ afterAssistantFooterHandoff: true }).expandAtMs >= 400);
});

test("Live Transcript shows first words by 700ms (VO-Q18)", async () => {
  const { getLiveTranscriptEntranceTimeline } = await load();
  assert.ok(getLiveTranscriptEntranceTimeline().streamAtMs <= 700);
});

test("every pill footprint fits the 184px dock budget", async () => {
  const { VOICE_PILL_FOOTPRINT, VOICE_PILL_MAX_WIDTH } = await load();
  for (const [name, size] of Object.entries(VOICE_PILL_FOOTPRINT)) {
    assert.ok(size.width <= VOICE_PILL_MAX_WIDTH, name);
    assert.ok(size.height <= 40, name);
  }
});

test("pill stage priority: live work, then cancel, then outcome, then meeting", async () => {
  const { resolvePillStage } = await load();
  const base = {
    isRecording: false, micUnavailable: false, isProcessing: false, processingStage: null,
    agentMode: false, cancelled: null, recentOutcome: null, meetingRecording: null, showMeetingRecorder: true,
  };
  const meeting = { startedAt: 1, interruption: null, quiet: false };
  assert.equal(resolvePillStage(base), null);
  assert.equal(resolvePillStage({ ...base, meetingRecording: meeting }), "meeting");
  assert.equal(resolvePillStage({ ...base, meetingRecording: meeting, showMeetingRecorder: false }), null);
  assert.equal(resolvePillStage({ ...base, isRecording: true, meetingRecording: meeting }), "recording");
  assert.equal(resolvePillStage({ ...base, isRecording: true, micUnavailable: true }), "unavailable");
  assert.equal(resolvePillStage({ ...base, isProcessing: true }), "transcribing");
  assert.equal(resolvePillStage({ ...base, isProcessing: true, processingStage: "cleaning" }), "cleaning");
  assert.equal(resolvePillStage({ ...base, isProcessing: true, agentMode: true }), "thinking");
  assert.equal(resolvePillStage({ ...base, cancelled: { undoUntil: 5 }, recentOutcome: { kind: "pasted" } }), "cancelled");
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "pasted" }, meetingRecording: meeting }), "pasted");
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "failed" } }), "failed");
});

test("regular dictation processing is a transcribing capsule, Agent keeps thinking", async () => {
  const { resolveVoiceActivityPresentation } = await load();
  assert.deepEqual(
    resolveVoiceActivityPresentation({ isRecording: false, isProcessing: true, isAssistantVoice: false, assistantThinking: false }),
    { activeState: "transcribing", compactPill: true, isAgentThinking: false }
  );
  assert.equal(
    resolveVoiceActivityPresentation({ isRecording: false, isProcessing: true, isAssistantVoice: true, assistantThinking: false }).activeState,
    "thinking"
  );
});
```

Also update these existing tests:
- Line 320, "listening entrance timers preserve the visual order". Replace `assert.ok(timeline.expandAtMs > 0);` with `assert.ok(timeline.expandAtMs >= 0);`. Replace `assert.ok(timeline.waveformAtMs > timeline.settleAtMs);` with `assert.ok(timeline.waveformAtMs >= timeline.settleAtMs);`.
- Line 512, "regular dictation transcription contracts to the rotating thinking circle". Rename it to "regular dictation transcription is a labelled capsule" and change its expected `activeState` to `"transcribing"` and `compactPill` to `true`.

Add the ownership tests:

```js
test("one ownership policy for the long-lived stages (I4)", async () => {
  const { resolvePillOwnership } = await load();
  assert.deepEqual(resolvePillOwnership("cancelled"), { holdsWindow: true, interactive: true, outranksFooter: true });
  assert.deepEqual(resolvePillOwnership("meeting"), { holdsWindow: true, interactive: true, outranksFooter: true });
  assert.deepEqual(resolvePillOwnership("pasted"), { holdsWindow: true, interactive: false, outranksFooter: false });
  assert.deepEqual(resolvePillOwnership(null), { holdsWindow: false, interactive: false, outranksFooter: false });
});

test("auto-hide never hides an undo window, a success beat or the meeting recorder", async () => {
  const { shouldAutoHidePill, resolvePillOwnership } = await load();
  const idle = {
    floatingIconAutoHide: true, isRecording: false, isVisuallyProcessing: false, noticesOnScreen: false,
    wordsCardHandoffActive: false, assistantMounted: false, liveTranscriptMounted: false,
  };
  assert.equal(shouldAutoHidePill({ ...idle, ownership: resolvePillOwnership(null) }), true);
  for (const stage of ["cancelled", "pasted", "failed", "meeting"]) {
    assert.equal(shouldAutoHidePill({ ...idle, ownership: resolvePillOwnership(stage) }), false, stage);
  }
  assert.equal(shouldAutoHidePill({ ...idle, floatingIconAutoHide: false, ownership: resolvePillOwnership(null) }), false);
});

test("Assistant final actions cannot suppress Undo or the meeting recorder", async () => {
  const { shouldSuppressPillForAssistantActions, resolvePillOwnership } = await load();
  const actions = { assistantOpen: true, footerPillVisible: false, assistantClosing: false, hasLiveActivity: false };
  assert.equal(shouldSuppressPillForAssistantActions({ ...actions, ownership: resolvePillOwnership(null) }), true);
  assert.equal(shouldSuppressPillForAssistantActions({ ...actions, ownership: resolvePillOwnership("meeting") }), false);
  assert.equal(shouldSuppressPillForAssistantActions({ ...actions, ownership: resolvePillOwnership("cancelled") }), false);
});

test("Undo and Stop stay interactive with a panel mounted (Linux input region follows this flag)", async () => {
  const { resolveVoicePillInteraction, resolvePillOwnership } = await load();
  const base = { isRecording: false, isProcessing: false, isHovered: false };
  for (const panel of [{ assistantMounted: true, liveTranscriptMounted: false }, { assistantMounted: false, liveTranscriptMounted: true }]) {
    assert.equal(resolveVoicePillInteraction({ ...base, ...panel, ownership: resolvePillOwnership(null) }).pillInteractive, false);
    assert.equal(resolveVoicePillInteraction({ ...base, ...panel, ownership: resolvePillOwnership("meeting") }).pillInteractive, true);
    assert.equal(resolveVoicePillInteraction({ ...base, ...panel, ownership: resolvePillOwnership("cancelled") }).pillInteractive, true);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/voicePillPresentation.test.js`
Expected: FAIL in five places:
- `expandAtMs` is 260;
- `streamAtMs` is 1920;
- `VOICE_PILL_MAX_WIDTH` is undefined;
- `resolvePillStage` is not a function;
- the activity state is `"thinking"`.

- [ ] **Step 3: Implement**

1. Replace `VOICE_PILL_FOOTPRINT` (lines 9–12):

   ```js
   // Every footprint lives inside the 208×120 pill window minus its 12px dock
   // insets (VOICE_PILL_MAX_WIDTH); labelled states size for English and
   // truncate longer translations with an ellipsis.
   export const VOICE_PILL_MAX_WIDTH = 184;
   export const VOICE_PILL_FOOTPRINT = Object.freeze({
     idle: Object.freeze({ width: 40, height: 40 }),
     recording: Object.freeze({ width: 98, height: 36 }),
     transcribing: Object.freeze({ width: 144, height: 36 }),
     cleaning: Object.freeze({ width: 144, height: 36 }),
     // Label room = width − 54px (30 ring, 4+12 padding, 6 gap, 2 border).
     pasted: Object.freeze({ width: 164, height: 36 }),
     cancelled: Object.freeze({ width: 160, height: 36 }),
     meeting: Object.freeze({ width: 124, height: 36 }),
     meetingInterrupted: Object.freeze({ width: 184, height: 36 }),
   });
   ```

2. In `LISTENING_ENTRANCE_TIMING` (line 21), set `thinkingMs: 0` and `waveformDelayMs: 0`. Leave `assistantFooterThinkingMs: 420` and `expansionMs: 300` alone. Update the comment above it: the press-ack hold is gone, and the first bar lands one expansion after the press.
3. Replace `LIVE_TRANSCRIPT_ENTRANCE_TIMING` and the first three lines of `getLiveTranscriptEntranceTimeline`. Controls and content now run in parallel with the horizontal travel instead of after it:

   ```js
   export const LIVE_TRANSCRIPT_ENTRANCE_TIMING = Object.freeze({
     encapsulateMs: 120,
     encapsulateHoldMs: 0,
     horizontalMs: 240,
     controlsDelayMs: 60,
     controlsRevealMs: 150,
     contentDelayMs: 40,
     measurementSettleMs: 120,
     panelExpansionMs: 240,
     contentRevealDelayMs: 0,
     contentSettleMs: 60,
   });

   // Words first (VO-Q18): controls and the hidden measurement start during the
   // horizontal travel, so the first words land ~640ms after the first partial
   // instead of ~1.9s.
   export function getLiveTranscriptEntranceTimeline(timing = LIVE_TRANSCRIPT_ENTRANCE_TIMING) {
     const horizontalAtMs = timing.encapsulateMs + timing.encapsulateHoldMs;
     const controlsAtMs = horizontalAtMs + timing.controlsDelayMs;
     const prepareAtMs = controlsAtMs + timing.contentDelayMs;
     const panelAtMs = prepareAtMs + timing.measurementSettleMs;
     const contentAtMs = panelAtMs + timing.panelExpansionMs + timing.contentRevealDelayMs;
     return {
       horizontalAtMs,
       controlsAtMs,
       prepareAtMs,
       panelAtMs,
       contentAtMs,
       streamAtMs: contentAtMs + timing.contentSettleMs,
     };
   }
   ```

   `useLiveTranscriptPanel.js:258-272` already schedules content and stream from these constants, so no hook change is needed.
4. In `resolveVoiceActivityPresentation`, change the plain-processing branch (line 255) to `return { activeState: "transcribing", compactPill: true, isAgentThinking: false };`.
5. Add after `resolveAgentModeActive` (line 273):

   ```js
   export const PILL_OUTCOME_BEAT_MS = 700;

   /**
    * One pill, legible states (VO-R1 C). Live work outranks everything; a
    * pending undo outranks the success beat; the meeting recorder is the
    * resting state while a meeting records (D2).
    */
   export function resolvePillStage({
     isRecording,
     micUnavailable,
     isProcessing,
     processingStage,
     agentMode,
     cancelled,
     recentOutcome,
     meetingRecording,
     showMeetingRecorder,
   }) {
     if (isRecording) return micUnavailable ? "unavailable" : "recording";
     if (isProcessing) {
       if (agentMode) return "thinking";
       return processingStage === "cleaning" ? "cleaning" : "transcribing";
     }
     if (cancelled) return "cancelled";
     if (recentOutcome) return recentOutcome.kind === "pasted" ? "pasted" : "failed";
     if (meetingRecording && showMeetingRecorder) return "meeting";
     return null;
   }

   const OWNERSHIP = {
     cancelled: { holdsWindow: true, interactive: true, outranksFooter: true },
     meeting: { holdsWindow: true, interactive: true, outranksFooter: true },
     pasted: { holdsWindow: true, interactive: false, outranksFooter: false },
     failed: { holdsWindow: true, interactive: false, outranksFooter: false },
   };
   const NO_OWNERSHIP = { holdsWindow: false, interactive: false, outranksFooter: false };

   /** One policy for stages that outlive the dictation (I4). */
   export function resolvePillOwnership(stage) {
     return OWNERSHIP[stage] ?? NO_OWNERSHIP;
   }

   /** App's auto-hide condition (App.jsx:407-414), with stage ownership. */
   export function shouldAutoHidePill({
     floatingIconAutoHide, isRecording, isVisuallyProcessing, noticesOnScreen,
     wordsCardHandoffActive, assistantMounted, liveTranscriptMounted, ownership,
   }) {
     return Boolean(
       floatingIconAutoHide && !isRecording && !isVisuallyProcessing && !noticesOnScreen &&
       !wordsCardHandoffActive && !assistantMounted && !liveTranscriptMounted && !ownership?.holdsWindow
     );
   }
   ```

6. `resolveVoicePillInteraction` (328–346): add an `ownership = NO_OWNERSHIP` parameter. Return early with `{ pillInteractive: true, cancelVisible: false }` when `ownership.interactive` is true, before the `assistantMounted` branch. The pill window stays non-focusable; this only lets the pointer reach Undo or Stop.
7. `shouldSuppressPillForAssistantActions` (368–376): add an `ownership = NO_OWNERSHIP` parameter, with `if (ownership.outranksFooter) return false;` as the first line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/voicePillPresentation.test.js test/helpers/pillVisibilityHandoff.test.js test/hooks/linuxPillInteractivity.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/voicePillPresentation.js test/helpers/voicePillPresentation.test.js
git commit -m "feat(voice): pill stage model, no press hold, words-first transcript entrance"
```

---

### Task 11: The Condensation pill: LevelBars, LocalityRing, stage labels and undo

Covers VO-R1 C (pill chrome), VO-Q12 (the beat), the D3 cancelled capsule and caption, FND-R5 adoption on the pill, and §5.1/§5.4 consumption.

**Files:**
- Modify (rewrite): `src/components/dictation/VoicePill.tsx`
- Create: `src/components/dictation/pillLocality.ts`. A pure combiner plus a `usePillLocality` hook.
- Create: `src/components/dictation/PillCaption.tsx`. The layer above the pill; Task 12 renders words into it.
- Create: `src/hooks/useRecentOutcome.ts`
- Delete: `src/components/dictation/PillWaveform.tsx`, `src/components/dictation/waveformMath.ts`
- Modify: `src/App.jsx`:
  - pill state derivation (lines 472–481, 576–581)
  - `activateVoicePill` (540–557)
  - hover handlers (648–659)
  - the `VoicePill` props (666–739)
- Modify: `src/components/dictation/AgentDictationPillOverlay.tsx:228-244`. It keeps `getAudioLevel`; no other change.
- Modify: `src/styles/dictation-panel.css`. Add the stage, countdown and caption rules, the `[data-stage]` comet variant and the `liquid-cancel-skin` states.
- Modify: `src/locales/*/translation.json` (`pill.*` keys)
- Modify: `DESIGN.md` `### Voice Pill`
- Test: `test/helpers/voicePillStructure.test.js` (update)
- Test: `test/components/pillLocality.test.js` (new)

**Interfaces:**
- Consumes:
  - `VOICE_PILL_FOOTPRINT`, `resolvePillStage`, `PILL_OUTCOME_BEAT_MS`, `resolvePillOwnership` and `shouldAutoHidePill` (Task 10);
  - `cancelled` (`CancelledState`), `undoCancel`, `pauseUndo`, `resumeUndo`, `processingStage` and `outcome` (Task 9);
  - `disclosureCopy` (Task 7);
  - `LevelBars` and `LOGO_BAR_SHAPE` (Plan 01 Task 8);
  - `LocalityRing` and `Locality` (Plan 01 Tasks 6–7);
  - `useResolvedRoute` and `ResolvedRoute` (§5.1).
- Produces:

  ```ts
  export type VoicePillState = "idle" | "hover" | "recording" | "processing" | "thinking" | "unavailable"
    | "transcribing" | "cleaning" | "pasted" | "failed" | "cancelled" | "meeting";
  // VoicePill gains props:
  label?: React.ReactNode; locality?: PillLocality | null; countdown?: { durationMs: number; paused: boolean } | null;
  ```

  ```ts
  // src/components/dictation/pillLocality.ts
  export interface PillLocality { locality: Locality; provider: string | null; blocked: boolean; label: string; routeLine: string }
  export function routeProviderLabel(route: ResolvedRoute, t: T): string; // providerDisplayLabel(route.providerId, t), else route.provider (CCR-7)
  export function combinePillLocality(routes: ResolvedRoute[], t: T): PillLocality;
  export function usePillLocality(): PillLocality;
  ```

  ```tsx
  export function PillCaption(props: { children: React.ReactNode; horizontalDirection: "left" | "right" }): JSX.Element;
  export function useRecentOutcome(outcome: Outcome | null, windowMs?: number): Outcome | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/pillLocality.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const t = (key, opts) => (opts ? `${key}|${Object.values(opts).join("|")}` : key);
const load = () => import("../../src/components/dictation/pillLocality.ts");
const route = (id, locality, provider, state = { status: "ready" }) => ({
  id, kind: "speech", locality, provider, model: null, state, sends: null, settingsPath: id,
});

test("the pill discloses the most remote active stage", async () => {
  const { combinePillLocality } = await load();
  const both = combinePillLocality([route("dictationStt", "device", null), route("dictationCleanup", "remote", "OpenAI")], t);
  assert.equal(both.locality, "remote");
  assert.equal(both.provider, "OpenAI");
  assert.equal(both.blocked, false);
  const local = combinePillLocality([route("dictationStt", "device", null), route("dictationCleanup", "device", null)], t);
  assert.equal(local.locality, "device");
});

test("a cleanup step that is turned off does not colour the ring", async () => {
  const { combinePillLocality } = await load();
  const off = combinePillLocality(
    [route("dictationStt", "network", null), route("dictationCleanup", "remote", "Anthropic", { status: "off" })],
    t
  );
  assert.equal(off.locality, "network");
  assert.match(off.routeLine, /pill\.route\.cleanupOff/);
});

test("provider names go through providerDisplayLabel when the route carries an id (CCR-7)", async () => {
  const { combinePillLocality } = await load();
  const custom = combinePillLocality(
    [route("dictationStt", "device", null), { ...route("dictationCleanup", "remote", "Custom endpoint"), providerId: "custom" }],
    t
  );
  assert.equal(custom.provider, "locality.customEndpoint");
  const openai = combinePillLocality([{ ...route("dictationStt", "remote", "OpenAI"), providerId: "openai" }], t);
  assert.equal(openai.provider, "OpenAI");
});

test("Sealed mode marks a remote route as blocked (§5.4)", async () => {
  const { combinePillLocality } = await load();
  const sealed = combinePillLocality(
    [route("dictationStt", "remote", "OpenAI", { status: "unreachable", detail: "sealed" }), route("dictationCleanup", "device", null)],
    t
  );
  assert.equal(sealed.blocked, true);
  assert.equal(sealed.label, "pill.locality.sealed");
});
```

Update `test/helpers/voicePillStructure.test.js`:

1. Delete the `totalWaveBars` helper (lines 14–19). Replace every assertion that counts `rounded-full bg-current` with level-bar counts:
   - a `recording` render has 5 `data-level-bar=""`;
   - a compact non-recording render (`expanded: true` or panel variant) has 5 `data-level-bar-rest=""`;
   - an `idle` or `thinking` render has 0 of either.

   `LOGO_BAR_SHAPE.length` is 5; import it from `../../src/components/ui/levelBarsMath.ts` rather than hard-coding.
2. Append:

```js
test("stage labels truncate inside the footprint (long translations)", async () => {
  const { VOICE_PILL_FOOTPRINT } = await import("../../src/helpers/voicePillPresentation.js");
  const html = await renderPill("cancelled", false, "right", {
    label: "Verworfen · Rückgängig machen, solange das Fenster offen ist",
    countdown: { durationMs: 5000, paused: false },
  });
  const { width, height } = VOICE_PILL_FOOTPRINT.cancelled;
  assert.match(html, new RegExp(`style="width:${width}px;height:${height}px`));
  const css = readDictationStyles();
  const rule = css.match(/\.pill-stage-label\s*\{([^}]*)\}/)[1];
  assert.match(rule, /text-overflow:\s*ellipsis/);
  assert.match(rule, /white-space:\s*nowrap/);
  assert.match(rule, /min-width:\s*0/);
});

test("transcribing and cleaning light the comet on the capsule; cleaning adds magenta", async () => {
  const transcribing = await renderPill("transcribing", false, "right", { label: "Transcribing…" });
  const cleaning = await renderPill("cleaning", false, "right", { label: "Cleaning up" });
  assert.match(transcribing, /class="processing-signal-glow" data-active="true" data-stage="transcribing"/);
  assert.match(cleaning, /data-stage="cleaning"/);
  assert.match(cleaning, />Cleaning up</);
  const css = readDictationStyles();
  assert.match(css, /\.processing-signal-glow\[data-stage="transcribing"\]\s*\{[^}]*--signal-deep:\s*var\(--signal-core\)/);
});

test("the identity sits inside a locality ring; sealed shows it blocked", async () => {
  const remote = await renderPill("idle", false, "right", {
    locality: { locality: "remote", provider: "OpenAI", blocked: false, label: "Sends to OpenAI", routeLine: "" },
  });
  assert.match(remote, /data-locality="remote"/);
  assert.match(remote, /aria-label="Sends to OpenAI"/);
  const sealed = await renderPill("idle", false, "right", {
    locality: { locality: "remote", provider: "OpenAI", blocked: true, label: "Blocked", routeLine: "" },
  });
  assert.match(sealed, /locality-ring--blocked/);
});

test("pasted swaps the logo for a drawn check on a green edge (VO-Q12)", async () => {
  const html = await renderPill("pasted", false, "right", { label: "Pasted · 19 words" });
  assert.match(html, /pill-success-check/);
  assert.match(html, /data-pill-state="pasted"/);
  assert.match(readDictationStyles(), /\.voice-pill-control\[data-pill-state="pasted"\]\s*\{[^}]*border-color:\s*var\(--color-success\)/);
});

test("cancelled shows a countdown that pauses on hover", async () => {
  const running = await renderPill("cancelled", false, "right", { label: "Discarded · Undo", countdown: { durationMs: 10000, paused: false } });
  const paused = await renderPill("cancelled", false, "right", { label: "Discarded · Undo", countdown: { durationMs: 10000, paused: true } });
  // Assert each declaration, not the serialised attribute (M1): React emits
  // "animation-duration:10000ms;--undo-ms:10000ms" and the order is not part of the contract.
  const style = running.match(/class="pill-countdown" style="([^"]*)"/)[1].split(";");
  assert.ok(style.includes("animation-duration:10000ms"), style.join(";"));
  assert.ok(style.includes("--undo-ms:10000ms"), "the reduced-motion duration rides along");
  assert.match(paused, /data-paused="true"/);
});

test("the retired pill waveform is gone; recording uses LevelBars", async () => {
  assert.equal(fs.existsSync(path.join(sourceRoot, "src/components/dictation/PillWaveform.tsx")), false);
  const html = await renderPill("recording", true);
  assert.equal((html.match(/data-level-bar=""/g) || []).length, 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/components/pillLocality.test.js test/helpers/voicePillStructure.test.js`
Expected: FAIL. `pillLocality.ts` is not found, there is no `data-level-bar`, and there are no stage labels.

- [ ] **Step 3: Implement `pillLocality.ts`, `useRecentOutcome` and `PillCaption`**

`src/components/dictation/pillLocality.ts`:

```ts
import { useTranslation } from "react-i18next";
import { providerDisplayLabel, type Locality } from "../../lib/locality";
import { useResolvedRoute, type ResolvedRoute } from "../../lib/routes";

type T = (key: string, options?: Record<string, unknown>) => string;

export interface PillLocality {
  locality: Locality;
  provider: string | null;
  blocked: boolean;
  label: string;
  routeLine: string;
}

const RANK: Record<Locality, number> = { device: 0, network: 1, remote: 2 };

/**
 * Display name for a route's provider. Plan 01: names shown in the pill come
 * from providerDisplayLabel so "Custom endpoint" / "Unknown provider" are
 * localised. Falls back to the resolver's display string until Plan 03 adds
 * ResolvedRoute.providerId (CCR-7).
 */
export function routeProviderLabel(route: ResolvedRoute, t: T): string {
  const id = (route as ResolvedRoute & { providerId?: string | null }).providerId;
  if (id !== undefined) return providerDisplayLabel(id, t);
  return route.provider ?? providerDisplayLabel(null, t);
}

function stageLine(route: ResolvedRoute | undefined, t: T, stageKey: "speech" | "cleanup"): string {
  if (!route) return "";
  if (route.state.status === "off") return t(`pill.route.${stageKey}Off`);
  const where =
    route.locality === "remote"
      ? t("locality.remote", { provider: routeProviderLabel(route, t) })
      : t(`locality.${route.locality}`);
  return t(`pill.route.${stageKey}`, { where });
}

/** The ring shows the most remote active stage (fail toward disclosure, D4). */
export function combinePillLocality(routes: ResolvedRoute[], t: T): PillLocality {
  const active = routes.filter((r) => r.state.status !== "off");
  const top = active.reduce<ResolvedRoute | null>(
    (best, r) => (!best || RANK[r.locality] > RANK[best.locality] ? r : best),
    null
  );
  const locality: Locality = top?.locality ?? "device";
  const blocked = active.some(
    (r) => r.locality !== "device" && r.state.status === "unreachable" && r.state.detail === "sealed"
  );
  const provider = locality === "remote" && top ? routeProviderLabel(top, t) : null;
  const label = blocked
    ? t("pill.locality.sealed")
    : locality === "remote"
      ? t("locality.remote", { provider: provider ?? "" })
      : t(`locality.${locality}`);
  const stt = routes.find((r) => r.id === "dictationStt");
  const cleanup = routes.find((r) => r.id === "dictationCleanup");
  const routeLine = [stageLine(stt, t, "speech"), stageLine(cleanup, t, "cleanup")].filter(Boolean).join(" · ");
  return { locality, provider, blocked, label, routeLine };
}

export function usePillLocality(): PillLocality {
  const { t } = useTranslation();
  const stt = useResolvedRoute("dictationStt");
  const cleanup = useResolvedRoute("dictationCleanup");
  return combinePillLocality([stt, cleanup], t);
}
```

`src/hooks/useRecentOutcome.ts`:

```ts
import { useEffect, useState } from "react";
import { PILL_OUTCOME_BEAT_MS } from "../helpers/voicePillPresentation";

type Outcome = { kind: "pasted"; words: number; at: number } | { kind: "failed"; at: number };

/** The outcome while its 700ms beat is running, else null (VO-Q12). */
export function useRecentOutcome(outcome: Outcome | null, windowMs = PILL_OUTCOME_BEAT_MS): Outcome | null {
  const [recent, setRecent] = useState<Outcome | null>(null);
  useEffect(() => {
    if (!outcome) return;
    const remaining = outcome.at + windowMs - Date.now();
    if (remaining <= 0) return;
    setRecent(outcome);
    const id = setTimeout(() => setRecent(null), remaining);
    return () => clearTimeout(id);
  }, [outcome, windowMs]);
  return recent;
}
```

`src/components/dictation/PillCaption.tsx`. This is the layer above the pill that holds the D3 copy (and Task 12's words). It lives outside the pill box, so it never clips the bars (D9).

```tsx
import type { ReactNode } from "react";

export function PillCaption({
  children,
  horizontalDirection,
}: {
  children: ReactNode;
  horizontalDirection: "left" | "right";
}) {
  return (
    <div className="pill-caption" data-direction={horizontalDirection} role="status" aria-live="polite">
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `VoicePill.tsx`**

Replace the whole file with the version below. It keeps every existing prop, data attribute, the glow anchor, the hover sheen, the chevron and the unavailable ring.

```tsx
import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Check, ChevronUp } from "../icons";
import { cn } from "../lib/utils";
import { LevelBars } from "../ui/LevelBars";
import { LOGO_BAR_SHAPE } from "../ui/levelBarsMath";
import { LocalityRing } from "../ui/LocalityRing";
import { VoiceIdentityIcon } from "./VoiceIdentityIcon";
import type { PillLocality } from "./pillLocality";
import {
  VOICE_PILL_FOOTPRINT,
  VOICE_PILL_GROW_TRANSITION,
} from "../../helpers/voicePillPresentation";

export type VoicePillState =
  | "idle"
  | "hover"
  | "recording"
  | "processing"
  | "thinking"
  | "unavailable"
  | "transcribing"
  | "cleaning"
  | "pasted"
  | "failed"
  | "cancelled"
  | "meeting";

interface VoicePillProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  variant: "floating" | "panel";
  state: VoicePillState;
  getAudioLevel: () => number | null;
  expanded?: boolean;
  collapseToLogo?: boolean;
  waveformVisible?: boolean;
  waveformOnlyWhileRecording?: boolean;
  integratedWithPanel?: boolean;
  /** The cancel button's liquid skin owns the fused surface; go headless. */
  liquidFused?: boolean;
  agentMode?: boolean;
  showExpandChevron?: boolean;
  isDragging?: boolean;
  horizontalDirection?: "left" | "right";
  /** Stage text for labelled states (transcribing, cleaning, pasted, cancelled). */
  label?: ReactNode;
  /** Where dictation goes; drawn as the ring around the identity (D4). */
  locality?: PillLocality | null;
  /** Undo window underline for the cancelled state (D3). */
  countdown?: { durationMs: number; paused: boolean } | null;
}

const COMPACT_CONTENT_GAP_PX = 6;
const IDENTITY_RING_PX = 30;
const LABELLED = new Set<VoicePillState>(["transcribing", "cleaning", "pasted", "cancelled"]);
const GLOWING = new Set<VoicePillState>(["thinking", "transcribing", "cleaning"]);
const REST_HEIGHTS = LOGO_BAR_SHAPE.map((scale) => Math.round(scale * 20));

// Mirrored by .liquid-cancel-skin[data-pill-state] in dictation-panel.css,
// which redraws this chrome while the cancel skin owns the fused surface —
// change together.
const STATE_APPEARANCE: Record<VoicePillState, string> = {
  idle: "border-border-hover bg-surface-1 text-muted-foreground dark:border-border/50",
  hover: "border-border-hover bg-surface-3 text-foreground",
  recording: "border-border-hover bg-surface-1 text-foreground",
  processing: "border-border/60 bg-surface-1 text-foreground/70",
  thinking: "border-border/60 bg-surface-1 text-foreground",
  unavailable: "border-border/60 bg-surface-1 text-muted-foreground",
  transcribing: "border-border/60 bg-surface-1 text-foreground",
  cleaning: "border-border/60 bg-surface-1 text-foreground",
  pasted: "bg-surface-1 text-foreground",
  failed: "bg-surface-1 text-foreground",
  cancelled: "border-border-hover bg-surface-1 text-foreground",
  meeting: "border-border-hover bg-surface-1 text-foreground",
};

/** One persistent control that morphs between the pill's legible states. */
export const VoicePill = forwardRef<HTMLDivElement, VoicePillProps>(function VoicePill(
  {
    variant,
    state,
    getAudioLevel,
    expanded = false,
    collapseToLogo = false,
    waveformVisible = true,
    waveformOnlyWhileRecording = false,
    integratedWithPanel = false,
    liquidFused = false,
    agentMode = false,
    showExpandChevron = false,
    isDragging = false,
    horizontalDirection = "right",
    label,
    locality = null,
    countdown = null,
    className,
    style,
    ...props
  },
  ref
) {
  const isRecording = state === "recording";
  const isThinking = state === "thinking";
  const isUnavailable = state === "unavailable";
  const hasLabel = LABELLED.has(state) && label != null;
  const showSignalGlow = GLOWING.has(state);
  const isPanel = variant === "panel";
  const collapseToIdentity = collapseToLogo || isThinking || state === "failed";
  const showCompactPill =
    !collapseToIdentity &&
    (isRecording || hasLabel || expanded || (isPanel && !waveformOnlyWhileRecording));
  const showWaveformSlot = showCompactPill && !hasLabel;
  const footprint = hasLabel
    ? VOICE_PILL_FOOTPRINT[state as "transcribing" | "cleaning" | "pasted" | "cancelled"]
    : showCompactPill
      ? VOICE_PILL_FOOTPRINT.recording
      : VOICE_PILL_FOOTPRINT.idle;
  const floatingHover = !isPanel && state === "hover";
  // LevelBars holds readLevel in a ref and treats non-finite or sub-floor
  // input as silence (Plan 01 172f9df), so an inline adapter is enough.
  const readLevel = () => getAudioLevel() ?? 0;
  const identitySize = locality ? Math.round(IDENTITY_RING_PX * 0.7) : 22;
  const busy = state === "transcribing" || state === "cleaning" || isRecording;

  const icon =
    state === "pasted" ? (
      <Check className="pill-success-check" size={identitySize - 4} strokeWidth={2.5} aria-hidden="true" />
    ) : (
      <VoiceIdentityIcon
        size={identitySize}
        agentMode={agentMode}
        className={cn(
          "transition-[width,height] duration-200",
          state === "idle" && "text-foreground",
          (isUnavailable || state === "processing") && "animate-pulse"
        )}
      />
    );

  const pill = (
    <div
      ref={ref}
      className={cn(
        "voice-pill-control relative flex items-center justify-center overflow-hidden rounded-full border",
        showCompactPill && "pe-1.5",
        hasLabel && "ps-1 pe-3",
        "shadow-[var(--shadow-card)]",
        STATE_APPEARANCE[state],
        className
      )}
      style={{
        width: footprint.width,
        height: footprint.height,
        cursor:
          state === "processing" || isThinking || state === "transcribing" || state === "cleaning"
            ? "not-allowed"
            : isDragging
              ? "grabbing"
              : "pointer",
        boxShadow: floatingHover && !liquidFused ? "var(--shadow-card-hover-subtle)" : undefined,
        transition: `width ${VOICE_PILL_GROW_TRANSITION}, height ${VOICE_PILL_GROW_TRANSITION}, padding-left ${VOICE_PILL_GROW_TRANSITION}, padding-right ${VOICE_PILL_GROW_TRANSITION}, background-color var(--motion-fast) var(--motion-ease-std), border-color var(--motion-fast) var(--motion-ease-std), box-shadow var(--motion-fast) var(--motion-ease-std)`,
        ...style,
      }}
      data-pill-state={state}
      data-horizontal-direction={horizontalDirection}
      data-integrated-with-panel={integratedWithPanel || undefined}
      data-liquid-fused={liquidFused || undefined}
      data-agent-mode={agentMode || undefined}
      data-agent-beam-active={(agentMode && isThinking) || undefined}
      data-expand-chevron={showExpandChevron || undefined}
      {...props}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-foreground/10 to-transparent transition-opacity duration-200 ease-out"
        style={{ opacity: state === "hover" ? 0.72 : 0 }}
      />

      <span
        className="voice-pill-identity-slot relative inline-grid shrink-0 place-items-center"
        style={{ width: locality ? IDENTITY_RING_PX : 22, height: locality ? IDENTITY_RING_PX : 22 }}
        aria-hidden={locality ? undefined : "true"}
      >
        <span
          className={cn(
            "voice-pill-identity-logo absolute inset-0 grid place-items-center transition-[opacity,transform] duration-200 ease-out",
            showExpandChevron ? "translate-y-1 scale-75 opacity-0" : "scale-100 opacity-100"
          )}
        >
          {locality ? (
            <LocalityRing
              locality={locality.locality}
              provider={locality.provider}
              label={locality.label}
              active={busy && locality.locality === "remote"}
              size={IDENTITY_RING_PX}
              className={cn(locality.blocked && "locality-ring--blocked")}
            >
              {icon}
            </LocalityRing>
          ) : (
            icon
          )}
        </span>
        <ChevronUp
          className={cn(
            "voice-pill-expand-chevron absolute inset-0 m-auto size-5 transition-[opacity,transform] duration-200 ease-out",
            showExpandChevron ? "scale-100 opacity-100" : "translate-y-1 scale-75 opacity-0"
          )}
          strokeWidth={2}
        />
      </span>

      {hasLabel ? (
        <span className="pill-stage-label ms-1.5">{label}</span>
      ) : (
        <div
          className="voice-pill-waveform relative grid shrink-0 place-items-center overflow-hidden"
          style={{
            width: showWaveformSlot ? 44 : 0,
            height: showWaveformSlot ? 24 : 32,
            marginInlineStart: showWaveformSlot ? COMPACT_CONTENT_GAP_PX : 0,
            transition: `width ${VOICE_PILL_GROW_TRANSITION}, height ${VOICE_PILL_GROW_TRANSITION}`,
          }}
        >
          {isRecording ? (
            // Mounted only while listening, so its sampling interval runs only
            // in the active state (loops are gated, DESIGN.md "Motion").
            <LevelBars
              readLevel={readLevel}
              height={20}
              className={cn(
                "transition-opacity duration-200 ease-out",
                showCompactPill && waveformVisible ? "opacity-100" : "opacity-0"
              )}
            />
          ) : showWaveformSlot && waveformVisible ? (
            <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
              {REST_HEIGHTS.map((h, i) => (
                <span key={i} data-level-bar-rest="" className="block w-1 rounded-full bg-current opacity-40" style={{ height: h }} />
              ))}
            </span>
          ) : null}
        </div>
      )}

      {countdown ? (
        <span
          className="pill-countdown"
          style={{ animationDuration: `${countdown.durationMs}ms`, "--undo-ms": `${countdown.durationMs}ms` } as CSSProperties}
          data-paused={countdown.paused ? "true" : undefined}
          aria-hidden="true"
        />
      ) : null}

      {isUnavailable && (
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-foreground/30 animate-pulse" />
      )}
    </div>
  );

  return (
    <span className="voice-pill-glow-anchor">
      <span
        aria-hidden="true"
        className="processing-signal-glow"
        data-active={showSignalGlow ? "true" : undefined}
        data-stage={state === "transcribing" || state === "cleaning" ? state : undefined}
        data-agent={agentMode || undefined}
      >
        <span className="processing-signal-ring" />
      </span>
      {pill}
    </span>
  );
});
```

Check that `Check` is exported from `src/components/icons` (`grep -n "Check\b" src/components/icons/index.*`). If it is not, add the lucide re-export the same way the neighbouring icons are exported.

Delete `PillWaveform.tsx` and `waveformMath.ts`. Then run `grep -rn "waveformMath\|PillWaveform\|RESTING_WAVE_SILHOUETTE\|WAVEFORM_BAR_COUNT" src test` and remove each remaining reference. The known references are `voicePillStructure.test.js` (handled in Step 1) and any `liveWaveform`/`rtlMotion` assertion that names them.

- [ ] **Step 5: CSS**

Append to `src/styles/dictation-panel.css`, before the `@media (prefers-reduced-motion: reduce)` block at line 658:

```css
/* VO-R1 C stage chrome. Labels truncate inside the fixed footprints so long
   translations never widen the pill past the 184px dock budget. */
.pill-stage-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 500 12.5px/1 var(--font-family-sans);
  font-variant-numeric: tabular-nums;
}

.voice-pill-control[data-pill-state="pasted"] {
  border-color: var(--color-success);
}
.voice-pill-control[data-pill-state="failed"] {
  border-color: var(--color-destructive);
  animation: pill-nudge 260ms var(--motion-ease-std) 1;
}
.voice-pill-control[data-pill-state="recording"] {
  border-color: color-mix(in oklch, var(--color-live) 55%, transparent);
}

.pill-success-check {
  color: var(--color-success);
  stroke-dasharray: 24;
  animation:
    draw-check 220ms var(--motion-ease-std) 80ms both,
    pill-pop 640ms var(--motion-spring-bounce) both;
}
@keyframes pill-pop {
  from {
    transform: scale(0.4);
    opacity: 0;
  }
}
@keyframes pill-nudge {
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(0); }
}

/* D3 undo window: a 2px live-orange underline that shrinks over the window
   and freezes while the pointer rests on the pill (the RAM hold pauses too). */
.pill-countdown {
  position: absolute;
  inset-inline: 14px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--color-live);
  transform-origin: left center;
  animation-name: pill-countdown;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
[dir="rtl"] .pill-countdown {
  transform-origin: right center;
}
.pill-countdown[data-paused="true"] {
  animation-play-state: paused;
}
@keyframes pill-countdown {
  to {
    transform: scaleX(0);
  }
}

/* Transcribing is all orange; cleaning keeps Plan 01's orange→magenta tail. */
.processing-signal-glow[data-stage="transcribing"] {
  --signal-deep: var(--signal-core);
}

/* Words and honest copy live on their own layer above the pill (D9). */
.pill-caption {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0; /* physical: follows the pill's screen dock, like .notice-stack[data-placement="pill"] */
  max-width: 184px;
  padding: 5px 9px;
  border-radius: 10px;
  background: var(--color-popover);
  color: var(--color-popover-foreground);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-elevated, 0 8px 24px rgb(0 0 0 / 0.14));
  font: 500 12px/1.35 var(--font-family-sans);
  animation: notice-in var(--motion-base) var(--motion-ease-enter) both;
}
.pill-caption[data-direction="left"] {
  left: auto;
  right: 0;
}

.locality-ring--blocked {
  opacity: 0.5;
}
.locality-ring--blocked::after {
  content: "";
  position: absolute;
  inset: 45% -2px auto;
  height: 2px;
  background: currentColor;
  transform: rotate(-45deg);
}

.liquid-cancel-skin[data-pill-state="transcribing"] path,
.liquid-cancel-skin[data-pill-state="cleaning"] path {
  stroke: color-mix(in oklch, var(--color-border) 60%, transparent);
}
```

Inside the existing reduced-motion block (lines 658–707), add:

```css
  .voice-pill-control[data-pill-state="failed"],
  .pill-success-check,
  .pill-caption {
    animation: none;
  }
  /* index.css forces animation-duration: 0.01ms !important on everything under
     reduced motion; the countdown is information, not decoration, so it keeps
     its real length and steps in fifths instead of sliding. */
  .pill-countdown {
    animation-duration: var(--undo-ms) !important;
    animation-iteration-count: 1 !important;
    animation-timing-function: steps(5, end) !important;
  }
```

Check that `draw-check` exists (`grep -n "@keyframes draw-check" src/index.css src/styles/*.css`). If it does not, add `@keyframes draw-check { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }` next to `pill-pop`.

- [ ] **Step 6: Wire `App.jsx`**

1. Add these imports:
   - `resolvePillStage` (same `../helpers/voicePillPresentation` path App already uses);
   - `usePillLocality`, `PillCaption` and `useRecentOutcome`;
   - `resolvePillOwnership` and `shouldAutoHidePill` (same module as `resolvePillStage`);
   - `disclosureCopy` from `./helpers/dictationDisclosure`.

   `useSettingsStore` is already imported. `disclosureCopy` renders the `RemoteDisclosure` in `cancelled.remoteAlreadySent`. It names the receiver through `providerDisplayLabel` (Plan 01 review item 1), and says "may have received" when only the renderer saw the dispatch (Task 7).
2. After `micState` (line 481):

   ```js
     const pillLocality = usePillLocality();
     const recentOutcome = useRecentOutcome(outcome);
     const pillStage = resolvePillStage({
       isRecording: voicePillIsRecording,
       micUnavailable: micState === "unavailable",
       isProcessing: voicePillIsProcessing && isProcessing,
       processingStage,
       agentMode: agentModeActive,
       cancelled,
       recentOutcome,
       meetingRecording: null, // Task 17
       showMeetingRecorder: true, // Task 17
     });
     const pillOwnership = resolvePillOwnership(pillStage);
     // The underline's length is sampled once per cancel session, so pause and
     // resume updates never restart it; `paused` freezes it in CSS.
     const undoWindowRef = useRef({ sessionId: null, ms: null });
     if (!cancelled) undoWindowRef.current = { sessionId: null, ms: null };
     else if (undoWindowRef.current.sessionId !== cancelled.sessionId) {
       undoWindowRef.current = { sessionId: cancelled.sessionId, ms: cancelled.remainingMs };
     }
     const undoMs = undoWindowRef.current.ms;
     const stageLabel =
       pillStage === "transcribing" ? t("pill.stage.transcribing")
       : pillStage === "cleaning" ? t("pill.stage.cleaning")
       : pillStage === "pasted" && recentOutcome?.kind === "pasted" ? t("pill.stage.pasted", { count: recentOutcome.words })
       : pillStage === "cancelled" ? t("pill.stage.discardedUndo")
       : undefined;
     const pillCaption =
       pillStage === "cancelled" && cancelled.remoteAlreadySent
         ? disclosureCopy(cancelled.remoteAlreadySent, t)
         : null;
   ```

   `agentModeActive` is computed at line 512, after `micState`. Move the `pillStage` block below line 517 so it can read `agentModeActive`.
3. Replace `commonPillState` (lines 576–581):

   ```js
     const commonPillState =
       micState === "unavailable"
         ? "unavailable"
         : listeningEntrance.activeState ||
           (voiceActivity.isAgentThinking ? "thinking" : null) ||
           (pillStage && pillStage !== "recording" ? pillStage : null) ||
           voiceActivity.activeState ||
           (assistant.open ? (isHovered ? "hover" : "idle") : micState);
   ```

4. In `activateVoicePill` (lines 540–557), add as its first statement:

   ```js
       if (cancelled) {
         void undoCancel();
         return;
       }
   ```

5. In the pill `onMouseEnter`/`onMouseLeave` (lines 648–659), add `if (cancelled) pauseUndo();` and `if (cancelled) resumeUndo();` respectively. The window pauses in AudioManager (Task 8), and the emitted `cancelled.paused` drives the underline.
6. On `<VoicePill …>` (lines 666–739), add these props:

   ```jsx
     label={stageLabel}
     locality={pillLocality}
     countdown={pillStage === "cancelled" && undoMs !== null ? { durationMs: undoMs, paused: cancelled.paused } : null}
   ```

   Change `aria-label` to read the stage when one is active: `aria-label={stageLabel ?? <the existing label>}`.
7. Render the caption as a sibling of the pill inside `div.assistant-pill-presence` (lines 639–660):

   ```jsx
     {pillCaption ? (
       <PillCaption horizontalDirection={voiceHorizontalDirection}>{pillCaption}</PillCaption>
     ) : null}
   ```

8. The fused cancel skin must match the pill it fuses with. `cancelPillFootprint` (about line 537) today picks `VOICE_PILL_FOOTPRINT.recording` or `.idle`. Make it follow the stage:

   ```js
     const cancelPillFootprint =
       VOICE_PILL_FOOTPRINT[pillStage] ?? (isCompactPill ? VOICE_PILL_FOOTPRINT.recording : VOICE_PILL_FOOTPRINT.idle);
   ```

   This keeps the 144 px "Transcribing…" capsule from being fused to a 98 px skin on hover.
9. **Stage ownership (I4).** Every owner of visibility and input reads `pillOwnership`:
   - **Auto-hide** (lines 403–434). Replace the inline condition with `shouldAutoHidePill({ floatingIconAutoHide, isRecording, isVisuallyProcessing, noticesOnScreen, wordsCardHandoffActive, assistantMounted: assistant.mounted, liveTranscriptMounted: liveTranscript.mounted, ownership: pillOwnership })`, and add `pillOwnership.holdsWindow` to the dependency list. Add a branch so a stage that holds the window brings back an auto-hidden pill: `else if (floatingIconAutoHide && pillOwnership.holdsWindow) window.electronAPI?.showDictationPanel?.();`.
   - **Footer suppression** (lines 599–604). Pass `ownership: pillOwnership` to `shouldSuppressPillForAssistantActions`.
   - **Input** (lines 519–525). Pass `ownership: pillOwnership` to `resolveVoicePillInteraction`. `pillIsInteractive` then feeds:
     - the hover handlers (mac/Windows click-through, `setWindowInteractivity`);
     - `useLinuxPillInteractivity`'s `pillInteractive` (line 622).

     The Linux input region measures `pillPresenceRef` (`useLinuxPillInteractivity.ts:51`). Undo is the pill itself, and Stop is an in-flow child of the pill (Task 17), so both lie inside the measured rect.
   - **Size.** No new size key. The cancelled (160 px) and meeting (124–184 px) footprints fit `PILL_WINDOW_SIZE`.

- [ ] **Step 7: Locale strings and DESIGN.md**

Add this to `en/translation.json` and mirror it to all 12 locales. For `ar`, `ru`, `ja` and `zh-*`, keep the English text until translated; i18next plural suffixes apply.

```json
"pill": {
  "stage": {
    "transcribing": "Transcribing…",
    "cleaning": "Cleaning up",
    "pasted_one": "Pasted · {{count}} word",
    "pasted_other": "Pasted · {{count}} words",
    "discardedUndo": "Discarded · Undo"
  },
  "caption": {
    "remoteAudio": "{{provider}} already received the audio.",
    "remoteText": "{{provider}} already received the text.",
    "remoteImage": "{{provider}} already received the screenshot.",
    "mayHaveAudio": "{{provider}} may have received the audio.",
    "mayHaveText": "{{provider}} may have received the text.",
    "mayHaveImage": "{{provider}} may have received the screenshot.",
    "remoteSeveral": "{{provider}} already received parts of this dictation.",
    "mayHaveSeveral": "{{provider}} may have received parts of this dictation."
  },
  "locality": { "sealed": "Blocked by Sealed mode" },
  "route": {
    "speech": "Speech: {{where}}",
    "cleanup": "Cleanup: {{where}}",
    "speechOff": "Speech: off",
    "cleanupOff": "Cleanup: off"
  }
}
```

`npm run i18n:check` requires every CLDR plural category that a locale uses (`scripts/check-i18n.js`, `pluralProbe`).

| Locales | Keys for `pill.stage.pasted` |
|---|---|
| `ja`, `zh-CN`, `zh-TW` | `pasted_other` only |
| `de`, `en` | `_one`, `_other` |
| `es`, `fr`, `it`, `pt` | `_one`, `_many`, `_other` |
| `ru` | `_one`, `_few`, `_many`, `_other` |
| `ar` | `_zero`, `_one`, `_two`, `_few`, `_many`, `_other` |

Each value interpolates `{{count}}`. Use the English text as a placeholder until translated. If the checker lists a different set for a locale, follow the checker.

In `DESIGN.md` `### Voice Pill`, replace the state description with:
- the stage table from Task 10: footprints, label, ring, timing and the ownership column;
- one line per rule:
  - "words and honest copy sit on a caption layer above the pill, never inside it (D9)";
  - "the identity sits in the locality ring (solid device, dotted network, dashed + badge remote; struck through when Sealed mode blocks it)";
  - "the success beat is 700 ms";
  - "the undo underline is 5 s or 10 s and pauses on hover".

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- test/components/pillLocality.test.js test/helpers/voicePillStructure.test.js test/helpers/voicePillPresentation.test.js test/helpers/liquidCancelFusion.test.js test/helpers/agentDictationPillIpc.test.js test/components/levelBars.test.js test/components/localityRing.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src/components/dictation src/hooks/useRecentOutcome.ts src/App.jsx src/styles/dictation-panel.css src/locales DESIGN.md test
git commit -m "feat(voice): condensation pill with LevelBars, locality ring and undo capsule"
```

---
### Task 12: Condensation words on their own layer (VO-R1 C, D9)

Live words condense into a row **above** the pill, in the `PillCaption` layer. The bars inside the pill are never covered or clipped. During cleanup, changed words are rewritten with a 600 ms orange underline.

**Files:**
- Create: `src/components/dictation/condensation.ts`
- Create: `src/components/dictation/CondensationWords.tsx`
- Modify: `src/hooks/useAudioRecording.js`. Add `liveText` state: set it in `onPartialTranscript` (line 429), set `cleaned` in `onTranscriptionComplete`, and reset it at start and at idle.
- Modify: `src/App.jsx`. Render the words in the caption layer.
- Modify: `src/styles/dictation-panel.css`
- Test: `test/components/condensation.test.js`

**Interfaces:**
- Consumes `PillCaption` (Task 11) and `pillStage` (Task 11, in App).
- Produces:

  ```ts
  export interface CondensedWord { key: string; text: string; committed: boolean; changed: boolean }
  export const CONDENSATION_MAX_WORDS = 6;
  export function splitWords(text: string): string[];
  export function condenseWords(committed: string, partial: string): CondensedWord[];
  export function diffWords(raw: string, cleaned: string): CondensedWord[]; // cleaned tokens, `changed` where cleanup rewrote them
  export function CondensationWords(props: { words: CondensedWord[] }): JSX.Element | null;
  // useAudioRecording return gains (internal, not a §5 contract):
  liveText: { committed: string; partial: string; cleaned: string | null };
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/condensation.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/dictation/condensation.ts");
const css = () =>
  fs.readFileSync(path.join(__dirname, "../../src/styles/dictation-panel.css"), "utf8");

test("committed words are stable; the partial tail is marked uncommitted", async () => {
  const { condenseWords } = await load();
  const words = condenseWords("hey maya can you", "move the");
  assert.deepEqual(words.map((w) => [w.text, w.committed]), [
    ["hey", true], ["maya", true], ["can", true], ["you", true], ["move", false], ["the", false],
  ]);
  const later = condenseWords("hey maya can you move the", "design");
  // Keys are positions in the whole utterance, so a word keeps its key when it commits.
  assert.equal(later.find((w) => w.text === "move").key, words.find((w) => w.text === "move").key);
});

test("only the last six words stay on the row", async () => {
  const { condenseWords, CONDENSATION_MAX_WORDS } = await load();
  const words = condenseWords("one two three four five six seven", "eight");
  assert.equal(words.length, CONDENSATION_MAX_WORDS);
  assert.equal(words[0].text, "three");
  assert.equal(words.at(-1).text, "eight");
});

test("cleanup diff marks rewritten words and leaves the rest", async () => {
  const { diffWords } = await load();
  const diff = diffWords("move the review to thursday at two", "move the review to Thursday at 2.");
  assert.deepEqual(diff.filter((w) => w.changed).map((w) => w.text), ["Thursday", "2."]);
  assert.deepEqual(diffWords("same words", "same words").filter((w) => w.changed), []);
  assert.deepEqual(diffWords("", "").length, 0);
});

test("the row renders partial and changed words with their classes", async () => {
  const { CondensationWords } = await import("../../src/components/dictation/CondensationWords.tsx");
  const html = renderStatic(CondensationWords, {
    words: [
      { key: "0", text: "hey", committed: true, changed: false },
      { key: "1", text: "Thursday", committed: true, changed: true },
      { key: "2", text: "at", committed: false, changed: false },
    ],
  });
  assert.match(html, /class="condense-word is-changed"[^>]*>Thursday</);
  assert.match(html, /class="condense-word is-partial"[^>]*>at</);
  // One spark, for the newest committed unchanged word ("hey"), outside the track.
  assert.equal((html.match(/class="condense-spark"/g) || []).length, 1);
  assert.match(html, /<\/span><span class="condense-spark"/);
  assert.equal(renderStatic(CondensationWords, { words: [] }), "");
});

test("words land with the specified motion and no flight under reduced motion", () => {
  const styles = css();
  assert.match(styles, /\.condense-word\s*\{[^}]*animation:\s*condense-in 220ms var\(--motion-ease-enter\)/);
  assert.match(styles, /@keyframes condense-in\s*\{\s*from\s*\{[^}]*filter:\s*blur\(6px\)/);
  assert.match(styles, /\.condense-word\.is-changed::after\s*\{[^}]*animation:\s*condense-underline 600ms/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.condense-spark\s*\{\s*display:\s*none/);
});

test("words never render inside the pill box (D9)", () => {
  const pill = fs.readFileSync(path.join(__dirname, "../../src/components/dictation/VoicePill.tsx"), "utf8");
  assert.doesNotMatch(pill, /CondensationWords|condense-word/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/condensation.test.js`
Expected: FAIL with `Cannot find module '…/condensation.ts'`.

- [ ] **Step 3: Implement**

`src/components/dictation/condensation.ts`:

```ts
export interface CondensedWord {
  key: string;
  text: string;
  committed: boolean;
  changed: boolean;
}

export const CONDENSATION_MAX_WORDS = 6;

export function splitWords(text: string): string[] {
  return (text ?? "").trim().split(/\s+/u).filter(Boolean);
}

/** Words for the row: committed finals, then the in-flight partial tail. */
export function condenseWords(committed: string, partial: string): CondensedWord[] {
  const done = splitWords(committed);
  const tail = splitWords(partial);
  const all = [
    ...done.map((text, i) => ({ key: String(i), text, committed: true, changed: false })),
    ...tail.map((text, i) => ({ key: String(done.length + i), text, committed: false, changed: false })),
  ];
  return all.slice(-CONDENSATION_MAX_WORDS);
}

const bare = (word: string) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");

/**
 * Cleaned words, marking the ones cleanup rewrote (VO-R1 C / R4-C). Matching is
 * a longest-common-subsequence over words with edge punctuation stripped, so
 * a moved comma does not light the whole sentence; case changes do count,
 * because cleanup did change them.
 */
export function diffWords(raw: string, cleaned: string): CondensedWord[] {
  const a = splitWords(raw).map(bare);
  const bWords = splitWords(cleaned);
  const b = bWords.map(bare);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const kept = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      kept.add(j);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i += 1;
    else j += 1;
  }
  return bWords
    .map((text, j) => ({ key: String(j), text, committed: true, changed: !kept.has(j) }))
    .slice(-CONDENSATION_MAX_WORDS);
}
```

`src/components/dictation/CondensationWords.tsx`:

```tsx
import type { CondensedWord } from "./condensation";

/**
 * The word row that sits in the caption layer above the pill. Each committed
 * word gets a spark that rises from the bar row into its slot (the "bar flies
 * 140ms, word lands 220ms" beat); the pill's bars are never covered (D9).
 */
export function CondensationWords({ words }: { words: CondensedWord[] }) {
  if (words.length === 0) return null;
  // The spark lives outside the clipped, masked track. It is keyed by the
  // newest committed word, so it replays once per commit, rising from the
  // pill's top edge into the row. It never crosses into the bars (D9).
  const newest = [...words].reverse().find((w) => w.committed && !w.changed);
  return (
    <>
      <span className="condense-track" aria-hidden="true">
        {words.map((word) => (
          <span
            key={word.key}
            className={["condense-word", word.changed && "is-changed", !word.committed && "is-partial"]
              .filter(Boolean)
              .join(" ")}
          >
            {word.text}
          </span>
        ))}
      </span>
      {newest ? <span key={`spark-${newest.key}`} className="condense-spark" aria-hidden="true" /> : null}
    </>
  );
}
```

CSS (append to `src/styles/dictation-panel.css`, before the reduced-motion block):

```css
/* Condensation (VO-R1 C): words land in the caption layer, newest at the end;
   older words fade out under a 24px mask on the leading edge. */
.condense-track {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  overflow: hidden;
  white-space: nowrap;
  mask-image: linear-gradient(90deg, transparent, #000 24px);
}
[dir="rtl"] .condense-track {
  mask-image: linear-gradient(270deg, transparent, #000 24px);
}
.condense-word {
  position: relative;
  flex: none;
  font: 500 13px/1.3 var(--font-family-sans);
  animation: condense-in 220ms var(--motion-ease-enter) 100ms both;
}
.condense-word.is-partial {
  opacity: 0.55;
  font-style: italic;
  transition: opacity 160ms var(--motion-ease-std);
}
@keyframes condense-in {
  from {
    opacity: 0;
    transform: translateY(8px);
    filter: blur(6px);
  }
}
.condense-word.is-changed::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  bottom: -3px;
  height: 2px;
  border-radius: 2px;
  background: var(--color-live);
  animation: condense-underline 600ms var(--motion-ease-std) both;
}
@keyframes condense-underline {
  to {
    opacity: 0;
  }
}
/* The spark: a 2px bar that rises from the pill's top edge (the caption sits
   8px above the pill) to the newest word at the row's trailing end over
   140ms, then fades. It is positioned on .pill-caption, outside the masked
   track, and never overlaps the pill's bars (D9). */
.condense-spark {
  position: absolute;
  right: 18px;
  bottom: -8px;
  width: 2px;
  height: 10px;
  border-radius: 2px;
  background: var(--color-live);
  animation: condense-spark 320ms var(--motion-ease-std) both;
  pointer-events: none;
}
@keyframes condense-spark {
  0% {
    transform: translateY(0) scaleY(1);
    opacity: 1;
  }
  44% {
    transform: translateY(-14px) scaleY(0.3);
    opacity: 1;
  }
  100% {
    transform: translateY(-14px) scaleY(0.3);
    opacity: 0;
  }
}
```

Inside the reduced-motion block, add:

```css
  .condense-spark {
    display: none;
  }
  .condense-word {
    animation: notice-fade 120ms linear both;
  }
```

`useAudioRecording.js`:
- State: `const [liveText, setLiveText] = useState({ committed: "", partial: "", cleaned: null });`.
- In `onPartialTranscript` (line 429), after `setPartialTranscript(text)`, add `setLiveText({ committed: audioManagerRef.current?.streamingFinalText ?? "", partial: text, cleaned: null });`.
- In `onTranscriptionComplete`, at the top, add `setLiveText((prev) => (prev.committed || prev.partial ? { ...prev, cleaned: result.text } : prev));`.
- Reset with `setLiveText({ committed: "", partial: "", cleaned: null })` at successful start (next to `registerCancelHotkey`) and when the pill idles after the outcome beat. Clear it in the same `onStateChange` idle branch only when no outcome is pending. In practice, App stops reading `liveText` outside the stages listed below, so resetting at start is sufficient.
- Add `liveText` to the return object.

`App.jsx`:
- Compute the words:

  ```js
    const condensed = useMemo(() => {
      if (liveTranscript.mounted) return [];
      if (pillStage === "pasted" && liveText.cleaned) {
        const raw = `${liveText.committed} ${liveText.partial}`.trim();
        return diffWords(raw, liveText.cleaned);
      }
      if (pillStage === "recording" || pillStage === "transcribing" || pillStage === "cleaning") {
        return condenseWords(liveText.committed, liveText.partial);
      }
      return [];
    }, [liveTranscript.mounted, pillStage, liveText]);
  ```

- Render the words in the caption slot from Task 11, which now accepts either the D3 copy or the words:

  ```jsx
    {pillCaption ? (
      <PillCaption horizontalDirection={voiceHorizontalDirection}>{pillCaption}</PillCaption>
    ) : condensed.length > 0 ? (
      <PillCaption horizontalDirection={voiceHorizontalDirection}>
        <CondensationWords words={condensed} />
      </PillCaption>
    ) : null}
  ```

- While `condensed.length > 0`, pass `disabled` to `PillTooltip` so the tooltip and the word row never stack.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/condensation.test.js test/helpers/voicePillStructure.test.js "test/helpers/useAudioRecording*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dictation/condensation.ts src/components/dictation/CondensationWords.tsx src/hooks/useAudioRecording.js src/App.jsx src/styles/dictation-panel.css test/components/condensation.test.js
git commit -m "feat(voice): condensation word row above the pill with cleanup diff"
```

---

### Task 13: Agent Mode violet orbit, without the frame glyph (VO-R8 B)

**Files:**
- Create: `src/components/dictation/agentOrbitMath.ts`
- Create: `src/components/dictation/AgentOrbit.tsx`
- Create: `src/hooks/useAgentAnswering.ts`
- Modify: `src/components/dictation/VoicePill.tsx`. Mount the orbit, collapse to the circle while Agent listens, and drop the beam attribute.
- Modify: `src/styles/dictation-panel.css`. Remove `.voice-pill-control[data-agent-beam-active="true"]` (lines 250–258) and add the orbit rules.
- Modify: `src/App.jsx`. Add the answering phase and the Agent caption.
- Modify: `src/locales/*/translation.json` (`pill.agent.*`)
- Modify: `DESIGN.md` `### Voice Pill`, Agent paragraph
- Test: `test/components/agentOrbit.test.js`
- Test: `test/helpers/voicePillStructure.test.js`. Update the Agent tests at lines 238–310.

**Interfaces:**
- Consumes `nextLevelBarsFrame`, `LEVEL_BARS_SILENCE_FLOOR`, `LOGO_BAR_SHAPE` and `levelBarScale` (Plan 01, `levelBarsMath.ts`), `routeProviderLabel` (Task 11), `useResolvedRoute("voiceAssistant" | "assistantVision")` (§5.1), the `voiceAgentScreenContext` setting (`settingsStore.ts:1755`), `assistant.thinking` / `assistant.busy` (`useAssistantPanel.js:32-33`), and `PillCaption` (Task 11).
- Produces:

  ```ts
  export const AGENT_TICK_COUNT = 24;
  export function agentTickLength(index: number, level: number, timeMs: number, reduce?: boolean): number; // 2..11 px; flat phase when reduce
  export function agentTickLevel(frame: LevelBarsFrame, raw: unknown): number; // 0..1, peak-normalised with LEVEL_BARS_SILENCE_FLOOR
  export function AgentOrbit(props: { phase: "listening" | "thinking" | "answering"; readLevel: () => number }): JSX.Element;
  export function useAgentAnswering(thinking: boolean, busy: boolean): boolean; // true for 1000ms after the first token
  // VoicePill gains: agentPhase?: "answering"
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/agentOrbit.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const css = () =>
  fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8") +
  fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");

test("radial ticks stay between 2 and 11px and rest at 2px for bad input", async () => {
  const { agentTickLength, AGENT_TICK_COUNT } = await import("../../src/components/dictation/agentOrbitMath.ts");
  assert.equal(AGENT_TICK_COUNT, 24);
  for (let j = 0; j < 24; j += 1) {
    for (const level of [0, 0.3, 1]) {
      const len = agentTickLength(j, level, 1234);
      assert.ok(len >= 2 && len <= 11, `${j} ${level} ${len}`);
    }
  }
  for (const bad of [NaN, -1, Infinity]) assert.equal(agentTickLength(3, bad, 0), 2);
});

test("reduced motion uses a flat phase: every tick has the same length", async () => {
  const { agentTickLength } = await import("../../src/components/dictation/agentOrbitMath.ts");
  const lengths = new Set(Array.from({ length: 24 }, (_, j) => agentTickLength(j, 0.8, 999, true)));
  assert.equal(lengths.size, 1);
});

test("tick level reuses the LevelBars peak and silence floor", async () => {
  const { agentTickLevel } = await import("../../src/components/dictation/agentOrbitMath.ts");
  const { LEVEL_BARS_SILENCE_FLOOR } = await import("../../src/components/ui/levelBarsMath.ts");
  const frame = { scales: [0, 0, 0, 0, 0], peak: 0.1 };
  assert.equal(agentTickLevel(frame, LEVEL_BARS_SILENCE_FLOOR / 2), 0);
  assert.equal(agentTickLevel(frame, 0.05), 0.5);
  assert.equal(agentTickLevel(frame, 0.5), 1);
  assert.equal(agentTickLevel(frame, "junk"), 0);
});

test("listening draws 24 ticks; thinking draws the orbit with two satellites", async () => {
  const { AgentOrbit } = await import("../../src/components/dictation/AgentOrbit.tsx");
  const listening = renderStatic(AgentOrbit, { phase: "listening", readLevel: () => 0 });
  const thinking = renderStatic(AgentOrbit, { phase: "thinking", readLevel: () => 0 });
  assert.equal((listening.match(/<line /g) || []).length, 24);
  assert.match(thinking, /class="agent-orbit" data-phase="thinking"/);
  assert.equal((thinking.match(/class="agent-orbit__satellite/g) || []).length, 2);
});

test("orbit timing: 2.4s thinking, 1.2s answering that fades after 400ms", () => {
  const styles = css();
  assert.match(styles, /\.agent-orbit\[data-phase="thinking"\] \.agent-orbit__ring\s*\{[^}]*animation:\s*agent-orbit 2400ms linear infinite/);
  assert.match(styles, /\.agent-orbit\[data-phase="answering"\] \.agent-orbit__ring\s*\{[^}]*agent-orbit 1200ms linear infinite,\s*agent-orbit-fade 600ms var\(--motion-ease-exit\) 400ms forwards/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.agent-orbit__ring[\s\S]*animation:\s*none/);
});

test("no frame glyph and no beam ring ship with Agent Mode (owner note)", () => {
  const styles = css();
  const orbit = fs.readFileSync(path.join(repoRoot, "src/components/dictation/AgentOrbit.tsx"), "utf8");
  assert.doesNotMatch(orbit, /frame/i);
  assert.doesNotMatch(styles, /data-agent-beam-active/);
});
```

In `test/helpers/voicePillStructure.test.js`, rewrite the Agent tests (lines 238–310) to these expectations:
- `renderPill("thinking", false, "right", { agentMode: true })` contains `class="agent-orbit" data-phase="thinking"`, does **not** contain `data-agent-beam-active`, and the signal glow is not active (`doesNotMatch(/data-active="true"/)`).
- `renderPill("recording", true, "right", { agentMode: true })` keeps the 40×40 footprint (`pillFootprints().idle`) and contains `data-phase="listening"`.
- The violet identity leaf (`voice-identity-final-agent`, `data-agent-mode="true"`) assertions stay as they are.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/components/agentOrbit.test.js test/helpers/voicePillStructure.test.js`
Expected: FAIL with `Cannot find module '…/agentOrbitMath.ts'`.

- [ ] **Step 3: Implement**

`src/components/dictation/agentOrbitMath.ts` (the showcase formula, lines 1567–1569):

```ts
import { LEVEL_BARS_SILENCE_FLOOR, type LevelBarsFrame } from "../ui/levelBarsMath";

export const AGENT_TICK_COUNT = 24;
export const AGENT_TICK_SAMPLE_MS = 80;

/**
 * Length of radial tick `index` for a level in 0..1 (showcase formula). Under
 * reduced motion the per-tick phase is flat, matching LevelBars. Non-finite
 * levels rest at 2px.
 */
export function agentTickLength(index: number, level: number, timeMs: number, reduce = false): number {
  const safe = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const w = reduce
    ? 0.5
    : 0.5 + 0.5 * Math.sin(timeMs / 130 + index * 1.7) * Math.sin(timeMs / 310 + index * 0.6);
  return Math.round((2 + safe * w * 9) * 100) / 100;
}

/**
 * The same normalisation LevelBars uses: raw below the silence floor is
 * silence, otherwise level / decaying peak. `frame` comes from
 * nextLevelBarsFrame, so the ticks and the bars agree on what "loud" is.
 */
export function agentTickLevel(frame: LevelBarsFrame, raw: unknown): number {
  const sane = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  if (sane < LEVEL_BARS_SILENCE_FLOOR || !(frame.peak > 0)) return 0;
  return Math.min(1, sane / frame.peak);
}
```

`src/components/dictation/AgentOrbit.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { LOGO_BAR_SHAPE, levelBarScale, nextLevelBarsFrame } from "../ui/levelBarsMath";
import { AGENT_TICK_COUNT, AGENT_TICK_SAMPLE_MS, agentTickLength, agentTickLevel } from "./agentOrbitMath";

const R = 25; // inner radius in a 64×64 box centred on the 40px pill

function tickEnd(index: number, length: number) {
  const a = (index / AGENT_TICK_COUNT) * Math.PI * 2;
  return { x: 32 + Math.sin(a) * (R + length), y: 32 - Math.cos(a) * (R + length) };
}

/**
 * Agent Mode identity (VO-R8 B). Listening: 24 violet radial ticks driven by
 * the level feed. Thinking: a 2.4s conic orbit with two satellites (slower
 * than dictation's 1.6s comet, "thinking" not "working"). Answering: 1.2s for
 * 400ms, then it dissolves. Mounted only in those phases, so its loops are
 * gated. The screen-context glyph was cut (owner note, D9); the caption
 * above the pill says when screen context is on and where it goes.
 */
export function AgentOrbit({
  phase,
  readLevel,
}: {
  phase: "listening" | "thinking" | "answering";
  readLevel: () => number;
}) {
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  // Same pattern as LevelBars: keep the latest reader without restarting the timer.
  const readLevelRef = useRef(readLevel);
  readLevelRef.current = readLevel;

  useEffect(() => {
    if (phase !== "listening") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = { scales: LOGO_BAR_SHAPE.map((_, i) => levelBarScale(i, 0, 0.5)), peak: 0.01 };
    let level = 0;
    let last = performance.now();
    const id = setInterval(
      () => {
        const now = performance.now();
        let raw: unknown = 0;
        try {
          raw = readLevelRef.current();
        } catch {
          raw = 0;
        }
        // nextLevelBarsFrame owns the decaying peak and the silence floor.
        frame = nextLevelBarsFrame(frame, raw, now, now - last, reduce);
        last = now;
        const target = agentTickLevel(frame, raw);
        level = reduce ? target : level + (target - level) * 0.35;
        lineRefs.current.forEach((line, i) => {
          if (!line) return;
          const end = tickEnd(i, agentTickLength(i, level, now, reduce));
          line.setAttribute("x2", String(end.x));
          line.setAttribute("y2", String(end.y));
        });
      },
      reduce ? 100 : AGENT_TICK_SAMPLE_MS
    );
    return () => clearInterval(id);
  }, [phase]);

  return (
    <span className="agent-orbit" data-phase={phase} aria-hidden="true">
      {phase === "listening" ? (
        <svg className="agent-orbit__ticks" viewBox="0 0 64 64">
          {Array.from({ length: AGENT_TICK_COUNT }, (_, i) => {
            const start = tickEnd(i, 0);
            const end = tickEnd(i, 2);
            return (
              <line
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
              />
            );
          })}
        </svg>
      ) : (
        <>
          <span className="agent-orbit__ring" />
          <span className="agent-orbit__satellite" />
          <span className="agent-orbit__satellite agent-orbit__satellite--b" />
        </>
      )}
    </span>
  );
}
```

`src/hooks/useAgentAnswering.ts`:

```ts
import { useEffect, useRef, useState } from "react";

/** True for 1s after the Agent's first token (thinking → streaming while busy). */
export function useAgentAnswering(thinking: boolean, busy: boolean): boolean {
  const wasThinking = useRef(thinking);
  const [answering, setAnswering] = useState(false);
  useEffect(() => {
    if (wasThinking.current && !thinking && busy) {
      setAnswering(true);
      const id = setTimeout(() => setAnswering(false), 1000);
      wasThinking.current = thinking;
      return () => clearTimeout(id);
    }
    wasThinking.current = thinking;
    return undefined;
  }, [thinking, busy]);
  return answering;
}
```

`VoicePill.tsx` changes:
- Add the prop `agentPhase?: "answering"`.
- Add `const agentListening = agentMode && isRecording;` and include it in `collapseToIdentity` (`collapseToLogo || isThinking || state === "failed" || agentListening`).
- Change `showSignalGlow` to `GLOWING.has(state) && !agentMode`. The orbit replaces the violet glow.
- Remove the `data-agent-beam-active` attribute.
- Inside the glow anchor, after `{pill}`, add:

  ```tsx
        {agentMode && (agentListening || isThinking) ? (
          <AgentOrbit
            phase={agentListening ? "listening" : agentPhase === "answering" ? "answering" : "thinking"}
            readLevel={readLevel}
          />
        ) : null}
  ```

CSS: delete the beam rule (`dictation-panel.css:250-258`), then append:

```css
/* Agent Mode (VO-R8 B): violet orbit, satellites, radial level ticks. */
.agent-orbit {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--color-agent-brand);
}
.agent-orbit__ticks {
  position: absolute;
  inset: -12px;
  width: 64px;
  height: 64px;
}
.agent-orbit__ticks line {
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.agent-orbit__ring {
  position: absolute;
  inset: -4px;
  border-radius: 9999px;
  padding: 2px;
  background: conic-gradient(from var(--signal-angle), transparent 0 40%, color-mix(in oklch, var(--color-agent-brand) 70%, white) 80%, white 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
}
.agent-orbit[data-phase="thinking"] .agent-orbit__ring {
  animation: agent-orbit 2400ms linear infinite;
}
.agent-orbit[data-phase="answering"] .agent-orbit__ring {
  animation:
    agent-orbit 1200ms linear infinite,
    agent-orbit-fade 600ms var(--motion-ease-exit) 400ms forwards;
}
.agent-orbit__satellite {
  position: absolute;
  inset: 0;
  animation: agent-satellite 2400ms linear infinite;
}
.agent-orbit__satellite::before {
  content: "";
  position: absolute;
  inset-inline-start: 50%;
  top: -5px;
  width: 4px;
  height: 4px;
  margin-inline-start: -2px;
  border-radius: 9999px;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
}
.agent-orbit__satellite--b {
  animation-delay: -1200ms;
}
.agent-orbit__satellite--b::before {
  background: rgb(255 255 255 / 0.85);
}
.voice-pill-control[data-agent-mode="true"][data-pill-state="thinking"] .voice-identity-agent {
  animation: agent-breathe 2400ms ease-in-out infinite;
}
@keyframes agent-orbit {
  to {
    --signal-angle: 360deg;
  }
}
@keyframes agent-orbit-fade {
  to {
    opacity: 0;
  }
}
@keyframes agent-satellite {
  to {
    transform: rotate(360deg);
  }
}
@keyframes agent-breathe {
  50% {
    transform: scale(1.06);
  }
}
```

Inside the reduced-motion block, add:

```css
  .agent-orbit__ring,
  .agent-orbit__satellite,
  .voice-pill-control[data-agent-mode="true"] .voice-identity-agent {
    animation: none;
  }
  .agent-orbit__ring {
    background: var(--color-agent-brand);
  }
```

Imports: `VoicePill.tsx` imports `AgentOrbit` from `./AgentOrbit`. `App.jsx` imports `useAgentAnswering` from `./hooks/useAgentAnswering`, `routeProviderLabel` from `./components/dictation/pillLocality`, and `useResolvedRoute` from `./lib/routes`.

`App.jsx`:
- Add `const agentAnswering = useAgentAnswering(assistant.thinking, assistant.busy);` and pass `agentPhase={agentAnswering ? "answering" : undefined}` to `VoicePill`.
- Add the Agent caption. It shows in the caption layer while the pill is in Agent listening or thinking, unless the D3 caption is active:

  ```js
    const screenContextOn = useSettingsStore((s) => s.voiceAgentScreenContext);
    const agentRoute = useResolvedRoute(screenContextOn ? "assistantVision" : "voiceAssistant");
    const agentWhere =
      agentRoute.locality === "remote"
        ? routeProviderLabel(agentRoute, t)
        : t(`locality.${agentRoute.locality}`);
    const agentCaption = !agentModeActive
      ? null
      : voicePillIsRecording
        ? screenContextOn
          ? t("pill.agent.screenContext", { where: agentWhere })
          : t("pill.agent.listening")
        : voiceActivity.isAgentThinking
          ? t("pill.agent.thinking", { where: agentWhere })
          : null;
  ```

  Render it with the same `PillCaption`, ordered after `pillCaption` and before the condensation row (`pillCaption ?? agentCaption`).

Locale keys (`pill.agent`):

```json
"agent": {
  "listening": "Agent · listening",
  "screenContext": "Screen context on · sent to {{where}}",
  "thinking": "Thinking · {{where}}"
}
```

In `DESIGN.md` `### Voice Pill`, Agent paragraph:
- violet orbit at 2.4 s, with two satellites;
- 24 radial level ticks while listening;
- a 1.2 s spin-up on the first token, then a dissolve;
- the caption names where the request goes;
- no frame glyph.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/agentOrbit.test.js test/helpers/voicePillStructure.test.js test/helpers/voicePillPresentation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dictation/agentOrbitMath.ts src/components/dictation/AgentOrbit.tsx src/hooks/useAgentAnswering.ts src/components/dictation/VoicePill.tsx src/App.jsx src/styles/dictation-panel.css src/locales DESIGN.md test
git commit -m "feat(voice): Agent Mode violet orbit with radial level ticks"
```

---

### Task 14: Pill tooltip, idle hairline, the fused-halo fix and two Plan 01 leftovers

Covers VO-Q14, VO-Q19 and VO-Q20, plus Plan 01 review item 2: one exit curve and one off-brand shimmer.

**Files:**
- Create: `src/components/dictation/pillTooltipLines.ts`
- Modify: `src/components/dictation/PillTooltip.tsx`. Use 12 px text, allow two lines, and use a rounded rectangle.
- Modify: `src/App.jsx:483-494` (`getMicTooltip`)
- Modify: `src/styles/dictation-panel.css`. Covers VO-Q19, VO-Q20, and the `.assistant-response-content-updating` exit at about lines 566–572.
- Modify: `src/index.css`. Covers `.thinking-shimmer-text` (about line 1752), used by `ChatMessage.tsx:249`.
- Modify: `src/locales/*/translation.json` (`pill.tooltip.*`)
- Test: `test/components/pillTooltip.test.js`

**Interfaces:**
- Consumes `PillLocality.routeLine` (Task 11) and the `activationMode` setting (`"tap" | "push"`, `settingsStore.ts:1467`).
- Produces:

  ```ts
  export function buildPillTooltipLines(input: {
    micState: "idle" | "hover" | "recording" | "processing" | "unavailable";
    activationMode: "tap" | "push"; hotkeyLabel: string; routeLine: string; t: T;
  }): string[]; // 1–2 lines
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/pillTooltip.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const t = (key, opts) => (opts ? `${key}(${Object.values(opts).join(",")})` : key);
const repoRoot = path.join(__dirname, "../..");
const css = () => fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");

test("idle tooltip says Hold or Press and names where dictation goes (VO-Q14)", async () => {
  const { buildPillTooltipLines } = await import("../../src/components/dictation/pillTooltipLines.ts");
  assert.deepEqual(
    buildPillTooltipLines({ micState: "idle", activationMode: "push", hotkeyLabel: "⌥ Space", routeLine: "Speech: on this device · Cleanup: OpenAI", t }),
    ["pill.tooltip.hold(⌥ Space)", "Speech: on this device · Cleanup: OpenAI"]
  );
  assert.equal(
    buildPillTooltipLines({ micState: "idle", activationMode: "tap", hotkeyLabel: "⌥ Space", routeLine: "", t })[0],
    "pill.tooltip.press(⌥ Space)"
  );
  assert.deepEqual(
    buildPillTooltipLines({ micState: "recording", activationMode: "tap", hotkeyLabel: "x", routeLine: "r", t }),
    ["app.mic.recording", "r"]
  );
});

test("tooltip text is 12px, not 10px", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/components/dictation/PillTooltip.tsx"), "utf8");
  assert.doesNotMatch(src, /text-\[10px\]/);
  assert.match(src, /text-xs/);
});

test("idle pill wears a 1px outer hairline for any wallpaper (VO-Q19)", () => {
  const styles = css();
  assert.match(styles, /\.voice-pill-control\[data-pill-state="idle"\]:not\(\[data-liquid-fused\]\)\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--pill-hairline\)/);
  assert.match(styles, /--pill-hairline:\s*rgb\(255 255 255 \/ 0\.7\)/);
  assert.match(styles, /\.dark \.voice-pill-control\s*\{[^}]*--pill-hairline:\s*rgb\(0 0 0 \/ 0\.4\)/);
});

test("the halo hides while the cancel skin is fused (VO-Q20)", () => {
  assert.match(
    css(),
    /\.voice-pill-glow-anchor:has\(\.voice-pill-control\[data-liquid-fused="true"\]\) \.processing-signal-glow::before\s*\{[^}]*opacity:\s*0/
  );
});

test("the receding Agent answer exits on the exit curve (Plan 01 review)", () => {
  const rule = css().match(/\.assistant-response-content-updating\s*\{([^}]*)\}/)[1];
  assert.match(rule, /opacity var\(--motion-slow\) var\(--motion-ease-exit\)/);
  assert.match(rule, /filter var\(--motion-slow\) var\(--motion-ease-exit\)/);
  assert.doesNotMatch(rule, /ease-in-out/);
});

test("the thinking shimmer uses theme tokens, not cool hues (Plan 01 review)", () => {
  const index = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const rule = index.match(/\.thinking-shimmer-text\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /oklch\([^)]*\b(260|240|250)\)/);
  assert.match(rule, /var\(--color-muted-foreground\)/);
  assert.match(rule, /var\(--color-foreground\)/);
  assert.match(index, /prefers-reduced-motion: reduce[\s\S]*\.thinking-shimmer-text\s*\{[^}]*animation:\s*none/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/pillTooltip.test.js`
Expected: FAIL with `Cannot find module '…/pillTooltipLines.ts'`.

- [ ] **Step 3: Implement**

`src/components/dictation/pillTooltipLines.ts`:

```ts
type T = (key: string, options?: Record<string, unknown>) => string;

export function buildPillTooltipLines({
  micState,
  activationMode,
  hotkeyLabel,
  routeLine,
  t,
}: {
  micState: "idle" | "hover" | "recording" | "processing" | "unavailable";
  activationMode: "tap" | "push";
  hotkeyLabel: string;
  routeLine: string;
  t: T;
}): string[] {
  const first =
    micState === "recording"
      ? t("app.mic.recording")
      : micState === "unavailable"
        ? t("app.mic.waitingForMicrophone")
        : micState === "processing"
          ? t("app.mic.processing")
          : t(activationMode === "push" ? "pill.tooltip.hold" : "pill.tooltip.press", { hotkey: hotkeyLabel });
  return routeLine ? [first, routeLine] : [first];
}
```

In `PillTooltip.tsx`:
- In the bubble class (line 39), change `text-[10px]` to `text-xs` and `rounded-full` to `rounded-lg`.
- Change `px-1.5 py-1` to `px-2 py-1.5`.
- Wrap the content in `<span className="flex flex-col gap-0.5">`. Leave `whitespace-nowrap`, since each line stays a single line.
- Keep the physical `left-*`/`right-*` in `alignClass` and `arrowClass`. `align` follows the pill's physical screen dock, not the text direction, so mirroring it in RTL would point the tooltip away from the pill.

In `App.jsx`, replace `getMicTooltip` (lines 483–494):

```jsx
  const activationMode = useSettingsStore((s) => s.activationMode);
  const micTooltip = (
    <>
      {buildPillTooltipLines({
        micState,
        activationMode,
        hotkeyLabel: formatPillHotkeyLabel(hotkey),
        routeLine: pillLocality.routeLine,
        t,
      }).map((line, i) => (
        <span key={i} className={i === 0 ? undefined : "text-muted-foreground"}>
          {line}
        </span>
      ))}
    </>
  );
```

`pillLocality` is computed in Task 11. Move that line above this block if needed.

CSS (append before the reduced-motion block):

```css
/* VO-Q19: a 1px outer hairline keeps the idle pill legible on any wallpaper. */
.voice-pill-control {
  --pill-hairline: rgb(255 255 255 / 0.7);
}
.dark .voice-pill-control {
  --pill-hairline: rgb(0 0 0 / 0.4);
}
.voice-pill-control[data-pill-state="idle"]:not([data-liquid-fused]) {
  /* --shadow-card is defined only under .dark; without the fallback the whole
     declaration would be invalid in light theme and the hairline would vanish. */
  box-shadow: 0 0 0 1px var(--pill-hairline), var(--shadow-card, 0 1px 3px rgb(0 0 0 / 0.12));
}

/* VO-Q20: while the cancel skin is fused, the 5px-blurred halo bled through
   as a filled disc that hid the logo; the comet ring alone stays. */
.voice-pill-glow-anchor:has(.voice-pill-control[data-liquid-fused="true"]) .processing-signal-glow::before,
.voice-pill-glow-anchor:has(.voice-pill-control[data-liquid-fused="true"]) .processing-signal-glow::after {
  opacity: 0;
}
```

**Plan 01 review item 2, part 1: the exit curve.** In `dictation-panel.css`, `.assistant-response-content-updating` is the state where the previous Agent answer recedes (fades and blurs) before the sweep. That makes it an exit. Replace its transition (today `opacity 480ms ease-in-out, filter 480ms ease-in-out`) with:

```css
  transition:
    opacity var(--motion-slow) var(--motion-ease-exit),
    filter var(--motion-slow) var(--motion-ease-exit);
```

360 ms still finishes before the shimmer sweep starts at 440 ms (`.assistant-content-area-shimmer::after`), so the choreography order holds. Leave the restore rule (`.assistant-response-content`, 260 ms ease-out) alone. It is an enter, and ease-out is allowed there.

**Plan 01 review item 2, part 2: the shimmer.** In `src/index.css`, replace the `.thinking-shimmer-text` gradient (four `oklch(… 260/240/250)` stops):

```css
.thinking-shimmer-text {
  /* Theme tokens: neutral ink in light, plum in Plum Night (Plan 01). The
     muted stops keep text contrast at the muted-foreground floor. */
  background: linear-gradient(
    90deg,
    var(--color-muted-foreground) 0%,
    var(--color-foreground) 40%,
    var(--color-muted-foreground) 60%,
    var(--color-muted-foreground) 100%
  );
  background-size: 200% 100%;
  animation: thinking-shimmer 2s linear infinite;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

Add this inside the nearest `@media (prefers-reduced-motion: reduce)` block in `index.css` (the one at about line 1597, or whichever follows the shimmer):

```css
  .thinking-shimmer-text {
    animation: none;
    background: none;
    -webkit-text-fill-color: var(--color-muted-foreground);
  }
```

`ChatMessage.tsx:249` is the only user (`git grep -n thinking-shimmer src`). No markup changes.

Locale keys:

```json
"tooltip": { "hold": "Hold {{hotkey}} to talk", "press": "Press {{hotkey}} to start" }
```

Add this under `pill`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/pillTooltip.test.js test/helpers/voicePillStructure.test.js test/components/rtlMotion.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dictation/pillTooltipLines.ts src/components/dictation/PillTooltip.tsx src/App.jsx src/styles/dictation-panel.css src/index.css src/locales test/components/pillTooltip.test.js
git commit -m "feat(voice): tooltip names hold or press and the route; idle hairline; halo fix; exit curve and shimmer tokens"
```

---

### Task 15: The soft sound family (VO-R10 A)

**Files:**
- Modify (rewrite): `src/utils/dictationCues.js`
- Modify: `src/stores/settingsStore.ts`. Add two string settings, `dictationCueSet` and `dictationCueVolume`, mirroring `activationMode`:
  - initial value at line 1467;
  - setter at lines 2145–2149;
  - type near line 1078;
  - cross-window sync. No string sync set exists yet (only `BOOLEAN_SETTINGS` at 195, `ARRAY_SETTINGS` at 238 and `NUMERIC_SETTINGS` at 248), so add `const STRING_SETTINGS = new Set(["dictationCueSet", "dictationCueVolume"]);` next to them. In the `storage` listener (around line 3197), add a branch that passes `newValue` through as a string for those keys. The pill window plays the cues, so a change made in Settings has to reach it.
- Modify: `src/hooks/useSettings.ts` (passthrough, next to `audioCuesEnabled` at lines 367–368)
- Modify: `src/components/SettingsPage.tsx:1689-1705` (Sound Effects section)
- Modify: `src/hooks/useAudioRecording.js`. Fire cues at press, success, cancel, error and mic back.
- Modify: `src/locales/*/translation.json`
- Test: `test/helpers/dictationCues.test.js` (new)
- Test: `test/helpers/useAudioRecordingCues.test.js` (new)

**Interfaces:**
- Produces:

  ```js
  export const CUE_SETS: { classic: CueSet; soft: CueSet };  // CueSet = Record<CueName, Note[] | null>
  export type CueName = "start" | "stop" | "success" | "cancel" | "error" | "back";
  export const CUE_VOLUME = { low: 0.5, medium: 1, high: 1.4 };
  export function scheduleCue(context: AudioContext, setName: "classic" | "soft", cue: CueName, volume: "low" | "medium" | "high"): number; // oscillators scheduled
  export const playStartCue, playStopCue, playSuccessCue, playCancelCue, playErrorCue, playMicBackCue: () => Promise<void>;
  ```

  Settings:
  - `dictationCueSet: "soft" | "classic"` (default `"soft"`);
  - `dictationCueVolume: "low" | "medium" | "high"` (default `"medium"`).

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/dictationCues.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");

function fakeContext() {
  const oscillators = [];
  const param = (log) => ({
    setValueAtTime: (v, t) => log.push(["set", v, t]),
    linearRampToValueAtTime: (v, t) => log.push(["lin", v, t]),
    exponentialRampToValueAtTime: (v, t) => log.push(["exp", v, t]),
  });
  return {
    currentTime: 10,
    destination: {},
    oscillators,
    createOscillator() {
      const osc = { type: null, freq: [], frequency: null, connect() {}, start() {}, stop() {} };
      osc.frequency = param(osc.freq);
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      const g = { log: [], connect() {} };
      g.gain = param(g.log);
      return g;
    },
  };
}

async function cues(t) {
  const { vite } = await loadAudioManager(t, {
    cachePrefix: "openwhispr-cues-",
    settingsKey: "__cueSettings",
    settings: { audioCuesEnabled: true },
  });
  return vite.ssrLoadModule("/utils/dictationCues.js");
}

test("soft start is E5 then B5, each with a 2nd harmonic", async (t) => {
  const { scheduleCue } = await cues(t);
  const ctx = fakeContext();
  assert.equal(scheduleCue(ctx, "soft", "start", "medium"), 4);
  const fundamentals = ctx.oscillators.filter((_, i) => i % 2 === 0).map((o) => o.freq[0][1]);
  assert.deepEqual(fundamentals, [659.25, 987.77]);
  assert.equal(ctx.oscillators[1].freq[0][1], 659.25 * 2);
});

test("soft cues peak at 0.12 or below; classic keeps today's 0.2", async (t) => {
  const { CUE_SETS } = await cues(t);
  for (const notes of Object.values(CUE_SETS.soft)) {
    for (const note of notes ?? []) assert.ok((note.gain ?? 0.12) <= 0.12);
  }
  assert.deepEqual(CUE_SETS.classic.start.map((n) => n.freq), [523.25, 659.25]);
  assert.equal(CUE_SETS.classic.success, null);
});

test("cancel glides A4 down to F4", async (t) => {
  const { scheduleCue } = await cues(t);
  const ctx = fakeContext();
  scheduleCue(ctx, "soft", "cancel", "medium");
  assert.deepEqual(ctx.oscillators[0].freq.find(([kind]) => kind === "exp").slice(0, 2), ["exp", 349.23]);
});

test("the full family exists: start, stop, success, cancel, error, mic back", async (t) => {
  const { CUE_SETS } = await cues(t);
  assert.deepEqual(Object.keys(CUE_SETS.soft).sort(), ["back", "cancel", "error", "start", "stop", "success"]);
  assert.deepEqual(CUE_SETS.soft.error.map((n) => n.freq), [293.66, 220]);
});

test("low volume halves the envelope peak", async (t) => {
  const { scheduleCue } = await cues(t);
  const peak = (volume) => {
    const ctx = fakeContext();
    const gains = [];
    const make = ctx.createGain.bind(ctx);
    ctx.createGain = () => {
      const g = make();
      gains.push(g);
      return g;
    };
    scheduleCue(ctx, "soft", "back", volume);
    return gains[0].log.find(([kind]) => kind === "lin")[1];
  };
  assert.ok(Math.abs(peak("low") - peak("medium") / 2) < 1e-9);
});
```

Create `test/helpers/useAudioRecordingCues.test.js`. It reuses the Task 9 harness pattern, with cues mocked into a log:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

test("the start cue fires at press, before the mic opens", async (t) => {
  let root = null;
  t.after(async () => root && (await React.act(async () => root.unmount())));
  globalThis.__cueLog = [];
  const noop = () => () => {};
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noop, onToggleVoiceAgent: noop, onToggleTranslation: noop, onStartDictation: noop,
        onPrepareDictation: noop, onCancelDictationPreparation: noop, onStopDictation: noop,
        dictationLifecycleStateChanged: () => {}, registerCancelHotkey: () => {}, captureDictationTarget: async () => ({}),
      },
    },
  });
  const container = installHookDom(t);
  globalThis.requestAnimationFrame = (cb) => (cb(), 1);
  const cueModule = ["start", "stop", "success", "cancel", "error", "micBack"]
    .map((n) => `export const play${n[0].toUpperCase()}${n.slice(1)}Cue = () => globalThis.__cueLog.push("cue:${n}");`)
    .join("\n");
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-cues-hook-",
    mockModules: {
      "/utils/dictationCues": cueModule,
      "/helpers/audioManager": `export default class { constructor(){ this.sttConfig={success:true}; }
        getState(){ return { isRecording: this.r === true }; } setCallbacks(cb){ this.cb = cb; }
        setVoiceAgentRequested(){} setAssistantSelectionContext(){} setTranslationRequested(){}
        shouldUseStreaming(){ return false; } prepareMicCapture(){} cancelPreparedMicCapture(){} cleanup(){}
        async startRecording(){ globalThis.__cueLog.push("mic"); this.r = true; return true; } }`,
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  let api;
  function Harness() {
    api = useAudioRecording({ onDemoEvent: () => {} });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  await React.act(async () => {
    await api.startRecording();
  });
  assert.deepEqual(globalThis.__cueLog.slice(0, 2), ["cue:start", "mic"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/dictationCues.test.js test/helpers/useAudioRecordingCues.test.js`
Expected: FAIL. `scheduleCue` is not exported, and the log is `["mic", "cue:start"]`.

- [ ] **Step 3: Rewrite `src/utils/dictationCues.js`**

```js
import logger from "./logger";
import { getSettings } from "../stores/settingsStore";

// VO-R10 A "Soft family": sine + 2nd harmonic (-14 dB), 4 ms attack,
// exponential decay with a 40 ms tail, base gain 0.12. "Classic" keeps the
// two cues Loqui shipped before (gain 0.2), so nobody's ear is retrained by
// surprise. Notes: { freq, at (ms), dur (ms), glideTo?, gain? }.
const n = (freq, at, dur, extra = {}) => Object.freeze({ freq, at, dur, ...extra });

export const CUE_SETS = Object.freeze({
  soft: Object.freeze({
    start: [n(659.25, 0, 60), n(987.77, 80, 90)],
    stop: [n(987.77, 0, 60), n(659.25, 70, 110)],
    success: [n(783.99, 0, 120), n(1046.5, 0, 120)],
    cancel: [n(440, 0, 140, { glideTo: 349.23, gain: 0.08 })],
    error: [n(293.66, 0, 110, { gain: 0.1 }), n(220, 120, 160, { gain: 0.1 })],
    back: [n(659.25, 0, 80)],
  }),
  classic: Object.freeze({
    start: [n(523.25, 0, 90, { gain: 0.2 }), n(659.25, 115, 90, { gain: 0.2 })],
    stop: [n(587.33, 0, 90, { gain: 0.2 }), n(440, 115, 90, { gain: 0.2 })],
    success: null,
    cancel: null,
    error: null,
    back: null,
  }),
});

export const CUE_VOLUME = Object.freeze({ low: 0.5, medium: 1, high: 1.4 });

const SOFT_GAIN = 0.12;
const HARMONIC_WEIGHT = 0.2; // -14 dB
const MIN_GAIN = 0.0001;

let audioContext = null;

const getAudioContext = () => {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext || audioContext.state === "closed") audioContext = new Ctor();
  return audioContext;
};

const resumeContextIfNeeded = async () => {
  try {
    const context = getAudioContext();
    if (!context) return null;
    if (context.state === "suspended") await context.resume();
    return context.state === "running" ? context : null;
  } catch (error) {
    logger.debug("Failed to initialize dictation cue audio context", { error: String(error?.message ?? error) }, "audio");
    return null;
  }
};

function scheduleTone(context, { freq, dur, glideTo, gain }, startTime, volume, setName) {
  const soft = setName === "soft";
  const peak = (gain ?? (soft ? SOFT_GAIN : 0.2)) * volume;
  const attack = soft ? 0.004 : 0.015;
  const end = startTime + dur / 1000;
  const partials = soft ? [[1, 1], [2, HARMONIC_WEIGHT]] : [[1, 1]];
  for (const [mult, weight] of partials) {
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * mult, startTime);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo * mult, end);
    env.gain.setValueAtTime(MIN_GAIN, startTime);
    env.gain.linearRampToValueAtTime(peak * weight, startTime + attack);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, end + (soft ? 0.04 : 0));
    osc.connect(env);
    env.connect(context.destination);
    osc.start(startTime);
    osc.stop(end + 0.06);
  }
  return partials.length;
}

export function scheduleCue(context, setName, cue, volumeName) {
  const notes = CUE_SETS[setName]?.[cue];
  if (!notes) return 0;
  const volume = CUE_VOLUME[volumeName] ?? 1;
  const base = context.currentTime + 0.02;
  return notes.reduce((count, note) => count + scheduleTone(context, note, base + note.at / 1000, volume, setName), 0);
}

const playCue = async (cue) => {
  try {
    const settings = getSettings();
    if (!settings.audioCuesEnabled) return;
    const context = await resumeContextIfNeeded();
    if (!context) return;
    scheduleCue(context, settings.dictationCueSet === "classic" ? "classic" : "soft", cue, settings.dictationCueVolume ?? "medium");
  } catch (error) {
    logger.debug("Failed to play dictation cue", { error: String(error?.message ?? error) }, "audio");
  }
};

export const playStartCue = () => playCue("start");
export const playStopCue = () => playCue("stop");
export const playSuccessCue = () => playCue("success");
export const playCancelCue = () => playCue("cancel");
export const playErrorCue = () => playCue("error");
export const playMicBackCue = () => playCue("back");
```

- [ ] **Step 4: Settings and wiring**

1. **`settingsStore.ts`.** Add both settings the way `activationMode` is declared: a typed member, `readString` with a guard, a setter that writes `localStorage` and `setState`, and the new `STRING_SETTINGS` sync entry described in Files above.

   ```ts
     dictationCueSet: (readString("dictationCueSet", "soft") === "classic" ? "classic" : "soft") as "soft" | "classic",
     dictationCueVolume: (["low", "medium", "high"].includes(readString("dictationCueVolume", "medium"))
       ? readString("dictationCueVolume", "medium")
       : "medium") as "low" | "medium" | "high",
   ```

2. **`useSettings.ts`.** Pass both values and their setters through, next to `audioCuesEnabled` (lines 367–368).
3. **`SettingsPage.tsx`, Sound Effects section (lines 1689–1705).** Under the existing "Dictation sounds" toggle, add two `SettingsRow`s: "Sound style" (Soft / Classic) and "Volume" (Low / Medium / High). Use the same enumerated-choice control the page already uses for other options (`grep -n "<Select\|SegmentedControl\|RadioGroup" src/components/SettingsPage.tsx | head -5`). Disable both when `!audioCuesEnabled`.
4. **`useAudioRecording.js`:**
   - Move `void playStartCue();` from line 215 to directly after `setIsPreparing(true)` in `performStartRecording` (around line 130), so the cue sounds at press time. Delete the old call at 215. If the start then fails, the error cue follows the start cue. That is intended: the press was heard, and then it failed.
   - Paste success: next to `setOutcome({ kind: "pasted", … })` (Task 9), add `void playSuccessCue();`.
   - Cancel: in `cancelRecording` and `cancelProcessing` (lines 812–838), add `void playCancelCue();` when the manager reports it cancelled something (the return value is truthy).
   - Error: as the first line of `showDictationError`, add `void playErrorCue();`.
   - Mic back: next to the mic-restored notice (line 370), add `void playMicBackCue();`.

Locale keys under `settingsPage.general.soundEffects`:

```json
"cueSet": "Sound style", "cueSetSoft": "Soft", "cueSetClassic": "Classic",
"cueVolume": "Volume", "cueVolumeLow": "Low", "cueVolumeMedium": "Medium", "cueVolumeHigh": "High"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/dictationCues.test.js test/helpers/useAudioRecordingCues.test.js "test/helpers/useAudioRecording*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/dictationCues.js src/stores/settingsStore.ts src/hooks/useSettings.ts src/components/SettingsPage.tsx src/hooks/useAudioRecording.js src/locales test/helpers/dictationCues.test.js test/helpers/useAudioRecordingCues.test.js
git commit -m "feat(voice): soft sound family for start, stop, success, cancel, error and mic back"
```

---
### Task 16: Meeting presence, meeting outcome, the tray state and the Linux Stop notification (D2)

Closes review findings I8 and I14 for the main-process side.

Meeting capture runs in the control-panel renderer. That renderer reports two separate things:
- **presence**, which is liveness only: is a meeting recording right now, since when, and is a source lost;
- an explicit **outcome**, sent after the stop has actually finished: saved, failed to save, or failed to stop.

Main relays both to the pill window and the tray. It turns owner loss (crash, reload, close) into a `failed` outcome with reason `ownerLost`, and never into "saved".

On Linux, main posts a persistent notification with a Stop button through the freedesktop notification service. It uses the D-Bus library the app already ships (`@homebridge/dbus-native`, `package.json:129`, used lazily by `kdeShortcut.js`, `gnomeShortcut.js` and others), not a host CLI. The notification's lifetime is serialised by generation:
- a notification posted after its session ended is closed as soon as its id arrives;
- signals are subscribed before posting;
- `NotificationClosed`, service loss and app teardown are all handled;
- Stop is bound to the meeting session it was posted for.

Where the service is missing or does not support actions, the tray menu's "Stop meeting recording" item is the Stop control. A never-expiring notification without a button tells the user so (see Open question 5).

**Files:**
- Create: `src/helpers/meetingPresence.js` (main, CommonJS)
- Create: `src/helpers/linuxRecordingNotification.js` (main)
- Create: `src/helpers/freedesktopNotifications.js` (main; the thin `@homebridge/dbus-native` adapter)
- Create: `src/helpers/trayRecordingIcon.js` (main)
- Modify: `src/stores/meetingRecordingStore.ts`:
  - `stopRecording` (1503–1615) learns whether persistence and the main stop succeeded, and reports an outcome;
  - `StopRecordingResult` (1495–1501) gains `persisted` and `stopError`.
- Modify: `src/helpers/ipcHandlers.js`. Add `meeting-recording-presence`, `meeting-recording-outcome`, `get-meeting-recording-presence` and `request-stop-meeting-recording`.
- Modify: `src/helpers/windowManager.js`. Own the presence, relay to `mainWindow`, and add `requestStopMeetingRecording(sessionId)`.
- Modify: `src/helpers/tray.js`. Add `setMeetingPresence`, the recording items at the top of `buildContextMenuTemplate()` (254), the tooltip, and the Linux icon and notification.
- Modify: `main.js:883-889`. Wire presence and outcome to the tray. On `before-quit`, close the notification.
- Modify: `preload.js`, `src/types/electron.ts`, `src/preview/browserPreview.ts`
- Modify: `src/components/MeetingRecordingMount.tsx`. Report presence; stop on request, bound to the session.
- Test: `test/helpers/meetingPresence.test.js`
- Test: `test/helpers/linuxRecordingNotification.test.js`
- Test: `test/helpers/meetingStopOutcome.test.js`

**Interfaces:**
- Consumes `MeetingPresence` and `MeetingOutcome` (`src/types/dictation.ts`, Task 7).
- Produces:

  ```js
  // src/helpers/meetingPresence.js
  normalizePresence(input): MeetingPresence | null;  // { sessionId, startedAt, interruption, quiet }
  createMeetingPresence({ onChange, onOwnerLost }): { set(ownerId, input): void; clearIfOwner(ownerId): void; get(): MeetingPresence | null };
  buildTrayRecordingItems(presence, { t, now }): Array<{ label: string; enabled?: boolean; action?: "stop" }>;
  ```

  ```js
  // src/helpers/linuxRecordingNotification.js
  class LinuxRecordingNotification {
    constructor({ client, ElectronNotification, onStop: (sessionId) => void, onOpen: () => void });
    show({ sessionId, title, body, stopLabel, fallbackBody }): Promise<void>;  // serialised; replaces any earlier one
    close(): Promise<void>;                                                     // idempotent; also closes a late id
  }
  // src/helpers/freedesktopNotifications.js
  createFreedesktopClient({ getDBus? }): Promise<{
    capabilities(): Promise<string[]>; notify(o): Promise<number>; close(id): Promise<void>;
    onAction(cb: (id: number, key: string) => void): void; onClosed(cb: (id: number) => void): void;
    onDisconnect(cb: () => void): void;
  } | null>;  // null when D-Bus or the service is unavailable
  ```

  ```ts
  // electronAPI
  reportMeetingRecordingPresence?: (p: { recording: boolean; sessionId?: string; startedAt?: number; interruption?: "systemAudio" | "mic" | null; quiet?: boolean }) => void;
  reportMeetingRecordingOutcome?: (o: MeetingOutcome) => void;
  getMeetingRecordingPresence?: () => Promise<MeetingPresence | null>;
  onMeetingRecordingPresenceChanged?: (cb: (p: MeetingPresence | null) => void) => () => void;
  onMeetingRecordingOutcome?: (cb: (o: MeetingOutcome) => void) => () => void;
  requestStopMeetingRecording?: (sessionId: string) => Promise<void>;
  onMeetingRecordingStopRequested?: (cb: (sessionId: string) => void) => () => void;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/meetingPresence.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();
const { normalizePresence, createMeetingPresence, buildTrayRecordingItems } = require("../../src/helpers/meetingPresence.js");

test("presence is liveness only, keyed by session, and rejects junk", () => {
  assert.equal(normalizePresence(null), null);
  assert.equal(normalizePresence({ recording: false, sessionId: "m1", startedAt: 5 }), null);
  assert.equal(normalizePresence({ recording: true, startedAt: 5 }), null, "no session id");
  assert.equal(normalizePresence({ recording: true, sessionId: "m1", startedAt: "x" }), null);
  assert.deepEqual(normalizePresence({ recording: true, sessionId: "m1", startedAt: 1000, interruption: "nope", quiet: 1 }), {
    sessionId: "m1", startedAt: 1000, interruption: null, quiet: true,
  });
});

test("changes are emitted once per real change", () => {
  const seen = [];
  const presence = createMeetingPresence({ onChange: (p) => seen.push(p) });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000, quiet: true });
  presence.set(7, { recording: false });
  assert.equal(seen.length, 3);
  assert.equal(seen.at(-1), null);
});

test("presence clears when the owner goes away, and that is reported as ownerLost, never saved", () => {
  const lost = [];
  const presence = createMeetingPresence({ onChange: () => {}, onOwnerLost: (sessionId) => lost.push(sessionId) });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.clearIfOwner(8);
  assert.notEqual(presence.get(), null);
  presence.clearIfOwner(7);
  assert.equal(presence.get(), null);
  assert.deepEqual(lost, ["m1"]);
  presence.clearIfOwner(7);
  assert.deepEqual(lost, ["m1"], "exactly once");
});

test("a normal stop clears presence without an ownerLost report", () => {
  const lost = [];
  const presence = createMeetingPresence({ onChange: () => {}, onOwnerLost: (id) => lost.push(id) });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.set(7, { recording: false });
  presence.clearIfOwner(7);
  assert.deepEqual(lost, []);
});

test("the tray leads with a recording line and a Stop item while recording", () => {
  const t = (key, opts) => (opts ? `${key}:${opts.elapsed}` : key);
  assert.deepEqual(buildTrayRecordingItems(null, { t, now: 0 }), []);
  assert.deepEqual(buildTrayRecordingItems({ sessionId: "m1", startedAt: 0, interruption: null, quiet: false }, { t, now: 761_000 }), [
    { label: "tray.meetingRecording:12:41", enabled: false },
    { label: "tray.stopMeetingRecording", action: "stop" },
  ]);
});

test("the recording dot lands in the bottom-right corner in Signal orange", () => {
  const { paintRecordingDot } = require("../../src/helpers/trayRecordingIcon.js");
  const out = paintRecordingDot(Buffer.alloc(16 * 16 * 4), 16, 16);
  const px = (x, y) => [...out.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  assert.deepEqual(px(12, 12), [0x1f, 0x5a, 0xff, 0xff]);
  assert.deepEqual(px(1, 1), [0, 0, 0, 0]);
});
```

Create `test/helpers/linuxRecordingNotification.test.js`. The fake client stands in for the D-Bus service, so these tests run anywhere and never touch the host:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { deferred } = require("./harness/deferred");
const { LinuxRecordingNotification } = require("../../src/helpers/linuxRecordingNotification.js");

function fakeClient({ caps = ["actions", "body"] } = {}) {
  const bus = new EventEmitter();
  const calls = [];
  const pendingNotify = [];
  let nextId = 41;
  return {
    calls,
    bus,
    pendingNotify,
    capabilities: async () => caps,
    notify: (o) => {
      calls.push(["notify", o.actions]);
      const d = deferred();
      pendingNotify.push(() => d.resolve(++nextId));
      return d.promise;
    },
    close: async (id) => calls.push(["close", id]),
    onAction: (cb) => bus.on("action", cb),
    onClosed: (cb) => bus.on("closed", cb),
    onDisconnect: (cb) => bus.on("disconnect", cb),
  };
}

class FakeElectronNotification extends EventEmitter {
  static shown = [];
  constructor(opts) {
    super();
    this.opts = opts;
    FakeElectronNotification.shown.push(this);
  }
  show() {}
  close() {
    this.closed = true;
  }
}

const tick = () => new Promise((r) => setImmediate(r));
const until = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i += 1) await tick();
  assert.ok(cond(), "condition reached");
};
const opts = { title: "Loqui is recording", body: "b", stopLabel: "Stop", fallbackBody: "Stop it from the tray menu." };

test("stop pressed in the notification stops that meeting session", async () => {
  const client = fakeClient();
  const stops = [];
  const n = new LinuxRecordingNotification({ client, ElectronNotification: FakeElectronNotification, onStop: (id) => stops.push(id), onOpen() {} });
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()();
  await shown;
  assert.deepEqual(client.calls[0], ["notify", ["default", "", "stop", "Stop"]]);
  client.bus.emit("action", 99, "stop"); // someone else's notification
  client.bus.emit("action", 42, "stop");
  assert.deepEqual(stops, ["m1"]);
});

test("close() while Notify is pending closes the late id when it arrives (I8)", async () => {
  const client = fakeClient();
  const n = new LinuxRecordingNotification({ client, ElectronNotification: FakeElectronNotification, onStop() {}, onOpen() {} });
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  const closing = n.close(); // the meeting stopped before the service answered
  client.pendingNotify.shift()(); // id 42 arrives late
  await Promise.all([shown, closing]);
  assert.deepEqual(client.calls.filter(([c]) => c === "close"), [["close", 42]]);
  client.bus.emit("action", 42, "stop");
});

test("a new meeting replaces the old notification; the old one's late id is closed", async () => {
  const client = fakeClient();
  const stops = [];
  const n = new LinuxRecordingNotification({ client, ElectronNotification: FakeElectronNotification, onStop: (id) => stops.push(id), onOpen() {} });
  const first = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  const second = n.show({ ...opts, sessionId: "m2" });
  client.pendingNotify.shift()(); // 42 for m1, now obsolete
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()(); // 43 for m2
  await Promise.all([first, second]);
  assert.deepEqual(client.calls.filter(([c]) => c === "close"), [["close", 42]]);
  client.bus.emit("action", 43, "stop");
  assert.deepEqual(stops, ["m2"]);
});

test("a notification the user dismissed is forgotten; service loss falls back next time", async () => {
  const client = fakeClient();
  const n = new LinuxRecordingNotification({ client, ElectronNotification: FakeElectronNotification, onStop() {}, onOpen() {} });
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()();
  await shown;
  client.bus.emit("closed", 42);
  await n.close();
  assert.equal(client.calls.some(([c, id]) => c === "close" && id === 42), false, "nothing left to close");
  client.bus.emit("disconnect");
  FakeElectronNotification.shown.length = 0;
  await n.show({ ...opts, sessionId: "m2" });
  assert.equal(FakeElectronNotification.shown.length, 1, "fell back after the service went away");
});

test("no service, or no action support: a never-expiring notification that says where Stop is", async () => {
  FakeElectronNotification.shown.length = 0;
  let opened = 0;
  const none = new LinuxRecordingNotification({ client: null, ElectronNotification: FakeElectronNotification, onStop() {}, onOpen: () => opened++ });
  await none.show({ ...opts, sessionId: "m1" });
  const [fallback] = FakeElectronNotification.shown;
  assert.equal(fallback.opts.timeoutType, "never");
  assert.equal(fallback.opts.body, "Stop it from the tray menu.");
  fallback.emit("click");
  assert.equal(opened, 1);
  await none.close();
  assert.equal(fallback.closed, true);

  const noActions = fakeClient({ caps: ["body"] });
  const n = new LinuxRecordingNotification({ client: noActions, ElectronNotification: FakeElectronNotification, onStop() {}, onOpen() {} });
  await n.show({ ...opts, sessionId: "m2" });
  assert.equal(noActions.calls.length, 0, "never posts a Stop the server cannot show");
});
```

Create `test/helpers/meetingStopOutcome.test.js`. It drives the real `stopRecording` through the renderer harness:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function load(t, electronAPI) {
  const outcomes = [];
  installBrowserGlobals(t, { window: { electronAPI: { ...electronAPI, reportMeetingRecordingOutcome: (o) => outcomes.push(o) } } });
  const vite = await createRendererServer(t, { cachePrefix: "openwhispr-meeting-outcome-" });
  const store = await vite.ssrLoadModule("/stores/meetingRecordingStore.ts");
  return { store, outcomes };
}

test("a saved meeting reports saved only after the transcript write succeeded", async (t) => {
  const { store, outcomes } = await load(t, {
    updateNote: async () => ({ success: true }),
    meetingTranscriptionStop: async () => ({ success: true }),
  });
  store.__primeRecordingForTests({ sessionId: "m1", noteId: "n1", startedAt: Date.now() - 1000, segments: [{ text: "hi" }] });
  const result = await store.stopRecording("m1");
  assert.equal(result.persisted, true);
  assert.equal(outcomes.at(-1).kind, "saved");
  assert.equal(outcomes.at(-1).sessionId, "m1");
});

test("a failed transcript write is a failed outcome, never 'saved' (I14)", async (t) => {
  const { store, outcomes } = await load(t, {
    updateNote: async () => {
      throw new Error("disk full");
    },
    meetingTranscriptionStop: async () => ({ success: true }),
  });
  store.__primeRecordingForTests({ sessionId: "m1", noteId: "n1", startedAt: Date.now(), segments: [{ text: "hi" }] });
  const result = await store.stopRecording("m1");
  assert.equal(result.persisted, false);
  assert.deepEqual(outcomes.at(-1), { sessionId: "m1", kind: "failed", reason: "save" });
});

test("an empty meeting (no segments, no fallback transcript) is saved, not 'save failed'", async (t) => {
  let writes = 0;
  const { store, outcomes } = await load(t, {
    updateNote: async () => (writes++, { success: true }),
    meetingTranscriptionStop: async () => ({ success: true }),
  });
  store.__primeRecordingForTests({ sessionId: "m1", noteId: "n1", startedAt: Date.now(), segments: [] });
  const result = await store.stopRecording("m1");
  assert.equal(writes, 0, "nothing to write");
  assert.equal(result.persisted, true);
  assert.equal(outcomes.at(-1).kind, "saved");
});

test("a stop for another session is ignored, and duplicate stops report once", async (t) => {
  const { store, outcomes } = await load(t, { updateNote: async () => ({}), meetingTranscriptionStop: async () => ({ success: true }) });
  store.__primeRecordingForTests({ sessionId: "m1", noteId: "n1", startedAt: Date.now(), segments: [] });
  assert.equal((await store.stopRecording("m-other")).stopped, false);
  await Promise.all([store.stopRecording("m1"), store.stopRecording("m1")]);
  assert.equal(outcomes.length, 1);
});
```

`__primeRecordingForTests` is a test seam you add to `meetingRecordingStore.ts`. It sets the module flags (`activeRecordingSessionId`, `isRecordingFlag`) and the store fields `stopRecording` reads (`recordingNoteId`, `segments`, `recordingStartedAt`, `isRecording`), without starting capture. If `stopRecording` calls the cleanup closure set by `startRecording`, have the seam set it to a no-op. Mock `"/utils/logger"` in `createRendererServer` if the store's logger import needs it, the way `test/helpers/harness/audioManager.js` does.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/meetingPresence.test.js test/helpers/linuxRecordingNotification.test.js test/helpers/meetingStopOutcome.test.js`
Expected: FAIL with `Cannot find module '…/meetingPresence.js'`.

- [ ] **Step 3: Presence and the tray icon**

`src/helpers/meetingPresence.js`:

```js
// D2: the pill window is the ambient meeting recorder. Presence is liveness
// only; whether a meeting was saved is a separate, explicit outcome
// (meeting-recording-outcome). Owner loss is reported as a failure.
const INTERRUPTIONS = new Set(["systemAudio", "mic"]);

function normalizePresence(input) {
  if (!input || input.recording === false) return null;
  const startedAt = Number(input.startedAt);
  const sessionId = typeof input.sessionId === "string" && input.sessionId.length <= 128 ? input.sessionId : null;
  if (!sessionId || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  return {
    sessionId,
    startedAt,
    interruption: INTERRUPTIONS.has(input.interruption) ? input.interruption : null,
    quiet: Boolean(input.quiet),
  };
}

const same = (a, b) =>
  a === b ||
  (a && b && a.sessionId === b.sessionId && a.startedAt === b.startedAt && a.interruption === b.interruption && a.quiet === b.quiet);

function createMeetingPresence({ onChange, onOwnerLost } = {}) {
  let state = null;
  let ownerId = null;
  const commit = (next, owner) => {
    ownerId = next ? owner : null;
    if (same(state, next)) return;
    state = next;
    onChange?.(state);
  };
  return {
    set(owner, input) {
      commit(normalizePresence(input), owner);
    },
    clearIfOwner(owner) {
      if (ownerId === null || ownerId !== owner || !state) return;
      const lost = state.sessionId;
      commit(null, null);
      onOwnerLost?.(lost);
    },
    get: () => state,
  };
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function buildTrayRecordingItems(presence, { t, now = Date.now() }) {
  if (!presence) return [];
  const first =
    presence.interruption === "systemAudio"
      ? t("tray.meetingRecordingSystemLost")
      : presence.interruption === "mic"
        ? t("tray.meetingRecordingMicLost")
        : t("tray.meetingRecording", { elapsed: formatElapsed(now - presence.startedAt) });
  return [
    { label: first, enabled: false },
    { label: t("tray.stopMeetingRecording"), action: "stop" },
  ];
}

module.exports = { normalizePresence, createMeetingPresence, buildTrayRecordingItems, formatElapsed };
```

`src/helpers/trayRecordingIcon.js`:

```js
const { nativeImage } = require("electron");

// Paint a filled circle into a BGRA bitmap (Electron's toBitmap() order).
function paintRecordingDot(bitmap, width, height) {
  const out = Buffer.from(bitmap);
  const r = Math.max(2, Math.round(Math.min(width, height) * 0.3));
  const cx = width - r - 1;
  const cy = height - r - 1;
  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r || x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      out[i] = 0x1f;
      out[i + 1] = 0x5a;
      out[i + 2] = 0xff;
      out[i + 3] = 0xff;
    }
  }
  return out;
}

function createRecordingTrayIcon(baseIcon) {
  const { width, height } = baseIcon.getSize();
  return nativeImage.createFromBitmap(paintRecordingDot(baseIcon.toBitmap(), width, height), { width, height });
}

module.exports = { paintRecordingDot, createRecordingTrayIcon };
```

- [ ] **Step 4: The notification and its D-Bus adapter**

`src/helpers/linuxRecordingNotification.js`:

```js
// The resident "recording" notification on Linux, with a Stop action. One
// lifetime at a time, serialised by generation: a Notify answer that arrives
// after its session ended is closed immediately, and signals are subscribed
// before anything is posted.
class LinuxRecordingNotification {
  constructor({ client, ElectronNotification, onStop, onOpen }) {
    this.client = client;
    this.ElectronNotification = ElectronNotification;
    this.onStop = onStop;
    this.onOpen = onOpen;
    this.generation = 0;
    this.current = null; // { id, sessionId, generation }
    this.fallback = null;
    this.queue = Promise.resolve();
    this.serviceAlive = Boolean(client);
    if (client) {
      client.onAction((id, key) => {
        if (!this.current || id !== this.current.id) return;
        if (key === "stop") this.onStop?.(this.current.sessionId);
        else if (key === "default") this.onOpen?.();
      });
      client.onClosed((id) => {
        if (this.current?.id === id) this.current = null; // dismissed by the user; the tray Stop remains
      });
      client.onDisconnect(() => {
        this.serviceAlive = false;
        this.current = null;
      });
    }
  }

  _enqueue(job) {
    this.queue = this.queue.then(job, job);
    return this.queue;
  }

  show({ sessionId, title, body, stopLabel, fallbackBody }) {
    const generation = ++this.generation;
    return this._enqueue(async () => {
      await this._closeNow();
      if (generation !== this.generation) return;
      const caps = this.serviceAlive ? await this.client.capabilities().catch(() => []) : [];
      if (!caps.includes("actions")) {
        this.fallback = new this.ElectronNotification({ title, body: fallbackBody, timeoutType: "never", silent: true });
        this.fallback.on("click", () => this.onOpen?.());
        this.fallback.show();
        return;
      }
      let id;
      try {
        id = await this.client.notify({
          title, body, actions: ["default", "", "stop", stopLabel],
          hints: { resident: true, urgency: 1, category: "device" },
        });
      } catch {
        return;
      }
      if (generation !== this.generation) {
        await this.client.close(id).catch(() => {}); // obsolete before it was posted
        return;
      }
      this.current = { id, sessionId, generation };
    });
  }

  close() {
    ++this.generation;
    return this._enqueue(() => this._closeNow());
  }

  async _closeNow() {
    const current = this.current;
    this.current = null;
    if (current && this.serviceAlive) await this.client.close(current.id).catch(() => {});
    if (this.fallback) {
      this.fallback.close();
      this.fallback = null;
    }
  }
}

module.exports = { LinuxRecordingNotification };
```

`close()` bumps the generation before queueing, so an in-flight `show()` sees the mismatch when its Notify answer arrives, and closes the late id. That is the probe the review reproduced.

`src/helpers/freedesktopNotifications.js`. This is the thin adapter over the bundled D-Bus library. It is lazy, like `kdeShortcut.js:8`:

```js
const debugLogger = require("./debugLogger");

let dbusModule;
function getDBus() {
  if (dbusModule !== undefined) return dbusModule;
  try {
    dbusModule = require("@homebridge/dbus-native");
  } catch {
    dbusModule = null;
  }
  return dbusModule;
}

const PATH = "/org/freedesktop/Notifications";
const NAME = "org.freedesktop.Notifications";

async function createFreedesktopClient({ getDBus: loadDBus = getDBus } = {}) {
  const dbus = loadDBus();
  if (!dbus) return null;
  let bus;
  try {
    bus = dbus.sessionBus();
  } catch {
    return null;
  }
  const iface = await new Promise((resolve) =>
    bus.getService(NAME).getInterface(PATH, NAME, (err, value) => resolve(err ? null : value))
  );
  if (!iface) return null;
  const call = (method, ...args) =>
    new Promise((resolve, reject) => iface[method](...args, (err, value) => (err ? reject(err) : resolve(value))));
  const hint = (key, value) => [key, typeof value === "boolean" ? ["b", value] : typeof value === "number" ? ["y", value] : ["s", value]];
  return {
    capabilities: () => call("GetCapabilities"),
    notify: ({ title, body, actions, hints }) =>
      call("Notify", "Loqui", 0, "media-record", title, body, actions, Object.entries(hints).map(([k, v]) => hint(k, v)), 0),
    close: (id) => call("CloseNotification", id),
    onAction: (cb) => iface.on("ActionInvoked", (id, key) => cb(Number(id), String(key))),
    onClosed: (cb) => iface.on("NotificationClosed", (id) => cb(Number(id))),
    onDisconnect: (cb) => {
      bus.connection?.on?.("end", cb);
      bus.connection?.on?.("error", (error) => {
        debugLogger.debug("Notification bus error", { error: error?.message }, "meeting");
        cb();
      });
    },
  };
}

module.exports = { createFreedesktopClient };
```

The hint encoding (`[key, [signature, value]]`) and the signal subscription (`iface.on`) follow the forms the existing D-Bus users in this repo already use. Before relying on them, check `src/helpers/gnomeShortcut.js:211-219` and `kdeShortcut.js` for the exact call shapes, and match them. The adapter is not unit-tested, because it needs a session bus. Task 20's Linux matrix exercises it on a real desktop.

- [ ] **Step 5: The meeting outcome in the store**

In `src/stores/meetingRecordingStore.ts`:
1. Extend `StopRecordingResult` (1495–1501) with `persisted: boolean; stopError: boolean;`. Early-return paths report `persisted: false, stopError: false`.
2. Inside `runStop`:
   - Before line 1545, capture `const startedAt = useMeetingRecordingStore.getState().recordingStartedAt;`.
   - Make `persistTranscript` record whether it tried and whether it worked: `let attempted = false; let saveOk = false;`. Set `attempted = true` on entry to the write, `saveOk = true` on success, and leave the `catch` logging as it is. After `persistFinalTranscriptAroundStop` returns, `const persisted = !attempted || saveOk;`. A segment-less recording with no fallback transcript never calls `persist`, so it reports `persisted = true` rather than a false "save failed": there was nothing to save. A recording with no note (`recordingNoteId == null`) takes the same path.
   - In `stop()`, set `stopError = true` in both the `result?.error` branch and the `catch`.
   - After `persistFinalTranscriptAroundStop` returns, report the outcome:

     ```ts
         const outcome: MeetingOutcome = persisted && !stopError
           ? { sessionId, kind: "saved", durationMs: startedAt ? Date.now() - startedAt : 0, noteId: recordingNoteId ?? null }
           : { sessionId, kind: "failed", reason: persisted ? "stop" : "save" };
         window.electronAPI?.reportMeetingRecordingOutcome?.(outcome);
     ```

   - Return `{ diarizationSessionId, stopped: true, persisted, stopError }`.

   `meetingRecordingStopBarrier.runStop` already dedupes concurrent stops (1525–1533), so the outcome is reported once.
3. Add the `__primeRecordingForTests` seam described in Step 1. Name it with the double underscore so it reads as test-only, and export it.

- [ ] **Step 6: Main relay, tray and preload**

1. **`windowManager.js` constructor:**

   ```js
       this.meetingPresence = createMeetingPresence({
         onChange: (p) => this._onMeetingPresenceChanged(p),
         onOwnerLost: (sessionId) => this._onMeetingOutcome({ sessionId, kind: "failed", reason: "ownerLost" }),
       });
       this.onMeetingPresenceChanged = null;
       this.onMeetingOutcome = null;
   ```

   Add these methods:

   ```js
     getMeetingPresence() {
       return this.meetingPresence.get();
     }

     _onMeetingPresenceChanged(presence) {
       if (this.mainWindow && !this.mainWindow.isDestroyed()) {
         this.mainWindow.webContents.send("meeting-recording-presence-changed", presence);
       }
       this.onMeetingPresenceChanged?.(presence);
     }

     _onMeetingOutcome(outcome) {
       if (this.mainWindow && !this.mainWindow.isDestroyed()) {
         this.mainWindow.webContents.send("meeting-recording-outcome", outcome);
       }
       this.onMeetingOutcome?.(outcome);
     }

     requestStopMeetingRecording(sessionId) {
       if (!sessionId || this.meetingPresence.get()?.sessionId !== sessionId) return; // stale button
       this.sendToControlPanel("meeting-recording-stop-requested", sessionId);
     }
   ```

2. **`ipcHandlers.js`**, next to the `meeting-transcription-*` handlers (≈7700). Only the control panel may report. The owner watch uses the `details` form of `did-start-navigation` (`meetingTranscriptionLifecycle.js:17-28`):

   ```js
       const fromControlPanel = (event) => {
         const panel = this.windowManager.controlPanelWindow;
         return Boolean(panel && !panel.isDestroyed() && event.sender === panel.webContents);
       };
       const watchedMeetingOwners = new WeakSet();
       ipcMain.on("meeting-recording-presence", (event, payload) => {
         if (!fromControlPanel(event)) return;
         const contents = event.sender;
         this.windowManager.meetingPresence.set(contents.id, payload);
         if (watchedMeetingOwners.has(contents)) return;
         watchedMeetingOwners.add(contents);
         const lost = () => this.windowManager.meetingPresence.clearIfOwner(contents.id);
         contents.once("destroyed", lost);
         contents.on("render-process-gone", lost);
         contents.on("did-start-navigation", (details) => {
           if (details.isMainFrame && !details.isSameDocument) lost();
         });
       });
       ipcMain.on("meeting-recording-outcome", (event, outcome) => {
         if (!fromControlPanel(event)) return;
         if (typeof outcome?.sessionId !== "string" || !["saved", "failed"].includes(outcome.kind)) return;
         this.windowManager._onMeetingOutcome(outcome);
       });
       ipcMain.handle("get-meeting-recording-presence", () => this.windowManager.getMeetingPresence());
       ipcMain.handle("request-stop-meeting-recording", (_event, sessionId) => {
         this.windowManager.requestStopMeetingRecording(sessionId);
       });
   ```

3. **`tray.js`.** In the constructor, add `this.meetingPresence = null; this.linuxNotification = null; this.baseIcon = null;`, and store the loaded icon in `createTray()` (141) as `this.baseIcon`.

   ```js
     async _linuxNotification() {
       if (this.linuxNotification) return this.linuxNotification;
       const client = await createFreedesktopClient();
       this.linuxNotification = new LinuxRecordingNotification({
         client,
         ElectronNotification: require("electron").Notification,
         onStop: (sessionId) => this.windowManager?.requestStopMeetingRecording(sessionId),
         onOpen: () => this.showControlPanelFromTray(),
       });
       return this.linuxNotification;
     }

     setMeetingPresence(presence) {
       const previous = this.meetingPresence;
       this.meetingPresence = presence;
       if (process.platform === "linux") {
         if (this.tray && this.baseIcon) {
           this.tray.setImage(presence ? createRecordingTrayIcon(this.baseIcon) : this.baseIcon);
         }
         if (presence && presence.sessionId !== previous?.sessionId) {
           void this._linuxNotification().then((n) =>
             n.show({
               sessionId: presence.sessionId,
               title: i18nMain.t("meetingRecorder.notificationTitle"),
               body: i18nMain.t("meetingRecorder.notificationBody"),
               stopLabel: i18nMain.t("meetingRecorder.stop"),
               fallbackBody: i18nMain.t("meetingRecorder.notificationFallbackBody"),
             })
           );
         } else if (!presence && previous) {
           void this.linuxNotification?.close();
         }
       }
       this.updateTrayMenu();
     }

     teardownMeetingNotification() {
       return this.linuxNotification?.close() ?? Promise.resolve();
     }
   ```

   In `buildContextMenuTemplate()` (254), prepend the recording items, followed by a separator when there are any:

   ```js
       const recording = buildTrayRecordingItems(this.meetingPresence, { t: (k, o) => i18nMain.t(k, o) }).map((item) =>
         item.action === "stop"
           ? { label: item.label, click: () => this.windowManager?.requestStopMeetingRecording(this.meetingPresence?.sessionId) }
           : { label: item.label, enabled: false }
       );
       const lead = recording.length ? [...recording, { type: "separator" }] : [];
   ```

   Return `[...lead, ...<existing items>]`. In `updateTrayMenu()` (312), set the tooltip to `i18nMain.t(this.meetingPresence ? "tray.tooltipRecording" : "tray.tooltip")`.
4. **`main.js`.**
   - Next to `windowManager.onDictationStateChanged` (887), add `windowManager.onMeetingPresenceChanged = (p) => trayManager.setMeetingPresence(p);`.
   - After the tray manager is created, register the notification close with the shutdown registry: `sidecarRegistry.register("meetingNotification", () => trayManager.teardownMeetingNotification());`. Both quit paths already await `sidecarRegistry.shutdownAll()` before `app.exit` (`main.js:475`, `:1478`), and `shutdownAll` awaits each stop under its deadline (`sidecarRegistry.js:11-20`). The D-Bus `CloseNotification` therefore completes before exit, so a resident notification never outlives the app. A fire-and-forget call in `performSyncTeardown` would not be awaited.
5. **`preload.js`.** Add the APIs from the Interfaces block:
   - `reportMeetingRecordingPresence` and `reportMeetingRecordingOutcome` use `ipcRenderer.send`;
   - `getMeetingRecordingPresence` and `requestStopMeetingRecording` use `invoke`;
   - the three `on…` listeners use `registerListener`.

   Add the types to the `electronAPI` interface in `src/types/electron.ts`, importing `MeetingPresence` and `MeetingOutcome` from `./dictation`. Add no-op stubs to `browserPreview.ts`.
6. **`MeetingRecordingMount.tsx`:**

   ```tsx
     const recordingStartedAt = useMeetingRecordingStore((s) => s.recordingStartedAt);
     const micQuiet = useMeetingRecordingStore((s) => s.micQuiet ?? false);
     useEffect(() => {
       window.electronAPI?.reportMeetingRecordingPresence?.({
         recording: isRecording,
         sessionId: getActiveRecordingSessionId() ?? undefined,
         startedAt: recordingStartedAt ?? undefined,
         interruption: systemAudioInterrupted ? "systemAudio" : micCaptureStatus === "unavailable" ? "mic" : null,
         quiet: micQuiet,
       });
     }, [isRecording, recordingStartedAt, systemAudioInterrupted, micCaptureStatus, micQuiet]);

     useEffect(
       () => window.electronAPI?.onMeetingRecordingStopRequested?.((sessionId) => void stopRecording(sessionId)),
       []
     );
   ```

   `stopRecording(expectedSessionId)` already ignores a stop for another session (`canStopMeetingRecordingSession`, store 1526–1531). `micQuiet` arrives in Task 19.

Locale keys (`en`, mirrored to all 12; the main process reads them through `i18nMain`). Merge the `tray` keys into the existing `tray` object (`translation.json:60-68`):

```json
"tray": {
  "tooltipRecording": "Loqui — recording a meeting",
  "meetingRecording": "Recording meeting · {{elapsed}}",
  "meetingRecordingSystemLost": "Recording · system audio lost",
  "meetingRecordingMicLost": "Recording · microphone lost",
  "stopMeetingRecording": "Stop meeting recording"
},
"meetingRecorder": {
  "notificationTitle": "Loqui is recording this meeting",
  "notificationBody": "Stop it here, from the tray, or from the Loqui pill.",
  "notificationFallbackBody": "Stop it from the Loqui tray menu or the Loqui pill.",
  "stop": "Stop"
}
```

The notification makes no claim about where meeting audio goes, because the meeting transcription route can be remote. Locality is disclosed where the route is shown.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- test/helpers/meetingPresence.test.js test/helpers/linuxRecordingNotification.test.js test/helpers/meetingStopOutcome.test.js test/helpers/trayQuickActions.test.js test/helpers/trayActionPolicy.test.js "test/helpers/meeting*.test.js"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/helpers/meetingPresence.js src/helpers/linuxRecordingNotification.js src/helpers/freedesktopNotifications.js src/helpers/trayRecordingIcon.js src/stores/meetingRecordingStore.ts src/helpers/windowManager.js src/helpers/ipcHandlers.js src/helpers/tray.js main.js preload.js src/types/electron.ts src/preview/browserPreview.ts src/components/MeetingRecordingMount.tsx src/locales test
git commit -m "feat(meeting): presence, explicit outcome, tray state and a serialised Linux Stop notification"
```

---

### Task 17: The recorder capsule as a pill state (VO-R12 A per D2)

**Files:**
- Create: `src/hooks/useMeetingRecordingPresence.ts`
- Create: `src/components/dictation/MeetingCapsule.tsx`
- Modify: `src/hooks/useAudioRecording.js`. Return `meetingRecording` (§5.2).
- Modify: `src/components/dictation/VoicePill.tsx`. Treat `meeting` as a labelled state, add a `meetingInterrupted` prop, and use `role="group"`.
- Modify: `src/App.jsx`:
  - feed `resolvePillStage` the real presence and setting (Task 11 left placeholders);
  - auto-hide (lines 403–434);
  - the meeting outcome notices, which come from the explicit outcome event, never from presence disappearing (I14).
- Modify: `src/stores/settingsStore.ts`, `src/hooks/useSettings.ts` and `src/components/SettingsPage.tsx`. Add `showMeetingRecorderOnScreen`, default `true`.
- Modify: `src/styles/dictation-panel.css`
- Modify: `src/locales/*/translation.json`
- Modify: `DESIGN.md` `### Voice Pill`. Add the meeting recorder.
- Test: `test/components/meetingCapsule.test.js`

**Interfaces:**
- Consumes the Task 16 IPC (presence and outcome), `MeetingPresence` and `MeetingOutcome` (Task 7), `VOICE_PILL_FOOTPRINT.meeting` / `.meetingInterrupted` and `resolvePillOwnership` (Task 10).
- Produces:

  ```ts
  export function useMeetingRecordingPresence(): MeetingPresence | null;
  export function MeetingCapsule(props: { presence: MeetingPresence; now: number; onStop: () => void }): JSX.Element;
  export function meetingCapsuleState(presence: MeetingPresence): "recording" | "quiet" | "lost";
  // useAudioRecording return: meetingRecording: MeetingPresence | null
  // VoicePill prop: meetingInterrupted?: boolean
  ```

  The setting is `showMeetingRecorderOnScreen: boolean`, default `true`.

- [ ] **Step 1: Write the failing test**

Create `test/components/meetingCapsule.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");
const load = () => import("../../src/components/dictation/MeetingCapsule.tsx");

test("the capsule shows a dot, mm:ss and a labelled Stop", async () => {
  const { MeetingCapsule } = await load();
  const html = renderStatic(MeetingCapsule, {
    presence: { sessionId: "m1", startedAt: 1_000, interruption: null, quiet: false },
    now: 1_000 + 761_000,
    onStop() {},
  });
  assert.match(html, /data-rs="recording"/);
  assert.match(html, /class="meeting-capsule__dot"/);
  assert.match(html, />12:41</);
  assert.match(html, /<button[^>]*aria-label="[^"]+"/);
});

test("quiet pales the dot; a lost source is labelled and amber", async () => {
  const { meetingCapsuleState, MeetingCapsule } = await load();
  assert.equal(meetingCapsuleState({ startedAt: 1, interruption: null, quiet: true }), "quiet");
  assert.equal(meetingCapsuleState({ startedAt: 1, interruption: "systemAudio", quiet: true }), "lost");
  const lost = renderStatic(MeetingCapsule, { presence: { sessionId: "m1", startedAt: 1, interruption: "systemAudio", quiet: false }, now: 2, onStop() {} });
  assert.match(lost, /data-rs="lost"/);
  assert.match(lost, /meeting-capsule__note/);
});

test("the pill uses the wider footprint while a source is lost and becomes a group", async () => {
  const { VoicePill } = await import("../../src/components/dictation/VoicePill.tsx");
  const { VOICE_PILL_FOOTPRINT } = await import("../../src/helpers/voicePillPresentation.js");
  const html = renderStatic(VoicePill, {
    variant: "floating",
    state: "meeting",
    getAudioLevel: () => 0,
    label: "capsule",
    meetingInterrupted: true,
    role: "group",
  });
  const { width, height } = VOICE_PILL_FOOTPRINT.meetingInterrupted;
  assert.match(html, new RegExp(`style="width:${width}px;height:${height}px`));
  assert.match(html, /role="group"/);
});

test("the dot pulses only while recording, and not under reduced motion", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/dictation-panel.css"), "utf8");
  assert.match(css, /\.meeting-capsule\[data-rs="recording"\] \.meeting-capsule__dot\s*\{[^}]*animation:\s*meeting-dot 1200ms ease-in-out infinite/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.meeting-capsule__dot\s*\{\s*animation:\s*none/);
});

test("the on-screen recorder setting defaults to on", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/stores/settingsStore.ts"), "utf8");
  assert.match(src, /showMeetingRecorderOnScreen:\s*readBoolean\("showMeetingRecorderOnScreen", true\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/meetingCapsule.test.js`
Expected: FAIL with `Cannot find module '…/MeetingCapsule.tsx'`.

- [ ] **Step 3: Implement**

`src/hooks/useMeetingRecordingPresence.ts`:

```ts
import { useEffect, useState } from "react";
import type { MeetingPresence } from "../types/dictation";

export function useMeetingRecordingPresence(): MeetingPresence | null {
  const [presence, setPresence] = useState<MeetingPresence | null>(null);
  useEffect(() => {
    let alive = true;
    void window.electronAPI?.getMeetingRecordingPresence?.().then((p) => alive && setPresence(p ?? null));
    const off = window.electronAPI?.onMeetingRecordingPresenceChanged?.((p) => setPresence(p ?? null));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return presence;
}
```

`src/components/dictation/MeetingCapsule.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import type { MeetingPresence } from "../../types/dictation";
import { formatMmSs } from "../../utils/formatDuration";

export function meetingCapsuleState(p: MeetingPresence): "recording" | "quiet" | "lost" {
  if (p.interruption) return "lost";
  return p.quiet ? "quiet" : "recording";
}

/** VO-R12 A content inside the pill: dot, elapsed time, what was lost, Stop. */
export function MeetingCapsule({ presence, now, onStop }: { presence: MeetingPresence; now: number; onStop: () => void }) {
  const { t } = useTranslation();
  const rs = meetingCapsuleState(presence);
  const elapsed = formatMmSs(Math.max(0, Math.floor((now - presence.startedAt) / 1000)));
  return (
    <span className="meeting-capsule" data-rs={rs}>
      <span className="meeting-capsule__dot" aria-hidden="true" />
      <span className="meeting-capsule__time">{elapsed}</span>
      {rs === "lost" ? (
        <span className="meeting-capsule__note">
          {t(presence.interruption === "mic" ? "meetingRecorder.micLost" : "meetingRecorder.systemLost")}
        </span>
      ) : null}
      <button
        type="button"
        className="meeting-capsule__stop"
        aria-label={t("meetingRecorder.stopAria")}
        onClick={(e) => {
          e.stopPropagation();
          onStop();
        }}
      />
    </span>
  );
}
```

Check that `formatMmSs` takes seconds (`src/utils/formatDuration`; `NoteRecordControl.tsx:104` calls it with seconds).

In `VoicePill.tsx`:
- Add `"meeting"` to `LABELLED`.
- Hide the identity slot and drop the label padding for `meeting`. The capsule has its own dot, and 124 px must hold dot, time and Stop (about 91 px). Wrap the identity `<span className="voice-pill-identity-slot …">` in `{state !== "meeting" ? (…) : null}`, and change `hasLabel && "ps-1 pe-3"` to `hasLabel && state !== "meeting" && "ps-1 pe-3"`.
- Add the prop `meetingInterrupted?: boolean`.
- When resolving the footprint, use `state === "meeting" ? VOICE_PILL_FOOTPRINT[meetingInterrupted ? "meetingInterrupted" : "meeting"] : …`.
- For `meeting`, render `label` without the `pill-stage-label` truncation wrapper (`{state === "meeting" ? label : <span className="pill-stage-label ms-1.5">{label}</span>}`), because the capsule handles its own layout.

In `useAudioRecording.js`, add `const meetingRecording = useMeetingRecordingPresence();` and return `meetingRecording`.

`settingsStore.ts`: add `showMeetingRecorderOnScreen` exactly like `audioCuesEnabled`:
- in `BOOLEAN_SETTINGS`;
- as a type member;
- `showMeetingRecorderOnScreen: readBoolean("showMeetingRecorderOnScreen", true),`;
- a setter type;
- `setShowMeetingRecorderOnScreen: createBooleanSetter("showMeetingRecorderOnScreen"),`.

Pass it through in `useSettings.ts`.

`SettingsPage.tsx`: add a `SettingsPanelRow` after the "Meeting detection" row (around line 1745):

```tsx
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.notifications.meetingRecorderOnScreen")}
                    description={t("settingsPage.general.notifications.meetingRecorderOnScreenDescription")}
                  >
                    <Toggle checked={showMeetingRecorderOnScreen} onChange={setShowMeetingRecorderOnScreen} />
                  </SettingsRow>
                </SettingsPanelRow>
```

`App.jsx`:
- Read the settings and presence:

  ```js
    const showMeetingRecorder = useSettingsStore((s) => s.showMeetingRecorderOnScreen);
    const meetingRecorderVisible = Boolean(meetingRecording && showMeetingRecorder);
    const [meetingNow, setMeetingNow] = useState(() => Date.now());
    useEffect(() => {
      if (!meetingRecorderVisible) return;
      const id = setInterval(() => setMeetingNow(Date.now()), 1000);
      return () => clearInterval(id);
    }, [meetingRecorderVisible]);
  ```

- In the `resolvePillStage` call, replace `meetingRecording: null` and `showMeetingRecorder: true` with the real `meetingRecording` and `showMeetingRecorder`.
- When `pillStage === "meeting"`, pass to `VoicePill`:
  - `label={<MeetingCapsule presence={meetingRecording} now={meetingNow} onStop={() => void window.electronAPI?.requestStopMeetingRecording?.(meetingRecording.sessionId)} />}`
  - `meetingInterrupted={Boolean(meetingRecording.interruption)}`
  - `role="group"`
  - `aria-label={t("meetingRecorder.groupAria")}`

  A click on the pill body still starts dictation ("dictation still works from it", D2). The Stop button stops propagation.
- Auto-hide, footer suppression, click-through and the Linux input region need no meeting-specific code. The `meeting` stage's ownership (Task 10: holds the window, interactive, outranks the footer) already reaches all four through Task 11's wiring. Stop is an in-flow child of the pill, so it lies inside the Linux input rect.
- **Outcome notices (I14).** Presence disappearing proves nothing: it also happens when the control panel crashes. The pill reacts only to the explicit outcome from Task 16:

  ```js
    useEffect(
      () =>
        window.electronAPI?.onMeetingRecordingOutcome?.((outcome) => {
          if (outcome.kind === "saved") {
            notify({
              id: `meeting-${outcome.sessionId}`,
              kind: "receipt",
              title: t("meetingRecorder.saved", { elapsed: formatMmSs(Math.round(outcome.durationMs / 1000)) }),
            });
          } else {
            notify({
              id: `meeting-${outcome.sessionId}`,
              kind: "alert",
              persistent: true,
              title: t(`meetingRecorder.failed.${outcome.reason}`),
              actions: [{ label: t("meetingRecorder.openNotes"), primary: true, onClick: () => void window.electronAPI?.showControlPanel?.() }],
            });
          }
        }),
      [t]
    );
  ```

  "Open notes" needs an IPC that shows the control panel from the pill window. Check with `grep -n "showControlPanel\|openControlPanel" preload.js`. If none exists, add one in this task:
  - preload: `showControlPanel: () => ipcRenderer.invoke("show-control-panel")`;
  - main: `ipcMain.handle("show-control-panel", () => this.windowManager._showControlPanel())`;
  - a type and a preview stub.

  The control panel already navigates to the meeting note after a stop (`queueMeetingNoteNavigation`).

  Add a test to `test/components/meetingCapsule.test.js`:

  ```js
  test("the pill never announces 'saved' because presence vanished (I14)", () => {
    const app = fs.readFileSync(path.join(repoRoot, "src/App.jsx"), "utf8");
    assert.match(app, /onMeetingRecordingOutcome\?\.\(\(outcome\) =>/);
    assert.doesNotMatch(app, /meetingRecorder\.saved[\s\S]{0,200}meetingRecording\b[^O]*null/);
  });
  ```

CSS (append before the reduced-motion block):

```css
/* VO-R12 A inside the pill (D2). */
.meeting-capsule {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding-inline: 10px 4px;
  font: 600 12px/1 var(--font-family-sans);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
.meeting-capsule__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: var(--color-live);
  transition: background var(--motion-fast) var(--motion-ease-std);
}
.meeting-capsule[data-rs="recording"] .meeting-capsule__dot {
  animation: meeting-dot 1200ms ease-in-out infinite;
}
.meeting-capsule[data-rs="quiet"] .meeting-capsule__dot {
  background: color-mix(in oklch, var(--color-live) 45%, var(--color-surface-1));
}
.meeting-capsule[data-rs="lost"] .meeting-capsule__dot {
  background: var(--color-warning);
}
.voice-pill-control[data-pill-state="meeting"]:has(.meeting-capsule[data-rs="lost"]) {
  border-color: var(--color-warning);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-warning) 55%, transparent), var(--shadow-card, 0 1px 3px rgb(0 0 0 / 0.12));
}
.meeting-capsule__note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--color-muted-foreground);
}
.meeting-capsule__stop {
  margin-inline-start: auto;
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  background: var(--color-foreground);
}
.meeting-capsule__stop::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--color-background);
}
@keyframes meeting-dot {
  50% {
    opacity: 0.55;
  }
}
```

Inside the reduced-motion block, add `.meeting-capsule__dot { animation: none; }`.

Locale keys:
- `meetingRecorder.systemLost`: "System audio lost"
- `meetingRecorder.micLost`: "Microphone lost"
- `meetingRecorder.stopAria`: "Stop meeting recording"
- `meetingRecorder.groupAria`: "Meeting recorder"
- `meetingRecorder.saved`: "Meeting saved · {{elapsed}}"
- `meetingRecorder.openNotes`: "Open notes"
- `meetingRecorder.failed.save`: "The meeting stopped, but its transcript could not be saved. Open the note to check what was kept."
- `meetingRecorder.failed.stop`: "The meeting recording did not stop cleanly. Open the note to check it."
- `meetingRecorder.failed.ownerLost`: "The meeting recorder stopped unexpectedly. Open the note to check what was kept."
- `settingsPage.general.notifications.meetingRecorderOnScreen`: "Show meeting recorder on screen"
- `settingsPage.general.notifications.meetingRecorderOnScreenDescription`: "While a meeting records, the dictation pill shows a timer and a Stop button."

In `DESIGN.md` `### Voice Pill`, add a paragraph:
- the meeting recorder is a state of the pill (124×36, or 184×36 when a source is lost);
- the dot pulses at 1.2 s;
- the setting turns it off;
- Linux also shows a tray dot and a persistent notification with Stop.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/meetingCapsule.test.js test/helpers/voicePillStructure.test.js test/helpers/voicePillPresentation.test.js "test/helpers/useAudioRecording*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMeetingRecordingPresence.ts src/components/dictation/MeetingCapsule.tsx src/components/dictation/VoicePill.tsx src/hooks/useAudioRecording.js src/App.jsx src/stores/settingsStore.ts src/hooks/useSettings.ts src/components/SettingsPage.tsx src/styles/dictation-panel.css src/locales DESIGN.md test/components/meetingCapsule.test.js
git commit -m "feat(meeting): the dictation pill becomes the meeting recorder while one records"
```

---

### Task 18: Notch-drop meeting prompt (VO-R11 B, VO-Q10)

**Files:**
- Modify: `src/helpers/windowConfig.js`. Add `getNotchDropPosition(display)` to `WindowPositionUtil` next to `getNotificationPosition` (lines 328–341).
- Modify: `src/helpers/windowManager.js`:
  - `showMeetingNotification` (2030–2125): use the active display, register ⌥⌘M, and send the hotkey label;
  - `dismissMeetingNotification` (line 2144): unregister the hotkey.
- Modify: `src/helpers/meetingDetectionEngine.js:421-428`. Add `appName` to the prompt payload.
- Modify: `src/types/electron.ts:66-73`. Add `appName?: string | null; acceptHotkeyLabel?: string | null` to `MeetingNotificationData`.
- Modify: `src/components/meetingNotificationModel.ts`
- Modify: `src/components/MeetingNotificationCard.tsx`
- Modify: `src/components/MeetingNotificationOverlay.tsx`
- Modify: `src/index.css` or `src/styles/notices.css`. Add the `.meeting-drop` rules to `notices.css`.
- Modify: `src/locales/*/translation.json` (`meetingNotification.*`)
- Test: `test/components/meetingPrompt.test.js`

**Interfaces:**
- Produces:

  ```js
  WindowPositionUtil.getNotchDropPosition(display): { x: number; y: number; width: 392; height: 92 } // top-centre of the work area, 8px below the menu bar
  ```

  ```ts
  export const MEETING_PROMPT_MINI_AFTER_MS = 8000;
  export function getMeetingNotificationPresentation(data): { titleKey | title, bodyKey, bodyParams, privacyKey: string | null, action: "start" | "join" };
  export function acceptHotkeyLabel(platform: string): string; // "⌥⌘M" | "Ctrl+Alt+M"
  // MeetingNotificationCard gains: phase?: "card" | "mini" | "accepted"; privacyLine?: string; hotkeyLabel?: string | null
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/meetingPrompt.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const repoRoot = path.join(__dirname, "../..");

test("the prompt names the app and says detection is local (VO-R11)", async () => {
  const { getMeetingNotificationPresentation } = await import("../../src/components/meetingNotificationModel.ts");
  const p = getMeetingNotificationPresentation({ detectionId: "d", source: "audio", key: "k", event: null, variant: "detected", joinUrl: null, appName: "Zoom" });
  assert.equal(p.bodyKey, "meetingNotification.bodyApp");
  assert.deepEqual(p.bodyParams, { app: "Zoom" });
  assert.equal(p.privacyKey, "meetingNotification.privacy");
  const noApp = getMeetingNotificationPresentation({ detectionId: "d", source: "audio", key: "k", event: null, variant: "detected", joinUrl: null });
  assert.equal(noApp.bodyKey, "meetingNotification.body.detected");
});

test("the accept hotkey is labelled per platform", async () => {
  const { acceptHotkeyLabel, MEETING_PROMPT_MINI_AFTER_MS } = await import("../../src/components/meetingNotificationModel.ts");
  assert.equal(acceptHotkeyLabel("darwin"), "⌥⌘M");
  assert.equal(acceptHotkeyLabel("linux"), "Ctrl+Alt+M");
  assert.equal(MEETING_PROMPT_MINI_AFTER_MS, 8000);
});

test("mini phase folds to a one-line pill with the hotkey; close is always visible", async () => {
  const { MeetingNotificationCard } = await import("../../src/components/MeetingNotificationCard.tsx");
  const mini = renderStatic(MeetingNotificationCard, {
    title: "Meeting detected", body: "Meeting in Zoom detected.", startLabel: "Take notes",
    phase: "mini", hotkeyLabel: "⌥⌘M", miniLabel: "Meeting? Start notes",
  });
  assert.match(mini, /data-phase="mini"/);
  assert.match(mini, /Meeting\? Start notes/);
  assert.match(mini, /<kbd[^>]*>⌥⌘M<\/kbd>/);
  const card = renderStatic(MeetingNotificationCard, { title: "Meeting detected", body: "b", startLabel: "Take notes", privacyLine: "Detected on this device. Nothing recorded yet." });
  assert.match(card, /Detected on this device\. Nothing recorded yet\./);
  // Plan 01 review item 3: no tinted tile doubling the orange mark.
  assert.doesNotMatch(card, /bg-primary\/10/);
  // Always rendered, even without onDismiss (drop the existing `onDismiss &&` guard).
  const close = card.match(/<button[^>]*meeting-card__close[^>]*>/);
  assert.ok(close, "close button rendered");
  assert.match(close[0], /aria-label="[^"]+"/);
  assert.doesNotMatch(card, /pointer-events-none/);
});

test("the card drops from the top with the settle spring; the legacy blue mark is gone", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/notices.css"), "utf8");
  assert.match(css, /\.meeting-drop\s*\{[^}]*animation:\s*meeting-drop var\(--motion-hero\) var\(--motion-spring-settle\)/);
  const card = fs.readFileSync(path.join(repoRoot, "src/components/MeetingNotificationCard.tsx"), "utf8");
  assert.doesNotMatch(card, /#2056DF/i);
  // Starting a recording is a live-voice control (D1); it uses the shared variant, not a copy of its surface.
  assert.match(card, /variant="live"/);
  assert.doesNotMatch(card, /BRAND_GLASS_SURFACE/);
});

test("the prompt is placed top-centre on the active display (VO-Q10)", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src/helpers/windowManager.js"), "utf8");
  const block = src.slice(src.indexOf("showMeetingNotification("), src.indexOf("showNotificationWindow("));
  assert.match(block, /_resolveActiveDisplay\(/);
  assert.match(block, /getNotchDropPosition\(/);
  assert.doesNotMatch(block, /getPrimaryDisplay\(\)/);
  assert.match(block, /hotkeyLeases\.acquire\(\{ slot: "meetingAccept"/);
  assert.doesNotMatch(block, /registerSlot\(/, "temporary shortcuts go through main's leases (I7)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/meetingPrompt.test.js`
Expected: FAIL. `bodyKey` is `meetingNotification.body.detected` for Zoom, and `acceptHotkeyLabel` is not exported.

- [ ] **Step 3: Implement**

1. **`windowConfig.js`.** Add this to `WindowPositionUtil`:

   ```js
     // VO-R11 B: the prompt drops from the menu-bar edge, centred, on the
     // display the user is working on.
     getNotchDropPosition(display) {
       const { x, y, width } = display.workArea;
       const w = NOTIFICATION_WINDOW_CONFIG.width;
       const h = NOTIFICATION_WINDOW_CONFIG.height;
       return { x: Math.round(x + (width - w) / 2), y: y + 8, width: w, height: h };
     },
   ```

   If `NOTIFICATION_WINDOW_CONFIG` is declared after `WindowPositionUtil`, it is still defined by the time the method runs. Leave the order as it is.
2. **`windowManager.js`, `showMeetingNotification` (line 2030).**
   - It is already `async`.
   - Replace lines 2046–2047 with:

     ```js
         const display = await this._resolveActiveDisplay();
         const position = WindowPositionUtil.getNotchDropPosition(display);
     ```

     `_resolveActiveDisplay(targetPidPromise)` (line 1469) falls back to the display under the cursor when no pid is given.
   - Before the window is created, lease the accept shortcut from Task 2's `hotkeyLeases` (I7). The lease owner is the prompt itself, so a replacing prompt releases the older lease before acquiring, and a late registration for a dismissed prompt is undone by the lease module:

     ```js
         if (this._meetingAcceptLease) this.hotkeyLeases.release(this._meetingAcceptLease, "main:meeting-prompt");
         const detectionId = promptData.detectionId;
         const lease = await this.hotkeyLeases.acquire({
           slot: "meetingAccept",
           ownerId: "main:meeting-prompt",
           onPress: () => this.meetingDetectionEngine?.handleNotificationResponse(detectionId, "start"),
         });
         this._meetingAcceptLease = lease.leaseId;
         const data = {
           ...promptData,
           // Shown only when main actually holds the shortcut (another app may own it).
           acceptHotkeyLabel: lease.held ? (process.platform === "darwin" ? "⌥⌘M" : "Ctrl+Alt+M") : null,
         };
     ```

     Send `data` instead of `promptData` at line 2114.
   - In `dismissMeetingNotification` (line 2144), add:

     ```js
         if (this._meetingAcceptLease) {
           this.hotkeyLeases.release(this._meetingAcceptLease, "main:meeting-prompt");
           this._meetingAcceptLease = null;
         }
     ```

     Leases also expire on their own after `LEASE_MAX_TTL_MS.meetingAccept` (120 s), which covers the calendar prompt's 2 min auto-dismiss.
   - Callers of `showMeetingNotification` (`meetingDetectionEngine.js:421`) can stay fire-and-forget.
3. **`meetingDetectionEngine.js:421-428`.** Audio-activity detections carry no app name (`audioActivityDetector.js` emits `{ durationMs, detectedAt, attributed }`). Take it from the process detector, which already tracks running meeting apps:

   ```js
       const runningApp = this.meetingProcessDetector?.getDetectedProcesses?.()?.find?.((p) => p?.appName)?.appName ?? null;
       // …in the showMeetingNotification payload:
       appName: data?.appName ?? runningApp,
   ```

   Read `getDetectedProcesses()` first (`grep -n "getDetectedProcesses" src/helpers/meetingProcessDetector.js`). If it returns keys rather than objects, map each key to its `appName` the way the `meeting-process-detected` event payload does (`{ processKey, appName }`).
4. **`meetingNotificationModel.ts`:**

   ```ts
   export const MEETING_PROMPT_MINI_AFTER_MS = 8000;

   export function acceptHotkeyLabel(platform: string): string {
     return platform === "darwin" ? "⌥⌘M" : "Ctrl+Alt+M";
   }
   ```

   In `getMeetingNotificationPresentation` (lines 24–36):
   - When `data.variant === "detected" && data.appName`, return `bodyKey: "meetingNotification.bodyApp"` and `bodyParams: { app: data.appName }`.
   - Otherwise keep `meetingNotification.body.${variant}` with `bodyParams: {}`.
   - Add `privacyKey: data.variant === "detected" ? "meetingNotification.privacy" : null`.
   - Extend `MeetingNotificationPresentation` (lines 3–13) with `bodyParams` and `privacyKey`.
5. **`MeetingNotificationCard.tsx`.** Rewrite its render. Keep the props from lines 5–16, and add `phase?: "card" | "mini" | "accepted"` (default `"card"`), `privacyLine?: string`, `hotkeyLabel?: string | null` and `miniLabel?: string`.
   - Root: `<div className="meeting-card meeting-drop" data-phase={phase} …>`, keeping today's surface classes.
   - Close button:
     - always rendered at 65% opacity;
     - `aria-label={t("meetingNotification.dismiss")}` and `className="meeting-card__close …"`;
     - position `-start-2.5` instead of `-left-2.5` (RTL);
     - remove the `pointer-events-none` branch and the `closeVisible` prop, then update callers.
   - Icon: the Loqui mark at 26 px, **without** the `bg-primary/10 rounded-md p-1` tile that Plan 01 left behind it (`MeetingNotificationCard.tsx`, the `<div className="shrink-0 bg-primary/10 rounded-md p-1">` wrapper). The mark is already an orange bubble, so a tinted tile behind it reads as a doubled-up badge (Plan 01 review item 3). Render `<img src={mark} alt="" className="size-6.5 shrink-0" draggable={false} />` directly.
   - Text: title 14 px/600, body 13 px, and the `privacyLine` as a second 12 px line in `text-success`.
   - Start button: `<Button variant="live" size="sm">`. It replaces the hand-rolled `BRAND_GLASS_SURFACE` button and that import.

     **Decision (Plan 01 review item 3):** "Take notes" starts a meeting recording, which is a record control. So it is a live-voice control under D1 and keeps the orange `live` variant, with ink text at 6.29:1. "Join & transcribe" (calendar prompts) also starts recording, so the same rule applies. Record this in `DESIGN.md` under `### Buttons`: "Meeting prompt Start / Join & transcribe use `live`: they start a recording."
   - `DESIGN.md`: add that line.
   - `phase === "mini"`: render only `<span className="meeting-card__mini">` with a 7 px live dot, `{miniLabel}` and `{hotkeyLabel ? <kbd>{hotkeyLabel}</kbd> : null}`. Clicking it calls `onStart`.
   - `phase === "accepted"`: title `t("meetingNotification.accepted")`, no button.
6. **`MeetingNotificationOverlay.tsx`:**
   - Keep the `phase` state (`"card"`).
   - Start a `MEETING_PROMPT_MINI_AFTER_MS` timer when visible. It is cleared while hovered and restarted on leave, using the existing hover handlers (lines 68–79), and it sets `"mini"`.
   - `onStart` sets `"accepted"` and calls `respond("start")` immediately.
   - Pass these to the card:
     - `privacyLine={presentation.privacyKey ? t(presentation.privacyKey) : undefined}`
     - `hotkeyLabel={data.acceptHotkeyLabel ?? null}`
     - `miniLabel={t("meetingNotification.mini")}`
     - `body={t(presentation.bodyKey, presentation.bodyParams)}`
   - Replace the slide-from-right transform (lines 146–171) with the `meeting-drop` class for entry. Keep the exit at 200 ms with `opacity` and `translateY(-8px)` (`--motion-ease-exit`).
   - Keep swipe-to-dismiss, but make it vertical (an upward swipe dismisses). Change the axis in the pointer handlers (lines 81–140).
7. **CSS**, appended to `src/styles/notices.css`:

   ```css
   /* VO-R11 B: the meeting prompt drops from the menu-bar edge, then folds into
      a one-line pill after 8s so it never blocks content. */
   .meeting-drop {
     transform-origin: top center;
     animation: meeting-drop var(--motion-hero) var(--motion-spring-settle) both;
   }
   @keyframes meeting-drop {
     from {
       opacity: 0;
       transform: translateY(-80px) scale(0.7);
     }
   }
   .meeting-card {
     transition:
       border-radius var(--motion-slow) var(--motion-ease-std),
       padding var(--motion-slow) var(--motion-ease-std),
       min-height var(--motion-slow) var(--motion-ease-std),
       width var(--motion-slow) var(--motion-ease-std);
   }
   .meeting-card[data-phase="mini"] {
     width: 224px;
     min-height: 36px;
     margin-inline: auto;
     padding: 0 12px;
     border-radius: 9999px;
   }
   .meeting-card__mini {
     display: flex;
     align-items: center;
     gap: 7px;
     height: 36px;
     font: 600 12.5px/1 var(--font-family-sans);
     white-space: nowrap;
   }
   @media (prefers-reduced-motion: reduce) {
     .meeting-drop {
       animation: notice-fade var(--motion-fast) linear both;
     }
     .meeting-card {
       transition: opacity var(--motion-fast) linear;
     }
   }
   ```

8. **Locale keys** (`meetingNotification`):

   ```json
   "bodyApp": "Meeting in {{app}} detected.",
   "privacy": "Detected on this device. Nothing recorded yet.",
   "mini": "Meeting? Start notes",
   "accepted": "Taking notes",
   "dismiss": "Dismiss"
   ```

   `src/preview/` also renders `MeetingNotificationCard` (the onboarding preview). Run `grep -rn "MeetingNotificationCard" src` and drop `closeVisible` from each caller.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/meetingPrompt.test.js test/helpers/windowPositionClamp.test.js test/components/brandGlow.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/windowConfig.js src/helpers/windowManager.js src/helpers/meetingDetectionEngine.js src/types/electron.ts src/components/meetingNotificationModel.ts src/components/MeetingNotificationCard.tsx src/components/MeetingNotificationOverlay.tsx src/styles/notices.css src/preview src/locales DESIGN.md test/components/meetingPrompt.test.js
git commit -m "feat(meeting): notch-drop prompt on the active display with an accept hotkey"
```

---

### Task 19: One meter everywhere, a calm mic loop and a token diarization palette

Covers FND-R5 adoption on meeting and chat surfaces, plus VO-Q11, VO-Q13 and VO-Q15. It also feeds the capsule's `quiet` flag.

**Files:**
- Create: `src/utils/meetingMicLevel.ts`. Move `readMeetingMicLevel` here from `NoteRecordControl.tsx:11-18`.
- Create: `src/utils/meetingQuiet.ts`
- Modify: `src/components/notes/NoteRecordControl.tsx`. `RecordingWave` (lines 23–38) and `LiveWaveform` (line 102) become `LevelBars`.
- Modify: `src/components/notes/MeetingRecordingPill.tsx`. The 4 bars (lines 20–28, 39, 97–107) become `LevelBars`, with no store subscription.
- Modify: `src/components/MeetingRecordingMount.tsx`. Replace the rAF loop (lines 195–229) with a 12 Hz interval plus quiet detection.
- Modify: `src/components/chat/ChatInput.tsx:148-156`
- Modify: `src/components/notes/MeetingTranscriptChat.tsx:31-51`
- Modify: `src/index.css`. Add speaker tokens to `@theme` and `.dark`, and delete `@keyframes ow-wave` (lines 1515–1524).
- Delete: `src/components/ui/LiveWaveform.tsx`, `src/components/ui/liveWaveformMath.ts`, `test/components/liveWaveform.test.js` (no importers remain; Step 3 checks this).
- Test: `test/components/meetingMeters.test.js`

**Interfaces:**
- Consumes `LevelBars` as shipped in Plan 01 `172f9df`:
  - it holds `readLevel` in a ref, so pass plain inline readers and never wrap them in `useCallback` to "stabilise" them;
  - it treats non-finite or sub-`LEVEL_BARS_SILENCE_FLOOR` input as silence, so readers need no clamping;
  - it uses a flat phase under reduced motion.
- Also consumes `resolveTokens` and `contrastRatio` (Plan 01 Task 2), and `reportMeetingRecordingPresence` (Task 16).
- Produces:

  ```ts
  export function readMeetingMicLevel(): number;
  export function createQuietDetector(opts?: { threshold?: number; holdMs?: number }): (level: number, now: number) => boolean;
  export const MEETING_LEVEL_SAMPLE_MS = 83; // 12 Hz
  ```

  It also adds the CSS tokens `--color-speaker-1` … `--color-speaker-8` (light and Plum Night).

- [ ] **Step 1: Write the failing test**

Create `test/components/meetingMeters.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

test("quiet means below the floor for four seconds, and clears at once", async () => {
  const { createQuietDetector } = await import("../../src/utils/meetingQuiet.ts");
  const quiet = createQuietDetector({ threshold: 0.01, holdMs: 4000 });
  assert.equal(quiet(0.001, 0), false);
  assert.equal(quiet(0.001, 3999), false);
  assert.equal(quiet(0.001, 4000), true);
  assert.equal(quiet(0.2, 4100), false);
  assert.equal(quiet(NaN, 4200), false);
});

test("every voice meter is LevelBars; the fake loop and the old waveforms are gone (VO-Q13)", () => {
  for (const file of ["src/components/notes/NoteRecordControl.tsx", "src/components/notes/MeetingRecordingPill.tsx", "src/components/chat/ChatInput.tsx"]) {
    const src = read(file);
    assert.match(src, /<LevelBars/, file);
    assert.doesNotMatch(src, /LiveWaveform|ow-wave|computeBarHeight/, file);
  }
  assert.doesNotMatch(read("src/index.css"), /@keyframes ow-wave/);
  assert.equal(fs.existsSync(path.join(repoRoot, "src/components/ui/LiveWaveform.tsx")), false);
});

test("the meeting mic loop samples at 12Hz and never per frame (VO-Q11)", () => {
  const src = read("src/components/MeetingRecordingMount.tsx");
  assert.doesNotMatch(src, /requestAnimationFrame\(tick\)/);
  assert.match(src, /setInterval\([\s\S]*MEETING_LEVEL_SAMPLE_MS/);
  assert.doesNotMatch(read("src/components/notes/MeetingRecordingPill.tsx"), /currentMicLevel/);
});

test("speaker colours avoid brand hues and pass 4.5:1 in both themes (VO-Q15)", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(read("src/index.css"));
  for (let i = 1; i <= 8; i += 1) {
    for (const [theme, map] of [["light", light], ["dark", dark]]) {
      const fg = map[`--color-speaker-${i}`];
      assert.ok(fg, `${theme} speaker ${i}`);
      for (const bg of ["--color-background", "--color-surface-1", "--color-surface-2", "--color-card", "--color-popover"]) {
        assert.ok(contrastRatio(fg, map[bg]) >= 4.5, `${theme} speaker ${i} on ${bg}: ${contrastRatio(fg, map[bg])}`);
      }
    }
  }
  const chat = read("src/components/notes/MeetingTranscriptChat.tsx");
  assert.doesNotMatch(chat, /text-(purple|orange|red)-400|border-s-(purple|orange|red)-400/);
  assert.match(chat, /text-speaker-1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/meetingMeters.test.js`
Expected: FAIL with `Cannot find module '…/meetingQuiet.ts'`.

- [ ] **Step 3: Implement**

1. `src/utils/meetingMicLevel.ts`. Move the code verbatim from `NoteRecordControl.tsx:11-18` and export it:

   ```ts
   import { getMicAnalyser, useMeetingRecordingStore } from "../stores/meetingRecordingStore";
   import { analyserRms } from "./audioLevel";

   const micLevelBuf: { current: Float32Array<ArrayBuffer> | null } = { current: null };

   /** The live meeting mic level, read straight from the analyser by LevelBars.
    *  No clamping: LevelBars' nextLevelBarsFrame floors and normalises it. */
   export function readMeetingMicLevel(): number {
     const analyser = getMicAnalyser();
     if (!analyser) return useMeetingRecordingStore.getState().currentMicLevel;
     return analyserRms(analyser, micLevelBuf);
   }
   ```

2. `src/utils/meetingQuiet.ts`:

   ```ts
   export const MEETING_LEVEL_SAMPLE_MS = 83; // 12 Hz

   /** True once the level has stayed under `threshold` for `holdMs`; false the moment it rises. */
   export function createQuietDetector({ threshold = 0.01, holdMs = 4000 } = {}) {
     let quietSince: number | null = null;
     return (level: number, now: number): boolean => {
       if (!Number.isFinite(level) || level >= threshold) {
         quietSince = null;
         return false;
       }
       quietSince ??= now;
       return now - quietSince >= holdMs;
     };
   }
   ```

3. **`NoteRecordControl.tsx`.**
   - Delete the local buffer and `readMeetingMicLevel` (lines 11–18), and import them from `../../utils/meetingMicLevel`.
   - Replace `RecordingWave` (lines 23–38). It stays exported, because `NoteEditor.tsx:834` uses it:

     ```tsx
     /** Transcript-tab indicator while a meeting records: the real mic level (VO-Q13). */
     export function RecordingWave({ className }: { className?: string }) {
       return <LevelBars readLevel={readMeetingMicLevel} height={12} className={className} />;
     }
     ```

   - Line 102 becomes `<LevelBars readLevel={readMeetingMicLevel} height={14} className="flex-1 justify-center" />`.
   - Swap the import `LiveWaveform` for `import { LevelBars } from "../ui/LevelBars";`.
4. **`MeetingRecordingPill.tsx`.**
   - Delete `computeBarHeight`, `BAR_COUNT`, `BAR_FLOOR` and the `currentMicLevel` selector (line 39).
   - Replace the bar block (lines 97–107):

     ```tsx
               {isWaitingForMic ? (
                 <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
               ) : (
                 <LevelBars readLevel={readMeetingMicLevel} height={16} />
               )}
     ```

   - While you are here, replace the inline `grow-to-bar 0.45s cubic-bezier(0.22, 1, 0.36, 1)` (line 71) with `grow-to-bar var(--motion-slow) var(--motion-ease-enter)`.
5. **`MeetingRecordingMount.tsx`.** Add `import { createQuietDetector, MEETING_LEVEL_SAMPLE_MS } from "../utils/meetingQuiet";`, then replace the effect at lines 195–229:

   ```tsx
     useEffect(() => {
       if (!isRecording) return;
       let buf = new Float32Array(256);
       let smoothed = 0;
       let lastWritten = -1;
       let lastQuiet = false;
       const isQuiet = createQuietDetector();
       const id = setInterval(() => {
         const analyser = getMicAnalyser();
         if (!analyser) return;
         if (buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize);
         analyser.getFloatTimeDomainData(buf);
         let sumSquares = 0;
         for (let i = 0; i < buf.length; i += 1) sumSquares += buf[i] * buf[i];
         smoothed = EMA_PREV * smoothed + EMA_NEXT * Math.sqrt(sumSquares / buf.length);
         const clamped = Math.min(1, Math.max(0, smoothed));
         // Meters read the analyser directly; the store copy only feeds
         // fallbacks, so write it when it moves, at most 12 times a second.
         if (Math.abs(clamped - lastWritten) > 0.005) {
           lastWritten = clamped;
           useMeetingRecordingStore.setState({ currentMicLevel: clamped });
         }
         const quiet = isQuiet(clamped, performance.now());
         if (quiet !== lastQuiet) {
           lastQuiet = quiet;
           useMeetingRecordingStore.setState({ micQuiet: quiet });
         }
       }, MEETING_LEVEL_SAMPLE_MS);
       return () => {
         clearInterval(id);
         useMeetingRecordingStore.setState({ currentMicLevel: 0, micQuiet: false });
       };
     }, [isRecording]);
   ```

   - Add `micQuiet: boolean` (initial `false`) to the store state type (`meetingRecordingStore.ts:84-116`) and to the initial values (lines 431–456).
   - Task 16's presence effect already reports `quiet: micQuiet`; this step provides the store field it reads.
6. **`ChatInput.tsx:150-154`.** Use `<LevelBars readLevel={voice.readLevel} height={16} className="flex-1 justify-center overflow-hidden" />` and swap the import.
7. Delete `LiveWaveform.tsx`, `liveWaveformMath.ts` and `test/components/liveWaveform.test.js` once no other module imports them. The gate searches for **imports and re-exports** only, quoted for zsh, and excludes the three files being removed and this task's own test (M3):

   ```bash
   rg -n "(from|import\(|require\()\s*['\"][^'\"]*(LiveWaveform|liveWaveformMath)['\"]" src test -g '!src/components/ui/LiveWaveform.tsx' -g '!src/components/ui/liveWaveformMath.ts' -g '!test/components/liveWaveform.test.js' -g '!test/components/meetingMeters.test.js'
   ```

   No file imports them today: only `ChatInput.tsx` and `NoteRecordControl.tsx` do, and this task migrates both. If the grep finds another importer (for example, a Plan 05 branch merged first), migrate it to `LevelBars` in this task too. The `meetingMeters` test asserts the file is gone.
8. **`index.css`.**
   - Delete `@keyframes ow-wave` and its comment (lines 1515–1524).
   - Add the speaker tokens. These are Tailwind-registered in `@theme`, so `text-speaker-N` and `border-s-speaker-N` work. Hue angles 65–260 in OKLCH avoid the orange, magenta, red and violet bands.
     - Light values are the lightest hex at 4.6:1 or better on `#fafafa`; they are also 4.8:1 or better on white.
     - Plum Night values are the darkest hex at 4.6:1 or better on the lightest dark surface, `--color-popover` `#2b1b24`; they are about 5.15:1 on `#1c1218`.

   In `@theme`:

   ```css
     --color-speaker-1: #986837;
     --color-speaker-2: #8b6e2e;
     --color-speaker-3: #64793c;
     --color-speaker-4: #467e53;
     --color-speaker-5: #2b7f67;
     --color-speaker-6: #0d7f7f;
     --color-speaker-7: #33799e;
     --color-speaker-8: #5372a7;
   ```

   In `.dark`:

   ```css
     --color-speaker-1: #af7e4c;
     --color-speaker-2: #a28444;
     --color-speaker-3: #7a9052;
     --color-speaker-4: #5c9568;
     --color-speaker-5: #45967d;
     --color-speaker-6: #329696;
     --color-speaker-7: #4b90b6;
     --color-speaker-8: #6889bf;
   ```

9. **`MeetingTranscriptChat.tsx:31-51`.** Tailwind only sees class names written out literally (it does not scan generated strings), so list all 16:

   ```ts
   // Diarization hues from tokens (VO-Q15): no violet (Agent), orange (live
   // voice) or red (alerts); 4.5:1 in both themes. Identity is also carried by
   // the speaker's name, so colour is never the only cue.
   const SPEAKER_COLORS = [
     "text-speaker-1", "text-speaker-2", "text-speaker-3", "text-speaker-4",
     "text-speaker-5", "text-speaker-6", "text-speaker-7", "text-speaker-8",
   ];
   const SPEAKER_BORDER_COLORS = [
     "border-s-speaker-1/50", "border-s-speaker-2/50", "border-s-speaker-3/50", "border-s-speaker-4/50",
     "border-s-speaker-5/50", "border-s-speaker-6/50", "border-s-speaker-7/50", "border-s-speaker-8/50",
   ];
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/meetingMeters.test.js test/components/noteRecordControlTimer.test.js test/components/meetingInterruptionWarning.test.js test/components/levelBars.test.js test/components/colorRoles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/utils/meetingMicLevel.ts src/utils/meetingQuiet.ts src/components/notes src/components/MeetingRecordingMount.tsx src/components/chat/ChatInput.tsx src/components/ui src/stores/meetingRecordingStore.ts src/index.css test/components
git commit -m "feat(voice): LevelBars on every voice surface, 12Hz meeting meter, token speaker palette"
```

---
### Task 20: Whole-plan verification

**Files:** none new. This task runs every check, records what it ran and where, and fixes what the checks surface.

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
rg -n "cubic-bezier\(\s*0\.4\s*,\s*0\s*,\s*1\s*,\s*1\s*\)" src && echo "ease-in exit found" || true
rg -n "mergeAudioSegments|merge-audio-segments" src/helpers/audioManager.js
```

Expected: everything passes, and the cubic-bezier search prints nothing.

The `mergeAudioSegments` search lists the merge call sites. Check each by hand:
- none of them starts while a cancel buffer is held (a merge already in flight when Esc lands is the documented exception, Step 3.6);
- the only cancel-time caller is `_closeCancelled`, behind `shouldSaveDiscardedRecording`.

A pre-existing test that fails because it asserts something this plan intentionally changed must be updated in this branch. Name it in the PR description. These are the intentional changes:
- the 260 ms press hold;
- the 1.9 s transcript entrance;
- toasts;
- `DictationErrorCard`;
- `PillWaveform`;
- the Agent beam;
- the blue meeting prompt position;
- `LiveWaveform`;
- discarded audio saved at window close instead of at cancel;
- Esc registered by lifecycle instead of at recording start.

Any other failure is a regression; fix the code.

- [ ] **Step 2: Plan 02's behaviours survived the migration**

Plan 02 fixed the toast and error UI that Task 5 deletes. Confirm each fix is still true in the merged tree. Each check names the test that pins it after this plan:

| Plan 02 item | Still true when | Pinned by |
|---|---|---|
| VO-Q6: no auto-dismiss while words exist; longer timers | An alert with `words` never expires; notices and alerts last 10 s | `notices.test.js`: "persistent notices and alerts that carry words…", "content on any kind is never allowed to expire" |
| VO-Q8: Esc armed until idle | Esc is registered for recording and processing, including Undo-started processing | `useAudioRecordingLifecycle.test.js`: "Esc is owned by the lifecycle…" |
| VO-Q9: live regions, visible close | Chips are `role="status"` or `role="alert"`; close is always visible | `noticeStack.test.js`: "every chip has a visible, labelled close button" |
| VO-Q16: interruption alerts regardless of focus | Plan 02's native notification module (`rg -n "new Notification\(" src/helpers main.js`) still fires on system-audio loss. This plan's resident notification (Task 16) is separate and must not replace it | Plan 02's own test (`rg -ln "systemNotification" test`); run it |

If Plan 02's module or test cannot be found, Plan 02 has not merged. Stop and report: this plan depends on it (see "Before you start").

- [ ] **Step 3: D3 audit on a real recording**

D3 is a privacy promise, so check it end to end once, on a development profile, never a personal one.

1. Turn **Save discarded transcriptions off**. Start a dictation, unplug or switch the microphone mid-recording so a second segment exists, then press Esc.
2. While the pill shows "Discarded · Undo", and for 15 s after it closes, list Loqui's temp directories:

   ```bash
   ls -d "${TMPDIR:-/tmp}"/openwhispr-audio-merge-* 2>/dev/null; echo "exit=$?"
   ```

   Expected: no directory.
3. Repeat step 1. This time press ⌥Z within the window, and confirm the restored dictation uses the route it was recorded with:
   - Switch STT from local to a provider during the window.
   - Then undo. The result must come back with no request to the provider. With Plan 07 merged, the flight recorder shows no `dictationStt` egress.
4. Repeat with a streaming provider: cancel mid-sentence, then undo. The same provider transcribes the restored audio.
5. Turn **Save discarded** on. Cancel and let the window expire: exactly one discarded history row appears.
6. **The in-flight exception.** With **Save discarded** off, record two segments as in step 1. Release the hotkey, and press Esc as soon as "Transcribing…" appears, while the merge runs. Run the `ls` from step 2 for 5 s. A directory may appear briefly, but it must be gone once the merge returns, and nothing may appear after that. Record what you saw in the PR description.

- [ ] **Step 4: Desktop checks and the platform matrix**

```bash
npm run native:electron
npm run dev
```

Record each check below for each platform in the PR description, as one row per platform:
- **macOS**: version, Apple silicon or Intel, Spaces on or off, one or two displays.
- **Linux X11**: distribution, desktop, X11.
- **Linux Wayland**: distribution, desktop (GNOME / KDE / Hyprland), Wayland.

Use the machines in `~/.agents/ssh-access.md` for Linux. Mark a check "not run" with the reason, rather than skipping it silently.

| # | Check | Expected |
|---|---|---|
| 1 | Hold the hotkey | The soft start cue sounds at the press. The capsule shows orange `LevelBars` about 300 ms later. With a streaming provider, words condense **above** the pill. |
| 2 | Release | "Transcribing…" (all-orange comet), then "Cleaning up" if on (orange→magenta), then "Pasted · N words" with the check for 700 ms. Auto-hide on: the beat still finishes. |
| 3 | Locality ring | Local: solid. Remote cleanup: dashed plus a monogram that orbits while processing. Tooltip: "Hold/Press ⌥Space" plus the route line at 12 px. |
| 4 | Cancel and Undo | Esc mid-recording: "Discarded · Undo" with a shrinking underline. Hover freezes it. ⌥Z restores. Cancel during processing with remote STT: "OpenAI already received the audio." (attested with Plan 07; "may have received" without). After expiry, ⌥Z types normally in another app. |
| 5 | Undo with the panel open | Open the Agent panel's final actions, then cancel a dictation: the Undo capsule stays visible and clickable. |
| 6 | Esc after Undo | Undo, then press Esc during the restored "Transcribing…": it cancels again. |
| 7 | Words-first card | Force a paste failure. The pill stays visible with a red edge. The card shows draggable words. ⌥↵ pastes again while the label is shown. The card does not time out. |
| 8 | Notices | Mic loss and restore chips. "Pasted without cleanup" shows Retry cleanup, and "More" reveals Settings, which opens Settings at the cleanup route's section. A second cleanup failure stays on screen. |
| 9 | Agent Mode | Radial ticks while listening, a 2.4 s orbit while thinking, a dissolve on the first token, a caption naming the destination, no frame glyph. |
| 10 | Meeting recorder | The pill becomes the capsule while a meeting records, including over the Assistant panel's final actions and with auto-hide on. Stop works from the pill. A save failure shows the failed alert, not "saved". Killing the control panel (`kill -9` on its renderer pid) shows "stopped unexpectedly". |
| 11 | Meeting prompt | It drops from the top centre of the display that has the meeting window. It folds after 8 s. ⌥⌘M accepts only while its label is shown. A second prompt replaces the first and the old shortcut is released. |
| 12 | Linux only | The tray shows an orange dot and leads with "Recording meeting · m:ss" and Stop. The resident notification's Stop ends that meeting. Stopping from the pill removes the notification. On a desktop whose notification server lacks actions, the never-expiring notification says to use the tray, and the tray Stop works. |
| 13 | Focus | In every check above, typing in the target app keeps focus. The pill and prompt never take keyboard focus. |
| 14 | Reduced motion | No orbit, spark, spring or nudge. The meters still update. The countdown steps in fifths. Every state reads from label and ring shape. |
| 15 | RTL (Arabic) | Pill chips and captions stay beside the physical dock. Panel chips sit at the inline end. |

The "notification server lacks actions" case in row 12 is covered by the unit test with an injected client (`linuxRecordingNotification.test.js`). On a real desktop, test it only where such a server already exists. Never uninstall or rename system binaries to simulate it.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(voice): verification fixes for the voice overlay plan"
```

---

### Task 21: Contract update and PR preparation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md` §5.2 and §5.3. Do this **only after the owner approves the contract change requests** at the top of this plan.

- [ ] **Step 1: Confirm the spec matches what shipped**

The owner applies the contract change requests at the top of this plan to the spec, and notifies Plans 05 and 07 (owner instruction, this thread). Before opening the PR, compare the merged spec's §5.2 and §5.3 with what this branch exports. If the spec already carries the CCR shapes, there is nothing to edit. If a CCR was rejected or changed, change the code to the spec's shape before this step.

- `src/types/dictation.ts` (CCR-1, CCR-2, CCR-3, CCR-6): `CancelledState`, `RemoteDisclosure`, `UndoResult`, `DictationOutcome`, `MeetingPresence` and `MeetingOutcome`.
- `useAudioRecording` return fields (CCR-3): `cancelled`, `undoCancel`, `pauseUndo`, `resumeUndo`, `processingStage`, `outcome` and `meetingRecording`.
- The onboarding demo statuses and the Undo bridge (CCR-5): `cancelled`, `cancelClosed`, `sendUndoCancelDictation`, `lastCancelledDictation`, and `sanitizeCancelledDemoFields`.
- `notices.ts` (CCR-4): the discriminated `NoticeInput`, `NoticeRemoval`, `revision`, `busy`, `dismissNotice(id, reason)`, and the 7 s receipt-with-action lifetime.
- `dictationDisclosure.js` (CCR-6): `dispatchTargetLabel`, `disclosureCopy` and `attachEgressEvidence`.

CCR-7 (`ResolvedRoute.providerId`) is §5.1 and Plan 03's; Plan 03 has accepted it. Do not edit §5.1 here.

- [ ] **Step 2: Prepare the PR body (do not push yet)**

Write `pr-body.md` with:
- one line per Task 1–19 commit;
- links to the spec and this plan;
- the Task 20 screenshots and the platform matrix;
- every pre-existing test intentionally updated (Task 20 Step 1);
- the Linux check results.

Pushing and opening the PR are outward-facing, so get the owner's explicit OK first. Then run:

```bash
git push -u origin HEAD
gh pr create --title "feat(voice): voice overlay — notices, undoable cancel, condensation pill, meeting recorder" --body-file pr-body.md
```

---

## Spec coverage

| Item | Task |
|---|---|
| VO-R1 C Condensation, with words outside the bars (D9) | 10, 11, 12 |
| VO-R6 B words-first card | 3, 4 |
| D3 cancel flow: instant cancel; 5 s / 10 s window; hover pause; ⌥Z or click; RAM-only (no temp files); zeroed, late bytes included; same-route Undo; Undo on every cancel path; Esc armed until idle; honest "already received" copy; PRIVACY.md | 6, 7, 8, 9, 11 |
| VO-R8 B violet orbit, no frame glyph | 13 |
| VO-R10 A soft family | 15 |
| VO-R11 B notch drop | 18 |
| VO-R12 A recorder capsule as a pill state (D2), Linux tray and notification, on-screen setting | 16, 17 |
| VO-R14 B pill-anchored chips | 1, 3 |
| §5.3 `notify()` and migrating every toast | 1, 3, 4, 5 |
| §5.2 lifecycle additions, including the Plan 05 Undo bridge | 7, 8, 9, 17 |
| §5.1 `useResolvedRoute` for the pill ring and tooltip; session routes | 6, 7, 11, 13, 14 |
| §5.4 Sealed mode: blocked ring, and Sealed pre-check on Undo | 8, 11 |
| LevelBars on every voice surface | 11, 13, 19 |
| VO-Q5 | 10 |
| VO-Q7 | 4 |
| VO-Q10 | 18 |
| VO-Q11 | 19 |
| VO-Q12 | 10, 11 |
| VO-Q13 | 19 |
| VO-Q14 | 14 |
| VO-Q15 | 19 |
| VO-Q18 | 10 |
| VO-Q19 | 14 |
| VO-Q20 | 14 |
| VO-Q21 | 4 |
| DESIGN.md sections (D10) | 3, 11, 13, 17, 18 |
