// WS-Q12 / R13: one keyboard map for the workspace. Physical codes for
// digits, backslash and slash so non-US layouts still work.
export type WorkspaceAction =
  | "openSearch"
  | "openSettings"
  | "goHome"
  | "goNotes"
  | "goChat"
  | "toggleSidebar"
  | "newNote"
  | "newChat"
  | "recordMeeting"
  | "uploadAudio"
  | "askAssistant";

export interface ShortcutEventLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

interface Binding {
  action: WorkspaceAction;
  shift: boolean;
  key?: string;
  code?: string;
  glyph: string;
}

const BINDINGS: readonly Binding[] = [
  { action: "openSearch", shift: false, key: "k", glyph: "K" },
  { action: "openSettings", shift: false, key: ",", glyph: "," },
  { action: "goHome", shift: false, code: "Digit1", glyph: "1" },
  { action: "goNotes", shift: false, code: "Digit2", glyph: "2" },
  { action: "goChat", shift: false, code: "Digit3", glyph: "3" },
  { action: "toggleSidebar", shift: false, code: "Backslash", glyph: "\\" },
  { action: "newNote", shift: false, key: "n", glyph: "N" },
  { action: "newChat", shift: true, key: "n", glyph: "N" },
  { action: "recordMeeting", shift: true, key: "m", glyph: "M" },
  { action: "uploadAudio", shift: true, key: "u", glyph: "U" },
  { action: "askAssistant", shift: false, code: "Slash", glyph: "/" },
];

// Opening the palette or Settings is safe anywhere; anything that changes
// the view waits until dialogs close.
const ALLOWED_IN_DIALOG = new Set<WorkspaceAction>(["openSearch", "openSettings"]);

export function resolveWorkspaceShortcut(
  event: ShortcutEventLike,
  context: { platform: string; dialogOpen: boolean }
): WorkspaceAction | null {
  if (event.isComposing || event.defaultPrevented || event.altKey) return null;
  const isMac = context.platform === "darwin";
  const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  const key = event.key.toLowerCase();
  const hit = BINDINGS.find(
    (binding) =>
      binding.shift === event.shiftKey &&
      (binding.code ? binding.code === event.code : binding.key === key)
  );
  if (!hit) return null;
  if (context.dialogOpen && !ALLOWED_IN_DIALOG.has(hit.action)) return null;
  return hit.action;
}

export function shortcutHint(action: WorkspaceAction, platform: string): string {
  const binding = BINDINGS.find((candidate) => candidate.action === action);
  if (!binding) return "";
  if (platform === "darwin") return `⌘${binding.shift ? "⇧" : ""}${binding.glyph}`;
  return `Ctrl+${binding.shift ? "Shift+" : ""}${binding.glyph}`;
}

export function isDialogOpen(doc: Pick<Document, "querySelector"> | null | undefined): boolean {
  if (!doc) return false;
  return (
    doc.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
    ) != null
  );
}
