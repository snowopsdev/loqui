const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { deferred } = require("./harness/deferred");
const { realCredentialEnv } = require("./harness/realCredentialEnv");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-keyring-production-"));
const originalLoad = Module._load;
const handlers = new Map();
const netUrls = []; // Electron net.fetch: Corti's token endpoint
const fetchUrls = []; // global fetch: providerConnectionTest
let netImpl = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: "tok", expires_in: 300 }),
});
const electronStub = {
  app: {
    getPath: () => userData,
    getName: () => "test",
    getVersion: () => "0.0.0",
    getLocale: () => "en",
    isPackaged: false,
    on: () => {},
    requestSingleInstanceLock: () => true,
  },
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  net: {
    fetch: async (url, init) => {
      netUrls.push(String(url));
      return netImpl(url, init);
    },
  },
  BrowserWindow: class BrowserWindow {
    static getAllWindows() {
      return [];
    }
    static fromWebContents() {
      return null;
    }
  },
  Notification: class Notification {
    static isSupported() {
      return false;
    }
  },
  shell: {},
  dialog: {},
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  session: { fromPartition: () => ({}) },
  clipboard: {},
  nativeImage: {},
  globalShortcut: {},
  utilityProcess: {},
  MessageChannelMain: class {},
};
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (parent?.filename === handlersModulePath && request === "./debugLogger") {
    return new Proxy({}, { get: () => () => {} });
  }
  if (parent?.filename === handlersModulePath && request === "./systemDefaultMicrophone") {
    return { resolveSystemDefaultMicrophone: () => {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function anything() {
  return new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === Symbol.toPrimitive || property === "toString") return () => "";
      if (property === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

let sealed = false;
let ipc;
const enterpriseCalls = [];
let enterpriseImpl = async () => ({});
let real;
let restoreEnvironment = () => {};
const rows = new Map();
const originalFetch = globalThis.fetch;

test.before(() => {
  real = realCredentialEnv(
    // Keep the fixture alive through the test bodies. A test.after registered
    // inside test.before can attach to that hook and run before the suite.
    {
      after: (fn) => {
        restoreEnvironment = fn;
      },
    },
    {
      GROQ_API_KEY: "gsk-prod-SECRET",
      CORTI_CLIENT_ID: "cid-prod",
      CORTI_CLIENT_SECRET: "csec-prod",
      VERTEX_AUTH_SOURCE: "adc",
      VERTEX_PROJECT: "fixture-project",
      VERTEX_LOCATION: "us-central1",
    }
  );
  globalThis.fetch = async (url) => {
    fetchUrls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  for (const name of ["_setupTextEditMonitor", "_setupRetentionCleanup", "_logDetectedGpus"]) {
    Ctor.prototype[name] = () => {};
  }
  const managers = {
    environmentManager: real.env,
    databaseManager: {
      getKeyHealth: () => [...rows.values()],
      saveKeyHealth: (row) => rows.set(row.identity, { ...row }),
      deleteKeyHealth: (identity) => rows.delete(identity),
    },
    isSealed: () => sealed,
    runEnterpriseVerification: async (input) => {
      enterpriseCalls.push(input);
      return enterpriseImpl(input);
    },
  };
  ipc = new Ctor(new Proxy(managers, { get: (t, p) => (p in t ? t[p] : anything()) }));
});

test.after(() => {
  try {
    ipc?._stopKeyReminders?.();
    ipc?.keyring?.dispose();
  } finally {
    restoreEnvironment();
    globalThis.fetch = originalFetch;
    Module._load = originalLoad;
    delete require.cache[handlersModulePath];
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

const sender = new EventEmitter();
sender.isDestroyed = () => false;
const event = { sender };
const rawDescribe = (identity, options, owner = event) =>
  handlers.get("keyring-describe-verify")(owner, identity, options);
const describe = async (identity, options) => {
  const { recipientToken: _recipientToken, ...description } = await rawDescribe(identity, options);
  return description;
};
const rawVerify = (identity, options) => handlers.get("keyring-verify")(event, identity, options);
const verify = async (identity, options = {}) => {
  const { recipientToken } = await rawDescribe(identity, options);
  return rawVerify(identity, { ...options, recipientToken });
};
const connection = (provider, model, recipientToken, extra = {}, owner = event) =>
  handlers.get("keyring-verify-connection")(owner, { provider, model, recipientToken, ...extra });
const patch = async (values) => {
  const { current } = real.env.getEnterpriseRouteState();
  return real.env.saveEnterpriseRoutePatch(values, { expected: current });
};
const hostOf = (url) => new URL(url).host;

// change-driving (R2-7): production construction left isSealed at its default.
test("the constructed IPCHandlers passes managers.isSealed to the keyring", async () => {
  sealed = true;
  const refused = await verify("groq");
  assert.equal(refused.outcome, "sealed");
  assert.deepEqual(fetchUrls, [], "nothing is sent while sealed");
  sealed = false;
  const recorded = await verify("groq");
  assert.equal(recorded.outcome, "recorded");
  assert.equal(recorded.entry.status, "verified");
});

// change-driving (R2-7): a sealed refusal thrown by the gated transport was
// caught as "network" and recorded the credential unreachable.
test("a sealed refusal thrown by Corti's token request is outcome sealed, health unchanged", async () => {
  const ok = await verify("corti:speech", { cortiEnvironment: "eu", cortiTenant: "sealedA" });
  assert.equal(ok.outcome, "recorded");
  const before = { ...rows.get("corti:speech") };
  netImpl = async () => {
    throw Object.assign(new Error("[SEALED_MODE] Sealed mode is on"), { code: "SEALED_MODE" });
  };
  try {
    const refused = await verify("corti:speech", {
      cortiEnvironment: "eu",
      cortiTenant: "sealedB",
    });
    assert.equal(refused.outcome, "sealed");
    assert.deepEqual(rows.get("corti:speech"), before, "no row write");
  } finally {
    netImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "tok", expires_in: 300 }),
    });
  }
});

// change-driving (R2-7): the predicate is read after the save wait.
test("sealing while a key save is still being written refuses the Verify queued behind it", async () => {
  real.fs.holdNext((op, file) => op === "rename" && file === "GROQ_API_KEY.enc");
  const saving = ipc.credentials.save("groq", "key", "gsk-prod-next-SECRET");
  const hold = await real.fs.nextHold();
  const sent = fetchUrls.length;
  const verifying = verify("groq");
  sealed = true;
  hold.release();
  await saving;
  try {
    assert.equal((await verifying).outcome, "sealed");
    assert.equal(fetchUrls.length, sent);
  } finally {
    sealed = false;
  }
});

// change-driving (R2-6): the disclosed host is the host the request reached,
// including after the region changes.
test("describeVerify names the host the request is sent to, before and after a region change", async () => {
  for (const [cortiEnvironment, cortiTenant] of [
    ["eu", "regionA"],
    ["us", "regionA"],
  ]) {
    const options = { cortiEnvironment, cortiTenant };
    const disclosed = await describe("corti:speech", options);
    assert.deepEqual(disclosed.fields, ["clientId", "clientSecret"]);
    const sent = netUrls.length;
    assert.equal((await verify("corti:speech", options)).outcome, "recorded");
    assert.equal(netUrls.length, sent + 1);
    assert.deepEqual(disclosed.hosts, [hostOf(netUrls.at(-1))]);
    assert.equal(disclosed.hosts[0], `auth.${cortiEnvironment}.corti.app`);
  }
  const groq = await describe("groq");
  const sent = fetchUrls.length;
  assert.equal((await verify("groq")).outcome, "recorded");
  assert.deepEqual(groq.hosts, [hostOf(fetchUrls[sent])]);
});

// change-driving B4: reads never adopt another caller's options as authority.
test("same-host Corti tenants have separate current health and late A cannot overwrite B", async () => {
  const a = { cortiEnvironment: "eu", cortiTenant: "tenantA" };
  const b = { cortiEnvironment: "eu", cortiTenant: "tenantB" };
  const gate = deferred();
  let calls = 0;
  netImpl = async () => {
    calls++;
    if (calls === 1) return gate.promise;
    return { ok: true, json: async () => ({ access_token: "fixture", expires_in: 300 }) };
  };
  const pendingA = verify("corti:speech", a);
  await new Promise(setImmediate);
  const pendingB = verify("corti:speech", b);
  const duplicateB = verify("corti:speech", b);
  const resultB = await pendingB;
  assert.deepEqual(await duplicateB, resultB);
  assert.equal(calls, 2, "same host, different complete paths do not coalesce");
  assert.equal(resultB.outcome, "recorded");
  gate.resolve({ ok: false, status: 401, text: async () => "fixture failure" });
  assert.equal((await pendingA).outcome, "superseded");
  const list = handlers.get("keyring-list");
  assert.equal(list(event, b).find((row) => row.id === "corti:speech").status, "verified");
  assert.equal(list(event, a).find((row) => row.id === "corti:speech").status, "unverified");
  const metadata = handlers.get("keyring-route-health")(event, b);
  const current = metadata.current.find((row) => row.identity === "corti:speech");
  assert.ok(current.configFingerprint.length > 0);
  assert.equal(
    metadata.health.find((row) => row.identity === "corti:speech").configFingerprint,
    current.configFingerprint
  );
  assert.equal(
    metadata.current.some((row) => row.identity.startsWith("custom:")),
    false
  );
  netImpl = async () => ({
    ok: true,
    json: async () => ({ access_token: "fixture", expires_in: 300 }),
  });
});

// change-driving B4: A rejection is historical at B, even without another Verify.
test("sequential Corti A rejection never projects into untested B or malformed options", async () => {
  const a = { cortiEnvironment: "us", cortiTenant: "rejectedA" };
  const b = { cortiEnvironment: "us", cortiTenant: "untestedB" };
  netImpl = async () => ({ ok: false, status: 401, text: async () => "fixture" });
  assert.equal((await verify("corti:speech", a)).entry.status, "rejected");
  assert.equal(
    handlers
      .get("keyring-list")(event, b)
      .find((r) => r.id === "corti:speech").status,
    "unverified"
  );
  const metadata = handlers.get("keyring-route-health")(event, b);
  const current = metadata.current.find((r) => r.identity === "corti:speech");
  const history = metadata.health.find((r) => r.identity === "corti:speech");
  assert.notEqual(current.configFingerprint, history.configFingerprint);
  for (const invalid of [
    { cortiEnvironment: "EU" },
    { cortiEnvironment: " us " },
    { cortiTenant: "bad/path" },
  ]) {
    assert.equal(handlers.get("keyring-route-health")(event, invalid).options, null);
    assert.equal((await verify("corti:speech", invalid)).outcome, "invalidOptions");
  }
  assert.deepEqual(
    handlers.get("keyring-route-health")(event, { cortiTenant: "  base  " }).options,
    { cortiEnvironment: "us", cortiTenant: "base" }
  );
  netImpl = async () => ({
    ok: true,
    json: async () => ({ access_token: "fixture", expires_in: 300 }),
  });
});

// change-driving B1: exact main configuration and sender bind explicit Test.
test("enterprise Test refuses missing/stale/model/owner tokens and uses a bounded server probe", async () => {
  await patch({
    azureEndpoint: "https://azure-a.example/openai",
    vertexAuthSource: "adc",
    vertexProject: "project-a",
    vertexLocation: "global",
  });
  await ipc.credentials.save("azure", "key", "fixture-azure-secret");
  const target = await rawDescribe("azure", { model: "deployment-a" });
  const count = enterpriseCalls.length;
  assert.equal(
    (await connection("azure", "deployment-a", undefined)).errorCode,
    "recipientChanged"
  );
  assert.equal(
    (await connection("azure", "deployment-b", target.recipientToken)).errorCode,
    "recipientChanged"
  );
  const other = new EventEmitter();
  other.isDestroyed = () => false;
  assert.equal(
    (await connection("azure", "deployment-a", target.recipientToken, {}, { sender: other }))
      .errorCode,
    "recipientChanged"
  );
  assert.equal(enterpriseCalls.length, count);
  assert.deepEqual(
    await connection("azure", "deployment-a", target.recipientToken, {
      baseUrl: "https://evil.example",
      enterprise: { azureEndpoint: "https://evil.example" },
      messages: [{ role: "user", content: "UNTRUSTED" }],
      maxTokens: 999999,
    }),
    { success: true }
  );
  const sent = enterpriseCalls.at(-1);
  assert.equal(sent.enterprise.azureEndpoint, "https://azure-a.example/openai");
  assert.equal(sent.model, "deployment-a");
  assert.equal(sent.apiKey, "fixture-azure-secret");
  assert.ok(sent.maxOutputTokens <= 32);
  assert.equal(JSON.stringify(sent.messages).includes("UNTRUSTED"), false);
  assert.equal(JSON.stringify(target).includes("fixture-azure-secret"), false);
  enterpriseImpl = async () => {
    throw Object.assign(new Error("secret provider payload fixture-azure-secret"), {
      statusCode: 401,
    });
  };
  assert.deepEqual(await connection("azure", "deployment-a", target.recipientToken), {
    success: false,
    errorCode: "credentialsRejected",
    status: 401,
  });
  enterpriseImpl = async () => ({});
});

// change-driving B1: config races after a real credential persistence wait.
test("endpoint, source, project and legacy env replacement during committed wait refuse before dispatch", async () => {
  const scenarios = [
    [
      "azure",
      { azureEndpoint: "https://wait-a.example/openai" },
      () => patch({ azureEndpoint: "https://wait-b.example/openai" }),
    ],
    [
      "vertex",
      { vertexAuthSource: "adc", vertexLocation: "global", vertexProject: "wait-a" },
      () => patch({ vertexAuthSource: "apiKey" }),
    ],
    [
      "vertex",
      { vertexAuthSource: "adc", vertexLocation: "global", vertexProject: "wait-a" },
      () => patch({ vertexProject: "wait-b" }),
    ],
    [
      "vertex",
      { vertexAuthSource: "apiKey" },
      async () => {
        process.env.GOOGLE_VERTEX_API_KEY = "fixture-legacy-B";
      },
    ],
  ];
  for (const [provider, initial, change] of scenarios) {
    await patch(initial);
    if (provider === "vertex") {
      await ipc.credentials.save("vertex", "key", "");
      process.env.GOOGLE_VERTEX_API_KEY = "fixture-legacy-A";
    }
    const target = await rawDescribe(provider, { model: "fixture-model" });
    const variable = provider === "azure" ? "AZURE_OPENAI_API_KEY.enc" : "VERTEX_API_KEY.enc";
    real.fs.holdNext((op, file) => op === "rename" && file === variable);
    const saving = ipc.credentials.save(provider, "key", "fixture-attempt");
    const hold = await real.fs.nextHold();
    const count = enterpriseCalls.length;
    const capturedGate = deferred();
    const capture = ipc.credentials.captureCommitted;
    ipc.credentials.captureCommitted = async (id) => {
      const value = await capture(id);
      await capturedGate.promise;
      return value;
    };
    const testing = connection(provider, "fixture-model", target.recipientToken);
    hold.fail(Object.assign(new Error("fixture EIO"), { code: "EIO" }));
    await saving;
    await change();
    capturedGate.resolve();
    assert.equal((await testing).errorCode, "recipientChanged", provider);
    ipc.credentials.captureCommitted = capture;
    assert.equal(enterpriseCalls.length, count, "no dispatch");
  }
});

// change-driving: fixed provider display cannot redirect across the same wait.
test("fixed-provider Verify rejects changed override while waiting and freezes accepted endpoints", async () => {
  process.env.LOQUI_OPENAI_BASE_URL = "https://openai-a.example/v1";
  await ipc.credentials.save("openai", "key", "fixture-openai");
  const target = await rawDescribe("openai");
  real.fs.holdNext((op, file) => op === "rename" && file === "OPENAI_API_KEY.enc");
  const saving = ipc.credentials.save("openai", "key", "fixture-attempt");
  const hold = await real.fs.nextHold();
  const count = fetchUrls.length;
  const checking = rawVerify("openai", { recipientToken: target.recipientToken });
  process.env.LOQUI_OPENAI_BASE_URL = "https://openai-b.example/v1";
  hold.fail(Object.assign(new Error("fixture EIO"), { code: "EIO" }));
  await saving;
  assert.equal((await checking).outcome, "recipientChanged");
  assert.equal(fetchUrls.length, count);
  assert.equal((await rawVerify("openai", {})).outcome, "recipientChanged");
  assert.equal((await verify("openai")).outcome, "recorded");
  assert.equal(new URL(fetchUrls.at(-1)).host, "openai-b.example");
});

// change-driving B1: true ADC source category cannot authorize a new file path.
test("ADC source-file replacement during committed credential wait refuses dispatch", async () => {
  await patch({
    vertexAuthSource: "adc",
    vertexProject: "fixture-project",
    vertexLocation: "global",
  });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fixture/adc-a.json";
  const target = await rawDescribe("vertex", { model: "fixture-model" });
  const original = ipc.credentials.captureCommitted;
  const gate = deferred();
  ipc.credentials.captureCommitted = async (id) => {
    const result = await original(id);
    await gate.promise;
    return result;
  };
  const count = enterpriseCalls.length;
  const checking = connection("vertex", "fixture-model", target.recipientToken);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fixture/adc-b.json";
  gate.resolve();
  assert.equal((await checking).errorCode, "recipientChanged");
  assert.equal(enterpriseCalls.length, count);
  ipc.credentials.captureCommitted = original;
});

// baseline guard added after implementation: registered handler -> real factory
// -> real SDK request with injected transport, never ADC/profile/network lookup.
test("registered enterprise Test and actual SDK agree on captured hosts after late env changes", async (t) => {
  const originalExecutor = ipc._enterpriseVerificationExecutor;
  const loader = Module._load;
  const fetcher = globalThis.fetch;
  const requested = [];
  ipc._enterpriseVerificationExecutor = null;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === handlersModulePath && request === "ai")
      return {
        generateText: async ({ model, maxOutputTokens }) => {
          assert.equal(maxOutputTokens, 16);
          // No endpoint/auth fallback may be consulted at actual SDK execution.
          process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = "https://late-unreviewed.example";
          process.env.AWS_BEARER_TOKEN_BEDROCK = "fixture-unreviewed-bearer";
          process.env.GOOGLE_VERTEX_API_KEY = "fixture-late-key";
          return model.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          });
        },
      };
    return loader.call(this, request, parent, isMain);
  };
  globalThis.fetch = async (url, init) => {
    requested.push({ host: new URL(String(url)).host, headers: new Headers(init?.headers) });
    return new Response('{"error":{"message":"fixture provider payload"}}', {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    ipc._enterpriseVerificationExecutor = originalExecutor;
    Module._load = loader;
    globalThis.fetch = fetcher;
  });
  await ipc.credentials.save("bedrock", "accessKeyId", "AKIAFIXTURE");
  await ipc.credentials.save("bedrock", "secretAccessKey", "fixture-secret");
  await ipc.credentials.save("vertex", "key", "fixture-captured-key");
  await patch({
    bedrockRegion: "eu-west-1",
    azureEndpoint: "https://sdk-azure.example/openai",
    vertexAuthSource: "apiKey",
  });
  for (const [provider, override, expected] of [
    ["bedrock", undefined, "bedrock-runtime.eu-west-1.amazonaws.com"],
    ["bedrock", "https://sdk-bedrock.example/tenant-a", "sdk-bedrock.example"],
    ["azure", undefined, "sdk-azure.example"],
    ["vertex", undefined, "aiplatform.googleapis.com"],
  ]) {
    delete process.env.AWS_ENDPOINT_URL;
    delete process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME;
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    if (override) process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = override;
    const description = await rawDescribe(provider, { model: "fixture-model" });
    const result = await connection(provider, "fixture-model", description.recipientToken);
    assert.deepEqual(result, { success: false, errorCode: "credentialsRejected", status: 401 });
    assert.deepEqual(description.hosts, [expected]);
    assert.equal(requested.at(-1).host, expected);
    if (provider === "bedrock")
      assert.match(requested.at(-1).headers.get("authorization"), /^AWS4-HMAC-SHA256 /);
    if (provider === "vertex")
      assert.equal(requested.at(-1).headers.get("x-goog-api-key"), "fixture-captured-key");
  }
});

// baseline guard: local reads and unknown/fenced authority never clear a key.
test("route health excludes absent and unknown credentials, and fenced Verify is not missing", async () => {
  const originalList = ipc.credentials.list;
  const before = rows.get("groq");
  ipc.credentials.list = () =>
    originalList().map((row) => (row.id === "groq" ? { ...row, unknown: true } : row));
  assert.equal(
    handlers
      .get("keyring-list")(event)
      .find((row) => row.id === "groq").unknown,
    true
  );
  assert.equal(
    handlers
      .get("keyring-route-health")(event)
      .current.some((row) => row.identity === "groq"),
    false
  );
  assert.equal((await rawVerify("groq", {})).outcome, "recipientChanged");
  assert.equal(rows.get("groq"), before);
  ipc.credentials.list = originalList;
  const gate = deferred();
  const resetting = ipc.credentials.reset(() => gate.promise);
  assert.equal(handlers.get("keyring-route-health")(event).current.length, 0);
  assert.equal((await rawVerify("groq", {})).outcome, "recipientChanged");
  gate.resolve();
  await resetting;
});

// baseline guard: validate again after the real factory's asynchronous parse;
// neither a refused dynamic source nor an old profile may reach provider SDK I/O.
test("registered Test refuses dynamic profiles and profile changes during frozen capture", async (t) => {
  const loader = Module._load;
  const executor = ipc._enterpriseVerificationExecutor;
  const modelModule = require.resolve("../../src/helpers/enterpriseAiProviders");
  let profile = {
    credential_source: "Environment",
    aws_access_key_id: "AKIAFIXTURE",
    aws_secret_access_key: "fixture-secret",
  };
  let parsingGate = null;
  let parsed = 0;
  let dispatched = 0;
  ipc._enterpriseVerificationExecutor = null;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === modelModule && request === "@smithy/core/config")
      return {
        parseKnownFiles: async () => {
          parsed++;
          if (parsingGate) await parsingGate.promise;
          return { accepted: profile };
        },
      };
    if (parent?.filename === handlersModulePath && request === "ai")
      return {
        generateText: async () => {
          dispatched++;
          return {};
        },
      };
    if (parent?.filename === modelModule && request === "@aws-sdk/credential-providers")
      throw new Error("fixture forbids any credential chain");
    return loader.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = loader;
    ipc._enterpriseVerificationExecutor = executor;
  });
  await real.env.saveBedrockProfile("accepted");
  let target = await rawDescribe("bedrock", { model: "fixture-model" });
  assert.deepEqual(await connection("bedrock", "fixture-model", target.recipientToken), {
    success: false,
    errorCode: "unsupportedAuthSource",
  });
  assert.equal(dispatched, 0);
  profile = { aws_access_key_id: "AKIAFIXTURE", aws_secret_access_key: "fixture-secret" };
  parsingGate = deferred();
  target = await rawDescribe("bedrock", { model: "fixture-model" });
  const testing = connection("bedrock", "fixture-model", target.recipientToken);
  await new Promise(setImmediate);
  assert.equal(parsed, 2, "one parse per explicit attempt");
  await real.env.saveBedrockProfile("new-owner");
  parsingGate.resolve();
  assert.deepEqual(await testing, { success: false, errorCode: "recipientChanged" });
  assert.equal(dispatched, 0);
  await real.env.saveBedrockProfile("");
});

// baseline guard: after asynchronous injected ADC token resolution, the real
// handler/factory recheck source-path authority before the Vertex SDK request.
test("registered ADC Test checks source again after token resolution and returns no token", async (t) => {
  const loader = Module._load;
  const executor = ipc._enterpriseVerificationExecutor;
  const modelModule = require.resolve("../../src/helpers/enterpriseAiProviders");
  const gate = deferred();
  let resolving = false;
  let dispatched = 0;
  ipc._enterpriseVerificationExecutor = null;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === modelModule && request === "node:fs/promises")
      return {
        readFile: async (file) => {
          assert.equal(file, "/fixture/adc-authorized.json");
          return JSON.stringify({
            type: "authorized_user",
            client_id: "fixture-client",
            client_secret: "fixture-secret",
            refresh_token: "fixture-refresh",
          });
        },
      };
    if (parent?.filename === modelModule && request === "google-auth-library")
      return {
        GoogleAuth: class {
          async getAccessToken() {
            resolving = true;
            await gate.promise;
            return "fixture-private-token";
          }
        },
      };
    if (parent?.filename === handlersModulePath && request === "ai")
      return {
        generateText: async () => {
          dispatched++;
          return {};
        },
      };
    return loader.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = loader;
    ipc._enterpriseVerificationExecutor = executor;
  });
  await patch({
    vertexAuthSource: "adc",
    vertexProject: "fixture-project",
    vertexLocation: "global",
  });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fixture/adc-authorized.json";
  const target = await rawDescribe("vertex", { model: "fixture-model" });
  const checking = connection("vertex", "fixture-model", target.recipientToken);
  await new Promise(setImmediate);
  assert.equal(resolving, true);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fixture/adc-unreviewed.json";
  gate.resolve();
  assert.deepEqual(await checking, { success: false, errorCode: "recipientChanged" });
  assert.equal(dispatched, 0);
  assert.equal(JSON.stringify(target).includes("/fixture/"), false);
});

// change-driving: explicitly reviewed targets cannot follow an HTTP redirect.
test("captured Corti and fixed-provider probes refuse redirects", async (t) => {
  const originalNet = netImpl;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    netImpl = originalNet;
    globalThis.fetch = originalFetch;
  });
  netImpl = async (_url, init) => {
    assert.equal(init.redirect, "error");
    return { ok: true, json: async () => ({ access_token: "fixture", expires_in: 300 }) };
  };
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.redirect, "error");
    return new Response('{"data":[]}', { status: 200 });
  };
  assert.equal(
    (await verify("corti:speech", { cortiTenant: "redirect-policy" })).entry.status,
    "verified"
  );
  assert.equal((await verify("groq")).entry.status, "verified");
});

// baseline guard after redirect RED: native fetch against local fixture servers
// proves a 307 cannot send even another request to the redirected recipient.
test("registered Verify refuses a loopback fixture redirect without contacting its target", async (t) => {
  const http = require("node:http");
  const savedFetch = globalThis.fetch;
  const savedBase = process.env.LOQUI_OPENAI_BASE_URL;
  let firstRequests = 0;
  let redirectedRequests = 0;
  const target = http.createServer((_request, response) => {
    redirectedRequests++;
    response.end('{"data":[]}');
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const initial = http.createServer((_request, response) => {
    firstRequests++;
    response.writeHead(307, { Location: `http://127.0.0.1:${target.address().port}/models` });
    response.end();
  });
  await new Promise((resolve) => initial.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    globalThis.fetch = savedFetch;
    if (savedBase === undefined) delete process.env.LOQUI_OPENAI_BASE_URL;
    else process.env.LOQUI_OPENAI_BASE_URL = savedBase;
    initial.closeAllConnections();
    target.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => initial.close(resolve)),
      new Promise((resolve) => target.close(resolve)),
    ]);
  });
  globalThis.fetch = originalFetch;
  process.env.LOQUI_OPENAI_BASE_URL = `http://127.0.0.1:${initial.address().port}/v1`;
  const result = await verify("openai");
  assert.equal(result.outcome, "recorded");
  assert.equal(result.entry.status, "unreachable");
  assert.equal(firstRequests, 1);
  assert.equal(redirectedRequests, 0);
});

// change-driving: API version is part of main's actual Azure request config.
test("Azure Test captures configured API version and refuses a change during capture", async () => {
  await patch({ azureEndpoint: "https://versioned-azure.example/openai" });
  await real.env.saveAzureApiVersion("2025-01-01-preview");
  const target = await rawDescribe("azure", { model: "deployment" });
  assert.deepEqual(await connection("azure", "deployment", target.recipientToken), {
    success: true,
  });
  assert.equal(enterpriseCalls.at(-1).enterprise.azureApiVersion, "2025-01-01-preview");
  const capture = ipc.credentials.captureCommitted;
  const gate = deferred();
  ipc.credentials.captureCommitted = async (id) => {
    const result = await capture(id);
    await gate.promise;
    return result;
  };
  const count = enterpriseCalls.length;
  const checking = connection("azure", "deployment", target.recipientToken);
  await real.env.saveAzureApiVersion("2025-02-01-preview");
  gate.resolve();
  assert.deepEqual(await checking, { success: false, errorCode: "recipientChanged" });
  assert.equal(enterpriseCalls.length, count);
  ipc.credentials.captureCommitted = capture;
});

// change-driving FIX1 I1: real authority captures fallback B while the reviewed
// and finally live environment are A; generation/presence alone cannot bind it.
test("FIX1: legacy Vertex capture ABA cannot dispatch a different effective key", async (t) => {
  await patch({ vertexAuthSource: "apiKey" });
  await ipc.credentials.save("vertex", "key", "");
  process.env.GOOGLE_VERTEX_API_KEY = "fixture-legacy-authorized-A";
  const target = await rawDescribe("vertex", { model: "fixture-model" });
  const originalCapture = ipc.credentials.captureCommitted;
  let capturedB = false;
  ipc.credentials.captureCommitted = async (id) => {
    process.env.GOOGLE_VERTEX_API_KEY = "fixture-legacy-captured-B";
    const result = await originalCapture(id);
    capturedB = result.values.key === "fixture-legacy-captured-B";
    process.env.GOOGLE_VERTEX_API_KEY = "fixture-legacy-authorized-A";
    return result;
  };
  t.after(() => {
    ipc.credentials.captureCommitted = originalCapture;
  });
  const count = enterpriseCalls.length;
  const result = await connection("vertex", "fixture-model", target.recipientToken);
  assert.equal(capturedB, true, "the real authority captured fixture B");
  assert.deepEqual(result, { success: false, errorCode: "recipientChanged" });
  assert.equal(enterpriseCalls.length, count, "no captured B dispatch under reviewed A");
});

function fix1FactoryFixture(
  t,
  { readFile, parseKnownFiles, googleAuth, amazonBedrock, fetchImpl }
) {
  const loader = Module._load;
  const modelModule = require.resolve("../../src/helpers/enterpriseAiProviders");
  const executor = ipc._enterpriseVerificationExecutor;
  const fetcher = globalThis.fetch;
  ipc._enterpriseVerificationExecutor = null;
  let dispatched = 0;
  globalThis.fetch = fetchImpl;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === modelModule) {
      if (request === "node:fs/promises" && readFile) return { readFile };
      if (request === "@smithy/core/config" && parseKnownFiles) return { parseKnownFiles };
      if (request === "google-auth-library" && googleAuth) return { GoogleAuth: googleAuth };
      if (request === "@ai-sdk/amazon-bedrock" && amazonBedrock)
        return { createAmazonBedrock: amazonBedrock };
    }
    if (parent?.filename === handlersModulePath && request === "ai")
      return {
        generateText: async () => {
          dispatched++;
          return {};
        },
      };
    return loader.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = loader;
    globalThis.fetch = fetcher;
    ipc._enterpriseVerificationExecutor = executor;
  });
  return {
    dispatched: () => dispatched,
    run: (provider = "vertex", enterprise = {}, timeoutMs = 20) =>
      ipc._runEnterpriseVerification(
        {
          provider,
          model: "fixture-model",
          apiKey: "",
          timeoutMs,
          messages: [],
          maxOutputTokens: 16,
          enterprise: {
            frozenCredentials: true,
            vertexAuthSource: "adc",
            vertexProject: "fixture-project",
            vertexLocation: "global",
            vertexAdcFile: "/fixture/adc.json",
            ...enterprise,
          },
        },
        () => {}
      ),
  };
}
const fix1AdcJson = JSON.stringify({
  type: "authorized_user",
  client_id: "fixture-client",
  client_secret: "fixture-secret",
  refresh_token: "fixture-refresh",
});
const fix1TokenResponse = () =>
  new Response('{"access_token":"fixture-token","expires_in":3600,"token_type":"Bearer"}', {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const fix1Drain = () => new Promise((resolve) => setTimeout(resolve, 50));

// change-driving FIX1 I2: a late filesystem completion must not start OAuth.
test("FIX1: ADC read released after overall timeout cannot start a credential exchange", async (t) => {
  const gate = deferred();
  let exchanges = 0;
  const fixture = fix1FactoryFixture(t, {
    readFile: async () => {
      await gate.promise;
      return fix1AdcJson;
    },
    fetchImpl: async () => {
      exchanges++;
      return fix1TokenResponse();
    },
  });
  const keepalive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(fixture.run(), { name: "TimeoutError" });
  } finally {
    clearTimeout(keepalive);
    gate.resolve();
  }
  await fix1Drain();
  assert.equal(exchanges, 0, "expired ADC continuation cannot send fixture credentials");
  assert.equal(fixture.dispatched(), 0);
});

// change-driving FIX1 I2: real GoogleAuth and Gaxios must carry the same overall
// abort into an in-flight fixture fetch and must not retry after that deadline.
test("FIX1: overall timeout cancels an in-flight ADC exchange without retry", async (t) => {
  const { GoogleAuth } = require("google-auth-library");
  let authCompletion;
  let exchangeSignal;
  let readSignal;
  let exchanges = 0;
  let cancelled = false;
  const responseGate = deferred();
  const fixture = fix1FactoryFixture(t, {
    readFile: async (_file, options) => {
      readSignal = options?.signal;
      return fix1AdcJson;
    },
    googleAuth: class extends GoogleAuth {
      getAccessToken() {
        authCompletion = super.getAccessToken();
        return authCompletion;
      }
    },
    fetchImpl: async (_url, init) => {
      exchanges++;
      exchangeSignal = init.signal;
      return new Promise((resolve, reject) => {
        const abort = () => {
          cancelled = true;
          reject(init.signal.reason);
        };
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
        responseGate.promise.then(() => {
          init.signal?.removeEventListener("abort", abort);
          resolve(fix1TokenResponse());
        });
      });
    },
  });
  const keepalive = setTimeout(() => {}, 150);
  try {
    await assert.rejects(fixture.run(), { name: "TimeoutError" });
    assert.equal(exchanges, 1);
    assert.equal(
      exchangeSignal?.aborted,
      true,
      "actual Gaxios fetch receives the expired overall signal"
    );
    assert.equal(cancelled, true);
    // baseline assertion added after original RED: one signal covers file and transport.
    assert.equal(exchangeSignal, readSignal);
    await fix1Drain();
    assert.equal(exchanges, 1, "no credential retry after abort");
    assert.equal(fixture.dispatched(), 0);
  } finally {
    clearTimeout(keepalive);
    responseGate.resolve();
    await authCompletion?.catch(() => {});
    await new Promise(setImmediate);
  }
});

// change-driving FIX1 I2: the equivalent frozen static-profile continuation
// cannot construct a credential-bearing model after a held parse times out.
test("FIX1: static profile released after overall timeout cannot construct a model", async (t) => {
  const gate = deferred();
  let constructed = 0;
  const fixture = fix1FactoryFixture(t, {
    parseKnownFiles: async () => {
      await gate.promise;
      return {
        accepted: { aws_access_key_id: "AKIAFIXTURE", aws_secret_access_key: "fixture-secret" },
      };
    },
    amazonBedrock: () => {
      constructed++;
      return () => ({});
    },
    fetchImpl: async () => {
      throw new Error("fixture forbids transport");
    },
  });
  const keepalive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(
      fixture.run("bedrock", {
        bedrockProfile: "accepted",
        bedrockRegion: "eu-west-1",
        bedrockBaseURL: "https://fixture.example",
      }),
      { name: "TimeoutError" }
    );
  } finally {
    clearTimeout(keepalive);
    gate.resolve();
  }
  await fix1Drain();
  assert.equal(constructed, 0);
  assert.equal(fixture.dispatched(), 0);
});

// baseline guards added after initial FIX1 GREEN: stored mode keeps its actual
// stored key and ADC's independent source is not converted to legacy-key mode.
test("FIX1 baseline: stored-key and ADC source distinctions survive legacy environment ABA", async (t) => {
  const capture = ipc.credentials.captureCommitted;
  t.after(() => {
    ipc.credentials.captureCommitted = capture;
  });
  for (const source of ["apiKey", "adc"]) {
    await patch({ vertexAuthSource: source, vertexProject: "fixture-project" });
    await ipc.credentials.save("vertex", "key", source === "apiKey" ? "fixture-stored-key" : "");
    process.env.GOOGLE_VERTEX_API_KEY = "fixture-environment-A";
    const target = await rawDescribe("vertex", { model: "fixture-model" });
    ipc.credentials.captureCommitted = async (id) => {
      process.env.GOOGLE_VERTEX_API_KEY = "fixture-environment-B";
      const value = await capture(id);
      process.env.GOOGLE_VERTEX_API_KEY = "fixture-environment-A";
      return value;
    };
    assert.deepEqual(await connection("vertex", "fixture-model", target.recipientToken), {
      success: true,
    });
    const request = enterpriseCalls.at(-1);
    assert.equal(request.enterprise.vertexAuthSource, source);
    if (source === "apiKey") assert.equal(request.apiKey, "fixture-stored-key");
    else assert.deepEqual(target.fields, [], "ADC discloses no API-key field");
    ipc.credentials.captureCommitted = capture;
  }
});

// baseline guard after FIX1 GREEN: OAuth2Client requests POST retries by default;
// actual GoogleAuth/Gaxios must retain the probe's no-retry predicate on HTTP500.
test("FIX1 baseline: ADC HTTP failure never retries credential exchange", async (t) => {
  let exchanges = 0;
  const fixture = fix1FactoryFixture(t, {
    readFile: async () => fix1AdcJson,
    fetchImpl: async () => {
      exchanges++;
      return new Response("{}", { status: 500, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(fixture.run("vertex", {}, 1000), (error) => error.response?.status === 500);
  await fix1Drain();
  assert.equal(exchanges, 1);
  assert.equal(fixture.dispatched(), 0);
});

// baseline guard added after FIX1 GREEN: real GoogleAuth/Gaxios and native
// fetch against a held loopback response prove cancellation closes the socket.
test("FIX1 baseline: native ADC fixture transport closes on the overall deadline", async (t) => {
  const http = require("node:http");
  const closed = deferred();
  let exchanges = 0;
  const server = http.createServer((request, response) => {
    exchanges++;
    request.resume();
    response.on("close", () => {
      if (!response.writableEnded) closed.resolve();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const fixture = fix1FactoryFixture(t, {
    readFile: async () => fix1AdcJson,
    fetchImpl: (_url, init) =>
      originalFetch(`http://127.0.0.1:${server.address().port}/fixture-oauth`, init),
  });
  await assert.rejects(fixture.run("vertex", {}, 500), { name: "TimeoutError" });
  let guard;
  try {
    await Promise.race([
      closed.promise,
      new Promise((_resolve, reject) => {
        guard = setTimeout(() => reject(new Error("fixture socket was not cancelled")), 500);
      }),
    ]);
  } finally {
    clearTimeout(guard);
  }
  await fix1Drain();
  assert.equal(exchanges, 1, "one loopback request, no auth retry");
  assert.equal(fixture.dispatched(), 0);
});
