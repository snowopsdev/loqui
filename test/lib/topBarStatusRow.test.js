const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/topBarStatusRow.ts");

test("inline stays inline while the header fits", async () => {
  const { INLINE_STATUS_ROW, nextStatusRow } = await load();
  const next = nextStatusRow(INLINE_STATUS_ROW, { clientWidth: 800, scrollWidth: 800 });
  assert.equal(next.stacked, false);
});

test("an overflowing header stacks the status and remembers the width it needed", async () => {
  const { INLINE_STATUS_ROW, nextStatusRow } = await load();
  const next = nextStatusRow(INLINE_STATUS_ROW, { clientWidth: 460, scrollWidth: 514 });
  assert.deepEqual(next, { stacked: true, neededWidth: 514 });
});

test("a sub-pixel difference is not an overflow", async () => {
  const { INLINE_STATUS_ROW, nextStatusRow } = await load();
  assert.equal(
    nextStatusRow(INLINE_STATUS_ROW, { clientWidth: 500, scrollWidth: 501 }).stacked,
    false
  );
});

test("stacked stays stacked until the header is as wide as the inline layout needed", async () => {
  const { nextStatusRow } = await load();
  const stacked = { stacked: true, neededWidth: 514 };
  // Stacked, the header no longer overflows, but inline still would.
  assert.equal(nextStatusRow(stacked, { clientWidth: 513, scrollWidth: 513 }), stacked);
  assert.deepEqual(nextStatusRow(stacked, { clientWidth: 514, scrollWidth: 514 }), {
    stacked: false,
    neededWidth: 0,
  });
});
