const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/rovingNav.ts");

test("[change-driving] linear roving focus skips disabled items and wraps", async () => {
  const { stepLinear } = await load();
  const disabled = [false, true, false];
  assert.equal(stepLinear(0, "ArrowDown", disabled), 2);
  assert.equal(stepLinear(2, "ArrowDown", disabled), 0);
  assert.equal(stepLinear(0, "ArrowUp", disabled), 2);
  assert.equal(stepLinear(2, "ArrowRight", disabled), 0);
  assert.equal(stepLinear(0, "ArrowLeft", disabled), 2);
  assert.equal(stepLinear(2, "Home", disabled), 0);
  assert.equal(stepLinear(0, "End", disabled), 2);
  assert.equal(stepLinear(0, "Tab", disabled), 0);
  assert.equal(stepLinear(0, "ArrowDown", [true, true]), 0);
  assert.equal(stepLinear(0, "ArrowDown", []), 0);
});

test("[change-driving] a disabled first item does not trap Home or End", async () => {
  const { stepLinear } = await load();
  assert.equal(stepLinear(2, "Home", [true, false, false]), 1);
  assert.equal(stepLinear(0, "End", [false, false, true]), 1);
});

test("[change-driving] left and right swap in right-to-left layouts", async () => {
  const { stepLinear } = await load();
  const none = [false, false, false];
  assert.equal(stepLinear(0, "ArrowRight", none, false), 1);
  assert.equal(stepLinear(0, "ArrowLeft", none, true), 1);
  assert.equal(stepLinear(1, "ArrowRight", none, true), 0);
  assert.equal(stepLinear(0, "ArrowDown", none, true), 1);
});

test("change-driving: grid roving focus moves by row and swaps left/right in RTL", async () => {
  const { stepGrid } = await load();
  const ltr = { columns: 2, count: 5, rtl: false };
  assert.equal(stepGrid(0, "ArrowRight", ltr), 1);
  assert.equal(stepGrid(1, "ArrowLeft", ltr), 0);
  assert.equal(stepGrid(0, "ArrowDown", ltr), 2);
  assert.equal(stepGrid(3, "ArrowDown", ltr), 4, "clamps to the last card in a short final row");
  assert.equal(stepGrid(4, "ArrowDown", ltr), 4);
  assert.equal(stepGrid(2, "ArrowUp", ltr), 0);
  assert.equal(stepGrid(0, "ArrowUp", ltr), 0);
  assert.equal(stepGrid(3, "Home", ltr), 0);
  assert.equal(stepGrid(0, "End", ltr), 4);
  assert.equal(stepGrid(1, "Tab", ltr), 1);
  assert.equal(stepGrid(0, "ArrowDown", { columns: 2, count: 0, rtl: false }), 0);
  const rtl = { columns: 2, count: 5, rtl: true };
  assert.equal(stepGrid(0, "ArrowLeft", rtl), 1, "in RTL, left moves toward the inline end");
  assert.equal(stepGrid(1, "ArrowRight", rtl), 0);
  assert.equal(stepGrid(0, "ArrowDown", rtl), 2, "vertical keys never flip");
});
