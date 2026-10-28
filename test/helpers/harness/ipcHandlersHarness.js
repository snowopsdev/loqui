const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

// Registers the REAL ipcHandlers.js channels, the way main.js does
// (`new IPCHandlers(managers)`, whose constructor runs setupHandlers), against
// an Electron stub the caller supplies. Every module the handlers require is
// the real one, except:
// - `electron` (the stub);
// - the caller's named terminal leaves (`leaves`: request -> module), which
//   are the transport/native/SDK boundaries a test is allowed to fake;
// - `./urlAudioDownloader` from ipcHandlers, which the safety chain lets only
//   test/helpers/urlAudioDownloader.test.js load (URL import is driven there);
// - `./debugLogger`, silenced so no log file is written.
// `managers` may be a function of the stub. Managers that a test does not
// supply stay undefined: a handler that needs
// one fails loudly instead of resolving to a recursive no-op.
const handlersPath = require.resolve("../../../src/helpers/ipcHandlers");

function fakeEvent({ id = 1, url = "file:///loqui/index.html", sent = [] } = {}) {
  const mainFrame = { url };
  const sender = {
    id,
    mainFrame,
    send: (channel, payload) => sent.push([channel, payload]),
    isDestroyed: () => false,
    once() {},
    on() {},
    removeListener() {},
    getURL: () => url,
  };
  return { sender, senderFrame: mainFrame };
}

// For UI/OS managers that are not an egress, credential or config authority
// (windows, clipboard, key listeners, meeting detection). A test names each one
// explicitly; nothing falls back to this implicitly.
function inertUi() {
  return new Proxy(function () {}, {
    get: (_target, key) => {
      if (key === "then") return undefined;
      if (key === Symbol.toPrimitive || key === "toString") return () => "";
      if (key === Symbol.iterator) return function* () {};
      return inertUi();
    },
    apply: () => inertUi(),
    construct: () => inertUi(),
  });
}

const quietLogger = new Proxy(
  {},
  { get: (_target, key) => (key === "then" ? undefined : () => {}) }
);

function electronStub({ userData, overrides: { app: appOverrides, ...overrides } = {} }) {
  const handlers = new Map();
  const listeners = new Map();
  const stub = {
    app: {
      getPath: (name) => {
        const dir = path.join(userData, name === "userData" ? "" : name);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      },
      getAppPath: () => process.cwd(),
      getName: () => "loqui-matrix",
      getVersion: () => "0.0.0",
      getLocale: () => "en",
      isPackaged: false,
      isReady: () => false,
      on() {},
      requestSingleInstanceLock: () => true,
      ...appOverrides,
    },
    ipcMain: {
      handle: (channel, fn) => {
        if (handlers.has(channel)) throw new Error(`Duplicate IPC handler: ${channel}`);
        handlers.set(channel, fn);
      },
      on: (channel, fn) => listeners.set(channel, fn),
      removeHandler: (channel) => handlers.delete(channel),
      removeListener() {},
    },
    BrowserWindow: class BrowserWindow {
      static getAllWindows() {
        return [];
      }
      static fromWebContents() {
        return null;
      }
      static getFocusedWindow() {
        return null;
      }
    },
    shell: {},
    dialog: {},
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
    systemPreferences: { getMediaAccessStatus: () => "granted" },
    session: { fromPartition: () => ({}), defaultSession: {} },
    clipboard: {},
    nativeImage: {},
    globalShortcut: {},
    utilityProcess: {},
    Notification: class Notification {
      static isSupported() {
        return false;
      }
    },
    MessageChannelMain: class {},
    ...overrides,
  };
  return { stub, handlers, listeners };
}

function loadIpcHandlers({ electron = {}, managers = {}, construct = true, leaves = {} } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-ipc-harness-"));
  const { stub, handlers, listeners } = electronStub({ userData, overrides: electron });
  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === "electron") return stub;
    if (Object.prototype.hasOwnProperty.call(leaves, request)) return leaves[request];
    if (parent?.filename === handlersPath) {
      if (request === "./debugLogger") return quietLogger;
      if (request === "./urlAudioDownloader")
        return {
          sweepStaleTempArtifacts() {},
          download() {
            throw new Error("URL import is driven in urlAudioDownloader.test.js");
          },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[handlersPath];
  let instance = null;
  try {
    const IPCHandlers = require(handlersPath);
    const Ctor = IPCHandlers.default || IPCHandlers;
    // A function builds real managers after the Electron stub is in place,
    // the way main.js constructs them before `new IPCHandlers`.
    const resolved = typeof managers === "function" ? managers(stub) : managers;
    if (construct) instance = new Ctor(resolved);
    else Ctor.prototype.setupHandlers.call(resolved);
  } catch (error) {
    Module._load = originalLoad;
    throw error;
  }
  return {
    electron: stub,
    userData,
    instance,
    handlers,
    listeners,
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for ${channel}`);
      return handler(fakeEvent(), ...args);
    },
    invokeWith(event, channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for ${channel}`);
      return handler(event, ...args);
    },
    send(channel, ...args) {
      const listener = listeners.get(channel);
      if (!listener) throw new Error(`No listener registered for ${channel}`);
      return listener(fakeEvent(), ...args);
    },
    channels: () => [...handlers.keys()],
    listenerChannels: () => [...listeners.keys()],
    restore() {
      try {
        instance?._stopKeyReminders?.();
        if (instance?._retentionCleanupInterval) clearInterval(instance._retentionCleanupInterval);
      } finally {
        Module._load = originalLoad;
        fs.rmSync(userData, { recursive: true, force: true });
      }
    },
  };
}

module.exports = { loadIpcHandlers, fakeEvent, quietLogger, inertUi };
