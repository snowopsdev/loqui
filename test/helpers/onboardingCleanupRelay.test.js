const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createOnboardingCleanupRelay } = require("../../src/helpers/onboardingCleanupRelay");
const sender = (id) =>
  Object.assign(new EventEmitter(), {
    id,
    isDestroyed: () => false,
    sent: [],
    send(...args) {
      this.sent.push(args);
    },
  });
function fixture(t) {
  const setup = sender(1),
    overlay = sender(2),
    stranger = sender(3),
    retired = [];
  let session = { id: "demo-a", kind: "dictation", takeId: "take-a", takeClosed: true };
  const relay = createOnboardingCleanupRelay({
    getSession: () => session,
    getSetup: () => setup,
    getOverlay: () => overlay,
    retire: (...args) => retired.push(args),
  });
  t.after(() => relay.dispose());
  const identity = { demoId: "demo-a", takeId: "take-a", operationId: "operation-a" };
  return {
    relay,
    setup,
    overlay,
    stranger,
    retired,
    identity,
    replace: () => {
      session = { ...session, takeId: "take-b" };
      relay.retire();
    },
  };
}
test("relay accepts original setup/take/owner, refuses duplicates and forged replies, and retains completed failed take", async (t) => {
  const h = fixture(t);
  h.relay.bind(h.overlay, h.identity, "private-main-token");
  const pending = h.relay.retry(h.setup, h.identity);
  const request = h.overlay.sent[0][1];
  assert.equal("token" in request, false);
  assert.equal((await h.relay.retry(h.setup, h.identity)).code, "CLEANUP_OPERATION_BUSY");
  assert.equal(h.relay.reply(h.stranger, { ...request, text: "Forged" }), false);
  assert.equal(h.relay.reply(h.overlay, { ...request, text: "Cleaned." }), true);
  assert.deepEqual(await pending, { ...h.identity, ok: true, text: "Cleaned." });
  assert.equal(h.relay.reply(h.overlay, { ...request, text: "Stale" }), false);
  const retry = h.relay.retry(h.setup, h.identity);
  h.relay.reply(h.overlay, { ...h.overlay.sent[1][1], code: "RECIPIENT_CHANGED" });
  assert.equal((await retry).code, "RECIPIENT_CHANGED");
});
test("wrong caller/demo/string take/operation refused, replacement/destroy/disposal settle old relay only", async (t) => {
  const h = fixture(t);
  h.relay.bind(h.overlay, h.identity, "token");
  for (const [caller, identity] of [
    [h.stranger, h.identity],
    [h.setup, { ...h.identity, demoId: "wrong" }],
    [h.setup, { ...h.identity, takeId: 1 }],
    [h.setup, { ...h.identity, operationId: "other" }],
  ])
    assert.equal((await h.relay.retry(caller, identity)).code, "CLEANUP_OPERATION_UNAVAILABLE");
  const pending = h.relay.retry(h.setup, h.identity);
  const old = h.overlay.sent[0][1];
  h.replace();
  assert.equal((await pending).ok, false);
  assert.equal(h.retired.length, 1);
  assert.equal(h.relay.reply(h.overlay, { ...old, text: "Late" }), false);
  const next = { ...h.identity, takeId: "take-b", operationId: "operation-b" };
  h.relay.bind(h.overlay, next, "new");
  const dying = h.relay.retry(h.setup, next);
  h.setup.emit("destroyed");
  assert.equal((await dying).ok, false);
  assert.equal(h.retired.length, 2);
});
