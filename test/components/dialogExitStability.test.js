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

test("closing dialog content ignores pointer input while it fades out", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
  // Settings (SidebarModal), shared dialogs and both command-palette modes.
  assert.match(read("src/components/ui/dialog.tsx"), /data-\[state=closed\]:pointer-events-none/);
  assert.match(
    read("src/components/ui/SidebarModal.tsx"),
    /data-\[state=closed\]:zoom-out-98[^"]*data-\[state=closed\]:pointer-events-none/
  );
  assert.equal(
    (
      read("src/components/CommandSearch.tsx").match(
        /data-\[state=closed\]:pointer-events-none/g
      ) ?? []
    ).length,
    2
  );
});
