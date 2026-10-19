const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { registerPersonalInferenceIPC } = require("../../src/helpers/personalInference");
const { captureTextFactoryInputs } = require("../../src/helpers/textOperationCapture");
const { loadAudioManager } = require("./harness/audioManager");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const sender = (id) =>
  Object.assign(new EventEmitter(), { id, isDestroyed: () => false, send() {} });
function main(t, overrides = {}) {
  const handlers = new Map();
  const owner = sender(1);
  const calls = [];
  let generation = 1;
  let selected = {
    azureEndpoint: "https://fixture.invalid/a",
    azureApiVersion: "fixture-v1",
    vertexAuthSource: "apiKey",
    vertexProject: "project-a",
  };
  const codex = new EventEmitter();
  codex.stop = () => {};
  const meta = (id) => ({ id, present: true, generation });
  const service = registerPersonalInferenceIPC({
    ipcMain: {
      handle: (name, fn) => handlers.set(name, fn),
      removeHandler: (name) => handlers.delete(name),
    },
    userDataPath: "/fixture-never-read",
    codex,
    credentials: {
      list: () => ["azure", "vertex", "custom:dictationCleanup"].map(meta),
      captureCommitted: async (id) => ({ ...meta(id), values: { key: "fixture-key-a" } }),
    },
    textOperationSnapshot: () => ({ ...selected }),
    getCredential: () => assert.fail("captured path must not read live credentials"),
    getEnterpriseConfig: () => assert.fail("captured path must not read live enterprise config"),
    modelFactory: async (...args) => {
      calls.push(args);
      return {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "fixture",
        supportedUrls: {},
        doGenerate: async (_options) => ({
          content: [{ type: "text", text: "Cleaned fixture." }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        }),
      };
    },
    ...overrides,
  });
  t.after(() => service.dispose());
  return {
    owner,
    service,
    calls,
    invoke: async (name, input, from = owner) => {
      const result = await handlers.get(`personal-inference:${name}`)({ sender: from }, input);
      if (!result.ok) throw Object.assign(new Error(result.code), { code: result.code });
      return result.value;
    },
    change: (patch) => {
      selected = { ...selected, ...patch };
    },
    rotate: () => generation++,
  };
}
const descriptor = {
  provider: "azure",
  model: "fixture-model",
  inferenceScope: "dictationCleanup",
  systemPrompt: "fixture prompt",
  requireCompleteOutput: true,
};
const input = { messages: [{ role: "user", content: "fixture words" }], wordCount: 2 };
test("actual capture/run IPC executes first and retry with captured A credentials/config, rejects cross-sender and config override", async (t) => {
  const h = main(t);
  const token = await h.invoke("text-operation-capture", descriptor);
  assert.deepEqual(await h.invoke("text-operation-run", { token, request: input }), {
    text: "Cleaned fixture.",
  });
  assert.deepEqual(await h.invoke("text-operation-run", { token, request: input }), {
    text: "Cleaned fixture.",
  });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0][2], "fixture-key-a");
  assert.equal(h.calls[1][5], h.calls[0][5]);
  await assert.rejects(h.invoke("text-operation-run", { token, request: input }, sender(2)), {
    code: "CLEANUP_OPERATION_UNAVAILABLE",
  });
  await assert.rejects(
    h.invoke("text-operation-run", { token, request: { ...input, provider: "openai" } }),
    { code: "CLEANUP_FAILED" }
  );
});
for (const changed of [
  { azureEndpoint: "https://fixture.invalid/b" },
  { vertexAuthSource: "adc" },
  { vertexProject: "project-b" },
])
  test(`actual IPC captures before admission and refuses ${Object.keys(changed)[0]} change`, async (t) => {
    const gate = deferred();
    const h = main(t, { waitForAdmission: () => gate.promise });
    const pending = h.invoke("text-operation-capture", descriptor);
    const rejected = assert.rejects(pending, { code: "RECIPIENT_CHANGED" });
    h.change(changed);
    gate.resolve();
    await rejected;
    assert.equal(h.calls.length, 0);
  });
test("factory wait cannot resume into dispatch after recipient/credential generation changes", async (t) => {
  const gate = deferred();
  let transport = 0;
  const h = main(t, {
    modelFactory: async () => {
      await gate.promise;
      return {};
    },
    aiRuntime: () => ({
      isStepCount: () => {},
      generateText: () => {
        transport++;
        assert.fail("transport sentinel");
      },
    }),
  });
  const token = await h.invoke("text-operation-capture", descriptor);
  const pending = h.invoke("text-operation-run", { token, request: input });
  const rejected = assert.rejects(pending, { code: "RECIPIENT_CHANGED" });
  h.rotate();
  gate.resolve();
  await rejected;
  assert.equal(transport, 0);
});
test("static profile captured once; retry never rereads SDK auth source", async (t) => {
  let reads = 0;
  const h = main(t, {
    textOperationSnapshot: () => ({
      bedrockProfile: "fixture",
      bedrockRegion: "us-east-1",
      bedrockBaseURL: "https://fixture.invalid",
      bedrockCredentialsFile: "/fixture/credentials",
      bedrockConfigFile: "/fixture/config",
    }),
    credentials: {
      list: () => [{ id: "bedrock", present: true, generation: 1 }],
      captureCommitted: async () => ({ present: true, generation: 1, values: {} }),
    },
    captureTextFactoryInputs: (request, selected, values) =>
      captureTextFactoryInputs(request, selected, values, {
        parseProfiles: async () => {
          reads++;
          return {
            fixture: {
              aws_access_key_id: "fixture-id-a",
              aws_secret_access_key: "fixture-secret-a",
            },
          };
        },
      }),
  });
  const token = await h.invoke("text-operation-capture", { ...descriptor, provider: "bedrock" });
  await h.invoke("text-operation-run", { token, request: input });
  await h.invoke("text-operation-run", { token, request: input });
  assert.equal(reads, 1);
  assert.equal(h.calls[1][5].bedrockProfile, "");
  assert.equal(h.calls[1][5].bedrockAccessKeyId, "fixture-id-a");
});
test("original AudioManager first cleanup and retry share admitted sentence, prompt and A through deferred capture; B receives nothing", async (t) => {
  const gate = deferred();
  const h = main(t, { waitForAdmission: () => gate.promise });
  const { AudioManager, window, setSettings } = await loadAudioManager(t, {
    cachePrefix: "loqui-captured-cleanup-",
    settingsKey: "__capturedCleanupSettings",
    settings: {
      useCleanupModel: true,
      cleanupMode: "providers",
      cleanupProvider: "custom",
      cleanupModel: "model-a",
      cleanupCloudBaseUrl: "https://fixture.invalid/a",
      cleanupDisableThinking: true,
      preferredLanguage: "en",
      uiLanguage: "en",
      customPrompts: { cleanup: "fixture prompt-a" },
    },
    mockModules: {
      "/stores/settingsStore": `export const getSettings = () => globalThis.__capturedCleanupSettings; export const getEffectiveCleanupModel = () => getSettings().cleanupModel; export const selectResolvedLLMConfig = s => ({ mode: s.cleanupMode, provider: s.cleanupProvider, model: s.cleanupModel }); export const useSettingsStore = { getState: getSettings };`,
    },
  });
  window.electronAPI.personalInference = {
    captureTextOperation: (value) => h.invoke("text-operation-capture", value),
    runTextOperation: (value) => h.invoke("text-operation-run", value),
    retireTextOperation: (value) => h.invoke("text-operation-retire", value),
  };
  const manager = Object.assign(Object.create(AudioManager.prototype), {
    pendingCleanupFailure: null,
  });
  const recording = { private: true };
  const take = { demoId: "demo-a", takeId: "take-a" };
  manager.admitCleanupOperation(take, recording);
  manager._recordingContext = recording;
  const first = manager.processTranscriptionCore("fixture words", "fixture");
  setSettings({
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "openai",
    cleanupModel: "model-b",
    customPrompts: { cleanup: "fixture prompt-b" },
  });
  gate.resolve();
  assert.equal(await first, "Cleaned fixture.");
  const retry = await manager.retryCapturedCleanup({
    ...take,
    operationId: recording.cleanupOperation.identity.operationId,
    requestId: "retry-a",
  });
  assert.equal(retry.text, "Cleaned fixture.");
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0][0], "custom");
  assert.equal(h.calls[1][3], "https://fixture.invalid/a");
  assert.equal(h.calls[0][5], h.calls[1][5]);
  const original = h.calls[0];
  assert.equal(original[1], "model-a");
  manager.retireCapturedCleanup();
  assert.equal(
    (
      await manager.retryCapturedCleanup({
        ...take,
        operationId: recording.cleanupOperation.identity.operationId,
      })
    ).code,
    "CLEANUP_OPERATION_UNAVAILABLE"
  );
});
test("actual enterprise factory binds captured ADC credentials across SDK authentication waits and refuses changed project before dispatch", async (t) => {
  const Module = require("node:module");
  const originalLoad = Module._load;
  const gate = deferred();
  const sdk = [];
  const auth = [];
  Module._load = function (name, ...args) {
    if (name === "@ai-sdk/google-vertex")
      return {
        createVertex: (options) => {
          sdk.push(options);
          return (model) => ({ model });
        },
      };
    if (name === "google-auth-library")
      return {
        GoogleAuth: class {
          constructor(options) {
            auth.push(options);
          }
          getAccessToken() {
            return gate.promise;
          }
        },
      };
    return originalLoad.call(this, name, ...args);
  };
  t.after(() => {
    Module._load = originalLoad;
  });
  let reads = 0;
  let transport = 0;
  const h = main(t, {
    modelFactory: require("../../src/helpers/personalInference").createModel,
    captureTextFactoryInputs: (request, selected, values) =>
      captureTextFactoryInputs(
        request,
        { ...selected, vertexAuthSource: "adc", vertexAdcFile: "/fixture/adc.json" },
        values,
        {
          readFile: async (path) => {
            assert.equal(path, "/fixture/adc.json");
            reads++;
            return JSON.stringify({
              type: "authorized_user",
              client_id: "fixture-id",
              client_secret: "fixture-secret",
              refresh_token: "fixture-refresh",
            });
          },
        }
      ),
    aiRuntime: () => ({
      isStepCount: () => {},
      generateText: () => {
        transport++;
        assert.fail("transport sentinel");
      },
    }),
  });
  h.change({ vertexAuthSource: "adc", vertexLocation: "us-central1" });
  const token = await h.invoke("text-operation-capture", { ...descriptor, provider: "vertex" });
  const pending = h.invoke("text-operation-run", { token, request: input });
  const refused = assert.rejects(pending, { code: "RECIPIENT_CHANGED" });
  await new Promise((r) => setImmediate(r));
  assert.equal(auth.length, 1);
  assert.equal(auth[0].credentials.refresh_token, "fixture-refresh");
  h.change({ vertexProject: "project-b" });
  gate.resolve("fixture-access-token");
  await refused;
  assert.equal(reads, 1);
  assert.equal(sdk.length, 0);
  assert.equal(transport, 0);
});
test("actual factory construction uses captured Azure endpoint/key and operation budget; no Verify 12-second recording limit", async (t) => {
  const Module = require("node:module");
  const originalLoad = Module._load;
  const seen = [];
  Module._load = function (name, ...args) {
    if (name === "@ai-sdk/azure")
      return {
        createAzure: (options) => {
          seen.push(options);
          return (model) => ({ model });
        },
      };
    return originalLoad.call(this, name, ...args);
  };
  t.after(() => {
    Module._load = originalLoad;
  });
  const { getEnterpriseAIModel } = require("../../src/helpers/enterpriseAiProviders");
  const execution = {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 180000,
    assertLive() {},
  };
  const selected = await captureTextFactoryInputs(
    descriptor,
    { azureEndpoint: "https://fixture.invalid/a", azureApiVersion: "fixture-v1" },
    { key: "fixture-key-a" }
  );
  await getEnterpriseAIModel(
    "azure",
    descriptor.model,
    selected.apiKey,
    selected.enterprise,
    execution
  );
  assert.equal(seen[0].baseURL, "https://fixture.invalid/a");
  assert.equal(seen[0].apiKey, "fixture-key-a");
  assert.equal(seen[0].apiVersion, "fixture-v1");
  assert.equal(typeof seen[0].fetch, "function");
  assert.ok(execution.deadlineAt - Date.now() > 12000);
});
test("local original operation remains local with its admitted model after remote settings change", async (t) => {
  const h = main(t);
  const token = await h.invoke("text-operation-capture", {
    ...descriptor,
    provider: "local",
    model: "local-model-a",
  });
  const local = [];
  const run = () =>
    h.service.runCapturedLocal(
      { sender: h.owner },
      token,
      input,
      async (original, selected, execution) => {
        execution.assertLive();
        local.push({ original, selected });
        return "Local.";
      }
    );
  assert.equal(await run(), "Local.");
  assert.equal(await run(), "Local.");
  assert.equal(local[1].selected.model, "local-model-a");
  assert.equal(local[0].original, local[1].original);
  assert.equal(h.calls.length, 0);
});
test("production overlay → main relay → setup retry reuses a failed first cleanup, retires across new take/end, preserves private raw/audio", async (t) => {
  const { bridgeFixture } = require("./harness/onboardingBridgeFixture");
  const f = bridgeFixture();
  let factoryCount = 0;
  const requests = [];
  const h = main(t, {
    ipcMain: {
      handle: (name, fn) => f.handlers.set(name, fn),
      removeHandler: (name) => f.handlers.delete(name),
    },
    onTextOperationIssued: (sender, descriptor, token) =>
      f.context.onboardingCleanup.bind(sender, descriptor.cleanupIdentity, token),
    authorizeTextOperation: (sender, descriptor) =>
      f.context.onboardingCleanup.authorized(sender, descriptor.cleanupIdentity),
    aiRuntime: () => ({
      isStepCount: () => {},
      generateText: async (options) => {
        requests.push(options);
        if (++factoryCount === 1) throw new Error("fixture transport failure");
        return { text: "Retry succeeded.", finishReason: "stop" };
      },
    }),
  });
  f.context.getPersonalInference = () => h.service;
  const { AudioManager, window } = await loadAudioManager(t, {
    cachePrefix: "loqui-overlay-relay-",
    settingsKey: "__relayCleanup",
    settings: {
      useCleanupModel: true,
      cleanupMode: "providers",
      cleanupProvider: "custom",
      cleanupModel: "model-a",
      cleanupCloudBaseUrl: "https://fixture.invalid/a",
      customPrompts: { cleanup: "prompt-a" },
    },
    mockModules: {
      "/stores/settingsStore": `export const getSettings = () => globalThis.__relayCleanup; export const getEffectiveCleanupModel = () => getSettings().cleanupModel; export const selectResolvedLLMConfig = s => ({ mode: s.cleanupMode, provider: s.cleanupProvider, model: s.cleanupModel }); export const useSettingsStore = { getState: getSettings };`,
    },
  });
  window.electronAPI = f.overlayApi;
  const manager = Object.assign(Object.create(AudioManager.prototype), {
    pendingCleanupFailure: null,
    lastAudioBlob: new Blob(["fixture private audio"]),
    lastAudioBlobPrivate: true,
  });
  const offRetry = f.overlayApi.onOnboardingCleanupRetry(async (request) =>
    f.overlayApi.replyOnboardingCleanup(await manager.retryCapturedCleanup(request))
  );
  const offRetire = f.overlayApi.onOnboardingCleanupRetired((identity) =>
    manager.retireCapturedCleanup(identity)
  );
  t.after(() => {
    offRetry();
    offRetire();
    f.context.onboardingCleanup.dispose();
  });
  await f.setupApi.beginOnboardingDemo({ id: "demo-a", kind: "dictation" });
  await f.setupApi.toggleOnboardingDemo("demo-a", f.manager._onboardingDemoSession?.takeId ?? null);
  const take = f.sent.findLast(([name]) => name === "prepare-dictation")[1].onboardingTake;
  const recording = { private: true };
  manager.admitCleanupOperation(take, recording);
  manager._recordingContext = recording;
  await f.overlayApi.publishOnboardingDemoEvent({
    ...take,
    kind: "dictation",
    status: "listening",
  });
  assert.equal(
    await manager.processTranscriptionCore("fixture raw words", "fixture"),
    "fixture raw words"
  );
  assert.ok(manager.pendingCleanupFailure);
  const identity = recording.cleanupOperation.identity;
  await f.overlayApi.publishOnboardingDemoEvent({
    ...take,
    kind: "dictation",
    status: "success",
    text: "fixture raw words",
    rawText: "fixture raw words",
    cleanup: "failed",
    cleanupOperationId: identity.operationId,
  });
  assert.equal(f.broadcasts.at(-1)[1].cleanupOperationId, identity.operationId);
  const audio = manager.lastAudioBlob;
  const result = await f.setupApi.retryOnboardingCleanup(identity);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ...identity,
    ok: true,
    text: "Retry succeeded.",
  });
  assert.deepEqual(requests[0].messages, requests[1].messages);
  assert.equal(requests[0].instructions, requests[1].instructions);
  assert.equal(manager.lastAudioBlob, audio);
  assert.equal(manager.lastAudioBlobPrivate, true);
  await f.setupApi.toggleOnboardingDemo("demo-a", f.manager._onboardingDemoSession?.takeId ?? null);
  assert.equal(
    (await f.setupApi.retryOnboardingCleanup(identity)).code,
    "CLEANUP_OPERATION_UNAVAILABLE"
  );
  assert.equal(
    manager.lastAudioBlob,
    audio,
    "retiring cleanup must never clear a newer/private audio owner"
  );
  await f.setupApi.endOnboardingDemo("demo-a");
});

test("captured static profile and ADC positives construct SDKs from A once per retained source, with no lazy file/ambient reload", async (t) => {
  const Module = require("node:module");
  const originalLoad = Module._load;
  const sdk = [],
    auth = [];
  Module._load = function (name, ...args) {
    if (name === "@ai-sdk/amazon-bedrock")
      return {
        createAmazonBedrock: (options) => {
          sdk.push(options);
          return (model) => ({ model });
        },
      };
    if (name === "@ai-sdk/google-vertex")
      return {
        createVertex: (options) => {
          sdk.push(options);
          return (model) => ({ model });
        },
      };
    if (name === "google-auth-library")
      return {
        GoogleAuth: class {
          constructor(options) {
            auth.push(options);
          }
          async getAccessToken() {
            return "fixture-access-a";
          }
        },
      };
    if (name === "@aws-sdk/credential-providers")
      assert.fail("retained static profile must not use a lazy chain");
    return originalLoad.call(this, name, ...args);
  };
  t.after(() => {
    Module._load = originalLoad;
  });
  let reads = 0;
  const source = {
    type: "authorized_user",
    client_id: "fixture-id-a",
    client_secret: "fixture-secret-a",
    refresh_token: "fixture-refresh-a",
  };
  const h = main(t, {
    credentials: {
      list: () => ["bedrock", "vertex"].map((id) => ({ id, generation: 1, present: true })),
      captureCommitted: async () => ({ generation: 1, present: true, values: {} }),
    },
    modelFactory: require("../../src/helpers/personalInference").createModel,
    textOperationSnapshot: (request) =>
      request.provider === "bedrock"
        ? {
            bedrockRegion: "us-west-2",
            bedrockProfile: "fixture-a",
            bedrockBaseURL: "https://fixture.invalid/a",
            bedrockCredentialsFile: "/fixture/credentials",
            bedrockConfigFile: "/fixture/config",
          }
        : {
            vertexAuthSource: "adc",
            vertexProject: "project-a",
            vertexLocation: "us-central1",
            vertexAdcFile: "/fixture/adc",
          },
    captureTextFactoryInputs: (request, selected, values) =>
      captureTextFactoryInputs(request, selected, values, {
        readFile: async (path) => {
          assert.equal(path, "/fixture/adc");
          reads++;
          return JSON.stringify(source);
        },
        parseProfiles: async () => {
          reads++;
          return {
            "fixture-a": {
              aws_access_key_id: "fixture-id-a",
              aws_secret_access_key: "fixture-secret-a",
            },
          };
        },
      }),
    aiRuntime: () => ({
      isStepCount() {},
      generateText: async () => ({ text: "Fixture.", finishReason: "stop" }),
    }),
  });
  for (const provider of ["bedrock", "vertex"]) {
    source.refresh_token = "fixture-refresh-a";
    const token = await h.invoke("text-operation-capture", { ...descriptor, provider });
    source.refresh_token = "fixture-refresh-b";
    await h.invoke("text-operation-run", { token, request: input });
    await h.invoke("text-operation-run", { token, request: input });
  }
  assert.equal(reads, 2);
  assert.equal(sdk[0].accessKeyId, "fixture-id-a");
  assert.equal(sdk[1].secretAccessKey, "fixture-secret-a");
  assert.equal(sdk[0].baseURL, "https://fixture.invalid/a");
  assert.equal(auth[0].credentials.refresh_token, "fixture-refresh-a");
  assert.equal(auth[1].credentials.refresh_token, auth[0].credentials.refresh_token);
  assert.equal(sdk[2].project, "project-a");
  assert.equal(
    (await sdk[3].googleAuthOptions.authClient.getAccessToken()).token,
    "fixture-access-a"
  );
});

test("main IPC reports source-specific unsupported paths without a model or transport call", async (t) => {
  const h = main(t, {
    modelFactory: () => assert.fail("unsupported source reached model factory"),
  });
  for (const provider of ["codex", "tinfoil"])
    await assert.rejects(h.invoke("text-operation-capture", { ...descriptor, provider }), {
      code: "UNSUPPORTED_AUTH_SOURCE",
    });
  for (const [provider, selected] of [
    ["bedrock", { bedrockProfile: "" }],
    ["vertex", { vertexAuthSource: "adc", vertexAdcFile: "" }],
  ]) {
    await assert.rejects(captureTextFactoryInputs({ ...descriptor, provider }, selected, {}), {
      code: "UNSUPPORTED_AUTH_SOURCE",
    });
  }
});

test("actual main snapshot fixes environment endpoints and selected source paths before admission", async (t) => {
  const { textOperationSnapshot } = require("../../src/helpers/textOperationCapture");
  const env = {
    OPENAI_BASE_URL: "https://fixture.invalid/a",
    GOOGLE_APPLICATION_CREDENTIALS: "/fixture/adc-a",
    AWS_SHARED_CREDENTIALS_FILE: "/fixture/keys-a",
    AWS_CONFIG_FILE: "/fixture/config-a",
    AWS_ENDPOINT_URL: "https://fixture.invalid/aws-a",
  };
  const environment = {
    getEnterpriseRouteState: () => ({
      version: 1,
      current: { vertexAuthSource: "adc", vertexProject: "project-a", bedrockRegion: "us-west-2" },
    }),
    getBedrockProfile: () => "fixture-a",
  };
  const before = ["openai", "vertex", "bedrock"].map((provider) =>
    textOperationSnapshot(environment, { provider }, env)
  );
  assert.equal(before[1].vertexAdcFile, "/fixture/adc-a");
  assert.equal(before[2].bedrockCredentialsFile, "/fixture/keys-a");
  assert.equal(before[2].bedrockBaseURL, "https://fixture.invalid/aws-a");
  const gate = deferred();
  const h = main(t, {
    textOperationSnapshot: (request) => textOperationSnapshot(environment, request, env),
    waitForAdmission: () => gate.promise,
    credentials: {
      list: () => [{ id: "openai", present: true, generation: 1 }],
      captureCommitted: () => assert.fail("changed endpoint must precede credentials"),
    },
    modelFactory: () => assert.fail("changed endpoint must precede model"),
  });
  const pending = h.invoke("text-operation-capture", { ...descriptor, provider: "openai" });
  const refused = assert.rejects(pending, { code: "RECIPIENT_CHANGED" });
  env.OPENAI_BASE_URL = "https://fixture.invalid/b";
  gate.resolve();
  await refused;
  assert.equal(before[0].sdkBaseURL, "https://fixture.invalid/a");
});

test("overlay retirement settles a pending capture immediately; local admission cannot retarget to remote", async (t) => {
  const gate = deferred();
  const h = main(t, { waitForAdmission: () => gate.promise });
  const { AudioManager, window, setSettings } = await loadAudioManager(t, {
    cachePrefix: "loqui-retired-local-",
    settingsKey: "__retiredLocal",
    settings: {
      useCleanupModel: true,
      cleanupMode: "local",
      cleanupModel: "local-model-a",
      preferredLanguage: "en",
      customPrompts: {},
    },
    mockModules: {
      "/stores/settingsStore": `export const getSettings = () => globalThis.__retiredLocal; export const getEffectiveCleanupModel = () => getSettings().cleanupModel; export const selectResolvedLLMConfig = s => ({mode: s.cleanupMode, provider: s.cleanupProvider, model: s.cleanupModel}); export const useSettingsStore = {getState: getSettings};`,
    },
  });
  const local = [];
  let localText = "Local fixture.";
  window.electronAPI.personalInference = {
    captureTextOperation: (d) => h.invoke("text-operation-capture", d),
    runTextOperation: () => assert.fail("local must not reach remote IPC"),
    retireTextOperation: (token) => h.invoke("text-operation-retire", token),
  };
  window.electronAPI.processLocalReasoning = async (text, model, _agent, config) => ({
    success: true,
    text: await h.service.runCapturedLocal(
      { sender: h.owner },
      config.textOperationToken,
      { messages: [{ role: "user", content: text }], wordCount: config.wordCount },
      async (request, descriptor) => {
        local.push({ request, descriptor });
        return localText;
      }
    ),
  });
  const manager = Object.create(AudioManager.prototype);
  const first = { private: true };
  manager.admitCleanupOperation({ demoId: "demo", takeId: "old" }, first);
  manager._recordingContext = first;
  const pending = manager.processTranscriptionCore("fixture raw", "fixture");
  manager.retireCapturedCleanup();
  assert.equal(await pending, "fixture raw");
  const next = { private: true };
  manager.admitCleanupOperation({ demoId: "demo", takeId: "next" }, next);
  manager._recordingContext = next;
  const current = manager.processTranscriptionCore("fixture next", "fixture");
  setSettings({
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "openai",
    cleanupModel: "remote-b",
  });
  gate.resolve();
  assert.equal(await current, "Local fixture.");
  assert.equal(
    (await manager.retryCapturedCleanup(next.cleanupOperation.identity)).text,
    "Local fixture."
  );
  assert.equal(local.length, 2);
  assert.equal(local[1].descriptor.model, "local-model-a");
  assert.deepEqual(local[1].request, local[0].request);
  localText = "";
  assert.equal(
    (await manager.retryCapturedCleanup(next.cleanupOperation.identity)).code,
    "CLEANUP_FAILED"
  );
  manager.retireCapturedCleanup();
});

test("production processLocalReasoning IPC consumes original token/model/config and rejects cross-owner or remote capability", async (t) => {
  const calls = [];
  const { bridgeFixture } = require("./harness/onboardingBridgeFixture");
  const f = bridgeFixture({
    localReasoning: {
      async processText(text, model, config) {
        config.execution.assertLive();
        calls.push({ text, model, config });
        return "Local fixture.";
      },
    },
  });
  const h = main(t, {
    ipcMain: {
      handle: (name, fn) => f.handlers.set(name, fn),
      removeHandler: (name) => f.handlers.delete(name),
    },
    modelFactory: () => assert.fail("local IPC cannot dispatch to remote model"),
    onTextOperationIssued: (sender, request, token) => {
      if (request.cleanupIdentity)
        f.context.onboardingCleanup.bind(sender, request.cleanupIdentity, token);
    },
    authorizeTextOperation: (sender, request) =>
      request.cleanupIdentity
        ? f.context.onboardingCleanup.authorized(sender, request.cleanupIdentity)
        : sender === f.setupSender,
  });
  f.context.getPersonalInference = () => h.service;
  await f.setupApi.beginOnboardingDemo({ id: "local-demo", kind: "dictation" });
  await f.setupApi.toggleOnboardingDemo(
    "local-demo",
    f.manager._onboardingDemoSession?.takeId ?? null
  );
  const take = f.sent.findLast(([name]) => name === "prepare-dictation")[1].onboardingTake;
  const token = await f.overlayApi.personalInference.captureTextOperation({
    ...descriptor,
    provider: "local",
    model: "local-a",
    cleanupIdentity: { ...take, operationId: "local-operation" },
  });
  const run = (api) =>
    api.processLocalReasoning(input.messages[0].content, "remote-b", "ignored-agent", {
      textOperationToken: token,
      wordCount: input.wordCount,
      provider: "openai",
      systemPrompt: "override-b",
    });
  assert.equal((await run(f.overlayApi)).text, "Local fixture.");
  assert.equal((await run(f.overlayApi)).text, "Local fixture.");
  assert.equal(calls[1].model, "local-a");
  assert.equal(calls[1].config.provider, "local");
  assert.equal(calls[1].config.systemPrompt, descriptor.systemPrompt);
  assert.equal((await run(f.setupApi)).code, "CLEANUP_OPERATION_UNAVAILABLE");
  const remote = await f.setupApi.personalInference.captureTextOperation(descriptor);
  assert.equal(
    (
      await f.setupApi.processLocalReasoning("fixture words", "local-a", null, {
        textOperationToken: remote,
        wordCount: 2,
      })
    ).code,
    "CLEANUP_FAILED"
  );
  await f.overlayApi.personalInference.retireTextOperation(token);
  assert.equal((await run(f.overlayApi)).code, "CLEANUP_OPERATION_UNAVAILABLE");
  assert.equal(calls.length, 2);
  f.context.onboardingCleanup.dispose();
});

test("captured OpenCode first cleanup and retry retain the original SDK session header", async (t) => {
  const Module = require("node:module");
  const originalLoad = Module._load;
  const options = [];
  Module._load = function (name, ...args) {
    if (name === "@ai-sdk/openai")
      return {
        createOpenAI: (config) => {
          options.push(config);
          return { chat: (model) => ({ model }) };
        },
      };
    return originalLoad.call(this, name, ...args);
  };
  t.after(() => {
    Module._load = originalLoad;
  });
  const h = main(t, {
    modelFactory: require("../../src/helpers/personalInference").createModel,
    aiRuntime: () => ({
      isStepCount() {},
      generateText: async () => ({ text: "Fixture.", finishReason: "stop" }),
    }),
  });
  const token = await h.invoke("text-operation-capture", {
    ...descriptor,
    provider: "custom",
    baseUrl: "https://opencode.ai/v1",
  });
  await h.invoke("text-operation-run", { token, request: input });
  await h.invoke("text-operation-run", { token, request: input });
  assert.ok(options[0].headers["x-opencode-session"]);
  assert.equal(options[0].headers["x-opencode-session"], options[1].headers["x-opencode-session"]);
});

for (const expected of [
  { expectedEnterprise: { azureEndpoint: "https://fixture.invalid/b" } },
  { expectedAuthority: { credentialGeneration: 0 } },
  { expectedAuthority: { enterpriseVersion: 2 } },
]) {
  test(`setup admission rejects a stale disclosed ${Object.keys(expected)[0]} before capturing B`, async (t) => {
    const h = main(t);
    await assert.rejects(h.invoke("text-operation-capture", { ...descriptor, ...expected }), {
      code: "RECIPIENT_CHANGED",
    });
    assert.equal(h.calls.length, 0);
  });
}

async function setupRunner(t, h) {
  const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
  const { window } = installBrowserGlobals(t);
  window.electronAPI.personalInference = {
    captureTextOperation: (value) => h.invoke("text-operation-capture", value),
    runTextOperation: (value) => h.invoke("text-operation-run", value),
    retireTextOperation: (value) => h.invoke("text-operation-retire", value),
  };
  window.electronAPI.processLocalReasoning = async (text, _model, _agent, options) => ({
    success: true,
    text: await h.service.runCapturedLocal(
      { sender: h.owner },
      options.textOperationToken,
      { messages: [{ role: "user", content: text }], wordCount: options.wordCount },
      async (_input, selected) => {
        h.calls.push(["local", selected.model]);
        return "Local setup fixture.";
      }
    ),
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-setup-cleanup-",
    mockModules: {
      "/stores/settingsStore": `export const getSettings = () => ({}); export const useSettingsStore = {getState: getSettings}; export const selectResolvedLLMConfig = () => ({}); export const enterpriseRouteVersion = () => 1;`,
      "/stores/routeFactsStore": `export const useRouteFactsStore = {getState: () => ({facts:{credentialGenerations:new Map()}})};`,
    },
  });
  const runner = await vite.ssrLoadModule("/components/onboarding/cleanupRunner.ts");
  const factory = await vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
  return { runner, factory, api: window.electronAPI };
}
const setupText = "um remind me to book the room";
for (const [name, a, b, changed] of [
  [
    "provider",
    { provider: "custom", baseUrl: "https://fixture.invalid/a" },
    { provider: "azure" },
    {},
  ],
  ["device to remote", { provider: "local", model: "local-a" }, { provider: "azure" }, {}],
  [
    "same-host path",
    { provider: "azure", expectedEnterprise: { azureEndpoint: "https://fixture.invalid/a" } },
    { provider: "azure", expectedEnterprise: { azureEndpoint: "https://fixture.invalid/b" } },
    { azureEndpoint: "https://fixture.invalid/b" },
  ],
  [
    "auth source",
    { provider: "vertex", expectedEnterprise: { vertexAuthSource: "apiKey" } },
    { provider: "vertex", expectedEnterprise: { vertexAuthSource: "adc" } },
    { vertexAuthSource: "adc" },
  ],
  [
    "project",
    { provider: "vertex", expectedEnterprise: { vertexProject: "project-a" } },
    { provider: "vertex", expectedEnterprise: { vertexProject: "project-b" } },
    { vertexProject: "project-b" },
  ],
]) {
  test(`setup deferred import ${name}: old consent cannot reach B; fresh B really executes main/factory`, async (t) => {
    const gate = deferred();
    const h = main(t, {
      captureTextFactoryInputs: (request, selected, values) =>
        captureTextFactoryInputs(request, { ...selected, vertexAdcFile: "/fixture/adc" }, values, {
          readFile: async () =>
            JSON.stringify({
              type: "authorized_user",
              client_id: "fixture",
              client_secret: "fixture",
              refresh_token: "fixture",
            }),
        }),
    });
    const { runner, factory } = await setupRunner(t, h);
    let current = true;
    const operation = runner.createSetupCleanupOperation(
      setupText,
      { ...descriptor, ...a },
      () => current,
      async () => {
        await gate.promise;
        return factory;
      }
    );
    const refused = assert.rejects(operation.result, { code: "RECIPIENT_CHANGED" });
    current = false;
    h.change(changed);
    gate.resolve();
    await refused;
    assert.equal(h.calls.length, 0);
    const fresh = runner.createSetupCleanupOperation(
      setupText,
      { ...descriptor, ...b },
      () => true,
      async () => factory
    );
    assert.equal(await fresh.result, "Cleaned fixture.");
    assert.equal(h.calls.length, 1, "only the newly consented B constructed a model");
    assert.equal(h.calls[0][0], b.provider);
  });
}

for (const stage of ["admission", "factory"]) {
  test(`setup ${stage} wait refuses changed main path; fresh named B admission executes`, async (t) => {
    const gate = deferred();
    const entered = deferred();
    let waiting = true;
    const dispatches = [];
    const h = main(t, {
      waitForAdmission: async () => {
        if (stage === "admission" && waiting) {
          entered.resolve();
          await gate.promise;
        }
      },
      modelFactory: async (provider, model, _key, baseUrl, _thinking, enterprise) => {
        if (stage === "factory" && waiting) {
          entered.resolve();
          await gate.promise;
        }
        return {
          specificationVersion: "v3",
          provider: "fixture",
          modelId: model,
          supportedUrls: {},
          doGenerate: async () => {
            dispatches.push([provider, baseUrl, enterprise.azureEndpoint]);
            return {
              content: [{ type: "text", text: "Captured setup output." }],
              finishReason: { unified: "stop", raw: "stop" },
              usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
              warnings: [],
            };
          },
        };
      },
    });
    const { runner, factory } = await setupRunner(t, h);
    const operation = runner.createSetupCleanupOperation(
      setupText,
      { ...descriptor, expectedEnterprise: { azureEndpoint: "https://fixture.invalid/a" } },
      () => true,
      async () => factory
    );
    const refused = assert.rejects(operation.result, { code: "RECIPIENT_CHANGED" });
    await entered.promise;
    h.change({ azureEndpoint: "https://fixture.invalid/b" });
    waiting = false;
    gate.resolve();
    await refused;
    assert.deepEqual(dispatches, []);
    const fresh = runner.createSetupCleanupOperation(
      setupText,
      { ...descriptor, expectedEnterprise: { azureEndpoint: "https://fixture.invalid/b" } },
      () => true,
      async () => factory
    );
    assert.equal(await fresh.result, "Captured setup output.");
    assert.deepEqual(dispatches, [["azure", undefined, "https://fixture.invalid/b"]]);
  });
}

test("setup snapshot captures A text and all options before deferred import; valid A executes and retirement keeps B alive", async (t) => {
  const h = main(t);
  const { runner, factory } = await setupRunner(t, h);
  const gate = deferred();
  const selected = {
    ...descriptor,
    systemPrompt: "prompt-a",
    disableThinking: true,
    expectedEnterprise: { azureEndpoint: "https://fixture.invalid/a" },
  };
  const a = runner.createSetupCleanupOperation(
    setupText,
    selected,
    () => true,
    async () => {
      await gate.promise;
      return factory;
    }
  );
  selected.systemPrompt = "prompt-b";
  selected.expectedEnterprise.azureEndpoint = "https://fixture.invalid/b";
  gate.resolve();
  assert.equal(await a.result, "Cleaned fixture.");
  assert.equal(h.calls[0][5].azureEndpoint, "https://fixture.invalid/a");
  const b = runner.createSetupCleanupOperation(
    setupText,
    descriptor,
    () => true,
    async () => factory
  );
  a.retire();
  assert.equal(await b.result, "Cleaned fixture.");
  assert.equal(h.calls.length, 2);
});

for (const boundary of ["absent", "undefined", "rejected"]) {
  test(`setup capture IPC ${boundary} refuses safely without factory/transport`, async (t) => {
    const h = main(t);
    const { runner, factory, api } = await setupRunner(t, h);
    if (boundary === "absent") delete api.personalInference.captureTextOperation;
    if (boundary === "undefined")
      api.personalInference.captureTextOperation = async () => undefined;
    if (boundary === "rejected")
      api.personalInference.captureTextOperation = async () => {
        throw new Error("unsupported");
      };
    const operation = runner.createSetupCleanupOperation(
      setupText,
      descriptor,
      () => true,
      async () => factory
    );
    await assert.rejects(operation.result, (e) =>
      ["CLEANUP_OPERATION_UNAVAILABLE", "CLEANUP_FAILED"].includes(e.code)
    );
    assert.equal(h.calls.length, 0);
  });
}

test("new setup local capture executes its actual main local path with A model, never remote inference", async (t) => {
  const h = main(t);
  const { runner, factory } = await setupRunner(t, h);
  const op = runner.createSetupCleanupOperation(
    setupText,
    { ...descriptor, provider: "local", model: "local-a" },
    () => true,
    async () => factory
  );
  assert.equal(await op.result, "Local setup fixture.");
  assert.deepEqual(h.calls, [["local", "local-a"]]);
});

test("setup current-context check after capture admission prevents any text dispatch even when main recipient is unchanged", async (t) => {
  const gate = deferred(),
    entered = deferred();
  const h = main(t, {
    waitForAdmission: async () => {
      entered.resolve();
      await gate.promise;
    },
  });
  const { runner, factory } = await setupRunner(t, h);
  let current = true;
  const op = runner.createSetupCleanupOperation(
    setupText,
    descriptor,
    () => current,
    async () => factory
  );
  const refused = assert.rejects(op.result, { code: "RECIPIENT_CHANGED" });
  await entered.promise;
  current = false;
  gate.resolve();
  await refused;
  assert.equal(h.calls.length, 0, "a stale admission cannot dispatch even to retained A");
});

test("matching disclosed main configuration version and credential generation positively admit setup cleanup", async (t) => {
  const h = main(t);
  h.change({ version: 7 });
  const token = await h.invoke("text-operation-capture", {
    ...descriptor,
    expectedEnterprise: { azureEndpoint: "https://fixture.invalid/a" },
    expectedAuthority: { enterpriseVersion: 7, credentialGeneration: 1 },
  });
  assert.deepEqual(await h.invoke("text-operation-run", { token, request: input }), {
    text: "Cleaned fixture.",
  });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][5].version, 7);
});
