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

