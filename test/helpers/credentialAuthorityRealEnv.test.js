const assert = require("node:assert/strict");
const test = require("node:test");
const { realCredentialEnv } = require("./harness/realCredentialEnv");
const { fakeCodexFs } = require("./harness/fakeCredentialEnv");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority.js");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const isRename = (name) => (op, file) => op === "rename" && file === name;

function setup(t, initial, environmentOptions = {}) {
  const real = realCredentialEnv(t, initial, environmentOptions);
  const broadcasts = [];
  const authority = createCredentialAuthority({
    env: real.env,
    fs: fakeCodexFs(),
    codexHome: "/profile/codex",
    broadcast: (_channel, payload) => broadcasts.push(payload),
    setTimer: () => {},
  });
  return { ...real, authority, broadcasts };
}

// change-driving (R2-4): pending native persistence must keep both RAM and
// the authority on the last acknowledged value.
test("a first save that is still being written is not present anywhere", async (t) => {
  const { authority, env, fs, broadcasts, stored } = setup(t);
  fs.holdNext(isRename("OPENAI_API_KEY.enc"));
  const saving = authority.save("openai", "key", "sk-first-SECRET");
  const hold = await fs.nextHold();
  assert.equal(env.getOpenAIKey(), "", "native writes keep RAM committed until durable rename");
  assert.equal(authority.present("openai"), false);
  const row = authority.list().find((entry) => entry.id === "openai");
  assert.deepEqual([row.present, row.fields, row.generation], [false, { key: false }, 0]);
  assert.equal(stored("OPENAI_API_KEY"), false);
  assert.deepEqual(broadcasts, []);
  hold.release();
  assert.deepEqual(await saving, { ok: true, generation: 1 });
  assert.equal(authority.present("openai"), true);
  assert.equal(stored("OPENAI_API_KEY"), true);
  assert.deepEqual(broadcasts, [
    { id: "openai", present: true, generation: 1, fields: { key: true } },
  ]);
});

// change-driving (R2-4): a replacement that fails must never be what presence,
// a broadcast or a verification capture sees.
test("a failed replacement never shows the attempted key and keeps the committed one", async (t) => {
  const { authority, env, fs, broadcasts } = setup(t, { GROQ_API_KEY: "gsk-committed-SECRET" });
  fs.holdNext(isRename("GROQ_API_KEY.enc"));
  const replacing = authority.save("groq", "key", "gsk-attempt-SECRET");
  const hold = await fs.nextHold();
  assert.equal(env.getGroqKey(), "gsk-committed-SECRET", "replacement is not staged in RAM");
  const capture = authority.captureCommitted("groq"); // queued behind the write
  hold.fail(Object.assign(new Error("EIO"), { code: "EIO" }));
  assert.deepEqual(await replacing, { ok: false, error: "persistFailed" });
  assert.equal(env.getGroqKey(), "gsk-committed-SECRET", "persistSecret restored process.env");
  const captured = await capture;
  assert.equal(captured.generation, 0);
  assert.equal(captured.values.key, "gsk-committed-SECRET", "Verify tests the committed key");
  assert.equal(authority.present("groq"), true);
  assert.deepEqual(broadcasts, []);
});

// change-driving (R2-4): a capture waits for a pending replacement and then
// pairs the new value with the new generation.
test("a capture requested during a replacement tests the replacement under its own generation", async (t) => {
  const { authority, fs } = setup(t, { GROQ_API_KEY: "gsk-old-SECRET" });
  fs.holdNext(isRename("GROQ_API_KEY.enc"));
  const replacing = authority.save("groq", "key", "gsk-new-SECRET");
  const hold = await fs.nextHold();
  let settled = false;
  const capture = authority.captureCommitted("groq").then((value) => ((settled = true), value));
  await tick();
  assert.equal(settled, false, "no value is captured while a write is pending");
  hold.release();
  await replacing;
  assert.deepEqual(await capture, {
    generation: 1,
    present: true,
    values: { key: "gsk-new-SECRET" },
  });
});

// change-driving (R2-2): reset did not fence a write that was already running.
test("reset during a first save: the save fails, reset waits for it, and no key survives", async (t) => {
  const { authority, env, fs, stored, erase } = setup(t);
  fs.holdNext(isRename("OPENAI_API_KEY.enc"));
  const saving = authority.save("openai", "key", "sk-first-SECRET");
  const hold = await fs.nextHold();
  let erased = false;
  const resetting = authority.reset(async () => {
    await erase();
    erased = true;
  });
  await tick();
  assert.equal(erased, false, "nothing is erased while a write is still running");
  assert.deepEqual(await authority.save("groq", "key", "gsk-SECRET"), {
    ok: false,
    error: "reset",
  });
  hold.release();
  assert.deepEqual(await saving, { ok: false, error: "reset" }, "never reported as saved");
  await resetting;
  assert.equal(erased, true);
  assert.equal(stored("OPENAI_API_KEY"), false);
  assert.equal(env.getOpenAIKey(), "");
  assert.equal(authority.present("openai"), false);
  assert.ok(!fs.log.includes("writeFile GROQ_API_KEY.enc.tmp"), "a save during reset never writes");
});

// change-driving (R3-1/R3-2): the source itself is persisted through the same
// environment queue. A source save already in flight must not restore its old
// value from its rejection handler after reset erases process.env and `.env`.
test("reset during a pending Vertex source save never resurrects the prior source", async (t) => {
  const { authority, env, fs, erase } = setup(
    t,
    { VERTEX_AUTH_SOURCE: "apiKey", VERTEX_API_KEY: "fixture-vertex-key" },
    { encryptionAvailable: false }
  );
  fs.holdNext((op, name) => op === "writeFile" && name === ".env.tmp");
  const saving = env.saveVertexAuthSource("adc");
  const hold = await fs.nextHold();
  assert.equal(
    env.getVertexAuthSource(),
    "apiKey",
    "source stays committed until durable acknowledgement"
  );
  const resetting = authority.reset(erase);
  await tick();
  hold.release();
  await assert.rejects(saving, { code: "ENV_RESET" });
  await resetting;
  assert.equal(env.getVertexAuthSource(), null);
  assert.equal(
    process.env.VERTEX_AUTH_SOURCE,
    undefined,
    "the rejected source handler cannot restore the old mode"
  );
  assert.equal(env.getVertexApiKey(), "");
  assert.equal(
    [...fs.files.keys()].some((file) => file.endsWith("/.env") || file.endsWith("/.env.tmp")),
    false,
    "the source and secret are absent from persisted files after reset returns"
  );
});

// change-driving (R3-2): the production `save-all-keys-to-env` channel bypasses
// credentialAuthority's per-slot queues. In the supported non-encrypted mode,
// saveAllKeysToEnvFile snapshots the secret into .env.tmp before its first await.
test("reset fences and drains the independent plaintext .env writer", async (t) => {
  const { authority, env, fs, erase, dotenvLoads } = setup(
    t,
    { OPENAI_API_KEY: "sk-env-queued-SECRET" },
    { encryptionAvailable: false }
  );
  fs.holdNext((op, name) => op === "writeFile" && name === ".env.tmp");
  const writing = env.saveAllKeysToEnvFile(); // same body as save-all-keys-to-env IPC
  const hold = await fs.nextHold();
  const queued = env.saveAllKeysToEnvFile();
  const queuedRefused = assert.rejects(queued, { code: "ENV_RESET" });
  let resetSettled = false;
  const resetting = authority.reset(erase).then(() => (resetSettled = true));
  await tick();
  assert.equal(resetSettled, false, "reset waits for the active non-authority writer");
  await assert.rejects(
    env.saveAllKeysToEnvFile(),
    { code: "ENV_RESET" },
    "new .env writes are fenced"
  );
  await assert.rejects(env.removeKeyFromEnvFile("OPENAI_API_KEY"), { code: "ENV_RESET" });
  hold.release();
  await assert.rejects(
    writing,
    { code: "ENV_RESET" },
    "invalidated write cannot report success or reload dotenv"
  );
  await resetting;
  await queuedRefused;
  assert.equal(
    fs.log.filter((entry) => entry === "writeFile .env.tmp").length,
    1,
    "the queued independent writer never starts"
  );
  assert.equal(process.env.OPENAI_API_KEY, undefined);
  assert.equal(authority.present("openai"), false);
  assert.deepEqual(
    dotenvLoads,
    [],
    "an invalidated .env snapshot is never loaded back into process.env"
  );
  assert.equal(
    [...fs.files.keys()].some((file) => file.endsWith("/.env") || file.endsWith("/.env.tmp")),
    false,
    "neither the old .env snapshot nor its temp file survives reset"
  );
});

// change-driving: a failed atomic rename can leave plaintext in the temp file.
test("reset removes plaintext .env.tmp left by a failed active rename", async (t) => {
  const { authority, env, fs, erase, dotenvLoads } = setup(
    t,
    { OPENAI_API_KEY: "sk-temp-SECRET" },
    { encryptionAvailable: false }
  );
  fs.holdNext((op, name) => op === "rename" && name === ".env");
  const writing = env.saveAllKeysToEnvFile();
  const rejected = assert.rejects(writing, /rename failed/);
  const hold = await fs.nextHold();
  assert.equal(
    [...fs.files.keys()].some((file) => file.endsWith("/.env.tmp")),
    true
  );
  const resetting = authority.reset(erase);
  hold.fail(new Error("rename failed"));
  await rejected;
  await resetting;
  assert.equal(
    [...fs.files.keys()].some((file) => file.endsWith("/.env.tmp")),
    false
  );
  assert.equal(env.getOpenAIKey(), "");
  assert.deepEqual(dotenvLoads, []);
});

// change-driving: a second reset cannot release the first reset's fence.
test("overlapping credential resets refuse the second caller and keep writes fenced", async (t) => {
  const { authority, erase } = setup(t);
  let releaseErase;
  let enteredErase;
  const entered = new Promise((resolve) => (enteredErase = resolve));
  const held = new Promise((resolve) => (releaseErase = resolve));
  const first = authority.reset(async () => {
    enteredErase();
    await held;
    await erase();
  });
  await entered;
  await assert.rejects(authority.reset(), /reset already in progress/);
  assert.deepEqual(await authority.save("groq", "key", "gsk-refused"), {
    ok: false,
    error: "reset",
  });
  releaseErase();
  await first;
  assert.deepEqual(await authority.save("groq", "key", "gsk-after"), { ok: true, generation: 2 });
});

// change-driving: an erase failure must still await every other erase operation.
test("failed environment erase holds the write fence until every deletion settles", async (t) => {
  const { env, fs } = setup(t);
  const rm = fs.promises.rm;
  fs.promises.rm = async (target, options) => {
    if (target.endsWith("/.env")) throw new Error("EACCES: .env");
    return rm(target, options);
  };
  fs.holdNext((op, name) => op === "rm" && name === "secure-keys");
  let settled = false;
  const resetting = env.clearAllPersistedData();
  const rejected = assert
    .rejects(resetting, /Environment erase failed/)
    .then(() => (settled = true));
  const hold = await fs.nextHold();
  await tick();
  assert.equal(settled, false);
  await assert.rejects(env.saveAllKeysToEnvFile(), { code: "ENV_RESET" });
  hold.release();
  await rejected;
  assert.equal(
    (await env.saveAllKeysToEnvFile()).success,
    true,
    "the fence is released after all erases settle"
  );
});

// change-driving (R2-2): a queued replacement used to run after the erase.
test("reset during a queued replacement: the queued write never starts and nothing survives", async (t) => {
  const { authority, env, fs, stored, erase } = setup(t, { OPENAI_API_KEY: "sk-old-SECRET" });
  fs.holdNext(isRename("OPENAI_API_KEY.enc"));
  const first = authority.save("openai", "key", "sk-one-SECRET");
  const hold = await fs.nextHold();
  const second = authority.save("openai", "key", "sk-two-SECRET");
  const resetting = authority.reset(erase);
  hold.release();
  assert.deepEqual(await first, { ok: false, error: "reset" });
  assert.deepEqual(await second, { ok: false, error: "reset" });
  await resetting;
  assert.equal(
    fs.log.filter((entry) => entry === "writeFile OPENAI_API_KEY.enc.tmp").length,
    1,
    "only the first write ever started"
  );
  assert.equal(stored("OPENAI_API_KEY"), false);
  assert.equal(env.getOpenAIKey(), "");
});

// change-driving (R2-2): an Undo that passed its token check could restore the
// key after Reset Loqui deleted it, and report success.
test("reset during Undo of a two-field credential: Undo fails and neither field comes back", async (t) => {
  const { authority, env, fs, stored, erase } = setup(t, {
    CORTI_CLIENT_ID: "cid-SECRET",
    CORTI_CLIENT_SECRET: "csec-SECRET",
  });
  const removed = await authority.remove("corti:speech");
  assert.equal(removed.ok, true);
  fs.holdNext(isRename("CORTI_CLIENT_ID.enc"));
  const undoing = authority.undoRemove(removed.undoToken);
  const hold = await fs.nextHold();
  const mark = fs.log.length;
  const resetting = authority.reset(erase);
  hold.release();
  assert.deepEqual(await undoing, { ok: false, reason: "unknown" });
  await resetting;
  assert.ok(
    !fs.log.slice(mark).includes("writeFile CORTI_CLIENT_SECRET.enc.tmp"),
    "the second field is never written after the reset began"
  );
  assert.equal(stored("CORTI_CLIENT_ID"), false);
  assert.equal(stored("CORTI_CLIENT_SECRET"), false);
  assert.equal(env.getCortiClientId(), "");
  assert.equal(authority.present("corti:speech"), false);
  assert.deepEqual(await authority.undoRemove(removed.undoToken), { ok: false, reason: "unknown" });
});

// change-driving (R2-2): a failed erase is reported, and the fence comes down.
test("a failed erase rejects reset and leaves the authority usable", async (t) => {
  const { authority } = setup(t);
  await assert.rejects(
    authority.reset(async () => {
      throw new Error("rm failed");
    }),
    /rm failed/
  );
  assert.deepEqual(await authority.save("groq", "key", "gsk-after"), { ok: true, generation: 2 });
});
