// test/hooks/useSetupIncomplete.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("setup is incomplete unless the flag is exactly true, and storage errors fail closed", async () => {
  const { isSetupIncomplete } = await import("../../src/hooks/useSetupIncomplete.ts");
  assert.equal(isSetupIncomplete({ getItem: () => null }), true);
  assert.equal(isSetupIncomplete({ getItem: () => "false" }), true);
  assert.equal(isSetupIncomplete({ getItem: () => "true" }), false);
  assert.equal(
    isSetupIncomplete({
      getItem: () => {
        throw new Error("denied");
      },
    }),
    true
  );
});

test("the overlay leaves trial mode the moment setup completes in the other window", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const listeners = new Map();
  const { storage } = installBrowserGlobals(t, {
    window: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-setup-incomplete-test-" });
  const { useSetupIncomplete } = await vite.ssrLoadModule("/hooks/useSetupIncomplete.ts");
  let value;
  function Harness() {
    value = useSetupIncomplete();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  assert.equal(value, true);
  storage.setItem("onboardingCompleted", "true");
  await React.act(async () => listeners.get("storage")({ key: "onboardingCompleted" }));
  assert.equal(value, false);
  storage.removeItem("onboardingCompleted");
  await React.act(async () => listeners.get("storage")({ key: null }));
  assert.equal(value, true, "restarting setup re-enters trial mode");
});

test("the overlay recorder is wired to trial mode (either useAudioRecording signature)", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../src/App.jsx"), "utf8");
  assert.match(source, /const setupIncomplete = useSetupIncomplete\(\);/);
  assert.match(source, /useAudioRecording\((?:toast, )?\{[\s\S]*?trialMode: setupIncomplete,/);
});

test("absent storage and a denied storage getter both fail closed", async () => {
  const { isSetupIncomplete } = await import("../../src/hooks/useSetupIncomplete.ts");
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    delete globalThis.localStorage;
    assert.equal(isSetupIncomplete(), true);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage denied");
      },
    });
    assert.equal(isSetupIncomplete(), true);
  } finally {
    delete globalThis.localStorage;
    if (original) Object.defineProperty(globalThis, "localStorage", original);
  }
});
