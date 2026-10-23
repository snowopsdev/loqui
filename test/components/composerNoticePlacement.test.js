const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

// Full-app M2: workspace notices stay above the bottom composers' controls,
// through the same Plan 04 boundary onboarding's footer uses.
const MOCKS = {
  "/useVoiceDraft": `export const useVoiceDraft = () => ({ status: "idle", start() {}, stop() {}, cancel() {}, elapsed: 0, readLevel: () => 0, streamingOnlyProvider: false });`,
};

async function fixture(t) {
  let root;
  t.after(() => React.act(async () => root?.unmount()));
  const listeners = new Map();
  const observers = [];
  const bounds = new Map();
  installBrowserGlobals(t, {
    window: {
      innerHeight: 800,
      location: { search: "" },
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
        unobserve(target) {
          this.targets.delete(target);
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
  // Every element defaults to a docked bottom composer: 56px tall, ending at the window edge.
  globalThis.document.createElement = (tag) => {
    const node = createElement(tag);
    node.getBoundingClientRect = () => bounds.get(node) ?? { top: 744, width: 600, height: 56 };
    return node;
  };
  globalThis.requestAnimationFrame = () => 0;
  const vite = await createRendererServer(t, rendererOptions("loqui-composer-notices-", MOCKS));
  const { NoticeStack } = await vite.ssrLoadModule("/components/ui/NoticeStack.tsx");
  const { notify } = await vite.ssrLoadModule("/components/ui/notices.ts");
  const { NoticePlacementContext } = await vite.ssrLoadModule(
    "/components/ui/useNoticePlacement.ts"
  );
  const { ChatInput } = await vite.ssrLoadModule("/components/chat/ChatInput.tsx");
  const { default: NoteBottomBar } = await vite.ssrLoadModule(
    "/components/notes/NoteBottomBar.tsx"
  );
  // The same reservation map AppRouter keeps around the workspace.
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
        placement: "panel",
        bottomInset: Math.max(0, ...insets.values()),
      })
    );
  }
  const composers = {
    chat: () =>
      React.createElement(ChatInput, {
        agentState: "idle",
        partialTranscript: "",
        queueKey: "chat|1|route",
        onTextSubmit() {},
        onCancel() {},
      }),
    note: (props = {}) =>
      React.createElement(NoteBottomBar, { isRecording: false, onAskSubmit() {}, ...props }),
  };
  root = createRoot(ui.container);
  const render = (children) =>
    React.act(async () => root.render(React.createElement(Surface, null, children)));
  await React.act(async () =>
    notify({ kind: "alert", title: "Couldn't paste", words: "Keep these", persistent: true })
  );
  const viewport = () => ui.find((n) => n.attributes?.class === "notice-stack");
  const event = async (name) =>
    React.act(async () => {
      for (const cb of listeners.get(name) ?? []) cb();
    });
  return { ui, render, composers, viewport, event, bounds, observers, listeners, notify };
}

for (const kind of ["chat", "note"]) {
  test(`${kind} composer lifts workspace notices above its controls and releases on unmount`, async (t) => {
    const f = await fixture(t);
    await f.render(null);
    assert.equal(f.viewport().style.bottom ?? "", "", "default placement without a composer");
    const before = f.observers.length;
    await f.render(f.composers[kind]());
    assert.equal(f.viewport().style.bottom, "68px", "56px composer + 12px gap");
    await f.render(null);
    assert.equal(f.viewport().style.bottom ?? "", "", "release restores the default placement");
    assert.ok(
      f.observers.slice(before).every((observer) => observer.targets.size === 0),
      "the composer's observers are released"
    );
  });
}

test("a hidden note composer reserves nothing while the embedded chat owns the bottom", async (t) => {
  const f = await fixture(t);
  await f.render(f.composers.note({ hideInput: true }));
  assert.equal(f.viewport().style.bottom ?? "", "");
  await f.render(f.composers.note({ hideInput: false }));
  assert.equal(f.viewport().style.bottom, "68px");
});

test("a composer mid-page or scrolled out of the window leaves notices in place", async (t) => {
  const f = await fixture(t);
  await f.render(f.composers.chat());
  const root = f.ui.container.childNodes[0];
  assert.equal(f.viewport().style.bottom, "68px");
  // The overview Ask, mid-page, with this one-card stack: the stack's default box
  // (y 724-780) does not reach the composer (y 300-356), so nothing is reserved.
  f.bounds.set(f.viewport(), { top: 724, height: 56, left: 860, right: 1260, width: 400 });
  f.bounds.set(root, { top: 300, height: 56, left: 456, right: 1056, width: 600 });
  await f.event("scroll");
  assert.equal(f.viewport().style.bottom ?? "", "");
  // Scrolled above the window: never push notices off screen.
  f.bounds.set(root, { top: -40, width: 600, height: 56 });
  await f.event("scroll");
  assert.equal(f.viewport().style.bottom ?? "", "");
  // Scrolled back to the bottom edge.
  f.bounds.set(root, { top: 700, width: 600, height: 80 });
  await f.event("scroll");
  assert.equal(f.viewport().style.bottom, "112px");
});

// Scoped review R1: a mid-page composer is protected whenever the real stack
// would reach it, not only when it sits in the bottom band.
const TALL_STACK = { top: 548, height: 232, left: 860, right: 1260, width: 400 };
const MID_PAGE = { top: 600, height: 56, left: 456, right: 1056, width: 600 };

test("a tall three-item stack lifts above a mid-page composer it would cover", async (t) => {
  const f = await fixture(t);
  await React.act(async () => {
    f.notify({ kind: "receipt", title: "Copied", persistent: true });
    f.notify({ kind: "receipt", title: "Saved", persistent: true });
  });
  await f.render(f.composers.chat());
  const root = f.ui.container.childNodes[0];
  f.bounds.set(f.viewport(), TALL_STACK);
  f.bounds.set(root, MID_PAGE);
  await f.event("scroll");
  assert.equal(f.viewport().style.bottom, "212px", "800 - 600 + 12: the stack ends above it");
  // The same composer clear of the notice column (inline-start) reserves nothing.
  f.bounds.set(root, { ...MID_PAGE, left: 0, right: 400 });
  await f.event("scroll");
  assert.equal(f.viewport().style.bottom ?? "", "");
});

test("a stack that grows into a mid-page composer re-measures without a scroll", async (t) => {
  const f = await fixture(t);
  await f.render(f.composers.chat());
  const root = f.ui.container.childNodes[0];
  f.bounds.set(root, MID_PAGE);
  f.bounds.set(f.viewport(), { ...TALL_STACK, top: 724, height: 56 });
  await f.event("scroll");
  assert.equal(f.viewport().style.bottom ?? "", "", "one card stays below the composer");
  f.bounds.set(f.viewport(), TALL_STACK);
  await React.act(async () => {
    for (const observer of f.observers) if (observer.targets.has(f.viewport())) observer.cb([]);
  });
  assert.equal(f.viewport().style.bottom, "212px", "the stack's own resize re-measures");
});

test("the Chat view reserves its whole composer area, chips row included", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/components/chat/ChatView.tsx"),
    "utf8"
  );
  assert.match(source, /useNoticeBottomBoundary\(composerAreaRef, hasActiveChat\)/);
  assert.match(source, /<div ref=\{composerAreaRef\}/);
});
