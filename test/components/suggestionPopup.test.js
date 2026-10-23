const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/ui/editor/suggestionPopup.ts");
const viewport = { width: 1280, height: 800 };

test("opens 6px below the caret and stays inside the window horizontally", async () => {
  const { popupPosition } = await load();
  assert.deepEqual(
    popupPosition({ left: 300, top: 100, bottom: 120 }, viewport, { width: 280, height: 300 }),
    { left: 300, top: 126 }
  );
  assert.equal(
    popupPosition({ left: 1200, top: 100, bottom: 120 }, viewport, { width: 280, height: 300 })
      .left,
    992
  );
  assert.equal(
    popupPosition({ left: -20, top: 100, bottom: 120 }, viewport, { width: 280, height: 300 }).left,
    8
  );
});

test("flips above the caret near the bottom of the window", async () => {
  const { popupPosition } = await load();
  assert.deepEqual(
    popupPosition({ left: 300, top: 700, bottom: 720 }, viewport, { width: 280, height: 300 }),
    { left: 300, top: 394 }
  );
});

test("a viewport narrower than the popup still keeps its start edge visible", async () => {
  const { popupPosition } = await load();
  assert.equal(
    popupPosition(
      { left: 50, top: 10, bottom: 30 },
      { width: 240, height: 200 },
      { width: 280, height: 320 }
    ).left,
    8
  );
});

test("popup owns one renderer, forwards updates/keys, and releases DOM and observers on exit", async (t) => {
  const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
  installBrowserGlobals(t, { window: { innerWidth: 1280, innerHeight: 800 } });
  const originalDocument = globalThis.document;
  const originalObserver = globalThis.ResizeObserver;
  let resized;
  let disconnected = false;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resized = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  t.after(() => {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  });
  t.after(() => {
    globalThis.document = originalDocument;
  });
  const children = new Set();
  globalThis.document = { body: { appendChild: (el) => children.add(el) } };
  const vite = await createRendererServer(t, {
    noExternal: ["@tiptap/react"],
    mockModules: {
      "@tiptap/react": `
      export const renderers = [];
      export class ReactRenderer {
        constructor(component, options) {
          this.props = options.props;
          this.element = { offsetHeight: 300, style: { removeProperty(k) { delete this[k]; }, setProperty(k,v) { this[k] = v; } }, setAttribute(k,v) { this[k] = v; }, remove() { globalThis.document.body.removeChild?.(this); } };
          this.ref = { onKeyDown: e => e.key === 'Tab' };
          renderers.push(this);
        }
        updateProps(props) { this.props = props; }
        destroy() { this.destroyed = true; }
      }`,
    },
  });
  globalThis.document.body.removeChild = (el) => children.delete(el);
  const { createSuggestionPopup } = await vite.ssrLoadModule(
    "/components/ui/editor/suggestionPopup.ts"
  );
  const { renderers } = await vite.ssrLoadModule("@tiptap/react");
  const popup = createSuggestionPopup({}, { width: 280, toProps: (p) => ({ items: p.items }) })();
  const props = {
    editor: {},
    items: ["a"],
    clientRect: () => ({ left: 1200, top: 700, bottom: 720 }),
  };
  popup.onStart(props);
  const renderer = renderers.at(-1);
  assert.equal(children.size, 1);
  assert.equal(renderer.element["data-editor-chrome"], "");
  assert.equal(renderer.element.style.left, "992px");
  assert.equal(renderer.element.style.top, "394px");
  popup.onUpdate({ ...props, items: ["b"] });
  assert.deepEqual(renderer.props.items, ["b"]);
  assert.equal(popup.onKeyDown({ event: { key: "Tab" } }), true);
  assert.equal(popup.onKeyDown({ event: { key: "Escape" } }), true);
  renderer.element.offsetHeight = 340;
  assert.equal(typeof resized, "function", "placement follows the rendered portal's size");
  resized();
  assert.equal(renderer.element.style.top, "354px");
  popup.onExit(props);
  assert.equal(disconnected, true);
  popup.onExit(props);
  assert.equal(children.size, 0);
  assert.equal(renderer.destroyed, true);
  popup.onUpdate(props);
  assert.equal(children.size, 0, "late updates cannot recreate a released renderer");
});
