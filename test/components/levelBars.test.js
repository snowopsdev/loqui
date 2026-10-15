const assert = require("node:assert/strict");
const test = require("node:test");
const { renderStatic } = require("../helpers/harness/reactSsr");

const loadMath = () => import("../../src/components/ui/levelBarsMath.ts");
const loadComponent = () => import("../../src/components/ui/LevelBars.tsx");

test("silence settles into the logo silhouette", async () => {
  const { levelBarScale, LOGO_BAR_SHAPE } = await loadMath();
  assert.deepEqual([...LOGO_BAR_SHAPE], [0.42, 0.7, 1, 0.7, 0.42]);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => levelBarScale(i, 0, 0.5)),
    [0.231, 0.385, 0.55, 0.385, 0.231]
  );
});

test("speech grows bars within the silhouette and never exceeds 1", async () => {
  const { levelBarScale } = await loadMath();
  assert.equal(levelBarScale(2, 1, 1), 1);
  assert.equal(levelBarScale(2, 0.5, 0), 0.637);
  assert.equal(levelBarScale(1, 0.5, 0.5), 0.541);
  assert.ok(levelBarScale(0, 5, 1) <= 0.42);
});

test("garbage levels from a dead analyser render the resting silhouette", async () => {
  const { levelBarScale } = await loadMath();
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY, undefined]) {
    assert.equal(levelBarScale(2, bad, 0.5), 0.55, String(bad));
  }
  assert.equal(levelBarScale(9, 0.8, 0.5), 0);
});

test("phase is periodic in 0..1 and smoothing moves part of the way", async () => {
  const { barPhase, smoothToward } = await loadMath();
  for (const t of [0, 123, 9999]) {
    const p = barPhase(3, t);
    assert.ok(p >= 0 && p <= 1);
  }
  assert.equal(smoothToward(0, 1, 0.3), 0.3);
  assert.equal(smoothToward(0.5, 0.5, 0.3), 0.5);
});

test("component renders five gradient bars at rest, hidden from assistive tech", async () => {
  const { LevelBars } = await loadComponent();
  const html = renderStatic(LevelBars, { readLevel: () => 0, height: 20 });
  assert.match(html, /aria-hidden="true"/);
  assert.equal(html.split('data-level-bar=""').length - 1, 5);
  for (const s of ["0.231", "0.385", "0.55"]) assert.ok(html.includes(`scaleY(${s})`), s);
  assert.ok(html.includes("linear-gradient(180deg, #ff6a36, #e6007a)"));
});

test("reduced motion samples at 10 Hz", async () => {
  const { LEVEL_BARS_SAMPLE_MS, LEVEL_BARS_REDUCED_SAMPLE_MS } = await loadMath();
  assert.equal(LEVEL_BARS_SAMPLE_MS, 33);
  assert.equal(LEVEL_BARS_REDUCED_SAMPLE_MS, 100);
});
