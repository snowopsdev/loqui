// Production IPC handlers over the real in-memory environment transaction.
const Module = require("node:module");
const { realCredentialEnv } = require("./realCredentialEnv");
const handlersPath = require.resolve("../../../src/helpers/ipcHandlers");
function anything() {
  return new Proxy(function () {}, {
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
  const isolation = { unrelatedLoads: [], sweepStubCalls: 0, blockedDownloads: 0 };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return electron;
    if (parent?.filename === handlersPath) {
      if (request === "./windowBroadcast") return { broadcastToWindows: broadcast };
      if (request === "./enterpriseRouteFacts")
        return originalLoad.call(this, request, parent, isMain);
      // Only the actual enterprise handlers and environment/CAS writer are under
      // test. Every unrelated leaf stays isolated before import, during setup,
      // and through the awaited handler continuations, including delayed requires.
      if (request === "./urlAudioDownloader")
        return {
          sweepStaleTempArtifacts() {
            isolation.sweepStubCalls += 1;
          },
          download() {
            isolation.blockedDownloads += 1;
            throw new Error("Fixture blocks downloads");
          },
        };
      if (request.startsWith(".") || request === "fs") {
        isolation.unrelatedLoads.push(request);
        return anything();
      }
      if (/^(?:node:)?(?:child_process|http|https|net|tls|dgram)$/.test(request))
        throw new Error(`Forbidden enterprise fixture boundary: ${request}`);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[handlersPath];
  });
  delete require.cache[handlersPath];
  const Ctor = require(handlersPath);
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
    isolation,
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
