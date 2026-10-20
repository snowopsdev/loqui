const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadAudioManager } = require("./harness/audioManager");

const RETAIN_EVERYTHING = {
  dataRetentionEnabled: true,
  audioRetentionDays: 30,
  saveDiscardedTranscriptions: true,
};

async function load(t) {
  return loadAudioManager(t, {
    cachePrefix: "loqui-private-trial-test-",
    settingsKey: "__privateTrialSettings",
    settings: RETAIN_EVERYTHING,
  });
}

function recorder(AudioManager, overrides = {}) {
  return Object.assign(Object.create(AudioManager.prototype), {
    recordingStartTime: Date.now() - 3000,
    audioChunks: [new Blob(["audio"], { type: "audio/webm" })],
    _batchSegments: [],
    recordingMimeType: "audio/webm",
    lastAudioMetadata: null,
    translationRequested: false,
    mergeRecordedSegments: async (blobs) => blobs[0],
    ...overrides,
  });
}

function heldRecording(manager) {
  manager.beginDictationSession();
  const snapshot = manager.takeDiscardedBatchSnapshot();
  const held = manager._bufferForSession("batch", snapshot);
  for (const segment of [...snapshot.segments, ...snapshot.chunks])
    held.adoptBlob(segment, "segment");
  return held;
}

async function flushBackground() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("a recording started during setup is private, and its discarded audio is never saved", async (t) => {
  const { AudioManager } = await load(t);
  const saved = [];
  const manager = recorder(AudioManager, {
    saveDiscardedTranscription: async (...args) => saved.push(args),
  });
  manager.setPrivateSession(true);
  manager._captureRecordingPrivacy();
  const snapshot = heldRecording(manager);
  assert.equal(snapshot.private, true);
  await manager._closeCancelled(snapshot, "expired");
  await flushBackground();
  assert.deepEqual(
    saved,
    [],
    "cancel or leaving the step writes nothing, even with discarded retention on"
  );
});

test("after setup, the same discard is saved when the user's retention allows it", async (t) => {
  const { AudioManager } = await load(t);
  const saved = [];
  const manager = recorder(AudioManager, {
    saveDiscardedTranscription: async (...args) => saved.push(args),
  });
  manager.setPrivateSession(false);
  manager._captureRecordingPrivacy();
  await manager._closeCancelled(heldRecording(manager), "expired");
  await flushBackground();
  assert.equal(saved.length, 1, "the guard must not swallow normal recordings");
});

test("privacy belongs to the recording, not to the moment it is saved", async (t) => {
  const { AudioManager } = await load(t);
  const manager = recorder(AudioManager);
  manager.setPrivateSession(true);
  manager._captureRecordingPrivacy();
  const snapshot = heldRecording(manager);
  manager.setPrivateSession(false); // setup completes before the async save runs
  const saved = [];
  manager.saveDiscardedTranscription = async (...args) => saved.push(args);
  await manager._closeCancelled(snapshot, "expired");
  await flushBackground();
  assert.deepEqual(saved, []);
});

test("a failed private take writes no history row and no audio", async (t) => {
  const { AudioManager, window } = await load(t);
  const writes = [];
  window.electronAPI.saveTranscription = async (...args) => (
    writes.push(["row", ...args]),
    { id: 1 }
  );
  window.electronAPI.saveTranscriptionAudio = async (...args) => (
    writes.push(["audio", ...args]),
    {}
  );
  const manager = recorder(AudioManager);
  const stampPrivate = () => {
    const blob = new Blob(["audio"]);
    if (typeof manager._setOwnedAudio === "function") {
      manager._setOwnedAudio(blob, { sessionId: "private-trial", private: true });
    } else {
      manager.lastAudioBlob = blob;
      manager.lastAudioBlobPrivate = true;
    }
  };
  stampPrivate();
  await manager.saveFailedTranscription("boom", "NETWORK", {});
  // Each saver gets a private owned recording; do not test the second against the
  // first saver's already-released state. Delayed callbacks are Plan 04's race suite.
  stampPrivate();
  await manager.saveTranscription("hello", "hello", { sessionId: "private-trial" });
  assert.deepEqual(writes, []);
  assert.equal(manager.lastAudioBlob, null, "private audio does not linger in RAM either");
});

test("every recording start captures its privacy", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../src/helpers/audioManager.js"), "utf8");
  const starts = source.match(/this\.isRecording = true;/g) ?? [];
  const captured =
    source.match(
      /this\._captureRecordingPrivacy\(recording\);\s*\n\s*this\.isRecording = true;/g
    ) ?? [];
  assert.ok(starts.length >= 2);
  assert.equal(
    captured.length,
    starts.length,
    "each `isRecording = true` is preceded by the capture"
  );
  // Spec §5.2 "Audio ownership" (aad5284): once Plan 04's setter exists, it is the only
  // writer, and privacy rides its default. Before that, the bare stamp is required.
  const owned = /_setOwnedAudio\s*\(\s*blob/.test(source);
  if (owned) {
    assert.equal(
      (
        source.match(
          /this\._setOwnedAudio\((audioBlob|fallbackBlob),\s*\{\s*sessionId: recording.sessionId,\s*private: recording.private\s*\}\);/g
        ) ?? []
      ).length,
      2,
      "both audio-carrying writes go through the setter"
    );
    assert.ok(
      (source.match(/this\._setOwnedAudio\(null\);/g) ?? []).length >= 2,
      "releasePrivateAudio and the conditional snapshot release use the setter"
    );
    assert.ok(
      (source.match(/this\._releaseOwnedAudio\(owned\)/g) ?? []).length >= 2,
      "both savers release their captured ownership snapshot"
    );
    assert.doesNotMatch(
      source,
      /if\s*\(this\.lastAudioBlobPrivate\)\s*\{[^}]*return;/,
      "mutable saver entry guards are replaced by Plan 04's snapshot checks"
    );
    const setter = source.slice(source.indexOf("  _setOwnedAudio(\n"));
    const outside = source.replace(setter.slice(0, setter.indexOf("\n  }\n") + 4), "");
    assert.doesNotMatch(
      outside,
      /this\.lastAudioBlob(?:Private)?\s*=(?!=)/,
      "no bare write outside the setter"
    );
  } else {
    const blobs =
      source.match(
        /this\.lastAudioBlob = (audioBlob|fallbackBlob);\s*\n\s*this\.lastAudioBlobPrivate = recording\.private === true;/g
      ) ?? [];
    assert.equal(blobs.length, 2, "both audio-carrying assignments record privacy");
  }
});

// Spec §5.2 (private holds, Plan 04's contract): Plan 04 replaces the immediate
// discard with a RAM hold that is saved when its window closes. An expired private
// hold is never persisted. Runs whenever the hold exists, so either merge order is
// checked; skips itself honestly before that. The seam is Plan 04's
// _closeCancelled(buffer, reason) (or _persistExpiredHold in older drafts); its
// buffer carries the recording's `private` flag.
test("an expired private undo hold saves nothing (either merge order)", async (t) => {
  const { AudioManager, window } = await load(t);
  const close = AudioManager.prototype._closeCancelled;
  assert.equal(typeof close, "function", "the actual Plan 04 owner is mandatory");
  const saved = [];
  window.electronAPI.saveTranscription = async (...args) => (
    saved.push(["row", ...args]),
    { id: 1 }
  );
  window.electronAPI.saveTranscriptionAudio = async (...args) => (
    saved.push(["audio", ...args]),
    {}
  );
  const manager = recorder(AudioManager, {
    saveDiscardedTranscription: async (...args) => saved.push(["discarded", ...args]),
  });
  manager.setPrivateSession(true);
  manager._captureRecordingPrivacy();
  const hold = {
    private: true,
    session: { id: "rec-private", settings: {}, intents: {}, routes: {} },
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 3,
    analyticsOccurredAt: new Date().toISOString(),
    bytes: () => [new Uint8Array([1, 2, 3])],
    ready: async () => {},
    zero() {},
    isZeroed: () => false,
  };
  await close.call(manager, hold, "expired");
  await flushBackground();
  assert.deepEqual(saved, [], "an expired private hold is never persisted (§5.2)");
});

function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

for (const failed of [false, true]) {
  test(`a deferred ${failed ? "failed" : "successful"} public saver never borrows or clears newer private audio`, async (t) => {
    const { AudioManager, window } = await load(t);
    const row = deferred();
    const writes = [];
    window.electronAPI.recordAnalyticsEvent = async () => {};
    window.electronAPI.saveTranscription = () => row.promise;
    window.electronAPI.saveTranscriptionAudio = async (_id, bytes) =>
      writes.push(Buffer.from(bytes).toString());
    const publicAudio = new Blob(["public audio"]);
    const privateAudio = new Blob(["private audio"]);
    const manager = recorder(AudioManager, {
      lastAudioBlob: publicAudio,
      lastAudioBlobPrivate: false,
    });
    const save = failed
      ? manager.saveFailedTranscription("failed")
      : manager.saveTranscription("public text");
    await flushBackground();
    manager.lastAudioBlob = privateAudio;
    manager.lastAudioBlobPrivate = true;
    row.resolve({ id: 12 });
    await save;
    assert.deepEqual(writes, ["public audio"]);
    assert.equal(manager.lastAudioBlob, privateAudio, "old save cannot release new private audio");
    assert.equal(manager.lastAudioBlobPrivate, true);
  });
}

for (const failed of [false, true]) {
  for (const stage of ["bytes", "audio-save"]) {
    test(`the ${failed ? "failed" : "success"} saver cannot release a new public recording while awaiting ${stage}`, async (t) => {
      const { AudioManager, window } = await load(t);
      const gate = deferred();
      const entered = deferred();
      const bytes = new Blob(["old public audio"]);
      if (stage === "bytes") bytes.arrayBuffer = () => (entered.resolve(), gate.promise);
      window.electronAPI.recordAnalyticsEvent = async () => {};
      window.electronAPI.saveTranscription = async () => ({ id: 1 });
      window.electronAPI.saveTranscriptionAudio = async () => {
        if (stage === "audio-save") {
          entered.resolve();
          await gate.promise;
        }
      };
      const manager = recorder(AudioManager, { lastAudioBlob: bytes, lastAudioBlobPrivate: false });
      const saving = failed
        ? manager.saveFailedTranscription("failed")
        : manager.saveTranscription("old");
      await entered.promise;
      const newer = new Blob(["new public audio"]);
      manager.lastAudioBlob = newer;
      manager.lastAudioBlobPrivate = false;
      gate.resolve(await Blob.prototype.arrayBuffer.call(bytes));
      await saving;
      assert.equal(manager.lastAudioBlob, newer);
    });
  }
}
