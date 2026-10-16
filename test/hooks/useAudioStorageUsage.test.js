const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function mountUsage(t, electronAPI) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-audio-usage-" });
  const { useAudioStorageUsage } = await vite.ssrLoadModule("/hooks/useAudioStorageUsage.ts");
  const api = {};
  function Harness() {
    Object.assign(api, useAudioStorageUsage(true));
    return null;
  }
  // Each act yields a macrotask so the async IPC reads settle before asserting.
  const run = (fn) =>
    React.act(async () => {
      await fn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  root = createRoot(container);
  await run(() => root.render(React.createElement(Harness)));
  return { api, run };
}

test("an unreadable first read is unavailable, not empty", async (t) => {
  const h = await mountUsage(t, {
    getAudioStorageUsage: async () => ({ fileCount: 0, totalBytes: 0, readable: false }),
  });
  assert.deepEqual(h.api.usage, { status: "unavailable" });
});

test("a rejected read is unavailable", async (t) => {
  const h = await mountUsage(t, {
    getAudioStorageUsage: async () => {
      throw new Error("ipc down");
    },
  });
  assert.deepEqual(h.api.usage, { status: "unavailable" });
});

test("a failed refresh after a good count does not keep the stale count", async (t) => {
  let readable = true;
  const h = await mountUsage(t, {
    getAudioStorageUsage: async () =>
      readable
        ? { fileCount: 4, totalBytes: 900, readable: true }
        : { fileCount: 0, totalBytes: 0, readable: false },
  });
  assert.deepEqual(h.api.usage, { status: "known", fileCount: 4, totalBytes: 900 });
  readable = false;
  await h.run(() => h.api.refresh());
  assert.deepEqual(h.api.usage, { status: "unavailable" });
});

test("clearing reports partial when files survive or the store cannot be re-read", async (t) => {
  let after = { fileCount: 0, totalBytes: 0, readable: true };
  const h = await mountUsage(t, {
    getAudioStorageUsage: async () => after,
    deleteAllAudio: async () => ({ deleted: 2, failed: 1, readable: true }),
  });
  let outcome;
  await h.run(async () => {
    outcome = await h.api.clearAll();
  });
  assert.equal(outcome, "partial", "a failed unlink is never 'cleared'");
  after = { fileCount: 0, totalBytes: 0, readable: false };
  await h.run(async () => {
    outcome = await h.api.clearAll();
  });
  assert.equal(outcome, "partial");
  assert.deepEqual(h.api.usage, { status: "unavailable" });
});
