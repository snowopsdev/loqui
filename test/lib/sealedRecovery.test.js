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
