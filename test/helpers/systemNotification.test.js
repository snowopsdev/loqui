const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  normalizeSystemNotification,
  showSystemNotification,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
} = require("../../src/helpers/systemNotification");

function fakeNotificationClass({ supported = true } = {}) {
  const shown = [];
  class FakeNotification extends EventEmitter {
    static isSupported() {
      return supported;
    }
    constructor(options) {
      super();
      this.options = options;
    }
    show() {
      shown.push(this);
    }
  }
  return { FakeNotification, shown };
}

test("payloads are trimmed, capped and rejected when there is no title", () => {
  assert.equal(normalizeSystemNotification(null), null);
  assert.equal(normalizeSystemNotification({ title: "   " }), null);
  assert.equal(normalizeSystemNotification({ title: 42 }), null);
  const long = normalizeSystemNotification({ title: "t".repeat(500), body: "b".repeat(900) });
  assert.equal(long.title.length, MAX_TITLE_LENGTH);
  assert.equal(long.body.length, MAX_BODY_LENGTH);
  assert.deepEqual(normalizeSystemNotification({ title: " Audio stopped " }), {
    title: "Audio stopped",
    body: "",
  });
});

test("a valid payload shows one notification and click runs the focus handler", () => {
  const { FakeNotification, shown } = fakeNotificationClass();
  let clicks = 0;
  const result = showSystemNotification({
    Notification: FakeNotification,
    payload: { title: "Meeting audio stopped", body: "Check your output device." },
    prefs: { notificationsEnabled: true },
    onClick: () => clicks++,
  });
  assert.deepEqual(result, { success: true });
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].options, {
    title: "Meeting audio stopped",
    body: "Check your output device.",
  });
  shown[0].emit("click");
  assert.equal(clicks, 1);
});

test("the master notifications switch and unsupported platforms are honoured", () => {
  const { FakeNotification, shown } = fakeNotificationClass();
  assert.deepEqual(
    showSystemNotification({
      Notification: FakeNotification,
      payload: { title: "x" },
      prefs: { notificationsEnabled: false },
    }),
    { success: false, reason: "disabled" }
  );
  const unsupported = fakeNotificationClass({ supported: false });
  assert.deepEqual(
    showSystemNotification({ Notification: unsupported.FakeNotification, payload: { title: "x" } }),
    { success: false, reason: "unsupported" }
  );
  assert.deepEqual(showSystemNotification({ Notification: FakeNotification, payload: {} }), {
    success: false,
    reason: "invalid",
  });
  assert.equal(shown.length, 0);
});

test("the bridge is wired through preload and main", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  assert.match(
    read("preload.js"),
    /showSystemNotification: \(payload\) =>\s*ipcRenderer\.invoke\("show-system-notification", payload\)/
  );
  assert.match(read("src/helpers/ipcHandlers.js"), /ipcMain\.handle\("show-system-notification"/);
  assert.match(read("src/types/electron.ts"), /showSystemNotification\?: \(payload: \{/);
});

test("main notification clicks restore and focus the sending window", async () => {
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8");
  const start = source.indexOf('    ipcMain.handle("show-system-notification"');
  const end = source.indexOf('    ipcMain.handle("sync-notification-preferences"', start);
  const { FakeNotification, shown } = fakeNotificationClass();
  const sender = {};
  const calls = [];
  let destroyed = false;
  let handler;
  const context = {
    Notification: FakeNotification,
    showSystemNotification,
    windowManager: { notificationPrefs: { notificationsEnabled: true } },
    ipcMain: {
      handle: (_channel, callback) => {
        handler = callback;
      },
    },
    BrowserWindow: {
      fromWebContents: (contents) => {
        assert.equal(contents, sender);
        return {
          isDestroyed: () => destroyed,
          isMinimized: () => true,
          restore: () => calls.push("restore"),
          show: () => calls.push("show"),
          focus: () => calls.push("focus"),
        };
      },
    },
  };
  vm.runInNewContext(source.slice(start, end), context);
  await handler({ sender }, { title: "Audio stopped", actions: [{ text: "Untrusted" }] });
  assert.deepEqual(Object.keys(shown[0].options), ["title", "body"]);
  shown[0].emit("click");
  assert.deepEqual(calls, ["restore", "show", "focus"]);
  destroyed = true;
  await handler({ sender }, { title: "Audio stopped" });
  shown[1].emit("click");
  assert.equal(calls.length, 3);
  context.windowManager.notificationPrefs.notificationsEnabled = false;
  assert.deepEqual(await handler({ sender }, { title: "Audio stopped" }), {
    success: false,
    reason: "disabled",
  });
  assert.equal(shown.length, 2);
});
