import { createContext, useContext, type ReactNode } from "react";
import type { ControlPanelView } from "./controlPanelNav";

/** One way to move around the workspace from deep places (mention chips,
 *  citations, palette rows, Insights tiles). ControlPanel provides it. */
export interface WorkspaceNavigation {
  openView(view: ControlPanelView): void;
  openNote(noteId: number): void;
  openFolder(spaceId: number, folderId: number | null): void;
  openTranscript(transcriptId: number): void;
  openConversation(conversationId: number): void;
  /** Opens a new chat. A draft is placed in the composer, never sent. */
  startChat(options?: { draft?: string }): void;
  focusAssistant(): void;
  newNote(): void;
  recordMeeting(): void;
  openUpload(): void;
  openSettings(section?: string): void;
  openSearch(): void;
}

const noop = () => {};
// Shared context exports are intentionally colocated with their provider.
// eslint-disable-next-line react-refresh/only-export-components
export const INERT_WORKSPACE_NAVIGATION: WorkspaceNavigation = Object.freeze({
  openView: noop,
  openNote: noop,
  openFolder: noop,
  openTranscript: noop,
  openConversation: noop,
  startChat: noop,
  focusAssistant: noop,
  newNote: noop,
  recordMeeting: noop,
  openUpload: noop,
  openSettings: noop,
  openSearch: noop,
});

const WorkspaceNavigationContext = createContext<WorkspaceNavigation>(INERT_WORKSPACE_NAVIGATION);

export function WorkspaceNavigationProvider({
  value,
  children,
}: {
  value: WorkspaceNavigation;
  children: ReactNode;
}) {
  return <WorkspaceNavigationContext value={value}>{children}</WorkspaceNavigationContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceNavigation(): WorkspaceNavigation {
  return useContext(WorkspaceNavigationContext);
}
