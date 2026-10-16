// Production IPC handlers over the real in-memory environment transaction.
const Module = require("node:module");
const { realCredentialEnv } = require("./realCredentialEnv");
const handlersPath = require.resolve("../../../src/helpers/ipcHandlers");
function anything() {
  return new Proxy(() => {}, {
    get: (_, key) =>
      key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : anything(),
    apply: () => anything(),
  });
}
function enterpriseRouteIpc(t, initial) {
  const fixture = realCredentialEnv(t, initial);
  const handlers = new Map();
  const broadcasts = [];
  const listeners = new Set();
  let eventsPaused = false;
  const broadcast = (channel, value) => {
    broadcasts.push([channel, value]);
    if (!eventsPaused && channel === "enterprise-route-changed")
      for (const listener of listeners) listener(value);
  };
  const electron = {
    app: { getPath: () => "/tmp", getName: () => "test", getVersion: () => "0.0.0", on() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {}, removeHandler() {} },
    BrowserWindow: class {
      static getAllWindows() {
        return [];
      }
    },
    net: {
      fetch: () => {
        throw new Error("No network in route integration fixtures");
      },
    },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
    systemPreferences: { getMediaAccessStatus: () => "granted" },
    session: { fromPartition: () => ({}) },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return electron;
    if (parent?.filename === handlersPath && request === "./debugLogger") return anything();
    if (request === "./windowBroadcast") return { broadcastToWindows: broadcast };
    return originalLoad.call(this, request, parent, isMain);
  };
  let Ctor;
  try {
    delete require.cache[handlersPath];
    Ctor = require(handlersPath);
  } finally {
    Module._load = originalLoad;
  }
  const target = {
    environmentManager: fixture.env,
    vertexAuthSourceReady: Promise.resolve(),
    credentials: { refresh() {} },
  };
  Ctor.prototype.setupHandlers.call(
    new Proxy(target, { get: (obj, key) => (key in obj ? obj[key] : anything()) })
  );
  return {
    ...fixture,
    broadcasts,
    handlers,
    target,
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pauseEvents: () => {
      eventsPaused = true;
    },
    resumeEvents: () => {
      eventsPaused = false;
    },
    deliver: (state) => {
      for (const listener of listeners) listener(state);
    },
    invoke: (name, input) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Missing production IPC handler: ${name}`);
      return handler({}, input);
    },
  };
}
module.exports = { enterpriseRouteIpc };
