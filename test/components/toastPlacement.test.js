const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { installTree } = require("../helpers/harness/fakeDomTree");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

async function fixture(t, { panel = true } = {}) {
  let root;
  t.after(() => React.act(async () => root?.unmount()));
  const listeners = new Map();
  const observers = [];
  const bounds = new Map();
  installBrowserGlobals(t, {
    window: {
      innerHeight: 560,
      location: { search: panel ? "?panel=true" : "" },
      addEventListener(name, cb) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(cb);
      },
      removeEventListener: (name, cb) => listeners.get(name)?.delete(cb),
      ResizeObserver: class {
        constructor(cb) {
          this.cb = cb;
          this.targets = new Set();
          observers.push(this);
        }
        observe(target) {
          this.targets.add(target);
        }
        disconnect() {
          this.targets.clear();
        }
      },
    },
  });
  installHookDom(t);
  const originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = globalThis.window.ResizeObserver;
  t.after(() => {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  });
  const ui = installTree();
  const createElement = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => {
    const node = createElement(tag);
    node.getBoundingClientRect = () => bounds.get(node) ?? { top: 496, width: 640, height: 64 };
    return node;
  };
  const vite = await createRendererServer(t, rendererOptions("loqui-toast-placement-"));
  const { NoticeStack } = await vite.ssrLoadModule("/components/ui/NoticeStack.tsx");
  const { notify } = await vite.ssrLoadModule("/components/ui/notices.ts");
  const { NoticePlacementContext } = await vite.ssrLoadModule(
    "/components/ui/useNoticePlacement.ts"
  );
  const { OnboardingShell } = await vite.ssrLoadModule(
    "/components/onboarding/OnboardingShell.tsx"
  );
  function Surface({ children }) {
    const [insets, setInsets] = React.useState(new Map());
    const reserve = React.useCallback(
      (owner, inset) =>
        setInsets((current) => {
          const next = new Map(current);
          if (inset === null) next.delete(owner);
          else next.set(owner, inset);
          return next;
        }),
      []
    );
    return React.createElement(
      NoticePlacementContext.Provider,
      { value: reserve },
      children,
      React.createElement(NoticeStack, {
        placement: panel ? "panel" : "pill",
        bottomInset: Math.max(0, ...insets.values()),
      })
    );
  }
  const shell = (key) =>
    React.createElement(
      OnboardingShell,
      {
        key,
        step: "speech",
        visited: [],
        platform: "linux",
        onNavigate() {},
        rail: { title: "Voice", body: "", mode: { kind: "idle" } },
        primary: { label: "Continue", onClick() {} },
      },
      React.createElement("h1", null, "Voice")
    );
  root = createRoot(ui.container);
  const render = async (keys, providerKey = "default") =>
    React.act(async () =>
      root.render(React.createElement(Surface, { key: providerKey }, keys.map(shell)))
    );
  const show = async (props = {}) =>
    React.act(async () => notify({ kind: "receipt", title: "Saved", persistent: true, ...props }));
  const viewport = () =>
    ui.byAttr("role", "status")[0]?.parentNode ??
    ui.find((n) => (n.attributes.class ?? "").includes("z-[100]"));
  const resize = async () =>
    React.act(async () => {
      for (const observer of observers) if (observer.targets.size) observer.cb([]);
    });
  const event = async (name) =>
    React.act(async () => {
      for (const cb of listeners.get(name) ?? []) cb();
    });
  return { ui, render, show, viewport, resize, event, bounds, listeners, observers };
}

test("the real shell reserves its measured footer, tracks wrapping and viewport changes, and releases without clearing a toast", async (t) => {
  const f = await fixture(t);
  await f.render(["setup"]);
  await f.show();
  const toast = f.ui.byAttr("role", "status")[0];
  const footer = f.ui.find((n) => n.tagName === "FOOTER");
  assert.equal(f.viewport().style.bottom, "76px");
  f.bounds.set(footer, { top: 435, width: 640, height: 125 });
  await f.resize();
  assert.equal(f.viewport().style.bottom, "137px", "actual two-row/long-label geometry");
  globalThis.window.innerHeight = 700;
  f.bounds.set(footer, { top: 583, width: 900, height: 117 });
  await f.event("resize");
  assert.equal(f.viewport().style.bottom, "129px");
  await f.render([]);
  assert.equal(f.viewport().style.bottom, "", "default CSS placement is restored");
  assert.equal(f.ui.byAttr("role", "status")[0], toast, "the existing notice survives release");
  assert.ok(f.observers.every((observer) => observer.targets.size === 0));
  assert.ok([...f.listeners.values()].every((callbacks) => callbacks.size === 0));
  for (const observer of f.observers) observer.cb([]); // late delivery cannot reacquire a released owner
  assert.equal(f.viewport().style.bottom, "");
});

test("reservations are independent per shell; leaving a taller shell preserves another owner", async (t) => {
  const f = await fixture(t);
  await f.render(["a", "b"]);
  await f.show();
  const footers = f.ui.findAll((n) => n.tagName === "FOOTER");
  f.bounds.set(footers[0], { top: 420, width: 640, height: 140 });
  f.bounds.set(footers[1], { top: 470, width: 640, height: 90 });
  await f.resize();
  assert.equal(f.viewport().style.bottom, "152px");
  await f.render(["b"]);
  assert.equal(f.viewport().style.bottom, "102px");
  f.bounds.set(footers[1], { top: 600, width: 640, height: 90 });
  await f.event("scroll");
  assert.equal(f.viewport().style.bottom, "", "a boundary below the viewport reserves nothing");
});

test("workspace default placement and existing standard toast actions and dismissal survive", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture(t);
  await f.render([]);
  let actions = 0;
  await f.show({ actions: [{ label: "Retry", onClick: () => actions++, keepOpen: true }] });
  assert.equal(f.viewport().style.bottom ?? "", "");
  assert.equal(f.viewport().attributes["data-placement"], "panel");
  await f.render(["setup"]);
  assert.equal(f.viewport().style.bottom, "76px");
  await f.ui.click("Retry");
  assert.equal(actions, 1);
  assert.equal(f.ui.byAttr("role", "status").length, 1);
  await f.ui.click(f.ui.byAttr("aria-label", "notices.dismiss")[0]);
  await React.act(async () => t.mock.timers.tick(201));
  assert.equal(f.ui.byAttr("role", "status").length, 0);
});

test("a fresh provider cannot inherit a departed provider's reservation", async (t) => {
  const f = await fixture(t);
  await f.render(["setup"], "first");
  await f.show();
  assert.equal(f.viewport().style.bottom, "76px");
  await f.render([], "second");
  await f.show();
  assert.equal(f.viewport().style.bottom ?? "", "");
  assert.equal(f.viewport().attributes["data-placement"], "panel");
});

test("reserved toasts retain hover pause, auto-dismiss and live-region semantics", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = await fixture(t);
  await f.render(["setup"]);
  await f.show({ persistent: false });
  const toast = f.ui.byAttr("role", "status")[0];
  assert.equal(toast.attributes["aria-live"], "polite");
  await React.act(async () => {
    t.mock.timers.tick(500);
    f.ui.props(toast).onMouseEnter();
    t.mock.timers.tick(4000);
  });
  assert.equal(f.ui.byAttr("role", "status")[0], toast);
  assert.doesNotMatch(toast.attributes.class, /opacity-0/);
  await React.act(async () => f.ui.props(toast).onMouseLeave());
  await React.act(async () => t.mock.timers.tick(3000));
  assert.equal(f.ui.byAttr("role", "status").length, 0);
  await React.act(async () => t.mock.timers.tick(200));
  assert.equal(f.ui.byAttr("role", "status").length, 0);
});

test("dictation panel standard and error positions retain priority even with a shell reservation", async (t) => {
  const f = await fixture(t, { panel: false });
  await f.render(["setup"]);
  await f.show();
  assert.equal(f.viewport().style.bottom ?? "", "");
  assert.equal(f.viewport().attributes["data-placement"], "pill");
  await f.show({ kind: "alert", body: "Failed" });
  assert.equal(f.viewport().style.bottom ?? "", "");
  assert.equal(f.viewport().attributes["data-placement"], "pill");
  assert.equal(f.ui.byAttr("role", "alert").length, 1);
});
