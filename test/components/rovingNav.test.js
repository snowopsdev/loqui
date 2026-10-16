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
