export interface PendingNoteSnapshot {
  title: string;
  content: string;
  enhancedContent: string | null;
  documentPending: boolean;
  enhancedPending: boolean;
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
