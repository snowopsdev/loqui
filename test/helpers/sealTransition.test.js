const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const gate = require("../../src/helpers/privacy/egressGate");
const backstop = require("../../src/helpers/privacy/egressBackstop");
const children = require("../../src/helpers/privacy/childRegistry");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { createSealTransition, createAttestor } = require("../../src/helpers/privacy/privacyBoot");

function harness(t, hooks = true) {
  gate._resetForTests();
  children._resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-transition-"));
  const state = new SealedState({ profile: dir });
  gate.configureEgress({ isSealed: () => state.isSealed() });
  const log = [];
  const inference = hooks
    ? {
        codexRunning: () => false,
        stopCodex: async () => {
          log.push("codex.stop");
        },
      }
    : {};
  const updates = hooks
    ? {
        pauseForSeal: () => log.push("updates.pause"),
        resumeAfterSeal: () => log.push("updates.resume"),
      }
    : {};
  const calendar = {
    stop: () => log.push("calendar.stop"),
    start: () => log.push("calendar.start"),
  };
  let clock = 1000;
  const transition = createSealTransition({
    state,
    bootedAt: 500,
    getInference: () => inference,
    getUpdateManager: () => updates,
    getCalendars: () => [calendar, null],
    children,
    nativeBoundary: children.getNativeBoundary(),
    now: () => clock++,
    waitMs: 5,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  const attest = createAttestor({
    state,
    transition,
    getInference: () => inference,
    children,
    nativeBoundary: children.getNativeBoundary(),
  });
  t.after(() => {
    gate._resetForTests();
    children._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { state, log, inference, updates, transition, attest };
}

test("empty counters and children never verify 07a on any platform", async (t) => {
  const h = harness(t);
  await h.transition.apply(true);
  assert.equal(h.state.isSealed(), true);
  assert.equal(h.transition.snapshot().phase, "sealing");
  assert.equal(h.attest().effectiveSince, null);
  assert.equal(h.attest().nothingLeaves, false);
  assert.ok(h.attest().failures.includes("NATIVE_BOUNDARY_UNAVAILABLE"));
  assert.equal(h.attest().isolation.selfTest, "unavailable");
  assert.deepEqual(h.attest().paused, []);
  h.transition.recheck();
  assert.ok(h.attest().failures.includes("NATIVE_BOUNDARY_UNAVAILABLE"));
  assert.equal(h.attest().nothingLeaves, false);
});

test("admission closes synchronously, remote tickets abort, retained transport remains until end", async (t) => {
  const h = harness(t);
  const remote = gate.authorize({ task: "chat", target: "https://example.test" });
  const local = gate.authorize({ task: "chat", target: "http://127.0.0.1:1" });
  const release = remote.retainTransport();
  const pending = h.transition.apply(true);
  assert.equal(h.state.isSealed(), true);
  assert.throws(() => gate.authorize({ task: "chat", target: "https://refused.test" }), {
    code: "SEALED_MODE",
  });
  await pending;
  assert.equal(remote.signal.aborted, true);
  assert.equal(local.signal.aborted, false);
  remote.settle({ outcome: "cancelled" });
  h.transition.recheck();
  assert.ok(h.attest().failures.includes("timeout:tickets"));
  release();
  h.transition.recheck();
  assert.equal(h.attest().failures.includes("timeout:tickets"), false);
  assert.equal(h.attest().effectiveSince, null);
  local.discard();
});

test("missing and rejected later-task hooks remain named failures after recheck", async (t) => {
  const h = harness(t, false);
  await h.transition.apply(true);
  h.transition.recheck();
  assert.ok(h.attest().failures.includes("codexStopUnavailable"));
  assert.ok(h.attest().failures.includes("updatesPauseUnavailable"));
  await h.transition.apply(false);
  h.inference.stopCodex = async () => {
    throw Error("secret exception");
  };
  await h.transition.apply(true);
  h.transition.recheck();
  assert.ok(h.attest().failures.includes("codexStop"));
  assert.doesNotMatch(JSON.stringify(h.attest()), /secret exception/);
});

test("real registry keeps ended roots and legacy records named without sealed ps inspection", async (t) => {
  const h = harness(t);
  children._setSystemForTests({
    listProcesses: () => {
      throw Error("must not inspect sealed");
    },
  });
  children.recordUnresolved({
    kind: "saved-whisper",
    pid: 345,
    reason: "INSPECTION_REFUSED_SEALED",
  });
  const root = Object.assign(new EventEmitter(), {
    pid: 123,
    kill() {
      root.emit("exit", null, "SIGTERM");
    },
  });
  children.register(root, { kind: "qdrant", tree: true, local: true });
  await h.transition.apply(true);
  h.transition.recheck();
  assert.ok(h.attest().failures.includes("childStop"));
  assert.ok(h.attest().failures.includes("timeout:children"));
  assert.deepEqual(h.attest().children, [
    { kind: "qdrant", pid: 123, local: true },
    { kind: "saved-whisper", pid: 345, local: true },
  ]);
  assert.ok(
    h.attest().childDiagnostics.unresolved.some((e) => e.kind === "qdrant" && e.rootExited)
  );
  assert.ok(
    h
      .attest()
      .failures.some((f) => f.includes("saved-whisper") && f.includes("INSPECTION_REFUSED_SEALED"))
  );
});

test("rapid seal/unseal/seal is serialized and cannot reopen admission mid barrier", async (t) => {
  const h = harness(t);
  let finish;
  h.inference.stopCodex = () =>
    new Promise((r) => {
      finish = r;
    });
  const first = h.transition.apply(true);
  await new Promise((r) => setImmediate(r));
  const second = h.transition.apply(false);
  const third = h.transition.apply(true);
  assert.equal(h.state.isSealed(), true);
  finish();
  await first;
  h.inference.stopCodex = async () => {};
  await Promise.all([second, third]);
  assert.equal(h.state.isSealed(), true);
  assert.equal(h.attest().phase, "sealing");
  assert.equal(h.attest().effectiveSince, null);
  assert.equal(h.attest().nothingLeaves, false);
});

test("Chromium evidence survives sealing and only observed completion clears timeout", async (t) => {
  const h = harness(t);
  const listeners = {};
  let resets = 0;
  const session = {
    closeAllConnections() {
      resets++;
    },
    webRequest: new Proxy(
      {},
      {
        get: (_, name) => (fn) => {
          listeners[name] = fn;
        },
      }
    ),
  };
  backstop.watchSession(session);
  await new Promise((r) =>
    listeners.onBeforeRequest({ id: 912, url: "https://example.test/a", webContentsId: 1 }, r)
  );
  await h.transition.apply(true);
  assert.ok(h.attest().failures.includes("timeout:chromium"));
  assert.equal(resets, 0);
  listeners.onCompleted({ id: 912, statusCode: 200 });
  h.transition.recheck();
  assert.equal(h.attest().failures.includes("timeout:chromium"), false);
  assert.equal(h.attest().nothingLeaves, false);
});

test("a seal arriving while calendars resume never publishes open or resumes updates", async (t) => {
  const h = harness(t);
  await h.transition.apply(true);
  let resumed;
  let release;
  const calendars = [
    {
      stop() {},
      start: () => {
        resumed = true;
        return new Promise((r) => {
          release = r;
        });
      },
    },
  ];
  const transition = createSealTransition({
    state: h.state,
    children,
    getInference: () => h.inference,
    getUpdateManager: () => h.updates,
    getCalendars: () => calendars,
    waitMs: 1,
  });
  const phases = [];
  transition.on("change", (s) => phases.push([h.state.isSealed(), s.phase]));
  const off = transition.apply(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(resumed, true);
  const on = transition.apply(true);
  release();
  await Promise.all([off, on]);
  assert.equal(h.log.includes("updates.resume"), false);
  assert.equal(
    phases.some(([sealed, phase]) => sealed && phase === "open"),
    false
  );
  assert.equal(transition.snapshot().phase, "sealing");
});

test("the production attestor remains unavailable on Darwin, Linux and Windows", (t) => {
  const h = harness(t);
  h.state.set(true);
  const vm = require("node:vm");
  const filename = require.resolve("../../src/helpers/privacy/privacyBoot");
  const requireLocal = require("node:module").createRequire(filename);
  for (const platform of ["darwin", "linux", "win32"]) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
      module,
      require: requireLocal,
      process: { platform },
      setTimeout,
    });
    const attest = module.exports.createAttestor({
      state: h.state,
      transition: h.transition,
      children,
    });
    const result = attest();
    assert.equal(result.isolation.platform, platform);
    assert.equal(result.isolation.reason, "NATIVE_BOUNDARY_UNAVAILABLE");
    assert.equal(result.nothingLeaves, false);
    assert.equal(result.effectiveSince, null);
    assert.equal(result.paused.length, 0);
  }
});
