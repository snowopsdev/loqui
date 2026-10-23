const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const path = require("node:path");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

const noop = () => {};
async function renderer(t) {
  installBrowserGlobals(t, {
    window: { location: { search: "" }, electronAPI: { getPlatform: () => "darwin" } },
  });
  return createRendererServer(t, {
    cachePrefix: "openwhispr-oruk-organization-",
    resolveAlias: { "@": path.resolve(__dirname, "../../src") },
    mockModules: {
      "react-i18next": `export function useTranslation() { return {t(key) {return key;}}; }`,
    },
  });
}

async function render(vite, element) {
  return renderToStaticMarkup(element);
}

test("all three model pickers restore the Oruk tab from the persisted Orukeet choice", async (t) => {
  const vite = await renderer(t);
  const { default: Picker } = await vite.ssrLoadModule("/components/TranscriptionModelPicker.tsx");
  for (const transcriptionContext of ["dictation", "upload", "meeting"]) {
    const markup = await render(
      vite,
      React.createElement(Picker, {
        transcriptionContext,
        selectedLocalProvider: "nvidia",
        selectedLocalModel: "orukeet-v0.1.0",
        useLocalWhisper: true,
        onCommit: noop,
      })
    );
    assert.match(markup, />Orukeet</, transcriptionContext);
    assert.doesNotMatch(markup, />Parakeet TDT/, transcriptionContext);
  }
});

test("a saved stock Parakeet choice opens NVIDIA while retaining Oruk as a selectable organization", async (t) => {
  const vite = await renderer(t);
  const { default: Picker } = await vite.ssrLoadModule("/components/TranscriptionModelPicker.tsx");
  const markup = await render(
    vite,
    React.createElement(Picker, {
      selectedLocalProvider: "nvidia",
      selectedLocalModel: "parakeet-tdt-0.6b-v3",
      useLocalWhisper: true,
      onCommit: noop,
    })
  );
  assert.match(markup, />Oruk</);
  assert.match(markup, />Parakeet TDT/);
  assert.doesNotMatch(markup, />Orukeet</);
});

test("adding Orukeet preserves fresh-install transcription modes and existing backend defaults", async (t) => {
  const vite = await renderer(t);
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const state = useSettingsStore.getState();
  assert.equal(state.useLocalWhisper, true);
  assert.equal(state.localTranscriptionProvider, "nvidia");
  assert.equal(state.parakeetModel, "parakeet-unified-en-0.6b");
});

test("change-driving FIX1: unsupported Oruk browse tab leaves disabled engines without a route fallback", async (t) => {
  const vite = await renderer(t);
  const container = installHookDom(t);
  globalThis.window.electronAPI.checkParakeetInstallation = async () => ({
    supported: false,
    minimumMacOSVersion: "15.5",
  });
  globalThis.window.electronAPI.listParakeetModels = async () => ({ success: true, models: [] });
  globalThis.window.electronAPI.listWhisperModels = async () => ({ success: true, models: [] });
  globalThis.window.electronAPI.onWhisperDownloadProgress = () => noop;
  globalThis.window.electronAPI.onParakeetDownloadProgress = () => noop;
  const { default: Picker } = await vite.ssrLoadModule("/components/TranscriptionModelPicker.tsx");
  const commits = [];
  let tree;
  function Harness() {
    tree = Picker({
      selectedLocalProvider: "nvidia",
      selectedLocalModel: "orukeet-v0.1.0",
      useLocalWhisper: true,
      onCommit: (target) => commits.push(target),
    });
    return null;
  }
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Harness));
    });
    function find(node) {
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      if (!node || typeof node !== "object") return null;
      if (node.props?.providers?.some((provider) => provider.id === "oruk")) return node;
      return find(node.props?.children);
    }
    const tabs = find(tree);
    assert.ok(tabs);
    for (const organization of ["oruk", "nvidia", "cohere"]) {
      assert.equal(
        tabs.props.providers.find((provider) => provider.id === organization).disabled,
        true
      );
    }
    assert.equal(tabs.props.selectedId, "whisper");
    assert.deepEqual(commits, [], "hardware capability must not commit a replacement provider");
  } finally {
    await React.act(async () => root.unmount());
  }
});
