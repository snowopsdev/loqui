const { ipcDownloaderLeaf } = require("./harness/ipcDownloaderLeaf");
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

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
  const downloader = ipcDownloaderLeaf(request, parent);
  if (downloader) return downloader;
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

let target;
test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  target = {
    sessionId: "test-session",
    _autoLearnEnabled: false,
    textEditMonitor: null,
    selectionManager: null,
  };
  Ctor.prototype.setupHandlers.call(
    new Proxy(target, {
      get: (value, property) => (property in value ? value[property] : anything()),
    })
  );
  assert.ok(handlers.get("paste-text"), "paste-text must be registered");
});

test.after(() => {
  Module._load = originalLoad;
});

test("paste-text reports an onboarding demo no-op without invoking the clipboard", async () => {
  let pasteCalls = 0;
  target.windowManager = { isOnboardingDemoActive: () => true };
  target.clipboardManager = {
    pasteText: async () => {
      pasteCalls += 1;
    },
  };

  const result = await handlers.get("paste-text")({ sender: {} }, "demo transcript");

  assert.deepEqual(result, { success: true, pasted: false });
  assert.equal(pasteCalls, 0);
});

test("paste-text reports pasted only after the clipboard paste completes", async () => {
  const pastes = [];
  target.windowManager = { isOnboardingDemoActive: () => false };
  target.clipboardManager = {
    pasteText: async (text, options) => {
      pastes.push({ text, options });
    },
  };

  const result = await handlers.get("paste-text")({ sender: { id: 1 } }, "normal transcript");

  assert.deepEqual(result, { success: true, pasted: true });
  assert.equal(pastes.length, 1);
});

test("paste-text preserves a clipboard-only fallback as not pasted", async () => {
  target.windowManager = { isOnboardingDemoActive: () => false };
  target.clipboardManager = {
    pasteText: async () => ({ pasted: false }),
  };

  const result = await handlers.get("paste-text")({ sender: { id: 1 } }, "manual transcript", {
    allowClipboardFallback: true,
  });

  assert.deepEqual(result, { success: true, pasted: false });
});

test("paste-text does not schedule AutoLearn monitoring after a clipboard-only fallback", async (t) => {
  const originalSetTimeout = global.setTimeout;
  t.after(() => {
    global.setTimeout = originalSetTimeout;
    target._autoLearnEnabled = false;
    target.textEditMonitor = null;
  });
  global.setTimeout = (callback) => {
    callback();
    return 1;
  };
  const monitored = [];
  target._autoLearnEnabled = true;
  target.textEditMonitor = {
    lastTargetPid: 42,
    activateTargetPid: async () => true,
    startMonitoring: (...args) => monitored.push(args),
  };
  target.windowManager = { isOnboardingDemoActive: () => false };
  target.clipboardManager = {
    pasteText: async () => ({ pasted: false }),
  };

  const result = await handlers.get("paste-text")({ sender: { id: 1 } }, "manual transcript", {
    allowClipboardFallback: true,
  });

  assert.deepEqual(result, { success: true, pasted: false });
  assert.deepEqual(monitored, []);
});

// Touch-up 3, O1: a sealed auto-paste settles as a typed result, never a
// rejection the renderer would show as main's text. `copiedToClipboard` is
// main's own statement that the text is on the clipboard.
test("paste-text settles a sealed refusal as a typed sealed result", async () => {
  const { SealedModeError } = require("../../src/helpers/privacy/egressPolicy");
  target.windowManager = { isOnboardingDemoActive: () => false };
  for (const copied of [true, false]) {
    target.clipboardManager = {
      pasteText: async () => {
        throw Object.assign(new SealedModeError({ task: "nativeLaunch", host: "native-xdotool" }), {
          copiedToClipboard: copied,
        });
      },
    };
    const result = await handlers.get("paste-text")({ sender: { id: 1 } }, "sealed words");
    assert.deepEqual(result, {
      success: false,
      pasted: false,
      code: "SEALED_MODE",
      phase: "refused",
      copiedToClipboard: copied,
    });
  }
  // Anything else still rejects as before.
  target.clipboardManager = {
    pasteText: async () => {
      throw new Error("xdotool exited with code 1");
    },
  };
  await assert.rejects(
    handlers.get("paste-text")({ sender: { id: 1 } }, "words"),
    /xdotool exited with code 1/
  );
});

test("paste-text still copies and pastes when the macOS target activation is refused", async (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  t.after(() => {
    Object.defineProperty(process, "platform", platform);
    target.textEditMonitor = null;
  });
  const { SealedModeError } = require("../../src/helpers/privacy/egressPolicy");
  target.textEditMonitor = {
    lastTargetPid: 42,
    // Activation runs osascript, which the spawn guard refuses while sealed.
    activateTargetPid: async () => {
      throw new SealedModeError({ task: "nativeLaunch", host: "native-osascript" });
    },
  };
  target.windowManager = { isOnboardingDemoActive: () => false, mainWindow: null };
  const pastes = [];
  target.clipboardManager = {
    pasteText: async (text) => {
      pastes.push(text);
    },
  };
  const result = await handlers.get("paste-text")({ sender: { id: 1 } }, "mac words");
  assert.deepEqual(result, { success: true, pasted: true });
  assert.equal(pastes.length, 1, "the clipboard step still ran");
});
