const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const i18next = require("i18next");
const { initReactI18next } = require("react-i18next");
const { renderStatic } = require("../helpers/harness/reactSsr");

async function load() {
  if (!i18next.isInitialized) {
    const en = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8")
    );
    await i18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
  }
  return import("../../src/components/ui/editor/SlashMenu.tsx");
}

test("groups render headers, AI rows carry the machine glyph, disabled rows explain why", async () => {
  const { SlashMenu } = await load();
  const html = renderStatic(SlashMenu, {
    command: () => {},
    items: [
      { id: "h1", group: "text", label: "Heading 1", keywords: [] },
      {
        id: "action-1",
        group: "ai",
        label: "Generate Notes",
        keywords: [],
        actionId: 1,
        disabledReason: "Actions need an AI model",
      },
      { id: "timestamp", group: "insert", label: "Time stamp", keywords: [] },
    ],
  });
  assert.match(html, /role="listbox"/);
  for (const header of [">Text<", ">AI<", ">Insert<"]) assert.ok(html.includes(header), header);
  assert.match(html, /aria-disabled="true"[\s\S]*Actions need an AI model/);
  assert.match(html, /text-ai/);
  assert.match(html, /aria-selected="true"[^>]*>[\s\S]*Heading 1/);
});

test("no match says so instead of vanishing", async () => {
  const { SlashMenu } = await load();
  assert.match(renderStatic(SlashMenu, { items: [], command: () => {} }), /No blocks match/);
});

test("disabled explanations and group headers use readable full-opacity tokens", async () => {
  const { SlashMenu } = await load();
  const html = renderStatic(SlashMenu, {
    command: () => {},
    items: [
      {
        id: "action-1",
        group: "ai",
        label: "Generate Notes",
        keywords: [],
        disabledReason: "Checking the notes model…",
      },
    ],
  });
  assert.doesNotMatch(html, /opacity-60|text-micro/);
  assert.match(html, /cursor-not-allowed/);
  assert.match(html, /text-caption[^"]*text-muted-foreground/);
  assert.doesNotMatch(html, /tabindex|<button/);
});

test("mounted menu wraps arrows, resets filtering, consumes disabled choices and picks with Tab", async (t) => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
  const { installTree } = require("../helpers/harness/fakeDomTree");
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  installHookDom(t);
  const tree = installTree();
  const { SlashMenu } = await load();
  const ref = React.createRef();
  const picked = [];
  root = createRoot(tree.container);
  const disabled = {
    id: "action-1",
    group: "ai",
    label: "Generate Notes",
    keywords: [],
    disabledReason: "Checking…",
  };
  const enabled = { id: "timestamp", group: "insert", label: "Time stamp", keywords: [] };
  const render = (items) =>
    React.act(async () =>
      root.render(
        React.createElement(SlashMenu, { items, command: (item) => picked.push(item.id), ref })
      )
    );
  const press = async (key) => {
    let handled;
    await React.act(async () => {
      handled = ref.current.onKeyDown({ key });
    });
    return handled;
  };
  await render([disabled, enabled]);
  let scrolled = 0;
  tree.find((n) => n.attributes.role === "listbox").querySelector = () => ({
    scrollIntoView: (options) => {
      assert.equal(options.block, "nearest");
      scrolled += 1;
    },
  });
  assert.equal(await press("Enter"), true);
  assert.deepEqual(picked, []);
  const option = tree.find((n) => n.attributes["aria-disabled"] === "true");
  await React.act(async () => tree.props(option).onClick());
  assert.deepEqual(picked, []);
  await press("ArrowUp");
  assert.ok(scrolled > 0, "the newly selected row stays visible");
  await press("Tab");
  assert.deepEqual(picked, ["timestamp"]);
  await press("ArrowDown");
  await press("Enter");
  assert.deepEqual(picked, ["timestamp"]);
  await render([enabled]);
  await press("Enter");
  assert.deepEqual(picked, ["timestamp", "timestamp"]);
  await render([]);
  assert.equal(await press("Enter"), false);
  assert.match(tree.text(), /No blocks match/);
});
