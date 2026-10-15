# Loqui UI/UX Plan 04 — Voice Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every voice moment legible, recoverable and honest about where data goes. This plan delivers:
- one notice system;
- words-first error recovery;
- undoable cancel;
- the Condensation pill with locality;
- the Agent violet orbit;
- the soft sound family;
- the notch-drop meeting prompt;
- the meeting recorder as a pill state.

**Architecture:**
- **Pure modules hold the logic.** `notices.ts` is the notice store. `cancelHold.js` is the RAM undo buffer. `remoteDispatch.js` answers "who already received it". `voicePillPresentation.js` gains the stage and footprint model. `condensation.ts` handles word commits and the cleanup diff. `meetingPresence.js` holds the main-process meeting state and the tray/notification decisions.
- **React renders the result.** `VoicePill`, `NoticeStack`, `WordsFirstCard`, `CondensationWords` and `AgentOrbit` draw what the pure modules decide.
- **Audio stays in main or AudioManager.** `AudioManager` keeps owning audio, so the undo buffer lives there. Electron main owns the overlay windows, the tray, global shortcuts and native notifications, and is touched only for those.

**Tech Stack:** React 19, Tailwind CSS 4, TypeScript and JS (ESM), Zustand settings store, Electron 44 main process, Web Audio. Tests run on Node `node:test` with `tsx`, `react-dom/server` (`test/helpers/harness/reactSsr.js`), and the Vite SSR renderer harness (`test/lib/rendererTestHarness.js`, `test/helpers/harness/audioManager.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`. It covers D1, D2, D3, D4, D9 and D10, the Plan 04 row in §3, §4, and contracts §5.1–§5.4.
- Visual reference: `design-explorations/loqui-uiux-review.html#ch-voice`. Source: `design-explorations/loqui-uiux-review/parts/03-voice.html` (sibling worktree `t3-5038e8e6`). The picked variant cards are R1 C (lines 207–217), R6 B (412–422), R8 B (502–512), R10 A (859–868), R11 B (667–677), R12 A (708–718) and R14 B (810–820).
- Audit: `.omc/research/ui-review/audit-voice.md` in the same sibling worktree.

---

## Contract change requests

Plan 04 owns §5.2 and §5.3. Every change below is **additive**: no consumer written against the spec text breaks. The spec says the owning plan updates §5 in the same PR, but this planning thread must not edit the spec. So Task 19 applies these edits to the spec **only after the owner approves them**. Until then, consumers keep coding against the spec text, which stays valid.

1. **CCR-1, §5.2 `cancelled` gains `remotePayload` and a no-undo sentinel.**
   - New shape: `{ undoUntil: number; remoteAlreadySent: string | null; remotePayload: "audio" | "text" | null }`.
   - Why `remotePayload`: when speech is local but cleanup is remote, the honest copy is "Anthropic already received the text", not "the audio".
   - Why the sentinel: `undoUntil === 0` means "nothing to restore". A streaming dictation keeps no local buffer once cancelled (see Open question 1), so the pill shows "Cancelled · {provider} already received the audio." with no Undo.
   - **Encoding of `remoteAlreadySent`.** It is a **target id**, not display text, so it can be localised:
     - a provider id such as `"openai"`;
     - or `"host:<host>"` for a self-hosted server on the network.

     Render it with `dispatchTargetLabel(target, t)` from `src/helpers/remoteDispatch.js`. That uses `providerDisplayLabel` for providers (Plan 01 review item 1).
   - Plan 07 reads `remoteAlreadySent` and renders it with the same helper.
2. **CCR-2, §5.2 `meetingRecording` gains `interruption` and `quiet`.**
   - New shape: `{ startedAt: number; interruption: "systemAudio" | "mic" | null; quiet: boolean }`.
   - These drive the R12 A "system lost" (amber, wider) and "quiet" (pale dot) capsule states.
   - Meeting capture runs in the control-panel renderer, so `useAudioRecording` sources this value from a main-process relay (Task 14), not from `AudioManager`.
3. **CCR-3, §5.2 adds two read-only fields to the `useAudioRecording` return.**
   - `processingStage: "transcribing" | "cleaning" | null` drives "Transcribing…" / "Cleaning up".
   - `outcome: { kind: "pasted"; words: number; at: number } | { kind: "failed"; at: number } | null` drives the 700 ms success beat and the failure nudge.
   - Onboarding (05) can use both in its trial.
4. **CCR-4, §5.3 `notify()` additions.**
   - `notify()` returns the notice `id: string`.
   - New optional fields: `id` (dedupe or replace), `words` (recovered transcript; renders the words-first card and never auto-dismisses), `details` (the existing `TechnicalErrorDetailsData`), and `onDismiss`.
   - Actions are `{ label: string; onClick: () => void | Promise<void>; primary?: boolean; keepOpen?: boolean }`.
   - New exports: `dismissNotice(id)`, `useNotices()`.
   - Default lifetimes: receipt 3.5 s, notice 10 s, alert 10 s. A notice or alert never auto-dismisses when `persistent` is set or when it carries `words`. This preserves Plan 02's VO-Q6 rule.

5. **CCR-5, to Plan 03 (owner of §5.1): add `providerId: string | null` to `ResolvedRoute`.** Plan 01's review requires `providerDisplayLabel(providerId, t)` for every provider name in the pill. Today `ResolvedRoute.provider` is already a display string, built without `t`, so the unknown and custom fallbacks cannot be localised.
   - This is additive.
   - Until it lands, `routeProviderLabel` (Task 9) falls back to `route.provider`.

## Open questions for the owner

Each question has a default that the plan implements. A different answer changes only the task named.

1. **Undo for streaming dictation (Task 6).** A streaming provider has already received the audio, and the code keeps no local copy after a cancel (`cancelStreamingRecording` clears the fallback chunks). The default is no Undo: the pill says "Cancelled", with the caption "OpenAI already received the audio." The alternative keeps the fallback recorder's chunks in RAM and re-transcribes through the **same** provider's batch endpoint. That fails for streaming-only providers.
2. **The Condensation word row and "Show transcription preview" (Task 10).** The default shows live words above the pill whenever streaming partials exist, even with the preview setting off, because that is the picked design. Words on screen matter during screen sharing. Should the row honour that setting (off by default), or get its own?
3. **R11 B mini pill width (Task 16).** The card's tradeoff text says 168 px, but the mock CSS uses 224 px. "Meeting? Start notes ⌥⌘M" does not fit in 168 px at 12.5 px, so the plan uses 224 px.
4. **Global shortcuts beyond ⌥Z.** The plan adds ⌥↵ "Paste again" while a words card is up (Task 2), and ⌥⌘M (Ctrl+Alt+M) "Start notes" while a meeting prompt is up (Task 16). Each is held only while its surface shows; the pill and prompt windows cannot take focus. Are those combinations acceptable?
5. **Linux fallbacks and the on-screen setting (Tasks 14 and 15).** The default shows the tray dot and the persistent notification on Linux whenever a meeting records. "Show meeting recorder on screen" governs only the pill. Should the setting also suppress the Linux notification?
6. **What "Retry cleanup" does (Task 3).** After a raw paste the pasted text cannot be rewritten in another app, so Retry copies the cleaned text to the clipboard and says so. History keeps the raw text. Is that the expected behaviour?
7. **Words-card primary colour (Task 2).** The R6 B mock paints "Paste again" orange. D1 reserves orange for voice controls, so the plan uses the ink button. Confirm.
8. **When discarded audio is saved.** With "Save discarded" on, the audio is now saved when the undo window ends, not at the moment of cancel. An unload flush covers a normal quit, but a crash inside the 5–10 s window loses that one recording. Acceptable?

## Plan 01 review hand-offs (shipped at `172f9df` on `snowopsdev/feat/uiux-foundations`)

Plan 01's final review sent four items to this plan. Each is folded into the task named below.

1. **Provider names.** Every provider name in the pill or in a notice comes from `providerDisplayLabel(providerId, t)` (`src/lib/locality.ts`), which localises the "Custom endpoint" and "Unknown provider" fallbacks. `providerDisplayName` is for logs only.
   - Task 5 records provider **ids**, not display names. Its new helper `dispatchTargetLabel(target, t)` renders them.
   - Tasks 9 and 11 render route providers through `routeProviderLabel(route, t)`, which prefers `providerDisplayLabel(route.providerId, t)` (see CCR-5).
2. **Two leftover motion and colour rules.** These are `.assistant-response-content-updating` (`dictation-panel.css` ≈569–570, an exit: the old answer recedes) and `.thinking-shimmer-text` (`index.css` ≈1752, cool hues 260/240/250). Task 12 moves the first onto `--motion-ease-exit` and the second onto foreground/muted tokens, which are neutral in light and plum in Plum Night.
3. **Meeting card Start button.** Decision: it starts a recording, so it **is** a live-voice control under D1 and keeps the orange `Button variant="live"`. The `bg-primary/10` tile behind the Loqui mark doubles the orange bubble, so it is removed. Recorded in Task 16 and in DESIGN.md.
4. **`LevelBars` internals.** `LevelBars` now holds `readLevel` in a ref, so callers pass inline closures with no `useCallback`. `nextLevelBarsFrame` and `LEVEL_BARS_SILENCE_FLOOR` are exported, and reduced motion uses a flat phase.
   - Tasks 9 and 17 pass inline closures.
   - Task 11's radial ticks reuse `nextLevelBarsFrame` (for the decaying peak and the silence floor) and the flat reduced-motion phase, instead of a second meter maths.

## Before you start (dependency check)

Plan 04 executes after Plans 01 and 03 have merged (spec §3). It also assumes Plan 02 has merged, because Plan 02 changes the same toast, Esc and meeting-interruption code. Verify before Task 1:

```bash
grep -n "export function providerDisplayLabel" src/lib/locality.ts
grep -n "export function nextLevelBarsFrame\|export const LEVEL_BARS_SILENCE_FLOOR" src/components/ui/levelBarsMath.ts
ls src/lib/locality.ts src/lib/routes.ts src/components/ui/LevelBars.tsx src/components/ui/LocalityRing.tsx src/utils/contrast.ts test/helpers/harness/cssTokens.js
grep -n -- "--motion-ease-exit\|--color-live:" src/index.css | head
grep -n 'variant.*live' src/components/ui/button.tsx | head -3
grep -n "export function useResolvedRoute" src/lib/routes.ts
```

Expected: every file exists, the tokens and `live` variant are present, and `useResolvedRoute` is exported.
- If `routes.ts` is missing, Plan 03 has not merged. Stop and report.
- If Plan 07's `window.electronAPI.privacy` is absent, nothing in this plan breaks. The pill simply never sees `detail: "sealed"`.

Plan 02 overlap. Plan 02 owns VO-Q6, VO-Q8, VO-Q9 and VO-Q16. This plan **deletes** `Toast.tsx`, `toastPresentation.js` and `DictationErrorCard.tsx` (Task 4), so it carries their rules forward instead:
- Q6: words alerts never auto-dismiss.
- Q9: `role="status"`/`role="alert"`, and close is always visible.
- Q8: Esc is armed until idle. Task 7 pins it with a test and implements it if Plan 02 did not.

Plan 02's VO-Q16 native interruption notifications stay as Plan 02 built them. Task 14 reuses its `Notification` helper if one exists (`grep -rn "new Notification(" src/helpers main.js`).

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md). Every new IPC method gets a `preload.js` entry and a `src/types/electron.ts` type, plus a `src/preview/browserPreview.ts` stub when the renderer calls it unguarded.
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Undo re-runs the **same** route the cancelled dictation used, and never a different one. Content is preserved on every failure.
- Cancel is instant, with no confirmation dialog.
  - The undo window is 5 s, or 10 s when the recording is over 30 s. Hover pauses it, and ⌥Z or a click restores.
  - Audio is held in RAM only and zeroed when the window expires. It is never persisted unless the retention settings already save discarded audio (`shouldSaveDiscardedRecording`).
  - Esc stays armed until the pipeline is idle.
  - If a remote request was already sent, the copy says so: "Cancelled · OpenAI already received the audio." (D3)
- The meeting recorder is a state of the existing pill window, never a second always-on-top window (D2). Linux adds a tray recording state and a persistent notification with Stop. The setting "Show meeting recorder on screen" defaults to on.
- Condensation words render on their own layer above the bars. The bars are never clipped by words (D9). Agent Mode ships without the frame glyph (D9, VO-R8 owner note).
- Orange (`variant="live"`, `--color-live`) is only for record, stop, mic, send-by-voice, the pill and meters (D1). Notice and card primaries use the default ink `Button`.
- The pill window stays 208×120 (`PILL_WINDOW_SIZE`) for every pill-only state. No pill footprint may exceed 184 px wide, which is the window minus the 12 px dock insets. Recording edges never call `setBounds`.
- Provider names shown in the pill or in notices come from `providerDisplayLabel(providerId, t)` (`src/lib/locality.ts`). `providerDisplayName` is for logs only.
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night. Never put white text on `#FF5A1F`.
- Motion uses the Plan 01 tokens only (`--motion-*`, springs as `linear()`). Every loop is gated to its active state. Reduced motion keeps opacity and colour and drops transforms. No `cubic-bezier(0.4, 0, 1, 1)`.
- Every visible string goes through i18n, with keys in all 12 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`). `npm run i18n:check` passes. Non-English locales get an English placeholder that the existing translation workflow fills. Do not leave keys missing.
- Use logical properties (`ms-`/`me-`, `start`/`end`, `inset-inline-*`) for RTL.
- Tests: `npm run native:node` once, then `npm test -- <files>`. Run `npm run native:electron` before launching the app. Never use personal profiles in tests.
- Before the PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`, `npm run format:check`.
- DESIGN.md is the source of truth (D10). Each task that changes a documented surface updates DESIGN.md in the same commit.

## Review Focus

1. **Cancel after a batch upload has started.** Cancel lands while `transcribeAudioFileByok` is in flight. A person expects "Cancelled · OpenAI already received the audio." with Undo still offered, and Undo re-sending to the same provider. Cancelling **before** the upload must say nothing about a provider. Pinned in Task 5 (`remoteDispatch.test.js`, "batch dispatch is marked only once the upload is invoked") and Task 6 (`audioManagerCancelHold.test.js`, "cancel during an in-flight upload holds the blob and names the provider").
2. **Save-discarded with Undo, or a quit inside the window.** With "Save discarded" on, the cancelled audio is saved exactly once when the window expires, and never when Undo restores it. If the app quits inside the window, it is flushed once. With retention off, nothing is ever written. Pinned in Task 6 ("expiry persists once when retention allows", "undo never persists a discarded copy", "flush on unload persists once").
3. **⌥Z leaking after the window.** The ⌥Z slot must be unregistered when the window expires, when Undo runs, and when a new recording starts. Otherwise Loqui steals ⌥Z (Ω) from every app. Pinned in Task 7 (`useAudioRecordingCancelUndo.test.js`, "undo hotkey is released at expiry, on undo and on a new start").
4. **Long translations in fixed pill footprints.** German and Russian stage labels ("Wird bereinigt", "Вставлено · 19 слов") must truncate with an ellipsis inside the footprint, never widen the pill past 184 px or wrap. Pinned in Task 9 (`voicePillStructure.test.js`, "stage labels truncate inside the footprint").
5. **The control panel reloads mid-meeting.** A crash, reload or close of the control panel leaves the presence relay stale. The pill must not show a recording timer forever. Main clears presence when the owning webContents is destroyed or navigates. Pinned in Task 14 (`meetingPresence.test.js`, "presence clears when the owner goes away").

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/components/ui/notices.ts` (new) | Notice store and `notify()` API (§5.3) | 1 |
| `src/components/ui/NoticeStack.tsx`, `NoticeChip.tsx`, `WordsFirstCard.tsx` (new), `src/styles/notices.css` (new) | R14 B chips, R6 B card | 2 |
| `src/hooks/usePillHotkey.ts` (new) + IPC `register-pill-hotkey` | Global ⌥Z / ⌥↵ while the pill shows undo or a words card | 2 |
| `src/components/*NoticeListener.tsx` (renamed from `*ToastListener`) | Cleanup (VO-Q7), Tinfoil (VO-Q21), GPU pack, background actions | 3 |
| `src/helpers/retryDictationCleanup.js` (new) | "Retry cleanup" action | 3 |
| Toast removal (`Toast.tsx`, `useToast.ts`, `toastPresentation.js`, `DictationErrorCard.tsx`) | Migration finish | 4 |
| `src/helpers/remoteDispatch.js` (new) + `audioManager.js` | Who already received the audio or text; processing stage | 5 |
| `src/helpers/cancelHold.js` (new) + `audioManager.js` | RAM undo buffer (D3) | 6 |
| `src/hooks/useAudioRecording.js` | §5.2 lifecycle: `cancelled`, `undoCancel`, `processingStage`, `outcome`, `meetingRecording` | 7 |
| `src/helpers/voicePillPresentation.js` | Stage model, footprints, VO-Q5, VO-Q12, VO-Q18 | 8 |
| `src/components/dictation/VoicePill.tsx`, `PillStageLabel.tsx` (new), `usePillLocality.ts` (new) | LevelBars, LocalityRing, stage labels, cancelled capsule | 9 |
| `src/components/dictation/condensation.ts`, `CondensationWords.tsx` (new) | R1 C words layer (D9) | 10 |
| `src/components/dictation/AgentOrbit.tsx` (new) | R8 B violet orbit | 11 |
| `PillTooltip.tsx`, `dictation-panel.css` | VO-Q14, VO-Q19, VO-Q20 | 12 |
| `src/utils/dictationCues.js`, settings | R10 A soft family | 13 |
| `src/helpers/meetingPresence.js` (new), `tray.js`, `linuxRecordingNotification.js` (new), IPC | D2 relay, tray, Linux notification | 14 |
| `src/components/dictation/MeetingCapsule.tsx` (new), settings | R12 A capsule as a pill state | 15 |
| `MeetingNotificationOverlay.tsx`, `MeetingNotificationCard.tsx`, `windowManager.js`, `windowConfig.js` | R11 B notch drop, VO-Q10, ⌥⌘M | 16 |
| `NoteRecordControl.tsx`, `MeetingRecordingPill.tsx`, `MeetingRecordingMount.tsx`, `ChatInput.tsx`, `MeetingTranscriptChat.tsx` | LevelBars everywhere, VO-Q11, VO-Q13, VO-Q15 | 17 |
| `docs/PRIVACY.md` | D3 undo sentence | 6 |
| Whole plan | Verification | 18, 19 |

---
### Task 1: Notice store and the `notify()` API

Covers §5.3 (the logic half) and VO-R14 B (lifetimes, cap, stagger).

**Files:**
- Create: `src/components/ui/notices.ts`
- Modify: `src/components/ui/TechnicalErrorDetails.tsx`. Move the `TechnicalErrorDetailsData` interface here from `src/components/ui/useToast.ts:5`.
- Modify: `src/components/ui/useToast.ts:5`. Replace the interface with `export type { TechnicalErrorDetailsData } from "./TechnicalErrorDetails";` until Task 4 deletes the file.
- Test: `test/components/notices.test.js`

**Interfaces:**
- Produces (every later task and Plans 03, 05 and 06 import these):

  ```ts
  export type NoticeKind = "receipt" | "notice" | "alert";
  export interface NoticeAction { label: string; onClick: () => void | Promise<void>; primary?: boolean; keepOpen?: boolean }
  export interface NoticeInput {
    kind: NoticeKind; title: string; body?: string; actions?: NoticeAction[]; persistent?: boolean;
    id?: string; words?: string; details?: TechnicalErrorDetailsData; onDismiss?: () => void;
  }
  export interface Notice extends NoticeInput { id: string; createdAt: number; expiresAt: number | null; remainingMs: number | null }
  export const NOTICE_DURATION_MS: { receipt: 3500; notice: 10000; alert: 10000 };
  export const NOTICE_MAX_VISIBLE = 3;
  export const NOTICE_STAGGER_MS = 40;
  export function noticeLifetimeMs(input: Pick<NoticeInput, "kind" | "persistent" | "words">): number | null;
  export function notify(input: NoticeInput): string;
  export function dismissNotice(id: string): void;
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

test("receipts expire after 3.5s; notices and alerts after 10s", async (t) => {
  const { m, clock } = await fresh(t);
  m.notify({ kind: "receipt", title: "Pasted" });
  m.notify({ kind: "notice", title: "Pasted without cleanup" });
  clock.advance(3_499);
  assert.equal(m.getNotices().length, 2);
  clock.advance(1);
  assert.deepEqual(m.getNotices().map((n) => n.title), ["Pasted without cleanup"]);
  clock.advance(6_500);
  assert.equal(m.getNotices().length, 0);
});

test("persistent notices and alerts that carry words never schedule a timer", async (t) => {
  const { m, clock } = await fresh(t);
  m.notify({ kind: "notice", title: "Model changed", persistent: true });
  m.notify({ kind: "alert", title: "Couldn't paste", words: "hello there" });
  assert.equal(clock.pending(), 0);
  clock.advance(60_000);
  assert.equal(m.getNotices().length, 2);
  assert.equal(m.noticeLifetimeMs({ kind: "alert", words: "" }), 10_000);
});

test("the same id replaces the earlier notice instead of stacking", async (t) => {
  const { m } = await fresh(t);
  const first = m.notify({ id: "cleanup-failed", kind: "notice", title: "A" });
  const second = m.notify({ id: "cleanup-failed", kind: "notice", title: "B" });
  assert.equal(first, "cleanup-failed");
  assert.equal(second, "cleanup-failed");
  assert.deepEqual(m.getNotices().map((n) => n.title), ["B"]);
});

test("a fourth notice drops the oldest expiring one; persistent ones survive", async (t) => {
  const { m } = await fresh(t);
  m.notify({ kind: "notice", title: "keep", persistent: true });
  m.notify({ kind: "receipt", title: "old" });
  m.notify({ kind: "receipt", title: "mid" });
  m.notify({ kind: "receipt", title: "new" });
  assert.deepEqual(m.getNotices().map((n) => n.title), ["keep", "mid", "new"]);
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

test("running an action dismisses once and fires onDismiss once, unless keepOpen", async (t) => {
  const { m } = await fresh(t);
  let dismissed = 0;
  let ran = 0;
  const id = m.notify({ kind: "notice", title: "x", onDismiss: () => dismissed++ });
  await m.runNoticeAction(id, { label: "Go", onClick: () => { ran++; } });
  await m.runNoticeAction(id, { label: "Go", onClick: () => { ran++; } });
  assert.equal(ran, 2);
  assert.equal(dismissed, 1);
  const kept = m.notify({ kind: "alert", title: "y" });
  await m.runNoticeAction(kept, { label: "Retry", keepOpen: true, onClick: () => {} });
  assert.equal(m.getNotices().length, 1);
});

test("a failing action still dismisses the notice and rethrows", async (t) => {
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

1. In `src/components/ui/TechnicalErrorDetails.tsx`, add the interface that `useToast.ts:5-10` defines today. Copy its body verbatim and export it. Then remove the local `import type { TechnicalErrorDetailsData } …` line from that file.
2. In `src/components/ui/useToast.ts`, replace the interface with `export type { TechnicalErrorDetailsData } from "./TechnicalErrorDetails";`.
3. Create `src/components/ui/notices.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { TechnicalErrorDetailsData } from "./TechnicalErrorDetails";

// One notice system with three tiers (DESIGN.md "Notices"):
// - receipt: something happened as asked; it times out.
// - notice: something changed or degraded; it waits when `persistent`.
// - alert: words or work are at risk; role="alert", and it never times out
//   while it carries recovered words.
// A plain module store (not React context) so non-React code such as
// AudioManager callbacks and listeners can call notify() directly.

export type NoticeKind = "receipt" | "notice" | "alert";

export interface NoticeAction {
  label: string;
  onClick: () => void | Promise<void>;
  /** The chip shows the first primary action inline; the card shows it first. */
  primary?: boolean;
  /** Keep the notice up after the action runs (e.g. "Paste again" that may fail). */
  keepOpen?: boolean;
}

export interface NoticeInput {
  kind: NoticeKind;
  title: string;
  body?: string;
  actions?: NoticeAction[];
  persistent?: boolean;
  /** Stable id: a later notify() with the same id replaces this notice. */
  id?: string;
  /** Recovered transcript. Renders the words-first card and never auto-dismisses. */
  words?: string;
  details?: TechnicalErrorDetailsData;
  onDismiss?: () => void;
}

export interface Notice extends NoticeInput {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  /** Set while hover-paused; the countdown resumes from here. */
  remainingMs: number | null;
}

export interface NoticeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const NOTICE_DURATION_MS = { receipt: 3500, notice: 10000, alert: 10000 } as const;
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
    clock.setTimeout(() => dismissNotice(id), ms)
  );
}

export function noticeLifetimeMs(
  input: Pick<NoticeInput, "kind" | "persistent" | "words">
): number | null {
  if (input.persistent) return null;
  if (input.kind === "alert" && input.words) return null;
  return NOTICE_DURATION_MS[input.kind];
}

export function notify(input: NoticeInput): string {
  const id = input.id ?? `notice-${++seq}`;
  const lifetime = noticeLifetimeMs(input);
  const now = clock.now();
  const notice: Notice = {
    ...input,
    id,
    createdAt: now,
    expiresAt: lifetime === null ? null : now + lifetime,
    remainingMs: null,
  };
  let next = [...notices.filter((n) => n.id !== id), notice];
  // Over the cap, the oldest notice that may expire leaves first. Persistent
  // notices queue (visibleNotices shows the newest three).
  while (next.length > NOTICE_MAX_VISIBLE) {
    const victim = next.find((n) => n.expiresAt !== null && n.id !== id);
    if (!victim) break;
    clearTimer(victim.id);
    next = next.filter((n) => n !== victim);
  }
  if (lifetime === null) clearTimer(id);
  else schedule(id, lifetime);
  emit(next);
  return id;
}

export function dismissNotice(id: string): void {
  const target = notices.find((n) => n.id === id);
  if (!target) return;
  clearTimer(id);
  emit(notices.filter((n) => n.id !== id));
  target.onDismiss?.();
}

function replace(id: string, patch: Partial<Notice>): void {
  emit(notices.map((n) => (n.id === id ? { ...n, ...patch } : n)));
}

export function pauseNotice(id: string): void {
  const n = notices.find((x) => x.id === id);
  if (!n || n.expiresAt === null || n.remainingMs !== null) return;
  clearTimer(id);
  replace(id, { remainingMs: Math.max(0, n.expiresAt - clock.now()) });
}

export function resumeNotice(id: string): void {
  const n = notices.find((x) => x.id === id);
  if (!n || n.remainingMs === null) return;
  const ms = n.remainingMs;
  replace(id, { remainingMs: null, expiresAt: clock.now() + ms });
  schedule(id, ms);
}

export async function runNoticeAction(id: string, action: NoticeAction): Promise<void> {
  try {
    await action.onClick();
  } finally {
    if (!action.keepOpen) dismissNotice(id);
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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/components/notices.test.js test/components/rtlMotion.test.js`
Expected: PASS. `rtlMotion` still imports `Toast` and must stay green until Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/notices.ts src/components/ui/TechnicalErrorDetails.tsx src/components/ui/useToast.ts test/components/notices.test.js
git commit -m "feat(voice): notice store with receipt, notice and alert tiers"
```

---

### Task 2: Notice chips, the words-first card and pill hotkeys

Covers VO-R14 B and VO-R6 B (the card), and carries Plan 02's VO-Q9 rules forward.

**Files:**
- Create: `src/components/ui/NoticeChip.tsx`
- Create: `src/components/ui/WordsFirstCard.tsx`
- Create: `src/components/ui/NoticeStack.tsx`
- Create: `src/styles/notices.css`. Add `@import "./styles/notices.css";` to `src/index.css`, directly after `@import "./styles/dictation-panel.css";` at line 3.
- Create: `src/hooks/usePillHotkey.ts`
- Modify: `src/helpers/ipcHandlers.js`. Add `register-pill-hotkey` and `unregister-pill-hotkey` next to `register-cancel-hotkey` (lines 3510–3521).
- Modify: `preload.js`. Add entries next to `registerCancelHotkey` (lines 541–543).
- Modify: `src/types/electron.ts` (types next to `registerCancelHotkey`).
- Modify: `src/preview/browserPreview.ts` (no-op stubs).
- Modify: `src/utils/windowSizeLadder.js`
- Modify: `src/helpers/windowConfig.js:139-157` (add `WITH_NOTICES`)
- Modify: `src/hooks/useMainWindowSizeOwner.js`. Rename the inputs `toastCount` and `dictationErrorActionCount` to `noticeCount` and `wordsCardVisible`.
- Modify: `src/App.jsx`. Mount the pill stack and feed the ladder.
- Modify: `src/AppRouter.jsx:64-78`. Mount the panel stack in the control-panel branch, so it covers both onboarding and the main view.
- Modify: `src/locales/*/translation.json`. Add a top-level `"notices"` object.
- Modify: `DESIGN.md`. Add a `### Notices` section after `### Voice Pill`.
- Test: `test/components/noticeStack.test.js`
- Test: `test/helpers/windowSizeLadder.test.js` (create it if absent; update it if present)

**Interfaces:**
- Consumes everything from Task 1.
- Produces:

  ```tsx
  export function NoticeStack(props: { placement: "pill" | "panel"; horizontalDirection?: "left" | "right" }): JSX.Element | null;
  export function NoticeChip(props: { notice: Notice; stagger: number }): JSX.Element;
  export function WordsFirstCard(props: { notice: Notice; onHeight?: (px: number) => void }): JSX.Element;
  export function useNoticeWindowState(): { noticeCount: number; wordsCardVisible: boolean };
  ```

  ```ts
  // src/hooks/usePillHotkey.ts
  export type PillHotkeySlot = "undoCancel" | "noticePrimary";
  export const PILL_HOTKEY_ACCELERATORS: Record<PillHotkeySlot, string>; // { undoCancel: "Alt+Z", noticePrimary: "Alt+Enter" }
  export function usePillHotkey(slot: PillHotkeySlot, enabled: boolean, onPress: () => void): void;
  ```

  ```ts
  // electronAPI
  registerPillHotkey(slot: PillHotkeySlot, accelerator: string): Promise<boolean>;
  unregisterPillHotkey(slot: PillHotkeySlot): Promise<void>;
  onPillHotkeyPressed(cb: (slot: PillHotkeySlot) => void): () => void;
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

const base = { createdAt: 0, expiresAt: null, remainingMs: null };

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

test("pill hotkeys are wired through preload with a main-side slot", () => {
  const preload = fs.readFileSync(path.join(repoRoot, "preload.js"), "utf8");
  const ipc = fs.readFileSync(path.join(repoRoot, "src/helpers/ipcHandlers.js"), "utf8");
  assert.match(preload, /registerPillHotkey: \(slot, accelerator\) =>\s*ipcRenderer\.invoke\("register-pill-hotkey", slot, accelerator\)/);
  assert.match(preload, /onPillHotkeyPressed: registerListener\("pill-hotkey-pressed"/);
  assert.match(ipc, /registerSlot\(`pill:\$\{slot\}`/);
});
```

Create or extend `test/helpers/windowSizeLadder.test.js`:

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
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Info, X } from "../icons";
import { dismissNotice, pauseNotice, resumeNotice, runNoticeAction, type Notice } from "./notices";

const ICONS = { receipt: Check, notice: Info, alert: AlertTriangle } as const;

/** One 32px line per message (VO-R14 B): icon, title, muted body, one inline action, close. */
export function NoticeChip({ notice, stagger }: { notice: Notice; stagger: number }) {
  const { t } = useTranslation();
  const Icon = ICONS[notice.kind];
  const primary = notice.actions?.find((a) => a.primary) ?? notice.actions?.[0];
  return (
    <div
      className="notice-chip"
      data-kind={notice.kind}
      role={notice.kind === "alert" ? "alert" : "status"}
      aria-live={notice.kind === "alert" ? "assertive" : "polite"}
      style={{ "--notice-stagger": stagger } as React.CSSProperties}
      onMouseEnter={() => pauseNotice(notice.id)}
      onMouseLeave={() => resumeNotice(notice.id)}
    >
      <span className="notice-chip__icon" aria-hidden="true">
        <Icon size={12} />
      </span>
      <b className="notice-chip__title">{notice.title}</b>
      {notice.body ? <span className="notice-chip__body">{notice.body}</span> : null}
      {primary ? (
        <button
          type="button"
          className="notice-chip__action"
          onClick={() => void runNoticeAction(notice.id, primary)}
        >
          {primary.label}
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
export function WordsFirstCard({ notice, onHeight }: { notice: Notice; onHeight?: (px: number) => void }) {
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
            onClick={() => void runNoticeAction(notice.id, action)}
          >
            {action.label}
            {action.primary ? <kbd className="words-card__kbd">⌥↵</kbd> : null}
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
}: {
  placement: "pill" | "panel";
  horizontalDirection?: "left" | "right";
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
      {card ? <WordsFirstCard notice={card} onHeight={reportHeight} /> : null}
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
/* Beside the 40px pill on its inner side: pill inset 12 + 40 + 10 gap. */
.notice-stack[data-placement="pill"] {
  bottom: 12px;
  inset-inline-start: 62px;
  inset-inline-end: 10px;
}
.notice-stack[data-placement="pill"][data-direction="left"] {
  inset-inline-start: 10px;
  inset-inline-end: 62px;
  align-items: flex-end;
}
.notice-stack[data-placement="panel"] {
  bottom: 20px;
  inset-inline-end: 20px;
  align-items: flex-end;
}

.notice-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  height: 32px;
  padding-inline: 6px 5px;
  border-radius: 999px;
  background: var(--color-popover);
  color: var(--color-popover-foreground);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-elevated);
  font: 500 12px/1 var(--font-family-sans);
  white-space: nowrap;
  animation: notice-in var(--motion-base) var(--motion-ease-enter) both;
  animation-delay: calc(var(--notice-stagger) * 40ms);
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
  box-shadow: var(--shadow-elevated);
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
  padding: 8px 24px 8px 9px;
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
  box-shadow: var(--shadow-elevated);
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

- [ ] **Step 4: Implement pill hotkeys (main, preload, types, hook)**

In `src/helpers/ipcHandlers.js`, directly after the `unregister-cancel-hotkey` handler (line 3521):

```js
    // Pill-scoped global hotkeys (⌥Z undo cancel, ⌥↵ notice primary). The pill
    // window is non-focusable, so a global slot is the only keyboard path; the
    // renderer registers only while the affordance is on screen.
    const PILL_HOTKEY_SLOTS = new Set(["undoCancel", "noticePrimary"]);
    ipcMain.handle("register-pill-hotkey", async (event, slot, accelerator) => {
      if (!PILL_HOTKEY_SLOTS.has(slot) || typeof accelerator !== "string") return false;
      const mainWindow = this.windowManager.mainWindow;
      if (!mainWindow || event.sender !== mainWindow.webContents) return false;
      const result = await this.windowManager.hotkeyManager.registerSlot(`pill:${slot}`, accelerator, () => {
        mainWindow.webContents.send("pill-hotkey-pressed", slot);
      });
      return result?.success !== false;
    });

    ipcMain.handle("unregister-pill-hotkey", async (_event, slot) => {
      if (!PILL_HOTKEY_SLOTS.has(slot)) return { success: false };
      this.windowManager.hotkeyManager.unregisterSlot(`pill:${slot}`);
      return { success: true };
    });
```

Check the return shape of `registerSlot` (`src/helpers/hotkeyManager.js:200`) and adapt the `success` check to it.

In `preload.js`, after `unregisterCancelHotkey` (line 543):

```js
  registerPillHotkey: (slot, accelerator) =>
    ipcRenderer.invoke("register-pill-hotkey", slot, accelerator),
  unregisterPillHotkey: (slot) => ipcRenderer.invoke("unregister-pill-hotkey", slot),
  onPillHotkeyPressed: registerListener("pill-hotkey-pressed", (callback) => (_event, slot) => callback(slot)),
```

In `src/types/electron.ts`, next to `registerCancelHotkey`:

```ts
      registerPillHotkey?: (slot: "undoCancel" | "noticePrimary", accelerator: string) => Promise<boolean>;
      unregisterPillHotkey?: (slot: "undoCancel" | "noticePrimary") => Promise<{ success: boolean }>;
      onPillHotkeyPressed?: (callback: (slot: "undoCancel" | "noticePrimary") => void) => () => void;
```

Create `src/hooks/usePillHotkey.ts`:

```ts
import { useEffect, useRef } from "react";

export type PillHotkeySlot = "undoCancel" | "noticePrimary";

export const PILL_HOTKEY_ACCELERATORS: Record<PillHotkeySlot, string> = {
  undoCancel: "Alt+Z",
  noticePrimary: "Alt+Enter",
};

/** Holds a global hotkey only while `enabled`; always releases it on disable or unmount. */
export function usePillHotkey(slot: PillHotkeySlot, enabled: boolean, onPress: () => void): void {
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  useEffect(() => {
    if (!enabled) return;
    const api = window.electronAPI;
    void api?.registerPillHotkey?.(slot, PILL_HOTKEY_ACCELERATORS[slot]);
    const off = api?.onPillHotkeyPressed?.((pressed) => {
      if (pressed === slot) onPressRef.current();
    });
    return () => {
      off?.();
      void api?.unregisterPillHotkey?.(slot);
    };
  }, [slot, enabled]);
}
```

In `src/preview/browserPreview.ts`, add `registerPillHotkey: async () => true`, `unregisterPillHotkey: async () => ({ success: true })` and `onPillHotkeyPressed: () => () => {}` to the stub object.

- [ ] **Step 5: Ladder, window size and mounting**

1. `src/helpers/windowConfig.js`: add `WITH_NOTICES: { width: 400, height: 168 },` after `WITH_MENU` in `WINDOW_SIZES` (line 154). Leave `WITH_TOAST` in place until Task 4.
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

Rename each hit in `useMainWindowSizeOwner.js`, `App.jsx` and `test/hooks/dictationErrorAutoHide.test.js`. Leave the `useToast()` destructuring in `App.jsx:64-65` alone; Task 4 removes it.

4. `src/App.jsx`:
   - Import `NoticeStack` and `useNoticeWindowState`.
   - Under the existing `useToast()` line, add `const { noticeCount, wordsCardVisible } = useNoticeWindowState();`.
   - In the props to `useMainWindowSizeOwner` (lines 312–325), pass `noticeCount: noticeCount + toastCount` and `wordsCardVisible: wordsCardVisible || dictationErrorActionCount > 0`. The `+ toastCount` and `|| dictationErrorActionCount` terms disappear in Task 4.
   - Use `noticeCount + toastCount > 0` everywhere `toastCount > 0` gates interactivity (line 329), auto-hide (line 411) and `useLinuxPillInteractivity` (line 621).
   - Render `<NoticeStack placement="pill" horizontalDirection={voiceHorizontalDirection} />` as the last child of `div.dictation-window` (line 626).
   - R6 B keeps the pill visible next to the card. Change `dictationErrorSuppressesPill` (around line 593) to `const dictationErrorSuppressesPill = false;`, then delete that constant and its use in `resolvePillVisualSuppression` (pass `dictationErrorSuppressed: false`). Remove the parameter from `resolvePillVisualSuppression` in `voicePillPresentation.js:388` only if no other caller passes it (`grep -rn dictationErrorSuppressed src test`).
   - Add `usePillHotkey("noticePrimary", wordsCardVisible, () => { const card = getNotices().find((n) => n.kind === "alert" && n.words); const primary = card?.actions?.find((a) => a.primary); if (card && primary) void runNoticeAction(card.id, primary); });`.
5. `src/AppRouter.jsx`: in the `isControlPanel` branch (lines 64–78), wrap the existing ternary in a fragment and render `<NoticeStack placement="panel" />` after it. The panel stack then shows in onboarding (Plan 05's trial raises notices there) as well as in `ControlPanel`.

- [ ] **Step 6: Locale strings and DESIGN.md**

Add this to `src/locales/en/translation.json` as a top-level `"notices"` object. Add the same English text to the other 11 locales.

```json
"notices": {
  "dismiss": "Dismiss",
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

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- test/components/noticeStack.test.js test/helpers/windowSizeLadder.test.js test/hooks/dictationErrorAutoHide.test.js test/helpers/voicePillPresentation.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/NoticeChip.tsx src/components/ui/WordsFirstCard.tsx src/components/ui/NoticeStack.tsx src/styles/notices.css src/index.css src/hooks/usePillHotkey.ts src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/preview/browserPreview.ts src/utils/windowSizeLadder.js src/helpers/windowConfig.js src/hooks/useMainWindowSizeOwner.js src/App.jsx src/AppRouter.jsx src/helpers/voicePillPresentation.js src/locales DESIGN.md test
git commit -m "feat(voice): pill-anchored notice chips and the words-first card"
```

---
### Task 3: Voice notices: cleanup, Tinfoil, dictation errors, meeting and main-process notices

Covers VO-Q7, VO-Q21 and VO-R6 B (wiring), plus the voice-side half of the §5.3 migration.

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
- Modify: `src/helpers/ipcHandlers.js`, `preload.js`, `src/types/electron.ts` and `src/preview/browserPreview.ts`. Add `openSettingsAt(settingsPath)`.
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
  export async function retryDictationCleanup(rawText, deps = defaultDeps): Promise<"cleaned" | "unchanged" | "failed">;
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
import { notify as defaultNotify } from "../components/ui/notices";
import { getAgentName } from "../utils/agentName";
import i18n from "../i18n";

async function defaultProcessText(rawText) {
  const [{ default: ReasoningService }, { getEffectiveCleanupModel, getSettings }] =
    await Promise.all([import("../services/ReasoningService"), import("../stores/settingsStore")]);
  const model = getEffectiveCleanupModel();
  if (!model) throw new Error(i18n.t("notices.cleanupFailed.noModel"));
  return ReasoningService.processText(rawText, model, getAgentName(), {
    disableThinking: getSettings().cleanupDisableThinking,
    requireCompleteOutput: true,
  });
}

const defaultDeps = {
  processText: defaultProcessText,
  writeClipboard: (text) => window.electronAPI?.writeClipboard?.(text),
  notify: defaultNotify,
  t: (key, options) => i18n.t(key, options),
};

/**
 * Re-run cleanup on words that were already pasted raw. The pasted text cannot
 * be replaced in another app, so the cleaned text goes to the clipboard and a
 * receipt says so. The raw words are never touched on failure.
 */
export async function retryDictationCleanup(rawText, deps = defaultDeps) {
  const { processText, writeClipboard, notify, t } = deps;
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

- [ ] **Step 4: Add `openSettingsAt` (main, preload, types)**

Plan 03 owns deep links inside Settings (`ResolvedRoute.settingsPath`). This IPC only opens the control panel and forwards the path, so Plan 03's handler can honour it.

In `src/helpers/ipcHandlers.js`, near the other control-panel handlers:

```js
    ipcMain.handle("open-settings-at", async (_event, settingsPath) => {
      await this.windowManager._showControlPanel();
      this.windowManager.sendToControlPanel?.("show-settings", {
        path: typeof settingsPath === "string" ? settingsPath : null,
      });
    });
```

`_showControlPanel()` (`windowManager.js:1643`) shows the control panel, creating it through `createControlPanelWindow()` (line 1270) when needed. Read it first to confirm it creates the window if it is missing. If it does not, call `await this.windowManager.createControlPanelWindow()` first when `controlPanelWindow` is null. `sendToControlPanel` is at `windowManager.js:2162`.
- `preload.js`: add `openSettingsAt: (settingsPath) => ipcRenderer.invoke("open-settings-at", settingsPath),`.
- Change the existing `onShowSettings` listener (`preload.js:916`) to pass the payload through: `registerListener("show-settings", (callback) => (_event, payload) => callback(payload))`.
- `electron.ts`: add `openSettingsAt?: (settingsPath: string) => Promise<void>;` and widen `onShowSettings` to `(callback: (payload?: { path: string | null }) => void) => () => void`.
- `browserPreview.ts`: add `openSettingsAt: async () => {}`.

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

Locale keys (en). Add these under the `"notices"` object from Task 2, and mirror them into the 11 other locales:

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

Run: `npm test -- test/components/voiceNotices.test.js test/helpers/retryDictationCleanup.test.js test/helpers/cleanupFailureToast.test.js "test/helpers/useAudioRecording*.test.js" test/components/meetingInterruptionWarning.test.js test/hooks/dictationErrorAutoHide.test.js`
Expected: PASS. `meetingInterruptionWarning.test.js` mocks the toast. If it fails on `toast`, read it, load `notices.ts` through its Vite server, and assert on `getNotices()` as in item 8.

- [ ] **Step 7: Commit**

```bash
git add -A src/components src/helpers/retryDictationCleanup.js src/stores/cleanupFailureStore.ts src/hooks src/App.jsx src/renderApp.jsx src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/preview/browserPreview.ts src/locales test
git commit -m "feat(voice): voice notices: cleanup retry, model switch, words-first errors"
```

---

### Task 4: Finish the notice migration and delete the toast system

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
- Modify: `src/App.jsx`. Remove `useToast()` and the `+ toastCount` / `|| dictationErrorActionCount` bridges from Task 2.
- Modify: `src/helpers/windowConfig.js`. Remove `WITH_TOAST` and `DICTATION_ERROR`, keep `DICTATION_ERROR_WITH_TRANSCRIPT`, and rename nothing else.
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
  assert.doesNotMatch(css, /@keyframes toast-enter/);
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
   - Change `noticeCount + toastCount` back to `noticeCount`.
   - Change `wordsCardVisible || dictationErrorActionCount > 0` to `wordsCardVisible`.
4. In `src/helpers/windowConfig.js`, delete `WITH_TOAST` and `DICTATION_ERROR` from `WINDOW_SIZES`. Then run `grep -rn "WITH_TOAST\|\"DICTATION_ERROR\"" src test` and fix every hit: `windowManager.js` size checks and `voiceSurfaceGeometry.test.js`.
5. Delete the `.toast-surface`, `.toast-enter`, `@keyframes toast-enter`, `@keyframes toast-progress` and reduced-motion toast rules (`src/index.css:1083-1130`).
6. For each listed test that imported toast modules: if it mounted `ToastProvider` only to satisfy `useToast`, delete the provider wrapper. If it asserted a toast, load `notices.ts` through the same module system and assert on `getNotices()`. Use `await import("../../src/components/ui/notices.ts")` for SSR tests and `vite.ssrLoadModule("/components/ui/notices.ts")` for Vite-harness tests.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck && npm run i18n:check`
Expected: PASS. Any remaining failure names a call site or test you missed; fix it with the mapping rule.

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "refactor(ui): migrate every toast to notify() and remove the toast system"
```

---
### Task 5: Who already received it, and which stage is running

D3 needs honest "already sent to X" copy, and VO-R1 needs to tell "Transcribing" from "Cleaning up". The copy must be grounded in what actually left the device, not in what the settings say would leave.

**Files:**
- Create: `src/helpers/remoteDispatch.js`
- Modify: `src/helpers/audioManager.js`:
  - `setCallbacks` (line 629): add `onProcessingStage` and `onCancelledChange`.
  - Batch start: after `this.recordingStartTime =` near line 1231.
  - Streaming start: after `this.recordingStartTime = Date.now();` at line 3580, and before `provider.start(` at line 3586.
  - `processAudio`: top, line 1772.
  - `processWithOpenAIAPI`: before `transcribeAudioFileByok` at line 2952.
  - `processTranscriptionCore`: before the `route.kind === "agent" ? … : processWithReasoningModel` call near line 2689.
  - Streaming finalize start: near line 3886.
- Test: `test/helpers/remoteDispatch.test.js`

**Interfaces:**
- Consumes `providerDisplayLabel` and `isLoopbackUrl` from `src/lib/locality.ts` (Plan 01).
- Produces:

  ```js
  // src/helpers/remoteDispatch.js
  export function describeDispatchTarget({ mode, provider, remoteUrl }): string | null; // provider id, "host:<host>", or null = stays on this device
  export function dispatchTargetLabel(target: string | null, t: (key: string, o?: object) => string): string; // display text via providerDisplayLabel
  export function streamingProviderId(name: string): string;                           // "openai-realtime" -> "openai"
  export function createDispatchTracker(): { reset(): void; mark(target: string | null, payload: "audio" | "text"): void; get(): { provider: string; payload: "audio" | "text" } | null };
  ```

  ```js
  // AudioManager (new methods and callbacks)
  getRemoteDispatch(): { provider: string; payload: "audio" | "text" } | null;
  _markRemoteDispatch(target, payload): void;
  _resetRemoteDispatch(): void;
  onProcessingStage?: (stage: "transcribing" | "cleaning") => void;   // via setCallbacks
  onCancelledChange?: (state: CancelledState | null) => void;          // via setCallbacks; emitted from Task 6
  ```

- [ ] **Step 1: Write the failing test**

Create `test/helpers/remoteDispatch.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");
const { deferred } = require("./harness/deferred");

const load = () => import("../../src/helpers/remoteDispatch.js");

test("local and loopback routes never name a receiver", async () => {
  const { describeDispatchTarget } = await load();
  assert.equal(describeDispatchTarget({ mode: "local", provider: "parakeet" }), null);
  assert.equal(describeDispatchTarget({ mode: "self-hosted", remoteUrl: "http://localhost:11434/v1" }), null);
});

test("targets are ids, not display text; a LAN server is a host; unknown fails toward disclosure", async () => {
  const { describeDispatchTarget } = await load();
  assert.equal(describeDispatchTarget({ mode: "self-hosted", remoteUrl: "http://gpu-box.lan:8080/v1" }), "host:gpu-box.lan:8080");
  assert.equal(describeDispatchTarget({ mode: "providers", provider: "openai" }), "openai");
  assert.equal(describeDispatchTarget({ mode: undefined, provider: "mystery" }), "mystery");
  assert.equal(describeDispatchTarget({ mode: "providers", provider: "" }), "");
  assert.equal(describeDispatchTarget({ mode: "self-hosted", remoteUrl: "" }), null);
});

test("labels come from providerDisplayLabel, with localised fallbacks", async () => {
  const { dispatchTargetLabel } = await load();
  const t = (key) => `t:${key}`;
  assert.equal(dispatchTargetLabel("openai", t), "OpenAI");
  assert.equal(dispatchTargetLabel("host:gpu-box.lan:8080", t), "gpu-box.lan:8080");
  assert.equal(dispatchTargetLabel("custom", t), "t:locality.customEndpoint");
  assert.equal(dispatchTargetLabel("", t), "t:locality.unknownProvider");
});

test("streaming names map back to their provider", async () => {
  const { streamingProviderId } = await load();
  assert.equal(streamingProviderId("openai-realtime"), "openai");
  assert.equal(streamingProviderId("tinfoil-realtime"), "tinfoil");
  assert.equal(streamingProviderId("deepgram"), "deepgram");
});

test("audio outranks text, and the first audio receiver is kept", async () => {
  const { createDispatchTracker } = await load();
  const tracker = createDispatchTracker();
  tracker.mark(null, "audio");
  assert.equal(tracker.get(), null);
  tracker.mark("anthropic", "text");
  assert.deepEqual(tracker.get(), { provider: "anthropic", payload: "text" });
  tracker.mark("openai", "audio");
  tracker.mark("groq", "audio");
  assert.deepEqual(tracker.get(), { provider: "openai", payload: "audio" });
  tracker.reset();
  assert.equal(tracker.get(), null);
});

test("batch dispatch is marked only once the upload is invoked", async (t) => {
  const { AudioManager, window } = await loadAudioManager(t, {
    cachePrefix: "openwhispr-remote-dispatch-",
    settingsKey: "__remoteDispatchSettings",
    settings: {
      useLocalWhisper: false,
      cloudTranscriptionProvider: "openai",
      cloudTranscriptionModel: "whisper-1",
      transcriptionMode: "providers",
      cloudTranscriptionMode: "byok",
    },
  });
  const upload = deferred();
  let invoked = false;
  window.electronAPI = {
    ...window.electronAPI,
    transcribeAudioFileByok: () => {
      invoked = true;
      return upload.promise;
    },
    cancelUploadTranscription: () => {},
  };
  // Prototype-only instance. If processWithOpenAIAPI reaches another helper
  // that needs a stub, add it to this object; keep the assertions as written.
  const manager = Object.assign(Object.create(AudioManager.prototype), {
    getTranscriptionModel: () => "whisper-1",
  });
  manager._resetRemoteDispatch();
  assert.equal(manager.getRemoteDispatch(), null);
  const pending = manager
    .processWithOpenAIAPI(new Blob([new Uint8Array(64)], { type: "audio/webm" }), {}, () => false)
    .catch(() => {});
  for (let i = 0; i < 50 && !invoked; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(invoked, true);
  assert.deepEqual(manager.getRemoteDispatch(), { provider: "openai", payload: "audio" });
  upload.resolve({ success: false, error: "stop" });
  await pending;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/remoteDispatch.test.js`
Expected: FAIL with `Cannot find module '…/remoteDispatch.js'`.

- [ ] **Step 3: Implement**

`src/helpers/remoteDispatch.js`:

```js
import { isLoopbackUrl, providerDisplayLabel } from "../lib/locality";

// Identifies the receiver of a request that is actually being sent. Callers
// mark at the moment of dispatch (WebSocket open, upload IPC, cleanup
// request), so "already received" copy reflects what left the device, not
// what settings say might. Mirrors resolveLocality: unknown modes fail toward
// disclosure. Returns an id (or "host:<host>"), never display text; the UI
// renders it with dispatchTargetLabel so names are localised (Plan 01 review).
export function describeDispatchTarget({ mode, provider, remoteUrl } = {}) {
  if (mode === "local") return null;
  if (mode === "self-hosted") {
    if (!remoteUrl || isLoopbackUrl(remoteUrl)) return null;
    try {
      const host = new URL(remoteUrl).host;
      return host ? `host:${host}` : null;
    } catch {
      return null;
    }
  }
  return String(provider ?? "").trim();
}

export function dispatchTargetLabel(target, t) {
  if (typeof target === "string" && target.startsWith("host:")) return target.slice(5);
  return providerDisplayLabel(target, t);
}

export function streamingProviderId(name) {
  return String(name ?? "").replace(/-realtime$/, "");
}

export function createDispatchTracker() {
  let current = null;
  return {
    reset() {
      current = null;
    },
    mark(target, payload) {
      // "" is an unknown remote provider (still disclosed); null means local.
      if (target === null || target === undefined) return;
      if (current?.payload === "audio") return;
      if (!current || payload === "audio") current = { provider: target, payload };
    },
    get() {
      return current;
    },
  };
}
```

In `src/helpers/audioManager.js`:

1. Add `import { createDispatchTracker, describeDispatchTarget, streamingProviderId } from "./remoteDispatch";` to the imports.
2. Add these methods next to `getStreamingProviderName()` (line 822):

   ```js
   _markRemoteDispatch(target, payload) {
     (this._remoteDispatch ??= createDispatchTracker()).mark(target, payload);
   }

   _resetRemoteDispatch() {
     (this._remoteDispatch ??= createDispatchTracker()).reset();
   }

   getRemoteDispatch() {
     return this._remoteDispatch?.get() ?? null;
   }
   ```

3. In `setCallbacks` (line 629), add `onProcessingStage = undefined, onCancelledChange = undefined,` to the destructure, and `this.onProcessingStage = onProcessingStage; this.onCancelledChange = onCancelledChange;` to the body.
4. Reset at every new recording. Directly after the batch `this.recordingStartTime = …` assignment (near line 1231) and the streaming one (line 3580), add `this._resetRemoteDispatch();`.
5. Streaming. Directly before `const res = await provider.start(` (line 3586):

   ```js
           this._markRemoteDispatch(
             describeDispatchTarget({ mode: "providers", provider: streamingProviderId(this.getStreamingProviderName()) }),
             "audio"
           );
   ```

6. Batch upload. Directly before `const result = await window.electronAPI.transcribeAudioFileByok(payload);` (line 2952):

   ```js
       this._markRemoteDispatch(
         describeDispatchTarget({
           mode: settings.transcriptionMode,
           provider,
           remoteUrl: settings.remoteTranscriptionUrl,
         }),
         "audio"
       );
   ```

7. Cleanup. In `processTranscriptionCore`, directly before the `const result = route.kind === "agent" ? … : await this.processWithReasoningModel(…)` expression (near line 2689):

   ```js
           this._markRemoteDispatch(
             describeDispatchTarget({
               mode: route.config?.mode,
               provider: route.config?.provider || cleanupProvider,
               remoteUrl: route.config?.remoteUrl ?? route.config?.baseUrl ?? null,
             }),
             "text"
           );
           if (route.kind !== "agent") this.onProcessingStage?.("cleaning");
   ```

   Check the field names on the resolved LLM config first: `grep -n "remoteUrl\|baseUrl\|mode:" src/config/inferenceScopes.ts src/helpers/*esolved*LLM* 2>/dev/null | head`. Use the real names.
8. Stage "transcribing":
   - At the top of `processAudio`, after `const wasCancelled = …` (line 1775), add `this.onProcessingStage?.("transcribing");`.
   - At the streaming finalize start (where it calls `this.onStateChange?.({ isRecording: false, isProcessing: true … })` near line 3886), add the same line after that call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/helpers/remoteDispatch.test.js test/helpers/audioManagerCancelLifecycle.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/remoteDispatch.js src/helpers/audioManager.js test/helpers/remoteDispatch.test.js
git commit -m "feat(voice): record who actually received dictation audio or text"
```

---

### Task 6: RAM-only undo hold for cancelled dictation (D3)

**Files:**
- Create: `src/helpers/cancelHold.js`
- Modify: `src/helpers/audioManager.js`:
  - `cancelRecording` (1605–1640) and `discardBatchRecording` (1641–1645)
  - `cancelProcessing` (1745–1770)
  - `cancelStreamingRecording` (3781–3843)
  - `processAudio` (1772): remember the blob being processed
  - the batch and streaming start paths: finalize any prior hold
- Modify: `docs/PRIVACY.md`. Add the undo sentence under `## Content and retention`, after line 14.
- Test: `test/helpers/cancelHold.test.js`
- Test: `test/helpers/audioManagerCancelHold.test.js`

**Interfaces:**
- Consumes `getRemoteDispatch()` and `onCancelledChange` (Task 5), and `shouldSaveDiscardedRecording` (`src/helpers/discardedRecording.js`).
- Produces:

  ```js
  // src/helpers/cancelHold.js
  export const UNDO_WINDOW_MS = 5000;
  export const LONG_UNDO_WINDOW_MS = 10000;
  export const LONG_RECORDING_SECONDS = 30;
  export function undoWindowMs(durationSeconds: number | null): number;
  export function zeroBytes(bytes: Uint8Array | null): void;
  export function createCancelHold(opts: { now?, setTimer?, clearTimer?, onExpire?: (entry) => Promise<void> | void }): {
    hold(entry: { bytes: Promise<Uint8Array | null>; mimeType: string; durationSeconds: number | null; analyticsOccurredAt: string }): number; // expiresAt
    pause(): number | null; resume(): number | null; take(): HeldEntry | null; expireNow(): Promise<void>; isHolding(): boolean;
  };
  ```

  ```js
  // AudioManager
  restoreCancelled(): Promise<boolean>;
  pauseCancelHold(): void;
  resumeCancelHold(): void;
  flushCancelHold(): Promise<void>;
  // emits onCancelledChange({ undoUntil, remoteAlreadySent, remotePayload } | null)
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/cancelHold.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/helpers/cancelHold.js");

function timers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      pending.set(++seq, { fn, at: now + ms });
      return seq;
    },
    clearTimer: (id) => pending.delete(id),
    async advance(ms) {
      now += ms;
      for (const [id, entry] of [...pending]) {
        if (entry.at <= now) {
          pending.delete(id);
          entry.fn();
        }
      }
      await new Promise((r) => setImmediate(r));
    },
  };
}

const entry = (bytes, durationSeconds = 4) => ({
  bytes: Promise.resolve(bytes),
  mimeType: "audio/webm",
  durationSeconds,
  analyticsOccurredAt: "2026-10-15T00:00:00.000Z",
});

test("the undo window is 5s, or 10s past 30s of audio", async () => {
  const { undoWindowMs } = await load();
  assert.equal(undoWindowMs(4), 5000);
  assert.equal(undoWindowMs(30), 5000);
  assert.equal(undoWindowMs(30.5), 10000);
  assert.equal(undoWindowMs(null), 5000);
});

test("expiry hands the bytes to onExpire once, then zeroes them", async () => {
  const { createCancelHold } = await load();
  const clock = timers();
  const seen = [];
  const hold = createCancelHold({ ...clock, onExpire: (e) => seen.push([...e.bytes]) });
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(hold.hold(entry(bytes)), 5000);
  await clock.advance(4999);
  assert.equal(seen.length, 0);
  await clock.advance(1);
  assert.deepEqual(seen, [[1, 2, 3]]);
  assert.deepEqual([...bytes], [0, 0, 0]);
  assert.equal(hold.isHolding(), false);
});

test("take() ends the window without calling onExpire", async () => {
  const { createCancelHold } = await load();
  const clock = timers();
  let expired = 0;
  const hold = createCancelHold({ ...clock, onExpire: () => expired++ });
  hold.hold(entry(new Uint8Array([9])));
  const taken = hold.take();
  assert.deepEqual([...(await taken.bytes)], [9]);
  await clock.advance(20_000);
  assert.equal(expired, 0);
  assert.equal(hold.take(), null);
});

test("hover pause stops the clock; resume continues from the remaining time", async () => {
  const { createCancelHold } = await load();
  const clock = timers();
  let expired = 0;
  const hold = createCancelHold({ ...clock, onExpire: () => expired++ });
  hold.hold(entry(new Uint8Array([1]), 45));
  await clock.advance(4000);
  hold.pause();
  await clock.advance(60_000);
  assert.equal(expired, 0);
  assert.equal(hold.resume(), 64_000 + 6000);
  await clock.advance(6000);
  assert.equal(expired, 1);
});

test("a newer hold finalizes the older one first", async () => {
  const { createCancelHold } = await load();
  const clock = timers();
  const seen = [];
  const hold = createCancelHold({ ...clock, onExpire: (e) => seen.push(e.bytes[0]) });
  hold.hold(entry(new Uint8Array([1])));
  hold.hold(entry(new Uint8Array([2])));
  await clock.advance(0);
  assert.deepEqual(seen, [1]);
});

test("expireNow is idempotent (unload flush)", async () => {
  const { createCancelHold } = await load();
  const clock = timers();
  let expired = 0;
  const hold = createCancelHold({ ...clock, onExpire: () => expired++ });
  hold.hold(entry(new Uint8Array([1])));
  await hold.expireNow();
  await hold.expireNow();
  assert.equal(expired, 1);
});
```

Create `test/helpers/audioManagerCancelHold.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");

const RETENTION_ON = { saveDiscardedTranscriptions: true, dataRetentionEnabled: true, audioRetentionDays: 30 };
const RETENTION_OFF = { saveDiscardedTranscriptions: false, dataRetentionEnabled: true, audioRetentionDays: 30 };

async function setup(t, settings) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "openwhispr-cancel-hold-",
    settingsKey: "__cancelHoldSettings",
    settings,
  });
  const { createCancelHold } = await loaded.vite.ssrLoadModule("/helpers/cancelHold.js");
  let now = 0;
  const pending = new Map();
  let seq = 0;
  const holdTimers = {
    now: () => now,
    setTimer: (fn, ms) => (pending.set(++seq, { fn, at: now + ms }), seq),
    clearTimer: (id) => pending.delete(id),
  };
  const advance = async (ms) => {
    now += ms;
    for (const [id, e] of [...pending]) if (e.at <= now) (pending.delete(id), e.fn());
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  };
  const calls = { saved: 0, processed: [], cancelled: [] };
  const manager = Object.assign(Object.create(loaded.AudioManager.prototype), {
    isProcessing: true,
    _processingCancellationGeneration: 0,
    _streamingStopPromise: null,
    _requestStreamingCancellation() {},
    _holdTimers: holdTimers,
    _createCancelHold: createCancelHold,
    _processingAudio: {
      blob: new Blob([new Uint8Array([7, 7, 7])], { type: "audio/webm" }),
      durationSeconds: 4,
      analyticsOccurredAt: "2026-10-15T00:00:00.000Z",
    },
    onStateChange() {},
    onCancelledChange: (state) => calls.cancelled.push(state),
    saveDiscardedTranscription: async () => {
      calls.saved += 1;
    },
    processAudio: async (blob, meta) => {
      calls.processed.push({ bytes: [...new Uint8Array(await blob.arrayBuffer())], meta });
    },
  });
  globalThis.window.electronAPI = { ...globalThis.window.electronAPI, dismissDictationPreview: () => {} };
  return { manager, calls, advance };
}

test("cancel during an in-flight upload holds the blob and names the provider", async (t) => {
  const { manager, calls, advance } = await setup(t, RETENTION_OFF);
  manager._markRemoteDispatch("openai", "audio");
  assert.equal(manager.cancelProcessing(), true);
  await advance(0);
  const state = calls.cancelled.at(-1);
  assert.equal(state.remoteAlreadySent, "openai");
  assert.equal(state.remotePayload, "audio");
  assert.equal(state.undoUntil, 5000);
});

test("cancel before anything left the device names no one", async (t) => {
  const { manager, calls, advance } = await setup(t, RETENTION_OFF);
  manager._resetRemoteDispatch();
  manager.cancelProcessing();
  await advance(0);
  assert.equal(calls.cancelled.at(-1).remoteAlreadySent, null);
});

test("undo restores the exact audio and never persists a discarded copy", async (t) => {
  const { manager, calls, advance } = await setup(t, RETENTION_ON);
  manager.cancelProcessing();
  await advance(0);
  assert.equal(await manager.restoreCancelled(), true);
  assert.deepEqual(calls.processed[0].bytes, [7, 7, 7]);
  assert.equal(calls.processed[0].meta.restoredFromCancel, true);
  assert.equal(calls.cancelled.at(-1), null);
  await advance(20_000);
  assert.equal(calls.saved, 0);
  assert.equal(await manager.restoreCancelled(), false);
});

test("expiry persists once when retention allows, never when it does not", async (t) => {
  const on = await setup(t, RETENTION_ON);
  on.manager.cancelProcessing();
  await on.advance(5000);
  assert.equal(on.calls.saved, 1);
  assert.equal(on.calls.cancelled.at(-1), null);

  const off = await setup(t, RETENTION_OFF);
  off.manager.cancelProcessing();
  await off.advance(5000);
  assert.equal(off.calls.saved, 0);
});

test("flush on unload persists once", async (t) => {
  const { manager, calls, advance } = await setup(t, RETENTION_ON);
  manager.cancelProcessing();
  await advance(0);
  await manager.flushCancelHold();
  await manager.flushCancelHold();
  await advance(20_000);
  assert.equal(calls.saved, 1);
});

test("a streaming cancel offers no undo but still says who has the audio", async (t) => {
  const { manager, calls } = await setup(t, RETENTION_OFF);
  manager._markRemoteDispatch("openai", "audio");
  manager._emitCancelled({ hold: null });
  assert.deepEqual(calls.cancelled.at(-1), { undoUntil: 0, remoteAlreadySent: "openai", remotePayload: "audio" });
});
```

Check `shouldSaveDiscardedRecording` (`src/helpers/discardedRecording.js`) before running. It also requires `durationSeconds >= 1`, and the fixture uses 4.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/cancelHold.test.js test/helpers/audioManagerCancelHold.test.js`
Expected: FAIL. `cancelHold.js` is not found, then `manager._markRemoteDispatch` passes but `restoreCancelled` is not a function.

- [ ] **Step 3: Implement `cancelHold.js`**

```js
// D3: a cancelled dictation is held in RAM for a short undo window, then
// zeroed. Bytes arrive as a promise because a batch recorder's final chunk
// lands after stop(); the window starts at the cancel itself.
export const UNDO_WINDOW_MS = 5000;
export const LONG_UNDO_WINDOW_MS = 10000;
export const LONG_RECORDING_SECONDS = 30;

export function undoWindowMs(durationSeconds) {
  return Number(durationSeconds) > LONG_RECORDING_SECONDS ? LONG_UNDO_WINDOW_MS : UNDO_WINDOW_MS;
}

export function zeroBytes(bytes) {
  if (bytes && typeof bytes.fill === "function") bytes.fill(0);
}

export function createCancelHold({
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onExpire,
} = {}) {
  let held = null;

  const finalize = async (entry) => {
    const bytes = await entry.bytes.catch(() => null);
    try {
      if (bytes && bytes.length > 0) await onExpire?.({ ...entry, bytes });
    } finally {
      zeroBytes(bytes);
    }
  };

  const expire = () => {
    if (!held) return Promise.resolve();
    const entry = held;
    held = null;
    clearTimer(entry.timer);
    return finalize(entry);
  };

  return {
    hold({ bytes, mimeType, durationSeconds, analyticsOccurredAt }) {
      if (held) void expire();
      const ms = undoWindowMs(durationSeconds);
      held = {
        bytes: Promise.resolve(bytes),
        mimeType,
        durationSeconds,
        analyticsOccurredAt,
        expiresAt: now() + ms,
        remainingMs: null,
        timer: setTimer(() => void expire(), ms),
      };
      return held.expiresAt;
    },
    pause() {
      if (!held || held.remainingMs !== null) return null;
      clearTimer(held.timer);
      held.remainingMs = Math.max(0, held.expiresAt - now());
      return held.expiresAt;
    },
    resume() {
      if (!held || held.remainingMs === null) return null;
      const ms = held.remainingMs;
      held.remainingMs = null;
      held.expiresAt = now() + ms;
      held.timer = setTimer(() => void expire(), ms);
      return held.expiresAt;
    },
    take() {
      if (!held) return null;
      const entry = held;
      held = null;
      clearTimer(entry.timer);
      return entry;
    },
    expireNow: expire,
    isHolding: () => held !== null,
  };
}
```

- [ ] **Step 4: Wire the hold into `AudioManager`**

In `src/helpers/audioManager.js`:

1. Add `import { createCancelHold, zeroBytes } from "./cancelHold";` to the imports.
2. Add these methods after `persistDiscardedBatchRecording` (line 1713):

```js
  _cancelHold() {
    const create = this._createCancelHold ?? createCancelHold;
    return (this._hold ??= create({
      ...(this._holdTimers ?? {}),
      onExpire: (entry) => this._persistExpiredHold(entry),
    }));
  }

  async _persistExpiredHold(entry) {
    this.onCancelledChange?.(null);
    if (!shouldSaveDiscardedRecording(getSettings(), entry.durationSeconds)) return;
    try {
      const blob = new Blob([entry.bytes], { type: entry.mimeType || "audio/webm" });
      await this.saveDiscardedTranscription(blob, entry.durationSeconds, entry.analyticsOccurredAt);
    } catch (error) {
      logger.warn("Failed to save discarded recording", { error: error.message }, "audio");
    }
  }

  // One place builds the D3 state the pill renders. `hold` is null when there
  // is nothing local to restore (streaming): undoUntil 0 means "no Undo".
  _emitCancelled({ hold }) {
    const dispatch = this.getRemoteDispatch();
    this.onCancelledChange?.({
      undoUntil: hold ? hold.expiresAt : 0,
      remoteAlreadySent: dispatch?.provider ?? null,
      remotePayload: dispatch?.payload ?? null,
    });
  }

  _holdForUndo({ bytes, mimeType, durationSeconds, analyticsOccurredAt }) {
    const hold = this._cancelHold();
    const expiresAt = hold.hold({ bytes, mimeType, durationSeconds, analyticsOccurredAt });
    this._emitCancelled({ hold: { expiresAt } });
  }

  _assembleDiscardedBytes({ chunks, segments, mimeType }) {
    return (async () => {
      if (chunks.length === 0 && segments.length === 0) return null;
      const current = new Blob(chunks, { type: mimeType });
      let blob = null;
      try {
        blob = await this.mergeRecordedSegments([...segments, current]);
      } catch {
        blob = this.getLargestRecordedSegment([...segments, current]);
      }
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    })();
  }

  async restoreCancelled() {
    const entry = this._hold?.take();
    if (!entry) return false;
    const bytes = await entry.bytes;
    if (!bytes || bytes.length === 0) {
      this.onCancelledChange?.(null);
      return false;
    }
    const blob = new Blob([bytes], { type: entry.mimeType || "audio/webm" });
    zeroBytes(bytes);
    this.onCancelledChange?.(null);
    this._resetRemoteDispatch();
    this.isProcessing = true;
    this.onStateChange?.({ isRecording: false, isProcessing: true });
    await this.processAudio(blob, {
      durationSeconds: entry.durationSeconds,
      restoredFromCancel: true,
    });
    return true;
  }

  pauseCancelHold() {
    const expiresAt = this._hold?.pause();
    if (expiresAt) this._emitCancelled({ hold: { expiresAt: Number.MAX_SAFE_INTEGER } });
  }

  resumeCancelHold() {
    const expiresAt = this._hold?.resume();
    if (expiresAt) this._emitCancelled({ hold: { expiresAt } });
  }

  flushCancelHold() {
    return this._hold?.expireNow() ?? Promise.resolve();
  }
```

   `restoreCancelled` mirrors the state flips that `finalizeBatchRecording` performs before it calls `processAudio` (lines 1406–1500). Read that block. If it sets more than `isProcessing` (for example, it starts a processing pipeline or emits `onProcessingStage`), do the same here.

   `pauseCancelHold` emits `MAX_SAFE_INTEGER` as the paused `undoUntil`, so the pill's shrinking underline freezes. The pill pauses its own CSS animation on hover too (Task 9).

3. **`cancelRecording` (batch path, lines 1611–1631).** Replace `this.persistDiscardedBatchRecording(discarded);` inside `onstop` with a hold. Start the window at the cancel itself, before `onstop`:

   ```js
     if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
       const recorder = this.mediaRecorder;
       const discarded = this.takeDiscardedBatchSnapshot();
       let resolveBytes;
       const bytes = new Promise((resolve) => (resolveBytes = resolve));
       this._holdForUndo({ ...discarded, bytes });
       this.mediaRecorder.onstop = () => {
         recorder.stream?.getTracks().forEach((track) => track.stop());
         resolveBytes(this._assembleDiscardedBytes(discarded));
       };
   ```

   The rest of the block (`resetDiscardedBatchRecordingState()`, `recorder.stop()`, the track cleanup and `return true`) stays as it is.

4. **`discardBatchRecording` (lines 1641–1645).** Replace it with:

   ```js
     discardBatchRecording() {
       const discarded = this.takeDiscardedBatchSnapshot();
       this.resetDiscardedBatchRecordingState();
       this._holdForUndo({ ...discarded, bytes: this._assembleDiscardedBytes(discarded) });
     }
   ```

   Then `persistDiscardedBatchRecording` has no callers left. Delete it, and move its fallback logging into `_persistExpiredHold`, which already logs.

5. **`processAudio` (line 1772).** After `const pipeline = …`, add:

   ```js
       this._processingAudio = {
         blob: audioBlob,
         durationSeconds: metadata.durationSeconds ?? null,
         analyticsOccurredAt: new Date().toISOString(),
       };
   ```

   Set `this._processingAudio = null;` in `_settleProcessingPipeline` when it settles the active pipeline (line ~1726).

6. **`cancelProcessing` (lines 1745–1770).** Directly after the generation bump and `_requestStreamingCancellation()`, add:

   ```js
       if (this._streamingStopPromise) {
         // Streaming finalization: the audio already streamed to the provider
         // and no local copy is kept (CCR-1: undoUntil 0).
         this._emitCancelled({ hold: null });
         return true;
       }
       const processing = this._processingAudio;
       this._processingAudio = null;
       if (processing?.blob) {
         this._holdForUndo({
           bytes: processing.blob.arrayBuffer().then((b) => new Uint8Array(b)),
           mimeType: processing.blob.type,
           durationSeconds: processing.durationSeconds,
           analyticsOccurredAt: processing.analyticsOccurredAt,
         });
       }
   ```

   This replaces the existing `if (this._streamingStopPromise) return true;` line. The rest of the method (state flip and `dismissDictationPreview`) is unchanged.

7. **`cancelStreamingRecording` (line 3781).** At its start, after the guard that confirms a streaming session exists, add `this._emitCancelled({ hold: null });`. Streaming keeps no local audio after cancel; see Open question 1.

8. **New recording finalizes any open hold.** At the very start of `startRecording()` and `startStreamingRecording()`, add:

   ```js
       if (this._hold?.isHolding()) void this._hold.expireNow();
   ```

   `expireNow` runs `_persistExpiredHold`, which emits `onCancelledChange(null)`.

9. **`docs/PRIVACY.md`.** After line 14 ("Discarded transcriptions are not saved by default."), add:

   ```markdown
   - When you cancel a dictation, Loqui keeps that audio in memory for 5 seconds (10 seconds for recordings over 30 seconds) so you can undo the cancel. It is never written to disk unless you have turned on saving discarded transcriptions; when the window ends it is erased from memory. If a cloud provider had already received the audio or text before you cancelled, Loqui says so, and undoing sends the same audio to that same provider again.
   ```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/cancelHold.test.js test/helpers/audioManagerCancelHold.test.js test/helpers/audioManagerCancelLifecycle.test.js test/helpers/discardedRecording.test.js`
Expected: PASS. If `audioManagerCancelLifecycle.test.js` expected `persistDiscardedBatchRecording` to run on cancel, update that expectation: the save now happens at hold expiry. Assert `_hold.isHolding()` instead.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/cancelHold.js src/helpers/audioManager.js docs/PRIVACY.md test/helpers/cancelHold.test.js test/helpers/audioManagerCancelHold.test.js test/helpers/audioManagerCancelLifecycle.test.js
git commit -m "feat(voice): hold cancelled dictation in RAM for an undo window"
```

---

### Task 7: Lifecycle additions in `useAudioRecording` (§5.2)

**Files:**
- Modify: `src/hooks/useAudioRecording.js`:
  - state (lines 34–42)
  - `setCallbacks` block (lines 333–694)
  - `onStateChange` (334–382), including the Esc unregister at 342
  - stop path, Esc unregister at 259
  - `onTranscriptionComplete` paste result (lines 636–660)
  - `showDictationError`
  - return value (877–893)
- Create: `src/hooks/useUndoCancelHotkey.ts`
- Modify: `src/App.jsx`. Wire Esc for processing at lines 364–369, add the ⌥Z hotkey, and flush on unload.
- Test: `test/helpers/useAudioRecordingCancelUndo.test.js`

**Interfaces:**
- Consumes `onCancelledChange`, `onProcessingStage`, `restoreCancelled`, `pauseCancelHold`, `resumeCancelHold` and `flushCancelHold` (Tasks 5 and 6), and `usePillHotkey` (Task 2).
- Produces (§5.2, with CCR-1 and CCR-3):

  ```ts
  type CancelledState = { undoUntil: number; remoteAlreadySent: string | null; remotePayload: "audio" | "text" | null };
  type Outcome = { kind: "pasted"; words: number; at: number } | { kind: "failed"; at: number };
  // useAudioRecording(options) return gains:
  cancelled: CancelledState | null;
  undoCancel(): Promise<boolean>;
  pauseUndo(): void;
  resumeUndo(): void;
  processingStage: "transcribing" | "cleaning" | null;
  outcome: Outcome | null;
  ```

  ```ts
  // src/hooks/useUndoCancelHotkey.ts
  export function useUndoCancelHotkey(cancelled: CancelledState | null, undoCancel: () => Promise<boolean>): void;
  ```

  `meetingRecording` is added in Task 15, after Task 14 builds its relay.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/useAudioRecordingCancelUndo.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createRendererServer, installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");

const FAKE_AUDIO_MANAGER_SOURCE = `
export default class FakeAudioManager {
  constructor() { this.voiceAgentRequested = false; this.translationRequested = false; this.sttConfig = { success: true }; globalThis.__am = this; }
  getState() { return { isRecording: this.recording === true }; }
  setCallbacks(cb) { this.cb = cb; }
  setVoiceAgentRequested(v) { this.voiceAgentRequested = v; }
  setAssistantSelectionContext() {}
  setTranslationRequested(v) { this.translationRequested = v; }
  shouldUseStreaming() { return false; }
  prepareMicCapture() {} cancelPreparedMicCapture() {} cleanup() {}
  async startRecording() { this.recording = true; return true; }
  async restoreCancelled() { globalThis.__restored = (globalThis.__restored || 0) + 1; this.cb.onCancelledChange(null); return true; }
  pauseCancelHold() { globalThis.__paused = true; }
  resumeCancelHold() {}
  flushCancelHold() { return Promise.resolve(); }
}`;

async function mount(t, electronAPI, extraHook) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__am;
    delete globalThis.__restored;
  });
  const noop = () => () => {};
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        onToggleDictation: noop, onToggleVoiceAgent: noop, onToggleTranslation: noop,
        onStartDictation: noop, onPrepareDictation: noop, onCancelDictationPreparation: noop,
        onStopDictation: noop, dictationLifecycleStateChanged: () => {},
        ...electronAPI,
      },
    },
  });
  const container = installHookDom(t);
  globalThis.requestAnimationFrame = (cb) => (cb(), 1);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-cancel-undo-",
    mockModules: { "/helpers/audioManager": FAKE_AUDIO_MANAGER_SOURCE },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const { useUndoCancelHotkey } = await vite.ssrLoadModule("/hooks/useUndoCancelHotkey.ts");
  const ref = {};
  function Harness() {
    ref.api = useAudioRecording({ onDemoEvent: () => {} });
    useUndoCancelHotkey(ref.api.cancelled, ref.api.undoCancel);
    extraHook?.(ref.api);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return ref;
}

const fire = (name, value) => React.act(async () => globalThis.__am.cb[name](value));

test("cancelled mirrors the manager and undoCancel restores once", async (t) => {
  const ref = await mount(t, {});
  const state = { undoUntil: 123, remoteAlreadySent: "openai", remotePayload: "audio" };
  await fire("onCancelledChange", state);
  assert.deepEqual(ref.api.cancelled, state);
  let restored;
  await React.act(async () => {
    restored = await ref.api.undoCancel();
  });
  assert.equal(restored, true);
  assert.equal(globalThis.__restored, 1);
  assert.equal(ref.api.cancelled, null);
});

test("undo hotkey is released at expiry, on undo and on a new start", async (t) => {
  const log = [];
  const ref = await mount(t, {
    registerPillHotkey: async (slot, accel) => log.push(`+${slot}:${accel}`),
    unregisterPillHotkey: async (slot) => log.push(`-${slot}`),
    onPillHotkeyPressed: () => () => {},
  });
  await fire("onCancelledChange", { undoUntil: 5000, remoteAlreadySent: null, remotePayload: null });
  await fire("onCancelledChange", null); // expiry, or a new start finalizing the hold
  await fire("onCancelledChange", { undoUntil: 5000, remoteAlreadySent: null, remotePayload: null });
  await React.act(async () => {
    await ref.api.undoCancel();
  });
  await fire("onCancelledChange", { undoUntil: 0, remoteAlreadySent: "openai", remotePayload: "audio" });
  assert.deepEqual(log, ["+undoCancel:Alt+Z", "-undoCancel", "+undoCancel:Alt+Z", "-undoCancel"]);
});

test("Escape stays registered through processing and is released at idle", async (t) => {
  const log = [];
  const ref = await mount(t, {
    registerCancelHotkey: (k) => log.push(`+${k}`),
    unregisterCancelHotkey: () => log.push("-esc"),
    captureDictationTarget: async () => ({}),
  });
  await React.act(async () => {
    await ref.api.startRecording();
  });
  await fire("onStateChange", { isRecording: true, isProcessing: false });
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  assert.deepEqual(log, ["+Escape"]);
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  assert.deepEqual(log, ["+Escape", "-esc"]);
});

test("processing stage follows the manager and clears at idle", async (t) => {
  const ref = await mount(t, {});
  await fire("onStateChange", { isRecording: false, isProcessing: true });
  await fire("onProcessingStage", "transcribing");
  assert.equal(ref.api.processingStage, "transcribing");
  await fire("onProcessingStage", "cleaning");
  assert.equal(ref.api.processingStage, "cleaning");
  await fire("onStateChange", { isRecording: false, isProcessing: false });
  assert.equal(ref.api.processingStage, null);
});
```

If `startRecording()` in the "Escape" test hits another unguarded `electronAPI` call, add a no-op for it to that test's `electronAPI` object. The assertions stay unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/helpers/useAudioRecordingCancelUndo.test.js`
Expected: FAIL. `useUndoCancelHotkey.ts` is not found. After you create it, `ref.api.cancelled` is `undefined`.

- [ ] **Step 3: Implement**

1. Create `src/hooks/useUndoCancelHotkey.ts`:

   ```ts
   import { usePillHotkey } from "./usePillHotkey";

   type CancelledState = { undoUntil: number; remoteAlreadySent: string | null; remotePayload: "audio" | "text" | null };

   /** ⌥Z restores a cancelled dictation, held only while an undo window is open (D3). */
   export function useUndoCancelHotkey(
     cancelled: CancelledState | null,
     undoCancel: () => Promise<boolean>
   ): void {
     usePillHotkey("undoCancel", Boolean(cancelled && cancelled.undoUntil > 0), () => {
       void undoCancel();
     });
   }
   ```

2. In `useAudioRecording.js`:
   - **State.** Add after line 42:

     ```js
       const [cancelled, setCancelled] = useState(null);
       const [processingStage, setProcessingStage] = useState(null);
       const [outcome, setOutcome] = useState(null);
     ```

   - **`setCallbacks` block.** Add:

     ```js
         onCancelledChange: (state) => setCancelled(state),
         onProcessingStage: (stage) => setProcessingStage(stage),
     ```

   - **`onStateChange` (line 334).** Replace the unregister at line 342 (`if (!isRecording) window.electronAPI?.unregisterCancelHotkey?.()` or its equivalent) so Esc is released only at idle (D3 / VO-Q8):

     ```js
           if (!isRecording && !isProcessing) {
             window.electronAPI?.unregisterCancelHotkey?.();
             setProcessingStage(null);
           }
     ```

     If Plan 02 already moved this unregister to the idle edge, keep its version and add only the `setProcessingStage(null)`.
   - **`performStopRecording` (line 259).** Delete the `unregisterCancelHotkey` call there, because processing follows the stop.
   - **Paste success (lines 657–660).** Add `setOutcome({ kind: "pasted", words: countWords(result.text), at: Date.now() });` inside `if (pasteSucceeded) {`. Add the helper at module scope:

     ```js
     const countWords = (text) => (text.trim() ? text.trim().split(/\s+/u).length : 0);
     ```

   - **`showDictationError` (from Task 3).** Add `setOutcome({ kind: "failed", at: Date.now() });` as its first line.
   - **New callbacks.** Add after `cancelProcessing` (line 838):

     ```js
       const undoCancel = useCallback(async () => {
         const restored = await audioManagerRef.current?.restoreCancelled?.();
         return Boolean(restored);
       }, []);
       const pauseUndo = useCallback(() => audioManagerRef.current?.pauseCancelHold?.(), []);
       const resumeUndo = useCallback(() => audioManagerRef.current?.resumeCancelHold?.(), []);

       useEffect(() => {
         const flush = () => void audioManagerRef.current?.flushCancelHold?.();
         window.addEventListener?.("beforeunload", flush);
         return () => window.removeEventListener?.("beforeunload", flush);
       }, []);
     ```

   - **Streaming no-undo display.** When `cancelled.undoUntil === 0`, clear it after 3.5 s so the "already received" copy does not linger:

     ```js
       useEffect(() => {
         if (!cancelled || cancelled.undoUntil > 0) return;
         const id = setTimeout(() => setCancelled(null), 3500);
         return () => clearTimeout(id);
       }, [cancelled]);
     ```

   - **Return object (lines 877–893).** Add `cancelled, undoCancel, pauseUndo, resumeUndo, processingStage, outcome,`.

3. In `src/App.jsx`:
   - Destructure the six new fields from `useAudioRecording`.
   - Call `useUndoCancelHotkey(cancelled, undoCancel);`.
   - Make the global Esc handler (lines 364–369) cancel processing too:

     ```js
         return window.electronAPI.onCancelHotkeyPressed(() => {
           if (isRecordingRef.current) cancelRecording();
           else if (isProcessingRef.current) cancelProcessing();
         });
     ```

     Add `const isProcessingRef = useRef(isProcessing); isProcessingRef.current = isProcessing;` next to the existing `isRecordingRef`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/useAudioRecordingCancelUndo.test.js "test/helpers/useAudioRecording*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAudioRecording.js src/hooks/useUndoCancelHotkey.ts src/App.jsx test/helpers/useAudioRecordingCancelUndo.test.js
git commit -m "feat(voice): cancelled, undo, stage and outcome in the dictation lifecycle"
```

---
### Task 8: Pill stage model, footprints and faster entrances

Covers the VO-R1 C state model, VO-Q5, VO-Q12 (timing) and VO-Q18.

**Files:**
- Modify: `src/helpers/voicePillPresentation.js`:
  - `VOICE_PILL_FOOTPRINT` (9–12)
  - `LISTENING_ENTRANCE_TIMING` (21–36)
  - `LIVE_TRANSCRIPT_ENTRANCE_TIMING` (96–107)
  - `getLiveTranscriptEntranceTimeline` (109–123)
  - `resolveVoiceActivityPresentation` (241–260)
  - new `resolvePillStage`, `PILL_OUTCOME_BEAT_MS` and `VOICE_PILL_MAX_WIDTH`
- Modify: `test/helpers/voicePillPresentation.test.js`. Update the ordering test at line 320 and add new tests.

**Interfaces:**
- Produces:

  ```js
  export const VOICE_PILL_FOOTPRINT: {
    idle: {40,40}; recording: {98,36}; transcribing: {144,36}; cleaning: {144,36};
    pasted: {142,36}; cancelled: {150,36}; meeting: {124,36}; meetingInterrupted: {184,36};
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
     pasted: Object.freeze({ width: 142, height: 36 }),
     cancelled: Object.freeze({ width: 150, height: 36 }),
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
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/voicePillPresentation.test.js test/helpers/pillVisibilityHandoff.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/voicePillPresentation.js test/helpers/voicePillPresentation.test.js
git commit -m "feat(voice): pill stage model, no press hold, words-first transcript entrance"
```

---

### Task 9: The Condensation pill: LevelBars, LocalityRing, stage labels and undo

Covers VO-R1 C (pill chrome), VO-Q12 (the beat), the D3 cancelled capsule and caption, FND-R5 adoption on the pill, and §5.1/§5.4 consumption.

**Files:**
- Modify (rewrite): `src/components/dictation/VoicePill.tsx`
- Create: `src/components/dictation/pillLocality.ts`. A pure combiner plus a `usePillLocality` hook.
- Create: `src/components/dictation/PillCaption.tsx`. The layer above the pill; Task 10 renders words into it.
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
  - `VOICE_PILL_FOOTPRINT`, `resolvePillStage` and `PILL_OUTCOME_BEAT_MS` (Task 8);
  - `cancelled`, `undoCancel`, `pauseUndo`, `resumeUndo`, `processingStage` and `outcome` (Task 7);
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
  export function routeProviderLabel(route: ResolvedRoute, t: T): string; // providerDisplayLabel(route.providerId, t), else route.provider (CCR-5)
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

test("provider names go through providerDisplayLabel when the route carries an id (CCR-5)", async () => {
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
  assert.match(running, /class="pill-countdown" style="animation-duration:10000ms"/);
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
 * ResolvedRoute.providerId (CCR-5).
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

`src/components/dictation/PillCaption.tsx`. This is the layer above the pill that holds the D3 copy (and Task 10's words). It lives outside the pill box, so it never clips the bars (D9).

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
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
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
          style={{ animationDuration: `${countdown.durationMs}ms` }}
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
  inset-inline-start: 0;
  max-width: 184px;
  padding: 5px 9px;
  border-radius: 10px;
  background: var(--color-popover);
  color: var(--color-popover-foreground);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-elevated);
  font: 500 12px/1.35 var(--font-family-sans);
  animation: notice-in var(--motion-base) var(--motion-ease-enter) both;
}
.pill-caption[data-direction="left"] {
  inset-inline-start: auto;
  inset-inline-end: 0;
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
  .pill-countdown {
    animation-timing-function: steps(5, end);
  }
```

Check that `draw-check` exists (`grep -n "@keyframes draw-check" src/index.css src/styles/*.css`). If it does not, add `@keyframes draw-check { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }` next to `pill-pop`.

- [ ] **Step 6: Wire `App.jsx`**

1. Add these imports:
   - `resolvePillStage` (same `../helpers/voicePillPresentation` path App already uses);
   - `usePillLocality`, `PillCaption` and `useRecentOutcome`;
   - `dispatchTargetLabel` from `./helpers/remoteDispatch`.

   `useSettingsStore` is already imported. `dispatchTargetLabel` turns the provider id in `cancelled.remoteAlreadySent` into a localised name through `providerDisplayLabel` (Plan 01 review item 1).
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
       meetingRecording: null, // Task 15
       showMeetingRecorder: true, // Task 15
     });
     // Sampled once per cancel episode (null → cancelled), so pause/resume
     // updates never restart the CSS underline; hover pauses it in CSS.
     const undoWindowRef = useRef(null);
     if (!cancelled) undoWindowRef.current = null;
     else if (
       undoWindowRef.current === null &&
       cancelled.undoUntil > 0 &&
       cancelled.undoUntil < Number.MAX_SAFE_INTEGER
     ) {
       undoWindowRef.current = Math.max(0, cancelled.undoUntil - Date.now());
     }
     const undoMs = undoWindowRef.current;
     const stageLabel =
       pillStage === "transcribing" ? t("pill.stage.transcribing")
       : pillStage === "cleaning" ? t("pill.stage.cleaning")
       : pillStage === "pasted" && recentOutcome?.kind === "pasted" ? t("pill.stage.pasted", { count: recentOutcome.words })
       : pillStage === "cancelled" ? (cancelled.undoUntil > 0 ? t("pill.stage.discardedUndo") : t("pill.stage.cancelled"))
       : undefined;
     const pillCaption =
       pillStage === "cancelled" && cancelled.remoteAlreadySent
         ? t(cancelled.remotePayload === "text" ? "pill.caption.remoteText" : "pill.caption.remoteAudio", {
             provider: dispatchTargetLabel(cancelled.remoteAlreadySent, t),
           })
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
       if (cancelled && cancelled.undoUntil > 0) {
         void undoCancel();
         return;
       }
   ```

5. In the pill `onMouseEnter`/`onMouseLeave` (lines 648–659), add `if (cancelled?.undoUntil > 0) pauseUndo();` and `resumeUndo();` respectively. The existing `isHovered` state drives the countdown's `paused` flag.
6. On `<VoicePill …>` (lines 666–739), add these props:

   ```jsx
     label={stageLabel}
     locality={pillLocality}
     countdown={pillStage === "cancelled" && undoMs !== null ? { durationMs: undoMs, paused: isHovered } : null}
   ```

   Change `aria-label` to read the stage when one is active: `aria-label={stageLabel ?? <the existing label>}`.
7. Render the caption as a sibling of the pill inside `div.assistant-pill-presence` (lines 639–660):

   ```jsx
     {pillCaption ? (
       <PillCaption horizontalDirection={voiceHorizontalDirection}>{pillCaption}</PillCaption>
     ) : null}
   ```

8. While the pill shows `cancelled`, it must stay interactive so the click reaches Undo. In the `resolveVoicePillInteraction` call (lines 519–525), pass `isRecording: isRecording || Boolean(cancelled?.undoUntil)`. That makes `pillInteractive` true for the undo window without touching the helper.

- [ ] **Step 7: Locale strings and DESIGN.md**

Add this to `en/translation.json` and mirror it to all 12 locales. For `ar`, `ru`, `ja` and `zh-*`, keep the English text until translated; i18next plural suffixes apply.

```json
"pill": {
  "stage": {
    "transcribing": "Transcribing…",
    "cleaning": "Cleaning up",
    "pasted_one": "Pasted · {{count}} word",
    "pasted_other": "Pasted · {{count}} words",
    "discardedUndo": "Discarded · Undo",
    "cancelled": "Cancelled"
  },
  "caption": {
    "remoteAudio": "{{provider}} already received the audio.",
    "remoteText": "{{provider}} already received the text."
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

In `DESIGN.md` `### Voice Pill`, replace the state description with:
- the stage table from Task 8: footprints, label, ring and timing;
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
### Task 10: Condensation words on their own layer (VO-R1 C, D9)

Live words condense into a row **above** the pill, in the `PillCaption` layer. The bars inside the pill are never covered or clipped. During cleanup, changed words are rewritten with a 600 ms orange underline.

**Files:**
- Create: `src/components/dictation/condensation.ts`
- Create: `src/components/dictation/CondensationWords.tsx`
- Modify: `src/hooks/useAudioRecording.js`. Add `liveText` state: set it in `onPartialTranscript` (line 429), set `cleaned` in `onTranscriptionComplete`, and reset it at start and at idle.
- Modify: `src/App.jsx`. Render the words in the caption layer.
- Modify: `src/styles/dictation-panel.css`
- Test: `test/components/condensation.test.js`

**Interfaces:**
- Consumes `PillCaption` (Task 9) and `pillStage` (Task 9, in App).
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
  return (
    <span className="condense-track" aria-hidden="true">
      {words.map((word) => (
        <span
          key={word.key}
          className={["condense-word", word.changed && "is-changed", !word.committed && "is-partial"]
            .filter(Boolean)
            .join(" ")}
        >
          {word.text}
          {word.committed && !word.changed ? <span className="condense-spark" /> : null}
        </span>
      ))}
    </span>
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
/* The spark: a 2px bar that rises from the pill's bar row into the word's
   slot over 140ms, then fades. */
.condense-spark {
  position: absolute;
  inset-inline-start: 50%;
  bottom: -28px;
  width: 2px;
  height: 14px;
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
    transform: translateY(-24px) scaleY(0.2);
    opacity: 1;
  }
  100% {
    transform: translateY(-24px) scaleY(0.2);
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

- Render the words in the caption slot from Task 9, which now accepts either the D3 copy or the words:

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

### Task 11: Agent Mode violet orbit, without the frame glyph (VO-R8 B)

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
- Consumes `nextLevelBarsFrame`, `LEVEL_BARS_SILENCE_FLOOR`, `LOGO_BAR_SHAPE` and `levelBarScale` (Plan 01, `levelBarsMath.ts`), `routeProviderLabel` (Task 9), `useResolvedRoute("voiceAssistant" | "assistantVision")` (§5.1), the `voiceAgentScreenContext` setting (`settingsStore.ts:1755`), `assistant.thinking` / `assistant.busy` (`useAssistantPanel.js:32-33`), and `PillCaption` (Task 9).
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

### Task 12: Pill tooltip, idle hairline, the fused-halo fix and two Plan 01 leftovers

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
- Consumes `PillLocality.routeLine` (Task 9) and the `activationMode` setting (`"tap" | "push"`, `settingsStore.ts:1467`).
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
- Replace the physical `left-3`/`right-3` in `arrowClass` with `start-3`/`end-3`, and the physical `left-0`/`right-0` in `alignClass` with `start-0`/`end-0` (RTL).

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

`pillLocality` is computed in Task 9. Move that line above this block if needed.

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
  box-shadow: 0 0 0 1px var(--pill-hairline), var(--shadow-card);
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

### Task 13: The soft sound family (VO-R10 A)

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

Create `test/helpers/useAudioRecordingCues.test.js`. It reuses the Task 7 harness pattern, with cues mocked into a log:

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
   - Move `void playStartCue();` from line 215 to directly after `setIsPreparing(true)` in `performStartRecording` (around line 129), so the cue sounds at press time. Delete the old call at 215.
   - Paste success: next to `setOutcome({ kind: "pasted", … })` (Task 7), add `void playSuccessCue();`.
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
### Task 14: Meeting presence relay, tray recording state and the Linux notification (D2)

Meeting capture runs in the control-panel renderer. Main relays a small presence record to the pill window and the tray. On Linux it also shows a persistent notification with a Stop action.

Electron 44 supports `Notification` actions only on macOS and Windows (`electron.d.ts`: `actions` is `@platform darwin,win32`; `timeoutType` is `linux,win32`). So the Linux Stop action goes through the freedesktop notification service via `gdbus`, which ships with GLib on GNOME and KDE. If `gdbus` is missing, it falls back to an Electron notification with `timeoutType: "never"`, and clicking it opens the control panel.

**Files:**
- Create: `src/helpers/meetingPresence.js` (main process, CommonJS like `tray.js`)
- Create: `src/helpers/linuxRecordingNotification.js` (main process)
- Create: `src/helpers/trayRecordingIcon.js` (main process; paints the recording dot)
- Modify: `src/helpers/ipcHandlers.js`. Add `meeting-recording-presence`, `get-meeting-recording-presence` and `request-stop-meeting-recording`.
- Modify: `src/helpers/windowManager.js`. Own the presence instance, broadcast to `mainWindow`, and expose `getMeetingPresence()`.
- Modify: `src/helpers/tray.js`. Add `setMeetingPresence(presence)`, menu items at the top of `buildContextMenuTemplate()` (line 254), the tooltip, and the Linux icon.
- Modify: `main.js:883-889`. Wire `windowManager.onMeetingPresenceChanged` to the tray.
- Modify: `preload.js` and `src/types/electron.ts`:
  - `reportMeetingRecordingPresence`
  - `getMeetingRecordingPresence`
  - `onMeetingRecordingPresenceChanged`
  - `requestStopMeetingRecording`
  - `onMeetingRecordingStopRequested`
- Modify: `src/components/MeetingRecordingMount.tsx`. Report presence, and listen for stop requests.
- Modify: `src/locales/*/translation.json` (`tray.*`, `meetingRecorder.*`)
- Test: `test/helpers/meetingPresence.test.js`
- Test: `test/helpers/linuxRecordingNotification.test.js`

**Interfaces:**
- Produces (CCR-2 shape):

  ```js
  // src/helpers/meetingPresence.js
  normalizePresence(input): { startedAt: number; interruption: "systemAudio" | "mic" | null; quiet: boolean } | null
  createMeetingPresence({ onChange }): { set(ownerId: number, input): void; clearIfOwner(ownerId: number): void; get(): Presence | null }
  buildTrayRecordingItems(presence, { t, now }): Array<{ label: string; enabled?: boolean; action?: "stop" }>
  ```

  ```js
  // src/helpers/linuxRecordingNotification.js
  gvariantString(text): string
  buildNotifyArgs({ title, body, stopLabel }): string[]
  parseNotifyReply(stdout): number | null
  parseSignalLine(line, id): { kind: "action"; action: string } | { kind: "closed" } | null
  class LinuxRecordingNotification { constructor({ onStop, onOpen, execFile?, spawn?, ElectronNotification? }); show({ title, body, stopLabel }): Promise<void>; close(): Promise<void> }
  ```

  ```ts
  // electronAPI
  reportMeetingRecordingPresence(p: { recording: boolean; startedAt?: number; interruption?: "systemAudio" | "mic" | null; quiet?: boolean }): void;
  getMeetingRecordingPresence(): Promise<MeetingPresence | null>;
  onMeetingRecordingPresenceChanged(cb: (p: MeetingPresence | null) => void): () => void;
  requestStopMeetingRecording(): Promise<void>;
  onMeetingRecordingStopRequested(cb: () => void): () => void;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/meetingPresence.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizePresence, createMeetingPresence, buildTrayRecordingItems } = require("../../src/helpers/meetingPresence.js");

test("presence is normalised and rejects junk", () => {
  assert.equal(normalizePresence(null), null);
  assert.equal(normalizePresence({ recording: false, startedAt: 5 }), null);
  assert.equal(normalizePresence({ recording: true, startedAt: "x" }), null);
  assert.deepEqual(normalizePresence({ recording: true, startedAt: 1000, interruption: "nope", quiet: 1 }), {
    startedAt: 1000,
    interruption: null,
    quiet: true,
  });
  assert.deepEqual(normalizePresence({ recording: true, startedAt: 1000, interruption: "systemAudio" }), {
    startedAt: 1000,
    interruption: "systemAudio",
    quiet: false,
  });
});

test("changes are emitted once per real change", () => {
  const seen = [];
  const presence = createMeetingPresence({ onChange: (p) => seen.push(p) });
  presence.set(7, { recording: true, startedAt: 1000 });
  presence.set(7, { recording: true, startedAt: 1000 });
  presence.set(7, { recording: true, startedAt: 1000, quiet: true });
  presence.set(7, { recording: false });
  assert.equal(seen.length, 3);
  assert.equal(seen.at(-1), null);
});

test("presence clears when the owner goes away", () => {
  const seen = [];
  const presence = createMeetingPresence({ onChange: (p) => seen.push(p) });
  presence.set(7, { recording: true, startedAt: 1000 });
  presence.clearIfOwner(8);
  assert.notEqual(presence.get(), null);
  presence.clearIfOwner(7);
  assert.equal(presence.get(), null);
  assert.equal(seen.at(-1), null);
});

test("the tray leads with a recording line and a Stop item while recording", () => {
  const t = (key, opts) => (opts ? `${key}:${opts.elapsed}` : key);
  assert.deepEqual(buildTrayRecordingItems(null, { t, now: 0 }), []);
  assert.deepEqual(buildTrayRecordingItems({ startedAt: 0, interruption: null, quiet: false }, { t, now: 761_000 }), [
    { label: "tray.meetingRecording:12:41", enabled: false },
    { label: "tray.stopMeetingRecording", action: "stop" },
  ]);
  assert.equal(
    buildTrayRecordingItems({ startedAt: 0, interruption: "systemAudio", quiet: false }, { t, now: 0 })[0].label,
    "tray.meetingRecordingSystemLost"
  );
});
```

Create `test/helpers/linuxRecordingNotification.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const {
  gvariantString,
  buildNotifyArgs,
  parseNotifyReply,
  parseSignalLine,
  LinuxRecordingNotification,
} = require("../../src/helpers/linuxRecordingNotification.js");

test("strings are quoted as GVariant literals", () => {
  assert.equal(gvariantString("Loqui"), "'Loqui'");
  assert.equal(gvariantString("it's \\ here"), "'it\\'s \\\\ here'");
});

test("Notify is called with a stop action and a resident hint", () => {
  const args = buildNotifyArgs({ title: "Loqui is recording", body: "Weekly sync", stopLabel: "Stop" });
  assert.deepEqual(args.slice(0, 8), [
    "call", "--session", "--dest", "org.freedesktop.Notifications",
    "--object-path", "/org/freedesktop/Notifications", "--method", "org.freedesktop.Notifications.Notify",
  ]);
  assert.ok(args.includes("['stop', 'Stop']"));
  assert.ok(args.some((a) => a.includes("'resident': <true>")));
  assert.equal(args.at(-1), "0");
});

test("the Notify reply and monitor lines are parsed", () => {
  assert.equal(parseNotifyReply("(uint32 42,)\n"), 42);
  assert.equal(parseNotifyReply("garbage"), null);
  const line = "/org/freedesktop/Notifications: org.freedesktop.Notifications.ActionInvoked (uint32 42, 'stop')";
  assert.deepEqual(parseSignalLine(line, 42), { kind: "action", action: "stop" });
  assert.equal(parseSignalLine(line, 41), null);
  assert.deepEqual(
    parseSignalLine("/org/freedesktop/Notifications: org.freedesktop.Notifications.NotificationClosed (uint32 42, uint32 2)", 42),
    { kind: "closed" }
  );
});

test("Stop in the notification calls onStop; close() closes it and stops monitoring", async () => {
  const calls = [];
  const monitor = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => calls.push("kill") });
  let stopped = 0;
  const n = new LinuxRecordingNotification({
    onStop: () => stopped++,
    onOpen: () => {},
    execFile: (cmd, args, cb) => {
      calls.push(args.includes("org.freedesktop.Notifications.Notify") ? "notify" : "close");
      cb(null, "(uint32 42,)\n", "");
    },
    spawn: () => monitor,
  });
  await n.show({ title: "t", body: "b", stopLabel: "Stop" });
  monitor.stdout.emit("data", Buffer.from("/org/freedesktop/Notifications: org.freedesktop.Notifications.ActionInvoked (uint32 42, 'stop')\n"));
  assert.equal(stopped, 1);
  await n.close();
  assert.deepEqual(calls, ["notify", "close", "kill"]);
});

test("without gdbus it falls back to a never-expiring Electron notification", async () => {
  const shown = [];
  let opened = 0;
  class FakeNotification extends EventEmitter {
    constructor(opts) {
      super();
      shown.push(opts);
    }
    show() {}
    close() {}
  }
  const n = new LinuxRecordingNotification({
    onStop: () => {},
    onOpen: () => opened++,
    execFile: (_c, _a, cb) => cb(Object.assign(new Error("not found"), { code: "ENOENT" })),
    spawn: () => {
      throw new Error("unused");
    },
    ElectronNotification: FakeNotification,
  });
  await n.show({ title: "t", body: "b", stopLabel: "Stop" });
  assert.equal(shown[0].timeoutType, "never");
  n._fallback.emit("click");
  assert.equal(opened, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/meetingPresence.test.js test/helpers/linuxRecordingNotification.test.js`
Expected: FAIL with `Cannot find module '…/meetingPresence.js'`.

- [ ] **Step 3: Implement the pure modules**

`src/helpers/meetingPresence.js`:

```js
// D2: the pill window is the ambient meeting recorder. Meeting capture runs in
// the control-panel renderer, so main relays this small record to the pill
// and the tray, and clears it if that renderer goes away.
const INTERRUPTIONS = new Set(["systemAudio", "mic"]);

function normalizePresence(input) {
  if (!input || input.recording === false) return null;
  const startedAt = Number(input.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  return {
    startedAt,
    interruption: INTERRUPTIONS.has(input.interruption) ? input.interruption : null,
    quiet: Boolean(input.quiet),
  };
}

const same = (a, b) =>
  a === b ||
  (a && b && a.startedAt === b.startedAt && a.interruption === b.interruption && a.quiet === b.quiet);

function createMeetingPresence({ onChange }) {
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
      if (ownerId !== null && ownerId === owner) commit(null, null);
    },
    get: () => state,
  };
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
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

`src/helpers/linuxRecordingNotification.js`:

```js
const childProcess = require("child_process");

// Electron's Notification has no actions on Linux (electron.d.ts: actions is
// darwin,win32). The freedesktop service does, so we speak to it with gdbus.
const DEST = ["--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications"];

function gvariantString(text) {
  return `'${String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function buildNotifyArgs({ title, body, stopLabel }) {
  return [
    "call", "--session", ...DEST, "--method", "org.freedesktop.Notifications.Notify",
    gvariantString("Loqui"), "0", gvariantString("media-record"), gvariantString(title), gvariantString(body),
    `['stop', ${gvariantString(stopLabel)}]`,
    "{'resident': <true>, 'urgency': <byte 1>, 'category': <'device'>}",
    "0",
  ];
}

function parseNotifyReply(stdout) {
  const match = /uint32 (\d+)/.exec(String(stdout));
  return match ? Number(match[1]) : null;
}

function parseSignalLine(line, id) {
  const action = /ActionInvoked \(uint32 (\d+), '([^']*)'\)/.exec(line);
  if (action && Number(action[1]) === id) return { kind: "action", action: action[2] };
  const closed = /NotificationClosed \(uint32 (\d+),/.exec(line);
  if (closed && Number(closed[1]) === id) return { kind: "closed" };
  return null;
}

class LinuxRecordingNotification {
  constructor({ onStop, onOpen, execFile = childProcess.execFile, spawn = childProcess.spawn, ElectronNotification } = {}) {
    this.onStop = onStop;
    this.onOpen = onOpen;
    this.execFile = execFile;
    this.spawn = spawn;
    this.ElectronNotification = ElectronNotification ?? require("electron").Notification;
    this.id = null;
    this.monitor = null;
    this._fallback = null;
  }

  _exec(args) {
    return new Promise((resolve, reject) => {
      this.execFile("gdbus", args, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    });
  }

  async show({ title, body, stopLabel }) {
    await this.close();
    try {
      this.id = parseNotifyReply(await this._exec(buildNotifyArgs({ title, body, stopLabel })));
    } catch {
      this.id = null;
    }
    if (this.id === null) {
      this._fallback = new this.ElectronNotification({ title, body, timeoutType: "never", silent: true });
      this._fallback.on("click", () => this.onOpen?.());
      this._fallback.show();
      return;
    }
    this.monitor = this.spawn("gdbus", ["monitor", "--session", ...DEST]);
    let buffer = "";
    this.monitor.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const signal = parseSignalLine(line, this.id);
        if (signal?.kind === "action" && signal.action === "stop") this.onStop?.();
        if (signal?.kind === "action" && signal.action === "default") this.onOpen?.();
      }
    });
    this.monitor.on?.("error", () => {});
  }

  async close() {
    if (this.id !== null) {
      const id = this.id;
      this.id = null;
      await this._exec(["call", "--session", ...DEST, "--method", "org.freedesktop.Notifications.CloseNotification", String(id)]).catch(() => {});
    }
    if (this.monitor) {
      this.monitor.kill();
      this.monitor = null;
    }
    if (this._fallback) {
      this._fallback.close();
      this._fallback = null;
    }
  }
}

module.exports = { gvariantString, buildNotifyArgs, parseNotifyReply, parseSignalLine, LinuxRecordingNotification };
```

- [ ] **Step 4: Wire main, tray and preload**

1. `src/helpers/trayRecordingIcon.js` paints a 30%-radius dot in Signal orange (`#FF5A1F`) at the bottom-right of a copy of the tray icon. On Linux, `tray.js` uses that copy while recording. The paint step is pure, so a unit test covers it.

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
         out[i] = 0x1f; // B
         out[i + 1] = 0x5a; // G
         out[i + 2] = 0xff; // R
         out[i + 3] = 0xff; // A
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

   Add this test to `test/helpers/meetingPresence.test.js`. It needs the electron stub: `require("./harness/electronStub").installElectronStub()` before the `require` (see `test/helpers/harness/electronStub.js` for the call shape).

   ```js
   test("the recording dot lands in the bottom-right corner in Signal orange", () => {
     const { paintRecordingDot } = require("../../src/helpers/trayRecordingIcon.js");
     const out = paintRecordingDot(Buffer.alloc(16 * 16 * 4), 16, 16);
     const px = (x, y) => [...out.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
     assert.deepEqual(px(12, 12), [0x1f, 0x5a, 0xff, 0xff]);
     assert.deepEqual(px(1, 1), [0, 0, 0, 0]);
   });
   ```

2. `windowManager.js`:
   - In the constructor (lines 48–108), add `this.meetingPresence = createMeetingPresence({ onChange: (p) => this._onMeetingPresenceChanged(p) }); this.onMeetingPresenceChanged = null;`.
   - Add these methods:

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

       requestStopMeetingRecording() {
         this.sendToControlPanel("meeting-recording-stop-requested");
       }
     ```

3. `ipcHandlers.js`. Add these next to the `meeting-transcription-*` handlers (around line 7700):

   ```js
       ipcMain.on("meeting-recording-presence", (event, payload) => {
         const panel = this.windowManager.controlPanelWindow;
         if (!panel || event.sender !== panel.webContents) return;
         const owner = event.sender.id;
         this.windowManager.meetingPresence.set(owner, payload);
         if (!event.sender.__loquiPresenceWatch) {
           event.sender.__loquiPresenceWatch = true;
           const clear = () => this.windowManager.meetingPresence.clearIfOwner(owner);
           event.sender.once("destroyed", clear);
           event.sender.on("render-process-gone", clear);
           event.sender.on("did-start-navigation", (_e, _url, isInPlace, isMainFrame) => {
             if (isMainFrame && !isInPlace) clear();
           });
         }
       });

       ipcMain.handle("get-meeting-recording-presence", () => this.windowManager.getMeetingPresence());

       ipcMain.handle("request-stop-meeting-recording", () => {
         this.windowManager.requestStopMeetingRecording();
       });
   ```

4. `tray.js`:
   - In the constructor, add `this.meetingPresence = null; this.linuxNotification = null; this.baseIcon = null;`. Store the loaded icon in `createTray()` (line 141) as `this.baseIcon`.
   - Add:

     ```js
       setMeetingPresence(presence) {
         const was = this.meetingPresence;
         this.meetingPresence = presence;
         if (process.platform === "linux" && this.tray && this.baseIcon) {
           this.tray.setImage(presence ? createRecordingTrayIcon(this.baseIcon) : this.baseIcon);
         }
         if (process.platform === "linux") {
           this.linuxNotification ??= new LinuxRecordingNotification({
             onStop: () => this.windowManager?.requestStopMeetingRecording(),
             onOpen: () => this.showControlPanelFromTray(),
           });
           if (presence && !was) {
             void this.linuxNotification.show({
               title: i18nMain.t("meetingRecorder.notificationTitle"),
               body: i18nMain.t("meetingRecorder.notificationBody"),
               stopLabel: i18nMain.t("meetingRecorder.stop"),
             });
           } else if (!presence && was) {
             void this.linuxNotification.close();
           }
         }
         this.updateTrayMenu();
       }
     ```

   - In `buildContextMenuTemplate()` (line 254), prepend the recording items, followed by a separator when there are any:

     ```js
         const recording = buildTrayRecordingItems(this.meetingPresence, { t: (k, o) => i18nMain.t(k, o) }).map((item) =>
           item.action === "stop"
             ? { label: item.label, click: () => this.windowManager?.requestStopMeetingRecording() }
             : { label: item.label, enabled: false }
         );
         const lead = recording.length ? [...recording, { type: "separator" }] : [];
     ```

     Return `[...lead, ...<existing items>]`.
   - In `updateTrayMenu()` (line 312), set the tooltip to `i18nMain.t(this.meetingPresence ? "tray.tooltipRecording" : "tray.tooltip")`.
5. `main.js:887`. Next to `windowManager.onDictationStateChanged = …`, add `windowManager.onMeetingPresenceChanged = (p) => trayManager.setMeetingPresence(p);`.
6. `preload.js`:

   ```js
     reportMeetingRecordingPresence: (payload) => ipcRenderer.send("meeting-recording-presence", payload),
     getMeetingRecordingPresence: () => ipcRenderer.invoke("get-meeting-recording-presence"),
     onMeetingRecordingPresenceChanged: registerListener("meeting-recording-presence-changed", (cb) => (_e, p) => cb(p)),
     requestStopMeetingRecording: () => ipcRenderer.invoke("request-stop-meeting-recording"),
     onMeetingRecordingStopRequested: registerListener("meeting-recording-stop-requested", (cb) => () => cb()),
   ```

   Add matching optional types to `electron.ts`, near the meeting APIs (lines 2278–2289). Add `export type MeetingPresence = { startedAt: number; interruption: "systemAudio" | "mic" | null; quiet: boolean };`.
7. `MeetingRecordingMount.tsx` (control panel):

   ```tsx
     const recordingStartedAt = useMeetingRecordingStore((s) => s.recordingStartedAt);
     useEffect(() => {
       window.electronAPI?.reportMeetingRecordingPresence?.({
         recording: isRecording,
         startedAt: recordingStartedAt ?? undefined,
         interruption: systemAudioInterrupted ? "systemAudio" : micCaptureStatus === "unavailable" ? "mic" : null,
         quiet: false, // Task 17 derives this from the mic level
       });
     }, [isRecording, recordingStartedAt, systemAudioInterrupted, micCaptureStatus]);

     useEffect(
       () => window.electronAPI?.onMeetingRecordingStopRequested?.(() => void stopRecording()),
       []
     );
   ```

   `stopRecording` is exported from `src/stores/meetingRecordingStore.ts`. Confirm its call signature (`grep -n "export.*stopRecording" src/stores/meetingRecordingStore.ts`).

Locale keys (`en`, mirrored to all 12; the main process reads them through `i18nMain`):

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
  "stop": "Stop"
}
```

Merge the `tray` keys into the existing `tray` object (`translation.json:60-68`).

The notification body says only how to stop. It deliberately makes no claim about where meeting audio goes, because the meeting transcription route can be remote. Locality is disclosed where the route is shown (Plan 03's switchboard, and the meeting note).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/helpers/meetingPresence.test.js test/helpers/linuxRecordingNotification.test.js test/helpers/trayQuickActions.test.js test/helpers/trayActionPolicy.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/helpers/meetingPresence.js src/helpers/linuxRecordingNotification.js src/helpers/trayRecordingIcon.js src/helpers/windowManager.js src/helpers/ipcHandlers.js src/helpers/tray.js main.js preload.js src/types/electron.ts src/components/MeetingRecordingMount.tsx src/locales test/helpers/meetingPresence.test.js test/helpers/linuxRecordingNotification.test.js
git commit -m "feat(meeting): relay recording presence to the pill and tray; Linux stop notification"
```

---

### Task 15: The recorder capsule as a pill state (VO-R12 A per D2)

**Files:**
- Create: `src/hooks/useMeetingRecordingPresence.ts`
- Create: `src/components/dictation/MeetingCapsule.tsx`
- Modify: `src/hooks/useAudioRecording.js`. Return `meetingRecording` (§5.2).
- Modify: `src/components/dictation/VoicePill.tsx`. Treat `meeting` as a labelled state, add a `meetingInterrupted` prop, and use `role="group"`.
- Modify: `src/App.jsx`:
  - feed `resolvePillStage` the real presence and setting (Task 9 left placeholders);
  - auto-hide (lines 403–434);
  - the saved receipt.
- Modify: `src/stores/settingsStore.ts`, `src/hooks/useSettings.ts` and `src/components/SettingsPage.tsx`. Add `showMeetingRecorderOnScreen`, default `true`.
- Modify: `src/styles/dictation-panel.css`
- Modify: `src/locales/*/translation.json`
- Modify: `DESIGN.md` `### Voice Pill`. Add the meeting recorder.
- Test: `test/components/meetingCapsule.test.js`

**Interfaces:**
- Consumes the Task 14 IPC and `VOICE_PILL_FOOTPRINT.meeting` / `.meetingInterrupted` (Task 8).
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
    presence: { startedAt: 1_000, interruption: null, quiet: false },
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
  const lost = renderStatic(MeetingCapsule, { presence: { startedAt: 1, interruption: "systemAudio", quiet: false }, now: 2, onStop() {} });
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
import type { MeetingPresence } from "../types/electron";

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
import type { MeetingPresence } from "../../types/electron";
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
  - `label={<MeetingCapsule presence={meetingRecording} now={meetingNow} onStop={() => void window.electronAPI?.requestStopMeetingRecording?.()} />}`
  - `meetingInterrupted={Boolean(meetingRecording.interruption)}`
  - `role="group"`
  - `aria-label={t("meetingRecorder.groupAria")}`

  A click on the pill body still starts dictation ("dictation still works from it", D2). The Stop button stops propagation.
- In the auto-hide effect (lines 403–434), add `!meetingRecorderVisible &&` to the hide condition. Add a branch so a hidden pill shows itself when a meeting starts:

  ```js
      } else if (meetingRecorderVisible && floatingIconAutoHide) {
        window.electronAPI?.showDictationPanel?.();
  ```

  Add `meetingRecorderVisible` to the dependency list.
- Saved receipt (the R12 A "stopped" state). When `meetingRecording` goes from non-null to null, compute the elapsed time from the previous `startedAt` and call `notify({ kind: "receipt", title: t("meetingRecorder.saved", { elapsed }) })`. Track the previous value in a ref.

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
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-warning) 55%, transparent), var(--shadow-card);
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

### Task 16: Notch-drop meeting prompt (VO-R11 B, VO-Q10)

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
  const { default: MeetingNotificationCard } = await import("../../src/components/MeetingNotificationCard.tsx");
  const mini = renderStatic(MeetingNotificationCard, {
    title: "Meeting detected", body: "Zoom call detected on this Mac.", startLabel: "Take notes",
    phase: "mini", hotkeyLabel: "⌥⌘M", miniLabel: "Meeting? Start notes",
  });
  assert.match(mini, /data-phase="mini"/);
  assert.match(mini, /Meeting\? Start notes/);
  assert.match(mini, /<kbd[^>]*>⌥⌘M<\/kbd>/);
  const card = renderStatic(MeetingNotificationCard, { title: "Meeting detected", body: "b", startLabel: "Take notes", privacyLine: "Detected locally. Nothing recorded yet." });
  assert.match(card, /Detected locally\. Nothing recorded yet\./);
  // Plan 01 review item 3: no tinted tile doubling the orange mark.
  assert.doesNotMatch(card, /bg-primary\/10/);
  assert.match(card, /aria-label="[^"]+"[^>]*class="meeting-card__close/);
  assert.doesNotMatch(card, /pointer-events-none/);
});

test("the card drops from the top with the settle spring; the legacy blue mark is gone", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/styles/notices.css"), "utf8");
  assert.match(css, /\.meeting-drop\s*\{[^}]*animation:\s*meeting-drop 520ms var\(--motion-spring-settle\)/);
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
  assert.match(block, /registerSlot\("meetingAccept"/);
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
   - Make it `async`.
   - Replace lines 2046–2047 with:

     ```js
         const display = await this._resolveActiveDisplay();
         const position = WindowPositionUtil.getNotchDropPosition(display);
     ```

     `_resolveActiveDisplay(targetPidPromise)` (line 1469) falls back to the display under the cursor when no pid is given.
   - Before the window is created, register the accept hotkey:

     ```js
         const accelerator = "CommandOrControl+Alt+M";
         const registered = await this.hotkeyManager
           .registerSlot("meetingAccept", accelerator, () =>
             this.meetingDetectionEngine?.handleNotificationResponse(promptData.detectionId, "start")
           )
           .then((r) => r?.success !== false)
           .catch(() => false);
         promptData = {
           ...promptData,
           acceptHotkeyLabel: registered ? (process.platform === "darwin" ? "⌥⌘M" : "Ctrl+Alt+M") : null,
         };
     ```

     `promptData` is a parameter. Rebind it with `let` or use a new `const data` and send `data` at line 2114.
   - In `dismissMeetingNotification` (line 2144), add `this.hotkeyManager?.unregisterSlot("meetingAccept");`.
   - Callers of `showMeetingNotification` (`meetingDetectionEngine.js:421`) can stay fire-and-forget.
3. **`meetingDetectionEngine.js:421-428`.** Add `appName: data?.appName ?? null,` to the object passed to `showMeetingNotification`.
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
     animation: meeting-drop 520ms var(--motion-spring-settle) both;
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
   "bodyApp": "{{app}} call detected on this Mac.",
   "privacy": "Detected locally. Nothing recorded yet.",
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

### Task 17: One meter everywhere, a calm mic loop and a token diarization palette

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
- Also consumes `resolveTokens` and `contrastRatio` (Plan 01 Task 2), and `reportMeetingRecordingPresence` (Task 14).
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
      for (const bg of ["--color-background", "--color-surface-1"]) {
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
5. **`MeetingRecordingMount.tsx`.** Replace the effect at lines 195–229:

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
   - In the Task 14 presence effect, change `quiet: false` to `quiet: micQuiet` (select it from the store) and add it to the dependencies.
6. **`ChatInput.tsx:150-154`.** Use `<LevelBars readLevel={voice.readLevel} height={16} className="flex-1 justify-center overflow-hidden" />` and swap the import.
7. Delete `LiveWaveform.tsx`, `liveWaveformMath.ts` and `test/components/liveWaveform.test.js` **only if** this returns nothing:

   ```bash
   grep -rn "LiveWaveform\|liveWaveformMath" src test --include=*.ts --include=*.tsx --include=*.js --include=*.jsx
   ```

   If anything else still imports them (for example, a Plan 05 branch merged first), leave the files and the test in place, and note it in the PR description.
8. **`index.css`.**
   - Delete `@keyframes ow-wave` and its comment (lines 1515–1524).
   - Add the speaker tokens. These are Tailwind-registered in `@theme`, so `text-speaker-N` and `border-s-speaker-N` work. Hue angles 65–260 in OKLCH avoid the orange, magenta, red and violet bands. Each value is the lightest (light theme) or darkest (Plum Night) hex at 4.6:1 or better on its background.

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
     --color-speaker-1: #a97847;
     --color-speaker-2: #9c7f3f;
     --color-speaker-3: #748a4c;
     --color-speaker-4: #568f62;
     --color-speaker-5: #3e9177;
     --color-speaker-6: #2a9090;
     --color-speaker-7: #458aaf;
     --color-speaker-8: #6383b9;
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
### Task 18: Whole-plan verification

**Files:** none new. This task runs every check and fixes what they surface.

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
grep -rnE "cubic-bezier\(\s*0\.4\s*,\s*0\s*,\s*1\s*,\s*1\s*\)" src && echo "ease-in exit found" || true
```

Expected: everything passes and the grep prints nothing.

A pre-existing test that fails because it asserts something this plan intentionally changed must be updated in this branch. Name it in the PR description. These are the intentional changes:
- the 260 ms press hold;
- the 1.9 s transcript entrance;
- toasts;
- `DictationErrorCard`;
- `PillWaveform`;
- the Agent beam;
- the blue meeting prompt position;
- `LiveWaveform`.

Any other failure is a regression; fix the code.

- [ ] **Step 2: Visual verification in the desktop app (light and Plum Night)**

```bash
npm run native:electron
npm run dev
```

Check each item, screenshot each one, and attach them to the PR.

1. **Press and listen.** Hold the hotkey. The soft start cue sounds at once. The pill grows to the 98 px capsule with orange `LevelBars` about 300 ms after the press.
   - With a streaming provider, words condense into the row **above** the pill, and the bars are never covered.
2. **Stages.**
   - After release: "Transcribing…" with an all-orange comet.
   - If cleanup is on: "Cleaning up" with an orange-to-magenta comet.
   - Then "Pasted · N words" with a green edge and the drawn check for 700 ms.
   - The success tick sounds.
3. **Locality ring.**
   - With local STT and cleanup off, the ring is solid green.
   - Switch cleanup to a remote provider: the ring is dashed with the provider monogram, and it orbits while processing.
   - The tooltip reads "Hold ⌥Space to talk" (push) or "Press ⌥Space to start" (tap), with the route line under it at 12 px.
4. **Cancel and undo.**
   - Cancel mid-recording with Esc: "Discarded · Undo" with a shrinking underline.
   - Hover: the underline freezes. Press ⌥Z: it restores and transcribes.
   - Cancel during processing with a remote STT: the caption reads "OpenAI already received the audio."
   - Let a window expire, then confirm ⌥Z types normally again.
   - With a streaming provider, cancel shows "Cancelled" with the caption and no Undo.
5. **Words-first card.** Force a paste failure, for example by focusing a non-text window with accessibility skipped.
   - The pill stays visible with a red edge and one nudge.
   - The card shows the words, which can be dragged into a text field.
   - ⌥↵ pastes again.
   - The card does not time out.
6. **Notices.**
   - Disconnect the mic mid-dictation: an amber "Microphone disconnected" chip appears. Reconnect: "Microphone back" and the mic-back cue.
   - Break cleanup (a bad key): "Pasted without cleanup" with Retry cleanup and Settings.
   - Retry cleanup copies the cleaned text and leaves a receipt.
7. **Agent Mode.**
   - Agent listening is a 40 px circle with violet radial ticks.
   - Agent thinking is a 2.4 s orbit with two satellites.
   - On the first token, it spins up and dissolves.
   - With screen context on, the caption names where the screenshot goes.
   - No frame glyph appears anywhere.
8. **Meeting.**
   - Start a meeting recording: the pill becomes the capsule (dot, mm:ss, Stop) even with the control panel hidden.
   - Dictation still works from the pill, and the capsule returns afterwards.
   - Turn off "Show meeting recorder on screen": the pill stays idle.
   - Stop from the pill: "Meeting saved · mm:ss".
9. **Meeting prompt.**
   - With two displays, open Zoom on the secondary. The prompt drops from the top centre of **that** display.
   - It reads "Zoom call detected on this Mac. Detected locally. Nothing recorded yet."
   - After 8 s it folds to "Meeting? Start notes ⌥⌘M", and ⌥⌘M accepts.
10. **Linux (desktop-omarchy, see `~/.agents/ssh-access.md`).**
    - During a meeting, the tray icon shows the orange dot, and the menu leads with "Recording meeting · m:ss" and "Stop meeting recording".
    - A persistent notification has Stop, and Stop ends the recording.
    - Then uninstall or rename `gdbus` and confirm the fallback notification never expires and opens the control panel.
11. **Reduced motion** (System Settings → Accessibility → Reduce motion):
    - no orbit, spark, spring or nudge;
    - the meters still update;
    - the countdown steps in fifths;
    - every state is still readable from its label and ring shape.
12. **RTL** (Arabic): chips and captions sit on the inline side, the countdown shrinks toward the start, and the tooltip arrow mirrors.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(voice): verification fixes for the voice overlay plan"
```

---

### Task 19: Contract update and PR preparation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md` §5.2 and §5.3. Do this **only after the owner approves the contract change requests** at the top of this plan.

- [ ] **Step 1: Apply the approved CCRs to the spec**

Plan 04 owns §5.2 and §5.3. For each approved CCR, update the spec text to the shape this plan shipped:
- `cancelled` with `remotePayload` and the `undoUntil: 0` sentinel;
- `meetingRecording` with `interruption` and `quiet`;
- `processingStage` and `outcome`;
- the `notify()` additions and `dismissNotice`/`useNotices`.

If a CCR was rejected, change the code to the spec's shape before this step.

- [ ] **Step 2: Prepare the PR body (do not push yet)**

Write `pr-body.md` with:
- one line per Task 1–17 commit;
- links to the spec and this plan;
- the Task 18 screenshots;
- every pre-existing test intentionally updated (Task 18 Step 1);
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
| VO-R1 C Condensation, with words outside the bars (D9) | 8, 9, 10 |
| VO-R6 B words-first card | 2, 3 |
| D3 cancel flow:<br>- instant cancel;<br>- 5 s / 10 s window;<br>- hover pause;<br>- ⌥Z or click;<br>- RAM-only, zeroed;<br>- Esc armed until idle;<br>- "already received" copy;<br>- PRIVACY.md | 5, 6, 7, 9 |
| VO-R8 B violet orbit, no frame glyph | 11 |
| VO-R10 A soft family | 13 |
| VO-R11 B notch drop | 16 |
| VO-R12 A recorder capsule as a pill state (D2), Linux tray and notification, on-screen setting | 14, 15 |
| VO-R14 B pill-anchored chips | 1, 2 |
| §5.3 `notify()` and migrating every toast | 1, 2, 3, 4 |
| §5.2 lifecycle additions | 5, 6, 7, 15 |
| §5.1 `useResolvedRoute` for the pill ring and tooltip | 9, 11, 12 |
| §5.4 Sealed mode shows a blocked ring | 9 |
| LevelBars on every voice surface | 9, 17 |
| VO-Q5 | 8 |
| VO-Q7 | 3 |
| VO-Q10 | 16 |
| VO-Q11 | 17 |
| VO-Q12 | 8, 9 |
| VO-Q13 | 17 |
| VO-Q14 | 12 |
| VO-Q15 | 17 |
| VO-Q18 | 8 |
| VO-Q19 | 12 |
| VO-Q20 | 12 |
| VO-Q21 | 3 |
| DESIGN.md sections (D10) | 2, 9, 11, 15 |
