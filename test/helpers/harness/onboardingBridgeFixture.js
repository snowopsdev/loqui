const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function inert() {
  return new Proxy(function () {}, {
    get: (_, key) =>
      key === "then" ? undefined : key === Symbol.iterator ? function* () {} : inert(),
    apply: () => inert(),
    construct: () => inert(),
  });
}

// Complete production main/IPC/preload modules, with only Electron, unrelated
// services and window presentation replaced. No native listeners or user data.
function bridgeFixture() {
  const handlers = new Map();
  const overlayListeners = new Map();
  const setupListeners = new Map();
  const sent = [];
  const broadcasts = [];
  let listening = false;
  const electron = {
    app: { on() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
    screen: { on() {} },
  };
  function load(relative, dependencies, real = []) {
    const filename = path.resolve(__dirname, "../../..", relative);
    const module = { exports: {} };
    const requireReal = createRequire(filename);
    vm.runInNewContext(
      fs.readFileSync(filename, "utf8"),
      {
        module,
        exports: module.exports,
        process,
        Date,
        setTimeout,
        clearTimeout,
        require: (name) =>
          Object.hasOwn(dependencies, name)
            ? dependencies[name]
            : real.includes(name)
              ? requireReal(name)
              : inert(),
      },
      { filename }
    );
    return module.exports;
  }
  const policy = require("../../../src/helpers/onboardingInputPolicy");
  const WindowManager = load(
    "src/helpers/windowManager.js",
    {
      electron,
      "./onboardingInputPolicy": policy,
      "./windowConfig": { WINDOW_SIZES: { BASE: { width: 96, height: 96 } } },
      "./hotkeyManager": class {
        isInListeningMode() {
          return listening;
        }
      },
    },
    ["./dictationLifecycle", "./hotkeyRepeatGate"]
  );
  const manager = new WindowManager();
  manager.showDictationPanel = () => {};
  manager.hideDictationPanel = () => {};
  manager._hideNormalAppSurfaces = () => {};
  const overlay = {
    isDestroyed: () => false,
    webContents: {
      send: (name, payload) => {
        sent.push([name, payload]);
        overlayListeners.get(name)?.({}, payload);
      },
    },
  };
  const setup = {
    isDestroyed: () => false,
    webContents: {
      send: (name, payload) => setupListeners.get(name)?.({}, payload),
    },
  };
  manager.mainWindow = overlay;
  manager.controlPanelWindow = setup;
  const IPCHandlers = load("src/helpers/ipcHandlers.js", {
    electron,
    "./onboardingInputPolicy": policy,
    "./windowBroadcast": {
      broadcastToWindows: (name, payload) => {
        broadcasts.push([name, payload]);
        setup.webContents.send(name, payload);
      },
    },
  });
  const context = new Proxy(
    { windowManager: manager, _onboardingDemoSession: null },
    {
      get: (target, key) => (key in target ? target[key] : inert()),
    }
  );
  IPCHandlers.prototype.setupHandlers.call(context);
  const sender = { sender: overlay.webContents };
  function api(listeners) {
    let exposed;
    load("preload.js", {
      electron: {
        contextBridge: {
          exposeInMainWorld: (_, value) => {
            exposed = value;
          },
        },
        webUtils: {},
        ipcRenderer: {
          invoke: async (name, ...args) =>
            name.startsWith("onboarding-") ? handlers.get(name)?.(sender, ...args) : undefined,
          on: (name, fn) => listeners.set(name, fn),
          removeListener: (name, fn) => {
            if (listeners.get(name) === fn) listeners.delete(name);
          },
          send() {},
          sendSync() {},
        },
      },
    });
    return exposed;
  }
  return {
    manager,
    context,
    sent,
    broadcasts,
    overlayApi: api(overlayListeners),
    setupApi: api(setupListeners),
    setListening: (value) => {
      listening = value;
    },
  };
}
module.exports = { bridgeFixture };
