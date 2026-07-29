// Pure decision logic for sync passes, kept out of SyncService so the
// node --test suite can cover it (the cloudSyncGuards.js precedent, #1290).

export interface PullCursorAdvance {
  // The pass's own cursor ("lastSyncedAt.<kind>", or ".<kind>.team" on a
  // team-only pass).
  advanceCursor: boolean;
  // The ".<kind>.team" cursor a full pull also covers.
  advanceTeamCursor: boolean;
}

// A backfill snapshot never sees tombstones or stubs, and a dirty pass must
// re-see its parked/failed rows, so neither advances any cursor. A
// team-capable pass (or one with no team spaces at all) fully covered its
// scope: advance its own cursor, and after a full pull keep the team cursor
// current too so a later backup-off pass doesn't re-pull from the distant
// past. A degraded (own-rows-only) full pull still fully covered personal
// rows, so its cursor may advance; the untouched team cursor lets the
// recovery pull catch up on teammate edits made during the outage.
export function resolvePullCursorAdvance(pass: {
  snapshot: boolean;
  dirty: boolean;
  teamOnly: boolean;
  teamCapable: boolean;
  hasTeamSpaces: boolean;
}): PullCursorAdvance {
  if (pass.snapshot || pass.dirty) {
    return { advanceCursor: false, advanceTeamCursor: false };
  }
  if (pass.teamCapable || !pass.hasTeamSpaces) {
    return { advanceCursor: true, advanceTeamCursor: !pass.teamOnly };
  }
  return { advanceCursor: !pass.teamOnly, advanceTeamCursor: false };
}

// Why a space was purged locally: "deleted" covers the delete race the guard
// was built for (the server may not have processed the delete yet, so the
// space can still appear live); "revoked" covers access loss, where the space
// reappearing in /api/me/spaces means the member was re-added and the guard
// must stand down instead of locking them out for the TTL (D14).
export type PurgedSpaceReason = "revoked" | "deleted";

export interface PurgedSpaceEntry {
  at: number;
  reason: PurgedSpaceReason;
}

// Entries written before the reason field existed are plain timestamps; read
// them as "deleted" (the conservative guard) so an in-flight delete stays
// covered — at worst a pre-upgrade revocation entry rides out its TTL once.
export function normalizePurgedSpaceEntries(
  raw: Record<string, number | PurgedSpaceEntry>
): Record<string, PurgedSpaceEntry> {
  return Object.fromEntries(
    Object.entries(raw).map(([id, entry]) => [
      id,
      typeof entry === "number" ? { at: entry, reason: "deleted" as const } : entry,
    ])
  );
}

// Entries older than the TTL are dropped so a failed space delete cannot hide
// a still-live space forever.
export function prunePurgedSpaceEntries(
  entries: Record<string, PurgedSpaceEntry>,
  now: number,
  ttlMs: number
): Record<string, PurgedSpaceEntry> {
  return Object.fromEntries(Object.entries(entries).filter(([, { at }]) => now - at < ttlMs));
}

// Live-set sweep after a spaces pass. Gone from /api/me/spaces → the purge is
// confirmed server-side, guard done (either reason). Still live + "deleted" →
// the delete hasn't landed; keep guarding. Still live + "revoked" → the space
// reappeared after a re-add: drop the entry so it can re-mirror.
export function keepPurgedSpaceEntry(entry: PurgedSpaceEntry, isLive: boolean): boolean {
  return isLive && entry.reason === "deleted";
}

/**
 * Resolve a pulled note's cloud folder without ever crossing local space
 * boundaries. Team notes fall back to their space root; personal notes retain
 * the legacy default-folder fallback.
 */
export function resolvePulledNoteFolderId(
  cloudNote: { space_id?: string | null; folder_id?: string | null },
  localSpaceId: number,
  cloudToLocal: Map<string, { id: number; space_id: number }>,
  defaultFolderId: number | null
): number | null {
  const fallback = cloudNote.space_id ? null : defaultFolderId;
  const mapped = cloudNote.folder_id ? cloudToLocal.get(cloudNote.folder_id) : undefined;
  return mapped && mapped.space_id === localSpaceId ? mapped.id : fallback;
}

export interface RevokedNoteFork {
  update: {
    space_id?: number;
    folder_id?: null;
    client_note_id?: string;
    cloud_id: null;
    left_team?: 0;
  };
  relocated: boolean;
}

// Update applied to a team note whose access was revoked (plan §7.2): move it
// to the private space (unless it already sits there, e.g. a left_team row or
// one just relocated by its folder's stub — those keep their folder link),
// drop the cloud link, and fork the client identity so the next push
// re-creates it as a new personal note. Push-side rejections fork the
// identity only when a server row exists (cloud_id) and clear the pending
// left_team retraction the server will never accept; the pull-side
// access_removed stub always forks — the server row exists by construction.
export function revokedNoteForkUpdate(
  note: { space_id: number; cloud_id?: string | null },
  privateSpaceId: number,
  source: "push" | "pull"
): RevokedNoteFork {
  const relocated = note.space_id !== privateSpaceId;
  return {
    relocated,
    update: {
      ...(relocated ? { space_id: privateSpaceId, folder_id: null } : {}),
      ...(source === "pull" || note.cloud_id ? { client_note_id: crypto.randomUUID() } : {}),
      cloud_id: null,
      ...(source === "push" ? { left_team: 0 as const } : {}),
    },
  };
}
