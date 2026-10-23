const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Run complete production modules in isolated contexts. Only the hardware,
// Electron and file boundaries are fixtures; detection and log serialization
// are real. Unrelated IPC services stay inert and never load native/providers.
function inert() {
  return new Proxy(function () {}, {
    get: (_target, key) => {
      if (key === Symbol.iterator) return function* () {};
      if (key === "then") return undefined;
      return inert();
    },
    apply: () => inert(),
  });
}

function fixture({ smi = "missing", wmiError = false, onProbe = () => {} } = {}) {
  const calls = [];
  const loggerCalls = [];
  const writes = [];
  const fileOps = [];
  const handlers = new Map();
  const fixtureProcess = {
    platform: "win32",
    arch: "x64",
    argv: [],
    env: { LOQUI_LOG_LEVEL: "trace", SystemRoot: "C:\\Windows" },
    versions: {},
  };
  const missing = () => Object.assign(new Error("fixture ENOENT"), { code: "ENOENT" });
  const hardwareFs = {
    existsSync: () => false,
    readdirSync: () => {
      throw missing();
    },
  };
  const logFs = {
    existsSync: () => false,
    mkdirSync: (...args) => fileOps.push(["mkdirSync", ...args]),
    createWriteStream: (...args) => {
      fileOps.push(["createWriteStream", ...args]);
      return { write: (line) => writes.push(line) };
    },
  };
  const app = {
    isReady: () => true,
    isPackaged: true,
    getPath: () => "C:\\fixture-profile",
    getAppPath: () => "C:\\fixture-app",
    getVersion: () => "fixture",
    getPreferredSystemLanguages: () => ["fr-FR"],
    getLocale: () => "fr-FR",
  };
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    onProbe();
    let error = null;
    let stdout = "";
    if (file === "nvidia-smi") {
      if (smi === "missing") error = missing();
      else if (smi === "failed") error = new Error("fixture driver query failed");
      else stdout = "NVIDIA GeForce RTX 4060 Ti, 555.85, 16380, 8.9\n";
    } else {
      assert.equal(file, "powershell.exe");
      if (wmiError) error = new Error("fixture WMI failed");
      else stdout = "AMD Radeon RX 7900 XTX\r\nNVIDIA GeForce RTX 4060 Ti\r\n";
    }
    queueMicrotask(() => callback(error, stdout));
  };
  function load(relative, dependencies) {
    const filename = path.resolve(__dirname, "../../", relative);
    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(filename, "utf8"),
      {
        module,
        exports: module.exports,
        process: fixtureProcess,
        require: (name) => {
          assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
          return dependencies[name];
        },
      },
      { filename }
    );
    return module.exports;
  }
  const realLogger = load("src/helpers/debugLogger.js", {
    fs: logFs,
    path: path.win32,
    electron: { app },
  });
  const logger = new Proxy(realLogger, {
    get: (target, key) =>
      typeof target[key] === "function"
        ? (...args) => {
            loggerCalls.push([key, ...args]);
            return target[key](...args);
          }
        : target[key],
  });
  const gpu = load("src/utils/gpuDetection.js", {
    child_process: { execFile },
    fs: hardwareFs,
    path: path.win32,
    "../helpers/debugLogger": logger,
    // Sealed refusals are not cached as "no GPU" (final review m1).
    "../helpers/privacy/egressPolicy": require("../../src/helpers/privacy/egressPolicy"),
  });
  const profile = load("src/helpers/systemProfile.js", {
    path: path.win32,
    "fs/promises": { statfs: async () => ({ bavail: 10, bsize: 4096 }) },
  });
  const filename = path.resolve(__dirname, "../../src/helpers/ipcHandlers.js");
  const module = { exports: {} };
  const dependencies = {
    electron: { app, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on() {} } },
    "./systemProfile": profile,
    "./modelDirUtils": { getCacheRoot: () => "C:\\fixture-cache" },
    "../utils/gpuDetection": gpu,
    "./debugLogger": logger,
  };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      process: fixtureProcess,
      require: (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : inert()),
    },
    { filename }
  );
  const target = new Proxy(
    { _systemProfilePromise: null, windowManager: {} },
    {
      get: (object, key) => (key in object ? object[key] : inert()),
    }
  );
  module.exports.prototype.setupHandlers.call(target);
  return {
    gpu,
    logger,
    loggerCalls,
    writes,
    fileOps,
    calls,
    invoke: handlers.get("get-system-profile"),
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const wmiFacts = {
  hasNvidiaGpu: true,
  gpuName: "NVIDIA GeForce RTX 4060 Ti",
  cudaSupported: true,
  detectionSource: "wmi",
};

test("setup IPC cold Windows WMI fallback returns facts without logger or file persistence", async () => {
  const f = fixture();
  const pending = f.invoke({}, { quiet: false }); // Renderer input cannot enable logging.
  assert.strictEqual(f.invoke({}), pending, "setup coalesces in-flight requests");
  assert.deepEqual(plain(await pending), {
    locales: ["fr-FR"],
    freeDiskBytes: 40960,
    gpu: { kind: "nvidia", name: wmiFacts.gpuName },
  });
  assert.deepEqual(
    f.calls.map(({ file }) => file),
    ["nvidia-smi", "powershell.exe"]
  );
  assert.deepEqual(
    { loggerCalls: f.loggerCalls, fileOps: f.fileOps, writes: f.writes },
    { loggerCalls: [], fileOps: [], writes: [] },
    "setup must bypass every diagnostic and the real logger's file sink"
  );
  const cached = await f.gpu.detectNvidiaGpu();
  assert.deepEqual(plain(cached), wmiFacts);
  assert.strictEqual(await f.gpu.detectNvidiaGpu(), cached);
  assert.strictEqual(f.invoke({}), pending);
  assert.equal(f.calls.length, 2, "private probes retain the shared GPU/path cache semantics");
  assert.deepEqual(f.loggerCalls, []);
  f.logger.info("unrelated diagnostic after setup");
  assert.ok(f.writes.some((line) => line.includes("unrelated diagnostic after setup")));
});

test("ordinary cold Windows detection retains nested diagnostics and persistent GPU metadata", async () => {
  const f = fixture();
  assert.deepEqual(plain(await f.gpu.detectNvidiaGpu()), wmiFacts);
  assert.ok(f.loggerCalls.some(([, message]) => message.includes("trying System32")));
  assert.ok(f.loggerCalls.some(([, message]) => message.includes("DriverStore scan")));
  assert.ok(f.loggerCalls.some(([, message]) => message.includes("detected via WMI")));
  assert.ok(f.fileOps.some(([operation]) => operation === "createWriteStream"));
  assert.ok(f.writes.some((line) => line.includes(wmiFacts.gpuName)));
});

test("setup IPC suppresses successful nvidia-smi diagnostics", async () => {
  const f = fixture({ smi: "success" });
  assert.equal((await f.invoke({})).gpu.name, wmiFacts.gpuName);
  assert.deepEqual(f.loggerCalls, []);
  assert.deepEqual(f.fileOps, []);
  assert.deepEqual(f.writes, []);
});

test("setup IPC suppresses failed nvidia-smi and WMI diagnostics and returns unknown", async () => {
  const f = fixture({ smi: "failed", wmiError: true });
  assert.deepEqual(plain((await f.invoke({})).gpu), { kind: "unknown", name: null });
  assert.equal(f.calls.length, 4, "PATH probe, both SMI queries and WMI all use fixtures");
  assert.deepEqual(f.loggerCalls, []);
  assert.deepEqual(f.fileOps, []);
  assert.deepEqual(f.writes, []);
});

test("private setup leaves unrelated diagnostics enabled while a probe is in flight", async () => {
  const f = fixture({ onProbe: () => f.logger.info("unrelated during probe") });
  await f.invoke({});
  assert.equal(f.loggerCalls.length, 2);
  assert.ok(f.loggerCalls.every(([, message]) => message === "unrelated during probe"));
  assert.equal(f.writes.filter((line) => line.includes("unrelated during probe")).length, 2);
  assert.ok(!f.writes.some((line) => /NVIDIA|nvidia-smi|DriverStore|WMI/.test(line)));
});
