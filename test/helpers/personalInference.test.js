const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  validateRequest,
  validateCredentialRef,
  registerPersonalInferenceIPC,
  APP_TOOLS,
} = require("../../src/helpers/personalInference");
const request = {
  requestId: "request-1",
  provider: "openai",
  model: "example-model",
  messages: [{ role: "user", content: "test" }],
};
test("separates credentials, provider origins, and task scopes", () => {
  assert.equal(validateRequest(request).credentialRef, "openai");
  assert.throws(() => validateRequest({ ...request, apiKey: "secret" }), /never a key/);
  assert.throws(
    () => validateRequest({ ...request, credentialRef: "anthropic" }),
    /does not match/
  );
  assert.throws(
    () => validateRequest({ ...request, baseUrl: "https://unrelated.invalid" }),
    /Only custom/
  );
  assert.throws(() => validateCredentialRef("CUSTOM_ANYTHING"), /Invalid/);
  assert.equal(
    validateRequest({
      ...request,
      provider: "custom",
      baseUrl: "https://example.invalid/v1",
      inferenceScope: "noteFormatting",
    }).credentialRef,
    "custom:noteFormatting"
  );
});
test("rejects hosted services and remote endpoints masquerading as local models", () => {
  assert.throws(() => validateRequest({ ...request, provider: "openwhispr" }), /supported/);
  assert.throws(
    () =>
      validateRequest({ ...request, provider: "custom", baseUrl: "https://api.openwhispr.com/v1" }),
    /hosted/
  );
  assert.throws(
    () => validateRequest({ ...request, provider: "local", baseUrl: "https://api.example.com/v1" }),
    /loopback/
  );
  assert.equal(
    validateRequest({ ...request, provider: "local", baseUrl: "http://127.0.0.1:8080/v1" })
      .provider,
    "local"
  );
});
test("cleanup cannot request tools and assistant tools use an explicit allowlist", () => {
  const tool = { name: "search_notes", description: "Search", parameters: { type: "object" } };
  assert.throws(() => validateRequest({ ...request, tools: [tool] }), /only supports text/);
  assert.equal(
    validateRequest({ ...request, inferenceScope: "chatIntelligence", tools: [tool] }).tools.length,
    1
  );
  assert.throws(
    () =>
      validateRequest({
        ...request,
        inferenceScope: "chatIntelligence",
        tools: [{ ...tool, name: "exec_command" }],
      }),
    /registered application/
  );
});
test("the main-process tool allowlist exactly matches the application's complete tool registry", async () => {
  const { createToolRegistry } = await import("../../src/services/tools/index.ts");
  const registry = createToolRegistry({
    calendarConnected: true,
    vocabulary: {
      getDictionary: () => [],
      updateDictionary: () => {},
      getSnippets: () => [{ trigger: "example", replacement: "fixture" }],
      setSnippets: () => {},
    },
  });
  assert.deepEqual(
    [...APP_TOOLS].sort(),
    registry
      .getAll()
      .map((tool) => tool.name)
      .sort()
  );
});
test("credential status never reveals the secret and registration cleans up", async () => {
  const handlers = new Map();
  const codex = new EventEmitter();
  codex.stop = () => {};
  const ipcMain = {
    handle: (name, fn) => handlers.set(name, fn),
    removeHandler: (name) => handlers.delete(name),
  };
  let saved;
  const service = registerPersonalInferenceIPC({
    ipcMain,
    codex,
    userDataPath: "/tmp",
    getCredential: async () => "fixture-secret",
    saveCredential: async (...args) => {
      saved = args;
    },
  });
  assert.deepEqual(await handlers.get("personal-inference:credential-status")({}, "openai"), {
    configured: true,
  });
  assert.deepEqual(
    await handlers.get("personal-inference:credential-save")(
      {},
      "custom:chatIntelligence",
      " new-secret "
    ),
    { configured: true }
  );
  assert.deepEqual(saved, ["custom:chatIntelligence", "new-secret"]);
  service.dispose();
  assert.equal(handlers.size, 0);
});
