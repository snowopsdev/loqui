const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const {
  SRC,
  primeRouteFacts,
  rendererServer,
  routeTestApi,
  toastCapture,
} = require("../lib/routeTestApi");

test("change-driving: enable switches and web search go through the route planner", async (t) => {
  const screenContext = [];
  installBrowserGlobals(t, {
    window: {
      dispatchEvent: () => true,
      electronAPI: routeTestApi({
        present: ["openai"],
        extra: {
          setScreenContextEnabled: async (enabled) => {
            screenContext.push(enabled);
            return { success: true };
          },
          checkScreenRecordingAccess: async () => ({
            granted: true,
            status: "granted",
            supported: true,
          }),
        },
      }),
      location: { search: "" },
    },
  });
  const vite = await rendererServer(t, "loqui-route-switches-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const { RouteSwitch } = await vite.ssrLoadModule("/components/settings/routing/RouteSwitch.tsx");
  const DictationAgentSettings = (
    await vite.ssrLoadModule("/components/settings/DictationAgentSettings.tsx")
  ).default;
  const DictationTranslationSettings = (
    await vite.ssrLoadModule("/components/settings/DictationTranslationSettings.tsx")
  ).default;
  const InferenceConfigEditor = (
    await vite.ssrLoadModule("/components/settings/InferenceConfigEditor.tsx")
  ).default;
  await primeRouteFacts(vite);
  const { toasts, wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });

  const live = () => useSettingsStore.getState();
  const draft = () => useRouteDraftStore.getState().draft;
  const reset = async (state) => {
    await probes.act(() => {
      useRouteDraftStore.getState().discard();
      useSettingsStore.setState(state);
      toasts.length = 0;
    });
  };
  const isToggle = (node) =>
    typeof node.props?.onChange === "function" && typeof node.props?.checked === "boolean";
  const switchFor = (tree, key) => findElement(tree, (node) => node.props?.settingKey === key);
  // Mounts the element a call site rendered (its hooks run in a probe) and flips its Toggle.
  let mounts = 0;
  const flip = async (element, next) => {
    assert.ok(element, "the call site renders the switch");
    const view = await probes.mount(`switch-${++mounts}`, () => element.type(element.props));
    const toggle = findElement(view(), isToggle);
    await probes.act(() => toggle.props.onChange(next));
    await probes.settle();
  };

  // Change-driving: AiModelsSection's Toggle called setUseCleanupModel directly.
  await t.test(
    "change-driving: cleanup: on for a cloud route is staged; off is instant with Undo",
    async () => {
      const cloud = {
        cleanupMode: "providers",
        cleanupProvider: "openai",
        cleanupModel: "gpt-5.6-sol",
      };
      const cleanup = React.createElement(RouteSwitch, {
        routeId: "dictationCleanup",
        settingKey: "useCleanupModel",
      });
      await reset({ ...cloud, useCleanupModel: false });
      await flip(cleanup, true);
      assert.equal(live().useCleanupModel, false, "nothing is sent before Apply");
      assert.deepEqual(draft(), {
        routeId: "dictationCleanup",
        kind: "patch",
        patch: { useCleanupModel: true },
      });
      assert.equal(toasts.length, 0);

      await reset({ ...cloud, useCleanupModel: true });
      await flip(cleanup, false);
      assert.equal(live().useCleanupModel, false);
      assert.equal(draft(), null);
      assert.match(toasts[0].title, /routes\.toast\.off/);
      assert.equal(toasts[0].actions?.[0]?.label, "routes.toast.undo");

      await reset({
        cleanupMode: "local",
        cleanupProvider: "qwen",
        cleanupModel: "qwen3-4b",
        useCleanupModel: false,
      });
      await flip(cleanup, true);
      assert.equal(live().useCleanupModel, true, "a route on this device turns on at once");

      // AiModelsSection is not exported; its call site is pinned here.
      const source = fs.readFileSync(path.join(SRC, "components/SettingsPage.tsx"), "utf8");
      assert.match(
        source,
        /<RouteSwitch routeId="dictationCleanup" settingKey="useCleanupModel" \/>/
      );
      assert.doesNotMatch(source, /setUseCleanupModel|updateCleanupSettings\(/);
    }
  );

  // Change-driving: the assistant's three Toggles called store setters directly.
  await t.test(
    "change-driving: assistant: enable, screen context and the vision override go through the planner",
    async () => {
      const cloud = {
        dictationAgentMode: "providers",
        dictationAgentProvider: "openai",
        dictationAgentModel: "gpt-5.6-sol",
        useDictationAgentVisionModel: false,
      };
      await reset({ ...cloud, useDictationAgent: false, voiceAgentScreenContext: false });
      let page = await probes.mount("agent", () => DictationAgentSettings());
      await flip(switchFor(page(), "useDictationAgent"), true);
      assert.equal(live().useDictationAgent, false, "the assistant would send to OpenAI: staged");
      assert.deepEqual(draft(), {
        routeId: "voiceAssistant",
        kind: "patch",
        patch: { useDictationAgent: true },
      });

      await reset({ ...cloud, useDictationAgent: true, voiceAgentScreenContext: false });
      screenContext.length = 0;
      page = await probes.mount("agent", () => DictationAgentSettings());
      await flip(switchFor(page(), "voiceAgentScreenContext"), true);
      assert.equal(live().voiceAgentScreenContext, false, "screenshots wait for Apply");
      assert.deepEqual(screenContext, [], "main is not told before the change is applied");
      assert.equal(draft().routeId, "assistantVision");

      await reset({ ...cloud, useDictationAgent: true, voiceAgentScreenContext: true });
      page = await probes.mount("agent", () => DictationAgentSettings());
      await flip(switchFor(page(), "voiceAgentScreenContext"), false);
      assert.equal(live().voiceAgentScreenContext, false, "off is instant");
      assert.deepEqual(screenContext, [false], "Task 7's commit tells main");

      await reset({
        ...cloud,
        useDictationAgent: true,
        voiceAgentScreenContext: true,
        dictationAgentVisionProvider: "anthropic",
        dictationAgentVisionModel: "claude-sonnet-5",
      });
      page = await probes.mount("agent", () => DictationAgentSettings());
      await flip(switchFor(page(), "useDictationAgentVisionModel"), true);
      assert.equal(
        live().useDictationAgentVisionModel,
        false,
        "screenshots would move to Anthropic: staged"
      );
      assert.equal(draft().routeId, "assistantVision");

      await reset({ ...cloud, useDictationAgent: true, voiceAgentScreenContext: true });
      page = await probes.mount("agent", () => DictationAgentSettings());
      await flip(switchFor(page(), "useDictationAgent"), false);
      assert.equal(live().useDictationAgent, false, "off is instant");
      assert.equal(draft(), null);
    }
  );

  // Change-driving: the translation Toggle called setUseDictationTranslation directly.
  await t.test(
    "change-driving: translation: on for a cloud route is staged; off is instant",
    async () => {
      const cloud = {
        translationMode: "providers",
        translationProvider: "openai",
        translationModel: "gpt-5.6-sol",
      };
      await reset({ ...cloud, useDictationTranslation: false });
      let page = await probes.mount("translation", () => DictationTranslationSettings());
      await flip(switchFor(page(), "useDictationTranslation"), true);
      assert.equal(live().useDictationTranslation, false);
      assert.deepEqual(draft(), {
        routeId: "translation",
        kind: "patch",
        patch: { useDictationTranslation: true },
      });

      await reset({ ...cloud, useDictationTranslation: true });
      page = await probes.mount("translation", () => DictationTranslationSettings());
      await flip(switchFor(page(), "useDictationTranslation"), false);
      assert.equal(live().useDictationTranslation, false);
      assert.equal(draft(), null);
    }
  );

  // Change-driving: ProviderSearchPreference wrote personalWebSearch:<scope> through useLocalStorage.
  await t.test(
    "change-driving: web search: on for a cloud provider is staged; off is instant",
    async () => {
      const chat = {
        chatAgentMode: "providers",
        chatAgentProvider: "openai",
        chatAgentModel: "gpt-5.6-sol",
      };
      await reset(chat);
      globalThis.localStorage.setItem("personalWebSearch:chatIntelligence", "false");
      const editor = await probes.mount("chat", () =>
        InferenceConfigEditor({ scope: "chatIntelligence" })
      );
      const preference = () =>
        findElement(
          editor(),
          (node) =>
            node.type?.name === "ProviderSearchPreference" &&
            node.props?.scope === "chatIntelligence"
        );
      await flip(preference(), true);
      assert.equal(
        globalThis.localStorage.getItem("personalWebSearch:chatIntelligence"),
        "false",
        "nothing is sent before Apply"
      );
      assert.deepEqual(draft(), {
        routeId: "chat",
        kind: "patch",
        patch: { "providerSearch:chatIntelligence": true },
      });

      await reset(chat);
      await probes.act(() => live().applyRoutePatch({ "providerSearch:chatIntelligence": true }));
      await flip(preference(), false);
      assert.equal(
        globalThis.localStorage.getItem("personalWebSearch:chatIntelligence"),
        "false",
        "off is instant"
      );
      assert.equal(draft(), null);
    }
  );
});

// Change-driving I1: setup must be reachable while a staged remote enable
// still leaves the feature's committed switch off.
test("change-driving FIX1: disabled remote features expose missing model/key setup and retain enable through Apply/Undo", async (t) => {
  for (const [name, module, routeId, enabledKey, prefix] of [
    [
      "translation",
      "/components/settings/DictationTranslationSettings.tsx",
      "translation",
      "useDictationTranslation",
      "translation",
    ],
    [
      "assistant",
      "/components/settings/DictationAgentSettings.tsx",
      "voiceAssistant",
      "useDictationAgent",
      "dictationAgent",
    ],
  ]) {
    for (const missing of ["model", "key"])
      await t.test(`change-driving FIX1: ${name} missing ${missing}`, async (t) => {
        const saves = [];
        const api = routeTestApi({ present: missing === "key" ? [] : ["openai"], saves });
        installBrowserGlobals(t, { window: { dispatchEvent: () => true, electronAPI: api } });
        const vite = await rendererServer(t, `loqui-fix1-${name}-${missing}-`);
        const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
        const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
        const Page = (await vite.ssrLoadModule(module)).default;
        const { RouteSwitch } = await vite.ssrLoadModule(
          "/components/settings/routing/RouteSwitch.tsx"
        );
        const { StagedRoutePanel } = await vite.ssrLoadModule(
          "/components/settings/routing/StagedRoutePanel.tsx"
        );
        const { TEST_COPY } = require("../lib/routeStateFixture");
        await primeRouteFacts(vite);
        const { wrap } = await toastCapture(vite);
        const probes = createProbeRoot(t, { wrap });
        useSettingsStore.setState({
          [enabledKey]: false,
          [`${prefix}Mode`]: "providers",
          [`${prefix}Provider`]: "openai",
          [`${prefix}Model`]: missing === "model" ? "" : "gpt-6-astra",
          voiceAgentScreenContext: false,
        });
        const before = { ...useSettingsStore.getState() };
        const page = await probes.mount("page", () => Page());
        const switchElement = findElement(page(), (node) => node.props?.settingKey === enabledKey);
        const toggle = await probes.mount("toggle", () => RouteSwitch(switchElement.props));
        await probes.act(() => toggle().props.onChange(true));
        assert.equal(useSettingsStore.getState()[enabledKey], false);
        const panelElement = findElement(
          page(),
          (node) => node.type === StagedRoutePanel && node.props.routeId === routeId
        );
        assert.ok(panelElement, "the disabled feature renders a reachable staged setup panel");
        const panel = await probes.mount("panel", () => panelElement.type(panelElement.props));
        const view = () =>
          findElement(panel(), (node) => typeof node.props?.onTarget === "function");
        assert.ok(view());
        assert.equal(
          drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY).blocker,
          missing === "key" ? "needsKey" : "needsModel"
        );
        if (missing === "model") {
          const pick = view().props.models[0].id;
          await probes.act(() =>
            view().props.onTarget({ mode: "providers", provider: "openai", model: pick })
          );
          await probes.settle();
        } else {
          await probes.act(() => view().props.credential.inputs[0].save("fixture-key"));
          await probes.settle();
          assert.deepEqual(saves, [["openai", "key"]]);
        }
        assert.equal(
          useSettingsStore.getState()[enabledKey],
          false,
          "setup does not enable the route early"
        );
        assert.equal(useSettingsStore.getState()[`${prefix}Model`], before[`${prefix}Model`]);
        const plan = drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY);
        assert.equal(plan.patch[enabledKey], true);
        assert.equal(plan.blocker, null);
        let applied;
        await probes.act(async () => {
          applied = await drafts.applyDraft(TEST_COPY);
        });
        assert.equal(applied.applied, true);
        assert.equal(useSettingsStore.getState()[enabledKey], true);
        let undone;
        await probes.act(async () => {
          undone = await applied.undo();
        });
        if (undone === "staged") await probes.act(() => drafts.applyDraft(TEST_COPY));
        for (const key of Object.keys(applied.plan.undoPatch))
          assert.deepEqual(useSettingsStore.getState()[key], before[key], `Undo restores ${key}`);
      });
  }
});

// Change-driving I1 source guard for the private cleanup section and vision's
// nested editor gates. Existing live editors are never exposed while disabled.
test("change-driving FIX1: cleanup and vision have setup outside their disabled editor gates", () => {
  const cleanup = fs.readFileSync(path.join(SRC, "components/SettingsPage.tsx"), "utf8");
  const agent = fs.readFileSync(
    path.join(SRC, "components/settings/DictationAgentSettings.tsx"),
    "utf8"
  );
  assert.match(cleanup, /!useCleanupModel\s*&&\s*<StagedRoutePanel routeId="dictationCleanup"/);
  assert.match(agent, /<StagedRoutePanel routeId="assistantVision"/);
});

// Baseline guard FIX1: enabling the assistant can be blocked by its separately
// configured screenshot recipient. Its setup is reachable while the agent is off.
test("baseline guard FIX1: a coupled vision credential is reachable before assistant enable", async (t) => {
  installBrowserGlobals(t, {
    window: { dispatchEvent: () => true, electronAPI: routeTestApi({ present: ["openai"] }) },
  });
  const vite = await rendererServer(t, "loqui-fix1-coupled-vision-key-");
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const drafts = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const Page = (await vite.ssrLoadModule("/components/settings/DictationAgentSettings.tsx"))
    .default;
  const { StagedRoutePanel } = await vite.ssrLoadModule(
    "/components/settings/routing/StagedRoutePanel.tsx"
  );
  const { TEST_COPY } = require("../lib/routeStateFixture");
  await primeRouteFacts(vite);
  const { wrap } = await toastCapture(vite);
  const probes = createProbeRoot(t, { wrap });
  useSettingsStore.setState({
    useDictationAgent: false,
    voiceAgentScreenContext: true,
    useDictationAgentVisionModel: true,
    dictationAgentMode: "providers",
    dictationAgentProvider: "openai",
    dictationAgentModel: "gpt-6-astra",
    dictationAgentVisionProvider: "anthropic",
    dictationAgentVisionModel: "claude-sonnet-5",
  });
  const page = await probes.mount("page", () => Page());
  await probes.act(() =>
    drafts.requestRoutePatch("voiceAssistant", { useDictationAgent: true }, TEST_COPY)
  );
  const element = findElement(
    page(),
    (node) => node.type === StagedRoutePanel && node.props.routeId === "assistantVision"
  );
  assert.ok(element);
  const panel = await probes.mount("vision", () => element.type(element.props));
  const view = () => findElement(panel(), (node) => typeof node.props?.onTarget === "function");
  assert.equal(view().props.credential.credentialId, "anthropic");
  assert.equal(
    drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY).blocker,
    "needsKey"
  );
  await probes.act(() => view().props.credential.inputs[0].save("fixture-anthropic-key"));
  await probes.settle();
  await probes.act(() =>
    view().props.onTarget({
      mode: "providers",
      provider: "anthropic",
      model: view().props.models[0].id,
    })
  );
  await probes.settle();
  const plan = drafts.planDraft(drafts.useRouteDraftStore.getState().draft, TEST_COPY);
  assert.equal(plan.patch.useDictationAgent, true);
  assert.ok(plan.changes.some((change) => change.id === "assistantVision" && change.coupled));
  assert.equal(plan.blocker, null);
  assert.equal(useSettingsStore.getState().useDictationAgent, false);
  let applied;
  await probes.act(async () => {
    applied = await drafts.applyDraft(TEST_COPY);
  });
  assert.equal(applied.applied, true);
  assert.equal(useSettingsStore.getState().useDictationAgent, true);
  await probes.act(() => applied.undo());
  assert.equal(useSettingsStore.getState().useDictationAgent, false);
  assert.equal(useSettingsStore.getState().dictationAgentVisionModel, "claude-sonnet-5");
});
