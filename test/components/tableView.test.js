const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { resolveTokens } = require("../helpers/harness/cssTokens");
const READY = {
  locality: "remote",
  providerId: "openai",
  model: "fixture",
  state: { status: "ready" },
};
async function render(t, file, name, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-table-chrome-"));
  const mod = await vite.ssrLoadModule(file);
  return renderToStaticMarkup(React.createElement(mod[name], props));
}
test("Inbox offers draggable keyboard buttons and discloses bounded recent tray with full history", async (t) => {
  const html = await render(t, "/components/table/TableInbox.tsx", "TableInbox", {
    entities: [
      { ref: { type: "dictation", id: 9 }, kind: "dictation", excerpt: "Remind me to send it" },
    ],
    onPlace() {},
  });
  assert.match(html, /<aside[^>]*aria-label="table.inbox.title"/);
  assert.match(html, /<button[^>]*draggable="true"[^>]*data-ref="dictation:9"/);
  assert.match(html, /Remind me/);
  const en = JSON.parse(fs.readFileSync("src/locales/en/translation.json", "utf8")).table;
  assert.match(en.inbox.description, /50/);
  assert.match(en.inbox.description, /History and List/);
});
test("empty Inbox is explicit", async (t) => {
  assert.match(
    await render(t, "/components/table/TableInbox.tsx", "TableInbox", {
      entities: [],
      onPlace() {},
    }),
    /table.inbox.empty/
  );
});
for (const state of ["ready", "unknown", "needsKey", "unreachable"])
  test(`selection route ${state} disclosed before AI, with local group retained`, async (t) => {
    const html = await render(t, "/components/table/TableSelectionBar.tsx", "TableSelectionBar", {
      count: 3,
      busy: false,
      route: {
        ...READY,
        state:
          state === "needsKey"
            ? { status: state, provider: "OpenAI" }
            : state === "unreachable"
              ? { status: state, detail: "sealed" }
              : { status: state },
      },
      onSummarise() {},
      onAsk() {},
      onGroup() {},
      onRemove() {},
    });
    assert.match(html, /role="toolbar"/);
    assert.doesNotMatch(html, /delete/i);
    for (const key of ["summarise", "ask", "group", "remove"])
      assert.match(html, new RegExp("table.selection." + key));
    const buttons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
    assert.equal(
      buttons
        .find((b) => b[2].includes("table.selection.summarise"))[1]
        .match(/\sdisabled(?:=|\s|$)/) !== null,
      state !== "ready"
    );
    assert.equal(
      buttons
        .find((b) => b[2].includes("table.selection.group"))[1]
        .match(/\sdisabled(?:=|\s|$)/) !== null,
      false
    );
    if (state === "ready") assert.match(html, /data-locality="remote"/);
  });
test("over12 and busy states give disabled actions and explanation", async (t) => {
  for (const [count, busy, key] of [
    [13, false, "limit"],
    [2, true, "busy"],
  ]) {
    const html = await render(t, "/components/table/TableSelectionBar.tsx", "TableSelectionBar", {
      count,
      busy,
      route: READY,
      onSummarise() {},
      onAsk() {},
      onGroup() {},
      onRemove() {},
    });
    assert.match(html, /<button[^>]*disabled/);
    assert.match(html, new RegExp("table.selection." + key));
  }
});
test("Table CSS uses readable shared type, logical chrome and contrasting borders/text", async () => {
  const css = fs.readFileSync("src/index.css", "utf8");
  assert.match(css, /\.table-toolbar\s*\{/);
  const block = css.slice(css.indexOf(".table-view {"));
  assert.doesNotMatch(block, /font-size:\s*\d|\b\d+ms\b/);
  assert.match(block, /font-size:\s*var\(--text-caption\)/);
  assert.match(block, /inset-inline-start/);
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(css);
  for (const theme of [light, dark])
    for (const bg of ["--color-card", "--color-popover", "--color-background"]) {
      assert.ok(contrastRatio(theme["--color-muted-foreground"], theme[bg]) >= 4.5);
      assert.ok(contrastRatio(theme["--color-table-card-border"], theme[bg]) >= 3);
      assert.ok(contrastRatio(theme["--color-ai-text"], theme[bg]) >= 4.5);
    }
});
test("all11 table locale keys, placeholders, CLDR categories and preservation disclosure match", () => {
  const langs = ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
  const { flatten, validateFragment } = require("../../scripts/merge-locale-keys");
  const fragment = {};
  for (const lang of langs) {
    fragment[lang] = {
      table: JSON.parse(fs.readFileSync(path.join("src/locales", lang, "translation.json"), "utf8"))
        .table,
    };
    assert.ok(fragment[lang].table);
    const flat = flatten(fragment[lang]);
    for (const key of [
      "table.canvasLabel",
      "table.zoomLevel",
      "table.selection.count",
      "table.selection.limit",
      "table.ask.pinned",
    ])
      assert.match(flat[key], /\{\{/);
    assert.ok(new Intl.PluralRules(lang).resolvedOptions().pluralCategories.includes("other"));
  }
  assert.deepEqual(validateFragment(fragment, langs), []);
});
