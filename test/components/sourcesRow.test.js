const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("sources are 28px chips with numeral, kind and title; uncited ones have no numeral", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-sources-row-" });
  const { SourcesRow } = await vite.ssrLoadModule("/components/chat/SourcesRow.tsx");
  const html = renderToStaticMarkup(
    createElement(SourcesRow, {
      sources: [
        {
          n: 1,
          noteId: 38,
          title: "Pricing review",
          kind: "meeting",
          date: "2026-10-09",
          quote: "so Thursday, not Monday",
        },
        { n: null, noteId: 5, title: "Product catch-up", kind: "note", date: null, quote: "" },
      ],
    })
  );
  assert.match(html, /data-sources/);
  assert.match(html, /h-7/);
  assert.match(html, /text-agent-text[^>]*>1</);
  assert.match(html, /data-kind="meeting"[\s\S]*Pricing review/);
  assert.doesNotMatch(html, /text-agent-text[^>]*>(null|undefined)</);
});

test("source summary copy covers local CLDR categories in all eleven locales", () => {
  for (const locale of ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"]) {
    const copy = require(`../../src/locales/${locale}/translation.json`).agentMode.tools;
    for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
      assert.equal(typeof copy[`summary_${category}`], "string", `${locale}: ${category}`);
      assert.match(copy[`summary_${category}`], /\{\{count\}\}/);
    }
  }
});
