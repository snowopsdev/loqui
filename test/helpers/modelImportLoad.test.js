const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { isReady: () => true, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
      net: {},
    };
  return originalLoad.call(this, request, parent, isMain);
};
const { ModelManager } = require("../../src/helpers/modelManagerBridge");
Module._load = originalLoad;

function makeManager(start = async () => {}) {
  const manager = new ModelManager();
  manager._initialized = true;
  manager.modelsDir = path.join(process.cwd(), "test-models");
  manager.checkModelValid = async () => true;
  const states = [];
  const model = {
    id: "imported-test",
    fileName: "model.gguf",
    contextLength: 8192,
    architecture: "llama",
    imported: true,
  };
  manager.importedModels = {
    provider: () => ({ id: "imported", models: [model] }),
    updateLoadStatus: (...args) => states.push(args),
  };
  let stops = 0;
  manager.serverManager = {
    isAvailable: () => true,
    start,
    stop: async () => {
      stops++;
    },
    getStatus: () => ({ backend: "cpu" }),
  };
  return { manager, states, stopped: () => stops };
}

test("load test reports CPU readiness and retains the model entry", async () => {
  const { manager, states } = makeManager();
  const result = await manager.testModelLoad("imported-test");
  assert.equal(result.backend, "cpu");
  assert.deepEqual(states, [["imported-test", "ready"]]);
  assert.equal(manager.loadTestController, null);
});

test("load failures classify memory and unsupported architectures and stop the runtime", async () => {
  for (const [message, code] of [
    ["allocation failed: out of memory", "INSUFFICIENT_MEMORY"],
    ["unknown model architecture fake", "UNSUPPORTED_ARCHITECTURE"],
    ["bad tensor data", "MODEL_LOAD_FAILED"],
  ]) {
    const { manager, states, stopped } = makeManager(async () => {
      throw new Error(message);
    });
    await assert.rejects(manager.testModelLoad("imported-test"), { code });
    assert.equal(states[0][1], "failed");
    assert.equal(stopped(), 2);
    assert.equal(manager.loadTestController, null);
  }
});

test("canceling a load test interrupts startup and leaves model untested", async () => {
  let started;
  const startSignal = new Promise((resolve) => {
    started = resolve;
  });
  const { manager, states, stopped } = makeManager(
    (_path, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
        started();
      })
  );
  const loading = manager.testModelLoad("imported-test");
  await startSignal;
  assert.equal(manager.cancelModelLoadTest(), true);
  await assert.rejects(loading, { code: "MODEL_TEST_CANCELED" });
  assert.equal(states[0][1], "untested");
  assert.equal(stopped(), 2);
});

test("load tests cannot interrupt active inference or silently select another model", async () => {
  const { manager } = makeManager();
  manager.inferenceCount = 1;
  await assert.rejects(manager.testModelLoad("imported-test"), { code: "MODEL_BUSY" });
  manager.inferenceCount = 0;
  await assert.rejects(manager.testModelLoad("missing"), { code: "MODEL_NOT_FOUND" });
});
