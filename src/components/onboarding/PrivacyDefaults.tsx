import { useTranslation } from "react-i18next";
import { Toggle } from "../ui/toggle";

export interface PrivacyDefaultsProps {
  platform: "darwin" | "linux" | "win32";
  historyEnabled: boolean;
  onHistoryChange(value: boolean): void;
  updatesEnabled: boolean;
  onUpdatesChange(value: boolean): void;
}

/** The two choices that used to sit on Welcome (owner decision 2): unchanged defaults. */
export function PrivacyDefaults({
  platform,
  historyEnabled,
  onHistoryChange,
  updatesEnabled,
  onUpdatesChange,
}: PrivacyDefaultsProps) {
  const { t } = useTranslation();
  const device = platform === "darwin" ? "Mac" : "Other";
  const rows = [
    {
      id: "history",
      checked: historyEnabled,
      onChange: onHistoryChange,
      body: `historyBody${device}`,
    },
    { id: "updates", checked: updatesEnabled, onChange: onUpdatesChange, body: "updatesBody" },
  ];
  return (
    <section className="onb-card" aria-labelledby="onb-privacy-defaults">
      <h2 id="onb-privacy-defaults" className="onb-card__title">
        {t("setupFlow.privacy.title")}
      </h2>
      {rows.map((row) => (
        <div key={row.id} className="onb-toggle-row">
          <div>
            <p className="onb-toggle-row__title">{t(`setupFlow.privacy.${row.id}Title`)}</p>
            <p className="onb-muted">{t(`setupFlow.privacy.${row.body}`)}</p>
          </div>
          <Toggle
            checked={row.checked}
            onChange={row.onChange}
            aria-label={t(`setupFlow.privacy.${row.id}Title`)}
          />
        </div>
      ))}
    </section>
  );
}
