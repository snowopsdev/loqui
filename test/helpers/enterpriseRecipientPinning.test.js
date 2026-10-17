const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const { registerPersonalInferenceIPC } = require("../../src/helpers/personalInference");
const {
  resolveEnterpriseExecutor,
  buildEnterpriseRecipientFacts,
} = require("../../src/helpers/enterpriseRecipientIdentity");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const configA = { azureEndpoint: "https://a.example/v1", azureApiVersion: "2024-10-21" };
const configB = { ...configA, azureEndpoint: "https://b.example/v1" };
function fixture(t, options = {}) {
  const handlers = new Map();
  const events = [];
  const factories = [];
  const codex = new EventEmitter();
  codex.stop = () => {};
  const sender = new EventEmitter();
  Object.assign(sender, {
    id: 1,
    isDestroyed: () => false,
    send: (_, event) => events.push(event),
  });
  const fake = {
    specificationVersion: "v3",
    provider: "fixture",
    modelId: "fixture",
    supportedUrls: {},
    doGenerate: async () => ({
      content: [{ type: "text", text: "Cleaned." }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: {}, outputTokens: {} },
      warnings: [],
    }),
  };
  const service = registerPersonalInferenceIPC({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: () => {} },
    codex,
    userDataPath: "/fixture-unused",
    getCredential: async () => "synthetic-key",
    saveCredential: async () => {},
    getEnterpriseConfig: async () => configA,
    modelFactory: async (...args) => {
      factories.push(args);
      return fake;
    },
    ...options,
  });
  t.after(() => service.dispose());
  const request = {
    requestId: "pin-1",
    provider: "azure",
    model: "deployment",
    messages: [{ role: "user", content: "original words" }],
    dictationOperation: true,
    dictationSessionId: "session-A",
    enterpriseRecipientTag: resolveEnterpriseExecutor("azure", configA, {}).tag,
  };
  return {
    factories,
    fake,
    events,
    request,
    invoke: (input, channel = "text-generate") =>
      handlers.get(`personal-inference:${channel}`)({ sender }, input),
  };
}

test("Apply during credential resolution refuses before the factory and preserves detached operation/context", async (t) => {
  const entered = deferred(),
    gate = deferred();
  let current = configA;
  const f = fixture(t, {
    getCredential: async () => {
      entered.resolve();
      await gate.promise;
      return "synthetic-rotated";
    },
    getEnterpriseConfig: async () => current,
  });
  const context = { released: false };
  const bytes = Uint8Array.of(7, 8, 9);
  const held = {
    session: Object.freeze({ id: "session-A", tag: f.request.enterpriseRecipientTag }),
    context,
    bytes,
  };
  const pending = f.invoke(f.request);
  await entered.promise;
  current = configB;
  gate.resolve();
  assert.deepEqual(await pending, { error: "recipientChanged", code: "recipientChanged" });
  assert.equal(f.factories.length, 0);
  assert.equal(held.context, context);
  assert.equal(context.released, false);
  assert.deepEqual(Array.from(bytes), [7, 8, 9]);
  // Actual createCancelBuffer/restoreCancelled combined proof belongs to Task8.
});

test("credential rotation preserves the recipient; exact frozen executor reaches factory", async (t) => {
  let reads = 0;
  const f = fixture(t, {
    getCredential: async () => "synthetic-rotated",
    getEnterpriseConfig: async () => {
      reads++;
      return configA;
    },
  });
  assert.deepEqual(await f.invoke(f.request), { text: "Cleaned." });
  assert.equal(reads, 1);
  const args = f.factories[0];
  assert.ok(args[2] === "synthetic-rotated");
  assert.equal(Object.isFrozen(args[5]), true);
  assert.equal(args[5].endpoint, "https://a.example/v1");
  assert.equal(
    resolveEnterpriseExecutor(
      "azure",
      { azureEndpoint: args[5].endpoint, azureApiVersion: args[5].apiVersion },
      {}
    ).tag,
    f.request.enterpriseRecipientTag
  );
});

test("partial/malformed operation metadata and unknown recipients fail closed; correlation alone stays unrelated", async (t) => {
  const f = fixture(t);
  for (const patch of [
    { dictationSessionId: undefined },
    { enterpriseRecipientTag: undefined },
    { enterpriseRecipientTag: "unknown" },
    { dictationOperation: undefined },
    { dictationOperation: false },
    { dictationSessionId: " " },
  ])
    assert.deepEqual(await f.invoke({ ...f.request, ...patch }), {
      error: "recipientUnknown",
      code: "recipientUnknown",
    });
  assert.equal(f.factories.length, 0);
  assert.deepEqual(
    await f.invoke({
      ...f.request,
      dictationOperation: undefined,
      dictationSessionId: undefined,
      enterpriseRecipientTag: undefined,
      correlationId: "typed",
    }),
    { text: "Cleaned." }
  );
  assert.equal(f.factories.length, 1);
  const unknown = fixture(t, { getEnterpriseConfig: async () => ({}) });
  assert.deepEqual(await unknown.invoke(unknown.request), {
    error: "recipientUnknown",
    code: "recipientUnknown",
  });
  assert.equal(unknown.factories.length, 0);
  await f.invoke({ ...f.request, enterpriseRecipientTag: undefined }, "text-stream");
  assert.equal(f.events.at(-1).code, "recipientUnknown");
});

test("production default factory forwards executor, credential material and optional fetch separately", async (t) => {
  const original = Module._load;
  const calls = [];
  const fetchImpl = () => {
    throw new Error("No network");
  };
  const config = { vertexAuthSource: "apiKey", vertexProject: "", vertexLocation: "europe-west4" };
  const f = fixture(t, {
    modelFactory: undefined,
    getEnterpriseConfig: async () => config,
    fetchImpl,
  });
  Module._load = function (name, parent, isMain) {
    if (name === "./enterpriseAiProviders" && parent.filename.endsWith("personalInference.js"))
      return {
        getEnterpriseAIModel: (...args) => {
          calls.push(args);
          return f.fake;
        },
      };
    return original.call(this, name, parent, isMain);
  };
  t.after(() => {
    Module._load = original;
  });
  const tag = resolveEnterpriseExecutor("vertex", config, {}).tag;
  assert.deepEqual(
    await f.invoke({ ...f.request, provider: "vertex", enterpriseRecipientTag: tag }),
    { text: "Cleaned." }
  );
  const args = calls[0];
  assert.equal(args[0], "vertex");
  assert.equal(Object.isFrozen(args[3]), true);
  assert.equal(args[3].authSource, "apiKey");
  assert.equal(args[3].project, null);
  assert.equal(Object.isFrozen(args[4]), true);
  assert.ok(args[4].vertexApiKey === "synthetic-key");
  assert.equal(args[5], fetchImpl);
  assert.equal(
    Object.keys(args[3]).some((key) => /key|secret|credential/i.test(key)),
    false
  );
});

test("facts expose only statuses and opaque tags, never stale ready identity", () => {
  const facts = buildEnterpriseRecipientFacts(configA, {});
  assert.equal(facts.azure.status, "ready");
  assert.equal(buildEnterpriseRecipientFacts({}, {}).azure.status, "unknown");
  assert.notEqual(facts.azure.tag, buildEnterpriseRecipientFacts(configB, {}).azure.tag);
  for (const value of ["a.example", "apiVersion", "synthetic-key", "endpoint"])
    assert.equal(JSON.stringify(facts).includes(value), false);
});

test("actual main fact publisher refreshes tags on Apply, API-version commits and config reload; invalid config publishes unknown", async (t) => {
  const { enterpriseRouteIpc } = require("./harness/enterpriseRouteIpc");
  const ipc = enterpriseRouteIpc(t, {
    AZURE_OPENAI_ENDPOINT: "https://original.example",
    AZURE_OPENAI_API_VERSION: "2024-10-21",
    BEDROCK_REGION: "us-east-1",
    VERTEX_AUTH_SOURCE: "adc",
    VERTEX_PROJECT: "fixture-project",
  });
  const first = await ipc.invoke("get-enterprise-route-state");
  const originalTag = first.facts.enterpriseRecipients.azure.tag;
  assert.equal(first.facts.enterpriseRecipients.azure.status, "ready");
  await ipc.invoke("save-enterprise-route-patch", {
    patch: { azureEndpoint: "https://changed.example" },
    expected: first.current,
  });
  const changed = await ipc.invoke("get-enterprise-route-state");
  assert.notEqual(changed.facts.enterpriseRecipients.azure.tag, originalTag);
  assert.equal(
    ipc.broadcasts.at(-1)[1].facts.enterpriseRecipients.azure.tag,
    changed.facts.enterpriseRecipients.azure.tag
  );
  await ipc.env.saveAzureApiVersion("2025-01-01");
  const versioned = await ipc.invoke("get-enterprise-route-state");
  assert.notEqual(
    versioned.facts.enterpriseRecipients.azure.tag,
    changed.facts.enterpriseRecipients.azure.tag
  );
  assert.ok(versioned.version > changed.version);
  await ipc.invoke("save-enterprise-route-patch", {
    patch: { azureEndpoint: "invalid endpoint" },
    expected: versioned.current,
  });
  const invalid = await ipc.invoke("get-enterprise-route-state");
  assert.deepEqual(invalid.facts.enterpriseRecipients.azure, { status: "unknown" });
  const previousResources = process.resourcesPath;
  process.resourcesPath = "/fixture-runtime-unused";
  t.after(() => {
    if (previousResources === undefined) delete process.resourcesPath;
    else process.resourcesPath = previousResources;
  });
  process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = "https://new-bedrock.example/runtime";
  ipc.env.loadEnvironmentVariables();
  const reloaded = await ipc.invoke("get-enterprise-route-state");
  assert.ok(reloaded.version > invalid.version);
  assert.notEqual(
    reloaded.facts.enterpriseRecipients.bedrock.tag,
    invalid.facts.enterpriseRecipients.bedrock.tag
  );
  process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = "";
  ipc.env.loadEnvironmentVariables();
  assert.deepEqual(
    (await ipc.invoke("get-enterprise-route-state")).facts.enterpriseRecipients.bedrock,
    { status: "unknown" }
  );
  assert.equal(ipc.isolation.sweepStubCalls, 1, "only the fixture sweep stub ran");
});
