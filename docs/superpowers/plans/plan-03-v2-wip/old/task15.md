### Task 15: DESIGN.md, colour-role guard and whole-plan verification

**Files:**
- Modify: `DESIGN.md`. Add a `### Settings` subsection after `### Voice Pill` (`:208`), and add one line each to `### Chips` (`:187`) and `### Cards / Containers` (`:191`).
- Create: `test/components/settingsColorRoles.test.js`
- No other new files. This task runs every check and fixes what they surface.

- [ ] **Step 1: Write the colour-role guard**

This guards D1 and the contrast rule in the new Settings code. Text never uses `success` or `warning`, which fail 4.5:1 on white. Nothing in Settings is orange-live. Download and Apply are never orange.

Create `test/components/settingsColorRoles.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const files = [
  "src/components/settings/routing/RouteChips.tsx",
  "src/components/settings/routing/Patchbay.tsx",
  "src/components/settings/routing/StagedRouteBar.tsx",
  "src/components/settings/routing/StagedRoutePanel.tsx",
  "src/components/settings/routing/KeyringPanel.tsx",
  "src/components/ui/ModelCartridgeGrid.tsx",
  "src/components/settings/StorageList.tsx",
  "src/components/settings/SettingsSearchResults.tsx",
].map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]);

test("settings text never uses low-contrast success/warning colours", () => {
  for (const [f, src] of files) assert.doesNotMatch(src, /\btext-(success|warning)\b/, f);
});

test("orange 'live' is for voice only, never in settings", () => {
  for (const [f, src] of files) assert.doesNotMatch(src, /variant="live"|bg-live\b/, f);
});

test("locality is drawn with the locality roles, not ad-hoc greens and ambers", () => {
  for (const [f, src] of files) assert.doesNotMatch(src, /#(22A559|E39B14|0f9f6e|b45309)/i, f);
});

test("provider names in UI go through providerDisplayLabel, never the English providerDisplayName", () => {
  const ui = [
    ...files,
    ...["src/components/settings/screenContextCopy.ts", "src/lib/routeTargets.ts"].map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]),
  ];
  for (const [f, src] of ui) assert.doesNotMatch(src, /\bproviderDisplayName\(/, f);
});

test("light theme: no destructive text or warning fill on the #f5f5f5 surfaces", () => {
  // Plan 01 tokens measure 4.43:1 (destructive text) and 2.92:1 (warning fill)
  // on muted/secondary/surface-3 in light theme. Keep them off those surfaces.
  for (const [f, src] of files) {
    for (const cls of src.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) ?? []) {
      const onGrey = /\bbg-(muted|secondary|surface-3)\b/.test(cls);
      assert.ok(!(onGrey && /\btext-destructive\b/.test(cls)), `${f}: ${cls}`);
      assert.ok(!(onGrey && /\bbg-warning\b/.test(cls)), `${f}: ${cls}`);
    }
  }
});
```

Run: `npm test -- test/components/settingsColorRoles.test.js`
Expected: PASS. If it fails, fix the offending class or call in that file rather than the test.

`destinations.ts` is deliberately not in the provider-name guard. It uses `providerDisplayName` only to sort destinations, and the Patchbay renders their names with `providerDisplayLabel`.

- [ ] **Step 2: Update `DESIGN.md`**

Add after `### Voice Pill`:

```markdown
### Settings

**Routing is one model, drawn three ways.** `src/lib/routes.ts` resolves all 11 tasks. Settings → Routing (the Patchbay), the editors' mode selectors and the voice pill read the same `ResolvedRoute`. Never compute "is this local?" anywhere else.

- **Route chips.** A state is a glyph plus words, never colour alone: Ready, Off, Download 1.3 GB, Choose a model, Add API key, Choose a provider, Add server URL, Paused · Sealed mode, Can't reach host. Ready uses `--color-locality-device`. Needs-attention uses `--color-destructive`. Off and Sealed are muted.
- **Patchbay.** Task buttons sit on the left and destinations on the right. The cables are decoration (`aria-hidden`): solid for this device, dotted for your server, dashed for a provider. They fade in once (`--motion-base`) and never loop. Below 720px of board width the cables hide and the lists stack.
- **Asymmetric friction.** A move toward this device applies instantly, with an Undo toast that names the task. A move to a server or provider is staged: the radio shows "Staged, not active", a dashed panel asks for the provider, key or URL, and a sticky bar states what leaves the device. Apply (the ink capsule, ⌘↵) is the only primary action. Apply re-validates at click time. Closing Settings discards the draft.
- **Keyring.** Verifying a key is always a button, because it sends the key to the provider (PRIVACY.md). Rows show a labelled status dot, when the key was last verified, the last error and the tasks it pauses. Results live in SQLite (`provider_key_health`) with no key material.
- **Model cartridges.** Cards sit in a 2-column `radiogroup` with one tab stop. Arrows move between cards (and swap in RTL), and Enter selects a model or downloads it. Speed, Quality and Memory use 5-pip meters labelled "{label} N of 5", filled with `foreground/70`, never orange. Orange is only the selected card's 2px border. The download button is outline, except on the Recommended card.
- **Storage.** Count before you delete. Row triggers are outline buttons with destructive text. Solid destructive appears only inside a confirm, and that confirm repeats the count, size and folder. A partial failure stays open with `role="alert"`. Reset requires typing the localized word.
- **Search.** ⌘F or `/` focuses it. Results replace the pane (the page stays mounted), grouped by section with a breadcrumb and a live control. Enter jumps and flashes the row once. Esc clears the query first.
- **Escape order.** A widget with transient state sets `data-escape-active="true"`, so Esc clears that state before it closes the dialog.
```

Append to `### Chips`: "Route chips (Settings) follow the same pill shape at 24px. See Settings."

Append to `### Cards / Containers`: "Model cartridges are 10px-radius tonal cards. The hover lift applies in light theme only, and selection is a 2px `--color-ring` border."

- [ ] **Step 3: Run the full suite and static checks**

```bash
npm run native:node
npm test
npm run lint
npm run typecheck
npm run i18n:check
npm run format:check
```

Expected: everything passes.

A pre-existing test may fail because it asserts something this plan changed on purpose:
- the old "Active" chip;
- the `switched*` toasts;
- `LocalModelCard`;
- the System section's Clear Cache or Reset;
- the 1-click Clear All Audio;
- the "OpenAI" local tab label;
- `max-w-4xl`.

Update such a test only when the old behaviour is exactly what this plan replaced, and list it in the PR description. Any other failure is a regression: fix the code.

- [ ] **Step 4: Visual verification in the desktop app (light and Plum Night, `en`, `de`, `ar`)**

```bash
npm run native:electron
npm run dev
```

Screenshot each check for the PR. Compare against the picked cards in `design-explorations/loqui-uiux-review.html#ch-settings`.

1. **Routing (R1 B).**
   - 11 tasks and destinations with cables.
   - Chat to This device applies with Undo.
   - Chat to a provider stages, and the bar and Apply work.
   - Dictation to Anthropic is refused with a reason.
   - Esc clears the selection.
   - The meter counts are correct.
   - Narrow the window and the list fallback appears.
2. **Staging (R3 B).** STT → Cloud, Self-hosted and Local:
   - no provider is pre-chosen;
   - an inline key field appears for a provider without a key;
   - the http warning appears;
   - closing Settings drops the draft.
3. **Cartridges (R4 B).**
   - Keyboard-only selection and download.
   - Arabic arrow keys.
   - The "Too large" reason on an 8 GB device, if one is available. Otherwise temporarily stub `getTotalMemory` to `8e9` in dev tools.
4. **Keyring (R5 C).**
   - Verify with a bad key gives Rejected and the dependent task pauses.
   - Verify all walks through the rows.
   - The reminder switch persists across a restart.
5. **Storage (R7 A).**
   - The counted confirm for each row.
   - The typed reset.
   - Simulate a partial failure by holding a file open (macOS: `tail -f` on one audio file, then delete audio). The alert appears.
6. **Search (R2 A).**
   - "mic", "retention", "cloud" and "xyz".
   - Live toggles.
   - Enter jumps and flashes.
   - A download survives searching.
7. **Quick wins.**
   - Nav descriptions at ≥1000px and the tooltip in compact mode.
   - The sticky title, and the close button at 32px and 70% opacity.
   - The Dictation section contents.
   - The screen-context copy names its destination.
   - The self-hosted Test button.
   - "Runs on this device. Nothing leaves it."
   - The Whisper tab label and the Oruk hint.
   - The dictionary actions.
   - The Review setup link.
8. **Reduced motion.**
   - No cable fade-in or flash animation, but the outlines remain.
   - The keyring spinner stops spinning, and the "Checking…" text remains.

- [ ] **Step 5: Commit fixes, then hand off for the PR**

```bash
git add -A
git commit -m "docs(design): Settings routing, cartridges, keyring, storage and search"
```

Write `pr-body.md`:
- one line per Task 1–14 commit;
- a link to the spec and this plan;
- the §5.1 clarifications from "Contract change requests" (the owner pastes them into spec §5.1 in this PR);
- the §5.4 requests to Plan 07;
- the screenshots from Step 4;
- the pre-existing tests updated in Step 3;
- a note that non-English strings were machine-translated for native review.

Get the owner's explicit OK before `git push` or `gh pr create`. Publishing is outward-facing.
