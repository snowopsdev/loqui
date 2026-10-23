const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");

const LOCAL = {
  useLocalWhisper: true,
  localTranscriptionProvider: "nvidia",
  parakeetModel: "parakeet-tdt-0.6b-v3",
  cloudTranscriptionProvider: "openai",
  cloudTranscriptionModel: "whisper-1",
  transcriptionMode: "providers",
  cloudTranscriptionMode: "byok",
  useCleanupModel: false,
  openaiApiKey: "sk",
  groqApiKey: "gk",
};

async function setup(t, settings) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "openwhispr-session-route-",
    settingsKey: "__sessionRouteSettings",
    settings,
  });
  const { captureDictationSession } = await loaded.vite.ssrLoadModule(
    "/helpers/dictationSession.js"
  );
  const calls = { local: 0, byok: [] };
  loaded.window.electronAPI = {
    ...loaded.window.electronAPI,
    transcribeAudioFileByok: async (payload) => {
      calls.byok.push(payload);
      return { success: true, text: "hello" };
    },
    cancelUploadTranscription: () => {},
  };
  const manager = Object.assign(Object.create(loaded.AudioManager.prototype), {
    isProcessing: true,
    _processingCancellationGeneration: 0,
    _localSpeechGateState: null,
    processWithLocalParakeet: async () => {
      calls.local += 1;
      return { success: true, text: "hello", source: "local-parakeet" };
    },
    processTranscription: async (text) => text,
    onTranscriptionComplete: () => {},
    onStateChange: () => {},
  });
  // If processAudio reaches another helper needing a stub, add it to the object above.
  return { ...loaded, manager, calls, captureDictationSession };
}

const blob = () => new Blob([new Uint8Array(256)], { type: "audio/webm" });

test("audio recorded on-device stays on-device even if settings switch to a provider", async (t) => {
  const { manager, calls, captureDictationSession, setSettings } = await setup(t, LOCAL);
  manager._activeSession = captureDictationSession({
    settings: LOCAL,
    intents: {},
    agentName: "Loqui",
  });
  setSettings({ ...LOCAL, useLocalWhisper: false }); // user switches to OpenAI mid-flight
  await manager.processAudio(blob(), { durationSeconds: 2 });
  assert.equal(calls.local, 1);
  assert.equal(calls.byok.length, 0, "nothing was uploaded");
});

test("provider A stays provider A when settings change to provider B", async (t) => {
  const remoteA = { ...LOCAL, useLocalWhisper: false, cloudTranscriptionProvider: "openai" };
  const { manager, calls, captureDictationSession, setSettings } = await setup(t, remoteA);
  manager._activeSession = captureDictationSession({
    settings: remoteA,
    intents: {},
    agentName: "Loqui",
  });
  setSettings({
    ...remoteA,
    cloudTranscriptionProvider: "groq",
    cloudTranscriptionModel: "whisper-large-v3",
  });
  const sessionId = manager._activeSession.id;
  await manager.processAudio(blob(), { durationSeconds: 2 });
  assert.equal(calls.byok[0].provider, "openai");
  assert.equal(calls.byok[0].correlationId, sessionId);
  assert.equal(manager.activeSession, null, "pipeline releases the idle session");
});

test("Agent and translation intents come from the session, not from live flags", async (t) => {
  const { manager, captureDictationSession } = await setup(t, LOCAL);
  const session = captureDictationSession({
    settings: LOCAL,
    intents: { voiceAgentRequested: true, translationRequested: false },
    agentName: "Loqui",
  });
  manager.voiceAgentRequested = false;
  manager.applySessionIntents(session);
  assert.equal(manager.voiceAgentRequested, true);
  assert.equal(manager.translationRequested, false);
  assert.equal(manager._activeSession, session);
  assert.equal(
    manager._sessionContext.restored,
    true,
    "a restored session never reads the OS again"
  );
  assert.equal(manager._sessionContext.selection(), null);
});

test("a new streaming start resolves its provider from live settings, not the previous session", async (t) => {
  const remote = {
    ...LOCAL,
    useLocalWhisper: false,
    cloudTranscriptionProvider: "deepgram",
    deepgramApiKey: "d",
  };
  const { manager, setSettings } = await setup(t, remote);
  manager.beginDictationSession({ streaming: true, streamingProviderName: "deepgram" });
  manager._endDictationSession(manager.activeSession);
  setSettings({ ...remote, cloudTranscriptionProvider: "assemblyai", assemblyaiApiKey: "a" });
  assert.equal(manager.activeSession, null);
  assert.equal(manager.getStreamingProviderName(), "assemblyai");
});

test("no routing read in the dictation pipeline bypasses the session", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../src/helpers/audioManager.js"), "utf8");
  const methods = [
    "processAudio",
    "processWithLocalWhisper",
    "processWithLocalParakeet",
    "processWithOpenAIAPI",
    "getTranscriptionModel",
    "processTranscription",
    "processTranscriptionCore",
    "isReasoningAvailable",
    "processWithReasoningModel",
    "processAgentCommand",
    "runTranslationChain",
    "consumeSelectionCapture",
    "_finalizeStreamingRecording",
    "getStreamingProviderName",
    "getKeyterms",
    "getCustomDictionaryPrompt",
    "finalizeChineseScript",
  ];
  for (const name of methods) {
    const start = src.search(new RegExp(`\\n  (?:async )?${name}\\(`));
    assert.ok(start > 0, `${name} exists`);
    const end = src.indexOf("\n  }\n", start);
    const body = src.slice(start, end);
    assert.doesNotMatch(body, /\bgetSettings\(\)/, `${name} reads live settings`);
    assert.doesNotMatch(
      body,
      /\bgetEffectiveCleanupModel\(\)/,
      `${name} reads the live cleanup model`
    );
  }
});

test("selected unknown enterprise facts block the actual prepare and start boundaries before mic leaves", async (t) => {
  const { manager, setSettings } = await setup(t, {
    ...LOCAL,
    transcriptionMode: "local",
    useDictationAgent: true,
    dictationAgentMode: "providers",
    dictationAgentProvider: "azure",
    dictationAgentModel: "deployment",
  });
  let preparations = 0,
    mic = 0;
  const errors = [];
  Object.assign(manager, {
    isProcessing: false,
    voiceAgentRequested: false,
    onError: (error) => errors.push(error),
    preparedMicCapture: {
      prepare: async () => {
        preparations++;
        return null;
      },
      take: async () => null,
      cancel() {},
    },
    _acquireCaptureStream: async () => {
      mic++;
      throw new Error("Mic must not open");
    },
  });
  const candidate = manager.getOrCreatePressCandidate(
    { voiceAgentRequested: true, streaming: false },
    { newPress: true }
  );
  assert.equal(candidate.intents.voiceAgentRequested, true);
  assert.equal(candidate.routes.voiceAssistant.providerId, "azure");
  assert.equal(candidate.routes.voiceAssistant.recipient.status, "unknown");
  const pending = manager.prepareMicCapture({ candidate });
  assert.equal(errors[0].code, "recipientUnknown", "the notice is synchronous");
  assert.equal(await pending, null);
  assert.equal(await manager.startRecording(false, candidate), false);
  assert.equal(preparations, 0);
  assert.equal(mic, 0);
  setSettings({
    ...LOCAL,
    transcriptionMode: "local",
    useCleanupModel: false,
    useDictationAgent: true,
    dictationAgentMode: "providers",
    dictationAgentProvider: "azure",
    dictationAgentModel: "deployment",
  });
  const ordinary = manager.getOrCreatePressCandidate(
    { voiceAgentRequested: false },
    { newPress: true }
  );
  assert.equal(await manager.prepareMicCapture({ candidate: ordinary }), null);
  assert.equal(
    preparations,
    1,
    "an unselected unknown Agent recipient does not block local recording"
  );
});

test("a rejected prepared capture releases only its press, and the next same-intent press captures new settings", async (t) => {
  const { manager, setSettings } = await setup(t, { ...LOCAL, transcriptionMode: "local" });
  Object.assign(manager, {
    isProcessing: false,
    shouldUseStreaming: () => false,
    preparedMicCapture: {
      prepare: async () => {
        throw new Error("synthetic mic unavailable");
      },
      cancel() {},
    },
  });
  const first = manager.getOrCreatePressCandidate({ streaming: false }, { newPress: true });
  manager._pressReadsSession = first;
  manager.selectionCapturePromise = Promise.resolve("abandoned selection");
  manager.screenContextPromise = Promise.resolve("abandoned screen");
  assert.equal(await manager.prepareMicCapture({ candidate: first }), null);
  assert.equal(manager._pressCandidate, null);
  assert.equal(manager._pressReadsSession, null);
  assert.equal(manager.selectionCapturePromise, null);
  assert.equal(manager.screenContextPromise, null);
  setSettings({ ...LOCAL, transcriptionMode: "local", parakeetModel: "new-local-model" });
  const next = manager.getOrCreatePressCandidate({ streaming: false });
  const nextSelection = Promise.resolve("next selection");
  manager._pressReadsSession = next;
  manager.selectionCapturePromise = nextSelection;
  assert.notEqual(next, first);
  assert.equal(next.settings.parakeetModel, "new-local-model");
  assert.equal(manager.releasePressCandidate(first), false);
  assert.equal(manager._pressCandidate.session, next);
  assert.equal(manager.selectionCapturePromise, nextSelection);
});

test("malformed normalized Bedrock/Vertex recipients refuse actual selected enterprise startup before mic", async (t) => {
  const { manager, setSettings, vite } = await setup(t, {
    ...LOCAL,
    transcriptionMode: "local",
    useCleanupModel: false,
  });
  const {
    buildEnterpriseRecipientFacts,
  } = require("../../src/helpers/enterpriseRecipientIdentity");
  const store = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  let mic = 0;
  Object.assign(manager, {
    isProcessing: false,
    preparedMicCapture: {
      cancel() {},
      prepare() {
        mic++;
      },
    },
    _acquireCaptureStream() {
      mic++;
    },
    onError() {},
  });
  for (const [provider, source] of [
    ["bedrock", { bedrockRegion: "evil.example/x" }],
    ["vertex", { vertexAuthSource: "adc", vertexProject: "bad/project" }],
  ]) {
    setSettings({
      ...LOCAL,
      transcriptionMode: "local",
      useCleanupModel: false,
      useDictationAgent: true,
      dictationAgentMode: "providers",
      dictationAgentProvider: provider,
      dictationAgentModel: "fixture",
      ...source,
    });
    const facts = buildEnterpriseRecipientFacts(source, {});
    assert.equal(facts[provider].status, "unknown");
    store.useRouteFactsStore.setState({
      facts: { ...store.EMPTY_ROUTE_FACTS, enterpriseRecipients: facts },
    });
    const candidate = manager.getOrCreatePressCandidate(
      { voiceAgentRequested: true },
      { newPress: true }
    );
    assert.equal(await manager.startRecording(false, candidate), false);
  }
  assert.equal(mic, 0);
});
