const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

// Mounted-behaviour pattern from personalWorkspace.test.js: the selector is called
// as a function inside a probe that returns null; handler props are invoked under
// React.act. In React 19 a host element's ref is a prop, so the test hands each
// radio a fake element whose focus() is recorded, which is what makes arrow-key
// focus observable without a DOM.
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

const modes = [
  { id: "providers", label: "Cloud", description: "Send audio to a provider", icon: null },
  { id: "local", label: "Local", description: "Stay on this device", icon: null },
  {
    id: "self-hosted",
    label: "Self-hosted",
    description: "Your server",
    icon: null,
    disabled: true,
    badge: "Soon",
  },
  { id: "enterprise", label: "Enterprise", description: "Your cloud account", icon: null },
];

async function mount(t, getProps) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-mode-selector-test-" })
  );
  const { InferenceModeSelector } = await vite.ssrLoadModule("/components/ui/SettingsSection.tsx");
  let tree;
  function Probe() {
    tree = InferenceModeSelector(getProps());
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  const focused = [];
  const group = () => findAll(tree, (n) => n.props?.role === "radiogroup")[0];
  const radios = () => findAll(tree, (n) => n.props?.role === "radio");
  const attach = () =>
    radios().forEach((radio, i) => radio.props.ref({ focus: () => focused.push(modes[i].id) }));
  attach();
  const press = async (index, key) => {
    let prevented = false;
    await React.act(async () =>
      radios()[index].props.onKeyDown({ key, preventDefault: () => (prevented = true) })
    );
    attach();
    return prevented;
  };
  const tabStops = () =>
    radios()
      .map((r, i) => (r.props.tabIndex === 0 ? modes[i].id : null))
      .filter(Boolean);
  return { tree: () => tree, group, radios, press, focused, tabStops };
}

test("[change-driving] mode selector", async (t) => {
  await t.test(
    "[change-driving] it is a named radio group with one tab stop on the checked radio",
    async (t) => {
      const h = await mount(t, () => ({
        label: "Dictation runs on",
        modes,
        activeMode: "local",
        onSelect() {},
      }));
      assert.equal(h.group().props["aria-label"], "Dictation runs on");
      assert.equal(h.radios().length, 4);
      assert.deepEqual(
        h.radios().map((r) => r.props["aria-checked"]),
        [false, true, false, false]
      );
      assert.deepEqual(h.tabStops(), ["local"]);
      assert.equal(h.radios()[2].props["aria-disabled"], true);
    }
  );

  await t.test(
    "[change-driving] arrows move focus and the tab stop, skip disabled radios, wrap, and never select",
    async (t) => {
      const chosen = [];
      const h = await mount(t, () => ({
        label: "x",
        modes,
        activeMode: "local",
        onSelect: (id) => chosen.push(id),
      }));
      assert.equal(await h.press(1, "ArrowDown"), true);
      assert.deepEqual(h.focused, ["enterprise"], "self-hosted is disabled and skipped");
      assert.deepEqual(h.tabStops(), ["enterprise"], "the tab stop follows focus");
      await h.press(3, "ArrowDown");
      assert.equal(h.focused.at(-1), "providers", "wraps");
      await h.press(0, "End");
      assert.equal(h.focused.at(-1), "enterprise");
      await h.press(3, "Home");
      assert.equal(h.focused.at(-1), "providers");
      await h.press(0, "ArrowUp");
      assert.equal(h.focused.at(-1), "enterprise");
      assert.deepEqual(chosen, [], "choosing a mode changes a route, so arrows only move focus");
    }
  );

  await t.test("[change-driving] other keys are left alone", async (t) => {
    const h = await mount(t, () => ({ label: "x", modes, activeMode: "local", onSelect() {} }));
    assert.equal(await h.press(1, "Tab"), false);
    assert.equal(await h.press(1, "a"), false);
    assert.deepEqual(h.focused, []);
  });

  await t.test(
    "[change-driving] leaving the group returns the tab stop to the checked radio",
    async (t) => {
      const h = await mount(t, () => ({ label: "x", modes, activeMode: "local", onSelect() {} }));
      await h.press(1, "ArrowDown");
      assert.deepEqual(h.tabStops(), ["enterprise"]);
      await React.act(async () =>
        h.group().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
      );
      assert.deepEqual(h.tabStops(), ["local"]);
    }
  );

  await t.test(
    "[change-driving] a click chooses an enabled mode; a disabled one does nothing",
    async (t) => {
      const chosen = [];
      const h = await mount(t, () => ({
        label: "x",
        modes,
        activeMode: "local",
        onSelect: (id) => chosen.push(id),
      }));
      await React.act(async () => h.radios()[0].props.onClick());
      await React.act(async () => h.radios()[2].props.onClick());
      assert.deepEqual(chosen, ["providers"]);
    }
  );

  await t.test(
    "[change-driving] a staged mode is checked while the applied one is labelled Current",
    async (t) => {
      const h = await mount(t, () => ({
        label: "x",
        modes,
        activeMode: "local",
        stagedMode: "providers",
        routeState: { status: "needsModel", sizeBytes: 680000000 },
        onSelect() {},
      }));
      assert.deepEqual(
        h.radios().map((r) => r.props["aria-checked"]),
        [true, false, false, false]
      );
      assert.deepEqual(h.tabStops(), ["providers"]);
      const local = textOf(h.radios()[1]);
      assert.match(local, /routes\.selection\.current/);
      const chip = findAll(h.radios()[1], (n) => n.props?.state)[0];
      assert.equal(chip.props.state.status, "needsModel");
      assert.match(textOf(h.radios()[0]), /routes\.selection\.staged/);
      assert.doesNotMatch(textOf(h.tree()), /common\.active/);
    }
  );

  await t.test("[change-driving] the route chip shows beside Current only", async (t) => {
    const h = await mount(t, () => ({
      label: "x",
      modes,
      activeMode: "local",
      routeState: { status: "ready" },
      onSelect() {},
    }));
    assert.equal(findAll(h.tree(), (n) => n.props?.state).length, 1);
  });

  await t.test(
    "[change-driving] descriptions and marks hold contrast on hover and tint (I13)",
    async (t) => {
      const h = await mount(t, () => ({ label: "x", modes, activeMode: "local", onSelect() {} }));
      const desc = findAll(h.tree(), (n) => n.type === "p")[0];
      // muted-foreground at 80% over the hovered row is 4.46:1 in light; full strength is 7.36:1.
      assert.match(desc.props.className, /\btext-muted-foreground\b(?!\/)/);
      const dots = findAll(
        h.radios()[1],
        (n) => n.props?.["aria-hidden"] === "true" && /rounded-full/.test(n.props.className ?? "")
      );
      assert.match(
        dots[0].props.className,
        /border-ring bg-ring/,
        "the selected mark uses the ring token, not solid primary (2.9:1 on hover)"
      );
    }
  );

  await t.test("[change-driving] markup carries radio semantics server-side too", async (t) => {
    installBrowserGlobals(t);
    const vite = await createRendererServer(
      t,
      withI18nMock({ cachePrefix: "loqui-mode-selector-ssr-" })
    );
    const { InferenceModeSelector } = await vite.ssrLoadModule(
      "/components/ui/SettingsSection.tsx"
    );
    const html = renderToStaticMarkup(
      React.createElement(InferenceModeSelector, {
        label: "Dictation runs on",
        modes,
        activeMode: "local",
        onSelect() {},
      })
    );
    assert.match(html, /role="radiogroup"[^>]*aria-label="Dictation runs on"/);
    assert.equal((html.match(/role="radio"/g) ?? []).length, 4);
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  });
});
