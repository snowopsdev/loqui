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

const { withI18nMock } = require("../lib/i18nTestMock");

const { TOAST_MOCK } = require("../helpers/harness/rendererMocks");

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
  const vite = await createRendererServer(
    t,
    withI18nMock({
      resolveAlias: { "@": path.resolve(__dirname, "../../src") },
      mockModules: {
        "/ui/useToast": TOAST_MOCK,
        ...(options.mocks ?? {}),
      },
    })
  );
  const Component = (await vite.ssrLoadModule(module)).default;
  await options.beforeRender?.(vite);
  let tree;
  function Harness() {
    tree = Component(options.props ?? {});
    if (options.project) tree = options.project(tree);
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
      (node) => node.type === "button" && node.props?.["data-action"] === "save-key"
    ).props.onClick()
  );
  assert.deepEqual(saved, []);
  // Change-driving Task12 reversed guard: no identity means no permanent empty-save Remove.
  assert.equal(
    find(
      h.tree(),
      (node) => node.type === "button" && node.props?.className?.includes("hover:text-destructive")
    ),
    undefined
  );
  assert.deepEqual(saved, []);
});

for (const requireImages of [false, true]) {
  test(`provider choices support the task (images: ${requireImages})`, async (t) => {
    const h = await harness(t, "/components/ReasoningModelSelector.tsx", {
      props: {
        mode: "cloud",
        reasoningModel: "",
        localReasoningProvider: "openai",
        requireImages,
        onCommit() {},
        onRoutePatch() {},
        cloudReasoningBaseUrl: "",
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

const { deferred } = require("../helpers/harness/deferred");

const keyEditor = (h) => ({
  open: () =>
    find(
      h.tree(),
      (node) =>
        node.type === "button" &&
        node.props?.onClick &&
        node.props?.className?.includes("cursor-pointer")
    ),
  input: () => find(h.tree(), (node) => node.props?.type === "password"),
  save: () =>
    find(h.tree(), (node) => node.type === "button" && node.props?.["data-action"] === "save-key"),
  alert: () => find(h.tree(), (node) => node.props?.role === "alert"),
});

// change-driving (I3): today save() closes the editor before the store's
// fire-and-forget IPC has even started, so a failure loses the pasted key.
test("a key save that main refuses keeps the draft and says so", async (t) => {
  const h = await harness(t, "/components/ui/ApiKeyInput.tsx", {
    props: { apiKey: "", setApiKey: async () => ({ ok: false, error: "persistFailed" }) },
  });
  const editor = keyEditor(h);
  await React.act(async () => editor.open().props.onClick());
  await React.act(async () => editor.input().props.onChange({ target: { value: "sk-typed" } }));
  await React.act(async () => editor.save().props.onClick());
  assert.equal(editor.input()?.props.value, "sk-typed");
  assert.ok(editor.alert(), "the failure is announced");
});

// change-driving (I3): the editor stays open while main persists and clears
// its draft only once main acknowledged the save.
test("a key save clears the draft only after main acknowledges it", async (t) => {
  const ack = deferred();
  const h = await harness(t, "/components/ui/ApiKeyInput.tsx", {
    props: { apiKey: "", setApiKey: () => ack.promise },
  });
  const editor = keyEditor(h);
  await React.act(async () => editor.open().props.onClick());
  await React.act(async () => editor.input().props.onChange({ target: { value: "sk-typed" } }));
  let saving;
  await React.act(async () => {
    saving = editor.save().props.onClick();
  });
  assert.equal(editor.input()?.props.value, "sk-typed", "still editing while main persists");
  await React.act(async () => {
    ack.resolve({ ok: true });
    await saving;
  });
  assert.equal(editor.input(), undefined, "editor closed after the acknowledgement");
  assert.equal(editor.alert(), undefined);
  await React.act(async () => editor.open().props.onClick());
  assert.equal(editor.input().props.value, "");
});

// change-driving review R2: profile draft is separate from acknowledged readiness.
test("Bedrock profile typing remains editable during pending persistence and retains a failed draft", async (t) => {
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const calls = [];
  let store;
  const h = await harness(t, "/components/EnterpriseProviderConfig.tsx", {
    props: {
      provider: "bedrock",
      reasoningModel: "fixture-model",
      onSelectModel() {},
      onRoutePatch() {},
    },
    api: {
      saveBedrockProfile: (value) => {
        calls.push(value);
        return [first, second, third][calls.length - 1].promise;
      },
    },
    mocks: { "/services/ReasoningService": "export default { clearApiKeyCache() {} };" },
    beforeRender: async (vite) => {
      store = (await vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
      store.setState({ bedrockProfile: "fixture-old" });
    },
    project: (tree) => {
      const field = find(
        tree,
        (node) => node.type?.name === "Field" && node.props.label === "reasoning.enterprise.profile"
      );
      return field.type(field.props);
    },
  });
  const input = () =>
    find(h.tree(), (node) => node.props?.value !== undefined && node.props?.onChange);
  await React.act(async () => {
    input().props.onChange({ target: { value: "fixture-new" } });
  });
  assert.equal(input().props.value, "fixture-new");
  assert.deepEqual(calls, [], "typing does not persist or change readiness");
  let saving;
  await React.act(async () => {
    saving = input().props.onBlur();
  });
  assert.equal(input().props.value, "fixture-new");
  assert.equal(store.getState().bedrockProfile, "fixture-old");
  await React.act(async () => {
    first.resolve(Promise.reject(new Error("fixture refusal")));
    await saving;
  });
  assert.equal(input().props.value, "fixture-new");
  assert.equal(store.getState().bedrockProfile, "fixture-old");
  assert.ok(find(h.tree(), (node) => node.props?.role === "alert"));
  await React.act(async () => {
    saving = input().props.onBlur();
  });
  await React.act(async () => {
    input().props.onChange({ target: { value: "fixture-later" } });
  });
  let laterSaving;
  await React.act(async () => {
    laterSaving = input().props.onBlur();
  });
  assert.equal(calls.length, 2, "a later blur waits for the prior profile ACK");
  await React.act(async () => {
    second.resolve({ success: true });
    await saving;
  });
  assert.equal(input().props.value, "fixture-later", "an earlier ACK cannot replace a newer draft");
  assert.equal(store.getState().bedrockProfile, "fixture-new");
  await React.act(async () => {
    third.resolve({ success: true });
    await laterSaving;
  });
  assert.equal(store.getState().bedrockProfile, "fixture-later");
  assert.deepEqual(calls, ["fixture-new", "fixture-new", "fixture-later"]);
});

async function bedrockProfileEditor(t, gates) {
  const calls = [];
  let store;
  const h = await harness(t, "/components/EnterpriseProviderConfig.tsx", {
    props: {
      provider: "bedrock",
      reasoningModel: "fixture-model",
      onSelectModel() {},
      onRoutePatch() {},
    },
    api: {
      saveBedrockProfile: (value) => {
        calls.push(value);
        return gates[calls.length - 1].promise;
      },
    },
    mocks: { "/services/ReasoningService": "export default { clearApiKeyCache() {} };" },
    beforeRender: async (vite) => {
      store = (await vite.ssrLoadModule("/stores/settingsStore.ts")).useSettingsStore;
      store.setState({ bedrockProfile: "fixture-old" });
    },
    project: (tree) => {
      const field = find(
        tree,
        (node) => node.type?.name === "Field" && node.props.label === "reasoning.enterprise.profile"
      );
      return field.type(field.props);
    },
  });
  return {
    calls,
    store,
    input: () => find(h.tree(), (node) => node.props?.value !== undefined && node.props?.onChange),
    alert: () => find(h.tree(), (node) => node.props?.role === "alert"),
  };
}

for (const success of [false, true]) {
  test(`Bedrock same-value resubmission owns its ${success ? "successful" : "refused"} outcome after intervening edits`, async (t) => {
    const first = deferred();
    const retry = deferred();
    const editor = await bedrockProfileEditor(t, [first, retry]);
    let saving;
    await React.act(async () => {
      editor.input().props.onChange({ target: { value: "fixture-A" } });
      saving = editor.input().props.onBlur();
    });
    await React.act(async () => {
      editor.input().props.onChange({ target: { value: "fixture-B" } });
    });
    await React.act(async () => {
      editor.input().props.onChange({ target: { value: "fixture-A" } });
    });
    let resubmitted;
    await React.act(async () => {
      resubmitted = editor.input().props.onBlur();
    });
    assert.equal(resubmitted, saving, "the latest matching submission can share the pending ACK");
    assert.deepEqual(editor.calls, ["fixture-A"]);
    await React.act(async () => {
      first.resolve({ success });
      await resubmitted;
    });
    assert.equal(editor.input().props.value, "fixture-A");
    assert.equal(editor.store.getState().bedrockProfile, success ? "fixture-A" : "fixture-old");
    assert.equal(editor.input().props["aria-invalid"], !success);
    assert.equal(!!editor.alert(), !success, "the latest explicit submission owns its outcome");
    if (!success) {
      await React.act(async () => {
        saving = editor.input().props.onBlur();
      });
      await React.act(async () => {
        retry.resolve({ success: true });
        await saving;
      });
      assert.equal(editor.store.getState().bedrockProfile, "fixture-A");
      assert.equal(editor.input().props["aria-invalid"], false);
      assert.equal(!!editor.alert(), false);
      assert.deepEqual(editor.calls, ["fixture-A", "fixture-A"]);
    }
  });

  test(`Bedrock ${success ? "successful" : "refused"} ACK preserves a newer unsent profile draft`, async (t) => {
    const first = deferred();
    const editor = await bedrockProfileEditor(t, [first]);
    let saving;
    await React.act(async () => {
      editor.input().props.onChange({ target: { value: "fixture-A" } });
      saving = editor.input().props.onBlur();
    });
    await React.act(async () => {
      editor.input().props.onChange({ target: { value: "fixture-unsent" } });
    });
    await React.act(async () => {
      first.resolve({ success });
      await saving;
    });
    assert.equal(editor.input().props.value, "fixture-unsent");
    assert.equal(editor.store.getState().bedrockProfile, success ? "fixture-A" : "fixture-old");
    assert.equal(editor.input().props["aria-invalid"], false);
    assert.equal(
      !!editor.alert(),
      false,
      "an older submission cannot assign an error to an unsent draft"
    );
    assert.deepEqual(editor.calls, ["fixture-A"]);
  });
}

test("Bedrock profile submissions preserve A then queued B then resubmitted A order", async (t) => {
  const gates = [deferred(), deferred(), deferred()];
  const editor = await bedrockProfileEditor(t, gates);
  const saving = [];
  for (const value of ["fixture-A", "fixture-B", "fixture-A"]) {
    await React.act(async () => {
      editor.input().props.onChange({ target: { value } });
      saving.push(editor.input().props.onBlur());
    });
  }
  assert.deepEqual(editor.calls, ["fixture-A"]);
  for (let index = 0; index < gates.length; index += 1) {
    await React.act(async () => {
      gates[index].resolve({ success: true });
      await saving[index];
    });
  }
  assert.deepEqual(editor.calls, ["fixture-A", "fixture-B", "fixture-A"]);
  assert.equal(editor.input().props.value, "fixture-A");
  assert.equal(editor.store.getState().bedrockProfile, "fixture-A");
  assert.equal(editor.input().props["aria-invalid"], false);
});
