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
