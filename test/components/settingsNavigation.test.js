const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");
const loadKeys = () => import("../../src/components/ui/providerTabsKeys.ts");

test("the settings sidebar marks the current section and shows keyboard focus", () => {
  const modal = read("src/components/ui/SidebarModal.tsx");
  assert.match(modal, /<nav\s+aria-label=\{title\}/);
  assert.match(modal, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(modal, /aria-label=\{isCompact \? item\.label : undefined\}/);
  assert.match(modal, /outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset/);
  assert.match(modal, /opacity-40[^\"]*focus-visible:opacity-100/, "the close button restores full opacity while focused");
  assert.doesNotMatch(modal, /ring-ring\/\d+/, "the close button's ring is full opacity too (Task 3)");
});

test("arrow keys move between enabled tabs and wrap", async () => {
  const { nextEnabledTabIndex } = await loadKeys();
  const disabled = [false, true, false, false];
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowRight", "ltr"), 2, "skips disabled");
  assert.equal(nextEnabledTabIndex(disabled, 3, "ArrowRight", "ltr"), 0, "wraps");
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowLeft", "ltr"), 3);
  assert.equal(nextEnabledTabIndex(disabled, 2, "Home", "ltr"), 0);
  assert.equal(nextEnabledTabIndex(disabled, 0, "End", "ltr"), 3);
  assert.equal(nextEnabledTabIndex(disabled, 0, "Enter", "ltr"), null, "Enter is activation");
  assert.equal(nextEnabledTabIndex([true, true], 0, "ArrowRight", "ltr"), null);
});

test("RTL swaps Left and Right", async () => {
  const { nextEnabledTabIndex } = await loadKeys();
  const disabled = [false, false, false];
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowLeft", "rtl"), 1);
  assert.equal(nextEnabledTabIndex(disabled, 0, "ArrowRight", "rtl"), 2);
});

test("arrow keys only move focus; selection stays an explicit activation", () => {
  const tabs = read("src/components/ui/ProviderTabs.tsx");
  const handler = tabs.match(/const handleKeyDown = [\s\S]*?\n {2}\};/)[0];
  assert.match(handler, /\.focus\(\)/);
  assert.doesNotMatch(handler, /onSelect/);
});

test("provider tabs render as a tablist with one tab stop", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-provider-tabs-"));
  const { ProviderTabs } = await vite.ssrLoadModule("/components/ui/ProviderTabs.tsx");
  const html = renderToStaticMarkup(
    createElement(ProviderTabs, {
      providers: [
        { id: "openai", name: "OpenAI", keySaved: true },
        { id: "groq", name: "Groq", disabled: true, disabledLabel: "Soon" },
        { id: "anthropic", name: "Anthropic" },
      ],
      selectedId: "anthropic",
      onSelect() {},
    })
  );
  assert.match(html, /role="tablist"/);
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 3);
  assert.match(tabs[2], /aria-selected="true"/);
  assert.match(tabs[2], /tabindex="0"/);
  assert.match(tabs[0], /aria-selected="false"/);
  assert.match(tabs[0], /tabindex="-1"/);
  assert.match(tabs[1], /disabled=""/);
  assert.match(html, /<span class="sr-only">personal\.keyConfigured<\/span>/);
});
