const assert = require("node:assert/strict");
const test = require("node:test");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();
const {
  normalizePresence,
  createMeetingPresence,
  buildTrayRecordingItems,
} = require("../../src/helpers/meetingPresence.js");

test("presence is liveness only, keyed by session, and rejects junk", () => {
  assert.equal(normalizePresence(null), null);
  assert.equal(normalizePresence({ recording: false, sessionId: "m1", startedAt: 5 }), null);
  assert.equal(normalizePresence({ recording: true, startedAt: 5 }), null, "no session id");
  assert.equal(normalizePresence({ recording: true, sessionId: "m1", startedAt: "x" }), null);
  assert.deepEqual(
    normalizePresence({
      recording: true,
      sessionId: "m1",
      startedAt: 1000,
      interruption: "nope",
      quiet: 1,
    }),
    {
      sessionId: "m1",
      startedAt: 1000,
      interruption: null,
      quiet: true,
    }
  );
});

test("changes are emitted once per real change", () => {
  const seen = [];
  const presence = createMeetingPresence({ onChange: (p) => seen.push(p) });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000, quiet: true });
  presence.set(7, { recording: false });
  assert.equal(seen.length, 3);
  assert.equal(seen.at(-1), null);
});

test("presence clears when the owner goes away, and that is reported as ownerLost, never saved", () => {
  const lost = [];
  const presence = createMeetingPresence({
    onChange: () => {},
    onOwnerLost: (sessionId) => lost.push(sessionId),
  });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.clearIfOwner(8);
  assert.notEqual(presence.get(), null);
  presence.clearIfOwner(7);
  assert.equal(presence.get(), null);
  assert.deepEqual(lost, ["m1"]);
  presence.clearIfOwner(7);
  assert.deepEqual(lost, ["m1"], "exactly once");
});

test("a normal acknowledged stop clears pending ownership without an ownerLost report", () => {
  const lost = [];
  const presence = createMeetingPresence({
    onChange: () => {},
    onOwnerLost: (id) => lost.push(id),
  });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.set(7, { recording: false });
  assert.equal(presence.get(), null);
  assert.ok(
    presence.settleOutcome(7, { sessionId: "m1", kind: "saved", durationMs: 1000, noteId: "11" })
  );
  presence.clearIfOwner(7);
  assert.deepEqual(lost, []);
});

test("the tray leads with a recording line and a Stop item while recording", () => {
  const t = (key, opts) => (opts ? `${key}:${opts.elapsed}` : key);
  assert.deepEqual(buildTrayRecordingItems(null, { t, now: 0 }), []);
  assert.deepEqual(
    buildTrayRecordingItems(
      { sessionId: "m1", startedAt: 0, interruption: null, quiet: false },
      { t, now: 761_000 }
    ),
    [
      { label: "tray.meetingRecording:12:41", enabled: false },
      { label: "tray.stopMeetingRecording", action: "stop" },
    ]
  );
});

test("the recording dot lands in the bottom-right corner in Signal orange", () => {
  const { paintRecordingDot } = require("../../src/helpers/trayRecordingIcon.js");
  const out = paintRecordingDot(Buffer.alloc(16 * 16 * 4), 16, 16);
  const px = (x, y) => [...out.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  assert.deepEqual(px(12, 12), [0x1f, 0x5a, 0xff, 0xff]);
  assert.deepEqual(px(1, 1), [0, 0, 0, 0]);
});

test("ended liveness retains pending results until an exact valid owner/session outcome or loss", () => {
  const lost = [];
  const a = { id: 7 },
    b = { id: 7 };
  const presence = createMeetingPresence({ onOwnerLost: (id) => lost.push(id) });
  presence.set(a, { recording: true, sessionId: "A", startedAt: 1000 });
  presence.set(a, { recording: false });
  assert.equal(presence.get(), null);
  presence.set(b, { recording: true, sessionId: "B", startedAt: 2000 });
  const saved = { sessionId: "A", kind: "saved", durationMs: 1000, noteId: "11" };
  assert.equal(presence.settleOutcome(b, saved), null, "same numeric owner id cannot claim A");
  assert.equal(
    presence.settleOutcome(a, { ...saved, noteId: undefined }),
    null,
    "missing saved payload cannot retire A"
  );
  for (const malformed of [
    { ...saved, durationMs: Infinity },
    { ...saved, durationMs: -1 },
    { ...saved, noteId: {} },
    { ...saved, kind: "other" },
    { sessionId: "A", kind: "failed", reason: "unknown" },
  ])
    assert.equal(presence.settleOutcome(a, malformed), null);

  assert.equal(presence.settleOutcome(a, { ...saved, sessionId: "B" }), null, "A cannot settle B");
  presence.set(a, { recording: false });
  presence.set(b, { recording: false, sessionId: "A" });
  assert.equal(presence.get().sessionId, "B", "same-owner stale explicit false cannot clear B");
  presence.clearIfOwner(a);
  assert.deepEqual(lost, ["A"]);
  assert.equal(presence.get().sessionId, "B");
  assert.equal(presence.settleOutcome(a, saved), null, "lost A cannot revive via late outcome");
  presence.clearIfOwner(a);
  assert.deepEqual(lost, ["A"]);
  const bResult = { ...saved, sessionId: "B" };
  presence.set(b, { recording: false, sessionId: "B" });
  assert.equal(presence.get(), null, "matching explicit false returns liveness to idle");
  assert.deepEqual(presence.settleOutcome(b, bResult), bResult);
  assert.equal(presence.settleOutcome(b, bResult), null, "duplicate outcome retires nothing");
  presence.clearIfOwner(b);
  assert.deepEqual(lost, ["A"], "acknowledged B does not fail on later owner loss");
  presence.set(b, { recording: true, sessionId: "C", startedAt: 3000 });
  presence.set(b, { recording: false });
  const failed = { sessionId: "C", kind: "failed", reason: "save" };
  assert.deepEqual(presence.settleOutcome(b, failed), failed);
  presence.clearIfOwner(b);
  assert.deepEqual(lost, ["A"], "explicit failed outcomes also retire their pending ownership");
});

test("genuine owner loss settles both its pending A and live B exactly once", () => {
  const lost = [];
  const owner = { id: 7 };
  const presence = createMeetingPresence({ onOwnerLost: (id) => lost.push(id) });
  presence.set(owner, { recording: true, sessionId: "A", startedAt: 1000 });
  presence.set(owner, { recording: false });
  presence.set(owner, { recording: true, sessionId: "B", startedAt: 2000 });
  presence.clearIfOwner(owner);
  assert.equal(presence.get(), null);
  assert.deepEqual(lost, ["A", "B"]);
  presence.clearIfOwner(owner);
  assert.deepEqual(lost, ["A", "B"]);
});
