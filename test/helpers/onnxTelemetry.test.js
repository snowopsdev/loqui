const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");

test("the standalone inference worker opts out before native initialization", async () => {
  const filename = path.resolve(__dirname, "../../src/workers/onnxWorker.js");
  const realRequire = createRequire(filename);
  const env = { ORT_DISABLE_TELEMETRY: "0" };
  let imports = 0;
  const context = {
    require: (name) => {
      if (name !== "onnxruntime-node") return realRequire(name);
      imports++;
      assert.equal(env.ORT_DISABLE_TELEMETRY, "1");
      return { InferenceSession: { create: async () => ({ inputNames: ["audio"] }) } };
    },
    process: { env, on() {}, parentPort: { once() {} } },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });

  const { reply } = await context.dispatch({
    id: 1,
    method: "speaker.load",
    payload: { modelPath: "/fixture/speaker.onnx" },
  });
  assert.equal(reply.result.ok, true);
  assert.equal(imports, 1);
});

test("the utility process starts with telemetry disabled even if its parent opts in", async () => {
  const filename = path.resolve(__dirname, "../../src/helpers/onnxWorkerClient.js");
  const realRequire = createRequire(filename);
  const parentEnv = { ORT_DISABLE_TELEMETRY: "0", PATH: "/fixture/bin" };
  let forkOptions;
  const child = new EventEmitter();
  child.postMessage = () => {};
  const port = { on() {}, start() {} };
  const electron = {
    app: { getPath: () => "/fixture/profile" },
    utilityProcess: {
      fork: (_script, _args, options) => {
        forkOptions = options;
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    },
    MessageChannelMain: class {
      constructor() {
        this.port1 = port;
        this.port2 = port;
      }
    },
  };
  const context = {
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process: { env: parentEnv },
    require: (name) => {
      if (name === "electron") return electron;
      if (name === "./debugLogger") return { info() {}, warn() {} };
      return realRequire(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });

  await context.module.exports._spawn();
  assert.equal(forkOptions.env.ORT_DISABLE_TELEMETRY, "1");
  assert.equal(forkOptions.env.PATH, "/fixture/bin");
  assert.equal(parentEnv.ORT_DISABLE_TELEMETRY, "0");
});
