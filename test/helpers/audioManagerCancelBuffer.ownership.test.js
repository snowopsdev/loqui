// Real AudioManager cancel buffer and Undo (Plan 04 Task 8). The suite is split in three
// files so each runs in its own process under the standard 4096 MB heap: every test builds
// a fresh renderer server. Parts: .batch, .streaming, .ownership.
// Part 3 of 3: failed restores, flushes, private takes, audio ownership and merge erasure.
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
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
  streamingManager,
} = require("./harness/cancelledAudioManager");

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
    let completionSave;
    manager.onTranscriptionComplete = (result, take, recording) => {
      completionSave = manager.saveTranscription(result.text, result.text, {
        sessionId: session.id,
        private: session.private,
        recording,
      });
    };
    await restoring;
    await manager._restoreRun;
    await completionSave;
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

test("Undo seal read follows the current shared store authority without future exports", async (t) => {
  const { manager, vite } = await setup(t);
  delete manager._readSealed; // Exercise the real prototype, not the fixture's default false seam.
  const { useSealedStore } = await vite.ssrLoadModule("/stores/sealedStore.ts");
  for (const sealed of [false, true, false]) {
    useSealedStore.setState({ sealed, known: true });
    assert.equal(manager._readSealed(), sealed);
  }
});
