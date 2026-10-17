const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const registered = new Map();
const nativeCalls = [];
require.cache[require.resolve("electron")] = {
  loaded: true,
  exports: {
    app: {},
    globalShortcut: {
      register: (accelerator, callback) => {
        if (registered.has(accelerator)) return false;
        registered.set(accelerator, callback);
        return true;
      },
      unregister: (accelerator) => registered.delete(accelerator),
      isRegistered: (accelerator) => registered.has(accelerator),
    },
    BrowserWindow: class {},
  },
};
const HotkeyManager = require("../../src/helpers/hotkeyManager");
const { createHotkeyLeases, PILL_HOTKEY_ACCELERATORS } = require("../../src/helpers/hotkeyLeases");
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const desktop of ["KDE", "Gnome", "Hyprland"]) {
  test(`real HotkeyManager uses globalShortcut for every temporary slot on ${desktop}`, async () => {
    registered.clear();
    nativeCalls.length = 0;
    const manager = new HotkeyManager();
    manager[`use${desktop}`] = true;
    manager[`${desktop.toLowerCase()}Manager`] = {
      registerKeybinding: () => nativeCalls.push("register"),
      registerSlotKeybinding: () => nativeCalls.push("registerSlot"),
      unregisterKeybinding: () => nativeCalls.push("unregister"),
    };
    const leases = createHotkeyLeases({
      hotkeyManager: manager,
      setTimer: () => 1,
      clearTimer() {},
    });
    let presses = 0;
    for (const [slot, accelerator] of Object.entries(PILL_HOTKEY_ACCELERATORS)) {
      const lease = await leases.acquire({ slot, ownerId: 1, onPress: () => presses++ });
      assert.equal(lease.held, true);
      registered.get(accelerator)();
      leases.release(lease.leaseId);
      await tick();
      assert.equal(registered.has(accelerator), false);
    }
    assert.equal((await manager.registerSlot("cancel", "Escape", () => {})).success, true);
    manager.unregisterSlot("cancel");
    assert.equal(registered.size, 0);
    assert.equal(presses, 3);
    assert.deepEqual(nativeCalls, []);
  });
}

test("main window close uses its captured webContents owner for lease cleanup", async () => {
  // Only registerMainWindowEvents runs; no windows/native desktop are created.
  const Module = require("node:module");
  const windowManagerPath = require.resolve("../../src/helpers/windowManager");
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === windowManagerPath && request.startsWith(".")) {
      if (request === "./windowConfig") return { WINDOW_SIZES: { BASE: {} } };
      if (request === "./hotkeyManager") return HotkeyManager;
      if (request === "./hotkeyLeases") return { createHotkeyLeases };
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let WindowManager;
  try {
    WindowManager = require(windowManagerPath);
  } finally {
    Module._load = originalLoad;
  }
  const contents = { id: 71, send() {} };
  const win = Object.assign(new EventEmitter(), { webContents: contents });
  const released = [];
  const target = {
    mainWindow: win,
    hotkeyLeases: { releaseOwner: (id) => released.push(id) },
    dragManager: { cleanup() {} },
  };
  WindowManager.prototype.registerMainWindowEvents.call(target);
  contents.id = 72;
  win.emit("closed");
  assert.deepEqual(released, [71]);
});
