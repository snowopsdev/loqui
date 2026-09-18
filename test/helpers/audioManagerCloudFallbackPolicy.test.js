const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

async function setup(t) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "personal-explicit-provider-",
    settingsKey: "__explicitProviderSettings",
  });
  return {
    ...loaded,
    manager: loaded.createManager({
      getEffectiveSttLanguage: () => "auto",
      getWhisperPrompt: () => null,
      getKeyterms: () => [],
      processTranscription: async (text) => text,
    }),
  };
}

test("invalid custom endpoints fail before audio leaves the renderer", async (t) => {
  const { window, setSettings, manager } = await setup(t);
  window.electronAPI.transcribeAudioFileByok = () => assert.fail("invalid custom route uploaded");
  for (const baseUrl of [
    "",
    " ",
    "https://api.openai.com/v1",
    "not a url",
    "http://public.example.com/v1",
    "ftp://192.168.1.20/v1",
  ]) {
    setSettings({
      transcriptionMode: "providers",
      cloudTranscriptionProvider: "custom",
      cloudTranscriptionBaseUrl: baseUrl,
    });
    await assert.rejects(manager.processWithOpenAIAPI(new Blob(["voice"])), {
      code: "CUSTOM_ENDPOINT_INVALID",
    });
  }
});

test("each selected batch provider reaches only its main-process adapter", async (t) => {
  const { window, setSettings, manager } = await setup(t);
  const requests = [];
  window.electronAPI.transcribeAudioFileByok = async (payload) => {
    requests.push(payload);
    return { success: true, text: "spoken words" };
  };
  t.mock.method(globalThis, "fetch", () => assert.fail("direct renderer network request"));
  for (const provider of [
    "openai",
    "groq",
    "custom",
    "tinfoil",
    "mistral",
    "xai",
    "gemini",
    "corti",
  ]) {
    setSettings({
      transcriptionMode: "providers",
      cloudTranscriptionProvider: provider,
      cloudTranscriptionBaseUrl: "https://stt.example.com/v1",
      customDictionary: [],
    });
    assert.equal((await manager.processWithOpenAIAPI(new Blob(["voice"]))).text, "spoken words");
    assert.equal(requests.at(-1).provider, provider);
    assert.equal(Object.hasOwn(requests.at(-1), "apiKey"), false);
  }
  assert.equal(requests.length, 8);
});

test("a failed custom request does not reset its endpoint to OpenAI", async (t) => {
  const { window, setSettings, manager } = await setup(t);
  const requests = [];
  window.electronAPI.transcribeAudioFileByok = async (payload) => {
    requests.push(payload);
    return { success: false, error: "network down" };
  };
  const settings = {
    transcriptionMode: "providers",
    cloudTranscriptionProvider: "custom",
    cloudTranscriptionBaseUrl: "https://stt.example.com/v1",
  };
  setSettings(settings);
  await assert.rejects(manager.processWithOpenAIAPI(new Blob(["voice"])), /network down/);
  setSettings({ ...settings, cloudTranscriptionBaseUrl: "" });
  await assert.rejects(manager.processWithOpenAIAPI(new Blob(["voice"])), {
    code: "CUSTOM_ENDPOINT_INVALID",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].baseUrl, settings.cloudTranscriptionBaseUrl);
});

test("self-hosted audio retains the explicitly chosen server and model", async (t) => {
  const { window, setSettings, manager } = await setup(t);
  setSettings({
    transcriptionMode: "self-hosted",
    remoteTranscriptionUrl: "http://127.0.0.1:8080/v1",
    remoteTranscriptionModel: "my-whisper",
  });
  let payload;
  window.electronAPI.transcribeAudioFileByok = async (request) => {
    payload = request;
    return { success: true, text: "hi" };
  };
  await manager.processWithOpenAIAPI(new Blob(["voice"]));
  assert.equal(payload.transcriptionMode, "self-hosted");
  assert.equal(payload.remoteTranscriptionUrl, "http://127.0.0.1:8080/v1");
  assert.equal(payload.model, "my-whisper");
});
