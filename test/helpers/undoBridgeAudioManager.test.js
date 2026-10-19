const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
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

// Task 9 closes the deferred integration seam: real main request producer →
// real request helper → real RAM buffer/restore/context/tracker. Delivery and
// final recorder events share the manager's epoch clock; only STT is synthetic.
for (const { delivery, finalAt, restored } of [
  { delivery: 0, finalAt: 100, restored: true },
  { delivery: 750, finalAt: 1000, restored: true },
  { delivery: 1700, finalAt: 1700, restored: false },
  { delivery: 0, finalAt: 1700, restored: false },
  { delivery: 750, finalAt: 1700, restored: false },
]) {
  test(`actual Undo bridge delivery ${delivery}ms/final chunk ${finalAt}ms admits ${restored}`, async (t) => {
    const { undoBridge } = require("./harness/undoBridge");
    const { manager, advance, io, window: win } = await setup(t);
    const f = undoBridge(t);
    const epoch = 1700000000000;
    await advance(epoch);
    const bus = new EventEmitter();
    win.electronAPI.onDictationDispatch = (cb) => (
      bus.on("dispatch", cb),
      () => bus.off("dispatch", cb)
    );
    manager.selectionCapturePromise = Promise.resolve({ text: "original selection" });
    manager.screenContextPromise = Promise.resolve({ data: "original screen" });
    const recorder = startBatch(manager, [], 6, { manualStop: true });
    const session = manager.activeSession;
    const context = manager._sessionContext;
    const tracker = manager._disclosure;
    manager.cancelRecording();
    const held = manager._undo.peek();
    assert.equal(held.session, session);
    assert.equal(held.context, context);
    assert.equal(held.tracker, tracker);
    assert.equal(context.released, false);
    const order = [];
    manager.onCancelledChange = (state, closed) =>
      order.push(state ? "cancelled" : `closed:${closed.reason}`);
    manager.onStateChange = (state) => {
      if (state.isProcessing) order.push("processing");
    };
    const completions = [];
    manager.onTranscriptionComplete = () =>
      completions.push({
        session: manager.activeSession,
        context: manager._sessionContext,
        tracker: manager._disclosure,
      });
    f.windowManager.lastCancelledDictation = { sessionId: session.id };
    // Only the synchronous main producer's Date.now read is replaced; request
    // timers and Vite/teardown remain real, independent of this audio clock.
    const realNow = Date.now;
    Date.now = manager._now;
    let response;
    try {
      response = f.windowManager.sendUndoCancelDictation();
    } finally {
      Date.now = realNow;
    }
    const [channel, request] = f.sent[0];
    assert.equal(channel, "undo-cancel-request");
    assert.equal(request.deadlineAt, epoch + 1500);
    let mainAnswered = false;
    void response.then(() => {
      mainAnswered = true;
    });
    f.ipcMain.emit("undo-cancel-reply", { sender: {} }, request.token, { restored: true });
    f.ipcMain.emit("undo-cancel-reply", { sender: f.overlay }, request.token + 1, {
      restored: true,
    });
    await advance(delivery);
    assert.equal(mainAnswered, false, "foreign sender and stale token cannot answer");
    const admission = manager.restoreCancelled(request.sessionId, {
      deadlineAt: request.deadlineAt,
    });
    void admission.then((result) =>
      f.ipcMain.emit("undo-cancel-reply", { sender: f.overlay }, request.token, result)
    );
    if (restored) {
      await advance(finalAt - delivery);
      recorder.ondataavailable({ data: blob(9) });
      recorder.finish();
      await advance(0);
    } else if (delivery < 1500) {
      await advance(1500 - delivery);
    }
    const result = await response;
    assert.equal(result.restored, restored);
    if (restored) {
      await manager._restoreRun;
      assert.equal(io.local, 1);
      assert.equal(completions.length, 1);
      assert.deepEqual(completions[0], { session, context, tracker });
      assert.deepEqual(order.slice(0, 2), ["closed:restored", "processing"]);
      assert.equal(held.isZeroed(), true);
    } else {
      assert.equal(result.reason, delivery >= 1500 ? "unavailable" : "noAudio");
      await advance(finalAt - Math.max(delivery, 1500));
      recorder.ondataavailable({ data: blob(9) });
      recorder.finish();
      await advance(0);
      assert.equal(manager._undo.peek(), held);
      assert.equal(held.context, context);
      assert.equal(held.tracker, tracker);
      assert.equal(context.released, false);
      assert.deepEqual(
        held.bytes("segment").map((bytes) => [bytes[0], bytes[300]]),
        [[6, 9]]
      );
      assert.equal(io.local, 0, "a late final producer cannot start after main's refusal");
      assert.equal(completions.length, 0);
      await manager.flushCancelHold();
      assert.equal(held.isZeroed(), true);
    }
    assert.equal(f.ipcMain.listenerCount("undo-cancel-reply"), 0);
    assert.equal(f.overlay.listenerCount("did-start-navigation"), 0);
    assert.equal(
      bus.listenerCount("dispatch"),
      0,
      "terminal success or flush disposes the real tracker"
    );
  });
}

test("actual main timeout followed by late renderer delivery cannot start the held pipeline", async (t) => {
  const { undoBridge } = require("./harness/undoBridge");
  const { manager, advance, io } = await setup(t);
  const f = undoBridge(t);
  await advance(1700000000000);
  const recorder = startBatch(manager, [], 4, { manualStop: true });
  manager.cancelRecording();
  const held = manager._undo.peek();
  const context = held.context;
  f.windowManager.lastCancelledDictation = { sessionId: held.session.id };
  const realNow = Date.now;
  Date.now = manager._now;
  let response;
  try {
    response = f.windowManager.sendUndoCancelDictation();
  } finally {
    Date.now = realNow;
  }
  const request = f.sent[0][1];
  assert.deepEqual(await response, {
    restored: false,
    sessionId: held.session.id,
    reason: "unavailable",
  });
  await advance(2200);
  assert.equal(
    (await manager.restoreCancelled(request.sessionId, { deadlineAt: request.deadlineAt }))
      .restored,
    false
  );
  recorder.finish();
  await advance(0);
  assert.equal(io.local, 0);
  assert.equal(manager._undo.peek(), held);
  assert.equal(held.context, context);
  assert.equal(context.released, false);
  assert.deepEqual(held.bytes("segment").map(firstByte), [4]);
  assert.equal(f.ipcMain.listenerCount("undo-cancel-reply"), 0);
  await manager.flushCancelHold();
});

for (const mode of ["unmount", "retention", "private", "lateCopy", "control"]) {
  test(`actual hook ${mode} revokes only its waiting real restore and handles late final bytes`, async (t) => {
    const React = require("react");
    const { createRoot } = require("react-dom/client");
    const { createRendererServer, installHookDom } = require("../lib/rendererTestHarness");
    let root;
    t.after(async () => {
      if (root) await React.act(async () => root.unmount());
      delete globalThis.__task9RealManager;
    });
    const {
      manager,
      advance,
      io,
      window: win,
    } = await setup(
      t,
      mode === "retention" || mode === "private" ? { ...LOCAL, ...RETAIN } : LOCAL
    );
    // Capture/device and UI IPC leaves only; the constructor bridge returns
    // the actual manager, whose cleanup/buffer/restore/context/tracker run.
    Object.assign(manager, {
      cacheMicrophoneDeviceId() {},
      preparedMicCapture: { cancel() {} },
      micStreamHold: { drop() {} },
      saveTranscription: async () => true,
      safePaste: async () => true,
    });
    globalThis.__task9RealManager = manager;
    const listeners = {};
    const events = [];
    const on = (name) => (cb) => ((listeners[name] = cb), () => delete listeners[name]);
    Object.assign(win.electronAPI, {
      onToggleDictation: () => () => {},
      onUndoCancelRequest: on("undo"),
      onDictationFlushRequest: on("flush"),
      replyUndoCancel: (...args) => events.push(["reply", ...args]),
      dictationLifecycleStateChanged: (state) => events.push(["state", state]),
      registerCancelHotkey: () => events.push("+esc"),
      unregisterCancelHotkey: () => events.push("-esc"),
    });
    const container = installHookDom(t);
    const hookVite = await createRendererServer(t, {
      cachePrefix: "openwhispr-real-undo-hook-",
      mockModules: {
        "/helpers/audioManager":
          "export default class { constructor() { return globalThis.__task9RealManager; } }",
      },
    });
    const { useAudioRecording } = await hookVite.ssrLoadModule("/hooks/useAudioRecording.js");
    function Harness() {
      useAudioRecording({ onDemoEvent: (event) => events.push(["demo", event.status]) });
      return null;
    }
    root = createRoot(container);
    await React.act(async () => root.render(React.createElement(Harness)));
    const notices = await hookVite.ssrLoadModule("/components/ui/notices.ts");
    const lateCopy = deferred();
    const lateBytes = new Uint8Array(300).fill(1);
    let recorder;
    await React.act(async () => {
      recorder = startBatch(manager, [1], 2, { manualStop: true, private: mode === "private" });
      if (mode === "lateCopy") manager._batchSegments[0].arrayBuffer = () => lateCopy.promise;
      manager.cancelRecording();
    });
    const held = manager._undo.peek();
    const context = held.context;
    const tracker = held.tracker;
    await advance(0);
    const earlyBytes = mode === "lateCopy" ? lateBytes : held.bytes("segment")[0];
    let reply;
    await React.act(async () => {
      reply = listeners.undo({ token: 51, sessionId: held.session.id, deadlineAt: 1500 });
    });
    assert.equal(manager.isProcessing, true);
    if (mode !== "control") {
      await React.act(async () => {
        root.unmount();
        root = null;
      });
    }
    const callbacksDetached =
      manager.onCancelledChange === null && manager.onProcessingStage === null;
    let replacement = null;
    let replacementRecorder = null;
    if (mode === "unmount") {
      manager.setCallbacks({ onStateChange() {}, onTranscriptionComplete() {} });
      replacementRecorder = startBatch(manager, [], 3, { manualStop: true });
      manager.cancelRecording();
      replacement = manager._undo.peek();
    }
    const afterUnmount = events.length;
    const noticesAfterUnmount = notices.getNotices();
    await React.act(async () => {
      if (mode === "lateCopy") lateCopy.resolve(lateBytes.buffer);
      recorder.ondataavailable({ data: blob(9) });
      recorder.finish();
      await advance(0);
      await reply;
      if (mode === "control") await manager._restoreRun;
    });
    if (mode === "control") {
      await manager._restoreRun;
      assert.equal(io.local, 1);
      assert.equal(
        events.some((e) => Array.isArray(e) && e[0] === "reply" && e[2].restored),
        true
      );
    } else {
      if (!replacement) await manager.flushCancelHold();
      assert.equal(io.local, 0, "no old pipeline after hook disposal");
      assert.equal(callbacksDetached, true);
      assert.equal(
        manager._undo.peek(),
        replacement,
        "a disposed preflight never re-holds over a new owner"
      );
      if (replacement) assert.equal(replacement.context.released, false);
      assert.equal(held.isZeroed(), true);
      assert.equal(allZero(earlyBytes), true);
      assert.equal(context.released, true);
      assert.equal(tracker.get(), null);
      assert.equal(io.saves, mode === "retention" ? 1 : 0);
      assert.equal(
        events.length,
        afterUnmount,
        "no old lifecycle, demo, stage or reply publication"
      );
      assert.deepEqual(Object.keys(listeners), []);
      assert.deepEqual(
        notices.getNotices(),
        noticesAfterUnmount,
        "no old refusal notice after disposal"
      );
      // No permanent disposed flag: a deliberate new callback installation
      // on the same manager can own a fresh hold/restore after cleanup.
      if (replacement) replacementRecorder.finish();
      else {
        manager.setCallbacks({ onStateChange() {}, onTranscriptionComplete() {} });
        startBatch(manager, [], 3);
        manager.cancelRecording();
      }
      await advance(0);
      assert.equal((await manager.restoreCancelled()).restored, true);
      await manager._restoreRun;
      assert.equal(io.local, 1);
    }
  });
}
