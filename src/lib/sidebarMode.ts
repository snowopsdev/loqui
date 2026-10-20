// WS-R1 B: one 232px sidebar that collapses to a 56px icon rail (manually,
// or automatically below 1100px). Side-panel layout hides it entirely.
export type SidebarMode = "expanded" | "rail" | "hidden";
export const SIDEBAR_EXPANDED_PX = 232;
export const SIDEBAR_RAIL_PX = 56;
export const SIDEBAR_AUTO_RAIL_BELOW_PX = 1100;

export interface SidebarPreference {
  /** Persisted: the user collapsed the sidebar in a wide window. */
  userCollapsed: boolean;
  /** Session only: the user expanded the rail in a narrow window. */
  narrowExpanded: boolean;
}

export function resolveSidebarMode(
  input: SidebarPreference & { windowWidth: number; sidePanelLayout: boolean }
): SidebarMode {
  if (input.sidePanelLayout) return "hidden";
  if (input.userCollapsed) return "rail";
  if (input.windowWidth < SIDEBAR_AUTO_RAIL_BELOW_PX && !input.narrowExpanded) return "rail";
  return "expanded";
}

export function nextSidebarPreference(
  input: SidebarPreference & { windowWidth: number }
): SidebarPreference {
  const mode = resolveSidebarMode({ ...input, sidePanelLayout: false });
  if (input.windowWidth < SIDEBAR_AUTO_RAIL_BELOW_PX) {
    return mode === "expanded"
      ? { userCollapsed: input.userCollapsed, narrowExpanded: false }
      : { userCollapsed: false, narrowExpanded: true };
  }
  return { userCollapsed: !input.userCollapsed, narrowExpanded: input.narrowExpanded };
}

export function sidebarWidth(mode: SidebarMode): number {
  return mode === "expanded" ? SIDEBAR_EXPANDED_PX : mode === "rail" ? SIDEBAR_RAIL_PX : 0;
}
