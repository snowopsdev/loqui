const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const { createDb } = require("./harness/db");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { DEFAULT_RETENTION_SETTINGS } = require("../../src/helpers/retentionSettings");
function inert() {
  return new Proxy(function () {}, {
    get: (_, key) =>
      key === "then" ? undefined : key === Symbol.iterator ? function* () {} : inert(),
    apply: () => inert(),
    construct: () => inert(),
  });
}
function fixture(t) {
  const db = createDb(t);
  if (!db) return;
  gate._resetForTests();
  t.after(() => gate._resetForTests());
  const recorder = new FlightRecorder({ db: db.db, now: () => 100 * 86400000 });
  gate.configureEgress({ isSealed: () => false, recorder });
  const handlers = new Map();
  const appCalls = [];
  let sweep;
  let cadence;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../src/helpers/ipcHandlers"), "utf8"), {
    module,
    process,
    setTimeout,
    clearTimeout,
    setInterval: (fn, ms) => {
      sweep = fn;
      cadence = ms;
      return {};
    },
    require: (name) => {
      if (name === "electron")
        return {
          ipcMain: {
            handle: (channel, fn) => handlers.set(channel, fn),
            on: (channel, fn) => handlers.set(channel, fn),
          },
          app: {
            on() {},
            quit() {
              appCalls.push("quit");
            },
            relaunch() {
              appCalls.push("relaunch");
            },
          },
        };
      if (name === "./privacy/egressGate") return gate;
      if (name === "./retentionSettings") return require("../../src/helpers/retentionSettings");
      return inert();
    },
  });
  const IPC = module.exports;
  const owner = {};
  const context = new Proxy(
    {
      windowManager: { mainWindow: { webContents: owner } },
      _retentionSettings: { ...DEFAULT_RETENTION_SETTINGS },
      _retentionSettingsSynced: false,
      _ensureAnalyticsHistoryBackfilled: () => Promise.resolve(),
      databaseManager: {
        deleteTranscriptionsExpiredBefore: () => ({ ids: [], analyticsPurged: 0 }),
      },
      audioStorageManager: { cleanupExpiredAudio() {} },
    },
    { get: (obj, key) => (key in obj ? obj[key] : inert()) }
  );
  context._runRetentionCleanup = () => IPC.prototype._runRetentionCleanup.call(context);
  IPC.prototype.setupHandlers.call(context);
  IPC.prototype._setupRetentionCleanup.call(context);
  return {
    recorder,
    appCalls,
    db,
    context,
    owner,
    handlers,
    sync: handlers.get("retention-settings-changed"),
    sweep,
    cadence,
  };
}

test("registered first sync and six-hour sweep apply recorder persistence and retention without promoting private rows", (t) => {
  const h = fixture(t);
  if (!h) return;
  const event = (ts) => ({ task: "chat", host: "example.test", outcome: "ok", ts });
  h.recorder.record(event(99 * 86400000));
  h.sweep();
  assert.equal(h.recorder.mode, "pending");
  h.sync({ sender: {} }, { dataRetentionEnabled: false });
  assert.equal(h.recorder.mode, "pending");
  h.sync(
    { sender: h.owner },
    { dataRetentionEnabled: false, audioRetentionDays: 0, transcriptRetentionDays: 0 }
  );
  assert.equal(h.recorder.mode, "memory");
  h.recorder.record(event(99 * 86400000 + 1));
  h.sync({ sender: h.owner }, { dataRetentionEnabled: true });
  assert.equal(h.db.db.prepare("SELECT count(*) n FROM egress_events").get().n, 0);
  h.recorder.record(event(98 * 86400000));
  h.recorder.record(event(100 * 86400000));
  h.context._retentionSettings.transcriptRetentionDays = 1;
  h.sweep();
  assert.equal(h.cadence, 6 * 60 * 60 * 1000);
  assert.equal(h.db.db.prepare("SELECT count(*) n FROM egress_events").get().n, 1);
  assert.equal(h.recorder.list({ since: 0 }).length, 3);
});

test("ledger sweep still prunes when transcript cleanup fails and exposes recorder errors", (t) => {
  const h = fixture(t);
  if (!h) return;
  h.sync({ sender: h.owner }, { dataRetentionEnabled: true, transcriptRetentionDays: 1 });
  h.recorder.record({ task: "chat", host: "example.test", outcome: "ok", ts: 1 });
  h.context.databaseManager.deleteTranscriptionsExpiredBefore = () => {
    throw Error("unrelated");
  };
  h.sweep();
  assert.equal(h.recorder.list({ since: 0 }).length, 0);
  h.db.db.exec("DROP TABLE egress_events");
  h.sweep();
  assert.ok(h.recorder.persistError);
  assert.doesNotMatch(h.recorder.persistError, /no such table/);
});

test("registered relaunch refuses sealed before waiter scheduling, quit or app.relaunch", async (t) => {
  const h = fixture(t);
  if (!h) return;
  gate.configureEgress({ isSealed: () => true, recorder: h.recorder });
  await assert.rejects(
    h.handlers.get("relaunch-app")({ sender: h.owner }),
    /NATIVE_BOUNDARY_UNAVAILABLE/
  );
  assert.deepEqual(h.appCalls, []);
});
