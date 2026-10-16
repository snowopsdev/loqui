const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { deferred } = require("./harness/deferred");
const { realCredentialEnv } = require("./harness/realCredentialEnv");
const { fakeCodexFs } = require("./harness/fakeCredentialEnv");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority.js");
const { createKeyring } = require("../../src/helpers/keyring.js");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const isRename = (name) => (op, file) => op === "rename" && file === name;

function setup(t, initial) {
  const real = realCredentialEnv(t, initial);
  const credentials = createCredentialAuthority({
    env: real.env,
    fs: fakeCodexFs(),
    codexHome: "/profile/codex",
    setTimer: () => {},
  });
  const rows = new Map();
  const tested = []; // the key value each request carried (test-local only)
  const gates = [];
  const keyring = createKeyring({
    store: {
      all: () => [...rows.values()],
      save: (row) => rows.set(row.identity, { ...row }),
      remove: (identity) => rows.delete(identity),
    },
    credentials,
    runTest: (_config, values) => {
      tested.push(values.key);
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    },
  });
  const sender = new EventEmitter();
  sender.isDestroyed = () => false;
  const rawVerify = keyring.verify;
  keyring.verify = async (id, options = {}) => {
    const described = await keyring.describeVerify(id, options, sender);
    return rawVerify(id, { ...options, recipientToken: described.recipientToken }, sender);
  };
  const status = (id) => keyring.list().find((entry) => entry.id === id)?.status;
  return { ...real, credentials, keyring, rows, tested, gates, status };
}

// change-driving (R2-4/B1): wait for committed persistence, then refuse an upgrade
// from reviewed absence; a fresh explicit action may test the acknowledged key.
test("a first save stays absent until acknowledged, and stale reviewed absence needs another Verify", async (t) => {
  const { credentials, keyring, fs, tested, gates } = setup(t);
  fs.holdNext(isRename("GROQ_API_KEY.enc"));
  const saving = credentials.save("groq", "key", "gsk-first");
  const hold = await fs.nextHold();
  assert.deepEqual(keyring.list(), [], "not listed until main acknowledges it");
  const verifying = keyring.verify("groq");
  await tick();
  assert.deepEqual(tested, [], "nothing is sent while the save is pending");
  hold.release();
  await saving;
  await tick();
  assert.equal(
    (await verifying).outcome,
    "recipientChanged",
    "a newly present key needs a fresh reviewed action"
  );
  const fresh = keyring.verify("groq");
  await tick();
  assert.deepEqual(tested, ["gsk-first"]);
  gates[0].resolve({ success: true });
  assert.equal((await fresh).outcome, "recorded");
});

// change-driving (R2-4): Verify was not serialized with the replacement.
test("a replacement committed while Verify is out supersedes the old key's verdict", async (t) => {
  const { credentials, keyring, tested, gates, status } = setup(t, { GROQ_API_KEY: "gsk-old" });
  const verifying = keyring.verify("groq");
  await tick();
  assert.deepEqual(tested, ["gsk-old"]);
  assert.deepEqual(await credentials.save("groq", "key", "gsk-new"), { ok: true, generation: 1 });
  gates[0].resolve({ success: false, errorCode: "credentialsRejected", status: 401 });
  assert.equal((await verifying).outcome, "superseded");
  assert.equal(status("groq"), "unverified", "the old key's 401 never lands on the new key");
});

// change-driving (R2-4): the failed replacement is restored without a
// generation change, so the tested value must be the one that stays stored.
test("a replacement that fails while Verify is out leaves a verdict about the restored key", async (t) => {
  const { credentials, keyring, fs, tested, gates, env, status } = setup(t, {
    GROQ_API_KEY: "gsk-old",
  });
  const verifying = keyring.verify("groq");
  await tick();
  fs.holdNext(isRename("GROQ_API_KEY.enc"));
  const replacing = credentials.save("groq", "key", "gsk-attempt");
  const hold = await fs.nextHold();
  assert.equal(
    env.getGroqKey(),
    "gsk-old",
    "Task2 publishes only durable values; pending replacement stays committed-old"
  );
  hold.fail(Object.assign(new Error("EIO"), { code: "EIO" }));
  assert.deepEqual(await replacing, { ok: false, error: "persistFailed" });
  gates[0].resolve({ success: true });
  assert.equal((await verifying).outcome, "recorded");
  assert.deepEqual(tested, ["gsk-old"], "the request carried the committed key");
  assert.equal(env.getGroqKey(), "gsk-old");
  assert.equal(status("groq"), "verified");
});

// change-driving (R2-4): v1 tested process.env, i.e. the attempt, and then
// recorded the attempt's verdict on the restored key.
test("Verify requested during a replacement that then fails tests the restored key", async (t) => {
  const { credentials, keyring, fs, tested, gates, status } = setup(t, { GROQ_API_KEY: "gsk-old" });
  fs.holdNext(isRename("GROQ_API_KEY.enc"));
  const replacing = credentials.save("groq", "key", "gsk-attempt");
  const hold = await fs.nextHold();
  const verifying = keyring.verify("groq");
  await tick();
  assert.deepEqual(tested, [], "Verify waits for the pending write");
  hold.fail(Object.assign(new Error("EIO"), { code: "EIO" }));
  await replacing;
  await tick();
  assert.deepEqual(tested, ["gsk-old"]);
  gates[0].resolve({ success: false, errorCode: "credentialsRejected", status: 401 });
  assert.equal((await verifying).outcome, "recorded");
  assert.equal(status("groq"), "rejected", "the 401 is about gsk-old, which is what is stored");
});

// change-driving (R2-2 × I11): reset invalidates verifications in flight.
test("reset while Verify is out discards the verdict and leaves no row", async (t) => {
  const { credentials, keyring, gates, rows, erase } = setup(t, { GROQ_API_KEY: "gsk-old" });
  const verifying = keyring.verify("groq");
  await tick();
  await credentials.reset(erase);
  gates[0].resolve({ success: true });
  assert.deepEqual(await verifying, { outcome: "superseded", entry: null });
  assert.equal(rows.size, 0);
});
