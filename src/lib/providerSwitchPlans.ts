import modelRegistryData from "../models/modelRegistryData.json";
import { pickDefaultModelId, pickProviderDefaultModel } from "../models/providerDefaultModel";
import { INFERENCE_SCOPES, type InferenceScope } from "../config/inferenceScopes";
import type { SettingsState } from "../stores/settingsStore";
import { adjustBedrockModelForRegion } from "../utils/bedrockRegions";
import type { TranscriptionPolicyContext } from "../utils/providerSelection";

// Provider-switch patches shared by the settings store's own switch actions
// and the route planner (routePlanner.ts), so a previewed switch is the
// committed switch. Pure: reads the state it is given and returns raw store
// writes. It imports neither the store (the store imports this module) nor
// ModelRegistry (which imports the store).

const STT_ROUTE_KEYS = [
  "transcriptionMode",
  "useLocalWhisper",
  "cloudTranscriptionMode",
  "localTranscriptionProvider",
  "whisperModel",
  "parakeetModel",
  "cohereModel",
  "cloudTranscriptionProvider",
  "cloudTranscriptionModel",
  "cloudTranscriptionBaseUrl",
  "remoteTranscriptionUrl",
  "remoteTranscriptionModel",
  "meetingTranscriptionMode",
  "meetingUseLocalWhisper",
  "meetingCloudTranscriptionMode",
  "meetingLocalTranscriptionProvider",
  "meetingWhisperModel",
  "meetingParakeetModel",
  "meetingCohereModel",
  "meetingCloudTranscriptionProvider",
  "meetingCloudTranscriptionModel",
  "meetingCloudTranscriptionBaseUrl",
  "meetingRemoteTranscriptionUrl",
  "uploadTranscriptionMode",
  "uploadUseLocalWhisper",
  "uploadCloudTranscriptionMode",
  "uploadLocalTranscriptionProvider",
  "uploadWhisperModel",
  "uploadParakeetModel",
  "uploadCohereModel",
  "uploadCloudTranscriptionProvider",
  "uploadCloudTranscriptionModel",
  "uploadCloudTranscriptionBaseUrl",
] as const satisfies readonly (keyof SettingsState)[];

// The vision scope's mode is deliberately absent. The override is
// provider-only, and its mode is never persisted (settingsStore.ts:1757-1758),
// so a patch that tries to write it is refused.
const LLM_ROUTE_KEYS = [
  "cleanupMode",
  "cleanupProvider",
  "cleanupModel",
  "cleanupCloudMode",
  "cleanupCloudBaseUrl",
  "cleanupRemoteUrl",
  "dictationAgentMode",
  "dictationAgentProvider",
  "dictationAgentModel",
  "dictationAgentCloudMode",
  "dictationAgentCloudBaseUrl",
  "dictationAgentRemoteUrl",
  "dictationAgentVisionProvider",
  "dictationAgentVisionModel",
  "dictationAgentVisionCloudMode",
  "dictationAgentVisionCloudBaseUrl",
  "noteFormattingMode",
  "noteFormattingProvider",
  "noteFormattingModel",
  "noteFormattingCloudMode",
  "noteFormattingCloudBaseUrl",
  "noteFormattingRemoteUrl",
  "chatAgentMode",
  "chatAgentProvider",
  "chatAgentModel",
  "chatAgentCloudMode",
  "chatAgentCloudBaseUrl",
  "chatAgentRemoteUrl",
  "translationMode",
  "translationProvider",
  "translationModel",
  "translationCloudMode",
  "translationCloudBaseUrl",
  "translationRemoteUrl",
] as const satisfies readonly (keyof SettingsState)[];

// Switches that turn a route on or off. Turning one on can add a recipient,
// so the editors send them through the planner (Task 8), never a setter.
export const ROUTE_SWITCH_KEYS = [
  "useCleanupModel",
  "useDictationTranslation",
  "useDictationAgent",
  "voiceAgentScreenContext",
  "useDictationAgentVisionModel",
] as const satisfies readonly (keyof SettingsState)[];
export type RouteSwitchKey = (typeof ROUTE_SWITCH_KEYS)[number];

// Options that decide the receiving host without being a provider field:
// Corti's region picks api.<region>.corti.app (cortiTranscription.js:39,
// cortiStreaming.js:48); the tenant picks the auth realm on the same host.
export const ROUTE_OPTION_KEYS = [
  "cortiEnvironment",
  "cortiTenant",
] as const satisfies readonly (keyof SettingsState)[];

// Enterprise settings that pick the receiving host (R2-1/R3-1): the Bedrock region
// (bedrock-runtime.<region>…), the Azure endpoint (its own host), and Vertex's
// persisted auth source (express vs ADC), project and location (<location>-aiplatform…;
// the project scopes the ADC request and decides readiness). Main hands them to enterpriseAiProviders.js
// (main.js:447-457). azureApiVersion (a query parameter) and bedrockProfile (a
// credential source on the same host) are deliberately not route keys.
export const ROUTE_ENTERPRISE_KEYS = [
  "bedrockRegion",
  "azureEndpoint",
  "vertexProject",
  "vertexLocation",
  "vertexAuthSource",
] as const satisfies readonly (keyof SettingsState)[];
export type RouteEnterpriseKey = (typeof ROUTE_ENTERPRISE_KEYS)[number];

// The provider web-search preference lives in localStorage as
// personalWebSearch:<scope> (src/utils/providerSearch.ts), not in the store.
// A patch carries it as providerSearch:<scope>; only these scopes support it
// (supportsProviderSearch, providerSearch.ts:2-8).
export type ProviderSearchScope = "chatIntelligence" | "dictationAgent";
export const PROVIDER_SEARCH_PATCH_KEYS = [
  "providerSearch:chatIntelligence",
  "providerSearch:dictationAgent",
] as const;
export type ProviderSearchPatchKey = (typeof PROVIDER_SEARCH_PATCH_KEYS)[number];

export function providerSearchScope(key: string): ProviderSearchScope | null {
  return (PROVIDER_SEARCH_PATCH_KEYS as readonly string[]).includes(key)
    ? (key.slice("providerSearch:".length) as ProviderSearchScope)
    : null;
}

// The only store fields a route patch may write. No secret is on this list,
// so a patch can never carry key material (applyRoutePatch enforces it).
export const ROUTE_PATCH_KEYS = [
  ...STT_ROUTE_KEYS,
  ...LLM_ROUTE_KEYS,
  "transcriptionModelByProvider",
  "reasoningModelByProvider",
  ...ROUTE_SWITCH_KEYS,
  ...ROUTE_OPTION_KEYS,
  ...ROUTE_ENTERPRISE_KEYS,
] as const;

export type NonSecretKeys = (typeof ROUTE_PATCH_KEYS)[number];
export type SettingsPatch = Partial<Pick<SettingsState, NonSecretKeys>> &
  Partial<Record<ProviderSearchPatchKey, boolean>>;
export const ROUTE_PATCH_KEY_SET: ReadonlySet<string> = new Set<string>([
  ...ROUTE_PATCH_KEYS,
  ...PROVIDER_SEARCH_PATCH_KEYS,
]);

// Independent task slots used only when the user changes a provider.
export const TRANSCRIPTION_CONTEXT_KEYS = [
  {
    context: "dictation",
    provider: "cloudTranscriptionProvider",
    model: "cloudTranscriptionModel",
  },
  {
    context: "meeting",
    provider: "meetingCloudTranscriptionProvider",
    model: "meetingCloudTranscriptionModel",
  },
  {
    context: "upload",
    provider: "uploadCloudTranscriptionProvider",
    model: "uploadCloudTranscriptionModel",
  },
] as const;

export const ENTERPRISE_PROVIDER_IDS: ReadonlySet<string> = new Set(["bedrock", "azure", "vertex"]);

function transcriptionProviderModels(
  providerId: string,
  context: TranscriptionPolicyContext
): Array<{ id: string; streaming?: boolean }> {
  const models =
    modelRegistryData.transcriptionProviders.find((provider) => provider.id === providerId)
      ?.models ?? [];
  return context === "meeting" ? models.filter((model) => model.streaming) : models;
}

export function defaultTranscriptionModel(
  providerId: string,
  context: TranscriptionPolicyContext
): string {
  return transcriptionProviderModels(providerId, context)[0]?.id ?? "whisper-1";
}

function transcriptionModelBelongsToProvider(
  providerId: string,
  modelId: string,
  context: TranscriptionPolicyContext
): boolean {
  if (providerId === "custom") return Boolean(modelId);
  return transcriptionProviderModels(providerId, context).some((model) => model.id === modelId);
}

export function reasoningModelBelongsToProvider(providerId: string, modelId: string): boolean {
  if (!modelId) return false;
  // Custom and OpenRouter ids are free-form; any remembered id is valid.
  // Tinfoil's registry entry is refreshed in place from its live catalog.
  if (providerId === "custom" || providerId === "openrouter") return true;
  return (
    modelRegistryData.cloudProviders
      .find((provider) => provider.id === providerId)
      ?.models.some((model) => model.id === modelId) ?? false
  );
}

interface RegistryModel {
  id: string;
  supportsVision?: boolean;
}
interface RegistryProvider {
  id: string;
  defaultModel?: string;
  models?: RegistryModel[];
}

// The registry's default rule (providerDefaultModel.ts): a named default
// wins, otherwise the first (best) model. Vision keeps only models flagged
// supportsVision. Enterprise entries carry no vision flags, so all of their
// models qualify. Codex, custom and OpenRouter have no registry list: "".
export function defaultCloudModel(providerId: string, options: { vision?: boolean } = {}): string {
  const cloud = (modelRegistryData.cloudProviders as RegistryProvider[]).find(
    (provider) => provider.id === providerId
  );
  if (cloud) {
    const models = options.vision
      ? (cloud.models ?? []).filter((model) => model.supportsVision)
      : cloud.models;
    return pickProviderDefaultModel(models, cloud.defaultModel)?.id ?? "";
  }
  return pickDefaultModelId(
    (modelRegistryData.enterpriseProviders as RegistryProvider[]).find(
      (provider) => provider.id === providerId
    )
  );
}

// The same read as selectResolvedLLMConfig (settingsStore.ts:2629-2662):
// the scope's own value, else its fallback scope's, else "".
export function resolvedScopeField(
  state: SettingsState,
  scope: InferenceScope,
  field: "provider" | "model" | "cloudBaseUrl"
): string {
  const def = INFERENCE_SCOPES[scope] as {
    storeKeys: Partial<Record<string, keyof SettingsState>>;
    fallbackScope?: string;
  };
  const key = def.storeKeys[field];
  const own = key ? ((state[key] as string | undefined) ?? "") : "";
  if (own) return own;
  return def.fallbackScope
    ? resolvedScopeField(state, def.fallbackScope as InferenceScope, field)
    : "";
}

function write(patch: SettingsPatch, key: keyof SettingsState, value: unknown): void {
  (patch as Record<string, unknown>)[key as string] = value;
}

// Writes that must travel with `patch` so the routes it moves still run (R2-1).
// Bedrock cross-region inference profile ids are geo-scoped (us./eu./apac.,
// bedrockRegions.ts:1-3): a region in another geography needs the matching
// prefix, which EnterpriseProviderConfig.tsx:115-118 wrote with the region.
// Every scope that resolves to Bedrock and stores its own model is adjusted
// (the old handler adjusted only the scope on screen); inheriting scopes
// follow their parent. A model key the patch itself writes is kept verbatim:
// that is the caller's explicit choice, and it makes a re-planned undoPatch
// (Task 7's Undo) add nothing. Called by planPatch only; applyRoutePatch never
// expands a patch.
// The model keys a region change can rewrite in `state`: every scope that
// resolves to Bedrock and stores its own model. The planner also pins these
// in the undoPatch, so a re-planned Undo restores the region and rewrites no model.
export function bedrockCoupledModelKeys(state: SettingsState): (keyof SettingsState)[] {
  const found: (keyof SettingsState)[] = [];
  for (const scope of Object.keys(INFERENCE_SCOPES) as InferenceScope[]) {
    const keys = INFERENCE_SCOPES[scope].storeKeys;
    // The vision scope's mode is never persisted (settingsStore.ts:1757-1758); it is provider-only.
    const mode = state[keys.mode] as string | undefined;
    if (scope !== "dictationAgentVision" && mode !== "enterprise" && mode !== "providers") continue;
    if (resolvedScopeField(state, scope, "provider") !== "bedrock") continue;
    if ((state[keys.model] as string | undefined) ?? "") found.push(keys.model);
  }
  return found;
}

export function planEnterpriseCoupling(state: SettingsState, patch: SettingsPatch): SettingsPatch {
  const coupled: SettingsPatch = {};
  const region = patch.bedrockRegion;
  // Only a real region change couples; re-typing the current region writes nothing.
  if (region === undefined || region === state.bedrockRegion) return coupled;
  const after = { ...state, ...patch } as SettingsState;
  for (const key of bedrockCoupledModelKeys(after)) {
    if (key in patch) continue;
    const own = after[key] as string;
    const adjusted = adjustBedrockModelForRegion(own, region);
    if (adjusted !== own) write(coupled, key, adjusted);
  }
  return coupled;
}

// Every provider shares one model slot per scope, so a plain provider write
// destroys the outgoing provider's model (the "Parasail" wipe). This plan
// remembers the outgoing model and restores the incoming provider's last one.
export function planTranscriptionProviderSwitch(
  state: SettingsState,
  context: TranscriptionPolicyContext,
  providerId: string
): SettingsPatch {
  const patch: SettingsPatch = {};
  const keys = TRANSCRIPTION_CONTEXT_KEYS.find((entry) => entry.context === context);
  if (!keys) return patch;
  // Meeting/upload raw keys default to "" (inherit from dictation), so work
  // against resolved values. Restoring writes a concrete model — the scope
  // stops inheriting the dictation model from that point on.
  const outgoingProvider = (state[keys.provider] as string) || state.cloudTranscriptionProvider;
  if (outgoingProvider === providerId) {
    write(patch, keys.provider, providerId);
    return patch;
  }
  const outgoingModel = (state[keys.model] as string) || state.cloudTranscriptionModel;
  const memory = { ...state.transcriptionModelByProvider };
  if (outgoingProvider && outgoingModel) {
    memory[`${context}:${outgoingProvider}`] = outgoingModel;
    patch.transcriptionModelByProvider = memory;
  }
  const remembered = memory[`${context}:${providerId}`];
  write(patch, keys.provider, providerId);
  write(
    patch,
    keys.model,
    remembered && transcriptionModelBelongsToProvider(providerId, remembered, context)
      ? remembered
      : defaultTranscriptionModel(providerId, context)
  );
  return patch;
}

// LLM twin. The caller supplies the provider's default model because dynamic
// catalogs (Tinfoil) live in the UI.
export function planReasoningProviderSwitch(
  state: SettingsState,
  scope: InferenceScope,
  providerId: string,
  fallbackModel = ""
): SettingsPatch {
  const keys = INFERENCE_SCOPES[scope].storeKeys;
  const currentProvider = resolvedScopeField(state, scope, "provider");
  const currentModel = resolvedScopeField(state, scope, "model");
  const memory = { ...state.reasoningModelByProvider };
  const patch: SettingsPatch = {};
  // Only remember a model the outgoing provider actually owns — after a
  // local/cloud mode round-trip the shared slot can hold a foreign id.
  if (currentProvider && currentProvider !== providerId) {
    if (reasoningModelBelongsToProvider(currentProvider, currentModel)) {
      memory[`${scope}:${currentProvider}`] = currentModel;
      patch.reasoningModelByProvider = memory;
    }
  } else if (reasoningModelBelongsToProvider(providerId, currentModel)) {
    // Reselecting the current provider with a model it owns: keep it.
    write(patch, keys.provider, providerId);
    return patch;
  }
  const remembered = memory[`${scope}:${providerId}`];
  write(patch, keys.provider, providerId);
  write(
    patch,
    keys.model,
    remembered && reasoningModelBelongsToProvider(providerId, remembered)
      ? remembered
      : fallbackModel
  );
  return patch;
}
