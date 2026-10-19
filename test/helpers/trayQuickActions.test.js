const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function loadTrayWithStubs(request, parent, isMain) {
  if (request === "electron")
    return {
      Tray: class {},
      Menu: { buildFromTemplate: (items) => items },
      nativeImage: { createFromBitmap: (bitmap, size) => ({ bitmap, size }) },
      app: {},
    };
  if (request === "./debugLogger") return { info: () => undefined, debug: () => undefined };
  if (request === "./dockManager") return {};
  if (request === "./i18nMain")
    return {
      i18nMain: { t: (key, options) => (options?.elapsed ? `${key}:${options.elapsed}` : key) },
    };
  return originalLoad.call(this, request, parent, isMain);
};
const TrayManager = require("../../src/helpers/tray");
Module._load = originalLoad;

function createTrayManager(calls, { dictating = false } = {}) {
  const trayManager = new TrayManager();
  trayManager.windowManager = {
    isDictationPanelVisible: () => false,
    isDictating: () => dictating,
    sendStartDictation: () => calls.push("start-dictation"),
    sendStopDictation: () => calls.push("stop-dictation"),
    sendOpenAssistantPanel: () => calls.push("assistant"),
    startManualMeeting: () => calls.push("meeting"),
  };
  return trayManager;
}

test("the tray menu leads with the dictation pill's quick actions", () => {
  const calls = [];
  const [listen, assistant, meeting, separator] =
    createTrayManager(calls).buildContextMenuTemplate();

  assert.deepEqual(
    [listen.label, assistant.label, meeting.label, separator.type],
    [
      "app.commandMenu.startListening",
      "app.commandMenu.askAssistant",
      "app.commandMenu.startMeetingRecording",
      "separator",
    ]
  );

  listen.click();
  assistant.click();
  meeting.click();
  // Listening and a meeting start in the main process; only the assistant needs
  // the renderer, which is the one that can open its panel.
  assert.deepEqual(calls, ["start-dictation", "assistant", "meeting"]);
});

test("the tray's listen item stops the recording it reflects", () => {
  const calls = [];
  const [listen] = createTrayManager(calls, { dictating: true }).buildContextMenuTemplate();

  assert.equal(listen.label, "app.commandMenu.stopListening");
  listen.click();
  assert.deepEqual(calls, ["stop-dictation"]);
});

test("the actual Linux tray paints the recording icon, tooltip and source-loss menu then restores idle", async (t) => {
  const tray = new TrayManager();
  t.after(() => tray.teardownMeetingNotification());
  tray.platform = "linux";
  const shown = [];
  tray.createNotificationClient = async () => null;
  tray.ElectronNotification = class {
    on() {}
    show() {
      shown.push(this);
    }
    close() {
      this.closed = true;
    }
  };
  const images = [],
    tooltips = [],
    menus = [];
  const base = {
    getSize: () => ({ width: 16, height: 16 }),
    toBitmap: () => Buffer.alloc(16 * 16 * 4),
  };
  tray.baseIcon = base;
  tray.tray = {
    setImage: (image) => images.push(image),
    setToolTip: (text) => tooltips.push(text),
    setContextMenu: (menu) => menus.push(menu),
  };
  tray.setMeetingPresence({ sessionId: "A", startedAt: 1000, interruption: null, quiet: false });
  const n = await tray._linuxNotification();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(n.fallback?.sessionId, "A");
  assert.equal(tooltips.at(-1), "tray.tooltipRecording");
  const i = (12 * 16 + 12) * 4;
  assert.deepEqual([...images[0].bitmap.subarray(i, i + 4)], [0x1f, 0x5a, 0xff, 0xff]);
  assert.match(menus.at(-1)[0].label, /^tray\.meetingRecording:/);
  assert.equal(menus.at(-1)[1].label, "tray.stopMeetingRecording");
  tray.setMeetingPresence({
    sessionId: "A",
    startedAt: 1000,
    interruption: "systemAudio",
    quiet: false,
  });
  assert.equal(menus.at(-1)[0].label, "tray.meetingRecordingSystemLost");
  tray.setMeetingPresence({ sessionId: "A", startedAt: 1000, interruption: "mic", quiet: false });
  assert.equal(menus.at(-1)[0].label, "tray.meetingRecordingMicLost");
  assert.equal(shown.length, 1, "liveness updates do not duplicate the resident notification");
  tray.setMeetingPresence(null);
  assert.equal(images.at(-1), base);
  assert.equal(tooltips.at(-1), "tray.tooltip");
  await tray.teardownMeetingNotification();
  assert.equal(shown[0].closed, true);
});

test("steady recording refreshes elapsed with one owned timer; replacement/end/destroy retire it", async (t) => {
  let now = 1000;
  const timers = new Map();
  let next = 0;
  const tray = new TrayManager({
    now: () => now,
    setInterval: (fn, ms) => {
      const id = ++next;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
  });
  tray.platform = "win32";
  t.after(() => tray.teardownMeetingNotification());
  const events = new Map();
  const menus = [];
  const stops = [];
  tray.windowManager = { requestStopMeetingRecording: (id) => stops.push(id) };
  tray.tray = {
    setToolTip() {},
    setContextMenu: (menu) => menus.push(menu),
    on: (event, fn) => events.set(event, fn),
  };
  tray.setupTrayEventHandlers();
  tray.setMeetingPresence({ sessionId: "A", startedAt: 1000 });
  assert.equal(timers.size, 1);
  const [firstId, first] = [...timers][0];
  assert.equal(first.ms, 1000);
  const initialStop = menus.at(-1)[1];
  now = 62000;
  first.fn();
  assert.equal(menus.length, 2, "refresh without a presence/window change");
  // The formatter sees the injected time, not a frozen first-menu timestamp.
  assert.equal(tray.buildContextMenuTemplate()[0].label, "tray.meetingRecording:1:01");
  menus.at(-1)[1].click();
  assert.deepEqual(stops, ["A"]);
  tray.setMeetingPresence({ sessionId: "A", startedAt: 1000, quiet: true });
  assert.equal([...timers.keys()][0], firstId, "liveness update does not restart timer");
  tray.setMeetingPresence({ sessionId: "B", startedAt: now });
  assert.equal(timers.has(firstId), false);
  assert.equal(timers.size, 1);
  const count = menus.length;
  first.fn();
  assert.equal(menus.length, count, "retired callback cannot touch replacement");
  initialStop.click();
  menus.at(-1)[1].click();
  assert.deepEqual(stops, ["A", "A", "B"], "old Stop retains exact old session; main rejects it");
  tray.setMeetingPresence(null);
  assert.equal(timers.size, 0);
  tray.setMeetingPresence({ sessionId: "C", startedAt: now });
  events.get("destroyed")();
  assert.equal(timers.size, 0);
  tray.tray = { setToolTip() {}, setContextMenu() {} };
  tray.updateTrayMenu();
  assert.equal(timers.size, 1, "replacement tray resumes only live recording");
  await tray.teardownMeetingNotification();
  assert.equal(timers.size, 0);
});
