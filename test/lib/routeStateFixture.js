// Route-state fixtures shared by the planner (Task 6) and draft-store
// (Task 7) tests. Values are plain data; every call returns fresh objects.

const PAYLOAD_PART_IDS = [
  "audio",
  "audioFile",
  "meetingAudio",
  "dictionary",
  "dictionaryWords",
  "transcript",
  "request",
  "selectedText",
  "history",
  "lookups",
  "noteText",
  "meetingTranscript",
  "participants",
  "screenshot",
  "webSearch",
  "messages",
];

// Parts render as <id> and lists join with " + ", so assertions can read them.
const TEST_COPY = {
  parts: Object.fromEntries(PAYLOAD_PART_IDS.map((id) => [id, `<${id}>`])),
  list: (items) => items.join(" + "),
};

const QWEN = "qwen3.5-2b-q4_k_m";

function llmScope(prefix) {
  return {
    [`${prefix}Mode`]: "local",
    [`${prefix}Provider`]: "qwen",
    [`${prefix}Model`]: QWEN,
    [`${prefix}CloudMode`]: "byok",
    [`${prefix}CloudBaseUrl`]: "",
    [`${prefix}RemoteUrl`]: "",
  };
}

// Every key a route patch may write, at a known value. Every route is on the
// device and enabled, nothing inherits a custom value, and the dictionary is empty.
function routeBaseState() {
  return {
    transcriptionMode: "local",
    useLocalWhisper: true,
    cloudTranscriptionMode: "byok",
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
    parakeetModel: "parakeet-unified-en-0.6b",
    cohereModel: "cohere-transcribe-03-2026",
    cloudTranscriptionProvider: "openai",
    cloudTranscriptionModel: "gpt-4o-mini-transcribe",
    cloudTranscriptionBaseUrl: "",
    remoteTranscriptionUrl: "",
    remoteTranscriptionModel: "",
    meetingTranscriptionMode: "local",
    meetingUseLocalWhisper: true,
    meetingCloudTranscriptionMode: "",
    meetingLocalTranscriptionProvider: "whisper",
    meetingWhisperModel: "",
    meetingParakeetModel: "",
    meetingCohereModel: "",
    meetingCloudTranscriptionProvider: "",
    meetingCloudTranscriptionModel: "",
    meetingCloudTranscriptionBaseUrl: "",
    meetingRemoteTranscriptionUrl: "",
    uploadTranscriptionMode: "local",
    uploadUseLocalWhisper: true,
    uploadCloudTranscriptionMode: "",
    uploadLocalTranscriptionProvider: "whisper",
    uploadWhisperModel: "",
    uploadParakeetModel: "",
    uploadCohereModel: "",
    uploadCloudTranscriptionProvider: "",
    uploadCloudTranscriptionModel: "",
    uploadCloudTranscriptionBaseUrl: "",
    ...llmScope("cleanup"),
    ...llmScope("dictationAgent"),
    ...llmScope("noteFormatting"),
    ...llmScope("chatAgent"),
    ...llmScope("translation"),
    dictationAgentVisionMode: "providers",
    dictationAgentVisionProvider: "",
    dictationAgentVisionModel: "",
    dictationAgentVisionCloudMode: "byok",
    dictationAgentVisionCloudBaseUrl: "",
    transcriptionModelByProvider: {},
    reasoningModelByProvider: {},
    useDictationAgentVisionModel: false,
    useCleanupModel: true,
    useDictationAgent: true,
    voiceAgentScreenContext: true,
    useDictationTranslation: true,
    speakerDiarizationEnabled: true,
    cortiEnvironment: "us",
    cortiTenant: "base",
    // R2-1: the enterprise route keys, at the store defaults (settingsStore.ts:1442-1453).
    bedrockRegion: "us-east-1",
    azureEndpoint: "",
    vertexProject: "",
    vertexLocation: "us-central1",
    vertexAuthSource: "adc",
    customDictionary: [],
    snippets: [],
  };
}

// Facts as main would report them: model inventories unknown (device routes
// never block), keys saved for openai, groq, anthropic and deepgram only.
function testFacts(overrides = {}) {
  return {
    installed: { whisper: null, sherpa: null, llm: null },
    credentials: new Map([
      ["openai", true],
      ["groq", true],
      ["anthropic", true],
      ["deepgram", true],
    ]),
    // Task 2's per-field presence (R2-1); only Vertex's `key` changes a host.
    credentialFields: new Map([
      ["openai", { key: true }],
      ["groq", { key: true }],
      ["anthropic", { key: true }],
      ["deepgram", { key: true }],
    ]),
    // Task 3's sync from main has landed, with no environment override (R2-1).
    enterpriseRecipients: {
      azure: { status: "unknown" },
      bedrock: { status: "unknown" },
      vertex: { status: "unknown" },
    },
    enterpriseMain: {
      bedrockEndpoint: { set: false, host: null },
      bedrockProfile: false,
      vertexApiKeyEnv: false,
      vertexProjectEnv: false,
    },
    rejected: new Set(),
    speakerIdModelsReady: true,
    searchModelReady: true,
    ...overrides,
  };
}

// Startup migrations latch on these keys; without them the store rewrites
// route keys at import time.
const MIGRATED_STORAGE = {
  _providerSettingsMigrated: "1",
  uploadTranscriptionMigrated: "true",
  _llmScopeKeysMigrated: "1",
  meetingFollowsTranscription: "false",
  meetingFollowsReasoning: "false",
};

module.exports = { PAYLOAD_PART_IDS, TEST_COPY, QWEN, routeBaseState, testFacts, MIGRATED_STORAGE };
