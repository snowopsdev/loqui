import { useSpaces } from "../stores/noteStore";

/** Dev override forcing the TEAM SPACES section on without a server probe. */
function hasTeamSpacesDevOverride(): boolean {
  return localStorage.getItem("teamSpacesDevOverride") === "true";
}

/**
 * Whether the TEAM SPACES section should render: the cached server capability
 * probe (written by the spaces sync pass), the dev override, or locally known
 * team spaces.
 */
export function useTeamSpacesCapability(): boolean {
  const spaces = useSpaces();
  return (
    hasTeamSpacesDevOverride() ||
    localStorage.getItem("teamSpacesCapability") === "true" ||
    spaces.some((space) => space.kind === "team")
  );
}
