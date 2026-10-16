const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const handlers = new Map();
const fetches = [];
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
    fetch: async (url, init) => {
      fetches.push({ url: String(url), body: String(init?.body ?? "") });
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok", expires_in: 300 }),
      };
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

Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (parent?.filename === handlersModulePath && request === "./debugLogger") {
    return new Proxy({}, { get: () => () => {} });
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

let Ctor;
const keyringCalls = [];
const testCalls = [];
test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  Ctor = IPCHandlers.default || IPCHandlers;
  const target = {
    keyring: {
      list: () => [{ id: "groq", status: "rejected" }],
      verify: async (identity, options) => {
        keyringCalls.push(["verify", identity, options]);
        return { outcome: "recorded", entry: null };
      },
      setReminder: (identity, enabled) => {
        keyringCalls.push(["setReminder", identity, enabled]);
        return null;
      },
      describeVerify: async (identity, options) => {
        keyringCalls.push(["describeVerify", identity, options]);
        return { hosts: ["auth.eu.corti.app"], fields: ["clientId", "clientSecret"] };
      },
    },
    _runProviderConnectionTest: async (config) => {
      testCalls.push(config);
      return { success: true };
    },
  };
  Ctor.prototype.setupHandlers.call(
    new Proxy(target, { get: (t, property) => (property in t ? t[property] : anything()) })
  );
});

test.after(() => {
  Module._load = originalLoad;
  delete require.cache[handlersModulePath];
});

// change-driving (I10): the extracted method resolves the stored Corti client
// pair in main; the renderer only ever sends the "__stored__" markers.
test("Corti speech verification mints a token with the stored client credentials", async () => {
  const { testConfigFor } = require("../../src/helpers/keyring.js");
  const fakeThis = {
    environmentManager: {
      getCortiKey: () => "",
      getCortiClientId: () => "stored-client-id-keyring-test",
      getCortiClientSecret: () => "stored-client-secret",
    },
  };
  fakeThis._mintStoredCortiToken = Ctor.prototype._mintStoredCortiToken.bind(fakeThis);
  const result = await Ctor.prototype._runProviderConnectionTest.call(
    fakeThis,
    testConfigFor("corti:speech", { cortiEnvironment: "eu", cortiTenant: "acme" })
  );
  assert.deepEqual(result, { success: true });
  assert.equal(fetches.length, 1);
  assert.equal(
    fetches[0].url,
    "https://auth.eu.corti.app/realms/acme/protocol/openid-connect/token"
  );
  assert.match(fetches[0].body, /client_id=stored-client-id-keyring-test/);
  assert.match(fetches[0].body, /client_secret=stored-client-secret/);
  assert.doesNotMatch(fetches[0].body, /__stored__/);
});

// change-driving: the channels do not exist yet; test-provider-connection must
// keep its behaviour by delegating to the extracted method.
test("keyring channels delegate to main's keyring and the connection test is shared", async () => {
  assert.deepEqual(await handlers.get("keyring-list")({}), [{ id: "groq", status: "rejected" }]);
  await handlers.get("keyring-verify")({}, "corti:speech", {
    cortiEnvironment: "eu",
    cortiTenant: 42,
    apiKey: "smuggled",
  });
  await handlers.get("keyring-set-reminder")({}, "groq", "yes");
  assert.deepEqual(
    await handlers.get("keyring-describe-verify")({}, "corti:speech", {
      cortiEnvironment: "eu",
      apiKey: "x",
    }),
    { hosts: ["auth.eu.corti.app"], fields: ["clientId", "clientSecret"] }
  );
  assert.deepEqual(keyringCalls, [
    [
      "verify",
      "corti:speech",
      { cortiEnvironment: "eu", cortiTenant: 42, recipientToken: undefined },
    ],
    ["setReminder", "groq", false],
    [
      "describeVerify",
      "corti:speech",
      { cortiEnvironment: "eu", cortiTenant: undefined, model: undefined },
    ],
  ]);
  assert.deepEqual(await handlers.get("test-provider-connection")({}, { provider: "groq" }), {
    success: true,
  });
  assert.deepEqual(testCalls, [{ provider: "groq" }]);
});

// change-driving source guard for preload; the routeFactsStore line is a
// baseline guard (Task 3 subscribes) that keeps the refresh wired.
test("preload and route facts are wired to the keyring", () => {
  const root = path.join(__dirname, "../..");
  const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
  for (const channel of [
    "keyring-list",
    "keyring-verify",
    "keyring-describe-verify",
    "keyring-set-reminder",
    "keyring-changed",
  ]) {
    assert.ok(preload.includes(`"${channel}"`), `preload ${channel}`);
  }
  const facts = fs.readFileSync(path.join(root, "src/stores/routeFactsStore.ts"), "utf8");
  assert.match(facts, /keyring\?\.onChanged/);
});

function loadPreloadApi() {
  let exposedApi;
  const invocations = [];
  const sends = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke: async (channel, ...args) => {
      invocations.push([channel, ...args]);
      return true;
    },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    send: (channel, ...args) => sends.push([channel, ...args]),
    sendSync: () => undefined,
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld: (_name, api) => {
        exposedApi = api;
      },
    },
    ipcRenderer,
    webUtils: {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../../preload.js"), "utf8");
  vm.runInNewContext(source, {
    require: (specifier) => {
      if (specifier === "electron") return electron;
      throw new Error(`Unexpected preload dependency: ${specifier}`);
    },
    process,
  });
  return { api: exposedApi, invocations, listeners, sends };
}

// baseline guard: execute the actual sandbox preload; preserve the whole namespace.
test("preload forwards bound options/tokens and unsubscribes keyring events", async () => {
  const { api, invocations, listeners } = loadPreloadApi();
  const options = { cortiEnvironment: "eu", cortiTenant: "tenant", recipientToken: "opaque" };
  await api.keyring.list(options);
  await api.keyring.routeHealth(options);
  await api.keyring.describeVerify("corti:speech", options);
  await api.keyring.verify("corti:speech", options);
  const request = { provider: "azure", model: "deployment", recipientToken: "opaque" };
  await api.keyring.verifyConnection(request);
  await api.keyring.setReminder("groq", true);
  assert.deepEqual(invocations, [
    ["keyring-list", options],
    ["keyring-route-health", options],
    ["keyring-describe-verify", "corti:speech", options],
    ["keyring-verify", "corti:speech", options],
    ["keyring-verify-connection", request],
    ["keyring-set-reminder", "groq", true],
  ]);
  let received;
  const stop = api.keyring.onChanged((change) => {
    received = change;
  });
  const payload = { id: "groq" };
  listeners.get("keyring-changed")({}, payload);
  assert.equal(received, payload);
  stop();
  assert.equal(listeners.has("keyring-changed"), false);
  assert.equal(typeof api.credentials.list, "function");
  assert.equal(typeof api.personalInference.describeModels, "function");
});
