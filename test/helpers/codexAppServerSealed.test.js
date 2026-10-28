const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CodexAppServer } = require("../../src/helpers/codexAppServer");
const fixture = require("../fixtures/codex-app-server-0.154.json");

// Same fakes as test/helpers/codexAppServer.test.js, reduced to initialize.
function fakeChild({ ignoreTerm = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kills = [];
  child.kill = (signal = "SIGTERM") => {
    child.kills.push(signal);
    if (signal === "SIGKILL" || !ignoreTerm) setImmediate(() => child.emit("exit", null, signal));
    return true;
  };
  child.stdin = new Writable({
    write(bytes, _encoding, callback) {
      const message = JSON.parse(bytes.toString());
      callback();
      if (message.method === "initialize")
        queueMicrotask(() =>
          child.stdout.write(JSON.stringify({ id: message.id, result: fixture.initialize }) + "\n")
        );
    },
  });
  return child;
}

async function setup(t, { child = fakeChild(), verifyGate, beforeSpawn, onSpawn } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loqui-codex-sealed-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let spawned = 0;
  let probes = 0;
  const server = new CodexAppServer({
    userDataPath: dir,
    env: { PATH: process.env.PATH },
    resolveExecutable: async () => "/verified/codex",
    verifyRelease: async () => verifyGate?.promise,
    runFile: async () => {
      probes++;
      return { stdout: fixture.version };
    },
    spawnProcess: () => {
      spawned++;
      return child;
    },
    beforeSpawn,
    onSpawn,
    timeoutMs: 1000,
    stopTimeoutMs: 50,
  });
  return { server, child, spawned: () => spawned, probes: () => probes };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("sealing during a pending start cancels it before anything is spawned", async (t) => {
  const verifyGate = deferred();
  const h = await setup(t, { verifyGate });
  const starting = h.server.start();
  assert.equal(h.server.alive(), true, "a pending start counts as alive");
  const stopping = h.server.stopAndWait();
  verifyGate.resolve();
  await assert.rejects(starting, (e) => e.code === "CODEX_DISCONNECTED");
  await stopping;
  assert.equal(h.spawned(), 0);
  assert.equal(h.server.alive(), false);
});

test("beforeSpawn runs before the native version probe and can refuse it", async (t) => {
  const h = await setup(t, {
    beforeSpawn: () => {
      throw Object.assign(new Error("[SEALED_MODE] sealed"), { code: "SEALED_MODE" });
    },
  });
  await assert.rejects(h.server.start(), (e) => e.code === "SEALED_MODE");
  assert.equal(h.probes(), 0, "no native version probe while refused");
  assert.equal(h.spawned(), 0);
  assert.equal(h.server.alive(), false);
});

test("beforeSpawn runs again immediately before the spawn and can refuse it", async (t) => {
  const verifyGate = deferred();
  let refuse = false;
  const h = await setup(t, {
    verifyGate,
    beforeSpawn: () => {
      if (refuse) throw Object.assign(new Error("[SEALED_MODE] sealed"), { code: "SEALED_MODE" });
    },
  });
  const starting = h.server.start();
  // The release check can take a while; sealing during it must still refuse.
  await new Promise((resolve) => setImmediate(resolve));
  refuse = true;
  verifyGate.resolve();
  await assert.rejects(starting, (e) => e.code === "SEALED_MODE");
  assert.equal(h.probes(), 1);
  assert.equal(h.spawned(), 0);
});

test("alive() stays true until the process has actually exited", async (t) => {
  const child = fakeChild({ ignoreTerm: true });
  const spawnedChildren = [];
  const h = await setup(t, { child, onSpawn: (c) => spawnedChildren.push(c) });
  await h.server.start();
  assert.equal(spawnedChildren.length, 1);
  assert.equal(spawnedChildren[0], child);
  h.server.stop();
  assert.equal(h.server.alive(), true, "stop() only signals; the child ignored SIGTERM");
  await h.server.stopAndWait();
  assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"]);
  assert.equal(h.server.alive(), false);
});

test("stopAndWait rejects when the child survives SIGKILL", async (t) => {
  const child = fakeChild({ ignoreTerm: true });
  child.kill = (signal) => {
    child.kills.push(signal);
    return true;
  };
  child.kills = [];
  const h = await setup(t, { child });
  await h.server.start();
  await assert.rejects(h.server.stopAndWait(), (e) => e.code === "CODEX_STOP_FAILED");
  assert.equal(h.server.alive(), true);
});

test("a child that fails to start (error, no pid, no exit) is not counted alive", async (t) => {
  const child = fakeChild();
  const h = await setup(t, { child });
  await h.server.start();
  assert.equal(h.server.alive(), true);
  child.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" }));
  child.emit("close", -2, null);
  assert.equal(h.server.alive(), false);
  await h.server.stopAndWait();
});
