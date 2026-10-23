const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");
const { createProbeRoot, findElement } = require("../lib/probeRoot");
const { rendererServer, routeTestApi, primeRouteFacts } = require("../lib/routeTestApi");

test("[baseline guard] actual screen-context row describes inherited/off and override routes without changing switches or permissions (mounted)", async (t) => {
  let permissionRequests = 0;
  installBrowserGlobals(t, {
    window: {
      dispatchEvent: () => true,
      electronAPI: routeTestApi({ present: ["anthropic", "openai"] }),
    },
  });
  globalThis.__task17Permission = () => {
    permissionRequests++;
  };
  t.after(() => {
    delete globalThis.__task17Permission;
  });
  const vite = await rendererServer(t, "loqui-screen-context-integration-", {
    mockModules: {
      "/hooks/useScreenRecordingPermission":
        "export function useScreenRecordingPermission() { return { supported: true, isMacOS: true, granted: false, request: () => globalThis.__task17Permission() }; }",
    },
  });
  await primeRouteFacts(vite);
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteDraftStore } = await vite.ssrLoadModule("/stores/routeDraftStore.ts");
  const Agent = (await vite.ssrLoadModule("/components/settings/DictationAgentSettings.tsx"))
    .default;
  const probes = createProbeRoot(t);
  useSettingsStore.setState({
    useDictationAgent: true,
    voiceAgentScreenContext: false,
    useDictationAgentVisionModel: false,
    dictationAgentMode: "providers",
    dictationAgentProvider: "anthropic",
    dictationAgentModel: "claude-sonnet-4-6",
  });
  const tree = await probes.mount("agent", () => Agent());
  const row = () => findElement(tree(), (n) => n.props?.settingId === "screenContext");
  const copy = () =>
    findElement(row(), (n) => n.props?.label === "dictationAgent.screenContext.enable").props
      .description;
  assert.match(copy(), /"provider":"Anthropic"/);
  assert.match(copy(), /"host":"api.anthropic.com"/);
  assert.match(copy(), /"payload":"routes.payload.screenshot"/);
  assert.doesNotMatch(copy(), /ready|enabled|installed|state\.off/i);
  const routeSwitch = findElement(row(), (n) => n.props?.settingKey === "voiceAgentScreenContext");
  assert.equal(routeSwitch.props.routeId, "assistantVision", "original planner switch remains");
  await probes.act(() => useSettingsStore.setState({ voiceAgentScreenContext: true }));
  assert.match(copy(), /routes.payload.request/);
  assert.match(copy(), /routes.payload.screenshot/);
  await probes.act(() =>
    useSettingsStore.setState({
      useDictationAgentVisionModel: true,
      dictationAgentVisionProvider: "openai",
      dictationAgentVisionModel: "gpt-4o",
    })
  );
  assert.match(copy(), /"provider":"OpenAI"/);
  assert.match(copy(), /"host":"api.openai.com"/);
  assert.doesNotMatch(copy(), /Anthropic/);
  await probes.act(() =>
    useSettingsStore.setState({ dictationAgentVisionProvider: "", dictationAgentVisionModel: "" })
  );
  assert.match(
    copy(),
    /"provider":"Anthropic"/,
    "empty override fields inherit the assistant configuration"
  );
  await probes.act(() =>
    useSettingsStore.setState({ dictationAgentProvider: "", dictationAgentModel: "" })
  );
  assert.equal(copy(), "dictationAgent.screenContext.destinationUnspecified");
  assert.equal(permissionRequests, 0);
  assert.equal(useRouteDraftStore.getState().draft, null);
  assert.equal(useSettingsStore.getState().voiceAgentScreenContext, true);
});
