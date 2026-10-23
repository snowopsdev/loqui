const assert = require("node:assert/strict");
const test = require("node:test");
const { React, renderStatic } = require("../helpers/harness/reactSsr");

const load = () => import("../../src/components/ui/DataRetentionNotice.tsx");

test("the retention notice uses the warning icon and tokens, not a text glyph or raw amber", async () => {
  const { DataRetentionNotice } = await load();
  const { createInstance } = require("i18next");
  const { I18nextProvider } = require("react-i18next");
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: require("../../src/locales/en/translation.json") } },
  });
  const key = "controlPanel.history.dataRetentionDisabled";
  const html = renderStatic(
    I18nextProvider,
    { i18n },
    React.createElement(DataRetentionNotice, { messageKey: key, className: "mb-3" })
  );
  assert.ok(html.includes(i18n.t(key)));
  assert.match(html, /text-ui text-foreground/);
  assert.match(html, /mb-3/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /<svg[^>]*class="[^"]*text-warning/);
  assert.match(html, /border-warning\/30/);
  assert.doesNotMatch(html, /⊘|amber-/);
  assert.match(html, /role="status"/);
});
