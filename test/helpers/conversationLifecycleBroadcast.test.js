const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const handlers = new Map();
const broadcasts = [];
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
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }),
  },
  BrowserWindow: class {
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
    if (request === "./cortiTranscription") return { transcribeAudio: async () => ({ text: "" }) };
    if (request === "./tinfoilTranscription")
      return { transcribeWithTinfoil: async () => ({ text: "" }), getTinfoilChatModels: () => [] };
    if (request === "./windowBroadcast")
      return { broadcastToWindows: (channel, data) => broadcasts.push([channel, data]) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function anything() {
  return new Proxy(function () {}, {
    get: (t, prop) =>
      prop === Symbol.toPrimitive || prop === "toString"
        ? () => ""
        : prop === "then"
          ? undefined
          : anything(),
    apply: () => anything(),
  });
}
const db = { deleteResult: { success: true }, archiveResult: { success: true } };
const target = {
  databaseManager: {
    deleteAgentConversation: () => db.deleteResult,
    archiveAgentConversation: () => db.archiveResult,
  },
  vectorIndex: null,
};

test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  (IPCHandlers.default || IPCHandlers).prototype.setupHandlers.call(
    new Proxy(target, { get: (t, prop) => (prop in t ? t[prop] : anything()) })
  );
});
test.after(() => {
  Module._load = originalLoad;
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

function loadPreloadApi() {
  let api;
  const listeners = new Map();
  const invocations = [];
  const ipcRenderer = {
    invoke: async (channel, ...args) => {
      invocations.push([channel, ...args]);
      return { success: true };
    },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) =>
      listeners.get(channel) === listener && listeners.delete(channel),
    send: () => {},
    sendSync: () => undefined,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../preload.js"), "utf8"), {
    require: (s) => {
      if (s === "electron")
        return {
          contextBridge: { exposeInMainWorld: (_n, a) => (api = a) },
          ipcRenderer,
          webUtils: {},
        };
      throw new Error(`Unexpected preload dependency: ${s}`);
    },
    process,
  });
  return { api, listeners, invocations };
}

for (const [action, handler, subscribe] of [
  ["deleted", "db-delete-agent-conversation", "onAgentConversationDeleted"],
  ["archived", "db-archive-agent-conversation", "onAgentConversationArchived"],
]) {
  test(`a ${action} conversation reaches the renderer through main's broadcast and the preload listener`, async () => {
    broadcasts.length = 0;
    await handlers.get(handler)({}, 7);
    await flush();
    assert.deepEqual(broadcasts, [[`agent-conversation-${action}`, { id: 7 }]]);
    const { api, listeners } = loadPreloadApi();
    const received = [];
    const off = api[subscribe]((payload) => received.push(payload));
    const [channel, payload] = broadcasts[0];
    listeners.get(channel)({}, payload);
    assert.deepEqual(received, [{ id: 7 }]);
    off();
    assert.equal(listeners.has(channel), false, "unsubscribe removes the listener");
  });
}

test("nothing is broadcast when the delete or archive did not happen", async () => {
  broadcasts.length = 0;
  db.deleteResult = { success: false };
  db.archiveResult = { success: false };
  await handlers.get("db-delete-agent-conversation")({}, 8);
  await handlers.get("db-archive-agent-conversation")({}, 8);
  await flush();
  assert.deepEqual(broadcasts, []);
  db.deleteResult = { success: true };
  db.archiveResult = { success: true };
});

for (const [method, channel, args] of [
  ["getTableBoard", "db-get-table-board", [1]],
  ["placeTableCards", "db-place-table-cards", [1, [{ type: "note", id: 7, x: 12, y: 34 }]]],
  ["hideTableCards", "db-hide-table-cards", [1, [{ type: "note", id: 7 }]]],
  ["linkTableCards", "db-link-table-cards", [1, { type: "note", id: 7 }, { type: "chat", id: 8 }]],
  ["setTableViewport", "db-set-table-viewport", [1, { x: 0, y: 10, scale: 0.5 }]],
]) {
  test(`${method} passes the actual preload payload through its registered main handler and returns its acknowledgement`, async () => {
    const expected = { success: false, code: "fixture-refusal" };
    let received;
    target.databaseManager[method] = (...values) => {
      received = values;
      return expected;
    };
    const { api, invocations } = loadPreloadApi();
    await api[method](...args);
    assert.deepEqual(invocations, [[channel, ...args]]);
    const [invokedChannel, ...payload] = invocations[0];
    const result = await handlers.get(invokedChannel)({}, ...payload);
    assert.deepEqual(received, args);
    assert.equal(result, expected);
    delete target.databaseManager[method];
  });
}

test("a thrown lifecycle mutation rejects without emitting a success broadcast", async () => {
  broadcasts.length = 0;
  for (const [method, channel] of [
    ["deleteAgentConversation", "db-delete-agent-conversation"],
    ["archiveAgentConversation", "db-archive-agent-conversation"],
  ]) {
    const original = target.databaseManager[method];
    try {
      target.databaseManager[method] = () => {
        throw new Error("fixture failure");
      };
      await assert.rejects(handlers.get(channel)({}, 42), /fixture failure/);
    } finally {
      target.databaseManager[method] = original;
    }
  }
  await flush();
  assert.deepEqual(broadcasts, []);
});
