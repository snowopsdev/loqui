import { withDraftDiscard } from "../stores/routeDraftStore";
import { StagedRouteBar } from "./settings/routing/StagedRouteBar";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  /** Every acknowledged link reactivates navigation, even when its path is unchanged. */
  activationId?: string;
}

export default function SettingsModal({
  open,
  onOpenChange,
  initialSection,
  activationId,
}: SettingsModalProps) {
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

  // Publish a request identity only with the destination it actually activates.
  // A raw incoming id must never replay the previous section's retained tab.
  const [navigation, setNavigation] = useState(() => ({
    ...parseSettingsPath(initialSection),
    activationId,
  }));
  const {
    section: activeSection,
    subTab: initialSubTab,
    activationId: appliedActivationId,
  } = navigation;
  const [prevOpen, setPrevOpen] = useState(open);

  if (open && !prevOpen && initialSection) {
    setPrevOpen(open);
    setNavigation({ ...parseSettingsPath(initialSection), activationId });
  } else if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setNavigation((current) => ({ ...current, subTab: undefined }));
  }

  // A new request also navigates a modal that is already open; undefined clears a stale path.
  useEffect(() => {
    if (open) {
      setNavigation({ ...parseSettingsPath(initialSection), activationId });
    }
  }, [open, initialSection, activationId]);

  const handleNavigateToPath = useCallback((path: string) => {
    setNavigation((current) => ({
      ...parseSettingsPath(path),
      activationId: current.activationId,
    }));
  }, []);

  // A new activation must reach useSubTab even after the user selected another tab.
  const [searchPath, setSearchPath] = useState<string | null>(null);
  const navigateFromSearch = useCallback((path: string) => {
    setNavigation((current) => ({ ...current, subTab: undefined }));
    setSearchPath(path);
  }, []);
  useEffect(() => {
    if (searchPath === null) return;
    setSearchPath(null);
    if (open) handleNavigateToPath(searchPath);
  }, [searchPath, open, handleNavigateToPath]);

  const search = useSettingsSearch({ open, navigateToPath: navigateFromSearch });
  const handleSectionChange = (section: SettingsSectionType) => {
    search.clear();
    setSearchPath(null);
    setNavigation((current) => ({ ...current, section, subTab: undefined }));
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
            activationId={appliedActivationId}
          />
        </div>
      </>
    </SidebarModal>
  );
}
