// Exercise actual WindowManager methods and onboarding IPC registration while
// keeping every unrelated setup/native/downloader/credential leaf inert until
// teardown. No constructor opens a window or touches a profile.
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const handlersPath = require.resolve("../../../src/helpers/ipcHandlers");
const windowsPath = require.resolve("../../../src/helpers/windowManager");
function anything() {
  return new Proxy(function () {}, {
    get: (_, key) =>
      key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : anything(),
    apply: () => anything(),
  });
}
function undoBridge(t) {
  const handlers = new Map();
  const broadcasts = [];
  const ipcMain = Object.assign(new EventEmitter(), {
    handle: (name, fn) => handlers.set(name, fn),
  });
  const electron = { ipcMain, app: { on() {} } };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return electron;
    if (parent?.filename === handlersPath || parent?.filename === windowsPath) {
      if (["./onboardingInputPolicy", "./rendererRequest"].includes(request))
        return originalLoad.call(this, request, parent, isMain);
      if (request === "./windowBroadcast")
        return { broadcastToWindows: (channel, value) => broadcasts.push([channel, value]) };
      if (request === "./urlAudioDownloader")
        return {
          sweepStaleTempArtifacts() {},
          download() {
            throw Error("No fixture downloads");
          },
        };
      if (request.startsWith(".") || request === "fs") return anything();
      if (/^(?:node:)?(?:child_process|http|https|net|tls|dgram)$/.test(request))
        throw Error(`Forbidden fixture boundary: ${request}`);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[handlersPath];
    delete require.cache[windowsPath];
  });
  delete require.cache[handlersPath];
  delete require.cache[windowsPath];
  const WindowManager = require(windowsPath);
  const IPCHandlers = require(handlersPath);
  const sent = [];
  const overlay = Object.assign(new EventEmitter(), {
    id: 41,
    isDestroyed: () => false,
    send: (...args) => sent.push(args),
  });
  const windowManager = Object.assign(Object.create(WindowManager.prototype), {
    mainWindow: { webContents: overlay },
    lastCancelledDictation: null,
  });
  const target = {
    windowManager,
    _onboardingDemoSession: {
      id: "demo-1",
      kind: "dictation",
      takeId: "take-A",
      sawListening: true,
    },
  };
  IPCHandlers.prototype.setupHandlers.call(
    new Proxy(target, { get: (obj, key) => (key in obj ? obj[key] : anything()) })
  );
  return {
    windowManager,
    overlay,
    sent,
    ipcMain,
    broadcasts,
    target,
    invoke: (name, event, sender = overlay) =>
      handlers.get(name)(
        { sender },
        name === "onboarding-demo-publish"
          ? {
              demoId: target._onboardingDemoSession?.id,
              takeId: target._onboardingDemoSession?.takeId,
              ...event,
            }
          : event
      ),
  };
}
module.exports = { undoBridge };
