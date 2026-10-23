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

const restFrame = (LOGO_BAR_SHAPE, levelBarScale) => ({
  scales: LOGO_BAR_SHAPE.map((_, i) => levelBarScale(i, 0, 0.5)),
  peak: 0.01,
});

test("a NaN sample steps toward the rest silhouette", async () => {
  const { nextLevelBarsFrame, levelBarScale, LOGO_BAR_SHAPE } = await loadMath();
  const rest = restFrame(LOGO_BAR_SHAPE, levelBarScale);
  const next = nextLevelBarsFrame(rest, Number.NaN, 1000, 33, false);
  assert.deepEqual(next.scales, rest.scales);
  const neg = nextLevelBarsFrame(rest, -3, 1000, 33, false);
  assert.deepEqual(neg.scales, rest.scales);
});

test("noise below the silence floor keeps the rest silhouette after long silence", async () => {
  const { nextLevelBarsFrame, levelBarScale, LOGO_BAR_SHAPE, LEVEL_BARS_SILENCE_FLOOR } =
    await loadMath();
  assert.equal(LEVEL_BARS_SILENCE_FLOOR, 0.004);
  let frame = { scales: restFrame(LOGO_BAR_SHAPE, levelBarScale).scales, peak: 1 };
  for (let t = 0; t < 400; t++) {
    frame = nextLevelBarsFrame(frame, 0.003, t * 33, 33, false);
  }
  assert.deepEqual(frame.scales, restFrame(LOGO_BAR_SHAPE, levelBarScale).scales);
  assert.ok(frame.peak >= 0.01 && frame.peak < 0.02);
});

test("reduced motion skips smoothing and the phase wobble", async () => {
  const { nextLevelBarsFrame, levelBarScale, LOGO_BAR_SHAPE } = await loadMath();
  const prev = restFrame(LOGO_BAR_SHAPE, levelBarScale);
  const a = nextLevelBarsFrame(prev, 0.5, 1000, 100, true);
  const b = nextLevelBarsFrame(prev, 0.5, 98765, 100, true);
  assert.deepEqual(a.scales, b.scales);
  assert.deepEqual(
    a.scales,
    LOGO_BAR_SHAPE.map((_, i) => levelBarScale(i, 0.5 / a.peak, 0.5))
  );
});

test("peak decay depends on elapsed time, not on the sampling rate", async () => {
  const { nextLevelBarsFrame, levelBarScale, LOGO_BAR_SHAPE } = await loadMath();
  const start = { ...restFrame(LOGO_BAR_SHAPE, levelBarScale), peak: 1 };
  const run = (dt) => {
    let frame = start;
    for (let t = 0; t < 1000; t += dt) frame = nextLevelBarsFrame(frame, 0, t, dt, false);
    return frame.peak;
  };
  assert.ok(Math.abs(run(25) - run(100)) < 1e-3, `${run(25)} vs ${run(100)}`);
  assert.ok(run(25) < 0.8);
});

const loadSampler = () => import("../../src/components/ui/levelBarsSampler.ts");

// A hand-driven environment: timers and the reduced-motion query are fakes so
// the sampler's lifecycle can be exercised without a DOM.
function fakeEnv(initialReduce) {
  const timers = new Map();
  let nextId = 1;
  let now = 1000;
  const listeners = new Set();
  const mql = {
    matches: initialReduce,
    addEventListener: (type, fn) => type === "change" && listeners.add(fn),
    removeEventListener: (type, fn) => type === "change" && listeners.delete(fn),
  };
  const env = {
    matchMedia: () => mql,
    now: () => now,
    setInterval: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
  };
  return {
    env,
    listeners,
    timers,
    intervals: () => [...timers.values()].map((t) => t.ms),
    advance(ms) {
      now += ms;
      for (const t of [...timers.values()]) t.fn();
    },
    setReduce(value) {
      mql.matches = value;
      for (const fn of [...listeners]) fn({ matches: value });
    },
  };
}

test("sampler follows reduced-motion changes while mounted and cleans up", async () => {
  const { startLevelBarsSampler } = await loadSampler();
  const { levelBarScale, LOGO_BAR_SHAPE } = await loadMath();
  const sim = fakeEnv(false);
  const frameRef = { current: restFrame(LOGO_BAR_SHAPE, levelBarScale) };
  const frames = [];
  const stop = startLevelBarsSampler({
    frameRef,
    readLevel: () => 0.5,
    onFrame: (f) => frames.push(f),
    env: sim.env,
  });
  assert.deepEqual(sim.intervals(), [33]);
  assert.equal(sim.listeners.size, 1);

  sim.setReduce(true);
  assert.deepEqual(sim.intervals(), [100], "old timer replaced by the slow one");
  sim.advance(100);
  const flatA = frameRef.current.scales;
  sim.advance(100);
  assert.deepEqual(frameRef.current.scales, flatA, "reduced frames hold a stable phase");

  sim.setReduce(false);
  assert.deepEqual(sim.intervals(), [33], "back to full motion rate");
  assert.equal(frames.length, 2);

  stop();
  assert.equal(sim.timers.size, 0, "timer cleared");
  assert.equal(sim.listeners.size, 0, "listener removed");
});

test("sampler starts in the reduced rate and survives a missing matchMedia", async () => {
  const { startLevelBarsSampler } = await loadSampler();
  const { levelBarScale, LOGO_BAR_SHAPE } = await loadMath();
  const reduced = fakeEnv(true);
  startLevelBarsSampler({
    frameRef: { current: restFrame(LOGO_BAR_SHAPE, levelBarScale) },
    readLevel: () => 0,
    onFrame() {},
    env: reduced.env,
  });
  assert.deepEqual(reduced.intervals(), [100]);

  const bare = fakeEnv(false);
  const stop = startLevelBarsSampler({
    frameRef: { current: restFrame(LOGO_BAR_SHAPE, levelBarScale) },
    readLevel: () => {
      throw new Error("dead analyser");
    },
    onFrame() {},
    env: { ...bare.env, matchMedia: undefined },
  });
  assert.deepEqual(bare.intervals(), [33]);
  assert.doesNotThrow(() => bare.advance(33), "a throwing reader reads as silence");
  stop();
  assert.equal(bare.timers.size, 0);
});

test("tone onLive paints paper bars for a --color-live surface; brand stays the default (Plan 05 extension, §5)", async () => {
  const { LevelBars } = await loadComponent();
  const brand = renderStatic(LevelBars, { readLevel: () => 0, height: 20 });
  assert.ok(brand.includes("linear-gradient(180deg, #ff6a36, #e6007a)"));
  assert.ok(brand.includes('data-tone="brand"'));
  const onLive = renderStatic(LevelBars, { readLevel: () => 0, height: 20, tone: "onLive" });
  assert.equal(onLive.includes("linear-gradient"), false);
  assert.equal(onLive.split("var(--color-background)").length - 1, 5);
  assert.ok(onLive.includes('data-tone="onLive"'));
});
