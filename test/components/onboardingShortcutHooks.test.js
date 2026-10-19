const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { rendererOptions } = require("../helpers/harness/rendererMocks");
const { bridgeFixture } = require("../helpers/harness/onboardingBridgeFixture");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
async function hook(t, api, name, { strict = false, initial = "F7" } = {}) {
  let root, current;
  const renders = [];
  t.after(() => root && React.act(async () => root.unmount()));
  installBrowserGlobals(t, { window: { electronAPI: api } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, rendererOptions("shortcut-hooks-"));
  const mod = await vite.ssrLoadModule(
    name === "demo" ? "/components/onboarding/useDictationHotkey.ts" : "/hooks/useHotkeyModeInfo.ts"
  );
  function Harness({ value }) {
    current =
      name === "demo" ? mod.useShortcutDemo(value) : mod.useHotkeyModeInfo("dictation", value);
    if (name !== "demo") renders.push({ value, ...current });
    return null;
  }
  root = createRoot(container);
  const render = async (value) =>
    React.act(async () =>
      root.render(
        React.createElement(
          strict ? React.StrictMode : React.Fragment,
          null,
          React.createElement(Harness, { value })
        )
      )
    );
  await render(name === "demo" ? true : initial);
  return {
    value: () => current,
    renders,
    render,
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
  };
}

test("capabilities are unknown for B immediately, late B cannot replace C, and reasons/Hyprland data survive", async (t) => {
  const a = deferred(),
    b = deferred(),
    c = deferred();
  const pending = { F7: a, F8: b, F9: c };
  const h = await hook(
    t,
    {
      getHotkeyModeInfo: (key) => pending[key].promise,
      getHyprlandConfigStatus: async () => ({ canWrite: false, path: "fixture" }),
    },
    "mode"
  );
  await React.act(async () =>
    a.resolve({
      supportsPushToTalk: true,
      isUsingNativeShortcut: true,
      isUsingHyprland: false,
      pushToTalkUnavailableReason: null,
    })
  );
  assert.equal(h.value().loaded, true);
  await h.render("F8");
  assert.equal(h.value().loaded, false, "loaded A cannot authorize B");
  assert.equal(
    h.renders.find((render) => render.value === "F8").loaded,
    false,
    "even the first B render masks A"
  );
  await h.render("F9");
  await React.act(async () =>
    c.resolve({
      supportsPushToTalk: false,
      isUsingNativeShortcut: false,
      isUsingHyprland: true,
      pushToTalkUnavailableReason: "hyprland",
    })
  );
  await React.act(async () => b.resolve({ supportsPushToTalk: true }));
  assert.equal(h.value().loaded, true);
  assert.equal(h.value().supportsPushToTalk, false);
  assert.equal(h.value().pushToTalkUnavailableReason, "hyprland");
  assert.deepEqual(h.value().hyprlandConfigStatus, { canWrite: false, path: "fixture" });
});
for (const [label, api] of Object.entries({
  missing: {},
  reject: {
    getHotkeyModeInfo: async () => {
      throw new Error("fixture rejection");
    },
  },
  unknown: { getHotkeyModeInfo: async () => undefined },
  unsupported: { getHotkeyModeInfo: async () => ({ supportsPushToTalk: false }) },
})) {
  test(`capability ${label} never authorizes push`, async (t) => {
    const h = await hook(t, api, "mode");
    assert.equal(h.value().loaded && h.value().supportsPushToTalk, false);
  });
}

test("shortcut demo uses actual preload/main mirroring, excludes capture, and ends only its own identity", async (t) => {
  const f = bridgeFixture();
  f.manager.hotkeyManager.slots = new Map([["dictation", { hotkeys: ["F7"], callback() {} }]]);
  f.manager._cachedActivationMode = "tap";
  const events = [];
  f.setupApi.onDictationHotkeyEvent((event) => events.push(event));
  const h = await hook(t, f.setupApi, "demo");
  const id = f.context._onboardingDemoSession.id;
  assert.equal(f.manager._onboardingDemoKind, "shortcut");
  f.setListening(true);
  assert.equal(f.manager.reportDictationHotkey("down", "F7"), false);
  f.setListening(false);
  assert.equal(f.manager.reportDictationHotkey("tap", "F7"), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].binding.hotkey, "F7");
  assert.equal(events[0].binding.activationMode, "tap");
  assert.equal(await f.setupApi.toggleOnboardingDemo(id), false);
  await f.setupApi.beginOnboardingDemo({ id: "new-owner", kind: "dictation" });
  await h.unmount();
  assert.equal(f.context._onboardingDemoSession.id, "new-owner");
  assert.equal(
    f.sent.some(([name]) => /^(start|toggle)-dictation$/.test(name)),
    false
  );
});

test("delayed begin, StrictMode replay and leave/reenter have unique matching teardown", async (t) => {
  const f = bridgeFixture();
  const begins = [],
    ends = [],
    pending = [];
  const api = {
    ...f.setupApi,
    beginOnboardingDemo: (session) => {
      begins.push(session);
      const d = deferred();
      pending.push(d);
      const ok = f.setupApi.beginOnboardingDemo(session);
      return d.promise.then(() => ok);
    },
    endOnboardingDemo: (id) => {
      ends.push(id);
      return f.setupApi.endOnboardingDemo(id);
    },
  };
  const h = await hook(t, api, "demo", { strict: true });
  assert.equal(begins.length, 2);
  assert.equal(new Set(begins.map((x) => x.id)).size, 2);
  await React.act(async () => pending[0].resolve());
  assert.equal(
    f.context._onboardingDemoSession.id,
    begins[1].id,
    "late old end preserves newer main owner"
  );
  await h.render(false);
  await h.render(true);
  assert.equal(begins.length, 3);
  await React.act(async () => pending[1].resolve());
  assert.equal(f.context._onboardingDemoSession.id, begins[2].id);
  await h.unmount();
  await React.act(async () => pending[2].resolve());
  assert.equal(f.context._onboardingDemoSession, null);
  assert.deepEqual([...ends].sort(), begins.map((x) => x.id).sort());
});
for (const result of [false, undefined, "reject", "throw"])
  test(`shortcut demo handles ${result} begin and rejected teardown`, async (t) => {
    const ends = [],
      begins = [];
    const h = await hook(
      t,
      {
        beginOnboardingDemo: (session) => {
          begins.push(session.id);
          if (result === "throw") throw Error("fixture");
          return result === "reject" ? Promise.reject(Error("fixture")) : Promise.resolve(result);
        },
        endOnboardingDemo: (id) => {
          ends.push(id);
          return Promise.reject(Error("fixture end"));
        },
      },
      "demo"
    );
    await h.unmount();
    assert.deepEqual(ends, begins);
  });
for (const missing of ["beginOnboardingDemo", "endOnboardingDemo"])
  test(`shortcut demo does not start without ${missing}`, async (t) => {
    let calls = 0;
    const api = {
      beginOnboardingDemo: async () => {
        calls++;
        return true;
      },
      endOnboardingDemo: async () => true,
    };
    delete api[missing];
    const h = await hook(t, api, "demo");
    await h.unmount();
    assert.equal(calls, 0);
  });

test("current capability answers pass through the real main handler, including unsupported B", async (t) => {
  const f = bridgeFixture();
  let available = true;
  f.manager.isUsingNativeShortcutHotkeys = () => process.platform === "win32" && !available;
  f.manager.hotkeyManager.supportsPushToTalk = () => available;
  f.manager.isUsingGnomeHotkeys = () => false;
  f.manager.isUsingHyprlandHotkeys = () => false;
  f.manager.isUsingKDEHotkeys = () => false;
  f.manager.hotkeyManager.getPushToTalkUnavailableReason = () => "fixture-unavailable";
  f.context.linuxKeyManager = { isAvailable: () => available };
  const asked = [];
  const h = await hook(
    t,
    {
      getHotkeyModeInfo: (key) => {
        asked.push(key);
        return f.handlers.get("get-hotkey-mode-info")({ sender: f.setupSender }, key);
      },
    },
    "mode"
  );
  assert.equal(h.value().loaded, true);
  assert.equal(h.value().supportsPushToTalk, true);
  available = false;
  await h.render("F8");
  assert.equal(h.value().loaded, true);
  assert.equal(h.value().supportsPushToTalk, false);
  assert.equal(h.value().pushToTalkUnavailableReason, "fixture-unavailable");
  assert.deepEqual(asked, ["F7", "F8"]);
});

test("a deferred A answer never replaces the loaded current B capability", async (t) => {
  const a = deferred(),
    b = deferred();
  const h = await hook(
    t,
    { getHotkeyModeInfo: (key) => (key === "F7" ? a.promise : b.promise) },
    "mode"
  );
  await h.render("F8");
  await React.act(async () =>
    b.resolve({ supportsPushToTalk: true, pushToTalkUnavailableReason: null })
  );
  assert.equal(h.value().loaded, true);
  await React.act(async () =>
    a.resolve({ supportsPushToTalk: false, pushToTalkUnavailableReason: "old-A" })
  );
  assert.equal(h.value().loaded, true);
  assert.equal(h.value().supportsPushToTalk, true);
  assert.equal(h.value().pushToTalkUnavailableReason, null);
});
