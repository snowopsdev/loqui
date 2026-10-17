const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { loadAudioManager } = require("./harness/audioManager");
const { bridgeFixture } = require("./harness/onboardingBridgeFixture");
const { createRendererServer, installHookDom } = require("../lib/rendererTestHarness");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function mount(t) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const settings = {
    useLocalWhisper: true,
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
    snippets: [],
  };
  const { AudioManager, window } = await loadAudioManager(t, {
    cachePrefix: "loqui-onboarding-real-manager-",
    settingsKey: "__onboardingBridgeSettings",
    settings,
  });
  const f = bridgeFixture();
  window.electronAPI = f.overlayApi;
  let acquisition = deferred();
  let acquireCalls = 0;
  const manager = Object.assign(Object.create(AudioManager.prototype), {
    isRecording: false,
    isProcessing: false,
    isStreaming: false,
    sttConfig: {},
    voiceAgentRequested: false,
    translationRequested: false,
    preparedMicCapture: { take: async () => null },
    getAudioConstraints: async () => ({}),
    _startPcmTap: () => null,
    _acquireCaptureStream: () => {
      acquireCalls += 1;
      return acquisition.promise;
    },
    prepareMicCapture: async () => null,
    cacheMicrophoneDeviceId() {},
    cancelPreparedMicCapture() {},
    cleanup() {},
    setAssistantSelectionContext() {},
    micRecovery: { stop() {} },
    beginMicRecovery: async () => {},
    createBatchRecorder() {},
    setupSpeechGate() {},
    getRecordingAudioLevel: () => null,
  });
  globalThis.__onboardingBridgeManager = manager;
  t.after(() => {
    delete globalThis.__onboardingBridgeManager;
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-onboarding-real-hook-",
    noExternal: ["react-i18next"],
    mockModules: {
      "/helpers/audioManager":
        "export default class { constructor() { return globalThis.__onboardingBridgeManager; } }",
      "/stores/settingsStore":
        "export const getSettings = () => globalThis.__onboardingBridgeSettings; export const useSettingsStore = { subscribe: () => () => {} };",
      "/utils/logger": "export default { debug() {}, info() {}, warn() {}, error() {} };",
      "react-i18next": "const t = (key) => key; export const useTranslation = () => ({ t });",
    },
  });
  const { useAudioRecording } = await vite.ssrLoadModule("/hooks/useAudioRecording.js");
  const container = installHookDom(t);
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  let controls;
  const options = { onDemoEvent: (event) => f.overlayApi.publishOnboardingDemoEvent(event) };
  const toast = () => {};
  function Harness() {
    controls = useAudioRecording(toast, options);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  const waitForAcquisition = async (count) => {
    for (let i = 0; i < 100 && acquireCalls < count; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(acquireCalls, count);
  };
  return {
    f,
    manager,
    controls: () => controls,
    acquisition: () => acquisition,
    reset: () => {
      acquisition = deferred();
    },
    waitForAcquisition,
  };
}

test("real hook→AudioManager denied acquisition reaches current bridge before listening; old denial cannot enter reentered demo", async (t) => {
  const h = await mount(t);
  await h.f.setupApi.beginOnboardingDemo({ id: "A", kind: "dictation" });
  await React.act(async () => {
    await h.f.setupApi.toggleOnboardingDemo("A");
    await h.waitForAcquisition(1);
    h.acquisition().reject(new DOMException("fixture permission denied", "NotAllowedError"));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(
    h.f.broadcasts.map(([, event]) => event.status),
    ["error"]
  );
  assert.equal(h.f.broadcasts[0][1].demoId, "A");
  assert.equal(h.f.broadcasts[0][1].code, "NotAllowedError");
  h.reset();
  await h.f.setupApi.endOnboardingDemo("A");
  await h.f.setupApi.beginOnboardingDemo({ id: "B", kind: "dictation" });
  await React.act(async () => {
    await h.f.setupApi.toggleOnboardingDemo("B");
    await h.waitForAcquisition(2);
    await h.f.setupApi.endOnboardingDemo("B");
    await h.f.setupApi.beginOnboardingDemo({ id: "C", kind: "dictation" });
    h.acquisition().reject(new DOMException("old denied", "NotAllowedError"));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.f.broadcasts.length, 1, "B's late failure does not get relabelled as C");
});

test("deferred batch start after leave/reenter cannot publish listening or retain its opened recording", async (t) => {
  const h = await mount(t);
  // Audio graph/recorder primitives are fixtures; startRecording and the hook
  // remain production implementations. No real device or provider is opened.
  let stopped = 0;
  h.manager.getOrCreateAudioContext = async () => {
    throw new Error("fixture has no audio graph");
  };
  h.manager._closeBatchPcmTap = () => {};
  h.manager.cancelRecording = () => {
    stopped += 1;
    h.manager.isRecording = false;
    return true;
  };
  await h.f.setupApi.beginOnboardingDemo({ id: "A", kind: "dictation" });
  await React.act(async () => {
    await h.f.setupApi.toggleOnboardingDemo("A");
    await h.waitForAcquisition(1);
    await h.f.setupApi.endOnboardingDemo("A");
    await h.f.setupApi.beginOnboardingDemo({ id: "B", kind: "dictation" });
    h.acquisition().resolve({ getAudioTracks: () => [], getTracks: () => [] });
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.f.broadcasts.length, 0);
  assert.equal(stopped, 1, "the existing owner cancels the late-started recording");
  assert.equal(h.manager.isRecording, false);
});

test("real batch processing callback retains the admitted take across a deferred result", async (t) => {
  const h = await mount(t);
  await h.f.setupApi.beginOnboardingDemo({ id: "A", kind: "dictation" });
  let old;
  await React.act(async () => {
    old = h.f.manager.sendPrepareDictation();
  });
  const processing = deferred();
  h.manager._onboardingTake = old;
  h.manager.isProcessing = true;
  h.manager.processWithLocalWhisper = () => processing.promise;
  let run;
  await React.act(async () => {
    h.manager.onStateChange({ isRecording: true, isProcessing: false }, old);
    run = h.manager.processAudio(new Blob(["fixture"]));
    await h.f.setupApi.endOnboardingDemo("A");
    await h.f.setupApi.beginOnboardingDemo({ id: "B", kind: "dictation" });
    const next = h.f.manager.sendPrepareDictation();
    h.manager._onboardingTake = next;
    h.manager.onStateChange({ isRecording: true, isProcessing: false }, next);
    processing.resolve({ success: true, text: "old text", rawText: "um old text" });
    await run;
  });
  assert.deepEqual(
    h.f.broadcasts.map(([, event]) => [event.demoId, event.status]),
    [
      ["A", "listening"],
      ["B", "listening"],
    ]
  );
});

test("real streaming start denial carries its own identity before any listening", async (t) => {
  const h = await mount(t);
  h.manager.shouldUseStreaming = () => true;
  h.manager.getStreamingProviderName = () => "fixture";
  h.manager.cleanupStreaming = async () => {};
  h.manager._streamingStartSettlementWaiters = [];
  await h.f.setupApi.beginOnboardingDemo({ id: "stream", kind: "dictation" });
  await React.act(async () => {
    await h.f.setupApi.toggleOnboardingDemo("stream");
    await h.waitForAcquisition(1);
    h.acquisition().reject(new DOMException("denied", "NotAllowedError"));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(
    h.f.broadcasts.map(([, event]) => [event.demoId, event.status]),
    [["stream", "error"]]
  );
  assert.equal(h.f.broadcasts[0][1].code, "NotAllowedError");
  h.reset();
  await h.f.setupApi.endOnboardingDemo("stream");
  await h.f.setupApi.beginOnboardingDemo({ id: "old-stream", kind: "dictation" });
  await React.act(async () => {
    await h.f.setupApi.toggleOnboardingDemo("old-stream");
    await h.waitForAcquisition(2);
    await h.f.setupApi.endOnboardingDemo("old-stream");
    await h.f.setupApi.beginOnboardingDemo({ id: "new-stream", kind: "dictation" });
    h.acquisition().reject(new DOMException("late denied", "NotAllowedError"));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.f.broadcasts.length, 1, "old streaming failure stays rejected after reentry");
});
