const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/NoticeChip.tsx"),
  "utf8"
);
async function renderNotice(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-notice-live-region-"));
  const { NoticeChip } = await vite.ssrLoadModule("/components/ui/NoticeChip.tsx");
  return renderToStaticMarkup(
    createElement(NoticeChip, {
      stagger: 0,
      notice: {
        id: "1",
        kind: "receipt",
        title: "Saved",
        body: "Your note was saved.",
        createdAt: 0,
        expiresAt: 3500,
        remainingMs: null,
        revision: 1,
        busy: false,
        ...props,
      },
    })
  );
}
test("receipts and notices are polite status regions", async (t) => {
  for (const kind of ["receipt", "notice"]) {
    const html = await renderNotice(t, { kind });
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-atomic="true"/);
  }
});
test("alerts are assertive live regions", async (t) => {
  const html = await renderNotice(t, { kind: "alert", title: "Couldn't save" });
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-live="assertive"/);
});
test("close remains visible and has a localized accessible name and focus ring", async (t) => {
  const html = await renderNotice(t, {});
  assert.match(html, /aria-label="notices.dismiss"/);
  assert.match(html, /class="notice-chip__close"/);
  const css = fs.readFileSync(path.join(__dirname, "../../src/styles/notices.css"), "utf8");
  assert.match(css, /\.notice-chip__close\s*\{[^}]*opacity: 0\.7;/);
  assert.match(
    css,
    /\.notice-chip__close:hover[\s\S]*?\.notice-chip__close:focus-visible\s*\{[^}]*opacity: 1;/
  );
  assert.match(
    css,
    /\.notice-chip__close:focus-visible\s*\{[^}]*outline: 2px solid var\(--color-ring\)/
  );
  assert.doesNotMatch(source, /aria-label="Close"/);
});
