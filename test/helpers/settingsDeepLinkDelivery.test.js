const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

// Expiry timers that fire only when the test says so.
function manualTimers() {
  const due = new Set();
  return {
    setTimeout: (fn) => {
      const timer = { fn };
      due.add(timer);
      return timer;
    },
    clearTimeout: (timer) => due.delete(timer),
    fireAll: () => {
      for (const timer of [...due]) {
        due.delete(timer);
        timer.fn();
      }
    },
  };
}

const created = [];

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.document = null; // the page loaded right now, if any
    this.sent = []; // every main → renderer message, delivered or not
  }
  // Main → renderer: reaches only the current page, and only the listeners
  // it has registered so far.
  send(channel, payload) {
    this.sent.push({ channel, payload });
    this.document?.deliver(channel, payload);
  }
  setWindowOpenHandler() {}
  isCrashed() {
    return false;
  }
}

class FakeBrowserWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = new FakeWebContents();
    this.load = deferred();
    created.push(this);
  }
  loadFile() {
    return this.load.promise;
  }
  loadURL() {
    return this.load.promise;
  }
  isDestroyed() {
    return false;
  }
  isMinimized() {
    return false;
  }
  isVisible() {
    return true;
  }
  restore() {}
  show() {}
  focus() {}
  setTitle() {}
}

// Same stubbing as windowManagerMeetingNotification.test.js, plus what the
// control-panel path touches.
const managerPath = require.resolve("../../src/helpers/windowManager");
const handlersPath = require.resolve("../../src/helpers/ipcHandlers");
function anything() {
  return new Proxy(function () {}, {
    get: (_, key) =>
      key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : anything(),
    apply: () => anything(),
  });
}
const handlers = new Map();
const originalLoad = Module._load;
function loadWithStubs(request, parent, isMain) {
  if (/^(node:)?(child_process|http|https|net|tls|dgram)$/.test(request))
    throw new Error(`Forbidden fixture boundary: ${request}`);
  if (parent?.filename === handlersPath) {
    if (request === "./settingsLinks") return originalLoad.call(this, request, parent, isMain);
    if (request === "electron")
      return { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on() {} } };
    // Includes urlAudioDownloader's delayed require and sweep, before setup and through every await.
    if (request.startsWith(".") || request === "fs") return anything();
  }
  if (request === "electron") {
    return {
      app: { on: () => undefined },
      screen: { getPrimaryDisplay: () => ({}), on: () => undefined },
      BrowserWindow: FakeBrowserWindow,
      shell: {},
      dialog: {},
    };
  }
  if (request === "./debugLogger") return { info() {}, warn() {}, debug() {}, error() {} };
  if (request === "./hotkeyManager") {
    class FakeHotkeyManager {
      unregisterAll() {}
      isInListeningMode() {
        return false;
      }
    }
    FakeHotkeyManager.isGlobeLikeHotkey = () => false;
    return FakeHotkeyManager;
  }
  if (request === "./dragManager")
    return class FakeDragManager {
      cleanup() {}
    };
  if (request === "./menuManager") return { setupControlPanelMenu() {}, setupMainMenu() {} };
  if (request === "./devServerManager") {
    return {
      getAppFilePath: () => ({ path: __filename, query: {} }),
      getAppUrl: () => null,
      waitForDevServer: async () => {},
    };
  }
  if (request === "./dockManager") return { setControlPanelVisible() {} };
  if (request === "./i18nMain") return { i18nMain: { t: (key) => key } };
  if (request === "./windowConfig") {
    return {
      MAIN_WINDOW_CONFIG: {},
      CONTROL_PANEL_CONFIG: {},
      NOTIFICATION_WINDOW_CONFIG: {},
      WINDOW_SIZES: {},
      WindowPositionUtil: {},
    };
  }
  if (
    parent?.filename === managerPath &&
    request.startsWith(".") &&
    !["./settingsLinks", "./navigationGuard", "./dictationLifecycle"].includes(request)
  )
    return anything();
  return originalLoad.call(this, request, parent, isMain);
}
Module._load = loadWithStubs;
const WindowManager = require("../../src/helpers/windowManager");
Module._load = originalLoad;
const { createSettingsLinkQueue } = require("../../src/helpers/settingsLinks");

const PRELOAD = fs.readFileSync(path.join(__dirname, "../../preload.js"), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deepLink = () => import("../../src/utils/settingsDeepLink.ts");
// What main pushed on "show-settings", whether or not a page received it.
const showSettingsSends = (panel) =>
  panel.webContents.sent.filter((m) => m.channel === "show-settings").map((m) => m.payload);

function setup(t, { ttlMs, timers } = {}) {
  created.length = 0;
  handlers.clear();
  Module._load = loadWithStubs;
  t.after(() => {
    Module._load = originalLoad;
  });
  const manager = new WindowManager();
  if (ttlMs || timers) manager.settingsLinks = createSettingsLinkQueue({ ttlMs, timers });
  delete require.cache[handlersPath];
  const IPCHandlers = require(handlersPath);
  IPCHandlers.prototype.setupHandlers.call(
    new Proxy(
      { windowManager: manager },
      {
        get: (obj, key) => (key in obj ? obj[key] : anything()),
      }
    )
  );
  assert.ok(handlers.has("open-settings-at"), "production IPC setup registered settings links");
  t.after(() => manager._clearControlPanelVisibilityTimer());

  // A page that has loaded: a fresh preload with no listeners until the app
  // subscribes. invoke() reaches main's handlers with this window as sender.
  const loadDocument = (contents) => {
    const listeners = new Map();
    let api = null;
    const ipcRenderer = {
      invoke: async (channel, ...args) => handlers.get(channel)({ sender: contents }, ...args),
      on: (channel, listener) =>
        listeners.set(channel, [...(listeners.get(channel) ?? []), listener]),
      removeListener: (channel, listener) =>
        listeners.set(
          channel,
          (listeners.get(channel) ?? []).filter((l) => l !== listener)
        ),
      send() {},
      sendSync: () => undefined,
    };
    vm.runInNewContext(PRELOAD, {
      require: (specifier) => {
        if (specifier !== "electron")
          throw new Error(`Unexpected preload dependency: ${specifier}`);
        return {
          contextBridge: {
            executeInMainWorld: () => {},
            exposeInMainWorld: (_name, exposed) => (api = exposed),
          },
          ipcRenderer,
          webUtils: {},
        };
      },
      process: { ...process, isMainFrame: true },
    });
    contents.document = {
      deliver: (channel, payload) =>
        (listeners.get(channel) ?? []).forEach((listener) =>
          listener({ sender: contents }, payload)
        ),
    };
    return api;
  };
  // A reload begins: the old page and its listeners are gone.
  const unloadDocument = (contents) => {
    contents.document = null;
  };
  return { manager, handlers, loadDocument, unloadDocument };
}

test("a link sent while a new control panel loads opens once its subscriber mounts (I12)", async (t) => {
  const { subscribeSettingsDeepLinks } = await deepLink();
  const { manager, loadDocument } = setup(t);
  const opened = [];

  const result = manager.openSettings("llms/dictationCleanup");
  await flush();
  const [panel] = created;
  assert.ok(panel, "openSettings created the control panel");
  // The page loads and main sends, but React has not subscribed yet.
  const page = loadDocument(panel.webContents);
  panel.load.resolve();
  await flush();
  assert.deepEqual(opened, []);

  subscribeSettingsDeepLinks(page, (section) => opened.push(section));
  assert.deepEqual(await result, { delivered: true });
  await flush();
  assert.deepEqual(opened, ["llms/dictationCleanup"]);
});

test("a link sent while an existing control panel reloads opens in the reloaded page (I12)", async (t) => {
  const { subscribeSettingsDeepLinks } = await deepLink();
  const { manager, loadDocument, unloadDocument } = setup(t);
  const opened = [];
  const open = (section) => opened.push(section);

  // Mounting while the first request is both pending and being pushed
  // opens it once: the push and the mount check carry the same id.
  const first = manager.openSettings("privacyData");
  await flush();
  const [panel] = created;
  const page = loadDocument(panel.webContents);
  const unsubscribe = subscribeSettingsDeepLinks(page, open);
  panel.load.resolve();
  assert.deepEqual(await first, { delivered: true });
  await flush();
  // A loaded, subscribed panel gets the next request by push.
  assert.deepEqual(await manager.openSettings("llms/dictationCleanup"), { delivered: true });
  await flush();
  assert.deepEqual(opened, ["privacyData", "llms/dictationCleanup"]);

  // The panel reloads. The request arrives before the new page subscribes.
  unsubscribe();
  unloadDocument(panel.webContents);
  const during = manager.openSettings("general");
  await flush();
  assert.deepEqual(
    opened,
    ["privacyData", "llms/dictationCleanup"],
    "nothing reached the unloading page"
  );
  subscribeSettingsDeepLinks(loadDocument(panel.webContents), open);
  assert.deepEqual(await during, { delivered: true });
  await flush();
  assert.deepEqual(opened, ["privacyData", "llms/dictationCleanup", "general"]);
  assert.equal(created.length, 1, "the existing window was reused");
});

test("an unacknowledged link expires, and a page that mounts later does not open it", async (t) => {
  const { subscribeSettingsDeepLinks } = await deepLink();
  const { manager, loadDocument } = setup(t, { ttlMs: 20 });
  const result = manager.openSettings("llms/dictationCleanup");
  await flush();
  const [panel] = created;
  panel.load.resolve();
  assert.deepEqual(await result, { delivered: false, reason: "timeout" });

  const opened = [];
  subscribeSettingsDeepLinks(loadDocument(panel.webContents), (section) => opened.push(section));
  await flush();
  assert.deepEqual(opened, []);
});

test("a link that expires while a new control panel loads is never pushed or opened (I12 round 3)", async (t) => {
  const { subscribeSettingsDeepLinks } = await deepLink();
  const clock = manualTimers();
  const { manager, loadDocument } = setup(t, { timers: clock });
  const opened = [];

  const result = manager.openSettings("llms/dictationCleanup");
  const link = manager.settingsLinks.peek();
  await flush();
  const [panel] = created;
  // 15 s pass while the first page load is still pending.
  clock.fireAll();
  subscribeSettingsDeepLinks(loadDocument(panel.webContents), (section) => opened.push(section));
  await flush();
  // The load finishes, and the suspended openSettings call resumes.
  panel.load.resolve();
  assert.deepEqual(await result, { delivered: false, reason: "timeout" });
  await flush();
  assert.deepEqual(opened, []);
  assert.deepEqual(showSettingsSends(panel), [], "main pushed nothing for the expired request");

  // A push already in transit when the request expired opens nothing either.
  panel.webContents.send("show-settings", link);
  await flush();
  assert.deepEqual(opened, []);
});

test("a link replaced while a new control panel loads never opens after the newer one (I12 round 3)", async (t) => {
  const { subscribeSettingsDeepLinks } = await deepLink();
  const { manager, loadDocument } = setup(t);
  const opened = [];

  const first = manager.openSettings("privacyData");
  await flush();
  const [panel] = created;
  // The window already exists, so the newer call does not wait for the load.
  const newer = manager.openSettings("llms/dictationCleanup");
  subscribeSettingsDeepLinks(loadDocument(panel.webContents), (section) => opened.push(section));
  assert.deepEqual(await newer, { delivered: true });
  await flush();
  assert.deepEqual(opened, ["llms/dictationCleanup"]);

  // Only now does the first call's wait for the page load end.
  panel.load.resolve();
  assert.deepEqual(await first, { delivered: false, reason: "replaced" });
  await flush();
  assert.deepEqual(opened, ["llms/dictationCleanup"], "the page stays on the newer section");
  assert.deepEqual(
    showSettingsSends(panel).map((link) => link.path),
    ["llms/dictationCleanup"],
    "the replaced request was never pushed"
  );
  assert.equal(created.length, 1);
});

test("a newer link replaces an older one; only the control panel may read or acknowledge it", async (t) => {
  const { manager, handlers } = setup(t);
  const older = manager.settingsLinks.enqueue("privacyData");
  const newer = manager.settingsLinks.enqueue("llms/dictationCleanup");
  t.after(() => manager.settingsLinks.ack(newer.link.id));
  assert.deepEqual(await older.done, { delivered: false, reason: "replaced" });

  const stranger = { sender: new FakeWebContents() };
  assert.equal(await handlers.get("settings-link-pending")(stranger), null);
  assert.equal(await handlers.get("settings-link-ack")(stranger, newer.link.id), false);
  assert.deepEqual(manager.settingsLinks.peek(), newer.link);

  // Main normalises a path outside the grammar to "open Settings".
  const odd = manager.settingsLinks.enqueue("../x");
  t.after(() => manager.settingsLinks.ack(odd.link.id));
  assert.equal(odd.link.path, null);
});
