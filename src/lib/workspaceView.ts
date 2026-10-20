import type { ControlPanelView } from "../components/controlPanelNav";

// WS-Q9: the main window reopens where you left it.
export const WORKSPACE_VIEW_KEY = "workspace.activeView";
export const WORKSPACE_NOTE_KEY = "workspace.lastNoteId";

export const WORKSPACE_VIEWS: readonly ControlPanelView[] = [
  "home",
  "chat",
  "personal-notes",
  "insights",
  "dictionary",
  "upload",
  "integrations",
];

export interface PersistedWorkspace {
  view: ControlPanelView;
  noteId: number | null;
}

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const FALLBACK: PersistedWorkspace = { view: "home", noteId: null };

export function readPersistedWorkspace(
  storage: WorkspaceStorage | null | undefined
): PersistedWorkspace {
  if (!storage) return FALLBACK;
  try {
    const rawView = storage.getItem(WORKSPACE_VIEW_KEY) ?? "";
    const view = (WORKSPACE_VIEWS as readonly string[]).includes(rawView)
      ? (rawView as ControlPanelView)
      : "home";
    const rawNote = storage.getItem(WORKSPACE_NOTE_KEY);
    const parsed = rawNote ? Number(rawNote) : Number.NaN;
    const noteId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    return { view, noteId };
  } catch {
    return FALLBACK;
  }
}

export function writePersistedWorkspace(
  storage: WorkspaceStorage | null | undefined,
  state: PersistedWorkspace
): void {
  if (!storage) return;
  try {
    storage.setItem(WORKSPACE_VIEW_KEY, state.view);
    if (state.noteId != null) storage.setItem(WORKSPACE_NOTE_KEY, String(state.noteId));
    else storage.removeItem(WORKSPACE_NOTE_KEY);
  } catch {
    // Storage can be unavailable (quota, policy); losing the restore point is harmless.
  }
}
