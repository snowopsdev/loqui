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
- Independent reviews this revision answers: `.omc/research/ui-review/reviews/plan-04-codex.md` (round 1) and `plan-04-codex-r2.md` (round 2, pinned at ff423fb), both in the sibling worktree.
- Spec state: §5 consolidated at 091d198, with the §5.2 clarifications at ff8c9cd and the D2 Linux clarification at 7f31ece.

---

## Round-2 review response

This revision answers `plan-04-codex-r2.md`, Codex's second review at ff423fb: 4 Critical, 13 Important, 1 Minor. All 18 are fixed in the named tasks, and none is disputed. Each fix changes the task code **and** its tests, and the tests drive the production paths named in the finding. They run the real `AudioManager` cancel and restore methods, the real notice store and buttons, the real `WindowManager`, tray and notification module, the real Plan 03 route graph and settings store, and a real App render. Only IPC, OS and transport leaves are faked. Two cases need the spec owner's eye, and they are flagged under the table.

| Finding | Severity | Where | How it is fixed | Pinned by |
|---|---|---|---|---|
| **R1-C2** Standalone Agent Undo resolved its destination from live settings | Critical | Tasks 6, 7, 8 | A banked Agent command carries `operation` (session id and credential-free settings) through `useAudioRecording` → `useAssistantPanel` → `AssistantPanel` / onboarding → `useChatStreaming` → `ReasoningService`, which resolves that one request from it. A per-session context owns the press-time selection read and screenshot. It moves into the cancel hold, comes back on restore, and is released when the hold closes. A restored session never reads the OS selection again, and main still re-validates the selection target before replacing. | Task 6 `dictationOperationHandoff.test.js` (each handoff); Task 8 "Undo through restoreCancelled keeps a standalone Agent command's route and screenshot", "…edits the press-time selection on the session's route", "a hold's press-time context is released…" |
| **R2-C1** Immediate Undo could discard audio before MediaRecorder's final event | Critical | Task 8 | The final chunk is registered with `buffer.expect()` **before** the window opens. Restore waits for it, bounded by `FINAL_AUDIO_WAIT_MS`. On timeout the recording goes back into its window, unzeroed, and the late chunk still lands. "Not delivered yet" is never reported or zeroed as "empty". The fake recorder now stops asynchronously, as the real one does. | "an immediate Undo waits for the recorder's final chunk…", "a final chunk that never arrives…", "expiry before the final chunk, retention off…" |
| **R2-C2** Failed batch Undo lost its audio and could stay busy | Critical | Task 8 | `_restoreBatch` sets `lastAudioBlob` and its session owner before provider work, so the failure path and Plan 07's `_noteSealedFailure` see it in either merge order. A merge failure settles its own pipeline and re-holds the source audio. An STT or Sealed failure keeps the audio as a normal dictation would (a failed history row with audio when retention is on); with retention off it is re-held, unless Plan 07 already holds it. | "a merge failure during Undo settles idle and puts the recording back", "an STT or Sealed failure during Undo keeps the audio, retention on or off" |
| **R2-C3** A later dictation removed unresolved recovered words | Critical | Tasks 1, 3, 4 | Content-bearing failures get session ids (`dictation-recovery:<sessionId>`). Status-only failures keep the stable `dictation-error` id, and only that id is cleared at recording edges. Words are never evicted or replaced by the store. Only a successful Paste again, or the user's Dismiss, removes them. Extra held transcripts sit behind an "N more" control instead of being dropped. | Task 1 store tests; Task 4 "two failed deliveries… both stay recoverable through a successful third dictation" |
| **R1-I1** Expiry waited indefinitely before zeroing | Important | Task 8 | With retention off, or a private hold, `_closeCancelled` zeroes at the deadline, and copies that land later are zeroed on arrival. With retention on it waits at most `CLOSE_SAVE_WAIT_MS`, saves what arrived, and zeroes right after copying into Blobs. | "expiry zeroes at the deadline even when a copy never settles (R1-I1)" (off, private, on) |
| **R1-I3** An abandoned restore could settle a newer operation | Important | Task 8 | A restore settles the lifecycle only while its generation is current, and the streaming replay's `finally` follows the same rule. A stale continuation never re-holds over newer work: it closes its recording as a newer start would, and emits nothing. | "Esc, then a new recording, while an Undo waits…" (resolve and reject) |
| **R1-I4** Ownership wiring read a const before initialization | Important | Task 11 | The auto-hide effect moves into `usePillAutoHide`, which App calls after the stage derivation it reads. Tasks 12–14 place their derivations after that block. | `appPillOwnership.test.js` (real `App.jsx` render, auto-hide on); `pillAutoHide.test.js` |
| **R1-I5** Fallback evidence was late and could claim pre-transport dispatch | Important | Task 7 | Without Plan 07, evidence comes only from main's `dictation-dispatch` event, sent immediately before the provider request leaves and filtered by session id. Completion is never read as dispatch, so renderer-side validation errors record nothing. The main-fed three-phase tracker is unchanged. | Task 7: held upload (evidence before the response), pre-IPC `ReasoningService` errors, cancelled start, main rejections |
| **R1-I6** The bridge dropped `alsoSentTo`, the order was reversed, and there was no second-merge step | Important | Tasks 8, 9 | The sanitiser keeps every `RemoteDisclosure` field. The broadcaster moves into the testable `buildOnboardingDemoBroadcast`. Restore emits `cancelClosed/restored` before `processing`. Task 9 Step 4b executes Plan 05's Task 22 and deletes its fallback when 05 merged first. Onboarding reads cancel details only from `onboarding-demo-event`. | "the real broadcaster keeps every receiver…", "Undo announces the closed window before processing starts", Task 9 Step 4b's reducer test |
| **R1-I7** An unexpectedly closed meeting prompt kept its shortcut | Important | Tasks 2, 18 | Each prompt's lease has its own owner, `main:meeting-prompt:<generation>`. It is released on close, renderer loss, navigation, dismissal and quit. | Task 18 real window-manager tests: unexpected close with deferred acquisition, crash, navigation, quit |
| **R1-I8** The Linux fallback substituted for D2 | Important | Tasks 16, 17, 20 | Implements the D2 clarification (7f31ece). Stop appears only where `GetCapabilities` lists `actions`. Elsewhere, or when publishing fails, a persistent notification without actions still shows, and clicking it reveals the pill with Stop (Task 17), even with the on-screen setting off. The tray Stop always stays, and the Stop transport stays session-bound and separate from `showSystemNotification`. | Task 16: service loss during discovery and publication, `Notify` rejection, a session-bound Stop delivery through the real `WindowManager`/`TrayManager`; Task 17 reveal test |
| **R1-I9** Quit did not join an expiry save already running | Important | Tasks 8, 9 | The undo window tracks every close still saving, and `expireNow()` joins them all. A `quitCoordinator` prevents every repeated quit until the one coordinated shutdown exits. | "a flush joins an expiry or replacement save that is already running"; `quitCoordinator.test.js` (delayed flush, duplicate quit, throwing flush) |
| **R1-I12** Deep links could vanish into a loading panel | Important | Task 4 | Main holds the Settings path until the control panel's subscriber acknowledges it, whether the panel is new, loading or reloading. A newer request replaces an older one, and an unacknowledged one expires after 15 s. | `settingsDeepLinkDelivery.test.js` (real main → preload → subscriber, through initial load and reload) |
| **R1-I14** Non-throwing failures were called "saved" | Important | Task 16 | "Saved" requires `{ success: true }` from both the transcript write and the stop. `{ success: false }`, `stale-session`, no result, no API and a throw are all failures. No content means no write was needed, which still counts as saved. | Task 16 table-driven tests with the real returned shapes |
| **R2-I1** Session routes called the wrong Plan 03 API | Important | Task 6 | Sessions use Plan 03's published `routeSnapshotFromSettings`. A resolution failure starts the dictation with `routes: null`, and Undo's Sealed pre-check fails closed on that. | Task 6 tests on the real Plan 03 modules: local, provider, network, loopback, unknown facts, sealed |
| **R2-I2** Pre-window awaits let obsolete prompts reappear | Important | Task 18 | A prompt generation is taken before the first await, invalidated on replacement, dismissal and teardown, and checked after every await. A stale prompt releases only its own lease. | Task 18: dismissal during display lookup or registration, out-of-order display and acquire |
| **R2-I3** Words-card Copy could falsely report success | Important | Task 3 | `writeClipboardText` reports success only on the bridge's `{ success: true }`, or a resolved `navigator.clipboard.writeText` fallback. A failure shows "Couldn't copy" and keeps the words. `useCopyFeedback` uses the same helper. | `wordsCardActions.test.js` (rejected, `{ success: false }`, absent bridge, web fallback, success) |
| **R2-M1** Replacement motion used literal timings | Minor | Tasks 11–14 | Ordinary transitions use Plan 01's `--motion-*` tokens. The picked choreography beats become shared tokens (CCR-8). The only literals left are loop periods and functional deadlines, listed explicitly. | `pillMotionTokens.test.js` |

**For the spec owner:**
- **The D2 click without `actions` (R1-I8).** The freedesktop spec lets a server without `actions` ignore every action, including the default click. Electron's Linux `Notification` registers its click only when the server advertises `actions`. The plan requests the click on both paths, names the tray in the notification text, and Task 20 records which desktops deliver it. On a desktop that delivers neither, the notification is informational only, and the tray Stop is the way out.
- **New motion tokens (R2-M1).** Five beat tokens extend Plan 01's motion contract (CCR-8).

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
| **I5** "already received" is not egress evidence | Closed | Task 7 | With Plan 07, evidence comes only from main's `EgressNotice`s for this session's `correlationId` with a content payload: `delivered` is `attested`, `dispatched` is `dispatched`, and `undelivered` withdraws its ticket (spec §5.4). Without Plan 07, evidence is recorded only after the transport hand-off (`dispatched`), and the copy then says "may have received". Startup failures, main rejections and Sealed blocks record nothing; since round 2, the no-07 fallback reads main's `dictation-dispatch` hand-off (R1-I5). Translation, cleanup, Agent and vision are instrumented. Loopback custom endpoints resolve to the device through Plan 03's resolver. |
| **I6** no cross-window Undo for Plan 05; disclosure shapes disagree | Closed | Tasks 7, 9; CCR-5, CCR-6 | There are `cancelled` and `cancelClosed` demo statuses with sanitised fields, `windowManager.sendUndoCancelDictation(sessionId)` (a request/reply to the overlay that returns `UndoResult`), and `lastCancelledDictation`. One `RemoteDisclosure` type (target id + payload + evidence) and one label helper serve Plans 04, 05 and 07. A two-window contract test covers the round trip. |
| **I7** temporary hotkeys lack main ownership | Closed | Tasks 2, 9, 18 | `hotkeyLeases.js` gives each temporary shortcut a main-owned lease. It is released on release, TTL, owner destruction, renderer crash and navigation. Registration is serialised per slot, so a late registration after release is undone and a newer lease is never unregistered by an older result. The UI shows a shortcut only when main reports `held`. Temporary slots never go to KGlobalAccel. The meeting prompt uses a lease too. |
| **I8** Linux notification races; fallback without Stop | Closed; the fallback is superseded in round 2 by the D2 clarification (R1-I8) | Task 16 | The notification uses the bundled `@homebridge/dbus-native`, not a host CLI. Its lifetime is serialised by generation: a late id is closed, signals are subscribed first, and `NotificationClosed`, service loss and teardown are handled. Stop is bound to the meeting session. Where the server has no `actions` capability or no service, the tray's "Stop meeting recording" is the Stop, and a never-expiring notification says so. **Different fix:** Electron cannot add buttons on Linux, so a fallback notification with a Stop button is impossible. The platform question is Open question 4. |
| **I9** quit flush not wired | Closed | Task 9 | `before-quit` awaits `flushDictationBeforeQuit({ timeoutMs: 3000 })`, a token-bound request/reply to the overlay, before teardown. A dead renderer times out, and its RAM is gone with it. With retention off, the flush only zeroes. The test replies only after a delayed flush settles. |
| **I10** failed Retry cleanup dismisses its own alert | Closed | Tasks 1, 4 | `runNoticeAction` dismisses only the revision it started on. Notices are `busy` while an action runs, and repeat activations are ignored. An integration test runs the real store and the real retry. |
| **I11** secondary actions discarded | Closed | Task 3 | A chip with more than one action gets an accessible "More" disclosure (`aria-expanded`, `aria-controls`) listing every other action. The test renders and finds the secondary controls. |
| **I12** `openSettingsAt` path ignored | Closed | Task 4 | The path is carried end to end: main holds it until the panel's subscriber acknowledges it (round 2, R1-I12), preload passes the payload, `ControlPanel` validates it against Plan 03's grammar and sets the section, and `SettingsModal` re-applies a section that arrives while it is open. |
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
- **06.** *(Superseded by §5.7 at 091d198.)* An open cancel window reaches the control panel as the lifecycle state `cancelled`, on Plan 06's existing channel, with no second relay (Task 9). Any toast Plan 06 adds is migrated by the guard test in Task 5, which runs on the final combined tree.
- **07.** One disclosure shape and one correlation id (CCR-6). Main's Sealed enforcement stays authoritative, and Undo pre-checks it but never bypasses it. Sealed state is read only from `src/stores/sealedStore.ts`. Plan 07's pre-flight, `_noteSealedFailure` and recovery notices are kept in both merge orders (Tasks 4, 5, 8, 10, 11).

**Spec alignment (091d198).** The spec's §5 now holds these contracts. This revision aligns the plan with it; where the two disagreed, the spec won:
- **§5.4 egress.** Task 7 maps `delivered`, `dispatched` and `undelivered` per ticket. The tickets live in the tracker, so a restored dictation keeps them. `host:` targets use the bare hostname, the same encoding as `EgressNotice.targetId`.
- **§5.4 pre-flight.** Task 8 keeps Plan 07's `startRecording` refusal and `_noteSealedFailure` in both merge orders. Tasks 10 and 11 render the refusal as the `sealedPaused` pill state: a blocked ring and "Dictation paused: Sealed mode is on".
- **§5.4 sealed reads.** Undo's Sealed pre-check reads `sealedStore` (`getSealedSnapshot()`, or Plan 03's `getSealed()` before Plan 07 merges). Unknown never blocks.
- **§5.3 Plan 07 notices.** The recovery prompt is a persistent `notice` with Transcribe and Discard. A sealed refusal that holds audio is a persistent `alert` whose Transcribe sits in the pill's notice slot (Tasks 4, 5).
- **§5.2 private holds.** A hold keeps `private`, an expired private hold is never persisted, and a restore re-applies the flag (Task 8).
- **§5.7.** `cancelled` travels on Plan 06's lifecycle channel. `reportCancelledDictation` is removed; `lastCancelledDictation` is set from the sanitised demo events (Task 9).
- **§5.5.** The resident Linux notification keeps its own freedesktop path, because `showSystemNotification` carries no actions (Task 16).

---

## Contract change requests

All seven are consolidated into the spec at 091d198. Each is marked below with where it now lives. The spec text is binding, and the shapes below match it.

Plan 04 owns §5.2 and §5.3. These are the exact shapes this plan ships. The owner applies them to the spec and notifies Plans 05 and 07. Task 21 confirms the merged spec matches before the PR. Shared types live in `src/types/dictation.ts`, created in Task 7, so consumers import them instead of restating them.

**CCR-1 (§5.2), the `cancelled` state.** *Applied in spec §5.2 (091d198).* Every cancel that captured audio has an Undo window, including streaming and merge-time cancels. A cancel before any audio exists produces no `cancelled` state.

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

**CCR-2 (§5.2), the meeting recorder.** *Applied in spec §5.2 (091d198).* The `meetingRecording` pill state carries liveness only. Saving is a separate, explicit outcome.

```ts
export interface MeetingPresence { sessionId: string; startedAt: number; interruption: "systemAudio" | "mic" | null; quiet: boolean }
export type MeetingOutcome =
  | { sessionId: string; kind: "saved"; durationMs: number; noteId: string | null }
  | { sessionId: string; kind: "failed"; reason: "save" | "stop" | "ownerLost" };
```

**CCR-3 (§5.2), `useAudioRecording` return additions.** *Applied in spec §5.2 (091d198), "`useAudioRecording` additions".* These are read-only:

```ts
cancelled: CancelledState | null;
undoCancel(): Promise<boolean>;
pauseUndo(): void;
resumeUndo(): void;
processingStage: "transcribing" | "cleaning" | null;
outcome: { sessionId: string; kind: "pasted"; words: number; at: number } | { sessionId: string; kind: "failed"; at: number } | null;
meetingRecording: MeetingPresence | null;
```

**CCR-4 (§5.3), `notify()`.** *Applied in spec §5.3 (091d198), with Plan 07's two fixed notices added there.*

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

**CCR-5 (§5.2), the cross-window Undo bridge for Plan 05.** *Applied in spec §5.2 (091d198), "Cross-window Undo bridge". How the control panel learns of an open window is superseded by §5.7: Plan 06's lifecycle channel, with no separate report.* The trial records in the overlay window, and the control panel drives it.
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

**CCR-6 (§5.2 / §5.4), one disclosure shape, settled with Plan 07.** *The shape and the copy are applied in spec §5.2 (091d198). The evidence rule is superseded by §5.4, "Egress evidence → `RemoteDisclosure`".*

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
- **Evidence (§5.4).** When Plan 07's `privacy.onEgress` exists, evidence comes only from main's notices for this session's `correlationId` with payload `audio`, `text` or `image`:
  - `delivered` sets `evidence: "attested"`;
  - `dispatched` sets `"dispatched"`;
  - `undelivered` withdraws that ticket's evidence, unless another ticket of the session has dispatched or delivered;
  - `metadata` (token fetches) and `recorded` rows never count.

  There is no `sent` phase. Without Plan 07, the renderer records `dispatched` only after the transport hand-off, never `attested`.
- **Amendment to Plan 07's CCR-3.** `remoteAlreadySent` is a `RemoteDisclosure`, not a display-name string. Main has no user-locale `t()`, and Plan 01's review requires `providerDisplayLabel(providerId, t)` for every shown provider name. The flight recorder keeps its own `EgressEvent` rows unchanged.
- **Naming.** Plan 07's `EgressNotice` is an IPC event type, unrelated to the §5.3 notice tier. Any user-facing egress message is shown through `notify({ kind: "receipt" | "notice" })`, with text from `disclosureCopy`.

**CCR-7 (§5.1, owner Plan 03): `ResolvedRoute.providerId: string | null`.** *Applied in spec §5.1 (091d198).* Plan 03's revision has accepted this. `routeProviderLabel` (Task 11) uses it unconditionally once present. Until then, it falls back to `route.provider`.

**CCR-8 (§5.1 Plan 01 table, motion tokens; new in round 2).** *Requested.* Plan 04 extends Plan 01's motion tokens with five beat tokens in the `src/index.css` `:root` Motion block, plus matching DESIGN.md rows:

```css
--motion-nudge: 260ms;             /* the failed pill's nudge */
--motion-bounce: 640ms;            /* the length --motion-spring-bounce is drawn for */
--motion-condense-fly: 140ms;      /* a spark rises from the bars */
--motion-condense-land: 220ms;     /* a word lands */
--motion-rewrite-underline: 600ms; /* cleanup's rewrite underline */
```

They are additive, and no existing token changes. Please add them to the "Extended by" column of the §5.1 Plan 01 table.

## Open questions for the owner

Each question has a default that the plan implements. A different answer changes only the task named.

1. **Live words and "Show transcription preview" (Task 12).** The default shows Condensation words above the pill whenever streaming partials exist, even with the preview setting off. Words on screen matter when screen sharing. Should the row honour that setting (off by default), or get its own?
2. **R11 B mini pill width (Task 18).** The card text says 168 px, but the mock CSS uses 224 px. "Meeting? Start notes ⌥⌘M" does not fit in 168 px at 12.5 px, so the plan uses 224 px.
3. **Global shortcuts beyond ⌥Z.** The plan adds two more, each leased only while its surface shows, and displayed only while main holds it:
   - ⌥↵ "Paste again" while a words card is up (Task 3);
   - ⌥⌘M (Ctrl+Alt+M) "Start notes" while a meeting prompt is up (Task 18).

   Are those combinations acceptable?
4. *(Resolved by the D2 clarification, 7f31ece.)* **Linux without notification actions (Task 16).** Stop appears where the server advertises `actions`. Elsewhere, the persistent notification shows without actions, and a click reveals the pill with Stop. The tray Stop is always there. Open point: such servers may ignore the click (see "For the spec owner" above).
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

If `routes.ts` or Plan 02's module is missing, the dependency has not merged. Stop and report. Check that `src/stores/sealedStore.ts` exists (Plan 03, §5.4). If Plan 07's `window.electronAPI.privacy` is absent, nothing breaks: disclosure falls back to `dispatched` evidence, and Undo's Sealed pre-check reads Plan 03's `getSealed()` (main still enforces Sealed mode once Plan 07 ships).

**Merge order with 05, 06 and 07 (§3).** These four plans run in parallel after Plan 03, and whichever merges second wires the shared contract. Each meeting point names both orders in its task:
- the Undo bridge with 05 (Task 9);
- the disclosure, pre-flight and notices with 07 (Tasks 4, 5, 7, 8, 10, 11);
- the capture status bridge with 06 (Task 9).

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
  - Linux adds a tray recording state, with Stop in the tray menu, and a persistent notification. Stop appears in it where the server advertises `actions` (`GetCapabilities`). Elsewhere, or when publishing fails, it shows without actions, and a click reveals the pill with Stop (D2 clarification, 7f31ece).
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
  - functional deadlines: the undo countdown and the pill's footprint grow, whose duration JS also reads.

  The picked choreography beats are shared tokens, not literals (CCR-8): `--motion-condense-fly` (140 ms), `--motion-condense-land` (220 ms), `--motion-rewrite-underline` (600 ms), `--motion-bounce` (640 ms, with `--motion-spring-bounce`) and `--motion-nudge` (260 ms).

  Ambient loops (breathe, dot pulse) may use `ease-in-out`, per the audit §4.1 mapping. Every loop is gated to its active state. Reduced motion keeps opacity and colour and drops transforms. No `cubic-bezier(0.4, 0, 1, 1)`.
- Every visible string goes through i18n, with keys in all 11 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`), including every CLDR plural category `i18n:check` asks for. `npm run i18n:check` passes.
- Use logical properties for RTL. The exception is anchors that track the pill's physical screen dock (`data-direction` / `horizontalDirection`): the pill notice stack, the pill caption and the pill tooltip stay physical.
- Tests: `npm run native:node` once, then `npm test -- <files>`. Run `npm run native:electron` before launching the app. Never use personal profiles, and never mutate the host system (uninstalling binaries, for example), in tests or verification.
- Before the PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`, `npm run format:check`.
- `--shadow-card` and `--shadow-elevated` exist only under `.dark`. Every `box-shadow` that uses them carries a light fallback.
- DESIGN.md is the source of truth (D10). Each task that changes a documented surface updates DESIGN.md in the same commit.

## Review Focus

These are the six failure modes most likely to bite a person, each pinned by a test in the owning task.

1. **Settings change during the undo window.** The user switches STT from local to OpenAI, then presses ⌥Z. They expect the restored dictation to stay on the device. Pinned in Task 8 (`audioManagerCancelBuffer.test.js`, "Undo restores through the session's route even after settings move to a provider") and Task 6 (`audioManagerSessionRoute.test.js`, "audio recorded on-device stays on-device…", "provider A stays provider A…").
2. **Cancel after a microphone change, retention off.** Two recorded segments, then Esc. They expect nothing on disk, temp files included, and every byte zeroed when the window closes. Pinned in Task 8 ("two segments, retention off: no merge, no write, every byte zeroed (C1)", "bytes that arrive after the buffer was zeroed are zeroed on arrival (I1)").
3. **Undo, then Esc, then a new dictation.** They expect Esc to cancel the restored processing, and a new hotkey press during a pending restore not to start a second pipeline. Pinned in Task 8 ("Undo is claimed synchronously…", "Esc while a restore waits for its bytes cancels it and puts the recording back (I3)") and Task 9 ("Esc is owned by the lifecycle…, including an Undo-started processing phase").
4. **⌥Z or ⌥↵ leaking after the affordance is gone.** This includes a renderer reload and a backend that answers late. They expect the shortcut back in other apps. Pinned in Task 2 (`hotkeyLeases.test.js`, "released while registration is pending…", "the owner's renderer going away releases every lease it holds") and Task 9 ("⌥Z is leased while a window is open and released when it closes").
5. **Two failed deliveries in a row, with history and the clipboard unavailable.** They expect both transcripts to stay recoverable, even after a successful third dictation. Pinned in Task 4 ("two failed deliveries…") and Task 1's store tests (words are never evicted or replaced).
6. **The control panel crashes mid-meeting.** They expect the pill to stop showing a timer and to say the recorder stopped unexpectedly, never "Meeting saved". Pinned in Task 16 (`meetingPresence.test.js`, "presence clears when the owner goes away, and that is reported as ownerLost, never saved"; `meetingStopOutcome.test.js`, "a failed transcript write is a failed outcome…") and Task 17 ("the pill never announces 'saved' because presence vanished").

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/components/ui/notices.ts` | Notice store and `notify()` (§5.3, CCR-4) | 1 |
| `src/helpers/hotkeyLeases.js`, `src/hooks/usePillHotkey.ts` | Main-owned temporary shortcuts | 2 |
| `src/components/ui/NoticeStack.tsx`, `NoticeChip.tsx`, `WordsFirstCard.tsx`, `src/styles/notices.css`, `src/utils/writeClipboardText.ts`, `test/lib/clickableTree.js` | R14 B chips with "More", R6 B card, honest Copy | 3 |
| `src/components/voiceNotices.ts`, `src/helpers/retryDictationCleanup.js`, `src/utils/settingsDeepLink.ts`, `src/helpers/settingsLinks.js`, `*NoticeListener.tsx` | VO-Q7, VO-Q21, the acknowledged Settings deep link | 4 |
| Toast removal | Finish the §5.3 migration | 5 |
| `src/helpers/dictationSession.js` | Route snapshot, correlation id, the Agent operation and the press-time context per recording | 6 |
| `src/types/dictation.ts`, `src/helpers/dictationDisclosure.js` | Shared §5.2 types; attested or dispatched disclosure from main's hand-off | 7 |
| `src/helpers/cancelBuffer.js` (+ `audioManager.js`) | RAM-only cancel buffer and same-route Undo (D3) | 8 |
| `src/helpers/rendererRequest.js`, `src/helpers/quitCoordinator.js`, `src/hooks/useAudioRecording.js`, `src/hooks/useUndoCancelHotkey.ts`, `main.js` | §5.2 lifecycle, Esc ownership, Undo bridge, coordinated quit flush | 9 |
| `src/helpers/voicePillPresentation.js` | Stage, footprint and ownership model; VO-Q5, Q12, Q18 | 10 |
| `VoicePill.tsx`, `pillLocality.ts`, `PillCaption.tsx`, `useRecentOutcome.ts`, `usePillAutoHide.js` | Condensation pill, locality ring, undo capsule, ordered auto-hide | 11 |
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

Covers §5.3 (the logic half) and VO-R14 B (lifetimes, cap, stagger). It also closes review findings I10 (a replaced notice is never dismissed by the action that replaced it), I13 (`words` only on alerts, and never expiring), M2 (removal reasons, each delivered exactly once) and the store half of R2-C3 (recovered words never leave on their own, and the cap never hides them for good).

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
  export function visibleNotices(list: readonly Notice[], max?: number): Notice[]; // newest `max` (default 3) notices without words
  export function wordsNotices(list: readonly Notice[]): Notice[];                 // every notice that carries words, in list order
  export function wordsCardNotice(list: readonly Notice[]): Notice | null;         // the last of those: the card on screen
  export function noticeLayout(list: readonly Notice[], placement: "pill" | "panel"): { card: Notice | null; moreWords: number; chips: Notice[] };
  export function raiseNotice(id: string): void;                                   // move to the newest position; no revision bump, no onDismiss
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
  - Recovered words leave the store only when the user dismisses them or an action removes them (R2-C3):
    - they never get a timer, and eviction never picks them;
    - `dismissNotice(id, "timeout" | "evicted" | "replaced")` is ignored for a notice that carries words;
    - a same-id update without words keeps the earlier words (for example, a status line about a retry);
    - different words under an id that already holds words never overwrite them. The new words get a fresh id, `<id>~<n>`, which `notify()` returns.
  - Callers give each content notice its own id, and give a status notice a stable id that the next status replaces. Task 4 uses `dictation-recovery:<sessionId>` and `dictation-error`.
  - At most three notices are visible (§5.3). `noticeLayout` decides which:
    - the words card counts as one. In the 168px pill slot it fills the space, and chips wait behind it;
    - held words beyond the card are counted in `moreWords`. The card's "N more" control calls `raiseNotice` on the oldest of them, so every transcript stays reachable;
    - chips over the cap either expire (they are evicted oldest first) or wait, when persistent.

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

test("recovered words are never evicted, however many arrive (R2-C3)", async (t) => {
  const { m } = await fresh(t);
  const reasons = [];
  for (const words of ["one", "two", "three", "four"]) {
    m.notify({ id: `dictation-recovery:${words}`, kind: "alert", title: "Couldn't paste", words, onDismiss: (r) => reasons.push(r) });
  }
  m.notify({ kind: "receipt", title: "Pasted" });
  m.notify({ kind: "receipt", title: "Copied" });
  assert.deepEqual(m.wordsNotices(m.getNotices()).map((n) => n.words), ["one", "two", "three", "four"]);
  assert.deepEqual(reasons, []);
});

test("only the user or an action removes words; automatic reasons are ignored (R2-C3)", async (t) => {
  const { m } = await fresh(t);
  const id = m.notify({ id: "dictation-recovery:rec-1", kind: "alert", title: "Couldn't paste", words: "keep me" });
  for (const reason of ["timeout", "evicted", "replaced"]) m.dismissNotice(id, reason);
  assert.equal(m.getNotices().length, 1);
  m.dismissNotice(id, "action");
  assert.equal(m.getNotices().length, 0);
});

test("a status update under a words id keeps the words (R2-C3)", async (t) => {
  const { m } = await fresh(t);
  const id = m.notify({ id: "dictation-recovery:rec-1", kind: "alert", title: "Couldn't paste", words: "keep me" });
  m.notify({ id, kind: "notice", title: "Still couldn't paste" });
  const [n] = m.getNotices();
  assert.deepEqual([n.title, n.kind, n.words, n.expiresAt, n.revision], ["Still couldn't paste", "alert", "keep me", null, 2]);
});

test("different words under one id never overwrite the earlier words (R2-C3)", async (t) => {
  const { m } = await fresh(t);
  const first = m.notify({ id: "dictation-recovery:x", kind: "alert", title: "A", words: "first" });
  const second = m.notify({ id: "dictation-recovery:x", kind: "alert", title: "B", words: "second" });
  assert.notEqual(second, first);
  assert.deepEqual(m.wordsNotices(m.getNotices()).map((n) => [n.id, n.words]), [[first, "first"], [second, "second"]]);
});

test("at most three are visible; held words beyond the card are counted and can be raised", async (t) => {
  const { m } = await fresh(t);
  const a = m.notify({ id: "dictation-recovery:a", kind: "alert", title: "A", words: "first" });
  m.notify({ id: "dictation-recovery:b", kind: "alert", title: "B", words: "second" });
  for (const title of ["x", "y", "z"]) m.notify({ kind: "notice", title, persistent: true });

  const pill = m.noticeLayout(m.getNotices(), "pill");
  assert.equal(pill.card.words, "second");
  assert.equal(pill.moreWords, 1);
  assert.deepEqual(pill.chips, []);
  const panel = m.noticeLayout(m.getNotices(), "panel");
  assert.equal(panel.card.words, "second");
  assert.deepEqual(panel.chips.map((n) => n.title), ["y", "z"]); // card + two chips = three

  m.raiseNotice(a);
  assert.equal(m.noticeLayout(m.getNotices(), "pill").card.words, "first");
  assert.equal(m.getNotices().find((n) => n.id === a).revision, 1, "raising is not a new revision");
  assert.equal(m.getNotices().length, 5, "nothing was dropped");
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
  let input = normalize(raw);
  let id = input.id ?? `notice-${++seq}`;
  // Recovered words leave only when the user or an action removes them (R2-C3).
  const held = notices.find((n) => n.id === id && n.words);
  if (held && !input.words) {
    // A status update about held words keeps them.
    input = { ...input, kind: "alert", words: held.words } as NoticeInput;
  } else if (held && input.words !== held.words) {
    // Different words never overwrite: the new words get their own notice.
    id = `${id}~${++seq}`;
  }
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
  // notices and recovered words (expiresAt null) are never picked: they wait,
  // and noticeLayout decides what shows.
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

/** Reasons the store gives on its own. None of them may remove recovered words. */
const AUTOMATIC_REMOVALS: ReadonlySet<NoticeRemoval> = new Set(["timeout", "evicted", "replaced"]);

export function dismissNotice(id: string, reason: NoticeRemoval = "user"): void {
  const target = notices.find((n) => n.id === id);
  if (!target) return;
  if (target.words && AUTOMATIC_REMOVALS.has(reason)) return;
  remove(target, reason);
}

/** Move a notice to the newest position, e.g. the card's "N more". No revision bump, no onDismiss. */
export function raiseNotice(id: string): void {
  const target = notices.find((n) => n.id === id);
  if (!target || notices[notices.length - 1] === target) return;
  emit([...notices.filter((n) => n !== target), target]);
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

/** The newest `max` chips. A notice that carries words is the card, never a chip. */
export function visibleNotices(list: readonly Notice[], max = NOTICE_MAX_VISIBLE): Notice[] {
  return max > 0 ? list.filter((n) => !n.words).slice(-max) : [];
}

export function wordsNotices(list: readonly Notice[]): Notice[] {
  return list.filter((n) => !!n.words);
}

/** The card on screen: the newest words notice. `raiseNotice` changes which one that is. */
export function wordsCardNotice(list: readonly Notice[]): Notice | null {
  const held = wordsNotices(list);
  return held.length ? held[held.length - 1] : null;
}

/**
 * §5.3: at most three notices are visible, and the card counts as one. In the
 * 168px pill slot the card fills the space, so chips wait behind it. Held
 * words beyond the card are counted, never dropped; the card's "N more"
 * control raises the oldest of them (R2-C3).
 */
export function noticeLayout(
  list: readonly Notice[],
  placement: "pill" | "panel"
): { card: Notice | null; moreWords: number; chips: Notice[] } {
  const card = wordsCardNotice(list);
  const slots = !card ? NOTICE_MAX_VISIBLE : placement === "pill" ? 0 : NOTICE_MAX_VISIBLE - 1;
  return {
    card,
    moreWords: card ? wordsNotices(list).length - 1 : 0,
    chips: visibleNotices(list, slots),
  };
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

  Main-process code such as the meeting prompt (Task 18) acquires with its own owner per prompt, `ownerId: "main:meeting-prompt:<generation>"`, and releases it with the prompt's lifetime.
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

Covers VO-R14 B and VO-R6 B (the card), and carries Plan 02's VO-Q9 rules forward. Also closes:
- I11: every action stays reachable, because a chip with more than one action gets an accessible "More" disclosure;
- R2-I3: Copy says "Copied" only when a clipboard confirmed the write. Otherwise it shows a failure and the words stay;
- the visible half of R2-C3: every held transcript stays reachable through the card's "N more" control.

**Files:**
- Create: `src/components/ui/NoticeChip.tsx`
- Create: `src/components/ui/WordsFirstCard.tsx`
- Create: `src/components/ui/NoticeStack.tsx`
- Create: `src/utils/writeClipboardText.ts`. The one clipboard write that reports real success.
- Modify: `src/hooks/useCopyFeedback.ts:40-57`. `copyText` delegates to `writeClipboardText`, which closes the same absent-API gap for every existing Copy button.
- Create: `test/lib/clickableTree.js`. Move `installTree` from `test/components/onboardingCleanupWiring.test.js:14-99` here, and make that test import it.
- Create: `src/styles/notices.css`. Add `@import "./styles/notices.css";` to `src/index.css`, directly after `@import "./styles/dictation-panel.css";` at line 3.
- Modify: `src/utils/windowSizeLadder.js`
- Modify: `src/helpers/windowConfig.js:139-157` (add `WITH_NOTICES`)
- Modify: `src/hooks/useMainWindowSizeOwner.js`. Rename the inputs `toastCount` and `dictationErrorActionCount` to `noticeCount` and `wordsCardVisible`.
- Modify: `src/App.jsx`. Mount the pill stack and feed the ladder.
- Modify: `src/AppRouter.jsx:64-78`. Mount the panel stack in the control-panel branch, so it covers both onboarding and the main view.
- Modify: `src/locales/*/translation.json`. Add a top-level `"notices"` object.
- Modify: `DESIGN.md`. Add a `### Notices` section after `### Voice Pill`.
- Test: `test/components/noticeStack.test.js`
- Test: `test/components/wordsCardActions.test.js`. Clicks the real buttons.
- Test: `test/helpers/windowSizeLadder.test.js`. This file already exists; update it in Step 1.

**Interfaces:**
- Consumes everything from Task 1, and `usePillHotkey` (Task 2).
- Produces:

  ```tsx
  export function NoticeStack(props: { placement: "pill" | "panel"; horizontalDirection?: "left" | "right"; primaryHotkeyLabel?: string | null }): JSX.Element | null;
  export function NoticeChip(props: { notice: Notice; stagger: number; defaultExpanded?: boolean }): JSX.Element;
  export function WordsFirstCard(props: {
    notice: Notice; onHeight?: (px: number) => void; hotkeyLabel?: string | null;
    moreCount?: number; onShowMore?: () => void;   // "N more": other held transcripts (R2-C3)
  }): JSX.Element;
  export function useNoticeWindowState(): { noticeCount: number; wordsCardVisible: boolean };
  ```

  ```ts
  // src/utils/writeClipboardText.ts
  export function writeClipboardText(text: string): Promise<boolean>; // true only when a clipboard confirmed the write
  ```

  ```js
  // test/lib/clickableTree.js
  installClickableTree(): { container; click(label): Promise<void>; clickNode(node): Promise<void>; find(predicate): node | null; text(): string };
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
      id: "dictation-recovery:rec-1",
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

  m.notify({ id: "dictation-recovery:rec-1", kind: "alert", title: "Couldn't paste", words: "keep me" });
  const pill = renderStatic(NoticeStack, { placement: "pill", horizontalDirection: "right" });
  assert.match(pill, /class="words-card"/);
  // In the 168px pill slot the card owns the space; chips wait until it is dismissed.
  assert.equal((pill.match(/class="notice-chip"/g) || []).length, 0);
  const panel = renderStatic(NoticeStack, { placement: "panel" });
  assert.match(panel, /class="words-card"/);
  // §5.3: at most three visible. The card counts as one.
  assert.equal((panel.match(/class="notice-chip"/g) || []).length, 2);
  assert.doesNotMatch(panel, /class="words-card__more"/, "one held transcript needs no 'N more'");
});

test("chip CSS uses the motion tokens and no ease-in", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/notices.css"), "utf8");
  assert.match(css, /animation:\s*notice-in var\(--motion-base\) var\(--motion-ease-enter\)/);
  assert.match(css, /animation-delay:\s*calc\(var\(--notice-stagger\) \* 40ms\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.notice-chip[\s\S]*transform:\s*none/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.words-card \{\s*\/\*[^*]*\*\/\s*animation: notice-fade var\(--motion-fast\) linear both !important;/, "the fade survives index.css's global cut");
});

```

Create `test/lib/clickableTree.js`. The body is `installTree` from `test/components/onboardingCleanupWiring.test.js:14-99`, moved verbatim, with three additions:
- `nodeValue` on text nodes, because React updates mixed text through it;
- `getBoundingClientRect`, because the card measures itself;
- `find` and `clickNode`. `clickNode` lets a handler's voided promise settle inside `act`.

```js
// A tiny element tree for mounting real components with react-dom's
// createRoot under Node. The shared fake DOM has no events, so tests invoke the
// onClick handlers React stored on the nodes. Call installBrowserGlobals and
// installHookDom first.
const assert = require("node:assert/strict");
const React = require("react");

function installClickableTree() {
  const document = globalThis.document;
  const make = (nodeType, props) => {
    const node = {
      nodeType,
      ownerDocument: document,
      style: {},
      childNodes: [],
      parentNode: null,
      appendChild(child) {
        node.insertBefore(child, null);
        return child;
      },
      insertBefore(child, before) {
        if (child.parentNode) child.parentNode.removeChild(child);
        const index = before ? node.childNodes.indexOf(before) : -1;
        child.parentNode = node;
        if (index < 0) node.childNodes.push(child);
        else node.childNodes.splice(index, 0, child);
        return child;
      },
      removeChild(child) {
        const index = node.childNodes.indexOf(child);
        if (index >= 0) node.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      get firstChild() {
        return node.childNodes[0] ?? null;
      },
      get nextSibling() {
        const siblings = node.parentNode?.childNodes ?? [];
        return siblings[siblings.indexOf(node) + 1] ?? null;
      },
      get textContent() {
        return node.nodeType === 3 ? node.data : node.childNodes.map((c) => c.textContent).join("");
      },
      set textContent(value) {
        node.childNodes = [];
        if (value) node.appendChild(make(3, { nodeName: "#text", data: String(value) }));
      },
      get nodeValue() {
        return node.nodeType === 3 ? node.data : null;
      },
      set nodeValue(value) {
        if (node.nodeType === 3) node.data = String(value);
      },
      getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      attributes: {},
      setAttribute(name, value) {
        node.attributes[name] = String(value);
      },
      removeAttribute(name) {
        delete node.attributes[name];
      },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      querySelector: () => null,
      ...props,
    };
    return node;
  };
  document.createElement = (tag) =>
    make(1, {
      nodeName: tag.toUpperCase(),
      tagName: tag.toUpperCase(),
      namespaceURI: "http://www.w3.org/1999/xhtml",
    });
  document.createElementNS = (namespaceURI, tag) =>
    make(1, { nodeName: tag, tagName: tag, namespaceURI });
  document.createTextNode = (data) => make(3, { nodeName: "#text", data });
  const container = make(1, { nodeName: "DIV", tagName: "DIV" });
  const walk = (node, visit) => {
    visit(node);
    for (const child of node.childNodes) walk(child, visit);
  };
  const find = (predicate) => {
    let found = null;
    walk(container, (node) => {
      if (!found && predicate(node)) found = node;
    });
    return found;
  };
  const click = async (label) => {
    let target = null;
    walk(container, (node) => {
      if (target || node.tagName !== "BUTTON") return;
      if (node.textContent.includes(label)) target = node;
    });
    assert.ok(target, `button containing "${label}" is rendered`);
    const key = Object.keys(target).find((name) => name.startsWith("__reactProps$"));
    await React.act(async () => {
      // The handler returns the pending check; awaiting it would deadlock the test.
      void target[key].onClick();
    });
  };
  // For handlers that void an async operation (a clipboard write): click, then
  // let that promise chain settle before act flushes.
  const clickNode = async (target) => {
    assert.ok(target, "the button is rendered");
    const key = Object.keys(target).find((name) => name.startsWith("__reactProps$"));
    await React.act(async () => {
      void target[key].onClick();
      await new Promise((resolve) => setImmediate(resolve));
    });
  };
  const text = () => container.textContent;
  return { container, click, clickNode, find, text };
}

module.exports = { installClickableTree };
```

In `test/components/onboardingCleanupWiring.test.js`, delete lines 14–99 and add `const { installClickableTree: installTree } = require("../lib/clickableTree");` under the existing requires. Nothing else in that file changes.

Create `test/components/wordsCardActions.test.js`. It mounts the real `NoticeStack` over the real notice store, and clicks the real buttons:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { installClickableTree } = require("../lib/clickableTree");

const TRANSLATION_SOURCE = `
const t = (key, options) => (options && "count" in options ? key + ":" + options.count : key);
export const useTranslation = () => ({ t });
`;

const WORDS = "Hey Maya, can you move the design review to Thursday at 2?";

async function mountStack(t, { electronAPI = {}, webClipboard } = {}) {
  // Registered first, so it runs before the globals it needs are restored.
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI } });
  installHookDom(t);
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: webClipboard ? { clipboard: webClipboard } : {},
    configurable: true,
    writable: true,
  });
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });
  const tree = installClickableTree();
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-words-card-actions-",
    noExternal: ["react-i18next"],
    mockModules: { "react-i18next": TRANSLATION_SOURCE },
  });
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  t.after(() => notices.__setNoticeClockForTests());
  const { NoticeStack } = await vite.ssrLoadModule("/components/ui/NoticeStack.tsx");
  root = createRoot(tree.container);
  const render = () => React.act(async () => root.render(React.createElement(NoticeStack, { placement: "panel" })));
  const copyButton = () => tree.find((node) => node.tagName === "BUTTON" && "data-copy" in node.attributes);
  return { ...tree, notices, render, copyButton };
}

const showCard = (notices) =>
  notices.notify({ id: "dictation-recovery:rec-1", kind: "alert", title: "Couldn't paste into Slack", words: WORDS });

for (const [label, electronAPI, webClipboard] of [
  ["the bridge rejects and there is no web clipboard", { writeClipboard: async () => { throw new Error("denied"); } }, undefined],
  ["the bridge returns { success: false }", { writeClipboard: async () => ({ success: false }) }, undefined],
  ["there is no bridge and no web clipboard (Browser Preview)", {}, undefined],
  ["the bridge fails and the web clipboard rejects too", { writeClipboard: async () => ({ success: false }) }, { writeText: async () => { throw new Error("Document is not focused"); } }],
]) {
  test(`Copy shows a failure and keeps the words when ${label} (R2-I3)`, async (t) => {
    const stack = await mountStack(t, { electronAPI, webClipboard });
    showCard(stack.notices);
    await stack.render();
    await stack.clickNode(stack.copyButton());
    assert.equal(stack.copyButton().attributes["data-copy-state"], "failed");
    assert.match(stack.text(), /notices\.wordsCard\.copyFailedHint/);
    assert.doesNotMatch(stack.text(), /notices\.wordsCard\.copied/);
    assert.equal(stack.notices.getNotices()[0].words, WORDS, "the words stay in the store");
    assert.match(stack.text(), /Hey Maya, can you move the design review/, "and on screen");
  });
}

test("Copy without a bridge uses the web Clipboard API, and says Copied only after it resolves", async (t) => {
  const writes = [];
  const stack = await mountStack(t, { electronAPI: {}, webClipboard: { writeText: async (text) => { writes.push(text); } } });
  showCard(stack.notices);
  await stack.render();
  await stack.clickNode(stack.copyButton());
  assert.deepEqual(writes, [WORDS]);
  assert.equal(stack.copyButton().attributes["data-copy-state"], "copied");
});

test("Copy through the bridge confirms on { success: true } and keeps the card", async (t) => {
  const writes = [];
  const stack = await mountStack(t, {
    electronAPI: { writeClipboard: async (text) => { writes.push(text); return { success: true }; } },
  });
  showCard(stack.notices);
  await stack.render();
  await stack.clickNode(stack.copyButton());
  assert.deepEqual(writes, [WORDS]);
  assert.equal(stack.copyButton().attributes["data-copy-state"], "copied");
  assert.match(stack.text(), /notices\.wordsCard\.copied/);
  assert.equal(stack.notices.getNotices().length, 1, "copying is not discarding");
});

test("'N more' cycles through every held transcript (R2-C3)", async (t) => {
  const stack = await mountStack(t);
  stack.notices.notify({ id: "dictation-recovery:rec-1", kind: "alert", title: "A", words: "first words" });
  stack.notices.notify({ id: "dictation-recovery:rec-2", kind: "alert", title: "B", words: "second words" });
  await stack.render();
  assert.match(stack.text(), /second words/);
  await stack.click("notices.wordsCard.more:1");
  assert.match(stack.text(), /first words/);
  assert.doesNotMatch(stack.text(), /second words/);
  await stack.click("notices.wordsCard.more:1");
  assert.match(stack.text(), /second words/);
  assert.equal(stack.notices.wordsNotices(stack.notices.getNotices()).length, 2, "cycling drops nothing");
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

Run: `npm test -- test/components/noticeStack.test.js test/components/wordsCardActions.test.js test/helpers/windowSizeLadder.test.js`
Expected: FAIL. `NoticeChip.tsx` and `NoticeStack.tsx` are not found, and `resolveMainWindowSizeKey({ noticeCount: 1 })` returns `"BASE"`.

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

`src/utils/writeClipboardText.ts`:

```ts
/**
 * Writes text to the clipboard and reports whether it really landed (R2-I3).
 * The Electron bridge must answer `{ success: true }`. A rejection, a
 * `{ success: false }`, or no bridge at all (Browser Preview supplies only a
 * subset of the API) falls back to the web Clipboard API where it exists.
 * Never reports a copy it cannot see.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  const bridge = globalThis.window?.electronAPI?.writeClipboard;
  if (typeof bridge === "function") {
    try {
      const result = await bridge(text);
      if (result?.success === true) return true;
    } catch {
      // Fall through to the web Clipboard API.
    }
  }
  const web = globalThis.navigator?.clipboard;
  if (typeof web?.writeText !== "function") return false;
  try {
    await web.writeText(text);
    return true;
  } catch {
    return false;
  }
}
```

In `src/hooks/useCopyFeedback.ts`, replace the body of `copyText` (lines 40–57, keep the comment) with the helper. Today a missing bridge returns `undefined`, which passes the `result?.success === false` check and claims success:

```ts
  // Writes without touching the copied state: the shared feedback belongs to
  // the full-text copy, not to a partial selection.
  const copyText = useCallback((textToCopy: string) => writeClipboardText(textToCopy), []);
```

Add `import { writeClipboardText } from "../utils/writeClipboardText";`. The existing callers (`TechnicalErrorDetails`, `Toast`, `LiveTranscriptPanel`, `AssistantPanel`) keep their behaviour when the bridge works, and stop reporting a copy that never happened when it does not.

`src/components/ui/WordsFirstCard.tsx`:

```tsx
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "../icons";
import { Button } from "./button";
import { useCopyFeedback } from "../../hooks/useCopyFeedback";
import { dismissNotice, runNoticeAction, type Notice } from "./notices";

/**
 * VO-R6 B: the card *is* the transcript. The error is a one-line chip above
 * the recovered words; the words are selectable and draggable straight into
 * the target field. Primary actions use the ink Button (D1: orange is for
 * voice controls only). Only Dismiss, or an action that delivered the words,
 * removes the card; Copy never does.
 */
export function WordsFirstCard({
  notice,
  onHeight,
  hotkeyLabel = null,
  moreCount = 0,
  onShowMore,
}: {
  notice: Notice;
  onHeight?: (px: number) => void;
  hotkeyLabel?: string | null;
  moreCount?: number;
  onShowMore?: () => void;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLElement>(null);
  const words = notice.words ?? "";
  // "Copied" only after a clipboard confirmed the write (R2-I3).
  const { copied, copyText, confirmCopied } = useCopyFeedback(words, { resetMs: 1200 });
  const [copyFailed, setCopyFailed] = useState(false);

  useLayoutEffect(() => {
    if (rootRef.current && onHeight) onHeight(Math.ceil(rootRef.current.getBoundingClientRect().height));
  }, [words, notice.title, copyFailed, moreCount, onHeight]);

  const copy = async () => {
    const ok = await copyText(words);
    setCopyFailed(!ok);
    if (ok) confirmCopied(words);
  };
  const copyState = copyFailed ? "failed" : copied ? "copied" : "idle";

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
        <Button size="sm" variant="outline" data-copy="" data-copy-state={copyState} onClick={() => void copy()}>
          {copyState === "failed"
            ? t("notices.wordsCard.copyFailed")
            : copyState === "copied"
              ? t("notices.wordsCard.copied")
              : t("notices.wordsCard.copy")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissNotice(notice.id)}>
          {t("notices.dismiss")}
        </Button>
      </div>
      {copyFailed ? <p className="words-card__copy-failed">{t("notices.wordsCard.copyFailedHint")}</p> : null}
      {moreCount > 0 && onShowMore ? (
        <button type="button" className="words-card__more" onClick={onShowMore}>
          {t("notices.wordsCard.more", { count: moreCount })}
        </button>
      ) : null}
      <p className="words-card__hint">{t("notices.wordsCard.hint")}</p>
    </section>
  );
}
```

The card sits inside `role="alert"`, so the failure hint is announced without its own live region.

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
import { noticeLayout, raiseNotice, staggerIndex, useNotices, wordsNotices } from "./notices";

export function useNoticeWindowState(): { noticeCount: number; wordsCardVisible: boolean } {
  const list = useNotices();
  const wordsCardVisible = list.some((n) => !!n.words);
  return { noticeCount: list.filter((n) => !n.words).length, wordsCardVisible };
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
  // §5.3: at most three visible, the card counting as one. In the 168px pill
  // slot the card fills the space and chips queue behind it. Other held
  // transcripts are one "N more" press away, never dropped (R2-C3).
  const { card, moreWords, chips } = noticeLayout(list, placement);
  const showMore = useCallback(() => {
    const oldest = wordsNotices(list)[0];
    if (oldest) raiseNotice(oldest.id);
  }, [list]);
  const reportHeight = useCallback(
    (px: number) => {
      if (placement === "pill") void window.electronAPI?.resizeDictationErrorWindowToContent?.(px);
    },
    [placement]
  );
  if (!card && chips.length === 0) return null;
  return (
    <div className="notice-stack" data-placement={placement} data-direction={horizontalDirection}>
      {card ? (
        <WordsFirstCard
          key={card.id}
          notice={card}
          onHeight={reportHeight}
          hotkeyLabel={primaryHotkeyLabel}
          moreCount={moreWords}
          onShowMore={showMore}
        />
      ) : null}
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
.words-card__copy-failed {
  margin-top: 7px;
  font: 600 12px/1.3 var(--font-family-sans);
  color: var(--color-destructive);
}
.words-card__more {
  margin-top: 7px;
  height: 22px;
  padding-inline: 8px;
  border-radius: 999px;
  color: var(--color-popover-foreground);
  background: color-mix(in oklch, var(--color-foreground) 8%, transparent);
  font: 600 11px/1 var(--font-family-sans);
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
    /* !important: index.css cuts every animation to 0.01ms under reduced motion; the fade must survive. */
    animation: notice-fade var(--motion-fast) linear both !important;
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
           // The card on screen, the same one NoticeStack shows (Task 1's noticeLayout).
           const card = wordsCardNotice(getNotices());
           const primary = card?.actions?.find((a) => a.primary);
           if (card && primary) void runNoticeAction(card.id, primary);
         },
         { ttlMs: 60_000 }
       );
     ```

     Import `getNotices`, `runNoticeAction` and `wordsCardNotice` from `./components/ui/notices`. Pass `primaryHotkeyLabel={noticeHotkey.held ? (getCachedPlatform() === "darwin" ? "⌥↵" : "Alt+Enter") : null}` to `<NoticeStack placement="pill" …>`. `getCachedPlatform` comes from `src/utils/platform.ts`.
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
    "copyFailed": "Couldn't copy",
    "copyFailedHint": "The clipboard didn't take it. Your words are still here: select or drag them.",
    "more_one": "{{count}} more unsent",
    "more_other": "{{count}} more unsent",
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

An alert that carries recovered words renders the **words-first card**: the transcript is the headline, selectable and draggable; the error is a one-line chip above it; primary is "Paste again" (⌥↵). Primaries use the ink button, never orange. Close is always visible. Copy says "Copied" only when the clipboard confirmed it, and "Couldn't copy" otherwise. Words leave only through Dismiss or a delivered Paste again; each failed dictation keeps its own card, and "N more" shows the others. Motion: enter `--motion-base --motion-ease-enter`, 8 px rise, 40 ms stagger for bursts; reduced motion fades only.
```

- [ ] **Step 6: Keep the card-height regression**

`test/helpers/voiceSurfaceGeometry.test.js:84-152` pins how the dictation-error card reports its measured height so the native window grows to fit it. Port those cases to `WordsFirstCard`. Its `onHeight` must call `resizeDictationErrorWindowToContent` with the card's measured height, and `fitDictationErrorContentWindowToWorkArea` still clamps it. Keep every existing expectation and change only the component under test.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- test/components/noticeStack.test.js test/components/wordsCardActions.test.js test/components/onboardingCleanupWiring.test.js test/helpers/assistantPanel.test.js test/helpers/windowSizeLadder.test.js test/helpers/voiceSurfaceGeometry.test.js test/hooks/dictationErrorAutoHide.test.js test/helpers/voicePillPresentation.test.js`
Expected: PASS. `onboardingCleanupWiring` proves the moved tree helper, and `assistantPanel` covers the existing `useCopyFeedback` callers.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/NoticeChip.tsx src/components/ui/WordsFirstCard.tsx src/components/ui/NoticeStack.tsx src/utils/writeClipboardText.ts src/hooks/useCopyFeedback.ts src/styles/notices.css src/index.css src/utils/windowSizeLadder.js src/helpers/windowConfig.js src/hooks/useMainWindowSizeOwner.js src/App.jsx src/AppRouter.jsx src/helpers/voicePillPresentation.js src/locales DESIGN.md test
git commit -m "feat(voice): pill-anchored notice chips and the words-first card"
```

---
### Task 4: Voice notices: cleanup, Tinfoil, dictation errors, meeting and main-process notices

Covers VO-Q7, VO-Q21 and VO-R6 B (wiring), plus the voice-side half of the §5.3 migration. It also closes these review findings:
- I12 (and its round-2 follow-up): the Settings action opens the route's actual section, even when the control panel is still loading or is reloading. Main holds the request until the panel's subscriber acknowledges it, and drops it after 15 s;
- I10: a failed Retry cleanup leaves its explanation on screen. This is pinned end to end against the real store;
- R2-C3: every failed dictation that holds content gets its own notice, `dictation-recovery:<sessionId>`. A later recording, error or success never removes it. Only a delivered Paste again or the user's Dismiss does. A failure without content keeps the stable `dictation-error` id, which the next status replaces and the next start or success clears.

**Files:**
- Create: `src/components/voiceNotices.ts`. Pure builders, so the listeners stay thin and testable.
- Create: `src/helpers/retryDictationCleanup.js`
- Rename (`git mv`): `src/components/CleanupFailureToastListener.tsx` becomes `src/components/CleanupFailureNoticeListener.tsx`
- Rename (`git mv`): `src/components/TinfoilModelSwitchToastListener.tsx` becomes `src/components/TinfoilModelSwitchNoticeListener.tsx`
- Rename (`git mv`): `src/components/GpuPackMigrationToastListener.tsx` becomes `src/components/GpuPackMigrationNoticeListener.tsx`
- Rename (`git mv`): `src/components/notes/BackgroundActionToastListener.tsx` becomes `src/components/notes/BackgroundActionNoticeListener.tsx`. Update its import in `ControlPanel.tsx:862`.
- Modify: `src/renderApp.jsx:6-8,33-35` (listener imports and mounts)
- Modify: `src/stores/cleanupFailureStore.ts:3-16`. Add `rawText?: string` to `CleanupFailure`.
- Modify: `src/hooks/useAudioRecording.js`. Change the signature, migrate every `toast(` call, and attach `rawText` at line 659. Give content-bearing errors per-session ids, and dismiss the status id itself at the start (`:190`) and success (`:454`) edges, in place of the `dismissDictationError` option (`:62`, `:241`, `:805`).
- Modify: `src/hooks/useMainProcessNotifications.tsx`. Change the signature to `({ t })` and migrate all four calls.
- Modify: `src/components/MeetingRecordingMount.tsx` (calls at 84, 101, 129, 178, 185, and the dismiss subscription at 150–159)
- Modify: `src/App.jsx`:
  - line 209: `useAudioRecording(toast, {` becomes `useAudioRecording({`
  - line 386: `refuse()`
  - lines 88–91 and 214: delete `dismissDictationError` and the option that passes it
  - lines 343–347: delete the recording-edge dismissal effect
  - the `useMainProcessNotifications` call
- Modify: `src/components/OnboardingFlow.tsx:747`
- Create: `src/helpers/settingsLinks.js`. The pending-request queue and its three IPC handlers.
- Modify: `src/helpers/windowManager.js`. Add `this.settingsLinks` in the constructor (line 48), and replace `openSettings()` (lines 2240–2245) with `openSettings(settingsPath?)`, which queues the request and returns its delivery result.
- Modify: `src/helpers/ipcHandlers.js`. Call `registerSettingsLinkIpc` after the `window-is-maximized` handler (lines 1176–1181).
- Modify: `preload.js` and `src/types/electron.ts`. Add `openSettingsAt`, `pendingSettingsLink` and `ackSettingsLink`, and widen `onShowSettings`. `src/preview/browserPreview.ts` stays as it is: Browser Preview has no main process, and optional desktop features stay absent there.
- Modify: `src/components/ControlPanel.tsx:284-289`. The subscriber becomes `subscribeSettingsDeepLinks`.
- Modify: `src/components/SettingsModal.tsx:111-114`. Re-apply `initialSection` when it changes while the modal is already open.
- Create: `src/utils/settingsDeepLink.ts`
- Test: `test/components/settingsDeepLink.test.js`
- Test: `test/helpers/settingsDeepLinkDelivery.test.js`. Real `WindowManager`, real IPC registration, real preload, real subscriber.
- Modify: the 6 hook tests that call `useAudioRecording(…, {…})` (listed in Step 5). `useAudioRecordingForceStop.test.js` also gains the R2-C3 regression.
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
  export const DICTATION_STATUS_NOTICE_ID = "dictation-error";             // a failure with no content: replaced and cleared
  export function dictationRecoveryNoticeId(sessionKey: string): string;  // "dictation-recovery:<sessionKey>": one per session
  export function buildDictationErrorNotice(
    // recoveryHeld: Plan 07 holds the audio. sessionKey: the session id, or a local key before Task 6.
    input: { title: string; description?: string; words?: string; recoveryHeld?: boolean; sessionKey: string },
    t: T,
    actions: { retry: () => void; pasteAgain: (words: string) => Promise<void>; extraActions?: NoticeAction[] }
  ): NoticeInput;
  // §5.3, Plan 07's recovery prompt after unsealing:
  export function buildSealedRecoveryNotice(t: T, actions: { transcribe: () => Promise<unknown>; discard: () => void }): NoticeInput;
  ```

  ```js
  // src/helpers/retryDictationCleanup.js
  export async function retryDictationCleanup(rawText, deps?): Promise<"cleaned" | "unchanged" | "failed">; // deps default loads lazily

  // src/helpers/settingsLinks.js (main)
  SETTINGS_LINK_TTL_MS = 15_000;
  createSettingsLinkQueue({ ttlMs?, timers? }): {
    enqueue(settingsPath): { link: { id: string; path: string | null }; done: Promise<SettingsLinkResult> };
    peek(): { id: string; path: string | null } | null;
    ack(id: string): boolean;
  };
  registerSettingsLinkIpc(ipcMain, windowManager): void; // "open-settings-at", "settings-link-pending", "settings-link-ack"
  // WindowManager
  settingsLinks;                                            // the queue
  openSettings(settingsPath?: string | null): Promise<SettingsLinkResult>;
  ```

  ```ts
  // src/utils/settingsDeepLink.ts
  export interface SettingsLink { id: string; path: string | null }
  export function parseSettingsDeepLink(payload: unknown): string | undefined;
  export function subscribeSettingsDeepLinks(api: SettingsLinkApi | undefined, open: (section: string | undefined) => void): () => void;

  // electronAPI
  type SettingsLinkResult = { delivered: true } | { delivered: false; reason: "timeout" | "replaced" };
  openSettingsAt?: (settingsPath: string) => Promise<SettingsLinkResult>;
  pendingSettingsLink?: () => Promise<SettingsLink | null>;   // control panel only
  ackSettingsLink?: (id: string) => Promise<boolean>;          // control panel only
  onShowSettings?: (callback: (link?: SettingsLink) => void) => () => void;
  ```

  `useAudioRecording(options)`: the `toast` parameter and the `dismissDictationError` option are removed. The hook owns the status notice's dismissal. `useMainProcessNotifications({ t })`.

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

test("a dictation error with recovered words becomes the words-first card, under its session's own id", async () => {
  const { buildDictationErrorNotice } = await load();
  const withWords = buildDictationErrorNotice(
    { title: "Couldn't paste into Slack", description: "couldn't reach app", words: "Hey Maya", sessionKey: "rec-1" },
    t,
    { retry: () => {}, pasteAgain: async () => {} }
  );
  assert.equal(withWords.kind, "alert");
  assert.equal(withWords.id, "dictation-recovery:rec-1");
  assert.equal(withWords.words, "Hey Maya");
  assert.equal(withWords.actions[0].label, "notices.actions.pasteAgain");
  assert.equal(withWords.actions[0].keepOpen, true);

  // No content: the stable status id, so the next status replaces it.
  const noWords = buildDictationErrorNotice(
    { title: "We didn't hear anything", sessionKey: "rec-2" },
    t,
    { retry: () => {}, pasteAgain: async () => {} }
  );
  assert.equal(noWords.id, "dictation-error");
  assert.equal(noWords.words, undefined);
  assert.equal(noWords.actions[0].label, "common.retry");
});

test("Plan 07's notices keep their §5.3 shapes", async () => {
  const { buildDictationErrorNotice, buildSealedRecoveryNotice } = await load();
  const transcribe = { label: "sealedMode.recovery.transcribe", onClick: () => {} };
  // A sealed refusal that holds audio in memory is an alert that never times out.
  const held = buildDictationErrorNotice(
    { title: "sealedMode.blocked.dictationPreflight", recoveryHeld: true, sessionKey: "rec-3" },
    t,
    { retry: () => {}, pasteAgain: async () => {}, extraActions: [transcribe] }
  );
  assert.equal(held.kind, "alert");
  assert.equal(held.persistent, true);
  // Held audio is content too: its own id, never the status id that a new start clears.
  assert.equal(held.id, "dictation-recovery:rec-3");
  assert.ok(held.actions.includes(transcribe), "Transcribe is reachable from the pill's notice slot");

  const recovery = buildSealedRecoveryNotice(t, { transcribe: async () => true, discard: () => {} });
  assert.equal(recovery.kind, "notice");
  assert.equal(recovery.persistent, true);
  assert.deepEqual(recovery.actions.map((a) => a.label), ["sealedMode.recovery.transcribe", "sealedMode.recovery.discard"]);
});

// `ctx`, not `t`: the module-level `t` is the translator the builder needs.
test("a failed Retry cleanup leaves its explanation on screen (I10, real store)", async (ctx) => {
  const notices = await import("../../src/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  ctx.after(() => notices.__setNoticeClockForTests());
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
import type { NoticeAction, NoticeInput } from "./ui/notices";
import type { CleanupFailure } from "../stores/cleanupFailureStore";

type T = (key: string, options?: Record<string, unknown>) => string;

/**
 * A dictation failure with no content shares this id: the next status
 * replaces it, and the next start or success clears it.
 */
export const DICTATION_STATUS_NOTICE_ID = "dictation-error";

/**
 * A failure that holds content (recovered words, or audio Plan 07 holds) gets
 * one notice per dictation session. Nothing automatic removes it (R2-C3).
 */
export function dictationRecoveryNoticeId(sessionKey: string): string {
  return `dictation-recovery:${sessionKey}`;
}

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
  input: { title: string; description?: string; words?: string; recoveryHeld?: boolean; sessionKey: string },
  t: T,
  actions: { retry: () => void; pasteAgain: (words: string) => Promise<void>; extraActions?: NoticeAction[] }
): NoticeInput {
  const words = input.words?.trim() || undefined;
  const holdsContent = Boolean(words || input.recoveryHeld);
  const primary: NoticeAction[] = words
    ? [
        {
          label: t("notices.actions.pasteAgain"),
          primary: true,
          keepOpen: true,
          onClick: () => actions.pasteAgain(words),
        },
      ]
    : input.recoveryHeld
      ? [] // Retry would hit the same seal; Plan 07's Transcribe (extraActions) is the way back
      : [{ label: t("common.retry"), primary: true, onClick: actions.retry }];
  return {
    id: holdsContent ? dictationRecoveryNoticeId(input.sessionKey) : DICTATION_STATUS_NOTICE_ID,
    kind: "alert",
    title: input.title,
    ...(input.description ? { body: input.description } : {}),
    ...(words ? { words } : {}),
    // §5.3: audio held in memory is user content at stake, so the alert never times out.
    ...(input.recoveryHeld ? { persistent: true } : {}),
    actions: [...primary, ...(actions.extraActions ?? [])],
  };
}

/** §5.3: Plan 07's recovery prompt once Sealed mode is off and recordings are held. */
export function buildSealedRecoveryNotice(
  t: T,
  actions: { transcribe: () => Promise<unknown>; discard: () => void }
): NoticeInput {
  return {
    id: "sealed-recovery",
    kind: "notice",
    persistent: true,
    title: t("sealedMode.recovery.availableTitle"),
    actions: [
      { label: t("sealedMode.recovery.transcribe"), primary: true, onClick: actions.transcribe },
      { label: t("sealedMode.recovery.discard"), onClick: actions.discard },
    ],
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

Today the path dies three times:
- `preload.js:916` drops the `show-settings` payload;
- the `ControlPanel.tsx:284-289` subscriber only calls `setShowSettings(true)`;
- `openSettings()` (`windowManager.js:2240-2245`) sends once and forgets. `createControlPanelWindow` returns at once for an existing window (lines 1271–1281), even while it is loading or reloading. For a new window it waits for the page load, but `ControlPanel` subscribes later, in a React effect. Either way the message can reach a page with no listener.

On top of that, `SettingsModal` applies `initialSection` only on the closed→open edge (lines 111–114). Plan 03 defines the grammar (`"<section>/<subTab>"`) and makes `SettingsModal` parse it (Plan 03 clarification 10).

The fix is a pending request with an acknowledgment. Main keeps the request until the panel's subscriber acknowledges it:
- a mounted subscriber gets it by push;
- a subscriber that mounts later (first load, reload, crash recovery) asks main for it on mount;
- a request nobody acknowledges expires after 15 s, so a stale link never opens Settings much later;
- a newer request replaces an older one.

No load event is involved, so new and existing windows behave the same.

1. Create `test/components/settingsDeepLink.test.js`:

   ```js
   const assert = require("node:assert/strict");
   const fs = require("node:fs");
   const path = require("node:path");
   const test = require("node:test");

   const repoRoot = path.join(__dirname, "../..");
   const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

   test("only Plan 03's settingsPath grammar is accepted", async () => {
     const { parseSettingsDeepLink } = await import("../../src/utils/settingsDeepLink.ts");
     assert.equal(parseSettingsDeepLink({ id: "settings-link-1", path: "llms/cleanup" }), "llms/cleanup");
     assert.equal(parseSettingsDeepLink({ path: "privacyData" }), "privacyData");
     for (const bad of [null, {}, { path: "" }, { path: null }, { path: "../x" }, { path: "a/b/c" }, { path: "javascript:alert(1)" }, { path: 7 }]) {
       assert.equal(parseSettingsDeepLink(bad), undefined, JSON.stringify(bad));
     }
   });

   test("ControlPanel subscribes through the acknowledged deep-link subscriber", () => {
     const panel = read("src/components/ControlPanel.tsx");
     assert.match(panel, /subscribeSettingsDeepLinks\(window\.electronAPI, \(section\) => \{\s*setSettingsSection\(section\);\s*setShowSettings\(true\);/);
     assert.doesNotMatch(panel, /onShowSettings\?\.\(\(\) =>/);
     // An already-open modal must move to the new section too.
     assert.match(read("src/components/SettingsModal.tsx"), /useEffect\(\(\) => \{\s*if \(open && initialSection\)/);
   });
   ```

   Create `test/helpers/settingsDeepLinkDelivery.test.js`. It drives the real `WindowManager.openSettings`, the real IPC registration, the real `preload.js` and the real subscriber. Only Electron and the window's page lifecycle are faked:

   ```js
   const assert = require("node:assert/strict");
   const fs = require("node:fs");
   const path = require("node:path");
   const test = require("node:test");
   const vm = require("node:vm");
   const { EventEmitter } = require("node:events");
   const Module = require("node:module");

   function deferred() {
     let resolve;
     const promise = new Promise((done) => (resolve = done));
     return { promise, resolve };
   }

   const created = [];

   class FakeWebContents extends EventEmitter {
     constructor() {
       super();
       this.document = null; // the page loaded right now, if any
     }
     // Main → renderer: reaches only the current page, and only the listeners
     // it has registered so far.
     send(channel, payload) {
       this.document?.deliver(channel, payload);
     }
     setWindowOpenHandler() {}
     isCrashed() {
       return false;
     }
   }

   class FakeBrowserWindow extends EventEmitter {
     constructor() {
       super();
       this.webContents = new FakeWebContents();
       this.load = deferred();
       created.push(this);
     }
     loadFile() {
       return this.load.promise;
     }
     loadURL() {
       return this.load.promise;
     }
     isDestroyed() {
       return false;
     }
     isMinimized() {
       return false;
     }
     isVisible() {
       return true;
     }
     restore() {}
     show() {}
     focus() {}
     setTitle() {}
   }

   // Same stubbing as windowManagerMeetingNotification.test.js, plus what the
   // control-panel path touches.
   const originalLoad = Module._load;
   Module._load = function loadWithStubs(request, parent, isMain) {
     if (request === "electron") {
       return {
         app: { on: () => undefined },
         screen: { getPrimaryDisplay: () => ({}), on: () => undefined },
         BrowserWindow: FakeBrowserWindow,
         shell: {},
         dialog: {},
       };
     }
     if (request === "./debugLogger") return { info() {}, warn() {}, debug() {}, error() {} };
     if (request === "./hotkeyManager") {
       class FakeHotkeyManager {
         unregisterAll() {}
         isInListeningMode() {
           return false;
         }
       }
       FakeHotkeyManager.isGlobeLikeHotkey = () => false;
       return FakeHotkeyManager;
     }
     if (request === "./dragManager") return class FakeDragManager { cleanup() {} };
     if (request === "./menuManager") return { setupControlPanelMenu() {}, setupMainMenu() {} };
     if (request === "./devServerManager") {
       return { getAppFilePath: () => ({ path: __filename, query: {} }), getAppUrl: () => null, waitForDevServer: async () => {} };
     }
     if (request === "./dockManager") return { setControlPanelVisible() {} };
     if (request === "./i18nMain") return { i18nMain: { t: (key) => key } };
     if (request === "./windowConfig") {
       return { MAIN_WINDOW_CONFIG: {}, CONTROL_PANEL_CONFIG: {}, NOTIFICATION_WINDOW_CONFIG: {}, WINDOW_SIZES: {}, WindowPositionUtil: {} };
     }
     return originalLoad.call(this, request, parent, isMain);
   };
   const WindowManager = require("../../src/helpers/windowManager");
   Module._load = originalLoad;
   const { createSettingsLinkQueue, registerSettingsLinkIpc } = require("../../src/helpers/settingsLinks");

   const PRELOAD = fs.readFileSync(path.join(__dirname, "../../preload.js"), "utf8");
   const flush = () => new Promise((resolve) => setImmediate(resolve));
   const deepLink = () => import("../../src/utils/settingsDeepLink.ts");

   function setup(t, { ttlMs } = {}) {
     created.length = 0;
     const handlers = new Map();
     const manager = new WindowManager();
     if (ttlMs) manager.settingsLinks = createSettingsLinkQueue({ ttlMs });
     registerSettingsLinkIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, manager);
     t.after(() => manager._clearControlPanelVisibilityTimer());

     // A page that has loaded: a fresh preload with no listeners until the app
     // subscribes. invoke() reaches main's handlers with this window as sender.
     const loadDocument = (contents) => {
       const listeners = new Map();
       let api = null;
       const ipcRenderer = {
         invoke: async (channel, ...args) => handlers.get(channel)({ sender: contents }, ...args),
         on: (channel, listener) => listeners.set(channel, [...(listeners.get(channel) ?? []), listener]),
         removeListener: (channel, listener) =>
           listeners.set(channel, (listeners.get(channel) ?? []).filter((l) => l !== listener)),
         send() {},
         sendSync: () => undefined,
       };
       vm.runInNewContext(PRELOAD, {
         require: (specifier) => {
           if (specifier !== "electron") throw new Error(`Unexpected preload dependency: ${specifier}`);
           return { contextBridge: { exposeInMainWorld: (_name, exposed) => (api = exposed) }, ipcRenderer, webUtils: {} };
         },
         process,
       });
       contents.document = {
         deliver: (channel, payload) =>
           (listeners.get(channel) ?? []).forEach((listener) => listener({ sender: contents }, payload)),
       };
       return api;
     };
     // A reload begins: the old page and its listeners are gone.
     const unloadDocument = (contents) => {
       contents.document = null;
     };
     return { manager, handlers, loadDocument, unloadDocument };
   }

   test("a link sent while a new control panel loads opens once its subscriber mounts (I12)", async (t) => {
     const { subscribeSettingsDeepLinks } = await deepLink();
     const { manager, loadDocument } = setup(t);
     const opened = [];

     const result = manager.openSettings("llms/cleanup");
     await flush();
     const [panel] = created;
     assert.ok(panel, "openSettings created the control panel");
     // The page loads and main sends, but React has not subscribed yet.
     const page = loadDocument(panel.webContents);
     panel.load.resolve();
     await flush();
     assert.deepEqual(opened, []);

     subscribeSettingsDeepLinks(page, (section) => opened.push(section));
     assert.deepEqual(await result, { delivered: true });
     assert.deepEqual(opened, ["llms/cleanup"]);
   });

   test("a link sent while an existing control panel reloads opens in the reloaded page (I12)", async (t) => {
     const { subscribeSettingsDeepLinks } = await deepLink();
     const { manager, loadDocument, unloadDocument } = setup(t);
     const opened = [];
     const open = (section) => opened.push(section);

     // Mounting while the first request is both pending and being pushed
     // opens it once: the push and the mount check carry the same id.
     const first = manager.openSettings("privacyData");
     await flush();
     const [panel] = created;
     const page = loadDocument(panel.webContents);
     const unsubscribe = subscribeSettingsDeepLinks(page, open);
     panel.load.resolve();
     assert.deepEqual(await first, { delivered: true });
     // A loaded, subscribed panel gets the next request by push.
     assert.deepEqual(await manager.openSettings("llms/cleanup"), { delivered: true });
     assert.deepEqual(opened, ["privacyData", "llms/cleanup"]);

     // The panel reloads. The request arrives before the new page subscribes.
     unsubscribe();
     unloadDocument(panel.webContents);
     const during = manager.openSettings("general");
     await flush();
     assert.deepEqual(opened, ["privacyData", "llms/cleanup"], "nothing reached the unloading page");
     subscribeSettingsDeepLinks(loadDocument(panel.webContents), open);
     assert.deepEqual(await during, { delivered: true });
     assert.deepEqual(opened, ["privacyData", "llms/cleanup", "general"]);
     assert.equal(created.length, 1, "the existing window was reused");
   });

   test("an unacknowledged link expires, and a page that mounts later does not open it", async (t) => {
     const { subscribeSettingsDeepLinks } = await deepLink();
     const { manager, loadDocument } = setup(t, { ttlMs: 20 });
     const result = manager.openSettings("llms/cleanup");
     await flush();
     const [panel] = created;
     panel.load.resolve();
     assert.deepEqual(await result, { delivered: false, reason: "timeout" });

     const opened = [];
     subscribeSettingsDeepLinks(loadDocument(panel.webContents), (section) => opened.push(section));
     await flush();
     assert.deepEqual(opened, []);
   });

   test("a newer link replaces an older one; only the control panel may read or acknowledge it", async (t) => {
     const { manager, handlers } = setup(t);
     const older = manager.settingsLinks.enqueue("privacyData");
     const newer = manager.settingsLinks.enqueue("llms/cleanup");
     t.after(() => manager.settingsLinks.ack(newer.link.id));
     assert.deepEqual(await older.done, { delivered: false, reason: "replaced" });

     const stranger = { sender: new FakeWebContents() };
     assert.equal(await handlers.get("settings-link-pending")(stranger), null);
     assert.equal(await handlers.get("settings-link-ack")(stranger, newer.link.id), false);
     assert.deepEqual(manager.settingsLinks.peek(), newer.link);

     // Main normalises a path outside the grammar to "open Settings".
     const odd = manager.settingsLinks.enqueue("../x");
     t.after(() => manager.settingsLinks.ack(odd.link.id));
     assert.equal(odd.link.path, null);
   });
   ```

   Run: `npm test -- test/components/settingsDeepLink.test.js test/helpers/settingsDeepLinkDelivery.test.js`
   Expected: FAIL with `Cannot find module '…/settingsDeepLink.ts'` and `…/settingsLinks`.

2. Create `src/utils/settingsDeepLink.ts`:

   ```ts
   // Plan 03's settingsPath grammar: "<section>" or "<section>/<subTab>",
   // letters only. Anything else opens Settings at its default section.
   const SETTINGS_PATH = /^[A-Za-z]+(?:\/[A-Za-z]+)?$/;

   export interface SettingsLink {
     id: string;
     path: string | null;
   }

   interface SettingsLinkApi {
     onShowSettings?: (callback: (link?: SettingsLink) => void) => () => void;
     pendingSettingsLink?: () => Promise<SettingsLink | null>;
     ackSettingsLink?: (id: string) => Promise<boolean>;
   }

   export function parseSettingsDeepLink(payload: unknown): string | undefined {
     const value = (payload as { path?: unknown } | null)?.path;
     return typeof value === "string" && SETTINGS_PATH.test(value) ? value : undefined;
   }

   /**
    * The control panel's Settings deep-link subscriber (I12). Main holds each
    * request until this acknowledges it. A request sent while the panel was
    * loading or reloading is fetched here on mount, so it is never lost into a
    * page that had no listener yet. The push and the mount check can carry the
    * same request; it opens once.
    */
   export function subscribeSettingsDeepLinks(
     api: SettingsLinkApi | undefined,
     open: (section: string | undefined) => void
   ): () => void {
     if (!api?.onShowSettings) return () => {};
     let disposed = false;
     let lastId: string | null = null;
     const apply = (link: SettingsLink | null | undefined) => {
       if (disposed) return;
       if (link?.id) {
         if (link.id === lastId) return;
         lastId = link.id;
       }
       open(parseSettingsDeepLink(link));
       if (link?.id) void api.ackSettingsLink?.(link.id);
     };
     const unsubscribe = api.onShowSettings(apply);
     void api.pendingSettingsLink?.().then(
       (link) => {
         if (link) apply(link);
       },
       () => {}
     );
     return () => {
       disposed = true;
       unsubscribe?.();
     };
   }
   ```

   A disposed subscriber never acknowledges, so in React's development double mount the second subscriber still finds the request pending.

3. Create `src/helpers/settingsLinks.js`:

   ```js
   // Settings deep links (I12). Main holds one pending request until the
   // control panel's subscriber acknowledges it. A panel that is still loading,
   // or reloading, asks for it when its subscriber mounts, so a request is never
   // sent into a page with no listener and forgotten. A request nobody
   // acknowledges expires, so a stale link never opens Settings much later.
   const SETTINGS_LINK_TTL_MS = 15_000;
   // Plan 03's grammar, mirrored from src/utils/settingsDeepLink.ts.
   const SETTINGS_PATH = /^[A-Za-z]+(?:\/[A-Za-z]+)?$/;

   function createSettingsLinkQueue({ ttlMs = SETTINGS_LINK_TTL_MS, timers = { setTimeout, clearTimeout } } = {}) {
     let seq = 0;
     let pending = null;
     const settle = (result) => {
       if (!pending) return;
       const current = pending;
       pending = null;
       timers.clearTimeout(current.timer);
       current.resolve(result);
     };
     return {
       enqueue(settingsPath) {
         settle({ delivered: false, reason: "replaced" });
         const link = {
           id: `settings-link-${++seq}`,
           path: typeof settingsPath === "string" && SETTINGS_PATH.test(settingsPath) ? settingsPath : null,
         };
         let resolve;
         const done = new Promise((r) => (resolve = r));
         const timer = timers.setTimeout(() => settle({ delivered: false, reason: "timeout" }), ttlMs);
         timer?.unref?.(); // never keeps the app from quitting
         pending = { link, resolve, timer };
         return { link, done };
       },
       peek() {
         return pending ? { ...pending.link } : null;
       },
       ack(id) {
         if (!pending || pending.link.id !== id) return false;
         settle({ delivered: true });
         return true;
       },
     };
   }

   function registerSettingsLinkIpc(ipcMain, windowManager) {
     // Only the control panel may read or acknowledge the pending request.
     const fromControlPanel = (event) => {
       const panel = windowManager.controlPanelWindow;
       return Boolean(panel && !panel.isDestroyed() && event?.sender === panel.webContents);
     };
     ipcMain.handle("open-settings-at", (_event, settingsPath) => windowManager.openSettings(settingsPath));
     ipcMain.handle("settings-link-pending", (event) =>
       fromControlPanel(event) ? windowManager.settingsLinks.peek() : null
     );
     ipcMain.handle("settings-link-ack", (event, id) =>
       fromControlPanel(event) && typeof id === "string" ? windowManager.settingsLinks.ack(id) : false
     );
   }

   module.exports = { SETTINGS_LINK_TTL_MS, createSettingsLinkQueue, registerSettingsLinkIpc };
   ```

4. `src/helpers/windowManager.js`:
   - Add `const { createSettingsLinkQueue } = require("./settingsLinks");` with the other requires (lines 1–45).
   - In the constructor (line 48), add `this.settingsLinks = createSettingsLinkQueue();` after `this.controlPanelWindow = null;`.
   - Replace `openSettings()` (lines 2240–2245) with:

     ```js
       async openSettings(settingsPath = null) {
         // Queue first: a panel that is loading or reloading picks the request
         // up when its subscriber mounts, so nothing here waits on load events.
         const { link, done } = this.settingsLinks.enqueue(settingsPath);
         await this.createControlPanelWindow();
         const panel = this.controlPanelWindow;
         if (panel && !panel.isDestroyed()) panel.webContents.send("show-settings", link);
         return done;
       }
     ```

   The menu callers (lines 165, 1347, 2228 and 2231) keep calling `openSettings()` with no argument and do not await it.
5. `src/helpers/ipcHandlers.js`: add `const { registerSettingsLinkIpc } = require("./settingsLinks");` with the other requires, and call `registerSettingsLinkIpc(ipcMain, this.windowManager);` after the `window-is-maximized` handler (lines 1176–1181).
6. `preload.js`:
   - add, next to `onShowSettings`:

     ```js
       openSettingsAt: (settingsPath) => ipcRenderer.invoke("open-settings-at", settingsPath),
       pendingSettingsLink: () => ipcRenderer.invoke("settings-link-pending"),
       ackSettingsLink: (id) => ipcRenderer.invoke("settings-link-ack", id),
     ```

   - change line 916 to `onShowSettings: registerListener("show-settings", (callback) => (_event, link) => callback(link)),`.

   `src/types/electron.ts`:
   - add `import type { SettingsLink } from "../utils/settingsDeepLink";` beside the imports at lines 1–3, and `type SettingsLinkResult` as in the Interfaces block;
   - add `openSettingsAt?`, `pendingSettingsLink?` and `ackSettingsLink?`;
   - widen `onShowSettings` (line 1490) to `(callback: (link?: SettingsLink) => void) => () => void`.
7. `src/components/ControlPanel.tsx:284-289`:

   ```tsx
     useEffect(
       () =>
         subscribeSettingsDeepLinks(window.electronAPI, (section) => {
           setSettingsSection(section);
           setShowSettings(true);
         }),
       []
     );
   ```

   Import `subscribeSettingsDeepLinks` from `../utils/settingsDeepLink`. A request with no path sets `undefined`, which also clears a stale section left from an earlier open.
8. `src/components/SettingsModal.tsx`. After the existing open-edge logic (lines 111–114), add:

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
   - Signature, line 32: `export const useAudioRecording = (options = {}) => {`. Delete the `toast` parameter. The destructure on lines 58–69 is unchanged except that `onShowTranscript` (the words card replaces "View transcript") and `dismissDictationError` are removed. Remove both from `App.jsx` too.
   - Remove `dismissDictationError` from the dependency arrays at lines 241 and 805. The hook now owns the status notice:
     - line 190: `if (didStart) dismissNotice(DICTATION_STATUS_NOTICE_ID);`
     - line 454: `dismissNotice(DICTATION_STATUS_NOTICE_ID);`

     Both clear only the stable status id. Content notices carry their own ids, so neither edge can reach them (R2-C3).
   - Above the hook (next to `SELECTION_EDIT_DETAIL_KEY_BY_CODE`, lines 24–29), add `let localRecoveryKey = 0;`. It keys content notices when no session id exists: before Task 6 adds `activeSession`, and for failures outside a session.
   - `showDictationError` (lines 300–331) becomes:

     ```js
     // Content (recovered words, or audio Plan 07 holds) gets one notice per
     // dictation session, and nothing automatic removes it: only a delivered
     // Paste again or the user's Dismiss does (R2-C3). A failure without content
     // shares DICTATION_STATUS_NOTICE_ID, so the next status replaces it and the
     // next start or success clears it.
     const showDictationError = (
       { title, description, transcript = "", recoveryHeld = false, sessionId = null },
       extraActions = []
     ) => {
       const recoverAssistant = Boolean(audioManagerRef.current?.voiceAgentRequested);
       onDictationError?.({ recoverAssistant });
       const noticeId = notify(
         buildDictationErrorNotice(
           {
             title,
             description,
             words: getRecoverableTranscript(transcript),
             recoveryHeld,
             sessionKey: sessionId ?? `local-${++localRecoveryKey}`,
           },
           t,
           {
             extraActions,
             retry: () => performStartRecording(lastStartOptionsRef.current),
             pasteAgain: async (words) => {
               const pasted = await audioManagerRef.current?.safePaste(words, {
                 restoreClipboard: false,
                 allowClipboardFallback: true,
               });
               if (!pasted) return; // keepOpen: the card and its words stay
               dismissNotice(noticeId, "action"); // this card only; other held words stay
               notify({ kind: "receipt", title: t("notices.pasted") });
             },
           }
         )
       );
       // The content card says everything the bare status line said.
       if (noticeId !== DICTATION_STATUS_NOTICE_ID) dismissNotice(DICTATION_STATUS_NOTICE_ID, "replaced");
       return noticeId;
     };
     ```

     Callers that pass `duration` keep compiling, because the argument is ignored. Remove `duration` from those call sites (`grep -n "showDictationError(" src/hooks/useAudioRecording.js`).
   - **Session ids.** At the top of `onError` (line 383) and of `onTranscriptionComplete` (line 452), before any `await`, add:

     ```js
     const sessionId = audioManagerRef.current?.activeSession?.id ?? null;
     ```

     Pass `sessionId` to every `showDictationError({ … })` inside those two callbacks (lines 402, 459, 598 and 629). Read it there and nowhere later: the pipeline settles right after these callbacks are invoked (`audioManager.js:1860` then `:1932`), and Task 6 ends the session at that edge, so a read after an `await` sees `null`. `onNoAudio` (line 412) carries no content and needs no id. Until Task 6 lands, `activeSession` is `undefined`, and `localRecoveryKey` keeps each card distinct.
   - Line 363, mic disconnected: `notify({ id: "mic", kind: "notice", title: t("hooks.audioRecording.micDisconnected.title"), body: t("hooks.audioRecording.micDisconnected.description") })`. Keep the existing description key.
   - Line 370, mic restored: `notify({ id: "mic", kind: "receipt", title: t("hooks.audioRecording.micRestored.title") })`. The same id replaces the disconnected notice.
   - Line 400, screen context skipped: `notify({ kind: "notice", title, body })` with the same title and description as today.
   - Line 516, partial transcription: `notify({ kind: "notice", title, body })`.
   - Line 666, fallback: `notify({ kind: "notice", title, body })`.
   - Line 682, translation fallback (destructive today): `notify({ kind: "alert", title, body })`.
   - Line 659: `if (result.cleanupFailure) recordCleanupFailure({ ...result.cleanupFailure, rawText: result.text });`.
   - Add the imports `import { notify, dismissNotice } from "../components/ui/notices";` and `import { buildDictationErrorNotice, DICTATION_STATUS_NOTICE_ID } from "../components/voiceNotices";`.
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
   - Delete the effect at lines 343–347. It dismissed every dictation error when a recording started, which would now include unresolved words (R2-C3). The hook clears the status notice at its own start and success edges.
   - Delete `dismissDictationError` (lines 88–91) and the `dismissDictationError,` option (line 214). Then drop `dismissByPresentation` from the `useToast()` destructure (line 64) if `grep -n dismissByPresentation src/App.jsx` finds no other use.
   - The `useMainProcessNotifications` call becomes `useMainProcessNotifications({ t })`.
7. **`src/components/OnboardingFlow.tsx:747`.** Change it to `const recording = useAudioRecording({ trialMode: true, onDemoEvent });`. Remove the `toast` destructure only if nothing else in the file uses it (`grep -n "toast" src/components/OnboardingFlow.tsx`).
8. **Hook tests.** Change each call to the new single-argument form:
   - `test/helpers/useAudioRecordingMicPrecache.test.js:62`
   - `test/helpers/useAudioRecordingPreparingReset.test.js:96`
   - `test/helpers/useAudioRecordingCleanupFallback.test.js:78`
   - `test/helpers/useAudioRecordingInitialization.test.js:18`
   - `test/helpers/useAudioRecordingClipboardPersistence.test.js:153`

   For example, `useAudioRecording(() => {}, { onDemoEvent: () => {} })` becomes `useAudioRecording({ onDemoEvent: () => {} })`.

   `test/helpers/useAudioRecordingForceStop.test.js:134` collected toasts. Read the notices through the same Vite module graph the hook uses, and give the harness a session and a failure path:
   - In `FAKE_AUDIO_MANAGER_SOURCE`, add `this.activeSession = null;` to the constructor.
   - In `mountHarness`, after `createRendererServer(…)`:

     ```js
     const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
     notices.__setNoticeClockForTests();
     t.after(() => notices.__setNoticeClockForTests());
     ```

     Render with `useAudioRecording({ onDemoEvent: NOOP })`. In the returned object, replace `toasts` with `get toasts() { return notices.getNotices(); }`, and add:

     ```js
     notices,
     session: (id) => {
       globalThis.__forceStopAudioManager.activeSession = id ? { id } : null;
     },
     fail: async (error) => {
       await React.act(async () => globalThis.__forceStopAudioManager.callbacks.onError(error));
     },
     ```

   - `errorToasts` becomes `harness.toasts.filter((n) => n.id === "dictation-error" || n.id.startsWith("dictation-recovery:"))`.
   - Change each `.description` assertion to `.body`. In the force-stopped test, replace the "View transcript" assertion with `assert.equal(toast.words, "held too long");` and `assert.equal(toast.actions[0].label, "notices.actions.pasteAgain");`.
   - "the latch does not leak into the next dictation" keeps `errorToasts(harness).length === 1`. That card is the first dictation's, which still holds unsent words; change the message to "the first card stays; no second card".

   Then append the R2-C3 regression. History is off (the fake `saveTranscription` stores nothing, as `audioManager.js:3049-3053` does with retention off) and the clipboard rejects, so each card is the only copy of its words:

   ```js
   test("two failed deliveries both stay recoverable, through a status error and a third successful dictation (R2-C3)", async (t) => {
     const harness = await mountHarness(t, {
       writeClipboard: async () => {
         throw new Error("clipboard unavailable");
       },
     });
     const held = () => harness.notices.wordsNotices(harness.notices.getNotices()).map((n) => [n.id, n.words]);

     harness.session("rec-1");
     await harness.forceStop("timeout");
     await harness.complete({ text: "first words", rawText: "first words" });

     await harness.startRecording();
     harness.session("rec-2");
     await harness.forceStop("timeout");
     await harness.complete({ text: "second words", rawText: "second words" });
     assert.deepEqual(held(), [
       ["dictation-recovery:rec-1", "first words"],
       ["dictation-recovery:rec-2", "second words"],
     ]);

     // A failure without content takes the stable status id…
     await harness.fail({ title: "Transcription Error", description: "Transcription failed: timeout" });
     assert.equal(harness.toasts.filter((n) => n.id === "dictation-error").length, 1);

     // …and the next start and success clear that one, and only that one.
     await harness.startRecording();
     harness.session("rec-3");
     await harness.complete({ text: "third words", rawText: "third words" });
     assert.equal(harness.pastes.at(-1).text, "third words", "the third dictation pasted");
     assert.equal(harness.toasts.some((n) => n.id === "dictation-error"), false);
     assert.deepEqual(held(), [
       ["dictation-recovery:rec-1", "first words"],
       ["dictation-recovery:rec-2", "second words"],
     ]);

     // Paste again on the first card recovers it, and removes that card only.
     const first = harness.toasts.find((n) => n.id === "dictation-recovery:rec-1");
     await React.act(() => harness.notices.runNoticeAction(first.id, first.actions.find((a) => a.primary)));
     assert.equal(harness.pastes.at(-1).text, "first words");
     assert.deepEqual(held(), [["dictation-recovery:rec-2", "second words"]]);
   });
   ```

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

Run: `npm test -- test/components/voiceNotices.test.js test/components/settingsDeepLink.test.js test/helpers/settingsDeepLinkDelivery.test.js test/helpers/retryDictationCleanup.test.js test/helpers/cleanupFailureToast.test.js "test/helpers/useAudioRecording*.test.js" test/components/meetingInterruptionWarning.test.js test/hooks/dictationErrorAutoHide.test.js`
Expected: PASS. `meetingInterruptionWarning.test.js` mocks the toast. If it fails on `toast`, read it, load `notices.ts` through its Vite server, and assert on `getNotices()` as in item 8.

- [ ] **Step 7: Commit**

```bash
git add -A src/components src/utils/settingsDeepLink.ts src/helpers/settingsLinks.js src/helpers/windowManager.js src/helpers/retryDictationCleanup.js src/stores/cleanupFailureStore.ts src/hooks src/App.jsx src/renderApp.jsx src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/locales test
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
7. **Plan 07's two notices (§5.3).** They must survive this migration, whichever plan merges second:
   - **07 merged first.** Its `showDictationError(…, extraActions)` and its `recoveryHeld` flag map onto Task 4's builder. Pass `recoveryHeld: error.recoveryHeld === true`, and pass its Transcribe action through `extraActions`. That makes the held-audio refusal a persistent `alert` in the pill's notice slot, so Transcribe stays reachable from the pill.
     Its unseal `toast({ duration: Infinity, actions: [Transcribe, Discard] })` in the hook's `subscribeSealed` effect becomes:

     ```js
     notify(buildSealedRecoveryNotice(t, {
       transcribe: () => audioManagerRef.current?.transcribeRecovered(),
       discard: () => discardRecovery(),
     }));
     ```

     Keep its `wasSealed === true && sealed === false && recoveryCount() > 0` condition, and its `subscribeSealed` source (`src/stores/sealedStore.ts`, §5.4).
   - **04 merged first.** No toast system remains, so Plan 07 calls `notify(buildSealedRecoveryNotice(…))` and `showDictationError({ …, recoveryHeld }, [transcribe])` directly. Its CCR-3 and CCR-4 text already says so.

   The `noToastLeft` guard catches a missed toast in either order.
8. For each listed test that imported toast modules: if it mounted `ToastProvider` only to satisfy `useToast`, delete the provider wrapper. If it asserted a toast, load `notices.ts` through the same module system and assert on `getNotices()`. Use `await import("../../src/components/ui/notices.ts")` for SSR tests and `vite.ssrLoadModule("/components/ui/notices.ts")` for Vite-harness tests.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck && npm run i18n:check`
Expected: PASS. Any remaining failure names a call site or test you missed; fix it with the mapping rule.

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "refactor(ui): migrate every toast to notify() and remove the toast system"
```

---
### Task 6: Dictation sessions, the route snapshot and the whole operation

Closes review finding C2 and, in round 2, R1-C2. It lays the groundwork for C1, I2 and I5. Every recording becomes a **dictation session**, with:
- an id, which is also the `correlationId` Plan 07 asked for (its CCR-3);
- an immutable, credential-free snapshot of every setting that decides where the audio and text go, taken when recording starts;
- the recording's intents (Agent, translation, screen context, selection).

The processing pipeline reads routing settings **only** from the session. A settings change during processing, during the undo window, or between cancel and Undo can therefore never move the audio to a different provider, and local audio can never go remote. Credentials are not in the snapshot. Main resolves API keys live by provider id (`ipcHandlers.js:8069-8075`), and the renderer-held keys are read live, so revoking a key makes the request fail explicitly instead of silently switching.

**The whole operation, not only the speech (R1-C2).** A standalone Agent command does not end in the dictation pipeline:
- It is banked for the assistant panel (`audioManager.js:2262-2275`, `:2295-2313`).
- It is handed on through `useAudioRecording.js:474-504` and `useAssistantPanel.js:135-151`.
- The panel's request then resolved its route from live settings again (`useChatStreaming.ts:233-238`).

Record with a local Voice Assistant, cancel, switch it to a provider, then Undo: the speech stayed local, but the command went to the new provider. This task closes that path in two parts.

- **The operation.** The banked command carries the session's credential-free **operation**, `{ sessionId, settings }`, the same frozen snapshot. The hook, `useAssistantPanel`, `AssistantPanel`, the onboarding demo and `useChatStreaming` pass it on. The panel's request resolves its route, prompt inputs and `correlationId` from it. A typed follow-up in the panel is a new request and uses live settings.
- **The context.** What the user pointed at belongs to the session too. The hook requests the OS selection read and the screenshot at press time (`useAudioRecording.js:170-179`). Today a processing cancel clears both promises (`audioManager.js:3776-3778`), and `consumeSelectionCapture` (`:768-777`) then reads whatever is selected *now*. A per-session **context** (`createSessionContext`) now owns both reads:
  - It moves with the session into the cancel buffer and back on Undo (Task 8). A restored command quotes or edits the original selection and carries the original screenshot.
  - A restored session never reads the OS selection again. If it never had a read, its command runs as a standalone panel command, which types nothing.
  - Main still re-validates the original target and text before it replaces anything (`selectionManager.js:213-235`). Its capture sessions live 5 minutes (`selectionManager.js:5`), longer than any undo window.

**Files:**
- Create: `src/helpers/dictationSession.js`
- Modify: `src/helpers/audioManager.js`:
  - start the session in `startRecording` (≈1141) and `startStreamingRecording` (≈3430);
  - add `settings()` and the `_activeSession` / `_sessionContext` plumbing;
  - make every read site listed in Step 4 take its routing settings from the session;
  - read the selection and the screenshot through the session context (`:768-795`), and bank the operation with a panel command (`:2262-2275`).
- Modify: `src/services/ReasoningService.ts:38-141`. An explicit `config.provider` / `baseUrl` / `lanUrl` is always honoured, and dictation now always passes them. Add `config.settingsView`, which local-provider prompts read instead of live settings.
- Modify: `src/services/BaseReasoningService.ts:8-58`. `ReasoningConfig` gains `settingsView` and `correlationId`. The `get*` helpers prefer `config.settingsView`.
- Modify: `src/config/prompts/index.ts:17-21`. `resolvePrompt(kind, opts)` accepts `opts.customPrompts`.
- Modify: `src/hooks/useAudioRecording.js:474-504`. The Agent command carries `operation`.
- Modify: `src/hooks/useAssistantPanel.js:135-151`. The pending command keeps it.
- Modify: `src/components/dictation/AssistantPanel.tsx:46-52`, `:205-209`. The panel sends it.
- Modify: `src/components/chat/useChatStreaming.ts:13-15`, `:84-97`, `:233`, `:380-397`. `sendToAI` resolves its route from it.
- Modify: `src/hooks/useOnboardingAssistantDemo.ts:8-11`, `:58-60`. The onboarding demo sends it too.
- Modify: `src/helpers/ipcHandlers.js`, `src/helpers/personalInference.js`, `src/services/ai/personalInferenceTypes.ts`, `src/helpers/dictationStreamingRouting.js` (the correlation id, Step 4.6).
- Modify: `test/helpers/harness/audioManager.js`. Export `realSettingsStoreSource`.
- Test: `test/helpers/dictationSession.test.js`
- Test: `test/helpers/audioManagerSessionRoute.test.js`
- Test: `test/helpers/dictationOperationHandoff.test.js`
- Modify: `test/helpers/useAudioRecordingClipboardPersistence.test.js`, `test/helpers/assistantPanel.test.js`

**Interfaces:**
- Consumes `INFERENCE_SCOPES` (`src/config/inferenceScopes.ts:20-100`) and `selectResolvedLLMConfig` (`settingsStore.ts:2629`).
- Produces:

  ```js
  // src/helpers/dictationSession.js
  export const SESSION_ROUTE_KEYS: readonly string[];   // every settings-store key that decides a dictation route or its prompt
  export function isCredentialKey(key: string): boolean; // /apikey|secret|token|clientid|password|credential/i
  export function captureDictationSession({ settings, intents, agentName, id?, now? }): DictationSession;
  export function sessionSettings(session: DictationSession, live: object): object; // live, overlaid with the snapshot
  export function sessionOperation(session: DictationSession): DictationOperation;  // frozen { sessionId, settings: session.settings }
  export function createSessionContext({ sessionId, selection?, screen? }): SessionContext;
  // DictationSession (frozen):
  // { id: string; startedAt: number; settings: Readonly<Record<string, unknown>>; agentName: string;
  //   intents: { voiceAgentRequested: boolean; translationRequested: boolean; streaming: boolean;
  //              streamingProviderName: string | null; assistantSelectionContext: unknown } }
  // SessionContext (owned by one session; it moves into the cancel buffer and back on Undo):
  // { sessionId: string; readonly restored: boolean; readonly released: boolean;
  //   selection(): Promise<SelectionCapture> | null; adoptSelection(read): read;
  //   screen(): Promise<ScreenContextImage | null> | null; markRestored(): void; release(): void }
  ```

  ```js
  // AudioManager
  beginDictationSession(intents): DictationSession;   // both start paths; adopts the press-time reads into a new SessionContext
  settings(): object;                                 // sessionSettings(this._activeSession, getSettings()) or getSettings()
  get activeSession(): DictationSession | null;
  applySessionIntents(session, { context }?): void;   // Undo's entry point (Task 8)
  _detachSessionOperation(): { session, context };    // cancel's exit point (Task 8): ends the session, keeps its reads
  ```

  ```ts
  // src/components/chat/useChatStreaming.ts
  export interface DictationOperation { sessionId: string; settings: Readonly<Record<string, unknown>> }
  SendToAIOptions.operation?: DictationOperation;     // resolve this request's route from the dictation, not live Settings
  ```

  ```js
  // test/helpers/harness/audioManager.js
  realSettingsStoreSource(settingsKey): string;       // the real settings store, with getSettings() = real defaults + the suite's settings
  ```

- Every later task uses `session.id` as the correlation id. Task 8 stores the whole session in the undo hold, with its context from `_detachSessionOperation()`.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/dictationSession.test.js`. `dictationSession.js` is a renderer module (Task 7 adds Plan 03's route graph to it), so the test loads it through the renderer harness:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-dictation-session-" });
  return { vite, ...(await vite.ssrLoadModule("/helpers/dictationSession.js")) };
}

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

test("the snapshot is frozen, credential-free and covers every route key", async (t) => {
  const { captureDictationSession, SESSION_ROUTE_KEYS, isCredentialKey } = await load(t);
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

test("the session view keeps the snapshot's route and the live credentials", async (t) => {
  const { captureDictationSession, sessionSettings } = await load(t);
  const session = captureDictationSession({ settings: live, intents: {}, agentName: "Loqui" });
  const changed = { ...live, useLocalWhisper: false, cloudTranscriptionProvider: "groq", openaiApiKey: "sk-rotated" };
  const view = sessionSettings(session, changed);
  assert.equal(view.useLocalWhisper, true, "local stays local");
  assert.equal(view.cloudTranscriptionProvider, "openai", "provider A stays provider A");
  assert.equal(view.openaiApiKey, "sk-rotated", "credentials are never frozen");
});

test("every inference scope the dictation pipeline uses is covered", async (t) => {
  const { vite, SESSION_ROUTE_KEYS } = await load(t);
  const { INFERENCE_SCOPES } = await vite.ssrLoadModule("/config/inferenceScopes.ts");
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

test("the operation is the session's own credential-free snapshot", async (t) => {
  const { captureDictationSession, sessionOperation, isCredentialKey } = await load(t);
  const session = captureDictationSession({ settings: live, intents: {}, agentName: "Loqui", id: "rec-2" });
  const operation = sessionOperation(session);
  assert.deepEqual(operation, { sessionId: "rec-2", settings: session.settings });
  assert.equal(operation.settings, session.settings, "no copy that could drift");
  assert.equal(Object.isFrozen(operation), true);
  for (const key of Object.keys(operation.settings)) assert.equal(isCredentialKey(key), false, key);
});

test("a session context keeps its first reads and forgets them on release", async (t) => {
  const { createSessionContext } = await load(t);
  const selection = Promise.resolve({ status: "selected", sessionId: "sel-1", text: "old" });
  const screen = Promise.resolve({ data: "A", mediaType: "image/png" });
  const context = createSessionContext({ sessionId: "rec-1", selection, screen });
  assert.equal(context.selection(), selection);
  assert.equal(context.screen(), screen);
  const later = Promise.resolve({ status: "selected", sessionId: "sel-2", text: "new" });
  assert.equal(context.adoptSelection(later), later);
  assert.equal(context.selection(), selection, "a later read never replaces the session's own");
  assert.equal(context.restored, false);
  context.markRestored();
  assert.equal(context.restored, true);
  context.release();
  assert.equal(context.selection(), null);
  assert.equal(context.screen(), null);
  assert.equal(context.released, true);
  assert.equal(context.adoptSelection(later), later);
  assert.equal(context.selection(), null, "a released context adopts nothing");
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
  assert.equal(manager._sessionContext.restored, true, "a restored session never reads the OS again");
  assert.equal(manager._sessionContext.selection(), null);
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

Create `test/helpers/dictationOperationHandoff.test.js`. It covers R1-C2 through each real handoff: the real `processTranscriptionCore` → `processAgentCommand` → `_bankPanelAgentCommand` path on the real settings store, and the real `useChatStreaming` → `ReasoningService` path. Only the IPC leaves are fakes. The cancel and Undo steps call the two methods Task 8 wires in (`_detachSessionOperation` at cancel, `applySessionIntents` at restore). Task 8 repeats these cases through `restoreCancelled`.

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { loadAudioManager, realSettingsStoreSource } = require("./harness/audioManager");

const LOCAL_AGENT = {
  useDictationAgent: true,
  dictationAgentMode: "local",
  dictationAgentProvider: "qwen",
  dictationAgentModel: "qwen3.5-2b-q4_k_m",
  dictationAgentCustomApiKey: "sk-secret",
  useCleanupModel: false,
  voiceAgentScreenContext: true,
  autoPasteEnabled: false,
};
const REMOTE_AGENT = {
  ...LOCAL_AGENT,
  dictationAgentMode: "providers",
  dictationAgentProvider: "openai",
  dictationAgentModel: "gpt-5-mini",
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

// `selection()` and `screen()` answer with what is selected and on screen *now*.
async function setupManager(t, { selection, screen }) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-operation-handoff-",
    settingsKey: "__operationHandoffSettings",
    settings: LOCAL_AGENT,
    mockModules: {
      "/stores/settingsStore": realSettingsStoreSource("__operationHandoffSettings"),
      // The leaf transport: record what a selection edit sends, and answer it.
      "/services/ReasoningService": `export default {
        cancelAllRequests() {},
        async processText(text, model, agentName, config) {
          globalThis.__operationHandoffSent.push({ text, model, config });
          const marker = config.systemPrompt.match(/__LOQUI_SELECTION_COMPLETE_[0-9a-f-]+__/)[0];
          return "Fixed draft" + marker;
        },
      };`,
    },
  });
  const sent = [];
  globalThis.__operationHandoffSent = sent;
  t.after(() => delete globalThis.__operationHandoffSent);
  const reads = { selection: 0, screen: 0 };
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    captureSelectedText: async () => (reads.selection++, selection()),
    captureScreenContext: async () => (reads.screen++, screen()),
  };
  const manager = loaded.createManager({ isProcessing: true, pendingAssistantConversation: null });
  // The hook's press-time sequence (useAudioRecording.js:153-179), then startRecording's session.
  manager.setVoiceAgentRequested(true);
  manager.beginScreenContextCapture();
  manager.beginSelectionCapture();
  const session = manager.beginDictationSession({});
  await flush();
  return { ...loaded, manager, session, sent, reads };
}

// cancelProcessing clears the raw reads first (audioManager.js:3776-3778);
// the cancel buffer then takes the session, and Undo hands it back (Task 8).
function cancelThenUndo(manager, changeTheWorld) {
  manager._requestStreamingCancellation();
  const held = manager._detachSessionOperation();
  assert.equal(manager.activeSession, null);
  assert.equal(held.context.released, false, "the reads survive the cancel");
  changeTheWorld();
  manager.applySessionIntents(held.session, { context: held.context });
  return held;
}

test("a standalone Agent command carries its session's operation, not live Settings", async (t) => {
  const { manager, session, setSettings } = await setupManager(t, {
    selection: () => ({ status: "none" }),
    screen: () => ({ data: "A", mediaType: "image/png" }),
  });
  setSettings(REMOTE_AGENT); // switched to OpenAI while the command was transcribing
  await manager.processTranscriptionCore("draft a reply", "local-parakeet");
  const { assistantConversation } = manager._takePendingResultExtras();
  assert.equal(assistantConversation.transcript, "draft a reply");
  assert.equal(assistantConversation.operation.sessionId, session.id);
  assert.equal(assistantConversation.operation.settings, session.settings);
  assert.equal(assistantConversation.operation.settings.dictationAgentMode, "local");
  assert.equal("dictationAgentCustomApiKey" in assistantConversation.operation.settings, false, "no key rides along");
});

test("Undo of a standalone Agent command keeps its route and its press-time screenshot", async (t) => {
  let shot = { data: "A", mediaType: "image/png" };
  const { manager, session, reads, setSettings } = await setupManager(t, {
    selection: () => ({ status: "none" }),
    screen: () => shot,
  });
  cancelThenUndo(manager, () => {
    setSettings(REMOTE_AGENT);
    shot = { data: "B", mediaType: "image/png" };
  });
  await manager.processTranscriptionCore("draft a reply", "local-parakeet");
  const { assistantConversation } = manager._takePendingResultExtras();
  assert.equal(assistantConversation.operation.sessionId, session.id);
  assert.equal(assistantConversation.operation.settings.dictationAgentMode, "local");
  assert.equal(assistantConversation.screenContext.data, "A", "the screenshot from the press, not a new one");
  assert.deepEqual(reads, { selection: 1, screen: 1 }, "Undo reads nothing from the OS again");
});

test("Undo of a selection edit edits the press-time selection on the session's route", async (t) => {
  let selected = { status: "selected", sessionId: "sel-original", text: "teh draft", characterCount: 9 };
  const { manager, session, sent, reads, setSettings } = await setupManager(t, {
    selection: () => selected,
    screen: () => null,
  });
  cancelThenUndo(manager, () => {
    setSettings(REMOTE_AGENT);
    selected = { status: "selected", sessionId: "sel-newer", text: "an unrelated paragraph", characterCount: 22 };
  });
  const text = await manager.processTranscriptionCore("fix the typo", "local-parakeet");
  assert.equal(text, "Fixed draft");
  // Main re-validates this capture's target and text before it replaces anything (selectionManager.js:213-235).
  assert.deepEqual(manager._takePendingResultExtras().selectionEdit, { sessionId: "sel-original" });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /teh draft/);
  assert.doesNotMatch(sent[0].text, /unrelated paragraph/);
  assert.equal(sent[0].model, "qwen3.5-2b-q4_k_m");
  assert.equal(sent[0].config.provider, "local", "the local Voice Assistant, not OpenAI");
  assert.equal(sent[0].config.correlationId, session.id);
  assert.equal(reads.selection, 1);
});

test("a restored session without a press-time read never reads the OS selection", async (t) => {
  const { manager, reads } = await setupManager(t, {
    selection: () => ({ status: "selected", sessionId: "sel-now", text: "whatever is selected now", characterCount: 24 }),
    screen: () => null,
  });
  manager._requestStreamingCancellation();
  const { session } = manager._detachSessionOperation();
  manager.applySessionIntents(session); // a context that never had a selection read
  const capture = await manager.consumeSelectionCapture();
  assert.deepEqual(capture, { status: "none" }, "the command goes to the panel as standalone");
  assert.equal(reads.selection, 1, "only the press-time read");
});

test("the panel answers a voice command on its dictation's route, with its correlation id", async (t) => {
  const requests = [];
  const listeners = new Set();
  const emit = (event) => [...listeners].forEach((listener) => listener(event));
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        llamaServerStart: async () => ({ success: true, port: 8123 }),
        personalInference: {
          onTextEvent: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
          async textStream(request) {
            requests.push(request);
            emit({ requestId: request.requestId, type: "chunk", chunk: { type: "content", text: "Done." } });
            emit({ requestId: request.requestId, type: "end" });
          },
          async textCancel() {},
        },
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-operation-panel-" });
  const [{ default: i18n }, { initReactI18next }] = await Promise.all([
    vite.ssrLoadModule("i18next"),
    vite.ssrLoadModule("react-i18next"),
  ]);
  if (!i18n.isInitialized) {
    const translation = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
    await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation } }, interpolation: { escapeValue: false } });
  }
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { captureDictationSession, sessionOperation } = await vite.ssrLoadModule("/helpers/dictationSession.js");
  const session = captureDictationSession({
    settings: { ...useSettingsStore.getState(), ...LOCAL_AGENT },
    intents: { voiceAgentRequested: true },
    agentName: "Loqui",
    id: "rec-9",
  });
  useSettingsStore.setState(REMOTE_AGENT); // Settings now say OpenAI
  const reasoning = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => reasoning.destroy());
  const { useChatStreaming } = await vite.ssrLoadModule("/components/chat/useChatStreaming.ts");
  let messages = [];
  let streaming;
  function Harness() {
    streaming = useChatStreaming({
      messages,
      setMessages: (next) => (messages = typeof next === "function" ? next(messages) : next),
      inferenceScope: "dictationAgent",
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  const user = { id: "u1", role: "user", content: "draft a reply", isStreaming: false };

  await streaming.sendToAI("draft a reply", [user], { operation: sessionOperation(session) });
  assert.equal(requests[0].provider, "local");
  assert.equal(requests[0].model, "qwen3.5-2b-q4_k_m");
  assert.equal(requests[0].baseUrl, "http://127.0.0.1:8123/v1");
  assert.equal(requests[0].correlationId, "rec-9");

  await streaming.sendToAI("and a typed follow-up", [user]);
  assert.equal(requests[1].provider, "openai", "a typed follow-up is a new request on live Settings");
  assert.equal(requests[1].correlationId, null);
});
```

In `test/helpers/useAudioRecordingClipboardPersistence.test.js`, let `mountCompletionHarness` (`:64-173`) wire the two Agent callbacks:
- Add `onAssistantCommand = NOOP`, `onOnboardingAssistantCommand = NOOP` and `onboardingCompleted = false` to its options.
- Pass `initialStorage: onboardingCompleted ? { onboardingCompleted: "true" } : {}` to `installBrowserGlobals`.
- Render `useAudioRecording(NOOP, { onDemoEvent: NOOP, onAssistantCommand, onOnboardingAssistantCommand })`.

Then add:

```js
for (const [destination, onboardingCompleted] of [
  ["the assistant panel", true],
  ["the onboarding demo", false],
]) {
  test(`an Agent command reaches ${destination} with its dictation operation`, async (t) => {
    const commands = [];
    const operation = Object.freeze({
      sessionId: "rec-4",
      settings: Object.freeze({ snippets: [], dictationAgentMode: "local" }),
    });
    const harness = await mountCompletionHarness(t, {
      settings: {},
      onboardingCompleted,
      onAssistantCommand: (command) => commands.push(command),
      onOnboardingAssistantCommand: (command) => commands.push(command),
    });
    await harness.complete({
      success: true,
      text: "draft a reply",
      assistantConversation: { transcript: "draft a reply", screenContext: null, operation },
    });
    assert.equal(commands.length, 1);
    assert.equal(commands[0].text, "draft a reply");
    assert.equal(commands[0].operation, operation);
  });
}
```

Add to `test/helpers/assistantPanel.test.js`:

```js
test("a voice command keeps its dictation operation until the panel sends it", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installInteractiveDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-assistant-operation-hook-test-" });
  const { useAssistantPanel } = await vite.ssrLoadModule("/hooks/useAssistantPanel.js");
  const { createRoot } = require("react-dom/client");
  let assistant;
  function Harness() {
    assistant = useAssistantPanel({
      requestMainWindowSize: async () => ({ success: true }),
      dictationErrorActionCount: 0,
      recordingControlsRef: { current: null },
    });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const operation = { sessionId: "rec-5", settings: { dictationAgentMode: "local" } };
  await React.act(async () => {
    assistant.handleCommand({ text: "draft a reply", attachment: null, selectedContext: null, delivery: null, operation });
  });
  assert.equal(assistant.pendingCommand.operation, operation);
  await React.act(async () => {
    assistant.handleCommand({ text: "another", attachment: null, selectedContext: null, delivery: null });
  });
  assert.equal(assistant.pendingCommand.operation, null);
});

test("the panel sends a voice command with its dictation operation", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installInteractiveDom(t);
  const sent = [];
  globalThis.__assistantPanelSent = sent;
  t.after(() => {
    delete globalThis.__assistantPanelSent;
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-assistant-panel-operation-test-",
    mockModules: {
      "/components/icons": `
        import React from "react";
        const Icon = () => React.createElement("span");
        export const Check = Icon;
        export const Copy = Icon;
        export const Plus = Icon;
        export const X = Icon;
      `,
      "/chat/useChatPersistence": `
        import { useState } from "react";
        export function useChatPersistence() {
          const [messages, setMessages] = useState([]);
          return {
            messages,
            setMessages,
            conversationId: null,
            async createConversation() { return 1; },
            async loadConversation() {},
            saveUserMessage() {},
            saveAssistantMessage() {},
            handleNewChat() {},
          };
        }
      `,
      "/chat/useChatStreaming": `
        export function useChatStreaming() {
          return { agentState: "idle", activeToolName: null, toolStatus: "", cancelStream() {} };
        }
      `,
      "/chat/useChatMessageSender": `
        export function useChatMessageSender() {
          return async (text, options) => {
            globalThis.__assistantPanelSent.push({ text, options });
            return true;
          };
        }
      `,
      "/chat/ChatInput": `
        import React from "react";
        export function ChatInput() { return React.createElement("input"); }
      `,
      "/dictation/AssistantEmptyState": `
        import React from "react";
        export function AssistantEmptyState() { return React.createElement("div", null, "Empty state"); }
      `,
      "/dictation/BrandMarkIcon": `
        import React from "react";
        export function BrandMarkIcon() { return React.createElement("span"); }
      `,
      "/ui/MarkdownRenderer": `
        import React from "react";
        export function MarkdownRenderer({ content }) { return React.createElement("div", null, content); }
      `,
      "/ui/button": `
        import React from "react";
        export function Button(props) { return React.createElement("button", props); }
      `,
      "/hooks/useWindowDrag": `
        export function useWindowDrag() { return { handleMouseDown() {}, handleMouseUp() {} }; }
      `,
      "/hooks/useCopyFeedback": `
        export function useCopyFeedback() {
          return { copied: false, async copy() {}, confirmCopied() {} };
        }
      `,
      "/stores/settingsStore": `
        const state = { voiceAgentKey: [] };
        export function useSettingsStore(selector) { return selector(state); }
      `,
      "/utils/hotkeys": `
        export function formatHotkeyListLabel() { return ""; }
      `,
      "/ui/useToast": `
        export function useToast() { return { toast() {} }; }
      `,
    },
  });
  const [{ default: viteI18next }, { initReactI18next }] = await Promise.all([
    vite.ssrLoadModule("i18next"),
    vite.ssrLoadModule("react-i18next"),
  ]);
  const translation = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8")
  );
  await viteI18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation } },
    interpolation: { escapeValue: false },
  });
  const { AssistantPanel } = await vite.ssrLoadModule("/components/dictation/AssistantPanel.tsx");
  const { createRoot } = require("react-dom/client");
  const operation = { sessionId: "rec-6", settings: { dictationAgentMode: "local" } };
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(AssistantPanel, {
        pendingCommand: { id: 1, text: "draft a reply", attachment: null, selectedContext: null, delivery: null, operation },
        onCommandConsumed: noop,
        onCommandDiscarded: noop,
        onCommandSettled: noop,
        initialConversationId: null,
        onConversationIdChange: noop,
        voiceState: "idle",
        thinking: false,
        open: true,
        footerPhase: "pill",
        horizontalDirection: "right",
        onClose: noop,
        onBusyChange: noop,
        onResponseReadyChange: noop,
        onResponseContent: noop,
        onConversationReset: noop,
        onSelectionContextChange: noop,
      })
    )
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "draft a reply");
  assert.equal(sent[0].options.operation, operation);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/dictationSession.test.js test/helpers/audioManagerSessionRoute.test.js test/helpers/dictationOperationHandoff.test.js test/helpers/useAudioRecordingClipboardPersistence.test.js test/helpers/assistantPanel.test.js`
Expected: FAIL. Vite cannot load `/helpers/dictationSession.js`, `realSettingsStoreSource` is not exported, and the hook and panel tests see no `operation`.

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

/**
 * The dictation's route for work that outlives its pipeline: the assistant
 * panel answers a banked Agent command on it (R1-C2). Credential-free, because
 * `session.settings` is.
 */
export function sessionOperation(session) {
  return Object.freeze({ sessionId: session.id, settings: session.settings });
}

/**
 * What the user pointed at when this dictation started: the OS selection read
 * and the screenshot, both requested at press time. One session owns them.
 * They move with the session into the cancel buffer and back on Undo (Task 8),
 * and are released when the session or its undo window ends.
 */
export function createSessionContext({ sessionId, selection = null, screen = null }) {
  let selectionRead = selection;
  let screenRead = screen;
  let restored = false;
  let released = false;
  return {
    sessionId,
    get restored() {
      return restored;
    },
    get released() {
      return released;
    },
    selection: () => selectionRead,
    /** Keep the first read this session takes; a later read never replaces it. */
    adoptSelection(read) {
      if (!released && !selectionRead && read) selectionRead = read;
      return read;
    },
    screen: () => screenRead,
    markRestored() {
      restored = true;
    },
    release() {
      released = true;
      selectionRead = null;
      screenRead = null;
    },
  };
}
```

In `test/helpers/harness/audioManager.js`, add this helper and export it next to `loadAudioManager`:

```js
// The real settings store, with the suite's settings over its real defaults.
// Route selectors and Plan 03's route graph read the whole state, so suites
// that exercise routing use this instead of the default stub.
function realSettingsStoreSource(settingsKey) {
  return `
    export * from "/stores/settingsStore.ts";
    import { useSettingsStore } from "/stores/settingsStore.ts";
    export const getSettings = () => ({ ...useSettingsStore.getState(), ...globalThis.${settingsKey} });
  `;
}

module.exports = { loadAudioManager, realSettingsStoreSource };
```

The local `getSettings` export shadows the star export. The `.ts` specifier does not end with the mocked suffix `/stores/settingsStore`, so it resolves to the real module.

- [ ] **Step 4: Thread the session through `AudioManager`**

1. **Plumbing.** Add `import { captureDictationSession, createSessionContext, sessionOperation, sessionSettings } from "./dictationSession";`, then add these methods near `getStreamingProviderName` (`:821`):

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
       // The hook requested both reads at press time (useAudioRecording.js:170-179), before this start.
       this._sessionContext?.release();
       this._sessionContext = createSessionContext({
         sessionId: this._activeSession.id,
         selection: this.selectionCapturePromise,
         screen: this.screenContextPromise,
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

     /** Undo's entry point (Task 8): the session, its intents and the reads it took at press time. */
     applySessionIntents(session, { context = null } = {}) {
       this._activeSession = session;
       this.voiceAgentRequested = session.intents.voiceAgentRequested;
       this.translationRequested = session.intents.translationRequested;
       this.assistantSelectionContext = session.intents.assistantSelectionContext;
       if (this._sessionContext && this._sessionContext !== context) this._sessionContext.release();
       this._sessionContext =
         context?.sessionId === session.id ? context : createSessionContext({ sessionId: session.id });
       // A restored session never reads the OS selection or the screen again.
       this._sessionContext.markRestored();
     }
   ```

   The `applySessionIntents` assignments must not go through `setVoiceAgentRequested`, because that setter (`:707-720`) also clears pending selection and screen state.
2. **Start points.**
   - In `startRecording`, after the guard at `:1144-1153` passes, call `this.beginDictationSession({ streaming: false, streamingProviderName: null });`.
   - In `startStreamingRecording`, after its guard (`:3422-3430`), resolve the provider from **live** settings before the new session exists, then begin it:

     ```js
         this._activeSession = null; // never let the previous session's pin leak into a new start
         const streamingProviderName = resolveStreamingProviderName({ settings: getSettings(), context: "dictation" });
         this.beginDictationSession({ streaming: true, streamingProviderName });
     ```

   - **A session ends at the idle edge, and its reads go with it.** Add:

     ```js
       _endDictationSession(session) {
         if (!session || this._activeSession !== session) return;
         this._activeSession = null;
         if (this._sessionContext?.sessionId === session.id) {
           this._sessionContext.release(); // drop the selection text and the screenshot with the session
           this._sessionContext = null;
         }
       }

       /** Cancel's exit point (Task 8): end the session, but keep what it read for Undo. */
       _detachSessionOperation() {
         const session = this._activeSession;
         const context = session && this._sessionContext?.sessionId === session.id ? this._sessionContext : null;
         if (context) this._sessionContext = null; // the cancel buffer owns it now
         this._endDictationSession(session);
         return { session, context };
       }
     ```

     Call `this._endDictationSession(this._activeSession)` in three places:
     - in `_settleProcessingPipeline` (`:1735`) when it settles the active pipeline;
     - in the `finally` of `stopStreamingRecording` (3745–3760) where it reports idle;
     - in the idle branch of `cancelRecording` / `cancelStreamingRecording`. Task 8 hands the session and its context to the cancel buffer first, through `_detachSessionOperation()`.

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
   | `processTranscriptionCore` `:2593-2600` | `const settings = this.settings();`, `const cleanupModel = selectResolvedLLMConfig(settings, "dictationCleanup").model;`, `const agentName = this._activeSession?.agentName ?? getAgentName();` (import `selectResolvedLLMConfig` from the settings store) |
   | `isReasoningAvailable` `:2443` | `const s = this.settings();` and `ReasoningService.isAvailable(s)` (see 5) |
   | `processWithReasoningModel` `:2248` | `dictationAgentPrompt(this.settings(), agentName)` |
   | `_bankPanelAgentCommand` `:2301` | `this.settings()` |
   | `consumeSelectionCapture` `:768-777` | rewritten in item 7 |
   | `processAgentCommand` `:2345` | `this.settings().autoPasteEnabled` |
   | `finalizeChineseScript` `:608` / `getEffectiveOutputLanguage` `:584` | default `settings = this.settings()` |
   | `getStreamingProviderName` `:821` | `return this._activeSession?.intents.streamingProviderName ?? resolveStreamingProviderName({ settings: this.settings(), context: "dictation" })` |
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

   - Agent and translation configs already carry `provider` / `lanUrl` / `baseUrl` / `credentialRef` (`dictationAgentInference.js:47-54`, `dictationTranslationInference.js:30-41`). Add `settingsView: settings` to each in `resolveReasoningRoute`.
   - Every text request of the dictation goes through `processWithReasoningModel` (`:2199`): cleanup, both translation steps (`:2507`, `:2518`) and the selection edit (`:2419`). Stamp the correlation id there once, directly after the `CALLING_REASONING_SERVICE` log (`:2200-2205`):

     ```js
         // Every text request of this dictation names it (§5.4). The text-only
         // retry below spreads the same config, so it carries the id too.
         config = { ...config, correlationId: config?.correlationId ?? this._activeSession?.id ?? null };
     ```

5. **ReasoningService and prompts.**
   - `ReasoningService.processText` (`:64-141`): replace `const settings = getSettings();` with `const settings = config.settingsView ?? getSettings();`. The implicit branch stays for non-dictation callers.
   - `isAvailable(settingsView?)`: read `settingsView ?? getSettings()`.
   - `requestConfig` (`:38-62`): add `correlationId: config.correlationId ?? null` to the request object.
   - `ReasoningConfig` (`BaseReasoningService.ts:8-30`): add `settingsView?: Record<string, unknown>;` and `correlationId?: string | null;`.
   - `BaseReasoningService.get*` (`:33-58`): each getter reads `this.config?.settingsView ?? getSettings()`. If the getters do not receive `config`, change their signatures to take it from `processText`, the only caller on this path.
   - `src/config/prompts/index.ts`: `resolvePrompt(kind, opts)` uses `opts.customPrompts ?? useSettingsStore.getState().customPrompts`.
   - `dictationAgentPrompt(settings, agentName)` (`audioManager.js:140-147`) and the translate prompt in `resolveReasoningRoute` (`:231-247`) pass `customPrompts: settings.customPrompts`.
6. **Correlation id across IPC.**
   - `src/helpers/ipcHandlers.js:7963-7989`: add `correlationId` to the destructured `transcribe-audio-file-byok` arguments and pass it to the job registration and to any egress gate call Plan 07 has installed.
   - `src/helpers/personalInference.js` `validateRequest` (`:93-171`): accept an optional `correlationId` string of at most 100 characters (`throw new Error("Invalid correlation id.")` otherwise).
   - `src/services/ai/personalInferenceTypes.ts` `TextRequest` (`:6-20`): add `correlationId?: string | null`.
   - `buildStreamingSessionOptions` (`dictationStreamingRouting.js:49-71`) passes `correlationId` through, and the hardened `dictation-realtime-start` allowlist (`ipcHandlers.js`, see the #1624 comment at `:300-302`) admits it. The per-provider start channels (Deepgram, AssemblyAI, Gemini, Corti) admit it too.
   - `test/helpers/audioManagerStreamingRouting.test.js` pins that allowlist; extend it with the new field.
7. **The whole operation (R1-C2).**
   - **The session's reads.** Add the ownership check, and read the selection and the screenshot through the session context:

     ```js
       _ownedSessionContext() {
         const context = this._sessionContext;
         return context && !context.released && context.sessionId === this._activeSession?.id ? context : null;
       }

       consumeSelectionCapture() {
         const pending = this.selectionCapturePromise;
         this.selectionCapturePromise = null;
         const context = this._ownedSessionContext();
         const original = context?.selection();
         if (original) return original; // the press-time read; Undo hands back the same one
         // A restored session never reads the OS selection again: what is selected
         // now is not what the user pointed at. Its command goes to the panel as a
         // standalone command, which types nothing.
         if (context?.restored) return Promise.resolve({ status: "none" });
         const read =
           pending ??
           window.electronAPI?.captureSelectedText?.({
             probeEditable: Boolean(this.settings().autoPasteEnabled),
           });
         return context ? context.adoptSelection(read) : read;
       }
     ```

     In `consumeScreenContext` (`:779-795`), replace its first two lines with:

     ```js
         // The press-time screenshot; a restored session gets the same one.
         const pending = this._ownedSessionContext()?.screen() ?? this.screenContextPromise;
         this.screenContextPromise = null;
     ```

     `_requestStreamingCancellation` (`:3768-3779`) still clears the raw promises, and the context keeps its own references. A main-side selection capture is single-use and lives 5 minutes (`selectionManager.js:5`, `:220-221`). `replaceSelectedText` and `pasteAtCapturedTarget` re-read the original target and refuse a changed target or text (`:226-235`, `:271-274`).
   - **The banked command carries the operation.** In `_bankAssistantDirective` (`:2262-2275`), add the operation as the last field of `pendingAssistantConversation`:

     ```js
         const session = this._activeSession;
         this.pendingAssistantConversation = {
           transcript,
           screenContext: config?.rawScreenContext ?? null,
           ...(selectedContext ? { selectedContext } : {}),
           ...(deliverySessionId ? { deliverySessionId } : {}),
           // The panel answers on this dictation's route, never on Settings changed since (R1-C2).
           ...(session ? { operation: sessionOperation(session) } : {}),
         };
     ```

   - **`useAudioRecording.js:474-504`.** Take `operation` from `result.assistantConversation`, expand snippets with the session's own, and put it on the command. Both the panel path (`:495`) and the onboarding path (`:492`) then receive it:

     ```js
             const { screenContext, transcript, selectedContext, deliverySessionId, operation } =
               result.assistantConversation;
             const command = {
               text: expandSnippets(transcript, operation?.settings?.snippets ?? getSettings().snippets),
               attachment: screenContext
                 ? { image: screenContext.data, mediaType: screenContext.mediaType }
                 : null,
               // The dictation's credential-free route (Task 6); the panel's request resolves from it.
               operation: operation ?? null,
             };
     ```

   - **`useAssistantPanel.js:135-151`.** In `handleCommand`, add `operation: command.operation ?? null,` to the object passed to `setPendingCommand`.
   - **`AssistantPanel.tsx`.** Add `operation: DictationOperation | null;` to `AssistantCommand` (`:46-52`), with `import type { DictationOperation } from "../chat/useChatStreaming";`. In the pending-command effect, add `operation: pendingCommand.operation ?? undefined,` to the options passed to `sendMessage` (`:205-209`). `useChatMessageSender` already passes its options to `sendToAI` unchanged (`useChatMessageSender.ts:58-79`).
   - **`useChatStreaming.ts`.** Import `type SettingsState` with `getSettings` (`:15`). Add the type and the option after `SendToAIOptions`'s `onComplete` (`:84-97`):

     ```ts
     /** A spoken command's dictation: its session id and credential-free route snapshot (Plan 04 Task 6). */
     export interface DictationOperation {
       sessionId: string;
       settings: Readonly<Record<string, unknown>>;
     }
     ```

     ```ts
       /** Resolve this request's route from its dictation, not from live Settings. */
       operation?: DictationOperation;
     ```

     At `:233`:

     ```ts
           // A spoken command answers on the route its dictation started with
           // (R1-C2). Keys are never in the snapshot, so live credentials apply.
           const settings = (
             options?.operation ? { ...getSettings(), ...options.operation.settings } : getSettings()
           ) as SettingsState;
     ```

     In the `processTextStreamingAI` config (`:380-397`), add `correlationId: options?.operation?.sessionId ?? null,`.
   - **`useOnboardingAssistantDemo.ts`.** Add `operation?: DictationOperation | null;` to `OnboardingAssistantCommand` (`:8-11`), importing the type from `../components/chat/useChatStreaming`. Add `operation: command.operation ?? undefined,` to the `sendToAI` options (`:58-60`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/dictationSession.test.js test/helpers/audioManagerSessionRoute.test.js test/helpers/dictationOperationHandoff.test.js test/helpers/useAudioRecordingClipboardPersistence.test.js test/helpers/assistantPanel.test.js "test/helpers/audioManager*.test.js" "test/helpers/useAudioRecording*.test.js" "test/helpers/useChatStreaming*.test.js" "test/services/*.test.js"`
Expected: PASS. If an existing reasoning test asserted the implicit cleanup provider, update it to the explicit config: the provider and endpoint are the same values, now passed in. `audioManagerAssistantDirective.test.js` builds managers without a session, so its banked directives stay without `operation`.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/dictationSession.js src/helpers/audioManager.js src/services src/config/prompts/index.ts src/helpers/ipcHandlers.js src/helpers/personalInference.js src/helpers/dictationStreamingRouting.js src/hooks/useAudioRecording.js src/hooks/useAssistantPanel.js src/hooks/useOnboardingAssistantDemo.ts src/components/dictation/AssistantPanel.tsx src/components/chat/useChatStreaming.ts test
git commit -m "feat(voice): dictation sessions pin their route and their Agent operation at recording start"
```

---

### Task 7: Who already received it: shared types and attested disclosure

Closes review finding I5 (round 2: R1-I5) and R2-I1, and settles the disclosure shape with Plan 07 (CCR-6).

"OpenAI already received the audio" is a claim about egress, so main must attest it. When Plan 07's egress gate is present, evidence comes **only** from main's `EgressNotice`s for this session's `correlationId` with a content payload (spec §5.4):
- `delivered` means `attested` ("already received");
- `dispatched` means `dispatched` ("may have received");
- `undelivered` withdraws that ticket's evidence; other tickets of the session still count;
- `metadata` never counts.

Renderer-side records are then ignored. The gate is absent only if Plan 07 has not merged. The renderer then records evidence only from **main's transport hand-off** (R1-I5):
- Main sends `dictation-dispatch` `{ correlationId, task, payload }` to the requesting window immediately before a provider request leaves. That covers the BYOK upload and every cleanup, translation, Agent and vision text request, Codex included.
- The renderer never infers dispatch from a result or an error. A renderer-side failure before IPC, a main rejection, a refused route, a missing key and a cancel before the upload all record nothing.
- A cancel during a slow upload discloses as soon as the upload starts, not when the response settles.
- Realtime streaming records once `provider.start()` resolves successfully. Main answers the start only after the socket has connected, and the frames sent while it connected are already queued in main (`ipcHandlers.js:7053-7056`).
- The copy then says "may have received", never "already received".

Sealed-mode blocks record nothing either way. Provider-mode custom endpoints on loopback resolve to the device through Plan 03's resolver (§5.1 rule 10), so they never produce a disclosure.

**Route capture (R2-I1).** Each session resolves its five disclosure routes once, at start, with Plan 03's published imperative reader `routeSnapshotFromSettings(settings)` (§5.1; Plan 03 Task 3). It builds the complete `RouteSettingsSnapshot` from the current route facts, the sealed store and i18n, with no IPC and no subscription. The session passes it the live settings overlaid with its own snapshot: the same view every pipeline read uses. Facts the overlay window has not loaded only make a route's `state` `unknown`, because `locality` and `providerId` come from settings. Those two fields are all the tracker and Task 8's sealed pre-check read. A reader failure must never block a dictation. The session then has `routes: null`, and the tracker discloses every hand-off as an unknown provider: it fails toward disclosure (D4).

**Files:**
- Create: `src/types/dictation.ts`. These are the shared §5.2 types (CCR-1 to CCR-3, CCR-6) that Plans 05 and 07 import, plus the hand-off event.
- Create: `src/helpers/dictationDisclosure.js`
- Modify: `src/helpers/dictationSession.js`. `captureDictationSession` also stores `session.routes`: the Plan 03 `ResolvedRoute` for `dictationStt`, `dictationCleanup`, `translation`, `voiceAssistant` and `assistantVision`, from `routeSnapshotFromSettings`.
- Modify: `src/helpers/audioManager.js`:
  - add the per-session disclosure tracker;
  - record the streaming start;
  - tag each text route config with its `disclosureTask` (`resolveReasoningRoute`, `:159-289`).
- Modify: `src/services/ReasoningService.ts:38-62`, `src/services/BaseReasoningService.ts:8-30`, `src/services/ai/personalInferenceTypes.ts:6-20`. A text request carries `disclosureTask`.
- Modify: `src/helpers/personalInference.js`. `validateRequest` (`:93-171`) checks `disclosureTask`. `execute` (`:347-512`) sends the hand-off right before `codex.generate` (`:392`), `streamText` (`:471`) and `generateText` (`:489`).
- Modify: `src/helpers/ipcHandlers.js` `transcribe-audio-file-byok` (`:7963-8312`). Send the hand-off right before each of its five provider requests (`:8089`, `:8118`, `:8131`, `:8146`, `:8241`).
- Modify: `preload.js`. Add `onDictationDispatch` after `transcribeAudioFileByok` (`:703`).
- Modify: `src/types/electron.ts`. Declare `onDictationDispatch?` after `transcribeAudioFileByok?` (`:1713-1738`).
- Test: `test/helpers/dictationDisclosure.test.js`
- Modify: `test/helpers/dictationSession.test.js`, `test/helpers/personalInferenceTransport.test.js`, `test/helpers/retryTranscriptionHandler.test.js`

**Interfaces:**
- Consumes, from Plan 03 (`src/lib/routes.ts`, §5.1): `routeSnapshotFromSettings(settings: SettingsState): RouteSettingsSnapshot` and `resolveRoute(snapshot, id): ResolvedRoute`. For tests: `useRouteFactsStore` and `EMPTY_ROUTE_FACTS` (`src/stores/routeFactsStore.ts`), `useSealedStore` (`src/stores/sealedStore.ts`).
- Produces `src/types/dictation.ts`:

  ```ts
  export type DisclosurePayload = "audio" | "text" | "image";
  export type DisclosureTask = "dictationStt" | "dictationCleanup" | "translation" | "voiceAssistant" | "assistantVision";
  /** Who already received part of a dictation. `target` is a provider id ("openai", "custom") or "host:<hostname>"
   *  for the user's own server on the network. Render it with dispatchTargetLabel(target, t). */
  export interface RemoteDisclosure {
    target: string;
    payload: DisclosurePayload;          // strongest seen: audio > image > text
    evidence: "attested" | "dispatched"; // attested = main's EgressNotice; dispatched = main's transport hand-off
    alsoSentTo: string[];                // every other target that received part of this dictation (never hidden)
  }
  /** Main → the requesting window, immediately before a provider request leaves. The no-Plan-07 evidence. */
  export interface DictationDispatch {
    correlationId: string;
    task: DisclosureTask;
    payload: DisclosurePayload;
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
  export function createDisclosureTracker({ session, onChange, privacyApi?, dispatchApi? }): {
    record({ task, payload, evidence }): void;      // renderer-side; ignored once main's egress feed is attached
    applyEgress(notice: EgressNotice): void;        // main's feed (§5.4); keeps per-ticket state
    get(): RemoteDisclosure | null; attested(): boolean;
    setOnChange(fn): void; dispose(): void;         // dispose also detaches both of main's feeds
  };
  // The tracker attaches itself at creation: privacyApi defaults to window.electronAPI.privacy,
  // dispatchApi to window.electronAPI. Its tickets live as long as the tracker, so a restored session keeps them (Task 8).
  export function attachEgressEvidence(tracker, sessionId, privacyApi?): () => void;   // no-op when Plan 07 is absent
  export function attachDispatchEvidence(tracker, sessionId, dispatchApi?): () => void; // main's hand-off; record() ignores it under Plan 07
  ```

- Produces, main → renderer: the `dictation-dispatch` event (`DictationDispatch`), and `window.electronAPI.onDictationDispatch(cb): () => void`.
- Produces, on `TextRequest` / `ReasoningConfig`: `disclosureTask?: DisclosureTask | null`. Main validates it and echoes it in the hand-off. Without both `correlationId` and `disclosureTask`, a text request is never handed off, so typed chat and the panel's later requests produce no dictation evidence.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/dictationDisclosure.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { loadAudioManager, realSettingsStoreSource } = require("./harness/audioManager");

const load = () => import("../../src/helpers/dictationDisclosure.js");
const route = (id, locality, providerId = null) => ({ id, locality, providerId, provider: null, state: { status: "ready" } });
const session = (routes) => ({ id: "rec-1", routes, settings: { remoteTranscriptionUrl: "http://gpu-box.lan:8080/v1", cleanupRemoteUrl: "http://10.0.0.5:11434/v1" } });
const handOffBus = () => {
  const bus = new EventEmitter();
  return { bus, dispatchApi: { onDictationDispatch: (cb) => (bus.on("d", cb), () => bus.off("d", cb)) } };
};

test("targets come from the session's resolved route: device is silent, network is a host, remote is a provider id", async () => {
  const { disclosureTargetFor } = await load();
  const s = session({});
  assert.equal(disclosureTargetFor(route("dictationStt", "device"), s.settings), null);
  assert.equal(disclosureTargetFor(route("dictationStt", "network"), s.settings), "host:gpu-box.lan");
  assert.equal(disclosureTargetFor(route("dictationCleanup", "network"), s.settings), "host:10.0.0.5");
  assert.equal(disclosureTargetFor(route("dictationStt", "remote", "openai"), s.settings), "openai");
  assert.equal(disclosureTargetFor(route("dictationStt", "remote", null), s.settings), "", "unknown remote still discloses");
});

test("a loopback custom endpoint resolves to the device and never discloses (§5.1 rule 10)", async () => {
  const { disclosureTargetFor } = await load();
  // Plan 03's resolver reports provider-mode custom on localhost as device.
  assert.equal(disclosureTargetFor(route("dictationCleanup", "device", null), {}), null);
});

test("labels are localised through providerDisplayLabel", async () => {
  const { dispatchTargetLabel, disclosureCopy } = await load();
  const t = (k, o) => (o ? `${k}|${o.provider}` : k);
  assert.equal(dispatchTargetLabel("openai", t), "OpenAI");
  assert.equal(dispatchTargetLabel("host:gpu-box.lan", t), "gpu-box.lan");
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

test("an attested receiver is never downgraded by a later renderer-side record", async () => {
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

test("a session whose routes could not be resolved discloses as an unknown provider (D4)", async () => {
  const { createDisclosureTracker } = await load();
  const tracker = createDisclosureTracker({ session: { id: "rec-1", routes: null, settings: {} } });
  tracker.record({ task: "dictationCleanup", payload: "text", evidence: "dispatched" });
  assert.deepEqual(tracker.get(), { target: "", payload: "text", evidence: "dispatched", alsoSentTo: [] });
});

test("main's hand-off (no Plan 07) records may-have for this session only; dispose detaches it", async () => {
  const { createDisclosureTracker } = await load();
  const s = session({ dictationStt: route("dictationStt", "remote", "openai"), dictationCleanup: route("dictationCleanup", "device") });
  const { bus, dispatchApi } = handOffBus();
  const tracker = createDisclosureTracker({ session: s, dispatchApi });
  bus.emit("d", { correlationId: "rec-2", task: "dictationStt", payload: "audio" });
  bus.emit("d", { correlationId: "rec-1", task: "dictationCleanup", payload: "text" });
  bus.emit("d", { correlationId: "rec-1", task: "chat", payload: "text" });
  assert.equal(tracker.get(), null, "another session, a device route and an unknown task disclose nothing");
  bus.emit("d", { correlationId: "rec-1", task: "dictationStt", payload: "audio" });
  assert.deepEqual(tracker.get(), { target: "openai", payload: "audio", evidence: "dispatched", alsoSentTo: [] });
  tracker.dispose();
  assert.equal(bus.listenerCount("d"), 0);
});

test("main's egress feed (§5.4): delivered attests, dispatched may-have, undelivered withdraws its ticket", async () => {
  const { createDisclosureTracker, attachEgressEvidence } = await load();
  const s = session({ dictationStt: route("dictationStt", "remote", "openai") });
  const bus = new EventEmitter();
  const privacy = { onEgress: (cb) => (bus.on("n", cb), () => bus.off("n", cb)) };
  const handOff = handOffBus();
  const tracker = createDisclosureTracker({ session: s, privacyApi: privacy, dispatchApi: handOff.dispatchApi });
  const n = (o) =>
    bus.emit("n", { task: "dictationStt", targetId: "openai", host: "api.openai.com", payload: "audio", correlationId: "rec-1", ts: 1, ...o });

  n({ phase: "delivered", ticketId: 1, payload: "metadata" });
  n({ phase: "delivered", ticketId: 2, correlationId: "rec-2" });
  bus.emit("n", { phase: "recorded", event: { id: 1 } });
  assert.equal(tracker.get(), null, "token fetches, other sessions and flight-recorder rows do not count");
  tracker.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" });
  handOff.bus.emit("d", { correlationId: "rec-1", task: "dictationStt", payload: "audio" });
  assert.equal(tracker.get(), null, "with Plan 07 present, only main's egress notices count");

  n({ phase: "dispatched", ticketId: 3 });
  assert.deepEqual(tracker.get(), { target: "openai", payload: "audio", evidence: "dispatched", alsoSentTo: [] });
  n({ phase: "undelivered", ticketId: 3 });
  assert.equal(tracker.get(), null, "an undelivered ticket withdraws its own dispatched evidence");

  n({ phase: "dispatched", ticketId: 4 });
  n({ phase: "dispatched", ticketId: 5 });
  n({ phase: "undelivered", ticketId: 5 });
  assert.equal(tracker.get().evidence, "dispatched", "another ticket of the session still counts");
  n({ phase: "delivered", ticketId: 4 });
  assert.deepEqual(tracker.get(), { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: [] });
  assert.equal(tracker.attested(), true);
  n({ phase: "undelivered", ticketId: 4 });
  assert.equal(tracker.get().evidence, "attested", "delivered is final");

  n({ phase: "dispatched", ticketId: 6, task: "dictationCleanup", targetId: "host:gpu-box.lan", payload: "text" });
  assert.deepEqual(tracker.get().alsoSentTo, ["host:gpu-box.lan"]);

  tracker.dispose();
  assert.equal(bus.listenerCount("n"), 0, "dispose detaches main's egress feed");
  assert.equal(handOff.bus.listenerCount("d"), 0, "and its hand-off feed");
  assert.equal(attachEgressEvidence(tracker, "rec-1", undefined)(), undefined, "absent Plan 07 is a no-op");
});
```

Add these AudioManager cases to the same file. They run the real `processWithOpenAIAPI`, `processWithReasoningModel` and `ReasoningService`, on the real settings store and the real Plan 03 route graph. Only the IPC leaves are fakes, and `bus` stands in for main's `dictation-dispatch` event.

```js
const REMOTE_STT = { useLocalWhisper: false, transcriptionMode: "providers", cloudTranscriptionProvider: "openai", cloudTranscriptionModel: "whisper-1" };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const blob = () => new Blob([new Uint8Array(8)], { type: "audio/webm" });

async function managerWith(t, electronAPI, { mockModules = {} } = {}) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-disclosure-",
    settingsKey: "__disclosureSettings",
    settings: REMOTE_STT,
    mockModules: { "/stores/settingsStore": realSettingsStoreSource("__disclosureSettings"), ...mockModules },
  });
  const bus = new EventEmitter();
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    cancelUploadTranscription: () => {},
    onDictationDispatch: (cb) => (bus.on("d", cb), () => bus.off("d", cb)),
    ...electronAPI(bus),
  };
  const manager = loaded.createManager({ isProcessing: true });
  manager.beginDictationSession({}); // the tracker subscribes to main's hand-off here
  return { ...loaded, manager, bus };
}

test("a held upload discloses when main hands it off, before the provider answers", async (t) => {
  let answer;
  const { manager } = await managerWith(t, (bus) => ({
    transcribeAudioFileByok: (payload) => {
      bus.emit("d", { correlationId: payload.correlationId, task: "dictationStt", payload: "audio" });
      return new Promise((resolve) => (answer = resolve));
    },
  }));
  const pending = manager.processWithOpenAIAPI(blob(), {}, () => false);
  while (!answer) await tick();
  assert.deepEqual(manager.getDisclosure(), { target: "openai", payload: "audio", evidence: "dispatched", alsoSentTo: [] });
  answer({ success: false, error: "Rate limit exceeded. Please try again later." });
  await assert.rejects(pending, /Rate limit/);
  assert.equal(manager.getDisclosure().evidence, "dispatched", "an error after the hand-off keeps the evidence");
});

test("an upload main refuses before sending discloses nothing", async (t) => {
  const { manager } = await managerWith(t, () => ({
    transcribeAudioFileByok: async () => ({ success: false, error: "Sealed mode is on", code: "SEALED_BLOCKED" }),
  }));
  await assert.rejects(manager.processWithOpenAIAPI(blob(), {}, () => false), /Sealed mode/);
  assert.equal(manager.getDisclosure(), null);
});

test("a cancelled start never reaches IPC and discloses nothing", async (t) => {
  let calls = 0;
  const { manager } = await managerWith(t, () => ({
    transcribeAudioFileByok: async () => (calls++, { success: true, text: "hello" }),
  }));
  await assert.rejects(manager.processWithOpenAIAPI(blob(), {}, () => true), { name: "AbortError" });
  assert.equal(calls, 0);
  assert.equal(manager.getDisclosure(), null);
});

test("a text request refused before IPC or by main discloses nothing", async (t) => {
  const { manager, vite } = await managerWith(
    t,
    () => ({
      personalInference: {
        onTextEvent: () => () => {},
        // Main's own rejection: no hand-off was sent (personalInference.js:409-411).
        textGenerate: async () => {
          throw new Error("Configure the anthropic API key in Settings.");
        },
      },
    }),
    { mockModules: { "/services/ReasoningService": 'export { default } from "/services/ReasoningService.ts";' } }
  );
  const reasoning = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => reasoning.destroy());
  const config = { provider: "anthropic", inferenceScope: "dictationCleanup", disclosureTask: "dictationCleanup", systemPrompt: "Clean up." };
  // ReasoningService.ts:47 and :44-45: renderer-side failures before IPC.
  await assert.rejects(manager.processWithReasoningModel("hello", "", "Loqui", config), /No reasoning model selected/);
  await assert.rejects(
    manager.processWithReasoningModel("hello", "m", "Loqui", { ...config, provider: "not-a-provider" }),
    /Unsupported reasoning provider/
  );
  await assert.rejects(manager.processWithReasoningModel("hello", "claude", "Loqui", config), /Configure the anthropic API key/);
  assert.equal(manager.getDisclosure(), null);
});
```

Add the route cases to `test/helpers/dictationSession.test.js` (R2-I1). They load the **real** Plan 03 modules through the renderer harness, with no mocks:

```js
const { loadAudioManager, realSettingsStoreSource } = require("./harness/audioManager");

test("the session resolves its routes through Plan 03's reader: local, provider, network and unknown facts", async (t) => {
  const { vite, captureDictationSession } = await load(t);
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore, EMPTY_ROUTE_FACTS } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const { useSealedStore } = await vite.ssrLoadModule("/stores/sealedStore.ts");
  const base = useSettingsStore.getState();
  const routesFor = (overrides) =>
    captureDictationSession({ settings: { ...base, ...overrides }, intents: {}, agentName: "Loqui" }).routes;
  // The overlay window may never load route facts: every fact unknown.
  useRouteFactsStore.setState({ facts: EMPTY_ROUTE_FACTS });

  const provider = routesFor({ transcriptionMode: "providers", useLocalWhisper: false, cloudTranscriptionProvider: "openai", cloudTranscriptionModel: "whisper-1" });
  assert.deepEqual(Object.keys(provider).sort(), ["assistantVision", "dictationCleanup", "dictationStt", "translation", "voiceAssistant"]);
  assert.equal(provider.dictationStt.locality, "remote");
  assert.equal(provider.dictationStt.providerId, "openai");
  assert.equal(provider.dictationStt.state.status, "unknown", "unknown facts are not ready, and the locality still holds");

  const local = routesFor({ transcriptionMode: "local", useLocalWhisper: true, localTranscriptionProvider: "whisper", whisperModel: "base", useCleanupModel: true, cleanupMode: "local", cleanupModel: "qwen3.5-2b-q4_k_m" });
  assert.equal(local.dictationStt.locality, "device");
  assert.equal(local.dictationCleanup.locality, "device");

  const network = routesFor({ transcriptionMode: "self-hosted", useLocalWhisper: false, remoteTranscriptionUrl: "http://192.168.1.20:8080", remoteTranscriptionModel: "whisper-1" });
  assert.equal(network.dictationStt.locality, "network");
  const loopback = routesFor({ transcriptionMode: "self-hosted", useLocalWhisper: false, remoteTranscriptionUrl: "http://127.0.0.1:8080", remoteTranscriptionModel: "whisper-1" });
  assert.equal(loopback.dictationStt.locality, "device", "§5.1 rule 10");

  const agent = routesFor({ useDictationAgent: true, dictationAgentMode: "providers", dictationAgentProvider: "anthropic", dictationAgentModel: "claude-sonnet-5" });
  assert.equal(agent.voiceAssistant.locality, "remote");
  assert.equal(agent.voiceAssistant.providerId, "anthropic");

  useSealedStore.setState({ sealed: true, known: true });
  const sealed = routesFor({ transcriptionMode: "providers", useLocalWhisper: false, cloudTranscriptionProvider: "openai", cloudTranscriptionModel: "whisper-1" });
  assert.deepEqual(sealed.dictationStt.state, { status: "unreachable", detail: "sealed" });
});

test("a route reader failure never blocks a dictation: the session starts without routes", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-dictation-session-reader-failure-",
    mockModules: {
      "/lib/routes": `
        export function routeSnapshotFromSettings() { throw new Error("route facts unavailable"); }
        export function resolveRoute() { throw new Error("unreachable"); }
      `,
    },
  });
  const { captureDictationSession } = await vite.ssrLoadModule("/helpers/dictationSession.js");
  const session = captureDictationSession({ settings: { useLocalWhisper: true }, intents: {}, agentName: "Loqui", id: "rec-x" });
  assert.equal(session.id, "rec-x");
  assert.equal(session.routes, null, "the tracker then discloses toward an unknown provider");
});

test("AudioManager's start path builds the session against the merged route module", async (t) => {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-session-routes-",
    settingsKey: "__sessionRoutesSettings",
    settings: { transcriptionMode: "providers", useLocalWhisper: false, cloudTranscriptionProvider: "groq", cloudTranscriptionModel: "whisper-large-v3" },
    mockModules: { "/stores/settingsStore": realSettingsStoreSource("__sessionRoutesSettings") },
  });
  const session = loaded.createManager().beginDictationSession({});
  assert.equal(session.routes.dictationStt.locality, "remote");
  assert.equal(session.routes.dictationStt.providerId, "groq");
  assert.equal(Object.isFrozen(session.routes.dictationStt), true);
});
```

Add these main-side cases to `test/helpers/personalInferenceTransport.test.js`. They use its `harness(t, behavior)` (`:6-108`), whose `wait` model holds the response until it is cancelled:

```js
test("a dictation text request is handed off before the provider answers (no Plan 07)", async (t) => {
  const { invoke, request, sender, modelCalls } = harness(t, { wait: true });
  const handOffs = [];
  const send = sender.send;
  sender.send = (channel, payload) => (channel === "dictation-dispatch" ? handOffs.push(payload) : send(channel, payload));
  const pending = invoke("text-generate", { ...request, correlationId: "rec-1", disclosureTask: "dictationCleanup" });
  while (modelCalls.length < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(handOffs, [{ correlationId: "rec-1", task: "dictationCleanup", payload: "text" }]);
  await invoke("text-cancel", request.requestId);
  await assert.rejects(pending, /abort/i);
});

test("a text request main rejects, or that names no dictation, is never handed off", async (t) => {
  const { invoke, request, sender } = harness(t);
  const handOffs = [];
  sender.send = (channel, payload) => channel === "dictation-dispatch" && handOffs.push(payload);
  await assert.rejects(
    invoke("text-generate", { ...request, model: " ", correlationId: "rec-1", disclosureTask: "dictationCleanup" }),
    /Choose a text model/
  );
  await assert.rejects(
    invoke("text-generate", { ...request, correlationId: "rec-1", disclosureTask: "chat" }),
    /Invalid disclosure task/
  );
  await invoke("text-generate", request); // typed chat: no correlation id
  assert.deepEqual(handOffs, []);
});
```

Add this case to `test/helpers/retryTranscriptionHandler.test.js`. It uses the registered handler and the deferrable `fetchResponse` (`:15-22`):

```js
test("captured dictation audio is handed off right before the upload, never on a refused route", async () => {
  fetches.length = 0;
  const handOffs = [];
  const sender = { isDestroyed: () => false, send: (channel, payload) => handOffs.push({ channel, payload }) };
  const upload = (payload) =>
    handlers.get("transcribe-audio-file-byok")(
      { sender },
      { audioBuffer: WAV_BUFFER, mimeType: "audio/wav", provider: "openai", model: "whisper-1", correlationId: "rec-1", ...payload }
    );
  const ok = fetchResponse;
  let respond;
  fetchResponse = () => new Promise((resolve) => (respond = resolve));
  try {
    const pending = upload({ requestId: "hand-off", transcriptionMode: "providers" });
    while (!respond) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(handOffs, [
      { channel: "dictation-dispatch", payload: { correlationId: "rec-1", task: "dictationStt", payload: "audio" } },
    ], "sent before the provider answered");
    respond(ok());
    assert.equal((await pending).success, true);
  } finally {
    fetchResponse = ok;
  }
  handOffs.length = 0;
  const refused = await upload({ requestId: "hand-off-refused", transcriptionMode: "openwhispr" });
  assert.equal(refused.success, false, "transcriptionRoute.ts:216 refuses a retired mode");
  assert.deepEqual(handOffs, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/dictationDisclosure.test.js test/helpers/dictationSession.test.js test/helpers/personalInferenceTransport.test.js test/helpers/retryTranscriptionHandler.test.js`
Expected: FAIL with `Cannot find module '…/dictationDisclosure.js'`. The session has no `routes`, and main sends no `dictation-dispatch`.

- [ ] **Step 3: Implement the types, the tracker and the session routes**

Create `src/types/dictation.ts` with exactly the Interfaces block above.

Create `src/helpers/dictationDisclosure.js`:

```js
import { providerDisplayLabel } from "../lib/locality";

export const PAYLOAD_RANK = { text: 1, image: 2, audio: 3 };
const DISCLOSURE_TASKS = new Set(["dictationStt", "dictationCleanup", "translation", "voiceAssistant", "assistantVision"]);

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
      // "host:<hostname>", the same encoding as main's EgressNotice.targetId (§5.4).
      return `host:${new URL(settingsView[NETWORK_URL_KEY[route.id]]).hostname}`;
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

export function createDisclosureTracker({ session, onChange, privacyApi, dispatchApi } = {}) {
  let listener = onChange;
  const byTarget = new Map(); // target -> { payload, evidence }
  const tickets = new Map(); // main's ticketId -> { target, payload, phase }
  let mainFed = false;
  let detach = () => undefined;
  let detachDispatch = () => undefined;
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
  const tracker = {
    record({ task, payload, evidence }) {
      if (mainFed) return; // Plan 07 present: main's egress notices are the only evidence (§5.2)
      if (!PAYLOAD_RANK[payload]) return; // "metadata" never counts
      // No routes (the reader failed): fail toward disclosure, as an unknown provider (D4).
      const target = session?.routes ? disclosureTargetFor(session.routes[task], settingsView) : "";
      if (target === null) return;
      merge(target, payload, evidence);
    },
    applyEgress(notice) {
      if (!PAYLOAD_RANK[notice?.payload] || !EGRESS_EVIDENCE[notice.phase]) return;
      const prev = tickets.get(notice.ticketId);
      if (prev?.phase === "delivered") return; // delivered is final
      tickets.set(notice.ticketId, { target: notice.targetId, payload: notice.payload, phase: notice.phase });
      // Rebuild from the tickets, so an undelivered ticket withdraws only its own evidence.
      byTarget.clear();
      attested = false;
      for (const t of tickets.values()) if (t.phase !== "undelivered") merge(t.target, t.payload, EGRESS_EVIDENCE[t.phase], { quiet: true });
      const next = summarize();
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        current = next;
        listener?.(current);
      }
    },
    _startMainFeed(off) {
      mainFed = true;
      detach = off;
    },
    _startDispatchFeed(off) {
      detachDispatch = off;
    },
    get: () => current,
    attested: () => attested,
    setOnChange(fn) {
      listener = fn;
    },
    dispose() {
      detach();
      detachDispatch();
      byTarget.clear();
      tickets.clear();
      current = null;
      listener = undefined;
    },
  };
  if (session?.id) {
    attachEgressEvidence(tracker, session.id, privacyApi);
    attachDispatchEvidence(tracker, session.id, dispatchApi);
  }
  return tracker;

  function merge(target, payload, evidence, { quiet = false } = {}) {
    if (evidence === "attested") attested = true;
    const prev = byTarget.get(target);
    const next = {
      payload: prev && PAYLOAD_RANK[prev.payload] > PAYLOAD_RANK[payload] ? prev.payload : payload,
      evidence: prev?.evidence === "attested" ? "attested" : evidence,
    };
    if (prev && prev.payload === next.payload && prev.evidence === next.evidence) return;
    byTarget.set(target, next);
    if (quiet) return;
    current = summarize();
    listener?.(current);
  }
}

const EGRESS_EVIDENCE = { dispatched: "dispatched", delivered: "attested", undelivered: "dispatched" };

/** Plan 07's egress feed (§5.4) for this session's correlation id. `recorded` rows are not evidence. */
export function attachEgressEvidence(tracker, sessionId, privacyApi = globalThis.window?.electronAPI?.privacy) {
  if (!privacyApi?.onEgress) return () => undefined;
  const off = privacyApi.onEgress((notice) => {
    if (notice?.correlationId !== sessionId) return;
    tracker.applyEgress(notice);
  });
  tracker._startMainFeed?.(off);
  return off;
}

/**
 * Main's transport hand-off for this session (no Plan 07): sent right before a
 * provider request leaves, so it is "may have received", never "already
 * received". record() ignores it once Plan 07's egress feed is attached.
 */
export function attachDispatchEvidence(tracker, sessionId, dispatchApi = globalThis.window?.electronAPI) {
  if (!dispatchApi?.onDictationDispatch) return () => undefined;
  const off = dispatchApi.onDictationDispatch((dispatch) => {
    if (dispatch?.correlationId !== sessionId || !DISCLOSURE_TASKS.has(dispatch.task)) return;
    tracker.record({ task: dispatch.task, payload: dispatch.payload, evidence: "dispatched" });
  });
  tracker._startDispatchFeed?.(off);
  return off;
}
```

Check the remote-URL key names for the agent and translation scopes in `inferenceScopes.ts` (`grep -n "RemoteUrl" src/config/inferenceScopes.ts`), and correct the `translation` and agent entries in `NETWORK_URL_KEY` if they differ. The session snapshot contains them because `SESSION_ROUTE_KEYS` includes every key of those scopes (Task 6).

In `dictationSession.js`, resolve the session's routes once, with Plan 03's published reader:

```js
import { resolveRoute, routeSnapshotFromSettings } from "../lib/routes";
import logger from "../utils/logger";

const DISCLOSURE_TASKS = ["dictationStt", "dictationCleanup", "translation", "voiceAssistant", "assistantVision"];

// routeSnapshotFromSettings (§5.1) reads the current route facts, the sealed
// store and i18n, with no IPC and no subscription, and needs the whole
// settings state. It gets the live state pinned to the snapshot: the same
// view every pipeline read uses.
function resolveSessionRoutes(settings, snapshot) {
  try {
    const routeSnapshot = routeSnapshotFromSettings({ ...settings, ...snapshot });
    return Object.fromEntries(DISCLOSURE_TASKS.map((id) => [id, structuredClone(resolveRoute(routeSnapshot, id))]));
  } catch (error) {
    // Never block a dictation on its disclosure routes. Without routes, the
    // tracker discloses every hand-off as an unknown provider (D4).
    logger.warn("Could not resolve the dictation's routes", { error: error?.message }, "audio");
    return null;
  }
}
```

In `captureDictationSession`, add `routes: resolveSessionRoutes(settings, snapshot),` to the object passed to `deepFreeze`. The routes are cloned, so freezing them never freezes Plan 03's shared constants. Suites whose settings-store stub lacks Plan 03's selectors get `routes: null` and keep working. Every route assertion runs on the real store (Step 1).

- [ ] **Step 4: Record evidence**

1. **Tracker per session.** In `beginDictationSession` (Task 6), and in `applySessionIntents(session, { context, tracker } = {})`:

   ```js
     // A restored session keeps the evidence and main's tickets gathered before its cancel
     // (Task 8 passes buffer.tracker). The tracker attaches main's feeds itself.
     if (this._disclosure && this._disclosure !== tracker) this._disclosure.dispose();
     this._disclosure = tracker ?? createDisclosureTracker({ session: this._activeSession });
   ```

   A tracker a cancel buffer owns is no longer `this._disclosure` (Task 8 moves it at cancel), so this never disposes it. The buffer disposes it when its window closes, which also detaches both of main's feeds. The tracker is subscribed by session id, so a hand-off that arrives after a cancel still lands on the cancelled session and updates its window, never on the next session.

   Add `getDisclosure() { return this._disclosure?.get() ?? null; }`. Cancel paths (Task 8) read it when they build `CancelledState`.
2. **Where evidence comes from.**
   - **Batch STT and every text request: main's hand-off only.** `processWithOpenAIAPI` and `processWithReasoningModel` record nothing themselves. They carry the `correlationId` (Task 6), and main sends the evidence.
   - **Tag each text route config with its task** in `resolveReasoningRoute`:
     - `cleanupConfig`: `disclosureTask: "dictationCleanup"`;
     - the translation config (`:226-241`): `disclosureTask: "translation"`;
     - the agent config (`:262-284`): `disclosureTask: useVisionOverride ? "assistantVision" : "voiceAssistant"`.

     The selection edit spreads the agent config (`:2394-2395`), and the text-only retry spreads its config (`:2238-2249`), so both keep the task. Main reports an image part as a second `image` hand-off for the same task. Local routes resolve to a `null` target, so local cleanup or agent calls record nothing even if main reports them.
   - **`ReasoningService.requestConfig`** (`:38-62`): add `disclosureTask: config.disclosureTask ?? null`. Add `disclosureTask?: DisclosureTask | null` to `ReasoningConfig` (`BaseReasoningService.ts:8-30`) and to `TextRequest` (`personalInferenceTypes.ts:6-20`).
   - **Streaming.** In `startStreamingRecording`, capture `const tracker = this._disclosure;` before `await provider.start(...)`. Once it resolves with `res.success` (`:3594`), call `tracker?.record({ task: "dictationStt", payload: "audio", evidence: "dispatched" })`. A thrown or unsuccessful start records nothing. A cancel during the connect moves `this._disclosure` into the cancel buffer (Task 8), and the captured tracker still records onto that cancelled session. Task 8's replay records the same way.
3. **Main's hand-off: text** (`personalInference.js`).
   - In `validateRequest`, before its `return` (`:170`):

     ```js
       if (input.disclosureTask != null && !DISCLOSURE_TASKS.has(input.disclosureTask))
         throw new Error("Invalid disclosure task.");
     ```

     Define `const DISCLOSURE_TASKS = new Set(["dictationStt", "dictationCleanup", "translation", "voiceAssistant", "assistantVision"]);` next to `SCOPES` (`:37`).
   - In `execute` (`:347`), after `abortFailure` (`:361-364`):

     ```js
         // The renderer's disclosure fallback (no Plan 07) records "may have received"
         // only from this hand-off, sent right before the request leaves. A request that
         // fails validation, has no key or is cancelled never gets one.
         const handOff = () => {
           if (!request.correlationId || !request.disclosureTask || request.provider === "local") return;
           if (controller.signal.aborted || sender.isDestroyed()) return;
           const image = request.messages.some(
             (message) => Array.isArray(message.content) && message.content.some((part) => part?.type === "image")
           );
           for (const payload of image ? ["text", "image"] : ["text"])
             sender.send("dictation-dispatch", { correlationId: request.correlationId, task: request.disclosureTask, payload });
         };
     ```

   - Call `handOff();` on the line before `const text = await codex.generate({` (`:392`), before `const result = streamText(options);` (`:471`) and before `const result = await generateText(options);` (`:489`).
4. **Main's hand-off: batch STT** (`ipcHandlers.js` `transcribe-audio-file-byok`). After `completedText` (`:7991-8004`), add:

   ```js
           // The renderer's disclosure fallback (no Plan 07) records "may have
           // received" only from this hand-off, sent right before the upload leaves.
           // Validation, a refused route, a missing key or a cancel never reach it.
           const handOff = () => {
             if (typeof correlationId !== "string" || !correlationId || correlationId.length > 100) return;
             if (job.signal?.aborted || typeof event.sender?.send !== "function" || event.sender.isDestroyed?.()) return;
             event.sender.send("dictation-dispatch", { correlationId, task: "dictationStt", payload: "audio" });
           };
   ```

   Call `handOff();` on the line before each provider request: the self-hosted `postMultipart` (`:8089`), Corti's `transcribeAudio` (`:8118`), `transcribeWithTinfoil` (`:8131`), `transcribeWithGemini` (`:8146`) and the final `postMultipart` (`:8241`). Every early `return { success: false, … }` and throw above them (`:8009`, `:8016`, `:8027`, `:8048-8055`, `:8108`, `:8115`, `:8158`) therefore sends nothing. A loopback self-hosted server still gets a hand-off, and the tracker drops it: its route is `device`.
5. **Preload and types.**
   - `preload.js`, after `transcribeAudioFileByok` (`:703`):

     ```js
       // Main's transport hand-off for a dictation request (Plan 04 Task 7).
       onDictationDispatch: (callback) => {
         const listener = (_event, dispatch) => callback?.(dispatch);
         ipcRenderer.on("dictation-dispatch", listener);
         return () => ipcRenderer.removeListener("dictation-dispatch", listener);
       },
     ```

   - `src/types/electron.ts`, after the `transcribeAudioFileByok?` declaration (`:1713-1738`):

     ```ts
           // Main's transport hand-off for a dictation request (Plan 04 Task 7)
           onDictationDispatch?: (
             callback: (dispatch: import("./dictation").DictationDispatch) => void
           ) => () => void;
     ```

6. **Processing stage.** The hook shows "Transcribing…" and "Cleaning up" from this callback (Tasks 9, 10).
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/dictationDisclosure.test.js test/helpers/dictationSession.test.js test/helpers/audioManagerSessionRoute.test.js test/helpers/dictationOperationHandoff.test.js test/helpers/personalInferenceTransport.test.js test/helpers/personalInference.test.js test/helpers/retryTranscriptionHandler.test.js "test/helpers/audioManager*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/dictation.ts src/types/electron.ts src/helpers/dictationDisclosure.js src/helpers/dictationSession.js src/helpers/audioManager.js src/helpers/ipcHandlers.js src/helpers/personalInference.js src/services/ReasoningService.ts src/services/BaseReasoningService.ts src/services/ai/personalInferenceTypes.ts preload.js test/helpers/dictationDisclosure.test.js test/helpers/dictationSession.test.js test/helpers/personalInferenceTransport.test.js test/helpers/retryTranscriptionHandler.test.js
git commit -m "feat(voice): disclosure is attested by main, or recorded at main's transport hand-off"
```

---

### Task 8: The RAM-only cancel buffer and same-route Undo (D3)

Closes review findings C1, I1, I2 and the AudioManager half of I3. The owner-confirmed D3 rules this task must satisfy, each with its test:

| D3 rule | How | Pinned by |
|---|---|---|
| Held in RAM only, never on disk (temp files included) unless retention already saves discarded audio | The buffer holds the **raw** recorded segments (batch) or PCM frames plus fallback segments (streaming) as owned byte copies. Nothing calls `mergeAudioSegments` (FFmpeg temp files, `ffmpegUtils.js:474-509`) while holding. A merge happens only after Undo (the audio is then a normal dictation again) or at expiry when `shouldSaveDiscardedRecording` allows saving | "two segments, retention off: no merge, no write, every byte zeroed (C1)". A merge already running in main when the cancel lands is the one exception (see "Known limit", Step 4) |
| Zeroed on expiry, including late bytes, and no Blob stays reachable | Every byte copy is owned by the buffer. A copy that finishes after the buffer closed is zeroed on arrival, and rejected copies are swallowed. Source Blob references (`segmentChunks`, `_batchSegments`, `_streamingFallbackSegments`, `streamingFallbackChunks`, `_sessionAudio`, and `lastAudioBlob` when it belongs to the cancelled session) are dropped at cancel. Immutable browser Blobs cannot be overwritten; they become unreachable and the browser frees them | "late bytes are zeroed", "only the cancelled session's lastAudioBlob is released (I1)", "expiry zeroes at the deadline even when a copy never settles (R1-I1)", "expiry before the final chunk, retention off…" |
| Undo replays the original route | The buffer carries the frozen `DictationSession` (Task 6). Restore applies it, so every read goes through the snapshot. Main still enforces Sealed mode, and the renderer pre-checks it to fail explicitly | "Undo restores through the session's route even after settings move to a provider (C2)", "streaming Undo replays the frames through the same provider…", "Sealed mode refuses a non-device Undo and keeps the recording held" |
| Every cancel path gets Undo | Recording, mic recovery, segment merge, transcription and cleanup (batch); recording and finalization (streaming). A cancel during startup, before any audio exists, has nothing to restore and shows no Undo | one test per path |
| Esc and new starts during restore | Restore claims the buffer and enters `isProcessing` **synchronously**, before any await. A start is rejected by the existing guard, and Esc is lifecycle-owned (Task 9). A restore that Esc abandoned settles nothing it no longer owns | "Undo is claimed synchronously…", "Esc while a restore waits for its bytes cancels it and puts the recording back (I3)", "Esc, then a new recording, while an Undo waits… (R1-I3)" |
| Undo never loses the words | Restore waits, bounded, for the recorder's final chunk, and on timeout keeps the hold unzeroed. A failed merge, STT or Sealed block keeps the audio: re-held, or kept by the normal failure path | "an immediate Undo waits for the recorder's final chunk… (R2-C1)", "a merge failure during Undo… (R2-C2)", "an STT or Sealed failure during Undo keeps the audio… (R2-C2)" |

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
  export function createCancelBuffer({ session, kind: "batch" | "streaming", mimeType, durationSeconds, analyticsOccurredAt, tracker, context }): CancelBuffer;
  // CancelBuffer: { session, kind, mimeType, durationSeconds, analyticsOccurredAt, tracker, context,
  //   adoptBlob(blob, role: "segment" | "fallback"): void; adoptFrames(frames: Int16Array[]): void;
  //   expect(role): { deliver(blob): void; fail(): void };   // audio that lands later (the recorder's final chunk)
  //   ready({ until?: Promise }): Promise<boolean>;          // false: `until` won before everything arrived
  //   awaiting(): boolean; bytes(role): Uint8Array[]; frames(): Int16Array[]; zero(): void; isZeroed(): boolean }
  export function createUndoWindow({ now?, setTimer?, clearTimer?, onClose }): {
    open(buffer): void; peek(): CancelBuffer | null; take(): CancelBuffer | null;
    pause(): void; resume(): void;
    expireNow(): Promise<void>;                  // closes the window and joins every close still saving
    discard(buffer, reason): Promise<void>;      // closes a taken buffer through the same path
    state(): { undoUntil: number; paused: boolean; remainingMs: number } | null;
  };
  // onClose(buffer, reason: "expired" | "replaced" | "flushed", { wait(ms) }) may return a promise.
  // It zeroes the buffer itself as soon as the bytes are no longer needed; the window zeroes again when it settles.
  ```

  ```js
  // AudioManager
  restoreCancelled(sessionId?: string): Promise<UndoResult>; // settles once the pipeline starts; the run is this._restoreRun
  pauseCancelHold(): void; resumeCancelHold(): void;
  flushCancelHold(): Promise<void>;                 // persist if retention allows, then zero; joins any close still saving (shutdown, Task 9)
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
- The fake MediaRecorder delivers `onstop` **asynchronously**, as the real one does (`audioManager.js:1619-1622`). `{ manualStop: true }` hands that moment to the test.
- Every deadline (the window, `FINAL_AUDIO_WAIT_MS`, `CLOSE_SAVE_WAIT_MS`) runs on one fake clock.

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
  const io = { merges: 0, mergeInputs: [], saves: 0, local: 0, byok: [], streamStarts: [], streamSends: 0, cancelled: [], closed: [] };
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    mergeAudioSegments: async (payload) => {
      io.merges += 1; // FFmpeg temp files in main
      io.mergeInputs.push(payload.map((p) => new Uint8Array(p.buffer)[0]));
      return { success: true, buffer: new Uint8Array(payload[0].buffer).buffer, mimeType: "audio/webm" };
    },
    transcribeAudioFileByok: async (p) => (io.byok.push(p), { success: true, text: "hi" }),
    cancelUploadTranscription: () => {},
    dismissDictationPreview: () => {},
  };
  const manager = Object.assign(Object.create(loaded.AudioManager.prototype), {
    _undoWindowFactory: (opts) => createUndoWindow({ ...clock, ...opts }),
    _readSealed: () => false, // the sealedStore seam (§5.4); the Sealed test overrides it
    _delay: (ms) => new Promise((resolve) => clock.setTimer(resolve, ms)),
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

function startBatch(manager, segmentFills, chunkFill, { manualStop = false } = {}) {
  manager.beginDictationSession({ streaming: false });
  manager.isRecording = true;
  manager.recordingStartTime = Date.now() - 2000;
  manager._batchSegments = segmentFills.map(blob);
  const recorder = {
    state: "recording",
    stream: null,
    onstop: null,
    // The real final dataavailable/onstop land after stop() returns.
    stop() {
      this.state = "inactive";
      if (!manualStop) setImmediate(() => this.onstop?.());
    },
    finish() {
      this.onstop?.();
    },
  };
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

test("Undo announces the closed window before processing starts (§5.2 order, R1-I6)", async (t) => {
  const { manager, advance } = await setup(t);
  const order = [];
  manager.onCancelledChange = (state, closed) => order.push(state ? "cancelled" : `closed:${closed?.reason}`);
  manager.onStateChange = (state) => state.isProcessing && order.push("processing");
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  await manager.restoreCancelled();
  assert.deepEqual(order.slice(-2), ["closed:restored", "processing"]);
  await manager._restoreRun;
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
  gate.resolve(true);
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
  gate.resolve(true);
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
  manager._readSealed = () => true;
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

test("a private hold is never persisted, and its restore stays private (§5.2)", async (t) => {
  const { manager, io, advance, setSettings } = await setup(t, { ...LOCAL, ...RETAIN });
  setSettings({ ...LOCAL, ...RETAIN });
  startBatch(manager, [], 3);
  manager._recordingPrivate = true;
  manager.cancelRecording();
  await advance(5000);
  assert.equal(io.saves, 0, "retention on, but private");

  startBatch(manager, [], 4);
  manager._recordingPrivate = true;
  manager.cancelRecording();
  await advance(0);
  manager._recordingPrivate = false; // a later, non-private recording changed the flag
  await manager.restoreCancelled();
  assert.equal(manager._recordingPrivate, true);
  await manager._restoreRun;
});

test("an immediate Undo waits for the recorder's final chunk instead of calling it empty (R2-C1)", async (t) => {
  const { manager, io, advance } = await setup(t);
  const rec = startBatch(manager, [1], 3, { manualStop: true });
  manager.cancelRecording();
  const restoring = manager.restoreCancelled(); // before onstop
  await advance(0);
  rec.finish(); // the final dataavailable/onstop
  const result = await restoring;
  assert.equal(result.restored, true);
  await manager._restoreRun;
  assert.deepEqual(io.mergeInputs[0], [1, 3], "the earlier segment and the tail");
  assert.equal(io.local, 1);

  const single = await setup(t);
  const rec2 = startBatch(single.manager, [], 4, { manualStop: true });
  single.manager.cancelRecording();
  const restoring2 = single.manager.restoreCancelled();
  rec2.finish();
  assert.equal((await restoring2).restored, true, "one segment: not reported empty");
  await single.manager._restoreRun;
  assert.equal(single.io.local, 1);
});

test("a final chunk that never arrives: Undo keeps the hold unzeroed, and a late chunk still lands (R2-C1)", async (t) => {
  const { manager, advance } = await setup(t);
  const rec = startBatch(manager, [], 3, { manualStop: true });
  manager.cancelRecording();
  const held = manager._undo.peek();
  const restoring = manager.restoreCancelled();
  await advance(5000); // FINAL_AUDIO_WAIT_MS
  const result = await restoring;
  assert.deepEqual([result.restored, result.reason], [false, "noAudio"]);
  assert.equal(manager._undo.peek(), held, "back in its window");
  assert.equal(held.isZeroed(), false);
  assert.equal(manager.isProcessing, false);
  rec.finish();
  await advance(0);
  assert.deepEqual(held.bytes("segment").map(firstByte), [3]);
});

test("expiry before the final chunk, retention off: zeroed at the deadline, the late chunk is never kept", async (t) => {
  const { manager, advance } = await setup(t);
  const rec = startBatch(manager, [1], 3, { manualStop: true });
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  const early = held.bytes("segment");
  await advance(5000);
  assert.ok(early.every(allZero));
  assert.equal(held.isZeroed(), true);
  rec.finish();
  await advance(0);
  assert.deepEqual(held.bytes("segment"), [], "zeroed on arrival");
});

test("expiry zeroes at the deadline even when a copy never settles (R1-I1)", async (t) => {
  const never = { arrayBuffer: () => new Promise(() => {}) };
  const broken = { arrayBuffer: async () => { throw new Error("gone"); } };

  // Retention off: nothing will be saved, so zero now.
  const off = await setup(t);
  startBatch(off.manager, [1], 3);
  off.manager.cancelRecording();
  await off.advance(0);
  const heldOff = off.manager._undo.peek();
  heldOff.adoptBlob(never, "segment");
  heldOff.adoptBlob(broken, "segment");
  const viewsOff = heldOff.bytes("segment");
  await off.advance(5000);
  assert.ok(viewsOff.every(allZero));
  assert.equal(heldOff.isZeroed(), true);

  // Private, retention on: never persisted, zeroed at the deadline too.
  const priv = await setup(t, { ...LOCAL, ...RETAIN });
  priv.setSettings({ ...LOCAL, ...RETAIN });
  startBatch(priv.manager, [1], 3);
  priv.manager._recordingPrivate = true;
  priv.manager.cancelRecording();
  await priv.advance(0);
  const heldPriv = priv.manager._undo.peek();
  heldPriv.adoptBlob(never, "segment");
  await priv.advance(5000);
  assert.equal(heldPriv.isZeroed(), true);
  assert.equal(priv.io.saves, 0);

  // Retention on: a bounded wait, then the bytes that arrived are saved and zeroed.
  const on = await setup(t, { ...LOCAL, ...RETAIN });
  on.setSettings({ ...LOCAL, ...RETAIN });
  startBatch(on.manager, [1], 3);
  on.manager.cancelRecording();
  await on.advance(0);
  const heldOn = on.manager._undo.peek();
  heldOn.adoptBlob(never, "segment");
  const viewsOn = heldOn.bytes("segment");
  await on.advance(5000);
  assert.equal(heldOn.isZeroed(), false, "waiting, bounded, for the stuck copy");
  await on.advance(3000); // CLOSE_SAVE_WAIT_MS
  assert.equal(on.io.saves, 1);
  assert.ok(viewsOn.every(allZero));
  assert.equal(heldOn.isZeroed(), true);
});

test("Esc, then a new recording, while an Undo waits: the old restore touches neither (R1-I3)", async (t) => {
  for (const settle of ["resolve", "reject"]) {
    const { manager, advance } = await setup(t);
    const states = [];
    manager.onStateChange = (state) => states.push(state);
    startBatch(manager, [], 3);
    manager.cancelRecording();
    await advance(0);
    const held = manager._undo.peek();
    const gate = deferred();
    held.ready = () => gate.promise;
    const restoring = manager.restoreCancelled();
    manager.cancelProcessing(); // Esc
    startBatch(manager, [], 5); // a new recording starts
    const before = states.length;
    if (settle === "resolve") gate.resolve(true);
    else gate.reject(new Error("copy failed"));
    const result = await restoring;
    await advance(0);
    assert.equal(result.restored, false);
    assert.equal(manager.isRecording, true, `${settle}: the new recording is untouched`);
    assert.equal(states.length, before, `${settle}: no idle broadcast from the old restore`);
    assert.equal(manager._undo.peek(), null, `${settle}: the old recording does not take the window`);
    assert.equal(held.isZeroed(), true, `${settle}: retention off, it closed as a newer start closes a window`);
  }
});

test("a merge failure during Undo settles idle and puts the recording back (R2-C2)", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [1, 2], 3);
  manager.cancelRecording();
  await advance(0);
  manager.mergeRecordedSegments = async () => {
    throw new Error("ffmpeg failed");
  };
  const errors = [];
  manager.onError = (error) => errors.push(error);
  assert.equal((await manager.restoreCancelled()).restored, true);
  await manager._restoreRun;
  await advance(0);
  assert.equal(manager.isProcessing, false, "never stuck busy");
  assert.equal(errors.length, 1);
  const again = manager._undo.peek();
  assert.ok(await again.ready());
  assert.deepEqual(again.bytes("segment").map(firstByte).sort(), [1, 2, 3]);
});

test("an STT or Sealed failure during Undo keeps the audio, retention on or off (R2-C2)", async (t) => {
  for (const retention of [true, false]) {
    const settings = { ...LOCAL, dataRetentionEnabled: retention };
    const { manager, advance, window: win, setSettings } = await setup(t, settings);
    setSettings(settings);
    const saved = [];
    win.electronAPI.saveTranscription = async (...args) => (saved.push(args), { id: 1 });
    win.electronAPI.saveTranscriptionAudio = async () => ({ success: true });
    startBatch(manager, [], 3);
    manager.cancelRecording();
    await advance(0);
    let ownedAtDispatch = false;
    manager.processWithLocalParakeet = async (audio) => {
      // Plan 07's _noteSealedFailure and the failure path both read lastAudioBlob.
      ownedAtDispatch = manager.lastAudioBlob === audio && manager._lastAudioSessionId === manager.activeSession.id;
      // Sealing landed between the pre-check and dispatch; main refuses the request.
      throw Object.assign(new Error("Blocked by Sealed mode"), { code: "SEALED_MODE" });
    };
    await manager.restoreCancelled();
    await manager._restoreRun;
    await advance(0);
    assert.equal(ownedAtDispatch, true, `retention ${retention}: owned before provider work`);
    assert.equal(manager.isProcessing, false);
    if (retention) {
      assert.equal(saved.length, 1, "a failed history row with its audio, as for any dictation");
      assert.equal(manager._undo.peek(), null);
    } else {
      assert.equal(manager._undo.peek()?.kind, "batch", "re-held: nothing else keeps it");
    }
  }
});

test("a flush joins an expiry or replacement save that is already running (R1-I9)", async (t) => {
  const { manager, io, advance, setSettings } = await setup(t, { ...LOCAL, ...RETAIN });
  setSettings({ ...LOCAL, ...RETAIN });
  const save = deferred();
  manager.saveDiscardedTranscription = () => (io.saves++, save.promise);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(5000); // natural expiry; its save is pending
  assert.equal(io.saves, 1);
  let flushed = false;
  const flushing = manager.flushCancelHold().then(() => (flushed = true));
  await advance(0);
  assert.equal(flushed, false, "quit waits for the running save");
  save.resolve();
  await flushing;

  const replaced = await setup(t, { ...LOCAL, ...RETAIN });
  replaced.setSettings({ ...LOCAL, ...RETAIN });
  const first = deferred();
  replaced.manager.saveDiscardedTranscription = () => (replaced.io.saves++, first.promise);
  startBatch(replaced.manager, [], 3);
  replaced.manager.cancelRecording();
  await replaced.advance(0);
  startBatch(replaced.manager, [], 4);
  replaced.manager.cancelRecording(); // replaces the first window; its save starts
  await replaced.advance(0);
  let done = false;
  const quitting = replaced.manager.flushCancelHold().then(() => (done = true));
  await replaced.advance(3000);
  assert.equal(done, false, "the replaced window's save is joined too");
  first.resolve();
  await quitting;
  assert.equal(replaced.io.saves, 2);
});

test("a hold's press-time context is released when its window closes, and kept by a refusal that re-holds (R1-C2)", async (t) => {
  const { manager, advance } = await setup(t, { ...LOCAL, useLocalWhisper: false }); // a provider route, so Sealed refuses
  startBatch(manager, [], 3);
  const context = { sessionId: manager.activeSession.id, released: false, release() { this.released = true; } };
  manager._sessionContext = context;
  manager.cancelRecording();
  await advance(0);
  assert.equal(manager._undo.peek().context, context, "the hold owns the reads");
  manager._readSealed = () => true;
  assert.equal(await manager._sealedBlocks({ routes: null, intents: {}, settings: {} }), true, "unresolved routes fail closed");
  assert.equal((await manager.restoreCancelled()).reason, "sealed");
  assert.equal(context.released, false, "a refusal that keeps the recording keeps its context");
  await advance(5000);
  assert.equal(context.released, true, "expiry releases it");
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

Append the Agent cases to Task 6's `test/helpers/dictationOperationHandoff.test.js`, which already has the real settings store, the real pipeline and the `setupManager` helper. These go through the real `cancelProcessing` → hold → `restoreCancelled` path, instead of the direct `_detachSessionOperation` / `applySessionIntents` calls:

```js
async function holdWithFakeClock(manager, vite) {
  const { createUndoWindow } = await vite.ssrLoadModule("/helpers/cancelBuffer.js");
  const timers = [];
  manager._undoWindowFactory = (opts) =>
    createUndoWindow({ ...opts, now: () => 0, setTimer: (fn, ms) => timers.push({ fn, ms }), clearTimer() {} });
  manager._delay = () => new Promise(() => {}); // the final chunk is never awaited here: batch segments are registered
  manager._readSealed = () => false;
  return timers;
}

async function cancelProcessingThenRestore({ manager, session, vite }, changeTheWorld) {
  await holdWithFakeClock(manager, vite);
  manager._sessionAudio = {
    session, kind: "batch", segments: [new Blob([new Uint8Array(300).fill(1)], { type: "audio/webm" })],
    mimeType: "audio/webm", durationSeconds: 2, analyticsOccurredAt: "x",
  };
  assert.equal(manager.cancelProcessing(), true); // the hook's Esc (Task 9)
  await flush();
  changeTheWorld();
  const result = await manager.restoreCancelled(session.id);
  assert.equal(result.restored, true);
  await manager._restoreRun;
}

test("Undo through restoreCancelled keeps a standalone Agent command's route and screenshot (Task 8)", async (t) => {
  let shot = { data: "A", mediaType: "image/png" };
  const setup = await setupManager(t, {
    selection: () => ({ status: "none" }),
    screen: () => shot,
  });
  const { manager, session, reads, setSettings } = setup;
  manager.processWithLocalParakeet = async () => ({ success: true, text: "draft a reply", source: "local-parakeet" });
  await cancelProcessingThenRestore(setup, () => {
    setSettings(REMOTE_AGENT);
    shot = { data: "B", mediaType: "image/png" };
  });
  const { assistantConversation } = manager._takePendingResultExtras();
  assert.equal(assistantConversation.operation.sessionId, session.id);
  assert.equal(assistantConversation.operation.settings.dictationAgentMode, "local");
  assert.equal(assistantConversation.screenContext.data, "A");
  assert.deepEqual(reads, { selection: 1, screen: 1 }, "Undo reads nothing from the OS again");
});

test("Undo through restoreCancelled edits the press-time selection on the session's route (Task 8)", async (t) => {
  let selected = { status: "selected", sessionId: "sel-original", text: "teh draft", characterCount: 9 };
  const setup = await setupManager(t, { selection: () => selected, screen: () => null });
  const { manager, session, sent, reads, setSettings } = setup;
  manager.processWithLocalParakeet = async () => ({ success: true, text: "fix the typo", source: "local-parakeet" });
  await cancelProcessingThenRestore(setup, () => {
    setSettings(REMOTE_AGENT);
    selected = { status: "selected", sessionId: "sel-newer", text: "an unrelated paragraph", characterCount: 22 };
  });
  assert.deepEqual(manager._takePendingResultExtras().selectionEdit, { sessionId: "sel-original" });
  assert.match(sent[0].text, /teh draft/);
  assert.equal(sent[0].config.provider, "local");
  assert.equal(sent[0].config.correlationId, session.id);
  assert.equal(reads.selection, 1);
});
```

If the real `processAudio` reaches a helper these setups do not stub, add the stub to `setupManager`, and keep the assertions.

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
// Restore waits this long for the recorder's final chunk before it gives up and keeps the hold (R2-C1).
export const FINAL_AUDIO_WAIT_MS = 5000;
// With retention on, closing waits this long for in-flight copies, then saves what it has (R1-I1).
export const CLOSE_SAVE_WAIT_MS = 3000;

export function undoWindowMs(durationSeconds) {
  return Number(durationSeconds) > LONG_RECORDING_SECONDS ? LONG_UNDO_WINDOW_MS : UNDO_WINDOW_MS;
}

export function createCancelBuffer({ session, kind, mimeType, durationSeconds, analyticsOccurredAt, tracker = null, context = null }) {
  const owned = []; // { role, bytes: Uint8Array }
  const frames = []; // Int16Array, transferred from the worklet
  const pending = new Set(); // byte copies in flight
  const expected = new Set(); // sources that have not delivered yet (the recorder's final chunk)
  let zeroed = false;
  const track = (promise, set) => {
    set.add(promise);
    promise.finally(() => set.delete(promise));
  };

  const buffer = {
    session,
    kind,
    mimeType: mimeType || "audio/webm",
    durationSeconds,
    analyticsOccurredAt,
    tracker,
    // Task 6's session context (press-time selection and screenshot). zero() never releases it:
    // a restore hands it back to the session. _closeCancelled releases it.
    context,
    adoptBlob(blob, role) {
      if (!blob) return;
      const copy = Promise.resolve()
        .then(() => blob.arrayBuffer())
        .then((arrayBuffer) => {
          const bytes = new Uint8Array(arrayBuffer);
          if (zeroed) bytes.fill(0);
          else owned.push({ role, bytes });
        })
        .catch(() => {});
      track(copy, pending);
    },
    /**
     * Registers audio that will arrive later: MediaRecorder's final dataavailable/onstop
     * lands after cancel returns. Call it before the window opens, so `ready()` waits for
     * it. Exactly one of deliver/fail settles it; later calls are ignored.
     */
    expect(role) {
      let settle;
      const gate = new Promise((resolve) => (settle = resolve));
      track(gate, expected);
      let done = false;
      return {
        deliver(blob) {
          if (done) return;
          done = true;
          buffer.adoptBlob(blob, role); // registers its copy before the gate opens
          settle();
        },
        fail() {
          if (done) return;
          done = true;
          settle();
        },
      };
    },
    adoptFrames(list) {
      for (const frame of list) {
        if (zeroed) frame.fill(0);
        else frames.push(frame);
      }
    },
    /**
     * Resolves true once every expected source has delivered and every copy has settled
     * (rejected copies count as settled). Resolves false if `until` settles first.
     */
    async ready({ until } = {}) {
      const drained = (async () => {
        while (expected.size || pending.size) await Promise.all([...expected, ...pending]);
        return true;
      })();
      return until ? Promise.race([drained, until.then(() => false)]) : drained;
    },
    awaiting: () => expected.size > 0,
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
  return buffer;
}

export function createUndoWindow({
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onClose,
} = {}) {
  let current = null; // { buffer, expiresAt, remainingMs, timer }
  const closing = new Set(); // closes still saving; a flush joins them (R1-I9)
  const wait = (ms) => new Promise((resolve) => setTimer(resolve, ms));

  // onClose decides when the bytes may be zeroed. It zeroes at once when nothing will be
  // saved, and otherwise right after copying them into Blobs (R1-I1). The final zero()
  // here covers an onClose that throws.
  const close = (buffer, reason) => {
    const done = (async () => {
      try {
        await onClose?.(buffer, reason, { wait });
      } finally {
        buffer.zero();
      }
    })();
    closing.add(done);
    done.finally(() => closing.delete(done));
    return done;
  };

  const end = (reason) => {
    if (!current) return Promise.resolve();
    const entry = current;
    current = null;
    clearTimer(entry.timer);
    return close(entry.buffer, reason);
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
    /** Closes the open window and joins every close still saving, including earlier ones. */
    async expireNow() {
      void end("flushed");
      while (closing.size) await Promise.all([...closing]);
    },
    /** Closes a buffer that is not (or no longer) in the window, through the same path. */
    discard: (buffer, reason) => close(buffer, reason),
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

1. **Imports and the window.** Add `import { createCancelBuffer, createUndoWindow, REPLAY_BATCH_FRAMES, REPLAY_PACE_MS, FINAL_AUDIO_WAIT_MS, CLOSE_SAVE_WAIT_MS } from "./cancelBuffer";` and `import { canStartDictation } from "../utils/dictationReadiness";`. Then add:

   ```js
     _undoWindow() {
       const factory = this._undoWindowFactory ?? createUndoWindow;
       return (this._undo ??= factory({ onClose: (buffer, reason, opts) => this._closeCancelled(buffer, reason, opts) }));
     }

     /** A timer on the window's clock, so tests drive every deadline with one fake clock. */
     _delay(ms) {
       return new Promise((resolve) => setTimeout(resolve, ms));
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

     async _closeCancelled(buffer, reason, { wait } = {}) {
       if (reason !== "abandoned") this.onCancelledChange?.(null, { sessionId: buffer.session.id, reason });
       buffer.tracker?.dispose();
       buffer.context?.release(); // the press-time reads end with the hold (Task 6)
       if (reason === "replaced" && this._undo?.peek()) this._emitCancelled(this._undo.peek());
       // Nothing will be saved: zero now, at the deadline. Copies still in flight are zeroed
       // when they land (R1-I1). An expired or flushed private hold is never persisted (§5.2).
       if (buffer.private || !shouldSaveDiscardedRecording(getSettings(), buffer.durationSeconds)) {
         buffer.zero();
         return;
       }
       // Retention on: wait a bounded time for the final chunk and copies, then save what arrived.
       await buffer.ready({ until: wait?.(CLOSE_SAVE_WAIT_MS) });
       const role = buffer.kind === "streaming" ? "fallback" : "segment";
       const blobs = buffer.bytes(role).map((bytes) => new Blob([bytes], { type: buffer.mimeType }));
       buffer.zero(); // the Blobs hold their own copies
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
       // Task 6: ends the session but keeps its press-time reads (selection, screenshot) for Undo (R1-C2).
       const { session, context } = this._detachSessionOperation();
       const buffer = createCancelBuffer({
         session, kind, mimeType: mimeType || this.recordingMimeType,
         durationSeconds, analyticsOccurredAt, tracker: this._disclosure, context,
       });
       // §5.2 private holds: Plan 05's per-recording flag; absent before 05 merges, so false.
       buffer.private = this._recordingPrivate === true;
       this._disclosure = null; // the buffer owns the tracker now
       if (this._lastAudioSessionId === session.id) {
         this.lastAudioBlob = null;
         this._lastAudioSessionId = null;
       }
       if (this._sessionAudio?.session === session) this._sessionAudio = null;
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
       // R2-C1: the open segment arrives with the recorder's final dataavailable, after this
       // method returns. Register it before the window opens, so Undo waits for it.
       const finalChunk = buffer.expect("segment");
       const deliverFinal = () => {
         finalChunk.deliver(new Blob(snapshot.chunks, { type: snapshot.mimeType }));
         snapshot.chunks.length = 0; // drop every reference to the Blob chunks
       };
       this.mediaRecorder.onstop = () => {
         recorder.stream?.getTracks().forEach((track) => track.stop());
         deliverFinal();
       };
       this.resetDiscardedBatchRecordingState();
       try {
         recorder.stop();
       } catch {
         deliverFinal(); // already inactive: no onstop will come
       }
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

9. **A new recording finalizes any open window first.** In `startRecording()` and `startStreamingRecording()`, add `if (this._undo?.peek()) void this._undo.expireNow();` **after** the busy guard (`:1145-1153`) and after Plan 07's sealed pre-flight (§5.4), and before the microphone is prepared (`:1156`). A refused start therefore never costs the user their held recording.

   **Plan 07's pre-flight and recovery stay intact (§5.4, CCR-4).** This task must not move or drop either of these:
   - the `isDictationSealed(settings, getSealedSnapshot().sealed)` refusal in `startRecording`;
   - the `_noteSealedFailure(error)` call that runs before `saveFailedTranscription` in the pipeline `catch` (`:1903-1928`).

   Whichever plan merges second wires them together:
   - **07 merged first.** Rebase onto it, and put the `expireNow` line after its pre-flight. `_noteSealedFailure` reads `this.lastAudioBlob`. Step 4.1 nulls that blob only for a session this task cancels, and a cancelled session never reaches the pipeline `catch`, so the two never meet.
   - **04 merged first.** Plan 07 inserts its pre-flight directly after the busy guard, which is above the `expireNow` line, and its `_noteSealedFailure` call where its CCR-4 says. Nothing in this task needs to change.

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
    // §5.2 order: the window closes ("restored"), then processing starts (R1-I6).
    this.onCancelledChange?.(null, { sessionId: buffer.session.id, reason: "restored" });
    this.isProcessing = true;
    this.onStateChange?.({ isRecording: false, isProcessing: true });

    // This restore owns the lifecycle only while its generation is current. Esc
    // (cancelProcessing / cancelRecording) bumps it and settles idle itself (R1-I3).
    const owns = () => generation === this._restoreGeneration;
    const refuse = (reason, { keep }) => {
      if (owns()) {
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
      }
      if (keep) this._rehold(buffer);
      else {
        buffer.zero();
        buffer.context?.release();
      }
      return { restored: false, sessionId: buffer.session.id, reason };
    };

    // R2-C1: wait for the recorder's final chunk, bounded. "Not delivered yet" is not
    // "empty": on timeout the recording goes back into its window, unzeroed, and a
    // late chunk still lands in it.
    let complete = false;
    try {
      complete = await buffer.ready({ until: this._delay(FINAL_AUDIO_WAIT_MS) });
    } catch {
      return refuse("noAudio", { keep: false });
    }
    if (!owns()) return refuse("busy", { keep: true });
    if (!complete) return refuse("noAudio", { keep: true });
    if (await this._sealedBlocks(buffer.session)) return refuse("sealed", { keep: true });
    if (!owns()) return refuse("busy", { keep: true });
    const empty = buffer.kind === "streaming" ? !buffer.frames().length : !buffer.bytes("segment").length;
    if (empty) return refuse("noAudio", { keep: false });
    if (buffer.kind === "streaming" && !STREAMING_PROVIDERS[buffer.session.intents.streamingProviderName]) {
      return refuse("routeUnavailable", { keep: true }); // never re-route; the window keeps the words until it ends
    }

    // Task 7 keeps the evidence; Task 6 hands back the press-time selection and screenshot (R1-C2).
    this.applySessionIntents(buffer.session, { tracker: buffer.tracker, context: buffer.context });
    this._recordingPrivate = buffer.private === true; // §5.2: re-applied before processing
    this._restoreRun = (buffer.kind === "streaming" ? this._replayStreamingSession(buffer, generation) : this._restoreBatch(buffer, generation))
      .catch((error) => {
        logger.warn("Undo could not run the original route", { error: error?.message }, "audio");
        if (owns()) this.onError?.(error);
      })
      .finally(() => buffer.zero());
    return { restored: true, sessionId: buffer.session.id };
  }

  /**
   * Puts a recording back in the undo window, unless something newer owns the
   * pill: a newer hold, or a recording or pipeline that started after Esc. Then
   * it closes the way a newer start ends a window (Step 4.9): saved if retention
   * allows, zeroed otherwise (R1-I3). The reason "abandoned" is internal: its
   * window already announced its close, so nothing is emitted and a newer
   * window's state is never cleared.
   */
  _rehold(buffer) {
    const newer = this._undo?.peek() || this.isRecording || this.isProcessing || this.isStreaming;
    if (newer) void this._undoWindow().discard(buffer, "abandoned");
    else this._openCancelled(buffer);
  }

  async _restoreBatch(buffer, generation) {
    const { session } = buffer;
    const blobs = buffer.bytes("segment").map((bytes) => new Blob([bytes], { type: buffer.mimeType }));
    buffer.zero(); // the Blobs are the restored dictation's own audio now
    const metadata = {
      durationSeconds: buffer.durationSeconds,
      analyticsOccurredAt: buffer.analyticsOccurredAt,
      restoredFromCancel: true,
    };
    // Re-register the audio first, so an Esc during this restore re-holds it (Step 4.8).
    this._sessionAudio = { session, kind: "batch", segments: blobs, mimeType: buffer.mimeType, ...metadata };
    const pipeline = this._startProcessingPipeline(); // Esc bumps its generation (cancelProcessing)
    let audio;
    try {
      audio = blobs.length === 1 ? blobs[0] : await this.mergeRecordedSegments(blobs);
      if (!audio) throw Object.assign(new Error("Undo could not combine the recording"), { code: "MERGE_FAILED" });
    } catch (error) {
      // R2-C2: the merge runs outside processAudio's try/finally. Settle this pipeline
      // (only if it is still ours) and put the source audio back in a window.
      if (this._settleProcessingPipeline(pipeline)) this._reholdAudio(session, blobs, metadata);
      throw error;
    }
    if (this._shouldAbandonProcessingPipeline(pipeline)) return; // Esc during the merge re-held it (Step 4.8)
    // R2-C2: the same recovery ownership as a normal dictation (:1447). The failure path
    // (:1909-1926) and Plan 07's _noteSealedFailure read lastAudioBlob, in either merge order.
    this.lastAudioBlob = audio;
    this._lastAudioSessionId = session.id;
    await this.processAudio(audio, metadata, pipeline);
  }

  /** Re-holds audio the user brought back with Undo, when no other copy will survive. */
  _reholdAudio(session, blobs, metadata) {
    // Keep the press-time reads when the session is still live; once it has ended, a later
    // Undo runs as a standalone command (Task 6) and never reads the OS selection again.
    const context = this._activeSession === session ? this._detachSessionOperation().context : null;
    const held = createCancelBuffer({
      session, kind: "batch", mimeType: blobs[0]?.type || "audio/webm",
      durationSeconds: metadata.durationSeconds, analyticsOccurredAt: metadata.analyticsOccurredAt,
      tracker: this._disclosure, context,
    });
    held.private = this._recordingPrivate === true;
    for (const blob of blobs) held.adoptBlob(blob, "segment");
    if (this._sessionAudio?.session === session) this._sessionAudio = null;
    this._rehold(held);
  }

  async _sealedBlocks(session) {
    if (!this._readSealed()) return false;
    if (!session.routes) return true; // routes could not be resolved (Task 6): fail closed while sealed
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
- **A restored dictation that fails keeps its audio (R2-C2).** In `processAudio`, declare `let reholdRestored = false;` next to `noAudioDetected` (`:1778`). In the failure branch (`:1914-1927`), after the existing `saveFailedTranscription` call, add:

  ```js
          // D3: audio the user brought back with Undo is never silently lost. With retention
          // off nothing else keeps it, unless Plan 07 already holds it for sealed recovery.
          reholdRestored =
            metadata.restoredFromCancel === true &&
            !error.recoveryHeld &&
            !getEffectiveRetentionPreferences().dataRetentionEnabled;
  ```

  In the `finally` (`:1929-1932`), directly after `this._settleProcessingPipeline(pipeline);`, add `if (reholdRestored) this._reholdAudio(this._activeSession, [audioBlob], metadata);`. It must run after settling: `_rehold` treats a busy lifecycle as newer work.

  With retention on, `saveFailedTranscription` already keeps it as a failed history row with audio, exactly as for any dictation. A Sealed block that lands between the pre-check and dispatch fails in main, and takes this same path. With Plan 07 merged, its `_noteSealedFailure` runs first and finds `lastAudioBlob` set, whichever plan merged first.
- Sealed state comes only from `src/stores/sealedStore.ts` (§5.4), never from `privacy.getSealed` directly:

  ```js
  import * as sealedStore from "../stores/sealedStore";
    /** Only `true` blocks; unknown (`null`) never does, because main enforces the seal either way (§5.4). */
    _readSealed() {
      const snapshot = sealedStore.getSealedSnapshot?.(); // Plan 07
      return snapshot ? snapshot.sealed === true : sealedStore.getSealed?.() === true; // Plan 03 alone
    }
  ```

  This works whichever of 04 and 07 merges first. `_sealedBlocks` stays `async` so the call site does not change.

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
      this.isStreaming = false; // no other streaming session can start while this one holds it
      // Settle only a lifecycle this replay still owns: after Esc, a newer operation may run (R1-I3).
      if (generation === this._restoreGeneration && this.isProcessing) {
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false, isStreaming: false });
      }
      if (this._activeSession === session) this._endDictationSession(session);
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

It also wires §5.7: an open cancel window reaches the control panel as the lifecycle state `cancelled`, on Plan 06's existing `dictation-lifecycle-state-changed` → `dictation-lifecycle-changed` channel. No second relay is added. Plan 06 maps the state to "Ready".

**Files:**
- Modify: `src/helpers/dictationLifecycle.js`. Add `CANCELLED: "cancelled"` to `DICTATION_LIFECYCLE`. Main normalises every unknown state to `idle` (`normalizeDictationLifecycle`, line 17), so without this, §5.7's "future states pass through" would not hold for `cancelled`. `resolveAgentDictationPillState` treats `cancelled` as `idle`. `shouldIgnoreDictationHotkey` is unchanged, so a new dictation can start during the window.
- Create: `src/helpers/rendererRequest.js` (main). A token, sender and timeout request/reply helper, generalised from `_prepareRendererForMainWindowResize` (`windowManager.js:345-370`).
- Modify: `src/helpers/windowManager.js`. Add `sendUndoCancelDictation(sessionId?)`, `flushDictationBeforeQuit({ timeoutMs })` and `lastCancelledDictation`.
- Create: `src/helpers/quitCoordinator.js`. One coordinated shutdown: the flush, then teardown, then exit. Every repeated quit is held until that exit (R1-I9).
- Modify: `main.js:1472-1479`. `before-quit` uses the coordinator.
- Test: `test/helpers/quitCoordinator.test.js`
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
  windowManager.lastCancelledDictation: { sessionId: string } | null;              // set by onboarding-demo-publish from the sanitised events
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
      remoteAlreadySent: { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: ["anthropic", "host:gpu-box.lan", 7], extra: "x" },
      junk: 1,
    },
    reason: "nope",
  });
  assert.deepEqual(clean, {
    sessionId: "rec-7",
    cancelled: { sessionId: "rec-7", undoUntil: 5000, paused: false, remainingMs: 5000,
      // §5.2 (ff8c9cd): every RemoteDisclosure field survives, including alsoSentTo.
      remoteAlreadySent: { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: ["anthropic", "host:gpu-box.lan"] } },
  });
  const bare = sanitizeCancelledDemoFields({
    sessionId: "rec-8",
    cancelled: { sessionId: "rec-8", undoUntil: 1, paused: false, remainingMs: 1,
      remoteAlreadySent: { target: "openai", payload: "text", evidence: "dispatched" } },
  });
  assert.deepEqual(bare.cancelled.remoteAlreadySent.alsoSentTo, [], "a missing list is the empty list, never undefined");
  assert.equal(sanitizeCancelledDemoFields({ sessionId: "x".repeat(200) }).sessionId, undefined);
  assert.equal(sanitizeCancelledDemoFields({ sessionId: "rec-7", reason: "restored" }).reason, "restored");
});

test("main.js routes before-quit through the coordinator", () => {
  const main = fs.readFileSync(path.join(repoRoot, "main.js"), "utf8");
  assert.match(main, /app\.on\("before-quit", createQuitCoordinator\(/);
  assert.doesNotMatch(main, /isShuttingDown/, "the coordinator owns the shutdown state");
});
```

Create `test/helpers/quitCoordinator.test.js`. It drives the real coordinator through every quit transition:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createQuitCoordinator } = require("../../src/helpers/quitCoordinator.js");
const { deferred } = require("./harness/deferred");

function harness({ flush, updateExit = false } = {}) {
  const log = [];
  const onBeforeQuit = createQuitCoordinator({
    isUpdateExit: () => updateExit,
    flush: flush ? () => flush(log) : () => (log.push("flush"), Promise.resolve(true)),
    teardown: () => log.push("teardown"),
    shutdown: () => (log.push("shutdown"), Promise.resolve()),
    exit: (code) => log.push(`exit:${code}`),
  });
  const quit = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    onBeforeQuit(event);
    return event;
  };
  return { log, quit };
}
const settle = () => new Promise((r) => setImmediate(r));

test("quit flushes the dictation window, then tears down, then exits", async () => {
  const { log, quit } = harness();
  assert.equal(quit().prevented, true);
  await settle();
  assert.deepEqual(log, ["flush", "teardown", "shutdown", "exit:0"]);
});

test("a repeated quit during a slow flush is held, never let through (R1-I9)", async () => {
  const save = deferred();
  const { log, quit } = harness({ flush: (log) => (log.push("flush"), save.promise) });
  quit();
  const second = quit();
  assert.equal(second.prevented, true, "Electron's default quit would bypass the flush");
  await settle();
  assert.deepEqual(log, ["flush"], "nothing tears down while the save runs");
  save.resolve(true);
  await settle();
  assert.deepEqual(log, ["flush", "teardown", "shutdown", "exit:0"], "one shutdown, not two");
});

test("a flush that throws or a missing window manager still quits", async () => {
  const { log, quit } = harness({ flush: () => { throw new Error("no window"); } });
  quit();
  await settle();
  assert.deepEqual(log, ["teardown", "shutdown", "exit:0"]);
  const missing = harness({ flush: () => undefined });
  missing.quit();
  await settle();
  assert.deepEqual(missing.log, ["teardown", "shutdown", "exit:0"]);
});

test("the updater's own exit passes straight through", () => {
  const { log, quit } = harness({ updateExit: true });
  assert.equal(quit().prevented, false);
  assert.deepEqual(log, []);
});
```

The joins inside the renderer (an expiry or replacement save that is already running) are pinned by Task 8's "a flush joins an expiry or replacement save that is already running".

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
        dictationLifecycleStateChanged: (state) => log.push(["lifecycle", state]), captureDictationTarget: async () => ({}),
        registerCancelHotkey: (k) => log.push(`+${k}`),
        unregisterCancelHotkey: () => log.push("-esc"),
        acquirePillHotkey: async (slot) => (log.push(`+${slot}`), { leaseId: 1, held: true }),
        releasePillHotkey: async () => log.push("-lease"),
        onPillHotkeyPressed: noop,
        onUndoCancelRequest: on("undo"),
        replyUndoCancel: (token, result) => log.push(["undo-reply", token, result]),
        onDictationFlushRequest: on("flush"),
        replyDictationFlush: (token) => log.push(["flush-reply", token]),
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

test("the control panel learns of the window through Plan 06's lifecycle channel only (§5.7)", async (t) => {
  const { log } = await mount(t);
  await fire("onCancelledChange", STATE);
  await fire("onCancelledChange", null, { sessionId: "rec-1", reason: "expired" });
  const states = log.filter((e) => Array.isArray(e) && e[0] === "lifecycle").map((e) => e[1]);
  assert.deepEqual(states.slice(-2), ["cancelled", "idle"]);
});
```

Add to `test/helpers/dictationLifecycle.test.js` (create it if absent):

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const lifecycle = require("../../src/helpers/dictationLifecycle.js");

test("cancelled passes main's normaliser, never blocks a new dictation, and is idle to the Agent pill", () => {
  assert.equal(lifecycle.normalizeDictationLifecycle("cancelled"), "cancelled");
  assert.equal(lifecycle.shouldIgnoreDictationHotkey("cancelled"), false);
  assert.equal(lifecycle.resolveAgentDictationPillState("cancelled", "assistant").lifecycle, "idle");
});
```


That asserts on the same instance the hook used.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/dictationLifecycle.test.js test/helpers/rendererRequest.test.js test/helpers/undoBridge.test.js test/helpers/useAudioRecordingLifecycle.test.js`
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

Import `ipcMain` from `electron` if `windowManager.js` does not already. Add `this.lastCancelledDictation = null;` in the constructor. The `onboarding-demo-publish` handler sets it (below). Its only consumer is Plan 05's trial, and demo events flow only during a trial. There is no separate report channel (§5.7: no second relay).

`main.js:1472-1479`:

```js
// D3: an open cancel window, and any close still saving, is persisted (only if retention
// saves discarded audio) and zeroed before the app exits. A dead renderer times out.
app.on(
  "before-quit",
  createQuitCoordinator({
    isUpdateExit: () => updateExit,
    flush: () => windowManager?.flushDictationBeforeQuit?.({ timeoutMs: 3000 }),
    teardown: performSyncTeardown,
    shutdown: () => sidecarRegistry.shutdownAll(),
    exit: (code) => app.exit(code),
  })
);
```

Delete `let isShuttingDown = false;`. Add `const { createQuitCoordinator } = require("./src/helpers/quitCoordinator");` with the other helper requires. `app.exit()` emits no further `before-quit` (Electron docs), so the held events never loop.

`src/helpers/quitCoordinator.js`:

```js
// One coordinated shutdown. The first quit runs flush → teardown → shutdown → exit.
// Every later quit event is prevented until that exit, so Electron's default quit can
// never bypass a flush that is still saving (R1-I9).
function createQuitCoordinator({ isUpdateExit = () => false, flush, teardown, shutdown, exit }) {
  let shuttingDown = false;
  return function onBeforeQuit(event) {
    if (isUpdateExit()) return; // the updater already tore down and is restarting
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    Promise.resolve()
      .then(() => flush?.())
      .catch(() => {})
      .finally(() => {
        teardown();
        Promise.resolve()
          .then(() => shutdown())
          .catch(() => {})
          .finally(() => exit(0));
      });
  };
}

module.exports = { createQuitCoordinator };
```

The `windowManager.js:104-107` `before-quit` listener (`isQuitting = true` and `unregisterAll()`) still runs first and needs no change. The flush does not need hotkeys.

`src/helpers/onboardingInputPolicy.js`. Add `"cancelled"` and `"cancelClosed"` to `ONBOARDING_DEMO_STATUSES`, and export this:

```js
const CLOSE_REASONS = new Set(["expired", "restored", "replaced", "flushed"]);
const PAYLOADS = new Set(["audio", "text", "image"]);
const EVIDENCE = new Set(["attested", "dispatched"]);
const id = (v) => (typeof v === "string" && v.length > 0 && v.length <= 128 ? v : undefined);
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : undefined);
const target = (v) => typeof v === "string" && v.length <= 128;
const MAX_ALSO_SENT_TO = 8; // more receivers than routes in a dictation means a bad payload

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
        d && target(d.target) && PAYLOADS.has(d.payload) && EVIDENCE.has(d.evidence)
          ? {
              target: d.target,
              payload: d.payload,
              evidence: d.evidence,
              alsoSentTo: (Array.isArray(d.alsoSentTo) ? d.alsoSentTo : []).filter(target).slice(0, MAX_ALSO_SENT_TO),
            }
          : null,
    };
  }
  return out;
}
```

Move the broadcast object out of `ipcHandlers.js:1063-1077` (`onboarding-demo-publish`) into `onboardingInputPolicy.js`, so the real broadcaster is testable, and spread the sanitiser into it:

```js
// The object onboarding-demo-publish broadcasts on onboarding-demo-event (§5.2).
function buildOnboardingDemoBroadcast(session, event) {
  const text = typeof event.text === "string" ? event.text.slice(0, 20000) : undefined;
  const message = typeof event.message === "string" ? event.message.slice(0, 500) : undefined;
  const tool = typeof event.tool === "string" ? event.tool.slice(0, 64) : undefined;
  const level = Number.isFinite(event.level) ? Math.min(1, Math.max(0, event.level)) : undefined;
  return { demoId: session.id, kind: session.kind, status: event.status, text, message, tool, level, ...sanitizeCancelledDemoFields(event) };
}
```

Export it. The handler keeps its session and status guards (`:1060-1062`), then:

```js
      const broadcast = buildOnboardingDemoBroadcast(session, event);
      if (event.status === "cancelled" && broadcast.sessionId) this.windowManager.lastCancelledDictation = { sessionId: broadcast.sessionId };
      if (event.status === "cancelClosed") this.windowManager.lastCancelledDictation = null;
      broadcastToWindows("onboarding-demo-event", broadcast);
      return true;
```

If Plan 05 merged first, its `sanitizeOnboardingDemoEvent(event, session)` already is this builder. Spread the sanitiser into it instead and skip `buildOnboardingDemoBroadcast` (Step 4b).

Add to `test/helpers/undoBridge.test.js`:

```js
test("the real broadcaster keeps every receiver, and the copy names them all (§5.2, R1-I6)", async () => {
  const { buildOnboardingDemoBroadcast } = require("../../src/helpers/onboardingInputPolicy.js");
  const { disclosureCopy } = await import("../../src/helpers/dictationDisclosure.js");
  const broadcast = buildOnboardingDemoBroadcast({ id: "demo-1", kind: "dictation" }, {
    kind: "dictation", status: "cancelled", sessionId: "rec-1",
    cancelled: { sessionId: "rec-1", undoUntil: 9000, paused: false, remainingMs: 5000,
      remoteAlreadySent: { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: ["anthropic"] } },
  });
  assert.deepEqual(broadcast.cancelled.remoteAlreadySent.alsoSentTo, ["anthropic"]);
  const t = (k, o) => (o ? `${k}|${o.provider}` : k);
  assert.equal(disclosureCopy(broadcast.cancelled.remoteAlreadySent, t), "pill.caption.remoteSeveral|OpenAI, Anthropic");
});
```

`preload.js` (overlay APIs):

```js
  onUndoCancelRequest: registerListener("undo-cancel-request", (cb) => (_e, req) => cb(req)),
  replyUndoCancel: (token, result) => ipcRenderer.send("undo-cancel-reply", token, result),
  onDictationFlushRequest: registerListener("dictation-flush-request", (cb) => (_e, req) => cb(req)),
  replyDictationFlush: (token) => ipcRenderer.send("dictation-flush-reply", token, true),
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
         cancelledRef.current = state;
         // §5.7: the control panel sees the window on Plan 06's lifecycle channel. A busy
         // lifecycle (a new recording, a restore) owns the report instead.
         const am = audioManagerRef.current;
         if (!am?.isRecording && !am?.isProcessing) reportLifecycle(state ? "cancelled" : "idle");
         if (state) {
           onDemoEventRef.current?.({ kind: demoKindRef.current, status: "cancelled", sessionId: state.sessionId, cancelled: state });
         } else if (closed) {
           onDemoEventRef.current?.({ kind: demoKindRef.current, status: "cancelClosed", sessionId: closed.sessionId, reason: closed.reason });
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

   In the existing report at `:335`, the idle case becomes `cancelledRef.current ? "cancelled" : "idle"`, so a cancel that settles idle while its window is open reports `cancelled` (§5.7).

   On unmount, the existing cleanup releases it: add `if (escHeldRef.current) window.electronAPI?.unregisterCancelHotkey?.();` to the effect cleanup at `:786-800`. Main also releases the `cancel` slot if the renderer goes away: Task 2's owner watch covers it, installed from `register-cancel-hotkey` itself.
4. **Outcome.**
   - Paste success (`:657-660`): `setOutcome({ sessionId: sessionId ?? "", kind: "pasted", words: countWords(result.text), at: Date.now() });`
   - `showDictationError` (Task 4): `setOutcome({ sessionId: sessionId ?? "", kind: "failed", at: Date.now() });`, using its `sessionId` argument.

   Both use the `sessionId` Task 4 reads at the top of `onTranscriptionComplete` and `onError`, before any `await`. By the time of the paste, the pipeline has settled and Task 6 has ended the session, so `activeSession` is already `null`.
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

Locale keys (`notices.undo`, all 11 locales):

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

- [ ] **Step 4b: If Plan 05 merged first, run its Task 22 here (§3, R1-I6)**

Spec §3 and §5.2 (ff8c9cd) give the Undo bridge to whichever of 04 and 05 merges second. If `git log --oneline origin/main -- src/utils/onboardingTrial.ts` shows Plan 05 on `main` when this branch is rebased, this branch merges second, and this step is required. Otherwise skip it: Plan 05 runs its own Task 22 after this plan merges.

1. Check Plan 05 Task 22's pre-flight. All three must print a match, which this task's Steps 3 and 4 make true:

   ```bash
   grep -n "sendUndoCancelDictation" src/helpers/windowManager.js
   grep -n "sanitizeCancelledDemoFields" src/helpers/onboardingInputPolicy.js
   ls src/types/dictation.ts src/helpers/dictationDisclosure.js
   ```

2. Execute Plan 05's Task 22 (`docs/superpowers/plans/2026-10-15-loqui-uiux-05-onboarding.md`, "Task 22: Undo with Plan 04") step by step on this branch, with its tests. It does the following:
   - spreads `sanitizeCancelledDemoFields` into Plan 05's `sanitizeOnboardingDemoEvent`, in place of `buildOnboardingDemoBroadcast` above;
   - adds the §5.2 fields to `OnboardingDemoEvent`, `canUndo`, `undo()`/`undoAvailable` and the trial's Undo and disclosure;
   - **deletes Plan 05's fallback:** the bare `cancelled` publish in `useAudioRecording.js` (Plan 05 Task 5), and its test "cancelling an active take tells setup it was discarded…". Plan 04's `onCancelledChange` publishes `cancelled` and `cancelClosed` instead.
3. Extend Plan 05's reducer test with two receivers and the §5.2 event order. Append to `test/utils/onboardingTrial.test.js`:

   ```js
   test("two receivers survive to the trial, and closure comes before processing (R1-I6)", async () => {
     const disclosure = { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: ["anthropic"] };
     const state = await play([
       { status: "listening", atMs: 0 },
       { status: "cancelled", sessionId: "rec-1", cancelled: undoWindow({ remoteAlreadySent: disclosure }), atMs: 1 },
     ]);
     assert.deepEqual(state.cancelled.remoteAlreadySent.alsoSentTo, ["anthropic"]);
     const restored = await play([
       { status: "listening", atMs: 0 },
       { status: "cancelled", sessionId: "rec-1", cancelled: undoWindow(), atMs: 1 },
       { status: "cancelClosed", sessionId: "rec-1", reason: "restored", atMs: 2 },
       { status: "processing", atMs: 3 },
     ]);
     assert.deepEqual([restored.phase, restored.cancelled], ["processing", null]);
   });
   ```

4. Check that no fallback remains: `rg -n "status: \"cancelled\"" src/hooks/useAudioRecording.js` prints only Plan 04's `onCancelledChange` publish.

Onboarding reads cancel details only from `onboarding-demo-event`. §5.7's lifecycle string (`"cancelled"`, Step 4) is for the workspace mic card, and onboarding never reads it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/quitCoordinator.test.js test/helpers/dictationLifecycle.test.js test/helpers/rendererRequest.test.js test/helpers/undoBridge.test.js test/helpers/useAudioRecordingLifecycle.test.js "test/helpers/useAudioRecording*.test.js" test/helpers/preloadOnboardingBridge.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/quitCoordinator.js src/helpers/dictationLifecycle.js src/helpers/rendererRequest.js src/helpers/windowManager.js main.js src/helpers/onboardingInputPolicy.js src/helpers/ipcHandlers.js src/helpers/audioManager.js preload.js src/types/electron.ts src/preview/browserPreview.ts src/hooks/useAudioRecording.js src/hooks/useUndoCancelHotkey.ts src/App.jsx src/locales test
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
    pasted: {164,36}; cancelled: {160,36}; meeting: {124,36}; meetingInterrupted: {184,36}; sealedPaused: {124,36};
  };
  export const VOICE_PILL_MAX_WIDTH = 184;
  export const PILL_OUTCOME_BEAT_MS = 700;
  export const PILL_SEALED_PAUSED_MS = 4000;   // long enough to read the caption
  export type PillStage = "recording" | "unavailable" | "thinking" | "transcribing" | "cleaning" | "cancelled" | "pasted" | "failed" | "sealedPaused" | "meeting";
  export function resolvePillStage(input: {
    isRecording: boolean; micUnavailable: boolean; isProcessing: boolean;
    processingStage: "transcribing" | "cleaning" | null; agentMode: boolean;
    cancelled: { undoUntil: number } | null; recentOutcome: { kind: "pasted" | "failed" } | null;
    meetingRecording: object | null; showMeetingRecorder: boolean;
    dictationSealed?: boolean;   // the dictation route is blocked by Sealed mode (pillLocality.blocked)
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
  | `sealedPaused` | yes | no | no | §5.4: the pre-flight refusal reads as a pill state. The held-audio alert, with its Transcribe action, sits in the pill's notice slot, which has its own interaction rules (Task 3) |
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
  // §5.4: a failure while Sealed mode blocks the dictation route is the pre-flight refusal.
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "failed" }, dictationSealed: true }), "sealedPaused");
  assert.equal(resolvePillStage({ ...base, recentOutcome: { kind: "pasted" }, dictationSealed: true }), "pasted");
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
     sealedPaused: Object.freeze({ width: 124, height: 36 }), // "Paused"; the sentence is the caption
   });
   export const PILL_SEALED_PAUSED_MS = 4000;
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
     dictationSealed = false,
   }) {
     if (isRecording) return micUnavailable ? "unavailable" : "recording";
     if (isProcessing) {
       if (agentMode) return "thinking";
       return processingStage === "cleaning" ? "cleaning" : "transcribing";
     }
     if (cancelled) return "cancelled";
     if (recentOutcome) {
       if (recentOutcome.kind === "pasted") return "pasted";
       return dictationSealed ? "sealedPaused" : "failed";
     }
     if (meetingRecording && showMeetingRecorder) return "meeting";
     return null;
   }

   const OWNERSHIP = {
     cancelled: { holdsWindow: true, interactive: true, outranksFooter: true },
     meeting: { holdsWindow: true, interactive: true, outranksFooter: true },
     pasted: { holdsWindow: true, interactive: false, outranksFooter: false },
     failed: { holdsWindow: true, interactive: false, outranksFooter: false },
     sealedPaused: { holdsWindow: true, interactive: false, outranksFooter: false },
   };
   const NO_OWNERSHIP = { holdsWindow: false, interactive: false, outranksFooter: false };

   /** One policy for stages that outlive the dictation (I4). */
   export function resolvePillOwnership(stage) {
     return OWNERSHIP[stage] ?? NO_OWNERSHIP;
   }

   /**
    * App's auto-hide condition (App.jsx:407-414), with stage ownership. Its one
    * caller is usePillAutoHide (Task 11), which App calls after pillOwnership.
    */
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

Covers VO-R1 C (pill chrome), VO-Q12 (the beat), the D3 cancelled capsule and caption, FND-R5 adoption on the pill, and §5.1/§5.4 consumption. It also closes R1-I4 (no read of `pillOwnership` before its declaration) and R2-M1 (the pill's motion uses the shared tokens).

**Files:**
- Modify (rewrite): `src/components/dictation/VoicePill.tsx`
- Create: `src/components/dictation/pillLocality.ts`. A pure combiner plus a `usePillLocality` hook.
- Create: `src/components/dictation/PillCaption.tsx`. The layer above the pill; Task 12 renders words into it.
- Create: `src/hooks/useRecentOutcome.ts`
- Create: `src/hooks/usePillAutoHide.js`. App's auto-hide effect (`App.jsx:403–434`), moved so App calls it after the stage derivation it reads (R1-I4).
- Delete: `src/components/dictation/PillWaveform.tsx`, `src/components/dictation/waveformMath.ts`
- Modify: `src/App.jsx`:
  - `prevAutoHideRef` (line 76) and the auto-hide effect (403–434) move into `usePillAutoHide`
  - the new stage block goes directly after `agentModeActive` (512–517)
  - `resolveVoicePillInteraction` (519–525) and `cancelPillFootprint` (537–539)
  - `activateVoicePill` (540–557)
  - `commonPillState` (576–581) and footer suppression (599–604)
  - hover handlers (648–659)
  - the `VoicePill` props (666–739)
- Modify: `src/components/dictation/AgentDictationPillOverlay.tsx:228-244`. It keeps `getAudioLevel`; no other change.
- Modify: `src/styles/dictation-panel.css`. Add the stage, countdown and caption rules, the token transitions for the pill's own parts, the `[data-stage]` comet variant and the `liquid-cancel-skin` states.
- Modify: `src/index.css`. Five shared beat tokens in the Plan 01 Motion block (R2-M1).
- Modify: `src/locales/*/translation.json` (`pill.*` keys)
- Modify: `DESIGN.md` `### Voice Pill` and the `## Motion` token table
- Test: `test/helpers/voicePillStructure.test.js` (update)
- Test: `test/components/pillLocality.test.js` (new)
- Test: `test/hooks/pillAutoHide.test.js` (new). The real hook, mounted with auto-hide on.
- Test: `test/components/appPillOwnership.test.js` (new). The real `App.jsx`, rendered with auto-hide on (R1-I4).
- Test: `test/components/pillMotionTokens.test.js` (new). Token adoption and the literal-timing scan (R2-M1).

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

  ```js
  // src/hooks/usePillAutoHide.js
  export const PILL_AUTO_HIDE_DELAY_MS = 500;   // unchanged from App.jsx:419
  export function usePillAutoHide(input: {
    floatingIconAutoHide: boolean; isRecording: boolean; isVisuallyProcessing: boolean; noticesOnScreen: boolean;
    wordsCardHandoffActive: boolean; assistantMounted: boolean; liveTranscriptMounted: boolean; ownership: { holdsWindow: boolean };
  }): void;
  ```

  ```css
  /* src/index.css, :root Motion block: picked beats as shared tokens (R2-M1) */
  --motion-nudge: 260ms;             /* the failed pill's nudge */
  --motion-bounce: 640ms;            /* the length --motion-spring-bounce is drawn for */
  --motion-condense-fly: 140ms;      /* Task 12: a spark rises from the bars */
  --motion-condense-land: 220ms;     /* Task 12: a word lands */
  --motion-rewrite-underline: 600ms; /* Task 12: cleanup's rewrite underline */
  ```

  These extend the Plan 01 motion-token contract (spec §5, "Motion and colour tokens") additively. Nothing Plan 01 ships changes.

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

Create `test/hooks/pillAutoHide.test.js`. It mounts the real hook the way `test/hooks/dictationErrorAutoHide.test.js` mounts the size owner: real timers, the fake DOM from `installHookDom`, and auto-hide on.

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// Mounts the real usePillAutoHide with "Auto-hide when idle" on. `stage` goes
// through the real resolvePillOwnership (Task 10), so a policy change reaches
// this test.
async function mountAutoHide(t, initial = {}) {
  // Registered before the browser globals so React still has `window` when the
  // harness tears the root down (the order dictationErrorAutoHide.test.js uses).
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });

  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        hideWindow: async () => calls.push("hide"),
        showDictationPanel: async () => calls.push("show"),
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-pill-auto-hide-" });
  const { usePillAutoHide, PILL_AUTO_HIDE_DELAY_MS } = await vite.ssrLoadModule(
    "/hooks/usePillAutoHide.js"
  );
  const { resolvePillOwnership } = await vite.ssrLoadModule("/helpers/voicePillPresentation.js");

  let props = {
    floatingIconAutoHide: true,
    isRecording: false,
    isVisuallyProcessing: false,
    noticesOnScreen: false,
    wordsCardHandoffActive: false,
    assistantMounted: false,
    liveTranscriptMounted: false,
    stage: null,
    ...initial,
  };
  function Harness() {
    const { stage, ...input } = props;
    usePillAutoHide({ ...input, ownership: resolvePillOwnership(stage) });
    return null;
  }

  root = createRoot(container);
  const render = async (next = {}) => {
    props = { ...props, ...next };
    await React.act(async () => {
      root.render(React.createElement(Harness));
      await Promise.resolve();
    });
  };
  // Real timers: wait just past the hide delay.
  const wait = async () => {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PILL_AUTO_HIDE_DELAY_MS + 100));
    });
  };

  await render();
  return { calls, render, wait };
}

test("an idle pill still auto-hides", async (t) => {
  const { calls, wait } = await mountAutoHide(t);
  await wait();
  assert.deepEqual(calls, ["hide"]);
});

test("Esc during a recording keeps the window for the whole undo window (R1-I4)", async (t) => {
  const { calls, render, wait } = await mountAutoHide(t, { isRecording: true });
  // The cancel lands: recording stops and the cancelled stage starts in one render.
  await render({ isRecording: false, stage: "cancelled" });
  await wait();
  assert.deepEqual(calls, ["show"], "the stage brings the window back and nothing hides it");
  // The undo window closes; the idle pill hides as before.
  await render({ stage: null });
  await wait();
  assert.deepEqual(calls, ["show", "hide"]);
});

for (const stage of ["pasted", "failed", "sealedPaused", "meeting"]) {
  test(`the ${stage} stage holds the window`, async (t) => {
    const { calls, wait } = await mountAutoHide(t, { stage });
    await wait();
    assert.deepEqual(calls, ["show"]);
  });
}

test("a stage shows the window once, not on every render", async (t) => {
  // show-dictation-panel repositions to the active display, so repeats would move the pill.
  const { calls, render, wait } = await mountAutoHide(t, { stage: "meeting" });
  await render({ isVisuallyProcessing: true });
  await render({ isVisuallyProcessing: false });
  await wait();
  assert.deepEqual(calls, ["show"]);
});

test("turning auto-hide off still brings the pill back", async (t) => {
  const { calls, render } = await mountAutoHide(t, { isRecording: true });
  await render({ floatingIconAutoHide: false });
  assert.deepEqual(calls, ["show"]);
});
```

Create `test/components/appPillOwnership.test.js`. It renders the real `App.jsx` through Vite SSR, like `test/components/pillCommandMenu.test.js` renders its component. App already renders this way: on the current tree, stubbing only `index.css` and `useToast` (Task 5 deletes the second) is enough.

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// R1-I4, App level. This renders the real App.jsx with the real stage
// derivation, ownership policy, settings store and VoicePill. Rendering
// evaluates every hook's dependency array, so a value read above its `const`
// throws a ReferenceError here; helper tests cannot see that. Three modules
// are stand-ins:
// - useAudioRecording: the pipeline state each test sets;
// - usePillAutoHide: records what App passes it. SSR runs no effects, and
//   test/hooks/pillAutoHide.test.js mounts the real hook;
// - lib/routes' useResolvedRoute: pinned to on-device routes, so the locality
//   ring does not depend on the test machine's settings.
const MOCKS = {
  "/index.css": "export default {};",
  "/hooks/useAudioRecording": "export const useAudioRecording = () => globalThis.__appPillAudio;",
  "/hooks/usePillAutoHide":
    "export const usePillAutoHide = (input) => { globalThis.__appPillAutoHide.push(input); };",
  "/lib/routes": `
    export * from "/lib/routes.ts";
    export const useResolvedRoute = (id) => ({
      id, kind: "speech", locality: "device", provider: null, model: null,
      state: { status: "ready" }, sends: null, settingsPath: id,
    });
  `,
};

// Every field App reads from useAudioRecording, at its idle value. A task
// that makes App read a new field adds its idle value here.
const pipeline = (state) => ({
  isRecording: false,
  isProcessing: false,
  isAssistantVoice: false,
  isPreparing: false,
  isStopping: false,
  micCaptureStatus: "ok",
  toggleListening() {},
  cancelRecording() {},
  cancelProcessing() {},
  getAudioLevel: () => 0,
  cancelled: null,
  undoCancel: async () => true,
  pauseUndo() {},
  resumeUndo() {},
  processingStage: null,
  outcome: null,
  ...state,
});

async function renderApp(t, state = {}) {
  // "Auto-hide when idle" is on; the real settings store reads it at load.
  installBrowserGlobals(t, { initialStorage: { floatingIconAutoHide: "true" } });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-app-pill-", mockModules: MOCKS });
  globalThis.__appPillAudio = pipeline(state);
  globalThis.__appPillAutoHide = [];
  t.after(() => {
    delete globalThis.__appPillAudio;
    delete globalThis.__appPillAutoHide;
  });
  const { default: App } = await vite.ssrLoadModule("/App.jsx");
  const html = renderToStaticMarkup(createElement(App));
  return { html, autoHide: globalThis.__appPillAutoHide.at(-1) };
}

const cancelled = {
  sessionId: "s1",
  undoUntil: Date.now() + 5000,
  paused: false,
  remainingMs: 5000,
  remoteAlreadySent: null,
};

test("App renders the Undo capsule with auto-hide on, and auto-hide sees the hold (R1-I4)", async (t) => {
  const { html, autoHide } = await renderApp(t, { cancelled });
  assert.match(html, /data-pill-state="cancelled"[^>]*role="button"/);
  assert.match(html, /class="pill-countdown"/);
  assert.equal(autoHide.floatingIconAutoHide, true);
  assert.deepEqual(autoHide.ownership, { holdsWindow: true, interactive: true, outranksFooter: true });
});

test("an idle App leaves auto-hide free to hide the window", async (t) => {
  const { autoHide } = await renderApp(t);
  assert.equal(autoHide.floatingIconAutoHide, true);
  assert.equal(autoHide.isRecording, false);
  assert.equal(autoHide.ownership.holdsWindow, false);
});

test("live work reaches auto-hide as live work, not as a held stage", async (t) => {
  const { html, autoHide } = await renderApp(t, { isProcessing: true, processingStage: "transcribing" });
  assert.match(html, /data-pill-state="transcribing"/);
  assert.equal(autoHide.isVisuallyProcessing, true);
  assert.equal(autoHide.ownership.holdsWindow, false);
});
```

Create `test/components/pillMotionTokens.test.js` (R2-M1). It checks token adoption, scans the new rules and sources for literal timings, and checks the reduced-motion fades.

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

// Spec §4: motion uses the shared tokens only. This pins Plan 04's pill,
// caption, word-row and orbit motion to them.
const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");
const flat = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
const withoutJsComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Picked beats, shared next to Plan 01's tokens in src/index.css.
const BEAT_TOKENS = {
  "--motion-nudge": "260ms",
  "--motion-bounce": "640ms",
  "--motion-condense-fly": "140ms",
  "--motion-condense-land": "220ms",
  "--motion-rewrite-underline": "600ms",
};

// Plan 04's rules in dictation-panel.css. Older rules in that file keep their
// timings until their owners migrate them.
const SCOPED =
  /\.pill-|\.condense-|\.agent-orbit|\.voice-pill-(?:sheen|levels|identity-icon|identity-logo|expand-chevron)\b|\.locality-ring--blocked|\[data-pill-state=/;

// The declared exception list (Global Constraints, "Motion tokens"). Loop
// periods are the only literal timings a scoped rule may carry:
const LOOP_PERIODS = new Map([
  ['.agent-orbit[data-phase="thinking"] .agent-orbit__ring', ["2400ms"]],
  ['.agent-orbit[data-phase="answering"] .agent-orbit__ring', ["1200ms"]],
  [".agent-orbit__satellite", ["2400ms"]],
  [".agent-orbit__satellite--b", ["1200ms"]], // phase offset: half a 2.4 s turn
  // An ambient loop, so ease-in-out is allowed (audit §4.1).
  [
    '.voice-pill-control[data-agent-mode="true"][data-pill-state="thinking"] .voice-identity-agent',
    ["2400ms", "ease-in-out"],
  ],
]);
// Functional deadlines are not motion, so they get no token. None is a
// literal in the scanned code, so the scans need no entry for them:
// - the undo underline (.pill-countdown) runs for the session's real undo
//   window: VoicePill sets animation-duration and --undo-ms from
//   countdown.durationMs (5 s or 10 s, decided by AudioManager);
// - the footprint grow (VOICE_PILL_GROW_TRANSITION) stays a JS value, because
//   LiquidCancelButton's frame tween and the listening timeline read the same
//   LISTENING_ENTRANCE_TIMING.expansionMs;
// - PILL_OUTCOME_BEAT_MS, PILL_SEALED_PAUSED_MS, PILL_AUTO_HIDE_DELAY_MS and
//   AGENT_ANSWERING_MS (Task 13) are timers, not transitions.
// Tailwind's animate-pulse on the unavailable identity is an existing ambient loop.

// Sources whose class lists and inline styles must use the tokens.
// Tasks 12, 13 and 14 add theirs.
const MOTION_SOURCES = [
  "src/components/dictation/VoicePill.tsx",
  "src/components/dictation/PillCaption.tsx",
];

const DURATION = /(?<![\w.])\d*\.?\d+m?s(?![\w-])/g;
const EASING = /cubic-bezier\(|(?<![\w-])ease(?:-in-out|-in|-out)?(?![\w-])/g;

// Innermost `selector { body }` pairs, including those inside @media.
function scopedRules(css) {
  const rules = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const name = selector.replace(/\s+/g, " ").trim();
    if (SCOPED.test(name)) rules.push({ selector: name, body });
  }
  return rules;
}

function reducedMotionBlocks(css) {
  const blocks = [];
  const open = /@media \(prefers-reduced-motion: reduce\) \{/g;
  for (let m = open.exec(css); m; m = open.exec(css)) {
    let depth = 1;
    let i = open.lastIndex;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
    }
    blocks.push(css.slice(open.lastIndex, i - 1));
  }
  return blocks;
}

test("Plan 04's beat tokens sit with Plan 01's, each defined once", () => {
  const css = flat(read("src/index.css"));
  for (const [name, value] of Object.entries(BEAT_TOKENS)) {
    const matches = css.match(new RegExp(`${name}:\\s*([^;]+);`, "g")) ?? [];
    assert.equal(matches.length, 1, `${name} defined exactly once`);
    assert.equal(matches[0].replace(/^[^:]+:\s*/, "").replace(/;$/, ""), value);
  }
});

test("the pill's transitions and beats use the shared tokens", () => {
  const css = flat(read("src/styles/dictation-panel.css"));
  assert.match(css, /\.voice-pill-sheen, \.voice-pill-levels \{[^}]*transition: opacity var\(--motion-fast\) var\(--motion-ease-std\)/);
  assert.match(
    css,
    /\.voice-pill-identity-logo, \.voice-pill-expand-chevron \{[^}]*transition-duration: var\(--motion-base\);[^}]*transition-timing-function: var\(--motion-ease-std\)/
  );
  assert.match(css, /\.voice-pill-identity-icon \{[^}]*width var\(--motion-base\) var\(--motion-ease-std\)/);
  assert.match(css, /\.voice-pill-control\[data-pill-state="failed"\] \{[^}]*animation: pill-nudge var\(--motion-nudge\) var\(--motion-ease-std\)/);
  assert.match(
    css,
    /\.pill-success-check \{[^}]*draw-check var\(--motion-base\) var\(--motion-ease-std\) var\(--motion-instant\) both, pill-pop var\(--motion-bounce\) var\(--motion-spring-bounce\) both/
  );
});

test("the rendered pill carries the token classes and no utility timings", async () => {
  const { VoicePill } = await import("../../src/components/dictation/VoicePill.tsx");
  const render = (state, props = {}) =>
    renderStatic(VoicePill, { variant: "floating", state, getAudioLevel: () => 0, ...props });
  const recording = render("recording", { expanded: true });
  const hover = render("hover", { showExpandChevron: true });
  const cancelled = render("cancelled", {
    label: "Discarded",
    countdown: { durationMs: 5000, paused: false },
  });
  assert.match(recording, /voice-pill-levels/);
  for (const html of [recording, hover, cancelled]) {
    assert.match(html, /class="voice-pill-sheen /);
    assert.match(html, /voice-pill-identity-logo/);
    assert.match(html, /voice-pill-expand-chevron/);
    assert.doesNotMatch(html, /\b(?:duration|delay)-\d|\bease-(?:in|out|in-out|linear)\b|transition-\[/);
  }
});

test("pill sources carry no literal timings (spec §4)", () => {
  for (const file of MOTION_SOURCES) {
    const src = withoutJsComments(read(file));
    assert.deepEqual(src.match(/\b(?:duration|delay)-\d+\b/g) ?? [], [], `${file}: Tailwind timing utilities`);
    assert.deepEqual(src.match(EASING) ?? [], [], `${file}: easing literals`);
    assert.deepEqual(src.match(DURATION) ?? [], [], `${file}: literal durations`);
  }
});

test("Plan 04's pill rules use tokens; only the declared loop periods are literal", () => {
  const rules = scopedRules(read("src/styles/dictation-panel.css"));
  assert.ok(rules.some((rule) => rule.selector === ".pill-success-check"), "the scan sees the new rules");
  for (const { selector, body } of rules) {
    const allowed = LOOP_PERIODS.get(selector) ?? [];
    const found = [...(body.match(DURATION) ?? []), ...(body.match(EASING) ?? [])];
    assert.deepEqual(found.filter((value) => !allowed.includes(value)), [], selector);
  }
});

test("reduced motion keeps the pill's opacity cues and drops its movement", () => {
  const reduced = reducedMotionBlocks(read("src/styles/dictation-panel.css")).map(flat).join(" ");
  // index.css crushes every animation to 0.01ms; these fades opt back in.
  assert.match(
    reduced,
    /\.pill-success-check, \.pill-caption \{ animation: notice-fade var\(--motion-fast\) linear both !important; \}/
  );
  assert.match(reduced, /\.voice-pill-control\[data-pill-state="failed"\] \{ animation: none; \}/);
  // The token transitions keep their fade: index.css keeps opacity in
  // transition-property and drops transform, translate and scale.
  assert.match(read("src/index.css"), /prefers-reduced-motion: reduce[\s\S]*?transition-property:\s*opacity, color, background-color/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/components/pillLocality.test.js test/helpers/voicePillStructure.test.js test/hooks/pillAutoHide.test.js test/components/appPillOwnership.test.js test/components/pillMotionTokens.test.js`
Expected: FAIL:
- `pillLocality.ts` and `usePillAutoHide.js` are not found;
- there is no `data-level-bar`, and there are no stage labels;
- App never calls `usePillAutoHide` and renders no `data-pill-state="cancelled"`;
- `--motion-nudge` is undefined, and `VoicePill.tsx` still has `duration-200` and `ease-out`.

- [ ] **Step 3: Implement `pillLocality.ts`, `useRecentOutcome`, `PillCaption` and `usePillAutoHide`**

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

`src/hooks/usePillAutoHide.js`. This is App's auto-hide effect (`App.jsx:403–434`) with stage ownership added. It lives in a hook so App can call it after `pillOwnership` exists (Step 6, item 9), and so a test can mount it.

```js
import { useEffect, useRef } from "react";
import { shouldAutoHidePill } from "../helpers/voicePillPresentation";

/** The pause before an idle pill hides, so processing can start after recording stops without a flash. */
export const PILL_AUTO_HIDE_DELAY_MS = 500;

/**
 * "Auto-hide when idle" for the floating pill window. A stage that holds the
 * window (Task 10) keeps it on screen, and brings an auto-hidden pill back
 * when that stage starts.
 */
export function usePillAutoHide({
  floatingIconAutoHide,
  isRecording,
  isVisuallyProcessing,
  noticesOnScreen,
  wordsCardHandoffActive,
  assistantMounted,
  liveTranscriptMounted,
  ownership,
}) {
  const holdsWindow = Boolean(ownership?.holdsWindow);
  const prevAutoHideRef = useRef(floatingIconAutoHide);
  const prevHoldsWindowRef = useRef(false);

  useEffect(() => {
    let hideTimeout;
    if (
      shouldAutoHidePill({
        floatingIconAutoHide,
        isRecording,
        isVisuallyProcessing,
        noticesOnScreen,
        wordsCardHandoffActive,
        assistantMounted,
        liveTranscriptMounted,
        ownership: { holdsWindow },
      })
    ) {
      hideTimeout = setTimeout(() => {
        window.electronAPI?.hideWindow?.();
      }, PILL_AUTO_HIDE_DELAY_MS);
    } else if (!floatingIconAutoHide && prevAutoHideRef.current) {
      window.electronAPI?.showDictationPanel?.();
    } else if (floatingIconAutoHide && holdsWindow && !prevHoldsWindowRef.current) {
      // Only when the stage starts: show-dictation-panel also repositions the
      // window to the active display (ipcHandlers.js:1196-1198).
      window.electronAPI?.showDictationPanel?.();
    }
    prevAutoHideRef.current = floatingIconAutoHide;
    prevHoldsWindowRef.current = holdsWindow;
    return () => clearTimeout(hideTimeout);
  }, [
    floatingIconAutoHide,
    isRecording,
    isVisuallyProcessing,
    noticesOnScreen,
    wordsCardHandoffActive,
    assistantMounted,
    liveTranscriptMounted,
    holdsWindow,
  ]);
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
          "voice-pill-identity-icon",
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
      {/* Transitions live in dictation-panel.css on the motion tokens (R2-M1). */}
      <div
        className="voice-pill-sheen pointer-events-none absolute inset-0 bg-gradient-to-br from-foreground/10 to-transparent"
        style={{ opacity: state === "hover" ? 0.72 : 0 }}
      />

      <span
        className="voice-pill-identity-slot relative inline-grid shrink-0 place-items-center"
        style={{ width: locality ? IDENTITY_RING_PX : 22, height: locality ? IDENTITY_RING_PX : 22 }}
        aria-hidden={locality ? undefined : "true"}
      >
        <span
          className={cn(
            "voice-pill-identity-logo absolute inset-0 grid place-items-center",
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
            "voice-pill-expand-chevron absolute inset-0 m-auto size-5",
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
                "voice-pill-levels",
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

No class list in the file carries a Tailwind duration or easing utility (R2-M1). The sheen, the identity/chevron swap, the identity icon and the level bars get their transitions from Step 5's CSS, on the motion tokens. The inline `transition` keeps `VOICE_PILL_GROW_TRANSITION` for width, height and padding. That duration stays a JS value on purpose: LiquidCancelButton's frame tween (`LiquidCancelButton.tsx:85`) and the listening timeline read the same `LISTENING_ENTRANCE_TIMING.expansionMs`, so it is a declared functional exception.

Check that `Check` is exported from `src/components/icons` (`grep -n "Check\b" src/components/icons/index.*`). If it is not, add the lucide re-export the same way the neighbouring icons are exported.

Delete `PillWaveform.tsx` and `waveformMath.ts`. Then run `grep -rn "waveformMath\|PillWaveform\|RESTING_WAVE_SILHOUETTE\|WAVEFORM_BAR_COUNT" src test` and remove each remaining reference. The known references are `voicePillStructure.test.js` (handled in Step 1) and any `liveWaveform`/`rtlMotion` assertion that names them.

- [ ] **Step 5: CSS and the beat tokens**

First the tokens. In `src/index.css`, in the `:root` Motion block, add these lines directly after the `--motion-spring-bounce: linear(…);` declaration. On the Plan 01 branch it closes just above the `/* Bundled open-source fonts work without network access. */` comment (about line 172):

```css
  /* Plan 04 beats the picked voice specs fix (VO-R1 C, VO-Q12). Shared here
     so no pill rule carries a literal duration (spec §4). */
  --motion-nudge: 260ms;
  --motion-bounce: 640ms; /* the length --motion-spring-bounce is drawn for */
  --motion-condense-fly: 140ms;
  --motion-condense-land: 220ms;
  --motion-rewrite-underline: 600ms;
```

Task 12 uses the last three. The Plan 01 test `test/components/motionTokens.test.js` still passes: it checks only its own names.

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

/* VoicePill's own transitions, on the shared tokens (spec §4). The sheen and
   the level bars only fade. The identity/chevron swap also drops 4px and
   scales; Tailwind v4's translate-* and scale-* set the individual translate
   and scale properties, so both are listed. Under reduced motion index.css
   drops transform, translate and scale from transition-property, and the
   fade stays. */
.voice-pill-sheen,
.voice-pill-levels {
  transition: opacity var(--motion-fast) var(--motion-ease-std);
}
.voice-pill-identity-logo,
.voice-pill-expand-chevron {
  transition-property: opacity, transform, translate, scale;
  transition-duration: var(--motion-base);
  transition-timing-function: var(--motion-ease-std);
}
.voice-pill-identity-icon {
  transition:
    width var(--motion-base) var(--motion-ease-std),
    height var(--motion-base) var(--motion-ease-std);
}

.voice-pill-control[data-pill-state="pasted"] {
  border-color: var(--color-success);
}
.voice-pill-control[data-pill-state="failed"] {
  border-color: var(--color-destructive);
  animation: pill-nudge var(--motion-nudge) var(--motion-ease-std) 1;
}
.voice-pill-control[data-pill-state="recording"] {
  border-color: color-mix(in oklch, var(--color-live) 55%, transparent);
}

.pill-success-check {
  color: var(--color-success);
  stroke-dasharray: 24;
  animation:
    draw-check var(--motion-base) var(--motion-ease-std) var(--motion-instant) both,
    pill-pop var(--motion-bounce) var(--motion-spring-bounce) both;
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
  /* Movement goes; the cue stays. The red edge carries a failure without the
     nudge. The check and the caption fade in instead of popping or rising.
     index.css crushes every animation to 0.01ms under reduced motion, so the
     fade needs !important to keep its length. */
  .voice-pill-control[data-pill-state="failed"] {
    animation: none;
  }
  .pill-success-check,
  .pill-caption {
    animation: notice-fade var(--motion-fast) linear both !important;
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

`@keyframes draw-check` already exists (`src/index.css:1373` on the Plan 01 branch, `stroke-dashoffset` 24 → 0). `notice-fade` is Task 3's opacity-only keyframe in `src/styles/notices.css`, which `src/index.css` imports next to `dictation-panel.css`, so the pill window has it.

- [ ] **Step 6: Wire `App.jsx`**

1. Add these imports:
   - `resolvePillStage`, `resolvePillOwnership` and `PILL_SEALED_PAUSED_MS`, added to the existing `./helpers/voicePillPresentation` import (`App.jsx:27–45`);
   - `usePillLocality` from `./components/dictation/pillLocality`, `PillCaption` from `./components/dictation/PillCaption`, and `useRecentOutcome` from `./hooks/useRecentOutcome`;
   - `usePillAutoHide` from `./hooks/usePillAutoHide`;
   - `disclosureCopy` from `./helpers/dictationDisclosure`.

   App does not import `shouldAutoHidePill`; only `usePillAutoHide` calls it. `useSettingsStore` is already imported. `disclosureCopy` renders the `RemoteDisclosure` in `cancelled.remoteAlreadySent`. It names the receiver through `providerDisplayLabel` (Plan 01 review item 1), and says "may have received" when only the renderer saw the dispatch (Task 7).
2. **Declaration order (R1-I4).** Insert this block directly after `agentModeActive` (`App.jsx:512–517`) and before `assistantFooter` (line 518). Everything it reads is declared above that point:
   - `voicePillIsRecording` and `voicePillIsProcessing` (286–287);
   - `isProcessing`, plus Task 9's `cancelled`, `processingStage` and `outcome`, from the `useAudioRecording` destructuring (198–227);
   - `micState` (481) and `agentModeActive` (512–517).

   Everything that reads `pillStage` or `pillOwnership` comes after it: `resolveVoicePillInteraction` (519), `cancelPillFootprint` (537), `activateVoicePill` (540), `commonPillState` (576), footer suppression (599), `useLinuxPillInteractivity` (619) and the JSX. The only consumer that sits above this point is the auto-hide effect (403–434). Its dependency array is evaluated during render, so reading `pillOwnership` there would throw `ReferenceError: Cannot access 'pillOwnership' before initialization`. Item 9 moves it below. The block's hook calls (`usePillLocality`, `useRecentOutcome`, `useRef`) are unconditional, so the hook order is the same on every render.

   ```js
     const pillLocality = usePillLocality();
     // §5.4: while Sealed mode blocks the dictation route, a failure is Plan 07's pre-flight
     // refusal, and it stays readable for PILL_SEALED_PAUSED_MS instead of the 700 ms beat.
     const recentOutcome = useRecentOutcome(outcome, pillLocality.blocked ? PILL_SEALED_PAUSED_MS : undefined);
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
       dictationSealed: pillLocality.blocked,
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
       : pillStage === "sealedPaused" ? t("pill.stage.paused")
       : undefined;
     const pillCaption =
       pillStage === "cancelled" && cancelled.remoteAlreadySent
         ? disclosureCopy(cancelled.remoteAlreadySent, t)
         : pillStage === "sealedPaused"
           ? t("pill.caption.sealedPaused")
           : null;
   ```

   Tasks 12, 13 and 14 add their pill derivations (`condensed`, the Agent caption, `micTooltip`) directly after this block, so they can read it. Task 17's meeting inputs feed `resolvePillStage`, so they go directly above it. `test/components/appPillOwnership.test.js` renders App and fails on any read before a declaration.
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
7. Render the caption as a sibling of the pill inside `div.assistant-pill-presence` (lines 639–660), directly after `</PillTooltip>` (line 740) and before `<LiquidCancelButton` (line 741):

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
   - **Auto-hide (R1-I4).** Delete the effect at lines 403–434 and `prevAutoHideRef` (line 76); the effect is that ref's only reader. Call the hook from Step 3 directly after the item 2 block, so `pillOwnership` exists before anything reads it:

     ```js
       usePillAutoHide({
         floatingIconAutoHide,
         isRecording,
         isVisuallyProcessing,
         noticesOnScreen,
         wordsCardHandoffActive,
         assistantMounted: assistant.mounted,
         liveTranscriptMounted: liveTranscript.mounted,
         ownership: pillOwnership,
       });
     ```

     `floatingIconAutoHide` (line 74), `noticesOnScreen` (Task 3) and `wordsCardHandoffActive` (Task 3's rename of `dictationErrorPillHandoffActive`, line 313) are all declared above it. The effect now registers after the Escape `keydown` effect (440–469) instead of before it. Neither reads the other, so that order change is safe. A stage that holds the window brings back an auto-hidden pill once, when the stage starts (the hook's `prevHoldsWindowRef`).
   - **Footer suppression** (lines 599–604). Pass `ownership: pillOwnership` to `shouldSuppressPillForAssistantActions`.
   - **Input** (lines 519–525). Pass `ownership: pillOwnership` to `resolveVoicePillInteraction`. `pillIsInteractive` then feeds:
     - the hover handlers (mac/Windows click-through, `setWindowInteractivity`);
     - `useLinuxPillInteractivity`'s `pillInteractive` (line 622).

     The Linux input region measures `pillPresenceRef` (`useLinuxPillInteractivity.ts:51`). Undo is the pill itself, and Stop is an in-flow child of the pill (Task 17), so both lie inside the measured rect.
   - **Size.** No new size key. The cancelled (160 px) and meeting (124–184 px) footprints fit `PILL_WINDOW_SIZE`.

- [ ] **Step 7: Locale strings and DESIGN.md**

Add this to `en/translation.json` and mirror it to all 11 locales. For `ar`, `ru`, `ja` and `zh-*`, keep the English text until translated; i18next plural suffixes apply.

```json
"pill": {
  "stage": {
    "transcribing": "Transcribing…",
    "cleaning": "Cleaning up",
    "pasted_one": "Pasted · {{count}} word",
    "pasted_other": "Pasted · {{count}} words",
    "discardedUndo": "Discarded · Undo",
    "paused": "Paused"
  },
  "caption": {
    "remoteAudio": "{{provider}} already received the audio.",
    "remoteText": "{{provider}} already received the text.",
    "remoteImage": "{{provider}} already received the screenshot.",
    "mayHaveAudio": "{{provider}} may have received the audio.",
    "mayHaveText": "{{provider}} may have received the text.",
    "mayHaveImage": "{{provider}} may have received the screenshot.",
    "remoteSeveral": "{{provider}} already received parts of this dictation.",
    "mayHaveSeveral": "{{provider}} may have received parts of this dictation.",
    "sealedPaused": "Dictation paused: Sealed mode is on"
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

In `DESIGN.md` `## Motion`, add these rows to the token table, after the `--motion-spring-snap` / `-settle` / `-bounce` row:

```markdown
| `--motion-nudge` | 260ms | the failed pill's nudge |
| `--motion-bounce` | 640ms | the length `--motion-spring-bounce` is drawn for; the pasted check |
| `--motion-condense-fly` | 140ms | a spark rising from the pill's bars to its word |
| `--motion-condense-land` | 220ms | a condensation word landing |
| `--motion-rewrite-underline` | 600ms | the underline under a word cleanup rewrote |
```

Under the table, add one line: "Literal timings are allowed only for loop periods (the comet, the orbit, the meeting dot, the shimmer) and for functional deadlines such as the undo underline, whose length is the real undo window."

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- test/components/pillLocality.test.js test/helpers/voicePillStructure.test.js test/helpers/voicePillPresentation.test.js test/helpers/liquidCancelFusion.test.js test/helpers/agentDictationPillIpc.test.js test/components/levelBars.test.js test/components/localityRing.test.js test/hooks/pillAutoHide.test.js test/components/appPillOwnership.test.js test/components/pillMotionTokens.test.js test/components/motionTokens.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src/components/dictation src/hooks/useRecentOutcome.ts src/hooks/usePillAutoHide.js src/App.jsx src/styles/dictation-panel.css src/index.css src/locales DESIGN.md test
git commit -m "feat(voice): condensation pill with LevelBars, locality ring and undo capsule"
```

---
### Task 12: Condensation words on their own layer (VO-R1 C, D9)

Live words condense into a row **above** the pill, in the `PillCaption` layer. The bars inside the pill are never covered or clipped. During cleanup, changed words are rewritten with a 600 ms orange underline.

**Files:**
- Create: `src/components/dictation/condensation.ts`
- Create: `src/components/dictation/CondensationWords.tsx`
- Modify: `src/hooks/useAudioRecording.js`. Add `liveText` state: set it in `onPartialTranscript` (line 429), set `cleaned` in `onTranscriptionComplete`, and reset it at start and at idle.
- Modify: `src/App.jsx`. Destructure `liveText` (lines 198–227), compute the words after the Task 11 stage block, and render them in the caption layer.
- Modify: `src/styles/dictation-panel.css`
- Test: `test/components/condensation.test.js`
- Test: `test/components/pillMotionTokens.test.js` (add `CondensationWords.tsx` to the scanned sources)
- Test: `test/components/appPillOwnership.test.js` (`liveText` in the stand-in, and an App-level D9 check)

**Interfaces:**
- Consumes `PillCaption` (Task 11), `pillStage` (Task 11, in App), and the beat tokens `--motion-condense-fly`, `--motion-condense-land` and `--motion-rewrite-underline` (Task 11, `src/index.css`).
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

test("words land on the beat tokens; reduced motion keeps the fades and drops the flight", () => {
  const styles = css().replace(/\s+/g, " ");
  // Spark flies --motion-condense-fly (140ms); the word lands over
  // --motion-condense-land (220ms), one --motion-instant after it leaves (R2-M1).
  assert.match(
    styles,
    /\.condense-word \{[^}]*animation: condense-in var\(--motion-condense-land\) var\(--motion-ease-enter\) var\(--motion-instant\) both/
  );
  assert.match(styles, /\.condense-word\.is-partial \{[^}]*transition: opacity var\(--motion-fast\) var\(--motion-ease-std\)/);
  assert.match(styles, /@keyframes condense-in \{ from \{[^}]*filter: blur\(6px\)/);
  assert.match(styles, /\.condense-word\.is-changed::after \{[^}]*animation: condense-underline var\(--motion-rewrite-underline\) var\(--motion-ease-std\) both/);
  assert.match(
    styles,
    /\.condense-spark \{[^}]*condense-spark-rise var\(--motion-condense-fly\) var\(--motion-ease-std\) both, condense-spark-fade var\(--motion-fast\) var\(--motion-ease-exit\) var\(--motion-condense-fly\) both/
  );
  // Reduced motion: no flight; the words still fade in, and the rewrite
  // underline (colour, not movement) keeps its full length.
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.condense-spark \{ display: none; \}/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.condense-word \{ animation: notice-fade var\(--motion-fast\) linear both !important; \}/);
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*\.condense-word\.is-changed::after \{ animation-duration: var\(--motion-rewrite-underline\) !important; \}/
  );
});

test("words never render inside the pill box (D9)", () => {
  const pill = fs.readFileSync(path.join(__dirname, "../../src/components/dictation/VoicePill.tsx"), "utf8");
  assert.doesNotMatch(pill, /CondensationWords|condense-word/);
});
```

In `test/components/pillMotionTokens.test.js`, add `"src/components/dictation/CondensationWords.tsx"` to `MOTION_SOURCES`. Its `.condense-*` rules are already in the scan's scope.

In `test/components/appPillOwnership.test.js`, add `liveText: { committed: "", partial: "", cleaned: null },` to `pipeline()`, and append this App-level D9 check. It renders the real `condensed` derivation and caption slot:

```js
test("live words render in the caption layer, after the pill and outside it (D9)", async (t) => {
  const { html } = await renderApp(t, {
    isRecording: true,
    liveText: { committed: "hey maya can", partial: "you", cleaned: null },
  });
  const caption = html.indexOf('class="pill-caption"');
  assert.ok(caption > html.indexOf("voice-pill-glow-anchor"), "the caption follows the pill");
  assert.doesNotMatch(html.slice(0, caption), /condense-word/);
  assert.equal((html.slice(caption).match(/class="condense-word/g) || []).length, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/condensation.test.js test/components/pillMotionTokens.test.js test/components/appPillOwnership.test.js`
Expected: FAIL. `condensation.ts` and `CondensationWords.tsx` are not found, and App renders no `pill-caption` while recording.

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
 * word gets a spark that rises from the bar row into its slot (the "bar flies,
 * word lands" beat on --motion-condense-fly and --motion-condense-land); the
 * pill's bars are never covered (D9).
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
/* The picked beat: the spark flies --motion-condense-fly (140ms) and the word
   lands over --motion-condense-land (220ms), starting one --motion-instant
   after the spark leaves, so it settles as the spark fades. */
.condense-word {
  position: relative;
  flex: none;
  font: 500 13px/1.3 var(--font-family-sans);
  animation: condense-in var(--motion-condense-land) var(--motion-ease-enter) var(--motion-instant) both;
}
.condense-word.is-partial {
  opacity: 0.55;
  font-style: italic;
  transition: opacity var(--motion-fast) var(--motion-ease-std);
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
  animation: condense-underline var(--motion-rewrite-underline) var(--motion-ease-std) both;
}
@keyframes condense-underline {
  to {
    opacity: 0;
  }
}
/* The spark: a 2px bar that rises from the pill's top edge (the caption sits
   8px above the pill) to the newest word at the row's trailing end, then
   fades. The rise and the fade are two animations, so each runs on a token
   and the rise is exactly --motion-condense-fly. It is positioned on
   .pill-caption, outside the masked track, and never overlaps the pill's
   bars (D9). */
.condense-spark {
  position: absolute;
  right: 18px;
  bottom: -8px;
  width: 2px;
  height: 10px;
  border-radius: 2px;
  background: var(--color-live);
  animation:
    condense-spark-rise var(--motion-condense-fly) var(--motion-ease-std) both,
    condense-spark-fade var(--motion-fast) var(--motion-ease-exit) var(--motion-condense-fly) both;
  pointer-events: none;
}
@keyframes condense-spark-rise {
  from {
    transform: translateY(0) scaleY(1);
  }
  to {
    transform: translateY(-14px) scaleY(0.3);
  }
}
@keyframes condense-spark-fade {
  to {
    opacity: 0;
  }
}
```

Inside the reduced-motion block, add:

```css
  /* No flight. The words still fade in, and the rewrite underline is colour,
     not movement, so it keeps its full length. index.css crushes every
     animation to 0.01ms here, hence !important. */
  .condense-spark {
    display: none;
  }
  .condense-word {
    animation: notice-fade var(--motion-fast) linear both !important;
  }
  .condense-word.is-changed::after {
    animation-duration: var(--motion-rewrite-underline) !important;
  }
```

`useAudioRecording.js`:
- State: `const [liveText, setLiveText] = useState({ committed: "", partial: "", cleaned: null });`.
- In `onPartialTranscript` (line 429), after `setPartialTranscript(text)`, add `setLiveText({ committed: audioManagerRef.current?.streamingFinalText ?? "", partial: text, cleaned: null });`.
- In `onTranscriptionComplete`, at the top, add `setLiveText((prev) => (prev.committed || prev.partial ? { ...prev, cleaned: result.text } : prev));`.
- Reset with `setLiveText({ committed: "", partial: "", cleaned: null })` at successful start (next to `registerCancelHotkey`) and when the pill idles after the outcome beat. Clear it in the same `onStateChange` idle branch only when no outcome is pending. In practice, App stops reading `liveText` outside the stages listed below, so resetting at start is sufficient.
- Add `liveText` to the return object.

`App.jsx`:
- Add `useMemo` to the React import (line 1). Import `condenseWords` and `diffWords` from `./components/dictation/condensation`, and `CondensationWords` from `./components/dictation/CondensationWords`.
- Add `liveText` to the `useAudioRecording` destructuring (lines 198–227).
- Compute the words directly after the Task 11 stage block (after `pillCaption`), because the memo reads `pillStage`:

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

Run: `npm test -- test/components/condensation.test.js test/helpers/voicePillStructure.test.js "test/helpers/useAudioRecording*.test.js" test/components/pillMotionTokens.test.js test/components/appPillOwnership.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dictation/condensation.ts src/components/dictation/CondensationWords.tsx src/hooks/useAudioRecording.js src/App.jsx src/styles/dictation-panel.css test/components/condensation.test.js test/components/pillMotionTokens.test.js test/components/appPillOwnership.test.js
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
- Modify: `src/App.jsx`. Add the answering phase and the Agent caption, after the Task 11 stage block.
- Modify: `src/locales/*/translation.json` (`pill.agent.*`)
- Modify: `DESIGN.md` `### Voice Pill`, Agent paragraph
- Test: `test/components/agentOrbit.test.js`
- Test: `test/helpers/voicePillStructure.test.js`. Update the Agent tests at lines 238–310.
- Test: `test/components/pillMotionTokens.test.js` (add `AgentOrbit.tsx` to the scanned sources)

**Interfaces:**
- Consumes `nextLevelBarsFrame`, `LEVEL_BARS_SILENCE_FLOOR`, `LOGO_BAR_SHAPE` and `levelBarScale` (Plan 01, `levelBarsMath.ts`), `routeProviderLabel` (Task 11), `useResolvedRoute("voiceAssistant" | "assistantVision")` (§5.1), the `voiceAgentScreenContext` setting (`settingsStore.ts:1755`), `assistant.thinking` / `assistant.busy` (`useAssistantPanel.js:32-33`), `PillCaption` (Task 11), and the Plan 01 tokens `--motion-slow`, `--motion-hero` and `--motion-ease-exit`.
- Produces:

  ```ts
  export const AGENT_TICK_COUNT = 24;
  export function agentTickLength(index: number, level: number, timeMs: number, reduce?: boolean): number; // 2..11 px; flat phase when reduce
  export function agentTickLevel(frame: LevelBarsFrame, raw: unknown): number; // 0..1, peak-normalised with LEVEL_BARS_SILENCE_FLOOR
  export function AgentOrbit(props: { phase: "listening" | "thinking" | "answering"; readLevel: () => number }): JSX.Element;
  export const AGENT_ANSWERING_MS = 1000;
  export function useAgentAnswering(thinking: boolean, busy: boolean): boolean; // true for AGENT_ANSWERING_MS after the first token
  // VoicePill gains: agentPhase?: "answering"
  ```

  The orbit's loop periods (2.4 s thinking, 1.2 s answering) are declared exceptions. The answering dissolve is an ordinary exit, so it runs on `--motion-hero` after `--motion-slow` (R2-M1).

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

test("orbit timing: 2.4s thinking, 1.2s answering that dissolves on the exit tokens", () => {
  const styles = css();
  assert.match(styles, /\.agent-orbit\[data-phase="thinking"\] \.agent-orbit__ring\s*\{[^}]*animation:\s*agent-orbit 2400ms linear infinite/);
  assert.match(
    styles,
    /\.agent-orbit\[data-phase="answering"\] \.agent-orbit__ring\s*\{[^}]*agent-orbit 1200ms linear infinite,\s*agent-orbit-fade var\(--motion-hero\) var\(--motion-ease-exit\) var\(--motion-slow\) forwards/
  );
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.agent-orbit__ring[\s\S]*animation:\s*none/);
});

test("the answering dissolve ends inside the answering phase", async () => {
  const { AGENT_ANSWERING_MS } = await import("../../src/hooks/useAgentAnswering.ts");
  const index = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const token = (name) => Number(index.match(new RegExp(`${name}:\\s*(\\d+)ms;`))[1]);
  // 360 + 520 = 880 ms today: the ring has dissolved before data-phase leaves "answering".
  assert.ok(token("--motion-slow") + token("--motion-hero") <= AGENT_ANSWERING_MS);
});

test("no frame glyph and no beam ring ship with Agent Mode (owner note)", async () => {
  // Checks the rendered orbit, not its source: the source legitimately says
  // "frame" for LevelBars frames (nextLevelBarsFrame).
  const { AgentOrbit } = await import("../../src/components/dictation/AgentOrbit.tsx");
  for (const phase of ["listening", "thinking", "answering"]) {
    assert.doesNotMatch(renderStatic(AgentOrbit, { phase, readLevel: () => 0 }), /frame|glyph/i, phase);
  }
  assert.doesNotMatch(css(), /data-agent-beam-active/);
});
```

In `test/helpers/voicePillStructure.test.js`, rewrite the Agent tests (lines 238–310) to these expectations:
- `renderPill("thinking", false, "right", { agentMode: true })` contains `class="agent-orbit" data-phase="thinking"`, does **not** contain `data-agent-beam-active`, and the signal glow is not active (`doesNotMatch(/data-active="true"/)`).
- `renderPill("recording", true, "right", { agentMode: true })` keeps the 40×40 footprint (`pillFootprints().idle`) and contains `data-phase="listening"`.
- The violet identity leaf (`voice-identity-final-agent`, `data-agent-mode="true"`) assertions stay as they are.

In `test/components/pillMotionTokens.test.js`, add `"src/components/dictation/AgentOrbit.tsx"` to `MOTION_SOURCES`. Its `.agent-orbit*` rules are already in the scan's scope, and `LOOP_PERIODS` already lists the orbit, satellite and breathe loops.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/components/agentOrbit.test.js test/helpers/voicePillStructure.test.js test/components/pillMotionTokens.test.js`
Expected: FAIL with `Cannot find module '…/agentOrbitMath.ts'`, and `AgentOrbit.tsx` is not found.

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
 * than dictation's 1.6s comet, "thinking" not "working"). Answering: a 1.2s
 * spin-up that dissolves on the exit tokens. Mounted only in those phases, so
 * its loops are gated. The screen-context glyph was cut (owner note, D9); the caption
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

/** How long the orbit shows "answering". The CSS dissolve must end inside it. */
export const AGENT_ANSWERING_MS = 1000;

/** True for AGENT_ANSWERING_MS after the Agent's first token (thinking → streaming while busy). */
export function useAgentAnswering(thinking: boolean, busy: boolean): boolean {
  const wasThinking = useRef(thinking);
  const [answering, setAnswering] = useState(false);
  useEffect(() => {
    if (wasThinking.current && !thinking && busy) {
      setAnswering(true);
      const id = setTimeout(() => setAnswering(false), AGENT_ANSWERING_MS);
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
/* The spin-up keeps its picked 1.2 s period (a declared loop exception). The
   dissolve is an ordinary exit: --motion-hero after --motion-slow, which ends
   at 880 ms, inside useAgentAnswering's AGENT_ANSWERING_MS. */
.agent-orbit[data-phase="answering"] .agent-orbit__ring {
  animation:
    agent-orbit 1200ms linear infinite,
    agent-orbit-fade var(--motion-hero) var(--motion-ease-exit) var(--motion-slow) forwards;
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
- Put both additions below directly after the Task 11 stage block (and after Task 12's `condensed`). The caption reads `agentModeActive` (lines 512–517), so it cannot go higher. `test/components/appPillOwnership.test.js` fails on any read before a declaration.
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

Run: `npm test -- test/components/agentOrbit.test.js test/helpers/voicePillStructure.test.js test/helpers/voicePillPresentation.test.js test/components/pillMotionTokens.test.js test/components/appPillOwnership.test.js`
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
- Modify: `src/components/dictation/PillTooltip.tsx`. Use 12 px text, allow two lines, use a rounded rectangle, and drop the dead `transition-opacity duration-150`.
- Modify: `src/App.jsx:483-496` (`getMicTooltip` and `micTooltip`). The new `micTooltip` moves below the Task 11 stage block, because it reads `pillLocality`.
- Modify: `src/styles/dictation-panel.css`. Covers VO-Q19, VO-Q20, and the `.assistant-response-content-updating` exit at about lines 566–572.
- Modify: `src/index.css`. Covers `.thinking-shimmer-text` (about line 1762 on the Plan 01 branch), used by `ChatMessage.tsx:249`.
- Modify: `src/locales/*/translation.json` (`pill.tooltip.*`)
- Test: `test/components/pillTooltip.test.js`
- Test: `test/components/pillMotionTokens.test.js` (add `PillTooltip.tsx` to the scanned sources)

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

In `test/components/pillMotionTokens.test.js`, add `"src/components/dictation/PillTooltip.tsx"` to `MOTION_SOURCES`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/pillTooltip.test.js test/components/pillMotionTokens.test.js`
Expected: FAIL with `Cannot find module '…/pillTooltipLines.ts'`, and the scan finds `duration-150` in `PillTooltip.tsx`.

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
- Delete `transition-opacity duration-150`. The bubble mounts only while hovered (`isVisible && !disabled`, line 37) at full opacity, so that transition never ran. Removing it changes nothing on screen and leaves no literal timing (R2-M1).
- Wrap the content in `<span className="flex flex-col gap-0.5">`. Leave `whitespace-nowrap`, since each line stays a single line.
- Keep the physical `left-*`/`right-*` in `alignClass` and `arrowClass`. `align` follows the pill's physical screen dock, not the text direction, so mirroring it in RTL would point the tooltip away from the pill.

In `App.jsx`, delete `getMicTooltip` and `const micTooltip = getMicTooltip();` (lines 483–496). Define the new `micTooltip` directly after the Task 11 stage block, which declares `pillLocality`; its only readers are the JSX (`content` at line 662 and `aria-label` at line 692). `test/components/appPillOwnership.test.js` renders App and fails if it reads `pillLocality` first.

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

`activationMode` is a new store read; it sits with the tooltip, below the stage block. Keep `formatPillHotkeyLabel` (lines 47–51); the tooltip still uses it.

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

Run: `npm test -- test/components/pillTooltip.test.js test/helpers/voicePillStructure.test.js test/components/rtlMotion.test.js test/components/pillMotionTokens.test.js test/components/appPillOwnership.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dictation/pillTooltipLines.ts src/components/dictation/PillTooltip.tsx src/App.jsx src/styles/dictation-panel.css src/index.css src/locales test/components/pillTooltip.test.js test/components/pillMotionTokens.test.js
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

Closes review findings I8 and I14 for the main-process side, and round 2's R1-I8 and R1-I14.

Plan 02's `showSystemNotification` (§5.5) is for interruptions and carries no actions. The resident Linux recorder notification needs a Stop action, so it keeps its own freedesktop path: the bundled `@homebridge/dbus-native` client below, never a host CLI. It does not route through `showSystemNotification`.

Meeting capture runs in the control-panel renderer. That renderer reports two separate things:
- **presence**, which is liveness only: is a meeting recording right now, since when, and is a source lost;
- an explicit **outcome**, sent after the stop has actually finished: saved, failed to save, or failed to stop.

"Saved" needs two acknowledgements (R1-I14):
- the transcript write returned `{ success: true }`, or there was no transcript content to write;
- main's stop returned `{ success: true }`.

A returned `{ success: false }`, a missing API, a missing result and a throw are all failures. `updateNote` returns `{ success: false }` without throwing (`database.js:1194`, `:1231`, `:1239`; the IPC handler passes it through at `ipcHandlers.js:1606-1618`). Main's stop returns `{ success: false, reason: "stale-session" }` for an unknown session (`meetingTranscriptionLifecycle.js:39-43`, `ipcHandlers.js:7700-7702`) and `{ success: false, error }` when teardown fails.

Main relays both to the pill window and the tray. It turns owner loss (crash, reload, close) into a `failed` outcome with reason `ownerLost`, and never into "saved".

On Linux, main posts a persistent notification through the freedesktop notification service. It uses the D-Bus library the app already ships (`@homebridge/dbus-native`, `package.json:129`, used lazily by `kdeShortcut.js`, `gnomeShortcut.js` and others), not a host CLI. This follows D2 with the spec owner's 2026-10-15 clarification:
- Where the server advertises `actions` (`GetCapabilities`), the notification has a Stop button.
- Where it does not, the notification is still posted, without Stop. Clicking it brings up the pill with Stop visible.
- Where publishing fails, the same notification is posted without actions through Electron's `Notification`. Clicking it brings up the pill with Stop visible. Publishing fails when there is no session bus, when the service goes away during `GetCapabilities`, when `Notify` rejects or times out, and when the service drops after the notification was posted.
- The tray menu's "Stop meeting recording" item is always there.
- Stop and the click are bound to the meeting session the notification was posted for. A stale notification id, or a session that already ended, does nothing.

The notification's lifetime is serialised by generation:
- a notification posted after its session ended is closed as soon as its id arrives;
- signals are subscribed before posting;
- `NotificationClosed`, service loss and app teardown are all handled.

**What a click can deliver.** A freedesktop click is the `default` action, reported as `ActionInvoked(id, "default")`. The freedesktop spec lets a server without the `actions` capability ignore every action, `default` included. Electron's Linux `Notification` registers its click only when the server advertises `actions` (`NotifierSupportsActions()` in Electron's `shell/browser/notifications/linux/libnotify_notification.cc`). So the plan always asks for the `default` action and handles both `ActionInvoked "default"` and Electron's `click`. A server that ignores clicks delivers nothing, so the fallback text also names the tray. Task 20's Linux matrix should record which desktops deliver the click.

**Bringing up the pill.** A click calls `windowManager.revealMeetingRecorder(sessionId)`. It shows the pill window (`showDictationPanel`, `windowManager.js:1545`) and sends `meeting-recorder-reveal-requested` with the session id. **Hand-off to Task 17:** the App consumes `onMeetingRecorderRevealRequested` and shows the capsule with Stop for that session, even when `showMeetingRecorderOnScreen` is off or the pill is auto-hidden, for as long as that session's presence lasts.

**Files:**
- Create: `src/helpers/meetingPresence.js` (main, CommonJS)
- Create: `src/helpers/linuxRecordingNotification.js` (main)
- Create: `src/helpers/freedesktopNotifications.js` (main; the thin `@homebridge/dbus-native` adapter)
- Create: `src/helpers/trayRecordingIcon.js` (main)
- Modify: `src/stores/meetingRecordingStore.ts`:
  - `stopRecording` (1503–1615) learns whether the transcript write and the main stop were acknowledged, and reports an outcome;
  - `StopRecordingResult` (1495–1501) gains `persisted` and `stopError`.
- Modify: `src/helpers/ipcHandlers.js`. Add `meeting-recording-presence`, `meeting-recording-outcome`, `get-meeting-recording-presence` and `request-stop-meeting-recording`.
- Modify: `src/helpers/windowManager.js`. Own the presence, relay to `mainWindow`, and add `requestStopMeetingRecording(sessionId)` and `revealMeetingRecorder(sessionId)`.
- Modify: `src/helpers/tray.js`. Add `setMeetingPresence`, the recording items at the top of `buildContextMenuTemplate()` (254), the tooltip, and the Linux icon and notification. Add the `platform`, `createNotificationClient` and `ElectronNotification` fields, so tests drive the real tray on any host.
- Modify: `main.js:883-889`. Wire presence and outcome to the tray. On `before-quit`, close the notification.
- Modify: `preload.js`, `src/types/electron.ts`, `src/preview/browserPreview.ts`
- Modify: `src/components/MeetingRecordingMount.tsx`. Report presence; stop on request, bound to the session.
- Test: `test/helpers/meetingPresence.test.js`
- Test: `test/helpers/linuxRecordingNotification.test.js`
- Test: `test/helpers/meetingStopOutcome.test.js`
- Test: modify `test/helpers/windowManagerMeetingNotification.test.js`. Stop and click delivery through the real window manager, tray and notification.

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
    constructor({ client, ElectronNotification, onStop: (sessionId) => void, onOpen: (sessionId) => void });
    // Serialised; replaces any earlier one. Stop where the server has `actions`;
    // otherwise no Stop, and the click (where delivered) calls onOpen. Falls back
    // to an action-free Electron notification when publishing fails.
    show({ sessionId, title, body, stopLabel, fallbackBody }): Promise<void>;
    close(): Promise<void>;  // idempotent; also closes a late id and the fallback
  }
  // src/helpers/freedesktopNotifications.js
  createFreedesktopClient({ getDBus? }): Promise<{
    capabilities(): Promise<string[]>; notify(o): Promise<number>; close(id): Promise<void>;
    onAction(cb: (id: number, key: string) => void): void; onClosed(cb: (id: number) => void): void;
    onDisconnect(cb: () => void): void;
  } | null>;  // null when D-Bus or the service is unavailable; every call rejects after 5 s without an answer
  ```

  ```js
  // src/helpers/windowManager.js
  requestStopMeetingRecording(sessionId): boolean;  // false for a session that is not the one recording
  revealMeetingRecorder(sessionId): boolean;        // shows the pill and asks it for the capsule; same session check
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
  onMeetingRecorderRevealRequested?: (cb: (sessionId: string) => void) => () => void;  // consumed by Task 17
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
const { LinuxRecordingNotification } = require("../../src/helpers/linuxRecordingNotification.js");

// Stands in for the D-Bus service. With `manual`, each Notify answer waits until
// the test calls the function queued in `pendingNotify` (true answers with the
// next id, false rejects). `capsError` and `notifyError` make those calls reject
// the way a service that drops off the bus does.
function fakeClient({ caps = ["actions", "body"], capsError = null, notifyError = null, manual = true } = {}) {
  const bus = new EventEmitter();
  const calls = [];
  const posted = [];
  const pendingNotify = [];
  let nextId = 41;
  return {
    calls,
    posted,
    bus,
    pendingNotify,
    capabilities: async () => {
      if (capsError) throw capsError;
      return caps;
    },
    notify: (o) => {
      calls.push(["notify", o.actions]);
      posted.push(o);
      return new Promise((resolve, reject) => {
        const answer = (ok = !notifyError) => (ok ? resolve(++nextId) : reject(notifyError ?? new Error("Connection closed")));
        if (manual) pendingNotify.push(answer);
        else answer();
      });
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
  }
  show() {
    FakeElectronNotification.shown.push(this);
  }
  close() {
    this.closed = true;
  }
}

test.beforeEach(() => {
  FakeElectronNotification.shown.length = 0;
});

const tick = () => new Promise((r) => setImmediate(r));
const until = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i += 1) await tick();
  assert.ok(cond(), "condition reached");
};
const opts = { title: "Loqui is recording", body: "b", stopLabel: "Stop", fallbackBody: "Click to show the pill." };

function make(client) {
  const stops = [];
  const opened = [];
  const n = new LinuxRecordingNotification({
    client,
    ElectronNotification: FakeElectronNotification,
    onStop: (sessionId) => stops.push(sessionId),
    onOpen: (sessionId) => opened.push(sessionId),
  });
  return { n, stops, opened };
}

test("stop pressed in the notification stops that meeting session", async () => {
  const client = fakeClient();
  const { n, stops } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()();
  await shown;
  assert.deepEqual(client.calls[0], ["notify", ["default", "", "stop", "Stop"]]);
  assert.equal(client.posted[0].body, "b");
  client.bus.emit("action", 99, "stop"); // someone else's notification
  client.bus.emit("action", 42, "stop");
  assert.deepEqual(stops, ["m1"]);
});

test("close() while Notify is pending closes the late id when it arrives (I8)", async () => {
  const client = fakeClient();
  const { n, stops } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  const closing = n.close(); // the meeting stopped before the service answered
  client.pendingNotify.shift()(); // id 42 arrives late
  await Promise.all([shown, closing]);
  assert.deepEqual(client.calls.filter(([c]) => c === "close"), [["close", 42]]);
  client.bus.emit("action", 42, "stop");
  assert.deepEqual(stops, [], "a closed notification stops nothing");
});

test("a new meeting replaces the old notification; the old one's late id is closed", async () => {
  const client = fakeClient();
  const { n, stops } = make(client);
  const first = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  const second = n.show({ ...opts, sessionId: "m2" });
  client.pendingNotify.shift()(); // 42 for m1, now obsolete
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()(); // 43 for m2
  await Promise.all([first, second]);
  assert.deepEqual(client.calls.filter(([c]) => c === "close"), [["close", 42]]);
  client.bus.emit("action", 42, "stop"); // the stale id
  client.bus.emit("action", 43, "stop");
  assert.deepEqual(stops, ["m2"]);
});

test("a notification the user dismissed is forgotten; service loss falls back next time", async () => {
  const client = fakeClient();
  const { n } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()();
  await shown;
  client.bus.emit("closed", 42);
  await n.close();
  assert.equal(client.calls.some(([c, id]) => c === "close" && id === 42), false, "nothing left to close");
  client.bus.emit("disconnect");
  await n.show({ ...opts, sessionId: "m2" });
  assert.equal(FakeElectronNotification.shown.length, 1, "fell back after the service went away");
});

test("no action support: the notification still shows, without Stop, and its click brings up the pill (D2)", async () => {
  const client = fakeClient({ caps: ["body"], manual: false });
  const { n, stops, opened } = make(client);
  await n.show({ ...opts, sessionId: "m1" });
  assert.deepEqual(client.calls, [["notify", ["default", ""]]], "never offers a Stop the server cannot show");
  assert.equal(client.posted[0].body, opts.fallbackBody);
  assert.equal(client.posted[0].hints.resident, true);
  assert.equal(FakeElectronNotification.shown.length, 0, "the service took it; no second notification");
  client.bus.emit("action", 42, "stop"); // no button was offered, so this cannot be a Stop
  client.bus.emit("action", 42, "default"); // the click
  assert.deepEqual(stops, []);
  assert.deepEqual(opened, ["m1"]);
});

test("no service at all: an action-free notification still shows, and its click brings up the pill (D2)", async () => {
  const { n, opened } = make(null);
  await n.show({ ...opts, sessionId: "m1" });
  const [fallback] = FakeElectronNotification.shown;
  assert.equal(fallback.opts.timeoutType, "never");
  assert.equal(fallback.opts.body, opts.fallbackBody);
  assert.equal("actions" in fallback.opts, false);
  fallback.emit("click");
  assert.deepEqual(opened, ["m1"]);
  await n.close();
  assert.equal(fallback.closed, true);
});

test("service lost during capability discovery: the notification still shows (R1-I8)", async () => {
  const client = fakeClient({ capsError: new Error("org.freedesktop.DBus.Error.ServiceUnknown") });
  const { n, opened } = make(client);
  await n.show({ ...opts, sessionId: "m1" });
  assert.deepEqual(client.calls, [], "nothing posted to a service that did not answer");
  assert.equal(FakeElectronNotification.shown.length, 1);
  assert.equal(FakeElectronNotification.shown[0].opts.body, opts.fallbackBody);
  FakeElectronNotification.shown[0].emit("click");
  assert.deepEqual(opened, ["m1"]);
});

test("Notify rejected after discovery: the notification still shows, without Stop (R1-I8)", async () => {
  const client = fakeClient({ notifyError: new Error("Connection closed") });
  const { n, stops } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()(); // rejects
  await shown;
  assert.deepEqual(client.calls, [["notify", ["default", "", "stop", "Stop"]]]);
  assert.equal(FakeElectronNotification.shown.length, 1, "the rejection is not swallowed");
  assert.equal(FakeElectronNotification.shown[0].opts.body, opts.fallbackBody);
  await n.close();
  assert.equal(FakeElectronNotification.shown[0].closed, true);
  assert.deepEqual(stops, []);
});

test("a meeting that ends while Notify is failing posts nothing", async () => {
  const client = fakeClient({ notifyError: new Error("Connection closed") });
  const { n } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  const closing = n.close();
  client.pendingNotify.shift()(); // rejects after the meeting ended
  await Promise.all([shown, closing]);
  assert.equal(FakeElectronNotification.shown.length, 0);
});

test("service lost after posting: the notification is posted again without Stop, for the same session", async () => {
  const client = fakeClient({ manual: false });
  const { n, stops, opened } = make(client);
  await n.show({ ...opts, sessionId: "m1" });
  client.bus.emit("disconnect");
  await until(() => FakeElectronNotification.shown.length === 1);
  client.bus.emit("action", 42, "stop"); // the old id can no longer stop anything
  assert.deepEqual(stops, []);
  FakeElectronNotification.shown[0].emit("click");
  assert.deepEqual(opened, ["m1"]);
  await n.close();
  assert.equal(FakeElectronNotification.shown[0].closed, true);
});
```

Session-bound delivery is tested through the real window manager and tray, not only through the class. In `test/helpers/windowManagerMeetingNotification.test.js`:
- Inside the `Module._load` stub block, right after `const WindowManager = require("../../src/helpers/windowManager");` (line 129), add `const TrayManager = require("../../src/helpers/tray");`. The stubs already cover what `tray.js` loads at module level (`electron`, `./debugLogger`, `./dockManager`, `./i18nMain`).
- After `createDeferred` (lines 6–14), add:

  ```js
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  async function until(condition) {
    for (let i = 0; i < 100 && !condition(); i += 1) await settle();
    assert.ok(condition(), "condition reached");
  }
  ```

- Append this test:

```js
// D2: Stop and the click in the Linux notification reach the real window
// manager, bound to the session the notification was posted for.
test("the Linux notification stops and reveals only the session it was posted for (D2)", async () => {
  const manager = createNormalWindowManager();
  const toPanel = [];
  const toPill = [];
  manager.controlPanelWindow = {
    isDestroyed: () => false,
    webContents: { isLoading: () => false, send: (channel, data) => toPanel.push([channel, data]) },
  };
  manager.mainWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => false,
    showInactive: () => toPill.push("show"),
    webContents: { send: (channel, data) => toPill.push([channel, data]) },
  };
  const bus = new EventEmitter();
  const posted = [];
  const client = {
    capabilities: async () => ["actions", "body"],
    notify: async (o) => (posted.push(o), 41 + posted.length),
    close: async () => undefined,
    onAction: (cb) => bus.on("action", cb),
    onClosed: (cb) => bus.on("closed", cb),
    onDisconnect: (cb) => bus.on("disconnect", cb),
  };
  const tray = new TrayManager();
  tray.platform = "linux";
  tray.createNotificationClient = async () => client;
  tray.ElectronNotification = class extends EventEmitter {
    show() {}
    close() {}
  };
  tray.setWindowManager(manager);
  manager.onMeetingPresenceChanged = (presence) => tray.setMeetingPresence(presence);
  const stopRequests = () => toPanel.filter(([channel]) => channel === "meeting-recording-stop-requested");

  manager.meetingPresence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  await until(() => posted.length === 1); // id 42 for m1
  bus.emit("action", 99, "stop"); // another app's notification
  bus.emit("action", 42, "stop");
  assert.deepEqual(stopRequests(), [["meeting-recording-stop-requested", "m1"]]);

  bus.emit("action", 42, "default"); // the click
  assert.deepEqual(toPill.slice(-2), ["show", ["meeting-recorder-reveal-requested", "m1"]]);

  manager.meetingPresence.set(7, { recording: false });
  manager.meetingPresence.set(7, { recording: true, sessionId: "m2", startedAt: 2000 });
  await until(() => posted.length === 2); // id 43 for m2
  bus.emit("action", 42, "stop"); // m1's notification is gone
  assert.equal(stopRequests().length, 1, "a stale notification id stops nothing");
  bus.emit("action", 43, "stop");
  assert.deepEqual(stopRequests().at(-1), ["meeting-recording-stop-requested", "m2"]);

  // The session ended before the Stop arrived: main's session check drops it.
  manager.meetingPresence.set(7, { recording: false });
  bus.emit("action", 43, "stop");
  bus.emit("action", 43, "default");
  assert.equal(stopRequests().length, 2);
  assert.equal(toPill.filter((entry) => entry[0] === "meeting-recorder-reveal-requested").length, 1);
});
```

The last two actions arrive before the queued `close()` runs, so the notification still forwards them. `requestStopMeetingRecording` and `revealMeetingRecorder` drop them, because presence no longer names `m2`.

Create `test/helpers/meetingStopOutcome.test.js`. It drives the real `stopRecording` through the renderer harness. The failure tests use the shapes the real handlers return, not only throws:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function load(t, electronAPI) {
  const outcomes = [];
  const api = { ...electronAPI, reportMeetingRecordingOutcome: (o) => outcomes.push(o) };
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const vite = await createRendererServer(t, { cachePrefix: "openwhispr-meeting-outcome-" });
  const store = await vite.ssrLoadModule("/stores/meetingRecordingStore.ts");
  return { store, outcomes, api };
}

const ok = async () => ({ success: true });

test("a saved meeting reports saved only after the write and the stop were acknowledged", async (t) => {
  const { store, outcomes } = await load(t, {
    updateNote: async () => ({ success: true, note: {} }),
    meetingTranscriptionStop: async () => ({ success: true }),
  });
  store.__primeRecordingForTests({ sessionId: "m1", noteId: 11, startedAt: Date.now() - 1000, segments: [{ text: "hi" }] });
  const result = await store.stopRecording("m1");
  assert.equal(result.persisted, true);
  assert.equal(result.stopError, false);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].kind, "saved");
  assert.equal(outcomes[0].sessionId, "m1");
  assert.equal(outcomes[0].noteId, "11");
});

test("a write that returns failure, returns nothing, throws or has no API is a failed save, never 'saved' (R1-I14)", async (t) => {
  const { store, outcomes, api } = await load(t, { meetingTranscriptionStop: ok });
  const failingWrites = {
    "note gone (database.js:1194)": async () => ({ success: false, error: "Note not found" }),
    "nothing written (database.js:1231)": async () => ({ success: false }),
    "no result": async () => undefined,
    threw: async () => {
      throw new Error("disk full");
    },
    "no API": undefined,
  };
  for (const [label, updateNote] of Object.entries(failingWrites)) {
    api.updateNote = updateNote;
    outcomes.length = 0;
    const sessionId = `m-${label}`;
    store.__primeRecordingForTests({ sessionId, noteId: 11, startedAt: Date.now(), segments: [{ text: "hi" }] });
    const result = await store.stopRecording(sessionId);
    assert.equal(result.persisted, false, label);
    assert.deepEqual(outcomes, [{ sessionId, kind: "failed", reason: "save" }], label);
  }
});

test("a stop main did not acknowledge is a failed stop, never 'saved' (R1-I14)", async (t) => {
  const { store, outcomes, api } = await load(t, { updateNote: async () => ({ success: true, note: {} }) });
  const failingStops = {
    "stale session (meetingTranscriptionLifecycle.js:39-43)": async () => ({ success: false, reason: "stale-session" }),
    "teardown error": async () => ({ success: false, error: "socket closed" }),
    "no result": async () => undefined,
    threw: async () => {
      throw new Error("ipc gone");
    },
    "no API": undefined,
  };
  for (const [label, meetingTranscriptionStop] of Object.entries(failingStops)) {
    api.meetingTranscriptionStop = meetingTranscriptionStop;
    outcomes.length = 0;
    const sessionId = `m-${label}`;
    store.__primeRecordingForTests({ sessionId, noteId: 11, startedAt: Date.now(), segments: [{ text: "hi" }] });
    const result = await store.stopRecording(sessionId);
    assert.equal(result.persisted, true, label);
    assert.equal(result.stopError, true, label);
    assert.deepEqual(outcomes, [{ sessionId, kind: "failed", reason: "stop" }], label);
  }
});

test("an empty meeting (no segments, no fallback transcript) is saved: there was nothing to write", async (t) => {
  let writes = 0;
  const { store, outcomes } = await load(t, {
    updateNote: async () => (writes++, { success: true }),
    meetingTranscriptionStop: ok,
  });
  store.__primeRecordingForTests({ sessionId: "m1", noteId: 11, startedAt: Date.now(), segments: [] });
  const result = await store.stopRecording("m1");
  assert.equal(writes, 0, "nothing to write");
  assert.equal(result.persisted, true);
  assert.equal(outcomes.at(-1).kind, "saved");
});

test("a transcript with no note to write to is a failed save, not a no-write", async (t) => {
  const { store, outcomes } = await load(t, { updateNote: ok, meetingTranscriptionStop: ok });
  store.__primeRecordingForTests({ sessionId: "m1", noteId: null, startedAt: Date.now(), segments: [{ text: "hi" }] });
  const result = await store.stopRecording("m1");
  assert.equal(result.persisted, false);
  assert.deepEqual(outcomes, [{ sessionId: "m1", kind: "failed", reason: "save" }]);
});

test("a stop for another session is ignored, and duplicate stops report once", async (t) => {
  const { store, outcomes } = await load(t, { updateNote: ok, meetingTranscriptionStop: ok });
  store.__primeRecordingForTests({ sessionId: "m1", noteId: 11, startedAt: Date.now(), segments: [] });
  assert.equal((await store.stopRecording("m-other")).stopped, false);
  await Promise.all([store.stopRecording("m1"), store.stopRecording("m1")]);
  assert.equal(outcomes.length, 1);
});
```

`__primeRecordingForTests` is a test seam you add to `meetingRecordingStore.ts`. It sets the module flags (`activeRecordingSessionId`, `isRecordingFlag`) and the store fields `stopRecording` reads (`recordingNoteId`, `segments`, `recordingStartedAt`, `isRecording`, and `transcript: ""`), without starting capture. If `stopRecording` calls the cleanup closure set by `startRecording`, have the seam set it to a no-op. Mock `"/utils/logger"` in `createRendererServer` if the store's logger import needs it, the way `test/helpers/harness/audioManager.js` does. If `{ text: "hi" }` is not enough for `serializeTranscriptSegments`, give the primed segments the fields it reads; keep one non-empty segment.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/meetingPresence.test.js test/helpers/linuxRecordingNotification.test.js test/helpers/meetingStopOutcome.test.js test/helpers/windowManagerMeetingNotification.test.js`
Expected: FAIL with `Cannot find module '…/meetingPresence.js'`. The window-manager suite fails because `manager.meetingPresence` does not exist yet.

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
// The resident "recording" notification on Linux (D2, with the spec owner's
// 2026-10-15 clarification):
// - the server advertises `actions`: a Stop button, plus the click (`default`);
// - it does not: the same notification without Stop; its click, where the
//   server delivers one, brings up the pill;
// - publishing fails (no service, GetCapabilities or Notify rejects or times
//   out, the service drops later): an action-free Electron notification whose
//   click brings up the pill.
// One lifetime at a time, serialised by generation: a Notify answer that
// arrives after its session ended is closed immediately, and signals are
// subscribed before anything is posted. Stop and the click carry the session
// the notification was posted for. This never goes through
// showSystemNotification (§5.5), which stays action-free.
class LinuxRecordingNotification {
  constructor({ client, ElectronNotification, onStop, onOpen }) {
    this.client = client;
    this.ElectronNotification = ElectronNotification;
    this.onStop = onStop;
    this.onOpen = onOpen;
    this.generation = 0;
    this.current = null; // { id, sessionId, withStop, title, fallbackBody }
    this.fallback = null; // { notification, sessionId }
    this.queue = Promise.resolve();
    this.serviceAlive = Boolean(client);
    if (client) {
      client.onAction((id, key) => {
        const current = this.current;
        if (!current || id !== current.id) return; // another app's, or a replaced or closed one
        if (key === "stop" && current.withStop) this.onStop?.(current.sessionId);
        else if (key === "default") this.onOpen?.(current.sessionId);
      });
      client.onClosed((id) => {
        if (this.current?.id === id) this.current = null; // dismissed by the user; the tray and the pill still stop it
      });
      client.onDisconnect(() => {
        if (!this.serviceAlive) return;
        this.serviceAlive = false;
        const lost = this.current;
        this.current = null;
        if (!lost) return;
        // The server's copy can no longer reach us. Keep a notification on
        // screen for the same session, unless a newer show() or close() came.
        const generation = this.generation;
        void this._enqueue(async () => {
          if (generation === this.generation) this._postFallback(lost);
        });
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
      if (this.serviceAlive) {
        const posted = await this._postToService({ sessionId, title, body, stopLabel, fallbackBody });
        if (generation !== this.generation) {
          if (posted) await this.client.close(posted.id).catch(() => {}); // obsolete before it was posted
          return;
        }
        if (posted) {
          this.current = posted;
          return;
        }
      }
      this._postFallback({ sessionId, title, fallbackBody });
    });
  }

  // The posted notification, or null when the service did not take it.
  async _postToService({ sessionId, title, body, stopLabel, fallbackBody }) {
    let caps;
    try {
      caps = await this.client.capabilities();
    } catch {
      return null; // the service went away during discovery
    }
    const withStop = Array.isArray(caps) && caps.includes("actions");
    try {
      const id = await this.client.notify({
        title,
        body: withStop ? body : fallbackBody,
        // "default" is the click. A server without `actions` may ignore it.
        actions: withStop ? ["default", "", "stop", stopLabel] : ["default", ""],
        hints: { resident: true, urgency: 1, category: "device" },
      });
      return Number.isInteger(id) && id > 0 ? { id, sessionId, withStop, title, fallbackBody } : null;
    } catch {
      return null; // Notify rejected or timed out after discovery (R1-I8)
    }
  }

  _postFallback({ sessionId, title, fallbackBody }) {
    try {
      const notification = new this.ElectronNotification({ title, body: fallbackBody, timeoutType: "never", silent: true });
      notification.on("click", () => this.onOpen?.(sessionId));
      notification.on("close", () => {
        if (this.fallback?.notification === notification) this.fallback = null;
      });
      notification.show();
      this.fallback = { notification, sessionId };
    } catch {
      // Nothing else can post here. The tray's Stop is always there.
    }
  }

  close() {
    ++this.generation;
    return this._enqueue(() => this._closeNow());
  }

  async _closeNow() {
    const current = this.current;
    this.current = null;
    if (current && this.serviceAlive) await this.client.close(current.id).catch(() => {});
    const fallback = this.fallback;
    this.fallback = null;
    fallback?.notification.close();
  }
}

module.exports = { LinuxRecordingNotification };
```

`close()` bumps the generation before queueing. An in-flight `show()` therefore sees the mismatch when its Notify answer arrives, and closes the late id. That is the probe the review reproduced. The same check runs after a rejected Notify, so a meeting that already ended gets no fallback either.

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
// dbus-native may never answer a call on a connection that died. A bounded
// wait lets the notification post its fallback instead of hanging its queue.
const CALL_TIMEOUT_MS = 5000;

async function createFreedesktopClient({ getDBus: loadDBus = getDBus } = {}) {
  const dbus = loadDBus();
  if (!dbus) return null;
  let bus;
  try {
    bus = dbus.sessionBus();
  } catch {
    return null;
  }
  const iface = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), CALL_TIMEOUT_MS);
    try {
      bus.getService(NAME).getInterface(PATH, NAME, (err, value) => {
        clearTimeout(timer);
        resolve(err ? null : value);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
  if (!iface) return null;
  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), CALL_TIMEOUT_MS);
      try {
        iface[method](...args, (err, value) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve(value);
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
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

The hint encoding (`[key, [signature, value]]`) and the signal subscription (`iface.on`) follow the forms the existing D-Bus users in this repo already use. Before relying on them, check `src/helpers/gnomeShortcut.js:211-219` and `kdeShortcut.js` for the exact call shapes, and match them. The adapter is not unit-tested, because it needs a session bus. Task 20's Linux matrix exercises it on a real desktop: with and without `actions`, with the service stopped (`Notify` failing), and whether the click reaches the pill.

- [ ] **Step 5: The meeting outcome in the store**

In `src/stores/meetingRecordingStore.ts`:
1. Extend `StopRecordingResult` (1495–1501) with `persisted: boolean; stopError: boolean;`. Early-return paths report `persisted: false, stopError: false`. Import `type MeetingOutcome` from `../types/dictation` (Task 7).
2. Inside `runStop`, replace lines 1546–1613 (from the `// Persist here` comment to the final `return`) with the code below. "Saved" comes from the acknowledged results, never from the absence of a throw (R1-I14):
   - The write counts only when `updateNote` returns `{ success: true }`. `{ success: false }`, no result, no API and a throw are failures.
   - The stop counts only when `meetingTranscriptionStop` returns `{ success: true }`. `{ success: false, reason: "stale-session" }`, `{ success: false, error }`, no result, no API and a throw are failures.
   - No content means no write was required: a segment-less recording with no fallback transcript never calls `persist`, so it is saved. Content with no note to write to is a failed save, because that content is kept nowhere.

   ```ts
       // Persist here, not in a notes-view effect: an auto-end stop can fire while
       // that view is unmounted, and any view-scoped saver dies with it. (Delayed
       // diarization results are persisted by the module-level listener below.)
       const {
         recordingNoteId,
         segments: finalSegments,
         recordingStartedAt,
       } = useMeetingRecordingStore.getState();
       // R1-I14: "saved" needs acknowledgements. updateNote answers
       // { success: false } without throwing (database.js:1194, :1231, :1239), and
       // main's stop answers { success: false, reason: "stale-session" }
       // (meetingTranscriptionLifecycle.js:39-43). A missing API or result is no
       // acknowledgement either.
       let writeRequired = false; // persist() runs only when there is content
       let writeAcknowledged = false;
       let stopAcknowledged = false;
       const persistTranscript = async (transcript: string) => {
         writeRequired = true;
         if (recordingNoteId == null) {
           logger.error("Meeting transcript has no note to write to", {}, "meeting");
           return;
         }
         try {
           const result = await window.electronAPI?.updateNote?.(recordingNoteId, { transcript });
           writeAcknowledged = result?.success === true;
           if (!writeAcknowledged) {
             logger.error(
               "Failed to persist final meeting transcript",
               { error: result?.error ?? "no acknowledgement", noteId: recordingNoteId },
               "meeting"
             );
           }
         } catch (err) {
           logger.error(
             "Failed to persist final meeting transcript",
             { error: (err as Error).message, noteId: recordingNoteId },
             "meeting"
           );
         }
       };
       const persisted = () => !writeRequired || writeAcknowledged;

       let diarizationSessionId: string | null = null;
       try {
         diarizationSessionId = await persistFinalTranscriptAroundStop({
           segments: finalSegments,
           serializeSegments: serializeTranscriptSegments,
           persist: persistTranscript,
           fallbackTranscript: () => useMeetingRecordingStore.getState().transcript,
           stop: async () => {
             await cleanup();

             let stoppedDiarizationSessionId: string | null = null;
             try {
               const result = await window.electronAPI?.meetingTranscriptionStop?.(
                 sessionId ?? undefined
               );
               stopAcknowledged = result?.success === true;
               if (result?.diarizationSessionId) {
                 stoppedDiarizationSessionId = result.diarizationSessionId;
                 useMeetingRecordingStore.setState({
                   diarizationSessionId: stoppedDiarizationSessionId,
                 });
               }
               if (result?.success && result.transcript) {
                 useMeetingRecordingStore.setState({ transcript: result.transcript });
               } else if (result?.error) {
                 reportMeetingError(result.error);
               } else if (!stopAcknowledged) {
                 logger.error(
                   "Meeting transcription stop was not acknowledged",
                   { reason: result?.reason ?? "no result" },
                   "meeting"
                 );
               }
             } catch (err) {
               reportMeetingError((err as Error).message);
               logger.error(
                 "Meeting transcription stop failed",
                 { error: (err as Error).message },
                 "meeting"
               );
             }
             return stoppedDiarizationSessionId;
           },
         });
       } finally {
         // Once per real stop (runStop dedupes), and also when the stop threw.
         if (sessionId) {
           const outcome: MeetingOutcome =
             persisted() && stopAcknowledged
               ? {
                   sessionId,
                   kind: "saved",
                   durationMs: recordingStartedAt ? Date.now() - recordingStartedAt : 0,
                   noteId: recordingNoteId == null ? null : String(recordingNoteId),
                 }
               : { sessionId, kind: "failed", reason: persisted() ? "stop" : "save" };
           window.electronAPI?.reportMeetingRecordingOutcome?.(outcome);
         }
       }

       useMeetingRecordingStore.setState({
         micPartial: "",
         systemPartial: "",
         systemPartialSpeakerId: null,
         systemPartialSpeakerName: null,
         systemAudioSilentWarning: false,
         systemAudioInterrupted: null,
         currentMicLevel: 0,
         recordingStartedAt: null,
       });

       logger.info("Meeting transcription stopped", {}, "meeting");
       // Reaching here means this call ended a live recording. persisted and
       // stopError say whether the write and main's stop were acknowledged; the
       // outcome above already told main which it was.
       return { diarizationSessionId, stopped: true, persisted: persisted(), stopError: !stopAcknowledged };
   ```

   When the write and the stop both fail, the outcome reason is `save`: unsaved content matters more than a stop error. `MeetingOutcome.noteId` is a string (Task 7) and `recordingNoteId` is a number, hence the `String(...)`.

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

     // Session-bound: a Stop from a stale tray item or notification, or for a
     // session that already ended, does nothing.
     requestStopMeetingRecording(sessionId) {
       if (!sessionId || this.meetingPresence.get()?.sessionId !== sessionId) return false;
       this.sendToControlPanel("meeting-recording-stop-requested", sessionId);
       return true;
     }

     // D2: clicking the Linux recording notification brings up the pill with
     // Stop visible. The pill (Task 17) shows the capsule for this session even
     // when the on-screen recorder setting is off or the pill is auto-hidden.
     revealMeetingRecorder(sessionId) {
       if (!sessionId || this.meetingPresence.get()?.sessionId !== sessionId) return false;
       this.showDictationPanel();
       if (this.mainWindow && !this.mainWindow.isDestroyed()) {
         this.mainWindow.webContents.send("meeting-recorder-reveal-requested", sessionId);
       }
       return true;
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

3. **`tray.js`.**
   - Line 1: also take `Notification` from `require("electron")`. Require `createFreedesktopClient`, `LinuxRecordingNotification`, `buildTrayRecordingItems` and `createRecordingTrayIcon` from the new modules.
   - In the constructor, add:

     ```js
         this.meetingPresence = null;
         this.linuxNotificationPromise = null;
         this.baseIcon = null;
         // Seams for tests, which drive the real tray on any host.
         this.platform = process.platform;
         this.createNotificationClient = createFreedesktopClient;
         this.ElectronNotification = null; // null means Electron's Notification
     ```

   - Store the loaded icon in `createTray()` as `this.baseIcon` (after `const trayIcon = await this.loadTrayIcon();`, line 135).
   - Add:

   ```js
     // One instance, created once, even when presence changes before the D-Bus
     // client answers. show() and close() both chain on this promise, so they
     // run in the order presence changed: a meeting that ends while the client
     // is still connecting never leaves its notification behind.
     _linuxNotification() {
       this.linuxNotificationPromise ??= (async () => {
         const client = await this.createNotificationClient().catch(() => null);
         return new LinuxRecordingNotification({
           client,
           ElectronNotification: this.ElectronNotification ?? Notification,
           onStop: (sessionId) => this.windowManager?.requestStopMeetingRecording(sessionId),
           // D2: a click brings up the pill with Stop visible, for that session.
           onOpen: (sessionId) => this.windowManager?.revealMeetingRecorder(sessionId),
         });
       })();
       return this.linuxNotificationPromise;
     }

     setMeetingPresence(presence) {
       const previous = this.meetingPresence;
       this.meetingPresence = presence;
       if (this.platform === "linux") {
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
           void this._linuxNotification().then((n) => n.close());
         }
       }
       this.updateTrayMenu();
     }

     teardownMeetingNotification() {
       return this.linuxNotificationPromise?.then((n) => n.close()) ?? Promise.resolve();
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
   - the four `on…` listeners use `registerListener` (`preload.js:47`). `onMeetingRecorderRevealRequested` listens on `meeting-recorder-reveal-requested`.

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
  "notificationFallbackBody": "Click to show the Loqui pill and stop it there, or use the tray menu.",
  "stop": "Stop"
}
```

The notification makes no claim about where meeting audio goes, because the meeting transcription route can be remote. Locality is disclosed where the route is shown.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- test/helpers/meetingPresence.test.js test/helpers/linuxRecordingNotification.test.js test/helpers/meetingStopOutcome.test.js test/helpers/windowManagerMeetingNotification.test.js test/helpers/trayQuickActions.test.js test/helpers/trayActionPolicy.test.js "test/helpers/meeting*.test.js"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/helpers/meetingPresence.js src/helpers/linuxRecordingNotification.js src/helpers/freedesktopNotifications.js src/helpers/trayRecordingIcon.js src/stores/meetingRecordingStore.ts src/helpers/windowManager.js src/helpers/ipcHandlers.js src/helpers/tray.js main.js preload.js src/types/electron.ts src/preview/browserPreview.ts src/components/MeetingRecordingMount.tsx src/locales test
git commit -m "feat(meeting): presence, explicit outcome, tray state and a serialised Linux Stop notification"
```

---

### Task 17: The recorder capsule as a pill state (VO-R12 A per D2)

**Files:**
- Create: `src/hooks/useMeetingRecordingPresence.ts`. It also tracks a reveal request from the Linux notification (Task 16, D2 clarification).
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
  // D2 (7f31ece): a click on the Linux recording notification asks for the pill with Stop.
  export function useMeetingRecorderRevealed(presence: MeetingPresence | null): boolean;
  export function isMeetingRecorderRevealed(revealedSessionId: string | null, presence: MeetingPresence | null): boolean;
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

test("a notification click reveals the capsule for that session only, while it records (D2)", async () => {
  const { isMeetingRecorderRevealed } = await import("../../src/hooks/useMeetingRecordingPresence.ts");
  const m1 = { sessionId: "m1", startedAt: 1, interruption: null, quiet: false };
  assert.equal(isMeetingRecorderRevealed("m1", m1), true);
  assert.equal(isMeetingRecorderRevealed("m0", m1), false, "a stale click for an ended session");
  assert.equal(isMeetingRecorderRevealed("m1", null), false, "presence ended");
  assert.equal(isMeetingRecorderRevealed(null, m1), false);
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

export function isMeetingRecorderRevealed(revealedSessionId: string | null, presence: MeetingPresence | null): boolean {
  return Boolean(presence && revealedSessionId && presence.sessionId === revealedSessionId);
}

/** True after a Linux notification click for this session (Task 16), until its presence ends. */
export function useMeetingRecorderRevealed(presence: MeetingPresence | null): boolean {
  const [revealedSessionId, setRevealedSessionId] = useState<string | null>(null);
  useEffect(() => window.electronAPI?.onMeetingRecorderRevealRequested?.((sessionId) => setRevealedSessionId(sessionId)), []);
  useEffect(() => {
    if (!presence) setRevealedSessionId(null);
  }, [presence]);
  return isMeetingRecorderRevealed(revealedSessionId, presence);
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
    const showMeetingRecorderSetting = useSettingsStore((s) => s.showMeetingRecorderOnScreen);
    // D2 (7f31ece): a click on the Linux notification brings up the pill with Stop, even
    // with the setting off, for as long as that session records.
    const meetingRecorderRevealed = useMeetingRecorderRevealed(meetingRecording);
    const showMeetingRecorder = showMeetingRecorderSetting || meetingRecorderRevealed;
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

Closes round 2's R1-I7 and R2-I2 for the prompt.

The prompt now awaits two things before its window exists: the active display and the ⌥⌘M lease. Each prompt therefore gets a **generation** before its first await, and its own lease owner, `main:meeting-prompt:<generation>`:
- Replacing, dismissing or tearing down a prompt bumps the generation and releases that prompt's owner.
- After every await, a prompt that is no longer current returns without creating or overwriting anything. It releases only its own lease, never the current one.
- The lease lives as long as the prompt's window. It is released when the window closes (including a compositor kill, which bypasses `dismissMeetingNotification`), when its renderer goes away, when it navigates, and at quit.

**Files:**
- Modify: `src/helpers/windowConfig.js`. Add `static getNotchDropPosition(display)` to `WindowPositionUtil` next to `getNotificationPosition` (lines 328–341).
- Modify: `src/helpers/windowManager.js`:
  - constructor (48–108): the prompt generation, and a prompt dismissal in the `before-quit` handler (104–107);
  - `showMeetingNotification` (2030–2125): take a generation before the first await, use the active display, lease ⌥⌘M for this prompt, check the generation after every await, bind the lease to the window, and send the hotkey label;
  - `dismissMeetingNotification` (2144–2160): end the prompt, which releases its lease, even before its window exists.
- Modify: `src/helpers/meetingDetectionEngine.js:421-428`. Add `appName` to the prompt payload.
- Modify: `src/types/electron.ts:66-73`. Add `appName?: string | null; acceptHotkeyLabel?: string | null` to `MeetingNotificationData`.
- Modify: `src/components/meetingNotificationModel.ts`
- Modify: `src/components/MeetingNotificationCard.tsx`
- Modify: `src/components/MeetingNotificationOverlay.tsx`
- Modify: `src/index.css` or `src/styles/notices.css`. Add the `.meeting-drop` rules to `notices.css`.
- Modify: `src/locales/*/translation.json` (`meetingNotification.*`)
- Test: `test/components/meetingPrompt.test.js`
- Test: modify `test/helpers/windowManagerMeetingNotification.test.js`. Lease lifetime and stale prompts, through the real window manager and Task 2's real lease module.

**Interfaces:**
- Consumes Task 2's `hotkeyLeases` (`acquire`, `release`, `releaseOwner`). The owner is `main:meeting-prompt:<generation>`, not one fixed string.
- Produces:

  ```js
  WindowPositionUtil.getNotchDropPosition(display): { x: number; y: number; width: 392; height: 92 } // top-centre of the work area, 8px below the menu bar
  // windowManager (main only)
  _beginMeetingPrompt(detectionId): { generation: number; detectionId: string | null; ownerId: string }; // ends any earlier prompt
  _endMeetingPrompt(): { generation; detectionId; ownerId } | null; // bumps the generation, releases that prompt's lease
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
  assert.doesNotMatch(block, /registerSlot\(/, "temporary shortcuts go through main's leases (I7)");
});
```

The lease's lifetime and stale prompts are tested by behaviour, in the real window-manager suite. Task 16 already added `settle`, `until` and the `TrayManager` require to `test/helpers/windowManagerMeetingNotification.test.js`. Change that file as follows.

1. **Stubs.** The window manager now awaits the display and a real lease (Task 2's `createHotkeyLeases`, built in the constructor) before it creates the window:
   - `FakeBrowserWindow` (lines 19–63): make `webContents` an emitter, so tests can raise `render-process-gone` and `did-start-navigation`:

     ```js
         this.webContents = Object.assign(new EventEmitter(), {
           send: (channel, payload) => this.messages.push({ channel, payload }),
         });
     ```

   - Replace the `FakeHotkeyManager` class (lines 65–71); keep line 72. It records registrations, and can hold each one until the test answers (the KDE/GNOME await):

     ```js
     class FakeHotkeyManager {
       constructor() {
         this.registered = new Map();
         this.pendingRegistrations = [];
         this.registerCalls = 0;
         this.deferRegistrations = false;
       }

       registerSlot(slot, _accelerator, callback) {
         this.registerCalls += 1;
         const answer = (ok = true) => {
           if (ok) this.registered.set(slot, callback);
           return ok ? { success: true } : { success: false, reason: "conflict" };
         };
         if (!this.deferRegistrations) return Promise.resolve(answer());
         return new Promise((resolve) => this.pendingRegistrations.push((ok) => resolve(answer(ok))));
       }

       unregisterSlot(slot) {
         this.registered.delete(slot);
       }

       unregisterAll() {
         this.registered.clear();
       }

       isInListeningMode() {
         return false;
       }
     }
     ```

   - In the `electron` stub (lines 80–88), record `app` listeners and add the display lookups `_resolveActiveDisplay` uses (`windowManager.js:1469-1481`):

     ```js
     const appListeners = {};
     // …in the electron stub:
           app: { on: (event, listener) => (appListeners[event] ??= []).push(listener) },
           screen: {
             getPrimaryDisplay: () => ({}),
             getCursorScreenPoint: () => ({ x: 0, y: 0 }),
             getDisplayNearestPoint: () => ({ id: "cursor", workArea: { x: 0, y: 0, width: 1000, height: 800 } }),
             getDisplayMatching: () => ({ id: "target", workArea: { x: 0, y: 0, width: 1000, height: 800 } }),
             on: () => undefined,
           },
     ```

   - In the `./windowConfig` stub (lines 110–126), add `getNotchDropPosition: () => ({ ...notificationSize, x: 304, y: 8 })` to `WindowPositionUtil`.
   - Next to `notificationWindowFor` (line 133), add:

     ```js
     const ACCEPT_LABEL = process.platform === "darwin" ? "⌥⌘M" : "Ctrl+Alt+M";
     // The window now appears after the display and lease awaits.
     async function windowCreated(index) {
       await until(() => createdWindows.length > index);
       return createdWindows[index];
     }
     ```

2. **Existing tests that read a window synchronously.** Each reads `createdWindows[n]` or `notificationWindowFor(n)` straight after `showMeetingNotification(...)`. Replace each read with `await windowCreated(n)`:
   - "window creation uses the notification dimensions and position" (line 363). Its expected position becomes `x: 304, y: 8`. Its payload assertion becomes `assert.deepEqual(manager._pendingNotificationData, { ...notification, acceptHotkeyLabel: ACCEPT_LABEL });`.
   - "a replaced deferred notification…" (lines 395 and 400). Await the first window before calling the second `showMeetingNotification`, so the replacement still happens mid-load.
   - "canceling during a deferred load…" (line 426), "canceling while waiting for the dev server…" (line 456), "a stale ready callback…" (lines 479 and 487), "a notification raised from the timeout handler…" (lines 524, 528, 532 and 533; await `windowCreated(1)` after `timers.runDelay`), "an expired detection…" (line 577) and "a detection card whose load fails…" (line 601).

3. **Extend the replacement test** ("a replaced deferred notification cannot send its payload to the newer window", lines 385–414). Give it an engine, and before `timers.runAll()` assert that only the newer prompt holds the shortcut. The assertions must come before `runAll()`, because the lease TTL timer is one of the fake timers:

   ```js
     const responses = [];
     manager.meetingDetectionEngine = {
       handleNotificationResponse: (detectionId, action) => responses.push([detectionId, action]),
       handleDetectionNotificationClosed: () => undefined,
     };
     // …after `await firstShowPromise;`, before `timers.runAll();`:
     await settle();
     // R1-I7: the replaced prompt's lease went with it; the newer prompt holds the shortcut.
     assert.equal(manager.hotkeyManager.registered.has("temp:meetingAccept"), true);
     manager.hotkeyManager.registered.get("temp:meetingAccept")();
     assert.deepEqual(responses, [["second", "start"]]);
   ```

4. **Replace the unexpected-close test** (lines 540–559) with the same scenario plus deferred acquisition and lease cleanup:

```js
test("unexpected detection card closure releases that detection and its shortcut (R1-I7)", async () => {
  const manager = createNormalWindowManager();
  const hotkeys = manager.hotkeyManager;
  hotkeys.deferRegistrations = true;
  const closedDetections = [];
  manager.meetingDetectionEngine = {
    handleDetectionNotificationClosed: (detectionId) => closedDetections.push(detectionId),
  };

  const showPromise = manager.showMeetingNotification({
    detectionId: "audio:sustained-audio",
    source: "audio",
  });
  await until(() => hotkeys.pendingRegistrations.length === 1);
  assert.equal(createdWindows.length, 0, "no window before the shortcut answers");
  hotkeys.pendingRegistrations.shift()(true);
  const notificationWindow = await windowCreated(0);
  notificationWindow.loadDeferred.resolve();
  await showPromise;
  assert.equal(hotkeys.registered.has("temp:meetingAccept"), true);
  assert.equal(manager._pendingNotificationData.acceptHotkeyLabel, ACCEPT_LABEL);

  // A compositor window kill never reaches the renderer's response IPC, and
  // never calls dismissMeetingNotification.
  notificationWindow.close();
  await settle();

  assert.deepEqual(closedDetections, ["audio:sustained-audio"]);
  assert.equal(hotkeys.registered.has("temp:meetingAccept"), false, "the shortcut went with the window");
  assert.equal(manager._meetingPrompt, null);
});
```

5. **In "a detection card whose load fails…"**, after the `closedDetections` assertion, add `await settle();` and `assert.equal(manager.hotkeyManager.registered.has("temp:meetingAccept"), false);`.

6. **Append these tests:**

```js
test("a crash or a navigation in the prompt's renderer releases its shortcut and closes it (R1-I7)", async () => {
  const losses = [
    ["crash", (win) => win.webContents.emit("render-process-gone", {}, { reason: "crashed" })],
    ["navigation", (win) => win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false, url: "file:///elsewhere" })],
  ];
  for (const [label, lose] of losses) {
    createdWindows.length = 0;
    const manager = createNormalWindowManager();
    const closedDetections = [];
    manager.meetingDetectionEngine = {
      handleDetectionNotificationClosed: (detectionId) => closedDetections.push(detectionId),
    };
    const showPromise = manager.showMeetingNotification({ detectionId: `audio:${label}`, source: "audio" });
    const win = await windowCreated(0);
    win.loadDeferred.resolve();
    await showPromise;

    win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true, url: "file:///app#x" });
    assert.equal(manager.notificationWindow, win, `${label}: a same-document navigation is not a loss`);

    lose(win);
    await settle();
    assert.equal(manager.hotkeyManager.registered.has("temp:meetingAccept"), false, label);
    assert.equal(manager.notificationWindow, null, label);
    assert.equal(win.isDestroyed(), true, label);
    assert.deepEqual(closedDetections, [`audio:${label}`], label);
  }
});

test("a prompt dismissed while its display resolves never appears or registers (R2-I2)", async () => {
  const manager = createNormalWindowManager();
  const bounds = createDeferred();
  manager.textEditMonitor = { lastTargetPid: 42, getTargetWindowBounds: () => bounds.promise };
  const closedDetections = [];
  manager.meetingDetectionEngine = {
    handleDetectionNotificationClosed: (detectionId) => closedDetections.push(detectionId),
  };

  const showPromise = manager.showMeetingNotification({ detectionId: "audio:a", source: "audio" });
  manager.dismissMeetingNotification();
  bounds.resolve({ x: 0, y: 0, width: 10, height: 10 });

  assert.equal(await showPromise, false);
  assert.equal(createdWindows.length, 0);
  assert.equal(manager.hotkeyManager.registerCalls, 0);
  assert.deepEqual(closedDetections, ["audio:a"], "the engine learns this prompt will not show");
});

test("a prompt dismissed while its shortcut registers never appears, and the late registration is undone (R2-I2)", async () => {
  const manager = createNormalWindowManager();
  const hotkeys = manager.hotkeyManager;
  hotkeys.deferRegistrations = true;

  const showPromise = manager.showMeetingNotification({ detectionId: "audio:a", source: "audio" });
  await until(() => hotkeys.pendingRegistrations.length === 1);
  manager.dismissMeetingNotification();
  hotkeys.pendingRegistrations.shift()(true); // the backend answers after the dismissal

  assert.equal(await showPromise, false);
  await settle();
  assert.equal(createdWindows.length, 0);
  assert.equal(hotkeys.registered.has("temp:meetingAccept"), false);
});

test("an older prompt whose display resolves last never replaces the newer prompt (R2-I2)", async () => {
  const manager = createNormalWindowManager();
  const lookups = [createDeferred(), createDeferred()];
  let lookup = 0;
  manager.textEditMonitor = { lastTargetPid: 42, getTargetWindowBounds: () => lookups[lookup++].promise };
  const responses = [];
  manager.meetingDetectionEngine = {
    handleNotificationResponse: (detectionId, action) => responses.push([detectionId, action]),
    handleDetectionNotificationClosed: () => undefined,
  };

  try {
    const older = manager.showMeetingNotification({ detectionId: "older" }, { autoDismiss: false });
    const newer = manager.showMeetingNotification({ detectionId: "newer" }, { autoDismiss: false });
    lookups[1].resolve({ x: 0, y: 0, width: 10, height: 10 });
    const newerWindow = await windowCreated(0);
    lookups[0].resolve({ x: 0, y: 0, width: 10, height: 10 }); // the older lookup lands last

    assert.equal(await older, false);
    newerWindow.loadDeferred.resolve();
    assert.equal(await newer, true);
    assert.equal(createdWindows.length, 1);
    assert.equal(manager.notificationWindow, newerWindow);
    assert.equal(manager._pendingNotificationData.detectionId, "newer");
    manager.hotkeyManager.registered.get("temp:meetingAccept")();
    assert.deepEqual(responses, [["newer", "start"]]);
  } finally {
    manager.dismissMeetingNotification();
  }
});

test("an older prompt's late shortcut answer never takes the newer prompt's lease (R2-I2)", async () => {
  const manager = createNormalWindowManager();
  const hotkeys = manager.hotkeyManager;
  hotkeys.deferRegistrations = true;
  const responses = [];
  manager.meetingDetectionEngine = {
    handleNotificationResponse: (detectionId, action) => responses.push([detectionId, action]),
    handleDetectionNotificationClosed: () => undefined,
  };

  try {
    const older = manager.showMeetingNotification({ detectionId: "older" }, { autoDismiss: false });
    await until(() => hotkeys.pendingRegistrations.length === 1); // older is registering
    const newer = manager.showMeetingNotification({ detectionId: "newer" }, { autoDismiss: false });
    hotkeys.pendingRegistrations.shift()(true); // older's answer arrives after it was replaced
    assert.equal(await older, false);

    await until(() => hotkeys.pendingRegistrations.length === 1); // newer registers after older's slot work
    hotkeys.pendingRegistrations.shift()(true);
    const newerWindow = await windowCreated(0);
    newerWindow.loadDeferred.resolve();
    assert.equal(await newer, true);

    assert.equal(createdWindows.length, 1);
    assert.equal(manager._pendingNotificationData.acceptHotkeyLabel, ACCEPT_LABEL);
    hotkeys.registered.get("temp:meetingAccept")();
    assert.deepEqual(responses, [["newer", "start"]]);
  } finally {
    manager.dismissMeetingNotification();
  }
});

test("quitting while a prompt is still being prepared shows nothing and leaves no shortcut (R1-I7)", async () => {
  const manager = createNormalWindowManager();
  const hotkeys = manager.hotkeyManager;
  hotkeys.deferRegistrations = true;

  const showPromise = manager.showMeetingNotification({ detectionId: "audio:q", source: "audio" });
  await until(() => hotkeys.pendingRegistrations.length === 1);
  appListeners["before-quit"].at(-1)(); // this manager's handler; each constructor adds one
  hotkeys.pendingRegistrations.shift()(true);

  assert.equal(await showPromise, false);
  await settle();
  assert.equal(createdWindows.length, 0);
  assert.equal(hotkeys.registered.has("temp:meetingAccept"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/meetingPrompt.test.js test/helpers/windowManagerMeetingNotification.test.js`
Expected: FAIL. `bodyKey` is `meetingNotification.body.detected` for Zoom, and `acceptHotkeyLabel` is not exported. In the window-manager suite, the position is still `x: 608, y: 16`, nothing registers `temp:meetingAccept`, and the stale-prompt tests create windows they must not.

- [ ] **Step 3: Implement**

1. **`windowConfig.js`.** `WindowPositionUtil` is a class of static methods. Add this next to `static getNotificationPosition` (line 328):

   ```js
     // VO-R11 B: the prompt drops from the menu-bar edge, centred, on the
     // display the user is working on.
     static getNotchDropPosition(display) {
       const { x, y, width } = display.workArea;
       const w = NOTIFICATION_WINDOW_CONFIG.width;
       const h = NOTIFICATION_WINDOW_CONFIG.height;
       return { x: Math.round(x + (width - w) / 2), y: y + 8, width: w, height: h };
     }
   ```

   `NOTIFICATION_WINDOW_CONFIG` is declared above the class (line 266).
2. **`windowManager.js`.** Task 2 already builds `this.hotkeyLeases` in the constructor.
   - **Constructor.** After `this._pendingNoteNavigation = null;` (line 102), add:

     ```js
         // R1-I7/R2-I2: the meeting prompt being prepared or shown. Each prompt
         // has its own generation and its own lease owner.
         this._meetingPrompt = null;
         this._meetingPromptGeneration = 0;
     ```

     In the `before-quit` handler (lines 104–107), before `this.hotkeyManager.unregisterAll();`, add `this.dismissMeetingNotification({ notifyEngine: false });`. A prompt still resolving its display or its shortcut must not appear or register during quit.
   - **Add two methods** before `showMeetingNotification`:

     ```js
       // R1-I7/R2-I2: a prompt takes its generation before its first await.
       // Ending it (replacement, dismissal, its window going, quit) bumps the
       // generation, so a call that wakes after that stops. The lease owner is
       // unique to the prompt, so releasing it never touches a newer prompt's
       // shortcut.
       _beginMeetingPrompt(detectionId) {
         this._endMeetingPrompt();
         const generation = ++this._meetingPromptGeneration;
         this._meetingPrompt = {
           generation,
           detectionId: detectionId ?? null,
           ownerId: `main:meeting-prompt:${generation}`,
         };
         return this._meetingPrompt;
       }

       _endMeetingPrompt() {
         const prompt = this._meetingPrompt;
         this._meetingPrompt = null;
         this._meetingPromptGeneration += 1;
         // releaseOwner also ends a lease whose registration is still pending;
         // the lease module undoes its late success (Task 2).
         if (prompt) this.hotkeyLeases.releaseOwner(prompt.ownerId);
         return prompt;
       }
     ```

   - **`showMeetingNotification` (2030–2125).** It is already `async`. Replace lines 2030–2080 (from the signature through `this._pendingNotificationData = promptData;`) with:

     ```js
       async showMeetingNotification(promptData, { autoDismiss = true } = {}) {
         if (this._onboardingActive) return false;
         // Before the first await (R2-I2). This also ends the previous prompt,
         // which releases its shortcut.
         const prompt = this._beginMeetingPrompt(promptData?.detectionId);
         const isCurrent = () => this._meetingPrompt?.generation === prompt.generation;
         if (this.notificationWindow && !this.notificationWindow.isDestroyed()) {
           const previousWindow = this.notificationWindow;
           this.notificationWindow = null;
           this._pendingNotificationData = null;
           previousWindow.close();
         }
         this._notificationDismissTimer.cancel();
         if (this._notificationReadyFallback) {
           clearTimeout(this._notificationReadyFallback);
           this._notificationReadyFallback = null;
         }

         // VO-Q10: the display the user is working on, not the primary one.
         let display;
         try {
           display = await this._resolveActiveDisplay();
         } catch {
           display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
         }
         if (!isCurrent()) return false;
         const position = WindowPositionUtil.getNotchDropPosition(display);

         // I7: the accept shortcut is leased to this prompt only.
         const lease = await this.hotkeyLeases.acquire({
           slot: "meetingAccept",
           ownerId: prompt.ownerId,
           onPress: () => {
             if (!isCurrent()) return;
             void this.meetingDetectionEngine?.handleNotificationResponse?.(prompt.detectionId, "start");
           },
         });
         if (!isCurrent()) {
           // Replaced or dismissed while the shortcut registered. Ending the
           // prompt already released this owner. Releasing by this lease id and
           // owner again cannot touch the current prompt's lease.
           this.hotkeyLeases.release(lease.leaseId, prompt.ownerId);
           return false;
         }
         const data = {
           ...promptData,
           // Shown only when main actually holds the shortcut (another app may own it).
           acceptHotkeyLabel: lease.held ? (process.platform === "darwin" ? "⌥⌘M" : "Ctrl+Alt+M") : null,
         };

         const win = new BrowserWindow({
           ...NOTIFICATION_WINDOW_CONFIG,
           ...position,
         });
         this.notificationWindow = win;

         // "closed" fires asynchronously, so a replaced prompt's window emits it
         // after the replacement already took over the reference and the countdown.
         win.on("closed", () => {
           // R1-I7: the shortcut goes with this prompt's window, however the
           // window went (compositor kill, crash, replacement, dismissal).
           this.hotkeyLeases.releaseOwner(prompt.ownerId);
           if (this.notificationWindow !== win) return;
           if (isCurrent()) this._endMeetingPrompt();
           const closedDetectionId = this._pendingNotificationData?.detectionId ?? null;
           this.notificationWindow = null;
           this._pendingNotificationData = null;
           this._notificationDismissTimer.cancel();
           if (this._notificationReadyFallback) {
             clearTimeout(this._notificationReadyFallback);
             this._notificationReadyFallback = null;
           }
           if (closedDetectionId) {
             this.meetingDetectionEngine?.handleDetectionNotificationClosed?.(closedDetectionId);
           }
         });

         // Renderer loss ends the prompt and its shortcut too. Navigation is
         // watched after the load below, because the load is itself a navigation.
         const promptLost = () => {
           this.hotkeyLeases.releaseOwner(prompt.ownerId);
           if (this.notificationWindow === win) this.dismissMeetingNotification();
         };
         win.webContents.on("render-process-gone", promptLost);

         win.setContentProtection(true);

         if (process.platform === "darwin") {
           win.setIgnoreMouseEvents(true, { forward: true });
         }

         // Notifications must clear every other window, including our own floating
         // dictation panel and assistant pill.
         WindowPositionUtil.setupAlwaysOnTop(win, { level: "screen-saver" });

         this._pendingNotificationData = data;
     ```

     The rest of the `closed` handler is today's (lines 2057–2067).
   - After the post-load checks (lines 2103–2107, the `this.notificationWindow !== win` and `_onboardingActive` returns), add:

     ```js
         win.webContents.on("did-start-navigation", (details) => {
           if (details?.isMainFrame && !details.isSameDocument) promptLost();
         });
     ```

     This uses the `details` form, like `meetingTranscriptionLifecycle.js:120-123`.
   - In the ready fallback, send `data` instead of `promptData` (line 2114).
   - **`dismissMeetingNotification` (2144–2160).** Replace its first two lines (2145–2146) with:

     ```js
         // R1-I7/R2-I2: end the prompt first. Its generation is bumped and its
         // shortcut released, even when it has no window yet.
         const prompt = this._endMeetingPrompt();
         const notification =
           this._pendingNotificationData ?? (prompt?.detectionId ? { detectionId: prompt.detectionId } : null);
         this._pendingNotificationData = null;
     ```

     A prompt dismissed before its window exists is reported to the engine like any other card that closed without a response. `handleDetectionNotificationClosed` ignores a detection it no longer holds (`meetingDetectionEngine.js:634-635`).
   - Leases also expire on their own after `LEASE_MAX_TTL_MS.meetingAccept` (120 s), which covers the calendar prompt's 2 min auto-dismiss.
   - Callers of `showMeetingNotification` (`meetingDetectionEngine.js:421`) can stay fire-and-forget. It now resolves `false` for a prompt that was replaced or dismissed before it showed.
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
       animation: notice-fade var(--motion-fast) linear both !important;
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

Run: `npm test -- test/components/meetingPrompt.test.js test/helpers/windowManagerMeetingNotification.test.js test/helpers/hotkeyLeases.test.js test/helpers/windowPositionClamp.test.js test/components/brandGlow.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/windowConfig.js src/helpers/windowManager.js src/helpers/meetingDetectionEngine.js src/types/electron.ts src/components/meetingNotificationModel.ts src/components/MeetingNotificationCard.tsx src/components/MeetingNotificationOverlay.tsx src/styles/notices.css src/preview src/locales DESIGN.md test/components/meetingPrompt.test.js test/helpers/windowManagerMeetingNotification.test.js
git commit -m "feat(meeting): notch-drop prompt on the active display with a prompt-bound accept hotkey"
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
| 12 | Linux only | The tray shows an orange dot and leads with "Recording meeting · m:ss" and Stop. The resident notification's Stop ends that meeting. Stopping from the pill removes the notification. On a desktop whose notification server lacks `actions` (or with the notification service stopped), the persistent notification still shows, without Stop. Record whether clicking it brings up the pill with Stop: the freedesktop spec lets such servers ignore the click (D2 clarification, Task 16). The tray Stop always works. |
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
- None. The spec owner consolidated every CCR into §5 at 091d198. This task only checks that the code matches it.

- [ ] **Step 1: Confirm the spec matches what shipped**

Compare the spec's §5.2, §5.3, §5.4 and §5.7 (consolidated at 091d198, or any later owner revision) with what this branch exports. The spec wins: if a shape differs, change the code to the spec's shape. Then check each item below.

- `src/types/dictation.ts` (CCR-1, CCR-2, CCR-3, CCR-6): `CancelledState`, `RemoteDisclosure`, `UndoResult`, `DictationOutcome`, `MeetingPresence` and `MeetingOutcome`.
- `useAudioRecording` return fields (CCR-3): `cancelled`, `undoCancel`, `pauseUndo`, `resumeUndo`, `processingStage`, `outcome` and `meetingRecording`.
- The onboarding demo statuses and the Undo bridge (CCR-5): `cancelled`, `cancelClosed`, `sendUndoCancelDictation`, `lastCancelledDictation`, and `sanitizeCancelledDemoFields`.
- `notices.ts` (CCR-4): the discriminated `NoticeInput`, `NoticeRemoval`, `revision`, `busy`, `dismissNotice(id, reason)`, and the 7 s receipt-with-action lifetime.
- `dictationDisclosure.js` (CCR-6, §5.4): `dispatchTargetLabel`, `disclosureCopy`, `attachEgressEvidence`, and the `delivered`, `dispatched` and `undelivered` mapping.
- §5.4: Plan 07's pre-flight and `_noteSealedFailure` are still in place, the `sealedPaused` pill state renders, and no renderer module except `sealedStore.ts` calls `privacy.getSealed` or `privacy.onSealedChange`. Check with `rg -n "privacy\.(getSealed|onSealedChange)" src --glob '!src/stores/sealedStore.ts'`, which must print nothing.
- §5.7: `cancelled` reaches the control panel only through `dictation-lifecycle-changed`, and `rg -n "report-cancelled-dictation" src preload.js` prints nothing.

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
| §5.4 Sealed mode: blocked ring; Sealed pre-check on Undo through `sealedStore`; the pre-flight kept, and rendered as the `sealedPaused` pill state; egress phases mapped to evidence | 7, 8, 10, 11 |
| §5.3 Plan 07's recovery notice and held-audio alert | 4, 5 |
| §5.5 resident Linux notification on its own freedesktop path | 16 |
| §5.7 `cancelled` on Plan 06's lifecycle channel | 9 |
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
