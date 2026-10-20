const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { React, renderStatic: rawRenderStatic } = require("../helpers/harness/reactSsr");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const i18next = require("i18next");
const { I18nextProvider } = require("react-i18next");
const i18n = i18next.createInstance();
i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  initAsync: false,
});
const renderStatic = (Component, props) =>
  rawRenderStatic(I18nextProvider, { i18n }, React.createElement(Component, props));

const repoRoot = path.join(__dirname, "../..");
const load = () => import("../../src/components/table/TableCanvas.tsx");
const card = (key, kind, x, y, extra = {}) => {
  const [type, id] = key.split(":");
  return {
    key,
    placed: true,
    z: 0,
    rect: { x, y, w: 280, h: 150 },
    entity: {
      ref: { type, id: Number(id) },
      kind,
      title: `T${id}`,
      excerpt: "body text",
      at: "2026-10-14 10:00:00",
      durationMs: 9000,
      participants: ["Maya Chen"],
      hrefs: [],
      noteId: null,
      layout: null,
      ...extra,
    },
  };
};
const noop = () => {};
const props = (over = {}) => ({
  cards: [
    card("note:1", "note", 32, 32),
    card("chat:2", "chat", 400, 32),
    card("note:3", "meeting", 9000, 9000),
  ],
  edges: [{ a: "chat:2", b: "note:1" }],
  viewport: { x: 0, y: 0, scale: 1 },
  selection: ["chat:2"],
  focused: null,
  expanded: null,
  label: "Canvas: Work",
  onViewport: noop,
  onMove: noop,
  onDrop: noop,
  onClickCard: noop,
  onSelect: noop,
  onFocus: noop,
  onOpen: noop,
  onRemove: noop,
  onNudge: noop,
  onMeasure: noop,
  ...over,
});

test("the canvas is a labelled multiselect listbox with a transformed world", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props({ viewport: { x: 12, y: -8, scale: 0.5 } }));
  assert.match(
    html,
    /role="listbox"[^>]*aria-multiselectable="true"[^>]*aria-roledescription="table\.canvasRole"[^>]*aria-label="Canvas: Work"/
  );
  assert.match(
    html,
    /class="table-world"[^>]*style="transform:translate3d\(12px, -8px, 0\) scale\(0\.5\)"/
  );
});

test("cards are options with selection state, kind and a single tab stop", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props());
  assert.match(
    html,
    /role="option"[^>]*aria-selected="false"[^>]*tabindex="0"[^>]*data-card-key="note:1"[^>]*data-kind="note"/
  );
  assert.match(
    html,
    /role="option"[^>]*aria-selected="true"[^>]*tabindex="-1"[^>]*data-card-key="chat:2"[^>]*data-kind="chat"/
  );
  assert.equal((html.match(/tabindex="0"/g) || []).length, 2, "one card plus the canvas itself");
});

test("cards far outside 1.5x the viewport are not rendered unless focused", async () => {
  const { TableCanvas } = await load();
  assert.doesNotMatch(renderStatic(TableCanvas, props()), /data-card-key="note:3"/);
  assert.match(renderStatic(TableCanvas, props({ focused: "note:3" })), /data-card-key="note:3"/);
});

test("when the first card is off screen, the tab stop moves to a rendered card", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(
    TableCanvas,
    props({
      cards: [card("note:9", "note", 9000, 9000), card("note:1", "note", 32, 32)],
      selection: [],
    })
  );
  assert.match(html, /tabindex="0"[^>]*data-card-key="note:1"/);
});

test("connectors are drawn between rendered cards only", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(
    TableCanvas,
    props({
      edges: [
        { a: "chat:2", b: "note:1" },
        { a: "note:1", b: "note:3" },
      ],
    })
  );
  // Card icons are Lucide SVGs with their own <path>s, so count inside the connector layer only.
  const svg = html.match(/<svg class="table-connectors"[\s\S]*?<\/svg>/)[0];
  assert.equal((svg.match(/<path /g) || []).length, 1);
  assert.match(html, /class="table-connectors"[^>]*aria-hidden="true"/);
});

test("meeting cards show initials, durations and the kind label", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props({ cards: [card("note:4", "meeting", 0, 0)] }));
  assert.match(html, /table\.kind\.meeting/);
  assert.match(html, />MC</);
  assert.match(html, />00:09</);
});

test("CSS: physical world, reduced motion drops the spring, tokens meet 3:1", async () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.match(css, /\.table-world\s*\{[^}]*left:\s*0;[^}]*transform-origin:\s*0 0;/);
  assert.match(
    css,
    /\.table-card\[data-snapping="true"\]\s*\{[^}]*var\(--motion-slow\) var\(--motion-spring-snap\)/
  );
  assert.doesNotMatch(
    css.slice(css.indexOf("/* The Table (WS-M5")),
    /\b\d+ms\b/,
    "Table motion uses shared duration tokens only"
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.table-card\[data-snapping="true"\]\s*\{\s*transition:\s*none;/
  );
  assert.match(
    css,
    /\.table-card\[data-kind="chat"\]\s*\{[^}]*border-inline-start:[^}]*var\(--color-agent-brand\)/
  );
  assert.match(css, /\.table-card\s*\{[^}]*border:\s*1px solid var\(--color-table-card-border\)/);
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(css);
  for (const [theme, t] of [
    ["light", light],
    ["dark", dark],
  ]) {
    for (const fg of ["--color-table-connector", "--color-agent-brand"]) {
      assert.ok(contrastRatio(t[fg], t["--color-background"]) >= 3, `${theme} ${fg}`);
    }
    for (const bg of ["--color-background", "--color-card"]) {
      for (const fg of ["--color-table-card-border", "--color-agent-brand", "--color-ring"]) {
        assert.ok(contrastRatio(t[fg], t[bg]) >= 3, `${theme} ${fg} on ${bg}`);
      }
    }
    for (const [fg, bg] of [
      ["--color-card-foreground", "--color-card"],
      ["--color-muted-foreground", "--color-card"],
      ["--color-muted-foreground", "--color-muted"],
    ]) {
      assert.ok(contrastRatio(t[fg], t[bg]) >= 4.5, `${theme} text ${fg} on ${bg}`);
    }
  }
});

const { createRoot } = require("react-dom/client");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { installTree } = require("../helpers/harness/fakeDomTree");

// Mount the real DOM components. Only layout, event dispatch and browser scheduling
// are faked; React reconciles actual nodes and focus updates globalThis.document.activeElement.
async function mount(t, overrides = {}) {
  t.after(() => unmount());
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const captures = new Set();
  const releases = [];
  const listeners = new Map();
  const all = (node) => [node, ...node.childNodes.flatMap(all)];
  const matches = (node, selector) =>
    selector === "[data-resize-handle]"
      ? node.attributes["data-resize-handle"] != null
      : selector === "[data-card-key]"
        ? node.attributes["data-card-key"] != null
        : node.attributes["data-card-key"] === selector.match(/data-card-key="([^"]+)"/)?.[1];
  const enhance = (node) => {
    node.contains = (other) => all(node).includes(other);
    node.focus = () => {
      globalThis.document.activeElement = node;
    };
    node.closest = (selector) =>
      matches(node, selector) ? node : (node.parentNode?.closest(selector) ?? null);
    node.querySelector = (selector) => all(node).find((n) => matches(n, selector)) ?? null;
    Object.defineProperty(node, "dataset", {
      get: () => ({ cardKey: node.attributes["data-card-key"] }),
    });
    node.clientWidth = 1200;
    node.clientHeight = 800;
    node.offsetHeight = 150;
    node.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1200, height: 800 });
    node.setPointerCapture = (id) => captures.add(id);
    node.hasPointerCapture = (id) => captures.has(id);
    node.releasePointerCapture = (id) => {
      captures.delete(id);
      releases.push(id);
    };
    node.addEventListener = (type, fn) => listeners.set(`${type}`, fn);
    node.removeEventListener = (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    };
    return node;
  };
  const create = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => enhance(create(tag));
  const createNS = globalThis.document.createElementNS;
  globalThis.document.createElementNS = (ns, tag) => enhance(createNS(ns, tag));
  enhance(tree.container);
  let seq = 0;
  const frames = new Map();
  const cancelled = [];
  globalThis.requestAnimationFrame = (fn) => {
    const id = ++seq;
    frames.set(id, fn);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
    frames.delete(id);
  };
  const observers = [];
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(node) {
      this.node = node;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  t.after(() => {
    globalThis.ResizeObserver = previousObserver;
  });
  const windowListeners = new Map();
  globalThis.window.addEventListener = (name, fn) => windowListeners.set(name, fn);
  globalThis.window.removeEventListener = (name, fn) => {
    if (windowListeners.get(name) === fn) windowListeners.delete(name);
  };
  globalThis.window.getComputedStyle = () => ({ getPropertyValue: () => "725ms" });
  globalThis.window.matchMedia = () => ({ matches: false });
  const { TableCanvas, TABLE_REF_MIME } = await load();
  const calls = [];
  let current = props(
    Object.fromEntries(
      [
        "onViewport",
        "onMove",
        "onDrop",
        "onClickCard",
        "onSelect",
        "onFocus",
        "onOpen",
        "onRemove",
        "onNudge",
        "onMeasure",
        "onResize",
        "onResizeCard",
        "onResizeCancel",
        "onDropRef",
      ].map((name) => [
        name,
        (...args) => {
          calls.push([name, ...args]);
          if (name === "onFocus") current = { ...current, focused: args[0] };
          else if (name === "onViewport") current = { ...current, viewport: args[0] };
          else if (name === "onSelect") current = { ...current, selection: args[0] };
          else return;
          root.render(
            React.createElement(
              I18nextProvider,
              { i18n },
              React.createElement(TableCanvas, current)
            )
          );
        },
      ])
    )
  );
  current = { ...current, ...overrides };
  const root = createRoot(tree.container);
  let unmounted = false;
  const unmount = async () => {
    if (!unmounted) {
      unmounted = true;
      await React.act(async () => root.unmount());
    }
  };
  const render = async (over = {}) => {
    current = { ...current, ...over };
    await React.act(async () =>
      root.render(
        React.createElement(I18nextProvider, { i18n }, React.createElement(TableCanvas, current))
      )
    );
  };
  await render();
  const canvas = () => tree.find((n) => n.attributes.role === "listbox");
  const cardEl = (key) => tree.find((n) => n.attributes["data-card-key"] === key);
  const event = async (name, target = canvas(), over = {}) => {
    await React.act(async () =>
      tree.props(canvas())[name]({
        target,
        currentTarget: canvas(),
        button: 0,
        pointerId: 1,
        clientX: 10,
        clientY: 20,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault() {},
        ...over,
      })
    );
  };
  const flush = async () => {
    const pending = [...frames.values()];
    frames.clear();
    await React.act(async () => pending.forEach((fn) => fn()));
  };
  const byCall = (name) => calls.filter((call) => call[0] === name).map((call) => call.slice(1));
  return {
    tree,
    calls,
    byCall,
    current: () => current,
    render,
    canvas,
    cardEl,
    event,
    flush,
    frames,
    cancelled,
    captures,
    releases,
    listeners,
    windowListeners,
    observers,
    unmount,
    TABLE_REF_MIME,
  };
}

for (const kind of ["drag", "pan", "lasso"]) {
  test(`mounted ${kind}: final up settles before the queued move frame and leaves no late writes`, async (t) => {
    const m = await mount(t);
    const target = kind === "drag" ? m.cardEl("note:1") : m.canvas();
    const shiftKey = kind === "lasso";
    await m.event("onPointerDown", target, { shiftKey });
    await m.event("onPointerMove", target, { clientX: 30, clientY: 40, shiftKey });
    assert.equal(m.frames.size, 1);
    await m.event("onPointerUp", target, { clientX: 350, clientY: 250, shiftKey });
    assert.equal(m.frames.size, 0);
    assert.deepEqual([...m.captures], []);
    if (kind === "drag") {
      assert.deepEqual(m.byCall("onMove").at(-1), [{ "note:1": { x: 372, y: 262 } }]);
      assert.deepEqual(m.byCall("onDrop"), [[{ "note:1": { x: 376, y: 264 } }]]);
    } else if (kind === "pan") {
      assert.deepEqual(m.byCall("onViewport"), [
        [{ x: 340, y: 230, scale: 1 }, false],
        [{ x: 340, y: 230, scale: 1 }, true],
      ]);
    } else assert.deepEqual(m.byCall("onSelect").at(-1), [["note:1"]]);
    const count = m.calls.length;
    await m.flush();
    assert.equal(m.calls.length, count);
  });
}

for (const kind of ["drag", "pan", "lasso"]) {
  test(`mounted ${kind}: final point replaces an earlier processed move`, async (t) => {
    const m = await mount(t);
    const target = kind === "drag" ? m.cardEl("note:1") : m.canvas();
    await m.event("onPointerDown", target, { shiftKey: kind === "lasso" });
    await m.event("onPointerMove", target, { clientX: 510, clientY: 220 });
    await m.flush();
    await m.event("onPointerMove", target, { clientX: 610, clientY: 320 });
    await m.event("onPointerUp", target, { clientX: 350, clientY: 250 });
    if (kind === "drag")
      assert.deepEqual(m.byCall("onDrop").at(-1), [{ "note:1": { x: 376, y: 264 } }]);
    if (kind === "pan")
      assert.deepEqual(m.byCall("onViewport"), [
        [{ x: 500, y: 200, scale: 1 }, false],
        [{ x: 340, y: 230, scale: 1 }, false],
        [{ x: 340, y: 230, scale: 1 }, true],
      ]);
    if (kind === "lasso") {
      assert.deepEqual(m.byCall("onSelect")[0], [["note:1", "chat:2"]]);
      assert.deepEqual(m.byCall("onSelect").at(-1), [["note:1"]]);
    }
    const count = m.calls.length;
    await m.flush();
    assert.equal(m.calls.length, count);
  });
}

for (const kind of ["drag", "pan", "lasso"]) {
  test(`mounted ${kind}: cancellation restores the origin/selection and cannot commit`, async (t) => {
    const m = await mount(t);
    const target = kind === "drag" ? m.cardEl("note:1") : m.canvas();
    await m.event("onPointerDown", target, { shiftKey: kind === "lasso" });
    await m.event("onPointerMove", target, { clientX: 510, clientY: 220 });
    await m.flush();
    await m.event("onPointerMove", target, { clientX: 610, clientY: 320 });
    await m.event("onPointerCancel", target);
    await m.event("onPointerUp", target, { clientX: 700 });
    await m.flush();
    assert.deepEqual(m.byCall("onDrop"), []);
    assert.equal(
      m.byCall("onViewport").some((call) => call[1] === true),
      false
    );
    if (kind === "drag")
      assert.deepEqual(m.byCall("onMove").at(-1), [{ "note:1": { x: 32, y: 32 } }]);
    if (kind === "pan")
      assert.deepEqual(m.byCall("onViewport").at(-1), [{ x: 0, y: 0, scale: 1 }, false]);
    if (kind === "lasso") assert.deepEqual(m.byCall("onSelect").at(-1), [["chat:2"]]);
    assert.equal(m.frames.size, 0);
    assert.equal(m.captures.size, 0);
  });
}

test("second pointer cannot hijack, cancel or release the owning pointer", async (t) => {
  const m = await mount(t);
  await m.event("onPointerDown", m.cardEl("note:1"));
  await m.event("onPointerDown", m.cardEl("chat:2"), { pointerId: 2 });
  await m.event("onPointerMove", m.canvas(), { pointerId: 2, clientX: 900 });
  await m.event("onPointerCancel", m.canvas(), { pointerId: 2 });
  await m.event("onPointerUp", m.canvas(), { pointerId: 2, clientX: 900 });
  assert.equal(m.calls.length, 0);
  assert.deepEqual([...m.captures], [1]);
  await m.event("onPointerUp", m.canvas(), { clientX: 90 });
  assert.deepEqual(m.byCall("onDrop"), [[{ "note:1": { x: 112, y: 32 } }]]);
});

test("unmount cancels RAF, releases pointer capture and disconnects observers without late writes", async (t) => {
  const m = await mount(t);
  await m.event("onKeyDown", m.canvas(), { key: " " });
  await m.event("onPointerDown", m.cardEl("note:1"));
  await m.event("onPointerMove", m.canvas(), { clientX: 90 });
  const count = m.calls.length;
  await m.unmount();
  assert.equal(m.frames.size, 0);
  assert.equal(m.captures.size, 0);
  assert.ok(m.observers.every((o) => o.disconnected));
  await m.flush();
  assert.equal(m.calls.length, count);
});

test("keyboard entry uses real visible geometry before retained offscreen focus", async (t) => {
  const m = await mount(t, { focused: "note:3" });
  assert.ok(m.cardEl("note:3"), "focused offscreen card is retained");
  m.canvas().focus();
  await m.event("onKeyDown", m.canvas(), { key: "ArrowDown" });
  assert.ok(
    globalThis.document.activeElement === m.cardEl("note:1"),
    "actual DOM focus reaches the expected element"
  );
  assert.deepEqual(m.byCall("onFocus"), [["note:1"]]);
});

test("empty viewport entry reveals and focuses retained SAME logical key", async (t) => {
  const m = await mount(t, { cards: [card("note:3", "note", 9000, 9000)], focused: "note:3" });
  m.canvas().focus();
  await m.event("onKeyDown", m.canvas(), { key: "ArrowRight" });
  assert.deepEqual(m.byCall("onFocus"), [["note:3"]]);
  assert.deepEqual(m.byCall("onViewport"), [[{ x: -8104, y: -8374, scale: 1 }, true]]);
  assert.ok(
    globalThis.document.activeElement === m.cardEl("note:3"),
    "actual DOM focus reaches the expected element"
  );
});

test("empty viewport without retained cards uses deterministic board fallback and mounts its focus target", async (t) => {
  const m = await mount(t, {
    cards: [card("note:8", "note", 9000, 9000), card("note:9", "note", 10000, 10000)],
    focused: null,
    selection: [],
  });
  assert.equal(m.cardEl("note:8"), null);
  m.canvas().focus();
  await m.event("onKeyDown", m.canvas(), { key: "ArrowLeft" });
  assert.deepEqual(m.byCall("onFocus"), [["note:8"]]);
  assert.equal(m.byCall("onViewport").length, 1);
  assert.ok(
    globalThis.document.activeElement === m.cardEl("note:8"),
    "actual DOM focus reaches the expected element"
  );
});

test("spatial arrows explicitly reveal and focus, while reload/zoom/pan never steals Ask focus", async (t) => {
  const m = await mount(t, { focused: "note:1" });
  m.cardEl("note:1").focus();
  await m.event("onKeyDown", m.cardEl("note:1"), { key: "ArrowRight" });
  assert.ok(
    globalThis.document.activeElement === m.cardEl("chat:2"),
    "actual DOM focus reaches the expected element"
  );
  assert.deepEqual(m.byCall("onFocus"), [["chat:2"]]);
  const ask = globalThis.document.createElement("textarea");
  ask.focus();
  await m.render({
    cards: [...m.current().cards],
    focused: "note:3",
    viewport: { x: 100, y: 100, scale: 0.5 },
  });
  assert.ok(
    globalThis.document.activeElement === ask,
    "actual DOM focus reaches the expected element"
  );
});

function controlSnapTimers(t) {
  const pending = new Map();
  const cleared = [];
  let id = 0;
  t.mock.method(globalThis, "setTimeout", (fn, delay) => {
    const key = ++id;
    pending.set(key, { fn, delay });
    return key;
  });
  t.mock.method(globalThis, "clearTimeout", (key) => {
    cleared.push(key);
    pending.delete(key);
  });
  return { pending, cleared };
}

async function dropCard(m, key = "note:1") {
  await m.event("onPointerDown", m.cardEl(key));
  await m.event("onPointerUp", m.cardEl(key), { clientX: 90, clientY: 60 });
}

test("snap cleanup reads the shared token, and a stale completion cannot clear a newer snap", async (t) => {
  const m = await mount(t);
  const clock = controlSnapTimers(t);
  globalThis.window.getComputedStyle = () => ({
    getPropertyValue: (name) => {
      assert.equal(name, "--motion-slow");
      return "0.725s";
    },
  });
  await dropCard(m);
  assert.equal(m.cardEl("note:1").attributes["data-snapping"], "true");
  const [oldId, old] = [...clock.pending][0];
  assert.equal(old.delay, 725, "lifecycle duration follows the CSS token rather than 360ms");
  await dropCard(m, "chat:2");
  assert.ok(clock.cleared.includes(oldId));
  assert.equal(clock.pending.size, 1);
  assert.equal(m.cardEl("note:1").attributes["data-snapping"], undefined);
  assert.equal(m.cardEl("chat:2").attributes["data-snapping"], "true");
  await React.act(async () => old.fn());
  assert.equal(
    m.cardEl("chat:2").attributes["data-snapping"],
    "true",
    "old owner cannot clear the newer snap"
  );
  const [nextId, next] = [...clock.pending][0];
  clock.pending.delete(nextId);
  await React.act(async () => next.fn());
  assert.equal(m.cardEl("chat:2").attributes["data-snapping"], undefined);
});

test("unmount clears the token-owned snap timeout, including a stale callback", async (t) => {
  const m = await mount(t);
  const clock = controlSnapTimers(t);
  await dropCard(m);
  const [id, timer] = [...clock.pending][0];
  await m.unmount();
  assert.ok(clock.cleared.includes(id));
  assert.equal(clock.pending.size, 0);
  await React.act(async () => timer.fn());
  assert.equal(m.tree.container.childNodes.length, 0);
});

test("reduced motion skips spring state and scheduling while committing the drop", async (t) => {
  const m = await mount(t);
  const clock = controlSnapTimers(t);
  globalThis.window.matchMedia = (query) => {
    assert.equal(query, "(prefers-reduced-motion: reduce)");
    return { matches: true };
  };
  await dropCard(m);
  assert.equal(m.byCall("onDrop").length, 1);
  assert.equal(m.cardEl("note:1").attributes["data-snapping"], undefined);
  assert.equal(clock.pending.size, 0);
});

test("lost capture rolls back, and leaving the canvas releases held Space for the next gesture", async (t) => {
  const m = await mount(t);
  await m.event("onKeyDown", m.canvas(), { key: " " });
  await m.event("onBlur", m.canvas(), {
    relatedTarget: globalThis.document.createElement("textarea"),
  });
  await m.event("onPointerDown", m.cardEl("note:1"));
  await m.event("onPointerMove", m.canvas(), { clientX: 100 });
  await m.flush();
  assert.equal(m.byCall("onMove").length, 1, "Space is no longer held: a card drag, not a pan");
  await m.event("onLostPointerCapture", m.canvas());
  assert.deepEqual(m.byCall("onMove").at(-1), [{ "note:1": { x: 32, y: 32 } }]);
  await m.event("onPointerUp", m.canvas(), { clientX: 100 });
  assert.equal(m.byCall("onDrop").length, 0);
});

test("ResizeObserver uses real mounted root/card dimensions and disconnects on unmount", async (t) => {
  const m = await mount(t);
  const canvasObserver = m.observers.find((o) => o.node === m.canvas());
  const cardObserver = m.observers.find((o) => o.node === m.cardEl("note:1"));
  m.canvas().clientWidth = 500;
  m.canvas().clientHeight = 300;
  m.cardEl("note:1").offsetHeight = 212;
  await React.act(async () => {
    canvasObserver.callback();
    cardObserver.callback();
  });
  assert.deepEqual(m.byCall("onResize"), [[{ width: 500, height: 300 }]]);
  assert.deepEqual(m.byCall("onMeasure"), [["note:1", 212]]);
  await m.unmount();
  assert.ok(m.observers.every((o) => o.disconnected));
});

test("wheel/drop coordinates and keyboard actions cross the real DOM adapter", async (t) => {
  const m = await mount(t, {
    viewport: { x: 50, y: 20, scale: 0.5 },
    selection: ["note:1", "chat:2"],
  });
  let prevented = false;
  await React.act(async () =>
    m.listeners.get("wheel")({
      deltaX: 5,
      deltaY: -10,
      ctrlKey: false,
      metaKey: false,
      clientX: 110,
      clientY: 120,
      preventDefault() {
        prevented = true;
      },
    })
  );
  assert.ok(prevented);
  assert.deepEqual(m.byCall("onViewport").at(-1), [{ x: 45, y: 30, scale: 0.5 }, true]);
  const transfer = {
    types: [m.TABLE_REF_MIME],
    getData: (type) => (type === m.TABLE_REF_MIME ? "dictation:7" : ""),
  };
  await m.event("onDrop", m.canvas(), { clientX: 110, clientY: 120, dataTransfer: transfer });
  assert.deepEqual(m.byCall("onDropRef"), [["dictation:7", { x: 110, y: 140 }]]);
  await m.event("onKeyDown", m.cardEl("note:1"), { key: "ArrowRight", shiftKey: true });
  await m.event("onKeyDown", m.cardEl("note:1"), { key: "Enter" });
  await m.event("onKeyDown", m.cardEl("note:1"), { key: "Delete" });
  assert.deepEqual(m.byCall("onNudge"), [[["note:1", "chat:2"], 8, 0]]);
  assert.deepEqual(m.byCall("onOpen"), [["note:1"]]);
  assert.deepEqual(m.byCall("onRemove"), [[["note:1", "chat:2"]]]);
});

test("selected offscreen cards stay mounted and dangling connectors are excluded", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(
    TableCanvas,
    props({ selection: ["note:3", "note:404"], edges: [{ a: "note:404", b: "note:1" }] })
  );
  assert.match(html, /data-card-key="note:3"/);
  const svg = html.match(/<svg class="table-connectors"[\s\S]*?<\/svg>/)[0];
  assert.doesNotMatch(svg, /<path /);
});

test("Table CSS parses, uses the readable type ramp and keeps chrome logical", () => {
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  const postcss = require("postcss");
  const parsed = postcss.parse(css);
  assert.ok(parsed.nodes.length > 0);
  const table = css.slice(css.indexOf("/* The Table (WS-M5"));
  assert.match(table, /\.table-card__kind\s*\{[^}]*font-size:\s*var\(--text-caption\)/);
  assert.match(table, /\.table-card__meta\s*\{[^}]*font-size:\s*var\(--text-caption\)/);
  assert.match(table, /\.table-card__avatar\s*\{[^}]*font-size:\s*var\(--text-micro\)/);
  assert.doesNotMatch(table, /font-size:\s*\d+(?:\.\d+)?px/);
  assert.match(table, /margin-inline-end:\s*-4px/);
  assert.match(table, /\.table-lasso\s*\{[^}]*position:\s*absolute/);
});

test("a removed logical focus never removes the remaining rendered card tab stop", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(TableCanvas, props({ focused: "note:404" }));
  assert.match(html, /tabindex="0"[^>]*data-card-key="note:1"/);
});

test("resize handle and exact clipping preserve the unmasked focus ring and physical corner", async () => {
  const { TableCanvas } = await load();
  const html = renderStatic(
    TableCanvas,
    props({ cards: [{ ...card("note:1", "note", 32, 32), fixedH: 80 }] })
  );
  assert.match(html, /data-resize-handle=""[^>]*aria-hidden="true"/);
  assert.match(html, /data-sized="true"[^>]*style="[^"]*height:80px;overflow:hidden/);
  const natural = renderStatic(TableCanvas, props());
  assert.doesNotMatch(natural, /data-sized|overflow:hidden/);
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.match(css, /\.table-card__resize\s*\{[^}]*right:\s*2px;[^}]*bottom:\s*2px;/);
  assert.doesNotMatch(css, /\.table-card\[data-sized="true"\]\s*\{[^}]*mask-image/);
  assert.match(css, /\.table-card:focus-visible \.table-card__resize/);
});
const handleFor = (m, key = "note:1") =>
  m.cardEl(key)?.childNodes.find((n) => n.attributes["data-resize-handle"] != null);
for (const earlier of [false, true])
  test(`mounted resize settles final up with earlier frame=${earlier}, one snapped commit, no late write`, async (t) => {
    const m = await mount(t, { viewport: { x: 0, y: 0, scale: 2 } });
    const target = handleFor(m);
    assert.ok(target);
    await m.event("onPointerDown", target);
    await m.event("onPointerMove", target, { clientX: 30, clientY: 40 });
    if (earlier) await m.flush();
    await m.event("onPointerMove", target, { clientX: 50, clientY: 60 });
    await m.event("onPointerUp", target, { clientX: 51, clientY: -380 });
    assert.deepEqual(m.byCall("onResizeCard").at(-2), ["note:1", { w: 300.5, h: 80 }, false]);
    assert.deepEqual(m.byCall("onResizeCard").at(-1), ["note:1", { w: 304, h: 80 }, true]);
    assert.equal(m.byCall("onResizeCard").filter((c) => c[2]).length, 1);
    assert.deepEqual(m.byCall("onDrop"), []);
    assert.equal(m.frames.size, 0);
    const count = m.calls.length;
    await m.flush();
    assert.equal(m.calls.length, count);
  });
for (const ending of [
  "onPointerCancel",
  "onLostPointerCapture",
  "blur",
  "Escape",
  "unmount",
  "scope",
])
  test(`mounted resize ${ending} rolls back exact sizing without committing or late writes`, async (t) => {
    const original = { persisted: { w: null, h: null }, override: { w: 304, h: 200 } };
    const c = { ...card("note:1", "note", 32, 32), sizeOverride: original.override };
    const m = await mount(t, { cards: [c], gestureScope: 1 });
    const target = handleFor(m);
    assert.ok(target);
    await m.event("onPointerDown", target);
    await m.event("onPointerMove", target, { clientX: 90, clientY: 80 });
    await m.flush();
    await m.event("onPointerMove", target, { clientX: 190, clientY: 180 });
    if (ending === "unmount") await m.unmount();
    else if (ending === "scope") await m.render({ gestureScope: 2 });
    else if (ending === "blur") await m.event("onBlur", target, { relatedTarget: null });
    else if (ending === "Escape") await m.event("onKeyDown", target, { key: "Escape" });
    else await m.event(ending, target);
    assert.deepEqual(m.byCall("onResizeCancel"), ending === "scope" ? [] : [["note:1", original]]);
    assert.equal(m.byCall("onResizeCard").filter((c) => c[2]).length, 0);
    assert.equal(m.frames.size, 0);
    assert.equal(m.captures.size, 0);
    const count = m.calls.length;
    await m.flush();
    assert.equal(m.calls.length, count);
  });
test("resize owning pointer cannot be hijacked; Alt arrows snap and clamp only the focused card", async (t) => {
  const m = await mount(t);
  const target = handleFor(m);
  assert.ok(target);
  await m.event("onPointerDown", target);
  await m.event("onPointerDown", m.cardEl("chat:2"), { pointerId: 2 });
  await m.event("onPointerMove", target, { pointerId: 2, clientX: 900 });
  await m.event("onPointerUp", target, { pointerId: 2, clientX: 900 });
  await m.event("onPointerCancel", target, { pointerId: 2 });
  assert.deepEqual(m.byCall("onResizeCard"), []);
  await m.event("onPointerUp", target, { clientX: 51, clientY: 61 });
  assert.deepEqual(m.byCall("onResizeCard").at(-1), ["note:1", { w: 320, h: 192 }, true]);
  await m.event("onKeyDown", m.cardEl("note:1"), { key: "ArrowUp", altKey: true });
  assert.deepEqual(m.byCall("onResizeCard").at(-1), ["note:1", { w: 280, h: 144 }, true]);
  await m.render({
    cards: [
      { ...card("note:1", "note", 32, 32), rect: { x: 32, y: 32, w: 640, h: 80 }, fixedH: 80 },
    ],
  });
  for (const key of ["ArrowRight", "ArrowUp"]) {
    await m.event("onKeyDown", m.cardEl("note:1"), { key, altKey: true });
    assert.deepEqual(m.byCall("onResizeCard").at(-1), ["note:1", { w: 640, h: 80 }, true]);
  }
});

test("resize window blur rolls back and removes the listener on unmount", async (t) => {
  const m = await mount(t);
  const handle = handleFor(m);
  await m.event("onPointerDown", handle);
  await m.event("onPointerMove", handle, { clientX: 100 });
  await m.flush();
  const blur = m.windowListeners.get("blur");
  assert.equal(typeof blur, "function");
  await React.act(async () => blur());
  assert.deepEqual(m.byCall("onResizeCancel"), [
    ["note:1", { persisted: { w: null, h: null }, override: null }],
  ]);
  assert.equal(m.captures.size, 0);
  await m.unmount();
  assert.equal(m.windowListeners.has("blur"), false);
});
test("resize scope change removes transient drag styling and cancelled RAF cannot write into a new gesture", async (t) => {
  const m = await mount(t, { gestureScope: 1 });
  const handle = handleFor(m);
  await m.event("onPointerDown", handle);
  await m.event("onPointerMove", handle, { clientX: 100 });
  await m.flush();
  assert.equal(m.cardEl("note:1").attributes["data-dragging"], "true");
  await m.event("onPointerMove", handle, { clientX: 200 });
  const stale = [...m.frames.values()][0];
  await m.render({ gestureScope: 2 });
  assert.equal(m.cardEl("note:1").attributes["data-dragging"], undefined);
  await m.event("onPointerDown", handle);
  await m.event("onPointerMove", handle, { clientX: 110 });
  const count = m.calls.length;
  await React.act(async () => stale());
  assert.equal(m.calls.length, count);
  await m.event("onPointerCancel", handle);
});
test("resize press under threshold neither clips nor writes dimensions", async (t) => {
  const m = await mount(t);
  const handle = handleFor(m);
  await m.event("onPointerDown", handle);
  await m.event("onPointerMove", handle, { clientX: 12, clientY: 21 });
  await m.event("onPointerUp", handle, { clientX: 12, clientY: 21 });
  assert.deepEqual(m.byCall("onResizeCard"), []);
  assert.deepEqual(m.byCall("onResizeCancel"), []);
  assert.equal(m.frames.size, 0);
});

test("resize target leaving canonical projection retires its gesture without resurrecting an override", async (t) => {
  const m = await mount(t);
  const handle = handleFor(m);
  await m.event("onPointerDown", handle);
  await m.event("onPointerMove", handle, { clientX: 100 });
  await m.flush();
  await m.event("onPointerMove", handle, { clientX: 200 });
  await m.render({ cards: [] });
  assert.equal(m.frames.size, 0);
  assert.equal(m.captures.size, 0);
  const before = m.calls.length;
  await m.event("onPointerUp", m.canvas(), { clientX: 300 });
  await m.flush();
  assert.equal(m.calls.length, before);
  assert.deepEqual(m.byCall("onResizeCancel"), []);
});
