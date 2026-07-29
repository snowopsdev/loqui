import type { NotePermission } from "../types/electron";

export interface NoteCapabilities {
  canView: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
  canManageInheritedAccess: boolean;
  canTransferOwnership: boolean;
}

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
  shareStateLoaded,
  isTeamNote,
  hasCloudId,
}: {
  cachedPermission?: NotePermission;
  shareStateLoaded: boolean;
  isTeamNote: boolean;
  hasCloudId: boolean;
}): NotePermission | null {
  if (cachedPermission) return cachedPermission;
  // A personal cloud note may belong to this user or may be a view-only grant.
  // Until its ACL loads, fail closed instead of temporarily granting owner
  // controls. A loaded legacy response has no ACL, so retain the old ownership
  // fallback for compatibility with servers that predate note permissions.
  if (hasCloudId && !isTeamNote && !shareStateLoaded) return null;
  return isTeamNote ? "editor" : "owner";
}
