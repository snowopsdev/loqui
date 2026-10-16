// Escape belongs to the innermost thing that is mid-gesture. The Settings
// dialog keeps two such claims: a hotkey field that is capturing, and a
// widget that marks itself with data-escape-active="true" while it holds a
// transient state (a Patchbay selection, a search query). A claimed Escape
// is left to that widget; the next press closes the dialog.
export const ESCAPE_CLAIM_SELECTOR = '[data-escape-active="true"]';

export interface EscapeDoc {
  querySelector(selector: string): unknown;
  activeElement: { closest?: (selector: string) => unknown } | null;
}

export function dialogEscapeClaimed(doc: EscapeDoc): boolean {
  if (doc.querySelector("[data-capturing]")) return true;
  const active = doc.activeElement;
  return (
    !!active && typeof active.closest === "function" && !!active.closest(ESCAPE_CLAIM_SELECTOR)
  );
}
