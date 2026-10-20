const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/table/tableGeometry.ts");
const card = (id, x, y, w = 100, h = 50) => ({ id, rect: { x, y, w, h } });

test("screen and world coordinates invert each other", async () => {
  const { screenToWorld, worldToScreen } = await load();
  const v = { x: 40, y: -20, scale: 2 };
  assert.deepEqual(worldToScreen({ x: 10, y: 10 }, v), { x: 60, y: 0 });
  assert.deepEqual(screenToWorld({ x: 60, y: 0 }, v), { x: 10, y: 10 });
});

test("zoom keeps the anchor fixed and clamps to 25–200%", async () => {
  const { zoomAt, screenToWorld } = await load();
  const v = { x: 0, y: 0, scale: 1 };
  const z = zoomAt(v, 2, { x: 100, y: 100 });
  assert.deepEqual(z, { x: -100, y: -100, scale: 2 });
  assert.deepEqual(screenToWorld({ x: 100, y: 100 }, z), screenToWorld({ x: 100, y: 100 }, v));
  assert.equal(zoomAt(z, 10, { x: 0, y: 0 }).scale, 2);
  assert.equal(zoomAt(v, 0.01, { x: 0, y: 0 }).scale, 0.25);
  assert.equal(zoomAt(v, Number.NaN, { x: 0, y: 0 }).scale, 1);
});

test("snapping lands on the 8px grid", async () => {
  const { snapToGrid } = await load();
  assert.deepEqual([3, 4, 12, -5].map((n) => snapToGrid(n)), [0, 8, 16, -8]);
});

test("lasso selects cards it touches in world space", async () => {
  const { lassoSelect } = await load();
  const items = [card("a", 0, 0), card("b", 300, 0), card("c", 0, 300)];
  assert.deepEqual(lassoSelect(items, { x: 50, y: 25, w: 300, h: 10 }, { x: 0, y: 0, scale: 1 }), ["a", "b"]);
  assert.deepEqual(lassoSelect(items, { x: 0, y: 140, w: 20, h: 20 }, { x: 0, y: 0, scale: 0.5 }), ["c"]);
});

test("virtualisation renders 1.5x the viewport and never culls focused or selected cards", async () => {
  const { visibleIds } = await load();
  const items = [card("near", 10, 10), card("edge", 1200, 10), card("far", 5000, 5000)];
  const ids = visibleIds(items, { x: 0, y: 0, scale: 1 }, { width: 1000, height: 600 });
  assert.deepEqual([...ids].sort(), ["edge", "near"]);
  assert.ok(visibleIds(items, { x: 0, y: 0, scale: 1 }, { width: 1000, height: 600 }, ["far"]).has("far"));
});

test("ensureVisible pans the least distance needed", async () => {
  const { ensureVisible } = await load();
  const size = { width: 800, height: 600 };
  const v = { x: 0, y: 0, scale: 1 };
  assert.equal(ensureVisible({ x: 100, y: 100, w: 100, h: 50 }, v, size), v, "already visible: same object");
  assert.deepEqual(ensureVisible({ x: 900, y: 100, w: 100, h: 50 }, v, size), { x: -224, y: 0, scale: 1 });
  assert.deepEqual(ensureVisible({ x: -50, y: -80, w: 100, h: 50 }, v, size), { x: 74, y: 104, scale: 1 });
});

test("arrow focus picks the nearest card in that direction", async () => {
  const { nearestInDirection } = await load();
  const items = [card("o", 0, 0), card("r", 200, 10), card("rr", 400, 0), card("d", 0, 200), card("diag", 150, 150)];
  assert.equal(nearestInDirection("o", items, "right"), "r");
  assert.equal(nearestInDirection("o", items, "down"), "d");
  assert.equal(nearestInDirection("o", items, "left"), null);
  assert.equal(nearestInDirection("missing", items, "left"), null);
});

test("connectors leave the facing edges with a smooth curve", async () => {
  const { connectorPath } = await load();
  assert.equal(connectorPath({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 }), "M100 25 C200 25 200 25 300 25");
  assert.equal(connectorPath({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 }), "M50 50 C50 125 50 125 50 200");
});

test("auto-placement fills rows below arranged cards on the grid", async () => {
  const { autoPlace } = await load();
  const sizes = Array.from({ length: 5 }, () => ({ w: 280, h: 152 }));
  assert.deepEqual(autoPlace(sizes, []), [
    { x: 32, y: 32 }, { x: 344, y: 32 }, { x: 656, y: 32 }, { x: 968, y: 32 }, { x: 32, y: 216 },
  ]);
  const below = autoPlace([{ w: 220, h: 112 }], [{ x: 96, y: 40, w: 280, h: 160 }]);
  assert.deepEqual(below, [{ x: 96, y: 264 }]);
});

test("fit shows every card, never zooms past 100%, and centres", async () => {
  const { fitViewport, DEFAULT_VIEWPORT } = await load();
  assert.deepEqual(fitViewport([], { width: 800, height: 600 }), DEFAULT_VIEWPORT);
  assert.deepEqual(fitViewport([{ x: 0, y: 0, w: 100, h: 100 }], { width: 800, height: 600 }), { x: 350, y: 250, scale: 1 });
  const wide = fitViewport([{ x: 0, y: 0, w: 2000, h: 100 }], { width: 800, height: 600 });
  assert.equal(wide.scale, 0.352);
});
