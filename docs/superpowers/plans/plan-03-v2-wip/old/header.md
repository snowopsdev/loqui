# Loqui UI/UX Plan 03 — Routes & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Loqui one routing model and rebuild Settings on top of it:
- the route graph (`src/lib/routes.ts`, contract §5.1), which answers "which task runs where, and is it usable?" for all 11 routes;
- a Patchbay switchboard that shows every route at once (SET-R1 B);
- staged remote switching, where moving toward local is instant and moving toward remote waits for Apply (SET-R3 B);
- cartridge model cards with real radio semantics (SET-R4 B);
- a keyring with verification health, where verification runs in Electron main (SET-R5 C);
- a storage list with counted confirms (SET-R7 A);
- settings search with live controls (SET-R2 A);
- 13 Settings quick wins.

**Architecture:**
- **Route graph.** `src/lib/routes.ts` holds a pure resolver over a normalised `RouteSettingsSnapshot`, plus the two React hooks the contract requires. Main-process facts (installed models, saved enterprise credentials, rejected keys, sealed mode) are loaded by a small zustand store, `src/stores/routeFactsStore.ts`, through existing preload calls. `routes.ts` itself makes no IPC calls.
- **Route changes.** Every route change goes through one module, `src/stores/routeDraftStore.ts`. It applies local targets instantly with an Undo toast, and holds remote targets as a draft until the modal-level Apply bar commits them.
- **Keyring.** Key verification reuses the existing main-process `testProviderConnection` with the stored key. The renderer never sees a key. Health rows live in a new SQLite table.

**Tech Stack:** React 19, TypeScript, zustand, Tailwind CSS 4, Radix Dialog, react-i18next, Electron IPC (`preload.js`, `src/helpers/ipcHandlers.js`), better-sqlite3, Node `node:test` with `tsx`, and Vite SSR (`test/lib/rendererTestHarness.js`) for renderer modules that import the settings store.

**Spec:** `docs/superpowers/specs/2026-10-15-loqui-uiux-overhaul.md`: the Plan 03 row in §3, decisions D1, D4 and D6, constraints §4, contracts §5.1 (owned here), §5.3 and §5.4 (consumed). Visual acceptance is the picked variant cards in `design-explorations/loqui-uiux-review.html#ch-settings`. Their source is `design-explorations/loqui-uiux-review/parts/05-settings.html`:

| Pick | Card lines | Script lines |
|---|---|---|
| R1 B | 197–221 | 381–505 |
| R2 A | 634–645 | 672–742 |
| R3 B | 865–879 | 920–968 |
| R4 B | 1086–1097 | 1178–1204 |
| R5 C | 1351–1359 | 1451–1467 |
| R7 A | 1658–1672 | 1703–1736 |

The evidence is in `.omc/research/ui-review/audit-settings.md` (§1.4 is the 11-route table) and `approved-todo.md`.

**Depends on:**
- **Plan 01 (Foundations).** This plan uses:
  - `src/lib/locality.ts`: `Locality`, `resolveLocality`, `providerDisplayName` (English, non-UI), `providerDisplayLabel(id, t)` (every provider name shown in UI), `isLoopbackUrl`;
  - `src/components/ui/LocalityRing.tsx`;
  - the `--color-locality-*`, `--color-live*` and `--motion-*` tokens;
  - `Button variant="live"`. The default `Button` is the ink capsule.

  Rebase onto `main` after Plan 01 merges and before Task 1. Plan 01 finished on `snowopsdev/feat/uiux-foundations` at `172f9df`. Its final review sent four items to this plan; each is handled below (see "Plan 01 review items").
- **Plan 02 (Bug & a11y sweep)** is expected to merge before this plan executes. It touches the same files for SET-Q1, Q2, Q5, Q6, Q11, Q13 and Q20. Where a task here supersedes one of those, the task says so. Keep Plan 02's semantics (labels, `aria-*`) and replace only the markup this plan redesigns. If Plan 02 has not merged when a task starts, do that task's "Plan 02 overlap" step anyway, because the step is written to be correct either way.

---

## Contract change requests

**§5.1, the route graph (owned here).** The §5.1 shapes ship as written, with one additive field. The union types do not change.

**Additive field: `ResolvedRoute.providerId: string | null`.** This accepts Plan 04's CCR-5.
- It holds the raw provider id (`"openai"`, `"custom"`), and is `null` for `device` and `network` routes.
- **Every UI string that names a provider** uses Plan 01's `providerDisplayLabel(providerId, t)` from `src/lib/locality.ts`, so "Custom endpoint" and "Unknown provider" are localised (`locality.customEndpoint`, `locality.unknownProvider`). This covers chips, toasts, the Apply bar, the Patchbay, the keyring and screen-context copy. Task 15's guard test fails if a settings UI file calls `providerDisplayName`.
- `provider` stays the English display string from `providerDisplayName`, for logs and non-UI uses only.

**Clarifications.** The owner should copy these into §5.1 in the PR for this plan (spec rule: "the owner updates this section in the same PR"):

1. **No provider chosen.** A remote-mode route with no provider reports `{ status: "needsKey", provider: "" }`. An empty `provider` string means "choose a provider". UIs render "Choose a provider", never "Add a key for".
2. **Unknown facts never downgrade a route.** Until main-process facts load, or if a preload call fails, `installedModels`, `speakerIdModelsReady` and `searchModelReady` are `null`, and the resolver does not report `needsModel` from a `null` fact. A route whose model is unset is still `needsModel`. Settings already clears selections whose files are missing (`clearMissingLocalModelSelections`, `src/stores/settingsStore.ts:2714`).
3. **`sends` and `off`.** `sends` is `null` when `locality` is `"device"` or the route is `off`. It is non-null for both `"network"` and `"remote"`, because a self-hosted server on another machine still receives the payload. An `off` route keeps the locality, provider and model it would use, so a row can show where it would go if turned on.
4. **Support routes.** `speakerId` and `semanticSearch` always resolve to `locality: "device"` and `provider: null`. Their `model` is a fixed technical name: `"3D-Speaker CAM++"` and `"all-MiniLM-L6-v2"`.
5. **Assistant screenshots.** With screen context on and no vision override, a non-device `voiceAssistant` route's `sends` names the screenshot too. The screenshot then goes to the assistant's own model, and the copy says so.
6. **Sealed mode covers the network too.** This accepts Plan 07's CCR-1. While sealed, every route whose locality is not `device` reports `{ status: "unreachable", detail: "sealed" }`, including LAN self-hosted servers. Off routes stay `off`.
7. **Text routes need a model.** A text route in a remote or self-hosted mode with no model chosen reports `{ status: "needsModel" }` with no `sizeBytes`, which reads as "Choose a model". Speech routes do not: providers apply their default model.
8. **Retired `openwhispr` mode.** `resolveLocality({ mode: "openwhispr" })` without a provider labels the route "Unknown provider", so the route graph always passes a provider id.
   - A route in `openwhispr` mode (the retired hosted service) resolves to `locality: "remote"`, with `providerId` set to the configured provider, or `"openwhispr"` when none is set.
   - Its state is `{ status: "unreachable", detail: "retired" }`, because no request path exists: `resolveTranscriptionRoute` rejects the mode as `UNSUPPORTED_TRANSCRIPTION_MODE`.
   - The chip reads "Service retired · choose again". Sealed mode still takes precedence.
9. **Loopback custom endpoints resolve to `device`.** `resolveLocality` ignores `remoteUrl` outside `mode: "self-hosted"`. So a `"providers"`-mode custom endpoint (provider `custom`) is resolved in the route graph instead:
   - when `isLoopbackUrl(cloudBaseUrl)` is true (LM Studio or Ollama on `localhost`, `127.0.0.1`, `::1` or `*.localhost`), it is `device`, with `providerId: null` and `sends: null`;
   - any other custom URL, including LAN addresses, stays `remote`, failing toward disclosure.
   - This applies to speech and text routes alike. It is pinned in Task 1 ("a custom endpoint … is the device only on loopback").
10. **`settingsPath` grammar.** It is `"<section>/<subTab>"` or `"<section>"`. The sections are `stt`, `llms`, `routing`, `privacyData` and the existing `SettingsSectionType` ids. Consumers pass it unchanged to the existing `onOpenSettings(section?: string)` callback in `src/components/ControlPanel.tsx`. Task 3 makes `SettingsModal` parse it.

Additive exports from `routes.ts` that consumers may also use: `ROUTE_IDS`, `ROUTE_KIND`, `ROUTE_SETTINGS_PATH`, `RouteSettingsSnapshot`, `RouteFacts`, `buildRouteSnapshot`. Also additive: `src/stores/routeFactsStore.ts` exports `refreshRouteFacts()`.

**§5.4, sealed mode (owned by Plan 07).** This plan accepts Plan 07's CCR-1 (sealed blocks `network` as well as `remote`, and `onSealedChange` returns an unsubscribe) and CCR-2 (the module boundaries).
- Until Plan 07 merges, this plan reads sealed state itself:
  - `routeFactsStore` calls the optional `privacy?.getSealed()` and `onSealedChange()`;
  - `isSealedLocality` in `src/lib/routes.ts` applies the rule.
- When Plan 07 Task 13 lands, it replaces those two touch points with `useSealedMode()` and `applySealToRoute(route, sealed)`, as CCR-2 describes. Nothing else in this plan reads sealed state.
- This plan declares `privacy?:` as optional on `window.electronAPI` (Task 2) so it compiles first. Plan 07 makes it required.

## Plan 01 review items (folded in)

| # | Item from Plan 01's final review | Where |
|---|---|---|
| 1 | `providerDisplayLabel(providerId, t)` names every provider in UI; `providerDisplayName` is for logs only | Contract above. Tasks 4, 5, 6, 7, 9 and 14 use it. Task 15 adds a guard test. |
| 2 | `openwhispr` routes must pass a provider id | Clarification 8. Task 1 resolver and test. Task 4 chip copy. |
| 3 | Decide loopback custom endpoints explicitly | Clarification 9: they resolve to `device`. Task 1 tests speech and text. |
| 4 | Extend `test/components/plumNight.test.js` to the surfaces Settings uses | Task 4 Step 1. Task 15 adds the light-theme pairing guard. |

While extending item 4, a light-theme measurement found three pairs below the bar. These are Plan 01 tokens, which this plan does not own:
- **Destructive text.** `--color-destructive` `#dc2626` is 4.43:1 on `#f5f5f5` (`muted`, `secondary`, `surface-3`).
- **Focus ring.** `--color-ring` `#ff5a1f` is 2.86:1 on `#f5f5f5` and 2.99:1 on `surface-1` `#fafafa`.
- **Warning fill.** `--color-warning` `#d97706` is 2.92:1 on `#f5f5f5`.

Plum Night passes every pair, with a minimum of 5.16:1. This plan never places destructive text or warning fills on those three light surfaces, and Task 15's guard enforces that. The focus ring on muted rows (for example, the active nav item) is a token decision for the owner; see open question 7.

## Open questions for the owner

Each question has a default, and the plan implements that default unless the owner says otherwise.

1. **Lateral provider changes.** Changing provider *within* Cloud (OpenAI → Groq) in the existing provider pickers stays immediate, with a toast that names the destination. Only mode changes and Patchbay picks are staged. Default: keep it that way. Staging inside `TranscriptionModelPicker` and `ReasoningModelSelector` is a much larger change.
2. **Codex and enterprise setup.** Codex, Bedrock, Azure and Vertex sign in inside the provider editor, which appears only after a switch. Their staged Apply is therefore allowed before credentials exist, with the copy "Sign in to X next. Nothing is sent until you do." Default: allow it.
3. **Corti credentials.** Speech counts Corti as configured only when both the client id and the client secret are saved. Text counts it only when the API key is saved. This mirrors `test-provider-connection`. Confirm that this matches how Corti is actually used.
4. **Transcript export.** The R7 A mock shows an "Export" button for transcript history, but there is no export IPC today. Default: ship without it, and add it with an export feature later.
5. **Curated model tiers.** The Speed and Quality pips are size-derived estimates until `speedTier` and `qualityTier` are curated in `modelRegistryData.json`. Should someone curate them before release?
6. **Main-process locality.** `ipcHandlers.js` gains a small `PROVIDER_NAMES` map for native reminder notifications that mirrors `src/lib/locality.ts`. Default: accept the duplication. Main cannot import the renderer TS module without a build step.
7. **Light-theme ring and status tokens.** Should the owner retune the orange ring (or add a darker ring for muted surfaces), `--color-destructive` and `--color-warning`? This would be a Plan 01 follow-up, so that they clear 3:1 and 4.5:1 on `#f5f5f5` in light theme (see "Plan 01 review items"). Default: Plan 03 avoids those pairings, and the active nav item's focus ring stays as Plan 01 shipped it.

## Global Constraints

- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md). Key verification runs in main with the stored key, and no IPC call in this plan returns a key.
- Local and remote choices stay explicit. Nothing silently switches provider or moves work from local to remote. Content is preserved on every failure. A route change toward remote is never applied without an explicit Apply. No provider or model change happens as a side effect.
- Unknown providers resolve to `remote` (fail toward disclosure). Loopback self-hosted URLs resolve to `device`. This comes from Plan 01's `resolveLocality`; do not re-implement it.
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night. Locality is always shape or glyph plus words, never colour alone.
- Motion uses the shared `--motion-*` tokens only. Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms (the existing policy in `src/index.css`).
- Orange means live voice (D1). In Settings, the default `Button` (the ink capsule) is the primary action. Orange appears only as the focus ring, the selected-card border and the active-nav marker, never on download or apply buttons.
- Every visible string goes through i18n in all 11 locales: `ar de en es fr it ja pt ru zh-CN zh-TW`. `npm run i18n:check` passes.
  - The check also enforces CLDR plural categories per locale (`_zero/_one/_two/_few/_many/_other` as `Intl.PluralRules` selects them) and `{{count}}` in non-singular forms.
  - Every counted string in this plan uses `{{count}}`. Arabic needs all six forms, Russian needs `one/few/many/other`, and Japanese and Chinese need only `other`.
- Use logical properties for RTL (`ms-`, `me-`, `start`, `end`, `inset-inline-*`). Arrow-key navigation in grids flips Left and Right in RTL.
- Provider names and model names are proper nouns and are not translated. Payload descriptions (`sends`) are translated.
- Tests:
  - Use `node:test` through `npm test` (`scripts/run-tests.js`). Run `npm run native:node` once before tests, and `npm run native:electron` before launching the app.
  - Renderer modules that import the settings store are loaded through `createRendererServer` from `test/lib/rendererTestHarness.js`. Plain TS modules without store imports may be `import()`ed directly.
  - Never use personal profiles in tests.
- Node: `~/.nvm/versions/node/v24.21.0/bin` (`.node-version` 24.21.0).
- Before every commit, run `npx prettier --write` on the files you touched, because `npm run format:check` covers `src/`. Then run `npm run lint`.
- Before the PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check` and `npm run format:check`.
- `src/tsconfig.json` is not `strict`, so discriminated unions do not narrow through `!x.ok`. Test the discriminant explicitly (`x.ok === false`).
- **Renderer tests that mock `react-i18next`** must use `withI18nMock()` from `test/lib/i18nTestMock.js` (Task 2). Vite externalises node_modules in SSR, so a plain `mockModules` entry is silently ignored; the helper adds `noExternal` and an `initReactI18next` stub.
- `DESIGN.md` is the source of truth (D10). The sections this plan changes are updated in Task 15.

**i18n workflow used by every task.** Task 2 adds `scripts/merge-locale-keys.js`. For each task's strings:
1. Write a fragment file `/tmp/loqui-i18n-task-N.json` shaped `{ "en": {…}, "ar": {…}, …, "zh-TW": {…} }`.
2. Use the `en` block from the task verbatim. Write the other 10 locales as real translations. Keep every `{{placeholder}}` and the plural suffixes the locale needs, and keep product and model names in Latin script.
3. Run `node scripts/merge-locale-keys.js /tmp/loqui-i18n-task-N.json && npm run i18n:check`.

Machine translation is acceptable for the first pass. Note it in the PR so native speakers can review.

## Review Focus

1. **A route whose facts haven't loaded.** On a cold start, or in the browser preview where every IPC call rejects, nothing should flash "Download" or claim a model is missing. Unset models are still flagged. Pinned in Task 1 ("unknown facts never downgrade") and Task 2 ("a failing preload call leaves the fact unknown").
2. **Staged remote change when the modal closes or the route changes underneath.** Closing Settings with a draft open, or changing the same route elsewhere (Patchbay versus the STT tab), must discard the draft without applying it. Apply must re-check readiness at click time, not at render time. Pinned in Task 5 ("apply re-validates against the live snapshot") and Task 6 ("closing the modal discards the draft").
3. **Sealed mode during staging.** If sealed turns on while a remote draft is open, Apply disables and says why. Local moves still apply. Pinned in Task 5 ("a sealed snapshot blocks apply for remote targets").
4. **Keyboard in RTL and on the 2-column cartridge grid.** ←/→ swap in Arabic, ↑/↓ move by a row, and Home/End jump. The checked card is the only tab stop. Pinned in Task 10 (`rovingNav.test.js` "grid roving focus … RTL" and `modelCartridgeGrid.test.js` "one tab stop").
5. **Partial delete failure.** Deleting audio or models where some files are in use must say how many were and were not deleted, in `role="alert"`, and the dialog must stay open for retry. Pinned in Task 11 ("partial failure keeps the dialog open with an alert").

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/routes.ts` (new) | §5.1: types, pure resolver, snapshot builder, hooks | 1, 2 |
| `src/stores/routeFactsStore.ts` (new) | Main-process facts for the resolver (models on disk, credentials, rejected keys, sealed) | 2 |
| `scripts/merge-locale-keys.js` (new) | Merges per-locale i18n fragments | 2 |
| `src/lib/settingsPaths.ts` (new) | `parseSettingsPath`, section aliases, legacy sub-tabs | 3 |
| `src/components/settings/routing/RouteChips.tsx` (new) | `RouteStateChip`, `RouteDestinationChip` | 4 |
| `src/lib/routeTargets.ts` (new) | Pure: `RouteTarget`, `withRouteTarget`, `previewRoute`, `applyBlocker`, `routeChangeMessage` | 5 |
| `src/lib/localLlmProviders.ts` (new) | The registry's local LLM families, shared by store and writers | 5 |
| `src/components/settings/routing/providerCatalog.ts` (new) | Which providers serve speech, text or vision; hosts | 6 |
| `src/components/settings/routing/useRouteChange.ts` (new) | Request or apply a change and toast it, with Undo | 6 |
| `src/stores/routeDraftStore.ts` (new) | Stage, discard, apply, undo; settings writers per route | 5 |
| `src/components/settings/routing/StagedRouteBar.tsx` (new) | Modal-level sticky Apply bar | 6 |
| `src/components/settings/routing/StagedRoutePanel.tsx` (new) | "Send … to a cloud provider?" panel in editors | 6 |
| `src/components/settings/routing/destinations.ts` (new) | Pure destination list and compatibility | 7 |
| `src/components/settings/routing/Patchbay.tsx` (new) | Switchboard (list DOM plus decorative SVG cables) | 7 |
| `src/components/settings/routing/RoutingSection.tsx` (new) | The Routing settings page | 7, 9 |
| `src/helpers/keyring.js` (new) | Main: list, verify, reminders over injected deps | 8 |
| `src/components/settings/routing/KeyringPanel.tsx` (new) | Keyring UI with health and Verify all | 9 |
| `src/components/ui/ModelCartridgeGrid.tsx` (new) | Cartridge cards, radiogroup | 10 |
| `src/components/ui/rovingNav.ts` (new) | Pure roving-focus maths (`stepLinear`, `stepGrid`) | 4, 10 |
| `src/components/ui/cartridgeMath.ts` (new) | Tiers, fit, sort and collapse | 10 |
| `src/components/settings/storageMath.ts` (new) | Model totals, deletion outcomes, reset word | 11 |
| `src/components/settings/StorageList.tsx` (new) | Counted storage rows, confirms, reset | 11 |
| `src/components/ui/SettingsNav.tsx`, `src/components/ui/SettingsTitleBar.tsx` (new) | Nav with descriptions; sticky title and close | 12 |
| `src/components/settings/settingsRegistry.ts` (new) | Search registry and matcher | 13 |
| `src/components/settings/SettingsSearchResults.tsx`, `SettingsSearchField.tsx` (new) | Results pane with live controls; the field | 13 |
| `src/components/settings/screenContextCopy.ts`, `src/components/DictionaryHeaderActions.tsx` (new) | Quick wins Q15 and Q23 | 14 |
| `src/components/SettingsModal.tsx`, `src/components/ui/SidebarModal.tsx` | Shell: routing nav item, descriptions, close, sticky title, search slot, Apply bar slot | 3, 6, 12, 13 |
| `src/components/SettingsPage.tsx` | Section contents (re-homing, toasts, review link, storage) | 3, 6, 11, 12, 14 |
| `src/components/ui/SettingsSection.tsx` | `InferenceModeSelector` radiogroup with state chip; `SectionHeader.note` | 4, 12 |
| `src/components/settings/InferenceConfigEditor.tsx` | Staged remote modes for LLM scopes | 6 |
| `src/components/LocalModelPicker.tsx`, `src/components/ui/ModelCardList.tsx` | Cartridges, sort/collapse, calm download | 10 |
| `src/helpers/localDatabaseSchema.js`, `src/helpers/database.js`, `src/helpers/ipcHandlers.js`, `preload.js`, `src/types/electron.ts` | Keyring table and IPC; storage counts | 8, 11 |
| `src/components/settings/DictationAgentSettings.tsx`, `src/components/SelfHostedPanel.tsx`, `src/components/DictionaryView.tsx`, `src/helpers/localASROrganization.ts`, `src/components/settings/LocalSupportModels.tsx` | Quick wins | 3, 14 |
| `docs/PRIVACY.md`, `DESIGN.md` | Network-event and design documentation | 8, 15 |

---

