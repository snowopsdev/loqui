import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "../icons";
import { useResolvedRoutes, type ResolvedRoute } from "../../lib/routes";
import type { RouteId } from "../../lib/routeGraph";
import { useSettingsStore } from "../../stores/settingsStore";
import { Toggle } from "../ui/toggle";
import { RouteDestinationChip, RouteStateChip } from "./routing/RouteChips";
import {
  subTabLabelKey,
  type SearchGroup,
  type SelectControl,
  type SettingEntry,
  type ToggleControl,
} from "./settingsRegistry";

export function LiveToggle({ entry, control }: { entry: SettingEntry; control: ToggleControl }) {
  const { t } = useTranslation();
  const checked = useSettingsStore((s) => control.get(s));
  const disabled = useSettingsStore((s) => control.disabled?.(s) ?? false);
  return (
    <Toggle
      checked={checked}
      disabled={disabled}
      aria-label={t(entry.labelKey)}
      onChange={(value) => control.set(useSettingsStore.getState(), value)}
    />
  );
}

export function LiveSelect({ entry, control }: { entry: SettingEntry; control: SelectControl }) {
  const { t } = useTranslation();
  const value = useSettingsStore((s) => control.get(s));
  return (
    <select
      aria-label={t(entry.labelKey)}
      value={value}
      onChange={(e) => control.set(useSettingsStore.getState(), e.target.value)}
      className="h-7 rounded-md border border-input-border bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {control.options.map((option) => (
        <option key={option.value} value={option.value}>
          {t(option.labelKey)}
        </option>
      ))}
    </select>
  );
}

function LiveControl({ entry, route }: { entry: SettingEntry; route: ResolvedRoute | null }) {
  const control = entry.control;
  if (control.kind === "toggle") return <LiveToggle entry={entry} control={control} />;
  if (control.kind === "select") return <LiveSelect entry={entry} control={control} />;
  if (control.kind === "route" && route) {
    // Read-only: where the task runs right now. Changing it happens in the Patchbay, through the planner.
    return (
      <span className="flex items-center gap-2">
        <RouteDestinationChip route={route} />
        <RouteStateChip state={route.state} />
      </span>
    );
  }
  return (
    <ChevronRight
      className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100"
      aria-hidden="true"
    />
  );
}

export function SettingsSearchResultsView({
  query,
  groups,
  activeId,
  routes,
  onJump,
  onEscape,
  onActiveChange,
}: {
  query: string;
  groups: SearchGroup[];
  activeId: string | null;
  routes: ReadonlyMap<RouteId, ResolvedRoute>;
  onJump: (entry: SettingEntry) => void;
  /** Clears the query and returns true. The pane claims Escape while it is showing (Task 10's escapeClaim). */
  onEscape: () => boolean;
  onActiveChange?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const entries = groups.flatMap((group) => group.entries);
  const count = groups.reduce((n, g) => n + g.entries.length, 0);
  return (
    <div
      data-escape-active="true"
      onKeyDown={(e) => {
        if (e.key === "Escape" && onEscape()) e.stopPropagation();
      }}
    >
      {count === 0 ? (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          {t("settingsSearch.none", { query })}
        </p>
      ) : (
        <div className="space-y-4">
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {t("settingsSearch.count", { count })}
          </p>
          {groups.map((group) => {
            const sectionLabel = t(`settingsModal.sections.${group.section}.label`);
            return (
              <section key={group.section} className="space-y-1.5">
                <h3 className="text-[11px] font-semibold text-muted-foreground">{sectionLabel}</h3>
                {group.entries.map((entry) => {
                  const subKey = subTabLabelKey(entry);
                  const route =
                    entry.control.kind === "route"
                      ? (routes.get(entry.control.routeId) ?? null)
                      : null;
                  return (
                    <div
                      key={entry.id}
                      data-result={entry.id}
                      data-active={activeId === entry.id ? "true" : "false"}
                      className="flex min-h-[52px] items-center gap-3 rounded-lg border border-border px-3 py-2 data-[active=true]:border-ring data-[active=true]:ring-2 data-[active=true]:ring-ring/30 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring"
                    >
                      <button
                        type="button"
                        data-result-jump={entry.id}
                        onClick={() => onJump(entry)}
                        onFocus={() => onActiveChange?.(entry.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                          event.preventDefault();
                          const index = entries.findIndex((candidate) => candidate.id === entry.id);
                          const next =
                            entries[
                              Math.min(
                                entries.length - 1,
                                Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1))
                              )
                            ];
                          onActiveChange?.(next.id);
                          const buttons = event.currentTarget
                            .closest('[data-escape-active="true"]')
                            ?.querySelectorAll<HTMLButtonElement>("[data-result-jump]");
                          buttons?.[entries.indexOf(next)]?.focus();
                        }}
                        className="min-w-0 flex-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {sectionLabel}
                          {subKey && (
                            <>
                              <ChevronRight
                                className="h-3 w-3 rtl:-scale-x-100"
                                aria-hidden="true"
                              />
                              {t(subKey)}
                            </>
                          )}
                        </span>
                        <span className="block text-xs font-semibold text-foreground">
                          {t(entry.labelKey)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t(entry.descriptionKey)}
                        </span>
                      </button>
                      <LiveControl entry={entry} route={route} />
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SettingsSearchResults(props: {
  query: string;
  groups: SearchGroup[];
  activeId: string | null;
  onJump: (entry: SettingEntry) => void;
  onEscape: () => boolean;
  onActiveChange?: (id: string) => void;
}) {
  const routes = useResolvedRoutes();
  const byId = useMemo(() => new Map(routes.map((route) => [route.id, route])), [routes]);
  const { activeId } = props;
  useEffect(() => {
    if (!activeId) return;
    document
      .querySelector(
        `[data-result="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(activeId) : activeId.replace(/["\\]/g, "\\$&")}"]`
      )
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);
  return <SettingsSearchResultsView {...props} routes={byId} />;
}
