const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const React = require("react");
const { mountTrial, flush, deferred, configureStreamingStartup } = require(
  path.resolve("test/helpers/harness/audioRecordingTrial")
);
const { bridgeFixture } = require(path.resolve("test/helpers/harness/onboardingBridgeFixture"));

// Execute the unedited production App listener against the current actual
// useAudioRecording hook/AudioManager. Hardware, IPC transport and DB sinks are
// fixtures installed before imports; no synthesized manager state is used.
function appListener(name, h) {
  const file = ts.createSourceFile(
    "App.jsx",
    fs.readFileSync("src/App.jsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JSX
  );
  let callback;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === name
    )
      callback = node.arguments[0].getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(callback, name + " actual App listener exists");
  const api = h.api();
  return new Function(
    "isRecordingRef",
    "isProcessingRef",
    "isRecording",
    "isPreparing",
    "isProcessing",
    "cancelRecording",
    "cancelProcessing",
    "cancelOnboardingTake",
    `return (${callback});`
  )(
    { current: api.isRecording },
    { current: api.isProcessing },
    api.isRecording,
    api.isPreparing,
    api.isProcessing,
    api.cancelRecording,
    api.cancelProcessing,
    api.cancelOnboardingTake
  );
}

for (const edge of ["enter setup", "exit setup"])
  for (const phase of ["recording", "processing"]) {
    test(`restart ownership: ${edge} must preserve public ${phase}`, async (t) => {
      const h = await mountTrial(t, false);
      const f = bridgeFixture();
      // Actual main starts gated for first launch; release it as a completed
      // workspace does before admitting public work.
      f.manager.setOnboardingActive(false);
      if (edge === "exit setup") f.manager.setOnboardingActive(true);
      // Use the actual hook's lifecycle publication; only its IPC transport is
      // injected. Main sees the real owner's current state before restart.
      h.window.electronAPI.dictationLifecycleStateChanged = (state, kind) =>
        f.manager.setDictationLifecycleState(state, kind);
      // null is a normal workspace admission, with no demo/take identity.
      await (await h.start(null)).finish();
      const original = h.manager();
      assert.equal(original.isRecording, true, "real public recorder started");
      assert.equal(original._recordingPrivate, false, "original public policy captured");
      let stop;
      if (phase === "processing") {
        await React.act(async () => {
          stop = original.mediaRecorder.stop();
          await flush();
        });

        assert.equal(original.isProcessing, true, "actual provider result is pending");
      }
      assert.equal(
        f.manager._dictationLifecycleState,
        phase,
        "actual hook reported current state to main"
      );
      f.overlayApi.onCancelHotkeyPressed(appListener("onCancelHotkeyPressed", h));
      f.overlayApi.onCancelDictation(appListener("onCancelDictation", h));
      const count = f.sent.length;
      await React.act(async () => {
        if (edge === "enter setup")
          await f.handlers.get("onboarding-set-active")({ sender: f.setupSender }, true);
        else if (edge === "begin demo")
          await f.setupApi.beginOnboardingDemo({ id: "new", kind: "dictation" });
        else await f.setupApi.setOnboardingActive(false);
        await flush();
      });
      assert.equal(h.manager() === original, true, "same recorder owner");
      assert.equal(
        phase === "recording" ? original.isRecording : original.isProcessing,
        true,
        "setup lifecycle must not cancel unrelated workspace audio"
      );
      assert.equal(
        f.sent.slice(count).some(([name]) => name.includes("cancel")),
        false
      );
      await React.act(async () => {
        if (!stop) stop = original.mediaRecorder.stop();
        await flush();
        h.result().resolve({ success: true, text: "public fixture", rawText: "public fixture" });
        await stop;
        await flush();
      });
      assert.equal(h.writes.filter(([kind]) => kind === "history").length, 1);
      assert.equal(h.writes.filter(([kind]) => kind === "audio").length, 1);
    });
  }

test("control: original public recorder completes normally without a setup lifecycle edge", async (t) => {
  const h = await mountTrial(t, false);
  await (await h.start(null)).finish();
  const owner = h.manager();
  let done;
  await React.act(async () => {
    done = owner.mediaRecorder.stop();
    await flush();
  });
  await React.act(async () => {
    h.result().resolve({ success: true, text: "public fixture", rawText: "public fixture" });
    await done;
    await flush();
  });
  assert.equal(h.writes.filter(([kind]) => kind === "history").length, 1);
  assert.equal(h.writes.filter(([kind]) => kind === "audio").length, 1);
});

// Real main handler -> real preload -> actual hook/AudioManager. Hardware,
// provider result, DB/clipboard/paste sinks and Electron delivery are fixtures.
async function connected(t, privateMode = false, options = {}) {
  const f = bridgeFixture({ admissionOwner: false, ...options.transport });
  f.manager.setOnboardingActive(false);
  const h = await mountTrial(t, privateMode, { bridge: f, ...options });
  f.overlayApi.onCancelDictation((payload) => appListener("onCancelDictation", h)(payload));
  f.overlayApi.onCancelHotkeyPressed(() => appListener("onCancelHotkeyPressed", h)());
  t.after(() => f.context.onboardingAdmission.dispose());
  return { f, h };
}
const currentTake = (f) => f.manager._onboardingDemoSession?.takeId ?? null;
const toggle = (f, id) => f.setupApi.toggleOnboardingDemo(id, currentTake(f));
async function idleDemo(f, id = "A", kind = "dictation") {
  assert.equal(await f.setupApi.beginOnboardingDemo({ id, kind }), true, "actual idle admission");
}
async function startDemo(f, h, id = "A") {
  await React.act(async () => {
    assert.equal(await toggle(f, id), true);
    await h.waitAcquisition();
  });
  await React.act(async () => {
    h.mic().resolve({ getTracks: () => [], getAudioTracks: () => [] });
    await flush();
  });
  assert.equal(h.manager().isRecording, true);
  return f.sent.findLast(([name]) => name === "start-dictation" || name === "toggle-dictation")[1]
    .onboardingTake;
}
async function completePublic(h, stop) {
  await React.act(async () => {
    if (!stop) stop = h.manager().mediaRecorder.stop();
    await flush();
    h.result().resolve({ success: true, text: "public words", rawText: "public words" });
    await stop;
    await flush();
  });
}

test("idle positive actually records privately and stops with raw words but no external writes", async (t) => {
  const { f, h } = await connected(t);
  await idleDemo(f);
  const take = await startDemo(f, h);
  assert.equal(typeof take.takeId, "string");
  assert.equal(typeof take.reservationId, "string");
  assert.equal(
    h.manager()._recordingPrivate,
    true,
    "reservation forces captured private policy even before storage event"
  );
  await React.act(async () => {
    assert.equal(await f.setupApi.stopOnboardingDemo("A", take.takeId), true);
    await flush();
  });
  await React.act(async () => {
    h.result().resolve({ success: true, text: "Clean words", rawText: "um raw words" });
    await flush();
  });
  assert.equal(h.events.findLast((event) => event.status === "success").rawText, "um raw words");
  assert.equal(
    f.broadcasts.findLast(([, event]) => event.status === "success")[1].rawText,
    "um raw words"
  );
  assert.deepEqual(h.writes, []);
  assert.equal(h.manager().lastAudioBlob, null);
  await React.act(async () => {
    await f.setupApi.endOnboardingDemo("A");
    await flush();
  });
});

for (const phase of ["preparation", "acquisition", "recording", "processing", "saver"]) {
  test(`original public ${phase} refuses actual admission without replacement, then idle admits`, async (t) => {
    const { f, h } = await connected(t);
    let start, stop, row;
    if (phase === "preparation") {
      await React.act(async () => {
        f.manager.sendPrepareDictation();
        await flush();
      });
      assert.equal(h.api().isPreparing, true);
    } else {
      start = await h.start(null);
      if (phase !== "acquisition") await start.finish();
      if (["processing", "saver"].includes(phase)) {
        if (phase === "saver") {
          row = deferred();
          h.window.electronAPI.saveTranscription = async (...args) => {
            h.writes.push(["history", ...args]);
            return row.promise;
          };
        }
        await React.act(async () => {
          stop = h.manager().mediaRecorder.stop();
          await flush();
        });
        if (row) {
          await React.act(async () => {
            h.result().resolve({ success: true, text: "public", rawText: "public" });
            await stop;
            await flush();
          });
          assert.equal(h.manager().isProcessing, false);
          assert.equal(
            h.manager().hasPendingRecordingWork(),
            true,
            "saver remains actual busy after visual idle"
          );
        }
      }
    }
    // Deliberately lie with a stale advisory lifecycle. The actual owner refuses.
    f.manager._dictationLifecycleState = "idle";
    assert.equal(await f.setupApi.beginOnboardingDemo({ id: "refused", kind: "dictation" }), false);
    assert.equal(f.manager._onboardingDemoSession, null);
    assert.equal(f.broadcasts.length, 0, "no fictional demo/listening");
    if (phase === "preparation") {
      await React.act(async () => {
        f.manager.sendCancelDictationPreparation();
        await flush();
      });
    } else {
      if (phase === "acquisition") await start.finish();
      if (row)
        await React.act(async () => {
          row.resolve({ id: 1 });
          await flush();
        });
      else await completePublic(h, stop);
      assert.equal(h.writes.filter(([kind]) => kind === "history").length, 1);
      assert.equal(h.writes.filter(([kind]) => kind === "audio").length, 1);
    }
    await idleDemo(f, "after");
    await f.setupApi.endOnboardingDemo("after");
  });
}

test("reservation precedes acknowledgement: a queued normal start cannot become private or replace it", async (t) => {
  const { f, h } = await connected(t);
  const reply = h.window.electronAPI.replyOnboardingDemoAdmission;
  const gate = deferred();
  h.window.electronAPI.replyOnboardingDemoAdmission = async (value) => {
    await gate.promise;
    return reply(value);
  };
  const begin = f.setupApi.beginOnboardingDemo({ id: "A", kind: "dictation" });
  await flush();
  assert.equal(await h.api().startRecording(), false);
  assert.equal(h.manager().isRecording, false);
  gate.resolve();
  assert.equal(await begin, true);
  await startDemo(f, h);
  await React.act(async () => {
    await f.setupApi.cancelOnboardingDemo("A", currentTake(f));
    await flush();
  });
  assert.deepEqual(h.writes, []);
});

for (const phase of ["preparation", "acquisition", "recording", "processing"]) {
  test(`matching setup ${phase} teardown cancels only itself, late controls cannot touch new public owner`, async (t) => {
    const { f, h } = await connected(t);
    await idleDemo(f);
    let take;
    if (phase === "preparation") {
      await React.act(async () => {
        take = f.manager.sendPrepareDictation();
        await flush();
      });
    } else {
      await React.act(async () => {
        await toggle(f, "A");
        await h.waitAcquisition();
      });
      take = f.sent.findLast(([name]) => name === "toggle-dictation")[1].onboardingTake;
      if (phase !== "acquisition") {
        await React.act(async () => {
          h.mic().resolve({ getTracks: () => [], getAudioTracks: () => [] });
          await flush();
        });
        if (phase === "processing")
          await React.act(async () => {
            h.manager().mediaRecorder.stop();
            await flush();
          });
      }
    }
    await React.act(async () => {
      await f.setupApi.endOnboardingDemo("A");
      await flush();
    });
    if (phase === "acquisition")
      await React.act(async () => {
        h.mic().resolve({ getTracks: () => [], getAudioTracks: () => [] });
        await flush();
      });
    if (phase === "processing")
      await React.act(async () => {
        h.result().resolve({ success: true, text: "late private", rawText: "late private" });
        await flush();
      });
    assert.equal(h.manager().isRecording, false);
    assert.deepEqual(h.writes, []);
    await f.setupApi.setOnboardingActive(false);
    h.reset();
    await (await h.start(null)).finish();
    const generation = h.manager()._retainedCleanupOperation;
    await React.act(async () => {
      f.deliver("cancel-dictation-preparation", { onboardingTake: take });
      f.deliver("cancel-dictation", { onboardingTake: take });
      f.deliver("stop-dictation", { onboardingTake: take });
      f.deliver("onboarding-demo-reservation", {
        demoId: "A",
        requestId: take.reservationId,
        action: "release",
      });
      await f.setupApi.endOnboardingDemo("A");
      await flush();
    });
    assert.equal(h.manager().isRecording, true);
    assert.equal(h.manager()._recordingPrivate, false);
    assert.equal(h.manager()._retainedCleanupOperation === generation, true);
    await completePublic(h);
    assert.equal(h.writes.filter(([kind]) => kind === "history").length, 1);
    assert.equal(h.writes.filter(([kind]) => kind === "audio").length, 1);
  });
}

test("shortcut reservation is positive and recording-free; old release cannot end a different demo", async (t) => {
  const { f, h } = await connected(t);
  await idleDemo(f, "short", "shortcut");
  const old = f.sent.findLast(([name]) => name === "onboarding-demo-admission")[1];
  await f.manager.createHotkeyCallback()("F8");
  assert.equal(
    f.sent.some(([name]) => name === "prepare-dictation" || name === "toggle-dictation"),
    false
  );
  assert.equal(h.manager().isRecording, false);
  await f.setupApi.endOnboardingDemo("short");
  await idleDemo(f, "B");
  await startDemo(f, h, "B");
  await React.act(async () => {
    f.deliver("onboarding-demo-reservation", { ...old, action: "release" });
    await f.setupApi.endOnboardingDemo("short");
    await flush();
  });
  assert.equal(h.manager().isRecording, true);
  assert.equal(f.manager._onboardingDemoSession.id, "B");
  await React.act(async () => {
    await f.setupApi.endOnboardingDemo("B");
    await flush();
  });
  assert.deepEqual(h.writes, []);
});

test("actual streaming startup owner refuses admission while connection is pending", async (t) => {
  const { f, h } = await connected(t);
  const stream = configureStreamingStartup(t, h);
  let start;
  await React.act(async () => {
    start = h.api().startRecording();
    await h.waitAcquisition();
  });
  await React.act(async () => {
    h.mic().resolve({ getTracks: () => [], getAudioTracks: () => [] });
    await stream.waitConnect();
  });
  assert.equal(await f.setupApi.beginOnboardingDemo({ id: "busy", kind: "dictation" }), false);
  await React.act(async () => {
    stream.connect.resolve({ success: true, sessionId: 1 });
    await start;
    await flush();
  });
  assert.equal(h.manager().isRecording, true);
  await React.act(async () => {
    await h.api().cancelRecording();
    await flush();
  });
});

for (const response of ["rejected", "thrown", "missing", "false"])
  test(`actual overlay ${response} reply releases reservation and permits a later positive`, async (t) => {
    const { f, h } = await connected(t, false, { transport: { admissionTimeoutMs: 35 } });
    const reply = h.window.electronAPI.replyOnboardingDemoAdmission;
    h.window.electronAPI.replyOnboardingDemoAdmission =
      response === "rejected" || response === "thrown"
        ? response === "thrown"
          ? () => {
              throw new Error("fixture synchronous transport failure");
            }
          : async () => {
              throw new Error("fixture transport rejected");
            }
        : async () => (response === "false" ? false : undefined);
    assert.equal(await f.setupApi.beginOnboardingDemo({ id: "lost", kind: "dictation" }), false);
    assert.equal(f.manager._onboardingDemoSession, null);
    h.window.electronAPI.replyOnboardingDemoAdmission = reply;
    await flush();
    await idleDemo(f, "positive");
    await React.act(async () => {
      await f.setupApi.endOnboardingDemo("positive");
      await flush();
    });
    await (await h.start(null)).finish();
    assert.equal(h.manager()._recordingPrivate, false);
    await completePublic(h);
  });

test("StrictMode and overlay effect disposal invalidate only the captured admission", async (t) => {
  const { f, h } = await connected(t, false, { strictMode: true });
  assert.equal(h.managers.length, 2, "real StrictMode effect replay");
  await idleDemo(f);
  const old = await startDemo(f, h);
  const original = h.manager();
  await h.render(false, () => {});
  await flush();
  assert.equal(f.manager._onboardingDemoSession, null);
  assert.equal(original.isRecording, false);
  assert.equal(h.manager() === original, false);
  await f.setupApi.setOnboardingActive(false);
  h.reset();
  await (await h.start(null)).finish();
  await React.act(async () => {
    f.deliver("cancel-dictation", { onboardingTake: old });
    assert.equal(
      await f.overlayApi.invalidateOnboardingDemoAdmission({
        demoId: old.demoId,
        requestId: old.reservationId,
      }),
      false
    );
    await flush();
  });
  assert.equal(h.manager().isRecording, true);
  await completePublic(h);
});

test("setup presentation keeps normal stop and explicit user cancellation usable", async (t) => {
  const { f, h } = await connected(t);
  await (await h.start(null)).finish();
  await f.setupApi.setOnboardingActive(true);
  await React.act(async () => {
    f.manager.sendToggleDictation();
    await flush();
  });
  assert.equal(h.manager().isRecording, false);
  assert.equal(h.manager().isProcessing, true);
  await React.act(async () => {
    f.manager.sendCancelActiveDictation();
    await flush();
  });
  assert.equal(h.manager().isProcessing, false);
  await React.act(async () => {
    h.result().resolve({ success: true, text: "cancelled by user" });
    await flush();
  });
  assert.equal(h.writes.filter(([kind]) => kind === "history").length, 0);
});

test("a cancelled public recorder's deferred merge and audio saver refuse a private demo", async (t) => {
  const { f, h } = await connected(t);
  await (await h.start(null)).finish();
  h.manager().recordingStartTime = Date.now() - 2000;
  const merge = deferred(),
    row = deferred();
  h.manager().mergeRecordedSegments = () => merge.promise;
  h.window.electronAPI.saveTranscription = async (...args) => {
    h.writes.push(["history", ...args]);
    return row.promise;
  };
  // Two original segments make the real held-audio close require a merge.
  let closing;
  await React.act(async () => {
    await h.api().cancelRecording();
    h.manager()
      ._undo.peek()
      .adoptBlob(new Blob(["first public segment"]), "segment");
    closing = h.manager().flushCancelHold();
    await flush();
  });
  assert.equal(h.manager().isRecording, false);
  assert.equal(await f.setupApi.beginOnboardingDemo({ id: "merge", kind: "dictation" }), false);
  await React.act(async () => {
    merge.resolve(new Blob(["discarded public fixture"]));
    await flush();
  });
  assert.equal(await f.setupApi.beginOnboardingDemo({ id: "save", kind: "dictation" }), false);
  await React.act(async () => {
    row.resolve({ id: 8 });
    await closing;
    await flush();
  });
  assert.equal(h.writes.filter(([kind]) => kind === "history").length, 1);
  assert.equal(h.writes.filter(([kind]) => kind === "audio").length, 1);
  await idleDemo(f, "idle");
});

test("delayed duplicate old prepare/start/toggle and cancel cannot reopen a take or retire newer cleanup", async (t) => {
  const { f, h } = await connected(t);
  await idleDemo(f);
  const old = await startDemo(f, h);
  await React.act(async () => {
    await f.setupApi.stopOnboardingDemo("A", old.takeId);
    await flush();
  });
  await React.act(async () => {
    h.result().resolve({ success: true, text: "private first", rawText: "raw first" });
    await flush();
  });
  const writes = h.writes.length;
  h.reset();
  await React.act(async () => {
    for (const channel of ["prepare-dictation", "start-dictation", "toggle-dictation"])
      f.deliver(channel, { onboardingTake: old });
    await flush();
  });
  assert.equal(h.manager().isRecording, false, "completed take identity cannot be admitted twice");
  const acquisition = (async () => {
    await React.act(async () => {
      assert.equal(await toggle(f, "A"), true);
      await h.waitAcquisition(2);
    });
    await React.act(async () => {
      h.mic().resolve({ getTracks: () => [], getAudioTracks: () => [] });
      await flush();
    });
  })();
  await acquisition;
  const operation = h.manager()._retainedCleanupOperation;
  assert.ok(operation);
  await React.act(async () => {
    f.deliver("cancel-dictation-preparation", { onboardingTake: old });
    f.deliver("cancel-dictation", { onboardingTake: old });
    assert.equal(await f.setupApi.cancelOnboardingDemo("A", old.takeId), false);
    h.manager().retireCapturedCleanup({ ...operation.identity, takeId: old.takeId });
    h.manager().retireCapturedCleanup({ ...operation.identity, demoId: "different" });
    await flush();
  });
  assert.equal(h.manager().isRecording, true);
  assert.equal(
    h.manager()._retainedCleanupOperation === operation,
    true,
    "all supplied identity fields must match retirement"
  );
  const current = currentTake(f);
  await React.act(async () => {
    await f.setupApi.cancelOnboardingDemo("A", current);
    await flush();
  });
  assert.equal(h.manager()._retainedCleanupOperation, null);
  assert.equal(h.manager().isRecording, false);
  await React.act(async () => {
    f.deliver("prepare-dictation", { onboardingTake: { ...old, takeId: current } });
    f.deliver("start-dictation", { onboardingTake: { ...old, takeId: current } });
    f.deliver("cancel-dictation", { onboardingTake: { ...old, takeId: current } });
    await flush();
  });
  assert.equal(h.manager().isRecording, false, "cancelled take cannot reopen");
  assert.equal(h.writes.length, writes);
});

test("a delayed old release while another reservation is pending cannot resurrect the released admission", async (t) => {
  const { f, h } = await connected(t);
  await idleDemo(f);
  const old = f.sent.findLast(([name]) => name === "onboarding-demo-admission")[1];
  const send = f.overlaySender.send;
  let delayed;
  f.overlaySender.send = (channel, payload) => {
    if (
      channel === "onboarding-demo-reservation" &&
      payload.requestId === old.requestId &&
      payload.action === "release"
    ) {
      delayed = payload;
      return;
    }
    return send(channel, payload);
  };
  await f.setupApi.endOnboardingDemo("A");
  assert.ok(delayed);
  const reply = h.window.electronAPI.replyOnboardingDemoAdmission,
    gate = deferred();
  h.window.electronAPI.replyOnboardingDemoAdmission = async (value) => {
    await gate.promise;
    return reply(value);
  };
  const pending = f.setupApi.beginOnboardingDemo({ id: "B", kind: "dictation" });
  await flush();
  f.deliver("onboarding-demo-reservation", delayed);
  await f.setupApi.endOnboardingDemo("B");
  assert.equal(await pending, false);
  gate.resolve();
  await flush();
  await f.setupApi.setOnboardingActive(false);
  await (await h.start(null)).finish();
  assert.equal(h.manager()._recordingPrivate, false);
  await completePublic(h);
});

test("explicit matching private cancellation during acquisition publishes its actual string take once", async (t) => {
  const { f, h } = await connected(t);
  await idleDemo(f);
  await React.act(async () => {
    await toggle(f, "A");
    await h.waitAcquisition();
  });
  const take = currentTake(f);
  await React.act(async () => {
    assert.equal(await f.setupApi.cancelOnboardingDemo("A", take), true);
    assert.equal(await f.setupApi.cancelOnboardingDemo("A", take), false, "duplicate cancellation");
    await flush();
  });
  const cancelled = f.broadcasts.filter(([, event]) => event.status === "cancelled");
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0][1].takeId, take);
  assert.equal(typeof take, "string");
  await React.act(async () => {
    h.mic().resolve({ getTracks: () => [], getAudioTracks: () => [] });
    await flush();
  });
  assert.equal(h.manager().isRecording, false);
  assert.deepEqual(h.writes, []);
});

for (const method of [
  "replyOnboardingDemoAdmission",
  "onOnboardingDemoReservation",
  "invalidateOnboardingDemoAdmission",
])
  test(`partial overlay bridge missing ${method} refuses, with restored positive`, async (t) => {
    const { f, h } = await connected(t, false, { transport: { admissionTimeoutMs: 35 } });
    const saved = h.window.electronAPI[method];
    h.window.electronAPI[method] = undefined;
    assert.equal(await f.setupApi.beginOnboardingDemo({ id: "partial", kind: "dictation" }), false);
    assert.equal(f.manager._onboardingDemoSession, null);
    h.window.electronAPI[method] = saved;
    await idleDemo(f, "supported");
    await f.setupApi.endOnboardingDemo("supported");
  });

// The complete real engine manual-entry consumer, with database/navigation and
// unrelated constructor services replaced before import. No engine refusal mock.
function manualMeetingConsumer(f) {
  const saved = [],
    navigated = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("src/helpers/meetingDetectionEngine.js", "utf8"), {
    module,
    require: (name) =>
      name === "./debugLogger"
        ? { info() {}, error() {} }
        : name === "./windowBroadcast"
          ? { broadcastToWindows() {} }
          : {},
    Date,
  });
  f.manager.queueMeetingNoteNavigation = async (payload) => navigated.push(payload);
  f.manager.meetingDetectionEngine = Object.assign(Object.create(module.exports.prototype), {
    windowManager: f.manager,
    databaseManager: {
      getActiveEvents: () => [],
      saveNote: (...args) => {
        saved.push(args);
        return { note: { id: 42 } };
      },
      getMeetingsFolder: () => ({ id: 7 }),
    },
  });
  return { saved, navigated };
}

for (const phase of ["recording", "processing"]) {
  test(`setup cached ${phase} does not admit new meeting IPC or cross-kind input`, async (t) => {
    const f = bridgeFixture();
    t.after(() => f.dispose());
    await f.setupApi.setOnboardingActive(true);
    f.manager.setDictationLifecycleState(phase, "dictation");
    const meeting = manualMeetingConsumer(f);
    assert.equal(f.manager._onboardingDemoSession, null);
    await f.handlers.get("start-manual-meeting")({ sender: f.setupSender });
    assert.equal(meeting.saved.length, 0, "real engine must not create a meeting note");
    assert.equal(meeting.navigated.length, 0, "no recording navigation");
    assert.equal(f.manager.isMeetingInputAllowed(), false);
    for (const kind of ["dictation", "assistant", "translation", "meeting"])
      assert.equal(f.manager._isOnboardingInputAllowed(kind), false, kind);
    const sentBefore = f.sent.length;
    f.manager.sendStartDictation();
    f.manager.sendPrepareDictation();
    f.manager.sendToggleVoiceAgent();
    f.manager.sendToggleTranslation();
    assert.equal(f.sent.length, sentBefore, "no fresh kind/start/preparation delivery");
  });
}

test("outside setup manual meeting IPC really saves and requests recording navigation", async (t) => {
  const f = bridgeFixture();
  t.after(() => f.dispose());
  await f.setupApi.setOnboardingActive(false);
  const meeting = manualMeetingConsumer(f);
  assert.equal(f.manager.isMeetingInputAllowed(), true);
  await f.handlers.get("start-manual-meeting")({ sender: f.setupSender });
  assert.equal(meeting.saved.length, 1);
  assert.equal(meeting.saved[0][2], "meeting");
  assert.equal(meeting.navigated.length, 1);
  assert.equal(meeting.navigated[0].noteId, 42);
});

for (const cached of ["recording", "processing"]) {
  test(`setup stale cached ${cached} toggle cannot start an actually idle original overlay`, async (t) => {
    const { f, h } = await connected(t);
    await (await h.start(null)).finish();
    await completePublic(h);
    assert.equal(h.manager().hasPendingRecordingWork(), false);
    await f.setupApi.setOnboardingActive(true);
    // Deliberately retain an obsolete advisory after the actual owner completed.
    f.manager.setDictationLifecycleState(cached, "dictation");
    const sentBefore = f.sent.length;
    const writesBefore = h.writes.length;
    h.reset();
    await React.act(async () => {
      f.manager.sendToggleDictation();
      await flush();
    });
    assert.equal(h.api().isPreparing, false, "no new acquisition/preparation");
    assert.equal(h.manager().isRecording, false);
    assert.equal(h.manager().hasPendingRecordingWork(), false);
    assert.equal(h.writes.length, writesBefore);
    assert.equal(
      f.sent
        .slice(sentBefore)
        .some(([name]) =>
          ["toggle-dictation", "start-dictation", "prepare-dictation"].includes(name)
        ),
      false,
      "only the original overlay's stop-only consumer may receive a cached control"
    );
  });
}

for (const failure of ["reset", "publication", "stop"]) {
  test(`cancel ${failure} throw releases only its final-event obligation, then idle admission succeeds`, async (t) => {
    const { f, h } = await connected(t);
    await (await h.start(null)).finish();
    const owner = h.manager(),
      recorder = owner.mediaRecorder;
    const independent = deferred();
    const independentWork = owner._trackRecordingWork(() => independent.promise);
    const injected = new Error(`fixture ${failure} failure`);
    const teardown = owner.teardownSpeechGate,
      publish = owner.onStateChange,
      stop = recorder.stop;
    if (failure === "reset")
      owner.teardownSpeechGate = () => {
        throw injected;
      };
    if (failure === "publication")
      owner.onStateChange = () => {
        throw injected;
      };
    if (failure === "stop")
      recorder.stop = () => {
        throw injected;
      };
    try {
      await React.act(async () => {
        assert.throws(
          () => owner.cancelRecording(),
          (error) => error === injected,
          "original synchronous diagnostic propagates"
        );
      });
    } finally {
      owner.teardownSpeechGate = teardown;
      owner.onStateChange = publish;
      recorder.stop = stop;
    }
    const delayedFinalEvent = recorder.onstop;
    await React.act(async () => {
      // Real reset/cleanup after the injected primitive failure, not zeroing a counter.
      owner.resetDiscardedBatchRecordingState();
      await flush();
    });
    assert.equal(owner._pendingRecordingWork, 1, "independent work alone remains counted");
    assert.equal(
      await f.setupApi.beginOnboardingDemo({ id: "still-busy", kind: "dictation" }),
      false
    );
    await React.act(async () => {
      await delayedFinalEvent();
      await flush();
    });
    assert.equal(owner._pendingRecordingWork, 1, "delayed callback cannot release another owner");
    assert.equal(owner.hasPendingRecordingWork(), true);
    assert.equal(
      await f.setupApi.beginOnboardingDemo({ id: "still-busy-late", kind: "dictation" }),
      false
    );
    await React.act(async () => {
      independent.resolve();
      await independentWork;
      await flush();
    });
    assert.equal(owner._pendingRecordingWork, 0);
    assert.equal(owner.hasPendingRecordingWork(), false);
    await idleDemo(f, "recovered");
    await startDemo(f, h, "recovered");
    assert.equal(owner._recordingPrivate, true, "actual recovered admission records privately");
    await React.act(async () => {
      await f.setupApi.endOnboardingDemo("recovered");
      await flush();
    });
  });
}

for (const phase of ["recording", "processing"]) {
  test(`setup cached ${phase} keeps every fresh input admission closed`, async (t) => {
    const f = bridgeFixture();
    t.after(() => f.dispose());
    await f.setupApi.setOnboardingActive(true);
    f.manager.setDictationLifecycleState(phase, "dictation");
    for (const kind of ["dictation", "assistant", "translation", "meeting"])
      assert.equal(f.manager._isOnboardingInputAllowed(kind), false, kind);
    const sentBefore = f.sent.length;
    f.manager.sendStartDictation();
    f.manager.sendPrepareDictation();
    f.manager.sendToggleVoiceAgent();
    f.manager.sendToggleTranslation();
    assert.equal(f.sent.length, sentBefore);
  });
}

test("cancel retains its final-event obligation until the delayed final event, merge and saver settle", async (t) => {
  const { f, h } = await connected(t);
  await (await h.start(null)).finish();
  const owner = h.manager(),
    recorder = owner.mediaRecorder;
  owner.recordingStartTime = Date.now() - 2000;
  const merge = deferred(),
    row = deferred();
  owner.mergeRecordedSegments = () => merge.promise;
  h.window.electronAPI.saveTranscription = async (...args) => {
    h.writes.push(["history", ...args]);
    return row.promise;
  };
  // Faithful injected MediaRecorder primitive: stop requests a later final event.
  recorder.stop = () => {
    recorder.state = "inactive";
  };
  await React.act(async () => {
    assert.equal(await h.api().cancelRecording(), true);
    await flush();
  });
  assert.equal(owner.isRecording, false);
  assert.equal(owner._pendingRecordingWork, 1, "final event alone retains the obligation");
  assert.equal(
    await f.setupApi.beginOnboardingDemo({ id: "event-pending", kind: "dictation" }),
    false
  );
  // Close the actual hold while the final recorder event is still pending.
  owner._undo.peek().adoptBlob(new Blob(["earlier segment"]), "segment");
  let closing;
  await React.act(async () => {
    closing = owner.flushCancelHold();
    await flush();
  });
  let finalEvent;
  await React.act(async () => {
    recorder.ondataavailable({ data: new Blob(["final fixture audio"]) });
    finalEvent = recorder.onstop();
    await flush();
  });
  assert.equal(owner.hasPendingRecordingWork(), true, "hold close retains the deferred merge");
  assert.equal(
    await f.setupApi.beginOnboardingDemo({ id: "merge-pending", kind: "dictation" }),
    false
  );
  await React.act(async () => {
    merge.resolve(new Blob(["merged fixture audio"]));
    await flush();
  });
  assert.equal(owner.hasPendingRecordingWork(), true, "hold close and saver remain pending");
  assert.equal(
    await f.setupApi.beginOnboardingDemo({ id: "row-pending", kind: "dictation" }),
    false
  );
  await React.act(async () => {
    row.resolve({ id: 19 });
    await finalEvent;
    await closing;
    await flush();
  });
  assert.equal(owner._pendingRecordingWork, 0);
  assert.equal(h.writes.filter(([kind]) => kind === "history").length, 1);
  assert.equal(h.writes.filter(([kind]) => kind === "audio").length, 1);
  await idleDemo(f, "after-final-event");
});

test("delayed normal-owner stop from setup cannot stop a newly reserved demo", async (t) => {
  const { f, h } = await connected(t);
  await f.setupApi.setOnboardingActive(true);
  f.manager.setDictationLifecycleState("recording", "dictation");
  const listener = f.overlayListeners.get("stop-dictation");
  let delayed;
  f.overlayListeners.set("stop-dictation", (_event, options) => {
    delayed = options;
  });
  f.manager.sendToggleDictation();
  f.overlayListeners.set("stop-dictation", listener);
  assert.equal(delayed?.onboardingTake, null, "explicit normal-owner marker");
  // The current idle publication arrives before the next demo starts; only
  // the captured old stop command remains queued across that new reservation.
  f.manager.setDictationLifecycleState("idle", "dictation");
  await idleDemo(f);
  await startDemo(f, h);
  await React.act(async () => {
    f.deliver("stop-dictation", delayed);
    await flush();
  });
  assert.equal(h.manager().isRecording, true, "original overlay rejects the old normal control");
  await React.act(async () => {
    await f.setupApi.endOnboardingDemo("A");
    await flush();
  });
});

test("Task22 actual setup cancel → main Undo request → original hook/manager restores the same private session", async (t) => {
  const { f, h } = await connected(t);
  await idleDemo(f);
  const take = await startDemo(f, h);
  const manager = h.manager();
  const session = manager.activeSession;
  const originalRecording = manager._recordingContext;
  await React.act(async () => {
    assert.equal(await f.setupApi.cancelOnboardingDemo("A", take.takeId), true);
    await flush();
  });
  const held = manager._undo.peek();
  assert.equal(held.session, session);
  assert.equal(held.private, true);
  assert.notEqual(session.id, take.takeId);
  assert.equal(f.broadcasts.at(-1)[1].cancelled.sessionId, session.id);
  assert.throws(() => originalRecording.assertOnboardingOwner(), /owner/);
  await React.act(async () => {
    assert.equal(await f.setupApi.undoOnboardingDemoCancel("A", take.takeId, session.id), true);
    await flush();
  });
  assert.equal(manager.activeSession, session);
  assert.equal(manager._recordingPrivate, true);
  assert.equal(manager._undo.peek(), null);
  assert.notEqual(manager._recordingContext, originalRecording);
  assert.throws(
    () => originalRecording.assertOnboardingOwner(),
    /owner/,
    "Undo cannot revive the cancelled start closure"
  );
  const request = f.sent.findLast(([name]) => name === "undo-cancel-request")[1];
  assert.equal(request.sessionId, session.id);
  assert.ok(request.deadlineAt <= Date.now() + 1500);
  assert.equal(
    f.broadcasts.some(
      ([, event]) =>
        event.status === "cancelClosed" &&
        event.reason === "restored" &&
        event.sessionId === session.id
    ),
    true
  );
  await React.act(async () => {
    h.result().resolve({
      success: true,
      text: "restored private words",
      rawText: "restored private words",
    });
    await manager._restoreRun;
    await flush();
  });
  assert.equal(f.broadcasts.at(-1)[1].status, "success");
  assert.equal(f.broadcasts.at(-1)[1].takeId, take.takeId);
  assert.deepEqual(h.writes, []);
});
