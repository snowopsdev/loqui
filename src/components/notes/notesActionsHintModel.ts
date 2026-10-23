import type { RouteState } from "../../lib/routes";

export interface NotesActionsHintCopy {
  titleKey: string;
  actionKey: string;
}

const K = "notes.actionsModelHint";

// §5.1 Notes readiness (Plan 02 CCR 6): ready shows nothing, unknown shows
// nothing yet, off disables Actions instead of nagging, and every other
// state names its fix. Every action opens the route's own settingsPath.
export function notesActionsHint(
  state: RouteState,
  dismissed: boolean
): NotesActionsHintCopy | null {
  if (dismissed) return null;
  if (state.status === "ready" || state.status === "unknown" || state.status === "off") return null;
  if (state.status === "needsModel") return { titleKey: `${K}.title`, actionKey: `${K}.choose` };
  if (state.status === "needsKey") {
    return state.provider === ""
      ? { titleKey: `${K}.needsProvider`, actionKey: `${K}.chooseProvider` }
      : { titleKey: `${K}.needsKey`, actionKey: `${K}.addKey` };
  }
  if (state.status === "needsUrl") return { titleKey: `${K}.needsUrl`, actionKey: `${K}.addUrl` };
  if (state.detail === "sealed") return { titleKey: `${K}.sealed`, actionKey: `${K}.openSettings` };
  // Plan 07 (A14, fix round 1): main attests that local engines don't run
  // while sealed on this build. A settled answer, so it is never "checking".
  if (state.detail === "nativeUnavailable")
    return { titleKey: `${K}.nativeUnavailable`, actionKey: `${K}.openSettings` };
  return { titleKey: `${K}.unreachable`, actionKey: `${K}.openSettings` };
}

export function notesActionsDisabledByRoute(state: RouteState): boolean {
  return state.status === "off";
}
