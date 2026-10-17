const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { loadAudioManager } = require("./audioManager");
const { createRendererServer, installHookDom } = require("../../lib/rendererTestHarness");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
}
async function mountTrial(t, initialPrivate = true) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const settings = {
    useLocalWhisper: true,
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
    snippets: [],
    dataRetentionEnabled: true,
    audioRetentionDays: 30,
    saveDiscardedTranscriptions: true,
    autoPasteEnabled: true,
    keepTranscriptionInClipboard: true,
  };
  const { AudioManager, window } = await loadAudioManager(t, {
    cachePrefix: "loqui-trial-boundary-",
    settingsKey: "__trialBoundarySettings",
    settings,
  });
  const writes = [],
    events = [],
    managers = [];
  const listeners = {};
  const noop = () => () => {};
  window.electronAPI = {
    onToggleDictation: noop,
    onToggleVoiceAgent: noop,
    onToggleTranslation: noop,
    onStartDictation: noop,
    onPrepareDictation: (listener) => {
      listeners.prepare = listener;
      return () => {
        delete listeners.prepare;
      };
    },
    onCancelDictationPreparation: noop,
    onStopDictation: noop,
    recordAnalyticsEvent: async (...args) => writes.push(["analytics", ...args]),
    saveTranscription: async (...args) => (writes.push(["history", ...args]), { id: 1 }),
    saveTranscriptionAudio: async (...args) => writes.push(["audio", ...args]),
    writeClipboard: async (...args) => writes.push(["clipboard", ...args]),
  };
  let mic = deferred(),
    result = deferred(),
    acquisitions = 0,
    cleaned = 0;
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    constructor(stream) {
      this.stream = stream;
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["fixture audio".repeat(200)]) });
      return this.onstop?.();
    }
  }
  const oldRecorder = globalThis.MediaRecorder;
  globalThis.MediaRecorder = Recorder;
  t.after(() => {
    if (oldRecorder === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = oldRecorder;
    delete globalThis.__trialBoundaryCreate;
  });
  globalThis.__trialBoundaryCreate = () => {
    const manager = Object.assign(Object.create(AudioManager.prototype), {
      isRecording: false,
      isProcessing: false,
      isStreaming: false,
      sttConfig: {},
      voiceAgentRequested: false,
      translationRequested: false,
      preparedMicCapture: { take: async () => null, cancel() {} },
      getAudioConstraints: async () => ({}),
      _startPcmTap: () => null,
      _closeBatchPcmTap() {},
      _acquireCaptureStream: () => {
        acquisitions++;
        return mic.promise;
      },
      prepareMicCapture: async () => null,
      cacheMicrophoneDeviceId() {},
      cancelPreparedMicCapture() {},
      cleanup() {
        cleaned++;
        return AudioManager.prototype.cleanup.call(this);
      },
      setAssistantSelectionContext() {},
      micStreamHold: { touch() {}, drop() {} },
      micRecovery: { stop() {}, started: false },
      beginMicRecovery: async () => {},
      teardownSpeechGate() {},
      cleanupPreview: async () => {},
      getRecordingAudioLevel: () => null,
      shouldShowPreviewCleanupState: () => false,
      mergeRecordedSegments: async (blobs) => new Blob(blobs, { type: "audio/webm" }),
      processWithLocalWhisper: () => result.promise,
      getStreamingProvider: () => ({ stop() {} }),
      safePaste: async (...args) => writes.push(["paste", ...args]),
    });
    managers.push(manager);
    return manager;
  };
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-trial-real-hook-",
    noExternal: ["react-i18next"],
    mockModules: {
      "/helpers/audioManager":
        "export default class { constructor() { return globalThis.__trialBoundaryCreate(); } }",
      "/stores/settingsStore":
        "export const getSettings = () => globalThis.__trialBoundarySettings; export const useSettingsStore = { subscribe: () => () => {} };",
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
  let api;
  const toast = () => {};
  const onDemoEvent = (event) => events.push(event);
  function Harness({ privateMode, toastFn }) {
    api = useAudioRecording(toastFn, { trialMode: privateMode, onDemoEvent });
    return null;
  }
  root = createRoot(container);
  async function render(privateMode, toastFn = toast) {
    await React.act(async () =>
      root.render(React.createElement(Harness, { privateMode, toastFn }))
    );
  }
  await render(initialPrivate);
  return {
    AudioManager,
    window,
    writes,
    events,
    managers,
    prepare: (options) => listeners.prepare(options),
    manager: () => managers.at(-1),
    api: () => api,
    render,
    mic: () => mic,
    result: () => result,
    cleaned: () => cleaned,
    reset() {
      mic = deferred();
      result = deferred();
    },
    async waitAcquisition(count = 1) {
      for (let i = 0; i < 100 && acquisitions < count; i++) await flush();
      assert.equal(acquisitions, count);
    },
    async start(take = { demoId: "trial", takeId: "1" }) {
      let start;
      await React.act(async () => {
        start = api.startRecording({ onboardingTake: take });
        await this.waitAcquisition(acquisitions + 1);
      });
      return {
        finish: async () => {
          await React.act(async () => {
            mic.resolve({ getAudioTracks: () => [], getTracks: () => [] });
            await start;
          });
        },
      };
    },
  };
}
module.exports = { mountTrial, deferred, flush };

// The real streaming finalization boundary, initialized with captured audio as
// in audioManagerStreamingFinalization.test.js. Current streaming start has an
// inherited usesKeywords ReferenceError, so this fixture does not fake success.
function configureStreamingFinalization(h) {
  const manager = h.manager();
  manager.setPrivateSession(true);
  manager._captureRecordingPrivacy();
  Object.assign(manager, {
    isRecording: true,
    isStreaming: true,
    _activeStreamingSessionId: 1,
    streamingCleanupFns: [],
    recordingStartTime: Date.now(),
    _onboardingTake: { demoId: "stream-private", takeId: "3" },
    _streamingFallbackSegments: [new Blob(["private streamed audio"])],
    finishStreamingFallbackSegment: async () => null,
    getStreamingProvider: () => ({
      awaitsFinalTranscript: true,
      finalize() {},
      stop: async () => ({ success: true }),
    }),
    getStreamingProviderName: () => "fixture",
    awaitStreamingTextSettled: async () => {},
    processTranscription: async (text) => text,
  });
  return manager;
}
module.exports.configureStreamingFinalization = configureStreamingFinalization;
