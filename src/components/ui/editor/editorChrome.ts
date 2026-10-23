// UI that floats over the editor (bubble toolbar, slash and mention popups,
// mention hover cards). React portals bubble clicks to the editor wrapper,
// so the wrapper must not pull focus back into the document from these.
export function isEditorChromeTarget(target: EventTarget | null): boolean {
  const node = target as { closest?: (selector: string) => unknown } | null;
  return typeof node?.closest === "function" && node.closest("[data-editor-chrome]") != null;
}
