const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/upcomingEvents.ts");
const ev = (id, start, end, over = {}) => ({
  id,
  calendar_id: "c",
  provider: "google",
  summary: id,
  start_time: start,
  end_time: end,
  is_all_day: 0,
  status: "confirmed",
  hangout_link: null,
  conference_data: null,
  organizer_email: null,
  attendees_count: 3,
  attendees: null,
  availability_status: "busy",
  self_response_status: "accepted",
  ...over,
});
const now = new Date("2026-10-14T15:48:00Z");

test("the next event is the earliest one still to start", async () => {
  const { nextUpcomingEvent } = await load();
  const result = nextUpcomingEvent(
    [
      ev("Design sync", "2026-10-14T16:45:00Z", "2026-10-14T17:30:00Z"),
      ev("Product catch-up", "2026-10-14T16:00:00Z", "2026-10-14T16:42:00Z"),
    ],
    now
  );
  assert.equal(result.event.id, "Product catch-up");
  assert.deepEqual(result.start, { kind: "minutes", minutes: 12 });
});

test("a meeting in progress wins and is Now", async () => {
  const { nextUpcomingEvent } = await load();
  const result = nextUpcomingEvent(
    [
      ev("Later", "2026-10-14T16:00:00Z", "2026-10-14T16:30:00Z"),
      ev("Standup", "2026-10-14T15:45:00Z", "2026-10-14T16:00:00Z"),
    ],
    now
  );
  assert.equal(result.event.id, "Standup");
  assert.deepEqual(result.start, { kind: "now" });
});

test("all-day, cancelled and finished events are skipped", async () => {
  const { nextUpcomingEvent } = await load();
  assert.equal(
    nextUpcomingEvent(
      [
        ev("Holiday", "2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z", { is_all_day: 1 }),
        ev("Gone", "2026-10-14T16:00:00Z", "2026-10-14T17:00:00Z", { status: "cancelled" }),
        ev("Over", "2026-10-14T13:00:00Z", "2026-10-14T14:00:00Z"),
      ],
      now
    ),
    null
  );
});

test("an hour or more away is described by its time", async () => {
  const { describeStart } = await load();
  const start = describeStart(ev("x", "2026-10-14T17:00:00Z", "2026-10-14T18:00:00Z"), now);
  assert.equal(start.kind, "later");
  assert.equal(start.at.toISOString(), "2026-10-14T17:00:00.000Z");
});

test("invalid dates are excluded without mutating the caller's events", async () => {
  const { nextUpcomingEvent, describeStart } = await load();
  const valid = ev("valid", "2026-10-14T16:00:00Z", "2026-10-14T17:00:00Z");
  const invalid = ev("invalid", "broken", "2026-10-14T17:00:00Z");
  const events = Object.freeze([valid, invalid, ev("bad end", valid.start_time, "broken")]);
  assert.equal(nextUpcomingEvent(events, now)?.event, valid);
  assert.equal(events[0], valid);
  const start = describeStart(invalid, now);
  assert.equal(start.kind, "later");
  assert.ok(Number.isNaN(start.at.getTime()));
});

test("start boundaries, ceiling minutes and exactly one hour keep their meaning", async () => {
  const { describeStart } = await load();
  const event = ev("x", "2026-10-14T16:00:00Z", "2026-10-14T17:00:00Z");
  assert.deepEqual(describeStart(event, new Date(event.start_time)), { kind: "now" });
  assert.deepEqual(describeStart(event, new Date(event.end_time)), { kind: "now" });
  assert.deepEqual(describeStart(event, new Date("2026-10-14T15:59:59Z")), {
    kind: "minutes",
    minutes: 1,
  });
  assert.equal(describeStart(event, new Date("2026-10-14T15:00:00Z")).kind, "later");
});

test("Take notes dispatches the same event once and exclusively uses the available opener", async () => {
  const { startMeetingNotes } = await load();
  const original = global.window;
  const calls = [];
  const event = ev("target", "2026-10-14T16:00:00Z", "2026-10-14T17:00:00Z", {
    hangout_link: "https://meet.google.com/synthetic-room",
  });
  try {
    global.window = {
      electronAPI: {
        openExternal: (url) => calls.push(["native", url]),
        joinCalendarMeeting: (id) => calls.push(["notes", id]),
      },
      open: (...args) => calls.push(["browser", ...args]),
    };
    startMeetingNotes(event);
    assert.deepEqual(calls.splice(0), [
      ["native", event.hangout_link],
      ["notes", "target"],
    ]);
    delete global.window.electronAPI.openExternal;
    startMeetingNotes(event);
    assert.deepEqual(calls.splice(0), [
      ["browser", event.hangout_link, "_blank"],
      ["notes", "target"],
    ]);
    startMeetingNotes({ ...event, hangout_link: null });
    assert.deepEqual(calls, [["notes", "target"]]);
  } finally {
    global.window = original;
  }
});
