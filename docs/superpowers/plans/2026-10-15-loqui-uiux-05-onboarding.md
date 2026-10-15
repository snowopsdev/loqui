# Loqui UI/UX Plan 05 — Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild first-run setup so a new user hears their own words on screen before they make any optional decision, and so every claim setup makes is true. The plan delivers:
- two phases, "Get dictating" (Hello, Voice, Say something) and "Make it yours" (Cleanup, Shortcut), followed by an honest Ready summary;
- the orange rail as the instrument: the five bars of the mark fill with the download, follow the voice, settle into the mark and dock into the header;
- a voice detected from the OS locale and hardware only (D8);
- a background download with real progress, speed, ETA, cancel and kept progress;
- a hotkey-first trial that is private by construction;
- a cleanup choice made by seeing the user's own sentence;
- a live keycap for the shortcut;
- in-app resume;
- a browser preview that simulates every state.

**Architecture:**
- Navigation, detection, trial, download, readiness, cleanup diffs and microphone selection are pure TypeScript modules under `src/utils/onboarding*.ts`.
- React components live under `src/components/onboarding/`. `OnboardingFlow.tsx` becomes an orchestrator, and its final shape is written once in the **OnboardingFlow composition** section at the end.
- The trial and the shortcut tester use the existing onboarding demo bridge, extended. Main forwards real shortcut presses. The overlay window records. While setup is incomplete, its `AudioManager` marks every recording private, and a private recording is never written to history or disk on any path.
- The browser preview fakes the same bridge in `src/preview/onboardingScenarioBridge.ts`, so production components contain no preview branches.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4 tokens (shipped Plan 01), Electron 44 IPC, and Node `node:test` with `tsx`. Component tests use Plan 02's renderer harness (`test/helpers/harness/fakeDomTree.js`, `rendererMocks.js`), extended compatibly in Task 9.

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md` at `7f31ece` on `snowopsdev/feat/uiux-foundations` (contracts consolidated at `091d198`; §5.2 clarified at `ff8c9cd`). The relevant parts are decisions D1, D5 and D8; §3 (execution order); §4; §5.1–§5.3 and §5.7; and the Plan 05 row.
- Visual acceptance comes from `design-explorations/loqui-uiux-review/parts/02-onboarding.html`, using the picked card for each recommendation.
- Supporting evidence is in `.omc/research/ui-review/audit-onboarding.md`. Both live untracked in the sibling worktree `/Users/snow/.t3/worktrees/loqui/t3-5038e8e6/`.

**Upstream interfaces this plan codes against:**

| Plan | Status | What this plan uses |
|---|---|---|
| Plan 01 | Shipped (`d90792f..d5429c9`) | `--motion-*`, `--color-cta*`, `--color-live*`, `--color-nav-marker`, `Button variant="live"`, `LevelBars` (+ `nextLevelBarsFrame`), `LocalityRing`, `src/lib/locality.ts` (`providerDisplayLabel` for UI), `src/utils/contrast.ts`, `test/helpers/harness/cssTokens.js` |
| Plan 02 | Prerequisite (spec §3) | ONB-Q1 (pinned shell, physical 84px traffic-light inset); ONB-Q2 (`useModelDownload` wired into the speech step, `cancelDownload(): Promise<boolean>`, `DownloadProgressBar` with `role="progressbar"`, footer chip); `fakeDomTree.js`; `rendererMocks.js` (`I18N_KEYS_MOCK`, `TOAST_MOCK`, `rendererOptions`) |
| Plan 03 | Prerequisite | `src/lib/routes.ts` (§5.1): `useResolvedRoute`, `ResolvedRoute` (with `providerId`), the `unknown` state (rule 1), self-hosted notes as `unreachable`/`unsupported` (rule 9); route facts that already refresh on `openwhispr-local-models-changed` and `api-key-changed` (`routeFactsStore`); `getTotalMemory` (`get-total-memory`); `SettingsModal` that accepts a `settingsPath` as its section |
| Plan 04 | Parallel; may merge before or after (§3) | §5.2 types (`src/types/dictation.ts`), the Undo bridge (`sendUndoCancelDictation`, `lastCancelledDictation`, `sanitizeCancelledDemoFields`), `disclosureCopy`, and private holds; §5.3 `notify`. Tasks 5 and 7 handle both merge orders, and whichever plan merges second runs Task 22. |

---

## Review response

**PR #45 review:**
- **P1, Ready privacy summary:** Task 18 includes `noteRecordingStt` in `ReadinessInput` and `allLocal`; the composition passes the actual note route. Tests cover device, remote, network and unknown note locality, and the remote-note subtitle cannot claim everything runs on device.
- **P2, detected-language fallback:** Task 3's `VoicePick.languages` contains only languages heard by the detected model. The `he-IL` / `fr-FR` regression retains French, remains compatible, and Task 13's flow test commits only `fr-FR` without manual changes.

**Round 2** is Codex `gpt-6.1-sol` at xhigh: `.omc/research/ui-review/reviews/plan-05-codex.md`, with 1 Critical, 14 Important and 5 Minor findings. All 20 are closed, and two are closed differently from the review's first suggestion.

| ID | Finding | Status | Where |
|---|---|---|---|
| C01 | Cancelled private trial can save audio | **Closed.** `AudioManager` captures a per-recording `private` flag at every recording start. The flag travels in the discarded snapshot, the processed blob and Plan 04's hold (§5.2 private holds). All four writers refuse private recordings. Tests use the real `AudioManager` with retention on. | Task 5 |
| I01 | Hello leaks a late microphone; retry cannot reopen | **Closed.** A late stream is stopped in the cancelled branch, and setup failures dispose resources. An explicit `retryKey` reopens. Tests cover deferred `getUserMedia` after unmount and after a device change, plus recovery from a rejected open. | Task 12 |
| I02 | Local voice commit leaves self-hosted routing | **Closed.** `commitVoice` sets `transcriptionMode: "local"` along with the local engine. The test runs the real `resolveTranscriptionRoute` from a self-hosted state. Meeting and upload routes are untouched. | Task 13 |
| I03 | Language change can commit an incompatible model | **Closed.** `reconcileVoice` replaces or clears the model on every language change. The primary is disabled, with a stated reason, unless the model hears every spoken language. Language is locked while a transfer runs. Saved model IDs outside the onboarding catalog are ignored. | Tasks 3 and 13 |
| I04 | Download readiness carried across model identities | **Closed.** Installation, samples, milestones, kept bytes and cancellation are stored with their model ID. Progress is read from `downloads[selectedModel]`. A deferred-status test covers the switch. | Task 7 |
| I05 | Selected-but-unavailable cleanup shown as optional | **Closed.** Readiness and the Cleanup "Now" line take the user's `cleanupChoice` and `cleanupStatus` as well as the active route. They show the unmet prerequisite and a real Settings destination. A flow test uses the real `applyCleanupChoice`. | Tasks 16 and 18 |
| I06 | "Dictate into a note" validates the wrong route | **Closed.** The action is gated on `noteRecordingStt` plus microphone access, and it discloses that route's locality and provider. Self-hosted note mode is blocked through the route (§5.1 rule 9, `unreachable`/`unsupported`), because the current recorder throws `unsupportedSelfHosted` (`meetingTranscriptionRouting.js`). An `unknown` route reads "Checking…". | Task 18 |
| I07 | Ready claims success without evidence | **Closed.** The new `configured` status separates "set up" from "proven". "You're dictating." requires a successful trial. Unknown Accessibility reads as pending. A microphone counts as working only after it is heard. | Task 18 |
| I08 | Cleanup retry bleeds into later takes | **Closed.** Retry results go through the reducer, keyed by `takeId`. Stale and failed results are handled and tested. | Tasks 6 and 15 |
| I09 | Undo handoff absent from both plans | **Closed by contract.** The bridge is now spec §5.2 (Plan 04 CCR-5, which superseded this plan's CCR 1). Plan 05's handler calls `sendUndoCancelDictation(lastCancelledDictation?.sessionId)` and returns `restored`. Until Plan 04 lands, a cancel shows "Discarded." with no Undo, and this is tested. Task 22 wires `CancelledState`, `cancelClosed`, `disclosureCopy` and Undo, and is run by whichever plan merges second. | Tasks 4, 5, 15 and 22 |
| I10 | Notice branch cannot pass its tests | **Closed.** Pure builders return the exact §5.3 `NoticeInput` and are tested independently of merge order. One adapter file, `useOnboardingNotifier`, is the only merge-order-dependent code, and each variant has its own test. | Task 7 |
| I11 | Typecheck blockers | **Closed.** Preview methods are typed against `ParakeetModelResult` (`downloaded: false` on failure). `OnboardingCompleteOptions` is defined once (Task 1) and used by both the prop and `finish`. | Tasks 1, 8 and 18 |
| I12 | Preview lifecycle | **Closed.** Every terminal transition settles once and clears `active`. `reset()` settles a pending transfer. A cancel is "Discarded." with no Undo, exactly as on desktop before Plan 04. Task 22 adds the preview's Undo, which requires a live cancellation inside its window. All are tested. | Tasks 8 and 22 |
| I13 | Harness assumes pre-Plan-02 layout | **Closed.** Task 9 extends Plan 02's `fakeDomTree.js` compatibly, keeping `find` and `props`, and builds `mountComponent` on `rendererOptions`. No second harness. | Task 9 |
| I14 | Speed never rendered; Plan 02 tests not migrated; stalls not aged | **Closed.** `VoiceDownloadPanel` wraps Plan 02's `DownloadProgressBar` (progressbar semantics, speed, ETA) with received/total, Cancel and restart. Plan 02's five `onboardingDownloadProgress` behaviours are migrated. A 1 s ageing tick turns a stall into "no estimate". | Tasks 7, 13 and 14 |
| M01 | Connected remote cleanup never uses the user's words | **Closed, by a different route.** The review proposed running remote cleanup automatically after connection. Instead, after connection the user gets an explicit one-tap consent ("Try it on my sentence · sends N words to {provider}"). Nothing is sent without that tap (§4: choices stay explicit). Labels use `providerDisplayLabel(route.providerId)`. | Task 16 |
| M02 | M2 lacks settle/bubble-draw and un-docks | **Closed.** Success settles the bars into the mark, draws the bubble (stroke-dashoffset, `--motion-slow`), then docks. The dock persists for the rest of setup; the rail shows bars again only while they carry state. Reduced motion is an instant swap. | Tasks 11 and 15 |
| M03 | Tests that do not prove their names | **Closed.** The harness tracks `document.activeElement` and supports simple `querySelector`. Arrow-key and heading-focus tests assert focus. The no-account flow test is restored, with nested API call logging. The rail contrast test reads the rendered rule's tokens. | Tasks 9 and 11 |
| M04 | Zoom and long labels | **Closed.** The header collapses its label, the footer chip truncates, and footer actions never wrap past two rows. The acceptance matrix adds 200% zoom and German and Russian. | Tasks 11 and 21 |
| M05 | Mechanical checks and duplication | **Closed.** The orphan check is limited to runtime usages, and `ProviderIcon`'s dead `monochrome` prop is removed together with its class. The final grep exempts deletion tests. The motion hook is hoisted in Task 14. The translation heading is fixed. Orchestrator wiring is written once (OnboardingFlow composition), and each task carries only its deltas. | Tasks 11, 14, 20 and 21, and composition |

**Round 1** was the same reviewer on the previous revision, with 25 findings (ONB-01…25). Those not restated above are also closed:

| Finding | How it is closed | Task |
|---|---|---|
| ONB-06 | Leaving a demo cancels processing as well as recording, and a session admits nothing until it sees its own `listening`. | 4 |
| ONB-07 | Blank results publish `NO_AUDIO`. | 5 |
| ONB-14 | Test-runner globs are quoted file patterns. | All |
| ONB-15 | Word counts are 7. | 16 |
| ONB-16 | A synthetic `tap` during a native press is ignored. | 15 |
| ONB-19 | The push-mode suggestion waits for `loaded`. | 17 |
| ONB-20 | The traffic-light inset stays physical, matching Plan 02. | 11 |
| ONB-21 | Navigation markers use `--color-nav-marker`. | 11 and 14 |
| ONB-02 | `WelcomeVariations` is migrated before `WelcomeScreen` is deleted. | 12 |

### Round-2 review response

**Round 3** is Codex `gpt-6.1-sol` at xhigh on `1904563`: `.omc/research/ui-review/reviews/plan-05-codex-r2.md`. It found 0 Critical, 9 Important and 2 Minor. All 11 are fixed in the task steps and their tests, against spec `7f31ece`. None is disputed. Each fix was checked against the real code or data named in the Evidence column.

| ID | Finding | Fix | Evidence | Tasks |
|---|---|---|---|---|
| R2-I01 | Task 22 kept a sanitizer that fails its own contract | Removed "keep it exactly as Plan 04 wrote it". Task 22's pre-flight now requires `alsoSentTo` in the sanitizer, and stops for Plan 04's owner if it is missing. The contract test runs with `[]` and with two destinations. A render test names every receiver through `disclosureCopy`. | Spec §5.2 (ff8c9cd). Plan 04's current sanitizer (`ff423fb`) builds `{ target, payload, evidence }` only, so the test fails until Plan 04 fixes its own task. | 22 |
| R2-I02 | 04-first: the publish handler dropped the `lastCancelledDictation` bookkeeping | The handler body is now a single `publishDemoEvent` call (sanitise, admit, then `trackCancelledDemo`) in both merge orders. Plan 04's inline lines are superseded, not kept twice. A close only clears its own session. A pure test covers set and clear. A handler-level test drives publish, then cancel, then Undo, then close, through the real `WindowManager`. | `ipcHandlers.js:1059` is the replaced handler. `windowManagerAssistantPanel.test.js:153` loads `WindowManager` with stubs. | 4, 22 |
| R2-I03 | Task 8's `satisfies` check failed on the progress callback | `ProgressListener` and `ProgressData` are now derived from `Window["electronAPI"]["onParakeetDownloadProgress"]`. `satisfies` is kept, with no casts. | `tsc` probe against `src/types/electron.ts`: the old type gives TS2322, and the derived type compiles with both emit shapes. | 8 |
| R2-I04 | Clearing an unsupported voice re-selected the detected voice | `chosenModel` is now three-state. `undefined` means untouched (detection applies), and `null` means deliberately no compatible voice. | Real catalog (`modelRegistryData.json`): only `nemotron-3.5-asr-streaming-0.6b` hears `ja`, and nothing hears `he`. The flow test's assertions therefore hold as written. | 13, composition |
| R2-I05 | Download fakes overwrote one of the two real listeners | New `test/helpers/harness/listenerBus.js` is a Set with per-callback dispose and fan-out emit. All five progress fixtures use it. The chip assertion expects `chipNoEta`, because one sample gives no rate. | `preload.js:47` (`registerListener`) adds one IPC listener per subscriber. | 7, 13, 14 |
| R2-I06 | Task 22 added untranslated English after Task 20 | `setupFlow.try.undo` now lands in Task 15, hidden, so Task 20 translates it. Task 22 adds no strings. Its verification runs `setupFlowTranslated.test.js` and the full suite. | `scripts/check-i18n.js` checks keys only, so the translation test is the gate. | 15, 22 |
| R2-I07 | Preview cancel let an in-flight result succeed | The preview tracks `take` as idle, recording or processing. Cancel works in both active states and clears the pending result. Leaving clears it too. New tests cover Esc during processing and leaving then re-entering; both run before and after Task 22. | This mirrors desktop `_cancelOnboardingTake` (Task 4: preparation plus active cancel). | 8, 22 |
| R2-I08 | Task 11's composition used later tasks' state | The composition now tags each shell render prop: `docked` [T15], `announcement` [T14], the `DownloadChip` footer [T13]. It adds an explicit Task 14 interim for the `try` case (legacy children, download/idle rail, and two Task-14-only bindings). An audit of every block found no other forward reference. | `src/tsconfig.json` has `strict: false` and no `noUnusedLocals`, so tagged-but-unused imports do not break a checkpoint. | 11, 14, composition |
| R2-I09 | Error bars at 1.02:1 on the light rail | Light: ink (`--color-live-foreground`) on the orange rail, 5.75:1. Plum Night: warning amber, 8.73:1. The rendered-rule contrast test now resolves both error overrides. | Foundations tokens: `#d97706`/`#ff5a1f` give 1.02, `#171717`/`#ff5a1f` give 5.75, `#f0a83c`/`#21151b` give 8.73. | 11 |
| R2-M01 | M2 docked but did not settle the live bars | Three stages. (1) Settle: the same `LevelBars` driver runs on a zero level for `SETTLE_MS`, and its smoothing eases to the rest silhouette, so no math is duplicated. (2) Draw: the bubble draws for `DRAW_MS` (360 ms). (3) Dock. Reduced motion is an instant swap. The rail test and the flow test assert the stage order. | `levelBars.test.js`: a zero or invalid sample steps toward the rest silhouette. | 11, 15, composition |
| R2-M02 | Route disclosures bypassed Plan 03's chips | Cleanup uses `RouteDestinationChip` and `RouteStateChip`. Ready's note action uses `RouteDestinationChip` (`NoteActionState` gains `model`). Tests stub the chip module and assert the route each receives. The onboarding sentences stay. | Spec §5.1 published components. Plan 03 `c912d19`, `RouteChips.tsx` props. | 16, 18 |

### Round-3 review response

**Round 4** is Codex `gpt-6.1-sol` at xhigh on `5d2c9d7`: `.omc/research/ui-review/reviews/plan-05-codex-r3.md`. Its verdict was "execute after revisions", with 2 Minor findings left. Both are fixed in the task steps and their tests, and neither is disputed.

| ID | Finding | Fix | Tasks |
|---|---|---|---|
| R3-M01 | The settle stage still lost the live meter. Processing unmounted it, and the first success render dropped it. | Adds `InstrumentMode` `processing`, which the composition maps from `trial.phase === "processing"`. The rail adjusts its meter state during render when the mode changes, so no render drops it. One keyed `LevelBars` instance lives from `listening` through `processing` and the settle, switching to zero input. Its retained frame eases to the rest silhouette, then the bubble draws (`DRAW_MS`), then the mark docks. Reduced motion keeps the instant swap. The new rail test drives the real sampler on a mocked clock, through listening → processing → success. It asserts that the meter's DOM node is the same instance in all three, that the centre bar's transform rises and then eases toward rest, and that the bubble follows. The flow test now emits `processing` and asserts the same identity before checking bubble-then-dock. | 11, 15, composition |
| R3-M02 | `RouteStateChip` said "Off" next to a chosen but unavailable cleanup | The state chip shows only when the choice's own check has passed (`status === "ready"`) and the route is not `off`. Before that, the prerequisite sentence owns the status. The destination chip stays as it was. The pending-choice test now covers provider failed, provider checking, ChatGPT failed and local pending, and rejects any state chip in each. It accepts exactly one `ready` chip once the route is validated. | 16 |

**Plan 04 round-4 integration (a47935c).** Its snapshot savers replace this plan's temporary mutable privacy guards. Task 5 branches on the setter's presence; Task 22 removes the old guards in the 05→04 order. The private-save fixture uses the real setter when available, and the source ratchet checks conditional ownership release instead of counting three unconditional clears. This is a plan handoff; the combined app suites require implementation of the prerequisite tasks.

## Contract change requests

The spec consolidated every plan's requests into §3 and §5 at `091d198` (`snowopsdev/feat/uiux-foundations`). Each request below now has a status. Where this plan's code and a spec shape differed, the plan was changed to match the spec.

1. **§5.2 cross-window Undo bridge, cancelled demo event, private holds (owner Plan 04).** *Superseded by §5.2 (Plan 04 CCR-5), applied at 091d198.* This plan's earlier `sendUndoCancelDictation(): boolean` and its `undo-cancel-dictation` channel are gone. The plan now uses the spec's shape:
   - **Bridge.** `windowManager.sendUndoCancelDictation(sessionId?) → Promise<UndoResult>`, a request/reply on `undo-cancel-request` / `undo-cancel-reply` that returns `reason: "unavailable"` after 2 s, plus `windowManager.lastCancelledDictation`. Task 4's `onboarding-demo-undo-cancel` handler calls `sendUndoCancelDictation(lastCancelledDictation?.sessionId)` and returns `result.restored`.
   - **Demo events.** `{ kind, status: "cancelled", sessionId, cancelled: CancelledState }` and `{ kind, status: "cancelClosed", sessionId, reason }`, sanitised by Plan 04's `sanitizeCancelledDemoFields`. The `undoUntil` / `remoteAlreadySent?: string` pair is dropped everywhere (Tasks 4, 5, 6, 8 and 15).
   - **Types and copy.** These are imported from `src/types/dictation.ts`, never restated. The disclosure renders with `disclosureCopy` from `src/helpers/dictationDisclosure.js`.
   - **Merge order (§3).** Before Plan 04, Plan 05 ships the fallback: "Discarded." with no Undo. Whichever plan merges second runs **Task 22**, which wires the fields, `canUndo`, the Undo button, the disclosure and the preview's Undo, and deletes the fallback.
   - **Private holds.** These are Plan 04's contract under §5.2. Task 5's hold test runs whenever Plan 04's hold exists (`_closeCancelled`, or `_persistExpiredHold` in older drafts), and fails if an expired private hold is persisted.
2. **(Withdrawn) §5.1 refresh.** Plan 03 already refreshes route facts on `openwhispr-local-models-changed` and `api-key-changed`.
3. **§3 roadmap edge `02 → 05` (owner: spec).** *Applied in spec §3 (091d198).* The execution order is 01 → 02 → 03 → {04, 05, 06, 07}.
4. **`LevelBars` `tone?: "brand" | "onLive"` (Plan 01 contract, extended by Plan 05).** *Applied in spec §5, Plan 01 table (091d198).* Plan 05 adds the prop itself in Task 11, with a `levelBars.test.js` case. The scoped `!important` override is deleted, and a test asserts that it does not return.
5. **`noteRecordingStt` in self-hosted mode resolves `unreachable`/`unsupported` (owner Plan 03).** *Applied in spec §5.1 rule 9 (091d198).* Task 18's `noteActionState` now reads only the route. Its own `meetingTranscriptionMode` check and the `meetingMode` input are removed.

**Spec items adopted without a request of this plan's:**
- **§5.1 rule 1, `unknown` route state.** It is rendered as a neutral "Checking…" and never as ready. Ready's speech row, its cleanup row (through `cleanupSituation`) and the note action all wait for `ready` (Tasks 16 and 18).
- **§5.1, total memory.** Plan 03's `get-total-memory` is the only memory channel. `get-system-profile` carries no memory, and `useSystemProfile` composes the two (Tasks 2 and 13).
- **§5.7, capture status bridge.** Plan 05 adds no lifecycle relay. The trial's status rides the existing `onboarding-demo-event` (§5.2), and `dictation-hotkey-event` carries key presses only, not lifecycle state.
- **Provider names.** Every provider name shown in UI comes from `providerDisplayLabel(route.providerId, t)` (Tasks 16 and 18), or from Plan 04's `disclosureCopy`, which uses the same helper (Task 22).

**Cross-plan coordination (no contract change):**
- **Plan 04 notices and recorder signature.**
  - Plan 04 deletes `useToast` and changes `useAudioRecording` to `useAudioRecording(options)`. Plan 05 touches the toast API in exactly one file (`useOnboardingNotifier.ts`, Task 7). Its `App.jsx` and hook tests accept both signatures.
  - Plan 04's panel `NoticeStack` already covers onboarding.
- **Total memory.** Plan 03 ships `get-total-memory` (§5.1, Handoffs). Plan 05 merges after Plan 03, and `useSystemProfile` reads `getTotalMemory()`. `get-system-profile` carries no memory field.
- **Plan 06 rewrites `ControlPanel`.** Plan 05's only contact is the after-setup intent effect next to `handleNewNote` (Task 18). Plan 06 must carry it, and the effect is covered by a source test.

## Owner decisions (2026-10-14)

1. **The trial and the shortcut tester stay separate (accepted).** Phase 1 "Say something" is the hotkey-first trial (R5 C, 96px keycap). Phase 2 "Shortcut" is the R7 B tester.
2. **The privacy toggles move to Ready (accepted).** The Welcome toggles become "Privacy defaults" on Ready, with unchanged defaults. "Start using Loqui" goes to Ready.
3. **"Your progress is kept" must be true.** A network-class failure keeps the partial file, and main reports `keptBytes`. Retry resumes with `Range`. Cancel and HTTP, TLS or size failures delete the partial file. Setup says "kept" only when main reports kept bytes.
4. **No speech-based language confirmation (D8, accepted).**
5. **Motion tokens replace the showcase timings (accepted).**
   - Dock: `--motion-slow` (360 ms), not 420 ms.
   - Keycap: `--motion-instant` (90 ms), not 80 ms.
   - Band: `--motion-base` (240 ms), not 220 ms.
   - Highlight: `--motion-slow`, not 400 ms.
6. **Hello gets a microphone picker over the existing selection settings.** These are `setMicrophoneSelectionMode` and `setSelectedMicDevice`.
7. **Inline download of the local cleanup model (R6 A) is out of scope (accepted).** Cleanup and Ready point to Settings → Language Models, and Ready lists it as pending.

## Global Constraints

- **Process boundaries (CLAUDE.md).** Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC.
- **Explicit choices.** Local and remote choices stay explicit, and nothing silently switches provider. Content is preserved on every failure.
- **Setup is private.** Nothing recorded during setup is pasted, copied to the clipboard, saved to history, or written to disk. This covers success, failure, empty results, cancel, leaving the step, and the undo hold expiring.
- **No unconsented provider requests.** No provider request is made from the cleanup preview without an explicit tap that names the provider and the word count.
- **Contrast.** Text is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night.
  - `--color-success` and `--color-warning` are icon colours only.
  - Never put white text on `#FF5A1F`.
  - Primaries use the default ink capsule. `variant="live"` is only for the record/stop toggle, "Allow microphone", the ready-block mic and "Dictate into a note".
- **Motion.** Use only the `--motion-*` tokens. Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms. Progress is never conveyed by motion alone.
- **i18n.** Every visible string goes through i18n under the top-level key `setupFlow`, in all 11 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`). `npm run i18n:check` passes.
- **RTL.** Use logical properties. Arrow keys follow the reading direction. The one exception is the macOS traffic-light inset, which stays physical `padding-left` (Plan 02, ONB-Q1).
- **Tests.**
  - Run them through `npm test -- "<quoted glob or file>"` (`scripts/run-tests.js`), with directory arguments always written as `"test/helpers/**/*.test.js"`.
  - Run `npm run native:node` before tests and `npm run native:electron` before launching the app.
  - Never use personal profiles.
- **Node:** `~/.nvm/versions/node/v24.21.0/bin`.
- **Before a PR:** run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run i18n:check`. `DESIGN.md` is updated in the same commits (D10).

## Review Focus

1. **Privacy across every exit.** Cancel, leaving the step, a failed take, an empty take, and the expiry of Plan 04's undo hold must all write nothing while setup is incomplete. This holds with discarded-recording retention switched on.
   - Pinned in Task 5: the real `AudioManager` tests, the hook test for `NO_AUDIO` and `cancelled`, and the private-hold test, which runs once Plan 04's hold exists.
2. **Microphone ownership.**
   - Leaving Hello while `getUserMedia` is pending must stop the late stream.
   - Changing devices must release the old stream first.
   - Leaving Say something mid-processing cancels the take, and a late result cannot reach the next session.
   - Pinned in Task 12 (deferred acquisition) and Task 4 (`admitDemoEvent`).
3. **Route truth.**
   - A local voice commit makes dictation local even from self-hosted.
   - Language changes never commit an incompatible model.
   - "Dictate into a note" is enabled only when the note route is ready. An `unknown` route (§5.1 rule 1) is "Checking…", never ready.
   - Ready never says "You're dictating." without a successful trial.
   - Pinned in Tasks 13 and 18.
4. **Download identity and failure.**
   - Switching voices never inherits another voice's readiness or progress.
   - Cancel leaves a restart path.
   - A stall clears its speed.
   - Kept progress is claimed only with `keptBytes > 0`.
   - Pinned in Tasks 7, 13 and 14.
5. **Small windows, zoom, RTL and reduced motion.**
   - At 640×560, at 200% zoom, and with German or Russian labels, every action stays reachable and the footer never grows past two rows.
   - Reduced motion never auto-advances the tour.
   - Pinned in Task 11 (CSS assertions) and Task 21 (acceptance matrix).

---

## Before you start (pre-flight)

Each command must print a match. If one prints nothing, stop: the upstream plan has not merged.

```bash
grep -n -- "--motion-base:" src/index.css                                # Plan 01
grep -n -- "--color-nav-marker:" src/index.css                           # Plan 01
grep -n "nextLevelBarsFrame" src/components/ui/levelBarsMath.ts          # Plan 01
grep -n "export function providerDisplayLabel" src/lib/locality.ts       # Plan 01
ls test/helpers/harness/fakeDomTree.js test/helpers/harness/rendererMocks.js   # Plan 02
grep -n 'role="progressbar"' src/components/ui/DownloadProgressBar.tsx  # Plan 02 ONB-Q2
grep -n "padding-left: max(84px" src/styles/onboarding-welcome.css        # Plan 02 ONB-Q1
grep -n "export function useResolvedRoute" src/lib/routes.ts             # Plan 03
grep -n "providerId" src/lib/routes.ts                                   # Plan 03 (ResolvedRoute.providerId)
grep -n "getTotalMemory" preload.js                                      # Plan 03 (§5.1 total memory)
grep -n "export function RouteDestinationChip" src/components/settings/routing/RouteChips.tsx   # Plan 03 (§5.1 published chips)
grep -n '"unknown"' src/lib/routeGraph.ts                                # Plan 03 (§5.1 rule 1)
ls src/components/ui/notices.ts 2>/dev/null && echo "Plan 04 merged: use notifier variant B (Task 7)" || echo "Plan 04 not merged: use notifier variant A (Task 7)"
grep -n "_closeCancelled\|persistDiscardedBatchRecording" src/helpers/audioManager.js   # which cancel path exists: Plan 04's hold (_closeCancelled) or today's discard (Task 5)
grep -n "sendUndoCancelDictation" src/helpers/windowManager.js || echo "Plan 04 bridge not present: skip Task 22 (whichever plan merges second runs it)"
grep -n "_setOwnedAudio(" src/helpers/audioManager.js || echo "Plan 04 audio-ownership setter not present: Task 5 writes the bare form, Task 22 migrates it"
```

Record the baseline with `npm run native:node` and then `npm test`. Line numbers in this plan were taken at commit `8267276`, with Plan 02's shifts noted. When a line has moved, find it by the quoted code.

## Conventions

- **Component tests** use `mountComponent` (Task 9), built on Plan 02's `rendererOptions`. It mocks `react-i18next` with `I18N_KEYS_MOCK`, so `t("a.b", { x: 1, y: "z" })` renders `a.b(x=1,y=z)`. Assert keys with `expectKey(ui, "a.b", { x: 1 })` (Task 9), which checks the key and each `name=value` without depending on order.
- **Adding strings.** Pipe a JSON fragment into `node scripts/dev/merge-locale-keys.cjs -` (Task 1).
  - It writes `en` and adds English placeholders plus every CLDR plural category to other locales, so `i18n:check` passes after every task.
  - Task 20 translates the placeholders.
  - Run `npx prettier --write "src/locales/**/translation.json"` after each merge.
- **Commit trailer.** End every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit commands below show only the subject.
- **OnboardingFlow wiring.** The final orchestrator is the **OnboardingFlow composition** section. Each task names the composition blocks (`[T12]`, `[T13]`, …) it adds or replaces; copy them exactly.

## Interface index

The authoritative signature lives in the task named in the table; other tasks consume these names exactly.

| Module | Exports | Task |
|---|---|---|
| `src/utils/onboardingState.ts` | `ONBOARDING_STEPS`, `ONBOARDING_SCENARIOS`, `OnboardingScenario`, `isOnboardingStep`, `OnboardingProgress.visited` | 1 |
| `src/utils/onboardingFlow.ts` | `ONBOARDING_PHASES`, `phaseOf`, `nextStep`, `previousStep`, `phaseProgress`, `canNavigateTo`, `markVisited`, `AfterSetupIntent`, `OnboardingCompleteOptions` | 1 |
| `scripts/dev/merge-locale-keys.cjs` | `run`, `expandPlurals`, `mergeInto`, `pluralCategories` | 1 |
| `src/helpers/systemProfile.js` | `getSystemProfile`, `normalizeLocales`; IPC `get-system-profile`; `SystemProfile`, `SystemFacts` types (memory comes from Plan 03's `getTotalMemory`) | 2 |
| `src/utils/onboardingDetection.ts` | `detectVoice`, `VoicePick`, `VoiceOutcome`, `outcomeFor`, `modelDownloadBytes`, `baseLanguages`, `shouldApplyDetectedVoice`, `isOnboardingVoice`, `voiceSupportsAll`, `reconcileVoice`, `spokenLocalesFor` | 3 |
| `src/helpers/onboardingInputPolicy.js` | `shouldReportDictationHotkey`, `sanitizeOnboardingDemoEvent`, `admitDemoEvent`; kinds incl. `shortcut`; statuses incl. `cancelled` | 4 |
| WindowManager | `reportDictationHotkey`, `toggleOnboardingDemoRecording`, `cancelOnboardingDemoRecording`, `undoOnboardingDemoCancel`, `_cancelOnboardingTake` | 4 |
| `src/helpers/audioManager.js` | `setPrivateSession`, `_captureRecordingPrivacy`, `releasePrivateAudio`; snapshot `private`; `lastAudioBlobPrivate` | 5 |
| `src/hooks/useSetupIncomplete.ts` | `isSetupIncomplete`, `useSetupIncomplete` | 5 |
| `src/utils/onboardingDemo.ts` | `buildDemoSuccessEvent`, `demoCleanupOutcome`, `demoErrorCode` | 5 |
| `src/utils/onboardingTrial.ts` | `TrialState` (incl. `takeId`, `cleanupRetry`), `reduceTrial`, `TrialInput`, `isSilent`, `trialCaption`, `VOICE_LEVEL_FLOOR`, `SILENCE_HINT_MS` (6); `TrialState.cancelled`, `canUndo` (22) | 6, 22 |
| `src/utils/onboardingDownload.ts` | `VoiceDownloadState`, `DownloadFacts`, `deriveVoiceDownloadState`, `pushSample`, `estimateRate`, `milestoneCrossed`, `clampPercent`, `byteParts`, `etaParts` | 7 |
| `src/components/onboarding/useVoiceDownload.ts` | `useVoiceDownload(modelId)` → `{ state, milestone, start, cancel }` | 7 |
| `src/components/onboarding/onboardingNotices.ts` / `useOnboardingNotifier.ts` | `voiceReadyNotice`, `voiceFailedNotice`, `shouldAnnounceOffStep`, `OnboardingNotice`; `useOnboardingNotifier` | 7 |
| `src/preview/onboardingScenarioBridge.ts` | `createOnboardingScenarioBridge`, `ScenarioClock`, `PREVIEW_SENTENCE`, `PREVIEW_RAW_SENTENCE` | 8 |
| `test/helpers/harness/fakeDomTree.js` (+), `mountComponent.js` | `installTree` (+ `findAll`, `byAttr`, `press`, focus); `mountComponent`, `expectKey` | 9 |
| `src/components/onboarding/RadioCardGroup.tsx`, `radioNavigation.ts` | `RadioCardGroup`, `nextRadioIndex`, `rovingTabIndex` | 9 |
| `RecoveryCard`, `useRecheckOnFocus`, `useMicrophoneAccess` | `RecoveryCard`, `RECHECK_POLL_MS`, `MicAccess`, `micAccessFrom`, `openMicrophoneHelp` | 10 |
| `instrumentMath.ts`, `InstrumentRail.tsx`, `OnboardingShell.tsx` | `InstrumentMode`, `instrumentFills`, `instrumentCaption`, `dockMark`, `SETTLE_MS`; `OnboardingShellProps` | 11 |
| `src/utils/onboardingMic.ts`, `useMicLevelPreview`, `HelloStep`, `PrivacyDefaults` | `micPickerModel`, `selectionFor`, `toAudioInputs`; `MicLevelPreview` (incl. `retry`) | 12 |
| `useSystemProfile`, `VoiceStep`, `VoiceDownloadPanel`, `DownloadChip` | as named | 13 |
| `LiveKeycap`, `MeetLoquiTour`, `TryStage`, `usePrefersReducedMotion` | as named | 14 |
| `src/utils/onboardingShortcut.ts`; `useTrialSession`, `useDictationHotkey`, `useAccessibilityGate`, `useTicker`, `cleanupRunner`, `HotkeyTrial`, `SuccessBand` | as named | 15 |
| `src/utils/onboardingCleanupPreview.ts`, `CleanupStep` | `diffWords`, `countWords`, `cleanupPreview`, `CleanupRun`, `cleanupSituation`, `CleanupSituation` | 16 |
| `ShortcutStep`, `useShortcutDemo` | as named | 17 |
| `src/utils/onboardingReadiness.ts`, `src/utils/afterSetupIntent.ts`, `ReadyStep` | `summarizeReadiness`, `ReadinessSummary`, `ReadinessRow` (`configured` status), `noteActionState`, `NoteActionState`; `setAfterSetupIntent`, `takeAfterSetupIntent` | 18 |
| `src/hooks/useStartOnboarding.ts` | `START_ONBOARDING_EVENT`, `requestStartOnboarding`, `useStartOnboarding`, `useStartOnboardingListener` | 19 |
| Undo wiring (§5.2, whichever plan merges second) | `OnboardingDemoEvent.{sessionId, cancelled, reason}`, `canUndo`, `useTrialSession().{undo, undoAvailable}`, `HotkeyTrial` `undoAvailable`/`onUndo` | 22 |

---

### Task 1: Step graph, phases, preview scenarios and the i18n merger

Covers ONB-R2 B (structure) and ONB-Q8. It also lays the groundwork the later preview tasks need.

**Files:**
- Modify: `src/utils/onboardingState.ts`. Touch the `OnboardingScenario` type (lines 5-15), `OnboardingProgress` (19-24), `ONBOARDING_STEPS` (45-52), `SCENARIO_VALUES` (55-66), `isOnboardingStep` (71-73), `defaultOnboardingProgress` (91-93) and `readOnboardingProgress` (107-116).
- Create: `src/utils/onboardingFlow.ts`
- Modify: `src/preview/BrowserPreview.tsx:41-54`. This is the literal `scenarios` array.
- Create: `scripts/dev/merge-locale-keys.cjs`
- Modify: `src/locales/*/translation.json`, through the merger.
- Test: `test/utils/onboardingFlow.test.js` and `test/scripts/mergeLocaleKeys.test.js`. Append to `test/utils/onboardingState.test.js`.

**Interfaces:**
- Produces, in `src/utils/onboardingState.ts`:
  - `ONBOARDING_STEPS`: `["welcome","speech","try","cleanup","shortcuts","finish"]`. The step ids are unchanged, so preview URLs keep working.
  - `ONBOARDING_SCENARIOS` (a `readonly` tuple), with `type OnboardingScenario = (typeof ONBOARDING_SCENARIOS)[number]`. It adds `"accessibility-missing" | "nothing-heard" | "low-disk" | "multilingual"`.
  - `export function isOnboardingStep(value: unknown): value is OnboardingStep`
  - `OnboardingProgress` gains `visited: OnboardingStep[]`.
- Produces, in `src/utils/onboardingFlow.ts`:

  ```ts
  export type OnboardingPhase = "dictate" | "personalize" | "ready";
  export const ONBOARDING_PHASES: ReadonlyArray<{ id: "dictate" | "personalize"; steps: readonly OnboardingStep[] }>;
  export function phaseOf(step: OnboardingStep): OnboardingPhase;
  export function nextStep(step: OnboardingStep): OnboardingStep | null;
  export function previousStep(step: OnboardingStep): OnboardingStep | null;
  export interface PhaseProgress { phase: "dictate" | "personalize"; steps: readonly OnboardingStep[]; index: number }
  export function phaseProgress(step: OnboardingStep): PhaseProgress | null; // null on "finish"
  export function canNavigateTo(target: OnboardingStep, current: OnboardingStep, visited: readonly OnboardingStep[]): boolean;
  export function markVisited(visited: readonly OnboardingStep[], step: OnboardingStep): OnboardingStep[];
  // Shared by OnboardingFlow's onComplete prop, its finish() helper (Task 11) and AppRouter (Task 18).
  export type AfterSetupIntent = { kind: "dictate-note" } | { kind: "open-settings"; path: string };
  export interface OnboardingCompleteOptions { openSettings?: boolean; next?: AfterSetupIntent }
  ```

- Produces the i18n keys `setupFlow.progress.*` and `setupFlow.steps.*`.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/onboardingFlow.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingFlow.ts");
const loadState = () => import("../../src/utils/onboardingState.ts");

test("first words come before options: two phases, then Ready", async () => {
  const { ONBOARDING_STEPS } = await loadState();
  assert.deepEqual([...ONBOARDING_STEPS], ["welcome", "speech", "try", "cleanup", "shortcuts", "finish"]);
  const { ONBOARDING_PHASES, phaseOf } = await load();
  assert.deepEqual(
    ONBOARDING_PHASES.map((phase) => [phase.id, [...phase.steps]]),
    [
      ["dictate", ["welcome", "speech", "try"]],
      ["personalize", ["cleanup", "shortcuts"]],
    ]
  );
  assert.equal(phaseOf("try"), "dictate");
  assert.equal(phaseOf("cleanup"), "personalize");
  assert.equal(phaseOf("finish"), "ready");
});

test("next and previous follow the graph and stop at both ends", async () => {
  const { nextStep, previousStep } = await load();
  assert.equal(nextStep("speech"), "try");
  assert.equal(nextStep("try"), "cleanup");
  assert.equal(nextStep("finish"), null);
  assert.equal(previousStep("welcome"), null);
  assert.equal(previousStep("cleanup"), "try");
});

test("progress counts within the current phase only", async () => {
  const { phaseProgress } = await load();
  assert.deepEqual(phaseProgress("speech"), { phase: "dictate", steps: ["welcome", "speech", "try"], index: 1 });
  assert.deepEqual(phaseProgress("shortcuts"), { phase: "personalize", steps: ["cleanup", "shortcuts"], index: 1 });
  assert.equal(phaseProgress("finish"), null);
});

test("only visited steps other than the current one are navigable", async () => {
  const { canNavigateTo, markVisited } = await load();
  const visited = markVisited(markVisited(["welcome"], "speech"), "speech");
  assert.deepEqual(visited, ["welcome", "speech"]);
  assert.equal(canNavigateTo("welcome", "speech", visited), true);
  assert.equal(canNavigateTo("speech", "speech", visited), false);
  assert.equal(canNavigateTo("try", "speech", visited), false);
});
```

Append to `test/utils/onboardingState.test.js`:

```js
function stubStorage(t, initial = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  t.after(() => {
    globalThis.localStorage = previous;
  });
  return values;
}

test("progress remembers visited steps and drops unknown ones", async (t) => {
  stubStorage(t, {
    "loqui.onboarding.progress": JSON.stringify({
      version: 2,
      step: "try",
      explored: false,
      completed: false,
      visited: ["welcome", "speech", "bogus", 7],
    }),
  });
  const { readOnboardingProgress, writeOnboardingProgress } = await import("../../src/utils/onboardingState.ts");
  assert.deepEqual(readOnboardingProgress().visited, ["welcome", "speech"]);
  assert.deepEqual(writeOnboardingProgress({ visited: ["welcome", "speech", "try"] }).visited, ["welcome", "speech", "try"]);
});

test("records written before visited existed still load", async (t) => {
  stubStorage(t, {
    "loqui.onboarding.progress": JSON.stringify({ version: 2, step: "cleanup", explored: true, completed: false }),
  });
  const { readOnboardingProgress } = await import("../../src/utils/onboardingState.ts");
  assert.deepEqual(readOnboardingProgress(), {
    version: 2,
    step: "cleanup",
    explored: true,
    completed: false,
    visited: [],
  });
});

test("every preview scenario round-trips through the URL", async () => {
  const { ONBOARDING_SCENARIOS, parseOnboardingPreviewConfig } = await import("../../src/utils/onboardingState.ts");
  for (const scenario of ["accessibility-missing", "nothing-heard", "low-disk", "multilingual", "fresh"]) {
    assert.ok(ONBOARDING_SCENARIOS.includes(scenario));
    assert.equal(parseOnboardingPreviewConfig(`?scenario=${scenario}`).scenario, scenario);
  }
  assert.equal(parseOnboardingPreviewConfig("?scenario=nope").scenario, "fresh");
});
```

Create `test/scripts/mergeLocaleKeys.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { run } = require("../../scripts/dev/merge-locale-keys.cjs");

function localesFixture(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-locales-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [locale, json] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, locale));
    fs.writeFileSync(path.join(dir, locale, "translation.json"), JSON.stringify(json));
  }
  const read = (locale) => JSON.parse(fs.readFileSync(path.join(dir, locale, "translation.json"), "utf8"));
  return { dir, read };
}

test("adds English, placeholders where missing, and never overwrites a translation", (t) => {
  const { dir, read } = localesFixture(t, {
    en: { setupFlow: { a: "Old A" } },
    de: { setupFlow: { a: "Altes A (übersetzt)" } },
    fr: { setupFlow: { a: "Old A" } },
  });
  run({ setupFlow: { a: "New A", b: "B" } }, dir);
  assert.deepEqual(read("en").setupFlow, { a: "New A", b: "B" });
  assert.deepEqual(read("de").setupFlow, { a: "Altes A (übersetzt)", b: "B" });
  assert.deepEqual(read("fr").setupFlow, { a: "New A", b: "B" }, "a stale placeholder follows the new English");
});

test("plural keys get every category each locale reaches", (t) => {
  const { dir, read } = localesFixture(t, { en: {}, ar: {}, ru: {} });
  run({ setupFlow: { left_one: "{{count}} thing left", left_other: "{{count}} things left" } }, dir);
  assert.deepEqual(Object.keys(read("en").setupFlow).sort(), ["left_one", "left_other"]);
  assert.deepEqual(Object.keys(read("ar").setupFlow).sort(), [
    "left_few",
    "left_many",
    "left_one",
    "left_other",
    "left_two",
    "left_zero",
  ]);
  assert.deepEqual(Object.keys(read("ru").setupFlow).sort(), ["left_few", "left_many", "left_one", "left_other"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingFlow.test.js test/utils/onboardingState.test.js test/scripts/mergeLocaleKeys.test.js`
Expected: FAIL.
- `onboardingFlow.ts` is missing.
- The step order assertion fails, because `cleanup` currently comes before `try`.
- `visited` is undefined.
- `merge-locale-keys.cjs` is missing.

- [ ] **Step 3: Implement**

1. In `src/utils/onboardingState.ts`, replace the `OnboardingScenario` union (lines 5-15) with:

   ```ts
   export const ONBOARDING_SCENARIOS = [
     "fresh",
     "ready",
     "downloading",
     "download-interrupted",
     "microphone-denied",
     "codex-missing",
     "codex-expired",
     "invalid-provider-key",
     "cleanup-failed",
     "insufficient-memory",
     "accessibility-missing",
     "nothing-heard",
     "low-disk",
     "multilingual",
   ] as const;

   export type OnboardingScenario = (typeof ONBOARDING_SCENARIOS)[number];
   ```

   Then make these changes:
   - Add `visited: OnboardingStep[];` to `OnboardingProgress`.
   - Reorder `ONBOARDING_STEPS` to `"welcome", "speech", "try", "cleanup", "shortcuts", "finish"`.
   - Replace the `SCENARIO_VALUES` literal with `const SCENARIO_VALUES = new Set<string>(ONBOARDING_SCENARIOS);`.
   - Export `isOnboardingStep`.
   - `defaultOnboardingProgress()` returns `{ version: ONBOARDING_VERSION, step: "welcome", explored: false, completed: false, visited: [] }`.
   - `readOnboardingProgress` adds `visited: Array.isArray(stored.visited) ? stored.visited.filter(isOnboardingStep) : [],`.

   The version stays `2`. The new field is optional on read, so no migration is needed.

2. Create `src/utils/onboardingFlow.ts`:

   ```ts
   import { ONBOARDING_STEPS, type OnboardingStep } from "./onboardingState";

   // Setup is two phases and a summary (spec ONB-R2 B): "Get dictating" ends at
   // the first words on screen; "Make it yours" is optional; Ready is honest.
   export type OnboardingPhase = "dictate" | "personalize" | "ready";

   export const ONBOARDING_PHASES: ReadonlyArray<{
     id: "dictate" | "personalize";
     steps: readonly OnboardingStep[];
   }> = [
     { id: "dictate", steps: ["welcome", "speech", "try"] },
     { id: "personalize", steps: ["cleanup", "shortcuts"] },
   ];

   export interface PhaseProgress {
     phase: "dictate" | "personalize";
     steps: readonly OnboardingStep[];
     index: number;
   }

   export function phaseOf(step: OnboardingStep): OnboardingPhase {
     return ONBOARDING_PHASES.find((phase) => phase.steps.includes(step))?.id ?? "ready";
   }

   export function nextStep(step: OnboardingStep): OnboardingStep | null {
     const index = ONBOARDING_STEPS.indexOf(step);
     return index >= 0 && index < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[index + 1] : null;
   }

   export function previousStep(step: OnboardingStep): OnboardingStep | null {
     const index = ONBOARDING_STEPS.indexOf(step);
     return index > 0 ? ONBOARDING_STEPS[index - 1] : null;
   }

   export function phaseProgress(step: OnboardingStep): PhaseProgress | null {
     for (const phase of ONBOARDING_PHASES) {
       const index = phase.steps.indexOf(step);
       if (index >= 0) return { phase: phase.id, steps: phase.steps, index };
     }
     return null;
   }

   export function canNavigateTo(
     target: OnboardingStep,
     current: OnboardingStep,
     visited: readonly OnboardingStep[]
   ): boolean {
     return target !== current && visited.includes(target);
   }

   export function markVisited(
     visited: readonly OnboardingStep[],
     step: OnboardingStep
   ): OnboardingStep[] {
     return visited.includes(step) ? [...visited] : [...visited, step];
   }

   // What the workspace does once setup closes (Ready, Task 18). One type for the
   // prop, the flow's finish() helper and AppRouter, so they cannot drift (I11).
   export type AfterSetupIntent = { kind: "dictate-note" } | { kind: "open-settings"; path: string };

   export interface OnboardingCompleteOptions {
     openSettings?: boolean;
     next?: AfterSetupIntent;
   }
   ```

3. In `src/preview/BrowserPreview.tsx`, replace the literal `const scenarios: OnboardingScenario[] = [ … ];` (lines 41-54) with `const scenarios = ONBOARDING_SCENARIOS;`. Add `ONBOARDING_SCENARIOS` to the existing import from `../utils/onboardingState`, and drop the now-unused `type OnboardingScenario` import if lint flags it.

4. Create `scripts/dev/merge-locale-keys.cjs`:

   ```js
   #!/usr/bin/env node
   "use strict";
   // Dev helper for UI plans. Merges a JSON fragment of new i18n keys:
   // - en/translation.json: every fragment value is written (new or changed copy).
   // - other locales: a key is added only when missing, or replaced while it still
   //   equals the previous English value (an untranslated placeholder). Real
   //   translations are never overwritten.
   // - plural keys are expanded to every CLDR category the locale reaches for
   //   counts 0-200, the same rule scripts/check-i18n.js enforces.
   // Usage: node scripts/dev/merge-locale-keys.cjs <fragment.json | ->
   const fs = require("node:fs");
   const path = require("node:path");

   const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

   function pluralCategories(locale) {
     const rules = new Intl.PluralRules(locale);
     const categories = new Set();
     for (let n = 0; n <= 200; n++) categories.add(rules.select(n));
     return [...categories];
   }

   function expandPlurals(fragment, locale) {
     const out = {};
     for (const [key, value] of Object.entries(fragment)) {
       if (value && typeof value === "object" && !Array.isArray(value)) {
         out[key] = expandPlurals(value, locale);
         continue;
       }
       const match = key.match(PLURAL_SUFFIX);
       if (!match) {
         out[key] = value;
         continue;
       }
       const base = key.slice(0, -match[0].length);
       const other = fragment[`${base}_other`] ?? value;
       for (const category of pluralCategories(locale)) {
         const name = `${base}_${category}`;
         if (!(name in out)) out[name] = fragment[name] ?? other;
       }
     }
     return out;
   }

   function mergeInto(target, fragment, previous, overwrite) {
     for (const [key, value] of Object.entries(fragment)) {
       if (value && typeof value === "object" && !Array.isArray(value)) {
         if (!target[key] || typeof target[key] !== "object") target[key] = {};
         mergeInto(target[key], value, previous?.[key], overwrite);
       } else if (overwrite || !(key in target) || target[key] === previous?.[key]) {
         target[key] = value;
       }
     }
     return target;
   }

   function run(fragment, localesDir = path.join(__dirname, "../../src/locales")) {
     const file = (locale) => path.join(localesDir, locale, "translation.json");
     const read = (locale) => JSON.parse(fs.readFileSync(file(locale), "utf8"));
     const write = (locale, json) => fs.writeFileSync(file(locale), `${JSON.stringify(json, null, 2)}\n`);
     const previousEn = read("en");
     write("en", mergeInto(read("en"), expandPlurals(fragment, "en"), previousEn, true));
     for (const locale of fs.readdirSync(localesDir)) {
       if (locale === "en" || !fs.existsSync(file(locale))) continue;
       const previous = expandPlurals(previousEn, locale);
       write(locale, mergeInto(read(locale), expandPlurals(fragment, locale), previous, false));
     }
   }

   module.exports = { run, expandPlurals, mergeInto, pluralCategories };

   if (require.main === module) {
     const source = process.argv[2];
     if (!source) throw new Error("Usage: merge-locale-keys.cjs <fragment.json | ->");
     run(JSON.parse(fs.readFileSync(source === "-" ? 0 : source, "utf8")));
   }
   ```

5. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "progress": {
         "nav": "Setup progress",
         "dictate": "Get dictating",
         "personalize": "Make it yours",
         "ready": "Ready",
         "label": "{{phase}} · {{step}}",
         "goTo": "Go to {{step}}"
       },
       "steps": {
         "welcome": "Hello",
         "speech": "Voice",
         "try": "Say something",
         "cleanup": "Cleanup",
         "shortcuts": "Shortcut",
         "finish": "Ready"
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/utils/onboardingFlow.test.js test/utils/onboardingState.test.js test/scripts/mergeLocaleKeys.test.js test/components/personalWorkspace.test.js && npm run i18n:check`
Expected: PASS.

The old `personalWorkspace` test "first setup reaches completion…" walks steps in the old order through hard-coded `handleContinue`, so it still passes until Task 11 replaces it.

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingState.ts src/utils/onboardingFlow.ts src/preview/BrowserPreview.tsx scripts/dev/merge-locale-keys.cjs src/locales test/utils/onboardingFlow.test.js test/utils/onboardingState.test.js test/scripts/mergeLocaleKeys.test.js
git commit -m "feat(onboarding): two-phase step graph, visited steps and new preview scenarios"
```

---

### Task 2: System profile IPC (the D8 inputs)

Covers the data half of ONB-R3 C under D8: hardware and OS locale only. Total memory is not part of this channel. Plan 03 ships `get-total-memory` (`getTotalMemory(): Promise<number>`, `os.totalmem()`), and spec §5.1 says Plan 05 reads that same main-side value with no second channel. `useSystemProfile` (Task 13) composes the two.

**Files:**
- Create: `src/helpers/systemProfile.js`
- Modify: `src/helpers/ipcHandlers.js`. Add a handler next to `onboarding-demo-stop` (around line 1054).
- Modify: `preload.js`. Add after `onOnboardingDemoEvent` (lines 114-117).
- Modify: `src/types/electron.ts`. Add the type near `OnboardingDemoEvent` (651-668) and the method after line 701.
- Modify: `docs/PRIVACY.md`, section `## Content and retention`.
- Test: `test/helpers/systemProfile.test.js`. Append to `test/helpers/preloadOnboardingBridge.test.js`.

**Interfaces:**
- Consumes `detectNvidiaGpu` (`src/utils/gpuDetection.js:140`) and `getCacheRoot` (`src/helpers/modelDirUtils.js:57`).
- Produces:

  ```ts
  // src/types/electron.ts
  export interface SystemProfile {
    locales: string[];               // OS preferred languages, BCP 47, deduped, max 8
    totalMemoryBytes: number | null; // from Plan 03's getTotalMemory (§5.1), composed in the renderer
    freeDiskBytes: number | null;    // free space where models are stored
    gpu: { kind: "apple-silicon" | "nvidia" | "unknown"; name: string | null };
  }
  export type SystemFacts = Omit<SystemProfile, "totalMemoryBytes">;
  // window.electronAPI
  getSystemProfile?: () => Promise<SystemFacts>;
  ```

  ```js
  // src/helpers/systemProfile.js (CommonJS, dependency-injected for tests)
  async function getSystemProfile(deps): Promise<SystemFacts>
  function normalizeLocales(list, fallback): string[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/systemProfile.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { getSystemProfile, normalizeLocales } = require("../../src/helpers/systemProfile");

const enoent = () => Object.assign(new Error("missing"), { code: "ENOENT" });

test("reads preferred languages, free space and Apple silicon without probing NVIDIA", async () => {
  const profile = await getSystemProfile({
    app: { getPreferredSystemLanguages: () => ["es-ES", "en-US", "es-ES"], getLocale: () => "en-US" },
    platform: "darwin",
    arch: "arm64",
    statfs: async (dir) => {
      assert.equal(dir, "/cache/loqui");
      return { bavail: 1000, bsize: 4096 };
    },
    cacheRoot: "/cache/loqui",
    detectGpu: async () => {
      throw new Error("must not probe NVIDIA on Apple silicon");
    },
  });
  assert.deepEqual(profile, {
    locales: ["es-ES", "en-US"],
    freeDiskBytes: 4096000,
    gpu: { kind: "apple-silicon", name: null },
  });
  assert.equal("totalMemoryBytes" in profile, false, "memory comes from Plan 03's get-total-memory (§5.1)");
});

test("free space is read from the nearest existing parent of the model cache", async () => {
  const seen = [];
  const profile = await getSystemProfile({
    app: { getLocale: () => "en-US" },
    platform: "linux",
    arch: "x64",
    statfs: async (dir) => {
      seen.push(dir);
      if (dir !== "/home/u") throw enoent();
      return { bavail: 10, bsize: 1000 };
    },
    cacheRoot: "/home/u/.cache/loqui",
    detectGpu: async () => ({ hasNvidiaGpu: false }),
  });
  assert.deepEqual(seen, ["/home/u/.cache/loqui", "/home/u/.cache", "/home/u"]);
  assert.equal(profile.freeDiskBytes, 10000);
  assert.deepEqual(profile.gpu, { kind: "unknown", name: null });
});

test("unknowns are null, never guesses; an NVIDIA card is named", async () => {
  const profile = await getSystemProfile({
    app: { getLocale: () => "fr-FR" },
    platform: "win32",
    arch: "x64",
    statfs: async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    },
    cacheRoot: "C:\\cache",
    detectGpu: async () => ({ hasNvidiaGpu: true, gpuName: "NVIDIA GeForce RTX 4070" }),
  });
  assert.deepEqual(profile, {
    locales: ["fr-FR"],
    freeDiskBytes: null,
    gpu: { kind: "nvidia", name: "NVIDIA GeForce RTX 4070" },
  });
});

test("a failing GPU probe is unknown, not an error", async () => {
  const profile = await getSystemProfile({
    app: {},
    platform: "linux",
    arch: "x64",
    statfs: async () => ({ bavail: 1, bsize: 1 }),
    cacheRoot: "/c",
    detectGpu: async () => {
      throw new Error("nvidia-smi missing");
    },
  });
  assert.deepEqual(profile.gpu, { kind: "unknown", name: null });
  assert.deepEqual(profile.locales, []);
});

test("locales are trimmed, deduplicated and capped at eight", () => {
  assert.deepEqual(normalizeLocales([" en-US ", "", 3, "en-US", "de-DE"], "fr-FR"), ["en-US", "de-DE"]);
  assert.deepEqual(normalizeLocales(undefined, "ja-JP"), ["ja-JP"]);
  assert.equal(normalizeLocales(Array.from({ length: 20 }, (_, i) => `x${i}`)).length, 8);
});
```

Append to `test/helpers/preloadOnboardingBridge.test.js`:

```js
test("system profile bridge invokes only its channel", async () => {
  const { api, invocations } = loadPreloadApi();
  await api.getSystemProfile();
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0][0], "get-system-profile");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/systemProfile.test.js test/helpers/preloadOnboardingBridge.test.js`
Expected: FAIL. `Cannot find module '../../src/helpers/systemProfile'`, and `api.getSystemProfile is not a function`.

- [ ] **Step 3: Implement**

1. Create `src/helpers/systemProfile.js`:

   ```js
   "use strict";
   // Facts setup uses to recommend a voice (spec D8): OS languages, free space
   // where models are stored, and the GPU. Total memory comes from Plan 03's
   // get-total-memory (§5.1). Read on this device, returned to the setup window,
   // never stored or sent anywhere.
   const path = require("path");
   const fsPromises = require("fs/promises");

   const MAX_LOCALES = 8;
   const MAX_PARENT_HOPS = 8;

   function normalizeLocales(list, fallback) {
     const values = (Array.isArray(list) ? list : [])
       .filter((value) => typeof value === "string" && value.trim())
       .map((value) => value.trim());
     if (values.length === 0 && typeof fallback === "string" && fallback.trim()) {
       values.push(fallback.trim());
     }
     return [...new Set(values)].slice(0, MAX_LOCALES);
   }

   // The cache root may not exist on first run; free space is the same for the
   // nearest existing parent on the same volume.
   async function freeBytesAt(directory, statfs) {
     let current = directory;
     for (let hop = 0; hop <= MAX_PARENT_HOPS; hop++) {
       try {
         const stats = await statfs(current);
         const free = Number(stats.bavail) * Number(stats.bsize);
         return Number.isFinite(free) && free >= 0 ? free : null;
       } catch (error) {
         const parent = path.dirname(current);
         if (error?.code !== "ENOENT" || parent === current) return null;
         current = parent;
       }
     }
     return null;
   }

   async function detectGpuKind({ platform, arch, detectGpu }) {
     if (platform === "darwin" && arch === "arm64") return { kind: "apple-silicon", name: null };
     if (typeof detectGpu !== "function") return { kind: "unknown", name: null };
     try {
       const info = await detectGpu();
       if (info?.hasNvidiaGpu) return { kind: "nvidia", name: info.gpuName ?? null };
     } catch {
       // A missing nvidia-smi is the common case, not an error.
     }
     return { kind: "unknown", name: null };
   }

   async function getSystemProfile({
     app,
     platform = process.platform,
     arch = process.arch,
     statfs = fsPromises.statfs,
     cacheRoot,
     detectGpu,
   } = {}) {
     return {
       locales: normalizeLocales(app?.getPreferredSystemLanguages?.(), app?.getLocale?.()),
       freeDiskBytes: cacheRoot ? await freeBytesAt(cacheRoot, statfs) : null,
       gpu: await detectGpuKind({ platform, arch, detectGpu }),
     };
   }

   module.exports = { getSystemProfile, normalizeLocales };
   ```

2. In `src/helpers/ipcHandlers.js`, add this after the `onboarding-demo-stop` handler. `app` is already imported on line 1.

   ```js
       // Computed once per launch: the facts do not change while setup runs, and
       // the NVIDIA probe spawns a process.
       ipcMain.handle("get-system-profile", () => {
         if (!this._systemProfilePromise) {
           const { getSystemProfile } = require("./systemProfile");
           const { getCacheRoot } = require("./modelDirUtils");
           const { detectNvidiaGpu } = require("../utils/gpuDetection");
           this._systemProfilePromise = getSystemProfile({
             app,
             cacheRoot: getCacheRoot(),
             detectGpu: () => detectNvidiaGpu(),
           });
         }
         return this._systemProfilePromise;
       });
   ```

3. In `preload.js`, add this after the `onOnboardingDemoEvent` entry:

   ```js
     getSystemProfile: () => ipcRenderer.invoke("get-system-profile"),
   ```

4. In `src/types/electron.ts`:
   - Add the `SystemProfile` interface and `SystemFacts` above `export type OnboardingDemoKind`.
   - Add `getSystemProfile?: () => Promise<SystemFacts>;` after the `onOnboardingDemoEvent?` member (line 701). `getTotalMemory?` is Plan 03's member; do not add another.

5. In `docs/PRIVACY.md`, append this bullet to `## Content and retention`:

   ```markdown
   - Setup reads your system languages, total memory, free disk space and graphics hardware to recommend a voice model. These values are read on your device, shown to you on the Voice step, and are not stored or sent anywhere.
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/systemProfile.test.js test/helpers/preloadOnboardingBridge.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/systemProfile.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts docs/PRIVACY.md test/helpers/systemProfile.test.js test/helpers/preloadOnboardingBridge.test.js
git commit -m "feat(onboarding): read OS languages, free space and GPU for voice detection"
```

---

### Task 3: Detected voice pick

Covers ONB-R3 C under D8.

**Files:**
- Create: `src/utils/onboardingDetection.ts`
- Test: `test/utils/onboardingDetection.test.js`

**Interfaces:**
- Consumes `ONBOARDING_SPEECH_MODELS`, `DEFAULT_ONBOARDING_SPEECH_MODEL_ID` and `supportsSpeechLanguage` (`src/utils/onboardingSpeechModels.ts:4-18`), and `SystemProfile` from Task 2.
- Produces:

  ```ts
  export type VoiceOutcome = "fastEnglish" | "manyLanguages" | "liveCaptions" | "liveMultilingual";
  export type VoiceReason =
    | { kind: "english" }
    | { kind: "language"; language: string }
    | { kind: "multilingual"; languages: string[] }
    | { kind: "unsupported"; language: string };
  export interface VoicePick {
    modelId: string | null;
    outcome: VoiceOutcome | null;
    languages: string[];                     // base codes heard by modelId, in OS order; [] if no voice
    reason: VoiceReason;
    disk: { neededBytes: number; freeBytes: number } | null; // set only when short
  }
  export const DISK_HEADROOM: 2.5;           // parakeet.js needs size × 2.5 to download and extract
  export function outcomeFor(modelId: string): VoiceOutcome | null;
  export function modelDownloadBytes(modelId: string): number | null; // sizeMb × 1e6
  export function baseLanguages(locales: readonly string[]): string[];
  export function detectVoice(profile: Pick<SystemProfile, "locales" | "freeDiskBytes">): VoicePick;
  export function shouldApplyDetectedVoice(storedParakeetModel: string | null): boolean;
  export function isOnboardingVoice(modelId: string | null | undefined): modelId is string;  // in the onboarding catalog
  export function voiceSupportsAll(modelId: string, languages: readonly string[]): boolean;   // BCP 47 or base codes
  export function reconcileVoice(modelId: string | null, languages: readonly string[]): { modelId: string | null; changed: boolean };
  export function spokenLocalesFor(locales: readonly string[], languages: readonly string[]): string[];
  ```

  `reconcileVoice` is the only way the Voice step changes a model after a language change (I03):
  - it keeps a model that hears every language;
  - otherwise it picks the catalog's first voice that does, preferring offline voices;
  - otherwise it returns `null`.

- [ ] **Step 1: Write the failing test**

Create `test/utils/onboardingDetection.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingDetection.ts");
const plenty = 500e9;

test("an English Mac gets the fast English voice", async () => {
  const { detectVoice } = await load();
  for (const locales of [["en-US"], ["en-GB", "en-US"], []]) {
    const pick = detectVoice({ locales, freeDiskBytes: plenty });
    assert.equal(pick.modelId, "parakeet-unified-en-0.6b", JSON.stringify(locales));
    assert.equal(pick.outcome, "fastEnglish");
    assert.deepEqual(pick.reason, { kind: "english" });
    assert.equal(pick.disk, null);
  }
});

test("two languages pick one offline voice that hears both", async () => {
  const { detectVoice } = await load();
  const pick = detectVoice({ locales: ["es-ES", "en-US"], freeDiskBytes: plenty });
  assert.equal(pick.modelId, "orukeet-v0.1.0");
  assert.equal(pick.outcome, "manyLanguages");
  assert.deepEqual(pick.reason, { kind: "multilingual", languages: ["es", "en"] });
  assert.equal(detectVoice({ locales: ["pt-BR", "en-US"], freeDiskBytes: plenty }).modelId, "orukeet-v0.1.0");
});

test("Japanese never gets an English-only voice", async () => {
  const { detectVoice } = await load();
  const solo = detectVoice({ locales: ["ja-JP"], freeDiskBytes: plenty });
  assert.equal(solo.modelId, "nemotron-3.5-asr-streaming-0.6b");
  assert.deepEqual(solo.reason, { kind: "language", language: "ja" });
  const mixed = detectVoice({ locales: ["ja-JP", "en-US"], freeDiskBytes: plenty });
  assert.equal(mixed.modelId, "nemotron-3.5-asr-streaming-0.6b");
  assert.deepEqual(mixed.reason, { kind: "multilingual", languages: ["ja", "en"] });
  assert.equal(detectVoice({ locales: ["de-DE", "ja-JP"], freeDiskBytes: plenty }).modelId, "nemotron-3.5-asr-streaming-0.6b");
});

test("an unsupported language is said out loud, with no model guessed", async () => {
  const { detectVoice, spokenLocalesFor, voiceSupportsAll } = await load();
  for (const [locales, language] of [[["he-IL"], "he"], [["zh-Hant-TW"], "zh"]]) {
    const pick = detectVoice({ locales, freeDiskBytes: plenty });
    assert.equal(pick.modelId, null);
    assert.equal(pick.outcome, null);
    assert.deepEqual(pick.languages, [], "no compatible voice means no detected spoken languages");
    assert.deepEqual(pick.reason, { kind: "unsupported", language });
  }
  const partial = detectVoice({ locales: ["he-IL", "fr-FR"], freeDiskBytes: plenty });
  assert.equal(partial.modelId, "orukeet-v0.1.0", "a supported second language still gets a voice");
  assert.deepEqual(partial.reason, { kind: "language", language: "fr" });
  assert.deepEqual(partial.languages, ["fr"]);
  const spoken = spokenLocalesFor(["he-IL", "fr-FR"], partial.languages);
  assert.deepEqual(spoken, ["fr-FR"], "unsupported OS locales never become spoken languages");
  assert.equal(voiceSupportsAll(partial.modelId, spoken), true, "the detected fallback is committable");
});

test("disk is flagged when free space is under 2.5 times the download", async () => {
  const { detectVoice, modelDownloadBytes } = await load();
  assert.equal(modelDownloadBytes("parakeet-unified-en-0.6b"), 631_000_000);
  const short = detectVoice({ locales: ["en-US"], freeDiskBytes: 412_000_000 });
  assert.deepEqual(short.disk, { neededBytes: 1_577_500_000, freeBytes: 412_000_000 });
  assert.equal(short.modelId, "parakeet-unified-en-0.6b", "the pick stays; main is the authority on space");
  assert.equal(detectVoice({ locales: ["en-US"], freeDiskBytes: null }).disk, null);
});

test("base languages ignore junk and keep OS order", async () => {
  const { baseLanguages } = await load();
  assert.deepEqual(baseLanguages(["en_US", "EN-gb", "", "1234", "fil-PH", "de"]), ["en", "fil", "de"]);
  assert.deepEqual(baseLanguages([]), ["en"]);
});

test("detection applies only until the user has chosen a voice", async () => {
  const { shouldApplyDetectedVoice } = await load();
  assert.equal(shouldApplyDetectedVoice(null), true);
  assert.equal(shouldApplyDetectedVoice("orukeet-v0.1.0"), false);
});

test("a language change keeps, replaces or clears the voice; never an incompatible one", async () => {
  const { reconcileVoice, voiceSupportsAll } = await load();
  assert.deepEqual(reconcileVoice("orukeet-v0.1.0", ["de-DE"]), { modelId: "orukeet-v0.1.0", changed: false });
  assert.deepEqual(reconcileVoice("parakeet-unified-en-0.6b", ["ja-JP"]), {
    modelId: "nemotron-3.5-asr-streaming-0.6b",
    changed: true,
  });
  assert.deepEqual(reconcileVoice("parakeet-unified-en-0.6b", ["he-IL"]), { modelId: null, changed: true });
  assert.deepEqual(reconcileVoice(null, ["es-ES", "en-US"]), { modelId: "orukeet-v0.1.0", changed: true });
  assert.equal(voiceSupportsAll("parakeet-unified-en-0.6b", ["en-US", "ja-JP"]), false);
  assert.equal(voiceSupportsAll("nemotron-3.5-asr-streaming-0.6b", ["en-US", "ja-JP"]), true);
  assert.equal(voiceSupportsAll("nemotron-3.5-asr-streaming-0.6b", []), false, "no languages is not a match");
});

test("only catalog voices count as an explicit onboarding choice", async () => {
  const { isOnboardingVoice } = await load();
  assert.equal(isOnboardingVoice("orukeet-v0.1.0"), true);
  assert.equal(isOnboardingVoice("cohere-transcribe-03-2026"), false, "a Settings-only model is not reused by setup");
  assert.equal(isOnboardingVoice(null), false);
});

test("spoken languages keep the OS's full locale tags for the voice's languages", async () => {
  const { spokenLocalesFor } = await load();
  assert.deepEqual(spokenLocalesFor(["es-ES", "en-US", "he-IL"], ["es", "en"]), ["es-ES", "en-US"]);
  assert.deepEqual(spokenLocalesFor([], ["en"]), ["en"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/utils/onboardingDetection.test.js`
Expected: FAIL with `Cannot find module '../../src/utils/onboardingDetection.ts'`.

- [ ] **Step 3: Implement**

Create `src/utils/onboardingDetection.ts`:

```ts
import type { SystemProfile } from "../types/electron";
import {
  DEFAULT_ONBOARDING_SPEECH_MODEL_ID,
  ONBOARDING_SPEECH_MODELS,
  supportsSpeechLanguage,
} from "./onboardingSpeechModels";

// "Detected for you" (ONB-R3 C) reads the OS languages and free disk space only
// (spec D8). It never listens to the user to guess a language.
export type VoiceOutcome = "fastEnglish" | "manyLanguages" | "liveCaptions" | "liveMultilingual";

export type VoiceReason =
  | { kind: "english" }
  | { kind: "language"; language: string }
  | { kind: "multilingual"; languages: string[] }
  | { kind: "unsupported"; language: string };

export interface VoicePick {
  modelId: string | null;
  outcome: VoiceOutcome | null;
  languages: string[]; // only languages heard by modelId, in OS order; [] if no voice
  reason: VoiceReason;
  disk: { neededBytes: number; freeBytes: number } | null;
}

/** parakeet.js refuses to start unless free space is at least size × 2.5. */
export const DISK_HEADROOM = 2.5;

const OUTCOME_BY_MODEL: Record<string, VoiceOutcome> = {
  "parakeet-unified-en-0.6b": "fastEnglish",
  "orukeet-v0.1.0": "manyLanguages",
  "parakeet-tdt-0.6b-v3": "manyLanguages",
  "nemotron-speech-streaming-en-0.6b": "liveCaptions",
  "nemotron-3.5-asr-streaming-0.6b": "liveMultilingual",
};

export function outcomeFor(modelId: string): VoiceOutcome | null {
  return OUTCOME_BY_MODEL[modelId] ?? null;
}

export function modelDownloadBytes(modelId: string): number | null {
  const model = ONBOARDING_SPEECH_MODELS.find((entry) => entry.id === modelId);
  return model ? Math.round(model.sizeMb * 1_000_000) : null;
}

export function baseLanguages(locales: readonly string[]): string[] {
  const out: string[] = [];
  for (const locale of locales) {
    const base = String(locale).trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
    if (/^[a-z]{2,3}$/.test(base) && !out.includes(base)) out.push(base);
  }
  return out.length > 0 ? out : ["en"];
}

const supportsAll = (modelId: string, languages: readonly string[]) =>
  languages.every((language) => supportsSpeechLanguage(modelId, language));

function chooseModel(languages: readonly string[]): { modelId: string | null; reason: VoiceReason } {
  const supported = languages.filter((language) =>
    ONBOARDING_SPEECH_MODELS.some((model) => supportsSpeechLanguage(model.id, language))
  );
  if (supported.length === 0) return { modelId: null, reason: { kind: "unsupported", language: languages[0] } };
  if (supported.every((language) => language === "en")) {
    return { modelId: DEFAULT_ONBOARDING_SPEECH_MODEL_ID, reason: { kind: "english" } };
  }
  // Prefer an offline (non-streaming) voice that hears every language, then any
  // voice that does, then the first voice for the primary language.
  const everyLanguage =
    ONBOARDING_SPEECH_MODELS.find((model) => model.runtime !== "online" && supportsAll(model.id, supported)) ??
    ONBOARDING_SPEECH_MODELS.find((model) => supportsAll(model.id, supported));
  if (everyLanguage && supported.length > 1) {
    return { modelId: everyLanguage.id, reason: { kind: "multilingual", languages: supported } };
  }
  const primary = supported[0];
  const forPrimary =
    everyLanguage ?? ONBOARDING_SPEECH_MODELS.find((model) => supportsSpeechLanguage(model.id, primary));
  return { modelId: forPrimary?.id ?? null, reason: { kind: "language", language: primary } };
}

export function detectVoice(profile: Pick<SystemProfile, "locales" | "freeDiskBytes">): VoicePick {
  const languages = baseLanguages(profile.locales);
  const { modelId, reason } = chooseModel(languages);
  const size = modelId ? modelDownloadBytes(modelId) : null;
  const neededBytes = size === null ? null : Math.round(size * DISK_HEADROOM);
  const free = profile.freeDiskBytes;
  return {
    modelId,
    outcome: modelId ? outcomeFor(modelId) : null,
    languages: modelId ? languages.filter((language) => supportsSpeechLanguage(modelId, language)) : [],
    reason,
    disk: neededBytes !== null && free !== null && free < neededBytes ? { neededBytes, freeBytes: free } : null,
  };
}

/**
 * `parakeetModel` has a stored default, so a fresh profile is recognised by the
 * absence of an explicit localStorage value, not by the store's value.
 */
export function shouldApplyDetectedVoice(storedParakeetModel: string | null): boolean {
  return storedParakeetModel === null;
}

export function isOnboardingVoice(modelId: string | null | undefined): modelId is string {
  return typeof modelId === "string" && ONBOARDING_SPEECH_MODELS.some((entry) => entry.id === modelId);
}

export function voiceSupportsAll(modelId: string, languages: readonly string[]): boolean {
  return languages.length > 0 && languages.every((language) => supportsSpeechLanguage(modelId, language));
}

/** I03: after a language change, keep a voice that hears it, else replace or clear. */
export function reconcileVoice(
  modelId: string | null,
  languages: readonly string[]
): { modelId: string | null; changed: boolean } {
  if (modelId && voiceSupportsAll(modelId, languages)) return { modelId, changed: false };
  const replacement =
    ONBOARDING_SPEECH_MODELS.find((model) => model.runtime !== "online" && voiceSupportsAll(model.id, languages)) ??
    ONBOARDING_SPEECH_MODELS.find((model) => voiceSupportsAll(model.id, languages));
  return { modelId: replacement?.id ?? null, changed: (replacement?.id ?? null) !== modelId };
}

/** The OS locale tags behind the picked languages, for settings' spokenLanguages. */
export function spokenLocalesFor(locales: readonly string[], languages: readonly string[]): string[] {
  const matched = locales.filter((locale) => languages.includes(baseLanguages([locale])[0]));
  return matched.length > 0 ? [...new Set(matched)] : [...languages];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/utils/onboardingDetection.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingDetection.ts test/utils/onboardingDetection.test.js
git commit -m "feat(onboarding): pick and reconcile a voice from OS languages and free space"
```

---

### Task 4: Onboarding demo bridge v2

The bridge gains a shortcut demo, the `cancelled` and `cancelClosed` statuses, live hotkey presses, and trial toggle, cancel and undo. Covers the main-process half of ONB-R5 C and ONB-R7 B, and Plan 05's side of the §5.2 Undo bridge. The bridge's cancelled *fields* (`sessionId`, `cancelled: CancelledState`, `reason`) are Plan 04's; Task 22 wires them once both plans have merged.

**Files:**
- Modify: `src/helpers/onboardingInputPolicy.js`. Edit it to the shape below. If Plan 04 has merged, the file already has `cancelClosed` and `sanitizeCancelledDemoFields`: keep both (Task 22 spreads the sanitiser).
- Modify: `src/helpers/ipcHandlers.js`. Touch the import on line 54, `onboarding-demo-publish` (1059-1079), and add the new handlers after `onboarding-demo-stop` (1054-1057).
- Modify: `src/helpers/windowManager.js`:
  - the import on line 44;
  - `createHotkeyCallback` (580-604);
  - add new methods after `stopOnboardingDemoRecording` (1617-1622).
- Modify: `main.js`. Touch the `globe-down` handler (899-911), `globe-up` (966-972), `right-modifier-down` (1034), `right-modifier-up` (1070), `dispatchNativeKeyDown` (≈1266) and `dispatchNativeKeyUp` (≈1283).
- Modify: `preload.js`. Add after the `getSystemProfile` line from Task 2.
- Modify: `src/types/electron.ts`. Touch lines 651-668 and the API members after 701.
- Test: append to `test/helpers/onboardingInputPolicy.test.js` and to `test/helpers/preloadOnboardingBridge.test.js`.

**Interfaces:**
- Produces in `src/helpers/onboardingInputPolicy.js`:
  - `ONBOARDING_DEMO_KINDS` gains `"shortcut"`.
  - `ONBOARDING_DEMO_STATUSES` gains `"cancelled"` and `"cancelClosed"` (§5.2).
  - `shouldReportDictationHotkey(onboardingActive: boolean, demoKind: string | null): boolean`
  - `sanitizeOnboardingDemoEvent(event, session): OnboardingDemoEvent | null`
  - `admitDemoEvent(session: { sawListening?: boolean }, status: string): boolean`. A session admits nothing until its own `listening` arrives, so a late result from a take that began before the session (or in a previous one) never reaches setup (round 1, ONB-06).
  - `trackCancelledDemo(holder, payload): void` keeps `holder.lastCancelledDictation` (§5.2) in step with the published events: `cancelled` with a `sessionId` sets it, and `cancelClosed` for that same session clears it.
  - `publishDemoEvent(event, session, holder): OnboardingDemoEvent | null` sanitises, admits and tracks in that order. It is the publish handler's whole body, in either merge order (R2-I02).
- Produces these `WindowManager` methods:
  - `reportDictationHotkey(phase: "down" | "up" | "tap"): boolean`
  - `toggleOnboardingDemoRecording(): boolean`
  - `cancelOnboardingDemoRecording(): boolean`
  - `undoOnboardingDemoCancel(): Promise<boolean>`. Per §5.2 it calls Plan 04's `sendUndoCancelDictation(this.lastCancelledDictation?.sessionId)` and returns `result.restored`. Until Plan 04 merges, the method does not exist and this returns `false`.
  - `_cancelOnboardingTake()`. It cancels preparation, recording *and* processing (`cancel-dictation-preparation` plus `cancel-dictation`). `endOnboardingDemo` and `cancelOnboardingDemoRecording` use it. Today's `sendCancelDictation()` only cancels a recording (`src/App.jsx:364-369`), so leaving mid-processing let the take finish.
- Produces these IPC channels:
  - `onboarding-demo-toggle`, `onboarding-demo-cancel`, `onboarding-demo-undo-cancel`. Each takes the demo id.
  - The `dictation-hotkey-event` broadcast to the control panel, with payload `{ phase, at }`.
- Produces, in `src/types/electron.ts`:

  ```ts
  export type OnboardingDemoKind = "dictation" | "assistant" | "shortcut";
  // OnboardingDemoStatus adds "cancelled" | "cancelClosed"; OnboardingDemoEvent adds:
  //   rawText?: string; code?: string; cleanup?: "applied" | "skipped" | "failed";
  // The §5.2 cancelled fields (sessionId, cancelled: CancelledState, reason) come from
  // src/types/dictation.ts (Plan 04) and are added by Task 22, not restated here.
  export interface DictationHotkeyEvent { phase: "down" | "up" | "tap"; at: number }
  toggleOnboardingDemo?: (id: string) => Promise<boolean>;
  cancelOnboardingDemo?: (id: string) => Promise<boolean>;
  undoOnboardingDemoCancel?: (id: string) => Promise<boolean>;
  onDictationHotkeyEvent?: (callback: (event: DictationHotkeyEvent) => void) => () => void;
  ```

- [ ] **Step 1: Write the failing tests**

Change the require at the top of `test/helpers/onboardingInputPolicy.test.js` to:

```js
const {
  ONBOARDING_DEMO_KINDS,
  ONBOARDING_DEMO_STATUSES,
  admitDemoEvent,
  isOnboardingInputAllowed,
  publishDemoEvent,
  sanitizeOnboardingDemoEvent,
  shouldReportDictationHotkey,
  trackCancelledDemo,
} = require("../../src/helpers/onboardingInputPolicy");
```

Then append:

```js
test("a shortcut demo observes presses but never starts a recording", () => {
  assert.ok(ONBOARDING_DEMO_KINDS.has("shortcut"));
  for (const input of ["dictation", "assistant", "translation", "agent"]) {
    assert.equal(isOnboardingInputAllowed(true, "shortcut", input), false, input);
  }
  assert.equal(shouldReportDictationHotkey(true, "shortcut"), true);
  assert.equal(shouldReportDictationHotkey(true, "dictation"), true);
  assert.equal(shouldReportDictationHotkey(true, "assistant"), false);
  assert.equal(shouldReportDictationHotkey(true, null), false);
  assert.equal(shouldReportDictationHotkey(false, "dictation"), false, "after setup, presses stay private");
});

test("the cancelled and cancelClosed states can reach the setup window (§5.2)", () => {
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelled"));
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelClosed"));
});

test("a session admits nothing until its own take starts listening", () => {
  const session = { id: "demo-2", kind: "dictation" };
  assert.equal(admitDemoEvent(session, "success"), false, "a late result from an earlier take is dropped");
  assert.equal(admitDemoEvent(session, "level"), false);
  assert.equal(admitDemoEvent(session, "listening"), true);
  assert.equal(admitDemoEvent(session, "success"), true);
  assert.equal(admitDemoEvent({ id: "demo-3", kind: "shortcut" }, "error"), false);
});

test("main tracks the open cancel window by session, and only that session closes it (§5.2)", () => {
  const holder = { lastCancelledDictation: null };
  trackCancelledDemo(holder, { status: "cancelled" });
  assert.equal(holder.lastCancelledDictation, null, "the pre-Plan-04 fallback carries no session");
  trackCancelledDemo(holder, { status: "cancelled", sessionId: "rec-1" });
  assert.deepEqual(holder.lastCancelledDictation, { sessionId: "rec-1" });
  trackCancelledDemo(holder, { status: "cancelClosed", sessionId: "rec-0", reason: "expired" });
  assert.deepEqual(holder.lastCancelledDictation, { sessionId: "rec-1" }, "a stale close cannot clear a newer window");
  trackCancelledDemo(holder, { status: "cancelClosed", sessionId: "rec-1", reason: "restored" });
  assert.equal(holder.lastCancelledDictation, null);
});

test("publishing sanitises, admits, then tracks; a rejected event changes nothing", () => {
  const holder = { lastCancelledDictation: { sessionId: "keep" } };
  const session = { id: "demo-1", kind: "dictation" };
  assert.equal(publishDemoEvent({ kind: "dictation", status: "cancelled", sessionId: "rec-9" }, session, holder), null, "not admitted before listening");
  assert.deepEqual(holder.lastCancelledDictation, { sessionId: "keep" });
  assert.equal(publishDemoEvent({ kind: "dictation", status: "listening" }, session, holder).status, "listening");
});

test("the publish sanitizer keeps trial fields, clamps them, and drops everything else", () => {
  const session = { id: "demo-1", kind: "dictation" };
  const out = sanitizeOnboardingDemoEvent(
    {
      kind: "dictation",
      status: "success",
      text: "Hi",
      rawText: "um hi",
      cleanup: "applied",
      code: "X".repeat(100),
      level: 3,
      demoId: "spoofed",
      secret: "nope",
    },
    session
  );
  assert.deepEqual(out, {
    demoId: "demo-1",
    kind: "dictation",
    status: "success",
    text: "Hi",
    rawText: "um hi",
    message: undefined,
    code: "X".repeat(64),
    tool: undefined,
    level: 1,
    cleanup: "applied",
  });
  assert.equal(sanitizeOnboardingDemoEvent({ kind: "assistant", status: "success" }, session), null);
  assert.equal(sanitizeOnboardingDemoEvent({ kind: "dictation", status: "done" }, session), null);
  assert.equal(sanitizeOnboardingDemoEvent({ kind: "dictation", status: "success" }, null), null);
  const odd = sanitizeOnboardingDemoEvent(
    { kind: "dictation", status: "cancelled", cleanup: "maybe", undoUntil: 1700, remoteAlreadySent: "OpenAI", level: Number.NaN },
    session
  );
  assert.equal(odd.cleanup, undefined);
  assert.equal(odd.level, undefined);
  assert.equal("undoUntil" in odd, false, "the retired pair never passes; §5.2 uses cancelled: CancelledState");
  assert.equal("remoteAlreadySent" in odd, false);
});
```

Append to `test/helpers/preloadOnboardingBridge.test.js`:

```js
test("trial controls invoke only their channels with the demo id", async () => {
  const { api, invocations } = loadPreloadApi();
  await api.toggleOnboardingDemo("demo-7");
  await api.cancelOnboardingDemo("demo-7");
  await api.undoOnboardingDemoCancel("demo-7");
  assert.deepEqual(invocations, [
    ["onboarding-demo-toggle", "demo-7"],
    ["onboarding-demo-cancel", "demo-7"],
    ["onboarding-demo-undo-cancel", "demo-7"],
  ]);
});

test("hotkey listener strips the Electron event and disposes cleanly", () => {
  const { api, listeners } = loadPreloadApi();
  const payload = { phase: "down", at: 5 };
  let received;
  const unsubscribe = api.onDictationHotkeyEvent((event) => {
    received = event;
  });
  listeners.get("dictation-hotkey-event")?.({ sender: "ipc" }, payload);
  assert.equal(received, payload);
  unsubscribe();
  assert.equal(listeners.has("dictation-hotkey-event"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/onboardingInputPolicy.test.js test/helpers/preloadOnboardingBridge.test.js`
Expected: FAIL. `sanitizeOnboardingDemoEvent is not a function`, `"shortcut"` is missing, and `api.toggleOnboardingDemo is not a function`.

- [ ] **Step 3: Implement**

1. Replace `src/helpers/onboardingInputPolicy.js` with:

   ```js
   const ONBOARDING_DEMO_KINDS = new Set(["dictation", "assistant", "shortcut"]);
   const ONBOARDING_DEMO_STATUSES = new Set([
     "listening",
     "level",
     "processing",
     "partial",
     "replying",
     "success",
     "error",
     "cancelled",
     "cancelClosed",
   ]);
   const DEMO_CLEANUP_OUTCOMES = new Set(["applied", "skipped", "failed"]);

   // A "shortcut" demo never equals a recording input kind, so while it runs the
   // shortcut's presses are mirrored to setup (shouldReportDictationHotkey) but
   // never start a dictation.
   function isOnboardingInputAllowed(onboardingActive, demoKind, inputKind) {
     if (!onboardingActive) return true;
     return ONBOARDING_DEMO_KINDS.has(demoKind) && demoKind === inputKind;
   }

   function shouldReportDictationHotkey(onboardingActive, demoKind) {
     return onboardingActive === true && (demoKind === "dictation" || demoKind === "shortcut");
   }

   const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);

   // The overlay publishes; every window receives. Only allowlisted fields of the
   // current session's kind pass, and the id always comes from main's session.
   function sanitizeOnboardingDemoEvent(event, session) {
     if (!session || !event || event.kind !== session.kind) return null;
     if (!ONBOARDING_DEMO_STATUSES.has(event.status)) return null;
     return {
       demoId: session.id,
       kind: session.kind,
       status: event.status,
       text: clip(event.text, 20000),
       rawText: clip(event.rawText, 20000),
       message: clip(event.message, 500),
       code: clip(event.code, 64),
       tool: clip(event.tool, 64),
       level: Number.isFinite(event.level) ? Math.min(1, Math.max(0, event.level)) : undefined,
       cleanup: DEMO_CLEANUP_OUTCOMES.has(event.cleanup) ? event.cleanup : undefined,
       // Plan 04 (§5.2): ...sanitizeCancelledDemoFields(event),
       // Add that line now if Plan 04 has merged; otherwise Task 22 adds it.
     };
   }

   // §5.2 bookkeeping for Plan 04's bridge: Undo asks the overlay for exactly this session.
   function trackCancelledDemo(holder, payload) {
     if (!holder || !payload?.sessionId) return;
     if (payload.status === "cancelled") {
       holder.lastCancelledDictation = { sessionId: payload.sessionId };
     } else if (payload.status === "cancelClosed" && holder.lastCancelledDictation?.sessionId === payload.sessionId) {
       holder.lastCancelledDictation = null;
     }
   }

   // The publish handler's whole body. One path in both merge orders (R2-I02).
   function publishDemoEvent(event, session, holder) {
     const payload = sanitizeOnboardingDemoEvent(event, session);
     if (!payload || !admitDemoEvent(session, payload.status)) return null;
     trackCancelledDemo(holder, payload);
     return payload;
   }

   // Correlation without ids from the overlay: a session starts closed and opens
   // on its first "listening". Ending a demo cancels its take (Task 4 step 3), so
   // a result that still arrives belongs to a take this session never started.
   function admitDemoEvent(session, status) {
     if (!session) return false;
     if (status === "listening") {
       session.sawListening = true;
       return true;
     }
     return session.sawListening === true;
   }

   module.exports = {
     ONBOARDING_DEMO_KINDS,
     ONBOARDING_DEMO_STATUSES,
     admitDemoEvent,
     isOnboardingInputAllowed,
     publishDemoEvent,
     sanitizeOnboardingDemoEvent,
     shouldReportDictationHotkey,
     trackCancelledDemo,
   };
   ```

2. Change line 54 of `src/helpers/ipcHandlers.js` to:

   ```js
   const { ONBOARDING_DEMO_KINDS, publishDemoEvent } = require("./onboardingInputPolicy");
   ```

   Then make two edits in the same file:
   - Replace the body of `onboarding-demo-publish` (1059-1079) with:

     ```js
         ipcMain.handle("onboarding-demo-publish", (_event, event) => {
           const payload = publishDemoEvent(event, this._onboardingDemoSession, this.windowManager);
           if (!payload) return false;
           broadcastToWindows("onboarding-demo-event", payload);
           return true;
         });
     ```

     If `ONBOARDING_DEMO_STATUSES` is no longer referenced in this file, it was used only by the old publish body, so leave it out of the import.

     **If Plan 04 merged first,** this body replaces Plan 04's, including its two inline `lastCancelledDictation` lines. That bookkeeping now lives in `trackCancelledDemo`, which `publishDemoEvent` calls, so do not keep both. Keep Plan 04's `sanitizeCancelledDemoFields` spread inside `sanitizeOnboardingDemoEvent` (the marked line above).

   - After `onboarding-demo-stop`, add:

     ```js
         // The setup window drives the overlay's real recorder: the same path the
         // global shortcut takes, so "Use a button instead" and the hotkey share one
         // trial-mode recording (Task 5) and one event stream.
         const isCurrentDemo = (id) => this._onboardingDemoSession?.id === id;
         ipcMain.handle("onboarding-demo-toggle", (_event, id) =>
           isCurrentDemo(id) ? this.windowManager.toggleOnboardingDemoRecording() : false
         );
         ipcMain.handle("onboarding-demo-cancel", (_event, id) =>
           isCurrentDemo(id) ? this.windowManager.cancelOnboardingDemoRecording() : false
         );
         ipcMain.handle("onboarding-demo-undo-cancel", (_event, id) =>
           isCurrentDemo(id) ? this.windowManager.undoOnboardingDemoCancel() : false
         );
     ```

3. In `src/helpers/windowManager.js`, make three edits:
   - Change line 44 to:

     ```js
     const {
       ONBOARDING_DEMO_KINDS,
       isOnboardingInputAllowed,
       shouldReportDictationHotkey,
     } = require("./onboardingInputPolicy");
     ```

   - In `createHotkeyCallback`, insert this directly after the `isInListeningMode()` early return:

     ```js
           this.reportDictationHotkey(phase === "down" || phase === "up" ? phase : "tap");
     ```

   - After `stopOnboardingDemoRecording()`, add:

     ```js
       /** Mirrors a dictation-shortcut press to setup while a dictation or shortcut demo runs. */
       reportDictationHotkey(phase) {
         if (!shouldReportDictationHotkey(this._onboardingActive, this._onboardingDemoKind)) return false;
         const target = this.controlPanelWindow;
         if (!target || target.isDestroyed()) return false;
         target.webContents.send("dictation-hotkey-event", { phase, at: Date.now() });
         return true;
       }

       toggleOnboardingDemoRecording() {
         if (this._onboardingDemoKind !== "dictation") return false;
         this.sendToggleDictation();
         return true;
       }

       cancelOnboardingDemoRecording() {
         if (this._onboardingDemoKind !== "dictation") return false;
         this._cancelOnboardingTake();
         return true;
       }

       // Preparation, recording and processing: a trial take must not finish after
       // the user cancels or leaves the step.
       _cancelOnboardingTake() {
         this.sendCancelDictationPreparation();
         this.sendCancelActiveDictation();
       }

       // Spec §5.2: the bridge is Plan 04's. Before it merges there is no
       // sendUndoCancelDictation, and setup shows "Discarded." with no Undo.
       async undoOnboardingDemoCancel() {
         if (this._onboardingDemoKind !== "dictation") return false;
         if (typeof this.sendUndoCancelDictation !== "function") return false;
         const result = await this.sendUndoCancelDictation(this.lastCancelledDictation?.sessionId);
         return result?.restored === true;
       }
     ```

   - In `endOnboardingDemo()` (1624-1635), replace `this.sendCancelDictation();` with `this._cancelOnboardingTake();`. `beginOnboardingDemo` keeps its silent `sendCancelDictation()`, because nothing from a new session has started yet.

4. In `main.js`, report the presses that bypass `createHotkeyCallback`. `reportDictationHotkey` gates itself, so these calls are no-ops outside a setup demo.
   - `globe-down`: directly after the `globe-key-pressed` forward block (ending at line 911), add:

     ```js
           if (hotkeyManager.getSlotHotkeys("dictation").some(isGlobeLikeHotkey)) {
             windowManager.reportDictationHotkey("down");
           }
     ```

   - `globe-up`: the same block with `"up"`, after the `globe-key-released` forward (ending at line 972).
   - `right-modifier-down` and `right-modifier-up`: add this as the first statement of each handler, using `"down"` and `"up"`:

     ```js
           if (hotkeyManager.slotHasHotkey("dictation", modifier)) windowManager.reportDictationHotkey("down");
     ```

   - `dispatchNativeKeyDown`: inside `if (hotkeyManager.slotHasHotkey("dictation", key)) {`, add `windowManager.reportDictationHotkey("down");` as the first line.
   - `dispatchNativeKeyUp`: after its slot early return, add `windowManager.reportDictationHotkey("up");`.

   A press can arrive from two sources, for example a native listener and `globalShortcut` for the same key. Setup's keycap reducer treats a repeated `down` as one press (Task 17).

5. In `preload.js`, after `getSystemProfile`, add:

   ```js
     toggleOnboardingDemo: (id) => ipcRenderer.invoke("onboarding-demo-toggle", id),
     cancelOnboardingDemo: (id) => ipcRenderer.invoke("onboarding-demo-cancel", id),
     undoOnboardingDemoCancel: (id) => ipcRenderer.invoke("onboarding-demo-undo-cancel", id),
     onDictationHotkeyEvent: registerListener(
       "dictation-hotkey-event",
       (callback) => (_event, payload) => callback(payload)
     ),
   ```

6. In `src/types/electron.ts`, make three changes:
   - Widen `OnboardingDemoKind` and `OnboardingDemoStatus`.
   - Add the three optional fields to `OnboardingDemoEvent`, add `DictationHotkeyEvent`, and add the four API members, all exactly as listed under Interfaces.
   - `getOnboardingDemoKind` (`src/utils/onboardingDemo.ts:3`) keeps returning `"assistant" | "dictation"`. Annotate its return type as `Exclude<OnboardingDemoKind, "shortcut">` if typecheck complains.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/onboardingInputPolicy.test.js test/helpers/preloadOnboardingBridge.test.js "test/helpers/windowManager*.test.js" && npm run typecheck`
Expected: PASS. The `windowManager*` suites run too, because they load the file.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/onboardingInputPolicy.js src/helpers/ipcHandlers.js src/helpers/windowManager.js main.js preload.js src/types/electron.ts test/helpers/onboardingInputPolicy.test.js test/helpers/preloadOnboardingBridge.test.js
git commit -m "feat(onboarding): shortcut demo, cancel statuses, live hotkey presses and trial controls"
```

---

### Task 5: Private trial recordings never persist (C01)

Covers the privacy boundary (Review Focus 1), ONB-Q7 event payloads, and the empty-result path (round-1 ONB-07).

Today's trial gates only the successful-result save (`useAudioRecording.js:528-536`). `AudioManager` knows nothing about the trial, and three other writers stay open:
- **Discarded audio on cancel:** `cancelRecording` and `discardBatchRecording` (1605-1645) call `persistDiscardedBatchRecording` (1675-1711), which saves audio and a `discarded` history row when the global retention settings allow it (`src/helpers/discardedRecording.js`).
- **Failed takes:** 1903-1926 call `saveFailedTranscription` (3110-3164), which writes a `failed` row plus audio.
- **Plan 04's undo hold:** Plan 04 replaces `persistDiscardedBatchRecording` with an in-memory cancel hold that saves on window close (`_closeCancelled`, on expiry, replacement or the quit flush). Spec §5.2 makes "an expired private hold is never persisted, and a restore re-applies `private`" Plan 04's contract. This task's hold test checks it from either merge order.

**If Plan 04 merged first,** `takeDiscardedBatchSnapshot` and `persistDiscardedBatchRecording` no longer exist. Skip their guards and drop the three snapshot tests below ("a recording started during setup…", "after setup, the same discard…", "privacy belongs to the recording…"). The hold test then covers the cancel path. Every other guard in this task still applies.

The fix makes privacy a property of **each recording**. It is captured when the recording starts and carried with every artefact that can outlive it.

**Files:**
- Modify: `src/helpers/audioManager.js`:
  - beside `setCallbacks` (629): add `setPrivateSession`, `_captureRecordingPrivacy` and `releasePrivateAudio`;
  - the two `this.isRecording = true;` sites (1239 batch, 3579 streaming);
  - `takeDiscardedBatchSnapshot` (1648-1658) and `persistDiscardedBatchRecording` (1675);
  - the two `this.lastAudioBlob = …` assignments that carry audio (1447, 3935);
  - `saveTranscription` (3043) and `saveFailedTranscription` (3110).
- Modify: `src/hooks/useAudioRecording.js`:
  - after `new AudioManager()` (285);
  - the blank-result return (457-464);
  - the `onError` and `onNoAudio` demo events (382-387, 410-415);
  - the success demo event (507-511);
  - the trial branch of the success path (528-536);
  - `cancelRecording` and `cancelProcessing` (812-838).
- Create: `src/hooks/useSetupIncomplete.ts`
- Modify: `src/App.jsx` (the `useAudioRecording(…)` call at 209-215)
- Modify: `src/utils/onboardingDemo.ts`
- Test (create): `test/helpers/audioManagerPrivateTrial.test.js`, `test/helpers/useAudioRecordingTrialEvents.test.js`, `test/hooks/useSetupIncomplete.test.js`, `test/utils/onboardingDemo.test.js`

**Interfaces:**
- `AudioManager`:
  - `setPrivateSession(enabled: boolean): void` sets the policy for recordings that start afterwards.
  - `_captureRecordingPrivacy(): void` copies the policy onto the starting recording (`this._recordingPrivate`).
  - `releasePrivateAudio(): void` drops `lastAudioBlob` when it is private.
  - Discarded snapshots gain `private: boolean`.
  - `lastAudioBlobPrivate: boolean` sits beside `lastAudioBlob`.
  - `saveTranscription`, `saveFailedTranscription` and `persistDiscardedBatchRecording` write nothing for a private recording.
- `useAudioRecording`:
  - it calls `setPrivateSession(trialMode)` on every manager it builds;
  - blank results publish `{ status: "error", code: "NO_AUDIO" }`;
  - cancelling an active take publishes `{ status: "cancelled" }` with no fields: the §5.2 fallback, so setup says "Discarded." with no Undo. Plan 04's `onCancelledChange` publishes the full `{ status: "cancelled", sessionId, cancelled }` and `cancelClosed`; Task 22 deletes this fallback.
- `useSetupIncomplete(): boolean` and `isSetupIncomplete(storage?): boolean`. The latter fails closed.
- `onboardingDemo.ts`: `buildDemoSuccessEvent`, `demoCleanupOutcome`, `demoErrorCode`.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/audioManagerPrivateTrial.test.js`. It uses the real `AudioManager` through the shared harness, with every retention setting switched **on**:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadAudioManager } = require("./harness/audioManager");

const RETAIN_EVERYTHING = {
  dataRetentionEnabled: true,
  audioRetentionDays: 30,
  saveDiscardedTranscriptions: true,
};

async function load(t) {
  return loadAudioManager(t, {
    cachePrefix: "loqui-private-trial-test-",
    settingsKey: "__privateTrialSettings",
    settings: RETAIN_EVERYTHING,
  });
}

function recorder(AudioManager, overrides = {}) {
  return Object.assign(Object.create(AudioManager.prototype), {
    recordingStartTime: Date.now() - 3000,
    audioChunks: [new Blob(["audio"], { type: "audio/webm" })],
    _batchSegments: [],
    recordingMimeType: "audio/webm",
    lastAudioMetadata: null,
    translationRequested: false,
    mergeRecordedSegments: async (blobs) => blobs[0],
    ...overrides,
  });
}

async function flushBackground() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("a recording started during setup is private, and its discarded audio is never saved", async (t) => {
  const { AudioManager } = await load(t);
  const saved = [];
  const manager = recorder(AudioManager, { saveDiscardedTranscription: async (...args) => saved.push(args) });
  manager.setPrivateSession(true);
  manager._captureRecordingPrivacy();
  const snapshot = manager.takeDiscardedBatchSnapshot();
  assert.equal(snapshot.private, true);
  manager.persistDiscardedBatchRecording(snapshot);
  await flushBackground();
  assert.deepEqual(saved, [], "cancel or leaving the step writes nothing, even with discarded retention on");
});

test("after setup, the same discard is saved when the user's retention allows it", async (t) => {
  const { AudioManager } = await load(t);
  const saved = [];
  const manager = recorder(AudioManager, { saveDiscardedTranscription: async (...args) => saved.push(args) });
  manager.setPrivateSession(false);
  manager._captureRecordingPrivacy();
  manager.persistDiscardedBatchRecording(manager.takeDiscardedBatchSnapshot());
  await flushBackground();
  assert.equal(saved.length, 1, "the guard must not swallow normal recordings");
});

test("privacy belongs to the recording, not to the moment it is saved", async (t) => {
  const { AudioManager } = await load(t);
  const manager = recorder(AudioManager);
  manager.setPrivateSession(true);
  manager._captureRecordingPrivacy();
  const snapshot = manager.takeDiscardedBatchSnapshot();
  manager.setPrivateSession(false); // setup completes before the async save runs
  const saved = [];
  manager.saveDiscardedTranscription = async (...args) => saved.push(args);
  manager.persistDiscardedBatchRecording(snapshot);
  await flushBackground();
  assert.deepEqual(saved, []);
});

test("a failed private take writes no history row and no audio", async (t) => {
  const { AudioManager, window } = await load(t);
  const writes = [];
  window.electronAPI.saveTranscription = async (...args) => (writes.push(["row", ...args]), { id: 1 });
  window.electronAPI.saveTranscriptionAudio = async (...args) => (writes.push(["audio", ...args]), {});
  const manager = recorder(AudioManager);
  const stampPrivate = () => {
    const blob = new Blob(["audio"]);
    if (typeof manager._setOwnedAudio === "function") {
      manager._setOwnedAudio(blob, { sessionId: "private-trial", private: true });
    } else {
      manager.lastAudioBlob = blob;
      manager.lastAudioBlobPrivate = true;
    }
  };
  stampPrivate();
  await manager.saveFailedTranscription("boom", "NETWORK", {});
  // Each saver gets a private owned recording; do not test the second against the
  // first saver's already-released state. Delayed callbacks are Plan 04's race suite.
  stampPrivate();
  await manager.saveTranscription("hello", "hello", { sessionId: "private-trial" });
  assert.deepEqual(writes, []);
  assert.equal(manager.lastAudioBlob, null, "private audio does not linger in RAM either");
});

test("every recording start captures its privacy", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../src/helpers/audioManager.js"), "utf8");
  const starts = source.match(/this\.isRecording = true;/g) ?? [];
  const captured = source.match(/this\._captureRecordingPrivacy\(\);\s*\n\s*this\.isRecording = true;/g) ?? [];
  assert.ok(starts.length >= 2);
  assert.equal(captured.length, starts.length, "each `isRecording = true` is preceded by the capture");
  // Spec §5.2 "Audio ownership" (aad5284): once Plan 04's setter exists, it is the only
  // writer, and privacy rides its default. Before that, the bare stamp is required.
  const owned = /_setOwnedAudio\s*\(\s*blob/.test(source);
  if (owned) {
    assert.equal((source.match(/this\._setOwnedAudio\((audioBlob|fallbackBlob)\);/g) ?? []).length, 2, "both audio-carrying writes go through the setter");
    assert.ok((source.match(/this\._setOwnedAudio\(null\);/g) ?? []).length >= 2, "releasePrivateAudio and the conditional snapshot release use the setter");
    assert.ok((source.match(/this\._releaseOwnedAudio\(owned\)/g) ?? []).length >= 2, "both savers release their captured ownership snapshot");
    assert.doesNotMatch(source, /if\s*\(this\.lastAudioBlobPrivate\)\s*\{[^}]*return;/, "mutable saver entry guards are replaced by Plan 04's snapshot checks");
    const setter = source.slice(source.indexOf("_setOwnedAudio(blob"));
    const outside = source.replace(setter.slice(0, setter.indexOf("\n  }\n") + 4), "");
    assert.doesNotMatch(outside, /this\.lastAudioBlob(?:Private)?\s*=(?!=)/, "no bare write outside the setter");
  } else {
    const blobs = source.match(/this\.lastAudioBlob = (audioBlob|fallbackBlob);\s*\n\s*this\.lastAudioBlobPrivate = this\._recordingPrivate === true;/g) ?? [];
    assert.equal(blobs.length, 2, "both audio-carrying assignments record privacy");
  }
});

// Spec §5.2 (private holds, Plan 04's contract): Plan 04 replaces the immediate
// discard with a RAM hold that is saved when its window closes. An expired private
// hold is never persisted. Runs whenever the hold exists, so either merge order is
// checked; skips itself honestly before that. The seam is Plan 04's
// _closeCancelled(buffer, reason) (or _persistExpiredHold in older drafts); its
// buffer carries the recording's `private` flag.
test("an expired private undo hold saves nothing (either merge order)", async (t) => {
  const { AudioManager, window } = await load(t);
  const close = AudioManager.prototype._closeCancelled ?? AudioManager.prototype._persistExpiredHold;
  if (typeof close !== "function") {
    t.skip("Plan 04's undo hold is not merged yet");
    return;
  }
  const saved = [];
  window.electronAPI.saveTranscription = async (...args) => (saved.push(["row", ...args]), { id: 1 });
  window.electronAPI.saveTranscriptionAudio = async (...args) => (saved.push(["audio", ...args]), {});
  const manager = recorder(AudioManager, { saveDiscardedTranscription: async (...args) => saved.push(["discarded", ...args]) });
  manager.setPrivateSession(true);
  manager._captureRecordingPrivacy();
  const hold = {
    private: true,
    session: { id: "rec-private", settings: {}, intents: {}, routes: {} },
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 3,
    analyticsOccurredAt: new Date().toISOString(),
    bytes: () => [new Uint8Array([1, 2, 3])],
    ready: async () => {},
    zero() {},
    isZeroed: () => false,
  };
  await close.call(manager, hold, "expired");
  await flushBackground();
  assert.deepEqual(saved, [], "an expired private hold is never persisted (§5.2)");
});
```

Create `test/helpers/useAudioRecordingTrialEvents.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

// The fake records what the hook tells the manager and hands its callbacks back.
const FAKE_AUDIO_MANAGER_SOURCE = `
export const probe = { privateSession: [], released: 0, callbacks: null, state: {} };
export default class FakeAudioManager {
  setPrivateSession(value) { probe.privateSession.push(value); }
  releasePrivateAudio() { probe.released += 1; }
  setCallbacks(callbacks) { probe.callbacks = callbacks; }
  getState() { return probe.state; }
  cacheMicrophoneDeviceId() {}
  cancelPreparedMicCapture() {}
  cancelRecording() { return true; }
  cancelProcessing() { return true; }
  cleanup() {}
}
`;

async function mountHook(t, trialMode) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const noop = () => () => {};
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noop,
        onToggleVoiceAgent: noop,
        onToggleTranslation: noop,
        onStartDictation: noop,
        onPrepareDictation: noop,
        onCancelDictationPreparation: noop,
        onStopDictation: noop,
        dictationLifecycleStateChanged: () => {},
        hideDictationPreview: () => {},
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-trial-events-test-",
    mockModules: { "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { probe } = await vite.ssrLoadModule("/helpers/audioManager");
  const events = [];
  // Works before and after Plan 04 changes the signature to useAudioRecording(options):
  // a callable options object is a valid toast today and the options argument tomorrow.
  const options = Object.assign(() => "toast", { trialMode, onDemoEvent: (event) => events.push(event) });
  let api;
  function Harness() {
    api = useAudioRecording(options, options);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return { probe, events, api: () => api };
}

test("the manager is told every recording is private while setup is incomplete", async (t) => {
  const { probe } = await mountHook(t, true);
  assert.deepEqual(probe.privateSession.at(-1), true);
});

test("an empty result reaches setup as NO_AUDIO and releases the private audio", async (t) => {
  const { probe, events } = await mountHook(t, true);
  await React.act(async () => probe.callbacks.onTranscriptionComplete({ success: true, text: "   ", rawText: "" }));
  assert.deepEqual(
    events.filter((event) => event.status === "error").map((event) => event.code),
    ["NO_AUDIO"]
  );
  assert.equal(probe.released, 1);
});

test("cancelling an active take tells setup it was discarded, with no Undo fields (§5.2 fallback)", async (t) => {
  const { probe, events, api } = await mountHook(t, true);
  probe.state = { isRecording: true };
  await React.act(async () => api().cancelRecording());
  const cancelled = events.filter((event) => event.status === "cancelled");
  assert.equal(cancelled.length, 1);
  assert.equal("cancelled" in cancelled[0], false, "the CancelledState is Plan 04's to publish");
  assert.equal("undoUntil" in cancelled[0], false, "the retired pair is gone");
  probe.state = {};
  await React.act(async () => api().cancelRecording());
  assert.equal(events.filter((event) => event.status === "cancelled").length, 1, "nothing to cancel, nothing said");
});
```

Create `test/hooks/useSetupIncomplete.test.js` and `test/utils/onboardingDemo.test.js` with the content below. The second also covers the success and error builders.

```js
// test/hooks/useSetupIncomplete.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

test("setup is incomplete unless the flag is exactly true, and storage errors fail closed", async () => {
  const { isSetupIncomplete } = await import("../../src/hooks/useSetupIncomplete.ts");
  assert.equal(isSetupIncomplete({ getItem: () => null }), true);
  assert.equal(isSetupIncomplete({ getItem: () => "false" }), true);
  assert.equal(isSetupIncomplete({ getItem: () => "true" }), false);
  assert.equal(isSetupIncomplete({ getItem: () => { throw new Error("denied"); } }), true);
});

test("the overlay leaves trial mode the moment setup completes in the other window", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const listeners = new Map();
  const { storage } = installBrowserGlobals(t, {
    window: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-setup-incomplete-test-" });
  const { useSetupIncomplete } = await vite.ssrLoadModule("/hooks/useSetupIncomplete.ts");
  let value;
  function Harness() {
    value = useSetupIncomplete();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  assert.equal(value, true);
  storage.setItem("onboardingCompleted", "true");
  await React.act(async () => listeners.get("storage")({ key: "onboardingCompleted" }));
  assert.equal(value, false);
  storage.removeItem("onboardingCompleted");
  await React.act(async () => listeners.get("storage")({ key: null }));
  assert.equal(value, true, "restarting setup re-enters trial mode");
});

test("the overlay recorder is wired to trial mode (either useAudioRecording signature)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../src/App.jsx"), "utf8");
  assert.match(source, /const setupIncomplete = useSetupIncomplete\(\);/);
  assert.match(source, /useAudioRecording\((?:toast, )?\{[\s\S]*?trialMode: setupIncomplete,/);
});
```

```js
// test/utils/onboardingDemo.test.js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingDemo.ts");

test("success events carry the raw text and what cleanup did", async () => {
  const { buildDemoSuccessEvent } = await load();
  assert.deepEqual(buildDemoSuccessEvent("dictation", { text: "Remind me.", rawText: "um remind me" }), {
    kind: "dictation",
    status: "success",
    text: "Remind me.",
    rawText: "um remind me",
    cleanup: "applied",
  });
  assert.equal(buildDemoSuccessEvent("dictation", { text: "hi", rawText: "hi" }).cleanup, "skipped");
  assert.equal(
    buildDemoSuccessEvent("dictation", { text: "um hi", rawText: "um hi", cleanupFailure: { code: "TIMEOUT" } }).cleanup,
    "failed"
  );
  assert.equal(buildDemoSuccessEvent("dictation", { text: "hi" }).rawText, undefined);
});

test("error codes come from the error object, never from its message", async () => {
  const { demoErrorCode } = await load();
  assert.equal(demoErrorCode({ code: "NO_AUDIO" }), "NO_AUDIO");
  assert.equal(demoErrorCode({ name: "NotAllowedError", message: "Permission denied" }), "NotAllowedError");
  assert.equal(demoErrorCode(new Error("boom")), undefined);
  assert.equal(demoErrorCode(null), undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/audioManagerPrivateTrial.test.js test/helpers/useAudioRecordingTrialEvents.test.js test/hooks/useSetupIncomplete.test.js test/utils/onboardingDemo.test.js`
Expected: FAIL.
- `setPrivateSession is not a function`.
- The snapshot has no `private` field.
- The discard is saved.
- `useSetupIncomplete.ts` is missing.
- No `NO_AUDIO` or `cancelled` event is published.

The hold test is skipped until Plan 04 merges.

- [ ] **Step 3: Implement**

1. **`src/helpers/audioManager.js`.**

   - Add these methods directly above `setCallbacks(` (629):

     ```js
       // Setup's trial (spec §4): while setup is incomplete, every recording is
       // private. Privacy is captured per recording so a save that runs after
       // setup completes still honours how the audio was recorded.
       setPrivateSession(enabled) {
         this._privateSession = enabled === true;
       }

       _captureRecordingPrivacy() {
         this._recordingPrivate = this._privateSession === true;
       }

       releasePrivateAudio() {
         if (!this.lastAudioBlobPrivate) return;
         this.lastAudioBlob = null;
         this.lastAudioMetadata = null;
       }
     ```

   - Insert `this._captureRecordingPrivacy();` on its own line directly above each `this.isRecording = true;`. There are two such lines, at 1239 (batch) and 3579 (streaming). The source test enforces that every occurrence is covered.

   - Below each audio-carrying assignment, `this.lastAudioBlob = audioBlob;` (1447) and `this.lastAudioBlob = fallbackBlob;` (3935), add:

     ```js
         this.lastAudioBlobPrivate = this._recordingPrivate === true;
     ```

   - **Audio ownership (spec §5.2, `aad5284`).** If Plan 04 has merged (`grep -n "_setOwnedAudio(" src/helpers/audioManager.js` prints its definition), `AudioManager._setOwnedAudio(blob, options?)` is the only allowed writer of `lastAudioBlob`, its owner session and `lastAudioBlobPrivate`. Its defaults are the active session and that session's immutable recording-time `private` flag, falling back to `this._recordingPrivate === true` before a session exists, and Plan 04's guard test fails on any bare assignment. In that order, write every audio write in this task through it:
     - the two stamps become `this._setOwnedAudio(audioBlob);` (1447) and `this._setOwnedAudio(fallbackBlob);` (3935), replacing the assignment and the stamp line above;
     - `releasePrivateAudio()` releases with `this._setOwnedAudio(null);` instead of `this.lastAudioBlob = null;`. `this.lastAudioMetadata = null;` stays as it is;
     - do not add the mutable save guards below. Plan 04's `_ownedAudioSnapshot` and `_releaseOwnedAudio` already protect both savers, including changes of owner during an await. Keep those bodies and their acknowledgement results intact.

     If Plan 05 merges first, write the bare form shown here, including the temporary guards below, and Task 22 migrates it.

   - In `takeDiscardedBatchSnapshot()`, add `private: this._recordingPrivate === true,` to the returned object.

   - In `persistDiscardedBatchRecording`, extend the destructured parameter with `private: isPrivate,` and make this its first statement:

     ```js
         // A private (setup) recording is dropped here, whatever the retention settings.
         if (isPrivate) return;
     ```

   - **Only before Plan 04 exists**, make this the first statement of both `saveTranscription` (3043) and `saveFailedTranscription` (3110). When its snapshot savers exist, skip this temporary guard:

     ```js
         if (this.lastAudioBlobPrivate) {
           this.lastAudioBlob = null;
           this.lastAudioMetadata = null;
           return;
         }
     ```

     Both methods already return `undefined` when retention is off, so callers handle it.

2. **`src/hooks/useAudioRecording.js`.**

   - Directly after `audioManagerRef.current = new AudioManager();` (285), add `audioManagerRef.current.setPrivateSession?.(trialMode);`. `trialMode` is already an effect dependency (809), so a change rebuilds the manager.

   - In the blank-result branch (`if (!transcribedText) {`, 457), insert this before `return;`:

     ```js
                 onDemoEventRef.current?.({ kind: demoKindRef.current, status: "error", code: "NO_AUDIO" });
                 audioManagerRef.current?.releasePrivateAudio?.();
     ```

   - In `onError` (382-387), add `code: demoErrorCode(error),` to the demo event, and call `audioManagerRef.current?.releasePrivateAudio?.();` after it. In `onNoAudio` (410-415), add `code: "NO_AUDIO",`.

   - Replace the success demo event (507-511) with `onDemoEventRef.current?.(buildDemoSuccessEvent(demoKindRef.current, result));`. In the trial branch (`trialMode ? Promise.resolve(true) : …`, 534), call `audioManagerRef.current?.releasePrivateAudio?.();` before resolving.

   - In `cancelRecording` and `cancelProcessing`, read the state first. Publish the discard only when something was active:

     ```js
         const before = audioManagerRef.current?.getState?.() ?? {};
         if (before.isRecording || before.isProcessing || before.isStreaming) {
           // §5.2 fallback until Plan 04: "Discarded." with no Undo. Plan 04's
           // onCancelledChange publishes the real cancelled state; Task 22 deletes this.
           onDemoEventRef.current?.({ kind: demoKindRef.current, status: "cancelled" });
         }
     ```

     In `cancelRecording`, place this after `const state = …getState();` and reuse `state` instead of `before`. In `cancelProcessing`, place it before the cancel call.

   - Extend the import on line 11 to `import { buildDemoSuccessEvent, demoErrorCode, getOnboardingDemoKind } from "../utils/onboardingDemo";`.

3. **Create `src/hooks/useSetupIncomplete.ts`:**

   ```ts
   import { useEffect, useState } from "react";

   const COMPLETED_KEY = "onboardingCompleted";

   /** Until setup completes every recording is private (spec §4). Fails closed. */
   export function isSetupIncomplete(
     storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage
   ): boolean {
     try {
       return storage?.getItem(COMPLETED_KEY) !== "true";
     } catch {
       return true;
     }
   }

   /** The overlay learns about completion through the `storage` event from the panel. */
   export function useSetupIncomplete(): boolean {
     const [incomplete, setIncomplete] = useState(() => isSetupIncomplete());
     useEffect(() => {
       const onStorage = (event: Pick<StorageEvent, "key">) => {
         if (event.key === null || event.key === COMPLETED_KEY) setIncomplete(isSetupIncomplete());
       };
       window.addEventListener("storage", onStorage as EventListener);
       return () => window.removeEventListener("storage", onStorage as EventListener);
     }, []);
     return incomplete;
   }
   ```

4. **`src/App.jsx`.**
   - Add `import { useSetupIncomplete } from "./hooks/useSetupIncomplete";`.
   - Add `const setupIncomplete = useSetupIncomplete();` directly above the `useAudioRecording(` call.
   - Add `trialMode: setupIncomplete,` as the first property of its options object. This works with either signature.

5. **`src/utils/onboardingDemo.ts`.** Append the following, merging the type import with any existing one:

   ```ts
   import type { OnboardingDemoKind } from "../types/electron";

   export type DemoCleanupOutcome = "applied" | "skipped" | "failed";

   export function demoCleanupOutcome(result: { text?: string; rawText?: string | null; cleanupFailure?: unknown }): DemoCleanupOutcome {
     if (result.cleanupFailure) return "failed";
     if (typeof result.rawText === "string" && result.rawText !== result.text) return "applied";
     return "skipped";
   }

   export function buildDemoSuccessEvent(
     kind: OnboardingDemoKind,
     result: { text: string; rawText?: string | null; cleanupFailure?: unknown }
   ) {
     return {
       kind,
       status: "success" as const,
       text: result.text,
       rawText: typeof result.rawText === "string" ? result.rawText : undefined,
       cleanup: demoCleanupOutcome(result),
     };
   }

   /** Stable codes only (`code`, or a DOMException `name`); messages are never parsed. */
   export function demoErrorCode(error: unknown): string | undefined {
     if (!error || typeof error !== "object") return undefined;
     const { code, name } = error as { code?: unknown; name?: unknown };
     if (typeof code === "string") return code;
     return typeof name === "string" && name !== "Error" ? name : undefined;
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/audioManagerPrivateTrial.test.js test/helpers/useAudioRecordingTrialEvents.test.js test/hooks/useSetupIncomplete.test.js test/utils/onboardingDemo.test.js "test/helpers/audioManager*.test.js" "test/helpers/useAudioRecording*.test.js" && npm run typecheck`
Expected: PASS. Every existing `audioManager*` and `useAudioRecording*` suite still passes; none of them sets `_privateSession`, so their saves are unchanged. The hold test reports SKIP until Plan 04 merges. After Plan 04 merges, it must pass. If it fails, Plan 04 has not implemented §5.2's private holds, so stop and raise it with Plan 04.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/audioManager.js src/hooks/useAudioRecording.js src/hooks/useSetupIncomplete.ts src/App.jsx src/utils/onboardingDemo.ts test/helpers/audioManagerPrivateTrial.test.js test/helpers/useAudioRecordingTrialEvents.test.js test/hooks/useSetupIncomplete.test.js test/utils/onboardingDemo.test.js
git commit -m "fix(onboarding): recordings made during setup are private on every path"
```

---

### Task 6: Trial state reducer

Covers the logic of ONB-R5 C, ONB-Q3, ONB-Q5 and ONB-Q7, and consumes §5.2 `cancelled` as the fallback ("Discarded.", no Undo). Task 22 adds the `CancelledState`, `cancelClosed` and `canUndo` once Plan 04 is present. Cleanup retries are keyed to a take, so a retry can never write into a later take (I08).

**Files:**
- Create: `src/utils/onboardingTrial.ts`
- Test: `test/utils/onboardingTrial.test.js`

**Interfaces:**
- Consumes `OnboardingDemoEvent` (Task 4).
- Produces:

  ```ts
  export type TrialPhase = "idle" | "recording" | "processing" | "cancelled" | "success" | "error";
  export type TrialErrorKind = "microphone" | "noAudio" | "memory" | "other";
  export interface TrialState {
    phase: TrialPhase; text: string; rawText: string | null;
    cleanup: "applied" | "skipped" | "failed" | null;
    level: number; heardVoice: boolean; recordingSinceMs: number | null;
    errorKind: TrialErrorKind | null; errorMessage: string | null;
    successes: number;
    takeId: number;                                  // +1 on every "listening"
    cleanupRetry: "idle" | "running" | "failed";
  }
  export type TrialInput =
    | (Pick<OnboardingDemoEvent, "status" | "text" | "rawText" | "message" | "code" | "level" | "cleanup"> & { atMs: number })
    | { status: "reset"; atMs: number }
    | { status: "cleanupRetry"; takeId: number; atMs: number }
    | { status: "cleanupResult"; takeId: number; text: string | null; atMs: number };
  export const VOICE_LEVEL_FLOOR = 0.015;
  export const SILENCE_HINT_MS = 2500;
  export const INITIAL_TRIAL_STATE: TrialState;
  export function classifyTrialError(code?: string): TrialErrorKind;
  export function reduceTrial(state: TrialState, input: TrialInput): TrialState;
  export function isSilent(state: TrialState, nowMs: number): boolean;
  export type TrialCaption = "idle" | "goodLevel" | "waiting" | "processing" | "heard" | "discarded" | "error";
  export function trialCaption(state: TrialState): TrialCaption;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/utils/onboardingTrial.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingTrial.ts");

async function play(events) {
  const { INITIAL_TRIAL_STATE, reduceTrial } = await load();
  return events.reduce(reduceTrial, INITIAL_TRIAL_STATE);
}

test("a first dictation goes from listening to words on screen", async () => {
  const { trialCaption } = await load();
  const listening = await play([{ status: "listening", atMs: 1000 }]);
  assert.equal(listening.phase, "recording");
  assert.equal(trialCaption(listening), "waiting");
  const state = await play([
    { status: "listening", atMs: 1000 },
    { status: "level", level: 0.002, atMs: 1080 },
    { status: "level", level: 0.08, atMs: 1160 },
    { status: "partial", text: "Remind me", atMs: 1400 },
    { status: "processing", atMs: 2000 },
    { status: "success", text: "Remind me to send the draft.", rawText: "um remind me to send the draft", cleanup: "applied", atMs: 2600 },
  ]);
  assert.equal(state.phase, "success");
  assert.equal(state.text, "Remind me to send the draft.");
  assert.equal(state.rawText, "um remind me to send the draft");
  assert.equal(state.cleanup, "applied");
  assert.equal(state.heardVoice, true);
  assert.equal(state.level, 0);
  assert.equal(state.successes, 1);
  assert.equal(trialCaption(state), "heard");
});

test("silence for 2.5 s suggests checking the microphone; a voice clears it", async () => {
  const { isSilent, reduceTrial } = await load();
  const quiet = await play([{ status: "listening", atMs: 1000 }, { status: "level", level: 0.003, atMs: 1100 }]);
  assert.equal(isSilent(quiet, 3499), false);
  assert.equal(isSilent(quiet, 3500), true);
  const heard = reduceTrial(quiet, { status: "level", level: 0.05, atMs: 3600 });
  assert.equal(isSilent(heard, 9000), false);
});

test("errors are classified by code and keep their message", async () => {
  const { classifyTrialError } = await load();
  assert.equal(classifyTrialError("NotAllowedError"), "microphone");
  assert.equal(classifyTrialError("NotFoundError"), "microphone");
  assert.equal(classifyTrialError("NO_AUDIO"), "noAudio");
  assert.equal(classifyTrialError("INSUFFICIENT_MEMORY"), "memory");
  assert.equal(classifyTrialError(undefined), "other");
  const state = await play([{ status: "listening", atMs: 0 }, { status: "error", code: "NotAllowedError", message: "Permission denied", atMs: 5 }]);
  assert.deepEqual([state.phase, state.errorKind, state.errorMessage], ["error", "microphone", "Permission denied"]);
});

test("an empty or blank success means nothing was heard, not a win", async () => {
  for (const text of ["", "   ", undefined]) {
    const state = await play([{ status: "listening", atMs: 0 }, { status: "success", text, atMs: 9 }]);
    assert.equal(state.phase, "error", JSON.stringify(text));
    assert.equal(state.errorKind, "noAudio");
    assert.equal(state.successes, 0);
  }
});

test("a cancelled recording is discarded and stops the meter (spec §5.2 fallback)", async () => {
  const { trialCaption } = await load();
  const state = await play([
    { status: "listening", atMs: 0 },
    { status: "level", level: 0.4, atMs: 500 },
    { status: "cancelled", atMs: 1000 },
  ]);
  assert.deepEqual([state.phase, state.level, trialCaption(state)], ["cancelled", 0, "discarded"]);
});

test("a new take clears the last result but keeps the success count", async () => {
  const state = await play([
    { status: "listening", atMs: 0 },
    { status: "success", text: "One.", atMs: 5 },
    { status: "listening", atMs: 10 },
  ]);
  assert.deepEqual([state.phase, state.text, state.rawText, state.cleanup, state.successes, state.takeId], ["recording", "", null, null, 1, 2]);
});

test("a cleanup retry applies only to the take it was started for (I08)", async () => {
  const { reduceTrial } = await load();
  const takeA = await play([
    { status: "listening", atMs: 0 },
    { status: "success", text: "um hi", rawText: "um hi", cleanup: "failed", atMs: 5 },
  ]);
  const running = reduceTrial(takeA, { status: "cleanupRetry", takeId: takeA.takeId, atMs: 6 });
  assert.equal(running.cleanupRetry, "running");
  const cleaned = reduceTrial(running, { status: "cleanupResult", takeId: takeA.takeId, text: "Hi.", atMs: 7 });
  assert.deepEqual([cleaned.text, cleaned.cleanup, cleaned.cleanupRetry], ["Hi.", "applied", "idle"]);

  // Take B starts and succeeds before A's retry resolves: A's late result is dropped.
  let state = reduceTrial(running, { status: "listening", atMs: 8 });
  state = reduceTrial(state, { status: "success", text: "Take B.", rawText: "take b", cleanup: "skipped", atMs: 9 });
  const late = reduceTrial(state, { status: "cleanupResult", takeId: takeA.takeId, text: "Hi.", atMs: 10 });
  assert.equal(late, state);
  assert.equal(state.cleanupRetry, "idle", "a new take clears the retry state");

  const failed = reduceTrial(running, { status: "cleanupResult", takeId: takeA.takeId, text: null, atMs: 11 });
  assert.deepEqual([failed.text, failed.cleanupRetry], ["um hi", "failed"]);
});

test("out-of-phase and unknown events change nothing", async () => {
  const { INITIAL_TRIAL_STATE, reduceTrial } = await load();
  assert.equal(reduceTrial(INITIAL_TRIAL_STATE, { status: "level", level: 0.5, atMs: 0 }), INITIAL_TRIAL_STATE);
  assert.equal(reduceTrial(INITIAL_TRIAL_STATE, { status: "partial", text: "x", atMs: 0 }), INITIAL_TRIAL_STATE);
  assert.equal(reduceTrial(INITIAL_TRIAL_STATE, { status: "replying", atMs: 0 }), INITIAL_TRIAL_STATE);
  const recording = await play([{ status: "listening", atMs: 0 }]);
  assert.equal(reduceTrial(recording, { status: "level", level: Number.NaN, atMs: 1 }), recording);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/utils/onboardingTrial.test.js`
Expected: FAIL with `Cannot find module '../../src/utils/onboardingTrial.ts'`.

- [ ] **Step 3: Implement**

Create `src/utils/onboardingTrial.ts`:

```ts
import type { OnboardingDemoEvent } from "../types/electron";

// The Say something trial, as a pure reduction of onboarding demo events. Phase
// names follow the dictation lifecycle (spec §5.2): recording, processing,
// cancelled; success and error are the trial's own outcomes.
export type TrialPhase = "idle" | "recording" | "processing" | "cancelled" | "success" | "error";
export type TrialErrorKind = "microphone" | "noAudio" | "memory" | "other";

export interface TrialState {
  phase: TrialPhase;
  text: string;
  rawText: string | null;
  cleanup: "applied" | "skipped" | "failed" | null;
  level: number;
  heardVoice: boolean;
  recordingSinceMs: number | null;
  errorKind: TrialErrorKind | null;
  errorMessage: string | null;
  successes: number;
  takeId: number;
  cleanupRetry: "idle" | "running" | "failed";
}

export type TrialInput =
  | (Pick<
      OnboardingDemoEvent,
      "status" | "text" | "rawText" | "message" | "code" | "level" | "cleanup"
    > & { atMs: number })
  | { status: "reset"; atMs: number }
  | { status: "cleanupRetry"; takeId: number; atMs: number }
  | { status: "cleanupResult"; takeId: number; text: string | null; atMs: number };

/** Absolute RMS that counts as a voice; room noise sits near 0.002–0.005. */
export const VOICE_LEVEL_FLOOR = 0.015;
/** A silent recording this long suggests checking the microphone. */
export const SILENCE_HINT_MS = 2500;

export const INITIAL_TRIAL_STATE: TrialState = {
  phase: "idle",
  text: "",
  rawText: null,
  cleanup: null,
  level: 0,
  heardVoice: false,
  recordingSinceMs: null,
  errorKind: null,
  errorMessage: null,
  successes: 0,
  takeId: 0,
  cleanupRetry: "idle",
};

const MICROPHONE_CODES = new Set([
  "NotAllowedError",
  "PermissionDeniedError",
  "SecurityError",
  "NotFoundError",
  "NotReadableError",
]);

export function classifyTrialError(code?: string): TrialErrorKind {
  if (code && MICROPHONE_CODES.has(code)) return "microphone";
  if (code === "NO_AUDIO") return "noAudio";
  if (code === "INSUFFICIENT_MEMORY") return "memory";
  return "other";
}

const fresh = (state: TrialState): TrialState => ({
  ...INITIAL_TRIAL_STATE,
  successes: state.successes,
  takeId: state.takeId,
});

export function reduceTrial(state: TrialState, input: TrialInput): TrialState {
  switch (input.status) {
    case "reset":
      return fresh(state);
    case "listening":
      return { ...fresh(state), phase: "recording", recordingSinceMs: input.atMs, takeId: state.takeId + 1 };
    case "cleanupRetry":
      if (input.takeId !== state.takeId || state.phase !== "success") return state;
      return { ...state, cleanupRetry: "running" };
    case "cleanupResult":
      if (input.takeId !== state.takeId || state.phase !== "success") return state;
      return input.text
        ? { ...state, text: input.text, cleanup: "applied", cleanupRetry: "idle" }
        : { ...state, cleanupRetry: "failed" };
    case "level": {
      if (state.phase !== "recording" || !Number.isFinite(input.level)) return state;
      const level = Math.min(1, Math.max(0, input.level as number));
      return { ...state, level, heardVoice: state.heardVoice || level > VOICE_LEVEL_FLOOR };
    }
    case "partial":
      if (state.phase !== "recording" && state.phase !== "processing") return state;
      return {
        ...state,
        text: input.text ?? state.text,
        heardVoice: state.heardVoice || Boolean(input.text?.trim()),
      };
    case "processing":
      return { ...state, phase: "processing", level: 0, text: input.text ?? state.text };
    case "success": {
      const text = input.text?.trim() ? (input.text as string) : "";
      if (!text) return { ...state, phase: "error", level: 0, errorKind: "noAudio", errorMessage: null };
      return {
        ...state,
        phase: "success",
        level: 0,
        text,
        rawText: input.rawText ?? null,
        cleanup: input.cleanup ?? "skipped",
        successes: state.successes + 1,
      };
    }
    case "error":
      return {
        ...state,
        phase: "error",
        level: 0,
        errorKind: classifyTrialError(input.code),
        errorMessage: input.message ?? null,
      };
    case "cancelled":
      return {
        ...state,
        phase: "cancelled",
        level: 0,
      };
    default:
      // "replying" belongs to the assistant demo.
      return state;
  }
}

export function isSilent(state: TrialState, nowMs: number): boolean {
  return (
    state.phase === "recording" &&
    !state.heardVoice &&
    state.recordingSinceMs !== null &&
    nowMs - state.recordingSinceMs >= SILENCE_HINT_MS
  );
}

export type TrialCaption = "idle" | "goodLevel" | "waiting" | "processing" | "heard" | "discarded" | "error";

export function trialCaption(state: TrialState): TrialCaption {
  switch (state.phase) {
    case "recording":
      return state.heardVoice ? "goodLevel" : "waiting";
    case "processing":
      return "processing";
    case "success":
      return "heard";
    case "cancelled":
      return "discarded";
    case "error":
      return "error";
    default:
      return "idle";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/utils/onboardingTrial.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingTrial.ts test/utils/onboardingTrial.test.js
git commit -m "feat(onboarding): trial state reducer over demo events"
```

---

### Task 7: Voice download state per model, kept progress, and the notice boundary

Covers:
- the logic of ONB-R4 B, on top of Plan 02's ONB-Q2 wiring;
- owner decision 3 (kept progress);
- §5.3;
- review findings I04 (model identity), I10 (notifier boundary) and the stall half of I14.

**Files:**
- Create: `src/utils/onboardingDownload.ts`
- Create: `src/components/onboarding/useVoiceDownload.ts`
- Create: `src/components/onboarding/onboardingNotices.ts`
- Create: `src/components/onboarding/useOnboardingNotifier.ts`
- Modify: `src/helpers/downloadUtils.js`, terminal branches of `downloadFile`'s `catch` (328-343)
- Modify: `src/helpers/ipcHandlers.js`, `download-parakeet-model` catch block (≈2840-2860)
- Modify: `src/types/electron.ts`, `ParakeetDownloadProgressData` (517-526)
- Create: `test/helpers/harness/listenerBus.js`. Preload registrars fan out to every subscriber (`registerListener` in `preload.js`), and `useModelDownload` and `useVoiceDownload` each subscribe to download progress. Every fake in this plan uses this bus, so both real subscriptions receive each event (R2-I05).
- Test: create `test/utils/onboardingDownload.test.js`, `test/components/useVoiceDownload.test.js` and `test/components/onboardingNotices.test.js`; append to `test/helpers/downloadUtils.test.js`

**Interfaces:**
- **Consumes** Plan 02's `useModelDownload({ modelType: "parakeet" })`:
  - `downloads: Record<string, LocalModelDownloadStatus>`;
  - `downloadErrors`;
  - `isCancellingModel(id)`;
  - `downloadModel(id)`;
  - `cancelDownload(id): Promise<boolean>`, which resolves `true` only when main confirms.

  The hook never fills `speed`/`eta`, so this task measures them.
- **Produces** `src/utils/onboardingDownload.ts`:

  ```ts
  export type VoiceDownloadState =
    | { status: "checking" }      // the selected model's install status is not known yet
    | { status: "idle" }
    | { status: "downloading"; percent: number; downloadedBytes: number; totalBytes: number; bytesPerSecond: number | null; etaSeconds: number | null }
    | { status: "installing" }
    | { status: "cancelling" }    // asked main to stop; the request has not settled
    | { status: "cancelled" }     // stopped by the user; Download again is offered
    | { status: "ready" }
    | { status: "error"; message: string; percent: number | null; progressKept: boolean };
  export interface DownloadFacts {
    installed: boolean | null;                  // for THIS model; null = check pending
    entry: { phase: "downloading" | "installing"; progress: number; downloadedBytes: number; totalBytes: number } | null; // downloads[modelId]
    cancelling: boolean; cancelled: boolean; error: string | null;
    lastPercent: number | null; keptBytes: number | null; samples: readonly RateSample[];
  }
  export function deriveVoiceDownloadState(facts: DownloadFacts): VoiceDownloadState;
  // plus RateSample, RATE_WINDOW_MS, pushSample, estimateRate, DOWNLOAD_MILESTONES, DownloadMilestone,
  // milestoneCrossed, clampPercent, byteParts, etaParts
  ```

- **Produces** `useVoiceDownload(modelId: string | null): { state; milestone; start(): void; cancel(): Promise<void> }`. Every fact is keyed by `modelId`, so a switch shows `checking` until that model's own status arrives.
- **Produces** `onboardingNotices.ts`:
  - `type OnboardingNotice = { kind: "receipt" | "alert"; title: string; body?: string; actions?: { label: string; onClick(): void }[]; persistent?: boolean }`. This is exactly the §5.3 `notify` input.
  - `voiceReadyNotice(t)`;
  - `voiceFailedNotice(t, message, retry)`;
  - `shouldAnnounceOffStep(step)`.
- **Produces** `useOnboardingNotifier(): (notice: OnboardingNotice) => void`. This is the **only** code that depends on merge order.
- **Main produces** `keptBytes` on terminal `downloadFile` errors, the IPC error payload, and the `download-parakeet-model` result.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/onboardingDownload.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingDownload.ts");
const facts = (patch = {}) => ({
  installed: false,
  entry: null,
  cancelling: false,
  cancelled: false,
  error: null,
  lastPercent: null,
  keptBytes: null,
  samples: [],
  ...patch,
});
const entry = (patch = {}) => ({ phase: "downloading", progress: 41.6, downloadedBytes: 264e6, totalBytes: 631e6, ...patch });

test("speed and ETA come from the last five seconds of real progress", async () => {
  const { estimateRate, pushSample } = await load();
  let samples = [];
  for (const [atMs, bytes] of [[0, 0], [500, 4e6], [1000, 8.2e6], [2000, 16.4e6]]) samples = pushSample(samples, { atMs, bytes });
  assert.deepEqual(estimateRate(samples, 631e6), { bytesPerSecond: 8200000, etaSeconds: 75 });
  assert.deepEqual(estimateRate(samples.slice(0, 2), 631e6), { bytesPerSecond: null, etaSeconds: null });
  samples = pushSample(samples, { atMs: 7600, bytes: 50e6 });
  assert.deepEqual(samples, [{ atMs: 7600, bytes: 50e6 }], "samples older than five seconds leave the window");
});

test("a real stall (no progress events) ages into no estimate", async () => {
  const { estimateRate, pushSample } = await load();
  let samples = pushSample(pushSample([], { atMs: 0, bytes: 0 }), { atMs: 1000, bytes: 8e6 });
  // useVoiceDownload pushes an ageing sample every second while active, with the same byte count.
  for (let atMs = 2000; atMs <= 7000; atMs += 1000) samples = pushSample(samples, { atMs, bytes: 8e6 });
  assert.deepEqual(estimateRate(samples, 631e6), { bytesPerSecond: null, etaSeconds: null });
  assert.deepEqual(pushSample(samples, { atMs: 7500, bytes: 1e6 }), [{ atMs: 7500, bytes: 1e6 }], "a restart resets");
});

test("state precedence: a running entry, then cancelling, then installed, then error, then cancelled", async () => {
  const { deriveVoiceDownloadState } = await load();
  assert.deepEqual(deriveVoiceDownloadState(facts({ installed: null })), { status: "checking" });
  assert.deepEqual(deriveVoiceDownloadState(facts()), { status: "idle" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ installed: true, error: "old" })), { status: "ready" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ entry: entry({ phase: "installing" }) })), { status: "installing" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ entry: entry(), cancelling: true })), { status: "cancelling" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ cancelled: true })), { status: "cancelled" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ error: "Network timeout", lastPercent: 42, keptBytes: 265e6 })), {
    status: "error",
    message: "Network timeout",
    percent: 42,
    progressKept: true,
  });
  for (const keptBytes of [0, null]) {
    assert.equal(deriveVoiceDownloadState(facts({ error: "HTTP 404", lastPercent: 42, keptBytes })).progressKept, false);
  }
  assert.deepEqual(
    deriveVoiceDownloadState(facts({ entry: entry(), samples: [{ atMs: 0, bytes: 256e6 }, { atMs: 1000, bytes: 264e6 }] })),
    { status: "downloading", percent: 42, downloadedBytes: 264e6, totalBytes: 631e6, bytesPerSecond: 8000000, etaSeconds: 46 }
  );
});

test("milestones announce once per quarter, never every tick", async () => {
  const { milestoneCrossed } = await load();
  assert.equal(milestoneCrossed(null, 3), null);
  assert.equal(milestoneCrossed(24, 25), 25);
  assert.equal(milestoneCrossed(25, 26), null);
  assert.equal(milestoneCrossed(10, 80), 75);
  assert.equal(milestoneCrossed(80, 100), null, "completion is announced by the ready state");
});

test("numbers are clamped and formatted for people", async () => {
  const { clampPercent, byteParts, etaParts } = await load();
  assert.deepEqual([clampPercent(-3), clampPercent(41.6), clampPercent(140), clampPercent(Number.NaN)], [0, 42, 100, 0]);
  assert.deepEqual(byteParts(264e6, "en"), { value: "264", unit: "mb" });
  assert.deepEqual(byteParts(1329766560, "en"), { value: "1.3", unit: "gb" });
  assert.deepEqual(etaParts(42), { unit: "seconds", count: 45 });
  assert.deepEqual(etaParts(75), { unit: "minutes", count: 2 });
  assert.equal(etaParts(null), null);
});
```

Create `test/helpers/harness/listenerBus.js`:

```js
// Preload registrars (preload.js registerListener) deliver every event to every
// subscriber and dispose only the callback they returned. Fakes must do the same.
function listenerBus() {
  const listeners = new Set();
  return {
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emit(...args) {
      for (const listener of [...listeners]) listener(...args);
    },
    size: () => listeners.size,
  };
}

module.exports = { listenerBus };
```

Create `test/components/useVoiceDownload.test.js`. It drives the real `useModelDownload` (Plan 02) with deferred IPC:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { listenerBus } = require("../helpers/harness/listenerBus");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function mount(t) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const status = new Map();
  const pending = [];
  const progress = listenerBus();
  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        checkParakeetModelStatus: (id) => (status.get(id) ?? deferred()).promise,
        onParakeetDownloadProgress: progress.subscribe,
        modelGetActiveDownloads: async () => [],
        // Deferred: useModelDownload holds an owned request's terminal error until this resolves.
        downloadParakeetModel: (id) => {
          calls.push(["download", id]);
          const request = deferred();
          pending.push(request);
          return request.promise;
        },
        cancelParakeetDownload: async () => (calls.push(["cancel"]), { success: true }),
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-voice-download-test-", { "/ui/useToast": TOAST_MOCK }));
  const { useVoiceDownload } = await vite.ssrLoadModule("/components/onboarding/useVoiceDownload.ts");
  let current;
  function Harness({ modelId }) {
    current = useVoiceDownload(modelId);
    return null;
  }
  root = createRoot(container);
  const render = (modelId) => React.act(async () => root.render(React.createElement(Harness, { modelId })));
  const emit = (data) => React.act(async () => progress.emit({}, data));
  const settle = (result) => React.act(async () => pending.shift().resolve(result));
  return { render, emit, settle, status, calls, current: () => current };
}

test("switching models never inherits the previous model's readiness (I04)", async (t) => {
  const h = await mount(t);
  const a = deferred();
  const b = deferred();
  h.status.set("model-a", a);
  h.status.set("model-b", b);
  await h.render("model-a");
  await React.act(async () => a.resolve({ downloaded: true }));
  assert.equal(h.current().state.status, "ready");
  await h.render("model-b");
  assert.equal(h.current().state.status, "checking", "B is unknown while its status is pending");
  await React.act(async () => b.resolve({ downloaded: false }));
  assert.equal(h.current().state.status, "idle");
});

test("another model's transfer never shows as this model's progress", async (t) => {
  const h = await mount(t);
  const b = deferred();
  h.status.set("model-b", b);
  await h.render("model-b");
  await React.act(async () => b.resolve({ downloaded: false }));
  await h.emit({ type: "progress", model: "model-c", percentage: 60, downloaded_bytes: 6e8, total_bytes: 1e9 });
  assert.equal(h.current().state.status, "idle");
});

test("a confirmed cancel leaves a restart path, not a dead idle", async (t) => {
  const h = await mount(t);
  const b = deferred();
  h.status.set("model-b", b);
  await h.render("model-b");
  await React.act(async () => b.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  await h.emit({ type: "progress", model: "model-b", percentage: 42, downloaded_bytes: 265e6, total_bytes: 631e6 });
  assert.equal(h.current().state.status, "downloading");
  await React.act(async () => h.current().cancel());
  await h.emit({ type: "error", model: "model-b", error: "Download cancelled", code: "DOWNLOAD_CANCELLED" });
  await h.settle({ success: false, model: "model-b", downloaded: false, error: "Download cancelled", code: "DOWNLOAD_CANCELLED" });
  assert.equal(h.current().state.status, "cancelled");
  assert.deepEqual(h.calls.map(([name]) => name), ["download", "cancel"]);
});

test("kept progress is claimed only when main reports kept bytes", async (t) => {
  const h = await mount(t);
  const b = deferred();
  h.status.set("model-b", b);
  await h.render("model-b");
  await React.act(async () => b.resolve({ downloaded: false }));
  await React.act(async () => h.current().start());
  await h.emit({ type: "progress", model: "model-b", percentage: 42, downloaded_bytes: 265e6, total_bytes: 631e6 });
  await h.emit({ type: "error", model: "model-b", error: "The connection was reset.", code: "ECONNRESET", keptBytes: 265e6 });
  await h.settle({ success: false, model: "model-b", downloaded: false, error: "The connection was reset.", code: "ECONNRESET", keptBytes: 265e6 });
  assert.deepEqual(
    [h.current().state.status, h.current().state.percent, h.current().state.progressKept],
    ["error", 42, true]
  );
});
```

Create `test/components/onboardingNotices.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const t = (key, values) => (values ? `${key}(${JSON.stringify(values)})` : key);

test("notices are exactly the §5.3 notify input, whatever the merge order", async () => {
  const { voiceReadyNotice, voiceFailedNotice } = await import("../../src/components/onboarding/onboardingNotices.ts");
  assert.deepEqual(voiceReadyNotice(t), { kind: "receipt", title: "setupFlow.download.readyTitle" });
  let retried = 0;
  const failed = voiceFailedNotice(t, "Not enough disk space", () => retried++);
  assert.deepEqual(Object.keys(failed).sort(), ["actions", "body", "kind", "persistent", "title"]);
  assert.deepEqual([failed.kind, failed.title, failed.body, failed.persistent], [
    "alert",
    "setupFlow.download.failedTitle",
    "Not enough disk space",
    true,
  ]);
  failed.actions[0].onClick();
  assert.equal(retried, 1);
});

test("only steps without their own download status announce", async () => {
  const { shouldAnnounceOffStep } = await import("../../src/components/onboarding/onboardingNotices.ts");
  assert.deepEqual(
    ["welcome", "speech", "try", "cleanup", "shortcuts", "finish"].map(shouldAnnounceOffStep),
    [true, false, false, true, true, true]
  );
});

// Variant A only (Plan 04 not merged). Delete this test with variant B.
test("before Plan 04, the adapter maps a notice onto the toast API without losing Retry", async () => {
  const { toastFromNotice } = await import("../../src/components/onboarding/useOnboardingNotifier.ts");
  const retry = () => {};
  assert.deepEqual(toastFromNotice({ kind: "receipt", title: "Ready" }), { title: "Ready", variant: "success" });
  assert.deepEqual(
    toastFromNotice({ kind: "alert", title: "Failed", body: "Disk full", persistent: true, actions: [{ label: "Retry", onClick: retry }] }),
    { title: "Failed", description: "Disk full", variant: "destructive", duration: 0, actions: [{ label: "Retry", icon: "retry", onClick: retry }] }
  );
});
```

Append to `test/helpers/downloadUtils.test.js`. It reuses that file's existing `fs`, `os`, `path`, `EventEmitter` and `PassThrough` requires.

```js
// Each net.request() answers with the next scripted response and records its headers.
function loadWithResponses(responses) {
  const electronPath = require.resolve("electron");
  const downloadUtilsPath = require.resolve("../../src/helpers/downloadUtils.js");
  const originalElectronCache = require.cache[electronPath];
  const requests = [];
  require.cache[electronPath] = {
    exports: {
      app: { isReady: () => false },
      net: {
        request() {
          const request = new EventEmitter();
          const headers = {};
          requests.push(headers);
          request.setHeader = (name, value) => (headers[name] = value);
          request.abort = () => {};
          request.end = () => {
            const { statusCode, headers: responseHeaders, body } = responses.shift();
            const response = new PassThrough();
            response.statusCode = statusCode;
            response.headers = responseHeaders;
            response.end(body);
            queueMicrotask(() => request.emit("response", response));
          };
          return request;
        },
      },
    },
  };
  delete require.cache[downloadUtilsPath];
  return {
    downloadUtils: require(downloadUtilsPath),
    requests,
    restore() {
      delete require.cache[downloadUtilsPath];
      if (originalElectronCache) require.cache[electronPath] = originalElectronCache;
      else delete require.cache[electronPath];
    },
  };
}

test("a network failure keeps the partial file and the next attempt resumes it", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-keep-"));
  const destination = path.join(dir, "model.bin");
  const loaded = loadWithResponses([
    { statusCode: 200, headers: { "content-length": "10" }, body: Buffer.from("hello") },
    { statusCode: 206, headers: { "content-range": "bytes 5-9/10", "content-length": "5" }, body: Buffer.from("world") },
  ]);
  t.after(() => {
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const failure = await loaded.downloadUtils
    .downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 })
    .catch((error) => error);
  assert.equal(failure.code, "ERR_DOWNLOAD_INCOMPLETE");
  assert.equal(failure.keptBytes, 5);
  assert.equal(fs.readFileSync(`${destination}.tmp`, "utf8"), "hello");
  await loaded.downloadUtils.downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 });
  assert.equal(loaded.requests[1].Range, "bytes=5-");
  assert.equal(fs.readFileSync(destination, "utf8"), "helloworld");
});

test("an HTTP failure drops the partial file and reports nothing kept", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloadUtils-drop-"));
  const destination = path.join(dir, "model.bin");
  fs.writeFileSync(`${destination}.tmp`, "hello");
  const loaded = loadWithResponses([{ statusCode: 404, headers: {}, body: Buffer.alloc(0) }]);
  t.after(() => {
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const failure = await loaded.downloadUtils
    .downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 })
    .catch((error) => error);
  assert.equal(failure.isHttpError, true);
  assert.equal(failure.keptBytes, 0);
  assert.equal(fs.existsSync(`${destination}.tmp`), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingDownload.test.js test/components/useVoiceDownload.test.js test/components/onboardingNotices.test.js test/helpers/downloadUtils.test.js`

Expected: FAIL. The new modules are missing, `keptBytes` is `undefined`, and the partial file is deleted.

- [ ] **Step 3: Implement**

1. Create `src/utils/onboardingDownload.ts`:

   ```ts
   // Honest download progress for setup (ONB-R4): real percent, a measured speed
   // and ETA that age to "unknown" during a stall, milestones for one polite live
   // region, and kept progress only when main attests it.
   export type VoiceDownloadState =
     | { status: "checking" }
     | { status: "idle" }
     | {
         status: "downloading";
         percent: number;
         downloadedBytes: number;
         totalBytes: number;
         bytesPerSecond: number | null;
         etaSeconds: number | null;
       }
     | { status: "installing" }
     | { status: "cancelling" }
     | { status: "cancelled" }
     | { status: "ready" }
     | { status: "error"; message: string; percent: number | null; progressKept: boolean };

   export interface RateSample {
     atMs: number;
     bytes: number;
   }

   export const RATE_WINDOW_MS = 5000;
   const MIN_RATE_SPAN_MS = 1000;

   export function clampPercent(value: number): number {
     return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
   }

   export function pushSample(samples: readonly RateSample[], sample: RateSample): RateSample[] {
     const last = samples.at(-1);
     if (last && sample.bytes < last.bytes) return [sample];
     return [...samples, sample].filter((entry) => sample.atMs - entry.atMs <= RATE_WINDOW_MS);
   }

   export function estimateRate(
     samples: readonly RateSample[],
     totalBytes: number
   ): { bytesPerSecond: number | null; etaSeconds: number | null } {
     const first = samples[0];
     const last = samples.at(-1);
     const none = { bytesPerSecond: null, etaSeconds: null };
     if (!first || !last || last.atMs - first.atMs < MIN_RATE_SPAN_MS) return none;
     const rate = (last.bytes - first.bytes) / ((last.atMs - first.atMs) / 1000);
     if (!(rate > 0)) return none;
     const eta = totalBytes > 0 ? Math.ceil(Math.max(0, totalBytes - last.bytes) / rate) : null;
     return { bytesPerSecond: Math.round(rate), etaSeconds: eta };
   }

   export interface DownloadFacts {
     installed: boolean | null;
     entry: { phase: "downloading" | "installing"; progress: number; downloadedBytes: number; totalBytes: number } | null;
     cancelling: boolean;
     cancelled: boolean;
     error: string | null;
     lastPercent: number | null;
     keptBytes: number | null;
     samples: readonly RateSample[];
   }

   export function deriveVoiceDownloadState(facts: DownloadFacts): VoiceDownloadState {
     if (facts.entry && facts.cancelling) return { status: "cancelling" };
     if (facts.entry?.phase === "installing") return { status: "installing" };
     if (facts.entry) {
       const { progress, downloadedBytes, totalBytes } = facts.entry;
       return {
         status: "downloading",
         percent: clampPercent(progress),
         downloadedBytes,
         totalBytes,
         ...estimateRate(facts.samples, totalBytes),
       };
     }
     if (facts.installed === true) return { status: "ready" };
     if (facts.error) {
       return { status: "error", message: facts.error, percent: facts.lastPercent, progressKept: (facts.keptBytes ?? 0) > 0 };
     }
     if (facts.cancelled) return { status: "cancelled" };
     if (facts.installed === null) return { status: "checking" };
     return { status: "idle" };
   }

   export const DOWNLOAD_MILESTONES = [25, 50, 75] as const;
   export type DownloadMilestone = (typeof DOWNLOAD_MILESTONES)[number];

   export function milestoneCrossed(previousPercent: number | null, nextPercent: number): DownloadMilestone | null {
     const before = previousPercent ?? -1;
     let crossed: DownloadMilestone | null = null;
     for (const milestone of DOWNLOAD_MILESTONES) if (before < milestone && nextPercent >= milestone) crossed = milestone;
     return crossed;
   }

   export function byteParts(bytes: number, locale?: string): { value: string; unit: "mb" | "gb" } {
     const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
     if (safe >= 1e9) return { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(safe / 1e9), unit: "gb" };
     return { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(safe / 1e6), unit: "mb" };
   }

   export function etaParts(seconds: number | null): { unit: "seconds" | "minutes"; count: number } | null {
     if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
     if (seconds < 60) return { unit: "seconds", count: Math.max(5, Math.ceil(seconds / 5) * 5) };
     return { unit: "minutes", count: Math.ceil(seconds / 60) };
   }
   ```

   The state order is significant:
   - An entry is checked first, so a retry supersedes a stale error.
   - `installed === true` comes before the error, so a finished download is never shown as failed.
   - `checking` is reported only when nothing else is known.

2. Create `src/components/onboarding/useVoiceDownload.ts`:

   ```ts
   import { useCallback, useEffect, useRef, useState } from "react";
   import { useModelDownload } from "../../hooks/useModelDownload";
   import {
     clampPercent,
     deriveVoiceDownloadState,
     milestoneCrossed,
     pushSample,
     type DownloadMilestone,
     type RateSample,
     type VoiceDownloadState,
   } from "../../utils/onboardingDownload";

   const AGE_SAMPLE_MS = 1000;

   // Every fact is stored with the model it describes; a different selected model
   // reads as unknown until its own facts arrive (I04).
   interface Keyed<T> {
     modelId: string | null;
     value: T;
   }
   const forModel = <T,>(keyed: Keyed<T>, modelId: string | null, fallback: T): T =>
     keyed.modelId === modelId ? keyed.value : fallback;

   export function useVoiceDownload(modelId: string | null): {
     state: VoiceDownloadState;
     milestone: DownloadMilestone | null;
     start(): void;
     cancel(): Promise<void>;
   } {
     const modelIdRef = useRef(modelId);
     modelIdRef.current = modelId;
     const [installed, setInstalled] = useState<Keyed<boolean | null>>({ modelId: null, value: null });
     const [samples, setSamples] = useState<Keyed<RateSample[]>>({ modelId: null, value: [] });
     const [milestone, setMilestone] = useState<Keyed<DownloadMilestone | null>>({ modelId: null, value: null });
     const [keptBytes, setKeptBytes] = useState<Keyed<number | null>>({ modelId: null, value: null });
     const [cancelled, setCancelled] = useState<Keyed<boolean>>({ modelId: null, value: false });
     const lastPercentRef = useRef<Keyed<number | null>>({ modelId: null, value: null });

     const refresh = useCallback(async () => {
       const requested = modelIdRef.current;
       if (!requested) return;
       let value = false;
       try {
         value = Boolean((await window.electronAPI?.checkParakeetModelStatus?.(requested))?.downloaded);
       } catch {
         value = false;
       }
       if (modelIdRef.current === requested) setInstalled({ modelId: requested, value });
     }, []);

     const download = useModelDownload({ modelType: "parakeet", onDownloadComplete: () => void refresh() });

     useEffect(() => {
       void refresh();
     }, [modelId, refresh]);

     // Main attests what it kept (owner decision 3); useModelDownload keeps only the message.
     useEffect(
       () =>
         window.electronAPI?.onParakeetDownloadProgress?.((_event, data) => {
           if (data.model !== modelIdRef.current) return;
           if (data.type === "error") {
             setKeptBytes({ modelId: data.model, value: Number.isFinite(data.keptBytes) ? (data.keptBytes as number) : 0 });
           } else if (data.type === "progress") {
             setKeptBytes({ modelId: data.model, value: null });
           }
         }),
       []
     );

     const entry = modelId ? (download.downloads[modelId] ?? null) : null;
     const active = entry !== null;

     // Progress and ageing samples. Ageing turns a stall into "no estimate".
     useEffect(() => {
       if (!active || !entry || !modelId) return;
       const sample = () => {
         setSamples((previous) => ({
           modelId,
           value: pushSample(forModel(previous, modelId, []), { atMs: Date.now(), bytes: entry.downloadedBytes }),
         }));
       };
       sample();
       const percent = clampPercent(entry.progress);
       const crossed = milestoneCrossed(forModel(lastPercentRef.current, modelId, null), percent);
       lastPercentRef.current = { modelId, value: percent };
       if (crossed !== null) setMilestone({ modelId, value: crossed });
       const id = setInterval(sample, AGE_SAMPLE_MS);
       return () => clearInterval(id);
     }, [active, entry?.downloadedBytes, entry?.progress, modelId]);

     const state = deriveVoiceDownloadState({
       installed: modelId ? forModel(installed, modelId, null) : false,
       entry: entry && { phase: entry.phase, progress: entry.progress, downloadedBytes: entry.downloadedBytes, totalBytes: entry.totalBytes },
       cancelling: modelId ? download.isCancellingModel(modelId) : false,
       cancelled: forModel(cancelled, modelId, false),
       error: modelId ? (download.downloadErrors[modelId] ?? null) : null,
       lastPercent: forModel(lastPercentRef.current, modelId, null),
       keptBytes: forModel(keptBytes, modelId, null),
       samples: forModel(samples, modelId, []),
     });

     const { downloadModel, cancelDownload } = download;
     const start = useCallback(() => {
       const id = modelIdRef.current;
       if (!id) return;
       setCancelled({ modelId: id, value: false });
       setMilestone({ modelId: id, value: null });
       lastPercentRef.current = { modelId: id, value: null };
       void downloadModel(id);
     }, [downloadModel]);
     const cancel = useCallback(async () => {
       const id = modelIdRef.current;
       if (!id) return;
       // Plan 02: resolves true only once main confirms; a refused cancel keeps the transfer.
       if (await cancelDownload(id)) setCancelled({ modelId: id, value: true });
     }, [cancelDownload]);

     return { state, milestone: forModel(milestone, modelId, null), start, cancel };
   }
   ```

3. Create `src/components/onboarding/onboardingNotices.ts`. These are pure builders of the exact §5.3 input:

   ```ts
   import type { OnboardingStep } from "../../utils/onboardingState";

   type Translate = (key: string, values?: Record<string, unknown>) => string;

   /** Spec §5.3 notify() input, the subset setup uses. */
   export interface OnboardingNotice {
     kind: "receipt" | "alert";
     title: string;
     body?: string;
     actions?: { label: string; onClick(): void }[];
     persistent?: boolean;
   }

   export function voiceReadyNotice(t: Translate): OnboardingNotice {
     return { kind: "receipt", title: t("setupFlow.download.readyTitle") };
   }

   export function voiceFailedNotice(t: Translate, message: string, retry: () => void): OnboardingNotice {
     return {
       kind: "alert",
       title: t("setupFlow.download.failedTitle"),
       body: message,
       actions: [{ label: t("setupFlow.download.retry"), onClick: retry }],
       persistent: true,
     };
   }

   /** Voice and Say something show the download inline; other steps need a notice. */
   export function shouldAnnounceOffStep(step: OnboardingStep): boolean {
     return step !== "speech" && step !== "try";
   }
   ```

4. Create `src/components/onboarding/useOnboardingNotifier.ts`. **This file is the only merge-order-dependent code.** Choose the variant the pre-flight printed.

   **Variant A (Plan 04 not merged).** Plan 04 migrates this file. Spec §5.3 allows the toast API until it lands.

   ```ts
   import { useCallback } from "react";
   import { useToast, type ToastProps } from "../ui/useToast";
   import type { OnboardingNotice } from "./onboardingNotices";

   // Spec §5.3: until Plan 04 lands, notices go through the toast API. Plan 04
   // replaces this file's body with `export const useOnboardingNotifier = () => notify;`
   // and deletes toastFromNotice and its test.
   export function toastFromNotice(notice: OnboardingNotice): Omit<ToastProps, "id"> {
     if (notice.kind === "receipt") return { title: notice.title, variant: "success" };
     return {
       title: notice.title,
       description: notice.body,
       variant: "destructive",
       duration: notice.persistent ? 0 : undefined,
       actions: notice.actions?.map((action) => ({ label: action.label, icon: "retry" as const, onClick: action.onClick })),
     };
   }

   export function useOnboardingNotifier(): (notice: OnboardingNotice) => void {
     const { toast } = useToast();
     return useCallback((notice) => void toast(toastFromNotice(notice)), [toast]);
   }
   ```

   Plan 02 Task 7 gave the toast stack `duration: 0` = stay until dismissed (`getDictationErrorDuration` path). If `duration: 0` is not honoured in your tree, omit the `duration` key and change the test's expected object to match. The Retry action and the footer chip keep the failure visible anyway.

   **Variant B (Plan 04 merged).**

   ```ts
   import { notify } from "../ui/notices";
   import type { OnboardingNotice } from "./onboardingNotices";

   // Spec §5.3: the exact notify() input; NoticeStack placement="panel" renders it in setup.
   export function useOnboardingNotifier(): (notice: OnboardingNotice) => void {
     return notify;
   }
   ```

   With variant B, delete the "before Plan 04" test from `onboardingNotices.test.js`.

5. In `src/helpers/downloadUtils.js`, replace the two `unlink` branches at the end of `downloadFile`'s `catch` with:

   ```js
         if (error.isAbort) {
           await fsPromises.unlink(tempPath).catch(() => {});
           error.keptBytes = 0;
           throw error;
         }

         if (!isRetryable(error) || attempt >= maxRetries) {
           debugLogger.error("Download failed", { url, error: error.message, code: error.code });
           // A network failure keeps the partial file so the next attempt resumes with
           // a Range request (setup tells the user their progress is kept). HTTP, TLS
           // and size failures start over. Stale temps are swept after 24 h.
           if (isRetryable(error)) {
             error.keptBytes = await fsPromises.stat(tempPath).then((stats) => stats.size, () => 0);
           } else {
             await fsPromises.unlink(tempPath).catch(() => {});
             error.keptBytes = 0;
           }
           throw error;
         }
   ```

   `parakeet.js` rethrows non-abort errors unchanged (461-468), and it never deletes the `.tmp`. Whisper and LLM downloads share `downloadFile`, so they resume after network failures too, which is intended.

6. In `src/helpers/ipcHandlers.js`, inside the `download-parakeet-model` catch block, add `keptBytes: Number.isFinite(error.keptBytes) ? error.keptBytes : 0,` to both the `type: "error"` payload and the returned failure object.

7. In `src/types/electron.ts`, add `keptBytes?: number;` to `ParakeetDownloadProgressData`.

8. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "units": { "mb": "{{value}} MB", "gb": "{{value}} GB" },
       "download": {
         "eta": { "seconds": "about {{count}} s", "minutes": "about {{count}} min" },
         "chip": "Downloading {{percent}}% · {{eta}} left",
         "chipNoEta": "Downloading {{percent}}%",
         "chipInstalling": "Installing voice model",
         "chipCancelling": "Stopping the download…",
         "chipCancelled": "Download cancelled",
         "chipReady": "Voice model ready",
         "chipFailed": "Download failed",
         "received": "{{done}} of {{total}}",
         "stoppedKept": "Download stopped at {{percent}}%. Your progress is kept.",
         "stoppedRestart": "Download stopped at {{percent}}%. Retry starts it again.",
         "cancelledLine": "You cancelled the download. Nothing is kept.",
         "downloadAgain": "Download again",
         "retry": "Retry",
         "cancel": "Cancel",
         "readyTitle": "Voice model ready",
         "failedTitle": "The voice model didn't download",
         "announcePercent": "Voice model download {{percent}} percent.",
         "announceReady": "Voice model ready."
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/utils/onboardingDownload.test.js test/components/useVoiceDownload.test.js test/components/onboardingNotices.test.js "test/helpers/*Download*.test.js" test/helpers/downloadUtils.test.js && npm run typecheck && npm run i18n:check`

Expected: PASS. The shared download suites (`modelManagerBridgeDownloadStatus`, `transcriptionModelDownloadStatus`, `localModelDownloadStatus`) still pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingDownload.ts src/components/onboarding/useVoiceDownload.ts src/components/onboarding/onboardingNotices.ts src/components/onboarding/useOnboardingNotifier.ts src/helpers/downloadUtils.js src/helpers/ipcHandlers.js src/types/electron.ts src/locales test/utils/onboardingDownload.test.js test/components/useVoiceDownload.test.js test/components/onboardingNotices.test.js test/helpers/downloadUtils.test.js test/helpers/harness/listenerBus.js
git commit -m "feat(onboarding): per-model download state, kept progress, stall ageing and a §5.3 notice boundary"
```

---

### Task 8: Preview scenario bridge

ONB-Q18 groundwork. Every new state is previewable, and no production component needs a preview branch. Every fake is typed against the real preload contract and honours the same lifecycle as desktop (I11, I12):
- a transfer settles exactly once;
- `reset()` settles a pending transfer;
- cancel clears the active entry;
- a trial cancel says "Discarded." with no Undo, exactly like desktop before Plan 04 (§5.2 fallback). Task 22 adds the preview's Undo with the §5.2 shapes.

**Files:**
- Create: `src/preview/onboardingScenarioBridge.ts`
- Modify: `src/preview/browserPreview.ts`. Touch the `declare global` block (8-12), `createBrowserPreviewAPI` (55-308) and `installBrowserPreview` (312-322).
- Modify: `src/preview/BrowserPreview.tsx`. Touch `updateConfig` (≈53-66) and the toolbar.
- Modify: `docs/ONBOARDING_PREVIEW.md`
- Test: `test/preview/onboardingScenarioBridge.test.js`

**Interfaces:**
- Consumes the API names from Tasks 2 and 4, and the scenario list from Task 1.
- Produces:

  ```ts
  export interface ScenarioClock { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(handle: unknown): void; now(): number }
  export const PREVIEW_SENTENCE: "Remind me to send the draft before lunch.";
  export const PREVIEW_RAW_SENTENCE: "um remind me to send the draft before lunch";
  export function createOnboardingScenarioBridge(
    getConfig: () => OnboardingPreviewConfig,
    clock?: ScenarioClock
  ): { api: Record<string, unknown>; simulateHotkey(phase: "down" | "up"): void; reset(): void };
  // window.loquiPreviewBridge?: { simulateHotkey(phase: "down" | "up"): void; reset(): void }
  ```

- Scenario behaviour:

  | Scenario | Bridge behaviour |
  |---|---|
  | `fresh` | Voice not installed. The download goes from 0 to 100% in 7% steps every 400 ms. |
  | `ready` | Voice installed. |
  | `downloading` | A download of the default voice is already running from 35%, through `modelGetActiveDownloads`. |
  | `download-interrupted` | The first attempt fails at 42% with `ECONNRESET`, keeping the 35% already written (`keptBytes`). Retry resumes from 35% and completes. |
  | `microphone-denied` | The mic is denied. The trial fails at the start with `NotAllowedError`. |
  | `nothing-heard` | Levels stay at 0.003. Stopping fails with `NO_AUDIO`. |
  | `insufficient-memory` | The profile reports 4 GiB of memory. Stopping fails with `INSUFFICIENT_MEMORY`. |
  | `cleanup-failed` | The trial returns the raw words with `cleanup: "failed"`. |
  | `accessibility-missing` | On macOS, Accessibility is not granted and shortcut presses never arrive. |
  | `low-disk` | Free space is 412 MB. |
  | `multilingual` | Locales are `["es-ES","en-US"]`. |
  | `codex-*`, `invalid-provider-key` | Unchanged. These run through the existing `personalInference` stubs. |

- [ ] **Step 1: Write the failing test**

Create `test/preview/onboardingScenarioBridge.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/preview/onboardingScenarioBridge.ts");

function manualClock() {
  let now = 0;
  let queue = [];
  return {
    clock: {
      setTimeout(callback, ms) {
        const handle = { at: now + ms, callback };
        queue.push(handle);
        return handle;
      },
      clearTimeout(handle) {
        queue = queue.filter((entry) => entry !== handle);
      },
      now: () => now,
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > end) break;
        queue.shift();
        now = next.at;
        next.callback();
      }
      now = end;
    },
  };
}

async function bridgeFor(scenario, platform = "linux") {
  const { createOnboardingScenarioBridge } = await load();
  const time = manualClock();
  const config = { step: "welcome", scenario, platform };
  const bridge = createOnboardingScenarioBridge(() => config, time.clock);
  return { bridge, api: bridge.api, time, config };
}

test("a fresh download completes and the voice then reads as installed", async () => {
  const { api, time } = await bridgeFor("fresh");
  const progress = [];
  api.onParakeetDownloadProgress((_event, data) => progress.push(data));
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  assert.deepEqual(await pending, { success: true, downloaded: true, model: "parakeet-unified-en-0.6b" });
  assert.equal(progress.at(-1).type, "complete");
  assert.ok(progress.some((event) => event.type === "progress" && event.total_bytes === 631000000));
  assert.equal((await api.checkParakeetModelStatus("parakeet-unified-en-0.6b")).downloaded, true);
});

test("an interrupted download keeps its progress and Retry resumes it", async () => {
  const { api, time } = await bridgeFor("download-interrupted");
  const progress = [];
  api.onParakeetDownloadProgress((_event, data) => progress.push(data));
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(result.code, "ECONNRESET");
  assert.equal(result.keptBytes, Math.round(631000000 * 0.35));
  assert.equal(progress.at(-1).type, "error");
  assert.equal(progress.at(-1).keptBytes, result.keptBytes);
  assert.ok(progress.filter((event) => event.type === "progress").every((event) => event.percentage < 42));

  progress.length = 0;
  const retry = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  assert.equal((await retry).success, true);
  assert.equal(progress.find((event) => event.type === "progress").percentage, 42, "resumes from 35%");
});

test("cancel stops the transfer with the cancellation code", async () => {
  const { api, time } = await bridgeFor("fresh");
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(900);
  await api.cancelParakeetDownload();
  assert.equal((await pending).code, "DOWNLOAD_CANCELLED");
});

test("the downloading scenario rehydrates an in-flight transfer", async () => {
  const { api } = await bridgeFor("downloading");
  const [active] = await api.modelGetActiveDownloads();
  assert.equal(active.modelType, "parakeet");
  assert.equal(active.progress, 35);
});

async function trial(scenario, platform) {
  const context = await bridgeFor(scenario, platform);
  const events = [];
  context.api.onOnboardingDemoEvent((event) => events.push(event));
  await context.api.beginOnboardingDemo({ id: "demo-1", kind: "dictation" });
  return { ...context, events };
}

test("the trial streams listening, levels, words and a result", async () => {
  const { api, time, events } = await trial("ready");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(800);
  await api.toggleOnboardingDemo("demo-1");
  time.advance(400);
  const statuses = [...new Set(events.map((event) => event.status))];
  assert.deepEqual(statuses, ["listening", "level", "partial", "processing", "success"]);
  assert.equal(events.at(-1).text, "Remind me to send the draft before lunch.");
  assert.ok(events.every((event) => event.demoId === "demo-1" && event.kind === "dictation"));
});

test("failure scenarios fail where the real app would", async () => {
  const denied = await trial("microphone-denied");
  await denied.api.toggleOnboardingDemo("demo-1");
  assert.deepEqual(denied.events.map((event) => [event.status, event.code]), [["listening", undefined], ["error", "NotAllowedError"]]);

  const quiet = await trial("nothing-heard");
  await quiet.api.toggleOnboardingDemo("demo-1");
  quiet.time.advance(800);
  await quiet.api.toggleOnboardingDemo("demo-1");
  quiet.time.advance(400);
  assert.ok(quiet.events.filter((event) => event.status === "level").every((event) => event.level < 0.015));
  assert.equal(quiet.events.at(-1).code, "NO_AUDIO");

  const messy = await trial("cleanup-failed");
  await messy.api.toggleOnboardingDemo("demo-1");
  messy.time.advance(400);
  await messy.api.toggleOnboardingDemo("demo-1");
  messy.time.advance(400);
  assert.deepEqual([messy.events.at(-1).cleanup, messy.events.at(-1).text], ["failed", "um remind me to send the draft before lunch"]);
});

test("shortcut sessions mirror presses but never record", async () => {
  const { api, bridge } = await bridgeFor("ready");
  const presses = [];
  const demo = [];
  api.onDictationHotkeyEvent((event) => presses.push(event.phase));
  api.onOnboardingDemoEvent((event) => demo.push(event));
  await api.beginOnboardingDemo({ id: "demo-2", kind: "shortcut" });
  bridge.simulateHotkey("down");
  bridge.simulateHotkey("up");
  assert.deepEqual(presses, ["down", "up"]);
  assert.deepEqual(demo, []);
});

test("without Accessibility on macOS, presses never arrive", async () => {
  const { api, bridge } = await bridgeFor("accessibility-missing", "macos");
  const presses = [];
  api.onDictationHotkeyEvent((event) => presses.push(event));
  await api.beginOnboardingDemo({ id: "demo-3", kind: "dictation" });
  bridge.simulateHotkey("down");
  assert.deepEqual(presses, []);
  assert.equal(await api.checkAccessibilityPermission(), false);
});

test("the system profile follows the scenario", async () => {
  assert.deepEqual((await (await bridgeFor("multilingual")).api.getSystemProfile()).locales, ["es-ES", "en-US"]);
  assert.equal((await (await bridgeFor("low-disk")).api.getSystemProfile()).freeDiskBytes, 412000000);
  assert.equal(await (await bridgeFor("insufficient-memory")).api.getTotalMemory(), 4 * 1024 ** 3);
});

test("reset settles a pending transfer and cancel never leaves stale active work (I12)", async () => {
  const { api, bridge, time } = await bridgeFor("fresh");
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(900);
  bridge.reset();
  assert.deepEqual(await pending, {
    success: false,
    downloaded: false,
    model: "parakeet-unified-en-0.6b",
    error: "Preview reset",
    code: "DOWNLOAD_CANCELLED",
  });
  assert.deepEqual(await api.modelGetActiveDownloads(), []);

  const second = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(900);
  assert.deepEqual(await api.cancelParakeetDownload(), { success: true });
  assert.equal((await second).downloaded, false);
  assert.deepEqual(await api.modelGetActiveDownloads(), [], "cancelled work is not reported as active");
  assert.deepEqual(await api.cancelParakeetDownload(), { success: false }, "nothing left to cancel");
  const retry = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  assert.equal((await retry).success, true);
});

test("Esc while processing cancels the take: its result never arrives (R2-I07)", async () => {
  const { api, time, events } = await trial("ready");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  await api.toggleOnboardingDemo("demo-1"); // stop → processing
  assert.equal(events.at(-1).status, "processing");
  assert.equal(await api.cancelOnboardingDemo("demo-1"), true);
  time.advance(2000);
  assert.deepEqual(events.slice(-2).map((event) => event.status), ["processing", "cancelled"]);
  assert.equal(events.some((event) => event.status === "success"), false);
});

test("leaving mid-processing and coming back never delivers the old result to the new session", async () => {
  const { api, time, events } = await trial("ready");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  await api.toggleOnboardingDemo("demo-1");
  await api.endOnboardingDemo("demo-1");
  await api.beginOnboardingDemo({ id: "demo-2", kind: "dictation" });
  time.advance(2000);
  assert.equal(events.some((event) => event.status === "success"), false);
  await api.toggleOnboardingDemo("demo-2");
  assert.deepEqual(events.at(-1), { demoId: "demo-2", kind: "dictation", status: "listening" });
});

test("a cancel is discarded with no Undo, like desktop before Plan 04 (§5.2 fallback, I12)", async () => {
  const { api, time, events } = await trial("ready");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  assert.equal(await api.cancelOnboardingDemo("demo-1"), true);
  assert.deepEqual(events.at(-1), { demoId: "demo-1", kind: "dictation", status: "cancelled" });
  assert.equal(await api.undoOnboardingDemoCancel("demo-1"), false);
  time.advance(1000);
  assert.equal(events.at(-1).status, "cancelled", "nothing resumes");
});

test("ending a session silences it and reset forgets downloads", async () => {
  const { api, bridge, time, events } = await trial("fresh");
  await api.endOnboardingDemo("demo-1");
  assert.equal(await api.toggleOnboardingDemo("demo-1"), false);
  assert.deepEqual(events, []);
  const pending = api.downloadParakeetModel("parakeet-unified-en-0.6b");
  time.advance(10000);
  await pending;
  bridge.reset();
  assert.equal((await api.checkParakeetModelStatus("parakeet-unified-en-0.6b")).downloaded, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/preview/onboardingScenarioBridge.test.js`
Expected: FAIL with `Cannot find module '../../src/preview/onboardingScenarioBridge.ts'`.

- [ ] **Step 3: Implement**

1. Create `src/preview/onboardingScenarioBridge.ts`:

   ```ts
   import type {
     DictationHotkeyEvent,
     OnboardingDemoEvent,
     OnboardingDemoKind,
     SystemFacts,
   } from "../types/electron";
   import type { OnboardingPreviewConfig } from "../utils/onboardingState";
   import { DEFAULT_ONBOARDING_SPEECH_MODEL_ID } from "../utils/onboardingSpeechModels";

   // Browser-preview fakes for the setup bridge. Every simulated outcome lives
   // here, so production components never branch on the preview (ONB-Q18).
   export interface ScenarioClock {
     setTimeout(callback: () => void, ms: number): unknown;
     clearTimeout(handle: unknown): void;
     now(): number;
   }

   const realClock: ScenarioClock = {
     setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
     clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
     now: () => Date.now(),
   };

   export const PREVIEW_SENTENCE = "Remind me to send the draft before lunch.";
   export const PREVIEW_RAW_SENTENCE = "um remind me to send the draft before lunch";

   const MODEL_BYTES = 631_000_000;
   const TICK_MS = 400;
   const STEP_PERCENT = 7;
   const INTERRUPT_AT = 42;
   const LEVEL_MS = 80;
   const PROCESS_MS = 350;

   // ParakeetModelResult (src/types/electron.ts:486-500) requires `downloaded`.
   type DownloadResult = {
     success: boolean;
     downloaded: boolean;
     model: string;
     error?: string;
     code?: string;
     keptBytes?: number;
   };
   // Derived from the preload contract, so `satisfies` checks the real callback type (R2-I03).
   type ProgressListener = Parameters<Window["electronAPI"]["onParakeetDownloadProgress"]>[0];
   type ProgressData = Parameters<ProgressListener>[1];
   type DemoPayload = Omit<OnboardingDemoEvent, "demoId" | "kind">;

   export function createOnboardingScenarioBridge(
     getConfig: () => OnboardingPreviewConfig,
     clock: ScenarioClock = realClock
   ) {
     const progressListeners = new Set<ProgressListener>();
     const demoListeners = new Set<(event: OnboardingDemoEvent) => void>();
     const hotkeyListeners = new Set<(event: DictationHotkeyEvent) => void>();
     const downloaded = new Set<string>();
     // Mirrors main (owner decision 3): a network failure keeps the partial download.
     const kept = new Map<string, number>();
     const interrupted = new Set<string>();
     let active: { model: string; percent: number; timer: unknown; resolve: (r: DownloadResult) => void } | null = null;
     let session: { id: string; kind: OnboardingDemoKind } | null = null;
     // The take's lifecycle, through processing (R2-I07): a cancel or a new session
     // must stop a result that is still on its way.
     let take: "idle" | "recording" | "processing" = "idle";
     let trialTimers: unknown[] = [];

     const scenario = () => getConfig().scenario;
     const isMac = () => getConfig().platform === "macos";
     const accessibilityMissing = () => isMac() && scenario() === "accessibility-missing";
     const subscribe =
       <T,>(set: Set<T>) =>
       (listener: T) => {
         set.add(listener);
         return () => {
           set.delete(listener);
         };
       };
     const emitProgress = (data: ProgressData) => {
       for (const listener of [...progressListeners]) listener({}, data);
     };
     const emitDemo = (event: DemoPayload) => {
       if (!session) return;
       const payload = { demoId: session.id, kind: session.kind, ...event } as OnboardingDemoEvent;
       for (const listener of demoListeners) listener(payload);
     };
     const later = (ms: number, callback: () => void) => trialTimers.push(clock.setTimeout(callback, ms));
     const clearTrialTimers = () => {
       for (const handle of trialTimers) clock.clearTimeout(handle);
       trialTimers = [];
     };

     function runDownload(model: string, from: number): Promise<DownloadResult> {
       return new Promise((resolve) => {
         const finish = (result: DownloadResult) => {
           active = null;
           resolve(result);
         };
         const tick = () => {
           if (!active) return;
           const percent = Math.min(100, active.percent + STEP_PERCENT);
           if (scenario() === "download-interrupted" && !interrupted.has(model) && percent >= INTERRUPT_AT) {
             interrupted.add(model);
             kept.set(model, active.percent);
             const error = "The connection was reset.";
             const keptBytes = Math.round((MODEL_BYTES * active.percent) / 100);
             emitProgress({ type: "error", model, error, code: "ECONNRESET", keptBytes });
             return finish({ success: false, downloaded: false, model, error, code: "ECONNRESET", keptBytes });
           }
           active.percent = percent;
           emitProgress({
             type: "progress",
             model,
             percentage: percent,
             downloaded_bytes: Math.round((MODEL_BYTES * percent) / 100),
             total_bytes: MODEL_BYTES,
           });
           if (percent >= 100) {
             downloaded.add(model);
             emitProgress({ type: "complete", model });
             return finish({ success: true, downloaded: true, model });
           }
           active.timer = clock.setTimeout(tick, TICK_MS);
         };
         active = { model, percent: from, timer: clock.setTimeout(tick, TICK_MS), resolve: finish };
       });
     }

     function startTrial() {
       if (take !== "idle") return;
       take = "recording";
       emitDemo({ status: "listening" });
       if (scenario() === "microphone-denied") {
         take = "idle";
         emitDemo({ status: "error", code: "NotAllowedError", message: "Permission denied" });
         return;
       }
       const quiet = scenario() === "nothing-heard";
       let ticks = 0;
       const level = () => {
         if (take !== "recording") return;
         ticks += 1;
         emitDemo({ status: "level", level: quiet ? 0.003 : 0.04 + 0.04 * Math.abs(Math.sin(ticks / 2)) });
         if (!quiet && ticks === 8) emitDemo({ status: "partial", text: "Remind me to send" });
         later(LEVEL_MS, level);
       };
       later(LEVEL_MS, level);
     }

     function stopTrial() {
       if (take !== "recording") return;
       take = "processing";
       clearTrialTimers();
       emitDemo({ status: "processing" });
       later(PROCESS_MS, () => {
         take = "idle";
         const current = scenario();
         if (current === "nothing-heard") {
           emitDemo({ status: "error", code: "NO_AUDIO", message: "No audio detected" });
         } else if (current === "insufficient-memory") {
           emitDemo({ status: "error", code: "INSUFFICIENT_MEMORY", message: "Not enough memory to load this model." });
         } else {
           const failed = current === "cleanup-failed";
           const text = failed ? PREVIEW_RAW_SENTENCE : PREVIEW_SENTENCE;
           emitDemo({ status: "success", text, rawText: text, cleanup: failed ? "failed" : "skipped" });
         }
       });
     }

     function endSession() {
       take = "idle";
       clearTrialTimers(); // includes a pending result, so nothing reaches the next session
       session = null;
     }

     function simulateHotkey(phase: "down" | "up") {
       if (!session || (session.kind !== "dictation" && session.kind !== "shortcut")) return;
       if (accessibilityMissing()) return; // the Globe key needs Accessibility
       const at = clock.now();
       for (const listener of hotkeyListeners) listener({ phase, at });
       if (session.kind !== "dictation") return;
       const push = globalThis.localStorage?.getItem("activationMode") === "push";
       if (push) {
         if (phase === "down") startTrial();
         else stopTrial();
       } else if (phase === "down") {
         if (take === "recording") stopTrial();
         else startTrial();
       }
     }

     // Settles the running transfer exactly once and clears it, so modelGetActiveDownloads
     // never reports work that has ended (I12).
     function settleActive(error: string, code: string) {
       if (!active) return;
       const { model, timer, resolve } = active;
       clock.clearTimeout(timer);
       active = null;
       emitProgress({ type: "error", model, error, code });
       resolve({ success: false, downloaded: false, model, error, code });
     }

     function reset() {
       settleActive("Preview reset", "DOWNLOAD_CANCELLED");
       downloaded.clear();
       kept.clear();
       interrupted.clear();
       endSession();
     }

     const api = {
       getSystemProfile: async (): Promise<SystemFacts> => ({
         locales: scenario() === "multilingual" ? ["es-ES", "en-US"] : ["en-US"],
         freeDiskBytes: scenario() === "low-disk" ? 412_000_000 : 212_000_000_000,
         gpu: isMac() ? { kind: "apple-silicon", name: null } : { kind: "unknown", name: null },
       }),
       // Plan 03's channel (§5.1); the preview owns its value per scenario.
       getTotalMemory: async () => (scenario() === "insufficient-memory" ? 4 * 1024 ** 3 : 16 * 1024 ** 3),
       checkParakeetModelStatus: async (model: string) => ({
         success: true,
         model,
         downloaded: scenario() === "ready" || downloaded.has(model),
       }),
       downloadParakeetModel: (model: string) => {
         const from = kept.get(model) ?? 0;
         kept.delete(model);
         return runDownload(model, from);
       },
       cancelParakeetDownload: async () => {
         if (!active) return { success: false };
         settleActive("Download cancelled", "DOWNLOAD_CANCELLED");
         return { success: true };
       },
       onParakeetDownloadProgress: subscribe(progressListeners),
       modelGetActiveDownloads: async () => {
         if (scenario() === "downloading" && !active && !downloaded.has(DEFAULT_ONBOARDING_SPEECH_MODEL_ID)) {
           void runDownload(DEFAULT_ONBOARDING_SPEECH_MODEL_ID, 35);
         }
         return active
           ? [
               {
                 modelType: "parakeet" as const,
                 modelId: active.model,
                 phase: "downloading" as const,
                 progress: active.percent,
                 downloadedBytes: Math.round((MODEL_BYTES * active.percent) / 100),
                 totalBytes: MODEL_BYTES,
                 sequence: 0,
               },
             ]
           : [];
       },
       checkMicrophoneAccess: async () => {
         const granted = scenario() !== "microphone-denied";
         return { granted, status: granted ? "granted" : "denied" };
       },
       requestMicrophoneAccess: async () => ({ granted: scenario() !== "microphone-denied" }),
       openMicrophoneSettings: async () => ({ success: true }),
       openSoundInputSettings: async () => ({ success: true }),
       checkAccessibilityPermission: async () => !accessibilityMissing(),
       openAccessibilitySettings: async () => ({ success: true }),
       markMacAccessibilityFeaturesReady: () => {},
       beginOnboardingDemo: async ({ id, kind }: { id: string; kind: OnboardingDemoKind }) => {
         endSession();
         session = { id, kind };
         return true;
       },
       endOnboardingDemo: async (id: string) => {
         if (session?.id === id) endSession();
         return true;
       },
       stopOnboardingDemo: async (id: string) => {
         if (session?.id !== id) return false;
         stopTrial();
         return true;
       },
       toggleOnboardingDemo: async (id: string) => {
         if (session?.id !== id || session.kind !== "dictation" || take === "processing") return false;
         if (take === "recording") stopTrial();
         else startTrial();
         return true;
       },
       // Desktop parity (Task 4's _cancelOnboardingTake): cancels recording *or* processing.
       cancelOnboardingDemo: async (id: string) => {
         if (session?.id !== id || take === "idle") return false;
         take = "idle";
         clearTrialTimers();
         emitDemo({ status: "cancelled" });
         return true;
       },
       // Desktop parity before Plan 04 (§5.2 fallback): no Undo. Task 22 replaces this.
       undoOnboardingDemoCancel: async (_id: string) => false,
       onOnboardingDemoEvent: subscribe(demoListeners),
       onDictationHotkeyEvent: subscribe(hotkeyListeners),
     } satisfies Partial<Window["electronAPI"]>;

     return { api, simulateHotkey, reset };
   }
   ```

   `satisfies` makes TypeScript check every fake against the preload contract, so `createBrowserPreviewAPI` can spread `setup.api` without a cast (I11). If it reports a mismatch, fix the fake to match the real type, not the other way round.

2. In `src/preview/browserPreview.ts`, make three edits:
   - Extend `declare global` with `loquiPreviewBridge?: { simulateHotkey(phase: "down" | "up"): void; reset(): void };`.
   - Change `createBrowserPreviewAPI()` to `createBrowserPreviewAPI(setup: ReturnType<typeof createOnboardingScenarioBridge>)`. Keep its existing `Partial<Window["electronAPI"]>` return type. Delete its entries for `checkParakeetModelStatus`, `modelGetActiveDownloads`, `onParakeetDownloadProgress`, `downloadParakeetModel`, `checkMicrophoneAccess`, `checkAccessibilityPermission` and `openAccessibilitySettings`. Then add `...setup.api,` as the last entry of the returned object.
   - In `installBrowserPreview()`, replace the `window.electronAPI = …` line with:

     ```ts
       const setup = createOnboardingScenarioBridge(
         () => window.loquiBrowserPreviewConfig ?? parseOnboardingPreviewConfig(window.location.search)
       );
       window.loquiPreviewBridge = { simulateHotkey: setup.simulateHotkey, reset: setup.reset };
       window.electronAPI = createBrowserPreviewAPI(setup) as Window["electronAPI"];
     ```

     and add `import { createOnboardingScenarioBridge } from "./onboardingScenarioBridge";`.

3. In `src/preview/BrowserPreview.tsx`, add `window.loquiPreviewBridge?.reset();` as the first line of `updateConfig`. Then add a toolbar button next to the scenario select, rendered only when `setup` is true. The toolbar is dev-only and its existing labels ("Light theme") are untranslated English, so match that.

   ```tsx
   <button
     type="button"
     className="browser-preview-button"
     onPointerDown={() => window.loquiPreviewBridge?.simulateHotkey("down")}
     onPointerUp={() => window.loquiPreviewBridge?.simulateHotkey("up")}
     onKeyDown={(event) => {
       if ((event.key === " " || event.key === "Enter") && !event.repeat) {
         event.preventDefault();
         window.loquiPreviewBridge?.simulateHotkey("down");
       }
     }}
     onKeyUp={(event) => {
       if (event.key === " " || event.key === "Enter") window.loquiPreviewBridge?.simulateHotkey("up");
     }}
   >
     Hold shortcut
   </button>
   ```

4. In `docs/ONBOARDING_PREVIEW.md`:
   - Replace the "Supported steps…" sentence with "Supported steps are `welcome` (Hello), `speech` (Voice), `try` (Say something), `cleanup`, `shortcuts`, and `finish` (Ready)."
   - Replace the scenario list with all 14 values.
   - Add the scenario table from this task's Interfaces block.
   - Add one paragraph: "Hold **Hold shortcut** in the toolbar to press the dictation shortcut. Tap mode toggles recording on press; set `activationMode` to `push` in storage to hold-to-talk."

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/preview/onboardingScenarioBridge.test.js && npm run typecheck`
Expected: PASS (12 tests).

Then smoke the preview: run `npm run dev:renderer` and open `http://127.0.0.1:5183/?preview=onboarding&step=speech&scenario=downloading`. The legacy speech step still renders. Its own preview branch stays until Task 13.

- [ ] **Step 5: Commit**

```bash
git add src/preview/onboardingScenarioBridge.ts src/preview/browserPreview.ts src/preview/BrowserPreview.tsx docs/ONBOARDING_PREVIEW.md test/preview/onboardingScenarioBridge.test.js
git commit -m "feat(preview): scenario bridge for downloads, trial, shortcut presses and system profile"
```

---

### Task 9: Extend Plan 02's harness, and the radio group

Covers ONB-Q12, and adds the component harness every later task uses. Plan 02 already moved the fake DOM into `test/helpers/harness/fakeDomTree.js`, which returns `{ container, click, text, find, props }`. It also published `rendererMocks.js`. This task **extends** both compatibly, so there is still one harness (I13). The extensions make focus and selectors testable (M03).

**Files:**
- Modify: `test/helpers/harness/fakeDomTree.js` (Plan 02 Task 6). It gains node methods and returned helpers. Every existing member keeps its behaviour.
- Create: `test/helpers/harness/mountComponent.js`
- Create: `src/components/onboarding/radioNavigation.ts`
- Create: `src/components/onboarding/RadioCardGroup.tsx`
- Create: `src/styles/onboarding.css`
- Modify: `src/components/OnboardingFlow.tsx`. Add `import "../styles/onboarding.css";` after its existing style imports.
- Test: `test/components/onboardingRadioGroup.test.js`

**Interfaces:**
- `installTree()` keeps `{ container, click, text, find, props }`. Its additions:
  - `click(labelOrNode)` now also accepts a node, and passes a minimal event `{ preventDefault, stopPropagation, currentTarget, target }`.
  - `press(node, key, extra?)` calls the node's `onKeyDown` with `{ key, repeat: false, … }`.
  - `findAll(predicate)` and `byAttr(name, value?)`.
  - Nodes gain `getAttribute`, `style.setProperty` and `style.removeProperty`, `focus()`, and `querySelector(selector)`. Focus sets `document.activeElement`. The selector supports a tag, `[attr]` and `[attr="v"]`.
- `mountComponent(t, modulePath, { api?, props?, exportName?, storage?, mocks?, reducedMotion?, windowProps? })` returns the tree plus `{ vite, calls, storage, unmount(), rerender(next) }`.
  - `calls` logs every `electronAPI` method used, including nested ones (`personalInference.codexStatus`). An unknown `on*` method returns an unsubscribe; any other unknown method resolves.
  - Mocks come from Plan 02's `rendererOptions` (`I18N_KEYS_MOCK`) plus `"/ui/useToast": TOAST_MOCK`.
- `expectKey(ui, key, values?)` asserts the rendered `key(name=value,…)`, in any order.
- `radioNavigation.ts`:
  - `nextRadioIndex(current, key, disabled, dir?)`;
  - `rovingTabIndex(index, selected, disabled)`.
- `RadioCardGroup` props: `label`, `idPrefix`, `options` (`value`, `label`, `description?`, `meta?`, `badge?`, `disabledReason?`), `value`, `onChange`, `variant?: "cards" | "segmented"`, `className?`.

- [ ] **Step 1: Write the failing test**

Create `test/components/onboardingRadioGroup.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const nav = () => import("../../src/components/onboarding/radioNavigation.ts");

test("arrow keys follow reading direction, skip disabled options and wrap", async () => {
  const { nextRadioIndex, rovingTabIndex } = await nav();
  const disabled = [false, false, true];
  assert.equal(nextRadioIndex(1, "ArrowDown", disabled), 0);
  assert.equal(nextRadioIndex(0, "ArrowLeft", disabled), 1);
  assert.equal(nextRadioIndex(0, "ArrowLeft", disabled, "rtl"), 1, "in RTL, left moves forward");
  assert.equal(nextRadioIndex(1, "ArrowRight", disabled, "rtl"), 0);
  assert.equal(nextRadioIndex(2, "Home", [true, false, false]), 1);
  assert.equal(nextRadioIndex(0, "End", [false, false, true]), 1);
  assert.equal(nextRadioIndex(0, "Tab", disabled), null);
  assert.equal(nextRadioIndex(0, "ArrowDown", [true, true]), null);
  assert.equal(rovingTabIndex(2, -1, [true, true, false]), 0);
});

const options = () => [
  { value: "a", label: "Fast and English" },
  { value: "b", label: "Many languages" },
  { value: "c", label: "Live captions", disabledReason: "Doesn't hear Japanese" },
];

async function group(t, props = {}) {
  const chosen = [];
  const ui = await mountComponent(t, "/components/onboarding/RadioCardGroup.tsx", {
    exportName: "RadioCardGroup",
    props: { label: "Voices", idPrefix: "voice", value: "b", onChange: (value) => chosen.push(value), options: options(), ...props },
  });
  return { ui, chosen };
}

test("renders a named radio group with one tab stop and readable disabled reasons", async (t) => {
  const { ui } = await group(t);
  assert.equal(ui.byAttr("role", "radiogroup")[0].attributes["aria-label"], "Voices");
  const radios = ui.byAttr("role", "radio");
  assert.deepEqual(
    radios.map((radio) => [radio.attributes["aria-checked"], radio.attributes.tabindex]),
    [["false", "-1"], ["true", "0"], ["false", "-1"]]
  );
  assert.equal(radios[2].attributes["aria-disabled"], "true");
  assert.ok(ui.byAttr("id", radios[2].attributes["aria-describedby"])[0].textContent.includes("Doesn't hear Japanese"));
});

test("arrow keys select and move focus; disabled options are skipped and never chosen", async (t) => {
  const { ui, chosen } = await group(t);
  const radios = ui.byAttr("role", "radio");
  await ui.press(radios[1], "ArrowDown");
  assert.equal(globalThis.document.activeElement, radios[0], "focus follows the selection (M03)");
  await ui.click(radios[2]);
  assert.deepEqual(chosen, ["a"]);
});

test("the segmented variant is marked for styling", async (t) => {
  const { ui } = await group(t, { variant: "segmented" });
  assert.equal(ui.byAttr("role", "radiogroup")[0].attributes["data-variant"], "segmented");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/onboardingRadioGroup.test.js`

Expected: FAIL with `Cannot find module '../helpers/harness/mountComponent'`.

- [ ] **Step 3: Implement**

1. Extend `test/helpers/harness/fakeDomTree.js`. Keep every existing line, and add only what follows.

   In the node factory `make()`, replace `style: {}` with:

   ```js
         // React writes CSS custom properties through setProperty.
         style: {
           setProperty(name, value) { this[name] = String(value); },
           removeProperty(name) { delete this[name]; },
         },
   ```

   Then replace the no-op `focus()` and `querySelector: () => null` with:

   ```js
         getAttribute(name) {
           return name in node.attributes ? node.attributes[name] : null;
         },
         focus() {
           document.activeElement = node;
         },
         // Enough of querySelector for focus effects: "h1", "[data-x]", '[role="radio"]'.
         querySelector(selector) {
           const match = selector.match(/^([a-z0-9]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i);
           if (!match) return null;
           const [, tag, attr, value] = match;
           let found = null;
           const visit = (current) => {
             for (const child of current.childNodes) {
               if (found) return;
               if (
                 child.nodeType === 1 &&
                 (!tag || child.tagName === tag.toUpperCase()) &&
                 (!attr || (attr in child.attributes && (value === undefined || child.attributes[attr] === value)))
               ) {
                 found = child;
                 return;
               }
               visit(child);
             }
           };
           visit(node);
           return found;
         },
   ```

   The container node is built with `make()` too, so `container.querySelector` works.

   Replace the returned object (`return { container, click, text, find, props };`) with:

   ```js
     const findAll = (predicate) => {
       const out = [];
       walk(container, (node) => {
         if (node.nodeType === 1 && predicate(node)) out.push(node);
       });
       return out;
     };
     const byAttr = (name, value) =>
       findAll((node) => (value === undefined ? name in node.attributes : node.attributes[name] === String(value)));
     const eventFor = (node, extra = {}) => ({
       preventDefault() {},
       stopPropagation() {},
       currentTarget: node,
       target: node,
       ...extra,
     });
     // Plan 02's click(label) keeps working; it now also takes a node and passes an event.
     const clickAny = async (labelOrNode) => {
       if (typeof labelOrNode === "string") return click(labelOrNode);
       assert.ok(labelOrNode, "node to click exists");
       await React.act(async () => {
         void props(labelOrNode).onClick?.(eventFor(labelOrNode));
       });
     };
     const press = async (node, key, extra = {}) => {
       await React.act(async () => {
         void props(node).onKeyDown?.(eventFor(node, { key, repeat: false, ...extra }));
       });
     };
     return { container, click: clickAny, text, find, props, findAll, byAttr, press };
   ```

   If the file does not already import `assert` and `React` at the top, add `const assert = require("node:assert/strict");` and `const React = require("react");`.

2. Create `test/helpers/harness/mountComponent.js`:

   ```js
   const assert = require("node:assert/strict");
   const React = require("react");
   const { createRoot } = require("react-dom/client");
   const { createRendererServer, installBrowserGlobals, installHookDom } = require("../../lib/rendererTestHarness");
   const { installTree } = require("./fakeDomTree");
   const { rendererOptions, TOAST_MOCK } = require("./rendererMocks");

   // Logs every electronAPI call, including nested objects (personalInference.*),
   // so flow tests can assert that nothing implicit (accounts, downloads) ran.
   function electronApiProxy(api, calls = [], prefix = "") {
     const unknown = (name) =>
       new Proxy(function stub() {}, {
         apply(_target, _this, args) {
           calls.push([name, ...args]);
           return /(^|\.)on[A-Z]/.test(name) ? () => {} : Promise.resolve();
         },
         get(_target, key) {
           if (typeof key === "symbol" || key === "then") return undefined;
           return unknown(`${name}.${String(key)}`);
         },
       });
     return new Proxy(api, {
       get(target, key) {
         if (typeof key === "symbol" || key === "then") return target[key];
         const name = `${prefix}${String(key)}`;
         const value = target[key];
         if (typeof value === "function") {
           return (...args) => {
             calls.push([name, ...args]);
             return value.apply(target, args);
           };
         }
         if (value && typeof value === "object") return electronApiProxy(value, calls, `${name}.`);
         return key in target ? value : unknown(name);
       },
     });
   }

   async function mountComponent(
     t,
     modulePath,
     { api = {}, props = {}, exportName = "default", storage = {}, mocks = {}, reducedMotion = false, windowProps = {} } = {}
   ) {
     let root = null;
     const calls = [];
     const unmount = async () => {
       if (!root) return;
       const current = root;
       root = null;
       await React.act(async () => current.unmount());
     };
     t.after(unmount);
     const globals = installBrowserGlobals(t, {
       initialStorage: storage,
       window: {
         electronAPI: electronApiProxy(api, calls),
         matchMedia: (query) => ({ matches: reducedMotion && query.includes("reduce"), addEventListener() {}, removeEventListener() {} }),
         ...windowProps,
       },
     });
     installHookDom(t);
     const tree = installTree();
     const vite = await createRendererServer(
       t,
       rendererOptions("loqui-onboarding-ui-test-", { "/ui/useToast": TOAST_MOCK, ...mocks })
     );
     const Component = (await vite.ssrLoadModule(modulePath))[exportName];
     let currentProps = props;
     root = createRoot(tree.container);
     await React.act(async () => root.render(React.createElement(Component, currentProps)));
     return {
       ...tree,
       vite,
       calls,
       storage: globals.storage,
       unmount,
       async rerender(next) {
         currentProps = { ...currentProps, ...next };
         await React.act(async () => root.render(React.createElement(Component, currentProps)));
       },
     };
   }

   // I18N_KEYS_MOCK renders t("k", { a: 1 }) as "k(a=1)"; order-independent check.
   function expectKey(ui, key, values) {
     const text = ui.text();
     if (!values) {
       assert.ok(text.includes(key), `${key} is rendered`);
       return;
     }
     const start = text.indexOf(`${key}(`);
     assert.ok(start >= 0, `${key}(…) is rendered`);
     for (const [name, value] of Object.entries(values)) {
       assert.ok(text.slice(start).includes(`${name}=${value}`), `${key} carries ${name}=${value}`);
     }
   }

   module.exports = { mountComponent, expectKey, electronApiProxy };
   ```

3. Create `src/components/onboarding/radioNavigation.ts`:

   ```ts
   // Radio-group keyboard model (WAI-ARIA APG): arrows move and select, skipping
   // disabled options and wrapping; left/right follow reading direction.
   export function nextRadioIndex(current: number, key: string, disabled: readonly boolean[], dir: "ltr" | "rtl" = "ltr"): number | null {
     const count = disabled.length;
     if (count === 0 || disabled.every(Boolean)) return null;
     const step = (from: number, delta: 1 | -1): number | null => {
       let index = from;
       for (let tries = 0; tries < count; tries++) {
         index = (index + delta + count) % count;
         if (!disabled[index]) return index;
       }
       return null;
     };
     const forward = ["ArrowDown", dir === "rtl" ? "ArrowLeft" : "ArrowRight"];
     const backward = ["ArrowUp", dir === "rtl" ? "ArrowRight" : "ArrowLeft"];
     if (key === "Home") return step(count - 1, 1);
     if (key === "End") return step(0, -1);
     if (forward.includes(key)) return step(current, 1);
     if (backward.includes(key)) return step(current, -1);
     return null;
   }

   export function rovingTabIndex(index: number, selected: number, disabled: readonly boolean[]): 0 | -1 {
     const stop = selected >= 0 && !disabled[selected] ? selected : disabled.findIndex((value) => !value);
     return index === stop ? 0 : -1;
   }
   ```

4. Create `src/components/onboarding/RadioCardGroup.tsx`:

   ```tsx
   import { useRef, type KeyboardEvent, type ReactNode } from "react";
   import { cn } from "../lib/utils";
   import { nextRadioIndex, rovingTabIndex } from "./radioNavigation";

   export interface RadioCardOption<T extends string> {
     value: T;
     label: ReactNode;
     description?: ReactNode;
     meta?: ReactNode;
     badge?: ReactNode;
     disabledReason?: string;
   }

   export interface RadioCardGroupProps<T extends string> {
     label: string;
     idPrefix: string;
     options: readonly RadioCardOption<T>[];
     value: T | null;
     onChange(value: T): void;
     variant?: "cards" | "segmented";
     className?: string;
   }

   /** One accessible single-choice group for voices and cleanup (ONB-Q12). */
   export function RadioCardGroup<T extends string>({ label, idPrefix, options, value, onChange, variant = "cards", className }: RadioCardGroupProps<T>) {
     const refs = useRef<(HTMLButtonElement | null)[]>([]);
     const disabled = options.map((option) => Boolean(option.disabledReason));
     const selected = options.findIndex((option) => option.value === value);

     const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
       const dir = globalThis.document?.documentElement?.dir === "rtl" ? "rtl" : "ltr";
       const next = nextRadioIndex(index, event.key, disabled, dir);
       if (next === null) return;
       event.preventDefault();
       onChange(options[next].value);
       refs.current[next]?.focus();
     };

     return (
       <div role="radiogroup" aria-label={label} data-variant={variant} className={cn("onb-radio-group", className)}>
         {options.map((option, index) => {
           const reasonId = option.disabledReason ? `${idPrefix}-${option.value}-reason` : undefined;
           return (
             <button
               key={option.value}
               ref={(element) => {
                 refs.current[index] = element;
               }}
               type="button"
               role="radio"
               aria-checked={option.value === value}
               aria-disabled={option.disabledReason ? true : undefined}
               aria-describedby={reasonId}
               tabIndex={rovingTabIndex(index, selected, disabled)}
               data-value={option.value}
               className="onb-radio"
               onClick={() => {
                 if (!option.disabledReason) onChange(option.value);
               }}
               onKeyDown={onKeyDown(index)}
             >
               <span className="onb-radio__label">
                 {option.label}
                 {option.badge}
               </span>
               {option.description ? <span className="onb-radio__description">{option.description}</span> : null}
               {option.meta ? <span className="onb-radio__meta">{option.meta}</span> : null}
               {reasonId ? (
                 <span id={reasonId} className="onb-radio__reason">
                   {option.disabledReason}
                 </span>
               ) : null}
             </button>
           );
         })}
       </div>
     );
   }
   ```

5. Create `src/styles/onboarding.css`, using tokens only:

   ```css
   /* Loqui setup. Tokens only (DESIGN.md "Onboarding"): no hex, no raw durations. */

   .onb-radio-group {
     display: grid;
     gap: 8px;
   }

   .onb-radio {
     display: grid;
     gap: 2px;
     padding: 12px 14px;
     border: 1px solid var(--color-border);
     border-radius: 10px;
     background: var(--color-card);
     color: var(--color-foreground);
     text-align: start;
     cursor: pointer;
   }

   .onb-radio[aria-checked="true"] {
     border-color: var(--color-live);
     background: color-mix(in oklab, var(--color-live) 8%, var(--color-card));
   }

   .onb-radio[aria-disabled="true"] {
     cursor: not-allowed;
     color: var(--color-muted-foreground);
   }

   .onb-radio:focus-visible {
     outline: 2px solid var(--color-ring);
     outline-offset: 2px;
   }

   .onb-radio__label {
     display: flex;
     align-items: center;
     gap: 8px;
     font-size: 14px;
     font-weight: 600;
   }

   .onb-radio__description,
   .onb-radio__meta,
   .onb-radio__reason {
     font-size: 12px;
     color: var(--color-muted-foreground);
   }

   .onb-radio-group[data-variant="segmented"] {
     grid-auto-flow: column;
     grid-auto-columns: minmax(0, 1fr);
     gap: 0;
     padding: 3px;
     border: 1px solid var(--color-border);
     border-radius: 9999px;
     background: var(--color-muted);
   }

   .onb-radio-group[data-variant="segmented"] .onb-radio {
     justify-items: center;
     padding: 6px 10px;
     border: 0;
     border-radius: 9999px;
     background: transparent;
   }

   .onb-radio-group[data-variant="segmented"] .onb-radio[aria-checked="true"] {
     background: var(--color-card);
     box-shadow: 0 1px 2px color-mix(in oklab, var(--color-foreground) 12%, transparent);
   }
   ```

6. Add `import "../styles/onboarding.css";` to `src/components/OnboardingFlow.tsx` after its existing style imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/onboardingRadioGroup.test.js test/components/onboardingCleanupWiring.test.js test/components/onboardingDownloadProgress.test.js test/components/chatComposer.test.js`

Expected: PASS. Plan 02's consumers of `fakeDomTree.js` pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/harness/fakeDomTree.js test/helpers/harness/mountComponent.js src/components/onboarding/radioNavigation.ts src/components/onboarding/RadioCardGroup.tsx src/styles/onboarding.css src/components/OnboardingFlow.tsx test/components/onboardingRadioGroup.test.js
git commit -m "feat(onboarding): accessible radio group on an extended shared fake DOM"
```

---

### Task 10: Recovery card, focus re-check and microphone access

Covers ONB-Q6. It is the recovery pattern R5 C reuses for Accessibility.

**Files:**
- Create: `src/components/onboarding/RecoveryCard.tsx`
- Create: `src/components/onboarding/useRecheckOnFocus.ts`
- Create: `src/components/onboarding/useMicrophoneAccess.ts`
- Modify: `src/styles/onboarding.css` (append)
- Test: `test/components/onboardingRecovery.test.js`

**Interfaces:**
- Consumes `checkMicrophoneAccess`, `requestMicrophoneAccess`, `openMicrophoneSettings` and `openSoundInputSettings` (`src/types/electron.ts:1655-1667`, `preload.js:680-688`).
- Produces:

  ```tsx
  export interface RecoveryAction { label: string; onClick(): void; variant?: "default" | "ghost" | "live" }
  export interface RecoveryCardProps { title: string; body: string; actions: readonly RecoveryAction[]; tone?: "warning" | "neutral" }
  export function RecoveryCard(props: RecoveryCardProps): JSX.Element; // role="alert"
  export const RECHECK_POLL_MS = 2000;
  export function useRecheckOnFocus(check: () => unknown, enabled: boolean): void;
  export type MicAccess = "unknown" | "granted" | "denied";
  export function micAccessFrom(result: { granted?: boolean; status?: string } | null | undefined): MicAccess;
  export function useMicrophoneAccess(): { access: MicAccess; check(): Promise<void>; request(): Promise<boolean> };
  export function openMicrophoneHelp(platform: "darwin" | "linux" | "win32"): Promise<unknown>;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/onboardingRecovery.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { mountComponent } = require("../helpers/harness/mountComponent");

test("microphone status maps to three honest states", async () => {
  const { micAccessFrom } = await import("../../src/components/onboarding/useMicrophoneAccess.ts");
  assert.equal(micAccessFrom({ granted: true, status: "granted" }), "granted");
  assert.equal(micAccessFrom({ granted: false, status: "not-determined" }), "unknown");
  assert.equal(micAccessFrom({ granted: false, status: "denied" }), "denied");
  assert.equal(micAccessFrom({ granted: false, status: "restricted" }), "denied");
  assert.equal(micAccessFrom(undefined), "unknown");
});

test("the recovery card is one alert with one sentence and its actions", async (t) => {
  const clicks = [];
  const ui = await mountComponent(t, "/components/onboarding/RecoveryCard.tsx", {
    exportName: "RecoveryCard",
    props: {
      title: "Loqui can't use your microphone",
      body: "Allow it in System Settings, then come back.",
      actions: [
        { label: "Open System Settings", onClick: () => clicks.push("open") },
        { label: "I've turned it on", onClick: () => clicks.push("recheck"), variant: "ghost" },
      ],
    },
  });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  assert.equal(ui.text().split("Allow it in System Settings").length - 1, 1, "the cause is said once");
  await ui.click("Open System Settings");
  await ui.click("I've turned it on");
  assert.deepEqual(clicks, ["open", "recheck"]);
});

test("re-checks on window focus and every 2 s while enabled, and stops when disabled", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const listeners = new Map();
  installBrowserGlobals(t, {
    window: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-recheck-test-" });
  const { useRecheckOnFocus, RECHECK_POLL_MS } = await vite.ssrLoadModule("/components/onboarding/useRecheckOnFocus.ts");
  let checks = 0;
  function Harness({ enabled }) {
    useRecheckOnFocus(() => checks++, enabled);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness, { enabled: true })));
  listeners.get("focus")();
  t.mock.timers.tick(RECHECK_POLL_MS * 2);
  assert.equal(checks, 3);
  await React.act(async () => root.render(React.createElement(Harness, { enabled: false })));
  assert.equal(listeners.has("focus"), false);
  t.mock.timers.tick(RECHECK_POLL_MS * 3);
  assert.equal(checks, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/onboardingRecovery.test.js`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

1. Create `src/components/onboarding/useRecheckOnFocus.ts`:

   ```ts
   import { useEffect, useRef } from "react";

   export const RECHECK_POLL_MS = 2000;

   /**
    * Permission recovery re-checks when the user comes back from System Settings
    * (window focus) and on a 2 s poll while the recovery card is visible.
    */
   export function useRecheckOnFocus(check: () => unknown, enabled: boolean): void {
     const checkRef = useRef(check);
     checkRef.current = check;
     useEffect(() => {
       if (!enabled) return;
       const run = () => void checkRef.current();
       window.addEventListener("focus", run);
       const id = setInterval(run, RECHECK_POLL_MS);
       return () => {
         window.removeEventListener("focus", run);
         clearInterval(id);
       };
     }, [enabled]);
   }
   ```

2. Create `src/components/onboarding/useMicrophoneAccess.ts`:

   ```ts
   import { useCallback, useEffect, useState } from "react";
   import { useRecheckOnFocus } from "./useRecheckOnFocus";

   export type MicAccess = "unknown" | "granted" | "denied";

   export function micAccessFrom(result: { granted?: boolean; status?: string } | null | undefined): MicAccess {
     if (!result) return "unknown";
     if (result.granted) return "granted";
     return result.status === "not-determined" ? "unknown" : "denied";
   }

   export function useMicrophoneAccess() {
     const [access, setAccess] = useState<MicAccess>("unknown");
     const check = useCallback(async () => {
       setAccess(micAccessFrom(await window.electronAPI?.checkMicrophoneAccess?.()));
     }, []);
     const request = useCallback(async () => {
       const result = await window.electronAPI?.requestMicrophoneAccess?.();
       const granted = Boolean(result?.granted);
       setAccess(granted ? "granted" : "denied");
       return granted;
     }, []);
     useEffect(() => {
       void check();
     }, [check]);
     useRecheckOnFocus(check, access === "denied");
     return { access, check, request };
   }

   /** macOS and Windows open the privacy pane; Linux has no deep link, so sound settings. */
   export function openMicrophoneHelp(platform: "darwin" | "linux" | "win32") {
     return platform === "linux"
       ? window.electronAPI?.openSoundInputSettings?.()
       : window.electronAPI?.openMicrophoneSettings?.();
   }
   ```

3. Create `src/components/onboarding/RecoveryCard.tsx`:

   ```tsx
   import { CircleAlert } from "../icons";
   import { Button } from "../ui/button";

   export interface RecoveryAction {
     label: string;
     onClick(): void;
     variant?: "default" | "ghost" | "live";
   }

   export interface RecoveryCardProps {
     title: string;
     body: string;
     actions: readonly RecoveryAction[];
     tone?: "warning" | "neutral";
   }

   /** One card for every setup failure that has a fix (ONB-Q6, R5 C). */
   export function RecoveryCard({ title, body, actions, tone = "warning" }: RecoveryCardProps) {
     return (
       <div role="alert" className="onb-recovery" data-tone={tone}>
         <CircleAlert aria-hidden="true" className="onb-recovery__icon" />
         <div className="onb-recovery__copy">
           <p className="onb-recovery__title">{title}</p>
           <p className="onb-recovery__body">{body}</p>
           <div className="onb-recovery__actions">
             {actions.map((action) => (
               <Button key={action.label} size="sm" variant={action.variant ?? "default"} onClick={action.onClick}>
                 {action.label}
               </Button>
             ))}
           </div>
         </div>
       </div>
     );
   }
   ```

4. Append to `src/styles/onboarding.css`:

   ```css
   .onb-recovery {
     display: grid;
     grid-template-columns: 20px minmax(0, 1fr);
     gap: 12px;
     padding: 14px 16px;
     border: 1px solid color-mix(in oklab, var(--color-warning) 30%, transparent);
     border-radius: 12px;
     background: color-mix(in oklab, var(--color-warning) 5%, var(--color-card));
   }

   .onb-recovery[data-tone="neutral"] {
     border-color: var(--color-border);
     background: var(--color-card);
   }

   .onb-recovery__icon {
     width: 20px;
     height: 20px;
     color: var(--color-warning);
   }

   .onb-recovery__title {
     font-size: 14px;
     font-weight: 600;
   }

   .onb-recovery__body {
     margin-top: 2px;
     font-size: 13px;
     color: var(--color-muted-foreground);
   }

   .onb-recovery__actions {
     display: flex;
     flex-wrap: wrap;
     gap: 8px;
     margin-top: 10px;
   }
   ```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/components/onboardingRecovery.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/RecoveryCard.tsx src/components/onboarding/useRecheckOnFocus.ts src/components/onboarding/useMicrophoneAccess.ts src/styles/onboarding.css test/components/onboardingRecovery.test.js
git commit -m "feat(onboarding): recovery card with focus re-check and microphone access"
```

---

### Task 11: The shell and the instrument rail

Covers:
- ONB-R1 C;
- the ONB-M2 driver and settle/bubble stage (M02);
- ONB-Q11, Q13, Q15 and Q16, plus the shell half of Q4;
- M04 (zoom and long labels);
- the M05 mechanical fixes.

It keeps ONB-Q1 (Plan 02): the pinned shell and the physical traffic-light inset.

**Files:**
- Create: `src/components/onboarding/instrumentMath.ts`, `src/components/onboarding/InstrumentRail.tsx`, `src/components/onboarding/OnboardingShell.tsx`
- Modify: `src/styles/onboarding.css` (append)
- Modify: `src/components/ui/LevelBars.tsx` (Plan 01). Add the optional `tone?: "brand" | "onLive"` prop, defaulting to `"brand"`. Spec §5 records this as Plan 05's extension; it replaces the scoped `!important` override.
- Modify: `src/index.css`. Delete the orphaned onboarding rules listed in Step 3.6, finding each by selector.
- Modify: `src/components/ui/ActivationModeSelector.tsx`. Remove the dead `onboarding` variant.
- Modify: `src/components/ui/ProviderIcon.tsx`. Remove the dead `monochrome` prop (line 7), its default (13) and its class branch (35). No caller passes it.
- Modify: `src/components/OnboardingFlow.tsx`. Apply the **[T11]** blocks of the composition, and delete:
  - `STEPS`, `GUIDED_STEP_COPY` and `StepShell`;
  - `handleContinue`, `handleBack` and `handleSkip`;
  - the `persist` helper;
  - the `progress` state;
  - the final `<StepShell>` render.
- Modify: `DESIGN.md`. Change line 151 (Onboarding title) and the onboarding Layout sentence (≈160), and add `### Onboarding` under `## Components`.
- Modify: `test/components/personalWorkspace.test.js`. Delete "first setup reaches completion without account APIs or implicit downloads" (69-96). Its replacement below keeps the no-account check.
- Test: `test/components/onboardingShell.test.js` (append to Plan 02's file of the same name), `test/components/onboardingFlow.test.js`, and append to Plan 01's `test/components/levelBars.test.js`

**Interfaces:**
- `instrumentMath.ts`:
  - `InstrumentMode`: `idle | download{percent, downloadedBytes, totalBytes} | listening{heardVoice} | processing | success | error{reason}`. `processing` keeps the take's meter mounted (R3-M01);
  - `INSTRUMENT_HEIGHT = 140`, `ERROR_FILL = 0.3`, `SETTLE_MS = 520` (`--motion-hero`, stage 1: the live bars settle) and `DRAW_MS = 360` (`--motion-slow`, stage 2: the bubble draws). The dock (stage 3) starts after both (R2-M01);
  - `barHeights()`, `instrumentFills(mode)` and `instrumentCaption(mode, locale)`;
  - `dockMark(update, { reducedMotion, doc })` returns `"transition" | "instant"`.
- `InstrumentRail({ title, body, mode, readLevel? })`. It passes `tone="onLive"` to `LevelBars` while the rail is the solid `--color-live` surface (light theme), and `"brand"` on Plum Night's tinted rail.
- `LevelBars` (Plan 01, extended here): `tone?: "brand" | "onLive"`, default `"brand"`. `"onLive"` paints paper bars (`var(--color-background)`) for a `--color-live` surface; `"brand"` keeps the orange-to-magenta gradient.
- `OnboardingShell`:

  ```ts
  export interface OnboardingShellProps {
    step: OnboardingStep; visited: readonly OnboardingStep[]; platform: "darwin" | "linux" | "win32";
    rail: InstrumentRailProps; docked?: boolean;
    onNavigate(step: OnboardingStep): void; onBack?: () => void; onSkip?: () => void;
    finishLater?: { label: string; onClick(): void };
    primary?: { label: string; onClick(): void; disabled?: boolean; describedBy?: string };
    footerStart?: ReactNode; announcement?: string; children: ReactNode;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/components/onboardingShell.test.js`. This is Plan 02's file, and its three ONB-Q1 tests stay as they are until Task 18 deletes `onboarding-welcome.css`.

```js
const { resolveTokens } = require("../helpers/harness/cssTokens");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");
const React = require("react");

const setupCss = () => read("src/styles/onboarding.css");

test("the new shell is pinned, keeps 56/64 chrome, and clears the traffic lights physically (ONB-Q1)", () => {
  const source = setupCss();
  assert.match(source, /--onb-header:\s*56px/);
  assert.match(source, /--onb-footer:\s*64px/);
  assert.match(source, /\.onb-shell\s*\{[^}]*height:\s*100dvh/);
  assert.match(source, /\.onb-shell\[data-platform="darwin"\] \.onb-header\s*\{[^}]*padding-left:\s*84px/);
  assert.doesNotMatch(source, /\[data-platform="darwin"\] \.onb-header\s*\{[^}]*padding-inline-start/, "the lights stay left in RTL");
});

test("small windows, 200% zoom and long labels keep every action reachable (M04)", () => {
  const source = setupCss();
  const narrow = source.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(narrow);
  assert.match(narrow[1], /\.onb-main\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(source, /\.onb-footer\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(source, /\.onb-progress__label\s*\{[^}]*text-overflow:\s*ellipsis/);
  const compact = source.match(/@media \(max-width: 900px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(compact, "a header simplification exists below 900px (200% zoom of an 1800px window)");
  assert.match(compact[1], /\.onb-brand strong\s*\{[^}]*display:\s*none/);
});

test("setup styles use tokens only: no hex, no raw durations, no text under 12px", () => {
  const source = setupCss();
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
  for (const line of source.split("\n").filter((l) => /^\s*(transition|animation)(-duration)?\s*:/.test(l))) {
    assert.match(line, /var\(--motion-|none/, line.trim());
  }
  for (const [, size] of source.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(size) >= 12, `${size}px`);
});

test("the rendered rail and progress rules meet contrast in light and Plum Night (M03)", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(read("src/index.css"));
  const source = setupCss();
  const token = (selector, property) => {
    const block = source.match(new RegExp(`${selector.replace(/[.[\]"=()]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    assert.ok(block, selector);
    return block[1].match(new RegExp(`${property}:\\s*var\\((--[\\w-]+)\\)`))[1];
  };
  const railBg = token(".onb-rail", "background");
  const railFg = token(".onb-rail", "color");
  assert.ok(contrastRatio(light[railFg], light[railBg]) >= 4.5, "rail text, light");
  assert.ok(contrastRatio(light[token(".onb-bar__fill", "background")], light[railBg]) >= 3, "paper bars on the rail");
  const errorLight = token('.onb-instrument[data-mode="error"] .onb-bar__fill', "background");
  assert.ok(contrastRatio(light[errorLight], light[railBg]) >= 3, "error bars on the light rail (R2-I09)");
  const errorDark = token('.dark .onb-instrument[data-mode="error"] .onb-bar__fill', "background");
  assert.ok(contrastRatio(dark[errorDark], dark["--color-surface-1"]) >= 3, "error bars on the Plum Night rail");
  assert.ok(contrastRatio(dark[token(".dark .onb-rail", "color")], dark["--color-surface-1"]) >= 4.5, "rail text, Plum Night");
  const marker = token('.onb-progress__step[data-state="current"]', "background");
  assert.equal(marker, "--color-nav-marker", "active navigation uses the navigation role (D5)");
  assert.ok(contrastRatio(light[marker], light["--color-background"]) >= 3);
  assert.ok(contrastRatio(dark[marker], dark["--color-background"]) >= 3);
});

test("the orphaned onboarding system is gone from runtime code", () => {
  const index = read("src/index.css");
  for (const selector of [
    ".onboarding-canvas", ".onboarding-keycap", ".onboarding-step-enter", ".onboarding-stagger",
    ".onboarding-pressable", ".onboarding-list", ".onboarding-select", ".onboarding-compact-hero",
    ".onboarding-typing-dot", ".onboarding-display-title", ".onboarding-light-input",
    ".onboarding-provider", ".onboarding-embedded-auth", ".onboarding-card-title", "--onboarding-accent",
  ]) {
    assert.equal(index.includes(selector), false, selector);
  }
  assert.equal(read("src/components/ui/ActivationModeSelector.tsx").includes("onboarding"), false);
  assert.equal(read("src/components/ui/ProviderIcon.tsx").includes("onboarding-provider-icon-monochrome"), false);
});

const shellProps = (patch = {}) => ({
  step: "speech",
  visited: ["welcome", "speech"],
  platform: "darwin",
  rail: { title: "Pick how Loqui listens.", body: "One voice.", mode: { kind: "idle" } },
  onNavigate() {},
  onBack() {},
  primary: { label: "Continue", onClick() {} },
  children: "controls",
  ...patch,
});

test("progress is a nav of the current phase; only visited steps are usable; the heading takes focus", async (t) => {
  const visited = [];
  const ui = await mountComponent(t, "/components/onboarding/OnboardingShell.tsx", {
    exportName: "OnboardingShell",
    props: shellProps({ onNavigate: (step) => visited.push(step) }),
  });
  assert.equal(ui.byAttr("aria-label", "setupFlow.progress.nav").length, 1);
  const steps = ui.findAll((node) => node.attributes.class === "onb-progress__step");
  assert.deepEqual(
    steps.map((node) => [node.attributes["data-state"], "disabled" in node.attributes, node.attributes["aria-current"] ?? null]),
    [["done", false, null], ["current", true, "step"], ["todo", true, null]]
  );
  await ui.click(steps[0]);
  assert.deepEqual(visited, ["welcome"]);
  assert.equal(globalThis.document.activeElement?.tagName, "H1", "every step change moves focus to its heading");
});

test("Hello has no Back, the primary is the neutral capsule, and Ready shows no segments", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/OnboardingShell.tsx", {
    exportName: "OnboardingShell",
    props: shellProps({ step: "welcome", visited: ["welcome"], onBack: undefined }),
  });
  assert.equal(ui.text().includes("setupFlow.back"), false);
  assert.equal(ui.byAttr("data-onb-primary")[0].attributes["data-variant"], "default");
  await ui.rerender({ step: "finish", visited: ["welcome", "finish"] });
  assert.equal(ui.findAll((node) => node.attributes.class === "onb-progress__step").length, 0);
  expectKey(ui, "setupFlow.progress.ready");
});

test("the instrument fills with the download and always says the number", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    props: { title: "Say something.", body: "", mode: { kind: "download", percent: 41.6, downloadedBytes: 264e6, totalBytes: 631e6 } },
  });
  const fills = ui.findAll((node) => node.attributes.class === "onb-bar__fill");
  assert.equal(fills.length, 5);
  assert.ok(fills.every((node) => node.style["--fill"] === "0.42"));
  expectKey(ui, "setupFlow.instrument.downloading", { percent: 42 });
  assert.equal(ui.byAttr("aria-hidden", "true").some((node) => node.attributes.class === "onb-instrument"), true);
});

test("listening hands the bars to LevelBars; errors drop them to 30%; success draws the bubble", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    props: { title: "Hello", body: "", mode: { kind: "listening", heardVoice: false }, readLevel: () => 0 },
  });
  assert.equal(ui.byAttr("data-level-bar").length, 5);
  assert.equal(ui.findAll((node) => node.attributes["data-tone"] !== undefined)[0].attributes["data-tone"], "onLive", "light rail: paper bars via the tone prop");
  expectKey(ui, "setupFlow.instrument.waiting");
  await ui.rerender({ mode: { kind: "error", reason: "noAudio" } });
  assert.ok(ui.findAll((node) => node.attributes.class === "onb-bar__fill").every((node) => node.style["--fill"] === "0.3"));
  expectKey(ui, "setupFlow.instrument.nothingHeard");
  await ui.rerender({ mode: { kind: "success" } });
  assert.equal(ui.byAttr("data-bubble").length, 1, "the speech bubble draws around the settled bars (M02)");
});

// Drives LevelBars' real sampler (window.setInterval + performance.now) on one mocked clock.
function meterClock(t) {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  return {
    windowProps: { setInterval: (cb, ms) => setInterval(cb, ms), clearInterval: (id) => clearInterval(id) },
    async advance(ms) {
      for (let elapsed = 0; elapsed < ms; elapsed += 33) {
        now += 33;
        t.mock.timers.tick(33);
      }
      await React.act(async () => {});
    },
  };
}
const centreScale = (ui) => Number(/scaleY\(([\d.]+)\)/.exec(ui.byAttr("data-level-bar")[2].style.transform)[1]);

test("one meter lives from listening through processing and the settle, easing to rest; then the bubble (R3-M01)", async (t) => {
  const clock = meterClock(t);
  const rail = (mode) => ({ title: "Say something", body: "", mode, readLevel: () => 0.9 });
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    windowProps: clock.windowProps,
    props: rail({ kind: "listening", heardVoice: true }),
  });
  await clock.advance(400);
  const meter = ui.byAttr("data-level-bar");
  const rest = 0.55; // levelBarScale(2, 0, …): the centre bar's rest silhouette (Plan 01 levelBars.test.js)
  const loud = centreScale(ui);
  assert.ok(loud > rest + 0.1, `the live level lifts the centre bar (${loud})`);

  await ui.rerender(rail({ kind: "processing" }));
  assert.equal(ui.byAttr("data-level-bar")[2], meter[2], "processing keeps the same meter instance");
  await clock.advance(132);
  const easing = centreScale(ui);
  assert.ok(easing < loud, "zero input: the bars start to settle during processing");

  await ui.rerender(rail({ kind: "success" }));
  assert.equal(ui.byAttr("data-level-bar")[2], meter[2], "the first success render keeps it too");
  assert.equal(ui.byAttr("data-bubble").length, 0, "stage 1: settle, no bubble yet");
  await clock.advance(480);
  const settled = centreScale(ui);
  assert.ok(Math.abs(settled - rest) < Math.abs(easing - rest), `the same frame eases toward rest (${easing} → ${settled})`);
  await clock.advance(40);
  assert.equal(ui.byAttr("data-level-bar").length, 0, "after SETTLE_MS the meter gives way to the mark");
  assert.equal(ui.byAttr("data-bubble").length, 1, "stage 2: the bubble draws");
});

test("reduced motion swaps to the mark at once; a success with no live take has nothing to settle", async (t) => {
  const reduced = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    reducedMotion: true,
    props: { title: "Say something", body: "", mode: { kind: "listening", heardVoice: true }, readLevel: () => 0.6 },
  });
  await reduced.rerender({ mode: { kind: "processing" } });
  await reduced.rerender({ mode: { kind: "success" } });
  assert.equal(reduced.byAttr("data-bubble").length, 1);
  assert.equal(reduced.byAttr("data-level-bar").length, 0);
  const cold = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    props: { title: "Say something", body: "", mode: { kind: "idle" } },
  });
  await cold.rerender({ mode: { kind: "success" } });
  assert.equal(cold.byAttr("data-bubble").length, 1);
});

test("the dock uses a View Transition unless motion is reduced or unsupported", async () => {
  const { dockMark, SETTLE_MS, DRAW_MS } = await import("../../src/components/onboarding/instrumentMath.ts");
  assert.deepEqual([SETTLE_MS, DRAW_MS], [520, 360]);
  let updates = 0;
  const update = () => updates++;
  assert.equal(dockMark(update, { reducedMotion: false, doc: { startViewTransition: (cb) => cb() } }), "transition");
  assert.equal(dockMark(update, { reducedMotion: true, doc: { startViewTransition: (cb) => cb() } }), "instant");
  assert.equal(dockMark(update, { reducedMotion: false, doc: {} }), "instant");
  assert.equal(updates, 3);
});
```

The file's existing requires (`assert`, `fs`, `path`, `test`, `read`) are reused. Drop the `React` line below if Plan 02's file already declares it. If `read` is not defined there, add `const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");`.

Create `test/components/onboardingFlow.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");
const { listenerBus } = require("../helpers/harness/listenerBus");
const React = require("react");

const PREVIEW = { step: "speech", scenario: "ready", platform: "linux" };
const SETTINGS_PAGE = { "/SettingsPage": "export default function SettingsPage() { return null; }" };

async function mountFlow(t, props = {}, options = {}) {
  const completed = [];
  const ui = await mountComponent(t, "/components/OnboardingFlow.tsx", {
    props: { onComplete: (opts) => completed.push(opts ?? null), previewConfig: PREVIEW, initialStep: "speech", ...props },
    mocks: SETTINGS_PAGE,
    ...options,
  });
  return { ui, completed: () => completed };
}

const primary = (ui) => ui.byAttr("data-onb-primary")[0];
const buttonWithText = (ui, text) => ui.findAll((node) => node.tagName === "BUTTON" && node.textContent.includes(text))[0];
const currentStep = (ui) => ui.byAttr("aria-current", "step")[0]?.attributes["aria-label"] ?? "ready";

// The footer primary when there is one. Say something has none (its band owns the
// next step), so the walk skips it. Ready ends through its own Open workspace (Task 18).
async function advance(ui) {
  const target =
    primary(ui) ?? buttonWithText(ui, "setupFlow.skipStep") ?? buttonWithText(ui, "setupFlow.ready.openWorkspace");
  await ui.click(target);
}

test("Continue walks both phases in order and Ready completes setup once, with no account calls", async (t) => {
  const { ui, completed } = await mountFlow(t);
  const seen = [];
  for (let guard = 0; guard < 8 && completed().length === 0; guard++) {
    seen.push(currentStep(ui));
    await advance(ui);
  }
  assert.deepEqual(seen, [
    "setupFlow.progress.goTo(step=setupFlow.steps.speech)",
    "setupFlow.progress.goTo(step=setupFlow.steps.try)",
    "setupFlow.progress.goTo(step=setupFlow.steps.cleanup)",
    "setupFlow.progress.goTo(step=setupFlow.steps.shortcuts)",
    "ready",
  ]);
  assert.equal(completed().length, 1);
  const accountish = ui.calls.filter(([name]) => /auth|signIn|login|account|cloud/i.test(name));
  assert.deepEqual(accountish, [], "setup never touches accounts (restores the old personalWorkspace check)");
});

test("Finish later exits from any step and remembers where you were", async (t) => {
  const { ui, completed } = await mountFlow(t, { initialStep: "cleanup" });
  await ui.click("setupFlow.finishLater");
  assert.equal(completed().length, 1);
  const stored = JSON.parse(ui.storage.getItem("loqui.onboarding.preview.linux.ready"));
  assert.deepEqual([stored.step, stored.explored, stored.visited], ["cleanup", true, ["cleanup"]]);
});

test("Back goes to the previous step in the new order", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "cleanup" });
  await ui.click("setupFlow.back");
  assert.equal(currentStep(ui), "setupFlow.progress.goTo(step=setupFlow.steps.try)");
});
```

Later tasks append their flow tests to this file, so they reuse `mountFlow`, `advance`, `currentStep`, `primary` and `buttonWithText` directly. Never `require` a test file from another, because that would register its tests twice.

Append to Plan 01's `test/components/levelBars.test.js`:

```js
test("tone onLive paints paper bars for a --color-live surface; brand stays the default (Plan 05 extension, §5)", async () => {
  const { LevelBars } = await loadComponent();
  const brand = renderStatic(LevelBars, { readLevel: () => 0, height: 20 });
  assert.ok(brand.includes("linear-gradient(180deg, #ff6a36, #e6007a)"));
  assert.ok(brand.includes('data-tone="brand"'));
  const onLive = renderStatic(LevelBars, { readLevel: () => 0, height: 20, tone: "onLive" });
  assert.equal(onLive.includes("linear-gradient"), false);
  assert.equal(onLive.split("var(--color-background)").length - 1, 5);
  assert.ok(onLive.includes('data-tone="onLive"'));
});
```

Append to `test/components/onboardingShell.test.js`:

```js
test("no onboarding rule overrides LevelBars with !important (the tone prop replaced it)", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../src/styles/onboarding.css"), "utf8");
  assert.doesNotMatch(css, /\[data-level-bar\][^{]*\{[^}]*!important/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/onboardingShell.test.js test/components/onboardingFlow.test.js test/components/levelBars.test.js`

Expected: FAIL. `onboarding.css` has no shell, the modules are missing, the orphaned selectors are still present, and the flow has no `data-onb-primary`.

- [ ] **Step 3: Implement**

1. Create `src/components/onboarding/instrumentMath.ts`:

   ```ts
   import { LOGO_BAR_SHAPE } from "../ui/levelBarsMath";
   import { byteParts, clampPercent } from "../../utils/onboardingDownload";

   // The five bars of the mark are setup's one hero (ONB-R1 C, ONB-M2): they
   // breathe when idle, fill with the download, follow the voice, drop to 30% on
   // error, settle into the mark and dock into the header on success.
   export type InstrumentMode =
     | { kind: "idle" }
     | { kind: "download"; percent: number; downloadedBytes: number; totalBytes: number }
     | { kind: "listening"; heardVoice: boolean }
     | { kind: "processing" } // the take stopped and is being written; the live meter stays mounted (R3-M01)
     | { kind: "success" }
     | { kind: "error"; reason: "download" | "microphone" | "noAudio" | "other" };

   export const INSTRUMENT_HEIGHT = 140;
   export const ERROR_FILL = 0.3;
   /** Stage 1 of M2: the live bars ease to rest, the mark's silhouette; equals --motion-hero. */
   export const SETTLE_MS = 520;
   /** Stage 2 of M2: the speech bubble draws around the settled bars; equals --motion-slow. */
   export const DRAW_MS = 360;

   export function barHeights(height = INSTRUMENT_HEIGHT): number[] {
     return LOGO_BAR_SHAPE.map((shape) => Math.round(shape * height));
   }

   export function instrumentFills(mode: InstrumentMode): number[] {
     if (mode.kind === "download") {
       const fill = clampPercent(mode.percent) / 100;
       return LOGO_BAR_SHAPE.map(() => fill);
     }
     if (mode.kind === "error") return LOGO_BAR_SHAPE.map(() => ERROR_FILL);
     return LOGO_BAR_SHAPE.map(() => 1);
   }

   type ByteParts = { value: string; unit: "mb" | "gb" };
   export type InstrumentCaption =
     | { key: "idle" | "goodLevel" | "waiting" | "processing" | "heard" | "downloadError" | "micError" | "nothingHeard" | "error" }
     | { key: "downloading"; percent: number; done: ByteParts; total: ByteParts };

   const ERROR_CAPTIONS = { download: "downloadError", microphone: "micError", noAudio: "nothingHeard", other: "error" } as const;

   export function instrumentCaption(mode: InstrumentMode, locale?: string): InstrumentCaption {
     switch (mode.kind) {
       case "download":
         return { key: "downloading", percent: clampPercent(mode.percent), done: byteParts(mode.downloadedBytes, locale), total: byteParts(mode.totalBytes, locale) };
       case "listening":
         return { key: mode.heardVoice ? "goodLevel" : "waiting" };
       case "processing":
         return { key: "processing" };
       case "success":
         return { key: "heard" };
       case "error":
         return { key: ERROR_CAPTIONS[mode.reason] };
       default:
         return { key: "idle" };
     }
   }

   /** The success dock: a View Transition when allowed, otherwise an instant swap. */
   export function dockMark(
     update: () => void,
     env: { reducedMotion: boolean; doc?: { startViewTransition?: (callback: () => void) => unknown } }
   ): "transition" | "instant" {
     const start = env.doc?.startViewTransition;
     if (!env.reducedMotion && typeof start === "function") {
       start.call(env.doc, update);
       return "transition";
     }
     update();
     return "instant";
   }
   ```

2. Extend Plan 01's `src/components/ui/LevelBars.tsx` with the tone prop:

   ```tsx
   export type LevelBarsTone = "brand" | "onLive";
   // "onLive": the bars sit on a --color-live fill (the light setup rail), so they read as paper.
   const BAR_FILL: Record<LevelBarsTone, string> = { brand: BAR_GRADIENT, onLive: "var(--color-background)" };

   export interface LevelBarsProps {
     readLevel: () => number;
     height?: number;
     tone?: LevelBarsTone;
     className?: string;
   }
   ```

   In `LevelBars`, destructure `tone = "brand"`, put `data-tone={tone}` on the wrapper `<span>`, and use `background: BAR_FILL[tone]` on each bar instead of `BAR_GRADIENT`. Nothing else changes, and existing callers keep the gradient.

3. Create `src/components/onboarding/InstrumentRail.tsx`:

   ```tsx
   import { useCallback, useEffect, useState, type CSSProperties } from "react";
   import { useTranslation } from "react-i18next";
   import { LevelBars } from "../ui/LevelBars";
   import { INSTRUMENT_HEIGHT, SETTLE_MS, barHeights, instrumentCaption, instrumentFills, type InstrumentMode } from "./instrumentMath";

   export interface InstrumentRailProps {
     title: string;
     body: string;
     mode: InstrumentMode;
     readLevel?: () => number;
   }

   // The speech bubble around the five bars. No SVG master exists for the mark,
   // so this outline is redrawn to its proportions (flag in the brand review).
   const BUBBLE_PATH =
     "M10 6 H150 A10 10 0 0 1 160 16 V124 A10 10 0 0 1 150 134 H70 L48 154 V134 H10 A10 10 0 0 1 0 124 V16 A10 10 0 0 1 10 6 Z";

   // The light rail is the solid --color-live surface; Plum Night's is a tinted surface.
   function useDarkTheme(): boolean {
     const root = typeof document !== "undefined" ? document.documentElement : null;
     const [dark, setDark] = useState(() => root?.classList?.contains("dark") ?? false);
     useEffect(() => {
       if (!root || typeof MutationObserver === "undefined") return;
       const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
       observer.observe(root, { attributes: true, attributeFilter: ["class"] });
       return () => observer.disconnect();
     }, [root]);
     return dark;
   }

   export function InstrumentRail({ title, body, mode, readLevel }: InstrumentRailProps) {
     const { t, i18n } = useTranslation();
     const dark = useDarkTheme();
     // M2 (R3-M01): one LevelBars instance lives from the first "listening" of a take
     // through "processing" and the settle after "success", so its frame is never
     // reset. The meter state is adjusted during render when the mode changes (React's
     // documented "adjust state on prop change" pattern), so no render ever drops it.
     //   live     → the real level;
     //   settling → zero input: the driver's own smoothing eases the bars to the rest
     //              silhouette, the mark's proportions (processing, then SETTLE_MS of success);
     //   off      → the static bars; on success, the mark and its bubble (DRAW_MS), then the dock.
     const [meter, setMeter] = useState<"off" | "live" | "settling">(mode.kind === "listening" ? "live" : "off");
     const [prevKind, setPrevKind] = useState(mode.kind);
     if (mode.kind !== prevKind) {
       setPrevKind(mode.kind);
       const reduced = globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
       if (mode.kind === "listening") setMeter("live");
       else if ((mode.kind === "processing" || mode.kind === "success") && meter !== "off" && !reduced) setMeter("settling");
       else setMeter("off"); // another mode, nothing live to settle, or an instant swap under reduced motion
     }
     useEffect(() => {
       if (mode.kind !== "success" || meter !== "settling") return;
       const id = setTimeout(() => setMeter("off"), SETTLE_MS);
       return () => clearTimeout(id);
     }, [meter, mode.kind]);
     const silence = useCallback(() => 0, []);
     const liveLevel = meter === "live" ? readLevel : meter === "settling" ? silence : undefined;
     const stage = mode.kind !== "success" ? "live" : meter === "settling" ? "settle" : "mark";
     const caption = instrumentCaption(mode, i18n?.language);
     const fills = instrumentFills(mode);
     const captionText =
       caption.key === "downloading"
         ? t("setupFlow.instrument.downloading", {
             percent: caption.percent,
             done: t(`setupFlow.units.${caption.done.unit}`, { value: caption.done.value }),
             total: t(`setupFlow.units.${caption.total.unit}`, { value: caption.total.value }),
           })
         : t(`setupFlow.instrument.${caption.key}`);
     return (
       <section className="onb-rail" data-mode={mode.kind}>
         <div className="onb-rail__copy">
           <h1 tabIndex={-1}>{title}</h1>
           {body ? <p>{body}</p> : null}
         </div>
         <div className="onb-instrument" data-mode={mode.kind} data-stage={stage} data-meter={meter} aria-hidden="true">
           {mode.kind === "success" && stage === "mark" ? (
             <svg className="onb-bubble" data-bubble="" viewBox="-4 0 168 160" aria-hidden="true">
               <path d={BUBBLE_PATH} pathLength={1} />
             </svg>
           ) : null}
           {liveLevel ? (
             // One keyed instance: changing readLevel never remounts it (LevelBars keeps the latest in a ref).
             <LevelBars key="take-meter" readLevel={liveLevel} height={INSTRUMENT_HEIGHT} tone={dark ? "brand" : "onLive"} />
           ) : (
             barHeights().map((height, index) => (
               <span key={index} className="onb-bar" style={{ height }}>
                 <span className="onb-bar__fill" style={{ "--fill": fills[index] } as CSSProperties} />
               </span>
             ))
           )}
         </div>
         <p className="onb-instrument__caption">{captionText}</p>
       </section>
     );
   }
   ```

4. Create `src/components/onboarding/OnboardingShell.tsx`:

   ```tsx
   import { useEffect, useRef, type ReactNode } from "react";
   import { useTranslation } from "react-i18next";
   import { ArrowRight } from "lucide-react";
   import { LoquiBrand } from "../LoquiBrand";
   import { Button } from "../ui/button";
   import { canNavigateTo, phaseProgress } from "../../utils/onboardingFlow";
   import type { OnboardingStep } from "../../utils/onboardingState";
   import { InstrumentRail, type InstrumentRailProps } from "./InstrumentRail";

   export interface OnboardingShellProps {
     step: OnboardingStep;
     visited: readonly OnboardingStep[];
     platform: "darwin" | "linux" | "win32";
     rail: InstrumentRailProps;
     docked?: boolean;
     onNavigate(step: OnboardingStep): void;
     onBack?: () => void;
     onSkip?: () => void;
     finishLater?: { label: string; onClick(): void };
     primary?: { label: string; onClick(): void; disabled?: boolean; describedBy?: string };
     footerStart?: ReactNode;
     announcement?: string;
     children: ReactNode;
   }

   export function OnboardingShell(props: OnboardingShellProps) {
     const { step, visited, platform, rail, docked = false, onNavigate, onBack, onSkip, finishLater, primary, footerStart, announcement, children } = props;
     const { t } = useTranslation();
     const mainRef = useRef<HTMLDivElement>(null);
     const progress = phaseProgress(step);
     const stepLabel = t(`setupFlow.steps.${step}`);

     // Every step change moves focus to its heading (kept from the old flow).
     useEffect(() => {
       mainRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
     }, [step]);

     return (
       <div className="onb-shell" data-platform={platform} data-docked={docked || undefined}>
         <header className="onb-header">
           <div className="onb-brand">
             <span className="onb-brand__tile">
               <LoquiBrand decorative size={24} />
             </span>
             <strong>{t("setupFlow.brand")}</strong>
           </div>
           <nav className="onb-progress" aria-label={t("setupFlow.progress.nav")}>
             <span className="onb-progress__label">
               {progress
                 ? t("setupFlow.progress.label", { phase: t(`setupFlow.progress.${progress.phase}`), step: stepLabel })
                 : t("setupFlow.progress.ready")}
             </span>
             {progress ? (
               <ol className="onb-progress__list">
                 {progress.steps.map((candidate, index) => (
                   <li key={candidate}>
                     <button
                       type="button"
                       className="onb-progress__step"
                       data-state={index < progress.index ? "done" : index === progress.index ? "current" : "todo"}
                       aria-label={t("setupFlow.progress.goTo", { step: t(`setupFlow.steps.${candidate}`) })}
                       aria-current={candidate === step ? "step" : undefined}
                       disabled={!canNavigateTo(candidate, step, visited)}
                       onClick={() => onNavigate(candidate)}
                     />
                   </li>
                 ))}
               </ol>
             ) : null}
           </nav>
           {finishLater ? (
             <button type="button" className="onb-header__later" onClick={finishLater.onClick}>
               {finishLater.label}
             </button>
           ) : null}
         </header>
         <div ref={mainRef} className="onb-main">
           <InstrumentRail {...rail} />
           <main className="onb-controls" aria-label={stepLabel}>
             <div key={step} className="onb-step">
               {children}
             </div>
           </main>
         </div>
         <footer className="onb-footer">
           {onBack ? (
             <Button variant="ghost" onClick={onBack}>
               {t("setupFlow.back")}
             </Button>
           ) : null}
           <div className="onb-footer__start">{footerStart}</div>
           {onSkip ? (
             <button type="button" className="onb-footer__skip" onClick={onSkip}>
               {t("setupFlow.skipStep")}
             </button>
           ) : null}
           {primary ? (
             <Button data-onb-primary="" onClick={primary.onClick} disabled={primary.disabled} aria-describedby={primary.describedBy}>
               {primary.label}
               <ArrowRight aria-hidden="true" className="rtl:-scale-x-100" />
             </Button>
           ) : null}
         </footer>
         <p className="sr-only" aria-live="polite" data-onb-announcer="">
           {announcement ?? ""}
         </p>
       </div>
     );
   }
   ```

5. Append to `src/styles/onboarding.css`:

   ```css
   /* Shell: pinned to the window (ONB-Q1), 56px header and a 64px footer that may
      wrap to a second row at 200% zoom or with long labels, never a third (M04). */
   .onb-shell {
     --onb-header: 56px;
     --onb-footer: 64px;
     display: grid;
     grid-template-rows: var(--onb-header) minmax(0, 1fr) auto;
     height: 100dvh;
     min-height: 0;
     overflow: hidden;
     background: var(--color-background);
     color: var(--color-foreground);
     font-family: var(--font-family-sans);
   }

   .onb-header {
     display: flex;
     align-items: center;
     gap: 16px;
     min-width: 0;
     padding-inline: 24px;
     border-bottom: 1px solid var(--color-border);
     -webkit-app-region: drag;
   }

   .onb-header button {
     -webkit-app-region: no-drag;
   }

   /* macOS draws the traffic lights at x:20 (windowConfig.js); they stay on the
      physical left in RTL too, so this is padding-left on purpose (Plan 02, ONB-Q1). */
   .onb-shell[data-platform="darwin"] .onb-header {
     padding-left: 84px;
   }

   .onb-brand {
     display: flex;
     flex: none;
     align-items: center;
     gap: 10px;
     font-size: 14px;
     font-weight: 600;
   }

   .onb-brand__tile {
     display: grid;
     place-items: center;
     width: 32px;
     height: 32px;
     border-radius: 8px;
     background: color-mix(in oklab, var(--color-live) 10%, var(--color-background));
   }

   .onb-progress {
     display: flex;
     align-items: center;
     gap: 12px;
     min-width: 0;
     margin-inline-start: auto;
     font-size: 12px;
     color: var(--color-muted-foreground);
   }

   .onb-progress__label {
     max-width: 28ch;
     overflow: hidden;
     text-overflow: ellipsis;
     white-space: nowrap;
   }

   .onb-progress__list {
     display: flex;
     gap: 6px;
     margin: 0;
     padding: 0;
     list-style: none;
   }

   .onb-progress__step {
     position: relative;
     width: 34px;
     height: 3px;
     padding: 0;
     border: 0;
     border-radius: 9999px;
     background: var(--color-border-hover);
   }

   .onb-progress__step::after {
     content: "";
     position: absolute;
     inset: -9px 0;
   }

   .onb-progress__step[data-state="done"] {
     background: var(--color-nav-marker);
   }

   .onb-progress__step[data-state="current"] {
     background: var(--color-nav-marker);
   }

   .onb-progress__step:not(:disabled) {
     cursor: pointer;
   }

   .onb-header__later,
   .onb-footer__skip {
     flex: none;
     padding: 6px 8px;
     border: 0;
     background: none;
     color: var(--color-muted-foreground);
     font-size: 13px;
     cursor: pointer;
   }

   .onb-main {
     display: grid;
     grid-template-columns: minmax(280px, 36%) minmax(0, 1fr);
     min-height: 0;
   }

   .onb-controls {
     min-width: 0;
     overflow-y: auto;
     padding: 28px clamp(16px, 4vw, 48px);
   }

   .onb-step {
     display: grid;
     gap: 20px;
     max-width: 640px;
     animation: onb-step-in var(--motion-base) var(--motion-ease-enter) both;
   }

   @keyframes onb-step-in {
     from {
       opacity: 0;
       transform: translateY(8px);
     }
   }

   @keyframes onb-fade {
     from {
       opacity: 0;
     }
   }

   .onb-footer {
     display: flex;
     flex-wrap: wrap;
     align-items: center;
     gap: 8px 12px;
     min-height: var(--onb-footer);
     padding: 12px 24px;
     border-top: 1px solid var(--color-border);
   }

   .onb-footer__start {
     flex: 1 1 160px;
     min-width: 0;
   }

   /* The rail: orange in light (ink 5.75:1, paper bars 3.12:1); warm Plum Night in dark.
      ONB-Q16: 36px/650 title, tokens only. */
   .onb-rail {
     display: flex;
     flex-direction: column;
     min-height: 0;
     padding: 30px 30px 0;
     background: var(--color-live);
     color: var(--color-live-foreground);
   }

   .dark .onb-rail {
     border-inline-end: 1px solid var(--color-border);
     background: linear-gradient(160deg, color-mix(in oklab, var(--color-live) 14%, var(--color-surface-1)), var(--color-surface-1) 60%);
     color: var(--color-foreground);
   }

   .onb-rail h1 {
     margin: 0;
     font-size: 36px;
     font-weight: 650;
     line-height: 1.1;
     letter-spacing: -0.025em;
     text-wrap: balance;
   }

   .onb-rail h1:focus {
     outline: none;
   }

   .onb-rail__copy p {
     max-width: 360px;
     margin-top: 12px;
     font-size: 15px;
     line-height: 1.45;
   }

   .onb-instrument {
     position: relative;
     display: flex;
     align-items: flex-end;
     justify-content: center;
     gap: 20px;
     height: 170px;
     margin-top: auto;
     padding-bottom: 14px;
     view-transition-name: loqui-mark;
   }

   /* After the first success the mark lives in the header; the rail shows bars
      again only while they carry state (M02). */
   .onb-shell[data-docked] .onb-instrument:not([data-mode="download"]):not([data-mode="listening"]):not([data-mode="processing"]):not([data-mode="error"]) {
     opacity: 0;
     view-transition-name: none;
   }

   .onb-shell[data-docked] .onb-brand__tile {
     view-transition-name: loqui-mark;
   }

   ::view-transition-group(loqui-mark) {
     animation-duration: var(--motion-slow);
     animation-timing-function: var(--motion-ease-std);
   }

   .onb-bubble {
     position: absolute;
     inset: 0;
     width: 100%;
     height: 100%;
     fill: none;
     stroke: currentColor;
     stroke-width: 4;
     stroke-linejoin: round;
   }

   .onb-bubble path {
     stroke-dasharray: 1;
     stroke-dashoffset: 1;
     animation: onb-bubble-draw var(--motion-slow) var(--motion-ease-std) forwards;
   }

   @keyframes onb-bubble-draw {
     to {
       stroke-dashoffset: 0;
     }
   }

   .onb-bar {
     position: relative;
     display: block;
     width: 25px;
     overflow: hidden;
     border-radius: 9999px;
     background: color-mix(in oklab, var(--color-live-foreground) 14%, transparent);
   }

   .dark .onb-bar {
     background: color-mix(in oklab, var(--color-foreground) 8%, transparent);
   }

   .onb-bar__fill {
     position: absolute;
     inset: 0;
     border-radius: inherit;
     background: var(--color-background);
     transform: scaleY(var(--fill, 1));
     transform-origin: bottom;
     transition: transform var(--motion-fast) var(--motion-ease-std), background-color var(--motion-fast) var(--motion-ease-std);
   }

   .dark .onb-bar__fill {
     background: linear-gradient(180deg, var(--color-live), var(--color-nav-marker));
   }

   /* Idle breathe, about 6 s (11.5 × --motion-hero); runs only in the idle state. */
   .onb-instrument[data-mode="idle"] .onb-bar__fill {
     animation: onb-breathe calc(var(--motion-hero) * 11.5) var(--motion-ease-std) infinite;
   }

   @keyframes onb-breathe {
     50% {
       transform: scaleY(0.85);
     }
   }

   /* Error bars drop to 30% (the shape cue) and the caption names the problem.
      Light: ink on the orange rail, 5.75:1 (warning amber would be 1.02:1, R2-I09).
      Plum Night: warning amber on the dark rail, 8.73:1. */
   .onb-instrument[data-mode="error"] .onb-bar__fill {
     background: var(--color-live-foreground);
   }

   .dark .onb-instrument[data-mode="error"] .onb-bar__fill {
     background: var(--color-warning);
   }

   .onb-instrument[data-mode="error"] {
     animation: onb-shake var(--motion-fast) var(--motion-ease-std) 1;
   }

   @keyframes onb-shake {
     25% {
       transform: translateX(-2px);
     }
     75% {
       transform: translateX(2px);
     }
   }

   .onb-instrument__caption {
     min-height: 31px;
     margin: 0;
     padding-block: 8px 18px;
     font-size: 13px;
     font-weight: 600;
     font-variant-numeric: tabular-nums;
     text-align: center;
   }

   .onb-legacy {
     display: block;
     height: auto;
     min-height: 0;
     background: transparent;
   }

   @media (max-width: 900px) {
     .onb-brand strong {
       display: none;
     }
     .onb-progress__label {
       max-width: 18ch;
     }
   }

   @media (max-width: 760px) {
     .onb-main {
       grid-template-columns: minmax(0, 1fr);
       grid-template-rows: auto minmax(0, 1fr);
     }
     .onb-rail {
       flex-direction: row;
       align-items: center;
       gap: 16px;
       min-height: 72px;
       padding: 12px 20px;
     }
     .onb-rail h1 {
       font-size: 22px;
     }
     .onb-rail__copy p {
       display: none;
     }
     .onb-instrument {
       display: none;
     }
     .onb-instrument__caption {
       margin-inline-start: auto;
       padding: 0;
     }
     .onb-progress__label {
       display: none;
     }
     .onb-footer__start {
       order: -1;
       flex-basis: 100%;
     }
   }

   @media (prefers-reduced-motion: reduce) {
     .onb-step {
       animation: onb-fade var(--motion-base) var(--motion-ease-std) both !important;
     }
     .onb-instrument[data-mode="idle"] .onb-bar__fill {
       animation: none !important;
     }
     .onb-bubble path {
       animation: none !important;
       stroke-dashoffset: 0;
     }
   }
   ```

   Two rules exist only to make the M04 behaviour explicit. Under 760px the footer's status slot takes a full first row, which keeps Back, Skip and the primary on the second row. The header drops its brand text below 900px, which is what 200% zoom produces on a 1800px window.

6. In `src/index.css`, delete these blocks by selector:
   - the `body:has(.onboarding-canvas.compact)` background rule;
   - in the reduced-motion block, the `.onboarding-step-enter, .onboarding-stagger > *` and `.onboarding-pressable:active` rules;
   - every rule from `.onboarding-canvas, body:has(.onboarding-canvas) {` through `.onboarding-shell-scroll { … }`. That includes the token blocks and dark overrides, `.onboarding-embedded-auth`, `.onboarding-card-title`, the `onboarding-step-in` keyframes, `.onboarding-step-enter`, `.onboarding-stagger`, `.onboarding-pressable`, `.onboarding-list*`, `.onboarding-select-*`, `.onboarding-canvas.compact`, `.onboarding-compact-hero`, the disabled primary, `onboarding-typing-dot`, `.onboarding-canvas kbd`, `.onboarding-keycap`, `.onboarding-display-title`, `.onboarding-*-input`, `.onboarding-provider-icon-monochrome`, `.onboarding-scroll-hidden` and `.onboarding-shell-scroll`.

   Keep `--onboarding-ease-out` and `@keyframes reduced-motion-fade-in` if anything still references them (`grep -n "onboarding-ease-out\|reduced-motion-fade-in" src -r`).

   Before deleting, check for runtime usages only, ignoring comments and this plan's own tests:

   ```bash
   grep -rnE "['\"\` ](onboarding-(canvas|keycap|list|select|provider|light-input|auth-input|embedded-auth|card-title|display-title|scroll-hidden|shell-scroll|pressable|stagger|step-enter|typing-dot|compact-hero))" src --include=*.tsx --include=*.jsx --include=*.ts --include=*.js
   ```

   Expected: only `src/components/ui/ProviderIcon.tsx:35` (`onboarding-provider-icon-monochrome`). Remove that branch as listed under Files: drop the `monochrome` prop, its default and the template term. If anything else appears, stop and report; do not delete a live rule.

7. `src/components/ui/ActivationModeSelector.tsx`:
   - delete the `variant` prop and its doc comment (10-11);
   - delete the `onboarding` entry of `STYLES` (28-35) and the `variant = "default"` destructuring (43);
   - use `STYLES.default`;
   - set `style={{ "--inset": "2px" }}`.

8. In `src/components/OnboardingFlow.tsx`, apply the **[T11]** blocks of the composition: imports, the navigation state and helpers, the `legacy()` wrapper and `stepView()`, and the shell render.
   - Every step's `content` is still the legacy body, wrapped by `legacy(...)`.
   - Plan 02's footer chip node (its `footerStatus`) is passed as `footerStart`, so `onboardingDownloadProgress`'s "chip follows to later steps" test keeps passing until Task 13 replaces the chip.
   - `config` becomes `previewConfig`; production code stops reading the preview global.

9. `DESIGN.md`:
   - **Line 151:** change to `- **Onboarding title** (650, 36px, 1.1 line-height, -0.025em tracking): The setup rail heading; 22px in windows under 760px.`
   - **Layout sentence:** replace the onboarding sentence with "Setup is a pinned window: a 56px header with per-phase progress, a 36% orange rail beside the controls (a 72px banner under 760px), and a 64px footer that wraps to at most two rows at 200% zoom or with long translations."
   - **Add** after `### Voice Pill`:

   ```markdown
   ### Onboarding

   The setup rail is the instrument: the five bars of the mark breathe when idle, fill bottom-up with the voice download, follow the microphone while listening, and drop to 30% on error (ink on the light rail, warning amber on Plum Night, both at least 3:1). On the first successful dictation the live bars settle into the mark's silhouette (`--motion-hero`), the speech bubble draws around them (`--motion-slow`), and then the mark docks into the 32px header tile (View Transition), where it stays for the rest of setup. A numeric caption sits under the bars, so progress is never motion-only. Light theme: orange rail (`--color-live`), ink text, paper bars. Plum Night: a warm surface gradient with orange-to-magenta bars. Active progress uses `--color-nav-marker`. Primary actions are the neutral ink capsule; `live` is reserved for record, stop, "Allow microphone", the ready-block mic and "Dictate into a note". Readiness icons use `--color-success` and `--color-warning`; their words stay in foreground colours.
   ```

10. Delete the test "first setup reaches completion without account APIs or implicit downloads" from `test/components/personalWorkspace.test.js`. The flow walk replaces it, and keeps the account check.

11. Add the strings:

    ```bash
    node scripts/dev/merge-locale-keys.cjs - <<'JSON'
    {
      "setupFlow": {
        "brand": "Loqui setup",
        "back": "Back",
        "skipStep": "Skip this step",
        "continue": "Continue",
        "finishLater": "Finish later",
        "lookAroundFirst": "Look around first",
        "instrument": {
          "idle": "Ready when you are",
          "downloading": "Downloading · {{percent}}% · {{done}} of {{total}}",
          "goodLevel": "Listening · good level",
          "waiting": "Listening · waiting for your voice",
          "processing": "Writing it down…",
          "heard": "Heard you",
          "downloadError": "Download stopped",
          "micError": "Loqui can't hear your microphone",
          "nothingHeard": "Nothing heard. Check your microphone.",
          "error": "That didn't work. Try again."
        },
        "rail": {
          "welcome": { "title": "Talk. Loqui types.", "bodyMac": "Dictate anywhere, keep notes and meetings in one place, and choose exactly what ever leaves your Mac.", "bodyOther": "Dictate anywhere, keep notes and meetings in one place, and choose exactly what ever leaves your computer." },
          "speech": { "title": "Pick how Loqui listens.", "bodyMac": "One recommended voice. It runs on this Mac and works offline.", "bodyOther": "One recommended voice. It runs on this computer and works offline." },
          "try": { "title": "Say something.", "bodyMac": "This test is not pasted into another app or saved to history.", "bodyOther": "This test is not pasted into another app or saved to history." },
          "cleanup": { "title": "Make it read well.", "bodyMac": "See what cleanup does to your own words, then choose.", "bodyOther": "See what cleanup does to your own words, then choose." },
          "shortcuts": { "title": "Talk from any app.", "bodyMac": "Press your shortcut anywhere. Change it if it clashes with another app.", "bodyOther": "Press your shortcut anywhere. Change it if it clashes with another app." },
          "finish": { "title": "Here is where you are.", "bodyMac": "Everything below is true right now.", "bodyOther": "Everything below is true right now.", "openWorkspace": "Open workspace" }
        }
      }
    }
    JSON
    npx prettier --write "src/locales/**/translation.json"
    ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/onboardingShell.test.js test/components/onboardingFlow.test.js test/components/levelBars.test.js test/components/personalWorkspace.test.js test/components/onboardingCleanupWiring.test.js test/components/onboardingDownloadProgress.test.js test/components/motionTokens.test.js && npm run typecheck && npm run i18n:check`

Expected: PASS.

Then open `?preview=onboarding&step=speech&scenario=fresh` in the browser preview and check, in light and dark:
- **1440×900, 900×640 and 640×560:** the footer is flush with the window bottom, and on macOS the header clears the traffic lights.
- **640×560:** the controls start under a 72px banner.
- **Chrome zoom at 200%:** there is no horizontal scroll, and the footer has at most two rows.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/instrumentMath.ts src/components/onboarding/InstrumentRail.tsx src/components/onboarding/OnboardingShell.tsx src/components/ui/LevelBars.tsx test/components/levelBars.test.js src/styles/onboarding.css src/index.css src/components/ui/ActivationModeSelector.tsx src/components/ui/ProviderIcon.tsx src/components/OnboardingFlow.tsx DESIGN.md src/locales test/components/onboardingShell.test.js test/components/onboardingFlow.test.js test/components/personalWorkspace.test.js
git commit -m "feat(onboarding): pinned two-phase shell with the instrument rail"
```

---

### Task 12: Hello (Phase 1, screen 1)

Covers:
- ONB-R2 B "Hello: mic permission and level";
- ONB-Q6 on this screen;
- part of ONB-Q17;
- owner decision 6 (a microphone picker);
- I01 (a late microphone is always released, and a failed open can be retried).

The privacy toggles move to Ready (owner decision 2). `WelcomeScreen` is deleted only after its last consumer, the preview's `WelcomeVariations`, has moved off it (round-1 ONB-02).

**Files:**
- Create: `src/utils/onboardingMic.ts`
- Create: `src/components/onboarding/useMicLevelPreview.ts`
- Create: `src/components/onboarding/HelloStep.tsx`
- Create: `src/components/onboarding/PrivacyDefaults.tsx`
- Delete: `src/components/onboarding/WelcomeScreen.tsx`
- Modify: `src/preview/WelcomeVariations.tsx`. Touch the `WelcomeScreen` import (4) and its render in design 2 (197-204).
- Modify: `src/components/OnboardingFlow.tsx`. Apply the **[T12]** blocks of the composition. Delete the `WelcomeScreen` import (23) and the welcome early return (1399-1413). The legacy `FinishStep` gains `<PrivacyDefaults>` until Task 18. Move `import "../styles/onboarding-welcome.css";` here, because it was only imported by `WelcomeScreen.tsx:5`.
- Modify: `src/styles/onboarding.css` (append)
- Test: `test/utils/onboardingMic.test.js` and `test/components/onboardingHello.test.js`. Extend `test/components/onboardingFlow.test.js`.

**Interfaces:**
- Consumes:
  - `useMicrophoneAccess`, `openMicrophoneHelp` and `RecoveryCard` (Task 10);
  - `LevelBars` (Plan 01);
  - `analyserRms` (`src/utils/audioLevel.ts:2`, `(analyser, buf: { current: Float32Array | null }) => number`);
  - `VOICE_LEVEL_FLOOR` and `SILENCE_HINT_MS` (Task 6);
  - `isBuiltInMicrophone` (`src/utils/audioDeviceUtils.ts:10`) and `resolveMicDeviceSelection` (`src/helpers/micDeviceSelection.js`). These are the same helpers `MicrophoneSettings` uses.
  - The existing selection settings: `microphoneSelectionMode` (`"system" | "built-in" | "specific"`), `selectedMicDeviceId` and `selectedMicDeviceLabel` (`src/stores/settingsStore.ts:1470-1478`), plus `setMicrophoneSelectionMode(mode)` and `setSelectedMicDevice(deviceId, label)` (2161-2176). The dictation recorder already reads these, so the device picked on Hello is the one every later dictation uses.
- Produces `src/utils/onboardingMic.ts`:

  ```ts
  export type MicSelectionMode = "system" | "built-in" | "specific";
  export interface AudioInput { deviceId: string; label: string; isBuiltIn: boolean }
  export const SYSTEM_MIC = "__system__";
  export const BUILT_IN_MIC = "__built-in__";
  export function toAudioInputs(devices: ReadonlyArray<Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">>): AudioInput[]; // drops "default"/"communications"
  export interface MicPickerModel { value: string; previewDeviceId: string | null; hasBuiltIn: boolean; devices: AudioInput[]; missing: boolean }
  export function micPickerModel(devices: AudioInput[], mode: MicSelectionMode, selectedId: string, selectedLabel: string): MicPickerModel;
  export function selectionFor(value: string, devices: AudioInput[]): { mode: MicSelectionMode; device: AudioInput | null };
  ```

- Produces:

  ```ts
  export interface MicLevelPreview {
    status: "off" | "starting" | "live" | "failed";
    deviceLabel: string | null;
    heardVoice: boolean;
    silent: boolean;            // live for SILENCE_HINT_MS without a voice: highlight the picker
    inputs: AudioInput[];       // enumerated once the stream is live (labels need permission)
    readLevel(): number;
    retry(): void;              // reopen after a failed open while permission is still granted (I01)
  }
  export function useMicLevelPreview(active: boolean, deviceId?: string | null): MicLevelPreview;
  // releases every track when inactive, on device change, or unmounted, including a stream that
  // resolves after its effect was cleaned up
  export interface HelloStepProps {
    platform: "darwin" | "linux" | "win32"; access: MicAccess; preview: MicLevelPreview;
    picker: MicPickerModel; onPickMicrophone(value: string): void;
    onAllow(): void; onRecheck(): void;
  }
  export interface PrivacyDefaultsProps { platform: "darwin" | "linux" | "win32"; historyEnabled: boolean; onHistoryChange(value: boolean): void; updatesEnabled: boolean; onUpdatesChange(value: boolean): void }
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/utils/onboardingMic.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingMic.ts");
const devices = [
  { kind: "audioinput", deviceId: "default", label: "Default - MacBook Pro Microphone" },
  { kind: "audioinput", deviceId: "mbp", label: "MacBook Pro Microphone" },
  { kind: "audioinput", deviceId: "usb", label: "USB Mic" },
  { kind: "audiooutput", deviceId: "spk", label: "Speakers" },
];

test("only real inputs are listed, and built-in microphones are recognised", async () => {
  const { toAudioInputs } = await load();
  assert.deepEqual(toAudioInputs(devices), [
    { deviceId: "mbp", label: "MacBook Pro Microphone", isBuiltIn: true },
    { deviceId: "usb", label: "USB Mic", isBuiltIn: false },
  ]);
});

test("the picker shows the saved choice and listens to that device", async () => {
  const { toAudioInputs, micPickerModel, SYSTEM_MIC, BUILT_IN_MIC } = await load();
  const inputs = toAudioInputs(devices);
  assert.deepEqual(
    [micPickerModel(inputs, "system", "", "").value, micPickerModel(inputs, "system", "", "").previewDeviceId],
    [SYSTEM_MIC, null]
  );
  const builtIn = micPickerModel(inputs, "built-in", "", "");
  assert.deepEqual([builtIn.value, builtIn.previewDeviceId, builtIn.hasBuiltIn], [BUILT_IN_MIC, "mbp", true]);
  assert.equal(micPickerModel(inputs, "specific", "usb", "USB Mic").previewDeviceId, "usb");
  assert.equal(micPickerModel(inputs, "specific", "old-id", "USB Mic").value, "usb", "a re-plugged device is found by its label");
});

test("a saved device that is gone falls back to the system default and says so", async () => {
  const { toAudioInputs, micPickerModel, SYSTEM_MIC } = await load();
  const gone = micPickerModel(toAudioInputs(devices), "specific", "headset", "Headset");
  assert.deepEqual([gone.value, gone.previewDeviceId, gone.missing], [SYSTEM_MIC, null, true]);
  assert.equal(micPickerModel([], "specific", "headset", "Headset").missing, false, "not before the list has loaded");
});

test("a picked value maps back to a selection mode and device", async () => {
  const { toAudioInputs, selectionFor, SYSTEM_MIC, BUILT_IN_MIC } = await load();
  const inputs = toAudioInputs(devices);
  assert.deepEqual(selectionFor(SYSTEM_MIC, inputs), { mode: "system", device: null });
  assert.deepEqual(selectionFor(BUILT_IN_MIC, inputs), { mode: "built-in", device: null });
  assert.deepEqual(selectionFor("usb", inputs), { mode: "specific", device: inputs[1] });
  assert.deepEqual(selectionFor("unplugged", inputs), { mode: "system", device: null });
});
```

Create `test/components/onboardingHello.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const preview = (patch = {}) => ({
  status: "off",
  deviceLabel: null,
  heardVoice: false,
  silent: false,
  inputs: [],
  readLevel: () => 0,
  retry: () => {},
  ...patch,
});
const usb = { deviceId: "usb", label: "USB Mic", isBuiltIn: false };
const picker = (patch = {}) => ({ value: "__system__", previewDeviceId: null, hasBuiltIn: false, devices: [usb], missing: false, ...patch });

async function hello(t, props) {
  const actions = [];
  const ui = await mountComponent(t, "/components/onboarding/HelloStep.tsx", {
    exportName: "HelloStep",
    props: {
      platform: "darwin",
      access: "unknown",
      preview: preview(),
      picker: picker(),
      onPickMicrophone: (value) => actions.push(["pick", value]),
      onAllow: () => actions.push("allow"),
      onRecheck: () => actions.push("recheck"),
      ...props,
    },
  });
  return { ui, actions };
}

test("before permission, one live button asks for the microphone", async (t) => {
  const { ui, actions } = await hello(t);
  const [allow] = ui.byAttr("data-variant", "live");
  assert.ok(allow.textContent.includes("setupFlow.hello.allowMic"));
  await ui.click(allow);
  assert.deepEqual(actions, ["allow"]);
  assert.equal(ui.findAll((node) => node.tagName === "SELECT").length, 0, "no picker before permission");
});

test("with permission, the meter shows which microphone is listening", async (t) => {
  const { ui } = await hello(t, { access: "granted", preview: preview({ status: "live", deviceLabel: "MacBook Pro Microphone" }) });
  assert.equal(ui.byAttr("data-level-bar").length, 5);
  expectKey(ui, "setupFlow.hello.micReady", { device: "MacBook Pro Microphone" });
});

test("the picker lists the system default and each input, and picking one reports it", async (t) => {
  const { ui, actions } = await hello(t, { access: "granted", preview: preview({ status: "live", inputs: [usb] }) });
  const [select] = ui.findAll((node) => node.tagName === "SELECT");
  const options = ui.findAll((node) => node.tagName === "OPTION").map((node) => node.textContent);
  assert.deepEqual(options, ["setupFlow.hello.systemDefault", "USB Mic"]);
  await React.act(async () => ui.reactProps(select).onChange({ target: { value: "usb" } }));
  assert.deepEqual(actions, [["pick", "usb"]]);
});

test("hearing nothing highlights the picker; a missing saved device is said", async (t) => {
  const { ui } = await hello(t, { access: "granted", preview: preview({ status: "live", silent: true }), picker: picker({ missing: true }) });
  assert.equal(ui.byAttr("data-attention", "true").length, 1);
  assert.ok(ui.text().includes("setupFlow.hello.notHearing"));
  assert.ok(ui.text().includes("setupFlow.hello.savedMicMissing"));
});

test("a denied microphone gets one recovery card with a deep link and a re-check", async (t) => {
  const opened = [];
  const { ui, actions } = await hello(t, { access: "denied" });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  globalThis.window.electronAPI.openMicrophoneSettings = async () => opened.push("privacy");
  await ui.click("setupFlow.hello.openSettings");
  await ui.click("setupFlow.hello.recheck");
  assert.deepEqual([opened, actions], [["privacy"], ["recheck"]]);
});

test("a microphone that will not open says so, and Try again reopens it (I01)", async (t) => {
  let retried = 0;
  const { ui, actions } = await hello(t, {
    access: "granted",
    preview: preview({ status: "failed", retry: () => retried++ }),
  });
  expectKey(ui, "setupFlow.hello.unavailableTitle");
  assert.equal(ui.byAttr("data-level-bar").length, 0);
  await ui.click("setupFlow.hello.retryOpen");
  assert.equal(retried, 1);
  assert.deepEqual(actions, [], "retrying an open is not a permission re-check");
});

async function mountPreview(t) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const opened = [];
  const stopped = [];
  const closed = [];
  // Each getUserMedia call is a deferred the test resolves or rejects.
  const requests = [];
  const previousDevices = Object.getOwnPropertyDescriptor(globalThis.navigator, "mediaDevices");
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: (constraints) => {
        opened.push(constraints);
        const index = opened.length;
        const track = { label: `Mic ${index}`, stop: () => stopped.push(index) };
        const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
        return new Promise((resolve, reject) => requests.push({ grant: () => resolve(stream), fail: () => reject(new Error("busy")) }));
      },
      enumerateDevices: async () => [
        { kind: "audioinput", deviceId: "default", label: "Default" },
        { kind: "audioinput", deviceId: "usb", label: "USB Mic" },
      ],
      addEventListener() {},
      removeEventListener() {},
    },
  });
  const previousContext = globalThis.AudioContext;
  globalThis.AudioContext = class {
    createAnalyser() {
      return { fftSize: 1024, getFloatTimeDomainData() {} };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    close() {
      closed.push("context");
      return Promise.resolve();
    }
  };
  t.after(() => {
    globalThis.AudioContext = previousContext;
    if (previousDevices) Object.defineProperty(globalThis.navigator, "mediaDevices", previousDevices);
    else delete globalThis.navigator.mediaDevices;
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-mic-preview-test-" });
  const { useMicLevelPreview } = await vite.ssrLoadModule("/components/onboarding/useMicLevelPreview.ts");
  let current;
  function Harness({ active, deviceId }) {
    current = useMicLevelPreview(active, deviceId);
    return null;
  }
  root = createRoot(container);
  const settle = () => React.act(async () => {}); // let promises and effects run
  const render = async (props) => {
    await React.act(async () => root.render(React.createElement(Harness, props)));
    await settle();
  };
  const grant = async (index) => {
    requests[index].grant();
    await settle();
  };
  const fail = async (index) => {
    requests[index].fail();
    await settle();
  };
  const unmount = async () => {
    await React.act(async () => root.unmount());
    root = null;
  };
  return { render, grant, fail, unmount, current: () => current, opened, stopped, closed };
}

test("the preview lists inputs and reopens on the picked device", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.grant(0);
  assert.equal(mic.current().status, "live");
  assert.deepEqual(mic.current().inputs.map((input) => input.deviceId), ["usb"]);
  await mic.render({ active: true, deviceId: "usb" });
  assert.deepEqual(mic.opened, [{ audio: true }, { audio: { deviceId: { exact: "usb" } } }]);
  assert.deepEqual(mic.stopped, [1], "the first stream is released before the second opens");
});

test("leaving Hello stops the microphone", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.grant(0);
  await mic.render({ active: false, deviceId: null });
  assert.deepEqual([mic.stopped, mic.closed, mic.current().status], [[1], ["context"], "off"]);
});

test("a microphone granted after Hello was left is stopped at once (I01)", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.unmount(); // the permission prompt is still open
  await mic.grant(0);
  assert.deepEqual(mic.stopped, [1], "the late stream is released, not left recording");
  assert.deepEqual(mic.closed, [], "no analyser was ever built for it");
});

test("a device change during the prompt releases the stale stream (I01)", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.render({ active: true, deviceId: "usb" }); // first request still pending
  await mic.grant(0);
  assert.deepEqual(mic.stopped, [1]);
  await mic.grant(1);
  assert.equal(mic.current().status, "live");
  assert.equal(mic.current().deviceLabel, "Mic 2");
});

test("a failed open can be retried while permission stays granted (I01)", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.fail(0);
  assert.equal(mic.current().status, "failed");
  await React.act(async () => mic.current().retry());
  await mic.grant(1);
  assert.equal(mic.current().status, "live");
  assert.equal(mic.opened.length, 2);
});
```

Change the flow test in `test/components/onboardingFlow.test.js` so the walk starts at Hello:
- In `mountFlow`'s defaults, replace `initialStep: "speech"` with `"welcome"`.
- In `PREVIEW`, replace `step: "speech"` with `"welcome"`.
- Prepend `"setupFlow.progress.goTo(step=setupFlow.steps.welcome)"` to the expected `seen` list.

Then append:

```js
test("Hello offers Look around first instead of a dead Back", async (t) => {
  const { ui, completed } = await mountFlow(t);
  assert.equal(ui.text().includes("setupFlow.back"), false);
  await ui.click("setupFlow.lookAroundFirst");
  assert.equal(completed().length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingMic.test.js test/components/onboardingHello.test.js test/components/onboardingFlow.test.js`
Expected: FAIL. `onboardingMic.ts`, `HelloStep` and `useMicLevelPreview` are missing, and Hello is still the old full-screen `WelcomeScreen`.

- [ ] **Step 3: Implement**

1. Create `src/utils/onboardingMic.ts`:

   ```ts
   import { isBuiltInMicrophone } from "./audioDeviceUtils";
   import { resolveMicDeviceSelection } from "../helpers/micDeviceSelection";

   // Hello's microphone picker over the same settings MicrophoneSettings writes,
   // so the device chosen in setup is the one every dictation uses.
   export type MicSelectionMode = "system" | "built-in" | "specific";

   export interface AudioInput {
     deviceId: string;
     label: string;
     isBuiltIn: boolean;
   }

   export const SYSTEM_MIC = "__system__";
   export const BUILT_IN_MIC = "__built-in__";
   const PSEUDO_DEVICES = new Set(["default", "communications"]);

   export function toAudioInputs(
     devices: ReadonlyArray<Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">>
   ): AudioInput[] {
     return devices
       .filter((device) => device.kind === "audioinput" && !PSEUDO_DEVICES.has(device.deviceId))
       .map((device) => ({ deviceId: device.deviceId, label: device.label, isBuiltIn: isBuiltInMicrophone(device.label) }));
   }

   export interface MicPickerModel {
     value: string;
     previewDeviceId: string | null;
     hasBuiltIn: boolean;
     devices: AudioInput[];
     missing: boolean;
   }

   export function micPickerModel(
     devices: AudioInput[],
     mode: MicSelectionMode,
     selectedId: string,
     selectedLabel: string
   ): MicPickerModel {
     const builtIn = devices.find((device) => device.isBuiltIn) ?? null;
     const base = { hasBuiltIn: Boolean(builtIn), devices, missing: false };
     if (mode === "built-in" && builtIn) return { ...base, value: BUILT_IN_MIC, previewDeviceId: builtIn.deviceId };
     if (mode === "specific") {
       const resolved = resolveMicDeviceSelection(devices, selectedId, selectedLabel);
       if (resolved.device) return { ...base, value: resolved.device.deviceId, previewDeviceId: resolved.device.deviceId };
       return { ...base, value: SYSTEM_MIC, previewDeviceId: null, missing: Boolean(selectedId) && devices.length > 0 };
     }
     return { ...base, value: SYSTEM_MIC, previewDeviceId: null };
   }

   export function selectionFor(value: string, devices: AudioInput[]): { mode: MicSelectionMode; device: AudioInput | null } {
     if (value === SYSTEM_MIC) return { mode: "system", device: null };
     if (value === BUILT_IN_MIC) return { mode: "built-in", device: null };
     const device = devices.find((candidate) => candidate.deviceId === value) ?? null;
     return device ? { mode: "specific", device } : { mode: "system", device: null };
   }
   ```

   If typecheck rejects the `.js` import, add `// @ts-expect-error untyped helper` above it, as other TS callers of `src/helpers/*.js` do. `MicrophoneSettings.tsx:9` imports the same module without one, so it should not be needed.

2. Create `src/components/onboarding/useMicLevelPreview.ts`:

   ```ts
   import { useCallback, useEffect, useRef, useState } from "react";
   import { analyserRms } from "../../utils/audioLevel";
   import { SILENCE_HINT_MS, VOICE_LEVEL_FLOOR } from "../../utils/onboardingTrial";
   import { toAudioInputs, type AudioInput } from "../../utils/onboardingMic";

   export interface MicLevelPreview {
     status: "off" | "starting" | "live" | "failed";
     deviceLabel: string | null;
     heardVoice: boolean;
     silent: boolean;
     inputs: AudioInput[];
     readLevel(): number;
     retry(): void;
   }

   const SAMPLE_MS = 80;

   /**
    * A level meter for Hello. Nothing is recorded: the stream feeds an analyser
    * only. Every stream is stopped when Hello is left or the device changes,
    * including one that resolves after its effect was cleaned up (I01).
    */
   export function useMicLevelPreview(active: boolean, deviceId: string | null = null): MicLevelPreview {
     const levelRef = useRef(0);
     const [attempt, setAttempt] = useState(0);
     const [state, setState] = useState<Omit<MicLevelPreview, "readLevel" | "retry">>({
       status: "off",
       deviceLabel: null,
       heardVoice: false,
       silent: false,
       inputs: [],
     });

     useEffect(() => {
       if (!active) {
         setState((previous) => ({ ...previous, status: "off", silent: false }));
         return;
       }
       let cancelled = false;
       let heard = false;
       let stream: MediaStream | null = null;
       let context: AudioContext | null = null;
       let timer: ReturnType<typeof setInterval> | null = null;
       let silenceTimer: ReturnType<typeof setTimeout> | null = null;
       const devices = navigator.mediaDevices;
       const listInputs = async () => {
         try {
           const inputs = toAudioInputs(await devices.enumerateDevices());
           if (!cancelled) setState((previous) => ({ ...previous, inputs }));
         } catch {
           // The picker keeps its last list.
         }
       };
       const release = () => {
         if (timer) clearInterval(timer);
         if (silenceTimer) clearTimeout(silenceTimer);
         stream?.getTracks().forEach((track) => track.stop());
         void context?.close();
         stream = null;
         context = null;
       };
       setState((previous) => ({ ...previous, status: "starting", heardVoice: false, silent: false }));
       void (async () => {
         let acquired: MediaStream | null = null;
         try {
           acquired = await devices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
           if (cancelled) {
             // Cleanup already ran while the prompt was open: this stream has no owner.
             acquired.getTracks().forEach((track) => track.stop());
             return;
           }
           stream = acquired;
           context = new AudioContext();
           const analyser = context.createAnalyser();
           analyser.fftSize = 1024;
           context.createMediaStreamSource(stream).connect(analyser);
           const buffer: { current: Float32Array<ArrayBuffer> | null } = { current: null };
           setState((previous) => ({ ...previous, status: "live", deviceLabel: acquired?.getAudioTracks()[0]?.label || null }));
           void listInputs();
           devices.addEventListener?.("devicechange", listInputs);
           silenceTimer = setTimeout(() => {
             if (!heard && !cancelled) setState((previous) => ({ ...previous, silent: true }));
           }, SILENCE_HINT_MS);
           timer = setInterval(() => {
             const level = analyserRms(analyser, buffer);
             levelRef.current = level;
             if (level > VOICE_LEVEL_FLOOR && !heard) {
               heard = true;
               setState((previous) => ({ ...previous, heardVoice: true, silent: false }));
             }
           }, SAMPLE_MS);
         } catch {
           // A failed setup must not leave a half-open stream behind.
           if (stream === null) acquired?.getTracks().forEach((track) => track.stop());
           release();
           if (!cancelled) setState((previous) => ({ ...previous, status: "failed" }));
         }
       })();
       return () => {
         cancelled = true;
         devices?.removeEventListener?.("devicechange", listInputs);
         release();
         levelRef.current = 0;
       };
     }, [active, deviceId, attempt]);

     const readLevel = useCallback(() => levelRef.current, []);
     const retry = useCallback(() => setAttempt((value) => value + 1), []);
     return { ...state, readLevel, retry };
   }
   ```

3. Create `src/components/onboarding/HelloStep.tsx`:

   ```tsx
   import { useId } from "react";
   import { useTranslation } from "react-i18next";
   import { Mic } from "../icons";
   import { Button } from "../ui/button";
   import { LevelBars } from "../ui/LevelBars";
   import { BUILT_IN_MIC, SYSTEM_MIC, type MicPickerModel } from "../../utils/onboardingMic";
   import { RecoveryCard } from "./RecoveryCard";
   import { openMicrophoneHelp, type MicAccess } from "./useMicrophoneAccess";
   import type { MicLevelPreview } from "./useMicLevelPreview";

   export interface HelloStepProps {
     platform: "darwin" | "linux" | "win32";
     access: MicAccess;
     preview: MicLevelPreview;
     picker: MicPickerModel;
     onPickMicrophone(value: string): void;
     onAllow(): void;
     onRecheck(): void;
   }

   export function HelloStep({ platform, access, preview, picker, onPickMicrophone, onAllow, onRecheck }: HelloStepProps) {
     const { t } = useTranslation();
     const pickerId = useId();
     const recheck = { label: t("setupFlow.hello.recheck"), onClick: onRecheck, variant: "ghost" as const };

     if (access === "denied") {
       return (
         <RecoveryCard
           title={t("setupFlow.hello.deniedTitle")}
           body={t(platform === "darwin" ? "setupFlow.hello.deniedBodyMac" : "setupFlow.hello.deniedBodyOther")}
           actions={[{ label: t("setupFlow.hello.openSettings"), onClick: () => void openMicrophoneHelp(platform) }, recheck]}
         />
       );
     }
     if (preview.status === "failed") {
       return (
         <RecoveryCard
           title={t("setupFlow.hello.unavailableTitle")}
           body={t("setupFlow.hello.unavailableBody")}
           actions={[
             { label: t("setupFlow.hello.retryOpen"), onClick: preview.retry },
             { label: t("setupFlow.hello.openSound"), onClick: () => void window.electronAPI?.openSoundInputSettings?.(), variant: "ghost" },
           ]}
         />
       );
     }
     return (
       <section className="onb-card" aria-labelledby="onb-hello-mic">
         <h2 id="onb-hello-mic" className="onb-card__title">
           {t("setupFlow.hello.micTitle")}
         </h2>
         {access === "granted" ? (
           <>
             <div className="onb-mic-row">
               <Mic aria-hidden="true" className="onb-mic-row__icon" />
               <LevelBars readLevel={preview.readLevel} height={20} />
               <span>
                 {preview.deviceLabel
                   ? t("setupFlow.hello.micReady", { device: preview.deviceLabel })
                   : t("setupFlow.hello.micReadyGeneric")}
               </span>
             </div>
             <div className="onb-select-row" data-attention={preview.silent || picker.missing || undefined}>
               <label htmlFor={pickerId}>{t("setupFlow.hello.micLabel")}</label>
               <select id={pickerId} value={picker.value} onChange={(event) => onPickMicrophone(event.target.value)}>
                 <option value={SYSTEM_MIC}>{t("setupFlow.hello.systemDefault")}</option>
                 {picker.hasBuiltIn ? <option value={BUILT_IN_MIC}>{t("setupFlow.hello.builtIn")}</option> : null}
                 {picker.devices.map((device) => (
                   <option key={device.deviceId} value={device.deviceId}>
                     {device.label || t("setupFlow.hello.unnamedMic")}
                   </option>
                 ))}
               </select>
             </div>
             {preview.silent ? (
               <p className="onb-warning" role="status">
                 {t("setupFlow.hello.notHearing")}
               </p>
             ) : null}
             {picker.missing ? <p className="onb-muted">{t("setupFlow.hello.savedMicMissing")}</p> : null}
           </>
         ) : (
           <Button variant="live" onClick={onAllow}>
             <Mic aria-hidden="true" />
             {t("setupFlow.hello.allowMic")}
           </Button>
         )}
         <p className="onb-muted">{t("setupFlow.hello.micBody")}</p>
       </section>
     );
   }
   ```

4. Create `src/components/onboarding/PrivacyDefaults.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Toggle } from "../ui/toggle";

   export interface PrivacyDefaultsProps {
     platform: "darwin" | "linux" | "win32";
     historyEnabled: boolean;
     onHistoryChange(value: boolean): void;
     updatesEnabled: boolean;
     onUpdatesChange(value: boolean): void;
   }

   /** The two choices that used to sit on Welcome (owner decision 2): unchanged defaults. */
   export function PrivacyDefaults({
     platform,
     historyEnabled,
     onHistoryChange,
     updatesEnabled,
     onUpdatesChange,
   }: PrivacyDefaultsProps) {
     const { t } = useTranslation();
     const device = platform === "darwin" ? "Mac" : "Other";
     const rows = [
       { id: "history", checked: historyEnabled, onChange: onHistoryChange, body: `historyBody${device}` },
       { id: "updates", checked: updatesEnabled, onChange: onUpdatesChange, body: "updatesBody" },
     ];
     return (
       <section className="onb-card" aria-labelledby="onb-privacy-defaults">
         <h2 id="onb-privacy-defaults" className="onb-card__title">
           {t("setupFlow.privacy.title")}
         </h2>
         {rows.map((row) => (
           <div key={row.id} className="onb-toggle-row">
             <div>
               <p className="onb-toggle-row__title">{t(`setupFlow.privacy.${row.id}Title`)}</p>
               <p className="onb-muted">{t(`setupFlow.privacy.${row.body}`)}</p>
             </div>
             <Toggle checked={row.checked} onChange={row.onChange} aria-label={t(`setupFlow.privacy.${row.id}Title`)} />
           </div>
         ))}
       </section>
     );
   }
   ```

5. In `src/components/OnboardingFlow.tsx`:
   - Apply the **[T12]** blocks of the composition: imports, the Hello state, the picker, the privacy-defaults state with `changeUpdates`, and the `welcome` case of `stepView()`.
   - Delete the `WelcomeScreen` import and the welcome early return.
   - Add `import "../styles/onboarding-welcome.css";` for the legacy wrapper (Task 18 removes it).
   - Inside the legacy `FinishStep`, render `<PrivacyDefaults platform={platform} historyEnabled={dataRetentionEnabled} onHistoryChange={setDataRetentionEnabled} updatesEnabled={updatesEnabled} onUpdatesChange={changeUpdates} />` under the readiness list. Task 18 moves it into `ReadyStep`.

6. In `src/preview/WelcomeVariations.tsx`, replace the `WelcomeScreen` import with `import OnboardingFlow from "../components/OnboardingFlow";`. Then replace the design-2 `<WelcomeScreen … />` element (197-204) with:

   ```tsx
   <OnboardingFlow
     initialStep="welcome"
     previewConfig={{ step: "welcome", scenario: "fresh", platform: "macos" }}
     onExplore={() => goTo("workspace")}
     onComplete={() => goTo("workspace")}
   />
   ```

   Design 02 keeps rendering "the same welcome component used by the desktop app" (`docs/ONBOARDING_PREVIEW.md`), which is now Hello.

7. Delete `src/components/onboarding/WelcomeScreen.tsx`. Confirm `grep -rn "onboarding/WelcomeScreen" src test` prints nothing first.

8. Append to `src/styles/onboarding.css`:

   ```css
   .onb-card {
     display: grid;
     gap: 12px;
     padding: 18px 20px;
     border: 1px solid var(--color-border);
     border-radius: 12px;
     background: var(--color-card);
   }

   .onb-card__title {
     margin: 0;
     font-size: 16px;
     font-weight: 650;
   }

   .onb-muted {
     margin: 0;
     font-size: 13px;
     line-height: 1.45;
     color: var(--color-muted-foreground);
   }

   .onb-mic-row {
     display: flex;
     align-items: center;
     gap: 12px;
     font-size: 14px;
   }

   .onb-mic-row__icon {
     width: 18px;
     height: 18px;
     color: var(--color-muted-foreground);
   }

   .onb-select-row {
     display: grid;
     gap: 6px;
     padding: 10px 12px;
     border: 1px solid var(--color-border);
     border-radius: 10px;
     font-size: 13px;
     transition: border-color var(--motion-fast) var(--motion-ease-std);
   }

   /* R3 C "nothing heard": the device select is what to check first. */
   .onb-select-row[data-attention] {
     border-color: var(--color-live);
     box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-live) 18%, transparent);
   }

   .onb-select-row select {
     min-height: 36px;
     padding-inline: 10px;
     border: 1px solid var(--color-border);
     border-radius: 6px;
     background: var(--color-background);
     color: var(--color-foreground);
     font: inherit;
   }

   .onb-select-row select:focus-visible {
     outline: 2px solid var(--color-ring);
     outline-offset: 2px;
   }

   .onb-toggle-row {
     display: flex;
     align-items: center;
     justify-content: space-between;
     gap: 16px;
     padding-top: 12px;
     border-top: 1px solid var(--color-border);
   }

   .onb-toggle-row__title {
     margin: 0;
     font-size: 14px;
     font-weight: 600;
   }
   ```

9. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "hello": {
         "start": "Get started",
         "micTitle": "Let Loqui hear you",
         "micBody": "Loqui listens only while you dictate. Nothing on this screen is recorded.",
         "allowMic": "Allow microphone",
         "micReady": "{{device}} is listening",
         "micReadyGeneric": "Your microphone is listening",
         "micLabel": "Microphone",
         "systemDefault": "System default",
         "builtIn": "Built-in microphone",
         "unnamedMic": "Unnamed microphone",
         "notHearing": "Not hearing you? Choose another microphone.",
         "savedMicMissing": "Your saved microphone isn't connected, so Loqui is using the system default.",
         "deniedTitle": "Loqui can't use your microphone",
         "deniedBodyMac": "Allow it in System Settings, then come back. Loqui checks again when you return.",
         "deniedBodyOther": "Allow it in your system's privacy or sound settings, then come back. Loqui checks again when you return.",
         "openSettings": "Open System Settings",
         "recheck": "I've turned it on",
         "unavailableTitle": "Loqui can't open your microphone",
         "unavailableBody": "Another app may be using it, or no input device is connected.",
         "retryOpen": "Try again",
         "openSound": "Open Sound settings"
       },
       "privacy": {
         "title": "Privacy defaults",
         "historyTitle": "Keep local history",
         "historyBodyMac": "Save transcripts on this Mac. Change anytime in Privacy & Data.",
         "historyBodyOther": "Save transcripts on this computer. Change anytime in Privacy & Data.",
         "updatesTitle": "Download updates automatically",
         "updatesBody": "Check signed releases daily. You choose when to restart."
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/utils/onboardingMic.test.js test/components/onboardingHello.test.js test/components/onboardingFlow.test.js test/components/onboardingShell.test.js && npm run typecheck && npm run i18n:check`

Plan 02's `onboardingShell.test.js` test "both shells carry the platform" renders `WelcomeScreen`. Delete that one test in this task, because the file it renders is gone. The new shell's platform assertions (Task 11) cover the same behaviour.
Expected: PASS.

Preview: open `?preview=onboarding&step=welcome&scenario=fresh`. Check:
- "Allow microphone" turns into a live meter and a microphone picker;
- picking another input reopens the meter on it;
- the rail bars follow your voice;
- after 2.5 s of silence the picker is highlighted.

With `scenario=microphone-denied` you get one recovery card. The picker runs on the browser's real `navigator.mediaDevices`; it needs no bridge fake.

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingMic.ts src/components/onboarding/useMicLevelPreview.ts src/components/onboarding/HelloStep.tsx src/components/onboarding/PrivacyDefaults.tsx src/components/OnboardingFlow.tsx src/preview/WelcomeVariations.tsx src/styles/onboarding.css src/locales test/utils/onboardingMic.test.js test/components/onboardingHello.test.js test/components/onboardingFlow.test.js
git rm src/components/onboarding/WelcomeScreen.tsx
git commit -m "feat(onboarding): Hello asks for the microphone, shows it listening, and lets you pick it"
```

---

### Task 13: Voice, detected for you

Covers:
- ONB-R3 C under D8;
- the start of ONB-R4 B;
- ONB-Q12 for voices, and Q17 ("Pick how Loqui listens.", "Download (631 MB)");
- review findings I02 (local commit sets the dictation mode), I03 (language and model are reconciled, and language is locked during a transfer) and I14 (the rendered progress row).

This task also migrates Plan 02's `onboardingDownloadProgress` behaviours onto the new UI.

**Files:**
- Create:
  - `src/components/onboarding/useSystemProfile.ts`
  - `src/components/onboarding/VoiceStep.tsx`
  - `src/components/onboarding/VoiceDownloadPanel.tsx`
  - `src/components/onboarding/DownloadChip.tsx`
- Modify `src/components/OnboardingFlow.tsx`. Apply the **[T13]** blocks of the composition, then delete:
  - `SpeechStep` and `ChoiceCard`'s speech use;
  - Plan 02's speech wiring: `useModelDownload` destructuring, `downloadRequestRef`, `liveSpeechDownload`, `speechProgress`, `cancelSpeechDownload`, `downloadModel`, the preview timer and the footer chip;
  - the old `selectedModel`/`speechModelReady`/`downloadState` state and the model-status effect.

  In the legacy `try`/`finish` bodies, replace `speechModelReady` with `voiceStatus === "ready"`.
- Modify `src/styles/onboarding.css` (append).
- Modify `test/components/personalWorkspace.test.js`. Delete "speech setup offers Orukeet and NVIDIA models…" and "preview speech choices stay in preview storage". Their coverage moves below.
- Rewrite `test/components/onboardingDownloadProgress.test.js` (Plan 02's file). It keeps the same five behaviours, on the new UI.
- Test:
  - `test/components/onboardingVoice.test.js`
  - append to `test/components/onboardingFlow.test.js`

**Interfaces:**
- Consumes:
  - from Task 3: `detectVoice`, `reconcileVoice`, `voiceSupportsAll`, `isOnboardingVoice`, `spokenLocalesFor` and `modelDownloadBytes`;
  - from Task 7: `useVoiceDownload`;
  - from Task 9: `RadioCardGroup`;
  - from Plan 01: `LocalityRing`;
  - from Plan 02: `DownloadProgressBar` (`{ modelName, progress: { percentage, downloadedBytes, totalBytes, speed?, eta? }, isInstalling? }`, which renders `role="progressbar"` and speed in MB/s);
  - the default export `LanguageSelector` (`{ value, onChange }`);
  - `setTranscriptionMode` (`src/stores/settingsStore.ts:1651`).
- Produces:

  ```ts
  export function useSystemProfile(): SystemProfile | null; // getSystemProfile + Plan 03's getTotalMemory; navigator.languages when the bridge is absent
  export interface VoiceStepProps {
    platform: "darwin" | "linux" | "win32"; profile: SystemProfile | null; pick: VoicePick | null;
    selectedModel: string | null; onSelectModel(modelId: string): void;
    language: string; onLanguageChange(language: string): void;
    languageLocked: boolean;         // a transfer is running (I03)
    compatible: boolean;             // the selected model hears every spoken language
    blockedId: string;               // id of the reason the primary is disabled
    download: VoiceDownloadState; onStartDownload(): void; onCancelDownload(): void;
  }
  export function VoiceDownloadPanel(props: { state: VoiceDownloadState; modelName: string; onStart(): void; onCancel(): void }): JSX.Element | null;
  export function DownloadChip(props: { state: VoiceDownloadState; onStart(): void }): JSX.Element | null;
  ```

- **Settings rule.** Viewing Voice writes nothing. `commitVoice` (composition [T13]) runs only from the primary. It sets `transcriptionMode: "local"`, the local engine and `spokenLanguages`. Meeting and upload routes are left alone.

- [ ] **Step 1: Write the failing tests**

Create `test/components/onboardingVoice.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const profile = (patch = {}) => ({
  locales: ["en-US"],
  totalMemoryBytes: 16 * 1024 ** 3,
  freeDiskBytes: 212e9,
  gpu: { kind: "apple-silicon", name: null },
  ...patch,
});

async function voice(t, patch = {}) {
  const { detectVoice } = await import("../../src/utils/onboardingDetection.ts");
  const p = patch.profile ?? profile();
  const pick = detectVoice(p);
  const events = [];
  const ui = await mountComponent(t, "/components/onboarding/VoiceStep.tsx", {
    exportName: "VoiceStep",
    props: {
      platform: "darwin",
      profile: p,
      pick,
      selectedModel: pick.modelId,
      onSelectModel: (id) => events.push(["select", id]),
      language: p.locales[0] ?? "en-US",
      onLanguageChange: (language) => events.push(["language", language]),
      languageLocked: false,
      compatible: pick.modelId !== null,
      blockedId: "onb-voice-blocked",
      download: { status: "idle" },
      onStartDownload: () => events.push(["start"]),
      onCancelDownload: () => events.push(["cancel"]),
      ...patch.props,
    },
  });
  return { ui, events };
}

test("says what it noticed and why it picked this voice", async (t) => {
  const { ui } = await voice(t);
  expectKey(ui, "setupFlow.voice.title");
  expectKey(ui, "setupFlow.voice.why.englishMac");
  assert.equal(ui.findAll((node) => node.attributes.class === "onb-signal").length, 4);
  expectKey(ui, "setupFlow.voice.gpu.appleSilicon");
  expectKey(ui, "setupFlow.voice.outcomes.fastEnglish.name");
  assert.ok(ui.text().includes("Parakeet Unified EN 0.6B"), "the catalog name stays one glance away");
  assert.equal(ui.byAttr("data-locality", "device").length, 1);
  assert.equal(ui.byAttr("role", "radiogroup").length, 0, "the picker starts closed");
});

test("a short disk is said before the download, with real numbers", async (t) => {
  const { ui } = await voice(t, { profile: profile({ freeDiskBytes: 412e6 }) });
  const [note] = ui.byAttr("role", "note");
  assert.ok(note.textContent.includes("setupFlow.voice.diskShort"));
  assert.ok(note.textContent.includes("412"));
});

test("an unsupported language opens the picker and names the block", async (t) => {
  const { ui } = await voice(t, { profile: profile({ locales: ["he-IL"] }), props: { compatible: false } });
  expectKey(ui, "setupFlow.voice.unsupportedTitle");
  assert.equal(ui.byAttr("role", "radiogroup").length, 1);
  assert.ok(ui.byAttr("id", "onb-voice-blocked")[0].textContent.includes("setupFlow.voice.blocked.none"));
});

test("the picker lists every voice and blocks the ones that can't hear you", async (t) => {
  const { ui, events } = await voice(t, { props: { language: "ja-JP" } });
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  const radios = ui.byAttr("role", "radio");
  assert.equal(radios.length, 5);
  for (const name of ["Orukeet", "Parakeet TDT 0.6B", "Parakeet Unified EN 0.6B", "Nemotron Speech Streaming EN 0.6B", "Nemotron 3.5 ASR Streaming 0.6B"]) {
    assert.ok(ui.text().includes(name), name);
  }
  assert.equal(radios.find((r) => r.attributes["data-value"] === "parakeet-unified-en-0.6b").attributes["aria-disabled"], "true");
  await ui.click(radios.find((r) => r.attributes["data-value"] === "nemotron-3.5-asr-streaming-0.6b"));
  assert.deepEqual(events, [["select", "nemotron-3.5-asr-streaming-0.6b"]]);
});

test("while a transfer runs, voice and language are locked with a reason, and Cancel is right there", async (t) => {
  const busy = { status: "downloading", percent: 42, downloadedBytes: 264e6, totalBytes: 631e6, bytesPerSecond: 8e6, etaSeconds: 46 };
  const { ui, events } = await voice(t, { props: { download: busy, languageLocked: true } });
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  assert.ok(ui.byAttr("role", "radio").every((radio) => radio.attributes["aria-disabled"] === "true"));
  assert.ok("disabled" in ui.findAll((node) => node.tagName === "FIELDSET")[0].attributes, "language is locked (I03)");
  expectKey(ui, "setupFlow.voice.languageLocked");
  assert.equal(ui.byAttr("role", "progressbar")[0].attributes["aria-valuenow"], "42");
  expectKey(ui, "setupFlow.download.received");
  await ui.click("setupFlow.download.cancel");
  assert.deepEqual(events, [["cancel"]]);
});

test("a stopped download says whether its progress was kept, and offers Retry", async (t) => {
  const { ui, events } = await voice(t, { props: { download: { status: "error", message: "Network timeout", percent: 42, progressKept: true } } });
  expectKey(ui, "setupFlow.download.stoppedKept", { percent: 42 });
  await ui.rerender({ download: { status: "error", message: "HTTP 404", percent: 42, progressKept: false } });
  expectKey(ui, "setupFlow.download.stoppedRestart", { percent: 42 });
  await ui.click("setupFlow.download.retry");
  assert.deepEqual(events, [["start"]]);
});

test("the footer chip truncates, says what happened, and restarts a cancelled download", async (t) => {
  const started = [];
  const ui = await mountComponent(t, "/components/onboarding/DownloadChip.tsx", {
    exportName: "DownloadChip",
    props: { state: { status: "downloading", percent: 42, downloadedBytes: 1, totalBytes: 2, bytesPerSecond: 8e6, etaSeconds: 46 }, onStart: () => started.push(1) },
  });
  expectKey(ui, "setupFlow.download.chip", { percent: 42 });
  await ui.rerender({ state: { status: "downloading", percent: 42, downloadedBytes: 1, totalBytes: 2, bytesPerSecond: null, etaSeconds: null } });
  expectKey(ui, "setupFlow.download.chipNoEta", { percent: 42 });
  await ui.rerender({ state: { status: "cancelled" } });
  await ui.click("setupFlow.download.downloadAgain");
  assert.deepEqual(started, [1]);
  await ui.rerender({ state: { status: "idle" } });
  assert.equal(ui.byAttr("data-status").length, 0);
});
```

Rewrite `test/components/onboardingDownloadProgress.test.js` (Plan 02's five behaviours, on the new Voice UI):

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");
const { listenerBus } = require("../helpers/harness/listenerBus");

const MODEL = "parakeet-unified-en-0.6b";
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

// Mounts the real flow on Voice with an English profile, so the pick is MODEL.
async function mountVoice(t, { cancelResult = { success: true } } = {}) {
  const progress = listenerBus();
  let installed = false;
  const pending = [];
  const counts = { cancels: 0 };
  const ui = await mountComponent(t, "/components/OnboardingFlow.tsx", {
    props: { onComplete() {}, initialStep: "speech", previewConfig: { step: "speech", scenario: "fresh", platform: "linux" } },
    mocks: { "/SettingsPage": "export default function SettingsPage() { return null; }" },
    api: {
      getSystemProfile: async () => ({ locales: ["en-US"], freeDiskBytes: 5e11, gpu: { kind: "unknown", name: null } }),
      getTotalMemory: async () => 16e9,
      checkParakeetModelStatus: async () => ({ success: true, model: MODEL, downloaded: installed }),
      modelGetActiveDownloads: async () => [],
      onParakeetDownloadProgress: progress.subscribe,
      downloadParakeetModel: () => {
        const request = deferred();
        pending.push(request);
        return request.promise;
      },
      cancelParakeetDownload: async () => (counts.cancels++, cancelResult),
    },
  });
  const settle = () => React.act(async () => {});
  await settle();
  return {
    ui,
    counts,
    settle,
    install: () => (installed = true),
    emit: (data) => React.act(async () => progress.emit({}, { model: MODEL, ...data })),
    resolve: (result) => React.act(async () => pending.shift().resolve({ model: MODEL, ...result })),
    // Download from Voice, then come back to it: the panel shows the transfer.
    async startAndReturn() {
      await ui.click(ui.byAttr("data-onb-primary")[0]);
      await ui.click("setupFlow.back");
    },
  };
}

const progressbar = (ui) => ui.byAttr("role", "progressbar")[0] ?? null;
const PROGRESS = { type: "progress", percentage: 42, downloaded_bytes: 265_000_000, total_bytes: 631_000_000 };

test("Voice shows the real download percentage as a progressbar", async (t) => {
  const v = await mountVoice(t);
  await v.startAndReturn();
  await v.emit(PROGRESS);
  assert.equal(progressbar(v.ui).attributes["aria-valuenow"], "42");
  assert.equal(v.ui.findAll((node) => /\banimate-pulse\b/.test(node.attributes.class ?? "")).length, 0, "no fake bar");
});

test("a download in flight follows the user to later steps as a footer chip", async (t) => {
  const v = await mountVoice(t);
  await v.startAndReturn();
  await v.emit(PROGRESS);
  await v.ui.click(v.ui.byAttr("data-onb-primary")[0]); // Continue → Say something
  await v.ui.click("setupFlow.skipStep"); // → Cleanup
  // One sample cannot establish a rate, so there is no ETA yet (the chip never invents one).
  expectKey(v.ui, "setupFlow.download.chipNoEta", { percent: 42 });
});

test("a confirmed cancel leaves Download again, and a late result cannot mark it failed", async (t) => {
  const v = await mountVoice(t);
  await v.startAndReturn();
  await v.emit(PROGRESS);
  await v.ui.click("setupFlow.download.cancel");
  assert.equal(v.counts.cancels, 1);
  await v.emit({ type: "error", error: "Download cancelled", code: "DOWNLOAD_CANCELLED" });
  await v.resolve({ success: false, downloaded: false, error: "cancelled", code: "DOWNLOAD_CANCELLED" });
  expectKey(v.ui, "setupFlow.download.cancelledLine");
  assert.equal(v.ui.text().includes("setupFlow.download.stoppedRestart"), false);
  assert.equal(progressbar(v.ui), null);
  assert.ok(v.ui.findAll((node) => node.tagName === "BUTTON" && node.textContent.includes("setupFlow.download.downloadAgain")).length >= 1);
});

test("a cancel main refuses keeps the download and its result", async (t) => {
  const v = await mountVoice(t, { cancelResult: { success: false, code: "INSTALLATION_IN_PROGRESS" } });
  await v.startAndReturn();
  await v.emit({ ...PROGRESS, percentage: 99 });
  await v.ui.click("setupFlow.download.cancel");
  assert.equal(v.counts.cancels, 1);
  assert.ok(progressbar(v.ui), "the transfer is still shown");
  v.install();
  await v.emit({ type: "complete" });
  await v.resolve({ success: true, downloaded: true });
  await v.settle();
  expectKey(v.ui, "setupFlow.voice.installed");
});

test("the download cannot be restarted until the cancelled request settles", async (t) => {
  const v = await mountVoice(t);
  await v.startAndReturn();
  await v.emit(PROGRESS);
  await v.ui.click("setupFlow.download.cancel");
  const again = () => v.ui.findAll((node) => node.tagName === "BUTTON" && node.textContent.includes("setupFlow.download.downloadAgain"));
  assert.equal(again().length, 0, "still cancelling");
  assert.ok("disabled" in v.ui.byAttr("data-onb-primary")[0].attributes);
  await v.emit({ type: "error", error: "Download cancelled", code: "DOWNLOAD_CANCELLED" });
  await v.resolve({ success: false, downloaded: false, error: "cancelled", code: "DOWNLOAD_CANCELLED" });
  assert.ok(again().length >= 1);
  assert.equal("disabled" in v.ui.byAttr("data-onb-primary")[0].attributes, false);
});
```

Append to `test/components/onboardingFlow.test.js`:

```js
const LANGUAGE_SELECTOR_MOCK = `
import React from "react";
export default function LanguageSelector({ value, onChange }) {
  return React.createElement("select", { "data-language": "", value, onChange: (event) => onChange(event.target.value) });
}`;
const voiceApi = (locales, extra = {}) => ({
  getSystemProfile: async () => ({ locales, freeDiskBytes: 5e11, gpu: { kind: "unknown", name: null } }),
  getTotalMemory: async () => 16e9,
  checkParakeetModelStatus: async () => ({ success: true, downloaded: false }),
  modelGetActiveDownloads: async () => [],
  downloadParakeetModel: () => new Promise(() => {}),
  ...extra,
});

test("viewing Voice writes nothing; its primary makes dictation local, even from self-hosted (I02)", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "speech" }, {
    api: voiceApi(["es-ES", "en-US"]),
    storage: {
      transcriptionMode: "self-hosted",
      remoteTranscriptionUrl: "http://10.0.0.5:9000",
      meetingTranscriptionMode: "self-hosted",
    },
  });
  await React.act(async () => {});
  assert.equal(ui.storage.getItem("parakeetModel"), null);
  assert.equal(ui.calls.filter(([name]) => name === "downloadParakeetModel").length, 0);
  await ui.click(primary(ui));
  const settings = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore.getState();
  assert.deepEqual(
    [settings.transcriptionMode, settings.useLocalWhisper, settings.localTranscriptionProvider, settings.parakeetModel],
    ["local", true, "nvidia", "orukeet-v0.1.0"]
  );
  assert.deepEqual(settings.spokenLanguages, ["es-ES", "en-US"]);
  assert.equal(settings.meetingTranscriptionMode, "self-hosted", "note recording keeps its own route");
  const { resolveTranscriptionRoute } = await ui.vite.ssrLoadModule("/helpers/transcriptionRoute.ts");
  assert.equal(resolveTranscriptionRoute({ settings }).transport, "local", "the real resolver no longer routes to the old server");
  assert.deepEqual(ui.calls.filter(([name]) => name === "downloadParakeetModel"), [["downloadParakeetModel", "orukeet-v0.1.0"]]);
});

test("a supported secondary OS locale remains committable without manual language changes", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "speech" }, { api: voiceApi(["he-IL", "fr-FR"]) });
  await React.act(async () => {});
  assert.equal(ui.byAttr("aria-checked", "true")[0].attributes["data-value"], "orukeet-v0.1.0");
  assert.equal("disabled" in primary(ui).attributes, false);
  await ui.click(primary(ui));
  const settings = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore.getState();
  assert.deepEqual(settings.spokenLanguages, ["fr-FR"]);
  assert.equal(settings.preferredLanguage, "fr-FR");
  assert.deepEqual(ui.calls.filter(([name]) => name === "downloadParakeetModel"), [["downloadParakeetModel", "orukeet-v0.1.0"]]);
});

test("a language change never leaves an incompatible voice committable (I03)", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "speech" }, {
    api: voiceApi(["en-US"]),
    mocks: { "/SettingsPage": "export default function SettingsPage() { return null; }", "ui/LanguageSelector": LANGUAGE_SELECTOR_MOCK },
  });
  await React.act(async () => {});
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  const choose = (value) => React.act(async () => ui.props(ui.byAttr("data-language")[0]).onChange({ target: { value } }));
  await choose("ja-JP");
  assert.equal(ui.byAttr("aria-checked", "true")[0].attributes["data-value"], "nemotron-3.5-asr-streaming-0.6b");
  assert.equal("disabled" in primary(ui).attributes, false);
  await choose("he-IL");
  assert.equal(ui.byAttr("aria-checked", "true").length, 0, "no voice is selected");
  assert.ok("disabled" in primary(ui).attributes);
  assert.equal(primary(ui).attributes["aria-describedby"], "onb-voice-blocked");
  await ui.click(primary(ui));
  assert.equal(ui.calls.filter(([name]) => name === "downloadParakeetModel").length, 0, "nothing downloads or commits");
});

test("language is locked while a transfer runs (I03)", async (t) => {
  const progress = listenerBus();
  const { ui } = await mountFlow(t, { initialStep: "speech" }, {
    api: voiceApi(["en-US"], { onParakeetDownloadProgress: progress.subscribe }),
    mocks: { "/SettingsPage": "export default function SettingsPage() { return null; }", "ui/LanguageSelector": LANGUAGE_SELECTOR_MOCK },
  });
  await React.act(async () => {});
  await ui.click(primary(ui));
  await React.act(async () => progress.emit({}, { type: "progress", model: "parakeet-unified-en-0.6b", percentage: 10, downloaded_bytes: 6e7, total_bytes: 6.31e8 }));
  await ui.click("setupFlow.back");
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  await React.act(async () => ui.props(ui.byAttr("data-language")[0]).onChange({ target: { value: "ja-JP" } }));
  assert.equal(ui.byAttr("aria-checked", "true")[0].attributes["data-value"], "parakeet-unified-en-0.6b", "the flow ignores the change");
});
```

`mountFlow` passes its third argument through to `mountComponent`, so `storage` and `mocks` work. The helper's default `mocks` is replaced when a test supplies its own, which is why those tests repeat the `SettingsPage` mock.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/onboardingVoice.test.js test/components/onboardingDownloadProgress.test.js test/components/onboardingFlow.test.js`

Expected: FAIL. `VoiceStep`, `VoiceDownloadPanel` and `DownloadChip` are missing, the legacy speech step is still mounted, and `transcriptionMode` stays `self-hosted`.

- [ ] **Step 3: Implement**

1. Create `src/components/onboarding/useSystemProfile.ts`:

   ```ts
   import { useEffect, useState } from "react";
   import type { SystemFacts, SystemProfile } from "../../types/electron";

   function fallbackFacts(): SystemFacts {
     const languages = typeof navigator !== "undefined" ? [...(navigator.languages ?? [])] : [];
     return { locales: languages, freeDiskBytes: null, gpu: { kind: "unknown", name: null } };
   }

   // Total memory is Plan 03's get-total-memory (§5.1): the same main value, no second channel.
   async function totalMemory(): Promise<number | null> {
     try {
       const bytes = await window.electronAPI?.getTotalMemory?.();
       return typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0 ? bytes : null;
     } catch {
       return null;
     }
   }

   async function facts(): Promise<SystemFacts> {
     try {
       return (await window.electronAPI?.getSystemProfile?.()) ?? fallbackFacts();
     } catch {
       return fallbackFacts();
     }
   }

   /** Spec D8: hardware and OS locale, read once per setup. */
   export function useSystemProfile(): SystemProfile | null {
     const [profile, setProfile] = useState<SystemProfile | null>(null);
     useEffect(() => {
       let alive = true;
       void (async () => {
         const [base, totalMemoryBytes] = await Promise.all([facts(), totalMemory()]);
         if (alive) setProfile({ ...base, totalMemoryBytes });
       })();
       return () => {
         alive = false;
       };
     }, []);
     return profile;
   }
   ```

2. Create `src/components/onboarding/VoiceDownloadPanel.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Button } from "../ui/button";
   import { DownloadProgressBar } from "../ui/DownloadProgressBar";
   import { byteParts, type VoiceDownloadState } from "../../utils/onboardingDownload";

   /**
    * The rendered progress row (I14): Plan 02's progressbar (percent, speed in MB/s,
    * ETA), received/total, and the action that fits the state.
    */
   export function VoiceDownloadPanel({
     state,
     modelName,
     onStart,
     onCancel,
   }: {
     state: VoiceDownloadState;
     modelName: string;
     onStart(): void;
     onCancel(): void;
   }) {
     const { t, i18n } = useTranslation();
     const size = (bytes: number) => {
       const parts = byteParts(bytes, i18n?.language);
       return t(`setupFlow.units.${parts.unit}`, { value: parts.value });
     };
     if (state.status === "downloading" || state.status === "installing") {
       const downloading = state.status === "downloading";
       return (
         <div className="onb-download">
           <DownloadProgressBar
             modelName={modelName}
             isInstalling={!downloading}
             progress={{
               percentage: downloading ? state.percent : 100,
               downloadedBytes: downloading ? state.downloadedBytes : 0,
               totalBytes: downloading ? state.totalBytes : 0,
               speed: downloading && state.bytesPerSecond ? state.bytesPerSecond / 1e6 : undefined,
               eta: downloading && state.etaSeconds !== null ? state.etaSeconds : undefined,
             }}
           />
           {downloading ? (
             <div className="onb-download__row">
               <span>{t("setupFlow.download.received", { done: size(state.downloadedBytes), total: size(state.totalBytes) })}</span>
               <Button size="sm" variant="ghost" onClick={onCancel}>
                 {t("setupFlow.download.cancel")}
               </Button>
             </div>
           ) : null}
         </div>
       );
     }
     if (state.status === "cancelling") return <p className="onb-muted">{t("setupFlow.download.chipCancelling")}</p>;
     if (state.status === "cancelled") {
       return (
         <div className="onb-download__row">
           <span>{t("setupFlow.download.cancelledLine")}</span>
           <Button size="sm" onClick={onStart}>
             {t("setupFlow.download.downloadAgain")}
           </Button>
         </div>
       );
     }
     if (state.status === "error") {
       return (
         <div className="onb-warning" role="status">
           <p>
             {state.percent !== null
               ? t(state.progressKept ? "setupFlow.download.stoppedKept" : "setupFlow.download.stoppedRestart", { percent: state.percent })
               : null}{" "}
             {state.message}
           </p>
           <Button size="sm" onClick={onStart}>
             {t("setupFlow.download.retry")}
           </Button>
         </div>
       );
     }
     return null;
   }
   ```

3. Create `src/components/onboarding/DownloadChip.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Check, CircleAlert } from "../icons";
   import { etaParts, type VoiceDownloadState } from "../../utils/onboardingDownload";

   const RING = 2 * Math.PI * 6;

   /** The footer chip on steps without their own download row (ONB-R4). Truncates, never wraps. */
   export function DownloadChip({ state, onStart }: { state: VoiceDownloadState; onStart(): void }) {
     const { t } = useTranslation();
     if (state.status === "idle" || state.status === "checking") return null;
     const eta = state.status === "downloading" ? etaParts(state.etaSeconds) : null;
     const label =
       state.status === "downloading"
         ? eta
           ? t("setupFlow.download.chip", { percent: state.percent, eta: t(`setupFlow.download.eta.${eta.unit}`, { count: eta.count }) })
           : t("setupFlow.download.chipNoEta", { percent: state.percent })
         : t(
             {
               installing: "setupFlow.download.chipInstalling",
               cancelling: "setupFlow.download.chipCancelling",
               cancelled: "setupFlow.download.chipCancelled",
               ready: "setupFlow.download.chipReady",
               error: "setupFlow.download.chipFailed",
             }[state.status]
           );
     const progress = state.status === "downloading" ? state.percent / 100 : 1;
     const action =
       state.status === "error" ? "setupFlow.download.retry" : state.status === "cancelled" ? "setupFlow.download.downloadAgain" : null;
     return (
       <span className="onb-chip" data-status={state.status}>
         {state.status === "ready" ? (
           <Check aria-hidden="true" className="onb-chip__icon" />
         ) : state.status === "error" ? (
           <CircleAlert aria-hidden="true" className="onb-chip__icon" />
         ) : (
           <svg aria-hidden="true" className="onb-chip__ring" viewBox="0 0 16 16">
             <circle cx="8" cy="8" r="6" />
             <circle cx="8" cy="8" r="6" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
           </svg>
         )}
         <span className="onb-chip__label">{label}</span>
         {state.status === "error" ? <span className="sr-only">{state.message}</span> : null}
         {action ? (
           <button type="button" className="onb-chip__action" onClick={onStart}>
             {t(action)}
           </button>
         ) : null}
       </span>
     );
   }
   ```

4. Create `src/components/onboarding/VoiceStep.tsx`:

   ```tsx
   import { useId, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { Check } from "../icons";
   import type { SystemProfile } from "../../types/electron";
   import { modelDownloadBytes, outcomeFor, type VoicePick } from "../../utils/onboardingDetection";
   import { byteParts, type VoiceDownloadState } from "../../utils/onboardingDownload";
   import { ONBOARDING_SPEECH_MODELS, supportsSpeechLanguage } from "../../utils/onboardingSpeechModels";
   import LanguageSelector from "../ui/LanguageSelector";
   import { LocalityRing } from "../ui/LocalityRing";
   import { Button } from "../ui/button";
   import { RadioCardGroup } from "./RadioCardGroup";
   import { VoiceDownloadPanel } from "./VoiceDownloadPanel";

   export interface VoiceStepProps {
     platform: "darwin" | "linux" | "win32";
     profile: SystemProfile | null;
     pick: VoicePick | null;
     selectedModel: string | null;
     onSelectModel(modelId: string): void;
     language: string;
     onLanguageChange(language: string): void;
     languageLocked: boolean;
     compatible: boolean;
     blockedId: string;
     download: VoiceDownloadState;
     onStartDownload(): void;
     onCancelDownload(): void;
   }

   const ORGANIZATION: Record<string, string> = { oruk: "Oruk", nvidia: "NVIDIA" };

   export function VoiceStep(props: VoiceStepProps) {
     const { platform, profile, pick, selectedModel, onSelectModel, language, onLanguageChange, languageLocked, compatible, blockedId, download } = props;
     const { t, i18n } = useTranslation();
     const locale = i18n?.language;
     const pickerId = useId();
     const [pickerOpen, setPickerOpen] = useState(false);
     const device = platform === "darwin" ? "Mac" : "Other";
     const languageName = (code: string) => {
       try {
         return new Intl.DisplayNames([locale ?? "en"], { type: "language" }).of(code) ?? code;
       } catch {
         return code;
       }
     };
     const size = (bytes: number | null) => {
       const parts = byteParts(bytes ?? 0, locale);
       return t(`setupFlow.units.${parts.unit}`, { value: parts.value });
     };

     if (!profile || !pick) return <p role="status" className="onb-muted">{t(`setupFlow.voice.checking${device}`)}</p>;

     const busy = download.status === "downloading" || download.status === "installing" || download.status === "cancelling";
     const unsupported = pick.modelId === null;
     const model = ONBOARDING_SPEECH_MODELS.find((entry) => entry.id === selectedModel) ?? null;
     const outcome = selectedModel ? outcomeFor(selectedModel) : null;
     const voiceName = outcome ? t(`setupFlow.voice.outcomes.${outcome}.name`) : "";
     const why = (() => {
       switch (pick.reason.kind) {
         case "english":
           return t(`setupFlow.voice.why.english${device}`);
         case "language":
           return t(`setupFlow.voice.why.language${device}`, { voice: voiceName, language: languageName(pick.reason.language) });
         case "multilingual":
           return t(`setupFlow.voice.why.multilingual${device}`, {
             voice: voiceName,
             languages: new Intl.ListFormat(locale ?? "en", { type: "conjunction" }).format(pick.reason.languages.map(languageName)),
           });
         default:
           return t("setupFlow.voice.why.unsupported", { language: languageName(pick.reason.language) });
       }
     })();
     const gpu =
       profile.gpu.kind === "apple-silicon"
         ? t("setupFlow.voice.gpu.appleSilicon")
         : profile.gpu.kind === "nvidia"
           ? (profile.gpu.name ?? t("setupFlow.voice.gpu.nvidia"))
           : t("setupFlow.voice.gpu.unknown");
     const unknown = t("setupFlow.voice.unknown");
     const signals: Array<[string, string]> = [
       ["systemLanguage", profile.locales[0] ? languageName(profile.locales[0]) : unknown],
       ["memory", profile.totalMemoryBytes === null ? unknown : t("setupFlow.units.gb", { value: Math.round(profile.totalMemoryBytes / 1024 ** 3) })],
       ["freeSpace", profile.freeDiskBytes === null ? unknown : size(profile.freeDiskBytes)],
       ["graphics", gpu],
     ];
     const showPicker = pickerOpen || !compatible;
     const languageCode = language.split("-")[0];

     return (
       <>
         <section className="onb-card" aria-labelledby="onb-voice-title">
           <h2 id="onb-voice-title" className="onb-card__title">
             {t(unsupported ? "setupFlow.voice.unsupportedTitle" : "setupFlow.voice.title")}
           </h2>
           <p className="onb-muted">{why}</p>
           <h3 className="onb-eyebrow">{t("setupFlow.voice.noticed")}</h3>
           <ul className="onb-signals">
             {signals.map(([key, value]) => (
               <li key={key} className="onb-signal">
                 <Check aria-hidden="true" className="onb-signal__tick" />
                 <span>{t(`setupFlow.voice.signals.${key}`)}</span>
                 <strong>{value}</strong>
               </li>
             ))}
           </ul>
           {pick.disk ? (
             <p role="note" className="onb-warning">
               {t("setupFlow.voice.diskShort", { needed: size(pick.disk.neededBytes), free: size(pick.disk.freeBytes) })}
             </p>
           ) : null}
         </section>

         {model && outcome ? (
           <section className="onb-reco" aria-labelledby="onb-voice-reco">
             <p className="onb-eyebrow">{t("setupFlow.voice.recommended")}</p>
             <h3 id="onb-voice-reco" className="onb-reco__name">
               {voiceName}
             </h3>
             <p className="onb-muted">{t(`setupFlow.voice.outcomes.${outcome}.description`)}</p>
             <p className="onb-reco__meta">
               <LocalityRing locality="device" label={t("locality.device")} size={16} />
               <span>{t("locality.device")}</span>
               <span aria-hidden="true">·</span>
               <span>{`${model.name} · ${ORGANIZATION[model.organization] ?? model.organization} · ${size(modelDownloadBytes(model.id))}`}</span>
             </p>
             {download.status === "ready" ? <p className="onb-ok">{t("setupFlow.voice.installed")}</p> : null}
             <VoiceDownloadPanel state={download} modelName={voiceName} onStart={props.onStartDownload} onCancel={props.onCancelDownload} />
           </section>
         ) : null}

         {!compatible ? (
           <p id={blockedId} role="note" className="onb-warning">
             {selectedModel
               ? t("setupFlow.voice.blocked.mismatch", { language: languageName(languageCode) })
               : t("setupFlow.voice.blocked.none", { language: languageName(languageCode) })}
           </p>
         ) : null}

         {compatible ? (
           <Button variant="link" className="justify-self-start" aria-expanded={showPicker} aria-controls={pickerId} onClick={() => setPickerOpen((open) => !open)}>
             {t("setupFlow.voice.notRight")}
           </Button>
         ) : null}

         {showPicker ? (
           <section id={pickerId} className="onb-card" aria-label={t("setupFlow.voice.pickerLabel")}>
             <fieldset className="onb-fieldset" disabled={languageLocked}>
               <LanguageSelector value={language} onChange={onLanguageChange} />
             </fieldset>
             {languageLocked ? <p className="onb-muted">{t("setupFlow.voice.languageLocked")}</p> : null}
             <RadioCardGroup
               label={t("setupFlow.voice.pickerLabel")}
               idPrefix="onb-voice"
               value={selectedModel}
               onChange={onSelectModel}
               options={ONBOARDING_SPEECH_MODELS.map((entry) => {
                 const entryOutcome = outcomeFor(entry.id);
                 const reason = busy
                   ? t("setupFlow.voice.lockedWhileDownloading")
                   : supportsSpeechLanguage(entry.id, language)
                     ? undefined
                     : t("setupFlow.voice.cantHear", { language: languageName(languageCode) });
                 return {
                   value: entry.id,
                   label: entryOutcome ? t(`setupFlow.voice.outcomes.${entryOutcome}.name`) : entry.name,
                   description: entryOutcome ? t(`setupFlow.voice.outcomes.${entryOutcome}.description`) : undefined,
                   meta: `${entry.name} · ${size(modelDownloadBytes(entry.id))}`,
                   disabledReason: reason,
                 };
               })}
             />
           </section>
         ) : null}
       </>
     );
   }
   ```

   The "Not right?" toggle is rendered only while the selection is compatible. When it is not, the picker is already open, and the toggle would be a dead control.

5. Apply the **[T13]** blocks of the composition to `src/components/OnboardingFlow.tsx`. These are:
   - the imports;
   - the Voice state, `commitVoice`, `voicePrimary`, `localVoiceActive`, `downloadRail` and `voiceSize`;
   - the `speech` case;
   - `footerStart={… <DownloadChip …/>}` in the render.

   Delete what is listed under Files. `onboardingDownloadProgress`'s chip test now reads the new `DownloadChip`.

6. Delete the two speech tests from `test/components/personalWorkspace.test.js`.

7. Append to `src/styles/onboarding.css`:

   ```css
   .onb-eyebrow {
     margin: 0;
     font-size: 12px;
     font-weight: 600;
     letter-spacing: 0.06em;
     text-transform: uppercase;
     color: var(--color-muted-foreground);
   }

   .onb-signals {
     display: grid;
     gap: 6px;
     margin: 0;
     padding: 0;
     list-style: none;
   }

   .onb-signal {
     display: grid;
     grid-template-columns: 16px minmax(0, 1fr) auto;
     align-items: center;
     gap: 8px;
     font-size: 13px;
     animation: onb-step-in var(--motion-base) var(--motion-ease-enter) both;
   }

   /* 60ms stagger in tokens: n × (2/3 × --motion-instant). */
   .onb-signal:nth-child(2) { animation-delay: calc(var(--motion-instant) * 2 / 3); }
   .onb-signal:nth-child(3) { animation-delay: calc(var(--motion-instant) * 4 / 3); }
   .onb-signal:nth-child(4) { animation-delay: calc(var(--motion-instant) * 2); }

   .onb-signal__tick {
     width: 14px;
     height: 14px;
     color: var(--color-success);
   }

   .onb-warning {
     display: grid;
     gap: 8px;
     margin: 0;
     padding: 10px 12px;
     border-radius: 8px;
     background: color-mix(in oklab, var(--color-warning) 10%, var(--color-card));
     font-size: 13px;
   }

   .onb-warning p {
     margin: 0;
   }

   .onb-ok {
     margin: 0;
     font-size: 13px;
     font-weight: 600;
   }

   .onb-reco {
     display: grid;
     gap: 6px;
     padding: 15px 16px;
     border: 2px solid var(--color-live);
     border-radius: 12px;
     background: color-mix(in oklab, var(--color-live) 4%, var(--color-card));
   }

   .onb-reco__name {
     margin: 0;
     font-size: 18px;
     font-weight: 650;
   }

   .onb-reco__meta {
     display: flex;
     flex-wrap: wrap;
     align-items: center;
     gap: 6px;
     margin: 0;
     font-size: 12px;
     color: var(--color-muted-foreground);
   }

   .onb-fieldset {
     margin: 0;
     padding: 0;
     border: 0;
   }

   .onb-download {
     display: grid;
     gap: 6px;
   }

   .onb-download__row {
     display: flex;
     flex-wrap: wrap;
     align-items: center;
     justify-content: space-between;
     gap: 8px;
     font-size: 13px;
     font-variant-numeric: tabular-nums;
   }

   .onb-chip {
     display: inline-flex;
     align-items: center;
     gap: 8px;
     max-width: 100%;
     min-height: 30px;
     padding: 0 12px;
     border-radius: 9999px;
     background: var(--color-muted);
     font-size: 12px;
     font-weight: 600;
     font-variant-numeric: tabular-nums;
   }

   .onb-chip__label {
     min-width: 0;
     overflow: hidden;
     text-overflow: ellipsis;
     white-space: nowrap;
   }

   .onb-chip[data-status="ready"] {
     background: color-mix(in oklab, var(--color-success) 14%, var(--color-card));
   }

   .onb-chip[data-status="error"] {
     background: color-mix(in oklab, var(--color-destructive) 12%, var(--color-card));
   }

   .onb-chip__icon {
     flex: none;
     width: 16px;
     height: 16px;
   }

   .onb-chip[data-status="ready"] .onb-chip__icon {
     color: var(--color-success);
   }

   .onb-chip__ring {
     flex: none;
     width: 16px;
     height: 16px;
     transform: rotate(-90deg);
     fill: none;
     stroke-width: 2.5;
   }

   .onb-chip__ring circle:first-child {
     stroke: var(--color-border-hover);
   }

   .onb-chip__ring circle:last-child {
     stroke: var(--color-live);
     transition: stroke-dashoffset var(--motion-slow) var(--motion-ease-std);
   }

   .onb-chip__action {
     flex: none;
     border: 0;
     background: none;
     color: var(--color-link);
     font: inherit;
     cursor: pointer;
   }
   ```

   The `.onb-signal:nth-child` lines are single-line rules, so the per-line tokens check in Task 11's test still holds: none of them is a `transition` or `animation` declaration line.

8. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "voice": {
         "checkingMac": "Looking at this Mac…",
         "checkingOther": "Looking at this computer…",
         "title": "We picked a voice for you.",
         "unsupportedTitle": "Choose the voice that fits you best.",
         "why": {
           "englishMac": "We picked English because your Mac is set to English.",
           "englishOther": "We picked English because your computer is set to English.",
           "languageMac": "We picked {{voice}} because your Mac is set to {{language}}.",
           "languageOther": "We picked {{voice}} because your computer is set to {{language}}.",
           "multilingualMac": "We picked {{voice}} because your Mac uses {{languages}}.",
           "multilingualOther": "We picked {{voice}} because your computer uses {{languages}}.",
           "unsupported": "Loqui's on-device voices don't hear {{language}} yet. Choose the closest one, or add a cloud voice later in Settings."
         },
         "noticed": "What we noticed",
         "signals": { "systemLanguage": "System language", "memory": "Memory", "freeSpace": "Free space", "graphics": "Graphics" },
         "gpu": { "appleSilicon": "Apple silicon", "nvidia": "NVIDIA graphics", "unknown": "Not detected" },
         "unknown": "Unknown",
         "diskShort": "This voice needs about {{needed}} free while it installs. {{free}} is free.",
         "recommended": "Recommended for you",
         "installed": "Installed on this device",
         "notRight": "Not right? Choose yourself",
         "pickerLabel": "Voices",
         "lockedWhileDownloading": "Cancel the download to choose another voice.",
         "languageLocked": "Cancel the download to change the language.",
         "cantHear": "Doesn't hear {{language}}",
         "blocked": {
           "mismatch": "This voice doesn't hear {{language}}. Choose one below.",
           "none": "No on-device voice hears {{language}} yet. Choose a language it supports, or add a cloud voice later in Settings."
         },
         "download": "Download ({{size}})",
         "outcomes": {
           "fastEnglish": { "name": "Fast and English", "description": "Quick and accurate for English. Words appear about a second after you stop." },
           "manyLanguages": { "name": "Many languages", "description": "Hears and auto-detects 25 languages, so you can switch mid-day." },
           "liveCaptions": { "name": "Live captions", "description": "Words appear as you speak. Best for meetings and long dictation." },
           "liveMultilingual": { "name": "Live, more languages", "description": "Words appear as you speak, in 15 languages including Japanese, Arabic and Hindi." }
         }
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/onboardingVoice.test.js test/components/onboardingDownloadProgress.test.js test/components/onboardingFlow.test.js test/components/personalWorkspace.test.js test/utils/onboardingDetection.test.js && npm run typecheck && npm run i18n:check`

Expected: PASS.

Then check in the browser preview. Open `?preview=onboarding&step=speech` with each of these scenarios:
- `fresh`, `multilingual` and `low-disk`;
- `downloading`, which shows the progressbar with speed;
- `download-interrupted`, which shows "Download stopped at 35%. Your progress is kept." followed by Retry, which resumes.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/useSystemProfile.ts src/components/onboarding/VoiceStep.tsx src/components/onboarding/VoiceDownloadPanel.tsx src/components/onboarding/DownloadChip.tsx src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/components/onboardingVoice.test.js test/components/onboardingDownloadProgress.test.js test/components/onboardingFlow.test.js test/components/personalWorkspace.test.js
git commit -m "feat(onboarding): Voice detects, reconciles and commits a local voice with real progress"
```

---

### Task 14: While that downloads, meet Loqui

Covers:
- ONB-R4 B;
- the §5.3 off-step notices, sent through Task 7's single notifier adapter;
- one polite live region for milestones;
- ONB-21: tour dots use `--color-nav-marker`;
- M05: `usePrefersReducedMotion` is hoisted, so every step calls the same hooks.

The footer chip and its CSS already landed in Task 13.

**Files:**
- Create:
  - `src/components/onboarding/LiveKeycap.tsx`
  - `src/components/onboarding/MeetLoquiTour.tsx`
  - `src/components/onboarding/TryStage.tsx`
- Modify `src/components/OnboardingFlow.tsx`. Apply the **[T14]** blocks of the composition:
  - the imports;
  - the hoisted `reducedMotion`;
  - the notices effect and `announcement`;
  - the `try` case's `TryStage` and `MeetLoquiTour`, with the composition's **Task 14 interim** for the `try` case: legacy children, the download/idle rail, and the two Task-14-only bindings `hotkeyLabel` (`formatHotkeyLabel`, `src/utils/hotkeys.ts:122`, added to the existing `../utils/hotkeys` import) and `activationMode`. Task 15 deletes those two bindings when its block brings its own;
  - `announcement={announcement}` on the shell.
- Modify `src/styles/onboarding.css` (append).
- Test:
  - `test/components/onboardingTour.test.js`
  - append to `test/components/onboardingFlow.test.js`

**Interfaces:**
- Consumes:
  - from Task 7: `VoiceDownloadState`, `useVoiceDownload().milestone`, `voiceReadyNotice`, `voiceFailedNotice`, `shouldAnnounceOffStep` and `useOnboardingNotifier`;
  - from Task 13: `VoiceDownloadPanel`.
- Produces:

  ```tsx
  export interface LiveKeycapProps { label: string; sublabel: string; pressed: boolean; size?: 56 | 84 | 96; demo?: boolean; flashKey?: number }
  export function LiveKeycap(props: LiveKeycapProps): JSX.Element;         // aria-hidden; the field carries meaning
  export const TOUR_ADVANCE_MS = 4000;
  export function shouldAutoAdvance(input: { reducedMotion: boolean; paused: boolean; skipped: boolean }): boolean;
  export function MeetLoquiTour(props: { hotkeyLabel: string; activationMode: "tap" | "push"; platform: "darwin" | "linux" | "win32"; reducedMotion: boolean }): JSX.Element;
  export interface TryStageProps {
    download: VoiceDownloadState;
    onStart(): void;          // restarts a cancelled or failed download of the committed voice
    onCancel(): void;
    onChooseVoice(): void;    // no voice committed yet (Voice was skipped)
    tour: ReactNode;
    children: ReactNode;
  }
  export function TryStage(props: TryStageProps): JSX.Element;
  export function usePrefersReducedMotion(): boolean; // in TryStage.tsx; matchMedia("(prefers-reduced-motion: reduce)")
  ```

**Composition amendment.** The `[T14]` `try` case passes `onChooseVoice={() => goTo("speech")}` to `TryStage`. The composition section already lists this prop.

- [ ] **Step 1: Write the failing tests**

Create `test/components/onboardingTour.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const downloading = (patch = {}) => ({
  status: "downloading",
  percent: 42,
  downloadedBytes: 264e6,
  totalBytes: 631e6,
  bytesPerSecond: 8e6,
  etaSeconds: 46,
  ...patch,
});

test("auto-advance is off under reduced motion, while paused, or after Skip tour", async () => {
  const { shouldAutoAdvance } = await import("../../src/components/onboarding/MeetLoquiTour.tsx");
  assert.equal(shouldAutoAdvance({ reducedMotion: false, paused: false, skipped: false }), true);
  for (const off of [{ reducedMotion: true }, { paused: true }, { skipped: true }]) {
    assert.equal(shouldAutoAdvance({ reducedMotion: false, paused: false, skipped: false, ...off }), false, JSON.stringify(off));
  }
});

async function tour(t, reducedMotion) {
  return mountComponent(t, "/components/onboarding/MeetLoquiTour.tsx", {
    exportName: "MeetLoquiTour",
    props: { hotkeyLabel: "fn", activationMode: "tap", platform: "darwin", reducedMotion },
  });
}

const visibleSlides = (ui) =>
  ui.byAttr("aria-roledescription", "slide").filter((slide) => slide.attributes["aria-hidden"] !== "true");

test("the tour is a labelled carousel with one visible slide, arrows and dots", async (t) => {
  const ui = await tour(t, false);
  const [carousel] = ui.byAttr("aria-roledescription", "carousel");
  assert.equal(carousel.attributes["aria-label"], "setupFlow.tour.label");
  assert.equal(visibleSlides(ui).length, 1);
  assert.ok(visibleSlides(ui)[0].textContent.includes("setupFlow.tour.shortcut.title"));
  await ui.click(ui.byAttr("aria-label", "setupFlow.tour.next")[0]);
  assert.ok(visibleSlides(ui)[0].textContent.includes("setupFlow.tour.privacy.title"));
  assert.equal(ui.byAttr("aria-current", "true").length, 1);
});

test("reduced motion never auto-advances", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ui = await tour(t, true);
  t.mock.timers.tick(20000);
  assert.ok(visibleSlides(ui)[0].textContent.includes("setupFlow.tour.shortcut.title"));
});

test("Skip tour leaves a quiet line instead of the carousel", async (t) => {
  const ui = await tour(t, false);
  await ui.click("setupFlow.tour.skip");
  assert.equal(ui.byAttr("aria-roledescription", "carousel").length, 0);
  expectKey(ui, "setupFlow.tour.skipped");
});

async function stage(t, download, events = []) {
  return mountComponent(t, "/components/onboarding/TryStage.tsx", {
    exportName: "TryStage",
    props: {
      download,
      onStart: () => events.push("start"),
      onCancel: () => events.push("cancel"),
      onChooseVoice: () => events.push("choose"),
      tour: "TOUR",
      children: "TRIAL",
    },
  });
}

test("while downloading, the stage shows the real progress row and the tour, not the trial", async (t) => {
  const events = [];
  const ui = await stage(t, downloading(), events);
  assert.ok(ui.text().includes("TOUR"));
  assert.equal(ui.text().includes("TRIAL"), false);
  assert.equal(ui.byAttr("role", "progressbar")[0].attributes["aria-valuenow"], "42");
  await ui.click("setupFlow.download.cancel");
  assert.deepEqual(events, ["cancel"]);
});

test("the stage swaps the tour for the trial at 100% and pops it in only then", async (t) => {
  const ui = await stage(t, downloading());
  await ui.rerender({ download: { status: "ready" } });
  assert.ok(ui.text().includes("TRIAL"));
  expectKey(ui, "setupFlow.tour.readyTitle");
  assert.equal(ui.byAttr("data-arrived", "true").length, 1);
});

test("a stopped or cancelled download keeps the tour and offers the restart in place", async (t) => {
  const events = [];
  const ui = await stage(t, { status: "error", message: "Network timeout", percent: 42, progressKept: true }, events);
  assert.ok(ui.text().includes("TOUR"));
  expectKey(ui, "setupFlow.download.stoppedKept", { percent: 42 });
  await ui.click("setupFlow.download.retry");
  await ui.rerender({ download: { status: "cancelled" } });
  await ui.click("setupFlow.download.downloadAgain");
  assert.deepEqual(events, ["start", "start"]);
});

test("with no voice committed, the stage sends the user to Voice instead of downloading", async (t) => {
  const events = [];
  const ui = await stage(t, { status: "idle" }, events);
  expectKey(ui, "setupFlow.tour.noVoice");
  await ui.click("setupFlow.tour.chooseVoice");
  assert.deepEqual(events, ["choose"]);
});

test("a voice that is already installed shows the trial with no pop-in", async (t) => {
  const ui = await stage(t, { status: "ready" });
  assert.ok(ui.text().includes("TRIAL"));
  assert.equal(ui.byAttr("data-arrived").length, 0);
});
```

Append to `test/components/onboardingFlow.test.js`:

```js
// Records notices whichever notifier variant (Task 7 A or B) is installed.
const NOTIFIER_MOCK = `
export function useOnboardingNotifier() {
  return (notice) => (globalThis.__onbNotices ??= []).push(notice);
}`;

test("a download that finishes or fails off-step sends one §5.3 notice; on Voice and Say something it does not", async (t) => {
  globalThis.__onbNotices = [];
  t.after(() => delete globalThis.__onbNotices);
  const progress = listenerBus();
  const pending = [];
  const { ui } = await mountFlow(t, { initialStep: "speech" }, {
    api: voiceApi(["en-US"], {
      onParakeetDownloadProgress: progress.subscribe,
      downloadParakeetModel: () => new Promise((resolve) => pending.push(resolve)),
    }),
    mocks: { "/SettingsPage": "export default function SettingsPage() { return null; }", "onboarding/useOnboardingNotifier": NOTIFIER_MOCK },
  });
  await React.act(async () => {});
  await ui.click(primary(ui)); // commit + download → Say something
  const emit = (data) => React.act(async () => progress.emit({}, { model: "parakeet-unified-en-0.6b", ...data }));
  await emit({ type: "progress", percentage: 30, downloaded_bytes: 19e7, total_bytes: 6.31e8 });
  assert.equal(globalThis.__onbNotices.length, 0, "Say something shows the download inline");
  await ui.click("setupFlow.skipStep"); // → Cleanup
  await emit({ type: "error", error: "Network timeout", code: "NETWORK" });
  await React.act(async () => pending.shift()({ success: false, downloaded: false, error: "Network timeout" }));
  assert.equal(globalThis.__onbNotices.length, 1);
  const [failed] = globalThis.__onbNotices;
  assert.deepEqual([failed.kind, failed.title, failed.persistent], ["alert", "setupFlow.download.failedTitle", true]);
  assert.equal(failed.actions[0].label, "setupFlow.download.retry");
});

test("milestones reach one polite live region, once each", async (t) => {
  const progress = listenerBus();
  const { ui } = await mountFlow(t, { initialStep: "speech" }, {
    api: voiceApi(["en-US"], { onParakeetDownloadProgress: progress.subscribe }),
  });
  await React.act(async () => {});
  await ui.click(primary(ui));
  const live = () => ui.byAttr("aria-live", "polite").filter((node) => node.attributes["data-onb-announcer"] !== undefined);
  for (const percentage of [10, 26, 27]) {
    await React.act(async () => progress.emit({}, { type: "progress", model: "parakeet-unified-en-0.6b", percentage, downloaded_bytes: 1, total_bytes: 100 }));
  }
  assert.equal(live().length, 1);
  assert.ok(live()[0].textContent.includes("setupFlow.download.announcePercent(percent=25)"));
});
```

`data-onb-announcer` is the attribute Task 11's shell puts on its single live region.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/onboardingTour.test.js test/components/onboardingFlow.test.js`

Expected: FAIL. The modules are missing and no notice is sent.

- [ ] **Step 3: Implement**

1. Create `src/components/onboarding/LiveKeycap.tsx`:

   ```tsx
   import type { CSSProperties } from "react";

   export interface LiveKeycapProps {
     label: string;
     sublabel: string;
     pressed: boolean;
     size?: 56 | 84 | 96;
     demo?: boolean;     // tour art: presses on a loop (never under reduced motion)
     flashKey?: number;  // bump to flash one press (a tap with no key-up)
   }

   /** The keycap that presses when the real shortcut does (ONB-R5 C, R7 B). Decorative. */
   export function LiveKeycap({ label, sublabel, pressed, size = 96, demo = false, flashKey }: LiveKeycapProps) {
     return (
       <span
         key={flashKey}
         className="onb-keycap"
         data-pressed={pressed || undefined}
         data-demo={demo || undefined}
         data-flash={flashKey ? true : undefined}
         style={{ "--keycap-size": `${size}px` } as CSSProperties}
         aria-hidden="true"
       >
         <span className="onb-keycap__label">{label}</span>
         <span className="onb-keycap__sub">{sublabel}</span>
       </span>
     );
   }
   ```

2. Create `src/components/onboarding/MeetLoquiTour.tsx`:

   ```tsx
   import { useEffect, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { LiveKeycap } from "./LiveKeycap";

   export const TOUR_ADVANCE_MS = 4000;
   const SLIDES = ["shortcut", "privacy", "demo"] as const;

   export function shouldAutoAdvance({ reducedMotion, paused, skipped }: { reducedMotion: boolean; paused: boolean; skipped: boolean }): boolean {
     return !reducedMotion && !paused && !skipped;
   }

   export function MeetLoquiTour({
     hotkeyLabel,
     activationMode,
     platform,
     reducedMotion,
   }: {
     hotkeyLabel: string;
     activationMode: "tap" | "push";
     platform: "darwin" | "linux" | "win32";
     reducedMotion: boolean;
   }) {
     const { t } = useTranslation();
     const [index, setIndex] = useState(0);
     const [paused, setPaused] = useState(false);
     const [skipped, setSkipped] = useState(false);
     const advancing = shouldAutoAdvance({ reducedMotion, paused, skipped });

     useEffect(() => {
       if (!advancing) return;
       const id = setInterval(() => setIndex((current) => (current + 1) % SLIDES.length), TOUR_ADVANCE_MS);
       return () => clearInterval(id);
     }, [advancing]);

     if (skipped) return <p className="onb-muted">{t("setupFlow.tour.skipped")}</p>;

     const device = platform === "darwin" ? "Mac" : "Other";
     const bodies = {
       shortcut: t(`setupFlow.tour.shortcut.${activationMode}`, { key: hotkeyLabel }),
       privacy: t(`setupFlow.tour.privacy.body${device}`),
       demo: t("setupFlow.tour.demo.body"),
     };
     const go = (next: number) => setIndex((next + SLIDES.length) % SLIDES.length);

     return (
       <section
         className="onb-tour"
         aria-roledescription="carousel"
         aria-label={t("setupFlow.tour.label")}
         onMouseEnter={() => setPaused(true)}
         onMouseLeave={() => setPaused(false)}
         onFocus={() => setPaused(true)}
         onBlur={() => setPaused(false)}
       >
         <div className="onb-tour__head">
           <h2 className="onb-card__title">{t("setupFlow.tour.title")}</h2>
           <button type="button" className="onb-footer__skip" onClick={() => setSkipped(true)}>
             {t("setupFlow.tour.skip")}
           </button>
         </div>
         <div className="onb-tour__slides">
           {SLIDES.map((slide, slideIndex) => (
             <div
               key={slide}
               className="onb-tour__slide"
               aria-roledescription="slide"
               aria-label={t("setupFlow.tour.slideOf", { current: slideIndex + 1, total: SLIDES.length })}
               aria-hidden={slideIndex !== index}
               data-active={slideIndex === index || undefined}
             >
               <div className="onb-tour__art">
                 {slide === "shortcut" ? (
                   <LiveKeycap label={hotkeyLabel} sublabel="" pressed={false} size={56} demo={!reducedMotion} />
                 ) : slide === "privacy" ? (
                   <ol className="onb-map">
                     {(["mic", "loqui", "model", "notes"] as const).map((node) => (
                       <li key={node}>{t(`setupFlow.tour.privacy.nodes.${node}`)}</li>
                     ))}
                   </ol>
                 ) : (
                   <p className="onb-demo" data-reduced={reducedMotion || undefined}>
                     <span className="onb-demo__raw">{t("setupFlow.tour.demo.raw")}</span>
                     <span className="onb-demo__final">{t("setupFlow.tour.demo.final")}</span>
                   </p>
                 )}
               </div>
               <div>
                 <h3 className="onb-tour__title">{t(`setupFlow.tour.${slide}.title`)}</h3>
                 <p className="onb-muted">{bodies[slide]}</p>
               </div>
             </div>
           ))}
         </div>
         <div className="onb-tour__nav">
           <button type="button" className="onb-tour__arrow" aria-label={t("setupFlow.tour.previous")} onClick={() => go(index - 1)}>
             ‹
           </button>
           {SLIDES.map((slide, slideIndex) => (
             <button
               key={slide}
               type="button"
               className="onb-tour__dot"
               aria-label={t("setupFlow.tour.tip", { number: slideIndex + 1 })}
               aria-current={slideIndex === index ? "true" : undefined}
               onClick={() => go(slideIndex)}
             />
           ))}
           <button type="button" className="onb-tour__arrow" aria-label={t("setupFlow.tour.next")} onClick={() => go(index + 1)}>
             ›
           </button>
         </div>
       </section>
     );
   }
   ```

   The arrow glyphs mirror under RTL through the `.onb-tour__arrow` rule below.

3. Create `src/components/onboarding/TryStage.tsx`:

   ```tsx
   import { useEffect, useRef, useState, type ReactNode } from "react";
   import { useTranslation } from "react-i18next";
   import type { VoiceDownloadState } from "../../utils/onboardingDownload";
   import { Button } from "../ui/button";
   import { VoiceDownloadPanel } from "./VoiceDownloadPanel";

   export function usePrefersReducedMotion(): boolean {
     const [reduced, setReduced] = useState(() => globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
     useEffect(() => {
       const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
       if (!query) return;
       const onChange = () => setReduced(query.matches);
       query.addEventListener("change", onChange);
       return () => query.removeEventListener("change", onChange);
     }, []);
     return reduced;
   }

   export interface TryStageProps {
     download: VoiceDownloadState;
     onStart(): void;
     onCancel(): void;
     onChooseVoice(): void;
     tour: ReactNode;
     children: ReactNode;
   }

   /** Say something: the tour while the voice downloads, the trial the moment it lands. */
   export function TryStage({ download, onStart, onCancel, onChooseVoice, tour, children }: TryStageProps) {
     const { t } = useTranslation();
     const ready = download.status === "ready";
     const wasWaiting = useRef(!ready);
     const [arrived, setArrived] = useState(false);

     useEffect(() => {
       if (ready && wasWaiting.current) setArrived(true);
       wasWaiting.current = !ready;
     }, [ready]);

     if (!ready) {
       return (
         <div className="onb-stage">
           {download.status === "idle" ? (
             <div className="onb-download__row">
               <span>{t("setupFlow.tour.noVoice")}</span>
               <Button size="sm" onClick={onChooseVoice}>
                 {t("setupFlow.tour.chooseVoice")}
               </Button>
             </div>
           ) : download.status === "checking" ? (
             <p className="onb-muted" role="status">{t("setupFlow.download.checking")}</p>
           ) : (
             <VoiceDownloadPanel state={download} modelName={t("setupFlow.download.voiceModel")} onStart={onStart} onCancel={onCancel} />
           )}
           {tour}
         </div>
       );
     }
     return (
       <div className="onb-stage" data-arrived={arrived || undefined}>
         {arrived ? (
           <div className="onb-stage__ready">
             <p className="onb-card__title">{t("setupFlow.tour.readyTitle")}</p>
             <p className="onb-muted">{t("setupFlow.tour.readyBody")}</p>
           </div>
         ) : null}
         {children}
       </div>
     );
   }
   ```

   `idle` here means no download was ever started for the selected voice, so the user skipped Voice. Starting a download from here would fetch a voice that was never committed. The stage sends them back instead. `cancelled` and `error` follow a commit, so `onStart` restarts that same voice.

4. Apply the **[T14]** blocks of the composition to `src/components/OnboardingFlow.tsx`, using the interim children and `hotkeyLabel` listed under Files.

5. Append to `src/styles/onboarding.css`:

   ```css
   .onb-stage {
     display: grid;
     gap: 14px;
   }

   .onb-stage[data-arrived] > :not(.onb-stage__ready) {
     animation: onb-popin var(--motion-base) var(--motion-spring-snap) both;
   }

   @keyframes onb-popin {
     from {
       opacity: 0.4;
       transform: scale(0.96);
     }
   }

   .onb-tour {
     display: grid;
     gap: 12px;
   }

   .onb-tour__head,
   .onb-tour__nav {
     display: flex;
     flex-wrap: wrap;
     align-items: center;
     justify-content: space-between;
     gap: 8px;
   }

   .onb-tour__slides {
     position: relative;
     min-height: 168px;
     border: 1px solid var(--color-border);
     border-radius: 12px;
     background: var(--color-card);
   }

   .onb-tour__slide {
     position: absolute;
     inset: 0;
     display: grid;
     grid-template-columns: 96px minmax(0, 1fr);
     align-items: center;
     gap: 16px;
     padding: 16px 20px;
     opacity: 0;
     transform: translateX(14px);
     transition:
       opacity var(--motion-base) var(--motion-ease-enter),
       transform var(--motion-base) var(--motion-ease-enter);
   }

   .onb-tour__slide[data-active] {
     opacity: 1;
     transform: none;
   }

   .onb-tour__title {
     margin: 0 0 4px;
     font-size: 15px;
     font-weight: 650;
   }

   .onb-tour__arrow,
   .onb-tour__dot {
     border: 0;
     cursor: pointer;
   }

   .onb-tour__arrow {
     width: 26px;
     height: 26px;
     border-radius: 50%;
     background: var(--color-muted);
   }

   [dir="rtl"] .onb-tour__arrow {
     transform: scaleX(-1);
   }

   .onb-tour__dot {
     width: 6px;
     height: 6px;
     padding: 0;
     border-radius: 9999px;
     background: var(--color-border-hover);
     transition: width var(--motion-fast) var(--motion-ease-std);
   }

   .onb-tour__dot[aria-current="true"] {
     width: 18px;
     background: var(--color-nav-marker);
   }

   .onb-map {
     display: grid;
     gap: 4px;
     margin: 0;
     padding: 0;
     list-style: none;
     font-size: 12px;
   }

   .onb-demo {
     display: grid;
     gap: 4px;
     margin: 0;
     font-size: 12px;
   }

   .onb-demo__raw {
     color: var(--color-muted-foreground);
   }

   .onb-demo__final {
     animation: onb-fade var(--motion-slow) var(--motion-ease-std) both;
     animation-delay: calc(var(--motion-hero) * 2);
   }

   .onb-demo[data-reduced] .onb-demo__raw {
     display: none;
   }

   .onb-keycap {
     --keycap-size: 96px;
     display: inline-grid;
     place-items: center;
     align-content: center;
     gap: 2px;
     width: var(--keycap-size);
     height: var(--keycap-size);
     border: 1px solid var(--color-border-hover);
     border-radius: calc(var(--keycap-size) / 6);
     background: linear-gradient(180deg, var(--color-card), var(--color-muted));
     box-shadow:
       0 5px 0 var(--color-border-hover),
       inset 0 1px 0 color-mix(in oklab, var(--color-background) 60%, transparent);
     user-select: none;
     transition:
       transform var(--motion-instant) var(--motion-ease-std),
       box-shadow var(--motion-instant) var(--motion-ease-std),
       background-color var(--motion-instant) var(--motion-ease-std);
   }

   .onb-keycap[data-pressed] {
     transform: translateY(4px);
     background: color-mix(in oklab, var(--color-live) 18%, var(--color-card));
     box-shadow: 0 1px 0 var(--color-border-hover);
   }

   .onb-keycap[data-flash] {
     animation: onb-keypress var(--motion-base) var(--motion-ease-std) 1;
   }

   .onb-keycap[data-demo] {
     animation: onb-keypress calc(var(--motion-hero) * 4.6) var(--motion-ease-std) infinite;
   }

   @keyframes onb-keypress {
     30%,
     60% {
       transform: translateY(4px);
       background: color-mix(in oklab, var(--color-live) 18%, var(--color-card));
       box-shadow: 0 1px 0 var(--color-border-hover);
     }
   }

   .onb-keycap__label {
     font-size: calc(var(--keycap-size) / 4.8);
     font-weight: 700;
   }

   .onb-keycap__sub {
     font-size: 12px;
     font-weight: 600;
     color: var(--color-muted-foreground);
   }
   ```

   Under reduced motion, the global policy drops `transform` from transitions and kills the keyframes. As a result:
   - the keycap keeps its colour change;
   - the tour slides fade;
   - the demo shows its final text (`data-reduced`).

6. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "download": { "checking": "Checking your voice…", "voiceModel": "Voice model" },
       "tour": {
         "label": "While that downloads",
         "title": "While that downloads, meet Loqui.",
         "skip": "Skip tour",
         "skipped": "We'll start the test as soon as your voice is ready.",
         "noVoice": "Choose a voice first. It runs on this device.",
         "chooseVoice": "Choose a voice",
         "slideOf": "{{current}} of {{total}}",
         "previous": "Previous tip",
         "next": "Next tip",
         "tip": "Tip {{number}}",
         "shortcut": {
           "title": "Use your shortcut",
           "tap": "Press {{key}} to start talking, and press it again to finish.",
           "push": "Hold {{key}} and talk. Let go to finish."
         },
         "privacy": {
           "title": "Where your words go",
           "bodyMac": "Nothing leaves this Mac unless you choose a provider.",
           "bodyOther": "Nothing leaves this computer unless you choose a provider.",
           "nodes": { "mic": "Mic", "loqui": "Loqui", "model": "Speech model", "notes": "Notes" }
         },
         "demo": {
           "title": "Say it, get text",
           "body": "Cleanup can tidy filler words and punctuation. You choose it next.",
           "raw": "um remind me to send the draft before lunch",
           "final": "Remind me to send the draft before lunch."
         },
         "readyTitle": "Ready. Say something.",
         "readyBody": "Your voice model is on this device."
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/onboardingTour.test.js test/components/onboardingFlow.test.js && npm run typecheck && npm run i18n:check`

Expected: PASS.

Then check in the preview. Open `?preview=onboarding&step=speech&scenario=fresh` and press Download:
- the tour appears at once, and the progress row counts up;
- at 100% the stage swaps to "Ready. Say something." with a single pop;
- with `scenario=download-interrupted`, the row says "Download stopped at 35%. Your progress is kept." and offers Retry, and the tour stays.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/LiveKeycap.tsx src/components/onboarding/MeetLoquiTour.tsx src/components/onboarding/TryStage.tsx src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/components/onboardingTour.test.js test/components/onboardingFlow.test.js
git commit -m "feat(onboarding): meet Loqui while the voice downloads, with honest notices"
```

---

### Task 15: Hotkey-first trial and the success band

Covers:
- ONB-R5 C;
- ONB-Q3, Q5 and Q7;
- the M2 success dock (settle, then draw the bubble, then dock; the dock persists);
- the R2 B success band.

It consumes §5.2 `cancelled`. Review findings closed here:
- I08: cleanup retries go through the reducer, keyed to the take;
- I09, Plan 05's half: before Plan 04 a cancel says "Discarded." with no Undo (§5.2 fallback). Task 22 adds Undo once both plans have merged;
- M02;
- ONB-16: a synthetic `tap` during a native press is ignored.

This is Review Focus 2.

**Files:**
- Create:
  - `src/utils/onboardingShortcut.ts`
  - `src/components/onboarding/useTrialSession.ts`
  - `src/components/onboarding/useDictationHotkey.ts`
  - `src/components/onboarding/useAccessibilityGate.ts`
  - `src/components/onboarding/useTicker.ts`
  - `src/components/onboarding/cleanupRunner.ts`
  - `src/components/onboarding/HotkeyTrial.tsx`
  - `src/components/onboarding/SuccessBand.tsx`
- Modify `src/components/OnboardingFlow.tsx`. Apply the **[T15]** blocks of the composition: the imports, the trial state through `trialRail`, the `try` case's `TryStage` children, and `docked={docked}` on the shell. Also:
  - replace Task 14's interim `hotkeyLabel` with `keycapLabel(settingsHotkey, platform)`;
  - delete `BrowserTrial` (606-728), `DesktopTrial` (730-834), `SAMPLE_TRANSCRIPT` (137), `trialResult` and `onTrialFinished` (1058, 1251-1253), `simulatedTrialReady`/`trial` (1326-1333) and the legacy `try` content;
  - drop the `useAudioRecording` import (29). Setup no longer records in its own window;
  - the legacy Finish step's `readiness.microphone` becomes `trial.successes > 0 ? "ready" : mic.access === "denied" ? "failed" : "pending"` until Task 18 replaces it.
- Modify `src/styles/onboarding.css` (append).
- Test:
  - `test/utils/onboardingShortcut.test.js`
  - `test/components/onboardingTrial.test.js`
  - append to `test/components/onboardingFlow.test.js`

**Interfaces:**
- Consumes:
  - from Task 6: `reduceTrial`, `INITIAL_TRIAL_STATE`, `TrialInput` and `isSilent`;
  - the bridge methods from Task 4;
  - from Task 14: `TryStage` and `LiveKeycap`;
  - from Task 10: `RecoveryCard` and `useRecheckOnFocus`;
  - from Task 11: `dockMark` and `SETTLE_MS`;
  - `formatHotkeyLabelForPlatform` and `getDefaultHotkey` (`src/utils/hotkeys.ts:138, 202`);
  - `ReasoningService.processText(text, model, agentName, config)` (`src/services/ReasoningService.ts:71`), following the `ControlPanel.tsx:534-545` precedent.
- Produces, in `src/utils/onboardingShortcut.ts`:

  ```ts
  export const HOLD_THRESHOLD_MS = 350;
  export type PressStyle = "tap" | "hold";
  export function pressStyle(downAtMs: number, upAtMs: number): PressStyle;
  export interface KeycapState { pressed: boolean; downAtMs: number | null; lastStyle: PressStyle | null; presses: number }
  export const INITIAL_KEYCAP: KeycapState;
  export function reduceKeycap(state: KeycapState, event: { phase: "down" | "up" | "tap"; at: number }): KeycapState;
  export function suggestActivationMode(current: "tap" | "push", style: PressStyle, pushSupported: boolean): "tap" | "push" | null;
  export function keycapLabel(hotkey: string, platform: "darwin" | "linux" | "win32"): string; // GLOBE/Fn → "fn"
  ```

- Produces these hooks:
  - `useTrialSession(active: boolean)` returns `{ state, dispatch, toggle(), cancel(), readLevel(), usedHotkey }`. Task 22 adds `undo()` and `undoAvailable`.
    - It begins a `dictation` demo when `active` turns on, and ends it when `active` turns off or on unmount.
    - It ignores events from any other demo id.
  - `useDictationHotkey(active: boolean)` returns a `KeycapState`.
  - `useAccessibilityGate(platform, active)` returns `{ granted: boolean | null; request(): void }`.
    - Off macOS it is always granted.
    - On macOS, once granted, it calls `markMacAccessibilityFeaturesReady(null)` so the Globe key works during setup.
  - `useTicker(active: boolean): number` returns `Date.now()`, refreshed every 250 ms while `active`.
  - `runCleanup(text: string): Promise<string | null>` returns `null` when no cleanup model is configured.
- Produces the components `HotkeyTrial` (props below) and `SuccessBand({ onPersonalize, onFinish })`.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/onboardingShortcut.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingShortcut.ts");

test("a press under 350 ms is a tap; longer is a hold", async () => {
  const { pressStyle } = await load();
  assert.equal(pressStyle(1000, 1349), "tap");
  assert.equal(pressStyle(1000, 1350), "hold");
});

test("the keycap counts presses once, even when two sources report the same press", async () => {
  const { INITIAL_KEYCAP, reduceKeycap } = await load();
  let state = reduceKeycap(INITIAL_KEYCAP, { phase: "down", at: 0 });
  state = reduceKeycap(state, { phase: "down", at: 5 });
  assert.deepEqual(state, { pressed: true, downAtMs: 0, lastStyle: null, presses: 0 });
  assert.equal(reduceKeycap(state, { phase: "tap", at: 6 }), state, "a synthetic tap during a native press is the same press (ONB-16)");
  state = reduceKeycap(state, { phase: "up", at: 600 });
  assert.deepEqual(state, { pressed: false, downAtMs: null, lastStyle: "hold", presses: 1 });
  assert.equal(reduceKeycap(state, { phase: "up", at: 700 }), state, "a stray up changes nothing");
  assert.deepEqual(reduceKeycap(state, { phase: "tap", at: 800 }), { pressed: false, downAtMs: null, lastStyle: "tap", presses: 2 });
});

test("suggests the activation mode that matches how you pressed", async () => {
  const { suggestActivationMode } = await load();
  assert.equal(suggestActivationMode("tap", "hold", true), "push");
  assert.equal(suggestActivationMode("tap", "hold", false), null, "never suggest what the key can't do");
  assert.equal(suggestActivationMode("push", "tap", true), "tap");
  assert.equal(suggestActivationMode("tap", "tap", true), null);
});

test("the Globe key reads as fn", async () => {
  const { keycapLabel } = await load();
  assert.equal(keycapLabel("GLOBE", "darwin"), "fn");
  assert.equal(keycapLabel("Fn", "darwin"), "fn");
  assert.ok(keycapLabel("Control+Super", "linux").length > 0);
});
```

Create `test/components/onboardingTrial.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { mountComponent, electronApiProxy, expectKey } = require("../helpers/harness/mountComponent");

const trialState = (patch = {}) => ({
  phase: "idle",
  text: "",
  rawText: null,
  cleanup: null,
  level: 0,
  heardVoice: false,
  recordingSinceMs: null,
  errorKind: null,
  errorMessage: null,
  successes: 0,
  takeId: 0,
  cleanupRetry: "idle",
  ...patch,
});

async function view(t, patch = {}) {
  const calls = [];
  const ui = await mountComponent(t, "/components/onboarding/HotkeyTrial.tsx", {
    exportName: "HotkeyTrial",
    props: {
      platform: "darwin",
      trial: trialState(),
      nowMs: 0,
      hotkeyLabel: "fn",
      activationMode: "tap",
      keycap: { pressed: false, downAtMs: null, lastStyle: null, presses: 0 },
      usedHotkey: false,
      accessibilityMissing: false,
      onToggle: () => calls.push("toggle"),
      onCancel: () => calls.push("cancel"),
      onGrantAccessibility: () => calls.push("grant"),
      onRetryCleanup: () => calls.push("retryCleanup"),
      onTurnCleanupOff: () => calls.push("cleanupOff"),
      onBackToVoice: () => calls.push("voice"),
      onChangeMicrophone: () => calls.push("mic"),
      ...patch,
    },
  });
  return { ui, calls };
}

test("idle teaches the real shortcut in the user's activation mode", async (t) => {
  const { ui } = await view(t);
  expectKey(ui, "setupFlow.try.idle.tap", { key: "fn" });
  expectKey(ui, "setupFlow.try.privacyLine");
  expectKey(ui, "setupFlow.try.useButton");
  await ui.rerender({ activationMode: "push" });
  expectKey(ui, "setupFlow.try.idle.push", { key: "fn" });
});

test("recording lights the keycap and fills the field as you speak", async (t) => {
  const { ui } = await view(t, { trial: trialState({ phase: "recording", text: "Remind me", heardVoice: true }) });
  assert.equal(ui.byAttr("data-pressed", "true").length, 1);
  const [field] = ui.byAttr("aria-live", "polite");
  assert.ok(field.textContent.includes("setupFlow.try.listening"));
  assert.ok(field.textContent.includes("Remind me"));
});

test("a hotkey success says the shortcut works; a button success does not claim it", async (t) => {
  const { ui } = await view(t, { trial: trialState({ phase: "success", text: "Hello.", successes: 1 }), usedHotkey: true });
  expectKey(ui, "setupFlow.try.shortcutWorks");
  await ui.rerender({ usedHotkey: false });
  assert.equal(ui.text().includes("setupFlow.try.shortcutWorks"), false);
  expectKey(ui, "setupFlow.try.heardYou");
});

test("a failed cleanup keeps the original words; Retry shows running, then a failed retry says so (ONB-Q7, I08)", async (t) => {
  const failedTake = { phase: "success", text: "um hi", rawText: "um hi", cleanup: "failed", successes: 1, takeId: 1 };
  const { ui, calls } = await view(t, { trial: trialState(failedTake) });
  assert.ok(ui.text().includes("um hi"));
  expectKey(ui, "setupFlow.try.cleanupFailed");
  await ui.click("setupFlow.try.retryCleanup");
  await ui.click("setupFlow.try.cleanupOff");
  assert.deepEqual(calls, ["retryCleanup", "cleanupOff"]);
  await ui.rerender({ trial: trialState({ ...failedTake, cleanupRetry: "running" }) });
  const retry = ui.findAll((node) => node.tagName === "BUTTON" && node.textContent.includes("setupFlow.try.retryCleanup"))[0];
  assert.ok("disabled" in retry.attributes);
  await ui.rerender({ trial: trialState({ ...failedTake, cleanupRetry: "failed" }) });
  expectKey(ui, "setupFlow.try.retryFailed");
});

test("one toggle button, and Stop is the live primary (ONB-Q5)", async (t) => {
  const { ui, calls } = await view(t);
  await ui.click("setupFlow.try.useButton");
  let [toggle] = ui.byAttr("data-variant", "live");
  assert.ok(toggle.textContent.includes("setupFlow.try.start"));
  await ui.rerender({ trial: trialState({ phase: "recording" }) });
  [toggle] = ui.byAttr("data-variant", "live");
  assert.ok(toggle.textContent.includes("setupFlow.try.stop"));
  assert.equal(ui.findAll((node) => node.tagName === "BUTTON" && "disabled" in node.attributes).length, 0, "no disabled Listening… button");
  await ui.click(toggle);
  assert.deepEqual(calls, ["toggle"]);
});

test("a discarded take says so, with no Undo before Plan 04 (§5.2 fallback, I09)", async (t) => {
  const { ui } = await view(t, { trial: trialState({ phase: "cancelled" }), nowMs: 1000 });
  expectKey(ui, "setupFlow.try.discarded");
  assert.equal(ui.text().includes("setupFlow.try.undo"), false);
});

test("each failure has its own fix", async (t) => {
  const { ui, calls } = await view(t, { trial: trialState({ phase: "error", errorKind: "microphone" }) });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  expectKey(ui, "setupFlow.hello.deniedTitle");
  await ui.rerender({ trial: trialState({ phase: "error", errorKind: "memory" }) });
  await ui.click("setupFlow.try.chooseSmaller");
  await ui.rerender({ trial: trialState(), accessibilityMissing: true });
  expectKey(ui, "setupFlow.try.accessibilityTitle");
  await ui.click("setupFlow.try.grantAccess");
  assert.deepEqual(calls, ["voice", "grant"]);
});

test("silence for a while suggests checking the microphone", async (t) => {
  const { ui } = await view(t, { trial: trialState({ phase: "recording", recordingSinceMs: 0 }), nowMs: 3000 });
  expectKey(ui, "setupFlow.try.silent");
});

test("nothing heard leads back to the microphone picker", async (t) => {
  const { ui, calls } = await view(t, { trial: trialState({ phase: "error", errorKind: "noAudio" }) });
  await ui.click("setupFlow.try.changeMic");
  assert.deepEqual(calls, ["mic"]);
});

test("the success band offers Make it yours first, then Start using Loqui", async (t) => {
  const picks = [];
  const ui = await mountComponent(t, "/components/onboarding/SuccessBand.tsx", {
    exportName: "SuccessBand",
    props: { onPersonalize: () => picks.push("personalize"), onFinish: () => picks.push("finish") },
  });
  const buttons = ui.findAll((node) => node.tagName === "BUTTON");
  assert.deepEqual(buttons.map((node) => node.attributes["data-variant"]), ["default", "ghost"]);
  await ui.click("setupFlow.try.makeItYours");
  await ui.click("setupFlow.try.startUsing");
  assert.deepEqual(picks, ["personalize", "finish"]);
});

async function mountSession(t, api) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const listeners = new Set();
  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: electronApiProxy(
        {
          beginOnboardingDemo: async (session) => (calls.push(["begin", session.kind]), true),
          endOnboardingDemo: async (id) => (calls.push(["end", id]), true),
          toggleOnboardingDemo: async (id) => (calls.push(["toggle", id]), true),
          onOnboardingDemoEvent: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          ...api,
        },
        calls
      ),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-trial-session-test-"));
  const { useTrialSession } = await vite.ssrLoadModule("/components/onboarding/useTrialSession.ts");
  const box = {};
  function Harness({ active }) {
    box.session = useTrialSession(active);
    return null;
  }
  root = createRoot(container);
  const render = (active) => React.act(async () => root.render(React.createElement(Harness, { active })));
  await render(true);
  const emit = (event) => React.act(async () => [...listeners].forEach((listener) => listener(event)));
  return { box, calls, listeners, render, emit };
}

test("leaving the step ends the demo session, and late events are ignored", async (t) => {
  const { box, calls, listeners, render, emit } = await mountSession(t);
  await React.act(async () => box.session.toggle());
  const id = calls.find(([name]) => name === "toggle")[1];
  await emit({ demoId: "someone-else", kind: "dictation", status: "listening" });
  assert.equal(box.session.state.phase, "idle");
  await emit({ demoId: id, kind: "dictation", status: "listening" });
  assert.equal(box.session.state.phase, "recording");
  await render(false);
  assert.deepEqual(calls.filter(([name]) => name === "end"), [["end", id]]);
  assert.equal(listeners.size, 0);
  assert.equal(box.session.state.phase, "idle");
});

```

Append to `test/components/onboardingFlow.test.js`:

```js
const readyVoiceApi = (extra = {}) => voiceApi(["en-US"], {
  checkParakeetModelStatus: async () => ({ success: true, downloaded: true }),
  ...extra,
});

test("Say something with no committed voice sends the user to Voice, never a dead Start button", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "try" }, { api: voiceApi(["en-US"], { checkParakeetModelStatus: async () => ({ downloaded: false }) }) });
  await React.act(async () => {});
  expectKey(ui, "setupFlow.tour.title");
  assert.equal(ui.findAll((node) => node.tagName === "BUTTON" && "disabled" in node.attributes && node.textContent.includes("setupFlow.try.start")).length, 0);
  await ui.click("setupFlow.tour.chooseVoice");
  assert.equal(currentStep(ui), "setupFlow.steps.speech");
});

test("the first success settles, then docks the mark, and the dock stays for the rest of setup (M02)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = new Set();
  let demoId = null;
  const { ui } = await mountFlow(t, { initialStep: "try" }, {
    api: readyVoiceApi({
      beginOnboardingDemo: async (session) => ((demoId = session.id), true),
      onOnboardingDemoEvent: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    }),
  });
  await React.act(async () => {});
  const emit = (event) => React.act(async () => [...listeners].forEach((listener) => listener({ demoId, kind: "dictation", ...event })));
  const shell = () => ui.findAll((node) => (node.attributes.class ?? "").split(" ").includes("onb-shell"))[0];
  await emit({ status: "listening" });
  const meter = ui.byAttr("data-level-bar");
  assert.equal(meter.length, 5);
  await emit({ status: "processing" });
  assert.equal(ui.byAttr("data-level-bar")[0], meter[0], "the real path keeps the take's meter through processing (R3-M01)");
  await emit({ status: "success", text: "Hello there.", rawText: "hello there", cleanup: "skipped" });
  assert.equal(ui.byAttr("data-level-bar")[0], meter[0], "and through the first success render");
  const instrument = () => ui.findAll((node) => node.attributes.class === "onb-instrument")[0];
  assert.equal(instrument().attributes["data-stage"], "settle", "stage 1: the live bars settle");
  assert.equal(shell().attributes["data-docked"], undefined);
  await React.act(async () => t.mock.timers.tick(520));
  assert.equal(ui.byAttr("data-bubble").length, 1, "stage 2: the bubble draws");
  assert.equal(shell().attributes["data-docked"], undefined, "not docked while the bubble draws");
  await React.act(async () => t.mock.timers.tick(360));
  assert.equal(shell().attributes["data-docked"], "true", "stage 3: the dock");
  await ui.click("setupFlow.try.makeItYours");
  assert.equal(shell().attributes["data-docked"], "true", "the dock persists");
});
```

The second flow test runs with `reducedMotion: false` (the harness default) and no `startViewTransition`, so `dockMark` calls its update directly once `SETTLE_MS + DRAW_MS` has passed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingShortcut.test.js test/components/onboardingTrial.test.js test/components/onboardingFlow.test.js`

Expected: FAIL. The modules are missing, and the legacy trial still renders.

- [ ] **Step 3: Implement**

1. Create `src/utils/onboardingShortcut.ts`:

   ```ts
   import { formatHotkeyLabelForPlatform } from "./hotkeys";

   export const HOLD_THRESHOLD_MS = 350;
   export type PressStyle = "tap" | "hold";

   export function pressStyle(downAtMs: number, upAtMs: number): PressStyle {
     return upAtMs - downAtMs >= HOLD_THRESHOLD_MS ? "hold" : "tap";
   }

   export interface KeycapState {
     pressed: boolean;
     downAtMs: number | null;
     lastStyle: PressStyle | null;
     presses: number;
   }

   export const INITIAL_KEYCAP: KeycapState = { pressed: false, downAtMs: null, lastStyle: null, presses: 0 };

   /**
    * Two sources can report one press (Task 4): the native listener sends down/up,
    * and globalShortcut sends a tap. A repeated down, or a tap while a native press
    * is held, is the same press (ONB-16).
    */
   export function reduceKeycap(state: KeycapState, event: { phase: "down" | "up" | "tap"; at: number }): KeycapState {
     if (event.phase === "down") return state.pressed ? state : { ...state, pressed: true, downAtMs: event.at };
     if (event.phase === "up") {
       if (!state.pressed || state.downAtMs === null) return state;
       return { pressed: false, downAtMs: null, lastStyle: pressStyle(state.downAtMs, event.at), presses: state.presses + 1 };
     }
     if (state.pressed) return state;
     // globalShortcut has no key-up: the press is a tap.
     return { pressed: false, downAtMs: null, lastStyle: "tap", presses: state.presses + 1 };
   }

   export function suggestActivationMode(current: "tap" | "push", style: PressStyle, pushSupported: boolean): "tap" | "push" | null {
     if (style === "hold" && current === "tap" && pushSupported) return "push";
     if (style === "tap" && current === "push") return "tap";
     return null;
   }

   export function keycapLabel(hotkey: string, platform: "darwin" | "linux" | "win32"): string {
     if (/^(globe|fn)$/i.test(hotkey.trim())) return "fn";
     return formatHotkeyLabelForPlatform(hotkey, platform);
   }
   ```

   If `formatHotkeyLabelForPlatform`'s `Platform` type is narrower or named differently, cast at the call: `platform as Parameters<typeof formatHotkeyLabelForPlatform>[1]`.

2. Create `src/components/onboarding/useTrialSession.ts`:

   ```ts
   import { useCallback, useEffect, useReducer, useRef, useState } from "react";
   import { INITIAL_TRIAL_STATE, reduceTrial, type TrialInput } from "../../utils/onboardingTrial";

   /**
    * The trial records in the overlay window, the same path as the real shortcut,
    * which runs in trial mode until setup completes (Task 5). Setup only listens.
    */
   export function useTrialSession(active: boolean) {
     const [state, dispatch] = useReducer(reduceTrial, INITIAL_TRIAL_STATE);
     const idRef = useRef(`onboarding-${Date.now().toString(36)}`);
     const levelRef = useRef(0);
     const [usedHotkey, setUsedHotkey] = useState(false);
     levelRef.current = state.level;

     useEffect(() => {
       if (!active) return;
       const id = idRef.current;
       const api = window.electronAPI;
       void api?.beginOnboardingDemo?.({ id, kind: "dictation" });
       const offDemo = api?.onOnboardingDemoEvent?.((event) => {
         if (event.demoId !== id) return;
         dispatch({ ...event, atMs: Date.now() } as TrialInput);
       });
       const offHotkey = api?.onDictationHotkeyEvent?.((event) => {
         if (event.phase !== "up") setUsedHotkey(true);
       });
       return () => {
         offDemo?.();
         offHotkey?.();
         // Main turns ending a demo into a full cancel (Task 4); nothing from this take is kept.
         void api?.endOnboardingDemo?.(id);
         dispatch({ status: "reset", atMs: Date.now() });
       };
     }, [active]);

     const toggle = useCallback(async () => {
       setUsedHotkey(false);
       await window.electronAPI?.toggleOnboardingDemo?.(idRef.current);
     }, []);
     const cancel = useCallback(async () => {
       await window.electronAPI?.cancelOnboardingDemo?.(idRef.current);
     }, []);
     const readLevel = useCallback(() => levelRef.current, []);

     return { state, dispatch, toggle, cancel, readLevel, usedHotkey };
   }
   ```

3. Create `src/components/onboarding/useDictationHotkey.ts`:

   ```ts
   import { useEffect, useReducer } from "react";
   import { INITIAL_KEYCAP, reduceKeycap } from "../../utils/onboardingShortcut";

   /** Presses arrive only while a dictation or shortcut demo runs (Task 4). */
   export function useDictationHotkey(active: boolean) {
     const [state, dispatch] = useReducer(reduceKeycap, INITIAL_KEYCAP);
     useEffect(() => {
       if (!active) return;
       return window.electronAPI?.onDictationHotkeyEvent?.((event) => dispatch(event));
     }, [active]);
     return state;
   }
   ```

4. Create `src/components/onboarding/useAccessibilityGate.ts`:

   ```ts
   import { useCallback, useEffect, useState } from "react";
   import { useRecheckOnFocus } from "./useRecheckOnFocus";

   /**
    * macOS only hears the Globe/fn shortcut through the native listener, which
    * needs Accessibility and starts only after setup (AppRouter.jsx:54). Once the
    * permission is granted, start it now so the trial can use the real key.
    */
   export function useAccessibilityGate(platform: "darwin" | "linux" | "win32", active: boolean) {
     const [granted, setGranted] = useState<boolean | null>(platform === "darwin" ? null : true);
     const check = useCallback(async () => {
       if (platform !== "darwin") return;
       const ok = Boolean(await window.electronAPI?.checkAccessibilityPermission?.(true));
       setGranted(ok);
       if (ok) window.electronAPI?.markMacAccessibilityFeaturesReady?.(null);
     }, [platform]);
     useEffect(() => {
       if (active) void check();
     }, [active, check]);
     useRecheckOnFocus(check, active && granted === false);
     const request = useCallback(() => {
       void window.electronAPI?.openAccessibilitySettings?.();
     }, []);
     return { granted, request };
   }
   ```

   Opening the Accessibility pane is the same choice `usePermissions` makes (`src/hooks/usePermissions.ts:243-270`). It never triggers the undismissable TCC prompt.

5. Create `src/components/onboarding/useTicker.ts`:

   ```ts
   import { useEffect, useState } from "react";

   /** Wall-clock time for hints that age (silence, the undo window); ticks only while active. */
   export function useTicker(active: boolean, intervalMs = 250): number {
     const [now, setNow] = useState(() => Date.now());
     useEffect(() => {
       if (!active) return;
       setNow(Date.now());
       const id = setInterval(() => setNow(Date.now()), intervalMs);
       return () => clearInterval(id);
     }, [active, intervalMs]);
     return now;
   }
   ```

6. Create `src/components/onboarding/cleanupRunner.ts`:

   ```ts
   /**
    * Runs the configured cleanup on one sentence, the ControlPanel.tsx:534-545
    * pattern. Callers decide whether a remote run is allowed (Tasks 15 and 16).
    */
   export async function runCleanup(text: string): Promise<string | null> {
     const [{ default: ReasoningService }, { getEffectiveCleanupModel, getSettings }] = await Promise.all([
       import("../../services/ReasoningService"),
       import("../../stores/settingsStore"),
     ]);
     const model = getEffectiveCleanupModel();
     if (!model) return null;
     return ReasoningService.processText(text, model, null, {
       disableThinking: getSettings().cleanupDisableThinking,
       requireCompleteOutput: true,
     });
   }
   ```

   On Say something, the retry only re-runs the cleanup the user already has. That cleanup ran on this same take moments earlier through the overlay, so the retry sends nothing new to a new place.

7. Create `src/components/onboarding/HotkeyTrial.tsx`:

   ```tsx
   import { useState } from "react";
   import { useTranslation } from "react-i18next";
   import { Check, CircleAlert } from "../icons";
   import { Button } from "../ui/button";
   import { isSilent, type TrialState } from "../../utils/onboardingTrial";
   import type { KeycapState } from "../../utils/onboardingShortcut";
   import { LiveKeycap } from "./LiveKeycap";
   import { RecoveryCard } from "./RecoveryCard";
   import { openMicrophoneHelp } from "./useMicrophoneAccess";

   export interface HotkeyTrialProps {
     platform: "darwin" | "linux" | "win32";
     trial: TrialState;
     nowMs: number;
     hotkeyLabel: string;
     activationMode: "tap" | "push";
     keycap: KeycapState;
     usedHotkey: boolean;
     accessibilityMissing: boolean;
     onToggle(): void;
     onCancel(): void;
     onGrantAccessibility(): void;
     onRetryCleanup(): void;
     onTurnCleanupOff(): void;
     onBackToVoice(): void;
     onChangeMicrophone(): void; // back to Hello's picker (owner decision 6)
   }

   export function HotkeyTrial(props: HotkeyTrialProps) {
     const { t } = useTranslation();
     const { trial, platform, hotkeyLabel, activationMode } = props;
     const [buttonMode, setButtonMode] = useState(props.accessibilityMissing);
     const recording = trial.phase === "recording";
     const key = { key: hotkeyLabel };
     const openSound = { label: t("setupFlow.hello.openSound"), onClick: () => void window.electronAPI?.openSoundInputSettings?.() };
     const changeMic = { label: t("setupFlow.try.changeMic"), onClick: props.onChangeMicrophone };

     const failure = (() => {
       if (trial.phase !== "error") return null;
       switch (trial.errorKind) {
         case "microphone":
           return (
             <RecoveryCard
               title={t("setupFlow.hello.deniedTitle")}
               body={t(platform === "darwin" ? "setupFlow.hello.deniedBodyMac" : "setupFlow.hello.deniedBodyOther")}
               actions={[{ label: t("setupFlow.hello.openSettings"), onClick: () => void openMicrophoneHelp(platform) }]}
             />
           );
         case "noAudio":
           return (
             <RecoveryCard
               title={t("setupFlow.try.noAudioTitle")}
               body={t("setupFlow.try.noAudioBody")}
               actions={[changeMic, { ...openSound, variant: "ghost" }]}
             />
           );
         case "memory":
           return (
             <RecoveryCard
               title={t("setupFlow.try.memoryTitle")}
               body={t("setupFlow.try.memoryBody")}
               actions={[{ label: t("setupFlow.try.chooseSmaller"), onClick: props.onBackToVoice }]}
             />
           );
         default:
           return (
             <RecoveryCard
               title={t("setupFlow.try.otherTitle")}
               body={trial.errorMessage ?? t("setupFlow.try.otherBody")}
               actions={[{ label: t("setupFlow.try.again"), onClick: props.onToggle }]}
               tone="neutral"
             />
           );
       }
     })();

     return (
       <section className="onb-trial" aria-labelledby="onb-trial-title">
         <h2 id="onb-trial-title" className="sr-only">
           {t("setupFlow.steps.try")}
         </h2>
         {props.accessibilityMissing ? (
           <RecoveryCard
             title={t("setupFlow.try.accessibilityTitle")}
             body={t("setupFlow.try.accessibilityBody")}
             actions={[
               { label: t("setupFlow.try.grantAccess"), onClick: props.onGrantAccessibility },
               { label: t("setupFlow.try.useButton"), onClick: () => setButtonMode(true), variant: "ghost" },
             ]}
           />
         ) : null}
         <div className="onb-trial__card" data-phase={trial.phase}>
           <LiveKeycap
             label={hotkeyLabel}
             sublabel={t(`setupFlow.try.keycap.${activationMode}`)}
             pressed={props.keycap.pressed || recording}
             flashKey={props.keycap.presses}
           />
           <div className="onb-field" data-state={trial.phase} aria-live="polite">
             {trial.phase === "idle" ? <p className="onb-field__hint">{t(`setupFlow.try.idle.${activationMode}`, key)}</p> : null}
             {recording ? <p className="onb-field__status">{t("setupFlow.try.listening")}</p> : null}
             {trial.phase === "processing" ? <p className="onb-field__status">{t("setupFlow.try.processing")}</p> : null}
             {trial.text && trial.phase !== "cancelled" ? <p className="onb-field__text">{trial.text}</p> : null}
             {trial.phase === "success" ? (
               <p className="onb-field__ok">
                 <Check aria-hidden="true" />
                 {t(props.usedHotkey ? "setupFlow.try.shortcutWorks" : "setupFlow.try.heardYou")}
               </p>
             ) : null}
             {trial.phase === "cancelled" ? (
               // Task 22 adds the disclosure (disclosureCopy) and Undo here.
               <p className="onb-field__status">{t("setupFlow.try.discarded")}</p>
             ) : null}
           </div>
           {isSilent(trial, props.nowMs) ? (
             <p className="onb-warning">
               {t("setupFlow.try.silent")}{" "}
               <Button size="sm" variant="link" onClick={changeMic.onClick}>
                 {changeMic.label}
               </Button>
             </p>
           ) : null}
           {trial.phase === "success" && trial.cleanup === "failed" ? (
             <div className="onb-warning" role="status">
               <CircleAlert aria-hidden="true" />
               <p>{t(trial.cleanupRetry === "failed" ? "setupFlow.try.retryFailed" : "setupFlow.try.cleanupFailed")}</p>
               <div className="onb-recovery__actions">
                 <Button size="sm" onClick={props.onRetryCleanup} disabled={trial.cleanupRetry === "running"}>
                   {t("setupFlow.try.retryCleanup")}
                 </Button>
                 <Button size="sm" variant="ghost" onClick={props.onTurnCleanupOff}>
                   {t("setupFlow.try.cleanupOff")}
                 </Button>
               </div>
               <p className="onb-muted">{t("setupFlow.try.wordsSafe")}</p>
             </div>
           ) : null}
           {failure}
           {buttonMode ? (
             <Button variant="live" onClick={props.onToggle} aria-keyshortcuts="Escape">
               {t(recording ? "setupFlow.try.stop" : "setupFlow.try.start")}
             </Button>
           ) : null}
           <p className="onb-muted">
             {t("setupFlow.try.privacyLine")}{" "}
             {!buttonMode ? (
               <Button size="sm" variant="link" onClick={() => setButtonMode(true)}>
                 {t("setupFlow.try.useButton")}
               </Button>
             ) : null}
           </p>
         </div>
       </section>
     );
   }
   ```

   The reducer (Task 6) owns the retry: `cleanupRetry` is per take, a successful result replaces the text with `cleanup: "applied"`, and a stale result is dropped. The component only renders it.

8. Create `src/components/onboarding/SuccessBand.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Button } from "../ui/button";

   /** Closes Phase 1 (ONB-R2 B): the first words were yours, then a choice. */
   export function SuccessBand({ onPersonalize, onFinish }: { onPersonalize(): void; onFinish(): void }) {
     const { t } = useTranslation();
     return (
       <section className="onb-band" aria-labelledby="onb-band-title">
         <p id="onb-band-title" className="onb-band__title">
           {t("setupFlow.try.bandTitle")}
         </p>
         <div className="onb-band__actions">
           <Button onClick={onPersonalize}>{t("setupFlow.try.makeItYours")}</Button>
           <Button variant="ghost" onClick={onFinish}>
             {t("setupFlow.try.startUsing")}
           </Button>
         </div>
       </section>
     );
   }
   ```

9. Apply the **[T15]** blocks of the composition and make the deletions listed under Files. The `try` case has no `primary`, because the band owns the next step. "Skip this step" still goes to Cleanup.

10. Append to `src/styles/onboarding.css`:

    ```css
    .onb-trial,
    .onb-trial__card {
      display: grid;
      gap: 14px;
    }

    .onb-trial__card {
      justify-items: center;
      max-width: 560px;
      padding: 22px;
      border: 1px solid var(--color-border);
      border-radius: 14px;
      background: var(--color-card);
      transition: border-color var(--motion-slow) var(--motion-ease-std);
    }

    .onb-trial__card[data-phase="success"] {
      border-color: color-mix(in oklab, var(--color-success) 40%, var(--color-border));
    }

    .onb-field {
      width: 100%;
      min-height: 58px;
      padding: 12px 14px;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      background: var(--color-background);
      font-size: 15px;
    }

    .onb-field[data-state="recording"] {
      border-color: var(--color-live);
      box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-live) 18%, transparent);
    }

    .onb-field__hint,
    .onb-field__status {
      margin: 0;
      color: var(--color-muted-foreground);
    }

    .onb-field__text {
      margin: 4px 0 0;
      font-size: 17px;
      font-weight: 500;
      animation: onb-fade var(--motion-base) var(--motion-ease-std) both;
    }

    .onb-field__ok {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 6px 0 0;
      font-size: 13px;
      font-weight: 600;
    }

    .onb-field__ok svg {
      width: 16px;
      height: 16px;
      color: var(--color-success);
    }

    .onb-band {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-radius: 12px;
      background: color-mix(in oklab, var(--color-success) 10%, var(--color-card));
      animation: onb-band-in var(--motion-base) var(--motion-ease-enter) both;
    }

    @keyframes onb-band-in {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
    }

    .onb-band__title {
      margin: 0;
      font-size: 15px;
      font-weight: 650;
    }

    .onb-band__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    ```

11. Add the strings:

    ```bash
    node scripts/dev/merge-locale-keys.cjs - <<'JSON'
    {
      "setupFlow": {
        "try": {
          "idle": {
            "tap": "Press {{key}} and say something. Press it again to finish.",
            "push": "Hold {{key}} and say something. Let go to finish."
          },
          "keycap": { "tap": "press to talk", "push": "hold to talk" },
          "listening": "Listening",
          "processing": "Writing it down…",
          "shortcutWorks": "Shortcut works",
          "heardYou": "Loqui heard you",
          "discarded": "Discarded.",
          "undo": "Undo",
          "silent": "We're not hearing anything. Wrong microphone?",
          "noAudioTitle": "We didn't hear anything",
          "noAudioBody": "Check that the right microphone is selected and not muted, then try again.",
          "memoryTitle": "This voice needs more memory than is free",
          "memoryBody": "Close some apps, or choose a smaller voice.",
          "chooseSmaller": "Choose another voice",
          "changeMic": "Change microphone",
          "otherTitle": "That take didn't work",
          "otherBody": "Try again. Your setup is unchanged.",
          "again": "Try again",
          "cleanupFailed": "Cleanup didn't run. This is your original text.",
          "retryFailed": "Cleanup still didn't run. This is your original text.",
          "retryCleanup": "Retry cleanup",
          "cleanupOff": "Turn cleanup off",
          "wordsSafe": "Your words are safe either way.",
          "accessibilityTitle": "The shortcut needs Accessibility access",
          "accessibilityBody": "macOS only lets Loqui hear a global shortcut after you allow it. Dictating inside Loqui works without it.",
          "grantAccess": "Grant access",
          "useButton": "Use a button instead",
          "start": "Start recording",
          "stop": "Stop",
          "privacyLine": "Not pasted anywhere, not saved.",
          "bandTitle": "That was you. Loqui heard it on your device.",
          "makeItYours": "Make it yours",
          "startUsing": "Start using Loqui"
        }
      }
    }
    JSON
    npx prettier --write "src/locales/**/translation.json"
    ```

    `setupFlow.try.undo` is added here although Undo stays hidden until Task 22, so that Task 20 translates it with everything else. Task 22 adds no strings (R2-I06).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/utils/onboardingShortcut.test.js test/components/onboardingTrial.test.js test/components/onboardingFlow.test.js test/components/onboardingCleanupWiring.test.js && npm run typecheck && npm run i18n:check`

Expected: PASS.

Then check in the preview. Open `?preview=onboarding&step=try&scenario=ready&platform=macos` and hold **Hold shortcut**:
- the keycap presses, the rail bars follow, and the words fill in;
- "Shortcut works" appears;
- the bars settle, the bubble draws, the mark docks, and the band offers Make it yours or Start using Loqui;
- the mark stays docked on Cleanup.

Repeat with these scenarios: `cleanup-failed`, `microphone-denied`, `nothing-heard` and `accessibility-missing`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingShortcut.ts src/components/onboarding/useTrialSession.ts src/components/onboarding/useDictationHotkey.ts src/components/onboarding/useAccessibilityGate.ts src/components/onboarding/useTicker.ts src/components/onboarding/cleanupRunner.ts src/components/onboarding/HotkeyTrial.tsx src/components/onboarding/SuccessBand.tsx src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/utils/onboardingShortcut.test.js test/components/onboardingTrial.test.js test/components/onboardingFlow.test.js
git commit -m "feat(onboarding): hotkey-first trial with live keycap, keyed retries and a success band"
```

---

### Task 16: Cleanup, before and after in your own words

Covers ONB-R6 B, ONB-Q9 and §5.1 for cleanup. Review findings closed here:
- I05: the "Now" line reads the user's choice and its check, not only the active route;
- M01: a connected remote cleanup runs on the user's sentence only after an explicit one-tap consent;
- ONB-15: the test sentence has 7 words.

It keeps the superseded-check guarantees tested in `onboardingCleanupWiring.test.js`.

**Files:**
- Create:
  - `src/utils/onboardingCleanupPreview.ts`
  - `src/components/onboarding/CleanupStep.tsx`
- Modify `src/components/OnboardingFlow.tsx`. Apply the **[T16]** blocks of the composition: the imports, `reuseCleanup`, `cleanupRoute`, `cleanupProviderLabel` and the `cleanup` case. Also:
  - delete the legacy `CleanupStep` (465-604) and `StatusLine` (303-317);
  - in `chooseCleanup` (1199-1218), pass `preview: Boolean(config)` and `scenario: config?.scenario ?? "fresh"`. Production code no longer reads the preview global (ONB-Q18). Its dependency list becomes `[config]`.
- Modify `test/components/onboardingCleanupWiring.test.js`, changing the labels it clicks.
- Modify `test/components/fieldDirectionPolicy.test.js`. Change the `"src/components/OnboardingFlow.tsx": ["ltr"]` entry in `EXPECTED_NATIVE_FIELD_DIRECTIONS` to `"src/components/onboarding/CleanupStep.tsx": ["ltr"]`.
- Modify `src/styles/onboarding.css` (append).
- Test:
  - `test/utils/onboardingCleanupPreview.test.js`
  - `test/components/onboardingCleanup.test.js`
  - append to `test/components/onboardingFlow.test.js`

**Interfaces:**
- Consumes:
  - `CleanupChoice` and `CleanupStatus` (`src/utils/onboardingCleanup.ts:10-11`);
  - from §5.1: `useResolvedRoute("dictationCleanup")` and `ResolvedRoute`, which carries `providerId` and `settingsPath`;
  - from Plan 01: `Locality` and `providerDisplayLabel(providerId, t)`;
  - from Plan 03 (§5.1, published components): `RouteDestinationChip` and `RouteStateChip` (`src/components/settings/routing/RouteChips.tsx`). Every route disclosure on this step uses them (R2-M02);
  - from Task 15: `runCleanup`;
  - from Task 9: `RadioCardGroup`;
  - the default export `CodexConnection` (`src/components/CodexConnection.tsx`).
- Produces, in `onboardingCleanupPreview.ts`:

  ```ts
  export interface WordSegment { text: string; changed: boolean }
  export function diffWords(original: string, cleaned: string): WordSegment[]; // LCS over whitespace tokens of `cleaned`
  export function countWords(text: string): number;
  export interface CleanupExamples { original: string; local: string; codex: string; provider: string }
  export interface CleanupRun { text: string; locality: Locality }       // a run that really happened, and where
  export interface CleanupPreview { original: string; segments: WordSegment[]; source: "yours" | "example"; locality: Locality | null; wordsSent: number | null }
  export function cleanupPreview(input: { choice: CleanupChoice; userText: string | null; run: CleanupRun | null; examples: CleanupExamples }): CleanupPreview;
  /** I05: what cleanup will really do after setup. Task 18 reads the same answer. */
  export type CleanupSituation = "off" | "checking" | "ready" | "needsModel" | "needsConnection" | "needsKey" | "unreachable";
  export function cleanupSituation(choice: CleanupChoice, status: CleanupStatus, route: ResolvedRoute): CleanupSituation;
  ```

- Produces `CleanupStep`:

  ```ts
  export interface CleanupStepProps {
    choice: CleanupChoice; status: CleanupStatus; onChoose(choice: CleanupChoice): void;
    userText: string | null;           // the last successful take's raw words; null if the trial was skipped
    route: ResolvedRoute;              // §5.1 dictationCleanup
    providerLabel: string;             // providerDisplayLabel(route.providerId, t)
    runCleanup(text: string): Promise<string | null>;
    reuse: boolean; onReuseChange(value: boolean): void;
  }
  ```

- Rules:
  - A run on the user's own words needs all of these: the situation is `ready`, the user has a sentence, and either:
    - the route is on the device (`route.locality === "device"`), which runs automatically, or
    - the user tapped "Try it on my sentence · sends N words to {provider}" (M01).
  - Nothing is sent before that tap. Remote choices show the example with "Nothing was sent." and count the words that would leave.
  - Changing the choice drops the previous run.
  - No option is badged "Recommended" (ONB-Q9).

- [ ] **Step 1: Write the failing tests**

Create `test/utils/onboardingCleanupPreview.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingCleanupPreview.ts");
const examples = {
  original: "um let's send the draft to maya before lunch",
  local: "Let's send the draft to Maya before lunch.",
  codex: "Let's send the draft to Maya before lunch.",
  provider: "Let's send Maya the draft before lunch.",
};
const route = (state, locality = "remote") => ({ id: "dictationCleanup", locality, providerId: "openai", state, settingsPath: "llms/dictationCleanup" });

test("changed words are marked against the original", async () => {
  const { diffWords } = await load();
  assert.deepEqual(diffWords(examples.original, examples.local), [
    { text: "Let's", changed: true },
    { text: "send", changed: false },
    { text: "the", changed: false },
    { text: "draft", changed: false },
    { text: "to", changed: false },
    { text: "Maya", changed: true },
    { text: "before", changed: false },
    { text: "lunch.", changed: true },
  ]);
  assert.deepEqual(diffWords("same words", "same words"), [
    { text: "same", changed: false },
    { text: "words", changed: false },
  ]);
  assert.deepEqual(diffWords("", ""), []);
});

test("word counts ignore extra whitespace", async () => {
  const { countWords } = await load();
  assert.equal(countWords("  um   hi there "), 3);
  assert.equal(countWords("um remind me to book the room"), 7);
  assert.equal(countWords(""), 0);
});

test("None shows your words unchanged", async () => {
  const { cleanupPreview } = await load();
  const preview = cleanupPreview({ choice: "none", userText: "um hi", run: null, examples });
  assert.deepEqual([preview.original, preview.source, preview.locality, preview.wordsSent], ["um hi", "yours", null, null]);
  assert.ok(preview.segments.every((segment) => !segment.changed));
});

test("your own sentence appears only after a run really happened, with where it ran", async () => {
  const { cleanupPreview } = await load();
  const local = cleanupPreview({ choice: "local", userText: "um hi there", run: { text: "Hi there.", locality: "device" }, examples });
  assert.deepEqual([local.original, local.source, local.locality, local.wordsSent], ["um hi there", "yours", "device", null]);
  const waiting = cleanupPreview({ choice: "local", userText: "um hi there", run: null, examples });
  assert.deepEqual([waiting.original, waiting.source], [examples.original, "example"]);
  const consented = cleanupPreview({ choice: "codex", userText: "um remind me to book the room", run: { text: "Remind me to book the room.", locality: "remote" }, examples });
  assert.deepEqual([consented.source, consented.locality, consented.wordsSent], ["yours", "remote", 7]);
});

test("before consent, remote options show the example and count what would leave", async () => {
  const { cleanupPreview } = await load();
  const codex = cleanupPreview({ choice: "codex", userText: "um remind me to book the room", run: null, examples });
  assert.deepEqual([codex.source, codex.locality, codex.wordsSent], ["example", "remote", 7]);
  const noTrial = cleanupPreview({ choice: "provider", userText: null, run: null, examples });
  assert.equal(noTrial.wordsSent, 9, "without a trial, the example's own words are counted");
});

test("the situation follows the user's choice and its check, then the active route (I05)", async () => {
  const { cleanupSituation } = await load();
  const off = route({ status: "off" });
  assert.equal(cleanupSituation("none", "skipped", off), "off");
  assert.equal(cleanupSituation("provider", "checking", off), "checking");
  assert.equal(cleanupSituation("provider", "failed", off), "needsKey", "chosen but not available is not 'off'");
  assert.equal(cleanupSituation("codex", "failed", off), "needsConnection");
  assert.equal(cleanupSituation("local", "pending", route({ status: "off" }, "device")), "needsModel");
  assert.equal(cleanupSituation("provider", "ready", route({ status: "ready" })), "ready");
  assert.equal(cleanupSituation("provider", "ready", route({ status: "needsKey", provider: "openai" })), "needsKey");
  assert.equal(cleanupSituation("local", "ready", route({ status: "needsModel" }, "device")), "needsModel");
  assert.equal(cleanupSituation("codex", "ready", route({ status: "unreachable" })), "unreachable");
  assert.equal(cleanupSituation("provider", "ready", route({ status: "unknown" })), "checking", "§5.1 rule 1: unknown is never ready");
});
```

Create `test/components/onboardingCleanup.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

// Plan 03's published chips (§5.1), stubbed so the test sees exactly what the step hands them.
const ROUTE_CHIPS_MOCK = `
import React from "react";
export function RouteDestinationChip({ route }) {
  return React.createElement("span", { "data-route-chip": "destination", "data-locality": route.locality, "data-provider": route.providerId ?? "" });
}
export function RouteStateChip({ state }) {
  return React.createElement("span", { "data-route-chip": "state", "data-state": state.status });
}`;

const SENTENCE = "um remind me to book the room";
const route = (patch = {}) => ({
  id: "dictationCleanup",
  kind: "text",
  locality: "device",
  provider: null,
  providerId: null,
  host: null,
  model: null,
  state: { status: "off" },
  sends: null,
  settingsPath: "llms/dictationCleanup",
  ...patch,
});
const remoteReady = route({ locality: "remote", provider: "OpenAI", providerId: "openai", state: { status: "ready" } });

async function cleanup(t, props = {}) {
  const chosen = [];
  const runs = [];
  const ui = await mountComponent(t, "/components/onboarding/CleanupStep.tsx", {
    exportName: "CleanupStep",
    props: {
      choice: "none",
      status: "skipped",
      onChoose: (choice) => chosen.push(choice),
      userText: SENTENCE,
      route: route(),
      providerLabel: "OpenAI",
      runCleanup: async (text) => {
        runs.push(text);
        return "Remind me to book the room.";
      },
      reuse: false,
      onReuseChange() {},
      ...props,
    },
    mocks: { "/CodexConnection": "export default function CodexConnection() { return null; }", "routing/RouteChips": ROUTE_CHIPS_MOCK },
  });
  await React.act(async () => {});
  return { ui, chosen, runs };
}

test("one segmented radio group, no Recommended badge, and your words first", async (t) => {
  const { ui, chosen } = await cleanup(t);
  const [group] = ui.byAttr("role", "radiogroup");
  assert.equal(group.attributes["data-variant"], "segmented");
  assert.equal(ui.byAttr("role", "radio").length, 4);
  assert.equal(ui.text().includes("Recommended"), false);
  assert.ok(ui.text().includes(SENTENCE));
  expectKey(ui, "setupFlow.cleanup.nothingChanges");
  expectKey(ui, "setupFlow.cleanup.now.off");
  await ui.click(ui.byAttr("data-value", "codex")[0]);
  assert.deepEqual(chosen, ["codex"]);
});

test("Local runs on your own sentence on this device and marks what changed", async (t) => {
  const { ui, runs } = await cleanup(t, { choice: "local", status: "ready", route: route({ state: { status: "ready" }, model: "Qwen 3.5 2B" }) });
  assert.deepEqual(runs, [SENTENCE]);
  assert.ok(ui.text().includes("Remind me to book the room."));
  assert.ok(ui.findAll((node) => node.tagName === "MARK").length >= 1);
  assert.ok(ui.byAttr("data-locality", "device").length >= 1);
});

test("a connected remote cleanup waits for one explicit tap before sending your words (M01)", async (t) => {
  const { ui, runs } = await cleanup(t, { choice: "codex", status: "ready", route: remoteReady });
  assert.deepEqual(runs, [], "nothing leaves on its own");
  expectKey(ui, "setupFlow.cleanup.exampleNotice");
  expectKey(ui, "setupFlow.cleanup.wordsSent", { count: 7, provider: "OpenAI" });
  assert.ok(ui.byAttr("data-locality", "remote").length >= 1);
  await ui.click("setupFlow.cleanup.tryMine");
  assert.deepEqual(runs, [SENTENCE]);
  assert.ok(ui.text().includes("Remind me to book the room."));
  expectKey(ui, "setupFlow.cleanup.sentNotice", { count: 7, provider: "OpenAI" });
  await ui.rerender({ choice: "provider" });
  assert.equal(ui.text().includes("Remind me to book the room."), false, "a new choice drops the old run");
});

test("the consent tap is offered only when the remote route is ready and you have a sentence", async (t) => {
  const { ui } = await cleanup(t, { choice: "provider", status: "failed", route: route({ locality: "remote", providerId: "openai" }) });
  assert.equal(ui.text().includes("setupFlow.cleanup.tryMine"), false);
  await ui.rerender({ status: "ready", route: remoteReady, userText: null });
  assert.equal(ui.text().includes("setupFlow.cleanup.tryMine"), false);
});

test("a remote route never runs on its own, even if Local is selected", async (t) => {
  const { runs } = await cleanup(t, { choice: "local", status: "ready", route: remoteReady });
  assert.deepEqual(runs, []);
});

test("Now names the unmet prerequisite of the user's choice, with no raw state chip beside it (I05, R3-M02)", async (t) => {
  // Plan 03 resolves a chosen-but-unvalidated cleanup as `off` (cleanup stays disabled
  // until the check passes), so a raw chip here would read "Off" next to "needs key".
  const stateChips = (ui) => ui.byAttr("data-route-chip", "state");
  const offRoute = route({ locality: "remote", providerId: "openai", state: { status: "off" } });
  const { ui } = await cleanup(t, { choice: "provider", status: "failed", route: offRoute });
  expectKey(ui, "setupFlow.cleanup.now.needsKey", { provider: "OpenAI" });
  assert.equal(ui.text().includes("setupFlow.cleanup.now.off"), false);
  assert.equal(stateChips(ui).length, 0, "failed check: the sentence owns the status");
  await ui.rerender({ choice: "provider", status: "checking" });
  expectKey(ui, "setupFlow.cleanup.now.checking");
  assert.equal(stateChips(ui).length, 0, "still checking: no Off chip");
  await ui.rerender({ choice: "codex", status: "failed" });
  expectKey(ui, "setupFlow.cleanup.now.needsConnection");
  assert.equal(stateChips(ui).length, 0);
  await ui.rerender({ choice: "local", status: "pending", route: route() });
  expectKey(ui, "setupFlow.cleanup.now.needsModel");
  assert.equal(stateChips(ui).length, 0, "local model pending: no Off chip");
  await ui.rerender({ choice: "provider", status: "ready", route: { ...remoteReady, model: "GPT-5 mini" } });
  expectKey(ui, "setupFlow.cleanup.now.ready", { name: "GPT-5 mini", provider: "OpenAI" });
  assert.deepEqual(stateChips(ui).map((chip) => chip.attributes["data-state"]), ["ready"], "a validated route shows its state");
  assert.equal(ui.byAttr("data-route-chip", "destination").length, 1, "the destination chip stays in every case");
});

test("route disclosures use Plan 03's published chips, fed the real route (R2-M02)", async (t) => {
  const { ui } = await cleanup(t, { choice: "codex", status: "ready", route: remoteReady });
  const [destination] = ui.byAttr("data-route-chip", "destination");
  assert.deepEqual([destination.attributes["data-locality"], destination.attributes["data-provider"]], ["remote", "openai"]);
  assert.equal(ui.byAttr("data-route-chip", "state")[0].attributes["data-state"], "ready");
  await ui.rerender({ choice: "none", status: "skipped", route: route() });
  assert.equal(ui.byAttr("data-route-chip").length, 0, "no route to disclose when cleanup is off");
});
```

Append to `test/components/onboardingFlow.test.js`:

```js
test("choosing API key without a key reads as needing a key, on Cleanup and on Ready (I05)", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "cleanup", previewConfig: { step: "cleanup", scenario: "fresh", platform: "linux" } });
  await React.act(async () => {});
  await ui.click(ui.byAttr("data-value", "provider")[0]);
  await React.act(async () => {});
  expectKey(ui, "setupFlow.cleanup.now.needsKey", { provider: "OpenAI" });
  assert.equal(ui.text().includes("setupFlow.cleanup.now.off"), false);
});
```

The provider is named even though the route is still `off`: the composition falls back to the provider the choice will use (`choiceProviderId`). This runs the real `applyCleanupChoice`. With the preview `scenario: "fresh"`, a provider check settles `failed`. Task 18 extends this test to check Ready.

In `test/components/onboardingCleanupWiring.test.js`:
- replace every `flow.click("ChatGPT subscription")` with `flow.click("setupFlow.cleanup.options.codex")`;
- replace every `flow.click("No cleanup")` with `flow.click("setupFlow.cleanup.options.none")`.

If this file renders real English strings rather than Plan 02's key mock, click `"ChatGPT"` and `"None"` instead. These are the new English labels.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingCleanupPreview.test.js test/components/onboardingCleanup.test.js test/components/onboardingCleanupWiring.test.js test/components/onboardingFlow.test.js`

Expected: FAIL. The modules are missing, and the wiring test cannot find the new labels.

- [ ] **Step 3: Implement**

1. Create `src/utils/onboardingCleanupPreview.ts`:

   ```ts
   import type { Locality } from "../lib/locality";
   import type { ResolvedRoute } from "../lib/routes";
   import type { CleanupChoice, CleanupStatus } from "./onboardingCleanup";

   // Before and after (ONB-R6 B): the user chooses by seeing. Their own words appear
   // only after a run really happened: automatically on this device, or after an
   // explicit tap for a remote provider (M01).
   export interface WordSegment {
     text: string;
     changed: boolean;
   }

   const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean);

   export function countWords(text: string): number {
     return tokens(text).length;
   }

   export function diffWords(original: string, cleaned: string): WordSegment[] {
     const a = tokens(original);
     const b = tokens(cleaned);
     const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
     for (let i = a.length - 1; i >= 0; i--) {
       for (let j = b.length - 1; j >= 0; j--) {
         lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
       }
     }
     const out: WordSegment[] = [];
     let i = 0;
     let j = 0;
     while (j < b.length) {
       if (i < a.length && a[i] === b[j]) {
         out.push({ text: b[j], changed: false });
         i++;
         j++;
       } else if (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1]) {
         i++;
       } else {
         out.push({ text: b[j], changed: true });
         j++;
       }
     }
     return out;
   }

   export interface CleanupExamples {
     original: string;
     local: string;
     codex: string;
     provider: string;
   }

   export interface CleanupRun {
     text: string;
     locality: Locality;
   }

   export interface CleanupPreview {
     original: string;
     segments: WordSegment[];
     source: "yours" | "example";
     locality: Locality | null;
     wordsSent: number | null;
   }

   export function cleanupPreview({
     choice,
     userText,
     run,
     examples,
   }: {
     choice: CleanupChoice;
     userText: string | null;
     run: CleanupRun | null;
     examples: CleanupExamples;
   }): CleanupPreview {
     const yours = userText?.trim() || null;
     if (choice === "none") {
       const original = yours ?? examples.original;
       return { original, segments: diffWords(original, original), source: yours ? "yours" : "example", locality: null, wordsSent: null };
     }
     const remote = choice === "codex" || choice === "provider";
     if (yours && run) {
       return {
         original: yours,
         segments: diffWords(yours, run.text),
         source: "yours",
         locality: run.locality,
         wordsSent: run.locality === "device" ? null : countWords(yours),
       };
     }
     return {
       original: examples.original,
       segments: diffWords(examples.original, examples[choice]),
       source: "example",
       locality: remote ? "remote" : "device",
       wordsSent: remote ? countWords(yours ?? examples.original) : null,
     };
   }

   export type CleanupSituation = "off" | "checking" | "ready" | "needsModel" | "needsConnection" | "needsKey" | "unreachable";

   const UNMET: Record<Exclude<CleanupChoice, "none">, CleanupSituation> = {
     local: "needsModel",
     codex: "needsConnection",
     provider: "needsKey",
   };

   /**
    * I05: a chosen-but-unavailable cleanup is never "off". Until the choice's own
    * check passes, its unmet prerequisite is the answer; after it passes, the route
    * the app will really use decides.
    */
   export function cleanupSituation(choice: CleanupChoice, status: CleanupStatus, route: ResolvedRoute): CleanupSituation {
     if (choice === "none") return "off";
     if (status === "checking") return "checking";
     if (status !== "ready") return UNMET[choice];
     switch (route.state.status) {
       case "ready":
         return "ready";
       case "unknown":
         return "checking"; // §5.1 rule 1: never ready until main confirms
       case "off":
         return UNMET[choice];
       case "needsModel":
         return "needsModel";
       case "needsKey":
         return "needsKey";
       default:
         return "unreachable";
     }
   }
   ```

   A route that is `off` after a check passed would mean the store and the check disagree. It is reported as the choice's unmet prerequisite rather than as "off", for the same reason.

2. Create `src/components/onboarding/CleanupStep.tsx`:

   ```tsx
   import { useEffect, useState } from "react";
   import { useTranslation } from "react-i18next";
   import CodexConnection from "../CodexConnection";
   import { RouteDestinationChip, RouteStateChip } from "../settings/routing/RouteChips";
   import { Button } from "../ui/button";
   import type { ResolvedRoute } from "../../lib/routes";
   import type { CleanupChoice, CleanupStatus } from "../../utils/onboardingCleanup";
   import { cleanupPreview, cleanupSituation, countWords, type CleanupRun } from "../../utils/onboardingCleanupPreview";
   import { RadioCardGroup } from "./RadioCardGroup";

   export interface CleanupStepProps {
     choice: CleanupChoice;
     status: CleanupStatus;
     onChoose(choice: CleanupChoice): void;
     userText: string | null;
     route: ResolvedRoute;
     providerLabel: string;
     runCleanup(text: string): Promise<string | null>;
     reuse: boolean;
     onReuseChange(value: boolean): void;
   }

   const CHOICES = ["none", "local", "codex", "provider"] as const;

   export function CleanupStep(props: CleanupStepProps) {
     const { choice, status, onChoose, userText, route, providerLabel, runCleanup, reuse, onReuseChange } = props;
     const { t } = useTranslation();
     const [run, setRun] = useState<CleanupRun | null>(null);
     const [running, setRunning] = useState(false);
     const [consented, setConsented] = useState(false);
     const situation = cleanupSituation(choice, status, route);
     const sentence = userText?.trim() || null;
     const onDevice = route.locality === "device";
     const mayRun = choice !== "none" && situation === "ready" && sentence !== null && (onDevice || consented);

     // A new choice, route or sentence starts over: no stale run, no carried consent.
     useEffect(() => {
       setRun(null);
       setConsented(false);
     }, [choice, route.providerId, route.locality, sentence]);

     useEffect(() => {
       if (!mayRun || !sentence) return;
       let alive = true;
       setRunning(true);
       runCleanup(sentence)
         .then((text) => alive && setRun(text ? { text, locality: route.locality } : null))
         .catch(() => alive && setRun(null))
         .finally(() => alive && setRunning(false));
       return () => {
         alive = false;
       };
     }, [mayRun, route.locality, runCleanup, sentence]);

     const preview = cleanupPreview({
       choice,
       userText,
       run,
       examples: {
         original: t("setupFlow.cleanup.example.original"),
         local: t("setupFlow.cleanup.example.local"),
         codex: t("setupFlow.cleanup.example.codex"),
         provider: t("setupFlow.cleanup.example.provider"),
       },
     });
     const now =
       situation === "ready"
         ? t("setupFlow.cleanup.now.ready", { name: route.model ?? providerLabel, provider: providerLabel })
         : t(`setupFlow.cleanup.now.${situation}`, { provider: providerLabel });
     const offerConsent = situation === "ready" && !onDevice && sentence !== null && !consented && run === null;
     // R3-M02: the raw route state describes the user's choice only once its check has
     // passed. Before that, cleanup is deliberately disabled and Plan 03 resolves the
     // route as `off`, so the prerequisite sentence (`now`) owns the status instead.
     const showRouteState = choice !== "none" && status === "ready" && route.state.status !== "off";

     return (
       <>
         <section className="onb-card" aria-labelledby="onb-cleanup-title">
           <h2 id="onb-cleanup-title" className="onb-card__title">
             {t("setupFlow.cleanup.title")}
           </h2>
           <RadioCardGroup
             label={t("setupFlow.cleanup.label")}
             idPrefix="onb-cleanup"
             variant="segmented"
             value={choice}
             onChange={onChoose}
             options={CHOICES.map((value) => ({ value, label: t(`setupFlow.cleanup.options.${value}`) }))}
           />
           <div className="onb-panes" data-source={preview.source}>
             <div className="onb-pane">
               <p className="onb-eyebrow">{t("setupFlow.cleanup.original")}</p>
               <p>{preview.original}</p>
             </div>
             <div className="onb-pane onb-pane--after">
               <p className="onb-eyebrow">{t("setupFlow.cleanup.withCleanup")}</p>
               <p>
                 {preview.segments.map((segment, index) => (
                   <span key={index}>
                     {index > 0 ? " " : ""}
                     {segment.changed ? <mark>{segment.text}</mark> : segment.text}
                   </span>
                 ))}
               </p>
             </div>
           </div>
           <p className="onb-reco__meta">
             {preview.locality === null ? (
               <span>{t("setupFlow.cleanup.nothingChanges")}</span>
             ) : preview.locality === "device" ? (
               <RouteDestinationChip route={route} />
             ) : (
               <>
                 <RouteDestinationChip route={route} />
                 <span>
                   {t(preview.source === "yours" ? "setupFlow.cleanup.sentNotice" : "setupFlow.cleanup.wordsSent", {
                     count: preview.wordsSent ?? 0,
                     provider: providerLabel,
                   })}
                 </span>
               </>
             )}
             {running ? <span role="status">{t("setupFlow.cleanup.running")}</span> : null}
           </p>
           {preview.source === "example" && preview.locality !== null && preview.locality !== "device" ? (
             <p className="onb-muted">{t("setupFlow.cleanup.exampleNotice")}</p>
           ) : null}
           {preview.source === "example" && choice === "local" ? <p className="onb-muted">{t("setupFlow.cleanup.localExampleNotice")}</p> : null}
           {offerConsent ? (
             <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setConsented(true)}>
               {t("setupFlow.cleanup.tryMine", { count: countWords(sentence ?? ""), provider: providerLabel })}
             </Button>
           ) : null}
         </section>
         {choice === "codex" ? <CodexConnection onSignedInChange={() => onChoose("codex")} /> : null}
         <p className="onb-muted" role="status">
           {showRouteState ? <RouteStateChip state={route.state} /> : null} {now}
         </p>
         <label className="onb-check">
           <input type="checkbox" dir="ltr" checked={reuse} onChange={(event) => onReuseChange(event.target.checked)} />
           <span>{t("setupFlow.cleanup.reuse")}</span>
         </label>
       </>
     );
   }
   ```

   `expectKey(ui, "setupFlow.cleanup.tryMine")` in the tests matches the rendered key with its values, because the mock renders `t(k, {a:1})` as `k(a=1)` and `ui.click` matches by substring.

3. Apply the **[T16]** blocks of the composition, and make the deletions and the `chooseCleanup` change listed under Files. The reuse key and its default are the same as the old `CleanupStep:477-480`, and `applyCleanupToOtherTasks` reads the same key, so it is unchanged.

4. Change the field-direction allowlist entry as listed under Files.

5. Append to `src/styles/onboarding.css`:

   ```css
   .onb-panes {
     display: grid;
     grid-template-columns: repeat(2, minmax(0, 1fr));
     gap: 10px;
   }

   .onb-pane {
     display: grid;
     gap: 6px;
     padding: 12px 14px;
     border: 1px solid var(--color-border);
     border-radius: 10px;
     font-size: 14px;
     line-height: 1.5;
   }

   .onb-pane p {
     margin: 0;
   }

   .onb-pane--after {
     border-color: color-mix(in oklab, var(--color-live) 50%, var(--color-border));
   }

   .onb-pane mark {
     border-radius: 3px;
     background: color-mix(in oklab, var(--color-live) 15%, transparent);
     color: inherit;
     animation: onb-mark var(--motion-slow) var(--motion-ease-std) both;
   }

   @keyframes onb-mark {
     from {
       background: color-mix(in oklab, var(--color-live) 50%, transparent);
     }
   }

   .onb-check {
     display: flex;
     align-items: center;
     gap: 8px;
     font-size: 13px;
   }

   @media (max-width: 520px) {
     .onb-panes {
       grid-template-columns: minmax(0, 1fr);
     }
   }
   ```

   The highlight fades in with `--motion-slow` (360ms) rather than the showcase's 400ms (owner decision 5). Under reduced motion the keyframes are dropped and the 15% highlight stays.

6. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "cleanup": {
         "title": "See what cleanup does",
         "label": "Cleanup",
         "options": { "none": "None", "local": "Local", "codex": "ChatGPT", "provider": "API key" },
         "original": "Original",
         "withCleanup": "With cleanup",
         "nothingChanges": "Nothing changes",
         "running": "Cleaning up your sentence…",
         "wordsSent_one": "{{count}} word would be sent to {{provider}}",
         "wordsSent_other": "{{count}} words would be sent to {{provider}}",
         "sentNotice_one": "Your {{count}} word was sent to {{provider}} for this preview",
         "sentNotice_other": "Your {{count}} words were sent to {{provider}} for this preview",
         "tryMine_one": "Try it on my sentence · sends {{count}} word to {{provider}}",
         "tryMine_other": "Try it on my sentence · sends {{count}} words to {{provider}}",
         "exampleNotice": "Example text. Nothing was sent.",
         "localExampleNotice": "Example text. Your own sentence appears here once local cleanup is ready on this device.",
         "example": {
           "original": "um let's send the draft to maya before lunch and uh remind me to book the room for thursday",
           "local": "Let's send the draft to Maya before lunch and remind me to book the room for Thursday.",
           "codex": "Let's send the draft to Maya before lunch. Remind me to book the room for Thursday.",
           "provider": "Let's send Maya the draft before lunch, and remind me to book the room for Thursday."
         },
         "now": {
           "off": "Cleanup is off. Your words stay exactly as you said them.",
           "checking": "Checking that cleanup is available…",
           "ready": "Cleanup is on with {{name}}.",
           "needsKey": "Add your {{provider}} key in Settings to turn cleanup on. Until then, your words stay as you said them.",
           "needsConnection": "Connect ChatGPT above to turn cleanup on. Until then, your words stay as you said them.",
           "needsModel": "The local cleanup model isn't on this device yet. Download it in Settings, Language Models (1.3 GB).",
           "unreachable": "Loqui can't reach {{provider}} right now. Your words are kept as you said them."
         },
         "reuse": "Also use this choice for other text features"
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/utils/onboardingCleanupPreview.test.js test/components/onboardingCleanup.test.js test/components/onboardingCleanupWiring.test.js test/components/onboardingFlow.test.js test/components/fieldDirectionPolicy.test.js test/utils/onboardingCleanup.test.js && npm run typecheck && npm run i18n:check`

Expected: PASS. The three superseded-check tests in `onboardingCleanupWiring.test.js` must still pass, unchanged apart from the labels. They protect "a late check never re-enables cleanup".

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingCleanupPreview.ts src/components/onboarding/CleanupStep.tsx src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/utils/onboardingCleanupPreview.test.js test/components/onboardingCleanup.test.js test/components/onboardingCleanupWiring.test.js test/components/onboardingFlow.test.js test/components/fieldDirectionPolicy.test.js
git commit -m "feat(onboarding): choose cleanup by seeing your own words, with explicit consent to send"
```

---

### Task 17: Shortcut, with a live keycap

Covers:
- ONB-R7 B;
- the rest of ONB-Q17 for this step ("Press this anywhere to talk…");
- ONB-19: the push-to-talk suggestion waits until `useHotkeyModeInfo` has loaded.

**Files:**
- Create: `src/components/onboarding/ShortcutStep.tsx`
- Modify: `src/components/onboarding/useDictationHotkey.ts`. Add `useShortcutDemo`.
- Modify: `src/components/OnboardingFlow.tsx`. Apply the **[T17]** blocks of the composition: the imports, `useShortcutDemo`, `modeInfo`, `autoPasteEnabled`, `shortcutProven` and the `shortcuts` case. Delete the legacy `ShortcutsStep` (836-929), and the `usePermissions` import and call (16, 1068) if nothing else uses them.
- Modify: `src/styles/onboarding.css` (append)
- Test: `test/components/onboardingShortcutStep.test.js`

**Interfaces:**
- Consumes `KeycapState` and `suggestActivationMode` (Task 15), `LiveKeycap` (Task 14), `RecoveryCard` (Task 10), `HotkeyListInput` (`src/components/ui/HotkeyListInput.tsx:37`, `{ value, onChange, required, maxHotkeys }`), `useHotkeyModeInfo(scope, hotkey)` (`src/hooks/useHotkeyModeInfo.ts:33`, which returns `loaded` and `supportsPushToTalk`), `Toggle`, and the settings setters `setDictationKey`, `setActivationMode` and `setAutoPasteEnabled`.
- Produces:
  - `useShortcutDemo(active: boolean): void`. It begins a `shortcut` demo while active, so presses are mirrored and never start a dictation.
  - `ShortcutStep`:

  ```ts
  export interface ShortcutStepProps {
    platform: "darwin" | "linux" | "win32";
    hotkey: string; hotkeyLabel: string;
    activationMode: "tap" | "push"; pushSupported: boolean;
    keycap: KeycapState;
    accessibilityMissing: boolean; onGrantAccessibility(): void;
    autoPasteEnabled: boolean; onAutoPasteChange(value: boolean): void;
    onActivationModeChange(mode: "tap" | "push"): void;
    onHotkeyChange(value: string): void;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/onboardingShortcutStep.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const keycap = (patch = {}) => ({ pressed: false, downAtMs: null, lastStyle: null, presses: 0, ...patch });

async function shortcut(t, props = {}) {
  const events = [];
  const ui = await mountComponent(t, "/components/onboarding/ShortcutStep.tsx", {
    exportName: "ShortcutStep",
    props: {
      platform: "darwin",
      hotkey: "GLOBE",
      hotkeyLabel: "fn",
      activationMode: "tap",
      pushSupported: true,
      keycap: keycap(),
      accessibilityMissing: false,
      onGrantAccessibility: () => events.push("grant"),
      autoPasteEnabled: true,
      onAutoPasteChange: (value) => events.push(["paste", value]),
      onActivationModeChange: (mode) => events.push(["mode", mode]),
      onHotkeyChange: (value) => events.push(["hotkey", value]),
      ...props,
    },
    mocks: { "ui/HotkeyListInput": "export function HotkeyListInput() { return null; } export default HotkeyListInput;" },
  });
  return { ui, events };
}

test("before a press, the tester explains tap versus hold for the real key", async (t) => {
  const { ui } = await shortcut(t);
  const [tester] = ui.byAttr("role", "group");
  assert.equal(tester.attributes.tabindex, "0");
  assert.ok(tester.attributes["aria-label"].includes("setupFlow.shortcut.testerLabel"));
  expectKey(ui, "setupFlow.shortcut.hint", { key: "fn" });
});

test("a held press reads as Shortcut works · Hold to talk and offers to switch", async (t) => {
  const { ui, events } = await shortcut(t, { keycap: keycap({ presses: 1, lastStyle: "hold" }) });
  expectKey(ui, "setupFlow.shortcut.works");
  expectKey(ui, "setupFlow.shortcut.detected.hold");
  expectKey(ui, "setupFlow.shortcut.fills");
  await ui.click("setupFlow.shortcut.switch");
  assert.deepEqual(events, [["mode", "push"]]);
});

test("no switch is offered when the key cannot hold-to-talk", async (t) => {
  const { ui } = await shortcut(t, { keycap: keycap({ presses: 1, lastStyle: "hold" }), pushSupported: false });
  assert.equal(ui.text().includes("setupFlow.shortcut.switch"), false);
});

test("macOS without Accessibility gets the fix; Linux never sees that row", async (t) => {
  const { ui, events } = await shortcut(t, { accessibilityMissing: true });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  await ui.click("setupFlow.try.grantAccess");
  assert.deepEqual(events, ["grant"]);
  await ui.rerender({ platform: "linux", accessibilityMissing: false });
  assert.equal(ui.byAttr("role", "alert").length, 0);
});

test("the auto-paste switch has a name", async (t) => {
  const { ui } = await shortcut(t);
  assert.equal(ui.byAttr("aria-label", "setupFlow.shortcut.autoPaste").length, 1);
});
```

Append to `test/components/onboardingFlow.test.js`:

```js
test("the flow offers no push-to-talk switch until the key's capabilities have loaded (ONB-19)", async (t) => {
  let resolveInfo;
  const listeners = new Set();
  const { ui } = await mountFlow(t, { initialStep: "shortcuts" }, {
    api: {
      getHotkeyModeInfo: () => new Promise((resolve) => (resolveInfo = resolve)),
      onDictationHotkeyEvent: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    },
  });
  const press = (phase, at) => React.act(async () => [...listeners].forEach((listener) => listener({ phase, at })));
  await press("down", 0);
  await press("up", 600);
  expectKey(ui, "setupFlow.shortcut.detected.hold");
  assert.equal(ui.text().includes("setupFlow.shortcut.switch"), false, "unknown support is not support");
  await React.act(async () => resolveInfo({ supportsPushToTalk: true }));
  expectKey(ui, "setupFlow.shortcut.switch");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/onboardingShortcutStep.test.js test/components/onboardingFlow.test.js`

Expected: FAIL. `ShortcutStep` is missing.

- [ ] **Step 3: Implement**

1. Append to `src/components/onboarding/useDictationHotkey.ts`:

   ```ts
   /** A "shortcut" demo mirrors presses to setup without ever recording (Task 4). */
   export function useShortcutDemo(active: boolean): void {
     useEffect(() => {
       if (!active) return;
       const id = `onboarding-shortcut-${Date.now().toString(36)}`;
       void window.electronAPI?.beginOnboardingDemo?.({ id, kind: "shortcut" });
       return () => {
         void window.electronAPI?.endOnboardingDemo?.(id);
       };
     }, [active]);
   }
   ```

2. Create `src/components/onboarding/ShortcutStep.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Check } from "../icons";
   import { HotkeyListInput } from "../ui/HotkeyListInput";
   import { Toggle } from "../ui/toggle";
   import { Button } from "../ui/button";
   import { suggestActivationMode, type KeycapState } from "../../utils/onboardingShortcut";
   import { LiveKeycap } from "./LiveKeycap";
   import { RecoveryCard } from "./RecoveryCard";

   export interface ShortcutStepProps {
     platform: "darwin" | "linux" | "win32";
     hotkey: string;
     hotkeyLabel: string;
     activationMode: "tap" | "push";
     pushSupported: boolean;
     keycap: KeycapState;
     accessibilityMissing: boolean;
     onGrantAccessibility(): void;
     autoPasteEnabled: boolean;
     onAutoPasteChange(value: boolean): void;
     onActivationModeChange(mode: "tap" | "push"): void;
     onHotkeyChange(value: string): void;
   }

   export function ShortcutStep(props: ShortcutStepProps) {
     const { t } = useTranslation();
     const { keycap, hotkeyLabel, activationMode } = props;
     const tried = keycap.presses > 0 && keycap.lastStyle !== null;
     const suggestion = tried ? suggestActivationMode(activationMode, keycap.lastStyle!, props.pushSupported) : null;

     return (
       <>
         {props.accessibilityMissing ? (
           <RecoveryCard
             title={t("setupFlow.try.accessibilityTitle")}
             body={t("setupFlow.shortcut.accessibilityBody")}
             actions={[{ label: t("setupFlow.try.grantAccess"), onClick: props.onGrantAccessibility }]}
           />
         ) : null}
         <section className="onb-card" aria-labelledby="onb-shortcut-title">
           <h2 id="onb-shortcut-title" className="onb-card__title">
             {t("setupFlow.shortcut.title")}
           </h2>
           <div className="onb-tester" role="group" tabIndex={0} aria-label={t("setupFlow.shortcut.testerLabel", { key: hotkeyLabel })}>
             <LiveKeycap
               label={hotkeyLabel}
               sublabel={t(`setupFlow.try.keycap.${activationMode}`)}
               pressed={keycap.pressed}
               size={84}
               flashKey={keycap.presses}
             />
             <div className="onb-field" data-state={tried ? "success" : "idle"} aria-live="polite">
               {tried ? (
                 <>
                   <p className="onb-field__text">{t("setupFlow.shortcut.fills")}</p>
                   <p className="onb-field__ok">
                     <Check aria-hidden="true" />
                     {t("setupFlow.shortcut.works")} · {t(`setupFlow.shortcut.detected.${keycap.lastStyle}`)}
                   </p>
                 </>
               ) : (
                 <p className="onb-field__hint">{t("setupFlow.shortcut.hint", { key: hotkeyLabel })}</p>
               )}
             </div>
           </div>
           {suggestion ? (
             <p className="onb-muted">
               {t(`setupFlow.shortcut.suggest.${suggestion}`)}{" "}
               <Button size="sm" variant="ghost" onClick={() => props.onActivationModeChange(suggestion)}>
                 {t("setupFlow.shortcut.switch")}
               </Button>
             </p>
           ) : null}
           <div>
             <p className="onb-toggle-row__title">{t("setupFlow.shortcut.change")}</p>
             <p className="onb-muted">{t("setupFlow.shortcut.changeHelp")}</p>
             <HotkeyListInput value={props.hotkey} onChange={props.onHotkeyChange} required maxHotkeys={1} />
           </div>
           <div className="onb-toggle-row">
             <div>
               <p className="onb-toggle-row__title">{t("setupFlow.shortcut.autoPaste")}</p>
               <p className="onb-muted">
                 {t(props.platform === "darwin" ? "setupFlow.shortcut.autoPasteBodyMac" : "setupFlow.shortcut.autoPasteBodyOther")}
               </p>
             </div>
             <Toggle
               checked={props.autoPasteEnabled}
               onChange={props.onAutoPasteChange}
               aria-label={t("setupFlow.shortcut.autoPaste")}
             />
           </div>
         </section>
       </>
     );
   }
   ```

3. Apply the **[T17]** blocks of the composition and delete the legacy `ShortcutsStep`.
   - `pushSupported` is `modeInfo.loaded && modeInfo.supportsPushToTalk`. Until main answers, push-to-talk is unknown, and unknown is not offered (ONB-19).
   - `autoPasteEnabled` is read through a store selector, not `getState()`, so the switch re-renders.
   - While the user captures a new key, `HotkeyListInput` puts main in listening mode. `createHotkeyCallback` returns before `reportDictationHotkey` in that case (Task 4), so capture presses never count as a test.

4. Append to `src/styles/onboarding.css`:

   ```css
   .onb-tester {
     display: grid;
     justify-items: center;
     gap: 12px;
     padding: 16px;
     border: 1px dashed var(--color-border-hover);
     border-radius: 12px;
     background: var(--color-card);
   }

   .onb-tester:focus-visible {
     border-style: solid;
     border-color: var(--color-live);
     outline: none;
     box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-live) 20%, transparent);
   }
   ```

5. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "shortcut": {
         "title": "Try your shortcut.",
         "testerLabel": "Shortcut tester. Press {{key}}.",
         "hint": "Press {{key}}. A quick tap starts and stops; holding talks while you hold.",
         "fills": "Hello, it works.",
         "works": "Shortcut works",
         "detected": { "tap": "Tap to start and stop detected", "hold": "Hold to talk detected" },
         "suggest": {
           "push": "You held the key. Switch to hold to talk?",
           "tap": "You tapped the key. Switch to tap to start and stop?"
         },
         "switch": "Switch",
         "change": "Change shortcut",
         "changeHelp": "Press this anywhere to talk. Change it if it clashes with another app.",
         "autoPaste": "Automatic paste",
         "autoPasteBodyMac": "Paste your words where the cursor is. Needs Accessibility access on macOS.",
         "autoPasteBodyOther": "Paste your words where the cursor is.",
         "accessibilityBody": "macOS only lets Loqui hear the shortcut and paste after you allow it. You can grant it now or later in Settings."
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/components/onboardingShortcutStep.test.js test/components/onboardingFlow.test.js && npm run typecheck && npm run i18n:check`

Expected: PASS.

Then check in the preview. Open `?preview=onboarding&step=shortcuts&scenario=ready&platform=macos` and hold **Hold shortcut** for about a second:
- you should see "Shortcut works · Hold to talk detected" and a Switch offer;
- with `scenario=accessibility-missing`, presses never arrive and the Grant access card shows.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/ShortcutStep.tsx src/components/onboarding/useDictationHotkey.ts src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/components/onboardingShortcutStep.test.js test/components/onboardingFlow.test.js
git commit -m "feat(onboarding): live keycap shortcut tester that detects tap versus hold"
```

---

### Task 18: An honest Ready, and the last of the legacy flow

Covers ONB-R8 A and ONB-Q14, finishes ONB-Q18, and consumes §5.1 for readiness and the note action. Review findings closed here:
- I05: cleanup readiness reads the choice and its check;
- I06: "Dictate into a note" validates `noteRecordingStt` and the microphone, and discloses that route;
- I07: Ready claims only what was proven;
- I11: the completion options use a single type.

**Files:**
- Create:
  - `src/utils/onboardingReadiness.ts`
  - `src/utils/afterSetupIntent.ts`
  - `src/components/onboarding/ReadyStep.tsx`
- Modify `src/components/OnboardingFlow.tsx`. Apply the **[T18]** blocks of the composition: the imports, `speechRoute`, `noteRoute`, `summary`, `noteAction` and the `finish` case. Then delete:
  - the legacy `FinishStep` (931-1008) and the legacy `readiness` memo (1259-1302);
  - `legacy()`, and the `onboarding-welcome.css` and `onboarding-guided.css` imports;
  - `ChoiceCard` (245-301);
  - the `PrivacyDefaults` import;
  - `const preview = Boolean(import.meta.env.DEV && window.loquiBrowserPreview);` (1016) and any remaining `preview`/`scenario` helper.
- Modify `src/AppRouter.jsx:66-72`, so the `onComplete` callback forwards the intent.
- Modify `src/components/ControlPanel.tsx`. After `handleNewNote` (139), add an effect that takes the intent.
- Delete:
  - `src/styles/onboarding-welcome.css` and `src/styles/onboarding-guided.css`;
  - the `.onb-legacy` rule in `src/styles/onboarding.css`;
  - every test in Plan 02's `test/components/onboardingShell.test.js` that reads either deleted stylesheet (its three ONB-Q1 tests). Find them with `grep -n "onboarding-welcome\|onboarding-guided" test/components/*.test.js`.
- Modify `src/styles/onboarding.css` (append).
- Test:
  - `test/utils/onboardingReadiness.test.js`
  - `test/components/onboardingReady.test.js`
  - `test/components/onboardingNoPreviewBranches.test.js`
  - append to `test/components/onboardingFlow.test.js`

**Interfaces:**
- Consumes:
  - from §5.1: `ResolvedRoute` and `useResolvedRoute`;
  - from Task 1: `AfterSetupIntent` and `OnboardingCompleteOptions`;
  - from Task 12: `PrivacyDefaults`;
  - from Task 16: `cleanupSituation`;
  - from Plan 03 (§5.1, published components): `RouteDestinationChip` for the note action's route (R2-M02);
  - the flow state the composition already holds;
  - `useCreateNote` (already in `ControlPanel`).
- Produces, in `onboardingReadiness.ts`:

  ```ts
  // I07: "configured" = set up but not yet proven; only "ready" is proven.
  export type ReadinessStatus = "ready" | "configured" | "pending" | "optional";
  export type ReadinessKey = "speech" | "microphone" | "shortcut" | "cleanup";
  export interface ReadinessRow {
    key: ReadinessKey; status: ReadinessStatus; detail: string; values?: Record<string, string>;
    step: OnboardingStep;            // where setup fixes it
    settingsPath?: string;           // set when only Settings can fix it
  }
  export interface ReadinessInput {
    speechRoute: ResolvedRoute; noteRoute: ResolvedRoute; localVoiceActive: boolean; voiceDownload: VoiceDownloadState["status"];
    microphone: "granted" | "denied" | "unknown"; micHeard: boolean; trialSucceeded: boolean;
    platform: "darwin" | "linux" | "win32"; accessibilityGranted: boolean | null;
    shortcutProven: boolean; shortcutLabel: string; activationMode: "tap" | "push";
    cleanupChoice: CleanupChoice; cleanupStatus: CleanupStatus; cleanupRoute: ResolvedRoute; cleanupProviderLabel: string;
  }
  export interface ReadinessSummary { rows: ReadinessRow[]; pending: number; proven: boolean; allLocal: boolean }
  export function summarizeReadiness(input: ReadinessInput): ReadinessSummary;

  // I06: the note action's own route (noteRecordingStt), not dictation's.
  // §5.1 rule 1: "unknown" is "checking", never ready. Rule 9: self-hosted notes are unreachable/unsupported.
  export type NoteBlock = "microphone" | "unsupported" | "sealed" | "needsModel" | "needsKey" | "needsUrl" | "unreachable";
  export interface NoteActionState {
    status: "ready" | "checking" | "blocked"; block: NoteBlock | null;
    locality: Locality; providerId: string | null; model: string | null; settingsPath: string; // the route, for RouteDestinationChip
  }
  export function noteActionState(input: { route: ResolvedRoute; microphone: "granted" | "denied" | "unknown" }): NoteActionState;
  ```

  - Rows come in the order Speech, Microphone, Shortcut, Cleanup.
  - Cleanup that is off is `optional` and never counts as pending.
  - Cleanup that was chosen but is unavailable is `pending` (I05).
  - `allLocal` includes `noteRecordingStt`, even when dictation and cleanup are local. A remote, network or unknown note locality prevents the blanket device-only claim.
- Produces, in `afterSetupIntent.ts`:
  - `setAfterSetupIntent(intent: AfterSetupIntent)`;
  - `takeAfterSetupIntent(): AfterSetupIntent | null`, which is one-shot and in memory.
- `ReadyStep` props: `platform`, `summary`, `note: NoteActionState`, `noteProviderLabel`, `onResume(step)`, `onDictateNote()`, `onOpenSettings(path)`, `onOpenWorkspace()` and `privacy` (`PrivacyDefaultsProps` without `platform`).

- [ ] **Step 1: Write the failing tests**

Create `test/utils/onboardingReadiness.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingReadiness.ts");
const route = (id, patch = {}) => ({
  id,
  kind: id.endsWith("Stt") ? "speech" : "text",
  locality: "device",
  provider: null,
  providerId: null,
  host: null,
  model: id === "dictationStt" ? "Parakeet Unified EN 0.6B" : null,
  state: { status: "ready" },
  sends: null,
  settingsPath: id === "noteRecordingStt" ? "stt/noteRecording" : id === "dictationStt" ? "stt/dictation" : "llms/dictationCleanup",
  ...patch,
});
const input = (patch = {}) => ({
  speechRoute: route("dictationStt"),
  noteRoute: route("noteRecordingStt"),
  localVoiceActive: true,
  voiceDownload: "ready",
  microphone: "granted",
  micHeard: true,
  trialSucceeded: true,
  platform: "darwin",
  accessibilityGranted: true,
  shortcutProven: true,
  shortcutLabel: "fn",
  activationMode: "tap",
  cleanupChoice: "none",
  cleanupStatus: "skipped",
  cleanupRoute: route("dictationCleanup", { state: { status: "off" } }),
  cleanupProviderLabel: "OpenAI",
  ...patch,
});
const statuses = (summary) => summary.rows.map((row) => [row.key, row.status]);

test("everything proven: ready, with cleanup off as optional, in the agreed order", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(input());
  assert.deepEqual(statuses(summary), [
    ["speech", "ready"],
    ["microphone", "ready"],
    ["shortcut", "ready"],
    ["cleanup", "optional"],
  ]);
  assert.deepEqual([summary.pending, summary.proven, summary.allLocal], [0, true, true]);
});

test("set up but never tried is configured, not ready (I07)", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(input({ trialSucceeded: false, micHeard: false, shortcutProven: false }));
  assert.deepEqual(statuses(summary).slice(0, 3), [
    ["speech", "configured"],
    ["microphone", "configured"],
    ["shortcut", "configured"],
  ]);
  assert.deepEqual([summary.pending, summary.proven], [0, false]);
});

test("a microphone counts as working only once it was heard (I07)", async () => {
  const { summarizeReadiness } = await load();
  assert.equal(summarizeReadiness(input({ trialSucceeded: false, micHeard: true })).rows[1].status, "ready");
  assert.equal(summarizeReadiness(input({ trialSucceeded: false, micHeard: false })).rows[1].detail, "microphone.allowed");
  assert.equal(summarizeReadiness(input({ microphone: "unknown", trialSucceeded: false, micHeard: false })).rows[1].status, "pending");
});

test("unknown Accessibility on macOS is pending, never ready (I07)", async () => {
  const { summarizeReadiness } = await load();
  const unknown = summarizeReadiness(input({ accessibilityGranted: null, shortcutProven: false }));
  assert.deepEqual([unknown.rows[2].status, unknown.rows[2].detail], ["pending", "shortcut.checkAccessibility"]);
  const linux = summarizeReadiness(input({ platform: "linux", accessibilityGranted: null, shortcutProven: false }));
  assert.equal(linux.rows[2].status, "configured");
});

test("pending rows name what is missing and where it is fixed", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(
    input({
      speechRoute: route("dictationStt", { state: { status: "needsModel" } }),
      localVoiceActive: false,
      voiceDownload: "downloading",
      microphone: "denied",
      micHeard: false,
      trialSucceeded: false,
      accessibilityGranted: false,
      shortcutProven: false,
    })
  );
  assert.deepEqual(summary.rows.slice(0, 3).map((row) => [row.status, row.detail, row.step]), [
    ["pending", "speech.downloading", "speech"],
    ["pending", "microphone.denied", "welcome"],
    ["pending", "shortcut.needsAccessibility", "shortcuts"],
  ]);
  assert.equal(summary.pending, 3);
});

test("Ready waits for a ready route: unknown reads Checking…, never ready (§5.1 rule 1)", async () => {
  const { summarizeReadiness } = await load();
  const unknown = summarizeReadiness(input({ speechRoute: route("dictationStt", { state: { status: "unknown" } }) }));
  assert.deepEqual([unknown.rows[0].status, unknown.rows[0].detail, unknown.proven], ["pending", "speech.checking", false]);
  const justInstalled = summarizeReadiness(input({ speechRoute: route("dictationStt", { state: { status: "needsModel" } }), localVoiceActive: true }));
  assert.deepEqual([justInstalled.rows[0].status, justInstalled.rows[0].detail], ["pending", "speech.checking"], "a finished download still waits for the route");
  const cleanupUnknown = summarizeReadiness(input({ cleanupChoice: "local", cleanupStatus: "ready", cleanupRoute: route("dictationCleanup", { state: { status: "unknown" } }) }));
  assert.deepEqual([cleanupUnknown.rows[3].status, cleanupUnknown.rows[3].detail], ["pending", "cleanup.checking"]);
});

test("a chosen but unavailable cleanup is pending with a real Settings destination (I05)", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(input({ cleanupChoice: "provider", cleanupStatus: "failed" }));
  const row = summary.rows[3];
  assert.deepEqual([row.status, row.detail, row.values, row.settingsPath], ["pending", "cleanup.needsKey", { provider: "OpenAI" }, "llms/dictationCleanup"]);
  assert.equal(summary.pending, 1);
  const remote = summarizeReadiness(input({ cleanupChoice: "provider", cleanupStatus: "ready", cleanupRoute: route("dictationCleanup", { locality: "remote", providerId: "openai" }) }));
  assert.deepEqual([remote.rows[3].status, remote.allLocal], ["ready", false]);
});

test("the all-local claim includes the note route independently of dictation and cleanup", async () => {
  const { summarizeReadiness } = await load();
  for (const locality of ["device", "remote", "network", "unknown"]) {
    const summary = summarizeReadiness(input({ noteRoute: route("noteRecordingStt", { locality }) }));
    assert.deepEqual([summary.pending, summary.proven], [0, true], "dictation remains proven");
    assert.equal(summary.allLocal, locality === "device", locality);
  }
});

test("the note action follows its own route and the microphone (I06)", async () => {
  const { noteActionState } = await load();
  const note = (patch = {}, extra = {}) => noteActionState({ route: route("noteRecordingStt", patch), microphone: "granted", ...extra });
  assert.deepEqual(note(), { status: "ready", block: null, locality: "device", providerId: null, model: null, settingsPath: "stt/noteRecording" });
  assert.equal(note({ state: { status: "unreachable", detail: "unsupported" } }).block, "unsupported", "§5.1 rule 9: self-hosted notes");
  assert.equal(note({ state: { status: "unreachable", detail: "sealed" } }).block, "sealed");
  assert.deepEqual([note({ state: { status: "unknown" } }).status, note({ state: { status: "unknown" } }).block], ["checking", null], "§5.1 rule 1");
  assert.equal(note({ state: { status: "needsKey", provider: "openai" } }).block, "needsKey");
  assert.equal(note({ state: { status: "needsModel" } }).block, "needsModel");
  assert.equal(note({}, { microphone: "denied" }).block, "microphone");
  const remote = note({ locality: "remote", providerId: "openai" });
  assert.deepEqual([remote.status, remote.locality, remote.providerId], ["ready", "remote", "openai"]);
});

test("the after-setup intent is taken exactly once", async () => {
  const { setAfterSetupIntent, takeAfterSetupIntent } = await import("../../src/utils/afterSetupIntent.ts");
  assert.equal(takeAfterSetupIntent(), null);
  setAfterSetupIntent({ kind: "open-settings", path: "stt/noteRecording" });
  assert.deepEqual(takeAfterSetupIntent(), { kind: "open-settings", path: "stt/noteRecording" });
  assert.equal(takeAfterSetupIntent(), null);
});
```

Create `test/components/onboardingReady.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { mountComponent, expectKey } = require("../helpers/harness/mountComponent");

const STEPS = { speech: "speech", microphone: "welcome", shortcut: "shortcuts", cleanup: "cleanup" };
const rows = (statuses, extra = {}) =>
  ["speech", "microphone", "shortcut", "cleanup"].map((key, index) => ({
    key,
    status: statuses[index],
    step: STEPS[key],
    detail: `${key}.${statuses[index]}`,
    ...(extra[key] ?? {}),
  }));
// Plan 03's published chips (§5.1), stubbed so the test sees exactly what the step hands them.
const ROUTE_CHIPS_MOCK = `
import React from "react";
export function RouteDestinationChip({ route }) {
  return React.createElement("span", { "data-route-chip": "destination", "data-locality": route.locality, "data-provider": route.providerId ?? "" });
}
export function RouteStateChip({ state }) {
  return React.createElement("span", { "data-route-chip": "state", "data-state": state.status });
}`;
const readyNote = { status: "ready", block: null, locality: "device", providerId: null, model: null, settingsPath: "stt/noteRecording" };

async function ready(t, summary, patch = {}) {
  const events = [];
  const ui = await mountComponent(t, "/components/onboarding/ReadyStep.tsx", {
    exportName: "ReadyStep",
    props: {
      platform: "darwin",
      summary,
      note: readyNote,
      noteProviderLabel: "OpenAI",
      onResume: (step) => events.push(["resume", step]),
      onDictateNote: () => events.push("note"),
      onOpenSettings: (to) => events.push(["settings", to]),
      onOpenWorkspace: () => events.push("workspace"),
      privacy: { historyEnabled: true, onHistoryChange() {}, updatesEnabled: true, onUpdatesChange() {} },
      ...patch,
    },
    mocks: { "routing/RouteChips": ROUTE_CHIPS_MOCK },
  });
  return { ui, events };
}

test("proven: the title says so, icons use status colours, and the note action is live with its locality", async (t) => {
  const { ui, events } = await ready(t, { rows: rows(["ready", "ready", "ready", "optional"]), pending: 0, proven: true, allLocal: true });
  expectKey(ui, "setupFlow.ready.titleProven");
  expectKey(ui, "setupFlow.ready.subAllLocalMac");
  assert.deepEqual(ui.byAttr("data-status").map((node) => node.attributes["data-status"]), ["ready", "ready", "ready", "optional"]);
  assert.equal(ui.byAttr("data-locality", "device").length, 1, "the note action discloses where audio goes");
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok(dictate.textContent.includes("setupFlow.ready.dictateNote"));
  await ui.click(dictate);
  await ui.click("setupFlow.ready.openWorkspace");
  assert.deepEqual(events, ["note", "workspace"]);
});

test("set up but not tried does not claim dictation works (I07)", async (t) => {
  const { ui } = await ready(t, { rows: rows(["configured", "configured", "configured", "optional"]), pending: 0, proven: false, allLocal: true });
  expectKey(ui, "setupFlow.ready.titleConfigured");
  assert.equal(ui.text().includes("setupFlow.ready.titleProven"), false);
  const resumable = ui.findAll((node) => node.tagName === "BUTTON" && node.attributes["data-row"] !== undefined);
  assert.deepEqual(resumable.map((node) => node.attributes["data-row"]), ["speech", "microphone", "shortcut", "cleanup"]);
});

test("pending rows resume in setup, or open the exact Settings page when only Settings can fix them", async (t) => {
  const summary = {
    rows: rows(["ready", "pending", "ready", "pending"], { cleanup: { settingsPath: "llms/dictationCleanup" } }),
    pending: 2,
    proven: true,
    allLocal: true,
  };
  const { ui, events } = await ready(t, summary);
  expectKey(ui, "setupFlow.ready.titlePending", { count: 2 });
  await ui.click(ui.byAttr("data-row", "microphone")[0]);
  await ui.click(ui.byAttr("data-row", "cleanup")[0]);
  assert.deepEqual(events, [["resume", "welcome"], ["settings", "llms/dictationCleanup"]]);
});

test("a blocked note action says why and links to its own Settings route (I06)", async (t) => {
  const note = { status: "blocked", block: "unsupported", locality: "network", providerId: null, model: null, settingsPath: "stt/noteRecording" };
  const { ui, events } = await ready(t, { rows: rows(["ready", "ready", "ready", "optional"]), pending: 0, proven: true, allLocal: false }, { note });
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok("disabled" in dictate.attributes);
  const [reason] = ui.byAttr("id", dictate.attributes["aria-describedby"]);
  assert.ok(reason.textContent.includes("setupFlow.ready.noteBlocked.unsupported"));
  await ui.click("setupFlow.ready.fixNote");
  assert.deepEqual(events, [["settings", "stt/noteRecording"]]);
});

test("an unconfirmed note route reads Checking…, with no fix and no claim (§5.1 rule 1)", async (t) => {
  const note = { status: "checking", block: null, locality: "device", providerId: null, model: null, settingsPath: "stt/noteRecording" };
  const { ui } = await ready(t, { rows: rows(["ready", "ready", "ready", "optional"]), pending: 0, proven: true, allLocal: true }, { note });
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok("disabled" in dictate.attributes);
  expectKey(ui, "setupFlow.ready.noteChecking");
  assert.equal(ui.text().includes("setupFlow.ready.fixNote"), false);
});

test("a denied microphone sends the note fix back to Hello", async (t) => {
  const note = { status: "blocked", block: "microphone", locality: "device", providerId: null, model: null, settingsPath: "stt/noteRecording" };
  const { ui, events } = await ready(t, { rows: rows(["ready", "pending", "ready", "optional"]), pending: 1, proven: true, allLocal: true }, { note });
  await ui.click("setupFlow.ready.fixNote");
  assert.deepEqual(events, [["resume", "welcome"]]);
});

test("a remote note route names its provider and never claims everything stays on device", async (t) => {
  const note = { status: "ready", block: null, locality: "remote", providerId: "openai", model: "Whisper", settingsPath: "stt/noteRecording" };
  const { ui } = await ready(t, { rows: rows(["ready", "ready", "ready", "optional"]), pending: 0, proven: true, allLocal: false }, { note });
  expectKey(ui, "setupFlow.ready.noteSends", { provider: "OpenAI" });
  expectKey(ui, "setupFlow.ready.subProven");
  assert.equal(/setupFlow\.ready\.subAllLocal(Mac|Other)/.test(ui.text()), false);
  const [chip] = ui.byAttr("data-route-chip", "destination");
  assert.deepEqual([chip.attributes["data-locality"], chip.attributes["data-provider"]], ["remote", "openai"], "Plan 03's chip, fed the note route (R2-M02)");
});

test("status colours stay off the words and fuchsia stays out of status (ONB-Q14)", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../src/styles/onboarding.css"), "utf8");
  assert.match(css, /\.onb-ready-row__icon\[data-status="ready"\]\s*\{[^}]*var\(--color-success\)/);
  assert.match(css, /\.onb-ready-row__icon\[data-status="pending"\]\s*\{[^}]*var\(--color-warning\)/);
  assert.doesNotMatch(css, /\.onb-ready-row__status\s*\{[^}]*--color-(success|warning)/);
  for (const block of css.match(/\.onb-ready[^{]*\{[^}]*\}/g) ?? []) {
    assert.doesNotMatch(block, /--color-(accent|nav-marker|live)\b/, "brand colours stay on the buttons");
  }
});
```

Create `test/components/onboardingNoPreviewBranches.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");
const files = [
  "src/components/OnboardingFlow.tsx",
  ...fs.readdirSync(path.join(repoRoot, "src/components/onboarding")).map((name) => `src/components/onboarding/${name}`),
];

test("setup components contain no preview branches or preview copy (ONB-Q18)", () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /loquiBrowserPreview|import\.meta\.env\.DEV|Preview: |in this preview|simulated/i, file);
  }
});

test("the old onboarding styles and welcome screen are gone", () => {
  for (const gone of ["src/styles/onboarding-welcome.css", "src/styles/onboarding-guided.css", "src/components/onboarding/WelcomeScreen.tsx"]) {
    assert.equal(fs.existsSync(path.join(repoRoot, gone)), false, gone);
  }
});

test("the after-setup intent is handed to the workspace once, for both kinds", () => {
  const router = fs.readFileSync(path.join(repoRoot, "src/AppRouter.jsx"), "utf8");
  const panel = fs.readFileSync(path.join(repoRoot, "src/components/ControlPanel.tsx"), "utf8");
  assert.match(router, /if \(options\?\.next\) setAfterSetupIntent\(options\.next\)/);
  assert.match(panel, /takeAfterSetupIntent\(\)/);
  assert.match(panel, /intent\.kind === "dictate-note"[\s\S]*?handleNewNote\(\)/);
  assert.match(panel, /setSettingsSection\(intent\.path\)[\s\S]*?setShowSettings\(true\)/);
});
```

Append to `test/components/onboardingFlow.test.js`:

```js
test("Ready without a trial does not say you're dictating (I07)", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "finish" }, { api: readyVoiceApi() });
  await React.act(async () => {});
  assert.equal(ui.text().includes("setupFlow.ready.titleProven"), false);
  assert.notEqual(ui.byAttr("data-status")[0].attributes["data-status"], "ready", "speech is not proven");
});

test("a self-hosted note route blocks Dictate into a note and opens its own Settings page (I06)", async (t) => {
  const { ui, completed } = await mountFlow(t, { initialStep: "finish" }, {
    api: readyVoiceApi(),
    storage: { meetingTranscriptionMode: "self-hosted", remoteTranscriptionUrl: "http://10.0.0.5:9000" },
  });
  await React.act(async () => {});
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok("disabled" in dictate.attributes);
  expectKey(ui, "setupFlow.ready.noteBlocked.unsupported"); // §5.1 rule 9, from Plan 03's resolver
  await ui.click("setupFlow.ready.fixNote");
  const [options] = completed();
  assert.equal(options.next.kind, "open-settings");
  assert.match(options.next.path, /\S/, "the note route's own settingsPath");
});
```

Extend Task 16's I05 flow test. After its last assertion, walk to Ready and check the same answer is there:

```js
  await ui.click(primary(ui)); // Cleanup → Shortcut
  await ui.click(primary(ui)); // Shortcut → Ready
  expectKey(ui, "setupFlow.ready.details.cleanup.needsKey", { provider: "OpenAI" });
  assert.equal(ui.byAttr("data-row", "cleanup").length, 1, "a pending row with a fix, not an optional one");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingReadiness.test.js test/components/onboardingReady.test.js test/components/onboardingNoPreviewBranches.test.js test/components/onboardingFlow.test.js`

Expected: FAIL. The modules are missing, the legacy CSS files still exist, and `OnboardingFlow.tsx` still has `import.meta.env.DEV`.

- [ ] **Step 3: Implement**

1. Create `src/utils/afterSetupIntent.ts`:

   ```ts
   import type { AfterSetupIntent } from "./onboardingFlow";

   // One-shot hand-off from setup's Ready step to the workspace (ONB-R8 A).
   // In memory on purpose: it must not survive a reload.
   let pending: AfterSetupIntent | null = null;

   export function setAfterSetupIntent(intent: AfterSetupIntent): void {
     pending = intent;
   }

   export function takeAfterSetupIntent(): AfterSetupIntent | null {
     const intent = pending;
     pending = null;
     return intent;
   }
   ```

2. Create `src/utils/onboardingReadiness.ts`:

   ```ts
   import type { Locality } from "../lib/locality";
   import type { ResolvedRoute } from "../lib/routes";
   import type { CleanupChoice, CleanupStatus } from "./onboardingCleanup";
   import { cleanupSituation } from "./onboardingCleanupPreview";
   import type { VoiceDownloadState } from "./onboardingDownload";
   import type { OnboardingStep } from "./onboardingState";

   // Ready says only what is true (ONB-R8 A, I07). "ready" means proven in this
   // setup; "configured" means set up but not yet tried.
   export type ReadinessStatus = "ready" | "configured" | "pending" | "optional";
   export type ReadinessKey = "speech" | "microphone" | "shortcut" | "cleanup";

   export interface ReadinessRow {
     key: ReadinessKey;
     status: ReadinessStatus;
     detail: string;
     values?: Record<string, string>;
     step: OnboardingStep;
     settingsPath?: string;
   }

   export interface ReadinessInput {
     speechRoute: ResolvedRoute;
     noteRoute: ResolvedRoute;
     localVoiceActive: boolean;
     voiceDownload: VoiceDownloadState["status"];
     microphone: "granted" | "denied" | "unknown";
     micHeard: boolean;
     trialSucceeded: boolean;
     platform: "darwin" | "linux" | "win32";
     accessibilityGranted: boolean | null;
     shortcutProven: boolean;
     shortcutLabel: string;
     activationMode: "tap" | "push";
     cleanupChoice: CleanupChoice;
     cleanupStatus: CleanupStatus;
     cleanupRoute: ResolvedRoute;
     cleanupProviderLabel: string;
   }

   export interface ReadinessSummary {
     rows: ReadinessRow[];
     pending: number;
     proven: boolean;
     allLocal: boolean;
   }

   function speechRow(input: ReadinessInput): ReadinessRow {
     const base = { key: "speech" as const, step: "speech" as const };
     const route = input.speechRoute;
     // §5.1 rule 1: only a ready route counts. A just-finished local download waits
     // for the route facts to refresh (Plan 03), and reads "Checking…" meanwhile.
     if (route.state.status === "ready") {
       return input.trialSucceeded
         ? { ...base, status: "ready", detail: "speech.proven", values: { voice: route.model ?? "" } }
         : { ...base, status: "configured", detail: "speech.configured", values: { voice: route.model ?? "" } };
     }
     if (input.voiceDownload === "downloading" || input.voiceDownload === "installing") {
       return { ...base, status: "pending", detail: "speech.downloading" };
     }
     if (route.state.status === "unknown" || input.localVoiceActive) {
       return { ...base, status: "pending", detail: "speech.checking" };
     }
     if (route.state.status === "needsKey" || route.state.status === "needsUrl" || route.state.status === "unreachable") {
       return { ...base, status: "pending", detail: "speech.unavailable", settingsPath: route.settingsPath };
     }
     return { ...base, status: "pending", detail: "speech.needsModel" };
   }

   function microphoneRow(input: ReadinessInput): ReadinessRow {
     const base = { key: "microphone" as const, step: "welcome" as const };
     if (input.trialSucceeded || input.micHeard) return { ...base, status: "ready", detail: "microphone.heard" };
     if (input.microphone === "granted") return { ...base, status: "configured", detail: "microphone.allowed" };
     return { ...base, status: "pending", detail: input.microphone === "denied" ? "microphone.denied" : "microphone.untested" };
   }

   function shortcutRow(input: ReadinessInput): ReadinessRow {
     const base = { key: "shortcut" as const, step: "shortcuts" as const };
     if (input.platform === "darwin" && input.accessibilityGranted !== true) {
       return { ...base, status: "pending", detail: input.accessibilityGranted === false ? "shortcut.needsAccessibility" : "shortcut.checkAccessibility" };
     }
     const values = { key: input.shortcutLabel };
     return input.shortcutProven
       ? { ...base, status: "ready", detail: `shortcut.proven.${input.activationMode}`, values }
       : { ...base, status: "configured", detail: `shortcut.configured.${input.activationMode}`, values };
   }

   function cleanupRow(input: ReadinessInput): ReadinessRow {
     const base = { key: "cleanup" as const, step: "cleanup" as const };
     const route = input.cleanupRoute;
     const situation = cleanupSituation(input.cleanupChoice, input.cleanupStatus, route);
     const provider = { provider: input.cleanupProviderLabel };
     switch (situation) {
       case "off":
         return { ...base, status: "optional", detail: "cleanup.off" };
       case "ready":
         return { ...base, status: "ready", detail: "cleanup.ready", values: { name: route.model ?? input.cleanupProviderLabel } };
       case "checking":
       case "needsConnection":
         return { ...base, status: "pending", detail: `cleanup.${situation}` };
       default:
         return { ...base, status: "pending", detail: `cleanup.${situation}`, values: provider, settingsPath: route.settingsPath };
     }
   }

   export function summarizeReadiness(input: ReadinessInput): ReadinessSummary {
     const rows = [speechRow(input), microphoneRow(input), shortcutRow(input), cleanupRow(input)];
     const pending = rows.filter((row) => row.status === "pending").length;
     const speechLocal = input.localVoiceActive || input.speechRoute.locality === "device";
     const cleanupLocal = rows[3].status === "optional" || input.cleanupRoute.locality === "device";
     const noteLocal = input.noteRoute.locality === "device";
     return { rows, pending, proven: rows[0].status === "ready", allLocal: speechLocal && cleanupLocal && noteLocal };
   }

   export type NoteBlock = "microphone" | "unsupported" | "sealed" | "needsModel" | "needsKey" | "needsUrl" | "unreachable";

   export interface NoteActionState {
     status: "ready" | "checking" | "blocked";
     block: NoteBlock | null;
     locality: Locality;
     providerId: string | null;
     model: string | null;
     settingsPath: string;
   }

   /**
    * I06: "Dictate into a note" records through noteRecordingStt, which can differ
    * from dictation (Task 13 leaves it alone). The route is the only input: §5.1
    * rule 9 resolves self-hosted notes as unreachable/unsupported, because the
    * recorder throws unsupportedSelfHosted (src/helpers/meetingTranscriptionRouting.js).
    */
   export function noteActionState({
     route,
     microphone,
   }: {
     route: ResolvedRoute;
     microphone: "granted" | "denied" | "unknown";
   }): NoteActionState {
     const base = { locality: route.locality, providerId: route.providerId, model: route.model, settingsPath: route.settingsPath };
     const blocked = (block: NoteBlock): NoteActionState => ({ ...base, status: "blocked", block });
     const state = route.state;
     if (state.status === "unknown") return { ...base, status: "checking", block: null };
     if (state.status === "unreachable" && state.detail === "unsupported") return blocked("unsupported");
     if (state.status === "unreachable" && state.detail === "sealed") return blocked("sealed");
     if (state.status === "needsModel" || state.status === "off") return blocked("needsModel");
     if (state.status === "needsKey") return blocked("needsKey");
     if (state.status === "needsUrl") return blocked("needsUrl");
     if (state.status === "unreachable") return blocked("unreachable");
     if (microphone === "denied") return blocked("microphone");
     return { ...base, status: "ready", block: null };
   }
   ```

   A microphone that is still `unknown` does not block the note: the recorder asks for it, as it does today. Only a denied microphone is a known failure.

3. Create `src/components/onboarding/ReadyStep.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Check, CircleAlert, Minus } from "../icons";
   import { Button } from "../ui/button";
   import { RouteDestinationChip } from "../settings/routing/RouteChips";
   import type { OnboardingStep } from "../../utils/onboardingState";
   import type { NoteActionState, ReadinessSummary } from "../../utils/onboardingReadiness";
   import { PrivacyDefaults, type PrivacyDefaultsProps } from "./PrivacyDefaults";

   export interface ReadyStepProps {
     platform: "darwin" | "linux" | "win32";
     summary: ReadinessSummary;
     note: NoteActionState;
     noteProviderLabel: string;
     onResume(step: OnboardingStep): void;
     onDictateNote(): void;
     onOpenSettings(path: string): void;
     onOpenWorkspace(): void;
     privacy: Omit<PrivacyDefaultsProps, "platform">;
   }

   const ICONS = { ready: Check, configured: Check, pending: CircleAlert, optional: Minus } as const;

   export function ReadyStep(props: ReadyStepProps) {
     const { platform, summary, note, noteProviderLabel, onResume, onOpenSettings, privacy } = props;
     const { t } = useTranslation();
     const device = platform === "darwin" ? "Mac" : "Other";
     const title =
       summary.pending > 0
         ? t("setupFlow.ready.titlePending", { count: summary.pending })
         : t(summary.proven ? "setupFlow.ready.titleProven" : "setupFlow.ready.titleConfigured");
     const sub =
       summary.pending > 0
         ? t("setupFlow.ready.subPending")
         : summary.proven
           ? t(summary.allLocal ? `setupFlow.ready.subAllLocal${device}` : "setupFlow.ready.subProven")
           : t("setupFlow.ready.subConfigured");
     const noteReady = note.status === "ready";
     const fixNote = () => (note.block === "microphone" ? onResume("welcome") : onOpenSettings(note.settingsPath));

     return (
       <>
         <section className="onb-card" aria-labelledby="onb-ready-title">
           <h2 id="onb-ready-title" className="onb-ready__title">
             {title}
           </h2>
           <p className="onb-muted">{sub}</p>
           <ul className="onb-ready-list">
             {summary.rows.map((row) => {
               const Icon = ICONS[row.status];
               const content = (
                 <>
                   <span className="onb-ready-row__icon" data-status={row.status}>
                     <Icon aria-hidden="true" />
                   </span>
                   <span className="onb-ready-row__name">{t(`setupFlow.ready.rows.${row.key}`)}</span>
                   <span className="onb-ready-row__status">{t(`setupFlow.ready.details.${row.detail}`, row.values)}</span>
                 </>
               );
               const fixInSettings = row.settingsPath;
               return (
                 <li key={row.key}>
                   {row.status === "ready" || row.status === "optional" ? (
                     <div className="onb-ready-row">{content}</div>
                   ) : (
                     <button
                       type="button"
                       className="onb-ready-row"
                       data-row={row.key}
                       onClick={() => (fixInSettings ? onOpenSettings(fixInSettings) : onResume(row.step))}
                     >
                       {content}
                     </button>
                   )}
                 </li>
               );
             })}
           </ul>
           <div className="onb-ready__note">
             <p className="onb-reco__meta">
               <RouteDestinationChip route={note} />
               <span>
                 {note.locality === "device" ? t("setupFlow.ready.noteLocal") : t("setupFlow.ready.noteSends", { provider: noteProviderLabel })}
               </span>
             </p>
             <div className="onb-ready__actions">
               <Button
                 variant="live"
                 onClick={props.onDictateNote}
                 disabled={!noteReady}
                 aria-describedby={noteReady ? undefined : "onb-ready-note-reason"}
               >
                 {t("setupFlow.ready.dictateNote")}
               </Button>
               <Button variant="ghost" onClick={props.onOpenWorkspace}>
                 {t("setupFlow.ready.openWorkspace")}
               </Button>
             </div>
             {noteReady ? null : note.status === "checking" ? (
               <p id="onb-ready-note-reason" className="onb-muted" role="status">
                 {t("setupFlow.ready.noteChecking")}
               </p>
             ) : (
               <p id="onb-ready-note-reason" className="onb-muted">
                 {t(`setupFlow.ready.noteBlocked.${note.block}`, { provider: noteProviderLabel })}{" "}
                 <Button size="sm" variant="link" onClick={fixNote}>
                   {t("setupFlow.ready.fixNote")}
                 </Button>
               </p>
             )}
           </div>
         </section>
         <PrivacyDefaults platform={platform} {...privacy} />
       </>
     );
   }
   ```

   `configured` rows are buttons, so "Try it" is one click away. Only proven and optional rows are static.

4. Apply the **[T18]** blocks of the composition, and make the deletions listed under Files. On Ready, `primary`, `onSkip` and `finishLater` are all `undefined`. `Props.onComplete` already takes `OnboardingCompleteOptions` (Task 11), and `finish` forwards it unchanged (I11).

5. In `src/AppRouter.jsx`:
   - Add `import { setAfterSetupIntent } from "./utils/afterSetupIntent";`.
   - Change the `onComplete` prop to:

   ```jsx
                 onComplete={(options) => {
                   localStorage.setItem("onboardingCompleted", "true");
                   window.electronAPI?.updates?.completeSetup();
                   if (options?.next) setAfterSetupIntent(options.next);
                   setShowOnboarding(false);
                 }}
   ```

6. In `src/components/ControlPanel.tsx`:
   - Add `import { takeAfterSetupIntent } from "../utils/afterSetupIntent";`.
   - Directly after `handleNewNote` (139-143), add:

   ```tsx
     // Setup's Ready step (ONB-R8 A): open a new note with its recorder running,
     // or the exact Settings page a pending row or the note action points to.
     useEffect(() => {
       const intent = takeAfterSetupIntent();
       if (!intent) return;
       if (intent.kind === "dictate-note") {
         void handleNewNote();
       } else {
         setSettingsSection(intent.path);
         setShowSettings(true);
       }
     }, [handleNewNote]);
   ```

   - `createNote` already starts recording for a new note (`src/hooks/useCreateNote.ts:50-51`).
   - Plan 03's `SettingsModal` accepts a `settingsPath` as its section, which is what the pre-flight checks.
   - Plan 06 rewrites `ControlPanel`, and this effect is the whole contact surface. Keep it next to `handleNewNote` so Plan 06 carries it.

7. Delete the files and the CSS rule listed under Files. Then append to `src/styles/onboarding.css`:

   ```css
   .onb-ready__title {
     margin: 0;
     font-size: 22px;
     font-weight: 650;
     animation: onb-fade var(--motion-fast) var(--motion-ease-std) both;
   }

   .onb-ready-list {
     display: grid;
     margin: 0;
     padding: 0;
     list-style: none;
     border: 1px solid var(--color-border);
     border-radius: 10px;
   }

   .onb-ready-list li + li {
     border-top: 1px solid var(--color-border);
   }

   .onb-ready-row {
     display: grid;
     grid-template-columns: 22px minmax(0, 1fr) auto;
     align-items: center;
     gap: 12px;
     width: 100%;
     min-height: 52px;
     padding: 8px 14px;
     border: 0;
     background: none;
     color: var(--color-foreground);
     font-size: 14px;
     text-align: start;
   }

   button.onb-ready-row {
     cursor: pointer;
   }

   button.onb-ready-row:hover {
     background: var(--color-muted);
   }

   .onb-ready-row__icon {
     display: grid;
     place-items: center;
     width: 22px;
     height: 22px;
     border-radius: 50%;
     transition: transform var(--motion-fast) var(--motion-spring-snap);
   }

   .onb-ready-row__icon svg {
     width: 14px;
     height: 14px;
   }

   .onb-ready-row__icon[data-status="ready"] {
     background: color-mix(in oklab, var(--color-success) 14%, transparent);
     color: var(--color-success);
   }

   .onb-ready-row__icon[data-status="configured"] {
     background: var(--color-muted);
     color: var(--color-success);
   }

   .onb-ready-row__icon[data-status="pending"] {
     background: color-mix(in oklab, var(--color-warning) 16%, transparent);
     color: var(--color-warning);
   }

   .onb-ready-row__icon[data-status="optional"] {
     background: var(--color-muted);
     color: var(--color-muted-foreground);
   }

   .onb-ready-row__name {
     font-weight: 600;
   }

   /* Status words stay in text colours: success and warning are ~3.2:1 on white. */
   .onb-ready-row__status {
     font-size: 13px;
     color: var(--color-muted-foreground);
   }

   .onb-ready__note {
     display: grid;
     gap: 8px;
   }

   .onb-ready__actions {
     display: flex;
     flex-wrap: wrap;
     gap: 8px;
   }
   ```

8. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "ready": {
         "titleProven": "You're dictating.",
         "titleConfigured": "You're set up. Try it once to be sure.",
         "titlePending_one": "Almost set: {{count}} thing left.",
         "titlePending_other": "Almost set: {{count}} things left.",
         "subAllLocalMac": "Your first dictation worked. Everything runs on this Mac.",
         "subAllLocalOther": "Your first dictation worked. Everything runs on this computer.",
         "subProven": "Your first dictation worked.",
         "subConfigured": "Nothing has been tested yet. Say something to check it works.",
         "subPending": "Finish these and you're ready. Each one opens where it's fixed.",
         "rows": { "speech": "Voice", "microphone": "Microphone", "shortcut": "Shortcut", "cleanup": "Cleanup" },
         "details": {
           "speech": {
             "proven": "{{voice}}, heard your first dictation",
             "checking": "Checking…",
             "configured": "{{voice}}, not tried yet",
             "downloading": "Still downloading",
             "needsModel": "Download a voice",
             "unavailable": "Finish setting it up in Settings"
           },
           "microphone": {
             "heard": "Working",
             "allowed": "Allowed, not heard yet",
             "denied": "Allow in System Settings",
             "untested": "Say something to test it"
           },
           "shortcut": {
             "proven": { "tap": "{{key}}, tap to start and stop", "push": "{{key}}, hold to talk" },
             "configured": { "tap": "{{key}}, not tried yet", "push": "{{key}}, not tried yet" },
             "needsAccessibility": "Grant Accessibility",
             "checkAccessibility": "Check Accessibility access"
           },
           "cleanup": {
             "off": "Off. Add it later",
             "ready": "On with {{name}}",
             "checking": "Still checking",
             "needsConnection": "Connect ChatGPT",
             "needsKey": "Add your {{provider}} key in Settings",
             "needsModel": "Download the local model in Settings",
             "unreachable": "Can't reach {{provider}}"
           }
         },
         "dictateNote": "Dictate into a note",
         "openWorkspace": "Open workspace",
         "noteLocal": "Notes are transcribed on this device.",
         "noteSends": "Notes send audio to {{provider}}.",
         "noteChecking": "Checking how notes are transcribed…",
         "noteBlocked": {
           "microphone": "Notes need your microphone.",
           "unsupported": "Note recording is set to a service notes can't use yet, such as a self-hosted server.",
           "sealed": "Sealed mode is on, so note recording can't reach {{provider}}.",
           "needsModel": "Note recording needs a voice model on this device.",
           "needsKey": "Note recording needs your {{provider}} key.",
           "needsUrl": "Note recording needs a server address.",
           "unreachable": "Loqui can't reach {{provider}} for note recording."
         },
         "fixNote": "Fix this"
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

   Delete the now-unused `setupFlow.rail.finish.openWorkspace` key from every locale. Keep `setupFlow.rail.finish.title` and the `body*` keys, because the rail still uses them.

   ```bash
   node -e 'const fs=require("fs"),p=require("path");for(const l of fs.readdirSync("src/locales")){const f=p.join("src/locales",l,"translation.json");if(!fs.existsSync(f))continue;const j=JSON.parse(fs.readFileSync(f,"utf8"));delete j.setupFlow?.rail?.finish?.openWorkspace;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- "test/utils/onboarding*.test.js" "test/components/onboarding*.test.js" test/components/personalWorkspace.test.js && npm run typecheck && npm run lint && npm run i18n:check`

Expected: PASS. The flow walk (Task 11) now ends through Ready's "Open workspace".

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingReadiness.ts src/utils/afterSetupIntent.ts src/components/onboarding/ReadyStep.tsx src/components/OnboardingFlow.tsx src/AppRouter.jsx src/components/ControlPanel.tsx src/styles/onboarding.css src/locales test/utils/onboardingReadiness.test.js test/components/onboardingReady.test.js test/components/onboardingNoPreviewBranches.test.js test/components/onboardingFlow.test.js test/components/onboardingShell.test.js
git rm src/styles/onboarding-welcome.css src/styles/onboarding-guided.css
git commit -m "feat(onboarding): honest Ready summary, route-checked note action and Settings hand-offs"
```

---

### Task 19: Resume card and in-app restart

Covers ONB-Q10 and the R2 B note that "phase 2 must also live in the resume card".

**Files:**
- Modify: `src/hooks/useStartOnboarding.ts`. Rewrite all 12 lines.
- Modify: `src/AppRouter.jsx`. Touch `MainApp` (43-80): it listens for the start event and remounts `OnboardingFlow` at the requested step.
- Modify: `src/preview/BrowserPreview.tsx`. The same listener drives `updateConfig`.
- Modify: `src/components/FinishDictationSetupCard.tsx`. Rewrite all 81 lines.
- Test: rewrite `test/hooks/useStartOnboarding.test.js`. Create `test/components/finishDictationSetupCard.test.js`.

**Interfaces:**
- Consumes `isOnboardingStep` (Task 1) and `phaseOf` (Task 1).
- Produces in `src/hooks/useStartOnboarding.ts`:

  ```ts
  export const START_ONBOARDING_EVENT = "loqui:start-onboarding";
  export interface StartOnboardingDetail { step?: OnboardingStep }
  export function requestStartOnboarding(step?: unknown): void;     // non-step values (e.g. a click event) mean "resume"
  export function useStartOnboarding(): (step?: unknown) => void;   // unchanged call sites keep working
  export function useStartOnboardingListener(handler: (step?: OnboardingStep) => void): void;
  ```

- Existing callers keep `onClick={startOnboarding}`: `SettingsPage.tsx:1092`, `settings/MeetingSettings.tsx:36` and `settings/UploadSettings.tsx:14`. They now restart in-app, with no reload. Plan 03 owns Settings and can pass `"cleanup"` to deep-link "Make it yours".

- [ ] **Step 1: Write the failing tests**

Replace the body of `test/hooks/useStartOnboarding.test.js` after the requires with:

```js
async function mountHook(t, { initialStorage, preview = false } = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const events = [];
  let reloads = 0;
  const { storage } = installBrowserGlobals(t, {
    initialStorage,
    window: {
      loquiBrowserPreview: preview || undefined,
      dispatchEvent: (event) => events.push(event),
      location: {
        reload() {
          reloads += 1;
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "openwhispr-use-start-onboarding-test-" });
  const { useStartOnboarding, START_ONBOARDING_EVENT } = await vite.ssrLoadModule("/hooks/useStartOnboarding.ts");
  let startOnboarding;
  function Harness() {
    startOnboarding = useStartOnboarding();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return { start: (step) => startOnboarding(step), events, storage, reloads: () => reloads, START_ONBOARDING_EVENT };
}

// Restarting onboarding used to arm `pendingCloudMigration`, which a ControlPanel
// effect consumed after sign-in to force cloud routing (#2086). Restarting only
// clears the completion flag; routing stays onboarding's to decide.
test("restarting setup happens in-app, with no reload and no cloud switch", async (t) => {
  const hook = await mountHook(t, {
    initialStorage: { onboardingCompleted: "true", transcriptionMode: "local", useLocalWhisper: "true" },
  });
  hook.start();
  assert.equal(hook.reloads(), 0);
  assert.equal(hook.events.length, 1);
  assert.equal(hook.events[0].type, hook.START_ONBOARDING_EVENT);
  assert.equal(hook.events[0].detail.step, undefined);
  assert.equal(hook.storage.getItem("onboardingCompleted"), null);
  assert.equal(hook.storage.getItem("pendingCloudMigration"), null);
  assert.equal(hook.storage.getItem("transcriptionMode"), "local");
  assert.equal(hook.storage.getItem("useLocalWhisper"), "true");
});

test("a step deep-links; a click event passed by onClick does not", async (t) => {
  const hook = await mountHook(t);
  hook.start("cleanup");
  hook.start({ type: "click" });
  hook.start("nonsense");
  assert.deepEqual(hook.events.map((event) => event.detail.step), ["cleanup", undefined, undefined]);
});

test("the preview restarts without touching the completion flag", async (t) => {
  const hook = await mountHook(t, { initialStorage: { onboardingCompleted: "true" }, preview: true });
  hook.start("try");
  assert.equal(hook.storage.getItem("onboardingCompleted"), "true");
  assert.equal(hook.events[0].detail.step, "try");
});
```

Create `test/components/finishDictationSetupCard.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const progress = (step) => JSON.stringify({ version: 2, step, explored: true, completed: false, visited: ["welcome", step] });

async function card(t, step) {
  const ui = await mountComponent(t, "/components/FinishDictationSetupCard.tsx", {
    storage: { "loqui.onboarding.progress": progress(step) },
  });
  const events = [];
  globalThis.window.dispatchEvent = (event) => events.push(event);
  return { ui, events };
}

test("unfinished items are neutral links that resume at their own step", async (t) => {
  const { ui, events } = await card(t, "speech");
  const rows = ui.byAttr("data-row-step");
  assert.deepEqual(rows.map((row) => row.attributes["data-row-step"]), ["speech", "cleanup", "shortcuts"]);
  assert.equal(ui.byAttr("data-icon", "check").length + ui.byAttr("data-icon", "circle-check").length, 0, "no checkmarks on unfinished work");
  await ui.click(rows[1]);
  assert.equal(events[0].detail.step, "cleanup");
});

test("after the first dictation, only Make it yours items remain", async (t) => {
  const { ui, events } = await card(t, "cleanup");
  assert.deepEqual(ui.byAttr("data-row-step").map((row) => row.attributes["data-row-step"]), ["cleanup", "shortcuts"]);
  await ui.click("setupFlow.resume.resume");
  assert.equal(events[0].detail.step, "cleanup");
});

test("the app router remounts setup at the requested step", () => {
  const router = fs.readFileSync(path.join(__dirname, "../../src/AppRouter.jsx"), "utf8");
  assert.match(router, /useStartOnboardingListener\(/);
  assert.match(router, /<OnboardingFlow[\s\S]*?key=\{onboardingStart\.key\}[\s\S]*?initialStep=\{onboardingStart\.step\}/);
  const preview = fs.readFileSync(path.join(__dirname, "../../src/preview/BrowserPreview.tsx"), "utf8");
  assert.match(preview, /useStartOnboardingListener\(/);
});
```

`data-icon` is the attribute `createIcon` puts on every icon (`src/components/icons/createIcon.tsx:17`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/hooks/useStartOnboarding.test.js test/components/finishDictationSetupCard.test.js`

Expected: FAIL. The hook still reloads, and the card rows are not links.

- [ ] **Step 3: Implement**

1. Replace `src/hooks/useStartOnboarding.ts`:

   ```ts
   import { useCallback, useEffect, useRef } from "react";
   import { isOnboardingStep, type OnboardingStep } from "../utils/onboardingState";

   export const START_ONBOARDING_EVENT = "loqui:start-onboarding";

   export interface StartOnboardingDetail {
     step?: OnboardingStep;
   }

   /**
    * Repeat local setup without a reload, so in-memory work survives (ONB-Q10).
    * Notes and credentials are untouched; only the completion flag is cleared.
    * Anything that is not a step (onClick passes its event) means "resume".
    */
   export function requestStartOnboarding(step?: unknown): void {
     const detail: StartOnboardingDetail = { step: isOnboardingStep(step) ? step : undefined };
     if (!window.loquiBrowserPreview) localStorage.removeItem("onboardingCompleted");
     window.dispatchEvent?.(new CustomEvent<StartOnboardingDetail>(START_ONBOARDING_EVENT, { detail }));
   }

   export function useStartOnboarding(): (step?: unknown) => void {
     return useCallback((step?: unknown) => requestStartOnboarding(step), []);
   }

   export function useStartOnboardingListener(handler: (step?: OnboardingStep) => void): void {
     const handlerRef = useRef(handler);
     handlerRef.current = handler;
     useEffect(() => {
       const listener = (event: Event) => handlerRef.current((event as CustomEvent<StartOnboardingDetail>).detail?.step);
       window.addEventListener(START_ONBOARDING_EVENT, listener);
       return () => window.removeEventListener(START_ONBOARDING_EVENT, listener);
     }, []);
   }
   ```

2. In `src/AppRouter.jsx` `MainApp`:
   - Add `import { useStartOnboardingListener } from "./hooks/useStartOnboarding";`.
   - Add after the `showOnboarding` state:

   ```jsx
     const [onboardingStart, setOnboardingStart] = useState({ step: undefined, key: 0 });
     useStartOnboardingListener((step) => {
       setOnboardingStart((current) => ({ step, key: current.key + 1 }));
       setShowOnboarding(true);
     });
   ```

   - Pass `key={onboardingStart.key}` and `initialStep={onboardingStart.step}` to `<OnboardingFlow …>`. Keep Task 18's `onComplete` body, including `if (options?.next) setAfterSetupIntent(options.next);`.
   - The existing effect calls `setOnboardingActive(true)` when `showOnboarding` flips. The overlay window sees `onboardingCompleted` removed through the `storage` event, so it returns to trial mode (Task 5).

3. In `src/preview/BrowserPreview.tsx`:
   - Add `useStartOnboardingListener((step) => updateConfig({ step: step ?? "welcome" }));` after `updateConfig` is defined.
   - Import `useStartOnboardingListener` from `../hooks/useStartOnboarding`.

4. Replace `src/components/FinishDictationSetupCard.tsx`:

   ```tsx
   import { useState } from "react";
   import { useTranslation } from "react-i18next";
   import { useStartOnboarding } from "../hooks/useStartOnboarding";
   import { Circle, CircleAlert, X } from "./icons";
   import { Button } from "./ui/button";
   import { cn } from "./lib/utils";
   import { phaseOf } from "../utils/onboardingFlow";
   import {
     onboardingPreviewStorageKey,
     readOnboardingProgress,
     type OnboardingStep,
   } from "../utils/onboardingState";

   /** Workspace reminder for people who left setup early (ONB-Q10): every row is a link. */
   export default function FinishDictationSetupCard() {
     const { t } = useTranslation();
     const previewConfig = window.loquiBrowserPreview ? window.loquiBrowserPreviewConfig : undefined;
     const progressStorageKey = previewConfig ? onboardingPreviewStorageKey(previewConfig) : undefined;
     const dismissedStorageKey = progressStorageKey
       ? `${progressStorageKey}.checklistDismissed`
       : "loqui.onboarding.checklistDismissed";
     const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissedStorageKey) === "true");
     const progress = readOnboardingProgress(progressStorageKey);
     const startOnboarding = useStartOnboarding();

     if (dismissed || progress.completed || !localStorage.getItem(progressStorageKey ?? "loqui.onboarding.progress")) {
       return null;
     }

     const items: Array<[string, OnboardingStep]> = [
       ...(phaseOf(progress.step) === "dictate" ? [["finishDictating", progress.step] as [string, OnboardingStep]] : []),
       ["cleanup", "cleanup"],
       ["shortcut", "shortcuts"],
     ];

     return (
       <div className={cn("mx-auto mb-3 w-full max-w-3xl rounded-xl border border-border bg-card p-4", "px-6")}>
         <div className="flex items-start gap-3">
           <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
           <div className="min-w-0 flex-1">
             <div className="flex items-start justify-between gap-3">
               <div>
                 <p className="text-sm font-semibold">{t("setupFlow.resume.title")}</p>
                 <p className="mt-1 text-xs text-muted-foreground">{t("setupFlow.resume.body")}</p>
               </div>
               <button
                 type="button"
                 aria-label={t("setupFlow.resume.dismiss")}
                 className="rounded p-1 text-muted-foreground hover:bg-muted"
                 onClick={() => {
                   localStorage.setItem(dismissedStorageKey, "true");
                   setDismissed(true);
                 }}
               >
                 <X className="h-4 w-4" />
               </button>
             </div>
             <ul className="mt-3 space-y-1">
               {items.map(([key, step]) => (
                 <li key={key}>
                   <button
                     type="button"
                     data-row-step={step}
                     className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-foreground hover:bg-muted"
                     onClick={() => startOnboarding(step)}
                   >
                     <Circle aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                     {t(`setupFlow.resume.items.${key}`)}
                   </button>
                 </li>
               ))}
             </ul>
             <Button size="sm" className="mt-4" onClick={() => startOnboarding(progress.step)}>
               {t("setupFlow.resume.resume")}
             </Button>
           </div>
         </div>
       </div>
     );
   }
   ```

   The card no longer uses orange (`border-primary`, `bg-primary/5`). It is not a voice control (D1), so it uses neutral card tokens.

5. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "resume": {
         "title": "Finish setting up",
         "body": "Your workspace is ready. Pick up where you left off whenever you like.",
         "items": {
           "finishDictating": "Get your first dictation working",
           "cleanup": "Choose text cleanup",
           "shortcut": "Try your shortcut"
         },
         "resume": "Resume setup",
         "dismiss": "Dismiss setup checklist"
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/hooks/useStartOnboarding.test.js test/components/finishDictationSetupCard.test.js test/components/onboardingFlow.test.js && npm run typecheck && npm run i18n:check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStartOnboarding.ts src/AppRouter.jsx src/preview/BrowserPreview.tsx src/components/FinishDictationSetupCard.tsx src/locales test/hooks/useStartOnboarding.test.js test/components/finishDictationSetupCard.test.js
git commit -m "feat(onboarding): resume setup in-app at the step you left"
```

---

### Task 20: Translate `setupFlow` into the ten other locales

Covers §4, "every visible string goes through i18n". Earlier tasks left English placeholders in `ar de es fr it ja pt ru zh-CN zh-TW`. This task replaces them, and its test fails while any placeholder remains.

**Files:**
- Modify: `src/locales/{ar,de,es,fr,it,ja,pt,ru,zh-CN,zh-TW}/translation.json`. Change the `setupFlow` object only.
- Test: `test/locales/setupFlowTranslated.test.js`

**Interfaces:** none. Strings only.

- [ ] **Step 1: Write the failing test**

Create `test/locales/setupFlowTranslated.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const localesDir = path.join(__dirname, "../../src/locales");
const read = (locale) => JSON.parse(fs.readFileSync(path.join(localesDir, locale, "translation.json"), "utf8"));

function flatten(object, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(object ?? {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, name, out);
    else out[name] = value;
  }
  return out;
}

// Values that are legitimately identical in every language: product names and
// strings with no words once placeholders are removed.
const SAME_EVERYWHERE = new Set(["cleanup.options.codex", "tour.privacy.nodes.loqui"]);
const hasWords = (value) => /\p{L}{2,}/u.test(value.replace(/\{\{[^}]+\}\}/g, ""));

test("every setup string is translated in every locale", () => {
  const english = flatten(read("en").setupFlow);
  const locales = fs.readdirSync(localesDir).filter((name) => name !== "en" && fs.existsSync(path.join(localesDir, name, "translation.json")));
  assert.equal(locales.length, 10);
  const untranslated = [];
  for (const locale of locales) {
    const values = flatten(read(locale).setupFlow);
    for (const [key, value] of Object.entries(english)) {
      const base = key.replace(/_(zero|one|two|few|many|other)$/, "");
      if (SAME_EVERYWHERE.has(base) || !hasWords(value)) continue;
      const candidates = Object.entries(values).filter(([name]) => name === key || name.startsWith(`${base}_`));
      for (const [name, translated] of candidates) {
        if (translated === value || translated === english[`${base}_other`]) untranslated.push(`${locale}: setupFlow.${name}`);
      }
    }
  }
  assert.deepEqual(untranslated, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/locales/setupFlowTranslated.test.js`

Expected: FAIL. It lists every placeholder (several hundred lines).

- [ ] **Step 3: Translate**

For each of the ten locales, replace every English value under `setupFlow` with a translation. Write the result with `JSON.stringify(json, null, 2)`, then run `npx prettier --write "src/locales/**/translation.json"`.

Rules:
- Keep every `{{placeholder}}` exactly. `npm run i18n:check` enforces it.
- **Plurals.** Fill every category the merger created for the locale:
  - `ar`: zero, one, two, few, many, other;
  - `ru`: one, few, many, other;
  - `ja`, `zh-CN`, `zh-TW`: other only;
  - the rest: one, other.
  - Use `{{count}}` in every non-trivial form.
- **Mac versus Other.** `…Mac` keys say the platform's name for a Mac. `…Other` keys use the locale's ordinary word for "computer".
- **Glossary.** Keep the existing translations of these terms from each locale file so setup matches the app:
  - "Loqui" (never translated);
  - "dictation" (`onboarding.*` and `settingsPage.*`);
  - "shortcut" (`hotkeyInput.*`);
  - "cleanup" (`settingsPage.*` cleanup labels);
  - "Accessibility" and "System Settings" (Apple's localized names);
  - "On this device" (Plan 01 `locality.device`).
- **Adapt, do not copy, the sample sentences.** These are translated like everything else, but as samples rather than word for word:
  - `cleanup.example.original` is spoken English with fillers. Write natural spoken text with fillers in the target language. Then write the three `cleanup.example.*` cleaned versions from that sentence, so the diff still highlights real changes.
  - `tour.demo.raw` and `tour.demo.final` follow the same rule.
  - Only `SAME_EVERYWHERE` keys stay in English.
- Use logical, direction-neutral phrasing for `ar`. No "left" or "right" in copy.
- Do not touch keys outside `setupFlow`.

A model-assisted pass is fine. A human reviewer who reads the language should spot-check `ar`, `ja` and `zh-TW` before the PR, and the PR description should say who did.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/locales/setupFlowTranslated.test.js && npm run i18n:check`

Expected: PASS, and `[i18n] Locale keys and placeholders are consistent.`

- [ ] **Step 5: Commit**

```bash
git add src/locales test/locales/setupFlowTranslated.test.js
git commit -m "i18n(onboarding): translate the setup flow into all locales"
```

---

### Task 21: Whole-plan verification

**Files:** none new. This task runs every check and fixes what they surface. If Plan 04 is already on `main`, run Task 22 first (§3: the plan that merges second wires the Undo bridge).

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.css" \
  -e "onboarding-guided" -e "onboarding-welcome" -e "WelcomeScreen" -e "BrowserTrial" -e "DesktopTrial" src
```

Expected:
- every command passes;
- the last grep prints nothing.

The grep covers runtime source only. Tests such as `onboardingNoPreviewBranches.test.js` name the deleted files on purpose, to assert that they are gone (M05).

A failing pre-existing test may be updated in this branch only when it asserted the old setup:
- the step order;
- the "Explore first" or "A quieter way to get words out" copy;
- the reload in `useStartOnboarding`;
- the legacy speech model list in `personalWorkspace`.

List each one in the PR description. Treat any other failure as a regression and fix the code.

- [ ] **Step 2: Browser preview pass**

Run `npm run dev:renderer`, then open `http://127.0.0.1:5183/?preview=onboarding`. Use the toolbar to walk each scenario across the steps it affects. Check each at:
- 1440×900, 900×640 and 640×560;
- 200% zoom (Cmd/Ctrl + `+` to 200%) at 1440×900. That is a 720×450 CSS viewport (M04).

Do this in light and in Plum Night, and take a screenshot for each row:

| Scenario | Check |
|---|---|
| `fresh` | Hello asks for the mic. Voice picks Fast and English and writes nothing until Download. Download starts the tour with the real progress row (percent, MB/s, received/total, Cancel). At 100% the stage pops to "Ready. Say something." Hold shortcut fills the field, the bars settle, the bubble draws, the mark docks, and the band appears. The mark stays docked on Cleanup. |
| `multilingual` | Voice says "…uses Spanish and English" and picks Many languages. Switching the language to Hebrew clears the voice, disables the primary and says why. |
| `low-disk` | Voice shows the disk note with real numbers. |
| `downloading` | Say something opens straight onto the tour with the progress row already counting. The language picker on Voice is locked, with its reason. |
| `download-interrupted` | The row says "Download stopped at 35%. Your progress is kept." with Retry. The tour stays. Continue still works. Retry resumes from 35%. |
| `microphone-denied` | Hello shows one recovery card. The trial fails with the mic card. Ready's note action says notes need the microphone. |
| `nothing-heard` | The silence hint appears after 2.5 s. Stop gives "We didn't hear anything", and "Change microphone" returns to Hello's picker. |
| `insufficient-memory` | The trial offers "Choose another voice". |
| `cleanup-failed` | The success shows the raw words with Retry cleanup and Turn cleanup off. A second failure says "Cleanup still didn't run." |
| `accessibility-missing` (macOS) | The trial and Shortcut show Grant access. "Use a button instead" works. Ready lists the shortcut as pending. |
| `codex-missing`, `codex-expired`, `invalid-provider-key` | Cleanup's ChatGPT and API key options say "Example text. Nothing was sent." The Now line names the missing connection or key, and Ready lists cleanup as pending with a Settings link. |
| `ready` | Without a trial, Ready says "You're set up. Try it once to be sure." After a trial, it says "You're dictating." "Dictate into a note" is live and says where notes are transcribed. |

Then repeat `fresh` with each of these, and screenshot them too:
- **OS reduced motion on:** no tour auto-advance, no idle breathe, a static keycap, an instant dock, and numeric captions throughout.
- **The `ar` locale:** RTL. Progress arrows, tour arrows and radio arrow keys follow reading order, the band buttons sit at the inline end, and the macOS traffic-light inset stays on the physical left.
- **The `de` and `ru` locales (M04):** the long labels are the stress test. Check that:
  - the header progress label ellipsizes rather than wrapping;
  - the footer chip truncates;
  - footer actions wrap to at most two rows;
  - no button text is clipped at 640×560 or at 200% zoom.

- [ ] **Step 3: Desktop pass (privacy and the real shortcut)**

```bash
npm run native:electron
npm run dev
```

Use a fresh test profile, never a personal profile. Turn **History on** (`dataRetentionEnabled`) before setup, so the privacy checks exercise the writers. Then, on macOS:

1. **Hello.** Allow the mic. The meter moves with your voice. Pick a different input in the picker (for example, AirPods), and the meter follows it. Press Continue while the picker is still opening: the macOS mic indicator turns off (I01). After setup, dictate once and confirm Settings → Microphone shows the same device.
2. **Voice.** Start from a profile whose dictation is set to a self-hosted server. Press Download. After setup, Settings → Dictation shows the local voice, not the server (I02).
3. **Say something.** If Accessibility is granted, press **fn**:
   - the keycap presses;
   - the rail follows your voice;
   - your words appear;
   - "Shortcut works" shows;
   - the mark docks.
4. **Privacy check (C01, Review Focus 1).** With History on:
   - With a text editor focused behind Loqui, press fn and speak. Nothing is pasted into the editor.
   - Start a second take and press Esc mid-recording. Then start a third and press Esc while it says "Writing it down…".
   - Finish setup and open History. None of the three trial takes is there, and neither are their audio files. The discarded-recordings list is empty too.
5. **Leaving mid-take (Review Focus 2).** Leave Say something mid-recording with Back. The mic indicator turns off, and nothing appears later.
6. **Kept progress (owner decision 3).** Start a voice download. Turn Wi-Fi off until the row says "Download stopped at N%. Your progress is kept." Turn Wi-Fi on and press Retry. The percent continues from N instead of restarting at 0.
7. **Shortcut.** Hold fn for about a second. You see "Hold to talk detected" and Switch. After switching, holding fn dictates in the workspace.
8. **Ready.**
   - "Dictate into a note" opens a new note with its recorder running.
   - On a profile whose Note Recording is self-hosted, the action is disabled with its reason, and "Fix this" opens Settings on Note Recording (I06).
9. **Resume.** From the workspace resume card, click "Choose text cleanup". Setup opens on Cleanup with no window reload.

Repeat steps 1, 3 and 4 on Linux (X11 or GNOME):
- there are no Accessibility rows;
- the default shortcut from `getEffectiveDefaultHotkey` works.

- [ ] **Step 4: Commit any fixes, then prepare the PR**

```bash
git status
git log --oneline main..HEAD
```

Write `pr-body.md` with:
- one line per Task 1–20 commit, plus Task 22's if it ran on this branch;
- links to the spec and this plan;
- the contract change requests and their spec status at `091d198` (all answered), and whether Task 22 ran on this branch or is left to Plan 04;
- the Step 2 and Step 3 screenshots;
- the pre-existing tests updated in Step 1;
- who reviewed the `ar`, `ja` and `zh-TW` strings.

Get the owner's explicit OK before `git push` or `gh pr create`. Publishing is outward-facing.

### Task 22: Undo with Plan 04 (§5.2 Undo bridge)

**Who runs this task.** Spec §3 runs Plans 04 and 05 in parallel. For the Undo bridge, whichever plan merges second wires the real contract and deletes its fallback. Run this task on whichever branch merges second:
- Plan 05's branch, if Plan 04 is already on `main` when Plan 05 is rebased;
- otherwise Plan 04's branch, as part of its rebase onto Plan 05.

Before that, Plan 05 ships the fallback: a cancel says "Discarded." with no Undo (Tasks 4, 5, 6, 8 and 15).

Pre-flight. All four must print a match:

```bash
grep -n "sendUndoCancelDictation" src/helpers/windowManager.js
grep -n "sanitizeCancelledDemoFields" src/helpers/onboardingInputPolicy.js
grep -n "alsoSentTo" src/helpers/onboardingInputPolicy.js      # §5.2 (ff8c9cd): the sanitiser keeps every RemoteDisclosure field
ls src/types/dictation.ts src/helpers/dictationDisclosure.js
```

If the `alsoSentTo` line prints nothing, the merged Plan 04 sanitiser does not meet §5.2. That sanitiser is Plan 04's code, so stop and have Plan 04's sanitiser task fixed first. Do not weaken this task's contract tests, and do not patch around it in Plan 05.

Covers I09 and I12 in full. It uses the §5.2 shapes exactly:
- the demo events `{ status: "cancelled", sessionId, cancelled: CancelledState }` and `{ status: "cancelClosed", sessionId, reason }`;
- `windowManager.sendUndoCancelDictation(sessionId?) → Promise<UndoResult>`, with `lastCancelledDictation`;
- the disclosure is rendered with Plan 04's `disclosureCopy`.

Plan 05 restates none of these types.

**Files:**
- Modify:
  - `src/helpers/onboardingInputPolicy.js`: spread Plan 04's sanitiser into `sanitizeOnboardingDemoEvent`, unless Task 4 already added it (04-first order). The publish handler stays the single `publishDemoEvent` call from Task 4;
  - `src/types/electron.ts`: the three §5.2 fields on `OnboardingDemoEvent`;
  - `src/hooks/useAudioRecording.js`: delete Task 5's fallback `cancelled` publish. Plan 04's `onCancelledChange` publishes `cancelled` and `cancelClosed`;
  - `src/helpers/audioManager.js`: if Task 5 wrote the bare form (05 merged first), migrate its audio writes to `_setOwnedAudio` (spec §5.2 "Audio ownership", `aad5284`, Plan 04 R3-C1);
  - `src/utils/onboardingTrial.ts`: `cancelled: CancelledState | null`, `cancelClosed`, and `canUndo`;
  - `src/components/onboarding/useTrialSession.ts`: `undo()` and `undoAvailable`;
  - `src/components/onboarding/HotkeyTrial.tsx`: the disclosure and Undo;
  - `src/components/OnboardingFlow.tsx`: the **[T22]** props in the composition;
  - `src/preview/onboardingScenarioBridge.ts`: the preview's Undo, in the same shapes;
- Test:
  - append to `test/helpers/onboardingInputPolicy.test.js`, `test/utils/onboardingTrial.test.js`, `test/components/onboardingTrial.test.js` and `test/preview/onboardingScenarioBridge.test.js`;
  - append to `test/helpers/windowManagerAssistantPanel.test.js`. It already loads the real `WindowManager` with the Electron stubs;
  - in `test/helpers/useAudioRecordingTrialEvents.test.js`, delete "cancelling an active take tells setup it was discarded…". Plan 04's own hook tests cover the publish.

**Interfaces:**
- Consumes:
  - from `src/types/dictation.ts` (Plan 04): `CancelledState`, `UndoResult` and `RemoteDisclosure`;
  - from `src/helpers/dictationDisclosure.js` (Plan 04): `disclosureCopy(disclosure, t)`;
  - from `src/helpers/onboardingInputPolicy.js` (Plan 04): `sanitizeCancelledDemoFields(event)`;
  - from `src/helpers/windowManager.js` (Plan 04): `sendUndoCancelDictation(sessionId?)` and `lastCancelledDictation`. Task 4 already calls them.
- Produces:

  ```ts
  // src/types/electron.ts, on OnboardingDemoEvent
  sessionId?: string; cancelled?: CancelledState; reason?: "expired" | "restored" | "replaced" | "flushed";
  // src/utils/onboardingTrial.ts
  // TrialState gains: cancelled: CancelledState | null
  // TrialInput's event pick gains: "sessionId" | "cancelled" | "reason"
  export function canUndo(state: TrialState, nowMs: number): boolean; // a live window: paused, or before undoUntil
  // useTrialSession adds: undo(): Promise<void>; undoAvailable: boolean
  // HotkeyTrialProps adds: undoAvailable: boolean; onUndo(): void
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/helpers/onboardingInputPolicy.test.js`:

```js
test("the §5.2 cancelled fields pass through Plan 04's sanitiser with every RemoteDisclosure field (R2-I01)", () => {
  const session = { id: "demo-1", kind: "dictation", sawListening: true };
  const windowWith = (alsoSentTo) => ({
    sessionId: "rec-1",
    undoUntil: 9000,
    paused: false,
    remainingMs: 4000,
    remoteAlreadySent: { target: "openai", payload: "text", evidence: "attested", alsoSentTo },
  });
  for (const alsoSentTo of [[], ["anthropic", "host:gpu-box.lan"]]) {
    const cancelled = windowWith(alsoSentTo);
    const out = sanitizeOnboardingDemoEvent({ kind: "dictation", status: "cancelled", sessionId: "rec-1", cancelled, secret: 1 }, session);
    assert.equal(out.sessionId, "rec-1");
    assert.deepEqual(out.cancelled, cancelled, `alsoSentTo ${JSON.stringify(alsoSentTo)} survives the bridge (§5.2, ff8c9cd)`);
    assert.equal("secret" in out, false);
  }
  const closed = sanitizeOnboardingDemoEvent({ kind: "dictation", status: "cancelClosed", sessionId: "rec-1", reason: "expired" }, session);
  assert.deepEqual([closed.status, closed.sessionId, closed.reason], ["cancelClosed", "rec-1", "expired"]);
});
```

Append to `test/utils/onboardingTrial.test.js`:

```js
const undoWindow = (patch = {}) => ({ sessionId: "rec-1", undoUntil: 6000, paused: false, remainingMs: 5000, remoteAlreadySent: null, ...patch });

test("a cancelled take keeps its §5.2 window; Undo is live while it is open or paused", async () => {
  const { canUndo } = await load();
  const state = await play([
    { status: "listening", atMs: 0 },
    { status: "cancelled", sessionId: "rec-1", cancelled: undoWindow(), atMs: 1000 },
  ]);
  assert.equal(state.phase, "cancelled");
  assert.equal(canUndo(state, 5999), true);
  assert.equal(canUndo(state, 6000), false);
  const paused = await play([{ status: "cancelled", sessionId: "rec-1", cancelled: undoWindow({ paused: true, undoUntil: 0 }), atMs: 0 }]);
  assert.equal(canUndo(paused, 99999), true, "the window is frozen while paused");
  const bare = await play([{ status: "cancelled", atMs: 0 }]);
  assert.equal(canUndo(bare, 0), false, "the fallback event has no window");
});

test("cancelClosed ends the window for its own session only", async () => {
  const { canUndo } = await load();
  const open = [{ status: "listening", atMs: 0 }, { status: "cancelled", sessionId: "rec-1", cancelled: undoWindow(), atMs: 1 }];
  const other = await play([...open, { status: "cancelClosed", sessionId: "rec-0", reason: "expired", atMs: 2 }]);
  assert.equal(canUndo(other, 10), true);
  const expired = await play([...open, { status: "cancelClosed", sessionId: "rec-1", reason: "expired", atMs: 2 }]);
  assert.deepEqual([expired.phase, expired.cancelled, canUndo(expired, 10)], ["cancelled", null, false]);
  const restored = await play([
    ...open,
    { status: "cancelClosed", sessionId: "rec-1", reason: "restored", atMs: 2 },
    { status: "processing", atMs: 3 },
  ]);
  assert.deepEqual([restored.phase, restored.cancelled], ["processing", null]);
});
```

Append to `test/components/onboardingTrial.test.js`. First add `cancelled: null,` to the `trialState` defaults, and `undoAvailable: true, onUndo: () => calls.push("undo"),` to `view`'s props. Then append:

```js
const cancelledWindow = (patch = {}) => ({ sessionId: "rec-1", undoUntil: 5000, paused: false, remainingMs: 4000, remoteAlreadySent: null, ...patch });

test("a discarded take offers Undo only while it can work, and says what already left (I09)", async (t) => {
  const disclosure = { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: [] };
  const { ui, calls } = await view(t, {
    trial: trialState({ phase: "cancelled", cancelled: cancelledWindow({ remoteAlreadySent: disclosure }) }),
    nowMs: 1000,
  });
  expectKey(ui, "setupFlow.try.discarded");
  expectKey(ui, "pill.caption.remoteAudio", { provider: "OpenAI" }); // Plan 04's disclosureCopy, through the same i18n mock
  await ui.click("setupFlow.try.undo");
  assert.deepEqual(calls, ["undo"]);
  await ui.rerender({ nowMs: 6000 });
  assert.equal(ui.text().includes("setupFlow.try.undo"), false, "past the deadline");
  await ui.rerender({ nowMs: 1000, undoAvailable: false });
  assert.equal(ui.text().includes("setupFlow.try.undo"), false, "main could not restore the last take");
});

test("a disclosure with several receivers names every one of them (§5.2 alsoSentTo, R2-I01)", async (t) => {
  const disclosure = { target: "openai", payload: "audio", evidence: "attested", alsoSentTo: ["anthropic", "host:gpu-box.lan"] };
  const { ui } = await view(t, {
    trial: trialState({ phase: "cancelled", cancelled: cancelledWindow({ remoteAlreadySent: disclosure }) }),
    nowMs: 1000,
  });
  expectKey(ui, "pill.caption.remoteSeveral");
  for (const name of ["OpenAI", "Anthropic", "gpu-box.lan"]) assert.ok(ui.text().includes(name), name);
});

test("an undo main could not restore hides Undo until the next take (I09)", async (t) => {
  const { box, emit, calls } = await mountSession(t, { undoOnboardingDemoCancel: async () => false });
  await React.act(async () => box.session.toggle());
  const id = calls.find(([name]) => name === "toggle")[1];
  await emit({ demoId: id, kind: "dictation", status: "listening" });
  await emit({ demoId: id, kind: "dictation", status: "cancelled", sessionId: "rec-1", cancelled: cancelledWindow({ undoUntil: Date.now() + 5000 }) });
  assert.equal(box.session.undoAvailable, true);
  await React.act(async () => box.session.undo());
  assert.equal(box.session.undoAvailable, false);
  await emit({ demoId: id, kind: "dictation", status: "listening" });
  assert.equal(box.session.undoAvailable, true);
});
```

Append to `test/preview/onboardingScenarioBridge.test.js`, replacing only Task 8's fallback test. Task 8's processing-cancel and leave/re-enter tests stay, so they run both before and after this task:

```js
test("Undo needs a live cancellation inside its window, in the §5.2 shapes (I12)", async () => {
  const { api, time, events } = await trial("ready");
  assert.equal(await api.undoOnboardingDemoCancel("demo-1"), false, "nothing was cancelled");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  assert.equal(await api.cancelOnboardingDemo("demo-1"), true);
  const opened = events.at(-1);
  assert.equal(opened.status, "cancelled");
  assert.equal(opened.cancelled.sessionId, opened.sessionId);
  time.advance(6000);
  assert.deepEqual([events.at(-1).status, events.at(-1).reason], ["cancelClosed", "expired"]);
  assert.equal(await api.undoOnboardingDemoCancel("demo-1"), false, "the window has expired");
  await api.toggleOnboardingDemo("demo-1");
  time.advance(200);
  await api.cancelOnboardingDemo("demo-1");
  assert.equal(await api.undoOnboardingDemoCancel("demo-1"), true);
  assert.deepEqual(events.slice(-2).map((event) => event.status), ["cancelClosed", "processing"]);
  time.advance(400);
  assert.equal(events.at(-1).status, "success");
});
```

Append to `test/helpers/windowManagerAssistantPanel.test.js`. It drives the real publish path (`publishDemoEvent`, Task 4) and the real `WindowManager`. Only Plan 04's overlay round trip is stubbed, and Plan 04 tests that itself (R2-I02):

```js
const { publishDemoEvent } = require("../../src/helpers/onboardingInputPolicy");

test("publish → cancel → Undo → close: Undo asks for that exact session, and the close clears it (§5.2)", async () => {
  const manager = new WindowManager();
  manager._onboardingDemoKind = "dictation";
  const asked = [];
  manager.sendUndoCancelDictation = async (sessionId) => (asked.push(sessionId), { restored: true, sessionId });
  const session = { id: "demo-1", kind: "dictation" };
  const publish = (event) => publishDemoEvent({ kind: "dictation", ...event }, session, manager);
  const cancelled = { sessionId: "rec-7", undoUntil: Date.now() + 5000, paused: false, remainingMs: 5000, remoteAlreadySent: null };

  publish({ status: "listening" });
  assert.equal(publish({ status: "cancelled", sessionId: "rec-7", cancelled }).sessionId, "rec-7");
  assert.deepEqual(manager.lastCancelledDictation, { sessionId: "rec-7" });
  assert.equal(await manager.undoOnboardingDemoCancel(), true);
  assert.deepEqual(asked, ["rec-7"], "the overlay is asked for the cancelled session, not an unspecified one");
  publish({ status: "cancelClosed", sessionId: "rec-7", reason: "restored" });
  assert.equal(manager.lastCancelledDictation, null);

  manager.sendUndoCancelDictation = async (sessionId) => (asked.push(sessionId), { restored: false, sessionId, reason: "unavailable" });
  assert.equal(await manager.undoOnboardingDemoCancel(), false, "a refused restore reports false");
});
```

This test is the same in both merge orders, because the handler body is `publishDemoEvent` either way (Task 4).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/onboardingInputPolicy.test.js test/utils/onboardingTrial.test.js test/components/onboardingTrial.test.js test/preview/onboardingScenarioBridge.test.js "test/helpers/windowManager*.test.js"`

Expected: FAIL. The cancelled fields are dropped, and `canUndo`, `undo` and the preview's Undo are missing. The WindowManager test may already pass, because Task 4 shipped that method.

- [ ] **Step 3: Implement**

1. In `src/helpers/onboardingInputPolicy.js`, replace the Task 4 marker comment in `sanitizeOnboardingDemoEvent` with:

   ```js
       ...sanitizeCancelledDemoFields(event),
   ```

   `sanitizeCancelledDemoFields` is defined in the same file by Plan 04. §5.2 (ff8c9cd) requires it to keep every `RemoteDisclosure` field, including `alsoSentTo`. This task's tests assert that with `[]` and with two destinations. If they fail, the sanitiser is Plan 04's to fix (see the pre-flight). Do not edit around it here.

   If Plan 04 merged first, Task 4 already added this line. Leave the publish handler as Task 4's single `publishDemoEvent` call.

2. In `src/types/electron.ts`, add `import type { CancelledState } from "./dictation";` and the three `OnboardingDemoEvent` fields listed under Interfaces.

3. **Audio ownership (spec §5.2, `aad5284`).** If Task 5 ran before Plan 04 merged, `audioManager.js` still has its bare writes, and Plan 04's guard test fails on them. Migrate them:
   - `this.lastAudioBlob = audioBlob;` plus its `this.lastAudioBlobPrivate = …` stamp (1447) become `this._setOwnedAudio(audioBlob);`;
   - the same pair for `fallbackBlob` (3935) becomes `this._setOwnedAudio(fallbackBlob);`;
   - in `releasePrivateAudio()`, `this.lastAudioBlob = null;` becomes `this._setOwnedAudio(null);`. `this.lastAudioMetadata = null;` stays;
   - delete Task 5's temporary mutable entry guards from `saveTranscription` and `saveFailedTranscription`. Keep Plan 04's snapshot-based private checks, ownership-safe releases and acknowledged `audioKept` result. Never prepend the old `if (this.lastAudioBlobPrivate)` guard to those methods.

   The setter defaults `private` to the active session's immutable recording-time flag, falling back to `this._recordingPrivate === true` before a session exists, so a delayed save never borrows a newer take's privacy. Task 5's source test switches itself to the setter form once `_setOwnedAudio` exists. It requires both stamps, the conditional snapshot-release helper and `releasePrivateAudio` through the setter, saver calls through `_releaseOwnedAudio`, and no bare write outside the setter. Plan 04's guard test must pass too. Run both plans' private-save suites and Plan 04's deferred-row/deferred-audio-write races: an old public save cannot upload or release a newer private recording in either merge order.

   In `src/hooks/useAudioRecording.js`, delete Task 5's fallback block (the `// §5.2 fallback until Plan 04` comment and its `cancelled` publish) from `cancelRecording` and `cancelProcessing`. Plan 04's `onCancelledChange` already publishes `cancelled` and `cancelClosed` for the same take.

4. In `src/utils/onboardingTrial.ts`:

   ```ts
   import type { CancelledState } from "../types/dictation";
   // TrialState: add `cancelled: CancelledState | null;`. INITIAL_TRIAL_STATE: `cancelled: null`.
   // TrialInput: add "sessionId" | "cancelled" | "reason" to the OnboardingDemoEvent pick.

   // in reduceTrial:
       case "cancelled":
         return { ...state, phase: "cancelled", level: 0, cancelled: input.cancelled ?? null };
       case "cancelClosed":
         if (!state.cancelled || input.sessionId !== state.cancelled.sessionId) return state;
         return { ...state, cancelled: null };

   export function canUndo(state: TrialState, nowMs: number): boolean {
     const open = state.cancelled;
     return state.phase === "cancelled" && open !== null && (open.paused || open.undoUntil > nowMs);
   }
   ```

   `fresh()` already resets to `INITIAL_TRIAL_STATE`, so a new take clears `cancelled`. After `cancelClosed` with `restored`, the `processing` event that follows moves the phase on.

5. In `src/components/onboarding/useTrialSession.ts`:

   ```ts
     const [undoAvailable, setUndoAvailable] = useState(true);
     // in the demo listener, before dispatch:
     //   if (event.status === "listening") setUndoAvailable(true);
     const undo = useCallback(async () => {
       // §5.2: main returns UndoResult.restored. false (expired, busy, sealed, unavailable…)
       // stops offering Undo for this take; Plan 04's notice explains why.
       const restored = await window.electronAPI?.undoOnboardingDemoCancel?.(idRef.current);
       if (!restored) setUndoAvailable(false);
     }, []);
     // return { state, dispatch, toggle, cancel, undo, undoAvailable, readLevel, usedHotkey };
   ```

6. In `src/components/onboarding/HotkeyTrial.tsx`:
   - add `undoAvailable: boolean;` and `onUndo(): void;` to the props;
   - import `canUndo`, and `import { disclosureCopy } from "../../helpers/dictationDisclosure.js";`;
   - replace the Task 15 `cancelled` paragraph with:

   ```tsx
             {trial.phase === "cancelled" ? (
               <p className="onb-field__status">
                 {t("setupFlow.try.discarded")}
                 {trial.cancelled?.remoteAlreadySent ? ` ${disclosureCopy(trial.cancelled.remoteAlreadySent, t)}` : ""}
                 {props.undoAvailable && canUndo(trial, props.nowMs) ? (
                   <Button size="sm" variant="ghost" onClick={props.onUndo}>
                     {t("setupFlow.try.undo")}
                   </Button>
                 ) : null}
               </p>
             ) : null}
   ```

7. Apply the **[T22]** props in the composition's `HotkeyTrial`: `undoAvailable={trialSession.undoAvailable}` and `onUndo={() => void trialSession.undo()}`.

8. In `src/preview/onboardingScenarioBridge.ts`, replace Task 8's fallback `cancelOnboardingDemo` and `undoOnboardingDemoCancel` with:

   ```ts
       const UNDO_MS = 5000;
       let cancelledTake: CancelledState | null = null;
       let takeCount = 0;
       const closeTake = (reason: "expired" | "restored") => {
         if (!cancelledTake) return;
         const { sessionId } = cancelledTake;
         cancelledTake = null;
         emitDemo({ status: "cancelClosed", sessionId, reason });
       };

       cancelOnboardingDemo: async (id: string) => {
         if (session?.id !== id || take === "idle") return false; // recording or processing (R2-I07)
         take = "idle";
         clearTrialTimers();
         const sessionId = `preview-rec-${++takeCount}`;
         cancelledTake = { sessionId, undoUntil: clock.now() + UNDO_MS, paused: false, remainingMs: UNDO_MS, remoteAlreadySent: null };
         emitDemo({ status: "cancelled", sessionId, cancelled: cancelledTake });
         later(UNDO_MS, () => closeTake("expired"));
         return true;
       },
       // Desktop parity (§5.2): Undo exists only for a live cancellation inside its window.
       undoOnboardingDemoCancel: async (id: string) => {
         if (session?.id !== id || !cancelledTake || clock.now() >= cancelledTake.undoUntil) return false;
         closeTake("restored");
         take = "processing";
         emitDemo({ status: "processing" });
         later(PROCESS_MS, () => {
           take = "idle";
           emitDemo({ status: "success", text: PREVIEW_SENTENCE, rawText: PREVIEW_SENTENCE, cleanup: "skipped" });
         });
         return true;
       },
   ```

   Declare `UNDO_MS`, `cancelledTake` and `takeCount` with the other module state, and `closeTake` beside `emitDemo`. Add `cancelledTake = null;` to `endSession()` and `reset()`. Import `type CancelledState` from `../types/dictation`.

9. No new strings. Task 15 added `setupFlow.try.undo` (hidden until now), and Task 20 translated it into all 11 locales (R2-I06). The disclosure sentence is Plan 04's copy (`disclosureCopy`), so do not add a `setupFlow` copy of it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/onboardingInputPolicy.test.js test/utils/onboardingTrial.test.js test/components/onboardingTrial.test.js test/preview/onboardingScenarioBridge.test.js test/helpers/useAudioRecordingTrialEvents.test.js test/helpers/audioManagerPrivateTrial.test.js "test/helpers/windowManager*.test.js" test/locales/setupFlowTranslated.test.js && npm run typecheck && npm run i18n:check && npm test`

The last `npm test` is the full suite. Task 22 is the second merger's integration, so it must leave everything green in whichever order it runs, including the translation check.

Expected: PASS. The private-hold test in `audioManagerPrivateTrial.test.js` now runs instead of skipping. It must pass: an expired private hold is never persisted (§5.2).

Then check on the desktop:
- With a fresh test profile, start the Say something trial and press Esc mid-take. The field says "Discarded." with Undo.
- Press Undo within five seconds. The take resumes as processing and then succeeds.
- Repeat and let the window expire. Undo disappears, and History has no entry for either take.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/onboardingInputPolicy.js src/types/electron.ts src/hooks/useAudioRecording.js src/utils/onboardingTrial.ts src/components/onboarding/useTrialSession.ts src/components/onboarding/HotkeyTrial.tsx src/components/OnboardingFlow.tsx src/preview/onboardingScenarioBridge.ts src/locales test
git commit -m "feat(onboarding): wire the trial's Undo to Plan 04's cross-window bridge"
```

---

## OnboardingFlow composition

This section is the **single authoritative** final shape of `src/components/OnboardingFlow.tsx`. Each block is tagged with the task that introduces it. When a task says "apply the [Tn] blocks", copy those blocks exactly. Earlier blocks are already in place, and later ones do not exist yet.

**Task 11 interim rule.** Until Tasks 12–18 replace them, each `case` in `stepView()` keeps the old body for its step:
- the content is `legacy(<the old content for that step>)`, where `const legacy = (node: ReactNode) => <div className="onboarding-welcome onboarding-guided onb-legacy">{node}</div>;`;
- the rail mode is `{ kind: "idle" }`;
- the primary is `{ label: t("setupFlow.continue"), onClick: advance }`, except on Ready, which uses `t("setupFlow.rail.finish.openWorkspace")` with `finish()`;
- the shell render passes only its `[T11]` props. `footerStart` is Plan 02's `footerStatus` chip node until Task 13, `announcement` arrives with Task 14, and `docked` with Task 15. Each render prop carries its tag.

Task 18 deletes `legacy()` and its CSS.

**Forward references (R2-I08).** Each task copies only lines tagged with its own number or lower; a line tagged with a later task does not exist yet. An audit of every block found two places where an earlier block would reach a later binding. Each has an interim:
- **The shell render (Task 11).** As above: `docked` ([T15]), `announcement` ([T14]) and the `DownloadChip` footer ([T13]) are added by their tasks.
- **The `try` case (Task 14).** Until Task 15, the rail is `{ ...railCopy, mode: downloadRail ?? { kind: "idle" } }` with no `readLevel`. The `TryStage` children are `legacy(<the old try content>)`. `MeetLoquiTour` takes these two bindings, which Task 15 deletes when its block brings `hotkeyLabel` and `activationMode`:

  ```tsx
  const hotkeyLabel = formatHotkeyLabel(useSettingsStore((s) => s.dictationKey) || getDefaultHotkey()); // Task 14 only
  const activationMode = useSettingsStore((s) => s.activationMode);                                     // Task 14 only
  ```

Every other block references only bindings from its own task or earlier, so each task's checkpoint typechecks.

**Existing code that stays.** Some lines of today's file are kept rather than rewritten (old line numbers at `8267276`):
- `cleanupModelCatalog` (131-135);
- the `updates.status()` effect (1116-1124);
- the store selectors `useCleanupModel`, `cleanupMode` and `cleanupProvider` (1060-1067), with `initialCleanupChoice`, `cleanupChoice` and `cleanupStatus` (1079-1091);
- `cleanupRequestRef`, `closedRef` and its effect (1189-1198);
- `chooseCleanup` (1199-1218), changed only as Task 16 says;
- `applyCleanupToOtherTasks` (1220-1249).

Everything else in the old component is deleted by the task that replaces it.

```tsx
// ---------- imports ----------
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";        // [T11]
import { useTranslation } from "react-i18next";                                              // [T11]
import "../styles/onboarding.css";                                                            // [T9]
import { useSettingsStore, selectResolvedLLMConfig, setResolvedLLMConfig, reasoningModelBelongsToProvider } from "../stores/settingsStore";
import { getCachedPlatform } from "../utils/platform";
import { getDefaultHotkey } from "../utils/hotkeys";
import { applyCleanupChoice, type CleanupChoice, type CleanupModelCatalog, type CleanupStatus } from "../utils/onboardingCleanup";
import modelRegistryData from "../models/modelRegistryData.json";
import { pickDefaultModelId } from "../models/providerDefaultModel";
import { markVisited, nextStep, previousStep, type OnboardingCompleteOptions } from "../utils/onboardingFlow"; // [T11]
import {
  onboardingPreviewStorageKey, readOnboardingProgress, writeOnboardingProgress,
  type OnboardingPreviewConfig, type OnboardingStep,
} from "../utils/onboardingState";                                                             // [T11]
import { OnboardingShell, type OnboardingShellProps } from "./onboarding/OnboardingShell";     // [T11]
import type { InstrumentRailProps } from "./onboarding/InstrumentRail";                       // [T11]
import { SETTLE_MS, DRAW_MS, dockMark, type InstrumentMode } from "./onboarding/instrumentMath"; // [T13] InstrumentMode; [T15] the rest
import { micPickerModel, selectionFor, type AudioInput } from "../utils/onboardingMic";       // [T12]
import { HelloStep } from "./onboarding/HelloStep";                                           // [T12]
import { PrivacyDefaults } from "./onboarding/PrivacyDefaults";                               // [T12] (moved into ReadyStep by T18)
import { useMicrophoneAccess } from "./onboarding/useMicrophoneAccess";                       // [T12]
import { useMicLevelPreview } from "./onboarding/useMicLevelPreview";                         // [T12]
import {
  detectVoice, isOnboardingVoice, modelDownloadBytes, reconcileVoice,
  shouldApplyDetectedVoice, spokenLocalesFor, voiceSupportsAll,
} from "../utils/onboardingDetection";                                                         // [T13]
import { byteParts } from "../utils/onboardingDownload";                                       // [T13]
import { useSystemProfile } from "./onboarding/useSystemProfile";                             // [T13]
import { useVoiceDownload } from "./onboarding/useVoiceDownload";                             // [T13]
import { VoiceStep } from "./onboarding/VoiceStep";                                           // [T13]
import { DownloadChip } from "./onboarding/DownloadChip";                                     // [T13]
import { MeetLoquiTour } from "./onboarding/MeetLoquiTour";                                   // [T14]
import { TryStage, usePrefersReducedMotion } from "./onboarding/TryStage";                    // [T14]
import { shouldAnnounceOffStep, voiceFailedNotice, voiceReadyNotice } from "./onboarding/onboardingNotices"; // [T14]
import { useOnboardingNotifier } from "./onboarding/useOnboardingNotifier";                   // [T14]
import { keycapLabel } from "../utils/onboardingShortcut";                                     // [T15]
import { useTrialSession } from "./onboarding/useTrialSession";                               // [T15]
import { useDictationHotkey, useShortcutDemo } from "./onboarding/useDictationHotkey";        // [T15] useDictationHotkey; [T17] useShortcutDemo
import { useAccessibilityGate } from "./onboarding/useAccessibilityGate";                     // [T15]
import { useTicker } from "./onboarding/useTicker";                                           // [T15]
import { runCleanup } from "./onboarding/cleanupRunner";                                      // [T15]
import { HotkeyTrial } from "./onboarding/HotkeyTrial";                                       // [T15]
import { SuccessBand } from "./onboarding/SuccessBand";                                       // [T15]
import { useResolvedRoute } from "../lib/routes";                                             // [T16]
import { providerDisplayLabel } from "../lib/locality";                                      // [T16]
import { CleanupStep } from "./onboarding/CleanupStep";                                       // [T16]
import { useHotkeyModeInfo } from "../hooks/useHotkeyModeInfo";                              // [T17]
import { ShortcutStep } from "./onboarding/ShortcutStep";                                     // [T17]
import { noteActionState, summarizeReadiness } from "../utils/onboardingReadiness";          // [T18]
import { ReadyStep } from "./onboarding/ReadyStep";                                           // [T18]

// ---------- module scope ----------
// const cleanupModelCatalog: CleanupModelCatalog = …   (unchanged, old 131-135)

interface Props {                                                                            // [T11]
  onComplete: (options?: OnboardingCompleteOptions) => void;
  onExplore?: () => void;
  initialStep?: OnboardingStep;
  previewConfig?: OnboardingPreviewConfig;
}

type Platform = "darwin" | "linux" | "win32";

interface StepView {                                                                         // [T11]
  rail: InstrumentRailProps;
  primary?: OnboardingShellProps["primary"];
  onSkip?: () => void;
  finishLaterLabel?: string;
  content: ReactNode;
}

export default function OnboardingFlow({ onComplete, onExplore, initialStep, previewConfig }: Props) {
  // [T11] navigation and persistence
  const { t } = useTranslation();
  const config = previewConfig; // storage namespacing only; behaviour never branches on the preview
  const progressStorageKey = config ? onboardingPreviewStorageKey(config) : undefined;
  const storedProgress = useMemo(() => readOnboardingProgress(progressStorageKey), [progressStorageKey]);
  const firstStep = initialStep ?? config?.step ?? storedProgress.step;
  const [step, setStep] = useState<OnboardingStep>(firstStep);
  const [visited, setVisited] = useState<OnboardingStep[]>(() => markVisited(storedProgress.visited, firstStep));
  const platform: Platform =
    config?.platform === "macos" ? "darwin" : config?.platform === "linux" ? "linux" : (getCachedPlatform() as Platform);
  const device = platform === "darwin" ? "Mac" : "Other";

  useEffect(() => {
    writeOnboardingProgress({ step, visited }, progressStorageKey);
  }, [progressStorageKey, step, visited]);

  const goTo = useCallback((next: OnboardingStep) => {
    setStep(next);
    setVisited((current) => markVisited(current, next));
  }, []);
  const finish = useCallback(
    (options?: OnboardingCompleteOptions) => {
      writeOnboardingProgress({ completed: true, step: "finish" }, progressStorageKey);
      onComplete(options);
    },
    [onComplete, progressStorageKey]
  );
  const finishLater = useCallback(() => {
    writeOnboardingProgress({ explored: true, step, visited }, progressStorageKey);
    onExplore?.();
    onComplete();
  }, [onComplete, onExplore, progressStorageKey, step, visited]);
  const skip = () => {
    const next = nextStep(step);
    if (next) goTo(next);
    else finish();
  };
  const back = () => {
    const previous = previousStep(step);
    if (previous) goTo(previous);
  };
  const advance = () => {
    if (step === "cleanup") applyCleanupToOtherTasks();
    skip();
  };

  // [T14] hoisted so every step calls hooks in the same order
  const reducedMotion = usePrefersReducedMotion();

  // [T12] Hello: microphone access, picker, level preview; privacy defaults state
  const mic = useMicrophoneAccess();
  const micMode = useSettingsStore((s) => s.microphoneSelectionMode);
  const micId = useSettingsStore((s) => s.selectedMicDeviceId);
  const micLabel = useSettingsStore((s) => s.selectedMicDeviceLabel);
  const [helloInputs, setHelloInputs] = useState<AudioInput[]>([]);
  const micPicker = micPickerModel(helloInputs, micMode, micId, micLabel);
  const helloPreview = useMicLevelPreview(step === "welcome" && mic.access === "granted", micPicker.previewDeviceId);
  const [micHeard, setMicHeard] = useState(false);
  useEffect(() => setHelloInputs(helloPreview.inputs), [helloPreview.inputs]);
  useEffect(() => {
    if (helloPreview.heardVoice) setMicHeard(true);
  }, [helloPreview.heardVoice]);
  const pickMicrophone = (value: string) => {
    const { mode, device: picked } = selectionFor(value, helloInputs);
    const store = useSettingsStore.getState();
    store.setMicrophoneSelectionMode(mode);
    if (picked) store.setSelectedMicDevice(picked.deviceId, picked.label);
  };
  const dataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const setDataRetentionEnabled = useSettingsStore((s) => s.setDataRetentionEnabled);
  const [updatesEnabled, setUpdatesEnabled] = useState(true);
  // useEffect(() => { … updates.status() → setUpdatesEnabled … }, []);   (unchanged, old 1116-1124)
  const changeUpdates = (value: boolean) => {
    setUpdatesEnabled(value);
    void window.electronAPI?.updates?.preferences?.({ enabled: value });
  };

  // [T13] Voice: detection, explicit commit, per-model download
  const profile = useSystemProfile();
  const pick = useMemo(() => (profile ? detectVoice(profile) : null), [profile]);
  // undefined = untouched, so the detected pick applies; null = deliberately no compatible voice
  // (a language no on-device voice hears). Only undefined falls back to detection (R2-I04).
  const [chosenModel, setChosenModel] = useState<string | null | undefined>(() => {
    const stored = localStorage.getItem("parakeetModel");
    return !shouldApplyDetectedVoice(stored) && isOnboardingVoice(stored) ? stored : undefined;
  });
  const [chosenLanguage, setChosenLanguage] = useState<string | null>(null);
  const spokenLanguages = chosenLanguage ? [chosenLanguage] : spokenLocalesFor(profile?.locales ?? [], pick?.languages ?? []);
  const selectedModel = chosenModel === undefined ? (pick?.modelId ?? null) : chosenModel;
  const voiceCompatible = selectedModel !== null && voiceSupportsAll(selectedModel, spokenLanguages);
  const voiceDownload = useVoiceDownload(selectedModel);
  const voiceState = voiceDownload.state;
  const voiceStatus = voiceState.status;
  const voiceBusy = voiceStatus === "downloading" || voiceStatus === "installing" || voiceStatus === "cancelling";
  const changeLanguage = (language: string) => {
    if (voiceBusy) return; // locked while a transfer runs (I03)
    setChosenLanguage(language);
    setChosenModel(reconcileVoice(selectedModel, [language]).modelId);
  };
  // I02: dictation becomes local, including from self-hosted. Meeting and upload routes stay as they are.
  const commitVoice = (): boolean => {
    if (!selectedModel || !voiceCompatible) return false;
    const store = useSettingsStore.getState();
    store.setTranscriptionMode("local");
    store.setUseLocalWhisper(true);
    store.setLocalTranscriptionProvider("nvidia");
    store.setParakeetModel(selectedModel);
    store.setSpokenLanguages(spokenLanguages);
    if (spokenLanguages[0]) store.setPreferredLanguage(spokenLanguages[0]);
    return true;
  };
  const voicePrimary = () => {
    if (!commitVoice()) return;
    if (voiceStatus === "idle" || voiceStatus === "error" || voiceStatus === "cancelled") voiceDownload.start();
    goTo("try");
  };
  const transcriptionMode = useSettingsStore((s) => s.transcriptionMode);
  const localProvider = useSettingsStore((s) => s.localTranscriptionProvider);
  const parakeetModel = useSettingsStore((s) => s.parakeetModel);
  const localVoiceActive =
    voiceStatus === "ready" && transcriptionMode === "local" && localProvider === "nvidia" && parakeetModel === selectedModel;
  const downloadRail: InstrumentMode | null =
    voiceState.status === "downloading"
      ? { kind: "download", percent: voiceState.percent, downloadedBytes: voiceState.downloadedBytes, totalBytes: voiceState.totalBytes }
      : voiceStatus === "error"
        ? { kind: "error", reason: "download" }
        : null;
  const voiceSize = byteParts(selectedModel ? (modelDownloadBytes(selectedModel) ?? 0) : 0);

  // [T14] off-step notices (§5.3) and the one polite live region
  const notify = useOnboardingNotifier();
  const lastStatusRef = useRef(voiceStatus);
  useEffect(() => {
    const previous = lastStatusRef.current;
    lastStatusRef.current = voiceStatus;
    if (previous === voiceStatus || !shouldAnnounceOffStep(step)) return;
    if (voiceStatus === "ready" && (previous === "downloading" || previous === "installing")) notify(voiceReadyNotice(t));
    if (voiceState.status === "error") notify(voiceFailedNotice(t, voiceState.message, voiceDownload.start));
  }, [notify, step, t, voiceDownload.start, voiceState, voiceStatus]);
  const announcement =
    voiceStatus === "ready" && voiceDownload.milestone !== null
      ? t("setupFlow.download.announceReady")
      : voiceStatus === "downloading" && voiceDownload.milestone !== null
        ? t("setupFlow.download.announcePercent", { percent: voiceDownload.milestone })
        : "";

  // [T15] Say something: the trial records in the overlay; setup only listens
  const settingsHotkey = useSettingsStore((s) => s.activeDictationKey || s.dictationKey) || getDefaultHotkey();
  const activationMode = useSettingsStore((s) => s.activationMode);
  const hotkeyLabel = keycapLabel(settingsHotkey, platform);
  const trialSession = useTrialSession(step === "try" && voiceStatus === "ready");
  const trial = trialSession.state;
  const keycap = useDictationHotkey(step === "try" || step === "shortcuts");
  const accessibility = useAccessibilityGate(platform, step === "try" || step === "shortcuts");
  const nowMs = useTicker(trial.phase === "recording" || trial.phase === "cancelled");
  const [docked, setDocked] = useState(false);
  const [lastTake, setLastTake] = useState<{ rawText: string | null; text: string; usedHotkey: boolean } | null>(null);
  useEffect(() => {
    if (trial.phase === "success") setLastTake({ rawText: trial.rawText, text: trial.text, usedHotkey: trialSession.usedHotkey });
  }, [trial.phase, trial.rawText, trial.text, trialSession.usedHotkey]);
  // M02: the rail settles the bars (SETTLE_MS) and draws the bubble (DRAW_MS); then dock once. The dock persists.
  useEffect(() => {
    if (trial.successes < 1 || docked) return;
    const id = setTimeout(
      () => dockMark(() => setDocked(true), { reducedMotion, doc: document as unknown as { startViewTransition?: (cb: () => void) => unknown } }),
      reducedMotion ? 0 : SETTLE_MS + DRAW_MS
    );
    return () => clearTimeout(id);
  }, [docked, reducedMotion, trial.successes]);
  // I08: retries are keyed to the take; the reducer drops stale or superseded results.
  const retryCleanup = async () => {
    const { takeId, rawText } = trial;
    if (!rawText) return;
    trialSession.dispatch({ status: "cleanupRetry", takeId, atMs: Date.now() });
    let text: string | null = null;
    try {
      text = await runCleanup(rawText);
    } catch {
      text = null;
    }
    trialSession.dispatch({ status: "cleanupResult", takeId, text, atMs: Date.now() });
  };
  const trialRail: InstrumentMode =
    voiceStatus !== "ready"
      ? (downloadRail ?? { kind: "idle" })
      : trial.phase === "recording"
        ? { kind: "listening", heardVoice: trial.heardVoice }
        : trial.phase === "processing"
          ? { kind: "processing" } // keeps the take's meter mounted (R3-M01)
        : trial.phase === "success"
          ? { kind: "success" }
          : trial.phase === "error"
            ? { kind: "error", reason: trial.errorKind === "microphone" ? "microphone" : trial.errorKind === "noAudio" ? "noAudio" : "other" }
            : { kind: "idle" };

  // [T16] Cleanup. Existing state (initialCleanupChoice, cleanupChoice, cleanupStatus, cleanupRequestRef,
  // closedRef, chooseCleanup, applyCleanupToOtherTasks) stays; chooseCleanup passes
  // preview: Boolean(config) and scenario: config?.scenario ?? "fresh".
  const reuseStorageKey = progressStorageKey ? `${progressStorageKey}.reuseCleanup` : "loqui.onboarding.reuseCleanup";
  const [reuseCleanup, setReuseCleanup] = useState(() => localStorage.getItem(reuseStorageKey) === "true");
  const cleanupRoute = useResolvedRoute("dictationCleanup");
  // An off route has no provider yet; name the one the user's choice will use (I05).
  const choiceProviderId = cleanupChoice === "codex" ? "codex" : cleanupChoice === "provider" ? "openai" : null;
  const cleanupProviderLabel = providerDisplayLabel(cleanupRoute.providerId ?? choiceProviderId, t);

  // [T17] Shortcut
  useShortcutDemo(step === "shortcuts");
  const modeInfo = useHotkeyModeInfo("dictation", settingsHotkey);
  const autoPasteEnabled = useSettingsStore((s) => s.autoPasteEnabled);
  const shortcutProven = keycap.presses > 0 || lastTake?.usedHotkey === true;

  // [T18] Ready: honest readiness and the note action's own route
  const speechRoute = useResolvedRoute("dictationStt");
  const noteRoute = useResolvedRoute("noteRecordingStt");
  const summary = summarizeReadiness({
    speechRoute, noteRoute, localVoiceActive, voiceDownload: voiceStatus,
    microphone: mic.access, micHeard, trialSucceeded: trial.successes > 0,
    platform, accessibilityGranted: accessibility.granted, shortcutProven, shortcutLabel: hotkeyLabel, activationMode,
    cleanupChoice, cleanupStatus, cleanupRoute, cleanupProviderLabel,
  });
  const noteAction = noteActionState({ route: noteRoute, microphone: mic.access });

  // ---------- per-step view ----------
  const railCopy = { title: t(`setupFlow.rail.${step}.title`), body: t(`setupFlow.rail.${step}.body${device}`) };
  const continueTo = { label: t("setupFlow.continue"), onClick: advance };
  const view = ((): StepView => {
    switch (step) {
      case "welcome": // [T12]
        return {
          rail: {
            ...railCopy,
            mode: helloPreview.status === "live" ? { kind: "listening", heardVoice: helloPreview.heardVoice } : { kind: "idle" },
            readLevel: helloPreview.readLevel,
          },
          primary: { label: t("setupFlow.hello.start"), onClick: advance },
          finishLaterLabel: t("setupFlow.lookAroundFirst"),
          content: (
            <HelloStep
              platform={platform}
              access={mic.access}
              preview={helloPreview}
              picker={micPicker}
              onPickMicrophone={pickMicrophone}
              onAllow={() => void mic.request()}
              onRecheck={() => void mic.check()}
            />
          ),
        };
      case "speech": // [T13]
        return {
          rail: { ...railCopy, mode: downloadRail ?? { kind: "idle" } },
          primary: {
            label:
              voiceStatus === "ready" || voiceBusy
                ? t("setupFlow.continue")
                : t("setupFlow.voice.download", { size: t(`setupFlow.units.${voiceSize.unit}`, { value: voiceSize.value }) }),
            onClick: voicePrimary,
            disabled: !voiceCompatible || voiceStatus === "checking" || voiceStatus === "cancelling",
            describedBy: voiceCompatible ? undefined : "onb-voice-blocked",
          },
          onSkip: skip,
          finishLaterLabel: t("setupFlow.finishLater"),
          content: (
            <VoiceStep
              platform={platform}
              profile={profile}
              pick={pick}
              selectedModel={selectedModel}
              onSelectModel={setChosenModel}
              language={chosenLanguage ?? profile?.locales[0] ?? "en-US"}
              onLanguageChange={changeLanguage}
              languageLocked={voiceBusy}
              compatible={voiceCompatible}
              blockedId="onb-voice-blocked"
              download={voiceState}
              onStartDownload={voiceDownload.start}
              onCancelDownload={() => void voiceDownload.cancel()}
            />
          ),
        };
      case "try": // [T14] TryStage + tour; [T15] trial and band
        return {
          rail: { ...railCopy, mode: trialRail, readLevel: trialSession.readLevel },
          onSkip: skip,
          finishLaterLabel: t("setupFlow.finishLater"),
          content: (
            <TryStage
              download={voiceState}
              onStart={voiceDownload.start}
              onCancel={() => void voiceDownload.cancel()}
              onChooseVoice={() => goTo("speech")}
              tour={<MeetLoquiTour hotkeyLabel={hotkeyLabel} activationMode={activationMode} platform={platform} reducedMotion={reducedMotion} />}
            >
              <div
                onKeyDown={(event) => {
                  if (event.key === "Escape" && (trial.phase === "recording" || trial.phase === "processing")) void trialSession.cancel();
                }}
              >
                <HotkeyTrial
                  platform={platform}
                  trial={trial}
                  nowMs={nowMs}
                  hotkeyLabel={hotkeyLabel}
                  activationMode={activationMode}
                  keycap={keycap}
                  usedHotkey={trialSession.usedHotkey}
                  accessibilityMissing={accessibility.granted === false}
                  undoAvailable={trialSession.undoAvailable} // [T22]
                  onUndo={() => void trialSession.undo()} // [T22]
                  onToggle={() => void trialSession.toggle()}
                  onCancel={() => void trialSession.cancel()}
                  onGrantAccessibility={accessibility.request}
                  onRetryCleanup={() => void retryCleanup()}
                  onTurnCleanupOff={() => chooseCleanup("none")}
                  onBackToVoice={() => goTo("speech")}
                  onChangeMicrophone={() => goTo("welcome")}
                />
              </div>
              {trial.successes > 0 ? <SuccessBand onPersonalize={() => goTo("cleanup")} onFinish={() => goTo("finish")} /> : null}
            </TryStage>
          ),
        };
      case "cleanup": // [T16]
        return {
          rail: { ...railCopy, mode: downloadRail ?? { kind: "idle" } },
          primary: continueTo,
          onSkip: skip,
          finishLaterLabel: t("setupFlow.finishLater"),
          content: (
            <CleanupStep
              choice={cleanupChoice}
              status={cleanupStatus}
              onChoose={chooseCleanup}
              userText={lastTake?.rawText ?? lastTake?.text ?? null}
              route={cleanupRoute}
              providerLabel={cleanupProviderLabel}
              runCleanup={runCleanup}
              reuse={reuseCleanup}
              onReuseChange={(value) => {
                setReuseCleanup(value);
                localStorage.setItem(reuseStorageKey, String(value));
              }}
            />
          ),
        };
      case "shortcuts": // [T17]
        return {
          rail: { ...railCopy, mode: downloadRail ?? { kind: "idle" } },
          primary: continueTo,
          onSkip: skip,
          finishLaterLabel: t("setupFlow.finishLater"),
          content: (
            <ShortcutStep
              platform={platform}
              hotkey={settingsHotkey}
              hotkeyLabel={hotkeyLabel}
              activationMode={activationMode}
              pushSupported={modeInfo.loaded && modeInfo.supportsPushToTalk}
              keycap={keycap}
              accessibilityMissing={accessibility.granted === false}
              onGrantAccessibility={accessibility.request}
              autoPasteEnabled={autoPasteEnabled}
              onAutoPasteChange={(value) => useSettingsStore.getState().setAutoPasteEnabled(value)}
              onActivationModeChange={(mode) => useSettingsStore.getState().setActivationMode(mode)}
              onHotkeyChange={(value) => useSettingsStore.getState().setDictationKey(value)}
            />
          ),
        };
      default: // "finish" [T18]
        return {
          rail: { ...railCopy, mode: downloadRail ?? { kind: "idle" } },
          content: (
            <ReadyStep
              platform={platform}
              summary={summary}
              note={noteAction}
              noteProviderLabel={providerDisplayLabel(noteAction.providerId, t)}
              onResume={goTo}
              onDictateNote={() => finish({ next: { kind: "dictate-note" } })}
              onOpenSettings={(path) => finish({ next: { kind: "open-settings", path } })}
              onOpenWorkspace={() => finish()}
              privacy={{
                historyEnabled: dataRetentionEnabled,
                onHistoryChange: setDataRetentionEnabled,
                updatesEnabled,
                onUpdatesChange: changeUpdates,
              }}
            />
          ),
        };
    }
  })();

  // [T11] render; [T13] footer chip; [T14] announcement
  return (
    <OnboardingShell
      step={step}
      visited={visited}
      platform={platform}
      rail={view.rail}
      docked={docked} // [T15]
      onNavigate={goTo}
      onBack={step === "welcome" ? undefined : back}
      onSkip={view.onSkip}
      finishLater={view.finishLaterLabel ? { label: view.finishLaterLabel, onClick: finishLater } : undefined}
      primary={view.primary}
      footerStart={step === "speech" || step === "try" ? undefined : <DownloadChip state={voiceState} onStart={voiceDownload.start} />} // [T13]; Tasks 11–12: Plan 02's footerStatus node
      announcement={announcement} // [T14]
    >
      {view.content}
    </OnboardingShell>
  );
}
```

Two details matter here:
- Every hook is called unconditionally at the top level, in the same order on every step. That is why `usePrefersReducedMotion` is hoisted in Task 14 rather than called inside the try branch (round-1 ONB-23 and M05).
- `PrivacyDefaults` is imported by the flow only between Tasks 12 and 18, while the legacy `FinishStep` renders it. Task 18 moves it into `ReadyStep` and drops the flow import.

