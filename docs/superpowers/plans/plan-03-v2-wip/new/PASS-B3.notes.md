# Pass B3: consistency sweep of T04, T10, T12–T18

Owner of this pass: T04, T10, T12, T13, T14, T15, T16, T17 and T18. This is planning only: no app code was changed, no git commands were run, and nothing was executed. PASS-B1 consumer fixes 1–7 and PASS-B2 consumer fixes 1–5 are applied.

## Edits

### T04
- In-file labels added to `settingsPaths.test.js`, `formatDecimalBytes.test.js` and `settingsSupportModelsTab.test.js` (locale test), so the T18 Step 6 grep finds them.
- Spot-checked these citations, all correct:
  - `SettingsModal.tsx:9-39/98-101/103-118/134-138`
  - `SettingsPage.tsx:29/114-119/741/758-765/844/2757/3159`
  - `ControlPanel.tsx:669`
- T01's `ROUTE_SETTINGS_PATH` values all land on T04's sub-tabs.

### T10
- INTEGRATION item 8 / B1-7: `Patchbay.tsx` uses `useRouteCopy()`, with no zero-arg `routeCopy()` left. The source guard now asserts this.
- T04 does not add `routing`. T10 now unconditionally adds `"routing"` after `"hotkeys"`, the `routes` alias and the type. `settingsPathsRouting.test.js` is change-driving. `onNavigateToPath` is destructured.
- Fixtures now come from T01 `makeSnapshot`. This fixes the missing `corti:text` host, the empty base-URL list and the null installed sets.
- Consumes lines are exact for these producers:
  - T05 chip props;
  - T07 outcomes;
  - T08 `providerCatalog.ts` path and `StagedRoutePanel({ routeId })`.
- Corti card host: a card uses the host of its in-use routes when there is exactly one. A card listed only through a key uses that key's slot host (`corti:text` gives the text host). A new change-driving test covers this.
- Status-line copy: new `patchbay.place.*` keys, so the line reads "Chat now runs on this device." instead of "…on On this device."

### T12
- B1-1 / INTEGRATION item 9:
  - `verify` → `{ outcome, entry }`; `superseded`, `invalidOptions`, `sealed` and `missing` are handled.
  - B1-2: Corti speech gets `{ cortiEnvironment, cortiTenant }` through `verifyOptions` / `keyringVerifyOptions`, with a test.
- B1-4: `undoRemove` reason `persistFailed` keeps Undo available, using the new key `apiKeyInput.undoRetry`.
- `KeyringEntry` uses `id` and `providerId` and only T11's 12 identities. The codex and bedrock rows are dropped.
- B1-6: `credentialHost` reads `hosts["corti:text"]` for text and `hosts.corti` for speech.
- B1-3/B1-5: the `ApiKeyInput` step is rewritten as anchored edits on top of T02's file.
  - T02's `apiKeyInput.saveFailed` and `removeFailed` are reused, not redefined, which fixes the i18n collision.
  - T02's EnterpriseProviderConfig change is no longer duplicated.
- The save button is recoloured from `text-success` to `text-foreground hover:bg-muted` and gains `data-action="save-key"`. `personalWorkspace.test.js` finders are moved off the colour class.
- B2-2: new step that adds `credentialId` to T08's `StagedRoutePanel` key field, only when there is a single input.
- B2-3: anchors in pickers that T09 rewrote are now text-based.
- New source guard: the panel writes no settings.

### T13
- B2-1: rebased onto T09.
  - `useLocalModelCommit`, its test, the duplicate `routeId` and the `routeId` props are removed. The InferenceConfigEditor edit is dropped.
  - The grids call T09's `handleWhisperModelSelect` / `handleParakeetModelSelect` → `onCommit` → T08 `useRouteCommit`, which keeps the Undo toast.
  - `stepGrid` extends T05's `rovingNav.ts`.
  - The wiring guards are rewritten.
  - Fixed the wrong citations `ReasoningModelSelector.tsx:63-76/342-355`; they are now moot.
- In-file label added to `cartridgeMath.test.js`.

### T14
- `this.credentialAuthority` → `this.credentials` (T02.md:1334). T14's own `reset()` insertion is removed because T02 already adds it.
- The `deviceCleanupContract` test is split:
  - change-driving: `storageOps.deleteAudio`;
  - baseline guard: T02's `this.credentials.reset()`.
- Rule 2: the audio test asserts deleted == previewed.
- SettingsPage anchors are now content-based and consistent with T04, T10 and T15. Fixed `audioStorage.js` ranges (`:171-179`, `:189-206`).
- `formatDecimalBytes` expectations match T04.

### T15
- The transcription-language block now has the real JSX (`SettingsPage.tsx:1912-1953`) instead of two "moved verbatim" placeholder comments.
- Base-commit citations corrected: `<nav>` is `SidebarModal.tsx:151-218`, not `:147-231`. Also cited `:100` (badge colour) and `:140` (`noop`).

### T16
- Owner-rule source guard extended. It now also bans:
  - Corti setters;
  - `requestRouteChange`, `requestRoutePatch`, `requestPatch` and `useRouteChange`;
  - provider web search.
- SidebarModal and SettingsModal anchors now match the code T15, T08, T10 and T04 leave behind.
- Fixed T04's known edge: a repeated same-sub-tab jump is now re-issued. A new change-driving test is in `settingsModalPaths.test.js`.
- KeyringPanel and StorageList root anchors now quote the markup T12 and T14 produce.
- In-file labels added to `settingsSearchKeys.test.js` and `useSettingsSearch.test.js`.

### T17
- Labelled `screenContextCopy.test.js` in the file.
- Noted that T08 already swapped the `DictationAgentSettings` toggles for `RouteSwitch`; the description call at `:171` is unchanged.
- Explained the screen-context-off case: the destination is kept and `sends` is null, so the copy falls back to the screenshot.
- Spot-checked these anchors, all correct:
  - `localASROrganization.ts:10`
  - `useSettings.ts:158-181`
  - `DictionaryView.tsx:21/107/192/217/263`
  - `SettingsPage.tsx:465/627/632/661/666`
  - `TranscriptionModelPicker.tsx:430/1310`
  - `toggle.tsx` `aria-label`

### T18
- Colour guard:
  - `EXTRA` now lists every non-`settings/` file that the tasks edit, with the owning task, and adds `EnterpriseProviderConfig.tsx`.
  - The coverage test now lists all 16 component files that the tasks create.
- Provider-name guard: allows T10 `destinations.ts` to use `providerDisplayName` only as an `import` or `localeCompare` sort key. Without that, the guard would fail on T10's code.
- Network guard: now covers every route-model module (from T01, T03, T06, T07, T08 and T10) instead of 5. `useLocalModelCommit.ts` was dropped because T13 no longer creates it.
- Step 0 preflight additions:
  - `isLoopbackUrl`, `LocalityRing`, `--motion-hero`, `locality` keys, `plumNight.test.js`;
  - Plan 02's `modelCardKeyboard.test.js` (T13 depends on it);
  - a line saying which task needs each check.
  - Verified against the Plan 01 tree and the Plan 02 plan text.
- DESIGN.md text changes:
  - chip words use T05's exact labels, and the destructive colour is on the glyph only;
  - cartridges: Enter, Space or click selects; only the Download button downloads (T13's decision); local picks go through the planner;
  - the planner paragraph covers enable switches, Corti and web search (INTEGRATION-A);
  - history deletion counts both sets;
  - `--motion-flash` is 1400ms, matching T16.
- Step 3 table:
  - ApiKeyInput: done by T12;
  - OpenAICompatiblePanel: T09 removes it (B2-4);
  - added the SidebarModal, DictationAgentSettings and DictionaryView sites that T15 and T17 fix.
- Labelled `settingsDesignDoc.test.js` in the file.
- Ran the colour guard against the Plan 01 tree; it reports only the known legacy sites.

## Checks
- i18n: extracted every task's `en` block. There are no cross-task key collisions after the T12 fix. Overwrites of existing `en` keys happen only where intended (T15 section labels, T17 `localDesc`).
- Test files: no file is created by two tasks.
- Labels: every new test file in my tasks carries a change-driving, baseline guard or source guard label in the file.
- Placeholders: none found (TBD/TODO/"similar to"/elided code).
- Owner rule: no direct provider, model, endpoint or switch write in my tasks.
  - T13 commits through T09/T08.
  - T16's live controls are non-route only.
  - T12 and T17 write no route field.

## Unresolved
1. **Stale notes files** (outside my edit scope): `T10.notes.md`, `T12.notes.md`, `T13.notes.md`, `T14.notes.md` and `T16.notes.md` §3/§4 still describe the pre-sweep designs. The task files are authoritative.
2. **T10 Corti card with both kinds.** When Corti serves a speech route and a text route at once, its single card shows the regional speech host. Fixing this needs a per-kind host on `RouteDestination`.
3. **T13 imported-model provider** (existing behaviour, T09 code): `handleModelSelect` derives the provider from the registry right after `onProviderSelect("imported")`. It is correct only if imported models are registered first. Not verified.
4. **T17 screen-context copy when the switch is off** names only "a screenshot", not the assistant's full payload. That is deliberate (it is what the switch adds) but could read as incomplete.
5. **T02's `personalWorkspace.test.js` finders** use the `text-success` class. T12 Step 3.2h moves them to `data-action="save-key"`. Any later change to that button must keep the attribute.
6. Nothing was executed: no tests, typecheck or lint. The new T16 `settingsModalPaths` test relies on effect flushing inside `React.act`. The T12 "Remove waits for a pending save" test depends on microtask order.
