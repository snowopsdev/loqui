const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/components/ui/Toast.tsx"),
  "utf8"
);

async function renderToast(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, rendererOptions("loqui-toast-live-region-"));
  const { Toast } = await vite.ssrLoadModule("/components/ui/Toast.tsx");
  return renderToStaticMarkup(
    createElement(Toast, {
      id: "1",
      title: "Saved",
      description: "Your note was saved.",
      presentation: "standard",
      duration: 3500,
      createdAt: 0,
      isExiting: false,
      onClose() {},
      onPauseTimer() {},
      onResumeTimer() {},
      ...props,
    })
  );
}

test("a standard toast is a polite status region", async (t) => {
  const html = await renderToast(t, { variant: "default" });
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
});

test("a destructive toast is an assertive alert", async (t) => {
  const html = await renderToast(t, { variant: "destructive", title: "Couldn't save" });
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-live="assertive"/);
});

test("the close button is visible at rest, full strength on hover or focus, and named", async (t) => {
  const html = await renderToast(t, { variant: "default" });
  const close = html.match(/<button type="button" class="([^"]*-start-2[^"]*)"/);
  assert.ok(close, "close is a type=button");
  assert.match(close[1], /\bopacity-50\b/);
  assert.match(close[1], /group-hover:opacity-100/);
  assert.match(close[1], /focus-visible:opacity-100/);
  assert.doesNotMatch(close[1], /\bopacity-0\b/);
  assert.match(close[1], /focus-visible:ring-2 focus-visible:ring-ring/, "full-opacity ring (Task 3)");
  assert.doesNotMatch(close[1], /ring-white\/\d+/);
  assert.match(html, /<span class="sr-only">common\.close<\/span>/);
});

test("no hard-coded English accessible names remain", () => {
  assert.doesNotMatch(source, /aria-label="Copy error"/);
  assert.doesNotMatch(source, /<span className="sr-only">Close<\/span>/);
  assert.match(source, /aria-label=\{t\("common\.copy"\)\}/);
});
