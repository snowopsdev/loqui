const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

async function managerFor(t, overrides = {}) {
  return loadAudioManager(t, {
    cachePrefix: "personal-audio-route-",
    settingsKey: "__personalAudioRouting",
    settings: {
      useLocalWhisper: false,
      cloudTranscriptionProvider: "groq",
      cloudTranscriptionModel: "whisper-large-v3-turbo",
      transcriptionMode: "providers",
      cloudTranscriptionMode: "byok",
      groqApiKey: "stored",
      preferredLanguage: "en",
      customDictionary: [],
      ...overrides,
    },
  });
}

test("recorded BYOK audio crosses only main-process IPC, never renderer credentials", async (t) => {
  const { window, createManager } = await managerFor(t);
  const payloads = [];
  window.electronAPI.transcribeAudioFileByok = async (payload) => {
    payloads.push(payload);
    return { success: true, text: "hello" };
  };
  window.electronAPI.getGroqKey = () => {
    throw new Error("renderer must not read keys");
  };
  const manager = createManager({
    processTranscription: async (text) => text,
    getWhisperPrompt: () => "",
    getKeyterms: () => [],
    isDictionaryEcho: () => false,
  });
  const result = await manager.processWithOpenAIAPI(new Blob(["voice"], { type: "audio/webm" }));
  assert.equal(result.text, "hello");
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].provider, "groq");
  assert.equal(payloads[0].model, "whisper-large-v3-turbo");
  assert.equal(Object.hasOwn(payloads[0], "apiKey"), false);
  assert.ok(payloads[0].audioBuffer instanceof ArrayBuffer);
});

test("local failure remains local even when a legacy fallback flag is present", async (t) => {
  const { window, createManager } = await managerFor(t, {
    useLocalWhisper: true,
    allowOpenAIFallback: true,
  });
  window.electronAPI.transcribeLocalWhisper = async () => ({
    success: false,
    error: "Model missing",
  });
  const manager = createManager({
    processWithOpenAIAPI: () => {
      throw new Error("must not switch provider");
    },
    getWhisperPrompt: () => "",
  });
  await assert.rejects(
    manager.processWithLocalWhisper(new Blob(["voice"]), "base"),
    /Model missing/
  );
});

test("provider failure does not invoke a local or another paid provider", async (t) => {
  const { window, createManager } = await managerFor(t, { allowLocalFallback: true });
  window.electronAPI.transcribeAudioFileByok = async () => ({
    success: false,
    error: "Invalid key",
    code: "API_KEY_INVALID",
  });
  window.electronAPI.transcribeLocalWhisper = () => {
    throw new Error("must not switch provider");
  };
  const manager = createManager({ getWhisperPrompt: () => "", getKeyterms: () => [] });
  await assert.rejects(manager.processWithOpenAIAPI(new Blob(["voice"])), {
    code: "API_KEY_INVALID",
  });
});
