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

// Scoped review R2: the Dictate-into-a-note title request must never steal
// focus from a control the user chose before the lazily mounted editor
// appears. Nodes are compared by identity only.
async function setup(t) {
  let root = null;
  // Registered first so the root unmounts before the browser globals go away.
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const listeners = new Map();
  installBrowserGlobals(t, {
    window: {
      addEventListener(name, cb) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(cb);
      },
      removeEventListener: (name, cb) => listeners.get(name)?.delete(cb),
    },
  });
  installHookDom(t);
  const tree = installTree();
  const vite = await createRendererServer(t, { cachePrefix: "loqui-note-focus-" });
  const focus = await vite.ssrLoadModule("/stores/noteFocusRequest.ts");
  const host = { tagName: "DIV", focus() {} };
  const other = { tagName: "BUTTON", focus() {} };
  // The editor's consumer, as NoteEditor runs it when it finally mounts.
  const mountEditor = async (noteId) => {
    let title = null;
    function Editor() {
      const ref = React.useRef(null);
      React.useEffect(() => {
        if (focus.takeNoteTitleFocus(noteId)) ref.current?.focus();
      }, []);
      return React.createElement("div", {
        ref: (node) => {
          ref.current = node;
          title = node;
        },
        role: "textbox",
      });
    }
    root = createRoot(tree.container);
    await React.act(async () => root.render(React.createElement(Editor)));
    return title;
  };
  const fire = (name, event = {}) => {
    for (const cb of listeners.get(name) ?? []) cb(event);
  };
  const active = () => globalThis.document.activeElement;
  return { focus, host, other, mountEditor, fire, active, listeners };
}

test("a control focused before the delayed editor mount keeps focus", async (t) => {
  const s = await setup(t);
  globalThis.document.activeElement = s.host;
  s.focus.requestNoteTitleFocus(7);
  // The user tabs to another control while Notes is still loading.
  globalThis.document.activeElement = s.other;
  s.fire("focusin", { target: s.other });
  await s.mountEditor(7);
  assert.ok(s.active() === s.other, "the chosen control keeps focus, the title does not steal it");
});

test("focus moved without an event is still respected at consumption", async (t) => {
  const s = await setup(t);
  globalThis.document.activeElement = s.host;
  s.focus.requestNoteTitleFocus(7);
  globalThis.document.activeElement = s.other;
  await s.mountEditor(7);
  assert.ok(s.active() === s.other, "consumption checks focus is still unclaimed");
});

for (const name of ["pointerdown", "keydown"])
  test(`a later ${name} retires the request before a return visit`, async (t) => {
    const s = await setup(t);
    globalThis.document.activeElement = s.host;
    s.focus.requestNoteTitleFocus(7);
    s.fire(name, {});
    await s.mountEditor(7);
    assert.ok(s.active() === s.host, "the stale request focuses nothing");
    assert.equal(s.focus.takeNoteTitleFocus(7), false, "retired");
  });

test("an untouched hand-off still focuses the new note's title, once", async (t) => {
  const s = await setup(t);
  globalThis.document.activeElement = s.host;
  s.focus.requestNoteTitleFocus(7);
  const title = await s.mountEditor(7);
  assert.ok(title && s.active() === title, "the title takes focus");
  assert.equal(s.focus.takeNoteTitleFocus(7), false, "consumed once");
  assert.ok(
    [...s.listeners.values()].every((set) => set.size === 0),
    "no listeners remain after consumption"
  );
});

test("NoteEditor consumes the request through the guarded hook", () => {
  const editor = fs.readFileSync(
    path.join(__dirname, "../../src/components/notes/NoteEditor.tsx"),
    "utf8"
  );
  assert.match(editor, /useNoteTitleFocus\(note\.id, titleRef\)/);
  assert.doesNotMatch(editor, /takeNoteTitleFocus/);
});
