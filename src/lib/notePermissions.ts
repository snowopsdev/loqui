import type { NotePermission } from "../types/electron";

export interface NoteCapabilities {
  canView: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
  canManageInheritedAccess: boolean;
  canTransferOwnership: boolean;
}

export type NoteAclState = "loading" | "loaded" | "unavailable";

const NO_ACCESS: NoteCapabilities = {
  canView: false,
  canEdit: false,
  canShare: false,
  canDelete: false,
  canManageInheritedAccess: false,
  canTransferOwnership: false,
};

/**
 * Client-side presentation capabilities. The server remains authoritative.
 * Editors may manage direct grants and links, but ownership and inherited
 * team/folder audiences remain owner/admin controls.
 */
export function noteCapabilities(
  permission: NotePermission | null | undefined,
  hasAdminOverride = false
): NoteCapabilities {
  if (hasAdminOverride || permission === "owner") {
    return {
      canView: true,
      canEdit: true,
      canShare: true,
      canDelete: true,
      canManageInheritedAccess: true,
      canTransferOwnership: true,
    };
  }
  if (permission === "editor") {
    return {
      canView: true,
      canEdit: true,
      canShare: true,
      canDelete: false,
      canManageInheritedAccess: false,
      canTransferOwnership: false,
    };
  }
  if (permission === "viewer") {
    return { ...NO_ACCESS, canView: true };
  }
  return { ...NO_ACCESS };
}

export function resolveNotePermission({
  cachedPermission,
  aclState,
  isTeamNote,
}: {
  cachedPermission?: NotePermission;
  aclState: NoteAclState;
  isTeamNote: boolean;
}): NotePermission | null {
  if (cachedPermission) return cachedPermission;
  // A personal cloud note may belong to this user or may be a view-only grant.
  // Fail closed only while an authenticated ACL request is active, rather
  // than making the local editor permanently read-only while signed out or
  // offline. Loaded legacy responses and unavailable ACLs retain the old
  // ownership fallback for compatibility and offline editing.
  if (!isTeamNote && aclState === "loading") return null;
  return isTeamNote ? "editor" : "owner";
}
