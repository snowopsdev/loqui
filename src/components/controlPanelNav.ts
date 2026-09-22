import type React from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Blocks, BookOpen, Home, MessageSquare, NotebookPen, Upload } from "./icons";

export type ControlPanelView =
  "home" | "insights" | "chat" | "personal-notes" | "dictionary" | "upload" | "integrations";

export type ControlPanelNavSection = "workspace" | "library";

export interface ControlPanelNavItem {
  id: ControlPanelView;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  section: ControlPanelNavSection;
}

/**
 * Single source of truth for main-window navigation. The sidebar renders these
 * rows and the top bar shows the active item's label as the page title, so the
 * two can never disagree.
 */
export function useControlPanelNavItems(): ControlPanelNavItem[] {
  const { t } = useTranslation();

  return [
    { id: "home", label: t("sidebar.home"), icon: Home, section: "workspace" },
    { id: "chat", label: t("sidebar.chat"), icon: MessageSquare, section: "workspace" },
    {
      id: "personal-notes",
      label: t("sidebar.notes"),
      icon: NotebookPen,
      section: "workspace",
    },
    { id: "insights", label: t("sidebar.insights"), icon: BarChart3, section: "library" },
    { id: "upload", label: t("sidebar.upload"), icon: Upload, section: "library" },
    { id: "dictionary", label: t("sidebar.dictionary"), icon: BookOpen, section: "library" },
    {
      id: "integrations",
      label: t("sidebar.integrations"),
      icon: Blocks,
      section: "library",
    },
  ];
}
