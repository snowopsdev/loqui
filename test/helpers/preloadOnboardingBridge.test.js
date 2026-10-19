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
