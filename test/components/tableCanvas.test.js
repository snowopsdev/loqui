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
    node.getAttribute = (key) => node.attributes[key] ?? null;
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
      this.node ??= node;
      (this.nodes ??= []).push(node);
    }
    unobserve(node) {
      this.nodes = this.nodes.filter((target) => target !== node);
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

test("fix1 clipping cue: only the overflowing inner content is masked, outer card and handle stay opaque", async (t) => {
  const c = { ...card("note:1", "note", 32, 32), fixedH: 80 };
  const m = await mount(t, { cards: [c], selection: [c.key], focused: c.key });
  const outer = m.cardEl(c.key);
  const content = m.tree.find((n) => n.attributes.class === "table-card__content");
  assert.ok(content, "a separate inner clipping layer is required");
  content.clientHeight = 54;
  content.scrollHeight = 180;
  outer.offsetHeight = 80;
  const observer = m.observers.find((o) => o.node === outer);
  await React.act(async () => observer.callback());
  assert.equal(content.attributes["data-overflowing"], "true");
  assert.equal(content.parentNode, outer);
  assert.equal(handleFor(m).parentNode, outer, "handle is outside the masked content");
  assert.equal(outer.attributes["aria-selected"], "true");
  assert.equal(outer.attributes.tabindex, "0");
  assert.deepEqual(
    m.byCall("onMeasure").at(-1),
    [c.key, 80],
    "measure the outer card, not overflowing content"
  );
  assert.equal(m.tree.props(outer).style.height, 80);
  assert.equal(m.tree.props(outer).style.maskImage, undefined);
  const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");
  assert.match(
    css,
    /\.table-card\[data-sized="true"\] > \.table-card__content\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/
  );
  assert.match(
    css,
    /\.table-card__content\[data-overflowing="true"\]\s*\{[^}]*-webkit-mask-image:\s*linear-gradient\(to bottom, #000 calc\(100% - 20px\), transparent\);[^}]*mask-image:\s*linear-gradient\(to bottom, #000 calc\(100% - 20px\), transparent\);/
  );
  assert.doesNotMatch(css, /\.table-card(?:\[[^\]]*\])?\s*\{[^}]*mask-image/);
  assert.doesNotMatch(
    css,
    /\.table-card__resize\s*\{[^}]*mask|\.table-card__content[^}]*pointer-events:\s*none/
  );
  assert.equal(m.tree.props(outer).onPointerDown, undefined, "canvas still owns pointer events");
  await m.event("onPointerDown", handleFor(m));
  assert.equal(m.captures.size, 1, "unmasked handle still starts the owning pointer");
  await m.event("onPointerCancel", handleFor(m));
});

test("fix1 clipping cue: fitting/natural cards and resize/cancel/content reflow update without observer churn", async (t) => {
  const natural = { ...card("note:1", "note", 32, 32), fixedH: null };
  const m = await mount(t, { cards: [natural] });
  const outer = m.cardEl(natural.key);
  const content = m.tree.find((n) => n.attributes.class === "table-card__content");
  const body = m.tree.find((n) => n.attributes.class === "table-card__body");
  assert.ok(content);
  assert.ok(body);
  let available = 54,
    full = 180;
  Object.defineProperty(content, "clientHeight", { get: () => available });
  Object.defineProperty(content, "scrollHeight", { get: () => full });
  const observer = m.observers.find((o) => o.node === outer);
  assert.ok(
    observer.nodes.includes(body),
    "intrinsic content reflow is observed, even when the clip height stays fixed"
  );
  const initialObservers = m.observers.length;
  const measure = () => React.act(async () => observer.callback());
  await measure();
  assert.equal(
    content.attributes["data-overflowing"],
    undefined,
    "natural content has no false cue"
  );
  await m.render({ cards: [{ ...natural, fixedH: 80 }] });
  assert.equal(
    content.attributes["data-overflowing"],
    "true",
    "sizing below content adds the cue before paint"
  );
  available = 174;
  full = 120;
  await m.render({ cards: [{ ...natural, fixedH: 200 }] });
  assert.equal(
    content.attributes["data-overflowing"],
    undefined,
    "larger fitting preview clears the cue"
  );
  available = 54;
  full = 54;
  await m.render({ cards: [{ ...natural, fixedH: 80 }] });
  assert.equal(content.attributes["data-overflowing"], undefined, "exact fit is not overflow");
  full = 180;
  await m.render({
    cards: [
      { ...natural, fixedH: 80, entity: { ...natural.entity, excerpt: "Changed long content" } },
    ],
  });
  assert.equal(
    content.attributes["data-overflowing"],
    "true",
    "content update recomputes without waiting for an outer resize"
  );
  full = 30;
  await m.render({
    cards: [{ ...natural, fixedH: 80, entity: { ...natural.entity, excerpt: "Short" } }],
  });
  assert.equal(content.attributes["data-overflowing"], undefined);
  full = 180;
  await measure();
  assert.equal(
    content.attributes["data-overflowing"],
    "true",
    "font/theme/wrapping reflow uses the intrinsic body observer"
  );
  await m.render({ cards: [natural] });
  assert.equal(
    content.attributes["data-overflowing"],
    undefined,
    "natural cancellation removes the cue immediately"
  );
  assert.equal(m.tree.props(outer).style.height, undefined);
  assert.equal(m.tree.props(outer).style.overflow, undefined);
  assert.equal(
    m.observers.length,
    initialObservers,
    "size/content changes do not reconnect measurement observers"
  );
  assert.ok(m.observers.every((o) => !o.disconnected));
  assert.deepEqual(m.byCall("onDrop"), []);
  assert.deepEqual(m.byCall("onResizeCard"), [], "paint-only checks cannot persist dimensions");
  await m.unmount();
  assert.ok(m.observers.every((o) => o.disconnected));
});

test("Task10: pan and unrelated card geometry do not rerender unchanged card content", async (t) => {
  const original = i18n.t;
  let translations = 0;
  i18n.t = function (key, ...args) {
    if (key === "table.kind.note") translations++;
    return original.call(this, key, ...args);
  };
  t.after(() => (i18n.t = original));
  const f = await mount(t);
  const initial = translations;
  const cards = f.current().cards.map((c) => ({ ...c, rect: { ...c.rect } }));
  await f.render({ cards, viewport: { x: 8, y: 8, scale: 1 } });
  assert.equal(translations, initial, "unchanged card text should not be regenerated on pan");
  const changed = cards.map((c, i) =>
    i === 0
      ? { ...c, entity: { ...c.entity, title: "Updated source" }, rect: { ...c.rect, w: 320 } }
      : c
  );
  await f.render({ cards: changed, selection: [changed[0].key] });
  assert.match(f.cardEl(changed[0].key).textContent, /Updated source/);
  assert.equal(f.cardEl(changed[0].key).style.width, "320px");
  assert.equal(f.cardEl(changed[0].key).attributes["aria-selected"], "true");
  assert.ok(translations > initial, "changed source must still render");
});

test("Task10 fix1: overflow paint follows real measurement without regenerating unchanged card text", async (t) => {
  const original = i18n.t;
  let translations = 0;
  i18n.t = function (key, ...args) {
    if (key === "table.kind.note") translations++;
    return original.call(this, key, ...args);
  };
  t.after(() => (i18n.t = original));
  const c = { ...card("note:1", "note", 32, 32), fixedH: 80 };
  const m = await mount(t, { cards: [c] });
  const outer = m.cardEl(c.key);
  const content = m.tree.find((n) => n.attributes.class === "table-card__content");
  const observer = m.observers.find((o) => o.node === outer);
  const before = translations;
  content.clientHeight = 54;
  content.scrollHeight = 180;
  outer.offsetHeight = 80;
  await React.act(async () => observer.callback());
  assert.equal(content.attributes["data-overflowing"], "true");
  assert.deepEqual(m.byCall("onMeasure").at(-1), [c.key, 80]);
  assert.equal(translations, before, "paint-only overflow should not trigger a React render");
  content.scrollHeight = 54;
  await React.act(async () => observer.callback());
  assert.equal(content.attributes["data-overflowing"], undefined);
  assert.equal(translations, before);
});

test("Task10 fix2: a visited card retains its semantic node and observer across viewport roundtrip", async (t) => {
  const c = card("note:1", "note", 32, 32);
  const f = await mount(t, { cards: [c], selection: [] });
  const original = f.cardEl(c.key);
  const observer = f.observers.find((o) => o.node === original);
  await f.render({ viewport: { x: -9000, y: -9000, scale: 1 } });
  assert.ok(f.cardEl(c.key) === original, "offscreen retention preserves the semantic DOM node");
  assert.equal(original.attributes["aria-hidden"], "true");
  assert.equal(original.attributes.tabindex, "-1");
  assert.notEqual(observer.disconnected, true);
  await f.render({ viewport: { x: 0, y: 0, scale: 1 } });
  assert.equal(f.cardEl(c.key), original);
  assert.equal(original.attributes["aria-hidden"], undefined);
  await f.render({ cards: [] });
  assert.equal(f.cardEl(c.key), null, "canonical deletion retires the retained node");
  assert.equal(observer.disconnected, true);
});

test("Task10 fix2: final pointer DOM and nullable cancel restore are synchronous before paint", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  let logical = card("note:1", "note", 32, 32);
  let m, insideDrop, insideResizeCommit;
  const live = () => ({
    cards: [logical],
    viewport: { x: 0, y: 0, scale: 1 },
    selection: [],
    focused: null,
  });
  m = await mount(t, {
    cards: [logical],
    selection: [],
    publication,
    read: live,
    onMove: (positions) => {
      logical = { ...logical, rect: { ...logical.rect, ...positions[logical.key] } };
    },
    onDrop: () => {
      insideDrop = [
        parseFloat(m.cardEl(logical.key).style.left),
        parseFloat(m.cardEl(logical.key).style.top),
      ];
    },
    onResizeCard: (_key, size, commit) => {
      if (commit)
        insideResizeCommit = [
          parseFloat(m.cardEl(logical.key).style.width),
          parseFloat(m.cardEl(logical.key).style.height),
        ];
      logical = {
        ...logical,
        rect: { ...logical.rect, ...{ w: size.w, h: size.h } },
        fixedH: size.h,
      };
    },
    onResizeCancel: () => {
      logical = { ...logical, rect: { ...logical.rect, w: 280, h: 150 }, fixedH: undefined };
    },
  });
  const node = m.cardEl(logical.key);
  await m.event("onPointerDown", node, { clientX: 42, clientY: 52 });
  await m.event("onPointerMove", node, { clientX: 50, clientY: 60 });
  await m.event("onPointerUp", node, { clientX: 101, clientY: 83 });
  assert.deepEqual(
    insideDrop,
    [91, 63],
    "main drop callback already observes the exact final pointer DOM"
  );
  const handle = handleFor(m);
  await m.event("onPointerDown", handle);
  await m.event("onPointerMove", handle, { clientX: 100, clientY: 100 });
  await m.flush();
  assert.equal(parseFloat(node.style.height), 230);
  await React.act(() => {
    m.tree.props(m.canvas()).onPointerCancel({ pointerId: 1 });
    assert.equal(
      node.style.height,
      "",
      "nullable natural height is restored before callback return"
    );
    assert.equal(node.style.overflow, "");
    assert.equal(parseFloat(node.style.width), 280);
  });
  await m.event("onPointerDown", handleFor(m));
  await m.event("onPointerMove", handleFor(m), { clientX: 25, clientY: 30 });
  await m.event("onPointerUp", handleFor(m), { clientX: 51, clientY: -380 });
  assert.deepEqual(
    insideResizeCommit,
    [321, 80],
    "resize commit callback sees the exact final preview DOM"
  );
  assert.equal(
    parseFloat(node.style.width),
    320,
    "snapped geometry is also current before returning"
  );
});

test("Task10 fix2: a retired card observer cannot measure into a later canonical owner", async (t) => {
  const m = await mount(t, { cards: [card("note:1", "note", 32, 32)] });
  const observer = m.observers.find((o) => o.node === m.cardEl("note:1"));
  await m.render({ cards: [] });
  const before = m.byCall("onMeasure").length;
  await React.act(() => observer.callback());
  assert.equal(m.byCall("onMeasure").length, before);
});

test("Task10 fix2: one Table observer retains both actual targets per card and deduplicates entries", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  const m = await mount(t, {
    publication,
    cards: [card("note:1", "note", 32, 32), card("note:2", "note", 400, 32)],
  });
  const a = m.cardEl("note:1"),
    b = m.cardEl("note:2");
  const observer = m.observers.find((o) => o.nodes?.includes(a) && o.nodes.includes(b));
  assert.ok(observer, "cards share the Table-owned real ResizeObserver");
  assert.equal(observer.nodes.length, 4, "outer and intrinsic body are both observed");
  const before = m.byCall("onMeasure").length;
  await React.act(() => observer.callback(observer.nodes.map((target) => ({ target }))));
  assert.equal(
    m.byCall("onMeasure").length,
    before + 2,
    "both entries for a card produce its actual outer measurement once"
  );
  await m.render({ cards: [] });
  const retired = m.byCall("onMeasure").length;
  await React.act(() => observer.callback([{ target: a }, { target: b }]));
  assert.equal(
    m.byCall("onMeasure").length,
    retired,
    "retired targets cannot measure into a later board"
  );
});

test("Task10 fix2: keyboard entry and connector geometry use the live world before any paint", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const { connectorPath } = await import("../../src/components/table/tableGeometry.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  let a = card("note:1", "note", 32, 32),
    b = card("note:2", "note", 9000, 32);
  let viewport = { x: 0, y: 0, scale: 1 },
    focused = null,
    m;
  const read = () => ({ cards: [a, b], viewport, focused, selection: [] });
  m = await mount(t, {
    cards: [a, b],
    selection: [],
    edges: [{ a: a.key, b: b.key }],
    publication,
    read,
    onFocus: (key) => {
      focused = key;
    },
    onViewport: (value) => {
      viewport = value;
    },
    onMove: (positions) => {
      a = { ...a, rect: { ...a.rect, ...positions[a.key] } };
    },
    onDrop: () => {
      const svg = m.tree.find((n) => n.attributes.class === "table-connectors");
      assert.equal(
        svg.childNodes[0].attributes.d,
        connectorPath(a.rect, b.rect),
        "physical connector already follows the final DOM geometry"
      );
    },
  });
  const node = m.cardEl(a.key);
  await m.event("onPointerDown", node);
  await m.event("onPointerUp", node, { clientX: 50, clientY: 60 });
  viewport = { x: -8970, y: 0, scale: 1 };
  await m.event("onKeyDown", m.canvas(), { key: "ArrowDown" });
  assert.equal(focused, b.key, "entry uses live viewport, not its older React snapshot");
  assert.equal(globalThis.document.activeElement, m.cardEl(b.key));
});

test("Task10 fix2: canonical retirement and same-key return update DOM ownership before paint", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  const a = card("note:1", "note", 32, 32);
  let cards = [a],
    notify;
  const m = await mount(t, {
    cards,
    selection: [],
    publication,
    read: () => ({ cards, viewport: { x: 0, y: 0, scale: 1 }, focused: null, selection: [] }),
    subscribe: (callback) => {
      notify = callback;
      return () => {
        notify = null;
      };
    },
  });
  const node = m.cardEl(a.key);
  await React.act(() => {
    cards = [];
    notify();
    assert.equal(node.attributes["aria-hidden"], "true");
    cards = [a];
    notify();
  });
  assert.equal(node.attributes["aria-hidden"], undefined);
  assert.notEqual(
    node.style.visibility,
    "hidden",
    "a same-key current owner cannot inherit retired DOM visibility"
  );
  assert.equal(
    node.style.clipPath || "none",
    "none",
    "current visible controls are fully unclipped"
  );
});

test("Task10 fix2: native measurement retains a just-resized overflow cue before React publication", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  let a = card("note:1", "note", 32, 32);
  const m = await mount(t, {
    cards: [a],
    selection: [],
    publication,
    read: () => ({ cards: [a], viewport: { x: 0, y: 0, scale: 1 }, selection: [], focused: null }),
    onResizeCard: (_key, size) => {
      a = { ...a, fixedH: size.h, rect: { ...a.rect, w: size.w, h: size.h } };
    },
  });
  const node = m.cardEl(a.key),
    content = m.tree.find((n) => n.attributes.class === "table-card__content");
  content.clientHeight = 54;
  content.scrollHeight = 180;
  node.offsetHeight = 80;
  await m.event("onPointerDown", handleFor(m));
  await m.event("onPointerMove", handleFor(m), { clientX: 40, clientY: -400 });
  await m.flush();
  assert.equal(content.attributes["data-overflowing"], "true");
  const observer = m.observers.find((o) => o.nodes?.includes(node));
  await React.act(() => observer.callback([{ target: node }]));
  assert.equal(
    content.attributes["data-overflowing"],
    "true",
    "a real native delivery must use the synchronous sizing owner, not an older React card"
  );
});

test("Task10 fix2: render-free background pan retains immediate cursor feedback and cancellation", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  const a = card("note:1", "note", 32, 32);
  let viewport = { x: 0, y: 0, scale: 1 };
  const m = await mount(t, {
    cards: [a],
    publication,
    read: () => ({ cards: [a], viewport, selection: [], focused: null }),
    onViewport: (value) => {
      viewport = value;
    },
  });
  await m.flush();
  await m.event("onPointerDown", m.canvas());
  await m.event("onPointerMove", m.canvas(), { clientX: 90, clientY: 110 });
  await m.flush();
  assert.equal(m.canvas().attributes["data-panning"], "true");
  await m.event("onPointerCancel", m.canvas());
  assert.equal(m.canvas().attributes["data-panning"], undefined);
  assert.deepEqual(viewport, { x: 0, y: 0, scale: 1 });
});

test("Task10 fix2: retired drag keys cannot keep the bounded warm publisher alive", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  let cards = [card("note:1", "note", 32, 32)];
  const m = await mount(t, {
    cards,
    publication,
    read: () => ({ cards, viewport: { x: 0, y: 0, scale: 1 }, selection: [], focused: null }),
    onMove: () => {},
  });
  await m.flush();
  await m.event("onPointerDown", m.cardEl("note:1"));
  await m.event("onPointerMove", m.cardEl("note:1"), { clientX: 70, clientY: 70 });
  await m.flush();
  cards = [];
  await m.render({ cards });
  await m.flush();
  assert.equal(m.frames.size, 0, "a missing retired key is not a canonical card waiting to warm");
});

test("Task10 fix2: lasso DOM clears synchronously at cancellation before a paint snapshot", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  const cards = [card("note:1", "note", 32, 32)];
  const m = await mount(t, {
    cards,
    publication,
    read: () => ({ cards, viewport: { x: 0, y: 0, scale: 1 }, selection: [], focused: null }),
    onSelect: () => {},
  });
  await m.flush();
  await m.event("onPointerDown", m.canvas(), { shiftKey: true });
  await m.event("onPointerMove", m.canvas(), { clientX: 110, clientY: 120 });
  await m.flush();
  await m.flush();
  const overlay = m.tree.find((n) => n.attributes.class === "table-lasso");
  assert.ok(overlay);
  await m.event("onPointerCancel", m.canvas());
  assert.equal(
    overlay.style.visibility,
    "hidden",
    "cancelled overlay must be absent before the next RAF"
  );
});

test("Task10 fix2: newly visible canonical content is mounted before the wheel callback returns", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  const cards = Array.from({ length: 50 }, (_, i) =>
    card(`note:${i + 1}`, "note", 32 + i * 304, 32)
  );
  let viewport = { x: 0, y: 0, scale: 1 };
  const m = await mount(t, {
    cards,
    selection: [],
    publication,
    read: () => ({ cards, viewport, selection: [], focused: null }),
    onViewport: (value) => {
      viewport = value;
    },
  });
  assert.ok(!m.cardEl("note:50"));
  await React.act(() => {
    m.listeners.get("wheel")({
      deltaX: 14900,
      deltaY: 0,
      ctrlKey: false,
      metaKey: false,
      clientX: 100,
      clientY: 100,
      preventDefault() {},
    });
    assert.ok(m.cardEl("note:50"), "visible content must exist before the wheel callback returns");
    assert.notEqual(m.cardEl("note:50").style.visibility, "hidden");
  });
});

test("Task10 fix2: optional retention warms nearby world content before distant canonical-order cards", async (t) => {
  const { createTablePublication } = await import("../../src/components/table/tablePublication.ts");
  const publication = createTablePublication();
  t.after(() => publication.dispose());
  const near = card("note:50", "note", 1700, 32);
  const cards = [
    card("note:1", "note", 32, 32),
    ...Array.from({ length: 30 }, (_, i) => card(`note:${i + 2}`, "note", 9000 + i * 304, 9000)),
    near,
  ];
  const m = await mount(t, { cards, selection: [], publication });
  assert.ok(
    m.cardEl(near.key),
    "the bounded first warm chunk prioritizes the spatial neighborhood"
  );
  assert.equal(m.cardEl(near.key).attributes["aria-hidden"], "true");
  assert.equal(m.cardEl(near.key).attributes.tabindex, "-1");
});
