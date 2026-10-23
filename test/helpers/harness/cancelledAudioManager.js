// Shared real-manager cancel/restore fixture. Device, STT and persistence leaves
// are synthetic; buffer/context/tracker, ownership and teardown stay real.
const { loadAudioManager } = require("./audioManager");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const RETAIN = {
  saveDiscardedTranscriptions: true,
  dataRetentionEnabled: true,
  audioRetentionDays: 30,
};
const LOCAL = {
  useLocalWhisper: true,
  localTranscriptionProvider: "nvidia",
  parakeetModel: "parakeet-tdt-0.6b-v3",
  cloudTranscriptionProvider: "openai",
  transcriptionMode: "providers",
  useCleanupModel: false,
  saveDiscardedTranscriptions: false,
  dataRetentionEnabled: true,
  audioRetentionDays: 30,
  openaiApiKey: "sk",
};

// 300-byte audio whose every byte is `fill`, so a test can tell segments apart.
const blob = (fill) => new Blob([new Uint8Array(300).fill(fill)], { type: "audio/webm" });
const firstByte = (bytes) => bytes[0];
const allZero = (bytes) => bytes.every((b) => b === 0);

async function setup(t, settings = LOCAL) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "openwhispr-cancel-buffer-",
    settingsKey: "__cancelBufferSettings",
    settings,
  });
  const { createUndoWindow } = await loaded.vite.ssrLoadModule("/helpers/cancelBuffer.js");
  // The real Task 6 context (markRestored, release, released), never a hand-made stand-in (R4-I1).
  const { createSessionContext } = await loaded.vite.ssrLoadModule("/helpers/dictationSession.js");
  let now = 0;
  let seq = 0;
  const pending = new Map();
  const clock = {
    now: () => now,
    setTimer: (fn, ms) => (pending.set(++seq, { fn, at: now + ms }), seq),
    clearTimer: (id) => pending.delete(id),
  };
  const advance = async (ms) => {
    now += ms;
    for (const [id, e] of [...pending]) if (e.at <= now) (pending.delete(id), e.fn());
    for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
  };
  const io = {
    merges: 0,
    mergeInputs: [],
    saves: 0,
    local: 0,
    byok: [],
    streamStarts: [],
    streamSends: 0,
    cancelled: [],
    closed: [],
  };
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    mergeAudioSegments: async (payload) => {
      io.merges += 1; // FFmpeg temp files in main
      io.mergeInputs.push(payload.map((p) => new Uint8Array(p.buffer)[0]));
      return {
        success: true,
        buffer: new Uint8Array(payload[0].buffer).buffer,
        mimeType: "audio/webm",
      };
    },
    transcribeAudioFileByok: async (p) => (io.byok.push(p), { success: true, text: "hi" }),
    cancelUploadTranscription: () => {},
    dismissDictationPreview: () => {},
  };
  const manager = Object.assign(Object.create(loaded.AudioManager.prototype), {
    _undoWindowFactory: (opts) => createUndoWindow({ ...clock, ...opts }),
    _readSealed: () => false, // the sealedStore seam (§5.4); the Sealed test overrides it
    _delay: (ms) => new Promise((resolve) => clock.setTimer(resolve, ms)),
    _now: () => now,
    _processingCancellationGeneration: 0,
    _streamingCancellationGeneration: 0,
    _streamingSessionGeneration: 0,
    _localSpeechGateState: null,
    _receivedAudioData: true,
    _batchSegments: [],
    audioChunks: [],
    micRecovery: { stop() {} },
    teardownSpeechGate() {},
    cleanupPreview() {},
    _closeBatchPcmTap() {},
    _markCaptureStreamReleased() {},
    onStateChange: () => {},
    onCancelledChange: (s, closed) => {
      io.cancelled.push(s);
      if (closed) io.closed.push(closed);
    },
    onTranscriptionComplete: () => {},
    saveDiscardedTranscription: async () => {
      io.saves += 1;
    },
    processWithLocalParakeet: async () => (
      (io.local += 1),
      { success: true, text: "hi", source: "local-parakeet" }
    ),
    processTranscription: async (text) => text,
  });
  // If a real method reaches another helper that needs a stub, add it above; keep the assertions.
  return { ...loaded, manager, io, advance, createSessionContext };
}

function startBatch(
  manager,
  segmentFills,
  chunkFill,
  { manualStop = false, private: isPrivate } = {}
) {
  if (isPrivate !== undefined) manager._recordingPrivate = isPrivate === true;
  manager.beginDictationSession({ streaming: false });
  manager.isRecording = true;
  manager.recordingStartTime = Date.now() - 2000;
  manager._batchSegments = segmentFills.map(blob);
  const recorder = {
    state: "recording",
    stream: null,
    onstop: null,
    // The real final dataavailable/onstop land after stop() returns.
    stop() {
      this.state = "inactive";
      if (!manualStop) setImmediate(() => this.onstop?.());
    },
    finish() {
      this.onstop?.();
    },
  };
  manager.mediaRecorder = recorder;
  manager.audioChunks = [blob(chunkFill)];
  return recorder;
}

// A real streaming Start with synthetic device leaves (worklet, stream, provider).
function installRealStreamingStart(manager, t) {
  const worklets = [];
  const streamingEgressStopped = manager._streamingEgressStopped ?? new Set();
  streamingEgressStopped.clear();
  const previous = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = { postMessage() {} };
      worklets.push(this);
    }
    connect() {}
    disconnect() {}
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previous;
  });

  const stream = {
    getAudioTracks: () => [{ getSettings: () => ({}) }],
    getTracks: () => [{ stop() {} }],
  };
  const source = { connect() {}, disconnect() {} };
  const sent = [];
  const provider = {
    onPartial: () => () => {},
    onFinal: () => () => {},
    onError: () => () => {},
    onSessionEnd: () => () => {},
    start: async () => ({ success: true }),
    send(frame) {
      sent.push([...new Int16Array(frame)]);
    },
    cancel: async () => ({}),
    stop: async () => ({}),
  };
  Object.assign(manager, {
    isRecording: false,
    isProcessing: false,
    isStreaming: false,
    streamingStartInProgress: false,
    stopRequestedDuringStreamingStart: false,
    _streamingSessionGeneration: 0,
    _activeStreamingSessionId: null,
    _streamingCancellationGeneration: 0,
    _streamingEgressStopped: streamingEgressStopped,
    _streamingStopPromise: null,
    _streamingStopMode: null,
    _streamingStartSettlementWaiters: [],
    _activeTranscriptionAbortController: null,
    streamingCleanupFns: [],
    streamingTextDebounce: null,
    streamingFallbackRecorder: null,
    streamingFallbackChunks: [],
    _streamingFallbackSegments: [],
    preparedMicCapture: { take: async () => null, cancel() {} },
    getAudioConstraints: async () => ({}),
    _acquireCaptureStream: async () => stream,
    startStreamingFallbackRecorder() {},
    getOrCreateAudioContext: async () => ({
      createMediaStreamSource: () => source,
      createAnalyser: () => ({}),
      audioWorklet: { addModule: async () => {} },
    }),
    getWorkletBlobUrl: () => "",
    workletModuleLoaded: false,
    getStreamingProviderName: () => "openai-realtime",
    getStreamingProvider: () => provider,
    getEffectiveSttLanguage: () => "auto",
    getKeyterms: () => [],
    beginMicRecovery: async () => {},
    cleanupStreamingAudio() {},
    cleanupStreamingListeners() {},
    _markCaptureStreamReleased() {},
  });
  return { worklets, sent, provider };
}

// A manager mid-streaming-capture with held frames, for streaming cancel and replay tests.
function streamingManager(manager, streamingProviderName = "openai-realtime") {
  manager.beginDictationSession({ streaming: true, streamingProviderName });
  manager._sessionAudio = {
    session: manager.activeSession,
    kind: "streaming",
    frames: [new Int16Array([1, 2]), new Int16Array([3])],
    fallbackChunks: [blob(5)],
    fallbackSegments: [],
    mimeType: "audio/webm",
    durationSeconds: null,
    analyticsOccurredAt: "2026-10-20T12:00:00.000Z",
  };
  manager.isStreaming = true;
  manager.recordingStartTime = Date.now() - 40_000;
  manager.cleanupStreamingAudio = () => {};
  manager.cleanupStreamingListeners = () => {};
  manager.getStreamingProvider = () => ({ stop: async () => ({}) });
  manager._streamingTransport = {
    adapter: manager.getStreamingProvider(),
    operation: manager._streamingOperation,
    closed: false,
  };
}

module.exports = {
  deferred,
  RETAIN,
  LOCAL,
  blob,
  firstByte,
  allZero,
  setup,
  startBatch,
  installRealStreamingStart,
  streamingManager,
};
