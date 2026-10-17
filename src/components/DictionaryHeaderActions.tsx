import { useTranslation } from "react-i18next";
import { Download, Upload } from "./icons";
import { Toggle } from "./ui/toggle";

export function DictionaryHeaderActions(props: {
  onClearAll: () => void;
  onExport: () => void;
  onImport: () => void;
  autoLearn: boolean;
  onAutoLearnChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const action =
    "inline-flex items-center gap-1 rounded-sm text-xs text-foreground/60 outline-none transition-colors duration-[var(--motion-fast)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-2 text-xs text-foreground/60">
        <Toggle
          checked={props.autoLearn}
          onChange={props.onAutoLearnChange}
          aria-label={t("settingsPage.dictionary.autoLearnTitle")}
        />
        <span aria-hidden="true">{t("settingsPage.dictionary.autoLearnTitle")}</span>
      </label>
      <button type="button" onClick={props.onImport} className={action}>
        <Upload size={12} aria-hidden="true" />
        <span>{t("dictionary.import")}</span>
      </button>
      <button type="button" onClick={props.onExport} className={action}>
        <Download size={12} aria-hidden="true" />
        <span>{t("dictionary.exportAction")}</span>
      </button>
      <button
        type="button"
        onClick={props.onClearAll}
        className="rounded-sm text-xs text-foreground/60 outline-none transition-colors duration-[var(--motion-fast)] hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("dictionary.clearAll")}
      </button>
    </div>
  );
}
