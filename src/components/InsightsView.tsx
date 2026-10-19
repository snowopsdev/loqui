import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Flame, Gauge, Loader2, Mic2 } from "./icons";

import { useSettings } from "../hooks/useSettings";

import { buildAnalyticsActivityDays } from "../helpers/analytics";

import type { AnalyticsDailyBucket, AnalyticsSummary } from "../types/electron";
import { cn } from "./lib/utils";
import { PAGE_CONTENT_WIDTH_CLASS } from "./ui/pageWidth";
import { Tooltip } from "./ui/tooltip";
import { MetricCard } from "./insights/MetricCard";
import { useWorkspaceNavigation } from "./workspaceNavigation";
import { setHomeFilter, setHomeQuery } from "../stores/homeViewStore";

type ActivityDay = { date: string; words: number };

const ACTIVITY_INTENSITY_CLASSES = [
  "bg-foreground/6",
  "bg-foreground/20",
  "bg-foreground/40",
  "bg-foreground/60",
  "bg-foreground/80",
] as const;

function dateFromLocalKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function Heatmap({
  daily,
  heatmapRef,
}: {
  daily: AnalyticsDailyBucket[];
  heatmapRef: RefObject<HTMLDivElement | null>;
}) {
  const { t, i18n } = useTranslation();
  const calendar = useMemo(() => {
    const days: ActivityDay[] = buildAnalyticsActivityDays(daily);
    const cells: Array<ActivityDay | null> = [
      ...Array(dateFromLocalKey(days[0].date).getDay()).fill(null),
      ...days,
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks = Array.from({ length: cells.length / 7 }, (_, index) =>
      cells.slice(index * 7, index * 7 + 7)
    );
    const monthFormatter = new Intl.DateTimeFormat(i18n.language, { month: "short" });
    let previousMonth = "";
    const monthLabels = weeks.map((week, index) => {
      const labelDay =
        week.find((day) => day?.date.endsWith("-01")) ||
        (index === 0 ? week.find((day) => day !== null) : null);
      if (!labelDay) return null;
      const month = labelDay.date.slice(0, 7);
      if (month === previousMonth) return null;
      previousMonth = month;
      return monthFormatter.format(dateFromLocalKey(labelDay.date));
    });

    return {
      maxWords: Math.max(1, ...days.map((day) => day.words)),
      monthLabels,
      todayDate: days[days.length - 1].date,
      weeks,
    };
  }, [daily, i18n.language]);

  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(
          new Date(2024, 0, 7 + index, 12)
        )
      ),
    [i18n.language]
  );
  const weeks = calendar.weeks.length;
  // WS-Q11: fixed tracks prevent overlapping cells and preserve horizontal
  // overflow at the 10px floor. Weekday labels and their gap reserve 3rem.
  const cellStyle = {
    "--cell": `clamp(10px, calc((100cqi - 3rem - ${weeks - 1} * 2px) / ${weeks}), 18px)`,
  } as React.CSSProperties;
  const columnStyle = { gridTemplateColumns: `repeat(${weeks}, var(--cell))` };
  const rowStyle = { gridTemplateRows: "repeat(7, var(--cell))" };

  return (
    // Focusable, so the chart can be scrolled without a mouse. role="img" used
    // to sit on the container, which made every descendant presentational and
    // silently discarded the per-day labels below it; the cells carry it now
    // and the group only names the chart.
    <div className="@container min-w-0" style={cellStyle}>
      <div
        ref={heatmapRef}
        data-cellsize="10–18px"
        className="overflow-x-auto rounded-sm pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="group"
        aria-label={t("insights.activityLabel")}
      >
        <div className="w-max">
          <div className="grid grid-cols-[2.25rem_max-content] gap-x-3">
            <div aria-hidden="true" />
            <div className="grid h-5 gap-0.5" style={columnStyle} aria-hidden="true">
              {calendar.monthLabels.map((label, index) => {
                if (!label) return null;
                const next = calendar.monthLabels.findIndex((month, i) => i > index && month);
                return (
                  <span
                    key={index}
                    style={{ gridColumn: `${index + 1} / ${next < 0 ? weeks + 1 : next + 1}` }}
                    className="text-caption font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {label}
                  </span>
                );
              })}
            </div>

            <div className="grid gap-0.5" style={rowStyle} aria-hidden="true">
              {weekdayLabels.map((label) => (
                <span
                  key={label}
                  className="flex items-center text-caption leading-none text-muted-foreground whitespace-nowrap"
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="grid gap-0.5" style={columnStyle}>
              {calendar.weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="grid gap-0.5" style={rowStyle}>
                  {week.map((day, dayIndex) => {
                    if (!day) {
                      return (
                        <div
                          key={dayIndex}
                          aria-hidden="true"
                          className="size-(--cell) justify-self-center"
                        />
                      );
                    }
                    const intensity =
                      day.words === 0
                        ? 0
                        : Math.max(1, Math.ceil((day.words / calendar.maxWords) * 4));
                    const tooltip = t("insights.dayTooltip", {
                      date: day.date,
                      count: day.words,
                    });
                    return (
                      <div key={day.date} className="flex items-center justify-self-center">
                        <Tooltip content={tooltip}>
                          <div
                            data-intensity={intensity}
                            data-today={day.date === calendar.todayDate || undefined}
                            role="img"
                            aria-label={tooltip}
                            className={cn(
                              "size-(--cell) rounded-sm border border-muted-foreground",
                              ACTIVITY_INTENSITY_CLASSES[intensity],
                              day.date === calendar.todayDate && "ring-1 ring-foreground"
                            )}
                          />
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 flex items-center text-caption text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>{t("insights.activityLess")}</span>
              <div className="flex items-center gap-1" aria-hidden="true">
                {ACTIVITY_INTENSITY_CLASSES.slice(1).map((className) => (
                  <span
                    key={className}
                    className={cn("size-3 rounded-sm border border-muted-foreground", className)}
                  />
                ))}
              </div>
              <span>{t("insights.activityMore")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function YourUsage({ dataRetentionEnabled }: { dataRetentionEnabled: boolean }) {
  const { t, i18n } = useTranslation();
  const navigation = useWorkspaceNavigation();
  const heatmapRef = useRef<HTMLDivElement>(null);
  const openHistory = (filter: "all" | "dictations") => {
    setHomeQuery("");
    setHomeFilter(filter);
    navigation.openView("home");
  };
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [loadFailed, setLoadFailed] = useState(false);
  // Every dictation broadcasts analytics-changed, so loads overlap; only the
  // newest one may write state, or a slow reply overwrites a fresher summary.
  // A superseded load also bails before syncing, so two passes cannot share a
  // batch and leave the winner reading a summary the other has not finished.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    // The device read stands on its own. Folding it into the same catch as the
    // cloud fetch meant a failed local read fell through to a summary of
    // zeros — under a confident "On this device", with no error anywhere — and
    // told the user their history was empty.
    let local: AnalyticsSummary;
    try {
      local = await window.electronAPI.getAnalyticsSummary();
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.error("Reading local Insights failed:", error);
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    if (requestId !== requestIdRef.current) return;
    setLoadFailed(false);

    setSummary(local);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    const dispose = window.electronAPI.onAnalyticsChanged?.(() => void load());
    return () => {
      dispose?.();
    };
  }, [load]);

  // i18n.language, not the runtime default: the OS locale is not the language
  // the app is being read in, so a Japanese UI rendered 12.3K where 1.2万
  // belongs, next to correctly localized month labels in the same card.
  const number = useMemo(
    () => new Intl.NumberFormat(i18n.language, { notation: "compact", maximumFractionDigits: 1 }),
    [i18n.language]
  );

  if (loadFailed) {
    return (
      <div className="rounded-lg border border-border bg-card/50 backdrop-blur-sm dark:bg-card/60">
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">{t("insights.loadError")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-lg border border-border bg-card/50 backdrop-blur-sm dark:bg-card/60">
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 size={14} className="animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">{t("controlPanel.loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {!dataRetentionEnabled && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10 px-3.5 py-2.5 flex items-center gap-2.5">
          <span className="text-amber-600 dark:text-amber-400 shrink-0 text-sm">⊘</span>
          <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed">
            {t("insights.dataRetentionDisabled")}
          </p>
        </div>
      )}

      {summary.totalDictations === 0 ? (
        <div className="rounded-lg border border-border bg-card/50 backdrop-blur-sm dark:bg-card/60">
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <BarChart3 size={40} className="mb-4 text-foreground/45" aria-hidden="true" />
            <h2 className="text-sm font-medium text-foreground">{t("insights.emptyTitle")}</h2>
            <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
              {t("insights.emptyBody")}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 @min-[720px]:grid-cols-4">
            <MetricCard
              icon={Mic2}
              label={t("insights.wordsSpoken")}
              onSelect={() => openHistory("all")}
              selectLabel={t("insights.openHistory")}
              value={number.format(summary.totalWords)}
              detail={t("insights.allTime")}
              largeValue
            />
            <MetricCard
              icon={Gauge}
              label={t("insights.wordsPerMinute")}
              onSelect={() => openHistory("all")}
              selectLabel={t("insights.openHistory")}
              value={summary.averageWpm == null ? "—" : number.format(summary.averageWpm)}
              detail={t("insights.wpmCoverage", { count: summary.wpmCoveragePercent })}
              largeValue
            />
            <MetricCard
              icon={BarChart3}
              label={t("insights.dictations")}
              onSelect={() => openHistory("dictations")}
              selectLabel={t("insights.openDictations")}
              value={number.format(summary.totalDictations)}
              detail={t("insights.allTime")}
              largeValue
            />
            <MetricCard
              icon={Flame}
              label={t("insights.currentStreak")}
              onSelect={() => {
                heatmapRef.current?.scrollIntoView({ block: "center" });
                heatmapRef.current?.focus();
              }}
              selectLabel={t("insights.focusHeatmap")}
              value={t("insights.days", { count: summary.currentStreakDays })}
              detail={t("insights.longestStreak", { count: summary.longestStreakDays })}
            />
          </div>

          <div className="mt-5 rounded-xl border border-border/70 bg-card/70 px-5 py-2.5 dark:border-white/10">
            <h2 className="text-base font-medium text-foreground">{t("insights.activity")}</h2>
            <div className="mt-2">
              <Heatmap daily={summary.daily} heatmapRef={heatmapRef} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function InsightsView() {
  const { t } = useTranslation();
  const { dataRetentionEnabled } = useSettings();
  return (
    <div className={cn(PAGE_CONTENT_WIDTH_CLASS, "@container px-6 py-6")}>
      <YourUsage dataRetentionEnabled={dataRetentionEnabled} />
      <p className="pt-8 text-center text-xs text-muted-foreground">
        {t("insights.onDevicePrivacy")}
      </p>
    </div>
  );
}
