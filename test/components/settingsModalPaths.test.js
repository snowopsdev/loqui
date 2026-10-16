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

async function mount(t, getProps) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({
      cachePrefix: "loqui-settings-modal-test-",
      mockModules: {
        "/SettingsPage": "export default function SettingsPage() { return null; }",
        "/ui/SidebarModal": "export default function SidebarModal() { return null; }",
      },
    })
  );
  const SettingsModal = (await vite.ssrLoadModule("/components/SettingsModal.tsx")).default;
  let tree;
  function Probe() {
    tree = SettingsModal(getProps());
    return null;
  }
  root = createRoot(container);
  const render = () => React.act(async () => root.render(React.createElement(Probe)));
  await render();
  return {
    modal: () => tree.props,
    page: () => React.Children.only(tree.props.children).props,
    render,
  };
}

test("opening at a route path lands on that section and sub-tab", async (t) => {
  const h = await mount(t, () => ({
    open: true,
    onOpenChange() {},
    initialSection: "llms/supportModels",
  }));
  assert.equal(h.modal().activeSection, "llms");
  assert.equal(h.page().initialSubTab, "supportModels");
});
test("legacy ids still resolve to their sub-tab", async (t) => {
  const h = await mount(t, () => ({
    open: true,
    onOpenChange() {},
    initialSection: "intelligence",
  }));
  assert.equal(h.modal().activeSection, "llms");
  assert.equal(h.page().initialSubTab, "dictationCleanup");
});
test("a junk id opens Preferences instead of a blank pane", async (t) => {
  const h = await mount(t, () => ({ open: true, onOpenChange() {}, initialSection: "nope/x" }));
  assert.equal(h.modal().activeSection, "general");
  assert.equal(h.page().initialSubTab, undefined);
});
test("the page can jump inside the open modal with a path", async (t) => {
  const h = await mount(t, () => ({ open: true, onOpenChange() {}, initialSection: "general" }));
  assert.equal(typeof h.page().onNavigateToPath, "function");
  await React.act(async () => h.page().onNavigateToPath("stt/upload"));
  assert.equal(h.modal().activeSection, "speechToText");
  assert.equal(h.page().initialSubTab, "upload");
  await React.act(async () => h.modal().onSectionChange("llms"));
  assert.equal(h.modal().activeSection, "llms");
  assert.equal(h.page().initialSubTab, undefined);
});
test("closing and reopening with a new path moves to it", async (t) => {
  let props = { open: false, onOpenChange() {}, initialSection: "general" };
  const h = await mount(t, () => props);
  props = { ...props, open: true, initialSection: "stt/noteRecording" };
  await h.render();
  assert.equal(h.modal().activeSection, "speechToText");
  assert.equal(h.page().initialSubTab, "noteRecording");
});
