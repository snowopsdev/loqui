const assert = require("node:assert/strict");
const test = require("node:test");
const { React } = require("../helpers/harness/reactSsr");
const { createRoot } = require("react-dom/client");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { installTree } = require("../helpers/harness/fakeDomTree");

// T14-M3 and final review m4: the update alert follows the failure's phase
// ("Nothing was sent" only for a refusal), it does not outlive the seal, and
// Check for Updates follows the renderer's sealed store as well as main's
// update status. Mounted under the tsx loader with react-dom's createRoot and
// the shared fake DOM; no renderer server.

const status = (over = {}) => ({
  phase: "idle",
  enabled: true,
  channel: "stable",
  version: "1.0.0",
  busy: false,
  supported: true,
  releasesUrl: "https://github.com/example/loqui/releases",
  sealed: false,
  ...over,
});
const flush = () =>
  React.act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  });

async function mount(t, { current = status(), check, sealed = false } = {}) {
  const seal = { listeners: new Set(), value: sealed };
  const statusListeners = new Set();
  const updates = {
    status: () => Promise.resolve(current),
    onStatus: (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    preferences: () => Promise.resolve(current),
    check: () => (check ? check() : Promise.resolve(current)),
    restart: () => Promise.resolve(),
  };
  const privacy = {
    getSealed: () => Promise.resolve(seal.value),
    onSealedChange: (cb) => {
      seal.listeners.add(cb);
      return () => seal.listeners.delete(cb);
    },
    onAttestation: () => () => {},
  };
  // Unmount before the browser globals are restored (hooks run in order).
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI: { updates, privacy } } });
  installHookDom(t);
  const tree = installTree();
  const store = await import("../../src/stores/sealedStore.ts");
  store._resetSealedStoreForTests();
  t.after(() => store._resetSealedStoreForTests());
  const mod = await import("../../src/components/settings/UpdateSettings.tsx");
  // The tsx loader may wrap a TSX module's default export once more.
  const UpdateSettings = mod.default?.default ?? mod.default;
  root = createRoot(tree.container);
  await React.act(async () => root.render(React.createElement(UpdateSettings)));
  await flush();
  const button = (label) =>
    tree.find((node) => node.tagName === "BUTTON" && node.textContent === label);
  // Primitives only: never hand a DOM node to an assertion (a failing message
  // would inspect the whole fake tree).
  const alert = () => tree.find((node) => node.attributes?.role === "alert")?.textContent ?? null;
  return {
    tree,
    button,
    alert,
    async click(label) {
      await React.act(async () => tree.props(button(label)).onClick());
      await flush();
    },
    async setStatus(next) {
      current = next;
      await React.act(async () => [...statusListeners].forEach((cb) => cb(next)));
      await flush();
    },
    async setSealed(value) {
      seal.value = value;
      await React.act(async () => [...seal.listeners].forEach((cb) => cb(value)));
      await flush();
    },
  };
}

test("an interrupted update check never says 'Nothing was sent'", async (t) => {
  const ui = await mount(t, {
    check: () =>
      Promise.reject(
        new Error("Error invoking remote method 'update:check': Error: [SEALED_MODE:interrupted] x")
      ),
  });
  await ui.click("updates.check");
  assert.equal(ui.alert(), "sealedMode.interrupted.generic");
  assert.equal(ui.tree.text().includes("updates.sealedRefused"), false);
  assert.equal(ui.tree.text().includes("SEALED_MODE"), false);
});

test("a refused check still says so; the alert clears once Sealed mode is off", async (t) => {
  const ui = await mount(t, {
    check: () =>
      Promise.reject(
        new Error("Error invoking remote method 'update:check': Error: [SEALED_MODE] x")
      ),
  });
  await ui.click("updates.check");
  assert.equal(ui.alert(), "updates.sealedRefused");
  // Main's status catches up: sealed. The refusal stays true while sealed.
  await ui.setStatus(status({ sealed: true }));
  assert.equal(ui.alert(), "updates.sealedRefused");
  // Unsealed: "Sealed mode is on, so Loqui didn't…" would now be false.
  await ui.setStatus(status({ sealed: false }));
  assert.equal(ui.alert(), null, "the sealed alert is gone after unsealing");
});

test("the alert also clears when the renderer's sealed store turns off", async (t) => {
  const ui = await mount(t, {
    sealed: true,
    check: () => Promise.reject(new Error("[SEALED_MODE] x")),
  });
  // Status says unsealed (stale), but the store says sealed: Check is disabled.
  assert.equal(ui.tree.props(ui.button("updates.check")).disabled, true);
  await ui.setSealed(false);
  assert.equal(ui.tree.props(ui.button("updates.check")).disabled, false);
  await ui.click("updates.check");
  assert.equal(ui.alert(), "updates.sealedRefused");
  await ui.setSealed(true);
  await ui.setSealed(false);
  assert.equal(ui.alert(), null);
});

test("the sealed store alone disables Check for Updates and Restart", async (t) => {
  const ui = await mount(t, {
    current: status({ phase: "ready", availableVersion: "1.2.0" }),
    sealed: true,
  });
  assert.equal(ui.tree.props(ui.button("updates.restart")).disabled, true);
  assert.ok(ui.tree.text().includes("updates.sealed"), "the sealed note shows too");
});
