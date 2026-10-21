const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/table/tableGestures.ts");
const V = { x: 0, y: 0, scale: 2 };
const base = {
  shift: false,
  spaceHeld: false,
  viewport: V,
  selection: [],
  positions: { "note:1": { x: 10, y: 10 }, "note:2": { x: 100, y: 10 } },
};

test("pressing a card drags it; a selected card drags the whole selection", async () => {
  const { press } = await load();
  assert.deepEqual(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" }).keys, ["note:1"]);
  assert.deepEqual(
    press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1", selection: ["note:1", "note:2"] })
      .keys,
    ["note:1", "note:2"]
  );
});

test("background press pans, shift-press lassos, space-held pans even on a card", async () => {
  const { press } = await load();
  assert.equal(press({ ...base, point: { x: 0, y: 0 }, cardKey: null }).kind, "pan");
  assert.equal(press({ ...base, point: { x: 0, y: 0 }, cardKey: null, shift: true }).kind, "lasso");
  assert.equal(
    press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1", spaceHeld: true }).kind,
    "pan"
  );
});

test("drags move in world units and only after the threshold; release snaps to the grid", async () => {
  const { press, move, release } = await load();
  let g = press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" });
  let r = move(g, { x: 2, y: 1 });
  assert.equal(r.effect, null, "under the 4px threshold nothing moves");
  r = move(r.gesture, { x: 21, y: 9 });
  assert.deepEqual(r.effect, { type: "positions", positions: { "note:1": { x: 20.5, y: 14.5 } } });
  assert.deepEqual(release(r.gesture, { x: 21, y: 9 }), {
    type: "drop",
    positions: { "note:1": { x: 24, y: 16 } },
  });
});

test("release recognizes a drag threshold crossing even when no move was processed", async () => {
  const { press, release } = await load();
  const gesture = press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" });
  assert.deepEqual(release(gesture, { x: 21, y: 9 }), {
    type: "drop",
    positions: { "note:1": { x: 24, y: 16 } },
  });
});

test("release uses its final point for a drag after earlier moves", async () => {
  const { press, move, release } = await load();
  const moved = move(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" }), {
    x: 10,
    y: 0,
  }).gesture;
  assert.deepEqual(release(moved, { x: 21, y: 9 }), {
    type: "drop",
    positions: { "note:1": { x: 24, y: 16 } },
  });
});

test("a press without movement is a click; shift makes it additive", async () => {
  const { press, release } = await load();
  assert.deepEqual(
    release(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:2", shift: true }), {
      x: 1,
      y: 1,
    }),
    { type: "click-card", key: "note:2", additive: true }
  );
  assert.deepEqual(
    release(press({ ...base, point: { x: 0, y: 0 }, cardKey: null }), { x: 0, y: 0 }),
    { type: "click-background" }
  );
});

test("panning moves the viewport in screen pixels and reports the end state", async () => {
  const { press, move, release } = await load();
  const g = press({ ...base, point: { x: 10, y: 10 }, cardKey: null });
  const r = move(g, { x: 40, y: -10 });
  assert.deepEqual(r.effect, { type: "viewport", viewport: { x: 30, y: -20, scale: 2 } });
  assert.deepEqual(release(r.gesture, { x: 40, y: -10 }), {
    type: "pan-end",
    viewport: { x: 30, y: -20, scale: 2 },
  });
});

test("release recognizes a pan threshold crossing even when no move was processed", async () => {
  const { press, release } = await load();
  const gesture = press({ ...base, point: { x: 10, y: 10 }, cardKey: null });
  assert.deepEqual(release(gesture, { x: 40, y: -10 }), {
    type: "pan-end",
    viewport: { x: 30, y: -20, scale: 2 },
  });
});

test("lasso reports a normalised screen rectangle", async () => {
  const { press, move, release } = await load();
  const g = press({ ...base, point: { x: 50, y: 50 }, cardKey: null, shift: true });
  const r = move(g, { x: 10, y: 80 });
  assert.deepEqual(r.effect, { type: "lasso", rect: { x: 10, y: 50, w: 40, h: 30 } });
  assert.deepEqual(release(r.gesture, { x: 10, y: 80 }), {
    type: "lasso-end",
    rect: { x: 10, y: 50, w: 40, h: 30 },
  });
});

test("lasso release uses its final point after a different last processed move", async () => {
  const { press, move, release } = await load();
  const moved = move(press({ ...base, point: { x: 50, y: 50 }, cardKey: null, shift: true }), {
    x: 20,
    y: 60,
  }).gesture;
  assert.deepEqual(release(moved, { x: 10, y: 80 }), {
    type: "lasso-end",
    rect: { x: 10, y: 50, w: 40, h: 30 },
  });
});

test("a cancelled pointer restores positions and viewport instead of committing", async () => {
  const { press, move, cancel, release } = await load();
  const drag = move(press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" }), {
    x: 40,
    y: 0,
  }).gesture;
  assert.deepEqual(cancel(drag), { type: "positions", positions: { "note:1": { x: 10, y: 10 } } });
  const pan = move(press({ ...base, point: { x: 0, y: 0 }, cardKey: null }), {
    x: 40,
    y: 0,
  }).gesture;
  assert.deepEqual(cancel(pan), { type: "viewport", viewport: V });
  const unmoved = press({ ...base, point: { x: 0, y: 0 }, cardKey: "note:1" });
  assert.equal(cancel(unmoved), null, "an unmoved press has nothing to undo");
  const cancellation = cancel(drag);
  assert.deepEqual(cancellation, { type: "positions", positions: { "note:1": { x: 10, y: 10 } } });
  assert.notEqual(
    cancellation?.type,
    release(drag, { x: 40, y: 0 })?.type,
    "cancellation exposes rollback, never a commit effect"
  );
});

test("the wheel pans; with Ctrl or ⌘ (and trackpad pinch) it zooms around the pointer", async () => {
  const { wheel } = await load();
  const v = { x: 0, y: 0, scale: 1 };
  assert.deepEqual(
    wheel(v, { deltaX: 5, deltaY: 20, ctrlKey: false, metaKey: false, point: { x: 0, y: 0 } }),
    { x: -5, y: -20, scale: 1 }
  );
  const z = wheel(v, {
    deltaX: 0,
    deltaY: -100,
    ctrlKey: true,
    metaKey: false,
    point: { x: 100, y: 100 },
  });
  assert.ok(z.scale > 1 && z.scale <= 2);
});

test("keyboard: arrows move focus, shift-arrows nudge 8px, and the rest map to actions", async () => {
  const { keyAction } = await load();
  const k = (key, mods = {}) =>
    keyAction(
      { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods },
      true
    );
  assert.deepEqual(k("ArrowLeft"), { type: "focusMove", dir: "left" });
  assert.deepEqual(k("ArrowDown", { shiftKey: true }), { type: "nudge", dx: 0, dy: 8 });
  assert.deepEqual(
    [k("Enter"), k(" "), k("Escape"), k("Delete"), k("Backspace")].map((a) => a.type),
    ["open", "toggleSelect", "clearSelection", "remove", "remove"]
  );
  assert.deepEqual(
    [k("+"), k("="), k("-"), k("0")].map((a) => a.type),
    ["zoomIn", "zoomIn", "zoomOut", "resetView"]
  );
  assert.equal(k("a", { metaKey: true }), null, "app shortcuts pass through");
  assert.equal(
    keyAction(
      { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false },
      false
    ),
    null,
    "Enter on the background does nothing"
  );
  assert.deepEqual(
    keyAction(
      { key: "ArrowRight", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false },
      false
    ),
    { type: "enterCards" }
  );
});

test("resize uses world units, threshold, clamps, final point and numeric preview rollback", async () => {
  const { press, move, release, cancel, clampSize } = await load();
  const g = press({
    ...base,
    point: { x: 0, y: 0 },
    cardKey: "note:1",
    resizeKey: "note:1",
    sizes: { "note:1": { w: 280, h: 150 } },
  });
  assert.equal(g.kind, "resize");
  assert.equal(move(g, { x: 2, y: 1 }).effect, null);
  assert.equal(release(g, { x: 2, y: 1 }), null);
  const r = move(g, { x: 41, y: -400 });
  assert.deepEqual(r.effect, { type: "size", key: "note:1", size: { w: 300.5, h: 80 } });
  assert.deepEqual(release(g, { x: 41, y: -400 }), {
    type: "resized",
    key: "note:1",
    size: { w: 304, h: 80 },
  });
  assert.deepEqual(release(r.gesture, { x: 72, y: 116 }), {
    type: "resized",
    key: "note:1",
    size: { w: 320, h: 208 },
  });
  assert.deepEqual(cancel(r.gesture), { type: "size", key: "note:1", size: { w: 280, h: 150 } });
  assert.deepEqual(clampSize({ w: 9999, h: -1 }), { w: 640, h: 80 });
  assert.deepEqual(move(g, { x: 9999, y: 9999 }).effect.size, { w: 640, h: 600 });
  assert.equal(
    press({
      ...base,
      point: { x: 0, y: 0 },
      cardKey: "note:1",
      resizeKey: "note:1",
      sizes: { "note:1": { w: 280, h: 150 } },
      spaceHeld: true,
    }).kind,
    "pan"
  );
});
test("Alt arrows resize only the focused card in physical grid steps", async () => {
  const { keyAction } = await load();
  for (const [key, dw, dh] of [
    ["ArrowRight", 8, 0],
    ["ArrowLeft", -8, 0],
    ["ArrowUp", 0, -8],
    ["ArrowDown", 0, 8],
  ]) {
    const e = { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: true };
    assert.deepEqual(keyAction(e, true), { type: "resize", dw, dh });
    assert.equal(keyAction(e, false), null);
    assert.equal(keyAction({ ...e, ctrlKey: true }, true), null);
  }
});
