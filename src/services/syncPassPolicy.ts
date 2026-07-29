// Pure decision logic for sync passes, kept out of SyncService so the
// node --test suite can cover it (the cloudSyncGuards.js precedent, #1290).

export interface PullCursorAdvance {
  // The pass's own cursor ("lastSyncedAt.<kind>", or ".<kind>.team" on a
  // team-only pass).
  advanceCursor: boolean;
  // The ".<kind>.team" cursor a full pull also covers.
  advanceTeamCursor: boolean;
}

// A backfill snapshot never sees tombstones or stubs, and a pass with
// parked/failed rows must re-see them, so neither advances any cursor. An
// unresolved note conflict is not parked: its cloud copy lives in the durable
// conflict registry and must not hold back unrelated deltas. A
// team-capable pass (or one with no team spaces at all) fully covered its
// scope: advance its own cursor, and after a full pull keep the team cursor
// current too so a later backup-off pass doesn't re-pull from the distant
// past. A degraded (own-rows-only) full pull still fully covered personal
// rows, so its cursor may advance; the untouched team cursor lets the
// recovery pull catch up on teammate edits made during the outage.
export function resolvePullCursorAdvance(pass: {
  snapshot: boolean;
  parked: boolean;
  teamOnly: boolean;
  teamCapable: boolean;
  hasTeamSpaces: boolean;
}): PullCursorAdvance {
  if (pass.snapshot || pass.parked) {
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

// Consecutive-404 tracking for note/folder update (PATCH) pushes. A bare 404
// on an update push is ambiguous — the row was deleted server-side, or the
// pusher lost access. For notes, a revoked member's PATCH now returns a bare
// 404 (the server hides the note so its id can't be probed) rather than 403
// team_access_revoked; for folders the revoked case is already coded
// (team_not_found / team_access_revoked, caught by isTeamAccessError), so a
// bare 404 there is a genuine-delete race. Either way we do NOT fork to
// Personal on the first 404: the same pass's pull disambiguates a revocation
// (access_removed stub → fork, preserving edits) from a deletion (tombstone →
// local delete). Only after `threshold` consecutive passes 404 with no pull
// signal do we fork as a fallback, so a stub that never lands can't 404-loop
// forever. The residual risk is a hard-delete race resurrecting the row as a
// private copy — preferred over silently discarding the user's unpushed edits.
// Counts are keyed by client id and mutated only inside the SYNC_ALL_LOCK pass.
export const UPDATE_404_FORK_THRESHOLD = 3;

export interface Update404Decision {
  // Fork to Personal now: the threshold of stub-less passes has been reached.
  fork: boolean;
  // The counts map to persist (a fresh object; the input is never mutated).
  next: Record<string, number>;
}

// Record a 404 on `clientId`'s update push and decide whether to fork. Forks
// (clearing the entry) once `threshold` prior passes have already 404'd without
// the pull resolving the row; otherwise increments and defers to the pull.
export function recordUpdate404(
  counts: Record<string, number>,
  clientId: string,
  threshold: number
): Update404Decision {
  const prior = counts[clientId] ?? 0;
  const next = { ...counts };
  if (prior >= threshold) {
    delete next[clientId];
    return { fork: true, next };
  }
  next[clientId] = prior + 1;
  return { fork: false, next };
}

// Drop `clientId`'s streak — the pull resolved it (fork or delete) or a later
// push settled. Returns the same reference when nothing changed so the caller
// can skip the localStorage write.
export function clearUpdate404(
  counts: Record<string, number>,
  clientId: string
): Record<string, number> {
  if (!(clientId in counts)) return counts;
  const next = { ...counts };
  delete next[clientId];
  return next;
}
