const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const path = require("node:path");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

function find(node, predicate) {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
async function harness(t, module, options = {}) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { electronAPI: options.api ?? {} } });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    resolveAlias: { "@": path.resolve(__dirname, "../../src") },
    mockModules: {
      "react-i18next": "export const useTranslation = () => ({ t: key => key });",
      ...(options.mocks ?? {}),
    },
  });
  const Component = (await vite.ssrLoadModule(module)).default;
  let tree;
  function Harness() {
    tree = Component(options.props ?? {});
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Harness)));
  return { tree: () => tree, vite };
}

test("first setup reaches completion without account APIs or implicit downloads", async (t) => {
  let completed = 0;
  const h = await harness(t, "/components/OnboardingFlow.tsx", {
    mocks: { "/SettingsPage": "export default function SettingsPage() { return null; }" },
    props: { onComplete: () => completed++ },
  });
  for (const stage of ["privacyData", "speechToText", "llms", "hotkeys"]) {
    assert.equal(find(h.tree(), (node) => node.props?.activeSection)?.props.activeSection, stage);
    const next = find(
      h.tree(),
      (node) =>
        node.props?.children === (stage === "hotkeys" ? "personal.finishSetup" : "common.continue")
    );
    await React.act(async () => next.props.onClick());
  }
  assert.equal(completed, 1);
  assert.deepEqual(globalThis.window.electronAPI, {});
});

test("saved credential presence is never revealed or erased by opening its editor", async (t) => {
  const saved = [];
  const h = await harness(t, "/components/ui/ApiKeyInput.tsx", {
    props: { apiKey: "__stored__", setApiKey: (key) => saved.push(key) },
  });
  assert.ok(
    find(h.tree(), (node) =>
      React.Children.toArray(node.props?.children).includes("personal.keyConfigured")
    )
  );
  assert.equal(
    find(
      h.tree(),
      (node) => node.props?.value === "__stored__" || node.props?.children === "__stored__"
    ),
    undefined
  );
  await React.act(async () =>
    find(h.tree(), (node) => node.props?.["aria-label"] === "apiKeyInput.edit").props.onClick()
  );
  const input = find(h.tree(), (node) => node.props?.type === "password");
  assert.equal(input.props.value, "");
  await React.act(async () =>
    find(h.tree(), (node) => node.props?.["aria-label"] === "apiKeyInput.save").props.onClick()
  );
  assert.deepEqual(saved, []);
  await React.act(async () =>
    find(h.tree(), (node) => node.props?.children === "personal.removeKey").props.onClick()
  );
  assert.deepEqual(saved, [""]);
});

test("custom model discovery sends only its task-scoped credential reference", async (t) => {
  const calls = [];
  await harness(t, "/components/OpenAICompatiblePanel.tsx", {
    api: {
      personalInference: {
        models: async (request) => {
          calls.push(request);
          return { data: [{ id: "test-model" }] };
        },
      },
    },
    props: {
      credentialRef: "custom:noteFormatting",
      baseUrl: "https://example.test/v1",
      apiKey: "__stored__",
      model: "test-model",
      setBaseUrl() {},
      setApiKey() {},
      setModel() {},
    },
  });
  assert.ok(calls.length > 0);
  assert.equal(calls[0].credentialRef, "custom:noteFormatting");
  assert.equal(calls[0].inferenceScope, "noteFormatting");
  assert.equal(calls[0].provider, "custom");
  assert.equal(JSON.stringify(calls).includes("__stored__"), false);
  assert.equal(calls[0].apiKey, undefined);
});

for (const requireImages of [false, true]) {
  test(`provider choices support the task (images: ${requireImages})`, async (t) => {
    const h = await harness(t, "/components/ReasoningModelSelector.tsx", {
      props: {
        mode: "cloud",
        reasoningModel: "",
        localReasoningProvider: "openai",
        requireImages,
        setReasoningModel() {},
        setLocalReasoningProvider() {},
        cloudReasoningBaseUrl: "",
        setCloudReasoningBaseUrl() {},
      },
    });
    const tabs = find(h.tree(), (node) =>
      node.props?.providers?.some((provider) => provider.id === "openai")
    );
    assert.ok(tabs);
    const ids = tabs.props.providers.map((provider) => provider.id);
    assert.equal(ids.includes("codex"), !requireImages);
    for (const provider of ["openai", "bedrock", "azure", "vertex"])
      assert.ok(ids.includes(provider));
  });
}

test("settings toggles expose their setting label and checked state to assistive technology", async (t) => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const vite = await createRendererServer(t);
  const { SettingsRow } = await vite.ssrLoadModule("/components/ui/SettingsSection.tsx");
  const { Toggle } = await vite.ssrLoadModule("/components/ui/toggle.tsx");
  const html = renderToStaticMarkup(
    React.createElement(
      SettingsRow,
      { label: "Local cleanup" },
      React.createElement(Toggle, { checked: true, onChange() {} })
    )
  );
  const labelId = html.match(/<p id="([^"]+)"[^>]*>Local cleanup<\/p>/)?.[1];
  assert.ok(labelId);
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked="true"/);
  assert.ok(html.includes(`aria-labelledby="${labelId}"`));
});
