const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { mountTrial, deferred, flush } = require("./harness/audioRecordingTrial");

function appCancel(h) {
  const fs = require("node:fs");
  const ts = require("typescript");
  const source = fs.readFileSync(require.resolve("../../src/App.jsx"), "utf8");
  const file = ts.createSourceFile(
    "App.jsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JSX
  );
  let callback;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "onCancelDictation"
    )
      callback = node.arguments[0].getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(
    callback,
    "exercise the actual App cancellation listener, without mounting unrelated surfaces"
  );
  const api = h.api();
  return new Function(
    "isRecording",
    "isPreparing",
    "isProcessing",
    "cancelRecording",
    "cancelProcessing",
    "cancelOnboardingTake",
    `return (${callback});`
  )(
    api.isRecording,
    api.isPreparing,
    api.isProcessing,
    api.cancelRecording,
    api.cancelProcessing,
    api.cancelOnboardingTake
  )();
}

test("completion during deferred microphone admission keeps the real manager and original private recording", async (t) => {
  const h = await mountTrial(t);
  const original = h.manager();
  const start = await h.start();
  await h.render(false);
  assert.equal(h.manager(), original, "setup completion must not tear down a live recording owner");
  await start.finish();
  assert.equal(original._recordingPrivate, true, "privacy captured before mic await");
  let stopped;
  await React.act(async () => {
    stopped = original.mediaRecorder.stop();
    await flush();
  });
  await h.render(true);
  await React.act(async () => {
    h.result().resolve({ success: true, text: "Finished.", rawText: "um finished" });
    await stopped;
    await flush();
  });
  assert.deepEqual(h.writes, []);
  assert.equal(h.events.at(-1).rawText, "um finished");
});

for (const outcome of ["success", "failure", "empty"]) {
  test(`a private ${outcome} after setup completes writes no history/audio/analytics/paste/clipboard`, async (t) => {
    const h = await mountTrial(t);
    await (await h.start()).finish();
    const original = h.manager();
    let stopped;
    await React.act(async () => {
      stopped = original.mediaRecorder.stop();
      await flush();
    });
    await h.render(false);
    await React.act(async () => {
      if (outcome === "failure")
        h.result().reject(Object.assign(new Error("failed fixture"), { code: "FIXTURE_FAILURE" }));
      else
        h.result().resolve({
          success: true,
          text: outcome === "empty" ? "   " : "Result.",
          rawText: "um result",
        });
      await stopped;
      await flush();
    });
    assert.deepEqual(h.writes, []);
    assert.equal(original.lastAudioBlob, null);
    if (outcome === "success") assert.equal(h.events.at(-1).rawText, "um result");
    if (outcome === "empty") assert.equal(h.events.at(-1).code, "NO_AUDIO");
  });
}

test("a public save waiting through setup restart persists only its captured audio and leaves new private recording intact", async (t) => {
  const h = await mountTrial(t, false);
  await (await h.start()).finish();
  const original = h.manager();
  const row = deferred();
  h.window.electronAPI.saveTranscription = () => row.promise;
  let stopped;
  await React.act(async () => {
    stopped = original.mediaRecorder.stop();
    await flush();
    h.result().resolve({ success: true, text: "public", rawText: "public" });
    await stopped;
    await flush();
  });
  const publicAudio = original.lastAudioBlob;
  assert.ok(publicAudio);
  await h.render(true);
  h.reset();
  // This snapshot-saver stress test starts an ordinary operation under private
  // policy. A setup demo now truthfully refuses until this public saver settles.
  await (await h.start(null)).finish();
  let privateStop;
  await React.act(async () => {
    privateStop = h.manager().mediaRecorder.stop();
    await flush();
  });
  const privateAudio = h.manager().lastAudioBlob;
  await React.act(async () => {
    row.resolve({ id: 9 });
    await flush();
  });
  assert.equal(h.manager().lastAudioBlob, privateAudio);
  const audioWrites = h.writes.filter(([kind]) => kind === "audio");
  assert.equal(audioWrites.length, 1);
  assert.equal(Buffer.from(audioWrites[0][2]).toString(), await publicAudio.text());
  await React.act(async () => {
    h.result().resolve({ success: true, text: "private" });
    await privateStop;
    await flush();
  });
  assert.equal(h.writes.filter(([kind]) => kind === "analytics").length, 1);
});

test("a private callback retained across release cannot clear a newer public or private recording", async (t) => {
  const h = await mountTrial(t);
  await (await h.start()).finish();
  const manager = h.manager();
  const callback = manager.onTranscriptionComplete;
  let snapshot, originalTake;
  manager.onTranscriptionComplete = (result, take, recording) => {
    snapshot = recording;
    originalTake = take;
    return callback(result, take, recording);
  };
  let finish;
  await React.act(async () => {
    finish = manager.mediaRecorder.stop();
    await flush();
    h.result().resolve({ success: true, text: "private" });
    await finish;
    await flush();
  });
  assert.equal(snapshot.private, true);
  assert.equal(manager.lastAudioBlob, null);
  manager.onTranscriptionComplete = callback;
  await h.releaseAdmission(originalTake);
  for (const privateMode of [false, true]) {
    await h.render(privateMode);
    h.reset();
    await (await h.start(null)).finish();
    let newerFinish;
    await React.act(async () => {
      newerFinish = manager.mediaRecorder.stop();
      await flush();
    });
    const newer = manager.lastAudioBlob;
    const writesBefore = h.writes.length;
    await React.act(async () => {
      await callback({ success: true, text: "old private" }, originalTake, snapshot);
    });
    assert.equal(manager.lastAudioBlob, newer);
    assert.equal(
      h.writes.length,
      writesBefore,
      "replayed private completion stays private after release"
    );
    await React.act(async () => {
      h.result().resolve({ success: true, text: "new result" });
      await newerFinish;
      await flush();
    });
  }
});

test("an effect rebuild during deferred start cancels the original manager without touching newer audio", async (t) => {
  const h = await mountTrial(t);
  const original = h.manager();
  const start = await h.start();
  await h.render(false, () => {});
  const newer = h.manager();
  assert.notEqual(newer, original);
  const audio = new Blob(["new private"]);
  newer.lastAudioBlob = audio;
  newer.lastAudioBlobPrivate = true;
  await start.finish();
  assert.equal(
    original.isRecording,
    false,
    "the old admitted start is cancelled by its own manager"
  );
  assert.equal(newer.lastAudioBlob, audio);
  assert.deepEqual(h.writes, []);
});

test("an effect rebuild during a deferred private result cannot borrow the new manager", async (t) => {
  const h = await mountTrial(t);
  await (await h.start()).finish();
  const original = h.manager();
  let finish;
  await React.act(async () => {
    finish = original.mediaRecorder.stop();
    await flush();
  });
  await h.render(false, () => {});
  const newer = h.manager();
  const audio = new Blob(["new public"]);
  newer.lastAudioBlob = audio;
  newer.lastAudioBlobPrivate = false;
  await React.act(async () => {
    h.result().resolve({ success: true, text: "late private", rawText: "um late" });
    await finish;
    await flush();
  });
  assert.equal(original.lastAudioBlob, null);
  assert.equal(newer.lastAudioBlob, audio);
  assert.deepEqual(h.writes, []);
});

for (const exit of ["cancelRecording", "cancelProcessing"]) {
  test(`private ${exit} after completion/restart leaves no retained audio or side effects`, async (t) => {
    const h = await mountTrial(t);
    await (await h.start()).finish();
    const original = h.manager();
    let finish;
    if (exit === "cancelProcessing")
      await React.act(async () => {
        finish = original.mediaRecorder.stop();
        await flush();
      });
    await h.render(false);
    await React.act(async () => {
      await appCancel(h);
      await flush();
    });
    await h.render(true);
    if (finish)
      await React.act(async () => {
        h.result().resolve({ success: true, text: "cancelled private" });
        await finish;
        await flush();
      });
    assert.deepEqual(h.writes, []);
    const event = h.events.find((event) => event.status === "cancelled");
    assert.ok(event);
    assert.equal(event.demoId, "trial");
    assert.equal(event.takeId, "1");
    assert.equal(event.cancelled.sessionId, event.sessionId);
    assert.equal(typeof event.sessionId, "string");
    assert.notEqual(event.sessionId, event.takeId);
    assert.equal(original._undo.peek().private, true);
    await React.act(async () => original.flushCancelHold());
    assert.deepEqual(h.writes, []);
    assert.ok(!original.lastAudioBlob);
  });
}

for (const text of ["streamed private", ""]) {
  test(`streaming ${text ? "success" : "silence"} retains privacy across completion/restart and deferred fallback merge`, async (t) => {
    const h = await mountTrial(t);
    const { configureStreamingFinalization } = require("./harness/audioRecordingTrial");
    const stream = { manager: configureStreamingFinalization(h) };
    await h.render(false);
    assert.equal(stream.manager._recordingPrivate, true);
    stream.manager.streamingFinalText = text;
    const merge = deferred();
    stream.manager.mergeRecordedSegments = () => merge.promise;
    let stopped;
    await React.act(async () => {
      stopped = stream.manager.stopStreamingRecording();
      await flush();
    });
    await h.render(true);
    await h.render(false);
    await React.act(async () => {
      merge.resolve(new Blob(["private streamed audio"]));
      await stopped;
      await flush();
    });
    assert.deepEqual(h.writes, []);
    assert.equal(stream.manager.lastAudioBlob, null);
    const event = h.events.at(-1);
    assert.equal(event.demoId, "stream-private");
    assert.equal(event.takeId, "3");
    assert.equal(event.status, text ? "success" : "error");
    if (!text) assert.equal(event.code, "NO_AUDIO");
  });
}

test("private batch privacy survives the automatic default-device retry after setup completes", async (t) => {
  const h = await mountTrial(t);
  const manager = h.manager();
  let attempts = 0;
  const retry = deferred();
  manager._acquireCaptureStream = () => {
    attempts++;
    return attempts === 1 ? h.mic().promise : retry.promise;
  };
  let start;
  const take = await h.reserve({ demoId: "retry", takeId: "5" });
  await React.act(async () => {
    start = h.api().startRecording({ onboardingTake: take });
    await flush();
  });
  await h.render(false);
  await React.act(async () => {
    h.mic().reject(new DOMException("old device", "OverconstrainedError"));
    await flush();
    retry.resolve({ getAudioTracks: () => [], getTracks: () => [] });
    await start;
  });
  assert.equal(attempts, 2);
  assert.equal(manager._recordingPrivate, true);
  await React.act(async () => {
    await h.api().cancelRecording();
    await flush();
  });
  assert.deepEqual(h.writes, []);
  assert.equal(h.events.at(-1).demoId, "retry");
});

test("preparation admitted during setup stays private when setup completes before start", async (t) => {
  const h = await mountTrial(t);
  const take = { demoId: "prepared", takeId: "7" };
  await React.act(async () => {
    await h.prepare({ onboardingTake: take });
  });
  await h.render(false);
  await (await h.start(take)).finish();
  assert.equal(h.manager()._recordingPrivate, true);
  await React.act(async () => {
    await h.api().cancelRecording();
    await flush();
  });
  assert.deepEqual(h.writes, []);
});

test("leaving through the actual App cancel listener during a deferred microphone start saves nothing", async (t) => {
  const h = await mountTrial(t);
  const original = h.manager();
  const start = await h.start();
  await React.act(async () => {
    await appCancel(h);
  });
  await h.render(false);
  await start.finish();
  assert.equal(original.isRecording, false);
  assert.deepEqual(h.writes, []);
  assert.ok(h.events.some((event) => event.status === "cancelled" && event.demoId === "trial"));
});

for (const streaming of [false, true]) {
  test(`a disposed ${streaming ? "streaming" : "batch"} manager releases private audio finalized after a deferred merge`, async (t) => {
    const h = await mountTrial(t);
    let original;
    if (streaming) {
      original = require("./harness/audioRecordingTrial").configureStreamingFinalization(h);
      original.streamingFinalText = "";
    } else {
      await (await h.start()).finish();
      original = h.manager();
    }
    const merge = deferred();
    original.mergeRecordedSegments = () => merge.promise;
    let finish;
    await React.act(async () => {
      finish = streaming ? original.stopStreamingRecording() : original.mediaRecorder.stop();
      await flush();
    });
    await h.render(false, () => {});
    const newer = h.manager();
    const newAudio = new Blob(["public newer audio"]);
    newer.lastAudioBlob = newAudio;
    newer.lastAudioBlobPrivate = false;
    await React.act(async () => {
      merge.resolve(new Blob(streaming ? ["private fallback"] : []));
      await finish;
      await flush();
    });
    assert.equal(
      original.lastAudioBlob,
      null,
      "private empty completion releases even after callbacks were disposed"
    );
    assert.equal(newer.lastAudioBlob, newAudio);
    assert.deepEqual(h.writes, []);
  });
}

test("completion/restart during the real batch start's deferred recovery await retains admission privacy", async (t) => {
  const h = await mountTrial(t);
  const original = h.manager();
  const recovery = deferred();
  const entered = deferred();
  original.beginMicRecovery = () => {
    entered.resolve();
    return recovery.promise;
  };
  let start;
  const take = await h.reserve({ demoId: "deferred-start", takeId: "8" });
  await React.act(async () => {
    start = h.api().startRecording({ onboardingTake: take });
    await h.waitAcquisition();
    h.mic().resolve({ getAudioTracks: () => [], getTracks: () => [] });
    await entered.promise;
  });
  await h.render(false);
  await h.render(true);
  await React.act(async () => {
    recovery.resolve();
    await start;
  });
  assert.equal(h.manager(), original);
  assert.equal(original._recordingPrivate, true);
  await React.act(async () => {
    await appCancel(h);
    await flush();
  });
  assert.deepEqual(h.writes, []);
});
