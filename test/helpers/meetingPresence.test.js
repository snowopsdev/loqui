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

test("a normal stop clears presence without an ownerLost report", () => {
  const lost = [];
  const presence = createMeetingPresence({
    onChange: () => {},
    onOwnerLost: (id) => lost.push(id),
  });
  presence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  presence.set(7, { recording: false });
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
