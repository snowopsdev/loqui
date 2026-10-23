const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const load = () => import("../../src/utils/upcomingEventGroups.ts");
const at = (h, m = 0, day = 15) => new Date(2026, 9, day, h, m);
const event = (start, end, summary = "Standup") => ({
  id: summary,
  summary,
  start_time: start.toISOString(),
  end_time: end.toISOString(),
});

test("an event is live from its start to its end, inclusive", async () => {
  const { isEventLive } = await load();
  const standup = event(at(9), at(9, 30));
  assert.equal(isEventLive(standup, at(8, 59)), false);
  assert.equal(isEventLive(standup, at(9)), true);
  assert.equal(isEventLive(standup, at(9, 30)), true);
  assert.equal(isEventLive(standup, at(9, 31)), false);
});

test("unparseable times are never live", async () => {
  const { isEventLive } = await load();
  assert.equal(isEventLive({ start_time: "nope", end_time: "nope" }, at(9)), false);
});

test("an all-day event is live across its local day, matching its day group", async () => {
  const { isEventLive } = await load();
  const allDay = { start_time: "2026-10-15", end_time: "2026-10-16" };
  assert.equal(isEventLive(allDay, at(0, 30)), true);
  assert.equal(isEventLive(allDay, at(23, 30)), true);
  assert.equal(isEventLive(allDay, at(9, 0, 14)), false);
});

test("'today' moves with the clock across midnight", async () => {
  const { groupEventsByDay } = await load();
  const events = [event(at(9, 0, 16), at(9, 30, 16))];
  const before = groupEventsByDay(events, at(23, 59, 15));
  assert.equal(before[0].isToday, true, "an empty today card leads before midnight");
  assert.equal(before[1].isToday, false);
  const after = groupEventsByDay(events, at(0, 0, 16));
  assert.equal(after.length, 1);
  assert.equal(after[0].isToday, true, "the 16th becomes today after midnight");
});

test("UpcomingMeetings no longer freezes its clock", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/components/UpcomingMeetings.tsx"),
    "utf8"
  );
  assert.doesNotMatch(source, /useMemo\(\(\) => new Date\(\), \[\]\)/);
  assert.match(source, /const now = useNow\(\);/);
  assert.match(source, /isEventLive\(event, now\)/);
});
