# Loqui UI/UX Plan 05 — Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild first-run setup so a new user hears their own words on screen before they make any optional decision. It covers:
- two phases: "Get dictating" (Hello, Voice, Say something) and "Make it yours" (Cleanup, Shortcut), then an honest Ready summary;
- the orange rail becomes the instrument: the five bars of the mark breathe, fill with the download, follow the voice, and dock into the header on success;
- the voice is detected from hardware and OS locale only (D8);
- the download runs in the background with real progress, speed, ETA and cancel, and the user meets Loqui in the meantime;
- the trial uses the real global shortcut, with a button fallback;
- cleanup is chosen by seeing the user's own sentence before and after;
- the shortcut step has a live keycap that detects tap versus hold;
- the resume card and "Resume setup" work in-app, with no reload;
- the browser preview simulates every new state.

**Architecture:**
- Navigation, voice detection, trial state, download state, readiness and cleanup diffs are pure TypeScript modules under `src/utils/onboarding*.ts`, tested with `node:test`.
- Thin React components live under `src/components/onboarding/`. `OnboardingFlow.tsx` shrinks to an orchestrator.
- The trial and the shortcut tester run through the existing onboarding demo bridge, extended. Main forwards real hotkey presses to the control panel. The overlay window records, and it always runs in trial mode until setup completes, so nothing is pasted or saved.
- The browser preview fakes the same bridge from `src/preview/onboardingScenarioBridge.ts`, so production components contain no preview branches.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4 tokens from Plan 01, Electron 44 IPC (`preload.js`, `src/helpers/ipcHandlers.js`, `src/helpers/windowManager.js`), Node `node:test` with `tsx`. Component tests use the Vite renderer harness (`test/lib/rendererTestHarness.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`: decisions D1, D8 and D10, §4, §5.1–§5.3, and the Plan 05 row. Read it alongside this plan.
- Visual acceptance reference: `design-explorations/loqui-uiux-review.html#ch-onboarding`, using the picked variant card for each recommendation. The source is `design-explorations/loqui-uiux-review/parts/02-onboarding.html`.
- Evidence: `.omc/research/ui-review/audit-onboarding.md` and `screens/onboarding/*`.
- Those three live untracked in the sibling worktree `/Users/snow/.t3/worktrees/loqui/t3-5038e8e6/`.

**Upstream interfaces this plan codes against:**
- **Plan 01:** `--motion-*` tokens, `--color-cta*`, `--color-live*`, `--color-locality-*`, `Button variant="live"`, `LevelBars` / `levelBarsMath.ts`, `LocalityRing`, `src/lib/locality.ts`, `src/utils/contrast.ts`, `test/helpers/harness/cssTokens.js`.
- **Plan 03:** `src/lib/routes.ts` (§5.1).
- **Plan 04:** the `cancelled` dictation state (§5.2) and `notify` (§5.3), which may land after this plan. See Task 7 and Task 15.
- **Plan 02:** ONB-Q1 (the pinned shell and the 84px macOS header inset) and ONB-Q2 (`useModelDownload` wired into the speech step, with Cancel and a footer chip). This plan replaces the components Plan 02 touched. It keeps both behaviours and pins them with tests (Task 11 and Task 7).

## Contract change requests

Only the owning plan may change a §5 contract. These are requests to the owners. Each one says what this plan does until the request is answered.

1. **§5.2, owner Plan 04: publish `cancelled` to the onboarding demo channel, and accept an undo from main.**
   - Today the trial records in the overlay window. The control panel learns its state only from `onboarding-demo-event` (`src/helpers/ipcHandlers.js:1059-1079`).
   - Request: when `useAudioRecording` enters `cancelled`, call `onDemoEventRef.current?.({ kind: demoKindRef.current, status: "cancelled", undoUntil, remoteAlreadySent })`. When `undoCancel()` restores the recording, emit the existing `processing` event.
   - Request: expose `windowManager.sendUndoCancelDictation()`. It sends a channel the overlay maps to `undoCancel()`.
   - What this plan does now:
     - Task 4 allowlists the `cancelled` status, sanitizes `undoUntil` and `remoteAlreadySent`, and adds `onboarding-demo-undo-cancel`. That handler calls `windowManager.sendUndoCancelDictation?.()` and returns `false` while the method is missing.
     - Task 15 shows "Discarded · Undo" when a `cancelled` event arrives. It hides Undo after a `false` result.
     - Until Plan 04 merges, cancelling returns the trial to idle.
2. **§5.1, owner Plan 03: re-resolve readiness after a local model download or a saved key, without a remount.**
   - The Ready step reads `useResolvedRoute("dictationStt")` while the voice may still be downloading, and it must flip to `ready` the moment the download finishes.
   - Request: `useResolvedRoutes()` re-reads its main-process facts on the existing `LOCAL_MODELS_CHANGED_EVENT` (`"openwhispr-local-models-changed"`, `src/hooks/useModelDownload.ts:21`) and on `"api-key-changed"` (`src/stores/settingsStore.ts:1351`).
   - What this plan does now: Task 18 also passes the live download state into `summarizeReadiness`, which treats a finished download as `ready` even if the route has not caught up.
3. **§3 roadmap, owner: spec: add the edge `02 → 05`.**
   - ONB-Q1 and ONB-Q2 ship in Plan 02, and this plan replaces the files they touch (`onboarding-welcome.css`, `OnboardingFlow.tsx` SpeechStep).
   - If 05 runs before 02 merges, the two collide.
   - What this plan does now: the pre-flight stops when Plan 02 has not merged.
4. **Plan 01 `LevelBars`, owner Plan 01. Optional; it does not block this plan.**
   - Request: add `tone?: "brand" | "onLive"` so bars can be paper-coloured on the light orange rail.
   - `LevelBars` paints its gradient in an inline style (Plan 01 Task 8).
   - What this plan does now: Task 11 overrides it with one scoped `!important` rule in `src/styles/onboarding.css`, with a comment pointing here.

## Owner decisions (2026-10-14)

The owner answered the plan's open questions. The plan is written to these answers.

1. **R5 C and R7 B overlap: accepted.**
   - Phase 1 "Say something" is the hotkey-first trial (R5 C, 96px keycap).
   - Phase 2 "Shortcut" is the R7 B tester. There the user changes the key, sees tap versus hold detected, and sets auto-paste and Accessibility.
2. **The two Welcome toggles move to Ready as "Privacy defaults": accepted.** Both keep their current defaults (history on, automatic updates on). "Start using Loqui" on the success band goes to Ready, so everyone sees them.
3. **"Download stopped at 42%. Your progress is kept." (ONB-Q17): fix it so it is true.** Task 7 makes the download keep its partial file on network failures:
   - Today `downloadFile` deletes the `.tmp` file on cancel and on terminal failure (`src/helpers/downloadUtils.js:328-343`). After the fix, a network-class failure keeps it, and main reports `keptBytes`. Retry then resumes with a `Range` request through the existing resume path (`downloadUtils.js:274-283`).
   - Setup says "Your progress is kept" only when main reports kept bytes. Otherwise it says "Retry starts it again."
   - Cancel still deletes the partial file, because cancelling is deliberate. Stale `.tmp` files are still swept after 24 hours (`downloadUtils.js:15, 399-412`).
4. **"Say something to confirm" is dropped (D8): accepted.** The line is "We picked English because your Mac is set to English." followed by "Not right? Choose yourself".
5. **Motion tokens replace the showcase timings: accepted.**
   - The dock uses `--motion-slow` (360ms) instead of 420ms.
   - The keycap press uses `--motion-instant` (90ms) instead of 80ms.
   - The success band uses `--motion-base` (240ms) instead of 220ms.
6. **Hello gets a microphone picker: fix.**
   - The settings store already has the setters: `setMicrophoneSelectionMode(mode)` and `setSelectedMicDevice(deviceId, label)` (`src/stores/settingsStore.ts:1081-1082, 2161-2176`). This plan's first draft missed them.
   - Task 12 adds the picker. The Hello meter listens to the picked device, and the picker is highlighted when Hello hears nothing for 2.5 s.
   - The trial's "nothing heard" recovery offers "Change microphone" (Task 15).
7. **Inline download of the local cleanup model (R6 A) is out of scope: accepted.** Cleanup's Local option points to Settings → Language Models, and Ready lists it as pending.

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md).
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure.
- Nothing typed during setup is pasted into another app, copied to the clipboard or saved to history. This is the existing promise in `useAudioRecording.js:528-536`, and this plan extends it to the global-shortcut path.
- No provider request is made from the cleanup preview before the user has connected that provider (R6 B: "Example text until you connect. Nothing was sent.").
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night. `--color-success` (#16a34a) and `--color-warning` (#d97706) are icon colours only. On white they are about 3.2:1, which is too low for text.
- Never put white text on `#FF5A1F`. Per D1, primaries are the default ink capsule. `variant="live"` is only for the record/stop toggle, "Allow microphone", the ready-block mic and "Dictate into a note".
- Motion uses the `--motion-*` tokens only. Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms, following the policy block in `src/index.css`. Progress is never motion-only: a number or a word always accompanies it.
- Every visible string goes through i18n under the new top-level key `setupFlow` in all 11 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`). Plan 01 says 12 locales, but `src/locales/` has 11. `npm run i18n:check` passes.
- RTL: use logical properties (`ms-`/`me-`, `inset-inline-*`, `padding-inline-*`). Arrow keys in radio groups follow the reading direction.
- Tests run under Node `node:test` via `npm test` (`scripts/run-tests.js`). Run `npm run native:node` before tests and `npm run native:electron` before launching the desktop app. Never use personal profiles in tests.
- Node: `~/.nvm/versions/node/v24.21.0/bin` (`.node-version` is 24.21.0).
- Before a PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check`.
- `DESIGN.md` is the source of truth (D10). Task 11 updates the onboarding title and adds an "Onboarding" section in the same commit.

## Review Focus

1. **The real shortcut pressed during setup must never paste or save.**
   - Today `DesktopTrial` begins a `dictation` demo, so main lets the global hotkey through to the overlay window (`windowManager.js:909-928`).
   - That window runs `useAudioRecording` without `trialMode` (`src/App.jsx:209-215`), so it auto-pastes and writes history.
   - Expected: while `onboardingCompleted !== "true"`, the overlay records in trial mode, and it updates the moment setup finishes.
   - Pinned in Task 5: `useSetupIncomplete.test.js` and the App wiring assertion.
2. **Leaving Say something mid-recording, or quitting setup, discards the clip and releases the mic.**
   - Expected: unmounting the trial ends the demo, which main turns into a cancel (`endOnboardingDemo`, `windowManager.js:1624-1635`). Nothing reaches the field afterwards, and the Hello level preview stops its tracks.
   - Pinned in Task 15 ("leaving the step ends the demo session") and Task 12 ("leaving Hello stops the microphone").
3. **The download fails, is cancelled, or the user switches voice.**
   - Expected: the footer chip turns into "Download failed" with Retry. Continue is never blocked. The voice picker is locked while a download runs, with a visible reason and a Cancel button. A finished download reads `ready` even before routes refresh.
   - After a network failure the partial file is kept, and Retry resumes from it. "Your progress is kept" appears only when main reports kept bytes. After a cancel or an HTTP failure, the file is gone and the copy says so.
   - Pinned in:
     - Task 7: `deriveVoiceDownloadState` precedence and `progressKept`; `estimateRate` with stalls and restarts; `downloadFile` keeps a partial on a network failure and resumes it with `Range`, but drops it on HTTP failures.
     - Task 8: the interrupted scenario resumes on Retry.
     - Task 13: "picker is locked with a reason while downloading".
4. **Locales the catalog cannot serve.**
   - `[]`, `["zh-Hant-TW"]`, `["he-IL"]`, `["ja-JP","en-US"]`, `["pt-BR","en-US"]`, `["en-GB"]`, `["de-DE","ja-JP"]`.
   - Expected: no crash, never an English model for a Japanese-only Mac, and an explicit "Choose yourself" path when nothing fits.
   - Pinned in Task 3.
5. **Screen readers and reduced motion.**
   - Expected: the tour never auto-advances under reduced motion. Download milestones are announced at 25, 50, 75 and 100% only, never every tick. Bars are `aria-hidden` and always have a text caption. The radio groups have names, arrow keys and readable disabled reasons.
   - Pinned in Task 7 (`milestoneCrossed`), Task 14 ("reduced motion never auto-advances"), Task 11 (caption) and Task 9 (radio group).

---

## Before you start (pre-flight)

Run these from the worktree root. Every command must print a match. If one prints nothing, stop. The upstream plan has not merged, and this plan must not re-implement it.

```bash
grep -n -- "--motion-base:" src/index.css                                   # Plan 01 Task 1
grep -n -- "--color-live-foreground:" src/index.css                         # Plan 01 Task 3
grep -n 'live:' src/components/ui/button.tsx                                # Plan 01 Task 3 (variant)
ls src/components/ui/LevelBars.tsx src/components/ui/levelBarsMath.ts       # Plan 01 Task 8
ls src/components/ui/LocalityRing.tsx src/lib/locality.ts                   # Plan 01 Tasks 6-7
ls src/utils/contrast.ts test/helpers/harness/cssTokens.js                  # Plan 01 Task 2
grep -n "export function useResolvedRoute" src/lib/routes.ts                # Plan 03 (§5.1)
grep -n "useModelDownload" src/components/OnboardingFlow.tsx                # Plan 02 ONB-Q2
grep -rn "84px" src/styles/onboarding-welcome.css                           # Plan 02 ONB-Q1
ls src/components/ui/notices.ts 2>/dev/null || echo "Plan 04 not merged: Task 7 uses the toast shim"
```

Then record the baseline:

```bash
npm run native:node
npm test
```

Expected: PASS. Note any pre-existing failures in the PR description and do not fix them here.

Line numbers in this plan were taken at commit `8267276`, before Plans 01–03 merged. When a cited line has moved, find it by the quoted code, not by the number.

## Conventions used by every task

**Component tests.** Task 9 adds `test/helpers/harness/mountComponent.js`. It mounts a real component into the fake DOM tree that `test/components/onboardingCleanupWiring.test.js` already uses. It mocks `react-i18next` so that:
- `t(key)` returns `key`;
- `t(key, values)` returns `key {"…":…}`.

Assert on keys, not on English copy.

**Adding strings.** Task 1 adds `scripts/dev/merge-locale-keys.cjs`. Every task that adds strings pipes a JSON fragment into it:

```bash
node scripts/dev/merge-locale-keys.cjs - <<'JSON'
{ "setupFlow": { "example": "Example" } }
JSON
```

It writes the fragment into `src/locales/en/translation.json`. Into every other locale it adds only missing keys, as an English placeholder. It also adds every CLDR plural category each locale needs, so `npm run i18n:check` passes after every task. Task 20 replaces the placeholders with translations, and its test fails while any remain.

**Commit trailer.** End every commit message with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

The commit commands below show only the subject line.

## File map

| Path | Status | Responsibility |
|---|---|---|
| `src/utils/onboardingState.ts` | modify | New step order, `visited`, exported scenario list and `isOnboardingStep` |
| `src/utils/onboardingFlow.ts` | create | Step graph: phases, next/previous, progress, navigation guard |
| `src/utils/onboardingDetection.ts` | create | D8 voice pick from locales, plus a disk check |
| `src/utils/onboardingTrial.ts` | create | Trial reducer over demo events (§5.2 states) |
| `src/utils/onboardingDownload.ts` | create | Download state, rate/ETA, milestones, chip text |
| `src/utils/onboardingCleanupPreview.ts` | create | Word diff, word count, before/after model |
| `src/utils/onboardingShortcut.ts` | create | Tap/hold detection, mode suggestion, keycap label |
| `src/utils/onboardingReadiness.ts` | create | Honest Ready rows from routes and setup facts |
| `src/utils/onboardingDemo.ts` | modify | Success/error demo event builders |
| `src/utils/afterSetupIntent.ts` | create | One-shot "dictate into a note" hand-off |
| `src/helpers/systemProfile.js` | create | Main: locales, RAM, free disk, GPU |
| `src/helpers/downloadUtils.js` | modify | Keep the partial file on network failures; report `keptBytes` (owner decision 3) |
| `src/utils/onboardingMic.ts` | create | Microphone picker model over the existing selection settings (owner decision 6) |
| `src/helpers/onboardingInputPolicy.js` | modify | `shortcut` demo, `cancelled` status, hotkey gate, sanitizer |
| `src/helpers/ipcHandlers.js`, `src/helpers/windowManager.js`, `main.js`, `preload.js`, `src/types/electron.ts` | modify | IPC for profile, demo toggle/cancel/undo, hotkey events |
| `src/App.jsx`, `src/hooks/useAudioRecording.js`, `src/hooks/useSetupIncomplete.ts` | modify/create | Overlay trial mode until setup completes |
| `src/hooks/useStartOnboarding.ts`, `src/AppRouter.jsx`, `src/components/ControlPanel.tsx` | modify | In-app restart, deep links, after-setup intent |
| `src/components/OnboardingFlow.tsx` | rewrite | Orchestrator only |
| `src/components/onboarding/*.tsx` | create | Shell, rail, steps, primitives, hooks |
| `src/components/onboarding/WelcomeScreen.tsx` | delete | Replaced by `HelloStep` |
| `src/components/FinishDictationSetupCard.tsx` | modify | Resume rows link to steps |
| `src/styles/onboarding.css` | create | All setup styles, tokens only |
| `src/styles/onboarding-welcome.css`, `src/styles/onboarding-guided.css` | delete (Task 18) | Replaced |
| `src/index.css` | modify | Delete orphaned `.onboarding-*` CSS (ONB-Q15) |
| `src/components/ui/ActivationModeSelector.tsx` | modify | Drop the dead `onboarding` variant |
| `src/preview/onboardingScenarioBridge.ts`, `src/preview/browserPreview.ts`, `src/preview/BrowserPreview.tsx` | create/modify | Scenario fakes and toolbar |
| `scripts/dev/merge-locale-keys.cjs` | create | i18n fragment merger |
| `DESIGN.md`, `docs/ONBOARDING_PREVIEW.md`, `docs/PRIVACY.md` | modify | Docs |

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

Covers the data half of ONB-R3 C under D8: hardware and OS locale only.

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
    totalMemoryBytes: number | null;
    freeDiskBytes: number | null;    // free space where models are stored
    gpu: { kind: "apple-silicon" | "nvidia" | "unknown"; name: string | null };
  }
  // window.electronAPI
  getSystemProfile?: () => Promise<SystemProfile>;
  ```

  ```js
  // src/helpers/systemProfile.js (CommonJS, dependency-injected for tests)
  async function getSystemProfile(deps): Promise<SystemProfile>
  function normalizeLocales(list, fallback): string[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/systemProfile.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { getSystemProfile, normalizeLocales } = require("../../src/helpers/systemProfile");

const enoent = () => Object.assign(new Error("missing"), { code: "ENOENT" });

test("reads preferred languages, memory, free space and Apple silicon without probing NVIDIA", async () => {
  const profile = await getSystemProfile({
    app: { getPreferredSystemLanguages: () => ["es-ES", "en-US", "es-ES"], getLocale: () => "en-US" },
    platform: "darwin",
    arch: "arm64",
    totalmem: () => 17179869184,
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
    totalMemoryBytes: 17179869184,
    freeDiskBytes: 4096000,
    gpu: { kind: "apple-silicon", name: null },
  });
});

test("free space is read from the nearest existing parent of the model cache", async () => {
  const seen = [];
  const profile = await getSystemProfile({
    app: { getLocale: () => "en-US" },
    platform: "linux",
    arch: "x64",
    totalmem: () => 8e9,
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
    totalmem: () => Number.NaN,
    statfs: async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    },
    cacheRoot: "C:\\cache",
    detectGpu: async () => ({ hasNvidiaGpu: true, gpuName: "NVIDIA GeForce RTX 4070" }),
  });
  assert.deepEqual(profile, {
    locales: ["fr-FR"],
    totalMemoryBytes: null,
    freeDiskBytes: null,
    gpu: { kind: "nvidia", name: "NVIDIA GeForce RTX 4070" },
  });
});

test("a failing GPU probe is unknown, not an error", async () => {
  const profile = await getSystemProfile({
    app: {},
    platform: "linux",
    arch: "x64",
    totalmem: () => 4e9,
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
   // Facts setup uses to recommend a voice (spec D8): OS languages, memory, free
   // space where models are stored, and the GPU. Read on this device, returned
   // to the setup window, never stored or sent anywhere.
   const os = require("os");
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
     totalmem = os.totalmem,
     statfs = fsPromises.statfs,
     cacheRoot,
     detectGpu,
   } = {}) {
     const memory = Number(totalmem());
     return {
       locales: normalizeLocales(app?.getPreferredSystemLanguages?.(), app?.getLocale?.()),
       totalMemoryBytes: Number.isFinite(memory) && memory > 0 ? memory : null,
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
   - Add the `SystemProfile` interface above `export type OnboardingDemoKind`.
   - Add `getSystemProfile?: () => Promise<SystemProfile>;` after the `onOnboardingDemoEvent?` member (line 701).

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
git commit -m "feat(onboarding): read OS languages, memory, free space and GPU for voice detection"
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
    languages: string[];                     // base codes in OS order; supported ones first-class
    reason: VoiceReason;
    disk: { neededBytes: number; freeBytes: number } | null; // set only when short
  }
  export const DISK_HEADROOM: 2.5;           // parakeet.js needs size × 2.5 to download and extract
  export function outcomeFor(modelId: string): VoiceOutcome | null;
  export function modelDownloadBytes(modelId: string): number | null; // sizeMb × 1e6
  export function baseLanguages(locales: readonly string[]): string[];
  export function detectVoice(profile: Pick<SystemProfile, "locales" | "freeDiskBytes">): VoicePick;
  export function shouldApplyDetectedVoice(storedParakeetModel: string | null): boolean;
  ```

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
  const { detectVoice } = await load();
  for (const [locales, language] of [[["he-IL"], "he"], [["zh-Hant-TW"], "zh"]]) {
    const pick = detectVoice({ locales, freeDiskBytes: plenty });
    assert.equal(pick.modelId, null);
    assert.equal(pick.outcome, null);
    assert.deepEqual(pick.reason, { kind: "unsupported", language });
  }
  const partial = detectVoice({ locales: ["he-IL", "fr-FR"], freeDiskBytes: plenty });
  assert.equal(partial.modelId, "orukeet-v0.1.0", "a supported second language still gets a voice");
  assert.deepEqual(partial.reason, { kind: "language", language: "fr" });
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
  languages: string[];
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
    languages,
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/utils/onboardingDetection.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingDetection.ts test/utils/onboardingDetection.test.js
git commit -m "feat(onboarding): pick a voice from OS languages and free space"
```

---

### Task 4: Onboarding demo bridge v2

The bridge gains a shortcut demo, a `cancelled` status, live hotkey presses, and trial toggle, cancel and undo. Covers the main-process half of ONB-R5 C and ONB-R7 B, and the §5.2 plumbing.

**Files:**
- Modify: `src/helpers/onboardingInputPolicy.js`. Rewrite the whole 17-line file.
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
  - `ONBOARDING_DEMO_STATUSES` gains `"cancelled"`.
  - `shouldReportDictationHotkey(onboardingActive: boolean, demoKind: string | null): boolean`
  - `sanitizeOnboardingDemoEvent(event, session): OnboardingDemoEvent | null`
- Produces these `WindowManager` methods:
  - `reportDictationHotkey(phase: "down" | "up" | "tap"): boolean`
  - `toggleOnboardingDemoRecording(): boolean`
  - `cancelOnboardingDemoRecording(): boolean`
  - `undoOnboardingDemoCancel(): boolean`. It calls Plan 04's `sendUndoCancelDictation`, per CCR 1.
- Produces these IPC channels:
  - `onboarding-demo-toggle`, `onboarding-demo-cancel`, `onboarding-demo-undo-cancel`. Each takes the demo id.
  - The `dictation-hotkey-event` broadcast to the control panel, with payload `{ phase, at }`.
- Produces, in `src/types/electron.ts`:

  ```ts
  export type OnboardingDemoKind = "dictation" | "assistant" | "shortcut";
  // OnboardingDemoStatus adds "cancelled"; OnboardingDemoEvent adds:
  //   rawText?: string; code?: string; cleanup?: "applied" | "skipped" | "failed";
  //   undoUntil?: number; remoteAlreadySent?: string;
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
  isOnboardingInputAllowed,
  sanitizeOnboardingDemoEvent,
  shouldReportDictationHotkey,
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

test("the cancelled state can reach the setup window", () => {
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelled"));
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
      undoUntil: 1700,
      remoteAlreadySent: "OpenAI",
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
    undoUntil: 1700,
    remoteAlreadySent: "OpenAI",
  });
  assert.equal(sanitizeOnboardingDemoEvent({ kind: "assistant", status: "success" }, session), null);
  assert.equal(sanitizeOnboardingDemoEvent({ kind: "dictation", status: "done" }, session), null);
  assert.equal(sanitizeOnboardingDemoEvent({ kind: "dictation", status: "success" }, null), null);
  const odd = sanitizeOnboardingDemoEvent(
    { kind: "dictation", status: "cancelled", cleanup: "maybe", undoUntil: "soon", level: Number.NaN },
    session
  );
  assert.equal(odd.cleanup, undefined);
  assert.equal(odd.undoUntil, undefined);
  assert.equal(odd.level, undefined);
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
       undoUntil: Number.isFinite(event.undoUntil) ? event.undoUntil : undefined,
       remoteAlreadySent: clip(event.remoteAlreadySent, 64),
     };
   }

   module.exports = {
     ONBOARDING_DEMO_KINDS,
     ONBOARDING_DEMO_STATUSES,
     isOnboardingInputAllowed,
     sanitizeOnboardingDemoEvent,
     shouldReportDictationHotkey,
   };
   ```

2. Change line 54 of `src/helpers/ipcHandlers.js` to:

   ```js
   const {
     ONBOARDING_DEMO_KINDS,
     sanitizeOnboardingDemoEvent,
   } = require("./onboardingInputPolicy");
   ```

   Then make two edits in the same file:
   - Replace the body of `onboarding-demo-publish` (1059-1079) with:

     ```js
         ipcMain.handle("onboarding-demo-publish", (_event, event) => {
           const payload = sanitizeOnboardingDemoEvent(event, this._onboardingDemoSession);
           if (!payload) return false;
           broadcastToWindows("onboarding-demo-event", payload);
           return true;
         });
     ```

     If `ONBOARDING_DEMO_STATUSES` is no longer referenced in this file, it was used only by the old publish body, so leave it out of the import.

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
         this.sendCancelDictation();
         return true;
       }

       // Spec §5.2: undo belongs to Plan 04. Until it adds sendUndoCancelDictation,
       // setup reports false and hides its Undo button (contract change request 1).
       undoOnboardingDemoCancel() {
         if (this._onboardingDemoKind !== "dictation") return false;
         if (typeof this.sendUndoCancelDictation !== "function") return false;
         this.sendUndoCancelDictation();
         return true;
       }
     ```

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
   - Add the five optional fields to `OnboardingDemoEvent`, add `DictationHotkeyEvent`, and add the four API members, all exactly as listed under Interfaces.
   - `getOnboardingDemoKind` (`src/utils/onboardingDemo.ts:3`) keeps returning `"assistant" | "dictation"`. Annotate its return type as `Exclude<OnboardingDemoKind, "shortcut">` if typecheck complains.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/onboardingInputPolicy.test.js test/helpers/preloadOnboardingBridge.test.js test/helpers && npm run typecheck`
Expected: PASS. The whole `test/helpers` folder runs too, because `windowManager*` tests load the file.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/onboardingInputPolicy.js src/helpers/ipcHandlers.js src/helpers/windowManager.js main.js preload.js src/types/electron.ts test/helpers/onboardingInputPolicy.test.js test/helpers/preloadOnboardingBridge.test.js
git commit -m "feat(onboarding): shortcut demo, cancelled status, live hotkey presses and trial controls"
```

---

### Task 5: The overlay records in trial mode until setup completes

Privacy fix: Review Focus 1. It also adds the richer demo events that ONB-Q7 and ONB-R6 B need.

**Files:**
- Create: `src/hooks/useSetupIncomplete.ts`
- Modify: `src/App.jsx`. Touch the imports and the `useAudioRecording(toast, { … })` call at lines 209-215.
- Modify: `src/utils/onboardingDemo.ts`
- Modify: `src/hooks/useAudioRecording.js`. Touch the `onError` demo event (382-387), the `onNoAudio` demo event (410-415) and the success demo event (507-511).
- Test: `test/hooks/useSetupIncomplete.test.js` and `test/utils/onboardingDemo.test.js`.

**Interfaces:**
- Produces `src/hooks/useSetupIncomplete.ts`:
  - `isSetupIncomplete(storage?: Pick<Storage, "getItem">): boolean`. It fails closed: a storage error counts as incomplete.
  - `useSetupIncomplete(): boolean`. It follows `storage` events from the control-panel window.
- Produces in `src/utils/onboardingDemo.ts`:

  ```ts
  export type DemoCleanupOutcome = "applied" | "skipped" | "failed";
  export function demoCleanupOutcome(result: { text?: string; rawText?: string | null; cleanupFailure?: unknown }): DemoCleanupOutcome;
  export function buildDemoSuccessEvent(kind: OnboardingDemoKind, result: { text: string; rawText?: string | null; cleanupFailure?: unknown }): { kind; status: "success"; text: string; rawText?: string; cleanup: DemoCleanupOutcome };
  export function demoErrorCode(error: unknown): string | undefined;
  ```

  `"applied"` means cleanup changed the text. Cleanup that ran and changed nothing reads `"skipped"`. That is harmless, because only `"failed"` is surfaced (ONB-Q7).

- [ ] **Step 1: Write the failing tests**

Create `test/hooks/useSetupIncomplete.test.js`:

```js
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
  assert.equal(
    isSetupIncomplete({
      getItem: () => {
        throw new Error("denied");
      },
    }),
    true
  );
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

test("the overlay recorder is wired to trial mode", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../src/App.jsx"), "utf8");
  assert.match(source, /const setupIncomplete = useSetupIncomplete\(\);/);
  assert.match(source, /useAudioRecording\(toast, \{[\s\S]*?trialMode: setupIncomplete,/);
});
```

Create `test/utils/onboardingDemo.test.js`:

```js
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
  const bare = buildDemoSuccessEvent("dictation", { text: "hi" });
  assert.equal(bare.rawText, undefined);
  assert.equal(bare.cleanup, "skipped");
});

test("error codes come from the error object, never from its message", async () => {
  const { demoErrorCode } = await load();
  assert.equal(demoErrorCode({ code: "NO_AUDIO" }), "NO_AUDIO");
  assert.equal(demoErrorCode({ name: "NotAllowedError", message: "Permission denied" }), "NotAllowedError");
  assert.equal(demoErrorCode(new Error("boom")), undefined);
  assert.equal(demoErrorCode(null), undefined);
  assert.equal(demoErrorCode("NotAllowedError"), undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/hooks/useSetupIncomplete.test.js test/utils/onboardingDemo.test.js`
Expected: FAIL. The hook module is missing, `buildDemoSuccessEvent is not a function`, and the `App.jsx` assertion fails.

- [ ] **Step 3: Implement**

1. Create `src/hooks/useSetupIncomplete.ts`:

   ```ts
   import { useEffect, useState } from "react";

   const COMPLETED_KEY = "onboardingCompleted";

   /**
    * Until setup completes, every recording is a private trial: no paste, no
    * clipboard, no history (useAudioRecording `trialMode`). Fails closed.
    */
   export function isSetupIncomplete(
     storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage
   ): boolean {
     try {
       return storage?.getItem(COMPLETED_KEY) !== "true";
     } catch {
       return true;
     }
   }

   /** The overlay window learns about completion through the `storage` event. */
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

2. In `src/App.jsx`:
   - Add `import { useSetupIncomplete } from "./hooks/useSetupIncomplete";`.
   - Add `const setupIncomplete = useSetupIncomplete();` directly above the `useAudioRecording(toast, {` call.
   - Add `trialMode: setupIncomplete,` as the first property of its options object.

   `trialMode` is already an effect dependency in `useAudioRecording` (line 809). When setup completes, the recorder is rebuilt once with paste and history enabled.

3. Append to `src/utils/onboardingDemo.ts`:

   ```ts
   import type { OnboardingDemoKind } from "../types/electron";

   export type DemoCleanupOutcome = "applied" | "skipped" | "failed";

   export function demoCleanupOutcome(result: {
     text?: string;
     rawText?: string | null;
     cleanupFailure?: unknown;
   }): DemoCleanupOutcome {
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

   /** Stable codes only (`code`, or a DOMException `name`); messages are not parsed. */
   export function demoErrorCode(error: unknown): string | undefined {
     if (!error || typeof error !== "object") return undefined;
     const { code, name } = error as { code?: unknown; name?: unknown };
     if (typeof code === "string") return code;
     return typeof name === "string" && name !== "Error" ? name : undefined;
   }
   ```

   If the file already has a type import from `../types/electron`, merge this import into it instead of adding a second one.

4. In `src/hooks/useAudioRecording.js`, extend the import on line 11 to `import { buildDemoSuccessEvent, demoErrorCode, getOnboardingDemoKind } from "../utils/onboardingDemo";`. Then:
   - `onError` (382-387): add `code: demoErrorCode(error),` to the `status: "error"` event object.
   - `onNoAudio` (410-415): add `code: "NO_AUDIO",` to its `status: "error"` event object.
   - Success (507-511): replace the object literal with `onDemoEventRef.current?.(buildDemoSuccessEvent(demoKindRef.current, result));`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/hooks/useSetupIncomplete.test.js test/utils/onboardingDemo.test.js test/hooks && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSetupIncomplete.ts src/App.jsx src/utils/onboardingDemo.ts src/hooks/useAudioRecording.js test/hooks/useSetupIncomplete.test.js test/utils/onboardingDemo.test.js
git commit -m "fix(onboarding): keep shortcut dictation private until setup completes"
```

---

### Task 6: Trial state reducer

Covers the logic of ONB-R5 C, ONB-Q3, ONB-Q5 and ONB-Q7, and consumes §5.2 `cancelled`.

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
    undoUntil: number | null; remoteAlreadySent: string | null; successes: number;
  }
  export type TrialInput = (Pick<OnboardingDemoEvent, "status" | "text" | "rawText" | "message" | "code" | "level" | "cleanup" | "undoUntil" | "remoteAlreadySent"> & { atMs: number }) | { status: "reset"; atMs: number };
  export const VOICE_LEVEL_FLOOR = 0.015;
  export const SILENCE_HINT_MS = 2500;
  export const INITIAL_TRIAL_STATE: TrialState;
  export function classifyTrialError(code?: string): TrialErrorKind;
  export function reduceTrial(state: TrialState, input: TrialInput): TrialState;
  export function isSilent(state: TrialState, nowMs: number): boolean;
  export function canUndo(state: TrialState, nowMs: number): boolean;
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

test("a cancelled recording offers undo until its deadline (spec §5.2)", async () => {
  const { canUndo, trialCaption } = await load();
  const state = await play([
    { status: "listening", atMs: 0 },
    { status: "cancelled", undoUntil: 6000, remoteAlreadySent: null, atMs: 1000 },
  ]);
  assert.equal(state.phase, "cancelled");
  assert.equal(trialCaption(state), "discarded");
  assert.equal(canUndo(state, 5999), true);
  assert.equal(canUndo(state, 6000), false);
  const odd = await play([{ status: "cancelled", undoUntil: Number.NaN, atMs: 0 }]);
  assert.equal(odd.undoUntil, null);
  assert.equal(canUndo(odd, 0), false);
});

test("a new take clears the last result but keeps the success count", async () => {
  const state = await play([
    { status: "listening", atMs: 0 },
    { status: "success", text: "One.", atMs: 5 },
    { status: "listening", atMs: 10 },
  ]);
  assert.deepEqual([state.phase, state.text, state.rawText, state.cleanup, state.successes], ["recording", "", null, null, 1]);
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
  undoUntil: number | null;
  remoteAlreadySent: string | null;
  successes: number;
}

export type TrialInput =
  | (Pick<
      OnboardingDemoEvent,
      "status" | "text" | "rawText" | "message" | "code" | "level" | "cleanup" | "undoUntil" | "remoteAlreadySent"
    > & { atMs: number })
  | { status: "reset"; atMs: number };

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
  undoUntil: null,
  remoteAlreadySent: null,
  successes: 0,
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

const fresh = (state: TrialState): TrialState => ({ ...INITIAL_TRIAL_STATE, successes: state.successes });

export function reduceTrial(state: TrialState, input: TrialInput): TrialState {
  switch (input.status) {
    case "reset":
      return fresh(state);
    case "listening":
      return { ...fresh(state), phase: "recording", recordingSinceMs: input.atMs };
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
        undoUntil: Number.isFinite(input.undoUntil) ? (input.undoUntil as number) : null,
        remoteAlreadySent: input.remoteAlreadySent ?? null,
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

export function canUndo(state: TrialState, nowMs: number): boolean {
  return state.phase === "cancelled" && state.undoUntil !== null && state.undoUntil > nowMs;
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
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingTrial.ts test/utils/onboardingTrial.test.js
git commit -m "feat(onboarding): trial state reducer over demo events"
```

---

### Task 7: Voice download state, kept progress, rate, milestones and the notices shim

Covers the logic of ONB-R4 B, building on ONB-Q2 from Plan 02, and consumes §5.3. Also covers owner decision 3: a network failure keeps the partial download, so "Your progress is kept" is true.

**Files:**
- Create: `src/utils/onboardingDownload.ts`
- Create: `src/components/onboarding/useVoiceDownload.ts`
- Create: `src/components/onboarding/onboardingNotices.ts`
- Modify: `src/helpers/downloadUtils.js`. Touch the terminal-failure branch of `downloadFile` (328-343).
- Modify: `src/helpers/ipcHandlers.js`. Touch the `download-parakeet-model` catch block (≈2840-2860).
- Modify: `src/types/electron.ts`. Touch `ParakeetDownloadProgressData` (517-526).
- Test: `test/utils/onboardingDownload.test.js` and `test/components/onboardingNotices.test.js`. Append to `test/helpers/downloadUtils.test.js`.

**Interfaces:**
- Consumes `useModelDownload({ modelType: "parakeet" })` (`src/hooks/useModelDownload.ts:93`). It returns `downloadProgress {percentage, downloadedBytes, totalBytes}`, `downloadErrors`, `isDownloadingModel(id)`, `isInstalling`, `downloadModel(id)` and `cancelDownload(id)`.
  - The hook never fills `speed` or `eta` (lines 490-509), so this task estimates them.
  - Its `showAlertDialog` state is local to `useDialogs()` and never rendered. Download errors are visible only through `downloadErrors`, which is how setup shows them.
- Produces, in `src/utils/onboardingDownload.ts`:

  ```ts
  export type VoiceDownloadState =
    | { status: "idle" }
    | { status: "downloading"; percent: number; downloadedBytes: number; totalBytes: number; bytesPerSecond: number | null; etaSeconds: number | null }
    | { status: "installing" }
    | { status: "ready" }
    | { status: "error"; message: string; percent: number | null; progressKept: boolean };
  export interface RateSample { atMs: number; bytes: number }
  export const RATE_WINDOW_MS = 5000;
  export function pushSample(samples: readonly RateSample[], sample: RateSample): RateSample[];
  export function estimateRate(samples: readonly RateSample[], totalBytes: number): { bytesPerSecond: number | null; etaSeconds: number | null };
  export interface DownloadFacts { installed: boolean | null; active: boolean; installing: boolean; progress: { percentage: number; downloadedBytes: number; totalBytes: number }; error: string | null; lastPercent: number | null; keptBytes: number | null; samples: readonly RateSample[] }
  export function deriveVoiceDownloadState(facts: DownloadFacts): VoiceDownloadState;
  export const DOWNLOAD_MILESTONES: readonly [25, 50, 75];
  export type DownloadMilestone = 25 | 50 | 75;
  export function milestoneCrossed(previousPercent: number | null, nextPercent: number): DownloadMilestone | null;
  export function clampPercent(value: number): number;
  export function byteParts(bytes: number, locale?: string): { value: string; unit: "mb" | "gb" };
  export function etaParts(seconds: number | null): { unit: "seconds" | "minutes"; count: number } | null;
  ```

- Produces, in `useVoiceDownload.ts`: `useVoiceDownload(modelId: string | null): { state: VoiceDownloadState; milestone: DownloadMilestone | null; start(): void; cancel(): void }`.
- Produces, in `onboardingNotices.ts`:
  - `announceVoiceReady(toast, t)`
  - `announceVoiceFailed(toast, t, message, retry)`
  - `shouldAnnounceOffStep(step): boolean`
- Produces the i18n keys `setupFlow.download.*` and `setupFlow.units.*`.
- Produces in main:
  - A terminal `downloadFile` error carries `keptBytes: number`. It is the size of the kept `.tmp` file after a network-class failure (`isRetryable`), and `0` after a cancel or any other failure. In those cases the file is deleted, as today.
  - The `parakeet-download-progress` error payload and the `download-parakeet-model` result carry `keptBytes`. `ParakeetDownloadProgressData` gains `keptBytes?: number`.
  - Whisper and LLM downloads share `downloadFile`, so they resume after network failures too. That is intended. Their error payloads are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/onboardingDownload.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingDownload.ts");
const facts = (patch = {}) => ({
  installed: false,
  active: false,
  installing: false,
  progress: { percentage: 0, downloadedBytes: 0, totalBytes: 0 },
  error: null,
  lastPercent: null,
  keptBytes: null,
  samples: [],
  ...patch,
});

test("speed and ETA come from the last five seconds of real progress", async () => {
  const { estimateRate, pushSample } = await load();
  let samples = [];
  for (const [atMs, bytes] of [[0, 0], [500, 4e6], [1000, 8.2e6], [2000, 16.4e6]]) {
    samples = pushSample(samples, { atMs, bytes });
  }
  assert.deepEqual(estimateRate(samples, 631e6), { bytesPerSecond: 8200000, etaSeconds: 75 });
  assert.deepEqual(estimateRate(samples.slice(0, 2), 631e6), { bytesPerSecond: null, etaSeconds: null }, "under a second is too little to say");
  samples = pushSample(samples, { atMs: 7600, bytes: 50e6 });
  assert.deepEqual(samples, [{ atMs: 7600, bytes: 50e6 }], "samples older than five seconds leave the window");
});

test("a stalled or restarted transfer shows no speed instead of a wrong one", async () => {
  const { estimateRate, pushSample } = await load();
  const stalled = [{ atMs: 0, bytes: 9e6 }, { atMs: 3000, bytes: 9e6 }];
  assert.deepEqual(estimateRate(stalled, 631e6), { bytesPerSecond: null, etaSeconds: null });
  assert.deepEqual(pushSample(stalled, { atMs: 3500, bytes: 1e6 }), [{ atMs: 3500, bytes: 1e6 }]);
  assert.deepEqual(estimateRate([{ atMs: 0, bytes: 0 }, { atMs: 2000, bytes: 4e6 }], 0), { bytesPerSecond: 2000000, etaSeconds: null });
});

test("state precedence: running beats installed beats a stale error", async () => {
  const { deriveVoiceDownloadState } = await load();
  assert.deepEqual(deriveVoiceDownloadState(facts()), { status: "idle" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ installed: true, error: "old failure" })), { status: "ready" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ active: true, installing: true })), { status: "installing" });
  assert.deepEqual(deriveVoiceDownloadState(facts({ error: "Network timeout", lastPercent: 42, keptBytes: 265e6 })), {
    status: "error",
    message: "Network timeout",
    percent: 42,
    progressKept: true,
  });
  for (const keptBytes of [0, null]) {
    assert.equal(
      deriveVoiceDownloadState(facts({ error: "HTTP 404", lastPercent: 42, keptBytes })).progressKept,
      false,
      "progress is only called kept when main says bytes were kept"
    );
  }
  const running = deriveVoiceDownloadState(
    facts({
      active: true,
      error: "previous attempt",
      progress: { percentage: 41.6, downloadedBytes: 264e6, totalBytes: 631e6 },
      samples: [{ atMs: 0, bytes: 256e6 }, { atMs: 1000, bytes: 264e6 }],
    })
  );
  assert.deepEqual(running, {
    status: "downloading",
    percent: 42,
    downloadedBytes: 264e6,
    totalBytes: 631e6,
    bytesPerSecond: 8000000,
    etaSeconds: 46,
  });
});

test("milestones announce once per quarter, never every tick", async () => {
  const { milestoneCrossed } = await load();
  assert.equal(milestoneCrossed(null, 3), null);
  assert.equal(milestoneCrossed(24, 25), 25);
  assert.equal(milestoneCrossed(25, 26), null);
  assert.equal(milestoneCrossed(10, 80), 75, "a jump announces only the highest crossed");
  assert.equal(milestoneCrossed(80, 100), null, "completion is announced by the ready state");
});

test("numbers are clamped and formatted for people", async () => {
  const { clampPercent, byteParts, etaParts } = await load();
  assert.deepEqual([clampPercent(-3), clampPercent(41.6), clampPercent(140), clampPercent(Number.NaN)], [0, 42, 100, 0]);
  assert.deepEqual(byteParts(264e6, "en"), { value: "264", unit: "mb" });
  assert.deepEqual(byteParts(1329766560, "en"), { value: "1.3", unit: "gb" });
  assert.deepEqual(byteParts(-1, "en"), { value: "0", unit: "mb" });
  assert.deepEqual(etaParts(42), { unit: "seconds", count: 45 });
  assert.deepEqual(etaParts(2), { unit: "seconds", count: 5 });
  assert.deepEqual(etaParts(75), { unit: "minutes", count: 2 });
  assert.equal(etaParts(null), null);
  assert.equal(etaParts(Number.POSITIVE_INFINITY), null);
});
```

Create `test/components/onboardingNotices.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/onboarding/onboardingNotices.ts");
const t = (key) => key;

test("a finished download off-screen raises a receipt", async () => {
  const { announceVoiceReady } = await load();
  const calls = [];
  announceVoiceReady((props) => calls.push(props), t);
  assert.deepEqual(calls, [{ title: "setupFlow.download.readyTitle", variant: "success" }]);
});

test("a failed download off-screen raises an alert with Retry", async () => {
  const { announceVoiceFailed } = await load();
  const calls = [];
  let retried = 0;
  announceVoiceFailed((props) => calls.push(props), t, "Not enough disk space", () => retried++);
  assert.equal(calls[0].title, "setupFlow.download.failedTitle");
  assert.equal(calls[0].description, "Not enough disk space");
  assert.equal(calls[0].variant, "destructive");
  calls[0].actions[0].onClick();
  assert.equal(retried, 1);
});

test("only steps without their own download status announce", async () => {
  const { shouldAnnounceOffStep } = await load();
  assert.deepEqual(
    ["welcome", "speech", "try", "cleanup", "shortcuts", "finish"].map(shouldAnnounceOffStep),
    [true, false, false, true, true, true]
  );
});
```

Append to `test/helpers/downloadUtils.test.js`. It reuses that file's `fs`, `os`, `path`, `EventEmitter` and `PassThrough` requires:

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
  const { downloadFile } = loaded.downloadUtils;

  const failure = await downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 }).catch((error) => error);
  assert.equal(failure.code, "ERR_DOWNLOAD_INCOMPLETE");
  assert.equal(failure.keptBytes, 5);
  assert.equal(fs.readFileSync(`${destination}.tmp`, "utf8"), "hello");

  await downloadFile("https://example.com/model.bin", destination, { maxRetries: 0 });
  assert.equal(loaded.requests[1].Range, "bytes=5-");
  assert.equal(fs.readFileSync(destination, "utf8"), "helloworld");
  assert.equal(fs.existsSync(`${destination}.tmp`), false);
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

Run: `npm test -- test/utils/onboardingDownload.test.js test/components/onboardingNotices.test.js test/helpers/downloadUtils.test.js`
Expected: FAIL.
- Both new modules are missing.
- `failure.keptBytes` is `undefined`.
- The partial `.tmp` file is deleted after the network failure.

- [ ] **Step 3: Implement**

1. Create `src/utils/onboardingDownload.ts`:

   ```ts
   // Honest download progress for setup (ONB-R4): real percent, a measured speed
   // and ETA, milestones for one polite live region, and no number when the
   // transfer is stalled.
   export type VoiceDownloadState =
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
     if (last && sample.bytes < last.bytes) return [sample]; // the transfer restarted
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
     active: boolean;
     installing: boolean;
     progress: { percentage: number; downloadedBytes: number; totalBytes: number };
     error: string | null;
     lastPercent: number | null;
     /** From main's error payload: bytes of the partial file kept for Retry (null: no failure seen). */
     keptBytes: number | null;
     samples: readonly RateSample[];
   }

   export function deriveVoiceDownloadState(facts: DownloadFacts): VoiceDownloadState {
     if (facts.active && facts.installing) return { status: "installing" };
     if (facts.active) {
       const { percentage, downloadedBytes, totalBytes } = facts.progress;
       return {
         status: "downloading",
         percent: clampPercent(percentage),
         downloadedBytes,
         totalBytes,
         ...estimateRate(facts.samples, totalBytes),
       };
     }
     if (facts.installed) return { status: "ready" };
     if (facts.error) {
       return {
         status: "error",
         message: facts.error,
         percent: facts.lastPercent,
         progressKept: (facts.keptBytes ?? 0) > 0,
       };
     }
     return { status: "idle" };
   }

   export const DOWNLOAD_MILESTONES = [25, 50, 75] as const;
   export type DownloadMilestone = (typeof DOWNLOAD_MILESTONES)[number];

   export function milestoneCrossed(previousPercent: number | null, nextPercent: number): DownloadMilestone | null {
     const before = previousPercent ?? -1;
     let crossed: DownloadMilestone | null = null;
     for (const milestone of DOWNLOAD_MILESTONES) {
       if (before < milestone && nextPercent >= milestone) crossed = milestone;
     }
     return crossed;
   }

   export function byteParts(bytes: number, locale?: string): { value: string; unit: "mb" | "gb" } {
     const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
     if (safe >= 1e9) {
       return { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(safe / 1e9), unit: "gb" };
     }
     return { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(safe / 1e6), unit: "mb" };
   }

   export function etaParts(seconds: number | null): { unit: "seconds" | "minutes"; count: number } | null {
     if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
     if (seconds < 60) return { unit: "seconds", count: Math.max(5, Math.ceil(seconds / 5) * 5) };
     return { unit: "minutes", count: Math.ceil(seconds / 60) };
   }
   ```

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

   export interface VoiceDownload {
     state: VoiceDownloadState;
     milestone: DownloadMilestone | null;
     start(): void;
     cancel(): void;
   }

   /** Lives in OnboardingFlow so the download outlives the Voice step (ONB-R4 B). */
   export function useVoiceDownload(modelId: string | null): VoiceDownload {
     const [installed, setInstalled] = useState<boolean | null>(null);
     const [samples, setSamples] = useState<RateSample[]>([]);
     const [milestone, setMilestone] = useState<DownloadMilestone | null>(null);
     const [keptBytes, setKeptBytes] = useState<number | null>(null);
     const lastPercentRef = useRef<number | null>(null);
     const modelIdRef = useRef(modelId);
     modelIdRef.current = modelId;

     // Main attests what it kept (owner decision 3); useModelDownload keeps only the message.
     useEffect(
       () =>
         window.electronAPI?.onParakeetDownloadProgress?.((_event, data) => {
           if (data.model !== modelIdRef.current) return;
           if (data.type === "error") setKeptBytes(Number.isFinite(data.keptBytes) ? (data.keptBytes as number) : 0);
           else if (data.type === "progress") setKeptBytes(null);
         }),
       []
     );

     const refresh = useCallback(async () => {
       const requested = modelIdRef.current;
       if (!requested) return setInstalled(null);
       try {
         const result = await window.electronAPI?.checkParakeetModelStatus?.(requested);
         if (modelIdRef.current === requested) setInstalled(Boolean(result?.downloaded));
       } catch {
         if (modelIdRef.current === requested) setInstalled(false);
       }
     }, []);

     const download = useModelDownload({ modelType: "parakeet", onDownloadComplete: () => void refresh() });

     useEffect(() => {
       void refresh();
     }, [modelId, refresh]);

     const active = modelId !== null && download.isDownloadingModel(modelId);
     const { percentage, downloadedBytes } = download.downloadProgress;

     useEffect(() => {
       if (!active) {
         setSamples([]);
         return;
       }
       setSamples((previous) => pushSample(previous, { atMs: Date.now(), bytes: downloadedBytes }));
       const percent = clampPercent(percentage);
       const crossed = milestoneCrossed(lastPercentRef.current, percent);
       lastPercentRef.current = percent;
       if (crossed !== null) setMilestone(crossed);
     }, [active, downloadedBytes, percentage]);

     const state = deriveVoiceDownloadState({
       installed,
       active,
       installing: download.isInstalling,
       progress: download.downloadProgress,
       error: modelId ? (download.downloadErrors[modelId] ?? null) : null,
       lastPercent: lastPercentRef.current,
       keptBytes,
       samples,
     });

     const { downloadModel, cancelDownload } = download;
     const start = useCallback(() => {
       if (!modelIdRef.current) return;
       lastPercentRef.current = null;
       setMilestone(null);
       void downloadModel(modelIdRef.current);
     }, [downloadModel]);
     const cancel = useCallback(() => {
       if (modelIdRef.current) void cancelDownload(modelIdRef.current);
     }, [cancelDownload]);

     return { state, milestone, start, cancel };
   }
   ```

3. Create `src/components/onboarding/onboardingNotices.ts`:

   ```ts
   import type { OnboardingStep } from "../../utils/onboardingState";
   import type { ToastProps } from "../ui/useToast";

   type Toast = (props: Omit<ToastProps, "id">) => unknown;
   type Translate = (key: string, values?: Record<string, unknown>) => string;

   // Spec §5.3. The download can finish or fail while setup shows another step.
   // Until Plan 04's notify() lands, these two calls use the toast API, and this
   // file is the one call site Plan 04 migrates:
   //   announceVoiceReady  -> notify({ kind: "receipt", title })
   //   announceVoiceFailed -> notify({ kind: "alert", title, body, actions: [{ label, onClick: retry }] })
   export function announceVoiceReady(toast: Toast, t: Translate): void {
     toast({ title: t("setupFlow.download.readyTitle"), variant: "success" });
   }

   export function announceVoiceFailed(toast: Toast, t: Translate, message: string, retry: () => void): void {
     toast({
       title: t("setupFlow.download.failedTitle"),
       description: message,
       variant: "destructive",
       actions: [{ label: t("setupFlow.download.retry"), icon: "retry", onClick: retry }],
     });
   }

   /** Voice and Say something show the download inline; other steps need a notice. */
   export function shouldAnnounceOffStep(step: OnboardingStep): boolean {
     return step !== "speech" && step !== "try";
   }
   ```

   If `src/components/ui/notices.ts` already exists when you reach this task (Plan 04 merged), implement the two functions with `notify` exactly as the comment maps them. Keep the `toast` parameter name as `notify` so the tests above still pass with an injected fake.

4. In `src/helpers/downloadUtils.js`, replace the two `unlink` branches at the end of `downloadFile`'s `catch` (328-343) with:

   ```js
         if (error.isAbort) {
           await fsPromises.unlink(tempPath).catch(() => {});
           error.keptBytes = 0;
           throw error;
         }

         if (!isRetryable(error) || attempt >= maxRetries) {
           debugLogger.error("Download failed", {
             url,
             error: error.message,
             code: error.code,
           });
           // A network failure keeps the partial file so the next attempt resumes
           // with a Range request (setup tells the user their progress is kept).
           // HTTP, TLS and size failures start over. Stale temps are swept after 24 h.
           if (isRetryable(error)) {
             error.keptBytes = await fsPromises.stat(tempPath).then(
               (stats) => stats.size,
               () => 0
             );
           } else {
             await fsPromises.unlink(tempPath).catch(() => {});
             error.keptBytes = 0;
           }
           throw error;
         }
   ```

   `parakeet.js` rethrows non-abort errors unchanged (`src/helpers/parakeet.js:461-468`), so `keptBytes` reaches the IPC handler. Its archive-reuse check (364-377) only inspects the final `.tar.bz2`, never the `.tmp`.

5. In `src/helpers/ipcHandlers.js`, in the `download-parakeet-model` catch block, add `keptBytes: Number.isFinite(error.keptBytes) ? error.keptBytes : 0,` to both the `type: "error"` progress payload and the returned `{ success: false, … }` object.

6. In `src/types/electron.ts`, add `keptBytes?: number;` to `ParakeetDownloadProgressData`.

7. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "units": { "mb": "{{value}} MB", "gb": "{{value}} GB", "perSecond": "{{value}}/s" },
       "download": {
         "eta": { "seconds": "about {{count}} s", "minutes": "about {{count}} min" },
         "chip": "Downloading {{percent}}% · {{eta}} left",
         "chipNoEta": "Downloading {{percent}}%",
         "chipInstalling": "Installing voice model",
         "chipReady": "Voice model ready",
         "chipFailed": "Download failed",
         "detail": "{{done}} of {{total}} · {{speed}} · {{eta}} left",
         "detailNoRate": "{{done}} of {{total}}",
         "stoppedKept": "Download stopped at {{percent}}%. Your progress is kept.",
         "stoppedRestart": "Download stopped at {{percent}}%. Retry starts it again.",
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

Run: `npm test -- test/utils/onboardingDownload.test.js test/components/onboardingNotices.test.js test/helpers/downloadUtils.test.js test/helpers && npm run typecheck && npm run i18n:check`
Expected: PASS. The whole `test/helpers` folder runs, because other download tests (`modelManagerBridgeDownloadStatus`, `transcriptionModelDownloadStatus`) share `downloadFile`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingDownload.ts src/components/onboarding/useVoiceDownload.ts src/components/onboarding/onboardingNotices.ts src/helpers/downloadUtils.js src/helpers/ipcHandlers.js src/types/electron.ts src/locales test/utils/onboardingDownload.test.js test/components/onboardingNotices.test.js test/helpers/downloadUtils.test.js
git commit -m "feat(onboarding): keep partial downloads, measured speed and ETA, milestones and notices"
```

---

### Task 8: Preview scenario bridge

ONB-Q18 groundwork. Every new state is previewable, and no production component needs a preview branch.

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
  assert.equal((await (await bridgeFor("insufficient-memory")).api.getSystemProfile()).totalMemoryBytes, 4 * 1024 ** 3);
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
     SystemProfile,
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
   const UNDO_MS = 5000;

   type DownloadResult = {
     success: boolean;
     downloaded?: boolean;
     model: string;
     error?: string;
     code?: string;
     keptBytes?: number;
   };
   type ProgressListener = (event: unknown, data: Record<string, unknown>) => void;
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
     let recording = false;
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
     const emitProgress = (data: Record<string, unknown>) => {
       for (const listener of progressListeners) listener({}, data);
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
             return finish({ success: false, model, error, code: "ECONNRESET", keptBytes });
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
       recording = true;
       emitDemo({ status: "listening" });
       if (scenario() === "microphone-denied") {
         recording = false;
         emitDemo({ status: "error", code: "NotAllowedError", message: "Permission denied" });
         return;
       }
       const quiet = scenario() === "nothing-heard";
       let ticks = 0;
       const level = () => {
         if (!recording) return;
         ticks += 1;
         emitDemo({ status: "level", level: quiet ? 0.003 : 0.04 + 0.04 * Math.abs(Math.sin(ticks / 2)) });
         if (!quiet && ticks === 8) emitDemo({ status: "partial", text: "Remind me to send" });
         later(LEVEL_MS, level);
       };
       later(LEVEL_MS, level);
     }

     function stopTrial() {
       if (!recording) return;
       recording = false;
       clearTrialTimers();
       emitDemo({ status: "processing" });
       later(PROCESS_MS, () => {
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
       recording = false;
       clearTrialTimers();
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
         if (recording) stopTrial();
         else startTrial();
       }
     }

     function reset() {
       if (active) clock.clearTimeout(active.timer);
       active = null;
       downloaded.clear();
       kept.clear();
       interrupted.clear();
       endSession();
     }

     const api = {
       getSystemProfile: async (): Promise<SystemProfile> => ({
         locales: scenario() === "multilingual" ? ["es-ES", "en-US"] : ["en-US"],
         totalMemoryBytes: scenario() === "insufficient-memory" ? 4 * 1024 ** 3 : 16 * 1024 ** 3,
         freeDiskBytes: scenario() === "low-disk" ? 412_000_000 : 212_000_000_000,
         gpu: isMac() ? { kind: "apple-silicon", name: null } : { kind: "unknown", name: null },
       }),
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
         const { model, timer, resolve } = active;
         clock.clearTimeout(timer);
         emitProgress({ type: "error", model, error: "Download cancelled", code: "DOWNLOAD_CANCELLED" });
         resolve({ success: false, model, error: "Download cancelled", code: "DOWNLOAD_CANCELLED" });
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
         if (session?.id !== id || session.kind !== "dictation") return false;
         if (recording) stopTrial();
         else startTrial();
         return true;
       },
       cancelOnboardingDemo: async (id: string) => {
         if (session?.id !== id || !recording) return false;
         recording = false;
         clearTrialTimers();
         emitDemo({ status: "cancelled", undoUntil: clock.now() + UNDO_MS });
         return true;
       },
       undoOnboardingDemoCancel: async (id: string) => {
         if (session?.id !== id) return false;
         emitDemo({ status: "processing" });
         later(PROCESS_MS, () =>
           emitDemo({ status: "success", text: PREVIEW_SENTENCE, rawText: PREVIEW_SENTENCE, cleanup: "skipped" })
         );
         return true;
       },
       onOnboardingDemoEvent: subscribe(demoListeners),
       onDictationHotkeyEvent: subscribe(hotkeyListeners),
     };

     return { api, simulateHotkey, reset };
   }
   ```

2. In `src/preview/browserPreview.ts`, make three edits:
   - Extend `declare global` with `loquiPreviewBridge?: { simulateHotkey(phase: "down" | "up"): void; reset(): void };`.
   - Change `createBrowserPreviewAPI()` to `createBrowserPreviewAPI(setup: ReturnType<typeof createOnboardingScenarioBridge>)`. Delete its entries for `checkParakeetModelStatus`, `modelGetActiveDownloads`, `onParakeetDownloadProgress`, `downloadParakeetModel`, `checkMicrophoneAccess`, `checkAccessibilityPermission` and `openAccessibilitySettings`. Then add `...setup.api,` as the last entry of the returned object.
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
Expected: PASS (10 tests).

Then smoke the preview: run `npm run dev:renderer` and open `http://127.0.0.1:5183/?preview=onboarding&step=speech&scenario=downloading`. The legacy speech step still renders. Its own preview branch stays until Task 13.

- [ ] **Step 5: Commit**

```bash
git add src/preview/onboardingScenarioBridge.ts src/preview/browserPreview.ts src/preview/BrowserPreview.tsx docs/ONBOARDING_PREVIEW.md test/preview/onboardingScenarioBridge.test.js
git commit -m "feat(preview): scenario bridge for downloads, trial, shortcut presses and system profile"
```

---

### Task 9: Component test harness and the radio group

Covers ONB-Q12. It also adds the test harness every later UI task uses.

**Files:**
- Create: `test/helpers/harness/fakeTree.js`. It is moved out of `test/components/onboardingCleanupWiring.test.js:13-95` and extended.
- Create: `test/helpers/harness/mountComponent.js`
- Modify: `test/components/onboardingCleanupWiring.test.js`. Delete the local `installTree` and require it from the helper.
- Create: `src/components/onboarding/radioNavigation.ts`
- Create: `src/components/onboarding/RadioCardGroup.tsx`
- Create: `src/styles/onboarding.css`
- Modify: `src/components/OnboardingFlow.tsx:26`. Add `import "../styles/onboarding.css";` after the guided CSS import.
- Test: `test/components/onboardingRadioGroup.test.js`

**Interfaces:**
- Produces `test/helpers/harness/fakeTree.js`:
  - `installTree()` returns `{ container, click(labelOrNode), press(node, key, extra?), text(), findAll(predicate), byAttr(name, value?), reactProps(node) }`.
- Produces `test/helpers/harness/mountComponent.js`:
  - `mountComponent(t, modulePath, { api?, props?, exportName?, storage?, mocks?, reducedMotion? })` returns that tree plus `{ vite, calls, storage, unmount(), rerender(nextProps) }`. `calls` is `[name, ...args][]` for every `electronAPI` method used.
  - `api` is wrapped in the same no-op `Proxy` the wiring test uses.
  - `react-i18next` and `ui/useToast` are mocked by default.
- Produces `radioNavigation.ts`:
  - `nextRadioIndex(current: number, key: string, disabled: readonly boolean[], dir?: "ltr" | "rtl"): number | null`
  - `rovingTabIndex(index: number, selected: number, disabled: readonly boolean[]): 0 | -1`
- Produces `RadioCardGroup.tsx`:

  ```tsx
  export interface RadioCardOption<T extends string> {
    value: T; label: ReactNode; description?: ReactNode; meta?: ReactNode; badge?: ReactNode;
    disabledReason?: string; // keeps the option focusable-by-name, readable, unselectable
  }
  export interface RadioCardGroupProps<T extends string> {
    label: string; idPrefix: string; options: readonly RadioCardOption<T>[];
    value: T | null; onChange(value: T): void; variant?: "cards" | "segmented"; className?: string;
  }
  export function RadioCardGroup<T extends string>(props: RadioCardGroupProps<T>): JSX.Element;
  ```

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
  assert.equal(nextRadioIndex(1, "ArrowRight", disabled), 0);
  assert.equal(nextRadioIndex(0, "ArrowLeft", disabled), 1);
  assert.equal(nextRadioIndex(0, "ArrowLeft", disabled, "rtl"), 1, "in RTL, left moves forward");
  assert.equal(nextRadioIndex(1, "ArrowRight", disabled, "rtl"), 0);
  assert.equal(nextRadioIndex(2, "Home", [true, false, false]), 1);
  assert.equal(nextRadioIndex(0, "End", [false, false, true]), 1);
  assert.equal(nextRadioIndex(0, "Tab", disabled), null);
  assert.equal(nextRadioIndex(0, "ArrowDown", [true, true]), null);
  assert.equal(rovingTabIndex(2, -1, [true, true, false]), 0, "no selection: the first enabled option is the tab stop");
});

function options() {
  return [
    { value: "a", label: "Fast and English" },
    { value: "b", label: "Many languages" },
    { value: "c", label: "Live captions", disabledReason: "Doesn't hear Japanese" },
  ];
}

test("renders a named radio group with one tab stop and readable disabled reasons", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/RadioCardGroup.tsx", {
    exportName: "RadioCardGroup",
    props: { label: "Voices", idPrefix: "voice", value: "b", onChange() {}, options: options() },
  });
  const [group] = ui.byAttr("role", "radiogroup");
  assert.equal(group.attributes["aria-label"], "Voices");
  const radios = ui.byAttr("role", "radio");
  assert.deepEqual(
    radios.map((radio) => [radio.attributes["aria-checked"], radio.attributes.tabindex]),
    [
      ["false", "-1"],
      ["true", "0"],
      ["false", "-1"],
    ]
  );
  assert.equal(radios[2].attributes["aria-disabled"], "true");
  const [reason] = ui.byAttr("id", radios[2].attributes["aria-describedby"]);
  assert.ok(reason.textContent.includes("Doesn't hear Japanese"));
});

test("arrow keys select, clicks select, and disabled options never do", async (t) => {
  const chosen = [];
  const ui = await mountComponent(t, "/components/onboarding/RadioCardGroup.tsx", {
    exportName: "RadioCardGroup",
    props: { label: "Voices", idPrefix: "voice", value: "b", onChange: (value) => chosen.push(value), options: options() },
  });
  const radios = ui.byAttr("role", "radio");
  await ui.press(radios[1], "ArrowDown");
  await ui.click(radios[0]);
  await ui.click(radios[2]);
  assert.deepEqual(chosen, ["a", "a"]);
});

test("the segmented variant is marked for styling", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/RadioCardGroup.tsx", {
    exportName: "RadioCardGroup",
    props: { label: "Cleanup", idPrefix: "cleanup", value: "a", onChange() {}, options: options(), variant: "segmented" },
  });
  assert.equal(ui.byAttr("role", "radiogroup")[0].attributes["data-variant"], "segmented");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/onboardingRadioGroup.test.js`
Expected: FAIL with `Cannot find module '../helpers/harness/mountComponent'`.

- [ ] **Step 3: Implement**

1. Create `test/helpers/harness/fakeTree.js`:
   - Move `installTree` verbatim from `test/components/onboardingCleanupWiring.test.js:13-95`.
   - Change the `make()` node so that its `style` is `{ setProperty(name, value) { this[name] = String(value); }, removeProperty(name) { delete this[name]; } }`. React writes CSS custom properties through `setProperty`.
   - Add `getAttribute(name) { return name in node.attributes ? node.attributes[name] : null; }`.
   - Change `focus()` to `focus() { document.activeElement = node; }`.
   - Replace the returned object with:

   ```js
     const reactProps = (node) => node[Object.keys(node).find((name) => name.startsWith("__reactProps$"))];
     const findAll = (predicate) => {
       const out = [];
       walk(container, (node) => {
         if (node.nodeType === 1 && predicate(node)) out.push(node);
       });
       return out;
     };
     const byAttr = (name, value) =>
       findAll((node) => (value === undefined ? name in node.attributes : node.attributes[name] === String(value)));
     const eventFor = (node, extra = {}) => ({ preventDefault() {}, stopPropagation() {}, currentTarget: node, target: node, ...extra });
     const click = async (labelOrNode) => {
       const target =
         typeof labelOrNode === "string"
           ? findAll((node) => node.tagName === "BUTTON" && node.textContent.includes(labelOrNode))[0]
           : labelOrNode;
       assert.ok(target, `button containing "${labelOrNode}" is rendered`);
       await React.act(async () => {
         // Handlers may return a pending check; awaiting it would deadlock the test.
         void reactProps(target).onClick?.(eventFor(target));
       });
     };
     const press = async (node, key, extra = {}) => {
       await React.act(async () => {
         void reactProps(node).onKeyDown?.(eventFor(node, { key, repeat: false, ...extra }));
       });
     };
     const text = () => container.textContent;
     return { container, click, press, text, findAll, byAttr, reactProps };
   }

   module.exports = { installTree };
   ```

   At the top of the file, add `const assert = require("node:assert/strict");` and `const React = require("react");`. In `onboardingCleanupWiring.test.js`, replace the deleted function with `const { installTree } = require("../helpers/harness/fakeTree");`. Its tests call `flow.click("…")` and `flow.text()`, which keep working.

2. Create `test/helpers/harness/mountComponent.js`:

   ```js
   const React = require("react");
   const { createRoot } = require("react-dom/client");
   const { createRendererServer, installBrowserGlobals, installHookDom } = require("../../lib/rendererTestHarness");
   const { installTree } = require("./fakeTree");

   // Mounts a real renderer component into the shared fake DOM. Unknown electronAPI
   // methods resolve to no-ops so components can call optional bridges freely.
   // `calls` records every method the component used, known or not, so tests can
   // assert that a step made no implicit downloads or account requests.
   function electronApiProxy(api, calls = []) {
     return new Proxy(api, {
       get(target, name) {
         if (typeof name === "symbol" || name === "then") return target[name];
         const known = target[name];
         if (typeof known !== "function") {
           if (name in target) return known;
           return (...args) => {
             calls.push([String(name), ...args]);
             return /^on[A-Z]/.test(String(name)) ? () => {} : Promise.resolve();
           };
         }
         return (...args) => {
           calls.push([String(name), ...args]);
           return known(...args);
         };
       },
     });
   }

   const I18N_MOCK = [
     "export const useTranslation = () => ({",
     "  t: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),",
     "  i18n: { language: 'en', resolvedLanguage: 'en' },",
     "});",
     "export const Trans = ({ i18nKey }) => i18nKey;",
   ].join("\n");

   const TOAST_MOCK =
     "export const useToast = () => ({ toast: () => 'toast', dismiss() {}, toastCount: 0, dictationErrorActionCount: 0, dismissByPresentation() {} });";

   async function mountComponent(
     t,
     modulePath,
     { api = {}, props = {}, exportName = "default", storage = {}, mocks = {}, reducedMotion = false } = {}
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
         matchMedia: (query) => ({
           matches: reducedMotion && query.includes("reduce"),
           addEventListener() {},
           removeEventListener() {},
         }),
       },
     });
     installHookDom(t);
     const tree = installTree();
     const vite = await createRendererServer(t, {
       cachePrefix: "loqui-onboarding-ui-test-",
       mockModules: { "react-i18next": I18N_MOCK, "ui/useToast": TOAST_MOCK, ...mocks },
     });
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

   module.exports = { mountComponent, electronApiProxy };
   ```

3. Create `src/components/onboarding/radioNavigation.ts`:

   ```ts
   // Radio-group keyboard model (WAI-ARIA APG): arrows move and select, skipping
   // disabled options, wrapping at the ends; left/right follow reading direction.
   export function nextRadioIndex(
     current: number,
     key: string,
     disabled: readonly boolean[],
     dir: "ltr" | "rtl" = "ltr"
   ): number | null {
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
   export function RadioCardGroup<T extends string>({
     label,
     idPrefix,
     options,
     value,
     onChange,
     variant = "cards",
     className,
   }: RadioCardGroupProps<T>) {
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

6. Add `import "../styles/onboarding.css";` to `src/components/OnboardingFlow.tsx` after line 26.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/onboardingRadioGroup.test.js test/components/onboardingCleanupWiring.test.js`
Expected: PASS. The wiring test still passes with the moved helper.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/harness/fakeTree.js test/helpers/harness/mountComponent.js test/components/onboardingCleanupWiring.test.js src/components/onboarding/radioNavigation.ts src/components/onboarding/RadioCardGroup.tsx src/styles/onboarding.css src/components/OnboardingFlow.tsx test/components/onboardingRadioGroup.test.js
git commit -m "feat(onboarding): accessible radio group and a shared component test harness"
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

Covers ONB-R1 C, the ONB-M2 driver, ONB-Q11, Q13, Q15 and Q16, and the shell half of Q4. Keeps ONB-Q1.

**Files:**
- Create: `src/components/onboarding/instrumentMath.ts`
- Create: `src/components/onboarding/InstrumentRail.tsx`
- Create: `src/components/onboarding/OnboardingShell.tsx`
- Modify: `src/styles/onboarding.css` (append)
- Modify: `src/index.css`. Delete the orphaned onboarding rules listed in Step 3.6. They were at lines 225-229, 269-278 and 281-921 at `8267276`; find them by selector.
- Modify: `src/components/ui/ActivationModeSelector.tsx`. Remove the `onboarding` variant at lines 11, 28-35, 43 and 56.
- Modify: `src/components/OnboardingFlow.tsx`. Delete `STEPS` (75-82), `GUIDED_STEP_COPY` (84-129), `StepShell` (143-243), `handleContinue`, `handleBack` and `handleSkip` (1304-1324), and the render at 1415-1426. Replace `config` (1017).
- Modify: `DESIGN.md`. Touch line 151 (Onboarding title), line 160 (the Layout sentence about onboarding), and add `### Onboarding` under `## Components`.
- Modify: `test/components/personalWorkspace.test.js`. Delete the test "first setup reaches completion without account APIs or implicit downloads" (lines 69-96). Its replacement is below.
- Test: `test/components/onboardingShell.test.js` and `test/components/onboardingFlow.test.js`

**Interfaces:**
- Consumes `LevelBars` and `LOGO_BAR_SHAPE` (Plan 01), `phaseProgress`, `canNavigateTo`, `nextStep`, `previousStep` and `markVisited` (Task 1), and `byteParts` and `clampPercent` (Task 7).
- Produces `instrumentMath.ts`:

  ```ts
  export type InstrumentMode =
    | { kind: "idle" }
    | { kind: "download"; percent: number; downloadedBytes: number; totalBytes: number }
    | { kind: "listening"; heardVoice: boolean }
    | { kind: "success" }
    | { kind: "error"; reason: "download" | "microphone" | "noAudio" | "other" };
  export const INSTRUMENT_HEIGHT = 140;
  export const ERROR_FILL = 0.3;
  export function barHeights(height?: number): number[];              // LOGO_BAR_SHAPE × height, rounded
  export function instrumentFills(mode: InstrumentMode): number[];    // 0..1 per bar
  export type InstrumentCaption =
    | { key: "idle" | "goodLevel" | "waiting" | "heard" | "downloadError" | "micError" | "nothingHeard" | "error" }
    | { key: "downloading"; percent: number; done: { value: string; unit: "mb" | "gb" }; total: { value: string; unit: "mb" | "gb" } };
  export function instrumentCaption(mode: InstrumentMode, locale?: string): InstrumentCaption;
  export function dockMark(update: () => void, env: { reducedMotion: boolean; doc?: { startViewTransition?: (cb: () => void) => unknown } }): "transition" | "instant";
  ```

- Produces `InstrumentRail` props: `{ title: string; body: string; mode: InstrumentMode; readLevel?: () => number }`.
- Produces `OnboardingShell`:

  ```tsx
  export interface OnboardingShellProps {
    step: OnboardingStep;
    visited: readonly OnboardingStep[];
    platform: "darwin" | "linux" | "win32";
    rail: InstrumentRailProps;
    docked?: boolean;                       // after the trial success: the mark lives in the header tile
    onNavigate(step: OnboardingStep): void;
    onBack?: () => void;                    // omitted on Hello: no dead Back (ONB-Q11)
    onSkip?: () => void;                    // "Skip this step": advances
    finishLater?: { label: string; onClick(): void }; // exits setup (ONB-Q11)
    primary?: { label: string; onClick(): void; disabled?: boolean; describedBy?: string };
    footerStart?: ReactNode;                // the download chip (Task 14)
    announcement?: string;                  // the one polite live region (milestones)
    children: ReactNode;
  }
  ```

- Produces the i18n keys `setupFlow.{brand,back,skipStep,continue,finishLater,lookAroundFirst}`, `setupFlow.instrument.*` and `setupFlow.rail.<step>.{title,bodyMac,bodyOther}`.

- [ ] **Step 1: Write the failing tests**

Create `test/components/onboardingShell.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");
const { mountComponent } = require("../helpers/harness/mountComponent");

const repoRoot = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const css = () => read("src/styles/onboarding.css");

test("the shell is pinned to the window with 56/64 chrome and clears the traffic lights", () => {
  const source = css();
  assert.match(source, /--onb-header:\s*56px/);
  assert.match(source, /--onb-footer:\s*64px/);
  assert.match(source, /\.onb-shell\s*\{[^}]*height:\s*100dvh/);
  assert.match(source, /\.onb-shell\[data-platform="darwin"\] \.onb-header\s*\{[^}]*padding-inline-start:\s*84px/);
});

test("under 760px the rail collapses to a banner and the controls stay in reach", () => {
  const block = css().match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, "small-window block exists");
  assert.match(block[1], /\.onb-main\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(block[1], /\.onb-instrument\s*\{[^}]*display:\s*none/);
});

test("setup styles use tokens only: no hex, no raw durations, no text under 12px", () => {
  const source = css();
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
  for (const line of source.split("\n").filter((l) => /^\s*(transition|animation)(-duration)?\s*:/.test(l))) {
    assert.match(line, /var\(--motion-|none/, line.trim());
  }
  for (const [, size] of source.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(size) >= 12, `${size}px`);
});

test("rail text and bars meet contrast in light and Plum Night", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(read("src/index.css"));
  assert.ok(contrastRatio(light["--color-live-foreground"], light["--color-live"]) >= 4.5, "rail text, light");
  assert.ok(contrastRatio(light["--color-background"], light["--color-live"]) >= 3, "paper bars on the orange rail");
  assert.ok(contrastRatio(dark["--color-foreground"], dark["--color-surface-1"]) >= 4.5, "rail text, dark");
});

test("the orphaned onboarding system is gone", () => {
  const index = read("src/index.css");
  for (const selector of [
    ".onboarding-canvas",
    ".onboarding-keycap",
    ".onboarding-step-enter",
    ".onboarding-stagger",
    ".onboarding-pressable",
    ".onboarding-list",
    ".onboarding-select",
    ".onboarding-compact-hero",
    ".onboarding-typing-dot",
    ".onboarding-display-title",
    ".onboarding-light-input",
    ".onboarding-provider-input",
    ".onboarding-embedded-auth",
    ".onboarding-card-title",
    "--onboarding-accent",
    "--onboarding-keycap-top",
  ]) {
    assert.equal(index.includes(selector), false, selector);
  }
  assert.equal(read("src/components/ui/ActivationModeSelector.tsx").includes("onboarding"), false);
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

test("progress is a nav of the current phase; only visited steps are buttons you can use", async (t) => {
  const visited = [];
  const ui = await mountComponent(t, "/components/onboarding/OnboardingShell.tsx", {
    exportName: "OnboardingShell",
    props: shellProps({ onNavigate: (step) => visited.push(step) }),
  });
  const [nav] = ui.byAttr("aria-label", "setupFlow.progress.nav");
  assert.ok(nav);
  const steps = ui.findAll((node) => node.attributes.class === "onb-progress__step");
  assert.deepEqual(
    steps.map((node) => [node.attributes["data-state"], "disabled" in node.attributes, node.attributes["aria-current"] ?? null]),
    [
      ["done", false, null],
      ["current", true, "step"],
      ["todo", true, null],
    ]
  );
  await ui.click(steps[0]);
  assert.deepEqual(visited, ["welcome"]);
  assert.equal(ui.byAttr("data-platform", "darwin").length, 1);
});

test("Hello has no Back, the primary is the neutral capsule, and Ready shows no segments", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/OnboardingShell.tsx", {
    exportName: "OnboardingShell",
    props: shellProps({ step: "welcome", visited: ["welcome"], onBack: undefined }),
  });
  assert.equal(ui.text().includes("setupFlow.back"), false);
  const [primary] = ui.byAttr("data-onb-primary");
  assert.equal(primary.attributes["data-variant"], "default");
  await ui.rerender({ step: "finish", visited: ["welcome", "finish"] });
  assert.equal(ui.findAll((node) => node.attributes.class === "onb-progress__step").length, 0);
  assert.ok(ui.text().includes("setupFlow.progress.ready"));
});

test("the instrument fills with the download and always says the number", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    props: {
      title: "Say something.",
      body: "Not saved.",
      mode: { kind: "download", percent: 41.6, downloadedBytes: 264e6, totalBytes: 631e6 },
    },
  });
  const fills = ui.findAll((node) => node.attributes.class === "onb-bar__fill");
  assert.equal(fills.length, 5);
  assert.ok(fills.every((node) => node.style["--fill"] === "0.42"));
  assert.ok(ui.text().includes("setupFlow.instrument.downloading"));
  assert.ok(ui.text().includes('"percent":42'));
  assert.equal(ui.byAttr("aria-hidden", "true").some((node) => node.attributes.class === "onb-instrument"), true);
});

test("listening hands the bars to LevelBars; errors drop them to 30%", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/InstrumentRail.tsx", {
    exportName: "InstrumentRail",
    props: { title: "Hello", body: "", mode: { kind: "listening", heardVoice: false }, readLevel: () => 0 },
  });
  assert.equal(ui.byAttr("data-level-bar").length, 5);
  assert.ok(ui.text().includes("setupFlow.instrument.waiting"));
  await ui.rerender({ mode: { kind: "error", reason: "noAudio" } });
  const fills = ui.findAll((node) => node.attributes.class === "onb-bar__fill");
  assert.ok(fills.every((node) => node.style["--fill"] === "0.3"));
  assert.ok(ui.text().includes("setupFlow.instrument.nothingHeard"));
});

test("the dock uses a View Transition unless motion is reduced or unsupported", async () => {
  const { dockMark } = await import("../../src/components/onboarding/instrumentMath.ts");
  let updates = 0;
  const update = () => updates++;
  const doc = { startViewTransition: (callback) => callback() };
  assert.equal(dockMark(update, { reducedMotion: false, doc }), "transition");
  assert.equal(dockMark(update, { reducedMotion: true, doc }), "instant");
  assert.equal(dockMark(update, { reducedMotion: false, doc: {} }), "instant");
  assert.equal(updates, 3);
});
```

Create `test/components/onboardingFlow.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const PREVIEW = { step: "speech", scenario: "ready", platform: "linux" };

async function mountFlow(t, props = {}, options = {}) {
  let completed = [];
  const ui = await mountComponent(t, "/components/OnboardingFlow.tsx", {
    props: { onComplete: (opts) => completed.push(opts ?? null), previewConfig: PREVIEW, initialStep: "speech", ...props },
    mocks: { "/SettingsPage": "export default function SettingsPage() { return null; }" },
    ...options,
  });
  return { ui, completed: () => completed };
}

const primary = (ui) => ui.byAttr("data-onb-primary")[0];
const buttonWithText = (ui, text) => ui.findAll((node) => node.tagName === "BUTTON" && node.textContent.includes(text))[0];

// The footer primary when there is one; Say something has none (its band owns the
// next step), so the walk skips it; Ready ends through its own Open workspace.
async function advance(ui) {
  const target = primary(ui) ?? buttonWithText(ui, "setupFlow.skipStep") ?? buttonWithText(ui, "setupFlow.ready.openWorkspace");
  await ui.click(target);
}

test("Continue walks both phases in order and Ready completes setup once", async (t) => {
  const { ui, completed } = await mountFlow(t);
  const seen = [];
  for (let guard = 0; guard < 8 && completed().length === 0; guard++) {
    seen.push(ui.byAttr("aria-current", "step")[0]?.attributes["aria-label"] ?? "ready");
    await advance(ui);
  }
  assert.deepEqual(seen, [
    'setupFlow.progress.goTo {"step":"setupFlow.steps.speech"}',
    'setupFlow.progress.goTo {"step":"setupFlow.steps.try"}',
    'setupFlow.progress.goTo {"step":"setupFlow.steps.cleanup"}',
    'setupFlow.progress.goTo {"step":"setupFlow.steps.shortcuts"}',
    "ready",
  ]);
  assert.equal(completed().length, 1);
});

test("Finish later exits from any step and remembers where you were", async (t) => {
  const { ui, completed } = await mountFlow(t, { initialStep: "cleanup" });
  await ui.click("setupFlow.finishLater");
  assert.equal(completed().length, 1);
  const stored = JSON.parse(ui.storage.getItem("loqui.onboarding.preview.linux.ready"));
  assert.equal(stored.step, "cleanup");
  assert.equal(stored.explored, true);
  assert.deepEqual(stored.visited, ["cleanup"]);
});

test("Back goes to the previous step in the new order", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "cleanup" });
  await ui.click("setupFlow.back");
  assert.equal(ui.byAttr("aria-current", "step")[0].attributes["aria-label"], 'setupFlow.progress.goTo {"step":"setupFlow.steps.try"}');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/onboardingShell.test.js test/components/onboardingFlow.test.js`
Expected: FAIL. `.onb-shell` is missing, the shell and rail modules are missing, orphaned selectors are still in `index.css`, and the flow has no `data-onb-primary`.

- [ ] **Step 3: Implement**

1. Create `src/components/onboarding/instrumentMath.ts`:

   ```ts
   import { LOGO_BAR_SHAPE } from "../ui/levelBarsMath";
   import { byteParts, clampPercent } from "../../utils/onboardingDownload";

   // The five bars of the mark are setup's one hero (ONB-R1 C, ONB-M2): they
   // breathe when idle, fill with the download, follow the voice, drop to 30% in
   // amber on error, and dock into the header on the first success.
   export type InstrumentMode =
     | { kind: "idle" }
     | { kind: "download"; percent: number; downloadedBytes: number; totalBytes: number }
     | { kind: "listening"; heardVoice: boolean }
     | { kind: "success" }
     | { kind: "error"; reason: "download" | "microphone" | "noAudio" | "other" };

   export const INSTRUMENT_HEIGHT = 140;
   export const ERROR_FILL = 0.3;

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
     | { key: "idle" | "goodLevel" | "waiting" | "heard" | "downloadError" | "micError" | "nothingHeard" | "error" }
     | { key: "downloading"; percent: number; done: ByteParts; total: ByteParts };

   const ERROR_CAPTIONS = {
     download: "downloadError",
     microphone: "micError",
     noAudio: "nothingHeard",
     other: "error",
   } as const;

   export function instrumentCaption(mode: InstrumentMode, locale?: string): InstrumentCaption {
     switch (mode.kind) {
       case "download":
         return {
           key: "downloading",
           percent: clampPercent(mode.percent),
           done: byteParts(mode.downloadedBytes, locale),
           total: byteParts(mode.totalBytes, locale),
         };
       case "listening":
         return { key: mode.heardVoice ? "goodLevel" : "waiting" };
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

2. Create `src/components/onboarding/InstrumentRail.tsx`:

   ```tsx
   import type { CSSProperties } from "react";
   import { useTranslation } from "react-i18next";
   import { LevelBars } from "../ui/LevelBars";
   import {
     INSTRUMENT_HEIGHT,
     barHeights,
     instrumentCaption,
     instrumentFills,
     type InstrumentMode,
   } from "./instrumentMath";

   export interface InstrumentRailProps {
     title: string;
     body: string;
     mode: InstrumentMode;
     readLevel?: () => number;
   }

   export function InstrumentRail({ title, body, mode, readLevel }: InstrumentRailProps) {
     const { t, i18n } = useTranslation();
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
         <div className="onb-instrument" data-mode={mode.kind} aria-hidden="true">
           {mode.kind === "listening" && readLevel ? (
             <LevelBars readLevel={readLevel} height={INSTRUMENT_HEIGHT} />
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

3. Create `src/components/onboarding/OnboardingShell.tsx`:

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

   export function OnboardingShell({
     step,
     visited,
     platform,
     rail,
     docked = false,
     onNavigate,
     onBack,
     onSkip,
     finishLater,
     primary,
     footerStart,
     announcement,
     children,
   }: OnboardingShellProps) {
     const { t } = useTranslation();
     const mainRef = useRef<HTMLDivElement>(null);
     const progress = phaseProgress(step);
     const stepLabel = t(`setupFlow.steps.${step}`);

     // Keep the existing behaviour: every step change moves focus to its heading.
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
             <Button
               data-onb-primary=""
               onClick={primary.onClick}
               disabled={primary.disabled}
               aria-describedby={primary.describedBy}
             >
               {primary.label}
               <ArrowRight aria-hidden="true" className="rtl:-scale-x-100" />
             </Button>
           ) : null}
         </footer>
         <p className="sr-only" aria-live="polite">
           {announcement ?? ""}
         </p>
       </div>
     );
   }
   ```

4. Append to `src/styles/onboarding.css`:

   ```css
   /* Shell: pinned to the window (ONB-Q1), 56px header and 64px footer (ONB-Q13). */
   .onb-shell {
     --onb-header: 56px;
     --onb-footer: 64px;
     display: grid;
     grid-template-rows: var(--onb-header) minmax(0, 1fr) var(--onb-footer);
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
     padding-inline: 24px;
     border-bottom: 1px solid var(--color-border);
     -webkit-app-region: drag;
   }

   .onb-header button {
     -webkit-app-region: no-drag;
   }

   /* The macOS traffic lights sit at x20 and are about 52px wide. */
   .onb-shell[data-platform="darwin"] .onb-header {
     padding-inline-start: 84px;
   }

   .onb-brand {
     display: flex;
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
     margin-inline-start: auto;
     font-size: 12px;
     color: var(--color-muted-foreground);
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
     background: var(--color-border);
   }

   .onb-progress__step::after {
     content: "";
     position: absolute;
     inset: -9px 0;
   }

   .onb-progress__step[data-state="done"],
   .onb-progress__step[data-state="current"] {
     background: var(--color-live);
   }

   .onb-progress__step:not(:disabled) {
     cursor: pointer;
   }

   .onb-header__later,
   .onb-footer__skip {
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
     padding: 28px clamp(24px, 4vw, 48px);
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
     align-items: center;
     gap: 12px;
     padding-inline: 24px;
     border-top: 1px solid var(--color-border);
   }

   .onb-footer__start {
     flex: 1;
     min-width: 0;
   }

   /* The rail: orange in light (ink text 5.75:1, paper bars 3.12:1); a warm
      Plum Night surface in dark. ONB-Q16: 36px/650 title, tokens only. */
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
     background: linear-gradient(
       160deg,
       color-mix(in oklab, var(--color-live) 14%, var(--color-surface-1)),
       var(--color-surface-1) 60%
     );
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
     display: flex;
     align-items: flex-end;
     justify-content: center;
     gap: 20px;
     height: 150px;
     margin-top: auto;
     view-transition-name: loqui-mark;
   }

   .onb-shell[data-docked] .onb-instrument {
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
     transition:
       transform var(--motion-fast) var(--motion-ease-std),
       background-color var(--motion-fast) var(--motion-ease-std);
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

   .onb-instrument[data-mode="error"] .onb-bar__fill {
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

   /* LevelBars paints its brand gradient inline; on the light orange rail the bars
      are paper. Drop this rule when LevelBars gains a tone prop (contract change
      request 4). */
   html:not(.dark) .onb-rail [data-level-bar] {
     background: var(--color-background) !important;
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
   }

   @media (prefers-reduced-motion: reduce) {
     .onb-step {
       animation: onb-fade var(--motion-base) var(--motion-ease-std) both !important;
     }
     .onb-instrument[data-mode="idle"] .onb-bar__fill {
       animation: none !important;
     }
   }
   ```

5. Rewrite the navigation and render parts of `src/components/OnboardingFlow.tsx`:
   - Delete `STEPS`, `GUIDED_STEP_COPY`, `StepShell`, `handleContinue`, `handleBack`, `handleSkip`, the `persist` helper, and the final `<StepShell>` render.
   - Leave the welcome branch (`if (step === "welcome") return <WelcomeScreen …/>`) as it is. Task 12 replaces it.
   - Leave the legacy `content` computation for the other steps (1335-1397) as it is.
   - Replace line 1017 with `const config = previewConfig;`. The preview passes the prop, and production code no longer reads the preview global.
   - Add these imports:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { OnboardingShell } from "./onboarding/OnboardingShell";
   import type { InstrumentMode } from "./onboarding/instrumentMath";
   import { markVisited, nextStep, previousStep } from "../utils/onboardingFlow";
   ```

   Replace the `progress`/`step` state and `goTo`/`explore`/`finish` (1023-1026, 1126-1152) with:

   ```tsx
   const { t } = useTranslation();
   const firstStep = initialStep ?? config?.step ?? storedProgress.step;
   const [step, setStep] = useState<OnboardingStep>(firstStep);
   const [visited, setVisited] = useState<OnboardingStep[]>(() => markVisited(storedProgress.visited, firstStep));
   const deviceKey = platform === "darwin" ? "Mac" : "Other";

   useEffect(() => {
     writeOnboardingProgress({ step, visited }, progressStorageKey);
   }, [progressStorageKey, step, visited]);

   const goTo = useCallback((next: OnboardingStep) => {
     setStep(next);
     setVisited((current) => markVisited(current, next));
   }, []);

   const finish = useCallback(
     (options?: { openSettings?: boolean }) => {
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

   const advance = () => {
     if (step === "cleanup") applyCleanupToOtherTasks();
     const next = nextStep(step);
     if (next) goTo(next);
     else finish();
   };

   const skip = () => {
     const next = nextStep(step);
     if (next) goTo(next);
     else finish();
   };

   const back = () => {
     const previous = previousStep(step);
     if (previous) goTo(previous);
   };
   ```

   Then replace the final render with the code below. Each later step task replaces one `railMode`/`primary`/`children` branch.

   ```tsx
   const legacy = (node: ReactNode) => <div className="onboarding-welcome onboarding-guided onb-legacy">{node}</div>;
   const railMode: InstrumentMode = { kind: "idle" };

   return (
     <OnboardingShell
       step={step}
       visited={visited}
       platform={platform}
       rail={{
         title: t(`setupFlow.rail.${step}.title`),
         body: t(`setupFlow.rail.${step}.body${deviceKey}`),
         mode: railMode,
       }}
       onNavigate={goTo}
       onBack={step === "welcome" ? undefined : back}
       onSkip={step === "finish" ? undefined : skip}
       finishLater={step === "finish" ? undefined : { label: t("setupFlow.finishLater"), onClick: finishLater }}
       primary={{
         label: step === "finish" ? t("setupFlow.rail.finish.openWorkspace") : t("setupFlow.continue"),
         onClick: advance,
       }}
     >
       {legacy(content)}
     </OnboardingShell>
   );
   ```

   - The legacy `FinishStep` keeps `onResume={goTo}`.
   - The legacy `try` step's `onTrialFinished` is unchanged until Task 15.
   - Delete the now-unused `progress` and `setProgress` state (1023). `explore` is replaced by `finishLater`.
   - Change the `WelcomeScreen` props from `onContinue={() => goTo("speech")}` and `onExplore={explore}` to `onContinue={() => goTo("speech")}` and `onExplore={finishLater}`.

6. In `src/index.css`, delete these blocks, finding each by its selector. Do not edit anything else. Plan 01's motion tokens sit next to `--onboarding-ease-out`, which stays.
   - `body:has(.onboarding-canvas.compact), body:has(.onboarding-canvas.compact) #root { … }` and the comment above it.
   - Inside the reduced-motion block: the `.onboarding-step-enter, .onboarding-stagger > * { … }` and `.onboarding-pressable:active { … }` rules with their comments. Keep `@keyframes reduced-motion-fade-in` only if something else uses it (`grep -n "reduced-motion-fade-in" src -r`). Otherwise delete it too.
   - Every rule from `.onboarding-canvas, body:has(.onboarding-canvas) {` through `.onboarding-shell-scroll { … }`. That covers the token blocks and their dark overrides, `.onboarding-embedded-auth`, the `.onboarding-canvas` remap, `.onboarding-card-title`, the `onboarding-step-in` keyframes, `.onboarding-step-enter`, `.onboarding-stagger`, `.onboarding-pressable`, `.onboarding-list*`, `.onboarding-select-*`, `.onboarding-canvas.compact`, `.onboarding-compact-hero`, the disabled primary, `onboarding-typing-dot`, `.onboarding-canvas kbd`, `.onboarding-keycap`, `.onboarding-display-title`, the `.onboarding-*-input` rules, `.onboarding-provider-icon-monochrome`, `.onboarding-scroll-hidden` and `.onboarding-shell-scroll`.
   - Before deleting, run `grep -rn "onboarding-canvas\|onboarding-keycap\|onboarding-list\|onboarding-select\|onboarding-provider\|onboarding-light-input\|onboarding-auth-input\|onboarding-embedded-auth\|onboarding-card-title\|onboarding-display-title\|onboarding-scroll-hidden\|onboarding-shell-scroll\|onboarding-pressable\|onboarding-stagger\|onboarding-step-enter\|onboarding-typing-dot\|onboarding-compact-hero" src --include=*.tsx --include=*.jsx --include=*.ts --include=*.js`. Expected: only comments (for example `src/renderApp.jsx:18`). If a component uses one, stop and report. Do not delete a live rule.

7. In `src/components/ui/ActivationModeSelector.tsx`:
   - Delete the `variant` prop and its doc comment (lines 10-11).
   - Delete the `onboarding` entry of `STYLES` (28-35).
   - Delete the `variant = "default"` destructuring (43).
   - Use `STYLES.default` directly.
   - Replace `style={{ "--inset": variant === "onboarding" ? "4px" : "2px" }}` with `style={{ "--inset": "2px" }}`.
   - No caller passes `variant` (`SettingsPage.tsx:2618`).

8. In `DESIGN.md`:
   - Change line 151 to `- **Onboarding title** (650, 36px, 1.1 line-height, -0.025em tracking): The setup rail heading; 22px in windows under 760px.`
   - Replace the Layout sentence "Onboarding uses a narrower 48rem content column, wider side padding at larger window sizes, and a persistent progress header and footer." with "Setup is a pinned window: a 56px header with per-phase progress, a 36% orange rail beside the controls (a 72px banner under 760px), and a 64px footer."
   - Add after `### Voice Pill`:

   ```markdown
   ### Onboarding

   The setup rail is the instrument: the five bars of the mark breathe when idle, fill bottom-up with the voice download, follow the microphone while listening, drop to 30% in warning amber on error, and dock into the 32px header tile (View Transition, `--motion-slow`) on the first successful dictation. A numeric caption sits under the bars, so progress is never motion-only. Light theme: orange rail (`--color-live`), ink text, paper bars. Plum Night: a warm surface gradient with orange-to-magenta bars. Primary actions are the neutral ink capsule; `live` is reserved for record, stop, "Allow microphone", the ready-block mic and "Dictate into a note". Readiness icons use `--color-success` and `--color-warning`; their words stay in foreground colours.
   ```

9. Delete the test "first setup reaches completion without account APIs or implicit downloads" from `test/components/personalWorkspace.test.js` (lines 69-96). `onboardingFlow.test.js` replaces it.

10. Add the strings:

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
          "heard": "Heard you",
          "downloadError": "Download stopped",
          "micError": "Loqui can't hear your microphone",
          "nothingHeard": "Nothing heard. Check your microphone.",
          "error": "That didn't work. Try again."
        },
        "rail": {
          "welcome": {
            "title": "Talk. Loqui types.",
            "bodyMac": "Dictate anywhere, keep notes and meetings in one place, and choose exactly what ever leaves your Mac.",
            "bodyOther": "Dictate anywhere, keep notes and meetings in one place, and choose exactly what ever leaves your computer."
          },
          "speech": {
            "title": "Pick how Loqui listens.",
            "bodyMac": "One recommended voice. It runs on this Mac and works offline.",
            "bodyOther": "One recommended voice. It runs on this computer and works offline."
          },
          "try": {
            "title": "Say something.",
            "bodyMac": "This test is not pasted into another app or saved to history.",
            "bodyOther": "This test is not pasted into another app or saved to history."
          },
          "cleanup": {
            "title": "Make it read well.",
            "bodyMac": "See what cleanup does to your own words, then choose.",
            "bodyOther": "See what cleanup does to your own words, then choose."
          },
          "shortcuts": {
            "title": "Talk from any app.",
            "bodyMac": "Press your shortcut anywhere. Change it if it clashes with another app.",
            "bodyOther": "Press your shortcut anywhere. Change it if it clashes with another app."
          },
          "finish": {
            "title": "Here is where you are.",
            "bodyMac": "Everything below is true right now.",
            "bodyOther": "Everything below is true right now.",
            "openWorkspace": "Open workspace"
          }
        }
      }
    }
    JSON
    npx prettier --write "src/locales/**/translation.json"
    ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/onboardingShell.test.js test/components/onboardingFlow.test.js test/components/personalWorkspace.test.js test/components/onboardingCleanupWiring.test.js test/components/motionTokens.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Then open `?preview=onboarding&step=speech&scenario=fresh` at 1440×900, 900×640 and 640×560, in light and dark. Check:
- the footer is flush with the window bottom;
- on macOS the header clears the traffic lights;
- at 640×560 the controls start right under a 72px banner.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/instrumentMath.ts src/components/onboarding/InstrumentRail.tsx src/components/onboarding/OnboardingShell.tsx src/styles/onboarding.css src/index.css src/components/ui/ActivationModeSelector.tsx src/components/OnboardingFlow.tsx DESIGN.md src/locales test/components/onboardingShell.test.js test/components/onboardingFlow.test.js test/components/personalWorkspace.test.js
git commit -m "feat(onboarding): pinned two-phase shell with the instrument rail"
```

---

### Task 12: Hello (Phase 1, screen 1)

Covers ONB-R2 B "Hello: mic permission and level", ONB-Q6 on this screen, part of ONB-Q17, and owner decision 6 (a microphone picker). The privacy toggles move to Ready (owner decision 2).

**Files:**
- Create: `src/utils/onboardingMic.ts`
- Create: `src/components/onboarding/useMicLevelPreview.ts`
- Create: `src/components/onboarding/HelloStep.tsx`
- Create: `src/components/onboarding/PrivacyDefaults.tsx`
- Delete: `src/components/onboarding/WelcomeScreen.tsx`
- Modify: `src/components/OnboardingFlow.tsx`. Touch the `WelcomeScreen` import (23), the welcome early return (1399-1413), and the legacy `FinishStep` (931-1008), which gains `<PrivacyDefaults>`. Move `import "../styles/onboarding-welcome.css";` here, because it was only imported by `WelcomeScreen.tsx:5`.
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
  }
  export function useMicLevelPreview(active: boolean, deviceId?: string | null): MicLevelPreview; // releases every track when inactive, on device change, or unmounted
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
const { mountComponent } = require("../helpers/harness/mountComponent");

const preview = (patch = {}) => ({
  status: "off",
  deviceLabel: null,
  heardVoice: false,
  silent: false,
  inputs: [],
  readLevel: () => 0,
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
  assert.ok(ui.text().includes('setupFlow.hello.micReady {"device":"MacBook Pro Microphone"}'));
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

test("a microphone that will not open says so instead of showing a dead meter", async (t) => {
  const { ui } = await hello(t, { access: "granted", preview: preview({ status: "failed" }) });
  assert.ok(ui.text().includes("setupFlow.hello.unavailableTitle"));
  assert.equal(ui.byAttr("data-level-bar").length, 0);
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
  const previousDevices = Object.getOwnPropertyDescriptor(globalThis.navigator, "mediaDevices");
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (constraints) => {
        opened.push(constraints);
        const track = { label: `Mic ${opened.length}`, stop: () => stopped.push(opened.length) };
        return { getTracks: () => [track], getAudioTracks: () => [track] };
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
  const render = async (props) => {
    await React.act(async () => root.render(React.createElement(Harness, props)));
    await React.act(async () => {}); // let getUserMedia and enumerateDevices settle
  };
  return { render, current: () => current, opened, stopped, closed };
}

test("the preview lists inputs and reopens on the picked device", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  assert.equal(mic.current().status, "live");
  assert.deepEqual(mic.current().inputs.map((input) => input.deviceId), ["usb"]);
  await mic.render({ active: true, deviceId: "usb" });
  assert.deepEqual(mic.opened, [{ audio: true }, { audio: { deviceId: { exact: "usb" } } }]);
  assert.deepEqual(mic.stopped, [1], "the first stream is released before the second opens");
});

test("leaving Hello stops the microphone", async (t) => {
  const mic = await mountPreview(t);
  await mic.render({ active: true, deviceId: null });
  await mic.render({ active: false, deviceId: null });
  assert.deepEqual([mic.stopped, mic.closed, mic.current().status], [[1], ["context"], "off"]);
});
```

Change the flow test in `test/components/onboardingFlow.test.js` so the walk starts at Hello:
- In `mountFlow`'s defaults, replace `initialStep: "speech"` with `"welcome"`.
- In `PREVIEW`, replace `step: "speech"` with `"welcome"`.
- Prepend `'setupFlow.progress.goTo {"step":"setupFlow.steps.welcome"}'` to the expected `seen` list.

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
   }

   const SAMPLE_MS = 80;

   /**
    * A level meter for Hello. Nothing is recorded: the stream feeds an analyser
    * only, and every track is stopped when Hello is left or the device changes
    * (Review Focus 2).
    */
   export function useMicLevelPreview(active: boolean, deviceId: string | null = null): MicLevelPreview {
     const levelRef = useRef(0);
     const [state, setState] = useState<Omit<MicLevelPreview, "readLevel">>({
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
       setState((previous) => ({ ...previous, status: "starting", heardVoice: false, silent: false }));
       void (async () => {
         try {
           stream = await devices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
           if (cancelled) return;
           context = new AudioContext();
           const analyser = context.createAnalyser();
           analyser.fftSize = 1024;
           context.createMediaStreamSource(stream).connect(analyser);
           const buffer: { current: Float32Array<ArrayBuffer> | null } = { current: null };
           setState((previous) => ({ ...previous, status: "live", deviceLabel: stream?.getAudioTracks()[0]?.label || null }));
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
           if (!cancelled) setState((previous) => ({ ...previous, status: "failed" }));
         }
       })();
       return () => {
         cancelled = true;
         if (timer) clearInterval(timer);
         if (silenceTimer) clearTimeout(silenceTimer);
         devices?.removeEventListener?.("devicechange", listInputs);
         stream?.getTracks().forEach((track) => track.stop());
         void context?.close();
         levelRef.current = 0;
       };
     }, [active, deviceId]);

     const readLevel = useCallback(() => levelRef.current, []);
     return { ...state, readLevel };
   }
   ```

   If `getUserMedia` resolves after the effect was cleaned up, the stream is still stopped in the cleanup above, because `stream` is assigned before the `cancelled` check.

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
             { label: t("setupFlow.hello.openSound"), onClick: () => void window.electronAPI?.openSoundInputSettings?.() },
             recheck,
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
   - Delete the `WelcomeScreen` import. Add imports for `HelloStep`, `PrivacyDefaults`, `useMicrophoneAccess`, `useMicLevelPreview`, `micPickerModel` and `selectionFor`.
   - Add `import "../styles/onboarding-welcome.css";`. The legacy wrapper still needs it until Task 18.
   - Delete the welcome early return (1399-1413).
   - Add:

   ```tsx
   const mic = useMicrophoneAccess();
   const micMode = useSettingsStore((s) => s.microphoneSelectionMode);
   const micId = useSettingsStore((s) => s.selectedMicDeviceId);
   const micLabel = useSettingsStore((s) => s.selectedMicDeviceLabel);
   const [helloInputs, setHelloInputs] = useState<AudioInput[]>([]);
   const micPicker = micPickerModel(helloInputs, micMode, micId, micLabel);
   const helloPreview = useMicLevelPreview(step === "welcome" && mic.access === "granted", micPicker.previewDeviceId);
   useEffect(() => setHelloInputs(helloPreview.inputs), [helloPreview.inputs]);

   // An explicit pick on Hello writes the same settings MicrophoneSettings does.
   const pickMicrophone = (value: string) => {
     const { mode, device } = selectionFor(value, helloInputs);
     const store = useSettingsStore.getState();
     store.setMicrophoneSelectionMode(mode);
     if (device) store.setSelectedMicDevice(device.deviceId, device.label);
   };
   ```

   The picker model reads the previous render's inputs, which breaks the dependency loop between "which device to open" and "which devices exist". When the saved device resolves, the preview reopens on it once.

   Then branch the shell props on `step === "welcome"`:
   - `railMode` is `helloPreview.status === "live" ? { kind: "listening", heardVoice: helloPreview.heardVoice } : { kind: "idle" }`.
   - The rail gets `readLevel: helloPreview.readLevel`.
   - `primary` is `{ label: t("setupFlow.hello.start"), onClick: advance }`.
   - `finishLater.label` is `t("setupFlow.lookAroundFirst")`.
   - `onSkip` is `undefined`. Hello has nothing to skip.
   - The children are:

   ```tsx
   <HelloStep
     platform={platform}
     access={mic.access}
     preview={helloPreview}
     picker={micPicker}
     onPickMicrophone={pickMicrophone}
     onAllow={() => void mic.request()}
     onRecheck={() => void mic.check()}
   />
   ```

   Inside the legacy `FinishStep` (rendered from `content` for `finish`), add `<PrivacyDefaults>` under the readiness list. Pass it:
   - `platform`;
   - `dataRetentionEnabled` and `setDataRetentionEnabled`;
   - the existing `updatesEnabled`, with an `onUpdatesChange` that sets state and calls `window.electronAPI?.updates?.preferences?.({ enabled: value })`. That is the same call `WelcomeScreen` made at line 1405.

6. Delete `src/components/onboarding/WelcomeScreen.tsx`.

7. Append to `src/styles/onboarding.css`:

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

8. Add the strings:

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

Run: `npm test -- test/utils/onboardingMic.test.js test/components/onboardingHello.test.js test/components/onboardingFlow.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Preview: open `?preview=onboarding&step=welcome&scenario=fresh`. Check:
- "Allow microphone" turns into a live meter and a microphone picker;
- picking another input reopens the meter on it;
- the rail bars follow your voice;
- after 2.5 s of silence the picker is highlighted.

With `scenario=microphone-denied` you get one recovery card. The picker runs on the browser's real `navigator.mediaDevices`; it needs no bridge fake.

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingMic.ts src/components/onboarding/useMicLevelPreview.ts src/components/onboarding/HelloStep.tsx src/components/onboarding/PrivacyDefaults.tsx src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/utils/onboardingMic.test.js test/components/onboardingHello.test.js test/components/onboardingFlow.test.js
git rm src/components/onboarding/WelcomeScreen.tsx
git commit -m "feat(onboarding): Hello asks for the microphone, shows it listening, and lets you pick it"
```

---

### Task 13: Voice, detected for you

Covers ONB-R3 C under D8, the start of ONB-R4 B ("the download starts when Voice completes"), ONB-Q12 for voices, and Q17 ("Pick how Loqui listens.", "Download (631 MB)").

**Files:**
- Create: `src/components/onboarding/useSystemProfile.ts`
- Create: `src/components/onboarding/VoiceStep.tsx`
- Modify: `src/utils/onboardingDetection.ts`. Add `spokenLocalesFor`.
- Modify: `src/components/OnboardingFlow.tsx`. Delete these, replacing them with the wiring in Step 3.3:
  - `SpeechStep` (319-463) and its imports (`LanguageSelector`, `ONBOARDING_SPEECH_MODELS` and friends, `Cpu`, `Download`);
  - the `selectedModel`/`selectedModelRef`/`speechModelReady`/`downloadState` state (1027-1057);
  - the model-status effect (1093-1108) and the preview download timer (1110-1114);
  - `downloadModel` (1154-1187) and the inline `onSelectModel` (1343-1363);
  - any `useModelDownload` wiring Plan 02 added to the speech step.
- Modify: `src/styles/onboarding.css` (append)
- Modify: `test/components/personalWorkspace.test.js`. Delete "speech setup offers Orukeet and NVIDIA models and commits a local dictation choice" and "preview speech choices stay in preview storage" (lines 98-145). Their coverage moves to the tests below.
- Test: `test/components/onboardingVoice.test.js`. Extend `test/utils/onboardingDetection.test.js` and `test/components/onboardingFlow.test.js`.

**Interfaces:**
- Consumes `detectVoice`, `outcomeFor`, `modelDownloadBytes` and `shouldApplyDetectedVoice` (Task 3), `useVoiceDownload` (Task 7), `RadioCardGroup` (Task 9), `LocalityRing` (Plan 01, `locality="device"`, `label={t("locality.device")}`), and the default export `LanguageSelector` (`src/components/ui/LanguageSelector.tsx:28`, props `{ value, onChange }`).
- Produces:

  ```ts
  export function useSystemProfile(): SystemProfile | null; // falls back to navigator.languages when the bridge is absent
  export function spokenLocalesFor(locales: readonly string[], languages: readonly string[]): string[]; // in onboardingDetection.ts
  export interface VoiceStepProps {
    platform: "darwin" | "linux" | "win32";
    profile: SystemProfile | null;
    pick: VoicePick | null;
    selectedModel: string | null;
    onSelectModel(modelId: string): void;
    language: string;                 // BCP 47, for the picker's LanguageSelector
    onLanguageChange(language: string): void;
    download: VoiceDownloadState;
    onCancelDownload(): void;
  }
  ```

- Settings rule: viewing Voice writes nothing. The voice is committed to settings only when the user presses the primary ("Download (631 MB)" or "Continue"). Detection never switches an existing cloud setup to local by itself (§4).

- [ ] **Step 1: Write the failing tests**

Append to `test/utils/onboardingDetection.test.js`:

```js
test("spoken languages keep the OS's full locale tags for the voice's languages", async () => {
  const { spokenLocalesFor } = await load();
  assert.deepEqual(spokenLocalesFor(["es-ES", "en-US", "he-IL"], ["es", "en"]), ["es-ES", "en-US"]);
  assert.deepEqual(spokenLocalesFor([], ["en"]), ["en"]);
});

test("catalog language support used by the picker", async () => {
  const { supportsSpeechLanguage, firstCompatibleSpeechModel } = await import("../../src/utils/onboardingSpeechModels.ts");
  assert.equal(supportsSpeechLanguage("orukeet-v0.1.0", "ja-JP"), false);
  assert.equal(supportsSpeechLanguage("nemotron-3.5-asr-streaming-0.6b", "ja-JP"), true);
  assert.equal(firstCompatibleSpeechModel("ja-JP"), "nemotron-3.5-asr-streaming-0.6b");
});
```

Create `test/components/onboardingVoice.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

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
      download: { status: "idle" },
      onCancelDownload: () => events.push(["cancel"]),
      ...patch.props,
    },
  });
  return { ui, events };
}

test("says what it noticed and why it picked this voice", async (t) => {
  const { ui } = await voice(t);
  const text = ui.text();
  assert.ok(text.includes("setupFlow.voice.title"));
  assert.ok(text.includes("setupFlow.voice.why.englishMac"));
  assert.equal(ui.findAll((node) => node.attributes.class === "onb-signal").length, 4);
  assert.ok(text.includes("setupFlow.voice.gpu.appleSilicon"));
  assert.ok(text.includes("setupFlow.voice.outcomes.fastEnglish.name"));
  assert.ok(text.includes("Parakeet Unified EN 0.6B"), "the catalog name stays one glance away");
  assert.equal(ui.byAttr("data-locality", "device").length, 1);
  assert.equal(ui.byAttr("role", "radiogroup").length, 0, "the picker starts closed");
});

test("a short disk is said before the download, with real numbers", async (t) => {
  const { ui } = await voice(t, { profile: profile({ freeDiskBytes: 412e6 }) });
  const [note] = ui.byAttr("role", "note");
  assert.ok(note.textContent.includes("setupFlow.voice.diskShort"));
  assert.ok(note.textContent.includes("412"));
});

test("an unsupported language opens the picker with no guess", async (t) => {
  const { ui } = await voice(t, { profile: profile({ locales: ["he-IL"] }) });
  assert.ok(ui.text().includes("setupFlow.voice.unsupportedTitle"));
  assert.equal(ui.byAttr("role", "radiogroup").length, 1);
});

test("Not right? opens a picker that lists every voice and blocks the ones that can't hear you", async (t) => {
  const { ui, events } = await voice(t, { props: { language: "ja-JP" } });
  const [toggle] = ui.byAttr("aria-expanded", "false");
  await ui.click(toggle);
  assert.equal(ui.byAttr("aria-expanded", "true").length, 1);
  const radios = ui.byAttr("role", "radio");
  assert.equal(radios.length, 5);
  for (const name of ["Orukeet", "Parakeet TDT 0.6B", "Parakeet Unified EN 0.6B", "Nemotron Speech Streaming EN 0.6B", "Nemotron 3.5 ASR Streaming 0.6B"]) {
    assert.ok(ui.text().includes(name), name);
  }
  const english = radios.find((radio) => radio.attributes["data-value"] === "parakeet-unified-en-0.6b");
  assert.equal(english.attributes["aria-disabled"], "true");
  await ui.click(radios.find((radio) => radio.attributes["data-value"] === "nemotron-3.5-asr-streaming-0.6b"));
  assert.deepEqual(events, [["select", "nemotron-3.5-asr-streaming-0.6b"]]);
});

test("a stopped download says whether its progress was kept (owner decision 3)", async (t) => {
  const kept = await voice(t, { props: { download: { status: "error", message: "Network timeout", percent: 42, progressKept: true } } });
  assert.ok(kept.ui.text().includes('setupFlow.download.stoppedKept {"percent":42}'));
  await kept.ui.rerender({ download: { status: "error", message: "HTTP 404", percent: 42, progressKept: false } });
  assert.ok(kept.ui.text().includes('setupFlow.download.stoppedRestart {"percent":42}'));
});

test("the picker is locked with a reason while downloading, and Cancel is right there", async (t) => {
  const { ui, events } = await voice(t, {
    props: {
      download: { status: "downloading", percent: 42, downloadedBytes: 264e6, totalBytes: 631e6, bytesPerSecond: 8e6, etaSeconds: 46 },
    },
  });
  await ui.click(ui.byAttr("aria-expanded", "false")[0]);
  assert.ok(ui.byAttr("role", "radio").every((radio) => radio.attributes["aria-disabled"] === "true"));
  assert.ok(ui.text().includes("setupFlow.voice.lockedWhileDownloading"));
  await ui.click("setupFlow.download.cancel");
  assert.deepEqual(events, [["cancel"]]);
});
```

Append to `test/components/onboardingFlow.test.js`:

```js
test("viewing Voice writes nothing; its primary commits the voice and starts one download", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "speech" }, {
    api: {
      getSystemProfile: async () => ({ locales: ["es-ES", "en-US"], totalMemoryBytes: 8e9, freeDiskBytes: 5e10, gpu: { kind: "unknown", name: null } }),
      checkParakeetModelStatus: async () => ({ downloaded: false }),
      downloadParakeetModel: () => new Promise(() => {}),
    },
  });
  const { React } = require("../helpers/harness/reactSsr");
  await React.act(async () => {});
  assert.equal(ui.storage.getItem("parakeetModel"), null);
  assert.equal(ui.calls.filter(([name]) => name === "downloadParakeetModel").length, 0);
  assert.ok(primary(ui).textContent.includes("setupFlow.voice.download"));

  await ui.click(primary(ui));
  const settings = (await ui.vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore.getState();
  assert.equal(settings.parakeetModel, "orukeet-v0.1.0");
  assert.equal(settings.useLocalWhisper, true);
  assert.equal(settings.localTranscriptionProvider, "nvidia");
  assert.deepEqual(settings.spokenLanguages, ["es-ES", "en-US"]);
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "downloadParakeetModel"),
    [["downloadParakeetModel", "orukeet-v0.1.0"]]
  );
  assert.equal(ui.byAttr("aria-current", "step")[0].attributes["aria-label"], 'setupFlow.progress.goTo {"step":"setupFlow.steps.try"}');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingDetection.test.js test/components/onboardingVoice.test.js test/components/onboardingFlow.test.js`
Expected: FAIL. `spokenLocalesFor` and `VoiceStep` are missing, and the legacy speech step writes settings on selection.

- [ ] **Step 3: Implement**

1. Append to `src/utils/onboardingDetection.ts`:

   ```ts
   /** The OS locale tags behind the picked languages, for settings' spokenLanguages. */
   export function spokenLocalesFor(locales: readonly string[], languages: readonly string[]): string[] {
     const matched = locales.filter((locale) => languages.includes(baseLanguages([locale])[0]));
     return matched.length > 0 ? [...new Set(matched)] : [...languages];
   }
   ```

2. Create `src/components/onboarding/useSystemProfile.ts`:

   ```ts
   import { useEffect, useState } from "react";
   import type { SystemProfile } from "../../types/electron";

   function fallbackProfile(): SystemProfile {
     const languages = typeof navigator !== "undefined" ? [...(navigator.languages ?? [])] : [];
     return { locales: languages, totalMemoryBytes: null, freeDiskBytes: null, gpu: { kind: "unknown", name: null } };
   }

   /** Spec D8: hardware and OS locale, read once per setup. */
   export function useSystemProfile(): SystemProfile | null {
     const [profile, setProfile] = useState<SystemProfile | null>(null);
     useEffect(() => {
       let alive = true;
       void (async () => {
         try {
           const result = await window.electronAPI?.getSystemProfile?.();
           if (alive) setProfile(result ?? fallbackProfile());
         } catch {
           if (alive) setProfile(fallbackProfile());
         }
       })();
       return () => {
         alive = false;
       };
     }, []);
     return profile;
   }
   ```

3. Create `src/components/onboarding/VoiceStep.tsx`:

   ```tsx
   import { useId, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { Check } from "lucide-react";
   import type { SystemProfile } from "../../types/electron";
   import { modelDownloadBytes, outcomeFor, type VoicePick } from "../../utils/onboardingDetection";
   import { byteParts, type VoiceDownloadState } from "../../utils/onboardingDownload";
   import { ONBOARDING_SPEECH_MODELS, supportsSpeechLanguage } from "../../utils/onboardingSpeechModels";
   import LanguageSelector from "../ui/LanguageSelector";
   import { LocalityRing } from "../ui/LocalityRing";
   import { Button } from "../ui/button";
   import { RadioCardGroup } from "./RadioCardGroup";

   export interface VoiceStepProps {
     platform: "darwin" | "linux" | "win32";
     profile: SystemProfile | null;
     pick: VoicePick | null;
     selectedModel: string | null;
     onSelectModel(modelId: string): void;
     language: string;
     onLanguageChange(language: string): void;
     download: VoiceDownloadState;
     onCancelDownload(): void;
   }

   const ORGANIZATION: Record<string, string> = { oruk: "Oruk", nvidia: "NVIDIA" };

   export function VoiceStep({
     platform,
     profile,
     pick,
     selectedModel,
     onSelectModel,
     language,
     onLanguageChange,
     download,
     onCancelDownload,
   }: VoiceStepProps) {
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

     const busy = download.status === "downloading" || download.status === "installing";
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
       [
         "memory",
         profile.totalMemoryBytes === null
           ? unknown
           : t("setupFlow.units.gb", { value: Math.round(profile.totalMemoryBytes / 1024 ** 3) }),
       ],
       ["freeSpace", profile.freeDiskBytes === null ? unknown : size(profile.freeDiskBytes)],
       ["graphics", gpu],
     ];
     const showPicker = pickerOpen || unsupported;

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
             {busy ? (
               <div className="onb-reco__progress">
                 <span>{t("setupFlow.download.chipNoEta", { percent: download.status === "downloading" ? download.percent : 100 })}</span>
                 <Button size="sm" variant="ghost" onClick={onCancelDownload}>
                   {t("setupFlow.download.cancel")}
                 </Button>
               </div>
             ) : null}
             {download.status === "error" ? (
               <p className="onb-warning">
                 {download.percent !== null
                   ? `${t(download.progressKept ? "setupFlow.download.stoppedKept" : "setupFlow.download.stoppedRestart", { percent: download.percent })} `
                   : ""}
                 {download.message}
               </p>
             ) : null}
           </section>
         ) : null}

         {!unsupported ? (
           <Button
             variant="link"
             className="justify-self-start"
             aria-expanded={showPicker}
             aria-controls={pickerId}
             onClick={() => setPickerOpen((open) => !open)}
           >
             {t("setupFlow.voice.notRight")}
           </Button>
         ) : null}

         {showPicker ? (
           <section id={pickerId} className="onb-card" aria-label={t("setupFlow.voice.pickerLabel")}>
             <LanguageSelector value={language} onChange={onLanguageChange} />
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
                     : t("setupFlow.voice.cantHear", { language: languageName(language.split("-")[0]) });
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

4. Wire Voice into `src/components/OnboardingFlow.tsx`. Add the imports (`useSystemProfile`, `VoiceStep`, `useVoiceDownload`, `detectVoice`, `modelDownloadBytes`, `shouldApplyDetectedVoice`, `spokenLocalesFor`, `byteParts`) and this state:

   ```tsx
   const profile = useSystemProfile();
   const pick = useMemo(() => (profile ? detectVoice(profile) : null), [profile]);
   // Only an explicit, saved choice outranks detection (shouldApplyDetectedVoice).
   const [chosenModel, setChosenModel] = useState<string | null>(() => {
     const stored = localStorage.getItem("parakeetModel");
     return shouldApplyDetectedVoice(stored) ? null : stored;
   });
   const [chosenLanguage, setChosenLanguage] = useState<string | null>(null);
   const selectedModel = chosenModel ?? pick?.modelId ?? null;
   const voiceDownload = useVoiceDownload(selectedModel);
   const voiceReady = voiceDownload.state.status === "ready";

   const commitVoice = () => {
     if (!selectedModel) return;
     const store = useSettingsStore.getState();
     const spoken = chosenLanguage
       ? [chosenLanguage]
       : spokenLocalesFor(profile?.locales ?? [], pick?.languages ?? []);
     store.setUseLocalWhisper(true);
     store.setLocalTranscriptionProvider("nvidia");
     store.setParakeetModel(selectedModel);
     store.setSpokenLanguages(spoken);
     if (spoken[0]) store.setPreferredLanguage(spoken[0]);
   };

   const voicePrimary = () => {
     commitVoice();
     if (voiceDownload.state.status === "idle" || voiceDownload.state.status === "error") voiceDownload.start();
     goTo("try");
   };
   ```

   For `step === "speech"`, set the shell props:
   - `railMode`:
     - `downloading` gives `{ kind: "download", percent, downloadedBytes, totalBytes }`;
     - `error` gives `{ kind: "error", reason: "download" }`;
     - anything else gives `{ kind: "idle" }`.
   - `primary`:
     - When the state is `idle` or `error`, the label is `t("setupFlow.voice.download", { size })`. `size` is `t("setupFlow.units.<unit>", { value })` built from `byteParts(modelDownloadBytes(selectedModel))`.
     - Otherwise the label is `t("setupFlow.continue")`.
     - `onClick` is `voicePrimary`, with `disabled: !selectedModel`.
   - `children`:

   ```tsx
   <VoiceStep
     platform={platform}
     profile={profile}
     pick={pick}
     selectedModel={selectedModel}
     onSelectModel={setChosenModel}
     language={chosenLanguage ?? profile?.locales[0] ?? "en-US"}
     onLanguageChange={setChosenLanguage}
     download={voiceDownload.state}
     onCancelDownload={voiceDownload.cancel}
   />
   ```

   In the legacy readiness and `try` code that remains until Tasks 15 and 18:
   - replace every `speechModelReady` with `voiceReady`;
   - replace `selectedSpeechSupported` with `selectedModel !== null`;
   - `trialReady` becomes `voiceReady`.

5. Append to `src/styles/onboarding.css`:

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

   /* 60ms stagger, expressed in tokens: n × (2/3 × --motion-instant). */
   .onb-signal:nth-child(2) { animation-delay: calc(var(--motion-instant) * 2 / 3); }
   .onb-signal:nth-child(3) { animation-delay: calc(var(--motion-instant) * 4 / 3); }
   .onb-signal:nth-child(4) { animation-delay: calc(var(--motion-instant) * 2); }

   .onb-signal__tick {
     width: 14px;
     height: 14px;
     color: var(--color-success);
   }

   .onb-warning {
     margin: 0;
     padding: 10px 12px;
     border-radius: 8px;
     background: color-mix(in oklab, var(--color-warning) 10%, var(--color-card));
     font-size: 13px;
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

   .onb-reco__progress {
     display: flex;
     align-items: center;
     justify-content: space-between;
     font-size: 13px;
     font-variant-numeric: tabular-nums;
   }
   ```

   The `.onb-signal:nth-child` lines are one-line rules, so the per-line tokens check in Task 11's test still passes: none of them is a `transition` or `animation` declaration line.

6. Delete the two speech tests from `test/components/personalWorkspace.test.js` (lines 98-145).

7. Add the strings:

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
         "cantHear": "Doesn't hear {{language}}",
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

Run: `npm test -- test/utils/onboardingDetection.test.js test/components/onboardingVoice.test.js test/components/onboardingFlow.test.js test/components/personalWorkspace.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Preview: open `?preview=onboarding&step=speech` with `scenario=fresh`, `multilingual`, `low-disk` and `downloading`. Each shows its pick, signals, disk note or live percent.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/useSystemProfile.ts src/components/onboarding/VoiceStep.tsx src/utils/onboardingDetection.ts src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/utils/onboardingDetection.test.js test/components/onboardingVoice.test.js test/components/onboardingFlow.test.js test/components/personalWorkspace.test.js
git commit -m "feat(onboarding): Voice detects a voice from your system and commits it on Download"
```

---

### Task 14: While that downloads, meet Loqui

Covers ONB-R4 B, plus ONB-Q2's footer chip on later steps, the §5.3 off-step notices, and one live region for milestones.

**Files:**
- Create: `src/components/onboarding/DownloadChip.tsx`
- Create: `src/components/onboarding/LiveKeycap.tsx`
- Create: `src/components/onboarding/MeetLoquiTour.tsx`
- Create: `src/components/onboarding/TryStage.tsx`
- Modify: `src/components/OnboardingFlow.tsx`. Touch the try-step children, the shell's `footerStart` and `announcement`, and add an off-step notice effect.
- Modify: `src/styles/onboarding.css` (append)
- Test: `test/components/onboardingTour.test.js`

**Interfaces:**
- Consumes `VoiceDownloadState`, `etaParts`, `DownloadMilestone` (Task 7), `announceVoiceReady`, `announceVoiceFailed`, `shouldAnnounceOffStep` (Task 7) and `useToast` (`src/components/ui/useToast.ts`).
- Produces:

  ```tsx
  export function DownloadChip(props: { state: VoiceDownloadState; onRetry(): void; onCancel?: () => void }): JSX.Element | null;
  export interface LiveKeycapProps { label: string; sublabel: string; pressed: boolean; size?: 56 | 84 | 96; demo?: boolean; flashKey?: number }
  export function LiveKeycap(props: LiveKeycapProps): JSX.Element;         // aria-hidden; the field carries meaning
  export const TOUR_ADVANCE_MS = 4000;
  export function shouldAutoAdvance(input: { reducedMotion: boolean; paused: boolean; skipped: boolean }): boolean;
  export function MeetLoquiTour(props: { hotkeyLabel: string; activationMode: "tap" | "push"; platform: "darwin" | "linux" | "win32"; reducedMotion: boolean }): JSX.Element;
  export function TryStage(props: { download: VoiceDownloadState; onRetry(): void; onCancel(): void; tour: ReactNode; children: ReactNode }): JSX.Element;
  export function usePrefersReducedMotion(): boolean; // in TryStage.tsx; matchMedia("(prefers-reduced-motion: reduce)")
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/onboardingTour.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const downloading = (patch = {}) => ({
  status: "downloading",
  percent: 42,
  downloadedBytes: 264e6,
  totalBytes: 631e6,
  bytesPerSecond: 8e6,
  etaSeconds: 46,
  ...patch,
});

async function chip(t, state, handlers = {}) {
  return mountComponent(t, "/components/onboarding/DownloadChip.tsx", {
    exportName: "DownloadChip",
    props: { state, onRetry: handlers.onRetry ?? (() => {}), onCancel: handlers.onCancel },
  });
}

test("the chip shows percent and ETA, and falls back to percent alone", async (t) => {
  const withEta = await chip(t, downloading());
  assert.ok(withEta.text().includes('setupFlow.download.chip {"percent":42,"eta":"setupFlow.download.eta.seconds {\\"count\\":50}"}'));
  await withEta.rerender({ state: downloading({ etaSeconds: null }) });
  assert.ok(withEta.text().includes('setupFlow.download.chipNoEta {"percent":42}'));
});

test("a failed download keeps the chip with Retry; idle shows nothing", async (t) => {
  let retried = 0;
  const failed = await chip(t, { status: "error", message: "Disk full", percent: 42, progressKept: false }, { onRetry: () => retried++ });
  assert.equal(failed.byAttr("data-status", "error").length, 1);
  await failed.click("setupFlow.download.retry");
  assert.equal(retried, 1);
  await failed.rerender({ state: { status: "idle" } });
  assert.equal(failed.byAttr("data-status").length, 0);
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
  assert.ok(ui.text().includes("setupFlow.tour.skipped"));
});

test("the stage swaps the tour for the trial at 100% and pops it in only then", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/TryStage.tsx", {
    exportName: "TryStage",
    props: { download: downloading(), onRetry() {}, onCancel() {}, tour: "TOUR", children: "TRIAL" },
  });
  assert.ok(ui.text().includes("TOUR"));
  assert.equal(ui.text().includes("TRIAL"), false);
  await ui.rerender({ download: { status: "ready" } });
  assert.ok(ui.text().includes("TRIAL"));
  assert.ok(ui.text().includes("setupFlow.tour.readyTitle"));
  assert.equal(ui.byAttr("data-arrived", "true").length, 1);
});

test("a stopped download keeps the tour and says the progress is kept", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/TryStage.tsx", {
    exportName: "TryStage",
    props: {
      download: { status: "error", message: "Network timeout", percent: 42, progressKept: true },
      onRetry() {},
      onCancel() {},
      tour: "TOUR",
      children: "TRIAL",
    },
  });
  assert.ok(ui.text().includes("TOUR"));
  assert.ok(ui.text().includes('setupFlow.download.stoppedKept {"percent":42}'));
});

test("a voice that is already installed shows the trial with no pop-in", async (t) => {
  const ui = await mountComponent(t, "/components/onboarding/TryStage.tsx", {
    exportName: "TryStage",
    props: { download: { status: "ready" }, onRetry() {}, onCancel() {}, tour: "TOUR", children: "TRIAL" },
  });
  assert.equal(ui.byAttr("data-arrived").length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/onboardingTour.test.js`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

1. Create `src/components/onboarding/DownloadChip.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Check, CircleAlert } from "../icons";
   import { etaParts, type VoiceDownloadState } from "../../utils/onboardingDownload";

   const RING = 2 * Math.PI * 6;

   /** The download chip (ONB-R4): stays on every later step until the voice is ready. */
   export function DownloadChip({
     state,
     onRetry,
     onCancel,
   }: {
     state: VoiceDownloadState;
     onRetry(): void;
     onCancel?: () => void;
   }) {
     const { t } = useTranslation();
     if (state.status === "idle") return null;
     const eta = state.status === "downloading" ? etaParts(state.etaSeconds) : null;
     const label =
       state.status === "downloading"
         ? eta
           ? t("setupFlow.download.chip", {
               percent: state.percent,
               eta: t(`setupFlow.download.eta.${eta.unit}`, { count: eta.count }),
             })
           : t("setupFlow.download.chipNoEta", { percent: state.percent })
         : state.status === "installing"
           ? t("setupFlow.download.chipInstalling")
           : state.status === "ready"
             ? t("setupFlow.download.chipReady")
             : t("setupFlow.download.chipFailed");
     const progress = state.status === "downloading" ? state.percent / 100 : 1;
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
         <span>{label}</span>
         {state.status === "error" ? <span className="sr-only">{state.message}</span> : null}
         {state.status === "error" ? (
           <button type="button" className="onb-chip__action" onClick={onRetry}>
             {t("setupFlow.download.retry")}
           </button>
         ) : null}
         {state.status === "downloading" && onCancel ? (
           <button type="button" className="onb-chip__action" onClick={onCancel}>
             {t("setupFlow.download.cancel")}
           </button>
         ) : null}
       </span>
     );
   }
   ```

2. Create `src/components/onboarding/LiveKeycap.tsx`:

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

3. Create `src/components/onboarding/MeetLoquiTour.tsx`:

   ```tsx
   import { useEffect, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { LiveKeycap } from "./LiveKeycap";

   export const TOUR_ADVANCE_MS = 4000;
   const SLIDES = ["shortcut", "privacy", "demo"] as const;

   export function shouldAutoAdvance({
     reducedMotion,
     paused,
     skipped,
   }: {
     reducedMotion: boolean;
     paused: boolean;
     skipped: boolean;
   }): boolean {
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

4. Create `src/components/onboarding/TryStage.tsx`:

   ```tsx
   import { useEffect, useRef, useState, type ReactNode } from "react";
   import { useTranslation } from "react-i18next";
   import type { VoiceDownloadState } from "../../utils/onboardingDownload";
   import { DownloadChip } from "./DownloadChip";

   export function usePrefersReducedMotion(): boolean {
     const [reduced, setReduced] = useState(
       () => globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
     );
     useEffect(() => {
       const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
       if (!query) return;
       const onChange = () => setReduced(query.matches);
       query.addEventListener("change", onChange);
       return () => query.removeEventListener("change", onChange);
     }, []);
     return reduced;
   }

   /** Say something: the tour while the voice downloads, the trial the moment it lands. */
   export function TryStage({
     download,
     onRetry,
     onCancel,
     tour,
     children,
   }: {
     download: VoiceDownloadState;
     onRetry(): void;
     onCancel(): void;
     tour: ReactNode;
     children: ReactNode;
   }) {
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
           <DownloadChip state={download} onRetry={onRetry} onCancel={onCancel} />
           {download.status === "error" && download.percent !== null ? (
             <p className="onb-muted">
               {t(download.progressKept ? "setupFlow.download.stoppedKept" : "setupFlow.download.stoppedRestart", {
                 percent: download.percent,
               })}
             </p>
           ) : null}
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

5. Wire into `src/components/OnboardingFlow.tsx`:
   - For `step === "try"`, the children become `<TryStage download={voiceDownload.state} onRetry={voiceDownload.start} onCancel={voiceDownload.cancel} tour={<MeetLoquiTour …/>}>{legacy(content)}</TryStage>`. Pass `MeetLoquiTour` these props: `hotkeyLabel` from `keycapLabel` (Task 15 replaces the interim value with that helper; for now use `formatHotkeyLabel(dictationKey)` from `src/utils/hotkeys.ts:122`), the store's `activationMode`, `platform`, and `reducedMotion={usePrefersReducedMotion()}`.
   - `railMode` while `!voiceReady` on `try` uses the same download, error and idle mapping as on `speech`.
   - Set the shell's `footerStart` to `step !== "speech" && step !== "try" ? <DownloadChip state={voiceDownload.state} onRetry={voiceDownload.start} /> : undefined`.
   - Set the shell's `announcement`:
     - when the state is `ready` and `voiceDownload.milestone !== null` (a download ran in this session), use `t("setupFlow.download.announceReady")`;
     - when `voiceDownload.milestone` is set and the download is still running, use `t("setupFlow.download.announcePercent", { percent: voiceDownload.milestone })`;
     - otherwise use `""`.
   - Add the off-step notice effect (§5.3):

   ```tsx
   const { toast } = useToast();
   const lastStatusRef = useRef(voiceDownload.state.status);
   useEffect(() => {
     const previous = lastStatusRef.current;
     const status = voiceDownload.state.status;
     lastStatusRef.current = status;
     if (previous === status || !shouldAnnounceOffStep(step)) return;
     if (status === "ready" && (previous === "downloading" || previous === "installing")) announceVoiceReady(toast, t);
     if (status === "error" && voiceDownload.state.status === "error") {
       announceVoiceFailed(toast, t, voiceDownload.state.message, voiceDownload.start);
     }
   }, [step, t, toast, voiceDownload.start, voiceDownload.state]);
   ```

6. Append to `src/styles/onboarding.css`:

   ```css
   .onb-chip {
     display: inline-flex;
     align-items: center;
     gap: 8px;
     min-height: 30px;
     padding: 0 12px;
     border-radius: 9999px;
     background: var(--color-muted);
     font-size: 12px;
     font-weight: 600;
     font-variant-numeric: tabular-nums;
   }

   .onb-chip[data-status="ready"] {
     background: color-mix(in oklab, var(--color-success) 14%, var(--color-card));
   }

   .onb-chip[data-status="error"] {
     background: color-mix(in oklab, var(--color-destructive) 12%, var(--color-card));
   }

   .onb-chip__icon {
     width: 16px;
     height: 16px;
   }

   .onb-chip[data-status="ready"] .onb-chip__icon {
     color: var(--color-success);
   }

   .onb-chip__ring {
     width: 16px;
     height: 16px;
     transform: rotate(-90deg);
     fill: none;
     stroke-width: 2.5;
   }

   .onb-chip__ring circle:first-child {
     stroke: var(--color-border);
   }

   .onb-chip__ring circle:last-child {
     stroke: var(--color-live);
     transition: stroke-dashoffset var(--motion-slow) var(--motion-ease-std);
   }

   .onb-chip__action {
     border: 0;
     background: none;
     color: var(--color-link);
     font: inherit;
     cursor: pointer;
   }

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
     background: var(--color-live);
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

   Under reduced motion, the global policy drops `transform` from transitions and kills the keyframes. The keycap keeps its colour change, the tour slides fade, and the demo shows its final text (`data-reduced`).

7. Add the strings:

   ```bash
   node scripts/dev/merge-locale-keys.cjs - <<'JSON'
   {
     "setupFlow": {
       "tour": {
         "label": "While that downloads",
         "title": "While that downloads, meet Loqui.",
         "skip": "Skip tour",
         "skipped": "We'll start the test as soon as your voice is ready.",
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/components/onboardingTour.test.js test/components/onboardingFlow.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Preview: open `?preview=onboarding&step=speech&scenario=fresh`. Press Download.
- The tour appears at once, and the chip counts up.
- At 100% the stage swaps to "Ready. Say something." with a single pop.
- With `scenario=download-interrupted`, the chip turns into Download failed with Retry, and the tour stays.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/DownloadChip.tsx src/components/onboarding/LiveKeycap.tsx src/components/onboarding/MeetLoquiTour.tsx src/components/onboarding/TryStage.tsx src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/components/onboardingTour.test.js
git commit -m "feat(onboarding): meet Loqui while the voice downloads, with an honest chip"
```

---

### Task 15: Hotkey-first trial and the success band

Covers ONB-R5 C, ONB-Q3, Q5 and Q7, the M2 success dock, and the R2 B success band. Consumes §5.2 `cancelled`. Review Focus 2.

**Files:**
- Create: `src/utils/onboardingShortcut.ts`
- Create: `src/components/onboarding/useTrialSession.ts`
- Create: `src/components/onboarding/useDictationHotkey.ts`
- Create: `src/components/onboarding/useAccessibilityGate.ts`
- Create: `src/components/onboarding/cleanupRunner.ts`
- Create: `src/components/onboarding/HotkeyTrial.tsx`
- Create: `src/components/onboarding/SuccessBand.tsx`
- Modify: `src/components/OnboardingFlow.tsx`:
  - delete `BrowserTrial` (606-728), `DesktopTrial` (730-834), `SAMPLE_TRANSCRIPT` (137), `trialResult` and `onTrialFinished` (1058, 1251-1253), `simulatedTrialReady`/`trial` (1326-1333) and the legacy `try` content block (1376-1394);
  - drop the `useAudioRecording` import (29). Setup no longer records in its own window.
- Modify: `src/styles/onboarding.css` (append)
- Test: `test/utils/onboardingShortcut.test.js` and `test/components/onboardingTrial.test.js`. Extend `test/components/onboardingFlow.test.js`.

**Interfaces:**
- Consumes `reduceTrial`, `INITIAL_TRIAL_STATE`, `isSilent`, `canUndo` and `trialCaption` (Task 6), the bridge methods from Task 4, `TryStage` and `LiveKeycap` (Task 14), `RecoveryCard` and `useRecheckOnFocus` (Task 10), `dockMark` (Task 11), `formatHotkeyLabelForPlatform` and `getDefaultHotkey` (`src/utils/hotkeys.ts:138, 202`), and `ReasoningService.processText(text, model, agentName, config)` (`src/services/ReasoningService.ts:71`), following the `ControlPanel.tsx:534-545` precedent.
- Produces `src/utils/onboardingShortcut.ts`:

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
  - `useTrialSession(active: boolean)` returns `{ state, toggle(), cancel(), undo(), undoAvailable, readLevel(), usedHotkey }`. It begins a `dictation` demo when `active` turns on, ends it when `active` turns off or on unmount, and ignores events from any other demo id.
  - `useDictationHotkey(active: boolean)` returns a `KeycapState`.
  - `useAccessibilityGate(platform, active)` returns `{ granted: boolean | null; request(): void }`. It is always granted off macOS. On macOS, once granted, it calls `markMacAccessibilityFeaturesReady(null)` so the Globe key works during setup.
  - `runCleanup(text: string): Promise<string | null>`. It returns `null` when no cleanup model is configured.
- Produces `HotkeyTrial` (props below) and `SuccessBand({ onPersonalize, onFinish })`.

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

test("the keycap counts presses once, even when two sources report the same down", async () => {
  const { INITIAL_KEYCAP, reduceKeycap } = await load();
  let state = reduceKeycap(INITIAL_KEYCAP, { phase: "down", at: 0 });
  state = reduceKeycap(state, { phase: "down", at: 5 });
  assert.deepEqual(state, { pressed: true, downAtMs: 0, lastStyle: null, presses: 0 });
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
const { mountComponent, electronApiProxy } = require("../helpers/harness/mountComponent");

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
  undoUntil: null,
  remoteAlreadySent: null,
  successes: 0,
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
      undoAvailable: true,
      cleanupRetrying: false,
      onToggle: () => calls.push("toggle"),
      onCancel: () => calls.push("cancel"),
      onUndo: () => calls.push("undo"),
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
  const tap = await view(t);
  assert.ok(tap.ui.text().includes('setupFlow.try.idle.tap {"key":"fn"}'));
  assert.ok(tap.ui.text().includes("setupFlow.try.privacyLine"));
  assert.ok(tap.ui.text().includes("setupFlow.try.useButton"), "the button fallback is always offered");
  await tap.ui.rerender({ activationMode: "push" });
  assert.ok(tap.ui.text().includes('setupFlow.try.idle.push {"key":"fn"}'));
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
  assert.ok(ui.text().includes("setupFlow.try.shortcutWorks"));
  await ui.rerender({ usedHotkey: false });
  assert.equal(ui.text().includes("setupFlow.try.shortcutWorks"), false);
  assert.ok(ui.text().includes("setupFlow.try.heardYou"));
});

test("a failed cleanup keeps the original words and offers Retry and Turn off (ONB-Q7)", async (t) => {
  const { ui, calls } = await view(t, {
    trial: trialState({ phase: "success", text: "um hi", rawText: "um hi", cleanup: "failed", successes: 1 }),
  });
  assert.ok(ui.text().includes("um hi"));
  assert.ok(ui.text().includes("setupFlow.try.cleanupFailed"));
  await ui.click("setupFlow.try.retryCleanup");
  await ui.click("setupFlow.try.cleanupOff");
  assert.deepEqual(calls, ["retryCleanup", "cleanupOff"]);
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

test("a discarded take offers Undo until its deadline, and says if audio already left", async (t) => {
  const { ui, calls } = await view(t, {
    trial: trialState({ phase: "cancelled", undoUntil: 5000, remoteAlreadySent: "OpenAI" }),
    nowMs: 1000,
  });
  assert.ok(ui.text().includes("setupFlow.try.discarded"));
  assert.ok(ui.text().includes('setupFlow.try.remoteAlreadySent {"provider":"OpenAI"}'));
  await ui.click("setupFlow.try.undo");
  assert.deepEqual(calls, ["undo"]);
  await ui.rerender({ nowMs: 6000 });
  assert.equal(ui.text().includes("setupFlow.try.undo"), false);
});

test("each failure has its own fix", async (t) => {
  const { ui, calls } = await view(t, { trial: trialState({ phase: "error", errorKind: "microphone" }) });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  assert.ok(ui.text().includes("setupFlow.hello.deniedTitle"));
  await ui.rerender({ trial: trialState({ phase: "error", errorKind: "memory" }) });
  await ui.click("setupFlow.try.chooseSmaller");
  await ui.rerender({ trial: trialState(), accessibilityMissing: true });
  assert.ok(ui.text().includes("setupFlow.try.accessibilityTitle"));
  await ui.click("setupFlow.try.grantAccess");
  assert.deepEqual(calls, ["voice", "grant"]);
});

test("silence for a while suggests checking the microphone", async (t) => {
  const { ui } = await view(t, { trial: trialState({ phase: "recording", recordingSinceMs: 0 }), nowMs: 3000 });
  assert.ok(ui.text().includes("setupFlow.try.silent"));
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

test("leaving the step ends the demo session, and late events are ignored", async (t) => {
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
          beginOnboardingDemo: async (session) => calls.push(["begin", session.kind]) && true,
          endOnboardingDemo: async (id) => calls.push(["end", id]) && true,
          toggleOnboardingDemo: async (id) => calls.push(["toggle", id]) && true,
          onOnboardingDemoEvent: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        []
      ),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-trial-session-test-" });
  const { useTrialSession } = await vite.ssrLoadModule("/components/onboarding/useTrialSession.ts");
  let session;
  function Harness({ active }) {
    session = useTrialSession(active);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness, { active: true })));
  const emit = (event) => React.act(async () => [...listeners].forEach((listener) => listener(event)));
  await React.act(async () => session.toggle());
  const id = calls.find(([name]) => name === "toggle")[1];
  await emit({ demoId: "someone-else", kind: "dictation", status: "listening" });
  assert.equal(session.state.phase, "idle");
  await emit({ demoId: id, kind: "dictation", status: "listening" });
  assert.equal(session.state.phase, "recording");
  await React.act(async () => root.render(React.createElement(Harness, { active: false })));
  assert.deepEqual(calls.at(-1), ["end", id]);
  assert.equal(listeners.size, 0);
  assert.equal(session.state.phase, "idle");
});
```

Append to `test/components/onboardingFlow.test.js`:

```js
test("Say something waits for the voice with the tour, never a dead Start button", async (t) => {
  const { ui } = await mountFlow(t, { initialStep: "try" }, { api: { checkParakeetModelStatus: async () => ({ downloaded: false }) } });
  const { React } = require("../helpers/harness/reactSsr");
  await React.act(async () => {});
  assert.ok(ui.text().includes("setupFlow.tour.title"));
  assert.equal(ui.findAll((node) => node.tagName === "BUTTON" && "disabled" in node.attributes && node.textContent.includes("setupFlow.try.start")).length, 0);
});
```

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

   /** Two sources can report one press (Task 4); a repeated down is the same press. */
   export function reduceKeycap(state: KeycapState, event: { phase: "down" | "up" | "tap"; at: number }): KeycapState {
     if (event.phase === "down") return state.pressed ? state : { ...state, pressed: true, downAtMs: event.at };
     if (event.phase === "up") {
       if (!state.pressed || state.downAtMs === null) return state;
       return { pressed: false, downAtMs: null, lastStyle: pressStyle(state.downAtMs, event.at), presses: state.presses + 1 };
     }
     // globalShortcut has no key-up: the press is a tap.
     return { pressed: false, downAtMs: null, lastStyle: "tap", presses: state.presses + 1 };
   }

   export function suggestActivationMode(
     current: "tap" | "push",
     style: PressStyle,
     pushSupported: boolean
   ): "tap" | "push" | null {
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
     const [undoAvailable, setUndoAvailable] = useState(true);
     const [usedHotkey, setUsedHotkey] = useState(false);
     levelRef.current = state.level;

     useEffect(() => {
       if (!active) return;
       const id = idRef.current;
       const api = window.electronAPI;
       void api?.beginOnboardingDemo?.({ id, kind: "dictation" });
       const offDemo = api?.onOnboardingDemoEvent?.((event) => {
         if (event.demoId === id) dispatch({ ...event, atMs: Date.now() } as TrialInput);
       });
       const offHotkey = api?.onDictationHotkeyEvent?.((event) => {
         if (event.phase !== "up") setUsedHotkey(true);
       });
       return () => {
         offDemo?.();
         offHotkey?.();
         // Main turns ending a demo into a cancel; nothing from this take is kept.
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
     const undo = useCallback(async () => {
       const restored = await window.electronAPI?.undoOnboardingDemoCancel?.(idRef.current);
       if (!restored) setUndoAvailable(false);
     }, []);
     const readLevel = useCallback(() => levelRef.current, []);

     return { state, toggle, cancel, undo, undoAvailable, readLevel, usedHotkey };
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

5. Create `src/components/onboarding/cleanupRunner.ts`:

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

6. Create `src/components/onboarding/HotkeyTrial.tsx`:

   ```tsx
   import { useState } from "react";
   import { useTranslation } from "react-i18next";
   import { Check, CircleAlert } from "../icons";
   import { Button } from "../ui/button";
   import { canUndo, isSilent, type TrialState } from "../../utils/onboardingTrial";
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
     undoAvailable: boolean;
     cleanupRetrying: boolean;
     onToggle(): void;
     onCancel(): void;
     onUndo(): void;
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
               <p className="onb-field__status">
                 {t("setupFlow.try.discarded")}
                 {trial.remoteAlreadySent ? ` ${t("setupFlow.try.remoteAlreadySent", { provider: trial.remoteAlreadySent })}` : ""}
                 {props.undoAvailable && canUndo(trial, props.nowMs) ? (
                   <Button size="sm" variant="ghost" onClick={props.onUndo}>
                     {t("setupFlow.try.undo")}
                   </Button>
                 ) : null}
               </p>
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
               <p>{t("setupFlow.try.cleanupFailed")}</p>
               <div className="onb-recovery__actions">
                 <Button size="sm" onClick={props.onRetryCleanup} disabled={props.cleanupRetrying}>
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

   In the "one toggle button" test, the cleanup Retry button can carry `disabled` only while a retry is running. That state does not occur in that test.

7. Create `src/components/onboarding/SuccessBand.tsx`:

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

8. Wire into `src/components/OnboardingFlow.tsx`. Delete the legacy trial pieces listed under Files, then add:

   ```tsx
   const settingsHotkey = useSettingsStore((s) => s.activeDictationKey || s.dictationKey) || getDefaultHotkey();
   const activationMode = useSettingsStore((s) => s.activationMode);
   const hotkeyLabel = keycapLabel(settingsHotkey, platform);
   const trialSession = useTrialSession(step === "try" && voiceReady);
   const keycap = useDictationHotkey(step === "try" || step === "shortcuts");
   const accessibility = useAccessibilityGate(platform, step === "try" || step === "shortcuts");
   const reducedMotion = usePrefersReducedMotion();
   const [docked, setDocked] = useState(false);
   const [cleanedText, setCleanedText] = useState<string | null>(null);
   const [cleanupRetrying, setCleanupRetrying] = useState(false);
   const [nowMs, setNowMs] = useState(() => Date.now());
   const trial = trialSession.state;

   // Ticks only while a time-based hint can change (silence, undo window).
   useEffect(() => {
     if (trial.phase !== "recording" && trial.phase !== "cancelled") return;
     const id = setInterval(() => setNowMs(Date.now()), 250);
     return () => clearInterval(id);
   }, [trial.phase]);

   // M2: the first success docks the mark into the header.
   useEffect(() => {
     if (trial.successes === 1 && !docked) {
       dockMark(() => setDocked(true), { reducedMotion, doc: document as Parameters<typeof dockMark>[1]["doc"] });
     }
   }, [docked, reducedMotion, trial.successes]);

   const retryCleanup = async () => {
     if (!trial.rawText) return;
     setCleanupRetrying(true);
     try {
       const cleaned = await runCleanup(trial.rawText);
       if (cleaned) setCleanedText(cleaned);
     } finally {
       setCleanupRetrying(false);
     }
   };
   ```

   Then for `step === "try"`:
   - `railMode`:
     - When the voice is not ready, use the download mapping from Task 14.
     - Otherwise `trial.phase` decides it:
       - `recording` → `{ kind: "listening", heardVoice: trial.heardVoice }`, with `readLevel: trialSession.readLevel`;
       - `success` → `{ kind: "success" }`;
       - `error` → `{ kind: "error", reason: trial.errorKind === "microphone" ? "microphone" : trial.errorKind === "noAudio" ? "noAudio" : "other" }`;
       - anything else → `{ kind: "idle" }`.
   - `docked` on the shell is `docked && step === "try"`.
   - `primary` is `undefined`. The band owns the next step.
   - `onSkip` stays as it is ("Skip this step" goes to Cleanup).
   - The children are:

   ```tsx
   <TryStage
     download={voiceDownload.state}
     onRetry={voiceDownload.start}
     onCancel={voiceDownload.cancel}
     tour={<MeetLoquiTour hotkeyLabel={hotkeyLabel} activationMode={activationMode} platform={platform} reducedMotion={reducedMotion} />}
   >
     <div
       onKeyDown={(event) => {
         if (event.key === "Escape" && trial.phase === "recording") void trialSession.cancel();
       }}
     >
       <HotkeyTrial
         platform={platform}
         trial={cleanedText && trial.phase === "success" ? { ...trial, text: cleanedText, cleanup: "applied" } : trial}
         nowMs={nowMs}
         hotkeyLabel={hotkeyLabel}
         activationMode={activationMode}
         keycap={keycap}
         usedHotkey={trialSession.usedHotkey}
         accessibilityMissing={accessibility.granted === false}
         undoAvailable={trialSession.undoAvailable}
         cleanupRetrying={cleanupRetrying}
         onToggle={() => void trialSession.toggle()}
         onCancel={() => void trialSession.cancel()}
         onUndo={() => void trialSession.undo()}
         onGrantAccessibility={accessibility.request}
         onRetryCleanup={() => void retryCleanup()}
         onTurnCleanupOff={() => chooseCleanup("none")}
         onBackToVoice={() => goTo("speech")}
         onChangeMicrophone={() => goTo("welcome")}
       />
     </div>
     {trial.successes > 0 ? <SuccessBand onPersonalize={() => goTo("cleanup")} onFinish={() => goTo("finish")} /> : null}
   </TryStage>
   ```

   Keep `trial.rawText` available for Task 16 by passing `trial` down. The legacy `readiness.microphone` (still used by the legacy Finish step until Task 18) becomes:

   ```ts
   trial.successes > 0 ? "ready" : mic.access === "denied" ? "failed" : "pending"
   ```

9. Append to `src/styles/onboarding.css`:

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
     gap: 8px;
   }
   ```

10. Add the strings:

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
          "remoteAlreadySent": "{{provider}} already received the audio.",
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/utils/onboardingShortcut.test.js test/components/onboardingTrial.test.js test/components/onboardingFlow.test.js test/components/onboardingCleanupWiring.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Preview: open `?preview=onboarding&step=try&scenario=ready&platform=macos` and hold **Hold shortcut**. Check:
- the keycap presses, the rail bars follow, and the words fill in;
- "Shortcut works" appears;
- the mark docks, and the band offers Make it yours / Start using Loqui.

Repeat with `scenario=cleanup-failed`, `microphone-denied`, `nothing-heard` and `accessibility-missing`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingShortcut.ts src/components/onboarding/useTrialSession.ts src/components/onboarding/useDictationHotkey.ts src/components/onboarding/useAccessibilityGate.ts src/components/onboarding/cleanupRunner.ts src/components/onboarding/HotkeyTrial.tsx src/components/onboarding/SuccessBand.tsx src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/utils/onboardingShortcut.test.js test/components/onboardingTrial.test.js test/components/onboardingFlow.test.js
git commit -m "feat(onboarding): hotkey-first trial with live keycap, recovery and a success band"
```

---

### Task 16: Cleanup, before and after in your own words

Covers ONB-R6 B, ONB-Q9, and §5.1 for cleanup. It keeps the superseded-check guarantees tested in `onboardingCleanupWiring.test.js`.

**Files:**
- Create: `src/utils/onboardingCleanupPreview.ts`
- Create: `src/components/onboarding/CleanupStep.tsx`
- Modify: `src/components/OnboardingFlow.tsx`:
  - delete the legacy `CleanupStep` (465-604) and `StatusLine` (303-317);
  - move the reuse-checkbox storage into the flow;
  - pass `preview: Boolean(previewConfig)` and `scenario: previewConfig?.scenario ?? "fresh"` to `applyCleanupChoice` in `chooseCleanup` (1199-1218).
- Modify: `test/components/onboardingCleanupWiring.test.js`. Change the labels it clicks.
- Modify: `test/components/fieldDirectionPolicy.test.js:77`. Change the allow-listed path to `src/components/onboarding/CleanupStep.tsx`.
- Modify: `src/styles/onboarding.css` (append)
- Test: `test/utils/onboardingCleanupPreview.test.js` and `test/components/onboardingCleanup.test.js`

**Interfaces:**
- Consumes:
  - `CleanupChoice` and `CleanupStatus` (`src/utils/onboardingCleanup.ts:10-11`);
  - `useResolvedRoute("dictationCleanup")` and `ResolvedRoute` (§5.1, `src/lib/routes.ts`);
  - `Locality`, `providerDisplayName` (`src/lib/locality.ts`) and `LocalityRing` (Plan 01);
  - `runCleanup` (Task 15), `RadioCardGroup` (Task 9), and the default export `CodexConnection` (`src/components/CodexConnection.tsx`).
- Produces `onboardingCleanupPreview.ts`:

  ```ts
  export interface WordSegment { text: string; changed: boolean }
  export function diffWords(original: string, cleaned: string): WordSegment[]; // LCS over whitespace tokens of `cleaned`
  export function countWords(text: string): number;
  export interface CleanupExamples { original: string; local: string; codex: string; provider: string }
  export interface CleanupPreview { original: string; segments: WordSegment[]; source: "yours" | "example"; locality: Locality | null; wordsSent: number | null }
  export function cleanupPreview(input: { choice: CleanupChoice; userText: string | null; realCleaned: string | null; examples: CleanupExamples }): CleanupPreview;
  ```

- Produces `CleanupStep`:

  ```ts
  export interface CleanupStepProps {
    choice: CleanupChoice; status: CleanupStatus; onChoose(choice: CleanupChoice): void;
    userText: string | null;           // the trial's raw words; null if the trial was skipped
    route: ResolvedRoute;              // §5.1 dictationCleanup: what is active now
    runLocal(text: string): Promise<string | null>;
    reuse: boolean; onReuseChange(value: boolean): void;
  }
  ```

- Rules:
  - A real run happens only for Local, after the local check passed (`status === "ready"`), when `route.locality === "device"` and the user has their own sentence.
  - ChatGPT and API key never run in this step. They show the example until connected and say "Nothing was sent."
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
  assert.equal(countWords(""), 0);
});

test("None shows your words unchanged", async () => {
  const { cleanupPreview } = await load();
  const preview = cleanupPreview({ choice: "none", userText: "um hi", realCleaned: null, examples });
  assert.deepEqual([preview.original, preview.source, preview.locality, preview.wordsSent], ["um hi", "yours", null, null]);
  assert.ok(preview.segments.every((segment) => !segment.changed));
});

test("Local uses your sentence once it really ran on this device", async () => {
  const { cleanupPreview } = await load();
  const real = cleanupPreview({ choice: "local", userText: "um hi there", realCleaned: "Hi there.", examples });
  assert.deepEqual([real.original, real.source, real.locality], ["um hi there", "yours", "device"]);
  const waiting = cleanupPreview({ choice: "local", userText: "um hi there", realCleaned: null, examples });
  assert.deepEqual([waiting.original, waiting.source], [examples.original, "example"]);
});

test("remote options never use a real run and count what would leave", async () => {
  const { cleanupPreview } = await load();
  const codex = cleanupPreview({ choice: "codex", userText: "um remind me to book the room", realCleaned: "IGNORED", examples });
  assert.deepEqual([codex.source, codex.locality, codex.wordsSent], ["example", "remote", 6]);
  const noTrial = cleanupPreview({ choice: "provider", userText: null, realCleaned: null, examples });
  assert.equal(noTrial.wordsSent, 9, "without a trial, the example's own words are counted");
});
```

Create `test/components/onboardingCleanup.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const route = (patch = {}) => ({
  id: "dictationCleanup",
  kind: "text",
  locality: "device",
  provider: null,
  model: null,
  state: { status: "off" },
  sends: null,
  settingsPath: "llm/dictationCleanup",
  ...patch,
});

async function cleanup(t, props = {}) {
  const chosen = [];
  const runs = [];
  const ui = await mountComponent(t, "/components/onboarding/CleanupStep.tsx", {
    exportName: "CleanupStep",
    props: {
      choice: "none",
      status: "skipped",
      onChoose: (choice) => chosen.push(choice),
      userText: "um remind me to book the room",
      route: route(),
      runLocal: async (text) => {
        runs.push(text);
        return "Remind me to book the room.";
      },
      reuse: false,
      onReuseChange() {},
      ...props,
    },
    mocks: { "/CodexConnection": "export default function CodexConnection() { return null; }" },
  });
  return { ui, chosen, runs };
}

test("one segmented radio group, no Recommended badge, and your words first", async (t) => {
  const { ui, chosen } = await cleanup(t);
  const [group] = ui.byAttr("role", "radiogroup");
  assert.equal(group.attributes["data-variant"], "segmented");
  assert.equal(ui.byAttr("role", "radio").length, 4);
  assert.equal(ui.text().includes("Recommended"), false);
  assert.ok(ui.text().includes("um remind me to book the room"));
  assert.ok(ui.text().includes("setupFlow.cleanup.nothingChanges"));
  await ui.click(ui.byAttr("data-value", "codex")[0]);
  assert.deepEqual(chosen, ["codex"]);
});

test("Local runs on your own sentence on this device and marks what changed", async (t) => {
  const { ui, runs } = await cleanup(t, { choice: "local", status: "ready" });
  const { React } = require("../helpers/harness/reactSsr");
  await React.act(async () => {});
  assert.deepEqual(runs, ["um remind me to book the room"]);
  assert.ok(ui.text().includes("Remind me to book the room."));
  assert.ok(ui.findAll((node) => node.tagName === "MARK").length >= 1);
  assert.equal(ui.byAttr("data-locality", "device").length >= 1, true);
});

test("a remote choice shows the example, says nothing was sent, and counts your words", async (t) => {
  const { ui, runs } = await cleanup(t, { choice: "codex", status: "pending", route: route({ locality: "remote", provider: "OpenAI", state: { status: "ready" } }) });
  assert.deepEqual(runs, []);
  assert.ok(ui.text().includes("setupFlow.cleanup.exampleNotice"));
  assert.ok(ui.text().includes('setupFlow.cleanup.wordsSent {"count":6,"provider":"OpenAI"}'));
  assert.equal(ui.byAttr("data-locality", "remote").length >= 1, true);
});

test("a remote route never runs locally, even if Local is selected", async (t) => {
  const { runs } = await cleanup(t, { choice: "local", status: "ready", route: route({ locality: "remote", provider: "OpenAI", state: { status: "ready" } }) });
  const { React } = require("../helpers/harness/reactSsr");
  await React.act(async () => {});
  assert.deepEqual(runs, []);
});

test("the current route state is told plainly, including a missing key", async (t) => {
  const { ui } = await cleanup(t, { choice: "provider", status: "failed", route: route({ locality: "remote", provider: "OpenAI", state: { status: "needsKey", provider: "OpenAI" } }) });
  assert.ok(ui.text().includes('setupFlow.cleanup.now.needsKey {"provider":"OpenAI"}'));
});
```

In `test/components/onboardingCleanupWiring.test.js`:
- replace every `flow.click("ChatGPT subscription")` with `flow.click("setupFlow.cleanup.options.codex")`;
- replace every `flow.click("No cleanup")` with `flow.click("setupFlow.cleanup.options.none")`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingCleanupPreview.test.js test/components/onboardingCleanup.test.js test/components/onboardingCleanupWiring.test.js`
Expected: FAIL. The modules are missing, and the wiring test cannot find the new labels.

- [ ] **Step 3: Implement**

1. Create `src/utils/onboardingCleanupPreview.ts`:

   ```ts
   import type { Locality } from "../lib/locality";
   import type { CleanupChoice } from "./onboardingCleanup";

   // Before and after (ONB-R6 B): the user chooses by seeing. Only Local may use
   // their own words, and only after it really ran on this device.
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
     realCleaned,
     examples,
   }: {
     choice: CleanupChoice;
     userText: string | null;
     realCleaned: string | null;
     examples: CleanupExamples;
   }): CleanupPreview {
     const yours = userText?.trim() || null;
     if (choice === "none") {
       const original = yours ?? examples.original;
       return { original, segments: diffWords(original, original), source: yours ? "yours" : "example", locality: null, wordsSent: null };
     }
     if (choice === "local" && yours && realCleaned) {
       return { original: yours, segments: diffWords(yours, realCleaned), source: "yours", locality: "device", wordsSent: null };
     }
     const remote = choice === "codex" || choice === "provider";
     return {
       original: examples.original,
       segments: diffWords(examples.original, examples[choice]),
       source: "example",
       locality: remote ? "remote" : "device",
       wordsSent: remote ? countWords(yours ?? examples.original) : null,
     };
   }
   ```

2. Create `src/components/onboarding/CleanupStep.tsx`:

   ```tsx
   import { useEffect, useState } from "react";
   import { useTranslation } from "react-i18next";
   import CodexConnection from "../CodexConnection";
   import { LocalityRing } from "../ui/LocalityRing";
   import { providerDisplayName } from "../../lib/locality";
   import type { ResolvedRoute } from "../../lib/routes";
   import type { CleanupChoice, CleanupStatus } from "../../utils/onboardingCleanup";
   import { cleanupPreview } from "../../utils/onboardingCleanupPreview";
   import { RadioCardGroup } from "./RadioCardGroup";

   export interface CleanupStepProps {
     choice: CleanupChoice;
     status: CleanupStatus;
     onChoose(choice: CleanupChoice): void;
     userText: string | null;
     route: ResolvedRoute;
     runLocal(text: string): Promise<string | null>;
     reuse: boolean;
     onReuseChange(value: boolean): void;
   }

   const CHOICES = ["none", "local", "codex", "provider"] as const;

   export function CleanupStep({ choice, status, onChoose, userText, route, runLocal, reuse, onReuseChange }: CleanupStepProps) {
     const { t } = useTranslation();
     const [realCleaned, setRealCleaned] = useState<string | null>(null);
     const [running, setRunning] = useState(false);
     const canRunLocally = choice === "local" && status === "ready" && route.locality === "device" && Boolean(userText?.trim());

     useEffect(() => {
       if (!canRunLocally || !userText) {
         setRealCleaned(null);
         return;
       }
       let alive = true;
       setRunning(true);
       runLocal(userText)
         .then((cleaned) => alive && setRealCleaned(cleaned))
         .catch(() => alive && setRealCleaned(null))
         .finally(() => alive && setRunning(false));
       return () => {
         alive = false;
       };
     }, [canRunLocally, runLocal, userText]);

     const preview = cleanupPreview({
       choice,
       userText,
       realCleaned,
       examples: {
         original: t("setupFlow.cleanup.example.original"),
         local: t("setupFlow.cleanup.example.local"),
         codex: t("setupFlow.cleanup.example.codex"),
         provider: t("setupFlow.cleanup.example.provider"),
       },
     });
     const remoteProvider = providerDisplayName("openai");
     const now = (() => {
       const provider = route.provider ?? remoteProvider;
       switch (route.state.status) {
         case "off":
           return t("setupFlow.cleanup.now.off");
         case "ready":
           return t("setupFlow.cleanup.now.ready", { name: route.model ?? provider });
         case "needsKey":
           return t("setupFlow.cleanup.now.needsKey", { provider: route.state.provider });
         case "needsModel":
           return t("setupFlow.cleanup.now.needsModel");
         default:
           return t("setupFlow.cleanup.now.unreachable", { provider });
       }
     })();

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
               <>
                 <LocalityRing locality="device" label={t("locality.device")} size={16} />
                 <span>{t("locality.device")}</span>
                 {running ? <span>{t("setupFlow.cleanup.running")}</span> : null}
               </>
             ) : (
               <>
                 <LocalityRing locality="remote" provider={remoteProvider} label={t("locality.remote", { provider: remoteProvider })} size={16} />
                 <span>{t("setupFlow.cleanup.wordsSent", { count: preview.wordsSent ?? 0, provider: remoteProvider })}</span>
               </>
             )}
           </p>
           {preview.source === "example" && preview.locality === "remote" ? (
             <p className="onb-muted">{t("setupFlow.cleanup.exampleNotice")}</p>
           ) : null}
           {preview.source === "example" && choice === "local" ? (
             <p className="onb-muted">{t("setupFlow.cleanup.localExampleNotice")}</p>
           ) : null}
         </section>
         {choice === "codex" ? <CodexConnection onSignedInChange={() => onChoose("codex")} /> : null}
         <p className="onb-muted" role="status">
           {now}
         </p>
         <label className="onb-check">
           <input type="checkbox" dir="ltr" checked={reuse} onChange={(event) => onReuseChange(event.target.checked)} />
           <span>{t("setupFlow.cleanup.reuse")}</span>
         </label>
       </>
     );
   }
   ```

3. In `src/components/OnboardingFlow.tsx`:
   - Delete the legacy `CleanupStep` and `StatusLine`.
   - Lift the reuse flag. These are the same key and default as the old `CleanupStep:477-480`, and `applyCleanupToOtherTasks` (1220-1249) reads the same key:

     ```tsx
     const reuseStorageKey = progressStorageKey ? `${progressStorageKey}.reuseCleanup` : "loqui.onboarding.reuseCleanup";
     const [reuseCleanup, setReuseCleanup] = useState(() => localStorage.getItem(reuseStorageKey) === "true");
     ```
   - Write the flag back in `onReuseChange`.
   - `applyCleanupToOtherTasks` already reads the same key, so it is unchanged.
   - In `chooseCleanup`, set `preview: Boolean(previewConfig)` and `scenario: previewConfig?.scenario ?? "fresh"`. Production code no longer reads the preview global (ONB-Q18).
   - For `step === "cleanup"`, the children are:

   ```tsx
   <CleanupStep
     choice={cleanupChoice}
     status={cleanupStatus}
     onChoose={chooseCleanup}
     userText={trial.rawText ?? (trial.text || null)}
     route={cleanupRoute}
     runLocal={runCleanup}
     reuse={reuseCleanup}
     onReuseChange={(value) => {
       setReuseCleanup(value);
       localStorage.setItem(reuseStorageKey, String(value));
     }}
   />
   ```

   with `const cleanupRoute = useResolvedRoute("dictationCleanup");` near the other hooks.

   - Because the trial reducer resets when Say something unmounts, keep the last successful take for this step. Add `const [lastTake, setLastTake] = useState<{ rawText: string | null; text: string } | null>(null);` and `useEffect(() => { if (trial.phase === "success") setLastTake({ rawText: trial.rawText, text: trial.text }); }, [trial.phase, trial.rawText, trial.text]);`.
   - Pass `userText={lastTake?.rawText ?? lastTake?.text ?? null}` instead of the `trial` expression above.

4. Change `test/components/fieldDirectionPolicy.test.js:77` to `"src/components/onboarding/CleanupStep.tsx": ["ltr"],`.

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
         "exampleNotice": "Example text until you connect. Nothing was sent.",
         "localExampleNotice": "Example text. Your own sentence appears here once local cleanup is ready on this device.",
         "example": {
           "original": "um let's send the draft to maya before lunch and uh remind me to book the room for thursday",
           "local": "Let's send the draft to Maya before lunch and remind me to book the room for Thursday.",
           "codex": "Let's send the draft to Maya before lunch. Remind me to book the room for Thursday.",
           "provider": "Let's send Maya the draft before lunch, and remind me to book the room for Thursday."
         },
         "now": {
           "off": "Cleanup is off. Your words stay exactly as you said them.",
           "ready": "Cleanup is on with {{name}}.",
           "needsKey": "Add your {{provider}} key in Settings after setup. Cleanup stays off until then.",
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

Run: `npm test -- test/utils/onboardingCleanupPreview.test.js test/components/onboardingCleanup.test.js test/components/onboardingCleanupWiring.test.js test/components/fieldDirectionPolicy.test.js test/utils/onboardingCleanup.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS. The three superseded-check tests in `onboardingCleanupWiring.test.js` must still pass unchanged apart from the labels. They protect "a late check never re-enables cleanup".

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingCleanupPreview.ts src/components/onboarding/CleanupStep.tsx src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/utils/onboardingCleanupPreview.test.js test/components/onboardingCleanup.test.js test/components/onboardingCleanupWiring.test.js test/components/fieldDirectionPolicy.test.js
git commit -m "feat(onboarding): choose cleanup by seeing your own words before and after"
```

---

### Task 17: Shortcut, with a live keycap

Covers ONB-R7 B and the rest of ONB-Q17 for this step ("Press this anywhere to talk…").

**Files:**
- Create: `src/components/onboarding/ShortcutStep.tsx`
- Modify: `src/components/onboarding/useDictationHotkey.ts`. Add `useShortcutDemo`.
- Modify: `src/components/OnboardingFlow.tsx`. Delete the legacy `ShortcutsStep` (836-929), and the `usePermissions` import and call (16, 1068) if nothing else uses them.
- Modify: `src/styles/onboarding.css` (append)
- Test: `test/components/onboardingShortcutStep.test.js`

**Interfaces:**
- Consumes `KeycapState` and `suggestActivationMode` (Task 15), `LiveKeycap` (Task 14), `RecoveryCard` (Task 10), `HotkeyListInput` (`src/components/ui/HotkeyListInput.tsx:37`, `{ value, onChange, required, maxHotkeys }`), `useHotkeyModeInfo(scope, hotkey)` (`src/hooks/useHotkeyModeInfo.ts:33`, which returns `supportsPushToTalk`), `Toggle`, and the settings setters `setDictationKey`, `setActivationMode` and `setAutoPasteEnabled`.
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
const { mountComponent } = require("../helpers/harness/mountComponent");

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
  assert.ok(ui.text().includes('setupFlow.shortcut.hint {"key":"fn"}'));
});

test("a held press reads as Shortcut works · Hold to talk and offers to switch", async (t) => {
  const { ui, events } = await shortcut(t, { keycap: keycap({ presses: 1, lastStyle: "hold" }) });
  assert.ok(ui.text().includes("setupFlow.shortcut.works"));
  assert.ok(ui.text().includes("setupFlow.shortcut.detected.hold"));
  assert.ok(ui.text().includes("setupFlow.shortcut.fills"));
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/onboardingShortcutStep.test.js`
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

3. In `src/components/OnboardingFlow.tsx`, delete the legacy `ShortcutsStep` and add:

   ```tsx
   useShortcutDemo(step === "shortcuts");
   const modeInfo = useHotkeyModeInfo("dictation", settingsHotkey);
   ```

   For `step === "shortcuts"`:
   - `railMode` is `{ kind: "idle" }`, or `{ kind: "download", … }` while the voice is still downloading.
   - `primary` is Continue.
   - The children are:

   ```tsx
   <ShortcutStep
     platform={platform}
     hotkey={settingsHotkey}
     hotkeyLabel={hotkeyLabel}
     activationMode={activationMode}
     pushSupported={modeInfo.supportsPushToTalk}
     keycap={keycap}
     accessibilityMissing={accessibility.granted === false}
     onGrantAccessibility={accessibility.request}
     autoPasteEnabled={useSettingsStore.getState().autoPasteEnabled}
     onAutoPasteChange={(value) => useSettingsStore.getState().setAutoPasteEnabled(value)}
     onActivationModeChange={(mode) => useSettingsStore.getState().setActivationMode(mode)}
     onHotkeyChange={(value) => useSettingsStore.getState().setDictationKey(value)}
   />
   ```

   Read `autoPasteEnabled` through the existing selector at line 1063, not `getState()`, so the switch re-renders. While the user captures a new key, `HotkeyListInput` puts main in listening mode. `createHotkeyCallback` returns before `reportDictationHotkey` in that case (Task 4), so capture presses never count as a test.

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

Preview: open `?preview=onboarding&step=shortcuts&scenario=ready&platform=macos` and hold **Hold shortcut** for about a second. You should see "Shortcut works · Hold to talk detected" and a Switch offer. With `scenario=accessibility-missing`, presses never arrive and the Grant access card shows.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/ShortcutStep.tsx src/components/onboarding/useDictationHotkey.ts src/components/OnboardingFlow.tsx src/styles/onboarding.css src/locales test/components/onboardingShortcutStep.test.js
git commit -m "feat(onboarding): live keycap shortcut tester that detects tap versus hold"
```

---

### Task 18: An honest Ready, and the last of the legacy flow

Covers ONB-R8 A and ONB-Q14, finishes ONB-Q18, and consumes §5.1 for readiness.

**Files:**
- Create: `src/utils/onboardingReadiness.ts`
- Create: `src/utils/afterSetupIntent.ts`
- Create: `src/components/onboarding/ReadyStep.tsx`
- Modify: `src/components/OnboardingFlow.tsx`. Delete the legacy `FinishStep` (931-1008), the legacy `readiness` memo (1259-1302), `legacy()`, the `onboarding-welcome.css` and `onboarding-guided.css` imports, `ChoiceCard` (245-301), and any remaining `preview`/`scenario` helper not used by `chooseCleanup`. Widen `Props.onComplete`.
- Modify: `src/AppRouter.jsx:66-72`. The `onComplete` callback forwards the intent.
- Modify: `src/components/ControlPanel.tsx`. Add, after `handleNewNote` (137-141), an effect that takes the intent.
- Delete: `src/styles/onboarding-welcome.css` and `src/styles/onboarding-guided.css`. Also delete the `.onb-legacy` rule in `src/styles/onboarding.css`.
- Modify: `src/styles/onboarding.css` (append)
- Test: `test/utils/onboardingReadiness.test.js`, `test/components/onboardingReady.test.js` and `test/components/onboardingNoPreviewBranches.test.js`

**Interfaces:**
- Consumes `ResolvedRoute` and `useResolvedRoute` (§5.1), `PrivacyDefaults` (Task 12), the state Tasks 10, 13 and 15 already hold in the flow (`mic.access`, `voiceDownload.state.status`, `trial.successes`, `accessibility.granted`, `keycap.presses`), and `useCreateNote` (already in `ControlPanel`).
- Produces `onboardingReadiness.ts`:

  ```ts
  export type ReadinessKey = "speech" | "microphone" | "shortcut" | "cleanup";
  export type ReadinessStatus = "ready" | "pending" | "optional";
  export interface ReadinessRow { key: ReadinessKey; status: ReadinessStatus; step: OnboardingStep; detail: string; values?: Record<string, string> }
  export interface ReadinessInput {
    speechRoute: ResolvedRoute; voiceDownload: VoiceDownloadState["status"];
    microphone: "granted" | "denied" | "unknown"; trialSucceeded: boolean;
    platform: "darwin" | "linux" | "win32"; accessibilityGranted: boolean | null;
    shortcutLabel: string; activationMode: "tap" | "push";
    cleanupRoute: ResolvedRoute;
  }
  export function summarizeReadiness(input: ReadinessInput): { rows: ReadinessRow[]; pending: number; allReady: boolean; allLocal: boolean };
  ```

  Rows come in the order Speech, Microphone, Shortcut, Cleanup. Cleanup that is off is `optional` and never counts as pending.
- Produces `afterSetupIntent.ts`:
  - `type AfterSetupIntent = "dictate-note"`
  - `setAfterSetupIntent(intent)`
  - `takeAfterSetupIntent(): AfterSetupIntent | null`. It is one-shot.
- Changes `OnboardingFlow`'s `onComplete` to `(options?: { openSettings?: boolean; next?: AfterSetupIntent }) => void`.

- [ ] **Step 1: Write the failing tests**

Create `test/utils/onboardingReadiness.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingReadiness.ts");
const route = (id, patch = {}) => ({
  id,
  kind: id === "dictationStt" ? "speech" : "text",
  locality: "device",
  provider: null,
  model: id === "dictationStt" ? "Parakeet Unified EN 0.6B" : null,
  state: { status: "ready" },
  sends: null,
  settingsPath: "x",
  ...patch,
});
const input = (patch = {}) => ({
  speechRoute: route("dictationStt"),
  voiceDownload: "ready",
  microphone: "granted",
  trialSucceeded: true,
  platform: "darwin",
  accessibilityGranted: true,
  shortcutLabel: "fn",
  activationMode: "tap",
  cleanupRoute: route("dictationCleanup", { state: { status: "off" } }),
  ...patch,
});

test("everything done: ready, with cleanup off as optional, in the agreed order", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(input());
  assert.deepEqual(summary.rows.map((row) => [row.key, row.status]), [
    ["speech", "ready"],
    ["microphone", "ready"],
    ["shortcut", "ready"],
    ["cleanup", "optional"],
  ]);
  assert.deepEqual([summary.pending, summary.allReady, summary.allLocal], [0, true, true]);
});

test("pending rows name what is missing and link to the step that fixes it", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(
    input({
      speechRoute: route("dictationStt", { state: { status: "needsModel" } }),
      voiceDownload: "downloading",
      microphone: "denied",
      trialSucceeded: false,
      accessibilityGranted: false,
    })
  );
  assert.deepEqual(summary.rows.slice(0, 3).map((row) => [row.status, row.detail, row.step]), [
    ["pending", "speech.downloading", "speech"],
    ["pending", "microphone.denied", "welcome"],
    ["pending", "shortcut.needsAccessibility", "shortcuts"],
  ]);
  assert.equal(summary.pending, 3);
  assert.equal(summary.allReady, false);
});

test("a finished download is ready even before the route refreshes", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(input({ speechRoute: route("dictationStt", { state: { status: "needsModel" } }), voiceDownload: "ready" }));
  assert.equal(summary.rows[0].status, "ready");
});

test("Linux has no Accessibility step; a working trial proves the microphone", async () => {
  const { summarizeReadiness } = await load();
  const summary = summarizeReadiness(input({ platform: "linux", accessibilityGranted: null, microphone: "unknown", trialSucceeded: true }));
  assert.equal(summary.rows[1].status, "ready");
  assert.equal(summary.rows[2].status, "ready");
});

test("cleanup that cannot finish is pending with its reason; remote cleanup is not local", async () => {
  const { summarizeReadiness } = await load();
  const needsKey = summarizeReadiness(
    input({ cleanupRoute: route("dictationCleanup", { locality: "remote", provider: "OpenAI", state: { status: "needsKey", provider: "OpenAI" } }) })
  );
  assert.deepEqual([needsKey.rows[3].status, needsKey.rows[3].detail, needsKey.rows[3].values], ["pending", "cleanup.needsKey", { provider: "OpenAI" }]);
  const remote = summarizeReadiness(input({ cleanupRoute: route("dictationCleanup", { locality: "remote", provider: "OpenAI" }) }));
  assert.equal(remote.allLocal, false);
});

test("the after-setup intent is taken exactly once", async () => {
  const { setAfterSetupIntent, takeAfterSetupIntent } = await import("../../src/utils/afterSetupIntent.ts");
  assert.equal(takeAfterSetupIntent(), null);
  setAfterSetupIntent("dictate-note");
  assert.equal(takeAfterSetupIntent(), "dictate-note");
  assert.equal(takeAfterSetupIntent(), null);
});
```

Create `test/components/onboardingReady.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { mountComponent } = require("../helpers/harness/mountComponent");

const rows = (statuses) =>
  ["speech", "microphone", "shortcut", "cleanup"].map((key, index) => ({
    key,
    status: statuses[index],
    step: { speech: "speech", microphone: "welcome", shortcut: "shortcuts", cleanup: "cleanup" }[key],
    detail: `${key}.${statuses[index]}`,
  }));

async function ready(t, summary, patch = {}) {
  const events = [];
  const ui = await mountComponent(t, "/components/onboarding/ReadyStep.tsx", {
    exportName: "ReadyStep",
    props: {
      platform: "darwin",
      summary,
      onResume: (step) => events.push(["resume", step]),
      onDictateNote: () => events.push("note"),
      onOpenWorkspace: () => events.push("workspace"),
      privacy: { historyEnabled: true, onHistoryChange() {}, updatesEnabled: true, onUpdatesChange() {} },
      ...patch,
    },
  });
  return { ui, events };
}

test("all ready: the title says so, icons use status colours, and the note action is live", async (t) => {
  const { ui, events } = await ready(t, { rows: rows(["ready", "ready", "ready", "optional"]), pending: 0, allReady: true, allLocal: true });
  assert.ok(ui.text().includes("setupFlow.ready.titleAllReady"));
  assert.ok(ui.text().includes("setupFlow.ready.subAllLocalMac"));
  assert.deepEqual(ui.byAttr("data-status").map((node) => node.attributes["data-status"]), ["ready", "ready", "ready", "optional"]);
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok(dictate.textContent.includes("setupFlow.ready.dictateNote"));
  await ui.click(dictate);
  await ui.click("setupFlow.ready.openWorkspace");
  assert.deepEqual(events, ["note", "workspace"]);
});

test("pending: the title counts what is left and pending rows resume in-app", async (t) => {
  const { ui, events } = await ready(t, { rows: rows(["ready", "pending", "pending", "optional"]), pending: 2, allReady: false, allLocal: true });
  assert.ok(ui.text().includes('setupFlow.ready.titlePending {"count":2}'));
  const resumable = ui.findAll((node) => node.tagName === "BUTTON" && node.attributes["data-row"] !== undefined);
  assert.deepEqual(resumable.map((node) => node.attributes["data-row"]), ["microphone", "shortcut", "cleanup"]);
  await ui.click(resumable[0]);
  assert.deepEqual(events, [["resume", "welcome"]]);
});

test("Dictate into a note waits for the voice, and says why", async (t) => {
  const { ui } = await ready(t, { rows: rows(["pending", "ready", "ready", "optional"]), pending: 1, allReady: false, allLocal: true });
  const [dictate] = ui.byAttr("data-variant", "live");
  assert.ok("disabled" in dictate.attributes);
  const [reason] = ui.byAttr("id", dictate.attributes["aria-describedby"]);
  assert.ok(reason.textContent.includes("setupFlow.ready.noteNeedsVoice"));
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

test("Dictate into a note is handed to the workspace once", () => {
  const router = fs.readFileSync(path.join(repoRoot, "src/AppRouter.jsx"), "utf8");
  const panel = fs.readFileSync(path.join(repoRoot, "src/components/ControlPanel.tsx"), "utf8");
  assert.match(router, /options\?\.next === "dictate-note"[\s\S]*?setAfterSetupIntent\("dictate-note"\)/);
  assert.match(panel, /takeAfterSetupIntent\(\) === "dictate-note"[\s\S]*?handleNewNote\(\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/utils/onboardingReadiness.test.js test/components/onboardingReady.test.js test/components/onboardingNoPreviewBranches.test.js`
Expected: FAIL. The modules are missing, the legacy CSS files still exist, and `OnboardingFlow.tsx` still has `import.meta.env.DEV`.

- [ ] **Step 3: Implement**

1. Create `src/utils/afterSetupIntent.ts`:

   ```ts
   // One-shot hand-off from setup's Ready step to the workspace (ONB-R8 A,
   // "Dictate into a note"). In-memory on purpose: it must not survive a reload.
   export type AfterSetupIntent = "dictate-note";

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
   import type { ResolvedRoute } from "../lib/routes";
   import type { VoiceDownloadState } from "./onboardingDownload";
   import type { OnboardingStep } from "./onboardingState";

   // Ready says only what is true (ONB-R8 A): routes from spec §5.1 for speech and
   // cleanup, setup's own facts for the microphone and the shortcut.
   export type ReadinessKey = "speech" | "microphone" | "shortcut" | "cleanup";
   export type ReadinessStatus = "ready" | "pending" | "optional";

   export interface ReadinessRow {
     key: ReadinessKey;
     status: ReadinessStatus;
     step: OnboardingStep;
     detail: string;
     values?: Record<string, string>;
   }

   export interface ReadinessInput {
     speechRoute: ResolvedRoute;
     voiceDownload: VoiceDownloadState["status"];
     microphone: "granted" | "denied" | "unknown";
     trialSucceeded: boolean;
     platform: "darwin" | "linux" | "win32";
     accessibilityGranted: boolean | null;
     shortcutLabel: string;
     activationMode: "tap" | "push";
     cleanupRoute: ResolvedRoute;
   }

   function speechRow(input: ReadinessInput): ReadinessRow {
     const base = { key: "speech" as const, step: "speech" as const };
     if (input.voiceDownload === "ready" || input.speechRoute.state.status === "ready") {
       return { ...base, status: "ready", detail: "speech.ready", values: { voice: input.speechRoute.model ?? "" } };
     }
     const downloading = input.voiceDownload === "downloading" || input.voiceDownload === "installing";
     return { ...base, status: "pending", detail: downloading ? "speech.downloading" : "speech.needsModel" };
   }

   function microphoneRow(input: ReadinessInput): ReadinessRow {
     const base = { key: "microphone" as const, step: "welcome" as const };
     if (input.trialSucceeded || input.microphone === "granted") return { ...base, status: "ready", detail: "microphone.ready" };
     return { ...base, status: "pending", detail: input.microphone === "denied" ? "microphone.denied" : "microphone.untested" };
   }

   function shortcutRow(input: ReadinessInput): ReadinessRow {
     const base = { key: "shortcut" as const, step: "shortcuts" as const };
     if (input.platform === "darwin" && input.accessibilityGranted === false) {
       return { ...base, status: "pending", detail: "shortcut.needsAccessibility" };
     }
     return { ...base, status: "ready", detail: `shortcut.ready.${input.activationMode}`, values: { key: input.shortcutLabel } };
   }

   function cleanupRow(input: ReadinessInput): ReadinessRow {
     const base = { key: "cleanup" as const, step: "cleanup" as const };
     const route = input.cleanupRoute;
     switch (route.state.status) {
       case "off":
         return { ...base, status: "optional", detail: "cleanup.off" };
       case "ready":
         return { ...base, status: "ready", detail: "cleanup.ready", values: { name: route.model ?? route.provider ?? "" } };
       case "needsKey":
         return { ...base, status: "pending", detail: "cleanup.needsKey", values: { provider: route.state.provider } };
       case "needsModel":
         return { ...base, status: "pending", detail: "cleanup.needsModel" };
       default:
         return { ...base, status: "pending", detail: "cleanup.unreachable", values: { provider: route.provider ?? "" } };
     }
   }

   export function summarizeReadiness(input: ReadinessInput) {
     const rows = [speechRow(input), microphoneRow(input), shortcutRow(input), cleanupRow(input)];
     const pending = rows.filter((row) => row.status === "pending").length;
     const cleanupLocal = input.cleanupRoute.state.status === "off" || input.cleanupRoute.locality === "device";
     return { rows, pending, allReady: pending === 0, allLocal: input.speechRoute.locality === "device" && cleanupLocal };
   }
   ```

3. Create `src/components/onboarding/ReadyStep.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Check, CircleAlert, Minus } from "../icons";
   import { Button } from "../ui/button";
   import type { OnboardingStep } from "../../utils/onboardingState";
   import type { ReadinessRow } from "../../utils/onboardingReadiness";
   import { PrivacyDefaults, type PrivacyDefaultsProps } from "./PrivacyDefaults";

   export interface ReadyStepProps {
     platform: "darwin" | "linux" | "win32";
     summary: { rows: ReadinessRow[]; pending: number; allReady: boolean; allLocal: boolean };
     onResume(step: OnboardingStep): void;
     onDictateNote(): void;
     onOpenWorkspace(): void;
     privacy: Omit<PrivacyDefaultsProps, "platform">;
   }

   const ICONS = { ready: Check, pending: CircleAlert, optional: Minus } as const;

   export function ReadyStep({ platform, summary, onResume, onDictateNote, onOpenWorkspace, privacy }: ReadyStepProps) {
     const { t } = useTranslation();
     const device = platform === "darwin" ? "Mac" : "Other";
     const speechReady = summary.rows[0]?.status === "ready";
     const title = summary.allReady
       ? t("setupFlow.ready.titleAllReady")
       : t("setupFlow.ready.titlePending", { count: summary.pending });
     const sub = summary.allReady
       ? t(summary.allLocal ? `setupFlow.ready.subAllLocal${device}` : "setupFlow.ready.subAllReady")
       : t(speechReady ? "setupFlow.ready.subPending" : "setupFlow.ready.subWaitingForVoice");

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
               return (
                 <li key={row.key}>
                   {row.status === "ready" ? (
                     <div className="onb-ready-row">{content}</div>
                   ) : (
                     <button type="button" className="onb-ready-row" data-row={row.key} onClick={() => onResume(row.step)}>
                       {content}
                     </button>
                   )}
                 </li>
               );
             })}
           </ul>
           <div className="onb-ready__actions">
             <Button variant="live" onClick={onDictateNote} disabled={!speechReady} aria-describedby={speechReady ? undefined : "onb-ready-note-reason"}>
               {t("setupFlow.ready.dictateNote")}
             </Button>
             <Button variant="ghost" onClick={onOpenWorkspace}>
               {t("setupFlow.ready.openWorkspace")}
             </Button>
           </div>
           {speechReady ? null : (
             <p id="onb-ready-note-reason" className="onb-muted">
               {t("setupFlow.ready.noteNeedsVoice")}
             </p>
           )}
         </section>
         <PrivacyDefaults platform={platform} {...privacy} />
       </>
     );
   }
   ```

4. In `src/components/OnboardingFlow.tsx`:
   - Widen `Props.onComplete` to `(options?: { openSettings?: boolean; next?: AfterSetupIntent }) => void`.
   - Add `const speechRoute = useResolvedRoute("dictationStt");` and:

   ```tsx
   const summary = summarizeReadiness({
     speechRoute,
     voiceDownload: voiceDownload.state.status,
     microphone: mic.access,
     trialSucceeded: trial.successes > 0 || lastTake !== null,
     platform,
     accessibilityGranted: accessibility.granted,
     shortcutLabel: hotkeyLabel,
     activationMode,
     cleanupRoute,
   });
   ```

   For `step === "finish"`:
   - `primary` and `onSkip` are `undefined`;
   - `finishLater` is `undefined`;
   - the children are:

   ```tsx
   <ReadyStep
     platform={platform}
     summary={summary}
     onResume={goTo}
     onDictateNote={() => finish({ next: "dictate-note" })}
     onOpenWorkspace={() => finish()}
     privacy={{
       historyEnabled: dataRetentionEnabled,
       onHistoryChange: setDataRetentionEnabled,
       updatesEnabled,
       onUpdatesChange: (value) => {
         setUpdatesEnabled(value);
         void window.electronAPI?.updates?.preferences?.({ enabled: value });
       },
     }}
   />
   ```

   - Delete everything listed under Files for this task.
   - Replace `const preview = Boolean(import.meta.env.DEV && window.loquiBrowserPreview);` (1016) with nothing. `chooseCleanup` now uses `Boolean(previewConfig)` (Task 16).
   - Delete the two legacy CSS imports.

5. In `src/AppRouter.jsx`:
   - Add `import { setAfterSetupIntent } from "./utils/afterSetupIntent";`.
   - Change the `onComplete` prop to:

   ```jsx
                 onComplete={(options) => {
                   localStorage.setItem("onboardingCompleted", "true");
                   window.electronAPI?.updates?.completeSetup();
                   if (options?.next === "dictate-note") setAfterSetupIntent("dictate-note");
                   setShowOnboarding(false);
                 }}
   ```

6. In `src/components/ControlPanel.tsx`:
   - Add `import { takeAfterSetupIntent } from "../utils/afterSetupIntent";`.
   - Directly after `handleNewNote` (137-141), add:

   ```tsx
     // Setup's "Dictate into a note" (ONB-R8 A): open a new note with its recorder running.
     useEffect(() => {
       if (takeAfterSetupIntent() === "dictate-note") void handleNewNote();
     }, [handleNewNote]);
   ```

   `createNote` already starts recording for a new note (`src/hooks/useCreateNote.ts:50-51`). Plan 06 rewrites `ControlPanel`; this effect is the whole contact surface. Keep it next to `handleNewNote` so Plan 06 carries it.

7. Delete `src/styles/onboarding-welcome.css`, `src/styles/onboarding-guided.css`, and the `.onb-legacy` rule from `src/styles/onboarding.css`. Then append:

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
         "titleAllReady": "You're dictating.",
         "titlePending_one": "Almost set: {{count}} thing left.",
         "titlePending_other": "Almost set: {{count}} things left.",
         "subAllLocalMac": "Your first dictation worked. Everything runs on this Mac.",
         "subAllLocalOther": "Your first dictation worked. Everything runs on this computer.",
         "subAllReady": "Your first dictation worked.",
         "subPending": "You can dictate now; the rest unlocks as you finish it.",
         "subWaitingForVoice": "Dictation starts as soon as your voice is ready.",
         "rows": { "speech": "Voice", "microphone": "Microphone", "shortcut": "Shortcut", "cleanup": "Cleanup" },
         "details": {
           "speech": { "ready": "{{voice}}", "downloading": "Still downloading", "needsModel": "Download a voice" },
           "microphone": { "ready": "Working", "denied": "Allow in System Settings", "untested": "Say something to test it" },
           "shortcut": {
             "ready": { "tap": "{{key}}, tap to start and stop", "push": "{{key}}, hold to talk" },
             "needsAccessibility": "Grant Accessibility"
           },
           "cleanup": {
             "off": "Off. Add it later",
             "ready": "On with {{name}}",
             "needsKey": "Add your {{provider}} key in Settings",
             "needsModel": "Download the local model in Settings",
             "unreachable": "Can't reach {{provider}}"
           }
         },
         "dictateNote": "Dictate into a note",
         "openWorkspace": "Open workspace",
         "noteNeedsVoice": "Available once your voice has downloaded."
       }
     }
   }
   JSON
   npx prettier --write "src/locales/**/translation.json"
   ```

   Delete the now-unused `setupFlow.rail.finish.openWorkspace` key from every locale. Keep `setupFlow.rail.finish.title` and the `body*` keys; the rail still uses them.

   ```bash
   node -e 'const fs=require("fs"),p=require("path");for(const l of fs.readdirSync("src/locales")){const f=p.join("src/locales",l,"translation.json");if(!fs.existsSync(f))continue;const j=JSON.parse(fs.readFileSync(f,"utf8"));delete j.setupFlow?.rail?.finish?.openWorkspace;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");}'
   npx prettier --write "src/locales/**/translation.json"
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/utils/onboardingReadiness.test.js test/components/onboardingReady.test.js test/components/onboardingNoPreviewBranches.test.js test/components/onboardingFlow.test.js test/components/onboarding*.test.js test/components/personalWorkspace.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS. The flow walk now ends through Ready's "Open workspace".

- [ ] **Step 5: Commit**

```bash
git add src/utils/onboardingReadiness.ts src/utils/afterSetupIntent.ts src/components/onboarding/ReadyStep.tsx src/components/OnboardingFlow.tsx src/AppRouter.jsx src/components/ControlPanel.tsx src/styles/onboarding.css src/locales test/utils/onboardingReadiness.test.js test/components/onboardingReady.test.js test/components/onboardingNoPreviewBranches.test.js
git rm src/styles/onboarding-welcome.css src/styles/onboarding-guided.css
git commit -m "feat(onboarding): honest Ready summary and Dictate into a note"
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

   - Pass `key={onboardingStart.key}` and `initialStep={onboardingStart.step}` to `<OnboardingFlow …>`.
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
- **Keep these untranslated:**
  - `cleanup.example.original` is a sample of *spoken English with fillers*. Translate it into natural spoken filler-laden text in the target language, and translate the three `cleanup.example.*` cleaned versions to match it word for word, so the diff still highlights changes.
  - `tour.demo.raw` and `tour.demo.final` follow the same rule.
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

**Files:** none new. This task runs every check and fixes what they surface.

- [ ] **Step 1: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
grep -rn "onboarding-guided\|onboarding-welcome\|WelcomeScreen\|BrowserTrial\|DesktopTrial" src test
```

Expected:
- every command passes;
- the last grep prints nothing.

A failing pre-existing test may be updated in this branch only when it asserted the old setup:
- the step order;
- the "Explore first" or "A quieter way to get words out" copy;
- the reload in `useStartOnboarding`;
- the legacy speech model list in `personalWorkspace`.

List each one in the PR description. Treat any other failure as a regression and fix the code.

- [ ] **Step 2: Browser preview pass**

Run `npm run dev:renderer`, then open `http://127.0.0.1:5183/?preview=onboarding`. Use the toolbar to walk each scenario across the steps it affects, at 1440×900, 900×640 and 640×560, in light and Plum Night. Take a screenshot for each row:

| Scenario | Check |
|---|---|
| `fresh` | Hello asks for the mic. Voice picks Fast and English. Download starts the tour. At 100% the stage pops to "Ready. Say something." Hold shortcut fills the field, the mark docks, and the band appears. |
| `multilingual` | Voice says "…uses Spanish and English" and picks Many languages. |
| `low-disk` | Voice shows the disk note with real numbers. |
| `downloading` | Say something opens straight onto the tour with the chip already counting. |
| `download-interrupted` | The chip shows Download failed with Retry, and "Download stopped at 35%. Your progress is kept." The tour stays. Continue still works. Retry resumes from 35%. |
| `microphone-denied` | Hello shows one recovery card. The trial fails with the mic card. |
| `nothing-heard` | The silence hint appears after 2.5 s. Stop gives "We didn't hear anything", and "Change microphone" returns to Hello's picker. |
| `insufficient-memory` | The trial offers "Choose another voice". |
| `cleanup-failed` | The success shows the raw words with Retry cleanup and Turn cleanup off. |
| `accessibility-missing` (macOS) | The trial and Shortcut show Grant access. "Use a button instead" works. |
| `codex-missing`, `codex-expired`, `invalid-provider-key` | Cleanup ChatGPT and API key say "Example text until you connect. Nothing was sent." The Now line is honest. |
| `ready` | Ready says "You're dictating." and "Dictate into a note" is live. |

Then repeat `fresh` with these, and screenshot them too:
- OS reduced motion on: no tour auto-advance, no idle breathe, a static keycap, and numeric captions throughout;
- the `ar` locale: RTL, so progress arrows and radio arrow keys follow reading order, and the band buttons sit at the inline end.

- [ ] **Step 3: Desktop pass (privacy and the real shortcut)**

```bash
npm run native:electron
npm run dev
```

On a fresh test profile (never a personal profile), on macOS:
1. On Hello, allow the mic. The meter moves with your voice. Pick a different input in the picker (for example, AirPods). The meter follows it. After setup, dictate once and confirm Settings → Microphone shows the same device.
2. On Voice, press Download. On Say something, if Accessibility is granted, press **fn**:
   - the keycap presses;
   - the rail follows your voice;
   - your words appear;
   - "Shortcut works" shows;
   - the mark docks.
3. **Privacy check (Review Focus 1).** With a text editor focused behind Loqui, press fn and speak. Nothing is pasted into the editor. Then finish setup, open History, and confirm the trial is not there.
4. Leave Say something mid-recording with Back. The mic indicator turns off, and nothing appears later (Review Focus 2).
5. Kept progress (owner decision 3): start a voice download, turn Wi-Fi off until the chip says Download failed, and confirm "Your progress is kept". Turn Wi-Fi on and press Retry. The percent continues from where it stopped instead of restarting at 0.
6. In Shortcut, hold fn for about a second. You see "Hold to talk detected" and Switch. After switching, holding fn dictates in the workspace.
7. On Ready, press "Dictate into a note". A new note opens with its recorder running.
8. From the workspace resume card, click "Choose text cleanup". Setup opens on Cleanup with no window reload.

Repeat steps 1–3 on Linux (X11 or GNOME): no Accessibility rows, and the default shortcut from `getEffectiveDefaultHotkey` works.

- [ ] **Step 4: Commit any fixes, then prepare the PR**

```bash
git status
git log --oneline main..HEAD
```

Write `pr-body.md`:
- one line per Task 1–20 commit;
- links to the spec, this plan and the four contract change requests (state which owners have answered);
- the Step 2 and Step 3 screenshots;
- the updated pre-existing tests from Step 1;
- who reviewed the `ar`, `ja` and `zh-TW` strings.

Get the owner's explicit OK before `git push` or `gh pr create`. Publishing is outward-facing.
