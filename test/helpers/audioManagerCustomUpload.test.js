const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");
const { deferred } = require("./harness/deferred");

async function loadCustomManager(t) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "personal-custom-upload-test-",
    settingsKey: "__customUploadSettings",
    settings: {
      useLocalWhisper: false,
      transcriptionMode: "providers",
      cloudTranscriptionProvider: "custom",
      cloudTranscriptionBaseUrl: "https://stt.example.com/v1",
      cloudTranscriptionModel: "whisper-1",
    },
  });
  return {
    ...loaded,
    manager: loaded.createManager({
      getEffectiveSttLanguage: () => "auto",
      getWhisperPrompt: () => null,
      getKeyterms: () => [],
      isDictionaryEcho: () => false,
      processTranscription: async (text) => text,
    }),
  };
}

test("custom audio reaches main unchanged, with its selected endpoint and no credential", async (t) => {
  const { window, manager } = await loadCustomManager(t);
  const original = new Blob(["original recording"], { type: "audio/webm" });
  let uploaded;
  window.electronAPI.transcribeAudioFileByok = async (payload) => {
    uploaded = payload;
    return { success: true, text: "transcribed" };
  };
  t.mock.method(globalThis, "fetch", () => assert.fail("renderer must never upload directly"));

  const result = await manager.processWithOpenAIAPI(original);

  assert.equal(result.text, "transcribed");
  assert.equal(uploaded.mimeType, "audio/webm");
  assert.equal(uploaded.fileName, "dictation.webm");
  assert.equal(uploaded.provider, "custom");
  assert.equal(uploaded.baseUrl, "https://stt.example.com/v1");
  assert.equal(Object.hasOwn(uploaded, "apiKey"), false);
  assert.deepEqual(uploaded.audioBuffer, await original.arrayBuffer());
});

test("canceling while reading audio prevents the upload", async (t) => {
  const { window, manager } = await loadCustomManager(t);
  const read = deferred();
  let canceled = false;
  window.electronAPI.transcribeAudioFileByok = () => assert.fail("canceled recording uploaded");
  const pending = manager.processWithOpenAIAPI(
    { type: "audio/webm", arrayBuffer: () => read.promise },
    {},
    () => canceled
  );
  canceled = true;
  read.resolve(new ArrayBuffer(8));
  await assert.rejects(pending, { name: "AbortError" });
});

test("an old upload cannot clear cancellation ownership of a newer request", async (t) => {
  const { window, manager } = await loadCustomManager(t);
  const first = deferred();
  const second = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  const requests = [];
  const cancellations = [];
  let firstCanceled = false;
  window.electronAPI.cancelUploadTranscription = (id) => cancellations.push(id);
  window.electronAPI.transcribeAudioFileByok = (payload) => {
    requests.push(payload);
    if (requests.length === 1) {
      firstStarted.resolve();
      return first.promise;
    }
    secondStarted.resolve();
    return second.promise;
  };
  const firstRun = manager.processWithOpenAIAPI(new Blob(["first"]), {}, () => firstCanceled);
  await firstStarted.promise;
  firstCanceled = true;
  manager._activeTranscriptionAbortController.abort();
  const firstRejection = assert.rejects(firstRun, { name: "AbortError" });
  const secondRun = manager.processWithOpenAIAPI(new Blob(["second"]));
  await secondStarted.promise;
  const activeController = manager._activeTranscriptionAbortController;
  first.resolve({ success: true, text: "discarded" });
  await firstRejection;
  assert.equal(manager._activeTranscriptionAbortController, activeController);
  activeController.abort();
  second.resolve({ success: false, error: "Canceled", code: "CANCELED" });
  await assert.rejects(secondRun, { code: "CANCELED" });
  assert.deepEqual(
    cancellations,
    requests.map(({ requestId }) => requestId)
  );
});
