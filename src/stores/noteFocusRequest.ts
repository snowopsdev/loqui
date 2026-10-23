import { useEffect, type RefObject } from "react";

// One pending "focus this note's title when it opens" request. The after-setup
// Dictate into a note hand-off uses it so keyboard focus lands in the new note
// instead of the document body once the onboarding button is gone.
//
// The request is only valid while nobody has moved on: the first pointer,
// key or focus move elsewhere retires it, and consumption still refuses if
// focus is no longer where it was when the request was made. A lazily mounted
// editor therefore never steals focus from a control the user chose.
interface PendingTitleFocus {
  noteId: number;
  focusAtRequest: Element | null;
  detach: () => void;
}

let pending: PendingTitleFocus | null = null;

const unclaimed = (active: Element | null | undefined, entry: PendingTitleFocus) =>
  !active || active === globalThis.document?.body || active === entry.focusAtRequest;

export function cancelNoteTitleFocus(): void {
  const entry = pending;
  pending = null;
  entry?.detach();
}

export function requestNoteTitleFocus(noteId: number): void {
  cancelNoteTitleFocus();
  const win = globalThis.window;
  const entry: PendingTitleFocus = {
    noteId,
    focusAtRequest: globalThis.document?.activeElement ?? null,
    detach: () => {},
  };
  const retire = () => {
    if (pending === entry) cancelNoteTitleFocus();
  };
  const onFocusIn = (event: Event) => {
    if (!unclaimed(event.target as Element | null, entry)) retire();
  };
  win?.addEventListener?.("pointerdown", retire, true);
  win?.addEventListener?.("keydown", retire, true);
  win?.addEventListener?.("focusin", onFocusIn, true);
  entry.detach = () => {
    win?.removeEventListener?.("pointerdown", retire, true);
    win?.removeEventListener?.("keydown", retire, true);
    win?.removeEventListener?.("focusin", onFocusIn, true);
  };
  pending = entry;
}

/** Consumes the request for this note; true only if focus is still unclaimed. */
export function takeNoteTitleFocus(noteId: number): boolean {
  const entry = pending;
  if (!entry || entry.noteId !== noteId) return false;
  cancelNoteTitleFocus();
  return unclaimed(globalThis.document?.activeElement, entry);
}

/** The editor's consumer: focus its title when it opens a requested note. */
export function useNoteTitleFocus(noteId: number, titleRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (takeNoteTitleFocus(noteId)) titleRef.current?.focus({ preventScroll: true });
  }, [noteId, titleRef]);
}
