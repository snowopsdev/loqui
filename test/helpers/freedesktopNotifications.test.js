const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "./debugLogger") return { debug() {} };
  if (request === "@homebridge/dbus-native") throw Error("Never connect the host bus");
  return originalLoad.call(this, request, parent, isMain);
};
const { createFreedesktopClient } = require("../../src/helpers/freedesktopNotifications");
test.after(() => {
  Module._load = originalLoad;
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition) {
  for (let i = 0; i < 100 && !condition(); i++) await tick();
  assert.ok(condition(), "condition reached");
}
function fakeBus({ manualInterface = false, manualMatch = false } = {}) {
  const connection = new EventEmitter();
  connection.end = () => {
    connection.ended = true;
  };
  const signals = new EventEmitter();
  const calls = [];
  const matches = [];
  const interfaceReplies = [];
  const matchReplies = [];
  const methodReplies = new Map();
  const iface = {};
  for (const method of ["GetCapabilities", "Notify", "CloseNotification"]) {
    methodReplies.set(method, []);
    iface[method] = (...args) => {
      const cb = args.pop();
      calls.push([method, ...args]);
      methodReplies.get(method).push(cb);
    };
  }
  const bus = {
    connection,
    signals,
    // Exact bundled MessageBus forms: signal payload is one body array.
    mangle: (path, name, member) => JSON.stringify({ path, interface: name, member }),
    getService: (name) => {
      assert.equal(name, "org.freedesktop.Notifications");
      return {
        getInterface: (path, name, cb) => {
          assert.equal(path, "/org/freedesktop/Notifications");
          assert.equal(name, "org.freedesktop.Notifications");
          if (manualInterface) interfaceReplies.push(cb);
          else cb(null, iface);
        },
      };
    },
    addMatch: (match, cb) => {
      matches.push(match);
      if (manualMatch) matchReplies.push(cb);
      else cb(null);
    },
  };
  const emit = (member, body, owner = false) =>
    signals.emit(
      bus.mangle(
        owner ? "/org/freedesktop/DBus" : "/org/freedesktop/Notifications",
        owner ? "org.freedesktop.DBus" : "org.freedesktop.Notifications",
        member
      ),
      body
    );
  return {
    bus,
    calls,
    matches,
    interfaceReplies,
    matchReplies,
    methodReplies,
    iface,
    emit,
    create: () => createFreedesktopClient({ getDBus: () => ({ sessionBus: () => bus }) }),
  };
}

test("the real adapter waits for all AddMatch ACKs and encodes Notify variants/protocol/signals", async () => {
  const f = fakeBus({ manualMatch: true });
  let ready = false;
  const pending = f.create().then((client) => {
    ready = true;
    return client;
  });
  for (let i = 0; i < 3; i++) {
    await until(() => f.matchReplies.length === 1);
    assert.equal(ready, false);
    assert.equal(f.calls.length, 0, "cannot publish before subscriptions are ready");
    f.matchReplies.shift()(null);
  }
  const client = await pending;
  assert.equal(f.matches.length, 3);
  assert.ok(f.matches[0].includes("arg0='org.freedesktop.Notifications'"));
  const events = [];
  client.onAction((...args) => events.push(["action", ...args]));
  client.onClosed((...args) => events.push(["closed", ...args]));
  client.onDisconnect(() => events.push(["lost"]));
  const caps = client.capabilities();
  f.methodReplies.get("GetCapabilities").shift()(null, ["actions"]);
  assert.deepEqual(await caps, ["actions"]);
  const notify = client.notify({
    title: "Title",
    body: "Body",
    actions: ["default", "", "stop", "Stop"],
    hints: { resident: true, urgency: 1, category: "device" },
  });
  assert.deepEqual(f.calls.at(-1), [
    "Notify",
    "Loqui",
    0,
    "media-record",
    "Title",
    "Body",
    ["default", "", "stop", "Stop"],
    [
      ["resident", ["b", true]],
      ["urgency", ["y", 1]],
      ["category", ["s", "device"]],
    ],
    0,
  ]);
  f.methodReplies.get("Notify").shift()(null, 42);
  assert.equal(await notify, 42);
  f.emit("ActionInvoked", [42, "stop"]);
  f.emit("NotificationClosed", [42, 2]);
  f.emit("NameOwnerChanged", ["other.service", ":1.5", ""], true);
  assert.deepEqual(events, [
    ["action", 42, "stop"],
    ["closed", 42],
  ]);
  const closing = client.close(42);
  assert.deepEqual(f.calls.at(-1), ["CloseNotification", 42]);
  f.methodReplies.get("CloseNotification").shift()(null);
  await closing;
  f.emit("NameOwnerChanged", ["org.freedesktop.Notifications", ":1.5", ""], true);
  assert.deepEqual(events.at(-1), ["lost"]);
  await assert.rejects(client.capabilities(), /disconnected/);
});

for (const stage of [
  "connection-error",
  "end",
  "service-loss",
  "interface-error",
  "interface-throw",
  "match-error",
]) {
  test(`discovery safely fails on ${stage}, including before interface acquisition`, async () => {
    const f = fakeBus({ manualInterface: true, manualMatch: stage === "match-error" });
    if (stage === "interface-throw")
      f.bus.getService = () => {
        throw Error("discovery threw");
      };
    const creating = f.create();
    if (stage === "match-error") f.matchReplies.shift()(Error("match refused"));
    else if (stage === "connection-error") f.bus.connection.emit("error", Error("socket gone"));
    else if (stage === "end") f.bus.connection.emit("end");
    else if (stage === "service-loss")
      f.emit("NameOwnerChanged", ["org.freedesktop.Notifications", ":1.5", ""], true);
    else if (stage === "interface-error") {
      await until(() => f.interfaceReplies.length);
      f.interfaceReplies.shift()(Error("no service"));
    }
    assert.equal(await creating, null);
    assert.equal(f.bus.connection.ended, true);
    assert.equal(f.bus.signals.eventNames().length, 0);
    f.bus.connection.emit("error", Error("late socket error stays handled"));
  });
}

test("null/missing library and synchronous sessionBus failures return null", async () => {
  for (const getDBus of [
    () => null,
    () => {
      throw Error("load failed");
    },
    () => ({
      sessionBus() {
        throw Error("no bus");
      },
    }),
  ]) {
    assert.equal(await createFreedesktopClient({ getDBus }), null);
  }
});

for (const stage of ["AddMatch", "GetInterface"]) {
  test(`${stage} discovery times out at 5s with cleanup`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fakeBus({ manualInterface: true, manualMatch: stage === "AddMatch" });
    const pending = f.create();
    if (stage === "GetInterface") await until(() => f.interfaceReplies.length);
    t.mock.timers.tick(5000);
    assert.equal(await pending, null);
    assert.equal(f.bus.connection.ended, true);
    assert.equal(f.bus.signals.eventNames().length, 0);
  });
}

for (const method of ["GetCapabilities", "Notify", "CloseNotification"]) {
  test(`${method} rejects on callback error, throw, timeout, and connection loss`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fakeBus();
    const client = await f.create();
    const invoke = () =>
      method === "GetCapabilities"
        ? client.capabilities()
        : method === "CloseNotification"
          ? client.close(42)
          : client.notify({ title: "t", body: "b", actions: [], hints: { resident: true } });
    let result = invoke();
    let rejected = assert.rejects(result, /refused/);
    f.methodReplies.get(method).shift()(Error("refused"));
    await rejected;
    const original = f.iface[method];
    f.iface[method] = () => {
      throw Error("method threw");
    };
    await assert.rejects(invoke(), /method threw/);
    f.iface[method] = original;
    result = invoke();
    rejected = assert.rejects(result, /timed out/);
    t.mock.timers.tick(4999);
    let finished = false;
    void result.catch(() => {
      finished = true;
    });
    await Promise.resolve();
    assert.equal(finished, false);
    t.mock.timers.tick(1);
    await rejected;
    const late = f.methodReplies.get(method).shift();
    late(null, method === "Notify" ? 99 : undefined);
    if (method === "Notify") {
      assert.deepEqual(
        f.calls.at(-1),
        ["CloseNotification", 99],
        "late Notify id retired after timeout"
      );
      f.methodReplies.get("CloseNotification").shift()(null);
    }
    result = invoke();
    rejected = assert.rejects(result, /socket lost/);
    f.bus.connection.emit("error", Error("socket lost"));
    await rejected;
  });
}
