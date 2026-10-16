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

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (!node || typeof node !== "object") return;
  visit(node);
  walk(node.props?.children, visit);
}
const findAll = (tree, predicate) => {
  const out = [];
  walk(tree, (node) => predicate(node) && out.push(node));
  return out;
};
const textOf = (tree) => {
  const parts = [];
  const collect = (node) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (typeof node === "string") return parts.push(node);
    if (node && typeof node === "object") collect(node.props?.children);
  };
  collect(tree);
  return parts.join("|");
};
const settle = () => React.act(async () => new Promise((resolve) => setImmediate(resolve)));

async function mount(t, api) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__routeFactsRefreshes;
  });
  globalThis.__routeFactsRefreshes = 0;
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock(
      {
        cachePrefix: "loqui-support-models-test-",
        mockModules: {
          "/stores/routeFactsStore":
            "export function refreshRouteFacts() { globalThis.__routeFactsRefreshes += 1; return Promise.resolve(); }",
        },
      },
      { withOptions: true }
    )
  );
  const Component = (await vite.ssrLoadModule("/components/settings/LocalSupportModels.tsx"))
    .default;
  let tree;
  function Probe() {
    tree = Component();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  const row = (kind) =>
    findAll(tree, (n) => n.props?.label === `personal.supportModels.${kind}`)[0];
  const button = (kind) => findAll(row(kind), (n) => typeof n.props?.onClick === "function")[0];
  return { tree: () => tree, row, button };
}
const status = (over = {}) => ({
  getDiarizationModelStatus: async () => ({ available: true, modelsDownloaded: false }),
  getSearchModelStatus: async () => ({ downloaded: true }),
  downloadDiarizationModels: async () => ({ success: true }),
  downloadSearchModel: async () => ({ success: true }),
  ...over,
});

test("support models", async (t) => {
  await t.test("nothing says Download until main has answered", async (t) => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const h = await mount(
      t,
      status({ getDiarizationModelStatus: () => gate.then(() => ({ modelsDownloaded: true })) })
    );
    assert.match(textOf(h.row("meeting")), /settingsPage\.llms\.supportModels\.checking/);
    assert.equal(h.button("meeting"), undefined);
    release();
    await settle();
    assert.match(textOf(h.row("meeting")), /settingsPage\.llms\.supportModels\.downloaded/);
  });
  await t.test("sizes, device ring and locality status", async (t) => {
    const h = await mount(t, status());
    await settle();
    assert.match(textOf(h.row("meeting")), /supportModels\.download\{"size":"34\.8 MB"\}/);
    assert.equal(h.button("search"), undefined);
    const done = findAll(h.row("search"), (n) => /downloaded$/.test(String(n.props?.children)))[0];
    assert.match(done.props.className, /\btext-locality-device\b/);
    assert.doesNotMatch(done.props.className, /text-success/);
    const ring = findAll(h.tree(), (n) => n.props?.locality === "device")[0];
    assert.equal(ring.props.label, "locality.device");
    assert.doesNotMatch(textOf(h.tree()), /localModels\.ready/);
  });
  await t.test("the embedding model is announced at about 91 MB", async (t) => {
    const h = await mount(t, status({ getSearchModelStatus: async () => ({ downloaded: false }) }));
    await settle();
    assert.match(textOf(h.row("search")), /supportModels\.download\{"size":"91 MB"\}/);
  });
  await t.test("a finished download refreshes route facts", async (t) => {
    const h = await mount(t, status());
    await settle();
    assert.equal(globalThis.__routeFactsRefreshes, 0);
    await React.act(async () => h.button("meeting").props.onClick());
    await settle();
    assert.equal(globalThis.__routeFactsRefreshes, 1);
    assert.match(textOf(h.row("meeting")), /settingsPage\.llms\.supportModels\.downloaded/);
  });
  await t.test("a failed download keeps the button and does not refresh", async (t) => {
    const h = await mount(
      t,
      status({ downloadDiarizationModels: async () => ({ success: false, error: "disk full" }) })
    );
    await settle();
    await React.act(async () => h.button("meeting").props.onClick());
    await settle();
    assert.equal(globalThis.__routeFactsRefreshes, 0);
    assert.ok(h.button("meeting"));
    assert.match(textOf(findAll(h.tree(), (n) => n.props?.role === "alert")[0]), /disk full/);
  });
  await t.test("a failing status read shows the error and still offers downloads", async (t) => {
    const h = await mount(
      t,
      status({
        getSearchModelStatus: async () => {
          throw new Error("ipc down");
        },
      })
    );
    await settle();
    assert.ok(h.button("meeting"));
    assert.ok(h.button("search"));
    assert.match(textOf(findAll(h.tree(), (n) => n.props?.role === "alert")[0]), /ipc down/);
  });
});
