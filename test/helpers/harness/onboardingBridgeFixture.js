const { EventEmitter } = require("node:events");
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
function bridgeFixture({ localReasoning, admissionOwner = true, admissionTimeoutMs } = {}) {
  const handlers = new Map();
  const overlayListeners = new Map();
  const setupListeners = new Map();
  const sent = [];
  const broadcasts = [];
  const fakeOwner = { busy: false, reservation: null, take: null };
  let listening = false;
  const electron = {
    app: { on() {} },
    ipcMain: Object.assign(new EventEmitter(), { handle: (name, fn) => handlers.set(name, fn) }),
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
        process: { ...process, isMainFrame: true },
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
    ["./dictationLifecycle", "./hotkeyRepeatGate", "./rendererRequest"]
  );
  const manager = new WindowManager();
  manager.showDictationPanel = () => {};
  manager.hideDictationPanel = () => {};
  manager._hideNormalAppSurfaces = () => {};
  const overlay = {
    isDestroyed: () => false,
    webContents: Object.assign(new EventEmitter(), {
      id: 1,
      isDestroyed: () => false,
      isLoading: () => false,
      send: (name, payload) => {
        sent.push([name, payload]);
        if (name === "onboarding-demo-admission")
          queueMicrotask(() => overlayListeners.get(name)?.({}, payload));
        else overlayListeners.get(name)?.({}, payload);
      },
    }),
  };
  const setup = {
    isDestroyed: () => false,
    webContents: Object.assign(new EventEmitter(), {
      id: 2,
      isDestroyed: () => false,
      isLoading: () => false,
      send: (name, payload) => setupListeners.get(name)?.({}, payload),
    }),
  };
  manager.mainWindow = overlay;
  manager.controlPanelWindow = setup;
  const IPCHandlers = load("src/helpers/ipcHandlers.js", {
    electron,
    "./onboardingInputPolicy": policy,
    "./onboardingCleanupRelay": require("../../../src/helpers/onboardingCleanupRelay"),
    "./onboardingDemoAdmission": {
      createOnboardingDemoAdmission: (options) =>
        require("../../../src/helpers/onboardingDemoAdmission").createOnboardingDemoAdmission({
          ...options,
          ...(admissionTimeoutMs ? { timeoutMs: admissionTimeoutMs } : {}),
        }),
    },
    ...(localReasoning ? { "../services/localReasoningBridge": { default: localReasoning } } : {}),
    "./windowBroadcast": {
      broadcastToWindows: (name, payload) => {
        broadcasts.push([name, payload]);
        setup.webContents.send(name, payload);
      },
    },
  });
  const context = new Proxy(
    { windowManager: manager, _onboardingDemoSession: null, getPersonalInference: () => undefined },
    {
      get: (target, key) => (key in target ? target[key] : inert()),
    }
  );
  IPCHandlers.prototype.setupHandlers.call(context);
  function api(listeners, sender) {
    let exposed;
    load("preload.js", {
      electron: {
        contextBridge: {
          executeInMainWorld: () => {},
          exposeInMainWorld: (_, value) => {
            exposed = value;
          },
        },
        webUtils: {},
        ipcRenderer: {
          invoke: async (name, ...args) => {
            if (
              admissionOwner &&
              sender === overlay.webContents &&
              name === "onboarding-demo-publish"
            ) {
              const event = args[0];
              if (
                fakeOwner.take?.demoId === event?.demoId &&
                fakeOwner.take?.takeId === event?.takeId &&
                ["success", "error", "cancelled"].includes(event.status)
              )
                fakeOwner.busy = false;
            }
            return name.startsWith("onboarding-") ||
              name.startsWith("personal-inference:") ||
              name === "get-dictation-binding" ||
              name === "process-local-reasoning"
              ? handlers.get(name)?.({ sender }, ...args)
              : undefined;
          },
          on: (name, fn) => listeners.set(name, fn),
          removeListener: (name, fn) => {
            if (listeners.get(name) === fn) listeners.delete(name);
          },
          send(name, ...args) {
            if (["undo-cancel-reply", "dictation-flush-reply"].includes(name))
              electron.ipcMain.emit(name, { sender }, ...args);
          },
          sendSync() {},
        },
      },
    });
    return exposed;
  }
  const overlayApi = api(overlayListeners, overlay.webContents);
  if (admissionOwner) {
    // Main-only tests use an independent fake original overlay owner, never
    // main's cached lifecycle as an acknowledgement. Hook tests opt out.
    overlayApi.onOnboardingDemoAdmission((request) => {
      if (!fakeOwner.busy) fakeOwner.reservation = request;
      void overlayApi.replyOnboardingDemoAdmission({ ...request, accepted: !fakeOwner.busy });
    });
    const owns = (take) =>
      take &&
      fakeOwner.reservation?.demoId === take.demoId &&
      fakeOwner.reservation?.requestId === take.reservationId &&
      typeof take.takeId === "string";
    const prepare = (options) => {
      if (owns(options?.onboardingTake)) {
        fakeOwner.take = options.onboardingTake;
        fakeOwner.busy = true;
      }
    };
    overlayApi.onPrepareDictation(prepare);
    overlayApi.onStartDictation(prepare);
    overlayApi.onToggleDictation(prepare);
    const cancel = (options) => {
      if (owns(options?.onboardingTake) && fakeOwner.take?.takeId === options.onboardingTake.takeId)
        fakeOwner.busy = false;
    };
    overlayApi.onCancelDictationPreparation(cancel);
    overlayApi.onCancelDictation(cancel);
    overlayApi.onOnboardingDemoReservation((command) => {
      if (fakeOwner.reservation?.requestId === command.requestId && command.action === "release") {
        fakeOwner.reservation = null;
        fakeOwner.take = null;
        fakeOwner.busy = false;
      }
    });
  }
  return {
    manager,
    context,
    dispose: () => IPCHandlers.prototype.dispose.call(context),
    sent,
    broadcasts,
    overlayApi,
    overlayListeners,
    fakeOwner,
    deliver: (channel, payload) => overlayListeners.get(channel)?.({}, payload),
    setupApi: api(setupListeners, setup.webContents),
    handlers,
    overlaySender: overlay.webContents,
    setupSender: setup.webContents,
    setListening: (value) => {
      listening = value;
    },
  };
}
module.exports = { bridgeFixture };
