const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function mountProfile(t, api) {
  let root;
  const unmount = async () => {
    if (root) {
      const r = root;
      root = null;
      await React.act(async () => r.unmount());
    }
  };
  t.after(unmount);
  // Concrete missing IPC, deliberately no permissive proxy (R9).
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const old = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["fr-FR", "en-US"] });
  t.after(() =>
    old ? Object.defineProperty(navigator, "languages", old) : delete navigator.languages
  );
  const container = installHookDom(t);
  const vite = await createRendererServer(t);
  const { useSystemProfile } = await vite.ssrLoadModule(
    "/components/onboarding/useSystemProfile.ts"
  );
  let current,
    renders = 0;
  function Harness() {
    current = useSystemProfile();
    renders++;
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return { read: () => current, renders: () => renders, unmount };
}

for (const boundary of ["no bridge", "absent", "undefined", "rejected"]) {
  test(`profile uses navigator locales and honest unknown hardware with ${boundary} IPC`, async (t) => {
    const method =
      boundary === "undefined"
        ? async () => undefined
        : boundary === "rejected"
          ? async () => {
              throw new Error("unavailable");
            }
          : undefined;
    const ui = await mountProfile(
      t,
      boundary === "no bridge"
        ? undefined
        : boundary === "absent"
          ? {}
          : { getSystemProfile: method, getTotalMemory: method }
    );
    assert.deepEqual(ui.read(), {
      locales: ["fr-FR", "en-US"],
      freeDiskBytes: null,
      gpu: { kind: "unknown", name: null },
      totalMemoryBytes: null,
    });
  });
}

test("profile composes facts with the shared memory IPC once and ignores unrelated fields", async (t) => {
  const calls = [];
  const ui = await mountProfile(t, {
    getSystemProfile: async () => {
      calls.push("facts");
      return {
        locales: ["ja-JP"],
        freeDiskBytes: 412e6,
        gpu: { kind: "nvidia", name: "Fixture GPU" },
      };
    },
    getTotalMemory: async () => {
      calls.push("memory");
      return 16e9;
    },
  });
  assert.deepEqual(calls.sort(), ["facts", "memory"]);
  assert.equal(ui.read().totalMemoryBytes, 16e9);
  assert.deepEqual(ui.read().locales, ["ja-JP"]);
  assert.equal(ui.read().freeDiskBytes, 412e6);
});

test("late profile facts cannot update an unmounted owner", async (t) => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const ui = await mountProfile(t, {
    getSystemProfile: () => pending,
    getTotalMemory: async () => 16e9,
  });
  assert.equal(ui.read(), null);
  await ui.unmount();
  const before = ui.renders();
  await React.act(async () =>
    resolve({ locales: ["en-US"], freeDiskBytes: 1e9, gpu: { kind: "unknown", name: null } })
  );
  assert.equal(ui.renders(), before);
  assert.equal(ui.read(), null);
});

for (const memory of [0, -1, NaN, Infinity, "16GB"]) {
  test(`invalid memory ${memory} remains unknown`, async (t) => {
    const ui = await mountProfile(t, { getTotalMemory: async () => memory });
    assert.equal(ui.read().totalMemoryBytes, null);
  });
}
