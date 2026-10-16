const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("./rendererTestHarness");
const { withI18nMock } = require("./i18nTestMock");

const flush = () => new Promise((resolve) => setImmediate(resolve));

const ALLOWED = [
  "credentials.list",
  "getDiarizationModelStatus",
  "getEnterpriseRouteState",
  "getSearchModelStatus",
  "keyring.list",
  "listParakeetModels",
  "listWhisperModels",
  "modelGetAll",
  "privacy.getSealed",
];

// Every preload call the hooks may make answers locally. Everything that can reach
// the network, start Codex or send a credential throws if called, and records it.
function recordingApi() {
  const calls = [];
  const subscriptions = {};
  const ok = (name, value) => async () => {
    calls.push(name);
    return value;
  };
  const forbidden = (name) => () => {
    calls.push(name);
    throw new Error(`${name} must not run while loading route facts`);
  };
  const subscribe = (name) => (cb) => {
    subscriptions[name] = cb;
    return () => {};
  };
  const api = {
    listWhisperModels: ok("listWhisperModels", {
      success: true,
      models: [{ model: "base", downloaded: true }],
    }),
    listParakeetModels: ok("listParakeetModels", { success: true, models: [] }),
    modelGetAll: ok("modelGetAll", []),
    getDiarizationModelStatus: ok("getDiarizationModelStatus", {
      available: true,
      modelsDownloaded: true,
    }),
    getSearchModelStatus: ok("getSearchModelStatus", { downloaded: true }),
    getEnterpriseRouteState: ok("getEnterpriseRouteState", {
      current: {
        bedrockRegion: "us-east-1",
        azureEndpoint: "",
        vertexProject: "",
        vertexLocation: "us-central1",
        vertexAuthSource: "adc",
      },
      version: 0,
      facts: {
        bedrockEndpoint: { set: false, host: null },
        bedrockProfile: false,
        vertexApiKeyEnv: false,
        vertexProjectEnv: false,
      },
    }),
    // R2-1: main's enterprise settings and environment facts are local reads.
    getBedrockRegion: ok("getBedrockRegion", ""),
    getAzureEndpoint: ok("getAzureEndpoint", ""),
    getVertexProject: ok("getVertexProject", ""),
    getVertexLocation: ok("getVertexLocation", ""),
    getVertexAuthSource: ok("getVertexAuthSource", "adc"),
    enterpriseRouteFacts: ok("enterpriseRouteFacts", {
      bedrockEndpoint: { set: false, host: null },
      bedrockProfile: false,
      vertexApiKeyEnv: false,
      vertexProjectEnv: false,
    }),
    // The sync never writes main and never tests a connection.
    saveBedrockRegion: forbidden("saveBedrockRegion"),
    saveAzureEndpoint: forbidden("saveAzureEndpoint"),
    saveVertexProject: forbidden("saveVertexProject"),
    saveVertexLocation: forbidden("saveVertexLocation"),
    saveVertexAuthSource: forbidden("saveVertexAuthSource"),
    testEnterpriseConnection: forbidden("testEnterpriseConnection"),
    credentials: {
      list: ok("credentials.list", [{ id: "openai", present: true, generation: 1 }]),
      onChanged: subscribe("credentials"),
      save: forbidden("credentials.save"),
      remove: forbidden("credentials.remove"),
    },
    keyring: {
      list: ok("keyring.list", []),
      onChanged: subscribe("keyring"),
      verify: forbidden("keyring.verify"),
    },
    personalInference: {
      codexStatus: forbidden("personalInference.codexStatus"),
      codexModels: forbidden("personalInference.codexModels"),
      codexRateLimits: forbidden("personalInference.codexRateLimits"),
      credentialStatus: forbidden("personalInference.credentialStatus"),
      models: forbidden("personalInference.models"),
    },
    listBedrockModels: forbidden("listBedrockModels"),
    getTinfoilChatModels: forbidden("getTinfoilChatModels"),
    privacy: { getSealed: ok("privacy.getSealed", false), onSealedChange: subscribe("sealed") },
  };
  return { api, calls, subscriptions };
}

async function mount(t) {
  const recording = recordingApi();
  const listeners = {};
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: recording.api,
      addEventListener: (type, fn) => (listeners[type] ??= new Set()).add(fn),
      removeEventListener: (type, fn) => listeners[type]?.delete(fn),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-routes-hooks-test-" })
  );
  const routes = await vite.ssrLoadModule("/lib/routes.ts");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  const { PROVIDER_SEARCH_CHANGED_EVENT } = await vite.ssrLoadModule("/utils/providerSearch.ts");
  let list;
  let chat;
  function Probe() {
    list = routes.useResolvedRoutes();
    chat = routes.useResolvedRoute("chat");
    return null;
  }
  root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Probe));
    await flush();
  });
  const act = (fn) =>
    React.act(async () => {
      fn();
      await flush();
    });
  return {
    ...recording,
    routes,
    useSettingsStore,
    useRouteFactsStore,
    PROVIDER_SEARCH_CHANGED_EVENT,
    list: () => list,
    chat: () => chat,
    act,
    fire: (type) => act(() => [...(listeners[type] ?? [])].forEach((fn) => fn(new Event(type)))),
    count: (name) => recording.calls.filter((call) => call === name).length,
  };
}

test("change-driving Task6: mounting the route hooks loads facts from local calls only and never starts Codex", async (t) => {
  // I2: v1 called personalInference.codexStatus() on every mount (personalInference.js:248-251 → codex.status()).
  const h = await mount(t);
  assert.deepEqual(
    h.list().map((route) => route.id),
    [...h.routes.ROUTE_IDS]
  );
  assert.deepEqual([...new Set(h.calls)].sort(), ALLOWED);

  await h.fire("focus");
  await h.fire("openwhispr-models-cleared");
  await h.fire("openwhispr-local-models-changed");
  assert.equal(h.count("listWhisperModels"), 4);
  assert.equal(
    h.count("getEnterpriseRouteState"),
    4,
    "main's environment is re-read with every refresh"
  );
  assert.equal(
    h.count("getAzureEndpoint"),
    0,
    "five separate getter replies cannot grant authority"
  );
  const keyringReads = h.count("keyring.list");
  await h.act(() => h.subscriptions.keyring());
  assert.equal(h.count("keyring.list"), keyringReads + 1);
  await h.act(() => h.subscriptions.credentials({ id: "openai", present: false, generation: 2 }));
  assert.equal(h.useRouteFactsStore.getState().facts.credentials.get("openai"), false);
  assert.deepEqual(
    [...new Set(h.calls)].sort(),
    ALLOWED,
    "no refresh path reaches a forbidden call"
  );
});

test("the hooks re-render from the settings, facts and sealed stores", async (t) => {
  // I3, I14, M5: one hook subscribes to all three sources.
  const h = await mount(t);
  await h.act(() =>
    h.useSettingsStore.setState({
      chatAgentMode: "providers",
      chatAgentProvider: "openai",
      chatAgentModel: "gpt-5.6-sol",
    })
  );
  assert.equal(h.chat().providerId, "openai");
  assert.deepEqual(h.chat().state, { status: "ready" });

  await h.act(() => h.subscriptions.sealed(true));
  assert.deepEqual(h.chat().state, { status: "unreachable", detail: "sealed" });
  await h.act(() => h.subscriptions.sealed(false));

  await h.act(() => h.subscriptions.credentials({ id: "openai", present: false, generation: 2 }));
  assert.equal(h.chat().state.status, "needsKey");
  assert.deepEqual(
    h.list().find((route) => route.id === "chat"),
    h.chat()
  );
});

test("turning provider search on re-renders the chat disclosure", async (t) => {
  // I15: the preference lives in localStorage, outside every store.
  const h = await mount(t);
  await h.act(() =>
    h.useSettingsStore.setState({
      chatAgentMode: "providers",
      chatAgentProvider: "openai",
      chatAgentModel: "gpt-5.6-sol",
    })
  );
  assert.doesNotMatch(h.chat().sends, /routes\.payload\.webSearch/);
  globalThis.localStorage.setItem("personalWebSearch:chatIntelligence", "true");
  await h.fire(h.PROVIDER_SEARCH_CHANGED_EVENT);
  assert.match(h.chat().sends, /routes\.payload\.webSearch/);
});

test("baseline guard: the provider-search toggle announces its change", () => {
  // I15 wiring: the toggle commits through the planner (Task 8); the one writer announces the change (Task 6).
  const editor = fs.readFileSync(
    path.join(__dirname, "../../src/components/settings/InferenceConfigEditor.tsx"),
    "utf8"
  );
  const util = fs.readFileSync(path.join(__dirname, "../../src/utils/providerSearch.ts"), "utf8");
  assert.match(editor, /requestPatch\(SCOPE_ROUTE\[scope\]/);
  assert.doesNotMatch(editor, /useLocalStorage\(`personalWebSearch:/);
  assert.match(util, /window\.dispatchEvent\?\.\(new Event\(PROVIDER_SEARCH_CHANGED_EVENT\)\)/);
});
