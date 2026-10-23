// Real AudioManager cancel buffer and Undo (Plan 04 Task 8). The suite is split in three
// files so each runs in its own process under the standard 4096 MB heap: every test builds
// a fresh renderer server. Parts: .batch, .streaming, .ownership.
// Part 1 of 3: batch holds, expiry, merge-time cancel, Undo and the recorder's final chunk.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  deferred,
  RETAIN,
  LOCAL,
  blob,
  firstByte,
  allZero,
  setup,
  startBatch,
} = require("./harness/cancelledAudioManager");

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
