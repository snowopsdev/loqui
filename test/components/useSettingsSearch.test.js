// change-driving: src/components/settings/useSettingsSearch.ts does not exist yet (mounted, personalWorkspace pattern).
const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

test("[change-driving] search state, shortcuts, jump and Esc (mounted)", async (t) => {
  let root;
  // Registered first so it runs before installBrowserGlobals removes `window` (personalWorkspace pattern).
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const listeners = [];
  globalThis.document.addEventListener = (type, fn) => listeners.push([type, fn]);
  globalThis.document.removeEventListener = (type, fn) => {
    const i = listeners.findIndex(([ty, f]) => ty === type && f === fn);
    if (i >= 0) listeners.splice(i, 1);
  };
  globalThis.document.querySelector = () => null;
  const english = '(k) => ({ "settingsPage.general.microphone.title": "Microphone" })[k] ?? k';
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-use-settings-search-test-" }, { t: english })
  );
  const { useSettingsSearch } = await vite.ssrLoadModule(
    "/components/settings/useSettingsSearch.ts"
  );

  const { HotkeyInput } = await vite.ssrLoadModule("/components/ui/HotkeyInput.tsx");
  let captureTree;
  globalThis.document.querySelector = (selector) =>
    selector === "[data-capturing]" && captureTree?.props["data-capturing"] ? captureTree : null;

  const navigated = [];
  const landed = [];
  const land = (anchorId) => {
    landed.push(anchorId);
    return () => {};
  };
  let hook;
  function Probe() {
    hook = useSettingsSearch({ open: true, navigateToPath: (p) => navigated.push(p), land });
    captureTree = HotkeyInput({ value: "Control+Space", onChange() {} });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  const press = (key, init = {}) => ({
    key,
    preventDefault() {
      this.prevented = true;
    },
    ...init,
  });

  await t.test(
    "[change-driving] typing sets the query and finds the microphone first",
    async () => {
      assert.equal(hook.query, "");
      assert.deepEqual(hook.groups, []);
      await React.act(async () => hook.setQuery("mic"));
      assert.equal(hook.query, "mic");
      assert.equal(hook.activeId, "microphone");
    }
  );

  await t.test("[change-driving] arrow keys move the active result and Enter jumps", async () => {
    await React.act(async () => hook.setQuery("retention"));
    const first = hook.activeId;
    await React.act(async () => hook.onSearchKeyDown(press("ArrowDown")));
    assert.notEqual(hook.activeId, first);
    await React.act(async () => hook.onSearchKeyDown(press("ArrowUp")));
    assert.equal(hook.activeId, first);
    const event = press("Enter");
    await React.act(async () => hook.onSearchKeyDown(event));
    assert.equal(event.prevented, true);
    assert.equal(hook.query, "", "jumping clears the query so the page shows");
    assert.equal(navigated.at(-1), "privacyData");
    assert.equal(landed.at(-1), first, "the landing targets the entry's anchor");
  });

  await t.test(
    "[change-driving] a route result navigates to Routing and lands on its Patchbay row",
    async () => {
      await React.act(async () => hook.setQuery("cloud"));
      const entry = hook.groups.flatMap((g) => g.entries).find((e) => e.id.startsWith("route:"));
      assert.ok(entry, "a route entry matches 'cloud'");
      await React.act(async () => hook.jump(entry));
      assert.equal(navigated.at(-1), "routing");
      assert.equal(landed.at(-1), `route-${entry.control.routeId}`);
    }
  );

  await t.test("[change-driving] Cmd+F focuses and selects the field", async () => {
    const calls = [];
    hook.searchRef.current = {
      focus: () => calls.push("focus"),
      select: () => calls.push("select"),
    };
    const keydown = listeners.filter(([type]) => type === "keydown").at(-1)[1];
    const event = press("f", {
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      target: null,
    });
    keydown(event);
    assert.deepEqual(calls, ["focus", "select"]);
    assert.equal(event.prevented, true);
  });

  await t.test(
    "[change-driving] Esc clears a query first and reports it consumed; with no query it lets the dialog close",
    async () => {
      await React.act(async () => hook.setQuery("mic"));
      let consumed;
      await React.act(async () => {
        consumed = hook.consumeEscape();
      });
      assert.equal(consumed, true);
      assert.equal(hook.query, "");
      assert.equal(hook.consumeEscape(), false);
    }
  );

  await t.test(
    "[change-driving] clear() empties the query (a section change calls it)",
    async () => {
      await React.act(async () => hook.setQuery("x"));
      await React.act(async () => hook.clear());
      assert.equal(hook.query, "");
    }
  );
  await t.test(
    "[change-driving] actual HotkeyInput capture marker blocks search shortcuts until blur",
    async () => {
      const calls = [];
      hook.searchRef.current = { focus: () => calls.push("focus"), select() {} };
      await React.act(async () => captureTree.props.onFocus());
      assert.equal(captureTree.props["data-capturing"], true);
      const keydown = listeners.filter(([type]) => type === "keydown").at(-1)[1];
      const event = () =>
        press("f", { metaKey: true, altKey: false, shiftKey: false, ctrlKey: false });
      const captured = event();
      keydown(captured);
      assert.equal(captured.prevented, undefined);
      assert.deepEqual(calls, []);
      await React.act(async () => captureTree.props.onBlur());
      assert.equal(captureTree.props["data-capturing"], undefined);
      const available = event();
      keydown(available);
      assert.equal(available.prevented, true);
      assert.deepEqual(calls, ["focus"]);
    }
  );
});

async function mountProductionLanding(t) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const listeners = new Map();
  const element = {
    dataset: {},
    offsetWidth: 0,
    scrolled: [],
    scrollIntoView(options) {
      this.scrolled.push(options);
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  let present = true;
  globalThis.document.querySelector = (selector) =>
    present && selector === '[data-setting-id="theme"]' ? element : null;
  const callbacks = new Map();
  let sequence = 0;
  globalThis.requestAnimationFrame = (cb) => {
    callbacks.set(++sequence, cb);
    return sequence;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-query-hide-landing-" })
  );
  const { useSettingsSearch } = await vite.ssrLoadModule(
    "/components/settings/useSettingsSearch.ts"
  );
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  const entry = SETTINGS_REGISTRY.find((item) => item.id === "theme");
  let hook;
  function Probe() {
    hook = useSettingsSearch({ open: true, navigateToPath() {} });
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  return {
    hook: () => hook,
    element,
    listeners,
    present: (value) => {
      present = value;
    },
    pending: () => callbacks.size,
    jump: () => React.act(async () => hook.jump(entry)),
    query: (value) => React.act(async () => hook.setQuery(value)),
    frame: () =>
      React.act(async () => {
        const queued = [...callbacks.values()];
        callbacks.clear();
        queued.forEach((cb) => cb());
      }),
  };
}

test("[change-driving FIX1] nonempty query retires the production landed cue before direct input clear", async (t) => {
  const h = await mountProductionLanding(t);
  await h.jump();
  await h.frame();
  assert.equal(h.element.dataset.flash, "true");
  assert.equal(h.listeners.size, 1);
  await h.query("mic");
  assert.equal(h.hook().query, "mic");
  assert.equal(
    h.element.dataset.flash,
    undefined,
    "the hidden page must not retain a replayable marker"
  );
  assert.equal(h.listeners.size, 0, "owned animation listener is retired before hiding");
  await h.query("");
  await h.frame();
  assert.equal(h.hook().query, "");
  assert.equal(h.element.dataset.flash, undefined);
  assert.equal(h.element.scrolled.length, 1, "direct clearing cannot reland the old request");
  await h.jump();
  await h.frame();
  assert.equal(h.element.scrolled.length, 2, "a fresh explicit jump still lands");
  assert.equal(h.element.dataset.flash, "true");
});

test("[change-driving FIX1] query hiding cancels pending production RAF and input clearing cannot revive it", async (t) => {
  const h = await mountProductionLanding(t);
  h.present(false);
  await h.jump();
  await h.frame();
  assert.equal(h.pending(), 1, "production landing is waiting for its anchor");
  await h.query("mic");
  assert.equal(h.pending(), 0, "hiding cancels the owned queued frame");
  h.present(true);
  await h.query("");
  await h.frame();
  assert.equal(h.element.scrolled.length, 0);
  assert.equal(h.element.dataset.flash, undefined);
  assert.equal(h.pending(), 0, "direct clearing must not recreate the retired landing request");
});
