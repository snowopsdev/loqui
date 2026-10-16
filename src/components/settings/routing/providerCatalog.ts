import { MEETING_STREAMING_PROVIDER_IDS } from "../../../helpers/meetingTranscriptionRouting.js";
import { STREAMING_ONLY_PROVIDERS } from "../../../helpers/transcriptionRoute";
import { SETUP_AFTER_APPLY } from "../../../lib/routePlanner";
import { routeCredentialId, type CredentialId, type RouteId } from "../../../lib/routes";
import {
  REASONING_PROVIDERS,
  getMeetingStreamingTranscriptionProviders,
  getTranscriptionModels,
  getTranscriptionProviders,
} from "../../../models/ModelRegistry";
import { providerSupports } from "../../../services/ai/inferenceProviders";
import type { SecretStoreKey, SettingsState } from "../../../stores/settingsStore";

export type ProviderCapability = "speech" | "text" | "vision";

// ReasoningModelSelector's provider tabs, in its order (ReasoningModelSelector.tsx:47-60).
// Every tab is a provider main runs (Task 1's TEXT_PROVIDER_IDS, which also
// lists mistral and xai; they have no tab, so no editor could finish them).
// Not named TEXT_PROVIDER_IDS: that name is Task 1's main-side list.
export const TEXT_PROVIDER_TABS: readonly string[] = [
  "codex",
  "bedrock",
  "azure",
  "vertex",
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "openrouter",
  "tinfoil",
  "corti",
  "custom",
];

export function capabilityOf(id: RouteId): ProviderCapability | null {
  if (id === "dictationStt" || id === "noteRecordingStt" || id === "uploadStt") return "speech";
  if (id === "assistantVision") return "vision";
  if (id === "speakerId" || id === "semanticSearch") return null;
  return "text";
}

// The same lists TranscriptionModelPicker offers per context (:502-519):
// note recording runs only main's streaming clients and has no custom
// endpoint; upload is batch-only, so realtime-only providers cannot serve it.
export function providersForRoute(id: RouteId): string[] {
  const capability = capabilityOf(id);
  if (capability === null) return [];
  if (capability === "speech") {
    if (id === "noteRecordingStt") {
      return getMeetingStreamingTranscriptionProviders()
        .map((provider) => provider.id)
        .filter((providerId) => MEETING_STREAMING_PROVIDER_IDS.includes(providerId));
    }
    const speech = getTranscriptionProviders().map((provider) => provider.id);
    if (id === "uploadStt")
      return [...speech.filter((p) => !STREAMING_ONLY_PROVIDERS.has(p)), "custom"];
    return [...speech, "custom"];
  }
  const need = capability === "vision" ? "images" : "textGeneration";
  return TEXT_PROVIDER_TABS.filter((providerId) => providerSupports(providerId, need));
}

export interface CredentialFieldSpec {
  storeKey: SecretStoreKey;
  labelKey: string;
}
export interface CredentialSpec {
  credentialId: CredentialId;
  fields: CredentialFieldSpec[];
}

const apiKey = (storeKey: SecretStoreKey): CredentialFieldSpec[] => [
  { storeKey, labelKey: "common.apiKey" },
];

// The fields the staged panel asks for, per credential identity. Corti
// authenticates speech with a client id and secret and text with an API key
// (ipcHandlers.js:1105-1121), so each route asks for its own (I10). Codex and
// the enterprise clouds have no entry here: the staged panel renders their
// own sign-in and setup (Task 9) before Apply, never after it (R2-9).
const CREDENTIAL_FIELDS: Partial<Record<CredentialId, CredentialFieldSpec[]>> = {
  openai: apiKey("openaiApiKey"),
  anthropic: apiKey("anthropicApiKey"),
  gemini: apiKey("geminiApiKey"),
  groq: apiKey("groqApiKey"),
  xai: apiKey("xaiApiKey"),
  mistral: apiKey("mistralApiKey"),
  openrouter: apiKey("openrouterApiKey"),
  tinfoil: apiKey("tinfoilApiKey"),
  deepgram: apiKey("deepgramApiKey"),
  assemblyai: apiKey("assemblyaiApiKey"),
  "corti:speech": [
    { storeKey: "cortiClientId", labelKey: "transcription.corti.clientId" },
    { storeKey: "cortiClientSecret", labelKey: "transcription.corti.clientSecret" },
  ],
  "corti:text": apiKey("cortiApiKey"),
};

// The identity comes from Task 1's routeCredentialId, the single rule the
// resolver, planner and keyring use. Custom endpoints need no key to review.
export function credentialFor(routeId: RouteId, providerId: string): CredentialSpec | null {
  const credentialId = routeCredentialId(routeId, providerId);
  const fields = credentialId ? CREDENTIAL_FIELDS[credentialId] : undefined;
  return credentialId && fields ? { credentialId, fields } : null;
}

// Store sentinels only become non-empty after main acknowledges a save (Task 2).
export function hasSavedCredential(spec: CredentialSpec, settings: SettingsState): boolean {
  return spec.fields.every((field) => settings[field.storeKey] === "__stored__");
}

// Codex and the enterprise clouds are set up inside the staged panel
// (Task 9's setup slot). Copy only: Apply stays blocked until the route is
// ready (Task 6's routeBlocker, R2-9).
export function setsUpInEditor(providerId: string): boolean {
  return SETUP_AFTER_APPLY.has(providerId);
}

export interface StagedModelOption {
  id: string;
  name: string;
}

// Free-form ids: custom endpoints, OpenRouter, Codex (listed only on request,
// Task 9) and the enterprise deployments take a typed model id.
const TYPED_MODEL_PROVIDERS: ReadonlySet<string> = new Set([
  "custom",
  "openrouter",
  "codex",
  "bedrock",
  "azure",
  "vertex",
]);

// R2-9: the staged panel's model choice. Registry lists only; nothing is
// discovered over the network here.
export function modelsForRoute(id: RouteId, providerId: string): StagedModelOption[] {
  if (!providerId || TYPED_MODEL_PROVIDERS.has(providerId)) return [];
  if (capabilityOf(id) === "speech") {
    return getTranscriptionModels(providerId).map((model) => ({ id: model.id, name: model.name }));
  }
  const provider = REASONING_PROVIDERS[providerId as keyof typeof REASONING_PROVIDERS];
  return (provider?.models ?? []).map((model) => ({ id: model.value, name: model.label }));
}
