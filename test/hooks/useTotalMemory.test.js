const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function read(t, electronAPI) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-total-memory-test-" });
  const { useTotalMemory } = await vite.ssrLoadModule("/hooks/useTotalMemory.ts");
  let value = "unset";
  function Probe() {
    value = useTotalMemory();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  await React.act(async () => new Promise((resolve) => setImmediate(resolve)));
  return value;
}

test("total memory is the number main reports (change-driving)", async (t) => {
  assert.equal(await read(t, { getTotalMemory: async () => 17179869184 }), 17179869184);
});

test("an unavailable reading is null, so the grid makes no fit claim (change-driving)", async (t) => {
  assert.equal(await read(t, {}), null);
});

test("a failing IPC call is null (change-driving)", async (t) => {
  assert.equal(
    await read(t, {
      getTotalMemory: async () => {
        throw new Error("no ipc");
      },
    }),
    null
  );
});

test("nonsense readings are null (change-driving)", async (t) => {
  assert.equal(await read(t, { getTotalMemory: async () => 0 }), null);
});
