# Loqui UI/UX Plan 03 — Routes & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2.** This revision answers the independent Codex review (`.omc/research/ui-review/reviews/plan-03-codex.md`, verdict "needs rework": 2 Critical, 15 Important, 5 Minor). See "Review response" below.

**Goal:** Give Loqui one routing model and rebuild Settings on top of it:
- the route graph (contract §5.1), which answers "which task runs where, and is it usable?" for all 11 routes, using the same validation the executors use;
- a Patchbay switchboard that shows every route at once (SET-R1 B);
- one route planner, so preview, commit and Undo describe the same configuration. On-device moves are instant; any new off-device recipient or payload is staged behind Apply (SET-R3 B);
- cartridge model cards with real radio semantics (SET-R4 B);
- a main-owned credential authority and keyring with generation-bound verification health (SET-R5 C);
- a storage list whose counts and deletions come from the same main-owned predicates (SET-R7 A);
- settings search with live controls (SET-R2 A);
- 13 Settings quick wins.

**Architecture:**
- **Route graph.** `src/lib/routeGraph.ts` is a pure, Node-loadable resolver. `src/lib/routes.ts` re-exports it and adds the snapshot builder, `routeSnapshotFromSettings` and the React hooks.
- **Readiness facts.**
  - Facts come from `src/stores/routeFactsStore.ts` through network-free preload calls: model inventories, support models, main-confirmed credential presence and key health. No Codex start, discovery or verification ever happens there.
  - Unknown facts resolve to `unknown`, never `ready`.
  - Sealed state has one renderer authority, `src/stores/sealedStore.ts`.
- **Route changes.** Every provider, model, mode and endpoint change in Settings goes through `src/lib/routePlanner.ts`. It simulates the write on a copy of the settings, resolves all 11 routes before and after, and returns one patch and its Undo patch. `src/stores/routeDraftStore.ts` applies the patch when every change stays on the device or keeps the same recipient and payload; otherwise it stages the change behind the Apply bar, which lists every affected route.
- **Credentials.** `src/helpers/credentialAuthority.js` in main owns credential presence, acknowledged saves, change events, generations and undoable removal. The renderer never holds a secret, and readiness is only what main has confirmed. Authenticated model discovery and key verification happen only on an explicit button that names the receiving host.
- **Storage.** `src/helpers/storageOps.js` in main counts and deletes with the same predicates, and returns typed outcomes.

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

**Depends on (hard preflight in Task 18 Step 0; run it before Task 1):**
- **Plan 01 (Foundations), merged.** This plan uses:
  - `src/lib/locality.ts`: `Locality`, `resolveLocality`, `providerDisplayName` (logs only), `providerDisplayLabel(id, t)` (every provider name in UI) and `isLoopbackUrl`;
  - `LocalityRing`;
  - the `--color-locality-*` and `--motion-*` tokens;
  - the `Button` variants.

  Plan 01 is on `snowopsdev/feat/uiux-foundations`. It reached `172f9df` at the first review, and its later fixes (including `f7d53e4`, the light focus ring) are assumed merged.
- **Plan 02 (Bug & a11y sweep), merged.** Its SET-Q1/Q2/Q20 accessibility work (provider tabs, nav semantics) is a precondition, not something this plan re-implements. Tasks that touch the same files keep Plan 02's semantics and replace only the markup this plan redesigns.

---

## Review response

Every Critical and Important finding is closed. One finding is narrowed with evidence (I1, model-only changes). Nothing is rejected outright.

| Finding | Status | How |
|---|---|---|
| **C1** Authenticated discovery without explicit action | Closed | Task 9. `OpenAICompatiblePanel` loses mount, blur and auto-adopt discovery. URL edits are a local draft committed through the planner. The only path to `personalInference.models` is a "List models" button that names the receiving host and the credential slot it sends (or "no key"). The self-hosted Test uses a new unauthenticated probe that sends no headers. Mounted tests assert zero discovery calls on mount, tab browsing, typing and blur, and exactly one on the button. |
| **C2** Counted history deletion deletes more | Closed | Task 14. `storageOps.js` in main owns preview and deletion with identical predicates. History deletion counts every transcript row (completed, discarded, soft-deleted) and every audio file, because the existing clear deletes all audio, and the confirmation names both. Tests use mixed rows and unlinked audio, and assert deleted == previewed. |
| **I1** Remote switching outside staged flow | Closed (narrowed) | Tasks 7–9. All four mode selectors, both pickers' commit paths, the custom base-URL field (no more automatic provider recognition), every self-hosted URL field, the editors' enable switches (cleanup, assistant, translation, screen context, vision model), the provider web-search toggle and the Corti region all go through the planner (`requestRouteChange` / `requestRoutePatch`). Turning a switch off is instant; turning one on stages when the route would send off the device. The policy-reconcile write is removed; invalid selections are preserved and shown as non-ready. On-device effective results (including loopback endpoints) are instant. New off-device recipients are staged. **Narrowing:** a model-only change at the same provider and host, with no growth in payload, applies instantly with a named toast and Undo. Evidence: spec §4 and SET-R3 B constrain moving work toward remote and silent provider switches, and such a change adds no recipient and no payload. It still runs through the planner, so the effective-recipient check is applied, not assumed. |
| **I2** Route facts start Codex network activity | Closed | Tasks 2–3. Codex presence is `fs.stat` of `<userData>/codex/auth.json` in main (no read, no process, no network). The facts loader never calls `codexStatus`, discovery or verification. A test fails if any of those are invoked. Facts publish independently. |
| **I3** Key readiness is optimistic renderer state | Closed | Task 2. Secret setters are acknowledged saves: the raw value never enters zustand, and the store holds only the `"__stored__"`/`""` sentinel set after main's ack. Main broadcasts `credentials-changed` after persistence. `flushSecretSaves()` is awaited by Apply and Verify. `ApiKeyInput` clears its draft after a save and shows a failed save. Readiness reads only main's `credentials.list`. |
| **I4** Undo-remove missing | Closed | Tasks 2 and 12. `credentials.remove` returns an opaque token, and the removed value lives only in main memory for 8 s. `undoRemove` is bound to the credential generation and expiry, and reset invalidates it. Tests confirm no IPC result contains secret material. |
| **I5** Preview, commit and Undo differ | Closed | Task 6. One simulated patch (with provider memory, explicit-model override, upload model, mode-validity clearing and vision flags) drives preview, commit and the exact raw Undo patch. The store's own provider-switch actions use the same extracted planners. |
| **I6** One-route draft changes other routes | Closed | Tasks 6 and 8. The planner resolves all 11 routes before and after. The Apply bar lists every changed route, marking coupled ones (meeting or upload inheriting dictation, vision following the assistant) with destination, host and payload. Undo restores inheritance blanks. |
| **I7** Patchbay destination identity | Closed | Tasks 1 and 10. Additive `ResolvedRoute.host`. Destinations use `route.providerId`, with one network destination per effective host. Tests cover a stale vision override, two LAN hosts and an inactive loopback URL. |
| **I8** Ready not constrained by executors | Closed | Task 1. Speech readiness runs the real `resolveTranscriptionRoute`. Meeting uses the streaming-provider table and rejects self-hosted. LLM endpoints use `isSecureHttpEndpoint` plus hosted-host rejection before any loopback decision. Unsupported configurations are `unreachable/unsupported`, not silently rewritten. |
| **I9** Failed inventory yields Ready | Closed | Tasks 1 and 3. Per-family facts are retained across errors, and the new additive `RouteState` `{ status: "unknown" }` replaces optimistic ready (contract change request). |
| **I10** Corti identities | Closed | Tasks 1, 2, 8 and 11. `corti:text` (API key) and `corti:speech` (client id and secret) are separate identities for presence, health and rejection. The staged panel shows the speech credential fields. |
| **I11** Stale verification overwrites replacement | Closed | Task 11. Verify captures the credential generation and records only if it is unchanged. Concurrent Verify per identity is coalesced. Deferred-promise tests cover replacement, removal, out-of-order verifications and interrupted Verify all. |
| **I12** Storage/reset failures reported as success | Closed | Task 14. Main returns typed `{ ok, deleted, remaining, errors }`. Unreadable counts are errors, never zero. The dialog keeps the reviewed snapshot. Reset checks `success`, keeps errors visible and resets the credential authority. |
| **I13** Light-theme contrast | Closed | Tasks 4, 5, 12, 14 and 18. The light `--color-ring` `#E84E16` (≥ 3.33:1 on every light surface) has already shipped in Plan 01 (`f7d53e4`); Task 5 verifies it. `text-success` is removed. Destructive outline buttons hover on `bg-background`. Amber dots use `bg-locality-remote`. Both themes are measured with opacity compositing over the real Settings surfaces, and the guards cover every changed Settings component, including inherited Button hover. |
| **I14** Two sealed authorities | Closed | Task 3. `sealedStore.ts` is the only renderer reader for hooks, imperative snapshots, the Apply bar and the keyring. The fetch result cannot override a newer event. Contract request to Plan 07: implement `useSealedMode` on top of it. |
| **I15** Payload descriptions incomplete | Closed | Tasks 1 and 3. A conservative per-route payload-parts table built from request-builder evidence (selected text, history, notes and calendar look-ups, dictionary and snippet triggers, Corti meeting key terms, attendees, screenshot, web search), composed from the same snapshot inputs the request paths use. Agreement tests run against `resolveMeetingTranscriptionOptions`, `getDictionaryHintWords` and `isProviderSearchEnabled`, plus labelled source guards. |
| **M1** Plan 02 dependency | Closed | Task 18 Step 0 hard preflight. Real keyboard tests for the cartridge grid and mode selector. |
| **M2** Tiers and context dropped | Closed | Task 13. The `ReasoningModelSelector` mapping forwards them, with a test. |
| **M3** Physical spacing, literal durations | Closed | Tasks 10, 13, 15 and 16. Logical properties and `--motion-*` only. The search flash uses `--motion-flash` with `animationend` cleanup. |
| **M4** Manual partial-delete check | Closed | Task 14 test with a main fake. The `tail -f` step is removed. |
| **M5** Consumer test loading, red/green labels | Closed | Node-loadable `routeGraph.ts` (contract request to Plan 07). Each test is labelled change-driving or baseline guard. Mounted behaviour tests are added for the critical transitions. The §5.1 spec update is a tracked step in Task 18. |

## Contract change requests

**§5.1, route graph (owned here). Exact v2 shape** (`src/lib/routes.ts` re-exports everything from `src/lib/routeGraph.ts`):

```ts
export type RouteState =
  | { status: "ready" }
  | { status: "off" }
  | { status: "unknown" }                        // NEW: readiness not yet confirmed by main (loading, or the check failed). Never treated as ready.
  | { status: "needsModel"; sizeBytes?: number }
  | { status: "needsKey"; provider: string }     // provider "" = choose a provider
  | { status: "needsUrl" }                       // missing, malformed, insecure, hosted or forbidden endpoint
  | { status: "unreachable"; detail?: string };  // detail vocabulary: "sealed" | "retired" | "unsupported"

export interface ResolvedRoute {
  id: RouteId;
  kind: RouteKind;
  locality: Locality;
  provider: string | null;      // English providerDisplayName, logs only
  providerId: string | null;    // NEW (accepts Plan 04 CCR-5 / Plan 06 CR-06-5): raw id; null for device and network
  host: string | null;          // NEW: normalized effective endpoint host[:port]; null when nothing leaves the device or the endpoint is invalid
  model: string | null;
  state: RouteState;
  sends: string | null;         // translated payload list; null when device or off
  settingsPath: string;
}

// Unchanged: resolveRoutes, resolveRoute, useResolvedRoutes, useResolvedRoute.
// NEW (Plan 07 CCR-2): non-React snapshot for the dictation pre-flight.
export function routeSnapshotFromSettings(settings: SettingsState): RouteSettingsSnapshot;
```

Consumer impact:
- Plans 04, 05 and 06 must render `unknown` as a neutral "Checking…" state, and never as ready. Plan 05's Ready step waits for `ready`.
- `sends` is now a composed list. Consumers that only display it are unaffected.

**Clarifications to record in §5.1:**
1. **Empty provider.** `needsKey` with provider `""` means "choose a provider".
2. **Unknown is not ready.** Unknown facts produce `unknown`, never `ready`. This reverses v1. An unset model is still `needsModel`.
3. **`sends` when nothing leaves.** `sends` is null when the route is on the device or off.
4. **Off routes.** An off route keeps the destination it would use.
5. **Support routes.** `speakerId` and `semanticSearch` are always on the device.
6. **Assistant screenshots.** With screen context on and no override, the assistant's `sends` names the screenshot.
7. **Sealed mode.** Sealed applies to every non-device route.
8. **Text routes need a model.** An off-device text route without a model is `needsModel` with no size.
9. **Retired mode.** `openwhispr` mode is remote, with a provider id and `unreachable/retired`.
10. **Loopback custom endpoints.** A valid loopback custom endpoint is `device`. An invalid URL is never `device`, and that includes plain-HTTP `*.localhost`: main and the executor refuse it, which reverses revision 1.
11. **`settingsPath` grammar.** It is `"<section>[/<subTab>]"`.
12. **Ready matches the executors.** Readiness reflects the same validation the executors apply.

**Module note (M5).** `src/lib/routeGraph.ts` is Node-loadable under `node --import tsx` without Vite: erasable TypeScript, explicit import extensions, no React or store imports. Plan 07's direct Node test (its `test/lib/routesSealed.test.js`) should import the pure functions from `routeGraph.ts`, or load `routes.ts` through the renderer harness. `test/lib/routeFixtures.js` exports `makeSnapshot` and `makeRoute` for consumers.

**§5.4, sealed mode (owned by Plan 07). Requests:**
- Implement `useSealedMode()` and the attestation as the internals of `src/stores/sealedStore.ts`, which this plan creates as the single renderer authority. Keep `useSealedStore`/`getSealed` as the shared API, so the hooks, imperative snapshots, Apply bar and keyring cannot disagree.
- Keep `RouteSettingsSnapshot.sealed` a required `boolean`, and do not redeclare it as optional.
- This plan accepts CCR-1: sealed covers `network`.

**Plan 01 tokens.** No request remains. The light `--color-ring` `#E84E16` already shipped in Plan 01 (`f7d53e4`). Task 5 verifies it and adds both-theme composited contrast tests.

## Plan 01 review items (folded in, unchanged from revision 1)

| # | Item | Where |
|---|---|---|
| 1 | `providerDisplayLabel(providerId, t)` names every provider in UI | Contract above. Task 18 guard. |
| 2 | `openwhispr` routes carry a provider id | Clarification 9, Task 1. |
| 3 | Loopback custom endpoints decided | Clarification 10, Task 1. |
| 4 | Plum Night coverage of Settings surfaces | Task 5. Both themes, with compositing. |

## Open questions for the owner

Each question has a default, and the plan implements that default unless the owner says otherwise.

1. **Codex and enterprise setup.** Codex, Bedrock, Azure and Vertex sign in inside the provider editor, which appears only after a switch. Their staged Apply is allowed before credentials exist, with the copy "Sign in to X next. Nothing is sent until you do." Default: allow it.
2. **History deletion also deletes all audio.** That is today's behaviour (`db-clear-transcriptions`), and the confirmation now says so and counts it. Should history deletion keep audio instead? Default: keep today's behaviour, disclosed.
3. **Transcript export.** There is no export IPC today. Default: ship without it.
4. **Curated model tiers.** The pips are size-derived estimates until `speedTier` and `qualityTier` are curated. Should they be curated before release?
5. **Main-process provider names.** Native reminder notifications use a small `PROVIDER_NAMES` map in main that mirrors `locality.ts`. Default: accept it.
6. **Incidental finding, out of scope.** `src/helpers/audioManager.js:3254` and `:3593` reference `usesKeywords`/`dictionary`, which are declared only inside `processWithOpenAIAPI` (`:2924-2925`). This is a possible ReferenceError on streaming dictation, not verified by running. Track it separately?

## Global Constraints

- **Owner rules for this revision:**
  1. Authenticated discovery or verification never sends a stored credential without an explicit user action whose label names the host and the credential slot.
  2. Every history or audio deletion deletes exactly what its confirmation counts.
  3. Provider, model and endpoint changes never bypass the planner. New off-device recipients or payloads are staged.
  4. Route-fact loading makes no automatic network calls.
  5. Key readiness comes only from persistence that main has confirmed.
- Electron main owns SQLite, credentials, native runtimes, provider requests and updates. Renderers talk only through typed preload IPC (CLAUDE.md). No IPC result in this plan contains secret material, and the renderer never stores a raw secret.
- Local and remote choices stay explicit. Nothing silently switches provider or moves work off the device. Content is preserved on every failure. No provider or model change happens as a side effect. Invalid persisted selections are preserved and shown as non-ready.
- Unknown providers resolve to `remote` (fail toward disclosure). Use Plan 01's `resolveLocality`/`isLoopbackUrl`, and do not re-implement them.
- Text contrast is at least 4.5:1 and non-text UI at least 3:1, in light and Plum Night, measured on the real composited surfaces. Locality is always shape or glyph plus words.
- Motion uses the shared `--motion-*` tokens only, with no literal durations. Every loop is gated to its active state. Reduced motion keeps opacity and colour feedback and drops transforms.
- Orange means live voice (D1). In Settings, the default `Button` (the ink capsule) is the primary action. Orange appears only as the focus ring, the selected-card border and the active-nav marker.
- Every visible string goes through i18n in all 11 locales (`ar de en es fr it ja pt ru zh-CN zh-TW`), with the CLDR plural categories `npm run i18n:check` enforces. Provider and model names are not translated, and payload descriptions are.
- Use logical properties for RTL. Arrow-key navigation in grids flips Left and Right in RTL.
- **Tests:**
  - Use `node:test` through `npm test`. Run `npm run native:node` once, and `npm run native:electron` before launching the app. Never use personal profiles.
  - Load pure modules directly. Load store-importing renderer modules through `createRendererServer`. Mock `react-i18next` only through `withI18nMock` (`test/lib/i18nTestMock.js`, Task 3).
  - Mounted behaviour tests use the repo's probe pattern (`test/components/personalWorkspace.test.js:18-41`): call the component inside a probe that returns null, and invoke handler props under `React.act`.
  - Each test is labelled **change-driving** or **baseline guard**.
- `src/tsconfig.json` is not strict: narrow unions with explicit comparisons (`x.ok === false`).
- Before every commit, run `npx prettier --write` on the touched files and `npm run lint`. Before the PR, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run i18n:check` and `npm run format:check`.
- `DESIGN.md` is the source of truth (D10). It is updated in Task 18.
- Node: `~/.nvm/versions/node/v24.21.0/bin`.

**i18n workflow used by every task.** Task 3 adds `scripts/merge-locale-keys.js`. For each task:
1. Write `/tmp/loqui-i18n-task-N.json` shaped `{ "en": {…}, "ar": {…}, …, "zh-TW": {…} }`, using the task's `en` block verbatim and real translations for the others.
2. Run `node scripts/merge-locale-keys.js /tmp/loqui-i18n-task-N.json && npm run i18n:check`.

## Review Focus

1. **A stored key reaching a host the user did not choose.** Opening a provider tab, typing or blurring an endpoint, or browsing OpenRouter must make zero authenticated requests. Only "List models" and "Verify" send a key, and only to the host they name. Pinned in Task 9 (mounted zero-call tests) and Task 11 (Verify).
2. **A confirmation that undercounts.** History with discarded and soft-deleted rows plus unlinked audio must delete exactly the counted totals, and a failed recount is an error, not success. Pinned in Task 14.
3. **A remote move without Apply.** Picker commits, endpoint fields, Undo of a local move and inherited (coupled) routes must all stage. Only on-device or same-recipient, same-payload results apply instantly. Pinned in Tasks 6, 7 and 9.
4. **Cold start, IPC failure or a key save in flight.** Routes must read "Checking…", not Ready. Apply and Verify must wait for pending saves. Pinned in Tasks 1, 2 and 3.
5. **A key replaced while Verify is running.** The old verdict must not land on the new key. Pinned in Task 11.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/routeGraph.ts` (new) | Pure §5.1 resolver, types, payload parts | 1 |
| `test/lib/routeFixtures.js` (new) | `makeSnapshot`, `makeRoute` | 1 |
| `src/helpers/credentialAuthority.js` (new) | Presence, acknowledged saves, events, generations, undoable removal, Codex presence | 2 |
| `src/lib/routes.ts` (new) | §5.1 module: re-exports, snapshot builder, `routeSnapshotFromSettings`, hooks | 3 |
| `src/stores/routeFactsStore.ts`, `src/stores/sealedStore.ts` (new) | Network-free facts; the single sealed authority | 3 |
| `scripts/merge-locale-keys.js`, `test/lib/i18nTestMock.js` (new) | i18n merge; react-i18next test mock | 3 |
| `src/lib/settingsPaths.ts` (new) | `parseSettingsPath`, aliases | 4 |
| `src/components/settings/routing/RouteChips.tsx`, `src/components/ui/rovingNav.ts` (new) | State and destination chips; roving focus | 5 |
| `src/lib/providerSwitchPlans.ts`, `src/lib/routePlanner.ts` (new) | Shared provider-switch patches; the planner | 6 |
| `src/stores/routeDraftStore.ts` (new) | Drafts, request, apply, Undo | 7 |
| `src/components/settings/routing/{providerCatalog.ts,useRouteChange.ts,StagedRouteBar.tsx,StagedRoutePanel.tsx}` (new) | Staging UI | 8 |
| `src/helpers/selfHostedProbe.js` (new); `OpenAICompatiblePanel.tsx`, `TranscriptionModelPicker.tsx`, `ReasoningModelSelector.tsx`, `SelfHostedPanel.tsx` (modified) | Explicit discovery; pickers through the planner | 9 |
| `src/components/settings/routing/{destinations.ts,Patchbay.tsx,RoutingSection.tsx}` (new) | Routing page | 10 |
| `src/helpers/keyring.js` (new) | Health, generation-bound Verify, reminders | 11 |
| `src/components/settings/routing/KeyringPanel.tsx` (new); `ApiKeyInput.tsx` (modified) | Keyring UI; undoable removal | 12 |
| `src/components/ui/{ModelCartridgeGrid.tsx,cartridgeMath.ts}` (new) | Cartridges | 13 |
| `src/helpers/storageOps.js`, `src/components/settings/{StorageList.tsx,storageMath.ts}` (new) | Storage with identical predicates | 14 |
| `src/components/ui/{SettingsNav.tsx,SettingsTitleBar.tsx}` (new) | Nav, title, close | 15 |
| `src/components/settings/{settingsRegistry.ts,SettingsSearchResults.tsx,SettingsSearchField.tsx}` (new) | Search | 16 |
| `src/components/settings/screenContextCopy.ts`, `src/components/DictionaryHeaderActions.tsx` (new) | Quick wins | 17 |
| `DESIGN.md`, `docs/PRIVACY.md` | Documentation | 11, 18 |

---
