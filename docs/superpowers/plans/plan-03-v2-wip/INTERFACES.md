# Plan 03 v2 — shared interfaces (authoritative for every task rewrite)

Repo: /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings (app code at commit 8267276 + Plan 01 merged first; Plan 01 shipped at branch snowopsdev/feat/uiux-foundations 172f9df in worktree /Users/snow/.t3/worktrees/loqui/t3-5038e8e6 — read its src/lib/locality.ts, src/components/ui/LocalityRing.tsx, src/index.css tokens there).
Review being answered: /Users/snow/.t3/worktrees/loqui/t3-5038e8e6/.omc/research/ui-review/reviews/plan-03-codex.md (C1, C2, I1–I15, M1–M5).
Old plan tasks (v1) for reference: /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/old/taskNN.md and /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/old/header.md.

## Non-negotiable rules (from the owner)

1. Authenticated discovery or verification NEVER sends a stored credential without an explicit user action (a button whose label/tooltip names the receiving host and the credential slot). No discovery on mount, tab browsing, blur, typing or URL commit.
2. Every history/audio deletion deletes EXACTLY what its confirmation counts; counts and deletions use the same main-owned predicate.
3. Every committed provider/model/endpoint change goes through the route planner. Changes whose effective result is on-device are instant (with Undo); changes that add a new off-device recipient or new payload are staged behind Apply. No component writes provider/model/endpoint store fields directly (except via `applyRoutePatch` from the planner).
4. Route-fact loading makes NO automatic network calls (no `codexStatus`, no discovery, no verification).
5. Key readiness comes only from main-confirmed persistence (credential presence reported by main after an acknowledged save). The raw secret never lives in renderer state.

## Module map (v2)

| Module | Kind | Owner task |
|---|---|---|
| `src/lib/routeGraph.ts` | PURE, Node-loadable under `node --import tsx` without Vite: erasable TS, explicit `.ts`/`.js` import extensions, imports only `./locality.ts`, `../helpers/transcriptionRoute.ts`, `../utils/urlUtils.ts`. No React, no store, no JSON registry import. | T1 |
| `src/lib/routes.ts` | §5.1 contract module: `export * from "./routeGraph.ts"`, plus `buildRouteSnapshot`, `routeSnapshotFromSettings`, `routeCopy`, hooks. Imports store/facts/sealed stores. | T3 |
| main `src/helpers/credentialAuthority.js` | Main-owned credential presence, acknowledged saves, change events, generations, undo-remove tokens, Codex presence (file stat only). | T2 |
| `src/stores/routeFactsStore.ts` | Renderer facts: per-family model inventories, support models, credential presence, rejected identities. Network-free. Retains last-known values across errors. | T3 |
| `src/stores/sealedStore.ts` | THE single renderer sealed authority (hooks, imperative snapshots, Apply bar, Keyring). Plan 07 replaces its internals. | T3 |
| `src/lib/providerSwitchPlans.ts` | Pure-ish (imports registry JSON) provider-switch patch planners shared by store and planner. | T6 |
| `src/lib/routePlanner.ts` | `planRouteChange` / `planPatch`: one simulated patch used for preview, commit and Undo; lists coupled changes across all 11 routes. | T6 |
| `src/stores/routeDraftStore.ts` | Draft (target or patch), `requestRouteChange`, `applyDraft`, Undo. | T7 |
| main `src/helpers/keyring.js` | Health rows (SQLite), generation-bound Verify, reminders. | T11 |
| main `src/helpers/storageOps.js` | Main-owned storage preview + typed deletions with identical predicates. | T14 |
| main `src/helpers/selfHostedProbe.js` | Unauthenticated model-list probe (no headers). | T9 |

## §5.1 contract — exact v2 shape (Plan 03 owns; CCRs listed in header)

```ts
// src/lib/routeGraph.ts (re-exported unchanged by src/lib/routes.ts)
export type RouteId =
  | "dictationStt" | "noteRecordingStt" | "uploadStt"
  | "dictationCleanup" | "voiceAssistant" | "assistantVision"
  | "translation" | "noteFormatting" | "chat"
  | "speakerId" | "semanticSearch";
export type RouteKind = "speech" | "text" | "support";
export type RouteState =
  | { status: "ready" }
  | { status: "off" }
  | { status: "unknown" }                        // CCR: readiness not confirmed by main yet (loading or check failed). Never treated as ready.
  | { status: "needsModel"; sizeBytes?: number }
  | { status: "needsKey"; provider: string }     // provider "" = choose a provider
  | { status: "needsUrl" }                       // missing/malformed/insecure/hosted/forbidden endpoint
  | { status: "unreachable"; detail?: string };  // detail: "sealed" | "retired" | "unsupported"
export interface ResolvedRoute {
  id: RouteId;
  kind: RouteKind;
  locality: Locality;
  provider: string | null;      // English providerDisplayName — logs only
  providerId: string | null;    // CCR (accepted Plan 04 CCR-5): raw id; null for device/network
  host: string | null;          // CCR: normalized effective endpoint host:port ("api.openai.com", "192.168.1.20:11434"); null when nothing leaves the device or the host is unknown/invalid
  model: string | null;
  state: RouteState;
  sends: string | null;         // translated plain-language payload; null when device or off
  settingsPath: string;
}
export function resolveRoutes(snapshot: RouteSettingsSnapshot): ResolvedRoute[];
export function resolveRoute(snapshot: RouteSettingsSnapshot, id: RouteId): ResolvedRoute;
// src/lib/routes.ts adds:
export function useResolvedRoutes(): ResolvedRoute[];
export function useResolvedRoute(id: RouteId): ResolvedRoute;
export function routeSnapshotFromSettings(settings: SettingsState): RouteSettingsSnapshot; // CCR (Plan 07): non-React, reads current facts + sealed store + i18n
export function buildRouteSnapshot(settings: SettingsState, facts: RouteFacts, copy: RouteCopy, sealed: boolean): RouteSettingsSnapshot;
```

Also exported from routeGraph.ts (additive): `ROUTE_IDS`, `ROUTE_KIND`, `ROUTE_SETTINGS_PATH`, `SCOPE_ROUTE`, `STT_CONTEXT_ROUTE`, `SUPPORT_MODEL_NAMES`, `localSttModelKey`, `isSealedLocality` (locality !== "device"), types below.

### Snapshot (Plan 03's choice; all inputs pure data)

```ts
export type SttContext = "dictation" | "meeting" | "upload";
export type LlmRouteScope = "dictationCleanup" | "dictationAgent" | "dictationAgentVision" | "dictationTranslation" | "noteFormatting" | "chatIntelligence";
export type CredentialId =
  | "openai" | "anthropic" | "gemini" | "groq" | "xai" | "mistral" | "openrouter" | "tinfoil"
  | "deepgram" | "assemblyai" | "corti:text" | "corti:speech" | "codex" | "bedrock" | "azure" | "vertex";
export interface SttRouteInput { mode: string; localProvider: string; localModel: string; cloudProvider: string; cloudModel: string; cloudBaseUrl: string; remoteUrl: string; remoteModel: string; }
export interface LlmRouteInput { mode: string; provider: string; model: string; remoteUrl: string; cloudBaseUrl: string; providerSearch: boolean; }
export interface ModelInfo { name: string; sizeBytes?: number }
export interface RouteFacts {                       // produced by routeFactsStore (T3)
  installed: { whisper: ReadonlySet<string> | null; sherpa: ReadonlySet<string> | null; llm: ReadonlySet<string> | null }; // per family; null = unknown
  credentials: ReadonlyMap<CredentialId, boolean> | null;   // main-confirmed presence; null = not loaded yet
  rejected: ReadonlySet<CredentialId>;                       // last verification rejected (keyring health)
  speakerIdModelsReady: boolean | null;
  searchModelReady: boolean | null;
}
export interface RouteCapabilities {                // static data passed in by the builder so routeGraph stays JSON-free
  meetingProviders: readonly string[];              // MEETING_STREAMING_PROVIDER_IDS
  transcriptionProviderBaseUrls: readonly { id: string; baseUrl: string }[]; // for transcriptionRoute Tinfoil detection
  providerHosts: Readonly<Record<string, string>>;  // provider id → API host (registry baseUrl host; anthropic/gemini/openrouter/codex known hosts)
}
export type PayloadPart = /* see Payload section */ string;
export interface RouteCopy { parts: Readonly<Record<PayloadPart, string>>; list: (items: string[]) => string } // translated; list = Intl.ListFormat conjunction
export interface RouteSettingsSnapshot {
  stt: Record<SttContext, SttRouteInput>;
  llm: Record<LlmRouteScope, LlmRouteInput>;
  enabled: { cleanup: boolean; voiceAssistant: boolean; screenContext: boolean; visionOverride: boolean; translation: boolean; speakerId: boolean };
  dictionaryInUse: boolean;                          // the user has dictionary words/snippets that join prompts
  facts: RouteFacts;
  models: Readonly<Record<string, ModelInfo>>;
  capabilities: RouteCapabilities;
  sealed: boolean;                                   // required (Plan 07 must not redeclare optional)
  copy: RouteCopy;
}
```

### Resolver rules (T1)

- Credential identity per route: speech Corti → `corti:speech`; text Corti → `corti:text`; others → provider id; enterprise → its id; codex → `codex`. `custom` needs no credential.
- Readiness: credential presence `facts.credentials` null → `{status:"unknown"}`; present false or rejected → needsKey (provider display name; "" when no provider chosen).
- Local model: family set null → `unknown` when a model is set (unset model still → needsModel); not in set → needsModel(sizeBytes).
- Support routes: ready flag null → unknown; false → needsModel.
- STT non-local: run `resolveTranscriptionRoute` (from `../helpers/transcriptionRoute.ts`) with the route's settings and `hasProviderKey`; map: UNSUPPORTED_TRANSCRIPTION_MODE + mode "openwhispr" → unreachable "retired"; UNSUPPORTED_TRANSCRIPTION_MODE other → unreachable "unsupported"; UNSUPPORTED_TRANSCRIPTION_PROVIDER → needsKey "" if no provider else unreachable "unsupported"; CUSTOM_ENDPOINT_INVALID / self-hosted URL invalid or not configured / TINFOIL_PROXY_REQUIRED → needsUrl; API_KEY_MISSING → needsKey; STREAMING_ONLY_PROVIDER → ready for dictationStt (live streaming path) but unreachable "unsupported" for uploadStt. noteRecordingStt: self-hosted → unreachable "unsupported"; provider not in capabilities.meetingProviders → unreachable "unsupported".
- LLM custom/self-hosted URL valid iff `isSecureHttpEndpoint(url)` (urlUtils.ts; https, or http only to private hosts) and host not `openwhispr.(com|app)`; else needsUrl. Validation happens BEFORE the loopback→device decision; an invalid URL is never "device".
- Loopback custom endpoint (`providers` mode, provider custom, valid URL, isLoopbackUrl) → locality device, providerId null, host null, sends null (decision kept from v1).
- openwhispr mode → remote, providerId = configured provider || "openwhispr", state unreachable "retired".
- Text routes off-device without a model → needsModel (no size).
- Sealed: `isSealedLocality(locality)` (non-device) and not off → unreachable "sealed".
- `host`: providers → `capabilities.providerHosts[providerId] ?? null`; custom/self-hosted → `new URL(url).host` of the effective URL; device or invalid → null.

### Payload parts (I15) — T1 defines `PayloadPart` and per-route conditional composition; T3 supplies translations. See /Users/snow/.t3/worktrees/loqui/snowopsdev-plan-uiux-03-routes-settings/docs/superpowers/plans/plan-03-v2-wip/PAYLOADS.md (written after research) for the exact list and evidence.

## Credential authority (T2, main)

```js
// src/helpers/credentialAuthority.js
createCredentialAuthority({ env /* environmentManager */, getCredential, codexHome, fs, broadcast, now }) → {
  list(): Array<{ id: CredentialId; present: boolean; generation: number }>;   // no network; codex = fs.stat(<codexHome>/auth.json) isFile && size > 2
  save(id, field, value): Promise<{ ok: true; generation: number } | { ok: false; error: string }>; // field: "key" | "clientId" | "clientSecret" | enterprise fields
  remove(id): Promise<{ ok: true; undoToken: string; expiresAt: number; generation } | { ok: false; error }>; // removed value kept ONLY in main memory for 8s
  undoRemove(token): Promise<{ ok: true; generation } | { ok: false; reason: "expired" | "replaced" | "unknown" }>;
  generation(id): number;      // bumped on save/remove/undo/reset
  reset(): void;               // invalidates all tokens, bumps all generations (called by cleanup-app)
}
```
IPC (preload `window.electronAPI.credentials`): `list()`, `save(id, field, value)`, `remove(id)`, `undoRemove(token)`, `onChanged(cb) → unsubscribe`. Main broadcasts `credentials-changed` `{ id, present, generation }` after every successful save/remove/undo. Existing per-provider `save*Key` IPC channels are rewired to the authority and now return `{ success: boolean; error?: string }` (ack). No IPC result ever contains secret material.

Renderer (T2): `settingsStore` secret setters become ack-based: `saveSecret(storeKey, value): Promise<{ ok: boolean; error?: string }>` — raw value never put into zustand; on ack the store field becomes `"__stored__"` (present) or `""` (removed); `flushSecretSaves(): Promise<void>` awaits all pending saves (Apply and Verify call it). `credentials-changed` events update the matching store sentinel in every window. `ApiKeyInput` clears its draft after a successful save and shows the save error otherwise; with prop `credentialId` its Remove uses `credentials.remove` and shows inline "Removed · Undo" for 8 s.

## Facts store (T3) — network-free

`loadRouteFacts(api)` calls, each independently (publish as each resolves; per-key generation so an older response never overwrites a newer one; on failure KEEP the previous value, null only if never loaded): `listWhisperModels`, `listParakeetModels`, `modelGetAll`, `getDiarizationModelStatus`, `getSearchModelStatus`, `credentials.list`, `keyring.list` (health → `rejected`). NEVER `codexStatus` or any discovery. Refresh triggers: focus, `openwhispr-models-cleared`, `openwhispr-local-models-changed`, `credentials.onChanged`, `keyring.onChanged` (T11 adds).

## Sealed store (T3)

```ts
// src/stores/sealedStore.ts
export const useSealedStore: UseBoundStore<StoreApi<{ sealed: boolean; known: boolean }>>;
export function getSealed(): boolean;                 // imperative snapshot (currentRouteSnapshot, Apply, Keyring)
export function ensureSealedSubscribed(): void;       // subscribes privacy?.onSealedChange (each event bumps a version) and fetches privacy?.getSealed() once; the fetch result is applied only if no event arrived after the fetch started
```
Every Plan 03 reader of sealed state uses this module and nothing else. CCR to Plan 07: implement `useSealedMode()`/attestation on top of this store (replace its internals), keeping `getSealed`/`useSealedStore` as the shared API.

## Planner (T6) and drafts (T7)

```ts
// src/lib/providerSwitchPlans.ts  (store's switchCloudTranscriptionProvider / switchReasoningProvider are refactored to call these, then applyRoutePatch)
export type SettingsPatch = Partial<Pick<SettingsState, NonSecretKeys>>; // never secret fields
export function planTranscriptionProviderSwitch(state: SettingsState, context: SttContext, providerId: string): SettingsPatch; // includes transcriptionModelByProvider memory update
export function planReasoningProviderSwitch(state: SettingsState, scope: LlmRouteScope, providerId: string, fallbackModel: string): SettingsPatch; // includes reasoningModelByProvider memory update
// settingsStore.ts
applyRoutePatch(patch: SettingsPatch): void;   // ONE setState; persists strings/booleans to localStorage under the field name and memory objects via persistTranscriptionModelMemory/persistReasoningModelMemory; throws on any secret key

// src/lib/routePlanner.ts
export type RouteTarget =
  | { mode: "local"; provider?: string; model?: string }
  | { mode: "providers"; provider: string; model?: string; baseUrl?: string }   // enterprise providers map to mode "enterprise" inside the planner
  | { mode: "self-hosted"; remoteUrl: string; model?: string };
export interface RouteChange { id: RouteId; before: ResolvedRoute; after: ResolvedRoute; coupled: boolean } // coupled = not the requested route
export type ApplyBlocker = "needsKey" | "chooseProvider" | "needsUrl" | "needsModel" | "sealed" | "unknown" | "unsupported";
export interface RoutePlan {
  routeId: RouteId;
  patch: SettingsPatch;          // exact raw store writes; preview is computed by resolving the patched state, so preview == commit by construction
  undoPatch: SettingsPatch;      // prior raw values of every key in patch (inheritance blanks and vision flags included)
  changes: RouteChange[];        // every route among the 11 whose locality/providerId/host/model/sends/state changed
  kind: "noop" | "instant" | "staged";
  blocker: ApplyBlocker | null;
}
export function planRouteChange(state: SettingsState, ctx: PlanContext, id: RouteId, target: RouteTarget): RoutePlan;
export function planPatch(state: SettingsState, ctx: PlanContext, routeId: RouteId, patch: SettingsPatch): RoutePlan; // used for Undo and patch drafts
export interface PlanContext { facts: RouteFacts; copy: RouteCopy; sealed: boolean }
```
kind rules: noop when patch is empty; instant when every changed route is either device after, or keeps the same providerId+host and its `sends` did not grow (same recipient, same payload — e.g. model change at the same provider); otherwise staged. Blocker: computed over every non-off changed route whose after-locality is off-device: sealed → "sealed"; unknown → "unknown"; needsKey with provider "" → "chooseProvider"; needsKey → "needsKey" unless provider in SETUP_AFTER_APPLY (codex, bedrock, azure, vertex); needsUrl; unreachable unsupported → "unsupported"; needsModel with sizeBytes (local download) → "needsModel"; needsModel without size on an off-device text route → allowed (model chosen after switching).
Writer semantics mirrored inside the planner simulation (single source): dictation mode flags (`transcriptionMode`, `useLocalWhisper`, `cloudTranscriptionMode:"byok"`), meeting/upload equivalents; provider switch via providerSwitchPlans; explicit `target.model` overrides memory; upload never writes the shared dictation URL (self-hosted upload uses dictation's URL read-only); cloud→self-hosted clears a foreign model unless `target.model` given; LLM mode change clears provider/model invalid for the new mode (isProviderValidForMode, src/models/ModelRegistry.ts:272); vision target sets `useDictationAgentVisionModel=true` and vision scope provider/model/cloudBaseUrl only (never touches `voiceAgentScreenContext`, never writes vision mode).

```ts
// src/stores/routeDraftStore.ts
export type RouteDraft = { routeId: RouteId; kind: "target"; target: RouteTarget } | { routeId: RouteId; kind: "patch"; patch: SettingsPatch };
export const useRouteDraftStore: …{ draft: RouteDraft | null; stage(d): void; discard(): void };
export function currentPlanContext(copy: RouteCopy): PlanContext;   // facts store + getSealed()
export interface RouteChangeOutcome { applied: boolean; blocker: ApplyBlocker | null; plan: RoutePlan; undo?: () => RouteChangeOutcome | "staged" }
export async function requestRouteChange(id: RouteId, target: RouteTarget, copy: RouteCopy): Promise<RouteChangeOutcome | "staged">; // awaits flushSecretSaves(); noop → discard same-route draft; instant → commit; staged → stage
export async function applyDraft(copy: RouteCopy): Promise<RouteChangeOutcome | null>;   // awaits flushSecretSaves(); re-plans from LIVE state at click time; refuses on blocker (draft kept)
// Undo: planPatch(live, undoPatch): instant → apply; else stage a patch draft (never applies a remote move without review)
export function withDraftDiscard(onOpenChange: (open: boolean) => void): (open: boolean) => void;
```

## Storage ops (T14, main)

`storage-preview` → `{ audio: { files, bytes, directory } | { error }, history: { total, discarded, softDeleted, withAudio } | { error }, models handled in renderer lists }`; `storage-delete-audio` / `storage-delete-history` → `{ ok: boolean; deleted: number; remaining: number | null; errors: string[] }` where the count predicate and the delete predicate are the SAME functions (audio = every `.webm` in audioDir; history = every row in `transcriptions` plus every `.webm` — i.e. history deletion also deletes all audio and the confirmation says so and counts both). Unreadable counts are errors, never zero.

## Tokens (CCR to Plan 01 tokens, implemented by T5)

Light `--color-ring` `#ff5a1f` → `#E84E16` (spec's light nav marker): ≥ 3.33:1 on every light surface. Plum Night ring unchanged. Settings never puts `text-destructive` on #f5f5f5 surfaces and destructive outline buttons use `hover:bg-background`; keyring amber dots use `bg-locality-remote` (≥ 4.4:1) not `bg-warning`; support-model "Downloaded" uses `text-locality-device`, never `text-success`.

## Test conventions (all tasks)

- Renderer tests mocking react-i18next use `withI18nMock` (test/lib/i18nTestMock.js, created in T3) — never a bare mockModules entry.
- Mounted behaviour tests use the repo's harness pattern (test/components/personalWorkspace.test.js:18-41): `installBrowserGlobals` + `installHookDom` + `createRoot`, call the component as a function inside a probe that returns null, then invoke handler props under `React.act`. installHookDom has no createElement, so never commit host elements in a mounted test.
- Label each test as change-driving (fails before the change) or baseline guard (passes already; regression check).
- Node-pure modules (`routeGraph.ts`, `storageMath.ts`, `cartridgeMath.ts`, `rovingNav.ts`, main helpers) are tested by direct `import()`/`require`, not Vite.
