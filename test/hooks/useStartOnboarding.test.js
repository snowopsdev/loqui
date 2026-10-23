const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function mountHook(t, { preview = false, initialStorage = {} } = {}) {
  let root, start;
  const events = [];
  let reloads = 0;
  const listeners = new Set();
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const { storage } = installBrowserGlobals(t, {
    initialStorage,
    window: {
      loquiBrowserPreview: preview,
      dispatchEvent(event) {
        events.push(event);
        for (const cb of listeners) cb(event);
      },
      addEventListener(_type, cb) {
        listeners.add(cb);
      },
      removeEventListener(_type, cb) {
        listeners.delete(cb);
      },
      location: {
        reload() {
          reloads++;
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-start-onboarding-" });
  const api = await vite.ssrLoadModule("/hooks/useStartOnboarding.ts");
  function Harness({ handler }) {
    start = api.useStartOnboarding();
    api.useStartOnboardingListener(handler ?? (() => {}));
    return null;
  }
  root = createRoot(container);
  const render = (handler) =>
    React.act(async () =>
      root.render(
        React.createElement(React.StrictMode, null, React.createElement(Harness, { handler }))
      )
    );
  await render();
  return {
    api,
    events,
    storage,
    listeners,
    render,
    start: (step) => start(step),
    reloads: () => reloads,
    unmount: () =>
      React.act(async () => {
        root.unmount();
        root = null;
      }),
  };
}

test("restarting setup happens in-app with no reload, cloud switch, credentials or route mutation", async (t) => {
  const hook = await mountHook(t, {
    initialStorage: {
      onboardingCompleted: "true",
      transcriptionMode: "local",
      useLocalWhisper: "true",
      credentialSentinel: "fixture",
      "loqui.onboarding.progress": "saved",
    },
  });
  hook.start({ type: "click" });
  assert.equal(hook.reloads(), 0, "a direct click caller preserves the renderer lifetime");
  assert.equal(hook.events.length, 1);
  assert.equal(hook.events[0].type, "loqui:start-onboarding");
  assert.equal(hook.events[0].detail.step, undefined);
  assert.equal(hook.storage.getItem("onboardingCompleted"), null);
  assert.equal(hook.storage.getItem("pendingCloudMigration"), null);
  for (const [k, v] of Object.entries({
    transcriptionMode: "local",
    useLocalWhisper: "true",
    credentialSentinel: "fixture",
    "loqui.onboarding.progress": "saved",
  }))
    assert.equal(hook.storage.getItem(k), v);
});
test("step deep-links, nonsteps resume and preview never touches desktop completion/progress", async (t) => {
  const hook = await mountHook(t, {
    preview: true,
    initialStorage: {
      onboardingCompleted: "true",
      "loqui.onboarding.progress": "desktop",
      "loqui.onboarding.preview.linux.ready": "preview",
    },
  });
  for (const step of ["cleanup", { type: "click" }, "nonsense", "try"]) hook.start(step);
  assert.equal(hook.reloads(), 0);
  assert.deepEqual(
    hook.events.map((e) => e.detail.step),
    ["cleanup", undefined, undefined, "try"]
  );
  assert.equal(hook.storage.getItem("onboardingCompleted"), "true");
  assert.equal(hook.storage.getItem("loqui.onboarding.progress"), "desktop");
  assert.equal(hook.storage.getItem("loqui.onboarding.preview.linux.ready"), "preview");
});
test("listener validates hostile details, uses current handler and unsubscribes under StrictMode", async (t) => {
  const hook = await mountHook(t);
  const first = [],
    current = [];
  await hook.render((step) => first.push(step));
  assert.equal(hook.listeners.size, 1);
  const listener = [...hook.listeners][0];
  await hook.render((step) => current.push(step));
  assert.equal([...hook.listeners][0] === listener, true, "stable subscription");
  for (const detail of [
    { step: "speech" },
    { step: "nonsense" },
    { step: { type: "click" } },
    null,
    undefined,
  ])
    globalThis.window.dispatchEvent(new CustomEvent("loqui:start-onboarding", { detail }));
  assert.deepEqual(first, []);
  assert.deepEqual(current, ["speech", undefined, undefined, undefined, undefined]);
  await hook.unmount();
  assert.equal(hook.listeners.size, 0);
});
