const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createDb } = require("./harness/db");
const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder, MEMORY_LIMIT } = require("../../src/helpers/privacy/flightRecorder");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { attachPrivacyIPC } = require("../../src/helpers/privacy/privacyIPC");

// Task 15 fix round 1 (I1). Turning local history off makes NEW records
// memory-only; records saved before it was turned off stay in SQLite, stay
// listed and survive a restart. The panel's and the docs' copy must say so.

const root = path.join(__dirname, "../..");
const rowCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM egress_events").get().n;

// One app run: the real recorder over the shared database, the real gate as
// producer and main's privacy IPC as the reader the panel uses.
function boot(t, db, clock, { history }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-recorder-history-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recorder = new FlightRecorder({ now: () => clock.now });
  recorder.attachDatabase(db);
  recorder.setPersistence(history);
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => false, recorder, now: () => clock.now });
  const handlers = new Map();
  const win = { webContents: { send() {}, mainFrame: {} }, isDestroyed: () => false };
  const ipc = attachPrivacyIPC({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn), removeHandler: (c) => handlers.delete(c) },
    BrowserWindow: { getAllWindows: () => [win] },
    dialog: {},
    state: new SealedState({ profile: dir }),
    recorder,
    transition: Object.assign(new EventEmitter(), {
      apply: async () => {},
      recheck() {},
      snapshot: () => ({ phase: "open", effectiveSince: null, failures: [], notes: [] }),
    }),
    attest: () => ({}),
    isTrustedSender: () => true,
    confirm: { unseal: async () => true, clear: async () => true, openLink: async () => true },
    now: () => clock.now,
  });
  const invoke = (channel, ...args) =>
    handlers.get(channel)({ sender: win.webContents, senderFrame: {} }, ...args);
  const send = (task) => {
    const ticket = gate.authorize({
      task,
      target: "https://api.groq.com",
      provider: "groq",
      payload: "text",
    });
    ticket.markDispatched();
    clock.now += 1000;
    ticket.settle({ outcome: "ok", bytesOut: 10, bytesIn: 20 });
    clock.now += 1000;
  };
  return {
    recorder,
    invoke,
    send,
    stop() {
      ipc.dispose();
      gate._resetForTests();
    },
  };
}

test("history off: new records stay in memory, earlier saved records stay on disk and listed", async (t) => {
  const manager = createDb(t);
  if (!manager) return;
  t.after(() => gate._resetForTests());
  const db = manager.db;
  const clock = { now: new Date(2026, 9, 15, 9, 0).getTime() };
  const since = new Date(2026, 9, 15).getTime();

  // History on: the request is written to SQLite.
  const first = boot(t, db, clock, { history: true });
  first.send("chat");
  assert.equal(rowCount(db), 1);

  // The user turns local history off; a new request is kept in memory only.
  first.recorder.setPersistence(false);
  first.send("translation");
  assert.equal(rowCount(db), 1, "nothing new is written while history is off");
  const listed = await first.invoke("privacy:egress-list", { since, limit: 500 });
  assert.deepEqual(
    listed.map((e) => [e.task, e.id > 0 ? "disk" : "memory"]),
    [
      ["translation", "memory"],
      ["chat", "disk"],
    ],
    "the earlier saved record is still listed beside the new memory-only one"
  );
  const summary = await first.invoke("privacy:egress-summary", { since });
  assert.equal(summary.observed, 2);
  first.stop();

  // Restart with history still off: the memory-only record is gone, the
  // earlier saved record is still on this computer and still listed.
  clock.now += 60000;
  const second = boot(t, db, clock, { history: false });
  const after = await second.invoke("privacy:egress-list", { since, limit: 500 });
  assert.deepEqual(
    after.map((e) => [e.task, e.id > 0 ? "disk" : "memory"]),
    [["chat", "disk"]]
  );
  assert.equal(rowCount(db), 1);
  // It stays until retention removes it or the user clears it.
  second.recorder.prune({ retentionDays: 0 });
  assert.equal(rowCount(db), 1, "Forever retention keeps it");
  assert.equal(await second.invoke("privacy:egress-clear"), true);
  assert.equal(rowCount(db), 0, "Clear history removes it");
  second.stop();

  // The copy says exactly that, in the panel and in the docs.
  const en = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8"))
    .settingsPage.privacy.recorder;
  assert.equal(
    en.retentionMemory,
    `Local history is off: new records are kept in memory only (the newest ${MEMORY_LIMIT}) and are gone when Loqui quits. Records saved before you turned it off stay on this computer until your retention setting removes them or you clear them.`
  );
  const privacy = fs.readFileSync(path.join(root, "docs/PRIVACY.md"), "utf8");
  assert.match(
    privacy,
    /Turning local history off affects new records only\. New records are kept in memory only \(the newest 500\) and disappear when Loqui quits/
  );
  assert.match(
    privacy,
    /Records saved before you turned local history off stay on this computer, and stay listed, until retention deletes them or you clear them\./
  );
  const design = fs.readFileSync(path.join(root, "DESIGN.md"), "utf8");
  assert.match(design, /new records are in memory only \(the newest 500\)/);
  assert.match(design, /records saved before history was turned off stay/);
});
