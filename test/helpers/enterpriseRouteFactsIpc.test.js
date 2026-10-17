const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const handlers = new Map();
let target;

const electronStub = {
  app: {
    getPath: () => "/tmp",
    getName: () => "test",
    getVersion: () => "0.0.0",
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
    fetch: async () => {
      throw new Error("no network in route facts");
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

Module._load = function loadWithMocks(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (parent?.filename === handlersModulePath) {
    if (request === "./debugLogger") return new Proxy({}, { get: () => () => {} });
    if (request === "./windowBroadcast") return { broadcastToWindows: () => {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function anything() {
  return new Proxy(function () {}, {
    get: (target, property) => {
      if (property === Symbol.toPrimitive || property === "toString") return () => "";
      if (property === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

const ENV = [
  "BEDROCK_PROFILE",
  "VERTEX_AUTH_SOURCE",
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
  "GOOGLE_VERTEX_API_KEY",
  "GOOGLE_VERTEX_PROJECT",
  "BEDROCK_REGION",
  "AZURE_OPENAI_ENDPOINT",
  "VERTEX_PROJECT",
  "VERTEX_LOCATION",
];
const savedEnv = new Map(ENV.map((name) => [name, process.env[name]]));
function injectEnv(values) {
  for (const name of ENV) delete process.env[name];
  Object.assign(process.env, values);
}

test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  const EnvironmentManager = require("../../src/helpers/environment");
  // The real getters over an injected environment; the constructor only loads dotenv files.
  target = {
    vertexAuthSourceReady: Promise.resolve(),
    environmentManager: Object.create(EnvironmentManager.prototype),
  };
  Ctor.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (value, property) => (property in value ? value[property] : anything()),
    })
  );
});

test.after(() => {
  Module._load = originalLoad;
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("[change-driving] enterprise-route-facts reports main's overrides as hosts and booleans, never a value", async () => {
  // R2-1, change-driving: the channel does not exist yet.
  const facts = () => handlers.get("enterprise-route-facts")({});
  assert.ok(handlers.get("enterprise-route-facts"), "registered by the production setupHandlers");
  injectEnv({});
  assert.deepEqual(await facts(), {
    bedrockEndpoint: { set: false, host: null },
    bedrockProfile: false,
    vertexApiKeyEnv: false,
    vertexProjectEnv: false,
  });
  injectEnv({
    AWS_ENDPOINT_URL_BEDROCK_RUNTIME: "https://bedrock-proxy.corp.example:8443/",
    AWS_ENDPOINT_URL: "https://ignored.corp.example",
    GOOGLE_VERTEX_API_KEY: "fixture-env-key",
    GOOGLE_VERTEX_PROJECT: "fixture-project",
  });
  const withOverrides = await facts();
  assert.deepEqual(withOverrides, {
    bedrockEndpoint: { set: true, host: "bedrock-proxy.corp.example:8443" },
    bedrockProfile: false,
    vertexApiKeyEnv: true,
    vertexProjectEnv: true,
  });
  injectEnv({ AWS_ENDPOINT_URL: "https://user:fixture-pass@aws-gateway.corp.example" });
  const credentialUrl = await facts();
  assert.deepEqual(
    credentialUrl.bedrockEndpoint,
    { set: true, host: null },
    "fetch refuses it, so no host"
  );
  for (const result of [withOverrides, credentialUrl]) {
    const text = JSON.stringify(result);
    for (const secret of ["fixture-env-key", "fixture-project", "fixture-pass", "user:"]) {
      assert.equal(text.includes(secret), false, `no value leaves main: ${secret}`);
    }
  }
});

test("[baseline guard] the existing getters return main's enterprise settings exactly as the executor receives them", async () => {
  // R2-1: these are the values main.js:447-457 hands enterpriseAiProviders.js.
  injectEnv({
    BEDROCK_REGION: "eu-west-1",
    AZURE_OPENAI_ENDPOINT: "https://main.example.com/openai",
    VERTEX_PROJECT: "acme-prod",
  });
  assert.equal(await handlers.get("get-bedrock-region")({}), "eu-west-1");
  assert.equal(await handlers.get("get-azure-endpoint")({}), "https://main.example.com/openai");
  assert.equal(await handlers.get("get-vertex-project")({}), "acme-prod");
  assert.equal(
    await handlers.get("get-vertex-location")({}),
    "",
    "unset is empty; the executor defaults it"
  );
});

// change-driving R3-1: neither facts nor any of the five configuration getters
// may escape the production migration admission gate.
test("enterprise facts and all startup getters await source migration", async () => {
  let release;
  target.vertexAuthSourceReady = new Promise((resolve) => {
    release = resolve;
  });
  injectEnv({ VERTEX_AUTH_SOURCE: "adc" });
  let answered = 0;
  const channels = [
    "enterprise-route-facts",
    "get-bedrock-region",
    "get-azure-endpoint",
    "get-vertex-project",
    "get-vertex-location",
    "get-vertex-auth-source",
  ];
  const pending = channels.map((channel) =>
    handlers
      .get(channel)({})
      .then((value) => {
        answered++;
        return value;
      })
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, 0);
  release();
  const results = await Promise.all(pending);
  assert.equal(answered, channels.length);
  assert.equal(results.at(-1), "adc");
});
