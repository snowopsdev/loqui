import { DataRetentionNotice } from "./ui/DataRetentionNotice";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveClock, type CaptureStatusModel } from "../hooks/useCaptureStatus";
import { useNow } from "../hooks/useNow";
import { nextUpcomingEvent, startMeetingNotes } from "../lib/upcomingEvents";
import { ReadyStrip } from "./home/ReadyStrip";
import { useUiLocale } from "../hooks/useUiLocale";
import { useUpcomingEvents } from "../hooks/useUpcomingEvents";
import { useSettingsStore } from "../stores/settingsStore";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { formatDateGroup } from "../utils/dateFormatting";
import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";
import { Loader2, Mic, Sparkles, X } from "./icons";
import { cn } from "./lib/utils";
import { Button } from "./ui/button";
import EmptyStateCard from "./ui/EmptyStateCard";
import { PAGE_CONTENT_WIDTH_CLASS } from "./ui/pageWidth";
import TranscriptionItem from "./ui/TranscriptionItem";
import UpcomingMeetings from "./UpcomingMeetings";

import { HistoryToolbar } from "./home/HistoryToolbar";
import { HistoryMenu } from "./home/HistoryMenu";
import { NoteFeedRow, SessionRow } from "./home/FeedRows";
import { buildHomeFeed, countWords, locateTranscript } from "../lib/homeFeed";
import { useRecentNotes } from "../hooks/useRecentNotes";
import { useWorkspaceNavigation } from "./workspaceNavigation";
import {
  clearTranscriptFocus,
  requestTranscriptFocus,
  setHomeFilter,
  setHomeQuery,
  useHomeViewStore,
} from "../stores/homeViewStore";
import { retainTranscriptionForLanding } from "../stores/transcriptionStore";
import { useToast } from "./ui/useToast";

// Behavioural window shared with --motion-dwell-ring.
const HISTORY_RING_MS = 1200;
const EMPTY_PREVIEW_WIDTHS = ["w-full", "w-4/5", "w-3/5"];

interface HistoryViewProps {
  capture: CaptureStatusModel;
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  aiCTADismissed: boolean;
  setAiCTADismissed: (dismissed: boolean) => void;
  useCleanupModel: boolean;
  copyToClipboard: (text: string) => void;
  deleteTranscription: (id: number) => void;
  clearAllTranscriptions: () => void;
  onOpenSettings: (section?: string) => void;
  onOpenIntegrations: () => void;
  onShowAudioInFolder: (id: number) => void;
  onRetryTranscription: (id: number, options?: { isRecover?: boolean }) => Promise<void>;
  showDiscarded: boolean;
  onToggleDiscarded: () => void;
}

export default function HistoryView({
  capture,
  history,
  isLoading,
  hotkey,
  aiCTADismissed,
  setAiCTADismissed,
  useCleanupModel,
  copyToClipboard,
  deleteTranscription,
  clearAllTranscriptions,
  onOpenSettings,
  onOpenIntegrations,
  onShowAudioInFolder,
  onRetryTranscription,
  showDiscarded,
  onToggleDiscarded,
}: HistoryViewProps) {
  const { t } = useTranslation();
  const locale = useUiLocale();
  const personalDataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const dataRetentionEnabled = personalDataRetentionEnabled;
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();

  const now = useNow(30_000);
  const tick = useLiveClock(capture.kind === "listening");
  const nowMs = capture.kind === "listening" ? tick : now.getTime();
  const holdToTalk = useSettingsStore((s) => s.activationMode === "push");
  const next = useMemo(() => nextUpcomingEvent(events, now), [events, now]);

  const { filter, query, focusTranscriptId, focusNonce } = useHomeViewStore();
  const { toast } = useToast();
  const recentNotes = useRecentNotes(50);
  const feed = useMemo(
    () => buildHomeFeed({ transcriptions: history, notes: recentNotes, filter, query }),
    [history, recentNotes, filter, query]
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [ring, setRing] = useState<{ id: number; nonce: number } | null>(null);
  const [landingError, setLandingError] = useState<{ nonce: number; retry: () => void } | null>(
    null
  );
  const filterRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigation = useWorkspaceNavigation();
  const landingGenRef = useRef(0);
  const aliveRef = useRef(false);
  const framesRef = useRef(new Set<number>());
  const feedRef = useRef(feed);
  feedRef.current = feed;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, [contenteditable='true']");
      if (
        event.defaultPrevented ||
        event.key !== "/" ||
        typing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      filterRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mount lifetime is independent of the consumed focus id. Clearing that id
  // must not cancel this request; leaving Home must cancel all of its work.
  useEffect(() => {
    aliveRef.current = true;
    const frames = framesRef.current;
    return () => {
      aliveRef.current = false;
      landingGenRef.current += 1;
      for (const frame of frames) cancelAnimationFrame(frame);
      frames.clear();
    };
  }, []);

  useEffect(() => {
    const generation = ++landingGenRef.current;
    for (const frame of framesRef.current) cancelAnimationFrame(frame);
    framesRef.current.clear();
    setLandingError(null);
    if (focusTranscriptId == null) return;
    const id = focusTranscriptId;
    // Read current store ownership as well as the local generation: a newer
    // intent invalidates us synchronously, before React runs its next effect.
    const ownsIntent = () =>
      aliveRef.current &&
      generation === landingGenRef.current &&
      useHomeViewStore.getState().focusNonce === focusNonce;
    if (!ownsIntent()) return;
    const retained = retainTranscriptionForLanding(id, ownsIntent);
    const ownsRequest = () => ownsIntent() && retained.isCurrent();
    const frame = (callback: () => void) => {
      if (!ownsRequest()) return;
      const handle = requestAnimationFrame(() => {
        framesRef.current.delete(handle);
        if (!ownsRequest()) return;
        callback();
      });
      framesRef.current.add(handle);
    };
    if (!ownsRequest()) return;
    clearTranscriptFocus();
    const land = () => {
      if (!ownsRequest()) return;
      if (retained.hasPendingPages) {
        retained.afterPages(() => frame(land));
        return;
      }
      const pageVersion = retained.pageVersion;
      const found = locateTranscript(feedRef.current, id);
      if (!found) return;
      if (found.inSession) setExpanded((prev) => new Set(prev).add(found.entryKey));
      setRing({ id, nonce: focusNonce });
      // Commit the expanded session before querying its real nested row.
      frame(() =>
        frame(() => {
          if (!ownsRequest()) return;
          // A page can regroup the target into a different session. Rebuild its
          // expansion after that producer settles, without polling frames.
          if (retained.hasPendingPages || retained.pageVersion !== pageVersion) {
            retained.afterPages(() => frame(land));
            return;
          }
          const row = rootRef.current?.querySelector(`[data-transcript-id="${id}"]`);
          const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          if (!ownsRequest()) return;
          row?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
          retained.releaseAfterPages();
        })
      );
    };
    if (locateTranscript(feedRef.current, id)) land();
    else
      void (async () => {
        let fetched: TranscriptionItemType | null;
        try {
          fetched = await window.electronAPI.getTranscriptionById(id);
        } catch {
          if (!ownsRequest()) return;
          setLandingError({
            nonce: focusNonce,
            retry: () => {
              if (!ownsRequest()) return;
              requestTranscriptFocus(id);
            },
          });
          return;
        }
        if (!ownsRequest()) return;
        if (!fetched || fetched.deleted_at) {
          if (!ownsRequest()) return;
          toast({ title: t("home.history.olderMissing") });
          return;
        }
        if (!ownsRequest()) return;
        retained.reveal(fetched);
        frame(land); // allow the store-backed feed to rebuild
      })();
    return retained.release;
    // One landing per request nonce; its intentional id clear is not cancellation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  useEffect(() => {
    if (!ring) return;
    const clear = window.setTimeout(() => setRing(null), HISTORY_RING_MS);
    return () => window.clearTimeout(clear);
  }, [ring]);

  const rowHandlers = {
    onCopy: copyToClipboard,
    onDelete: deleteTranscription,
    onShowAudioInFolder,
    onRetryTranscription,
    onOpenSettings: () => onOpenSettings("transcription"),
  };
  const toggleSession = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div ref={rootRef} className={cn(PAGE_CONTENT_WIDTH_CLASS, "@container px-6 pt-4 pb-6")}>
      <ReadyStrip
        status={capture}
        now={nowMs}
        hotkeyLabel={formatHotkeyLabel(parseHotkeyList(hotkey)[0])}
        holdToTalk={holdToTalk}
        next={
          next
            ? { title: next.event.summary || t("upcoming.untitledEvent"), start: next.start }
            : null
        }
        onTakeNotes={() => next && startMeetingNotes(next.event)}
      />
      {!useCleanupModel && !aiCTADismissed && (
        <div className="mb-3 relative rounded-lg border border-border bg-foreground/5 dark:bg-foreground/5 p-3">
          <button
            onClick={() => {
              localStorage.setItem("aiCTADismissed", "true");
              setAiCTADismissed(true);
            }}
            aria-label={t("common.close")}
            className="focus-visible:ring-2 focus-visible:ring-ring absolute top-2 end-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X size={14} />
          </button>
          <div className="flex items-start gap-3 pe-6">
            <div className="shrink-0 w-8 h-8 rounded-md bg-ai/12 border border-ai/30 flex items-center justify-center">
              <Sparkles size={16} className="text-ai" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground mb-0.5">
                {t("controlPanel.aiCta.title")}
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                {t("controlPanel.aiCta.description")}
              </p>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onOpenSettings("intelligence")}
              >
                {t("controlPanel.aiCta.enable")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          {!dataRetentionEnabled && (
            <DataRetentionNotice
              className="mb-3"
              messageKey="controlPanel.history.dataRetentionDisabled"
            />
          )}
          <HistoryToolbar
            query={query}
            onQueryChange={setHomeQuery}
            filter={filter}
            onFilterChange={setHomeFilter}
            counts={feed.counts}
            inputRef={filterRef}
            menu={
              <HistoryMenu
                showDiscarded={showDiscarded}
                onToggleDiscarded={onToggleDiscarded}
                onClearAll={clearAllTranscriptions}
                hasHistory={history.length > 0}
              />
            }
          />
          {landingError?.nonce === focusNonce && (
            <div
              role="alert"
              className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-ui text-foreground"
            >
              <p>{t("home.history.loadFailed")}</p>
              <button
                type="button"
                onClick={landingError.retry}
                className="rounded-md border border-input-border px-3 py-1.5 text-ui font-semibold text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("common.retry")}
              </button>
            </div>
          )}
          {isLoading && history.length === 0 ? (
            <div className="rounded-2xl border border-border/70 bg-card/50 dark:border-white/10 dark:bg-surface-2/60">
              <div className="flex items-center justify-center gap-2 py-10">
                <Loader2 size={14} className="animate-spin text-link" />
                <span className="text-sm text-muted-foreground">{t("controlPanel.loading")}</span>
              </div>
            </div>
          ) : history.length === 0 && recentNotes.length === 0 ? (
            <>
              <p className="pt-2 pb-2.5 text-sm text-muted-foreground">
                {t("controlPanel.history.sectionTitle")}
              </p>
              <EmptyStateCard
                icon={Mic}
                title={t("controlPanel.history.empty")}
                description={t("controlPanel.history.emptyDescription")}
              >
                {/* Ghost rows preview the list this card becomes. */}
                <div aria-hidden="true" className="mb-1 w-56 space-y-2">
                  {EMPTY_PREVIEW_WIDTHS.map((width) => (
                    <span
                      key={width}
                      className={cn(
                        "block h-2 rounded-full bg-foreground/6 dark:bg-white/8",
                        width
                      )}
                    />
                  ))}
                </div>
                <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-surface-3 px-3 text-xs font-medium text-foreground/70 dark:bg-surface-3">
                  {t("controlPanel.history.press")}
                  <span dir="ltr" className="inline-flex items-center gap-1">
                    {parseHotkeyList(hotkey).map((hk, index) => (
                      <Fragment key={hk}>
                        {index > 0 && <span className="text-muted-foreground">/</span>}
                        <kbd className="rounded-md bg-background px-1.5 py-px font-sans text-micro font-medium text-foreground/80 shadow-sm dark:bg-surface-2">
                          {formatHotkeyLabel(hk)}
                        </kbd>
                      </Fragment>
                    ))}
                  </span>
                  {t("controlPanel.history.toStart")}
                </span>
              </EmptyStateCard>
            </>
          ) : feed.rows === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <p className="text-ui text-foreground">
                {t("home.history.nothingMatches", { query: query.trim() })}
              </p>
              <button
                type="button"
                className="mt-2 text-ui text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setHomeQuery("");
                  setHomeFilter("all");
                }}
              >
                {t("home.history.clearFilter")}
              </button>
            </div>
          ) : (
            <div>
              {feed.groups.map((group, index) => (
                <div key={group.dayKey} className={index > 0 ? "mt-6" : ""}>
                  <div className="sticky -top-1 z-10 -mx-6 px-6 pt-2 pb-2.5 bg-background flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
                    <span>{formatDateGroup(new Date(group.at).toISOString(), t, locale)}</span>
                    {group.captures > 0 && (
                      <span>
                        {t("home.history.dayCount", { count: group.captures })} ·{" "}
                        {t("home.history.words", { count: group.words })}
                      </span>
                    )}
                  </div>
                  <div className="relative z-0 overflow-clip rounded-2xl border border-border/70 bg-card/50 divide-y divide-border/60 dark:border-white/10 dark:bg-surface-2/60">
                    {group.entries.map((entry) =>
                      entry.kind === "dictation" ? (
                        <TranscriptionItem
                          key={
                            ring?.id === entry.item.id ? `${entry.key}-${ring.nonce}` : entry.key
                          }
                          item={entry.item}
                          words={entry.words}
                          focused={ring?.id === entry.item.id}
                          {...rowHandlers}
                        />
                      ) : entry.kind === "session" ? (
                        <SessionRow
                          key={entry.key}
                          entry={entry}
                          expanded={expanded.has(entry.key)}
                          onToggle={() => toggleSession(entry.key)}
                        >
                          {entry.items.map((item) => (
                            <TranscriptionItem
                              nested
                              key={ring?.id === item.id ? `${item.id}-${ring.nonce}` : item.id}
                              item={item}
                              words={countWords(item.text)}
                              focused={ring?.id === item.id}
                              {...rowHandlers}
                            />
                          ))}
                        </SessionRow>
                      ) : (
                        <NoteFeedRow key={entry.key} entry={entry} onOpen={navigation.openNote} />
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="hidden w-80 shrink-0 @min-[960px]:block">
          <UpcomingMeetings
            events={events}
            isLoading={eventsLoading}
            isConnected={isConnected}
            onConnectCalendar={onOpenIntegrations}
          />
        </div>
      </div>
    </div>
  );
}
