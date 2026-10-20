import { MousePointerClick, MicVocal } from "../icons";
import { useTranslation } from "react-i18next";

type ActivationMode = "tap" | "push";

interface ActivationModeSelectorProps {
  value: ActivationMode;
  onChange: (mode: ActivationMode) => void;
  pushDisabledReason?: string;
}

const OPTIONS = [
  { mode: "tap", Icon: MousePointerClick, labelKey: "common.tap" },
  { mode: "push", Icon: MicVocal, labelKey: "common.hold" },
] as const;

const STYLES = {
  default: {
    track: "rounded-md border p-0.5 bg-surface-1 border-border-subtle",
    indicator: "rounded border bg-surface-raised border-border-subtle",
    button: "gap-1.5 rounded px-3.5 py-1.5 text-xs",
    icon: "size-3.5",
    selected: "text-foreground",
    unselected: "text-muted-foreground hover:text-foreground",
  },
} as const;

export function ActivationModeSelector({
  value,
  onChange,
  pushDisabledReason,
}: ActivationModeSelectorProps) {
  const { t } = useTranslation();
  const styles = STYLES.default;

  return (
    // Two equal columns, so the half-width indicator covers exactly one option
    // and a single full-width translate lands it under the other.
    <div className={`relative grid grid-cols-2 transition-colors duration-200 ${styles.track}`}>
      <div
        className={`absolute inset-y-[var(--inset)] start-[var(--inset)] w-[calc(50%-var(--inset))] transition-transform duration-200 ease-out ${styles.indicator} ${
          value === "push" ? "translate-x-full rtl:-translate-x-full" : "translate-x-0"
        }`}
        style={{ "--inset": "2px" } as React.CSSProperties}
      />

      {OPTIONS.map(({ mode, Icon, labelKey }) => {
        const disabledReason = mode === "push" ? pushDisabledReason : undefined;
        const disabled = Boolean(disabledReason);
        const label = t(labelKey);

        return (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            title={disabledReason}
            aria-label={disabledReason ? `${label}: ${disabledReason}` : undefined}
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
            className={`relative z-10 flex items-center justify-center font-medium transition-colors duration-150 ${styles.button} ${
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            } ${value === mode ? styles.selected : styles.unselected}`}
          >
            <Icon className={styles.icon} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
