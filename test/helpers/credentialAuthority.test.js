const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { deferred } = require("./harness/deferred");
const { fakeCredentialEnv, fakeCodexFs } = require("./harness/fakeCredentialEnv");
const {
  CREDENTIAL_IDS,
  byokSlotId,
  createCredentialAuthority,
  hasStoredAccount,
  slotForCredentialRef,
} = require("../../src/helpers/credentialAuthority.js");

const SECRETS = [
  "sk-openai-SECRET-one",
  "sk-openai-SECRET-two",
  "corti-id-SECRET",
  "corti-secret-SECRET",
  "corti-key-SECRET",
  "AKIA-SECRET",
];
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup({ initial = {}, codexSize = null } = {}) {
  const env = fakeCredentialEnv(initial);
  const fs = fakeCodexFs({ size: codexSize });
  const broadcasts = [];
  const timers = [];
  let clock = 1_000;
  const authority = createCredentialAuthority({
    env,
    fs,
    codexHome: "/profile/codex",
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    now: () => clock,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  return { authority, env, fs, broadcasts, timers, advance: (ms) => (clock += ms) };
}

const presence = (list) => Object.fromEntries(list.map((entry) => [entry.id, entry.present]));

// change-driving: the module does not exist yet.
test("presence comes from main's store for every identity, with Corti split by authentication", () => {
  const { authority } = setup({
    initial: {
      OPENAI_API_KEY: SECRETS[0],
      CORTI_CLIENT_ID: SECRETS[2],
      CORTI_API_KEY: SECRETS[4],
      VERTEX_PROJECT: "my-project",
    },
  });
  const list = authority.list();
  assert.deepEqual(
    list.map((entry) => entry.id),
    CREDENTIAL_IDS
  );
  assert.deepEqual(presence(list), {
    openai: true,
    anthropic: false,
    gemini: false,
    groq: false,
    xai: false,
    mistral: false,
    openrouter: false,
    tinfoil: false,
    deepgram: false,
    assemblyai: false,
    "corti:text": true,
    "corti:speech": false,
    codex: false,
    bedrock: false,
    azure: false,
    vertex: true,
  });
  assert.deepEqual(list.find((e) => e.id === "corti:speech").fields, {
    clientId: true,
    clientSecret: false,
  });
  assert.ok(list.every((entry) => entry.generation === 0));
  for (const secret of SECRETS) assert.ok(!JSON.stringify(list).includes(secret));
});

// change-driving (I2): today route facts call codexStatus(), which starts the
// app server and can verify the release over the network.
test("Codex presence is a stat of auth.json: no read, no process, no network", (t) => {
  const { CodexAppServer } = require("../../src/helpers/codexAppServer.js");
  const forbidden = [];
  const trap = (name) => () => {
    forbidden.push(name);
    throw new Error(`${name} must not run while listing credentials`);
  };
  const saved = {
    start: CodexAppServer.prototype.start,
    status: CodexAppServer.prototype.status,
    request: CodexAppServer.prototype.request,
    fetch: globalThis.fetch,
    spawn: childProcess.spawn,
    execFile: childProcess.execFile,
  };
  CodexAppServer.prototype.start = trap("CodexAppServer.start");
  CodexAppServer.prototype.status = trap("CodexAppServer.status");
  CodexAppServer.prototype.request = trap("CodexAppServer.request");
  globalThis.fetch = trap("fetch");
  childProcess.spawn = trap("spawn");
  childProcess.execFile = trap("execFile");
  t.after(() => {
    CodexAppServer.prototype.start = saved.start;
    CodexAppServer.prototype.status = saved.status;
    CodexAppServer.prototype.request = saved.request;
    globalThis.fetch = saved.fetch;
    childProcess.spawn = saved.spawn;
    childProcess.execFile = saved.execFile;
  });

  const authFile = path.join("/profile/codex", "auth.json");
  for (const [size, expected] of [
    [null, false],
    [2, false],
    [512, true],
  ]) {
    const { authority, fs } = setup({ codexSize: size });
    assert.equal(presence(authority.list()).codex, expected, `auth.json size ${size}`);
    assert.equal(authority.present("codex"), expected);
    assert.ok(fs.calls.length > 0 && fs.calls.every((file) => file === authFile));
    assert.equal(hasStoredAccount({ fs, codexHome: "/profile/codex" }), expected);
  }
  assert.deepEqual(forbidden, []);
});

// change-driving (I3): today _saveKey answers before the encrypted write.
test("a save resolves only after main persisted it, then bumps the generation and broadcasts", async () => {
  const { authority, env, broadcasts } = setup();
  const gate = deferred();
  env.persistImpl = () => gate.promise;
  let settled = false;
  const pending = authority.save("openai", "key", `  ${SECRETS[0]}  `).then((result) => {
    settled = true;
    return result;
  });
  await tick();
  assert.equal(settled, false);
  assert.equal(authority.generation("openai"), 0);
  assert.deepEqual(broadcasts, []);
  gate.resolve();
  assert.deepEqual(await pending, { ok: true, generation: 1 });
  assert.equal(env.values.get("OPENAI_API_KEY"), SECRETS[0], "trimmed before persisting");
  assert.deepEqual(broadcasts, [
    {
      channel: "credentials-changed",
      payload: { id: "openai", present: true, generation: 1, fields: { key: true } },
    },
  ]);
});

// change-driving (I3): a failed write was only logged before.
test("a failed save reports persistFailed and changes nothing", async () => {
  const { authority, env, broadcasts } = setup({ initial: { GROQ_API_KEY: "gsk-old" } });
  env.persistImpl = async () => {
    throw new Error(`disk full while writing ${SECRETS[1]}`);
  };
  const result = await authority.save("groq", "key", SECRETS[1]);
  assert.deepEqual(result, { ok: false, error: "persistFailed" });
  assert.equal(authority.generation("groq"), 0);
  assert.equal(env.values.get("GROQ_API_KEY"), "gsk-old");
  assert.deepEqual(broadcasts, []);
});

// change-driving (I3, replacement saves): writes to one identity are serialized.
test("saves to one identity run in call order, so a replacement always wins", async () => {
  const { authority, env } = setup();
  const first = deferred();
  env.persistImpl = (_name, value) => (value === "first" ? first.promise : undefined);
  const a = authority.save("groq", "key", "first");
  const b = authority.save("groq", "key", "second");
  await tick();
  assert.deepEqual(env.persisted, ["GROQ_API_KEY"], "the replacement waits for the first write");
  first.resolve();
  assert.deepEqual(await a, { ok: true, generation: 1 });
  assert.deepEqual(await b, { ok: true, generation: 2 });
  assert.equal(env.values.get("GROQ_API_KEY"), "second");
});

// change-driving: input validation lives in main now.
test("the stored sentinel is a no-op and invalid input is refused before any write", async () => {
  const { authority, env } = setup({ initial: { OPENAI_API_KEY: SECRETS[0] } });
  assert.deepEqual(await authority.save("openai", "key", "__stored__"), {
    ok: true,
    generation: 0,
  });
  assert.deepEqual(await authority.save("nope", "key", "x"), {
    ok: false,
    error: "unknownCredential",
  });
  assert.deepEqual(await authority.save("openai", "clientId", "x"), {
    ok: false,
    error: "unknownField",
  });
  assert.deepEqual(await authority.save("openai", "key", 42), { ok: false, error: "invalidValue" });
  assert.deepEqual(await authority.save("openai", "key", "x".repeat(8193)), {
    ok: false,
    error: "invalidValue",
  });
  assert.deepEqual(await authority.save("codex", "key", "x"), { ok: false, error: "unsupported" });
  assert.deepEqual(env.persisted, []);
});

// change-driving (I4): removal had no undo at all.
test("remove keeps the value only in main memory and Undo restores it within 8 s", async () => {
  const { authority, env, broadcasts, advance } = setup({
    initial: { CORTI_CLIENT_ID: SECRETS[2], CORTI_CLIENT_SECRET: SECRETS[3] },
  });
  assert.equal(authority.present("corti:speech"), true);
  const removed = await authority.remove("corti:speech");
  assert.equal(removed.ok, true);
  assert.equal(typeof removed.undoToken, "string");
  assert.equal(removed.expiresAt, 1_000 + 8_000);
  assert.equal(removed.generation, 1);
  assert.equal(env.values.has("CORTI_CLIENT_ID"), false);
  assert.equal(env.values.has("CORTI_CLIENT_SECRET"), false);
  assert.deepEqual(broadcasts.at(-1).payload, {
    id: "corti:speech",
    present: false,
    generation: 1,
    fields: { clientId: false, clientSecret: false },
  });
  advance(7_999);
  assert.deepEqual(await authority.undoRemove(removed.undoToken), { ok: true, generation: 2 });
  assert.equal(env.values.get("CORTI_CLIENT_ID"), SECRETS[2]);
  assert.equal(env.values.get("CORTI_CLIENT_SECRET"), SECRETS[3]);
  assert.equal(broadcasts.at(-1).payload.present, true);
  assert.deepEqual(await authority.undoRemove(removed.undoToken), {
    ok: false,
    reason: "unknown",
  });
});

// change-driving (I4): expiry, replacement and reset all invalidate the token.
test("undo after expiry, replacement or reset is refused and never resurrects the old key", async () => {
  {
    const { authority, env, advance } = setup({ initial: { OPENAI_API_KEY: SECRETS[0] } });
    const { undoToken } = await authority.remove("openai");
    advance(8_000);
    assert.deepEqual(await authority.undoRemove(undoToken), { ok: false, reason: "expired" });
    assert.equal(env.values.has("OPENAI_API_KEY"), false);
  }
  {
    const { authority, timers } = setup({ initial: { OPENAI_API_KEY: SECRETS[0] } });
    const { undoToken } = await authority.remove("openai");
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 8_000);
    timers[0].fn(); // the purge timer drops the value even if no clock check ever runs
    assert.deepEqual(await authority.undoRemove(undoToken), { ok: false, reason: "expired" });
  }
  {
    const { authority, env } = setup({ initial: { OPENAI_API_KEY: SECRETS[0] } });
    const { undoToken } = await authority.remove("openai");
    await authority.save("openai", "key", SECRETS[1]);
    assert.deepEqual(await authority.undoRemove(undoToken), { ok: false, reason: "replaced" });
    assert.equal(env.values.get("OPENAI_API_KEY"), SECRETS[1]);
  }
  {
    const { authority, env } = setup({ initial: { OPENAI_API_KEY: SECRETS[0] } });
    const { undoToken } = await authority.remove("openai");
    await authority.reset();
    assert.deepEqual(await authority.undoRemove(undoToken), { ok: false, reason: "unknown" });
    assert.equal(env.values.has("OPENAI_API_KEY"), false);
    assert.equal(authority.generation("groq"), 1, "reset bumps every generation");
  }
  {
    const { authority } = setup();
    assert.deepEqual(await authority.undoRemove("not-a-token"), { ok: false, reason: "unknown" });
  }
});

// change-driving: removal reports what it could not do.
test("removing nothing or Codex is refused, and a failed removal restores what it cleared", async () => {
  {
    const { authority } = setup();
    assert.deepEqual(await authority.remove("openai"), { ok: false, error: "notStored" });
    assert.deepEqual(await authority.remove("codex"), { ok: false, error: "unsupported" });
  }
  {
    const { authority, env, broadcasts } = setup({
      initial: { CORTI_CLIENT_ID: SECRETS[2], CORTI_CLIENT_SECRET: SECRETS[3] },
    });
    env.persistImpl = async (name, value) => {
      if (name === "CORTI_CLIENT_SECRET" && value === "") throw new Error("locked");
    };
    assert.deepEqual(await authority.remove("corti:speech"), {
      ok: false,
      error: "persistFailed",
    });
    assert.equal(env.values.get("CORTI_CLIENT_ID"), SECRETS[2]);
    assert.equal(env.values.get("CORTI_CLIENT_SECRET"), SECRETS[3]);
    assert.equal(authority.generation("corti:speech"), 0);
    assert.deepEqual(broadcasts, []);
  }
});

// change-driving (I3/I4): the secret boundary, asserted over every surface.
test("no result, list or broadcast ever carries secret material", async () => {
  const { authority, env, broadcasts } = setup({ initial: { BEDROCK_ACCESS_KEY_ID: SECRETS[5] } });
  const results = [];
  results.push(await authority.save("openai", "key", SECRETS[0]));
  results.push(await authority.save("corti:speech", "clientId", SECRETS[2]));
  results.push(await authority.save("corti:speech", "clientSecret", SECRETS[3]));
  results.push(await authority.save("corti:text", "key", SECRETS[4]));
  results.push(authority.list());
  const removed = await authority.remove("openai");
  results.push(removed);
  results.push(await authority.undoRemove(removed.undoToken));
  results.push(await authority.remove("bedrock"));
  env.persistImpl = async () => {
    throw new Error(`failed for ${SECRETS[1]}`);
  };
  results.push(await authority.save("openai", "key", SECRETS[1]));
  await authority.reset();
  const surface = JSON.stringify({ results, broadcasts });
  for (const secret of SECRETS) assert.ok(!surface.includes(secret), `leaked ${secret}`);
});

// change-driving: Task 11 needs the cause of each change.
test("subscribers learn the cause of each change and can unsubscribe", async () => {
  const { authority } = setup({ initial: { OPENAI_API_KEY: SECRETS[0] } });
  const seen = [];
  const stop = authority.subscribe((change) => seen.push(`${change.cause}:${change.id}`));
  const { undoToken } = await authority.remove("openai");
  await authority.undoRemove(undoToken);
  await authority.save("openai", "key", SECRETS[1]);
  authority.refresh("bedrock");
  assert.deepEqual(seen, ["remove:openai", "undo:openai", "save:openai", "refresh:bedrock"]);
  await authority.reset();
  assert.ok(seen.includes("reset:openai") && seen.includes("reset:codex"));
  stop();
  await authority.save("groq", "key", "gsk");
  assert.ok(!seen.includes("save:groq"));
});

// change-driving: the slot names shared with personal inference and the BYOK loop.
test("credential refs and BYOK bases map onto authority slots", () => {
  assert.deepEqual(slotForCredentialRef("azure"), { id: "azure", field: "key" });
  assert.deepEqual(slotForCredentialRef("vertex"), { id: "vertex", field: "key" });
  assert.deepEqual(slotForCredentialRef("corti"), { id: "corti:text", field: "key" });
  assert.deepEqual(slotForCredentialRef("openrouter"), { id: "openrouter", field: "key" });
  assert.deepEqual(slotForCredentialRef("custom:noteFormatting"), {
    id: "custom:noteFormatting",
    field: "key",
  });
  assert.deepEqual(slotForCredentialRef("custom:dictationCleanup"), {
    id: "custom:dictationCleanup",
    field: "key",
  });
  assert.equal(slotForCredentialRef("custom:nope"), null);
  assert.equal(slotForCredentialRef("bogus"), null);
  assert.equal(byokSlotId("chat-agent-custom"), "custom:chatIntelligence");
  assert.equal(byokSlotId("corti"), "corti:text");
  assert.equal(byokSlotId("deepgram"), "deepgram");
});

// change-driving: object prototype names are not credential slots or fields.
test("prototype-named slots and fields are refused before persistence", async () => {
  const { authority, env } = setup();
  for (const id of ["__proto__", "constructor", "toString"]) {
    assert.deepEqual(await authority.save(id, "key", "fixture"), {
      ok: false,
      error: "unknownCredential",
    });
    assert.deepEqual(await authority.remove(id), { ok: false, error: "unknownCredential" });
    assert.equal(await authority.captureCommitted(id), null);
  }
  for (const field of ["__proto__", "constructor", "toString"])
    assert.deepEqual(await authority.save("openai", field, "fixture"), {
      ok: false,
      error: "unknownField",
    });
  assert.deepEqual(env.persisted, []);
});
