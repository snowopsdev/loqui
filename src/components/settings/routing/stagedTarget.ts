import { INFERENCE_SCOPES, type InferenceScopeStoreKeys } from "../../../config/inferenceScopes";
import { SCOPE_ROUTE, type LlmRouteScope, type RouteId } from "../../../lib/routes";
import type { RouteTarget } from "../../../lib/routePlanner";
import type { SettingsState } from "../../../stores/settingsStore";
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
