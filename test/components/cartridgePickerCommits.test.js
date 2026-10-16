const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const {
  routeTestApi,
  rendererServer,
  primeRouteFacts,
  toastCapture,
} = require("../lib/routeTestApi");

// Added after implementation: mounted baseline guards of the actual production
// grid -> picker callback -> route planner -> toast/Undo path, with local IPC fixtures.
for (const [provider, initialModel, nextModel, modelKey] of [
  ["whisper", "base", "small", "whisperModel"],
  ["nvidia", "parakeet-unified-en-0.6b", "parakeet-tdt-0.6b-v3", "parakeetModel"],
  ["cohere", "unknown-retained-cohere", "cohere-transcribe-03-2026", "cohereModel"],
]) {
  test(`baseline guard: actual ${provider} cartridge activation commits through the planner and Undo restores the raw prior model`, async (t) => {
    const downloads = [];
    installBrowserGlobals(t, {
      window: {
        electronAPI: routeTestApi({
          extra: {
            getPlatform: () => "darwin",
            getTotalMemory: async () => 32_000_000_000,
            checkParakeetInstallation: async () => ({ supported: true }),
            listWhisperModels: async () => ({
              success: true,
              models: ["base", "small"].map((model) => ({ model, downloaded: true })),
            }),
            listParakeetModels: async () => ({
              success: true,
              models: [
                "parakeet-unified-en-0.6b",
                "parakeet-tdt-0.6b-v3",
                "cohere-transcribe-03-2026",
              ].map((model) => ({ model, downloaded: true })),
            }),
            onWhisperDownloadProgress: () => () => {},
            onParakeetDownloadProgress: () => () => {},
            downloadWhisperModel: async (id) => {
              downloads.push(id);
              return { success: true };
            },
            downloadParakeetModel: async (id) => {
              downloads.push(id);
              return { success: true };
            },
          },
        }),
      },
    });
    const vite = await rendererServer(t, "loqui-cartridge-speech-commits-");
    const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
    const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
    const { useRouteCommit } = await vite.ssrLoadModule(
      "/components/settings/routing/useRouteChange.ts"
    );
    const Picker = (await vite.ssrLoadModule("/components/TranscriptionModelPicker.tsx")).default;
    useSettingsStore.setState({
      transcriptionMode: "local",
      useLocalWhisper: true,
      localTranscriptionProvider: provider,
      [modelKey]: initialModel,
    });
    await primeRouteFacts(vite);
    const { toasts, wrap } = await toastCapture(vite);
    const probes = createProbeRoot(t, { wrap });
    const parent = await probes.mount("picker", () => {
      const state = useSettingsStore();
      const onCommit = useRouteCommit("dictationStt");
      return Picker({
        mode: "local",
        selectedLocalProvider: state.localTranscriptionProvider,
        selectedLocalModel: state[modelKey],
        selectedCloudProvider: "",
        selectedCloudModel: "",
        useLocalWhisper: true,
        onCommit,
      });
    });
    await probes.settle();
    const cartridge = await probes.mount("grid", () => {
      const element = findElement(parent(), (node) => node.type?.name === "ModelCartridgeGrid");
      return element.type(element.props);
    });
    const radio = () =>
      findElement(cartridge(), (node) => node.props?.["data-model"] === nextModel);
    assert.ok(radio());
    await probes.act(() => radio().props.onKeyDown({ key: "Home", preventDefault() {} }));
    assert.equal(
      useSettingsStore.getState()[modelKey],
      initialModel,
      "focus never changes selection"
    );
    assert.equal(toasts.length, 0);
    await probes.act(() => radio().props.onKeyDown({ key: " ", preventDefault() {} }));
    await probes.settle();
    assert.equal(useSettingsStore.getState().localTranscriptionProvider, provider);
    assert.equal(useSettingsStore.getState()[modelKey], nextModel);
    assert.equal(useRouteDraftStore.getState().draft, null);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].actions[0].label, "routes.toast.undo");
    await probes.act(() => toasts[0].actions[0].onClick());
    await probes.settle();
    assert.equal(useSettingsStore.getState()[modelKey], initialModel);
    assert.deepEqual(downloads, []);
  });
}

test("baseline guard: Reasoning selector -> local picker -> actual cartridge -> planner preserves registry context and Undo", async (t) => {
  const data = require("../../src/models/modelRegistryData.json");
  const provider = data.localProviders.find((p) => p.models.length >= 2);
  const [initial, next] = provider.models;
  const calls = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: routeTestApi({
        extra: {
          getPlatform: () => "darwin",
          getTotalMemory: async () => 64_000_000_000,
          modelGetAll: async () => provider.models.map((m) => ({ ...m, isDownloaded: true })),
          modelGetImported: async () => [],
          onModelDownloadProgress: () => () => {},
          onModelsCleared: () => () => {},
          modelDownload: async () => {
            calls.push("download");
            return { success: true };
          },
        },
      }),
    },
  });
  const vite = await rendererServer(t, "loqui-cartridge-text-commits-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteCommit } = await vite.ssrLoadModule(
    "/components/settings/routing/useRouteChange.ts"
  );
  const Selector = (await vite.ssrLoadModule("/components/ReasoningModelSelector.tsx")).default;
  useSettingsStore.setState({
    chatAgentMode: "local",
    chatAgentProvider: provider.id,
    chatAgentModel: initial.id,
  });
  await primeRouteFacts(vite);
  const { toasts, wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  const parent = await probes.mount("selector", () => {
    const state = useSettingsStore();
    const onCommit = useRouteCommit("chat");
    return Selector({
      mode: "local",
      editorIdentity: "chat",
      credentialRef: "custom:chatIntelligence",
      reasoningModel: state.chatAgentModel,
      localReasoningProvider: state.chatAgentProvider,
      cloudReasoningBaseUrl: "",
      onCommit,
      onRoutePatch() {},
    });
  });
  const picker = await probes.mount("local", () => {
    const element = findElement(parent(), (node) => node.type?.name === "LocalModelPicker");
    return element.type(element.props);
  });
  await probes.settle();
  const grid = await probes.mount("grid", () => {
    const element = findElement(picker(), (node) => node.type?.name === "ModelCartridgeGrid");
    const model = element.props.models.find((m) => m.id === next.id);
    assert.equal(model.contextLength, next.contextLength);
    assert.equal(model.speedTier, next.speedTier);
    return element.type(element.props);
  });
  const toggle = findElement(grid(), (node) => node.props?.["aria-expanded"] === false);
  if (toggle) await probes.act(() => toggle.props.onClick());
  const radio = findElement(grid(), (node) => node.props?.["data-model"] === next.id);
  await probes.act(() => radio.props.onClick());
  await probes.settle();
  assert.equal(useSettingsStore.getState().chatAgentModel, next.id);
  assert.equal(toasts.length, 1);
  await probes.act(() => toasts[0].actions[0].onClick());
  await probes.settle();
  assert.equal(useSettingsStore.getState().chatAgentModel, initial.id);
  assert.deepEqual(calls, []);
});
