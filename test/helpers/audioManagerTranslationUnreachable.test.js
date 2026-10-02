const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

// A translation hotkey recording whose translation step cannot run still pastes
// the raw transcript. The user has to be told why it was not translated whether
// or not a cleanup model happens to be configured.

const SETTINGS_KEY = "__audioTranslationUnreachableSettings";

function loadWith(t, { cleanupModel }) {
  return loadAudioManager(t, {
    cachePrefix: "openwhispr-audio-translation-unreachable-",
    settingsKey: SETTINGS_KEY,
    settings: {
      useCleanupModel: Boolean(cleanupModel),
      useDictationAgent: false,
      useDictationTranslation: true,
      translationTargetLanguage: "es",
      preferredLanguage: "en",
    },
    mockModules: {
      "/stores/settingsStore": `
        export const getSettings = () => globalThis.${SETTINGS_KEY};
        export const getEffectiveCleanupModel = () => ${JSON.stringify(cleanupModel)};
        export const selectResolvedLLMConfig = () => ({
          mode: "providers", provider: "openai", model: ${JSON.stringify(cleanupModel)}
        });
        export const isCloudCleanupMode = () => false;
        export const isCloudDictationAgentMode = () => false;
        export const isCloudTranslationMode = () => false;
        export const useSettingsStore = { subscribe: () => () => {} };
      `,
      "/dictationAgentInference": `
        export const resolveDictationAgentInference = () => ({
          reachable: false, model: "", displayProvider: "none", config: {}
        });
        export const resolveDictationAgentVisionInference = () => ({
          active: false, model: "", config: {}
        });
      `,
      "/dictationTranslationInference": `
        export const resolveDictationTranslationInference = () => ({
          reachable: false, model: "", displayProvider: "none", config: {}
        });
      `,
    },
  });
}

for (const [label, cleanupModel] of [
  ["with a cleanup model", "cleanup-model"],
  ["without any cleanup model", ""],
]) {
  test(`unreachable translation ${label} pastes the raw text and reports the fallback`, async (t) => {
    const { createManager } = await loadWith(t, { cleanupModel });
    const reasons = [];
    const manager = createManager({
      voiceAgentRequested: false,
      translationRequested: true,
      pendingCleanupFailure: null,
      pendingAssistantConversation: null,
      pendingSelectionEdit: null,
      isReasoningAvailable: async () => true,
      processWithReasoningModel: async (text) => text,
      onTranslationFallback: ({ reason }) => reasons.push(reason),
    });

    const text = await manager.processTranscriptionCore("original dictation", "local");

    assert.equal(text, "original dictation");
    assert.deepEqual(reasons, ["unreachable"]);
  });
}
