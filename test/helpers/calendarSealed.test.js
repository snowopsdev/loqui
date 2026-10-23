// Task 11 (N19/N20): remote calendars, their background sync and pending
// OAuth sign-ins while sealed. Real managers, OAuth helpers, loopback flow,
// gate, recorder and seal transition; only Electron's net/shell leaves are
// fakes. The OAuth loopback listeners are the product's own numeric
// 127.0.0.1 listeners, created in this process; no other host is contacted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fetches = [];
const opened = [];
let respond = null;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => os.tmpdir(), isReady: () => false, getName: () => "test" },
      net: {
        fetch: async (url, init) => {
          fetches.push({ url: String(url), init });
          return respond ? respond(String(url), init) : new Response("{}", { status: 200 });
        },
      },
      shell: {
        openExternal: async (url) => {
          opened.push(url);
        },
      },
      BrowserWindow: { getAllWindows: () => [] },
    };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => {
  Module._load = originalLoad;
});

const gate = require("../../src/helpers/privacy/egressGate");
const children = require("../../src/helpers/privacy/childRegistry");
const { FlightRecorder } = require("../../src/helpers/privacy/flightRecorder");
const { SealedState } = require("../../src/helpers/privacy/sealedState");
const { createSealTransition } = require("../../src/helpers/privacy/privacyBoot");
const {
  SealedModeError,
  isSealedModeError,
  sealedPhaseOf,
} = require("../../src/helpers/privacy/egressPolicy");
const { createCalendarGuard } = require("../../src/helpers/privacy/calendarGuard");
const {
  runOAuthLoopbackFlow,
  cancelAllOAuthFlows,
  activeOAuthFlowCount,
} = require("../../src/helpers/oauthLoopbackFlow");
const GoogleCalendarOAuth = require("../../src/helpers/googleCalendarOAuth");
const MicrosoftCalendarOAuth = require("../../src/helpers/microsoftCalendarOAuth");
const GoogleCalendarManager = require("../../src/helpers/googleCalendarManager");
const MicrosoftCalendarManager = require("../../src/helpers/microsoftCalendarManager");
const CalendarSyncInterval = require("../../src/helpers/calendarSyncInterval");

let sealed;
let rows;
const managers = [];
test.beforeEach(() => {
  fetches.length = 0;
  opened.length = 0;
  respond = null;
  sealed = true;
  let clock = 0;
  const recorder = new FlightRecorder({ now: () => ++clock });
  rows = [];
  recorder.on("event", (row) => rows.push(row));
  gate._resetForTests();
  gate.configureEgress({ isSealed: () => sealed, recorder, now: () => ++clock });
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client";
  process.env.MICROSOFT_CALENDAR_CLIENT_ID = "client";
});
test.afterEach(() => {
  cancelAllOAuthFlows(new Error("test cleanup"));
  for (const manager of managers.splice(0)) manager.stop();
  gate._resetForTests();
  delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
  delete process.env.MICROSOFT_CALENDAR_CLIENT_ID;
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(predicate, what) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await tick(5);
  }
  throw new Error(`timed out waiting for ${what}`);
}
// The transition's synchronous seal step: close admission, abort remote tickets.
function seal() {
  sealed = true;
  gate.abortAllRemote();
}
// A fetch that only ends when its signal aborts (a slow provider).
const hang = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const interrupted = (e) => isSealedModeError(e) && sealedPhaseOf(e) === "interrupted";
const refused = (e) => isSealedModeError(e) && sealedPhaseOf(e) === "refused";

function googleManager(db = {}) {
  const manager = new GoogleCalendarManager(
    { getGoogleAccounts: () => [], getSelectedCalendars: () => [], ...db },
    null,
    { scheduleNextMeeting() {}, reset() {} }
  );
  managers.push(manager);
  return manager;
}
function microsoftManager(db = {}) {
  const manager = new MicrosoftCalendarManager(
    { getMicrosoftAccounts: () => [], getSelectedMicrosoftCalendars: () => [], ...db },
    { scheduleNextMeeting() {}, reset() {} }
  );
  managers.push(manager);
  return manager;
}

// ------------------------------------------------------------ N19 requests

test("sealed: a Google token exchange is refused before net.fetch and recorded", async () => {
  const oauth = new GoogleCalendarOAuth({});
  await assert.rejects(oauth.exchangeCodeForTokens("code", "http://127.0.0.1:1", "v"), refused);
  assert.deepEqual(fetches, []);
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome, r.bytesOut]),
    [["calendar", "oauth2.googleapis.com", "blocked", 0]]
  );
});

test("sealed: a Google token refresh and a Calendar API read are refused", async () => {
  const oauth = new GoogleCalendarOAuth({});
  await assert.rejects(oauth.refreshAccessToken("refresh"), refused);
  const manager = googleManager();
  manager.oauth = { getValidAccessToken: async () => "token" };
  await assert.rejects(manager._apiGet("/users/me/calendarList", "me@example.test"), refused);
  assert.deepEqual(fetches, []);
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome]),
    [
      ["calendar", "oauth2.googleapis.com", "blocked"],
      ["calendar", "www.googleapis.com", "blocked"],
    ]
  );
});

test("sealed: Microsoft token exchange, Graph /me and Graph reads are refused", async () => {
  const oauth = new MicrosoftCalendarOAuth({});
  await assert.rejects(oauth.exchangeCodeForTokens("code", "http://127.0.0.1:1", "v"), refused);
  // The /me fallback used to swallow every failure as "no email"; a seal is
  // reported as a seal.
  await assert.rejects(oauth._resolveEmail({ access_token: "a" }), refused);
  const manager = microsoftManager();
  manager.oauth = { getValidAccessToken: async () => "token" };
  await assert.rejects(manager._apiGet("/me/calendars", "me@example.test"), refused);
  assert.deepEqual(fetches, []);
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome]),
    [
      ["calendar", "login.microsoftonline.com", "blocked"],
      ["calendar", "graph.microsoft.com", "blocked"],
      ["calendar", "graph.microsoft.com", "blocked"],
    ]
  );
});

test("unsealed calendar requests go out tagged, metered and recorded", async () => {
  sealed = false;
  respond = () => json({ items: [] });
  const manager = googleManager();
  manager.oauth = { getValidAccessToken: async () => "token" };
  assert.deepEqual(await manager._apiGet("/users/me/calendarList", "me@example.test"), {
    items: [],
  });
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].init.useSessionCookies, false);
  assert.ok(fetches[0].init.headers.get(gate.EGRESS_TAG_HEADER), "backstop attribution tag");
  assert.equal(fetches[0].init.headers.get("authorization"), "Bearer token");
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome, r.status]),
    [["calendar", "www.googleapis.com", "ok", 200]]
  );
});

test("sealing aborts an in-flight calendar read: interrupted, the fetch signal aborts", async () => {
  sealed = false;
  respond = hang;
  const manager = microsoftManager();
  manager.oauth = { getValidAccessToken: async () => "token" };
  const read = manager._apiGet("/me/calendars", "me@example.test");
  await until(() => fetches.length === 1, "the Graph request");
  seal();
  await assert.rejects(read, interrupted);
  assert.equal(fetches[0].init.signal.aborted, true);
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome, r.errorClass]),
    [["calendar", "graph.microsoft.com", "cancelled", "SEALED_MODE"]]
  );
});

test("a seal stops a Google sync: later calendars are not attempted and nothing is written", async () => {
  sealed = false;
  respond = hang;
  const writes = [];
  const manager = googleManager({
    getSelectedCalendars: () => [
      { id: "a", account_email: "me@example.test" },
      { id: "b", account_email: "me@example.test" },
    ],
    upsertCalendarEvents: () => writes.push("upsert"),
    removeCalendarEvents: () => writes.push("remove"),
    removeStaleCalendarEvents: () => writes.push("prune"),
    updateCalendarSyncToken: () => writes.push("token"),
    upsertContacts: () => writes.push("contacts"),
  });
  manager.oauth = { getValidAccessToken: async () => "token" };
  const sync = manager.syncEvents();
  await until(() => fetches.length === 1, "the first calendar read");
  seal();
  await assert.rejects(sync, interrupted);
  await tick(10);
  assert.equal(fetches.length, 1, "the second calendar was never requested");
  assert.deepEqual(writes, []);
  assert.equal(rows.length, 1);
});

test("a seal during a Microsoft series-master backfill fails the sync without committing it", async () => {
  sealed = false;
  const writes = [];
  respond = (url, init) =>
    url.includes("/calendarView/delta")
      ? json({
          value: [{ id: "occ-1", seriesMasterId: "master-1", start: {}, end: {} }],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-next",
        })
      : hang(url, init);
  const manager = microsoftManager({
    getCalendarEventById: () => null,
    upsertCalendarEvents: () => writes.push("upsert"),
    removeCalendarEvents: () => writes.push("remove"),
    removeStaleCalendarEvents: () => writes.push("prune"),
    updateMicrosoftCalendarSyncToken: () => writes.push("token"),
    upsertContacts: () => writes.push("contacts"),
  });
  manager.oauth = { getValidAccessToken: async () => "token" };
  const sync = manager._syncCalendar({ id: "cal", account_email: "me@example.test" });
  await until(() => fetches.length === 2, "the series master read");
  seal();
  await assert.rejects(sync, interrupted);
  assert.deepEqual(writes, [], "no stub rows and no delta token after a sealed interruption");
});

// ------------------------------------------------------------ N20 scheduling

test("the calendar guard main uses starts, focus-syncs and wake-syncs nothing while sealed", () => {
  const calls = [];
  const manager = (name) => ({
    start: () => calls.push(`${name}.start`),
    syncOnFocus: () => calls.push(`${name}.focus`),
    onWakeFromSleep: () => calls.push(`${name}.wake`),
  });
  // Apple Calendar is not exempt: its helper is a native child.
  const list = [manager("google"), manager("microsoft"), manager("apple"), null];
  const guard = createCalendarGuard({ isSealed: () => sealed });
  guard.start(list);
  guard.onFocus(list);
  guard.onWake(list);
  assert.deepEqual(calls, []);
  sealed = false;
  guard.start(list);
  guard.onFocus(list);
  guard.onWake(list);
  assert.deepEqual(calls, [
    "google.start",
    "microsoft.start",
    "apple.start",
    "google.focus",
    "microsoft.focus",
    "apple.focus",
    "google.wake",
    "microsoft.wake",
    "apple.wake",
  ]);
  const unknown = createCalendarGuard({
    isSealed: () => {
      throw new Error("state unreadable");
    },
  });
  calls.length = 0;
  unknown.start(list);
  unknown.onFocus(list);
  unknown.onWake(list);
  assert.deepEqual(calls, [], "an unreadable seal state fails closed");
});

test("the sync runner never arms, ticks or focus-syncs while sealed", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const runner = new CalendarSyncInterval(
    () => {
      calls++;
      return Promise.resolve();
    },
    { intervalMs: 1000, maxIntervalMs: 4000, logScope: "test", isSealed: () => sealed }
  );
  runner.start();
  runner.notifySuccess();
  runner._consecutiveFailures = 2;
  runner.notifySuccess();
  runner.syncOnFocus();
  assert.equal(runner.timer, null);
  assert.equal(calls, 0);

  sealed = false;
  runner.start();
  assert.notEqual(runner.timer, null);
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);
  // A seal that lands between ticks: the next tick stops the timer, no sync.
  sealed = true;
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);
  assert.equal(runner.timer, null);
  runner.stop();
});

test("a sign-in that returns after a seal arms no background sync", async () => {
  sealed = false;
  const manager = googleManager({ getSelectedCalendars: () => [] });
  manager.oauth = {
    startOAuthFlow: async () => {
      seal();
      return { success: true, email: "me@example.test" };
    },
    getValidAccessToken: async () => "token",
  };
  await assert.rejects(manager.startOAuth(), refused);
  assert.equal(manager.syncRunner.timer, null);
  assert.deepEqual(fetches, []);
});

test("resumeAfterSeal re-arms the existing interval and sends nothing now", () => {
  sealed = false;
  const google = googleManager({ getGoogleAccounts: () => [{ email: "me@example.test" }] });
  const microsoft = microsoftManager({
    getMicrosoftAccounts: () => [{ email: "me@example.test" }],
  });
  const idle = googleManager();
  google.resumeAfterSeal();
  microsoft.resumeAfterSeal();
  idle.resumeAfterSeal();
  assert.notEqual(google.syncRunner.timer, null);
  assert.notEqual(microsoft.syncRunner.timer, null);
  assert.equal(idle.syncRunner.timer, null, "no account, no schedule");
  assert.deepEqual(fetches, [], "no immediate calendar request on unseal");
});

test("the seal transition stops calendars, cancels pending sign-ins and resumes without a request", async (t) => {
  sealed = false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loqui-calendar-seal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  children._resetForTests();
  t.after(() => children._resetForTests());
  const state = new SealedState({ profile: dir });
  gate.configureEgress({ isSealed: () => state.isSealed(), recorder: null });
  const google = googleManager({ getGoogleAccounts: () => [{ email: "me@example.test" }] });
  const microsoft = microsoftManager({
    getMicrosoftAccounts: () => [{ email: "me@example.test" }],
  });
  const apple = {
    log: [],
    stop: () => apple.log.push("stop"),
    start: () => apple.log.push("start"),
  };
  google.resumeAfterSeal();
  microsoft.resumeAfterSeal();
  const guard = createCalendarGuard({ isSealed: () => state.isSealed() });
  const transition = createSealTransition({
    state,
    getCalendars: () => [google, microsoft, apple],
    cancelPending: () => guard.cancelPending(),
    children,
    waitMs: 5,
    sleep: () => new Promise((r) => setImmediate(r)),
  });

  let redirectUri;
  const flow = runOAuthLoopbackFlow({
    errorParam: "gcal_error",
    buildAuthUrl: (uri) => {
      redirectUri = uri;
      return "https://accounts.google.com/o/oauth2/v2/auth?x=1";
    },
    handleCallback: async () => assert.fail("a cancelled flow must not exchange a code"),
  });
  await until(() => redirectUri, "the loopback listener");
  const rejection = assert.rejects(flow, interrupted);

  const sealing = transition.apply(true);
  // Cancelled synchronously with the seal, not behind the barrier.
  assert.equal(activeOAuthFlowCount(), 0);
  await sealing;
  await rejection;
  assert.equal(google.syncRunner.timer, null);
  assert.equal(microsoft.syncRunner.timer, null);
  assert.deepEqual(apple.log, ["stop"]);
  assert.equal(
    transition.snapshot().failures.some((f) => f.startsWith("calendar") || f.includes("pending")),
    false
  );

  await transition.apply(false);
  assert.notEqual(google.syncRunner.timer, null);
  assert.notEqual(microsoft.syncRunner.timer, null);
  assert.deepEqual(apple.log, ["stop", "start"], "a calendar without resumeAfterSeal restarts");
  assert.deepEqual(fetches, [], "unsealing sends no calendar request by itself");
  assert.equal(transition.snapshot().phase, "open");
});

// ------------------------------------------------------------ OAuth flows

function captureServer(t) {
  const original = http.createServer;
  const servers = [];
  http.createServer = (...args) => {
    const server = original(...args);
    servers.push(server);
    return server;
  };
  t.after(() => {
    http.createServer = original;
  });
  return servers;
}
// The flow's own listener, at its own numeric 127.0.0.1 port.
const callback = (redirectUri, query) =>
  new Promise((resolve, reject) =>
    http
      .get(`${redirectUri}/?${query}`, { agent: false }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      })
      .on("error", reject)
  );

test("cancelling a pending OAuth flow rejects it and closes its loopback listener", async (t) => {
  sealed = false;
  const servers = captureServer(t);
  let redirectUri;
  const flow = runOAuthLoopbackFlow({
    buildAuthUrl: (uri) => {
      redirectUri = uri;
      return "https://accounts.example.test/auth";
    },
    handleCallback: async () => assert.fail("a cancelled flow must not exchange a code"),
    errorParam: "gcal_error",
  });
  await until(() => redirectUri, "the loopback listener");
  assert.equal(activeOAuthFlowCount(), 1);
  assert.equal(servers[0].listening, true);

  const reason = new SealedModeError({ task: "calendar", host: "x", phase: "interrupted" });
  assert.equal(cancelAllOAuthFlows(reason), 1);
  await assert.rejects(flow, (e) => e === reason);
  assert.equal(activeOAuthFlowCount(), 0);
  // The consent page may still redirect back later: nothing is listening.
  assert.equal(servers[0].listening, false);
  assert.equal(cancelAllOAuthFlows(reason), 0, "a settled flow is not cancelled twice");
});

test("a claimed Google sign-in is aborted mid token exchange and saves nothing", async (t) => {
  sealed = false;
  const servers = captureServer(t);
  const saved = [];
  respond = hang;
  const flow = new GoogleCalendarOAuth({
    saveGoogleTokens: (row) => saved.push(row),
  }).startOAuthFlow();
  await until(() => opened.length === 1, "the consent page");
  const consent = new URL(opened[0]);
  const redirectUri = consent.searchParams.get("redirect_uri");
  const state = consent.searchParams.get("state");
  const page = callback(redirectUri, `code=c&state=${state}`);
  await until(() => fetches.length === 1, "the token exchange");

  const reason = new SealedModeError({
    task: "calendar",
    host: "accounts.google.com",
    phase: "interrupted",
  });
  assert.equal(cancelAllOAuthFlows(reason), 1, "a claimed exchange is cancellable too");
  await assert.rejects(flow, (e) => e === reason);
  assert.equal(await page, 400, "the browser is told the connection did not complete");
  assert.equal(fetches[0].init.signal.aborted, true, "the token exchange itself aborts");
  assert.equal(servers[0].listening, false);
  await tick(10);
  assert.deepEqual(saved, []);
  assert.deepEqual(
    rows.map((r) => [r.task, r.host, r.outcome]),
    [["calendar", "oauth2.googleapis.com", "cancelled"]]
  );
});

test("a seal during a Microsoft sign-in's token exchange interrupts it through the gate", async (t) => {
  sealed = false;
  const servers = captureServer(t);
  const saved = [];
  respond = hang;
  const flow = new MicrosoftCalendarOAuth({
    saveMicrosoftTokens: (row) => saved.push(row),
  }).startOAuthFlow();
  await until(() => opened.length === 1, "the consent page");
  const consent = new URL(opened[0]);
  const page = callback(
    consent.searchParams.get("redirect_uri"),
    `code=c&state=${consent.searchParams.get("state")}`
  );
  await until(() => fetches.length === 1, "the token exchange");
  seal();
  await assert.rejects(flow, interrupted);
  assert.equal(await page, 400);
  assert.equal(servers[0].listening, false);
  assert.equal(activeOAuthFlowCount(), 0);
  assert.deepEqual(saved, []);
});

test("a declined consent page ends the sign-in quietly instead of waiting for the timeout", async () => {
  sealed = false;
  const opener = require("../../src/helpers/externalUrlOpener");
  opener.setExternalOpenGuard(async () => false);
  try {
    const flow = runOAuthLoopbackFlow({
      buildAuthUrl: () => "https://accounts.example.test/auth",
      handleCallback: async () => assert.fail("never reached"),
      errorParam: "gcal_error",
    });
    await assert.rejects(flow, (e) => e.redirectCode === "declined" && e.declined === true);
    assert.deepEqual(opened, []);
    assert.equal(activeOAuthFlowCount(), 0);
  } finally {
    opener.setExternalOpenGuard(null);
  }
});

// ------------------------------------------------------------ IPC admission

function loadCalendarHandlers(managersByName) {
  const vm = require("node:vm");
  const handlers = new Map();
  const module = { exports: {} };
  const inert = () =>
    new Proxy(function () {}, {
      get: (_, key) => (key === "then" ? undefined : inert()),
      apply: () => inert(),
      construct: () => inert(),
    });
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8"),
    {
      module,
      exports: module.exports,
      process,
      Date,
      setTimeout,
      clearTimeout,
      AbortController,
      require: (name) => {
        if (name === "electron")
          return { ipcMain: { handle: (n, fn) => handlers.set(n, fn), on() {} } };
        if (name === "./privacy/egressGate") return gate;
        if (name === "./privacy/egressPolicy")
          return require("../../src/helpers/privacy/egressPolicy");
        return inert();
      },
    }
  );
  const context = new Proxy(managersByName, {
    get: (target, key) => (key in target ? target[key] : inert()),
  });
  module.exports.prototype.setupHandlers.call(context);
  return handlers;
}

test("sealed calendar IPC refuses before a listener, a browser, a request or a helper", async () => {
  const calls = [];
  const spy = (name) =>
    new Proxy(
      {},
      {
        get: (_, method) => () => {
          calls.push(`${name}.${String(method)}`);
          return { success: true };
        },
      }
    );
  const handlers = loadCalendarHandlers({
    googleCalendarManager: spy("google"),
    microsoftCalendarManager: spy("microsoft"),
    appleCalendarManager: spy("apple"),
  });
  for (const [channel, args, host] of [
    ["gcal-start-oauth", [], "accounts.google.com"],
    ["mcal-start-oauth", [], "login.microsoftonline.com"],
    ["gcal-sync-events", [], "www.googleapis.com"],
    ["gcal-set-calendar-selection", ["cal", true], "www.googleapis.com"],
    ["gcal-set-primary-only", [false], "www.googleapis.com"],
    ["mcal-set-primary-only", [false], "graph.microsoft.com"],
  ]) {
    rows.length = 0;
    const result = await handlers.get(channel)({}, ...args);
    assert.equal(result.success, false, channel);
    assert.equal(result.code, "SEALED_MODE", channel);
    assert.equal(result.phase, "refused", channel);
    assert.equal(isSealedModeError(new Error(result.error)), true, "marker survives IPC");
    assert.deepEqual(
      rows.map((r) => [r.task, r.host, r.outcome]),
      [["calendar", host, "blocked"]],
      channel
    );
  }
  // Results come from the handler's VM realm: compare a plain copy.
  const apple = { ...(await handlers.get("acal-connect")({})) };
  assert.deepEqual(apple, {
    success: false,
    reason: "sealed",
    error: "NATIVE_BOUNDARY_UNAVAILABLE",
  });
  assert.deepEqual(calls, [], "no manager entry point ran");
  assert.equal(activeOAuthFlowCount(), 0);
  assert.deepEqual(opened, []);
  assert.deepEqual(fetches, []);

  // Local reads and disconnects stay available while sealed (a sealed
  // disconnect keeps a pending revoke and sends nothing, D-1).
  await handlers.get("gcal-get-connection-status")({});
  await handlers.get("gcal-disconnect")({}, "me@example.test");
  assert.deepEqual(calls, ["google.getConnectionStatus", "google.disconnectAccount"]);

  sealed = false;
  calls.length = 0;
  await handlers.get("gcal-sync-events")({});
  await handlers.get("acal-connect")({});
  assert.deepEqual(calls, ["google.syncEvents", "apple.connect"]);
});
