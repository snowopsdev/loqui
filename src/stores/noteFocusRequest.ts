// One pending "focus this note's title when it opens" request. The after-setup
// Dictate into a note hand-off uses it so keyboard focus lands in the new note
// instead of the document body once the onboarding button is gone.
let pending: number | null = null;

export function requestNoteTitleFocus(noteId: number): void {
  pending = noteId;
}

/** Consumes the request when the editor for that note mounts or switches to it. */
export function takeNoteTitleFocus(noteId: number): boolean {
  if (pending !== noteId) return false;
  pending = null;
  return true;
}
