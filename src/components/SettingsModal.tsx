import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain, Keyboard, Mic, Shield, Sliders, Wrench } from "./icons";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";
import { parseSettingsPath } from "../lib/settingsPaths";
import SidebarModal, { type SidebarItem } from "./ui/SidebarModal";

export type { SettingsSectionType };

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
}

export default function SettingsModal({ open, onOpenChange, initialSection }: SettingsModalProps) {
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

  const handleSectionChange = (section: SettingsSectionType) => {
    setActiveSection(section);
    setInitialSubTab(undefined);
  };

  const handleNavigateToPath = (path: string) => {
    const next = parseSettingsPath(path);
    setActiveSection(next.section);
    setInitialSubTab(next.subTab);
  };

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title={t("settingsModal.title")}
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
    >
      <SettingsPage
        activeSection={activeSection}
        onNavigateToSection={handleSectionChange}
        onNavigateToPath={handleNavigateToPath}
        initialSubTab={initialSubTab}
      />
    </SidebarModal>
  );
}
