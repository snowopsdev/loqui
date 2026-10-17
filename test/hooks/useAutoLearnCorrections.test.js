const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("two mounts of the auto-learn switch stay in step and tell main (mounted, change-driving)", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const bus = new EventTarget();
  const toMain = [];
  const { storage } = installBrowserGlobals(t, {
    window: {
      electronAPI: { setAutoLearnEnabled: (enabled) => toMain.push(enabled) },
      addEventListener: bus.addEventListener.bind(bus),
      removeEventListener: bus.removeEventListener.bind(bus),
      dispatchEvent: bus.dispatchEvent.bind(bus),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-auto-learn-test-" });
  const { useAutoLearnCorrections } = await vite.ssrLoadModule("/hooks/useAutoLearnCorrections.ts");

  let settings;
  let dictionary;
  function Probe() {
    settings = useAutoLearnCorrections();
    dictionary = useAutoLearnCorrections();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));

  assert.deepEqual([settings[0], dictionary[0]], [true, true], "on by default");
  assert.equal(
    storage.getItem("autoLearnCorrections"),
    "true",
    "the default is persisted for direct readers"
  );

  await React.act(async () => dictionary[1](false));
  assert.deepEqual([settings[0], dictionary[0]], [false, false], "the other mount follows");
  assert.equal(storage.getItem("autoLearnCorrections"), "false");
  assert.equal(toMain.at(-1), false, "main is told");

  await React.act(async () => settings[1](true));
  assert.deepEqual([settings[0], dictionary[0]], [true, true]);
  assert.equal(toMain.at(-1), true);
});
