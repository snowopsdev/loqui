const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const { createHotkeyLeases } = require("../../src/helpers/hotkeyLeases");
const handlersPath = require.resolve("../../src/helpers/ipcHandlers");

function anything() {
  return new Proxy(function () {}, {
    get: (_, key) =>
      key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : anything(),
    apply: () => anything(),
  });
}

function fixture() {
  const handlers = new Map();
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (/^(node:)?(child_process|http|https|net|tls|dgram)$/.test(request))
      throw new Error(`Forbidden fixture boundary: ${request}`);
    if (request === "electron")
      return { ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} } };
    if (parent?.filename === handlersPath && request.startsWith(".")) return anything();
    return originalLoad.call(this, request, parent, isMain);
  };
  let IPCHandlers;
  try {
    delete require.cache[handlersPath];
    IPCHandlers = require(handlersPath);
  } catch (error) {
    Module._load = originalLoad;
    throw error;
  }
  const registered = new Map();
  const pending = [];
  const hm = {
    registerSlot: (slot, accelerator, callback) =>
      new Promise((resolve) =>
        pending.push(() => {
          registered.set(slot, callback);
          resolve({ success: true });
        })
      ),
    unregisterSlot: (slot) => registered.delete(slot),
  };
  const timers = new Map();
  let timerId = 0;
  const hotkeyLeases = createHotkeyLeases({
    hotkeyManager: hm,
    setTimer: (fn) => (timers.set(++timerId, fn), timerId),
    clearTimer: (id) => timers.delete(id),
  });
  const contents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    send: (...args) => messages.push(args),
  });
  const messages = [];
  const target = {
    windowManager: { hotkeyManager: hm, hotkeyLeases, mainWindow: { webContents: contents } },
  };
  try {
    IPCHandlers.prototype.setupHandlers.call(
      new Proxy(target, { get: (obj, key) => (key in obj ? obj[key] : anything()) })
    );
  } finally {
    Module._load = originalLoad;
  }
  return {
    target,
    contents,
    messages,
    registered,
    pending,
    timers,
    invoke: (name, ...args) => {
      assert.ok(handlers.has(name), `missing production handler ${name}`);
      return handlers.get(name)({ sender: contents }, ...args);
    },
    handlers,
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const [name, event] of [
  ["destroyed", []],
  ["render-process-gone", []],
  ["did-start-navigation", [{ isMainFrame: true, isSameDocument: false }]],
]) {
  test(`IPC ${name} releases registered and pending pill leases without React`, async () => {
    const f = fixture();
    const first = f.invoke("acquire-pill-hotkey", "undoCancel");
    await tick();
    f.pending.shift()();
    const held = await first;
    f.registered.get("temp:undoCancel")();
    assert.deepEqual(f.messages.at(-1), [
      "pill-hotkey-pressed",
      { slot: "undoCancel", leaseId: held.leaseId },
    ]);
    const second = f.invoke("acquire-pill-hotkey", "noticePrimary");
    await tick();
    assert.equal(f.contents.listenerCount(name), 1, "one watch per webContents");
    f.contents.emit(name, ...event);
    f.pending.shift()();
    assert.equal((await second).held, false);
    await tick();
    assert.equal(f.registered.size, 0);
    assert.ok(
      f.messages.some(
        ([channel, payload]) =>
          channel === "pill-hotkey-released" && payload.leaseId === held.leaseId
      )
    );
  });
}

test("IPC rejects arbitrary accelerators, meeting-only slots and other renderers; release is owner scoped", async () => {
  const f = fixture();
  for (const slot of ["meetingAccept", "Alt+Z", "toString"])
    assert.equal((await f.invoke("acquire-pill-hotkey", slot)).held, false);
  assert.equal(
    (await f.handlers.get("acquire-pill-hotkey")({ sender: { id: 8 } }, "undoCancel")).held,
    false
  );
  const pending = f.invoke("acquire-pill-hotkey", "undoCancel");
  await tick();
  f.pending.shift()();
  const { leaseId } = await pending;
  await f.handlers.get("release-pill-hotkey")({ sender: { id: 8 } }, leaseId);
  assert.equal(f.registered.size, 1);
  f.contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  f.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  assert.equal(f.target.windowManager.hotkeyLeases.isHeld(leaseId), true);
  await f.invoke("release-pill-hotkey", leaseId);
  await tick();
  assert.equal(f.registered.size, 0);
});

test("IPC main TTL notifies the exact held lease", async () => {
  const f = fixture();
  const acquire = f.invoke("acquire-pill-hotkey", "undoCancel");
  await tick();
  f.pending.shift()();
  const held = await acquire;
  [...f.timers.values()].forEach((expire) => expire());
  assert.deepEqual(f.messages.at(-1), [
    "pill-hotkey-released",
    { slot: "undoCancel", leaseId: held.leaseId },
  ]);
  await tick();
  assert.equal(f.registered.size, 0);
});

for (const event of ["destroyed", "render-process-gone", "did-start-navigation"]) {
  test(`Escape has owner cleanup on ${event}, including a pending registration`, async () => {
    const f = fixture();
    const pending = f.invoke("register-cancel-hotkey", "Escape");
    await tick();
    f.contents.emit(event, { isMainFrame: true, isSameDocument: false });
    f.pending.shift()();
    const result = await pending;
    await tick();
    assert.equal(result.success, false);
    assert.equal(f.registered.size, 0);
  });
}

test("IPC cannot report held after TTL wins the backend-answer/reply race", async () => {
  const f = fixture();
  const pending = f.invoke("acquire-pill-hotkey", "undoCancel");
  await tick();
  f.pending.shift()();
  queueMicrotask(() => [...f.timers.values()].forEach((expire) => expire()));
  const result = await pending;
  assert.equal(result.held, false);
  assert.equal(result.reason, "released");
  await tick();
  assert.equal(f.registered.size, 0);
});

test("Escape owner loss cannot let a late registration unregister a new owner's shortcut", async () => {
  const f = fixture();
  const first = f.invoke("register-cancel-hotkey", "Escape");
  await tick();
  f.contents.emit("render-process-gone");
  const replacementContents = Object.assign(new EventEmitter(), {
    id: 8,
    isDestroyed: () => false,
    send() {},
  });
  f.target.windowManager.mainWindow = { webContents: replacementContents };
  const second = f.handlers.get("register-cancel-hotkey")(
    { sender: replacementContents },
    "Escape"
  );
  f.pending.shift()();
  assert.equal((await first).success, false);
  await tick();
  assert.equal(f.registered.size, 0);
  f.pending.shift()();
  assert.equal((await second).success, true);
  f.contents.emit("destroyed");
  await f.invoke("unregister-cancel-hotkey");
  assert.equal(f.registered.size, 1);
  await f.handlers.get("unregister-cancel-hotkey")({ sender: replacementContents });
  assert.equal(f.registered.size, 0);
});
