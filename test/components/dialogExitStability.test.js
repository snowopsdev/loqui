// Exit animations keep dialog content mounted (and clickable) while it fades out.
// These pin what may and may not change during that fade.
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

function findAll(node, predicate, out = []) {
  if (Array.isArray(node)) node.forEach((child) => findAll(child, predicate, out));
  else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    findAll(node.props?.children, predicate, out);
  }
  return out;
}

async function setup(t) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  globalThis.document.addEventListener = () => {};
  globalThis.document.removeEventListener = () => {};
  globalThis.document.querySelector = () => null;
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-dialog-exit-test-" }, { t: "(k) => k" })
  );
  root = createRoot(container);
  return { vite, render: (el) => React.act(async () => root.render(el)) };
}

test("a ConfirmDialog fading out ignores Confirm and Cancel clicks", async (t) => {
  const { vite, render } = await setup(t);
  const { ConfirmDialog } = await vite.ssrLoadModule("/components/ui/dialog.tsx");
  const calls = [];
  let tree;
  function Probe({ open }) {
    tree = ConfirmDialog({
      open,
      onOpenChange: (next) => calls.push(`openChange:${next}`),
      title: "Clear dictionary?",
      confirmText: "Clear",
      cancelText: "Keep",
      onConfirm: () => calls.push("confirm"),
      onCancel: () => calls.push("cancel"),
      variant: "destructive",
    });
    return null;
  }
  const button = (label) =>
    findAll(tree, (n) => n.props?.children === label && typeof n.props?.onClick === "function")[0];

  await render(React.createElement(Probe, { open: false }));
  button("Clear").props.onClick();
  button("Keep").props.onClick();
  assert.deepEqual(calls, [], "a click during the exit fade does nothing");

  await render(React.createElement(Probe, { open: true }));
  button("Clear").props.onClick();
  assert.deepEqual(calls, ["confirm", "openChange:false"]);
});

test("closing Settings keeps the search results through the fade; reopening resets them", async (t) => {
  const { vite, render } = await setup(t);
  const { useSettingsSearch } = await vite.ssrLoadModule(
    "/components/settings/useSettingsSearch.ts"
  );
  let hook;
  function Probe({ open }) {
    hook = useSettingsSearch({ open, navigateToPath() {}, land: () => () => {} });
    return null;
  }
  await render(React.createElement(Probe, { open: true }));
  await React.act(async () => hook.setQuery("mic"));
  assert.equal(hook.query, "mic");

  await render(React.createElement(Probe, { open: false }));
  assert.equal(hook.query, "mic", "the closing dialog still shows what was searched");

  await render(React.createElement(Probe, { open: true }));
  assert.equal(hook.query, "", "a reopened Settings starts without the old search");
});

test("closing dialog content turns inert for its exit fade and back when reopened", async (t) => {
  const { vite } = await setup(t);
  const { inertWhileClosed } = await vite.ssrLoadModule("/components/ui/useDismissGuard.ts");
  // A MutationObserver stand-in that reports data-state changes synchronously.
  const observers = [];
  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(node, options) {
      assert.deepEqual(options.attributeFilter, ["data-state"]);
      this.node = node;
    }
    disconnect() {
      this.node = null;
    }
  };
  t.after(() => (globalThis.MutationObserver = original));
  const attrs = { "data-state": "open" };
  const focused = [];
  const doc = { activeElement: null };
  let fieldFocusable = true;
  const field = {
    isConnected: true,
    focus: () => {
      focused.push("field");
      if (fieldFocusable) doc.activeElement = field;
    },
  };
  const node = {
    inert: false,
    ownerDocument: doc,
    contains: (el) => el === field || el === node,
    focus: () => {
      focused.push("content");
      doc.activeElement = node;
    },
    getAttribute: (name) => attrs[name] ?? null,
    setState(state) {
      attrs["data-state"] = state;
      for (const o of observers) if (o.node === this) o.callback([]);
    },
  };

  const stop = inertWhileClosed(node);
  assert.equal(node.inert, false, "open content stays interactive");
  doc.activeElement = field;
  node.setState("closed");
  assert.equal(node.inert, true, "fading-out content takes no input");
  // Reopened mid-fade: the same content comes back, and so does its focus.
  doc.activeElement = null;
  node.setState("open");
  assert.equal(node.inert, false, "reopened content is interactive again");
  assert.deepEqual(focused, ["field"], "focus returns to the field it left");
  // With nothing focused inside when it closed, the content itself takes focus.
  doc.activeElement = null;
  node.setState("closed");
  node.setState("open");
  assert.deepEqual(focused, ["field", "content"]);
  // A field that became disabled refuses focus; the content takes it instead.
  doc.activeElement = field;
  node.setState("closed");
  fieldFocusable = false;
  doc.activeElement = null;
  node.setState("open");
  assert.deepEqual(focused, ["field", "content", "field", "content"]);
  assert.equal(doc.activeElement, node);
  stop();
  node.setState("closed");
  assert.equal(node.inert, false, "a detached node is no longer tracked");
});

test("every dialog content (shared, Settings, palette) registers through the inert-aware ref", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  for (const file of [
    "src/components/ui/dialog.tsx",
    "src/components/ui/SidebarModal.tsx",
    "src/components/CommandSearch.tsx",
  ]) {
    assert.match(read(file), /<DialogPrimitive\.Content[\s\S]{0,80}ref=\{registerContent\}/, file);
  }
});
