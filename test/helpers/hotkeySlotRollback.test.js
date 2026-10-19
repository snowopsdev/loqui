const test = require("node:test");
const assert = require("node:assert/strict");

// Stub electron's globalShortcut before hotkeyManager loads so slot
// registration can run outside Electron. Accelerators containing "BAD"
// simulate an OS-level conflict.
const registered = new Map();
require.cache[require.resolve("electron")] = {
  exports: {
    globalShortcut: {
      register(accelerator, callback) {
        if (accelerator.includes("BAD") || registered.has(accelerator)) return false;
        registered.set(accelerator, callback);
        return true;
      },
      unregister(accelerator) {
        registered.delete(accelerator);
      },
      isRegistered(accelerator) {
        return registered.has(accelerator);
      },
      unregisterAll() {
        registered.clear();
      },
    },
    BrowserWindow: class {},
  },
};

const HotkeyManager = require("../../src/helpers/hotkeyManager.js");

const noop = () => {};

test.beforeEach(() => registered.clear());

test("atomic registerSlot failure keeps the slot's previous working hotkeys", async () => {
  const mgr = new HotkeyManager();

  const first = await mgr.registerSlot("meeting", "F7", noop, { atomic: true });
  assert.equal(first.success, true);
  assert.deepEqual(mgr.getSlotHotkeys("meeting"), ["F7"]);
  assert.equal(registered.has("F7"), true);

  const second = await mgr.registerSlot("meeting", "F7,Control+BAD", noop, { atomic: true });
  assert.equal(second.success, false);
  assert.deepEqual(mgr.getSlotHotkeys("meeting"), ["F7"]);
  assert.equal(registered.has("F7"), true, "previous hotkey must stay registered after rollback");
});

test("non-atomic registerSlot keeps the working subset and reports failures", async () => {
  const mgr = new HotkeyManager();

  const result = await mgr.registerSlot("meeting", "F7,Control+BAD", noop);
  assert.equal(result.success, true);
  assert.deepEqual(result.hotkeys, ["F7"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].hotkey, "Control+BAD");
});

test("re-registering a slot replaces its previous accelerators", async () => {
  const mgr = new HotkeyManager();

  await mgr.registerSlot("meeting", "F7", noop, { atomic: true });
  const result = await mgr.registerSlot("meeting", "F6,F5", noop, { atomic: true });
  assert.equal(result.success, true);
  assert.deepEqual(mgr.getSlotHotkeys("meeting"), ["F6", "F5"]);
  assert.equal(registered.has("F7"), false, "old accelerator must be unregistered");
  assert.equal(registered.has("F6"), true);
  assert.equal(registered.has("F5"), true);
});

test("onboarding acknowledgement reads the real registered slot and failed rebind cannot acknowledge B", async () => {
  const { bridgeFixture } = require("./harness/onboardingBridgeFixture");
  const f = bridgeFixture();
  const mgr = new HotkeyManager();
  f.manager.hotkeyManager = mgr;
  f.manager._cachedActivationMode = "tap";
  assert.equal(f.manager.getDictationBinding(), null, "constructor preference is not registration");
  const callback = f.manager.createHotkeyCallback();
  assert.equal(
    (await mgr.registerSlot("dictation", "F7", callback, { atomic: true })).success,
    true
  );
  assert.deepEqual(JSON.parse(JSON.stringify(f.manager.getDictationBinding())), {
    hotkey: "F7",
    activationMode: "tap",
  });
  assert.equal(
    (await mgr.registerSlot("dictation", "Control+BAD", callback, { atomic: true })).success,
    false
  );
  assert.equal(f.manager.getDictationBinding().hotkey, "F7");
  await f.setupApi.beginOnboardingDemo({ id: "ack", kind: "dictation" });
  await callback("F7");
  const take = f.manager._onboardingDemoSession;
  assert.equal(take.origin, "hotkey");
  assert.equal(take.binding.hotkey, "F7");
  await f.setupApi.toggleOnboardingDemo("ack");
  assert.equal(
    f.manager._onboardingDemoSession.origin,
    "button",
    "a UI toggle never borrows a preceding press"
  );
});
