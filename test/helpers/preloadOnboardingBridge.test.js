const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPreloadApi() {
  let exposedApi;
  const invocations = [];
  const sends = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke: async (channel, ...args) => {
      invocations.push([channel, ...args]);
      return true;
    },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    send: (channel, ...args) => sends.push([channel, ...args]),
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

test("onboarding demo bridge invokes only its allowlisted channels", async () => {
  const { api, invocations } = loadPreloadApi();
  const session = { id: "demo-7", kind: "dictation" };
  const event = { kind: "dictation", status: "success", text: "Hello" };

  await api.beginOnboardingDemo(session);
  await api.publishOnboardingDemoEvent(event);
  await api.stopOnboardingDemo(session.id);
  await api.endOnboardingDemo(session.id);

  assert.deepEqual(invocations, [
    ["onboarding-demo-begin", session],
    ["onboarding-demo-publish", event],
    ["onboarding-demo-stop", session.id],
    ["onboarding-demo-end", session.id],
  ]);
});

test("onboarding active bridge invokes only its allowlisted channel", async () => {
  const { api, invocations } = loadPreloadApi();

  await api.setOnboardingActive(true);
  await api.setOnboardingActive(false);

  assert.deepEqual(invocations, [
    ["onboarding-set-active", true],
    ["onboarding-set-active", false],
  ]);
});

test("macOS accessibility readiness forwards an optional account scope", () => {
  const { api, sends } = loadPreloadApi();
  const expectedAccountScope = { accountId: "account-a", authGeneration: 3 };

  api.markMacAccessibilityFeaturesReady();
  api.markMacAccessibilityFeaturesReady(expectedAccountScope);

  assert.deepEqual(sends, [
    ["mac-accessibility-features-ready"],
    ["mac-accessibility-features-ready", expectedAccountScope],
  ]);
});

test("onboarding demo listener strips the Electron event and disposes cleanly", () => {
  const { api, listeners } = loadPreloadApi();
  const payload = {
    demoId: "demo-7",
    kind: "dictation",
    status: "partial",
    text: "Hello",
  };
  let received;
  const unsubscribe = api.onOnboardingDemoEvent((event) => {
    received = event;
  });

  listeners.get("onboarding-demo-event")?.({ sender: "ipc" }, payload);

  assert.equal(received, payload);
  unsubscribe();
  assert.equal(listeners.has("onboarding-demo-event"), false);
});

test("Undo and flush preload APIs strip events, reply on exact channels and unsubscribe", () => {
  const { api, sends, listeners } = loadPreloadApi();
  const request = { token: 7, sessionId: "A", deadlineAt: 1500 };
  let undo, flush;
  const offUndo = api.onUndoCancelRequest((req) => {
    undo = req;
  });
  const offFlush = api.onDictationFlushRequest((req) => {
    flush = req;
  });
  listeners.get("undo-cancel-request")({}, request);
  listeners.get("dictation-flush-request")({}, { token: 8 });
  assert.equal(undo, request);
  assert.equal(flush.token, 8);
  const result = { restored: false, sessionId: "A", reason: "expired" };
  api.replyUndoCancel(7, result);
  api.replyDictationFlush(8);
  assert.deepEqual(sends, [
    ["undo-cancel-reply", 7, result],
    ["dictation-flush-reply", 8, true],
  ]);
  offUndo();
  offFlush();
  assert.equal(listeners.has("undo-cancel-request"), false);
  assert.equal(listeners.has("dictation-flush-request"), false);
});

test("meeting presence/outcome/stop/reveal preload APIs use exact channels and strip Electron events", async () => {
  const { api, invocations, listeners, sends } = loadPreloadApi();
  const presence = { recording: true, sessionId: "A", startedAt: 1000 };
  const outcome = { sessionId: "A", kind: "failed", reason: "save" };
  api.reportMeetingRecordingPresence(presence);
  api.reportMeetingRecordingOutcome(outcome);
  await api.getMeetingRecordingPresence();
  await api.requestStopMeetingRecording("A");
  assert.deepEqual(sends, [
    ["meeting-recording-presence", presence],
    ["meeting-recording-outcome", outcome],
  ]);
  assert.deepEqual(invocations, [
    ["get-meeting-recording-presence"],
    ["request-stop-meeting-recording", "A"],
  ]);
  for (const [method, channel, payload] of [
    ["onMeetingRecordingPresenceChanged", "meeting-recording-presence-changed", presence],
    ["onMeetingRecordingOutcome", "meeting-recording-outcome", outcome],
    ["onMeetingRecordingStopRequested", "meeting-recording-stop-requested", "A"],
    ["onMeetingRecorderRevealRequested", "meeting-recorder-reveal-requested", "A"],
  ]) {
    let received;
    const off = api[method]((value) => {
      received = value;
    });
    listeners.get(channel)({ sender: "electron-event" }, payload);
    assert.equal(received, payload);
    off();
    assert.equal(listeners.has(channel), false);
  }
});

test("system profile bridge invokes only its channel", async () => {
  const { api, invocations } = loadPreloadApi();
  await api.getSystemProfile();
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0][0], "get-system-profile");
});

test("trial controls invoke only their channels with the demo id", async () => {
  const { api, invocations } = loadPreloadApi();
  await api.toggleOnboardingDemo("demo-7");
  await api.cancelOnboardingDemo("demo-7");
  await api.undoOnboardingDemoCancel("demo-7");
  assert.deepEqual(invocations, [
    ["onboarding-demo-toggle", "demo-7"],
    ["onboarding-demo-cancel", "demo-7"],
    ["onboarding-demo-undo-cancel", "demo-7"],
  ]);
});

test("hotkey listener strips the Electron event and disposes cleanly", () => {
  const { api, listeners } = loadPreloadApi();
  const payload = { phase: "down", at: 5 };
  let received;
  const unsubscribe = api.onDictationHotkeyEvent((event) => {
    received = event;
  });
  listeners.get("dictation-hotkey-event")?.({ sender: "ipc" }, payload);
  assert.equal(received, payload);
  unsubscribe();
  assert.equal(listeners.has("dictation-hotkey-event"), false);
});

test("captured cleanup relay forwards exact typed selectors/replies and disposes owner listeners", async () => {
  const { api, invocations, listeners } = loadPreloadApi();
  const identity = { demoId: "demo", takeId: "take", operationId: "cleanup-operation" };
  const reply = { ...identity, requestId: "request", text: "Fixture." };
  await api.retryOnboardingCleanup(identity);
  await api.replyOnboardingCleanup(reply);
  assert.deepEqual(invocations, [
    ["onboarding-cleanup-retry", identity],
    ["onboarding-cleanup-reply", reply],
  ]);
  let received;
  const off = api.onOnboardingCleanupRetry((value) => {
    received = value;
  });
  listeners.get("onboarding-cleanup-retry")({ sender: "ipc" }, reply);
  assert.equal(received, reply);
  off();
  assert.equal(listeners.has("onboarding-cleanup-retry"), false);
  const retired = api.onOnboardingCleanupRetired((value) => {
    received = value;
  });
  listeners.get("onboarding-cleanup-retired")({}, identity);
  assert.equal(received, identity);
  retired();
  assert.equal(listeners.has("onboarding-cleanup-retired"), false);
});

test("admission and scoped stop/cancel/preparation payloads survive actual preload without Electron authority", async () => {
  const { api, listeners, invocations } = loadPreloadApi();
  const identity = { demoId: "A", requestId: "nonce" };
  const request = { ...identity, kind: "dictation", deadlineAt: 2000 };
  const take = { demoId: "A", takeId: "17", reservationId: "nonce" };
  const seen = [];
  const disposers = [
    api.onOnboardingDemoAdmission((value) => seen.push(value)),
    api.onOnboardingDemoReservation((value) => seen.push(value)),
    api.onStopDictation((value) => seen.push(value)),
    api.onCancelDictationPreparation((value) => seen.push(value)),
    api.onCancelDictation((value) => seen.push(value)),
  ];
  listeners.get("onboarding-demo-admission")({ sender: "must strip" }, request);
  listeners.get("onboarding-demo-reservation")({}, { ...identity, action: "release" });
  for (const channel of ["stop-dictation", "cancel-dictation-preparation", "cancel-dictation"])
    listeners.get(channel)({}, { onboardingTake: take });
  assert.deepEqual(seen, [
    request,
    { ...identity, action: "release" },
    ...Array(3).fill({ onboardingTake: take }),
  ]);
  await api.replyOnboardingDemoAdmission({ ...identity, accepted: true });
  await api.invalidateOnboardingDemoAdmission(identity);
  await api.stopOnboardingDemo("A", "17");
  await api.toggleOnboardingDemo("A", "17");
  await api.cancelOnboardingDemo("A", "17");
  assert.deepEqual(invocations, [
    ["onboarding-demo-admission-reply", { ...identity, accepted: true }],
    ["onboarding-demo-admission-invalidated", identity],
    ["onboarding-demo-stop", "A", "17"],
    ["onboarding-demo-toggle", "A", "17"],
    ["onboarding-demo-cancel", "A", "17"],
  ]);
  disposers.forEach((dispose) => dispose());
  assert.equal(listeners.size, 0);
});

test("actual preload passive Codex catalog read invokes no active status/discovery channel", async () => {
  const { api, invocations, sends } = loadPreloadApi();
  await api.personalInference.codexModelCatalog();
  assert.deepEqual(invocations, [["personal-inference:codex-model-catalog"]]);
  assert.deepEqual(sends, []);
});

test("actual preload carries canonical streaming operation on all sends/finalizes/stops", async () => {
  const { api, invocations, sends } = loadPreloadApi();
  const operation = { correlationId: "A", dictationSessionId: "A", operationId: "attempt-A" };
  for (const [name, prefix, finalize] of [
    ["dictationRealtime", "dictation-realtime"],
    ["deepgramStreaming", "deepgram-streaming", "Finalize"],
    ["assemblyAiStreaming", "assemblyai-streaming", "ForceEndpoint"],
    ["geminiStreaming", "gemini-streaming", "Finalize"],
    ["cortiStreaming", "corti-streaming", "Finalize"],
  ]) {
    const frame = new ArrayBuffer(2);
    api[name + "Send"](frame, operation);
    assert.deepEqual(sends.at(-1), [prefix + "-send", frame, operation]);
    if (finalize) {
      api[name + finalize](operation);
      assert.deepEqual(sends.at(-1), [
        prefix + (finalize === "ForceEndpoint" ? "-force-endpoint" : "-finalize"),
        operation,
      ]);
    }
    await api[name + "Stop"](operation);
    assert.deepEqual(invocations.at(-1), [prefix + "-stop", operation]);
  }
});
