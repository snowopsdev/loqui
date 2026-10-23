const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const registry = require("../../src/helpers/privacy/childRegistry");
const gate = require("../../src/helpers/privacy/egressGate");
let ready = false;
let pathCalls = 0;
const userData = path.resolve("/tmp/loqui-binary-classification-fixture");
require.cache[require.resolve("electron")] = {
  exports: {
    app: {
      isReady: () => ready,
      getPath: () => {
        pathCalls++;
        assert.equal(ready, true);
        return userData;
      },
    },
  },
};
// Named no-op stand-ins for the helpers gpuBinaryManager destructures, so Node never warns
// about reading a missing export from this unloaded stub (T6a-M1). Nothing here downloads.
const noop = () => {};
require.cache[require.resolve("../../src/helpers/downloadUtils")] = {
  exports: Object.fromEntries(
    [
      "downloadFile",
      "fetchJson",
      "createDownloadSignal",
      "checkDiskSpace",
      "cleanupStaleDownloads",
      "extractArchive",
      "findFile",
      "findFiles",
    ].map((name) => [name, noop])
  ),
};
const GpuBinaryManager = require("../../src/helpers/gpuBinaryManager");
const llama = require("../../src/helpers/llamaCppInstaller").default;
test("installer paths are registered when lazily resolved, never as sealed privileges", () => {
  registry._resetForTests();
  const gpu = new GpuBinaryManager({ dirName: "fixture-gpu", assets: {} });
  assert.equal(pathCalls, 0, "constructors must not acquire userData before ready");
  assert.throws(() => llama.ensureInitialized(), /before app.whenReady/);
  ready = true;
  const gpuDir = gpu.binDir;
  llama.ensureInitialized();
  for (const dir of [gpuDir, llama.installDir]) {
    assert.equal(registry.classify(path.join(dir, "fixture-helper")), "bundled");
    let launched = false;
    const cp = {
      spawn: () => {
        launched = true;
      },
    };
    registry.installSpawnGuard({ childProcess: cp });
    gate.configureEgress({ isSealed: () => true });
    assert.throws(() => cp.spawn(path.join(dir, "fixture-helper"), []), { code: "SEALED_MODE" });
    assert.equal(launched, false);
  }
});
