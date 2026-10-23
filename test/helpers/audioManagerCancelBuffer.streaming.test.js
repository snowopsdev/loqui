// Real AudioManager cancel buffer and Undo (Plan 04 Task 8). The suite is split in three
// files so each runs in its own process under the standard 4096 MB heap: every test builds
// a fresh renderer server. Parts: .batch, .streaming, .ownership.
// Part 2 of 3: streaming holds, provider buffer drop, Start races and replay.
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  deferred,
  RETAIN,
  LOCAL,
  blob,
  allZero,
  setup,
  startBatch,
  streamingManager,
  installRealStreamingStart,
} = require("./harness/cancelledAudioManager");

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
    manager._streamingTransport = {
      adapter: manager.getStreamingProvider(),
      operation: manager._streamingOperation,
      closed: false,
    };
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
  provider.cancel = () => {
    order.push("cancel");
    // Actual main Cancel retires the pending attempt and settles its public
    // Start immediately; a later core connection remains fenced in main.
    starting.resolve({ success: false });
  };
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

test("cancel while replay Start waits erases its original and lets a new capture own the lifecycle", async (t) => {
  const { manager, advance, window: win } = await setup(t);
  streamingManager(manager);
  manager.isRecording = true;
  await manager.cancelStreamingRecording();
  await advance(0);
  const original = manager._undo.peek();
  const starting = deferred();
  win.electronAPI.dictationRealtimeStart = () => starting.promise;
  win.electronAPI.dictationRealtimeCancel = () => starting.resolve({ success: false });
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
      errors = [],
      states = [],
      effects = [];
    let finalizes = 0,
      banks = 0;
    const finalize = manager._finalizeStreamingRecording;
    manager._finalizeStreamingRecording = async function (...args) {
      finalizes++;
      try {
        return await finalize.apply(this, args);
      } catch (error) {
        errors.push({ message: error.message, stack: error.stack });
        throw error;
      }
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
    manager.onError = (error) => errors.push(error);
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
    assert.equal(completions.length, 1, JSON.stringify(errors));
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
