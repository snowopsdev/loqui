const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { LinuxRecordingNotification } = require("../../src/helpers/linuxRecordingNotification.js");

// Stands in for the D-Bus service. With `manual`, each Notify answer waits until
// the test calls the function queued in `pendingNotify` (true answers with the
// next id, false rejects). `capsError` and `notifyError` make those calls reject
// the way a service that drops off the bus does.
function fakeClient({
  caps = ["actions", "body"],
  capsError = null,
  notifyError = null,
  manual = true,
} = {}) {
  const bus = new EventEmitter();
  const calls = [];
  const posted = [];
  const pendingNotify = [];
  let nextId = 41;
  return {
    calls,
    posted,
    bus,
    pendingNotify,
    capabilities: async () => {
      if (capsError) throw capsError;
      return caps;
    },
    notify: (o) => {
      calls.push(["notify", o.actions]);
      posted.push(o);
      return new Promise((resolve, reject) => {
        const answer = (ok = !notifyError) =>
          ok ? resolve(++nextId) : reject(notifyError ?? new Error("Connection closed"));
        if (manual) pendingNotify.push(answer);
        else answer();
      });
    },
    close: async (id) => calls.push(["close", id]),
    onAction: (cb) => bus.on("action", cb),
    onClosed: (cb) => bus.on("closed", cb),
    onDisconnect: (cb) => bus.on("disconnect", cb),
  };
}

class FakeElectronNotification extends EventEmitter {
  static shown = [];
  constructor(opts) {
    super();
    this.opts = opts;
  }
  show() {
    FakeElectronNotification.shown.push(this);
  }
  close() {
    this.closed = true;
  }
}

test.beforeEach(() => {
  FakeElectronNotification.shown.length = 0;
});

const tick = () => new Promise((r) => setImmediate(r));
const until = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i += 1) await tick();
  assert.ok(cond(), "condition reached");
};
const opts = {
  title: "Loqui is recording",
  body: "b",
  stopLabel: "Stop",
  fallbackBody: "Click to show the pill.",
};

function make(client) {
  const stops = [];
  const opened = [];
  const n = new LinuxRecordingNotification({
    client,
    ElectronNotification: FakeElectronNotification,
    onStop: (sessionId) => stops.push(sessionId),
    onOpen: (sessionId) => opened.push(sessionId),
  });
  return { n, stops, opened };
}

test("stop pressed in the notification stops that meeting session", async () => {
  const client = fakeClient();
  const { n, stops } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()();
  await shown;
  assert.deepEqual(client.calls[0], ["notify", ["default", "", "stop", "Stop"]]);
  assert.equal(client.posted[0].body, "b");
  client.bus.emit("action", 99, "stop"); // someone else's notification
  client.bus.emit("action", 42, "stop");
  assert.deepEqual(stops, ["m1"]);
});

test("close() while Notify is pending closes the late id when it arrives (I8)", async () => {
  const client = fakeClient();
  const { n, stops } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  const closing = n.close(); // the meeting stopped before the service answered
  client.pendingNotify.shift()(); // id 42 arrives late
  await Promise.all([shown, closing]);
  assert.deepEqual(
    client.calls.filter(([c]) => c === "close"),
    [["close", 42]]
  );
  client.bus.emit("action", 42, "stop");
  assert.deepEqual(stops, [], "a closed notification stops nothing");
});

test("a new meeting replaces the old notification; the old one's late id is closed", async () => {
  const client = fakeClient();
  const { n, stops } = make(client);
  const first = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  const second = n.show({ ...opts, sessionId: "m2" });
  client.pendingNotify.shift()(); // 42 for m1, now obsolete
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()(); // 43 for m2
  await Promise.all([first, second]);
  assert.deepEqual(
    client.calls.filter(([c]) => c === "close"),
    [["close", 42]]
  );
  client.bus.emit("action", 42, "stop"); // the stale id
  client.bus.emit("action", 43, "stop");
  assert.deepEqual(stops, ["m2"]);
});

test("a notification the user dismissed is forgotten; service loss falls back next time", async () => {
  const client = fakeClient();
  const { n } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()();
  await shown;
  client.bus.emit("closed", 42);
  await n.close();
  assert.equal(
    client.calls.some(([c, id]) => c === "close" && id === 42),
    false,
    "nothing left to close"
  );
  client.bus.emit("disconnect");
  await n.show({ ...opts, sessionId: "m2" });
  assert.equal(FakeElectronNotification.shown.length, 1, "fell back after the service went away");
});

test("no action support: the notification still shows, without Stop, and its click brings up the pill (D2)", async () => {
  const client = fakeClient({ caps: ["body"], manual: false });
  const { n, stops, opened } = make(client);
  await n.show({ ...opts, sessionId: "m1" });
  assert.deepEqual(
    client.calls,
    [["notify", ["default", ""]]],
    "never offers a Stop the server cannot show"
  );
  assert.equal(client.posted[0].body, opts.fallbackBody);
  assert.equal(client.posted[0].hints.resident, true);
  assert.equal(
    FakeElectronNotification.shown.length,
    0,
    "the service took it; no second notification"
  );
  client.bus.emit("action", 42, "stop"); // no button was offered, so this cannot be a Stop
  client.bus.emit("action", 42, "default"); // the click
  assert.deepEqual(stops, []);
  assert.deepEqual(opened, ["m1"]);
});

test("no service at all: an action-free notification still shows, and its click brings up the pill (D2)", async () => {
  const { n, opened } = make(null);
  await n.show({ ...opts, sessionId: "m1" });
  const [fallback] = FakeElectronNotification.shown;
  assert.equal(fallback.opts.timeoutType, "never");
  assert.equal(fallback.opts.body, opts.fallbackBody);
  assert.equal("actions" in fallback.opts, false);
  fallback.emit("click");
  assert.deepEqual(opened, ["m1"]);
  await n.close();
  assert.equal(fallback.closed, true);
});

test("service lost during capability discovery: the notification still shows (R1-I8)", async () => {
  const client = fakeClient({ capsError: new Error("org.freedesktop.DBus.Error.ServiceUnknown") });
  const { n, opened } = make(client);
  await n.show({ ...opts, sessionId: "m1" });
  assert.deepEqual(client.calls, [], "nothing posted to a service that did not answer");
  assert.equal(FakeElectronNotification.shown.length, 1);
  assert.equal(FakeElectronNotification.shown[0].opts.body, opts.fallbackBody);
  FakeElectronNotification.shown[0].emit("click");
  assert.deepEqual(opened, ["m1"]);
});

test("Notify rejected after discovery: the notification still shows, without Stop (R1-I8)", async () => {
  const client = fakeClient({ notifyError: new Error("Connection closed") });
  const { n, stops } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  client.pendingNotify.shift()(); // rejects
  await shown;
  assert.deepEqual(client.calls, [["notify", ["default", "", "stop", "Stop"]]]);
  assert.equal(FakeElectronNotification.shown.length, 1, "the rejection is not swallowed");
  assert.equal(FakeElectronNotification.shown[0].opts.body, opts.fallbackBody);
  await n.close();
  assert.equal(FakeElectronNotification.shown[0].closed, true);
  assert.deepEqual(stops, []);
});

test("a meeting that ends while Notify is failing posts nothing", async () => {
  const client = fakeClient({ notifyError: new Error("Connection closed") });
  const { n } = make(client);
  const shown = n.show({ ...opts, sessionId: "m1" });
  await until(() => client.pendingNotify.length > 0);
  const closing = n.close();
  client.pendingNotify.shift()(); // rejects after the meeting ended
  await Promise.all([shown, closing]);
  assert.equal(FakeElectronNotification.shown.length, 0);
});

test("service lost after posting: the notification is posted again without Stop, for the same session", async () => {
  const client = fakeClient({ manual: false });
  const { n, stops, opened } = make(client);
  await n.show({ ...opts, sessionId: "m1" });
  client.bus.emit("disconnect");
  await until(() => FakeElectronNotification.shown.length === 1);
  client.bus.emit("action", 42, "stop"); // the old id can no longer stop anything
  assert.deepEqual(stops, []);
  FakeElectronNotification.shown[0].emit("click");
  assert.deepEqual(opened, ["m1"]);
  await n.close();
  assert.equal(FakeElectronNotification.shown[0].closed, true);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

for (const transition of ["end", "replace"]) {
  test(`deferred capabilities cannot publish an obsolete notification after ${transition}`, async () => {
    const client = fakeClient({ manual: false });
    const caps = deferred();
    let discoveries = 0;
    client.capabilities = () => (++discoveries === 1 ? caps.promise : Promise.resolve(["actions"]));
    const { n, stops, opened } = make(client);
    const first = n.show({ ...opts, sessionId: "A" });
    await until(() => discoveries === 1);
    const next = transition === "end" ? n.close() : n.show({ ...opts, sessionId: "B" });
    caps.resolve(["actions"]);
    await Promise.all([first, next]);
    assert.equal(client.posted.length, transition === "end" ? 0 : 1);
    assert.equal(FakeElectronNotification.shown.length, 0);
    if (transition === "replace") {
      client.bus.emit("action", 42, "stop");
      client.bus.emit("action", 42, "default");
      assert.deepEqual(stops, ["B"]);
      assert.deepEqual(opened, ["B"]);
    }
    await n.close();
  });
}

test("a replacement fences old fallback clicks immediately and suppresses a rejected stale Notify fallback", async () => {
  const { n, opened } = make(null);
  await n.show({ ...opts, sessionId: "A" });
  const a = FakeElectronNotification.shown[0];
  const replacing = n.show({ ...opts, sessionId: "B" });
  a.emit("click");
  await replacing;
  a.emit("click");
  const b = FakeElectronNotification.shown[1];
  b.emit("click");
  const closing = n.close();
  b.emit("click");
  await closing;
  assert.deepEqual(opened, ["B"]);
  const client = fakeClient();
  const other = make(client).n;
  const first = other.show({ ...opts, sessionId: "A" });
  await until(() => client.pendingNotify.length === 1);
  const second = other.show({ ...opts, sessionId: "B" });
  client.pendingNotify.shift()(false);
  await until(() => client.pendingNotify.length === 1);
  client.pendingNotify.shift()();
  await Promise.all([first, second]);
  assert.equal(FakeElectronNotification.shown.length, 2, "no extra fallback for rejected A");
  await other.close();
});

test("a service disconnect during Notify retires a late id and falls back for the still-current session", async () => {
  const client = fakeClient();
  const { n, stops, opened } = make(client);
  const showing = n.show({ ...opts, sessionId: "A" });
  await until(() => client.pendingNotify.length === 1);
  client.bus.emit("disconnect");
  client.pendingNotify.shift()();
  await showing;
  assert.deepEqual(
    client.calls.filter(([method]) => method === "close"),
    [["close", 42]]
  );
  assert.equal(FakeElectronNotification.shown.length, 1);
  client.bus.emit("action", 42, "stop");
  FakeElectronNotification.shown[0].emit("click");
  assert.deepEqual(stops, []);
  assert.deepEqual(opened, ["A"]);
  await n.close();
});

test("delayed CloseNotification cannot show a replaced or ended queued session", async () => {
  const client = fakeClient({ manual: false });
  const { n } = make(client);
  await n.show({ ...opts, sessionId: "A" });
  const closed = deferred();
  client.close = () => closed.promise;
  const second = n.show({ ...opts, sessionId: "B" });
  await tick();
  const ending = n.close();
  closed.resolve();
  await Promise.all([second, ending]);
  assert.equal(client.posted.length, 1);
  assert.equal(FakeElectronNotification.shown.length, 0);
});
