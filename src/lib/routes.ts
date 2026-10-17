import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { normalizeRouteVerificationOptions } from "../helpers/routeVerificationOptions.mjs";
import i18n from "../i18n";
import { API_ENDPOINTS } from "../config/constants";
import { MEETING_STREAMING_PROVIDER_IDS } from "../helpers/meetingTranscriptionRouting";
import {
  getCloudModel,
  getLocalModel,
  getParakeetModelInfo,
  getTranscriptionModels,
  getTranscriptionProviders,
  getWhisperModelInfo,
} from "../models/ModelRegistry";
import {
  selectResolvedLLMConfig,
  selectResolvedMeetingTranscription,
  selectResolvedUploadTranscription,
  useSettingsStore,
  type SettingsState,
} from "../stores/settingsStore.ts";
import { ensureRouteFactsSubscribed, useRouteFactsStore } from "../stores/routeFactsStore";
import { ensureSealedSubscribed, getSealed, useSealedStore } from "../stores/sealedStore";
import { getDictionaryHintWords } from "../utils/snippets";
import { isProviderSearchEnabled, PROVIDER_SEARCH_CHANGED_EVENT } from "../utils/providerSearch";
import {
  matchingRejectedCredentials,
  localSttModelKey,
  type CredentialId,
  type CredentialVerificationIdentity,
  resolveRoutes,
  resolveRoute,
  type LlmRouteInput,
  type LlmRouteScope,
  type ModelInfo,
  type PayloadPart,
  type ResolvedRoute,
  type RouteCapabilities,
  type RouteCopy,
  type RouteFacts,
  type RouteId,
  type RouteSettingsSnapshot,
  type SttContext,
  type SttRouteInput,
} from "./routeGraph.ts";

// §5.1 contract module. The pure graph (types, resolver, payload composition)
// lives in routeGraph.ts, which stays Node-loadable, and is re-exported
// unchanged. This file adds what needs the renderer: the snapshot builder over
// the settings store, translated route copy, the imperative snapshot and the
// React hooks.
export * from "./routeGraph.ts";

const LLM_SCOPES: readonly LlmRouteScope[] = [
  "dictationCleanup",
  "dictationAgent",
  "dictationAgentVision",
  "dictationTranslation",
  "noteFormatting",
  "chatIntelligence",
];

interface SttSource {
  transcriptionMode: string;
  localTranscriptionProvider: string;
  whisperModel: string;
  parakeetModel: string;
  cohereModel: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl?: string;
}

function sttInput(src: SttSource, remoteUrl: string, remoteModel: string): SttRouteInput {
  const localModel =
    src.localTranscriptionProvider === "whisper"
      ? src.whisperModel
      : src.localTranscriptionProvider === "cohere"
        ? src.cohereModel
        : src.localTranscriptionProvider === "nvidia"
          ? src.parakeetModel
          : "";
  return {
    mode: src.transcriptionMode,
    localProvider: src.localTranscriptionProvider,
    localModel,
    cloudProvider: src.cloudTranscriptionProvider,
    cloudModel: src.cloudTranscriptionModel,
    cloudBaseUrl: src.cloudTranscriptionBaseUrl ?? "",
    remoteUrl,
    remoteModel,
  };
}

// Keys: localSttModelKey(provider, id) for local speech, "llm:<id>" for local
// text, "cloud:<provider>:<id>" for cloud models (read by routeGraph.ts).
function describeModels(
  stt: Record<SttContext, SttRouteInput>,
  llm: Record<LlmRouteScope, LlmRouteInput>
): Record<string, ModelInfo> {
  const models: Record<string, ModelInfo> = {};
  for (const input of Object.values(stt)) {
    if (input.localModel) {
      const key = localSttModelKey(input.localProvider, input.localModel);
      if (input.localProvider === "whisper") {
        const info = getWhisperModelInfo(input.localModel);
        if (info && key) models[key] = { name: info.name, sizeBytes: info.sizeMb * 1_000_000 };
      } else {
        const info = getParakeetModelInfo(input.localModel);
        if (info && key)
          models[key] = {
            name: info.name,
            sizeBytes: info.expectedSizeBytes ?? info.sizeMb * 1_000_000,
          };
      }
    }
    if (input.cloudProvider && input.cloudModel) {
      const info = getTranscriptionModels(input.cloudProvider).find(
        (m) => m.id === input.cloudModel
      );
      if (info) models[`cloud:${input.cloudProvider}:${input.cloudModel}`] = { name: info.name };
    }
  }
  for (const input of Object.values(llm)) {
    if (!input.model) continue;
    const local = getLocalModel(input.model);
    if (local) models[`llm:${input.model}`] = { name: local.name, sizeBytes: local.sizeBytes };
    const cloud = input.provider ? getCloudModel(input.model, input.provider) : undefined;
    if (cloud) models[`cloud:${input.provider}:${input.model}`] = { name: cloud.name };
  }
  return models;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

let capabilities: RouteCapabilities | null = null;

// Static registry data, passed in so routeGraph.ts stays JSON-free.
function routeCapabilities(): RouteCapabilities {
  if (capabilities) return capabilities;
  const transcriptionProviders = getTranscriptionProviders();
  const providerHosts: Record<string, string> = {};
  const add = (id: string, url: string) => {
    const host = hostOf(url);
    if (host) providerHosts[id] = host;
  };
  for (const provider of transcriptionProviders) add(provider.id, provider.baseUrl);
  add("openai", API_ENDPOINTS.OPENAI_BASE);
  add("anthropic", API_ENDPOINTS.ANTHROPIC);
  add("gemini", API_ENDPOINTS.GEMINI);
  add("groq", API_ENDPOINTS.GROQ_BASE);
  add("openrouter", API_ENDPOINTS.OPENROUTER_BASE);
  // Corti text uses the API key against one fixed host (constants.ts:123,
  // personalInference.js:78), unlike Corti speech, whose host follows the
  // region (capabilitiesFor below). Task 1 reads this key for Corti text routes.
  add("corti:text", API_ENDPOINTS.CORTI_MODELS_BASE);
  // Codex requests go through the ChatGPT account it signs in to
  // (auth hosts checked at src/helpers/personalInference.js:258).
  add("codex", "https://chatgpt.com");
  // Bedrock, Azure and Vertex deliberately get no entry (R2-1): their host
  // follows settings (region, endpoint, project/location) and the Vertex key,
  // so Task 1 derives it from snapshot.enterprise + facts.credentialFields with
  // enterpriseRequestHost, never from this static table.
  capabilities = {
    meetingProviders: [...MEETING_STREAMING_PROVIDER_IDS],
    transcriptionProviderBaseUrls: transcriptionProviders.map(({ id, baseUrl }) => ({
      id,
      baseUrl,
    })),
    providerHosts,
  };
  return capabilities;
}

// Corti speech connects to api.<region>.corti.app (cortiTranscription.js:39,
// cortiStreaming.js:48); the registry baseUrl names only the US host. An empty
// region means US (transcriptionRoute.ts:305). The shared exact normalizer
// admits only executor-valid regions and tenant paths. Invalid raw settings
// remain visible but carry no speech host or readiness.
function capabilitiesFor(settings: SettingsState): RouteCapabilities {
  const statics = routeCapabilities();
  const target = normalizeRouteVerificationOptions(settings);
  return {
    ...statics,
    providerHosts: {
      ...statics.providerHosts,
      corti: target ? `api.${target.cortiEnvironment}.corti.app` : "",
    },
    cortiSpeechTargetValid: target !== null,
  };
}

// Every supplied settings snapshot gets its own projection. A main binding for
// tenant A cannot reject tenant B, even when both authentication hosts match.
function snapshotFacts(settings: SettingsState, facts: RouteFacts): RouteFacts {
  const metadata = facts.credentialHealth;
  if (!metadata) return facts.rejected.size ? { ...facts, rejected: new Set() } : facts;
  const options = normalizeRouteVerificationOptions(settings);
  const sameCortiOptions =
    options !== null &&
    metadata.options !== null &&
    options.cortiEnvironment === metadata.options.cortiEnvironment &&
    options.cortiTenant === metadata.options.cortiTenant;
  const current = new Map<CredentialId, CredentialVerificationIdentity>();
  for (const binding of metadata.current) {
    if (
      !Number.isSafeInteger(binding.generation) ||
      binding.generation < 0 ||
      typeof binding.configFingerprint !== "string" ||
      !binding.configFingerprint
    )
      continue;
    if (["bedrock", "azure", "vertex", "codex"].includes(binding.identity)) continue;
    if (binding.identity === "corti:speech" && !sameCortiOptions) continue;
    if (
      facts.credentialGenerations?.get(binding.identity) !== binding.generation ||
      facts.credentialUnknown?.has(binding.identity) ||
      facts.credentials?.get(binding.identity) !== true
    )
      continue;
    current.set(binding.identity, binding);
  }
  return { ...facts, rejected: matchingRejectedCredentials(metadata.health, current) };
}

export function buildRouteSnapshot(
  settings: SettingsState,
  facts: RouteFacts,
  copy: RouteCopy,
  sealed: boolean
): RouteSettingsSnapshot {
  const meeting = selectResolvedMeetingTranscription(settings);
  const upload = selectResolvedUploadTranscription(settings);
  const stt: Record<SttContext, SttRouteInput> = {
    dictation: sttInput(
      settings,
      settings.remoteTranscriptionUrl,
      settings.remoteTranscriptionModel
    ),
    // Note recording has no self-hosted model field of its own.
    meeting: sttInput(meeting, meeting.remoteTranscriptionUrl, settings.remoteTranscriptionModel),
    // Upload has no self-hosted fields: UploadSettings.tsx binds SelfHostedPanel
    // to the dictation server URL.
    upload: sttInput(upload, settings.remoteTranscriptionUrl, settings.remoteTranscriptionModel),
  };

  const llm = {} as Record<LlmRouteScope, LlmRouteInput>;
  for (const scope of LLM_SCOPES) {
    const cfg = selectResolvedLLMConfig(settings, scope);
    llm[scope] = {
      mode: cfg.mode,
      provider: cfg.provider,
      model: cfg.model,
      remoteUrl: cfg.remoteUrl ?? "",
      cloudBaseUrl: cfg.cloudBaseUrl ?? "",
      // The same function the request path uses (useChatStreaming.ts:392).
      providerSearch: isProviderSearchEnabled(scope, cfg.provider, cfg.mode),
    };
  }

  return {
    stt,
    llm,
    // R2-1: the non-secret settings main hands enterpriseAiProviders.js
    // (main.js:447-457; the setters write both sides, settingsStore.ts:2033-2097).
    // Raw strings, untrimmed, because the executor uses them untrimmed. No
    // secret, profile or API version: none of them changes the host.
    enterprise: {
      bedrockRegion: settings.bedrockRegion ?? "",
      azureEndpoint: settings.azureEndpoint ?? "",
      vertexProject: settings.vertexProject ?? "",
      vertexLocation: settings.vertexLocation ?? "",
      vertexAuthSource: settings.vertexAuthSource,
    },
    enabled: {
      cleanup: settings.useCleanupModel,
      voiceAssistant: settings.useDictationAgent,
      screenContext: settings.voiceAgentScreenContext,
      visionOverride: settings.useDictationAgentVisionModel,
      translation: settings.useDictationTranslation,
      speakerId: settings.speakerDiarizationEnabled,
    },
    // The same hint list the STT prompt, cleanup suffix and chat request use.
    dictionaryInUse: getDictionaryHintWords(settings).length > 0,
    facts: snapshotFacts(settings, facts),
    models: describeModels(stt, llm),
    capabilities: capabilitiesFor(settings),
    sealed,
    copy,
  };
}

function listFormat(language: string): Intl.ListFormat {
  try {
    return new Intl.ListFormat(language || "en", { style: "long", type: "conjunction" });
  } catch {
    return new Intl.ListFormat("en", { style: "long", type: "conjunction" });
  }
}

export function routeCopy(t: (key: string) => string, language: string): RouteCopy {
  const parts: Record<PayloadPart, string> = {
    audio: t("routes.payload.audio"),
    audioFile: t("routes.payload.audioFile"),
    meetingAudio: t("routes.payload.meetingAudio"),
    dictionary: t("routes.payload.dictionary"),
    dictionaryWords: t("routes.payload.dictionaryWords"),
    transcript: t("routes.payload.transcript"),
    request: t("routes.payload.request"),
    selectedText: t("routes.payload.selectedText"),
    history: t("routes.payload.history"),
    lookups: t("routes.payload.lookups"),
    noteText: t("routes.payload.noteText"),
    meetingTranscript: t("routes.payload.meetingTranscript"),
    participants: t("routes.payload.participants"),
    screenshot: t("routes.payload.screenshot"),
    webSearch: t("routes.payload.webSearch"),
    messages: t("routes.payload.messages"),
  };
  const format = listFormat(language);
  return { parts, list: (items) => format.format(items) };
}

export function currentRouteCopy(): RouteCopy {
  return routeCopy((key) => String(i18n.t(key)), i18n.language || "en");
}

// Non-React reader for click-time decisions (Apply, Undo, Keyring). Reads the
// current facts, the sealed store and the app's i18n; subscribes to nothing
// and calls no IPC. Unloaded facts stay unknown, which never reads as ready.
export function routeSnapshotFromSettings(settings: SettingsState): RouteSettingsSnapshot {
  return buildRouteSnapshot(
    settings,
    useRouteFactsStore.getState().facts,
    currentRouteCopy(),
    getSealed()
  );
}

// --- React hooks (§5.1) ---

// providerSearch lives in localStorage, outside every store; this version
// re-runs the builder when a toggle changes here or in another window.
let providerSearchVersion = 0;
function subscribeProviderSearch(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const bump = () => {
    providerSearchVersion += 1;
    onChange();
  };
  window.addEventListener(PROVIDER_SEARCH_CHANGED_EVENT, bump);
  window.addEventListener("storage", bump);
  return () => {
    window.removeEventListener(PROVIDER_SEARCH_CHANGED_EVENT, bump);
    window.removeEventListener("storage", bump);
  };
}
const readProviderSearchVersion = () => providerSearchVersion;

export function useRouteCopy(): RouteCopy {
  const { t, i18n: instance } = useTranslation();
  const language = instance?.language || "en";
  return useMemo(() => routeCopy(t, language), [t, language]);
}

export function useResolvedRoutes(): ResolvedRoute[] {
  const settings = useSettingsStore();
  const facts = useRouteFactsStore((s) => s.facts);
  const sealed = useSealedStore((s) => s.sealed);
  const copy = useRouteCopy();
  const searchVersion = useSyncExternalStore(
    subscribeProviderSearch,
    readProviderSearchVersion,
    readProviderSearchVersion
  );
  useEffect(() => {
    ensureRouteFactsSubscribed();
    ensureSealedSubscribed();
  }, []);
  return useMemo(
    () => resolveRoutes(buildRouteSnapshot(settings, facts, copy, sealed)),
    // searchVersion is not read here: it re-runs the builder, which reads localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, facts, copy, sealed, searchVersion]
  );
}

export function useResolvedRoute(id: RouteId): ResolvedRoute {
  const routes = useResolvedRoutes();
  return routes.find((route) => route.id === id) as ResolvedRoute;
}

/** Shares the graph's destination selection even while readiness facts are unknown. */
export function selectRouteProvider(
  settings: SettingsState,
  id: RouteId
): { status: "known"; providerId: string | null } | { status: "unknown" } {
  try {
    const route = resolveRoute(routeSnapshotFromSettings(settings), id);
    return route.state.status === "unreachable" &&
      ["unsupported", "retired"].includes(route.state.detail ?? "")
      ? { status: "unknown" }
      : { status: "known", providerId: route.providerId };
  } catch {
    return { status: "unknown" };
  }
}
