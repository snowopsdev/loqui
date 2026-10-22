const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("node:events");
const cp = require("node:child_process");
const gate = require("../../src/helpers/privacy/egressGate");
const registry = require("../../src/helpers/privacy/childRegistry");
let sealed = false;
test.beforeEach(() => {
  sealed = false;
  gate._resetForTests();
  registry._resetForTests();
  gate.configureEgress({ isSealed: () => sealed });
});

let userDataDir;
const electronPath = require.resolve("electron");
require.cache[electronPath] = {
  exports: {
    app: {
      getPath: () => userDataDir,
      isReady: () => false,
    },
  },
};

const sidecarPidFile = require("../../src/helpers/sidecarPidFile");
// Terminal process-inspection adapter, installed before import so BASE's
// captured execFileSync also respects each test's mock. It delegates only
// unsealed real inspection to the unchanged preloaded child-process chain.
const Module = require("node:module");
const load = Module._load;
const filename = require.resolve("../../src/helpers/sidecarReaper");
let reaper;
try {
  Module._load = function (name, parent, main) {
    if (parent?.filename === filename && /^(?:node:)?child_process$/.test(name))
      return { execFileSync: (...args) => cp.execFileSync(...args) };
    return load.call(this, name, parent, main);
  };
  reaper = require(filename);
} finally {
  Module._load = load;
}
const { reapStaleSidecars, waitForExit } = reaper;

// Short graces keep the escalation path fast; the poll interval is 200ms so
// anything comfortably above that works.
const GRACES = { sigtermGraceMs: 1000, sigkillGraceMs: 1000 };

// The reaper matches processes by command line, which tasklist on Windows
// reports as the bare image name — these process-identity tests are POSIX-only.
const posixOnly = { skip: process.platform === "win32" };

function createUserDataDir(t) {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-sidecar-reaper-"));
  const dir = userDataDir;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The script filename must contain "qdrant" so processCommand() matches the
// expected binary fragment for the qdrant sidecar.
function spawnFakeSidecar(t, { scriptName, ignoreSigterm }) {
  const handler = ignoreSigterm ? 'process.on("SIGTERM", () => {});' : "";
  const scriptPath = path.join(userDataDir, scriptName);
  fs.writeFileSync(scriptPath, `${handler}console.log("ready");setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, [scriptPath], {
    stdio: ["ignore", "pipe", "ignore"],
    killSignal: "SIGKILL",
    timeout: 10000,
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, "close");
    child.kill("SIGKILL");
    await closed;
  });
  return new Promise((resolve) => {
    child.stdout.once("data", () => resolve(child));
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isAlive(pid);
}

test(
  "kills a responsive stale root but preserves unknown descendant evidence",
  posixOnly,
  async (t) => {
    createUserDataDir(t);
    const child = await spawnFakeSidecar(t, { scriptName: "qdrant-fake.js", ignoreSigterm: false });
    sidecarPidFile.write("qdrant", child.pid);

    await reapStaleSidecars(GRACES);

    assert.equal(await waitUntilDead(child.pid), true);
    assert.deepEqual(sidecarPidFile.readAll(), [{ name: "qdrant", pid: child.pid }]);
  }
);

test("escalates to SIGKILL when a stale sidecar ignores SIGTERM", posixOnly, async (t) => {
  createUserDataDir(t);
  const child = await spawnFakeSidecar(t, { scriptName: "qdrant-stuck.js", ignoreSigterm: true });
  sidecarPidFile.write("qdrant", child.pid);

  await reapStaleSidecars(GRACES);

  assert.equal(await waitUntilDead(child.pid), true);
  assert.deepEqual(sidecarPidFile.readAll(), [{ name: "qdrant", pid: child.pid }]);
});

test("does not kill a reused PID that is no longer the sidecar binary", posixOnly, async (t) => {
  createUserDataDir(t);
  const child = await spawnFakeSidecar(t, { scriptName: "other-app.js", ignoreSigterm: false });
  sidecarPidFile.write("qdrant", child.pid);

  await reapStaleSidecars(GRACES);

  assert.equal(isAlive(child.pid), true);
  assert.deepEqual(sidecarPidFile.readAll(), [{ name: "qdrant", pid: child.pid }]);
});

// qdrantManager's unhealthy-restart path uses waitForExit to verify the old
// process is gone before spawning a replacement.
test("waitForExit distinguishes a live process from a dead one", async (t) => {
  createUserDataDir(t);
  const child = await spawnFakeSidecar(t, { scriptName: "qdrant-wait.js", ignoreSigterm: false });

  assert.equal(await waitForExit(child.pid, 400), false);

  process.kill(child.pid, "SIGKILL");
  assert.equal(await waitForExit(child.pid, 2000), true);
});

test("root-exited records remain unresolved with unknown descendants", async (t) => {
  createUserDataDir(t);
  const child = await spawnFakeSidecar(t, { scriptName: "qdrant-gone.js", ignoreSigterm: false });
  sidecarPidFile.write("qdrant", child.pid);
  process.kill(child.pid, "SIGKILL");
  assert.equal(await waitUntilDead(child.pid), true);

  const result = await reapStaleSidecars(GRACES);

  assert.deepEqual(sidecarPidFile.readAll(), [{ name: "qdrant", pid: child.pid }]);
  assert.equal(result.unresolved[0].reason, "ROOT_EXITED_DESCENDANTS_UNKNOWN");
  assert.equal(result.unresolved[0].rootExited, true);
  sidecarPidFile.clear("qdrant");
  const afterClear = await reapStaleSidecars(GRACES);
  assert.equal(afterClear.unresolved[0].pid, child.pid);
});

test(
  "sealed saved live PID: no inspection spawn, no signal, no clearing; named handoff",
  { timeout: 10000 },
  async (t) => {
    createUserDataDir(t);
    const child = await spawnFakeSidecar(t, {
      scriptName: "qdrant-sealed.js",
      ignoreSigterm: false,
    });
    sidecarPidFile.write("qdrant", child.pid);
    sealed = true;
    let inspections = 0,
      signals = 0;
    const run = cp.execFileSync,
      kill = process.kill;
    cp.execFileSync = () => {
      inspections++;
      throw new Error("inspection must not start");
    };
    process.kill = (pid, signal) => {
      if (signal !== 0) signals++;
      return kill(pid, signal);
    };
    t.after(() => {
      cp.execFileSync = run;
      process.kill = kill;
    });
    const result = await reapStaleSidecars(GRACES);
    assert.equal(inspections, 0);
    assert.equal(signals, 0);
    assert.deepEqual(sidecarPidFile.readAll(), [{ name: "qdrant", pid: child.pid }]);
    assert.deepEqual(result, {
      unresolved: [
        {
          kind: "qdrant",
          pid: child.pid,
          reason: "INSPECTION_REFUSED_SEALED",
          rootExited: false,
          source: "sidecar-pid-file",
        },
      ],
    });
    assert.deepEqual(registry.diagnostics().unresolved, result.unresolved);
    assert.equal(isAlive(child.pid), true);
  }
);

test(
  "failed unsealed inspection is distinct from positive reused PID and preserves the record",
  { timeout: 10000 },
  async (t) => {
    createUserDataDir(t);
    const child = await spawnFakeSidecar(t, {
      scriptName: "qdrant-inspection.js",
      ignoreSigterm: false,
    });
    sidecarPidFile.write("qdrant", child.pid);
    const run = cp.execFileSync;
    let calls = 0;
    cp.execFileSync = () => {
      calls++;
      throw Object.assign(new Error("inspection failed"), { code: "ENOENT" });
    };
    t.after(() => {
      cp.execFileSync = run;
    });
    const failed = await reapStaleSidecars(GRACES);
    assert.equal(calls, 1);
    assert.equal(failed.unresolved[0].reason, "INSPECTION_FAILED");
    assert.equal(isAlive(child.pid), true);
    cp.execFileSync = () => Buffer.from("unrelated-fixture-process");
    const reused = await reapStaleSidecars(GRACES);
    assert.equal(reused.unresolved[0].reason, "PID_REUSED_DESCENDANTS_UNKNOWN");
    assert.equal(isAlive(child.pid), true);
    assert.deepEqual(sidecarPidFile.readAll(), [{ name: "qdrant", pid: child.pid }]);
  }
);

test(
  "an empty successful inspection is unknown, never positive PID reuse",
  { timeout: 10000 },
  async (t) => {
    createUserDataDir(t);
    const child = await spawnFakeSidecar(t, {
      scriptName: "qdrant-empty.js",
      ignoreSigterm: false,
    });
    sidecarPidFile.write("qdrant", child.pid);
    const run = cp.execFileSync;
    cp.execFileSync = () => Buffer.from("");
    t.after(() => {
      cp.execFileSync = run;
    });
    const result = await reapStaleSidecars(GRACES);
    assert.equal(result.unresolved[0].reason, "INSPECTION_UNAVAILABLE");
    assert.equal(isAlive(child.pid), true);
    assert.deepEqual(sidecarPidFile.readAll(), [{ name: "qdrant", pid: child.pid }]);
  }
);
