const assert = require("node:assert/strict");
const test = require("node:test");
const { deferred } = require("./harness/deferred");

const load = () => import("../../src/helpers/cancelBuffer.js");
const session = { id: "rec-1", settings: {}, intents: {}, routes: {} };
const blobOf = (bytes) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer });

function timers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => (pending.set(++seq, { fn, at: now + ms }), seq),
    clearTimer: (id) => pending.delete(id),
    async advance(ms) {
      now += ms;
      for (const [id, t] of [...pending]) if (t.at <= now) (pending.delete(id), t.fn());
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    },
  };
}

test("the window is 5s, or 10s past 30s of audio", async () => {
  const { undoWindowMs } = await load();
  assert.deepEqual(
    [undoWindowMs(4), undoWindowMs(30), undoWindowMs(30.5), undoWindowMs(null)],
    [5000, 5000, 10000, 5000]
  );
});

test("the buffer owns copies of every source and zeroes them", async () => {
  const { createCancelBuffer } = await load();
  const buffer = createCancelBuffer({
    session,
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 4,
  });
  buffer.adoptBlob(blobOf([1, 2]), "segment");
  buffer.adoptBlob(blobOf([3]), "segment");
  const frame = new Int16Array([5, 6]);
  buffer.adoptFrames([frame]);
  await buffer.ready();
  const [a, b] = buffer.bytes("segment");
  assert.deepEqual([...a, ...b], [1, 2, 3]);
  buffer.zero();
  assert.deepEqual([...a, ...b, ...frame], [0, 0, 0, 0, 0]);
  assert.equal(buffer.isZeroed(), true);
  assert.deepEqual(buffer.bytes("segment"), []);
});

test("bytes that arrive after the buffer was zeroed are zeroed on arrival (I1)", async () => {
  const { createCancelBuffer } = await load();
  const late = deferred();
  const buffer = createCancelBuffer({
    session,
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 4,
  });
  buffer.adoptBlob({ arrayBuffer: () => late.promise }, "segment");
  buffer.zero();
  const arriving = new Uint8Array([7, 8, 9]);
  late.resolve(arriving.buffer);
  await buffer.ready();
  assert.deepEqual([...arriving], [0, 0, 0]);
  assert.deepEqual(buffer.bytes("segment"), []);
});

test("a rejected copy never throws and never leaves a slot", async () => {
  const { createCancelBuffer } = await load();
  const buffer = createCancelBuffer({
    session,
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 4,
  });
  buffer.adoptBlob({ arrayBuffer: () => Promise.reject(new Error("gone")) }, "segment");
  await buffer.ready();
  assert.deepEqual(buffer.bytes("segment"), []);
});

test("the window closes on time, zeroes after onClose settles, and reports why", async () => {
  const { createCancelBuffer, createUndoWindow } = await load();
  const clock = timers();
  const closed = [];
  const win = createUndoWindow({
    ...clock,
    onClose: async (buf, reason) => closed.push([buf.session.id, reason, buf.isZeroed()]),
  });
  const buffer = createCancelBuffer({
    session,
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 4,
  });
  buffer.adoptBlob(blobOf([1]), "segment");
  win.open(buffer);
  assert.deepEqual(win.state(), { undoUntil: 5000, paused: false, remainingMs: 5000 });
  await clock.advance(4999);
  assert.equal(closed.length, 0);
  await clock.advance(1);
  assert.deepEqual(closed, [["rec-1", "expired", false]], "onClose sees the bytes");
  assert.equal(buffer.isZeroed(), true, "then they are zeroed");
  assert.equal(win.peek(), null);
});

test("pause freezes the window; resume continues; a newer cancel replaces the older one", async () => {
  const { createCancelBuffer, createUndoWindow } = await load();
  const clock = timers();
  const closed = [];
  const win = createUndoWindow({
    ...clock,
    onClose: (b, reason) => closed.push([b.session.id, reason]),
  });
  const first = createCancelBuffer({
    session,
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 45,
  });
  win.open(first);
  await clock.advance(4000);
  win.pause();
  assert.deepEqual(win.state(), { undoUntil: 10000, paused: true, remainingMs: 6000 });
  await clock.advance(60_000);
  assert.equal(closed.length, 0);
  assert.deepEqual(
    win.state(),
    { undoUntil: 10000, paused: true, remainingMs: 6000 },
    "paused deadline is frozen on a second read after 60s"
  );
  win.resume();
  assert.deepEqual(win.state(), { undoUntil: 70000, paused: false, remainingMs: 6000 });
  win.open(
    createCancelBuffer({
      session: { ...session, id: "rec-2" },
      kind: "batch",
      mimeType: "audio/webm",
      durationSeconds: 1,
    })
  );
  await clock.advance(0);
  assert.deepEqual(closed, [["rec-1", "replaced"]]);
});

test("take() ends the window without closing it; expireNow is idempotent", async () => {
  const { createCancelBuffer, createUndoWindow } = await load();
  const clock = timers();
  let closes = 0;
  const win = createUndoWindow({ ...clock, onClose: () => closes++ });
  const buffer = createCancelBuffer({
    session,
    kind: "batch",
    mimeType: "audio/webm",
    durationSeconds: 4,
  });
  win.open(buffer);
  assert.equal(win.take(), buffer);
  await clock.advance(20_000);
  assert.equal(closes, 0);
  win.open(
    createCancelBuffer({ session, kind: "batch", mimeType: "audio/webm", durationSeconds: 4 })
  );
  await win.expireNow();
  await win.expireNow();
  assert.equal(closes, 1);
});

test("asynchronous segment copies preserve recording order", async () => {
  const { createCancelBuffer } = await load();
  let deliver;
  const buffer = createCancelBuffer({ session, kind: "batch" });
  buffer.adoptBlob(
    {
      arrayBuffer: () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    },
    "segment"
  );
  buffer.adoptBlob(blobOf([2]), "segment");
  await Promise.resolve();
  deliver(Uint8Array.of(1).buffer);
  await buffer.ready();
  assert.deepEqual(
    buffer.bytes("segment").map((bytes) => [...bytes]),
    [[1], [2]]
  );
  buffer.zero();
});

test("transferred frame views erase only their owned span and retain no frames afterwards", async () => {
  const { createCancelBuffer } = await load();
  const storage = new Int16Array([99, 1, 2, 88]);
  const frame = storage.subarray(1, 3);
  const buffer = createCancelBuffer({ session, kind: "streaming" });
  buffer.adoptFrames([frame]);
  assert.equal(buffer.frames()[0], frame);
  buffer.zero();
  assert.deepEqual([...storage], [99, 0, 0, 88]);
  assert.deepEqual(buffer.frames(), []);
  const late = storage.subarray(0, 1);
  buffer.adoptFrames([late]);
  assert.deepEqual([...storage], [0, 0, 0, 88]);
});
