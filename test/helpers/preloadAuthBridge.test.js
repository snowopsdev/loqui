const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPreloadApi(invokeResult) {
  let exposedApi;
  const listeners = new Map();
  const invocations = [];
  const sends = [];
  const ipcRenderer = {
    invoke: async (...args) => {
      invocations.push(args);
      return typeof invokeResult === "function" ? invokeResult(...args) : invokeResult;
    },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    send: (...args) => sends.push(args),
    sendSync: () => undefined,
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld: (_name, api) => {
        exposedApi = api;
      },
    },
    ipcRenderer,
    webUtils: {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../../preload.js"), "utf8");
  vm.runInNewContext(source, {
    require: (specifier) => {
      if (specifier === "electron") return electron;
      throw new Error(`Unexpected preload dependency: ${specifier}`);
    },
    process,
  });
  return { api: exposedApi, invocations, listeners, sends };
}

test("meeting stop forwards the optional expected recording session ID", async () => {
  const { api, invocations } = loadPreloadApi();

  await api.meetingTranscriptionStop("meeting-2");

  assert.deepEqual(invocations, [["meeting-transcription-stop", "meeting-2"]]);
});

test("meeting system-audio availability forwards the scoped session", async () => {
  const { api, invocations } = loadPreloadApi();

  await api.meetingTranscriptionSetSystemAudioAvailable("meeting-2", true);

  assert.deepEqual(invocations, [
    ["meeting-transcription-set-system-audio-available", "meeting-2", true],
  ]);
});

test("meeting auto-end listener strips the event and can unsubscribe", () => {
  const { api, listeners } = loadPreloadApi();
  const payload = { sessionId: "meeting-2" };
  let received;
  const unsubscribe = api.onMeetingAutoEndRequested((request) => {
    received = request;
  });

  listeners.get("meeting-auto-end-requested")?.({ sender: "ipc" }, payload);

  assert.equal(received, payload);
  unsubscribe();
  assert.equal(listeners.has("meeting-auto-end-requested"), false);
});

test("assistant busy state is forwarded to the main-process hotkey guard", async () => {
  const { api, invocations } = loadPreloadApi();

  await api.setAssistantPanelBusy(true);

  assert.deepEqual(invocations, [["set-assistant-panel-busy", true]]);
});

test("dictation lifecycle and audio levels preserve companion routing metadata", () => {
  const { api, sends } = loadPreloadApi();

  api.dictationLifecycleStateChanged("recording", "assistant");
  api.dictationAudioLevelChanged(0.42);

  assert.deepEqual(sends, [
    ["dictation-lifecycle-state-changed", "recording", "assistant"],
    ["dictation-audio-level-changed", 0.42],
  ]);
});

test("the Agent companion owns only its scoped window bridges", async () => {
  const { api, invocations, sends } = loadPreloadApi();

  await api.resizeAgentDictationPillToContent(240);
  await api.resizeAgentDictationPillToContent(null);
  await api.setAgentDictationPillInteractivity(true);
  await api.cancelAgentPanelDictation();
  api.showAgentDictationFinalTranscript("recovered text");

  assert.deepEqual(invocations, [
    ["resize-agent-dictation-pill-to-content", 240],
    ["resize-agent-dictation-pill-to-content", null],
    ["set-agent-dictation-pill-interactivity", true],
    ["cancel-agent-panel-dictation"],
  ]);
  assert.deepEqual(
    sends.filter(([channel]) => channel === "show-agent-dictation-final-transcript"),
    [["show-agent-dictation-final-transcript", "recovered text"]]
  );
});

test("enterprise reasoning cancellation is forwarded to the main process", () => {
  const { api, sends } = loadPreloadApi();

  api.cancelEnterpriseReasoning();

  assert.deepEqual(sends, [["enterprise-reasoning-cancel"]]);
});

test("prepare-dictation forwards the input kind without the Electron event", () => {
  const { api, listeners } = loadPreloadApi();
  const received = [];
  const dispose = api.onPrepareDictation((options) => received.push(options));

  listeners.get("prepare-dictation")?.({ senderId: 1 }, { inputKind: "assistant" });

  dispose();
  assert.deepEqual(received, [{ inputKind: "assistant" }]);
  assert.equal(listeners.has("prepare-dictation"), false);
});

test("personal preload has no hosted account, billing, sync, or update bridge", () => {
  const { api } = loadPreloadApi();
  for (const name of [
    "authGetToken",
    "cloudCheckout",
    "cloudTranscribe",
    "cloudReason",
    "setActiveAccountScope",
    "checkForUpdates",
    "cloudApiRequest",
  ])
    assert.equal(api[name], undefined, name);
  assert.equal(typeof api.personalInference.textGenerate, "function");
  assert.equal(typeof api.modelImportGguf, "function");
});

test("preload preserves only allowlisted recipient failure codes and unrelated success/failure semantics", async () => {
  for (const code of ["recipientUnknown", "recipientChanged"]) {
    const { api } = loadPreloadApi({ error: code, code });
    await assert.rejects(api.personalInference.textGenerate({ requestId: "fixture" }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.messageKey, `voiceOverlay.errors.${code}`);
      return true;
    });
  }
  const success = { text: "typed answer" };
  assert.equal(await loadPreloadApi(success).api.personalInference.textGenerate({}), success);
  const unrelated = new Error("ordinary provider failure");
  await assert.rejects(
    loadPreloadApi(() => {
      throw unrelated;
    }).api.personalInference.textGenerate({}),
    (error) => error === unrelated
  );
});

test("dictation streaming send and stop preserve optional exact operation identity", async () => {
  const { api, invocations, sends } = loadPreloadApi();
  const operation = { correlationId: "rec-A", dictationSessionId: "rec-A" };
  const bytes = new ArrayBuffer(2);
  for (const [send, stop, prefix] of [
    ["deepgramStreamingSend", "deepgramStreamingStop", "deepgram-streaming"],
    ["assemblyAiStreamingSend", "assemblyAiStreamingStop", "assemblyai-streaming"],
    ["geminiStreamingSend", "geminiStreamingStop", "gemini-streaming"],
    ["cortiStreamingSend", "cortiStreamingStop", "corti-streaming"],
    ["dictationRealtimeSend", "dictationRealtimeStop", "dictation-realtime"],
  ]) {
    api[send](bytes, operation);
    await api[stop](operation);
    assert.deepEqual(sends.at(-1), [`${prefix}-send`, bytes, operation]);
    assert.deepEqual(invocations.at(-1), [`${prefix}-stop`, operation]);
  }
});

test("dictation streaming bridge preserves fresh operation identity for every control", async () => {
  const { api, invocations, sends, listeners } = loadPreloadApi({ success: true });
  const identity = { correlationId: "rec", dictationSessionId: "rec", operationId: "attempt" };
  const buffer = new ArrayBuffer(4);
  for (const [stem, channel] of [
    ["dictationRealtime", "dictation-realtime"],
    ["assemblyAiStreaming", "assemblyai-streaming"],
    ["deepgramStreaming", "deepgram-streaming"],
    ["geminiStreaming", "gemini-streaming"],
    ["cortiStreaming", "corti-streaming"],
  ]) {
    await api[`${stem}Start`](identity);
    api[`${stem}Send`](buffer, identity);
    await api[`${stem}Cancel`](identity);
    await api[`${stem}Stop`](identity);
    assert.equal(invocations.at(-3)[0], `${channel}-start`);
    assert.equal(invocations.at(-3)[1], identity);
    assert.equal(invocations.at(-2)[0], `${channel}-cancel`);
    assert.equal(invocations.at(-2)[1], identity);
    assert.equal(invocations.at(-1)[0], `${channel}-stop`);
    assert.equal(invocations.at(-1)[1], identity);
    assert.equal(sends.at(-1)[2], identity);
  }
  let received;
  const off = api.onDictationDispatch((value) => (received = value));
  const receipt = { correlationId: "rec", task: "dictationStt", payload: "audio" };
  listeners.get("dictation-dispatch")({}, receipt);
  assert.equal(received, receipt);
  off();
  assert.equal(listeners.has("dictation-dispatch"), false);
});
