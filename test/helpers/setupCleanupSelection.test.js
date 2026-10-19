const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { MIGRATED_STORAGE } = require("../lib/routeStateFixture");

test("actual setup selection captures full selected nonsecret config; every meaningful field and main generation revokes it", async (t) => {
  installBrowserGlobals(t, { initialStorage: MIGRATED_STORAGE });
  const vite = await createRendererServer(t, { cachePrefix: "loqui-setup-selection-" });
  const service = await vite.ssrLoadModule("/services/capturedCleanupOperation.ts");
  const { useSettingsStore: store } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { useRouteFactsStore: facts } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  store.setState({
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "custom",
    cleanupModel: "fixture-a",
    cleanupCloudBaseUrl: "https://fixture.invalid/path-a",
    cleanupDisableThinking: true,
    preferredLanguage: "en",
    uiLanguage: "en",
    customDictionary: ["Maya"],
    customPrompts: { cleanup: "prompt-a" },
    cleanupCustomApiKey: "fixture-secret-must-stay-out",
  });
  const selected = service.captureSetupCleanupSelection();
  assert.equal(selected.baseUrl, "https://fixture.invalid/path-a");
  assert.equal(selected.model, "fixture-a");
  assert.equal(selected.inferenceScope, "dictationCleanup");
  assert.deepEqual(selected.cleanupContext.dictionary, ["Maya"]);
  assert.ok(selected.systemPrompt.includes("prompt-a"));
  assert.equal(JSON.stringify(selected).includes("fixture-secret-must-stay-out"), false);
  assert.equal(service.isSetupCleanupSelectionCurrent(selected), true);
  for (const [field, value] of [
    ["cleanupCloudBaseUrl", "https://fixture.invalid/path-b"],
    ["cleanupModel", "fixture-b"],
    ["cleanupProvider", "openai"],
    ["cleanupDisableThinking", false],
    ["preferredLanguage", "fr"],
    ["uiLanguage", "de"],
    ["chineseScriptPreference", "traditional"],
    ["customDictionary", ["Thursday"]],
    ["customPrompts", { cleanup: "prompt-b" }],
    ["useCleanupModel", false],
  ]) {
    const previous = store.getState()[field];
    store.setState({ [field]: value });
    assert.equal(service.isSetupCleanupSelectionCurrent(selected), false, field);
    store.setState({ [field]: previous });
  }
  facts.setState(({ facts: old }) => ({
    facts: { ...old, credentialGenerations: new Map([["custom:dictationCleanup", 1]]) },
  }));
  const generationA = service.captureSetupCleanupSelection();
  facts.setState(({ facts: old }) => ({
    facts: { ...old, credentialGenerations: new Map([["custom:dictationCleanup", 2]]) },
  }));
  assert.equal(service.isSetupCleanupSelectionCurrent(generationA), false);
  store.setState({
    cleanupProvider: "vertex",
    vertexAuthSource: "apiKey",
    vertexProject: "project-a",
    vertexLocation: "us-central1",
  });
  const vertex = service.captureSetupCleanupSelection();
  for (const [field, value] of [
    ["vertexAuthSource", "adc"],
    ["vertexProject", "project-b"],
    ["vertexLocation", "europe-west1"],
  ]) {
    const previous = store.getState()[field];
    store.setState({ [field]: value });
    assert.equal(service.isSetupCleanupSelectionCurrent(vertex), false, field);
    store.setState({ [field]: previous });
  }
});
