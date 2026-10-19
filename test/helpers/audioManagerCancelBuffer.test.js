const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");
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

test("two segments, retention off: no merge, no write, every byte zeroed (C1)", async (t) => {
  const { manager, io, advance } = await setup(t);
  startBatch(manager, [1, 2], 3);
  manager.cancelRecording();
  await advance(0);
  assert.equal(io.cancelled.at(-1).sessionId, manager._undo.peek().session.id);
  const held = manager._undo.peek();
  await held.ready();
  const views = held.bytes("segment");
  assert.deepEqual(views.map(firstByte), [1, 2, 3]);
  await advance(5000);
  assert.equal(io.merges, 0, "FFmpeg (temp files) never ran");
  assert.equal(io.saves, 0);
  assert.ok(views.every(allZero), "zeroed");
  assert.equal(io.cancelled.at(-1), null);
  assert.deepEqual(io.closed.at(-1), { sessionId: held.session.id, reason: "expired" });
});

test("retention on: expiry merges and saves exactly once, then zeroes", async (t) => {
  const { manager, io, advance, setSettings } = await setup(t, { ...LOCAL, ...RETAIN });
  setSettings({ ...LOCAL, ...RETAIN });
  startBatch(manager, [1, 2], 3);
  manager.cancelRecording();
  await advance(5000);
  assert.equal(io.merges, 1, "the merge is allowed only because retention saves discarded audio");
  assert.equal(io.saves, 1);
});

test("only the cancelled session's lastAudioBlob is released (I1)", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [], 2);
  manager.lastAudioBlob = blob(9);
  manager._lastAudioSessionId = manager.activeSession.id;
  manager.cancelRecording();
  await advance(0);
  assert.equal(manager.lastAudioBlob, null, "the cancelled session's audio is unreachable");
  assert.deepEqual(manager._batchSegments, []);
  assert.deepEqual(manager.audioChunks, []);

  const other = await setup(t);
  startBatch(other.manager, [], 2);
  const newer = blob(7);
  other.manager.lastAudioBlob = newer;
  other.manager._lastAudioSessionId = "a-different-session";
  other.manager.cancelRecording();
  await other.advance(5000);
  assert.equal(other.manager.lastAudioBlob, newer, "another session's audio is never cleared");
});

test("a cancel during the segment merge holds the raw segments (merge-time cancel)", async (t) => {
  const { manager, io, advance } = await setup(t);
  manager.beginDictationSession({ streaming: false });
  manager.isRecording = true;
  manager.recordingStartTime = Date.now() - 2000;
  manager._batchSegments = [blob(1), blob(2)];
  const merge = deferred();
  manager.mergeRecordedSegments = () => merge.promise;
  const finalizing = manager.finalizeBatchRecording(null);
  await advance(0);
  assert.equal(manager.cancelProcessing(), true);
  await advance(0);
  const held = manager._undo.peek();
  await held.ready();
  assert.equal(held.kind, "batch");
  assert.deepEqual(held.bytes("segment").map(firstByte), [1, 2]);
  merge.resolve(blob(3));
  await finalizing;
  assert.equal(io.local, 0, "the abandoned pipeline transcribed nothing");
});

test("a cancel during transcription holds the raw segments, not the merged blob", async (t) => {
  const { manager, advance } = await setup(t);
  manager.beginDictationSession({ streaming: false });
  manager.isRecording = true;
  manager.recordingStartTime = Date.now() - 2000;
  manager._batchSegments = [blob(4)];
  const stt = deferred();
  manager.processWithLocalParakeet = () => stt.promise;
  const finalizing = manager.finalizeBatchRecording(null);
  await advance(0);
  assert.equal(manager.cancelProcessing(), true);
  await advance(0);
  const held = manager._undo.peek();
  await held.ready();
  assert.deepEqual(held.bytes("segment").map(firstByte), [4]);
  assert.equal(manager._sessionAudio ?? null, null, "the session's audio references were released");
  stt.resolve({ success: true, text: "late" });
  await finalizing;
});

test("a cancel during startup, before any audio exists, offers nothing to undo", async (t) => {
  const { manager, io, advance } = await setup(t);
  manager.cancelRecording(); // no recorder, not recording
  await advance(0);
  assert.equal(io.cancelled.length, 0);
  assert.equal(manager._undo?.peek() ?? null, null);
});

test("Undo restores through the session's route even after settings move to a provider (C2)", async (t) => {
  const { manager, io, advance, setSettings } = await setup(t);
  startBatch(manager, [], 3);
  const sessionId = manager.activeSession.id;
  manager.cancelRecording();
  await advance(0);
  setSettings({ ...LOCAL, useLocalWhisper: false }); // switch to OpenAI during the window
  const result = await manager.restoreCancelled(sessionId);
  assert.deepEqual(result, { restored: true, sessionId });
  await manager._restoreRun;
  assert.equal(io.local, 1);
  assert.equal(io.byok.length, 0, "local audio never left the device");
});

test("Undo announces the closed window before processing starts (§5.2 order, R1-I6)", async (t) => {
  const { manager, advance } = await setup(t);
  const order = [];
  manager.onCancelledChange = (state, closed) =>
    order.push(state ? "cancelled" : `closed:${closed?.reason}`);
  manager.onStateChange = (state) => state.isProcessing && order.push("processing");
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  await manager.restoreCancelled();
  // Both the preflight claim and the admitted session publish processing.
  assert.deepEqual(order.slice(-3), ["closed:restored", "processing", "processing"]);
  await manager._restoreRun;
});

test("Undo publishes the frozen session after preflight and before dispatch", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const original = manager._undo.peek().session;
  const published = [];
  manager.onStateChange = (state) => {
    if (state.isProcessing) published.push(manager.activeSession);
  };
  assert.equal((await manager.restoreCancelled()).restored, true);
  assert.deepEqual(published.slice(0, 2), [null, original]);
  await manager._restoreRun;
});

test("Undo is claimed synchronously: a start during a pending restore is rejected (I3)", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  const gate = deferred();
  held.ready = () => gate.promise;
  const restoring = manager.restoreCancelled();
  assert.equal(manager.isProcessing, true, "busy before any await");
  assert.equal(await manager.startRecording(), false);
  gate.resolve(true);
  await restoring;
  await manager._restoreRun;
});

test("Esc while a restore waits for its bytes cancels it and puts the recording back (I3)", async (t) => {
  const { manager, io, advance } = await setup(t);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  const gate = deferred();
  held.ready = () => gate.promise;
  const restoring = manager.restoreCancelled();
  manager.cancelProcessing(); // Esc
  gate.resolve(true);
  const result = await restoring;
  assert.equal(result.restored, false);
  assert.equal(manager.isProcessing, false);
  assert.equal(io.local, 0, "nothing was transcribed or pasted");
  assert.equal(manager._undo.peek(), held, "the recording is held again, not lost");
});

test("a restore whose bytes fail settles idle and says so", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  held.ready = async () => {
    throw new Error("boom");
  };
  const result = await manager.restoreCancelled();
  assert.equal(result.restored, false);
  assert.equal(result.reason, "noAudio");
  assert.equal(manager.isProcessing, false);
  assert.equal(held.isZeroed(), true);
});

test("Sealed mode refuses a non-device Undo and keeps the recording held", async (t) => {
  const { manager, advance } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  manager._readSealed = () => true;
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  assert.equal((await manager.restoreCancelled()).reason, "sealed");
  assert.equal(manager._undo.peek(), held, "content is preserved on refusal");
  assert.equal(held.isZeroed(), false);
  assert.equal(manager.isProcessing, false);
});

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
    analyticsOccurredAt: "x",
  };
  manager.isStreaming = true;
  manager.recordingStartTime = Date.now() - 40_000;
  manager.cleanupStreamingAudio = () => {};
  manager.cleanupStreamingListeners = () => {};
  manager.getStreamingProvider = () => ({ stop: async () => ({}) });
}

// §5.2 "Cancel stops further egress": each buffering provider's IPC names (preload, Task 7).
const STREAMING_IPC = {
  "openai-realtime": "dictationRealtime",
  "tinfoil-realtime": "dictationRealtime",
  deepgram: "deepgramStreaming",
  assemblyai: "assemblyAiStreaming",
  gemini: "geminiStreaming",
  corti: "cortiStreaming",
};

test("a streaming cancel tells the provider to drop its buffer at once, and Undo re-sends from the hold (§5.2)", async (t) => {
  for (const [providerName, ipc] of Object.entries(STREAMING_IPC)) {
    const { manager, advance, window: win } = await setup(t, { ...LOCAL, useLocalWhisper: false });
    const calls = [];
    for (const verb of ["Start", "Send", "Stop", "Cancel", "Finalize"]) {
      win.electronAPI[`${ipc}${verb}`] = () => {
        calls.push(verb);
        return verb === "Start" ? Promise.resolve({ success: true }) : Promise.resolve({});
      };
    }
    streamingManager(manager, providerName);
    delete manager.getStreamingProvider; // the real provider map, so the real cancel runs
    manager.isRecording = true;
    const cancelling = manager.cancelStreamingRecording();
    assert.equal(
      calls[0],
      "Cancel",
      `${providerName}: the cancel reaches main before anything else, without waiting for the start`
    );
    await cancelling;
    await advance(0);
    const held = manager._undo.peek();
    assert.equal(held.frames().length, 2, `${providerName}: the audio is held in RAM`);
    assert.equal(
      calls.includes("Send"),
      false,
      `${providerName}: nothing is sent after the cancel`
    );

    manager._attachStreamingListeners = () => {};
    manager._finalizeStreamingRecording = async () => {};
    calls.length = 0;
    assert.equal((await manager.restoreCancelled()).restored, true);
    await manager._restoreRun;
    assert.deepEqual(
      calls.filter((c) => c === "Send").length,
      2,
      `${providerName}: Undo re-sends both held frames`
    );
    assert.equal(calls.indexOf("Start") < calls.indexOf("Send"), true);
  }
});

test("a streaming cancel while recording holds the frames, with the long window for >30 s", async (t) => {
  const { manager, io, advance } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  const held = manager._undo.peek();
  assert.equal(held.kind, "streaming");
  assert.equal(held.frames().length, 2);
  assert.equal(
    io.cancelled.at(-1).remainingMs,
    10_000,
    "duration was read before recordingStartTime was cleared"
  );
});

test("a streaming cancel during finalization (Esc → cancelProcessing) holds the frames too (I2)", async (t) => {
  const { manager, advance } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  streamingManager(manager);
  manager.isProcessing = true;
  manager._streamingStopPromise = new Promise(() => {}); // finalization in flight
  manager._requestStreamingCancellation = () => {};
  assert.equal(manager.cancelProcessing(), true);
  await advance(0);
  assert.equal(manager._undo.peek().kind, "streaming");
});

test("streaming Undo replays the frames through the same provider and cleans up after itself", async (t) => {
  const {
    manager,
    io,
    advance,
    window: win,
  } = await setup(t, {
    ...LOCAL,
    useLocalWhisper: false,
    cloudTranscriptionModel: "gpt-4o-mini-transcribe",
  });
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  const held = manager._undo.peek();
  win.electronAPI.dictationRealtimeStart = async (opts) => (
    io.streamStarts.push(opts),
    { success: true }
  );
  win.electronAPI.dictationRealtimeSend = () => (io.streamSends += 1);
  win.electronAPI.dictationRealtimeStop = async () => ({});
  manager._finalizeStreamingRecording = async (sessionId, { replay } = {}) => {
    assert.equal(replay, true);
    assert.equal(typeof sessionId, "number");
  };
  manager._attachStreamingListeners = () => {};
  const result = await manager.restoreCancelled();
  assert.equal(result.restored, true);
  await manager._restoreRun;
  assert.equal(io.streamStarts[0].provider, "openai-realtime");
  assert.equal(io.streamStarts[0].correlationId, held.session.id);
  assert.equal(io.streamSends, 2);
  assert.equal(held.isZeroed(), true);
  assert.equal(manager.isStreaming, false, "a finished replay never leaves the manager stuck");
});

test("a replay that connects discloses nothing until main reports a forwarded frame (R1-I5)", async (t) => {
  const { manager, advance, window: win } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  // Main's hand-off channel (Task 7). Installed before the session starts, so its tracker subscribes.
  const bus = new EventEmitter();
  win.electronAPI.onDictationDispatch = (cb) => (bus.on("d", cb), () => bus.off("d", cb));
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  const held = manager._undo.peek();
  win.electronAPI.dictationRealtimeStart = async () => ({ success: true }); // a warm socket: connects at once
  win.electronAPI.dictationRealtimeSend = () => {};
  win.electronAPI.dictationRealtimeStop = async () => ({});
  manager._attachStreamingListeners = () => {};
  const finalizing = deferred();
  manager._finalizeStreamingRecording = () => finalizing.promise;
  assert.equal((await manager.restoreCancelled()).restored, true);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(
    held.tracker.get(),
    null,
    "a successful start is not a dispatch, and the renderer never claims one"
  );
  bus.emit("d", { correlationId: "another-session", task: "dictationStt", payload: "audio" });
  assert.equal(held.tracker.get(), null, "another session's hand-off does not count");
  bus.emit("d", { correlationId: held.session.id, task: "dictationStt", payload: "audio" }); // main: the first frame left
  assert.equal(held.tracker.get().evidence, "dispatched");
  assert.equal(held.tracker.get().payload, "audio");
  finalizing.resolve(true);
  await manager._restoreRun;
  assert.equal(bus.listenerCount("d"), 0, "terminal success disposes the tracker subscription");
});

test("a replay whose provider refuses to start leaves the manager usable and re-holds the audio", async (t) => {
  const {
    manager,
    io,
    advance,
    window: win,
  } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  win.electronAPI.dictationRealtimeStart = async () => ({ success: false, error: "429" });
  win.electronAPI.dictationRealtimeStop = async () => ({});
  manager._attachStreamingListeners = () => {};
  await manager.restoreCancelled();
  await manager._restoreRun;
  assert.equal(manager.isStreaming, false);
  assert.equal(manager.isProcessing, false);
  assert.equal(manager._undo.peek()?.kind, "streaming", "the audio is offered for Undo again");
  assert.equal(io.streamSends, 0);
});

test("every failed streaming replay re-holds its full copy and a second Undo works", async (t) => {
  for (const failure of ["send", "finalizeThrows", "finalizeFalse"]) {
    const { manager, advance, window: win } = await setup(t, { ...LOCAL, useLocalWhisper: false });
    streamingManager(manager);
    const session = manager.activeSession;
    const context = manager._sessionContext;
    const tracker = manager._disclosure;
    manager.isRecording = true;
    await manager.cancelStreamingRecording();
    await advance(0);
    const original = manager._undo.peek();
    let shutdownHeld;
    win.electronAPI.dictationRealtimeStart = async () => ({ success: true });
    win.electronAPI.dictationRealtimeCancel = () => {};
    win.electronAPI.dictationRealtimeSend = () => {
      if (failure === "send") throw new Error("send failed");
    };
    win.electronAPI.dictationRealtimeStop = async () => {
      shutdownHeld = manager._undo.peek(); // recovery precedes even this await
      assert.equal(original.isZeroed(), true, "provider shutdown retains no original PCM");
      assert.equal(manager._sessionAudio, null, "the new hold is the sole owner");
      return {};
    };
    manager._attachStreamingListeners = () => {};
    manager._finalizeStreamingRecording = async () => {
      if (failure === "finalizeThrows") throw new Error("finalize failed");
      return false;
    };
    await manager.restoreCancelled();
    await manager._restoreRun;
    const retry = manager._undo.peek();
    await retry.ready();
    assert.equal(original.isZeroed(), true, failure);
    assert.notEqual(retry, original, failure);
    assert.equal(shutdownHeld, retry, failure);
    assert.deepEqual(
      retry.frames().map((f) => [...f]),
      [[1, 2], [3]],
      failure
    );
    assert.equal(retry.session, session, failure);
    assert.equal(retry.context, context, failure);
    assert.equal(retry.tracker, tracker, failure);
    assert.equal(context.released, false, failure);
    assert.equal(manager._sessionAudio, null, "the hold is now the sole owner");
    assert.equal(manager.isStreaming, false, failure);
    assert.equal(manager.isProcessing, false, failure);

    const sent = [];
    win.electronAPI.dictationRealtimeSend = (frame) => sent.push([...new Int16Array(frame)]);
    manager._finalizeStreamingRecording = async () => true;
    assert.equal((await manager.restoreCancelled()).restored, true, failure);
    await manager._restoreRun;
    assert.deepEqual(sent, [[1, 2], [3]], failure);
    assert.equal(retry.isZeroed(), true, failure);
    assert.equal(manager._sessionAudio, null, failure);
    assert.equal(manager._undo.peek(), null, failure);
  }
});

test("a slow provider shutdown retains no original PCM past the retry window", async (t) => {
  const { manager, advance, window: win } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  const original = manager._undo.peek();
  const stopping = deferred();
  win.electronAPI.dictationRealtimeStart = async () => ({ success: true });
  win.electronAPI.dictationRealtimeCancel = () => {};
  win.electronAPI.dictationRealtimeSend = () => {
    throw new Error("send failed");
  };
  win.electronAPI.dictationRealtimeStop = () => stopping.promise;
  manager._attachStreamingListeners = () => {};
  assert.equal((await manager.restoreCancelled()).restored, true);
  await advance(0); // the failed send re-holds before stop settles
  const retry = manager._undo.peek();
  const frames = retry.frames();
  assert.equal(original.isZeroed(), true);
  assert.equal(manager._sessionAudio, null);
  await advance(10_000); // >30s take, retention off, provider still hasn't stopped
  assert.equal(retry.isZeroed(), true);
  assert.ok(frames.every(allZero));
  assert.equal(manager._undo.peek(), null);
  stopping.resolve({});
  await manager._restoreRun;
});

test("a private hold is never persisted, and its restore stays private (§5.2)", async (t) => {
  const { manager, io, advance, setSettings } = await setup(t, { ...LOCAL, ...RETAIN });
  setSettings({ ...LOCAL, ...RETAIN });
  startBatch(manager, [], 3, { private: true });
  manager.cancelRecording();
  await advance(5000);
  assert.equal(io.saves, 0, "retention on, but private");

  startBatch(manager, [], 4, { private: true });
  manager.cancelRecording();
  await advance(0);
  manager._recordingPrivate = false; // a later, non-private recording changed the flag
  await manager.restoreCancelled();
  assert.equal(manager._recordingPrivate, true);
  await manager._restoreRun;
});

test("an immediate Undo waits for the recorder's final chunk instead of calling it empty (R2-C1)", async (t) => {
  const { manager, io, advance } = await setup(t);
  const rec = startBatch(manager, [1], 3, { manualStop: true });
  manager.cancelRecording();
  const restoring = manager.restoreCancelled(); // before onstop
  await advance(0);
  rec.finish(); // the final dataavailable/onstop
  const result = await restoring;
  assert.equal(result.restored, true);
  await manager._restoreRun;
  assert.deepEqual(io.mergeInputs[0], [1, 3], "the earlier segment and the tail");
  assert.equal(io.local, 1);

  const single = await setup(t);
  const rec2 = startBatch(single.manager, [], 4, { manualStop: true });
  single.manager.cancelRecording();
  const restoring2 = single.manager.restoreCancelled();
  rec2.finish();
  assert.equal((await restoring2).restored, true, "one segment: not reported empty");
  await single.manager._restoreRun;
  assert.equal(single.io.local, 1);
});

test("a final chunk that never arrives: Undo keeps the hold unzeroed, and a late chunk still lands (R2-C1)", async (t) => {
  const { manager, advance } = await setup(t);
  const rec = startBatch(manager, [], 3, { manualStop: true });
  manager.cancelRecording();
  const held = manager._undo.peek();
  const restoring = manager.restoreCancelled();
  await advance(5000); // FINAL_AUDIO_WAIT_MS
  const result = await restoring;
  assert.deepEqual([result.restored, result.reason], [false, "noAudio"]);
  assert.equal(manager._undo.peek(), held, "back in its window");
  assert.equal(held.isZeroed(), false);
  assert.equal(manager.isProcessing, false);
  rec.finish();
  await advance(0);
  assert.deepEqual(held.bytes("segment").map(firstByte), [3]);
});

test("expiry before the final chunk, retention off: zeroed at the deadline, the late chunk is never kept", async (t) => {
  const { manager, advance } = await setup(t);
  const rec = startBatch(manager, [1], 3, { manualStop: true });
  manager.cancelRecording();
  await advance(0);
  const held = manager._undo.peek();
  const early = held.bytes("segment");
  await advance(5000);
  assert.ok(early.every(allZero));
  assert.equal(held.isZeroed(), true);
  rec.finish();
  await advance(0);
  assert.deepEqual(held.bytes("segment"), [], "zeroed on arrival");
});

test("expiry zeroes at the deadline even when a copy never settles (R1-I1)", async (t) => {
  const never = { arrayBuffer: () => new Promise(() => {}) };
  const broken = {
    arrayBuffer: async () => {
      throw new Error("gone");
    },
  };

  // Retention off: nothing will be saved, so zero now.
  const off = await setup(t);
  startBatch(off.manager, [1], 3);
  off.manager.cancelRecording();
  await off.advance(0);
  const heldOff = off.manager._undo.peek();
  heldOff.adoptBlob(never, "segment");
  heldOff.adoptBlob(broken, "segment");
  const viewsOff = heldOff.bytes("segment");
  await off.advance(5000);
  assert.ok(viewsOff.every(allZero));
  assert.equal(heldOff.isZeroed(), true);

  // Private, retention on: never persisted, zeroed at the deadline too.
  const priv = await setup(t, { ...LOCAL, ...RETAIN });
  priv.setSettings({ ...LOCAL, ...RETAIN });
  startBatch(priv.manager, [1], 3, { private: true });
  priv.manager.cancelRecording();
  await priv.advance(0);
  const heldPriv = priv.manager._undo.peek();
  heldPriv.adoptBlob(never, "segment");
  await priv.advance(5000);
  assert.equal(heldPriv.isZeroed(), true);
  assert.equal(priv.io.saves, 0);

  // Retention on: a bounded wait, then the bytes that arrived are saved and zeroed.
  const on = await setup(t, { ...LOCAL, ...RETAIN });
  on.setSettings({ ...LOCAL, ...RETAIN });
  startBatch(on.manager, [1], 3);
  on.manager.cancelRecording();
  await on.advance(0);
  const heldOn = on.manager._undo.peek();
  heldOn.adoptBlob(never, "segment");
  const viewsOn = heldOn.bytes("segment");
  await on.advance(5000);
  assert.equal(heldOn.isZeroed(), false, "waiting, bounded, for the stuck copy");
  await on.advance(3000); // CLOSE_SAVE_WAIT_MS
  assert.equal(on.io.saves, 1);
  assert.ok(viewsOn.every(allZero));
  assert.equal(heldOn.isZeroed(), true);
});

test("Esc, then a new recording, while an Undo waits: the old restore touches neither (R1-I3)", async (t) => {
  for (const settle of ["resolve", "reject"]) {
    const { manager, advance } = await setup(t);
    const states = [];
    manager.onStateChange = (state) => states.push(state);
    startBatch(manager, [], 3);
    manager.cancelRecording();
    await advance(0);
    const held = manager._undo.peek();
    const gate = deferred();
    held.ready = () => gate.promise;
    const restoring = manager.restoreCancelled();
    manager.cancelProcessing(); // Esc
    startBatch(manager, [], 5); // a new recording starts
    const before = states.length;
    if (settle === "resolve") gate.resolve(true);
    else gate.reject(new Error("copy failed"));
    const result = await restoring;
    await advance(0);
    assert.equal(result.restored, false);
    assert.equal(manager.isRecording, true, `${settle}: the new recording is untouched`);
    assert.equal(states.length, before, `${settle}: no idle broadcast from the old restore`);
    assert.equal(
      manager._undo.peek(),
      null,
      `${settle}: the old recording does not take the window`
    );
    assert.equal(
      held.isZeroed(),
      true,
      `${settle}: retention off, it closed as a newer start closes a window`
    );
  }
});

test("a merge failure during Undo settles idle and puts the recording back (R2-C2)", async (t) => {
  const { manager, advance } = await setup(t);
  startBatch(manager, [1, 2], 3);
  manager.cancelRecording();
  await advance(0);
  manager.mergeRecordedSegments = async () => {
    throw new Error("ffmpeg failed");
  };
  const errors = [];
  manager.onError = (error) => errors.push(error);
  assert.equal((await manager.restoreCancelled()).restored, true);
  await manager._restoreRun;
  await advance(0);
  assert.equal(manager.isProcessing, false, "never stuck busy");
  assert.equal(errors.length, 1);
  const again = manager._undo.peek();
  assert.ok(await again.ready());
  assert.deepEqual(again.bytes("segment").map(firstByte).sort(), [1, 2, 3]);
});

test("an STT or Sealed failure during Undo keeps the audio, retention on or off (R2-C2)", async (t) => {
  for (const retention of [true, false]) {
    const settings = { ...LOCAL, dataRetentionEnabled: retention };
    const { manager, advance, window: win, setSettings } = await setup(t, settings);
    setSettings(settings);
    const saved = [];
    win.electronAPI.saveTranscription = async (...args) => (saved.push(args), { id: 1 });
    win.electronAPI.saveTranscriptionAudio = async () => ({ success: true });
    startBatch(manager, [], 3);
    manager.cancelRecording();
    await advance(0);
    let ownedAtDispatch = false;
    manager.processWithLocalParakeet = async (audio) => {
      // Plan 07's _noteSealedFailure and the failure path both read lastAudioBlob.
      ownedAtDispatch =
        manager.lastAudioBlob === audio && manager._lastAudioSessionId === manager.activeSession.id;
      // Sealing landed between the pre-check and dispatch; main refuses the request.
      throw Object.assign(new Error("Blocked by Sealed mode"), { code: "SEALED_MODE" });
    };
    await manager.restoreCancelled();
    await manager._restoreRun;
    await advance(0);
    assert.equal(ownedAtDispatch, true, `retention ${retention}: owned before provider work`);
    assert.equal(manager.isProcessing, false);
    if (retention) {
      assert.equal(saved.length, 1, "a failed history row with its audio, as for any dictation");
      assert.equal(manager._undo.peek(), null);
    } else {
      assert.equal(manager._undo.peek()?.kind, "batch", "re-held: nothing else keeps it");
    }
  }
});

test("a flush joins an expiry or replacement save that is already running (R1-I9)", async (t) => {
  const { manager, io, advance, setSettings } = await setup(t, { ...LOCAL, ...RETAIN });
  setSettings({ ...LOCAL, ...RETAIN });
  const save = deferred();
  manager.saveDiscardedTranscription = () => (io.saves++, save.promise);
  startBatch(manager, [], 3);
  manager.cancelRecording();
  await advance(5000); // natural expiry; its save is pending
  assert.equal(io.saves, 1);
  let flushed = false;
  const flushing = manager.flushCancelHold().then(() => (flushed = true));
  await advance(0);
  assert.equal(flushed, false, "quit waits for the running save");
  save.resolve();
  await flushing;

  const replaced = await setup(t, { ...LOCAL, ...RETAIN });
  replaced.setSettings({ ...LOCAL, ...RETAIN });
  const first = deferred();
  replaced.manager.saveDiscardedTranscription = () => (replaced.io.saves++, first.promise);
  startBatch(replaced.manager, [], 3);
  replaced.manager.cancelRecording();
  await replaced.advance(0);
  startBatch(replaced.manager, [], 4);
  replaced.manager.cancelRecording(); // replaces the first window; its save starts
  await replaced.advance(0);
  let done = false;
  const quitting = replaced.manager.flushCancelHold().then(() => (done = true));
  await replaced.advance(3000);
  assert.equal(done, false, "the replaced window's save is joined too");
  first.resolve();
  await quitting;
  assert.equal(replaced.io.saves, 2);
});

test("a hold's press-time context is released when its window closes, and kept by a refusal that re-holds (R1-C2)", async (t) => {
  const { manager, advance, createSessionContext } = await setup(t, {
    ...LOCAL,
    useLocalWhisper: false,
  }); // a provider route, so Sealed refuses
  startBatch(manager, [], 3);
  const context = createSessionContext({ sessionId: manager.activeSession.id });
  manager._sessionContext = context;
  manager.cancelRecording();
  await advance(0);
  assert.equal(manager._undo.peek().context, context, "the hold owns the reads");
  manager._readSealed = () => true;
  assert.equal(
    await manager._sealedBlocks({ routes: null, intents: {}, settings: {} }),
    true,
    "unresolved routes fail closed"
  );
  assert.equal((await manager.restoreCancelled()).reason, "sealed");
  assert.equal(context.released, false, "a refusal that keeps the recording keeps its context");
  await advance(5000);
  assert.equal(context.released, true, "expiry releases it");
});

test("a failed restore keeps its session, route and context, and a second Undo succeeds (R2-C2)", async (t) => {
  const cases = [
    {
      name: "STT error, retention off",
      settings: { dataRetentionEnabled: false },
      error: () => new Error("provider 500"),
      held: true,
    },
    {
      name: "Sealed block without Plan 07 recovery",
      settings: { dataRetentionEnabled: false },
      error: () => Object.assign(new Error("Blocked by Sealed mode"), { code: "SEALED_MODE" }),
      held: true,
    },
    {
      name: "zero-day audio retention",
      settings: { dataRetentionEnabled: true, audioRetentionDays: 0 },
      error: () => new Error("provider 500"),
      held: true,
    },
    {
      name: "audio write refused",
      settings: { dataRetentionEnabled: true },
      audioWrite: async () => ({ success: false }),
      error: () => new Error("provider 500"),
      held: true,
    },
    {
      name: "audio write rejected",
      settings: { dataRetentionEnabled: true },
      audioWrite: async () => {
        throw new Error("disk full");
      },
      error: () => new Error("provider 500"),
      held: true,
    },
    // The real dictionary-echo rejection (dictionaryEchoFilter.js:141-148) has its own branch in processAudio.
    {
      name: "dictionary echo, retention off",
      settings: { dataRetentionEnabled: false },
      error: () => Object.assign(new Error("echo"), { code: "DICTIONARY_ECHO" }),
      held: true,
    },
    {
      name: "dictionary echo, zero-day audio retention",
      settings: { dataRetentionEnabled: true, audioRetentionDays: 0 },
      error: () => Object.assign(new Error("echo"), { code: "DICTIONARY_ECHO" }),
      held: true,
    },
    {
      name: "dictionary echo, audio write refused",
      settings: { dataRetentionEnabled: true },
      audioWrite: async () => ({ success: false }),
      error: () => Object.assign(new Error("echo"), { code: "DICTIONARY_ECHO" }),
      held: true,
    },
    {
      name: "genuine silence stays distinct",
      settings: { dataRetentionEnabled: false },
      error: () => new Error("No audio detected"),
      held: false,
    },
    {
      name: "Plan 07 holds it for sealed recovery",
      settings: { dataRetentionEnabled: false },
      error: () => Object.assign(new Error("sealed"), { code: "SEALED_MODE", recoveryHeld: true }),
      held: false,
    },
    {
      name: "retention kept the audio",
      settings: { dataRetentionEnabled: true },
      error: () => new Error("provider 500"),
      held: false,
    },
  ];
  for (const c of cases) {
    const settings = { ...LOCAL, ...c.settings };
    const {
      manager,
      advance,
      window: win,
      setSettings,
      createSessionContext,
    } = await setup(t, settings);
    setSettings(settings);
    win.electronAPI.saveTranscription = async () => ({ id: 1 });
    win.electronAPI.saveTranscriptionAudio = c.audioWrite ?? (async () => ({ success: true }));
    startBatch(manager, [], 3);
    const original = manager.activeSession;
    const context = createSessionContext({ sessionId: original.id });
    manager._sessionContext = context;
    manager.cancelRecording();
    await advance(0);

    manager.processWithLocalParakeet = async () => {
      throw c.error();
    };
    await manager.restoreCancelled();
    await manager._restoreRun;
    await advance(0);
    assert.equal(manager.isProcessing, false, `${c.name}: settled`);
    const held = manager._undo.peek();
    if (!c.held) {
      assert.equal(held, null, `${c.name}: a usable copy survived, so nothing is re-held`);
      continue;
    }
    assert.equal(held.session.id, original.id, `${c.name}: the same session, not null`);
    assert.deepEqual(held.session.routes, original.routes, `${c.name}: its route`);
    assert.equal(held.context, context, `${c.name}: its press-time context, moved, not released`);
    assert.equal(context.released, false);

    manager.processWithLocalParakeet = async () => ({
      success: true,
      text: "hi",
      source: "local-parakeet",
    });
    const again = await manager.restoreCancelled(original.id);
    assert.deepEqual(
      again,
      { restored: true, sessionId: original.id },
      `${c.name}: a second Undo works`
    );
    await manager._restoreRun;
  }
});

test("a merge failure keeps the session and context too (R2-C2)", async (t) => {
  const { manager, advance, createSessionContext } = await setup(t);
  startBatch(manager, [1, 2], 3);
  const original = manager.activeSession;
  const context = createSessionContext({ sessionId: original.id });
  manager._sessionContext = context;
  manager.cancelRecording();
  await advance(0);
  manager.mergeRecordedSegments = async () => {
    throw new Error("ffmpeg failed");
  };
  await manager.restoreCancelled();
  await manager._restoreRun;
  await advance(0);
  const held = manager._undo.peek();
  assert.equal(held.session.id, original.id);
  assert.equal(held.context, context);
  assert.equal(context.released, false);
});

test("_setOwnedAudio is the only writer of lastAudioBlob and lastAudioBlobPrivate (R3-C1)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../src/helpers/audioManager.js"), "utf8");
  const start = src.indexOf("  _setOwnedAudio(");
  assert.ok(start > 0, "the setter exists");
  const end = src.indexOf("\n  }\n", start);
  const outside = src.slice(0, start) + src.slice(end);
  assert.doesNotMatch(
    outside,
    /this\.lastAudioBlob\s*=(?!=)/,
    "every lastAudioBlob write goes through the setter"
  );
  assert.doesNotMatch(
    outside,
    /this\.lastAudioBlobPrivate\s*=(?!=)/,
    "every privacy stamp goes through the setter"
  );
});

test("a private take cancelled before finalization stays private through Undo (R3-C1)", async (t) => {
  const settings = { ...LOCAL, ...RETAIN };
  async function run({ isPrivate, fail }) {
    const { manager, advance, window: win, setSettings } = await setup(t, settings);
    setSettings(settings);
    const writes = [];
    win.electronAPI.saveTranscription = async () => (writes.push("row"), { id: 1 });
    win.electronAPI.saveTranscriptionAudio = async () => (writes.push("audio"), { success: true });
    win.electronAPI.recordAnalyticsEvent = async () => writes.push("analytics");
    const seen = [];
    for (const name of ["saveTranscription", "saveFailedTranscription"]) {
      const original = manager[name];
      manager[name] = function (...args) {
        seen.push([name, this.lastAudioBlobPrivate]);
        return original.apply(this, args);
      };
    }
    const rec = startBatch(manager, [], 3, { manualStop: true, private: isPrivate });
    const session = manager.activeSession;
    manager.cancelRecording(); // before finalization: lastAudioBlob was never stamped
    const restoring = manager.restoreCancelled();
    rec.finish();
    manager.processWithLocalParakeet = async () => {
      seen.push(["dispatch", manager.lastAudioBlobPrivate]);
      if (fail) throw new Error("provider 500");
      return { success: true, text: "hi", source: "local-parakeet" };
    };
    await restoring;
    await manager._restoreRun;
    // A successful dictation is saved by the hook's completion handler (useAudioRecording.js:537).
    if (!fail)
      await manager.saveTranscription("hi", "hi", {
        sessionId: session.id,
        private: session.private,
      });
    await advance(0);
    return { seen, writes, manager };
  }

  for (const fail of [false, true]) {
    const priv = await run({ isPrivate: true, fail });
    assert.ok(
      priv.seen.length >= 2 && priv.seen.every(([, flag]) => flag === true),
      `fail=${fail}: stamped before dispatch and every save`
    );
    assert.deepEqual(priv.writes, [], `fail=${fail}: no transcript, audio or analytics`);
    if (fail)
      assert.equal(priv.manager._undo.peek()?.private, true, "re-held in RAM, still private");
  }
  // A non-private restore afterwards is saved normally: no stale flag.
  const open = await run({ isPrivate: false, fail: false });
  assert.ok(open.seen.every(([, flag]) => flag === false));
  assert.ok(open.writes.includes("row"));
});

test("an old failed save never uploads or releases a newer private recording's audio (R4-C1)", async (t) => {
  for (const pending of ["row", "audio"]) {
    const settings = { ...LOCAL, ...RETAIN };
    const { manager, advance, window: win, setSettings } = await setup(t, settings);
    setSettings(settings);
    const row = deferred();
    const audioWrite = deferred();
    const uploaded = [];
    win.electronAPI.saveTranscription = async () => (pending === "row" ? row.promise : { id: 1 });
    win.electronAPI.saveTranscriptionAudio = async (_id, arrayBuffer) => {
      uploaded.push(new Uint8Array(arrayBuffer)[0]);
      return pending === "audio" ? audioWrite.promise : { success: true };
    };
    startBatch(manager, [], 3);
    const original = manager.activeSession;
    manager.cancelRecording();
    await advance(0);
    manager.processWithLocalParakeet = async () => {
      throw new Error("provider 500");
    };
    await manager.restoreCancelled(); // a non-private recording; its STT fails and its save waits
    for (let i = 0; i < 5; i += 1) await advance(0);

    manager.cancelProcessing(); // Esc while the save waits: Step 4.8 re-holds the restored audio
    await advance(0);
    // A newer, private recording now owns lastAudioBlob (byte 9).
    manager._recordingPrivate = true;
    const newer = manager.beginDictationSession({});
    const privateAudio = blob(9);
    manager._setOwnedAudio(privateAudio);

    if (pending === "row") row.resolve({ id: 1 });
    else audioWrite.resolve({ success: true });
    await manager._restoreRun;
    await advance(0);

    assert.equal(uploaded.includes(9), false, `${pending}: no private byte was uploaded`);
    assert.ok(
      uploaded.every((byte) => byte === 3),
      `${pending}: only the old recording's own bytes`
    );
    assert.equal(
      manager.lastAudioBlob,
      privateAudio,
      `${pending}: the newer owner's audio is untouched`
    );
    assert.equal(manager._lastAudioSessionId, newer.id);
    assert.equal(manager.lastAudioBlobPrivate, true);
    assert.equal(
      manager.activeSession,
      newer,
      `${pending}: the stale pipeline's settlement did not end the newer session`
    );
    const held = manager._undo.peek();
    assert.equal(held?.session.id, original.id, `${pending}: the cancelled recording is preserved`);
    assert.deepEqual(held.bytes("segment").map(firstByte), [3]);
  }
});

test("a save for a session that no longer owns the audio saves no audio, and keeps a private owner private (R4-C1)", async (t) => {
  const settings = { ...LOCAL, ...RETAIN };
  const { manager, window: win, setSettings } = await setup(t, settings);
  setSettings(settings);
  const writes = [];
  win.electronAPI.saveTranscription = async () => (writes.push("row"), { id: 1 });
  win.electronAPI.saveTranscriptionAudio = async (_id, arrayBuffer) => (
    writes.push(new Uint8Array(arrayBuffer)[0]),
    { success: true }
  );
  win.electronAPI.recordAnalyticsEvent = async () => writes.push("analytics");

  // The hook saves dictation A after dictation B already owns the audio.
  manager._recordingPrivate = false;
  const a = manager.beginDictationSession({});
  manager._setOwnedAudio(blob(4));
  manager._recordingPrivate = false;
  const b = manager.beginDictationSession({});
  const newer = blob(5);
  manager._setOwnedAudio(newer);
  await manager.saveTranscription("hello", "hello", { sessionId: a.id, private: a.private });
  assert.equal(writes.includes(5), false, "B's audio never lands on A's row");
  assert.equal(manager.lastAudioBlob, newer, "B's audio is untouched");

  // A private session whose audio was already released stays private.
  writes.length = 0;
  manager._recordingPrivate = true;
  const p = manager.beginDictationSession({});
  manager._setOwnedAudio(blob(6));
  manager._setOwnedAudio(null);
  for (let i = 0; i < 20; i += 1) {
    manager._recordingPrivate = false;
    manager.beginDictationSession({}); // delayed privacy does not depend on a fixed-size owner cache
  }
  await manager.saveTranscription("secret", "secret", { sessionId: p.id, private: p.private });
  assert.deepEqual(writes, [], "no row, audio or analytics for a private session");
  await manager.saveTranscription("unknown", "unknown", { sessionId: "missing-owner" });
  assert.deepEqual(writes, [], "unknown stale ownership fails closed as private");
  assert.ok(b.id);
});

test("an old release cannot clear the same Blob reassigned to the same session (R5-I2)", async (t) => {
  const { manager } = await setup(t, { ...LOCAL, ...RETAIN });
  const session = manager.beginDictationSession({});
  const sameBlob = blob(8);
  manager._setOwnedAudio(sameBlob, { sessionId: session.id, private: false });
  const oldSnapshot = manager._ownedAudioSnapshot({ sessionId: session.id, private: false });
  manager._setOwnedAudio(sameBlob, { sessionId: session.id, private: false }); // new ownership generation

  manager._releaseOwnedAudio(oldSnapshot);
  assert.equal(
    manager.lastAudioBlob,
    sameBlob,
    "same Blob identity does not make an old release current"
  );
  assert.equal(manager._lastAudioSessionId, session.id);
  assert.notEqual(manager._lastAudioOwnerToken, oldSnapshot.ownerToken);
});

test("a delayed cancelled pipeline preserves a newer real streaming capture and its Undo (R5-I1)", async (t) => {
  for (const pending of ["row", "audio"]) {
    const settings = { ...LOCAL, ...RETAIN };
    const { manager, advance, window: win, setSettings } = await setup(t, settings);
    setSettings(settings);
    const row = deferred();
    const audioWrite = deferred();
    const uploaded = [];
    win.electronAPI.saveTranscription = async () => (pending === "row" ? row.promise : { id: 1 });
    win.electronAPI.saveTranscriptionAudio = async (_id, arrayBuffer) => {
      uploaded.push(new Uint8Array(arrayBuffer)[0]);
      return pending === "audio" ? audioWrite.promise : { success: true };
    };

    startBatch(manager, [], 3);
    const oldSession = manager.activeSession;
    manager.cancelRecording();
    await advance(0);
    manager.processWithLocalParakeet = async () => {
      throw new Error("provider 500");
    };
    await manager.restoreCancelled();
    for (let i = 0; i < 5; i += 1) await advance(0); // A's row or audio write is now pending

    manager.cancelProcessing(); // Esc detaches A's pipeline and re-holds its audio
    await advance(0);
    const lifecycle = [];
    manager.onStateChange = (state) => lifecycle.push(state);
    const { worklets, sent } = installRealStreamingStart(manager, t);
    assert.ok(manager._streamingEgressStopped instanceof Set);
    assert.equal(await manager.startStreamingRecording(), true);
    const newerSession = manager.activeSession;
    const pcm = new Int16Array([11, 12, 13, 14]);
    worklets[0].port.onmessage({ data: pcm.buffer }); // the real worklet callback records B's frame
    assert.deepEqual(sent, [[11, 12, 13, 14]], "B's frame left through its streaming provider");
    assert.deepEqual(
      manager._sessionAudio.frames.map((frame) => [...frame]),
      [[11, 12, 13, 14]]
    );
    const lifecycleAtCapture = lifecycle.length;

    if (pending === "row") row.resolve({ id: 1 });
    else audioWrite.resolve({ success: true });
    await manager._restoreRun;
    await advance(0);

    assert.equal(
      manager._sessionAudio?.session,
      newerSession,
      `${pending}: A cannot clear B's capture`
    );
    assert.deepEqual(
      manager._sessionAudio.frames.map((frame) => [...frame]),
      [[11, 12, 13, 14]],
      `${pending}: B's PCM survives`
    );
    assert.equal(manager.activeSession, newerSession, `${pending}: A cannot end B's session`);
    assert.equal(lifecycle.length, lifecycleAtCapture, `${pending}: A cannot publish idle over B`);

    await manager.cancelStreamingRecording();
    await advance(0);
    const held = manager._undo.peek();
    assert.equal(held?.session.id, newerSession.id, `${pending}: Esc holds B`);
    assert.deepEqual(
      held.frames().map((frame) => [...frame]),
      [[11, 12, 13, 14]]
    );

    const replayed = [];
    win.electronAPI.dictationRealtimeStart = async () => ({ success: true });
    win.electronAPI.dictationRealtimeSend = (frame) => replayed.push([...new Int16Array(frame)]);
    win.electronAPI.dictationRealtimeStop = async () => ({ success: true });
    manager._attachStreamingListeners = () => {};
    manager._finalizeStreamingRecording = async (_id, { replay } = {}) =>
      assert.equal(replay, true);
    assert.equal(
      (await manager.restoreCancelled(newerSession.id)).restored,
      true,
      `${pending}: Undo resumes B`
    );
    await manager._restoreRun;
    assert.deepEqual(replayed, [[11, 12, 13, 14]], `${pending}: Undo replays the captured PCM`);
    assert.equal(held.isZeroed(), true, `${pending}: the restored hold releases its owned copy`);
    assert.equal(manager.isProcessing, false);
    assert.equal(manager.isStreaming, false);
    assert.notEqual(oldSession.id, newerSession.id);
    assert.equal(
      uploaded.every((byte) => byte === 3),
      true,
      `${pending}: A never uploads B's captured audio`
    );
  }
});

test("flush persists once when retention allows; with retention off it only zeroes", async (t) => {
  const on = await setup(t, { ...LOCAL, ...RETAIN });
  on.setSettings({ ...LOCAL, ...RETAIN });
  startBatch(on.manager, [], 3);
  on.manager.cancelRecording();
  await on.advance(0);
  await on.manager.flushCancelHold();
  await on.manager.flushCancelHold();
  assert.equal(on.io.saves, 1);
  assert.deepEqual(on.io.closed.at(-1).reason, "flushed");
});

test("absolute restore deadlines include delivery and final-chunk waiting, and never start late", async (t) => {
  for (const delivery of [0, 750, 1700]) {
    const { manager, advance, io } = await setup(t);
    const rec = startBatch(manager, [], 6, { manualStop: true });
    manager.cancelRecording();
    const held = manager._undo.peek();
    await advance(delivery);
    const resultPromise = manager.restoreCancelled(held.session.id, { deadlineAt: 1500 });
    if (delivery < 1500) {
      assert.equal(manager.isProcessing, true);
      await advance(1500 - delivery);
    }
    const result = await resultPromise;
    assert.equal(result.restored, false);
    assert.equal(result.reason, delivery < 1500 ? "noAudio" : "unavailable");
    rec.finish();
    await advance(1);
    assert.equal(manager._undo.peek(), held);
    assert.deepEqual(held.bytes("segment").map(firstByte), [6]);
    assert.equal(io.local, 0);
    await manager.flushCancelHold();
  }
});

test("held late receipts retain the same tracker while paused; expiry disposes it and source chunks", async (t) => {
  const {
    manager,
    window: win,
    advance,
    io,
  } = await setup(t, { ...LOCAL, useLocalWhisper: false });
  const bus = new EventEmitter();
  win.electronAPI.onDictationDispatch = (cb) => {
    bus.on("d", cb);
    return () => bus.off("d", cb);
  };
  const recorder = startBatch(manager, [2], 3, { manualStop: true });
  const chunks = manager.audioChunks;
  manager.cancelRecording();
  await advance(1);
  const held = manager._undo.peek();
  manager.pauseCancelHold();
  const paused = io.cancelled.at(-1);
  await advance(60000);
  bus.emit("d", { correlationId: held.session.id, task: "dictationStt", payload: "audio" });
  assert.equal(io.cancelled.at(-1).undoUntil, paused.undoUntil);
  assert.equal(io.cancelled.at(-1).remainingMs, paused.remainingMs);
  assert.equal(io.cancelled.at(-1).remoteAlreadySent.evidence, "dispatched");
  manager.resumeCancelHold();
  await advance(paused.remainingMs);
  assert.equal(held.isZeroed(), true);
  assert.deepEqual(chunks, [], "pending recorder source Blobs are dropped at expiry");
  assert.equal(bus.listenerCount("d"), 0);
  recorder.finish();
  await advance(0);
  assert.deepEqual(held.bytes("segment"), []);
});

test("streaming fallback's final chunk enters the hold and late chunks cannot survive expiry", async (t) => {
  for (const expiresFirst of [false, true]) {
    const { manager, advance } = await setup(t);
    streamingManager(manager);
    manager.isRecording = true;
    const chunks = [blob(7)];
    manager._sessionAudio.fallbackChunks = chunks;
    manager.streamingFallbackChunks = chunks;
    let finish;
    const recorder = {
      state: "recording",
      mimeType: "audio/webm",
      stop() {
        this.state = "inactive";
        finish = () => {
          chunks.push(blob(8));
          this.onstop();
        };
      },
    };
    manager.streamingFallbackRecorder = recorder;
    await manager.cancelStreamingRecording();
    const held = manager._undo.peek();
    if (expiresFirst) await advance(10000);
    finish();
    await advance(0);
    if (expiresFirst) {
      assert.deepEqual(chunks, []);
      assert.deepEqual(held.bytes("fallback"), []);
    } else {
      await held.ready();
      const bytes = held.bytes("fallback")[0];
      assert.equal(bytes.length, 600);
      assert.equal(bytes[0], 7);
      assert.equal(bytes[300], 8);
      await manager.flushCancelHold();
      assert.equal(
        bytes.every((value) => value === 0),
        true
      );
    }
  }
});

test("cancel during actual streaming Start retires transport before awaiting startup settlement", async (t) => {
  const { manager } = await setup(t);
  const { worklets, provider } = installRealStreamingStart(manager, t);
  const starting = deferred();
  provider.start = () => starting.promise;
  const order = [];
  provider.cancel = () => order.push("cancel");
  provider.stop = async () => {
    order.push("stop");
    starting.resolve({ success: false });
    return {};
  };
  const started = manager.startStreamingRecording();
  for (let i = 0; i < 30 && !manager.isRecording; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.isRecording, true);
  worklets[0].port.onmessage({ data: Int16Array.of(5, 6).buffer });
  const session = manager.activeSession;
  const cancelled = manager.cancelStreamingRecording();
  await new Promise((resolve) => setImmediate(resolve));
  const stoppedBeforeSettlement = order.includes("stop");
  starting.resolve({ success: false }); // teardown stays bounded even in RED
  await started;
  await cancelled;
  assert.equal(stoppedBeforeSettlement, true);
  assert.deepEqual(order.slice(0, 2), ["cancel", "stop"]);
  assert.equal(manager._undo.peek().session, session);
  assert.deepEqual(
    manager._undo
      .peek()
      .frames()
      .map((frame) => [...frame]),
    [[5, 6]]
  );
});

test("microphone recovery with no live recorder still holds every batch segment for Undo", async (t) => {
  const { manager, advance, io } = await setup(t);
  startBatch(manager, [2], 4);
  const session = manager.activeSession;
  manager.mediaRecorder = null; // capture died during recovery
  assert.equal(manager.cancelRecording(), true);
  const held = manager._undo.peek();
  await held.ready();
  assert.equal(held.session, session);
  assert.deepEqual(held.bytes("segment").map(firstByte), [2, 4]);
  assert.equal(io.merges, 0);
  await advance(5000);
  assert.equal(held.isZeroed(), true);
});

test("cancel while replay Start waits erases its original and lets a new capture own the lifecycle", async (t) => {
  const { manager, advance, window: win } = await setup(t);
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  const original = manager._undo.peek();
  const starting = deferred();
  win.electronAPI.dictationRealtimeStart = () => starting.promise;
  win.electronAPI.dictationRealtimeCancel = () => {};
  win.electronAPI.dictationRealtimeStop = async () => ({});
  manager._attachStreamingListeners = () => {};
  await manager.restoreCancelled();
  assert.equal(original.isZeroed(), true, "only replay capture owns mutable bytes during Start");
  const oldRun = manager._restoreRun;
  await manager.cancelStreamingRecording();
  const held = manager._undo.peek(),
    aliases = held.frames();
  await advance(10000);
  assert.equal(aliases.every(allZero), true);
  assert.equal(held.isZeroed(), true);
  startBatch(manager, [], 9);
  const current = manager.activeSession;
  starting.resolve({ success: true });
  await oldRun;
  assert.equal(manager.activeSession, current);
  assert.equal(manager.isRecording, true);
});

for (const stage of ["control", "Start", "pacing"]) {
  test(`Esc during replay ${stage} cannot finalize a held recording and a second Undo retains its operation`, async (t) => {
    const { manager, advance, window: win } = await setup(t);
    streamingManager(manager);
    manager.isRecording = true;
    await manager.cancelStreamingRecording();
    await advance(0);
    const original = manager._undo.peek();
    const session = original.session,
      context = original.context,
      tracker = original.tracker;
    const expected = original.frames().map((frame) => [...frame]);
    const starting = deferred(),
      sent = deferred();
    const starts = [],
      frames = [],
      completions = [],
      states = [],
      effects = [];
    let finalizes = 0,
      banks = 0;
    const finalize = manager._finalizeStreamingRecording;
    manager._finalizeStreamingRecording = function (...args) {
      finalizes++;
      return finalize.apply(this, args);
    };
    const bank = manager._bankAssistantDirective;
    manager._bankAssistantDirective = function (...args) {
      banks++;
      return bank.apply(this, args);
    };
    win.electronAPI.dictationRealtimeStart = async (operation) => {
      starts.push(operation);
      if (stage === "Start" && starts.length === 1) await starting.promise;
      return { success: true };
    };
    win.electronAPI.dictationRealtimeSend = (bytes, operation) => {
      frames.push({ bytes: [...new Int16Array(bytes)], operation });
      sent.resolve();
    };
    win.electronAPI.dictationRealtimeCancel = () => {};
    win.electronAPI.dictationRealtimeStop = async () => ({ text: "Retained words" });
    for (const name of [
      "onDictationRealtimePartial",
      "onDictationRealtimeFinal",
      "onDictationRealtimeError",
      "onDictationRealtimeSessionEnd",
    ])
      win.electronAPI[name] = () => () => {};
    win.electronAPI.pasteText = async () => {
      effects.push("paste");
      return { pasted: true };
    };
    win.electronAPI.recordAnalyticsEvent = async () => effects.push("analytics");
    win.electronAPI.saveTranscription = async () => {
      effects.push("row");
      return { id: 1 };
    };
    win.electronAPI.saveTranscriptionAudio = async () => {
      effects.push("audio");
      return { success: true };
    };
    manager.onStateChange = (state) => states.push(state);
    manager.shouldUseStreaming = () => false;
    manager.processTranscription = async (text) => {
      manager._bankAssistantDirective(text, {});
      return text;
    };
    const saved = [];
    manager.onTranscriptionComplete = (result) => {
      completions.push(result);
      saved.push(manager.safePaste(result.text));
      saved.push(
        manager.saveTranscription(result.text, result.text, {
          sessionId: session.id,
          private: session.private,
        })
      );
    };
    assert.equal((await manager.restoreCancelled()).restored, true);
    const oldRun = manager._restoreRun;
    if (stage !== "control") {
      if (stage === "pacing") await sent.promise;
      assert.equal(manager.cancelProcessing(), true); // Esc, without any replacement
      const held = manager._undo.peek();
      await held.ready();
      const notifications = states.length;
      starting.resolve();
      await oldRun;
      assert.equal(finalizes, 0, "abandoned replay never enters real finalization");
      assert.deepEqual(completions, []);
      assert.deepEqual(effects, [], "no paste, row, audio or analytics after Esc");
      assert.equal(banks, 0);
      assert.equal(manager.pendingAssistantConversation ?? null, null);
      assert.equal(
        states.length,
        notifications,
        "abandoned replay publishes no processing or idle"
      );
      assert.equal(manager._undo.peek(), held);
      assert.equal(held.session, session);
      assert.equal(held.context, context);
      assert.equal(held.tracker, tracker);
      assert.equal(context.released, false);
      assert.deepEqual(
        held.frames().map((frame) => [...frame]),
        expected
      );
      frames.length = 0;
      assert.equal((await manager.restoreCancelled(session.id)).restored, true);
      await manager._restoreRun;
      assert.notEqual(starts[0].operationId, starts[1].operationId);
    } else await oldRun;
    await Promise.all(saved);
    assert.equal(finalizes, 1);
    assert.equal(completions.length, 1);
    assert.deepEqual(
      frames.map((frame) => frame.bytes),
      expected
    );
    assert.equal(starts.at(-1).dictationSessionId, session.id);
    assert.ok(effects.includes("paste"));
    assert.equal(manager._undo.peek(), null);
    assert.equal(context.released, true);
  });
}

for (const owner of ["batch", "restored batch", "streaming fallback"]) {
  test(`${owner} conversion cannot admit a disk merge after cancel and erases early and late copies`, async (t) => {
    const { manager, advance, io } = await setup(t);
    const conversions = [],
      aliases = [];
    const merge = manager.mergeRecordedSegments;
    manager.mergeRecordedSegments = function (segments, ...options) {
      for (const [index, segment] of segments.entries()) {
        const original = segment.arrayBuffer.bind(segment);
        const gate = deferred();
        const alias = new Uint8Array(300).fill(index + 1);
        aliases.push(alias);
        conversions.push(gate);
        let calls = 0;
        segment.arrayBuffer = () => (calls++ === 0 ? gate.promise : original());
      }
      return merge.call(this, segments, ...options); // real helper, only Blob conversion is deferred
    };
    let running;
    if (owner === "streaming fallback") {
      streamingManager(manager);
      manager._sessionAudio.fallbackSegments.push(blob(1), blob(2));
      manager._streamingFallbackSegments = manager._sessionAudio.fallbackSegments;
      manager.finishStreamingFallbackSegment = async () => null;
      manager._activeStreamingSessionId = 1;
      manager._streamingOperation = {
        operationId: "fallback",
        correlationId: manager.activeSession.id,
        dictationSessionId: manager.activeSession.id,
      };
      running = manager.stopStreamingRecording();
    } else {
      startBatch(manager, [1, 2], 3);
      if (owner === "restored batch") {
        manager.cancelRecording();
        await advance(0);
        await manager._undo.peek().ready();
        await manager.restoreCancelled();
        running = manager._restoreRun;
      } else running = manager.finalizeBatchRecording(null);
    }
    for (let i = 0; i < 12 && conversions.length < 2; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(conversions.length >= 2);
    conversions[0].resolve(aliases[0].buffer);
    await advance(0);
    assert.equal(io.merges, 0);
    assert.equal(manager.cancelProcessing(), true);
    const held = manager._undo.peek(),
      context = held.context,
      tracker = held.tracker;
    const earlyErased = allZero(aliases[0]);
    for (let i = 1; i < conversions.length; i++) conversions[i].resolve(aliases[i].buffer);
    await running;
    await advance(0);
    await held.ready();
    assert.equal(io.merges, 0, "renderer conversion entry is not main merge admission");
    assert.equal(earlyErased, true, "cancel immediately erases already-converted mutable copies");
    assert.ok(aliases.every(allZero), "late converted aliases are erased on arrival");
    assert.equal(manager._undo.peek(), held);
    assert.equal(held.context, context);
    assert.equal(held.tracker, tracker);
    assert.equal(context.released, false);
    const role = owner === "streaming fallback" ? "fallback" : "segment";
    assert.deepEqual(held.bytes(role).map(firstByte).slice(0, 2), [1, 2]);
    await manager.flushCancelHold();
  });
}

test("an admitted main merge may finish cleanup after cancel, with renderer inputs and late result erased", async (t) => {
  const { manager, advance, window: win } = await setup(t);
  const main = deferred(),
    entered = deferred();
  let cleanups = 0;
  let inputs;
  win.electronAPI.mergeAudioSegments = async (payload) => {
    inputs = payload.map((part) => new Uint8Array(part.buffer));
    entered.resolve();
    try {
      return await main.promise;
    } finally {
      cleanups++;
    }
  };
  startBatch(manager, [1, 2], 3);
  const running = manager.finalizeBatchRecording(null);
  await entered.promise; // IPC admitted before cancellation: the documented exception
  assert.equal(manager.cancelProcessing(), true);
  const held = manager._undo.peek();
  const result = new Uint8Array(300).fill(8);
  main.resolve({ success: true, buffer: result.buffer, mimeType: "audio/webm" });
  await running;
  await advance(0);
  await held.ready();
  assert.equal(cleanups, 1);
  assert.ok(inputs.every(allZero));
  assert.ok(allZero(result), "late main reply is still owned mutable renderer audio");
  assert.deepEqual(held.bytes("segment").map(firstByte), [1, 2]);
  assert.equal(manager.lastAudioBlob ?? null, null);
  await manager.flushCancelHold();
});

test("merge conversion failure erases ready copies and later remainders without admitting IPC", async (t) => {
  const { manager, io } = await setup(t);
  const first = deferred(),
    rejected = deferred(),
    late = deferred();
  const a = new Uint8Array(300).fill(1),
    b = new Uint8Array(300).fill(2);
  const segment = (gate) => ({ size: 300, type: "audio/webm", arrayBuffer: () => gate.promise });
  const running = manager.mergeRecordedSegments([segment(first), segment(rejected), segment(late)]);
  first.resolve(a.buffer);
  await Promise.resolve();
  rejected.reject(Error("synthetic conversion failure"));
  await assert.rejects(running, /synthetic conversion/);
  late.resolve(b.buffer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(io.merges, 0);
  assert.ok(allZero(a));
  assert.ok(allZero(b));
});

test("uncancelled merge preserves audio order while erasing owned view spans and reply copies", async (t) => {
  const { manager, window: win } = await setup(t);
  const storage = new Uint8Array(302).fill(9);
  const view = storage.subarray(1, 301);
  const second = new Uint8Array(300).fill(2);
  const reply = new Uint8Array([7, 8]);
  win.electronAPI.mergeAudioSegments = async (payload) => {
    assert.deepEqual(
      payload.map((part) => new Uint8Array(part.buffer)[0]),
      [9, 2]
    );
    return { success: true, buffer: reply.buffer, mimeType: "audio/webm" };
  };
  const segment = (bytes) => ({ size: 300, type: "audio/webm", arrayBuffer: async () => bytes });
  const result = await manager.mergeRecordedSegments([segment(view), segment(second.buffer)]);
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [7, 8]);
  assert.equal(storage[0], 9);
  assert.equal(storage.at(-1), 9);
  assert.ok(view.every((value) => value === 0));
  assert.ok(allZero(second));
  assert.ok(allZero(reply));
  assert.equal(manager._segmentMergeCopies.size, 0);
});

test("cancel settles renderer merge without waiting for a never-finishing conversion", async (t) => {
  const { manager, advance, io } = await setup(t);
  startBatch(manager, [1, 2], 3);
  const first = new Uint8Array(300).fill(1);
  const original = manager._batchSegments[1].arrayBuffer.bind(manager._batchSegments[1]);
  manager._batchSegments[0].arrayBuffer = async () => first.buffer.slice(0);
  let calls = 0;
  manager._batchSegments[1].arrayBuffer = () =>
    calls++ === 0 ? new Promise(() => {}) : original();
  const running = manager.finalizeBatchRecording(null);
  await advance(0);
  assert.equal(manager.cancelProcessing(), true);
  await running; // cancellation owns settlement; a hung browser copy cannot keep processing alive
  assert.equal(io.merges, 0);
  assert.equal(manager._segmentMergeCopies.size, 0);
  await manager._undo.peek().ready();
  await manager.flushCancelHold();
});
