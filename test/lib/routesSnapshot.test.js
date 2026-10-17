const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals, createRendererServer } = require("./rendererTestHarness");

const flush = () => new Promise((resolve) => setImmediate(resolve));
const FACTS = Object.freeze({
  installed: { whisper: new Set(["base"]), sherpa: new Set(), llm: new Set(["qwen3.5-2b-q4_k_m"]) },
  credentials: new Map([
    ["openai", true],
    ["groq", true],
  ]),
  credentialFields: new Map([
    ["openai", { key: true }],
    ["groq", { key: true }],
  ]),
  // Synced from main, no environment override (R2-1).
  enterpriseMain: {
    bedrockEndpoint: { set: false, host: null },
    bedrockProfile: false,
    vertexApiKeyEnv: false,
    vertexProjectEnv: false,
  },
  rejected: new Set(),
  speakerIdModelsReady: true,
  searchModelReady: true,
});

async function load(t, windowProps = {}, initialStorage = {}) {
  const { storage } = installBrowserGlobals(t, { window: windowProps, initialStorage });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-routes-snapshot-test-" });
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  // Payload copy that names its key, so assertions can read which parts were listed.
  const copy = routes.routeCopy((key) => key.replace("routes.payload.", "P:"), "en");
  return { vite, routes, storage, copy, base: useSettingsStore.getState() };
}

test("[change-driving] routes.ts re-exports the pure graph unchanged", async (t) => {
  // M5: one module identity for the graph whether imported via routes.ts or routeGraph.ts.
  const { vite, routes } = await load(t);
  const graph = await vite.ssrLoadModule("/lib/routeGraph.ts");
  for (const name of [
    "resolveRoutes",
    "resolveRoute",
    "ROUTE_IDS",
    "ROUTE_KIND",
    "ROUTE_SETTINGS_PATH",
    "localSttModelKey",
    "isSealedLocality",
  ]) {
    assert.equal(routes[name], graph[name], name);
  }
});

test("[change-driving] buildRouteSnapshot reads the real store shape, registry capabilities and model sizes", async (t) => {
  const { routes, copy, base } = await load(t);
  const state = {
    ...base,
    transcriptionMode: "providers",
    useLocalWhisper: false,
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
    cloudTranscriptionProvider: "openai",
    cloudTranscriptionModel: "gpt-4o-mini-transcribe",
    cloudTranscriptionBaseUrl: "",
    remoteTranscriptionUrl: "http://192.168.1.20:8080",
    remoteTranscriptionModel: "whisper-1",
    meetingCloudTranscriptionProvider: "",
    cleanupMode: "local",
    cleanupProvider: "qwen",
    cleanupModel: "qwen3.5-2b-q4_k_m",
    dictationAgentMode: "providers",
    dictationAgentProvider: "anthropic",
    dictationAgentModel: "claude-sonnet-5",
    dictationAgentVisionProvider: "",
    dictationAgentVisionModel: "",
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "gpt-5.6-sol",
    chatAgentCloudBaseUrl: "",
    chatAgentRemoteUrl: "",
    useCleanupModel: false,
    useDictationAgent: true,
    voiceAgentScreenContext: true,
    useDictationAgentVisionModel: false,
    useDictationTranslation: true,
    speakerDiarizationEnabled: false,
  };
  const s = routes.buildRouteSnapshot(state, FACTS, copy, true);
  assert.deepEqual(s.stt.dictation, {
    mode: "providers",
    localProvider: "whisper",
    localModel: "base",
    cloudProvider: "openai",
    cloudModel: "gpt-4o-mini-transcribe",
    cloudBaseUrl: "",
    remoteUrl: "http://192.168.1.20:8080",
    remoteModel: "whisper-1",
  });
  assert.equal(
    s.stt.meeting.cloudProvider,
    "openai",
    "an empty meeting provider falls back to dictation"
  );
  assert.equal(
    s.stt.upload.remoteUrl,
    "http://192.168.1.20:8080",
    "upload reads the dictation server URL"
  );
  assert.deepEqual(s.llm.chatIntelligence, {
    mode: "providers",
    provider: "openai",
    model: "gpt-5.6-sol",
    remoteUrl: "",
    cloudBaseUrl: "",
    providerSearch: false,
  });
  assert.equal(s.llm.dictationAgentVision.provider, "anthropic", "vision inherits the assistant");
  assert.deepEqual(s.enabled, {
    cleanup: false,
    voiceAssistant: true,
    screenContext: true,
    visionOverride: false,
    translation: true,
    speakerId: false,
  });
  assert.equal(s.facts, FACTS);
  assert.equal(s.copy, copy);
  assert.equal(s.sealed, true);
  assert.deepEqual(
    [...s.capabilities.meetingProviders],
    ["openai", "assemblyai", "deepgram", "corti", "tinfoil"]
  );
  assert.equal(
    s.capabilities.transcriptionProviderBaseUrls.find((p) => p.id === "tinfoil").baseUrl,
    "https://inference.tinfoil.sh/v1"
  );
  assert.equal(s.capabilities.providerHosts.openai, "api.openai.com");
  assert.equal(s.capabilities.providerHosts.anthropic, "api.anthropic.com");
  assert.equal(s.capabilities.providerHosts.deepgram, "api.deepgram.com");
  assert.equal(s.capabilities.providerHosts.codex, "chatgpt.com");
  assert.ok(s.models[routes.localSttModelKey("whisper", "base")].sizeBytes > 0);
  assert.ok(s.models["llm:qwen3.5-2b-q4_k_m"].sizeBytes > 0);
  assert.equal(typeof s.models["cloud:openai:gpt-4o-mini-transcribe"].name, "string");
});

test("change-driving Task6: the Corti host follows the selected region", async (t) => {
  // I7 (I1 follow-up): Corti speech connects to api.<region>.corti.app
  // (src/helpers/cortiTranscription.js:39, src/helpers/cortiStreaming.js:48);
  // the registry baseUrl names only the US host. Change-driving: v1 had no region input.
  const { routes, copy, base } = await load(t);
  const host = (cortiEnvironment) =>
    routes.buildRouteSnapshot({ ...base, cortiEnvironment }, FACTS, copy, false).capabilities
      .providerHosts.corti;
  assert.equal(host("us"), "api.us.corti.app");
  assert.equal(host("eu"), "api.eu.corti.app");
  assert.equal(
    host(""),
    "api.us.corti.app",
    "an empty region means US, like transcriptionRoute.ts:305"
  );
  assert.equal(host("eu/../evil"), "", "invalid environments have no executor-valid host");
  const corti = {
    ...base,
    transcriptionMode: "providers",
    useLocalWhisper: false,
    cloudTranscriptionProvider: "corti",
    cloudTranscriptionModel: "corti-transcribe",
    cortiEnvironment: "eu",
  };
  const facts = { ...FACTS, credentials: new Map([["corti:speech", true]]) };
  assert.equal(
    routes.resolveRoute(routes.buildRouteSnapshot(corti, facts, copy, false), "dictationStt").host,
    "api.eu.corti.app"
  );
});

test("[change-driving] Corti text routes disclose the API-key host, whatever the region", async (t) => {
  // I7 (I1 follow-up): personal inference always sends Corti text
  // to https://ai.eu.corti.app/v1 (src/helpers/personalInference.js:78,
  // src/config/constants.ts:123). The builder supplies it as
  // providerHosts["corti:text"], and the speech host stays region-bound.
  // Change-driving: the key did not exist, so a Corti chat route showed the
  // speech host and a region switch looked like a new recipient for text.
  const { routes, copy, base } = await load(t);
  const chatOnCorti = (cortiEnvironment) => ({
    ...base,
    cortiEnvironment,
    chatAgentMode: "providers",
    chatAgentProvider: "corti",
    chatAgentModel: "corti-chat",
  });
  const facts = { ...FACTS, credentials: new Map([["corti:text", true]]) };
  for (const region of ["us", "eu"]) {
    const s = routes.buildRouteSnapshot(chatOnCorti(region), facts, copy, false);
    assert.equal(s.capabilities.providerHosts["corti:text"], "ai.eu.corti.app", region);
    assert.equal(s.capabilities.providerHosts.corti, `api.${region}.corti.app`, region);
    assert.equal(routes.resolveRoute(s, "chat").host, "ai.eu.corti.app", region);
  }
});

test("[change-driving] the enterprise slice is the store's raw enterprise settings, and their hosts follow edits", async (t) => {
  // R2-1, change-driving: v1 had no enterprise input, so every Bedrock, Azure
  // and Vertex route had host null and Azure was ready with a key and no endpoint.
  const { routes, copy, base } = await load(t);
  assert.deepEqual(
    routes.buildRouteSnapshot(base, FACTS, copy, false).enterprise,
    {
      bedrockRegion: "us-east-1",
      azureEndpoint: "",
      vertexProject: "",
      vertexLocation: "us-central1",
      vertexAuthSource: "adc",
    },
    "the store defaults (settingsStore.ts:1442-1453)"
  );
  const azureChat = (azureEndpoint) => ({
    ...base,
    azureEndpoint,
    chatAgentMode: "enterprise",
    chatAgentProvider: "azure",
    chatAgentModel: "gpt-4o-deploy",
  });
  const facts = {
    ...FACTS,
    credentials: new Map([["azure", true]]),
    credentialFields: new Map([["azure", { key: true }]]),
  };
  const chat = (state) =>
    routes.resolveRoute(routes.buildRouteSnapshot(state, facts, copy, false), "chat");
  const missing = chat(azureChat(""));
  assert.deepEqual(
    missing.state,
    { status: "needsUrl" },
    "a saved key without an endpoint is not ready"
  );
  assert.equal(missing.host, null);
  const first = chat(azureChat("https://myres.openai.azure.com/openai"));
  assert.equal(first.host, "myres.openai.azure.com");
  assert.deepEqual(first.state, { status: "ready" });
  assert.equal(chat(azureChat("https://other.example.com/openai")).host, "other.example.com");
  assert.equal(
    routes.buildRouteSnapshot(azureChat("  https://x.example.com "), facts, copy, false).enterprise
      .azureEndpoint,
    "  https://x.example.com ",
    "raw, untrimmed: the executor receives the same string"
  );
  const bedrock = {
    ...base,
    bedrockRegion: "eu-west-1",
    chatAgentMode: "enterprise",
    chatAgentProvider: "bedrock",
    chatAgentModel: "eu.anthropic.claude-fable-5",
  };
  const bedrockFacts = {
    ...FACTS,
    credentials: new Map([["bedrock", true]]),
    credentialFields: new Map([["bedrock", { accessKeyId: true, secretAccessKey: true }]]),
  };
  assert.equal(
    routes.resolveRoute(routes.buildRouteSnapshot(bedrock, bedrockFacts, copy, false), "chat").host,
    "bedrock-runtime.eu-west-1.amazonaws.com"
  );
  const vertex = {
    ...base,
    vertexProject: "acme-prod",
    vertexLocation: "europe-west4",
    chatAgentMode: "enterprise",
    chatAgentProvider: "vertex",
    chatAgentModel: "gemini-2.5-flash",
  };
  const vertexFacts = () => ({
    ...FACTS,
    credentials: new Map([["vertex", true]]),
    credentialFields: new Map([["vertex", { key: true }]]),
  });
  const vertexHost = (authSource, keyPresent) =>
    routes.resolveRoute(
      routes.buildRouteSnapshot(
        { ...vertex, vertexAuthSource: authSource },
        { ...vertexFacts(), credentialFields: new Map([["vertex", { key: keyPresent }]]) },
        copy,
        false
      ),
      "chat"
    ).host;
  assert.equal(
    vertexHost("adc", false),
    "europe-west4-aiplatform.googleapis.com",
    "ADC project and location"
  );
  assert.equal(
    vertexHost("adc", true),
    "europe-west4-aiplatform.googleapis.com",
    "stored API key does not switch the source"
  );
  assert.equal(
    vertexHost("apiKey", false),
    "aiplatform.googleapis.com",
    "persisted apiKey source selects express mode"
  );
  const s = routes.buildRouteSnapshot(base, FACTS, copy, false);
  assert.equal(s.enterprise.vertexAuthSource, "adc");
  assert.equal(
    Object.keys(s.enterprise).some((key) => /secret|token|profile|apiKey$/i.test(key)),
    false,
    "no secret or credential-value field"
  );
});

test("change-driving Task6: main wins: until main's enterprise settings are synced the route is unknown, then the snapshot shows main's host", async (t) => {
  // R2-1, change-driving: localStorage and main differ. v2 disclosed the stale
  // localStorage host while the executor used main's (main.js:447-457).
  const { vite, routes } = await load(
    t,
    {},
    { azureEndpoint: "https://stale.example.com/openai", vertexAuthSource: "apiKey" }
  );
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore, loadRouteFacts } = await vite.ssrLoadModule(
    "/stores/routeFactsStore.ts"
  );
  useSettingsStore.setState({
    chatAgentMode: "enterprise",
    chatAgentProvider: "azure",
    chatAgentModel: "gpt-4o-deploy",
  });
  assert.equal(useSettingsStore.getState().azureEndpoint, "https://stale.example.com/openai");
  useRouteFactsStore.setState({
    facts: { ...FACTS, credentials: new Map([["azure", true]]), enterpriseMain: null },
  });
  const chat = () =>
    routes.resolveRoute(routes.routeSnapshotFromSettings(useSettingsStore.getState()), "chat");
  assert.deepEqual(chat().state, { status: "unknown" }, "sync pending: never ready");
  assert.equal(chat().host, null, "never the stale host");
  await loadRouteFacts(
    {
      getEnterpriseRouteState: async () => ({
        current: {
          bedrockRegion: "",
          azureEndpoint: "https://main.example.com/openai",
          vertexProject: "",
          vertexLocation: "",
          vertexAuthSource: "adc",
        },
        version: 1,
        facts: FACTS.enterpriseMain,
      }),
    },
    ["enterprise"]
  );
  assert.equal(useSettingsStore.getState().azureEndpoint, "https://main.example.com/openai");
  assert.equal(chat().host, "main.example.com", "the snapshot shows main's host");
  assert.deepEqual(chat().state, { status: "ready" });
});

test("change-driving Task6: a Bedrock endpoint override in main's environment is the disclosed host", async (t) => {
  // R2-1: AWS_ENDPOINT_URL_BEDROCK_RUNTIME/AWS_ENDPOINT_URL beat the region in the SDK.
  const { vite, routes } = await load(t);
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore, loadRouteFacts } = await vite.ssrLoadModule(
    "/stores/routeFactsStore.ts"
  );
  useSettingsStore.setState({
    chatAgentMode: "enterprise",
    chatAgentProvider: "bedrock",
    chatAgentModel: "us.anthropic.claude-fable-5",
  });
  useRouteFactsStore.setState({
    facts: { ...FACTS, credentials: new Map([["bedrock", true]]), enterpriseMain: null },
  });
  await loadRouteFacts(
    {
      getEnterpriseRouteState: async () => ({
        current: {
          bedrockRegion: "us-east-1",
          azureEndpoint: "",
          vertexProject: "",
          vertexLocation: "",
          vertexAuthSource: "adc",
        },
        version: 1,
        facts: {
          bedrockEndpoint: { set: true, host: "bedrock-proxy.corp.example:8443" },
          bedrockProfile: true,
          vertexApiKeyEnv: false,
          vertexProjectEnv: false,
        },
      }),
    },
    ["enterprise"]
  );
  const chat = routes.resolveRoute(
    routes.routeSnapshotFromSettings(useSettingsStore.getState()),
    "chat"
  );
  assert.equal(chat.host, "bedrock-proxy.corp.example:8443");
  assert.deepEqual(chat.state, { status: "ready" });
});

test("[change-driving] key readiness comes from main-confirmed presence, never the renderer's key fields", async (t) => {
  // I3: a "__stored__" sentinel or an empty field in the settings store has no say.
  const { routes, copy, base } = await load(t);
  const dictation = (fields, credentials) =>
    routes.resolveRoute(
      routes.buildRouteSnapshot(
        {
          ...base,
          transcriptionMode: "providers",
          useLocalWhisper: false,
          cloudTranscriptionProvider: "openai",
          cloudTranscriptionModel: "gpt-4o-mini-transcribe",
          ...fields,
        },
        { ...FACTS, credentials },
        copy,
        false
      ),
      "dictationStt"
    ).state;
  assert.deepEqual(dictation({ openaiApiKey: "__stored__" }, null), { status: "unknown" });
  assert.equal(
    dictation({ openaiApiKey: "__stored__" }, new Map([["openai", false]])).status,
    "needsKey"
  );
  assert.deepEqual(dictation({ openaiApiKey: "" }, new Map([["openai", true]])), {
    status: "ready",
  });
  const s = routes.buildRouteSnapshot(base, FACTS, copy, false);
  assert.equal(
    Object.keys(s).some((key) => /key/i.test(key)),
    false
  );
});

test("[change-driving] an empty LLM inventory proves a missing model while a failed Whisper inventory stays unknown", async (t) => {
  // I9 end to end: the v1 builder turned this case into "ready".
  const { routes, copy, base } = await load(t);
  const state = {
    ...base,
    transcriptionMode: "local",
    useLocalWhisper: true,
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
    useCleanupModel: true,
    cleanupMode: "local",
    cleanupProvider: "qwen",
    cleanupModel: "qwen3.5-2b-q4_k_m",
    speakerDiarizationEnabled: true,
  };
  const facts = {
    ...FACTS,
    installed: { whisper: null, sherpa: new Set(), llm: new Set() },
    speakerIdModelsReady: null,
    searchModelReady: null,
  };
  const s = routes.buildRouteSnapshot(state, facts, copy, false);
  assert.deepEqual(routes.resolveRoute(s, "dictationStt").state, { status: "unknown" });
  const cleanup = routes.resolveRoute(s, "dictationCleanup").state;
  assert.equal(cleanup.status, "needsModel");
  assert.ok(cleanup.sizeBytes > 0);
  assert.deepEqual(routes.resolveRoute(s, "speakerId").state, { status: "unknown" });
  assert.deepEqual(routes.resolveRoute(s, "semanticSearch").state, { status: "unknown" });
});

test("[change-driving] Appendix B agreement 2: dictionaryInUse is getDictionaryHintWords, so a snippet trigger alone counts", async (t) => {
  // I15.
  const { routes, copy, base } = await load(t);
  const snapshot = (fields) =>
    routes.buildRouteSnapshot({ ...base, ...fields }, FACTS, copy, false);
  assert.equal(snapshot({ customDictionary: [], snippets: [] }).dictionaryInUse, false);
  assert.equal(snapshot({ customDictionary: ["Loqui"], snippets: [] }).dictionaryInUse, true);
  const onlySnippet = {
    customDictionary: [],
    snippets: [{ trigger: "sig", replacement: "Best, Ada" }],
  };
  assert.equal(snapshot(onlySnippet).dictionaryInUse, true);
  const remote = {
    ...onlySnippet,
    transcriptionMode: "providers",
    useLocalWhisper: false,
    cloudTranscriptionProvider: "openai",
    cloudTranscriptionModel: "gpt-4o-mini-transcribe",
  };
  assert.match(
    routes.resolveRoute(snapshot(remote), "dictationStt").sends,
    /P:dictionary(?!Words)/
  );
  const noDictionary = { ...remote, snippets: [] };
  assert.doesNotMatch(
    routes.resolveRoute(snapshot(noDictionary), "dictationStt").sends,
    /P:dictionary/
  );
});

test("[change-driving] Appendix B agreement 3: provider search is disclosed exactly when the request path would use it", async (t) => {
  // I15: isProviderSearchEnabled reads localStorage personalWebSearch:<scope>.
  const { routes, copy, base, storage } = await load(t);
  const chat = (provider, model) => ({
    ...base,
    chatAgentMode: "providers",
    chatAgentProvider: provider,
    chatAgentModel: model,
  });
  const sends = (state) =>
    routes.resolveRoute(routes.buildRouteSnapshot(state, FACTS, copy, false), "chat").sends;
  storage.setItem("personalWebSearch:chatIntelligence", "true");
  assert.equal(
    routes.buildRouteSnapshot(chat("openai", "gpt-5.6-sol"), FACTS, copy, false).llm
      .chatIntelligence.providerSearch,
    true
  );
  assert.match(sends(chat("openai", "gpt-5.6-sol")), /P:webSearch/);
  assert.doesNotMatch(sends(chat("groq", "openai/gpt-oss-120b")), /P:webSearch/);
  storage.setItem("personalWebSearch:chatIntelligence", "false");
  assert.doesNotMatch(sends(chat("openai", "gpt-5.6-sol")), /P:webSearch/);
});

test("[change-driving] routeCopy translates every payload part and joins lists with Intl.ListFormat", async (t) => {
  const { routes } = await load(t);
  const copy = routes.routeCopy((key) => `T:${key}`, "en");
  assert.equal(Object.keys(copy.parts).length, 16);
  assert.equal(copy.parts.screenshot, "T:routes.payload.screenshot");
  assert.equal(copy.list(["a", "b", "c"]), "a, b, and c");
  assert.equal(copy.list([]), "");
  assert.equal(routes.routeCopy((key) => key, "de").list(["a", "b", "c"]), "a, b und c");
  assert.equal(routes.routeCopy((key) => key, "not a locale!").list(["a", "b"]), "a and b");
});

test("[change-driving] routeSnapshotFromSettings reads the facts store, the sealed store and the app's i18n", async (t) => {
  const { vite, routes, base } = await load(t);
  const { useRouteFactsStore } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const { useSealedStore } = await vite.ssrLoadModule("/stores/sealedStore.ts");
  useRouteFactsStore.setState({ facts: FACTS });
  useSealedStore.setState({ sealed: true, known: true });
  const s = routes.routeSnapshotFromSettings(base);
  assert.equal(s.facts, FACTS);
  assert.equal(s.sealed, true);
  assert.equal(s.copy.parts.audio, "your audio");
  assert.equal(s.copy.parts.webSearch, "permission for the provider to search the web");
  assert.equal(s.copy.list(["a", "b"]), "a and b");
});

test("[change-driving] routeSnapshotFromSettings makes no IPC and no subscription; an unknown seal maps to false (§5.1, §5.4)", async (t) => {
  // §5.1: "current facts + sealedStore + i18n; no subscriptions, no IPC".
  const touched = [];
  const electronAPI = new Proxy({}, { get: (_, key) => (touched.push(String(key)), undefined) });
  const { vite, routes, base } = await load(t, { electronAPI });
  const { useSealedStore } = await vite.ssrLoadModule("/stores/sealedStore.ts");
  touched.length = 0;
  const s = routes.routeSnapshotFromSettings({
    ...base,
    azureEndpoint: "https://myres.openai.azure.com/openai",
  });
  assert.deepEqual(touched, [], "no preload call");
  assert.equal(
    s.enterprise.azureEndpoint,
    "https://myres.openai.azure.com/openai",
    "R2-1: the enterprise slice is read from settings, not main"
  );
  assert.equal(s.sealed, false, "§5.4: known: false maps to sealed = false in route snapshots");
  // ensureSealedSubscribed() with no privacy API would set known: true at once, so this proves it never ran.
  assert.deepEqual(useSealedStore.getState(), { sealed: false, known: false });
});

test("[change-driving] a seal change during an outstanding facts load reaches every reader and survives the load", async (t) => {
  // I14: the v1 facts refresh carried `sealed` and could overwrite a newer seal event.
  let emitSealed;
  let releaseWhisper;
  const whisper = new Promise((resolve) => (releaseWhisper = resolve));
  const { vite, routes, base } = await load(t, {
    electronAPI: {
      listWhisperModels: () => whisper,
      privacy: {
        getSealed: async () => false,
        onSealedChange: (cb) => {
          emitSealed = cb;
          return () => {};
        },
      },
    },
  });
  const facts = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const sealedStore = await vite.ssrLoadModule("/stores/sealedStore.ts");
  sealedStore.ensureSealedSubscribed();
  facts.ensureRouteFactsSubscribed();
  await flush();
  const state = {
    ...base,
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "gpt-5.6-sol",
  };

  emitSealed(true);
  assert.equal(sealedStore.getSealed(), true);
  assert.equal(routes.routeSnapshotFromSettings(state).sealed, true);
  assert.deepEqual(routes.resolveRoute(routes.routeSnapshotFromSettings(state), "chat").state, {
    status: "unreachable",
    detail: "sealed",
  });

  releaseWhisper({ success: true, models: [{ model: "base", downloaded: true }] });
  await flush();
  assert.deepEqual([...facts.useRouteFactsStore.getState().facts.installed.whisper], ["base"]);
  assert.equal(
    routes.routeSnapshotFromSettings(state).sealed,
    true,
    "the facts load does not touch the seal"
  );
});

// change-driving B4: main fingerprints bind generation AND actual target/path.
// The builder never derives a fingerprint and reprojects every supplied state.
test("change-driving Task6: rejected route health binds canonical options for live and prospective snapshots", async (t) => {
  const { routes, copy, base } = await load(t);
  const state = {
    ...base,
    transcriptionMode: "providers",
    cloudTranscriptionProvider: "corti",
    cloudTranscriptionModel: "corti-transcribe",
    cortiEnvironment: "eu",
    cortiTenant: "tenantA",
  };
  const binding = {
    identity: "corti:speech",
    generation: 7,
    configFingerprint: "main-issued-target-path-A",
  };
  const facts = {
    ...FACTS,
    credentials: new Map([["corti:speech", true]]),
    credentialFields: new Map([["corti:speech", { clientId: true, clientSecret: true }]]),
    credentialGenerations: new Map([["corti:speech", 7]]),
    credentialHealth: {
      options: { cortiEnvironment: "eu", cortiTenant: "tenantA" },
      current: [binding],
      health: [{ ...binding, status: "rejected" }],
    },
  };
  const resolve = (settings, f = facts) =>
    routes.resolveRoute(routes.buildRouteSnapshot(settings, f, copy, false), "dictationStt");
  assert.equal(resolve(state).state.status, "needsKey");
  assert.equal(
    resolve({ ...state, cortiTenant: " tenantA " }).state.status,
    "needsKey",
    "published tenant trim preserves binding"
  );
  const preview = resolve({ ...state, cortiTenant: "tenantB" });
  assert.equal(preview.host, resolve(state).host, "same-host tenant change");
  assert.equal(preview.state.status, "ready", "A rejection does not poison prospective B");
  assert.equal(
    resolve(state, { ...facts, credentialGenerations: new Map([["corti:speech", 8]]) }).state
      .status,
    "ready",
    "replacement revokes previous health"
  );
  const changedConfig = {
    ...facts,
    credentialHealth: {
      ...facts.credentialHealth,
      current: [{ ...binding, configFingerprint: "main-issued-new-target" }],
    },
  };
  assert.equal(
    resolve(state, changedConfig).state.status,
    "ready",
    "main canonical target match is required"
  );
  assert.equal(
    resolve({ ...state, cortiEnvironment: "EU" }).state.status,
    "unreachable",
    "invalid verify options cannot match health and invalid executor targets stay unsupported"
  );
  assert.equal(
    resolve(state, { ...facts, credentialHealth: undefined, rejected: new Set(["corti:speech"]) })
      .state.status,
    "ready",
    "bare historical ids do not grant authority"
  );
  assert.equal(
    resolve(state, { ...facts, credentialGenerations: undefined }).state.status,
    "ready",
    "missing generation metadata is unverified"
  );
  const insufficient = {
    ...facts,
    credentialHealth: {
      ...facts.credentialHealth,
      current: [{ ...binding, configFingerprint: "" }],
      health: [{ ...binding, configFingerprint: "", status: "rejected" }],
    },
  };
  assert.equal(
    resolve(state, insufficient).state.status,
    "ready",
    "empty fingerprint is insufficient authority"
  );
  assert.equal(
    resolve(state, { ...facts, credentialUnknown: new Set(["corti:speech"]) }).state.status,
    "unknown"
  );
});

// change-driving: metadata never invents a different local model family.
test("invalid persisted local providers and Vertex sources remain unsupported", async (t) => {
  const { routes, copy, base } = await load(t, {}, { vertexAuthSource: "retired-source" });
  const snapshot = routes.buildRouteSnapshot(
    {
      ...base,
      transcriptionMode: "local",
      localTranscriptionProvider: "removed-provider",
      whisperModel: "base",
      parakeetModel: "parakeet-unified-en-0.6b",
    },
    FACTS,
    copy,
    false
  );
  assert.equal(snapshot.stt.dictation.localProvider, "removed-provider");
  assert.equal(snapshot.stt.dictation.localModel, "");
  assert.equal(
    Object.keys(snapshot.models).some((key) => key === "null"),
    false
  );
  assert.deepEqual(routes.resolveRoute(snapshot, "dictationStt").state, {
    status: "unreachable",
    detail: "unsupported",
  });
  const vertex = routes.buildRouteSnapshot(
    {
      ...base,
      chatAgentMode: "enterprise",
      chatAgentProvider: "vertex",
      chatAgentModel: "gemini-2.5-flash",
    },
    FACTS,
    copy,
    false
  );
  assert.equal(vertex.enterprise.vertexAuthSource, "retired-source");
  assert.deepEqual(routes.resolveRoute(vertex, "chat").state, {
    status: "unreachable",
    detail: "unsupported",
  });
});

// change-driving B4: unrelated Corti options do not invalidate fixed BYOK health.
test("fixed-provider rejection survives unrelated options; default Corti options normalize exactly", async (t) => {
  const { routes, copy, base } = await load(t);
  const openai = { identity: "openai", generation: 2, configFingerprint: "main-openai" };
  const corti = { identity: "corti:speech", generation: 4, configFingerprint: "main-us-base" };
  const facts = {
    ...FACTS,
    credentials: new Map([
      ["openai", true],
      ["corti:speech", true],
    ]),
    credentialGenerations: new Map([
      ["openai", 2],
      ["corti:speech", 4],
    ]),
    credentialHealth: {
      options: { cortiEnvironment: "us", cortiTenant: "base" },
      current: [openai, corti],
      health: [
        { ...openai, status: "rejected" },
        { ...corti, status: "rejected" },
      ],
    },
  };
  const state = {
    ...base,
    chatAgentMode: "providers",
    chatAgentProvider: "openai",
    chatAgentModel: "fixture-model",
    transcriptionMode: "providers",
    cloudTranscriptionProvider: "corti",
    cloudTranscriptionModel: "corti-transcribe",
    cortiEnvironment: "",
    cortiTenant: "  ",
  };
  const snapshot = routes.buildRouteSnapshot(state, facts, copy, false);
  assert.equal(
    routes.resolveRoute(snapshot, "dictationStt").state.status,
    "needsKey",
    "empty/default-equivalent options match main normalized capture"
  );
  const preview = routes.buildRouteSnapshot(
    { ...state, cortiEnvironment: "eu", cortiTenant: "tenantB" },
    facts,
    copy,
    false
  );
  assert.equal(routes.resolveRoute(preview, "dictationStt").state.status, "ready");
  assert.equal(
    routes.resolveRoute(preview, "chat").state.status,
    "needsKey",
    "global BYOK health remains matched"
  );
  const { normalizeRouteVerificationOptions: normalize } =
    await import("../../src/helpers/routeVerificationOptions.mjs");
  assert.deepEqual(normalize({ cortiEnvironment: "", cortiTenant: " x_- " }), {
    cortiEnvironment: "us",
    cortiTenant: "x_-",
  });
  for (const options of [
    { cortiEnvironment: "EU" },
    { cortiEnvironment: " eu " },
    { cortiTenant: "bad tenant" },
    { cortiTenant: "x/path" },
  ])
    assert.equal(normalize(options), null);
});
