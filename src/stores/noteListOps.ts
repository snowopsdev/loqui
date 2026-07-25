import type { NoteItem } from "../types/electron";

export interface NoteListsState {
  notesByContainer: Record<string, NoteItem[]>;
  notes: NoteItem[];
  activeNoteId: number | null;
}

export interface RemoveNoteResult extends NoteListsState {
  changed: boolean;
}

/**
 * Remove a note from every container list AND the flat `notes` list. The flat
 * list can hold notes absent from every loaded container (flat-only loads,
 * divergence after partial refreshes), so it must be filtered independently —
 * relying on the active-container mirror alone leaves a deleted note visible.
 */
export function removeNoteFromLists(state: NoteListsState, id: number): RemoveNoteResult {
  const notesByContainer = { ...state.notesByContainer };
  let sourceItems: NoteItem[] | null = null;
  let sourceKey: string | null = null;
  let changed = false;
  for (const [key, items] of Object.entries(state.notesByContainer)) {
    if (!items.some((n) => n.id === id)) continue;
    sourceItems = items;
    sourceKey = key;
    notesByContainer[key] = items.filter((n) => n.id !== id);
    changed = true;
  }

  const inFlat = state.notes.some((n) => n.id === id);
  const notes = inFlat ? state.notes.filter((n) => n.id !== id) : state.notes;
  changed = changed || inFlat;

  let activeNoteId = state.activeNoteId;
  if (changed && state.activeNoteId === id) {
    // Pick the neighbor from what the user is looking at: the flat list when
    // it held the note, else the note's source container.
    const previous = inFlat ? state.notes : sourceItems;
    const next = inFlat ? notes : sourceKey ? notesByContainer[sourceKey] : [];
    const idx = previous ? previous.findIndex((n) => n.id === id) : -1;
    activeNoteId = idx === -1 ? null : (next[Math.min(idx, next.length - 1)]?.id ?? null);
  }

  return { notesByContainer, notes, activeNoteId, changed };
}
