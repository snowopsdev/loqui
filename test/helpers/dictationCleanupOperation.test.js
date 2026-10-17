const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { installHookDom } = require("../lib/rendererTestHarness");
const { EventEmitter } = require("node:events");
const { loadAudioManager, realSettingsStoreSource } = require("./harness/audioManager");
const { registerPersonalInferenceIPC } = require("../../src/helpers/personalInference");
const { buildEnterpriseRecipientFacts } = require("../../src/helpers/enterpriseRecipientIdentity");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function fixture(t) {
  const config = {
    azureEndpoint: "https://original.example/openai",
    azureApiVersion: "2024-10-21",
  };
  const handlers = new Map(),
    events = [],
    sdkCalls = [],
    requests = [],
    copies = [];
  let mainConfig = config,
    shouldFail = true;
  const codex = new EventEmitter();
  codex.stop = () => {};
  const sender = new EventEmitter();
  Object.assign(sender, { id: 1, isDestroyed: () => false, send: () => {} });
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    if (name === "@ai-sdk/azure" && parent.filename.endsWith("enterpriseAiProviders.js"))
      return {
        createAzure: (options) => (model) => {
          sdkCalls.push({ options, model });
          return {
            specificationVersion: "v3",
            provider: "fixture",
            modelId: model,
            supportedUrls: {},
            async doGenerate() {
              if (shouldFail) throw new Error("synthetic unavailable");
              return {
                content: [{ type: "text", text: "Original cleaned words." }],
                finishReason: { unified: "stop", raw: "stop" },
                usage: { inputTokens: {}, outputTokens: {} },
                warnings: [],
              };
            },
          };
        },
      };
    return originalLoad.call(this, name, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
  });
  const service = registerPersonalInferenceIPC({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler() {} },
    codex,
    userDataPath: "/fixture-unused",
    getCredential: async () => "synthetic-only",
    saveCredential: async () => {},
    getEnterpriseConfig: async () => mainConfig,
  });
  t.after(() => service.dispose());
  // The production preload unwraps allowlisted structured failures. No Electron
  // binary, profile, keychain, filesystem-backed credential or provider is used.
  let api;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../preload.js"), "utf8"), {
    process,
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (_, value) => {
            api = value;
          },
        },
        webUtils: {},
        ipcRenderer: {
          on() {},
          removeListener() {},
          send() {},
          sendSync() {},
          invoke: async (channel, request) => {
            requests.push(request);
            return handlers.get(channel)({ sender }, request);
          },
        },
      };
    },
  });
  const importGate = deferred();
  globalThis.__retryImportGate = importGate.promise;
  globalThis.__retryNotices = events;
  t.after(() => {
    delete globalThis.__retryImportGate;
    delete globalThis.__retryNotices;
  });
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-production-cleanup-operation-",
    settingsKey: "__productionCleanupSettings",
    settings: {
      useCleanupModel: true,
      useDictationAgent: false,
      cleanupMode: "providers",
      cleanupProvider: "azure",
      cleanupModel: "original-deployment",
      customPrompts: undefined,
      preferredLanguage: "en",
    },
    mockModules: {
      "/stores/settingsStore": realSettingsStoreSource("__productionCleanupSettings"),
      "/services/ReasoningService": 'export { default } from "/services/ReasoningService.ts";',
      "/components/ui/notices":
        "export const notify = (notice) => globalThis.__retryNotices.push(notice); export const dismissNotice = () => {}; export const getNotices = () => [];",
      "/helpers/audioManager":
        "export default class { constructor() { return globalThis.__retryRealManager; } }",
      "/utils/writeClipboardText":
        'await globalThis.__retryImportGate; export { writeClipboardText } from "/utils/writeClipboardText.ts";',
    },
  });
  loaded.window.electronAPI = {
    onToggleDictation: () => () => {},
    onToggleVoiceAgent: () => () => {},
    onToggleTranslation: () => () => {},
    personalInference: api.personalInference,
    writeClipboard: async (text) => {
      copies.push(text);
      return { success: true };
    },
  };
  const store = await loaded.vite.ssrLoadModule("/stores/routeFactsStore.ts");
  store.useRouteFactsStore.setState({
    facts: {
      ...store.EMPTY_ROUTE_FACTS,
      enterpriseRecipients: buildEnterpriseRecipientFacts(config, {}),
    },
  });
  const manager = loaded.createManager({
    isProcessing: true,
    voiceAgentRequested: false,
    translationRequested: false,
    _recordingPrivate: true,
    isReasoningAvailable: async () => true,
  });
  const session = manager.beginDictationSession();
  const raw = "original raw words";
  assert.equal(await manager.processTranscriptionCore(raw, "fixture"), raw);
  const failure = manager._takePendingResultExtras().cleanupFailure;
  assert.equal(typeof failure.retryCleanup, "function");
  assert.equal(failure.rawText, raw);
  manager._endDictationSession(session);
  const { retryDictationCleanup } = await loaded.vite.ssrLoadModule(
    "/helpers/retryDictationCleanup.js"
  );
  return {
    ...loaded,
    raw,
    session,
    failure,
    manager,
    importGate,
    events,
    sdkCalls,
    requests,
    copies,
    retryDictationCleanup,
    succeed: () => {
      shouldFail = false;
    },
    changeMain: () => {
      mainConfig = { ...config, azureEndpoint: "https://changed.example/openai" };
    },
  };
}

test("production failed cleanup Retry keeps its operation through idle, settings changes and lazy default UI imports", async (t) => {
  const f = await fixture(t);
  f.succeed();
  const retry = f.retryDictationCleanup(f.raw, { processText: f.failure.retryCleanup });
  f.setSettings({
    cleanupMode: "providers",
    cleanupProvider: "openai",
    cleanupModel: "new-model",
    customPrompts: { cleanup: "NEW PROMPT MUST NOT APPLY" },
  });
  f.manager.beginDictationSession(); // an entirely newer operation may now own the manager
  f.importGate.resolve();
  assert.equal(await retry, "cleaned");
  assert.equal(f.session.private, true);
  assert.equal(f.sdkCalls.length, 2);
  for (const call of f.sdkCalls) {
    assert.equal(call.options.baseURL, "https://original.example/openai");
    assert.equal(call.model, "original-deployment");
  }
  for (const request of f.requests) {
    assert.equal(request.correlationId, f.session.id);
    assert.equal(request.dictationSessionId, f.session.id);
    assert.equal(request.dictationOperation, true);
    assert.equal(request.enterpriseRecipientTag, f.session.routes.dictationCleanup.recipient.tag);
    assert.equal(request.systemPrompt.includes("NEW PROMPT MUST NOT APPLY"), false);
    assert.equal(JSON.stringify(request).includes("synthetic-only"), false);
  }
  assert.deepEqual(f.copies, ["Original cleaned words."]);
  assert.equal(f.events.at(-1).kind, "receipt");
});

test("production Retry refused after main Apply retains raw words and localizes the safe code", async (t) => {
  const f = await fixture(t);
  f.succeed();
  f.changeMain();
  f.importGate.resolve();
  assert.equal(
    await f.retryDictationCleanup(f.raw, { processText: f.failure.retryCleanup }),
    "failed"
  );
  assert.equal(f.sdkCalls.length, 1, "refusal constructs no second model");
  assert.deepEqual(f.copies, []);
  assert.equal(f.events.at(-1).words, f.raw);
  assert.equal(f.events.at(-1).kind, "alert");
  assert.match(f.events.at(-1).body, /original destination/);
  assert.notEqual(f.events.at(-1).body, "recipientChanged");
});

test("the actual completion hook retains the original Retry and privacy through paste/persistence waits", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const f = await fixture(t);
  const saveGate = deferred(),
    saveEntered = deferred(),
    pasteGate = deferred();
  const saves = [];
  f.manager.applySessionIntents(f.session);
  Object.assign(f.manager, {
    cacheMicrophoneDeviceId() {},
    cleanup() {},
    shouldUseStreaming: () => false,
    safePaste: async () => {
      await pasteGate.promise;
      return true;
    },
    saveTranscription: async (...args) => {
      saves.push(args);
      saveEntered.resolve();
      await saveGate.promise;
      return true;
    },
  });
  globalThis.__retryRealManager = f.manager;
  t.after(() => {
    delete globalThis.__retryRealManager;
  });
  f.setSettings({
    autoPasteEnabled: true,
    keepTranscriptionInClipboard: false,
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "azure",
    cleanupModel: "original-deployment",
    snippets: [],
  });
  const container = installHookDom(t);
  const { useAudioRecording } = await f.vite.ssrLoadModule("/hooks/useAudioRecording.js");
  function Harness() {
    useAudioRecording();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const result = {
    success: true,
    text: f.raw,
    rawText: f.raw,
    source: "fixture",
    cleanupFailure: { ...f.failure },
  };
  let completion;
  await React.act(async () => {
    completion = f.manager.onTranscriptionComplete(result);
    await saveEntered.promise;
  });
  f.setSettings({
    autoPasteEnabled: true,
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "openai",
    cleanupModel: "new-model",
    snippets: [],
  });
  f.manager._recordingPrivate = false;
  f.manager.beginDictationSession();
  result.cleanupFailure.retryCleanup = () => {
    throw new Error("new operation must never run");
  };
  pasteGate.resolve();
  saveGate.resolve();
  await React.act(async () => completion);
  assert.equal(saves[0][2].sessionId, f.session.id);
  assert.equal(saves[0][2].private, true);
  const { useCleanupFailureStore } = await f.vite.ssrLoadModule("/stores/cleanupFailureStore.ts");
  const failure = useCleanupFailureStore.getState().lastFailure;
  assert.equal(failure.retryCleanup, f.failure.retryCleanup);
  f.succeed();
  f.importGate.resolve();
  assert.equal(
    await f.retryDictationCleanup(failure.rawText, { processText: failure.retryCleanup }),
    "cleaned"
  );
  assert.equal(f.sdkCalls.at(-1).model, "original-deployment");
  assert.equal(f.requests.at(-1).dictationSessionId, f.session.id);
});
