const { ipcDownloaderLeaf } = require("./harness/ipcDownloaderLeaf");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { deferred } = require("./harness/deferred");
const { realCredentialEnv } = require("./harness/realCredentialEnv");

// Drives the real IPCHandlers, keyring and registered legacy channels against
// the real egress gate. Every transport is an in-process stub; no network.
const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-provider-check-sealed-"));
const originalLoad = Module._load;
const handlers = new Map();
const netCalls = [];
const fetchCalls = [];
let netImpl = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: "tok", expires_in: 300 }),
});
let fetchImpl = async () => new Response('{"data":[]}', { status: 200 });
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
      netCalls.push({ url: String(url), init });
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
// While set, the legacy channels' SDK entry points are recording stubs, so even
// an ungated channel (the RED baseline) stops at a stub, never a real SDK chain.
let legacySdkCalls = null;
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (legacySdkCalls && parent?.filename === handlersModulePath) {
    if (request === "./enterpriseAiProviders")
      return {
        getEnterpriseAIModel: async (provider) => {
          legacySdkCalls.push(["model", provider]);
          throw new Error("legacy SDK stub reached");
        },
      };
    if (request === "@aws-sdk/client-bedrock")
      return {
        BedrockClient: class {
          constructor() {
            legacySdkCalls.push(["bedrockClient"]);
          }
          send() {
            return Promise.reject(new Error("legacy SDK stub reached"));
          }
        },
        ListFoundationModelsCommand: class {},
        paginateListInferenceProfiles: async function* () {},
      };
  }
  const downloader = ipcDownloaderLeaf(request, parent);
  if (downloader) return downloader;
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

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
let sealed = false;
let recorder;
// A strictly increasing clock keeps the ledger's newest-first order exact.
let clock = 0;
const now = () => ++clock;
let ipc;
let real;
let restoreEnvironment = () => {};
const rows = new Map();
const originalFetch = globalThis.fetch;
const keyReads = { groq: 0 };

test.before(() => {
  real = realCredentialEnv(
    {
      after: (fn) => {
        restoreEnvironment = fn;
      },
    },
    {
      GROQ_API_KEY: "gsk-sealed-SECRET",
      CORTI_CLIENT_ID: "cid-sealed",
      CORTI_CLIENT_SECRET: "csec-sealed",
      VERTEX_AUTH_SOURCE: "adc",
      VERTEX_PROJECT: "fixture-project",
      VERTEX_LOCATION: "us-central1",
    }
  );
  const readGroq = real.env.getGroqKey.bind(real.env);
  real.env.getGroqKey = () => {
    keyReads.groq++;
    return readGroq();
  };
  gate._resetForTests();
  recorder = new FlightRecorder({ now });
  // Production reads one state for both the keyring predicate and the gate.
  gate.configureEgress({ isSealed: () => sealed, recorder, now });
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return fetchImpl(url, init);
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
  };
  ipc = new Ctor(new Proxy(managers, { get: (t, p) => (p in t ? t[p] : anything()) }));
  // The proxy above would otherwise supply a stand-in executor: use the real SDK path.
  ipc._enterpriseVerificationExecutor = null;
  ipc.resolveVertexAuthSourceReady?.();
});

test.after(() => {
  try {
    ipc?._stopKeyReminders?.();
    ipc?.keyring?.dispose();
  } finally {
    restoreEnvironment();
    globalThis.fetch = originalFetch;
    gate._resetForTests();
    Module._load = originalLoad;
    delete require.cache[handlersModulePath];
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test.beforeEach(() => {
  sealed = false;
  fetchCalls.length = 0;
  netCalls.length = 0;
  recorder.clear();
  fetchImpl = async () => new Response('{"data":[]}', { status: 200 });
});

const sender = new EventEmitter();
sender.isDestroyed = () => false;
const event = { sender };
const verify = async (identity, options = {}) => {
  const { recipientToken } = await handlers.get("keyring-describe-verify")(
    event,
    identity,
    options
  );
  return handlers.get("keyring-verify")(event, identity, { ...options, recipientToken });
};
// Bounded: a regression fails the test instead of spinning forever.
async function waitFor(predicate, turns = 2000) {
  for (let i = 0; i < turns; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition not reached");
}
// Bounded: a request that sealing fails to stop fails the test, not the run.
const within = (promise, ms = 3000) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("still pending: sealing did not stop it")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
const patch = async (values) => {
  const { current } = real.env.getEnterpriseRouteState();
  return real.env.saveEnterpriseRoutePatch(values, { expected: current });
};

test("the legacy connection-test channel is refused while sealed, before the key is read", async () => {
  sealed = true;
  const reads = keyReads.groq;
  await assert.rejects(
    handlers.get("test-provider-connection")(event, { provider: "groq" }),
    (error) => sealedPhaseOf(error) === "refused"
  );
  assert.equal(keyReads.groq, reads, "no credential was read");
  assert.deepEqual(fetchCalls, []);
  const [row] = recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.outcome, row.bytesOut],
    ["providerCheck", "api.groq.com", "blocked", 0]
  );
});

test("an unsealed Verify is one metered providerCheck request to the captured endpoint", async () => {
  const result = await verify("groq");
  assert.equal(result.outcome, "recorded");
  assert.equal(result.entry.status, "verified");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.redirect, "error");
  const [row] = recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.kind, row.status],
    ["providerCheck", "api.groq.com", "request", 200]
  );
});

test("a Verify cut off by sealing is outcome sealed and records no credential verdict", async () => {
  await verify("groq");
  const before = { ...rows.get("groq") };
  const stalled = deferred();
  fetchImpl = () => stalled.promise;
  const sent = fetchCalls.length;
  const pending = verify("groq");
  await waitFor(() => fetchCalls.length > sent);
  // The OS-level stop surfaces as a transport failure before the JS ticket
  // aborts; the keyring must not turn it into an "unreachable" verdict.
  sealed = true;
  stalled.resolve(
    Promise.reject(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))
  );
  assert.equal((await within(pending)).outcome, "sealed");
  assert.deepEqual(rows.get("groq"), before, "no health row was written");
  const [row] = recorder.list();
  assert.deepEqual(
    [row.task, row.outcome, row.errorClass],
    ["providerCheck", "error", "CONNECTION"]
  );
});

test("sealing aborts an in-flight Verify as interrupted, never as nothing sent", async (t) => {
  const stalled = deferred();
  t.after(() => stalled.resolve(new Response("{}")));
  fetchImpl = () => stalled.promise;
  const pending = verify("groq");
  await waitFor(() => fetchCalls.length > 0);
  sealed = true;
  gate.abortAllRemote();
  assert.equal((await within(pending)).outcome, "sealed");
  const [row] = recorder.list();
  assert.deepEqual(
    [row.task, row.outcome, row.errorClass, row.bytesOut],
    ["providerCheck", "cancelled", "SEALED_MODE", null]
  );
});

test("captured Corti Verify uses a metered, tagged Electron transport that refuses redirects", async () => {
  const result = await verify("corti:speech", {
    cortiEnvironment: "eu",
    cortiTenant: "sealedcheck",
  });
  assert.equal(result.outcome, "recorded");
  assert.equal(netCalls.length, 1);
  assert.equal(netCalls[0].init.redirect, "error");
  assert.match(new Headers(netCalls[0].init.headers).get(gate.EGRESS_TAG_HEADER), /^\d+\.\d+\./);
  const [row] = recorder.list();
  assert.deepEqual([row.task, row.host], ["providerCheck", "auth.eu.corti.app"]);
});

test("the stored-credential Corti test is gated and metered too", async () => {
  sealed = true;
  await assert.rejects(
    handlers.get("test-provider-connection")(event, {
      provider: "corti",
      scope: "transcription",
      environment: "eu",
      tenant: "legacy",
      clientId: "__stored__",
      clientSecret: "__stored__",
    }),
    isSealedModeError
  );
  assert.deepEqual(netCalls, []);
  sealed = false;
  assert.deepEqual(
    await handlers.get("test-provider-connection")(event, {
      provider: "corti",
      scope: "transcription",
      environment: "eu",
      tenant: "legacy",
      clientId: "__stored__",
      clientSecret: "__stored__",
    }),
    { success: true }
  );
  assert.equal(netCalls.length, 1);
  assert.ok(new Headers(netCalls[0].init.headers).get(gate.EGRESS_TAG_HEADER));
  assert.equal(recorder.list()[0].host, "auth.eu.corti.app");
});

test("the real enterprise Test is gated at the captured endpoint and interrupted by sealing", async (t) => {
  await patch({ azureEndpoint: "https://sealed-azure.example/openai" });
  await ipc.credentials.save("azure", "key", "fixture-azure-secret");
  const description = await handlers.get("keyring-describe-verify")(event, "azure", {
    model: "deployment",
  });
  const stalled = deferred();
  t.after(() => stalled.resolve(new Response("{}")));
  fetchImpl = () => stalled.promise;
  const pending = handlers.get("keyring-verify-connection")(event, {
    provider: "azure",
    model: "deployment",
    recipientToken: description.recipientToken,
  });
  await waitFor(() => fetchCalls.length > 0);
  assert.equal(new URL(fetchCalls[0].url).host, "sealed-azure.example");
  sealed = true;
  gate.abortAllRemote();
  assert.deepEqual(await within(pending), { success: false, errorCode: "sealed" });
  const [row] = recorder.list();
  assert.deepEqual(
    [row.task, row.host, row.outcome, row.errorClass],
    ["providerCheck", "sealed-azure.example", "cancelled", "SEALED_MODE"]
  );
});

for (const [channel, args] of [
  ["test-enterprise-connection", ["azure", { azureEndpoint: "https://legacy-azure.example" }]],
  [
    "process-enterprise-reasoning",
    [
      "text",
      "model",
      "agent",
      { provider: "bedrock", bedrockRegion: "eu-west-1", inferenceScope: "dictationCleanup" },
    ],
  ],
  [
    "enterprise-stream-start",
    [{ streamId: "s1", provider: "vertex", modelId: "m", config: { vertexLocation: "us-east1" } }],
  ],
  ["bedrock-list-models", [{ bedrockRegion: "eu-west-1" }]],
])
  test(`legacy ${channel} is refused while sealed before any runtime or transport`, async () => {
    sealed = true;
    const sent = [];
    const owner = Object.assign(new EventEmitter(), {
      id: 9,
      isDestroyed: () => false,
      send: (...message) => sent.push(message),
    });
    legacySdkCalls = [];
    try {
      await assert.rejects(handlers.get(channel)({ sender: owner }, ...args), isSealedModeError);
      assert.deepEqual(legacySdkCalls, [], "no SDK or credential chain was constructed");
    } finally {
      legacySdkCalls = null;
    }
    assert.deepEqual(fetchCalls, []);
    assert.deepEqual(sent, []);
    const [row] = recorder.list();
    assert.equal(row.outcome, "blocked");
  });
