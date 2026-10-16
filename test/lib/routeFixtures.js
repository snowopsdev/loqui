// Shared route-graph fixtures (Plan 03 Task 1). Later Plan 03 tasks and Plan 07
// reuse them: a complete, all-local RouteSettingsSnapshot whose facts are all
// known, and a complete ResolvedRoute. Plain data only, no imports, so CommonJS
// and ESM tests alike can require it.

const QWEN = "qwen3.5-2b-q4_k_m";

const KIND = {
  dictationStt: "speech",
  noteRecordingStt: "speech",
  uploadStt: "speech",
  dictationCleanup: "text",
  voiceAssistant: "text",
  assistantVision: "text",
  translation: "text",
  noteFormatting: "text",
  chat: "text",
  speakerId: "support",
  semanticSearch: "support",
};

const SETTINGS_PATH = {
  dictationStt: "stt/dictation",
  noteRecordingStt: "stt/noteRecording",
  uploadStt: "stt/upload",
  dictationCleanup: "llms/dictationCleanup",
  voiceAssistant: "llms/dictationAgent",
  assistantVision: "llms/dictationAgent",
  translation: "llms/dictationTranslation",
  noteFormatting: "llms/noteFormatting",
  chat: "llms/chatIntelligence",
  speakerId: "llms/supportModels",
  semanticSearch: "llms/supportModels",
};

// English payload copy, verbatim from Appendix B (Task 3 ships the locales).
const PAYLOAD_COPY = {
  audio: "your audio",
  audioFile: "the audio file",
  meetingAudio: "meeting audio from your microphone and the call",
  dictionary: "your dictionary words and snippet triggers",
  dictionaryWords: "your dictionary words",
  transcript: "your transcript text",
  request: "your spoken request",
  selectedText: "text you have selected",
  history: "recent conversation",
  lookups: "notes and calendar details it looks up",
  noteText: "your note text",
  meetingTranscript: "the meeting transcript with speaker names",
  participants: "attendee names and email addresses",
  screenshot: "a screenshot of your screen",
  webSearch: "permission for the provider to search the web",
  messages: "your messages",
};

const listFormat = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

function stt() {
  return {
    mode: "local",
    localProvider: "whisper",
    localModel: "base",
    cloudProvider: "",
    cloudModel: "",
    cloudBaseUrl: "",
    remoteUrl: "",
    remoteModel: "",
  };
}

function llm() {
  return {
    mode: "local",
    provider: "qwen",
    model: QWEN,
    remoteUrl: "",
    cloudBaseUrl: "",
    providerSearch: false,
  };
}

function baseSnapshot() {
  return {
    stt: { dictation: stt(), meeting: stt(), upload: stt() },
    llm: {
      dictationCleanup: llm(),
      dictationAgent: llm(),
      dictationAgentVision: llm(),
      dictationTranslation: llm(),
      noteFormatting: llm(),
      chatIntelligence: llm(),
    },
    enabled: {
      cleanup: true,
      voiceAssistant: true,
      screenContext: true,
      visionOverride: false,
      translation: true,
      speakerId: true,
    },
    dictionaryInUse: false,
    // The settings store's defaults (settingsStore.ts:1442-1453).
    enterprise: {
      bedrockRegion: "us-east-1",
      azureEndpoint: "",
      vertexProject: "",
      vertexLocation: "us-central1",
      vertexAuthSource: "adc",
    },
    facts: {
      installed: { whisper: new Set(["base"]), sherpa: new Set(), llm: new Set([QWEN]) },
      credentials: new Map(), // loaded: no credential present
      credentialFields: new Map(), // loaded: no field present
      // Synced from main, no environment override (R2-1).
      enterpriseMain: {
        bedrockEndpoint: { set: false, host: null },
        bedrockProfile: false,
        vertexApiKeyEnv: false,
        vertexProjectEnv: false,
      },
      rejected: new Set(),
      speakerIdModelsReady: true,
      searchModelReady: true,
    },
    models: {
      "whisper:base": { name: "Base", sizeBytes: 148000000 },
      "whisper:small": { name: "Small", sizeBytes: 466000000 },
      "sherpa:parakeet-tdt-0.6b-v3": { name: "Parakeet TDT 0.6B v3", sizeBytes: 680000000 },
      [`llm:${QWEN}`]: { name: "Qwen3.5 2B", sizeBytes: 1329766560 },
      "llm:llama-3.2-3b": { name: "Llama 3.2 3B", sizeBytes: 2019377696 },
      "cloud:openai:gpt-4o-mini-transcribe": { name: "GPT-4o Mini Transcribe" },
      "cloud:openai:gpt-4o": { name: "GPT-4o" },
      "cloud:anthropic:claude-sonnet": { name: "Claude Sonnet" },
    },
    capabilities: {
      meetingProviders: ["openai", "assemblyai", "deepgram", "corti", "tinfoil"],
      transcriptionProviderBaseUrls: [
        { id: "openai", baseUrl: "https://api.openai.com/v1" },
        { id: "groq", baseUrl: "https://api.groq.com/openai/v1" },
        { id: "tinfoil", baseUrl: "https://inference.tinfoil.sh/v1" },
      ],
      providerHosts: {
        openai: "api.openai.com",
        anthropic: "api.anthropic.com",
        gemini: "generativelanguage.googleapis.com",
        groq: "api.groq.com",
        mistral: "api.mistral.ai",
        xai: "api.x.ai",
        openrouter: "openrouter.ai",
        tinfoil: "inference.tinfoil.sh",
        corti: "api.us.corti.app",
        "corti:text": "ai.eu.corti.app",
        deepgram: "api.deepgram.com",
        assemblyai: "api.assemblyai.com",
      },
    },
    sealed: false,
    copy: { parts: PAYLOAD_COPY, list: (items) => listFormat.format(items) },
  };
}

function isPlainObject(value) {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
}

// Plain objects merge key by key; anything else (Set, Map, array, function,
// null, primitive) replaces the default outright.
function deepMerge(base, overrides) {
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides;
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    out[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

/**
 * A complete RouteSettingsSnapshot: every route local and installed, every
 * enable flag on except the vision override, every fact known, no credential
 * present, not sealed. Overrides deep-merge (plain objects only).
 * @param {object} [overrides]
 */
function makeSnapshot(overrides = {}) {
  return deepMerge(baseSnapshot(), overrides);
}

/**
 * A complete ResolvedRoute (default: the all-local dictation route).
 * `kind` and `settingsPath` follow `overrides.id` unless given explicitly.
 * @param {object} [overrides]
 */
function makeRoute(overrides = {}) {
  const id = overrides.id ?? "dictationStt";
  return {
    id,
    kind: KIND[id],
    locality: "device",
    provider: null,
    providerId: null,
    host: null,
    model: "Base",
    state: { status: "ready" },
    sends: null,
    settingsPath: SETTINGS_PATH[id],
    ...overrides,
  };
}

module.exports = { makeSnapshot, makeRoute };
