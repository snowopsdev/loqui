const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("personal runtime settings preserve independently selected local and remote tasks", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "personal-settings-isolation-" });
  const { useSettingsStore, getSettings, selectResolvedLLMConfig } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  useSettingsStore.setState({
    cleanupMode: "local",
    cleanupProvider: "local",
    cleanupModel: "qwen3.5-2b-q4_k_m",
    chatAgentMode: "providers",
    chatAgentProvider: "codex",
    chatAgentModel: "chosen-codex-model",
    noteFormattingMode: "providers",
    noteFormattingProvider: "anthropic",
    noteFormattingModel: "chosen-note-model",
    translationMode: "providers",
    translationProvider: "gemini",
    translationModel: "chosen-translation-model",
  });
  assert.equal(
    getSettings(),
    useSettingsStore.getState(),
    "no organization overlay can rewrite a choice"
  );
  for (const [scope, provider, model] of [
    ["dictationCleanup", "local", "qwen3.5-2b-q4_k_m"],
    ["chatIntelligence", "codex", "chosen-codex-model"],
    ["noteFormatting", "anthropic", "chosen-note-model"],
    ["dictationTranslation", "gemini", "chosen-translation-model"],
  ]) {
    const selected = selectResolvedLLMConfig(getSettings(), scope);
    assert.equal(selected.provider, provider);
    assert.equal(selected.model, model);
  }
  useSettingsStore.setState({
    cleanupMode: "providers",
    cleanupProvider: "custom",
    cleanupModel: "paid-cleanup-model",
    cleanupCloudBaseUrl: "https://cleanup.example/v1",
    noteFormattingProvider: "",
    noteFormattingModel: "",
    noteFormattingCloudBaseUrl: "",
    noteFormattingRemoteUrl: "",
  });
  const note = selectResolvedLLMConfig(getSettings(), "noteFormatting");
  assert.equal(note.provider, "");
  assert.equal(note.model, "");
  assert.equal(
    note.cloudBaseUrl,
    undefined,
    "missing note settings cannot inherit another task's endpoint"
  );
});
