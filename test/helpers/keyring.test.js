const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { deferred } = require("./harness/deferred");
const { fakeCredentialEnv, fakeCodexFs } = require("./harness/fakeCredentialEnv");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority.js");
const {
  KEYRING_IDS,
  ROTATION_DAYS,
  classifyResult,
  createKeyring,
  enterpriseVerifyTarget,
  keyringDisplayName,
  startRotationReminders,
  testConfigFor,
} = require("../../src/helpers/keyring.js");

const DAY = 86_400_000;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const REJECTED = { success: false, errorCode: "credentialsRejected", status: 401 };

function fakeStore() {
  const rows = new Map();
  return {
    rows,
    all: () => [...rows.values()],
    save: (row) => rows.set(row.identity, { ...row }),
    remove: (identity) => rows.delete(identity),
  };
}

// A real credential authority over an in-memory environment, so replacement,
// removal and reset go through exactly the generation logic main uses.
function setup({
  initial = { OPENAI_API_KEY: "sk-a", GROQ_API_KEY: "gsk-a" },
  runTest,
  isSealed,
  enterprise = {},
} = {}) {
  const env = fakeCredentialEnv(initial);
  let clock = 1_000_000;
  const credentials = createCredentialAuthority({
    env,
    fs: fakeCodexFs(),
    codexHome: "/profile/codex",
    now: () => clock,
    setTimer: () => {},
  });
  const store = fakeStore();
  const calls = [];
  const captured = [];
  const pending = [];
  const changes = [];
  const keyring = createKeyring({
    store,
    credentials,
    runTest:
      runTest ||
      ((config, values) => {
        calls.push(config);
        captured.push(values);
        const gate = deferred();
        pending.push(gate);
        return gate.promise;
      }),
    now: () => clock,
    broadcast: (channel, payload) => changes.push({ channel, payload }),
    isSealed,
    enterpriseConfig: () => enterprise,
  });
  const sender = new EventEmitter();
  sender.isDestroyed = () => false;
  const rawVerify = keyring.verify;
  const rawDescribe = keyring.describeVerify;
  keyring.describeVerify = async (id, options) => {
    const { recipientToken: _recipientToken, ...description } = await rawDescribe(
      id,
      options,
      sender
    );
    return description;
  };
  keyring.verify = async (id, options = {}) => {
    const description = await rawDescribe(id, options, sender);
    return rawVerify(id, { ...options, recipientToken: description.recipientToken }, sender);
  };
  const status = (identity) => keyring.list().find((e) => e.id === identity)?.status;
  return {
    keyring,
    credentials,
    env,
    store,
    calls,
    captured,
    pending,
    changes,
    status,
    advance: (ms) => (clock += ms),
    now: () => clock,
  };
}

// change-driving: the module does not exist yet.
test("the keyring lists stored identities only, unverified until checked", () => {
  const { keyring } = setup();
  assert.deepEqual(keyring.list(), [
    {
      id: "openai",
      providerId: "openai",
      status: "unverified",
      lastVerifiedAt: null,
      lastErrorCode: null,
      lastErrorStatus: null,
      reminderDueAt: null,
    },
    {
      id: "groq",
      providerId: "groq",
      status: "unverified",
      lastVerifiedAt: null,
      lastErrorCode: null,
      lastErrorStatus: null,
      reminderDueAt: null,
    },
  ]);
  assert.ok(KEYRING_IDS.includes("corti:text") && KEYRING_IDS.includes("corti:speech"));
  assert.ok(!KEYRING_IDS.includes("corti"), "Corti is two identities, never one");
  for (const id of ["codex", "bedrock", "azure", "vertex", "custom:noteFormatting"]) {
    assert.ok(!KEYRING_IDS.includes(id), `${id} has no keyring Verify`);
  }
});

// change-driving.
test("verify records the verdict in main and broadcasts the change, never the key", async () => {
  const { keyring, store, calls, captured, pending, changes, now } = setup();
  const running = keyring.verify("openai");
  await tick(); // the committed value is captured in the credential's queue first
  assert.deepEqual(calls, [{ scope: "reasoning", provider: "openai" }]);
  assert.deepEqual(captured, [{ key: "sk-a" }], "the request carries the committed key, from main");
  pending[0].resolve({ success: true });
  const result = await running;
  assert.equal(result.outcome, "recorded");
  assert.equal(result.entry.status, "verified");
  assert.equal(result.entry.lastVerifiedAt, now());
  assert.deepEqual(changes.at(-1), { channel: "keyring-changed", payload: { id: "openai" } });
  assert.ok(!JSON.stringify([...store.rows.values()]).includes("sk-a"), "no key material stored");
});

// change-driving (I10): identity decides scope and credentials.
test("Corti speech is tested with the stored client pair, Corti text with its API key", async () => {
  assert.deepEqual(testConfigFor("corti:speech", { cortiEnvironment: "eu", cortiTenant: "acme" }), {
    scope: "transcription",
    provider: "corti",
    clientId: "__stored__",
    clientSecret: "__stored__",
    environment: "eu",
    tenant: "acme",
  });
  assert.deepEqual(testConfigFor("corti:speech"), {
    scope: "transcription",
    provider: "corti",
    clientId: "__stored__",
    clientSecret: "__stored__",
    environment: "us",
    tenant: "base",
  });
  assert.deepEqual(testConfigFor("corti:text"), { scope: "reasoning", provider: "corti" });
  assert.deepEqual(testConfigFor("deepgram"), { scope: "transcription", provider: "deepgram" });
  assert.equal(testConfigFor("corti:speech", { cortiEnvironment: "mars" }), null);
  assert.equal(testConfigFor("corti:speech", { cortiTenant: "bad tenant" }), null);
  assert.equal(keyringDisplayName("corti:speech"), "Corti");

  const { keyring, status } = setup({
    initial: { CORTI_API_KEY: "ck", CORTI_CLIENT_ID: "cid", CORTI_CLIENT_SECRET: "csec" },
    runTest: async (config) => (config.scope === "reasoning" ? REJECTED : { success: true }),
  });
  assert.equal((await keyring.verify("corti:text")).outcome, "recorded");
  assert.equal((await keyring.verify("corti:speech")).outcome, "recorded");
  assert.equal(status("corti:text"), "rejected");
  assert.equal(status("corti:speech"), "verified", "a bad text key never pauses speech");
  assert.deepEqual(await keyring.verify("corti:speech", { cortiEnvironment: "mars" }), {
    outcome: "invalidOptions",
    entry: keyring.list({ cortiEnvironment: "mars" }).find((e) => e.id === "corti:speech"),
  });
});

// change-driving (I11): the reproduced bug, replacement during Verify.
test("a replacement during Verify discards the stale verdict", async () => {
  const { keyring, credentials, pending, status } = setup();
  const running = keyring.verify("openai");
  await tick();
  await credentials.save("openai", "key", "sk-replacement");
  pending[0].resolve(REJECTED);
  const result = await running;
  assert.equal(result.outcome, "superseded");
  assert.equal(status("openai"), "unverified", "the replacement is not marked rejected");
});

// change-driving (I11): removal during Verify must not resurrect a row.
test("a removal during Verify leaves no health row behind", async () => {
  const { keyring, credentials, pending, store } = setup();
  const running = keyring.verify("groq");
  await tick();
  await credentials.remove("groq");
  pending[0].resolve({ success: true });
  assert.deepEqual(await running, { outcome: "superseded", entry: null });
  assert.equal(store.rows.has("groq"), false);
  assert.equal(
    keyring.list().some((e) => e.id === "groq"),
    false
  );
});

// change-driving (I11): two verifications that finish in the wrong order.
test("out-of-order verifications keep the newest credential's verdict", async () => {
  const { keyring, credentials, calls, captured, pending, status } = setup();
  const older = keyring.verify("openai");
  await tick();
  await credentials.save("openai", "key", "sk-new");
  const newer = keyring.verify("openai");
  await tick();
  assert.equal(calls.length, 2, "a new generation is a new test, not coalesced");
  assert.deepEqual(
    captured,
    [{ key: "sk-a" }, { key: "sk-new" }],
    "each test carries its own committed key"
  );
  pending[1].resolve({ success: true });
  assert.equal((await newer).outcome, "recorded");
  pending[0].resolve(REJECTED);
  assert.equal((await older).outcome, "superseded");
  assert.equal(status("openai"), "verified");
});

// change-driving (I11): concurrent Verify of one credential is one request.
test("concurrent Verify of the same credential is coalesced into one request", async () => {
  const { keyring, calls, pending } = setup();
  const a = keyring.verify("groq");
  const b = keyring.verify("groq");
  await tick();
  assert.equal(calls.length, 1);
  pending[0].resolve({ success: true });
  assert.equal(await a, await b);
  const again = keyring.verify("groq");
  await tick();
  assert.equal(calls.length, 2, "a later Verify runs again");
  pending[1].resolve({ success: true });
  await again;
});

// change-driving (I11): Verify all (sequential verify over list()) interrupted by changes.
test("Verify all interrupted by a replacement and a removal records only current verdicts", async () => {
  const providers = [];
  let credentials;
  const ctx = setup({
    initial: { OPENAI_API_KEY: "sk-a", GROQ_API_KEY: "gsk-a", MISTRAL_API_KEY: "mk-a" },
    runTest: async (config) => {
      providers.push(config.provider);
      if (config.provider === "groq") {
        await credentials.save("groq", "key", "gsk-new");
        await credentials.remove("mistral");
      }
      return { success: true };
    },
  });
  credentials = ctx.credentials;
  const outcomes = [];
  for (const entry of ctx.keyring.list()) {
    outcomes.push([entry.id, (await ctx.keyring.verify(entry.id)).outcome]);
  }
  assert.deepEqual(outcomes, [
    ["openai", "recorded"],
    ["groq", "superseded"],
    ["mistral", "missing"],
  ]);
  assert.deepEqual(providers, ["openai", "groq"], "a removed key is never sent");
  assert.equal(ctx.status("openai"), "verified");
  assert.equal(ctx.status("groq"), "unverified");
  assert.equal(ctx.store.rows.has("mistral"), false);
});

// change-driving (I3): a rejected verdict does not outlive the key it judged.
test("replacing a rejected key resets it to unverified and tells every window", async () => {
  const { keyring, credentials, changes, status } = setup({ runTest: async () => REJECTED });
  await keyring.verify("groq");
  assert.equal(status("groq"), "rejected");
  changes.length = 0;
  await credentials.save("groq", "key", "gsk-fixed");
  assert.equal(status("groq"), "unverified");
  const entry = keyring.list().find((e) => e.id === "groq");
  assert.equal(entry.lastErrorCode, null);
  assert.deepEqual(changes, [{ channel: "keyring-changed", payload: { id: "groq" } }]);
});

// change-driving (I11): reset invalidates everything in flight.
test("reset drops health rows and discards in-flight verdicts", async () => {
  const { keyring, credentials, pending, store, env } = setup();
  const first = keyring.verify("groq");
  await tick();
  pending[0].resolve({ success: true });
  await first;
  assert.equal(store.rows.has("groq"), true);
  const running = keyring.verify("openai");
  await tick();
  // cleanup-app erases the credential store inside the authority's reset barrier.
  await credentials.reset(async () => env.values.clear());
  pending[1].resolve({ success: true });
  assert.deepEqual(await running, { outcome: "superseded", entry: null });
  assert.equal(store.rows.size, 0);
});

// change-driving: no request leaves without a stored credential, a known identity or while sealed.
test("unknown identities, missing credentials and sealed mode make no request", async () => {
  const { keyring, calls } = setup({ initial: {} });
  await assert.rejects(keyring.verify("evil"), /Unknown (keyring|credential) identity/);
  await assert.rejects(keyring.verify("codex"), /Unknown (keyring|credential) identity/);
  assert.deepEqual(await keyring.verify("openai"), { outcome: "missing", entry: null });
  assert.equal(calls.length, 0);
  const sealed = setup({ isSealed: () => true });
  assert.equal((await sealed.keyring.verify("openai")).outcome, "sealed");
  assert.equal(sealed.calls.length, 0);
});

// change-driving (R2-7): Plan 07's gated transport throws a sealed refusal;
// v1 caught it as "network" and recorded the key unreachable.
test("a sealed refusal thrown by the transport is outcome sealed and leaves health unchanged", async () => {
  let mode = "ok";
  const { keyring, store } = setup({
    runTest: async () => {
      if (mode === "sealed") {
        throw Object.assign(new Error("[SEALED_MODE] Sealed mode is on"), { code: "SEALED_MODE" });
      }
      if (mode === "wrapped") {
        throw new Error("fetch failed", { cause: new Error("[SEALED_MODE:interrupted] stopped") });
      }
      return { success: true };
    },
  });
  await keyring.verify("groq");
  const before = { ...store.rows.get("groq") };
  for (mode of ["sealed", "wrapped"]) {
    const result = await keyring.verify("groq");
    assert.equal(result.outcome, "sealed", mode);
    assert.equal(result.entry.status, "verified");
    assert.deepEqual(store.rows.get("groq"), before, `${mode}: no row write`);
  }
});

// change-driving (R2-7): sealing while the save wait is pending still refuses.
test("isSealed is checked after the save wait", async () => {
  let sealedNow = false;
  const { keyring, credentials, env, calls } = setup({ isSealed: () => sealedNow });
  const gate = deferred();
  env.persistImpl = () => gate.promise;
  const saving = credentials.save("groq", "key", "gsk-new");
  const verifying = keyring.verify("groq"); // queued behind the save
  sealedNow = true;
  gate.resolve();
  await saving;
  assert.equal((await verifying).outcome, "sealed");
  assert.equal(calls.length, 0);
});

// change-driving (R2-6): the disclosure comes from the request's own builders.
test("describeVerify names the hosts and slot names each Verify sends to", async () => {
  const { keyring } = setup({
    initial: { BEDROCK_ACCESS_KEY_ID: "AKIA", BEDROCK_SECRET_ACCESS_KEY: "s", VERTEX_API_KEY: "" },
    enterprise: {
      bedrockRegion: "cn-north-1",
      azureEndpoint: "https://acme.openai.azure.com/openai",
      vertexLocation: "eu",
      vertexAuthSource: "adc",
    },
  });
  assert.deepEqual(
    await keyring.describeVerify("corti:speech", { cortiEnvironment: "eu", cortiTenant: "acme" }),
    { hosts: ["auth.eu.corti.app"], fields: ["clientId", "clientSecret"] },
    "the token endpoint, not the speech API host"
  );
  assert.deepEqual(await keyring.describeVerify("corti:speech"), {
    hosts: ["auth.us.corti.app"],
    fields: ["clientId", "clientSecret"],
  });
  assert.deepEqual(await keyring.describeVerify("corti:speech", { cortiEnvironment: "mars" }), {
    hosts: [],
    fields: ["clientId", "clientSecret"],
  });
  assert.deepEqual(await keyring.describeVerify("corti:text"), {
    hosts: ["ai.eu.corti.app"],
    fields: ["key"],
  });
  assert.deepEqual(await keyring.describeVerify("groq"), {
    hosts: ["api.groq.com"],
    fields: ["key"],
  });
  assert.deepEqual(await keyring.describeVerify("deepgram"), {
    hosts: ["api.deepgram.com"],
    fields: ["key"],
  });
  assert.deepEqual(await keyring.describeVerify("azure"), {
    hosts: ["acme.openai.azure.com"],
    fields: ["key"],
  });
  assert.deepEqual(await keyring.describeVerify("bedrock"), {
    hosts: ["bedrock-runtime.cn-north-1.amazonaws.com.cn"],
    fields: ["accessKeyId", "secretAccessKey"],
  });
  assert.deepEqual(await keyring.describeVerify("vertex"), {
    hosts: ["aiplatform.eu.rep.googleapis.com"],
    fields: [],
  });
  assert.deepEqual(
    enterpriseVerifyTarget(
      "vertex",
      { vertexAuthSource: "adc", vertexLocation: "europe-west4" },
      { key: true }
    ),
    { hosts: ["europe-west4-aiplatform.googleapis.com"], fields: [] },
    "ADC keeps the configured recipient and sends no API key even if one is stored"
  );
  assert.deepEqual(
    enterpriseVerifyTarget(
      "vertex",
      { vertexAuthSource: "apiKey", routeFacts: { vertexApiKeyEnv: true } },
      { key: false }
    ),
    { hosts: ["aiplatform.googleapis.com"], fields: ["environmentKey"] },
    "apiKey mode preserves the committed legacy fallback"
  );
  await assert.rejects(keyring.describeVerify("codex"), /Unknown credential identity/);
});

test("enterprise disclosure follows the enterprise SDK rules", () => {
  assert.deepEqual(enterpriseVerifyTarget("azure", { azureEndpoint: "http://acme.example" }, {}), {
    hosts: [],
    fields: ["key"],
  });
  assert.deepEqual(
    enterpriseVerifyTarget("azure", { azureEndpoint: "https://u:p@acme.example" }, {}).hosts,
    []
  );
  assert.deepEqual(
    enterpriseVerifyTarget("bedrock", { bedrockProfile: "work" }, { accessKeyId: true }),
    {
      hosts: ["bedrock-runtime.us-east-1.amazonaws.com"],
      fields: ["profile"],
    }
  );
  assert.deepEqual(
    enterpriseVerifyTarget("vertex", { vertexAuthSource: "apiKey" }, { key: true }),
    {
      hosts: ["aiplatform.googleapis.com"],
      fields: ["key"],
    }
  );
  assert.deepEqual(
    enterpriseVerifyTarget(
      "vertex",
      { vertexAuthSource: "adc", vertexLocation: "global" },
      { key: true }
    ).hosts,
    ["aiplatform.googleapis.com"]
  );
  assert.deepEqual(enterpriseVerifyTarget("vertex", { vertexAuthSource: "adc" }, { key: true }), {
    hosts: ["us-central1-aiplatform.googleapis.com"],
    fields: [],
  });
  assert.deepEqual(
    enterpriseVerifyTarget("vertex", { vertexAuthSource: "apiKey" }, { key: false }),
    {
      hosts: ["aiplatform.googleapis.com"],
      fields: ["key"],
    },
    "missing apiKey never falls back to ADC"
  );
  // Hosts no request can reach are not named (Task 1's requestHost rule).
  assert.deepEqual(
    enterpriseVerifyTarget(
      "vertex",
      { vertexAuthSource: "adc", vertexLocation: "bad location" },
      {}
    ).hosts,
    []
  );
  assert.deepEqual(enterpriseVerifyTarget("bedrock", { bedrockRegion: "us east" }, {}).hosts, []);
});

// change-driving (R2-6 enterprise): main's environment overrides, as Task 1's
// enterpriseRouteFacts reports them, move the host the same way enterpriseRequestHost does.
test("enterprise disclosure follows main's environment overrides", () => {
  const facts = (over) => ({
    bedrockEndpoint: { set: false, host: null },
    bedrockProfile: false,
    vertexApiKeyEnv: false,
    vertexProjectEnv: false,
    ...over,
  });
  const proxy = facts({ bedrockEndpoint: { set: true, host: "bedrock-proxy.corp.example:8443" } });
  assert.deepEqual(
    enterpriseVerifyTarget(
      "bedrock",
      { bedrockRegion: "eu-west-1", routeFacts: proxy },
      { accessKeyId: true, secretAccessKey: true }
    ),
    { hosts: ["bedrock-proxy.corp.example:8443"], fields: ["accessKeyId", "secretAccessKey"] },
    "the endpoint override wins over the region"
  );
  assert.deepEqual(
    enterpriseVerifyTarget(
      "bedrock",
      {
        bedrockRegion: "eu-west-1",
        routeFacts: facts({ bedrockEndpoint: { set: true, host: null } }),
      },
      {}
    ),
    { hosts: [], fields: [] },
    "set but unusable: no request can be made"
  );
  assert.deepEqual(
    enterpriseVerifyTarget(
      "vertex",
      {
        vertexAuthSource: "adc",
        vertexProject: "acme",
        vertexLocation: "europe-west4",
        routeFacts: facts({ vertexApiKeyEnv: true }),
      },
      { key: true }
    ),
    { hosts: ["europe-west4-aiplatform.googleapis.com"], fields: [] },
    "ADC ignores both the stored key and ambient fallback"
  );
  assert.deepEqual(
    enterpriseVerifyTarget(
      "vertex",
      { vertexAuthSource: "apiKey", routeFacts: facts({ vertexApiKeyEnv: true }) },
      { key: false }
    ),
    { hosts: ["aiplatform.googleapis.com"], fields: ["environmentKey"] },
    "apiKey mode preserves the committed legacy fallback"
  );
  assert.deepEqual(
    enterpriseVerifyTarget(
      "vertex",
      { vertexAuthSource: "apiKey", routeFacts: facts({ vertexApiKeyEnv: true }) },
      { key: true }
    ),
    { hosts: ["aiplatform.googleapis.com"], fields: ["key"] },
    "a stored key wins over the fallback"
  );
  assert.deepEqual(
    enterpriseVerifyTarget(
      "azure",
      { azureEndpoint: "https://acme.openai.azure.com/openai", routeFacts: proxy },
      {}
    ).hosts,
    ["acme.openai.azure.com"],
    "no environment variable redirects Azure"
  );
});

// baseline semantics carried over from v1 (change-driving only because the module is new).
test("a rejection keeps its code; a network failure or a throw is unreachable", async () => {
  assert.deepEqual(classifyResult({ success: true }), {
    status: "verified",
    errorCode: null,
    httpStatus: null,
  });
  assert.deepEqual(classifyResult(REJECTED), {
    status: "rejected",
    errorCode: "credentialsRejected",
    httpStatus: 401,
  });
  assert.deepEqual(classifyResult({ success: false, errorCode: "timeout" }), {
    status: "unreachable",
    errorCode: "timeout",
    httpStatus: null,
  });
  const { keyring, status } = setup({
    runTest: async () => {
      throw new Error("socket hang up");
    },
  });
  const result = await keyring.verify("openai");
  assert.equal(result.entry.status, "unreachable");
  assert.equal(result.entry.lastErrorCode, "network");
  assert.equal(status("openai"), "unreachable");
});

// change-driving.
test("reminders fire once when due, restart when the key is replaced, and can be switched off", async () => {
  const { keyring, credentials, advance, now } = setup();
  assert.equal(keyring.setReminder("anthropic", true), null, "no reminder without a key");
  const entry = keyring.setReminder("groq", true);
  assert.equal(entry.reminderDueAt, now() + ROTATION_DAYS * DAY);
  assert.deepEqual(keyring.takeDueReminders(), []);
  advance(ROTATION_DAYS * DAY);
  assert.deepEqual(keyring.takeDueReminders(), ["groq"]);
  assert.deepEqual(keyring.takeDueReminders(), [], "only once");
  await credentials.save("groq", "key", "gsk-rotated");
  const rotated = keyring.list().find((e) => e.id === "groq");
  assert.equal(rotated.reminderDueAt, now() + ROTATION_DAYS * DAY, "rotation restarts the clock");
  keyring.setReminder("groq", false);
  assert.equal(keyring.list().find((e) => e.id === "groq").reminderDueAt, null);
});

// change-driving.
test("the reminder loop notifies per due identity, survives a failing check and stops cleanly", () => {
  const notified = [];
  let intervalFn;
  let timeoutFn;
  let failNext = true;
  const stop = startRotationReminders({
    keyring: {
      takeDueReminders: () => {
        if (failNext) {
          failNext = false;
          throw new Error("Database not initialized");
        }
        return ["corti:speech"];
      },
    },
    notify: (identity) => notified.push(identity),
    intervalMs: 1000,
    setIntervalImpl: (fn) => ((intervalFn = fn), 7),
    setTimeoutImpl: (fn) => ((timeoutFn = fn), 8),
    clearIntervalImpl: () => {},
    clearTimeoutImpl: () => {},
  });
  timeoutFn();
  intervalFn();
  assert.deepEqual(notified, ["corti:speech"]);
  stop();
});

// baseline guard: reminder resources do not keep main alive and dispose exactly once.
test("reminder timers unref and cleanup uses their own handles", () => {
  const cleared = [];
  let unrefs = 0;
  const first = { unref: () => unrefs++ };
  const loop = { unref: () => unrefs++ };
  const stop = startRotationReminders({
    keyring: { takeDueReminders: () => [] },
    notify: () => {},
    setTimeoutImpl: () => first,
    setIntervalImpl: () => loop,
    clearTimeoutImpl: (handle) => cleared.push(handle),
    clearIntervalImpl: (handle) => cleared.push(handle),
  });
  assert.equal(unrefs, 2);
  stop();
  assert.deepEqual(cleared, [first, loop]);
});
