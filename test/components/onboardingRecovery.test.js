const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { mountComponent } = require("../helpers/harness/mountComponent");

test("microphone status maps to three honest states", async (t) => {
  const vite = await createRendererServer(t);
  const { micAccessFrom } = await vite.ssrLoadModule(
    "/components/onboarding/useMicrophoneAccess.ts"
  );
  assert.equal(micAccessFrom({ granted: true, status: "granted" }), "granted");
  assert.equal(micAccessFrom({ granted: false, status: "not-determined" }), "unknown");
  assert.equal(micAccessFrom({ granted: false, status: "denied" }), "denied");
  assert.equal(micAccessFrom({ granted: false, status: "restricted" }), "denied");
  assert.equal(micAccessFrom(undefined), "unknown");
  assert.equal(micAccessFrom(null), "unknown");
  assert.equal(micAccessFrom({}), "unknown");
});

test("the recovery card is one alert with one sentence and its actions", async (t) => {
  const clicks = [];
  const ui = await mountComponent(t, "/components/onboarding/RecoveryCard.tsx", {
    exportName: "RecoveryCard",
    props: {
      title: "Loqui can't use your microphone",
      body: "Allow it in System Settings, then come back.",
      actions: [
        { label: "Open System Settings", onClick: () => clicks.push("open") },
        { label: "I've turned it on", onClick: () => clicks.push("recheck"), variant: "ghost" },
      ],
    },
  });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  assert.equal(
    ui.text().split("Allow it in System Settings").length - 1,
    1,
    "the cause is said once"
  );
  await ui.click("Open System Settings");
  await ui.click("I've turned it on");
  assert.deepEqual(clicks, ["open", "recheck"]);
});

test("re-checks on window focus and every 2 s while enabled, and stops when disabled", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const listeners = new Map();
  installBrowserGlobals(t, {
    window: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, { cachePrefix: "loqui-recheck-test-" });
  const { useRecheckOnFocus, RECHECK_POLL_MS } = await vite.ssrLoadModule(
    "/components/onboarding/useRecheckOnFocus.ts"
  );
  let checks = 0;
  function Harness({ enabled }) {
    useRecheckOnFocus(() => checks++, enabled);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness, { enabled: true })));
  listeners.get("focus")();
  t.mock.timers.tick(RECHECK_POLL_MS * 2);
  assert.equal(checks, 3);
  await React.act(async () => root.render(React.createElement(Harness, { enabled: false })));
  assert.equal(listeners.has("focus"), false);
  t.mock.timers.tick(RECHECK_POLL_MS * 3);
  assert.equal(checks, 3);
});

// These hook fixtures deliberately use concrete objects, never electronApiProxy.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function hookFixture(t, api, { strict = false } = {}) {
  let root;
  const unmount = async () => {
    if (!root) return;
    const current = root;
    root = null;
    await React.act(async () => current.unmount());
  };
  t.after(unmount);
  const listeners = new Map();
  const removed = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: api,
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        assert.equal(listeners.get(type), listener);
        listeners.delete(type);
        removed.push(type);
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t);
  const module = await vite.ssrLoadModule("/components/onboarding/useMicrophoneAccess.ts");
  let current;
  let renders = 0;
  function Harness() {
    current = module.useMicrophoneAccess();
    renders++;
    return null;
  }
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      strict
        ? React.createElement(React.StrictMode, null, React.createElement(Harness))
        : React.createElement(Harness)
    )
  );
  return { read: () => current, renders: () => renders, listeners, removed, unmount, ...module };
}

const statusCases = [
  ["denied", { granted: false, status: "denied" }, "denied"],
  ["restricted", { granted: false, status: "restricted" }, "denied"],
  ["granted", { granted: true, status: "granted" }, "granted"],
  ["not determined", { granted: false, status: "not-determined" }, "unknown"],
  ["empty result", undefined, "unknown"],
  ["missing grant", { status: "granted" }, "unknown"],
  ["unsupported status", { granted: false, status: "unsupported" }, "unknown"],
];
for (const [name, result, expected] of statusCases) {
  test(`actual microphone check: ${name}`, async (t) => {
    let calls = 0;
    const ui = await hookFixture(t, {
      checkMicrophoneAccess: async () => {
        calls++;
        return result;
      },
    });
    assert.equal(calls, 1, "mount checks once");
    assert.equal(ui.read().access, expected);
    await React.act(async () => ui.read().check());
    assert.equal(calls, 2, "explicit recheck uses the actual hook");
    assert.equal(ui.read().access, expected);
    assert.equal(ui.listeners.has("focus"), expected === "denied");
  });
}

for (const [name, api] of [
  ["absent bridge", undefined],
  ["absent methods", {}],
  [
    "explicit undefined methods",
    { checkMicrophoneAccess: undefined, requestMicrophoneAccess: undefined },
  ],
]) {
  test(`actual microphone check/request: ${name} stays unknown`, async (t) => {
    const ui = await hookFixture(t, api);
    assert.equal(ui.read().access, "unknown");
    await React.act(async () => ui.read().check());
    let granted;
    await React.act(async () => {
      granted = await ui.read().request();
    });
    assert.equal(granted, false);
    assert.equal(ui.read().access, "unknown");
    assert.equal(ui.listeners.has("focus"), false);
  });
}

for (const [name, result, access] of [
  ["granted", { granted: true }, "granted"],
  ["denied", { granted: false }, "denied"],
  ["empty", undefined, "unknown"],
]) {
  test(`actual microphone request: ${name}`, async (t) => {
    let requests = 0;
    const ui = await hookFixture(t, {
      checkMicrophoneAccess: async () => ({ granted: false, status: "not-determined" }),
      requestMicrophoneAccess: async () => {
        requests++;
        return result;
      },
    });
    assert.equal(requests, 0, "mount never requests permission");
    let granted;
    await React.act(async () => {
      granted = await ui.read().request();
    });
    assert.equal(requests, 1);
    assert.equal(granted, access === "granted");
    assert.equal(ui.read().access, access);
  });
}

test("failed checks and requests cannot retain a granted claim or reject in the background", async (t) => {
  let failCheck = true;
  const ui = await hookFixture(t, {
    checkMicrophoneAccess: async () => {
      if (failCheck) throw new Error("injected check rejection");
      return { granted: true, status: "granted" };
    },
    requestMicrophoneAccess: async () => {
      throw new Error("injected request rejection");
    },
  });
  assert.equal(ui.read().access, "unknown", "mount rejection settles safely");
  failCheck = false;
  await React.act(async () => ui.read().check());
  assert.equal(ui.read().access, "granted");
  failCheck = true;
  await React.act(async () => ui.read().check());
  assert.equal(ui.read().access, "unknown");
  let granted;
  await React.act(async () => {
    granted = await ui.read().request();
  });
  assert.equal(granted, false);
  assert.equal(ui.read().access, "unknown");
});

test("denied microphone rechecks on focus/poll, handles failures and cleans up after recovery", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let result = { granted: false, status: "denied" };
  let calls = 0;
  const ui = await hookFixture(t, {
    checkMicrophoneAccess: async () => {
      calls++;
      if (result instanceof Error) throw result;
      return result;
    },
  });
  await React.act(async () => ui.listeners.get("focus")());
  await React.act(async () => t.mock.timers.tick(2000));
  assert.equal(calls, 3);
  result = new Error("poll rejection");
  await React.act(async () => t.mock.timers.tick(2000));
  assert.equal(ui.read().access, "unknown");
  assert.equal(ui.listeners.has("focus"), false);
  result = { granted: false, status: "denied" };
  await React.act(async () => ui.read().check());
  result = { granted: true, status: "granted" };
  await React.act(async () => ui.listeners.get("focus")());
  assert.equal(ui.read().access, "granted");
  assert.equal(ui.listeners.has("focus"), false);
  const before = calls;
  t.mock.timers.tick(6000);
  assert.equal(calls, before);
});

for (const rejects of [false, true]) {
  test(`older pending mount check cannot overwrite newer request (${rejects ? "rejected" : "denied"})`, async (t) => {
    const old = deferred();
    const ui = await hookFixture(t, {
      checkMicrophoneAccess: () => old.promise,
      requestMicrophoneAccess: async () => ({ granted: true }),
    });
    await React.act(async () => ui.read().request());
    assert.equal(ui.read().access, "granted");
    await React.act(async () => {
      if (rejects) old.reject(new Error("stale check failure"));
      else old.resolve({ granted: false, status: "denied" });
    });
    assert.equal(ui.read().access, "granted");
  });
}

test("latest explicit check owns state over an older request and check", async (t) => {
  const oldCheck = deferred();
  const oldRequest = deferred();
  let checks = 0;
  const ui = await hookFixture(t, {
    checkMicrophoneAccess: () =>
      ++checks === 1 ? oldCheck.promise : Promise.resolve({ granted: false, status: "denied" }),
    requestMicrophoneAccess: () => oldRequest.promise,
  });
  let request;
  await React.act(async () => {
    request = ui.read().request();
  });
  await React.act(async () => ui.read().check());
  assert.equal(ui.read().access, "denied");
  await React.act(async () => {
    oldCheck.resolve({ granted: true, status: "granted" });
    oldRequest.resolve({ granted: true });
    await request;
  });
  assert.equal(ui.read().access, "denied");
});

test("unmount cancels pending results, poll and focus, and retained callbacks do no work", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const pending = deferred();
  let checks = 0;
  let requests = 0;
  const ui = await hookFixture(t, {
    checkMicrophoneAccess: async () => {
      checks++;
      return { granted: false, status: "denied" };
    },
    requestMicrophoneAccess: () => {
      requests++;
      return pending.promise;
    },
  });
  const retained = ui.read();
  let request;
  await React.act(async () => {
    request = retained.request();
  });
  const renders = ui.renders();
  await ui.unmount();
  assert.equal(ui.listeners.has("focus"), false);
  await React.act(async () => {
    pending.resolve({ granted: true });
    await request;
  });
  t.mock.timers.tick(6000);
  await retained.check();
  assert.equal(await retained.request(), false);
  assert.equal(checks, 1);
  assert.equal(requests, 1);
  assert.equal(ui.renders(), renders);
});

test("StrictMode cleanup invalidates the first pending mount check", async (t) => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const ui = await hookFixture(
    t,
    { checkMicrophoneAccess: () => (++calls === 1 ? first.promise : second.promise) },
    { strict: true }
  );
  assert.equal(calls, 2);
  await React.act(async () => second.resolve({ granted: true, status: "granted" }));
  await React.act(async () => first.resolve({ granted: false, status: "denied" }));
  assert.equal(ui.read().access, "granted");
});

test("recheck uses latest callback and contains sync/async failures, then stops on unmount", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const listeners = new Map();
  installBrowserGlobals(t, {
    window: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        assert.equal(listeners.get(type), listener);
        listeners.delete(type);
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t);
  const { useRecheckOnFocus } = await vite.ssrLoadModule(
    "/components/onboarding/useRecheckOnFocus.ts"
  );
  let root = createRoot(container);
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  function Harness({ check, enabled }) {
    useRecheckOnFocus(check, enabled);
    return null;
  }
  let old = 0;
  let latest = 0;
  await React.act(async () =>
    root.render(React.createElement(Harness, { enabled: false, check: () => old++ }))
  );
  assert.equal(listeners.size, 0);
  await React.act(async () =>
    root.render(React.createElement(Harness, { enabled: true, check: () => old++ }))
  );
  const listener = listeners.get("focus");
  await React.act(async () =>
    root.render(
      React.createElement(Harness, {
        enabled: true,
        check: () => {
          latest++;
          if (latest === 1) throw new Error("injected synchronous check failure");
          return Promise.reject(new Error("injected asynchronous check failure"));
        },
      })
    )
  );
  assert.equal(
    listeners.get("focus"),
    listener,
    "callback changes do not rebuild the subscription"
  );
  await React.act(async () => {
    listener();
    t.mock.timers.tick(2000);
  });
  assert.equal(old, 0);
  assert.equal(latest, 2);
  await React.act(async () => root.unmount());
  root = null;
  assert.equal(listeners.size, 0);
  t.mock.timers.tick(6000);
  assert.equal(latest, 2);
});

test("microphone help routes only to injected privacy/sound APIs and tolerates absence", async (t) => {
  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        openMicrophoneSettings: async () => {
          calls.push("privacy");
          return { success: true };
        },
        openSoundInputSettings: async () => {
          calls.push("sound");
          return { success: true };
        },
      },
    },
  });
  const vite = await createRendererServer(t);
  const { openMicrophoneHelp } = await vite.ssrLoadModule(
    "/components/onboarding/useMicrophoneAccess.ts"
  );
  await openMicrophoneHelp("darwin");
  await openMicrophoneHelp("win32");
  await openMicrophoneHelp("linux");
  assert.deepEqual(calls, ["privacy", "privacy", "sound"]);
  globalThis.window.electronAPI = undefined;
  assert.equal(await openMicrophoneHelp("darwin"), undefined);
  globalThis.window.electronAPI = {
    openMicrophoneSettings: undefined,
    openSoundInputSettings: undefined,
  };
  assert.equal(await openMicrophoneHelp("linux"), undefined);
  globalThis.window.electronAPI.openMicrophoneSettings = async () => {
    throw new Error("injected settings failure");
  };
  await assert.rejects(openMicrophoneHelp("win32"), /injected settings failure/);
});

test("recovery card forwards translated neutral copy and button variants without submitting a form", async (t) => {
  const clicked = [];
  const ui = await mountComponent(t, "/components/onboarding/RecoveryCard.tsx", {
    exportName: "RecoveryCard",
    props: {
      title: "عنوان مترجم",
      body: "شرح مترجم",
      tone: "neutral",
      actions: [
        { label: "إعدادات", onClick: () => clicked.push("default") },
        { label: "تحقق", variant: "ghost", onClick: () => clicked.push("ghost") },
        { label: "ميكروفون", variant: "live", onClick: () => clicked.push("live") },
      ],
    },
  });
  assert.equal(ui.byAttr("role", "alert").length, 1);
  assert.equal(ui.byAttr("data-tone", "neutral").length, 1);
  assert.ok(ui.text().includes("عنوان مترجم"));
  assert.ok(ui.text().includes("شرح مترجم"));
  const buttons = ui.byAttr("data-slot", "button");
  assert.deepEqual(
    buttons.map((button) => button.attributes["data-variant"]),
    ["default", "ghost", "live"]
  );
  assert.ok(buttons.every((button) => button.attributes.type === "button"));
  assert.equal(ui.byAttr("aria-hidden", "true").length, 1);
  for (const label of ["إعدادات", "تحقق", "ميكروفون"]) await ui.click(label);
  assert.deepEqual(clicked, ["default", "ghost", "live"]);
});

test("a rejected explicit request clears previously granted evidence", async (t) => {
  const ui = await hookFixture(t, {
    checkMicrophoneAccess: async () => ({ granted: true, status: "granted" }),
    requestMicrophoneAccess: async () => {
      throw new Error("injected failure after grant");
    },
  });
  assert.equal(ui.read().access, "granted");
  await React.act(async () => assert.equal(await ui.read().request(), false));
  assert.equal(ui.read().access, "unknown");
});

test("an unavailable check or request clears previously granted evidence", async (t) => {
  const api = { checkMicrophoneAccess: async () => ({ granted: true, status: "granted" }) };
  const ui = await hookFixture(t, api);
  assert.equal(ui.read().access, "granted");
  const availableCheck = api.checkMicrophoneAccess;
  api.checkMicrophoneAccess = undefined;
  await React.act(async () => ui.read().check());
  assert.equal(ui.read().access, "unknown");
  api.checkMicrophoneAccess = availableCheck;
  await React.act(async () => ui.read().check());
  assert.equal(ui.read().access, "granted");
  await React.act(async () => assert.equal(await ui.read().request(), false));
  assert.equal(ui.read().access, "unknown");
});
