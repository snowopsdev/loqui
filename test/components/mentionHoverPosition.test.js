const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const load = () => import("../../src/components/ui/useMentionHoverPosition.ts");

test("placement flips and clamps both inline directions, including oversized content", async () => {
  const { mentionHoverPosition: place } = await load();
  const bounds = { left: 249, right: 1263, top: 218, bottom: 783 };
  const trigger = { left: 1140, right: 1240, top: 720, bottom: 742 };
  assert.deepEqual(place(trigger, { width: 240, height: 137 }, bounds, false), {
    left: 1023,
    top: 583,
    above: true,
  });
  assert.equal(
    place({ ...trigger, left: 250, right: 350 }, { width: 240, height: 137 }, bounds, true).left,
    249
  );
  assert.equal(place(trigger, { width: 240, height: 1000 }, bounds, false).top, 218);
  assert.equal(
    place({ ...trigger, top: 250, bottom: 272 }, { width: 240, height: 137 }, bounds, false).top,
    272
  );
});

test("production positioning hook follows scroll/resize/content/direction and releases each local resource", async (t) => {
  const { useMentionHoverPosition } = await load();
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const listeners = new Map();
  const observers = [];
  const originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.elements = [];
      observers.push(this);
    }
    observe(el) {
      this.elements.push(el);
    }
    disconnect() {
      this.elements = [];
    }
  };
  t.after(() => {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  });
  let rect = { left: 1140, right: 1240, top: 720, bottom: 742 };
  let height = 137;
  let rtl = false;
  const clip = {
    parentElement: null,
    clientLeft: 1,
    clientTop: 1,
    clientWidth: 1030,
    clientHeight: 580,
    getBoundingClientRect: () => ({ left: 240, top: 210 }),
  };
  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: (el) =>
      el === clip ? { overflowX: "auto", overflowY: "auto" } : { direction: rtl ? "rtl" : "ltr" },
    addEventListener: (name, fn, capture) => listeners.set(name, { fn, capture }),
    removeEventListener: (name, fn, capture) => {
      assert.deepEqual(listeners.get(name), { fn, capture });
      listeners.delete(name);
    },
  };
  const trigger = {
    parentElement: clip,
    ownerDocument: { defaultView: win },
    getBoundingClientRect: () => rect,
  };
  const card = { style: {}, getBoundingClientRect: () => ({ width: 240, height }) };
  const triggerRef = { current: trigger },
    cardRef = { current: card };
  root = createRoot(globalThis.document.documentElement);
  function Probe({ open, direction }) {
    useMentionHoverPosition(triggerRef, cardRef, open, direction);
    return null;
  }
  const render = (open, direction = "en") =>
    React.act(async () => root.render(React.createElement(Probe, { open, direction })));
  await render(true);
  assert.equal(card.style.top, "583px");
  assert.equal(card.style.left, "1023px");
  assert.equal(card.style.paddingBottom, "4px");
  assert.equal(listeners.size, 2);
  assert.deepEqual(observers[0].elements, [trigger, card, clip]);
  rect = { ...rect, top: 400, bottom: 422 };
  listeners.get("scroll").fn();
  assert.equal(card.style.top, "422px");
  height = 400;
  observers[0].callback();
  assert.equal(card.style.top, "219px", "content reflow clamps above");
  win.innerWidth = 1000;
  listeners.get("resize").fn();
  assert.equal(card.style.left, "752px");
  assert.equal(card.style.visibility, "hidden", "offscreen trigger hides its detached card");
  rtl = true;
  rect = { left: 250, right: 350, top: 400, bottom: 422 };
  await render(true, "ar");
  assert.equal(card.style.left, "249px");
  assert.equal(card.style.visibility, "visible");
  assert.deepEqual(observers[0].elements, []);
  await render(false, "ar");
  assert.equal(listeners.size, 0);
  assert.deepEqual(observers[1].elements, []);
  await render(true, "ar");
  assert.equal(listeners.size, 2);
  await render(false, "ar");
  assert.equal(listeners.size, 0);
  assert.deepEqual(observers[2].elements, []);
  await render(true, "ar");
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(listeners.size, 0, "unmount also releases listeners");
  assert.deepEqual(observers[3].elements, []);
});
