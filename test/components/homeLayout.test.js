const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

test("Coming up follows the content width, not the viewport (WS-Q2)", () => {
  const home = read("src/components/HistoryView.tsx");
  assert.match(home, /@container/);
  assert.match(home, /hidden w-80 shrink-0 @min-\[960px\]:block/);
  assert.doesNotMatch(home, /md:block/);
});

test("the next event's Take notes is always visible (WS-Q13)", () => {
  const upcoming = read("src/components/UpcomingMeetings.tsx");
  assert.match(upcoming, /isNext=\{event\.id === nextEventId\}/);
  assert.match(upcoming, /isNow \|\| isNext/);
  assert.match(upcoming, /startMeetingNotes/);
});

// Plan 01 review: the Today header was still the live orange glass. A calendar
// day is not live voice (D1), so it is a stronger neutral plus the word "Today".
test("Today in Coming up is neutral and says Today in words, not orange glass", () => {
  const upcoming = read("src/components/UpcomingMeetings.tsx");
  assert.doesNotMatch(upcoming, /GRADIENT_CIRCLE|BRAND_GLASS_SURFACE|gradient-brand-glass/);
  assert.match(
    upcoming,
    /group\.isToday\s*\?\s*"bg-foreground\/8 font-semibold text-foreground dark:bg-white\/10"/
  );
  assert.match(upcoming, /t\("upcoming\.todayLabel"\)/);
});
