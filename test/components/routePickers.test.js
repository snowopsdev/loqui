const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const {
  SRC,
  primeRouteFacts,
  rendererServer,
  routeTestApi,
  toastCapture,
} = require("../lib/routeTestApi");

const endpointField = (tree) =>
  findElement(tree, (node) => typeof node.props?.onUse === "function");
const modelList = (tree) =>
  findElement(
    tree,
    (node) => Array.isArray(node.props?.models) && typeof node.props?.onModelSelect === "function"
  );

test("change-driving: pickers commit through the route planner (I1)", async (t) => {
  const probeCalls = [];
  let nextProbe = { ok: true, count: 3 };
  const modelCalls = [];
  installBrowserGlobals(t, {
    window: {
      location: { search: "" },
      electronAPI: routeTestApi({
        present: ["openai"],
        extra: {
          getPlatform: () => "darwin",
          checkParakeetInstallation: async () => ({ supported: true }),
          listWhisperModels: async () => ({ success: true, models: [] }),
          listParakeetModels: async () => ({ success: true, models: [] }),
          onWhisperDownloadProgress: () => () => {},
          onParakeetDownloadProgress: () => () => {},
          probeSelfHosted: async (url) => {
            probeCalls.push(url);
            return nextProbe;
          },
          personalInference: {
            models: async (request) => {
              modelCalls.push(request);
              return { data: [] };
            },
            onTextEvent: () => () => {},
          },
        },
      }),
    },
  });
  const vite = await rendererServer(t, "loqui-route-pickers-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { useRouteCommit } = await vite.ssrLoadModule(
    "/components/settings/routing/useRouteChange.ts"
  );
  const Picker = (await vite.ssrLoadModule("/components/TranscriptionModelPicker.tsx")).default;
  const Selector = (await vite.ssrLoadModule("/components/ReasoningModelSelector.tsx")).default;
  const SelfHostedPanel = (await vite.ssrLoadModule("/components/SelfHostedPanel.tsx")).default;
  await primeRouteFacts(vite);
  const { toasts, wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });

  const reset = (state) => {
    useRouteDraftStore.getState().discard();
    useSettingsStore.setState(state);
    toasts.length = 0;
  };
  const dictationCloud = (over = {}) => ({
    transcriptionMode: "providers",
    useLocalWhisper: false,
    cloudTranscriptionMode: "byok",
    cloudTranscriptionProvider: "openai",
    cloudTranscriptionModel: "gpt-4o-mini-transcribe",
    cloudTranscriptionBaseUrl: "",
    ...over,
  });
  const mountPicker = (props) =>
    probes.mount("picker", () => {
      const commit = useRouteCommit("dictationStt");
      return Picker({
        mode: "cloud",
        transcriptionContext: "dictation",
        selectedLocalModel: "",
        useLocalWhisper: false,
        onCommit: commit,
        ...props,
      });
    });

  // Change-driving for each case below: the picker wrote the store directly.
  await t.test(
    "change-driving: speech: a model change at the same provider applies at once",
    async () => {
      reset(dictationCloud());
      const tree = await mountPicker({
        selectedCloudProvider: "openai",
        selectedCloudModel: "gpt-4o-mini-transcribe",
      });
      await probes.act(() => modelList(tree()).props.onModelSelect("whisper-1"));
      await probes.settle();
      assert.equal(useSettingsStore.getState().cloudTranscriptionModel, "whisper-1");
      assert.equal(useRouteDraftStore.getState().draft, null);
      assert.equal(toasts.length, 1);
    }
  );

  await t.test(
    "change-driving: speech: changing an active remote custom endpoint is staged",
    async () => {
      reset(
        dictationCloud({
          cloudTranscriptionProvider: "custom",
          cloudTranscriptionModel: "whisper-1",
          cloudTranscriptionBaseUrl: "https://stt-a.example.test/v1",
        })
      );
      const tree = await mountPicker({
        selectedCloudProvider: "custom",
        selectedCloudModel: "whisper-1",
        cloudTranscriptionBaseUrl: "https://stt-a.example.test/v1",
      });
      await probes.act(() =>
        endpointField(tree()).props.onUse({
          url: "https://stt-b.example.test/v1",
          model: "whisper-1",
        })
      );
      await probes.settle();
      assert.equal(
        useSettingsStore.getState().cloudTranscriptionBaseUrl,
        "https://stt-a.example.test/v1"
      );
      assert.deepEqual(useRouteDraftStore.getState().draft, {
        routeId: "dictationStt",
        kind: "target",
        target: {
          mode: "providers",
          provider: "custom",
          baseUrl: "https://stt-b.example.test/v1",
          model: "whisper-1",
        },
      });
    }
  );

  await t.test(
    "change-driving: speech: a loopback endpoint moving to a remote host is staged",
    async () => {
      reset(
        dictationCloud({
          cloudTranscriptionProvider: "custom",
          cloudTranscriptionModel: "whisper-1",
          cloudTranscriptionBaseUrl: "http://localhost:9000/v1",
        })
      );
      const tree = await mountPicker({
        selectedCloudProvider: "custom",
        selectedCloudModel: "whisper-1",
        cloudTranscriptionBaseUrl: "http://localhost:9000/v1",
      });
      await probes.act(() =>
        endpointField(tree()).props.onUse({
          url: "https://stt-b.example.test/v1",
          model: "whisper-1",
        })
      );
      await probes.settle();
      assert.equal(
        useSettingsStore.getState().cloudTranscriptionBaseUrl,
        "http://localhost:9000/v1"
      );
      assert.equal(
        useRouteDraftStore.getState().draft?.target.baseUrl,
        "https://stt-b.example.test/v1"
      );
    }
  );

  // Change-driving: the reconcile effect (:636-659) rewrote an invalid persisted pair on mount.
  await t.test(
    "change-driving: speech: an invalid persisted provider is shown, not rewritten",
    async () => {
      const commits = [];
      reset({
        meetingCloudTranscriptionProvider: "groq",
        meetingCloudTranscriptionModel: "whisper-large-v3",
      });
      const invalidTree = await probes.mount("meeting-picker", () =>
        Picker({
          mode: "cloud",
          streamingOnly: true,
          transcriptionContext: "meeting",
          selectedCloudProvider: "groq",
          selectedCloudModel: "whisper-large-v3",
          selectedLocalModel: "",
          useLocalWhisper: false,
          onCommit: (target) => commits.push(target),
        })
      );
      await probes.settle();
      assert.deepEqual(commits, []);
      const tabs = findElement(invalidTree(), (node) =>
        node.props?.providers?.some((p) => p.id === "openai")
      );
      assert.equal(tabs.props.selectedId, "groq", "the invalid saved provider remains displayed");
      assert.equal(useSettingsStore.getState().meetingCloudTranscriptionProvider, "groq");
    }
  );

  // Change-driving (I1 follow-up): the region Select called setCortiEnvironment directly.
  await t.test(
    "speech: a Corti region switch is staged; the tenant commits on leave and stages the active account path",
    async () => {
      const corti = dictationCloud({
        cloudTranscriptionProvider: "corti",
        cloudTranscriptionModel: "corti-transcribe",
        cortiEnvironment: "us",
        cortiTenant: "base",
      });
      reset(corti);
      let tree = await mountPicker({
        selectedCloudProvider: "corti",
        selectedCloudModel: "corti-transcribe",
      });
      const region = findElement(
        tree(),
        (node) => node.props?.value === "us" && typeof node.props?.onValueChange === "function"
      );
      await probes.act(() => region.props.onValueChange("eu"));
      await probes.settle();
      assert.equal(
        useSettingsStore.getState().cortiEnvironment,
        "us",
        "a new host waits for Apply"
      );
      assert.deepEqual(useRouteDraftStore.getState().draft, {
        routeId: "dictationStt",
        kind: "patch",
        patch: { cortiEnvironment: "eu" },
      });

      reset(corti);
      tree = await mountPicker({
        selectedCloudProvider: "corti",
        selectedCloudModel: "corti-transcribe",
      });
      const tenant = await probes.mount("tenant", () => {
        const element = findElement(tree(), (node) => node.type?.name === "CommitOnLeaveInput");
        return element.type(element.props);
      });
      await probes.act(() => tenant().props.onChange({ target: { value: "acme" } }));
      assert.equal(useSettingsStore.getState().cortiTenant, "base", "typing commits nothing");
      await probes.act(() => tenant().props.onBlur());
      await probes.settle();
      assert.equal(
        useSettingsStore.getState().cortiTenant,
        "base",
        "same host account path still waits for Apply"
      );
      assert.deepEqual(useRouteDraftStore.getState().draft?.patch, { cortiTenant: "acme" });
    }
  );

  await t.test(
    "change-driving: text: a model change at the same provider applies at once",
    async () => {
      reset({
        chatAgentMode: "providers",
        chatAgentProvider: "openai",
        chatAgentModel: "gpt-5.6-luna",
      });
      const tree = await probes.mount("selector", () => {
        const commit = useRouteCommit("chat");
        return Selector({
          mode: "cloud",
          credentialRef: "custom:chatIntelligence",
          reasoningModel: "gpt-5.6-luna",
          localReasoningProvider: "openai",
          cloudReasoningBaseUrl: "",
          onCommit: commit,
        });
      });
      await probes.act(() => modelList(tree()).props.onModelSelect("gpt-5.6-terra"));
      await probes.settle();
      assert.equal(useSettingsStore.getState().chatAgentModel, "gpt-5.6-terra");
      assert.equal(useRouteDraftStore.getState().draft, null);
    }
  );

  await t.test(
    "text: a custom endpoint moving from loopback to a remote host is staged",
    async () => {
      reset({
        chatAgentMode: "providers",
        chatAgentProvider: "custom",
        chatAgentModel: "llama3",
        chatAgentCloudBaseUrl: "http://localhost:1234/v1",
      });
      const tree = await probes.mount("selector", () => {
        const commit = useRouteCommit("chat");
        return Selector({
          mode: "cloud",
          credentialRef: "custom:chatIntelligence",
          reasoningModel: "llama3",
          localReasoningProvider: "custom",
          cloudReasoningBaseUrl: "http://localhost:1234/v1",
          onCommit: commit,
        });
      });
      const panel = findElement(tree(), (node) => typeof node.props?.onUseEndpoint === "function");
      await probes.act(() => panel.props.onUseEndpoint("https://llm.example.test/v1"));
      await probes.settle();
      assert.equal(useSettingsStore.getState().chatAgentCloudBaseUrl, "http://localhost:1234/v1");
      assert.deepEqual(useRouteDraftStore.getState().draft?.target, {
        mode: "providers",
        provider: "custom",
        baseUrl: "https://llm.example.test/v1",
        model: "llama3",
      });
      assert.equal(modelCalls.length, 0);
    }
  );

  await t.test(
    "change-driving: text: the Local mode tab (NotesOnboarding) applies at once",
    async () => {
      reset({ cleanupMode: "providers", cleanupProvider: "openai", cleanupModel: "gpt-5.6-luna" });
      const tree = await probes.mount("selector", () => {
        const commit = useRouteCommit("dictationCleanup");
        return Selector({
          reasoningModel: "gpt-5.6-luna",
          localReasoningProvider: "openai",
          cloudReasoningBaseUrl: "",
          onCommit: commit,
        });
      });
      const modeTabs = findElement(tree(), (node) =>
        node.props?.providers?.some?.((provider) => provider.id === "local")
      );
      await probes.act(() => modeTabs.props.onSelect("local"));
      await probes.settle();
      assert.equal(useSettingsStore.getState().cleanupMode, "local");
      assert.equal(useRouteDraftStore.getState().draft, null);
    }
  );

  await t.test(
    "self-hosted: Use this server on loopback applies at once (local → loopback)",
    async () => {
      reset({
        transcriptionMode: "local",
        useLocalWhisper: true,
        remoteTranscriptionUrl: "",
        remoteTranscriptionModel: "",
      });
      const tree = await probes.mount("server", () => {
        const commit = useRouteCommit("dictationStt");
        return SelfHostedPanel({
          service: "transcription",
          url: "",
          model: "",
          onUse: ({ url, model }) => void commit({ mode: "self-hosted", remoteUrl: url, model }),
        });
      });
      await probes.act(() =>
        endpointField(tree()).props.onUse({ url: "http://localhost:8178", model: "" })
      );
      await probes.settle();
      assert.equal(useSettingsStore.getState().transcriptionMode, "self-hosted");
      assert.equal(useSettingsStore.getState().remoteTranscriptionUrl, "http://localhost:8178");
      assert.equal(useRouteDraftStore.getState().draft, null);
    }
  );

  await t.test(
    "change-driving: self-hosted: Test probes the typed address and sends no key",
    async () => {
      const tree = await probes.mount("server", () =>
        SelfHostedPanel({ service: "transcription", url: "", model: "", onUse() {} })
      );
      const button = endpointField(tree()).props.actions({
        url: "http://192.168.1.20:8178",
        model: "",
      });
      assert.match(button.props.title, /settingsPage\.selfHosted\.testTitle/);
      assert.match(button.props.title, /192\.168\.1\.20:8178/);
      await probes.act(() => button.props.onClick());
      await probes.settle();
      assert.deepEqual(probeCalls, ["http://192.168.1.20:8178"]);
      assert.equal(modelCalls.length, 0, "never the authenticated discovery path");
    }
  );

  await t.test("change-driving: self-hosted: upload's panel is read-only", async () => {
    const tree = await probes.mount("server", () =>
      SelfHostedPanel({
        service: "transcription",
        url: "http://192.168.1.20:8178",
        model: "whisper-large-v3",
      })
    );
    assert.equal(endpointField(tree()), null);
    assert.ok(findElement(tree(), (node) => node.props?.children === "http://192.168.1.20:8178"));
  });

  await t.test(
    "change-driving: self-hosted: main's sealed refusal shows the Sealed copy (spec §5.4)",
    async () => {
      // Change-driving: v1 had no "sealed" code. Main gates probe-self-hosted as providerCheck: loopback
      // only while sealed, otherwise { ok: false, code: "sealed" }. The panel does not pre-empt main.
      nextProbe = { ok: false, code: "sealed" };
      const tree = await probes.mount("server", () =>
        SelfHostedPanel({ service: "transcription", url: "", model: "", onUse() {} })
      );
      const button = endpointField(tree()).props.actions({
        url: "http://192.168.1.20:8178",
        model: "",
      });
      assert.equal(button.props.disabled, false);
      await probes.act(() => button.props.onClick());
      await probes.settle();
      const status = findElement(tree(), (node) => node.props?.role === "status");
      assert.match(String(status.props.children), /routes\.state\.sealed/);
      assert.doesNotMatch(String(status.props.children), /testFail/);
      nextProbe = { ok: true, count: 3 };
    }
  );
});

// Source guard, change-driving: each of these names is a direct write or a discovery side path today.
test("change-driving: pickers no longer write provider, model or endpoint fields themselves", () => {
  const banned = {
    "components/TranscriptionModelPicker.tsx": [
      /switchCloudTranscriptionProvider/,
      /setCloudTranscriptionBaseUrl/,
      /onCloudModelSelect/,
      /onLocalModelSelect/,
      /validateAndSelectModel/,
      /setCortiEnvironment/,
      /setCortiTenant/,
    ],
    // checkStatusOnMount is onboarding's opt-in; Settings (and NotesOnboarding, via the selector) never passes it.
    "components/ReasoningModelSelector.tsx": [
      /setReasoningModel\(/,
      /setLocalReasoningProvider/,
      /setCloudReasoningBaseUrl/,
      /setReasoningModeProp/,
      /llamaServerStop/,
      /checkStatusOnMount/,
    ],
    "components/OpenAICompatiblePanel.tsx": [/getModelListBaseCandidates/, /setBaseUrl/, /onBlur/],
    "components/SelfHostedPanel.tsx": [/onUrlChange/, /onModelChange/],
    "components/settings/UploadSettings.tsx": [
      /setRemoteTranscriptionUrl/,
      /setUploadCloudTranscriptionProvider/,
    ],
    // C1/I2: the unconditional mount read (:60-62), the double read behind Refresh (action(refresh)
    // reads twice) and Connect gated on a status read that never ran.
    "components/CodexConnection.tsx": [
      /useEffect\(\(\) => \{\s*void refresh\(\)/,
      /action\(refresh\)/,
      /!status\?\.available/,
    ],
    // R2-3: no dropped acknowledgement; R2-1: no direct enterprise writer.
    "components/ReasoningModelSelector.tsx#saves": [
      /saveApiKey=\{[^}]*\(\) => (undefined|\{\})/,
      /\|\| \(\(\) => \{\}\)/,
    ],
    "components/EnterpriseProviderConfig.tsx": [
      /settings\.set(BedrockRegion|AzureEndpoint|VertexProject|VertexLocation)/,
    ],
  };
  for (const [entry, patterns] of Object.entries(banned)) {
    const file = entry.split("#")[0];
    const source = fs.readFileSync(path.join(SRC, file), "utf8");
    for (const pattern of patterns)
      assert.doesNotMatch(source, pattern, `${file} still matches ${pattern}`);
  }
  const panel = fs.readFileSync(path.join(SRC, "components/OpenAICompatiblePanel.tsx"), "utf8");
  assert.equal(
    (panel.match(/personalInference\.models\(/g) ?? []).length,
    1,
    "one discovery call site"
  );
  const codex = fs.readFileSync(path.join(SRC, "components/CodexConnection.tsx"), "utf8");
  assert.equal(
    (codex.match(/codexStatus\(/g) ?? []).length,
    1,
    "one status call site, inside refresh"
  );
  assert.match(codex, /if \(checkStatusOnMount\) void refresh\(\)/, "the mount read is opt-in");
  assert.match(
    codex,
    /s\.facts\.credentials\?\.get\("codex"\)/,
    "stored sign-in comes from main's credential list"
  );
});

// Change-driving: an unknown persisted text provider was visually substituted
// with OpenAI even though the underlying settings were left unchanged.
test("change-driving: invalid persisted text provider remains visible without a replacement commit", async (t) => {
  installBrowserGlobals(t, { window: { electronAPI: routeTestApi() } });
  const vite = await rendererServer(t, "loqui-invalid-text-picker-");
  const Selector = (await vite.ssrLoadModule("/components/ReasoningModelSelector.tsx")).default;
  const probes = createProbeRoot(t);
  const commits = [];
  const tree = await probes.mount("selector", () =>
    Selector({
      mode: "cloud",
      reasoningModel: "saved-unknown-model",
      localReasoningProvider: "saved-unknown-provider",
      cloudReasoningBaseUrl: "",
      onCommit: (target) => commits.push(target),
      onRoutePatch() {},
    })
  );
  const tabs = findElement(tree(), (node) => node.props?.providers?.some((p) => p.id === "openai"));
  assert.equal(tabs.props.selectedId, "saved-unknown-provider");
  assert.deepEqual(commits, []);
  assert.ok(findElement(tree(), (node) => node.props?.["data-invalid-selection"] !== undefined));
});
