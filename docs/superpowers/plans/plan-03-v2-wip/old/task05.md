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

