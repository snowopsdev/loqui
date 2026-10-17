import { useTranslation } from "react-i18next";
import { BarChart3, BookOpen, CalendarDays, Home, MessageSquare, NotebookPen } from "./icons";
import type { WorkspaceAction } from "../lib/workspaceShortcuts";

export type ControlPanelView =
  "home" | "insights" | "chat" | "personal-notes" | "dictionary" | "upload" | "integrations";

export type ControlPanelNavSection = "primary" | "voice";

export interface ControlPanelNavItem {
  id: ControlPanelView;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  section: ControlPanelNavSection;
  shortcut?: WorkspaceAction;
}

const TITLE_KEYS: Record<ControlPanelView, string> = {
  home: "sidebar.home",
  "personal-notes": "sidebar.notes",
  chat: "sidebar.chat",
  dictionary: "sidebar.dictionary",
  insights: "sidebar.insights",
  integrations: "sidebar.calendars",
  upload: "sidebar.upload",
};

export const viewTitleKey = (view: ControlPanelView): string => TITLE_KEYS[view];

// WS-R1 B: Home, Notes, Chat first (⌘1–3); Voice holds the tools. Upload is
// an action now (Capture, ⌘⇧U, palette), not a place.
export function useControlPanelNavItems(): ControlPanelNavItem[] {
  const { t } = useTranslation();
  return [
    { id: "home", label: t(TITLE_KEYS.home), icon: Home, section: "primary", shortcut: "goHome" },
    {
      id: "personal-notes",
      label: t(TITLE_KEYS["personal-notes"]),
      icon: NotebookPen,
      section: "primary",
      shortcut: "goNotes",
    },
    {
      id: "chat",
      label: t(TITLE_KEYS.chat),
      icon: MessageSquare,
      section: "primary",
      shortcut: "goChat",
    },
    { id: "dictionary", label: t(TITLE_KEYS.dictionary), icon: BookOpen, section: "voice" },
    { id: "insights", label: t(TITLE_KEYS.insights), icon: BarChart3, section: "voice" },
    { id: "integrations", label: t(TITLE_KEYS.integrations), icon: CalendarDays, section: "voice" },
  ];
}
