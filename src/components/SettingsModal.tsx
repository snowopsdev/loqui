import { useWorkspaceActive } from "../hooks/useWorkspaceActive";
import { endSettingsSession, withDraftDiscard } from "../stores/routeDraftStore";
import { StagedRouteBar } from "./settings/routing/StagedRouteBar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  activationId?: string;
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
  // Hiding the retained workspace is not a new Settings activation. Consume a
  // destination only on a requested open or a new explicit request, once active.
  const appliedRequest = useRef({ open: false, initialSection, activationId });
  useEffect(() => {
    if (!requestedOpen) {
      appliedRequest.current.open = false;
      return;
    }
    if (!workspaceActive) return;
    const previous = appliedRequest.current;
    if (
      !previous.open ||
      previous.initialSection !== initialSection ||
      previous.activationId !== activationId
    ) {
      setNavigation({ ...parseSettingsPath(initialSection), activationId });
      appliedRequest.current = { open: true, initialSection, activationId };
    }
  }, [requestedOpen, workspaceActive, initialSection, activationId]);

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
  const clearSearch = search.clear;
  const consumedActivation = useRef<string | undefined>(undefined);
  const consumedPath = useRef(initialSection);
  useEffect(() => {
    const changed =
      activationId === undefined
        ? consumedPath.current !== initialSection
        : consumedActivation.current !== activationId;
    if (!open || !changed) return;
    consumedActivation.current = activationId;
    consumedPath.current = initialSection;
    clearSearch();
    // Pass through an unset sub-tab so the retained useSubTab owner consumes
    // even an identical path after the user has manually moved elsewhere.
    setNavigation((current) => ({ ...current, subTab: undefined }));
    setSearchPath(initialSection ?? "general");
  }, [activationId, initialSection, open, clearSearch]);

  const wasOpen = useRef(open);
  useEffect(() => {
    // The destination was consumed by the active page. A remount on ordinary
    // return must read the user's saved tab rather than replay that request.
    if (!open && wasOpen.current) setNavigation((current) => ({ ...current, subTab: undefined }));
    wasOpen.current = open;
  }, [open]);

  const handleSectionChange = (section: SettingsSectionType) => {
    search.clear();
    setSearchPath(null);
    setNavigation((current) => ({ ...current, section, subTab: undefined }));
  };

  // The retained modal owns the planner session. Radix content may unmount
  // while setup is displayed without closing this owner.
  useEffect(() => () => endSettingsSession(), []);
  const handleOpenChange = useMemo(() => withDraftDiscard(onOpenChange), [onOpenChange]);

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={handleOpenChange}
      footer={<StagedRouteBar discardOnUnmount={false} />}
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
