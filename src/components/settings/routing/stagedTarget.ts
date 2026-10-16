import { INFERENCE_SCOPES, type InferenceScopeStoreKeys } from "../../../config/inferenceScopes";
import { SCOPE_ROUTE, type LlmRouteScope, type RouteId } from "../../../lib/routes";
import type { RouteTarget } from "../../../lib/routePlanner";
import {
  selectResolvedLLMConfig,
  selectResolvedMeetingTranscription,
  selectResolvedUploadTranscription,
  useSettingsStore,
  type SettingsState,
} from "../../../stores/settingsStore";
import { planDraft, type RouteDraft } from "../../../stores/routeDraftStore";
import type { RouteCopy } from "../../../lib/routes";
import type { InferenceMode } from "../../../types/electron";

const SPEECH_ROUTES: ReadonlySet<RouteId> = new Set([
  "dictationStt",
  "noteRecordingStt",
  "uploadStt",
]);

export function scopeForRoute(id: RouteId): LlmRouteScope | null {
  for (const [scope, route] of Object.entries(SCOPE_ROUTE) as Array<[LlmRouteScope, RouteId]>) {
    if (route === id) return scope;
  }
  return null;
}

// A mode choice never pre-arms a provider (SET-13). Self-hosted starts from
// the address the route already knows; upload uses dictation's shared server.
export function stagedTargetForMode(
  mode: InferenceMode,
  id: RouteId,
  state: SettingsState
): RouteTarget {
  if (mode === "local") return { mode: "local" };
  if (mode === "self-hosted") {
    if (SPEECH_ROUTES.has(id))
      return { mode: "self-hosted", remoteUrl: state.remoteTranscriptionUrl };
    const scope = scopeForRoute(id);
    const key = scope
      ? (INFERENCE_SCOPES[scope].storeKeys as InferenceScopeStoreKeys).remoteUrl
      : undefined;
    return { mode: "self-hosted", remoteUrl: key ? String(state[key] ?? "") : "" };
  }
  return { mode: "providers", provider: "" };
}

// Resolve the route as it would run after the live pending patch. This keeps
// setup reachable for enables and for a separately configured coupled route.
export function routeDraftTarget(
  draft: RouteDraft,
  copy: RouteCopy,
  id: RouteId = draft.routeId
): RouteTarget | null {
  if (draft.kind === "target" && draft.routeId === id) return draft.target;
  const plan = planDraft(draft, copy);
  if (
    id !== draft.routeId &&
    !plan.changes.some((change) => change.id === id && change.after.state.status !== "off")
  )
    return null;
  const state = { ...useSettingsStore.getState(), ...plan.patch } as SettingsState;
  let scope = scopeForRoute(id);
  if (scope) {
    if (id === "assistantVision" && !state.useDictationAgentVisionModel) scope = "dictationAgent";
    const config = selectResolvedLLMConfig(state, scope);
    if (config.mode === "local" && scope !== "dictationAgentVision")
      return { mode: "local", provider: config.provider, model: config.model };
    if (config.mode === "self-hosted" && scope !== "dictationAgentVision")
      return { mode: "self-hosted", remoteUrl: config.remoteUrl ?? "", model: config.model };
    return {
      mode: "providers",
      provider: config.provider,
      model: config.model,
      baseUrl: config.cloudBaseUrl ?? "",
    };
  }
  if (!SPEECH_ROUTES.has(id)) return null;
  const speech =
    id === "noteRecordingStt"
      ? selectResolvedMeetingTranscription(state)
      : id === "uploadStt"
        ? selectResolvedUploadTranscription(state)
        : state;
  if (speech.transcriptionMode === "local") return { mode: "local" };
  if (speech.transcriptionMode === "self-hosted")
    return {
      mode: "self-hosted",
      remoteUrl:
        id === "noteRecordingStt"
          ? state.meetingRemoteTranscriptionUrl || state.remoteTranscriptionUrl
          : state.remoteTranscriptionUrl,
      model: state.remoteTranscriptionModel,
    };
  return {
    mode: "providers",
    provider: speech.cloudTranscriptionProvider,
    model: speech.cloudTranscriptionModel,
    baseUrl: speech.cloudTranscriptionBaseUrl ?? "",
  };
}
