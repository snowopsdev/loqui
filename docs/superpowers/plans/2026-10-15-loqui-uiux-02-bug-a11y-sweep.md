# Loqui UI/UX Plan 02 — Bug & a11y sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 20 standalone correctness and accessibility quick wins assigned to Plan 02, plus the three a11y follow-ups from Plan 01's final review:
- ONB-Q1, ONB-Q2;
- VO-Q6, VO-Q8, VO-Q9, VO-Q16;
- WS-Q1, WS-Q5, WS-Q7;
- SET-Q1, Q2, Q5, Q6, Q7, Q11, Q12, Q13, Q16, Q20, Q25;
- Plan 01 review: full-opacity focus rings, 3:1 form-control edges, and light status-fill text.

**Base:** execute on a branch cut from `snowopsdev/feat/uiux-foundations` at `172f9df` (Plan 01, finished), or from `main` once Plan 01 merges.
- Every line number in this plan was checked against that commit.
- Plan 01 shifted `src/components/OnboardingFlow.tsx` by one line after line 820. It also rewrote `src/index.css`, `src/components/ui/button.tsx` and `src/components/ControlPanelSidebar.tsx`.

**Architecture:** Tasks 1–3 adjust Plan 01's colour tokens and the shared primitives that consume them. Every later fix stays inside the component, hook or main-process module that owns the bug. Where the logic is non-trivial, the task extracts a small pure helper next to its caller so `node:test` can pin it without a DOM:
- `chatInputKeys.ts`, `providerTabsKeys.ts`, `upcomingEventGroups.ts`, `audioDeletion.ts`, `noteActionsReadiness.ts`;
- the main-process `systemNotification.js`.

Only one new channel crosses the IPC boundary. VO-Q16 adds a main-owned native notification (`show-system-notification`) behind a typed preload method. Two existing IPC results gain fields: Clear All Audio reports failures, and the download cancel reports confirmation. Toast fixes stay on the existing toast API so Plan 04 can migrate them to `notify()` (§5.3).

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Electron (main + preload), i18next, Node `node:test`.
- Renderer tests use Vite SSR (`test/lib/rendererTestHarness.js`) plus `react-dom/server` or `react-dom/client`.
- Source-text assertions follow `test/components/rtlMotion.test.js`.
- Contrast tests use Plan 01's `test/helpers/harness/cssTokens.js` (`resolveTokens`) and `src/utils/contrast.ts` (`contrastRatio`).

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`:
- §3, the Plan 02 row;
- decisions D1 (`--color-link` for links; orange stays the light focus-ring accent), D2 (native interruption alerts), D3 (Esc armed until idle) and D10 (`DESIGN.md` is updated with the code);
- §4 global constraints;
- §5 Plan 01 tokens, §5.1 (Plan 03 route graph), §5.2 and §5.3 (Plan 04 owns the lifecycle and `notify()`).

Item text: `.omc/research/ui-review/approved-todo.md` in the research worktree. The format reference is `docs/superpowers/plans/2026-10-15-loqui-uiux-01-foundations.md`.

## Contract change requests

These need the spec owner's sign-off. The plan is written as if they are accepted. If one is rejected, the named task changes as noted.

1. **Add §5.5 System notifications (owner: Plan 02, then Plan 04; consumers: 04).** Task 10 adds:
   ```ts
   window.electronAPI.showSystemNotification(payload: { title: string; body?: string }):
     Promise<{ success: boolean; reason?: "disabled" | "unsupported" | "invalid" }>
   ```
   - Main shows an Electron `Notification`.
   - It honours the existing master `notificationsEnabled` preference.
   - Clicking the notification focuses the window that sent it.

   D2's Linux fallback needs "a persistent notification with a Stop action", and D2 says Plan 04 owns that state. Plan 04 should extend this method with `actions` rather than add a second notification path. **If rejected:** Task 10 still ships, but the method is documented as internal to `MeetingRecordingMount`.
2. **Extend Plan 01's colour-token contract (§5, "Motion and colour tokens").** The changes come from Plan 01's final review.
   - **New token:** `--color-input-border` (light `#858585`, Plum Night `#8c6b7b`; Task 2).
   - **Changed light values:**
     - `--color-ring` `#ff5a1f` becomes `#e84e16` (Task 3). Plum Night keeps `#ff5a1f`.
     - `--color-warning-foreground` and `--color-success-foreground` change from `#ffffff` to `#171717` (Task 1).

   **If rejected:** Tasks 1–3 move to a Plan 01 follow-up, and Task 4 uses `ring-foreground/40` for the progress track instead of `ring-input-border`.
3. **FYI, no spec change: `UpdateStatus.phase` gains `"available"`** (Task 16). It means a manual check found a newer version while automatic updates are off. Plan 03 moves `UpdateSettings` into its new IA and must keep rendering this phase. This reverses a deliberate earlier rule pinned in `test/helpers/updateManager.test.js:187` ("the off switch also blocks manual checks"); SET-Q16 is the owner's pick.

## Interfaces this plan produces for later plans

| Item | Where | Consumer |
|---|---|---|
| `--color-input-border`, light `--color-ring` `#e84e16` (CCR 2) | `src/index.css` | every plan's form controls and focus rings |
| `showSystemNotification` (CCR 1) | `preload.js`, `src/types/electron.ts`, `src/helpers/systemNotification.js` | Plan 04 (D2 recorder alerts) |
| `useNow(intervalMs?)` | `src/hooks/useNow.ts` | Plan 06 (Ready strip, sessions) |
| `ChatInputProps.onTextSubmit` returns `void \| boolean \| Promise<void \| boolean>`; `false` or a rejection keeps the draft | `src/components/chat/ChatInput.tsx` | Plan 06 (WS-R8 chat) |
| `useModelDownload().cancelDownload` resolves `true` only when main confirmed the cancel | `src/hooks/useModelDownload.ts` | Plan 05 (ONB-R4) |
| `useNoteActionsReady(): boolean \| null` | `src/hooks/useNoteActionsReady.ts` | replaced by Plan 03's `useResolvedRoute("noteFormatting")` |
| `ProviderTabItem.keySaved` | `src/components/ui/ProviderTabs.tsx` | Plan 03 (SET-R5 keyring wires real key status) |
| `ModelCard` `selectionRole`, `ModelCardList` `ariaLabel` | `src/components/ui/ModelCardList.tsx` | Plan 03 (SET-R4 cartridge cards) |
| `rendererOptions`, `I18N_KEYS_MOCK`, `TOAST_MOCK` | `test/helpers/harness/rendererMocks.js` | every later plan's renderer tests |
| `installTree` (with `find`, `props`) | `test/helpers/harness/fakeDomTree.js` | renderer tests that click or type |

**Notes for Plan 04:**
- **Esc (D3).** Task 9 arms Esc as soon as a recording exists, including a stop that lands mid-start. It releases Esc only on the idle edge in `useAudioRecording`'s `onStateChange`, and on unmount. When Plan 04 adds the `cancelled` state, that state counts as idle for Esc. The undo uses ⌥Z, not Esc.
- **Dictation-error cards (VO-Q6).** Task 7 makes a card with a recoverable transcript persistent (`duration: 0`). `notify({ kind: "alert" })` must keep that rule: an alert never auto-dismisses while user content is at stake.

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md).
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure. In this plan:
  - arrow keys move focus but never select a provider or model (Tasks 14–15);
  - a chat draft that is refused or fails to send comes back into the composer (Task 12);
  - a download cancel that main refuses leaves the download visible (Task 6).
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night.
  - Focus rings are full opacity.
  - A contrast claim is pinned by a test that scores the real tokens with `resolveTokens` and `contrastRatio`, not by class names alone.
- Motion uses Plan 01's `--motion-*` tokens only. Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms (the existing policy in `src/index.css`; do not weaken it).
- Every visible string goes through i18n with keys in all 11 locales: `ar de en es fr it ja pt ru zh-CN zh-TW`. Interpolation placeholders must match across locales. `npm run i18n:check` passes, and `test/locales/translationCoverage.test.js` passes.
- RTL: use logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). The one deliberate exception is the macOS traffic-light clearance in Task 5, which is physical because the traffic lights are.
- `src/index.css` is edited only by Tasks 1–3, the token and form-control changes. Onboarding CSS goes in `src/styles/onboarding-welcome.css`.
- New locale keys go inside existing namespaces, never as new top-level keys. That keeps each locale diff inside one object. `updates` is the last top-level object before Plan 01's `locality`, so Task 16 inserts its key mid-object.
- `DESIGN.md` is the source of truth (D10). Tasks 1–3 and 4 update the sections they change in the same commit.
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
2. **Cancel during the onboarding download.** Main refuses to cancel once extraction starts. If the click races that transition, the download must stay visible and its success must still mark the model ready. A retry must wait until main has settled the cancelled request. Pinned in Task 6 by:
   - "a cancel main refuses keeps the download and its result";
   - "a confirmed cancel returns to idle and a late result cannot mark it interrupted";
   - "Download stays disabled until the cancelled request settles".
3. **A chat send that is refused or fails.** The sender resolves `false` when another send holds the lock, and rejects on errors. The draft, whether typed or queued, must come back into the box, never vanish. Pinned in Task 12 by "a refused send puts the draft back", "a failed send puts the draft back" and "a queued draft sends on idle and Stop cancels the queue".
4. **IME composition in the chat composer.** A Japanese or Chinese user who presses Enter to accept a candidate must not send or queue the message. Pinned in Task 12 by "Enter during IME composition does nothing", which covers both `isComposing` and `keyCode` 229.
5. **Arrow keys must not switch a provider or model.** Some tabs switch between local and remote (`ReasoningModelSelector` mode tabs), and some model cards are remote. Arrow keys move focus only; Enter, Space or a click selects.
   - Task 14 pins this with "arrow keys only move focus" (a source assertion that the key handler calls `.focus()` and never `onSelect`).
   - Task 15 pins it with "arrow keys are not a selection path". Opening a model's documentation never selects it ("Learn more never selects the model").

---

### Task 1: Light status fills carry ink text

Plan 01 review, item 3. Plan 01 fixed the Plum Night status tokens by putting dark text on the fill. Light still pairs white text with fills that are too light for it.

**Files:**
- Modify: `src/index.css`:
  - `@theme`, line 33: `--color-success-foreground: #ffffff;`
  - `@theme`, line 35: `--color-warning-foreground: #ffffff;`
- Modify: `DESIGN.md`, `### Roles` (after line 156)
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
  - in `.dark`, add it after `--color-input` (line 240);
  - in the native-field rules, `:root input:not(.input-inline), :root textarea:not(.input-inline)` (lines 1089–1094) and `.dark input:not(.input-inline), .dark textarea:not(.input-inline)` (lines 1104–1110).
- Modify: `src/components/ui/input.tsx:11-19`
- Modify: `src/components/ui/textarea.tsx:12-15`
- Modify: `DESIGN.md`, `### Inputs / Fields` (lines 243–246)
- Test: `test/components/formControlBorders.test.js`

**Interfaces:**
- Consumes `resolveTokens` and `contrastRatio` (Plan 01).
- Produces `--color-input-border` (light `#858585`, Plum Night `#8c6b7b`) and the Tailwind utilities `border-input-border` and `ring-input-border`. Task 4 uses `ring-input-border` for the progress track.

| Edge | Measured contrast |
|---|---|
| `#858585` on light surfaces | 3.24:1 (`surface-raised` `#f0f0f0`) to 3.69:1 (white) |
| `#8c6b7b` on Plum Night surfaces | 3.26:1 (`surface-raised` `#33202b`) to 4.09:1 (`surface-window`) |

Hover no longer lightens the edge. `hover:border-border-hover` (`#d4d4d4`) would drop below 3:1 while the pointer is over the field.

The `Input` and `Textarea` focus rings move to the full-opacity ring with an offset, the same pattern Task 3 gives `Button`. `Textarea` was hard-coded to light-only neutrals and an indigo focus ring in both themes, so it moves onto tokens.

- [ ] **Step 1: Write the failing test**

Create `test/components/formControlBorders.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

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

test("the Input and Textarea primitives use the token and a full-opacity focus ring", () => {
  const ring = /focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background/;
  const input = read("src/components/ui/input.tsx");
  assert.match(input, /\bborder-input-border\b/);
  assert.doesNotMatch(input, /border-border\/70|dark:border-border-subtle|hover:border-border-hover/);
  assert.doesNotMatch(input, /ring-primary\/10|ring-ring\/10/);
  assert.match(input, ring);
  const textarea = read("src/components/ui/textarea.tsx");
  assert.match(textarea, /\bborder-input-border\b/);
  assert.doesNotMatch(textarea, /neutral-|indigo-|bg-white/);
  assert.match(textarea, ring);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/formControlBorders.test.js`
Expected: FAIL. `light["--color-input-border"]` is `undefined`.

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
           "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
   ```

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
             "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
   ```

   Also change `disabled:bg-neutral-50` on the next line to `disabled:bg-muted`.

5. In `DESIGN.md` `### Inputs / Fields`, replace the `**Style:**` and `**Focus:**` bullets (lines 244–245) with:

   ```markdown
   - **Style:** Full-width 40px fields with 6px corners, compact sans text, and a one-pixel `--color-input-border` edge (#858585 light, #8C6B7B Plum Night) that clears 3:1 on every surface a field sits on. Hover does not lighten the edge.
   - **Focus:** A full-opacity 2px `--color-ring` ring with a 1px offset, as on buttons.
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/formControlBorders.test.js test/components/plumNight.test.js test/components/fieldDirectionPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/ui/input.tsx src/components/ui/textarea.tsx DESIGN.md test/components/formControlBorders.test.js
git commit -m "fix(a11y): form-control edges clear 3:1 in light and Plum Night"
```

---

### Task 3: Focus rings at full opacity

Plan 01 review, item 1. Plan 01 fixed `HotkeyInput` with `focus-visible:ring-2 focus-visible:ring-ring`. Two pre-existing rings are still translucent:
- `button.tsx` base: `focus-visible:ring-ring/30`, on every `Button`;
- `ControlPanelSidebar.tsx`, lines 57 and 89: `focus-visible:ring-primary/30`. Both nav buttons use it.

Full opacity alone is not enough in light. `#ff5a1f` clears 3:1 only on pure white (3.12:1), and the sidebar's `surface-window` (`#f7f7f7`) gives 2.91:1. Plan 01 met the same problem with the light nav marker and chose `#e84e16`. Using that value for the light `--color-ring` clears 3:1 on every light surface, from 3.33:1 on `surface-raised` to 3.80:1 on white. The ring stays orange, as D1 requires. Plum Night keeps `#ff5a1f`, at 4.87–6.12:1.

**Files:**
- Modify: `src/index.css`, `@theme` line 24: `--color-ring: #ff5a1f;`
- Modify: `src/components/ui/button.tsx:13`
- Modify: `src/components/ControlPanelSidebar.tsx:57` and `:89`
- Modify: `DESIGN.md`, `### Roles`
- Test: `test/components/focusRings.test.js`

**Interfaces:**
- Consumes `resolveTokens` and `contrastRatio` (Plan 01).
- Produces light `--color-ring` `#e84e16`. Every later task that adds a focus style uses `focus-visible:ring-2 focus-visible:ring-ring`, never an opacity suffix.

- [ ] **Step 1: Write the failing test**

Create `test/components/focusRings.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
const css = read("src/index.css");
const load = () => import("../../src/utils/contrast.ts");

const SURFACES = [
  "--color-background",
  "--color-card",
  "--color-popover",
  "--color-muted",
  "--color-surface-1",
  "--color-surface-raised",
  "--color-surface-window",
];

test("the focus ring clears 3:1 on every surface, in light and Plum Night", async () => {
  const { contrastRatio } = await load();
  const { light, dark } = resolveTokens(css);
  assert.equal(light["--color-ring"], "#e84e16");
  assert.equal(dark["--color-ring"], "#ff5a1f");
  for (const [theme, tokens] of [
    ["light", light],
    ["Plum Night", dark],
  ])
    for (const surface of SURFACES) {
      const ratio = contrastRatio(tokens["--color-ring"], tokens[surface]);
      assert.ok(ratio >= 3, `${theme}: ring on ${surface} is ${ratio}:1`);
    }
});

test("every Button draws a full-opacity ring", () => {
  const button = read("src/components/ui/button.tsx");
  assert.match(
    button,
    /outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background/
  );
  assert.doesNotMatch(button, /ring-ring\/\d+/);
});

test("the workspace sidebar draws a full-opacity ring on both nav buttons", () => {
  const sidebar = read("src/components/ControlPanelSidebar.tsx");
  assert.doesNotMatch(sidebar, /ring-primary\/\d+|ring-ring\/\d+/);
  assert.equal(
    sidebar.match(/focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-window/g)?.length,
    2
  );
});

test("HotkeyInput keeps Plan 01's full-opacity ring", () => {
  assert.match(read("src/components/ui/HotkeyInput.tsx"), /focus-visible:ring-2 focus-visible:ring-ring"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/focusRings.test.js`
Expected: FAIL. The first test's `assert.equal` fails (`#ff5a1f`), and the Button and sidebar tests find `/30`.

- [ ] **Step 3: Implement**

1. `src/index.css` `@theme` line 24 becomes:

   ```css
     /* Deeper orange so a full-opacity ring clears 3:1 on every light surface
        (3.33:1 on surface-raised); #ff5a1f only cleared pure white. Same value
        as the light nav marker. Plum Night keeps #ff5a1f. */
     --color-ring: #e84e16;
   ```

2. `src/components/ui/button.tsx:13`: replace `focus-visible:ring-ring/30` with `focus-visible:ring-ring`.
3. `src/components/ControlPanelSidebar.tsx`, lines 57 and 89: replace `focus-visible:ring-primary/30` with `focus-visible:ring-ring`, in both places.
4. In `DESIGN.md` `### Roles`, append:

   ```markdown
   - **Focus ring** (`--color-ring`): #E84E16 in light (3:1 on every light surface), #FF5A1F in Plum Night. Always 2px and full opacity; never an alpha-reduced ring.
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/focusRings.test.js test/components/colorRoles.test.js test/components/brandGlow.test.js test/components/plumNight.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/ui/button.tsx src/components/ControlPanelSidebar.tsx DESIGN.md test/components/focusRings.test.js
git commit -m "fix(a11y): full-opacity focus rings that clear 3:1 in light"
```

---

### Task 4: Accessible, translated download progress bar

Covers SET-Q25 and the "Downloading" part of SET-Q6. This task also creates the shared renderer-test mocks that later tasks use.

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

test("the fill uses the shared motion tokens", () => {
  assert.match(source, /width var\(--motion-base\) var\(--motion-ease-std\)/);
  assert.doesNotMatch(source, /width 300ms ease-out/);
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
            <Loader2 className="relative w-3.5 h-3.5 text-foreground animate-spin" />
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
          <div className="h-full w-1/3 rounded-full bg-foreground animate-[indeterminate_1.5s_ease-in-out_infinite]" />
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
- Test: `test/components/onboardingShell.test.js`

**Interfaces:**
- Consumes `rendererOptions` (Task 4).
- Produces a `data-platform` attribute (`"darwin" | "win32" | "linux"`) on every `.onboarding-welcome` root. The value comes from the existing `platform` const in `OnboardingFlow` (lines 1070–1075), which already honours the preview config.

Why this works:
- `src/index.css:195-203` sets only `min-height: 100vh` on `html`, `body` and `#root`. `.onboarding-welcome { height: 100% }` therefore resolves to `auto`, and the footer scrolls away with the content.
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/onboardingShell.test.js test/components/onboardingCleanupWiring.test.js test/components/personalWorkspace.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/onboarding-welcome.css src/components/OnboardingFlow.tsx src/components/onboarding/WelcomeScreen.tsx test/components/onboardingShell.test.js
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
- Modify: `src/locales/*/translation.json`. Add `onboarding.download.chip` and `onboarding.download.chipInstalling`.
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
    tree.find((node) => node.tagName === "BUTTON" && node.textContent.includes("Download model"));
  return { ...tree, calls, pending, progress, settle, progressbar, downloadButton };
}

test("the speech step shows the real download percentage", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("Download model");
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
  await flow.click("Download model");
  await flow.progress(flow.calls.downloads[0], 42);
  await flow.click("Continue");
  assert.match(flow.text(), /onboarding\.download\.chip\(percent=42\)/);
});

test("a confirmed cancel returns to idle and a late result cannot mark it interrupted", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("Download model");
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
  await flow.click("Download model");
  await flow.progress(flow.calls.downloads[0], 99);
  await flow.click("common.cancel");
  assert.equal(flow.calls.cancels, 1);
  assert.ok(flow.progressbar(), "the download is still on screen");
  await React.act(async () => flow.pending[0].resolve({ success: true, downloaded: true }));
  assert.match(flow.text(), /is ready/, "its success still marks the model ready");
});

test("Download stays disabled until the cancelled request settles", async (t) => {
  const flow = await mountSpeechStep(t);
  await flow.click("Download model");
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
                 {downloadState === "downloading" ? "Downloading…" : "Download model"}
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/toastLiveRegion.test.js test/components/rtlMotion.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Toast.tsx test/components/toastLiveRegion.test.js
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
  stopRecording() { this.emit({ isRecording: false, isProcessing: true }); return true; }
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
    // Starts a recording that waits in the mic-open phase until released.
    beginHeldStart: async () => {
      let pending;
      await React.act(async () => {
        pending = api.startRecording();
        await waitFor(() => typeof manager().releaseStart === "function");
      });
      return pending;
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

test("a stop that lands mid-start still arms Esc for processing", async (t) => {
  globalThis.__holdStart = true;
  t.after(() => delete globalThis.__holdStart);
  const h = await mountHarness(t);
  const pending = await h.beginHeldStart();
  await h.stop(); // lands while the start still holds the lock
  await h.releaseStart(pending); // the mic opens; the hook honours the stop
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
  - `useNow(intervalMs?: number): Date`, with default `NOW_TICK_MS = 30_000`;
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

  const seen = [];
  function Harness() {
    seen.push(useNow().getTime());
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  assert.equal(intervals.size, 1, "one interval while mounted");
  const [[id, interval]] = [...intervals];
  assert.equal(interval.ms, NOW_TICK_MS);

  const before = seen.length;
  await React.act(async () => interval.callback());
  assert.equal(seen.length, before + 1, "one render per tick");
  await React.act(async () => interval.callback());
  assert.equal(seen.length, before + 2);
  assert.ok(seen.at(-1) >= seen[0], "time never runs backwards");

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

/** A clock for time-relative UI ("Now", "today"). */
export function useNow(intervalMs: number = NOW_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
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

Covers WS-Q5.

**Files:**
- Create: `src/components/chat/chatInputKeys.ts`
- Modify: `src/components/chat/ChatInput.tsx`:
  - imports (line 1);
  - `inputRef` (line 68);
  - `onTextSubmit` prop type (line 17);
  - `handleSubmit` and `handleKeyDown` (lines 86–102);
  - the container (lines 118–127);
  - the `<input>` and the button row (lines 200–273);
  - every `focus-visible:ring-1 focus-visible:ring-ring/30` (lines 167, 182, 228, 242, 264);
  - a queued hint after the container.
- Modify: `src/hooks/useEmbeddedChat.ts:26` and `:145-150`, `src/hooks/useContainerChat.ts:30` and `:134-139`. Return the sender's result instead of discarding it.
- Modify: `src/components/notes/EmbeddedChat.tsx:20`, `src/components/notes/overview/OverviewAskSection.tsx:18` and `:72`. Widen the prop type.
- Modify: `src/components/dictation/AssistantPanel.tsx:323-331` (`handleTextSubmit`). Report a refusal and return the send.
- Modify: `src/locales/*/translation.json`. Add `agentMode.input.queued` and `agentMode.input.unqueue`.
- Test: `test/components/chatComposer.test.js`

**Interfaces:**
- Produces `src/components/chat/chatInputKeys.ts`:
  - `type ComposerKeyAction = "submit" | "queue" | "unqueue" | "none"`;
  - `resolveComposerKey(input: { key: string; shiftKey: boolean; isComposing: boolean; keyCode?: number; isBusy: boolean; isQueued: boolean; hasText: boolean }): ComposerKeyAction`;
  - `COMPOSER_MAX_HEIGHT_PX = 160`;
  - `composerHeight(scrollHeight: number, maxHeight?: number): { height: number; overflowY: "hidden" | "auto" }`.
- `ChatInputProps.onTextSubmit` becomes `(text: string) => void | boolean | Promise<void | boolean>`. `false`, or a rejection, means "not sent", and the composer puts the draft back. `void` and `true` mean sent, so a callback that returns nothing keeps today's behaviour. The callers:
  - `ChatView.tsx:177` already passes the sender, which is `Promise<boolean>`;
  - `EmbeddedChat.tsx:140` and `OverviewAskSection.tsx:63` pass `useEmbeddedChat` and `useContainerChat`'s `sendMessage`, which now return the boolean;
  - `AssistantPanel.tsx:536` returns `false` before history is ready, and the send otherwise.
- Consumes `rendererOptions` and `TOAST_MOCK` (Task 4), and `installTree` with `find` and `props` (Task 6).

Facts from the code:
- `useChatMessageSender` (`src/components/chat/useChatMessageSender.ts:51-79`) resolves `true` only after the whole reply has streamed.
  - It resolves `false` at once when another send holds its lock.
  - It rejects on any error.
- Waiting for it before clearing would leave the sent text in the box for the entire reply. The composer therefore clears at once and puts the text back on `false` or a rejection.
- `ChatInput` is a named export (`ChatInput.tsx:55`), and all four callers import `{ ChatInput }`.

Behaviour:
- **While the agent is busy (`thinking | streaming | tool-executing`),** the textarea stays editable. Enter marks the draft as queued, and the draft stays visible in the box. The draft is sent on the next idle.
- **A refused or failed send puts the draft back.** If the user has already started a new draft, that new text is kept instead.
- **Unqueuing:** Esc, the "Don't send when done" button, Stop, or clearing the text all unqueue. Pressing Stop never sends a queued draft.
- **Line breaks and IME:** Shift+Enter inserts a newline. Enter during IME composition does nothing.
- **Tests:** `fieldDirectionPolicy.test.js:78` expects exactly one `dir="auto"` native field in this file. The `<textarea … />` replaces the `<input … />` one for one.

- [ ] **Step 1: Write the failing test**

Create `test/components/chatComposer.test.js`:

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
const { rendererOptions, TOAST_MOCK } = require("../helpers/harness/rendererMocks");
const { installTree } = require("../helpers/harness/fakeDomTree");

const COMPOSER_MOCKS = {
  "/ui/useToast": TOAST_MOCK,
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};

const loadKeys = () => import("../../src/components/chat/chatInputKeys.ts");
const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/chat/ChatInput.tsx"),
  "utf8"
);
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

async function renderInput(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-chat-composer-", COMPOSER_MOCKS));
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  return renderToStaticMarkup(
    createElement(ChatInput, { partialTranscript: "", onTextSubmit() {}, ...props })
  );
}

test("the composer stays typeable while the agent is busy", async (t) => {
  const html = await renderInput(t, { agentState: "thinking", onCancel() {} });
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
  assert.match(source, /onClick=\{\(\) => \{\s*setQueued\(false\);\s*onCancel\?\.\(\);/);
});

// Mounts the real composer on the fake tree and drives its handlers directly.
async function mountInput(t, onTextSubmit) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(
    t,
    rendererOptions("loqui-chat-composer-mounted-", COMPOSER_MOCKS)
  );
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  let props = { partialTranscript: "", agentState: "idle", onTextSubmit, onCancel() {} };
  const render = (next = {}) => {
    props = { ...props, ...next };
    return React.act(async () => {
      root.render(createElement(ChatInput, props));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  root = createRoot(tree.container);
  await render();
  const textarea = () => tree.find((node) => node.tagName === "TEXTAREA");
  const type = (value) =>
    React.act(async () => tree.props(textarea()).onChange({ target: { value } }));
  // Yields a macrotask inside act so an async send settles (and a refused
  // draft is restored) before the test reads the box.
  const press = (key) =>
    React.act(async () => {
      tree.props(textarea()).onKeyDown({
        key,
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: key === "Enter" ? 13 : 27 },
        preventDefault() {},
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const stop = () =>
    React.act(async () =>
      tree
        .props(tree.find((node) => node.attributes?.["aria-label"] === "common.cancel"))
        .onClick()
    );
  const value = () => tree.props(textarea()).value;
  return { ...tree, render, type, press, stop, value };
}

test("an accepted send clears the box", async (t) => {
  const composer = await mountInput(t, async () => true);
  await composer.type("hello");
  await composer.press("Enter");
  assert.equal(composer.value(), "");
});

test("a refused send puts the draft back", async (t) => {
  const composer = await mountInput(t, async () => false);
  await composer.type("hello");
  await composer.press("Enter");
  assert.equal(composer.value(), "hello");
});

test("a failed send puts the draft back", async (t) => {
  const composer = await mountInput(t, async () => {
    throw new Error("offline");
  });
  await composer.type("hello");
  await composer.press("Enter");
  assert.equal(composer.value(), "hello");
});

test("a queued draft sends on idle and Stop cancels the queue", async (t) => {
  const sent = [];
  const composer = await mountInput(t, async (text) => {
    sent.push(text);
    return true;
  });
  await composer.render({ agentState: "thinking" });
  await composer.type("next question");
  await composer.press("Enter");
  assert.deepEqual(sent, [], "nothing is sent while the agent is busy");
  assert.match(composer.text(), /agentMode\.input\.queued/);
  assert.equal(composer.value(), "next question", "the queued draft stays visible");
  await composer.render({ agentState: "idle" });
  assert.deepEqual(sent, ["next question"]);
  assert.equal(composer.value(), "");

  await composer.render({ agentState: "streaming" });
  await composer.type("never mind");
  await composer.press("Enter");
  await composer.stop();
  await composer.render({ agentState: "idle" });
  assert.deepEqual(sent, ["next question"], "Stop never sends the queued draft");
  assert.equal(composer.value(), "never mind", "and the draft stays in the box");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/components/chatComposer.test.js`
Expected: FAIL with `Cannot find module '…/chatInputKeys.ts'`. The mounted tests also fail today: there is no textarea, and a refused send loses the text.

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

1. Line 1 becomes `import { useState, useRef, useCallback, useEffect, useId, useLayoutEffect } from "react";`, and add `import { composerHeight, resolveComposerKey } from "./chatInputKeys";`. Line 17 becomes:

   ```ts
     /** Return false, or reject, when the text was not sent; the draft comes back. */
     onTextSubmit?: (text: string) => void | boolean | Promise<void | boolean>;
   ```
2. Line 68 becomes `const inputRef = useRef<HTMLTextAreaElement>(null);`. Directly after it, add:

   ```tsx
     const [queued, setQueued] = useState(false);
     const queuedHintId = useId();
   ```

3. Replace `handleSubmit` (lines 86–92) with:

   ```tsx
     const handleSubmit = useCallback(async () => {
       const text = inputText.trim();
       if (!text || !onTextSubmit) return;
       // Clear at once: the sender resolves only after the whole reply streams.
       setInputText("");
       requestAnimationFrame(() => inputRef.current?.focus());
       let accepted: void | boolean = true;
       try {
         accepted = await onTextSubmit(text);
       } catch {
         accepted = false;
       }
       // Refused (another send held the lock, history not ready) or failed:
       // give the words back, unless the user has already started a new draft.
       // A failure after the message was saved also comes back; resending is
       // the user's call, and nothing is lost.
       if (accepted === false) setInputText((current) => (current.trim() ? current : text));
     }, [inputText, onTextSubmit]);
   ```

   Then replace `handleKeyDown` (lines 94–102) with the code below, and add the resize and auto-send effects after the existing `isIdle` focus effect (line 114):

   ```tsx
     const handleKeyDown = useCallback(
       (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
         const action = resolveComposerKey({
           key: e.key,
           shiftKey: e.shiftKey,
           isComposing: e.nativeEvent.isComposing,
           keyCode: e.nativeEvent.keyCode,
           isBusy,
           isQueued: queued,
           hasText: Boolean(inputText.trim()),
         });
         if (action === "none") return;
         e.preventDefault();
         if (action === "submit") void handleSubmit();
         else if (action === "queue") setQueued(true);
         else setQueued(false);
       },
       [handleSubmit, inputText, isBusy, queued]
     );
   ```

   `isBusy` is declared below the current `handleKeyDown`. Move the four `const isIdle / isListening / isTranscribing / isBusy` lines (104–108) above `handleSubmit` so both callbacks can read them.

   ```tsx
     // Grow with the text up to the cap, then scroll inside the box.
     useLayoutEffect(() => {
       const el = inputRef.current;
       if (!el) return;
       el.style.height = "auto";
       const { height, overflowY } = composerHeight(el.scrollHeight);
       el.style.height = `${height}px`;
       el.style.overflowY = overflowY;
     }, [inputText]);

     // A draft queued while the agent was busy goes out on the next idle; a
     // refused or failed send puts it back (handleSubmit).
     useEffect(() => {
       if (isIdle && queued) {
         setQueued(false);
         void handleSubmit();
       }
     }, [isIdle, queued, handleSubmit]);
   ```

4. Container (lines 120–126): replace `"flex items-center gap-2 min-h-11 ps-4 pe-1.5 rounded-full",` with `"flex items-end gap-2 min-h-11 ps-4 pe-1.5 py-1.5 rounded-[22px]",`. Then replace the focus line, `isIdle &&
            "focus-within:border-black/15 dark:focus-within:border-white/22 focus-within:ring-[3px] focus-within:ring-primary/8"`, with `(isIdle || isBusy) &&
            "focus-within:ring-2 focus-within:ring-ring"`. The busy composer still shows focus, and the old 8%-orange ring was invisible.

5. Replace the `<input … />` element (lines 202–218) and the row's opening `<div className="flex items-center gap-2 w-full">` with:

   ```tsx
             <div className="flex items-end gap-2 w-full">
               <textarea
                 dir="auto"
                 ref={inputRef}
                 rows={1}
                 value={inputText}
                 onChange={(e) => {
                   setInputText(e.target.value);
                   if (!e.target.value.trim()) setQueued(false);
                 }}
                 onKeyDown={handleKeyDown}
                 autoFocus={autoFocus}
                 aria-describedby={queued ? queuedHintId : undefined}
                 placeholder={placeholder ?? t("agentMode.input.typeMessage")}
                 className={cn(
                   "input-inline flex-1 resize-none outline-none bg-transparent caret-primary",
                   "text-[13px] leading-5 text-foreground placeholder:text-muted-foreground/70",
                   "min-w-0 py-1.5 px-0"
                 )}
               />
   ```

6. Stop button `onClick` (line 222): change `onClick={onCancel}` to:

   ```tsx
                   onClick={() => {
                     setQueued(false);
                     onCancel?.();
                   }}
   ```

7. After the container's closing `</div>` (the one opened at line 119), and before the outer wrapper's closing `</div>`, add:

   ```tsx
         {queued && (
           <p
             id={queuedHintId}
             className="mt-1 flex items-center gap-2 ps-4 text-[11px] text-muted-foreground"
           >
             {t("agentMode.input.queued")}
             <button
               type="button"
               onClick={() => setQueued(false)}
               className="rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
             >
               {t("agentMode.input.unqueue")}
             </button>
           </p>
         )}
   ```

8. Send button (line 236): change `onClick={handleSubmit}` to `onClick={() => void handleSubmit()}`. Then replace every `focus-visible:ring-1 focus-visible:ring-ring/30` in the file (lines 167, 182, 228, 242 and 264) with `focus-visible:ring-2 focus-visible:ring-ring`, the full-opacity ring from Task 3.

9. Return the send result from the callers:
   - **`src/hooks/useEmbeddedChat.ts`:** change line 26 to `sendMessage: (text: string) => Promise<boolean>;`, and lines 145–150 to:

     ```ts
       const sendMessage = useCallback(
         (text: string): Promise<boolean> => sendMessageWithResult(text),
         [sendMessageWithResult]
       );
     ```

   - **`src/hooks/useContainerChat.ts`:** the same change, at line 30 and lines 134–139.
   - **Prop types:** in `src/components/notes/EmbeddedChat.tsx:20` and `src/components/notes/overview/OverviewAskSection.tsx:18`, change `onTextSubmit: (text: string) => void;` to `onTextSubmit: (text: string) => void | boolean | Promise<void | boolean>;`.
   - **Prompt chips:** in `OverviewAskSection.tsx:72`, change `onClick={() => onTextSubmit(t(key))}` to `onClick={() => void onTextSubmit(t(key))}`.
   - **`src/components/dictation/AssistantPanel.tsx`:** replace `handleTextSubmit` (lines 323–331) with:

     ```tsx
       const handleTextSubmit = useCallback(
         (text: string): boolean | Promise<boolean> => {
           // Not ready yet: report the refusal so ChatInput keeps the draft.
           if (!historyReady) return false;
           const context = selectedContext;
           if (context) clearSelectedContext();
           return sendMessage(text, context ? { selectedContext: context } : undefined);
         },
         [clearSelectedContext, historyReady, selectedContext, sendMessage]
       );
     ```

     It is also passed to `onSelectSuggestion` (line 527). A function that returns a value is assignable to a `void`-returning prop, so that call site compiles unchanged.

10. Add the locale keys:

   ```bash
   node - <<'EOF'
   const fs = require("node:fs");
   const path = require("node:path");
   const ADD = {
     "agentMode.input.queued": {
       en: "Sends when the reply finishes", ar: "سيُرسل عند انتهاء الرد",
       de: "Wird gesendet, sobald die Antwort fertig ist", es: "Se enviará cuando termine la respuesta",
       fr: "Sera envoyé à la fin de la réponse", it: "Verrà inviato al termine della risposta",
       ja: "返信が終わると送信されます", pt: "Será enviado quando a resposta terminar",
       ru: "Отправится, когда ответ будет готов", "zh-CN": "回复结束后发送", "zh-TW": "回覆結束後傳送",
     },
     "agentMode.input.unqueue": {
       en: "Don't send when done", ar: "عدم الإرسال عند الانتهاء", de: "Nicht automatisch senden",
       es: "No enviar al terminar", fr: "Ne pas envoyer à la fin", it: "Non inviare al termine",
       ja: "完了時に送信しない", pt: "Não enviar ao terminar", ru: "Не отправлять автоматически",
       "zh-CN": "完成后不发送", "zh-TW": "完成後不傳送",
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

Run: `npm test -- test/components/chatComposer.test.js test/components/fieldDirectionPolicy.test.js test/helpers/assistantPanel.test.js 'test/**/*Chat*.test.js' test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chatInputKeys.ts src/components/chat/ChatInput.tsx src/hooks/useEmbeddedChat.ts src/hooks/useContainerChat.ts src/components/notes/EmbeddedChat.tsx src/components/notes/overview/OverviewAskSection.tsx src/components/dictation/AssistantPanel.tsx src/locales test/components/chatComposer.test.js
git commit -m "feat(chat): auto-growing composer that stays typeable while the agent works"
```

---

### Task 13: Notes open without the Actions gate

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
  - `useNoteActionsReady(): boolean | null`, where `null` means "unknown": still checking, or a remote provider. Plan 03's `useResolvedRoute("noteFormatting")` (§5.1) replaces this hook. It reports `needsKey` for remote providers too.
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

### Task 14: Settings navigation semantics and real provider tabs

Covers SET-Q1 and SET-Q20.

**Files:**
- Create: `src/components/ui/providerTabsKeys.ts`
- Modify: `src/components/ui/SidebarModal.tsx`. Change the close button's ring (line 135), the `<nav>` (line 151) and the nav item `<button>` (lines 171–183).
- Modify: `src/components/ui/ProviderTabs.tsx`. Change the imports (line 1), `ProviderTabItem` (lines 7–13) and the render (lines 72–123).
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
- **The settings sidebar nav** gets `aria-current="page"`, a visible 2px orange focus ring (`--color-ring` is `#ff5a1f` in both themes), an accessible name in compact mode, and an `aria-label` on `<nav>`. The ring is inset, because the nav scrolls (`overflow-y-auto`) and would clip an outset ring.

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/settingsNavigation.test.js test/components/directionalContentPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/providerTabsKeys.ts src/components/ui/ProviderTabs.tsx src/components/ui/SidebarModal.tsx test/components/settingsNavigation.test.js
git commit -m "fix(a11y): settings nav semantics and real provider tabs"
```

---

### Task 15: Keyboard-selectable model cards

Covers SET-Q2.

**Files:**
- Modify: `src/components/ui/ModelCardList.tsx`:
  - `ModelCardProps` (line 46) and `ModelCardListProps` (line 228);
  - the `ModelCard` render (lines 105–224);
  - the `ModelCardList` render (lines 258–273).
- Modify: `src/components/ui/SearchableModelList.tsx:244`. Pass `selectionRole="none"`.
- Modify: `src/locales/*/translation.json`. Add `models.deleteNamed` and `models.listLabel`.
- Test: `test/components/modelCardKeyboard.test.js`

**Interfaces:**
- Produces:
  - `ModelCardProps.selectionRole?: "radio" | "none"` (default `"radio"`);
  - `ModelCardListProps.ariaLabel?: string` (default `t("models.listLabel")`).
- Consumes `rendererOptions` (Task 4).

Design:
- **Why the card root cannot be the radio.** A `role="radio"` element's children are presentational. If the root were the radio, the card's delete, download and cancel buttons and its "Learn more" link would lose their roles. So the card keeps its layout and gains a full-bleed overlay `<button role="radio">` as a sibling of those controls.
  - The overlay is the hit area, the tab stop and the focus ring.
  - The real controls sit above it with `pointer-events-auto`.
  - The content row is `pointer-events-none`, so clicks on text reach the overlay.
  - **"Learn more" must never select the model**, in either mode. `createExternalLinkHandler` (`src/utils/externalLinks.ts:9-13`) only calls `preventDefault`. The click still bubbled to the card root, so opening a model's documentation selected it. That mattered most in `SearchableModelList`, which keeps the root `onClick`. The anchor now stops propagation in both modes. It also uses `text-link` (D1) instead of raw `text-primary/60`.
- **Selection is explicit.** Enter, Space (native `<button>`) or a click selects. Arrow keys are not a selection path, because these cards include remote models and moving focus must never switch where audio goes.
- **No nested radio.** `SearchableModelList` already wraps each card in `role="option"`, so it opts out with `selectionRole="none"`. That keeps the old root `onClick` and adds no radio.
- **Unselectable cards stay focusable.** A local model that is not downloaded is `aria-disabled`, not `disabled`. Screen-reader users can still find it next to its Download button.

- [ ] **Step 1: Write the failing test**

Create `test/components/modelCardKeyboard.test.js`:

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

test("arrow keys are not a selection path", () => {
  assert.doesNotMatch(source, /Arrow(Up|Down|Left|Right)/);
  assert.doesNotMatch(source, /onKeyDown/);
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

1. Add `selectionRole?: "radio" | "none";` to `ModelCardProps` and `ariaLabel?: string;` to `ModelCardListProps`.
2. `ModelCard`: destructure `selectionRole = "radio",`. After `handleCardClick`, add:

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
   - change the container to `<div role="radiogroup" aria-label={ariaLabel ?? t("models.listLabel")} className={`space-y-0.5 ${className}`}>`.
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/components/modelCardKeyboard.test.js test/components/directionalContentPolicy.test.js test/components/orukeetOrganization.test.js test/locales/translationCoverage.test.js`
Expected: PASS. If an existing test clicks the card root via `__reactProps$…onClick`, point it at the `role="radio"` child instead. Selecting by clicking the card is still the behaviour; only the element that owns the handler moved.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ModelCardList.tsx src/components/ui/SearchableModelList.tsx src/locales test/components/modelCardKeyboard.test.js
git commit -m "fix(a11y): keyboard-selectable model cards with a named delete"
```

---

### Task 16: Manual update check works with automatic updates off

Covers SET-Q16, plus the `ml-2` RTL leak in the same file (part of SET-Q6).

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

### Task 17: Honest settings copy

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

### Task 18: Clear All Audio confirms with counts and reports failures

Covers SET-Q5.

**Files:**
- Create: `src/utils/audioDeletion.ts`
- Modify: `src/helpers/audioStorage.js`. `deleteAllAudio()` (lines 167–187) and `getStorageUsage()` (lines 189–206) report failures instead of swallowing them.
- Modify: `src/types/electron.ts:857-858`, and `src/preview/browserPreview.ts:276`.
- Modify: `src/components/SettingsPage.tsx`:
  - imports (near line 102);
  - state and the usage fetch (lines 1116–1129);
  - the `handleClearAllAudio` handler (lines 1146–1155);
  - the Clear All Audio row (lines 2793–2815).
- Modify: `src/locales/*/translation.json`:
  - add `settingsPage.privacy.clearAllAudioTitle`, `clearAllAudioCounted`, `clearAllAudioAction`, `clearAllAudioDone` and `clearAllAudioFailed`;
  - delete the unused `clearAllAudioConfirm`.
- Test: `test/helpers/audioStorageClear.test.js` (the real main helper) and `test/components/clearAllAudio.test.js`

**Interfaces:**
- Produces, in main (`AudioStorageManager`):
  - `deleteAllAudio(): { deleted: number; failed: number; readable: boolean }`. `deleted` counts files actually unlinked; `failed` counts files that could not be. When the audio directory cannot be read, the result is `{ deleted: 0, failed: 0, readable: false }`.
  - `getStorageUsage(): { fileCount: number; totalBytes: number; readable: boolean }`. When the directory cannot be read, the result is `{ fileCount: 0, totalBytes: 0, readable: false }`. Before this change it returned zeros that looked like an empty store.
  - The IPC channels (`delete-all-audio`, `get-audio-storage-usage`) and preload methods are unchanged and pass these through. The other `deleteAllAudio()` callers (`ipcHandlers.js:1288` and `:3165`) ignore the result, so they are unaffected.
- Produces `resolveClearAudioOutcome(deleted: { failed: number; readable: boolean } | null, after: { fileCount: number; readable: boolean } | null): "cleared" | "partial"`.
- Consumes:
  - `showConfirmDialog` from `useDialogs` (destructured in `SettingsPage.tsx:970-976`);
  - `formatBytes` (`SettingsPage.tsx:102`);
  - the electron stub harness (`test/helpers/harness/electronStub.js`: `installElectronStub`, `setUserDataDir`), the same one `test/helpers/audioStorageTraversal.test.js` uses.

Facts from the code:
- **`deleteAllAudio` never reports a failure today.**
  - Per-file unlink errors are only logged (`src/helpers/audioStorage.js:171-178`).
  - It returns `{ deleted: files.length }` even when some unlinks failed.
  - An unreadable directory returns `{ deleted: 0 }`.
- **`getStorageUsage` hides an unreadable directory.** It catches the read error and returns `{ fileCount: 0, totalBytes: 0 }` (lines 202–204). Reading usage back after a delete could therefore "confirm" an empty store that was never read. Both helpers now carry `readable`, and only a readable, zero-file store with zero failures counts as cleared.
- **`ConfirmDialog` does not await `onConfirm`** (`src/components/ui/dialog.tsx:108-190`), so the async work handles its own errors.
- **`delete-all-audio` clears every row's `has_audio` flag** (`ipcHandlers.js:1400-1417`), even when some files survive. That is out of scope here. The alert tells the user that files remain, and the row's count, read from disk, shows how many.

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

function makeManager(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-audio-clear-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  setUserDataDir(path.join(root, "profile"));
  return { manager: new AudioStorageManager(), root };
}

test("a clean delete reports every file and leaves a readable, empty store", (t) => {
  const { manager } = makeManager(t);
  fs.writeFileSync(path.join(manager.audioDir, "1.webm"), "a");
  fs.writeFileSync(path.join(manager.audioDir, "2.webm"), "bb");
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 2, totalBytes: 3, readable: true });
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 2, failed: 0, readable: true });
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 0, totalBytes: 0, readable: true });
});

test("a file that cannot be deleted is counted as a failure, not as deleted", (t) => {
  const { manager } = makeManager(t);
  fs.writeFileSync(path.join(manager.audioDir, "1.webm"), "a");
  // A directory with the .webm suffix: unlinkSync refuses it on every platform.
  fs.mkdirSync(path.join(manager.audioDir, "2.webm"));
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 1, failed: 1, readable: true });
});

test("an unreadable store is reported, never counted as empty", (t) => {
  const { manager, root } = makeManager(t);
  manager.audioDir = path.join(root, "missing");
  assert.deepEqual(manager.getStorageUsage(), { fileCount: 0, totalBytes: 0, readable: false });
  assert.deepEqual(manager.deleteAllAudio(), { deleted: 0, failed: 0, readable: false });
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

test("clearing audio asks first, with a fresh count and size", () => {
  const handler = page.match(/const handleClearAllAudio = async \(\) => \{[\s\S]*?\n {2}\};/)[0];
  assert.match(handler, /getAudioStorageUsage/);
  assert.match(handler, /showConfirmDialog\(\{/);
  assert.match(handler, /variant: "destructive"/);
  assert.match(handler, /t\("settingsPage\.privacy\.clearAllAudioCounted"/);
  assert.match(handler, /t\("settingsPage\.privacy\.audioStorageFiles"/);
});

test("a partial or unverifiable delete is reported in an alert, never swallowed", () => {
  assert.doesNotMatch(page, /\/\/ silent fail/);
  assert.match(page, /resolveClearAudioOutcome\(deleted, after\)/);
  assert.match(
    page,
    /\{clearAudioError && \(\s*<p role="alert" className="mt-2 text-xs text-destructive">\s*\{t\("settingsPage\.privacy\.clearAllAudioFailed"\)\}/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/helpers/audioStorageClear.test.js test/components/clearAllAudio.test.js`
Expected: FAIL.
- `getStorageUsage()` lacks `readable`.
- The undeletable directory is counted in `deleted: 2`.
- `audioDeletion.ts` is missing.

- [ ] **Step 3: Implement**

1. `src/helpers/audioStorage.js`. Replace `deleteAllAudio()` and `getStorageUsage()` (lines 167–206) with:

   ```js
     // Reports what actually happened: an unlink failure is counted, and an
     // unreadable directory is never reported as an empty store.
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
   ```

2. `src/types/electron.ts:857-858` become:

   ```ts
         getAudioStorageUsage: () => Promise<{ fileCount: number; totalBytes: number; readable: boolean }>;
         deleteAllAudio: () => Promise<{ deleted: number; failed: number; readable: boolean }>;
   ```

   In `src/preview/browserPreview.ts:276`, add `readable: true` to the stub's result: `getAudioStorageUsage: async () => ({ fileCount: 0, totalBytes: 0, readable: true }),`.

3. Create `src/utils/audioDeletion.ts`:

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

4. `src/components/SettingsPage.tsx`:
   - Add `import { resolveClearAudioOutcome } from "../utils/audioDeletion";` next to the `formatBytes` import.
   - After the `audioStorageUsage` state (line 1119), add `const [clearAudioError, setClearAudioError] = useState(false);`.
   - In the usage fetch effect (lines 1121–1128), change `if (usage) setAudioStorageUsage(usage);` to `if (usage?.readable) setAudioStorageUsage(usage);`. An unreadable store must not show "no stored audio".
   - Replace `handleClearAllAudio` (lines 1146–1155) with:

   ```tsx
     const clearAllAudio = async () => {
       setClearAudioError(false);
       let deleted: { deleted: number; failed: number; readable: boolean } | null = null;
       let after: { fileCount: number; totalBytes: number; readable: boolean } | null = null;
       try {
         deleted = await window.electronAPI.deleteAllAudio();
         after = (await window.electronAPI.getAudioStorageUsage?.()) ?? null;
       } catch {
         // Leave whatever we learned; an unknown result is reported as partial.
       }
       if (after?.readable) setAudioStorageUsage(after);
       if (resolveClearAudioOutcome(deleted, after) === "cleared") {
         toast({ title: t("settingsPage.privacy.clearAllAudioDone"), variant: "default" });
       } else {
         setClearAudioError(true);
       }
     };

     const handleClearAllAudio = async () => {
       if (!window.electronAPI?.deleteAllAudio) return;
       // Count what is on disk now, not when the section opened.
       const usage = await window.electronAPI
         .getAudioStorageUsage?.()
         .catch(() => null);
       const current = usage?.readable ? usage : audioStorageUsage;
       if (usage?.readable) setAudioStorageUsage(usage);
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
         onConfirm: () => void clearAllAudio(),
       });
     };
   ```

   - In the Clear All Audio row, change `onClick={handleClearAllAudio}` to `onClick={() => void handleClearAllAudio()}`. After its closing `</SettingsRow>` (line 2814), still inside `<SettingsPanelRow>`, add:

   ```tsx
                     {clearAudioError && (
                       <p role="alert" className="mt-2 text-xs text-destructive">
                         {t("settingsPage.privacy.clearAllAudioFailed")}
                       </p>
                     )}
   ```

5. Locale changes:

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
       en: "Some audio files could not be deleted. The count above shows what remains. Try again, or check that no other app is using them.",
       ar: "تعذّر حذف بعض الملفات الصوتية. يوضّح العدد أعلاه ما تبقّى. حاول مرة أخرى، أو تأكد من أن أي تطبيق آخر لا يستخدمها.",
       de: "Einige Audiodateien konnten nicht gelöscht werden. Die Anzahl oben zeigt, was übrig ist. Versuche es erneut oder prüfe, ob eine andere App sie verwendet.",
       es: "No se pudieron eliminar algunos archivos de audio. El recuento de arriba muestra lo que queda. Inténtalo de nuevo o comprueba que ninguna otra app los esté usando.",
       fr: "Certains fichiers audio n'ont pas pu être supprimés. Le total ci-dessus indique ce qui reste. Réessayez ou vérifiez qu'aucune autre app ne les utilise.",
       it: "Alcuni file audio non sono stati eliminati. Il conteggio qui sopra indica cosa rimane. Riprova o verifica che nessun'altra app li stia usando.",
       ja: "一部の音声ファイルを削除できませんでした。残りは上の件数で確認できます。もう一度試すか、他のアプリが使用していないか確認してください。",
       pt: "Alguns arquivos de áudio não puderam ser excluídos. A contagem acima mostra o que resta. Tente novamente ou verifique se outro app está usando-os.",
       ru: "Не удалось удалить некоторые аудиофайлы. Счётчик выше показывает, что осталось. Повторите попытку или проверьте, не использует ли их другое приложение.",
       "zh-CN": "部分音频文件无法删除。上方的数量显示剩余文件。请重试，或检查是否有其他应用正在使用它们。",
       "zh-TW": "部分音訊檔案無法刪除。上方的數量顯示剩餘檔案。請再試一次，或確認沒有其他應用程式正在使用它們。",
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

   Before deleting `clearAllAudioConfirm`, confirm nothing reads it: `grep -rn "clearAllAudioConfirm" src --include='*.ts*' --include='*.js*'` must print nothing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/helpers/audioStorageClear.test.js test/helpers/audioStorageTraversal.test.js test/components/clearAllAudio.test.js test/locales/translationCoverage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/audioStorage.js src/types/electron.ts src/preview/browserPreview.ts src/utils/audioDeletion.ts src/components/SettingsPage.tsx src/locales test/helpers/audioStorageClear.test.js test/components/clearAllAudio.test.js
git commit -m "fix(privacy): confirm Clear All Audio with counts and report partial deletes"
```

---

### Task 19: Privacy description and dead locale keys

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

### Task 20: Whole-plan verification

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
- **Chat.**
  - Send a message, then type and press Enter while it streams. "Sends when the reply finishes" appears, and the draft sends once the reply ends.
  - Press Stop with a queued draft: the draft stays in the box, unsent.
- **Coming up.** With a meeting starting within a minute, "Now" appears within 30 s of the start, without reloading.
- **Notes.** On a fresh profile, notes render immediately. "Actions" opens the first-run dialog once, then the manager, even with no note open.
- ★ **Settings.**
  - Privacy → Clear All Audio shows the count and size and asks first.
  - System → updates: with automatic off, Check for Updates works and shows "available" plus the GitHub link.
  - Custom endpoint: with an empty URL, there is no "We'll query" line.

- [ ] **Step 3: Commit any fixes, then prepare the PR (owner approval first)**

`pr-body.md`:
- lists one line per Tasks 1–19 commit;
- links the spec and this plan;
- carries the Contract change requests section verbatim;
- embeds the Step 2 screenshots;
- names every intentionally updated pre-existing test assertion (Step 1).

Get the owner's explicit OK before `git push` or `gh pr create`; publishing is outward-facing.

```bash
git push -u origin HEAD
gh pr create --title "fix(ui): Plan 02 bug & a11y sweep" --body-file pr-body.md
```
