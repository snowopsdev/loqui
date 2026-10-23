const assert = require("node:assert/strict");
const test = require("node:test");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function load(t, electronAPI) {
  const outcomes = [];
  const api = { ...electronAPI, reportMeetingRecordingOutcome: (o) => outcomes.push(o) };
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-meeting-outcome-",
    mockModules: {
      "/utils/logger": "export default {error(){},warn(){},info(){},debug(){}}",
      "/stores/settingsStore":
        "export const getSettings = () => ({}); export const selectResolvedMeetingTranscription = () => ({});",
    },
  });
  const store = await vite.ssrLoadModule("/stores/meetingRecordingStore.ts");
  return { store, outcomes, api };
}

const ok = async () => ({ success: true });

test("a saved meeting reports saved only after the write and the stop were acknowledged", async (t) => {
  const { store, outcomes } = await load(t, {
    updateNote: async () => ({ success: true, note: {} }),
    meetingTranscriptionStop: async () => ({ success: true }),
  });
  store.__primeRecordingForTests({
    sessionId: "m1",
    noteId: 11,
    startedAt: Date.now() - 1000,
    segments: [{ id: "s1", source: "mic", text: "hi" }],
  });
  const result = await store.stopRecording("m1");
  assert.equal(result.persisted, true);
  assert.equal(result.stopError, false);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].kind, "saved");
  assert.equal(outcomes[0].sessionId, "m1");
  assert.equal(outcomes[0].noteId, "11");
});

test("a write that returns failure, returns nothing, throws or has no API is a failed save, never 'saved' (R1-I14)", async (t) => {
  const { store, outcomes, api } = await load(t, { meetingTranscriptionStop: ok });
  const failingWrites = {
    "note gone (database.js:1194)": async () => ({ success: false, error: "Note not found" }),
    "nothing written (database.js:1231)": async () => ({ success: false }),
    "no result": async () => undefined,
    threw: async () => {
      throw new Error("disk full");
    },
    "no API": undefined,
  };
  for (const [label, updateNote] of Object.entries(failingWrites)) {
    api.updateNote = updateNote;
    outcomes.length = 0;
    const sessionId = `m-${label}`;
    store.__primeRecordingForTests({
      sessionId,
      noteId: 11,
      startedAt: Date.now(),
      segments: [{ id: "s1", source: "mic", text: "hi" }],
    });
    const result = await store.stopRecording(sessionId);
    assert.equal(result.persisted, false, label);
    assert.deepEqual(outcomes, [{ sessionId, kind: "failed", reason: "save" }], label);
  }
});

test("a stop main did not acknowledge is a failed stop, never 'saved' (R1-I14)", async (t) => {
  const { store, outcomes, api } = await load(t, {
    updateNote: async () => ({ success: true, note: {} }),
  });
  const failingStops = {
    "stale session (meetingTranscriptionLifecycle.js:39-43)": async () => ({
      success: false,
      reason: "stale-session",
    }),
    "teardown error": async () => ({ success: false, error: "socket closed" }),
    "no result": async () => undefined,
    threw: async () => {
      throw new Error("ipc gone");
    },
    "no API": undefined,
  };
  for (const [label, meetingTranscriptionStop] of Object.entries(failingStops)) {
    api.meetingTranscriptionStop = meetingTranscriptionStop;
    outcomes.length = 0;
    const sessionId = `m-${label}`;
    store.__primeRecordingForTests({
      sessionId,
      noteId: 11,
      startedAt: Date.now(),
      segments: [{ id: "s1", source: "mic", text: "hi" }],
    });
    const result = await store.stopRecording(sessionId);
    assert.equal(result.persisted, true, label);
    assert.equal(result.stopError, true, label);
    assert.deepEqual(outcomes, [{ sessionId, kind: "failed", reason: "stop" }], label);
  }
});

test("an empty meeting (no segments, no fallback transcript) is saved: there was nothing to write", async (t) => {
  let writes = 0;
  const { store, outcomes } = await load(t, {
    updateNote: async () => (writes++, { success: true }),
    meetingTranscriptionStop: ok,
  });
  store.__primeRecordingForTests({
    sessionId: "m1",
    noteId: 11,
    startedAt: Date.now(),
    segments: [],
  });
  const result = await store.stopRecording("m1");
  assert.equal(writes, 0, "nothing to write");
  assert.equal(result.persisted, true);
  assert.equal(outcomes.at(-1).kind, "saved");
});

test("a transcript with no note to write to is a failed save, not a no-write", async (t) => {
  const { store, outcomes } = await load(t, { updateNote: ok, meetingTranscriptionStop: ok });
  store.__primeRecordingForTests({
    sessionId: "m1",
    noteId: null,
    startedAt: Date.now(),
    segments: [{ id: "s1", source: "mic", text: "hi" }],
  });
  const result = await store.stopRecording("m1");
  assert.equal(result.persisted, false);
  assert.deepEqual(outcomes, [{ sessionId: "m1", kind: "failed", reason: "save" }]);
});

test("a stop for another session is ignored, and duplicate stops report once", async (t) => {
  const { store, outcomes } = await load(t, { updateNote: ok, meetingTranscriptionStop: ok });
  store.__primeRecordingForTests({
    sessionId: "m1",
    noteId: 11,
    startedAt: Date.now(),
    segments: [],
  });
  assert.equal((await store.stopRecording("m-other")).stopped, false);
  await Promise.all([store.stopRecording("m1"), store.stopRecording("m1")]);
  assert.equal(outcomes.length, 1);
});

test("an outcome waits for both acknowledged writes and Stop; save failure wins when both fail", async (t) => {
  let writeResolve, stopResolve;
  const write = new Promise((resolve) => {
    writeResolve = resolve;
  });
  const stop = new Promise((resolve) => {
    stopResolve = resolve;
  });
  const { store, outcomes, api } = await load(t, {
    updateNote: () => write,
    meetingTranscriptionStop: () => stop,
  });
  store.__primeRecordingForTests({
    sessionId: "A",
    noteId: 11,
    startedAt: Date.now(),
    segments: [{ id: "s", source: "mic", text: "hi" }],
  });
  const stopping = store.stopRecording("A");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outcomes.length, 0);
  stopResolve({ success: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outcomes.length, 0, "Stop ACK alone cannot claim saved");
  writeResolve({ success: true });
  assert.equal((await stopping).persisted, true);
  assert.equal(outcomes[0].kind, "saved");
  api.updateNote = async () => ({ success: false });
  api.meetingTranscriptionStop = async () => ({ success: false, error: "gone" });
  outcomes.length = 0;
  store.__primeRecordingForTests({
    sessionId: "B",
    noteId: 11,
    startedAt: Date.now(),
    segments: [{ id: "s", source: "mic", text: "hi" }],
  });
  const failed = await store.stopRecording("B");
  assert.equal(failed.persisted, false);
  assert.equal(failed.stopError, true);
  assert.deepEqual(outcomes, [{ sessionId: "B", kind: "failed", reason: "save" }]);
});

test("main's fallback transcript requires a write ACK too", async (t) => {
  let written;
  const { store, outcomes } = await load(t, {
    meetingTranscriptionStop: async () => ({ success: true, transcript: "final main words" }),
    updateNote: async (_id, payload) => {
      written = payload.transcript;
      return { success: false };
    },
  });
  store.__primeRecordingForTests({
    sessionId: "A",
    noteId: 11,
    startedAt: Date.now(),
    segments: [],
  });
  const result = await store.stopRecording("A");
  assert.equal(written, "final main words");
  assert.equal(result.persisted, false);
  assert.deepEqual(outcomes, [{ sessionId: "A", kind: "failed", reason: "save" }]);
});
