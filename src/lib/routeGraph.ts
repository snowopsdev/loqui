// The route graph (spec §5.1): which task runs where, and can it run right now?
// One pure resolver answers for Settings, the pill, onboarding and Plan 07.
//
// Node-loadable on purpose (tests and Plan 07 import it directly under
// `node --import tsx`): erasable TypeScript only, explicit import extensions,
// and no imports beyond these three modules. No React, no store, no registry
// JSON: everything the resolver needs arrives in the snapshot.
//
// "Ready" means the real executor would run the request. Speech routes ask the
// batch executor itself (resolveTranscriptionRoute); note recording mirrors
// resolveMeetingTranscriptionOptions; text endpoints use the main process's
// endpoint rule (personalInference.js validateRequest). Unknown facts resolve to
// "unknown", never "ready".
import { isLoopbackUrl, providerDisplayName, type Locality } from "./locality.ts";
import { resolveTranscriptionRoute } from "../helpers/transcriptionRoute.ts";
import { isSecureHttpEndpoint } from "../utils/urlUtils.ts";

export type RouteId =
  | "dictationStt"
  | "noteRecordingStt"
  | "uploadStt"
  | "dictationCleanup"
  | "voiceAssistant"
  | "assistantVision"
  | "translation"
  | "noteFormatting"
  | "chat"
  | "speakerId"
  | "semanticSearch";

export type RouteKind = "speech" | "text" | "support";

export type RouteState =
  | { status: "ready" }
  | { status: "off" }
  | { status: "unknown" }
  | { status: "needsModel"; sizeBytes?: number }
  | { status: "needsKey"; provider: string }
  | { status: "needsUrl" }
  | { status: "unreachable"; detail?: "sealed" | "retired" | "unsupported" }; // spec §5.1: literal union, not string

export interface ResolvedRoute {
  id: RouteId;
  kind: RouteKind;
  locality: Locality;
  provider: string | null; // English providerDisplayName, logs only; UI uses providerDisplayLabel(providerId, t)
  recipient: EnterpriseRecipientFact | null;
  providerId: string | null; // raw id ("openai", "custom"); null for device and network
  host: string | null; // effective endpoint host:port; configured loopback keeps its host; null for built-in engines or unknown/invalid hosts
  model: string | null;
  state: RouteState;
  sends: string | null; // translated payload list; null when device or off
  settingsPath: string;
}

export type SttContext = "dictation" | "meeting" | "upload";
export type LlmRouteScope =
  | "dictationCleanup"
  | "dictationAgent"
  | "dictationAgentVision"
  | "dictationTranslation"
  | "noteFormatting"
  | "chatIntelligence";
export type CredentialId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "xai"
  | "mistral"
  | "openrouter"
  | "tinfoil"
  | "deepgram"
  | "assemblyai"
  | "corti:text"
  | "corti:speech"
  | "codex"
  | "bedrock"
  | "azure"
  | "vertex";

// Shared slot metadata type, owned here so the pure graph keeps its three
// runtime imports. credentialSlots re-exports it for persistence/UI consumers.
export type CustomCredentialSlot =
  | "custom:transcription"
  | "custom:dictationCleanup"
  | "custom:noteFormatting"
  | "custom:dictationTranslation"
  | "custom:dictationAgent"
  | "custom:dictationAgentVision"
  | "custom:chatIntelligence";
export type CredentialSlot = CredentialId | CustomCredentialSlot;

export interface SttRouteInput {
  mode: string;
  localProvider: string;
  localModel: string;
  cloudProvider: string;
  cloudModel: string;
  cloudBaseUrl: string;
  remoteUrl: string;
  remoteModel: string;
}

export interface LlmRouteInput {
  mode: string;
  provider: string;
  model: string;
  remoteUrl: string;
  cloudBaseUrl: string;
  providerSearch: boolean;
}

export interface ModelInfo {
  name: string;
  sizeBytes?: number;
}

// Main owns canonical normalization of non-secret verification options. These
// identities must describe the supplied snapshot's options, not an earlier live
// configuration: Task 3's builder also projects prospective Task 6 snapshots.
export interface CredentialVerificationIdentity {
  generation: number;
  configFingerprint: string;
}

export interface CredentialHealthFact extends CredentialVerificationIdentity {
  identity: CredentialId;
  status: "unverified" | "verified" | "rejected" | "unreachable";
}

// Historical health cannot reject a new key or a different request target/path.
// Fingerprints contain no secrets; unmatched health is simply unverified.
export function matchingRejectedCredentials(
  health: readonly CredentialHealthFact[],
  current: ReadonlyMap<CredentialId, CredentialVerificationIdentity>
): ReadonlySet<CredentialId> {
  const rejected = new Set<CredentialId>();
  for (const fact of health) {
    const identity = current.get(fact.identity);
    if (
      fact.status === "rejected" &&
      identity !== undefined &&
      identity.generation === fact.generation &&
      identity.configFingerprint === fact.configFingerprint
    ) {
      rejected.add(fact.identity);
    }
  }
  return rejected;
}

// Task 11's optional network-free routeHealth query returns these main-owned
// bindings. Options are normalized by routeVerificationOptions.mjs; fingerprints
// cover actual effective targets/paths/overrides and never include secrets.
export interface RouteVerificationOptions {
  cortiEnvironment?: string;
  cortiTenant?: string;
}
export interface RouteHealthMetadata {
  options: { cortiEnvironment: string; cortiTenant: string } | null;
  current: readonly (CredentialVerificationIdentity & { identity: CredentialId })[];
  health: readonly CredentialHealthFact[];
}

export type EnterpriseRecipientTag = string;
export type EnterpriseRecipientFact =
  { status: "ready"; tag: EnterpriseRecipientTag } | { status: "unknown" };
export type EnterpriseRecipientFacts = Readonly<
  Record<EnterpriseProviderId, EnterpriseRecipientFact>
>;
export const UNKNOWN_ENTERPRISE_RECIPIENTS: EnterpriseRecipientFacts = Object.freeze({
  azure: Object.freeze({ status: "unknown" }),
  bedrock: Object.freeze({ status: "unknown" }),
  vertex: Object.freeze({ status: "unknown" }),
});
export interface RouteFacts {
  enterpriseRecipients: EnterpriseRecipientFacts;
  // Main checkParakeetInstallation.supported; absent/null is unknown, not READY.
  sherpaSupported?: boolean | null;
  // Raw model ids per family; null = this family's inventory is not known.
  installed: {
    whisper: ReadonlySet<string> | null;
    sherpa: ReadonlySet<string> | null;
    llm: ReadonlySet<string> | null;
  };
  credentials: ReadonlyMap<CredentialSlot, boolean> | null; // main-confirmed presence; null = not loaded
  // Main metadata for per-snapshot health projection, optional until Task 11.
  credentialHealth?: RouteHealthMetadata;
  // Durable recovery could not determine these slots: current main admission refuses capture.
  // Known-absent keys still permit independent ADC/profile sources.
  credentialUnknown?: ReadonlySet<CredentialSlot>;
  credentialGenerations?: ReadonlyMap<CredentialSlot, number>;
  // Main-confirmed field presence, published with credentials under the same generation.
  // Vertex's key field affects readiness only, never the selected auth source.
  credentialFields: ReadonlyMap<CredentialSlot, Readonly<Record<string, boolean>>> | null;
  // Main's own environment overrides for the enterprise SDKs (Task 3's
  // enterprise-route-facts). null until Task 3 has also reconciled the five
  // enterprise settings to main's values: until then every enterprise route is unknown.
  enterpriseMain: EnterpriseMainFacts | null;
  // Already projected for this snapshot by matchingRejectedCredentials (or an
  // equivalent generation + canonical-config match in main). Never a raw set
  // of identities with historical rejected rows. Builders MUST reproject for
  // each settings input, including planner previews; live identity A cannot be
  // reused as evidence for prospective configuration B.
  rejected: ReadonlySet<CredentialId>;
  speakerIdModelsReady: boolean | null;
  searchModelReady: boolean | null;
}

export interface RouteCapabilities {
  // Renderer-normalized Corti auth target agreement. Absent in legacy pure fixtures.
  cortiSpeechTargetValid?: boolean;
  meetingProviders: readonly string[];
  transcriptionProviderBaseUrls: readonly { id: string; baseUrl: string }[];
  // Raw provider id → bare host[:port]. "corti" is the Corti speech host for the
  // selected region; "corti:text" is the Corti text host (one fixed host).
  providerHosts: Readonly<Record<string, string>>;
}

export type PayloadPart =
  | "audio"
  | "audioFile"
  | "meetingAudio"
  | "dictionary"
  | "dictionaryWords"
  | "transcript"
  | "request"
  | "selectedText"
  | "history"
  | "lookups"
  | "noteText"
  | "meetingTranscript"
  | "participants"
  | "screenshot"
  | "webSearch"
  | "messages";

export const PAYLOAD_PARTS = [
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
] as const satisfies readonly PayloadPart[];

export interface RouteCopy {
  parts: Readonly<Record<PayloadPart, string>>;
  list: (items: string[]) => string;
}

export type EnterpriseProviderId = "bedrock" | "azure" | "vertex";

// The non-secret enterprise settings that decide where an enterprise request
// goes. Raw store strings: main hands the same values, untrimmed, to
// enterpriseAiProviders.js (main.js:447-457).
export interface EnterpriseRouteSettings {
  bedrockRegion: string;
  azureEndpoint: string;
  vertexProject: string;
  vertexLocation: string;
  vertexAuthSource: "adc" | "apiKey";
}

// Hosts and booleans only; produced by src/helpers/enterpriseRouteFacts.js in main.
export interface EnterpriseMainFacts {
  enterpriseRecipients?: EnterpriseRecipientFacts;
  // AWS_ENDPOINT_URL_BEDROCK_RUNTIME, else AWS_ENDPOINT_URL. host null = set but unusable.
  bedrockEndpoint: { set: boolean; host: string | null };
  bedrockProfile: boolean; // non-empty BEDROCK_PROFILE; profile value never leaves main
  vertexApiKeyEnv: boolean; // non-empty GOOGLE_VERTEX_API_KEY, only a fallback in apiKey mode
  vertexProjectEnv: boolean; // reported only: the helper always passes a string project
}

export interface RouteSettingsSnapshot {
  stt: Record<SttContext, SttRouteInput>;
  llm: Record<LlmRouteScope, LlmRouteInput>;
  enterprise: EnterpriseRouteSettings;
  enabled: {
    cleanup: boolean;
    voiceAssistant: boolean;
    screenContext: boolean;
    visionOverride: boolean;
    translation: boolean;
    speakerId: boolean;
  };
  dictionaryInUse: boolean;
  facts: RouteFacts;
  // Keys: "whisper:<id>", "sherpa:<id>", "llm:<id>", "cloud:<providerId>:<modelId>".
  models: Readonly<Record<string, ModelInfo>>;
  capabilities: RouteCapabilities;
  sealed: boolean;
  copy: RouteCopy;
}

export const ROUTE_IDS = [
  "dictationStt",
  "noteRecordingStt",
  "uploadStt",
  "dictationCleanup",
  "voiceAssistant",
  "assistantVision",
  "translation",
  "noteFormatting",
  "chat",
  "speakerId",
  "semanticSearch",
] as const satisfies readonly RouteId[];

export const ROUTE_KIND: Readonly<Record<RouteId, RouteKind>> = {
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

export const ROUTE_SETTINGS_PATH: Readonly<Record<RouteId, string>> = {
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

export const STT_CONTEXT_ROUTE: Readonly<Record<SttContext, RouteId>> = {
  dictation: "dictationStt",
  meeting: "noteRecordingStt",
  upload: "uploadStt",
};

export const SCOPE_ROUTE: Readonly<Record<LlmRouteScope, RouteId>> = {
  dictationCleanup: "dictationCleanup",
  dictationAgent: "voiceAssistant",
  dictationAgentVision: "assistantVision",
  dictationTranslation: "translation",
  noteFormatting: "noteFormatting",
  chatIntelligence: "chat",
};

// Technical names, not translated (proper nouns).
export const SUPPORT_MODEL_NAMES = {
  speakerId: "3D-Speaker CAM++",
  semanticSearch: "all-MiniLM-L6-v2",
} as const;

// Mirrors PROVIDERS in src/helpers/personalInference.js minus its internal
// "lan"/"local" ids (self-hosted and the built-in runtime). A text provider
// outside this list is refused by main ("Choose a supported text provider.").
export const TEXT_PROVIDER_IDS: readonly string[] = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "openrouter",
  "custom",
  "tinfoil",
  "corti",
  "mistral",
  "xai",
  "codex",
  "bedrock",
  "azure",
  "vertex",
];

const ENTERPRISE_PROVIDER_IDS: readonly string[] = ["bedrock", "azure", "vertex"];

// @ai-sdk/amazon-bedrock 5.0.94, resolveAmazonBedrockBaseURL
// (dist/index.js:3105-3135): https://bedrock-runtime.<region>.<partition suffix>.
const AWS_PARTITION_DNS_SUFFIXES: readonly (readonly [string, string])[] = [
  ["cn-", "amazonaws.com.cn"],
  ["us-iso-", "c2s.ic.gov"],
  ["us-isob-", "sc2s.sgov.gov"],
  ["eu-isoe-", "cloud.adc-e.uk"],
  ["us-isof-", "csp.hci.ic.gov"],
  ["eusc-", "amazonaws.eu"],
];

function bedrockBaseUrl(region: string): string {
  const suffix =
    AWS_PARTITION_DNS_SUFFIXES.find(([prefix]) => region.startsWith(prefix))?.[1] ??
    "amazonaws.com";
  return `https://bedrock-runtime.${region}.${suffix}`;
}

// @ai-sdk/google-vertex 5.0.93, createGoogleVertex loadBaseURL
// (dist/index.js:1619, 1653-1669). The persisted apiKey source selects express mode.
function vertexBaseUrl(apiKeyMode: boolean, project: string, location: string): string {
  if (apiKeyMode) return "https://aiplatform.googleapis.com/v1/publishers/google";
  const host =
    location === "global"
      ? "aiplatform.googleapis.com"
      : location === "eu" || location === "us"
        ? `aiplatform.${location}.rep.googleapis.com`
        : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1beta1/projects/${project}/locations/${location}/publishers/google`;
}

// The host a URL built like the SDK's really reaches; null when it cannot be
// parsed or carries credentials (fetch refuses both).
function requestHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.username || parsed.password ? null : parsed.host || null;
  } catch {
    return null;
  }
}

// Where enterpriseAiProviders.js and the AI SDK would send this request, or
// null when the executor refuses the configuration. Mirrors the helper exactly,
// including its `||` defaults and untrimmed values; the agreement test runs
// the real helper and SDK against the same inputs.
export function enterpriseRequestHost(
  providerId: EnterpriseProviderId,
  enterprise: EnterpriseRouteSettings,
  main: EnterpriseMainFacts
): string | null {
  switch (providerId) {
    case "bedrock":
      // An endpoint override in main's environment wins over the region
      // (resolveAmazonBedrockBaseURL, dist/index.js:3120-3129).
      if (main.bedrockEndpoint.set) return main.bedrockEndpoint.host;
      return requestHost(bedrockBaseUrl(enterprise.bedrockRegion || "us-east-1"));
    case "azure": {
      // createAzureModel (:73-77): required, parsable, HTTPS, no embedded credentials.
      const endpoint = enterprise.azureEndpoint;
      if (!endpoint) return null;
      try {
        const url = new URL(endpoint);
        if (url.protocol !== "https:" || url.username || url.password) return null;
        return url.host || null;
      } catch {
        return null;
      }
    }
    case "vertex":
      if (enterprise.vertexAuthSource !== "apiKey" && enterprise.vertexAuthSource !== "adc") {
        return null;
      }
      return requestHost(
        vertexBaseUrl(
          enterprise.vertexAuthSource === "apiKey",
          enterprise.vertexProject,
          enterprise.vertexLocation || "us-central1"
        )
      );
    default:
      return null;
  }
}

const KEYED_PROVIDER_IDS: readonly string[] = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "openrouter",
  "tinfoil",
  "deepgram",
  "assemblyai",
  "codex",
  "bedrock",
  "azure",
  "vertex",
];

type ModelFamily = "whisper" | "sherpa" | "llm";

// Whisper files and the sherpa-onnx family (Parakeet, Nemotron, Cohere) are
// listed by different main-process calls, so the key carries the family.
function sttFamily(localProvider: string): "whisper" | "sherpa" | null {
  if (localProvider === "whisper") return "whisper";
  if (localProvider === "nvidia" || localProvider === "cohere") return "sherpa";
  return null;
}

// Invalid saved providers have no model-inventory key. Callers describing a
// snapshot must skip null instead of interpreting it as another local engine.
export function localSttModelKey(localProvider: string, modelId: string): string | null {
  const family = sttFamily(localProvider);
  return family === null ? null : `${family}:${modelId}`;
}

// Spec §5.4 + Plan 07 CCR-1: sealed mode blocks everything that leaves this
// device, LAN servers included.
export function isSealedLocality(locality: Locality): boolean {
  return locality !== "device";
}

// The credential a route authenticates with. Corti speech uses the client
// id/secret pair (ipcHandlers.js:1105-1121, audioManager.js:3223); Corti text
// uses the API key. Custom endpoints and unknown ids have no tracked credential.
export function routeCredentialId(
  id: RouteId,
  providerId: string | null | undefined
): CredentialId | null {
  const p = (providerId ?? "").trim();
  if (p === "corti") return ROUTE_KIND[id] === "speech" ? "corti:speech" : "corti:text";
  return KEYED_PROVIDER_IDS.includes(p) ? (p as CredentialId) : null;
}

const HOSTED_HOST = /(^|\.)openwhispr\.(com|app)$/i;

// The main process's rule for custom/self-hosted text endpoints
// (personalInference.js validateRequest): http(s) only, no embedded
// credentials, HTTPS unless the host is private, never the retired hosted
// service. Runs before any loopback decision: an invalid URL is never "device".
export function isValidTextEndpoint(url: string | null | undefined): boolean {
  const raw = (url ?? "").trim();
  if (!raw || !isSecureHttpEndpoint(raw)) return false;
  try {
    const parsed = new URL(raw);
    return !parsed.username && !parsed.password && !HOSTED_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

function urlHost(url: string): string | null {
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

const READY: RouteState = { status: "ready" };
const OFF: RouteState = { status: "off" };
const UNKNOWN: RouteState = { status: "unknown" };
const NEEDS_URL: RouteState = { status: "needsUrl" };
const UNSUPPORTED: RouteState = { status: "unreachable", detail: "unsupported" };
const RETIRED: RouteState = { status: "unreachable", detail: "retired" };
const SEALED: RouteState = { status: "unreachable", detail: "sealed" };
const CHOOSE_PROVIDER: RouteState = { status: "needsKey", provider: "" };

interface Destination {
  locality: Locality;
  providerId: string | null;
  host: string | null;
  model: string | null;
  state: RouteState;
}

function providerHost(s: RouteSettingsSnapshot, providerId: string): string | null {
  const hosts = s.capabilities.providerHosts;
  return Object.hasOwn(hosts, providerId) ? hosts[providerId] : null;
}

function cloudModelName(
  s: RouteSettingsSnapshot,
  providerId: string,
  modelId: string
): string | null {
  const id = modelId.trim();
  if (!id) return null;
  const key = `cloud:${providerId}:${id}`;
  return Object.hasOwn(s.models, key) ? s.models[key].name : id;
}

function credentialState(s: RouteSettingsSnapshot, id: RouteId, providerId: string): RouteState {
  const credential = routeCredentialId(id, providerId);
  if (credential === null) return UNSUPPORTED;
  if (s.facts.credentials === null || s.facts.credentialUnknown?.has(credential)) return UNKNOWN;
  if (s.facts.credentials.get(credential) !== true || s.facts.rejected.has(credential)) {
    return { status: "needsKey", provider: providerDisplayName(providerId) };
  }
  return READY;
}

function keyPresence(
  s: RouteSettingsSnapshot,
  id: RouteId,
  providerId: string
): boolean | undefined {
  const credential = routeCredentialId(id, providerId);
  if (
    credential === null ||
    s.facts.credentials === null ||
    s.facts.credentialUnknown?.has(credential)
  )
    return undefined;
  return s.facts.credentials.get(credential) === true && !s.facts.rejected.has(credential);
}

// hostKey defaults to the provider id; Corti text routes pass "corti:text"
// because their requests go to a different host than Corti speech.
function remote(
  s: RouteSettingsSnapshot,
  providerId: string,
  model: string | null,
  state: RouteState,
  hostKey?: string
): Destination {
  const id = providerId.trim();
  return {
    locality: "remote",
    providerId: id || null,
    host: id ? providerHost(s, hostKey ?? id) : null,
    model,
    state,
  };
}

// Corti text requests always go to ai.eu.corti.app (personalInference.js:78),
// while Corti speech follows the region; every other provider has one host.
function textHostKey(providerId: string): string {
  return providerId === "corti" ? "corti:text" : providerId;
}

function retired(s: RouteSettingsSnapshot, providerId: string, model: string | null): Destination {
  // The retired hosted service still names a provider (never "Unknown provider").
  return remote(s, providerId.trim() || "openwhispr", model, RETIRED);
}

function localDestination(
  s: RouteSettingsSnapshot,
  family: ModelFamily,
  modelId: string
): Destination {
  const id = modelId.trim();
  const key = `${family}:${id}`;
  const info = id && Object.hasOwn(s.models, key) ? s.models[key] : undefined;
  const installed = s.facts.installed[family];
  let state: RouteState = READY;
  if (!id) {
    state = { status: "needsModel" }; // a settings fact, known without main
  } else if (family === "sherpa" && s.facts.sherpaSupported !== true) {
    state = s.facts.sherpaSupported === false ? UNSUPPORTED : UNKNOWN;
  } else if (installed === null) {
    state = UNKNOWN;
  } else if (!installed.has(id)) {
    state = info?.sizeBytes
      ? { status: "needsModel", sizeBytes: info.sizeBytes }
      : { status: "needsModel" };
  }
  return {
    locality: "device",
    providerId: null,
    host: null,
    model: id ? (info?.name ?? id) : null,
    state,
  };
}

// An endpoint the user typed. Loopback is decided only after validation.
function endpointDestination(
  url: string,
  valid: boolean,
  providerId: "custom" | null,
  model: string | null,
  invalidState: RouteState
): Destination {
  if (valid && isLoopbackUrl(url)) {
    // The request still targets a user-configured endpoint. Keep its host so
    // Plan 07 can distinguish it from a built-in engine (device + host:null).
    return { locality: "device", providerId: null, host: urlHost(url), model, state: READY };
  }
  return {
    locality: providerId === "custom" ? "remote" : "network",
    providerId,
    host: valid ? urlHost(url) : null,
    model,
    state: valid ? READY : invalidState,
  };
}

// Optional authentication differs from unknown durable storage. Custom text
// capture refuses unknown slots; legacy speech getters have no capture gate yet,
// but explicit uncertainty is conservatively non-ready there too.
function optionalCredentialDestination(
  s: RouteSettingsSnapshot,
  dest: Destination,
  slot: CustomCredentialSlot
): Destination {
  return dest.state.status === "ready" &&
    (s.facts.credentials === null || s.facts.credentialUnknown?.has(slot))
    ? { ...dest, state: UNKNOWN }
    : dest;
}

// Error codes from resolveTranscriptionRoute → route state. null = the
// executor refuses the batch request but the live dictation path runs it.
function transcriptionErrorState(
  code: string | undefined,
  id: RouteId,
  mode: string,
  providerId: string
): RouteState | null {
  switch (code) {
    case "UNSUPPORTED_TRANSCRIPTION_MODE":
      return mode === "openwhispr" ? RETIRED : UNSUPPORTED;
    case "UNSUPPORTED_TRANSCRIPTION_PROVIDER":
      return providerId ? UNSUPPORTED : CHOOSE_PROVIDER;
    case "CUSTOM_ENDPOINT_INVALID":
      return NEEDS_URL;
    case "API_KEY_MISSING":
      return { status: "needsKey", provider: providerDisplayName(providerId) };
    case "STREAMING_ONLY_PROVIDER":
      return id === "dictationStt" ? null : UNSUPPORTED;
    case undefined:
      // The executor's code-less errors are all endpoint errors: self-hosted URL
      // invalid or not configured, and Tinfoil behind a Custom URL.
      return NEEDS_URL;
    default:
      return UNSUPPORTED;
  }
}

function batchSttDestination(
  s: RouteSettingsSnapshot,
  id: RouteId,
  input: SttRouteInput
): Destination {
  const mode = input.mode.trim();
  const providerId = input.cloudProvider.trim();
  const remoteUrl = input.remoteUrl.trim();
  const route = resolveTranscriptionRoute({
    settings: {
      transcriptionMode: mode,
      useLocalWhisper: false,
      remoteTranscriptionUrl: remoteUrl,
      remoteTranscriptionModel: input.remoteModel,
      cloudTranscriptionProvider: providerId,
      cloudTranscriptionModel: input.cloudModel,
      cloudTranscriptionBaseUrl: input.cloudBaseUrl,
    },
    providers: s.capabilities.transcriptionProviderBaseUrls,
    // The executor reads key presence only for live-only providers, and only
    // the dictation recorder has a live path (upload and retry omit it).
    hasProviderKey: id === "dictationStt" ? keyPresence(s, id, providerId) : undefined,
  });
  // Validate only the actual Corti transport. A retained Corti selection is
  // unused when the batch executor selects an explicit self-hosted endpoint.
  if (
    route.transport === "proxied" &&
    route.provider === "corti" &&
    s.capabilities.cortiSpeechTargetValid === false
  ) {
    return {
      ...remote(s, providerId, cloudModelName(s, providerId, input.cloudModel), UNSUPPORTED),
      host: null,
    };
  }
  const ok = route.transport === "http-batch" || route.transport === "proxied";
  const errorState =
    route.transport === "error" ? transcriptionErrorState(route.code, id, mode, providerId) : null;
  const endpoint = route.transport === "http-batch" ? route.endpoint : "";

  if (mode === "self-hosted" && remoteUrl) {
    return optionalCredentialDestination(
      s,
      endpointDestination(
        endpoint,
        ok,
        null,
        input.remoteModel.trim() || null,
        errorState ?? NEEDS_URL
      ),
      "custom:transcription"
    );
  }
  const model = cloudModelName(s, providerId, input.cloudModel);
  if ((mode === "providers" || mode === "self-hosted") && providerId === "custom") {
    return optionalCredentialDestination(
      s,
      endpointDestination(endpoint, ok, "custom", model, errorState ?? NEEDS_URL),
      "custom:transcription"
    );
  }
  if (mode === "self-hosted") {
    return {
      locality: "network",
      providerId: null,
      host: null,
      model: input.remoteModel.trim() || null,
      state: NEEDS_URL,
    };
  }
  if (errorState) return remote(s, providerId, model, errorState);
  return remote(s, providerId, model, credentialState(s, id, providerId));
}

// Mirrors resolveMeetingTranscriptionOptions (meetingTranscriptionRouting.js):
// no self-hosted path, and only the streaming table's providers run.
function meetingDestination(s: RouteSettingsSnapshot, input: SttRouteInput): Destination {
  const mode = input.mode.trim();
  const providerId = input.cloudProvider.trim();
  if (mode === "self-hosted") {
    const url = input.remoteUrl.trim();
    const where = endpointDestination(
      url,
      isValidTextEndpoint(url),
      null,
      input.remoteModel.trim() || null,
      NEEDS_URL
    );
    return { ...where, state: UNSUPPORTED };
  }
  const model = cloudModelName(s, providerId, input.cloudModel);
  if (mode !== "providers") return remote(s, providerId, model, UNSUPPORTED);
  if (!providerId) return remote(s, providerId, model, CHOOSE_PROVIDER);
  if (!s.capabilities.meetingProviders.includes(providerId)) {
    return remote(s, providerId, model, UNSUPPORTED);
  }
  // The meeting executor admits only this supported providers transport;
  // preserve its self-hosted and unsupported-mode refusal paths above.
  if (providerId === "corti" && s.capabilities.cortiSpeechTargetValid === false) {
    return { ...remote(s, providerId, model, UNSUPPORTED), host: null };
  }
  return remote(s, providerId, model, credentialState(s, "noteRecordingStt", providerId));
}

function sttDestination(s: RouteSettingsSnapshot, id: RouteId, input: SttRouteInput): Destination {
  const mode = input.mode.trim();
  const providerId = input.cloudProvider.trim();
  if (mode === "local") {
    const family = sttFamily(input.localProvider);
    if (family === null) {
      // Executors historically fall back to Whisper for an unknown provider.
      // Preserve the invalid selection and refuse readiness instead of silently
      // describing a different engine (or borrowing its installed inventory).
      return {
        locality: "device",
        providerId: null,
        host: null,
        model: input.localModel.trim() || null,
        state: UNSUPPORTED,
      };
    }
    return localDestination(s, family, input.localModel);
  }
  if (mode === "openwhispr") {
    return retired(s, providerId, cloudModelName(s, providerId, input.cloudModel));
  }
  if (id === "noteRecordingStt") return meetingDestination(s, input);
  return batchSttDestination(s, id, input);
}

// Bedrock, Azure and Vertex (R2-1/R3-1/R3-3). The host comes from the enterprise
// slice, never providerHosts. A configuration the executor refuses is needsUrl
// before credential facts. Vertex's host follows its persisted auth source, not
// key presence; only apiKey readiness waits for the key facts.
function enterpriseDestination(
  s: RouteSettingsSnapshot,
  id: RouteId,
  providerId: EnterpriseProviderId,
  model: string | null
): Destination {
  const at = (host: string | null, state: RouteState): Destination => ({
    locality: "remote",
    providerId,
    host,
    model,
    state,
  });
  // Main is the source of truth: until Task 3 has synced the slice from main
  // and read main's environment overrides, the destination is not known.
  const main = s.facts.enterpriseMain;
  if (main === null) return at(null, UNKNOWN);
  if (
    providerId === "vertex" &&
    s.enterprise.vertexAuthSource !== "apiKey" &&
    s.enterprise.vertexAuthSource !== "adc"
  ) {
    return at(null, UNSUPPORTED);
  }
  const host = enterpriseRequestHost(providerId, s.enterprise, main);
  if (host === null) return at(null, NEEDS_URL);
  // Current main admission captures these slots before choosing profile/ADC.
  // Known absence permits independent sources; unreadable storage refuses them.
  if (s.facts.credentials === null || s.facts.credentialUnknown?.has(providerId))
    return at(host, UNKNOWN);
  // Recipient settings pick the host independently of credentials. Preserve
  // that host while main-confirmed credential facts are still loading.
  if (
    providerId === "vertex" &&
    s.enterprise.vertexAuthSource === "apiKey" &&
    s.facts.credentialFields === null
  )
    return at(host, UNKNOWN);
  if (providerId === "bedrock" && !main.bedrockProfile && s.facts.credentialFields === null)
    return at(host, UNKNOWN);
  if (providerId === "bedrock") {
    const fields = s.facts.credentialFields?.get("bedrock");
    const completeStaticPair = fields?.accessKeyId === true && fields?.secretAccessKey === true;
    const ready = main.bedrockProfile || completeStaticPair;
    return at(
      host,
      ready && !s.facts.rejected.has("bedrock")
        ? READY
        : { status: "needsKey", provider: providerDisplayName(providerId) }
    );
  }
  if (providerId === "vertex") {
    if (s.enterprise.vertexAuthSource === "apiKey") {
      const storedKey = s.facts.credentialFields?.get("vertex")?.key === true;
      const effectiveKey = storedKey || main.vertexApiKeyEnv;
      return at(
        host,
        effectiveKey && !s.facts.rejected.has("vertex")
          ? READY
          : { status: "needsKey", provider: providerDisplayName(providerId) }
      );
    }
    // ADC must not inherit either explicit or ambient API keys. A project is
    // required by createVertex({ apiKey: "", project, location }).
    return at(
      host,
      s.enterprise.vertexProject.trim()
        ? READY
        : { status: "needsKey", provider: providerDisplayName(providerId) }
    );
  }
  return at(host, credentialState(s, id, providerId));
}

function llmDestination(s: RouteSettingsSnapshot, id: RouteId, input: LlmRouteInput): Destination {
  const mode = input.mode.trim();
  const providerId = input.provider.trim();
  const modelId = input.model.trim();
  if (mode === "local") return localDestination(s, "llm", modelId);
  if (mode === "openwhispr") return retired(s, providerId, cloudModelName(s, providerId, modelId));

  let dest: Destination;
  if (mode === "self-hosted") {
    const url = input.remoteUrl.trim();
    dest = endpointDestination(url, isValidTextEndpoint(url), null, modelId || null, NEEDS_URL);
  } else if (mode === "providers" && providerId === "custom") {
    const url = input.cloudBaseUrl.trim();
    dest = endpointDestination(
      url,
      isValidTextEndpoint(url),
      "custom",
      cloudModelName(s, providerId, modelId),
      NEEDS_URL
    );
  } else if (mode === "providers" || mode === "enterprise") {
    const supported = mode === "enterprise" ? ENTERPRISE_PROVIDER_IDS : TEXT_PROVIDER_IDS;
    const model = cloudModelName(s, providerId, modelId);
    if (!providerId) dest = remote(s, providerId, model, CHOOSE_PROVIDER);
    else if (!supported.includes(providerId)) dest = remote(s, providerId, model, UNSUPPORTED);
    else if (ENTERPRISE_PROVIDER_IDS.includes(providerId)) {
      // Also reached in "providers" mode: the vision override is provider-only.
      dest = enterpriseDestination(s, id, providerId as EnterpriseProviderId, model);
    } else {
      dest = remote(
        s,
        providerId,
        model,
        credentialState(s, id, providerId),
        textHostKey(providerId)
      );
    }
  } else {
    dest = remote(s, providerId, cloudModelName(s, providerId, modelId), UNSUPPORTED);
  }
  const scope = ROUTE_SCOPE[id];
  if ((mode === "self-hosted" || (mode === "providers" && providerId === "custom")) && scope) {
    dest = optionalCredentialDestination(s, dest, `custom:${scope}` as CustomCredentialSlot);
  }
  // Main refuses a text request without a model ("Choose a text model."), and
  // text providers have no implicit default, unlike speech providers.
  if (dest.state.status === "ready" && !modelId) {
    return { ...dest, state: { status: "needsModel" } };
  }
  return dest;
}

function supportDestination(
  s: RouteSettingsSnapshot,
  id: "speakerId" | "semanticSearch"
): Destination {
  const ready = id === "speakerId" ? s.facts.speakerIdModelsReady : s.facts.searchModelReady;
  const state: RouteState = ready === null ? UNKNOWN : ready ? READY : { status: "needsModel" };
  return {
    locality: "device",
    providerId: null,
    host: null,
    model: SUPPORT_MODEL_NAMES[id],
    state,
  };
}

const ROUTE_STT_CONTEXT: Partial<Record<RouteId, SttContext>> = {
  dictationStt: "dictation",
  noteRecordingStt: "meeting",
  uploadStt: "upload",
};

const ROUTE_SCOPE: Partial<Record<RouteId, LlmRouteScope>> = {
  dictationCleanup: "dictationCleanup",
  voiceAssistant: "dictationAgent",
  assistantVision: "dictationAgentVision",
  translation: "dictationTranslation",
  noteFormatting: "noteFormatting",
  chat: "chatIntelligence",
};

// Without the override, screenshots go to the assistant's own model.
function effectiveScope(s: RouteSettingsSnapshot, id: RouteId): LlmRouteScope {
  if (id === "assistantVision" && !s.enabled.visionOverride) return "dictationAgent";
  return ROUTE_SCOPE[id] as LlmRouteScope;
}

function isOff(s: RouteSettingsSnapshot, id: RouteId): boolean {
  switch (id) {
    case "dictationCleanup":
      return !s.enabled.cleanup;
    case "voiceAssistant":
      return !s.enabled.voiceAssistant;
    case "assistantVision":
      return !s.enabled.voiceAssistant || !s.enabled.screenContext;
    case "translation":
      return !s.enabled.translation;
    case "speakerId":
      return !s.enabled.speakerId;
    default:
      return false;
  }
}

// What a request on this route carries (Appendix B). Conservative: a part
// that may be sent under conditions the snapshot cannot see is listed.
// Computing it never triggers a request.
export function routePayloadParts(id: RouteId, s: RouteSettingsSnapshot): PayloadPart[] {
  const dictionary = s.dictionaryInUse;
  switch (id) {
    case "dictationStt":
      return dictionary ? ["audio", "dictionary"] : ["audio"];
    case "noteRecordingStt":
      // Only Corti's realtime options carry the dictionary as keyterms.
      return dictionary && s.stt.meeting.cloudProvider.trim() === "corti"
        ? ["meetingAudio", "dictionaryWords"]
        : ["meetingAudio"];
    case "uploadStt":
      return ["audioFile"];
    case "dictationCleanup":
    case "translation":
      return dictionary ? ["transcript", "dictionary"] : ["transcript"];
    case "voiceAssistant":
    case "assistantVision": {
      const parts: PayloadPart[] = ["request", "selectedText", "history", "lookups"];
      if (dictionary) parts.push("dictionary");
      if (id === "assistantVision" || (s.enabled.screenContext && !s.enabled.visionOverride)) {
        parts.push("screenshot");
      }
      if (s.llm[effectiveScope(s, id)].providerSearch) parts.push("webSearch");
      return parts;
    }
    case "noteFormatting":
      return dictionary
        ? ["noteText", "meetingTranscript", "participants", "dictionaryWords"]
        : ["noteText", "meetingTranscript", "participants"];
    case "chat": {
      const parts: PayloadPart[] = ["messages", "history", "lookups"];
      if (dictionary) parts.push("dictionary");
      if (s.llm.chatIntelligence.providerSearch) parts.push("webSearch");
      return parts;
    }
    default:
      return []; // support routes never leave the device
  }
}

export function resolveRoute(s: RouteSettingsSnapshot, id: RouteId): ResolvedRoute {
  const kind = ROUTE_KIND[id];
  let dest: Destination;
  if (id === "speakerId" || id === "semanticSearch") {
    dest = supportDestination(s, id);
  } else if (kind === "speech") {
    dest = sttDestination(s, id, s.stt[ROUTE_STT_CONTEXT[id] as SttContext]);
  } else {
    dest = llmDestination(s, id, s.llm[effectiveScope(s, id)]);
  }

  const off = isOff(s, id);
  let state = dest.state;
  if (off) state = OFF;
  else if (s.sealed && isSealedLocality(dest.locality)) state = SEALED;

  const parts = off || dest.locality === "device" ? [] : routePayloadParts(id, s);
  return {
    id,
    kind,
    locality: dest.locality,
    provider: dest.providerId ? providerDisplayName(dest.providerId) : null,
    providerId: dest.providerId,
    recipient: ["azure", "bedrock", "vertex"].includes(dest.providerId || "")
      ? (s.facts.enterpriseRecipients?.[dest.providerId as EnterpriseProviderId] ?? {
          status: "unknown",
        })
      : null,
    // Built-in engines already have dest.host === null. Preserve the host for
    // configured loopback endpoints: device locality still permits them in
    // Sealed mode, while the host distinguishes them from Loqui's own engines.
    host: dest.host,
    model: dest.model,
    state,
    sends: parts.length ? s.copy.list(parts.map((p) => s.copy.parts[p])) : null,
    settingsPath: ROUTE_SETTINGS_PATH[id],
  };
}

export function resolveRoutes(s: RouteSettingsSnapshot): ResolvedRoute[] {
  return ROUTE_IDS.map((id) => resolveRoute(s, id));
}
