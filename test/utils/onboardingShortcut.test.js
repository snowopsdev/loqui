const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingShortcut.ts");

test("a press under 350 ms is a tap; longer is a hold", async () => {
  const { pressStyle } = await load();
  assert.equal(pressStyle(1000, 1349), "tap");
  assert.equal(pressStyle(1000, 1350), "hold");
});

test("the keycap counts presses once, even when two sources report the same press", async () => {
  const { INITIAL_KEYCAP, reduceKeycap } = await load();
  let state = reduceKeycap(INITIAL_KEYCAP, { phase: "down", at: 0 });
  state = reduceKeycap(state, { phase: "down", at: 5 });
  assert.deepEqual(state, { pressed: true, downAtMs: 0, lastStyle: null, presses: 0 });
  assert.equal(
    reduceKeycap(state, { phase: "tap", at: 6 }),
    state,
    "a synthetic tap during a native press is the same press (ONB-16)"
  );
  state = reduceKeycap(state, { phase: "up", at: 600 });
  assert.deepEqual(state, { pressed: false, downAtMs: null, lastStyle: "hold", presses: 1 });
  assert.equal(reduceKeycap(state, { phase: "up", at: 700 }), state, "a stray up changes nothing");
  assert.deepEqual(reduceKeycap(state, { phase: "tap", at: 800 }), {
    pressed: false,
    downAtMs: null,
    lastStyle: "tap",
    presses: 2,
  });
});

test("suggests the activation mode that matches how you pressed", async () => {
  const { suggestActivationMode } = await load();
  assert.equal(suggestActivationMode("tap", "hold", true), "push");
  assert.equal(
    suggestActivationMode("tap", "hold", false),
    null,
    "never suggest what the key can't do"
  );
  assert.equal(suggestActivationMode("push", "tap", true), "tap");
  assert.equal(suggestActivationMode("tap", "tap", true), null);
});

test("the Globe key reads as fn", async () => {
  const { keycapLabel } = await load();
  assert.equal(keycapLabel("GLOBE", "darwin"), "fn");
  assert.equal(keycapLabel("Fn", "darwin"), "fn");
  assert.ok(keycapLabel("Control+Super", "linux").length > 0);
});
