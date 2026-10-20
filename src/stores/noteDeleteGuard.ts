// The tree now lives in the sidebar, outside PersonalNotesView. The open
// editor registers this guard so a tree delete cancels its pending save
// first (previously handleDelete in PersonalNotesView did this inline).
type Guard = (noteId: number) => void;
let guard: Guard | null = null;

export function setBeforeNoteDelete(next: Guard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

export function runBeforeNoteDelete(noteId: number): void {
  guard?.(noteId);
}
