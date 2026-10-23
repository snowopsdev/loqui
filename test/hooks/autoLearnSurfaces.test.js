const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const path = require("node:path");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");
const { findElement } = require("../lib/probeRoot");

async function setup(t, initialStorage = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const bus = new EventTarget();
  const calls = [];
  let dictionaryReads = 0;
  const listeners = new Set();
  let resolveDictionary;
  const pendingDictionary = new Promise((resolve) => {
    resolveDictionary = resolve;
  });
  const { storage } = installBrowserGlobals(t, {
    initialStorage,
    window: {
      location: { search: "" },
      addEventListener(type, handler) {
        if (type === "loqui-auto-learn-changed") listeners.add(handler);
        bus.addEventListener(type, handler);
      },
      removeEventListener(type, handler) {
        if (type === "loqui-auto-learn-changed") listeners.delete(handler);
        bus.removeEventListener(type, handler);
      },
      dispatchEvent: bus.dispatchEvent.bind(bus),
      electronAPI: {
        setAutoLearnEnabled: (value) => calls.push(value),
        getDictionary: () => {
          dictionaryReads++;
          return pendingDictionary;
        },
        setDictionary: async () => {},
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({
      cachePrefix: "loqui-auto-learn-surfaces-",
      resolveAlias: { "@": path.resolve(__dirname, "../../src") },
      mockModules: {
        "/hooks/useWhisper":
          "const checkWhisperInstallation = () => {}; export function useWhisper() { return { checkWhisperInstallation }; }",
        "/hooks/usePermissions": "export function usePermissions() { return {}; }",
        "/hooks/useSystemAudioPermission":
          "export function useSystemAudioPermission() { return {}; }",
        "/hooks/useClipboard": "export function useClipboard() {}",
        "/hooks/useStartOnboarding": "export function useStartOnboarding() { return () => {}; }",
        "/hooks/useTheme":
          'export function useTheme() { return { theme: "light", setTheme() {} }; }',
        "/hooks/useHotkeyRegistration": "export function useHotkeyRegistration() { return {}; }",
        "/hooks/useHotkeyModeInfo": "export function useHotkeyModeInfo() { return {}; }",
      },
    })
  );
  const { SettingsProvider } = await vite.ssrLoadModule("/hooks/useSettings.ts");
  root = createRoot(container);
  return {
    SettingsProvider,
    vite,
    storage,
    calls,
    listeners,
    resolveDictionary,
    dictionaryReads: () => dictionaryReads,
    draw: (node) => React.act(async () => root.render(node)),
    unmount: () => React.act(async () => root.render(null)),
  };
}

test("[change-driving] independent real useSettings mounts synchronize without duplicate IPC (mounted)", async (t) => {
  const s = await setup(t);
  const { useSettings } = await s.vite.ssrLoadModule("/hooks/useSettings.ts");
  let a, b;
  function A() {
    a = useSettings();
    return null;
  }
  function B() {
    b = useSettings();
    return null;
  }
  await s.draw(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(s.SettingsProvider, null, React.createElement(A)),
      React.createElement(s.SettingsProvider, null, React.createElement(B))
    )
  );
  assert.deepEqual(s.calls, [true], "one main sync across consumers");
  await React.act(async () => a.setAutoLearnCorrections(false));
  assert.deepEqual([a.autoLearnCorrections, b.autoLearnCorrections], [false, false]);
  await React.act(async () => {
    b.setAutoLearnCorrections(true);
    a.setAutoLearnCorrections(false);
  });
  assert.deepEqual([a.autoLearnCorrections, b.autoLearnCorrections], [false, false]);
  assert.deepEqual(s.calls, [true, false, true, false], "one IPC per distinct synchronous intent");
  assert.equal(
    s.dictionaryReads(),
    1,
    "real startup initialization is waiting on the fixture DB read"
  );
  await React.act(async () => s.resolveDictionary(["fixture"]));
  const { useSettingsStore } = await s.vite.ssrLoadModule("/stores/settingsStore.ts");
  assert.ok(useSettingsStore.getState().customDictionary.includes("fixture"));
  assert.equal(
    b.autoLearnCorrections,
    false,
    "late unrelated initialization cannot restore the default"
  );
  await s.unmount();
  assert.equal(s.listeners.size, 0, "last unmount detaches shared listener");
  s.storage.setItem("autoLearnCorrections", "true");
  await s.draw(React.createElement(s.SettingsProvider, null, React.createElement(B)));
  assert.equal(b.autoLearnCorrections, true, "remount reads persisted value, not a dead snapshot");
  assert.deepEqual(s.calls, [true, false, true, false, true]);
});

test("[change-driving] actual Dictionary and Settings Dictation controls share persistence through edits and remount (mounted)", async (t) => {
  const s = await setup(t);
  const Dictionary = (await s.vite.ssrLoadModule("/components/DictionaryView.tsx")).default;
  const Page = (await s.vite.ssrLoadModule("/components/SettingsPage.tsx")).default;
  let dict, page, actions;
  function DictionaryProbe() {
    dict = Dictionary();
    const node = findElement(dict, (n) => n.type?.name === "DictionaryHeaderActions");
    actions = node ? node.type(node.props) : null;
    return null;
  }
  function PageProbe() {
    page = Page({ activeSection: "hotkeys" });
    return null;
  }
  const app = () =>
    React.createElement(
      s.SettingsProvider,
      null,
      React.createElement(
        React.Fragment,
        null,
        React.createElement(DictionaryProbe),
        React.createElement(PageProbe)
      )
    );
  await s.draw(app());
  const row = () => findElement(page, (n) => n.props?.settingId === "autoLearn");
  const settingsToggle = () =>
    findElement(row(), (n) => typeof n.props?.checked === "boolean" && n.props?.onChange);
  const headerToggle = () =>
    findElement(
      actions,
      (n) => n.props?.["aria-label"] === "settingsPage.dictionary.autoLearnTitle"
    );
  assert.ok(headerToggle(), "header offers auto-learn even with an empty dictionary");
  assert.equal(settingsToggle().props.checked, true);
  await React.act(async () => headerToggle().props.onChange(false));
  assert.equal(settingsToggle().props.checked, false);
  await React.act(async () => {
    settingsToggle().props.onChange(true);
    headerToggle().props.onChange(false);
  });
  assert.equal(settingsToggle().props.checked, false);
  assert.equal(headerToggle().props.checked, false);
  assert.equal(s.storage.getItem("autoLearnCorrections"), "false");
  assert.deepEqual(s.calls, [true, false, true, false]);
  await s.unmount();
  assert.equal(s.listeners.size, 0);
  await s.draw(app());
  assert.equal(settingsToggle().props.checked, false);
  assert.equal(headerToggle().props.checked, false);
  assert.deepEqual(s.calls, [true, false, true, false], "remount does not redundantly write main");
  const icon = findElement(dict, (n) => n.props?.["aria-label"] === "dictionary.importWords");
  assert.equal(icon.props.type, "button");
  assert.equal(icon.props.title, "dictionary.importWords");
});

// These lifecycle/transport boundaries are baseline coverage added after implementation.
test("[baseline guard] stored false, external storage changes and stale event details preserve the latest persisted intent (mounted)", async (t) => {
  const s = await setup(t, { autoLearnCorrections: "false" });
  const { useAutoLearnCorrections, AUTO_LEARN_CHANGED_EVENT } = await s.vite.ssrLoadModule(
    "/hooks/useAutoLearnCorrections.ts"
  );
  let a, b;
  function A() {
    a = useAutoLearnCorrections();
    return null;
  }
  function B() {
    b = useAutoLearnCorrections();
    return null;
  }
  await s.draw(
    React.createElement(React.Fragment, null, React.createElement(A), React.createElement(B))
  );
  assert.deepEqual([a[0], b[0]], [false, false]);
  assert.deepEqual(s.calls, [false], "stored disabled preference is never default-enabled");
  await React.act(async () => {
    s.storage.setItem("autoLearnCorrections", "true");
    const event = new Event("storage");
    Object.assign(event, { key: "autoLearnCorrections", storageArea: s.storage });
    globalThis.window.dispatchEvent(event);
  });
  assert.deepEqual([a[0], b[0]], [true, true]);
  await React.act(async () => a[1](false));
  await React.act(async () =>
    globalThis.window.dispatchEvent(new CustomEvent(AUTO_LEARN_CHANGED_EVENT, { detail: true }))
  );
  assert.deepEqual(
    [a[0], b[0]],
    [false, false],
    "an old event cannot overwrite newer persisted intent"
  );
  assert.deepEqual(
    s.calls,
    [false, false],
    "external storage is adopted without echoing the other renderer IPC"
  );
  assert.equal(s.listeners.size, 1, "one listener shared by both mounts");
  await s.draw(React.createElement(B));
  assert.equal(s.listeners.size, 1, "surviving mount remains subscribed");
  await s.unmount();
  assert.equal(s.listeners.size, 0);
});

test("[change-driving] storage propagation from another window never echoes its main write (mounted)", async (t) => {
  const s = await setup(t, { autoLearnCorrections: "false" });
  const { useAutoLearnCorrections } = await s.vite.ssrLoadModule(
    "/hooks/useAutoLearnCorrections.ts"
  );
  let current;
  function Probe() {
    current = useAutoLearnCorrections();
    return null;
  }
  await s.draw(React.createElement(Probe));
  assert.deepEqual(s.calls, [false]);
  // Another renderer already wrote main and the shared localStorage value.
  await React.act(async () => {
    s.storage.setItem("autoLearnCorrections", "true");
    const event = new Event("storage");
    Object.assign(event, { key: "autoLearnCorrections", storageArea: s.storage });
    globalThis.window.dispatchEvent(event);
  });
  assert.equal(current[0], true);
  assert.deepEqual(s.calls, [false], "recipient renderer must not repeat the writer IPC");
  await React.act(async () => current[1](false));
  assert.deepEqual(s.calls, [false, false], "a later local intent still writes exactly once");
});
