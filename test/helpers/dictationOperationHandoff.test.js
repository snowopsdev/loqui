const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { loadAudioManager, realSettingsStoreSource } = require("./harness/audioManager");

const LOCAL_AGENT = {
  useDictationAgent: true,
  dictationAgentMode: "local",
  dictationAgentProvider: "qwen",
  dictationAgentModel: "qwen3.5-2b-q4_k_m",
  dictationAgentCustomApiKey: "sk-secret",
  useCleanupModel: false,
  voiceAgentScreenContext: true,
  autoPasteEnabled: false,
};
const REMOTE_AGENT = {
  ...LOCAL_AGENT,
  dictationAgentMode: "providers",
  dictationAgentProvider: "openai",
  dictationAgentModel: "gpt-5-mini",
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

// `selection()` and `screen()` answer with what is selected and on screen *now*.
async function setupManager(t, { selection, screen }) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-operation-handoff-",
    settingsKey: "__operationHandoffSettings",
    settings: LOCAL_AGENT,
    mockModules: {
      "/stores/settingsStore": realSettingsStoreSource("__operationHandoffSettings"),
      // The leaf transport: record what a selection edit sends, and answer it.
      "/services/ReasoningService": `export default {
        cancelAllRequests() {},
        async processText(text, model, agentName, config) {
          globalThis.__operationHandoffSent.push({ text, model, config });
          const marker = config.systemPrompt.match(/__LOQUI_SELECTION_COMPLETE_[0-9a-f-]+__/)[0];
          return "Fixed draft" + marker;
        },
      };`,
    },
  });
  const sent = [];
  globalThis.__operationHandoffSent = sent;
  t.after(() => delete globalThis.__operationHandoffSent);
  const reads = { selection: 0, screen: 0 };
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    captureSelectedText: async () => (reads.selection++, selection()),
    captureScreenContext: async () => (reads.screen++, screen()),
  };
  const manager = loaded.createManager({ isProcessing: true, pendingAssistantConversation: null });
  // The hook's press-time sequence (useAudioRecording.js:153-179), then startRecording's session.
  manager.setVoiceAgentRequested(true);
  manager.beginScreenContextCapture();
  manager.beginSelectionCapture();
  const session = manager.beginDictationSession({});
  await flush();
  return { ...loaded, manager, session, sent, reads };
}

// Exercise the present detach/apply seam directly. Task8 must additionally
// prove this through its actual cancel buffer, undo window and restoreCancelled.
function detachThenApply(manager, changeTheWorld) {
  manager._requestStreamingCancellation();
  const held = manager._detachSessionOperation();
  assert.equal(manager.activeSession, null);
  assert.equal(held.context.released, false, "the reads survive the cancel");
  changeTheWorld();
  manager.applySessionIntents(held.session, { context: held.context, tracker: held.tracker });
  return held;
}

test("a standalone Agent command carries its session's operation, not live Settings", async (t) => {
  const { manager, session, setSettings } = await setupManager(t, {
    selection: () => ({ status: "none" }),
    screen: () => ({ data: "A", mediaType: "image/png" }),
  });
  setSettings(REMOTE_AGENT); // switched to OpenAI while the command was transcribing
  await manager.processTranscriptionCore("draft a reply", "local-parakeet");
  const { assistantConversation } = manager._takePendingResultExtras();
  assert.equal(assistantConversation.transcript, "draft a reply");
  assert.equal(assistantConversation.operation.sessionId, session.id);
  assert.equal(assistantConversation.operation.settings, session.settings);
  assert.equal(assistantConversation.operation.settings.dictationAgentMode, "local");
  assert.equal(
    "dictationAgentCustomApiKey" in assistantConversation.operation.settings,
    false,
    "no key rides along"
  );
});

test("detach/apply of a standalone Agent command keeps its route and press-time screenshot", async (t) => {
  let shot = { data: "A", mediaType: "image/png" };
  const { manager, session, reads, setSettings } = await setupManager(t, {
    selection: () => ({ status: "none" }),
    screen: () => shot,
  });
  detachThenApply(manager, () => {
    setSettings(REMOTE_AGENT);
    shot = { data: "B", mediaType: "image/png" };
  });
  await manager.processTranscriptionCore("draft a reply", "local-parakeet");
  const { assistantConversation } = manager._takePendingResultExtras();
  assert.equal(assistantConversation.operation.sessionId, session.id);
  assert.equal(assistantConversation.operation.settings.dictationAgentMode, "local");
  assert.equal(
    assistantConversation.screenContext.data,
    "A",
    "the screenshot from the press, not a new one"
  );
  assert.deepEqual(reads, { selection: 1, screen: 1 }, "Undo reads nothing from the OS again");
});

test("detach/apply of a selection edit keeps the press-time selection and route", async (t) => {
  let selected = {
    status: "selected",
    sessionId: "sel-original",
    text: "teh draft",
    characterCount: 9,
  };
  const { manager, session, sent, reads, setSettings } = await setupManager(t, {
    selection: () => selected,
    screen: () => null,
  });
  detachThenApply(manager, () => {
    setSettings(REMOTE_AGENT);
    selected = {
      status: "selected",
      sessionId: "sel-newer",
      text: "an unrelated paragraph",
      characterCount: 22,
    };
  });
  const text = await manager.processTranscriptionCore("fix the typo", "local-parakeet");
  assert.equal(text, "Fixed draft");
  // Main re-validates this capture's target and text before it replaces anything (selectionManager.js:213-235).
  assert.deepEqual(manager._takePendingResultExtras().selectionEdit, { sessionId: "sel-original" });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /teh draft/);
  assert.doesNotMatch(sent[0].text, /unrelated paragraph/);
  assert.equal(sent[0].model, "qwen3.5-2b-q4_k_m");
  assert.equal(sent[0].config.provider, "local", "the local Voice Assistant, not OpenAI");
  assert.equal(sent[0].config.correlationId, session.id);
  assert.equal(reads.selection, 1);
});

test("a restored session without a press-time read never reads the OS selection", async (t) => {
  const { manager, reads } = await setupManager(t, {
    selection: () => ({
      status: "selected",
      sessionId: "sel-now",
      text: "whatever is selected now",
      characterCount: 24,
    }),
    screen: () => null,
  });
  manager._requestStreamingCancellation();
  const { session } = manager._detachSessionOperation();
  manager.applySessionIntents(session); // a context that never had a selection read
  const capture = await manager.consumeSelectionCapture();
  assert.deepEqual(capture, { status: "none" }, "the command goes to the panel as standalone");
  assert.equal(reads.selection, 1, "only the press-time read");
});

test("the panel answers a voice command on its dictation's route, with its correlation id", async (t) => {
  const requests = [];
  const listeners = new Set();
  const emit = (event) => [...listeners].forEach((listener) => listener(event));
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        llamaServerStart: async () => ({ success: true, port: 8123 }),
        personalInference: {
          onTextEvent: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
          async textStream(request) {
            requests.push(request);
            emit({
              requestId: request.requestId,
              type: "chunk",
              chunk: { type: "content", text: "Done." },
            });
            emit({ requestId: request.requestId, type: "end" });
          },
          async textCancel() {},
        },
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-operation-panel-" });
  const [{ default: i18n }, { initReactI18next }] = await Promise.all([
    vite.ssrLoadModule("i18next"),
    vite.ssrLoadModule("react-i18next"),
  ]);
  if (!i18n.isInitialized) {
    const translation = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8")
    );
    await i18n.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation } },
      interpolation: { escapeValue: false },
    });
  }
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { captureDictationSession, sessionOperation } = await vite.ssrLoadModule(
    "/helpers/dictationSession.js"
  );
  const session = captureDictationSession({
    settings: { ...useSettingsStore.getState(), ...LOCAL_AGENT },
    intents: { voiceAgentRequested: true },
    agentName: "Loqui",
    id: "rec-9",
  });
  useSettingsStore.setState(REMOTE_AGENT); // Settings now say OpenAI
  const reasoning = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => reasoning.destroy());
  const { useChatStreaming } = await vite.ssrLoadModule("/components/chat/useChatStreaming.ts");
  let messages = [];
  let streaming;
  function Harness() {
    streaming = useChatStreaming({
      messages,
      setMessages: (next) => (messages = typeof next === "function" ? next(messages) : next),
      inferenceScope: "dictationAgent",
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  const user = { id: "u1", role: "user", content: "draft a reply", isStreaming: false };

  await streaming.sendToAI("draft a reply", [user], { operation: sessionOperation(session) });
  assert.equal(requests[0].provider, "local");
  assert.equal(requests[0].model, "qwen3.5-2b-q4_k_m");
  assert.equal(requests[0].baseUrl, "http://127.0.0.1:8123/v1");
  assert.equal(requests[0].correlationId, "rec-9");
  assert.equal(requests[0].dictationOperation, true);
  assert.equal(requests[0].dictationSessionId, "rec-9");

  await streaming.sendToAI("and a typed follow-up", [user]);
  assert.equal(
    requests[1].provider,
    "openai",
    "a typed follow-up is a new request on live Settings"
  );
  assert.equal(requests[1].correlationId, null);
  assert.equal(requests[1].dictationOperation, undefined);
});

test("actual cleanup, translation and vision-selection construction keeps each captured tag and session marker", async (t) => {
  const calls = [];
  globalThis.__stageOperationCalls = calls;
  t.after(() => delete globalThis.__stageOperationCalls);
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-stage-operation-tags-",
    settingsKey: "__stageOperationSettings",
    settings: {
      ...LOCAL_AGENT,
      useCleanupModel: true,
      cleanupMode: "providers",
      cleanupProvider: "azure",
      cleanupModel: "deployment",
      useDictationTranslation: true,
      translationMode: "providers",
      translationProvider: "bedrock",
      translationModel: "fixture-translation",
      translationSourceLanguage: "en",
      translationTargetLanguage: "fr",
      dictationAgentMode: "providers",
      dictationAgentProvider: "azure",
      dictationAgentModel: "gpt-4o",
      useDictationAgentVisionModel: true,
      dictationAgentVisionMode: "providers",
      dictationAgentVisionProvider: "vertex",
      dictationAgentVisionModel: "gemini-2.5-flash",
    },
    mockModules: {
      "/stores/settingsStore": realSettingsStoreSource("__stageOperationSettings"),
      "/services/ReasoningService": `export default {
        async isAvailable() { return true; }, cancelAllRequests() {},
        async processText(text, model, agentName, config) {
          globalThis.__stageOperationCalls.push({ text, model, config });
          const marker = config.systemPrompt?.match(/__LOQUI_SELECTION_COMPLETE_[0-9a-f-]+__/)?.[0];
          return marker ? "Fixed draft" + marker : "Processed words";
        },
      };`,
    },
  });
  const {
    buildEnterpriseRecipientFacts,
  } = require("../../src/helpers/enterpriseRecipientIdentity");
  const tags = buildEnterpriseRecipientFacts(
    {
      azureEndpoint: "https://azure.example",
      bedrockRegion: "us-east-1",
      vertexProject: "fixture-project",
      vertexAuthSource: "adc",
    },
    {}
  );
  const routeStore = await loaded.vite.ssrLoadModule("/stores/routeFactsStore.ts");
  routeStore.useRouteFactsStore.setState({
    facts: { ...routeStore.EMPTY_ROUTE_FACTS, enterpriseRecipients: tags },
  });
  const { getSettings } = await loaded.vite.ssrLoadModule("/stores/settingsStore");
  const { captureDictationSession } = await loaded.vite.ssrLoadModule(
    "/helpers/dictationSession.js"
  );
  const manager = loaded.createManager({ isProcessing: true });
  const settings = getSettings();
  const cleanup = captureDictationSession({ settings, agentName: "Loqui", intents: {} });
  manager.applySessionIntents(cleanup);
  await manager.processTranscriptionCore("ordinary words", "fixture");
  assert.equal(calls[0].config.enterpriseRecipientTag, tags.azure.tag);
  const translation = captureDictationSession({
    settings,
    agentName: "Loqui",
    intents: { translationRequested: true },
  });
  manager.applySessionIntents(translation);
  await manager.processTranscriptionCore("translate these words", "fixture");
  assert.deepEqual(
    calls.slice(1).map((call) => call.config.enterpriseRecipientTag),
    [tags.azure.tag, tags.bedrock.tag]
  );
  const { createSessionContext } = await loaded.vite.ssrLoadModule("/helpers/dictationSession.js");
  const agent = captureDictationSession({
    settings,
    agentName: "Loqui",
    intents: { voiceAgentRequested: true },
  });
  manager.applySessionIntents(agent, {
    context: createSessionContext({
      sessionId: agent.id,
      selection: Promise.resolve({
        status: "selected",
        sessionId: "original-selection",
        text: "teh draft",
        characterCount: 9,
      }),
      screen: Promise.resolve({ data: "original-image", mediaType: "image/png" }),
    }),
  });
  assert.equal(await manager.processTranscriptionCore("fix this typo", "fixture"), "Fixed draft");
  assert.equal(calls.at(-1).config.enterpriseRecipientTag, tags.vertex.tag);
  assert.equal(calls.at(-1).config.screenContext.data, "original-image");
  for (const [call, session] of [
    [calls[0], cleanup],
    [calls[1], translation],
    [calls[2], translation],
    [calls[3], agent],
  ]) {
    assert.equal(call.config.correlationId, session.id);
    assert.equal(call.config.dictationSessionId, session.id);
    assert.equal(call.config.dictationOperation, true);
  }
});

test("an ordinary dictation invoking the wake word banks the press-time optional Agent tag", async (t) => {
  const { manager, setSettings, vite } = await setupManager(t, {
    selection: () => ({ status: "none" }),
    screen: () => null,
  });
  const {
    buildEnterpriseRecipientFacts,
  } = require("../../src/helpers/enterpriseRecipientIdentity");
  const tags = buildEnterpriseRecipientFacts({ azureEndpoint: "https://original.example" }, {});
  const routeStore = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  routeStore.useRouteFactsStore.setState({
    facts: { ...routeStore.EMPTY_ROUTE_FACTS, enterpriseRecipients: tags },
  });
  setSettings({
    ...LOCAL_AGENT,
    dictationAgentMode: "providers",
    dictationAgentProvider: "azure",
    dictationAgentModel: "deployment",
  });
  const { captureDictationSession, createSessionContext } = await vite.ssrLoadModule(
    "/helpers/dictationSession.js"
  );
  const { getSettings } = await vite.ssrLoadModule("/stores/settingsStore");
  manager.isReasoningAvailable = async () => true;
  const session = captureDictationSession({
    settings: getSettings(),
    agentName: "Loqui",
    intents: { voiceAgentRequested: false },
  });
  manager.applySessionIntents(session, {
    context: createSessionContext({
      sessionId: session.id,
      selection: Promise.resolve({ status: "none" }),
    }),
  });
  setSettings(REMOTE_AGENT);
  await manager.processTranscriptionCore("Loqui, draft a reply", "fixture");
  const command = manager._takePendingResultExtras().assistantConversation;
  assert.equal(command.operation.enterpriseRecipientTags.azure, tags.azure.tag);
  assert.equal(command.operation.presentation.intents.voiceAgentRequested, false);
  assert.equal(command.operation.presentation.routes.voiceAssistant.providerId, "azure");
  manager._endDictationSession(session);
  assert.equal(command.operation.sessionId, session.id, "banked operation outlives audio idle");
});

test("a banked optional Agent reaches the actual main tag gate; unknown optional authority retains the words", async (t) => {
  const { EventEmitter } = require("node:events");
  const { registerPersonalInferenceIPC } = require("../../src/helpers/personalInference");
  const {
    buildEnterpriseRecipientFacts,
  } = require("../../src/helpers/enterpriseRecipientIdentity");
  const handlers = new Map(),
    listeners = new Set(),
    requests = [],
    factories = [];
  const config = { azureEndpoint: "https://original.example", azureApiVersion: "2024-10-21" };
  const codex = new EventEmitter();
  codex.stop = () => {};
  const sender = new EventEmitter();
  Object.assign(sender, {
    id: 8,
    isDestroyed: () => false,
    send: (_, event) => {
      for (const listener of listeners) listener(event);
    },
  });
  const service = registerPersonalInferenceIPC({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler() {} },
    codex,
    userDataPath: "/fixture-unused",
    getCredential: async () => "synthetic-key",
    saveCredential: async () => {},
    getEnterpriseConfig: async () => config,
    modelFactory: async (...args) => {
      factories.push(args);
      return {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "fixture",
        supportedUrls: {},
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "one" });
              controller.enqueue({ type: "text-delta", id: "one", delta: "Answer." });
              controller.enqueue({ type: "text-end", id: "one" });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: { inputTokens: {}, outputTokens: {} },
              });
              controller.close();
            },
          }),
        }),
      };
    },
  });
  t.after(() => service.dispose());
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        personalInference: {
          onTextEvent: (fn) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
          textStream: (request) => {
            requests.push(request);
            return handlers.get("personal-inference:text-stream")({ sender }, request);
          },
          textCancel: async (id) => handlers.get("personal-inference:text-cancel")({ sender }, id),
        },
      },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-optional-agent-main-gate-" });
  const { useSettingsStore, getSettings } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({
    ...LOCAL_AGENT,
    voiceAgentScreenContext: false,
    dictationAgentMode: "providers",
    dictationAgentProvider: "azure",
    dictationAgentModel: "deployment",
  });
  const facts = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  facts.useRouteFactsStore.setState({
    facts: {
      ...facts.EMPTY_ROUTE_FACTS,
      enterpriseRecipients: buildEnterpriseRecipientFacts(config, {}),
    },
  });
  const { captureDictationSession, sessionOperation, hasUnknownSelectedEnterpriseRecipient } =
    await vite.ssrLoadModule("/helpers/dictationSession.js");
  const session = captureDictationSession({
    settings: getSettings(),
    agentName: "Loqui",
    intents: { voiceAgentRequested: false },
  });
  useSettingsStore.setState(REMOTE_AGENT);
  const { useChatStreaming } = await vite.ssrLoadModule("/components/chat/useChatStreaming.ts");
  const reasoning = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => reasoning.destroy());
  let messages = [
      { id: "user", role: "user", content: "Loqui, draft a reply", isStreaming: false },
    ],
    streaming;
  function Harness() {
    streaming = useChatStreaming({
      messages,
      setMessages: (update) => {
        messages = typeof update === "function" ? update(messages) : update;
      },
      inferenceScope: "dictationAgent",
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  await streaming.sendToAI(messages[0].content, messages, { operation: sessionOperation(session) });
  assert.equal(requests[0].provider, "azure");
  assert.equal(requests[0].enterpriseRecipientTag, session.enterpriseRecipientTags.azure);
  assert.equal(requests[0].dictationOperation, true);
  assert.equal(requests[0].dictationSessionId, session.id);
  assert.equal(factories.length, 1);
  facts.useRouteFactsStore.setState({ facts: facts.EMPTY_ROUTE_FACTS });
  const unknown = captureDictationSession({
    settings: {
      ...getSettings(),
      dictationAgentProvider: "azure",
      dictationAgentModel: "deployment",
    },
    agentName: "Loqui",
    intents: {},
  });
  assert.equal(
    hasUnknownSelectedEnterpriseRecipient(unknown),
    false,
    "unknown optional Agent does not block ordinary recording"
  );
  const originalSettings = unknown.settings;
  const rawUser = {
    id: "raw-user",
    role: "user",
    content: "Loqui, keep my raw words",
    isStreaming: false,
  };
  messages = [rawUser];
  await streaming.sendToAI(rawUser.content, messages, { operation: sessionOperation(unknown) });
  assert.equal(factories.length, 1, "actual main refuses unknown tag before factory");
  assert.equal(unknown.settings, originalSettings);
  assert.equal(messages[0], rawUser, "the admitted user words remain in the conversation");
  assert.match(messages.at(-1).content, /words are preserved/);
});

async function holdWithFakeClock(manager, vite) {
  const { createUndoWindow } = await vite.ssrLoadModule("/helpers/cancelBuffer.js");
  const timers = [];
  manager._undoWindowFactory = (opts) =>
    createUndoWindow({
      ...opts,
      now: () => 0,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer() {},
    });
  manager._delay = () => new Promise(() => {}); // the final chunk is never awaited here: batch segments are registered
  manager._readSealed = () => false;
  return timers;
}

async function cancelProcessingThenRestore({ manager, session, vite }, changeTheWorld) {
  await holdWithFakeClock(manager, vite);
  manager.onTranscriptionComplete = (result) => {
    manager.__restoredResult = result;
  };
  manager._sessionAudio = {
    session,
    kind: "batch",
    segments: [new Blob([new Uint8Array(300).fill(1)], { type: "audio/webm" })],
    mimeType: "audio/webm",
    durationSeconds: 2,
    analyticsOccurredAt: "x",
  };
  assert.equal(manager.cancelProcessing(), true); // the hook's Esc (Task 9)
  await flush();
  changeTheWorld();
  const result = await manager.restoreCancelled(session.id);
  assert.equal(result.restored, true);
  await manager._restoreRun;
}

test("Undo through restoreCancelled keeps a standalone Agent command's route and screenshot (Task 8)", async (t) => {
  let shot = { data: "A", mediaType: "image/png" };
  const setup = await setupManager(t, {
    selection: () => ({ status: "none" }),
    screen: () => shot,
  });
  const { manager, session, reads, setSettings } = setup;
  setup.window.electronAPI.transcribeLocalParakeet = async () => ({
    success: true,
    text: "draft a reply",
  });
  await cancelProcessingThenRestore(setup, () => {
    setSettings(REMOTE_AGENT);
    shot = { data: "B", mediaType: "image/png" };
  });
  const { assistantConversation } = manager.__restoredResult;
  assert.equal(assistantConversation.operation.sessionId, session.id);
  assert.equal(assistantConversation.operation.settings.dictationAgentMode, "local");
  assert.equal(assistantConversation.screenContext.data, "A");
  assert.deepEqual(reads, { selection: 1, screen: 1 }, "Undo reads nothing from the OS again");
});

test("Undo through restoreCancelled edits the press-time selection on the session's route (Task 8)", async (t) => {
  let selected = {
    status: "selected",
    sessionId: "sel-original",
    text: "teh draft",
    characterCount: 9,
  };
  const setup = await setupManager(t, { selection: () => selected, screen: () => null });
  const { manager, session, sent, reads, setSettings } = setup;
  setup.window.electronAPI.transcribeLocalParakeet = async () => ({
    success: true,
    text: "fix the typo",
  });
  await cancelProcessingThenRestore(setup, () => {
    setSettings(REMOTE_AGENT);
    selected = {
      status: "selected",
      sessionId: "sel-newer",
      text: "an unrelated paragraph",
      characterCount: 22,
    };
  });
  assert.deepEqual(manager.__restoredResult.selectionEdit, { sessionId: "sel-original" });
  assert.match(sent[0].text, /teh draft/);
  assert.equal(sent[0].config.provider, "local");
  assert.equal(sent[0].config.correlationId, session.id);
  assert.equal(reads.selection, 1);
});

test("late original Agent processing cannot bank or settle a same-session restored pipeline", async (t) => {
  let resolveScreen;
  const screen = new Promise((resolve) => {
    resolveScreen = resolve;
  });
  const setup = await setupManager(t, {
    selection: () => ({ status: "none" }),
    screen: () => screen,
  });
  const { manager, session } = setup;
  await holdWithFakeClock(manager, setup.vite);
  const completed = [];
  manager.onTranscriptionComplete = (result) => completed.push(result);
  manager.processWithLocalParakeet = async (_audio, _model, _metadata, wasCancelled) => ({
    success: true,
    source: "local-parakeet",
    text: await manager.processTranscription("draft a reply", "local-parakeet", wasCancelled),
  });
  const segment = new Blob([new Uint8Array(300).fill(5)]);
  manager._sessionAudio = { session, kind: "batch", segments: [segment], durationSeconds: 2 };
  const originalRun = manager.processAudio(segment);
  await flush();
  assert.equal(manager.cancelProcessing(), true);
  assert.equal((await manager.restoreCancelled(session.id)).restored, true);
  const restoredPipeline = manager._activeProcessingPipeline;
  resolveScreen({ data: "original", mediaType: "image/png" });
  await originalRun;
  await manager._restoreRun;
  assert.equal(completed.length, 1);
  assert.equal(completed[0].assistantConversation.operation.sessionId, session.id);
  assert.equal(completed[0].assistantConversation.screenContext.data, "original");
  assert.ok(restoredPipeline);
  assert.equal(manager.isProcessing, false);
});
