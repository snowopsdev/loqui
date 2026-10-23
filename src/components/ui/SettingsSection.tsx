import React from "react";
import { useTranslation } from "react-i18next";
import type { RouteState } from "../../lib/routeGraph";
import type { InferenceMode } from "../../types/electron";
import { RouteStateChip } from "../settings/routing/RouteChips";
import { stepLinear } from "./rovingNav";
import { SettingsControlLabel } from "./settingsControlLabel";
import { useSettingsLayout } from "./useSettingsLayout";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  children,
  className = "",
}) => {
  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <h3 className="text-xs font-semibold text-foreground tracking-tight">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
};

interface SettingsRowProps {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  description,
  children,
  className = "",
}) => {
  const { isCompact } = useSettingsLayout();
  const labelId = React.useId();

  return (
    <SettingsControlLabel.Provider value={labelId}>
      <div
        className={`flex ${
          isCompact ? "flex-col items-start gap-2" : "items-center justify-between gap-4"
        } ${className}`}
      >
        <div className="min-w-0 flex-1">
          <p id={labelId} className="text-xs font-medium text-foreground">
            {label}
          </p>
          {description && (
            <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
        <div className={isCompact ? "" : "shrink-0"}>{children}</div>
      </div>
    </SettingsControlLabel.Provider>
  );
};

export function SettingsPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border/70 dark:border-border-subtle/70 bg-card/50 dark:bg-surface-2/50 backdrop-blur-sm divide-y divide-border/60 dark:divide-border-subtle/50 ${className}`}
    >
      {children}
    </div>
  );
}

export function SettingsPanelRow({
  children,
  className = "",
  settingId,
}: {
  children: React.ReactNode;
  className?: string;
  settingId?: string;
}) {
  const { isCompact } = useSettingsLayout();

  return (
    <div
      data-setting-id={settingId}
      className={`${isCompact ? "px-3 py-2.5" : "px-4 py-3"} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  note,
}: {
  title?: string;
  description?: string;
  note?: string | false;
}) {
  return (
    <div className="mb-3">
      {title && <h3 className="text-xs font-semibold text-foreground tracking-tight">{title}</h3>}
      {description && (
        <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>
      )}
      {note && <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{note}</p>}
    </div>
  );
}

export interface InferenceModeOption {
  id: InferenceMode;
  disabled?: boolean;
  badge?: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

export function InferenceModeSelector({
  label,
  modes,
  activeMode,
  onSelect,
  routeState,
  stagedMode = null,
}: {
  /** Accessible name of the radio group, e.g. "Dictation runs on". */
  label: string;
  modes: InferenceModeOption[];
  activeMode: InferenceMode | null;
  onSelect: (mode: InferenceMode) => void;
  /** State of the route the applied mode resolves to; shown next to "Current". */
  routeState?: RouteState;
  /** A mode staged behind Apply (Task 8). It is the checked radio; the applied one stays "Current". */
  stagedMode?: InferenceMode | null;
}) {
  const { t, i18n } = useTranslation();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null);
  const rtl = (i18n?.dir?.() ?? "ltr") === "rtl";
  const disabled = modes.map((mode) => !!mode.disabled);
  const checkedId = stagedMode ?? activeMode;
  const checkedIndex = modes.findIndex((mode) => mode.id === checkedId);
  const anchor = checkedIndex >= 0 ? checkedIndex : Math.max(0, disabled.indexOf(false));
  const tabStop =
    focusIndex !== null && focusIndex < modes.length && !disabled[focusIndex] ? focusIndex : anchor;
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = stepLinear(index, event.key, disabled, rtl);
    if (next === index) return;
    event.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
  };

  return (
    <SettingsPanel className="overflow-hidden">
      <div
        role="radiogroup"
        aria-label={label}
        className="divide-y divide-border/60 dark:divide-border-subtle/50"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocusIndex(null);
        }}
      >
        {modes.map((mode, index) => {
          const isChecked = index === checkedIndex;
          const isCurrent = activeMode === mode.id;
          const isStaged = stagedMode === mode.id && stagedMode !== activeMode;
          const isDisabled = !!mode.disabled;
          return (
            <SettingsPanelRow
              key={mode.id}
              className={`transition-colors duration-[var(--motion-fast)] ${
                isDisabled ? "" : "hover:bg-foreground/3 dark:hover:bg-white/3"
              }`}
            >
              <button
                role="radio"
                aria-checked={isChecked}
                tabIndex={index === tabStop ? 0 : -1}
                type="button"
                aria-disabled={isDisabled || undefined}
                ref={(el) => {
                  refs.current[index] = el;
                }}
                onClick={() => {
                  if (!isDisabled) onSelect(mode.id);
                }}
                onFocus={() => setFocusIndex(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={`group flex w-full cursor-pointer items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring ${isDisabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--motion-fast)] ${
                    isChecked
                      ? "bg-primary/10 dark:bg-primary/15"
                      : "bg-muted/60 group-hover:bg-muted dark:bg-surface-raised dark:group-hover:bg-surface-3"
                  }`}
                >
                  <div
                    className={`transition-colors duration-[var(--motion-fast)] ${isChecked ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {mode.icon}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{mode.label}</span>
                    {isCurrent && !isDisabled && (
                      <span className="rounded-sm bg-muted px-1.5 py-px text-xs font-medium text-foreground">
                        {t("routes.selection.current")}
                      </span>
                    )}
                    {isCurrent && routeState && (
                      <RouteStateChip state={routeState} className="h-5 px-0" />
                    )}
                    {isStaged && (
                      <span className="rounded-sm border border-dashed border-locality-remote px-1.5 py-px text-xs font-medium text-foreground">
                        {t("routes.selection.staged")}
                      </span>
                    )}
                    {isDisabled && mode.badge && (
                      <span className="rounded-sm bg-muted/80 px-1.5 py-px text-xs font-medium text-muted-foreground dark:bg-surface-3">
                        {mode.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{mode.description}</p>
                </div>
                <div
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 rounded-full border-2 transition-colors duration-[var(--motion-fast)] ${
                    isChecked
                      ? "border-ring bg-ring"
                      : "border-muted-foreground dark:border-muted-foreground"
                  }`}
                >
                  {isChecked && (
                    <div className="flex h-full w-full items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                    </div>
                  )}
                </div>
              </button>
            </SettingsPanelRow>
          );
        })}
      </div>
    </SettingsPanel>
  );
}
