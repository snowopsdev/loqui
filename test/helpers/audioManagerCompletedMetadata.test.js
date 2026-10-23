const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const {
  mountTrial,
  configureStreamingStartup,
  deferred,
  flush,
} = require("./harness/audioRecordingTrial");

// Actual start/finalization -> mounted useAudioRecording completion -> actual
// saver. Only hardware/provider/persistence leaves and scheduling are synthetic.
function pauseSaves(manager) {
  const save = manager.saveTranscription.bind(manager);
  const entries = [];
  manager.saveTranscription = (...args) => {
    const gate = deferred();
    const done = gate.promise.then(() => save(...args));
    entries.push({ args, resume: gate.resolve, done });
    return done;
  };
  return entries;
}
async function start(t, h, route, model, privateMode = false) {
  const stream =
    route === "streaming"
      ? configureStreamingStartup(t, h, { cloudTranscriptionModel: model })
      : null;
  if (!stream) Object.assign(globalThis.__trialBoundarySettings, { whisperModel: model });
  if (stream) {
    h.window.electronAPI.dictationRealtimeStop = async () => ({ success: true, model });
    stream.connect.resolve({ success: true });
  }
  await (await h.start(privateMode ? undefined : null)).finish();
  assert.equal(h.manager().isRecording, true);
  return stream;
}
async function finish(h, stream, durationMs, text) {
  const manager = h.manager();
  let stop;
  await React.act(async () => {
    if (stream) stream.listeners.final(text);
    // Date is replaced only across the synchronous duration snapshot, never
    // across any await or renderer import. Production computes duration itself.
    const originalNow = Date.now;
    const epoch = originalNow();
    manager.recordingStartTime = epoch - durationMs;
    Date.now = () => epoch;
    try {
      stop = stream ? manager.stopStreamingRecording() : manager.mediaRecorder.stop();
    } finally {
      Date.now = originalNow;
    }
    if (!stream) h.result().resolve({ success: true, text, rawText: text, source: "whisper" });
    await stop;
    await flush();
  });
}
async function persist(entry) {
  await React.act(async () => {
    entry.resume();
    assert.equal(await entry.done, true);
    await flush();
  });
}
function assertMetadata(h, index, expected) {
  const audio = h.writes.filter(([kind]) => kind === "audio")[index];
  const analytics = h.writes.filter(([kind]) => kind === "analytics")[index]?.[1];
  assert.ok(audio, "actual saver wrote captured audio");
  assert.deepEqual(audio[3], expected, "saved audio has THIS completed recording's metadata");
  assert.deepEqual(
    {
      durationMs: analytics?.spokenDurationMs,
      provider: analytics?.provider,
      model: analytics?.model,
    },
    expected,
    "analytics attributes THIS recording"
  );
}
for (const route of ["batch", "streaming"]) {
  const modelA = route === "batch" ? "base" : "gpt-4o-mini-transcribe";
  const modelB = route === "batch" ? "small" : "gpt-4o-transcribe";
  const provider = route === "batch" ? "whisper" : "openai-realtime-streaming";
  for (const newer of [false, true]) {
    test(`IR1 ${route}: completed metadata survives ${newer ? "newer B completing before A's save" : "pipeline/hook/saver"}`, async (t) => {
      const h = await mountTrial(t, false);
      const manager = h.manager();
      const saves = pauseSaves(manager);
      const a = await start(t, h, route, modelA);
      await finish(h, a, 3456, "original A words");
      assert.equal(saves.length, 1, "real hook called the saver");
      const recordingA = saves[0].args[2].recording;
      const ownerA = recordingA.ownedAudio;
      assert.ok(Object.isFrozen(ownerA));
      assert.deepEqual(recordingA.audioMetadata, { durationMs: 3456, provider, model: modelA });
      let ownerB;
      if (newer) {
        h.reset();
        const b = await start(t, h, route, modelB);
        await finish(h, b, 9876, "newer B words");
        assert.equal(saves.length, 2);
        ownerB = saves[1].args[2].recording.ownedAudio;
        assert.notEqual(ownerA.sessionId, ownerB.sessionId);
        assert.notEqual(ownerA.ownerToken, ownerB.ownerToken);
        assert.deepEqual(manager.lastAudioMetadata, { durationMs: 9876, provider, model: modelB });
      }
      await persist(saves[0]);
      assertMetadata(h, 0, { durationMs: 3456, provider, model: modelA });
      if (newer) {
        assert.equal(manager.lastAudioBlob, ownerB.blob, "A cannot release B's audio");
        assert.equal(manager._ownedAudioSnapshot().ownerToken, ownerB.ownerToken);
        await persist(saves[1]);
        assertMetadata(h, 1, { durationMs: 9876, provider, model: modelB });
      }
      assert.equal(manager.lastAudioBlob, null);
    });
  }
  test(`IR1 ${route}: private completed recording still bypasses all persistence`, async (t) => {
    const h = await mountTrial(t, true);
    const saves = pauseSaves(h.manager());
    const stream = await start(t, h, route, modelA, true);
    await finish(h, stream, 3456, "private words");
    assert.equal(saves.length, 0, "actual hook bypasses public saver");
    assert.deepEqual(h.writes, []);
    assert.equal(h.manager().lastAudioBlob, null);
  });
}

test("IR1 restored batch: original duration/provider/model reach the real hook and saver", async (t) => {
  const h = await mountTrial(t, false);
  const manager = h.manager();
  const saves = pauseSaves(manager);
  await start(t, h, "batch", "base");
  const session = manager.activeSession;
  await React.act(async () => {
    const originalNow = Date.now;
    const epoch = originalNow();
    manager.recordingStartTime = epoch - 3456;
    Date.now = () => epoch;
    try {
      assert.equal(manager.cancelRecording(), true);
    } finally {
      Date.now = originalNow;
    }
    await flush();
    assert.equal((await manager.restoreCancelled(session.id)).restored, true);
    h.result().resolve({
      success: true,
      text: "restored words",
      rawText: "restored words",
      source: "whisper",
    });
    await manager._restoreRun;
    await flush();
  });
  assert.equal(saves.length, 1);
  assert.equal(saves[0].args[2].recording.ownedAudio.sessionId, session.id);
  await persist(saves[0]);
  assertMetadata(h, 0, { durationMs: 3456, provider: "whisper", model: "base" });
});
