# Loqui UI/UX Plan 02 — Bug & a11y sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 20 standalone correctness and accessibility quick wins assigned to Plan 02, plus the three a11y follow-ups from Plan 01's final review:
- ONB-Q1, ONB-Q2;
- VO-Q6, VO-Q8, VO-Q9, VO-Q16;
- WS-Q1, WS-Q5, WS-Q7;
- SET-Q1, Q2, Q5, Q6, Q7, Q11, Q12, Q13, Q16, Q20, Q25;
- Plan 01 review: full-opacity focus rings, 3:1 form-control edges, and light status-fill text.

**Base:** execute on this branch rebased onto `snowopsdev/feat/uiux-foundations` (PR #43, at `677057d` or later), or onto `main` once Plan 01 merges.
- Line numbers for Tasks 1–3 and 5 were checked against `677057d`; all other anchors are unchanged since `172f9df`. If an anchor has moved, find the quoted code; do not trust the number over the code.
- Plan 01 shifted `src/components/OnboardingFlow.tsx` by one line after line 820. It also rewrote `src/index.css`, `src/components/ui/button.tsx` and `src/components/ControlPanelSidebar.tsx`, and at `4b0b51f` it already shipped the light `#e84e16` ring and the full-opacity Button and sidebar rings.

**Order (spec §3):** 01 → 02 → 03 → {04, 05, 06, 07}, then 06 → 08. Plans 03, 04, 05 and 06 all rewrite surfaces this plan fixes, and must keep the fixes and their tests.

**Architecture:** Tasks 1–2 add to Plan 01's colour tokens and fix the global field rules that consume them, and Task 3 guards the focus rings Plan 01 shipped. Every later fix stays inside the component, hook or main-process module that owns the bug. Where the logic is non-trivial, the task extracts a small pure helper next to its caller so `node:test` can pin it without a DOM:
- `chatInputKeys.ts`, `chatRouteKey.ts`, `providerTabsKeys.ts`, `upcomingEventGroups.ts`, `audioDeletion.ts`, `noteActionsReadiness.ts`;
- the main-process `systemNotification.js` and `audioFlagReconcile.js`.

One new IPC channel is added. VO-Q16 adds a main-owned native notification (`show-system-notification`) behind a typed preload method. Three existing IPC results change:
- Clear All Audio reports failures and unreadable storage.
- `delete-all-audio` keeps the audio flags of recordings whose file survived.
- The download cancel reports confirmation.

Toast fixes stay on the existing toast API so Plan 04 can migrate them to `notify()` (§5.3).

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Electron (main + preload), i18next, Node `node:test`.
- Renderer tests use Vite SSR (`test/lib/rendererTestHarness.js`) plus `react-dom/server` or `react-dom/client`.
- Source-text assertions follow `test/components/rtlMotion.test.js`.
- Contrast tests use Plan 01's `test/helpers/harness/cssTokens.js` (`resolveTokens`) and `src/utils/contrast.ts` (`contrastRatio`).
- Cascade tests use this plan's `test/helpers/harness/cssRules.js` (Task 2).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`:
- §3, the Plan 02 row;
- decisions D1 (`--color-link` for links; orange stays the light focus-ring accent), D2 (native interruption alerts), D3 (Esc armed until idle) and D10 (`DESIGN.md` is updated with the code);
- §4 global constraints;
- §5 Plan 01 tokens, §5.1 (Plan 03 route graph), §5.2 and §5.3 (Plan 04 owns the lifecycle and `notify()`).

Item text: `.omc/research/ui-review/approved-todo.md` in the research worktree. The format reference is `docs/superpowers/plans/2026-10-15-loqui-uiux-01-foundations.md`.

## Review response

The owner's decisions on the contract change requests are recorded under "Contract change requests". This revision answers the independent Codex review in `.omc/research/ui-review/reviews/plan-02-codex.md` (0 Critical, 8 Important, 5 Minor). Every finding is closed in the plan; none is disputed.

| Finding | Disposition | Where |
|---|---|---|
| I1 A queued message can move to another conversation | **Closed.** `ChatInput` takes a `queueKey`: conversation or context, plus a route fingerprint from `chatRouteKey`, which never includes the API key. A draft is sent on idle only if the key is unchanged. If the conversation, context or route changes, the draft is unqueued, its words stay in the box, and a notice asks for a deliberate Enter. All four callers pass a key. Tests mount the composer, queue in A, then switch to B, open New Chat, or change the route. | Task 13 |
| I2 Failure recovery discards the original words | **Closed.** A failed send refills an empty box. If a newer draft exists, the failed text is held in an "unsent" slot beside it, with Put it back (which keeps both) and Discard. Tests cover a deferred `false` and a deferred rejection while a newer draft exists. | Task 13 |
| I3 Global CSS overrides the input rings | **Closed.** `@layer base` closes at `index.css:387` (at `677057d`), so the native-field rules (1086–1126) are unlayered. Under CSS Cascade 5 an unlayered normal declaration beats any `@layer utilities` declaration, whatever its specificity. Task 2 therefore puts the full-opacity ring in those unlayered rules as `:focus-visible`, and removes the dead ring utilities from `Input` and `Textarea`. A test parses the stylesheet and asserts that the rule is unlayered, that no translucent ring remains, and that no plain `:focus` rule competes. Task 3 records why `Button`'s ring is safe: no unlayered rule touches `button` focus. Task 21 adds a computed-style check in DevTools. | Tasks 2, 3, 21 |
| I4 The held-start Esc test deadlocks | **Closed.** `beginHeldStart` returns `{ pending }`, so the async helper no longer adopts the held promise. The test asserts the stop is deferred before release and applied after, and has a 10 s timeout. | Task 9 |
| I5 Audio usage treats unreadable storage as empty, and does not typecheck | **Closed.** A new `useAudioStorageUsage` hook models `loading`, `known` and `unavailable`, with its type inferred from `electron.ts`; the hand-written annotation at `SettingsPage.tsx:1125` is deleted with the old state. `AudioStorageRow` shows "couldn't read" with Retry, never "no audio". Clear All re-reads first and opens no confirmation on a failed read, so a stale count is never shown as current. Mounted hook tests cover an unreadable first read, a rejected read, and a failed refresh after a good count. Step 4 runs typecheck. | Task 19 |
| I6 The failed-send test assumes a contract the sender lacks | **Closed.** The sender's `true` now means "the message reached the conversation", which is where restoring would start to duplicate. A failure before the save resolves `false` and removes the optimistic message; after the save it resolves `true`; it never rejects. Provider errors are rendered in the thread and resolve normally, as before. The factual claim is corrected. Integration tests run the real sender behind the real composer, failing both before and after persistence. | Task 13 |
| I7 A partial delete clears every row's audio flag | **Closed.** A new `clearFlagsForDeletedAudio` unflags only the rows whose file is gone, using `remainingAudioIds()`, and unflags nothing when the folder is unreadable. The IPC handler calls it. It is tested with the real `AudioStorageManager`. | Task 19 |
| I8 Plan 03 would overwrite the storage failure contract | **Closed.** The contract is in the interface table and in CCR 5, which was accepted along with CCR 4 (02 before 03), and the owner has told Plan 03 to keep `readable` and `failed`. Plan 03's storage task must keep `readable` and `failed`, `resolveClearAudioOutcome`, the flag reconciliation and their tests while adding `directory`. This thread cannot edit Plan 03. | CCR 4, CCR 5 |
| M1 `useNow` test does not prove time advances | **Closed.** An injectable `readClock`. The test moves the clock exactly 30 s across local midnight and asserts the exact timestamps and the date change, as well as the cleanup. | Task 11 |
| M2 Un-tokenized progress animation | **Closed.** The indeterminate loop becomes `calc(var(--motion-slow)*4) var(--motion-ease-std)`; the spinner becomes `motion-safe:animate-spin`. `animate-pulse` stays: it is an opacity loop, which the reduced-motion policy keeps, and it runs only in its active state. No new token is needed. | Task 4 |
| M3 Literal English download labels | **Closed.** `onboarding.download.start` and `inProgress` in all 11 locales; the test selectors use the keys. | Task 6 |
| M4 DESIGN and contract updates not executable | **Closed.** DESIGN steps added to Tasks 5, 8, 15 and 16, alongside those already in Tasks 1–4. The stale ring value (Task 15) and the `index.css` min-height anchor (Task 5) are corrected, and the line-number claim is softened. Task 21 adds a gated spec-update step that records each CCR's disposition. | Tasks 5, 8, 15, 16, 21 |
| M5 Remote Notes readiness has no owner | **Closed as a documented partial, with a handoff (CCR 6).** Task 14 ships local and self-hosted readiness; remote providers report "unknown" and show no hint. Plan 06 owns the consumer task (spec §5.1 handoffs) that maps the route states, keeps dismissal, and tests a remote provider with no key. | Task 14, CCR 6 |
| Cross-plan: native notification vs Linux recorder Stop | **Resolved: interruption-only.** `showSystemNotification` carries no actions, and Plan 04 keeps its own Linux action path. | CCR 1 |
| Cross-plan: D3 undo gap | Plan 04's to close or amend. Plan 02's Esc change is bounded and does not certify D3. | Notes for Plan 04 |
| Cross-plan: midnight wording, IME guard order | `useNow` guarantees rollover within one tick (≤30 s). Plan 06 should say the same, and run its mention interceptor after the IME guard (including keyCode 229). | Notes for Plan 06 |

One disagreement from the first review round still stands. Provider tabs keep the tab stop on the selected tab, as the WAI-ARIA tabs pattern specifies, rather than on the last-focused tab (Task 15).

The Codex review of PR #48 (commit `df7fbd3`) raised two P2 findings. Both are closed.

| Finding | Disposition | Where |
|---|---|---|
| Preserve the selected context until the send succeeds | **Closed.** AssistantPanel cleared `selectedContext` before `sendMessage` returned `false`, and `ChatInput` gives back only the words, so a retry silently went without the attachment. A new `sendWithSelectedContext` still hides the chip as the message goes, but restores the context when the send resolves `false` or rejects. A selection made while the send was in flight wins. Unit tests cover a sent message, a refusal, a rejection, a newer selection, a refusal that resolves before React commits the clear, and no context. | Task 13 |
| Implement radio-group keyboard behaviour or avoid radio roles | **Closed: roving tabindex and arrow-key focus, with selection kept explicit.** The list now has one tab stop: the selected card, or the first selectable card. Arrow keys move focus and wrap. Enter, Space or a click selects. Arrows do not also check, a deliberate departure from the WAI-ARIA radio pattern, because selecting can switch where audio goes. `TranscriptionModelPicker` shows a browsed provider's list with `selectedModel=""` (`:1281-1286`), and `handleCloudModelSelect` switches the cloud provider (`:863-870`). If selection followed focus, browsing that list would move audio to another provider. `role="radio"` stays, as SET-Q2 in the approved list specifies. A mounted test drives the arrow keys and asserts that focus moves and nothing is selected. | Task 16 |

## Contract change requests

**Owner decisions (2026-10-15):**
- **CCR 3:** approved, and recorded as **D13** in the spec on `snowopsdev/feat/uiux-foundations`.
- **CCR 4:** approved. The owner applies it to §3 in the consolidated spec update.
- **CCR 2:** the ring part already shipped in Plan 01. `--color-input-border` and the light warning and success foregrounds stay in Plan 02 as its own additions.
- **CCRs 1, 5 and 6:** accepted. The owner publishes them in the consolidated spec update, as §5.5 plus the stored-audio contract, and Plan 03 has been told to keep the `readable` and `failed` fields.

The consolidated spec (091d198 on `snowopsdev/feat/uiux-foundations`) now carries all of them; each status below names its section. This PR does not edit the spec (Task 21).

1. **Add §5.5 Interruption notifications (owner: Plan 02; consumer: Plan 04).** Task 10 adds:
   ```ts
   window.electronAPI.showSystemNotification(payload: { title: string; body?: string }):
     Promise<{ success: boolean; reason?: "disabled" | "unsupported" | "invalid" }>
   ```
   - Main shows an Electron `Notification`.
   - It honours the master `notificationsEnabled` preference.
   - Clicking it focuses the sending window.
   - **It is interruption-only and carries no actions.** D2's Linux recorder notice needs a Stop action. Plan 04 keeps its own Linux (freedesktop/gdbus) action path for that, because Electron's action support differs on Linux. This contract does not claim to cover it.

   **Status: applied in spec §5.5 (091d198).**
2. **Extend Plan 01's colour-token contract (§5, "Motion and colour tokens"),** from Plan 01's final review.
   - **New token:** `--color-input-border` (light `#858585`, Plum Night `#8c6b7b`; Task 2).
   - **Changed light values:**
     - `--color-ring` `#ff5a1f` becomes `#e84e16` (Task 3). Plum Night keeps `#ff5a1f`.
     - `--color-warning-foreground` and `--color-success-foreground` change from `#ffffff` to `#171717` (Task 1).

   **Status: applied in spec §5, Plan 01 contracts table, "Extended by" (091d198).** The light `--color-ring` value already shipped in Plan 01 (PR #43), so Task 3 no longer changes it. `--color-input-border` (Task 2) and the light warning and success foregrounds (Task 1) stay as Plan 02's own additions.*
3. **FYI, `UpdateStatus.phase` gains `"available"`** (Task 17). It means a manual check found a newer version while automatic updates are off. Plan 03 moves `UpdateSettings` and must keep rendering it. This reverses a deliberate rule pinned at `test/helpers/updateManager.test.js:187` ("the off switch also blocks manual checks"); SET-Q16 is the owner's pick. **Status: applied in spec §5.6, "Update status" (D13; 091d198).** Manual checks stay available with automatic updates off, nothing downloads without an explicit click, and Task 17 replaces the rule pinned at `updateManager.test.js:187`.*
4. **Record the execution order in §3:** 01 → 02 before 03–06. The spec's graph shows 02 in parallel with 01 and nothing downstream of it. In fact Plans 03, 04, 05 and 06 all rewrite surfaces Plan 02 fixes:
   - Plan 03: settings storage, model cards, navigation and the setup card;
   - Plan 04: toasts and Esc;
   - Plan 05: the onboarding shell and download;
   - Plan 06: the clock, the composer and Notes.

   Each needs Plan 02's tests in place. **Status: superseded by spec §3 (091d198), which orders 01 → 02 → 03 → {04, 05, 06, 07}, then 06 → 08.** That keeps 02 before every plan that rewrites its surfaces, and also puts 03 before 04–07.
5. **Stored-audio contract (owner: Plan 02; consumer: Plan 03).**
   - `getStorageUsage()` returns `{ fileCount, totalBytes, readable }`.
   - `deleteAllAudio()` returns `{ deleted, failed, readable }`.
   - `remainingAudioIds()` and `clearFlagsForDeletedAudio()` exist.
   - The renderer gets `resolveClearAudioOutcome` and `useAudioStorageUsage`.
   - Plan 03 Task 11 replaces this UI. Its current text drops `readable`/`failed` and treats an unreadable zero as cleared, so it must keep the fields, the unavailable state and the tests. **Status: applied in spec §5.6 (091d198).**
6. **Notes readiness handoff (owner of the consumer task: Plan 06).** Plan 06 replaces `useNoteActionsReady` with `useResolvedRoute("noteFormatting")`. Plan 06 owns it because it rewrites the Notes surface.
   - `ready` shows no hint.
   - `needsModel`, `needsKey`, `needsUrl` and `unreachable` show the hint with the matching action, `onOpenSettings(route.settingsPath)`.
   - `unknown` shows nothing yet, and `off` disables Actions.
   - It keeps the dismissal key `notesActionsModelHintDismissed`, and tests a remote provider with no saved key.

   Until then, WS-Q7's hint covers local and self-hosted routes only. **Status: applied in spec §5.1, Handoffs (091d198), assigned to Plan 06.**

## Interfaces this plan produces for later plans

| Item | Where | Consumer |
|---|---|---|
| `--color-input-border`, light ink warning and success foregrounds (Plan 02 additions; light `--color-ring` `#e84e16` already shipped in Plan 01) | `src/index.css` | every plan's form controls and status fills |
| Native-field focus is drawn by the unlayered `:focus-visible` rules; components must not rely on ring utilities for `<input>`/`<textarea>` | `src/index.css` | every plan with form fields |
| `showSystemNotification` (CCR 1, interruption-only) | `preload.js`, `src/types/electron.ts`, `src/helpers/systemNotification.js` | Plan 04 |
| `useNow(intervalMs?, readClock?)`; rollover within one tick (≤30 s) | `src/hooks/useNow.ts` | Plan 06 |
| `ChatInputProps.queueKey`; `onTextSubmit` returns `void \| boolean \| Promise<void \| boolean>` (`false` or a rejection means not sent); the unsent slot | `src/components/chat/ChatInput.tsx` | Plan 06 (WS-R8) |
| `useChatMessageSender` resolves `true` once the message reached the conversation, `false` otherwise, and never rejects | `src/components/chat/useChatMessageSender.ts` | Plan 06 |
| `chatRouteKey` / `useChatRouteKey` | `src/components/chat/chatRouteKey.ts` | Plan 06 |
| `useModelDownload().cancelDownload` resolves `true` only when main confirmed | `src/hooks/useModelDownload.ts` | Plan 05 (ONB-R4) |
| Stored-audio contract (CCR 5) | `src/helpers/audioStorage.js`, `audioFlagReconcile.js`, `src/utils/audioDeletion.ts`, `src/hooks/useAudioStorageUsage.ts`, `src/components/settings/AudioStorageRow.tsx` | Plan 03 (SET-R7) |
| `useNoteActionsReady(): boolean \| null` (temporary, CCR 6) | `src/hooks/useNoteActionsReady.ts` | replaced by Plan 06 (spec §5.1 handoff) |
| `ProviderTabItem.keySaved` | `src/components/ui/ProviderTabs.tsx` | Plan 03 (SET-R5) |
| `ModelCard` `selectionRole` and `tabIndex`, `ModelCardList` `ariaLabel`; one tab stop, arrows move focus and never select; Learn more never selects | `src/components/ui/ModelCardList.tsx` | Plan 03 (SET-R4) |
| `rendererOptions`, `I18N_KEYS_MOCK`, `TOAST_MOCK` | `test/helpers/harness/rendererMocks.js` | every later plan's renderer tests |
| `installTree` (with `find`, `props`) | `test/helpers/harness/fakeDomTree.js` | renderer tests that click or type |
| `parseRules`, `isLayered` | `test/helpers/harness/cssRules.js` | any cascade test |

**Notes for Plan 03:**
- Keep the stored-audio contract (spec §5.6).
- When local model cards and the settings nav are replaced, keep the following and their tests:
  - explicit activation (arrows never select);
  - accessible names;
  - full-opacity focus rings;
  - the Learn-more propagation fix.

**Notes for Plan 04:**
- **Esc (D3).** Task 9 arms Esc as soon as a recording exists, including a stop that lands mid-start. It releases Esc only on the idle edge in `useAudioRecording`'s `onStateChange`, and on unmount.
  - When Plan 04 adds the `cancelled` state, that state counts as idle for Esc. The undo uses ⌥Z, not Esc.
  - Do not reintroduce the removed stop-time unregister.
  - Plan 02 does not close D3's undo gaps for streaming or batch finalization. Plan 04 owns them, or an explicit spec amendment does.
- **Dictation-error cards (VO-Q6).** Task 7 makes a card with a recoverable transcript persistent (`duration: 0`). `notify({ kind: "alert" })` must keep that rule.
- **Notifications.** `showSystemNotification` stays action-less (CCR 1).

**Notes for Plan 05:** Keep these from Task 6, along with their tests:
- the cancel-confirmation flow;
- refusal during extraction;
- terminal settlement before a retry;
- the translated labels.

**Notes for Plan 06:**
- **Notes readiness (spec §5.1 handoff, CCR 6).** Replace `useNoteActionsReady` with `useResolvedRoute("noteFormatting")` as §5.1 specifies, keep the dismissal key, and test a remote provider with no saved key.
- **Composer.** Keep Task 13's `queueKey` binding, the unsent slot and the sender contract when adding draft seeding or mirroring.
- **Mentions.** Run any mention interceptor after `resolveComposerKey`'s IME guard (`isComposing` and keyCode 229).
- **Clock.** State `useNow`'s guarantee as "within one tick (≤30 s) of local midnight".

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md). A queued chat send still goes through main's provider checks; no renderer shortcut is added.
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure. In this plan:
  - arrow keys move focus but never select a provider or model (Tasks 15–16);
  - a queued chat draft never sends to a conversation, context or route it was not queued for (Task 13);
  - a chat draft that is refused or fails to send is never lost, even when a newer draft exists (Task 13);
  - a download cancel that main refuses leaves the download visible (Task 6);
  - an unreadable audio folder is never shown as empty, and surviving recordings keep playback (Task 19).
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night.
  - Focus rings are full opacity.
  - A contrast claim is pinned by a test that scores the real tokens with `resolveTokens` and `contrastRatio`, not by class names alone.
  - Where a global rule could override a class, a cascade test pins which rule wins (Task 2).
- Motion uses Plan 01's `--motion-*` tokens only. Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms (the existing policy in `src/index.css`; do not weaken it).
- Every visible string goes through i18n with keys in all 11 locales: `ar de en es fr it ja pt ru zh-CN zh-TW`. Interpolation placeholders must match across locales. `npm run i18n:check` passes, and `test/locales/translationCoverage.test.js` passes.
- RTL: use logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). The one deliberate exception is the macOS traffic-light clearance in Task 5, which is physical because the traffic lights are.
- `src/index.css` is edited only by Tasks 1–2, the token and form-control changes. Task 3 adds tests only. Onboarding CSS goes in `src/styles/onboarding-welcome.css`.
- New locale keys go inside existing namespaces, never as new top-level keys. `updates` is the last top-level object before Plan 01's `locality`, so Task 17 inserts its key mid-object.
- `DESIGN.md` is the source of truth (D10). Every task that changes a documented surface updates its section in the same commit: Tasks 1, 2, 4, 5, 8, 15 and 16.
- Tests run with Node `node:test`.
  - Setup: `npm run native:node` once, then `npm test -- <files>`.
    - `scripts/run-tests.js` takes files or quoted globs, not directories.
    - Run `npm run native:electron` before launching the desktop app.
    - Never use personal profiles in tests.
  - Node: `~/.nvm/versions/node/v24.21.0/bin` (matches `.node-version` 24.21.0).
  - Run `npm ci` first if the worktree has no `node_modules`.
- Before a PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`, `npm run format:check`.

## Review Focus

1. **Esc stays captured system-wide.** The cancel slot is a global shortcut. Keeping it armed through processing means Esc in any app cancels the dictation while it processes, and swallows that keypress. That is D3's intent, but a slow remote call or a wedged `isProcessing` must not hold Esc forever. A stop that lands while the mic is still opening must still be cancellable. Pinned in Task 9 by:
   - "Esc is released on the idle edge";
   - "unmounting releases Esc even mid-processing";
   - "a stop that lands mid-start still arms Esc for processing".
2. **A queued chat draft and its destination.** A user queues a follow-up while conversation A streams, then switches to B, opens New Chat, or changes the model. The draft must not be sent anywhere; it waits for a deliberate Enter. A refused or failed send must never lose words, including when a newer draft is already in the box. Pinned in Task 13 by:
   - the "a queued draft is not sent after …" tests;
   - "a refusal while a newer draft exists keeps both drafts" and "a rejection while a newer draft exists keeps both drafts";
   - the two "with the real sender" tests;
   - in `assistantTextSubmit.test.js`, "a send that was not made gives the context back with the words" and "a newer selection is never overwritten by a failed send".
3. **Cancel during the onboarding download.** Main refuses to cancel once extraction starts. If the click races that transition, the download must stay visible and its success must still count. Pinned in Task 6 by:
   - "a cancel main refuses keeps the download and its result";
   - "a confirmed cancel returns to idle and a late result cannot mark it interrupted";
   - "Download stays disabled until the cancelled request settles".
4. **Unreadable storage and partial deletes.** A locked or missing audio folder must read as "unavailable", not "no audio". A partial delete must say so, and keep playback for the surviving recordings. Pinned in Task 19 by:
   - "an unreadable first read is unavailable, not empty" and "a failed refresh after a good count does not keep the stale count";
   - "after a partial delete, only recordings whose file is gone lose their audio flag";
   - "an unreadable store clears no audio flags".
5. **Arrow keys and IME must not trigger an action.** Arrow keys move focus only, and never select a provider or model, because selecting can switch where audio or text goes. Enter during IME composition must not send or queue. Pinned by:
   - Task 15: "arrow keys only move focus";
   - Task 16: "arrow keys move focus between cards and never select" and "Learn more never selects the model";
   - Task 12: "Enter during IME composition does nothing".

---

### Task 1: Light status fills carry ink text

Plan 01 review, item 3. Plan 01 fixed the Plum Night status tokens by putting dark text on the fill. Light still pairs white text with fills that are too light for it.

**Files:**
- Modify: `src/index.css`:
  - `@theme`, line 34: `--color-success-foreground: #ffffff;`
  - `@theme`, line 36: `--color-warning-foreground: #ffffff;`
- Modify: `DESIGN.md`, `### Roles` (after the Nav marker bullet, line 157)
- Test: `test/components/statusTokens.test.js`

**Interfaces:**
- Consumes `resolveTokens(cssText)` from `test/helpers/harness/cssTokens.js`, which returns `{ light, dark }` maps of `--name` to its raw value, and `contrastRatio(fg, bg): number` from `src/utils/contrast.ts`. Both are from Plan 01.
- Produces light `--color-success-foreground` and `--color-warning-foreground` of `#171717`.

The measured light pairs, foreground on fill:

| Pair | Ratio |
|---|---|
| warning, white on `#d97706` | 3.19:1 |
| success, white on `#16a34a` | 3.30:1 |
| destructive | 4.83:1 |
| info | 5.19:1 |
| accent | 4.97:1 |
| ink `#171717` on warning | 5.63:1 |
| ink `#171717` on success | 5.44:1 |

The success fill fails the same way as warning, so it is fixed in the same step.

- [ ] **Step 1: Write the failing test**

Create `test/components/statusTokens.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");
const load = () => import("../../src/utils/contrast.ts");

test("light status fills carry text that clears 4.5:1", async () => {
  const { contrastRatio } = await load();
  const { light } = resolveTokens(css);
  for (const role of ["accent", "destructive", "success", "warning", "info"]) {
    const ratio = contrastRatio(light[`--color-${role}-foreground`], light[`--color-${role}`]);
    assert.ok(ratio >= 4.5, `${role}-foreground on ${role} is ${ratio}:1`);
  }
});

test("warning and success put ink on the fill, as Plum Night puts dark text on its fills", () => {
  const { light } = resolveTokens(css);
  assert.equal(light["--color-warning-foreground"], "#171717");
  assert.equal(light["--color-success-foreground"], "#171717");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/statusTokens.test.js`
Expected: FAIL with "success-foreground on success is 3.3:1".

- [ ] **Step 3: Implement**

1. In `src/index.css` `@theme`, change:

   ```css
     --color-success-foreground: #ffffff;
   ```
   ```css
     --color-warning-foreground: #ffffff;
   ```

   to:

   ```css
     /* Ink on the light green and amber fills (5.44:1, 5.63:1); white was
        3.30:1 and 3.19:1. Plum Night already puts dark text on its fills. */
     --color-success-foreground: #171717;
   ```
   ```css
     --color-warning-foreground: #171717;
   ```

2. In `DESIGN.md` `### Roles`, append:

   ```markdown
   - **Status fills** (success, warning, destructive, info): text on a filled status surface clears 4.5:1 in both themes. Light success and warning fills carry ink (#171717); destructive and info carry white; Plum Night fills carry #1C1218.
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/statusTokens.test.js test/components/plumNight.test.js test/components/colorRoles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css DESIGN.md test/components/statusTokens.test.js
git commit -m "fix(a11y): ink text on light success and warning fills"
```

---

### Task 2: Form-control edges clear 3:1 in both themes

Plan 01 review, item 2. Plum Night `--color-border` `#3d2733` on `#1c1218` is 1.34:1. Light fails the same way: `#e5e5e5` on white is 1.26:1, and 1.17:1 on the `#f9f6f1` input fill. Section 4 requires 3:1 in both themes, so the new token covers both.

**Files:**
- Modify: `src/index.css`:
  - in `@theme`, add `--color-input-border` after `--color-input` (line 23);
  - in `.dark`, add it after `--color-input` (line 248);
  - in the native-field resting rules, `:root input:not(.input-inline), :root textarea:not(.input-inline)` (lines 1099–1104) and `.dark input:not(.input-inline), .dark textarea:not(.input-inline)` (lines 1114–1120);
  - in the native-field focus rules (lines 1106–1111 and 1122–1126).
- Create: `test/helpers/harness/cssRules.js`
- Modify: `src/components/ui/input.tsx:11-19`
- Modify: `src/components/ui/textarea.tsx:12-15`
- Modify: `DESIGN.md`, `### Inputs / Fields` (lines 243–246)
- Test: `test/components/formControlBorders.test.js`

**Interfaces:**
- Consumes `resolveTokens` and `contrastRatio` (Plan 01).
- Produces `--color-input-border` (light `#858585`, Plum Night `#8c6b7b`) and the Tailwind utilities `border-input-border` and `ring-input-border`. Task 4 uses `ring-input-border` for the progress track.
- Produces `test/helpers/harness/cssRules.js`:
  - `parseRules(cssText)` returns `{ selector, body, atRules }[]`, one entry per style rule, where `atRules` lists its enclosing at-rule preludes;
  - `isLayered(rule)` returns `true` when any enclosing at-rule is an `@layer`.
  Task 3 uses both.

| Edge | Measured contrast |
|---|---|
| `#858585` on light surfaces | 3.24:1 (`surface-raised` `#f0f0f0`) to 3.69:1 (white) |
| `#8c6b7b` on Plum Night surfaces | 3.26:1 (`surface-raised` `#33202b`) to 4.09:1 (`surface-window`) |

Hover no longer lightens the edge. `hover:border-border-hover` (`#d4d4d4`) would drop below 3:1 while the pointer is over the field.

**Which rule paints a focused field: the cascade.** `src/index.css` starts with `@import "tailwindcss";` (line 1). Tailwind 4 emits every utility, `focus-visible:ring-*` included, inside `@layer utilities`. The native-field rules at lines 1086–1126 sit at the top level of the file: `@layer base` (line 301) closes at line 387, and nothing else wraps them.

Under CSS Cascade Level 5, a normal (non-`!important`) declaration outside any layer beats a normal declaration in any layer. Specificity is not consulted. So for any `<input>` or `<textarea>` without `.input-inline`, the global focus rules decide `box-shadow` and `border-color`. A ring utility on the component can never show.

Today those rules paint `box-shadow: 0 0 0 2px oklch(from var(--color-ring) l c h / 0.15)`, a 15% ring, plus a `--color-border-active` border. Foundations' full-opacity ring work covered buttons, not these field rules. Changing only the component classes would leave that 15% ring on screen. This task therefore:
- moves the full-opacity ring into the unlayered rules;
- switches them to `:focus-visible`;
- removes the ring utilities from `Input` and `Textarea`, so no class pretends to control something the cascade overrides.

The same rule covers raw `<input>` and `<textarea>` elements that do not use the primitives. `.input-inline` fields, such as the chat composer, keep their own focus styling.

`Textarea` was hard-coded to light-only neutrals and an indigo focus ring in both themes, so it moves onto tokens. The `.onboarding-canvas .onboarding-light-input:focus-visible` rule (line 993) has its own translucent ring under `!important`. That selector belongs to the orphaned onboarding canvas that Plan 05 removes (ONB-Q15), so it is out of scope here.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/harness/cssRules.js`:

```js
// Splits a stylesheet into style rules and records the at-rules around each
// one, so tests can ask whether a rule is layered. Unlayered normal
// declarations beat every @layer (CSS Cascade 5), which decides whether a
// Tailwind utility can override a global rule. Comments are stripped; the
// stylesheets this reads contain no braces inside strings.
function parseRules(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const stack = [];
  let prelude = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      stack.push({ head: prelude.trim(), start: i + 1 });
      prelude = "";
    } else if (ch === "}") {
      const open = stack.pop();
      if (open && open.head && !open.head.startsWith("@")) {
        rules.push({
          selector: open.head.replace(/\s+/g, " "),
          body: css.slice(open.start, i),
          atRules: stack.map((entry) => entry.head).filter((head) => head.startsWith("@")),
        });
      }
      prelude = "";
    } else if (ch === ";") {
      prelude = "";
    } else {
      prelude += ch;
    }
  }
  return rules;
}

const isLayered = (rule) => rule.atRules.some((head) => head.startsWith("@layer"));

module.exports = { parseRules, isLayered };
```

Create `test/components/formControlBorders.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");
const { parseRules, isLayered } = require("../helpers/harness/cssRules");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
const css = read("src/index.css");
const load = () => import("../../src/utils/contrast.ts");

// Every surface a field can sit on, or fill itself with.
const SURFACES = [
  "--color-background",
  "--color-input",
  "--color-card",
  "--color-popover",
  "--color-muted",
  "--color-surface-1",
  "--color-surface-raised",
  "--color-surface-window",
];

test("form-control edges clear 3:1 on every surface, in light and Plum Night", async () => {
  const { contrastRatio } = await load();
  const { light, dark } = resolveTokens(css);
  assert.equal(light["--color-input-border"], "#858585");
  assert.equal(dark["--color-input-border"], "#8c6b7b");
  for (const [theme, tokens] of [
    ["light", light],
    ["Plum Night", dark],
  ])
    for (const surface of SURFACES) {
      const ratio = contrastRatio(tokens["--color-input-border"], tokens[surface]);
      assert.ok(ratio >= 3, `${theme}: input border on ${surface} is ${ratio}:1`);
    }
});

test("native inputs and textareas draw their edge with the input border token", () => {
  const light = css.match(
    /:root input:not\(\.input-inline\),\s*:root textarea:not\(\.input-inline\)\s*\{([^}]*)\}/
  );
  const dark = css.match(
    /\.dark input:not\(\.input-inline\),\s*\.dark textarea:not\(\.input-inline\)\s*\{([^}]*)\}/
  );
  for (const [name, block] of [
    ["light", light],
    ["dark", dark],
  ]) {
    assert.ok(block, `${name} field rule exists`);
    assert.match(block[1], /border: 1px solid var\(--color-input-border\);/);
  }
});

test("a focused native field gets a full-opacity ring from an unlayered rule, which no utility can override", () => {
  const rules = parseRules(css);
  for (const scope of [":root", ".dark"]) {
    const selector = `${scope} input:not(.input-inline):focus-visible, ${scope} textarea:not(.input-inline):focus-visible`;
    const rule = rules.find((r) => r.selector === selector);
    assert.ok(rule, `${scope} focus-visible rule exists`);
    assert.equal(isLayered(rule), false, `${scope}: unlayered, so it beats @layer utilities`);
    assert.match(rule.body, /border-color: var\(--color-ring\);/);
    assert.match(rule.body, /box-shadow: 0 0 0 1px var\(--color-background\), 0 0 0 3px var\(--color-ring\);/);
  }
  const translucent = rules.filter(
    (r) => /:focus/.test(r.selector) && /var\(--color-ring\) l c h \/ 0\.\d+/.test(r.body)
  );
  assert.deepEqual(translucent.map((r) => r.selector), [], "no translucent ring is left");
  const plainFocus = rules.filter((r) => /input:not\(\.input-inline\):focus(?!-visible)/.test(r.selector));
  assert.deepEqual(plainFocus.map((r) => r.selector), [], "no :focus rule competes with :focus-visible");
});

test("the Input and Textarea primitives use the token and leave focus to the global rule", () => {
  const input = read("src/components/ui/input.tsx");
  assert.match(input, /\bborder-input-border\b/);
  assert.doesNotMatch(input, /border-border\/70|dark:border-border-subtle|hover:border-border-hover/);
  // A ring utility here would be dead code: the unlayered field rule wins.
  assert.doesNotMatch(input, /focus(-visible)?:ring|focus-visible:border-primary/);
  const textarea = read("src/components/ui/textarea.tsx");
  assert.match(textarea, /\bborder-input-border\b/);
  assert.doesNotMatch(textarea, /neutral-|indigo-|bg-white/);
  assert.doesNotMatch(textarea, /focus(-visible)?:ring|focus:border/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/formControlBorders.test.js`
Expected: FAIL. `light["--color-input-border"]` is `undefined`, no `:focus-visible` field rule exists, and the 15% ring is still there.

- [ ] **Step 3: Implement**

1. In `src/index.css` `@theme`, directly after `--color-input: #f9f6f1;`, add:

   ```css
     /* Field edges: 3:1 against every surface a field sits on (WCAG 1.4.11).
        --color-border stays the quiet divider for cards and rules. */
     --color-input-border: #858585;
   ```

   In `.dark`, directly after `--color-input: #170e13;`, add:

   ```css
     --color-input-border: #8c6b7b;
   ```

2. In the light native-field rule (`:root input:not(.input-inline), :root textarea:not(.input-inline) { … }`), change `border: 1px solid var(--color-border);` to `border: 1px solid var(--color-input-border);`. Make the same change in the `.dark input:not(.input-inline), .dark textarea:not(.input-inline) { … }` rule. Leave every other `var(--color-border)` alone, because cards and dividers keep the quiet border.

   Then replace the two focus rules. The light one (lines 1106–1111):

   ```css
   :root input:not(.input-inline):focus,
   :root textarea:not(.input-inline):focus {
     border-color: var(--color-border-active);
     box-shadow: 0 0 0 2px oklch(from var(--color-ring) l c h / 0.15);
     background-color: var(--color-background);
   }
   ```

   becomes:

   ```css
   /* Unlayered on purpose: it outranks every Tailwind utility (@layer
      utilities), so this is the one place a focused field's ring is drawn.
      1px gap in the page colour, then a 2px full-opacity ring. */
   :root input:not(.input-inline):focus-visible,
   :root textarea:not(.input-inline):focus-visible {
     border-color: var(--color-ring);
     box-shadow: 0 0 0 1px var(--color-background), 0 0 0 3px var(--color-ring);
     background-color: var(--color-background);
   }
   ```

   The dark one (lines 1122–1126):

   ```css
   .dark input:not(.input-inline):focus,
   .dark textarea:not(.input-inline):focus {
     border-color: var(--color-border-active);
     box-shadow: 0 0 0 2px oklch(from var(--color-ring) l c h / 0.15);
   }
   ```

   becomes:

   ```css
   .dark input:not(.input-inline):focus-visible,
   .dark textarea:not(.input-inline):focus-visible {
     border-color: var(--color-ring);
     box-shadow: 0 0 0 1px var(--color-background), 0 0 0 3px var(--color-ring);
   }
   ```

   Text fields match `:focus-visible` on mouse focus as well as keyboard focus, so pointer users still see where they are typing.

3. In `src/components/ui/input.tsx`, replace lines 11 and 16–19:

   ```tsx
           "flex h-10 w-full min-w-0 rounded border border-border/70 bg-input px-3 py-2 text-sm text-foreground shadow-none transition-colors duration-200 outline-none",
   ```
   ```tsx
           "dark:bg-surface-1 dark:border-border-subtle/60",
           "hover:border-border-hover",
           "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/10",
           "dark:focus-visible:border-border-active dark:focus-visible:ring-ring/10",
   ```

   with:

   ```tsx
           "flex h-10 w-full min-w-0 rounded border border-input-border bg-input px-3 py-2 text-sm text-foreground shadow-none transition-colors duration-200 outline-none",
   ```
   ```tsx
           "dark:bg-surface-1",
   ```

   Add this as the first line inside the `cn(` call (a JS comment inside the argument list is valid there): `// Focus ring: drawn by the unlayered native-field rule in index.css, which wins over any utility here.`

4. In `src/components/ui/textarea.tsx`, replace lines 12–15:

   ```tsx
             "flex min-h-[80px] w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-sm text-neutral-900 shadow-sm transition-colors duration-200 outline-none resize-y cursor-text",
             "placeholder:text-neutral-400",
             "hover:border-neutral-300",
             "focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20",
   ```

   with:

   ```tsx
             "flex min-h-[80px] w-full rounded-xl border border-input-border bg-input px-3.5 py-3 text-sm text-foreground shadow-sm transition-colors duration-200 outline-none resize-y cursor-text",
             "placeholder:text-muted-foreground",
   ```

   Also change `disabled:bg-neutral-50` on the next line to `disabled:bg-muted`.

5. In `DESIGN.md` `### Inputs / Fields`, replace the `**Style:**` and `**Focus:**` bullets (lines 245–246) with:

   ```markdown
   - **Style:** Full-width 40px fields with 6px corners, compact sans text, and a one-pixel `--color-input-border` edge (#858585 light, #8C6B7B Plum Night) that clears 3:1 on every surface a field sits on. Hover does not lighten the edge.
   - **Focus:** A full-opacity 2px `--color-ring` ring with a 1px gap, drawn by the unlayered native-field rule in `src/index.css` so no utility can weaken it. The border turns `--color-ring` too.
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/formControlBorders.test.js test/components/plumNight.test.js test/components/fieldDirectionPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/ui/input.tsx src/components/ui/textarea.tsx DESIGN.md test/helpers/harness/cssRules.js test/components/formControlBorders.test.js
git commit -m "fix(a11y): form-control edges and focus rings clear 3:1 in light and Plum Night"
```

---

### Task 3: Focus-ring guards: cascade, and the colour-role class check

Plan 01 review, item 1, and a non-blocking gap left by Plan 01's Codex review.

Foundations (PR #43) already shipped the focus-ring changes this task once carried:
- light `--color-ring` is `#e84e16`;
- the `Button` base ring and both `ControlPanelSidebar` rings are full-opacity `focus-visible:ring-ring`;
- `DESIGN.md`'s Roles section documents the ring.

What remains is making those rings hard to break.
- **Cascade.** No unlayered rule may restyle a button's focus. A utility loses to any unlayered rule (Task 2), so a future global `button:focus` rule would silently override every ring.
- **The colour-role guard has a gap.** The test `no Button variant changes filter or opacity on hover, press or focus` (`test/components/colorRoles.test.js:164`) splits each class on every colon, including colons inside arbitrary-property brackets. `hover:[opacity:0.5]` splits into `hover`, `[opacity` and `0.5]`, so the utility `0.5]` never matches, and `hover:[filter:brightness(1.1)]` slips through the same way. Both would recolour the ring on hover.

**Files:**
- Modify: `test/components/colorRoles.test.js:161-181`. Add a bracket-aware split, extract the check, and add mutations.
- Test: `test/components/focusRings.test.js`

**Interfaces:**
- Consumes `parseRules` and `isLayered` (Task 2).
- Produces nothing at runtime. This task changes tests only.

**Why these rings render today.** `Button`'s ring and the sidebar's rings are Tailwind utilities in `@layer utilities`.
- At `677057d`, the only unlayered `:focus` / `:focus-visible` rules in `src/index.css` are:
  - the native-field rules (Task 2 rewrites them);
  - the onboarding-canvas input rules, which match `input` elements only.
- No unlayered rule sets `box-shadow` or `outline` on `button`.
- Plan 01's `:where(button, …)` rule lives in `@layer base` and sets only `transition`.

The new test pins all of that.

- [ ] **Step 1: Write the failing tests**

Create `test/components/focusRings.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { parseRules, isLayered } = require("../helpers/harness/cssRules");

const css = fs.readFileSync(path.join(__dirname, "../..", "src/index.css"), "utf8");

test("no unlayered rule can override a button's focus ring", () => {
  const offenders = parseRules(css).filter(
    (rule) =>
      !isLayered(rule) &&
      /\bbutton\b|\[role="(button|tab)"\]/.test(rule.selector) &&
      /:focus/.test(rule.selector) &&
      /\b(box-shadow|outline)\s*:/.test(rule.body)
  );
  assert.deepEqual(offenders.map((rule) => rule.selector), []);
});
```

In `test/components/colorRoles.test.js`, replace the body of `no Button variant changes filter or opacity on hover, press or focus` (lines 164–181) and add a mutation test after it:

```js
const FILTER_LIKE =
  /^(brightness|contrast|saturate|hue-rotate|invert|sepia|grayscale|blur|opacity|filter|drop-shadow)(-|$)|^\[(filter|opacity):/;
const INTERACTIVE = /^(hover|active|focus|focus-visible|focus-within|group-hover|peer-.*)$/;

// Classes that change filter or opacity on hover, press or focus.
function ringRecolouringClasses(classes) {
  return classes.filter((cls) => {
    const parts = cls.split(":"); // the old split; Step 3 replaces it
    const utility = parts[parts.length - 1];
    return FILTER_LIKE.test(utility) && parts.slice(0, -1).some((p) => INTERACTIVE.test(p));
  });
}

test("no Button variant changes filter or opacity on hover, press or focus", async () => {
  for (const variant of BUTTON_VARIANTS) {
    const classes = await buttonClasses(variant);
    assert.ok(classes.includes("focus-visible:ring-ring"), `${variant} has an opaque focus ring`);
    assert.deepEqual(
      ringRecolouringClasses(classes),
      [],
      `${variant} recolours the focus ring on hover, press or focus`
    );
  }
});

test("the filter/opacity guard catches arbitrary-property mutations", () => {
  const mutated = [
    "hover:[opacity:0.5]",
    "hover:[filter:brightness(1.1)]",
    "active:brightness-95",
    // Not offenders: no interactive prefix, or not a filter/opacity utility.
    "[opacity:0.5]",
    "hover:bg-cta-hover",
    "[&_svg]:size-4",
    "focus-visible:ring-ring",
  ];
  assert.deepEqual(ringRecolouringClasses(mutated), [
    "hover:[opacity:0.5]",
    "hover:[filter:brightness(1.1)]",
    "active:brightness-95",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/components/focusRings.test.js test/components/colorRoles.test.js`
Expected: FAIL. The mutation test reports only `["active:brightness-95"]`: the old colon split misses `hover:[opacity:0.5]` and `hover:[filter:brightness(1.1)]`.

The `focusRings` test passes at once against Foundations. It guards against later global CSS, so its first run is green.

To see the guard fail, temporarily add this to `src/index.css`, run the test, and confirm it names the selector. Then remove the rule.

```css
button:focus-visible { box-shadow: none; }
```

- [ ] **Step 3: Implement**

In `test/components/colorRoles.test.js`, add `splitVariants` above `FILTER_LIKE`, and change the line `const parts = cls.split(":"); // the old split; Step 3 replaces it` to `const parts = splitVariants(cls);`. There is no product change.

```js
// Splits a class into its variant prefixes and utility on colons that are
// outside brackets, so "hover:[opacity:0.5]" is ["hover", "[opacity:0.5]"]
// rather than three meaningless parts.
function splitVariants(cls) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of cls) {
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    if (ch === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}
```

`splitVariants` treats both `[…]` and `(…)` as nesting, so `[filter:brightness(1.1)]` stays one part.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/focusRings.test.js test/components/colorRoles.test.js test/components/brandGlow.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/components/focusRings.test.js test/components/colorRoles.test.js
git commit -m "test(a11y): guard focus rings against unlayered CSS and arbitrary-property filters"
```

---

### Task 4: Accessible, translated download progress bar

Covers SET-Q25 and the "Downloading" part of SET-Q6. This task also creates the shared renderer-test mocks that later tasks use.

**Motion.** The indeterminate loop moves onto the motion tokens: 4 × `--motion-slow` is 1440 ms, close to the old 1.5 s, with `--motion-ease-std`. The installing spinner becomes `motion-safe:animate-spin`. `animate-pulse` stays; it is an opacity-only loop, which the reduced-motion policy keeps, and it runs only while installing or indeterminate. Plan 01 defines no loop-duration token, so this plan composes from the existing ones rather than adding one.

The bar also stops using orange. D1 reserves orange for live voice, and the measured light pairs fail §4: orange text on white is 3.12:1, the orange fill on the muted track is 2.86:1, and the old border on the track is 1.16:1. The bar becomes an ink fill on a muted track edged with `--color-input-border` (Task 2). Secondary text drops its `/70` opacity.

**Files:**
- Create: `test/helpers/harness/rendererMocks.js`
- Modify: `src/components/ui/DownloadProgressBar.tsx` (whole component, 87 lines)
- Modify: `src/locales/{ar,de,en,es,fr,it,ja,pt,ru,zh-CN,zh-TW}/translation.json`. Add `models.downloadingNamed` and `models.installingNamed`.
- Modify: `DESIGN.md`, `### Roles`
- Test: `test/components/downloadProgressBar.test.js`

**Interfaces:**
- Consumes `--color-input-border` (Task 2), plus `resolveTokens` and `contrastRatio` (Plan 01).
- Produces `test/helpers/harness/rendererMocks.js`:
  - `I18N_KEYS_MOCK` (string). It is ESM source for a `react-i18next` mock whose `t(key)` returns `key`, and whose `t(key, { a: 1, b: "x" })` returns `key(a=1,b=x)`. It also exports `initReactI18next`, `Trans` and `I18nextProvider`, because `src/i18n.ts` imports them.
  - `TOAST_MOCK` (string). It is ESM source for `useToast()` returning `{ toast, dismiss }`. `toast(props)` pushes to `globalThis.__toasts`.
  - `rendererOptions(cachePrefix: string, mockModules?: Record<string, string>)`. It returns options for `createRendererServer` with `noExternal: ["react-i18next"]`, the `@` alias and the i18n mock merged in.
- `DownloadProgressBar` keeps its props (`modelName`, `progress: DownloadProgress`, `isInstalling?`). Its root now contains `role="progressbar"`, labelled by the visible "Downloading X" line.

- [ ] **Step 1: Create the shared mocks**

Create `test/helpers/harness/rendererMocks.js`:

```js
const path = require("node:path");

// react-i18next mock for Vite SSR renderer tests. Keys render verbatim so
// assertions match keys, not copy; interpolation options are appended as
// key(name=value,...) so they are visible too. initReactI18next, Trans and
// I18nextProvider exist because src/i18n.ts and a few components import them,
// and the module graph fails to load without them. It only applies with
// noExternal: ["react-i18next"], which rendererOptions sets.
const I18N_KEYS_MOCK = `
const format = (key, options) =>
  options
    ? key + "(" + Object.entries(options).map(([name, value]) => name + "=" + value).join(",") + ")"
    : key;
export const useTranslation = () => ({
  t: format,
  i18n: { language: "en", dir: () => globalThis.__i18nDir ?? "ltr" },
});
export const initReactI18next = { type: "3rdParty", init() {} };
export const Trans = ({ i18nKey }) => i18nKey;
export const I18nextProvider = ({ children }) => children;
`;

const TOAST_MOCK = `
export const useToast = () => ({
  toast(props) {
    (globalThis.__toasts ??= []).push(props);
    return String(globalThis.__toasts.length);
  },
  dismiss() {},
  dismissByPresentation() {},
  toastCount: 0,
  dictationErrorActionCount: 0,
});
`;

function rendererOptions(cachePrefix, mockModules = {}) {
  return {
    cachePrefix,
    noExternal: ["react-i18next"],
    resolveAlias: { "@": path.resolve(__dirname, "../../../src") },
    mockModules: { "react-i18next": I18N_KEYS_MOCK, ...mockModules },
  };
}

module.exports = { I18N_KEYS_MOCK, TOAST_MOCK, rendererOptions };
```

`mockModules` keys match the *import specifier suffix* (`test/lib/rendererTestHarness.js:124-128`). For example, `"/ui/useToast"` matches `../ui/useToast` and `./ui/useToast`, but not `./useToast`.

- [ ] **Step 2: Write the failing test**

Create `test/components/downloadProgressBar.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/DownloadProgressBar.tsx"),
  "utf8"
);

async function render(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-download-progress-bar-"));
  const { DownloadProgressBar } = await vite.ssrLoadModule(
    "/components/ui/DownloadProgressBar.tsx"
  );
  return renderToStaticMarkup(
    createElement(DownloadProgressBar, { modelName: "Parakeet", ...props })
  );
}

const progress = (overrides = {}) => ({
  percentage: 42.4,
  downloadedBytes: 265_000_000,
  totalBytes: 631_000_000,
  ...overrides,
});

test("a known percentage is a progressbar named by its visible label", async (t) => {
  const html = await render(t, { progress: progress() });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="42"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="100"/);
  const labelId = html.match(/<p id="([^"]+)"/)[1];
  assert.ok(html.includes(`aria-labelledby="${labelId}"`), "progressbar is labelled by the line");
});

test("the label is translated, never concatenated English", async (t) => {
  const downloading = await render(t, { progress: progress() });
  assert.match(downloading, /models\.downloadingNamed\(model=Parakeet\)/);
  const installing = await render(t, { progress: progress(), isInstalling: true });
  assert.match(installing, /models\.installingNamed\(model=Parakeet\)/);
  assert.doesNotMatch(source, /`(Downloading|Installing) \$\{modelName\}`/);
});

test("installing and byte-only downloads are indeterminate", async (t) => {
  const installing = await render(t, { progress: progress(), isInstalling: true });
  assert.match(installing, /role="progressbar"/);
  assert.doesNotMatch(installing, /aria-valuenow=/);
  const byteOnly = await render(t, { progress: progress({ totalBytes: 0 }) });
  assert.doesNotMatch(byteOnly, /aria-valuenow=/);
});

test("out-of-range or missing percentages are clamped before they reach the DOM", async (t) => {
  for (const [percentage, expected] of [
    [Number.NaN, "0"],
    [-5, "0"],
    [250, "100"],
  ]) {
    const html = await render(t, { progress: progress({ percentage }) });
    assert.match(html, new RegExp(`aria-valuenow="${expected}"`));
    assert.match(html, new RegExp(`width:${expected}%`));
    assert.doesNotMatch(html, />NaN%</);
  }
});

test("the bar's text and indicator clear the contrast floor in both themes", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
  const { light, dark } = resolveTokens(css);
  const pairs = [
    ["--color-foreground", "--color-muted", 4.5, "percentage on its chip, and the fill on the track"],
    ["--color-input-border", "--color-muted", 3, "track edge on the track"],
    ["--color-foreground", "--color-background", 4.5, "label"],
    ["--color-muted-foreground", "--color-background", 4.5, "speed and time left"],
    ["--color-muted-foreground", "--color-card", 4.5, "speed and time left on a card"],
  ];
  for (const [theme, tokens] of [
    ["light", light],
    ["Plum Night", dark],
  ])
    for (const [fg, bg, min, what] of pairs) {
      const ratio = contrastRatio(tokens[fg], tokens[bg]);
      assert.ok(ratio >= min, `${theme}: ${what} is ${ratio}:1`);
    }
});

test("the bar is built from those tokens, with no orange and no faded text", () => {
  assert.doesNotMatch(source, /text-primary|bg-primary|rgb\(255_90_31|border-white\/5|bg-white\/5/);
  assert.doesNotMatch(source, /text-muted-foreground\/\d+/);
  assert.match(source, /border-b border-border-subtle/);
  assert.match(source, /bg-muted ring-1 ring-inset ring-input-border/);
  assert.match(source, /text-xs font-bold text-foreground tabular-nums/);
  assert.match(source, /\bbg-foreground\b/);
});

test("the fill and the indeterminate loop use the shared motion tokens", () => {
  assert.match(source, /width var\(--motion-base\) var\(--motion-ease-std\)/);
  assert.doesNotMatch(source, /width 300ms ease-out/);
  assert.match(
    source,
    /animate-\[indeterminate_calc\(var\(--motion-slow\)\*4\)_var\(--motion-ease-std\)_infinite\]/
  );
  assert.doesNotMatch(source, /1\.5s|ease-in-out/);
  // A spinner is a transform loop: it only runs when motion is allowed.
  assert.match(source, /motion-safe:animate-spin/);
  assert.doesNotMatch(source, /(?<!motion-safe:)animate-spin/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/components/downloadProgressBar.test.js`
Expected: FAIL. "a known percentage…" fails on `role="progressbar"`, "the label is translated" fails on `models.downloadingNamed`, and "built from those tokens" finds `text-primary`.

- [ ] **Step 4: Implement**

Replace `src/components/ui/DownloadProgressBar.tsx` with:

```tsx
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "../icons";
import { formatETA, type DownloadProgress } from "../../hooks/useModelDownload";

interface DownloadProgressBarProps {
  modelName: string;
  progress: DownloadProgress;
  isInstalling?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)}KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)}GB`;
}

export function DownloadProgressBar({
  modelName,
  progress,
  isInstalling,
}: DownloadProgressBarProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const { percentage, downloadedBytes, totalBytes, speed, eta } = progress;
  // A disconnected progress stream can report NaN or overshoot; never render
  // either as text or as a bar width.
  const pct = Number.isFinite(percentage) ? Math.max(0, Math.min(100, Math.round(percentage))) : 0;
  const speedText = speed ? `${speed.toFixed(1)} MB/s` : "";
  const etaText = eta ? formatETA(eta) : "";
  const indeterminate = !isInstalling && totalBytes === 0 && downloadedBytes > 0;
  // ARIA spells "indeterminate" as a progressbar without aria-valuenow.
  const reportsValue = !isInstalling && !indeterminate;

  return (
    <div className="px-2.5 py-2 border-b border-border-subtle">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex items-center justify-center h-6 min-w-6 px-1.5 shrink-0">
          <div
            className={`absolute inset-0 rounded-md bg-muted ${isInstalling || indeterminate ? "animate-pulse" : ""}`}
          />
          {isInstalling ? (
            <Loader2 className="relative w-3.5 h-3.5 text-foreground motion-safe:animate-spin" />
          ) : (
            <span className="relative text-xs font-bold text-foreground tabular-nums">
              {indeterminate ? "···" : `${pct}%`}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p id={labelId} className="text-xs font-medium text-foreground truncate">
            {isInstalling
              ? t("models.installingNamed", { model: modelName })
              : t("models.downloadingNamed", { model: modelName })}
          </p>
          {!isInstalling && (indeterminate || speedText || etaText) && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {indeterminate && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatBytes(downloadedBytes)}
                </span>
              )}
              {speedText && (
                <span className="text-xs text-muted-foreground tabular-nums">{speedText}</span>
              )}
              {etaText && (
                <>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{etaText}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={reportsValue ? pct : undefined}
        // Ink fill on a muted track with a 3:1 edge. Orange means live voice (D1),
        // and an orange fill on this track was 2.86:1.
        className="w-full rounded-full overflow-hidden bg-muted ring-1 ring-inset ring-input-border"
        style={{ height: 4 }}
      >
        {indeterminate ? (
          <div className="h-full w-1/3 rounded-full bg-foreground animate-[indeterminate_calc(var(--motion-slow)*4)_var(--motion-ease-std)_infinite]" />
        ) : (
          <div
            className={`${isInstalling ? "animate-pulse" : ""} bg-foreground`}
            style={{
              height: "100%",
              width: `${isInstalling ? 100 : pct}%`,
              borderRadius: 9999,
              transition: "width var(--motion-base) var(--motion-ease-std)",
            }}
          />
        )}
      </div>
    </div>
  );
}
```

In `DESIGN.md` `### Roles`, append:

```markdown
- **Progress** (downloads, installs): ink fill on a muted track with an `--color-input-border` edge, and ink percentage text. Orange stays reserved for live voice.
```

Add the locale keys from the repo root:

```bash
node - <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const ADD = {
  "models.downloadingNamed": {
    en: "Downloading {{model}}", ar: "جارٍ تنزيل {{model}}", de: "{{model}} wird heruntergeladen",
    es: "Descargando {{model}}", fr: "Téléchargement de {{model}}", it: "Download di {{model}} in corso",
    ja: "{{model}} をダウンロード中", pt: "Baixando {{model}}", ru: "Загрузка {{model}}",
    "zh-CN": "正在下载 {{model}}", "zh-TW": "正在下載 {{model}}",
  },
  "models.installingNamed": {
    en: "Installing {{model}}", ar: "جارٍ تثبيت {{model}}", de: "{{model}} wird installiert",
    es: "Instalando {{model}}", fr: "Installation de {{model}}", it: "Installazione di {{model}} in corso",
    ja: "{{model}} をインストール中", pt: "Instalando {{model}}", ru: "Установка {{model}}",
    "zh-CN": "正在安装 {{model}}", "zh-TW": "正在安裝 {{model}}",
  },
};
for (const lang of fs.readdirSync("src/locales")) {
  const file = path.join("src/locales", lang, "translation.json");
  if (!fs.existsSync(file)) continue;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [key, values] of Object.entries(ADD)) {
    if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
    const parts = key.split(".");
    let node = json;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = values[lang];
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}
EOF
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/components/downloadProgressBar.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/harness/rendererMocks.js test/components/downloadProgressBar.test.js src/components/ui/DownloadProgressBar.tsx src/locales DESIGN.md
git commit -m "fix(a11y): accessible, translated download progress bar that clears contrast"
```

---

### Task 5: Pin the onboarding shell and clear the macOS traffic lights

Covers ONB-Q1.

**Files:**
- Modify: `src/styles/onboarding-welcome.css`. Add rules after `.onboarding-welcome-header` (lines 41–51), and inside `@media (max-width: 760px)` (from line 361).
- Modify: `src/components/OnboardingFlow.tsx`. `StepShell` (lines 143–243) gets a `platform` prop. Its call site (around line 1417) and the `WelcomeScreen` call site (around line 1402) pass `platform`.
- Modify: `src/components/onboarding/WelcomeScreen.tsx`. Add `platform?: string` to `WelcomeScreenProps` (line 7) and put it on the root `.onboarding-welcome`.
- Modify: `DESIGN.md` (D10)
- Test: `test/components/onboardingShell.test.js`

**Interfaces:**
- Consumes `rendererOptions` (Task 4).
- Produces a `data-platform` attribute (`"darwin" | "win32" | "linux"`) on every `.onboarding-welcome` root. The value comes from the existing `platform` const in `OnboardingFlow` (lines 1070–1075), which already honours the preview config.

Why this works:
- `src/index.css:342-349` (inside `@layer base` at `677057d`) sets only `min-height: 100vh` on `html`, `body` and `#root`. `.onboarding-welcome { height: 100% }` therefore resolves to `auto`, and the footer scrolls away with the content.
- `.onboarding-welcome-split` already scrolls (`overflow-y: auto`, `min-height: 0`, `flex: 1`). Once the shell is pinned, only the middle scrolls.
- On macOS the control panel is frameless with `trafficLightPosition: { x: 20, y: 20 }` (`src/helpers/windowConfig.js:241-245`). The lights cover about 20–72px from the window's left edge.

- [ ] **Step 1: Write the failing test**

Create `test/components/onboardingShell.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

test("the shell pins html, body and #root while onboarding is mounted", () => {
  const css = read("src/styles/onboarding-welcome.css");
  assert.match(
    css,
    /html:has\(\.onboarding-welcome\),\s*html:has\(\.onboarding-welcome\) body,\s*html:has\(\.onboarding-welcome\) #root\s*\{\s*height: 100%;\s*\}/
  );
  assert.doesNotMatch(read("src/index.css"), /onboarding-welcome/, "onboarding CSS stays out of index.css");
});

test("traffic-light clearance is physical, not logical, and survives the narrow layout", () => {
  const css = read("src/styles/onboarding-welcome.css");
  const wide = css.match(
    /\.onboarding-welcome\[data-platform="darwin"\] \.onboarding-welcome-header\s*\{([^}]*)\}/
  );
  assert.ok(wide, "macOS header rule exists");
  assert.match(wide[1], /padding-left: max\(84px, calc\(\(100vw - 1320px\) \/ 2\)\);/);
  assert.doesNotMatch(wide[1], /padding-inline-start/);
  const narrow = css.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/)[1];
  assert.match(
    narrow,
    /\.onboarding-welcome\[data-platform="darwin"\] \.onboarding-welcome-header\s*\{\s*padding-left: 84px;\s*\}/
  );
});

test("both shells carry the platform", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-onboarding-shell-"));
  const { default: WelcomeScreen } = await vite.ssrLoadModule(
    "/components/onboarding/WelcomeScreen.tsx"
  );
  const html = renderToStaticMarkup(
    createElement(WelcomeScreen, {
      platform: "darwin",
      updatesEnabled: true,
      onUpdatesChange() {},
      dataRetentionEnabled: true,
      onDataRetentionChange() {},
      onContinue() {},
      onExplore() {},
    })
  );
  assert.match(html, /<div class="onboarding-welcome" data-platform="darwin">/);

  const flow = read("src/components/OnboardingFlow.tsx");
  assert.match(
    flow,
    /<div className="onboarding-welcome onboarding-guided" data-platform=\{platform\}>/
  );
  assert.match(flow, /<StepShell[\s\S]*?platform=\{platform\}/);
  assert.match(flow, /<WelcomeScreen[\s\S]*?platform=\{platform\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/onboardingShell.test.js`
Expected: FAIL. No `html:has(.onboarding-welcome)` rule exists, and there is no `data-platform`.

- [ ] **Step 3: Implement**

1. In `src/styles/onboarding-welcome.css`, directly after the `.onboarding-welcome-header { … }` block (it ends at line 51), add:

   ```css
   /* The shell owns the window while onboarding is mounted. index.css only sets
      min-height on html, body and #root, so height: 100% on the shell resolved
      to auto and the footer scrolled away with the content. */
   html:has(.onboarding-welcome),
   html:has(.onboarding-welcome) body,
   html:has(.onboarding-welcome) #root {
     height: 100%;
   }

   /* macOS draws the traffic lights at x:20, y:20 (windowConfig.js) over this
      frameless header, about 52px wide. They stay on the physical left in RTL
      too, so this is padding-left on purpose, not padding-inline-start. */
   .onboarding-welcome[data-platform="darwin"] .onboarding-welcome-header {
     padding-left: max(84px, calc((100vw - 1320px) / 2));
   }
   ```

2. Inside the existing `@media (max-width: 760px) { … }` block, directly after its `.onboarding-welcome-header { … padding: 18px 24px; }` rule, add:

   ```css
     .onboarding-welcome[data-platform="darwin"] .onboarding-welcome-header {
       padding-left: 84px;
     }
   ```

3. In `src/components/OnboardingFlow.tsx`, change `StepShell`:
   - Add `platform,` to the destructured props and `platform: string;` to the props type.
   - Change the root to `<div className="onboarding-welcome onboarding-guided" data-platform={platform}>`.

4. In the same file, pass the existing `platform` const to both shells:

   ```tsx
         <WelcomeScreen
           platform={platform}
           updatesEnabled={updatesEnabled}
   ```

   ```tsx
       <StepShell
         platform={platform}
         step={step}
   ```

5. In `src/components/onboarding/WelcomeScreen.tsx`:
   - add `platform?: string;` to `WelcomeScreenProps`;
   - destructure `platform` in the component signature;
   - change the root `<div className="onboarding-welcome">` to `<div className="onboarding-welcome" data-platform={platform}>`.

**DESIGN.md (D10).** In `## Layout`, after the sentence "Onboarding uses a narrower 48rem content column, wider side padding at larger window sizes, and a persistent progress header and footer.", add: "The onboarding shell pins `html`, `body` and `#root` to the window, so only the middle scrolls. On macOS the header keeps 84px of physical left padding (also in RTL) to clear the traffic lights."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/onboardingShell.test.js test/components/onboardingCleanupWiring.test.js test/components/personalWorkspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/onboarding-welcome.css src/components/OnboardingFlow.tsx src/components/onboarding/WelcomeScreen.tsx DESIGN.md test/components/onboardingShell.test.js
git commit -m "fix(onboarding): pin the shell and clear the macOS traffic lights"
```

---

### Task 6: Real speech-model download progress in onboarding

Covers ONB-Q2.

**Files:**
- Create: `test/helpers/harness/fakeDomTree.js`. This moves `installTree` out of `test/components/onboardingCleanupWiring.test.js` (lines 11–99) and adds `find` and `props`.
- Modify: `test/components/onboardingCleanupWiring.test.js`. Import `installTree`, and add the toast mock to `createRendererServer`.
- Modify: `test/components/personalWorkspace.test.js:27-30`. Add the toast mock.
- Modify: `src/hooks/useModelDownload.ts`:
  - optional-call the progress subscriptions (lines 269–278);
  - make `cancelDownload` (lines 457–484) resolve `true` only when main confirms the cancel.
- Modify: `src/components/OnboardingFlow.tsx`:
  - imports;
  - `SpeechStep` (lines 319–463);
  - `StepShell` footer (lines 221–241);
  - `OnboardingFlow` state and `downloadModel` (lines 1037–1051, 1154–1188);
  - the `SpeechStep` and `StepShell` call sites (around lines 1339 and 1417).
- Modify: `src/styles/onboarding-welcome.css`. Add `.onboarding-download-chip`.
- Modify: `src/locales/*/translation.json`. Add `onboarding.download.chip`, `onboarding.download.chipInstalling`, `onboarding.download.start` and `onboarding.download.inProgress`. The two button labels are touched here anyway, so they stop being literal English. Plan 05 still owns the rest of the onboarding copy.
- Test: `test/components/onboardingDownloadProgress.test.js`

**Interfaces:**
- Consumes:
  - `useModelDownload({ modelType: "parakeet" })` from `src/hooks/useModelDownload.ts`. It returns `downloads: Record<modelId, { phase: "downloading" | "installing"; progress; downloadedBytes; totalBytes }>`, `cancelDownload(modelId?)` and `isCancellingModel(modelId)`.
  - Main's `cancel-parakeet-download` (`src/helpers/parakeet.js:593-605`) returns `{ success: true }`, or `{ success: false, code: "INSTALLATION_IN_PROGRESS" }` once extraction has started.
  - `DownloadProgressBar` (Task 4).
  - `rendererOptions` and `TOAST_MOCK` (Task 4).
- Produces:
  - `test/helpers/harness/fakeDomTree.js` exports `installTree()`, which returns `{ container, click(label), text(), find(predicate), props(node) }`. `props(node)` returns the props React stored on a node, so tests can call `onChange` or `onKeyDown` directly.
  - `useModelDownload().cancelDownload(modelId?)` now returns `Promise<boolean>`: `true` only when main confirmed the cancel. Existing callers ignore the value, so they are unaffected.
  - `StepShell` gets an optional `footerStatus?: ReactNode`, rendered between Back and the right-hand button group.

Design notes:
- `useModelDownload` listens to every Parakeet progress event, whoever started the download. Onboarding keeps starting the download through its own `downloadModel`, so it keeps its own ready and error states, and it reads progress and cancel from the hook.
- A request generation counter (`downloadRequestRef`) makes a cancelled request's late result inert.
- **Onboarding only drops a download after main confirms the cancel.** Main refuses once extraction starts, and a click can race that transition. On a refusal, the download stays visible and its result still counts.
- `cancelDownload` no-ops while installing, so Cancel is hidden during install.
- **Download stays disabled until the hook stops tracking the model.** Main reports the aborted request with a terminal event, so a retry cannot collide with a request that is still winding down.
- The hook needs `ToastProvider`. The app provides it in `src/renderApp.jsx:32`, and the two existing onboarding tests now mock it.

- [ ] **Step 1: Extract the fake DOM tree**

Create `test/helpers/harness/fakeDomTree.js`. Move the body of `installTree` from `test/components/onboardingCleanupWiring.test.js` lines 14–99 verbatim, then add `find` and export it:

```js
const assert = require("node:assert/strict");
const React = require("react");

// A tiny element tree for react-dom/client tests. The shared fake DOM has no
// events, so click() invokes the onClick React stored on the node.
function installTree() {
  const document = globalThis.document;
  // ...the `make`, createElement/createElementNS/createTextNode overrides,
  // `container`, `walk`, `click` and `text` from onboardingCleanupWiring.test.js
  // lines 15-97, unchanged...
  const find = (predicate) => {
    let found = null;
    walk(container, (node) => {
      if (!found && predicate(node)) found = node;
    });
    return found;
  };
  // The props React stored on a node, for driving onChange or onKeyDown directly.
  const props = (node) => node[Object.keys(node).find((name) => name.startsWith("__reactProps$"))];
  return { container, click, text, find, props };
}

module.exports = { installTree };
```

The comment marks where the moved lines go. Nothing in them changes, so copy them exactly and keep `make`, `walk`, `click` and `text` as they are. In `test/components/onboardingCleanupWiring.test.js`:
- delete the local `installTree` function and its comment (lines 11–99);
- add `const { installTree } = require("../helpers/harness/fakeDomTree");` after the harness `require`.

- [ ] **Step 2: Write the failing test**

Create `test/components/onboardingDownloadProgress.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function mountSpeechStep(t, { cancelResult = { success: true } } = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const calls = { downloads: [], cancels: 0 };
  const pending = [];
  const listeners = {};
  const api = {
    getPlatform: () => "darwin",
    downloadParakeetModel: (model) => {
      calls.downloads.push(model);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    cancelParakeetDownload: async () => {
      calls.cancels += 1;
      return cancelResult;
    },
    onParakeetDownloadProgress: (callback) => {
      listeners.progress = callback;
      return () => {};
    },
    personalInference: {
      codexStatus: async () => ({ available: false, account: null }),
      codexModels: async () => ({ data: [] }),
      codexRateLimits: async () => ({}),
      onTextEvent: () => () => {},
    },
  };
  installBrowserGlobals(t, {
    window: {
      electronAPI: new Proxy(api, {
        get(target, name) {
          if (name in target) return target[name];
          if (typeof name === "symbol" || name === "then") return undefined;
          return () => (/^on[A-Z]/.test(String(name)) ? () => {} : Promise.resolve());
        },
      }),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-onboarding-download-", { "/ui/useToast": TOAST_MOCK })
  );
  const { default: OnboardingFlow } = await vite.ssrLoadModule("/components/OnboardingFlow.tsx");
  root = createRoot(tree.container);
  await React.act(async () => {
    root.render(React.createElement(OnboardingFlow, { onComplete() {}, initialStep: "speech" }));
  });
  const progress = async (model, percentage) =>
    React.act(async () =>
      listeners.progress({}, {
        type: "progress",
        model,
        percentage,
        downloaded_bytes: 265_000_000,
        total_bytes: 631_000_000,
      })
    );
  // A terminal event from main: the hook stops tracking the model.
  const settle = async (model, data) =>
    React.act(async () => listeners.progress({}, { model, ...data }));
  const progressbar = () => tree.find((node) => node.attributes?.role === "progressbar");
  const downloadButton = () =>
    tree.find((node) => node.tagName === "BUTTON" && node.textContent.includes("onboarding.download.start"));
  return { ...tree, calls, pending, progress, settle, progressbar, downloadButton };
}

test("the speech step shows the real download percentage", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  assert.equal(flow.calls.downloads.length, 1);
  await flow.progress(flow.calls.downloads[0], 42);
  const bar = flow.progressbar();
  assert.ok(bar, "a progressbar replaces the pulsing placeholder");
  assert.equal(bar.attributes["aria-valuenow"], "42");
  const placeholder = flow.find((node) =>
    /\bw-2\/3 animate-pulse\b/.test(node.attributes?.class ?? "")
  );
  assert.equal(placeholder, null, "the fake two-thirds bar is gone");
});

test("a download in flight follows the user to later steps as a footer chip", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  await flow.progress(flow.calls.downloads[0], 42);
  await flow.click("Continue");
  assert.match(flow.text(), /onboarding\.download\.chip\(percent=42\)/);
});

test("a confirmed cancel returns to idle and a late result cannot mark it interrupted", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  await flow.progress(flow.calls.downloads[0], 42);
  await flow.click("common.cancel");
  assert.equal(flow.calls.cancels, 1);
  // Main reports the aborted request after the user already cancelled.
  await React.act(async () => flow.pending[0].resolve({ success: false, error: "cancelled" }));
  assert.match(flow.text(), /Download the selected model/);
  assert.doesNotMatch(flow.text(), /The download was interrupted/);
  assert.equal(flow.progressbar(), null);
});

test("a cancel main refuses keeps the download and its result", async (t) => {
  const flow = await mountSpeechStep(t, {
    cancelResult: { success: false, code: "INSTALLATION_IN_PROGRESS" },
  });
  await flow.click("onboarding.download.start");
  await flow.progress(flow.calls.downloads[0], 99);
  await flow.click("common.cancel");
  assert.equal(flow.calls.cancels, 1);
  assert.ok(flow.progressbar(), "the download is still on screen");
  await React.act(async () => flow.pending[0].resolve({ success: true, downloaded: true }));
  assert.match(flow.text(), /is ready/, "its success still marks the model ready");
});

test("Download stays disabled until the cancelled request settles", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("onboarding.download.start");
  const model = flow.calls.downloads[0];
  await flow.progress(model, 42);
  await flow.click("common.cancel");
  assert.equal(flow.downloadButton().attributes.disabled, "", "main has not settled the request yet");
  await flow.settle(model, { type: "error", code: "DOWNLOAD_CANCELLED", error: "cancelled" });
  assert.equal(flow.downloadButton().attributes.disabled, undefined);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/components/onboardingDownloadProgress.test.js`
Expected: FAIL on "a progressbar replaces the pulsing placeholder", because `progressbar()` returns `null`. The refused-cancel test fails too: today's cancel switches to idle at once.

- [ ] **Step 4: Implement**

1. In `src/hooks/useModelDownload.ts`, make the three subscriptions optional calls (lines 269–278). Without this, any `electronAPI` that lacks the method throws inside an effect: the browser preview stub, or a test's `{}`.

   ```ts
       const dispose =
         modelType === "whisper"
           ? window.electronAPI?.onWhisperDownloadProgress?.((_event, data) =>
               handleNativeProgress(data)
             )
           : modelType === "parakeet"
             ? window.electronAPI?.onParakeetDownloadProgress?.((_event, data) =>
                 handleNativeProgress(data)
               )
             : window.electronAPI?.onModelDownloadProgress?.(handleLLMProgress);
   ```

   In the same file, make `cancelDownload` (lines 457–484) report whether main confirmed it. Change its body to:

   ```ts
     const cancelDownload = useCallback(
       async (modelId?: string): Promise<boolean> => {
         const targetModel = modelId || Object.keys(downloads)[0];
         if (!targetModel || cancellingModels.has(targetModel)) return false;
         if (downloads[targetModel]?.phase === "installing") return false;

         setCancellingModels((current) => new Set(current).add(targetModel));
         try {
           const result =
             modelType === "whisper"
               ? await window.electronAPI?.cancelWhisperDownload()
               : modelType === "parakeet"
                 ? await window.electronAPI?.cancelParakeetDownload()
                 : await window.electronAPI?.modelCancelDownload?.(targetModel);
           if (result?.success) {
             toast({
               title: t("hooks.modelDownload.downloadCancelled.title"),
               description: t("hooks.modelDownload.downloadCancelled.description"),
             });
             return true;
           }
         } catch (error) {
           console.error("Failed to cancel download:", error);
         }
         clearCancelling(targetModel);
         return false;
       },
       [cancellingModels, clearCancelling, downloads, modelType, t, toast]
     );
   ```

   The only changes are the `Promise<boolean>` return type, `return false` on the two early exits and the failure path, and `return true` after a confirmed cancel.

2. In `src/components/OnboardingFlow.tsx`, add imports:

   ```ts
   import { useTranslation } from "react-i18next";
   import { useModelDownload, type DownloadProgress } from "../hooks/useModelDownload";
   import { DownloadProgressBar } from "./ui/DownloadProgressBar";
   ```

   and a module-level constant next to `STEPS`:

   ```ts
   // The browser preview has no download pipeline; show a believable mid-download state.
   const PREVIEW_DOWNLOAD_PROGRESS: DownloadProgress = {
     percentage: 42,
     downloadedBytes: 265_000_000,
     totalBytes: 631_000_000,
   };
   ```

3. `StepShell`: add `footerStatus?: ReactNode;` to the props type and `footerStatus,` to the destructuring. In the footer, render it between the Back button and the right-hand `<div>`:

   ```tsx
         <footer className="onboarding-welcome-actions">
           <button className="onboarding-welcome-back" type="button" onClick={onBack}>
             Back
           </button>
           {footerStatus}
           <div>
   ```

4. `SpeechStep`:
   - Add these props (type and destructuring): `downloadProgress: DownloadProgress; downloadInstalling: boolean; downloadCancelling: boolean; downloadSettling: boolean; onCancelDownload: () => void;`.
   - Add `const { t } = useTranslation();` as the first line of the body.
   - Replace the Download button (lines 439–446) with:

   ```tsx
               <Button
                 onClick={onDownload}
                 disabled={
                   downloadState === "downloading" || downloadSettling || !selectedSupportsLanguage
                 }
               >
                 <Download className="me-2 h-4 w-4" />
                 {downloadState === "downloading"
                   ? t("onboarding.download.inProgress")
                   : t("onboarding.download.start")}
               </Button>
   ```

   Then replace the fake bar (lines 448–452) with:

   ```tsx
           {downloadState === "downloading" && (
             <div className="mt-3 flex items-end gap-3">
               <div className="min-w-0 flex-1">
                 <DownloadProgressBar
                   modelName={selected.name}
                   progress={downloadProgress}
                   isInstalling={downloadInstalling}
                 />
               </div>
               {!downloadInstalling && (
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={onCancelDownload}
                   disabled={downloadCancelling}
                 >
                   {t("common.cancel")}
                 </Button>
               )}
             </div>
           )}
   ```

5. `OnboardingFlow`: add the following directly after the `downloadState` `useState` (it ends around line 1053):

   ```ts
     const { t } = useTranslation();
     // The hook owns progress events and cancel for the Parakeet pipeline. The
     // download still starts through downloadModel below, so onboarding keeps
     // its own ready and error state.
     const {
       downloads: speechDownloadStatus,
       cancelDownload: cancelSpeechModelDownload,
       isCancellingModel,
     } = useModelDownload({ modelType: "parakeet" });
     // Each start or cancel bumps this, so a cancelled request's late result is ignored.
     const downloadRequestRef = useRef(0);
     const liveSpeechDownload = speechDownloadStatus[selectedModel];
     const speechProgress: DownloadProgress = preview
       ? PREVIEW_DOWNLOAD_PROGRESS
       : {
           percentage: liveSpeechDownload?.progress ?? 0,
           downloadedBytes: liveSpeechDownload?.downloadedBytes ?? 0,
           totalBytes: liveSpeechDownload?.totalBytes ?? 0,
         };
     const speechInstalling = liveSpeechDownload?.phase === "installing";
     const speechCancelling = !preview && isCancellingModel(selectedModel);
     // After a cancel, main still has to wind the old request down; the hook
     // keeps tracking the model until its terminal event arrives.
     const speechSettling =
       speechCancelling || (downloadState !== "downloading" && Boolean(liveSpeechDownload));
   ```

6. Replace `downloadModel` (lines 1155–1188) with a guarded version, and add `cancelSpeechDownload` after it:

   ```ts
     const downloadModel = useCallback(() => {
       const requestedModel = selectedModel;
       const request = ++downloadRequestRef.current;
       const isCurrent = () =>
         request === downloadRequestRef.current && selectedModelRef.current === requestedModel;
       setDownloadState("downloading");
       if (preview) {
         window.setTimeout(() => {
           if (!isCurrent()) return;
           const ready = scenario !== "download-interrupted";
           setDownloadState(ready ? "ready" : "error");
           setSpeechModelReady(ready);
           if (config && ready)
             localStorage.setItem(
               `${onboardingPreviewStorageKey(config)}.speechReadyModel`,
               requestedModel
             );
         }, 500);
         return;
       }
       const download = window.electronAPI?.downloadParakeetModel;
       if (!download) {
         setDownloadState("error");
         return;
       }
       void download(requestedModel)
         .then((result) => {
           if (!isCurrent()) return;
           const ready = Boolean(result?.success && result?.downloaded);
           setSpeechModelReady(ready);
           setDownloadState(ready ? "ready" : "error");
         })
         .catch(() => {
           if (isCurrent()) setDownloadState("error");
         });
     }, [config, preview, scenario, selectedModel]);

     const cancelSpeechDownload = useCallback(async () => {
       // Drop the request only once main confirms. It refuses after extraction
       // starts; the download then keeps running and its result still counts.
       if (!preview && !(await cancelSpeechModelDownload(selectedModelRef.current))) return;
       downloadRequestRef.current += 1;
       setDownloadState("idle");
     }, [cancelSpeechModelDownload, preview]);
   ```

7. Pass the new props at the `SpeechStep` call site:

   ```tsx
           downloadProgress={speechProgress}
           downloadInstalling={speechInstalling}
           downloadCancelling={speechCancelling}
           downloadSettling={speechSettling}
           onCancelDownload={() => void cancelSpeechDownload()}
   ```

   and add the chip at the `StepShell` call site:

   ```tsx
         footerStatus={
           step !== "speech" && downloadState === "downloading" ? (
             <span className="onboarding-download-chip">
               {speechInstalling
                 ? t("onboarding.download.chipInstalling")
                 : t("onboarding.download.chip", {
                     percent: Math.round(speechProgress.percentage),
                   })}
             </span>
           ) : undefined
         }
   ```

   The chip is deliberately not a live region. Progress ticks every 100 ms, and announcing each tick would drown out the step content. The speech step's progressbar is where assistive tech reads the value.

8. In `src/styles/onboarding-welcome.css`, after the `.onboarding-welcome-actions > div { … }` block, add:

   ```css
   .onboarding-download-chip {
     display: inline-flex;
     min-height: 28px;
     align-items: center;
     padding-inline: 12px;
     border: 1px solid var(--ow-border);
     border-radius: 999px;
     color: var(--ow-secondary);
     font-size: 12px;
     font-variant-numeric: tabular-nums;
     white-space: nowrap;
   }
   ```

   `--ow-secondary` (#525252) on `--ow-panel` (#fff) is 7.8:1.

9. Add the toast mock to the two existing OnboardingFlow tests. The hook calls `useToast()` at the top level, and that throws without a provider.
   - In `test/components/onboardingCleanupWiring.test.js`, change `createRendererServer(t, { cachePrefix: "loqui-onboarding-wiring-test-" })` to:

     ```js
       const vite = await createRendererServer(t, {
         cachePrefix: "loqui-onboarding-wiring-test-",
         mockModules: { "/ui/useToast": TOAST_MOCK },
       });
     ```

     and add `const { TOAST_MOCK } = require("../helpers/harness/rendererMocks");`.
   - In `test/components/personalWorkspace.test.js`, add `"/ui/useToast": TOAST_MOCK,` to the `mockModules` object at lines 27–30, plus the same `require`.

10. Add the locale keys:

    ```bash
    node - <<'EOF'
    const fs = require("node:fs");
    const path = require("node:path");
    const ADD = {
      "onboarding.download.chip": {
        en: "Downloading voice model · {{percent}}%", ar: "جارٍ تنزيل نموذج الصوت · {{percent}}%",
        de: "Sprachmodell wird heruntergeladen · {{percent}}%", es: "Descargando modelo de voz · {{percent}}%",
        fr: "Téléchargement du modèle vocal · {{percent}}%", it: "Download del modello vocale · {{percent}}%",
        ja: "音声モデルをダウンロード中 · {{percent}}%", pt: "Baixando modelo de voz · {{percent}}%",
        ru: "Загрузка голосовой модели · {{percent}}%", "zh-CN": "正在下载语音模型 · {{percent}}%",
        "zh-TW": "正在下載語音模型 · {{percent}}%",
      },
      "onboarding.download.start": {
        en: "Download model", ar: "تنزيل النموذج", de: "Modell herunterladen", es: "Descargar modelo",
        fr: "Télécharger le modèle", it: "Scarica modello", ja: "モデルをダウンロード", pt: "Baixar modelo",
        ru: "Скачать модель", "zh-CN": "下载模型", "zh-TW": "下載模型",
      },
      "onboarding.download.inProgress": {
        en: "Downloading…", ar: "جارٍ التنزيل…", de: "Wird heruntergeladen…", es: "Descargando…",
        fr: "Téléchargement…", it: "Download in corso…", ja: "ダウンロード中…", pt: "Baixando…",
        ru: "Загрузка…", "zh-CN": "正在下载…", "zh-TW": "正在下載…",
      },
      "onboarding.download.chipInstalling": {
        en: "Installing voice model", ar: "جارٍ تثبيت نموذج الصوت", de: "Sprachmodell wird installiert",
        es: "Instalando el modelo de voz", fr: "Installation du modèle vocal",
        it: "Installazione del modello vocale", ja: "音声モデルをインストール中",
        pt: "Instalando o modelo de voz", ru: "Установка голосовой модели",
        "zh-CN": "正在安装语音模型", "zh-TW": "正在安裝語音模型",
      },
    };
    for (const lang of fs.readdirSync("src/locales")) {
      const file = path.join("src/locales", lang, "translation.json");
      if (!fs.existsSync(file)) continue;
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [key, values] of Object.entries(ADD)) {
        if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
        const parts = key.split(".");
        let node = json;
        for (const part of parts.slice(0, -1)) node = node[part] ??= {};
        node[parts.at(-1)] = values[lang];
      }
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    }
    EOF
    ```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/components/onboardingDownloadProgress.test.js test/components/onboardingCleanupWiring.test.js test/components/personalWorkspace.test.js test/hooks/modelDownloadErrors.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/harness/fakeDomTree.js test/components/onboardingDownloadProgress.test.js test/components/onboardingCleanupWiring.test.js test/components/personalWorkspace.test.js src/hooks/useModelDownload.ts src/components/OnboardingFlow.tsx src/styles/onboarding-welcome.css src/locales
git commit -m "feat(onboarding): real speech-model download progress with cancel"
```

---

### Task 7: Dictation errors stay long enough to read, and never drop a transcript

Covers VO-Q6. This is a minimal change to the existing toast. Plan 04 migrates it to `notify({ kind: "alert" })` (§5.3).

**Files:**
- Modify: `src/helpers/toastPresentation.js:24-31` (`getDictationErrorDuration`)
- Modify: `src/hooks/useAudioRecording.js:323-330` (the `toast({...})` inside `showDictationError`)
- Test: `test/helpers/toastPresentation.test.js:49-62`, and add a case to `test/helpers/useAudioRecordingForceStop.test.js`

**Interfaces:**
- `getDictationErrorDuration(title, description)` keeps its signature. It now returns `6000 | 8000 | 10000`.
- A dictation-error toast whose card offers "View transcript" is created with `duration: 0`. The provider treats that as no auto-dismiss (`src/components/ui/Toast.tsx:97` only starts a timer when `duration > 0`).

The transcript never reaches the toast as a field. The decision belongs in `showDictationError` (`src/hooks/useAudioRecording.js:300`), which computes `recoverableTranscript` at line 303. `getDictationErrorDuration` only sees title and description, so the rule cannot live there.

- [ ] **Step 1: Write the failing tests**

In `test/helpers/toastPresentation.test.js`, replace the three duration tests (lines 49–62) with:

```js
test("short dictation errors stay for six seconds", async () => {
  const { getDictationErrorDuration } = await load();
  assert.equal(getDictationErrorDuration("Paste Error", "Please try again."), 6000);
});

test("medium dictation errors stay for eight seconds", async () => {
  const { getDictationErrorDuration } = await load();
  assert.equal(getDictationErrorDuration("Error", "a".repeat(100)), 8000);
});

test("long dictation errors stay for ten seconds", async () => {
  const { getDictationErrorDuration } = await load();
  assert.equal(getDictationErrorDuration("Error", "a".repeat(200)), 10000);
});
```

At the end of `test/helpers/useAudioRecordingForceStop.test.js`, add:

```js
test("an error card that holds the transcript never auto-dismisses", async (t) => {
  const harness = await mountHarness(t);
  await harness.forceStop("timeout");
  await harness.complete();
  const [toast] = errorToasts(harness);
  assert.ok(toast.actions.some((a) => a.icon === "transcript"));
  assert.equal(toast.duration, 0, "the user's words stay until they act on them");
});

test("an error card without a transcript keeps the reading-time timer", async (t) => {
  const harness = await mountHarness(t);
  await React.act(async () =>
    globalThis.__forceStopAudioManager.callbacks.onError({ message: "Network down" })
  );
  const [toast] = errorToasts(harness);
  assert.ok(toast, "the error is shown");
  assert.equal(toast.duration, undefined, "the provider picks 6/8/10 s from the text length");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/toastPresentation.test.js test/helpers/useAudioRecordingForceStop.test.js`
Expected: FAIL. `3000 !== 6000`, and `toast.duration` is `undefined`, not `0`.

- [ ] **Step 3: Implement**

In `src/helpers/toastPresentation.js`, replace the function and its comment (lines 24–31):

```js
/** Dictation errors interrupt someone mid-task: give every message time to be
 * read twice. Detailed failures get longer. */
export function getDictationErrorDuration(title = "", description = "") {
  const messageLength = [title, description].filter(Boolean).join(" ").trim().length;

  if (messageLength <= SHORT_MESSAGE_MAX_LENGTH) return 6000;
  if (messageLength <= MEDIUM_MESSAGE_MAX_LENGTH) return 8000;
  return 10000;
}
```

In `src/hooks/useAudioRecording.js`, inside `showDictationError`, change the `toast({...})` call (lines 323–330) to:

```js
      toast({
        title,
        description,
        variant: "destructive",
        presentation: "dictation-error",
        // A card holding the only copy of the user's words stays until they
        // act on it: View transcript, Retry, close, or the next dictation.
        duration: recoverableTranscript ? 0 : duration,
        actions,
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/toastPresentation.test.js test/helpers/useAudioRecordingForceStop.test.js test/hooks/dictationErrorAutoHide.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/toastPresentation.js src/hooks/useAudioRecording.js test/helpers/toastPresentation.test.js test/helpers/useAudioRecordingForceStop.test.js
git commit -m "fix(voice): longer dictation error timers; keep cards that hold a transcript"
```

---

### Task 8: Toasts announce themselves and keep a visible close button

Covers VO-Q9. This is a minimal change to the existing toast. Plan 04 owns the replacement `notify()`.

**Files:**
- Modify: `src/components/ui/Toast.tsx`:
  - export the item component (line 238, `const Toast`);
  - the root `<div>` opening tag (lines 353–364; the element closes at line 456);
  - the copy button `aria-label` (line 394);
  - the close button (lines 427–443).
- Modify: `DESIGN.md` (D10)
- Test: `test/components/toastLiveRegion.test.js`

**Interfaces:**
- Consumes `rendererOptions` (Task 4).
- Produces `export const Toast` (previously module-private). The props are unchanged: `ToastState & { onClose?, onPauseTimer, onResumeTimer }`.

Notes:
- `DictationErrorCard` already has `role="alert"` (`src/components/dictation/DictationErrorCard.tsx:123`). Only the standard presentation lacks a live region.
- `test/components/rtlMotion.test.js` asserts the class string `toast-enter opacity-100 translate-x-0 scale-100`. Keep it byte-identical.

- [ ] **Step 1: Write the failing test**

Create `test/components/toastLiveRegion.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/Toast.tsx"),
  "utf8"
);

async function renderToast(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-toast-live-region-"));
  const { Toast } = await vite.ssrLoadModule("/components/ui/Toast.tsx");
  return renderToStaticMarkup(
    createElement(Toast, {
      id: "1",
      title: "Saved",
      description: "Your note was saved.",
      presentation: "standard",
      duration: 3500,
      createdAt: 0,
      isExiting: false,
      onClose() {},
      onPauseTimer() {},
      onResumeTimer() {},
      ...props,
    })
  );
}

test("a standard toast is a polite status region", async (t) => {
  const html = await renderToast(t, { variant: "default" });
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
});

test("a destructive toast is an assertive alert", async (t) => {
  const html = await renderToast(t, { variant: "destructive", title: "Couldn't save" });
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-live="assertive"/);
});

test("the close button is visible at rest, full strength on hover or focus, and named", async (t) => {
  const html = await renderToast(t, { variant: "default" });
  const close = html.match(/<button type="button" class="([^"]*-start-2[^"]*)"/);
  assert.ok(close, "close is a type=button");
  assert.match(close[1], /\bopacity-50\b/);
  assert.match(close[1], /group-hover:opacity-100/);
  assert.match(close[1], /focus-visible:opacity-100/);
  assert.doesNotMatch(close[1], /\bopacity-0\b/);
  assert.match(close[1], /focus-visible:ring-2 focus-visible:ring-ring/, "full-opacity ring (Task 3)");
  assert.doesNotMatch(close[1], /ring-white\/\d+/);
  assert.match(html, /<span class="sr-only">common\.close<\/span>/);
});

test("no hard-coded English accessible names remain", () => {
  assert.doesNotMatch(source, /aria-label="Copy error"/);
  assert.doesNotMatch(source, /<span className="sr-only">Close<\/span>/);
  assert.match(source, /aria-label=\{t\("common\.copy"\)\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/toastLiveRegion.test.js`
Expected: FAIL. `Toast` is `undefined` (not exported), so `createElement` throws.

- [ ] **Step 3: Implement**

1. Line 238: change `const Toast: React.FC<` to `export const Toast: React.FC<`.
2. Add live-region attributes to the standard root `<div>` (line 353). Leave the `className` untouched:

   ```tsx
       <div
         role={isDestructive ? "alert" : "status"}
         aria-live={isDestructive ? "assertive" : "polite"}
         aria-atomic="true"
         className={cn(
   ```

3. Line 394: change `aria-label="Copy error"` to `aria-label={t("common.copy")}`.
4. Replace the close button (lines 428–442) with:

   ```tsx
           <button
             type="button"
             onClick={onClose}
             className={cn(
               "absolute -start-2 -top-2 size-6 rounded-full",
               "flex items-center justify-center",
               "bg-white/10 backdrop-blur-sm border border-white/10",
               "text-white/70 hover:text-white hover:bg-white/20",
               // Visible at rest so it is discoverable without a mouse; full
               // strength on hover or keyboard focus.
               "opacity-50 group-hover:opacity-100 focus-visible:opacity-100",
               "transition-opacity duration-150",
               "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
             )}
           >
             <X className="size-3" aria-hidden="true" />
             <span className="sr-only">{t("common.close")}</span>
           </button>
   ```

`common.close` ("Close") and `common.copy` ("Copy") already exist in every locale.

**DESIGN.md (D10).** Under `## Components`, add a `### Toasts` subsection after `### Chips`:

```markdown
### Toasts
- **Announcement:** standard toasts are polite status regions (`role="status"`); destructive toasts are assertive alerts (`role="alert"`). Dictation-error cards already announce as alerts.
- **Close:** always visible at 50% opacity, full strength on hover or keyboard focus, with a 2px `--color-ring` focus ring and a translated name.
- **Timing:** dictation errors stay 6, 8 or 10 seconds by length; a card that holds the user's only copy of a transcript stays until the user acts. Plan 04 replaces this surface with `notify()` and keeps both rules.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/toastLiveRegion.test.js test/components/rtlMotion.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Toast.tsx DESIGN.md test/components/toastLiveRegion.test.js
git commit -m "fix(a11y): live regions on toasts and a visible, named close button"
```

---

### Task 9: Esc stays armed until the pipeline is idle

Covers VO-Q8. It is compatible with D3 (Plan 04 adds instant cancel with undo on top).

**Files:**
- Modify: `src/hooks/useAudioRecording.js`:
  - move the Esc registration in `performStartRecording` (lines 187–218);
  - drop the release in `performStopRecording` (line 259);
  - move the release in `onStateChange` to the idle edge (lines 341–347);
  - add a release to the effect cleanup (lines 785–798).
- Modify: `src/App.jsx:358-369`. Route the cancel hotkey to processing too.
- Test: `test/helpers/useAudioRecordingCancelHotkey.test.js`

**Interfaces:**
- Consumes:
  - `window.electronAPI.registerCancelHotkey(key)` and `unregisterCancelHotkey()` (`preload.js:541-543`). These map to `hotkeyManager.registerSlot("cancel", …)` in `src/helpers/ipcHandlers.js:3510-3521`.
  - `cancelProcessing()`, which is already exported by `useAudioRecording` and implemented in `src/helpers/audioManager.js:1745`.
- Produces this invariant for Plan 04: the cancel hotkey is registered from the moment a recording exists until `onStateChange` reports `!isRecording && !isProcessing`, or until the hook unmounts. That includes a recording whose stop landed while the mic was still opening.

Today Esc is registered in one place and released in four.
- **Registered** only at line 214, after the stop-during-start branch (lines 194–206) has already returned. A stop that lands while the mic is opening therefore never arms Esc for its processing. Registration moves to the moment `didStart` is known.
- **Released in four places:**
  - `performStartRecording`'s stop-during-start path (line 196). Remove it; Esc is now armed just above it.
  - `performStopRecording` (line 259). Remove it.
  - The `!isRecording` branch of `onStateChange` (line 342). That branch fires on the recording→processing edge, so move the release to the idle edge.
  - `cancelRecording` (line 818). Keep it; the user already cancelled.

`App.jsx:365` also ignored the hotkey unless recording.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/useAudioRecordingCancelHotkey.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

// A manager whose state the test drives. startRecording and stopRecording
// emit the same onStateChange sequence the real AudioManager does.
const FAKE_AUDIO_MANAGER_SOURCE = `
export default class FakeAudioManager {
  constructor() {
    this.voiceAgentRequested = false;
    this.translationRequested = false;
    this.sttConfig = {};
    this.state = { isRecording: false, isProcessing: false, isStreaming: false };
    globalThis.__cancelHotkeyManager = this;
  }
  getState() { return this.state; }
  setCallbacks(callbacks) { this.callbacks = callbacks; }
  setVoiceAgentRequested() {}
  setAssistantSelectionContext() {}
  setTranslationRequested() {}
  shouldUseStreaming() { return false; }
  emit(next) {
    this.state = { ...this.state, ...next };
    this.callbacks.onStateChange({ ...this.state });
  }
  // With globalThis.__holdStart set, the mic "opens" only when the test calls
  // releaseStart(), so a stop can land while the start holds the lock.
  startRecording() {
    if (!globalThis.__holdStart) {
      this.emit({ isRecording: true });
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      this.releaseStart = () => {
        this.emit({ isRecording: true });
        resolve(true);
      };
    });
  }
  getRecordingAudioLevel() { return 0; }
  stopRecording() {
    this.stopCalls = (this.stopCalls ?? 0) + 1;
    this.emit({ isRecording: false, isProcessing: true });
    return true;
  }
  cancelProcessing() { this.emit({ isProcessing: false }); return true; }
  cancelRecording() { this.emit({ isRecording: false }); return true; }
  cancelPreparedMicCapture() {}
  cleanup() {}
}
`;

const SETTINGS_STORE_SOURCE = `
export const useSettingsStore = { subscribe: () => () => {} };
export const getSettings = () => ({ pauseMediaOnDictation: false, voiceAgentScreenContext: false, snippets: [] });
`;

const LOGGER_SOURCE = `
const noop = () => {};
export default { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, logReasoning: noop };
`;

const TRANSLATION_SOURCE = `
const translate = (key) => key;
export const useTranslation = () => ({ t: translate });
`;

async function mountHarness(t) {
  let root = null;
  const unmount = async () => {
    if (!root) return;
    const current = root;
    root = null;
    await React.act(async () => current.unmount());
  };
  t.after(unmount);
  const hotkey = [];
  const noopDispose = () => () => {};
  const NOOP = () => {};
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noopDispose,
        onToggleVoiceAgent: noopDispose,
        onToggleTranslation: noopDispose,
        onStartDictation: noopDispose,
        onPrepareDictation: noopDispose,
        onCancelDictationPreparation: noopDispose,
        onStopDictation: noopDispose,
        onDictationForceStopped: noopDispose,
        dictationLifecycleStateChanged: NOOP,
        completeDictationPreview: NOOP,
        hideDictationPreview: NOOP,
        setScreenContextEnabled: NOOP,
        registerCancelHotkey: async (key) => hotkey.push(`register:${key}`),
        unregisterCancelHotkey: async () => hotkey.push("unregister"),
      },
    },
  });
  const container = installHookDom(t);
  // installHookDom stubs requestAnimationFrame with a no-op; give
  // waitForVisualFrames real frames. installHookDom restores the original.
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-cancel-hotkey-",
    noExternal: ["react-i18next"],
    mockModules: {
      "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE,
      "/stores/settingsStore": SETTINGS_STORE_SOURCE,
      "/utils/logger": LOGGER_SOURCE,
      "react-i18next": TRANSLATION_SOURCE,
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const api = {};
  // Stable across renders: the hook's main effect depends on toast, and a new
  // function each render would re-run it and add unrelated unregister calls.
  const toast = () => "";
  const options = { onDemoEvent: NOOP };
  function Harness() {
    Object.assign(api, useAudioRecording(toast, options));
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const manager = () => globalThis.__cancelHotkeyManager;
  const waitFor = async (check) => {
    for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
    assert.ok(check(), "condition reached");
  };
  return {
    hotkey,
    unmount,
    start: () => React.act(async () => api.startRecording()),
    stop: () => React.act(async () => api.stopRecording()),
    emit: (next) => React.act(async () => manager().emit(next)),
    manager,
    // Starts a recording that waits in the mic-open phase until released.
    // Returns { pending } rather than the promise itself: an async function
    // that returned the held promise would adopt it, and awaiting the helper
    // would then wait for a start that only the test can release.
    beginHeldStart: async () => {
      let pending;
      await React.act(async () => {
        pending = api.startRecording();
        await waitFor(() => typeof manager().releaseStart === "function");
      });
      return { pending };
    },
    releaseStart: (pending) =>
      React.act(async () => {
        manager().releaseStart();
        await pending;
      }),
  };
}

// The arming that happens before recording starts is not under test.
const sinceStart = (hotkey) => hotkey.slice(hotkey.indexOf("register:Escape"));

test("Esc stays registered while a dictation is processing", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"]);
  await h.emit({ isRecording: false, isProcessing: true });
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"], "processing keeps Esc armed");
});

test("Esc is released on the idle edge", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.emit({ isRecording: false, isProcessing: true });
  await h.emit({ isProcessing: false });
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape", "unregister"]);
});

test("stopping a recording does not release Esc before processing ends", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.stop();
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"]);
});

test("a stop that lands mid-start still arms Esc for processing", { timeout: 10_000 }, async (t) => {
  globalThis.__holdStart = true;
  t.after(() => delete globalThis.__holdStart);
  const h = await mountHarness(t);
  const { pending } = await h.beginHeldStart();
  await h.stop(); // lands while the start still holds the lock
  assert.equal(h.manager().stopCalls ?? 0, 0, "the stop is deferred, not yet applied");
  await h.releaseStart(pending); // the mic opens; the hook honours the stop
  assert.equal(h.manager().stopCalls, 1, "the deferred stop ran after the release");
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape"], "processing can be cancelled");
  await h.emit({ isProcessing: false });
  assert.deepEqual(sinceStart(h.hotkey), ["register:Escape", "unregister"]);
});

test("unmounting releases Esc even mid-processing", async (t) => {
  const h = await mountHarness(t);
  await h.start();
  await h.emit({ isRecording: false, isProcessing: true });
  await h.unmount();
  assert.equal(h.hotkey.at(-1), "unregister");
});

test("the cancel hotkey cancels processing when nothing is recording", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../src/App.jsx"), "utf8");
  assert.match(
    app,
    /onCancelHotkeyPressed\?\.\(\(\) => \{\s*if \(isRecordingRef\.current\) cancelRecording\(\);\s*else if \(isProcessingRef\.current\) cancelProcessing\(\);/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/useAudioRecordingCancelHotkey.test.js`
Expected: FAIL. "processing keeps Esc armed" sees an extra `"unregister"`, "a stop that lands mid-start" finds no `register:Escape` at all, and the App.jsx assertion fails.

- [ ] **Step 3: Implement**

1. In `src/hooks/useAudioRecording.js`, `performStartRecording`:
   - Replace line 190, `if (didStart) dismissDictationError?.();`, with:

     ```js
             if (didStart) {
               dismissDictationError?.();
               // Arm Esc as soon as a recording exists, including one whose stop
               // landed mid-start: its processing must be cancellable too (D3).
               // onStateChange releases it at idle; a start that is already idle
               // (a tap that ended inside the start call) releases it right here.
               window.electronAPI?.registerCancelHotkey?.("Escape");
               const started = audioManagerRef.current.getState();
               if (!started.isRecording && !started.isProcessing) {
                 window.electronAPI?.unregisterCancelHotkey?.();
               }
             }
     ```

   - In the stop-during-start branch, delete line 196, `window.electronAPI?.unregisterCancelHotkey?.();`.
   - In the `if (didStart && audioManagerRef.current.getState().isRecording) {` block, delete line 214, `window.electronAPI?.registerCancelHotkey?.("Escape");`. Keep the media pause and the start cue.

2. `performStopRecording`: delete line 259, `window.electronAPI?.unregisterCancelHotkey?.();`. Put this comment in its place:

   ```js
         // Esc stays armed through processing; onStateChange releases it at idle.
   ```

3. In `onStateChange`, replace the opening of the `if (!isRecording) {` block (lines 341–343):

   ```js
           if (!isRecording) {
             window.electronAPI?.unregisterCancelHotkey?.();
             // Resume media the instant recording ends, not after transcription.
   ```

   with:

   ```js
           if (!isRecording && !isProcessing) {
             // Esc is armed from recording start until the whole pipeline is
             // idle, so the keyboard can cancel a slow transcription (D3).
             window.electronAPI?.unregisterCancelHotkey?.();
           }
           if (!isRecording) {
             // Resume media the instant recording ends, not after transcription.
   ```

4. In the main effect's cleanup (`return () => {` at line 785), add the following as the first statement after `reportLifecycle("idle");`:

   ```js
         // Never leave a global Esc capture behind a reload or a route change.
         window.electronAPI?.unregisterCancelHotkey?.();
   ```

5. In `src/App.jsx`, replace lines 358–369 with:

   ```jsx
     const isRecordingRef = useRef(isRecording);
     const isProcessingRef = useRef(isProcessing);

     useLayoutEffect(() => {
       isRecordingRef.current = isRecording;
       isProcessingRef.current = isProcessing;
     }, [isRecording, isProcessing]);

     useEffect(() => {
       // useAudioRecording keeps Esc registered until the pipeline is idle, so
       // the hotkey cancels whichever phase is running.
       const unsubscribe = window.electronAPI?.onCancelHotkeyPressed?.(() => {
         if (isRecordingRef.current) cancelRecording();
         else if (isProcessingRef.current) cancelProcessing();
       });
       return () => unsubscribe?.();
     }, [cancelRecording, cancelProcessing]);
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/useAudioRecordingCancelHotkey.test.js test/helpers/useAudioRecordingForceStop.test.js test/helpers/useAudioRecordingPreparingReset.test.js test/helpers/audioManagerCancelLifecycle.test.js test/helpers/voicePillPresentation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioRecording.js src/App.jsx test/helpers/useAudioRecordingCancelHotkey.test.js
git commit -m "fix(voice): keep Esc armed until the dictation pipeline is idle"
```

---

### Task 10: Native notification when meeting audio is lost

Covers VO-Q16, per D2: "Interruption alerts go out as native notifications regardless of focus". See Contract change request 1.

**Files:**
- Create: `src/helpers/systemNotification.js`
- Modify: `src/helpers/ipcHandlers.js`. Add `Notification` to the line-1 `require("electron")`, and add a handler next to `sync-notification-preferences` (line 9373).
- Modify: `preload.js`. Add `showSystemNotification` after `syncNotificationPreferences` (line 1083).
- Modify: `src/types/electron.ts`. Add the method type after `syncNotificationPreferences?` (line 2241).
- Modify: `src/components/MeetingRecordingMount.tsx`. Add a native-notice effect after the interruption effect (after line 173), and add a native call to the mic effect (lines 175–193).
- Test: `test/helpers/systemNotification.test.js`. Also extend `test/components/meetingInterruptionWarning.test.js`.

**Interfaces:**
- Produces `src/helpers/systemNotification.js`:
  - `MAX_TITLE_LENGTH = 120`, `MAX_BODY_LENGTH = 400`;
  - `normalizeSystemNotification(payload): { title: string; body: string } | null`;
  - `showSystemNotification({ Notification, payload, prefs, onClick }): { success: boolean; reason?: "disabled" | "unsupported" | "invalid" }`.
- Produces the preload method `window.electronAPI.showSystemNotification(payload: { title: string; body?: string }): Promise<{ success: boolean; reason?: string }>`.
- Consumes the existing translated copy only:
  - `notes.meeting.systemAudioStopped.*` and `notes.meeting.systemAudioQuiet.*`;
  - `hooks.audioRecording.micDisconnected.title` and `.meetingDescription`.

Behaviour:
- A native notice fires once per interruption nonce, whether or not the window is focused or visible. The existing in-app toast keeps its focus gate.
- `recovering` interruptions are self-healing and stay toast-only.
- Main honours the master `notificationsEnabled` preference (`windowManager.notificationPrefs`, `src/helpers/windowManager.js:79`).
- Electron can garbage-collect a `Notification` before its click arrives, so main keeps a reference until `close` or `click`.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/systemNotification.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  normalizeSystemNotification,
  showSystemNotification,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
} = require("../../src/helpers/systemNotification");

function fakeNotificationClass({ supported = true } = {}) {
  const shown = [];
  class FakeNotification extends EventEmitter {
    static isSupported() {
      return supported;
    }
    constructor(options) {
      super();
      this.options = options;
    }
    show() {
      shown.push(this);
    }
  }
  return { FakeNotification, shown };
}

test("payloads are trimmed, capped and rejected when there is no title", () => {
  assert.equal(normalizeSystemNotification(null), null);
  assert.equal(normalizeSystemNotification({ title: "   " }), null);
  assert.equal(normalizeSystemNotification({ title: 42 }), null);
  const long = normalizeSystemNotification({ title: "t".repeat(500), body: "b".repeat(900) });
  assert.equal(long.title.length, MAX_TITLE_LENGTH);
  assert.equal(long.body.length, MAX_BODY_LENGTH);
  assert.deepEqual(normalizeSystemNotification({ title: " Audio stopped " }), {
    title: "Audio stopped",
    body: "",
  });
});

test("a valid payload shows one notification and click runs the focus handler", () => {
  const { FakeNotification, shown } = fakeNotificationClass();
  let clicks = 0;
  const result = showSystemNotification({
    Notification: FakeNotification,
    payload: { title: "Meeting audio stopped", body: "Check your output device." },
    prefs: { notificationsEnabled: true },
    onClick: () => clicks++,
  });
  assert.deepEqual(result, { success: true });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.title, "Meeting audio stopped");
  shown[0].emit("click");
  assert.equal(clicks, 1);
});

test("the master notifications switch and unsupported platforms are honoured", () => {
  const { FakeNotification, shown } = fakeNotificationClass();
  assert.deepEqual(
    showSystemNotification({
      Notification: FakeNotification,
      payload: { title: "x" },
      prefs: { notificationsEnabled: false },
    }),
    { success: false, reason: "disabled" }
  );
  const unsupported = fakeNotificationClass({ supported: false });
  assert.deepEqual(
    showSystemNotification({ Notification: unsupported.FakeNotification, payload: { title: "x" } }),
    { success: false, reason: "unsupported" }
  );
  assert.deepEqual(
    showSystemNotification({ Notification: FakeNotification, payload: {} }),
    { success: false, reason: "invalid" }
  );
  assert.equal(shown.length, 0);
});

test("the bridge is wired through preload and main", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  assert.match(
    read("preload.js"),
    /showSystemNotification: \(payload\) =>\s*ipcRenderer\.invoke\("show-system-notification", payload\)/
  );
  assert.match(read("src/helpers/ipcHandlers.js"), /ipcMain\.handle\("show-system-notification"/);
  assert.match(read("src/types/electron.ts"), /showSystemNotification\?: \(payload: \{/);
});
```

In `test/components/meetingInterruptionWarning.test.js`:
- add this method to the `api` object in `setup` (it starts at line 21):

  ```js
      showSystemNotification(payload) {
        globalThis.__nativeNotices.push(payload);
        return Promise.resolve({ success: true });
      },
  ```

- add `globalThis.__nativeNotices = [];` next to `globalThis.__interruptionToasts = [];`;
- append these tests:

```js
test("a lost meeting audio source raises one native notification even while hidden", async (t) => {
  const { interrupt, focus } = await setup(t);
  globalThis.document.hidden = true;
  globalThis.document.visibilityState = "hidden";
  await interrupt();
  assert.equal(globalThis.__interruptionToasts.length, 0, "the in-app warning still waits");
  assert.equal(globalThis.__nativeNotices.length, 1);
  assert.equal(globalThis.__nativeNotices[0].title, "Meeting audio stopped");
  await focus(false);
  assert.equal(globalThis.__nativeNotices.length, 1, "no replay on focus changes");
});

test("a recovering interruption stays in-app only", async (t) => {
  const { interrupt } = await setup(t);
  await interrupt({ recovering: true });
  assert.equal(globalThis.__nativeNotices.length, 0);
});

test("a remount does not replay a delivered native notification", async (t) => {
  const { interrupt, render } = await setup(t);
  await interrupt({ reason: "gone_quiet" });
  assert.equal(globalThis.__nativeNotices[0].title, "Meeting audio has gone quiet");
  await render(false);
  await render(true);
  assert.equal(globalThis.__nativeNotices.length, 1);
});

test("losing the microphone mid-meeting raises a native notification", async (t) => {
  const { store } = await setup(t);
  await React.act(async () =>
    store.useMeetingRecordingStore.setState({ micCaptureStatus: "unavailable" })
  );
  assert.equal(globalThis.__nativeNotices.length, 1);
  assert.equal(globalThis.__nativeNotices[0].title, "Microphone disconnected");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/systemNotification.test.js test/components/meetingInterruptionWarning.test.js`
Expected: FAIL. `Cannot find module '../../src/helpers/systemNotification'`, and `__nativeNotices.length` is 0.

- [ ] **Step 3: Implement**

1. Create `src/helpers/systemNotification.js`:

   ```js
   // Native OS notifications requested by a renderer. Main owns them so they
   // reach the user when the window is hidden, unfocused or on another Space,
   // which is when an in-app toast cannot (D2).
   const MAX_TITLE_LENGTH = 120;
   const MAX_BODY_LENGTH = 400;

   // Electron can garbage-collect a Notification before its click fires; hold
   // each one until the OS closes it or the user clicks it.
   const active = new Set();

   function normalizeSystemNotification(payload) {
     if (!payload || typeof payload !== "object") return null;
     const title = typeof payload.title === "string" ? payload.title.trim() : "";
     if (!title) return null;
     const body = typeof payload.body === "string" ? payload.body.trim() : "";
     return { title: title.slice(0, MAX_TITLE_LENGTH), body: body.slice(0, MAX_BODY_LENGTH) };
   }

   function showSystemNotification({ Notification, payload, prefs, onClick }) {
     if (prefs && prefs.notificationsEnabled === false) return { success: false, reason: "disabled" };
     if (!Notification || !Notification.isSupported()) return { success: false, reason: "unsupported" };
     const content = normalizeSystemNotification(payload);
     if (!content) return { success: false, reason: "invalid" };
     const notification = new Notification({ title: content.title, body: content.body });
     active.add(notification);
     const release = () => active.delete(notification);
     notification.on("close", release);
     notification.on("click", () => {
       release();
       onClick?.();
     });
     notification.show();
     return { success: true };
   }

   module.exports = {
     MAX_TITLE_LENGTH,
     MAX_BODY_LENGTH,
     normalizeSystemNotification,
     showSystemNotification,
   };
   ```

2. In `src/helpers/ipcHandlers.js`:
   - change line 1 to `const { ipcMain, app, shell, BrowserWindow, systemPreferences, net, Notification } = require("electron");`;
   - add `const { showSystemNotification } = require("./systemNotification");` with the other local requires at the top of the file;
   - directly before `ipcMain.handle("sync-notification-preferences", …)` (line 9373), add:

   ```js
       ipcMain.handle("show-system-notification", async (event, payload) =>
         showSystemNotification({
           Notification,
           payload,
           prefs: this.windowManager.notificationPrefs,
           onClick: () => {
             const win = BrowserWindow.fromWebContents(event.sender);
             if (!win || win.isDestroyed()) return;
             if (win.isMinimized()) win.restore();
             win.show();
             win.focus();
           },
         })
       );
   ```

3. In `preload.js`, after the `syncNotificationPreferences` entry (lines 1083–1084), add:

   ```js
     showSystemNotification: (payload) =>
       ipcRenderer.invoke("show-system-notification", payload),
   ```

4. In `src/types/electron.ts`, after the `syncNotificationPreferences?` member (lines 2241–2243), add:

   ```ts
         showSystemNotification?: (payload: {
           title: string;
           body?: string;
         }) => Promise<{ success: boolean; reason?: "disabled" | "unsupported" | "invalid" }>;
   ```

5. In `src/components/MeetingRecordingMount.tsx`:
   - Add a module-level variable after the imports:

     ```ts
     // Survives remounts within this renderer, so a route change never replays a
     // native notification that already went out.
     let lastNativeInterruptionNonce: number | null = null;
     ```

   - After the interruption effect (it ends at line 173), add:

     ```tsx
       // Native delivery does not wait for focus: a hidden or covered window is
       // exactly when the in-app warning above cannot be seen (D2, VO-Q16).
       useEffect(() => {
         const state = useMeetingRecordingStore.getState();
         const interruption = state.systemAudioInterrupted;
         if (!state.isRecording || !interruption || interruption.recovering) return;
         if (lastNativeInterruptionNonce === state.systemAudioInterruptedNonce) return;
         lastNativeInterruptionNonce = state.systemAudioInterruptedNonce;
         const key =
           interruption.reason === "gone_quiet"
             ? "notes.meeting.systemAudioQuiet"
             : "notes.meeting.systemAudioStopped";
         void window.electronAPI?.showSystemNotification?.({
           title: t(`${key}.title`),
           body: t(`${key}.description`),
         });
       }, [isRecording, systemAudioInterrupted, systemAudioInterruptedNonce, t]);
     ```

   - In the mic effect, inside `if (micCaptureStatus === "unavailable" && !wasMicUnavailable.current) {`, after the existing `toast({...})`, add:

     ```tsx
           void window.electronAPI?.showSystemNotification?.({
             title: t("hooks.audioRecording.micDisconnected.title"),
             body: t("hooks.audioRecording.micDisconnected.meetingDescription"),
           });
     ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/systemNotification.test.js test/components/meetingInterruptionWarning.test.js test/helpers/preloadOnboardingBridge.test.js`
Expected: PASS, including every existing interruption test (the toast gating is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/helpers/systemNotification.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/components/MeetingRecordingMount.tsx test/helpers/systemNotification.test.js test/components/meetingInterruptionWarning.test.js
git commit -m "feat(meetings): native notification when meeting audio or the mic is lost"
```

---

### Task 11: "Now" keeps moving in Coming up

Covers WS-Q1.

**Files:**
- Create: `src/hooks/useNow.ts`
- Create: `src/utils/upcomingEventGroups.ts`. This moves `DayGroup`, `MAX_DAY_CARDS` and `groupEventsByDay` out of `UpcomingMeetings.tsx` (lines 38–71), and adds `isEventLive`.
- Modify: `src/components/UpcomingMeetings.tsx`:
  - imports (lines 1–15);
  - delete the moved code (lines 37–71, keeping `MAX_STACKED_AVATARS`);
  - the `now` and `isNowFn` code (lines 290–297).
- Test: `test/utils/upcomingEventGroups.test.js` and `test/hooks/useNow.test.js`

**Interfaces:**
- Produces:
  - `useNow(intervalMs?: number, readClock?: () => Date): Date`, with default `NOW_TICK_MS = 30_000` and `readClock = () => new Date()`. The clock parameter exists so tests can advance time exactly. The guarantee is that "today" rolls over within one tick (≤30 s) of local midnight; Plan 06 should state the same guarantee, not "at midnight";
  - `groupEventsByDay(events: CalendarEvent[], now: Date): DayGroup[]`;
  - `isEventLive(event: Pick<CalendarEvent, "start_time" | "end_time">, now: Date): boolean`;
  - `type DayGroup`.

Facts from the code:
- The audit's line 290 is right.
- There is no "in N min" label and no time-based early join. The join button reveals on hover or focus (lines 218–229). What freezes is the `isNow` flip and the `isToday` grouping.
- Day keys are `toDateString()` (local time). They roll over at midnight once `now` advances, and a 30 s tick lands within 30 s of midnight.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/upcomingEventGroups.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const load = () => import("../../src/utils/upcomingEventGroups.ts");
const at = (h, m = 0, day = 15) => new Date(2026, 9, day, h, m);
const event = (start, end, summary = "Standup") => ({
  id: summary,
  summary,
  start_time: start.toISOString(),
  end_time: end.toISOString(),
});

test("an event is live from its start to its end, inclusive", async () => {
  const { isEventLive } = await load();
  const standup = event(at(9), at(9, 30));
  assert.equal(isEventLive(standup, at(8, 59)), false);
  assert.equal(isEventLive(standup, at(9)), true);
  assert.equal(isEventLive(standup, at(9, 30)), true);
  assert.equal(isEventLive(standup, at(9, 31)), false);
});

test("unparseable times are never live", async () => {
  const { isEventLive } = await load();
  assert.equal(isEventLive({ start_time: "nope", end_time: "nope" }, at(9)), false);
});

test("an all-day event is live across its local day, matching its day group", async () => {
  const { isEventLive } = await load();
  const allDay = { start_time: "2026-10-15", end_time: "2026-10-16" };
  assert.equal(isEventLive(allDay, at(0, 30)), true);
  assert.equal(isEventLive(allDay, at(23, 30)), true);
  assert.equal(isEventLive(allDay, at(9, 0, 14)), false);
});

test("'today' moves with the clock across midnight", async () => {
  const { groupEventsByDay } = await load();
  const events = [event(at(9, 0, 16), at(9, 30, 16))];
  const before = groupEventsByDay(events, at(23, 59, 15));
  assert.equal(before[0].isToday, true, "an empty today card leads before midnight");
  assert.equal(before[1].isToday, false);
  const after = groupEventsByDay(events, at(0, 0, 16));
  assert.equal(after.length, 1);
  assert.equal(after[0].isToday, true, "the 16th becomes today after midnight");
});

test("UpcomingMeetings no longer freezes its clock", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/components/UpcomingMeetings.tsx"),
    "utf8"
  );
  assert.doesNotMatch(source, /useMemo\(\(\) => new Date\(\), \[\]\)/);
  assert.match(source, /const now = useNow\(\);/);
  assert.match(source, /isEventLive\(event, now\)/);
});
```

Create `test/hooks/useNow.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

test("useNow re-renders once per tick and clears its interval on unmount", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-use-now-" });
  const { useNow, NOW_TICK_MS } = await vite.ssrLoadModule("/hooks/useNow.ts");
  assert.equal(NOW_TICK_MS, 30_000);

  // Drive the interval by hand: one tick per act, so React cannot batch two
  // ticks into one render, and the clear on unmount is observable. React's
  // scheduler uses setTimeout/setImmediate, not setInterval.
  const intervals = new Map();
  const cleared = [];
  let nextId = 1;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, ms) => {
    const id = nextId++;
    intervals.set(id, { callback, ms });
    return id;
  };
  globalThis.clearInterval = (id) => {
    cleared.push(id);
    intervals.delete(id);
  };
  t.after(() => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  });

  // A clock the test moves by hand, starting 30 s before local midnight.
  let clock = new Date(2026, 9, 15, 23, 59, 30).getTime();
  const readClock = () => new Date(clock);
  const seen = [];
  function Harness() {
    seen.push(useNow(NOW_TICK_MS, readClock));
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  assert.equal(intervals.size, 1, "one interval while mounted");
  const [[id, interval]] = [...intervals];
  assert.equal(interval.ms, NOW_TICK_MS);

  assert.equal(seen.at(-1).getTime(), new Date(2026, 9, 15, 23, 59, 30).getTime());

  const before = seen.length;
  clock += NOW_TICK_MS;
  await React.act(async () => interval.callback());
  assert.equal(seen.length, before + 1, "one render per tick");
  assert.equal(seen.at(-1).getTime(), new Date(2026, 9, 16, 0, 0, 0).getTime(), "exactly 30 s later");
  assert.equal(seen.at(-1).getDate(), 16, "the date rolled over at midnight");
  clock += NOW_TICK_MS;
  await React.act(async () => interval.callback());
  assert.equal(seen.length, before + 2);
  assert.equal(seen.at(-1).getTime(), new Date(2026, 9, 16, 0, 0, 30).getTime());

  await React.act(async () => root.unmount());
  root = null;
  assert.deepEqual(cleared, [id], "the interval is cleared on unmount");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/utils/upcomingEventGroups.test.js test/hooks/useNow.test.js`
Expected: FAIL with `Cannot find module` for both new modules.

- [ ] **Step 3: Implement**

Create `src/hooks/useNow.ts`:

```ts
import { useEffect, useState } from "react";

/** 30 s keeps a live label at most half a minute late and rolls "today" over
 * within 30 s of local midnight, at the cost of one cheap re-render. */
export const NOW_TICK_MS = 30_000;

const systemClock = () => new Date();

/** A clock for time-relative UI ("Now", "today"). `readClock` exists so tests
 * can move time exactly; callers leave it at the system clock. */
export function useNow(intervalMs: number = NOW_TICK_MS, readClock: () => Date = systemClock): Date {
  const [now, setNow] = useState(readClock);
  useEffect(() => {
    setNow(readClock());
    const id = setInterval(() => setNow(readClock()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, readClock]);
  return now;
}
```

Create `src/utils/upcomingEventGroups.ts`. Move the code verbatim from `UpcomingMeetings.tsx` lines 38–71, export it, and add `isEventLive`:

```ts
import type { CalendarEvent } from "../types/calendar";
import { parseEventDate } from "./dateFormatting";

// Today plus the next days that have events, capped at a working week.
export const MAX_DAY_CARDS = 5;

export interface DayGroup {
  key: string;
  date: Date;
  isToday: boolean;
  items: CalendarEvent[];
}

export function groupEventsByDay(events: CalendarEvent[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const event of events) {
    const date = parseEventDate(event.start_time);
    if (!date) continue;
    const key = date.toDateString();
    let group = byKey.get(key);
    if (!group) {
      group = { key, date, isToday: key === now.toDateString(), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(event);
  }
  // Surface "today" even when it has nothing scheduled, so the list always
  // answers "what's next today?" at a glance.
  if (groups.length > 0 && !groups.some((g) => g.isToday)) {
    groups.unshift({ key: now.toDateString(), date: now, isToday: true, items: [] });
  }
  return groups.slice(0, MAX_DAY_CARDS);
}

/** Live from start to end, inclusive. Uses parseEventDate like the grouping
 * above, so an all-day "YYYY-MM-DD" event is read in local time, not UTC
 * (the old isNowFn used new Date() and disagreed west of UTC). Unparseable
 * times compare false. */
export function isEventLive(
  event: Pick<CalendarEvent, "start_time" | "end_time">,
  now: Date
): boolean {
  const start = parseEventDate(event.start_time);
  const end = parseEventDate(event.end_time);
  if (!start || !end) return false;
  return start <= now && now <= end;
}
```

In `src/components/UpcomingMeetings.tsx`:
- Delete lines 38–39 (`MAX_DAY_CARDS` and its comment), the `DayGroup` interface and `groupEventsByDay` (lines 43–71). Keep `MAX_STACKED_AVATARS`.
- Remove the `parseEventDate` import (line 15), and add:

  ```ts
  import { useNow } from "../hooks/useNow";
  import { groupEventsByDay, isEventLive, type DayGroup } from "../utils/upcomingEventGroups";
  ```

- Replace lines 290–297 with:

  ```tsx
    const now = useNow();
    const groupedEvents = useMemo(() => groupEventsByDay(events, now), [events, now]);

    const isNowFn = (event: CalendarEvent) => isEventLive(event, now);
  ```

`DayCard` keeps using `DayGroup`, which is now an imported type. `useMemo` is still imported and used.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/utils/upcomingEventGroups.test.js test/hooks/useNow.test.js test/components/directionalContentPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNow.ts src/utils/upcomingEventGroups.ts src/components/UpcomingMeetings.tsx test/utils/upcomingEventGroups.test.js test/hooks/useNow.test.js
git commit -m "fix(workspace): Coming up keeps \"Now\" and \"today\" current"
```

---

### Task 12: A real chat composer

Covers WS-Q5, part 1: an auto-growing textarea, the IME guard, staying typeable while the agent works, and full-opacity focus rings. Task 13 adds the queue and lossless sends on top.

**Files:**
- Create: `src/components/chat/chatInputKeys.ts`
- Modify: `src/components/chat/ChatInput.tsx`:
  - imports (line 1);
  - `inputRef` (line 68);
  - `handleKeyDown` (lines 94–102), with the state lines 104–108 moved above it;
  - the container (lines 118–127);
  - the `<input>` and its row (lines 200–218);
  - every `focus-visible:ring-1 focus-visible:ring-ring/30` (lines 167, 182, 228, 242, 264).
- Test: `test/components/chatComposer.test.js`

**Interfaces:**
- Produces `src/components/chat/chatInputKeys.ts`:
  - `type ComposerKeyAction = "submit" | "queue" | "unqueue" | "none"`;
  - `resolveComposerKey(input: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number; isBusy: boolean; isQueued: boolean; hasText: boolean }): ComposerKeyAction`;
  - `COMPOSER_MAX_HEIGHT_PX = 160`;
  - `composerHeight(scrollHeight: number, maxHeight?: number): { height: number; overflowY: "hidden" | "auto" }`.
- `ChatInput` is a named export (`ChatInput.tsx:55`). All four callers import `{ ChatInput }`, and their props do not change in this task.
- Consumes `rendererOptions` and `TOAST_MOCK` (Task 4).

Behaviour after this task:
- **While the agent is busy (`thinking | streaming | tool-executing`),** the textarea stays editable. Enter does nothing yet, so the draft just stays in the box. Task 13 turns that Enter into a queue.
- **Line breaks and IME:** Shift+Enter inserts a newline, and Enter during IME composition does nothing.
- **Tests:** `fieldDirectionPolicy.test.js:78` expects exactly one `dir="auto"` native field in this file. The `<textarea … />` replaces the `<input … />` one for one.

- [ ] **Step 1: Write the failing test**

Create `test/components/chatComposer.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");

const loadKeys = () => import("../../src/components/chat/chatInputKeys.ts");
const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/chat/ChatInput.tsx"),
  "utf8"
);
const COMPOSER_MOCKS = {
  "/ui/useToast": TOAST_MOCK,
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};
const base = { shiftKey: false, isComposing: false, isBusy: false, isQueued: false, hasText: true };

test("Enter submits when idle and queues while the agent is busy", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Enter" }), "submit");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", isBusy: true }), "queue");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", hasText: false }), "none");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", shiftKey: true }), "none");
});

test("Enter during IME composition does nothing", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Enter", isComposing: true }), "none");
  assert.equal(resolveComposerKey({ ...base, key: "Enter", keyCode: 229 }), "none");
  assert.equal(
    resolveComposerKey({ ...base, key: "Enter", isBusy: true, isComposing: true }),
    "none"
  );
});

test("Escape unqueues only a queued draft", async () => {
  const { resolveComposerKey } = await loadKeys();
  assert.equal(resolveComposerKey({ ...base, key: "Escape", isQueued: true }), "unqueue");
  assert.equal(resolveComposerKey({ ...base, key: "Escape" }), "none");
});

test("the textarea grows to a cap and then scrolls", async () => {
  const { composerHeight, COMPOSER_MAX_HEIGHT_PX } = await loadKeys();
  assert.deepEqual(composerHeight(40), { height: 40, overflowY: "hidden" });
  assert.deepEqual(composerHeight(400), { height: COMPOSER_MAX_HEIGHT_PX, overflowY: "auto" });
  assert.deepEqual(composerHeight(Number.NaN), { height: 0, overflowY: "hidden" });
});

test("the composer stays typeable while the agent is busy", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-chat-composer-", COMPOSER_MOCKS));
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  const html = renderToStaticMarkup(
    createElement(ChatInput, {
      partialTranscript: "",
      agentState: "thinking",
      onTextSubmit() {},
      onCancel() {},
    })
  );
  const textarea = html.match(/<textarea[^>]*>/);
  assert.ok(textarea, "the composer is a textarea");
  assert.doesNotMatch(textarea[0], /disabled/);
  assert.match(textarea[0], /dir="auto"/);
  assert.match(textarea[0], /rows="1"/);
  assert.match(html, /aria-label="common\.cancel"/, "Stop is still offered");
});

test("the busy state is not a disabled field, and every focus ring is full opacity", () => {
  assert.doesNotMatch(source, /disabled=\{isBusy\}/);
  assert.doesNotMatch(source, /cursor-not-allowed/);
  assert.doesNotMatch(source, /ring-(ring|primary)\/\d+/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/chatComposer.test.js`
Expected: FAIL with `Cannot find module '…/chatInputKeys.ts'`.

- [ ] **Step 3: Implement**

Create `src/components/chat/chatInputKeys.ts`:

```ts
export type ComposerKeyAction = "submit" | "queue" | "unqueue" | "none";

export interface ComposerKeyInput {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
  isBusy: boolean;
  isQueued: boolean;
  hasText: boolean;
}

/** What a key press in the composer means. IME composition owns Enter
 * (isComposing, or keyCode 229 where Chromium reports the commit key late).
 * Shift+Enter is a newline. */
export function resolveComposerKey(input: ComposerKeyInput): ComposerKeyAction {
  if (input.isComposing || input.keyCode === 229) return "none";
  if (input.key === "Escape") return input.isQueued ? "unqueue" : "none";
  if (input.key !== "Enter" || input.shiftKey || !input.hasText) return "none";
  return input.isBusy ? "queue" : "submit";
}

export const COMPOSER_MAX_HEIGHT_PX = 160;

export function composerHeight(
  scrollHeight: number,
  maxHeight: number = COMPOSER_MAX_HEIGHT_PX
): { height: number; overflowY: "hidden" | "auto" } {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return { height: 0, overflowY: "hidden" };
  return scrollHeight > maxHeight
    ? { height: maxHeight, overflowY: "auto" }
    : { height: scrollHeight, overflowY: "hidden" };
}
```

In `src/components/chat/ChatInput.tsx`:

1. Line 1 becomes `import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";`, and add `import { composerHeight, resolveComposerKey } from "./chatInputKeys";`.
2. Line 68 becomes `const inputRef = useRef<HTMLTextAreaElement>(null);`.
3. Move the four `const isIdle / isListening / isTranscribing / isBusy` lines (104–108) above `handleSubmit` (line 86), so the key handler can read them. Replace `handleKeyDown` (lines 94–102) with:

   ```tsx
     const handleKeyDown = useCallback(
       (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
         const action = resolveComposerKey({
           key: e.key,
           shiftKey: e.shiftKey,
           isComposing: e.nativeEvent.isComposing,
           keyCode: e.nativeEvent.keyCode,
           isBusy,
           isQueued: false,
           hasText: Boolean(inputText.trim()),
         });
         if (action !== "submit") return;
         e.preventDefault();
         handleSubmit();
       },
       [handleSubmit, inputText, isBusy]
     );

     // Grow with the text up to the cap, then scroll inside the box.
     useLayoutEffect(() => {
       const el = inputRef.current;
       if (!el) return;
       el.style.height = "auto";
       const { height, overflowY } = composerHeight(el.scrollHeight);
       el.style.height = `${height}px`;
       el.style.overflowY = overflowY;
     }, [inputText]);
   ```

4. Container (lines 120–126):
   - Replace `"flex items-center gap-2 min-h-11 ps-4 pe-1.5 rounded-full",` with `"flex items-end gap-2 min-h-11 ps-4 pe-1.5 py-1.5 rounded-[22px]",`.
   - Replace the focus line:

     ```tsx
               isIdle &&
                 "focus-within:border-black/15 dark:focus-within:border-white/22 focus-within:ring-[3px] focus-within:ring-primary/8"
     ```

     with:

     ```tsx
               (isIdle || isBusy) && "focus-within:ring-2 focus-within:ring-ring"
     ```

     The busy composer still shows focus. The old ring was 8% orange, which is effectively invisible.

5. Replace the row's opening `<div className="flex items-center gap-2 w-full">` and the `<input … />` element (lines 201–218) with:

   ```tsx
             <div className="flex items-end gap-2 w-full">
               <textarea
                 dir="auto"
                 ref={inputRef}
                 rows={1}
                 value={inputText}
                 onChange={(e) => setInputText(e.target.value)}
                 onKeyDown={handleKeyDown}
                 autoFocus={autoFocus}
                 placeholder={placeholder ?? t("agentMode.input.typeMessage")}
                 className={cn(
                   "input-inline flex-1 resize-none outline-none bg-transparent caret-primary",
                   "text-[13px] leading-5 text-foreground placeholder:text-muted-foreground/70",
                   "min-w-0 py-1.5 px-0"
                 )}
               />
   ```

   `.input-inline` keeps the textarea out of the global native-field rules (Task 2), and the container's `focus-within` ring shows focus instead.

6. Replace every `focus-visible:ring-1 focus-visible:ring-ring/30` in the file (lines 167, 182, 228, 242 and 264) with `focus-visible:ring-2 focus-visible:ring-ring`, the full-opacity ring from Task 3.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/chatComposer.test.js test/components/fieldDirectionPolicy.test.js test/helpers/assistantPanel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chatInputKeys.ts src/components/chat/ChatInput.tsx test/components/chatComposer.test.js
git commit -m "feat(chat): auto-growing composer that stays typeable while the agent works"
```

---

### Task 13: Chat sends never lose words or change destination

Covers WS-Q5, part 2: queue a draft while the agent works, keep it bound to where it was queued, and never lose a draft that was not sent.

**Files:**
- Create: `src/components/chat/chatRouteKey.ts`
- Modify: `src/components/chat/useChatMessageSender.ts:57-86`. This makes the result an honest "did the message reach the conversation" answer.
- Modify: `src/components/chat/ChatInput.tsx`:
  - `onTextSubmit` type (line 17), plus a new `queueKey` prop;
  - `handleSubmit` and `handleKeyDown`;
  - queue, drop and unsent state, and their effects;
  - Stop (line 222) and Send (line 236);
  - hints after the container.
- Modify: `src/hooks/useEmbeddedChat.ts:26` and `:145-150`, and `src/hooks/useContainerChat.ts:30` and `:134-139`. Return the sender's result.
- Modify: `src/components/notes/EmbeddedChat.tsx`. Widen the `onTextSubmit` type (line 20), and add and forward `queueKey` to `ChatInput` (line ~137).
- Modify: `src/components/notes/overview/OverviewAskSection.tsx`:
  - widen the `onTextSubmit` type (line 18);
  - add and forward `queueKey` to `ChatInput` (line ~60);
  - make the chip `onClick` explicit (line 72).
- Modify: `src/components/notes/NoteEditor.tsx`. Compute `queueKey` and pass it to both `<EmbeddedChat>` (lines 1013 and 1030).
- Modify: `src/components/notes/overview/ContainerOverview.tsx`. Compute `queueKey` and pass it to `<OverviewAskSection>` (line ~129).
- Modify: `src/components/chat/ChatView.tsx`. Compute `queueKey` and pass it to `<ChatInput>` (line ~173).
- Create: `src/components/dictation/assistantTextSubmit.ts`. A failed send gives the selected context back.
- Modify: `src/components/dictation/AssistantPanel.tsx`. Change `handleTextSubmit` (lines 323–331) to use it, and compute and pass `queueKey` to `<ChatInput>` (line ~533).
- Modify: `src/locales/*/translation.json`:
  - add `agentMode.input.queued`, `unqueue`, `queueDropped`, `unsent`, `restoreUnsent` and `discardUnsent`.
- Test: `test/helpers/chatSendOutcome.test.js` (the real sender), `test/helpers/assistantTextSubmit.test.js` (the selected context on failure), and `test/components/chatSends.test.js` (the mounted composer, including the real sender).

**Interfaces:**
- **`useChatMessageSender`** still returns `(text, options?) => Promise<boolean>`, with a precise meaning.
  - **`true`:** the user's message reached the conversation (shown and saved), even if the reply then failed. `useChatStreaming` renders reply failures in the thread.
  - **`false`:** nothing reached the conversation, so the caller still owns the words. That happens when another send holds the lock, or when creating the conversation or saving the message failed.
  - **No rejection.** It never rejects. A failure before the save also removes the optimistic message it had added.
- `ChatInputProps.onTextSubmit` becomes `(text: string) => void | boolean | Promise<void | boolean>`. `false`, or a rejection, means "not sent". A callback that returns nothing keeps today's behaviour.
- `ChatInputProps.queueKey?: string` is the destination identity of a send: conversation or context, plus the route. A draft queues only when `queueKey` is set. It is sent only if the key at the moment the agent goes idle equals the key at queue time.
- Produces `src/components/chat/chatRouteKey.ts`:
  - `chatRouteKey(state: SettingsState, scope: "chatIntelligence" | "dictationAgent"): string`, built from scope, mode, provider, model, cloudMode, cloudBaseUrl and remoteUrl. It never includes `customApiKey`.
  - `useChatRouteKey(scope): string`.
- Produces `src/components/dictation/assistantTextSubmit.ts`:
  - `sendWithSelectedContext(text, context, { send, clear, current, restore }): Promise<boolean>`. It clears the context before the send. If the send resolves `false` or rejects, it restores the context, unless a different context has been selected since. It passes the result or the rejection through unchanged.
- Consumes `installTree` with `find` and `props` (Task 6), plus `rendererOptions` and `TOAST_MOCK` (Task 4).

Facts from the code:
- **The sender's real failure modes** (`src/components/chat/useChatMessageSender.ts:57-86`):
  - **Lock busy:** it resolves `false` at once when another send holds the lock (`:31`).
  - **Before persistence:** it rejects when `onBeforeSend`, `createConversation` (`:63`) or `saveUserMessage` (`:73`) throws.
  - **Streaming errors:** `useChatStreaming.sendToAI` catches provider and stream errors, renders them as an assistant message, and returns normally (`useChatStreaming.ts:~505-555`). So `true` today means "the operation ran", not "the reply succeeded".
  - The new contract makes `true` mean "the message is in the conversation". That is the line that matters for the words: past it, restoring them would duplicate a message the thread already shows.
- **The route is read live.** `sendToAI` reads routing at dispatch (`useChatStreaming.ts:233`, `getSettings()`, then `resolveChatStreamingInference`).
  - ChatView, EmbeddedChat and OverviewAskSection use scope `chatIntelligence`.
  - AssistantPanel uses `dictationAgent` (`AssistantPanel.tsx:119`). Its typed text carries no screenshot, so the vision override never applies.
- **ChatView keeps one composer across conversations.** It switches `activeConversationId` (`ChatView.tsx:34`, `:~57`, New Chat sets `null`) without remounting `ChatInput`. A queue that only checked "is anything queued" would send A's follow-up into B, or into a new chat. `queueKey` closes that.
- **AssistantPanel attaches `selectedContext` at send time** (`:322-330`). Its key includes that context, so a queued draft never leaves with a different attachment than the one on screen when it was queued.
- **AssistantPanel clears that context before it sends** (`:327`), so the chip disappears as the message goes. If the send then fails, `ChatInput` gives back only the words. A retry would silently go without the attachment, which is a materially different request. So a failed send must give the context back as well.
- **A conversation's id flips from `null` to its new id while its first message is created.**
  - In ChatView, Embedded and Container, the agent only turns busy after that flip, so no queue can exist across it.
  - In AssistantPanel, `agentState` reads `"thinking"` during the flip. A draft queued in that window is dropped with the notice rather than sent. That errs on the safe side.

Behaviour:
- **Queueing.**
  - With a `queueKey`, Enter while busy queues the draft. It stays visible with "Sends when the reply finishes" and a "Don't send when done" button.
  - Esc, that button, Stop, or clearing the text all unqueue it. Stop never sends a queued draft.
- **The destination changes.**
  - If the conversation, context or route changes before the reply ends, the draft is unqueued, not sent. The words stay in the box with "Not sent: the conversation or model changed. Press Enter to send it here."
  - Sending it to the new destination takes a deliberate Enter.
- **A send fails.** A refused or failed send never loses words.
  - If the box is empty, the text comes back into it.
  - If the user has already started a newer draft, the failed text is held beside it as "Your earlier message wasn't sent", with "Put it back" (which places it above the newer draft) and "Discard".
  - Further failures append to the held text.
  - In AssistantPanel, the selected context comes back with the words. If the user has selected other text in the meantime, the newer selection stays.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/chatSendOutcome.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function makeSender(t, { createConversation, saveUserMessage, sendToAI }) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-chat-send-outcome-" });
  const { useChatMessageSender } = await vite.ssrLoadModule(
    "/components/chat/useChatMessageSender.ts"
  );
  const thread = [];
  const persistence = {
    messages: [],
    setMessages(update) {
      thread.splice(0, thread.length, ...update(thread.slice()));
    },
    saveUserMessage: saveUserMessage ?? (async () => {}),
  };
  let send;
  function Harness() {
    send = useChatMessageSender({
      conversationId: null,
      persistence,
      streaming: { sendToAI: sendToAI ?? (async () => {}) },
      createConversation: createConversation ?? (async () => 1),
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  return { send: (text) => send(text), thread };
}

test("a failure before the conversation exists reports not sent", async (t) => {
  const s = await makeSender(t, {
    createConversation: async () => {
      throw new Error("Conversation scope is no longer available");
    },
  });
  assert.equal(await s.send("hello"), false);
  assert.deepEqual(s.thread, []);
});

test("a failed save reports not sent and takes the optimistic message back out", async (t) => {
  const s = await makeSender(t, {
    saveUserMessage: async () => {
      throw new Error("disk full");
    },
  });
  assert.equal(await s.send("hello"), false);
  assert.deepEqual(s.thread, [], "the words live only in the composer now");
});

test("once the message is saved, a later failure still reports it as sent", async (t) => {
  const s = await makeSender(t, {
    sendToAI: async () => {
      throw new Error("stream setup failed");
    },
  });
  assert.equal(await s.send("hello"), true);
  assert.equal(s.thread.length, 1, "the thread shows it, so the composer must not offer it again");
});

test("a provider error rendered in the thread counts as sent", async (t) => {
  const s = await makeSender(t, { sendToAI: async () => {} });
  assert.equal(await s.send("hello"), true);
});
```

Create `test/components/chatSends.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

const COMPOSER_MOCKS = {
  "/ui/useToast": TOAST_MOCK,
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Mounts render(modules, props) on the fake tree and drives the composer's
// handlers directly. Every helper yields a macrotask inside act, so async
// sends settle before the test reads the box.
async function mount(t, render, initialProps) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-chat-sends-", COMPOSER_MOCKS));
  const modules = {
    ChatInput: (await vite.ssrLoadModule("/components/chat/ChatInput.tsx")).ChatInput,
    useChatMessageSender: (await vite.ssrLoadModule("/components/chat/useChatMessageSender.ts"))
      .useChatMessageSender,
  };
  let props = initialProps;
  const act = (fn) =>
    React.act(async () => {
      await fn();
      await settle();
    });
  const rerender = (next = {}) => {
    props = { ...props, ...next };
    return act(() => root.render(render(modules, props)));
  };
  root = createRoot(tree.container);
  await rerender();
  const textarea = () => tree.find((node) => node.tagName === "TEXTAREA");
  return {
    ...tree,
    rerender,
    run: act,
    type: (value) => act(() => tree.props(textarea()).onChange({ target: { value } })),
    press: (key) =>
      act(() =>
        tree.props(textarea()).onKeyDown({
          key,
          shiftKey: false,
          nativeEvent: { isComposing: false, keyCode: key === "Enter" ? 13 : 27 },
          preventDefault() {},
        })
      ),
    clickText: (label) =>
      act(() =>
        tree
          .props(tree.find((node) => node.tagName === "BUTTON" && node.textContent.includes(label)))
          .onClick()
      ),
    stop: () =>
      act(() =>
        tree.props(tree.find((node) => node.attributes?.["aria-label"] === "common.cancel")).onClick()
      ),
    value: () => tree.props(textarea()).value,
  };
}

const composer = ({ ChatInput }, props) =>
  createElement(ChatInput, { partialTranscript: "", onCancel() {}, ...props });

test("a queued draft sends on idle and Stop cancels the queue", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "thinking",
    queueKey: "chat|1|route-a",
    onTextSubmit: async (text) => {
      sent.push(text);
      return true;
    },
  });
  await c.type("next question");
  await c.press("Enter");
  assert.deepEqual(sent, [], "nothing is sent while the agent is busy");
  assert.match(c.text(), /agentMode\.input\.queued/);
  assert.equal(c.value(), "next question", "the queued draft stays visible");
  await c.rerender({ agentState: "idle" });
  assert.deepEqual(sent, ["next question"]);
  assert.equal(c.value(), "");

  await c.rerender({ agentState: "streaming" });
  await c.type("never mind");
  await c.press("Enter");
  await c.stop();
  await c.rerender({ agentState: "idle" });
  assert.deepEqual(sent, ["next question"], "Stop never sends the queued draft");
  assert.equal(c.value(), "never mind", "and the draft stays in the box");
});

for (const [change, nextKey] of [
  ["another conversation is selected", "chat|2|route-a"],
  ["New Chat is opened", "chat|new|route-a"],
  ["the route changes", "chat|1|route-b"],
]) {
  test(`a queued draft is not sent after ${change}`, async (t) => {
    const sent = [];
    const c = await mount(t, composer, {
      agentState: "thinking",
      queueKey: "chat|1|route-a",
      onTextSubmit: async (text) => {
        sent.push(text);
        return true;
      },
    });
    await c.type("follow-up for A");
    await c.press("Enter");
    await c.rerender({ queueKey: nextKey });
    await c.rerender({ agentState: "idle" });
    assert.deepEqual(sent, [], "never sent to a destination it was not queued for");
    assert.equal(c.value(), "follow-up for A", "the words stay for a deliberate send");
    assert.match(c.text(), /agentMode\.input\.queueDropped/);
  });
}

test("without a queue key, Enter while busy keeps the draft and queues nothing", async (t) => {
  const sent = [];
  const c = await mount(t, composer, {
    agentState: "thinking",
    onTextSubmit: async (text) => {
      sent.push(text);
      return true;
    },
  });
  await c.type("held");
  await c.press("Enter");
  await c.rerender({ agentState: "idle" });
  assert.deepEqual(sent, []);
  assert.equal(c.value(), "held");
});

test("a refused send puts the draft back into an empty box", async (t) => {
  const c = await mount(t, composer, { agentState: "idle", queueKey: "k", onTextSubmit: async () => false });
  await c.type("hello");
  await c.press("Enter");
  assert.equal(c.value(), "hello");
});

for (const [outcome, settleSend] of [
  ["refusal", (pending) => pending.resolve(false)],
  ["rejection", (pending) => pending.reject(new Error("offline"))],
]) {
  test(`a ${outcome} while a newer draft exists keeps both drafts`, async (t) => {
    const pending = deferred();
    const c = await mount(t, composer, {
      agentState: "idle",
      queueKey: "k",
      onTextSubmit: () => pending.promise,
    });
    await c.type("original words");
    await c.press("Enter");
    assert.equal(c.value(), "", "the box clears while the send is in flight");
    await c.type("new words");
    await c.run(() => settleSend(pending));
    assert.equal(c.value(), "new words", "the newer draft is untouched");
    assert.match(c.text(), /agentMode\.input\.unsent/);
    await c.clickText("agentMode.input.restoreUnsent");
    assert.equal(c.value(), "original words\n\nnew words", "nothing was lost");
  });
}

// The real sender behind the real composer: the failure contract end to end.
function SenderHost({ modules, createConversation, sendToAI, thread }) {
  const persistence = {
    messages: [],
    setMessages(update) {
      thread.splice(0, thread.length, ...update(thread.slice()));
    },
    async saveUserMessage() {},
  };
  const send = modules.useChatMessageSender({
    conversationId: null,
    persistence,
    streaming: { sendToAI },
    createConversation,
  });
  return createElement(modules.ChatInput, {
    partialTranscript: "",
    agentState: "idle",
    onTextSubmit: send,
    queueKey: "chat|new|route-a",
  });
}
const senderHost = (modules, props) => createElement(SenderHost, { modules, ...props });

test("with the real sender, a failure before the save restores the draft", async (t) => {
  const thread = [];
  const c = await mount(t, senderHost, {
    thread,
    createConversation: async () => {
      throw new Error("Conversation scope is no longer available");
    },
    sendToAI: async () => {},
  });
  await c.type("hello");
  await c.press("Enter");
  assert.equal(c.value(), "hello");
  assert.deepEqual(thread, []);
});

test("with the real sender, a failure after the save keeps the box clear and the message in the thread", async (t) => {
  const thread = [];
  const c = await mount(t, senderHost, {
    thread,
    createConversation: async () => 7,
    sendToAI: async () => {
      throw new Error("stream setup failed");
    },
  });
  await c.type("hello");
  await c.press("Enter");
  assert.equal(c.value(), "", "no duplicate offered");
  assert.equal(thread.length, 1);
  assert.equal(thread[0].content, "hello");
});
```

Add to `test/components/chatComposer.test.js` (Task 12's file):

```js
test("every caller passes a queue key built from its destination and route", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  assert.match(read("src/components/chat/ChatView.tsx"), /queueKey=\{`chat\|\$\{activeConversationId \?\? "new"\}\|\$\{routeKey\}`\}/);
  assert.match(read("src/components/notes/NoteEditor.tsx"), /const embeddedQueueKey = `note\|\$\{note\.id\}\|/);
  assert.equal(read("src/components/notes/NoteEditor.tsx").match(/queueKey=\{embeddedQueueKey\}/g)?.length, 2);
  assert.match(read("src/components/notes/overview/ContainerOverview.tsx"), /queueKey=\{`container\|\$\{space\.id\}\|/);
  assert.match(read("src/components/dictation/AssistantPanel.tsx"), /queueKey=\{`assistant\|\$\{persistence\.conversationId \?\? "new"\}\|\$\{routeKey\}\|/);
  assert.match(read("src/components/notes/EmbeddedChat.tsx"), /queueKey=\{queueKey\}/);
  assert.match(read("src/components/notes/overview/OverviewAskSection.tsx"), /queueKey=\{queueKey\}/);
});

test("the route key changes with the route and never carries a secret", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-chat-route-key-"));
  const { chatRouteKey } = await vite.ssrLoadModule("/components/chat/chatRouteKey.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const state = {
    ...useSettingsStore.getState(),
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "model-a",
  };
  const a = chatRouteKey(state, "chatIntelligence");
  assert.notEqual(chatRouteKey({ ...state, chatAgentModel: "model-b" }, "chatIntelligence"), a);
  assert.notEqual(chatRouteKey(state, "dictationAgent"), a);
  const withKey = chatRouteKey({ ...state, chatAgentCustomApiKey: "sk-secret" }, "chatIntelligence");
  assert.equal(withKey, a);
  assert.doesNotMatch(withKey, /sk-secret/);
});

test("AssistantPanel submits through sendWithSelectedContext", () => {
  const panel = fs.readFileSync(
    path.join(__dirname, "../../src/components/dictation/AssistantPanel.tsx"),
    "utf8"
  );
  assert.match(panel, /sendWithSelectedContext\(text, selectedContext, \{/);
  assert.doesNotMatch(panel, /void sendMessage\(text, context/);
});
```

Create `test/helpers/assistantTextSubmit.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("./harness/rendererMocks");

async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-assistant-text-submit-"));
  return vite.ssrLoadModule("/components/dictation/assistantTextSubmit.ts");
}

// A stand-in for AssistantPanel's selection state and its sender.
function panel(result) {
  const log = [];
  let selected = { text: "the quoted answer", sourceMessageId: "m1" };
  const original = selected;
  return {
    log,
    original,
    get selected() {
      return selected;
    },
    select(next) {
      selected = next;
    },
    hooks: {
      send: async (text, options) => {
        log.push(["send", text, options?.selectedContext ?? null]);
        if (result instanceof Error) throw result;
        return result;
      },
      clear: () => {
        log.push(["clear"]);
        selected = null;
      },
      current: () => selected,
      restore: (context) => {
        log.push(["restore", context]);
        selected = context;
      },
    },
  };
}

test("a sent message takes its context with it, and the chip clears first", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(true);
  assert.equal(await sendWithSelectedContext("rewrite it", p.selected, p.hooks), true);
  assert.deepEqual(p.log, [["clear"], ["send", "rewrite it", p.original]]);
  assert.equal(p.selected, null);
});

test("a send that was not made gives the context back with the words", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(false);
  assert.equal(await sendWithSelectedContext("rewrite it", p.selected, p.hooks), false);
  assert.deepEqual(p.log.at(-1), ["restore", p.original]);
  assert.equal(p.selected, p.original, "a retry sends the same request");
});

test("a rejected send gives the context back and still rejects", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(new Error("save failed"));
  await assert.rejects(sendWithSelectedContext("rewrite it", p.selected, p.hooks), /save failed/);
  assert.equal(p.selected, p.original);
});

test("a newer selection is never overwritten by a failed send", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(false);
  const newer = { text: "another passage", sourceMessageId: "m1" };
  const send = p.hooks.send;
  p.hooks.send = async (...args) => {
    const result = await send(...args);
    p.select(newer); // the user selects again while the send is in flight
    return result;
  };
  assert.equal(await sendWithSelectedContext("rewrite it", p.selected, p.hooks), false);
  assert.equal(p.selected, newer);
  assert.equal(p.log.some(([kind]) => kind === "restore"), false);
});

test("a refusal that beats React's commit still gives the context back", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(false);
  const sent = p.selected;
  // The panel's ref still holds the context: the clear has not committed yet.
  p.hooks.current = () => sent;
  assert.equal(await sendWithSelectedContext("rewrite it", sent, p.hooks), false);
  assert.deepEqual(p.log.at(-1), ["restore", sent]);
});

test("without a context nothing is cleared or restored", async (t) => {
  const { sendWithSelectedContext } = await load(t);
  const p = panel(false);
  p.select(null);
  assert.equal(await sendWithSelectedContext("hello", null, p.hooks), false);
  assert.deepEqual(p.log, [["send", "hello", null]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/chatSendOutcome.test.js test/helpers/assistantTextSubmit.test.js test/components/chatSends.test.js test/components/chatComposer.test.js`
Expected: FAIL.
- The sender rejects instead of resolving `false`, and a post-save failure rejects instead of resolving `true`.
- No queue exists yet.
- `chatRouteKey.ts` and `assistantTextSubmit.ts` are missing.

- [ ] **Step 3: Implement**

1. `src/components/chat/useChatMessageSender.ts`. Replace the returned `useCallback` (lines 57–86) with the version below. The dependency array is unchanged.

   ```ts
     return useCallback(
       async (text: string, options?: SendToAIOptions) => {
         // true: the user's message reached the conversation (shown and saved),
         // even if the reply then failed; useChatStreaming renders reply errors
         // in the thread. false: nothing reached it (another send held the
         // lock, or creating the conversation or saving failed), so the caller
         // still owns the words. Never rejects.
         let reachedConversation = false;
         let optimisticId: string | null = null;
         try {
           return await submissionLockRef.current!.run(async () => {
             onSendingChange?.(true);
             try {
               onBeforeSend?.();
               const convId = conversationId ?? (await createConversation(text));
               const previousMessages = persistence.messages;
               const userMessage: Message = {
                 id: crypto.randomUUID(),
                 role: "user",
                 content: text,
                 isStreaming: false,
               };

               persistence.setMessages((messages) => [...messages, userMessage]);
               optimisticId = userMessage.id;
               await persistence.saveUserMessage(text);
               reachedConversation = true;
               await onMessagePersisted?.({
                 conversationId: convId,
                 text,
                 isFirstMessage: previousMessages.length === 0,
               });
               await streaming.sendToAI(text, [...previousMessages, userMessage], options);
             } finally {
               onSendingChange?.(false);
             }
           });
         } catch (error) {
           console.error("Chat send failed", error);
           if (!reachedConversation && optimisticId) {
             const id = optimisticId;
             persistence.setMessages((messages) => messages.filter((m) => m.id !== id));
           }
           return reachedConversation;
         }
       },
   ```

   The existing tests in `test/helpers/chatMessageSubmissionLock.test.js` keep passing: the lock and the busy `false` are unchanged.

2. Create `src/components/chat/chatRouteKey.ts`:

   ```ts
   import {
     selectResolvedLLMConfig,
     useSettingsStore,
     type SettingsState,
   } from "../../stores/settingsStore";

   export type ChatRouteScope = "chatIntelligence" | "dictationAgent";

   /** Fingerprint of where a typed chat message goes: scope, mode, provider,
    * model and endpoint. The secret (customApiKey) and tuning
    * (disableThinking) are left out on purpose. */
   export function chatRouteKey(state: SettingsState, scope: ChatRouteScope): string {
     const c = selectResolvedLLMConfig(state, scope);
     return [c.scope, c.mode, c.provider, c.model, c.cloudMode ?? "", c.cloudBaseUrl ?? "", c.remoteUrl ?? ""].join("|");
   }

   export function useChatRouteKey(scope: ChatRouteScope): string {
     return useSettingsStore((state) => chatRouteKey(state, scope));
   }
   ```

3. `src/components/chat/ChatInput.tsx`:
   - Line 1 adds `useId` to the React import.
   - Line 17 becomes the two props below. Add `queueKey,` to the destructuring.

     ```ts
       /** Return false, or reject, when the text was not sent; the words are kept. */
       onTextSubmit?: (text: string) => void | boolean | Promise<void | boolean>;
       /** Where a send from here goes (conversation or context, plus route). A
        * draft can be queued only with a key, and is sent only if the key is
        * unchanged when the agent goes idle. */
       queueKey?: string;
     ```

   - After `const inputRef = …` add:

     ```tsx
       // The queueKey a draft was queued for; null when nothing is queued.
       const [queuedFor, setQueuedFor] = useState<string | null>(null);
       const [queueDropped, setQueueDropped] = useState(false);
       // A draft that was not sent while a newer one was already in the box.
       const [unsent, setUnsent] = useState<string | null>(null);
       const queued = queuedFor !== null;
       const queuedHintId = useId();
       const inputTextRef = useRef(inputText);
       useLayoutEffect(() => {
         inputTextRef.current = inputText;
       }, [inputText]);
     ```

   - Replace `handleSubmit` (lines 86–92) with:

     ```tsx
       const handleSubmit = useCallback(async () => {
         const text = inputText.trim();
         if (!text || !onTextSubmit) return;
         setQueueDropped(false);
         // Clear at once: a send resolves only after the whole reply streams.
         setInputText("");
         requestAnimationFrame(() => inputRef.current?.focus());
         let sent: void | boolean = true;
         try {
           sent = await onTextSubmit(text);
         } catch {
           sent = false;
         }
         if (sent !== false) return;
         // Not sent, so nothing reached the conversation. Never lose the words:
         // refill an empty box, or hold them beside a newer draft.
         if (!inputTextRef.current.trim()) setInputText(text);
         else setUnsent((held) => (held ? `${held}\n\n${text}` : text));
       }, [inputText, onTextSubmit]);
     ```

   - In `handleKeyDown`, pass `isQueued: queued`, and replace the tail `if (action !== "submit") return; e.preventDefault(); handleSubmit();` with:

     ```tsx
           if (action === "none") return;
           if (action === "queue" && !queueKey) return; // no destination identity: keep the draft
           e.preventDefault();
           if (action === "submit") void handleSubmit();
           else if (action === "queue") {
             setQueuedFor(queueKey ?? null);
             setQueueDropped(false);
           } else setQueuedFor(null);
     ```

     Add `queued` and `queueKey` to its dependency list.

   - After the resize effect, add:

     ```tsx
       // A queued draft belongs to the destination it was queued for. If the
       // conversation, context or route changes first, unqueue it and say so;
       // the words stay for the user to send here on purpose.
       useEffect(() => {
         if (queuedFor !== null && queuedFor !== queueKey) {
           setQueuedFor(null);
           setQueueDropped(true);
         }
       }, [queueKey, queuedFor]);

       useEffect(() => {
         if (isIdle && queuedFor !== null && queuedFor === queueKey) {
           setQueuedFor(null);
           void handleSubmit();
         }
       }, [isIdle, queuedFor, queueKey, handleSubmit]);
     ```

   - The textarea gets `onChange={(e) => { setInputText(e.target.value); setQueueDropped(false); if (!e.target.value.trim()) setQueuedFor(null); }}` and `aria-describedby={queued ? queuedHintId : undefined}`.
   - Stop (line 222): `onClick={() => { setQueuedFor(null); onCancel?.(); }}`.
   - Send (line 236): `onClick={() => void handleSubmit()}`.
   - After the container's closing `</div>`, before the outer wrapper's closing `</div>`, add:

     ```tsx
         {queued && (
           <p
             id={queuedHintId}
             className="mt-1 flex items-center gap-2 ps-4 text-[11px] text-muted-foreground"
           >
             {t("agentMode.input.queued")}
             <button
               type="button"
               onClick={() => setQueuedFor(null)}
               className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
             >
               {t("agentMode.input.unqueue")}
             </button>
           </p>
         )}
         {queueDropped && (
           <p role="status" className="mt-1 ps-4 text-[11px] text-muted-foreground">
             {t("agentMode.input.queueDropped")}
           </p>
         )}
         {unsent !== null && (
           <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 ps-4 text-[11px] text-muted-foreground">
             {t("agentMode.input.unsent")}
             <button
               type="button"
               onClick={() => {
                 const held = unsent;
                 setInputText((current) => (current.trim() ? `${held}\n\n${current}` : held));
                 setUnsent(null);
               }}
               className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
             >
               {t("agentMode.input.restoreUnsent")}
             </button>
             <button
               type="button"
               onClick={() => setUnsent(null)}
               className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
             >
               {t("agentMode.input.discardUnsent")}
             </button>
           </div>
         )}
     ```

4. Return the send result, and pass a queue key from every caller:
   - **`src/hooks/useEmbeddedChat.ts`:** change line 26 to `sendMessage: (text: string) => Promise<boolean>;`, and lines 145–150 to:

     ```ts
       const sendMessage = useCallback(
         (text: string): Promise<boolean> => sendMessageWithResult(text),
         [sendMessageWithResult]
       );
     ```

     Make the same change in `src/hooks/useContainerChat.ts` (line 30 and lines 134–139).
   - **`src/components/notes/EmbeddedChat.tsx`:**
     - line 20 becomes `onTextSubmit: (text: string) => void | boolean | Promise<void | boolean>;`;
     - add `queueKey?: string;` to the props type and to the destructuring;
     - add `queueKey={queueKey}` to its `<ChatInput>`.
   - **`src/components/notes/overview/OverviewAskSection.tsx`:**
     - line 18 gets the same type;
     - add the same `queueKey` prop and forward it to its `<ChatInput>`;
     - the chip at line 72 becomes `onClick={() => void onTextSubmit(t(key))}`.
   - **`src/components/notes/NoteEditor.tsx`:**
     - import `useChatRouteKey` from `../chat/chatRouteKey`;
     - after the `useEmbeddedChat(...)` call (lines 239–245), add:

       ```tsx
         const chatRouteKeyValue = useChatRouteKey("chatIntelligence");
         const embeddedQueueKey = `note|${note.id}|${embeddedChat.activeConversationId ?? "new"}|${chatRouteKeyValue}`;
       ```

     - add `queueKey={embeddedQueueKey}` to both `<EmbeddedChat>` elements (lines 1013 and 1030).
   - **`src/components/notes/overview/ContainerOverview.tsx`:**
     - import `useChatRouteKey`;
     - after `const chat = useContainerChat(...)` (line 70), add `const routeKey = useChatRouteKey("chatIntelligence");`;
     - pass `queueKey={`container|${space.id}|${folder?.id ?? "root"}|${chat.activeConversationId ?? "new"}|${routeKey}`}` to `<OverviewAskSection>`.
   - **`src/components/chat/ChatView.tsx`:**
     - import `useChatRouteKey`;
     - add `const routeKey = useChatRouteKey("chatIntelligence");`;
     - pass `queueKey={`chat|${activeConversationId ?? "new"}|${routeKey}`}` to `<ChatInput>`.
   - **`src/components/dictation/AssistantPanel.tsx`:**
     - import `useChatRouteKey`;
     - add `const routeKey = useChatRouteKey("dictationAgent");`;
     - pass `queueKey={`assistant|${persistence.conversationId ?? "new"}|${routeKey}|${selectedContext ? JSON.stringify(selectedContext) : ""}`}` to `<ChatInput>` (line ~533);
     - create `src/components/dictation/assistantTextSubmit.ts`:

       ```ts
       export interface SelectedContextHooks<C> {
         send: (text: string, options?: { selectedContext: C }) => Promise<boolean>;
         /** Hides the chip as the message goes. */
         clear: () => void;
         /** The context selected now, which may be newer than the one sent. */
         current: () => C | null;
         restore: (context: C) => void;
       }

       /**
        * Sends typed text with the selected context. When the send is not made
        * (`false` or a rejection), ChatInput keeps the words, so the context
        * comes back too: a retry must not silently drop the attachment. A
        * selection made while the send was in flight wins.
        */
       export async function sendWithSelectedContext<C>(
         text: string,
         context: C | null,
         hooks: SelectedContextHooks<C>
       ): Promise<boolean> {
         if (context) hooks.clear();
         let sent = false;
         try {
           sent = await hooks.send(text, context ? { selectedContext: context } : undefined);
           return sent;
         } finally {
           // `current()` may still read the context just sent: a refusal can
           // resolve before React commits the clear. Only a different
           // selection counts as newer.
           const now = hooks.current();
           if (!sent && context && (now === null || now === context)) hooks.restore(context);
         }
       }
       ```

     - import it, and add `const selectedContextRef = useRef<AgentSelectionContext | null>(null);` with an effect that keeps it current, after the `selectedContext` state (line 299):

       ```tsx
         useEffect(() => {
           selectedContextRef.current = selectedContext;
         }, [selectedContext]);
       ```

     - replace `handleTextSubmit` (lines 323–331) with:

     ```tsx
       const handleTextSubmit = useCallback(
         (text: string): boolean | Promise<boolean> => {
           // Not ready yet: report the refusal so ChatInput keeps the words.
           if (!historyReady) return false;
           return sendWithSelectedContext(text, selectedContext, {
             send: sendMessage,
             clear: clearSelectedContext,
             current: () => selectedContextRef.current,
             restore: (context) => {
               setSelectedContext(context);
               onSelectionContextChange(context);
             },
           });
         },
         [clearSelectedContext, historyReady, onSelectionContextChange, selectedContext, sendMessage]
       );
     ```

     `clearSelectedContext` also removes the window selection. The restored chip does not need it back: the chip, not the highlight, is what the send attaches. If the panel closed in the meantime, the existing effect at line 342 clears the restored context again.

     It is also passed to `onSelectSuggestion` (line 527). A function that returns a value is assignable to a `void`-returning prop, so that call site compiles unchanged.

5. Add the locale keys:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const P = "agentMode.input.";
   const ADD = {
     [P + "queued"]: {
       en: "Sends when the reply finishes", ar: "سيُرسل عند انتهاء الرد",
       de: "Wird gesendet, sobald die Antwort fertig ist", es: "Se enviará cuando termine la respuesta",
       fr: "Sera envoyé à la fin de la réponse", it: "Verrà inviato al termine della risposta",
       ja: "返信が終わると送信されます", pt: "Será enviado quando a resposta terminar",
       ru: "Отправится, когда ответ будет готов", "zh-CN": "回复结束后发送", "zh-TW": "回覆結束後傳送",
     },
     [P + "unqueue"]: {
       en: "Don't send when done", ar: "عدم الإرسال عند الانتهاء", de: "Nicht automatisch senden",
       es: "No enviar al terminar", fr: "Ne pas envoyer à la fin", it: "Non inviare al termine",
       ja: "完了時に送信しない", pt: "Não enviar ao terminar", ru: "Не отправлять автоматически",
       "zh-CN": "完成后不发送", "zh-TW": "完成後不傳送",
     },
     [P + "queueDropped"]: {
       en: "Not sent: the conversation or model changed. Press Enter to send it here.",
       ar: "لم يُرسل: تغيّرت المحادثة أو النموذج. اضغط Enter لإرساله هنا.",
       de: "Nicht gesendet: Unterhaltung oder Modell hat sich geändert. Drücke Enter, um es hier zu senden.",
       es: "No se envió: cambió la conversación o el modelo. Pulsa Intro para enviarlo aquí.",
       fr: "Non envoyé : la conversation ou le modèle a changé. Appuyez sur Entrée pour l'envoyer ici.",
       it: "Non inviato: la conversazione o il modello sono cambiati. Premi Invio per inviarlo qui.",
       ja: "送信されていません: 会話またはモデルが変わりました。ここに送るには Enter を押してください。",
       pt: "Não enviado: a conversa ou o modelo mudou. Pressione Enter para enviar aqui.",
       ru: "Не отправлено: изменился разговор или модель. Нажмите Enter, чтобы отправить сюда.",
       "zh-CN": "未发送：对话或模型已更改。按 Enter 发送到这里。",
       "zh-TW": "未傳送：對話或模型已變更。按 Enter 傳送到這裡。",
     },
     [P + "unsent"]: {
       en: "Your earlier message wasn't sent.", ar: "لم تُرسل رسالتك السابقة.",
       de: "Deine vorherige Nachricht wurde nicht gesendet.", es: "Tu mensaje anterior no se envió.",
       fr: "Votre message précédent n'a pas été envoyé.", it: "Il messaggio precedente non è stato inviato.",
       ja: "前のメッセージは送信されませんでした。", pt: "Sua mensagem anterior não foi enviada.",
       ru: "Предыдущее сообщение не отправлено.", "zh-CN": "你之前的消息未发送。", "zh-TW": "你先前的訊息未傳送。",
     },
     [P + "restoreUnsent"]: {
       en: "Put it back", ar: "إعادته", de: "Zurückholen", es: "Recuperarlo", fr: "Le remettre",
       it: "Ripristina", ja: "戻す", pt: "Recuperar", ru: "Вернуть", "zh-CN": "放回", "zh-TW": "放回",
     },
     [P + "discardUnsent"]: {
       en: "Discard", ar: "تجاهل", de: "Verwerfen", es: "Descartar", fr: "Ignorer", it: "Scarta",
       ja: "破棄", pt: "Descartar", ru: "Удалить", "zh-CN": "丢弃", "zh-TW": "捨棄",
     },
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const [key, values] of Object.entries(ADD)) {
       if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
       const parts = key.split(".");
       let node = json;
       for (const part of parts.slice(0, -1)) node = node[part] ??= {};
       node[parts.at(-1)] = values[lang];
     }
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/chatSendOutcome.test.js test/helpers/assistantTextSubmit.test.js test/components/chatSends.test.js test/components/chatComposer.test.js test/helpers/chatMessageSubmissionLock.test.js test/helpers/assistantPanel.test.js test/locales/translationCoverage.test.js`, then `npm run typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat src/hooks/useEmbeddedChat.ts src/hooks/useContainerChat.ts src/components/notes/EmbeddedChat.tsx src/components/notes/overview/OverviewAskSection.tsx src/components/notes/overview/ContainerOverview.tsx src/components/notes/NoteEditor.tsx src/components/dictation/AssistantPanel.tsx src/components/dictation/assistantTextSubmit.ts src/locales test/helpers/chatSendOutcome.test.js test/helpers/assistantTextSubmit.test.js test/components/chatSends.test.js test/components/chatComposer.test.js
git commit -m "fix(chat): queued drafts stay in their conversation; unsent words are never lost"
```

---

### Task 14: Notes open without the Actions gate

Covers WS-Q7.

**Files:**
- Create: `src/utils/noteActionsReadiness.ts` (pure)
- Create: `src/hooks/useNoteActionsReady.ts`
- Modify: `src/components/notes/shared.ts`. Append `NOTES_ACTIONS_MODEL_HINT_KEY` and `shouldShowActionsModelHint`.
- Modify: `src/components/notes/PersonalNotesView.tsx`:
  - imports (lines 5 and 78);
  - state (near line 138);
  - remove the early return (lines 679–685);
  - the sidebar Actions button (line 696, and its focus ring at line 701);
  - add a hint row after it;
  - `ActionPicker.onManageActions` (line 762);
  - move `<ActionManagerDialog>` out of the editor branch (line 772);
  - add the intro dialog before the final `</div>` (line 935).
- Modify: `src/locales/*/translation.json`. Add `notes.actionsModelHint.title` and `notes.actionsModelHint.choose`.
- Test: `test/components/notesActionsGate.test.js`

**Interfaces:**
- Produces:
  - `NOTES_ACTIONS_MODEL_HINT_KEY = "notesActionsModelHintDismissed"`;
  - `shouldShowActionsModelHint(ready: boolean | null, dismissed: boolean): boolean`;
  - `noteActionsReadiness(config: { mode: string; model: string; remoteUrl?: string }, downloadedModelIds: ReadonlySet<string> | null): boolean | null`;
  - `useNoteActionsReady(): boolean | null`, where `null` means "unknown": still checking, or a remote provider. Plan 06 replaces this hook with `useResolvedRoute("noteFormatting")`, per the spec §5.1 handoff (CCR 6). Until then this is a documented partial delivery of WS-Q7's hint: local and self-hosted routes get it, and remote providers show none.
- Consumes:
  - `useNotesOnboarding()` (`src/hooks/useNotesOnboarding.ts`);
  - `NotesOnboarding` (`{ onComplete }`);
  - `ActionManagerDialog` (`{ open, onOpenChange }`);
  - `Dialog`, `DialogContent` and `DialogTitle` from `src/components/ui/dialog.tsx`;
  - the existing `onOpenSettings?: (section: string) => void` prop. `HistoryView.tsx:123` uses section `"intelligence"` for the same purpose;
  - `selectResolvedNoteFormatting(state)` (`src/stores/settingsStore.ts:2604`), which returns `{ mode, model, remoteUrl, … }`;
  - `window.electronAPI.modelGetAll(): Promise<LocalLLMModelStatus[]>` (`src/types/electron.ts:1260`; each entry has `id` and `isDownloaded`). `LocalModelPicker.tsx:114-125` uses the same call to mark downloaded models;
  - `LOCAL_MODELS_CHANGED_EVENT` from `src/hooks/useModelDownload.ts:21`, which is dispatched on `window` when a local model finishes downloading.

Facts from the code:
- **The audit's description is stale.** The gate is not an AI-model check. It is the `notesOnboardingComplete` localStorage flag, so a first-time user never sees their notes.
- **"A model is selected" is not "a model can run".** `isLLMConfigured` is almost always true, because `cleanupModel` defaults to `qwen3.5-2b-q4_k_m`, and `noteFormattingModel` has the same default (`settingsStore.ts:1622`). A fresh profile therefore has a selected local model that is not on disk.
  - **Local mode (the default):** the hint asks main whether that model is downloaded.
  - **Self-hosted mode:** it needs a URL.
  - **Remote providers:** they report `null` (no hint) until Plan 03's resolver lands, rather than guessing from key fields that hydrate asynchronously.
  - **Today's run check:** a run without a usable model fails only at run time. `actionProcessingStore.ts:~96` checks just for an empty id.
- **A second bug.** `ActionManagerDialog` is rendered only inside the `editorNote` branch, so the sidebar "Actions" button did nothing with no note open. Hoisting the dialog fixes that.

- [ ] **Step 1: Write the failing test**

Create `test/components/notesActionsGate.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = fs.readFileSync(
  path.join(__dirname, "../../src/components/notes/PersonalNotesView.tsx"),
  "utf8"
);
const load = () => import("../../src/components/notes/shared.ts");
const loadReadiness = () => import("../../src/utils/noteActionsReadiness.ts");

test("a fresh profile's default local model is selected but not ready", async () => {
  const { noteActionsReadiness } = await loadReadiness();
  const fresh = { mode: "local", model: "qwen3.5-2b-q4_k_m", remoteUrl: "" };
  assert.equal(noteActionsReadiness(fresh, new Set()), false, "selected, not on disk");
  assert.equal(noteActionsReadiness(fresh, new Set(["qwen3.5-2b-q4_k_m"])), true);
  assert.equal(noteActionsReadiness(fresh, null), null, "still checking: no hint yet");
});

test("self-hosted needs a URL; an empty model is never ready; remote is unknown", async () => {
  const { noteActionsReadiness } = await loadReadiness();
  assert.equal(noteActionsReadiness({ mode: "self-hosted", model: "m", remoteUrl: " " }, null), false);
  assert.equal(
    noteActionsReadiness({ mode: "self-hosted", model: "m", remoteUrl: "http://localhost:11434/v1" }, null),
    true
  );
  assert.equal(noteActionsReadiness({ mode: "local", model: "", remoteUrl: "" }, new Set()), false);
  assert.equal(noteActionsReadiness({ mode: "providers", model: "gpt", remoteUrl: "" }, null), null);
});

test("the hint shows only when Actions cannot run, and until dismissed", async () => {
  const { shouldShowActionsModelHint, NOTES_ACTIONS_MODEL_HINT_KEY } = await load();
  assert.equal(NOTES_ACTIONS_MODEL_HINT_KEY, "notesActionsModelHintDismissed");
  assert.equal(shouldShowActionsModelHint(false, false), true);
  assert.equal(shouldShowActionsModelHint(true, false), false);
  assert.equal(shouldShowActionsModelHint(null, false), false, "unknown is not a reason to nag");
  assert.equal(shouldShowActionsModelHint(false, true), false);
});

test("notes render without passing through the Actions first run", () => {
  assert.doesNotMatch(view, /if \(!isOnboardingComplete\) \{\s*return/);
});

test("Actions opens the first run once, then the manager, from any view", () => {
  assert.equal(view.match(/<ActionManagerDialog\b/g)?.length, 1, "one manager dialog");
  assert.ok(
    view.indexOf("<ActionManagerDialog") > view.indexOf("<ContainerOverview"),
    "the manager is outside the editor-only branch"
  );
  assert.match(view, /<DialogContent[\s\S]*?<NotesOnboarding onComplete=\{finishActionsIntro\} \/>/);
  assert.equal(view.match(/setShowActionManager\(true\)/g)?.length, 2, "openActions and finishActionsIntro");
  assert.match(view, /onManageActions=\{openActions\}/);
});

test("the hint links to model settings and can be dismissed", () => {
  assert.match(view, /const noteActionsReady = useNoteActionsReady\(\);/);
  assert.match(view, /shouldShowActionsModelHint\(noteActionsReady, modelHintDismissed\)/);
  assert.doesNotMatch(view, /ring-ring\/\d+/, "full-opacity focus rings (Task 3)");
  assert.match(view, /onOpenSettings\("intelligence"\)/);
  assert.match(view, /localStorage\.setItem\(NOTES_ACTIONS_MODEL_HINT_KEY, "true"\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/notesActionsGate.test.js`
Expected: FAIL. `shouldShowActionsModelHint` is not a function, and the early return is still present.

- [ ] **Step 3: Implement**

1. Append to `src/components/notes/shared.ts`:

   ```ts
   export const NOTES_ACTIONS_MODEL_HINT_KEY = "notesActionsModelHintDismissed";

   /** Notes always render; this row only explains why Actions cannot run yet.
    * `ready` is null while unknown, and unknown is not a reason to show it. */
   export function shouldShowActionsModelHint(ready: boolean | null, dismissed: boolean): boolean {
     return !dismissed && ready === false;
   }
   ```

   Create `src/utils/noteActionsReadiness.ts`:

   ```ts
   export interface NoteFormattingSnapshot {
     mode: string;
     model: string;
     remoteUrl?: string;
   }

   /** Whether note Actions can run with the resolved note-formatting config.
    * true: ready. false: cannot run, so show the hint. null: unknown, either
    * still checking or a remote provider; Plan 03's route resolver (§5.1)
    * reports remote readiness. A selected local model only counts once it is
    * on disk. */
   export function noteActionsReadiness(
     config: NoteFormattingSnapshot,
     downloadedModelIds: ReadonlySet<string> | null
   ): boolean | null {
     if (!config.model) return false;
     if (config.mode === "local") return downloadedModelIds ? downloadedModelIds.has(config.model) : null;
     if (config.mode === "self-hosted") return Boolean(config.remoteUrl?.trim());
     return null;
   }
   ```

   Create `src/hooks/useNoteActionsReady.ts`:

   ```ts
   import { useEffect, useState } from "react";
   import { useShallow } from "zustand/react/shallow";
   import { selectResolvedNoteFormatting, useSettingsStore } from "../stores/settingsStore";
   import { noteActionsReadiness } from "../utils/noteActionsReadiness";
   import { LOCAL_MODELS_CHANGED_EVENT } from "./useModelDownload";

   export function useNoteActionsReady(): boolean | null {
     const config = useSettingsStore(
       useShallow((state) => {
         const resolved = selectResolvedNoteFormatting(state);
         return { mode: resolved.mode, model: resolved.model, remoteUrl: resolved.remoteUrl };
       })
     );
     const [downloaded, setDownloaded] = useState<ReadonlySet<string> | null>(null);

     useEffect(() => {
       if (config.mode !== "local") return undefined;
       let cancelled = false;
       const refresh = () => {
         void window.electronAPI
           ?.modelGetAll?.()
           .then((models) => {
             if (cancelled || !Array.isArray(models)) return;
             setDownloaded(new Set(models.filter((m) => m.isDownloaded).map((m) => m.id)));
           })
           .catch(() => {
             if (!cancelled) setDownloaded(null);
           });
       };
       refresh();
       // A download finishing elsewhere (Settings, onboarding) makes the model ready.
       window.addEventListener(LOCAL_MODELS_CHANGED_EVENT, refresh);
       return () => {
         cancelled = true;
         window.removeEventListener(LOCAL_MODELS_CHANGED_EVENT, refresh);
       };
     }, [config.mode, config.model]);

     return noteActionsReadiness(config, downloaded);
   }
   ```

2. In `PersonalNotesView.tsx`, update the imports:
   - line 5 becomes `import { Plus, Sparkles, X } from "../icons";`;
   - line 78 becomes `import { defaultFolderDisplayName, notesEmptyTitleKey, NOTES_ACTIONS_MODEL_HINT_KEY, shouldShowActionsModelHint } from "./shared";`;
   - add `import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";` with the other `../ui/*` imports;
   - add `import { useNoteActionsReady } from "../../hooks/useNoteActionsReady";` next to the `useNotesOnboarding` import.

   If `X` is not exported from `../icons`, use the name `ChatInput.tsx` imports it under. It imports `{ Mic, Square, X }` from `"../icons"`, so `X` exists.

3. Next to `const [showActionManager, setShowActionManager] = useState(false);` (line 138), add:

   ```tsx
     const [showActionsIntro, setShowActionsIntro] = useState(false);
     const [modelHintDismissed, setModelHintDismissed] = useState(
       () => localStorage.getItem(NOTES_ACTIONS_MODEL_HINT_KEY) === "true"
     );
   ```

4. After the `useNotesOnboarding()` line (line 250), add:

   ```tsx
     const noteActionsReady = useNoteActionsReady();

     // The old first-run screen is now the Actions manager's first run: notes
     // are never hidden behind it.
     const openActions = useCallback(() => {
       if (isOnboardingComplete) setShowActionManager(true);
       else setShowActionsIntro(true);
     }, [isOnboardingComplete]);

     const finishActionsIntro = useCallback(() => {
       completeOnboarding();
       setShowActionsIntro(false);
       setShowActionManager(true);
     }, [completeOnboarding]);

     const dismissModelHint = useCallback(() => {
       localStorage.setItem(NOTES_ACTIONS_MODEL_HINT_KEY, "true");
       setModelHintDismissed(true);
     }, []);
   ```

   `useCallback` is already imported in this file (it is used at line 236).

5. Delete the early return (lines 679–685):

   ```tsx
     if (!isOnboardingComplete) {
       return (
         <>
           <NotesOnboarding onComplete={completeOnboarding} />
         </>
       );
     }
   ```

6. Sidebar Actions button (line 696): change `onClick={() => setShowActionManager(true)}` to `onClick={openActions}`, and its `focus-visible:ring-1 focus-visible:ring-ring/30` (line 701) to `focus-visible:ring-2 focus-visible:ring-ring`. Directly after that `</button>` (line 706), and still inside the `px-2 pt-2 pb-1` div, add:

   ```tsx
               {shouldShowActionsModelHint(noteActionsReady, modelHintDismissed) && (
                 <div
                   role="note"
                   className="mt-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground"
                 >
                   <div className="flex items-start gap-1.5">
                     <span className="flex-1">{t("notes.actionsModelHint.title")}</span>
                     <button
                       type="button"
                       onClick={dismissModelHint}
                       aria-label={t("common.close")}
                       className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                     >
                       <X size={12} aria-hidden="true" />
                     </button>
                   </div>
                   {onOpenSettings && (
                     <button
                       type="button"
                       onClick={() => onOpenSettings("intelligence")}
                       className="mt-0.5 text-link hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                     >
                       {t("notes.actionsModelHint.choose")}
                     </button>
                   )}
                 </div>
               )}
   ```

   `--color-link` (#c43e13 light, #ff9a7a dark) already exists in `src/index.css` (lines 31 and 154), so `text-link` resolves today.

7. `ActionPicker` (`onManageActions` at line 762): change `onManageActions={() => setShowActionManager(true)}` to `onManageActions={openActions}`.
8. Delete `<ActionManagerDialog open={showActionManager} onOpenChange={setShowActionManager} />` from the editor branch (line 772).
9. Before the component's final `</div>` (line 935, directly after the `{activeFolderId && (<AddNotesToFolderDialog … />)}` block), add:

   ```tsx
         <ActionManagerDialog open={showActionManager} onOpenChange={setShowActionManager} />
         <Dialog open={showActionsIntro} onOpenChange={setShowActionsIntro}>
           <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0">
             <DialogTitle className="sr-only">{t("notes.onboarding.actions.title")}</DialogTitle>
             <NotesOnboarding onComplete={finishActionsIntro} />
           </DialogContent>
         </Dialog>
   ```

10. Add the locale keys:

    ```bash
    node - <<'EOF'
    const fs = require("node:fs");
    const path = require("node:path");
    const ADD = {
      "notes.actionsModelHint.title": {
        en: "Actions need an AI model", ar: "تحتاج الإجراءات إلى نموذج ذكاء اصطناعي",
        de: "Aktionen benötigen ein KI-Modell", es: "Las acciones necesitan un modelo de IA",
        fr: "Les actions nécessitent un modèle d'IA", it: "Le azioni richiedono un modello di IA",
        ja: "アクションには AI モデルが必要です", pt: "As ações precisam de um modelo de IA",
        ru: "Для действий нужна модель ИИ", "zh-CN": "操作需要 AI 模型", "zh-TW": "動作需要 AI 模型",
      },
      "notes.actionsModelHint.choose": {
        en: "Choose a model", ar: "اختر نموذجًا", de: "Modell wählen", es: "Elegir un modelo",
        fr: "Choisir un modèle", it: "Scegli un modello", ja: "モデルを選択", pt: "Escolher um modelo",
        ru: "Выбрать модель", "zh-CN": "选择模型", "zh-TW": "選擇模型",
      },
    };
    for (const lang of fs.readdirSync("src/locales")) {
      const file = path.join("src/locales", lang, "translation.json");
      if (!fs.existsSync(file)) continue;
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [key, values] of Object.entries(ADD)) {
        if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
        const parts = key.split(".");
        let node = json;
        for (const part of parts.slice(0, -1)) node = node[part] ??= {};
        node[parts.at(-1)] = values[lang];
      }
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    }
    EOF
    ```

11. The comment at line 288 (block 286–292) says the dialog "also renders in the onboarding branch below". Step 5 removed that branch, so delete that clause from the comment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/notesActionsGate.test.js test/components/notesShared.test.js test/components/fieldDirectionPolicy.test.js test/locales/translationCoverage.test.js`

Expected: PASS. Then check by hand on a fresh profile with no local model downloaded: the hint appears, and it disappears once the model finishes downloading in Settings.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/noteActionsReadiness.ts src/hooks/useNoteActionsReady.ts src/components/notes/shared.ts src/components/notes/PersonalNotesView.tsx src/locales test/components/notesActionsGate.test.js
git commit -m "fix(notes): render notes without the Actions gate; first run moves to Actions"
```

---

### Task 15: Settings navigation semantics and real provider tabs

Covers SET-Q1 and SET-Q20.

**Files:**
- Create: `src/components/ui/providerTabsKeys.ts`
- Modify: `src/components/ui/SidebarModal.tsx`. Change the close button's ring (line 135), the `<nav>` (line 151) and the nav item `<button>` (lines 171–183).
- Modify: `src/components/ui/ProviderTabs.tsx`. Change the imports (line 1), `ProviderTabItem` (lines 7–13) and the render (lines 72–123).
- Modify: `DESIGN.md` (D10)
- Test: `test/components/settingsNavigation.test.js`

**Interfaces:**
- Produces:
  - `nextEnabledTabIndex(disabled: readonly boolean[], current: number, key: string, direction: "ltr" | "rtl"): number | null`;
  - `ProviderTabItem.keySaved?: boolean`, which renders a small dot plus screen-reader text from the existing `personal.keyConfigured` ("Key saved securely"). Plan 03 (SET-R5) wires real key status; no caller sets it in this plan.
- Consumes `rendererOptions` (Task 4).

Behaviour:
- **Roving focus.** The selected enabled tab, or else the first enabled tab, is the only tab stop. That follows the WAI-ARIA tabs pattern: tabbing into a tablist lands on the active tab. With manual activation, arrowing to a tab and tabbing away does not move the tab stop to it. Selection does that, with Enter, Space or a click. The Codex review suggested a focus-following tab stop; APG specifies the active tab, so this plan keeps it.
- **Arrow keys.**
  - Left and Right move focus in reading order, so they swap under RTL.
  - Home and End jump to the first and last enabled tab.
  - Disabled tabs are skipped. They keep the native `disabled` attribute, so they cannot take focus.
- **Manual activation.** Enter, Space or a click selects. Some callers switch local and remote (`ReasoningModelSelector.tsx:527` mode tabs), so focus alone must never select.
- **The settings sidebar nav** gets `aria-current="page"`, a visible 2px orange focus ring (`--color-ring`: `#e84e16` in light after Task 3, `#ff5a1f` in Plum Night), an accessible name in compact mode, and an `aria-label` on `<nav>`. The ring is inset, because the nav scrolls (`overflow-y-auto`) and would clip an outset ring.

- [ ] **Step 1: Write the failing test**

Create `test/components/settingsNavigation.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
const loadKeys = () => import("../../src/components/ui/providerTabsKeys.ts");

test("the settings sidebar marks the current section and shows keyboard focus", () => {
  const modal = read("src/components/ui/SidebarModal.tsx");
  assert.match(modal, /<nav\s+aria-label=\{title\}/);
  assert.match(modal, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(modal, /aria-label=\{isCompact \? item\.label : undefined\}/);
  assert.match(modal, /outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset/);
  assert.doesNotMatch(modal, /ring-ring\/\d+/, "the close button's ring is full opacity too (Task 3)");
});

test("arrow keys move between enabled tabs and wrap", async () => {
  const { nextEnabledTabIndex } = await loadKeys();
  const disabled = [false, true, false, false];
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowRight", "ltr"), 2, "skips disabled");
  assert.equal(nextEnabledTabIndex(disabled, 3, "ArrowRight", "ltr"), 0, "wraps");
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowLeft", "ltr"), 3);
  assert.equal(nextEnabledTabIndex(disabled, 2, "Home", "ltr"), 0);
  assert.equal(nextEnabledTabIndex(disabled, 0, "End", "ltr"), 3);
  assert.equal(nextEnabledTabIndex(disabled, 0, "Enter", "ltr"), null, "Enter is activation");
  assert.equal(nextEnabledTabIndex([true, true], 0, "ArrowRight", "ltr"), null);
});

test("RTL swaps Left and Right", async () => {
  const { nextEnabledTabIndex } = await loadKeys();
  const disabled = [false, false, false];
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowLeft", "rtl"), 1);
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowRight", "rtl"), 2);
});

test("arrow keys only move focus; selection stays an explicit activation", () => {
  const tabs = read("src/components/ui/ProviderTabs.tsx");
  const handler = tabs.match(/const handleKeyDown = [\s\S]*?\n {2}\};/)[0];
  assert.match(handler, /\.focus\(\)/);
  assert.doesNotMatch(handler, /onSelect/);
});

test("provider tabs render as a tablist with one tab stop", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-provider-tabs-"));
  const { ProviderTabs } = await vite.ssrLoadModule("/components/ui/ProviderTabs.tsx");
  const html = renderToStaticMarkup(
    createElement(ProviderTabs, {
      providers: [
        { id: "openai", name: "OpenAI", keySaved: true },
        { id: "groq", name: "Groq", disabled: true, disabledLabel: "Soon" },
        { id: "anthropic", name: "Anthropic" },
      ],
      selectedId: "anthropic",
      onSelect() {},
    })
  );
  assert.match(html, /role="tablist"/);
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 3);
  assert.match(tabs[2], /aria-selected="true"/);
  assert.match(tabs[2], /tabindex="0"/);
  assert.match(tabs[0], /aria-selected="false"/);
  assert.match(tabs[0], /tabindex="-1"/);
  assert.match(tabs[1], /disabled=""/);
  assert.match(html, /<span class="sr-only">personal\.keyConfigured<\/span>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/settingsNavigation.test.js`
Expected: FAIL. There is no `aria-current` in SidebarModal, and `providerTabsKeys.ts` is missing.

- [ ] **Step 3: Implement**

Create `src/components/ui/providerTabsKeys.ts`:

```ts
export type TabDirection = "ltr" | "rtl";

/** Where a key moves focus in a tab row: reading-order arrows (swapped in RTL),
 * Home and End, skipping disabled tabs and wrapping. null means "not a
 * navigation key"; Enter and Space stay with the button as activation. */
export function nextEnabledTabIndex(
  disabled: readonly boolean[],
  current: number,
  key: string,
  direction: TabDirection
): number | null {
  const count = disabled.length;
  if (count === 0) return null;
  const forward = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  const backward = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
  let start: number;
  let step: number;
  if (key === forward) [start, step] = [current + 1, 1];
  else if (key === backward) [start, step] = [current - 1, -1];
  else if (key === "Home") [start, step] = [0, 1];
  else if (key === "End") [start, step] = [count - 1, -1];
  else return null;
  for (let i = 0; i < count; i++) {
    const index = (((start + i * step) % count) + count) % count;
    if (!disabled[index]) return index;
  }
  return null;
}
```

In `src/components/ui/SidebarModal.tsx`:
- Line 135 (the close button): replace `focus-visible:ring-ring/30` with `focus-visible:ring-ring`.
- Line 151: `<nav` becomes `<nav aria-label={title}`. `title` is a `string` prop (line 23).
- Nav item button (lines 171–176). Add these attributes, and change the class string's `outline-none` to `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`:

  ```tsx
                              <button
                                key={item.id}
                                type="button"
                                data-section-id={item.id}
                                aria-current={isActive ? "page" : undefined}
                                aria-label={isCompact ? item.label : undefined}
                                onClick={() => onSectionChange(item.id)}
                                title={isCompact ? item.label : undefined}
                                className={`group relative w-full flex items-center text-start text-xs rounded-md transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
  ```

In `src/components/ui/ProviderTabs.tsx`:
1. Line 1 becomes `import { ReactNode, useRef, useEffect, useLayoutEffect, useCallback, type KeyboardEvent } from "react";`, and add `import { nextEnabledTabIndex } from "./providerTabsKeys";`.
2. Add `keySaved?: boolean;` to `ProviderTabItem`.
3. Change `const { t } = useTranslation();` to `const { t, i18n } = useTranslation();`. Then, after `updateIndicator` and its effects, add:

   ```tsx
     const selectedIndex = providers.findIndex((p) => p.id === selectedId && !p.disabled);
     const tabStopIndex =
       selectedIndex !== -1 ? selectedIndex : providers.findIndex((p) => !p.disabled);

     const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
       const buttons = Array.from(
         containerRef.current?.querySelectorAll<HTMLButtonElement>("[data-tab-button]") ?? []
       );
       const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
       if (current === -1) return;
       const next = nextEnabledTabIndex(
         providers.map((p) => !!p.disabled),
         current,
         event.key,
         i18n?.dir?.() === "rtl" ? "rtl" : "ltr"
       );
       if (next === null) return;
       event.preventDefault();
       buttons[next]?.focus();
     };
   ```

4. In the render:
   - Add `role="tablist"` and `onKeyDown={handleKeyDown}` to the container `<div>`.
   - Add `aria-hidden="true"` to the indicator `<div>`.
   - Change the map callback to `providers.map((provider, index) => {`.
   - On each tab `<button>`, add `role="tab"`, `aria-selected={isSelected}` and `tabIndex={index === tabStopIndex ? 0 : -1}`. Keep `disabled` and `aria-disabled`.
   - Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` to the first class string, after `transition-colors duration-150`.
   - After the `disabledLabel` span, add:

   ```tsx
               {provider.keySaved && (
                 <>
                   <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                   <span className="sr-only">{t("personal.keyConfigured")}</span>
                 </>
               )}
   ```

**DESIGN.md (D10).** In `### Navigation`, append:

```markdown
- **Settings sidebar:** the current section carries `aria-current="page"`; every item shows a 2px full-opacity `--color-ring` focus ring, inset because the list scrolls. Compact (icon-only) items are named by their label.
- **Provider tabs:** a real tablist. Arrow keys (reversed in RTL), Home and End move focus across enabled tabs; Enter, Space or a click selects. Focus alone never switches provider, local or remote. Tabbing into the list lands on the selected tab (WAI-ARIA tabs pattern). A saved key shows as a small dot with screen-reader text.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/settingsNavigation.test.js test/components/directionalContentPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/providerTabsKeys.ts src/components/ui/ProviderTabs.tsx src/components/ui/SidebarModal.tsx DESIGN.md test/components/settingsNavigation.test.js
git commit -m "fix(a11y): settings nav semantics and real provider tabs"
```

---

### Task 16: Keyboard-selectable model cards

Covers SET-Q2.

**Files:**
- Modify: `src/components/ui/ModelCardList.tsx`:
  - `ModelCardProps` (line 46) and `ModelCardListProps` (line 228);
  - the `ModelCard` render (lines 105–224);
  - the `ModelCardList` render (lines 258–273).
- Modify: `src/components/ui/SearchableModelList.tsx:244`. Pass `selectionRole="none"`.
- Modify: `src/locales/*/translation.json`. Add `models.deleteNamed` and `models.listLabel`.
- Modify: `DESIGN.md` (D10)
- Test: `test/components/modelCardKeyboard.test.js`

**Interfaces:**
- Produces:
  - `ModelCardProps.selectionRole?: "radio" | "none"` (default `"radio"`);
  - `ModelCardProps.tabIndex?: number`, set on the radio (the list passes `0` or `-1`);
  - `ModelCardListProps.ariaLabel?: string` (default `t("models.listLabel")`).
- Consumes `rendererOptions` (Task 4).

Design:
- **Why the card root cannot be the radio.** A `role="radio"` element's children are presentational. If the root were the radio, the card's delete, download and cancel buttons and its "Learn more" link would lose their roles. So the card keeps its layout and gains a full-bleed overlay `<button role="radio">` as a sibling of those controls.
  - The overlay is the hit area, the tab stop and the focus ring.
  - The real controls sit above it with `pointer-events-auto`.
  - The content row is `pointer-events-none`, so clicks on text reach the overlay.
  - **"Learn more" must never select the model**, in either mode. `createExternalLinkHandler` (`src/utils/externalLinks.ts:9-13`) only calls `preventDefault`. The click still bubbled to the card root, so opening a model's documentation selected it. That mattered most in `SearchableModelList`, which keeps the root `onClick`. The anchor now stops propagation in both modes. It also uses `text-link` (D1) instead of raw `text-primary/60`.
- **One tab stop, arrow keys move focus.** The list is a roving-tabindex radiogroup. Only one radio is in the tab order: the selected card, or the first selectable card when nothing in this list is selected. Down and Right move focus to the next card, Up and Left to the previous one, wrapping at the ends. Tab leaves the radio for the card's own actions and the next control.
- **Selection is explicit: arrow keys do not select.** Enter, Space (native `<button>`) or a click selects. This departs from the WAI-ARIA radio pattern, where an arrow also checks, on purpose. Selecting a card can change where audio goes:
  - In `TranscriptionModelPicker`, a list shows the browsed provider's models with `selectedModel=""` when that provider is not the active one (`:1281-1286`).
  - Its `handleCloudModelSelect` then switches the cloud transcription provider (`:863-870`). `ReasoningModelSelector.handleModelSelect` likewise sets the provider (`:480-491`).
  - If selection followed focus, browsing a provider's list with the arrow keys would move audio, or text, to that provider. Screen readers still announce each card as "radio, not selected", and Space selects it, as with the provider tabs' manual activation (Task 15).
- **No nested radio.** `SearchableModelList` already wraps each card in `role="option"`, so it opts out with `selectionRole="none"`. That keeps the old root `onClick` and adds no radio.
- **Unselectable cards stay focusable.** A local model that is not downloaded is `aria-disabled`, not `disabled`. Screen-reader users can still find it next to its Download button.

- [ ] **Step 1: Write the failing test**

Create `test/components/modelCardKeyboard.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createElement } = React;
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/ModelCardList.tsx"),
  "utf8"
);

async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-model-card-keyboard-"));
  return vite.ssrLoadModule("/components/ui/ModelCardList.tsx");
}

const LOCAL_MODELS = [
  { value: "parakeet", label: "Parakeet", isDownloaded: true },
  { value: "whisper", label: "Whisper", isDownloaded: true },
  { value: "orukeet", label: "Orukeet", isDownloaded: false },
];

test("a model list is a labelled radiogroup of named, selectable radios", async (t) => {
  const { default: ModelCardList } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCardList, {
      models: LOCAL_MODELS,
      selectedModel: "parakeet",
      onModelSelect() {},
      onDownload() {},
      onDelete() {},
    })
  );
  assert.match(html, /role="radiogroup" aria-label="models\.listLabel"/);
  const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 3);
  assert.match(radios[0], /aria-checked="true"/);
  assert.match(radios[0], /aria-label="Parakeet"/);
  assert.match(radios[1], /aria-checked="false"/);
  assert.match(radios[2], /aria-disabled="true"/, "not downloaded yet");
  assert.doesNotMatch(radios[2], /\sdisabled=""/, "still focusable");
  assert.match(radios[0], /type="button"/);
  // One tab stop: the selected card.
  assert.match(radios[0], /tabindex="0"/);
  assert.match(radios[1], /tabindex="-1"/);
  assert.match(radios[2], /tabindex="-1"/);
});

test("with nothing selected in this list, the first selectable card is the tab stop", async (t) => {
  const { default: ModelCardList } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCardList, {
      // Orukeet first: not downloaded, so it cannot be the tab stop.
      models: [LOCAL_MODELS[2], LOCAL_MODELS[0], LOCAL_MODELS[1]],
      selectedModel: "",
      onModelSelect() {},
      onDownload() {},
      onDelete() {},
    })
  );
  const stops = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) =>
    /tabindex="0"/.test(m[0])
  );
  assert.deepEqual(stops, [false, true, false]);
});

test("the delete button is named and appears on keyboard focus, not only on hover", async (t) => {
  const { default: ModelCardList } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCardList, {
      models: LOCAL_MODELS,
      selectedModel: "parakeet",
      onModelSelect() {},
      onDownload() {},
      onDelete() {},
    })
  );
  const del = html.match(/<button[^>]*aria-label="models\.deleteNamed\(model=Whisper\)"[^>]*>/);
  assert.ok(del, "delete has an accessible name");
  assert.match(del[0], /group-focus-within:opacity-100/);
  assert.match(del[0], /focus-visible:opacity-100/);
});

test("a card inside a listbox option does not nest a radio", async (t) => {
  const { ModelCard } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCard, {
      model: { value: "gpt", label: "GPT" },
      isSelected: false,
      onSelect() {},
      selectionRole: "none",
    })
  );
  assert.doesNotMatch(html, /role="radio"/);
});

test("arrow keys move focus between cards and never select", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, rendererOptions("loqui-model-card-arrows-"));
  const { default: ModelCardList } = await vite.ssrLoadModule("/components/ui/ModelCardList.tsx");
  const selected = [];
  root = createRoot(tree.container);
  await React.act(async () =>
    root.render(
      createElement(ModelCardList, {
        models: LOCAL_MODELS,
        selectedModel: "parakeet",
        onModelSelect: (value) => selected.push(value),
        onDownload() {},
        onDelete() {},
      })
    )
  );
  const radios = [];
  const walk = (node) => {
    if (node.attributes?.role === "radio") radios.push(node);
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(tree.container);
  assert.equal(radios.length, 3);
  const focused = [];
  radios.forEach((radio, index) => {
    radio.focus = () => focused.push(index);
  });
  const group = tree.find((node) => node.attributes?.role === "radiogroup");
  const press = (key, from) => {
    let prevented = false;
    tree.props(group).onKeyDown({
      key,
      target: radios[from],
      currentTarget: { querySelectorAll: () => radios },
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  };

  assert.equal(press("ArrowDown", 0), true);
  assert.equal(press("ArrowRight", 1), true, "reaches a card that is not downloaded yet");
  assert.equal(press("ArrowDown", 2), true, "wraps to the first card");
  assert.equal(press("ArrowUp", 0), true, "wraps to the last card");
  assert.equal(press("ArrowLeft", 2), true);
  assert.deepEqual(focused, [1, 2, 0, 2, 1]);
  assert.deepEqual(selected, [], "moving focus never changes the model");

  assert.equal(press("Tab", 0), false, "Tab is left to the browser");
  const del = tree.find((node) => node.attributes?.["aria-label"]?.startsWith("models.deleteNamed"));
  tree.props(group).onKeyDown({
    key: "ArrowDown",
    target: del,
    currentTarget: { querySelectorAll: () => radios },
    preventDefault() {
      assert.fail("arrows on a card action are not intercepted");
    },
  });
  assert.equal(focused.length, 5);
});

test("Learn more never selects the model, and reads as a link", async (t) => {
  // createExternalLinkHandler only prevents navigation; the anchor's own
  // stopPropagation keeps the click from reaching the card root's onClick
  // (still present with selectionRole="none") or the radio.
  assert.match(source, /onClick=\{openSpec\}/);
  assert.match(
    source,
    /const openSpec = \(event: React\.MouseEvent\) => \{\s*event\.stopPropagation\(\);/
  );
  const { ModelCard } = await load(t);
  const html = renderToStaticMarkup(
    createElement(ModelCard, {
      model: { value: "gpt", label: "GPT", specUrl: "https://example.com/spec" },
      isSelected: false,
      onSelect() {},
      selectionRole: "none",
    })
  );
  const anchor = html.match(/<a [^>]*>/)[0];
  assert.match(anchor, /\btext-link\b/, "links use --color-link (D1)");
  assert.doesNotMatch(anchor, /text-primary/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/modelCardKeyboard.test.js`
Expected: FAIL on the `role="radiogroup"` match.

- [ ] **Step 3: Implement**

1. Add `selectionRole?: "radio" | "none";` and `tabIndex?: number;` to `ModelCardProps`, and `ariaLabel?: string;` to `ModelCardListProps`.
2. `ModelCard`: destructure `selectionRole = "radio",` and `tabIndex,`. After `handleCardClick`, add:

   ```tsx
     const isSelectable = isLocalMode ? Boolean(isDownloaded) : true;
     const asRadio = selectionRole === "radio";
   ```

3. Replace the card's opening tags (lines 105–112: `return ( <div onClick={handleCardClick} …> <div className="flex items-center gap-1.5">`) with:

   ```tsx
     return (
       <div
         onClick={asRadio ? undefined : handleCardClick}
         className={`relative w-full p-2 rounded-md border text-start transition-colors duration-200 group overflow-hidden ${
           isSelected ? styles.selected : styles.default
         } ${!isLocalMode || (isDownloaded && !isSelected) ? "cursor-pointer" : ""}`}
       >
         {asRadio && (
           // The whole card is the hit area, but the radio is a sibling of the
           // card's own buttons and link so they keep their roles and names.
           <button
             type="button"
             role="radio"
             aria-checked={isSelected}
             aria-disabled={isSelectable ? undefined : true}
             aria-label={model.label}
             tabIndex={tabIndex}
             onClick={handleCardClick}
             className={cn(
               "absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
               isSelectable && !isSelected ? "cursor-pointer" : "cursor-default"
             )}
           />
         )}
         <div className={cn("relative flex items-center gap-1.5", asRadio && "pointer-events-none")}>
   ```

4. Add `pointer-events-auto` at the start of the class strings of all three `<Button>`s (Delete, Cancel, Download). Replace the spec `<a>` (lines 155–163) and add its handler after `specHref` (line 76):

   ```tsx
     const openExternalSpec = specHref ? createExternalLinkHandler(specHref) : undefined;
     // Documentation is not a choice: never let the click reach the card or the radio.
     const openSpec = (event: React.MouseEvent) => {
       event.stopPropagation();
       openExternalSpec?.(event);
     };
   ```

   ```tsx
           {specHref && (
             <a
               href={specHref}
               onClick={openSpec}
               className="pointer-events-auto inline-flex items-center gap-0.5 text-xs text-link hover:underline shrink-0"
             >
               {t("models.learnMore")}
               <ExternalLink size={9} aria-hidden="true" />
             </a>
           )}
   ```
5. Delete button (lines 181–191). Add an accessible name and the focus reveal:

   ```tsx
                   <Button
                     onClick={(e) => {
                       e.stopPropagation();
                       onDelete?.(model.value);
                     }}
                     size="icon"
                     variant="ghost"
                     aria-label={t("models.deleteNamed", { model: model.label })}
                     className="pointer-events-auto size-6 text-muted-foreground/70 hover:text-destructive opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-[color,opacity,transform] active:scale-95"
                   >
                     <Trash2 size={12} aria-hidden="true" />
                   </Button>
   ```

6. `ModelCardList`:
   - destructure `ariaLabel`;
   - reuse the `const { t } = useTranslation();` that the function already declares (line 252); do not add a second one;
   - add a module-level step table above `ModelCardList`:

     ```tsx
     const ARROW_STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
     ```

   - after the `models.length === 0` early return, add the tab stop and the key handler:

     ```tsx
       const isSelectable = (model: ModelCardOption) => (onDownload ? Boolean(model.isDownloaded) : true);
       // Roving tabindex: one tab stop per list, on the selected card, else on
       // the first card that can be selected.
       const tabStop =
         models.find((model) => model.value === selectedModel && isSelectable(model))?.value ??
         models.find(isSelectable)?.value ??
         models[0].value;

       // Arrows move focus only. Selecting can switch the provider
       // (TranscriptionModelPicker's handleCloudModelSelect), so it stays on
       // Enter, Space or a click.
       const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
         const step = ARROW_STEP[event.key];
         if (!step) return;
         const radios = Array.from(
           event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
         );
         const from = radios.indexOf(event.target as HTMLButtonElement);
         if (from === -1) return; // a card action has focus: leave its keys alone
         event.preventDefault();
         radios[(from + step + radios.length) % radios.length].focus();
       };
     ```

   - change the container to `<div role="radiogroup" aria-label={ariaLabel ?? t("models.listLabel")} onKeyDown={handleKeyDown} className={`space-y-0.5 ${className}`}>`;
   - pass `tabIndex={model.value === tabStop ? 0 : -1}` to each `<ModelCard>`.

   Focus moves, but the tab stop stays on the selected card, so Tab away and back returns to the selection. That matches the provider tabs (Task 15).
7. `src/components/ui/SearchableModelList.tsx:244`: add `selectionRole="none"` to the `<ModelCard … />` inside the `role="option"` wrapper.
8. Add the locale keys:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const ADD = {
     "models.deleteNamed": {
       en: "Delete {{model}}", ar: "حذف {{model}}", de: "{{model}} löschen", es: "Eliminar {{model}}",
       fr: "Supprimer {{model}}", it: "Elimina {{model}}", ja: "{{model}} を削除", pt: "Excluir {{model}}",
       ru: "Удалить {{model}}", "zh-CN": "删除 {{model}}", "zh-TW": "刪除 {{model}}",
     },
     "models.listLabel": {
       en: "Models", ar: "النماذج", de: "Modelle", es: "Modelos", fr: "Modèles", it: "Modelli",
       ja: "モデル", pt: "Modelos", ru: "Модели", "zh-CN": "模型", "zh-TW": "模型",
     },
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const [key, values] of Object.entries(ADD)) {
       if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
       const parts = key.split(".");
       let node = json;
       for (const part of parts.slice(0, -1)) node = node[part] ??= {};
       node[parts.at(-1)] = values[lang];
     }
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

**DESIGN.md (D10).** In `### Chips`, append to the **State** bullet: "Model cards are radios in a labelled radiogroup with one tab stop, on the selected card. The whole card is the hit area. Arrow keys move focus between cards; only Enter, Space or a click selects, because selecting can switch the provider. A not-yet-downloaded local model is `aria-disabled` but still focusable. Card actions (delete, download, cancel, Learn more) keep their own names; delete appears on hover or keyboard focus."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/modelCardKeyboard.test.js test/components/directionalContentPolicy.test.js test/components/orukeetOrganization.test.js test/locales/translationCoverage.test.js`
Expected: PASS. If an existing test clicks the card root via `__reactProps$…onClick`, point it at the `role="radio"` child instead. Selecting by clicking the card is still the behaviour; only the element that owns the handler moved.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ModelCardList.tsx src/components/ui/SearchableModelList.tsx src/locales DESIGN.md test/components/modelCardKeyboard.test.js
git commit -m "fix(a11y): keyboard-selectable model cards with a named delete"
```

---

### Task 17: Manual update check works with automatic updates off

Covers SET-Q16, plus the `ml-2` RTL leak in the same file (part of SET-Q6).

The owner approved this behaviour as **D13** (CCR 3): manual checks stay available when automatic updates are off, nothing downloads without an explicit click, and the rule pinned at `test/helpers/updateManager.test.js:187` is replaced.

**Files:**
- Modify: `src/helpers/updateManager.js`. Change `preferences()` (lines 92–111) and `check()` (lines 124–171).
- Modify: `src/types/updates.ts:2`. Add `"available"` to `phase`.
- Modify: `src/components/settings/UpdateSettings.tsx` (lines 69–97)
- Modify: `docs/PRIVACY.md:63`
- Modify: `src/locales/*/translation.json`. Add `updates.available`, inserted after `updates.ready`.
- Test: `test/helpers/updateManager.test.js`. Rewrite the two tests that pin "disabled means no manual check" (lines 63–76 and 187–197), and add three cases. Also `test/components/updateSettings.test.js`.

**Interfaces:**
- Produces `UpdateStatus.phase === "available"`, carrying `availableVersion`. It means a manual check found a newer version while automatic updates are off. Nothing was downloaded.
- `UpdateManager.check(manual = true)` keeps its signature. A manual check now runs even when `prefs.enabled` is false. It never downloads in that case.

Facts from the code:
- Removing `!status?.enabled` from the button alone does nothing. `UpdateManager.check()` returns early when `!this.prefs.enabled` (`src/helpers/updateManager.js:128`).
- A successful check auto-downloads (lines 147–156).
- Two existing tests pin the old rule, and both are rewritten to pin the scheduled path instead:
  - lines 63–76, "disabled never checks", calls `check()`, whose default is `manual = true`;
  - lines 187–197 assert "the off switch also blocks manual checks" outright.

- [ ] **Step 1: Write the failing tests**

In `test/helpers/updateManager.test.js`, replace the test at lines 63–76 with the version below, and append the three tests after it:

```js
test("unsupported, unpackaged and not-onboarded installs never check; disabled skips timer checks", async (t) => {
  for (const options of [{ supported: false }, { packaged: false }]) {
    const s = setup(t, options);
    await s.manager.check();
    assert.equal(s.counts().checks, 0);
  }
  const s = setup(t);
  s.manager.prefs.onboarded = false;
  await s.manager.check();
  s.manager.prefs.onboarded = true;
  s.manager.preferences({ enabled: false });
  await s.manager.check(false);
  assert.equal(s.counts().checks, 0);
});

test("a manual check with automatic updates off reports the update and never downloads", async (t) => {
  const s = setup(t);
  s.manager.preferences({ enabled: false });
  await s.manager.check(true);
  assert.equal(s.counts().checks, 1);
  assert.equal(s.counts().downloads, 0);
  assert.equal(s.manager.status().phase, "available");
  assert.equal(s.manager.status().availableVersion, "0.1.0-beta.2");
});

test("turning automatic updates on after a manual find downloads it", async (t) => {
  const s = setup(t);
  s.manager.preferences({ enabled: false });
  await s.manager.check(true);
  s.manager.preferences({ enabled: true });
  for (let i = 0; i < 10 && s.manager.status().phase !== "ready"; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(s.counts().downloads, 1);
  assert.equal(s.manager.status().phase, "ready");
});

test("a failed manual check with automatic updates off still reports the error", async (t) => {
  const s = setup(t);
  s.updater.checkForUpdates = async () => {
    throw new Error("offline");
  };
  s.manager.preferences({ enabled: false });
  await s.manager.check(true);
  assert.equal(s.manager.status().phase, "error");
});
```

Replace the test at lines 187–197 with:

```js
test("a downloaded update is not re-checked; the off switch blocks scheduled checks, not a manual one", async (t) => {
  const s = setup(t);
  s.manager.now = () => DAY * 10;
  await s.manager.check(false);
  await s.manager.check(true);
  assert.equal(s.counts().checks, 1, "ready update blocks re-check");
  const off = setup(t);
  off.manager.preferences({ enabled: false });
  await off.manager.check(false);
  assert.equal(off.counts().checks, 0, "no scheduled check while automatic updates are off");
  await off.manager.check(true);
  assert.equal(off.counts().checks, 1, "an explicit check still runs");
  assert.equal(off.counts().downloads, 0, "and never downloads");
});
```

Create `test/components/updateSettings.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Check for Updates is not disabled by turning automatic updates off", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.doesNotMatch(ui, /!status\?\.enabled/);
  assert.match(ui, /disabled=\{!status \|\| \["checking", "downloading"\]\.includes\(status\.phase\)\}/);
});

test("an available update offers the GitHub download and names the version", () => {
  const ui = read("src/components/settings/UpdateSettings.tsx");
  assert.match(ui, /status\?\.phase === "available" && \(\s*<p>\{t\("updates\.available", \{ version: status\.availableVersion \}\)\}<\/p>/);
  assert.match(ui, /status\?\.phase === "manual" \|\| status\?\.phase === "available" \?/);
  assert.match(read("src/types/updates.ts"), /"available"/);
});

test("no physical margin remains in the update controls", () => {
  assert.doesNotMatch(read("src/components/settings/UpdateSettings.tsx"), /\bml-2\b/);
});

test("the privacy doc explains the manual check with automatic updates off", () => {
  assert.match(read("docs/PRIVACY.md"), /With automatic updates off, \*\*Check for Updates\*\* still works/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/updateManager.test.js test/components/updateSettings.test.js`
Expected: FAIL. The manual check makes 0 checks (both rewritten tests and the new ones), and the UI still has `!status?.enabled`.

- [ ] **Step 3: Implement**

1. `src/helpers/updateManager.js`, `preferences(patch)`. Record whether this call turns automatic updates on, then re-check if a manual find is waiting. Change the start and the end of the method:

   ```js
     preferences(patch) {
       if (this.restarting) throw Error("An update restart is already being prepared.");
       const enabling = patch?.enabled === true && !this.prefs.enabled;
       if (typeof patch?.enabled === "boolean") this.prefs.enabled = patch.enabled;
   ```

   ```js
       this.configureChannel();
       this.save();
       // A manual check found an update while automatic updates were off; now
       // that they are on, fetch it the same way a scheduled check would.
       if (enabling && this.state.phase === "available") {
         this.publish({ phase: "idle", availableVersion: undefined });
         void this.check(true);
       }
       return this.status();
     }
   ```

2. `check(manual = true)`:
   - In the guard, replace `!this.prefs.enabled ||` with `(!this.prefs.enabled && !manual) ||`, and put this comment above the `if`:

     ```js
         // A manual check is an explicit request, so it runs even with automatic
         // updates off. It then reports what is available and never downloads.
     ```

   - Replace the post-check block from `if (!this.prefs.enabled || channel !== this.prefs.channel) return this.status();` through `} else this.publish({ phase: "idle" });` with:

     ```js
         if (channel !== this.prefs.channel) return this.status();
         const semver = require("semver");
         const next = result?.updateInfo?.version;
         if (
           next &&
           semver.gt(next, this.version) &&
           (channel === "beta" || !semver.prerelease(next))
         ) {
           if (!this.prefs.enabled) {
             this.publish({ phase: "available", availableVersion: next });
           } else {
             this.downloadChannel = channel;
             this.publish({ phase: "downloading", availableVersion: next });
             const { CancellationToken } = require("builder-util-runtime");
             this.cancel = new CancellationToken();
             await this.updater.downloadUpdate(this.cancel);
           }
         } else this.publish({ phase: "idle" });
     ```

   - In `catch`, change `if (this.prefs.enabled && channel === this.prefs.channel)` to `if ((this.prefs.enabled || manual) && channel === this.prefs.channel)`.

3. `src/types/updates.ts:2`: `phase: "idle" | "manual" | "available" | "checking" | "downloading" | "ready" | "error";`.
4. `src/components/settings/UpdateSettings.tsx`. In the `{!setup && (…)}` block:
   - after the `phase === "ready"` paragraph (line 73), add:

     ```tsx
               {status?.phase === "available" && (
                 <p>{t("updates.available", { version: status.availableVersion })}</p>
               )}
     ```

   - change `{status?.phase === "manual" ? (` to `{status?.phase === "manual" || status?.phase === "available" ? (`;
   - change the Check button's `disabled={…}` to `disabled={!status || ["checking", "downloading"].includes(status.phase)}`;
   - change `<Button className="ml-2" onClick={() => void run(() => api.restart())}>` to `className="ms-2"`.
5. `docs/PRIVACY.md:63`: append this sentence to the paragraph: "With automatic updates off, **Check for Updates** still works: it contacts GitHub only when you click it, never downloads, and links to the release instead."
6. Add the locale key directly after `updates.ready`. `updates` is the last top-level object, and Plan 01 appends `locality` after it, so appending at the object's end would conflict:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const VALUES = {
     en: "Loqui {{version}} is available. Turn on automatic updates to install it, or download it from GitHub.",
     ar: "Loqui {{version}} متاح. فعّل التحديثات التلقائية لتثبيته، أو نزّله من GitHub.",
     de: "Loqui {{version}} ist verfügbar. Aktiviere automatische Updates, um es zu installieren, oder lade es von GitHub herunter.",
     es: "Loqui {{version}} está disponible. Activa las actualizaciones automáticas para instalarlo o descárgalo desde GitHub.",
     fr: "Loqui {{version}} est disponible. Activez les mises à jour automatiques pour l'installer, ou téléchargez-le depuis GitHub.",
     it: "Loqui {{version}} è disponibile. Attiva gli aggiornamenti automatici per installarlo oppure scaricalo da GitHub.",
     ja: "Loqui {{version}} が利用可能です。自動アップデートをオンにしてインストールするか、GitHub からダウンロードしてください。",
     pt: "O Loqui {{version}} está disponível. Ative as atualizações automáticas para instalá-lo ou baixe-o do GitHub.",
     ru: "Доступна версия Loqui {{version}}. Включите автоматические обновления, чтобы установить её, или скачайте с GitHub.",
     "zh-CN": "Loqui {{version}} 已可用。开启自动更新即可安装，或从 GitHub 下载。",
     "zh-TW": "Loqui {{version}} 已可使用。開啟自動更新即可安裝，或從 GitHub 下載。",
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     if (!(lang in VALUES)) throw new Error(`updates.available has no ${lang} value`);
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     const ordered = {};
     for (const [key, value] of Object.entries(json.updates)) {
       if (key === "available") continue;
       ordered[key] = value;
       if (key === "ready") ordered.available = VALUES[lang];
     }
     json.updates = ordered;
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/updateManager.test.js test/components/updateSettings.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/updateManager.js src/types/updates.ts src/components/settings/UpdateSettings.tsx docs/PRIVACY.md src/locales test/helpers/updateManager.test.js test/components/updateSettings.test.js
git commit -m "fix(updates): manual check works with automatic updates off"
```

---

### Task 18: Honest settings copy

Covers:
- SET-Q6 (the rest): the setup card strings and CodexConnection's `ml-2`;
- SET-Q7 (Bedrock fields);
- SET-Q11 (neutral URL placeholders);
- SET-Q12 (no phantom endpoint).

**Files:**
- Modify: `src/components/SettingsPage.tsx:625-635` (the "Review dictation setup" card)
- Modify: `src/components/CodexConnection.tsx:138`
- Modify: `src/components/ui/ApiKeyInput.tsx`. Add a `masked` prop (props at lines 7–16; the `<Input>` at lines 100–114).
- Modify: `src/components/EnterpriseProviderConfig.tsx:126-130`
- Modify: `src/components/SelfHostedPanel.tsx:21-22`
- Modify: `src/components/settings/InferenceConfigEditor.tsx:175`. The audit missed this second LAN IP.
- Modify: `src/components/OpenAICompatiblePanel.tsx:272` and `:352-358`
- Modify: `src/locales/*/translation.json`:
  - add `settingsPage.reviewSetup.{title,description,action}`;
  - change three `reasoning.enterprise.*` values in `en` only.
- Test: `test/components/settingsCopy.test.js`

**Interfaces:**
- Produces `ApiKeyInput` prop `masked?: boolean` (default `true`). When `false`, the edit field is `type="text"`. The saved state still never echoes the value.
- Consumes `rendererOptions` (Task 4).

Notes:
- The Bedrock access key ID is an identifier, not a secret: AWS shows it in consoles and logs. It still saves through the secure store, unchanged (`saveBedrockAccessKeyId`).
- `AKIA…` is a format example, not language, so it is not translated.
- Other locales keep their existing Bedrock labels, which already translate the same meaning. Only `en` gains the "AWS" prefix and sentence case.

- [ ] **Step 1: Write the failing test**

Create `test/components/settingsCopy.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const repoRoot = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("the setup card is translated", () => {
  const page = read("src/components/SettingsPage.tsx");
  assert.doesNotMatch(page, />Review dictation setup</);
  assert.doesNotMatch(page, /Open setup\s*</);
  assert.match(page, /t\("settingsPage\.reviewSetup\.title"\)/);
  assert.match(page, /t\("settingsPage\.reviewSetup\.description"\)/);
  assert.match(page, /t\("settingsPage\.reviewSetup\.action"\)/);
});

test("CodexConnection uses logical margins", () => {
  assert.doesNotMatch(read("src/components/CodexConnection.tsx"), /\b(ml|mr|pl|pr)-\d/);
});

test("no component ships a private LAN address as a placeholder", () => {
  const lan = /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/;
  const offenders = walk(path.join(repoRoot, "src/components")).filter((file) =>
    lan.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(offenders.map((f) => path.relative(repoRoot, f)), []);
  assert.match(read("src/components/SelfHostedPanel.tsx"), /"http:\/\/localhost:8178"/);
  assert.match(read("src/components/SelfHostedPanel.tsx"), /"http:\/\/localhost:11434\/v1"/);
});

test("Bedrock asks for the access key ID in the clear and labels AWS fields honestly", () => {
  const config = read("src/components/EnterpriseProviderConfig.tsx");
  assert.match(
    config,
    /label=\{t\("reasoning\.enterprise\.accessKeyId"\)\}[\s\S]*?masked=\{false\}[\s\S]*?placeholder="AKIA…"/
  );
  assert.match(read("src/components/ui/ApiKeyInput.tsx"), /type=\{masked \? "password" : "text"\}/);
  const en = JSON.parse(read("src/locales/en/translation.json")).reasoning.enterprise;
  assert.equal(en.accessKeyId, "AWS access key ID");
  assert.equal(en.secretAccessKey, "Secret access key");
  assert.equal(en.sessionToken, "Session token (optional)");
});

async function renderPanel(t, baseUrl) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-openai-compatible-copy-"));
  const { default: Panel } = await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx");
  return renderToStaticMarkup(
    createElement(Panel, {
      baseUrl,
      setBaseUrl() {},
      apiKey: "",
      setApiKey() {},
      model: "",
      setModel() {},
    })
  );
}

test("no endpoint is announced while the URL is empty", async (t) => {
  const html = await renderPanel(t, "");
  assert.doesNotMatch(html, /reasoning\.custom\.queryPrefix/);
  assert.doesNotMatch(html, /api\.openai\.com\/v1\/models/);
  assert.match(html, /reasoning\.custom\.enterEndpoint/);
});

test("a saved endpoint is named exactly", async (t) => {
  const html = await renderPanel(t, "http://localhost:11434/v1");
  assert.match(html, /reasoning\.custom\.queryPrefix/);
  assert.match(html, /http:\/\/localhost:11434\/v1\/models/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/settingsCopy.test.js`
Expected: FAIL. The setup card is still English, the LAN IPs are found, and the empty panel prints `api.openai.com/v1/models`.

- [ ] **Step 3: Implement**

1. `src/components/SettingsPage.tsx:627-634` becomes:

   ```tsx
             <p className="text-sm font-medium">{t("settingsPage.reviewSetup.title")}</p>
             <p className="text-xs text-muted-foreground">
               {t("settingsPage.reviewSetup.description")}
             </p>
           </div>
           <Button variant="outline" size="sm" onClick={startOnboarding}>
             {t("settingsPage.reviewSetup.action")}
           </Button>
   ```

   Plan 03 (SET-Q24) demotes this card. This task only translates it.

2. `src/components/CodexConnection.tsx:138`: `className="ml-2"` becomes `className="ms-2"`.
3. `src/components/ui/ApiKeyInput.tsx`:
   - add `masked?: boolean;` to `ApiKeyInputProps`, and `masked = true,` to the destructuring;
   - in the edit `<Input>`, change `type="password"` to `type={masked ? "password" : "text"}`.
4. `src/components/EnterpriseProviderConfig.tsx:126-130`, the access key ID input, becomes:

   ```tsx
             <ApiKeyInput
               label={t("reasoning.enterprise.accessKeyId")}
               masked={false}
               placeholder="AKIA…"
               apiKey={settings.bedrockAccessKeyId}
               setApiKey={(value) => void saveSecret("bedrockAccessKeyId", value)}
             />
   ```

5. `src/components/SelfHostedPanel.tsx:21-22`:

   ```tsx
     const placeholderUrl =
       service === "transcription" ? "http://localhost:8178" : "http://localhost:11434/v1";
   ```

6. `src/components/settings/InferenceConfigEditor.tsx:175`: `baseUrlPlaceholder="http://192.168.1.126:11434/v1"` becomes `baseUrlPlaceholder="http://localhost:11434/v1"`.
7. `src/components/OpenAICompatiblePanel.tsx`:
   - line 272 becomes:

     ```tsx
       // Only name an endpoint the panel will actually query; the placeholder is
       // an example, not a destination.
       const queryUrl = hasBase ? buildApiUrl(normalizedBase, "/models") : null;
     ```

   - wrap the "We'll query" paragraph (lines 352–358) in `{queryUrl && ( … )}`:

     ```tsx
           {queryUrl && (
             <p className="text-xs text-muted-foreground">
               {t("reasoning.custom.queryPrefix")}{" "}
               <code dir="ltr" className="break-all">
                 {queryUrl}
               </code>{" "}
               {t("reasoning.custom.querySuffix")}
             </p>
           )}
     ```

8. Locale changes:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const ADD = {
     "settingsPage.reviewSetup.title": {
       en: "Review dictation setup", ar: "مراجعة إعداد الإملاء", de: "Diktier-Einrichtung prüfen",
       es: "Revisar la configuración del dictado", fr: "Revoir la configuration de la dictée",
       it: "Rivedi la configurazione della dettatura", ja: "音声入力の設定を見直す",
       pt: "Revisar configuração de ditado", ru: "Проверить настройку диктовки",
       "zh-CN": "检查听写设置", "zh-TW": "檢查聽寫設定",
     },
     "settingsPage.reviewSetup.description": {
       en: "Return to the focused setup flow without changing your existing notes or credentials.",
       ar: "ارجع إلى خطوات الإعداد دون تغيير ملاحظاتك أو بيانات الاعتماد الحالية.",
       de: "Kehre zur geführten Einrichtung zurück, ohne vorhandene Notizen oder Zugangsdaten zu ändern.",
       es: "Vuelve al asistente de configuración sin cambiar tus notas ni credenciales.",
       fr: "Revenez à l'assistant de configuration sans modifier vos notes ni vos identifiants.",
       it: "Torna alla configurazione guidata senza modificare note o credenziali esistenti.",
       ja: "既存のメモや認証情報を変更せずに、セットアップの流れに戻ります。",
       pt: "Volte ao fluxo de configuração sem alterar suas notas ou credenciais.",
       ru: "Вернитесь к пошаговой настройке, не меняя заметки и учётные данные.",
       "zh-CN": "返回设置流程，不会更改现有笔记或凭据。",
       "zh-TW": "返回設定流程，不會變更現有筆記或憑證。",
     },
     "settingsPage.reviewSetup.action": {
       en: "Open setup", ar: "فتح الإعداد", de: "Einrichtung öffnen", es: "Abrir configuración",
       fr: "Ouvrir la configuration", it: "Apri configurazione", ja: "セットアップを開く",
       pt: "Abrir configuração", ru: "Открыть настройку", "zh-CN": "打开设置向导", "zh-TW": "開啟設定精靈",
     },
   };
   const EN_ONLY = {
     "reasoning.enterprise.accessKeyId": "AWS access key ID",
     "reasoning.enterprise.secretAccessKey": "Secret access key",
     "reasoning.enterprise.sessionToken": "Session token (optional)",
   };
   const set = (json, key, value) => {
     const parts = key.split(".");
     let node = json;
     for (const part of parts.slice(0, -1)) node = node[part] ??= {};
     node[parts.at(-1)] = value;
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const [key, values] of Object.entries(ADD)) {
       if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
       set(json, key, values[lang]);
     }
     if (lang === "en") for (const [key, value] of Object.entries(EN_ONLY)) set(json, key, value);
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/settingsCopy.test.js test/components/fieldDirectionPolicy.test.js test/components/codexConnectionSignIn.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPage.tsx src/components/CodexConnection.tsx src/components/ui/ApiKeyInput.tsx src/components/EnterpriseProviderConfig.tsx src/components/SelfHostedPanel.tsx src/components/settings/InferenceConfigEditor.tsx src/components/OpenAICompatiblePanel.tsx src/locales test/components/settingsCopy.test.js
git commit -m "fix(settings): translated setup card, honest Bedrock fields, neutral URLs, no phantom endpoint"
```

---

### Task 19: Clear All Audio confirms with counts and reports failures honestly

Covers SET-Q5.

**Files:**
- Create: `src/utils/audioDeletion.ts` (pure outcome)
- Create: `src/helpers/audioFlagReconcile.js` (main-process flag reconciliation)
- Create: `src/hooks/useAudioStorageUsage.ts`
- Create: `src/components/settings/AudioStorageRow.tsx`
- Modify: `src/helpers/audioStorage.js`:
  - `deleteAllAudio()` and `getStorageUsage()` (lines 167–206) report failures;
  - add `remainingAudioIds()`.
- Modify: `src/helpers/ipcHandlers.js:1400-1417` (`delete-all-audio`). Unflag only recordings whose file is really gone.
- Modify: `src/types/electron.ts:857-858` and `src/preview/browserPreview.ts:276`.
- Modify: `src/components/SettingsPage.tsx`:
  - imports (near line 102);
  - remove the usage state and effect (lines 1116–1129);
  - replace `handleClearAllAudio` (lines 1146–1155);
  - replace the row (lines 2794–2814).
- Modify: `src/locales/*/translation.json`:
  - add `settingsPage.privacy.clearAllAudioTitle`, `clearAllAudioCounted`, `clearAllAudioAction`, `clearAllAudioDone`, `clearAllAudioFailed`, `audioStorageChecking` and `audioStorageUnavailable`;
  - delete the unused `clearAllAudioConfirm`.
- Test:
  - `test/helpers/audioStorageClear.test.js`: the real main helper, plus flag reconciliation;
  - `test/hooks/useAudioStorageUsage.test.js`;
  - `test/components/audioStorageRow.test.js`;
  - `test/components/clearAllAudio.test.js`.

**Interfaces (CCR 5; Plan 03 must preserve them):**
- **Main, `AudioStorageManager`:**
  - `deleteAllAudio(): { deleted: number; failed: number; readable: boolean }`. `deleted` counts files actually unlinked, and `failed` counts files that could not be. An unreadable folder returns `{ deleted: 0, failed: 0, readable: false }`.
  - `getStorageUsage(): { fileCount: number; totalBytes: number; readable: boolean }`. An unreadable folder returns `readable: false`, never a zero that looks empty.
  - `remainingAudioIds(): Set<string> | null` returns the transcription ids that still have a file, or `null` when the folder cannot be read.
- **Main, `clearFlagsForDeletedAudio({ audioStorage, database }): number[]`** (`src/helpers/audioFlagReconcile.js`). It clears `has_audio` only for rows whose file is gone, and returns the cleared ids. With an unreadable folder it clears nothing.
- The IPC channels and preload methods are unchanged and pass the new fields through. The other `deleteAllAudio()` callers (`ipcHandlers.js:1288` and `:3165`) ignore the result.
- **Renderer:**
  - `resolveClearAudioOutcome(deleted: { failed: number; readable: boolean } | null, after: { fileCount: number; readable: boolean } | null): "cleared" | "partial"`.
  - `type AudioUsage = { status: "loading" } | { status: "known"; fileCount: number; totalBytes: number } | { status: "unavailable" }`.
  - `useAudioStorageUsage(active: boolean): { usage: AudioUsage; refresh(): Promise<AudioUsage>; clearAll(): Promise<"cleared" | "partial"> }`.
  - `AudioStorageRow({ usage, clearError, onClear, onRetry })`.
- **Consumes:**
  - `showConfirmDialog` from `useDialogs` (`SettingsPage.tsx:970-976`);
  - `formatBytes` (`src/utils/formatBytes`);
  - `SettingsRow` from `src/components/ui/SettingsSection.tsx`;
  - `installElectronStub` and `setUserDataDir` (`test/helpers/harness/electronStub.js`);
  - `rendererOptions` (Task 4).

Facts from the code:
- **`deleteAllAudio` never reports a failure today.** Unlink errors are only logged (`audioStorage.js:171-178`). It returns `{ deleted: files.length }` even when unlinks failed, and `{ deleted: 0 }` for an unreadable folder.
- **`getStorageUsage` hides an unreadable folder.** It catches the read error and returns zeros (lines 202–204). The Settings row then says "No audio files stored" and disables Clear.
- **`delete-all-audio` clears `has_audio` on every row afterwards** (`ipcHandlers.js:1400-1417`). It does so even when files survived. `TranscriptionItem.tsx:97` uses that flag to offer playback, so surviving recordings would lose their history access.
  - Audio files are named `OpenWhispr-…-<id>.webm` or `<id>.webm` (`audioStorage.js:38-46`, lookup at 75–86). That is enough to tell which ids still have a file.
- **The usage fetch's callback is annotated** `(usage: { fileCount: number; totalBytes: number })` (`SettingsPage.tsx:1125`). Adding `readable` without removing that annotation fails typecheck. The new hook drops the annotation and takes its type from `src/types/electron.ts`.
- **`ConfirmDialog` does not await `onConfirm`** (`src/components/ui/dialog.tsx:108-190`), so the async work handles its own errors.

Behaviour:
- **States.** Usage is "checking", a known count, or "unavailable". The unavailable state reads "Loqui couldn't read its audio folder, so it can't show or clear stored audio right now." In place of Clear it shows Retry.
- **Fresh count before confirming.** Clear All re-reads the folder first.
  - If that read fails, the row turns unavailable and no confirmation opens. A stale count is never presented as current.
  - Otherwise the confirmation names the fresh count and size.
- **Outcome.** After deleting, the row re-reads the folder.
  - "Cleared" is shown only when main deleted everything it could read and the folder reads back readable and empty.
  - Anything else shows an alert below the row. The row shows what remains, or "unavailable".

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/audioStorageClear.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { installElectronStub, setUserDataDir } = require("./harness/electronStub.js");

installElectronStub();
const AudioStorageManager = require("../../src/helpers/audioStorage.js");
const { clearFlagsForDeletedAudio } = require("../../src/helpers/audioFlagReconcile.js");

function makeManager(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-audio-clear-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setUserDataDir(path.join(root, "profile"));
  return { manager: new AudioStorageManager(), root };
}

// The slice of DatabaseManager the reconciliation uses.
function fakeDatabase(ids) {
  const cleared = [];
  return {
    cleared,
    db: { prepare: () => ({ all: () => ids.map((id) => ({ id })) }) },
    clearAudioFlags(list) {
      cleared.push(...list);
      return { success: true };
    },
  };
}

test("a clean delete reports every file and leaves a readable, empty store", (t) => {
  const { manager } = makeManager(t);
  fs.writeFileSync(path.join(manager.audioDir, "OpenWhispr-2026-10-15-09-00-00-1.webm"), "a");
  fs.writeFileSync(path.join(manager.audioDir, "2.webm"), "bb");
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 2, totalBytes: 3, readable: true });
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 2, failed: 0, readable: true });
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 0, totalBytes: 0, readable: true });
});

test("a file that cannot be deleted is counted as a failure, not as deleted", (t) => {
  const { manager } = makeManager(t);
  fs.writeFileSync(path.join(manager.audioDir, "1.webm"), "a");
  // A directory with the .webm suffix: unlinkSync refuses it on every platform.
  fs.mkdirSync(path.join(manager.audioDir, "OpenWhispr-2026-10-15-09-00-00-2.webm"));
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 1, failed: 1, readable: true });
  assert.deepEqual([...manager.remainingAudioIds()], ["2"]);
});

test("an unreadable store is reported, never counted as empty", (t) => {
  const { manager, root } = makeManager(t);
  manager.audioDir = path.join(root, "missing");
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 0, totalBytes: 0, readable: false });
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 0, failed: 0, readable: false });
  assert.equal(manager.remainingAudioIds(), null);
});

test("after a partial delete, only recordings whose file is gone lose their audio flag", (t) => {
  const { manager } = makeManager(t);
  fs.writeFileSync(path.join(manager.audioDir, "1.webm"), "a");
  fs.mkdirSync(path.join(manager.audioDir, "2.webm")); // survives the delete
  manager.deleteAllAudio();
  const database = fakeDatabase([1, 2, 3]);
  assert.deepEqual(clearFlagsForDeletedAudio({ audioStorage: manager, database }), [1, 3]);
  assert.deepEqual(database.cleared, [1, 3], "recording 2 keeps history playback");
});

test("an unreadable store clears no audio flags", (t) => {
  const { manager, root } = makeManager(t);
  manager.audioDir = path.join(root, "missing");
  const database = fakeDatabase([1, 2]);
  assert.deepEqual(clearFlagsForDeletedAudio({ audioStorage: manager, database }), []);
  assert.deepEqual(database.cleared, []);
});

test("the delete-all IPC handler reconciles flags through the helper", () => {
  const ipc = fs.readFileSync(path.join(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8");
  const handler = ipc.match(/ipcMain\.handle\("delete-all-audio"[\s\S]*?\n {4}\}\);/)[0];
  assert.match(handler, /clearFlagsForDeletedAudio\(\{/);
  assert.doesNotMatch(handler, /rows\.map\(\(r\) => r\.id\)\)/, "no blanket unflagging");
});
```

Create `test/hooks/useAudioStorageUsage.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function mountUsage(t, electronAPI) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-audio-usage-" });
  const { useAudioStorageUsage } = await vite.ssrLoadModule("/hooks/useAudioStorageUsage.ts");
  const api = {};
  function Harness() {
    Object.assign(api, useAudioStorageUsage(true));
    return null;
  }
  // Each act yields a macrotask so the async IPC reads settle before asserting.
  const run = (fn) =>
    React.act(async () => {
      await fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  root = createRoot(container);
  await run(() => root.render(React.createElement(Harness)));
  return { api, run };
}

test("an unreadable first read is unavailable, not empty", async (t) => {
  const h = await mountUsage(t, {
    getAudioStorageUsage: async () => ({ fileCount: 0, totalBytes: 0, readable: false }),
  });
  assert.deepEqual(h.api.usage, { status: "unavailable" });
});

test("a rejected read is unavailable", async (t) => {
  const h = await mountUsage(t, {
    getAudioStorageUsage: async () => {
      throw new Error("ipc down");
    },
  });
  assert.deepEqual(h.api.usage, { status: "unavailable" });
});

test("a failed refresh after a good count does not keep the stale count", async (t) => {
  let readable = true;
  const h = await mountUsage(t, {
    getAudioStorageUsage: async () =>
      readable ? { fileCount: 4, totalBytes: 900, readable: true } : { fileCount: 0, totalBytes: 0, readable: false },
  });
  assert.deepEqual(h.api.usage, { status: "known", fileCount: 4, totalBytes: 900 });
  readable = false;
  await h.run(() => h.api.refresh());
  assert.deepEqual(h.api.usage, { status: "unavailable" });
});

test("clearing reports partial when files survive or the store cannot be re-read", async (t) => {
  let after = { fileCount: 0, totalBytes: 0, readable: true };
  const h = await mountUsage(t, {
    getAudioStorageUsage: async () => after,
    deleteAllAudio: async () => ({ deleted: 2, failed: 1, readable: true }),
  });
  let outcome;
  await h.run(async () => {
    outcome = await h.api.clearAll();
  });
  assert.equal(outcome, "partial", "a failed unlink is never 'cleared'");
  after = { fileCount: 0, totalBytes: 0, readable: false };
  await h.run(async () => {
    outcome = await h.api.clearAll();
  });
  assert.equal(outcome, "partial");
  assert.deepEqual(h.api.usage, { status: "unavailable" });
});
```

Create `test/components/audioStorageRow.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

async function render(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-audio-storage-row-"));
  const { AudioStorageRow } = await vite.ssrLoadModule("/components/settings/AudioStorageRow.tsx");
  return renderToStaticMarkup(
    createElement(AudioStorageRow, { clearError: false, onClear() {}, onRetry() {}, ...props })
  );
}

test("an unreadable store says so and offers Retry, never 'no audio'", async (t) => {
  const html = await render(t, { usage: { status: "unavailable" } });
  assert.match(html, /settingsPage\.privacy\.audioStorageUnavailable/);
  assert.doesNotMatch(html, /settingsPage\.privacy\.audioStorageEmpty/);
  assert.match(html, />common\.retry</);
  assert.doesNotMatch(html, /settingsPage\.privacy\.clearAllAudio</);
});

test("while checking, Clear is disabled and nothing claims the store is empty", async (t) => {
  const html = await render(t, { usage: { status: "loading" } });
  assert.match(html, /settingsPage\.privacy\.audioStorageChecking/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>settingsPage\.privacy\.clearAllAudio</);
});

test("a known count is shown and a failed clear raises an alert", async (t) => {
  const html = await render(t, {
    usage: { status: "known", fileCount: 3, totalBytes: 2_000_000 },
    clearError: true,
  });
  assert.match(html, /settingsPage\.privacy\.audioStorageFiles\(count=3,size=/);
  assert.match(html, /role="alert"[^>]*>settingsPage\.privacy\.clearAllAudioFailed/);
});
```

Create `test/components/clearAllAudio.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(
  path.join(__dirname, "../../src/components/SettingsPage.tsx"),
  "utf8"
);
const load = () => import("../../src/utils/audioDeletion.ts");

test("only a clean delete of a readable store that reads back empty counts as cleared", async () => {
  const { resolveClearAudioOutcome } = await load();
  const ok = { failed: 0, readable: true };
  assert.equal(resolveClearAudioOutcome(ok, { fileCount: 0, readable: true }), "cleared");
  assert.equal(resolveClearAudioOutcome(ok, { fileCount: 3, readable: true }), "partial");
  assert.equal(resolveClearAudioOutcome({ failed: 1, readable: true }, { fileCount: 0, readable: true }), "partial");
  assert.equal(resolveClearAudioOutcome(ok, { fileCount: 0, readable: false }), "partial", "unreadable is not empty");
  assert.equal(resolveClearAudioOutcome({ failed: 0, readable: false }, { fileCount: 0, readable: true }), "partial");
  assert.equal(resolveClearAudioOutcome(null, null), "partial");
});

test("Clear All re-reads before confirming and never confirms a stale count", () => {
  const handler = page.match(/const handleClearAllAudio = async \(\) => \{[\s\S]*?\n {2}\};/)[0];
  assert.match(handler, /const current = await audioStorage\.refresh\(\);/);
  assert.match(handler, /if \(current\.status !== "known"\) return;/);
  assert.match(handler, /showConfirmDialog\(\{/);
  assert.match(handler, /variant: "destructive"/);
  assert.match(handler, /t\("settingsPage\.privacy\.clearAllAudioCounted"/);
  assert.doesNotMatch(page, /\/\/ silent fail/);
  assert.doesNotMatch(page, /audioStorageUsage\b/, "the old zero-default state is gone");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/audioStorageClear.test.js test/hooks/useAudioStorageUsage.test.js test/components/audioStorageRow.test.js test/components/clearAllAudio.test.js`
Expected: FAIL.
- `getStorageUsage()` lacks `readable`.
- The undeletable directory counts as deleted.
- The new modules are missing.

- [ ] **Step 3: Implement**

1. **`src/helpers/audioStorage.js`.** Replace `deleteAllAudio()` and `getStorageUsage()` (lines 167–206) with the three methods below.

   ```js
     // Reports what actually happened: an unlink failure is counted, and an
     // unreadable folder is never reported as an empty store.
     deleteAllAudio() {
       let files;
       try {
         files = fs.readdirSync(this.audioDir).filter((f) => f.endsWith(".webm"));
       } catch (error) {
         debugLogger.error("Failed to delete all audio", { error: error.message }, "audio-storage");
         return { deleted: 0, failed: 0, readable: false };
       }
       let deleted = 0;
       let failed = 0;
       for (const file of files) {
         try {
           fs.unlinkSync(path.join(this.audioDir, file));
           deleted++;
         } catch (error) {
           failed++;
           debugLogger.error(
             "Failed to delete audio file",
             { file, error: error.message },
             "audio-storage"
           );
         }
       }
       debugLogger.info("All audio deleted", { deleted, failed }, "audio-storage");
       return { deleted, failed, readable: true };
     }

     getStorageUsage() {
       try {
         const files = fs.readdirSync(this.audioDir).filter((f) => f.endsWith(".webm"));
         let totalBytes = 0;
         for (const file of files) {
           try {
             const stats = fs.statSync(path.join(this.audioDir, file));
             totalBytes += stats.size;
           } catch {
             // Skip files that can't be stat'd
           }
         }
         return { fileCount: files.length, totalBytes, readable: true };
       } catch (error) {
         debugLogger.error("Failed to get storage usage", { error: error.message }, "audio-storage");
         return { fileCount: 0, totalBytes: 0, readable: false };
       }
     }

     // Transcription ids that still have an audio file, or null when the folder
     // cannot be read. Filenames end in "-<id>.webm" or are "<id>.webm"
     // (_buildFilename).
     remainingAudioIds() {
       try {
         const ids = new Set();
         for (const file of fs.readdirSync(this.audioDir)) {
           const match = /(?:^|-)(\d+)\.webm$/.exec(file);
           if (match) ids.add(match[1]);
         }
         return ids;
       } catch {
         return null;
       }
     }
   ```

2. **Create `src/helpers/audioFlagReconcile.js`:**

   ```js
   // After "delete all audio", unflag only the recordings whose file is really
   // gone. A file that survived a failed delete keeps its history playback; an
   // unreadable folder unflags nothing, because nothing can be confirmed gone.
   function clearFlagsForDeletedAudio({ audioStorage, database }) {
     const remaining = audioStorage.remainingAudioIds();
     if (remaining === null) return [];
     const rows = database.db.prepare("SELECT id FROM transcriptions WHERE has_audio = 1").all();
     const gone = rows.map((row) => row.id).filter((id) => !remaining.has(String(id)));
     if (gone.length > 0) database.clearAudioFlags(gone);
     return gone;
   }

   module.exports = { clearFlagsForDeletedAudio };
   ```

3. **`src/helpers/ipcHandlers.js`.**
   - Add `const { clearFlagsForDeletedAudio } = require("./audioFlagReconcile");` with the other local requires.
   - Replace the `delete-all-audio` handler (lines 1400–1417) with:

   ```js
       ipcMain.handle("delete-all-audio", async () => {
         const result = this.audioStorageManager.deleteAllAudio();
         try {
           clearFlagsForDeletedAudio({
             audioStorage: this.audioStorageManager,
             database: this.databaseManager,
           });
         } catch (error) {
           debugLogger.error(
             "Failed to clear audio flags after delete-all",
             { error: error.message },
             "audio-storage"
           );
         }
         return result;
       });
   ```

4. **`src/types/electron.ts:857-858`** become:

   ```ts
         getAudioStorageUsage: () => Promise<{ fileCount: number; totalBytes: number; readable: boolean }>;
         deleteAllAudio: () => Promise<{ deleted: number; failed: number; readable: boolean }>;
   ```

   In `src/preview/browserPreview.ts:276`, the stub becomes `getAudioStorageUsage: async () => ({ fileCount: 0, totalBytes: 0, readable: true }),`.

5. **Create `src/utils/audioDeletion.ts`:**

   ```ts
   export type ClearAudioOutcome = "cleared" | "partial";

   /** Cleared only when main deleted every file it could read, and reading the
    * store back finds it readable and empty. Anything unknown is "partial", so
    * the UI never claims audio is gone when it cannot tell. */
   export function resolveClearAudioOutcome(
     deleted: { failed: number; readable: boolean } | null,
     after: { fileCount: number; readable: boolean } | null
   ): ClearAudioOutcome {
     const deletedCleanly = deleted !== null && deleted.readable && deleted.failed === 0;
     const readsEmpty = after !== null && after.readable && after.fileCount === 0;
     return deletedCleanly && readsEmpty ? "cleared" : "partial";
   }
   ```

6. **Create `src/hooks/useAudioStorageUsage.ts`:**

   ```ts
   import { useCallback, useEffect, useState } from "react";
   import { resolveClearAudioOutcome, type ClearAudioOutcome } from "../utils/audioDeletion";

   export type AudioUsage =
     | { status: "loading" }
     | { status: "known"; fileCount: number; totalBytes: number }
     | { status: "unavailable" };

   /** Stored-audio usage for Settings. An unreadable folder or a failed read is
    * "unavailable", never zero, and a failed refresh replaces an older count
    * instead of leaving it on screen as if it were current. */
   export function useAudioStorageUsage(active: boolean) {
     const [usage, setUsage] = useState<AudioUsage>({ status: "loading" });

     const refresh = useCallback(async (): Promise<AudioUsage> => {
       let next: AudioUsage = { status: "unavailable" };
       try {
         const read = await window.electronAPI?.getAudioStorageUsage?.();
         if (read?.readable) {
           next = { status: "known", fileCount: read.fileCount, totalBytes: read.totalBytes };
         }
       } catch {
         // stays unavailable
       }
       setUsage(next);
       return next;
     }, []);

     useEffect(() => {
       if (active) void refresh();
     }, [active, refresh]);

     const clearAll = useCallback(async (): Promise<ClearAudioOutcome> => {
       let deleted: { failed: number; readable: boolean } | null = null;
       try {
         deleted = (await window.electronAPI?.deleteAllAudio?.()) ?? null;
       } catch {
         deleted = null;
       }
       const after = await refresh();
       return resolveClearAudioOutcome(
         deleted,
         after.status === "known" ? { fileCount: after.fileCount, readable: true } : null
       );
     }, [refresh]);

     return { usage, refresh, clearAll };
   }
   ```

7. **Create `src/components/settings/AudioStorageRow.tsx`:**

   ```tsx
   import { useTranslation } from "react-i18next";
   import type { AudioUsage } from "../../hooks/useAudioStorageUsage";
   import { formatBytes } from "../../utils/formatBytes";
   import { Button } from "../ui/button";
   import { SettingsRow } from "../ui/SettingsSection";

   interface AudioStorageRowProps {
     usage: AudioUsage;
     clearError: boolean;
     onClear: () => void;
     onRetry: () => void;
   }

   export function AudioStorageRow({ usage, clearError, onClear, onRetry }: AudioStorageRowProps) {
     const { t } = useTranslation();
     const description =
       usage.status === "loading"
         ? t("settingsPage.privacy.audioStorageChecking")
         : usage.status === "unavailable"
           ? t("settingsPage.privacy.audioStorageUnavailable")
           : usage.fileCount > 0
             ? t("settingsPage.privacy.audioStorageFiles", {
                 count: usage.fileCount,
                 size: formatBytes(usage.totalBytes),
               })
             : t("settingsPage.privacy.audioStorageEmpty");
     return (
       <>
         <SettingsRow label={t("settingsPage.privacy.audioStorageUsage")} description={description}>
           {usage.status === "unavailable" ? (
             <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>
               {t("common.retry")}
             </Button>
           ) : (
             <Button
               variant="outline"
               size="sm"
               className="h-7 text-xs"
               disabled={usage.status !== "known" || usage.fileCount === 0}
               onClick={onClear}
             >
               {t("settingsPage.privacy.clearAllAudio")}
             </Button>
           )}
         </SettingsRow>
         {clearError && (
           <p role="alert" className="mt-2 text-xs text-destructive">
             {t("settingsPage.privacy.clearAllAudioFailed")}
           </p>
         )}
       </>
     );
   }
   ```

8. **`src/components/SettingsPage.tsx`:**
   - Add these imports:

     ```ts
     import { useAudioStorageUsage } from "../hooks/useAudioStorageUsage";
     import { AudioStorageRow } from "./settings/AudioStorageRow";
     ```

   - Delete the `audioStorageUsage` state and its fetch effect (lines 1116–1129). Put this in their place:

     ```tsx
       const audioStorage = useAudioStorageUsage(activeSection === "privacyData");
       const [clearAudioError, setClearAudioError] = useState(false);
     ```

   - Replace `handleClearAllAudio` (lines 1146–1155) with:

     ```tsx
       const handleClearAllAudio = async () => {
         setClearAudioError(false);
         // Count what is on disk now. A failed read turns the row "unavailable"
         // and opens no confirmation: a stale count is never shown as current.
         const current = await audioStorage.refresh();
         if (current.status !== "known") return;
         showConfirmDialog({
           title: t("settingsPage.privacy.clearAllAudioTitle"),
           description: t("settingsPage.privacy.clearAllAudioCounted", {
             summary: t("settingsPage.privacy.audioStorageFiles", {
               count: current.fileCount,
               size: formatBytes(current.totalBytes),
             }),
           }),
           confirmText: t("settingsPage.privacy.clearAllAudioAction"),
           cancelText: t("common.cancel"),
           variant: "destructive",
           onConfirm: () =>
             void (async () => {
               const outcome = await audioStorage.clearAll();
               if (outcome === "cleared") {
                 toast({ title: t("settingsPage.privacy.clearAllAudioDone"), variant: "default" });
               } else {
                 setClearAudioError(true);
               }
             })(),
         });
       };
     ```

   - Replace the row's `<SettingsRow …>…</SettingsRow>` (lines 2794–2814, inside its existing `<SettingsPanelRow>`) with:

     ```tsx
                     <AudioStorageRow
                       usage={audioStorage.usage}
                       clearError={clearAudioError}
                       onClear={() => void handleClearAllAudio()}
                       onRetry={() => void audioStorage.refresh()}
                     />
     ```

   - Keep `formatBytes`, which the handler still uses.

9. Locale changes. Run this from the repo root first, and confirm nothing reads the key being deleted; it must print nothing:

   ```bash
   grep -rn "clearAllAudioConfirm" src --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx'
   ```

   Then apply the changes:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const P = "settingsPage.privacy.";
   const ADD = {
     [P + "clearAllAudioTitle"]: {
       en: "Clear all audio?", ar: "مسح كل الصوت؟", de: "Alle Audiodateien löschen?",
       es: "¿Borrar todo el audio?", fr: "Effacer tout l'audio ?", it: "Cancellare tutto l'audio?",
       ja: "すべての音声を削除しますか？", pt: "Apagar todo o áudio?", ru: "Удалить все аудио?",
       "zh-CN": "清除所有音频？", "zh-TW": "清除所有音訊？",
     },
     [P + "clearAllAudioCounted"]: {
       en: "Stored audio: {{summary}}. Delete all of it? This cannot be undone.",
       ar: "الصوت المخزّن: {{summary}}. هل تريد حذفه كله؟ لا يمكن التراجع عن ذلك.",
       de: "Gespeichertes Audio: {{summary}}. Alles löschen? Das kann nicht rückgängig gemacht werden.",
       es: "Audio almacenado: {{summary}}. ¿Eliminarlo todo? No se puede deshacer.",
       fr: "Audio stocké : {{summary}}. Tout supprimer ? Cette action est irréversible.",
       it: "Audio salvato: {{summary}}. Eliminare tutto? L'operazione non può essere annullata.",
       ja: "保存済みの音声: {{summary}}。すべて削除しますか？元に戻せません。",
       pt: "Áudio armazenado: {{summary}}. Excluir tudo? Isso não pode ser desfeito.",
       ru: "Сохранённое аудио: {{summary}}. Удалить всё? Это действие нельзя отменить.",
       "zh-CN": "已存储的音频：{{summary}}。全部删除？此操作无法撤销。",
       "zh-TW": "已儲存的音訊：{{summary}}。全部刪除？此動作無法復原。",
     },
     [P + "clearAllAudioAction"]: {
       en: "Delete audio", ar: "حذف الصوت", de: "Audio löschen", es: "Eliminar audio",
       fr: "Supprimer l'audio", it: "Elimina audio", ja: "音声を削除", pt: "Excluir áudio",
       ru: "Удалить аудио", "zh-CN": "删除音频", "zh-TW": "刪除音訊",
     },
     [P + "clearAllAudioDone"]: {
       en: "Stored audio deleted", ar: "تم حذف الصوت المخزّن", de: "Gespeichertes Audio gelöscht",
       es: "Audio almacenado eliminado", fr: "Audio stocké supprimé", it: "Audio salvato eliminato",
       ja: "保存済みの音声を削除しました", pt: "Áudio armazenado excluído", ru: "Сохранённое аудио удалено",
       "zh-CN": "已删除存储的音频", "zh-TW": "已刪除儲存的音訊",
     },
     [P + "clearAllAudioFailed"]: {
       en: "Not all stored audio was deleted. Try again, or check that no other app is using the files.",
       ar: "لم يُحذف كل الصوت المخزّن. حاول مرة أخرى، أو تأكد من أن أي تطبيق آخر لا يستخدم الملفات.",
       de: "Nicht alle gespeicherten Audiodateien wurden gelöscht. Versuche es erneut oder prüfe, ob eine andere App die Dateien verwendet.",
       es: "No se eliminó todo el audio almacenado. Inténtalo de nuevo o comprueba que ninguna otra app esté usando los archivos.",
       fr: "Tout l'audio stocké n'a pas été supprimé. Réessayez ou vérifiez qu'aucune autre app n'utilise les fichiers.",
       it: "Non tutto l'audio salvato è stato eliminato. Riprova o verifica che nessun'altra app stia usando i file.",
       ja: "保存済みの音声の一部を削除できませんでした。もう一度試すか、他のアプリがファイルを使用していないか確認してください。",
       pt: "Nem todo o áudio armazenado foi excluído. Tente novamente ou verifique se outro app está usando os arquivos.",
       ru: "Не всё сохранённое аудио удалено. Повторите попытку или проверьте, не использует ли файлы другое приложение.",
       "zh-CN": "并非所有存储的音频都已删除。请重试，或检查是否有其他应用正在使用这些文件。",
       "zh-TW": "並非所有儲存的音訊都已刪除。請再試一次，或確認沒有其他應用程式正在使用這些檔案。",
     },
     [P + "audioStorageChecking"]: {
       en: "Checking stored audio…", ar: "جارٍ التحقق من الصوت المخزّن…", de: "Gespeichertes Audio wird geprüft…",
       es: "Comprobando el audio almacenado…", fr: "Vérification de l'audio stocké…",
       it: "Controllo dell'audio salvato…", ja: "保存済みの音声を確認しています…",
       pt: "Verificando o áudio armazenado…", ru: "Проверка сохранённого аудио…",
       "zh-CN": "正在检查存储的音频…", "zh-TW": "正在檢查儲存的音訊…",
     },
     [P + "audioStorageUnavailable"]: {
       en: "Loqui couldn't read its audio folder, so it can't show or clear stored audio right now.",
       ar: "تعذّر على Loqui قراءة مجلد الصوت، لذا لا يمكنه عرض الصوت المخزّن أو مسحه الآن.",
       de: "Loqui konnte seinen Audioordner nicht lesen und kann gespeichertes Audio gerade weder anzeigen noch löschen.",
       es: "Loqui no pudo leer su carpeta de audio, así que ahora no puede mostrar ni borrar el audio almacenado.",
       fr: "Loqui n'a pas pu lire son dossier audio et ne peut donc pas afficher ni effacer l'audio stocké pour le moment.",
       it: "Loqui non è riuscito a leggere la cartella audio, quindi ora non può mostrare né cancellare l'audio salvato.",
       ja: "Loqui が音声フォルダーを読み取れなかったため、現在は保存済みの音声を表示または削除できません。",
       pt: "O Loqui não conseguiu ler a pasta de áudio, então não pode mostrar nem apagar o áudio armazenado agora.",
       ru: "Loqui не удалось прочитать папку с аудио, поэтому сейчас нельзя показать или удалить сохранённое аудио.",
       "zh-CN": "Loqui 无法读取其音频文件夹，因此现在无法显示或清除存储的音频。",
       "zh-TW": "Loqui 無法讀取其音訊資料夾，因此目前無法顯示或清除儲存的音訊。",
     },
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const [key, values] of Object.entries(ADD)) {
       if (!(lang in values)) throw new Error(`${key} has no ${lang} value`);
       const parts = key.split(".");
       let node = json;
       for (const part of parts.slice(0, -1)) node = node[part] ??= {};
       node[parts.at(-1)] = values[lang];
     }
     delete json.settingsPage.privacy.clearAllAudioConfirm;
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- test/helpers/audioStorageClear.test.js test/helpers/audioStorageTraversal.test.js test/hooks/useAudioStorageUsage.test.js test/components/audioStorageRow.test.js test/components/clearAllAudio.test.js test/locales/translationCoverage.test.js`, then `npm run typecheck`.
Expected: PASS, with no type errors in `SettingsPage.tsx`, `useAudioStorageUsage.ts` or `electron.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/audioStorage.js src/helpers/audioFlagReconcile.js src/helpers/ipcHandlers.js src/types/electron.ts src/preview/browserPreview.ts src/utils/audioDeletion.ts src/hooks/useAudioStorageUsage.ts src/components/settings/AudioStorageRow.tsx src/components/SettingsPage.tsx src/locales test/helpers/audioStorageClear.test.js test/hooks/useAudioStorageUsage.test.js test/components/audioStorageRow.test.js test/components/clearAllAudio.test.js
git commit -m "fix(privacy): honest Clear All Audio: counted confirm, unreadable state, surviving files keep playback"
```

---

### Task 20: Privacy description and dead locale keys

Covers SET-Q13.

**Files:**
- Modify: `src/locales/*/translation.json`:
  - change `settingsModal.sections.privacyData.description` in all 11 locales;
  - delete the dead paths listed below in all 11.
- Modify: `test/locales/translationCoverage.test.js`. Prune six fixture entries that point at deleted keys.
- Test: `test/locales/deadLocaleKeys.test.js`

**Interfaces:** none. These keys are content-only.

Dead keys to delete. Each was verified to have no `t()` reference in `src/` and no dynamic builder that could reach it. `InferenceConfigEditor` builds only `${prefix}.providers|local|selfHosted`, and `ControlPanelSidebar` uses `sidebar.sections.workspace`, a different path that stays.
- `settingsModal.sections.account`, `settingsModal.sections.plansBilling`, `settingsModal.sections.workspace`, `settingsModal.groups.account`
- `settingsPage.account`, `settingsPage.workspace`
- `settingsPage.aiModels.modes.openwhispr`, `settingsPage.aiModels.modes.openwhisprDesc`, `settingsPage.aiModels.openwhisprCloud`, `settingsPage.aiModels.openwhisprCloudDescription`
- `settingsPage.transcription.modes.openwhispr`, `settingsPage.transcription.modes.openwhisprDesc`, `settingsPage.transcription.openwhisprCloud`, `settingsPage.transcription.openwhisprCloudDescription`
- `dictationAgent.modes.openwhispr`, `dictationAgent.modes.openwhisprDesc`
- `agentMode.settings.modes.openwhispr`, `agentMode.settings.modes.openwhisprDesc`
- `promptStudio.test.openwhisprCloud`, `notes.upload.openwhisprCloud`
- `settingsPage.privacy.usageAnalytics`, `settingsPage.privacy.usageAnalyticsDescription`. These are unused, and they contradict `PRODUCT.md` ("no … analytics upload").

These are out of scope; they are listed as an open question:
- `settingsPage.unifiedBilling`
- `settingsPage.enterpriseCheckout`
- `workspaces.*`

- [ ] **Step 1: Write the failing test**

Create `test/locales/deadLocaleKeys.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LOCALES = path.join(__dirname, "../../src/locales");
const languages = fs
  .readdirSync(LOCALES)
  .filter((entry) => fs.existsSync(path.join(LOCALES, entry, "translation.json")));
const load = (lang) =>
  JSON.parse(fs.readFileSync(path.join(LOCALES, lang, "translation.json"), "utf8"));
const get = (json, key) => key.split(".").reduce((node, part) => node?.[part], json);

const DEAD = [
  "settingsModal.sections.account",
  "settingsModal.sections.plansBilling",
  "settingsModal.sections.workspace",
  "settingsModal.groups.account",
  "settingsPage.account",
  "settingsPage.workspace",
  "settingsPage.aiModels.modes.openwhispr",
  "settingsPage.aiModels.modes.openwhisprDesc",
  "settingsPage.aiModels.openwhisprCloud",
  "settingsPage.aiModels.openwhisprCloudDescription",
  "settingsPage.transcription.modes.openwhispr",
  "settingsPage.transcription.modes.openwhisprDesc",
  "settingsPage.transcription.openwhisprCloud",
  "settingsPage.transcription.openwhisprCloudDescription",
  "dictationAgent.modes.openwhispr",
  "dictationAgent.modes.openwhisprDesc",
  "agentMode.settings.modes.openwhispr",
  "agentMode.settings.modes.openwhisprDesc",
  "promptStudio.test.openwhisprCloud",
  "notes.upload.openwhisprCloud",
  "settingsPage.privacy.usageAnalytics",
  "settingsPage.privacy.usageAnalyticsDescription",
];

test("dead account, billing, workspace and hosted-cloud keys are gone from every locale", () => {
  for (const lang of languages) {
    const json = load(lang);
    for (const key of DEAD) assert.equal(get(json, key), undefined, `${lang}: ${key}`);
  }
});

test("the privacy section no longer promises analytics in any language", () => {
  const analytics = /analytic|Analyse|análisis|análise|analisi|аналитик|التحليلات|分析/i;
  for (const lang of languages) {
    const description = get(load(lang), "settingsModal.sections.privacyData.description");
    assert.ok(description, `${lang} keeps the description`);
    assert.doesNotMatch(description, analytics, `${lang}: ${description}`);
  }
  assert.equal(
    get(load("en"), "settingsModal.sections.privacyData.description"),
    "Privacy, permissions & stored data"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/locales/deadLocaleKeys.test.js`
Expected: FAIL on `ar: settingsModal.sections.account`, and on the en description "Privacy, permissions & analytics".

- [ ] **Step 3: Implement**

1. Confirm there are still no code references. This must print nothing (`sidebar.sections.workspace` does not match):

   ```bash
   grep -rnE 'plansBilling|openwhisprCloud|usageAnalytics|settingsPage\.(account|workspace)\b|settingsModal\.(sections\.(account|workspace|plansBilling)|groups\.account)|modes\.openwhispr' src --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx'
   ```

2. Rewrite the locales:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const DEAD = [
     "settingsModal.sections.account", "settingsModal.sections.plansBilling",
     "settingsModal.sections.workspace", "settingsModal.groups.account",
     "settingsPage.account", "settingsPage.workspace",
     "settingsPage.aiModels.modes.openwhispr", "settingsPage.aiModels.modes.openwhisprDesc",
     "settingsPage.aiModels.openwhisprCloud", "settingsPage.aiModels.openwhisprCloudDescription",
     "settingsPage.transcription.modes.openwhispr", "settingsPage.transcription.modes.openwhisprDesc",
     "settingsPage.transcription.openwhisprCloud", "settingsPage.transcription.openwhisprCloudDescription",
     "dictationAgent.modes.openwhispr", "dictationAgent.modes.openwhisprDesc",
     "agentMode.settings.modes.openwhispr", "agentMode.settings.modes.openwhisprDesc",
     "promptStudio.test.openwhisprCloud", "notes.upload.openwhisprCloud",
     "settingsPage.privacy.usageAnalytics", "settingsPage.privacy.usageAnalyticsDescription",
   ];
   const PRIVACY = {
     en: "Privacy, permissions & stored data", ar: "الخصوصية والأذونات والبيانات المخزّنة",
     de: "Datenschutz, Berechtigungen & gespeicherte Daten", es: "Privacidad, permisos y datos guardados",
     fr: "Confidentialité, autorisations et données stockées", it: "Privacy, autorizzazioni e dati salvati",
     ja: "プライバシー、権限、保存データ", pt: "Privacidade, permissões e dados armazenados",
     ru: "Конфиденциальность, разрешения и сохранённые данные", "zh-CN": "隐私、权限与存储的数据",
     "zh-TW": "隱私權、權限與儲存的資料",
   };
   for (const lang of fs.readdirSync("src/locales")) {
     const file = path.join("src/locales", lang, "translation.json");
     if (!fs.existsSync(file)) continue;
     if (!(lang in PRIVACY)) throw new Error(`no privacy description for ${lang}`);
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     for (const key of DEAD) {
       const parts = key.split(".");
       const parent = parts.slice(0, -1).reduce((node, part) => node?.[part], json);
       // Plural variants (key_one, key_other, ...) of a leaf go with it.
       for (const name of Object.keys(parent ?? {})) {
         if (name === parts.at(-1) || name.startsWith(parts.at(-1) + "_")) delete parent[name];
       }
     }
     json.settingsModal.sections.privacyData.description = PRIVACY[lang];
     fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
   }
   EOF
   ```

   The `startsWith(leaf + "_")` sweep only touches siblings that start with a deleted leaf's exact name plus `_`. Before committing, check `git diff --stat src/locales` and skim one locale's diff to confirm only the listed families changed.

3. In `test/locales/translationCoverage.test.js`, remove these fixture entries, because the keys they name no longer exist:
   - from `ARABIC_PLURAL_BASES` (lines 19–23): `settingsPage.workspace.members.description`, `settingsPage.workspace.teams.memberCount`, `settingsPage.workspace.teams.grantsAccessToSpaces`, `settingsPage.workspace.teams.deleteConfirmSpaceAccess` and `settingsPage.workspace.invites.expiresIn`;
   - from `ARABIC_NUMBER_NEUTRAL_TEMPLATES` (line 49): `"settingsPage.account.planDescriptions.trial": …`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- 'test/locales/*.test.js'` and `npm run i18n:check`. `scripts/run-tests.js` takes files or quoted globs; a bare directory fails with `EISDIR`.
Expected: PASS, and `i18n:check` reports no missing keys or placeholder mismatches.

- [ ] **Step 5: Commit**

```bash
git add src/locales test/locales/translationCoverage.test.js test/locales/deadLocaleKeys.test.js
git commit -m "chore(i18n): honest privacy description; delete dead account, billing and hosted-cloud keys"
```

---

### Task 21: Whole-plan verification

**Files:** none new. This task runs every check and fixes what they surface.

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
```

Expected: everything passes.
- **Allowed test edits.** Edit a pre-existing test only when its assertion pins exactly the behaviour this plan changes on purpose:
  - 3/4/5 s error timers;
  - "disabled never checks" and "the off switch also blocks manual checks" (`updateManager.test.js`);
  - Plan 01 token values this plan changes on purpose (light `--color-ring`, light success and warning foregrounds);
  - a card root `onClick`;
  - a `useChatMessageSender` test that expected a rejection (the sender now resolves `false` before persistence and `true` after);
  - the `installTree` location;
  - deleted locale fixtures.
- Name every such edit in the PR description.
- Any other failure is a regression; fix the code.

- [ ] **Step 2: Verify in the desktop app, in light and Plum Night**

```bash
npm run native:electron
npm run dev
```

Check each of these, and screenshot the starred ones for the PR:
- ★ **Focus and fields (Tasks 1–3).**
  - Tab through Settings and the workspace sidebar: every focused control shows a solid orange ring, `#e84e16` in light and `#ff5a1f` in Plum Night, never a faint one.
  - Every text field has a clearly visible edge in both themes.
  - Computed-style check (I3). In DevTools, focus with the keyboard each of: an `Input` (Settings → a custom endpoint URL), a `Textarea` (Dictionary or Snippets), and a raw native field.
    - Each must show `box-shadow: rgb(…) 0px 0px 0px 1px, rgb(232, 78, 22) 0px 0px 0px 3px` in light, and the same with `rgb(255, 90, 31)` in Plum Night.
    - Each must show `border-color` equal to the ring.
    - Record a screenshot of the Computed panel.
  - Warning and success badges and buttons in light show dark text.
- ★ **Onboarding, macOS at 900×640.**
  - The footer stays pinned while the middle scrolls.
  - The brand tile clears the traffic lights.
  - In Arabic, the clearance is still on the left.
- ★ **Onboarding → Speech → Download.**
  - The bar shows a real percentage.
  - Cancel returns to "Download the selected model".
  - Download again, Continue, and the footer chip shows the percentage on Cleanup.
- **Dictation errors.**
  - Force a paste failure that offers "View transcript": the card stays until acted on.
  - A plain network error disappears after 6–10 s.
- ★ **Esc during a slow transcription** (a remote provider with throttled network) cancels it. After it finishes, Esc works normally in other apps.
- ★ **Meeting recording with the window hidden.** Stop system audio (switch output device). A native notification appears once, and clicking it focuses Loqui.
- **VoiceOver, macOS.**
  - A success toast is announced politely, and an error toast is announced immediately.
  - In Settings, the sidebar announces "current page".
  - The provider tabs announce "tab, selected, 1 of N".
  - Model cards announce "radio button, checked".
- ★ **Chat.**
  - Send a message, then type and press Enter while it streams. "Sends when the reply finishes" appears, and the draft sends once the reply ends.
  - Queue a draft, then switch to another conversation, or open New Chat, before the reply ends. Nothing is sent; the words stay with the "Not sent" notice.
  - Press Stop with a queued draft: the draft stays in the box, unsent.
  - With the network off, send from a brand-new chat (conversation creation fails). The words come back into the box.
- **Coming up.** With a meeting starting within a minute, "Now" appears within 30 s of the start, without reloading.
- **Notes.** On a fresh profile, notes render immediately. "Actions" opens the first-run dialog once, then the manager, even with no note open.
- ★ **Settings.**
  - Privacy → Clear All Audio shows the count and size and asks first.
  - Make the audio folder unreadable (`chmod 000` on `<userData>/audio`). The row reads "couldn't read" with Retry, not "No audio files stored". Restore the permissions afterwards.
  - System → updates: with automatic off, Check for Updates works and shows "available" plus the GitHub link.
  - Custom endpoint: with an empty URL, there is no "We'll query" line.

- [ ] **Step 3: Confirm the spec is untouched**

Every CCR is applied in, or superseded by, the consolidated spec (091d198); see "Contract change requests". This PR must not edit the spec, so this command must print nothing:

```bash
git diff --stat origin/snowopsdev/feat/uiux-foundations...HEAD -- docs/superpowers/specs
```

- [ ] **Step 4: Commit any fixes, then prepare the PR (owner approval first)**

`pr-body.md`:
- lists one line per Tasks 1–20 commit;
- links the CCR dispositions in the plan;
- links the spec and this plan;
- carries the Contract change requests section verbatim;
- embeds the Step 2 screenshots;
- names every intentionally updated pre-existing test assertion (Step 1).

Get the owner's explicit OK before `git push` or `gh pr create`; publishing is outward-facing.

```bash
git push -u origin HEAD
gh pr create --title "fix(ui): Plan 02 bug & a11y sweep" --body-file pr-body.md
```
