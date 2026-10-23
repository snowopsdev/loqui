const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createTextOperationAuthority } = require("../../src/helpers/textOperationAuthority");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const sender = (id) => Object.assign(new EventEmitter(), { id, isDestroyed: () => false });
const descriptor = {
  provider: "azure",
  model: "fixture-model",
  inferenceScope: "dictationCleanup",
  systemPrompt: "fixture prompt",
};
const sentence = { messages: [{ role: "user", content: "fixture words" }], wordCount: 2 };
function fixture(t, patch = {}) {
  let selected = { azureEndpoint: "https://fixture.invalid/a", azureApiVersion: "fixture-v1" };
  let generation = 1;
  const credential = () => ({ id: "azure", generation, present: true });
  const authority = createTextOperationAuthority({
    credentials: {
      list: () => [credential()],
      captureCommitted: async () => ({ ...credential(), values: { key: "fixture-key-a" } }),
    },
    snapshot: () => ({ ...selected }),
    waitForAdmission: async () => {},
    ...patch,
  });
  t.after(() => authority.dispose());
  return {
    authority,
    owner: sender(1),
    change: (patch) => {
      selected = { ...selected, ...patch };
    },
    rotate: () => generation++,
  };
}
test("captured operation binds exact first request and retry to original owner and factory inputs", async (t) => {
  const h = fixture(t);
  const token = await h.authority.capture(h.owner, descriptor);
  const calls = [];
  const run = async (request, captured, execution) => {
    execution.assertLive();
    calls.push({ request, captured });
    return { text: "Fixture." };
  };
  assert.deepEqual(await h.authority.execute(h.owner, token, sentence, run), { text: "Fixture." });
  assert.deepEqual(await h.authority.execute(h.owner, token, sentence, run), { text: "Fixture." });
  assert.equal(calls[0].request, calls[1].request);
  assert.equal(calls[0].captured, calls[1].captured);
  assert.equal(calls[0].captured.apiKey, "fixture-key-a");
  assert.equal(calls[0].captured.enterprise.azureEndpoint, "https://fixture.invalid/a");
  await assert.rejects(h.authority.execute(sender(2), token, sentence, run), {
    code: "CLEANUP_OPERATION_UNAVAILABLE",
  });
  await assert.rejects(h.authority.execute(h.owner, token, { ...sentence, wordCount: 3 }, run), {
    code: "CLEANUP_REQUEST_CHANGED",
  });
});
test("capture precedes admission wait; changed same-host path never reaches factory", async (t) => {
  const gate = deferred();
  const h = fixture(t, { waitForAdmission: () => gate.promise });
  const pending = h.authority.capture(h.owner, descriptor);
  const refused = assert.rejects(pending, { code: "RECIPIENT_CHANGED" });
  h.change({ azureEndpoint: "https://fixture.invalid/b" });
  gate.resolve();
  await refused;
});
test("credential generation changed during capture refuses before factory", async (t) => {
  const gate = deferred();
  let generation = 1;
  const meta = () => ({ id: "azure", generation, present: true });
  const h = fixture(t, {
    credentials: { list: () => [meta()], captureCommitted: () => gate.promise },
  });
  const pending = h.authority.capture(h.owner, descriptor);
  await new Promise((r) => setImmediate(r));
  generation++;
  gate.resolve({ ...meta(), values: { key: "fixture-key-b" } });
  await assert.rejects(pending, { code: "RECIPIENT_CHANGED" });
});
test("retirement aborts pending execution, refuses duplicate and stale completion without touching newer operation", async (t) => {
  const h = fixture(t);
  const token = await h.authority.capture(h.owner, descriptor);
  const gate = deferred();
  let execution;
  const pending = h.authority.execute(h.owner, token, sentence, async (_r, _c, e) => {
    execution = e;
    await gate.promise;
    return { text: "Old." };
  });
  await assert.rejects(
    h.authority.execute(h.owner, token, sentence, () => assert.fail()),
    { code: "CLEANUP_OPERATION_BUSY" }
  );
  h.authority.retire(h.owner, token);
  assert.equal(execution.signal.aborted, true);
  const newer = await h.authority.capture(h.owner, descriptor);
  gate.resolve();
  await assert.rejects(pending, { code: "CLEANUP_OPERATION_UNAVAILABLE" });
  assert.deepEqual(
    await h.authority.execute(h.owner, newer, sentence, async () => ({ text: "New." })),
    { text: "New." }
  );
});

test("expiry, owner destruction and application disposal retire only their retained capabilities", async (t) => {
  let now = 0;
  const h = fixture(t, { now: () => now, ttlMs: 300000 });
  const token = await h.authority.capture(h.owner, descriptor);
  now = 300000;
  await assert.rejects(
    h.authority.execute(h.owner, token, sentence, () => assert.fail()),
    { code: "CLEANUP_OPERATION_UNAVAILABLE" }
  );
  const next = await h.authority.capture(h.owner, descriptor);
  h.owner.emit("destroyed");
  await assert.rejects(
    h.authority.execute(h.owner, next, sentence, () => assert.fail()),
    { code: "CLEANUP_OPERATION_UNAVAILABLE" }
  );
  const third = await h.authority.capture(sender(2), descriptor);
  h.authority.dispose();
  assert.equal(h.authority.isBusy(), false);
  await assert.rejects(
    h.authority.execute(h.owner, third, sentence, () => assert.fail()),
    { code: "CLEANUP_OPERATION_UNAVAILABLE" }
  );
});
