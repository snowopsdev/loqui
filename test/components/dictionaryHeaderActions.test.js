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

function findAll(node, predicate, out = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, predicate, out));
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  findAll(node.props?.children, predicate, out);
  return out;
}
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join("")
    : typeof node === "string"
      ? node
      : node && typeof node === "object"
        ? textOf(node.props?.children)
        : "";

test("[change-driving] dictionary actions have visible words and auto-learn is inline", async (t) => {
  let root;
  // Registered first so it runs before installBrowserGlobals removes `window` (personalWorkspace pattern).
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-dictionary-actions-test-" })
  );
  const { DictionaryHeaderActions } = await vite.ssrLoadModule(
    "/components/DictionaryHeaderActions.tsx"
  );
  const calls = [];
  const props = {
    onClearAll: () => calls.push("clear"),
    onExport: () => calls.push("export"),
    onImport: () => calls.push("import"),
    autoLearn: true,
    onAutoLearnChange: (value) => calls.push(`autoLearn:${value}`),
  };

  await t.test("change-driving: import and export are text buttons, not bare icons", () => {
    const html = renderToStaticMarkup(React.createElement(DictionaryHeaderActions, props));
    assert.match(html, />dictionary\.import</);
    assert.match(html, />dictionary\.exportAction</);
    assert.match(html, />dictionary\.clearAll</);
    assert.match(html, /role="switch"[^>]*aria-checked="true"/);
    assert.match(html, /settingsPage\.dictionary\.autoLearnTitle/);
  });

  await t.test("change-driving: each control calls its handler (mounted)", async () => {
    let tree;
    function Probe() {
      tree = DictionaryHeaderActions(props);
      return null;
    }
    root = createRoot(container);
    await React.act(async () => root.render(React.createElement(Probe)));
    const button = (label) =>
      findAll(tree, (n) => n.type === "button" && textOf(n).includes(label))[0];
    await React.act(async () => button("dictionary.import").props.onClick());
    await React.act(async () => button("dictionary.exportAction").props.onClick());
    await React.act(async () => button("dictionary.clearAll").props.onClick());
    const toggle = findAll(
      tree,
      (n) =>
        n.props?.["aria-label"] === "settingsPage.dictionary.autoLearnTitle" && n.props.onChange
    )[0];
    await React.act(async () => toggle.props.onChange(false));
    for (const label of ["dictionary.import", "dictionary.exportAction", "dictionary.clearAll"]) {
      const control = button(label);
      assert.equal(control.props.type, "button", "native keyboard activation remains available");
      assert.equal(control.props.onKeyDown, undefined, "no custom handler steals Enter or Space");
    }
    assert.deepEqual(calls, ["import", "export", "clear", "autoLearn:false"]);
  });

  await t.test(
    "[source guard, change-driving] every transition uses a shared --motion token (M3, R2-10)",
    () => {
      // Plan 01's index.css does not remap Tailwind's default transition duration (150ms) to a token,
      // so a bare `transition-*` class bypasses §4's shared motion tokens.
      const source = require("node:fs").readFileSync(
        require("node:path").join(__dirname, "../../src/components/DictionaryHeaderActions.tsx"),
        "utf8"
      );
      const transitions = source.match(/\btransition(?:-[a-z]+)?\b/g) ?? [];
      assert.ok(transitions.length > 0);
      const tokened = source.match(/duration-\[var\(--motion-(?:fast|base)\)\]/g) ?? [];
      assert.equal(
        tokened.length,
        transitions.length,
        "each transition carries a --motion duration"
      );
      assert.doesNotMatch(source, /\bduration-\d+\b/);
    }
  );
});
