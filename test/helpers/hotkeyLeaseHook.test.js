const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

async function mount(t, apiOverrides = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const pending = [];
  const released = [];
  const listeners = new Map();
  const api = {
    acquirePillHotkey: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    releasePillHotkey: async (id) => {
      released.push(id);
    },
    ...Object.fromEntries(
      ["onPillHotkeyPressed", "onPillHotkeyReleased"].map((name) => [
        name,
        (callback) => {
          listeners.set(name, callback);
          return () => listeners.delete(name);
        },
      ])
    ),
    ...apiOverrides,
  };
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-hotkey-lease-hook-test-" });
  const { usePillHotkey } = await vite.ssrLoadModule("/hooks/usePillHotkey.ts");
  root = createRoot(container);
  let props = { slot: "undoCancel", enabled: true, onPress() {} };
  let value;
  function Harness() {
    value = usePillHotkey(props.slot, props.enabled, props.onPress);
    return null;
  }
  const render = async (next = {}) => {
    props = { ...props, ...next };
    await React.act(async () => root.render(React.createElement(Harness)));
  };
  await render();
  return {
    pending,
    released,
    listeners,
    render,
    held: () => value.held,
    emit: async (name, payload) => {
      await React.act(async () => listeners.get(name)?.(payload));
    },
    settle: async (result) => {
      await React.act(async () => pending.shift().resolve(result));
    },
  };
}

test("hook shows only held authority, uses current callbacks, and clears authority on main release", async (t) => {
  const f = await mount(t);
  let presses = 0;
  assert.equal(f.held(), false);
  await f.settle({ leaseId: 1, held: true });
  assert.equal(f.held(), true);
  await f.render({ onPress: () => presses++ });
  assert.equal(f.pending.length, 0, "callback updates do not churn leases");
  await f.emit("onPillHotkeyPressed", { slot: "undoCancel", leaseId: 2 });
  await f.emit("onPillHotkeyPressed", { slot: "undoCancel", leaseId: 1 });
  assert.equal(presses, 1);
  await f.emit("onPillHotkeyReleased", { slot: "undoCancel", leaseId: 1 });
  assert.equal(f.held(), false);
  await f.emit("onPillHotkeyPressed", { slot: "undoCancel", leaseId: 0 });
  assert.equal(presses, 1, "unassigned lease zero is never admitted");
});

test("hook releases a late acquire after disable and ignores stale completion after reenable", async (t) => {
  const f = await mount(t);
  await f.render({ enabled: false });
  assert.equal(f.held(), false);
  await f.render({ enabled: true });
  await f.settle({ leaseId: 1, held: true });
  assert.deepEqual(f.released, [1]);
  assert.equal(f.held(), false);
  await f.settle({ leaseId: 2, held: true });
  assert.equal(f.held(), true);
  await f.render({ enabled: false });
  assert.equal(f.held(), false);
  assert.deepEqual(f.released, [1, 2]);
  assert.equal(f.listeners.size, 0);
});

test("hook never revives a lease released before its acquisition IPC reply", async (t) => {
  const f = await mount(t);
  await f.emit("onPillHotkeyReleased", { slot: "undoCancel", leaseId: 3 });
  await f.settle({ leaseId: 3, held: true });
  assert.equal(f.held(), false);
});

test("hook tolerates a rejected acquire and missing preview capabilities", async (t) => {
  const f = await mount(t);
  await React.act(async () => f.pending.shift().reject(new Error("renderer unloading")));
  assert.equal(f.held(), false);
  await f.render({ enabled: false });
  globalThis.window.electronAPI = {};
  await f.render({ enabled: true });
  assert.equal(f.held(), false);
});
