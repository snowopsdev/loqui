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

### Task 1: Route graph, part 1: types and the pure resolver (§5.1)

This is the contract every later task and Plans 04–07 build on. It covers the data half of SET-R1 and SET-R3 (the route state machine) and fixes SET-04 ("Active" means selected, not usable).

**Files:**
- Create: `src/lib/routes.ts`
- Test: `test/lib/routes.test.js`

**Interfaces:**
- Consumes, from Plan 01 `src/lib/locality.ts`: `type Locality`, `resolveLocality({ mode, provider?, remoteUrl? }): { locality; provider }`, `providerDisplayName(id)` and `isLoopbackUrl(url)`.
- Consumes, from `src/stores/settingsStore.ts`:
  - `type SettingsState` (`:775`);
  - `selectResolvedMeetingTranscription` (`:2532`) and `selectResolvedUploadTranscription` (`:2569`);
  - `selectResolvedLLMConfig(state, scope)` (`:2629`).
- Consumes, from `src/models/ModelRegistry.ts`: `getWhisperModelInfo` (`:499`), `getCloudModel(id, provider?)` (`:505`), `getLocalModel` (`:525`), `getParakeetModelInfo` (`:578`) and `getTranscriptionModels(providerId)` (`:481`).
- Produces the §5.1 types (`RouteId`, `RouteKind`, `RouteState`, `ResolvedRoute`, plus the additive `providerId`), and:

  ```ts
  export const ROUTE_IDS: readonly RouteId[];                 // the 11 ids in contract order
  export const ROUTE_KIND: Record<RouteId, RouteKind>;
  export const ROUTE_SETTINGS_PATH: Record<RouteId, string>;
  export type SttContext = "dictation" | "meeting" | "upload";
  export type LlmRouteScope = "dictationCleanup" | "dictationAgent" | "dictationAgentVision" | "dictationTranslation" | "noteFormatting" | "chatIntelligence";
  export type SendsRouteId = Exclude<RouteId, "speakerId" | "semanticSearch">;
  export type SendsKey = SendsRouteId | "voiceAssistantWithScreen";
  export interface SttRouteInput { mode: string; localProvider: string; localModel: string; cloudProvider: string; cloudModel: string; cloudBaseUrl: string; remoteUrl: string; remoteModel: string }
  export interface LlmRouteInput { mode: string; provider: string; model: string; remoteUrl: string; cloudBaseUrl: string }
  export interface ModelInfo { name: string; sizeBytes?: number }
  export interface RouteFacts {
    installedModels: ReadonlySet<string> | null;    // "whisper:<id>", "sherpa:<id>", "llm:<id>"; null = not known yet
    extraCredentials: ReadonlySet<string>;          // "codex" | "bedrock" | "azure" | "vertex" when main says configured
    rejectedKeys: ReadonlySet<string>;              // provider ids whose last verification was rejected (Task 9)
    speakerIdModelsReady: boolean | null;
    searchModelReady: boolean | null;
    sealed: boolean;
  }
  export interface RouteSettingsSnapshot {
    stt: Record<SttContext, SttRouteInput>;
    llm: Record<LlmRouteScope, LlmRouteInput>;
    enabled: { cleanup: boolean; voiceAssistant: boolean; screenContext: boolean; visionOverride: boolean; translation: boolean; speakerId: boolean };
    savedKeys: ReadonlySet<string>;
    rejectedKeys: ReadonlySet<string>;
    installedModels: ReadonlySet<string> | null;
    models: Readonly<Record<string, ModelInfo>>;    // keyed like installedModels, plus "cloud:<provider>:<model>"
    speakerIdModelsReady: boolean | null;
    searchModelReady: boolean | null;
    sealed: boolean;
    sends: Readonly<Record<SendsKey, string>>;      // translated payload copy (Task 2 supplies it)
  }
  export const SUPPORT_MODEL_NAMES: { speakerId: string; semanticSearch: string };
  export function localSttModelKey(localProvider: string, modelId: string): string;
  export function isSealedLocality(locality: Locality): boolean;
  export function buildRouteSnapshot(state: SettingsState, facts: RouteFacts, sends: Record<SendsKey, string>): RouteSettingsSnapshot;
  export function resolveRoutes(snapshot: RouteSettingsSnapshot): ResolvedRoute[];
  export function resolveRoute(snapshot: RouteSettingsSnapshot, id: RouteId): ResolvedRoute;
  ```

  The hooks `useResolvedRoutes` and `useResolvedRoute` are added to this file in Task 2.

- [ ] **Step 1: Write the failing test**

Create `test/lib/routes.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");

const SENDS = {
  dictationStt: "your audio and dictionary words",
  noteRecordingStt: "meeting audio",
  uploadStt: "the audio file",
  dictationCleanup: "your transcript text",
  voiceAssistant: "your request and clipboard context",
  assistantVision: "a screenshot and your request",
  translation: "the text you translate",
  noteFormatting: "the meeting transcript",
  chat: "your messages and note context",
  voiceAssistantWithScreen: "your request, clipboard context and a screenshot",
};

const QWEN = "qwen3.5-2b-q4_k_m";

function stt(o = {}) {
  return { mode: "local", localProvider: "whisper", localModel: "base", cloudProvider: "", cloudModel: "", cloudBaseUrl: "", remoteUrl: "", remoteModel: "", ...o };
}
function llm(o = {}) {
  return { mode: "local", provider: "qwen", model: QWEN, remoteUrl: "", cloudBaseUrl: "", ...o };
}
// Everything local, downloaded and enabled. Each test overrides one thing.
function snapshot(over = {}) {
  const o = { stt: {}, llm: {}, enabled: {}, ...over };
  return {
    stt: { dictation: stt(o.stt.dictation), meeting: stt(o.stt.meeting), upload: stt(o.stt.upload) },
    llm: {
      dictationCleanup: llm(o.llm.dictationCleanup),
      dictationAgent: llm(o.llm.dictationAgent),
      dictationAgentVision: llm(o.llm.dictationAgentVision),
      dictationTranslation: llm(o.llm.dictationTranslation),
      noteFormatting: llm(o.llm.noteFormatting),
      chatIntelligence: llm(o.llm.chatIntelligence),
    },
    enabled: { cleanup: true, voiceAssistant: true, screenContext: true, visionOverride: false, translation: true, speakerId: true, ...o.enabled },
    savedKeys: new Set(o.savedKeys ?? []),
    rejectedKeys: new Set(o.rejectedKeys ?? []),
    installedModels: "installedModels" in o ? o.installedModels : new Set(["whisper:base", `llm:${QWEN}`]),
    models: {
      "whisper:base": { name: "Base", sizeBytes: 148000000 },
      "whisper:small": { name: "Small", sizeBytes: 466000000 },
      [`llm:${QWEN}`]: { name: "Qwen3.5 2B", sizeBytes: 1329766560 },
      "cloud:openai:gpt-4o-mini-transcribe": { name: "GPT-4o Mini Transcribe" },
      "cloud:anthropic:claude-sonnet": { name: "Claude Sonnet" },
    },
    speakerIdModelsReady: "speakerIdModelsReady" in o ? o.speakerIdModelsReady : true,
    searchModelReady: "searchModelReady" in o ? o.searchModelReady : true,
    sealed: o.sealed ?? false,
    sends: SENDS,
  };
}

test("route graph", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-routes-test-" });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const byId = (s) => Object.fromEntries(routes.resolveRoutes(s).map((r) => [r.id, r]));

  await t.test("always 11 routes in contract order with kinds and settings paths", () => {
    const list = routes.resolveRoutes(snapshot());
    assert.deepEqual(list.map((r) => r.id), [
      "dictationStt", "noteRecordingStt", "uploadStt",
      "dictationCleanup", "voiceAssistant", "assistantVision",
      "translation", "noteFormatting", "chat",
      "speakerId", "semanticSearch",
    ]);
    assert.deepEqual(list.map((r) => r.kind), [
      "speech", "speech", "speech", "text", "text", "text", "text", "text", "text", "support", "support",
    ]);
    assert.equal(list[0].settingsPath, "stt/dictation");
    assert.equal(list[8].settingsPath, "llms/chatIntelligence");
    assert.equal(list[9].settingsPath, "llms/supportModels");
  });

  await t.test("an all-local profile stays on the device, is ready and sends nothing", () => {
    for (const r of routes.resolveRoutes(snapshot())) {
      assert.equal(r.locality, "device", r.id);
      assert.deepEqual(r.state, { status: "ready" }, r.id);
      assert.equal(r.sends, null, r.id);
      assert.equal(r.provider, null, r.id);
    }
    const r = byId(snapshot());
    assert.equal(r.dictationStt.model, "Base");
    assert.equal(r.chat.model, "Qwen3.5 2B");
    assert.equal(r.speakerId.model, "3D-Speaker CAM++");
    assert.equal(r.semanticSearch.model, "all-MiniLM-L6-v2");
  });

  await t.test("a cloud route with a saved key is remote, named, ready and says what it sends", () => {
    const s = snapshot({
      stt: { dictation: { mode: "providers", cloudProvider: "openai", cloudModel: "gpt-4o-mini-transcribe" } },
      savedKeys: ["openai"],
    });
    assert.deepEqual(byId(s).dictationStt, {
      id: "dictationStt",
      kind: "speech",
      locality: "remote",
      provider: "OpenAI",
      providerId: "openai",
      model: "GPT-4o Mini Transcribe",
      state: { status: "ready" },
      sends: "your audio and dictionary words",
      settingsPath: "stt/dictation",
    });
  });

  await t.test("a remote assistant with screen context and no override also sends the screenshot", () => {
    const s = snapshot({ savedKeys: ["openai"], llm: { dictationAgent: { mode: "providers", provider: "openai", model: "gpt-4o" } } });
    assert.equal(byId(s).voiceAssistant.sends, "your request, clipboard context and a screenshot");
    const noScreen = snapshot({ enabled: { screenContext: false }, savedKeys: ["openai"], llm: { dictationAgent: { mode: "providers", provider: "openai", model: "gpt-4o" } } });
    assert.equal(byId(noScreen).voiceAssistant.sends, "your request and clipboard context");
  });

  await t.test("Corti speech needs client credentials; Corti text needs the API key", () => {
    const speech = snapshot({ savedKeys: ["corti"], stt: { dictation: { mode: "providers", cloudProvider: "corti", cloudModel: "m" } } });
    assert.deepEqual(byId(speech).dictationStt.state, { status: "needsKey", provider: "Corti" });
    const ok = snapshot({ savedKeys: ["corti:speech"], stt: { dictation: { mode: "providers", cloudProvider: "corti", cloudModel: "m" } } });
    assert.deepEqual(byId(ok).dictationStt.state, { status: "ready" });
  });

  await t.test("a missing, rejected or unchosen provider key is needsKey", () => {
    const noKey = snapshot({ llm: { chatIntelligence: { mode: "providers", provider: "groq", model: "openai/gpt-oss-120b" } } });
    assert.deepEqual(byId(noKey).chat.state, { status: "needsKey", provider: "Groq" });
    const rejected = snapshot({
      llm: { chatIntelligence: { mode: "providers", provider: "groq", model: "x" } },
      savedKeys: ["groq"],
      rejectedKeys: ["groq"],
    });
    assert.deepEqual(byId(rejected).chat.state, { status: "needsKey", provider: "Groq" });
    const unchosen = snapshot({ llm: { chatIntelligence: { mode: "providers", provider: "", model: "" } } });
    assert.deepEqual(byId(unchosen).chat.state, { status: "needsKey", provider: "" });
    assert.equal(byId(unchosen).chat.locality, "remote");
    assert.equal(byId(unchosen).chat.provider, null);
  });

  await t.test("a local model that is not on disk needs a download; an unset model needs a choice", () => {
    const missing = snapshot({ stt: { dictation: { localModel: "small" } } });
    assert.deepEqual(byId(missing).dictationStt.state, { status: "needsModel", sizeBytes: 466000000 });
    const unset = snapshot({ llm: { noteFormatting: { model: "" } } });
    assert.deepEqual(byId(unset).noteFormatting.state, { status: "needsModel" });
    assert.equal(byId(unset).noteFormatting.model, null);
  });

  await t.test("a usable text provider without a chosen model still needs a model; speech does not", () => {
    const s = snapshot({
      savedKeys: ["groq"],
      llm: { chatIntelligence: { mode: "providers", provider: "groq", model: "" } },
      stt: { dictation: { mode: "providers", cloudProvider: "groq", cloudModel: "" } },
    });
    assert.deepEqual(byId(s).chat.state, { status: "needsModel" });
    assert.deepEqual(byId(s).dictationStt.state, { status: "ready" });
  });

  await t.test("unknown facts never downgrade a route", () => {
    const s = snapshot({ installedModels: null, speakerIdModelsReady: null, searchModelReady: null, stt: { dictation: { localModel: "small" } } });
    const r = byId(s);
    assert.deepEqual(r.dictationStt.state, { status: "ready" });
    assert.deepEqual(r.speakerId.state, { status: "ready" });
    assert.deepEqual(r.semanticSearch.state, { status: "ready" });
    // An unset model is still flagged, because that is a settings fact, not a disk fact.
    const unset = snapshot({ installedModels: null, llm: { chatIntelligence: { model: "" } } });
    assert.deepEqual(byId(unset).chat.state, { status: "needsModel" });
  });

  await t.test("self-hosted: loopback is the device, LAN is the network, empty or malformed needs a URL", () => {
    const at = (url) => byId(snapshot({ llm: { dictationTranslation: { mode: "self-hosted", remoteUrl: url, model: "llama3.1:8b" } } })).translation;
    assert.equal(at("http://localhost:11434/v1").locality, "device");
    assert.equal(at("http://localhost:11434/v1").sends, null);
    assert.equal(at("http://192.168.1.20:11434/v1").locality, "network");
    assert.equal(at("http://192.168.1.20:11434/v1").sends, "the text you translate");
    assert.deepEqual(at("http://192.168.1.20:11434/v1").state, { status: "ready" });
    assert.deepEqual(at("").state, { status: "needsUrl" });
    assert.deepEqual(at("not a url").state, { status: "needsUrl" });
    assert.equal(at("not a url").locality, "network");
    assert.equal(at("http://192.168.1.20:11434/v1").model, "llama3.1:8b");
  });

  await t.test("a custom endpoint needs a base URL and is the device only on loopback", () => {
    const at = (url) => byId(snapshot({ llm: { dictationCleanup: { mode: "providers", provider: "custom", model: "m", cloudBaseUrl: url } } })).dictationCleanup;
    assert.deepEqual(at("").state, { status: "needsUrl" });
    // Decision (Plan 01 review item 3): loopback custom endpoints are this device.
    for (const url of ["http://127.0.0.1:8080/v1", "http://localhost:1234/v1", "http://[::1]:1234/v1", "http://lmstudio.localhost/v1"]) {
      const r = at(url);
      assert.equal(r.locality, "device", url);
      assert.equal(r.providerId, null, url);
      assert.equal(r.sends, null, url);
    }
    // Everything else fails toward disclosure, LAN included.
    for (const url of ["https://llm.example.com/v1", "http://192.168.1.20:1234/v1"]) {
      assert.equal(at(url).locality, "remote", url);
      assert.equal(at(url).providerId, "custom", url);
    }
    assert.equal(at("https://llm.example.com/v1").provider, "Custom endpoint");
    const speech = byId(snapshot({ stt: { dictation: { mode: "providers", cloudProvider: "custom", cloudBaseUrl: "http://localhost:9000/v1" } } }));
    assert.equal(speech.dictationStt.locality, "device", "the same rule holds for speech");
  });

  await t.test("off routes keep their destination but send nothing", () => {
    const s = snapshot({
      enabled: { cleanup: false, translation: false },
      savedKeys: ["openai"],
      llm: { dictationCleanup: { mode: "providers", provider: "openai", model: "gpt-4o-mini" } },
    });
    const r = byId(s);
    assert.deepEqual(r.dictationCleanup.state, { status: "off" });
    assert.equal(r.dictationCleanup.locality, "remote");
    assert.equal(r.dictationCleanup.sends, null);
    assert.deepEqual(r.translation.state, { status: "off" });
  });

  await t.test("assistant vision follows the assistant unless overridden, and is off without screen context", () => {
    const assistantCloud = { mode: "providers", provider: "openai", model: "gpt-4o" };
    const follow = byId(snapshot({ savedKeys: ["openai", "anthropic"], llm: { dictationAgent: assistantCloud, dictationAgentVision: { mode: "providers", provider: "anthropic", model: "claude-sonnet" } } }));
    assert.equal(follow.assistantVision.provider, "OpenAI");
    const override = byId(snapshot({ enabled: { visionOverride: true }, savedKeys: ["openai", "anthropic"], llm: { dictationAgent: assistantCloud, dictationAgentVision: { mode: "providers", provider: "anthropic", model: "claude-sonnet" } } }));
    assert.equal(override.assistantVision.provider, "Anthropic");
    assert.equal(override.assistantVision.model, "Claude Sonnet");
    assert.deepEqual(byId(snapshot({ enabled: { screenContext: false } })).assistantVision.state, { status: "off" });
    assert.deepEqual(byId(snapshot({ enabled: { voiceAssistant: false } })).assistantVision.state, { status: "off" });
  });

  await t.test("sealed mode makes every route that leaves the device unreachable, and leaves device and off routes alone", () => {
    const s = snapshot({
      sealed: true,
      savedKeys: ["openai"],
      enabled: { translation: false },
      stt: { dictation: { mode: "providers", cloudProvider: "openai", cloudModel: "gpt-4o-mini-transcribe" } },
      llm: {
        noteFormatting: { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" },
        dictationTranslation: { mode: "providers", provider: "openai", model: "gpt-4o-mini" },
      },
    });
    const r = byId(s);
    assert.deepEqual(r.dictationStt.state, { status: "unreachable", detail: "sealed" });
    assert.deepEqual(r.noteFormatting.state, { status: "unreachable", detail: "sealed" }, "a LAN server is another machine");
    assert.deepEqual(r.chat.state, { status: "ready" });
    assert.deepEqual(r.translation.state, { status: "off" });
    assert.equal(routes.isSealedLocality("remote"), true);
    assert.equal(routes.isSealedLocality("network"), true);
    assert.equal(routes.isSealedLocality("device"), false);
  });

  await t.test("support routes are local-only, can be off or need a download", () => {
    const r = byId(snapshot({ enabled: { speakerId: false }, searchModelReady: false, sealed: true }));
    assert.deepEqual(r.speakerId.state, { status: "off" });
    assert.deepEqual(r.semanticSearch.state, { status: "needsModel" });
    assert.equal(r.semanticSearch.locality, "device");
    assert.equal(r.speakerId.provider, null);
  });

  await t.test("unknown modes fail toward disclosure", () => {
    const r = byId(snapshot({ stt: { upload: { mode: "mystery", cloudProvider: "" } } }));
    assert.equal(r.uploadStt.locality, "remote");
  });

  await t.test("the retired openwhispr mode names a provider and says it cannot run", () => {
    const bare = byId(snapshot({ stt: { upload: { mode: "openwhispr", cloudProvider: "" } } })).uploadStt;
    assert.equal(bare.locality, "remote");
    assert.equal(bare.providerId, "openwhispr");
    assert.notEqual(bare.provider, "Unknown provider");
    assert.deepEqual(bare.state, { status: "unreachable", detail: "retired" });
    const withProvider = byId(snapshot({ llm: { chatIntelligence: { mode: "openwhispr", provider: "openai", model: "x" } } })).chat;
    assert.equal(withProvider.providerId, "openai");
    assert.equal(withProvider.provider, "OpenAI");
  });

  await t.test("resolveRoute matches the list entry", () => {
    const s = snapshot({ savedKeys: ["openai"], stt: { meeting: { mode: "providers", cloudProvider: "openai" } } });
    assert.deepEqual(routes.resolveRoute(s, "noteRecordingStt"), byId(s).noteRecordingStt);
  });

  await t.test("buildRouteSnapshot reads the real store shape, fallbacks and saved-key sentinels", async () => {
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    const state = {
      ...useSettingsStore.getState(),
      transcriptionMode: "providers",
      cloudTranscriptionProvider: "openai",
      cloudTranscriptionModel: "gpt-4o-mini-transcribe",
      openaiApiKey: "__stored__",
      groqApiKey: "",
      cortiClientId: "__stored__",
      cortiClientSecret: "__stored__",
      meetingCloudTranscriptionProvider: "",
      useCleanupModel: false,
      voiceAgentScreenContext: true,
      useDictationAgentVisionModel: false,
    };
    const facts = {
      installedModels: null,
      extraCredentials: new Set(["codex"]),
      rejectedKeys: new Set(),
      speakerIdModelsReady: true,
      searchModelReady: false,
      sealed: false,
    };
    const s = routes.buildRouteSnapshot(state, facts, SENDS);
    assert.equal(s.stt.dictation.mode, "providers");
    assert.equal(routes.resolveRoute(s, "dictationStt").providerId, "openai");
    assert.equal(s.stt.meeting.cloudProvider, "openai", "empty meeting provider falls back to dictation");
    assert.deepEqual([...s.savedKeys].sort(), ["codex", "corti:speech", "openai"]);
    assert.equal(s.enabled.cleanup, false);
    assert.equal(s.enabled.screenContext, true);
    assert.equal(s.searchModelReady, false);
    assert.equal(s.models["cloud:openai:gpt-4o-mini-transcribe"].name, "GPT-4o Mini Transcribe");
    assert.equal(routes.resolveRoute(s, "dictationStt").provider, "OpenAI");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/lib/routes.test.js`
Expected: FAIL. `ssrLoadModule("/lib/routes.ts")` throws "Failed to load url /lib/routes.ts".

- [ ] **Step 3: Implement**

Create `src/lib/routes.ts`. The hooks are appended in Task 2.

```ts
import {
  isLoopbackUrl,
  providerDisplayName,
  resolveLocality,
  type Locality,
} from "./locality";
import {
  selectResolvedLLMConfig,
  selectResolvedMeetingTranscription,
  selectResolvedUploadTranscription,
  type SettingsState,
} from "../stores/settingsStore";
import {
  getCloudModel,
  getLocalModel,
  getParakeetModelInfo,
  getTranscriptionModels,
  getWhisperModelInfo,
} from "../models/ModelRegistry";

// The route graph (spec §5.1). One resolver answers "which task runs where,
// and can it run right now?" for Settings, the pill and onboarding. The
// resolver is pure: main-process facts (models on disk, credentials, sealed
// mode) arrive as snapshot fields, loaded by stores/routeFactsStore.ts.

export type RouteId =
  | "dictationStt" | "noteRecordingStt" | "uploadStt"
  | "dictationCleanup" | "voiceAssistant" | "assistantVision"
  | "translation" | "noteFormatting" | "chat"
  | "speakerId" | "semanticSearch";

export type RouteKind = "speech" | "text" | "support";

export type RouteState =
  | { status: "ready" }
  | { status: "off" }
  | { status: "needsModel"; sizeBytes?: number }
  | { status: "needsKey"; provider: string }
  | { status: "needsUrl" }
  | { status: "unreachable"; detail?: string };

export interface ResolvedRoute {
  id: RouteId;
  kind: RouteKind;
  locality: Locality;
  provider: string | null;      // English display name (providerDisplayName); UI uses providerDisplayLabel(providerId, t)
  providerId: string | null;    // raw id, e.g. "openai" or "custom"; null for device and network (Plan 04 CCR-5)
  model: string | null;
  state: RouteState;
  sends: string | null;
  settingsPath: string;
}

export const ROUTE_IDS = [
  "dictationStt", "noteRecordingStt", "uploadStt",
  "dictationCleanup", "voiceAssistant", "assistantVision",
  "translation", "noteFormatting", "chat",
  "speakerId", "semanticSearch",
] as const satisfies readonly RouteId[];

export const ROUTE_KIND: Record<RouteId, RouteKind> = {
  dictationStt: "speech",
  noteRecordingStt: "speech",
  uploadStt: "speech",
  dictationCleanup: "text",
  voiceAssistant: "text",
  assistantVision: "text",
  translation: "text",
  noteFormatting: "text",
  chat: "text",
  speakerId: "support",
  semanticSearch: "support",
};

export const ROUTE_SETTINGS_PATH: Record<RouteId, string> = {
  dictationStt: "stt/dictation",
  noteRecordingStt: "stt/noteRecording",
  uploadStt: "stt/upload",
  dictationCleanup: "llms/dictationCleanup",
  voiceAssistant: "llms/dictationAgent",
  assistantVision: "llms/dictationAgent",
  translation: "llms/dictationTranslation",
  noteFormatting: "llms/noteFormatting",
  chat: "llms/chatIntelligence",
  speakerId: "llms/supportModels",
  semanticSearch: "llms/supportModels",
};

export type SttContext = "dictation" | "meeting" | "upload";
export type LlmRouteScope =
  | "dictationCleanup" | "dictationAgent" | "dictationAgentVision"
  | "dictationTranslation" | "noteFormatting" | "chatIntelligence";
export type SendsRouteId = Exclude<RouteId, "speakerId" | "semanticSearch">;
// Payload copy keys: one per sending route, plus the assistant with a screenshot.
export type SendsKey = SendsRouteId | "voiceAssistantWithScreen";

export interface SttRouteInput {
  mode: string;
  localProvider: string;
  localModel: string;
  cloudProvider: string;
  cloudModel: string;
  cloudBaseUrl: string;
  remoteUrl: string;
  remoteModel: string;
}

export interface LlmRouteInput {
  mode: string;
  provider: string;
  model: string;
  remoteUrl: string;
  cloudBaseUrl: string;
}

export interface ModelInfo {
  name: string;
  sizeBytes?: number;
}

export interface RouteFacts {
  installedModels: ReadonlySet<string> | null;
  extraCredentials: ReadonlySet<string>;
  rejectedKeys: ReadonlySet<string>;
  speakerIdModelsReady: boolean | null;
  searchModelReady: boolean | null;
  sealed: boolean;
}

export interface RouteSettingsSnapshot {
  stt: Record<SttContext, SttRouteInput>;
  llm: Record<LlmRouteScope, LlmRouteInput>;
  enabled: {
    cleanup: boolean;
    voiceAssistant: boolean;
    screenContext: boolean;
    visionOverride: boolean;
    translation: boolean;
    speakerId: boolean;
  };
  savedKeys: ReadonlySet<string>;
  rejectedKeys: ReadonlySet<string>;
  installedModels: ReadonlySet<string> | null;
  models: Readonly<Record<string, ModelInfo>>;
  speakerIdModelsReady: boolean | null;
  searchModelReady: boolean | null;
  sealed: boolean;
  sends: Readonly<Record<SendsKey, string>>;
}

// Technical names, not translated (proper nouns).
export const SUPPORT_MODEL_NAMES = {
  speakerId: "3D-Speaker CAM++",
  semanticSearch: "all-MiniLM-L6-v2",
} as const;

const STT_CONTEXT: Partial<Record<RouteId, SttContext>> = {
  dictationStt: "dictation",
  noteRecordingStt: "meeting",
  uploadStt: "upload",
};

const LLM_SCOPE: Partial<Record<RouteId, LlmRouteScope>> = {
  dictationCleanup: "dictationCleanup",
  voiceAssistant: "dictationAgent",
  assistantVision: "dictationAgentVision",
  translation: "dictationTranslation",
  noteFormatting: "noteFormatting",
  chat: "chatIntelligence",
};

// Whisper files and the sherpa-onnx family (Parakeet, Nemotron, Cohere) are
// listed by different main-process calls, so the key carries the family.
export function localSttModelKey(localProvider: string, modelId: string): string {
  return `${localProvider === "whisper" ? "whisper" : "sherpa"}:${modelId}`;
}

// Spec §5.4 + Plan 07 CCR-1: sealed mode blocks everything that leaves this
// device, LAN servers included. Plan 07 Task 13 swaps this for applySealToRoute.
export function isSealedLocality(locality: Locality): boolean {
  return locality !== "device";
}

interface Destination {
  locality: Locality;
  provider: string | null;
  providerId: string | null;
  model: string | null;
  state: RouteState;
}

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim());
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function localDestination(s: RouteSettingsSnapshot, key: string, modelId: string): Destination {
  const info = s.models[key];
  const model = modelId ? (info?.name ?? modelId) : null;
  let state: RouteState = { status: "ready" };
  if (!modelId) {
    state = { status: "needsModel" };
  } else if (s.installedModels && !s.installedModels.has(key)) {
    state = info?.sizeBytes ? { status: "needsModel", sizeBytes: info.sizeBytes } : { status: "needsModel" };
  }
  return { locality: "device", provider: null, providerId: null, model, state };
}

function selfHostedDestination(url: string, model: string): Destination {
  const { locality } = resolveLocality({ mode: "self-hosted", remoteUrl: url });
  return {
    locality,
    provider: null,
    providerId: null,
    model: model || null,
    state: isHttpUrl(url) ? { status: "ready" } : { status: "needsUrl" },
  };
}

function cloudDestination(
  s: RouteSettingsSnapshot,
  mode: string,
  providerId: string,
  baseUrl: string,
  modelId: string,
  keyId: string = providerId // Corti speech authenticates with client credentials ("corti:speech")
): Destination {
  const model = modelId ? (s.models[`cloud:${providerId}:${modelId}`]?.name ?? modelId) : null;
  if (mode === "openwhispr") {
    // The retired hosted service: nothing can run, but the label must still
    // name a provider (resolveLocality alone would say "Unknown provider").
    const id = providerId || "openwhispr";
    return {
      locality: "remote",
      provider: providerDisplayName(id),
      providerId: id,
      model,
      state: { status: "unreachable", detail: "retired" },
    };
  }
  // Loopback custom endpoints (LM Studio, Ollama on localhost) never leave
  // the device. resolveLocality only reads URLs in self-hosted mode, so the
  // route graph decides here. Non-loopback custom URLs stay remote.
  if (providerId === "custom" && isLoopbackUrl(baseUrl)) {
    return { locality: "device", provider: null, providerId: null, model, state: { status: "ready" } };
  }
  const resolved = resolveLocality({ mode, provider: providerId });
  const provider = providerId ? resolved.provider : null;
  let state: RouteState = { status: "ready" };
  if (!providerId) {
    state = { status: "needsKey", provider: "" };
  } else if (providerId === "custom") {
    state = baseUrl.trim() ? { status: "ready" } : { status: "needsUrl" };
  } else if (!s.savedKeys.has(keyId) || s.rejectedKeys.has(providerId)) {
    state = { status: "needsKey", provider: provider ?? providerDisplayName(providerId) };
  }
  return { locality: resolved.locality, provider, providerId: providerId || null, model, state };
}

function sttDestination(s: RouteSettingsSnapshot, input: SttRouteInput): Destination {
  if (input.mode === "local") {
    return localDestination(s, localSttModelKey(input.localProvider, input.localModel), input.localModel);
  }
  if (input.mode === "self-hosted") return selfHostedDestination(input.remoteUrl, input.remoteModel);
  const keyId = input.cloudProvider === "corti" ? "corti:speech" : input.cloudProvider;
  return cloudDestination(s, input.mode, input.cloudProvider, input.cloudBaseUrl, input.cloudModel, keyId);
}

function llmDestination(s: RouteSettingsSnapshot, input: LlmRouteInput): Destination {
  if (input.mode === "local") return localDestination(s, `llm:${input.model}`, input.model);
  const dest =
    input.mode === "self-hosted"
      ? selfHostedDestination(input.remoteUrl, input.model)
      : cloudDestination(s, input.mode, input.provider, input.cloudBaseUrl, input.model);
  // Text providers have no implicit default model (speech providers do, via
  // resolveByokModel), so an otherwise-usable text route still needs a choice.
  if (dest.state.status === "ready" && !input.model) return { ...dest, state: { status: "needsModel" } };
  return dest;
}

function isOff(id: RouteId, s: RouteSettingsSnapshot): boolean {
  switch (id) {
    case "dictationCleanup":
      return !s.enabled.cleanup;
    case "voiceAssistant":
      return !s.enabled.voiceAssistant;
    case "assistantVision":
      return !s.enabled.voiceAssistant || !s.enabled.screenContext;
    case "translation":
      return !s.enabled.translation;
    case "speakerId":
      return !s.enabled.speakerId;
    default:
      return false;
  }
}

export function resolveRoute(s: RouteSettingsSnapshot, id: RouteId): ResolvedRoute {
  const kind = ROUTE_KIND[id];
  const settingsPath = ROUTE_SETTINGS_PATH[id];
  const off = isOff(id, s);

  if (id === "speakerId" || id === "semanticSearch") {
    const ready = id === "speakerId" ? s.speakerIdModelsReady : s.searchModelReady;
    const state: RouteState = off
      ? { status: "off" }
      : ready === false
        ? { status: "needsModel" }
        : { status: "ready" };
    return { id, kind, locality: "device", provider: null, providerId: null, model: SUPPORT_MODEL_NAMES[id], state, sends: null, settingsPath };
  }

  const context = STT_CONTEXT[id];
  let dest: Destination;
  if (context) {
    dest = sttDestination(s, s.stt[context]);
  } else {
    // Without the override, screenshots go to the assistant's own model.
    const scope = id === "assistantVision" && !s.enabled.visionOverride ? "dictationAgent" : LLM_SCOPE[id]!;
    dest = llmDestination(s, s.llm[scope]);
  }

  let state = dest.state;
  if (off) state = { status: "off" };
  else if (s.sealed && isSealedLocality(dest.locality)) state = { status: "unreachable", detail: "sealed" };

  // With screen context on and no override, the assistant's model also gets the screenshot.
  const sendsKey =
    id === "voiceAssistant" && s.enabled.screenContext && !s.enabled.visionOverride ? "voiceAssistantWithScreen" : id;
  return {
    id,
    kind,
    locality: dest.locality,
    provider: dest.provider,
    providerId: dest.providerId,
    model: dest.model,
    state,
    sends: off || dest.locality === "device" ? null : s.sends[sendsKey],
    settingsPath,
  };
}

export function resolveRoutes(s: RouteSettingsSnapshot): ResolvedRoute[] {
  return ROUTE_IDS.map((id) => resolveRoute(s, id));
}

// --- Snapshot builder: SettingsState → RouteSettingsSnapshot ---

const KEY_FIELDS = {
  openai: "openaiApiKey",
  anthropic: "anthropicApiKey",
  gemini: "geminiApiKey",
  groq: "groqApiKey",
  xai: "xaiApiKey",
  mistral: "mistralApiKey",
  openrouter: "openrouterApiKey",
  tinfoil: "tinfoilApiKey",
  deepgram: "deepgramApiKey",
  assemblyai: "assemblyaiApiKey",
} as const satisfies Record<string, keyof SettingsState>;

const LLM_SCOPES: readonly LlmRouteScope[] = [
  "dictationCleanup", "dictationAgent", "dictationAgentVision",
  "dictationTranslation", "noteFormatting", "chatIntelligence",
];

interface SttSource {
  transcriptionMode: string;
  localTranscriptionProvider: string;
  whisperModel: string;
  parakeetModel: string;
  cohereModel: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl?: string;
}

function sttInput(src: SttSource, remoteUrl: string, remoteModel: string): SttRouteInput {
  const localModel =
    src.localTranscriptionProvider === "whisper"
      ? src.whisperModel
      : src.localTranscriptionProvider === "cohere"
        ? src.cohereModel
        : src.parakeetModel;
  return {
    mode: src.transcriptionMode,
    localProvider: src.localTranscriptionProvider,
    localModel,
    cloudProvider: src.cloudTranscriptionProvider,
    cloudModel: src.cloudTranscriptionModel,
    cloudBaseUrl: src.cloudTranscriptionBaseUrl ?? "",
    remoteUrl,
    remoteModel,
  };
}

function describeModels(stt: Record<SttContext, SttRouteInput>, llm: Record<LlmRouteScope, LlmRouteInput>) {
  const models: Record<string, ModelInfo> = {};
  for (const input of Object.values(stt)) {
    if (input.localModel) {
      const key = localSttModelKey(input.localProvider, input.localModel);
      if (input.localProvider === "whisper") {
        const info = getWhisperModelInfo(input.localModel);
        if (info) models[key] = { name: info.name, sizeBytes: info.sizeMb * 1_000_000 };
      } else {
        const info = getParakeetModelInfo(input.localModel);
        if (info) models[key] = { name: info.name, sizeBytes: info.expectedSizeBytes ?? info.sizeMb * 1_000_000 };
      }
    }
    if (input.cloudProvider && input.cloudModel) {
      const info = getTranscriptionModels(input.cloudProvider).find((m) => m.id === input.cloudModel);
      if (info) models[`cloud:${input.cloudProvider}:${input.cloudModel}`] = { name: info.name };
    }
  }
  for (const input of Object.values(llm)) {
    if (!input.model) continue;
    const local = getLocalModel(input.model);
    if (local) models[`llm:${input.model}`] = { name: local.name, sizeBytes: local.sizeBytes };
    const cloud = input.provider ? getCloudModel(input.model, input.provider) : undefined;
    if (cloud) models[`cloud:${input.provider}:${input.model}`] = { name: cloud.name };
  }
  return models;
}

export function buildRouteSnapshot(
  state: SettingsState,
  facts: RouteFacts,
  sends: Record<SendsKey, string>
): RouteSettingsSnapshot {
  const meeting = selectResolvedMeetingTranscription(state);
  const upload = selectResolvedUploadTranscription(state);
  const stt: Record<SttContext, SttRouteInput> = {
    dictation: sttInput(state, state.remoteTranscriptionUrl, state.remoteTranscriptionModel),
    // Note recording has no model field of its own for self-hosted servers.
    meeting: sttInput(meeting, meeting.remoteTranscriptionUrl, state.remoteTranscriptionModel),
    // Upload has no self-hosted fields of its own: UploadSettings.tsx renders
    // SelfHostedPanel bound to the dictation server URL.
    upload: sttInput(upload, state.remoteTranscriptionUrl, state.remoteTranscriptionModel),
  };

  const llm = {} as Record<LlmRouteScope, LlmRouteInput>;
  for (const scope of LLM_SCOPES) {
    const cfg = selectResolvedLLMConfig(state, scope);
    llm[scope] = {
      mode: cfg.mode,
      provider: cfg.provider,
      model: cfg.model,
      remoteUrl: cfg.remoteUrl ?? "",
      cloudBaseUrl: cfg.cloudBaseUrl ?? "",
    };
  }

  const savedKeys = new Set<string>(facts.extraCredentials);
  for (const [provider, field] of Object.entries(KEY_FIELDS)) {
    if (state[field]) savedKeys.add(provider);
  }
  if (state.cortiApiKey) savedKeys.add("corti");
  if (state.cortiClientId && state.cortiClientSecret) savedKeys.add("corti:speech");

  return {
    stt,
    llm,
    enabled: {
      cleanup: state.useCleanupModel,
      voiceAssistant: state.useDictationAgent,
      screenContext: state.voiceAgentScreenContext,
      visionOverride: state.useDictationAgentVisionModel,
      translation: state.useDictationTranslation,
      speakerId: state.speakerDiarizationEnabled,
    },
    savedKeys,
    rejectedKeys: facts.rejectedKeys,
    installedModels: facts.installedModels,
    models: describeModels(stt, llm),
    speakerIdModelsReady: facts.speakerIdModelsReady,
    searchModelReady: facts.searchModelReady,
    sealed: facts.sealed,
    sends,
  };
}
```

Notes for the implementer:
- `resolveLocality` and the other locality helpers come from Plan 01 and must not be re-implemented.
- If `npm run typecheck` reports that a registry helper's return type differs from what is used above (`sizeMb`, `expectedSizeBytes` or `sizeBytes`), read `src/models/ModelRegistry.ts:7-125` and adapt only the field access.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/lib/routes.test.js && npm run typecheck`
Expected: PASS (1 test with 19 subtests). Typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routes.ts test/lib/routes.test.js
git commit -m "feat(routes): Pure route graph resolver for all 11 tasks"
```

---

### Task 2: Route graph, part 2: main-process facts, hooks and route copy (§5.1)

This task completes the contract: `useResolvedRoutes()` and `useResolvedRoute(id)` over `settingsStore`, with readiness facts from existing preload calls. It also adds the i18n merge script every later task uses.

**Files:**
- Create: `src/stores/routeFactsStore.ts`
- Modify: `src/lib/routes.ts`. Append the hooks and `routeSendsCopy`.
- Modify: `src/types/electron.ts`. Add the optional `privacy?` namespace inside the `electronAPI` interface, directly after `downloadSearchModel` (`:675`).
- Create: `scripts/merge-locale-keys.js`
- Create: `test/lib/i18nTestMock.js`, a shared `react-i18next` stub for Vite SSR renderer tests, used by every later task.
- Modify: `src/locales/*/translation.json`. Add a new top-level `routes` object.
- Test: `test/stores/routeFactsStore.test.js`, `test/lib/routesHooks.test.js`, `test/scripts/mergeLocaleKeys.test.js`

**Interfaces:**
- Consumes, from Task 1: `RouteFacts`, `buildRouteSnapshot`, `resolveRoutes`, `ROUTE_IDS`, `SendsKey` and `localSttModelKey`.
- Consumes these existing preload calls:
  - `listWhisperModels()` → `{ models: { model, downloaded }[] }`
  - `listParakeetModels()` → `{ models: { model, downloaded }[] }`
  - `modelGetAll()` → `{ id, isDownloaded }[]`
  - `getDiarizationModelStatus?()` → `{ modelsDownloaded }`
  - `getSearchModelStatus()` → `{ downloaded }`
  - `personalInference.codexStatus()` → `{ account? }`
  - `personalInference.credentialStatus(ref)` → `{ configured }`
  - `keyring?.list()`, added in Task 8
  - `privacy?.getSealed()` and `privacy?.onSealedChange(cb)`, from Plan 07
- Produces:

  ```ts
  // src/stores/routeFactsStore.ts
  export const EMPTY_ROUTE_FACTS: RouteFacts;
  export interface RouteFactsApi { /* structural subset of window.electronAPI, see code */ }
  export async function loadRouteFacts(api: RouteFactsApi | undefined): Promise<RouteFacts>;
  export const useRouteFactsStore: UseBoundStore<StoreApi<{ facts: RouteFacts; loaded: boolean }>>;
  export function refreshRouteFacts(): Promise<void>;
  export function ensureRouteFactsSubscribed(): void;
  // src/lib/routes.ts
  export function routeSendsCopy(t: (key: string) => string): Record<SendsKey, string>;
  // test/lib/i18nTestMock.js
  function reactI18nextMock(opts?: { withOptions?: boolean; t?: string }): string;   // ESM source for the mock
  function withI18nMock(serverOptions: object, mockOpts?: { withOptions?: boolean; t?: string }): object;
  export function useResolvedRoutes(): ResolvedRoute[];
  export function useResolvedRoute(id: RouteId): ResolvedRoute;
  ```

  Plus these i18n keys:
  - `routes.names.<RouteId>` (11)
  - `routes.subtitles.<RouteId>` (11)
  - `routes.sends.<SendsKey>` (10: the 9 sending routes plus `voiceAssistantWithScreen`)
  - `routes.groups.{speech,text,support}`
- Later tasks call `refreshRouteFacts()` after any download, delete or key verification.

- [ ] **Step 1: Write the failing tests**

Create `test/stores/routeFactsStore.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const fullApi = (over = {}) => ({
  listWhisperModels: async () => ({ success: true, models: [{ model: "base", downloaded: true }, { model: "small", downloaded: false }] }),
  listParakeetModels: async () => ({ success: true, models: [{ model: "parakeet-unified-en-0.6b", downloaded: true }] }),
  modelGetAll: async () => [{ id: "qwen3.5-2b-q4_k_m", isDownloaded: true }, { id: "qwen3.5-9b", isDownloaded: false }],
  getDiarizationModelStatus: async () => ({ available: true, modelsDownloaded: false }),
  getSearchModelStatus: async () => ({ downloaded: true }),
  personalInference: {
    codexStatus: async () => ({ available: true, account: { type: "chatgpt" } }),
    credentialStatus: async (ref) => ({ configured: ref === "bedrock" }),
  },
  keyring: { list: async () => [{ provider: "groq", hasKey: true, status: "rejected" }, { provider: "openai", hasKey: true, status: "verified" }] },
  privacy: { getSealed: async () => true },
  ...over,
});

test("route facts", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-route-facts-test-" });
  const store = await vite.ssrLoadModule("/stores/routeFactsStore.ts");

  await t.test("loads every fact from existing preload calls", async () => {
    const facts = await store.loadRouteFacts(fullApi());
    assert.deepEqual([...facts.installedModels].sort(), ["llm:qwen3.5-2b-q4_k_m", "sherpa:parakeet-unified-en-0.6b", "whisper:base"]);
    assert.deepEqual([...facts.extraCredentials].sort(), ["bedrock", "codex"]);
    assert.deepEqual([...facts.rejectedKeys], ["groq"]);
    assert.equal(facts.speakerIdModelsReady, false);
    assert.equal(facts.searchModelReady, true);
    assert.equal(facts.sealed, true);
  });

  await t.test("a failing preload call leaves the fact unknown instead of claiming a missing model", async () => {
    const facts = await store.loadRouteFacts(fullApi({
      modelGetAll: async () => { throw new Error("Available in the Loqui desktop app"); },
      getSearchModelStatus: async () => { throw new Error("nope"); },
    }));
    assert.equal(facts.installedModels, null);
    assert.equal(facts.searchModelReady, null);
    assert.equal(facts.speakerIdModelsReady, false);
  });

  await t.test("no preload at all yields empty, unknown facts and an unsealed state", async () => {
    assert.deepEqual(await store.loadRouteFacts(undefined), store.EMPTY_ROUTE_FACTS);
    const missing = await store.loadRouteFacts({});
    assert.equal(missing.installedModels, null);
    assert.equal(missing.sealed, false);
  });

  await t.test("refresh keeps only the newest result", async () => {
    let release;
    const slow = new Promise((r) => (release = r));
    globalThis.window.electronAPI = fullApi({ privacy: { getSealed: () => slow } });
    const first = store.refreshRouteFacts();
    globalThis.window.electronAPI = fullApi({ privacy: { getSealed: async () => false } });
    await store.refreshRouteFacts();
    release(true);
    await first;
    assert.equal(store.useRouteFactsStore.getState().facts.sealed, false);
    assert.equal(store.useRouteFactsStore.getState().loaded, true);
  });
});
```

Create `test/lib/routesHooks.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");
const { withI18nMock } = require("./i18nTestMock");

test("useResolvedRoutes renders all 11 routes from the settings store", async (t) => {
  // zustand 5 renders the store's *initial* state on the server
  // (useSyncExternalStore's getServerSnapshot), so seed localStorage before
  // the store module is created instead of calling setState.
  // migrateProviderSettings re-derives transcriptionMode from these two, so seed all three.
  installBrowserGlobals(t, {
    initialStorage: {
      transcriptionMode: "providers",
      useLocalWhisper: "false",
      cloudTranscriptionMode: "byok",
      cloudTranscriptionProvider: "openai",
    },
  });
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-routes-hooks-test-" }));
  const routes = await vite.ssrLoadModule("/lib/routes.ts");

  function Probe() {
    const list = routes.useResolvedRoutes();
    const dictation = routes.useResolvedRoute("dictationStt");
    return React.createElement(
      "ol",
      { "data-dictation": dictation.state.status },
      list.map((r) => React.createElement("li", { key: r.id, "data-state": r.state.status }, r.id))
    );
  }

  // No OpenAI key is hydrated in tests (keys come from main), so dictation needs one.
  const html = renderToStaticMarkup(React.createElement(Probe));
  assert.equal((html.match(/<li /g) ?? []).length, 11);
  assert.match(html, /data-dictation="needsKey"/);
  assert.ok(html.indexOf("dictationStt") < html.indexOf("semanticSearch"));
});

test("route copy covers every sending route and nothing else", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-routes-copy-test-" });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const copy = routes.routeSendsCopy((k) => `T:${k}`);
  assert.equal(Object.keys(copy).length, 10);
  assert.equal(copy.voiceAssistantWithScreen, "T:routes.sends.voiceAssistantWithScreen");
  assert.equal(copy.uploadStt, "T:routes.sends.uploadStt");
  assert.equal("speakerId" in copy, false);
});

test("every locale names every route and its payload", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "../../src/locales");
  for (const lang of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "translation.json")))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, lang, "translation.json"), "utf8"));
    assert.equal(Object.keys(json.routes.names).length, 11, `${lang} names`);
    assert.equal(Object.keys(json.routes.subtitles).length, 11, `${lang} subtitles`);
    assert.equal(Object.keys(json.routes.sends).length, 10, `${lang} sends`);
  }
});
```

Create `test/scripts/mergeLocaleKeys.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

test("merges nested keys into every locale and refuses incomplete fragments", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-merge-locales-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const lang of ["en", "de"]) {
    fs.mkdirSync(path.join(root, lang));
    fs.writeFileSync(path.join(root, lang, "translation.json"), JSON.stringify({ a: { keep: lang } }, null, 2) + "\n");
  }
  const script = path.join(__dirname, "../../scripts/merge-locale-keys.js");
  const fragment = path.join(root, "frag.json");

  fs.writeFileSync(fragment, JSON.stringify({ en: { a: { add: "x" } } }));
  const bad = spawnSync(process.execPath, [script, fragment, root], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Missing locales in fragment: de/);

  fs.writeFileSync(fragment, JSON.stringify({ en: { a: { add: "x" } }, de: { a: { add: "y" } } }));
  const ok = spawnSync(process.execPath, [script, fragment, root], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const de = JSON.parse(fs.readFileSync(path.join(root, "de", "translation.json"), "utf8"));
  assert.deepEqual(de, { a: { keep: "de", add: "y" } });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/stores/routeFactsStore.test.js test/lib/routesHooks.test.js test/scripts/mergeLocaleKeys.test.js`
Expected: FAIL. The facts store and script are missing, `routes.useResolvedRoutes` is not a function, and `json.routes` is undefined.

- [ ] **Step 3: Implement**

0. Create `test/lib/i18nTestMock.js`. Vite externalises node_modules in SSR, which bypasses `mockModules`, and any module graph that reaches `src/i18n.ts` needs `initReactI18next`:

   ```js
   // react-i18next stub for Vite SSR renderer tests. noExternal makes Vite run
   // the package through its plugin pipeline so the mock applies;
   // initReactI18next keeps src/i18n.ts's i18n.use(...) working.
   const T_KEYS = "(k) => k";
   const T_WITH_OPTIONS = "(k, o) => (o ? `${k}${JSON.stringify(o)}` : k)";

   function reactI18nextMock({ withOptions = false, t } = {}) {
     const fn = t ?? (withOptions ? T_WITH_OPTIONS : T_KEYS);
     return [
       `export const useTranslation = () => ({ t: ${fn}, i18n: { language: "en", dir: () => "ltr" } });`,
       'export const initReactI18next = { type: "3rdParty", init() {} };',
       "export const Trans = ({ children }) => children ?? null;",
     ].join("\n");
   }

   function withI18nMock(serverOptions = {}, mockOpts = {}) {
     const noExternal = Array.isArray(serverOptions.noExternal) ? serverOptions.noExternal : [];
     return {
       ...serverOptions,
       noExternal: [...noExternal, "react-i18next"],
       mockModules: { ...(serverOptions.mockModules ?? {}), "react-i18next": reactI18nextMock(mockOpts) },
     };
   }

   module.exports = { reactI18nextMock, withI18nMock };
   ```

   `createRendererServer` passes `noExternal` straight to `ssr.noExternal` (`test/lib/rendererTestHarness.js:100-120`), and `test/hooks/modelDownloadErrors.test.js` uses the same approach.

1. Create `scripts/merge-locale-keys.js`:

   ```js
   #!/usr/bin/env node
   // Deep-merges a per-locale fragment into every src/locales/<lang>/translation.json.
   // Usage: node scripts/merge-locale-keys.js <fragment.json> [localesRoot]
   // The fragment is { "en": {...}, "de": {...}, ... } and must cover every locale,
   // so a new key can never land in English only.
   const fs = require("node:fs");
   const path = require("node:path");

   const [fragmentPath, rootArg] = process.argv.slice(2);
   if (!fragmentPath) {
     console.error("Usage: node scripts/merge-locale-keys.js <fragment.json> [localesRoot]");
     process.exit(2);
   }
   const root = rootArg ?? path.join(__dirname, "..", "src", "locales");
   const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
   const langs = fs
     .readdirSync(root)
     .filter((d) => fs.existsSync(path.join(root, d, "translation.json")));
   const missing = langs.filter((lang) => !fragment[lang]);
   if (missing.length) {
     console.error(`Missing locales in fragment: ${missing.join(", ")}`);
     process.exit(1);
   }

   const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
   function merge(target, source) {
     for (const [key, value] of Object.entries(source)) {
       target[key] = isObject(value) ? merge(isObject(target[key]) ? target[key] : {}, value) : value;
     }
     return target;
   }

   for (const lang of langs) {
     const file = path.join(root, lang, "translation.json");
     const json = JSON.parse(fs.readFileSync(file, "utf8"));
     fs.writeFileSync(file, JSON.stringify(merge(json, fragment[lang]), null, 2) + "\n");
   }
   console.log(`Merged ${path.basename(fragmentPath)} into ${langs.length} locales.`);
   ```

2. In `src/types/electron.ts`, inside the `electronAPI` interface and after `downloadSearchModel` (`:675`), add:

   ```ts
       // Sealed mode (spec §5.4, Plan 07). Optional until Plan 07 ships the
       // preload namespace; the route graph reads it when present.
       privacy?: {
         getSealed: () => Promise<boolean>;
         onSealedChange: (callback: (sealed: boolean) => void) => (() => void) | void;
       };
   ```

3. Create `src/stores/routeFactsStore.ts`:

   ```ts
   import { create } from "zustand";
   import { localSttModelKey, type RouteFacts } from "../lib/routes";

   // Main-process facts the route resolver needs but the settings store does not
   // hold. Every call is optional and may reject (browser preview, older main);
   // a failed call leaves its fact null ("unknown"), which never downgrades a route.

   export interface RouteFactsApi {
     listWhisperModels?: () => Promise<{ models?: { model: string; downloaded: boolean }[] }>;
     listParakeetModels?: () => Promise<{ models?: { model: string; downloaded: boolean }[] }>;
     modelGetAll?: () => Promise<{ id: string; isDownloaded?: boolean }[]>;
     getDiarizationModelStatus?: () => Promise<{ modelsDownloaded: boolean }>;
     getSearchModelStatus?: () => Promise<{ downloaded: boolean }>;
     personalInference?: {
       codexStatus?: () => Promise<{ account?: unknown }>;
       credentialStatus?: (ref: string) => Promise<{ configured: boolean }>;
     };
     keyring?: { list?: () => Promise<{ provider: string; status: string }[]> };
     privacy?: {
       getSealed?: () => Promise<boolean>;
       onSealedChange?: (callback: (sealed: boolean) => void) => (() => void) | void;
     };
   }

   export const EMPTY_ROUTE_FACTS: RouteFacts = {
     installedModels: null,
     extraCredentials: new Set(),
     rejectedKeys: new Set(),
     speakerIdModelsReady: null,
     searchModelReady: null,
     sealed: false,
   };

   async function settle<T>(call: (() => Promise<T>) | undefined): Promise<T | undefined> {
     if (!call) return undefined;
     try {
       return await call();
     } catch {
       return undefined;
     }
   }

   const ENTERPRISE_REFS = ["bedrock", "azure", "vertex"] as const;

   export async function loadRouteFacts(api: RouteFactsApi | undefined): Promise<RouteFacts> {
     if (!api) return EMPTY_ROUTE_FACTS;
     const inference = api.personalInference;
     const credential = (ref: string) =>
       settle(inference?.credentialStatus && (() => inference.credentialStatus!(ref)));
     const [whisper, sherpa, llm, diarization, search, codex, keyring, sealed, ...enterprise] =
       await Promise.all([
         settle(api.listWhisperModels && (() => api.listWhisperModels!())),
         settle(api.listParakeetModels && (() => api.listParakeetModels!())),
         settle(api.modelGetAll && (() => api.modelGetAll!())),
         settle(api.getDiarizationModelStatus && (() => api.getDiarizationModelStatus!())),
         settle(api.getSearchModelStatus && (() => api.getSearchModelStatus!())),
         settle(inference?.codexStatus && (() => inference.codexStatus!())),
         settle(api.keyring?.list && (() => api.keyring!.list!())),
         settle(api.privacy?.getSealed && (() => api.privacy!.getSealed!())),
         ...ENTERPRISE_REFS.map((ref) => credential(ref)),
       ]);

     let installedModels: Set<string> | null = null;
     if (Array.isArray(whisper?.models) && Array.isArray(sherpa?.models) && Array.isArray(llm)) {
       installedModels = new Set<string>();
       for (const m of whisper.models) if (m.downloaded) installedModels.add(localSttModelKey("whisper", m.model));
       for (const m of sherpa.models) if (m.downloaded) installedModels.add(localSttModelKey("nvidia", m.model));
       for (const m of llm) if (m.isDownloaded) installedModels.add(`llm:${m.id}`);
     }

     const extraCredentials = new Set<string>();
     if (codex?.account) extraCredentials.add("codex");
     ENTERPRISE_REFS.forEach((ref, i) => {
       if (enterprise[i]?.configured) extraCredentials.add(ref);
     });

     return {
       installedModels,
       extraCredentials,
       rejectedKeys: new Set((keyring ?? []).filter((k) => k.status === "rejected").map((k) => k.provider)),
       speakerIdModelsReady: diarization ? diarization.modelsDownloaded : null,
       searchModelReady: search ? search.downloaded : null,
       sealed: sealed === true,
     };
   }

   export const useRouteFactsStore = create<{ facts: RouteFacts; loaded: boolean }>()(() => ({
     facts: EMPTY_ROUTE_FACTS,
     loaded: false,
   }));

   const currentApi = (): RouteFactsApi | undefined =>
     typeof window === "undefined" ? undefined : (window.electronAPI as RouteFactsApi | undefined);

   let generation = 0;
   export async function refreshRouteFacts(): Promise<void> {
     const mine = ++generation;
     const facts = await loadRouteFacts(currentApi());
     if (mine === generation) useRouteFactsStore.setState({ facts, loaded: true });
   }

   // One app-lifetime subscription per renderer window.
   let subscribed = false;
   export function ensureRouteFactsSubscribed(): void {
     if (subscribed || typeof window === "undefined") return;
     subscribed = true;
     void refreshRouteFacts();
     currentApi()?.privacy?.onSealedChange?.((sealed) => {
       useRouteFactsStore.setState((s) => ({ facts: { ...s.facts, sealed } }));
     });
     // Facts change on focus, after model downloads or deletes anywhere
     // (useModelDownload.ts:21-24, the cache clear) and after a key is saved
     // (settingsStore.ts:1351), which also resets a rejected key's verdict.
     for (const event of ["focus", "openwhispr-models-cleared", "openwhispr-local-models-changed", "api-key-changed"]) {
       window.addEventListener(event, () => void refreshRouteFacts());
     }
   }
   ```

   `routes.ts` imports only the *type* `RouteFacts` from this direction, and this file imports `localSttModelKey` from `routes.ts`. At runtime the cycle is one-way: `routes.ts` → `routeFactsStore.ts` (hooks) and `routeFactsStore.ts` → `routes.ts` (one function, used only inside `loadRouteFacts`, never at module evaluation). That is safe for ESM. Keep it that way: never call a `routes.ts` export at the top level of this file.

4. Append to `src/lib/routes.ts`. Add the new imports to the top of the file:

   ```ts
   import { useEffect, useMemo } from "react";
   import { useTranslation } from "react-i18next";
   import { useSettingsStore } from "../stores/settingsStore";
   import { ensureRouteFactsSubscribed, useRouteFactsStore } from "../stores/routeFactsStore";
   ```

   Then append at the end:

   ```ts
   // --- React hooks (§5.1) ---

   const SENDS_KEYS: readonly SendsKey[] = [
     "dictationStt", "noteRecordingStt", "uploadStt",
     "dictationCleanup", "voiceAssistant", "assistantVision",
     "translation", "noteFormatting", "chat",
     "voiceAssistantWithScreen",
   ];

   export function routeSendsCopy(t: (key: string) => string): Record<SendsKey, string> {
     return Object.fromEntries(SENDS_KEYS.map((id) => [id, t(`routes.sends.${id}`)])) as Record<SendsKey, string>;
   }

   export function useResolvedRoutes(): ResolvedRoute[] {
     const { t } = useTranslation();
     const settings = useSettingsStore();
     const facts = useRouteFactsStore((s) => s.facts);
     useEffect(() => {
       ensureRouteFactsSubscribed();
     }, []);
     const sends = useMemo(() => routeSendsCopy(t), [t]);
     return useMemo(() => resolveRoutes(buildRouteSnapshot(settings, facts, sends)), [settings, facts, sends]);
   }

   export function useResolvedRoute(id: RouteId): ResolvedRoute {
     const routes = useResolvedRoutes();
     return routes[ROUTE_IDS.indexOf(id)];
   }
   ```

   `useSettingsStore()` with no selector returns the state object, whose identity changes only when a setting changes. The `useMemo` therefore recomputes once per settings change, and consumers get a stable array between changes.

5. Write `/tmp/loqui-i18n-task-2.json` and merge it (see "i18n workflow" above). The `en` block is:

   ```json
   {
     "routes": {
       "groups": { "speech": "Speech", "text": "Text", "support": "This device only" },
       "names": {
         "dictationStt": "Dictation",
         "noteRecordingStt": "Note recording",
         "uploadStt": "Audio upload",
         "dictationCleanup": "Dictation cleanup",
         "voiceAssistant": "Voice assistant",
         "assistantVision": "Assistant vision",
         "translation": "Translation",
         "noteFormatting": "Note formatting",
         "chat": "Chat",
         "speakerId": "Speaker identification",
         "semanticSearch": "Semantic search"
       },
       "subtitles": {
         "dictationStt": "Tap-to-talk into any app",
         "noteRecordingStt": "Meetings and voice notes",
         "uploadStt": "Transcribe an imported file",
         "dictationCleanup": "Fix fillers and punctuation",
         "voiceAssistant": "Ask, then it answers",
         "assistantVision": "Screenshots sent with assistant requests",
         "translation": "Dictate in one language, paste in another",
         "noteFormatting": "Summaries and action items",
         "chat": "Ask questions about your notes",
         "speakerId": "Who said what in meetings",
         "semanticSearch": "Find notes by meaning"
       },
       "sends": {
         "dictationStt": "your audio and dictionary words",
         "noteRecordingStt": "meeting audio",
         "uploadStt": "the audio file",
         "dictationCleanup": "your transcript text",
         "voiceAssistant": "your request and clipboard context",
         "assistantVision": "a screenshot and your request",
         "translation": "the text you translate",
         "noteFormatting": "the meeting transcript",
         "chat": "your messages and note context",
         "voiceAssistantWithScreen": "your request, clipboard context and a screenshot"
       }
     }
   }
   ```

   The `sends` strings are inserted mid-sentence by later tasks ("Dictation now sends {{payload}} to OpenAI."). Translate them as noun phrases that fit after "sends", and keep them lower-case where the language allows it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/stores/routeFactsStore.test.js test/lib/routesHooks.test.js test/scripts/mergeLocaleKeys.test.js test/lib/routes.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS. Typecheck and i18n check are clean.

- [ ] **Step 5: Commit**

```bash
git add src/stores/routeFactsStore.ts src/lib/routes.ts src/types/electron.ts scripts/merge-locale-keys.js src/locales test/lib/i18nTestMock.js test/stores/routeFactsStore.test.js test/lib/routesHooks.test.js test/scripts/mergeLocaleKeys.test.js
git commit -m "feat(routes): Resolve routes from settings and main-process facts"
```

---

### Task 3: Settings paths, in-modal navigation and the support-models tab (SET-Q17)

Every `ResolvedRoute.settingsPath` (`"stt/dictation"`, `"llms/supportModels"`, …) must open Settings at that exact place, both from outside the modal (`ControlPanel`'s `onOpenSettings(section?: string)`) and from inside it (Patchbay rows, search results). This task also delivers SET-Q17: speaker identification and semantic search move out of Privacy & Data into a Language Models sub-tab, with their sizes.

**Files:**
- Create: `src/lib/settingsPaths.ts`
- Modify: `src/components/SettingsModal.tsx`. Move `SECTION_ALIASES` (`:12-26`) and `LEGACY_SUB_TAB` (`:28-38`) into the new module, and replace `resolveSection` (`:98-101`) and the two `LEGACY_SUB_TAB[...]` reads (`:107`, `:115`).
- Modify: `src/components/SettingsPage.tsx`:
  - `LlmTab` and `LLM_TABS` (`:741-756`);
  - `LlmsTabs` (`:844-892`);
  - the `llms` TabPanel (`:3159-3190`);
  - remove `<LocalSupportModels />` from `privacyData` (`:2757`);
  - the props interface (`:114-119`).
- Modify: `src/components/settings/LocalSupportModels.tsx`. Show sizes, and drop the misleading `localModels.ready` label.
- Modify: `src/locales/*/translation.json`
- Test: `test/lib/settingsPaths.test.js`, `test/components/localSupportModels.test.js`

**Interfaces:**
- Produces:

  ```ts
  // src/lib/settingsPaths.ts
  export interface SettingsLocation { section: SettingsSectionType; subTab?: string }
  export const SECTION_ALIASES: Record<string, SettingsSectionType>;
  export const LEGACY_SUB_TAB: Record<string, string>;
  export function parseSettingsPath(path: string | null | undefined): SettingsLocation;
  ```

- Produces the `SettingsPage` prop `onNavigateToPath?: (path: string) => void`. Tasks 7, 9 and 13 call it to jump inside the open modal.
- Produces `LlmTab` `"supportModels"`, the target of `ROUTE_SETTINGS_PATH.speakerId` and `.semanticSearch`.
- Calls `refreshRouteFacts()` (Task 2) after a support-model download.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/settingsPaths.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/settingsPaths.ts");

test("route paths open the right section and sub-tab", async () => {
  const { parseSettingsPath } = await load();
  assert.deepEqual(parseSettingsPath("stt/dictation"), { section: "speechToText", subTab: "dictation" });
  assert.deepEqual(parseSettingsPath("llms/supportModels"), { section: "llms", subTab: "supportModels" });
  assert.deepEqual(parseSettingsPath("privacyData"), { section: "privacyData" });
});

test("legacy deep links keep landing where they used to", async () => {
  const { parseSettingsPath } = await load();
  assert.deepEqual(parseSettingsPath("transcription"), { section: "speechToText", subTab: "dictation" });
  assert.deepEqual(parseSettingsPath("dictationAgent"), { section: "llms", subTab: "dictationAgent" });
  assert.deepEqual(parseSettingsPath("intelligence"), { section: "llms", subTab: "dictationCleanup" });
  assert.deepEqual(parseSettingsPath("developer"), { section: "system" });
});

test("unknown or empty paths fall back to Preferences instead of a blank page", async () => {
  const { parseSettingsPath } = await load();
  for (const p of [undefined, null, "", "nope", "nope/x", "/dictation"]) {
    assert.deepEqual(parseSettingsPath(p), { section: "general" }, String(p));
  }
});
```

Create `test/components/localSupportModels.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("support models show what they are, where they run and how big they are", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-support-models-test-" }, { t: "(k, o) => (o && o.size ? `${k}|${o.size}` : k)" })
  );
  const LocalSupportModels = (await vite.ssrLoadModule("/components/settings/LocalSupportModels.tsx")).default;
  const html = renderToStaticMarkup(React.createElement(LocalSupportModels));
  assert.match(html, /supportModels\.download\|34\.8 MB/);  // pyannote 6.6 MB + CAM++ 28.2 MB
  assert.match(html, /supportModels\.download\|91 MB/);
  assert.match(html, /locality\.device/);
  assert.doesNotMatch(html, /localModels\.ready/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/settingsPaths.test.js test/components/localSupportModels.test.js`
Expected: FAIL. `settingsPaths.ts` is missing, and the support-models markup has no sizes.

- [ ] **Step 3: Implement**

1. Create `src/lib/settingsPaths.ts`. Move the two maps verbatim from `SettingsModal.tsx:12-38`, keep their comment, and add the parser:

   ```ts
   import type { SettingsSectionType } from "../components/SettingsPage";

   // Settings locations are "<section>" or "<section>/<subTab>". Route
   // settingsPaths (src/lib/routes.ts) and every legacy deep link resolve here,
   // and anything unknown falls back to Preferences rather than a blank pane.

   export interface SettingsLocation {
     section: SettingsSectionType;
     subTab?: string;
   }

   export const SETTINGS_SECTIONS: readonly SettingsSectionType[] = [
     "general",
     "hotkeys",
     "speechToText",
     "llms",
     "privacyData",
     "system",
   ];

   // The old AI Models sidebar had four items (transcription, meetings,
   // intelligence, agentMode) — they now collapse into two: speechToText + llms.
   // Legacy deep-links land on the matching sub-tab via LEGACY_SUB_TAB.
   // "dictationAgent" is a live deep-link (the Home GPU banner), not a legacy alias.
   export const SECTION_ALIASES: Record<string, SettingsSectionType> = {
     aiModels: "llms",
     agentConfig: "llms",
     agentMode: "llms",
     dictationAgent: "llms",
     intelligence: "llms",
     meetings: "llms",
     prompts: "llms",
     transcription: "speechToText",
     uploadTranscription: "speechToText",
     softwareUpdates: "system",
     privacy: "privacyData",
     permissions: "privacyData",
     developer: "system",
     stt: "speechToText",
   };

   export const LEGACY_SUB_TAB: Record<string, string> = {
     transcription: "dictation",
     uploadTranscription: "upload",
     dictationAgent: "dictationAgent",
     meetings: "noteFormatting",
     intelligence: "dictationCleanup",
     agentMode: "chatIntelligence",
     agentConfig: "chatIntelligence",
     aiModels: "dictationCleanup",
     prompts: "dictationCleanup",
   };

   export function parseSettingsPath(path: string | null | undefined): SettingsLocation {
     if (!path) return { section: "general" };
     const [head, sub] = path.split("/", 2);
     const section = (SETTINGS_SECTIONS as readonly string[]).includes(head)
       ? (head as SettingsSectionType)
       : SECTION_ALIASES[head];
     if (!section) return { section: "general" };
     const subTab = sub || LEGACY_SUB_TAB[head];
     return subTab ? { section, subTab } : { section };
   }
   ```

2. In `src/components/SettingsModal.tsx`:
   - Delete the two maps and their comment (`:8-38`) and `resolveSection` (`:98-101`). Add `import { parseSettingsPath } from "../lib/settingsPaths";`.
   - Replace the state block (`:103-118`) with:

     ```tsx
     const initial = parseSettingsPath(initialSection);
     const [activeSection, setActiveSection] = React.useState<SettingsSectionType>(initial.section);
     const [initialSubTab, setInitialSubTab] = useState<string | undefined>(initial.subTab);
     const [prevOpen, setPrevOpen] = useState(open);

     if (open && !prevOpen && initialSection) {
       setPrevOpen(open);
       setActiveSection(initial.section);
       setInitialSubTab(initial.subTab);
     } else if (open !== prevOpen) {
       setPrevOpen(open);
       if (!open) setInitialSubTab(undefined);
     }

     const handleNavigateToPath = (path: string) => {
       const next = parseSettingsPath(path);
       setActiveSection(next.section);
       setInitialSubTab(next.subTab);
     };
     ```

   - Pass `onNavigateToPath={handleNavigateToPath}` to `<SettingsPage>`.

3. In `src/components/SettingsPage.tsx`:
   - Add `onNavigateToPath?: (path: string) => void;` to `SettingsPageProps` (`:114-119`) and destructure it in the component signature (`:963`). Later tasks pass it down.
   - Add `"supportModels"` as the last member of `LlmTab` and the last entry of `LLM_TABS`.
   - In `LlmsTabs`:
     - Add a `renderSupportModels: () => React.ReactNode` prop.
     - Add `{ id: "supportModels", name: t("settingsPage.llms.tabs.supportModels") }` as the last `subTabs` entry.
     - Add `if (id === "supportModels") return <HardDrive className="w-3.5 h-3.5" />;` before the final `return` in `renderIcon`. Import `HardDrive` from `./icons`.
     - Add `<TabPanel active={tab === "supportModels"}>{renderSupportModels()}</TabPanel>` after the chat panel.
   - In the `llms` TabPanel (`:3162`), pass `renderSupportModels={() => <LocalSupportModels />}`.
   - Delete `<LocalSupportModels />` from the `privacyData` case (`:2757`).

4. Rewrite the render part of `src/components/settings/LocalSupportModels.tsx`. Keep its state, effects and `download()`. After a successful download, add `void refreshRouteFacts();` (import it from `../../stores/routeFactsStore`). Above the component, add:

   ```tsx
   import modelRegistryData from "../../models/modelRegistryData.json";
   import { formatDecimalBytes } from "../../utils/formatBytes";
   import { LocalityRing } from "../ui/LocalityRing";

   // Sizes shown before download. Diarization is the sum of the registry
   // entries; the embedding model (all-MiniLM-L6-v2 ONNX plus tokenizer) is
   // fetched by scripts/download-minilm.js and is about 91 MB.
   const SUPPORT_MODEL_BYTES: Record<ModelKind, number> = {
     meeting: Object.values(modelRegistryData.diarizationModels).reduce(
       (sum, m) => sum + m.sizeMb * 1_000_000,
       0
     ),
     search: 91_000_000,
   };
   ```

   Then replace the returned JSX with:

   ```tsx
   return (
     <div className="space-y-3">
       <SectionHeader
         title={t("settingsPage.llms.supportModels.title")}
         description={t("settingsPage.llms.supportModels.description")}
       />
       <SettingsPanel>
         {(["meeting", "search"] as const).map((kind) => (
           <SettingsPanelRow key={kind}>
             <SettingsRow
               label={t(`personal.supportModels.${kind}`)}
               description={t(`personal.supportModels.${kind}Description`)}
             >
               <div className="flex items-center gap-2">
                 <LocalityRing locality="device" label={t("locality.device")} size={18} />
                 {ready[kind] ? (
                   <span className="text-xs font-medium text-success">
                     {t("settingsPage.llms.supportModels.downloaded")}
                   </span>
                 ) : (
                   <Button
                     size="sm"
                     variant="outline"
                     disabled={!!busy}
                     onClick={() => void download(kind)}
                   >
                     {busy === kind
                       ? t("personal.downloading")
                       : t("supportModels.download", {
                           size: formatDecimalBytes(SUPPORT_MODEL_BYTES[kind]),
                         })}
                   </Button>
                 )}
               </div>
             </SettingsRow>
           </SettingsPanelRow>
         ))}
       </SettingsPanel>
       {error && (
         <p role="alert" className="text-xs text-destructive">
           {error}
         </p>
       )}
     </div>
   );
   ```

   Import `SectionHeader` alongside the existing `SettingsSection` imports. Then add a decimal formatter to `src/utils/formatBytes.ts`. Model hosts publish decimal sizes ("34.8 MB", "91 MB"), and the existing `formatBytes` is 1024-based:

   ```ts
   // Decimal (1000-based) units, matching the sizes model hosts publish.
   export function formatDecimalBytes(bytes: number, decimals = 1): string {
     if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
     const units = ["B", "KB", "MB", "GB", "TB"];
     const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
     return `${parseFloat((bytes / 1000 ** i).toFixed(decimals))} ${units[i]}`;
   }
   ```

   Every later task that shows a model or file size uses `formatDecimalBytes`.

5. Write `/tmp/loqui-i18n-task-3.json` and merge it. The `en` block is:

   ```json
   {
     "settingsPage": {
       "llms": {
         "tabs": { "supportModels": "On-device support" },
         "supportModels": {
           "title": "On-device support models",
           "description": "Small models that always run on this device. Your recordings and notes never leave it for these tasks.",
           "downloaded": "Downloaded"
         }
       }
     },
     "supportModels": { "download": "Download {{size}}" }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/settingsPaths.test.js test/components/localSupportModels.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Then manually check: open Settings → Language Models. The "On-device support" tab exists, and Privacy & Data no longer shows the support models.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settingsPaths.ts src/components/SettingsModal.tsx src/components/SettingsPage.tsx src/components/settings/LocalSupportModels.tsx src/utils/formatBytes.ts src/locales test/lib/settingsPaths.test.js test/components/localSupportModels.test.js
git commit -m "feat(settings): Route deep links and on-device support models tab"
```

---

### Task 4: Route chips and an honest mode selector (SET-Q4)

"Active" means "mode selected", not "usable" (SET-04). This task does three things:
- It replaces "Active" with "Current" plus the route's real state chip.
- It makes the mode selector a real radio group: `role="radiogroup"`/`radio`, `aria-checked`, roving tab stop, arrow keys.
- It ships the two chip primitives every later screen uses.

**Files:**
- Create: `src/components/settings/routing/RouteChips.tsx`
- Create: `src/components/ui/rovingNav.ts`
- Modify: `src/components/ui/SettingsSection.tsx`. Rework `InferenceModeSelector` (`:111-197`).
- Modify: `src/components/ui/ModelCardList.tsx:172-176`. Change "Active" to "Selected".
- Modify: `src/components/icons/index.ts`. Add `WifiOff` and `Laptop`.
- Modify: `src/lib/routes.ts`. Add `SCOPE_ROUTE` and `STT_CONTEXT_ROUTE`.
- Modify these four call sites to pass `label` and `routeState`:
  - `src/components/SettingsPage.tsx:638`
  - `src/components/settings/MeetingSettings.tsx:145`
  - `src/components/settings/UploadSettings.tsx:124`
  - `src/components/settings/InferenceConfigEditor.tsx:156`
- Modify: `src/locales/*/translation.json`
- Modify: `test/components/plumNight.test.js` (Plan 01's). Extend contrast coverage to the surfaces Settings uses (Plan 01 review item 4).
- Test: `test/components/routeChips.test.js`, `test/components/inferenceModeSelector.test.js`, `test/components/rovingNav.test.js`, `test/components/plumNight.test.js`

**Interfaces:**
- Consumes:
  - `RouteState`, `ResolvedRoute` and `useResolvedRoute` (Tasks 1–2);
  - `LocalityRing` and the `locality.*` keys (Plan 01);
  - `formatDecimalBytes` (Task 3).
- Produces:

  ```ts
  // src/components/settings/routing/RouteChips.tsx
  export function routeStateLabel(state: RouteState, t: TFunction): string;
  export function RouteStateChip(props: { state: RouteState; className?: string }): JSX.Element;
  export function RouteDestinationChip(props: { route: Pick<ResolvedRoute, "locality" | "providerId" | "model">; className?: string }): JSX.Element;
  // src/components/ui/rovingNav.ts
  export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";
  export function stepLinear(index: number, key: string, disabled: readonly boolean[]): number;  // returns index unchanged for other keys
  // src/lib/routes.ts (additive)
  export const SCOPE_ROUTE: Record<LlmRouteScope, RouteId>;
  export const STT_CONTEXT_ROUTE: Record<SttContext, RouteId>;
  // InferenceModeSelector gains props:
  //   label: string                    (radiogroup accessible name)
  //   routeState?: RouteState          (state of the applied mode's route)
  //   stagedMode?: InferenceMode|null  (Task 6; shows "Staged, not active")
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/components/plumNight.test.js`. It reuses that file's `css`, `load` and `resolveTokens`. Plan 01 checks text roles only on background, card, surface-raised and surface-window, but route chips, the Patchbay, the keyring, the cartridges and the storage list sit on popover, muted, secondary and surface-1 to surface-3:

```js
const SETTINGS_SURFACES = [
  "--color-popover",
  "--color-muted",
  "--color-secondary",
  "--color-surface-1",
  "--color-surface-2",
  "--color-surface-3",
];

test("Plum Night text roles meet 4.5:1 on the settings surfaces", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  const texts = [
    "--color-foreground",
    "--color-muted-foreground",
    "--color-popover-foreground",
    "--color-secondary-foreground",
    "--color-link",
    "--color-destructive",
    "--color-locality-device",
    "--color-locality-network",
    "--color-locality-remote",
  ];
  for (const t of texts)
    for (const s of SETTINGS_SURFACES) {
      const ratio = contrastRatio(dark[t], dark[s]);
      assert.ok(ratio >= 4.5, `${t} on ${s} is ${ratio}:1`);
    }
});

test("Plum Night non-text roles (ring, locality jacks, status dots) meet 3:1 on the settings surfaces", async () => {
  const { contrastRatio } = await load();
  const { dark } = resolveTokens(css);
  const marks = ["--color-ring", "--color-locality-device", "--color-locality-network", "--color-locality-remote", "--color-warning", "--color-destructive"];
  for (const m of marks)
    for (const s of SETTINGS_SURFACES) {
      const ratio = contrastRatio(dark[m], dark[s]);
      assert.ok(ratio >= 3, `${m} on ${s} is ${ratio}:1`);
    }
});
```

These pass against the tokens shipped at `172f9df`. The measured minimums are 5.82:1 for text (`--color-destructive` on `surface-3`) and 5.16:1 for the ring. They are pinned so that a later token change cannot regress the settings surfaces silently.

Create `test/components/rovingNav.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/rovingNav.ts");

test("linear roving focus skips disabled items and wraps", async () => {
  const { stepLinear } = await load();
  const disabled = [false, true, false];
  assert.equal(stepLinear(0, "ArrowDown", disabled), 2);
  assert.equal(stepLinear(2, "ArrowDown", disabled), 0);
  assert.equal(stepLinear(0, "ArrowUp", disabled), 2);
  assert.equal(stepLinear(2, "ArrowRight", disabled), 0);
  assert.equal(stepLinear(2, "Home", disabled), 0);
  assert.equal(stepLinear(0, "End", disabled), 2);
  assert.equal(stepLinear(0, "Tab", disabled), 0);
  assert.equal(stepLinear(0, "ArrowDown", [true, true]), 0);
});
```

Create `test/components/routeChips.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("route chips", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-route-chips-test-" }, { withOptions: true }));
  const chips = await vite.ssrLoadModule("/components/settings/routing/RouteChips.tsx");
  const tr = (k, o) => (o ? `${k}${JSON.stringify(o)}` : k);

  await t.test("every state has words, never colour alone", () => {
    assert.equal(chips.routeStateLabel({ status: "ready" }, tr), "routes.state.ready");
    assert.equal(chips.routeStateLabel({ status: "off" }, tr), "routes.state.off");
    assert.equal(chips.routeStateLabel({ status: "needsModel", sizeBytes: 1329766560 }, tr), 'routes.state.download{"size":"1.3 GB"}');
    assert.equal(chips.routeStateLabel({ status: "needsModel" }, tr), "routes.state.chooseModel");
    assert.equal(chips.routeStateLabel({ status: "needsKey", provider: "Groq" }, tr), "routes.state.addKey");
    assert.equal(chips.routeStateLabel({ status: "needsKey", provider: "" }, tr), "routes.state.chooseProvider");
    assert.equal(chips.routeStateLabel({ status: "needsUrl" }, tr), "routes.state.addUrl");
    assert.equal(chips.routeStateLabel({ status: "unreachable", detail: "sealed" }, tr), "routes.state.sealed");
    assert.equal(chips.routeStateLabel({ status: "unreachable", detail: "retired" }, tr), "routes.state.retired");
    assert.equal(chips.routeStateLabel({ status: "unreachable", detail: "192.168.1.20" }, tr), 'routes.state.cantReach{"host":"192.168.1.20"}');
    assert.equal(chips.routeStateLabel({ status: "unreachable" }, tr), "routes.state.cantReachUnknown");
  });

  await t.test("the state chip carries a glyph and data-state for styling", () => {
    const html = renderToStaticMarkup(React.createElement(chips.RouteStateChip, { state: { status: "needsKey", provider: "Groq" } }));
    assert.match(html, /data-state="needsKey"/);
    assert.match(html, /<svg/);
    assert.match(html, /routes\.state\.addKey/);
  });

  await t.test("the destination chip shows ring shape, provider and model", () => {
    const remote = renderToStaticMarkup(
      React.createElement(chips.RouteDestinationChip, { route: { locality: "remote", provider: "Groq", providerId: "groq", model: "gpt-oss-120b" } })
    );
    assert.match(remote, /data-locality="remote"/);
    assert.match(remote, /Groq · gpt-oss-120b/);
    const device = renderToStaticMarkup(
      React.createElement(chips.RouteDestinationChip, { route: { locality: "device", provider: null, providerId: null, model: "Qwen3.5 2B" } })
    );
    assert.match(device, /locality\.device · Qwen3\.5 2B/);
  });
});
```

Create `test/components/inferenceModeSelector.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("mode selector is a radio group that tells the truth about the current route", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-mode-selector-test-" }));
  const { InferenceModeSelector } = await vite.ssrLoadModule("/components/ui/SettingsSection.tsx");
  const modes = [
    { id: "providers", label: "Cloud", description: "d", icon: null },
    { id: "local", label: "Local", description: "d", icon: null },
    { id: "self-hosted", label: "Self-hosted", description: "d", icon: null, disabled: true, badge: "Soon" },
  ];
  const html = renderToStaticMarkup(
    React.createElement(InferenceModeSelector, {
      label: "Dictation runs on",
      modes,
      activeMode: "local",
      onSelect: () => {},
      routeState: { status: "needsModel", sizeBytes: 680000000 },
      stagedMode: "providers",
    })
  );
  assert.match(html, /role="radiogroup"[^>]*aria-label="Dictation runs on"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  // The staged choice is the checked radio (R3 B); the applied one is labelled "Current".
  assert.match(html, /aria-checked="true"[^>]*tabindex="0"[^>]*>[\s\S]*?Cloud/);
  assert.match(html, /Local<\/span><span[^>]*>routes\.selection\.current/);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, "one tab stop");
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /routes\.selection\.current/);
  assert.match(html, /routes\.state\.download/);
  assert.match(html, /routes\.selection\.staged/);
  assert.doesNotMatch(html, /common\.active/);
});
```

The third assertion depends on attribute order. Render the button with `role`, `aria-checked` and `tabIndex` as its first three props in that order so the regex is stable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/rovingNav.test.js test/components/routeChips.test.js test/components/inferenceModeSelector.test.js`
Expected: FAIL. The modules are missing, and the selector has no `role="radiogroup"`.

- [ ] **Step 3: Implement**

1. Create `src/components/ui/rovingNav.ts`:

   ```ts
   // Roving-tabindex arrow handling for radio groups and option grids.
   // Pure, so keyboard behaviour is testable without a DOM.

   export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

   export function stepLinear(index: number, key: string, disabled: readonly boolean[]): number {
     const n = disabled.length;
     if (n === 0 || disabled.every(Boolean)) return index;
     const enabled = (i: number) => !disabled[i];
     const scan = (from: number, dir: 1 | -1) => {
       let i = from;
       for (let step = 0; step < n; step++) {
         i = (i + dir + n) % n;
         if (enabled(i)) return i;
       }
       return index;
     };
     switch (key) {
       case "ArrowDown":
       case "ArrowRight":
         return scan(index, 1);
       case "ArrowUp":
       case "ArrowLeft":
         return scan(index, -1);
       case "Home":
         return scan(n - 1, 1);
       case "End":
         return scan(0, -1);
       default:
         return index;
     }
   }
   ```

2. Add to `src/components/icons/index.ts`, keeping alphabetical order:

   ```ts
   export const Laptop = createIcon("laptop", Lucide.Laptop);
   export const WifiOff = createIcon("wifi-off", Lucide.WifiOff);
   ```

3. Append to `src/lib/routes.ts`, after `ROUTE_SETTINGS_PATH`:

   ```ts
   export const SCOPE_ROUTE: Record<LlmRouteScope, RouteId> = {
     dictationCleanup: "dictationCleanup",
     dictationAgent: "voiceAssistant",
     dictationAgentVision: "assistantVision",
     dictationTranslation: "translation",
     noteFormatting: "noteFormatting",
     chatIntelligence: "chat",
   };

   export const STT_CONTEXT_ROUTE: Record<SttContext, RouteId> = {
     dictation: "dictationStt",
     meeting: "noteRecordingStt",
     upload: "uploadStt",
   };
   ```

   Move the `SttContext` and `LlmRouteScope` type declarations above these constants if TypeScript complains about use before declaration. Type aliases are hoisted, so it should not complain.

4. Create `src/components/settings/routing/RouteChips.tsx`:

   ```tsx
   import type { TFunction } from "i18next";
   import { useTranslation } from "react-i18next";
   import type { ResolvedRoute, RouteState } from "../../../lib/routes";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { formatDecimalBytes } from "../../../utils/formatBytes";
   import { cn } from "../../lib/utils";
   import { CircleCheck, Download, KeyRound, Lock, Minus, Server, WifiOff } from "../../icons";
   import { LocalityRing } from "../../ui/LocalityRing";

   // Route chips (DESIGN.md "Settings · Routing"): a state is always glyph plus
   // words. Colour is a third, redundant cue.

   export function routeStateLabel(state: RouteState, t: TFunction | ((k: string, o?: object) => string)): string {
     switch (state.status) {
       case "ready":
         return t("routes.state.ready");
       case "off":
         return t("routes.state.off");
       case "needsModel":
         return state.sizeBytes
           ? t("routes.state.download", { size: formatDecimalBytes(state.sizeBytes) })
           : t("routes.state.chooseModel");
       case "needsKey":
         return state.provider ? t("routes.state.addKey") : t("routes.state.chooseProvider");
       case "needsUrl":
         return t("routes.state.addUrl");
       case "unreachable":
         if (state.detail === "sealed") return t("routes.state.sealed");
         if (state.detail === "retired") return t("routes.state.retired");
         return state.detail
           ? t("routes.state.cantReach", { host: state.detail })
           : t("routes.state.cantReachUnknown");
     }
   }

   const STATE_STYLE: Record<RouteState["status"], string> = {
     ready: "text-locality-device",
     off: "text-muted-foreground",
     needsModel: "text-foreground",
     needsKey: "text-destructive",
     needsUrl: "text-destructive",
     unreachable: "text-destructive",
   };

   function StateGlyph({ state }: { state: RouteState }) {
     const cls = "h-3 w-3 shrink-0";
     switch (state.status) {
       case "ready":
         return <CircleCheck className={cls} aria-hidden="true" />;
       case "off":
         return <Minus className={cls} aria-hidden="true" />;
       case "needsModel":
         return <Download className={cls} aria-hidden="true" />;
       case "needsKey":
         return <KeyRound className={cls} aria-hidden="true" />;
       case "needsUrl":
         return <Server className={cls} aria-hidden="true" />;
       case "unreachable":
         return state.detail === "sealed" ? (
           <Lock className={cls} aria-hidden="true" />
         ) : (
           <WifiOff className={cls} aria-hidden="true" />
         );
     }
   }

   export function RouteStateChip({ state, className }: { state: RouteState; className?: string }) {
     const { t } = useTranslation();
     const sealed = state.status === "unreachable" && state.detail === "sealed";
     return (
       <span
         data-state={state.status}
         className={cn(
           "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium tabular-nums",
           sealed ? "text-muted-foreground" : STATE_STYLE[state.status],
           className
         )}
       >
         <StateGlyph state={state} />
         {routeStateLabel(state, t)}
       </span>
     );
   }

   export function RouteDestinationChip({
     route,
     className,
   }: {
     route: Pick<ResolvedRoute, "locality" | "providerId" | "model">;
     className?: string;
   }) {
     const { t } = useTranslation();
     // Plan 01: provider names in UI go through providerDisplayLabel so
     // "Custom endpoint" and "Unknown provider" are localised.
     const providerName = route.providerId ? providerDisplayLabel(route.providerId, t) : null;
     const place =
       route.locality === "remote"
         ? (providerName ?? t("routes.place.chooseProvider"))
         : t(`locality.${route.locality}`);
     const ringLabel =
       route.locality === "remote"
         ? t("locality.remote", { provider: providerName ?? "" })
         : t(`locality.${route.locality}`);
     return (
       <span className={cn("inline-flex h-6 min-w-0 max-w-[260px] items-center gap-1.5 text-xs font-medium", className)}>
         <LocalityRing locality={route.locality} label={ringLabel} provider={providerName} size={16} />
         <span className="truncate" dir="auto">
           {route.model ? `${place} · ${route.model}` : place}
         </span>
       </span>
     );
   }
   ```

   `text-locality-device` exists because Plan 01 registers `--color-locality-device` in `@theme`, and it passes contrast in both themes. `text-destructive` is `#dc2626`, which is 4.83:1 on white. Do not use `text-success` or `text-warning` for text: they measure 3.3:1 and 3.2:1 on white.

5. Rework `InferenceModeSelector` in `src/components/ui/SettingsSection.tsx` (`:111-197`). Keep `InferenceModeOption`, and replace the component with:

   ```tsx
   export function InferenceModeSelector({
     label,
     modes,
     activeMode,
     onSelect,
     routeState,
     stagedMode = null,
   }: {
     label: string;
     modes: InferenceModeOption[];
     activeMode: InferenceMode;
     onSelect: (mode: InferenceMode) => void;
     routeState?: RouteState;
     stagedMode?: InferenceMode | null;
   }) {
     const { t } = useTranslation();
     const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
     const checkedId = stagedMode ?? activeMode;
     const checkedIndex = Math.max(0, modes.findIndex((m) => m.id === checkedId));
     const disabled = modes.map((m) => !!m.disabled);

     const onKeyDown = (event: React.KeyboardEvent, index: number) => {
       const next = stepLinear(index, event.key, disabled);
       if (next === index) return;
       event.preventDefault();
       refs.current[next]?.focus();
       onSelect(modes[next].id);
     };

     return (
       <SettingsPanel className="overflow-hidden">
         <div role="radiogroup" aria-label={label}>
           {modes.map((mode, index) => {
             const isChecked = checkedId === mode.id;
             const isCurrent = activeMode === mode.id;
             const isStaged = stagedMode === mode.id && stagedMode !== activeMode;
             const isDisabled = !!mode.disabled;
             return (
               <SettingsPanelRow
                 key={mode.id}
                 className={`transition-colors ${isDisabled ? "" : "hover:bg-foreground/3 dark:hover:bg-white/3"}`}
               >
                 <button
                   role="radio"
                   aria-checked={isChecked}
                   tabIndex={index === checkedIndex ? 0 : -1}
                   type="button"
                   aria-disabled={isDisabled || undefined}
                   ref={(el) => {
                     refs.current[index] = el;
                   }}
                   onClick={() => !isDisabled && onSelect(mode.id)}
                   onKeyDown={(e) => onKeyDown(e, index)}
                   className={`w-full flex items-center gap-3 text-start cursor-pointer group rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                 >
                   <div
                     className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                       isChecked
                         ? "bg-primary/10 dark:bg-primary/15"
                         : "bg-muted/60 dark:bg-surface-raised group-hover:bg-muted dark:group-hover:bg-surface-3"
                     }`}
                   >
                     <div className={`transition-colors ${isChecked ? "text-primary" : "text-muted-foreground"}`}>
                       {mode.icon}
                     </div>
                   </div>
                   <div className="flex-1 min-w-0">
                     <div className="flex flex-wrap items-center gap-2">
                       <span className="text-xs font-medium text-foreground">{mode.label}</span>
                       {isCurrent && !isDisabled && (
                         <span className="text-xs font-medium text-foreground bg-muted px-1.5 py-px rounded-sm">
                           {t("routes.selection.current")}
                         </span>
                       )}
                       {isCurrent && routeState && <RouteStateChip state={routeState} className="h-5 px-0" />}
                       {isStaged && (
                         <span className="text-xs font-medium text-locality-remote border border-dashed border-locality-remote px-1.5 py-px rounded-sm">
                           {t("routes.selection.staged")}
                         </span>
                       )}
                       {isDisabled && mode.badge && (
                         <span className="text-xs text-muted-foreground bg-muted/80 dark:bg-surface-3 px-1.5 py-px rounded-sm">
                           {mode.badge}
                         </span>
                       )}
                     </div>
                     <p className="text-xs text-muted-foreground/80 mt-0.5">{mode.description}</p>
                   </div>
                   <div
                     aria-hidden="true"
                     className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
                       isChecked ? "border-primary bg-primary" : "border-border-hover dark:border-border-subtle"
                     }`}
                   >
                     {isChecked && (
                       <div className="w-full h-full flex items-center justify-center">
                         <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                       </div>
                     )}
                   </div>
                 </button>
               </SettingsPanelRow>
             );
           })}
         </div>
       </SettingsPanel>
     );
   }
   ```

   Imports to add to `SettingsSection.tsx`:
   - `import { stepLinear } from "./rovingNav";`
   - `import { RouteStateChip } from "../settings/routing/RouteChips";`
   - `import type { RouteState } from "../../lib/routes";`

   The orange radio dot stays, because selection is one of the three places orange is allowed.

6. Wire the four call sites. Each one adds a `label` and the applied route's state:

   | File:line | Route hook | `label` key |
   |---|---|---|
   | `SettingsPage.tsx:638` (inside `TranscriptionSection`) | `useResolvedRoute("dictationStt")` | `routes.runsOn` with `{ task: t("routes.names.dictationStt") }` |
   | `MeetingSettings.tsx:145` | `useResolvedRoute("noteRecordingStt")` | same, with `noteRecordingStt` |
   | `UploadSettings.tsx:124` | `useResolvedRoute("uploadStt")` | same, with `uploadStt` |
   | `InferenceConfigEditor.tsx:156` | `useResolvedRoute(SCOPE_ROUTE[scope])` | same, with `SCOPE_ROUTE[scope]` |

   Each passes `routeState={route.state}`. Example for `InferenceConfigEditor`:

   ```tsx
   const route = useResolvedRoute(SCOPE_ROUTE[scope as LlmRouteScope]);
   // …
   <InferenceModeSelector
     label={t("routes.runsOn", { task: t(`routes.names.${route.id}`) })}
     modes={modes}
     activeMode={effectiveMode}
     onSelect={handleModeSelect}
     routeState={route.state}
   />
   ```

7. In `src/components/ui/ModelCardList.tsx:172-176`, change `{t("common.active")}` to `{t("routes.selection.selected")}`. The card itself is replaced for local models in Task 10, but cloud model lists keep `ModelCardList`.

8. Write `/tmp/loqui-i18n-task-4.json` and merge it. The `en` block is:

   ```json
   {
     "routes": {
       "runsOn": "{{task}} runs on",
       "place": { "chooseProvider": "Choose a provider" },
       "selection": { "current": "Current", "selected": "Selected", "staged": "Staged, not active" },
       "state": {
         "ready": "Ready",
         "off": "Off",
         "download": "Download {{size}}",
         "chooseModel": "Choose a model",
         "addKey": "Add API key",
         "chooseProvider": "Choose a provider",
         "addUrl": "Add server URL",
         "sealed": "Paused · Sealed mode",
         "retired": "Service retired · choose again",
         "cantReach": "Can't reach {{host}}",
         "cantReachUnknown": "Can't reach the server"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/rovingNav.test.js test/components/routeChips.test.js test/components/inferenceModeSelector.test.js test/components/plumNight.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

Then manually check: in Settings → Speech-to-Text, Tab moves into the mode list once, ↑/↓ move the selection, and an empty local model shows "Current · Choose a model".

- [ ] **Step 5: Commit**

```bash
git add test/components/plumNight.test.js src/components/ui/rovingNav.ts src/components/settings/routing/RouteChips.tsx src/components/ui/SettingsSection.tsx src/components/ui/ModelCardList.tsx src/components/icons/index.ts src/lib/routes.ts src/components/SettingsPage.tsx src/components/settings/MeetingSettings.tsx src/components/settings/UploadSettings.tsx src/components/settings/InferenceConfigEditor.tsx src/locales test/components/rovingNav.test.js test/components/routeChips.test.js test/components/inferenceModeSelector.test.js
git commit -m "feat(settings): Route state chips and a radio-group mode selector"
```

---

### Task 5: Route targets and the draft store: instant local, staged remote, undo (SET-R3 B core, SET-Q10 copy)

Every way of changing a route goes through this one module: the mode selectors (Task 6), the Patchbay (Task 7) and search results (Task 13). The rules are:
- A `local` target applies instantly and returns an Undo.
- Any other target is staged as the single draft. Apply re-validates against the *live* snapshot at click time.
- Apply is blocked unless the previewed route would be ready. The only exceptions are a remote text route that still needs a model choice, and a provider whose sign-in happens after switching (Codex, Bedrock, Azure, Vertex).
- No write happens anywhere else as a side effect.

**Files:**
- Create: `src/lib/routeTargets.ts` (pure)
- Create: `src/stores/routeDraftStore.ts`
- Modify: `src/locales/*/translation.json`
- Test: `test/lib/routeTargets.test.js`, `test/stores/routeDraftStore.test.js`

**Interfaces:**
- Consumes, from Tasks 1–2: `RouteSettingsSnapshot`, `resolveRoute`, `buildRouteSnapshot`, `routeSendsCopy`, `SCOPE_ROUTE`, `useRouteFactsStore` and `SendsKey`.
- Consumes these store setters (`src/stores/settingsStore.ts`, interface lines in parentheses):
  - `setTranscriptionMode`, `setUseLocalWhisper`, `updateTranscriptionSettings` (`:1128`), `setCloudTranscriptionMode` and `setRemoteTranscriptionUrl`;
  - `setMeetingTranscriptionMode` (`:929`), `setMeetingUseLocalWhisper` (`:930`), `setMeetingCloudTranscriptionMode` (`:938`) and `setMeetingRemoteTranscriptionUrl` (`:940`);
  - `setUploadTranscriptionMode` (`:942`), `setUploadUseLocalWhisper` (`:943`) and `setUploadCloudTranscriptionMode` (`:951`);
  - `switchCloudTranscriptionProvider(context, providerId)` (`:993`) and `switchReasoningProvider(scope, providerId, fallbackModel?)` (`:997`);
  - `setCloudTranscriptionModel`, `setMeetingCloudTranscriptionModel` (`:936`), `setCloudTranscriptionBaseUrl`, `setMeetingCloudTranscriptionBaseUrl` (`:937`) and `setUploadCloudTranscriptionBaseUrl` (`:950`);
  - `setUseDictationAgentVisionModel`;
  - the exported `setResolvedLLMConfig(scope, patch)` (`:2676`).
- Produces:

  ```ts
  // src/lib/routeTargets.ts
  export type RouteTarget =
    | { mode: "local" }
    | { mode: "providers"; provider: string; model?: string; baseUrl?: string } // baseUrl: "custom" only
    | { mode: "self-hosted"; remoteUrl: string };
  export type ApplyBlocker = "needsKey" | "chooseProvider" | "needsUrl" | "needsModel" | "sealed";
  export const ENTERPRISE_PROVIDERS: ReadonlySet<string>;      // bedrock, azure, vertex → mode "enterprise"
  export const SETUP_AFTER_APPLY: ReadonlySet<string>;         // codex + enterprise: sign-in happens after switching
  export function defaultCloudModel(provider: string, kind: "speech" | "text"): string;
  export function targetFromSnapshot(s: RouteSettingsSnapshot, id: RouteId): RouteTarget;
  export function withRouteTarget(s: RouteSettingsSnapshot, id: RouteId, target: RouteTarget): RouteSettingsSnapshot;
  export function previewRoute(s: RouteSettingsSnapshot, id: RouteId, target: RouteTarget): ResolvedRoute;
  export function applyBlocker(preview: ResolvedRoute, target: RouteTarget): ApplyBlocker | null;
  export function routeChangeMessage(route: Pick<ResolvedRoute, "id" | "locality" | "providerId" | "sends" | "state">, t: (k: string, o?: Record<string, unknown>) => string): { title: string; description?: string };
  // src/stores/routeDraftStore.ts
  export interface RouteDraft { routeId: RouteId; target: RouteTarget }
  export const useRouteDraftStore: UseBoundStore<StoreApi<{ draft: RouteDraft | null; stage(d: RouteDraft): void; discard(): void }>>;
  export function currentRouteSnapshot(sends: Record<SendsKey, string>): RouteSettingsSnapshot;
  export function writeRouteTarget(id: RouteId, target: RouteTarget): void;
  export interface RouteChangeOutcome { applied: boolean; blocker: ApplyBlocker | null; route: ResolvedRoute; undo?: () => void }
  export function commitRouteChange(id: RouteId, target: RouteTarget, sends: Record<SendsKey, string>): RouteChangeOutcome;
  export function requestRouteChange(id: RouteId, target: RouteTarget, sends: Record<SendsKey, string>): RouteChangeOutcome | "staged";  // no-op outcome when target equals the current one
  export function applyDraft(sends: Record<SendsKey, string>): RouteChangeOutcome | null;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/lib/routeTargets.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");

const SENDS = Object.fromEntries(
  ["dictationStt", "noteRecordingStt", "uploadStt", "dictationCleanup", "voiceAssistant", "assistantVision", "translation", "noteFormatting", "chat"].map((id) => [id, `sends:${id}`])
);
const stt = (o = {}) => ({ mode: "local", localProvider: "whisper", localModel: "base", cloudProvider: "", cloudModel: "", cloudBaseUrl: "", remoteUrl: "", remoteModel: "", ...o });
const llm = (o = {}) => ({ mode: "local", provider: "qwen", model: "qwen3.5-2b-q4_k_m", remoteUrl: "", cloudBaseUrl: "", ...o });
const base = (o = {}) => ({
  stt: { dictation: stt(), meeting: stt(), upload: stt() },
  llm: { dictationCleanup: llm(), dictationAgent: llm(), dictationAgentVision: llm(), dictationTranslation: llm(), noteFormatting: llm(), chatIntelligence: llm() },
  enabled: { cleanup: false, voiceAssistant: true, screenContext: true, visionOverride: false, translation: true, speakerId: true },
  savedKeys: new Set(o.savedKeys ?? []),
  rejectedKeys: new Set(),
  installedModels: new Set(["whisper:base", "llm:qwen3.5-2b-q4_k_m"]),
  models: {},
  speakerIdModelsReady: true,
  searchModelReady: true,
  sealed: o.sealed ?? false,
  sends: SENDS,
});

test("route targets", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-route-targets-test-" });
  const rt = await vite.ssrLoadModule("/lib/routeTargets.ts");

  await t.test("previewing a cloud target shows the remote destination without touching the input snapshot", () => {
    const s = base({ savedKeys: ["openai"] });
    const p = rt.previewRoute(s, "dictationStt", { mode: "providers", provider: "openai" });
    assert.equal(p.locality, "remote");
    assert.equal(p.provider, "OpenAI");
    assert.deepEqual(p.state, { status: "ready" });
    assert.equal(s.stt.dictation.mode, "local", "input snapshot is not mutated");
  });

  await t.test("a preview of an off route shows the destination's readiness, not 'off'", () => {
    const p = rt.previewRoute(base(), "dictationCleanup", { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" });
    assert.equal(p.locality, "network");
    assert.notEqual(p.state.status, "off");
  });

  await t.test("vision targets switch the override on and enterprise providers use enterprise mode", () => {
    const s = rt.withRouteTarget(base(), "assistantVision", { mode: "providers", provider: "bedrock" });
    assert.equal(s.enabled.visionOverride, true);
    assert.equal(s.llm.dictationAgentVision.mode, "enterprise");
    assert.equal(s.llm.dictationAgentVision.provider, "bedrock");
  });

  await t.test("apply blockers", () => {
    const s = base();
    const block = (id, target, snap = s) => rt.applyBlocker(rt.previewRoute(snap, id, target), target);
    assert.equal(block("dictationStt", { mode: "providers", provider: "openai" }), "needsKey");
    assert.equal(block("dictationStt", { mode: "providers", provider: "" }), "chooseProvider");
    assert.equal(block("translation", { mode: "self-hosted", remoteUrl: "" }), "needsUrl");
    assert.equal(block("chat", { mode: "providers", provider: "codex" }), null, "Codex signs in after switching");
    assert.equal(block("chat", { mode: "providers", provider: "openai", model: "" }, base({ savedKeys: ["openai"] })), null, "model is chosen after switching");
    assert.equal(block("dictationStt", { mode: "providers", provider: "openai" }, base({ savedKeys: ["openai"], sealed: true })), "sealed");
    assert.equal(block("translation", { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" }), null);
  });

  await t.test("targetFromSnapshot round-trips the current configuration", () => {
    const s = base({ savedKeys: ["groq"] });
    s.llm.chatIntelligence = llm({ mode: "providers", provider: "groq", model: "openai/gpt-oss-120b" });
    assert.deepEqual(rt.targetFromSnapshot(s, "chat"), { mode: "providers", provider: "groq", model: "openai/gpt-oss-120b", baseUrl: "" });
    assert.deepEqual(rt.targetFromSnapshot(s, "dictationStt"), { mode: "local" });
  });

  await t.test("change messages name the destination and the payload", () => {
    const tr = (k, o) => `${k}${o ? JSON.stringify(o) : ""}`;
    const remote = { id: "dictationStt", locality: "remote", providerId: "openai", sends: "sends:dictationStt", state: { status: "ready" } };
    assert.equal(rt.routeChangeMessage(remote, tr).title, 'routes.toast.remote{"task":"routes.names.dictationStt","payload":"sends:dictationStt","provider":"OpenAI"}');
    const local = { id: "chat", locality: "device", providerId: null, sends: null, state: { status: "needsModel" } };
    const m = rt.routeChangeMessage(local, tr);
    assert.equal(m.title, 'routes.toast.local{"task":"routes.names.chat"}');
    assert.equal(m.description, "routes.toast.chooseModel");
    const off = { id: "dictationCleanup", locality: "remote", providerId: "openai", sends: null, state: { status: "off" } };
    assert.deepEqual(rt.routeChangeMessage(off, tr), {
      title: 'routes.toast.whenOn{"task":"routes.names.dictationCleanup","destination":"OpenAI"}',
    });
  });

  await t.test("default cloud models follow the registry's default rule", () => {
    const { cloudProviders } = require("../../src/models/modelRegistryData.json");
    const tinfoil = cloudProviders.find((p) => p.id === "tinfoil");
    assert.equal(rt.defaultCloudModel("openai", "text"), cloudProviders.find((p) => p.id === "openai").models[0].id);
    assert.equal(rt.defaultCloudModel("tinfoil", "text"), tinfoil.defaultModel ?? tinfoil.models[0].id);
    assert.equal(rt.defaultCloudModel("codex", "text"), "");
  });

  await t.test("upload's self-hosted preview keeps the dictation server", () => {
    const s = base();
    s.stt.upload = stt({ remoteUrl: "http://192.168.1.5:8178" });
    const next = rt.withRouteTarget(s, "uploadStt", { mode: "self-hosted", remoteUrl: "http://elsewhere:1" });
    assert.equal(next.stt.upload.remoteUrl, "http://192.168.1.5:8178");
  });
});
```

Create `test/stores/routeDraftStore.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const SENDS = Object.fromEntries(
  ["dictationStt", "noteRecordingStt", "uploadStt", "dictationCleanup", "voiceAssistant", "assistantVision", "translation", "noteFormatting", "chat"].map((id) => [id, id])
);

test("route draft store", async (t) => {
  installBrowserGlobals(t, { initialStorage: { transcriptionMode: "local", useLocalWhisper: "true", chatAgentMode: "local" } });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-route-draft-test-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore, EMPTY_ROUTE_FACTS } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const draft = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const settings = () => useSettingsStore.getState();
  const setFacts = (patch) => useRouteFactsStore.setState({ facts: { ...EMPTY_ROUTE_FACTS, ...patch }, loaded: true });

  await t.test("toward remote without a key is refused and nothing is written", () => {
    useSettingsStore.setState({ openaiApiKey: "" });
    const out = draft.commitRouteChange("dictationStt", { mode: "providers", provider: "openai" }, SENDS);
    assert.equal(out.applied, false);
    assert.equal(out.blocker, "needsKey");
    assert.equal(settings().transcriptionMode, "local");
  });

  await t.test("toward remote with a key applies, names the destination and can be undone", () => {
    useSettingsStore.setState({ openaiApiKey: "__stored__" });
    const out = draft.commitRouteChange("dictationStt", { mode: "providers", provider: "openai" }, SENDS);
    assert.equal(out.applied, true);
    assert.equal(out.route.locality, "remote");
    assert.equal(settings().transcriptionMode, "providers");
    assert.equal(settings().useLocalWhisper, false);
    assert.equal(settings().cloudTranscriptionProvider, "openai");
    out.undo();
    assert.equal(settings().transcriptionMode, "local");
    assert.equal(settings().useLocalWhisper, true);
  });

  await t.test("requestRouteChange applies local instantly and stages everything else", () => {
    useSettingsStore.setState({ openaiApiKey: "__stored__" });
    assert.equal(draft.requestRouteChange("chat", { mode: "providers", provider: "openai" }, SENDS), "staged");
    assert.deepEqual(draft.useRouteDraftStore.getState().draft, { routeId: "chat", target: { mode: "providers", provider: "openai" } });
    assert.equal(settings().chatAgentMode, "local", "staging writes nothing");
    const local = draft.requestRouteChange("noteFormatting", { mode: "local" }, SENDS);
    assert.equal(typeof local, "object", "local is never staged");
    assert.equal(local.blocker, null);
    assert.equal(settings().noteFormattingMode, "local");
    assert.deepEqual(draft.useRouteDraftStore.getState().draft, { routeId: "chat", target: { mode: "providers", provider: "openai" } }, "a local change on another route keeps the draft");
  });

  await t.test("apply re-validates against the live snapshot", () => {
    useSettingsStore.setState({ openaiApiKey: "" });
    const out = draft.applyDraft(SENDS);
    assert.equal(out.applied, false);
    assert.equal(out.blocker, "needsKey");
    assert.ok(draft.useRouteDraftStore.getState().draft, "a refused apply keeps the draft");
  });

  await t.test("a sealed snapshot blocks apply for remote targets but not local moves", () => {
    useSettingsStore.setState({ openaiApiKey: "__stored__" });
    setFacts({ sealed: true });
    assert.equal(draft.applyDraft(SENDS).blocker, "sealed");
    const local = draft.commitRouteChange("chat", { mode: "local" }, SENDS);
    assert.equal(local.applied, true);
    setFacts({ sealed: false });
  });

  await t.test("a successful apply clears the draft and writes the text route", () => {
    const out = draft.applyDraft(SENDS);
    assert.equal(out.applied, true);
    assert.equal(draft.useRouteDraftStore.getState().draft, null);
    assert.equal(settings().chatAgentMode, "providers");
    assert.equal(settings().chatAgentProvider, "openai");
    assert.ok(settings().chatAgentModel, "a default model was chosen");
  });

  await t.test("undoing a move away from a provider stages the provider instead of applying it", () => {
    const providerModel = settings().chatAgentModel;
    const out = draft.commitRouteChange("chat", { mode: "local" }, SENDS);
    assert.equal(out.applied, true);
    assert.equal(settings().chatAgentMode, "local");
    out.undo();
    assert.equal(settings().chatAgentMode, "local", "nothing remote is applied by Undo");
    const staged = draft.useRouteDraftStore.getState().draft;
    assert.equal(staged.routeId, "chat");
    assert.equal(staged.target.provider, "openai");
    assert.equal(staged.target.model, providerModel);
    draft.useRouteDraftStore.getState().discard();
  });

  await t.test("re-selecting the current destination is a no-op that drops that route's draft", () => {
    draft.useRouteDraftStore.getState().stage({ routeId: "chat", target: { mode: "providers", provider: "groq" } });
    const before = { ...settings() };
    const out = draft.requestRouteChange("chat", { mode: "local" }, SENDS);
    assert.equal(out.applied, false);
    assert.equal(out.blocker, null);
    assert.equal(draft.useRouteDraftStore.getState().draft, null);
    assert.equal(settings().chatAgentProvider, before.chatAgentProvider, "nothing was cleared");
  });

  await t.test("staging a different change replaces the draft; discard clears it", () => {
    draft.useRouteDraftStore.getState().stage({ routeId: "translation", target: { mode: "self-hosted", remoteUrl: "" } });
    draft.useRouteDraftStore.getState().stage({ routeId: "dictationStt", target: { mode: "providers", provider: "groq" } });
    assert.equal(draft.useRouteDraftStore.getState().draft.routeId, "dictationStt");
    draft.useRouteDraftStore.getState().discard();
    assert.equal(draft.useRouteDraftStore.getState().draft, null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/lib/routeTargets.test.js test/stores/routeDraftStore.test.js`
Expected: FAIL. Both modules are missing.

- [ ] **Step 3: Implement**

1. Create `src/lib/routeTargets.ts`:

   ```ts
   import modelRegistryData from "../models/modelRegistryData.json";
   import { pickDefaultModelId } from "../models/providerDefaultModel";
   import { providerDisplayLabel } from "./locality";
   import {
     resolveRoute,
     type LlmRouteScope,
     type ResolvedRoute,
     type RouteId,
     type RouteSettingsSnapshot,
     type SttContext,
   } from "./routes";

   // A RouteTarget is "where should this task run": the only vocabulary the
   // Patchbay, the mode selectors and search use to change a route. Pure.

   export type RouteTarget =
     | { mode: "local" }
     | { mode: "providers"; provider: string; model?: string; baseUrl?: string } // baseUrl: "custom" only
     | { mode: "self-hosted"; remoteUrl: string };

   export type ApplyBlocker = "needsKey" | "chooseProvider" | "needsUrl" | "needsModel" | "sealed";

   export const ENTERPRISE_PROVIDERS: ReadonlySet<string> = new Set(["bedrock", "azure", "vertex"]);
   // These sign in inside the provider editor, which appears once the route is
   // switched. Applying first sends nothing: there are no credentials yet.
   export const SETUP_AFTER_APPLY: ReadonlySet<string> = new Set(["codex", ...ENTERPRISE_PROVIDERS]);

   const STT_CONTEXT: Partial<Record<RouteId, SttContext>> = {
     dictationStt: "dictation",
     noteRecordingStt: "meeting",
     uploadStt: "upload",
   };
   const LLM_SCOPE: Partial<Record<RouteId, LlmRouteScope>> = {
     dictationCleanup: "dictationCleanup",
     voiceAssistant: "dictationAgent",
     assistantVision: "dictationAgentVision",
     translation: "dictationTranslation",
     noteFormatting: "noteFormatting",
     chat: "chatIntelligence",
   };
   const ENABLED_FLAG: Partial<Record<RouteId, keyof RouteSettingsSnapshot["enabled"]>> = {
     dictationCleanup: "cleanup",
     voiceAssistant: "voiceAssistant",
     translation: "translation",
   };

   interface RegistryProvider { id: string; models?: { id: string }[]; defaultModel?: string }

   // Same rule as the store and onboarding (src/models/providerDefaultModel.ts):
   // the registry's named default wins, otherwise the first (best) model.
   export function defaultCloudModel(provider: string, kind: "speech" | "text"): string {
     const pools: RegistryProvider[][] =
       kind === "speech"
         ? [modelRegistryData.transcriptionProviders as RegistryProvider[]]
         : [modelRegistryData.cloudProviders as RegistryProvider[], modelRegistryData.enterpriseProviders as RegistryProvider[]];
     for (const pool of pools) {
       const id = pickDefaultModelId(pool.find((p) => p.id === provider));
       if (id) return id;
     }
     return "";
   }

   export function targetFromSnapshot(s: RouteSettingsSnapshot, id: RouteId): RouteTarget {
     const context = STT_CONTEXT[id];
     if (context) {
       const i = s.stt[context];
       if (i.mode === "local") return { mode: "local" };
       if (i.mode === "self-hosted") return { mode: "self-hosted", remoteUrl: i.remoteUrl };
       return { mode: "providers", provider: i.cloudProvider, model: i.cloudModel, baseUrl: i.cloudBaseUrl };
     }
     const scope = LLM_SCOPE[id];
     if (!scope) return { mode: "local" };
     const i = s.llm[scope];
     if (i.mode === "local") return { mode: "local" };
     if (i.mode === "self-hosted") return { mode: "self-hosted", remoteUrl: i.remoteUrl };
     return { mode: "providers", provider: i.provider, model: i.model, baseUrl: i.cloudBaseUrl };
   }

   export function withRouteTarget(s: RouteSettingsSnapshot, id: RouteId, target: RouteTarget): RouteSettingsSnapshot {
     const next: RouteSettingsSnapshot = {
       ...s,
       stt: { ...s.stt },
       llm: { ...s.llm },
       enabled: { ...s.enabled },
     };
     const flag = ENABLED_FLAG[id];
     if (flag) next.enabled[flag] = true; // previews show readiness, not "off"
     const context = STT_CONTEXT[id];
     if (context) {
       const cur = s.stt[context];
       next.stt[context] =
         target.mode === "local"
           ? { ...cur, mode: "local" }
           : target.mode === "self-hosted"
             ? // Upload has no server URL of its own; it always uses dictation's.
               { ...cur, mode: "self-hosted", remoteUrl: context === "upload" ? cur.remoteUrl : target.remoteUrl }
             : {
                 ...cur,
                 mode: "providers",
                 cloudProvider: target.provider,
                 cloudModel: target.model ?? defaultCloudModel(target.provider, "speech"),
                 cloudBaseUrl: target.baseUrl ?? cur.cloudBaseUrl,
               };
       return next;
     }
     const scope = LLM_SCOPE[id];
     if (!scope) return next;
     if (id === "assistantVision") {
       next.enabled.visionOverride = true;
       next.enabled.screenContext = true;
     }
     const cur = s.llm[scope];
     next.llm[scope] =
       target.mode === "local"
         ? { ...cur, mode: "local" }
         : target.mode === "self-hosted"
           ? { ...cur, mode: "self-hosted", remoteUrl: target.remoteUrl }
           : {
               ...cur,
               mode: ENTERPRISE_PROVIDERS.has(target.provider) ? "enterprise" : "providers",
               provider: target.provider,
               model: target.model ?? defaultCloudModel(target.provider, "text"),
               cloudBaseUrl: target.baseUrl ?? cur.cloudBaseUrl,
             };
     return next;
   }

   export function previewRoute(s: RouteSettingsSnapshot, id: RouteId, target: RouteTarget): ResolvedRoute {
     return resolveRoute(withRouteTarget(s, id, target), id);
   }

   export function applyBlocker(preview: ResolvedRoute, target: RouteTarget): ApplyBlocker | null {
     const st = preview.state;
     switch (st.status) {
       case "ready":
       case "off":
         return null;
       case "unreachable":
         return "sealed";
       case "needsUrl":
         return "needsUrl";
       case "needsModel":
         // A remote text route picks its model in the provider editor after
         // switching; a local download is never implied by Apply.
         return preview.locality !== "device" && st.sizeBytes === undefined ? null : "needsModel";
       case "needsKey":
         if (!st.provider) return "chooseProvider";
         return target.mode === "providers" && SETUP_AFTER_APPLY.has(target.provider) ? null : "needsKey";
     }
   }

   export function routeChangeMessage(
     route: Pick<ResolvedRoute, "id" | "locality" | "providerId" | "sends" | "state">,
     t: (k: string, o?: Record<string, unknown>) => string
   ): { title: string; description?: string } {
     const task = t(`routes.names.${route.id}`);
     const provider = route.providerId ? providerDisplayLabel(route.providerId, t) : "";
     if (route.state.status === "off") {
       // Configuring an off task sends nothing yet; say where it will go.
       const destination =
         route.locality === "device" ? t("locality.device") : route.locality === "network" ? t("locality.network") : provider;
       return { title: t("routes.toast.whenOn", { task, destination }) };
     }
     const payload = route.sends ?? "";
     const title =
       route.locality === "device"
         ? t("routes.toast.local", { task })
         : route.locality === "network"
           ? t("routes.toast.network", { task, payload })
           : t("routes.toast.remote", { task, payload, provider });
     const description =
       route.state.status === "needsModel"
         ? t("routes.toast.chooseModel")
         : route.state.status === "needsKey"
           ? t("routes.toast.signInNext", { provider })
           : undefined;
     return description ? { title, description } : { title };
   }
   ```

2. Create `src/stores/routeDraftStore.ts`:

   ```ts
   import { create } from "zustand";
   import {
     buildRouteSnapshot,
     resolveRoute,
     type RouteId,
     type RouteSettingsSnapshot,
     type SendsKey,
   } from "../lib/routes";
   import {
     applyBlocker,
     defaultCloudModel,
     ENTERPRISE_PROVIDERS,
     previewRoute,
     targetFromSnapshot,
     type ApplyBlocker,
     type RouteTarget,
   } from "../lib/routeTargets";
   import { selectResolvedLLMConfig, setResolvedLLMConfig, useSettingsStore } from "./settingsStore";
   import { useRouteFactsStore } from "./routeFactsStore";
   import { localLlmProviderIds } from "../lib/localLlmProviders";
   import type { ResolvedRoute } from "../lib/routes";

   // The single place that changes where a task runs (SET-R3 B). Moving toward
   // this device applies instantly with Undo; anything else is a draft until
   // the user applies it. Rule: no provider or model changes as a side effect.

   export interface RouteDraft {
     routeId: RouteId;
     target: RouteTarget;
   }

   export const useRouteDraftStore = create<{
     draft: RouteDraft | null;
     stage: (draft: RouteDraft) => void;
     discard: () => void;
   }>()((set) => ({
     draft: null,
     stage: (draft) => set({ draft }),
     discard: () => set({ draft: null }),
   }));

   export function currentRouteSnapshot(sends: Record<SendsKey, string>): RouteSettingsSnapshot {
     return buildRouteSnapshot(useSettingsStore.getState(), useRouteFactsStore.getState().facts, sends);
   }

   type LlmScope =
     | "dictationCleanup" | "dictationAgent" | "dictationAgentVision"
     | "dictationTranslation" | "noteFormatting" | "chatIntelligence";
   const LLM_SCOPE: Partial<Record<RouteId, LlmScope>> = {
     dictationCleanup: "dictationCleanup",
     voiceAssistant: "dictationAgent",
     assistantVision: "dictationAgentVision",
     translation: "dictationTranslation",
     noteFormatting: "noteFormatting",
     chat: "chatIntelligence",
   };

   function writeStt(id: RouteId, target: RouteTarget) {
     const s = useSettingsStore.getState();
     const local = target.mode === "local";
     if (id === "dictationStt") {
       // Mirrors SettingsPage.tsx handleTranscriptionModeSelect.
       s.setTranscriptionMode(target.mode);
       s.setUseLocalWhisper(local);
       s.updateTranscriptionSettings({ useLocalWhisper: local });
       s.setCloudTranscriptionMode("byok");
       if (target.mode === "providers") {
         s.switchCloudTranscriptionProvider("dictation", target.provider);
         if (target.model) s.setCloudTranscriptionModel(target.model);
         if (target.baseUrl !== undefined) s.setCloudTranscriptionBaseUrl(target.baseUrl);
       }
       if (target.mode === "self-hosted") s.setRemoteTranscriptionUrl(target.remoteUrl);
       return;
     }
     if (id === "noteRecordingStt") {
       s.setMeetingTranscriptionMode(target.mode);
       s.setMeetingUseLocalWhisper(local);
       s.setMeetingCloudTranscriptionMode("byok");
       if (target.mode === "providers") {
         s.switchCloudTranscriptionProvider("meeting", target.provider);
         if (target.model) s.setMeetingCloudTranscriptionModel(target.model);
         if (target.baseUrl !== undefined) s.setMeetingCloudTranscriptionBaseUrl(target.baseUrl);
       }
       if (target.mode === "self-hosted") s.setMeetingRemoteTranscriptionUrl(target.remoteUrl);
       return;
     }
     // uploadStt: upload's self-hosted mode always uses the dictation server
     // URL (UploadSettings.tsx), so never write a URL from here — that would
     // silently re-point dictation.
     s.setUploadTranscriptionMode(target.mode);
     s.setUploadUseLocalWhisper(local);
     s.setUploadCloudTranscriptionMode("byok");
     if (target.mode === "providers") {
       s.switchCloudTranscriptionProvider("upload", target.provider);
       if (target.baseUrl !== undefined) s.setUploadCloudTranscriptionBaseUrl(target.baseUrl);
     }
   }

   function writeLlm(scope: LlmScope, id: RouteId, target: RouteTarget) {
     const s = useSettingsStore.getState();
     const isVision = id === "assistantVision";
     if (isVision) {
       if (target.mode !== "providers") throw new Error("Assistant vision is cloud-only");
       s.setUseDictationAgentVisionModel(true);
       s.switchReasoningProvider(scope, target.provider, target.model ?? defaultCloudModel(target.provider, "text"));
       return;
     }
     if (target.mode === "local") {
       const cfg = selectResolvedLLMConfig(useSettingsStore.getState(), scope);
       if (cfg.mode === "local") return; // already local: never clear a working selection
       // Mirrors InferenceConfigEditor.handleModeSelect: a cloud provider is
       // not valid in local mode, so clear it and let the user pick a model.
       const keep = localLlmProviderIds.has(cfg.provider);
       setResolvedLLMConfig(scope, keep ? { mode: "local", cloudMode: "byok" } : { mode: "local", cloudMode: "byok", provider: "", model: "" });
       return;
     }
     if (target.mode === "self-hosted") {
       setResolvedLLMConfig(scope, { mode: "self-hosted", cloudMode: "byok", remoteUrl: target.remoteUrl });
       window.electronAPI?.llamaServerStop?.();
       return;
     }
     setResolvedLLMConfig(scope, {
       mode: ENTERPRISE_PROVIDERS.has(target.provider) ? "enterprise" : "providers",
       cloudMode: "byok",
       ...(target.baseUrl !== undefined ? { cloudBaseUrl: target.baseUrl } : {}),
     });
     s.switchReasoningProvider(scope, target.provider, target.model ?? defaultCloudModel(target.provider, "text"));
   }

   export function writeRouteTarget(id: RouteId, target: RouteTarget): void {
     if (id === "speakerId" || id === "semanticSearch") throw new Error(`${id} is local-only`);
     const scope = LLM_SCOPE[id];
     if (scope) writeLlm(scope, id, target);
     else writeStt(id, target);
   }

   export interface RouteChangeOutcome {
     applied: boolean;
     blocker: ApplyBlocker | null;
     route: ResolvedRoute;
     undo?: () => void;
   }

   export function commitRouteChange(
     id: RouteId,
     target: RouteTarget,
     sends: Record<SendsKey, string>
   ): RouteChangeOutcome {
     const before = currentRouteSnapshot(sends);
     if (target.mode !== "local") {
       const blocker = applyBlocker(previewRoute(before, id, target), target);
       if (blocker) return { applied: false, blocker, route: previewRoute(before, id, target) };
     }
     const previous = targetFromSnapshot(before, id);
     const previousVisionOverride = useSettingsStore.getState().useDictationAgentVisionModel;
     writeRouteTarget(id, target);
     // A change on this route supersedes any draft for it.
     if (useRouteDraftStore.getState().draft?.routeId === id) useRouteDraftStore.getState().discard();
     const route = resolveRoute(currentRouteSnapshot(sends), id);
     const undo = () => {
       if (id === "assistantVision") {
         useSettingsStore.getState().setUseDictationAgentVisionModel(previousVisionOverride);
         if (!previousVisionOverride) return;
       }
       if (previous.mode === "local") {
         writeRouteTarget(id, previous);
         return;
       }
       // Undoing back to a server or provider is still a move toward remote:
       // stage it so the Apply bar shows what will be sent, instead of applying it.
       useRouteDraftStore.getState().stage({ routeId: id, target: previous });
     };
     return { applied: true, blocker: null, route, undo };
   }

   function sameTarget(current: RouteTarget, next: RouteTarget): boolean {
     if (current.mode !== next.mode) return false;
     if (current.mode === "local") return true;
     if (current.mode === "self-hosted" && next.mode === "self-hosted") {
       return current.remoteUrl.trim() === next.remoteUrl.trim();
     }
     if (current.mode === "providers" && next.mode === "providers") {
       return (
         current.provider === next.provider &&
         (next.model === undefined || current.model === next.model) &&
         (next.baseUrl === undefined || current.baseUrl === next.baseUrl)
       );
     }
     return false;
   }

   export function requestRouteChange(
     id: RouteId,
     target: RouteTarget,
     sends: Record<SendsKey, string>
   ): RouteChangeOutcome | "staged" {
     const snapshot = currentRouteSnapshot(sends);
     if (sameTarget(targetFromSnapshot(snapshot, id), target)) {
       // Re-selecting where the task already runs changes nothing and cancels its draft.
       if (useRouteDraftStore.getState().draft?.routeId === id) useRouteDraftStore.getState().discard();
       return { applied: false, blocker: null, route: resolveRoute(snapshot, id) };
     }
     if (target.mode === "local") return commitRouteChange(id, target, sends);
     useRouteDraftStore.getState().stage({ routeId: id, target });
     return "staged";
   }

   export function applyDraft(sends: Record<SendsKey, string>): RouteChangeOutcome | null {
     const draft = useRouteDraftStore.getState().draft;
     if (!draft) return null;
     const outcome = commitRouteChange(draft.routeId, draft.target, sends);
     if (outcome.applied) useRouteDraftStore.getState().discard();
     return outcome;
   }
   ```

   The local-provider check needs the set the store builds at `settingsStore.ts:76-78`. It is not exported. Create `src/lib/localLlmProviders.ts` and make the store import it, so there is one source:

   ```ts
   import modelRegistryData from "../models/modelRegistryData.json";

   // Local LLM families (qwen, mistral, llama, …) from the registry.
   export const localLlmProviderIds: ReadonlySet<string> = new Set(
     modelRegistryData.localProviders.map((provider) => provider.id)
   );
   ```

   In `settingsStore.ts`, replace the declaration at `:76-78` with `import { localLlmProviderIds } from "../lib/localLlmProviders";`. The only use is at `:315`, and it does not change.

3. Write `/tmp/loqui-i18n-task-5.json` and merge it. The `en` block is:

   ```json
   {
     "routes": {
       "toast": {
         "whenOn": "{{task}} will use {{destination}} when you turn it on.",
         "local": "{{task}} now runs on this device.",
         "network": "{{task}} now sends {{payload}} to your server.",
         "remote": "{{task}} now sends {{payload}} to {{provider}}.",
         "chooseModel": "Choose a model to finish.",
         "signInNext": "Sign in to {{provider}} next. Nothing is sent until you do.",
         "undo": "Undo"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/lib/routeTargets.test.js test/stores/routeDraftStore.test.js test/lib/routes.test.js && npm run typecheck && npm run i18n:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routeTargets.ts src/lib/localLlmProviders.ts src/stores/routeDraftStore.ts src/stores/settingsStore.ts src/locales test/lib/routeTargets.test.js test/stores/routeDraftStore.test.js
git commit -m "feat(routes): Stage remote route changes, apply local ones instantly"
```

---

### Task 6: Stage, review, apply in the editors (SET-R3 B UI, SET-Q10)

Switching a route to Cloud or Self-hosted no longer happens on click. Instead:
- The radio shows the staged choice with "Staged, not active".
- A dashed panel asks "Send dictation to a cloud provider?" and lets the user pick a provider, add a key or enter a URL.
- A sticky bar at the bottom of the modal says exactly what will leave the device, and holds the only primary button: Apply.

Switching to Local stays instant, with a toast that names the destination and an Undo. Cloud opens with no provider chosen, which fixes SET-13. Every mode toast names the destination and payload (SET-Q10).

**Files:**
- Create: `src/components/settings/routing/providerCatalog.ts` (pure)
- Create: `src/components/settings/routing/StagedRoutePanel.tsx`
- Create: `src/components/settings/routing/StagedRouteBar.tsx`
- Create: `src/components/settings/routing/useRouteChange.ts`
- Modify: `src/lib/routes.ts`. Export the key-field map as `PROVIDER_KEY_FIELDS`.
- Modify: `src/stores/routeDraftStore.ts`. Add `stagedTargetForMode` and `withDraftDiscard`.
- Modify: `src/components/ui/SidebarModal.tsx`. Add a `footer` slot rendered sticky at the bottom of the content column (`:243-259`).
- Modify: `src/components/SettingsModal.tsx`. Discard the draft on close, and render the bar.
- Modify the four mode handlers so they use `useRouteChange`, render the panel, and pass `stagedMode`:
  - `src/components/SettingsPage.tsx`: `handleTranscriptionModeSelect` (`:526-548`), plus `CLEANUP_MODE_TOAST_KEY` and `handleCleanupModeChange` (`:677-716`);
  - `src/components/settings/MeetingSettings.tsx:87-95`;
  - `src/components/settings/UploadSettings.tsx:68-75`;
  - `src/components/settings/InferenceConfigEditor.tsx:97-124`.
- Modify: `src/locales/*/translation.json`. Add `staging.*`, and delete the now-unused `settingsPage.transcription.toasts.{switchedProviders,switchedLocal,switchedSelfHosted}` and `settingsPage.aiModels.toasts.{switchedProviders,switchedLocal,switchedSelfHosted}`. Grep first, and delete only keys with no remaining `t(` reference.
- Test: `test/components/providerCatalog.test.js`, `test/components/stagedRoute.test.js`

**Interfaces:**
- Consumes, from Task 5: `RouteTarget`, `previewRoute`, `applyBlocker`, `routeChangeMessage`, `useRouteDraftStore`, `requestRouteChange`, `applyDraft` and `currentRouteSnapshot`.
- Consumes, from Task 4: `RouteDestinationChip`, `InferenceModeSelector`'s `stagedMode` prop, and `ApiKeyInput` (`src/components/ui/ApiKeyInput.tsx`, props `{ apiKey, setApiKey, label?, ariaLabel?, placeholder?, helpText? }`).
- Consumes `useToast().toast` (`src/components/ui/useToast.ts:44`) with `actions: ToastActionConfig[]` (`{ label, onClick, dismissOnClick? }`). Plan 04 migrates this call site to `notify()` (spec §5.3).
- Produces:

  ```ts
  // providerCatalog.ts
  export type ProviderCapability = "speech" | "text" | "vision";
  export function capabilityOf(id: RouteId): ProviderCapability | null;   // null for support routes
  export function providersForRoute(id: RouteId): string[];               // provider ids that can run this task; "custom" last where allowed
  export function providerHost(providerId: string): string | null;        // e.g. "api.openai.com", for copy
  // routeDraftStore.ts (additive)
  export function stagedTargetForMode(mode: InferenceMode, current: RouteTarget): RouteTarget;
  export function withDraftDiscard(onOpenChange: (open: boolean) => void): (open: boolean) => void;
  // useRouteChange.ts
  export function useRouteChange(): {
    request: (id: RouteId, target: RouteTarget) => void;   // instant+toast for local, stage otherwise
    apply: () => RouteChangeOutcome | null;                  // toast on success
    sends: Record<SendsKey, string>;
  };
  // StagedRouteBar.tsx
  export function StagedRouteBarView(props: { preview: ResolvedRoute; host: string | null; blocker: ApplyBlocker | null; onApply: () => void; onDiscard: () => void }): JSX.Element;
  export function StagedRouteBar(): JSX.Element | null;
  // StagedRoutePanel.tsx
  export function StagedRoutePanelView(props: StagedRoutePanelViewProps): JSX.Element;   // see code
  export function StagedRoutePanel(props: { routeId: RouteId }): JSX.Element | null;
  // src/lib/routes.ts (additive)
  export const PROVIDER_KEY_FIELDS: Record<string, keyof SettingsState>;   // the former KEY_FIELDS plus corti: "cortiApiKey"
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/providerCatalog.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

test("provider catalog", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-provider-catalog-test-" });
  const c = await vite.ssrLoadModule("/components/settings/routing/providerCatalog.ts");

  await t.test("capabilities follow the route kind", () => {
    assert.equal(c.capabilityOf("uploadStt"), "speech");
    assert.equal(c.capabilityOf("chat"), "text");
    assert.equal(c.capabilityOf("assistantVision"), "vision");
    assert.equal(c.capabilityOf("semanticSearch"), null);
  });

  await t.test("dictation offers every registry speech provider plus custom, never text-only services", () => {
    const speech = c.providersForRoute("dictationStt");
    assert.ok(speech.includes("openai") && speech.includes("deepgram"));
    assert.ok(!speech.includes("anthropic") && !speech.includes("codex"));
    assert.equal(speech.at(-1), "custom");
  });

  await t.test("note recording offers only the streaming providers main runs; upload drops realtime-only ones", () => {
    const notes = c.providersForRoute("noteRecordingStt");
    assert.ok(notes.every((p) => ["openai", "assemblyai", "deepgram", "corti", "tinfoil"].includes(p)));
    assert.ok(!notes.includes("custom"));
    const upload = c.providersForRoute("uploadStt");
    assert.ok(!upload.includes("deepgram") && !upload.includes("assemblyai"));
    assert.ok(upload.includes("openai"));
  });

  await t.test("vision providers are the ones with a vision-capable model", () => {
    const vision = c.providersForRoute("assistantVision");
    assert.ok(vision.includes("openai"));
    assert.ok(!vision.includes("codex"));
    assert.ok(!vision.includes("custom"));
    assert.deepEqual(c.providersForRoute("semanticSearch"), []);
  });

  await t.test("hosts are known for registry providers", () => {
    assert.equal(c.providerHost("openai"), "api.openai.com");
    assert.equal(c.providerHost("custom"), null);
  });
});
```

Create `test/components/stagedRoute.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("staged route UI", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-staged-route-test-" }, { withOptions: true }));
  const bar = await vite.ssrLoadModule("/components/settings/routing/StagedRouteBar.tsx");
  const panel = await vite.ssrLoadModule("/components/settings/routing/StagedRoutePanel.tsx");
  const draft = await vite.ssrLoadModule("/stores/routeDraftStore.ts");

  const preview = {
    id: "dictationStt", kind: "speech", locality: "remote", provider: "OpenAI", providerId: "openai", model: "GPT-4o Mini Transcribe",
    state: { status: "ready" }, sends: "your audio and dictionary words", settingsPath: "stt/dictation",
  };

  await t.test("the bar says what leaves the device and Apply is the only primary action", () => {
    const html = renderToStaticMarkup(React.createElement(bar.StagedRouteBarView, { preview, host: "api.openai.com", blocker: null, onApply() {}, onDiscard() {} }));
    assert.match(html, /role="region"/);
    assert.match(html, /OpenAI · GPT-4o Mini Transcribe/);
    assert.match(html, /dir="ltr"[^>]*>api\.openai\.com</, "the bar names the host that receives the data");
    assert.match(html, /staging\.leaves\{&quot;payload&quot;:&quot;your audio and dictionary words&quot;\}/);
    assert.match(html, /staging\.apply/);
    assert.match(html, /<kbd[^>]*>.*↵<\/kbd>/);
    assert.doesNotMatch(html, /data-variant="live"/, "Apply is never orange");
    assert.doesNotMatch(html, /disabled=""/);
  });

  await t.test("a blocked apply is disabled and says why", () => {
    const html = renderToStaticMarkup(React.createElement(bar.StagedRouteBarView, {
      preview: { ...preview, state: { status: "needsKey", provider: "OpenAI" } }, host: null, blocker: "needsKey", onApply() {}, onDiscard() {},
    }));
    assert.match(html, /disabled=""/);
    assert.match(html, /role="status"[^>]*>[^<]*staging\.blocked\.needsKey\{&quot;provider&quot;:&quot;OpenAI&quot;\}/);
  });

  await t.test("the cloud panel offers providers with key status and no pre-armed choice", () => {
    const html = renderToStaticMarkup(React.createElement(panel.StagedRoutePanelView, {
      routeId: "dictationStt",
      target: { mode: "providers", provider: "" },
      providers: [{ id: "openai", name: "OpenAI", hasKey: true }, { id: "groq", name: "Groq", hasKey: false }],
      onTarget() {},
      keyField: null,
    }));
    assert.match(html, /staging\.cloud\.title/);
    assert.match(html, /role="group"[^>]*aria-label="staging\.provider"/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 0, "no provider is chosen for the user");
    assert.match(html, /staging\.keySaved/);
    assert.match(html, /staging\.noKey/);
  });

  await t.test("upload shows the shared dictation server instead of an editable URL", () => {
    const html = renderToStaticMarkup(React.createElement(panel.StagedRoutePanelView, {
      routeId: "uploadStt",
      target: { mode: "self-hosted", remoteUrl: "http://192.168.1.5:8178" },
      providers: [],
      onTarget() {},
      keyField: null,
    }));
    assert.match(html, /staging\.url\.sharedWithDictation/);
    assert.doesNotMatch(html, /<input/);
  });

  await t.test("the server panel labels its URL field and explains plain http", () => {
    const html = renderToStaticMarkup(React.createElement(panel.StagedRoutePanelView, {
      routeId: "translation",
      target: { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" },
      providers: [],
      onTarget() {},
      keyField: null,
    }));
    assert.match(html, /<label[^>]*for="staged-url-translation"/);
    assert.match(html, /id="staged-url-translation"/);
    assert.match(html, /staging\.url\.http/);
    assert.match(html, /placeholder="http:\/\/localhost:11434\/v1"/);
  });

  await t.test("choosing Cloud never pre-arms a provider; choosing Self-hosted keeps the known URL", () => {
    assert.deepEqual(draft.stagedTargetForMode("providers", { mode: "local" }), { mode: "providers", provider: "" });
    assert.deepEqual(draft.stagedTargetForMode("self-hosted", { mode: "self-hosted", remoteUrl: "http://a:1" }), { mode: "self-hosted", remoteUrl: "http://a:1" });
    assert.deepEqual(draft.stagedTargetForMode("self-hosted", { mode: "local" }), { mode: "self-hosted", remoteUrl: "" });
    assert.deepEqual(draft.stagedTargetForMode("local", { mode: "providers", provider: "x" }), { mode: "local" });
  });

  await t.test("closing the modal discards the draft", () => {
    draft.useRouteDraftStore.getState().stage({ routeId: "chat", target: { mode: "providers", provider: "groq" } });
    const seen = [];
    const handler = draft.withDraftDiscard((open) => seen.push(open));
    handler(true);
    assert.ok(draft.useRouteDraftStore.getState().draft, "opening keeps it");
    handler(false);
    assert.equal(draft.useRouteDraftStore.getState().draft, null);
    assert.deepEqual(seen, [true, false]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/providerCatalog.test.js test/components/stagedRoute.test.js`
Expected: FAIL. The modules and exports are missing.

- [ ] **Step 3: Implement**

1. In `src/lib/routes.ts`, rename `KEY_FIELDS` to `PROVIDER_KEY_FIELDS`, export it, add `corti: "cortiApiKey"`, and keep the existing Corti client-id/secret line in `buildRouteSnapshot`. `buildRouteSnapshot` iterates it unchanged.

2. Create `src/components/settings/routing/providerCatalog.ts`:

   ```ts
   import modelRegistryData from "../../../models/modelRegistryData.json";
   import { MEETING_STREAMING_PROVIDER_IDS } from "../../../helpers/meetingTranscriptionRouting.js";
   import { STREAMING_ONLY_PROVIDERS } from "../../../helpers/transcriptionRoute";
   import type { RouteId } from "../../../lib/routes";

   // Which providers can serve which kind of task. Speech comes from the
   // transcription registry; text mirrors ReasoningModelSelector's
   // CLOUD_PROVIDER_IDS (src/components/ReasoningModelSelector.tsx:47-60);
   // vision is every text provider with a vision-capable model in the registry.

   export type ProviderCapability = "speech" | "text" | "vision";

   const TEXT_PROVIDER_IDS = [
     "openai", "anthropic", "gemini", "groq", "openrouter", "tinfoil", "corti",
     "codex", "bedrock", "azure", "vertex",
   ];

   interface RegistryProvider { id: string; baseUrl?: string; models?: { supportsVision?: boolean }[] }
   const textRegistry = [
     ...(modelRegistryData.cloudProviders as RegistryProvider[]),
     ...(modelRegistryData.enterpriseProviders as RegistryProvider[]),
   ];
   const speechRegistry = modelRegistryData.transcriptionProviders as RegistryProvider[];

   export function capabilityOf(id: RouteId): ProviderCapability | null {
     if (id === "dictationStt" || id === "noteRecordingStt" || id === "uploadStt") return "speech";
     if (id === "assistantVision") return "vision";
     if (id === "speakerId" || id === "semanticSearch") return null;
     return "text";
   }

   export function providersForRoute(id: RouteId): string[] {
     const capability = capabilityOf(id);
     if (capability === null) return [];
     if (capability === "speech") {
       const speech = speechRegistry.map((p) => p.id);
       // Note recording only runs the streaming clients main supports
       // (meetingTranscriptionRouting.js) and has no custom endpoint.
       if (id === "noteRecordingStt") return speech.filter((p) => MEETING_STREAMING_PROVIDER_IDS.includes(p));
       // Upload is batch-only, so realtime-only providers cannot serve it.
       if (id === "uploadStt") return [...speech.filter((p) => !STREAMING_ONLY_PROVIDERS.has(p)), "custom"];
       return [...speech, "custom"];
     }
     if (capability === "vision") {
       return textRegistry.filter((p) => p.models?.some((m) => m.supportsVision)).map((p) => p.id);
     }
     return [...TEXT_PROVIDER_IDS, "custom"];
   }

   const KNOWN_HOSTS: Record<string, string> = {
     anthropic: "api.anthropic.com",
     gemini: "generativelanguage.googleapis.com",
     openrouter: "openrouter.ai",
     codex: "chatgpt.com",
   };

   export function providerHost(providerId: string): string | null {
     if (providerId === "custom") return null;
     const baseUrl = [...speechRegistry, ...textRegistry].find((p) => p.id === providerId && p.baseUrl)?.baseUrl;
     if (baseUrl) {
       try {
         return new URL(baseUrl).host;
       } catch {
         /* fall through */
       }
     }
     return KNOWN_HOSTS[providerId] ?? null;
   }
   ```

3. Add to `src/stores/routeDraftStore.ts`:

   ```ts
   import type { InferenceMode } from "../types/electron";

   // Cloud never opens on a provider the user did not pick (SET-13).
   export function stagedTargetForMode(mode: InferenceMode, current: RouteTarget): RouteTarget {
     if (mode === "local") return { mode: "local" };
     if (mode === "self-hosted") {
       return { mode: "self-hosted", remoteUrl: current.mode === "self-hosted" ? current.remoteUrl : "" };
     }
     return { mode: "providers", provider: "" };
   }

   // Closing Settings never applies a pending change.
   export function withDraftDiscard(onOpenChange: (open: boolean) => void): (open: boolean) => void {
     return (open) => {
       if (!open) useRouteDraftStore.getState().discard();
       onOpenChange(open);
     };
   }
   ```

4. Create `src/components/settings/routing/useRouteChange.ts`:

   ```ts
   import { useCallback, useMemo } from "react";
   import { useTranslation } from "react-i18next";
   import { routeSendsCopy, type RouteId } from "../../../lib/routes";
   import { routeChangeMessage, type RouteTarget } from "../../../lib/routeTargets";
   import { applyDraft, requestRouteChange, type RouteChangeOutcome } from "../../../stores/routeDraftStore";
   import { useToast } from "../../ui/useToast";

   export function useRouteChange() {
     const { t } = useTranslation();
     const { toast } = useToast();
     const sends = useMemo(() => routeSendsCopy(t), [t]);

     const announce = useCallback(
       (outcome: RouteChangeOutcome) => {
         if (!outcome.applied) return;
         const message = routeChangeMessage(outcome.route, t);
         toast({
           title: message.title,
           description: message.description,
           variant: "success",
           duration: 7000,
           actions: outcome.undo
             ? [{ label: t("routes.toast.undo"), onClick: outcome.undo, dismissOnClick: true }]
             : undefined,
         });
       },
       [t, toast]
     );

     const request = useCallback(
       (id: RouteId, target: RouteTarget) => {
         const result = requestRouteChange(id, target, sends);
         if (result !== "staged") announce(result);
       },
       [sends, announce]
     );

     const apply = useCallback(() => {
       const outcome = applyDraft(sends);
       if (outcome) announce(outcome);
       return outcome;
     }, [sends, announce]);

     return { request, apply, sends };
   }
   ```

5. Create `src/components/settings/routing/StagedRouteBar.tsx`:

   ```tsx
   import { useEffect, useMemo } from "react";
   import { useTranslation } from "react-i18next";
   import type { ResolvedRoute } from "../../../lib/routes";
   import { applyBlocker, previewRoute, type ApplyBlocker, type RouteTarget } from "../../../lib/routeTargets";
   import { currentRouteSnapshot, useRouteDraftStore } from "../../../stores/routeDraftStore";
   import { useRouteFactsStore } from "../../../stores/routeFactsStore";
   import { useSettingsStore } from "../../../stores/settingsStore";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { Button } from "../../ui/button";
   import { providerHost } from "./providerCatalog";
   import { RouteDestinationChip } from "./RouteChips";
   import { useRouteChange } from "./useRouteChange";

   const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

   export function StagedRouteBarView({
     preview,
     host,
     blocker,
     onApply,
     onDiscard,
   }: {
     preview: ResolvedRoute;
     host: string | null;
     blocker: ApplyBlocker | null;
     onApply: () => void;
     onDiscard: () => void;
   }) {
     const { t } = useTranslation();
     const payload = preview.sends ?? t(`routes.sends.${preview.id}`);
     return (
       <div
         role="region"
         aria-label={t("staging.region")}
         className="sticky bottom-0 z-20 -mx-6 mt-6 flex flex-wrap items-center gap-3 border-t border-border/70 bg-background/90 px-6 py-3 backdrop-blur-md"
       >
         <div className="min-w-0 flex-1 text-xs">
           <div className="flex min-w-0 flex-wrap items-center gap-1.5">
             <span className="font-medium">{t(`routes.names.${preview.id}`)} →</span>
             <RouteDestinationChip route={preview} />
             {host && (
               <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                 {host}
               </span>
             )}
           </div>
           <p className="mt-0.5 font-medium text-locality-remote">
             {preview.locality === "network"
               ? t("staging.leavesToServer", { payload })
               : t("staging.leaves", { payload })}
           </p>
           <p role="status" aria-live="polite" className="mt-0.5 text-destructive">
             {blocker
               ? t(`staging.blocked.${blocker}`, {
                   provider: preview.providerId ? providerDisplayLabel(preview.providerId, t) : "",
                 })
               : ""}
           </p>
         </div>
         <div className="flex shrink-0 items-center gap-2">
           <Button size="sm" variant="outline" onClick={onDiscard}>
             {t("staging.discard")}
           </Button>
           <Button size="sm" onClick={onApply} disabled={blocker !== null}>
             {t("staging.apply")}
             <kbd aria-hidden="true" className="ms-1.5 font-mono text-[11px] opacity-70" dir="ltr">
               {isMac ? "⌘↵" : "Ctrl ↵"}
             </kbd>
           </Button>
         </div>
       </div>
     );
   }

   export function StagedRouteBar() {
     const draft = useRouteDraftStore((s) => s.draft);
     const discard = useRouteDraftStore((s) => s.discard);
     const settings = useSettingsStore();
     const facts = useRouteFactsStore((s) => s.facts);
     const { apply, sends } = useRouteChange();

     const preview = useMemo(
       () => (draft ? previewRoute(currentRouteSnapshot(sends), draft.routeId, draft.target) : null),
       // settings and facts are dependencies so the preview follows key saves and sealed changes.
       // eslint-disable-next-line react-hooks/exhaustive-deps
       [draft, sends, settings, facts]
     );
     const blocker = draft && preview ? applyBlocker(preview, draft.target) : null;
     const host = draft ? draftHost(draft.target) : null;

     useEffect(() => {
       if (!draft) return;
       const onKey = (event: KeyboardEvent) => {
         // Only inside the Settings dialog, so ⌘↵ elsewhere (chat, notes) never applies a route.
         if (!(event.target instanceof Element) || !event.target.closest('[role="dialog"]')) return;
         if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !blocker) {
           event.preventDefault();
           apply();
         }
       };
       document.addEventListener("keydown", onKey);
       return () => document.removeEventListener("keydown", onKey);
     }, [draft, blocker, apply]);

     // Unmounting Settings (ControlPanel removes the modal) also drops the draft.
     useEffect(() => () => useRouteDraftStore.getState().discard(), []);

     if (!draft || !preview) return null;
     return <StagedRouteBarView preview={preview} host={host} blocker={blocker} onApply={apply} onDiscard={discard} />;
   }

   // The receiving host, shown in the bar so the user sees exactly where data goes.
   function draftHost(target: RouteTarget): string | null {
     const hostOf = (url: string) => {
       try {
         return new URL(url.trim()).host || null;
       } catch {
         return null;
       }
     };
     if (target.mode === "self-hosted") return hostOf(target.remoteUrl);
     if (target.mode === "providers") {
       return target.provider === "custom" ? hostOf(target.baseUrl ?? "") : providerHost(target.provider);
     }
     return null;
   }
   ```

   The default `Button` variant is the ink capsule from Plan 01 (D1), never `live`. Apply is the only default-variant button inside the bar.

6. Create `src/components/settings/routing/StagedRoutePanel.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { PROVIDER_KEY_FIELDS, type RouteId } from "../../../lib/routes";
   import type { RouteTarget } from "../../../lib/routeTargets";
   import { useRouteDraftStore } from "../../../stores/routeDraftStore";
   import { useSettingsStore, type SettingsState } from "../../../stores/settingsStore";
   import { useRouteFactsStore } from "../../../stores/routeFactsStore";
   import ApiKeyInput from "../../ui/ApiKeyInput";
   import { Input } from "../../ui/input";
   import { providersForRoute } from "./providerCatalog";

   export interface StagedProviderOption { id: string; name: string; hasKey: boolean }
   export interface StagedRoutePanelViewProps {
     routeId: RouteId;
     target: RouteTarget;
     providers: StagedProviderOption[];
     onTarget: (target: RouteTarget) => void;
     keyField: { value: string; onChange: (value: string) => void } | null;
   }

   function urlHint(url: string): "empty" | "invalid" | "http" | "ok" {
     if (!url.trim()) return "empty";
     try {
       const u = new URL(url.trim());
       if (u.protocol === "http:") return "http";
       return u.protocol === "https:" ? "ok" : "invalid";
     } catch {
       return "invalid";
     }
   }

   export function StagedRoutePanelView({ routeId, target, providers, onTarget, keyField }: StagedRoutePanelViewProps) {
     const { t } = useTranslation();
     if (target.mode === "local") return null;
     const task = t(`routes.names.${routeId}`);
     const payload = t(`routes.sends.${routeId}`);
     const urlValue = target.mode === "self-hosted" ? target.remoteUrl : (target.baseUrl ?? "");
     const showUrl = target.mode === "self-hosted" || target.provider === "custom";
     const urlId = `staged-url-${routeId}`;
     const hint = urlHint(urlValue);
     const setUrl = (value: string) =>
       onTarget(target.mode === "self-hosted" ? { mode: "self-hosted", remoteUrl: value } : { ...target, baseUrl: value });

     return (
       <div className="rounded-lg border border-dashed border-locality-remote/70 bg-locality-remote/5 px-4 py-3 text-xs space-y-3">
         <div>
           <p className="text-sm font-semibold text-foreground">
             {target.mode === "self-hosted" ? t("staging.server.title", { task }) : t("staging.cloud.title", { task })}
           </p>
           <p className="mt-1 text-muted-foreground">
             {target.mode === "self-hosted" ? t("staging.server.body", { payload }) : t("staging.cloud.body", { payload })}
           </p>
         </div>
         {target.mode === "providers" && (
           <div role="group" aria-label={t("staging.provider")} className="flex flex-wrap gap-1.5">
             {providers.map((p) => (
               <button
                 key={p.id}
                 type="button"
                 aria-pressed={target.provider === p.id}
                 onClick={() => onTarget({ mode: "providers", provider: p.id })}
                 className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                   target.provider === p.id ? "border-primary bg-primary/10" : "border-border bg-background"
                 }`}
               >
                 {p.name}
                 <span className="text-muted-foreground">{p.hasKey ? t("staging.keySaved") : t("staging.noKey")}</span>
               </button>
             ))}
           </div>
         )}
         {keyField && (
           <ApiKeyInput apiKey={keyField.value} setApiKey={keyField.onChange} label={t("staging.addKey")} />
         )}
         {showUrl && routeId === "uploadStt" && target.mode === "self-hosted" && (
           <p className="text-muted-foreground" dir="auto">
             {t("staging.url.sharedWithDictation", { url: urlValue || "—" })}
           </p>
         )}
         {showUrl && !(routeId === "uploadStt" && target.mode === "self-hosted") && (
           <div className="space-y-1.5">
             <label htmlFor={urlId} className="block text-xs font-medium text-foreground">
               {target.mode === "self-hosted" ? t("settingsPage.selfHosted.serverUrl") : t("staging.baseUrl")}
             </label>
             <Input
               id={urlId}
               dir="ltr"
               value={urlValue}
               onChange={(e) => setUrl(e.target.value)}
               placeholder="http://localhost:11434/v1"
               className="h-8 text-sm"
             />
             <p className={hint === "invalid" ? "text-destructive" : "text-muted-foreground"}>{t(`staging.url.${hint}`)}</p>
           </div>
         )}
       </div>
     );
   }

   export function StagedRoutePanel({ routeId }: { routeId: RouteId }) {
     const { t } = useTranslation();
     const draft = useRouteDraftStore((s) => s.draft);
     const stage = useRouteDraftStore((s) => s.stage);
     const settings = useSettingsStore();
     const extra = useRouteFactsStore((s) => s.facts.extraCredentials);
     if (!draft || draft.routeId !== routeId || draft.target.mode === "local") return null;
     const providers = providersForRoute(routeId).map((id) => {
       const field = PROVIDER_KEY_FIELDS[id];
       return {
         id,
         name: providerDisplayLabel(id, t),
         hasKey: id === "custom" ? true : field ? !!settings[field] : extra.has(id),
       };
     });
     const chosen = draft.target.mode === "providers" ? draft.target.provider : "";
     const field = chosen ? (PROVIDER_KEY_FIELDS[chosen] as keyof SettingsState | undefined) : undefined;
     const keyField =
       field && !settings[field]
         ? {
             value: String(settings[field] ?? ""),
             onChange: (value: string) => settings.updateApiKeys({ [field]: value }),
           }
         : null;
     return (
       <StagedRoutePanelView
         routeId={routeId}
         target={draft.target}
         providers={providers}
         onTarget={(target) => stage({ routeId, target })}
         keyField={keyField}
       />
     );
   }
   ```

   Saving a key here does not change any route: keys are global, and the draft still needs Apply.

7. In `src/components/ui/SidebarModal.tsx`:
   - Add `footer?: React.ReactNode` to the props (`:20-34`).
   - Inside the content column (`:243-259`), render `{footer}` after `{children}`, within the same scrolling container, so its `sticky bottom-0` pins to the visible bottom edge.

8. In `src/components/SettingsModal.tsx`:
   - Pass `onOpenChange={withDraftDiscard(onOpenChange)}` to `SidebarModal`.
   - Pass `footer={<StagedRouteBar />}`.

9. Replace each mode handler with the draft flow. For `TranscriptionSection` in `SettingsPage.tsx:526-548`:

   ```tsx
   const { request, sends } = useRouteChange();
   const draft = useRouteDraftStore((s) => s.draft);
   const stagedMode = draft?.routeId === "dictationStt" ? draft.target.mode : null;
   const handleTranscriptionModeSelect = (mode: InferenceMode) => {
     if (!isModeAllowed(mode)) return;
     if (mode === "local") {
       useRouteDraftStore.getState().discard();
       if (mode !== effectiveTranscriptionMode) request("dictationStt", { mode: "local" });
       return;
     }
     if (mode === effectiveTranscriptionMode) {
       useRouteDraftStore.getState().discard(); // re-selecting the applied mode cancels the draft
       return;
     }
     const current = targetFromSnapshot(currentRouteSnapshot(sends), "dictationStt");
     request("dictationStt", stagedTargetForMode(mode, current));
   };
   ```

   Then pass `stagedMode={stagedMode}` to `<InferenceModeSelector>` and render `<StagedRoutePanel routeId="dictationStt" />` directly below it. The `toast` prop of `TranscriptionSection` becomes unused for mode switches, but keep it if other code in the section uses it.

   Make the identical change in `MeetingSettings.tsx:87-95` (route `noteRecordingStt`, and keep `if (mode === "self-hosted") return;`) and `UploadSettings.tsx:68-75` (route `uploadStt`).

   In `InferenceConfigEditor.tsx:97-124`, replace the body of `handleModeSelect` with the same flow, using `SCOPE_ROUTE[scope]` as the route. The old patch logic (clear the provider when it is invalid for local mode, call `llamaServerStop` for self-hosted) now lives in `writeRouteTarget` (Task 5). Keep calling `onModeChange?.(mode)` after a local apply, so callers that react to it keep working. Add `stagedMode` and `<StagedRoutePanel routeId={SCOPE_ROUTE[scope]} />`.

   For the `dictationAgentVision` scope (`allowedModes={["providers"]}` at `DictationAgentSettings.tsx:212`), there is only one mode, so the selector is hidden (`modes.length > 1`) and nothing changes.

10. Delete `CLEANUP_MODE_TOAST_KEY` and `handleCleanupModeChange` (`SettingsPage.tsx:677-716`), and remove `onModeChange={handleCleanupModeChange}` at `:733`. The route toast replaces them.

11. Write `/tmp/loqui-i18n-task-6.json` and merge it. The `en` block is below. Then delete the six `switched*` keys listed under Files from every locale (a short `node -e` with `delete`, or edit each file), but only after `grep -rn "switchedProviders\|switchedLocal\|switchedSelfHosted" src` shows no remaining references.

    ```json
    {
      "staging": {
        "region": "Pending route change",
        "provider": "Provider",
        "keySaved": "key saved",
        "noKey": "no key",
        "addKey": "API key",
        "baseUrl": "Endpoint URL",
        "cloud": {
          "title": "Send {{task}} to a cloud provider?",
          "body": "This sends {{payload}} to the provider you pick. Nothing is sent until you apply."
        },
        "server": {
          "title": "Send {{task}} to your own server?",
          "body": "This sends {{payload}} to the address below, not to Loqui. Nothing is sent until you apply."
        },
        "url": {
          "empty": "Paste or type the base URL.",
          "invalid": "That does not look like a URL yet.",
          "http": "http:// is not encrypted. Fine on your own network.",
          "ok": "Looks good.",
          "sharedWithDictation": "Audio upload uses the dictation server: {{url}}. Change it in Speech-to-Text › Dictation."
        },
        "leaves": "Sends {{payload}} off this device",
        "leavesToServer": "Sends {{payload}} to your server",
        "blocked": {
          "needsKey": "{{provider}} needs an API key first.",
          "chooseProvider": "Choose a provider to review what will be sent.",
          "needsUrl": "Enter a valid server URL.",
          "needsModel": "Download the model first.",
          "sealed": "Sealed mode is on. Cloud routes are paused."
        },
        "discard": "Discard",
        "apply": "Apply"
      }
    }
    ```

    The `{{payload}}` noun phrases come from `routes.sends.*` and are lower-case mid-sentence. In each language, word the sentence so the payload is not at the start.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/providerCatalog.test.js test/components/stagedRoute.test.js test/stores/routeDraftStore.test.js test/components/inferenceModeSelector.test.js && npm run typecheck && npm run lint && npm run i18n:check`

The `PROVIDER_KEY_FIELDS` key for Corti text is `corti` → `cortiApiKey`. Speech Corti ("corti:speech") has no inline key field: the staged panel shows "no key" and the bar's blocker tells the user to add the client credentials in the provider editor. That flow is listed in the open questions.
Expected: PASS.

Then check manually in the app (`npm run native:electron && npm run dev`):
- STT → Cloud shows the dashed panel, no provider is highlighted, and the bar reads "Choose a provider…" with Apply disabled.
- Pick OpenAI without a key, and the key field appears. Save a key, and Apply enables. Apply, and the toast reads "Dictation now sends your audio and dictionary words to OpenAI." with Undo.
- Choosing Local is instant and toasts "Dictation now runs on this device."
- Esc closes Settings, and reopening shows no draft.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/routing src/stores/routeDraftStore.ts src/lib/routes.ts src/components/ui/SidebarModal.tsx src/components/SettingsModal.tsx src/components/SettingsPage.tsx src/components/settings/MeetingSettings.tsx src/components/settings/UploadSettings.tsx src/components/settings/InferenceConfigEditor.tsx src/locales test/components/providerCatalog.test.js test/components/stagedRoute.test.js
git commit -m "feat(settings): Stage remote route changes behind a review bar"
```

---

### Task 7: Routing page and the Patchbay switchboard (SET-R1 B)

This adds a new first item under AI Models, **Routing**, that answers "where does each task run?" in one view:
- 11 task jacks on the left and destinations on the right.
- Cables show where audio and text go: solid for this device, dotted for your server, dashed for a provider. Cables are decoration. The task and destination buttons are the canonical DOM.
- Picking a destination goes through Task 5's rules: local is instant with Undo, and remote is staged into the Apply bar.
- A footer meter counts what stays on this device.
- Below 720px of board width the cables hide and the columns stack ("falls back to the list").

**Files:**
- Create: `src/components/settings/routing/destinations.ts` (pure)
- Create: `src/components/settings/routing/Patchbay.tsx`
- Create: `src/components/settings/routing/RoutingSection.tsx`
- Modify: `src/components/SettingsPage.tsx`. Add `"routing"` to `SettingsSectionType` (`:111-112`), and a `case "routing"` in `renderSectionContent` (`:1625`) that renders `<RoutingSection onNavigateToPath={onNavigateToPath} />`.
- Modify: `src/lib/settingsPaths.ts`. Add `"routing"` to `SETTINGS_SECTIONS`, and add `routes: "routing"` to `SECTION_ALIASES`.
- Modify: `src/components/SettingsModal.tsx`. Add the sidebar item as the first in the `aiModels` group (`:50-96`).
- Modify: `src/components/ui/SidebarModal.tsx`:
  - Widen the dialog from `max-w-4xl` to `max-w-5xl` (`:121-135`).
  - Add the escape-claim rule to `DialogPrimitive.Content`.
- Modify: `src/components/icons/index.ts`. Add `Waypoints`.
- Modify: `src/index.css`. Append the `.patchbay-*` rules after the Plan 01 `.locality-ring` block.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/patchbayDestinations.test.js`, `test/components/patchbay.test.js`

**Interfaces:**
- Consumes:
  - from Tasks 1–6: `ResolvedRoute`, `RouteSettingsSnapshot`, `useResolvedRoutes`, `ROUTE_IDS`, `ROUTE_KIND`, `targetFromSnapshot`, `RouteTarget`, `useRouteChange().request`, `useRouteDraftStore`, `currentRouteSnapshot`, `capabilityOf`, `providersFor`, `providerHost`, `RouteStateChip` and `RouteDestinationChip`;
  - from Plan 01: `providerDisplayName` (sorting only), `providerDisplayLabel` (every name shown) and `LocalityRing`.
- Produces:

  ```ts
  // destinations.ts
  export interface RouteDestination {
    id: string;                       // "device" | "network" | provider id
    locality: Locality;
    providerId: string | null;
    name: string;                     // display name; device/network names are translated by the UI
    host: string | null;              // "api.openai.com", "192.168.1.20:11434"
    url: string | null;               // network only: first self-hosted URL in use
    hasKey: boolean;                  // providers: saved and not rejected
  }
  export type Compatibility = { ok: true } | { ok: false; reasonKey: string; params?: Record<string, string> };
  export function routeDestinationId(snapshot: RouteSettingsSnapshot, route: ResolvedRoute): string;
  export function buildDestinations(snapshot: RouteSettingsSnapshot, routes: ResolvedRoute[]): RouteDestination[];
  export function checkCompatibility(routeId: RouteId, dest: RouteDestination): Compatibility;
  export function targetForDestination(snapshot: RouteSettingsSnapshot, routeId: RouteId, dest: RouteDestination): RouteTarget;
  export function privacyTally(routes: ResolvedRoute[]): { total: number; stay: number; network: number; remote: number };
  export function cablePath(from: { x: number; y: number }, to: { x: number; y: number }): string;
  // Patchbay.tsx
  export function PatchbayView(props: PatchbayViewProps): JSX.Element;   // presentational, SSR-testable
  export function Patchbay(props: { onNavigateToPath?: (path: string) => void }): JSX.Element;
  // RoutingSection.tsx
  export function RoutingSection(props: { onNavigateToPath?: (path: string) => void }): JSX.Element;
  ```

  `SidebarModal` gains this rule: while focus is inside an element with `data-escape-active="true"`, Escape is left to that element instead of closing the dialog. Task 13's search uses it too.

- [ ] **Step 1: Write the failing tests**

Create `test/components/patchbayDestinations.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const SENDS = Object.fromEntries(
  ["dictationStt", "noteRecordingStt", "uploadStt", "dictationCleanup", "voiceAssistant", "assistantVision", "translation", "noteFormatting", "chat"].map((id) => [id, id])
);
const stt = (o = {}) => ({ mode: "local", localProvider: "whisper", localModel: "base", cloudProvider: "", cloudModel: "", cloudBaseUrl: "", remoteUrl: "", remoteModel: "", ...o });
const llm = (o = {}) => ({ mode: "local", provider: "qwen", model: "q", remoteUrl: "", cloudBaseUrl: "", ...o });

function snapshot() {
  return {
    stt: { dictation: stt(), meeting: stt(), upload: stt({ mode: "providers", cloudProvider: "openai", cloudModel: "gpt-4o-mini-transcribe" }) },
    llm: {
      dictationCleanup: llm(), dictationAgent: llm(), dictationAgentVision: llm(),
      dictationTranslation: llm({ mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1", model: "llama3.1:8b" }),
      noteFormatting: llm(), chatIntelligence: llm({ mode: "providers", provider: "groq", model: "openai/gpt-oss-120b" }),
    },
    enabled: { cleanup: false, voiceAssistant: true, screenContext: false, visionOverride: false, translation: true, speakerId: true },
    savedKeys: new Set(["openai", "anthropic"]),
    rejectedKeys: new Set(["anthropic"]),
    installedModels: null,
    models: {},
    speakerIdModelsReady: true,
    searchModelReady: true,
    sealed: false,
    sends: SENDS,
  };
}

test("patchbay destinations", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-patchbay-dest-test-" });
  const { resolveRoutes } = await vite.ssrLoadModule("/lib/routes.ts");
  const d = await vite.ssrLoadModule("/components/settings/routing/destinations.ts");
  const s = snapshot();
  const routes = resolveRoutes(s);
  const dests = d.buildDestinations(s, routes);
  const byId = Object.fromEntries(dests.map((x) => [x.id, x]));

  await t.test("device and network always exist, then providers in use or with a saved key", () => {
    assert.deepEqual(dests.map((x) => x.id), ["device", "network", "anthropic", "groq", "openai"]);
    assert.equal(byId.network.host, "192.168.1.20:11434");
    assert.equal(byId.network.url, "http://192.168.1.20:11434/v1");
    assert.equal(byId.openai.host, "api.openai.com");
    assert.equal(byId.groq.hasKey, false);
    assert.equal(byId.anthropic.hasKey, false, "a rejected key is not a usable key");
    assert.equal(byId.openai.hasKey, true);
  });

  await t.test("each route maps to the destination it uses", () => {
    const at = (id) => d.routeDestinationId(s, routes.find((r) => r.id === id));
    assert.equal(at("dictationStt"), "device");
    assert.equal(at("uploadStt"), "openai");
    assert.equal(at("translation"), "network");
    assert.equal(at("chat"), "groq");
  });

  await t.test("compatibility explains every refusal", () => {
    assert.deepEqual(d.checkCompatibility("dictationStt", byId.device), { ok: true });
    assert.equal(d.checkCompatibility("dictationStt", byId.anthropic).ok, false);
    assert.equal(d.checkCompatibility("dictationStt", byId.anthropic).reasonKey, "patchbay.no.capability");
    assert.equal(d.checkCompatibility("assistantVision", byId.device).reasonKey, "patchbay.no.visionCloudOnly");
    assert.equal(d.checkCompatibility("noteRecordingStt", byId.network).reasonKey, "patchbay.no.meetingServer");
    assert.equal(d.checkCompatibility("speakerId", byId.device).reasonKey, "patchbay.locked.speakerId");
    assert.deepEqual(d.checkCompatibility("chat", byId.openai), { ok: true });
  });

  await t.test("targets: device is local, network reuses a server of the same kind, providers are bare", () => {
    assert.deepEqual(d.targetForDestination(s, "chat", byId.device), { mode: "local" });
    assert.deepEqual(d.targetForDestination(s, "noteFormatting", byId.network), { mode: "self-hosted", remoteUrl: "http://192.168.1.20:11434/v1" });
    assert.deepEqual(
      d.targetForDestination(s, "dictationStt", byId.network),
      { mode: "self-hosted", remoteUrl: "" },
      "an LLM server is never offered as a speech server"
    );
    assert.deepEqual(d.targetForDestination(s, "dictationCleanup", byId.openai), { mode: "providers", provider: "openai" });
  });

  await t.test("the tally counts what stays on this device; off routes send nothing", () => {
    assert.deepEqual(d.privacyTally(routes), { total: 11, stay: 8, network: 1, remote: 2 });
  });

  await t.test("cables are horizontal-tangent cubic Béziers", () => {
    assert.equal(d.cablePath({ x: 10, y: 20 }, { x: 310, y: 80 }), "M 10 20 C 130 20, 190 80, 310 80");
  });
});
```

The tally is 8 stay, 1 network and 2 remote. That is 6 device routes, plus the off cleanup route, plus assistant vision, which is off because screen context is off. Translation is on the network. Upload (OpenAI) and chat (Groq) are remote.

Create `test/components/patchbay.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("patchbay view", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-patchbay-view-test-" }, { withOptions: true }));
  const { PatchbayView } = await vite.ssrLoadModule("/components/settings/routing/Patchbay.tsx");
  const ids = ["dictationStt", "noteRecordingStt", "uploadStt", "dictationCleanup", "voiceAssistant", "assistantVision", "translation", "noteFormatting", "chat", "speakerId", "semanticSearch"];
  const kind = (id) => (id.endsWith("Stt") ? "speech" : id === "speakerId" || id === "semanticSearch" ? "support" : "text");
  const routes = ids.map((id) => ({
    id, kind: kind(id), locality: id === "chat" ? "remote" : "device", provider: id === "chat" ? "Groq" : null,
    providerId: id === "chat" ? "groq" : null,
    model: "M", state: id === "chat" ? { status: "needsKey", provider: "Groq" } : { status: "ready" },
    sends: id === "chat" ? "x" : null, settingsPath: "llms/x",
  }));
  const destinations = [
    { id: "device", locality: "device", providerId: null, name: "device", host: null, url: null, hasKey: true },
    { id: "network", locality: "network", providerId: null, name: "network", host: null, url: null, hasKey: true },
    { id: "anthropic", locality: "remote", providerId: "anthropic", name: "Anthropic", host: "api.anthropic.com", url: null, hasKey: true },
    { id: "groq", locality: "remote", providerId: "groq", name: "Groq", host: "api.groq.com", url: null, hasKey: false },
  ];
  const base = {
    routes,
    destinations,
    destinationOf: (r) => (r.id === "chat" ? "groq" : "device"),
    selectedId: null,
    stagedRouteId: null,
    message: null,
    wide: true,
    onSelectTask() {},
    onPickDestination() {},
    onOpenSettings() {},
  };

  await t.test("every task and destination is a real button; cables are hidden from assistive tech", () => {
    const html = renderToStaticMarkup(React.createElement(PatchbayView, base));
    assert.equal((html.match(/data-task="/g) ?? []).length, 11);
    assert.equal((html.match(/data-destination="/g) ?? []).length, 4);
    assert.match(html, /role="group"[^>]*aria-label="patchbay\.tasks"/);
    assert.match(html, /role="group"[^>]*aria-label="patchbay\.destinations"/);
    assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*class="patchbay-cables"/);
    assert.match(html, /data-task="speakerId"[^>]*aria-disabled="true"/);
    assert.match(html, /patchbay\.locked\.speakerId/);
  });

  await t.test("selecting a task marks compatible and incompatible destinations with reasons", () => {
    const html = renderToStaticMarkup(React.createElement(PatchbayView, { ...base, selectedId: "dictationStt" }));
    assert.match(html, /data-task="dictationStt"[^>]*aria-pressed="true"/);
    assert.match(html, /data-destination="anthropic"[^>]*data-compat="no"[^>]*aria-disabled="true"/);
    assert.match(html, /data-destination="groq"[^>]*data-compat="ok"/);
  });

  await t.test("the meter counts what stays on this device and names what leaves", () => {
    const html = renderToStaticMarkup(React.createElement(PatchbayView, base));
    assert.match(html, /role="img"[^>]*aria-label="patchbay\.meter\.label\{&quot;count&quot;:10,&quot;total&quot;:11\}"/);
    assert.match(html, /patchbay\.leaves\.item\{&quot;task&quot;:&quot;routes\.names\.chat&quot;,&quot;destination&quot;:&quot;Groq&quot;\}/);
  });

  await t.test("narrow boards drop the cables and keep the list", () => {
    const html = renderToStaticMarkup(React.createElement(PatchbayView, { ...base, wide: false }));
    assert.doesNotMatch(html, /patchbay-cables/);
    assert.match(html, /data-layout="list"/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/patchbayDestinations.test.js test/components/patchbay.test.js`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

1. Add `export const Waypoints = createIcon("waypoints", Lucide.Waypoints);` to `src/components/icons/index.ts`.

2. Create `src/components/settings/routing/destinations.ts`:

   ```ts
   import { providerDisplayName, type Locality } from "../../../lib/locality";
   import type { ResolvedRoute, RouteId, RouteSettingsSnapshot } from "../../../lib/routes";
   import { targetFromSnapshot, type RouteTarget } from "../../../lib/routeTargets";
   import { capabilityOf, providerHost, providersForRoute } from "./providerCatalog";

   export interface RouteDestination {
     id: string;
     locality: Locality;
     providerId: string | null;
     name: string;
     host: string | null;
     url: string | null;
     hasKey: boolean;
   }

   export type Compatibility =
     | { ok: true }
     | { ok: false; reasonKey: string; params?: Record<string, string> };

   function hostOf(url: string): string | null {
     try {
       return new URL(url).host || null;
     } catch {
       return null;
     }
   }

   export function routeDestinationId(s: RouteSettingsSnapshot, route: ResolvedRoute): string {
     if (route.locality === "device") return "device";
     if (route.locality === "network") return "network";
     const target = targetFromSnapshot(s, route.id);
     return target.mode === "providers" && target.provider ? target.provider : "unknown";
   }

   export function buildDestinations(s: RouteSettingsSnapshot, routes: ResolvedRoute[]): RouteDestination[] {
     const serverUrl =
       [...Object.values(s.stt).map((i) => i.remoteUrl), ...Object.values(s.llm).map((i) => i.remoteUrl)]
         .map((u) => u.trim())
         .find((u) => u && hostOf(u)) ?? null;
     const providerIds = new Set<string>();
     for (const route of routes) {
       const id = routeDestinationId(s, route);
       if (id !== "device" && id !== "network" && id !== "unknown") providerIds.add(id);
     }
     // savedKeys also holds internal credential ids such as "corti:speech"; skip them.
     for (const id of s.savedKeys) if (!id.includes(":")) providerIds.add(id);
     const providers = [...providerIds]
       .map<RouteDestination>((id) => ({
         id,
         locality: "remote",
         providerId: id,
         name: providerDisplayName(id),
         host: providerHost(id),
         url: null,
         hasKey: id === "custom" || (s.savedKeys.has(id) && !s.rejectedKeys.has(id)),
       }))
       .sort((a, b) => a.name.localeCompare(b.name));
     return [
       { id: "device", locality: "device", providerId: null, name: "device", host: null, url: null, hasKey: true },
       {
         id: "network",
         locality: "network",
         providerId: null,
         name: "network",
         host: serverUrl ? hostOf(serverUrl) : null,
         url: serverUrl,
         hasKey: true,
       },
       ...providers,
     ];
   }

   export function checkCompatibility(routeId: RouteId, dest: RouteDestination): Compatibility {
     if (routeId === "speakerId" || routeId === "semanticSearch") {
       return { ok: false, reasonKey: `patchbay.locked.${routeId}` };
     }
     if (routeId === "assistantVision" && dest.locality !== "remote") {
       return { ok: false, reasonKey: "patchbay.no.visionCloudOnly" };
     }
     if (dest.id === "device") return { ok: true };
     if (dest.id === "network") {
       // Note recording's self-hosted option is not available yet (MeetingSettings.tsx:89).
       return routeId === "noteRecordingStt"
         ? { ok: false, reasonKey: "patchbay.no.meetingServer" }
         : { ok: true };
     }
     if (dest.providerId && providersForRoute(routeId).includes(dest.providerId)) return { ok: true };
     return { ok: false, reasonKey: "patchbay.no.capability", params: { provider: dest.name } };
   }

   export function targetForDestination(s: RouteSettingsSnapshot, routeId: RouteId, dest: RouteDestination): RouteTarget {
     if (dest.id === "device") return { mode: "local" };
     if (dest.id === "network") {
       const current = targetFromSnapshot(s, routeId);
       if (current.mode === "self-hosted" && current.remoteUrl) return { mode: "self-hosted", remoteUrl: current.remoteUrl };
       // Only reuse a server that serves the same kind of task: speech audio must
       // never be pointed at an LLM server, or chat at a Whisper server.
       const pool =
         capabilityOf(routeId) === "speech"
           ? Object.values(s.stt).map((i) => i.remoteUrl)
           : Object.values(s.llm).map((i) => i.remoteUrl);
       return { mode: "self-hosted", remoteUrl: pool.map((u) => u.trim()).find((u) => u && hostOf(u)) ?? "" };
     }
     return { mode: "providers", provider: dest.providerId ?? dest.id };
   }

   export function privacyTally(routes: ResolvedRoute[]) {
     let stay = 0;
     let network = 0;
     let remote = 0;
     for (const r of routes) {
       if (r.sends === null) stay++;
       else if (r.locality === "network") network++;
       else remote++;
     }
     return { total: routes.length, stay, network, remote };
   }

   export function cablePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
     return `M ${from.x} ${from.y} C ${from.x + 120} ${from.y}, ${to.x - 120} ${to.y}, ${to.x} ${to.y}`;
   }
   ```

3. Create `src/components/settings/routing/Patchbay.tsx`. The view is pure props, and the container wires hooks and measures cables:

   ```tsx
   import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { useResolvedRoutes, type ResolvedRoute, type RouteId } from "../../../lib/routes";
   import { currentRouteSnapshot, useRouteDraftStore } from "../../../stores/routeDraftStore";
   import { ChevronRight, Lock } from "../../icons";
   import { LocalityRing } from "../../ui/LocalityRing";
   import { RouteDestinationChip, RouteStateChip } from "./RouteChips";
   import {
     buildDestinations,
     cablePath,
     checkCompatibility,
     privacyTally,
     routeDestinationId,
     targetForDestination,
     type RouteDestination,
   } from "./destinations";
   import { useRouteChange } from "./useRouteChange";

   export interface PatchbayViewProps {
     routes: ResolvedRoute[];
     destinations: RouteDestination[];
     destinationOf: (route: ResolvedRoute) => string;
     selectedId: RouteId | null;
     stagedRouteId: RouteId | null;
     message: string | null;
     wide: boolean;
     cables?: { id: RouteId; d: string; locality: string; paused: boolean; staged: boolean }[];
     boardRef?: React.Ref<HTMLDivElement>;
     onSelectTask: (id: RouteId) => void;
     onPickDestination: (dest: RouteDestination) => void;
     onOpenSettings: (route: ResolvedRoute) => void;
   }

   const GROUPS: { key: "speech" | "text" | "support"; kind: ResolvedRoute["kind"] }[] = [
     { key: "speech", kind: "speech" },
     { key: "text", kind: "text" },
     { key: "support", kind: "support" },
   ];

   export function PatchbayView(props: PatchbayViewProps) {
     const { t } = useTranslation();
     const { routes, destinations, selectedId, wide } = props;
     const selected = routes.find((r) => r.id === selectedId) ?? null;
     const tally = privacyTally(routes);
     const leaving = routes.filter((r) => r.sends !== null);
     const destName = (d: RouteDestination) =>
       d.id === "device"
         ? t("locality.device")
         : d.id === "network"
           ? t("locality.network")
           : providerDisplayLabel(d.providerId, t);

     return (
       <div className="space-y-3">
         <p role="status" aria-live="polite" className="text-xs text-muted-foreground min-h-4">
           {props.message ??
             (selected
               ? t("patchbay.hint.pickDestination", { task: t(`routes.names.${selected.id}`) })
               : t("patchbay.hint.idle"))}
         </p>
         <div
           ref={props.boardRef}
           data-layout={wide ? "board" : "list"}
           data-escape-active={selectedId ? "true" : "false"}
           className="patchbay-board relative"
         >
           {wide && (
             <svg aria-hidden="true" className="patchbay-cables">
               {(props.cables ?? []).map((c) => (
                 <path
                   key={c.id}
                   d={c.d}
                   data-locality={c.locality}
                   data-paused={c.paused ? "true" : "false"}
                   data-staged={c.staged ? "true" : "false"}
                   data-dim={selectedId && selectedId !== c.id ? "true" : "false"}
                 />
               ))}
             </svg>
           )}
           <div role="group" aria-label={t("patchbay.tasks")} className="patchbay-tasks">
             {GROUPS.map((group) => (
               <div key={group.key} className="space-y-1">
                 <p className="text-[11px] font-semibold text-muted-foreground px-1">{t(`routes.groups.${group.key}`)}</p>
                 {routes
                   .filter((r) => r.kind === group.kind)
                   .map((route) => {
                     const locked = route.kind === "support";
                     return (
                       <div key={route.id} className="flex items-center gap-1">
                         <button
                           type="button"
                           data-task={route.id}
                           aria-pressed={selectedId === route.id}
                           aria-disabled={locked || undefined}
                           title={locked ? t(`patchbay.locked.${route.id}`) : undefined}
                           onClick={() => props.onSelectTask(route.id)}
                           data-staged={props.stagedRouteId === route.id ? "true" : "false"}
                           className="patchbay-task"
                         >
                           <span className="min-w-0 flex-1 text-start">
                             <span className="block text-xs font-semibold text-foreground truncate">
                               {t(`routes.names.${route.id}`)}
                             </span>
                             <RouteDestinationChip route={route} className="h-5" />
                           </span>
                           {locked ? (
                             <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                               <Lock className="h-3 w-3" aria-hidden="true" />
                               <span className="sr-only">{t(`patchbay.locked.${route.id}`)}</span>
                             </span>
                           ) : (
                             <RouteStateChip state={route.state} />
                           )}
                           <span className="patchbay-jack" data-jack={`task:${route.id}`} data-locality={route.locality} aria-hidden="true" />
                         </button>
                         <button
                           type="button"
                           onClick={() => props.onOpenSettings(route)}
                           aria-label={t("patchbay.openSettings", { task: t(`routes.names.${route.id}`) })}
                           className="h-7 w-7 shrink-0 rounded-md grid place-items-center text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                         >
                           <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                         </button>
                       </div>
                     );
                   })}
               </div>
             ))}
           </div>
           <div role="group" aria-label={t("patchbay.destinations")} className="patchbay-destinations">
             {destinations.map((dest) => {
               const compat = selected ? checkCompatibility(selected.id, dest) : null;
               const count = routes.filter((r) => r.state.status !== "off" && props.destinationOf(r) === dest.id).length;
               return (
                 <button
                   key={dest.id}
                   type="button"
                   data-destination={dest.id}
                   data-compat={compat ? (compat.ok ? "ok" : "no") : undefined}
                   aria-disabled={compat && compat.ok === false ? true : undefined}
                   title={compat && compat.ok === false ? t(compat.reasonKey, compat.params) : undefined}
                   data-locality={dest.locality}
                   onClick={() => props.onPickDestination(dest)}
                   className="patchbay-destination"
                 >
                   <span className="patchbay-jack" data-jack={`dest:${dest.id}`} data-locality={dest.locality} aria-hidden="true" />
                   <span className="flex items-center justify-between gap-2">
                     <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                       <LocalityRing
                         locality={dest.locality}
                         label={dest.locality === "remote" ? t("locality.remote", { provider: destName(dest) }) : destName(dest)}
                         provider={dest.locality === "remote" ? destName(dest) : null}
                         size={16}
                       />
                       {destName(dest)}
                     </span>
                     <span className="text-[11px] text-muted-foreground">{t("patchbay.taskCount", { count })}</span>
                   </span>
                   {dest.host && (
                     <span className="block font-mono text-[11px] text-muted-foreground truncate" dir="ltr">
                       {dest.host}
                     </span>
                   )}
                   <span className="block text-[11px] text-muted-foreground">
                     {dest.locality === "device"
                       ? t("patchbay.dest.nothingLeaves")
                       : dest.locality === "network"
                         ? dest.url?.startsWith("http:")
                           ? t("patchbay.dest.unencrypted")
                           : t("patchbay.dest.yourServer")
                         : dest.hasKey
                           ? t("patchbay.dest.keySaved")
                           : t("patchbay.dest.noKey")}
                   </span>
                   {compat && compat.ok === false && <span className="sr-only">{t(compat.reasonKey, compat.params)}</span>}
                 </button>
               );
             })}
           </div>
         </div>
         <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 sm:grid-cols-[minmax(240px,1fr)_1.4fr]">
           <div>
             <div
               role="img"
               aria-label={t("patchbay.meter.label", { count: tally.stay, total: tally.total })}
               className="flex gap-1"
             >
               {routes.map((r) => (
                 <span
                   key={r.id}
                   className="patchbay-meter-seg"
                   data-locality={r.sends === null ? "device" : r.locality}
                 />
               ))}
             </div>
             <p className="mt-2 text-xs">
               {t("patchbay.meter.headline", { count: tally.stay, total: tally.total })}
               {tally.network > 0 && ` · ${t("patchbay.meter.network", { count: tally.network })}`}
             </p>
           </div>
           <p className="text-xs text-muted-foreground">
             {leaving.length === 0
               ? t("patchbay.leaves.none")
               : `${t("patchbay.leaves.prefix")} ${leaving
                   .map((r) =>
                     t("patchbay.leaves.item", {
                       task: t(`routes.names.${r.id}`),
                       destination: r.locality === "network" ? t("locality.network") : providerDisplayLabel(r.providerId, t),
                     })
                   )
                   .join(" · ")}`}
           </p>
         </div>
       </div>
     );
   }

   export function Patchbay({ onNavigateToPath }: { onNavigateToPath?: (path: string) => void }) {
     const { t } = useTranslation();
     const routes = useResolvedRoutes();
     const { request, sends } = useRouteChange();
     const draft = useRouteDraftStore((s) => s.draft);
     const [selectedId, setSelectedId] = useState<RouteId | null>(null);
     const [message, setMessage] = useState<string | null>(null);
     const [wide, setWide] = useState(true);
     const [cables, setCables] = useState<PatchbayViewProps["cables"]>([]);
     const boardRef = useRef<HTMLDivElement>(null);

     // `routes` changes whenever settings or facts change; rebuild the snapshot with it.
     // eslint-disable-next-line react-hooks/exhaustive-deps
     const snapshot = useMemo(() => currentRouteSnapshot(sends), [sends, routes]);
     const destinations = useMemo(() => buildDestinations(snapshot, routes), [snapshot, routes]);
     const destinationOf = useCallback((r: ResolvedRoute) => routeDestinationId(snapshot, r), [snapshot]);

     const measure = useCallback(() => {
       const board = boardRef.current;
       if (!board) return;
       const box = board.getBoundingClientRect();
       setWide(box.width >= 720);
       const center = (el: Element | null) => {
         if (!el) return null;
         const r = el.getBoundingClientRect();
         return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
       };
       const rtl = getComputedStyle(board).direction === "rtl";
       setCables(
         routes
           .filter((r) => r.state.status !== "off")
           .map((r) => {
             const destId = draft?.routeId === r.id ? null : destinationOf(r);
             const from = center(board.querySelector(`[data-jack="task:${r.id}"]`));
             const to = center(board.querySelector(`[data-jack="dest:${destId ?? "network"}"]`));
             if (!from || !to || !destId) return null;
             const [a, b] = rtl ? [to, from] : [from, to];
             return {
               id: r.id,
               d: cablePath(a, b),
               locality: r.locality,
               paused: r.state.status !== "ready",
               staged: false,
             };
           })
           .filter((c): c is NonNullable<typeof c> => c !== null)
       );
     }, [routes, draft, destinationOf]);

     useLayoutEffect(() => {
       measure();
       const board = boardRef.current;
       if (!board || typeof ResizeObserver === "undefined") return;
       const observer = new ResizeObserver(() => measure());
       observer.observe(board);
       return () => observer.disconnect();
     }, [measure]);

     const onSelectTask = (id: RouteId) => {
       const route = routes.find((r) => r.id === id)!;
       if (route.kind === "support") {
         setMessage(t(`patchbay.locked.${id}`));
         return;
       }
       setMessage(null);
       setSelectedId((cur) => (cur === id ? null : id));
     };

     const onPickDestination = (dest: RouteDestination) => {
       if (!selectedId) {
         setMessage(t("patchbay.hint.pickTaskFirst"));
         return;
       }
       const route = routes.find((r) => r.id === selectedId)!;
       const compat = checkCompatibility(selectedId, dest);
       if (compat.ok === false) {
         setMessage(t(compat.reasonKey, compat.params));
         return;
       }
       if (destinationOf(route) === dest.id && route.state.status !== "off") {
         setMessage(
           t("patchbay.hint.already", {
             task: t(`routes.names.${route.id}`),
             destination:
               dest.id === "device"
                 ? t("locality.device")
                 : dest.id === "network"
                   ? t("locality.network")
                   : providerDisplayLabel(dest.providerId, t),
           })
         );
         return;
       }
       request(selectedId, targetForDestination(snapshot, selectedId, dest));
       setSelectedId(null);
       setMessage(null);
     };

     return (
       <div
         onKeyDown={(e) => {
           if (e.key === "Escape" && selectedId) {
             setSelectedId(null);
             setMessage(null);
           }
         }}
       >
         <PatchbayView
           routes={routes}
           destinations={destinations}
           destinationOf={destinationOf}
           selectedId={selectedId}
           stagedRouteId={draft?.routeId ?? null}
           message={message}
           wide={wide}
           cables={cables}
           boardRef={boardRef}
           onSelectTask={onSelectTask}
           onPickDestination={onPickDestination}
           onOpenSettings={(route) => onNavigateToPath?.(route.settingsPath)}
         />
       </div>
     );
   }
   ```

   The staged change itself is shown by the modal-level Apply bar (Task 6). The task row shows a dashed outline through `data-staged`.

4. Create `src/components/settings/routing/RoutingSection.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { useRouteDraftStore } from "../../../stores/routeDraftStore";
   import { SectionHeader } from "../../ui/SettingsSection";
   import { Patchbay } from "./Patchbay";
   import { StagedRoutePanel } from "./StagedRoutePanel";

   export function RoutingSection({ onNavigateToPath }: { onNavigateToPath?: (path: string) => void }) {
     const { t } = useTranslation();
     const draft = useRouteDraftStore((s) => s.draft);
     return (
       <div className="space-y-6">
         <div>
           <SectionHeader title={t("patchbay.title")} description={t("patchbay.description")} />
           <Patchbay onNavigateToPath={onNavigateToPath} />
           {/* A staged pick needs its provider, key or URL right here; the Apply bar alone is a dead end. */}
           {draft && (
             <div className="mt-3">
               <StagedRoutePanel routeId={draft.routeId} />
             </div>
           )}
         </div>
       </div>
     );
   }
   ```

   Task 9 appends the keyring below the Patchbay.

5. Append to `src/index.css`, after the `.locality-ring` block:

   ```css
   /* Patchbay (DESIGN.md "Settings · Routing"). The list is the DOM; cables
      are decoration. Shape carries locality: solid device, dotted network,
      dashed remote. */
   .patchbay-board[data-layout="board"] {
     display: grid;
     grid-template-columns: minmax(250px, 300px) minmax(48px, 1fr) minmax(240px, 300px);
   }
   .patchbay-board[data-layout="board"] .patchbay-tasks { grid-column: 1; }
   .patchbay-board[data-layout="board"] .patchbay-destinations { grid-column: 3; }
   .patchbay-board[data-layout="list"] { display: grid; gap: 1rem; }
   .patchbay-board[data-layout="list"] .patchbay-jack { display: none; }
   .patchbay-tasks, .patchbay-destinations { display: grid; gap: 0.75rem; align-content: start; }
   .patchbay-destinations { gap: 0.5rem; }
   .patchbay-task, .patchbay-destination {
     position: relative;
     display: flex;
     width: 100%;
     align-items: center;
     gap: 0.5rem;
     min-height: 44px;
     padding: 0.25rem 1.25rem 0.25rem 0.625rem;
     border-radius: 10px;
     border: 1px solid var(--color-border);
     background: var(--color-card);
     text-align: start;
   }
   .patchbay-destination {
     display: block;
     min-height: 62px;
     padding: 0.5rem 0.75rem 0.5rem 1rem;
   }
   .patchbay-destination[data-locality="remote"] { border-style: dashed; }
   .patchbay-task[aria-pressed="true"] { border-color: var(--color-ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-ring) 20%, transparent); }
   .patchbay-task[data-staged="true"] { border: 1.5px dashed var(--color-locality-remote); }
   .patchbay-task[aria-disabled="true"] { background: var(--color-muted); color: var(--color-muted-foreground); }
   .patchbay-destination[data-compat="ok"] { border: 2px solid var(--color-ring); }
   .patchbay-destination[data-compat="no"] { opacity: 0.45; }
   .patchbay-task:focus-visible, .patchbay-destination:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }
   .patchbay-jack {
     position: absolute;
     top: 50%;
     width: 18px;
     height: 18px;
     margin-top: -9px;
     border-radius: 9999px;
     border: 2.5px solid var(--color-locality-device);
     background: var(--color-background);
   }
   .patchbay-task .patchbay-jack { inset-inline-end: -9px; }
   .patchbay-destination .patchbay-jack { inset-inline-start: -9px; }
   .patchbay-jack[data-locality="network"] { border-color: var(--color-locality-network); border-style: dotted; }
   .patchbay-jack[data-locality="remote"] { border-color: var(--color-locality-remote); border-style: dashed; }
   .patchbay-cables {
     position: absolute;
     inset: 0;
     width: 100%;
     height: 100%;
     overflow: visible;
     pointer-events: none;
   }
   .patchbay-cables path {
     fill: none;
     stroke: var(--color-locality-device);
     stroke-width: 2.4;
     stroke-linecap: round;
     animation: patchbay-cable-in var(--motion-base) var(--motion-ease-enter) both;
     transition: opacity var(--motion-fast) var(--motion-ease-std);
   }
   .patchbay-cables path[data-locality="network"] { stroke: var(--color-locality-network); stroke-dasharray: 0.5 5; }
   .patchbay-cables path[data-locality="remote"] { stroke: var(--color-locality-remote); stroke-dasharray: 6 5; }
   .patchbay-cables path[data-paused="true"] { opacity: 0.55; stroke-dasharray: 2 6; }
   .patchbay-cables path[data-dim="true"] { opacity: 0.16; }
   .patchbay-meter-seg { flex: 1; height: 6px; border-radius: 3px; background: var(--color-locality-device); }
   .patchbay-meter-seg[data-locality="network"] { background: var(--color-locality-network); }
   .patchbay-meter-seg[data-locality="remote"] {
     background: repeating-linear-gradient(135deg, var(--color-locality-remote) 0 3px, transparent 3px 5px);
     outline: 1px solid var(--color-locality-remote);
     outline-offset: -1px;
   }
   @keyframes patchbay-cable-in { from { opacity: 0; } }
   ```

   This is opacity-only, so reduced motion needs no override: the existing policy keeps opacity feedback. No loop runs. The mock's "flowing" dashes are not shipped, because the app has no live-request signal to gate them on, and a loop must be gated to its active state (§4).

6. Wire the section:
   - `SettingsSectionType`: `"general" | "hotkeys" | "routing" | "speechToText" | "llms" | "privacyData" | "system"`.
   - `renderSectionContent`: add `case "routing": return <RoutingSection onNavigateToPath={onNavigateToPath} />;` directly after the `hotkeys` case and before `case "speechToText":`. Task 12's structure test relies on this order.
   - `settingsPaths.ts`: insert `"routing"` after `"hotkeys"` in `SETTINGS_SECTIONS`, and add `routes: "routing"` to `SECTION_ALIASES`.
   - `SettingsModal.tsx` sidebar items: insert this before the `speechToText` item:

     ```tsx
     {
       id: "routing",
       label: t("settingsModal.sections.routing.label"),
       icon: Waypoints,
       description: t("settingsModal.sections.routing.description"),
       group: t("settingsModal.groups.aiModels"),
     },
     ```

     Import `Waypoints` from `./icons`.

7. In `src/components/ui/SidebarModal.tsx`:
   - Change `max-w-4xl` to `max-w-5xl` on the dialog content (`:121-135`).
   - Extend the existing `onEscapeKeyDown` on `DialogPrimitive.Content` (`SidebarModal.tsx:123-125`, which guards hotkey capture). Keep that guard:

     ```tsx
     onEscapeKeyDown={(e) => {
       if (document.querySelector("[data-capturing]")) e.preventDefault();
       // A widget with a transient state (Patchbay selection, search query)
       // claims Escape while that state exists; the dialog closes on the next press.
       const active = document.activeElement;
       if (active instanceof Element && active.closest('[data-escape-active="true"]')) e.preventDefault();
     }}
     ```

8. Write `/tmp/loqui-i18n-task-7.json` and merge it. The `en` block is below. `taskCount` and `meter.*` need every plural category per locale (Global Constraints).

   ```json
   {
     "settingsModal": { "sections": { "routing": { "label": "Routing", "description": "Where each task runs" } } },
     "patchbay": {
       "title": "Routing",
       "description": "Every task, and where it runs right now. Moves to this device apply instantly; moves to a server or provider wait for you to apply them.",
       "tasks": "Tasks",
       "destinations": "Destinations",
       "openSettings": "Open {{task}} settings",
       "hint": {
         "idle": "Choose a task, then where it should run.",
         "pickDestination": "Send {{task}} to… choose a highlighted destination.",
         "pickTaskFirst": "Choose a task first, then where it should run.",
         "already": "{{task}} already runs on {{destination}}."
       },
       "locked": {
         "speakerId": "Locked to this device: speaker identification needs your recordings on-device.",
         "semanticSearch": "Locked to this device: embeddings stay local, so search never sends your notes anywhere."
       },
       "no": {
         "capability": "{{provider}} can't run this task in Loqui.",
         "visionCloudOnly": "Screenshots can only go to a cloud vision model today.",
         "meetingServer": "Note recording can't use your own server yet."
       },
       "dest": {
         "nothingLeaves": "Nothing leaves",
         "yourServer": "Your own server",
         "unencrypted": "http, not encrypted",
         "keySaved": "API key saved",
         "noKey": "No API key yet"
       },
       "taskCount_one": "{{count}} task",
       "taskCount_other": "{{count}} tasks",
       "meter": {
         "label_one": "{{count}} of {{total}} task stays on this device",
         "label_other": "{{count}} of {{total}} tasks stay on this device",
         "headline_one": "{{count}} of {{total}} task stays on this device",
         "headline_other": "{{count}} of {{total}} tasks stay on this device",
         "network_one": "{{count}} on your server",
         "network_other": "{{count}} on your server"
       },
       "leaves": {
         "none": "Nothing leaves this device.",
         "prefix": "Leaves this device:",
         "item": "{{task}} → {{destination}}"
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/patchbayDestinations.test.js test/components/patchbay.test.js test/lib/settingsPaths.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually in the app, light and Plum Night, comparing against card R1 B (`05-settings.html:197-221`):
- Routing lists 11 tasks.
- Click Chat, then "This device": it applies instantly with an Undo toast.
- Click Chat, then a provider: the Apply bar appears.
- Click Dictation, and Anthropic dims with a reason.
- Esc clears the selection without closing Settings. A second Esc closes it.
- Narrow the window until the cables disappear.
- With reduced motion on, there is no motion beyond fades.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/routing src/components/SettingsPage.tsx src/components/SettingsModal.tsx src/components/ui/SidebarModal.tsx src/lib/settingsPaths.ts src/components/icons/index.ts src/index.css src/locales test/components/patchbayDestinations.test.js test/components/patchbay.test.js
git commit -m "feat(settings): Routing page with the Patchbay switchboard"
```

---

### Task 8: Keyring in main: health table, verify IPC and rotation reminders (SET-R5 C, main half)

Verifying a key sends it to the provider, which is a network event (`docs/PRIVACY.md:51`). So verification is always an explicit request from the renderer, runs in main with the stored key, and returns only a health result. A save never verifies. The key itself is always kept, even when it is rejected (preserve content).

**Files:**
- Modify: `src/helpers/localDatabaseSchema.js`. Append the `provider_key_health` table before the closing backtick (`:329`).
- Modify: `src/helpers/database.js`. Add `getKeyHealth`, `saveKeyHealth` and `deleteKeyHealth` next to the other small accessors, for example after `getAction` (`:1504-1508`).
- Create: `src/helpers/keyring.js`
- Modify: `src/helpers/ipcHandlers.js`:
  - extract the `test-provider-connection` handler body (`:1081-1152`) into a method `_runProviderConnectionTest(config)`;
  - create the keyring at the start of `setupHandlers()` (`:1011`);
  - mark keys unverified on save (`:1244-1251`);
  - register the three `keyring-*` channels;
  - start the reminder timer.
- Modify: `preload.js`. Add a `keyring` namespace next to `personalInference` (`:78`).
- Modify: `src/types/electron.ts`. Add `keyring` to `electronAPI` after the `privacy?` block (Task 2), plus the `KeyringEntry` type.
- Modify: `src/preview/browserPreview.ts`. Add a `keyring` stub that rejects like the other desktop-only calls (pattern at `:140`).
- Modify: `docs/PRIVACY.md`. In "When network requests occur" (`:42`), extend the connection-check row at `:51`.
- Modify: `src/locales/*/translation.json`. Add `keyring.reminder.*`, used by main through `i18nMain`.
- Test: `test/helpers/keyring.test.js`, `test/helpers/keyHealthDatabase.test.js`

**Interfaces:**
- Consumes:
  - `BYOK_API_KEYS` (`src/config/secretKeys.js:122`), whose entries are `{ base, env, get, save, storeKey }`;
  - `this.environmentManager[k.get]()`;
  - the existing `testProviderConnection` flow, via the extracted method;
  - `i18nMain` (`src/helpers/i18nMain.js:139`) and Electron's `Notification`.
- Produces:

  ```js
  // src/helpers/keyring.js
  const KEYRING_PROVIDERS; // ["openai","anthropic","gemini","groq","xai","mistral","openrouter","tinfoil","corti","deepgram","assemblyai"]
  const ROTATION_DAYS = 90;
  function classifyResult(result) → { status, errorCode, httpStatus }
  function createKeyring({ store, hasKey, runTest, now }) → {
    list(): KeyringEntry[];                       // saved keys only, in KEYRING_PROVIDERS order
    verify(provider): Promise<KeyringEntry>;
    setReminder(provider, enabled): KeyringEntry;
    markUnverified(provider): void;
    forget(provider): void;
    takeDueReminders(): string[];                 // providers due now; marks them reminded
  }
  function startRotationReminders({ keyring, notify, intervalMs, setIntervalImpl, setTimeoutImpl }) → () => void
  module.exports = { KEYRING_PROVIDERS, ROTATION_DAYS, classifyResult, createKeyring, startRotationReminders };
  ```

  ```ts
  // src/types/electron.ts
  export type KeyHealthStatus = "unverified" | "verified" | "rejected" | "unreachable";
  export interface KeyringEntry {
    provider: string;
    status: KeyHealthStatus;
    lastVerifiedAt: number | null;   // ms epoch of the last attempt that reached a verdict
    lastErrorCode: string | null;    // errorCode from providerConnectionTest.js
    lastErrorStatus: number | null;  // HTTP status when known
    reminderDueAt: number | null;
  }
  // window.electronAPI.keyring
  keyring: {
    list: () => Promise<KeyringEntry[]>;
    verify: (provider: string) => Promise<KeyringEntry>;
    setReminder: (provider: string, enabled: boolean) => Promise<KeyringEntry>;
  };
  ```

  The IPC channels are `keyring-list`, `keyring-verify` and `keyring-set-reminder`. Task 2's facts store already reads `keyring?.list()` for `rejectedKeys`.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/keyring.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { classifyResult, createKeyring, startRotationReminders, KEYRING_PROVIDERS, ROTATION_DAYS } = require("../../src/helpers/keyring.js");

const DAY = 86_400_000;

function fakeStore() {
  const rows = new Map();
  return {
    rows,
    all: () => [...rows.values()],
    save: (row) => rows.set(row.provider, { ...row }),
    remove: (provider) => rows.delete(provider),
  };
}

function setup({ keys = ["openai", "groq"], result = { success: true } } = {}) {
  const store = fakeStore();
  let clock = 1_000_000;
  const calls = [];
  const keyring = createKeyring({
    store,
    hasKey: (p) => keys.includes(p),
    runTest: async (cfg) => {
      calls.push(cfg);
      return typeof result === "function" ? result(cfg) : result;
    },
    now: () => clock,
  });
  return { keyring, store, calls, tick: (ms) => (clock += ms), now: () => clock };
}

test("the keyring lists saved provider keys only, unverified until checked", () => {
  const { keyring } = setup();
  assert.deepEqual(keyring.list(), [
    { provider: "openai", status: "unverified", lastVerifiedAt: null, lastErrorCode: null, lastErrorStatus: null, reminderDueAt: null },
    { provider: "groq", status: "unverified", lastVerifiedAt: null, lastErrorCode: null, lastErrorStatus: null, reminderDueAt: null },
  ]);
  assert.ok(!KEYRING_PROVIDERS.some((p) => p.endsWith("-custom")));
});

test("verify uses the stored key in main and records the verdict, never the key", async () => {
  const { keyring, calls, store, now } = setup();
  const entry = await keyring.verify("openai");
  assert.deepEqual(calls, [{ scope: "reasoning", provider: "openai" }]);
  assert.equal(entry.status, "verified");
  assert.equal(entry.lastVerifiedAt, now());
  assert.ok(!JSON.stringify([...store.rows.values()]).includes("sk-"), "no key material is stored");
});

test("speech-only providers are verified as transcription", async () => {
  const { keyring, calls } = setup({ keys: ["deepgram"] });
  await keyring.verify("deepgram");
  assert.equal(calls[0].scope, "transcription");
});

test("a rejection keeps its code; a network failure is 'unreachable', not 'rejected'", async () => {
  const rejected = setup({ result: { success: false, errorCode: "credentialsRejected", status: 401 } });
  const r = await rejected.keyring.verify("groq");
  assert.deepEqual([r.status, r.lastErrorCode, r.lastErrorStatus], ["rejected", "credentialsRejected", 401]);
  const offline = setup({ result: { success: false, errorCode: "timeout" } });
  const o = await offline.keyring.verify("groq");
  assert.deepEqual([o.status, o.lastErrorCode], ["unreachable", "timeout"]);
  assert.deepEqual(classifyResult({ success: true }), { status: "verified", errorCode: null, httpStatus: null });
});

test("a test that throws is recorded as unreachable instead of crashing the IPC call", async () => {
  const { keyring } = setup({ result: () => { throw new Error("socket hang up"); } });
  const entry = await keyring.verify("openai");
  assert.equal(entry.status, "unreachable");
  assert.equal(entry.lastErrorCode, "network");
});

test("unknown providers and missing keys are refused without a network call", async () => {
  const { keyring, calls } = setup({ keys: [] });
  await assert.rejects(keyring.verify("evil"), /Unknown keyring provider/);
  const entry = await keyring.verify("openai");
  assert.equal(entry.status, "unverified");
  assert.equal(calls.length, 0);
});

test("saving a new key resets health but keeps the reminder; removing it forgets the row", async () => {
  const { keyring, store, now } = setup();
  await keyring.verify("openai");
  keyring.setReminder("openai", true);
  keyring.markUnverified("openai");
  const entry = keyring.list().find((e) => e.provider === "openai");
  assert.equal(entry.status, "unverified");
  assert.equal(entry.reminderDueAt, now() + ROTATION_DAYS * DAY);
  keyring.forget("openai");
  assert.equal(store.rows.has("openai"), false);
});

test("reminders fire once when due and can be switched off", () => {
  const { keyring, tick } = setup();
  keyring.setReminder("groq", true);
  assert.deepEqual(keyring.takeDueReminders(), []);
  tick(ROTATION_DAYS * DAY);
  assert.deepEqual(keyring.takeDueReminders(), ["groq"]);
  assert.deepEqual(keyring.takeDueReminders(), [], "only once");
  keyring.setReminder("groq", false);
  assert.equal(keyring.list().find((e) => e.provider === "groq").reminderDueAt, null);
});

test("the reminder loop notifies per due provider and stops cleanly", () => {
  const notified = [];
  let intervalFn;
  let timeoutFn;
  const stop = startRotationReminders({
    keyring: { takeDueReminders: () => ["openai"] },
    notify: (provider) => notified.push(provider),
    intervalMs: 1000,
    setIntervalImpl: (fn) => ((intervalFn = fn), 7),
    setTimeoutImpl: (fn) => ((timeoutFn = fn), 8),
    clearIntervalImpl: () => {},
    clearTimeoutImpl: () => {},
  });
  timeoutFn();
  intervalFn();
  assert.deepEqual(notified, ["openai", "openai"]);
  stop();
});

test("preload exposes exactly the keyring channels main registers", () => {
  const root = path.join(__dirname, "../..");
  const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
  const handlers = fs.readFileSync(path.join(root, "src/helpers/ipcHandlers.js"), "utf8");
  for (const channel of ["keyring-list", "keyring-verify", "keyring-set-reminder"]) {
    assert.match(preload, new RegExp(`invoke\\("${channel}"`), `preload ${channel}`);
    assert.match(handlers, new RegExp(`ipcMain\\.handle\\("${channel}"`), `main ${channel}`);
  }
});
```

Create `test/helpers/keyHealthDatabase.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
// The exact `require("./harness/db")` spelling routes this file to the
// non-tsx native group in scripts/run-tests.js.
const { createDb } = require("./harness/db");

test("key health rows round-trip and upsert by provider", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.deepEqual(db.getKeyHealth(), []);
  const row = {
    provider: "groq", status: "rejected", last_verified_at: 5, last_error_code: "credentialsRejected",
    last_error_status: 401, reminder_due_at: null, reminded_at: null, updated_at: 5,
  };
  db.saveKeyHealth(row);
  db.saveKeyHealth({ ...row, status: "verified", last_error_code: null, last_error_status: null, updated_at: 6 });
  assert.deepEqual(db.getKeyHealth(), [{ ...row, status: "verified", last_error_code: null, last_error_status: null, updated_at: 6 }]);
  db.deleteKeyHealth("groq");
  assert.deepEqual(db.getKeyHealth(), []);
});

test("the schema refuses unknown health states", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.throws(() =>
    db.saveKeyHealth({ provider: "x", status: "great", last_verified_at: null, last_error_code: null, last_error_status: null, reminder_due_at: null, reminded_at: null, updated_at: 1 })
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run native:node && npm test -- test/helpers/keyring.test.js test/helpers/keyHealthDatabase.test.js`
Expected: FAIL. `Cannot find module '../../src/helpers/keyring.js'`, and `db.getKeyHealth is not a function`.

- [ ] **Step 3: Implement**

1. In `src/helpers/localDatabaseSchema.js`, insert this before the closing `` `; `` at `:329`:

   ```sql
   CREATE TABLE IF NOT EXISTS provider_key_health (
     provider          TEXT PRIMARY KEY,
     status            TEXT NOT NULL CHECK (status IN ('unverified', 'verified', 'rejected', 'unreachable')),
     last_verified_at  INTEGER,
     last_error_code   TEXT,
     last_error_status INTEGER,
     reminder_due_at   INTEGER,
     reminded_at       INTEGER,
     updated_at        INTEGER NOT NULL
   );
   ```

   It stores no key material, URLs or request content. The schema has no migration system and runs `CREATE … IF NOT EXISTS` on every launch, so every column must be present now.

2. In `src/helpers/database.js`, add these after `getAction`:

   ```js
     getKeyHealth() {
       return this.db.prepare("SELECT * FROM provider_key_health ORDER BY provider").all();
     }

     saveKeyHealth(row) {
       this.db
         .prepare(
           `INSERT INTO provider_key_health
              (provider, status, last_verified_at, last_error_code, last_error_status, reminder_due_at, reminded_at, updated_at)
            VALUES (@provider, @status, @last_verified_at, @last_error_code, @last_error_status, @reminder_due_at, @reminded_at, @updated_at)
            ON CONFLICT(provider) DO UPDATE SET
              status = excluded.status,
              last_verified_at = excluded.last_verified_at,
              last_error_code = excluded.last_error_code,
              last_error_status = excluded.last_error_status,
              reminder_due_at = excluded.reminder_due_at,
              reminded_at = excluded.reminded_at,
              updated_at = excluded.updated_at`
         )
         .run(row);
     }

     deleteKeyHealth(provider) {
       this.db.prepare("DELETE FROM provider_key_health WHERE provider = ?").run(provider);
     }
   ```

3. Create `src/helpers/keyring.js`:

   ```js
   const { BYOK_API_KEYS } = require("../config/secretKeys");

   // Provider key health (SET-R5 C). Verification sends the stored key to the
   // provider, so it only runs on an explicit request; the renderer never sees
   // the key, only the verdict. Rows hold metadata only.

   const KEYRING_PROVIDERS = BYOK_API_KEYS.map((k) => k.base).filter((base) => !base.endsWith("-custom"));
   const SPEECH_ONLY = new Set(["deepgram", "assemblyai"]);
   const ROTATION_DAYS = 90;
   const DAY_MS = 86_400_000;

   function classifyResult(result) {
     if (result && result.success) return { status: "verified", errorCode: null, httpStatus: null };
     const errorCode = (result && result.errorCode) || "network";
     const httpStatus = (result && typeof result.status === "number" && result.status) || null;
     return { status: errorCode === "credentialsRejected" ? "rejected" : "unreachable", errorCode, httpStatus };
   }

   function toEntry(provider, row) {
     return {
       provider,
       status: row ? row.status : "unverified",
       lastVerifiedAt: row ? row.last_verified_at : null,
       lastErrorCode: row ? row.last_error_code : null,
       lastErrorStatus: row ? row.last_error_status : null,
       reminderDueAt: row ? row.reminder_due_at : null,
     };
   }

   function createKeyring({ store, hasKey, runTest, now = Date.now }) {
     const rowFor = (provider) => store.all().find((r) => r.provider === provider) || null;
     const blank = (provider) => ({
       provider,
       status: "unverified",
       last_verified_at: null,
       last_error_code: null,
       last_error_status: null,
       reminder_due_at: null,
       reminded_at: null,
       updated_at: now(),
     });
     const update = (provider, patch) => {
       const row = { ...(rowFor(provider) || blank(provider)), ...patch, updated_at: now() };
       store.save(row);
       return row;
     };
     const assertKnown = (provider) => {
       if (!KEYRING_PROVIDERS.includes(provider)) throw new Error(`Unknown keyring provider: ${provider}`);
     };

     return {
       list() {
         return KEYRING_PROVIDERS.filter((p) => hasKey(p)).map((p) => toEntry(p, rowFor(p)));
       },
       async verify(provider) {
         assertKnown(provider);
         if (!hasKey(provider)) return toEntry(provider, rowFor(provider));
         let result;
         try {
           result = await runTest({ scope: SPEECH_ONLY.has(provider) ? "transcription" : "reasoning", provider });
         } catch {
           result = { success: false, errorCode: "network" };
         }
         const verdict = classifyResult(result);
         const row = update(provider, {
           status: verdict.status,
           last_verified_at: now(),
           last_error_code: verdict.errorCode,
           last_error_status: verdict.httpStatus,
         });
         return toEntry(provider, row);
       },
       setReminder(provider, enabled) {
         assertKnown(provider);
         const row = update(provider, {
           reminder_due_at: enabled ? now() + ROTATION_DAYS * DAY_MS : null,
           reminded_at: null,
         });
         return toEntry(provider, row);
       },
       markUnverified(provider) {
         if (!KEYRING_PROVIDERS.includes(provider)) return;
         update(provider, { status: "unverified", last_error_code: null, last_error_status: null });
       },
       forget(provider) {
         store.remove(provider);
       },
       takeDueReminders() {
         const due = store
           .all()
           .filter((r) => r.reminder_due_at !== null && r.reminder_due_at <= now() && r.reminded_at === null && hasKey(r.provider));
         for (const r of due) update(r.provider, { reminded_at: now() });
         return due.map((r) => r.provider);
       },
     };
   }

   function startRotationReminders({
     keyring,
     notify,
     intervalMs = 6 * 60 * 60 * 1000,
     setIntervalImpl = setInterval,
     setTimeoutImpl = setTimeout,
     clearIntervalImpl = clearInterval,
     clearTimeoutImpl = clearTimeout,
   }) {
     const check = () => {
       for (const provider of keyring.takeDueReminders()) notify(provider);
     };
     const first = setTimeoutImpl(check, 60_000);
     const loop = setIntervalImpl(check, intervalMs);
     return () => {
       clearTimeoutImpl(first);
       clearIntervalImpl(loop);
     };
   }

   module.exports = { KEYRING_PROVIDERS, ROTATION_DAYS, classifyResult, createKeyring, startRotationReminders };
   ```

4. In `src/helpers/ipcHandlers.js`:
   - **Extract the test handler.** Move the whole body of `ipcMain.handle("test-provider-connection", async (_event, config) => { … })` (`:1081-1152`) into a class method `async _runProviderConnectionTest(config) { … }`. The body starts with `config = { ...config };` and ends with `return testProviderConnection(config);`. Then register the handler as:

     ```js
     ipcMain.handle("test-provider-connection", (_event, config) => this._runProviderConnectionTest(config));
     ```

   - **Create the keyring.** At the top of `setupHandlers()` (`:1011`), add:

     ```js
     const { createKeyring, startRotationReminders } = require("./keyring");
     const { Notification } = require("electron");
     this.keyring = createKeyring({
       store: {
         all: () => this.databaseManager.getKeyHealth(),
         save: (row) => this.databaseManager.saveKeyHealth(row),
         remove: (provider) => this.databaseManager.deleteKeyHealth(provider),
       },
       hasKey: (provider) => {
         const entry = BYOK_API_KEYS.find((k) => k.base === provider);
         return !!(entry && this.environmentManager[entry.get]());
       },
       runTest: (config) => this._runProviderConnectionTest(config),
     });
     this._stopKeyReminders = startRotationReminders({
       keyring: this.keyring,
       notify: (provider) => {
         if (!Notification.isSupported()) return;
         new Notification({
           title: i18nMain.t("keyring.reminder.title", { provider: providerName(provider) }),
           body: i18nMain.t("keyring.reminder.body"),
         }).show();
       },
     });
     ```

     If `ipcHandlers.js` does not already import `i18nMain`, add `const i18nMain = require("./i18nMain");` next to the other requires. Also define `providerName` near the top of the file:

     ```js
     // Display names for native notifications; mirrors src/lib/locality.ts PROVIDER_NAMES.
     const PROVIDER_NAMES = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", groq: "Groq", xai: "xAI", mistral: "Mistral", openrouter: "OpenRouter", tinfoil: "Tinfoil", corti: "Corti", deepgram: "Deepgram", assemblyai: "AssemblyAI" };
     const providerName = (id) => PROVIDER_NAMES[id] || id;
     ```

   - **Mark keys on save.** Change the save handler in the BYOK loop (`:1248-1250`) to:

     ```js
     ipcMain.handle(`save-${k.base}-key`, (event, key) => {
       if (key === "__stored__") return true;
       const result = this.environmentManager[k.save](key);
       // A new key has not been verified; an empty key removes the health row.
       if (key) this.keyring.markUnverified(k.base);
       else this.keyring.forget(k.base);
       return result;
     });
     ```

   - **Register the channels.** Next to `test-provider-connection`:

     ```js
     ipcMain.handle("keyring-list", () => this.keyring.list());
     ipcMain.handle("keyring-verify", (_event, provider) => this.keyring.verify(String(provider)));
     ipcMain.handle("keyring-set-reminder", (_event, provider, enabled) =>
       this.keyring.setReminder(String(provider), !!enabled)
     );
     ```

5. In `preload.js`, after the `personalInference: { … },` block that ends at `:98`, add:

   ```js
     keyring: {
       list: () => ipcRenderer.invoke("keyring-list"),
       verify: (provider) => ipcRenderer.invoke("keyring-verify", provider),
       setReminder: (provider, enabled) => ipcRenderer.invoke("keyring-set-reminder", provider, enabled),
     },
   ```

6. In `src/types/electron.ts`, export `KeyHealthStatus` and `KeyringEntry` (from Interfaces) at module level next to `InferenceMode` (`:18`). Add `keyring` to the `electronAPI` interface after the `privacy?` block.

7. In `src/preview/browserPreview.ts`, next to the `personalInference` stub (`:140`), add `keyring: { list: async () => [], verify: async () => { throw new Error(desktopMessage); }, setReminder: async () => { throw new Error(desktopMessage); } },`.

8. In `docs/PRIVACY.md`, replace the row at `:51` with:

   ```markdown
   | Provider connection/model checks and key verification | The selected provider receives your stored credentials and a model-list request. Loqui runs this only when you press Verify or Verify all, never when you save a key. The result (verified, rejected or unreachable, with time and HTTP status) is stored locally in the `provider_key_health` table; no key, URL or content is stored there |
   ```

9. Write `/tmp/loqui-i18n-task-8.json` and merge it. The `en` block is:

   ```json
   {
     "keyring": {
       "reminder": {
         "title": "Time to rotate your {{provider}} key",
         "body": "You asked Loqui to remind you after 90 days. Replace the key in Settings → Routing."
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/keyring.test.js test/helpers/keyHealthDatabase.test.js test/helpers/providerConnectionTest.test.js test/helpers/secretKeys.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS. The existing provider-connection and secret-key tests still pass, so the extraction did not change behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/localDatabaseSchema.js src/helpers/database.js src/helpers/keyring.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/preview/browserPreview.ts docs/PRIVACY.md src/locales test/helpers/keyring.test.js test/helpers/keyHealthDatabase.test.js
git commit -m "feat(keyring): Verify provider keys in main and record their health"
```

---

### Task 9: Keyring panel with health and Verify all (SET-R5 C, UI half)

The Routing page gains a **Keyring** below the Patchbay. It has one row per saved provider key, and each row shows:
- a status dot that is never colour alone (a labelled `role="img"`), or a spinner while checking;
- "Last verified 3 days ago" or "Never verified";
- the last error;
- which tasks are paused because of it;
- a per-row **Verify**;
- a "Remind in 90 days" switch.

**Verify all** runs the providers one after another with a visible per-row spinner. Verification is always a button, never automatic, and the tooltip says what it sends. A rejected key feeds `rejectedKeys` (Task 2), so the routes that use it turn into "Add API key" everywhere: the pill, the Patchbay and the editors.

**Files:**
- Create: `src/components/settings/routing/KeyringPanel.tsx`
- Modify: `src/components/settings/routing/RoutingSection.tsx`. Render `<KeyringPanel />` after the Patchbay.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/keyringPanel.test.js`

**Interfaces:**
- Consumes:
  - `window.electronAPI.keyring.{list,verify,setReminder}` and `KeyringEntry` (Task 8);
  - `refreshRouteFacts` (Task 2);
  - `useResolvedRoutes`, `currentRouteSnapshot` and `routeDestinationId` (Tasks 2, 5, 7);
  - `providerHost` (Task 6);
  - `providerDisplayLabel` (Plan 01);
  - `formatRelativeTime(dateStr, t, locale)` (`src/utils/dateFormatting.ts:41`);
  - `Toggle` (`src/components/ui/toggle.tsx`, props `{ checked, onChange, disabled?, "aria-label"? }`);
  - `useRouteFactsStore` for `facts.sealed`.
- Produces:

  ```ts
  export function pausedTasksByProvider(routes: ResolvedRoute[], destinationOf: (r: ResolvedRoute) => string): Record<string, RouteId[]>;
  export function keyringStatusLine(entry: KeyringEntry, pausedTaskNames: string[], t: TFunction, locale: string): { text: string; tone: "muted" | "error" };
  export function KeyringPanelView(props: KeyringPanelViewProps): JSX.Element;
  export function KeyringPanel(): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/components/keyringPanel.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const { withI18nMock } = require("../lib/i18nTestMock");
const tr = (k, o) => (o ? `${k}${JSON.stringify(o)}` : k);

test("keyring panel", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-keyring-panel-test-" }, { withOptions: true }));
  const k = await vite.ssrLoadModule("/components/settings/routing/KeyringPanel.tsx");
  const entry = (o) => ({ provider: "groq", status: "verified", lastVerifiedAt: null, lastErrorCode: null, lastErrorStatus: null, reminderDueAt: null, ...o });

  await t.test("paused tasks are the routes that use a provider and are not ready", () => {
    const routes = [
      { id: "chat", state: { status: "needsKey", provider: "Groq" } },
      { id: "dictationStt", state: { status: "ready" } },
      { id: "translation", state: { status: "needsKey", provider: "Groq" } },
    ];
    const map = k.pausedTasksByProvider(routes, (r) => (r.id === "dictationStt" ? "device" : "groq"));
    assert.deepEqual(map, { groq: ["chat", "translation"] });
  });

  await t.test("status lines say when, what failed and what it breaks", () => {
    assert.deepEqual(k.keyringStatusLine(entry({ status: "unverified" }), [], tr, "en"), { text: "keyring.never", tone: "muted" });
    const rejected = k.keyringStatusLine(
      entry({ status: "rejected", lastVerifiedAt: Date.now() - 120000, lastErrorCode: "credentialsRejected", lastErrorStatus: 401 }),
      ["Chat"], tr, "en"
    );
    assert.equal(rejected.tone, "error");
    assert.match(rejected.text, /keyring\.rejected\{"status":401\}/);
    assert.match(rejected.text, /keyring\.paused\{"tasks":"Chat"\}/);
    assert.match(rejected.text, /keyring\.lastVerified.*minutesAgo/);
    const unreachable = k.keyringStatusLine(entry({ status: "unreachable", lastVerifiedAt: Date.now(), lastErrorCode: "timeout" }), [], tr, "en");
    assert.match(unreachable.text, /keyring\.unreachable\{"host":"api\.groq\.com"\}/);
  });

  await t.test("rows expose status in words, a named reminder switch and an explicit verify button", () => {
    const html = renderToStaticMarkup(React.createElement(k.KeyringPanelView, {
      entries: [entry({ provider: "groq", status: "rejected", lastErrorCode: "credentialsRejected", lastErrorStatus: 401, lastVerifiedAt: Date.now() }), entry({ provider: "openai", status: "unverified" })],
      paused: { groq: ["Chat"] },
      checking: "openai",
      progress: { current: 2, total: 2 },
      sealed: false,
      onVerify() {}, onVerifyAll() {}, onReminder() {},
    }));
    assert.match(html, /role="img"[^>]*aria-label="keyring\.status\.rejected"/);
    assert.match(html, /aria-label="keyring\.remindLabel\{&quot;provider&quot;:&quot;Groq&quot;\}"/);
    assert.match(html, /keyring\.verifyingAll\{&quot;current&quot;:2,&quot;total&quot;:2\}/);
    assert.match(html, /title="keyring\.verifyTooltip\{&quot;host&quot;:&quot;api\.groq\.com&quot;\}"/);
    assert.match(html, /data-provider="openai"[^>]*data-checking="true"/);
  });

  await t.test("sealed mode disables verification and says why", () => {
    const html = renderToStaticMarkup(React.createElement(k.KeyringPanelView, {
      entries: [entry({})], paused: {}, checking: null, progress: null, sealed: true,
      onVerify() {}, onVerifyAll() {}, onReminder() {},
    }));
    assert.match(html, /keyring\.sealed/);
    assert.ok((html.match(/disabled=""/g) ?? []).length >= 2);
  });

  await t.test("no saved keys says everything runs locally", () => {
    const html = renderToStaticMarkup(React.createElement(k.KeyringPanelView, {
      entries: [], paused: {}, checking: null, progress: null, sealed: false, onVerify() {}, onVerifyAll() {}, onReminder() {},
    }));
    assert.match(html, /keyring\.empty/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/components/keyringPanel.test.js`
Expected: FAIL. The module is missing.

- [ ] **Step 3: Implement**

1. Create `src/components/settings/routing/KeyringPanel.tsx`:

   ```tsx
   import { useCallback, useEffect, useMemo, useState } from "react";
   import type { TFunction } from "i18next";
   import { useTranslation } from "react-i18next";
   import { providerDisplayLabel } from "../../../lib/locality";
   import { routeSendsCopy, useResolvedRoutes, type ResolvedRoute, type RouteId } from "../../../lib/routes";
   import { currentRouteSnapshot } from "../../../stores/routeDraftStore";
   import { refreshRouteFacts, useRouteFactsStore } from "../../../stores/routeFactsStore";
   import type { KeyringEntry } from "../../../types/electron";
   import { formatRelativeTime } from "../../../utils/dateFormatting";
   import { Loader2 } from "../../icons";
   import { Button } from "../../ui/button";
   import { Toggle } from "../../ui/toggle";
   import { routeDestinationId } from "./destinations";
   import { providerHost } from "./providerCatalog";

   type Tr = TFunction | ((k: string, o?: Record<string, unknown>) => string);

   export function pausedTasksByProvider(
     routes: Pick<ResolvedRoute, "id" | "state">[],
     destinationOf: (r: Pick<ResolvedRoute, "id" | "state">) => string
   ): Record<string, RouteId[]> {
     const map: Record<string, RouteId[]> = {};
     for (const r of routes) {
       if (r.state.status !== "needsKey") continue;
       const dest = destinationOf(r);
       (map[dest] ??= []).push(r.id);
     }
     return map;
   }

   export function keyringStatusLine(entry: KeyringEntry, pausedTaskNames: string[], t: Tr, locale: string) {
     if (!entry.lastVerifiedAt) return { text: t("keyring.never"), tone: "muted" as const };
     const when = formatRelativeTime(new Date(entry.lastVerifiedAt).toISOString(), t, locale);
     const parts = [t("keyring.lastVerified", { when })];
     if (entry.status === "rejected") parts.push(t("keyring.rejected", { status: entry.lastErrorStatus ?? 401 }));
     if (entry.status === "unreachable") parts.push(t("keyring.unreachable", { host: providerHost(entry.provider) ?? entry.provider }));
     if (pausedTaskNames.length && entry.status === "rejected") {
       parts.push(t("keyring.paused", { tasks: pausedTaskNames.join(", ") }));
     }
     return { text: parts.join(" · "), tone: entry.status === "rejected" ? ("error" as const) : ("muted" as const) };
   }

   const DOT: Record<KeyringEntry["status"], string> = {
     verified: "bg-locality-device",
     unverified: "bg-warning",
     rejected: "bg-destructive",
     unreachable: "bg-warning",
   };

   export interface KeyringPanelViewProps {
     entries: KeyringEntry[];
     paused: Record<string, string[]>;           // provider → translated task names
     checking: string | null;
     progress: { current: number; total: number } | null;
     sealed: boolean;
     onVerify: (provider: string) => void;
     onVerifyAll: () => void;
     onReminder: (provider: string, enabled: boolean) => void;
   }

   export function KeyringPanelView(props: KeyringPanelViewProps) {
     const { t, i18n } = useTranslation();
     const busy = props.checking !== null;
     return (
       <section aria-labelledby="keyring-title" className="rounded-lg border border-border/70 overflow-hidden">
         <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
           <div>
             <h3 id="keyring-title" className="text-sm font-semibold">{t("keyring.title")}</h3>
             <p className="text-xs text-muted-foreground">{t("keyring.subtitle")}</p>
             {props.sealed && <p className="mt-1 text-xs text-muted-foreground">{t("keyring.sealed")}</p>}
           </div>
           <Button
             size="sm"
             variant="outline"
             onClick={props.onVerifyAll}
             disabled={busy || props.sealed || props.entries.length === 0}
             title={t("keyring.verifyAllTooltip")}
           >
             {props.progress ? t("keyring.verifyingAll", props.progress) : t("keyring.verifyAll")}
           </Button>
         </div>
         {props.entries.length === 0 ? (
           <p className="px-4 py-3 text-xs text-muted-foreground">{t("keyring.empty")}</p>
         ) : (
           <ul>
             {props.entries.map((entry) => {
               const name = providerDisplayLabel(entry.provider, t);
               const checking = props.checking === entry.provider;
               const line = keyringStatusLine(entry, props.paused[entry.provider] ?? [], t, i18n.language);
               const host = providerHost(entry.provider) ?? entry.provider;
               return (
                 <li
                   key={entry.provider}
                   data-provider={entry.provider}
                   data-checking={checking ? "true" : "false"}
                   className="grid grid-cols-[20px_1fr_auto] items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-b-0"
                 >
                   {checking ? (
                     <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label={t("keyring.checking")} />
                   ) : (
                     <span role="img" aria-label={t(`keyring.status.${entry.status}`)} className={`h-2 w-2 rounded-full ${DOT[entry.status]}`} />
                   )}
                   <div className="min-w-0">
                     <p className="text-xs font-semibold">{name}</p>
                     <p className={`text-xs ${line.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                       {checking ? t("keyring.checking") : line.text}
                     </p>
                   </div>
                   <div className="flex items-center gap-3">
                     <Button
                       size="sm"
                       variant="ghost"
                       onClick={() => props.onVerify(entry.provider)}
                       disabled={busy || props.sealed}
                       title={t("keyring.verifyTooltip", { host })}
                     >
                       {t("keyring.verify")}
                     </Button>
                     <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                       <Toggle
                         checked={entry.reminderDueAt !== null}
                         onChange={(on) => props.onReminder(entry.provider, on)}
                         aria-label={t("keyring.remindLabel", { provider: name })}
                       />
                       <span aria-hidden="true">{t("keyring.remind")}</span>
                     </label>
                   </div>
                 </li>
               );
             })}
           </ul>
         )}
       </section>
     );
   }

   export function KeyringPanel() {
     const { t } = useTranslation();
     const routes = useResolvedRoutes();
     const sealed = useRouteFactsStore((s) => s.facts.sealed);
     const [entries, setEntries] = useState<KeyringEntry[]>([]);
     const [checking, setChecking] = useState<string | null>(null);
     const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
     const api = window.electronAPI?.keyring;

     const load = useCallback(async () => {
       try {
         setEntries((await api?.list()) ?? []);
       } catch {
         setEntries([]);
       }
     }, [api]);
     useEffect(() => {
       void load();
     }, [load, routes]); // a key saved elsewhere changes routes; reload so it appears

     const paused = useMemo(() => {
       const snapshot = currentRouteSnapshot(routeSendsCopy(t));
       const byProvider = pausedTasksByProvider(routes, (r) => routeDestinationId(snapshot, r as ResolvedRoute));
       return Object.fromEntries(
         Object.entries(byProvider).map(([p, ids]) => [p, ids.map((id) => t(`routes.names.${id}`))])
       );
     }, [routes, t]);

     const verifyOne = async (provider: string) => {
       setChecking(provider);
       try {
         const next = await api!.verify(provider);
         setEntries((cur) => cur.map((e) => (e.provider === provider ? next : e)));
       } finally {
         setChecking(null);
       }
     };

     const onVerify = async (provider: string) => {
       await verifyOne(provider);
       await refreshRouteFacts();
     };

     const onVerifyAll = async () => {
       const queue = entries.map((e) => e.provider);
       for (let i = 0; i < queue.length; i++) {
         setProgress({ current: i + 1, total: queue.length });
         await verifyOne(queue[i]);
       }
       setProgress(null);
       await refreshRouteFacts();
     };

     const onReminder = async (provider: string, enabled: boolean) => {
       const next = await api!.setReminder(provider, enabled);
       setEntries((cur) => cur.map((e) => (e.provider === provider ? next : e)));
     };

     return (
       <KeyringPanelView
         entries={entries}
         paused={paused}
         checking={checking}
         progress={progress}
         sealed={sealed}
         onVerify={(p) => void onVerify(p)}
         onVerifyAll={() => void onVerifyAll()}
         onReminder={(p, on) => void onReminder(p, on)}
       />
     );
   }
   ```

   The spinner uses `animate-spin`, which runs only while a row is being checked (the loop is gated to its active state). Reduced motion already stops the transform globally, and the "Checking…" text still announces the state.

   `bg-warning` is used for a non-text dot only. That needs 3:1, and `#d97706` is 3.2:1 on white.

2. In `RoutingSection.tsx`, after the Patchbay block, add `<KeyringPanel />` (import it from `./KeyringPanel`).

3. Write `/tmp/loqui-i18n-task-9.json` and merge it. The `en` block is below. `keyring.reminder.*` already exists from Task 8, so merge into the same object.

   ```json
   {
     "keyring": {
       "title": "Keyring",
       "subtitle": "Saved provider keys and whether they still work. Results stay on this device.",
       "verify": "Verify",
       "verifyAll": "Verify all",
       "verifyingAll": "Verifying {{current}} of {{total}}…",
       "verifyTooltip": "Sends your saved key to {{host}} to list models.",
       "verifyAllTooltip": "Contacts each provider below with its saved key, one at a time.",
       "checking": "Checking…",
       "never": "Never verified",
       "lastVerified": "Last verified {{when}}",
       "rejected": "Rejected ({{status}}). Replace the key.",
       "unreachable": "Couldn't reach {{host}}. Key kept, not verified.",
       "paused": "Paused: {{tasks}}",
       "remind": "Remind in 90 days",
       "remindLabel": "Remind me to rotate the {{provider}} key in 90 days",
       "sealed": "Sealed mode is on, so verification is paused.",
       "empty": "No saved provider keys. Tasks that need one show “Add API key” in Routing.",
       "status": {
         "verified": "Verified",
         "unverified": "Not verified yet",
         "rejected": "Rejected",
         "unreachable": "Couldn't verify"
       }
     }
   }
   ```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/components/keyringPanel.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually against card R5 C (`05-settings.html:1351-1359`):
- Save a bogus Groq key, then press Verify. The row turns "Rejected (401)", and Chat on Groq shows "Add API key" in the Patchbay.
- Verify all walks through the rows one by one.
- Toggling "Remind in 90 days" survives an app restart.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/routing/KeyringPanel.tsx src/components/settings/routing/RoutingSection.tsx src/locales test/components/keyringPanel.test.js
git commit -m "feat(keyring): Keyring panel with health, Verify all and reminders"
```

---

### Task 10: Cartridge model cards with radio semantics (SET-R4 B, SET-Q8, SET-Q9)

Local models become **cartridges**: a 2-column grid of cards, each showing:
- the name;
- three 5-pip meters (Speed, Quality, Memory use), always labelled in words;
- size and context;
- the state: Ready, Download, Downloading with a real `role="progressbar"`, or Too large for this device;
- "In use by" chips that show which tasks already use the model.

The grid is a `role="radiogroup"` with one tab stop:
- Arrows move through the grid (←/→ swap in RTL, ↑/↓ move a row, Home/End).
- Enter or Space selects a downloaded model, or starts the download of one that isn't.
- The card's action button is reachable as the next tab stop.
- Sorting is Recommended first, then by size ascending, collapsed after 5 with "Show all 13" (Q8).
- Download buttons use the outline variant except on the Recommended card (Q9).

This supersedes Plan 02's SET-Q2 (keyboard-selectable model cards) for local models. Plan 02's markup is replaced, but its accessible names are kept.

Pips are estimates derived from size unless the registry carries curated `speedTier` and `qualityTier` values. They are labelled "estimate".

**Files:**
- Create: `src/components/ui/cartridgeMath.ts` (pure)
- Modify: `src/components/ui/rovingNav.ts`. Add `stepGrid`.
- Create: `src/components/ui/ModelCartridgeGrid.tsx`
- Modify: `src/models/ModelRegistry.ts:7-28`. Add optional `speedTier?: number; qualityTier?: number;` to `ModelDefinition`.
- Modify: `src/components/LocalModelPicker.tsx:360-385`. Replace `ModelCardList` with `ModelCartridgeGrid`.
- Modify: `src/components/TranscriptionModelPicker.tsx`. Replace the two `LocalModelCard` lists in `renderLocalModels` (`:1032-1080`) and the Parakeet renderer (`:1105-1160`) with `ModelCartridgeGrid`, and delete `LocalModelCard` (`:76-~200`) once it has no callers.
- Modify: `src/helpers/ipcHandlers.js`, `preload.js` and `src/types/electron.ts`. Add `getTotalMemory`.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/rovingNav.test.js` (extend), `test/components/cartridgeMath.test.js`, `test/components/modelCartridgeGrid.test.js`

**Interfaces:**
- Consumes:
  - `useResolvedRoutes` for "In use by" (Task 2);
  - `formatDecimalBytes` (Task 3);
  - `stepLinear` file (Task 4);
  - `Button` variants `default` (the ink capsule) and `outline` (Plan 01);
  - the existing `LocalModelPicker` handlers `selectModel`, `handleDownload`, `handleDelete` and `cancelDownload`;
  - the existing `TranscriptionModelPicker` handlers passed to `LocalModelCard` today.
- Produces:

  ```ts
  // rovingNav.ts (additive)
  export function stepGrid(index: number, key: string, opts: { columns: number; count: number; rtl: boolean }): number;
  // cartridgeMath.ts
  export interface CartridgeModel {
    id: string; name: string; sizeBytes?: number; contextLength?: number; recommended?: boolean;
    isDownloaded: boolean; isDownloading: boolean; isCancelling?: boolean; progress?: number;   // 0–100
    speedTier?: number; qualityTier?: number; badge?: string;                                  // e.g. "25 languages"
  }
  export type Fit = "comfortable" | "tight" | "tooLarge" | "unknown";
  export function estimateTiers(m: Pick<CartridgeModel, "sizeBytes" | "speedTier" | "qualityTier">): { speed: number | null; quality: number | null; memory: number | null; estimated: boolean };
  export function estimateRamBytes(sizeBytes: number): number;                 // sizeBytes × 1.15
  export function fitFor(sizeBytes: number | undefined, totalMemoryBytes: number | null): Fit;
  export function sortForDisplay<T extends Pick<CartridgeModel, "recommended" | "sizeBytes">>(models: T[]): T[];
  export function visibleModels<T extends Pick<CartridgeModel, "id">>(sorted: T[], selectedId: string, expanded: boolean, limit?: number): T[];
  // ModelCartridgeGrid.tsx
  export interface ModelCartridgeGridProps {
    label: string; models: CartridgeModel[]; selectedId: string; totalMemoryBytes: number | null;
    usedBy?: Record<string, string[]>;   // model id → translated task names
    onSelect(id: string): void; onDownload(id: string): void; onCancel?(id: string): void; onDelete?(id: string): void;
  }
  export function ModelCartridgeGrid(props: ModelCartridgeGridProps): JSX.Element;
  // preload
  getTotalMemory: () => Promise<number>;   // os.totalmem(), bytes
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/components/rovingNav.test.js`:

```js
test("grid roving focus moves by row and swaps left/right in RTL", async () => {
  const { stepGrid } = await import("../../src/components/ui/rovingNav.ts");
  const ltr = { columns: 2, count: 5, rtl: false };
  assert.equal(stepGrid(0, "ArrowRight", ltr), 1);
  assert.equal(stepGrid(1, "ArrowLeft", ltr), 0);
  assert.equal(stepGrid(0, "ArrowDown", ltr), 2);
  assert.equal(stepGrid(3, "ArrowDown", ltr), 4, "clamps to the last card in a short final row");
  assert.equal(stepGrid(4, "ArrowDown", ltr), 4);
  assert.equal(stepGrid(2, "ArrowUp", ltr), 0);
  assert.equal(stepGrid(0, "ArrowUp", ltr), 0);
  assert.equal(stepGrid(3, "Home", ltr), 0);
  assert.equal(stepGrid(0, "End", ltr), 4);
  const rtl = { columns: 2, count: 5, rtl: true };
  assert.equal(stepGrid(0, "ArrowLeft", rtl), 1, "in RTL, left moves toward the inline end");
  assert.equal(stepGrid(1, "ArrowRight", rtl), 0);
});
```

Create `test/components/cartridgeMath.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/cartridgeMath.ts");
const GB = 1_000_000_000;

test("tiers come from curated data when present, otherwise from size, and say so", async () => {
  const { estimateTiers } = await load();
  assert.deepEqual(estimateTiers({ sizeBytes: 1.3 * GB }), { speed: 4, quality: 3, memory: 1, estimated: true });
  assert.deepEqual(estimateTiers({ sizeBytes: 2.7 * GB }), { speed: 3, quality: 4, memory: 2, estimated: true });
  assert.deepEqual(estimateTiers({ sizeBytes: 5.5 * GB }), { speed: 2, quality: 5, memory: 4, estimated: true });
  assert.deepEqual(estimateTiers({ sizeBytes: 5.5 * GB, speedTier: 3, qualityTier: 4 }), { speed: 3, quality: 4, memory: 4, estimated: false });
  assert.deepEqual(estimateTiers({}), { speed: null, quality: null, memory: null, estimated: true });
});

test("fit compares the RAM estimate with this device", async () => {
  const { fitFor, estimateRamBytes } = await load();
  assert.equal(estimateRamBytes(1 * GB), 1.15 * GB);
  assert.equal(fitFor(1.3 * GB, 16 * GB), "comfortable");
  assert.equal(fitFor(7 * GB, 16 * GB), "tight");
  assert.equal(fitFor(12 * GB, 16 * GB), "tooLarge");
  assert.equal(fitFor(1 * GB, null), "unknown");
  assert.equal(fitFor(undefined, 16 * GB), "unknown");
});

test("sort puts Recommended first, then smaller models; collapse keeps the selection visible", async () => {
  const { sortForDisplay, visibleModels } = await load();
  const models = [
    { id: "9b", sizeBytes: 5.5 * GB },
    { id: "2b", sizeBytes: 1.3 * GB, recommended: true },
    { id: "x", sizeBytes: undefined },
    { id: "4b", sizeBytes: 2.7 * GB },
    { id: "0.8b", sizeBytes: 0.8 * GB },
  ];
  assert.deepEqual(sortForDisplay(models).map((m) => m.id), ["2b", "0.8b", "4b", "9b", "x"]);
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}` }));
  assert.deepEqual(visibleModels(many, "m0", false).map((m) => m.id), ["m0", "m1", "m2", "m3", "m4"]);
  assert.deepEqual(visibleModels(many, "m7", false).map((m) => m.id), ["m0", "m1", "m2", "m3", "m4", "m7"]);
  assert.equal(visibleModels(many, "m0", true).length, 8);
});
```

Create `test/components/modelCartridgeGrid.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const { withI18nMock } = require("../lib/i18nTestMock");
const GB = 1_000_000_000;

test("cartridge grid", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-cartridge-test-" }, { withOptions: true }));
  const { ModelCartridgeGrid } = await vite.ssrLoadModule("/components/ui/ModelCartridgeGrid.tsx");
  const models = [
    { id: "qwen-2b", name: "Qwen3.5 2B", sizeBytes: 1.3 * GB, contextLength: 32768, recommended: true, isDownloaded: true, isDownloading: false },
    { id: "qwen-4b", name: "Qwen3.5 4B", sizeBytes: 2.7 * GB, contextLength: 32768, isDownloaded: false, isDownloading: true, progress: 42 },
    { id: "qwen-9b", name: "Qwen3.5 9B", sizeBytes: 5.5 * GB, isDownloaded: false, isDownloading: false },
    { id: "big", name: "Huge 70B", sizeBytes: 40 * GB, isDownloaded: false, isDownloading: false },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `extra${i}`, name: `Extra ${i}`, sizeBytes: (6 + i) * GB, isDownloaded: false, isDownloading: false })),
  ];
  const render = (over = {}) =>
    renderToStaticMarkup(React.createElement(ModelCartridgeGrid, {
      label: "Language model",
      models,
      selectedId: "qwen-2b",
      totalMemoryBytes: 16 * GB,
      usedBy: { "qwen-2b": ["Chat", "Cleanup"] },
      onSelect() {}, onDownload() {}, onCancel() {}, onDelete() {},
      ...over,
    }));

  await t.test("a radiogroup with one tab stop on the checked card", () => {
    const html = render();
    assert.match(html, /role="radiogroup"[^>]*aria-label="Language model"/);
    assert.match(html, /role="radio"[^>]*aria-checked="true"[^>]*tabindex="0"[^>]*data-model="qwen-2b"/);
    assert.equal((html.match(/role="radio"[^>]*tabindex="0"/g) ?? []).length, 1);
  });

  await t.test("meters are labelled in words and marked as estimates", () => {
    const html = render();
    assert.match(html, /role="img"[^>]*aria-label="cartridge\.meter\{&quot;label&quot;:&quot;cartridge\.speed&quot;,&quot;value&quot;:4\}"/);
    assert.match(html, /cartridge\.estimate/);
  });

  await t.test("recommended download is the default button, others are outline", () => {
    const html = render({ models: models.map((m) => ({ ...m, isDownloaded: false, isDownloading: false })) });
    // Button renders data-variant before spreading props (button.tsx:139-142).
    assert.match(html, /data-variant="default"[^>]*data-model-action="qwen-2b"/);
    assert.match(html, /data-variant="outline"[^>]*data-model-action="qwen-9b"/);
  });

  await t.test("downloads report progress accessibly", () => {
    assert.match(render(), /role="progressbar"[^>]*aria-valuenow="42"/);
  });

  await t.test("a model too large for this device cannot be downloaded and says why", () => {
    const html = render({ selectedId: "qwen-2b" });
    // "big" is beyond the first five, so expand by selecting it.
    const expanded = render({ selectedId: "big" });
    assert.match(expanded, /data-model="big"[^>]*aria-disabled="true"/);
    assert.match(expanded, /cartridge\.tooLarge/);
    assert.match(html, /cartridge\.showAll\{&quot;count&quot;:8\}/);
  });

  await t.test("in-use chips name the tasks", () => {
    const html = render();
    assert.match(html, /cartridge\.inUseBy/);
    assert.match(html, />Chat</);
    assert.match(html, />Cleanup</);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/rovingNav.test.js test/components/cartridgeMath.test.js test/components/modelCartridgeGrid.test.js`
Expected: FAIL. `stepGrid` is not a function, and the modules are missing.

- [ ] **Step 3: Implement**

1. Append `stepGrid` to `src/components/ui/rovingNav.ts`:

   ```ts
   export function stepGrid(index: number, key: string, opts: { columns: number; count: number; rtl: boolean }): number {
     const { columns, count, rtl } = opts;
     if (count === 0) return index;
     const last = count - 1;
     const forward = rtl ? "ArrowLeft" : "ArrowRight";
     const backward = rtl ? "ArrowRight" : "ArrowLeft";
     switch (key) {
       case forward:
         return Math.min(last, index + 1);
       case backward:
         return Math.max(0, index - 1);
       case "ArrowDown":
         return Math.min(last, index + columns);
       case "ArrowUp":
         return index - columns >= 0 ? index - columns : index;
       case "Home":
         return 0;
       case "End":
         return last;
       default:
         return index;
     }
   }
   ```

2. Create `src/components/ui/cartridgeMath.ts`:

   ```ts
   // Pure helpers for model cartridges (SET-R4 B). Tiers are estimates from
   // file size unless the registry carries curated speedTier/qualityTier.

   export interface CartridgeModel {
     id: string;
     name: string;
     sizeBytes?: number;
     contextLength?: number;
     recommended?: boolean;
     isDownloaded: boolean;
     isDownloading: boolean;
     isCancelling?: boolean;
     progress?: number;
     speedTier?: number;
     qualityTier?: number;
     badge?: string;
   }

   export type Fit = "comfortable" | "tight" | "tooLarge" | "unknown";

   const GB = 1_000_000_000;
   const bucket = (bytes: number, edges: number[]) => {
     const i = edges.findIndex((edge) => bytes <= edge * GB);
     return i === -1 ? edges.length + 1 : i + 1;
   };

   export function estimateTiers(m: Pick<CartridgeModel, "sizeBytes" | "speedTier" | "qualityTier">) {
     const size = m.sizeBytes;
     const memory = size ? bucket(size, [1.5, 3, 5, 8]) : null;
     const sizeSpeed = size ? 6 - bucket(size, [1, 2, 4, 8]) : null;
     const sizeQuality = size ? Math.min(5, bucket(size, [1, 2, 4, 8]) + 1) : null;
     const curated = m.speedTier !== undefined && m.qualityTier !== undefined;
     return {
       speed: m.speedTier ?? sizeSpeed,
       quality: m.qualityTier ?? sizeQuality,
       memory,
       estimated: !curated,
     };
   }

   export function estimateRamBytes(sizeBytes: number): number {
     return sizeBytes * 1.15;
   }

   export function fitFor(sizeBytes: number | undefined, totalMemoryBytes: number | null): Fit {
     if (!sizeBytes || !totalMemoryBytes) return "unknown";
     const share = estimateRamBytes(sizeBytes) / totalMemoryBytes;
     if (share < 0.4) return "comfortable";
     return share <= 0.7 ? "tight" : "tooLarge";
   }

   export function sortForDisplay<T extends Pick<CartridgeModel, "recommended" | "sizeBytes">>(models: T[]): T[] {
     return models
       .map((m, i) => ({ m, i }))
       .sort((a, b) => {
         if (!!a.m.recommended !== !!b.m.recommended) return a.m.recommended ? -1 : 1;
         const sa = a.m.sizeBytes ?? Number.POSITIVE_INFINITY;
         const sb = b.m.sizeBytes ?? Number.POSITIVE_INFINITY;
         return sa === sb ? a.i - b.i : sa - sb;
       })
       .map(({ m }) => m);
   }

   export function visibleModels<T extends Pick<CartridgeModel, "id">>(
     sorted: T[],
     selectedId: string,
     expanded: boolean,
     limit = 5
   ): T[] {
     if (expanded || sorted.length <= limit) return sorted;
     const head = sorted.slice(0, limit);
     const selected = sorted.find((m) => m.id === selectedId);
     return selected && !head.includes(selected) ? [...head, selected] : head;
   }
   ```

   Check the numbers against the tests:
   - Speed buckets are ≤1, ≤2, ≤4 and ≤8 GB. The bucket index for 1.3 GB is 2, so speed is 6 − 2 = 4. 2.7 GB gives index 3, so speed 3. 5.5 GB gives index 4, so speed 2.
   - Quality is the bucket index + 1: 3, 4 and 5.
   - Memory edges are 1.5, 3, 5 and 8 GB: 1.3 GB gives 1, 2.7 GB gives 2, and 5.5 GB gives 4.

3. Create `src/components/ui/ModelCartridgeGrid.tsx`:

   ```tsx
   import { useRef, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { formatDecimalBytes } from "../../utils/formatBytes";
   import { Download, Trash2, X } from "../icons";
   import { Button } from "./button";
   import {
     estimateRamBytes,
     estimateTiers,
     fitFor,
     sortForDisplay,
     visibleModels,
     type CartridgeModel,
   } from "./cartridgeMath";
   import { stepGrid } from "./rovingNav";

   export interface ModelCartridgeGridProps {
     label: string;
     models: CartridgeModel[];
     selectedId: string;
     totalMemoryBytes: number | null;
     usedBy?: Record<string, string[]>;
     onSelect: (id: string) => void;
     onDownload: (id: string) => void;
     onCancel?: (id: string) => void;
     onDelete?: (id: string) => void;
   }

   function Pips({ label, value }: { label: string; value: number }) {
     const { t } = useTranslation();
     return (
       <>
         <span className="text-[11px] text-muted-foreground">{label}</span>
         <span role="img" aria-label={t("cartridge.meter", { label, value })} className="flex gap-0.5">
           {[1, 2, 3, 4, 5].map((n) => (
             <span key={n} className={`h-2.5 w-1.5 rounded-sm ${n <= value ? "bg-foreground/70" : "bg-border"}`} />
           ))}
         </span>
       </>
     );
   }

   export function ModelCartridgeGrid(props: ModelCartridgeGridProps) {
     const { t, i18n } = useTranslation();
     const [expanded, setExpanded] = useState(false);
     const refs = useRef<(HTMLDivElement | null)[]>([]);
     const sorted = sortForDisplay(props.models);
     const shown = visibleModels(sorted, props.selectedId, expanded);
     const checkedIndex = Math.max(0, shown.findIndex((m) => m.id === props.selectedId));
     const [focusIndex, setFocusIndex] = useState(checkedIndex);
     const tabIndexFor = (i: number) => (i === (focusIndex < shown.length ? focusIndex : checkedIndex) ? 0 : -1);
     const rtl = (i18n.dir?.() ?? "ltr") === "rtl";

     const activate = (m: CartridgeModel, tooLarge: boolean) => {
       if (m.isDownloaded) props.onSelect(m.id);
       else if (!m.isDownloading && !tooLarge) props.onDownload(m.id);
     };

     return (
       <div className="space-y-2">
         {/* Always two columns so the arrow-key model (stepGrid columns: 2) matches the layout. */}
         <div role="radiogroup" aria-label={props.label} className="grid grid-cols-2 gap-2.5">
           {shown.map((m, i) => {
             const tiers = estimateTiers(m);
             const fit = fitFor(m.sizeBytes, props.totalMemoryBytes);
             const tooLarge = fit === "tooLarge" && !m.isDownloaded;
             const checked = m.id === props.selectedId;
             const usedBy = props.usedBy?.[m.id] ?? [];
             const reasonId = `cartridge-reason-${m.id}`;
             return (
               <div
                 key={m.id}
                 className={`relative rounded-[10px] border bg-card p-3 transition-[border-color,translate] duration-150 hover:-translate-y-px dark:hover:translate-y-0 ${
                   checked ? "border-2 border-ring p-[11px]" : "border-border"
                 } ${tooLarge ? "opacity-70" : ""}`}
               >
                 <div
                   role="radio"
                   aria-checked={checked}
                   tabIndex={tabIndexFor(i)}
                   data-model={m.id}
                   aria-disabled={tooLarge || undefined}
                   aria-describedby={reasonId}
                   ref={(el) => {
                     refs.current[i] = el;
                   }}
                   onFocus={() => setFocusIndex(i)}
                   onClick={() => activate(m, tooLarge)}
                   onKeyDown={(e) => {
                     if (e.key === " " || e.key === "Enter") {
                       e.preventDefault();
                       activate(m, tooLarge);
                       return;
                     }
                     const next = stepGrid(i, e.key, { columns: 2, count: shown.length, rtl });
                     if (next !== i) {
                       e.preventDefault();
                       refs.current[next]?.focus();
                     }
                   }}
                   className="cursor-pointer rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                 >
                   <div className="flex items-center justify-between gap-2">
                     <span className="text-sm font-semibold">{m.name}</span>
                     {m.recommended && <span className="text-[11px] font-medium text-muted-foreground">{t("common.recommended")}</span>}
                   </div>
                   <div className="mt-2 grid grid-cols-[82px_1fr] items-center gap-x-2 gap-y-1">
                     {tiers.speed !== null && <Pips label={t("cartridge.speed")} value={tiers.speed} />}
                     {tiers.quality !== null && <Pips label={t("cartridge.quality")} value={tiers.quality} />}
                     {tiers.memory !== null && <Pips label={t("cartridge.memory")} value={tiers.memory} />}
                   </div>
                   <p id={reasonId} className="mt-2 text-[11px] text-muted-foreground">
                     {[
                       m.sizeBytes ? formatDecimalBytes(m.sizeBytes) : null,
                       m.contextLength ? t("cartridge.context", { k: Math.round(m.contextLength / 1024) }) : null,
                       m.badge ?? null,
                       tooLarge
                         ? t("cartridge.tooLarge", {
                             needs: formatDecimalBytes(estimateRamBytes(m.sizeBytes!)),
                             total: formatDecimalBytes(props.totalMemoryBytes!),
                           })
                         : fit === "tight"
                           ? t("cartridge.tight")
                           : null,
                       !m.isDownloaded && !m.isDownloading && !tooLarge ? t("cartridge.notDownloaded") : null,
                     ]
                       .filter(Boolean)
                       .join(" · ")}
                   </p>
                 </div>
                 <div className="mt-2 flex items-center justify-between gap-2">
                   {m.isDownloading ? (
                     <div className="flex flex-1 items-center gap-2">
                       <div
                         role="progressbar"
                         aria-valuenow={Math.round(m.progress ?? 0)}
                         aria-valuemin={0}
                         aria-valuemax={100}
                         aria-label={t("cartridge.downloading", { name: m.name })}
                         className="h-1.5 flex-1 overflow-hidden rounded-full border border-border bg-muted"
                       >
                         <div className="h-full bg-foreground/70" style={{ width: `${m.progress ?? 0}%` }} />
                       </div>
                       {props.onCancel && (
                         <Button
                           size="sm"
                           variant="outline"
                           tabIndex={tabIndexFor(i)}
                           data-model-action={m.id}
                           disabled={m.isCancelling}
                           onClick={() => props.onCancel!(m.id)}
                           aria-label={t("cartridge.cancel", { name: m.name })}
                         >
                           <X size={12} aria-hidden="true" />
                         </Button>
                       )}
                     </div>
                   ) : m.isDownloaded ? (
                     <>
                       <span className="text-xs font-medium text-locality-device">{t("routes.state.ready")}</span>
                       {props.onDelete && (
                         <Button
                           size="sm"
                           variant="ghost"
                           tabIndex={tabIndexFor(i)}
                           data-model-action={m.id}
                           onClick={() => props.onDelete!(m.id)}
                           aria-label={t("cartridge.delete", { name: m.name })}
                         >
                           <Trash2 size={12} aria-hidden="true" />
                         </Button>
                       )}
                     </>
                   ) : (
                     <Button
                       size="sm"
                       variant={m.recommended ? "default" : "outline"}
                       tabIndex={tabIndexFor(i)}
                       data-model-action={m.id}
                       disabled={tooLarge}
                       onClick={() => props.onDownload(m.id)}
                     >
                       <Download size={12} className="me-1" aria-hidden="true" />
                       {t("cartridge.download")}
                     </Button>
                   )}
                 </div>
                 {checked && usedBy.length > 0 && (
                   <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                     <span className="text-muted-foreground">{t("cartridge.inUseBy")}</span>
                     {usedBy.map((task) => (
                       <span key={task} className="rounded-full bg-muted px-1.5 py-px font-semibold">{task}</span>
                     ))}
                   </div>
                 )}
               </div>
             );
           })}
         </div>
         <div className="flex items-center justify-between gap-2">
           <p className="text-[11px] text-muted-foreground">{t("cartridge.estimate")}</p>
           {!expanded && sorted.length > shown.length && (
             <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}>
               {t("cartridge.showAll", { count: sorted.length })}
             </Button>
           )}
         </div>
       </div>
     );
   }
   ```

   The pips use `bg-foreground/70`, never orange. Orange is only the selected border (`border-ring`, D1).

4. **Total memory IPC.**
   - In `src/helpers/ipcHandlers.js`, next to `get-model-cache-root` (`:8314`), add `ipcMain.handle("get-total-memory", () => require("os").totalmem());`.
   - In `preload.js`, add `getTotalMemory: () => ipcRenderer.invoke("get-total-memory"),` next to `getModelCacheRoot`.
   - In `src/types/electron.ts`, add `getTotalMemory?: () => Promise<number>;` to `electronAPI`.

   Plan 05 (ONB-R3 C "Detected for you") may add a hardware probe. If it lands first with a total-RAM field, use that and drop this channel.

5. **Wire `LocalModelPicker`** (`:360-385`). Replace `<ModelCardList … />` with:

   ```tsx
   <ModelCartridgeGrid
     label={t("cartridge.groupLabel")}
     models={models.map((model) => ({
       id: model.id,
       name: model.name,
       sizeBytes: model.sizeBytes,
       contextLength: model.contextLength,
       recommended: model.recommended,
       speedTier: model.speedTier,
       qualityTier: model.qualityTier,
       badge: model.imported ? t(`localModels.status.${model.loadStatus || "untested"}`) : undefined,
       isDownloaded: downloadedModels.has(model.id) || !!model.isDownloaded || !!model.downloaded,
       isDownloading: isDownloadingModel(model.id),
       isCancelling: isCancellingModel(model.id),
       progress: downloads[model.id]?.progress,
     }))}
     selectedId={selectedModel}
     totalMemoryBytes={totalMemory}
     usedBy={usedBy}
     onSelect={selectModel}
     onDownload={handleDownload}
     onCancel={cancelDownload}
     onDelete={handleDelete}
   />
   ```

   Add these above the return:

   ```tsx
   const [totalMemory, setTotalMemory] = useState<number | null>(null);
   useEffect(() => {
     window.electronAPI?.getTotalMemory?.().then(setTotalMemory, () => setTotalMemory(null));
   }, []);
   const routes = useResolvedRoutes();
   const usedBy = useMemo(() => {
     const map: Record<string, string[]> = {};
     for (const m of models) {
       const tasks = routes.filter((r) => r.locality === "device" && r.model === m.name).map((r) => t(`routes.names.${r.id}`));
       if (tasks.length) map[m.id] = tasks;
     }
     return map;
   }, [models, routes, t]);
   ```

   - If `LocalModel` (`:25`) lacks `contextLength`, `speedTier` or `qualityTier`, add them as optional. The registry `ModelDefinition` carries them.
   - `downloads[model.id]?.progress` is the same status object the in-flight progress bars read at `:343-349`.
   - After a download completes or a delete succeeds, call `void refreshRouteFacts()` (Task 2) in the existing completion paths (`onDownloadComplete` and the delete confirm handler).

6. **Wire `TranscriptionModelPicker`.** Add the `totalMemory` and `usedBy` hooks from step 5 near the two `useModelDownload` calls (`:820-842`). Use `localModels.map(m => WHISPER_MODEL_INFO[m.model]?.name)` and the Parakeet equivalent for `usedBy`, or build `usedBy` from both renderers' `modelsToRender` names. Then replace the `<div className="space-y-0.5">{modelsToRender.map(… <LocalModelCard …/> …)}</div>` block in each renderer.

   Whisper renderer (`:1043-1080`):

   ```tsx
   <ModelCartridgeGrid
     label={t("cartridge.speechGroupLabel")}
     models={modelsToRender.map((model) => {
       const info = WHISPER_MODEL_INFO[model.model];
       return {
         id: model.model,
         name: info?.name ?? model.model,
         // size_mb is only reported once a file exists; fall back to the registry.
         sizeBytes: (model.size_mb ?? info?.sizeMb) ? (model.size_mb ?? info!.sizeMb) * 1_000_000 : undefined,
         recommended: info?.recommended,
         isDownloaded: model.downloaded ?? false,
         isDownloading: isDownloadingModel(model.model),
         isCancelling: isCancellingModel(model.model),
         progress: whisperDownloads[model.model]?.progress,
       };
     })}
     selectedId={selectedLocalModel}
     totalMemoryBytes={totalMemory}
     usedBy={usedBy}
     onSelect={handleWhisperModelSelect}
     onDelete={handleDelete}
     onDownload={(modelId) =>
       downloadModel(modelId, (downloadedId) => {
         setLocalModels((prev) =>
           prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
         );
         handleWhisperModelSelect(downloadedId);
         void refreshRouteFacts();
       })
     }
     onCancel={cancelDownload}
   />
   ```

   Parakeet renderer (`:1121-1160`):

   ```tsx
   <ModelCartridgeGrid
     label={t("cartridge.speechGroupLabel")}
     models={modelsToRender.map((model) => {
       const info = PARAKEET_MODEL_INFO[model.model];
       return {
         id: model.model,
         name: info?.name ?? model.model,
         // size_mb is only reported once a file exists; fall back to the registry.
         sizeBytes:
           model.size_bytes ??
           (info?.expectedSizeBytes ?? ((model.size_mb ?? info?.sizeMb) ? (model.size_mb ?? info!.sizeMb) * 1_000_000 : undefined)),
         recommended: info?.recommended,
         isDownloaded: model.downloaded ?? false,
         isDownloading: isDownloadingParakeetModel(model.model),
         isCancelling: isCancellingParakeetModel(model.model),
         progress: parakeetDownloads[model.model]?.progress,
       };
     })}
     selectedId={selectedLocalModel}
     totalMemoryBytes={totalMemory}
     usedBy={usedBy}
     onSelect={handleParakeetModelSelect}
     onDelete={handleParakeetDelete}
     onDownload={(modelId) =>
       downloadParakeetModel(modelId, (downloadedId) => {
         setParakeetModels((prev) =>
           prev.map((m) => (m.model === downloadedId ? { ...m, downloaded: true } : m))
         );
         handleParakeetModelSelect(downloadedId);
         void refreshRouteFacts();
       })
     }
     onCancel={cancelParakeetDownload}
   />
   ```

   The callbacks are the bodies the `LocalModelCard` props receive today, with `modelId` taken as a parameter. The "installing" phase (`whisperDownloads[id]?.phase === "installing"`) keeps the card in its downloading state, because `isDownloadingModel` stays true until installation finishes. Then delete `LocalModelCard` and its props interface (`:56-~200`). `npm run lint` flags an unused import if anything is left over.

7. Write `/tmp/loqui-i18n-task-10.json` and merge it. The `en` block is:

   ```json
   {
     "cartridge": {
       "groupLabel": "Language model",
       "speechGroupLabel": "Speech model",
       "speed": "Speed",
       "quality": "Quality",
       "memory": "Memory use",
       "meter": "{{label}} {{value}} of 5",
       "estimate": "Pips are estimates from file size unless measured. Nothing is uploaded.",
       "context": "{{k}}k context",
       "tight": "Tight on this device",
       "tooLarge": "Too large for this device: needs about {{needs}}, this device has {{total}}",
       "notDownloaded": "Not downloaded. Press Enter to download.",
       "download": "Download",
       "downloading": "Downloading {{name}}",
       "cancel": "Cancel downloading {{name}}",
       "delete": "Delete {{name}}",
       "inUseBy": "In use by",
       "showAll_one": "Show all {{count}}",
       "showAll_other": "Show all {{count}}"
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/rovingNav.test.js test/components/cartridgeMath.test.js test/components/modelCartridgeGrid.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually against card R4 B (`05-settings.html:1086-1097`), in both locales:
- In LLMs → Chat → Local, the grid shows up to 5 cards with Recommended first. Tab lands once on the checked card, and arrows move.
- In Arabic, ← moves to the next card.
- Enter on an undownloaded card starts its download, and the progress bar announces.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/rovingNav.ts src/components/ui/cartridgeMath.ts src/components/ui/ModelCartridgeGrid.tsx src/models/ModelRegistry.ts src/components/LocalModelPicker.tsx src/components/TranscriptionModelPicker.tsx src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/locales test/components/rovingNav.test.js test/components/cartridgeMath.test.js test/components/modelCartridgeGrid.test.js
git commit -m "feat(settings): Cartridge model cards with radio semantics"
```

---

### Task 11: Storage list with counted confirms and a typed reset (SET-R7 A)

Privacy & Data gains one **Storage** list that counts before it deletes:

```
Dictation audio      214 files · 1.2 GB    [Delete…]
Downloaded models    3 models · 9.8 GB     [Open] [Delete…]
Transcript history   1,482 items           [Delete…]
── Danger zone ──
Reset Loqui          Deletes settings, history, audio, models and keys.   [Reset…]
```

Every "Delete…" opens a confirm that repeats the count, the size and the folder (monospace, `dir="ltr"`), and its button repeats the count: "Delete 214 recordings". A partial failure keeps the dialog open with `role="alert"` stating what was and wasn't deleted. Reset requires typing the localized word "reset".

Model-cache clearing and reset move here from System. The old "Clear All Audio" one-click button is removed, which supersedes Plan 02's SET-Q5 confirm with this counted version. Row triggers are outline buttons with destructive text. Solid destructive appears only inside a dialog.

**Files:**
- Create: `src/components/settings/storageMath.ts` (pure)
- Create: `src/components/settings/StorageList.tsx`
- Modify: `src/helpers/audioStorage.js:189-205`. Return `directory: this.audioDir` as well.
- Modify: `src/helpers/database.js`. Add `countTranscriptions()` next to `clearTranscriptions` (`:551`).
- Modify: `src/helpers/ipcHandlers.js`. Add `db-count-transcriptions` next to `db-clear-transcriptions` (`:1287`).
- Modify: `preload.js`. Add `countTranscriptions` next to `clearTranscriptions` (`:180`).
- Modify: `src/types/electron.ts`. Change `getAudioStorageUsage` (`:857`) to return `{ fileCount; totalBytes; directory?: string }`, and add `countTranscriptions?: () => Promise<number>`.
- Modify: `src/components/SettingsPage.tsx`:
  - in `privacyData`, replace the storage-usage and Clear All Audio block (inside `:2763-2830`; keep the audio-retention select) with `<StorageList />` after the transcript-retention block (`:2866`);
  - delete `handleClearAllAudio` (`:1145-1155`);
  - move the body of `handleRemoveModels` (`:1448-1494`) into `StorageList`;
  - delete the System "Data management" block (`:2975-3069`: model cache Open/Clear and Reset);
  - remove now-unused state such as `audioStorageUsage` and `isRemovingModels`.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/storageMath.test.js`, `test/components/storageList.test.js`, `test/helpers/transcriptionCount.test.js`

**Interfaces:**
- Consumes:
  - `getAudioStorageUsage`, `deleteAllAudio() → { deleted }`, `listWhisperModels`, `listParakeetModels` and `modelGetAll`;
  - `deleteAllWhisperModels`, `deleteAllParakeetModels` and `modelDeleteAll`;
  - `openWhisperModelsFolder`, `getModelCacheRoot`;
  - `clearTranscriptions() → { cleared, success }`, `cleanupApp()` and `relaunchApp()`;
  - `clearMissingLocalModelSelections` (`settingsStore.ts:2714`);
  - `refreshRouteFacts` (Task 2);
  - `formatDecimalBytes` (Task 3);
  - `Dialog*` and `ConfirmDialog` from `src/components/ui/dialog.tsx` (`ConfirmDialogProps` at `:108-121`, including `children` and `confirmDisabled`).
- Produces:

  ```ts
  // storageMath.ts
  export interface ModelLists {
    whisper?: { models?: { downloaded: boolean; size_bytes?: number; size_mb?: number }[] };
    parakeet?: { models?: { downloaded: boolean; size_bytes?: number; size_mb?: number }[] };
    llm?: { isDownloaded?: boolean; sizeBytes?: number; downloadedSize?: number }[];
  }
  export function summarizeModels(lists: ModelLists): { count: number; bytes: number };
  export function deletionOutcome(before: number, after: number): { deleted: number; left: number };
  export function resetConfirmed(typed: string, word: string): boolean;
  // StorageList.tsx
  export interface StorageRowState { count: number | null; bytes: number | null; directory: string | null }
  export interface CountedDeleteProps { kind: "audio" | "models" | "history"; row: StorageRowState; phase: "idle" | "deleting" | "partial"; outcome?: { deleted: number; left: number }; onConfirm(): void; onCancel(): void }
  export function CountedDeleteContent(props: CountedDeleteProps & { Title?: React.ElementType; Description?: React.ElementType }): JSX.Element; // SSR-testable body
  export function CountedDeleteDialog(props: CountedDeleteProps & { open: boolean; onOpenChange(open: boolean): void }): JSX.Element;
  export function StorageListView(props: { audio: StorageRowState; models: StorageRowState; history: StorageRowState; onDelete(kind): void; onOpenModels(): void; onReset(): void }): JSX.Element;
  export function StorageList(): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/storageMath.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/settings/storageMath.ts");

test("model storage counts only downloaded files across all three model families", async () => {
  const { summarizeModels } = await load();
  assert.deepEqual(
    summarizeModels({
      whisper: { models: [{ downloaded: true, size_mb: 142 }, { downloaded: false, size_mb: 466 }] },
      parakeet: { models: [{ downloaded: true, size_bytes: 680000000 }, { downloaded: true, size_mb: 100 }] },
      llm: [{ isDownloaded: true, sizeBytes: 1329766560 }, { isDownloaded: false, sizeBytes: 5 }, { isDownloaded: true, downloadedSize: 10 }],
    }),
    { count: 5, bytes: 142000000 + 680000000 + 100000000 + 1329766560 + 10 }
  );
  assert.deepEqual(summarizeModels({}), { count: 0, bytes: 0 });
});

test("a delete reports what was and was not deleted", async () => {
  const { deletionOutcome } = await load();
  assert.deepEqual(deletionOutcome(214, 0), { deleted: 214, left: 0 });
  assert.deepEqual(deletionOutcome(214, 3), { deleted: 211, left: 3 });
  assert.deepEqual(deletionOutcome(2, 5), { deleted: 0, left: 5 }, "never negative");
});

test("reset needs the word typed, case and spacing forgiven", async () => {
  const { resetConfirmed } = await load();
  assert.equal(resetConfirmed(" Reset ", "reset"), true);
  assert.equal(resetConfirmed("res", "reset"), false);
  assert.equal(resetConfirmed("", "reset"), false);
});
```

Create `test/components/storageList.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const { withI18nMock } = require("../lib/i18nTestMock");

test("storage list", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-storage-list-test-" }, { withOptions: true }));
  const s = await vite.ssrLoadModule("/components/settings/StorageList.tsx");
  const audio = { count: 214, bytes: 1_200_000_000, directory: "/Users/x/Library/Application Support/loqui/audio" };
  const models = { count: 3, bytes: 9_800_000_000, directory: "/Users/x/.cache/loqui" };
  const history = { count: 1482, bytes: null, directory: null };

  await t.test("rows show counts and sizes; triggers are outline, never solid red", () => {
    const html = renderToStaticMarkup(React.createElement(s.StorageListView, { audio, models, history, onDelete() {}, onOpenModels() {}, onReset() {} }));
    assert.match(html, /storage\.audio\.summary\{&quot;count&quot;:214,&quot;size&quot;:&quot;1\.2 GB&quot;\}/);
    assert.match(html, /storage\.models\.summary\{&quot;count&quot;:3,&quot;size&quot;:&quot;9\.8 GB&quot;\}/);
    assert.match(html, /storage\.history\.summary\{&quot;count&quot;:1482\}/);
    assert.doesNotMatch(html, /data-variant="destructive"/);
    assert.match(html, /storage\.danger/);
  });

  await t.test("empty rows say so and disable delete", () => {
    const html = renderToStaticMarkup(React.createElement(s.StorageListView, {
      audio: { count: 0, bytes: 0, directory: null }, models, history, onDelete() {}, onOpenModels() {}, onReset() {},
    }));
    assert.match(html, /storage\.audio\.empty/);
    assert.match(html, /data-storage-delete="audio"[^>]*disabled=""/);
  });

  await t.test("the confirm repeats count, size and folder, and the button repeats the count", () => {
    // Radix portals render nothing on the server, so test the dialog body directly.
    const html = renderToStaticMarkup(React.createElement(s.CountedDeleteContent, {
      kind: "audio", row: audio, phase: "idle", onConfirm() {}, onCancel() {},
    }));
    assert.match(html, /storage\.audio\.confirmTitle\{&quot;count&quot;:214\}/);
    assert.match(html, /storage\.audio\.confirmBody\{&quot;count&quot;:214,&quot;size&quot;:&quot;1\.2 GB&quot;\}/);
    assert.match(html, /<code dir="ltr"[^>]*>\/Users\/x\/Library\/Application Support\/loqui\/audio<\/code>/);
    assert.match(html, /storage\.audio\.confirmButton\{&quot;count&quot;:214\}/);
    assert.match(html, /data-variant="destructive"/);
  });

  await t.test("partial failure keeps the dialog open with an alert", () => {
    const html = renderToStaticMarkup(React.createElement(s.CountedDeleteContent, {
      kind: "models", row: models, phase: "partial", outcome: { deleted: 2, left: 1 }, onConfirm() {}, onCancel() {},
    }));
    assert.match(html, /role="alert"[^>]*>[^<]*storage\.partial\{&quot;left&quot;:1,&quot;deleted&quot;:2\}/);
    assert.match(html, /storage\.retry/);
  });
});
```

Create `test/helpers/transcriptionCount.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");

test("countTranscriptions counts what history shows and drops to zero after a clear", (t) => {
  const db = createDb(t);
  if (!db) return;
  assert.equal(db.countTranscriptions(), 0);
  db.db.prepare("INSERT INTO transcriptions (text) VALUES ('a'), ('b')").run();
  db.db.prepare("INSERT INTO transcriptions (text, status) VALUES ('c', 'discarded')").run();
  db.db.prepare("INSERT INTO transcriptions (text, deleted_at) VALUES ('d', '2026-01-01')").run();
  assert.equal(db.countTranscriptions(), 2);
  db.clearTranscriptions();
  assert.equal(db.countTranscriptions(), 0);
});
```

`transcriptions.text` is the only `NOT NULL` column without a default (`localDatabaseSchema.js:4-18`), so the raw insert is valid.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/storageMath.test.js test/components/storageList.test.js test/helpers/transcriptionCount.test.js`
Expected: FAIL. The modules are missing and `countTranscriptions` is not a function.

- [ ] **Step 3: Implement**

1. **Main process.**
   - In `src/helpers/audioStorage.js:200`, return `{ fileCount: files.length, totalBytes, directory: this.audioDir }`. In the catch at `:203`, return `{ fileCount: 0, totalBytes: 0, directory: this.audioDir }`.
   - In `src/helpers/database.js`, after `clearTranscriptions`, add:

     ```js
       // Counts what the history list shows (getTranscriptions, database.js:534-541).
       countTranscriptions() {
         return this.db
           .prepare("SELECT COUNT(*) AS n FROM transcriptions WHERE deleted_at IS NULL AND status != 'discarded'")
           .get().n;
       }
     ```

   - In `ipcHandlers.js`, after the `db-clear-transcriptions` handler, add `ipcMain.handle("db-count-transcriptions", () => this.databaseManager.countTranscriptions());`.
   - In `preload.js`, after `clearTranscriptions` (`:180`), add `countTranscriptions: () => ipcRenderer.invoke("db-count-transcriptions"),`.
   - Update the types as listed under Files.

   `test/helpers/personalIpcContract.test.js` already checks that every `db-*` invoke in `preload.js` has a handler, so it covers the new channel.

2. Create `src/components/settings/storageMath.ts`:

   ```ts
   export interface ModelLists {
     whisper?: { models?: { downloaded: boolean; size_bytes?: number; size_mb?: number }[] };
     parakeet?: { models?: { downloaded: boolean; size_bytes?: number; size_mb?: number }[] };
     llm?: { isDownloaded?: boolean; sizeBytes?: number; downloadedSize?: number }[];
   }

   export function summarizeModels(lists: ModelLists): { count: number; bytes: number } {
     let count = 0;
     let bytes = 0;
     for (const m of lists.whisper?.models ?? []) {
       if (!m.downloaded) continue;
       count++;
       // size_mb is rounded MiB; prefer exact bytes when main reports them.
       bytes += m.size_bytes ?? (m.size_mb ?? 0) * 1_000_000;
     }
     for (const m of lists.parakeet?.models ?? []) {
       if (!m.downloaded) continue;
       count++;
       bytes += m.size_bytes ?? (m.size_mb ?? 0) * 1_000_000;
     }
     for (const m of lists.llm ?? []) {
       if (!m.isDownloaded) continue;
       count++;
       bytes += m.downloadedSize ?? m.sizeBytes ?? 0;
     }
     return { count, bytes };
   }

   export function deletionOutcome(before: number, after: number) {
     return { deleted: Math.max(0, before - after), left: Math.max(0, after) };
   }

   export function resetConfirmed(typed: string, word: string): boolean {
     return typed.trim().toLocaleLowerCase() === word.trim().toLocaleLowerCase() && word.trim().length > 0;
   }
   ```

   In the first test, the LLM entry `{ isDownloaded: true, downloadedSize: 10 }` counts 10 bytes, because `downloadedSize` is preferred over the catalogue size. The expected sum in the test reflects that.

3. Create `src/components/settings/StorageList.tsx`:

   ```tsx
   import { useCallback, useEffect, useState } from "react";
   import type { TFunction } from "i18next";
   import { useTranslation } from "react-i18next";
   import { clearMissingLocalModelSelections } from "../../stores/settingsStore";
   import { refreshRouteFacts } from "../../stores/routeFactsStore";
   import { formatDecimalBytes } from "../../utils/formatBytes";
   import { Button } from "../ui/button";
   import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
   import { Input } from "../ui/input";
   import { useToast } from "../ui/useToast";
   import { deletionOutcome, resetConfirmed, summarizeModels } from "./storageMath";

   type Kind = "audio" | "models" | "history";
   export interface StorageRowState { count: number | null; bytes: number | null; directory: string | null }
   const EMPTY: StorageRowState = { count: null, bytes: null, directory: null };

   const summary = (t: TFunction, kind: Kind, row: StorageRowState) => {
     if (row.count === null) return t("storage.loading");
     if (row.count === 0) return t(`storage.${kind}.empty`);
     return row.bytes !== null && kind !== "history"
       ? t(`storage.${kind}.summary`, { count: row.count, size: formatDecimalBytes(row.bytes) })
       : t(`storage.${kind}.summary`, { count: row.count });
   };

   export function StorageListView(props: {
     audio: StorageRowState;
     models: StorageRowState;
     history: StorageRowState;
     onDelete: (kind: Kind) => void;
     onOpenModels: () => void;
     onReset: () => void;
   }) {
     const { t } = useTranslation();
     const row = (kind: Kind, state: StorageRowState, extra?: React.ReactNode) => (
       <div className="flex min-h-[54px] items-center gap-2 px-4 py-2">
         <div className="min-w-0 flex-1">
           <p className="text-xs font-semibold">{t(`storage.${kind}.title`)}</p>
           <p className="text-xs text-muted-foreground tabular-nums">{summary(t, kind, state)}</p>
         </div>
         {extra}
         <Button
           size="sm"
           variant="outline"
           data-storage-delete={kind}
           className="text-destructive border-destructive/30"
           disabled={!state.count}
           onClick={() => props.onDelete(kind)}
         >
           {t("storage.delete")}
         </Button>
       </div>
     );
     return (
       <section aria-labelledby="storage-title" className="space-y-2">
         <h3 id="storage-title" className="text-xs font-semibold text-muted-foreground">{t("storage.title")}</h3>
         <div className="divide-y divide-border/60 rounded-lg border border-border/70">
           {row("audio", props.audio)}
           {row(
             "models",
             props.models,
             <Button size="sm" variant="outline" onClick={props.onOpenModels}>
               {t("storage.open")}
             </Button>
           )}
           {row("history", props.history)}
           <div className="flex min-h-[54px] items-center gap-2 border-t border-destructive/30 px-4 py-2">
             <div className="min-w-0 flex-1">
               <p className="text-xs font-semibold text-destructive">{t("storage.danger")}</p>
               <p className="text-xs font-semibold">{t("storage.reset.title")}</p>
               <p className="text-xs text-muted-foreground">{t("storage.reset.description")}</p>
             </div>
             <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={props.onReset}>
               {t("storage.reset.button")}
             </Button>
           </div>
         </div>
       </section>
     );
   }

   export interface CountedDeleteProps {
     kind: Kind;
     row: StorageRowState;
     phase: "idle" | "deleting" | "partial";
     outcome?: { deleted: number; left: number };
     onConfirm: () => void;
     onCancel: () => void;
   }

   // The dialog body. Title/Description default to plain elements so the body
   // renders on the server in tests; the dialog passes Radix's labelled parts.
   export function CountedDeleteContent({
     Title = "h2",
     Description = "p",
     ...props
   }: CountedDeleteProps & { Title?: React.ElementType; Description?: React.ElementType }) {
     const { t } = useTranslation();
     const { kind, row } = props;
     const count = row.count ?? 0;
     const body =
       row.bytes !== null && kind !== "history"
         ? t(`storage.${kind}.confirmBody`, { count, size: formatDecimalBytes(row.bytes) })
         : t(`storage.${kind}.confirmBody`, { count });
     return (
       <div className="space-y-3">
         <Title className="text-base font-semibold">{t(`storage.${kind}.confirmTitle`, { count })}</Title>
         <Description className="text-sm text-muted-foreground">{body}</Description>
         {row.directory && (
           <code dir="ltr" className="block rounded bg-muted px-2 py-1 font-mono text-[11px] break-all">
             {row.directory}
           </code>
         )}
         {props.phase === "partial" && props.outcome && (
           <p role="alert" className="text-xs font-semibold text-destructive">
             {t("storage.partial", { left: props.outcome.left, deleted: props.outcome.deleted })}
           </p>
         )}
         <div className="flex justify-end gap-2">
           <Button variant="outline" onClick={props.onCancel}>
             {t("common.cancel")}
           </Button>
           <Button variant="destructive" disabled={props.phase === "deleting"} onClick={props.onConfirm}>
             {props.phase === "partial" ? t("storage.retry") : t(`storage.${kind}.confirmButton`, { count })}
           </Button>
         </div>
       </div>
     );
   }

   export function CountedDeleteDialog(props: CountedDeleteProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
     return (
       <Dialog open={props.open} onOpenChange={props.onOpenChange}>
         <DialogContent role="alertdialog">
           <CountedDeleteContent {...props} Title={DialogTitle} Description={DialogDescription} />
         </DialogContent>
       </Dialog>
     );
   }

   export function StorageList() {
     const { t } = useTranslation();
     const { toast } = useToast();
     const api = window.electronAPI;
     const [audio, setAudio] = useState<StorageRowState>(EMPTY);
     const [models, setModels] = useState<StorageRowState>(EMPTY);
     const [history, setHistory] = useState<StorageRowState>(EMPTY);
     const [dialog, setDialog] = useState<{ kind: Kind; phase: "idle" | "deleting" | "partial"; outcome?: { deleted: number; left: number } } | null>(null);
     const [resetOpen, setResetOpen] = useState(false);
     const [typed, setTyped] = useState("");

     const loadAudio = useCallback(async () => {
       const u = await api?.getAudioStorageUsage?.().catch(() => null);
       setAudio(u ? { count: u.fileCount, bytes: u.totalBytes, directory: u.directory ?? null } : EMPTY);
       return u?.fileCount ?? 0;
     }, [api]);
     const loadModels = useCallback(async () => {
       const [whisper, parakeet, llm, root] = await Promise.all([
         api?.listWhisperModels?.().catch(() => undefined),
         api?.listParakeetModels?.().catch(() => undefined),
         api?.modelGetAll?.().catch(() => undefined),
         api?.getModelCacheRoot?.().catch(() => null),
       ]);
       const sum = summarizeModels({ whisper, parakeet, llm });
       setModels({ count: sum.count, bytes: sum.bytes, directory: root ?? null });
       return sum.count;
     }, [api]);
     const loadHistory = useCallback(async () => {
       const n = await api?.countTranscriptions?.().catch(() => null);
       setHistory({ count: n ?? null, bytes: null, directory: null });
       return n ?? 0;
     }, [api]);

     useEffect(() => {
       void loadAudio();
       void loadModels();
       void loadHistory();
     }, [loadAudio, loadModels, loadHistory]);

     const rowFor = (kind: Kind) => (kind === "audio" ? audio : kind === "models" ? models : history);

     const runDelete = async (kind: Kind) => {
       const before = rowFor(kind).count ?? 0;
       setDialog({ kind, phase: "deleting" });
       let after = 0;
       try {
         if (kind === "audio") {
           await api?.deleteAllAudio?.();
           after = await loadAudio();
         } else if (kind === "models") {
           // Moved from SettingsPage.handleRemoveModels: delete every family,
           // then clear selections whose files are gone (never silently: the
           // route state shows "Choose a model").
           await Promise.allSettled([
             api?.deleteAllWhisperModels?.(),
             api?.deleteAllParakeetModels?.(),
             api?.modelDeleteAll?.(),
           ]);
           after = await loadModels();
           // As in the old handleRemoveModels: clear selections only when every
           // file is gone. After a partial failure, the surviving selections stay
           // valid and route facts mark the deleted ones as needing a model.
           if (after === 0) clearMissingLocalModelSelections(() => false);
           window.dispatchEvent(new Event("openwhispr-models-cleared"));
           void refreshRouteFacts();
         } else {
           await api?.clearTranscriptions?.();
           after = await loadHistory();
         }
       } catch {
         after = kind === "audio" ? await loadAudio() : kind === "models" ? await loadModels() : await loadHistory();
       }
       const outcome = deletionOutcome(before, after);
       if (outcome.left > 0) {
         setDialog({ kind, phase: "partial", outcome });
         return;
       }
       setDialog(null);
       toast({ title: t("storage.deleted", { count: outcome.deleted }), variant: "success", duration: 4500 });
     };

     return (
       <>
         <StorageListView
           audio={audio}
           models={models}
           history={history}
           onDelete={(kind) => setDialog({ kind, phase: "idle" })}
           onOpenModels={() => void api?.openWhisperModelsFolder?.()}
           onReset={() => {
             setTyped("");
             setResetOpen(true);
           }}
         />
         {dialog && (
           <CountedDeleteDialog
             open
             kind={dialog.kind}
             row={rowFor(dialog.kind)}
             phase={dialog.phase}
             outcome={dialog.outcome}
             onConfirm={() => void runDelete(dialog.kind)}
             onCancel={() => dialog.phase !== "deleting" && setDialog(null)}
             onOpenChange={(open) => !open && dialog.phase !== "deleting" && setDialog(null)}
           />
         )}
         <ConfirmDialog
           open={resetOpen}
           onOpenChange={setResetOpen}
           title={t("storage.reset.confirmTitle")}
           description={t("storage.reset.confirmBody")}
           confirmText={t("storage.reset.confirmButton")}
           variant="destructive"
           confirmDisabled={!resetConfirmed(typed, t("storage.reset.word"))}
           onConfirm={async () => {
             try {
               await api?.cleanupApp();
               toast({ title: t("settingsPage.developer.resetAll.successTitle"), variant: "success" });
               setTimeout(() => api?.relaunchApp(), 1000);
             } catch {
               toast({ title: t("settingsPage.developer.resetAll.failedTitle"), variant: "destructive" });
             }
           }}
         >
           <label className="block space-y-1 text-xs">
             <span>{t("storage.reset.typeLabel", { word: t("storage.reset.word") })}</span>
             <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9" autoComplete="off" />
           </label>
         </ConfirmDialog>
       </>
     );
   }
   ```

   The reset success and failure toasts reuse the existing `settingsPage.developer.resetAll.{successTitle,failedTitle}` keys, so they are not duplicated. If `ConfirmDialog` closes itself after `onConfirm`, that is fine for reset, because reset relaunches.

4. **`SettingsPage.tsx` re-homing**, per the Files list. Render `<StorageList />` in `privacyData` directly after the transcript-retention panel (`:2866`) and before the permissions cards (`:2873`). Do not touch the retention selects. Previewing retention changes is R7 B, which was not picked.

5. Write `/tmp/loqui-i18n-task-11.json` and merge it. The `en` block is below. Every key with `_one/_other` needs every plural category per locale.

   ```json
   {
     "storage": {
       "title": "Storage",
       "loading": "Counting…",
       "delete": "Delete…",
       "open": "Open",
       "retry": "Try again",
       "danger": "Danger zone",
       "deleted_one": "Deleted {{count}} item.",
       "deleted_other": "Deleted {{count}} items.",
       "partial": "Couldn't delete {{left}} (in use). {{deleted}} were deleted. Nothing else was touched.",
       "audio": {
         "title": "Dictation audio",
         "empty": "No audio files stored",
         "summary_one": "{{count}} file · {{size}}",
         "summary_other": "{{count}} files · {{size}}",
         "confirmTitle_one": "Delete {{count}} recording?",
         "confirmTitle_other": "Delete {{count}} recordings?",
         "confirmBody_one": "This permanently deletes {{count}} recording ({{size}}). Transcripts stay. Copies already sent to a provider are not affected.",
         "confirmBody_other": "This permanently deletes {{count}} recordings ({{size}}). Transcripts stay. Copies already sent to a provider are not affected.",
         "confirmButton_one": "Delete {{count}} recording",
         "confirmButton_other": "Delete {{count}} recordings"
       },
       "models": {
         "title": "Downloaded models",
         "empty": "None downloaded",
         "summary_one": "{{count}} model · {{size}}",
         "summary_other": "{{count}} models · {{size}}",
         "confirmTitle_one": "Delete {{count}} model?",
         "confirmTitle_other": "Delete {{count}} models?",
         "confirmBody_one": "This permanently deletes {{count}} model ({{size}}). Tasks that use it will ask you to choose a model again.",
         "confirmBody_other": "This permanently deletes {{count}} models ({{size}}). Tasks that use them will ask you to choose a model again.",
         "confirmButton_one": "Delete {{count}} model",
         "confirmButton_other": "Delete {{count}} models"
       },
       "history": {
         "title": "Transcript history",
         "empty": "No transcripts saved",
         "summary_one": "{{count}} item",
         "summary_other": "{{count}} items",
         "confirmTitle_one": "Delete {{count}} item?",
         "confirmTitle_other": "Delete {{count}} items?",
         "confirmBody_one": "This permanently deletes {{count}} transcript and its audio. Copies already sent to a provider are not affected.",
         "confirmBody_other": "This permanently deletes {{count}} transcripts and their audio. Copies already sent to a provider are not affected.",
         "confirmButton_one": "Delete {{count}} item",
         "confirmButton_other": "Delete {{count}} items"
       },
       "reset": {
         "title": "Reset Loqui",
         "description": "Deletes settings, history, audio, downloaded models and saved provider keys.",
         "button": "Reset…",
         "confirmTitle": "Reset Loqui?",
         "confirmBody": "This deletes settings, history, audio, downloaded models and your saved provider keys. It cannot be undone.",
         "confirmButton": "Reset Loqui",
         "typeLabel": "Type “{{word}}” to confirm",
         "word": "reset"
       }
     }
   }
   ```

   The history body says "and its audio" because `db-clear-transcriptions` also deletes all audio (`ipcHandlers.js:1287`). Translate `storage.reset.word` into a short, easy-to-type word in each language, for example de "zurücksetzen" and ja "リセット".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run native:node && npm test -- test/components/storageMath.test.js test/components/storageList.test.js test/helpers/transcriptionCount.test.js test/helpers/personalIpcContract.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually against card R7 A (`05-settings.html:1658-1672`):
- Privacy & Data shows Storage with real counts.
- Delete… on audio names the count, size and folder.
- Reset stays disabled until "reset" is typed.
- System no longer shows Clear Cache or Reset.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/storageMath.ts src/components/settings/StorageList.tsx src/helpers/audioStorage.js src/helpers/database.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/components/SettingsPage.tsx src/locales test/components/storageMath.test.js test/components/storageList.test.js test/helpers/transcriptionCount.test.js
git commit -m "feat(settings): Storage list with counted delete confirms"
```

---

### Task 12: Re-home the sections, render nav descriptions, sticky title and close (SET-R2 A part 1, SET-Q3, SET-Q18, SET-Q21)

The sections stay the same six plus Routing, but blocks move to where people look for them (SET-07):
- **Hotkeys becomes "Dictation"** (id `hotkeys` is kept, so no deep link breaks). It holds hotkeys and activation, plus microphone, paste and clipboard, transcription language and Chinese script, dictionary auto-learn, and the Linux/Wayland paste diagnostics.
- **Preferences** keeps appearance, interface language, sounds, notifications, startup, floating icon, note files and Granola import.
- Privacy & Data and System were already re-homed in Tasks 3 and 11.

The nav descriptions, written but never shown (SET-Q3), render as a second line on wide windows and as a tooltip in the compact rail. The content column gets a sticky title row with a 32×32 close button at 70% opacity (SET-Q21). The duplicated settings primitives in `SettingsPage.tsx` are deleted (SET-Q18).

**Files:**
- Create: `src/components/ui/SettingsNav.tsx` (extracted from `SidebarModal.tsx:140-215`) and `src/components/ui/SettingsTitleBar.tsx`
- Modify: `src/components/ui/SidebarModal.tsx`. Use both, and move the close button (`:135-138`) into the title bar.
- Modify: `src/components/ui/SettingsSection.tsx:100-109`. In `SectionHeader`, make `title` optional and add `note?: string | false`.
- Modify: `src/components/SettingsPage.tsx`:
  - delete `SettingsPanel`, `SettingsPanelRow` and `SectionHeader` (`:142-190`), and import them from `./ui/SettingsSection` (`:92`);
  - move these blocks from `case "general"` to the end of `case "hotkeys"`:
    - Clipboard (`:1763-1788`);
    - the transcription-language and Chinese-script part of Language (`:1915-1958`; the UI-language selector at `:1894-1913` stays);
    - Microphone (`:2013-2031`);
    - Dictionary auto-learn (`:2032-2054`);
    - Linux/Wayland paste diagnostics (`:2059-2550`).
  - drop the `title` from the first `SectionHeader` of `SpeechToTextTabs` and `LlmsTabs`, keeping the description.
- Modify: `src/components/settings/routing/RoutingSection.tsx`. Drop the `SectionHeader` title.
- Modify: `src/locales/*/translation.json`. Update the `settingsModal.sections.*.label` and `.description` values.
- Test: `test/components/settingsNav.test.js`, `test/components/settingsRehoming.test.js`

Line numbers drift after Tasks 3, 6 and 11 edit this file. Find each block by the anchors quoted below rather than by number:
- `{/* Dictionary */}`
- `<MicrophoneSettings`
- `keepTranscriptionInClipboard`
- `settingsPage.general.language`
- the Linux/Wayland IIFE that starts with `{(() => {` right after the dictionary block.

**Interfaces:**
- Produces:

  ```tsx
  export function SettingsNav<T extends string>(props: { items: SidebarItem<T>[]; activeSection: T; onSectionChange(id: T): void; isCompact: boolean }): JSX.Element;
  export function SettingsTitleBar(props: { title: string; close: React.ReactNode }): JSX.Element;
  // SectionHeader: { title?: string; description?: string; note?: string | false }
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/settingsNav.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("settings nav and title bar", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-settings-nav-test-" }));
  const { SettingsNav } = await vite.ssrLoadModule("/components/ui/SettingsNav.tsx");
  const { SettingsTitleBar } = await vite.ssrLoadModule("/components/ui/SettingsTitleBar.tsx");
  const Icon = () => null;
  const items = [
    { id: "general", label: "Preferences", description: "Appearance, sounds, startup", icon: Icon, group: "App" },
    { id: "routing", label: "Routing", description: "Where each task runs", icon: Icon, group: "AI Models" },
  ];

  await t.test("descriptions render as a second line on wide windows", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsNav, { items, activeSection: "routing", onSectionChange() {}, isCompact: false }));
    assert.match(html, /class="[^"]*hidden[^"]*min-\[1000px\]:block[^"]*"[^>]*>Where each task runs</);
    assert.match(html, /data-section-id="routing"[^>]*aria-current="page"/);
  });

  await t.test("the compact rail keeps the description as a tooltip", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsNav, { items, activeSection: "general", onSectionChange() {}, isCompact: true }));
    assert.match(html, /title="Routing — Where each task runs"/);
    assert.doesNotMatch(html, />Where each task runs</);
  });

  await t.test("the title bar is sticky and the close target is 32px at 70% opacity", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsTitleBar, {
      title: "Routing",
      close: React.createElement("button", { className: "settings-close" }, "x"),
    }));
    assert.match(html, /class="[^"]*sticky top-0[^"]*"/);
    assert.match(html, /<h2[^>]*>Routing<\/h2>/);
    assert.match(html, /settings-close/);
  });
});
```

Create `test/components/settingsRehoming.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const src = fs.readFileSync(path.join(__dirname, "../../src/components/SettingsPage.tsx"), "utf8");
const between = (start, end) => {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} … ${end}`);
  return src.slice(a, b);
};

test("dictation controls live in the Dictation section, not in Preferences", () => {
  const general = between('case "general":', 'case "hotkeys":');
  const dictation = between('case "hotkeys":', 'case "routing":');
  for (const marker of ["<MicrophoneSettings", "keepTranscriptionInClipboard", "autoLearnCorrections", "preferredLanguage"]) {
    assert.ok(!general.includes(marker), `${marker} left Preferences`);
    assert.ok(dictation.includes(marker), `${marker} is in Dictation`);
  }
  assert.ok(general.includes("uiLanguage") || general.includes("UI_LANGUAGE_OPTIONS"), "interface language stays in Preferences");
});

test("settings primitives are imported, not re-declared", () => {
  assert.doesNotMatch(src, /^function SettingsPanel\(/m);
  assert.doesNotMatch(src, /^function SettingsPanelRow\(/m);
  assert.doesNotMatch(src, /^function SectionHeader\(/m);
  assert.match(src, /import \{[^}]*SectionHeader[^}]*\} from "\.\/ui\/SettingsSection"/);
});

test("section labels and descriptions match the re-homed contents", () => {
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
  const s = en.settingsModal.sections;
  assert.equal(s.hotkeys.label, "Dictation");
  assert.equal(s.hotkeys.description, "Hotkeys, microphone, paste, language");
  assert.doesNotMatch(s.privacyData.description, /analytics/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/settingsNav.test.js test/components/settingsRehoming.test.js`
Expected: FAIL. The modules are missing, the blocks are still in `general`, and the primitives are still declared.

- [ ] **Step 3: Implement**

1. **`SectionHeader`** (`ui/SettingsSection.tsx:100-109`). Make `title` optional, render the `<h3>` only when it is present, and add the `note` line exactly as the local copy at `SettingsPage.tsx:172-190` renders it:

   ```tsx
   export function SectionHeader({ title, description, note }: { title?: string; description?: string; note?: string | false }) {
     return (
       <div className="mb-3">
         {title && <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>}
         {description && <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>}
         {note && <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{note}</p>}
       </div>
     );
   }
   ```

   Keep the exact `h3` and `p` class strings the file already uses. The block above shows the structure; copy the classes from the existing exported `SectionHeader`.

2. **Delete the duplicates** in `SettingsPage.tsx:142-190`. Change the import at `:92` to `import { InferenceModeSelector, SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "./ui/SettingsSection";`, and drop the `useSettingsLayout` import (`:95`) if nothing else uses it.

3. **Move the blocks** listed under Files, cut and paste verbatim, to the end of the `hotkeys` case's returned fragment (just before its closing `</div>`). They read component-scope state, so no props change. Keep their order: Microphone, Clipboard, Transcription language, Dictionary auto-learn, Linux paste diagnostics.

4. **Create `src/components/ui/SettingsNav.tsx`.** Move the nav markup from `SidebarModal.tsx:140-215` (groups, group labels and buttons) and change the button. Keep Plan 02's SET-Q1 `aria-current` and focus-visible ring if present; the test requires `aria-current="page"` either way.

   ```tsx
   <button
     key={item.id}
     data-section-id={item.id}
     aria-current={isActive ? "page" : undefined}
     onClick={() => onSectionChange(item.id)}
     title={isCompact ? (item.description ? `${item.label} — ${item.description}` : item.label) : undefined}
     className={`group relative w-full flex items-center text-start text-xs rounded-md transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
       isCompact ? "justify-center px-0 py-2" : "gap-2 px-2 py-1.5"
     } ${
       isActive
         ? "text-foreground bg-muted dark:bg-surface-raised"
         : "text-muted-foreground dark:text-foreground/75 hover:text-foreground hover:bg-muted/50 dark:hover:bg-surface-2"
     }`}
   >
     <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
     {!isCompact && (
       <span className="min-w-0 flex-1">
         <span className={`block truncate leading-tight ${isActive ? "font-medium" : "font-normal"}`}>{item.label}</span>
         {item.description && (
           <span className="hidden min-[1000px]:block truncate text-[11px] leading-tight text-muted-foreground">
             {item.description}
           </span>
         )}
       </span>
     )}
     {!isCompact && renderBadge(item)}
   </button>
   ```

   Move `renderBadge` and the shortcut `<kbd>` with it, unchanged. `SidebarModal` then renders `<SettingsNav items={sidebarItems} activeSection={activeSection} onSectionChange={onSectionChange} isCompact={isCompact} />` where the old nav was.

5. **Create `src/components/ui/SettingsTitleBar.tsx`:**

   ```tsx
   import type { ReactNode } from "react";

   export function SettingsTitleBar({ title, close }: { title: string; close: ReactNode }) {
     return (
       <div className="sticky top-0 z-20 -mx-6 mb-4 flex items-center justify-between gap-3 border-b border-border/60 bg-background/90 px-6 py-3 backdrop-blur-md">
         <h2 className="text-sm font-semibold text-foreground">{title}</h2>
         {close}
       </div>
     );
   }
   ```

   In `SidebarModal.tsx`:
   - Render `<SettingsTitleBar title={activeItem?.label ?? title} close={…} />` as the first child of the content column (`:243`).
   - Pass the existing `DialogPrimitive.Close` as `close`, with its classes changed to `grid h-8 w-8 place-items-center rounded-md opacity-70 hover:opacity-100 hover:bg-muted dark:hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-ring` and an `h-4 w-4` icon.
   - Delete the absolute-positioned close (`:135-138`), and delete the `mt-6`/`mt-8` offsets on `notice` that existed only to clear it (`:246` comment).
   - In compact mode, use `-mx-4 px-4` instead of `-mx-6 px-6`. Pass `compact` to the title bar, or use the `isCompact` class switch already in `SidebarModal`.
   - Keep `<DialogPrimitive.Title className="sr-only">` (`:141`) as the dialog's accessible name.

6. **Drop the duplicated titles.**
   - In `SpeechToTextTabs` and `LlmsTabs` (`SettingsPage.tsx`), change `<SectionHeader title={…} description={…} />` to `<SectionHeader description={…} />`.
   - In `RoutingSection.tsx`, do the same for `patchbay.description`.
   - In the `privacyData` case, drop the title from the first `SectionHeader`.

   The sticky title bar now names the section.

7. Write `/tmp/loqui-i18n-task-12.json` and merge it. The `en` block below overwrites existing values. In the other locales, translate the new values.

   ```json
   {
     "settingsModal": {
       "sections": {
         "general": { "label": "Preferences", "description": "Appearance, sounds, startup" },
         "hotkeys": { "label": "Dictation", "description": "Hotkeys, microphone, paste, language" },
         "speechToText": { "label": "Speech-to-Text", "description": "Engines for dictation and notes" },
         "llms": { "label": "Language Models", "description": "Cleanup, assistant, chat, on-device support" },
         "privacyData": { "label": "Privacy & Data", "description": "Retention, storage, permissions" },
         "system": { "label": "System", "description": "Updates and developer tools" }
       }
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/settingsNav.test.js test/components/settingsRehoming.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually, at 1280px and at 760px, in `de` (long strings) and `ar` (RTL), comparing against card R2 A (`05-settings.html:634-645`):
- Dictation holds the mic, paste, language and auto-learn settings.
- Descriptions show under the nav labels at full width and disappear in the icon rail.
- The title stays visible while scrolling.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/SettingsNav.tsx src/components/ui/SettingsTitleBar.tsx src/components/ui/SidebarModal.tsx src/components/ui/SettingsSection.tsx src/components/SettingsPage.tsx src/components/settings/routing/RoutingSection.tsx src/locales test/components/settingsNav.test.js test/components/settingsRehoming.test.js
git commit -m "feat(settings): Re-home dictation settings, show nav descriptions, sticky title"
```

---

### Task 13: Settings search with live controls (SET-R2 A part 2)

Settings gets a search field at the top of the sidebar. ⌘F or Ctrl+F focuses it, and so does `/` when the user is not typing in another field.
- Results replace the content pane, grouped by section, each with a breadcrumb ("Privacy & Data › Retention").
- Results carry a **live control**: toggles switch in place, selects change in place, and route results show where the task runs right now.
- ↑/↓ move the active result, Enter jumps to the setting and flashes it once, and Esc clears the query (and only the next Esc closes Settings).
- No results reads: "No setting matches "xyz". Try "mic", "retention" or "cloud"."

The settings page stays mounted while search results show, so downloads and IPC listeners survive.

**Files:**
- Create: `src/components/settings/settingsRegistry.ts`
- Create: `src/components/settings/SettingsSearchResults.tsx`
- Create: `src/components/settings/SettingsSearchField.tsx`
- Modify: `src/components/ui/SettingsSection.tsx`. `SettingsPanelRow` accepts `settingId?: string` and renders `data-setting-id`.
- Modify: `src/components/ui/SidebarModal.tsx`. Add a `search?: ReactNode` slot above the nav.
- Modify: `src/components/SettingsModal.tsx`. Add query state, result navigation, the shortcuts, jump and flash, and hide (don't unmount) `SettingsPage` while a query is active.
- Modify: the anchor sites in the table in Step 3.4.
- Modify: `src/components/settings/routing/Patchbay.tsx`. Add ``data-setting-id={`route-${route.id}`}`` on each task row wrapper.
- Modify: `src/index.css`. Add the `[data-flash="true"]` rule.
- Modify: `src/locales/*/translation.json`
- Test: `test/components/settingsRegistry.test.js`, `test/components/settingsSearchResults.test.js`

**Interfaces:**
- Consumes:
  - `parseSettingsPath` (Task 3);
  - `useResolvedRoutes`, `RouteDestinationChip` and `RouteStateChip` (Tasks 2 and 4);
  - `ROUTE_IDS`;
  - the store booleans and setters listed in Step 3.1, each verified in `src/stores/settingsStore.ts` (field default line / setter implementation line):

    | Field | Default line | Setter | Setter line |
    |---|---|---|---|
    | `audioCuesEnabled` | `:1490` | `setAudioCuesEnabled` | `:2202` |
    | `notificationsEnabled` | `:1494` | `setNotificationsEnabled` | `:2238` |
    | `notifyMeetingDetection` | `:1495` | `setNotifyMeetingDetection` | `:2239` |
    | `notifyCalendarReminders` | `:1496` | `setNotifyCalendarReminders` | `:2240` |
    | `floatingIconAutoHide` | `:1492` | `setFloatingIconAutoHide` | `:2205` |
    | `startMinimized` | `:1493` | `setStartMinimized` | `:2214` |
    | `autoPasteEnabled` | `:1558` | `setAutoPasteEnabled` | `:2339` |
    | `keepTranscriptionInClipboard` | `:1559` | `setKeepTranscriptionInClipboard` | `:2340` |
    | `dataRetentionEnabled` | `:1488` | `setDataRetentionEnabled` | `:2190` |
    | `saveDiscardedTranscriptions` | `:1489` | `setSaveDiscardedTranscriptions` | `:2201` |
    | `speakerDiarizationEnabled` | `:1528` | `setSpeakerDiarizationEnabled` | `:2253` |
    | `theme` | `:1481` | `setTheme` | `:2179` |

    Also `useCleanupModel`, `useDictationTranslation` and `useDictationAgent`, with their `set…` setters.
- Produces:

  ```ts
  // settingsRegistry.ts
  export type SettingControl =
    | { kind: "toggle"; get: (s: SettingsState) => boolean; set: (s: SettingsState, value: boolean) => void }
    | { kind: "select"; get: (s: SettingsState) => string; set: (s: SettingsState, value: string) => void; options: { value: string; labelKey: string }[] }
    | { kind: "route"; routeId: RouteId }
    | { kind: "link" };
  export interface SettingEntry { id: string; path: string; labelKey: string; descriptionKey: string; keywords: string; control: SettingControl }
  export const SETTINGS_REGISTRY: readonly SettingEntry[];
  export interface SearchGroup { section: SettingsSectionType; entries: SettingEntry[] }
  export function normalizeForSearch(text: string): string;
  export function searchSettings(query: string, translate: (key: string) => string): SearchGroup[];
  export function anchorIdFor(entry: SettingEntry): string;   // entry.id, or "route-<id>" for route entries
  // SettingsSearchResults.tsx
  export function SettingsSearchResultsView(props: { query: string; groups: SearchGroup[]; activeId: string | null; onJump(entry: SettingEntry): void }): JSX.Element;
  export function SettingsSearchResults(props: { query: string; activeId: string | null; onJump(entry: SettingEntry): void }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/settingsRegistry.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const EN = JSON.parse(fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8"));
const lookup = (json) => (key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), json) ?? key;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(fs.readFileSync(full, "utf8"));
  }
  return out;
}

test("settings registry", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-settings-registry-test-" });
  const r = await vite.ssrLoadModule("/components/settings/settingsRegistry.ts");
  const { parseSettingsPath } = await vite.ssrLoadModule("/lib/settingsPaths.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const en = lookup(EN);
  const ids = (groups) => groups.flatMap((g) => g.entries.map((e) => e.id));

  await t.test("every entry is unique, reachable and labelled in English", () => {
    const seen = new Set();
    for (const e of r.SETTINGS_REGISTRY) {
      assert.ok(!seen.has(e.id), `duplicate ${e.id}`);
      seen.add(e.id);
      const head = e.path.split("/")[0];
      const loc = parseSettingsPath(e.path);
      assert.ok(head === loc.section || head === "stt", `${e.id} path ${e.path} resolves`);
      assert.notEqual(en(e.labelKey), e.labelKey, `${e.labelKey} exists`);
      assert.notEqual(en(e.descriptionKey), e.descriptionKey, `${e.descriptionKey} exists`);
    }
    assert.equal(r.SETTINGS_REGISTRY.filter((e) => e.control.kind === "route").length, 11);
  });

  await t.test("live toggles read real store booleans", () => {
    const state = useSettingsStore.getState();
    for (const e of r.SETTINGS_REGISTRY.filter((x) => x.control.kind === "toggle")) {
      assert.equal(typeof e.control.get(state), "boolean", e.id);
    }
  });

  await t.test("search matches label, description and keywords, AND-ing tokens", () => {
    assert.equal(ids(r.searchSettings("mic", en))[0], "microphone");
    const retention = r.searchSettings("retention", en);
    assert.deepEqual(retention.map((g) => g.section), ["privacyData"]);
    assert.ok(ids(retention).includes("audioRetention") && ids(retention).includes("transcriptRetention"));
    assert.ok(ids(r.searchSettings("audio retention", en)).includes("audioRetention"));
    assert.ok(!ids(r.searchSettings("audio retention", en)).includes("transcriptRetention"));
    assert.ok(ids(r.searchSettings("cloud", en)).some((id) => id.startsWith("route:")));
    assert.deepEqual(r.searchSettings("xyzzy", en), []);
    assert.deepEqual(r.searchSettings("   ", en), []);
  });

  await t.test("search works in the user's language and ignores accents", () => {
    const de = (key) => (key === "settingsSearch.items.microphone.label" ? "Mikrofon" : en(key));
    assert.equal(ids(r.searchSettings("mikro", de))[0], "microphone");
    assert.equal(r.normalizeForSearch("Résumé"), "resume");
  });

  await t.test("every non-route entry has an anchor in the source", () => {
    const src = walk(path.join(__dirname, "../../src")).join("\n");
    for (const e of r.SETTINGS_REGISTRY.filter((x) => x.control.kind !== "route")) {
      assert.ok(
        src.includes(`data-setting-id="${e.id}"`) || src.includes(`settingId="${e.id}"`),
        `anchor for ${e.id}`
      );
    }
    assert.ok(src.includes("data-setting-id={`route-${route.id}`}"), "patchbay rows are route anchors");
  });
});
```

Create `test/components/settingsSearchResults.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");

const { withI18nMock } = require("../lib/i18nTestMock");

test("search results", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-search-results-test-" }, { withOptions: true }));
  const { SettingsSearchResultsView } = await vite.ssrLoadModule("/components/settings/SettingsSearchResults.tsx");
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule("/components/settings/settingsRegistry.ts");
  const pick = (...ids) => SETTINGS_REGISTRY.filter((e) => ids.includes(e.id));

  await t.test("grouped results with breadcrumbs, an active row and live controls", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsSearchResultsView, {
      query: "retention",
      groups: [{ section: "privacyData", entries: pick("audioRetention", "dataRetention") }],
      activeId: "dataRetention",
      onJump() {},
    }));
    assert.match(html, /settingsSearch\.count\{&quot;count&quot;:2\}/);
    assert.match(html, /settingsModal\.sections\.privacyData\.label/);
    assert.match(html, /data-result="dataRetention"[^>]*data-active="true"/);
    assert.match(html, /role="switch"/, "toggle entries render a live switch");
  });

  await t.test("no results suggests what to try", () => {
    const html = renderToStaticMarkup(React.createElement(SettingsSearchResultsView, { query: "xyz", groups: [], activeId: null, onJump() {} }));
    assert.match(html, /settingsSearch\.none\{&quot;query&quot;:&quot;xyz&quot;\}/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/components/settingsRegistry.test.js test/components/settingsSearchResults.test.js`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

1. Create `src/components/settings/settingsRegistry.ts`:

   ```ts
   import { parseSettingsPath } from "../../lib/settingsPaths";
   import { ROUTE_IDS, ROUTE_SETTINGS_PATH, type RouteId } from "../../lib/routes";
   import type { SettingsState } from "../../stores/settingsStore";
   import type { SettingsSectionType } from "../SettingsPage";

   // One declaration per searchable setting (SET-R2 A). Labels and
   // descriptions are i18n keys, so search works in the user's language;
   // keywords are language-neutral technical terms.

   export type SettingControl =
     | { kind: "toggle"; get: (s: SettingsState) => boolean; set: (s: SettingsState, value: boolean) => void }
     | {
         kind: "select";
         get: (s: SettingsState) => string;
         set: (s: SettingsState, value: string) => void;
         options: { value: string; labelKey: string }[];
       }
     | { kind: "route"; routeId: RouteId }
     | { kind: "link" };

   export interface SettingEntry {
     id: string;
     path: string;
     labelKey: string;
     descriptionKey: string;
     keywords: string;
     control: SettingControl;
   }

   const item = (id: string, path: string, keywords: string, control: SettingControl): SettingEntry => ({
     id,
     path,
     labelKey: `settingsSearch.items.${id}.label`,
     descriptionKey: `settingsSearch.items.${id}.description`,
     keywords,
     control,
   });
   const toggle = (get: (s: SettingsState) => boolean, set: (s: SettingsState, v: boolean) => void): SettingControl => ({
     kind: "toggle",
     get,
     set,
   });
   const link: SettingControl = { kind: "link" };

   export const SETTINGS_REGISTRY: readonly SettingEntry[] = [
     // Preferences
     item("theme", "general", "appearance dark light mode theme plum", {
       kind: "select",
       get: (s) => s.theme,
       set: (s, v) => s.setTheme(v as SettingsState["theme"]),
       options: [
         { value: "light", labelKey: "settingsSearch.options.theme.light" },
         { value: "dark", labelKey: "settingsSearch.options.theme.dark" },
         { value: "auto", labelKey: "settingsSearch.options.theme.auto" },
       ],
     }),
     item("audioCues", "general", "sound effects beep chime audio cues", toggle((s) => s.audioCuesEnabled, (s, v) => s.setAudioCuesEnabled(v))),
     item("notifications", "general", "notifications alerts", toggle((s) => s.notificationsEnabled, (s, v) => s.setNotificationsEnabled(v))),
     item("meetingDetection", "general", "meeting detection zoom facetime notify", toggle((s) => s.notifyMeetingDetection, (s, v) => s.setNotifyMeetingDetection(v))),
     item("calendarReminders", "general", "calendar reminders events notify", toggle((s) => s.notifyCalendarReminders, (s, v) => s.setNotifyCalendarReminders(v))),
     item("floatingIcon", "general", "floating icon pill hide", toggle((s) => s.floatingIconAutoHide, (s, v) => s.setFloatingIconAutoHide(v))),
     item("startMinimized", "general", "startup launch minimized", toggle((s) => s.startMinimized, (s, v) => s.setStartMinimized(v))),
     item("launchAtLogin", "general", "startup login autostart boot", link),
     item("uiLanguage", "general", "language locale interface ui", link),
     // Dictation (section id "hotkeys")
     item("dictationHotkey", "hotkeys", "hotkey shortcut keyboard push to talk tap hold", link),
     item("microphone", "hotkeys", "mic microphone input device audio", link),
     item("autoPaste", "hotkeys", "paste auto insert", toggle((s) => s.autoPasteEnabled, (s, v) => s.setAutoPasteEnabled(v))),
     item("keepInClipboard", "hotkeys", "clipboard copy restore", toggle((s) => s.keepTranscriptionInClipboard, (s, v) => s.setKeepTranscriptionInClipboard(v))),
     item("transcriptionLanguage", "hotkeys", "language speak transcription", link),
     item("autoLearn", "hotkeys", "dictionary auto learn corrections words", link),
     // Models
     item("cleanupEnabled", "llms/dictationCleanup", "cleanup filler grammar punctuation llm", toggle((s) => s.useCleanupModel, (s, v) => s.setUseCleanupModel(v))),
     item("assistantEnabled", "llms/dictationAgent", "voice assistant agent", toggle((s) => s.useDictationAgent, (s, v) => s.setUseDictationAgent(v))),
     item("screenContext", "llms/dictationAgent", "screen screenshot vision context", link),
     item("translationEnabled", "llms/dictationTranslation", "translate translation language", toggle((s) => s.useDictationTranslation, (s, v) => s.setUseDictationTranslation(v))),
     item("supportModels", "llms/supportModels", "speaker diarization embeddings semantic search local", link),
     item("speakerLabels", "stt/noteRecording", "speaker labels diarization meeting who", toggle((s) => s.speakerDiarizationEnabled, (s, v) => s.setSpeakerDiarizationEnabled(v))),
     item("keyring", "routing", "api key keys verify credentials provider rotate", link),
     // Privacy & Data
     item("audioRetention", "privacyData", "retention audio recordings delete keep", link),
     item("transcriptRetention", "privacyData", "retention transcripts history delete keep", link),
     item("dataRetention", "privacyData", "retention history save transcripts", toggle((s) => s.dataRetentionEnabled, (s, v) => s.setDataRetentionEnabled(v))),
     item("saveDiscarded", "privacyData", "discarded cancelled save", toggle((s) => s.saveDiscardedTranscriptions, (s, v) => s.setSaveDiscardedTranscriptions(v))),
     item("storage", "privacyData", "storage disk delete models audio reset", link),
     item("permissions", "privacyData", "permissions microphone accessibility screen recording", link),
     // System
     item("updates", "system", "updates version release check", link),
     item("debugLogging", "system", "debug logs logging developer", link),
     // Routes: one per task, shown with where it runs now.
     ...ROUTE_IDS.map((routeId) => ({
       id: `route:${routeId}`,
       path: "routing",
       labelKey: `routes.names.${routeId}`,
       descriptionKey: `routes.subtitles.${routeId}`,
       keywords: `route runs on local cloud provider server device ${ROUTE_SETTINGS_PATH[routeId].replace("/", " ")}`,
       control: { kind: "route", routeId } as SettingControl,
     })),
   ];

   export interface SearchGroup {
     section: SettingsSectionType;
     entries: SettingEntry[];
   }

   export function normalizeForSearch(text: string): string {
     return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
   }

   export function anchorIdFor(entry: SettingEntry): string {
     return entry.control.kind === "route" ? `route-${entry.control.routeId}` : entry.id;
   }

   export function searchSettings(query: string, translate: (key: string) => string): SearchGroup[] {
     const tokens = normalizeForSearch(query).split(/\s+/).filter(Boolean);
     if (tokens.length === 0) return [];
     const scored = SETTINGS_REGISTRY.map((entry, index) => {
       const section = parseSettingsPath(entry.path).section;
       const label = normalizeForSearch(translate(entry.labelKey));
       const haystack = normalizeForSearch(
         [translate(entry.labelKey), translate(entry.descriptionKey), translate(`settingsModal.sections.${section}.label`), entry.keywords].join(" ")
       );
       if (!tokens.every((tok) => haystack.includes(tok))) return null;
       // Label hits rank above description/keyword hits; registry order breaks ties.
       const score = tokens.filter((tok) => label.includes(tok)).length;
       return { entry, section, index, score };
     }).filter((x): x is NonNullable<typeof x> => x !== null);
     scored.sort((a, b) => b.score - a.score || a.index - b.index);
     const groups: SearchGroup[] = [];
     for (const s of scored) {
       const group = groups.find((g) => g.section === s.section);
       if (group) group.entries.push(s.entry);
       else groups.push({ section: s.section, entries: [s.entry] });
     }
     return groups;
   }
   ```

   In the first test, "mic" matches `microphone` (label hit) and also `permissions` (keyword "microphone"). The label score puts `microphone` first.

2. Create `src/components/settings/SettingsSearchResults.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { useResolvedRoutes } from "../../lib/routes";
   import { parseSettingsPath } from "../../lib/settingsPaths";
   import { useSettingsStore } from "../../stores/settingsStore";
   import { RouteDestinationChip, RouteStateChip } from "./routing/RouteChips";
   import { Toggle } from "../ui/toggle";
   import { searchSettings, type SearchGroup, type SettingEntry } from "./settingsRegistry";

   function LiveControl({ entry }: { entry: SettingEntry }) {
     const { t } = useTranslation();
     const settings = useSettingsStore();
     const routes = useResolvedRoutes();
     const label = t(entry.labelKey);
     const c = entry.control;
     if (c.kind === "toggle") return <Toggle checked={c.get(settings)} onChange={(v) => c.set(settings, v)} aria-label={label} />;
     if (c.kind === "select") {
       return (
         <select
           aria-label={label}
           value={c.get(settings)}
           onChange={(e) => c.set(settings, e.target.value)}
           className="h-7 rounded-md border border-border bg-background px-2 text-xs"
         >
           {c.options.map((o) => (
             <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
           ))}
         </select>
       );
     }
     if (c.kind === "route") {
       const route = routes.find((r) => r.id === c.routeId);
       return route ? (
         <span className="flex items-center gap-2">
           <RouteDestinationChip route={route} />
           <RouteStateChip state={route.state} />
         </span>
       ) : null;
     }
     return null;
   }

   export function SettingsSearchResultsView({
     query,
     groups,
     activeId,
     onJump,
   }: {
     query: string;
     groups: SearchGroup[];
     activeId: string | null;
     onJump: (entry: SettingEntry) => void;
   }) {
     const { t } = useTranslation();
     const count = groups.reduce((n, g) => n + g.entries.length, 0);
     if (count === 0) {
       return <p className="py-8 text-center text-sm text-muted-foreground">{t("settingsSearch.none", { query })}</p>;
     }
     return (
       <div className="space-y-4">
         <p aria-live="polite" className="text-xs text-muted-foreground">{t("settingsSearch.count", { count })}</p>
         {groups.map((group) => (
           <section key={group.section} className="space-y-1.5">
             <h3 className="text-[11px] font-semibold text-muted-foreground">{t(`settingsModal.sections.${group.section}.label`)}</h3>
             {group.entries.map((entry) => {
               const sub = parseSettingsPath(entry.path).subTab;
               return (
                 <div
                   key={entry.id}
                   data-result={entry.id}
                   data-active={activeId === entry.id ? "true" : "false"}
                   className="flex min-h-[52px] items-center gap-3 rounded-lg border border-border px-3 py-2 data-[active=true]:border-ring data-[active=true]:ring-2 data-[active=true]:ring-ring/30"
                 >
                   <button type="button" onClick={() => onJump(entry)} className="min-w-0 flex-1 text-start">
                     <span className="block text-[11px] text-muted-foreground">
                       {t(`settingsModal.sections.${group.section}.label`)}
                       {sub ? ` › ${t(`settingsSearch.subTabs.${sub}`)}` : ""}
                     </span>
                     <span className="block text-xs font-semibold">{t(entry.labelKey)}</span>
                     <span className="block truncate text-xs text-muted-foreground">{t(entry.descriptionKey)}</span>
                   </button>
                   <LiveControl entry={entry} />
                 </div>
               );
             })}
           </section>
         ))}
       </div>
     );
   }

   export function SettingsSearchResults(props: { query: string; activeId: string | null; onJump: (entry: SettingEntry) => void }) {
     const { t } = useTranslation();
     return <SettingsSearchResultsView {...props} groups={searchSettings(props.query, t)} />;
   }
   ```

   The view test passes `groups` directly, and `Toggle` renders `role="switch"`. `LiveControl` calls `useSettingsStore()` and `useResolvedRoutes()`, which work in SSR with the store's initial state.

3. Create `src/components/settings/SettingsSearchField.tsx`:

   ```tsx
   import { forwardRef } from "react";
   import { useTranslation } from "react-i18next";
   import { Search } from "../icons";

   const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

   export const SettingsSearchField = forwardRef<
     HTMLInputElement,
     { value: string; onChange: (v: string) => void; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void }
   >(function SettingsSearchField({ value, onChange, onKeyDown }, ref) {
     const { t } = useTranslation();
     return (
       <div className="relative px-3 pt-3" data-escape-active={value ? "true" : "false"}>
         <Search className="pointer-events-none absolute start-5 top-1/2 mt-1.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
         <input
           ref={ref}
           type="search"
           value={value}
           onChange={(e) => onChange(e.target.value)}
           onKeyDown={onKeyDown}
           placeholder={t("settingsSearch.placeholder")}
           aria-label={t("settingsSearch.placeholder")}
           autoComplete="off"
           className="h-8 w-full rounded-lg border border-border bg-background ps-7 pe-10 text-xs focus-visible:outline-2 focus-visible:outline-ring"
         />
         <kbd aria-hidden="true" dir="ltr" className="pointer-events-none absolute end-5 top-1/2 mt-1.5 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">
           {isMac ? "⌘F" : "Ctrl F"}
         </kbd>
       </div>
     );
   });
   ```

   In compact mode the sidebar is a 48px icon rail. `SidebarModal` then renders the `search` slot at the top of the content column, above the title bar, instead of in the sidebar. The ⌘F and `/` shortcuts work the same in both layouts, because `SettingsModal` owns them.

4. **Anchors.** Add a `settingId` prop to `SettingsPanelRow` in `ui/SettingsSection.tsx`:

   ```tsx
   export function SettingsPanelRow({ children, className = "", settingId }: { children: React.ReactNode; className?: string; settingId?: string }) {
     const { isCompact } = useSettingsLayout();
     return (
       <div data-setting-id={settingId} className={`${isCompact ? "px-3 py-2.5" : "px-4 py-3"} ${className}`}>
         {children}
       </div>
     );
   }
   ```

   Then put the anchor on the row or wrapper of each entry. Find each site by its marker:

   | id | File | Marker to find | Put on |
   |---|---|---|---|
   | theme | `SettingsPage.tsx` (general) | the Light/Dark/Auto segmented control | its `SettingsPanelRow settingId="theme"` |
   | audioCues | `SettingsPage.tsx` | `audioCuesEnabled` toggle | row |
   | notifications | `SettingsPage.tsx` | `notificationsEnabled` toggle | row |
   | meetingDetection | `SettingsPage.tsx` | `notifyMeetingDetection` | row |
   | calendarReminders | `SettingsPage.tsx` | `notifyCalendarReminders` | row |
   | floatingIcon | `SettingsPage.tsx` | `floatingIconAutoHide` | row |
   | startMinimized | `SettingsPage.tsx` | `startMinimized` toggle | row |
   | launchAtLogin | `SettingsPage.tsx` | `handleAutoStartChange` toggle | row |
   | uiLanguage | `SettingsPage.tsx` | `UI_LANGUAGE_OPTIONS` selector | row |
   | dictationHotkey | `SettingsPage.tsx` (hotkeys) | first `<HotkeyListInput` | its wrapper `<div data-setting-id="dictationHotkey">` |
   | microphone | `SettingsPage.tsx` (hotkeys after Task 12) | `<MicrophoneSettings` | wrapper `div` |
   | autoPaste | `SettingsPage.tsx` | `autoPasteEnabled` | row |
   | keepInClipboard | `SettingsPage.tsx` | `keepTranscriptionInClipboard` | row |
   | transcriptionLanguage | `SettingsPage.tsx` | `preferredLanguage` selector | row |
   | autoLearn | `SettingsPage.tsx` | `autoLearnCorrections` toggle | row |
   | cleanupEnabled | `SettingsPage.tsx` `AiModelsSection` | `useCleanupModel` toggle | row |
   | assistantEnabled | `settings/DictationAgentSettings.tsx` | `useDictationAgent` toggle | row |
   | screenContext | `settings/DictationAgentSettings.tsx` | `dictationAgent.screenContext.enable` | row |
   | translationEnabled | `settings/DictationTranslationSettings.tsx` | `useDictationTranslation` toggle | row |
   | supportModels | `settings/LocalSupportModels.tsx` | root `div` | `data-setting-id="supportModels"` |
   | speakerLabels | `settings/MeetingSettings.tsx:19-27` | `MeetingSpeakerDetectionRow` | row |
   | keyring | `settings/routing/KeyringPanel.tsx` | `<section aria-labelledby="keyring-title"` | `data-setting-id="keyring"` |
   | audioRetention | `SettingsPage.tsx` (privacyData) | audio-retention select | row |
   | transcriptRetention | `SettingsPage.tsx` | transcript-retention select | row |
   | dataRetention | `SettingsPage.tsx` | `dataRetentionEnabled` toggle | row |
   | saveDiscarded | `SettingsPage.tsx` | `saveDiscardedTranscriptions` toggle | row |
   | storage | `settings/StorageList.tsx` | `<section aria-labelledby="storage-title"` | `data-setting-id="storage"` |
   | permissions | `SettingsPage.tsx` | the permissions cards wrapper (`PermissionCard` group) | wrapper `div` |
   | updates | `settings/UpdateSettings.tsx` | root element | `data-setting-id="updates"` |
   | debugLogging | `DeveloperSection.tsx` | debug `Toggle` (`:147`) | its row |

   In `Patchbay.tsx`, add ``data-setting-id={`route-${route.id}`}`` to the `<div key={route.id} className="flex items-center gap-1">` wrapper of each task row.

5. **`SidebarModal`.** Add a `search?: ReactNode` prop. Render it above `<SettingsNav>` when `!isCompact`, and as the first child of the content column when `isCompact`.

6. **`SettingsModal`.** Add the search state and behaviour:

   ```tsx
   const { t } = useTranslation();
   const [query, setQuery] = useState("");
   const [activeIndex, setActiveIndex] = useState(0);
   const searchRef = useRef<HTMLInputElement>(null);
   const groups = useMemo(() => searchSettings(query, t), [query, t]);
   const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
   const activeId = flat[Math.min(activeIndex, flat.length - 1)]?.id ?? null;
   const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

   const jump = (entry: SettingEntry) => {
     setQuery("");
     handleNavigateToPath(entry.path);
     setPendingAnchor(anchorIdFor(entry));
   };

   useEffect(() => {
     if (!pendingAnchor) return;
     const frame = requestAnimationFrame(() => {
       const el = document.querySelector<HTMLElement>(`[data-setting-id="${CSS.escape(pendingAnchor)}"]`);
       if (el) {
         el.scrollIntoView({ block: "center" });
         el.dataset.flash = "true";
         window.setTimeout(() => delete el.dataset.flash, 1400);
       }
       setPendingAnchor(null);
     });
     return () => cancelAnimationFrame(frame);
   }, [pendingAnchor, activeSection]);

   useEffect(() => {
     if (!open) return;
     const onKey = (e: KeyboardEvent) => {
       const target = e.target as HTMLElement | null;
       const typing = !!target?.closest("input, textarea, select, [contenteditable=true]");
       if ((e.key === "f" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
         e.preventDefault();
         searchRef.current?.focus();
         searchRef.current?.select();
       }
     };
     document.addEventListener("keydown", onKey);
     return () => document.removeEventListener("keydown", onKey);
   }, [open]);

   const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
     if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, Math.max(0, flat.length - 1))); }
     else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); }
     else if (e.key === "Enter" && flat[activeIndex]) { e.preventDefault(); jump(flat[activeIndex]); }
     else if (e.key === "Escape" && query) { setQuery(""); }
   };
   ```

   - Pass `search={<SettingsSearchField ref={searchRef} value={query} onChange={(v) => { setQuery(v); setActiveIndex(0); }} onKeyDown={onSearchKey} />}` to `SidebarModal`.
   - Render the children as:

     ```tsx
     <>
       {query && <SettingsSearchResults query={query} activeId={activeId} onJump={jump} />}
       <div className={query ? "hidden" : undefined}>
         <SettingsPage … />
       </div>
     </>
     ```

   - Make `handleSectionChange` also call `setQuery("")`, so that clicking a nav item clears the search.

7. Append to `src/index.css`:

   ```css
   /* Settings search landing (SET-R2 A): flash the row once. */
   [data-setting-id][data-flash="true"] {
     animation: settings-flash 1.4s var(--motion-ease-std);
     outline: 2px solid var(--color-ring);
     outline-offset: 2px;
     border-radius: 8px;
   }
   @keyframes settings-flash {
     0%, 40% { background-color: color-mix(in srgb, var(--color-ring) 16%, transparent); }
     100% { background-color: transparent; }
   }
   @media (prefers-reduced-motion: reduce) {
     [data-setting-id][data-flash="true"] { animation: none; }
   }
   ```

   Under reduced motion the orange outline remains for 1.4 s and the background flash is dropped. Colour feedback without movement is allowed.

8. Write `/tmp/loqui-i18n-task-13.json` and merge it. The `en` block is below. `count` needs every plural category per locale. The `subTabs` labels reuse wording from the existing tab keys.

   ```json
   {
     "settingsSearch": {
       "placeholder": "Search settings",
       "count_one": "{{count}} result",
       "count_other": "{{count}} results",
       "none": "No setting matches “{{query}}”. Try “mic”, “retention” or “cloud”.",
       "subTabs": {
         "dictation": "Dictation", "noteRecording": "Note recording", "upload": "Audio upload",
         "dictationCleanup": "Cleanup", "dictationAgent": "Voice assistant", "dictationTranslation": "Translation",
         "noteFormatting": "Note formatting", "chatIntelligence": "Chat", "supportModels": "On-device support"
       },
       "options": { "theme": { "light": "Light", "dark": "Dark", "auto": "Match system" } },
       "items": {
         "theme": { "label": "Appearance", "description": "Light, dark or follow the system" },
         "audioCues": { "label": "Sound effects", "description": "Play a sound when dictation starts and stops" },
         "notifications": { "label": "Notifications", "description": "Allow Loqui to show notifications" },
         "meetingDetection": { "label": "Meeting detection", "description": "Notify me when a meeting app starts" },
         "calendarReminders": { "label": "Calendar reminders", "description": "Remind me before calendar events" },
         "floatingIcon": { "label": "Auto-hide floating icon", "description": "Hide the pill when Loqui is idle" },
         "startMinimized": { "label": "Start minimized", "description": "Open in the background at startup" },
         "launchAtLogin": { "label": "Launch at login", "description": "Start Loqui when you sign in" },
         "uiLanguage": { "label": "Interface language", "description": "The language Loqui's menus use" },
         "dictationHotkey": { "label": "Dictation hotkey", "description": "Tap to talk, hold to push-to-talk" },
         "microphone": { "label": "Microphone", "description": "Which input device Loqui records from" },
         "autoPaste": { "label": "Paste automatically", "description": "Insert the text where your cursor is" },
         "keepInClipboard": { "label": "Keep text in clipboard", "description": "Leave the dictated text on the clipboard after pasting" },
         "transcriptionLanguage": { "label": "Transcription language", "description": "The language you speak most" },
         "autoLearn": { "label": "Dictionary auto-learn", "description": "Add corrected words to your dictionary" },
         "cleanupEnabled": { "label": "Dictation cleanup", "description": "Fix fillers, grammar and punctuation" },
         "assistantEnabled": { "label": "Voice assistant", "description": "Ask by voice and get an answer" },
         "screenContext": { "label": "Screen context", "description": "Send a screenshot with assistant requests" },
         "translationEnabled": { "label": "Translation", "description": "Dictate in one language, paste in another" },
         "supportModels": { "label": "On-device support models", "description": "Speaker identification and semantic search" },
         "speakerLabels": { "label": "Speaker labels", "description": "Tell speakers apart in meeting notes" },
         "keyring": { "label": "Keyring", "description": "Saved provider keys and whether they still work" },
         "audioRetention": { "label": "Audio retention", "description": "How long dictation audio is kept" },
         "transcriptRetention": { "label": "Transcript retention", "description": "How long saved transcripts are kept" },
         "dataRetention": { "label": "Keep history", "description": "Save transcripts to your history" },
         "saveDiscarded": { "label": "Save discarded dictations", "description": "Keep dictations you cancelled" },
         "storage": { "label": "Storage", "description": "Audio, models and history on this device" },
         "permissions": { "label": "Permissions", "description": "Microphone, accessibility and screen recording" },
         "updates": { "label": "Updates", "description": "Check GitHub for new releases" },
         "debugLogging": { "label": "Debug logging", "description": "Write detailed logs to disk" }
       }
     }
   }
   ```

   Before merging, open each settings row these entries point to and check that the English label matches what the row says. If a row's own label is clearer, copy it here so search shows the same words as the page.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/components/settingsRegistry.test.js test/components/settingsSearchResults.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS.

Then check manually against card R2 A:
- ⌘F focuses search, and typing "mic" shows Microphone first.
- ↓ and Enter jump to Dictation and flash the row.
- Toggling "Sound effects" in the results flips it in place.
- Esc clears the query, and a second Esc closes Settings.
- Start a model download, search, then clear the search: the download progress is still there.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/settingsRegistry.ts src/components/settings/SettingsSearchResults.tsx src/components/settings/SettingsSearchField.tsx src/components/ui/SettingsSection.tsx src/components/ui/SidebarModal.tsx src/components/SettingsModal.tsx src/components/SettingsPage.tsx src/components/settings src/components/DeveloperSection.tsx src/index.css src/locales test/components/settingsRegistry.test.js test/components/settingsSearchResults.test.js
git commit -m "feat(settings): Search settings with live controls"
```

---

### Task 14: Honest copy and labels (SET-Q15, SET-Q19, SET-Q22, SET-Q23, SET-Q24)

Five small fixes:
- **Q15.** The screen-context description names where screenshots go, computed from the `assistantVision` route.
- **Q19.** Self-hosted inputs are properly labelled and get a **Test** button that lists the server's models.
- **Q22.** "Fully private" becomes "Runs on this device. Nothing leaves it.", the local Whisper tab is labelled "Whisper" instead of "OpenAI", and "Oruk" is explained.
- **Q23.** Dictionary import and export get text labels, and auto-learn moves inline.
- **Q24.** "Review dictation setup" becomes a text link below the engine controls.

**Plan 02 overlap:**
- Plan 02's SET-Q11 changes the placeholder in `SelfHostedPanel.tsx:22`. Keep its value.
- Plan 02's SET-Q6 may already have translated "Review dictation setup / Open setup" (`SettingsPage.tsx:627-633`). If those keys exist, reuse them for the link instead of adding `settingsPage.transcription.reviewSetupLink`.

**Files:**
- Create: `src/components/settings/screenContextCopy.ts`
- Modify: `src/components/settings/DictationAgentSettings.tsx`. The screen-context row description is around `:160-170`.
- Modify: `src/components/SelfHostedPanel.tsx` (52 lines)
- Create: `src/helpers/selfHostedProbe.js`, an unauthenticated model-list probe in main. Also modify `src/helpers/ipcHandlers.js`, `preload.js`, `src/types/electron.ts` and `src/preview/browserPreview.ts` to expose `probeSelfHosted`.
- Modify: `docs/PRIVACY.md`. Add a sentence to the connection-check row (`:51`).
- Modify: `src/helpers/localASROrganization.ts:8-13`
- Modify: `src/components/TranscriptionModelPicker.tsx`. Add the Oruk hint under the local tabs (`:1309-1314`).
- Create: `src/components/DictionaryHeaderActions.tsx`
- Modify: `src/components/DictionaryView.tsx`. Replace the list header actions (`:259-279`), and label the in-field import button (`:190-196`).
- Modify: `src/components/SettingsPage.tsx`. In `TranscriptionSection`, move the review card (`:620-635`) below the pickers as a link.
- Modify: `src/locales/*/translation.json`. Update the four `*.localDesc` values and add new keys.
- Test: `test/components/screenContextCopy.test.js`, `test/components/selfHostedPanel.test.js`, `test/components/dictionaryHeaderActions.test.js`, `test/components/settingsCopy.test.js`, `test/helpers/selfHostedProbe.test.js`

**Interfaces:**
- Consumes:
  - `useResolvedRoute("assistantVision")` (Task 2);
  - A new `window.electronAPI.probeSelfHosted(baseUrl) → Promise<{ ok: true; count: number } | { ok: false; code: "invalidUrl" | "httpsRequired" | "network" | "timeout" | "http"; status?: number }>`.
    - Do **not** reuse `personalInference.models`. Without an `inferenceScope` it resolves `credentialRef` to `custom:dictationCleanup`, then sends the user's stored Bearer key to whatever URL was typed.
    - This probe sends no headers at all.
  - `useSettings()`'s `autoLearnCorrections` and `setAutoLearnCorrections` (`src/hooks/useSettings.ts:159-174`).
- Produces:

  ```ts
  export function screenContextCopy(route: Pick<ResolvedRoute, "locality" | "providerId" | "model">, t: (k: string, o?: Record<string, unknown>) => string): string;
  export function DictionaryHeaderActions(props: { onClearAll(): void; onExport(): void; onImport(): void; autoLearn: boolean; onAutoLearnChange(v: boolean): void }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/components/screenContextCopy.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const tr = (k, o) => `${k}${o ? JSON.stringify(o) : ""}`;

test("screen-context copy says where the screenshot goes", async () => {
  const { screenContextCopy } = await import("../../src/components/settings/screenContextCopy.ts");
  assert.equal(
    screenContextCopy({ locality: "device", providerId: null, model: "Qwen3.5 2B" }, tr),
    'dictationAgent.screenContext.goesToDevice{"model":"Qwen3.5 2B"}'
  );
  assert.equal(screenContextCopy({ locality: "network", providerId: null, model: null }, tr), "dictationAgent.screenContext.goesToServer");
  assert.equal(
    screenContextCopy({ locality: "remote", providerId: "anthropic", model: "Claude Sonnet" }, tr),
    'dictationAgent.screenContext.goesToProvider{"provider":"Anthropic"}'
  );
  assert.equal(
    screenContextCopy({ locality: "device", providerId: null, model: null }, tr),
    "dictationAgent.screenContext.goesToDeviceNoModel"
  );
});
```

Create `test/components/selfHostedPanel.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("self-hosted inputs are labelled and the panel can test the server", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-self-hosted-test-" }));
  const SelfHostedPanel = (await vite.ssrLoadModule("/components/SelfHostedPanel.tsx")).default;
  const html = renderToStaticMarkup(React.createElement(SelfHostedPanel, {
    service: "reasoning", url: "http://192.168.1.20:11434/v1", onUrlChange() {}, model: "", onModelChange() {},
  }));
  const fors = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(fors.length, 2);
  for (const id of fors) assert.ok(html.includes(`id="${id}"`), `input for ${id}`);
  assert.match(html, /settingsPage\.selfHosted\.test/);
  assert.doesNotMatch(html, /192\.168\.1\.126/, "no personal LAN IP placeholder");
});
```

Create `test/components/dictionaryHeaderActions.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installBrowserGlobals, createRendererServer } = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("dictionary actions have visible words and auto-learn is inline", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, withI18nMock({ cachePrefix: "loqui-dictionary-actions-test-" }));
  const { DictionaryHeaderActions } = await vite.ssrLoadModule("/components/DictionaryHeaderActions.tsx");
  const html = renderToStaticMarkup(React.createElement(DictionaryHeaderActions, {
    onClearAll() {}, onExport() {}, onImport() {}, autoLearn: true, onAutoLearnChange() {},
  }));
  assert.match(html, />dictionary\.importAction</);
  assert.match(html, />dictionary\.exportAction</);
  assert.match(html, />dictionary\.clearAll</);
  assert.match(html, /role="switch"[^>]*aria-checked="true"/);
  assert.match(html, /settingsPage\.dictionary\.autoLearnTitle/);
});
```

Create `test/helpers/selfHostedProbe.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { probeSelfHosted } = require("../../src/helpers/selfHostedProbe.js");

test("the probe lists models without sending any credential", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "a" }, { id: "b" }] }) };
  };
  assert.deepEqual(await probeSelfHosted("http://192.168.1.20:11434/v1/", fetchImpl), { ok: true, count: 2 });
  assert.equal(calls[0].url, "http://192.168.1.20:11434/v1/models");
  assert.equal(calls[0].init.headers, undefined, "no Authorization header, ever");
});

test("the probe classifies failures and refuses plain http to public hosts", async () => {
  assert.deepEqual(await probeSelfHosted("not a url", async () => ({})), { ok: false, code: "invalidUrl" });
  assert.deepEqual(await probeSelfHosted("http://example.com/v1", async () => ({})), { ok: false, code: "httpsRequired" });
  assert.deepEqual(
    await probeSelfHosted("http://localhost:8178", async () => ({ ok: false, status: 404, json: async () => ({}) })),
    { ok: false, code: "http", status: 404 }
  );
  assert.deepEqual(
    await probeSelfHosted("http://localhost:8178", async () => { throw new Error("ECONNREFUSED"); }),
    { ok: false, code: "network" }
  );
});
```

Create `test/components/settingsCopy.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const en = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8"));

test("local mode no longer claims 'fully private'", () => {
  const values = [
    en.settingsPage.transcription.modes.localDesc,
    en.settingsPage.aiModels.modes.localDesc,
    en.agentMode.settings.modes.localDesc,
    en.dictationAgent.modes.localDesc,
  ];
  for (const v of values) {
    assert.doesNotMatch(v, /fully private/i);
    assert.match(v, /Nothing leaves/);
  }
});

test("the local Whisper family is labelled Whisper, not OpenAI", async () => {
  const { LOCAL_ASR_ORGANIZATIONS } = await import("../../src/helpers/localASROrganization.ts");
  assert.equal(LOCAL_ASR_ORGANIZATIONS.find((o) => o.id === "whisper").name, "Whisper");
});

test("'Review dictation setup' is a link below the engine controls", () => {
  const src = fs.readFileSync(path.join(root, "src/components/SettingsPage.tsx"), "utf8");
  const section = src.slice(src.indexOf("function TranscriptionSection"), src.indexOf("function AiModelsSection"));
  assert.ok(!section.includes(">Review dictation setup<"), "no hard-coded English");
  const picker = section.indexOf('renderTranscriptionPicker("local")');
  const link = section.indexOf("onClick={startOnboarding}");
  assert.ok(picker > 0 && link > picker, "the link follows the engine controls");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/helpers/selfHostedProbe.test.js test/components/screenContextCopy.test.js test/components/selfHostedPanel.test.js test/components/dictionaryHeaderActions.test.js test/components/settingsCopy.test.js`
Expected: FAIL. The modules are missing, the labels lack `for`, the copy still says "Fully private", the tab is still "OpenAI", and the card still comes first.

- [ ] **Step 3: Implement**

1. **Q15.** Create `src/components/settings/screenContextCopy.ts`:

   ```ts
   import { providerDisplayLabel } from "../../lib/locality";
   import type { ResolvedRoute } from "../../lib/routes";

   // SET-Q15: name the screenshot's destination, from the assistantVision route.
   export function screenContextCopy(
     route: Pick<ResolvedRoute, "locality" | "providerId" | "model">,
     t: (k: string, o?: Record<string, unknown>) => string
   ): string {
     if (route.locality === "remote") {
       return t("dictationAgent.screenContext.goesToProvider", { provider: providerDisplayLabel(route.providerId, t) });
     }
     if (route.locality === "network") return t("dictationAgent.screenContext.goesToServer");
     return route.model
       ? t("dictationAgent.screenContext.goesToDevice", { model: route.model })
       : t("dictationAgent.screenContext.goesToDeviceNoModel");
   }
   ```

   In `DictationAgentSettings.tsx`, add `const visionRoute = useResolvedRoute("assistantVision");`. Then replace `t("dictationAgent.screenContext.enableDescription")` in the screen-context `SettingsRow` with `screenContextCopy(visionRoute, t)`, and keep the `unsupported` branch. The route is computed even while screen context is off (Task 1, clarification 3), so the copy is right before the user turns it on.

2. **Q19.** Rewrite `src/components/SelfHostedPanel.tsx`. Keep the props, and keep Plan 02's placeholder if it already changed. Otherwise use `http://localhost:8178` for transcription and `http://localhost:11434/v1` for reasoning:

   ```tsx
   import { useId, useState } from "react";
   import { useTranslation } from "react-i18next";
   import { Button } from "./ui/button";
   import { Input } from "./ui/input";

   interface SelfHostedPanelProps {
     service: "transcription" | "reasoning";
     url: string;
     onUrlChange: (url: string) => void;
     model?: string;
     onModelChange?: (model: string) => void;
   }

   type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "ok"; count: number } | { kind: "fail"; host: string };

   export default function SelfHostedPanel({ service, url, onUrlChange, model, onModelChange }: SelfHostedPanelProps) {
     const { t } = useTranslation();
     const urlId = useId();
     const modelId = useId();
     const [test, setTest] = useState<TestState>({ kind: "idle" });
     const placeholderUrl = service === "transcription" ? "http://localhost:8178" : "http://localhost:11434/v1";

     const runTest = async () => {
       let host = url;
       try {
         host = new URL(url.trim()).host;
       } catch {
         setTest({ kind: "fail", host: url });
         return;
       }
       setTest({ kind: "testing" });
       // Main's probe sends no credentials (see selfHostedProbe.js).
       const result = await window.electronAPI?.probeSelfHosted?.(url.trim()).catch(() => null);
       setTest(result?.ok ? { kind: "ok", count: result.count } : { kind: "fail", host });
     };

     return (
       <div className="border border-border rounded-lg p-3 space-y-2.5">
         <div className="space-y-1.5">
           <label htmlFor={urlId} className="block text-xs font-medium text-foreground">
             {t("settingsPage.selfHosted.serverUrl")}
           </label>
           <div className="flex gap-2">
             <Input id={urlId} dir="ltr" value={url} onChange={(e) => { onUrlChange(e.target.value); setTest({ kind: "idle" }); }} placeholder={placeholderUrl} className="h-8 text-sm" />
             <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={!url.trim() || test.kind === "testing"}>
               {test.kind === "testing" ? t("settingsPage.selfHosted.testing") : t("settingsPage.selfHosted.test")}
             </Button>
           </div>
           <p role="status" aria-live="polite" className={`text-xs ${test.kind === "fail" ? "text-destructive" : "text-muted-foreground"}`}>
             {test.kind === "ok" && t("settingsPage.selfHosted.testOk", { count: test.count })}
             {test.kind === "fail" && t("settingsPage.selfHosted.testFail", { host: test.host })}
           </p>
         </div>
         {onModelChange && (
           <div className="space-y-1.5">
             <label htmlFor={modelId} className="block text-xs font-medium text-foreground">
               {t("common.model")}
             </label>
             <Input id={modelId} dir="ltr" value={model ?? ""} onChange={(e) => onModelChange(e.target.value)} placeholder="whisper-large-v3-turbo" className="h-8 text-sm" />
           </div>
         )}
       </div>
     );
   }
   ```

   Create `src/helpers/selfHostedProbe.js`:

   ```js
   const { isPrivateHost } = require("./providerConnectionTest");

   // "Test" for a self-hosted server: GET <base>/models with no headers, so no
   // stored key can ever reach an address the user is still typing.
   async function probeSelfHosted(baseUrl, fetchImpl = fetch, timeoutMs = 8000) {
     let url;
     try {
       url = new URL(String(baseUrl).trim());
     } catch {
       return { ok: false, code: "invalidUrl" };
     }
     if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, code: "invalidUrl" };
     if (url.protocol === "http:" && !isPrivateHost(url.hostname)) return { ok: false, code: "httpsRequired" };
     const endpoint = `${url.href.replace(/\/+$/, "")}/models`;
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(), timeoutMs);
     try {
       const res = await fetchImpl(endpoint, { method: "GET", signal: controller.signal });
       if (!res.ok) return { ok: false, code: "http", status: res.status };
       const body = await res.json().catch(() => ({}));
       return { ok: true, count: Array.isArray(body?.data) ? body.data.length : 0 };
     } catch (error) {
       return { ok: false, code: error?.name === "AbortError" ? "timeout" : "network" };
     } finally {
       clearTimeout(timer);
     }
   }

   module.exports = { probeSelfHosted };
   ```

   `isPrivateHost` is defined in `providerConnectionTest.js:54` but not exported (`:335` exports only `resolveProviderRequest` and `testProviderConnection`). Change `:335` to `module.exports = { isPrivateHost, resolveProviderRequest, testProviderConnection };` so the probe and the connection test share one private-host rule.

   Wire it up:
   - In `ipcHandlers.js`, next to `test-provider-connection`, add `ipcMain.handle("probe-self-hosted", (_e, baseUrl) => require("./selfHostedProbe").probeSelfHosted(baseUrl));`.
   - In `preload.js`, add `probeSelfHosted: (baseUrl) => ipcRenderer.invoke("probe-self-hosted", baseUrl),`.
   - In `src/types/electron.ts`, add the `probeSelfHosted?` signature from Interfaces.
   - In `browserPreview.ts`, add a stub that resolves `{ ok: false, code: "network" }`.
   - Plan 07's egress inventory test will list this file. Add it to the sealed-mode allowlist when Plan 07 lands, because it is a user-initiated request to the user's own server.

   In `docs/PRIVACY.md`, append to the connection-check row: "Testing a self-hosted server sends an unauthenticated model-list request to the address you entered."

   A whisper.cpp transcription server may not implement `/models`. In that case the call throws and the copy says "Couldn't list models at {{host}}", which is honest without claiming the server is down.

3. **Q22.**
   - In `src/helpers/localASROrganization.ts:10`, change `{ id: "whisper", name: "OpenAI" }` to `{ id: "whisper", name: "Whisper" }`.
   - In `TranscriptionModelPicker.tsx`, directly after the local `<ProviderTabs … />` (`:1309-1314`), add:

     ```tsx
     {internalLocalProvider === "oruk" && (
       <p className="mt-1 text-xs text-muted-foreground">{t("transcription.families.orukHint")}</p>
     )}
     ```

4. **Q23.** Create `src/components/DictionaryHeaderActions.tsx`:

   ```tsx
   import { useTranslation } from "react-i18next";
   import { Download, Upload } from "./icons";
   import { Toggle } from "./ui/toggle";

   export function DictionaryHeaderActions(props: {
     onClearAll: () => void;
     onExport: () => void;
     onImport: () => void;
     autoLearn: boolean;
     onAutoLearnChange: (value: boolean) => void;
   }) {
     const { t } = useTranslation();
     const action = "inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground transition-colors";
     return (
       <div className="flex flex-wrap items-center gap-3">
         <label className="inline-flex items-center gap-2 text-xs text-foreground/60">
           <Toggle checked={props.autoLearn} onChange={props.onAutoLearnChange} aria-label={t("settingsPage.dictionary.autoLearnTitle")} />
           <span aria-hidden="true">{t("settingsPage.dictionary.autoLearnTitle")}</span>
         </label>
         <button type="button" onClick={props.onImport} className={action}>
           <Upload size={12} aria-hidden="true" />
           <span>{t("dictionary.importAction")}</span>
         </button>
         <button type="button" onClick={props.onExport} className={action}>
           <Download size={12} aria-hidden="true" />
           <span>{t("dictionary.exportAction")}</span>
         </button>
         <button type="button" onClick={props.onClearAll} className="text-xs text-foreground/60 hover:text-destructive transition-colors">
           {t("dictionary.clearAll")}
         </button>
       </div>
     );
   }
   ```

   In `DictionaryView.tsx`:
   - Replace the action cluster at `:259-279` (the `<div className="flex items-center gap-3">` with Clear all and Export) with `<DictionaryHeaderActions onClearAll={() => setConfirmClear(true)} onExport={handleExport} onImport={() => setShowBulkImport(true)} autoLearn={autoLearnCorrections} onAutoLearnChange={setAutoLearnCorrections} />`.
   - Get `autoLearnCorrections` and `setAutoLearnCorrections` from `useSettings()`, the same hook `SettingsPage` uses (`useSettings.ts:159-174`).
   - On the in-field Upload icon button (`:190-196`), add `title={t("dictionary.importWords")}`. It already has an `aria-label`.

5. **Q24.** In `TranscriptionSection` (`SettingsPage.tsx:620-635`):
   - Delete the review card `<div className="flex items-center justify-between gap-3 rounded-lg border …">…</div>`.
   - After `{effectiveTranscriptionMode === "local" && renderTranscriptionPicker("local")}` (and any self-hosted block that follows), add:

     ```tsx
     <button
       type="button"
       onClick={startOnboarding}
       className="text-xs text-link underline-offset-2 hover:underline"
     >
       {t("settingsPage.transcription.reviewSetupLink")}
     </button>
     ```

   `text-link` is Plan 01's `--color-link` role. Keep the comment above the old card ("Local decoding still serves meetings…") with the code it describes.

6. Write `/tmp/loqui-i18n-task-14.json` and merge it. The `en` block below overwrites the four `localDesc` values. `testOk` needs every plural category per locale.

   ```json
   {
     "settingsPage": {
       "transcription": {
         "modes": { "localDesc": "Runs on this device. Nothing leaves it." },
         "reviewSetupLink": "Review dictation setup"
       },
       "aiModels": { "modes": { "localDesc": "Runs on this device. Nothing leaves it." } },
       "selfHosted": {
         "test": "Test",
         "testing": "Testing…",
         "testOk_one": "Connected · {{count}} model",
         "testOk_other": "Connected · {{count}} models",
         "testFail": "Couldn't list models at {{host}}. Check the address and that the server is running."
       }
     },
     "agentMode": { "settings": { "modes": { "localDesc": "Runs on this device. Nothing leaves it." } } },
     "dictationAgent": {
       "modes": { "localDesc": "Runs a local model on this device. Nothing leaves it." },
       "screenContext": {
         "goesToDevice": "Captures the display your cursor is on and sends it to {{model}} on this device. Loqui never saves or logs it.",
         "goesToDeviceNoModel": "Captures the display your cursor is on for a model on this device. Loqui never saves or logs it.",
         "goesToServer": "Captures the display your cursor is on and sends it to your own server. Loqui never saves or logs it.",
         "goesToProvider": "Captures the display your cursor is on and sends it to {{provider}}. Loqui never saves or logs it."
       }
     },
     "transcription": {
       "families": { "orukHint": "Oruk is a Parakeet model fine-tuned for multilingual dictation. It runs on this device." }
     },
     "dictionary": { "importAction": "Import", "exportAction": "Export" }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/helpers/selfHostedProbe.test.js test/components/screenContextCopy.test.js test/components/selfHostedPanel.test.js test/components/dictionaryHeaderActions.test.js test/components/settingsCopy.test.js test/components/orukeetOrganization.test.js && npm run typecheck && npm run lint && npm run i18n:check`
Expected: PASS. `orukeetOrganization.test.js` still passes, because it does not assert the Whisper label.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/selfHostedProbe.js src/helpers/providerConnectionTest.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts src/preview/browserPreview.ts docs/PRIVACY.md test/helpers/selfHostedProbe.test.js src/components/settings/screenContextCopy.ts src/components/settings/DictationAgentSettings.tsx src/components/SelfHostedPanel.tsx src/helpers/localASROrganization.ts src/components/TranscriptionModelPicker.tsx src/components/DictionaryHeaderActions.tsx src/components/DictionaryView.tsx src/components/SettingsPage.tsx src/locales test/components/screenContextCopy.test.js test/components/selfHostedPanel.test.js test/components/dictionaryHeaderActions.test.js test/components/settingsCopy.test.js
git commit -m "fix(settings): Name destinations, label inputs and soften privacy claims"
```

---

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
