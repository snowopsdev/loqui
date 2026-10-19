import { useWorkspaceActive } from "../hooks/useWorkspaceActive";
import { withDraftDiscard } from "../stores/routeDraftStore";
import { StagedRouteBar } from "./settings/routing/StagedRouteBar";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, Keyboard, Mic, Shield, Sliders, Waypoints, Wrench } from "./icons";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";
import { parseSettingsPath } from "../lib/settingsPaths";
import SidebarModal, { type SidebarItem } from "./ui/SidebarModal";

import { SettingsSearchField } from "./settings/SettingsSearchField";
import { SettingsSearchResults } from "./settings/SettingsSearchResults";
import { useSettingsSearch } from "./settings/useSettingsSearch";

export type { SettingsSectionType };

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
  /** A new destination activation, including another request for an identical path. */
  activationId?: number;
}

export default function SettingsModal({
  open: requestedOpen,
  onOpenChange,
  initialSection,
  activationId,
}: SettingsModalProps) {
  const workspaceActive = useWorkspaceActive();
  const open = requestedOpen && workspaceActive;
  const { t } = useTranslation();

  const sidebarItems: SidebarItem<SettingsSectionType>[] = useMemo(() => {
    const items: SidebarItem<SettingsSectionType>[] = [
      {
        id: "general",
        label: t("settingsModal.sections.general.label"),
        icon: Sliders,
        description: t("settingsModal.sections.general.description"),
        group: t("settingsModal.groups.app"),
      },
      {
        id: "hotkeys",
        label: t("settingsModal.sections.hotkeys.label"),
        icon: Keyboard,
        description: t("settingsModal.sections.hotkeys.description"),
        group: t("settingsModal.groups.app"),
      },
      {
        id: "routing",
        label: t("settingsModal.sections.routing.label"),
        icon: Waypoints,
        description: t("settingsModal.sections.routing.description"),
        group: t("settingsModal.groups.aiModels"),
      },
      {
        id: "speechToText",
        label: t("settingsModal.sections.speechToText.label"),
        icon: Mic,
        description: t("settingsModal.sections.speechToText.description"),
        group: t("settingsModal.groups.aiModels"),
      },
      {
        id: "llms",
        label: t("settingsModal.sections.llms.label"),
        icon: Brain,
        description: t("settingsModal.sections.llms.description"),
        group: t("settingsModal.groups.aiModels"),
      },
      {
        id: "privacyData",
        label: t("settingsModal.sections.privacyData.label"),
        icon: Shield,
        description: t("settingsModal.sections.privacyData.description"),
        group: t("settingsModal.groups.system"),
      },
      {
        id: "system",
        label: t("settingsModal.sections.system.label"),
        icon: Wrench,
        description: t("settingsModal.sections.system.description"),
        group: t("settingsModal.groups.system"),
      },
    ];
    return items;
  }, [t]);

  const initial = parseSettingsPath(initialSection);
  const [activeSection, setActiveSection] = React.useState<SettingsSectionType>(initial.section);
  const [initialSubTab, setInitialSubTab] = useState<string | undefined>(initial.subTab);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open && !prevOpen && initialSection) {
    setPrevOpen(open);
    const next = parseSettingsPath(initialSection);
    setActiveSection(next.section);
    setInitialSubTab(next.subTab);
  } else if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setInitialSubTab(undefined);
  }

  const handleNavigateToPath = useCallback((path: string) => {
    const next = parseSettingsPath(path);
    setActiveSection(next.section);
    setInitialSubTab(next.subTab);
  }, []);

  // A new activation must reach useSubTab even after the user selected another tab.
  const [searchPath, setSearchPath] = useState<string | null>(null);
  const navigateFromSearch = useCallback((path: string) => {
    setInitialSubTab(undefined);
    setSearchPath(path);
  }, []);
  useEffect(() => {
    if (searchPath === null) return;
    setSearchPath(null);
    if (open) handleNavigateToPath(searchPath);
  }, [searchPath, open, handleNavigateToPath]);

  const search = useSettingsSearch({ open, navigateToPath: navigateFromSearch });
  const clearSearch = search.clear;
  useEffect(() => {
    if (activationId === undefined || !open) return;
    clearSearch();
    // Pass through an unset sub-tab so the retained useSubTab owner consumes
    // even an identical path after the user has manually moved elsewhere.
    setInitialSubTab(undefined);
    setSearchPath(initialSection ?? "general");
  }, [activationId, initialSection, open, clearSearch]);

  const handleSectionChange = (section: SettingsSectionType) => {
    search.clear();
    setSearchPath(null);
    setActiveSection(section);
    setInitialSubTab(undefined);
  };

  const handleOpenChange = useMemo(() => withDraftDiscard(onOpenChange), [onOpenChange]);

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={handleOpenChange}
      footer={<StagedRouteBar />}
      title={t("settingsModal.title")}
      contentTitle={search.query ? t("settingsSearch.title") : undefined}
      search={
        <SettingsSearchField
          ref={search.searchRef}
          value={search.query}
          onChange={search.setQuery}
          onKeyDown={search.onSearchKeyDown}
          onEscape={search.consumeEscape}
        />
      }
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
    >
      <>
        {search.query && (
          <SettingsSearchResults
            query={search.query}
            groups={search.groups}
            activeId={search.activeId}
            onActiveChange={search.activate}
            onJump={search.jump}
            onEscape={search.consumeEscape}
          />
        )}
        <div className={search.query ? "hidden" : undefined}>
          <SettingsPage
            activeSection={activeSection}
            onNavigateToSection={handleSectionChange}
            onNavigateToPath={handleNavigateToPath}
            initialSubTab={initialSubTab}
          />
        </div>
      </>
    </SidebarModal>
  );
}
