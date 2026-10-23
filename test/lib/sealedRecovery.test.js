const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const load = () => import("../../src/lib/sealedRecovery.ts");

const sealed = { code: "SEALED_MODE", message: "[SEALED_MODE] Sealed mode is on" };

const operation = (n, { privateTake = false, sessionId = `s-${n}` } = {}) => {
  let selection = "captured";
  let releaseCount = 0;
  let disposed = 0;
  const context = {
    sessionId,
    selection: () => selection,
    get released() {
      return releaseCount > 0;
    },
    get releaseCount() {
      return releaseCount;
    },
    release() {
      if (releaseCount > 0) return;
      releaseCount++;
      selection = null;
    },
  };
  const tracker = {
    dispose: () => disposed++,
    get disposed() {
      return disposed;
    },
  };
  return Object.freeze({
    owned: Object.freeze({
      blob: new Blob([`audio-${n}`]),
      sessionId,
      private: privateTake,
      metadata: Object.freeze({ n }),
    }),
    session: Object.freeze({ id: sessionId, private: privateTake }),
    context,
    tracker,
  });
};

test("held only for a sealed failure whose audio no saver kept, or a private take", async () => {
  const { shouldHoldInMemory } = await load();
  assert.equal(shouldHoldInMemory(sealed, { audioKept: false }), true);
  assert.equal(shouldHoldInMemory(sealed), true, "no acknowledgement is not a History copy");
  assert.equal(shouldHoldInMemory(sealed, { audioKept: true }), false, "History holds it");
  assert.equal(shouldHoldInMemory(sealed, { audioKept: true, privateTake: true }), true);
  assert.equal(shouldHoldInMemory(new Error("timeout"), { audioKept: false }), false);
});

test("oldest first, bounded, and expired recordings are dropped, each closed once", async (t) => {
  const r = await load();
  r.discardRecovery();
  t.after(() => r.discardRecovery());
  let notified = 0;
  const off = r.subscribeRecovery(() => notified++);
  const ops = [1, 2, 3, 4].map((n) => operation(n));
  ops.forEach((op, index) => r.holdForRecovery(op, index * 10));
  assert.equal(r.recoveryCount(30), r.RECOVERY_MAX, "bounded");
  assert.equal(ops[0].context.releaseCount, 1, "bound eviction closes the dropped context");
  assert.equal(ops[0].tracker.disposed, 1, "and its tracker");
  const claimed = r.claimRecovery(30);
  assert.equal(claimed.operation.owned.metadata.n, 2, "the oldest remaining entry is first");
  assert.equal(r.claimRecovery(30), null, "one claim at a time");
  r.releaseRecovery(claimed.id, { done: true });
  assert.equal(ops[1].context.releaseCount, 1, "successful terminal close releases once");
  assert.equal(r.recoveryCount(20 + r.RECOVERY_TTL_MS + 1), 1, "expired entries go");
  assert.equal(ops[2].context.releaseCount, 1, "expiry closes its context");
  assert.equal(ops[3].context.releaseCount, 0, "the newer entry is still live");
  r.discardRecovery();
  assert.equal(ops[3].context.releaseCount, 1, "discard closes its context");
  r.discardRecovery();
  assert.equal(ops[3].context.releaseCount, 1, "never twice");
  off();
  assert.ok(notified >= 5);
});

test("a claim keeps the hold until the replay succeeds; a failed replay keeps it for another try", async (t) => {
  const r = await load();
  r.discardRecovery();
  t.after(() => r.discardRecovery());
  const original = operation(1, { privateTake: true, sessionId: "private-old" });
  const id = r.holdForRecovery(original, 0);
  const first = r.claimRecovery(0);
  assert.equal(first.id, id);
  assert.equal(first.operation === original, true, "claim returns the same immutable operation");
  r.discardRecovery();
  assert.equal(r.recoveryCount(0), 1, "discard never drops a hold that is being replayed");
  assert.equal(r.recoveryCount(r.RECOVERY_TTL_MS * 2), 1, "nor does expiry");
  r.releaseRecovery(id, { done: false });
  assert.equal(original.context.released, false, "a failed replay retains the press-time reads");
  const again = r.claimRecovery(0);
  assert.deepEqual(
    [
      again.id,
      again.operation.owned.sessionId,
      again.operation.owned.private,
      again.operation.context.selection(),
    ],
    [id, "private-old", true, "captured"]
  );
  r.releaseRecovery(id, { done: true });
  assert.equal(r.recoveryCount(0), 0);
  assert.equal(original.context.releaseCount, 1);
  assert.equal(original.tracker.disposed, 1);
});

test("a full hold of claimed entries never evicts the claimed one", async (t) => {
  const r = await load();
  r.discardRecovery();
  t.after(() => r.discardRecovery());
  const a = operation("a");
  r.holdForRecovery(a, 0);
  const claim = r.claimRecovery(0);
  for (const n of [1, 2, 3]) r.holdForRecovery(operation(n), n);
  assert.equal(a.context.releaseCount, 0);
  assert.equal(r.recoveryCount(5), r.RECOVERY_MAX);
  r.releaseRecovery(claim.id, { done: false });
});

test("recovery never touches disk or IPC", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../src/lib/sealedRecovery.ts"), "utf8");
  assert.doesNotMatch(
    src,
    /electronAPI|localStorage|sessionStorage|indexedDB|saveTranscription|caches\./
  );
});

// Fix round 1, M2: the 30-minute promise is kept by a timer, not only when a
// later recovery call happens to look. No timer outlives its hold.
test("a hold expires on its own timer: context closed and audio dropped without any recovery call", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const r = await load();
  r.discardRecovery();
  t.after(() => r.discardRecovery());
  let notified = 0;
  const off = r.subscribeRecovery(() => notified++);
  t.after(off);
  const op = operation("ttl", { privateTake: true });
  r.holdForRecovery(op);
  assert.equal(r._recoveryTimersForTests(), 1, "one timer per hold");
  const before = notified;
  t.mock.timers.tick(r.RECOVERY_TTL_MS - 1);
  assert.equal(op.context.releaseCount, 0, "still within 30 minutes");
  t.mock.timers.tick(2);
  // Nothing has called hold, count or claim since: the timer did this.
  assert.equal(op.context.releaseCount, 1, "expiry closed the press-time reads once");
  assert.equal(op.tracker.disposed, 1);
  assert.equal(notified, before + 1, "subscribers learn of the expiry");
  assert.equal(r._recoveryTimersForTests(), 0, "the fired timer is gone");
  assert.equal(r.recoveryCount(), 0, "the private audio is no longer held");
  assert.equal(r.claimRecovery(), null);
});

test("a hold being replayed at expiry closes when the replay hands it back unfinished", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const r = await load();
  r.discardRecovery();
  t.after(() => r.discardRecovery());
  const op = operation("claimed-at-expiry");
  const id = r.holdForRecovery(op);
  const claim = r.claimRecovery();
  t.mock.timers.tick(r.RECOVERY_TTL_MS + 1);
  assert.equal(op.context.releaseCount, 0, "never closed under a running replay");
  assert.equal(r.recoveryCount(), 1);
  r.releaseRecovery(claim.id, { done: false });
  assert.equal(op.context.releaseCount, 1, "past its 30 minutes: closed once on return");
  assert.equal(r.recoveryCount(), 0);
  r.releaseRecovery(id, { done: false });
  assert.equal(op.context.releaseCount, 1, "never twice");
  assert.equal(r._recoveryTimersForTests(), 0);
});

test("eviction of the oldest is reported, and every terminal end clears its timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const r = await load();
  r.discardRecovery();
  t.after(() => r.discardRecovery());
  const ops = [1, 2, 3, 4].map((n) => operation(n));
  const results = ops.map((op) => r.holdForRecoveryWithEvictions(op));
  assert.deepEqual(
    results.map((x) => x.evicted),
    [0, 0, 0, 1],
    "the fourth hold reports that the oldest was dropped"
  );
  assert.equal(ops[0].context.releaseCount, 1);
  assert.equal(r._recoveryTimersForTests(), r.RECOVERY_MAX, "the evicted hold's timer is cleared");
  const claim = r.claimRecovery();
  r.releaseRecovery(claim.id, { done: true });
  assert.equal(r._recoveryTimersForTests(), r.RECOVERY_MAX - 1, "success clears its timer");
  r.discardRecovery();
  assert.equal(r._recoveryTimersForTests(), 0, "discard clears the rest");
  t.mock.timers.tick(r.RECOVERY_TTL_MS * 2);
  for (const op of ops) assert.equal(op.context.releaseCount, 1, "each closed exactly once");
  assert.equal(typeof r.holdForRecovery(operation(5)), "number", "the brief's signature stays");
  r.discardRecovery();
  assert.equal(r._recoveryTimersForTests(), 0);
});
