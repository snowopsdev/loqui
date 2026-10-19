const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer } = require("../lib/rendererTestHarness");
const Icon = () => null;
async function render(t, props) {
  const vite = await createRendererServer(t);
  const { MetricCard } = await vite.ssrLoadModule("/components/insights/MetricCard.tsx");
  return renderToStaticMarkup(React.createElement(MetricCard, { icon: Icon, ...props }));
}
test("a tile with a destination is a labelled native button with canonical focus", async (t) => {
  const html = await render(t, {
    label: "Dictations",
    value: "214",
    detail: "this year",
    onSelect() {},
    selectLabel: "Show dictations in History",
  });
  assert.match(html, /^<button type="button" aria-label="Show dictations in History"/);
  assert.match(html, /focus-visible:ring-2 focus-visible:ring-ring/);
});
test("metadata is full secondary colour at caption size and static cards stay divs", async (t) => {
  const html = await render(t, {
    label: "Words",
    value: "12,840",
    detail: "≈ 5.4 hours of typing",
    largeValue: true,
  });
  assert.match(html, /^<div/);
  assert.match(html, /text-caption text-muted-foreground">≈ 5\.4 hours/);
  assert.match(html, /text-3xl/);
  assert.doesNotMatch(html, /text-\[11px\]|muted-foreground\/70|tabindex/);
});
