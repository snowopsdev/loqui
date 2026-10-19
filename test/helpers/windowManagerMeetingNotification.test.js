const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const createdWindows = [];
let devServerWaitPromise = Promise.resolve();

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.loadDeferred = createDeferred();
    this.messages = [];
    this.loadUrlCount = 0;
    this.showCount = 0;
    this.ignoreMouseEvents = [];
    this.webContents = {
      send: (channel, payload) => this.messages.push({ channel, payload }),
    };
    createdWindows.push(this);
  }

  setContentProtection() {}

  setIgnoreMouseEvents(ignore, options) {
    this.ignoreMouseEvents.push({ ignore, options });
  }

  loadFile() {
    return this.loadDeferred.promise;
  }

  loadURL() {
    this.loadUrlCount += 1;
    return Promise.resolve();
  }

  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }

  isDestroyed() {
    return this.destroyed;
  }

  showInactive() {
    this.showCount += 1;
  }
}

class FakeHotkeyManager {
  unregisterAll() {}

  isInListeningMode() {
    return false;
  }
}
FakeHotkeyManager.isGlobeLikeHotkey = () => false;

class FakeDragManager {
  cleanup() {}
}

const originalLoad = Module._load;
Module._load = function loadWindowManagerWithStubs(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: { on: () => undefined },
      screen: { getPrimaryDisplay: () => ({}), on: () => undefined },
      BrowserWindow: FakeBrowserWindow,
      shell: {},
      dialog: {},
    };
  }
  if (request === "./debugLogger") {
    return {
      info: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      error: () => undefined,
    };
  }
  if (request === "./hotkeyManager") return FakeHotkeyManager;
  if (request === "./dragManager") return FakeDragManager;
  if (request === "./menuManager") return {};
  if (request === "./devServerManager") {
    return {
      DEV_SERVER_PORT: 5173,
      DEV_SERVER_URL: "http://localhost:5173",
      getAppFilePath: () => ({ path: "/app/index.html", query: {} }),
      waitForDevServer: () => devServerWaitPromise,
    };
  }
  if (request === "./dockManager") return {};
  if (request === "./i18nMain") return { i18nMain: { t: (key) => key } };
  if (request === "./windowConfig") {
    const notificationSize = { width: 392, height: 92 };
    return {
      MAIN_WINDOW_CONFIG: {},
      CONTROL_PANEL_CONFIG: {},
      NOTIFICATION_WINDOW_CONFIG: { ...notificationSize, acceptFirstMouse: true },
      WINDOW_SIZES: {},
      WindowPositionUtil: {
        getNotificationPosition: () => ({
          ...notificationSize,
          x: 1000 - notificationSize.width,
          y: 16,
        }),
        setupAlwaysOnTop: () => undefined,
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const WindowManager = require("../../src/helpers/windowManager");
const TrayManager = require("../../src/helpers/tray");
const { getNotificationTimeoutMs } = require("../../src/helpers/notificationTimer");
Module._load = originalLoad;

const notificationWindowFor = (index) => createdWindows[index];

function createNormalWindowManager() {
  const manager = new WindowManager();
  manager.setOnboardingActive(false);
  return manager;
}

function installFakeTimers() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let nextTimerId = 1;
  const timers = new Map();

  global.setTimeout = (callback, delay = 0) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timers.set(timerId, { callback, delay });
    return timerId;
  };
  global.clearTimeout = (timerId) => timers.delete(timerId);

  return {
    pendingCount: () => timers.size,
    pendingDelays: () => [...timers.values()].map(({ delay }) => delay),
    runDelay: (delay) => {
      for (const [timerId, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(timerId);
        timer.callback();
      }
    },
    runAll: () => {
      for (const [timerId, { callback }] of [...timers]) {
        timers.delete(timerId);
        callback();
      }
    },
    restore: () => {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    },
  };
}

test.beforeEach(() => {
  createdWindows.length = 0;
});

test("native push-to-talk force-stops after the safety timeout", () => {
  const timers = installFakeTimers();
  const manager = createNormalWindowManager();
  let starts = 0;
  let stops = 0;
  manager.showDictationPanel = () => undefined;
  manager.hideDictationPanel = () => undefined;
  manager.sendPrepareDictation = () => undefined;
  manager.sendCancelDictationPreparation = () => undefined;
  manager.sendStartDictation = () => {
    starts += 1;
  };
  manager.sendStopDictation = () => {
    stops += 1;
  };

  try {
    manager.startWindowsPushToTalk("F8");
    assert.deepEqual(
      timers.pendingDelays().sort((left, right) => left - right),
      [150, 300000]
    );

    timers.runDelay(150);
    assert.equal(starts, 1);
    timers.runDelay(300000);
    assert.equal(stops, 1);
    assert.equal(manager.winPushState, null);
  } finally {
    timers.restore();
  }
});

test("a failed activation-mode change preserves the cached mode", async () => {
  const manager = createNormalWindowManager();
  manager.hotkeyManager.setActivationMode = async () => false;

  assert.equal(await manager.setActivationModeCache("push"), false);
  assert.equal(manager.getActivationMode(), "tap");
});

test("a busy Assistant blocks its voice hotkey before native side effects", () => {
  const manager = createNormalWindowManager();
  const rendererChannels = [];
  let showCount = 0;
  let prepareCount = 0;
  manager.mainWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel) => rendererChannels.push(channel) },
  };
  manager.hotkeyManager = {
    isInListeningMode: () => false,
    unregisterAll: () => undefined,
  };
  manager.textEditMonitor = { captureTargetPid: () => Promise.resolve(null) };
  manager.selectionManager = { captureTarget: () => undefined };
  manager.showDictationPanel = () => {
    showCount += 1;
  };
  manager.sendPrepareDictation = () => {
    prepareCount += 1;
  };
  // Initial Assistant thinking happens before the response panel opens; busy
  // state must stand on its own during that part of the journey.
  manager._assistantPanelOpen = false;
  manager._assistantPanelBusy = true;

  manager.sendToggleVoiceAgent();
  // Before the panel opens there is no companion pill to show a plain
  // recording either, so the busy state blocks ordinary dictation too.
  manager.sendToggleDictation();

  assert.equal(showCount, 0);
  assert.equal(prepareCount, 0);
  assert.deepEqual(rendererChannels, []);

  // The open panel alone is not enough: until the companion window is live,
  // a recording would still be invisible, so the press only re-kicks its load.
  manager._assistantPanelOpen = true;
  let pillShowCalls = 0;
  manager.showAgentDictationPill = () => {
    pillShowCalls += 1;
  };
  manager.sendToggleDictation();

  assert.equal(showCount, 0);
  assert.deepEqual(rendererChannels, []);
  assert.equal(pillShowCalls, 1);

  manager._agentDictationPillReady = true;
  manager.agentDictationPillWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    webContents: { send: () => undefined },
  };
  manager.sendToggleDictation();

  assert.equal(showCount, 1);
  assert.equal(prepareCount, 1);
  assert.deepEqual(rendererChannels, ["toggle-dictation"]);
  assert.equal(pillShowCalls, 1);

  manager._assistantPanelBusy = false;
  manager.sendToggleVoiceAgent();

  assert.equal(showCount, 2);
  assert.equal(prepareCount, 2);
  assert.deepEqual(rendererChannels, ["toggle-dictation", "toggle-voice-agent"]);
});

test("push-to-talk dictation follows the companion pill's availability", () => {
  const manager = createNormalWindowManager();
  const rendererChannels = [];
  let showCount = 0;
  manager.mainWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel) => rendererChannels.push(channel) },
  };
  manager.hotkeyManager = {
    isInListeningMode: () => false,
    unregisterAll: () => undefined,
  };
  manager._dictationLifecycleState = "idle";
  manager._assistantPanelOpen = false;
  manager._assistantPanelBusy = true;
  manager.textEditMonitor = { captureTargetPid: () => Promise.resolve(null) };
  manager.selectionManager = { captureTarget: () => undefined };
  manager.showDictationPanel = () => {
    showCount += 1;
  };

  // Busy without an open panel: no surface could show the recording.
  manager.sendPrepareDictation();
  manager.sendStartDictation();

  assert.equal(showCount, 0);
  assert.deepEqual(rendererChannels, []);

  // An open panel whose companion window is not live yet keeps PTT dictation
  // blocked; each press re-kicks the companion load.
  manager._assistantPanelOpen = true;
  let pillShowCalls = 0;
  manager.showAgentDictationPill = () => {
    pillShowCalls += 1;
  };
  manager.sendPrepareDictation();
  manager.sendStartDictation();

  assert.equal(showCount, 0);
  assert.deepEqual(rendererChannels, []);
  assert.equal(pillShowCalls, 2);

  // With a live companion pill, PTT dictation flows again.
  manager._agentDictationPillReady = true;
  manager.agentDictationPillWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    webContents: { send: () => undefined },
  };
  manager.sendPrepareDictation();
  manager.sendStartDictation();

  assert.equal(showCount, 1);
  assert.deepEqual(rendererChannels, ["prepare-dictation", "start-dictation"]);
});

test("window manager starts fail-closed and suppresses normal-app popup surfaces", async () => {
  const manager = new WindowManager();

  assert.equal(manager.isMeetingInputAllowed(), false);
  assert.equal(await manager.showMeetingNotification({ detectionId: "onboarding" }), false);
  assert.equal(await manager.showTranscriptionPreview("partial transcript"), undefined);
  assert.deepEqual(createdWindows, []);
});

test("window creation uses the notification dimensions and position", async () => {
  const manager = createNormalWindowManager();
  const notification = { detectionId: "calendar:next", source: "calendar" };

  try {
    const showPromise = manager.showMeetingNotification(notification, { autoDismiss: false });
    const notificationWindow = createdWindows[0];

    assert.deepEqual(
      {
        acceptFirstMouse: notificationWindow.options.acceptFirstMouse,
        width: notificationWindow.options.width,
        height: notificationWindow.options.height,
        x: notificationWindow.options.x,
        y: notificationWindow.options.y,
      },
      { acceptFirstMouse: true, width: 392, height: 92, x: 608, y: 16 }
    );
    // The payload the overlay fetches is stored verbatim.
    assert.deepEqual(manager._pendingNotificationData, notification);

    notificationWindow.loadDeferred.resolve();
    await showPromise;
  } finally {
    manager.dismissMeetingNotification();
  }
});

test("a replaced deferred notification cannot send its payload to the newer window", async () => {
  const timers = installFakeTimers();
  const manager = createNormalWindowManager();
  let secondShowPromise;

  try {
    const firstShowPromise = manager.showMeetingNotification(
      { detectionId: "first" },
      { autoDismiss: false }
    );
    const firstWindow = createdWindows[0];
    secondShowPromise = manager.showMeetingNotification(
      { detectionId: "second" },
      { autoDismiss: false }
    );
    const secondWindow = createdWindows[1];

    firstWindow.loadDeferred.resolve();
    await firstShowPromise;
    timers.runAll();

    assert.deepEqual(secondWindow.messages, []);
    assert.equal(secondWindow.showCount, 0);
  } finally {
    createdWindows[1]?.loadDeferred.resolve();
    await secondShowPromise?.catch(() => undefined);
    manager.dismissMeetingNotification();
    timers.restore();
  }
});

test("canceling during a deferred load prevents later timers and timeout callbacks", async () => {
  const timers = installFakeTimers();
  const manager = createNormalWindowManager();
  let timeoutCount = 0;
  manager.meetingDetectionEngine = {
    handleNotificationTimeout: () => {
      timeoutCount += 1;
    },
  };
  const showPromise = manager.showMeetingNotification({ detectionId: "first" });
  const notificationWindow = createdWindows[0];

  try {
    manager.dismissMeetingNotification();
    notificationWindow.loadDeferred.reject(new Error("ERR_ABORTED"));

    await assert.doesNotReject(showPromise);
    timers.runAll();

    assert.equal(timeoutCount, 0);
    assert.deepEqual(notificationWindow.messages, []);
    assert.equal(notificationWindow.showCount, 0);
    assert.equal(manager.notificationWindow, null);
  } finally {
    await showPromise.catch(() => undefined);
    manager.dismissMeetingNotification();
    timers.restore();
  }
});

test("canceling while waiting for the dev server never loads the stale window", async () => {
  const timers = installFakeTimers();
  const manager = createNormalWindowManager();
  const originalNodeEnv = process.env.NODE_ENV;
  const devServerWait = createDeferred();
  devServerWaitPromise = devServerWait.promise;
  process.env.NODE_ENV = "development";

  try {
    const showPromise = manager.showMeetingNotification({ detectionId: "first" });
    const notificationWindow = createdWindows[0];
    manager.dismissMeetingNotification();
    devServerWait.resolve();

    await assert.doesNotReject(showPromise);
    assert.equal(notificationWindow.loadUrlCount, 0);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    devServerWaitPromise = Promise.resolve();
    manager.dismissMeetingNotification();
    timers.restore();
  }
});

test("a stale ready callback cannot show the replacement notification window", async () => {
  const timers = installFakeTimers();
  const manager = createNormalWindowManager();

  try {
    const firstShowPromise = manager.showMeetingNotification(
      { detectionId: "first" },
      { autoDismiss: false }
    );
    const firstWindow = createdWindows[0];
    firstWindow.loadDeferred.resolve();
    await firstShowPromise;

    const secondShowPromise = manager.showMeetingNotification(
      { detectionId: "second" },
      { autoDismiss: false }
    );
    const secondWindow = createdWindows[1];
    secondWindow.loadDeferred.resolve();
    await secondShowPromise;

    manager.showNotificationWindow(firstWindow.webContents);
    assert.equal(secondWindow.showCount, 0);

    manager.showNotificationWindow(secondWindow.webContents);
    assert.equal(secondWindow.showCount, 1);
  } finally {
    manager.dismissMeetingNotification();
    timers.restore();
  }
});

// The engine may raise the next queued prompt from its timeout handler, so that
// prompt must outlive the dismissal that closes the expired card.
test("a notification raised from the timeout handler survives the dismissal that follows", async () => {
  const timers = installFakeTimers();
  const manager = createNormalWindowManager();
  let replacementPromise = null;
  manager.meetingDetectionEngine = {
    handleNotificationTimeout: () => {
      replacementPromise = manager.showMeetingNotification(
        { detectionId: "calendar:next", source: "calendar" },
        { autoDismiss: false }
      );
    },
    handleDetectionNotificationClosed: () => undefined,
  };

  const showPromise = manager.showMeetingNotification({
    detectionId: "calendar:first",
    source: "calendar",
  });

  try {
    notificationWindowFor(0).loadDeferred.resolve();
    await showPromise;

    timers.runDelay(getNotificationTimeoutMs("calendar"));
    notificationWindowFor(1).loadDeferred.resolve();
    await replacementPromise;

    assert.equal(createdWindows.length, 2);
    assert.equal(notificationWindowFor(1).isDestroyed(), false);
    assert.equal(manager.notificationWindow, notificationWindowFor(1));
  } finally {
    manager.dismissMeetingNotification();
    timers.restore();
  }
});

test("unexpected detection card closure releases that detection", async () => {
  const manager = createNormalWindowManager();
  const closedDetections = [];
  manager.meetingDetectionEngine = {
    handleDetectionNotificationClosed: (detectionId) => closedDetections.push(detectionId),
  };

  const showPromise = manager.showMeetingNotification({
    detectionId: "audio:sustained-audio",
    source: "audio",
  });
  const notificationWindow = createdWindows[0];
  notificationWindow.loadDeferred.resolve();
  await showPromise;

  // A compositor window kill never reaches the renderer's response IPC.
  notificationWindow.close();

  assert.deepEqual(closedDetections, ["audio:sustained-audio"]);
});

test("an expired detection reports the timeout once, not also as a close", async () => {
  const timers = installFakeTimers();
  const manager = createNormalWindowManager();
  const closedDetections = [];
  let timeouts = 0;
  manager.meetingDetectionEngine = {
    handleDetectionNotificationClosed: (detectionId) => closedDetections.push(detectionId),
    handleNotificationTimeout: () => {
      timeouts += 1;
    },
  };

  const showPromise = manager.showMeetingNotification({
    detectionId: "audio:sustained-audio",
    source: "audio",
  });
  createdWindows[0].loadDeferred.resolve();
  await showPromise;

  try {
    timers.runDelay(30_000);
    assert.equal(timeouts, 1, "the countdown owns this dismissal");
    assert.deepEqual(closedDetections, [], "the close must not double-report the same card");
  } finally {
    manager.dismissMeetingNotification();
    timers.restore();
  }
});

test("a detection card whose load fails releases that detection", async () => {
  const manager = createNormalWindowManager();
  const closedDetections = [];
  manager.meetingDetectionEngine = {
    handleDetectionNotificationClosed: (detectionId) => closedDetections.push(detectionId),
  };

  const showPromise = manager.showMeetingNotification({
    detectionId: "audio:sustained-audio",
    source: "audio",
  });
  createdWindows[0].loadDeferred.reject(new Error("load failed"));

  // The card never appeared and no countdown ever started, so nothing else
  // would ever settle this detection.
  await assert.rejects(showPromise, /load failed/);
  assert.deepEqual(closedDetections, ["audio:sustained-audio"]);
});

test("manual meeting starts fail closed like the meeting hotkey", async () => {
  let starts = 0;
  const engine = { startManualMeeting: async () => (starts += 1) };

  const onboarding = new WindowManager();
  onboarding.meetingDetectionEngine = engine;
  await onboarding.startManualMeeting();
  assert.equal(starts, 0);

  const manager = createNormalWindowManager();
  manager.meetingDetectionEngine = engine;
  manager.hotkeyManager.isInListeningMode = () => true;
  await manager.startManualMeeting();
  assert.equal(starts, 0);

  manager.hotkeyManager.isInListeningMode = () => false;
  await manager.startManualMeeting();
  assert.equal(starts, 1);
});

// Only the renderer can open the assistant panel, and it owns the policy and
// recording state the pill menu gates the item on, so nothing may be shown,
// focused, or created before it accepts.
test("the tray's Ask assistant asks the renderer without showing or focusing the pill", () => {
  const fakeMainWindow = (events) => ({
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    focus: () => events.push("focus"),
    show: () => events.push("show"),
    showInactive: () => events.push("show"),
    webContents: { send: (channel) => events.push(channel) },
  });

  const onboardingEvents = [];
  const onboarding = new WindowManager();
  onboarding.mainWindow = fakeMainWindow(onboardingEvents);
  onboarding.sendOpenAssistantPanel();
  assert.deepEqual(onboardingEvents, []);

  const events = [];
  const manager = createNormalWindowManager();
  manager.mainWindow = fakeMainWindow(events);
  manager.sendOpenAssistantPanel();
  assert.deepEqual(events, ["open-assistant-panel"]);

  // Capturing a hotkey swallows it, like every other input path.
  const capturingEvents = [];
  const capturing = createNormalWindowManager();
  capturing.mainWindow = fakeMainWindow(capturingEvents);
  capturing.hotkeyManager.isInListeningMode = () => true;
  capturing.sendOpenAssistantPanel();
  assert.deepEqual(capturingEvents, []);
});

// D2: Stop and the click in the Linux notification reach the real window
// manager, bound to the session the notification was posted for.
test("the Linux notification stops and reveals only the session it was posted for (D2)", async () => {
  const manager = createNormalWindowManager();
  const toPanel = [];
  const toPill = [];
  manager.controlPanelWindow = {
    isDestroyed: () => false,
    webContents: { isLoading: () => false, send: (channel, data) => toPanel.push([channel, data]) },
  };
  manager.mainWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => false,
    showInactive: () => toPill.push("show"),
    webContents: { send: (channel, data) => toPill.push([channel, data]) },
  };
  const bus = new EventEmitter();
  const posted = [];
  const client = {
    capabilities: async () => ["actions", "body"],
    notify: async (o) => (posted.push(o), 41 + posted.length),
    close: async () => undefined,
    onAction: (cb) => bus.on("action", cb),
    onClosed: (cb) => bus.on("closed", cb),
    onDisconnect: (cb) => bus.on("disconnect", cb),
  };
  const tray = new TrayManager();
  tray.platform = "linux";
  tray.createNotificationClient = async () => client;
  tray.ElectronNotification = class extends EventEmitter {
    show() {}
    close() {}
  };
  tray.setWindowManager(manager);
  manager.onMeetingPresenceChanged = (presence) => tray.setMeetingPresence(presence);
  const stopRequests = () =>
    toPanel.filter(([channel]) => channel === "meeting-recording-stop-requested");

  manager.meetingPresence.set(7, { recording: true, sessionId: "m1", startedAt: 1000 });
  await until(() => posted.length === 1); // id 42 for m1
  bus.emit("action", 99, "stop"); // another app's notification
  bus.emit("action", 42, "stop");
  assert.deepEqual(stopRequests(), [["meeting-recording-stop-requested", "m1"]]);

  bus.emit("action", 42, "default"); // the click
  assert.deepEqual(toPill.slice(-2), ["show", ["meeting-recorder-reveal-requested", "m1"]]);

  manager.meetingPresence.set(7, { recording: false });
  manager.meetingPresence.set(7, { recording: true, sessionId: "m2", startedAt: 2000 });
  await until(() => posted.length === 2); // id 43 for m2
  bus.emit("action", 42, "stop"); // m1's notification is gone
  assert.equal(stopRequests().length, 1, "a stale notification id stops nothing");
  bus.emit("action", 43, "stop");
  assert.deepEqual(stopRequests().at(-1), ["meeting-recording-stop-requested", "m2"]);

  // The session ended before the Stop arrived: main's session check drops it.
  manager.meetingPresence.set(7, { recording: false });
  bus.emit("action", 43, "stop");
  bus.emit("action", 43, "default");
  assert.equal(stopRequests().length, 2);
  assert.equal(
    toPill.filter((entry) => entry[0] === "meeting-recorder-reveal-requested").length,
    1
  );
});

test("pending Linux client creation cannot post for an ended, replaced or shut-down meeting", async () => {
  for (const transition of ["ended", "replaced", "shutdown"]) {
    const clientReady = createDeferred();
    const posted = [];
    const tray = new TrayManager();
    tray.platform = "linux";
    tray.createNotificationClient = () => clientReady.promise;
    tray.ElectronNotification = class extends EventEmitter {
      show() {
        posted.push("fallback");
      }
      close() {}
    };
    tray.setMeetingPresence({ sessionId: "old", startedAt: 1000 });
    let shutdown;
    if (transition === "shutdown") shutdown = tray.teardownMeetingNotification();
    else {
      tray.setMeetingPresence(null);
      if (transition === "replaced") tray.setMeetingPresence({ sessionId: "new", startedAt: 2000 });
    }
    clientReady.resolve({
      capabilities: async () => ["actions"],
      notify: async (o) => (posted.push(o), 42),
      close: async () => {},
      onAction() {},
      onClosed() {},
      onDisconnect() {},
    });
    await tray._linuxNotification();
    if (shutdown) await shutdown;
    await settle();
    if (transition === "replaced") {
      assert.equal(posted.length, 1, "only the current meeting posts");
      const n = await tray._linuxNotification();
      assert.equal(n.current?.sessionId, "new");
    } else assert.deepEqual(posted, [], "not even a transient stale notification is posted");
    await tray.teardownMeetingNotification();
  }
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition) {
  for (let i = 0; i < 100 && !condition(); i++) await settle();
  assert.ok(condition(), "condition reached");
}

test("an old tray Stop item cannot stop the replacement meeting", () => {
  const manager = createNormalWindowManager();
  const sent = [];
  manager.sendToControlPanel = (...args) => sent.push(args);
  const tray = new TrayManager();
  tray.platform = "win32";
  tray.setWindowManager(manager);
  manager.onMeetingPresenceChanged = (p) => tray.setMeetingPresence(p);
  manager.meetingPresence.set(7, { recording: true, sessionId: "A", startedAt: 1000 });
  const oldStop = tray.buildContextMenuTemplate()[1];
  manager.meetingPresence.set(7, { recording: true, sessionId: "B", startedAt: 2000 });
  oldStop.click();
  assert.deepEqual(sent, []);
  tray.buildContextMenuTemplate()[1].click();
  assert.deepEqual(sent, [["meeting-recording-stop-requested", "B"]]);
});

function installMeetingIpc(t, manager) {
  const path = require.resolve("../../src/helpers/ipcHandlers");
  const original = Module._load;
  const handlers = new Map();
  const events = new Map();
  const isolation = { sweeps: 0 };
  const anything = () =>
    new Proxy(function () {}, {
      get: (_, key) =>
        key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : anything(),
      apply: () => anything(),
    });
  Module._load = function (request, parent, isMain) {
    if (request === "electron")
      return {
        app: { getPath: () => "/tmp", getName: () => "test", getVersion: () => "0", on() {} },
        ipcMain: {
          handle: (name, fn) => handlers.set(name, fn),
          on: (name, fn) => events.set(name, fn),
          removeHandler() {},
        },
        BrowserWindow: class {
          static getAllWindows() {
            return [];
          }
        },
        net: {
          fetch() {
            throw Error("fixture network forbidden");
          },
        },
        screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
        systemPreferences: {},
      };
    if (parent?.filename === path) {
      if (
        [
          "./meetingTranscriptionLifecycle",
          "./onboardingInputPolicy",
          "./dictationLifecycle",
          "./rendererRequest",
        ].includes(request)
      )
        return original.call(this, request, parent, isMain);
      if (request === "./urlAudioDownloader")
        return {
          sweepStaleTempArtifacts() {
            isolation.sweeps++;
          },
          download() {
            throw Error("fixture download forbidden");
          },
        };
      if (request.startsWith(".") || request === "fs") return anything();
      if (/^(?:node:)?(?:child_process|http|https|net|tls|dgram)$/.test(request))
        throw Error(`Forbidden fixture leaf: ${request}`);
    }
    return original.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = original;
    delete require.cache[path];
  });
  delete require.cache[path];
  const Ctor = require(path);
  Ctor.prototype.setupHandlers.call(
    new Proxy(
      { windowManager: manager, sessionId: "fixture" },
      { get: (obj, key) => (key in obj ? obj[key] : anything()) }
    )
  );
  assert.equal(isolation.sweeps, 1, "only the inert downloader sweep executes");
  return { handlers, events };
}

test("production IPC gates reports by exact control-panel sender, relays explicit outcomes and owner loss", async (t) => {
  const manager = createNormalWindowManager();
  const pill = [],
    panel = [],
    trayChanges = [],
    outcomes = [];
  const owner = new EventEmitter();
  owner.id = 7;
  owner.isLoading = () => false;
  owner.send = (...args) => panel.push(args);
  manager.controlPanelWindow = { isDestroyed: () => false, webContents: owner };
  manager.mainWindow = {
    isDestroyed: () => false,
    webContents: { send: (...args) => pill.push(args) },
  };
  manager.onMeetingPresenceChanged = (p) => trayChanges.push(p);
  manager.onMeetingOutcome = (o) => outcomes.push(o);
  const { handlers, events } = installMeetingIpc(t, manager);
  const presence = { recording: true, sessionId: "A", startedAt: 1000 };
  events.get("meeting-recording-presence")({ sender: { id: 7 } }, presence);
  events.get("meeting-recording-outcome")({ sender: {} }, { sessionId: "A", kind: "saved" });
  assert.equal(manager.getMeetingPresence(), null);
  assert.equal(outcomes.length, 0);
  events.get("meeting-recording-presence")({ sender: owner }, presence);
  events.get("meeting-recording-presence")({ sender: owner }, presence);
  assert.equal(owner.listenerCount("destroyed"), 1);
  assert.equal(trayChanges.length, 1);
  assert.equal(handlers.get("get-meeting-recording-presence")().sessionId, "A");
  await handlers.get("request-stop-meeting-recording")({}, "stale");
  await handlers.get("request-stop-meeting-recording")({}, "A");
  assert.deepEqual(panel, [["meeting-recording-stop-requested", "A"]]);
  events.get("meeting-recording-presence")({ sender: owner }, { recording: false });
  assert.equal(outcomes.length, 0, "presence ending cannot imply saved");
  const saved = { sessionId: "A", kind: "saved", durationMs: 1000, noteId: "11" };
  events.get("meeting-recording-outcome")({ sender: owner }, saved);
  assert.deepEqual(outcomes, [saved]);
  assert.deepEqual(pill.at(-1), ["meeting-recording-outcome", saved]);
  for (const event of ["destroyed", "render-process-gone", "did-start-navigation"]) {
    events.get("meeting-recording-presence")({ sender: owner }, { ...presence, sessionId: event });
    owner.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    assert.equal(manager.getMeetingPresence().sessionId, event);
    owner.emit(event, { isMainFrame: true, isSameDocument: false });
    assert.equal(manager.getMeetingPresence(), null);
    assert.deepEqual(outcomes.at(-1), { sessionId: event, kind: "failed", reason: "ownerLost" });
    const count = outcomes.length;
    owner.emit(event, { isMainFrame: true, isSameDocument: false });
    assert.equal(outcomes.length, count, "owner loss emits once");
  }
});

test("main's notification registration joins actual tray closure to bounded registry shutdown before exit", async (t) => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const main = fs.readFileSync(require.resolve("../../main.js"), "utf8");
  const registration = main.match(
    /sidecarRegistry\.register\("meetingNotification", \(\) => trayManager\.teardownMeetingNotification\(\)\);/
  );
  assert.ok(registration, "main registers the resident close with the awaited registry");
  const registryPath = require.resolve("../../src/helpers/sidecarRegistry");
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === registryPath && request === "./debugLogger") return { error() {} };
    return original.call(this, request, parent, isMain);
  };
  delete require.cache[registryPath];
  const sidecarRegistry = require(registryPath);
  Module._load = original;
  t.after(() => delete require.cache[registryPath]);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { createQuitCoordinator } = require("../../src/helpers/quitCoordinator");
  const closeReply = createDeferred();
  const calls = [];
  const trayManager = new TrayManager();
  trayManager.platform = "linux";
  trayManager.createNotificationClient = async () => ({
    capabilities: async () => ["actions"],
    notify: async () => 42,
    close: () => {
      calls.push("close");
      return closeReply.promise;
    },
    onAction() {},
    onClosed() {},
    onDisconnect() {},
  });
  trayManager.setMeetingPresence({ sessionId: "A", startedAt: 1000 });
  const notification = await trayManager._linuxNotification();
  await until(() => notification.current?.id === 42);
  vm.runInNewContext(registration[0], { sidecarRegistry, trayManager });
  const quit = createQuitCoordinator({
    flush: async () => {
      calls.push("flush");
      return true;
    },
    teardown: () => calls.push("teardown"),
    shutdown: () => sidecarRegistry.shutdownAll(),
    exit: () => calls.push("exit"),
  });
  quit({ preventDefault() {} });
  await until(() => calls.includes("close"));
  assert.equal(calls.includes("exit"), false, "actual resident CloseNotification is awaited");
  assert.deepEqual(calls, ["flush", "teardown", "close"]);
  closeReply.resolve();
  await until(() => calls.includes("exit"));
  assert.deepEqual(calls, ["flush", "teardown", "close", "exit"]);
  trayManager.setMeetingPresence({ sessionId: "B", startedAt: 2000 });
  assert.equal(trayManager.meetingPresence, null, "shutdown cannot restart notification ownership");
});

// Integrated I1 regression: actual Mount/store reports cross real IPC closures
// into the real WindowManager, while only write/Stop and unrelated leaves wait.
async function pendingTerminalFixture(t, phase) {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const {
    createRendererServer,
    installBrowserGlobals,
    installHookDom,
  } = require("../lib/rendererTestHarness");
  let root, serverCleanup, stopping;
  const write = createDeferred(),
    stop = createDeferred();
  // Run before IPC/browser restorers. Keep inert leaves through stop, unmount,
  // awaited Vite close and its cache removal, even when a RED assertion fails.
  t.after(async () => {
    write.resolve({ success: true });
    stop.resolve({ success: true });
    await React.act(async () => {
      await stopping;
      root?.unmount();
    });
    await serverCleanup?.();
  });
  const manager = createNormalWindowManager();
  const pill = [],
    outcomes = [],
    reports = [],
    rendererOutcomes = [],
    calls = [];
  const owner = new EventEmitter();
  owner.id = 7;
  owner.isLoading = () => false;
  owner.send = () => {};
  manager.controlPanelWindow = { isDestroyed: () => false, webContents: owner };
  manager.mainWindow = {
    isDestroyed: () => false,
    webContents: { send: (...args) => pill.push(args) },
  };
  const tray = new TrayManager();
  tray.platform = "win32";
  tray.setWindowManager(manager);
  manager.onMeetingPresenceChanged = (p) => tray.setMeetingPresence(p);
  manager.onMeetingOutcome = (outcome) => outcomes.push(outcome);
  const { events } = installMeetingIpc(t, manager);
  const api = {
    reportMeetingRecordingPresence: (p) => {
      reports.push(p);
      events.get("meeting-recording-presence")({ sender: owner }, p);
    },
    reportMeetingRecordingOutcome: (outcome) => {
      rendererOutcomes.push(outcome);
      events.get("meeting-recording-outcome")({ sender: owner }, outcome);
    },
    updateNote: () => {
      calls.push("write");
      return phase === "write" ? write.promise : Promise.resolve({ success: true });
    },
    meetingTranscriptionStop: () => {
      calls.push("stop");
      return phase === "stop" ? stop.promise : Promise.resolve({ success: true });
    },
  };
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(
    {
      after: (cb) => {
        serverCleanup = cb;
      },
    },
    {
      cachePrefix: "loqui-pending-meeting-result-",
      mockModules: {
        "/utils/logger": "export default {error(){},warn(){},info(){},debug(){}}",
        "/stores/settingsStore":
          "export const getSettings=()=>({});export const selectResolvedMeetingTranscription=()=>({});",
        "react-i18next": "const t=(key)=>key;export const useTranslation=()=>({t});",
        "/ui/notices": "export const notify=()=>'';export const dismissNotice=()=>{};",
      },
    }
  );
  const store = await vite.ssrLoadModule("/stores/meetingRecordingStore.ts");
  const Mount = (await vite.ssrLoadModule("/components/MeetingRecordingMount.tsx")).default;
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Mount)));
  await React.act(async () =>
    store.__primeRecordingForTests({
      sessionId: "A",
      noteId: 11,
      startedAt: 1000,
      segments: [{ id: "s", source: "mic", text: "hello" }],
    })
  );
  assert.equal(manager.getMeetingPresence()?.sessionId, "A");
  await React.act(async () => {
    stopping = store.stopRecording("A");
    await until(() => calls.includes("write") && calls.includes("stop"));
  });
  assert.equal(store.useMeetingRecordingStore.getState().isRecording, false);
  assert.equal(reports.at(-1).recording, false);
  assert.equal(reports.at(-1).sessionId, "A", "actual Mount scopes its false reports");
  assert.equal(manager.getMeetingPresence(), null, "pending ACKs cannot extend live presence");
  assert.equal(tray.meetingPresence, null, "tray truthfully returns idle before terminal ACKs");
  assert.equal(outcomes.length, 0);
  const finish = async () => {
    await React.act(async () => {
      write.resolve({ success: true });
      stop.resolve({ success: true });
      await stopping;
    });
  };
  return { manager, owner, events, outcomes, pill, tray, rendererOutcomes, finish };
}

for (const phase of ["write", "stop"]) {
  for (const loss of ["destroyed", "render-process-gone", "did-start-navigation"]) {
    test(`actual pending ${phase} ACK loses its terminal owner on ${loss} after false presence`, async (t) => {
      const f = await pendingTerminalFixture(t, phase);
      f.owner.emit(loss, { isMainFrame: true, isSameDocument: false });
      assert.deepEqual([...f.outcomes], [{ sessionId: "A", kind: "failed", reason: "ownerLost" }]);
      assert.deepEqual(f.pill.at(-1), ["meeting-recording-outcome", f.outcomes[0]]);
      f.owner.emit(loss, { isMainFrame: true, isSameDocument: false });
      await f.finish();
      assert.equal(f.rendererOutcomes[0].kind, "saved", "late renderer ACK path really completed");
      assert.equal(f.outcomes.length, 1, "late/duplicate ACK cannot revive an owner-lost session");
      assert.equal(f.manager.getMeetingPresence(), null);
      assert.equal(f.tray.meetingPresence, null);
    });
  }
}

test("actual acknowledged terminal outcome retires ownership before later owner loss", async (t) => {
  const f = await pendingTerminalFixture(t, "write");
  await f.finish();
  assert.equal(f.outcomes.length, 1);
  assert.equal(f.outcomes[0].kind, "saved");
  f.events.get("meeting-recording-outcome")({ sender: f.owner }, f.rendererOutcomes[0]);
  for (const loss of ["destroyed", "render-process-gone", "did-start-navigation"])
    f.owner.emit(loss, { isMainFrame: true, isSameDocument: false });
  assert.equal(f.outcomes.length, 1, "normal ACK then duplicates/loss cannot add ownerLost");
});

test("old owner A loss and late completion cannot settle or clear replacement B with the same numeric owner id", async (t) => {
  const f = await pendingTerminalFixture(t, "stop");
  const ownerB = new EventEmitter();
  ownerB.id = f.owner.id;
  f.manager.controlPanelWindow = { isDestroyed: () => false, webContents: ownerB };
  const input = { recording: true, sessionId: "B", startedAt: 2000 };
  f.events.get("meeting-recording-presence")({ sender: ownerB }, input);
  f.owner.emit("render-process-gone");
  assert.deepEqual([...f.outcomes], [{ sessionId: "A", kind: "failed", reason: "ownerLost" }]);
  assert.equal(f.manager.getMeetingPresence().sessionId, "B");
  await f.finish();
  f.events.get("meeting-recording-outcome")({ sender: ownerB }, f.rendererOutcomes[0]);
  f.events.get("meeting-recording-outcome")(
    { sender: f.owner },
    { sessionId: "B", kind: "failed", reason: "stop" }
  );
  f.owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  assert.equal(f.outcomes.length, 1);
  assert.equal(f.tray.meetingPresence.sessionId, "B");
  const bResult = { sessionId: "B", kind: "saved", durationMs: 1000, noteId: "12" };
  f.events.get("meeting-recording-presence")({ sender: ownerB }, { recording: false });
  f.events.get("meeting-recording-outcome")({ sender: ownerB }, { ...bResult, noteId: undefined });
  assert.equal(f.outcomes.length, 1, "malformed terminal reports retain pending ownership");
  f.events.get("meeting-recording-outcome")({ sender: ownerB }, bResult);
  f.events.get("meeting-recording-outcome")({ sender: ownerB }, bResult);
  ownerB.emit("destroyed");
  assert.deepEqual(
    [...f.outcomes],
    [{ sessionId: "A", kind: "failed", reason: "ownerLost" }, bResult]
  );
});

for (const lossBeforeAck of [true, false]) {
  test(`one exact owner keeps pending A and live B independent when loss is ${lossBeforeAck ? "before" : "after"} A's ACK`, async (t) => {
    const f = await pendingTerminalFixture(t, "write");
    f.events.get("meeting-recording-presence")(
      { sender: f.owner },
      { recording: true, sessionId: "B", startedAt: 2000 }
    );
    if (!lossBeforeAck) {
      await f.finish();
      assert.equal(f.outcomes.length, 1);
      assert.equal(f.outcomes[0].sessionId, "A");
      assert.equal(f.outcomes[0].kind, "saved");
      assert.equal(
        f.manager.getMeetingPresence().sessionId,
        "B",
        "A's result does not clear or settle B"
      );
    }
    f.owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    const expected = lossBeforeAck
      ? [
          { sessionId: "A", kind: "failed", reason: "ownerLost" },
          { sessionId: "B", kind: "failed", reason: "ownerLost" },
        ]
      : [f.outcomes[0], { sessionId: "B", kind: "failed", reason: "ownerLost" }];
    assert.deepEqual([...f.outcomes], expected);
    assert.equal(f.manager.getMeetingPresence(), null);
    await f.finish();
    f.events.get("meeting-recording-outcome")(
      { sender: f.owner },
      { sessionId: "B", kind: "saved", durationMs: 1000, noteId: "12" }
    );
    f.owner.emit("render-process-gone");
    assert.deepEqual(
      [...f.outcomes],
      expected,
      "every unfinished result settles once; late ACKs/duplicates retire nothing"
    );
  });
}
