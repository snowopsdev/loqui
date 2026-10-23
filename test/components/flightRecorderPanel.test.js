const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const i18next = require("i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");
const { readTokens } = require("../helpers/harness/cssTokens");
const { mountComponent } = require("../helpers/harness/mountComponent");

const root = path.join(__dirname, "../..");
const R = "settingsPage.privacy.recorder";
const LOCALES = ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
const resources = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    JSON.parse(fs.readFileSync(path.join(root, "src/locales", l, "translation.json"), "utf8")),
  ])
);
const lookup = (json, key) => key.split(".").reduce((node, part) => node?.[part], json);

const view = () => import("../../src/components/settings/flightRecorderView.ts");
const feedModule = () => import("../../src/components/settings/flightRecorderFeed.ts");
const panel = () => import("../../src/components/settings/FlightRecorderPanel.tsx");
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
// renderToStaticMarkup escapes text; compare against decoded text with the
// left-to-right isolates around hostnames removed.
const decode = (html) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[⁦-⁩]/g, "");
const HOUR = 3600000;
const MINUTE = 60000;
// Local noon, so "today since midnight" is 12 hours long in every time zone.
const now = new Date(2026, 9, 15, 12, 0, 0, 0).getTime();
const midnight = new Date(2026, 9, 15, 0, 0, 0, 0).getTime();
const ev = (o) => ({
  id: 1,
  ts: now - HOUR,
  endedAt: now - HOUR + 400,
  task: "chat",
  host: o?.host ?? "api.groq.com",
  hosts: [o?.host ?? "api.groq.com"],
  kind: o?.opaque ? "session" : "request",
  operationId: null,
  bytesOut: 3100,
  bytesIn: 9800,
  outcome: "ok",
  status: 200,
  errorClass: null,
  model: "gpt-oss-120b",
  attributed: true,
  opaque: false,
  ...o,
});
const sum = (o) => ({
  left: 0,
  observed: 0,
  connections: 0,
  blocked: 0,
  unattributed: 0,
  unattributedHosts: [],
  bytesOut: 0,
  bytesIn: 0,
  unknownBytes: 0,
  opaqueSessions: 0,
  ...o,
});
const base = { t, now, formatTime: (ms) => `T${ms}`, onExport() {}, onClear() {} };
async function renderView(props) {
  const { FlightRecorderView } = await panel();
  return decode(renderStatic(FlightRecorderView, { ...base, ...props }));
}

// ---- View model ------------------------------------------------------------

test("timeline: one tick per record inside today's window, placed by minute and classified", async () => {
  const { timelineTicks } = await view();
  const ticks = timelineTicks(
    [
      ev({ id: 1, ts: now - HOUR }),
      ev({ id: 2, ts: now - 2 * HOUR, outcome: "blocked", bytesOut: 0 }),
      ev({ id: 3, ts: now - 3 * HOUR, task: "unattributed", attributed: false }),
      ev({ id: 4, ts: now - 13 * HOUR }), // yesterday: outside the window
      ev({ id: 5, ts: now - 4 * HOUR, kind: "session", opaque: true, bytesOut: null }),
      ev({ id: 6, ts: now - 5 * HOUR, kind: "operation" }), // never left
      ev({ id: 7, ts: midnight + 24 * HOUR + MINUTE }), // tomorrow
    ],
    midnight
  );
  assert.deepEqual(
    ticks.map((k) => [k.id, k.minute, k.kind]),
    [
      [1, 660, "sent"],
      [2, 600, "blocked"],
      [3, 540, "unexplained"],
      [5, 480, "session"],
    ]
  );
  for (const tick of ticks) assert.ok(tick.position > 0 && tick.position < 1);
});

test("unknown bytes are never shown as zero, and a 0 sent outside a refusal is unknown", async () => {
  const { bytesCell, sentCell } = await view();
  const fmt = (n) => `${n} B`;
  assert.deepEqual(bytesCell(null, fmt), { text: "—", unknown: true });
  assert.deepEqual(bytesCell(0, fmt), { text: "0 B", unknown: false });
  assert.deepEqual(sentCell(ev({ bytesOut: 0 }), fmt), { text: "—", unknown: true });
  assert.deepEqual(sentCell(ev({ bytesOut: null }), fmt), { text: "—", unknown: true });
  assert.deepEqual(sentCell(ev({ bytesOut: 3100 }), fmt), { text: "3100 B", unknown: false });
});

test("live notices: recorded rows join once; receipts, operations and other days do not", async () => {
  const { mergeNotice } = await view();
  const list = [ev({ id: 1 })];
  const next = mergeNotice(list, { phase: "recorded", event: ev({ id: 2, ts: now }) }, midnight);
  assert.deepEqual(
    next.map((e) => e.id),
    [2, 1]
  );
  assert.equal(
    mergeNotice(next, { phase: "recorded", event: ev({ id: 2, ts: now }) }, midnight),
    next
  );
  const receipt = {
    phase: "dispatched",
    ticketId: 9,
    operationId: 9,
    attemptId: null,
    task: "chat",
    targetId: "groq",
    host: "x",
    payload: "text",
    correlationId: null,
    ts: now,
  };
  assert.equal(mergeNotice(next, receipt, midnight), next);
  const older = { phase: "recorded", event: ev({ id: 3, ts: midnight - 1 }) };
  assert.equal(mergeNotice(next, older, midnight), next, "older than the window");
  const later = { phase: "recorded", event: ev({ id: 4, ts: midnight + 24 * HOUR }) };
  assert.equal(mergeNotice(next, later, midnight), next, "the next day");
  const op = { phase: "recorded", event: ev({ id: 5, ts: now, kind: "operation" }) };
  assert.equal(mergeNotice(next, op, midnight), next, "an operation never left");
});

test("a row shows its host trail and, when it ran for a while, its end time", async () => {
  const { hostTrail, timeCell } = await view();
  const download = ev({
    host: "huggingface.co",
    hosts: ["huggingface.co", "cdn-lfs.hf.co"],
    ts: 1000,
    endedAt: 61000,
  });
  assert.equal(hostTrail(download), "huggingface.co → cdn-lfs.hf.co");
  assert.equal(
    timeCell(download, (ms) => `T${ms}`),
    "T1000–T61000"
  );
  assert.equal(
    timeCell(ev({ ts: 1000, endedAt: 1400 }), (ms) => `T${ms}`),
    "T1000"
  );
  assert.equal(
    timeCell(ev({ ts: 1000, endedAt: null }), (ms) => `T${ms}`),
    "T1000"
  );
});

test("only metadata enum IDs reach a translation key", async () => {
  const { taskId, outcomeId, errorClassId, classifyRecorderError, startOfToday, startOfNextDay } =
    await view();
  assert.equal(taskId("chat"), "chat");
  assert.equal(taskId("__proto__"), "unattributed");
  assert.equal(outcomeId("cancelled"), "cancelled");
  assert.equal(outcomeId("weird"), "error");
  assert.equal(errorClassId("HTTP_4XX"), "HTTP_4XX");
  assert.equal(errorClassId("ECONNRESET: socket hang up at 10.0.0.1"), "OTHER");
  assert.equal(errorClassId(null), null);
  assert.equal(
    classifyRecorderError(
      new Error(
        "Error invoking remote method 'privacy:egress-list': Error: PRIVACY_RECORDER_UNAVAILABLE"
      )
    ),
    "unavailable"
  );
  assert.equal(classifyRecorderError(new Error("boom")), "failed");
  assert.equal(startOfToday(now), midnight);
  assert.equal(startOfNextDay(midnight), new Date(2026, 9, 16).getTime());
});

// ---- The view ----------------------------------------------------------------

test("the view: counts, hollow blocked ticks, unknown bytes, LTR hosts, unexplained notice", async () => {
  const html = await renderView({
    events: [
      ev({ id: 1, bytesIn: null }),
      ev({
        id: 2,
        outcome: "blocked",
        bytesOut: 0,
        bytesIn: 0,
        status: null,
        errorClass: "SEALED_MODE",
      }),
      ev({ id: 3, task: "unattributed", host: "x.example.com", attributed: false }),
    ],
    summary: sum({
      left: 2,
      observed: 2,
      blocked: 1,
      unattributed: 1,
      unattributedHosts: ["x.example.com"],
      bytesOut: 3100,
      bytesIn: 9800,
      unknownBytes: 1,
    }),
  });
  assert.match(html, /settingsPage\.privacy\.recorder\.observedToday\{"count":2\}/);
  assert.match(html, /settingsPage\.privacy\.recorder\.blockedToday\{"count":1\}/);
  assert.match(html, /data-kind="blocked"/);
  assert.match(html, /data-kind="blocked"[^>]*border-2 border-muted-foreground bg-transparent/);
  assert.match(html, /settingsPage\.privacy\.recorder\.unknownBytes/);
  assert.match(html, /dir="ltr"[^>]*>api\.groq\.com/);
  assert.match(
    html,
    /role="status"[^>]*>[^<]*settingsPage\.privacy\.recorder\.unexplained\{"hosts":"x\.example\.com"\}/
  );
  // The refused row says "Not sent" instead of a byte count; no "0 Bytes" anywhere.
  assert.match(html, /colSpan="2"[^>]*>settingsPage\.privacy\.recorder\.notSent</);
  assert.doesNotMatch(html, /0 Bytes|0 bytes/i);
  assert.match(html, /recorder\.outcome\.blocked<span dir="ltr"[^>]*>SEALED_MODE</);
  assert.match(html, /insetInlineStart|inset-inline-start/);
  assert.doesNotMatch(html, /secret|prompt/i);
  assert.match(html, /settingsPage\.privacy\.recorder\.coverage/);
});

test("the empty state makes no network claim beyond what was recorded", async () => {
  const html = await renderView({ events: [], summary: sum({}) });
  assert.match(html, /settingsPage\.privacy\.recorder\.empty/);
  assert.match(html, /settingsPage\.privacy\.recorder\.coverage/);
  assert.match(html, /settingsPage\.privacy\.recorder\.loopbackNote/);
  assert.match(html, /settingsPage\.privacy\.recorder\.bytesNote/);
  assert.doesNotMatch(html, /nothing|0 bytes/i);
  // Zero is a line of text with its caveat, never a big standalone "0".
  assert.doesNotMatch(html, /text-\[28px\][^>]*>0</);
  assert.match(html, /observedToday\{"count":0\}/);
});

test("an opaque child session is counted apart, names its usual host, and shows no bytes", async () => {
  const html = await renderView({
    events: [
      ev({
        id: 7,
        task: "codex",
        host: "chatgpt.com",
        bytesOut: null,
        bytesIn: null,
        opaque: true,
      }),
    ],
    summary: sum({ left: 1, observed: 0, opaqueSessions: 1 }),
  });
  assert.match(html, /settingsPage\.privacy\.recorder\.observedToday\{"count":0\}/);
  assert.match(html, /settingsPage\.privacy\.recorder\.sessionsToday\{"count":1\}/);
  assert.match(html, /settingsPage\.privacy\.recorder\.usualHost\{"host":"chatgpt\.com"\}/);
  assert.match(html, /settingsPage\.privacy\.recorder\.opaque/);
  assert.match(html, /data-kind="session"/);
  assert.doesNotMatch(html, /settingsPage\.privacy\.recorder\.unknownBytes/);
  assert.doesNotMatch(html, /settingsPage\.privacy\.recorder\.notSent/);
});

test("connections are counted and labelled apart; operations that never left are not shown", async () => {
  const html = await renderView({
    events: [
      ev({
        id: 1,
        task: "dictationStt",
        host: "api.deepgram.com",
        kind: "connection",
        bytesOut: 900,
        bytesIn: 4000,
      }),
      ev({ id: 2, kind: "operation", outcome: "error", host: "never-sent.example.com" }),
    ],
    summary: sum({ left: 1, connections: 1 }),
  });
  assert.match(html, /connectionsToday\{"count":1\}/);
  assert.match(html, /data-kind="connection"[\s\S]*settingsPage\.privacy\.recorder\.connection/);
  assert.doesNotMatch(html, /never-sent\.example\.com/);
});

test("while loading, the panel shows no count, no empty state and no timeline", async () => {
  const html = await renderView({ events: [ev({ id: 1 })], summary: null });
  assert.match(html, /role="status"[^>]*>settingsPage\.privacy\.recorder\.loading/);
  assert.doesNotMatch(html, /observedToday/);
  assert.doesNotMatch(html, /settingsPage\.privacy\.recorder\.empty/);
  assert.doesNotMatch(html, /timelineLabel|<table/);
});

test("a failed read is an alert with Retry, never Loading, a count, the empty state or old rows", async () => {
  for (const [error, key] of [
    ["failed", "loadError"],
    ["unavailable", "unavailable"],
  ]) {
    const html = await renderView({
      events: [ev({ id: 1 })],
      summary: sum({ observed: 1, left: 1 }),
      error,
      onRetry() {},
    });
    assert.match(html, new RegExp(`role="alert"[^>]*>settingsPage\\.privacy\\.recorder\\.${key}<`));
    assert.match(html, /settingsPage\.privacy\.recorder\.retry/);
    assert.doesNotMatch(html, /recorder\.loading|observedToday|recorder\.empty|<table|api\.groq/);
    // Export and Clear wait until the recorder can be read again.
    assert.equal((html.match(/<button[^>]*disabled=""/g) || []).length, 2);
  }
});

test("a list cut at the fetch limit says so and offers more, then points to the CSV", async () => {
  const events = Array.from({ length: 3 }, (_, i) => ev({ id: i + 1, ts: now - i * MINUTE }));
  const more = await renderView({
    events,
    summary: sum({ observed: 900 }),
    truncated: true,
    limit: 500,
    onShowMore() {},
  });
  assert.match(more, /recorder\.truncated\{"count":3\}/);
  assert.match(more, /recorder\.showMore/);
  assert.doesNotMatch(more, /recorder\.exportForAll/);
  const capped = await renderView({
    events,
    summary: sum({ observed: 9000 }),
    truncated: true,
    limit: 5000,
    onShowMore() {},
  });
  assert.match(capped, /recorder\.exportForAll/);
  assert.doesNotMatch(capped, /recorder\.showMore/);
  const whole = await renderView({ events, summary: sum({ observed: 3 }), truncated: false });
  assert.doesNotMatch(whole, /recorder\.truncated|recorder\.showMore/);
});

test("retention copy follows the privacy settings; with history off it never implies history", async () => {
  const off = await renderView({
    events: [],
    summary: sum({}),
    retention: { historyOn: false, days: 30 },
  });
  assert.match(off, /recorder\.retentionMemory/);
  assert.doesNotMatch(off, /recorder\.retentionDays|recorder\.retentionForever/);
  const days = await renderView({
    events: [],
    summary: sum({}),
    retention: { historyOn: true, days: 30 },
  });
  assert.match(days, /recorder\.retentionDays\{"count":30\}/);
  const forever = await renderView({
    events: [],
    summary: sum({}),
    retention: { historyOn: true, days: 0 },
  });
  assert.match(forever, /recorder\.retentionForever/);
});

test("recorder faults are surfaced: unrecorded requests and a persistence error", async () => {
  const html = await renderView({
    events: [],
    summary: sum({}),
    recordFailures: 2,
    persistError: true,
  });
  assert.match(html, /role="status"[\s\S]*recorder\.recordFailures\{"count":2\}/);
  assert.match(html, /recorder\.unavailable/);
});

test("actions: busy disables both; notices are translated status lines", async () => {
  const busy = await renderView({ events: [], summary: sum({}), busy: "clearing" });
  assert.equal((busy.match(/<button[^>]*disabled=""/g) || []).length, 2);
  for (const notice of ["exported", "exportError", "cleared", "clearError"]) {
    const html = await renderView({ events: [], summary: sum({}), notice });
    assert.match(
      html,
      new RegExp(`role="status"[^>]*>settingsPage\\.privacy\\.recorder\\.notice\\.${notice}<`)
    );
  }
  const idle = await renderView({ events: [], summary: sum({}) });
  assert.equal((idle.match(/<button[^>]*disabled=""/g) || []).length, 0);
  assert.match(idle, /recorder\.actionsNote/);
});

test("layout uses logical properties only", async () => {
  const html = await renderView({
    events: [ev({ id: 1 }), ev({ id: 2, opaque: true, kind: "session", task: "codex" })],
    summary: sum({ observed: 1, opaqueSessions: 1 }),
  });
  assert.doesNotMatch(html, /\b(ml|mr|pl|pr|left|right)-\d|text-left|text-right/);
  assert.doesNotMatch(html, /style="[^"]*\b(left|right):/);
});

// ---- The feed: fetch, races, failures and actions ----------------------------

function fakeApi() {
  const calls = [];
  const pending = [];
  const listeners = { event: new Set(), cleared: new Set() };
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const api = {
    listEgress(options) {
      calls.push(["list", options]);
      const d = deferred();
      pending.push(["list", options, d]);
      return d.promise;
    },
    egressSummary(options) {
      calls.push(["summary", options]);
      const d = deferred();
      pending.push(["summary", options, d]);
      return d.promise;
    },
    clearEgress: () => {
      calls.push(["clear"]);
      const d = deferred();
      pending.push(["clear", null, d]);
      return d.promise;
    },
    exportEgressCsv: () => {
      calls.push(["export"]);
      const d = deferred();
      pending.push(["export", null, d]);
      return d.promise;
    },
    onEgress(cb) {
      listeners.event.add(cb);
      return () => listeners.event.delete(cb);
    },
    onEgressCleared(cb) {
      listeners.cleared.add(cb);
      return () => listeners.cleared.delete(cb);
    },
  };
  const take = (kind) => {
    const i = pending.findIndex(([k]) => k === kind);
    assert.ok(i >= 0, `a pending ${kind}`);
    return pending.splice(i, 1)[0];
  };
  return {
    api,
    calls,
    pending,
    listeners,
    // Answer the oldest list+summary pair.
    async answer(list, summary) {
      take("list")[2].resolve(list);
      take("summary")[2].resolve(summary);
      await tick();
    },
    async fail(error) {
      take("list")[2].reject(error);
      take("summary")[2].resolve(sum({}));
      await tick();
    },
    take,
    emit: (notice) => [...listeners.event].forEach((cb) => cb(notice)),
    cleared: () => [...listeners.cleared].forEach((cb) => cb()),
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function manualTimers() {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    set: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clear: (id) => timers.delete(id),
    async fire(predicate = () => true) {
      for (const [id, timer] of [...timers]) {
        if (!predicate(timer)) continue;
        timers.delete(id);
        timer.fn();
      }
      await tick();
    },
  };
}
async function startFeed({ clock = () => now } = {}) {
  const { RecorderFeed, LIVE_REFRESH_MS } = await feedModule();
  const fake = fakeApi();
  const timers = manualTimers();
  const feed = new RecorderFeed(fake.api, clock, timers);
  const seen = [];
  feed.subscribe((s) => seen.push(s));
  const stop = feed.start();
  return { feed, fake, timers, seen, stop, LIVE_REFRESH_MS };
}

test("feed: fetches today's list and counts together, with the page limit", async () => {
  const { feed, fake } = await startFeed();
  assert.equal(feed.getState().status, "loading");
  assert.equal(feed.getState().summary, null);
  assert.deepEqual(fake.calls.slice(0, 2), [
    ["list", { since: midnight, limit: 500 }],
    ["summary", { since: midnight }],
  ]);
  await fake.answer([ev({ id: 1 })], sum({ observed: 1, left: 1 }));
  const s = feed.getState();
  assert.equal(s.status, "ready");
  assert.equal(s.since, midnight);
  assert.deepEqual(
    s.events.map((e) => e.id),
    [1]
  );
  assert.equal(s.summary.observed, 1);
  assert.equal(s.truncated, false);
});

test("feed: a clear from main discards a fetch already under way (no resurrected records)", async () => {
  const { feed, fake } = await startFeed();
  await fake.answer([ev({ id: 1 })], sum({ observed: 1 }));
  // A live refresh is in flight with the old rows when main clears.
  fake.emit({ phase: "recorded", event: ev({ id: 2, ts: now }) });
  void feed.refresh();
  const stale = [fake.take("list"), fake.take("summary")];
  fake.cleared();
  assert.equal(feed.getState().status, "loading", "cleared: nothing old stays up");
  assert.equal(feed.getState().events.length, 0);
  assert.equal(feed.getState().summary, null);
  stale[0][2].resolve([ev({ id: 2, ts: now }), ev({ id: 1 })]);
  stale[1][2].resolve(sum({ observed: 2 }));
  await tick();
  assert.equal(feed.getState().events.length, 0, "the stale answer is dropped");
  assert.equal(feed.getState().status, "loading");
  await fake.answer([], sum({}));
  assert.equal(feed.getState().status, "ready");
  assert.equal(feed.getState().events.length, 0);
  assert.equal(feed.getState().summary.observed, 0);
});

test("feed: a live row shows at once, survives a fetch that missed it, and is confirmed by a refetch", async () => {
  const { feed, fake, timers, LIVE_REFRESH_MS } = await startFeed();
  // Arrives while the first fetch is still out.
  fake.emit({ phase: "recorded", event: ev({ id: 5, ts: now }) });
  await fake.answer([ev({ id: 1 })], sum({ observed: 1 }));
  assert.deepEqual(
    feed.getState().events.map((e) => e.id),
    [5, 1]
  );
  fake.emit({ phase: "recorded", event: ev({ id: 6, ts: now }) });
  assert.deepEqual(
    feed.getState().events.map((e) => e.id),
    [6, 5, 1]
  );
  // Bursts share one debounced refetch of both list and counts.
  fake.emit({ phase: "recorded", event: ev({ id: 7, ts: now }) });
  const live = [...timers.timers.values()].filter((x) => x.ms === LIVE_REFRESH_MS);
  assert.equal(live.length, 1);
  await timers.fire((x) => x.ms === LIVE_REFRESH_MS);
  await fake.answer(
    [ev({ id: 7, ts: now }), ev({ id: 6, ts: now }), ev({ id: 5, ts: now }), ev({ id: 1 })],
    sum({ observed: 4 })
  );
  assert.equal(feed.getState().summary.observed, 4);
  assert.deepEqual(
    feed.getState().events.map((e) => e.id),
    [7, 6, 5, 1]
  );
  // Dispatch receipts never become rows.
  fake.emit({ phase: "dispatched", ticketId: 1, task: "chat", host: "x", ts: now });
  assert.equal(feed.getState().events.length, 4);
});

test("feed: a failed read becomes a translated error, then Retry reloads from nothing", async () => {
  const { feed, fake } = await startFeed();
  await fake.fail(
    new Error(
      "Error invoking remote method 'privacy:egress-list': Error: PRIVACY_RECORDER_UNAVAILABLE"
    )
  );
  assert.equal(feed.getState().status, "error");
  assert.equal(feed.getState().error, "unavailable");
  assert.equal(feed.getState().summary, null);
  // Live events do not paint over the error.
  fake.emit({ phase: "recorded", event: ev({ id: 9, ts: now }) });
  assert.equal(feed.getState().events.length, 0);
  void feed.retry();
  assert.equal(feed.getState().status, "loading");
  assert.equal(feed.getState().error, null);
  await fake.answer([ev({ id: 9, ts: now })], sum({ observed: 1 }));
  assert.equal(feed.getState().status, "ready");
  // A later failure drops the rows it can no longer vouch for.
  void feed.refresh();
  await fake.fail(new Error("boom"));
  assert.equal(feed.getState().error, "failed");
  assert.equal(feed.getState().events.length, 0);
});

test("feed: Clear asks main; declined changes nothing, confirmed empties and refetches, failure is said", async () => {
  const { feed, fake } = await startFeed();
  await fake.answer([ev({ id: 1 })], sum({ observed: 1 }));
  // Declined in main's dialog ("Keep records").
  let done = feed.clear();
  assert.equal(feed.getState().busy, "clearing");
  fake.take("clear")[2].resolve(false);
  await done;
  assert.equal(feed.getState().busy, null);
  assert.equal(feed.getState().notice, null);
  assert.equal(feed.getState().events.length, 1);
  assert.equal(fake.pending.length, 0, "no refetch");
  // Confirmed: main broadcasts the clear, then answers true.
  done = feed.clear();
  fake.cleared();
  fake.take("clear")[2].resolve(true);
  await tick();
  assert.equal(feed.getState().notice, "cleared");
  assert.equal(feed.getState().events.length, 0);
  assert.equal(feed.getState().status, "loading");
  while (fake.pending.some(([k]) => k === "list")) await fake.answer([], sum({}));
  await done;
  assert.equal(feed.getState().status, "ready");
  // A failure in main is a translated notice, not an exception.
  done = feed.clear();
  fake.take("clear")[2].reject(new Error("PRIVACY_RECORDER_UNAVAILABLE"));
  await done;
  assert.equal(feed.getState().notice, "clearError");
  assert.equal(feed.getState().busy, null);
});

test("feed: Export reports saved, stays quiet when cancelled, and says when it failed", async () => {
  const { feed, fake } = await startFeed();
  await fake.answer([], sum({}));
  let done = feed.exportCsv();
  assert.equal(feed.getState().busy, "exporting");
  fake.take("export")[2].resolve({ saved: true });
  await done;
  assert.equal(feed.getState().notice, "exported");
  done = feed.exportCsv();
  fake.take("export")[2].resolve({ saved: false });
  await done;
  assert.equal(feed.getState().notice, null);
  done = feed.exportCsv();
  fake.take("export")[2].reject(new Error("PRIVACY_EXPORT_FAILED"));
  await done;
  assert.equal(feed.getState().notice, "exportError");
  assert.equal(feed.getState().busy, null);
});

test("feed: Show more raises the limit by a page up to main's cap of 5000", async () => {
  const { feed, fake } = await startFeed();
  await fake.answer(
    Array.from({ length: 500 }, (_, i) => ev({ id: i + 1 })),
    sum({ observed: 600 })
  );
  assert.equal(feed.getState().truncated, true);
  for (let i = 0; i < 12; i++) {
    void feed.showMore();
    while (fake.pending.some(([k]) => k === "list")) await fake.answer([], sum({}));
  }
  assert.equal(feed.getState().limit, 5000);
  const limits = fake.calls.filter(([k]) => k === "list").map(([, o]) => o.limit);
  assert.equal(Math.max(...limits), 5000);
  assert.equal(limits.at(-1), 5000);
});

test("feed: a new day moves the window and drops yesterday's rows", async () => {
  let clock = now;
  const { feed, fake, timers } = await startFeed({ clock: () => clock });
  await fake.answer([ev({ id: 1 })], sum({ observed: 1 }));
  const nextMidnight = new Date(2026, 9, 16).getTime();
  const rollover = [...timers.timers.values()].find((x) => x.ms > HOUR);
  assert.ok(rollover, "a rollover refetch is armed");
  assert.ok(Math.abs(rollover.ms - (nextMidnight - now)) <= 2000);
  // A row from after midnight arrives first: the view resets to the new day.
  clock = nextMidnight + 5 * MINUTE;
  fake.emit({ phase: "recorded", event: ev({ id: 2, ts: clock }) });
  assert.equal(feed.getState().events.length, 0);
  assert.equal(feed.getState().since, nextMidnight);
  assert.deepEqual(fake.calls.at(-1), ["summary", { since: nextMidnight }]);
  await fake.answer([ev({ id: 2, ts: clock })], sum({ observed: 1 }));
  assert.deepEqual(
    feed.getState().events.map((e) => e.id),
    [2]
  );
});

test("feed: once disposed, late answers and events change nothing", async () => {
  const { feed, fake, timers, seen, stop } = await startFeed();
  stop();
  const count = seen.length;
  await fake.answer([ev({ id: 1 })], sum({ observed: 1 }));
  assert.equal(fake.listeners.event.size, 0);
  assert.equal(fake.listeners.cleared.size, 0);
  assert.equal(seen.length, count);
  assert.equal(feed.getState().status, "loading");
  assert.equal(timers.timers.size, 0);
});

// ---- Production wiring --------------------------------------------------------

test("Privacy & Data renders the flight recorder directly after the Sealed mode panel", () => {
  const page = fs.readFileSync(path.join(root, "src/components/SettingsPage.tsx"), "utf8");
  assert.match(page, /import FlightRecorderPanel from "\.\/settings\/FlightRecorderPanel";/);
  const privacy = page.slice(page.indexOf('case "privacyData":'));
  const body = privacy.slice(0, privacy.indexOf("case ", 10));
  const sealed = body.indexOf("<SealedModePanel />");
  const recorder = body.indexOf("<FlightRecorderPanel />");
  const audio = body.indexOf("{/* Audio Retention */}");
  assert.ok(sealed > 0 && recorder > sealed && audio > recorder, `${sealed} ${recorder} ${audio}`);
  assert.doesNotMatch(body.slice(sealed + "<SealedModePanel />".length, recorder), /<[A-Z]/);
  // Clear is confirmed by main's own dialog; the renderer has no confirm of its own.
  const src = fs.readFileSync(
    path.join(root, "src/components/settings/FlightRecorderPanel.tsx"),
    "utf8"
  );
  assert.doesNotMatch(src, /window\.confirm|confirm\(/);
});

function bridge({ list, summary, clear = () => Promise.resolve(false) } = {}) {
  return {
    listEgress: list ?? (() => Promise.resolve([ev({ id: 1, ts: Date.now() - MINUTE })])),
    egressSummary: summary ?? (() => Promise.resolve(sum({ observed: 1, left: 1 }))),
    clearEgress: clear,
    exportEgressCsv: () => Promise.resolve({ saved: false }),
    onEgress: () => () => {},
    onEgressCleared: () => () => {},
    getSealed: () => Promise.resolve(false),
    getAttestation: () => new Promise(() => {}),
    onSealedChange: () => () => {},
    onAttestation: () => () => {},
  };
}
async function flush() {
  await React.act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  });
}

test("mounted: the panel loads today's records through the bridge and follows local history", async (t) => {
  const ui = await mountComponent(t, "/components/settings/FlightRecorderPanel.tsx", {
    api: { privacy: bridge() },
    storage: { dataRetentionEnabled: "false" },
  });
  await flush();
  const list = ui.calls.find(([name]) => name === "privacy.listEgress");
  assert.ok(list, "listEgress was called");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  assert.deepEqual(list[1], { since: today.getTime(), limit: 500 });
  assert.ok(ui.text().includes(`${R}.observedToday`));
  assert.ok(ui.text().includes(`${R}.retentionMemory`));
  assert.equal(ui.text().includes(`${R}.loading`), false);
});

test("mounted: a rejected read shows the error with Retry instead of Loading forever", async (t) => {
  let fail = true;
  const ui = await mountComponent(t, "/components/settings/FlightRecorderPanel.tsx", {
    api: {
      privacy: bridge({
        list: () =>
          fail
            ? Promise.reject(new Error("Error invoking remote method: Error: SOMETHING"))
            : Promise.resolve([]),
        summary: () => Promise.resolve(sum({})),
      }),
    },
  });
  await flush();
  const alerts = ui.findAll((node) => node.attributes?.role === "alert");
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].textContent.includes(`${R}.loadError`));
  assert.equal(ui.text().includes(`${R}.loading`), false);
  assert.equal(ui.text().includes("SOMETHING"), false, "main's raw text is never shown");
  fail = false;
  const retry = ui.find(
    (node) => node.tagName === "BUTTON" && node.textContent.includes(`${R}.retry`)
  );
  await ui.click(retry);
  await flush();
  assert.ok(ui.text().includes(`${R}.empty`));
});

test("mounted: Clear goes to main, which owns the confirmation", async (t) => {
  let asked = 0;
  const ui = await mountComponent(t, "/components/settings/FlightRecorderPanel.tsx", {
    api: {
      privacy: bridge({
        clear: () => {
          asked++;
          return Promise.resolve(false);
        },
      }),
    },
  });
  await flush();
  const clear = ui.find(
    (node) => node.tagName === "BUTTON" && node.textContent.includes(`${R}.clear`)
  );
  await ui.click(clear);
  await flush();
  assert.equal(asked, 1);
  assert.ok(ui.text().includes(`${R}.observedToday`), "declined: the records stay");
});

// ---- Copy, in all 11 locales ------------------------------------------------

const KEYS = [
  "title",
  "subtitle",
  "loading",
  "loadError",
  "unavailable",
  "retry",
  "coverage",
  "unexplained",
  "timelineLabel",
  "tick",
  "legend.sent",
  "legend.session",
  "legend.blocked",
  "legend.unexplained",
  "empty",
  "tableCaption",
  "usualHost",
  "unknownHost",
  "connection",
  "opaque",
  "notSent",
  "unknownBytes",
  "showMore",
  "exportForAll",
  "loopbackNote",
  "bytesNote",
  "retention",
  "retentionMemory",
  "retentionForever",
  "export",
  "clear",
  "actionsNote",
  "notice.exported",
  "notice.exportError",
  "notice.cleared",
  "notice.clearError",
  ...["time", "task", "host", "sent", "received", "status", "model"].map((c) => `columns.${c}`),
  ...["ok", "error", "blocked", "cancelled"].map((o) => `outcome.${o}`),
].map((k) => `${R}.${k}`);
const PLURALS = [
  "observedToday",
  "connectionsToday",
  "sessionsToday",
  "blockedToday",
  "recordFailures",
  "unexplainedMore",
  "truncated",
  "retentionDays",
].map((k) => `${R}.${k}`);

test("every recorder string exists in all 11 locales with matching placeholders and CLDR forms", async () => {
  const { TASKS } = await view();
  const keys = [...KEYS, ...TASKS.map((task) => `${R}.tasks.${task}`)];
  const placeholders = (s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
  for (const key of keys) {
    const en = lookup(resources.en, key);
    assert.equal(typeof en, "string", `en:${key}`);
    for (const l of LOCALES) {
      const value = lookup(resources[l], key);
      assert.equal(typeof value, "string", `${l}:${key}`);
      assert.ok(value.trim(), `${l}:${key}`);
      assert.deepEqual(placeholders(value), placeholders(en), `${l}:${key}`);
    }
  }
  for (const base of PLURALS) {
    for (const l of LOCALES) {
      const rules = new Intl.PluralRules(l);
      for (const n of [0, 1, 2, 3, 5, 11, 21, 22, 25, 100, 101, 1000]) {
        const form = lookup(resources[l], `${base}_${rules.select(n)}`);
        assert.equal(typeof form, "string", `${l}:${base}_${rules.select(n)} (${n})`);
        assert.match(form, /\{\{count\}\}/, `${l}:${base}_${rules.select(n)}`);
      }
    }
  }
  // Translated, not English copies (ids and the tick template aside).
  for (const l of LOCALES.filter((x) => x !== "en"))
    for (const key of [
      `${R}.subtitle`,
      `${R}.coverage`,
      `${R}.loopbackNote`,
      `${R}.retentionMemory`,
    ])
      assert.notEqual(lookup(resources[l], key), lookup(resources.en, key), `${l}:${key}`);
});

test("the recorder copy renders through i18next in every locale without a raw key", async () => {
  const { FlightRecorderView } = await panel();
  for (const l of LOCALES) {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: l,
      fallbackLng: false,
      resources: { [l]: { translation: resources[l] } },
      interpolation: { escapeValue: false },
    });
    const tl = (key, params) => i18n.t(key, params);
    for (const props of [
      {
        events: [
          ev({ id: 1 }),
          ev({ id: 2, outcome: "blocked", bytesOut: 0, bytesIn: 0 }),
          ev({ id: 3, outcome: "cancelled", task: "dictationStt", bytesIn: null }),
          ev({ id: 4, opaque: true, kind: "session", task: "urlImport", host: "www.youtube.com" }),
          ev({ id: 5, kind: "connection", task: "noteRecordingStt" }),
          ev({
            id: 6,
            host: "unknown",
            hosts: ["unknown"],
            task: "unattributed",
            attributed: false,
          }),
        ],
        summary: sum({
          observed: 21,
          connections: 21,
          opaqueSessions: 21,
          blocked: 21,
          unattributed: 5,
          unattributedHosts: ["a.example", "b.example", "c.example", "d.example", "e.example"],
        }),
        truncated: true,
        limit: 500,
        onShowMore() {},
        recordFailures: 21,
        persistError: true,
        notice: "clearError",
        retention: { historyOn: true, days: 21 },
      },
      { events: [], summary: sum({}), retention: { historyOn: false, days: 0 } },
      { events: [], summary: sum({}), retention: { historyOn: true, days: 0 }, notice: "exported" },
      { events: [], summary: null },
      { events: [], summary: null, error: "failed", onRetry() {} },
      { events: [], summary: sum({}), truncated: true, limit: 5000 },
    ]) {
      const html = renderStatic(FlightRecorderView, { ...base, t: tl, ...props });
      assert.doesNotMatch(html, /settingsPage\.privacy/, `${l}: raw key`);
      assert.doesNotMatch(html, /\{\{/, `${l}: placeholder`);
    }
  }
});

test("no recorder copy claims zero egress, a verified seal, isolation or that loopback never leaves", () => {
  const values = (node) =>
    typeof node === "string" ? [node] : Object.values(node).flatMap((v) => values(v));
  const en = values(resources.en.settingsPage.privacy.recorder).join("\n");
  assert.doesNotMatch(
    en,
    /\bverified\b|0 bytes|zero bytes|nothing leaves|nothing left|nothing was sent|never leave|isolat/i
  );
  // The loopback note scopes Loqui's own direct requests; it does not promise
  // that a forwarder or a local engine keeps traffic on this computer.
  const loopback = resources.en.settingsPage.privacy.recorder.loopbackNote;
  assert.match(loopback, /proxy or port forwarder/);
  assert.match(loopback, /local engines/);
  // An interrupted request may have been partly received; only a refusal is "not sent".
  assert.match(resources.en.settingsPage.privacy.recorder.outcome.cancelled, /may have received/);
  assert.match(resources.en.settingsPage.privacy.recorder.notSent, /^Not sent$/);
  assert.match(resources.en.settingsPage.privacy.recorder.retentionMemory, /memory only/);
  assert.match(resources.en.settingsPage.privacy.recorder.retentionMemory, /500/);
});

// ---- Contrast, in light and Plum Night ---------------------------------------

function tokenThemes() {
  const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
  const light = { ...readTokens(css, "@theme"), ...readTokens(css, ":root") };
  const dark = { ...light, ...readTokens(css, ".dark") };
  return { light, dark };
}

test("recorder text and ticks meet contrast on the card in light and Plum Night", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = tokenThemes();
  for (const [theme, tokens] of Object.entries({ light, dark })) {
    const card = tokens["--color-card"];
    for (const fg of ["--color-foreground", "--color-muted-foreground"])
      assert.ok(contrastRatio(tokens[fg], card) >= 4.5, `${theme} ${fg} text on card`);
    // Non-text: every tick kind and the unexplained notice's border.
    for (const mark of [
      "--color-locality-remote",
      "--color-destructive",
      "--color-muted-foreground",
    ])
      assert.ok(contrastRatio(tokens[mark], card) >= 3, `${theme} ${mark} mark on card`);
  }
  const src = fs.readFileSync(
    path.join(root, "src/components/settings/FlightRecorderPanel.tsx"),
    "utf8"
  );
  // The ticks use exactly the scored tokens.
  assert.match(src, /bg-\[var\(--color-locality-remote\)\]/);
  assert.match(src, /border-\[var\(--color-locality-remote\)\]/);
  assert.match(src, /border-muted-foreground bg-transparent/);
  assert.match(src, /bg-destructive/);
  assert.match(src, /border border-destructive /);
  assert.doesNotMatch(src, /destructive\/\d|locality-remote,#/);
});

// ---- Docs -------------------------------------------------------------------

test("DESIGN.md completes the Sealed mode section with the recorder rules", () => {
  const design = fs.readFileSync(path.join(root, "DESIGN.md"), "utf8");
  const section = design.slice(design.indexOf("## Sealed mode and the flight recorder"));
  const body = section.slice(0, section.indexOf("\n## ", 5));
  for (const phrase of [
    "**Recorder.**",
    "inset-inline-start",
    'dir="ltr"',
    "tabular-nums",
    'role="status"',
    "Loading…",
    "Not sent",
    "memory only",
    "never colour alone",
  ])
    assert.ok(body.includes(phrase), phrase);
  assert.doesNotMatch(body, /Only blocked requests show 0 bytes sent/);
});

test("PRIVACY.md documents Sealed mode and the recorder as a partial 07a with the gate pending", () => {
  const privacy = fs.readFileSync(path.join(root, "docs/PRIVACY.md"), "utf8");
  const heading = "## Sealed mode and the flight recorder";
  assert.ok(privacy.indexOf(heading) > privacy.indexOf("## When network requests occur"));
  assert.ok(privacy.indexOf(heading) < privacy.indexOf("## Updates and calendars"));
  assert.match(privacy, /To block all of these at once, turn on Sealed mode \(see below\)\./);
  const section = privacy.slice(privacy.indexOf(heading));
  const body = section.slice(0, section.indexOf("\n## ", 5));
  for (const phrase of [
    "07a",
    "07b",
    "D16",
    "merge",
    "not available on this build",
    "may have received part",
    "Codex",
    "yt-dlp",
    "usual host",
    "100,000",
    "500",
    "memory only",
    "Clear history",
    "Export CSV",
    "proxy or port forwarder",
  ])
    assert.ok(body.includes(phrase), phrase);
  assert.doesNotMatch(body, /verified only after|dates the claim|nothing leaves|0 bytes/i);
  // Inherited policies stay: the dictation undo hold, private credentials, data storage.
  for (const kept of [
    "keeps that recording in memory for 5 seconds",
    "kept only in main-process memory for 8 seconds",
    "The SQLite database, recordings, and exports are not encrypted by Loqui",
  ])
    assert.ok(privacy.includes(kept), kept);
});

test("the network inventory lists the 07a destinations and states the partial status honestly", () => {
  const doc = fs.readFileSync(path.join(root, "docs/network-allowlist.md"), "utf8");
  for (const row of [
    "GPU runtime packs",
    "yt-dlp self-update",
    "Remote images in Markdown",
    "Browser, mail and OS settings",
  ])
    assert.ok(doc.includes(row), row);
  assert.match(doc, /native engines are unavailable while sealed/i);
  assert.match(doc, /07b/);
  assert.match(doc, /merge gate/i);
  assert.doesNotMatch(
    doc,
    /Task 1 adds documentation and inventory ratchets, not runtime enforcement/
  );
  assert.doesNotMatch(doc, /\bverified seal\b|nothing leaves|0 bytes/i);
});
