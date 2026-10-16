const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const handlers = new Map();
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
  net: { fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) },
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

const SECRET = "sk-ipc-SECRET-value";
const saves = [];
let saveResult = { ok: true, generation: 1 };
const authority = {
  list: () => [{ id: "openai", present: true, generation: 1, fields: { key: true } }],
  save: async (id, field, value) => {
    saves.push([id, field, value === SECRET]);
    return saveResult;
  },
  remove: async (id) => ({ ok: true, undoToken: `token-${id}`, expiresAt: 9, generation: 2 }),
  undoRemove: async (token) => ({ ok: true, generation: token === "token-openai" ? 3 : 0 }),
  refresh: (id) => saves.push(["refresh", id]),
};

test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  const target = {
    credentials: authority,
    _acknowledgedSave: Ctor.prototype._acknowledgedSave,
    environmentManager: {
      saveBedrockProfile: () => ({ success: true }),
      saveVertexProject: () => ({ success: true }),
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

// change-driving (I3/I10): legacy channels returned `true` or the env manager's
// unconditional { success: true } before the write finished.
test("every legacy secret save channel answers with main's acknowledgement", async () => {
  const expected = {
    "save-openai-key": ["openai", "key"],
    "save-corti-key": ["corti:text", "key"],
    "save-corti-client-id": ["corti:speech", "clientId"],
    "save-corti-client-secret": ["corti:speech", "clientSecret"],
    "save-custom-transcription-key": ["custom:transcription", "key"],
    "save-cleanup-custom-key": ["custom:dictationCleanup", "key"],
    "save-note-formatting-custom-key": ["custom:noteFormatting", "key"],
    "save-chat-agent-custom-key": ["custom:chatIntelligence", "key"],
    "save-bedrock-access-key-id": ["bedrock", "accessKeyId"],
    "save-bedrock-secret-access-key": ["bedrock", "secretAccessKey"],
    "save-bedrock-session-token": ["bedrock", "sessionToken"],
    "save-azure-api-key": ["azure", "key"],
    "save-vertex-api-key": ["vertex", "key"],
  };
  const results = [];
  for (const [channel, slot] of Object.entries(expected)) {
    saves.length = 0;
    saveResult = { ok: true, generation: 1 };
    const ok = await handlers.get(channel)({}, SECRET);
    assert.deepEqual(ok, { success: true }, channel);
    assert.deepEqual(saves, [[...slot, true]], channel);
    saveResult = { ok: false, error: "persistFailed" };
    const failed = await handlers.get(channel)({}, SECRET);
    assert.deepEqual(failed, { success: false, error: "persistFailed" }, channel);
    results.push(ok, failed);
  }
  assert.ok(!JSON.stringify(results).includes(SECRET));
});

// change-driving: the channels do not exist yet.
test("credentials channels delegate to the authority and return metadata only", async () => {
  saveResult = { ok: true, generation: 4 };
  assert.deepEqual(await handlers.get("credentials-list")({}), authority.list());
  assert.deepEqual(await handlers.get("credentials-save")({}, "groq", "key", SECRET), {
    ok: true,
    generation: 4,
  });
  assert.deepEqual(await handlers.get("credentials-remove")({}, "openai"), {
    ok: true,
    undoToken: "token-openai",
    expiresAt: 9,
    generation: 2,
  });
  assert.deepEqual(await handlers.get("credentials-undo-remove")({}, "token-openai"), {
    ok: true,
    generation: 3,
  });
});

// change-driving: presence that depends on a non-secret input is re-broadcast.
test("saving the Bedrock profile or Vertex project refreshes presence", async () => {
  saves.length = 0;
  await handlers.get("save-bedrock-profile")({}, "work");
  await handlers.get("save-vertex-project")({}, "proj");
  assert.deepEqual(saves, [
    ["refresh", "bedrock"],
    ["refresh", "vertex"],
  ]);
});

// change-driving source guard: preload exposes the namespace, main.js routes
// personal-inference saves through the authority, cleanup erases inside the reset barrier.
test("preload, main.js and cleanup are wired to the authority", () => {
  const root = path.join(__dirname, "../..");
  const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
  for (const channel of [
    "credentials-list",
    "credentials-save",
    "credentials-remove",
    "credentials-undo-remove",
    "credentials-changed",
  ]) {
    assert.ok(preload.includes(`"${channel}"`), `preload ${channel}`);
  }
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  assert.match(main, /ipcHandlers\.credentials\.save\(/);
  const ipc = fs.readFileSync(handlersModulePath, "utf8");
  const cleanup = ipc.match(
    /ipcMain\.handle\("cleanup-app"[\s\S]*?ipcMain\.handle\("update-hotkey"/
  );
  // R2-2: the erase runs inside the authority's reset barrier and nowhere else.
  assert.match(
    cleanup[0],
    /await this\.credentials\.reset\(\(\) => this\.environmentManager\?\.clearAllPersistedData\(\)\)/
  );
  assert.equal((cleanup[0].match(/clearAllPersistedData/g) || []).length, 1);
});

// change-driving: the real startup initializer and registered public handlers share a closed barrier.
test("public credential and enterprise handlers wait for durable migration acknowledgement", async (t) => {
  const { realCredentialEnv } = require("./harness/realCredentialEnv");
  const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority");
  const { fakeCodexFs } = require("./harness/fakeCredentialEnv");
  const real = realCredentialEnv(t, {}, { encryptionAvailable: false });
  const IPC = require(handlersModulePath);
  const Ctor = IPC.default || IPC;
  const target = {
    environmentManager: real.env,
    credentials: createCredentialAuthority({
      env: real.env,
      fs: fakeCodexFs(),
      codexHome: "/fixture/codex",
      setTimer() {},
    }),
    _acknowledgedSave: Ctor.prototype._acknowledgedSave,
    vertexAuthInitialization: null,
  };
  target.vertexAuthSourceReady = new Promise((resolve) => {
    target.resolveVertexAuthSourceReady = resolve;
  });
  Ctor.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (object, property) => (property in object ? object[property] : anything()),
    })
  );
  let listed = false;
  let read = false;
  let saved = false;
  const listing = handlers
    .get("credentials-list")({})
    .then((result) => {
      listed = true;
      return result;
    });
  const reading = handlers
    .get("get-vertex-auth-source")({})
    .then((result) => {
      read = true;
      return result;
    });
  const saving = handlers
    .get("save-openai-key")({}, SECRET)
    .then((result) => {
      saved = true;
      return result;
    });
  real.fs.holdNext((op, name) => op === "rename" && name === ".env");
  const migration = Ctor.prototype.initializeVertexAuthSource.call(target, false);
  assert.equal(
    Ctor.prototype.initializeVertexAuthSource.call(target, true),
    migration,
    "one-shot initialization"
  );
  const held = await real.fs.nextHold();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([listed, read, saved], [false, false, false]);
  assert.equal(target.credentials.present("openai"), false);
  held.release();
  await migration;
  assert.equal(await reading, "adc");
  assert.ok(Array.isArray(await listing));
  assert.deepEqual(await saving, { success: true });
  assert.equal(target.credentials.present("openai"), true);
  assert.equal(
    await handlers
      .get("save-bedrock-profile")({}, "fixture-profile")
      .then((result) => result.success),
    true
  );
  assert.equal(target.credentials.present("bedrock"), true);
  assert.equal(
    await handlers
      .get("save-bedrock-profile")({}, "")
      .then((result) => result.success),
    true
  );
  assert.equal(target.credentials.present("bedrock"), false);
});

// change-driving N1: production handler refreshes only after a durable profile write succeeds.
test("held or failed Bedrock profile saves do not refresh committed presence", async (t) => {
  const { realCredentialEnv } = require("./harness/realCredentialEnv");
  const real = realCredentialEnv(
    t,
    { BEDROCK_PROFILE: "fixture-old" },
    { encryptionAvailable: false }
  );
  const IPC = require(handlersModulePath);
  const Ctor = IPC.default || IPC;
  const refreshes = [];
  const target = {
    environmentManager: real.env,
    credentials: { refresh: (id) => refreshes.push(id) },
    vertexAuthSourceReady: Promise.resolve(),
  };
  Ctor.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (object, property) => (property in object ? object[property] : anything()),
    })
  );
  real.fs.holdNext((op, name) => op === "rename" && name === ".env");
  const saving = handlers.get("save-bedrock-profile")({}, "fixture-new");
  const failure = assert.rejects(saving, /fixture failure/);
  const held = await real.fs.nextHold();
  assert.deepEqual(refreshes, []);
  assert.equal(real.env.getBedrockProfile(), "fixture-old");
  held.fail(new Error("fixture failure"));
  await failure;
  assert.deepEqual(refreshes, []);
  assert.equal(real.env.getBedrockProfile(), "fixture-old");
});

// change-driving: unsuccessful migration cannot open public admission.
test("failed migration leaves public source admission closed and is not retried implicitly", async () => {
  const IPC = require(handlersModulePath);
  const Ctor = IPC.default || IPC;
  let open = false;
  let attempts = 0;
  const target = {
    vertexAuthInitialization: null,
    resolveVertexAuthSourceReady: () => {
      open = true;
    },
    environmentManager: {
      getEnvWriteEpoch: () => 0,
      drainEnvWrites: async () => {},
      getVertexAuthSource: () => null,
      saveVertexAuthSource: async () => {
        attempts++;
        throw new Error("fixture failed migration");
      },
    },
    credentials: { captureCommitted: async () => ({ values: { key: "" } }) },
  };
  await assert.rejects(
    Ctor.prototype.initializeVertexAuthSource.call(target, false),
    /fixture failed migration/
  );
  await assert.rejects(
    Ctor.prototype.initializeVertexAuthSource.call(target, false),
    /fixture failed migration/
  );
  assert.equal(open, false);
  assert.equal(attempts, 1);
});
