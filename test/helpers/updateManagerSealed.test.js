const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nodeTest = require("node:test");
// Bounded: a regression must fail, never hang on a fake transport.
const test = Object.assign((name, fn) => nodeTest(name, { timeout: 10000 }, fn), {
  after: nodeTest.after,
  beforeEach: nodeTest.beforeEach,
  afterEach: nodeTest.afterEach,
});
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { isSealedModeError, sealedPhaseOf } = require("../../src/helpers/privacy/egressPolicy");
const { UpdateManager, DAY } = require("../../src/helpers/updateManager");

// App updates (threat model N16) through the real UpdateManager, gate and
// recorder. The updater is a terminal fake: no feed is fetched, nothing is
// downloaded and nothing is installed.
function harness(
  t,
  { sealed = false, latest = "1.0.0", channel = "stable", enabled = true, wire = true } = {}
) {
  const flags = { sealed };
  let clock = 0;
  const recorder = new FlightRecorder({ now: () => ++clock });
  const rows = [];
  recorder.on("event", (row) => rows.push(row));
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => flags.sealed, recorder, now: () => ++clock });
  t.after(() => gate._resetForTests());
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-upd-"));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(profile, "updates.json"),
    JSON.stringify({ enabled, onboarded: true, lastCheck: 0, channel })
  );
  const calls = { check: 0, download: 0, install: 0, headersDuringCheck: null };
  const updater = Object.assign(new EventEmitter(), {
    requestHeaders: { "x-fixture": "kept" },
    check: null,
    async checkForUpdates() {
      calls.check++;
      calls.headersDuringCheck = { ...updater.requestHeaders };
      if (updater.check) return updater.check();
      return { updateInfo: { version: latest } };
    },
    downloadUpdate(token) {
      calls.download++;
      return new Promise((_resolve, reject) =>
        token.onCancel(() => {
          updater.emit("update-cancelled");
          reject(Object.assign(new Error("cancelled"), { name: "CancellationError" }));
        })
      );
    },
    quitAndInstall() {
      calls.install++;
    },
  });
  const manager = new UpdateManager({
    updater,
    profile,
    version: "1.0.0",
    supported: true,
    packaged: true,
    now: () => 10 * DAY,
    ...(wire ? { sealed: () => flags.sealed } : {}),
  });
  const published = [];
  manager.on("status", (s) => published.push(s));
  t.after(() => manager.dispose());
  return { flags, rows, calls, manager, updater, published };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function seal(h) {
  h.flags.sealed = true;
  gate.abortAllRemote();
  h.manager.pauseForSeal();
}

test("an automatic check is skipped while sealed and lastCheck is unchanged", async (t) => {
  const h = harness(t, { sealed: true });
  const status = await h.manager.check(false);
  assert.equal(h.calls.check, 0);
  assert.equal(h.manager.prefs.lastCheck, 0, "it runs once unsealed");
  assert.equal(status.sealed, true);
  assert.equal(h.rows.length, 0, "a skipped background check is not an attempt");
});

test("a manual check while sealed is refused, typed and recorded", async (t) => {
  const h = harness(t, { sealed: true });
  const error = await h.manager.check(true).catch((e) => e);
  assert.equal(sealedPhaseOf(error), "refused");
  assert.equal(h.calls.check, 0);
  assert.equal(h.manager.prefs.lastCheck, 0);
  assert.deepEqual(
    h.rows.map((r) => [r.task, r.host, r.outcome, r.bytesOut]),
    [["appUpdate", "github.com", "blocked", 0]]
  );
  assert.equal(h.manager.state.phase, "idle", "no error banner for a refusal");
});

test("the manager's default seal predicate is the gate's own (fail closed)", async (t) => {
  const h = harness(t, { sealed: true, wire: false });
  assert.equal(h.manager.status().sealed, true);
  await h.manager.check(false);
  assert.equal(h.calls.check, 0);
});

test("an unsealed check is one appUpdate operation whose tag rides the updater's own requests", async (t) => {
  const h = harness(t);
  await h.manager.check(true);
  assert.equal(h.calls.check, 1);
  const tag = h.calls.headersDuringCheck[gate.EGRESS_TAG_HEADER];
  assert.match(tag, /^\d+\./, "the backstop attributes electron-updater's session requests");
  assert.equal(h.calls.headersDuringCheck["x-fixture"], "kept");
  assert.deepEqual(h.updater.requestHeaders, { "x-fixture": "kept" }, "headers restored");
  assert.deepEqual(
    h.rows.map((r) => [r.task, r.host, r.outcome]),
    [["appUpdate", "github.com", "ok"]]
  );
  assert.equal(gate.activeRemoteCount(), 0);
});

test("pauseForSeal cancels a running download without counting a failure", async (t) => {
  const h = harness(t, { latest: "1.1.0" });
  // The automatic check downloads when automatic updates are on (D13 changes
  // only manual checks with them off).
  const pending = h.manager.check(false);
  await tick();
  assert.equal(h.manager.state.phase, "downloading");
  seal(h);
  const status = await pending;
  assert.equal(status.phase, "idle");
  assert.equal(status.sealed, true);
  assert.equal(h.manager.failures, 0);
  assert.equal(
    h.published.some((s) => s.phase === "error"),
    false
  );
  assert.deepEqual(
    h.rows.map((r) => [r.task, r.outcome, r.errorClass]),
    [["appUpdate", "cancelled", "SEALED_MODE"]]
  );
  assert.equal(gate.activeRemoteCount(), 0);
  // A late progress event from the cancelled download cannot resurrect it.
  h.updater.emit("download-progress", { percent: 50 });
  assert.equal(h.manager.state.phase, "idle");
});

test("a check that answers after sealing never starts the download", async (t) => {
  const h = harness(t, { latest: "1.1.0" });
  let answer;
  h.updater.check = () => new Promise((resolve) => (answer = resolve));
  const pending = h.manager.check(true);
  await tick();
  assert.equal(h.manager.state.phase, "checking");
  seal(h);
  assert.equal(h.manager.state.phase, "idle");
  answer({ updateInfo: { version: "1.1.0" } });
  const status = await pending;
  assert.equal(h.calls.download, 0, "no download while sealed");
  assert.equal(status.phase, "idle");
  assert.equal(h.manager.failures, 0);
  assert.deepEqual(
    h.rows.map((r) => [r.outcome, r.errorClass]),
    [["cancelled", "SEALED_MODE"]]
  );
});

test("seal and unseal always publish status, even when idle", (t) => {
  const h = harness(t);
  h.flags.sealed = true;
  h.manager.pauseForSeal();
  assert.equal(h.published.at(-1).sealed, true);
  h.flags.sealed = false;
  h.manager.resumeAfterSeal();
  assert.equal(h.published.at(-1).sealed, false);
});

test("D13 'available' survives sealing; turning automatic on while sealed waits for unseal", async (t) => {
  const h = harness(t, { latest: "1.1.0", enabled: false });
  await h.manager.check(true);
  assert.equal(h.manager.state.phase, "available");
  assert.equal(h.calls.download, 0, "a manual check with automatic off never downloads");
  seal(h);
  assert.equal(h.manager.state.phase, "available");
  assert.equal(h.manager.state.availableVersion, "1.1.0");
  const status = h.manager.preferences({ enabled: true });
  assert.equal(status.phase, "available", "still reported, not silently cleared");
  await tick();
  assert.equal(h.calls.check, 1, "no check is attempted while sealed");
  assert.equal(h.rows.filter((r) => r.outcome === "blocked").length, 0);
  h.flags.sealed = false;
  h.manager.resumeAfterSeal();
  await tick();
  assert.equal(h.calls.check, 2, "unsealing fetches it the way enabling would have");
  assert.equal(h.manager.state.phase, "downloading");
});

test("a ready update cannot be installed while sealed, even without the IPC wrapper", async (t) => {
  const h = harness(t);
  h.manager.state.phase = "ready";
  h.flags.sealed = true;
  await assert.rejects(h.manager.restart(), /NATIVE_BOUNDARY_UNAVAILABLE/);
  assert.equal(h.calls.install, 0);
  assert.equal(h.manager.restarting, false);
  // Sealing while the restart is being prepared also stops it before install.
  h.flags.sealed = false;
  h.manager.prepare = async () => {
    h.flags.sealed = true;
  };
  await assert.rejects(h.manager.restart(), /NATIVE_BOUNDARY_UNAVAILABLE/);
  assert.equal(h.calls.install, 0);
});

test("attachUpdateIPC hands the live seal predicate to the manager and its check channel", async (t) => {
  const { attachUpdateIPC } = require("../../src/helpers/updateIPC");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-update-ipc-"));
  gate._resetForTests();
  let sealed = false;
  let clock = 0;
  const recorder = new FlightRecorder({ now: () => ++clock });
  gate.configureEgress({ isSealed: () => sealed, recorder });
  t.after(() => {
    gate._resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.writeFileSync(
    path.join(dir, "updates.json"),
    JSON.stringify({ enabled: true, onboarded: false, lastCheck: 0, channel: "stable" })
  );
  const handlers = new Map();
  const ipcMain = Object.assign(new EventEmitter(), {
    handle: (name, fn) => handlers.set(name, fn),
  });
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL() {},
    async checkForUpdates() {
      throw new Error("must not be called");
    },
  });
  const window = {
    isDestroyed: () => false,
    webContents: { id: 1, getURL: () => "file:///app/index.html", send() {} },
  };
  const manager = attachUpdateIPC({
    app: { getPath: () => dir, getVersion: () => "1.0.0", isPackaged: true },
    ipcMain,
    BrowserWindow: { getAllWindows: () => [window] },
    updater,
    busy: () => false,
    activity: { lock() {} },
    teardown: async () => {},
    sealed: () => sealed,
  });
  t.after(() => manager.dispose());
  manager.supported = true;
  manager.prefs.onboarded = true;
  assert.equal(manager.status().sealed, false);
  sealed = true;
  assert.equal(manager.status().sealed, true, "the predicate is read live");
  const error = await handlers
    .get("loqui-update:check")({ sender: window.webContents })
    .catch((e) => e);
  assert.equal(isSealedModeError(new Error(error.message)), true, "typed across IPC");
});

test("the seal transition finds the update hooks Task 7 left pending", async (t) => {
  const h = harness(t, { latest: "1.1.0" });
  const { createSealTransition } = require("../../src/helpers/privacy/privacyBoot");
  const state = { sealed: false, isSealed: () => state.sealed, set: (v) => (state.sealed = v) };
  gate.configureEgress({ isSealed: () => state.sealed, recorder: null });
  h.flags.sealed = false;
  const manager = h.manager;
  manager.sealed = () => state.sealed;
  const transition = createSealTransition({
    state,
    getUpdateManager: () => manager,
    children: { diagnostics: () => ({ unresolved: [] }), alive: () => [], stopAll: async () => {} },
    waitMs: 20,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  const pending = manager.check(false);
  await tick();
  assert.equal(manager.state.phase, "downloading");
  await transition.apply(true);
  const sealedFailures = transition.snapshot().failures;
  assert.equal(sealedFailures.includes("updatesPauseUnavailable"), false);
  assert.equal(sealedFailures.includes("updatesPause"), false);
  assert.equal((await pending).phase, "idle");
  assert.equal(h.calls.download, 1);
  await transition.apply(false);
  assert.deepEqual(transition.snapshot().failures, [], "updatesResume is supplied too");
  assert.equal(h.published.at(-1).sealed, false);
});
