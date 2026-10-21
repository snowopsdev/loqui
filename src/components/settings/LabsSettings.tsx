import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";

// Labs: prototypes that ship off. Each switch gates both the UI and any
// request change behind it (CCR-3, Plan 08).
export default function LabsSettings() {
  const { t } = useTranslation();
  const table = useSettingsStore((s) => s.labsTable);
  const setTable = useSettingsStore((s) => s.setLabsTable);

  return (
    <div>
      <SectionHeader
        title={t("settingsPage.labs.title")}
        description={t("settingsPage.labs.description")}
      />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.labs.table.label")}
            description={t("settingsPage.labs.table.description")}
          >
            <Toggle checked={table} onChange={setTable} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
