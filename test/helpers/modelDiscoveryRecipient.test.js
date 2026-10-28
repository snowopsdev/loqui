// Provider transports are gated (Sealed mode, Plan 07); these tests run unsealed.
require("../../src/helpers/privacy/egressGate").configureEgress({ isSealed: () => false });
const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
const { registerPersonalInferenceIPC } = require("../../src/helpers/personalInference");
const { realCredentialEnv } = require("./harness/realCredentialEnv");
const { fakeCodexFs } = require("./harness/fakeCredentialEnv");

// Baseline guard B7 (added after the handler implementation): registered production handlers use real committed credential
// authority with a held encrypted persistence boundary. No real network/profile.
for (const mutation of ["pending save", "replacement", "removal", "failed replacement"])
  test(`baseline guard: discovery ${mutation === "failed replacement" ? "retains the old reviewed credential after a failed replacement" : `refuses ${mutation} after the credential wait`}`, async (t) => {
    const real = realCredentialEnv(t, {
      CHAT_AGENT_CUSTOM_API_KEY: mutation === "pending save" ? "" : "fixture-old",
    });
    const credentials = createCredentialAuthority({
      env: real.env,
      fs: fakeCodexFs(),
      codexHome: "/fixture/codex",
      broadcast() {},
      setTimer() {},
    });
    const handlers = new Map();
    const sender = new EventEmitter();
    sender.id = 1;
    sender.isDestroyed = () => false;
    const codex = new EventEmitter();
    codex.stop = () => {};
    const calls = [];
    const api = registerPersonalInferenceIPC({
      ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler() {} },
      codex,
      credentials,
      fetchModels: async (...args) => {
        calls.push(args);
        return { ok: true, body: new Response('{"data":[]}').body };
      },
    });
    const input = {
      provider: "custom",
      baseUrl: "https://models.fixture.test/v1/",
      credentialRef: "custom:chatIntelligence",
      inferenceScope: "chatIntelligence",
    };
    const event = { sender };
    const describe = () => handlers.get("personal-inference:describe-models")(event, input);
    const before = await describe();
    assert.equal(before.present, mutation !== "pending save");
    real.fs.holdNext(
      (op, name) =>
        op === (mutation === "removal" ? "unlink" : "rename") &&
        name === "CHAT_AGENT_CUSTOM_API_KEY.enc"
    );
    const write =
      mutation === "removal"
        ? credentials.remove("custom:chatIntelligence")
        : credentials.save("custom:chatIntelligence", "key", "fixture-new");
    const held = await real.fs.nextHold();
    const during = await describe();
    assert.equal(during.generation, before.generation);
    assert.equal(during.present, before.present);
    const request = handlers.get("personal-inference:models")(event, {
      ...input,
      recipientToken: during.recipientToken,
    });
    if (mutation === "failed replacement") held.fail(new Error("fixture encrypted write failure"));
    else held.release();
    await write;
    if (mutation === "failed replacement") {
      await request;
      assert.equal(calls.length, 1);
      assert.deepEqual(Object.fromEntries(new Headers(calls[0][1].headers)), {
        authorization: "Bearer fixture-old",
      });
      assert.equal((await describe()).generation, before.generation);
      api.dispose();
      return;
    }
    await assert.rejects(request, /Recipient changed/);
    assert.deepEqual(calls, []);
    const reviewed = await describe();
    await handlers.get("personal-inference:models")(event, {
      ...input,
      recipientToken: reviewed.recipientToken,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "https://models.fixture.test/v1/models");
    assert.deepEqual(
      // The metered transport (Sealed mode) normalizes headers into a Headers object.
      Object.fromEntries(new Headers(calls[0][1].headers)),
      mutation === "removal" ? {} : { authorization: "Bearer fixture-new" }
    );
    api.dispose();
  });

// Baseline guard: fixed OpenRouter host still requires the exact reviewed slot,
// sender, complete normalized config and known authority before dispatch.
test("baseline guard: registered discovery handlers fail closed for missing or changed recipient authority", async () => {
  const handlers = new Map();
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false });
  const codex = Object.assign(new EventEmitter(), { stop() {} });
  let state = { id: "openrouter", generation: 1, present: true };
  let fenced = false;
  const calls = [];
  const credentials = {
    list: () => [state],
    isFenced: () => fenced,
    captureCommitted: async () => ({ ...state, values: { key: "fixture-key" } }),
  };
  const api = registerPersonalInferenceIPC({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler() {} },
    codex,
    credentials,
    fetchModels: async (...args) => {
      calls.push(args);
      return { ok: true, body: new Response('{"data":[]}').body };
    },
  });
  const invoke = (method, input, owner = sender) =>
    handlers.get("personal-inference:" + method)({ sender: owner }, input);
  const input = {
    provider: "openrouter",
    credentialRef: "openrouter",
    inferenceScope: "chatIntelligence",
    baseUrl: "https://ignored.fixture.test",
  };
  const description = await invoke("describe-models", input);
  assert.equal(description.host, "openrouter.ai");
  assert.equal(description.credentialId, "openrouter");
  assert.deepEqual(Object.keys(description).sort(), [
    "credentialId",
    "generation",
    "host",
    "present",
    "recipientToken",
  ]);
  assert.equal(JSON.stringify(description).includes("fixture-key"), false);
  await assert.rejects(invoke("models", input), /Recipient changed/);
  await assert.rejects(
    invoke(
      "models",
      { ...input, recipientToken: description.recipientToken },
      Object.assign(new EventEmitter(), { isDestroyed: () => false })
    ),
    /Recipient changed/
  );
  await assert.rejects(
    invoke("models", {
      ...input,
      inferenceScope: "noteFormatting",
      recipientToken: description.recipientToken,
    }),
    /Recipient changed/
  );
  state = { ...state, unknown: true };
  await assert.rejects(invoke("describe-models", input), /unavailable/);
  state = { ...state, unknown: false };
  fenced = true;
  await assert.rejects(invoke("describe-models", input), /unavailable/);
  fenced = false;
  await assert.rejects(
    invoke("describe-models", { provider: "custom", baseUrl: "not a URL" }),
    /valid provider endpoint/
  );
  assert.deepEqual(calls, []);
  await invoke("models", { ...input, recipientToken: description.recipientToken });
  assert.equal(calls[0][0], "https://openrouter.ai/api/v1/models");
  api.dispose();
});
