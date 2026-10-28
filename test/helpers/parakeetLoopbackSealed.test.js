const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const gate = require("../../src/helpers/privacy/egressGate");
const registry = require("../../src/helpers/privacy/childRegistry");

// Main's loopback-only Parakeet build (marker refusal, listener check) and
// 07a's process-wide spawn guard (sealed refusal, child accounting) on one
// start path. The guard wraps an injected child_process leaf, so nothing
// native can start; the real sherpaLoopback reads the fixture binaries.
const MARKER = "Listening on: 127.0.0.1:";
let sealed;
let rows;
let dir;
test.beforeEach(() => {
  sealed = false;
  rows = [];
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => sealed, recorder: { record: (row) => rows.push(row) } });
  registry._resetForTests();
  registry._setSystemForTests({
    listProcesses: () => [],
    pidAlive: () => true,
    groupAlive: () => true,
    killGroup: () => {},
  });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-parakeet-sealed-"));
});
test.afterEach(() => {
  gate._resetForTests();
  registry._resetForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});

function fixtureBinary(name, contents) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

function loadServer(wsBinary) {
  const calls = [];
  const leaf = {
    spawn: (binary, args) => {
      const child = new EventEmitter();
      child.pid = 4343;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      calls.push({ binary, args: Array.from(args), child });
      return child;
    },
  };
  registry.installSpawnGuard({ childProcess: leaf, processObject: {} });
  const filename = require.resolve("../../src/helpers/parakeetWsServer");
  const localRequire = createRequire(filename);
  const mocks = {
    child_process: leaf,
    "./debugLogger": { debug() {}, info() {}, warn() {}, error() {} },
    "./sidecarPidFile": { write() {}, clear() {} },
    "./safeTempDir": { getSafeTempDir: () => os.tmpdir() },
    "../utils/serverUtils": {
      findAvailablePort: async () => 6006,
      getAvailableParallelism: () => 8,
      gracefulStopProcess: async () => {},
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      require: (request) => mocks[request] ?? localRequire(request),
      process,
      Buffer,
      setTimeout: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        timer.unref?.();
        return timer;
      },
      clearTimeout,
      setInterval,
      clearInterval,
    },
    { filename }
  );
  const server = new module.exports();
  server.getWsBinaryPath = () => wsBinary;
  server._startHealthCheck = () => {};
  server._warmUp = async () => {};
  return { server, calls };
}

test("sealed, the loopback build is still refused by the spawn guard and recorded", async () => {
  const binary = fixtureBinary("sherpa-onnx-offline-websocket-server", `x${MARKER}%d\n`);
  const { server, calls } = loadServer(binary);
  sealed = true;
  await assert.rejects(server.start("parakeet-tdt-0.6b-v3", dir), { code: "SEALED_MODE" });
  assert.equal(calls.length, 0);
  assert.equal(server.getStatus().running, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task, "nativeLaunch");
  assert.equal(rows[0].outcome, "blocked");
  assert.deepEqual(registry.alive(), []);
});

test("an upstream build is refused before any launch, sealed or not", async () => {
  const binary = fixtureBinary("sherpa-onnx-offline-websocket-server", "Listening on: %d\n");
  for (const state of [true, false]) {
    const { server, calls } = loadServer(binary);
    sealed = state;
    await assert.rejects(
      server.start("parakeet-tdt-0.6b-v3", dir),
      /is not the loopback-only build; refusing to start it/
    );
    assert.equal(calls.length, 0);
  }
  // Like a missing binary, it never reaches a launch, so no row is written.
  assert.deepEqual(rows, []);
  assert.deepEqual(registry.alive(), []);
});

test("unsealed, the loopback build starts through the guard and is accounted as a sidecar", async () => {
  const binary = fixtureBinary("sherpa-onnx-offline-websocket-server", `x${MARKER}%d\n`);
  const { server, calls } = loadServer(binary);
  const starting = server.start("parakeet-tdt-0.6b-v3", dir);
  await new Promise((resolve) => setImmediate(resolve));
  const [{ child }] = calls;
  child.emit("spawn");
  child.stderr.emit("data", Buffer.from(`main:94 ${MARKER}6006\n`));
  await starting;
  assert.equal(server.getStatus().running, true);
  assert.deepEqual(registry.alive(), [
    { kind: "sherpa-onnx-offline-websocket-server", pid: 4343, local: true },
  ]);
  assert.deepEqual(rows, []);
});

test("unsealed, a wildcard listener announcement stops the accounted child", async () => {
  const binary = fixtureBinary("sherpa-onnx-offline-websocket-server", `x${MARKER}%d\n`);
  const { server, calls } = loadServer(binary);
  const starting = server.start("parakeet-tdt-0.6b-v3", dir);
  await new Promise((resolve) => setImmediate(resolve));
  const [{ child }] = calls;
  child.emit("spawn");
  assert.equal(registry.alive().length, 1);
  child.stderr.emit("data", Buffer.from("main:94 Listening on: 6006\n"));
  await assert.rejects(starting, /did not report a 127\.0\.0\.1-only listener; stopped it/);
  assert.equal(server.getStatus().running, false);
});
