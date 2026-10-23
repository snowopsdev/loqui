import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EgressEvent, EgressSummary } from "../../types/privacy";
import { useSealedMode } from "../../hooks/useSealedMode";
import { useSettingsStore } from "../../stores/settingsStore";
import { formatBytes } from "../../utils/formatBytes";
import { Button } from "../ui/button";
import {
  RecorderFeed,
  type RecorderBusy,
  type RecorderError,
  type RecorderFeedState,
  type RecorderNotice,
} from "./flightRecorderFeed";
import {
  MAX_LIMIT,
  bytesCell,
  errorClassId,
  hostTrail,
  ltr,
  outcomeId,
  sentCell,
  shownEvents,
  startOfToday,
  taskId,
  timeCell,
  timelineTicks,
  undrawnUntil,
  type TickKind,
} from "./flightRecorderView";

// SET-M3: the flight recorder, directly after the Sealed mode panel. It lists
// what Loqui's own network guards recorded today: metadata only. It never
// claims that nothing left this computer: an empty, cleared, pruned or
// memory-only ledger is not evidence of no traffic (A21).

const R = "settingsPage.privacy.recorder";
type T = (key: string, params?: Record<string, unknown>) => string;
export type RetentionView = { historyOn: boolean; days: number };

// Ticks differ in shape as well as colour (never colour alone): sent is a solid
// bar, a helper session an outlined bar, blocked a short hollow stub, and an
// unexplained request a tall solid bar in the destructive colour.
const TICK_CLASS: Record<TickKind, string> = {
  sent: "h-6 w-[3px] bg-[var(--color-locality-remote)]",
  session: "h-6 w-1.5 border-2 border-[var(--color-locality-remote)] bg-transparent",
  blocked: "h-3 w-1.5 border-2 border-muted-foreground bg-transparent",
  unexplained: "h-9 w-[3px] bg-destructive",
};
const TICK_KINDS: TickKind[] = ["sent", "session", "blocked", "unexplained"];
const COLUMNS = ["time", "task", "host", "sent", "received", "status", "model"] as const;
const MAX_UNEXPLAINED_HOSTS = 3;
const muted = "text-[12px] leading-relaxed text-muted-foreground";
const warn = "text-[12px] leading-relaxed font-medium text-foreground";

function Bytes({ cell, t }: { cell: { text: string; unknown: boolean }; t: T }) {
  return cell.unknown ? (
    <span>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t(`${R}.unknownBytes`)}</span>
    </span>
  ) : (
    <span>{cell.text}</span>
  );
}

function HostCell({ e, t }: { e: EgressEvent; t: T }) {
  if (e.opaque || e.kind === "session") {
    // Loqui knows where this program usually connects, not where it did.
    return <span>{t(`${R}.usualHost`, { host: ltr(e.host) })}</span>;
  }
  if (e.host === "unknown" && (e.hosts?.length ?? 0) <= 1) {
    return <span className="text-muted-foreground">{t(`${R}.unknownHost`)}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span dir="ltr" className="font-mono">
        {hostTrail(e)}
      </span>
      {e.kind === "connection" && (
        <span className="text-muted-foreground">{t(`${R}.connection`)}</span>
      )}
    </span>
  );
}

function BytesCells({ e, t }: { e: EgressEvent; t: T }) {
  if (e.opaque || e.kind === "session") {
    // A helper program's own traffic: Loqui saw the session, not its bytes.
    return (
      <td colSpan={2} className="pe-3 text-muted-foreground">
        {t(`${R}.opaque`)}
      </td>
    );
  }
  if (e.outcome === "blocked") {
    // Refused before any connection opened: the only row that says so.
    return (
      <td colSpan={2} className="pe-3 text-muted-foreground">
        {t(`${R}.notSent`)}
      </td>
    );
  }
  return (
    <>
      <td className="pe-3">
        <Bytes cell={sentCell(e, formatBytes)} t={t} />
      </td>
      <td className="pe-3">
        <Bytes cell={bytesCell(e.bytesIn, formatBytes)} t={t} />
      </td>
    </>
  );
}

export function FlightRecorderView({
  t,
  events,
  summary,
  now,
  since = startOfToday(now),
  formatTime,
  onExport,
  onClear,
  error = null,
  truncated = false,
  limit = 0,
  onShowMore,
  onRetry,
  busy = null,
  notice = null,
  retention = null,
  recordFailures = 0,
  persistError = false,
}: {
  t: T;
  events: EgressEvent[];
  summary: EgressSummary | null;
  now: number;
  since?: number;
  formatTime: (ms: number) => string;
  onExport: () => void;
  onClear: () => void;
  error?: RecorderError | null;
  truncated?: boolean;
  limit?: number;
  onShowMore?: () => void;
  onRetry?: () => void;
  busy?: RecorderBusy;
  notice?: RecorderNotice | null;
  retention?: RetentionView | null;
  recordFailures?: number;
  persistError?: boolean;
}) {
  const headingId = `flight-recorder-${useId()}`;
  const loaded = error === null && summary !== null;
  const rows = loaded ? shownEvents(events) : [];
  const ticks = loaded ? timelineTicks(events, since) : [];
  // A cut list draws only its newest rows; the earlier part of the day is
  // marked as not drawn rather than shown empty while the counts include it.
  const undrawn = loaded ? undrawnUntil(events, since, truncated) : null;
  const unexplainedHosts = summary?.unattributedHosts ?? [];
  const retentionLine = !retention
    ? t(`${R}.retention`)
    : !retention.historyOn
      ? t(`${R}.retentionMemory`)
      : retention.days > 0
        ? t(`${R}.retentionDays`, { count: retention.days })
        : t(`${R}.retentionForever`);
  return (
    <section
      aria-labelledby={headingId}
      data-flight-recorder=""
      className="space-y-3 rounded-lg border border-border bg-card p-4 text-start text-foreground"
    >
      <header className="space-y-1">
        <h3 id={headingId} className="text-[13px] font-semibold">
          {t(`${R}.title`)}
        </h3>
        <p className={muted}>{t(`${R}.subtitle`)}</p>
      </header>

      {error !== null ? (
        // A failed read is said so, with Retry; never "Loading…" forever and
        // never the last list as if it were current.
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className={warn}>
            {t(`${R}.${error === "unavailable" ? "unavailableRead" : "loadError"}`)}
          </p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t(`${R}.retry`)}
            </Button>
          )}
        </div>
      ) : summary === null ? (
        // Loading: claim nothing, not even zero.
        <p role="status" className={muted}>
          {t(`${R}.loading`)}
        </p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline gap-3">
            {summary.observed > 0 && (
              // The counted line below says the same for screen readers.
              <span aria-hidden="true" className="text-[28px] leading-none font-bold tabular-nums">
                {summary.observed}
              </span>
            )}
            <span className="text-[12px] font-medium">
              {t(`${R}.observedToday`, { count: summary.observed })}
            </span>
          </div>
          {summary.connections > 0 && (
            <p className={muted}>{t(`${R}.connectionsToday`, { count: summary.connections })}</p>
          )}
          {summary.opaqueSessions > 0 && (
            <p className={muted}>{t(`${R}.sessionsToday`, { count: summary.opaqueSessions })}</p>
          )}
          {summary.blocked > 0 && (
            <p className={muted}>{t(`${R}.blockedToday`, { count: summary.blocked })}</p>
          )}
          <p className={muted}>{t(`${R}.coverage`)}</p>
        </div>
      )}

      {(recordFailures > 0 || (persistError && loaded)) && (
        <div role="status" className="space-y-1">
          {recordFailures > 0 && (
            <p className={warn}>{t(`${R}.recordFailures`, { count: recordFailures })}</p>
          )}
          {/* "This list may be incomplete" only while a list is shown. */}
          {persistError && loaded && <p className={warn}>{t(`${R}.unavailable`)}</p>}
        </div>
      )}

      {loaded && summary.unattributed > 0 && unexplainedHosts.length > 0 && (
        <p role="status" className="rounded-md border border-destructive px-3 py-2 text-[12px]">
          {t(`${R}.unexplained`, {
            hosts: unexplainedHosts.slice(0, MAX_UNEXPLAINED_HOSTS).map(ltr).join(", "),
          })}
          {unexplainedHosts.length > MAX_UNEXPLAINED_HOSTS &&
            ` ${t(`${R}.unexplainedMore`, {
              count: unexplainedHosts.length - MAX_UNEXPLAINED_HOSTS,
            })}`}
        </p>
      )}

      {loaded && (
        <div className="space-y-1.5">
          <div
            role="img"
            aria-label={t(`${R}.${undrawn === null ? "timelineLabel" : "timelineLabelPartial"}`)}
            className="relative h-10 overflow-hidden rounded-md border border-border"
          >
            {undrawn !== null && undrawn > 0 && (
              <span
                aria-hidden="true"
                data-partial=""
                style={{ insetInlineStart: "0%", width: `${undrawn * 100}%` }}
                className="absolute inset-y-0 bg-muted"
              />
            )}
            {ticks.map((tick) => (
              <span
                key={tick.id}
                data-kind={tick.kind}
                title={t(`${R}.tick`, {
                  time: formatTime(tick.event.ts),
                  task: t(`${R}.tasks.${taskId(tick.event.task)}`),
                  host: ltr(tick.event.host),
                })}
                style={{ insetInlineStart: `${tick.position * 100}%` }}
                className={`absolute bottom-0 rounded-t-sm ${TICK_CLASS[tick.kind]}`}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            {TICK_KINDS.map((kind) => (
              <li key={kind} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  data-legend={kind}
                  className={`inline-block shrink-0 rounded-t-sm ${TICK_CLASS[kind]}`}
                />
                {t(`${R}.legend.${kind}`)}
              </li>
            ))}
          </ul>
          {undrawn !== null && <p className={muted}>{t(`${R}.timelinePartial`)}</p>}
        </div>
      )}

      {loaded && rows.length === 0 && <p className={muted}>{t(`${R}.empty`)}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <caption className="sr-only">{t(`${R}.tableCaption`)}</caption>
            <thead>
              <tr className="text-muted-foreground">
                {COLUMNS.map((c) => (
                  <th key={c} scope="col" className="py-2 pe-3 text-start font-semibold">
                    {t(`${R}.columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((e) => {
                const code = e.status ?? errorClassId(e.errorClass);
                return (
                  <tr key={e.id} data-kind={e.kind} className="h-8 border-t border-border/60">
                    <td className="pe-3 whitespace-nowrap">{timeCell(e, formatTime)}</td>
                    <td className="pe-3">{t(`${R}.tasks.${taskId(e.task)}`)}</td>
                    <td className="pe-3">
                      <HostCell e={e} t={t} />
                    </td>
                    <BytesCells e={e} t={t} />
                    <td className="pe-3">
                      {t(`${R}.outcome.${outcomeId(e.outcome)}`)}
                      {code != null && (
                        <span dir="ltr" className="ms-1 text-muted-foreground">
                          {code}
                        </span>
                      )}
                    </td>
                    <td dir="ltr" className="pe-3">
                      {e.model ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {loaded && truncated && (
        <div className="flex flex-wrap items-center gap-3">
          <p className={muted}>{t(`${R}.truncated`, { count: rows.length })}</p>
          {limit < MAX_LIMIT && onShowMore ? (
            <Button variant="outline" size="sm" onClick={onShowMore}>
              {t(`${R}.showMore`)}
            </Button>
          ) : (
            <p className={muted}>{t(`${R}.exportForAll`)}</p>
          )}
        </div>
      )}

      <div className="space-y-1">
        <p className={muted}>{t(`${R}.loopbackNote`)}</p>
        <p className={muted}>{t(`${R}.bytesNote`)}</p>
        <p className={muted}>{retentionLine}</p>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={busy !== null || error !== null}
          >
            {t(`${R}.export`)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={busy !== null || error !== null}
          >
            {t(`${R}.clear`)}
          </Button>
        </div>
        <p className={muted}>{t(`${R}.actionsNote`)}</p>
        <p role="status" aria-live="polite" className={notice?.endsWith("Error") ? warn : muted}>
          {notice ? t(`${R}.notice.${notice}`) : ""}
        </p>
      </div>
    </section>
  );
}

export default function FlightRecorderPanel() {
  const { t, i18n } = useTranslation();
  // Read the bridge once: the preload object is stable, and the feed it backs
  // must outlive re-renders.
  const [api] = useState(() => window.electronAPI?.privacy ?? null);
  const historyOn = useSettingsStore((s) => s.dataRetentionEnabled);
  const days = useSettingsStore((s) => s.transcriptRetentionDays);
  const { attestation } = useSealedMode();
  const feedRef = useRef<RecorderFeed | null>(null);
  const [state, setState] = useState<RecorderFeedState | null>(null);
  useEffect(() => {
    if (!api) return;
    // One feed per mount; a re-run (StrictMode) starts a fresh one.
    const feed = new RecorderFeed(api);
    feedRef.current = feed;
    const off = feed.subscribe(setState);
    setState(feed.getState());
    const stop = feed.start();
    // After sleep or a long time in the background the day may have changed.
    const checkDay = () => feed.checkDay();
    const onVisible = () => {
      if (document.visibilityState !== "hidden") checkDay();
    };
    window.addEventListener("focus", checkDay);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", checkDay);
      document.removeEventListener("visibilitychange", onVisible);
      off();
      stop();
      if (feedRef.current === feed) feedRef.current = null;
    };
  }, [api]);
  const formatTime = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { hour: "numeric", minute: "2-digit" });
    return (ms: number) => format.format(ms);
  }, [i18n.language]);
  const now = Date.now();
  return (
    <FlightRecorderView
      t={t as T}
      events={state?.events ?? []}
      summary={state?.summary ?? null}
      now={now}
      since={state?.since ?? startOfToday(now)}
      formatTime={formatTime}
      // Without the bridge there is nothing to read; say so rather than load forever.
      error={api ? (state?.error ?? null) : "failed"}
      truncated={state?.truncated ?? false}
      limit={state?.limit ?? 0}
      busy={state?.busy ?? null}
      notice={state?.notice ?? null}
      retention={{ historyOn: historyOn !== false, days: Number(days) || 0 }}
      recordFailures={attestation?.recordFailures ?? 0}
      persistError={Boolean(attestation?.persistError)}
      onShowMore={() => void feedRef.current?.showMore()}
      onRetry={api ? () => void feedRef.current?.retry() : undefined}
      onExport={() => void feedRef.current?.exportCsv()}
      // Main asks for confirmation in its own dialog; "Keep records" resolves false.
      onClear={() => void feedRef.current?.clear()}
    />
  );
}
