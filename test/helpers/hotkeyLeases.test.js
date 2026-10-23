const assert = require("node:assert/strict");
const test = require("node:test");
const { installElectronStub } = require("./harness/electronStub");

installElectronStub();
const { createHotkeyLeases } = require("../../src/helpers/hotkeyLeases.js");

function fakeManager() {
  const registered = new Map();
  const log = [];
  const pending = [];
  return {
    log,
    registered,
    // Each registration resolves only when the test says so (KDE/GNOME await).
    registerSlot(slot, accelerator, callback) {
      log.push(`+${slot}:${accelerator}`);
      return new Promise((resolve) => {
        pending.push((ok = true) => {
          if (ok) registered.set(slot, callback);
          resolve(ok ? { success: true } : { success: false, reason: "conflict" });
        });
      });
    },
    unregisterSlot(slot) {
      log.push(`-${slot}`);
      registered.delete(slot);
    },
    settle(ok = true) {
      pending.shift()(ok);
    },
    pendingCount: () => pending.length,
  };
}

function fakeTimers() {
  let seq = 0;
  const timers = new Map();
  const delays = [];
  return {
    delays,
    setTimer: (fn, ms) => (delays.push(ms), timers.set(++seq, fn), seq),
    clearTimer: (id) => timers.delete(id),
    fireAll: () => [...timers.values()].forEach((fn) => fn()),
  };
}

const tick = () => new Promise((r) => setImmediate(r));

test("a lease is held only after main registers it, and the accelerator is main's", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const p = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  hm.settle();
  const r = await p;
  assert.equal(r.held, true);
  assert.deepEqual(hm.log, ["+temp:undoCancel:Alt+Z"]);
  assert.equal(leases.isHeld(r.leaseId), true);
});

test("released while registration is pending: the late registration is undone", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const p = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  leases.release(1); // lease ids start at 1; the renderer releases on unmount before the answer
  hm.settle(); // KDE/GNOME answer arrives after the release
  const r = await p;
  await tick();
  assert.equal(r.held, false);
  assert.equal(r.reason, "released");
  assert.equal(hm.registered.has("temp:undoCancel"), false);
});

test("a newer lease for the same slot is never unregistered by an older late result", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const first = leases.acquire({ slot: "noticePrimary", ownerId: 7, onPress() {} });
  const second = leases.acquire({ slot: "noticePrimary", ownerId: 7, onPress() {} });
  await tick();
  // The superseded first lease never reaches the backend; only the second registers.
  assert.equal(hm.pendingCount(), 1);
  hm.settle();
  assert.equal((await first).held, false);
  assert.equal((await second).held, true);
  assert.equal(hm.registered.has("temp:noticePrimary"), true);
});

test("the owner's renderer going away releases every lease it holds", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const a = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  hm.settle();
  const b = leases.acquire({ slot: "noticePrimary", ownerId: 7, onPress() {} });
  await tick();
  hm.settle();
  await Promise.all([a, b]);
  leases.releaseOwner(7);
  await tick();
  assert.equal(hm.registered.size, 0);
});

test("ttl is enforced by main and clamped per slot", async () => {
  const hm = fakeManager();
  const timers = fakeTimers();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...timers });
  const released = [];
  const p = leases.acquire({
    slot: "noticePrimary",
    ownerId: 7,
    ttlMs: 10 * 60_000,
    onPress() {},
    onRelease: (r) => released.push(r),
  });
  await tick();
  hm.settle();
  await p;
  assert.deepEqual(
    timers.delays,
    [60_000],
    "a ten-minute request is clamped to the slot's maximum"
  );
  timers.fireAll();
  await tick();
  assert.equal(hm.registered.has("temp:noticePrimary"), false);
  assert.deepEqual(released, ["ttl"], "the owner is told, so the UI stops showing ⌥↵");
});

test("a superseded or owner-lost lease tells its owner exactly once", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const released = [];
  const first = leases.acquire({
    slot: "undoCancel",
    ownerId: 7,
    onPress() {},
    onRelease: (r) => released.push(["a", r]),
  });
  await tick();
  hm.settle();
  await first;
  const second = leases.acquire({
    slot: "undoCancel",
    ownerId: 8,
    onPress() {},
    onRelease: (r) => released.push(["b", r]),
  });
  await tick();
  hm.settle();
  await second;
  leases.releaseOwner(8);
  leases.releaseOwner(8);
  assert.deepEqual(released, [
    ["a", "superseded"],
    ["b", "owner"],
  ]);
});

test("a conflict reports not held, so the UI hides the shortcut", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const p = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  hm.settle(false);
  const r = await p;
  assert.equal(r.held, false);
  assert.equal(r.reason, "conflict");
});

test("a press is delivered only while the lease is live; another owner cannot release it", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  let presses = 0;
  const p = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress: () => presses++ });
  await tick();
  hm.settle();
  const { leaseId } = await p;
  leases.release(leaseId, 99);
  hm.registered.get("temp:undoCancel")();
  assert.equal(presses, 1);
  leases.release(leaseId, 7);
  assert.equal(leases.isHeld(leaseId), false);
});

test("temporary slots never go to KGlobalAccel on KDE", async () => {
  const HotkeyManager = require("../../src/helpers/hotkeyManager.js");
  const kdeCalls = [];
  const manager = Object.assign(Object.create(HotkeyManager.prototype), {
    useKDE: true,
    kdeManager: { registerKeybinding: async () => kdeCalls.push("kde") },
    slots: new Map(),
    setupShortcuts: () => ({ success: true }),
  });
  await manager.registerSlot("temp:undoCancel", "Alt+Z", () => {});
  assert.deepEqual(kdeCalls, []);
  assert.equal(HotkeyManager.prototype.isTemporarySlot.call(manager, "cancel"), true);
  assert.equal(HotkeyManager.prototype.isTemporarySlot.call(manager, "temp:meetingAccept"), true);
  assert.equal(HotkeyManager.prototype.isTemporarySlot.call(manager, "dictation"), false);
});

test("an in-flight superseded registration is removed before its replacement starts", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  let oldPresses = 0;
  const first = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress: () => oldPresses++ });
  await tick();
  const second = leases.acquire({ slot: "undoCancel", ownerId: 8, onPress() {} });
  assert.equal(hm.pendingCount(), 1);
  hm.settle();
  await tick();
  assert.equal((await first).held, false);
  assert.equal(
    hm.registered.size,
    0,
    "stale backend registration is gone even if the next acquire conflicts"
  );
  assert.equal(hm.pendingCount(), 1);
  hm.settle(false);
  assert.equal((await second).held, false);
  assert.equal(oldPresses, 0);
  assert.equal(hm.registered.size, 0);
});

test("an older release never unregisters a replacement after its backend succeeds", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  const first = leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} });
  await tick();
  hm.settle();
  const old = await first;
  const second = leases.acquire({ slot: "undoCancel", ownerId: 8, onPress() {} });
  await tick();
  hm.settle();
  const replacement = await second;
  const log = [...hm.log];
  leases.release(old.leaseId);
  leases.releaseOwner(7);
  await tick();
  assert.deepEqual(hm.log, log);
  assert.equal(leases.isHeld(replacement.leaseId), true);
});

test("TTL during pending registration clears late success and only notifies once", async () => {
  const hm = fakeManager();
  const timers = fakeTimers();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...timers });
  const releases = [];
  const pending = leases.acquire({
    slot: "meetingAccept",
    ownerId: "main:meeting-prompt:1",
    onPress() {},
    onRelease: (reason) => releases.push(reason),
  });
  await tick();
  timers.fireAll();
  hm.settle();
  const result = await pending;
  leases.release(result.leaseId);
  leases.releaseOwner("main:meeting-prompt:1");
  assert.equal(result.held, false);
  assert.equal(hm.registered.size, 0);
  assert.deepEqual(releases, ["ttl"]);
});

test("backend exceptions and invalid slots cannot claim a held shortcut", async () => {
  const leases = createHotkeyLeases({
    hotkeyManager: {
      registerSlot: async () => {
        throw new Error("backend unavailable");
      },
      unregisterSlot() {},
    },
    ...fakeTimers(),
  });
  assert.equal(
    (await leases.acquire({ slot: "undoCancel", ownerId: 7, onPress() {} })).reason,
    "error"
  );
  assert.deepEqual(await leases.acquire({ slot: "toString", ownerId: 7, onPress() {} }), {
    leaseId: 0,
    held: false,
    reason: "error",
  });
});

test("onRelease can acquire a replacement without reviving the superseded caller", async () => {
  const hm = fakeManager();
  const leases = createHotkeyLeases({ hotkeyManager: hm, ...fakeTimers() });
  let nested;
  const first = leases.acquire({
    slot: "undoCancel",
    ownerId: 7,
    onPress() {},
    onRelease: () => {
      nested = leases.acquire({ slot: "undoCancel", ownerId: 9, onPress() {} });
    },
  });
  await tick();
  hm.settle();
  await first;
  const second = leases.acquire({ slot: "undoCancel", ownerId: 8, onPress() {} });
  await tick();
  hm.settle();
  const nestedResult = await nested;
  await tick();
  assert.equal(
    hm.pendingCount(),
    0,
    "latest reentrant acquire superseded the outer acquire before backend admission"
  );
  assert.equal((await second).held, false);
  assert.equal(leases.isHeld(nestedResult.leaseId), true);
});
