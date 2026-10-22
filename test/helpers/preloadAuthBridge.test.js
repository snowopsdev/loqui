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
      executeInMainWorld: () => {},
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
    process: { ...process, isMainFrame: true },
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

test("the control panel capture bridge strips events and supports unsubscribe", async () => {
  const { api, invocations, listeners } = loadPreloadApi();
  const states = [];
  const levels = [];
  const offState = api.onDictationLifecycleChanged((snapshot) => states.push(snapshot));
  const offLevel = api.onDictationLevelChanged((level) => levels.push(level));

  listeners.get("dictation-lifecycle-changed")?.(
    { sender: "ipc" },
    { state: "recording", inputKind: "dictation" }
  );
  listeners.get("dictation-level-changed")?.({ sender: "ipc" }, 0.3);
  await api.getDictationLifecycleState();
  await api.toggleDictationFromControlPanel();

  assert.deepEqual(states, [{ state: "recording", inputKind: "dictation" }]);
  assert.deepEqual(levels, [0.3]);
  assert.deepEqual(invocations, [
    ["get-dictation-lifecycle-state"],
    ["control-panel-toggle-dictation"],
  ]);
  offState();
  offLevel();
  assert.equal(listeners.has("dictation-lifecycle-changed"), false);
  assert.equal(listeners.has("dictation-level-changed"), false);
});

test("privacy bridge exposes the Sealed mode contract", async () => {
  const { api, invocations, listeners } = loadPreloadApi();
  await api.privacy.getSealed();
  await api.privacy.setSealed(true);
  await api.privacy.getAttestation();
  await api.privacy.listEgress({ since: 5 });
  await api.privacy.egressSummary({ since: 5 });
  await api.privacy.clearEgress();
  await api.privacy.exportEgressCsv();
  assert.deepEqual(invocations, [
    ["privacy:get-sealed"],
    ["privacy:set-sealed", true],
    ["privacy:attestation"],
    ["privacy:egress-list", { since: 5 }],
    ["privacy:egress-summary", { since: 5 }],
    ["privacy:egress-clear"],
    ["privacy:egress-export"],
  ]);
  const seen = [];
  const off = api.privacy.onSealedChange((sealed) => seen.push(sealed));
  listeners.get("privacy:sealed-changed")({}, true);
  off();
  assert.deepEqual(seen, [true]);
  assert.equal(listeners.has("privacy:sealed-changed"), false);
  const attestations = [];
  api.privacy.onAttestation((a) => attestations.push(a.version));
  listeners.get("privacy:attestation")({}, { version: 3 });
  assert.deepEqual(attestations, [3]);
  const notices = [];
  api.privacy.onEgress((n) => notices.push(n));
  listeners.get("privacy:egress-event")(
    {},
    { phase: "dispatched", task: "chat", targetId: "groq" }
  );
  assert.deepEqual(notices, [{ phase: "dispatched", task: "chat", targetId: "groq" }]);
});

test("every privacy event strips Electron identity and unsubscribes", () => {
  const { api, listeners } = loadPreloadApi();
  for (const [method, channel] of [
    ["onSealedChange", "privacy:sealed-changed"],
    ["onAttestation", "privacy:attestation"],
    ["onEgress", "privacy:egress-event"],
    ["onEgressCleared", "privacy:egress-cleared"],
  ]) {
    let args;
    const off = api.privacy[method]((...values) => {
      args = values;
    });
    const payload = { value: 1 };
    listeners.get(channel)({ sender: "secret-electron-event" }, payload);
    assert.equal(args.length, method === "onEgressCleared" ? 0 : 1);
    if (args.length) assert.equal(args[0], payload);
    off();
    assert.equal(listeners.has(channel), false);
  }
});
