export interface PendingNoteSnapshot {
  title: string;
  content: string;
  enhancedContent: string | null;
  documentPending: boolean;
  enhancedPending: boolean;
  bufferOwnerId: number | null;
  targetNoteId: number | null;
}

export type PendingNoteUpdates = {
  title?: string;
  content?: string;
  enhanced_content?: string | null;
};

export function shouldCancelPendingSavesForDelete(
  activeNoteId: number | null,
  deletedNoteId: number
): boolean {
  return activeNoteId === deletedNoteId;
}

/**
 * Build the smallest update that drains the editor's pending save timers.
 * Keeping this decision separate from the timers makes note-to-note and
 * note-to-overview navigation share the same lossless behavior.
 */
export function buildPendingNoteUpdates(snapshot: PendingNoteSnapshot): PendingNoteUpdates | null {
  // Never write a buffer to a note it does not belong to. During
  // create-from-overview + drag the active-note ref can be repointed at the
  // new note while the buffers still hold the previously-open note's content;
  // without this guard the flush would fill the new note with that text.
  if (snapshot.bufferOwnerId !== snapshot.targetNoteId) return null;
  const updates: PendingNoteUpdates = {};
  if (snapshot.documentPending) {
    updates.title = snapshot.title;
    updates.content = snapshot.content;
  }
  if (snapshot.enhancedPending) {
    updates.enhanced_content = snapshot.enhancedContent;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}
