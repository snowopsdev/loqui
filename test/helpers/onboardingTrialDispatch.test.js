const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");
const settings = {
  transcriptionMode: "local",
  useLocalWhisper: true,
  localTranscriptionProvider: "nvidia",
  parakeetModel: "model-A",
  microphoneSelectionMode: "specific",
  selectedMicDeviceId: "mic-A",
  preferredLanguage: "en",
};
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

for (const change of [
  { useLocalWhisper: false, transcriptionMode: "providers", cloudTranscriptionProvider: "openai" },
  { parakeetModel: "model-B" },
  { selectedMicDeviceId: "mic-B" },
])
  test(`actual batch refuses changed admission before dispatch: ${Object.keys(change).join(",")}`, async (t) => {
    const h = await loadAudioManager(t, {
      cachePrefix: "trial-dispatch-",
      settingsKey: "__trialDispatch",
      settings,
    });
    const buffer = deferred();
    const calls = [];
    const manager = h.createManager({ isProcessing: true });
    const recording = { private: true };
    manager.admitCleanupOperation({ demoId: "demo", takeId: "1" }, recording);
    const pipeline = manager._startProcessingPipeline();
    pipeline.recording = recording;
    pipeline.onboardingTake = { demoId: "demo", takeId: "1" };
    manager.onError = (error) => calls.push(["error", error.code]);
    h.window.electronAPI.transcribeLocalParakeet = async () => {
      calls.push(["local"]);
      return { success: true, text: "A" };
    };
    h.window.electronAPI.transcribeAudioFileByok = async () => {
      calls.push(["remote"]);
      throw Error("must not dispatch");
    };
    const run = manager.processAudio({ arrayBuffer: () => buffer.promise }, {}, pipeline);
    h.setSettings({ ...settings, ...change });
    buffer.resolve(new ArrayBuffer(2));
    await run;
    assert.deepEqual(calls, [["error", "TRIAL_CONTEXT_CHANGED"]]);
  });

test("actual batch matching admission dispatches A and carries the original proof", async (t) => {
  const h = await loadAudioManager(t, {
    cachePrefix: "trial-positive-",
    settingsKey: "__trialPositive",
    settings,
  });
  const manager = h.createManager({ isProcessing: true });
  const recording = { private: true };
  const take = { demoId: "demo", takeId: "2" };
  manager.admitCleanupOperation(take, recording);
  const pipeline = manager._startProcessingPipeline();
  pipeline.recording = recording;
  pipeline.onboardingTake = take;
  const calls = [];
  h.window.electronAPI.transcribeLocalParakeet = async (_audio, config) => {
    calls.push(config.model);
    return { success: true, text: "words" };
  };
  manager.processTranscription = async (text) => text;
  manager.onTranscriptionComplete = (_result, identity) => calls.push(identity.context);
  await manager.processAudio(new Blob(["fake audio"]), {}, pipeline);
  assert.deepEqual(calls, ["model-A", recording.trialContext]);
});

test("a prepared fallback device cannot prove the selected microphone", async (t) => {
  const h = await loadAudioManager(t, {
    cachePrefix: "trial-actual-mic-",
    settingsKey: "__trialActualMic",
    settings,
  });
  let stopped = 0;
  const errors = [],
    listening = [];
  const track = {
    label: "fixture B",
    getSettings: () => ({ deviceId: "mic-B" }),
    stop: () => stopped++,
  };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const manager = h.createManager({
    preparedMicCapture: { take: async () => null },
    getAudioConstraints: async () => ({ audio: { deviceId: { exact: "mic-A" } } }),
    _startPcmTap: () => null,
    _acquireCaptureStream: async () => stream,
    _closeBatchPcmTap() {},
    createBatchRecorder() {},
    beginMicRecovery: async () => {},
    onStateChange: (state) => listening.push(state),
    onError: (error) => errors.push(error.code),
  });
  const take = { demoId: "demo", takeId: "3" },
    recording = { private: true };
  manager.admitCleanupOperation(take, recording);
  assert.equal(await manager.startRecording(false, take, recording), false);
  assert.deepEqual(errors, ["TRIAL_MICROPHONE_CHANGED"]);
  assert.deepEqual(listening, []);
  assert.equal(stopped, 1);
});
