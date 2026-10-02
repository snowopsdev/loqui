const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

// A translation hotkey recording that returns untranslated text still pastes
// the raw transcript. The user has to be told why, exactly once, on every path
// that does so: with or without a cleanup model, with reasoning unavailable,
// and when routing itself fails.

const SETTINGS_KEY = "__audioTranslationUnreachableSettings";

function loadWith(t, { cleanupModel, translationReachable = false }) {
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
        export const selectResolvedLLMConfig = () => {
          if (globalThis.${SETTINGS_KEY}.__throwWhileRouting) throw new Error("routing exploded");
          return { mode: "providers", provider: "openai", model: ${JSON.stringify(cleanupModel)} };
        };
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
      "/config/prompts": `
        export const resolvePrompt = () => "translate prompt";
        export const appendScreenContextSuffix = (prompt) => prompt;
        export const wrapCleanupTranscript = (text) => text;
        export const getCleanupSystemPrompt = () => "cleanup prompt";
      `,
      "/dictationTranslationInference": `
        export const resolveDictationTranslationInference = () => ({
          reachable: ${translationReachable},
          model: ${JSON.stringify(translationReachable ? "translation-model" : "")},
          displayProvider: "none",
          config: {}
        });
      `,
    },
  });
}

function makeManager(createManager, reasons, overrides = {}) {
  return createManager({
    voiceAgentRequested: false,
    translationRequested: true,
    pendingCleanupFailure: null,
    pendingAssistantConversation: null,
    pendingSelectionEdit: null,
    isReasoningAvailable: async () => true,
    processWithReasoningModel: async (text) => text,
    onTranslationFallback: ({ reason }) => reasons.push(reason),
    ...overrides,
  });
}

for (const [label, cleanupModel] of [
  ["with a cleanup model", "cleanup-model"],
  ["without any cleanup model", ""],
]) {
  test(`unreachable translation ${label} pastes the raw text and reports the fallback`, async (t) => {
    const { createManager } = await loadWith(t, { cleanupModel });
    const reasons = [];
    const manager = makeManager(createManager, reasons);

    const text = await manager.processTranscriptionCore("original dictation", "local");

    assert.equal(text, "original dictation");
    assert.deepEqual(reasons, ["unreachable"]);
  });
}

test("unreachable translation reports the fallback when reasoning is unavailable", async (t) => {
  const { createManager } = await loadWith(t, { cleanupModel: "cleanup-model" });
  const reasons = [];
  const manager = makeManager(createManager, reasons, { isReasoningAvailable: async () => false });

  const text = await manager.processTranscriptionCore("original dictation", "local");

  assert.equal(text, "original dictation");
  assert.deepEqual(reasons, ["unreachable"]);
});

test("a routing failure before a route is chosen reports the translation as failed", async (t) => {
  const { createManager, setSettings } = await loadWith(t, { cleanupModel: "cleanup-model" });
  setSettings({ ...globalThis[SETTINGS_KEY], __throwWhileRouting: true });
  const reasons = [];
  const manager = makeManager(createManager, reasons);

  const text = await manager.processTranscriptionCore("original dictation", "local");

  assert.equal(text, "original dictation");
  assert.deepEqual(reasons, ["failed"]);
});

test("a cleanup route that fails after the unreachable notice does not report again", async (t) => {
  const { createManager } = await loadWith(t, { cleanupModel: "cleanup-model" });
  const reasons = [];
  const manager = makeManager(createManager, reasons, {
    processWithReasoningModel: async () => {
      throw new Error("cleanup down");
    },
  });

  const text = await manager.processTranscriptionCore("original dictation", "local");

  assert.equal(text, "original dictation");
  assert.deepEqual(reasons, ["unreachable"]);
});

test("a translation step that fails is reported once, by the chain", async (t) => {
  const { createManager } = await loadWith(t, {
    cleanupModel: "cleanup-model",
    translationReachable: true,
  });
  const reasons = [];
  const calls = [];
  const manager = makeManager(createManager, reasons, {
    processWithReasoningModel: async (_text, model) => {
      calls.push(model);
      if (model === "translation-model") throw new Error("translate down");
      return "cleaned";
    },
  });

  const text = await manager.processTranscriptionCore("original dictation", "local");

  assert.equal(text, "original dictation");
  assert.deepEqual(calls, ["cleanup-model", "translation-model"], "the translation route ran");
  assert.deepEqual(reasons, ["failed"]);
});

test("a successful translation reports nothing", async (t) => {
  const { createManager } = await loadWith(t, {
    cleanupModel: "cleanup-model",
    translationReachable: true,
  });
  const reasons = [];
  const manager = makeManager(createManager, reasons, {
    processWithReasoningModel: async (_text, model) =>
      model === "translation-model" ? "dictado original" : "original dictation",
  });

  const text = await manager.processTranscriptionCore("original dictation", "local");

  assert.equal(text, "dictado original");
  assert.deepEqual(reasons, []);
});
