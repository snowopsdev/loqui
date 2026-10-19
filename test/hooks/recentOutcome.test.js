const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("outcome beats expire and replacement/null/expired inputs cannot retain an old beat", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-recent-outcome-" });
  const { useRecentOutcome } = await vite.ssrLoadModule("/hooks/useRecentOutcome.ts");
  let outcome = null,
    recent;
  function Harness() {
    recent = useRecentOutcome(outcome, 50);
    return null;
  }
  root = createRoot(container);
  const render = async (next) => {
    outcome = next;
    await React.act(async () => root.render(React.createElement(Harness)));
  };
  const first = { kind: "pasted", words: 19, at: Date.now() };
  await render(first);
  assert.equal(recent, first);
  await render(null);
  assert.equal(recent, null);
  await render({ kind: "failed", at: Date.now() - 100 });
  assert.equal(recent, null);
  const next = { kind: "failed", at: Date.now() };
  await render(next);
  assert.equal(recent, next);
  await React.act(async () => new Promise((r) => setTimeout(r, 75)));
  assert.equal(recent, null);
});
