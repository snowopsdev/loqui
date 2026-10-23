const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { mainFixture, operation, sender } = require("./harness/dictationStreamingIpc");

// Execute the complete production provider with safe leaves installed before
// evaluating it. No ws, native, credential, profile or provider module is loaded.
function providerFixture(t) {
  const sockets = [],
    timers = new Map();
  let nextId = 0;
  const schedule = (fn, ms) => {
    const id = ++nextId;
    timers.set(id, { fn, ms });
    return id;
  };
  class Socket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    constructor() {
      super();
      this.readyState = Socket.OPEN;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => {
        if (this.readyState !== Socket.OPEN) return;
        this.emit("open");
        this.emit("message", Buffer.from('{"type":"Metadata","request_id":"fixture"}'));
      });
    }
    send(data) {
      this.sent.push(data);
      if (data === '{"type":"CloseStream"}') queueMicrotask(() => this.remoteClose(1000));
    }
    close() {
      this.readyState = Socket.CLOSED;
      queueMicrotask(() => this.emit("close", 1000, Buffer.alloc(0)));
    }
    remoteClose(code = 1006) {
      this.readyState = Socket.CLOSED;
      this.emit("close", code, Buffer.alloc(0));
    }
  }
  const sandbox = {
    module: { exports: {} },
    exports: {},
    Buffer,
    URLSearchParams,
    Date,
    setTimeout: schedule,
    clearTimeout: (id) => timers.delete(id),
    setInterval: schedule,
    clearInterval: (id) => timers.delete(id),
    require(name) {
      if (name === "ws") return Socket;
      if (name === "./streamingHandOff") return require("../../src/helpers/streamingHandOff");
      assert.equal(name, "./debugLogger", `forbidden provider import ${name}`);
      return { debug() {}, warn() {}, error() {} };
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../../src/helpers/deepgramStreaming.js"), "utf8"),
    sandbox
  );
  const main = mainFixture(t, { DeepgramStreaming: sandbox.module.exports });
  const call = (action, wc, options = {}) =>
    main.handlers.get(`deepgram-streaming-${action}`)({ sender: wc }, options);
  const tick = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  };
  async function runTimer(id) {
    const timer = timers.get(id);
    assert.ok(timer, `scheduled timer ${id}`);
    timers.delete(id);
    const result = timer.fn();
    await tick();
    return { result, ms: timer.ms };
  }
  const live = () => sockets.filter((socket) => socket.readyState === Socket.OPEN).length;
  function closed(adapter) {
    assert.equal(
      adapter.hasWarmConnection(),
      false,
      "retired A must not rewarm after token settlement"
    );
    assert.equal(adapter.ws, null);
    for (const key of [
      "rewarmTimer",
      "proactiveRefreshTimer",
      "keepAliveInterval",
      "livenessTimer",
      "connectionTimeout",
    ])
      assert.equal(adapter[key], null, `retired A ${key}`);
  }
  t.after(async () => {
    await main.host.dictationStreamingOperations.dispose();
    // Keep failing RED fixtures bounded too; this does not supply assertions.
    for (const socket of sockets) socket.close();
    timers.clear();
  });
  return { main, call, tick, runTimer, live, closed, sockets, timers };
}

async function pendingRefresh(f, route, a) {
  if (route === "rewarm") {
    a.cachedToken = a.tokenFetchedAt = null;
    a.warmConnection.remoteClose();
  }
  const held = f.main.holdToken();
  const started = await f.runTimer(route === "rewarm" ? a.rewarmTimer : a.proactiveRefreshTimer);
  assert.equal(started.ms, route === "rewarm" ? 2000 : 240000);
  assert.equal(f.main.tokens.at(-1), held, "actual timer must enter actual main token callback");
  return { held, completion: started.result };
}

for (const route of ["rewarm", "proactive"]) {
  for (const recipient of ["different-sender", "changed-same-sender"]) {
    test(`actual Deepgram ${route}: retired A cannot reopen after ${recipient} B and main disposal`, async (t) => {
      const f = providerFixture(t),
        wc = sender("A");
      assert.equal(
        (await f.call("warmup", wc, { provider: "deepgram", mode: "byok", language: "en" }))
          .success,
        true
      );
      const a = f.main.host.deepgramStreaming;
      const { held, completion } = await pendingRefresh(f, route, a);
      const bSender = recipient === "different-sender" ? sender("B") : wc;
      const identity = operation("B");
      assert.equal(
        (
          await f.call("start", bSender, {
            provider: "deepgram",
            mode: "byok",
            language: "fr",
            ...identity,
          })
        ).success,
        true
      );
      const b = f.main.host.deepgramStreaming;
      assert.notEqual(a, b);
      assert.equal(b.isConnected, true);
      assert.equal(f.live(), 1, "only B is live before old token settles");
      held.resolve("fixture-refresh");
      await completion;
      await f.tick();
      const afterRefresh = {
        aWarm: a.hasWarmConnection(),
        bLive: b.isConnected,
        sockets: f.live(),
      };
      assert.equal((await f.call("stop", bSender, identity)).success, true);
      await f.main.host.dictationStreamingOperations.dispose();
      await f.tick();
      const afterDispose = {
        aWarm: a.hasWarmConnection(),
        slotNull: f.main.host.deepgramStreaming === null,
        sockets: f.live(),
      };
      t.diagnostic(
        JSON.stringify({ actualDeepgram: true, route, recipient, afterRefresh, afterDispose })
      );
      f.closed(a);
      f.closed(b);
      assert.deepEqual(afterRefresh, { aWarm: false, bLive: true, sockets: 1 });
      assert.deepEqual(afterDispose, { aWarm: false, slotNull: true, sockets: 0 });
      assert.equal(f.timers.size, 0);
    });
  }
  for (const end of ["stop", "navigation", "destroy", "dispose"]) {
    test(`actual Deepgram ${route}: pending refresh fenced by ${end} without replacement`, async (t) => {
      const f = providerFixture(t),
        wc = sender("A"),
        identity = operation("A");
      assert.equal(
        (await f.call("warmup", wc, { provider: "deepgram", mode: "byok", ...identity })).success,
        true
      );
      const a = f.main.host.deepgramStreaming;
      const { held, completion } = await pendingRefresh(f, route, a);
      if (end === "stop") await f.call("stop", wc, identity);
      if (end === "navigation") wc.emit("did-start-navigation");
      if (end === "destroy") {
        wc.dead = true;
        wc.emit("destroyed");
      }
      if (end === "dispose") await f.main.host.dictationStreamingOperations.dispose();
      await f.tick();
      held.resolve("fixture-refresh");
      await completion;
      await f.tick();
      f.closed(a);
      assert.equal(f.live(), 0);
      assert.equal(f.timers.size, 0);
      assert.equal(f.main.host.deepgramStreaming, null);
    });
  }
  test(`actual Deepgram ${route}: current refresh remains warm and same-owner start adopts socket`, async (t) => {
    const f = providerFixture(t),
      wc = sender("A");
    const options = { provider: "deepgram", mode: "byok", language: "en" };
    assert.equal((await f.call("warmup", wc, options)).success, true);
    const a = f.main.host.deepgramStreaming;
    const { held, completion } = await pendingRefresh(f, route, a);
    held.resolve("fixture-current-refresh");
    await completion;
    await f.tick();
    assert.equal(a.hasWarmConnection(), true);
    assert.equal(f.live(), 1);
    const socket = a.warmConnection,
      identity = operation("current-start");
    assert.equal((await f.call("start", wc, { ...options, ...identity })).success, true);
    assert.equal(f.main.host.deepgramStreaming, a);
    assert.equal(a.ws, socket);
    assert.equal(a.isConnected, true);
    assert.equal((await f.call("stop", wc, identity)).success, true);
    await f.tick();
    f.closed(a);
    assert.equal(f.live(), 0);
    assert.equal(f.timers.size, 0);
  });
  test(`actual Deepgram ${route}: active same-owner handoff survives pending old refresh`, async (t) => {
    const f = providerFixture(t),
      wc = sender("A");
    const options = { provider: "deepgram", mode: "byok", language: "en" };
    await f.call("warmup", wc, options);
    const a = f.main.host.deepgramStreaming;
    const { held, completion } = await pendingRefresh(f, route, a);
    const identity = operation("handoff");
    assert.equal((await f.call("start", wc, { ...options, ...identity })).success, true);
    const active = a.ws;
    assert.equal(f.main.host.deepgramStreaming, a);
    held.resolve("fixture-late-refresh");
    await completion;
    await f.tick();
    assert.equal(a.ws, active);
    assert.equal(a.isConnected, true);
    assert.equal(a.hasWarmConnection(), false);
    assert.equal(f.live(), 1);
    await f.call("stop", wc, identity);
    await f.tick();
    f.closed(a);
    assert.equal(f.timers.size, 0);
  });
  for (const retired of [false, true]) {
    test(`actual Deepgram ${route}: rejected refresh settles ${retired ? "retired" : "current"} owner`, async (t) => {
      const f = providerFixture(t),
        wc = sender("A"),
        identity = operation("rejected");
      await f.call("warmup", wc, { provider: "deepgram", mode: "byok", ...identity });
      const a = f.main.host.deepgramStreaming;
      const { held, completion } = await pendingRefresh(f, route, a);
      if (retired) await f.call("stop", wc, identity);
      held.reject(new Error("fixture token failure"));
      await completion;
      await f.tick();
      if (!retired) {
        assert.equal(a.hasWarmConnection(), route === "proactive");
        assert.equal(f.live(), route === "proactive" ? 1 : 0);
        await f.call("stop", wc, identity);
      }
      await f.tick();
      f.closed(a);
      assert.equal(f.live(), 0);
      assert.equal(f.timers.size, 0);
    });
  }
}

test("actual Deepgram retired queued timers and socket events cannot touch a successor warm lifetime", async (t) => {
  const f = providerFixture(t),
    wc = sender("A");
  await f.call("warmup", wc, { provider: "deepgram", mode: "byok" });
  const a = f.main.host.deepgramStreaming,
    old = a.warmConnection;
  const oldRefresh = f.timers.get(a.proactiveRefreshTimer).fn;
  const oldKeepalive = f.timers.get(a.keepAliveInterval).fn;
  old.remoteClose();
  const oldRewarm = f.timers.get(a.rewarmTimer).fn;
  await f.call("stop", wc);
  a.cleanupAll();
  a.cleanupAll(); // Repeated retirement stays safe.
  await assert.rejects(a.warmup({ mode: "byok", token: "fixture-refused" }), /operation ended/);
  // A standalone explicit new lifetime must install a new authority. Main never
  // reopens a retired adapter; it allocates a successor instead.
  a.setLifecycleGate(() => true);
  await a.warmup({ mode: "byok", token: "fixture-successor" });
  const current = a.warmConnection,
    timer = a.proactiveRefreshTimer;
  const tokenCalls = f.main.tokens.length,
    oldSends = old.sent.length;
  await oldRefresh();
  await oldRewarm();
  oldKeepalive();
  old.emit("error", new Error("401 retired socket"));
  old.emit("open");
  old.emit("message", Buffer.from('{"type":"Metadata","request_id":"old"}'));
  old.emit("close", 1006, Buffer.alloc(0));
  await f.tick();
  assert.equal(a.warmConnection, current);
  assert.equal(a.hasWarmConnection(), true);
  assert.equal(a.proactiveRefreshTimer, timer);
  assert.equal(a.cachedToken, "fixture-successor");
  assert.equal(f.main.tokens.length, tokenCalls);
  assert.equal(old.sent.length, oldSends);
  assert.equal(f.live(), 1);
  a.cleanupAll();
  await f.tick();
  f.closed(a);
  assert.equal(f.timers.size, 0);
  assert.equal(f.live(), 0);
});

test("actual Deepgram cleanupAll fences pending liveness token continuation", async (t) => {
  const f = providerFixture(t),
    wc = sender("A");
  const options = { provider: "deepgram", mode: "byok" };
  await f.call("warmup", wc, options);
  const a = f.main.host.deepgramStreaming,
    identity = operation("liveness");
  await f.call("start", wc, { ...options, ...identity });
  a.cachedToken = a.tokenFetchedAt = null;
  const held = f.main.holdToken();
  const pending = a.handleLivenessTimeout();
  await f.tick();
  assert.equal(f.main.tokens.at(-1), held);
  await f.call("stop", wc, identity);
  held.resolve("fixture-retired-liveness");
  await pending;
  await f.tick();
  f.closed(a);
  assert.equal(a.cachedToken, null);
  assert.equal(f.live(), 0);
  assert.equal(f.timers.size, 0);
});
