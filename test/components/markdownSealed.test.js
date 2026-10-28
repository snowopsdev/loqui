const assert = require("node:assert/strict");
const test = require("node:test");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { fakePrivacy, tick } = require("../hooks/fakePrivacy");

// Plan 07 Task 13: remote Markdown images stay inert unless main says the app
// is unsealed. Loopback images and links are unaffected.
const content = [
  "![chart](https://images.example/c.png)",
  "![](//cdn.example/protocol-relative.png)",
  "![local](http://127.0.0.1:8080/a.png)",
  "[docs](https://docs.example/x)",
].join(" ");

async function render(t, privacy) {
  installBrowserGlobals(t, { window: { electronAPI: privacy === undefined ? {} : { privacy } } });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-markdown-sealed-test-" });
  const store = await vite.ssrLoadModule("/stores/sealedStore.ts");
  store._resetSealedStoreForTests();
  t.after(() => store._resetSealedStoreForTests());
  store.subscribeSealed(() => {});
  await tick();
  const mod = await vite.ssrLoadModule("/components/ui/MarkdownRenderer.tsx");
  return renderToStaticMarkup(createElement(mod.default, { content }));
}

test("sealed: remote images are inert placeholders; loopback images and links stay", async (t) => {
  const html = await render(t, fakePrivacy({ sealed: true }).api);
  assert.doesNotMatch(html, /<img[^>]+images\.example/);
  assert.doesNotMatch(html, /<img[^>]+cdn\.example/, "protocol-relative is remote too");
  assert.equal((html.match(/data-sealed-image=""/g) ?? []).length, 2);
  // The renderer harness has no i18n resources: the placeholder shows its key.
  assert.match(html, /aria-label="sealedMode\.markdown\.imageBlockedNamed"/);
  assert.match(html, />sealedMode\.markdown\.imageBlocked</);
  assert.doesNotMatch(html, /<link[^>]+(images|cdn)\.example/, "no preload hint either");
  assert.match(html, /<img[^>]+127\.0\.0\.1/);
  assert.match(
    html,
    /<a[^>]+href="https:\/\/docs\.example\/x"/,
    "links still open through main's confirmation"
  );
});

test("unknown state: remote images stay inert, with checking copy", async (t) => {
  const html = await render(t, fakePrivacy({ pending: true }).api);
  assert.doesNotMatch(html, /<img[^>]+images\.example/);
  assert.match(html, /sealedMode\.markdown\.imageCheckingNamed/);
});

test("unsealed: remote images render", async (t) => {
  const html = await render(t, fakePrivacy({ sealed: false }).api);
  assert.match(html, /<img[^>]+images\.example/);
  assert.doesNotMatch(html, /data-sealed-image/);
});

test("a build without the privacy bridge is known unsealed (Plan 03's rule)", async (t) => {
  assert.match(await render(t, undefined), /<img[^>]+images\.example/);
});
