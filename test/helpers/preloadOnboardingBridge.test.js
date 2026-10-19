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
