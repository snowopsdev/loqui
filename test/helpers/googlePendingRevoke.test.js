// Owner decision D-1 (2026-10-23): a Google calendar disconnect while sealed
// keeps a main-owned pending revoke, which main runs automatically once
// Loqui is unsealed. Real GoogleCalendarManager, OAuth helper, pending store,
// gate and flight recorder; only Electron's net.fetch and window list are
// fakes, so no request leaves this process. The pending record lives in this
// test's own temporary directory, encrypted with a fake cipher.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fetches = [];
const sent = [];
let respond = null;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => os.tmpdir(), isReady: () => false, getName: () => "test" },
      net: {
        fetch: async (url, init) => {
          fetches.push({ url: String(url), body: String(init?.body ?? "") });
          return respond ? respond(String(url), init) : new Response("{}", { status: 200 });
        },
      },
      shell: { openExternal: async () => {} },
      BrowserWindow: {
        getAllWindows: () => [
          { isDestroyed: () => false, webContents: { send: (c, d) => sent.push([c, d]) } },
        ],
      },
    };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => {
  Module._load = originalLoad;
});

const gate = require("../../src/helpers/privacy/egressGate");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const GoogleCalendarManager = require("../../src/helpers/googleCalendarManager");
const { PENDING_REVOKE_FILE } = require("../../src/helpers/googlePendingRevoke");

let sealed;
let rows;
let dir;
const managers = [];
test.beforeEach(() => {
  fetches.length = 0;
  sent.length = 0;
  respond = null;
  sealed = true;
  let clock = 0;
  const recorder = new FlightRecorder({ now: () => ++clock });
  rows = [];
  recorder.on("event", (row) => rows.push(row));
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => sealed, recorder, now: () => ++clock });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-pending-revoke-"));
});
test.afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop();
  gate._resetForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});

// A reversible stand-in for secretCrypto: the stored bytes never hold the token.
const cipher = {
  available: true,
  isAvailable() {
    return this.available;
  },
  encrypt: (text) => Buffer.from(Buffer.from(text, "utf8").map((b) => b ^ 0x5a)),
  decrypt: (buffer) => ({ value: Buffer.from(buffer.map((b) => b ^ 0x5a)).toString("utf8") }),
};
function fakeDb(tokens) {
  const db = {
    tokens: tokens.map((t) => ({ ...t })),
    getAllGoogleTokens: () => db.tokens.map((t) => ({ ...t })),
    getGoogleAccounts: () => db.tokens.map((t) => ({ email: t.google_email })),
    getSelectedCalendars: () => [],
    removeGoogleAccount: (email) => {
      db.tokens = db.tokens.filter((t) => t.google_email !== email);
    },
    clearGoogleCalendarData: () => {
      db.tokens = [];
    },
  };
  return db;
}
const ACCOUNT = {
  google_email: "user@example.test",
  access_token: "fixture-access",
  refresh_token: "fixture-refresh",
  expires_at: Date.now() + 3_600_000,
};
function manager(db = fakeDb([ACCOUNT]), options = { pendingRevoke: { dir, crypto: cipher } }) {
  const m = new GoogleCalendarManager(db, null, { scheduleNextMeeting() {}, reset() {} }, options);
  managers.push(m);
  return m;
}
const file = () => path.join(dir, PENDING_REVOKE_FILE);
const revokeFetches = () => fetches.filter((f) => f.url === "https://oauth2.googleapis.com/revoke");
const events = () => sent.filter(([c]) => c === "gcal-pending-revoke").map(([, d]) => d);
const settle = async (m) => {
  for (let i = 0; i < 50 && m.pendingRevoke.status().running; i++)
    await new Promise((r) => setTimeout(r, 2));
  await new Promise((r) => setTimeout(r, 2));
};

test("sealed disconnect → unseal → the revoke runs once → the kept token is deleted", async () => {
  const db = fakeDb([ACCOUNT]);
  const m = manager(db);
  m._loadAccounts();
  assert.deepEqual(m.disconnectAccount(ACCOUNT.google_email), { pendingRevoke: 1 });
  assert.deepEqual(db.tokens, [], "Loqui's own copy is gone at once");
  assert.equal(revokeFetches().length, 0, "nothing is sent while sealed");
  assert.ok(fs.existsSync(file()), "the pending revoke is kept");
  assert.equal(
    fs.readFileSync(file()).includes(Buffer.from("fixture-refresh")),
    false,
    "the kept token is stored encrypted"
  );
  assert.deepEqual(
    events().map((e) => [e.kind, e.status.pending]),
    [["queued", 1]]
  );

  sealed = false;
  m.resumeAfterSeal(); // what the seal transition calls after unsealing
  m.resumeAfterSeal(); // a second trigger joins the same run
  await settle(m);
  assert.equal(revokeFetches().length, 1, "exactly one revoke");
  assert.equal(
    revokeFetches()[0].body,
    "token=fixture-refresh",
    "the refresh token revokes the grant"
  );
  assert.equal(fs.existsSync(file()), false, "the kept token is deleted");
  assert.deepEqual(m.pendingRevoke.status(), {
    pending: 0,
    failed: 0,
    unreadable: false,
    running: false,
  });
  assert.deepEqual(events().at(-1).kind, "revoked");
  // A ticketed calendar request, listed in the flight recorder.
  assert.deepEqual(
    rows.filter((r) => r.host === "oauth2.googleapis.com").map((r) => [r.task, r.outcome]),
    [["calendar", "ok"]]
  );
  m.resumeAfterSeal();
  await settle(m);
  assert.equal(revokeFetches().length, 1, "nothing left to revoke");
});

test("a failed revoke stays pending and says so; Retry then succeeds", async () => {
  const m = manager();
  m._loadAccounts();
  m.disconnectAccount();
  sealed = false;
  respond = () => new Response('{"error":"backend"}', { status: 503 });
  m.resumeAfterSeal();
  await settle(m);
  assert.equal(revokeFetches().length, 1);
  assert.ok(fs.existsSync(file()), "kept for a retry");
  assert.deepEqual([m.pendingRevoke.status().pending, m.pendingRevoke.status().failed], [1, 1]);
  assert.deepEqual([events().at(-1).kind, events().at(-1).failed], ["failed", 1]);

  respond = () => new Response("", { status: 200 });
  assert.deepEqual(await m.pendingRevoke.retry(), { revoked: 1, failed: 0 });
  assert.equal(revokeFetches().length, 2);
  assert.equal(fs.existsSync(file()), false);
  assert.equal(events().at(-1).kind, "revoked");
});

test("Google's invalid_token answer means the grant is already gone", async () => {
  const m = manager();
  m._loadAccounts();
  m.disconnectAccount();
  sealed = false;
  respond = () => new Response('{"error":"invalid_token"}', { status: 400 });
  m.resumeAfterSeal();
  await settle(m);
  assert.equal(fs.existsSync(file()), false);
});

test("the pending revoke survives a restart before unsealing, and runs at the next unsealed start", async () => {
  const first = manager();
  first._loadAccounts();
  first.disconnectAccount();
  first.stop();
  // Restart, still sealed: a new manager and store read the same record.
  const sealedStart = manager(fakeDb([]));
  assert.equal(sealedStart.pendingRevoke.status().pending, 1);
  sealedStart.resumeAfterSeal(); // a sealed hook call must not run it
  await settle(sealedStart);
  assert.equal(revokeFetches().length, 0);
  // Another restart, now unsealed: start() runs it.
  sealed = false;
  const unsealedStart = manager(fakeDb([]));
  unsealedStart.start();
  await settle(unsealedStart);
  assert.equal(revokeFetches().length, 1);
  assert.equal(fs.existsSync(file()), false);
});

test("never revokes while sealed: automatic runs skip, Retry is refused by the gate", async () => {
  const m = manager();
  m._loadAccounts();
  m.disconnectAccount();
  m.start();
  m.resumeAfterSeal();
  assert.deepEqual(await m.pendingRevoke.runAutomatic(), {
    skipped: "sealed",
    revoked: 0,
    failed: 0,
  });
  // A Retry while sealed reaches only the gate: a typed refusal, nothing sent.
  assert.deepEqual(await m.pendingRevoke.retry(), { revoked: 0, failed: 1, sealed: true });
  assert.equal(fetches.length, 0, "no request left while sealed");
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome, r.bytesOut]),
    [["calendar", "oauth2.googleapis.com", "blocked", 0]]
  );
  assert.equal(m.pendingRevoke.status().pending, 1, "still pending");
});

test("a seal during an automatic run leaves the rest pending", async () => {
  const db = fakeDb([ACCOUNT, { ...ACCOUNT, google_email: "b@example.test", refresh_token: "r2" }]);
  const m = manager(db);
  m._loadAccounts();
  assert.deepEqual(m.disconnectAccount(), { pendingRevoke: 2 });
  sealed = false;
  respond = () => {
    sealed = true; // sealed while the first revoke is answered
    return new Response("{}", { status: 200 });
  };
  m.resumeAfterSeal();
  await settle(m);
  assert.equal(revokeFetches().length, 1, "the second revoke never starts sealed");
  assert.equal(m.pendingRevoke.status().pending, 1);
});

test("a sealed disconnect that cannot keep the token securely says so, and writes nothing", () => {
  cipher.available = false;
  try {
    const db = fakeDb([ACCOUNT]);
    const m = manager(db);
    m._loadAccounts();
    assert.deepEqual(m.disconnectAccount(), { googleGrantKept: true });
    assert.deepEqual(db.tokens, [], "the disconnect still happens");
    assert.equal(fs.existsSync(file()), false);
  } finally {
    cipher.available = true;
  }
});

test("an unsealed disconnect is unchanged: local only, no pending revoke", async () => {
  sealed = false;
  const db = fakeDb([ACCOUNT]);
  const m = manager(db);
  m._loadAccounts();
  assert.deepEqual(m.disconnectAccount(ACCOUNT.google_email), {});
  assert.deepEqual(db.tokens, []);
  assert.equal(fs.existsSync(file()), false);
  await settle(m);
  assert.equal(revokeFetches().length, 0);
});

test("Reset everything erases the record and reports how many grants may remain", () => {
  const m = manager();
  m._loadAccounts();
  m.disconnectAccount();
  assert.deepEqual(m.pendingRevoke.erase(), { erased: 1 });
  assert.equal(fs.existsSync(file()), false);
  assert.equal(m.pendingRevoke.status().pending, 0);
});
