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
      ev({ id: 4, ts: now - 13 * HOUR, endedAt: now - 13 * HOUR + 400 }), // yesterday: outside
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

test("a request that started before midnight and ended today belongs to today", async () => {
  const { timelineTicks, inWindow, mergeNotice } = await view();
  const across = ev({ id: 8, ts: midnight - 10 * MINUTE, endedAt: midnight + 5 * MINUTE });
  const before = ev({ id: 9, ts: midnight - 10 * MINUTE, endedAt: midnight - MINUTE });
  assert.equal(inWindow(across, midnight), true);
  assert.equal(inWindow(before, midnight), false);
  assert.equal(inWindow(ev({ ts: midnight + 24 * HOUR }), midnight), false, "tomorrow");
  const ticks = timelineTicks([across, before], midnight);
  assert.deepEqual(
    ticks.map((k) => [k.id, k.minute, k.position]),
    [[8, 0, 0]],
    "drawn at the start of the day"
  );
  const joined = mergeNotice([], { phase: "recorded", event: across }, midnight);
  assert.deepEqual(
    joined.map((e) => e.id),
    [8]
  );
});

// Each zone's day boundaries, checked with the zone set through TZ. Santiago
// starts DST at local midnight (2026-09-06 has no 00:00), so "start of day" is
// 01:00 there and the next day still starts at 00:00.
test("the day window is right in DST zones, including DST at midnight (TZ)", async () => {
  const { startOfToday, startOfNextDay, timelineTicks } = await view();
  const saved = process.env.TZ;
  const cases = [
    // zone, local day, its length in hours, its first hour, the next day's first hour
    ["America/Santiago", [2026, 8, 6], 23, 1, 0],
    ["America/Santiago", [2026, 8, 5], 24, 0, 1],
    ["America/Santiago", [2026, 3, 4], 25, 0, 0],
    ["America/New_York", [2026, 2, 8], 23, 0, 0],
    ["America/New_York", [2026, 10, 1], 25, 0, 0],
    ["Europe/Berlin", [2026, 2, 29], 23, 0, 0],
    ["Asia/Kolkata", [2026, 2, 29], 24, 0, 0],
  ];
  try {
    for (const [zone, [y, m, d], hours, startHour, nextStartHour] of cases) {
      process.env.TZ = zone;
      const noon = new Date(y, m, d, 12).getTime();
      const since = startOfToday(noon);
      const end = startOfNextDay(since);
      const label = `${zone} ${y}-${m + 1}-${d}`;
      assert.equal(new Date(since).getDate(), d, label);
      assert.equal(new Date(since).getHours(), startHour, label);
      assert.equal(new Date(end).getDate(), new Date(y, m, d + 1, 12).getDate(), label);
      assert.equal(new Date(end).getHours(), nextStartHour, `${label}: the next day's start`);
      assert.equal(end, startOfToday(new Date(y, m, d + 1, 12).getTime()), label);
      assert.equal((end - since) / HOUR, hours, label);
      const late = ev({ id: 1, ts: end - MINUTE, endedAt: end - MINUTE });
      const [tick] = timelineTicks([late], since);
      assert.ok(tick && tick.position < 1 && tick.position > 0.99, label);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
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
  const older = {
    phase: "recorded",
    event: ev({ id: 3, ts: midnight - 2, endedAt: midnight - 1 }),
  };
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
  // V2: the code is spaced from the status by an outer logical-margin span and
  // isolated left-to-right inside it, so RTL text and the code never run together.
  assert.match(
    html,
    /recorder\.outcome\.blocked<span class="ms-1 text-muted-foreground"><bdi dir="ltr">SEALED_MODE<\/bdi><\/span>/
  );
  assert.match(html, /insetInlineStart|inset-inline-start/);
  assert.doesNotMatch(html, /secret|prompt/i);
  assert.match(html, /settingsPage\.privacy\.recorder\.coverage/);
});

// V1: model ids never break at their hyphens ("gpt-4.1-mini" over three lines).
test("the model cell does not wrap", async () => {
  const html = await renderView({
    events: [ev({ id: 1, model: "gpt-4.1-mini" })],
    summary: sum({ left: 1, observed: 1 }),
  });
  assert.match(html, /<td dir="ltr" class="pe-3 whitespace-nowrap">gpt-4\.1-mini<\/td>/);
});

// Final review I1: a refused program start is not a request. It is counted on
// its own line from main's nativeRefused, names the programs (not hosts), and
// never appears as a request row, a blocked request or an unexplained host.
const nativeRow = (o) =>
  ev({
    task: "nativeLaunch",
    kind: "operation",
    outcome: "blocked",
    bytesOut: 0,
    bytesIn: 0,
    status: null,
    errorClass: "SEALED_MODE",
    model: null,
    ...o,
    hosts: [o.host],
  });

test("view model: refused program starts are program names, never request rows", async () => {
  const { TASKS, taskId, shownEvents, timelineTicks, refusedPrograms, mergeNotice } = await view();
  assert.ok(TASKS.includes("nativeLaunch"));
  assert.equal(taskId("nativeLaunch"), "nativeLaunch");
  const rows = [
    ev({ id: 1 }),
    nativeRow({ id: 2, host: "native-pactl" }),
    nativeRow({ id: 3, host: "native-ps", ts: now - 2 * HOUR }),
    nativeRow({ id: 4, host: "native-pactl", ts: now - 3 * HOUR }), // a later seal epoch
    nativeRow({ id: 5, host: "native-unknown" }),
    // Defensive: whatever kind main gives it, a program start is never a request.
    nativeRow({ id: 6, host: "native-yt-dlp", kind: "request" }),
    nativeRow({ id: 7, host: "native-ffmpeg", ts: midnight - HOUR, endedAt: midnight - HOUR }),
  ];
  assert.deepEqual(
    shownEvents(rows).map((e) => e.id),
    [1]
  );
  assert.deepEqual(
    timelineTicks(rows, midnight).map((k) => k.id),
    [1]
  );
  // Today's programs, once each, by name; an unnamed program is only counted.
  assert.deepEqual(refusedPrograms(rows, midnight), ["pactl", "ps", "yt-dlp"]);
  const notice = {
    phase: "recorded",
    event: nativeRow({ id: 8, host: "native-ps", kind: "request" }),
  };
  assert.equal(mergeNotice(rows, notice, midnight), rows, "a live program start is not a row");
});

test("the view counts refused program starts apart and lists the programs", async () => {
  const html = await renderView({
    events: [
      ev({ id: 1 }),
      nativeRow({ id: 2, host: "native-pactl" }),
      nativeRow({ id: 3, host: "native-ps" }),
      nativeRow({ id: 4, host: "native-unknown" }),
    ],
    summary: sum({ left: 1, observed: 1, nativeRefused: 3 }),
  });
  assert.match(html, /recorder\.nativeRefusedToday\{"count":3\}/);
  assert.match(html, /recorder\.nativeRefusedPrograms\{"names":"pactl, ps"\}/);
  assert.match(html, /observedToday\{"count":1\}/);
  assert.doesNotMatch(html, /blockedToday|recorder\.unexplained|recorder\.notSent/);
  assert.doesNotMatch(html, /native-|tasks\.nativeLaunch|data-kind="operation"/);
  // One request row only.
  assert.equal((html.match(/<tr data-kind=/g) || []).length, 1);
  const none = await renderView({ events: [ev({ id: 1 })], summary: sum({ observed: 1 }) });
  assert.doesNotMatch(none, /nativeRefused/);
});

// Final review I5: a write failure no longer hides the list. Main's summary
// carries persistError; the panel keeps the rows and the actions and says the
// list may be incomplete.
test("a write failure keeps the list and the actions, and says the list may be incomplete", async () => {
  const html = await renderView({
    events: [ev({ id: 1 })],
    summary: sum({ left: 1, observed: 1, persistError: "SQLITE_BUSY" }),
  });
  assert.match(html, /role="status"[\s\S]*recorder\.unavailable</);
  assert.match(html, /<tr data-kind="request"/);
  assert.equal((html.match(/<button[^>]*disabled=""/g) || []).length, 0, "Export and Clear stay");
  assert.doesNotMatch(html, /SQLITE_BUSY/, "the error code is not shown as text");
  for (const persistError of [null, undefined]) {
    const clean = await renderView({
      events: [ev({ id: 1 })],
      summary: sum({ left: 1, observed: 1, persistError }),
    });
    assert.doesNotMatch(clean, /recorder\.unavailable</);
  }
  const en = resources.en.settingsPage.privacy.recorder.unavailable;
  assert.match(en, /couldn't save some records/);
  assert.doesNotMatch(en, /can't read/, "the list is readable when it says this");
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
    ["unavailable", "unavailableRead"],
  ]) {
    const html = await renderView({
      events: [ev({ id: 1 })],
      summary: sum({ observed: 1, left: 1 }),
      error,
      onRetry() {},
      persistError: true,
    });
    // No list is shown, so nothing may speak of "this list" (M5).
    assert.doesNotMatch(html, /recorder\.unavailable</);
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
  // The timeline draws only the fetched rows, so it says it is partial and
  // shades the hours before the oldest fetched row instead of showing them empty.
  assert.match(more, /recorder\.timelinePartial/);
  assert.match(more, /aria-label="settingsPage\.privacy\.recorder\.timelineLabelPartial"/);
  const band = /data-partial=""[^>]*style="[^"]*inset-inline-start:0%;width:([\d.]+)%/.exec(more);
  assert.ok(band, "a band covers the hours not drawn");
  const oldest = (now - 2 * MINUTE - midnight) / (24 * HOUR);
  assert.ok(Math.abs(Number(band[1]) - oldest * 100) < 0.01, band[1]);
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
  assert.doesNotMatch(whole, /recorder\.truncated|recorder\.showMore|timelinePartial|data-partial/);
  assert.match(whole, /aria-label="settingsPage\.privacy\.recorder\.timelineLabel"/);
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
  assert.match(html, /recorder\.unavailable</);
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
  const { feed, fake } = await startFeed({ clock: () => clock });
  await fake.answer([ev({ id: 1 })], sum({ observed: 1 }));
  const nextMidnight = new Date(2026, 9, 16).getTime();
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

test("feed: the rollover check is re-armed against the real clock, so sleep cannot hide midnight", async () => {
  const { ROLLOVER_CHECK_MS } = await feedModule();
  assert.ok(ROLLOVER_CHECK_MS <= MINUTE, "checked at least once a minute");
  let clock = now;
  const { feed, fake, timers, LIVE_REFRESH_MS } = await startFeed({ clock: () => clock });
  await fake.answer([ev({ id: 1 })], sum({ observed: 1 }));
  const rollover = () => [...timers.timers.values()].filter((x) => x.ms > LIVE_REFRESH_MS);
  assert.equal(rollover().length, 1, "a rollover check is armed");
  assert.ok(rollover()[0].ms <= ROLLOVER_CHECK_MS);
  // Before midnight a check only re-arms: no refetch, rows stay.
  const fetches = fake.calls.length;
  clock = now + 30 * MINUTE;
  await timers.fire((x) => x.ms > LIVE_REFRESH_MS);
  assert.equal(fake.calls.length, fetches);
  assert.equal(rollover().length, 1, "re-armed");
  assert.equal(feed.getState().events.length, 1);
  // The machine slept across midnight: the next check sees the real clock.
  const nextMidnight = new Date(2026, 9, 16).getTime();
  clock = nextMidnight + 3 * HOUR;
  await timers.fire((x) => x.ms > LIVE_REFRESH_MS);
  assert.equal(feed.getState().since, nextMidnight);
  assert.equal(feed.getState().events.length, 0, "nothing from yesterday stays");
  assert.deepEqual(fake.calls.at(-2), ["list", { since: nextMidnight, limit: 500 }]);
});

test("feed: checkDay (focus, visibility) moves the window only when the day changed", async () => {
  let clock = now;
  const { feed, fake } = await startFeed({ clock: () => clock });
  await fake.answer([ev({ id: 1 })], sum({ observed: 1 }));
  const fetches = fake.calls.length;
  feed.checkDay();
  assert.equal(fake.calls.length, fetches, "same day: nothing to do");
  assert.equal(feed.getState().status, "ready");
  const nextMidnight = new Date(2026, 9, 16).getTime();
  clock = nextMidnight + 8 * HOUR;
  feed.checkDay();
  assert.equal(feed.getState().status, "loading");
  assert.equal(feed.getState().since, nextMidnight);
  assert.equal(feed.getState().events.length, 0);
  assert.deepEqual(fake.calls.at(-1), ["summary", { since: nextMidnight }]);
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

test("mounted: on focus or visibility after midnight the panel moves to the new day", async (t) => {
  const listeners = { window: new Map(), document: new Map() };
  const add = (map) => (type, fn) => map.set(type, fn);
  const ui = await mountComponent(t, "/components/settings/FlightRecorderPanel.tsx", {
    api: { privacy: bridge() },
    windowProps: { addEventListener: add(listeners.window), removeEventListener() {} },
    beforeImport() {
      const doc = globalThis.document;
      doc.addEventListener = add(listeners.document);
      doc.removeEventListener = () => {};
    },
  });
  await flush();
  assert.equal(typeof listeners.window.get("focus"), "function", "focus is watched");
  assert.equal(typeof listeners.document.get("visibilitychange"), "function");
  const lists = () => ui.calls.filter(([name]) => name === "privacy.listEgress");
  const before = lists().length;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const realNow = Date.now;
  Date.now = () => tomorrow.getTime();
  t.after(() => (Date.now = realNow));
  await React.act(async () => listeners.window.get("focus")());
  await flush();
  assert.equal(lists().length, before + 1);
  const since = new Date(tomorrow);
  since.setHours(0, 0, 0, 0);
  assert.deepEqual(lists().at(-1)[1], { since: since.getTime(), limit: 500 });
  // Already on the new day: visibility re-checks and finds nothing to do.
  globalThis.document.visibilityState = "visible";
  await React.act(async () => listeners.document.get("visibilitychange")());
  await flush();
  assert.equal(lists().length, before + 1);
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
  "unavailableRead",
  "retry",
  "coverage",
  "unexplained",
  "timelineLabel",
  "timelineLabelPartial",
  "timelinePartial",
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
  "nativeRefusedPrograms",
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
  "nativeRefusedToday",
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
      `${R}.bytesNote`,
      `${R}.connection`,
      `${R}.unavailableRead`,
      `${R}.timelinePartial`,
      `${R}.timelineLabelPartial`,
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
          nativeRow({ id: 7, host: "native-pactl" }),
        ],
        summary: sum({
          nativeRefused: 21,
          persistError: "SQLITE_BUSY",
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
      { events: [], summary: null, error: "unavailable", onRetry() {}, persistError: true },
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
  const rec = resources.en.settingsPage.privacy.recorder;
  // History off scopes memory-only to NEW records; earlier saved records stay
  // on disk and stay listed until retention removes them or they are cleared (I1).
  assert.match(rec.retentionMemory, /^Local history is off: new records are kept in memory only/);
  assert.match(rec.retentionMemory, /500/);
  assert.match(rec.retentionMemory, /gone when Loqui quits/);
  assert.match(rec.retentionMemory, /saved before you turned it off stay on this computer/);
  assert.match(rec.retentionMemory, /retention setting removes them or you clear them/);
  // Every connection row counts its whole connection; a connection's own
  // requests are not visible to Loqui (M4).
  assert.match(rec.bytesNote, /request and response bodies, not headers/);
  assert.match(rec.bytesNote, /Connection rows, including live transcription, count/);
  assert.match(rec.bytesNote, /whole connection/);
  assert.doesNotMatch(rec.bytesNote, /except/);
  assert.match(rec.connection, /requests inside it aren't visible to Loqui/);
  // A failed read shows no list, so its alert does not mention one (M5).
  assert.doesNotMatch(rec.unavailableRead, /list/);
  assert.match(rec.unavailable, /this list may be incomplete/);
  assert.match(rec.timelinePartial, /only the records listed below/);
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
    "new records are in memory only",
    "saved before history was turned off stay",
    "started before midnight",
    "partial",
    "whole connection",
  ])
    assert.ok(body.includes(phrase), phrase);
  assert.doesNotMatch(body, /Only blocked requests show 0 bytes sent/);
  assert.doesNotMatch(body, /with local history off it says records are in memory only/);
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
    "`*.localhost`",
    "IPv4-mapped",
    "New records are kept in memory only",
    "Records saved before you turned local history off stay on this computer",
    "started before midnight",
    "Every connection row",
    "whole connection",
  ])
    assert.ok(body.includes(phrase), phrase);
  // The old wording made every record memory-only once history was off (I1).
  assert.doesNotMatch(body, /With local history off, records are kept in memory only/);
  assert.doesNotMatch(body, /except live transcription connections/);
  // Named destinations that were only covered by generic rows (M3).
  const table = privacy.slice(
    privacy.indexOf("## When network requests occur"),
    privacy.indexOf(heading)
  );
  for (const row of [
    "| Tinfoil attestation",
    "`atc.tinfoil.sh`",
    "`github-proxy.tinfoil.sh`",
    "`kds-proxy.tinfoil.sh`",
    "| Assistant screen context",
    "screenshot",
  ])
    assert.ok(table.includes(row), row);
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
    "| Tinfoil attestation",
    "`atc.tinfoil.sh`",
    "`github-proxy.tinfoil.sh`",
    "`kds-proxy.tinfoil.sh`",
    "| Assistant screen context",
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
