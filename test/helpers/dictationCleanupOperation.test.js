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

async function fixture(t, { private: isPrivate = true } = {}) {
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
    shouldFail = true,
    generationWait = null;
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
              if (generationWait) {
                generationWait.entered.resolve();
                await generationWait.gate.promise;
              }
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
    process: { ...process, isMainFrame: true },
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          executeInMainWorld: () => {},
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
    _recordingPrivate: isPrivate,
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
    pauseCleanup: () => {
      generationWait = { entered: deferred(), gate: deferred() };
      return generationWait;
    },
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
  const f = await fixture(t, { private: false });
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
  f.manager._recordingPrivate = true;
  f.manager.beginDictationSession();
  result.cleanupFailure.retryCleanup = () => {
    throw new Error("new operation must never run");
  };
  pasteGate.resolve();
  saveGate.resolve();
  await React.act(async () => completion);
  assert.equal(saves[0][2].sessionId, f.session.id);
  assert.equal(saves[0][2].private, false);
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

test("actual completion, snapshot saver and default Retry preserve original privacy and raw words across persistence/import/copy failures", async (t) => {
  for (const mode of ["private", "row", "audio", "copy", "refusal"]) {
    await t.test(mode, async (t) => {
      let root;
      t.after(async () => {
        if (root) await React.act(async () => root.unmount());
      });
      const f = await fixture(t, { private: mode === "private" });
      f.setSettings({
        dataRetentionEnabled: true,
        audioRetentionDays: 30,
        autoPasteEnabled: true,
        keepTranscriptionInClipboard: false,
        snippets: [],
      });
      f.manager.applySessionIntents(f.session);
      const original = new Blob([Uint8Array.of(3, 4, 5)]);
      f.manager._setOwnedAudio(original, { sessionId: f.session.id, private: f.session.private });
      const entered = deferred(),
        gate = deferred(),
        pasted = deferred(),
        pasteGate = deferred();
      const writes = [],
        uploaded = [];
      f.window.electronAPI.recordAnalyticsEvent = async () => writes.push("analytics");
      f.window.electronAPI.saveTranscription = async (...args) => {
        writes.push(["row", ...args]);
        if (mode === "row") {
          entered.resolve();
          await gate.promise;
          throw Error("synthetic row failure");
        }
        return { id: 4 };
      };
      f.window.electronAPI.saveTranscriptionAudio = async (_id, bytes) => {
        uploaded.push([...new Uint8Array(bytes)]);
        if (mode === "audio") {
          entered.resolve();
          await gate.promise;
          throw Error("synthetic audio failure");
        }
        return { success: true };
      };
      if (mode === "copy") f.window.electronAPI.writeClipboard = async () => ({ success: false });
      Object.assign(f.manager, {
        cacheMicrophoneDeviceId() {},
        cleanup() {},
        shouldUseStreaming: () => false,
        safePaste: async () => {
          pasted.resolve();
          await pasteGate.promise;
          return true;
        },
      });
      globalThis.__retryRealManager = f.manager;
      t.after(() => delete globalThis.__retryRealManager);
      const container = installHookDom(t);
      const { useAudioRecording } = await f.vite.ssrLoadModule("/hooks/useAudioRecording.js");
      function Harness() {
        useAudioRecording();
        return null;
      }
      root = createRoot(container);
      await React.act(async () => root.render(React.createElement(Harness)));
      let completion;
      await React.act(async () => {
        completion = f.manager.onTranscriptionComplete({
          success: true,
          text: f.raw,
          rawText: f.raw,
          source: "fixture",
          cleanupFailure: f.failure,
        });
        if (mode !== "private") await pasted.promise;
        if (mode === "row" || mode === "audio") await entered.promise;
      });
      // The actual saver has captured A; B takes ownership while A awaits.
      f.manager._recordingPrivate = true;
      const newer = f.manager.beginDictationSession();
      const newerBlob = new Blob([Uint8Array.of(9)]);
      f.manager._setOwnedAudio(newerBlob);
      f.setSettings({
        cleanupMode: "providers",
        cleanupProvider: "openai",
        cleanupModel: "changed",
        snippets: [],
      });
      pasteGate.resolve();
      gate.resolve();
      await React.act(async () => completion);
      assert.equal(f.manager.lastAudioBlob, newerBlob, "A cannot release B's Blob generation");
      assert.equal(f.manager._lastAudioSessionId, newer.id);
      assert.ok(uploaded.every((bytes) => bytes.join() === "3,4,5"));
      if (mode === "private")
        assert.deepEqual(writes, [], "private A writes no analytics, transcript or audio");
      const { useCleanupFailureStore } = await f.vite.ssrLoadModule(
        "/stores/cleanupFailureStore.ts"
      );
      const storedFailure = useCleanupFailureStore.getState().lastFailure;
      if (mode === "private")
        assert.equal(
          storedFailure,
          null,
          "private completion never claims an external paste failure"
        );
      const failure = mode === "private" ? { ...f.failure, rawText: f.raw } : storedFailure;
      assert.equal(failure.rawText, f.raw);
      f.succeed();
      const retry = f.retryDictationCleanup(failure.rawText, { processText: failure.retryCleanup });
      if (mode === "refusal") f.changeMain();
      f.importGate.resolve();
      assert.equal(await retry, ["copy", "refusal"].includes(mode) ? "failed" : "cleaned");
      if (["copy", "refusal"].includes(mode)) assert.equal(f.events.at(-1).words, f.raw);
      assert.equal(f.requests.at(-1).dictationSessionId, f.session.id);
      assert.equal(f.manager.lastAudioBlob, newerBlob);
      assert.ok(f.sdkCalls.every((call) => call.model === "original-deployment"));
    });
  }
});

test("cancel during actual cleanup holds raw audio and late original cleanup cannot complete the restored attempt", async (t) => {
  const f = await fixture(t, { private: false });
  f.manager.applySessionIntents(f.session);
  const { createUndoWindow } = await f.vite.ssrLoadModule("/helpers/cancelBuffer.js");
  f.manager._undoWindowFactory = (opts) =>
    createUndoWindow({ ...opts, setTimer: () => 1, clearTimer() {} });
  f.manager._delay = () => new Promise(() => {});
  f.manager._readSealed = () => false;
  f.manager.onStateChange = () => {};
  const completed = [];
  f.manager.onTranscriptionComplete = (result) => completed.push(result);
  f.window.electronAPI.transcribeLocalParakeet = async () => ({ success: true, text: f.raw });
  const gate = f.pauseCleanup();
  f.succeed();
  const segment = new Blob([new Uint8Array(300).fill(4)], { type: "audio/webm" });
  f.manager._sessionAudio = {
    session: f.session,
    kind: "batch",
    segments: [segment],
    durationSeconds: 2,
  };
  f.manager._setOwnedAudio(segment);
  // Actual local STT wrapper calls actual cleanup, ReasoningService, preload,
  // main authority and installed AI executor; only local STT and SDK are leaves.
  const original = f.manager.processAudio(segment);
  await gate.entered.promise;
  assert.equal(f.manager.cancelProcessing(), true);
  const held = f.manager._undo.peek();
  await held.ready();
  assert.equal(held.session, f.session);
  assert.equal(held.bytes("segment")[0][0], 4);
  assert.equal((await f.manager.restoreCancelled()).restored, true);
  const restoredPipeline = f.manager._activeProcessingPipeline;
  gate.gate.resolve();
  await original;
  await f.manager._restoreRun;
  assert.equal(completed.length, 1);
  assert.equal(completed[0].text, "Original cleaned words.");
  assert.ok(restoredPipeline);
  assert.equal(f.manager.isProcessing, false);
});
