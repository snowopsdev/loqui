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

const GB = 1_000_000_000;

// Mounted-behaviour pattern from personalWorkspace.test.js. The grid is called as
// a function inside a probe that returns null and its handler props are invoked
// under React.act. In React 19 a host element's ref is an ordinary prop, so each
// radio gets a fake element whose focus() is recorded: that is what makes
// keyboard focus observable without a DOM. Sorted and collapsed, the first five
// cards are: qwen-2b (recommended), qwen-4b, qwen-9b, extra0, extra1.
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

const models = [
  {
    id: "qwen-2b",
    name: "Qwen3.5 2B",
    sizeBytes: 1.3 * GB,
    contextLength: 262144,
    recommended: true,
    isDownloaded: true,
    isDownloading: false,
  },
  {
    id: "qwen-4b",
    name: "Qwen3.5 4B",
    sizeBytes: 2.7 * GB,
    contextLength: 262144,
    isDownloaded: true,
    isDownloading: false,
  },
  {
    id: "qwen-9b",
    name: "Qwen3.5 9B",
    sizeBytes: 5.5 * GB,
    isDownloaded: false,
    isDownloading: true,
    progress: 42,
  },
  {
    id: "extra0",
    name: "Extra 0",
    sizeBytes: 6 * GB,
    isDownloaded: false,
    isDownloading: false,
    href: "https://example.test/card",
    hrefLabel: "Model card",
  },
  {
    id: "extra1",
    name: "Extra 1",
    sizeBytes: 7 * GB,
    isDownloaded: false,
    isDownloading: true,
    progress: 90,
    isInstalling: true,
  },
  { id: "extra2", name: "Extra 2", sizeBytes: 8 * GB, isDownloaded: false, isDownloading: false },
  { id: "extra3", name: "Extra 3", sizeBytes: 9 * GB, isDownloaded: false, isDownloading: false },
  { id: "big", name: "Huge 70B", sizeBytes: 40 * GB, isDownloaded: false, isDownloading: false },
];
const SHOWN = ["qwen-2b", "qwen-4b", "qwen-9b", "extra0", "extra1"];

async function mount(t, over = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-cartridge-test-" }, { withOptions: true })
  );
  const { ModelCartridgeGrid } = await vite.ssrLoadModule("/components/ui/ModelCartridgeGrid.tsx");
  const calls = { select: [], download: [], cancel: [], delete: [] };
  const props = () => ({
    label: "Language model",
    models,
    selectedId: "qwen-2b",
    totalMemoryBytes: 16 * GB,
    usedBy: { "qwen-2b": ["Chat", "Cleanup"], "qwen-4b": ["Translation"] },
    onSelect: (id) => calls.select.push(id),
    onDownload: (id) => calls.download.push(id),
    onCancel: (id) => calls.cancel.push(id),
    onDelete: (id) => calls.delete.push(id),
    ...over,
  });
  let tree;
  function Probe() {
    tree = ModelCartridgeGrid(props());
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  const focused = [];
  const group = () => findAll(tree, (n) => n.props?.role === "radiogroup")[0];
  const radios = () => findAll(tree, (n) => n.props?.role === "radio");
  const actions = () => findAll(tree, (n) => n.props?.["data-model-action"]);
  const ids = () => radios().map((r) => r.props["data-model"]);
  const attach = () =>
    radios().forEach((radio) =>
      radio.props.ref({ focus: () => focused.push(radio.props["data-model"]) })
    );
  attach();
  const key = async (node, k) => {
    let prevented = false;
    await React.act(async () =>
      node.props.onKeyDown({ key: k, preventDefault: () => (prevented = true) })
    );
    attach();
    return prevented;
  };
  const radio = (id) => radios().find((r) => r.props["data-model"] === id);
  const action = (id) => actions().find((a) => a.props["data-model-action"] === id);
  const stops = () => ({
    radio: radios()
      .filter((r) => r.props.tabIndex === 0)
      .map((r) => r.props["data-model"]),
    action: actions()
      .filter((a) => a.props.tabIndex === 0)
      .map((a) => a.props["data-model-action"]),
  });
  return {
    tree: () => tree,
    group,
    radios,
    actions,
    ids,
    radio,
    action,
    key,
    stops,
    focused,
    calls,
  };
}

test("change-driving: cartridge grid", async (t) => {
  await t.test(
    "it is a radiogroup named for the task with one checked radio and one tab stop (change-driving)",
    async (t) => {
      const h = await mount(t);
      assert.equal(h.group().props["aria-label"], "Language model");
      assert.deepEqual(h.ids(), SHOWN, "Recommended first, then by size, collapsed to five");
      assert.deepEqual(
        h.radios().map((r) => r.props["aria-checked"]),
        [true, false, false, false, false]
      );
      assert.deepEqual(h.stops().radio, ["qwen-2b"]);
      assert.ok(
        h.radio("qwen-2b").props["aria-labelledby"] && h.radio("qwen-2b").props["aria-describedby"]
      );
    }
  );

  await t.test(
    "arrows move focus in a 2-column grid by row, clamp at the ends, and never select (change-driving)",
    async (t) => {
      const h = await mount(t);
      assert.equal(await h.key(h.radio("qwen-2b"), "ArrowRight"), true);
      assert.equal(h.focused.at(-1), "qwen-4b");
      await h.key(h.radio("qwen-4b"), "ArrowDown");
      assert.equal(
        h.focused.at(-1),
        "extra0",
        "down from the right column lands in the next row's right column"
      );
      await h.key(h.radio("extra0"), "ArrowDown");
      assert.equal(h.focused.at(-1), "extra1", "clamps to the last card in a short final row");
      assert.equal(
        await h.key(h.radio("extra1"), "ArrowDown"),
        false,
        "at the end the key is left to the page"
      );
      await h.key(h.radio("extra1"), "Home");
      assert.equal(h.focused.at(-1), "qwen-2b");
      await h.key(h.radio("qwen-2b"), "End");
      assert.equal(h.focused.at(-1), "extra1");
      await h.key(h.radio("qwen-9b"), "ArrowUp");
      assert.equal(h.focused.at(-1), "qwen-2b");
      assert.deepEqual(h.calls.select, [], "moving focus never changes a route");
      assert.deepEqual(h.calls.download, []);
    }
  );

  await t.test(
    "the tab stop follows focus and returns to the checked card when focus leaves (change-driving)",
    async (t) => {
      const h = await mount(t);
      await h.key(h.radio("qwen-2b"), "ArrowRight");
      assert.deepEqual(h.stops(), { radio: ["qwen-4b"], action: ["qwen-4b"] });
      await React.act(async () =>
        h.group().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null })
      );
      assert.deepEqual(h.stops(), { radio: ["qwen-2b"], action: ["qwen-2b"] });
      await React.act(async () =>
        h.group().props.onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} })
      );
      assert.deepEqual(h.stops().radio, ["qwen-2b"], "focus moving inside the grid keeps the stop");
    }
  );

  await t.test(
    "in right-to-left layouts left and right swap and rows still move down (M1, change-driving)",
    async (t) => {
      const h = await mount(t, { dir: "rtl" });
      assert.equal(h.group().props.dir, "rtl"); // Baseline markup assertion added after implementation.
      await h.key(h.radio("qwen-2b"), "ArrowLeft");
      assert.equal(h.focused.at(-1), "qwen-4b", "left is forward in RTL");
      await h.key(h.radio("qwen-4b"), "ArrowRight");
      assert.equal(h.focused.at(-1), "qwen-2b");
      await h.key(h.radio("qwen-2b"), "ArrowDown");
      assert.equal(h.focused.at(-1), "qwen-9b");
      assert.equal(
        await h.key(h.radio("qwen-2b"), "ArrowRight"),
        false,
        "right at the first card is a no-op in RTL"
      );
    }
  );

  await t.test(
    "Enter, Space and click choose a downloaded card; nothing else starts a download (change-driving)",
    async (t) => {
      const h = await mount(t);
      assert.equal(await h.key(h.radio("qwen-4b"), "Enter"), true);
      assert.equal(await h.key(h.radio("qwen-4b"), " "), true);
      await React.act(async () => h.radio("qwen-4b").props.onClick());
      assert.deepEqual(h.calls.select, ["qwen-4b", "qwen-4b", "qwen-4b"]);
      await h.key(h.radio("qwen-2b"), "Enter");
      assert.equal(h.calls.select.length, 3, "the checked card is not re-selected");
      await h.key(h.radio("extra0"), "Enter");
      await React.act(async () => h.radio("extra0").props.onClick());
      assert.deepEqual(
        h.calls.download,
        [],
        "a multi-gigabyte download starts only from its Download button"
      );
      assert.equal(h.radio("extra0").props["aria-disabled"], true);
      assert.equal(h.radio("qwen-4b").props["aria-disabled"], undefined);
    }
  );

  await t.test(
    "action buttons rove with the card: one tab stop, arrows leave them, native keys act (M1, change-driving)",
    async (t) => {
      const h = await mount(t);
      assert.deepEqual(
        h.actions().map((a) => a.props["data-model-action"]),
        SHOWN
      );
      assert.deepEqual(h.stops().action, ["qwen-2b"]);
      assert.equal(
        h.action("qwen-2b").props["aria-label"],
        'cartridge.delete{"name":"Qwen3.5 2B"}'
      );
      assert.equal(
        await h.key(h.action("qwen-2b"), "ArrowRight"),
        true,
        "an arrow from a button moves to the next card"
      );
      assert.equal(h.focused.at(-1), "qwen-4b");
      assert.deepEqual(h.stops().action, ["qwen-4b"]);
      await React.act(async () => h.action("extra0").props.onClick());
      await React.act(async () => h.action("qwen-2b").props.onClick());
      await React.act(async () => h.action("qwen-9b").props.onClick());
      assert.deepEqual(h.calls.download, ["extra0"]);
      assert.deepEqual(h.calls.delete, ["qwen-2b"]);
      assert.deepEqual(h.calls.cancel, ["qwen-9b"]);
      await React.act(async () => h.action("extra1").props.onClick());
      assert.equal(
        h.action("extra1").props.disabled,
        true,
        "cancel is disabled while the archive unpacks"
      );
    }
  );

  await t.test(
    "downloads report progress accessibly, with the fill measured from the inline start (change-driving)",
    async (t) => {
      const h = await mount(t);
      const bar = findAll(h.tree(), (n) => n.props?.role === "progressbar")[0];
      assert.equal(bar.props["aria-valuenow"], 42);
      const fill = findAll(bar, (n) => n.props?.style)[0];
      assert.deepEqual(fill.props.style, { inlineSize: "42%" });
    }
  );

  await t.test(
    "a model too large for this device cannot be downloaded and says why, at full contrast (change-driving)",
    async (t) => {
      const h = await mount(t, { selectedId: "big" });
      assert.ok(h.ids().includes("big"), "a collapsed grid keeps the checked card visible");
      const big = h.radio("big");
      assert.equal(big.props["aria-disabled"], true);
      assert.equal(h.action("big").props.disabled, true);
      const card = findAll(h.tree(), (n) => n.props?.["data-card"] === "big")[0];
      assert.doesNotMatch(
        card.props.className,
        /opacity-/,
        "dimming the card would drop the reason below 4.5:1"
      );
      assert.match(textOf(card), /cartridge\.tooLarge/);
    }
  );

  await t.test("show all toggles in place so focus is never lost (change-driving)", async (t) => {
    const h = await mount(t);
    const toggle = () => findAll(h.tree(), (n) => n.props?.["aria-expanded"] !== undefined)[0];
    assert.equal(toggle().props["aria-expanded"], false);
    assert.match(textOf(toggle()), /cartridge\.showAll\{"count":8\}/);
    await React.act(async () => toggle().props.onClick());
    assert.equal(h.ids().length, 8);
    assert.equal(toggle().props["aria-expanded"], true);
    assert.match(textOf(toggle()), /cartridge\.showFewer/);
  });

  await t.test(
    "only the Recommended card's Download is the default button; others are outline (Q9, change-driving)",
    async (t) => {
      const fresh = models.map((m) => ({
        ...m,
        isDownloaded: false,
        isDownloading: false,
        isInstalling: false,
      }));
      const h = await mount(t, { models: fresh });
      assert.equal(h.action("qwen-2b").props.variant, "default");
      assert.equal(h.action("extra0").props.variant, "outline");
      assert.equal(
        h.action("qwen-2b").props["aria-label"],
        'cartridge.downloadNamed{"name":"Qwen3.5 2B"}'
      );
    }
  );

  await t.test(
    "meters are words plus a value; context, links and in-use chips come from the model (change-driving)",
    async (t) => {
      const h = await mount(t);
      const meters = (id) =>
        findAll(h.radio(id), (n) => typeof n.props?.value === "number" && n.props?.label).map(
          (n) => [n.props.label, n.props.value]
        );
      assert.deepEqual(meters("qwen-2b"), [
        ["cartridge.speed", 4],
        ["cartridge.quality", 3],
        ["cartridge.memory", 1],
      ]);
      assert.match(
        textOf(h.radio("qwen-2b")),
        /1\.3 GB · cartridge\.context\{"k":256\}/,
        "262144 tokens reads as 256k"
      );
      const link = findAll(h.tree(), (n) => n.props?.href)[0];
      assert.equal(link.props.href, "https://example.test/card");
      assert.equal(link.props.tabIndex, -1, "links rove with their card too");
      const chips = (id) => textOf(findAll(h.tree(), (n) => n.props?.["data-card"] === id)[0]);
      assert.match(chips("qwen-2b"), /cartridge\.inUseBy\|Chat\|Cleanup/);
      assert.match(
        chips("qwen-4b"),
        /cartridge\.inUseBy\|Translation/,
        "in-use chips show on unchecked cards too"
      );
    }
  );

  await t.test(
    "change-driving FIX1: curated speed and quality retain disclosure for size-derived memory (M2)",
    async (t) => {
      const curated = models.map((m) => ({ ...m, speedTier: 5, qualityTier: 2 }));
      const h = await mount(t, { models: curated });
      assert.match(textOf(h.tree()), /cartridge\.estimate/);
      const memory = findAll(h.radio("qwen-9b"), (n) => n.props?.label === "cartridge.memory")[0];
      assert.equal(memory.props.value, 4, "5.5 GB memory remains a visible file-size estimate");
      const speed = findAll(h.radio("qwen-2b"), (n) => n.props?.label === "cartridge.speed")[0];
      const quality = findAll(h.radio("qwen-2b"), (n) => n.props?.label === "cartridge.quality")[0];
      assert.equal(speed.props.value, 5, "size alone would say 4");
      assert.equal(quality.props.value, 2, "size alone would say 3");
    }
  );

  await t.test(
    "baseline guard FIX1: an all-curated grid without known sizes has no visible estimated meter",
    async (t) => {
      const curated = models.map((m) => ({
        ...m,
        sizeBytes: undefined,
        speedTier: 5,
        qualityTier: 2,
      }));
      const h = await mount(t, { models: curated });
      assert.doesNotMatch(textOf(h.tree()), /cartridge\.estimate/);
      assert.equal(
        findAll(h.radio("qwen-2b"), (n) => n.props?.label === "cartridge.memory").length,
        0
      );
      assert.equal(
        findAll(h.radio("qwen-2b"), (n) => n.props?.label === "cartridge.speed")[0].props.value,
        5
      );
    }
  );

  await t.test("size-derived meters keep the estimate caption (baseline guard)", async (t) => {
    const h = await mount(t);
    assert.match(textOf(h.tree()), /cartridge\.estimate/);
  });
});

test("change-driving: cartridge grid markup", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-cartridge-ssr-" }, { withOptions: true })
  );
  const { ModelCartridgeGrid } = await vite.ssrLoadModule("/components/ui/ModelCartridgeGrid.tsx");
  const { renderToStaticMarkup } = require("react-dom/server");
  const html = renderToStaticMarkup(
    React.createElement(ModelCartridgeGrid, {
      label: "Language model",
      models,
      selectedId: "qwen-2b",
      totalMemoryBytes: 16 * GB,
      onSelect() {},
      onDownload() {},
    })
  );
  assert.match(
    html,
    /role="img"[^>]*aria-label="cartridge\.meter\{&quot;label&quot;:&quot;cartridge\.speed&quot;,&quot;value&quot;:4\}"/
  );
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="42"/);
});

// Source guard (M3): the shared Button carries its own duration, so the check
// reads the grid's source rather than its rendered markup.
test("change-driving: [source guard] the grid uses motion tokens and logical properties only", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/components/ui/ModelCartridgeGrid.tsx"),
    "utf8"
  );
  assert.doesNotMatch(source, /\bduration-\d+\b/, "literal Tailwind durations");
  assert.doesNotMatch(source, /\bdelay-\d+\b/);
  assert.match(source, /duration-\[var\(--motion-fast\)\]/);
  assert.match(
    source,
    /motion-safe:hover:-translate-y-px/,
    "the hover lift is gated for reduced motion"
  );
  assert.doesNotMatch(source, /\b(ml|mr|pl|pr|left|right)-(\d|\[)/, "physical spacing utilities");
  assert.doesNotMatch(
    source,
    /style=\{\{[^}]*\b(width|height|left|right|marginLeft|marginRight)\b/,
    "physical inline styles"
  );
});
