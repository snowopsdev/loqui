const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const path = require("node:path");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
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
    props: {
      onComplete: () => completed++,
      initialStep: "welcome",
      previewConfig: { step: "welcome", scenario: "ready", platform: "linux" },
    },
  });
  for (const step of ["welcome", "speech", "cleanup", "try", "shortcuts", "finish"]) {
    if (step === "welcome") {
      const markup = renderToStaticMarkup(h.tree());
      assert.match(markup, /A quieter way to get words out/);
      assert.match(markup, /Keep local history/);
      assert.match(markup, /Download updates automatically/);
    } else {
      assert.equal(h.tree().props.step, step);
    }
    await React.act(async () => h.tree().props.onContinue());
  }
  assert.equal(completed, 1);
  assert.deepEqual(globalThis.window.electronAPI, {});
});

test("speech setup offers Orukeet and NVIDIA models and commits a local dictation choice", async (t) => {
  const h = await harness(t, "/components/OnboardingFlow.tsx", {
    api: { checkParakeetModelStatus: async () => ({ downloaded: false }) },
    props: { onComplete() {}, initialStep: "speech" },
  });
  const markup = renderToStaticMarkup(h.tree());
  for (const name of [
    "Orukeet",
    "Parakeet Unified EN 0.6B",
    "Parakeet TDT 0.6B",
    "Nemotron Speech Streaming EN 0.6B",
    "Nemotron 3.5 ASR Streaming 0.6B",
  ]) {
    assert.ok(markup.includes(name), `${name} should be selectable during speech setup`);
  }
  const { useSettingsStore } = await h.vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.getState().setUseLocalWhisper(false);
  await React.act(async () => h.tree().props.children.props.onSelectModel("orukeet-v0.1.0"));
  const state = useSettingsStore.getState();
  assert.equal(state.useLocalWhisper, true);
  assert.equal(state.localTranscriptionProvider, "nvidia");
  assert.equal(state.parakeetModel, "orukeet-v0.1.0");

  const { supportsSpeechLanguage, firstCompatibleSpeechModel } = await h.vite.ssrLoadModule(
    "/utils/onboardingSpeechModels.ts"
  );
  assert.equal(supportsSpeechLanguage("orukeet-v0.1.0", "ja-JP"), false);
  assert.equal(supportsSpeechLanguage("nemotron-3.5-asr-streaming-0.6b", "ja-JP"), true);
  assert.equal(firstCompatibleSpeechModel("ja-JP"), "nemotron-3.5-asr-streaming-0.6b");
});

test("preview speech choices stay in preview storage", async (t) => {
  const config = { step: "speech", scenario: "fresh", platform: "linux" };
  const h = await harness(t, "/components/OnboardingFlow.tsx", {
    props: { onComplete() {}, initialStep: "speech", previewConfig: config },
  });
  await React.act(async () => h.tree().props.children.props.onSelectModel("orukeet-v0.1.0"));
  const { onboardingPreviewStorageKey } = await h.vite.ssrLoadModule("/utils/onboardingState.ts");
  assert.equal(globalThis.localStorage.getItem("parakeetModel"), null);
  assert.equal(
    globalThis.localStorage.getItem(`${onboardingPreviewStorageKey(config)}.speechModel`),
    "orukeet-v0.1.0"
  );
});

test("saved credential presence is never revealed or erased by opening its editor", async (t) => {
  const saved = [];
  const h = await harness(t, "/components/ui/ApiKeyInput.tsx", {
    props: { apiKey: "__stored__", setApiKey: (key) => saved.push(key) },
  });
  assert.ok(
    find(
      h.tree(),
      (node) =>
        node.type === "button" &&
        node.props?.onClick &&
        node.props?.className?.includes("cursor-pointer")
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
    find(
      h.tree(),
      (node) =>
        node.type === "button" &&
        node.props?.onClick &&
        node.props?.className?.includes("cursor-pointer")
    ).props.onClick()
  );
  const input = find(h.tree(), (node) => node.props?.type === "password");
  assert.equal(input.props.value, "");
  await React.act(async () =>
    find(
      h.tree(),
      (node) => node.type === "button" && node.props?.className?.includes("text-success")
    ).props.onClick()
  );
  assert.deepEqual(saved, []);
  await React.act(async () =>
    find(
      h.tree(),
      (node) => node.type === "button" && node.props?.className?.includes("hover:text-destructive")
    ).props.onClick()
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
