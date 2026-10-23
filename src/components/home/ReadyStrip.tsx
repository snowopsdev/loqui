import { Trans, useTranslation } from "react-i18next";
import { CaptureGlyph } from "../MicStatusCard";
import { RouteStateChip } from "../settings/routing/RouteChips";
import { cn } from "../lib/utils";
import {
  captureHeadline,
  formatElapsed,
  type CaptureHeadline,
  type CaptureStatus,
} from "../../lib/captureStatus";
import type { RouteState } from "../../lib/routeGraph";
import type { EventStart } from "../../lib/upcomingEvents";

export interface ReadyStripProps {
  status: CaptureStatus;
  /** The dictationStt route: an idle mic reads Ready only while it is ready. */
  routeState: RouteState | null;
  onSetUp: () => void;
  now: number;
  hotkeyLabel: string;
  holdToTalk: boolean;
  next: { title: string; start: EventStart } | null;
  onTakeNotes: () => void;
}

const LABEL: Record<CaptureHeadline, string> = {
  ready: "home.ready.ready",
  checking: "routes.state.checking",
  setUp: "home.ready.setUp",
  listening: "home.ready.listening",
  processing: "home.ready.cleaningUp",
  offline: "home.ready.offline",
};

// WS-R2 A: "is it listening, what's next" in 44px. Status is glyph + word,
// never colour alone. The meeting chip shows only when the container is too
// narrow for the Coming up column (@container on HistoryView).
export function ReadyStrip({
  status,
  routeState,
  onSetUp,
  now,
  hotkeyLabel,
  holdToTalk,
  next,
  onTakeNotes,
}: ReadyStripProps) {
  const { t, i18n } = useTranslation();
  const headline = captureHeadline(status, routeState);
  const label =
    status.kind === "listening" && status.startedAt != null
      ? t("home.ready.listeningFor", { time: formatElapsed(now - status.startedAt) })
      : t(LABEL[headline]);
  const startLabel = next
    ? next.start.kind === "now"
      ? t("home.ready.nextNow", { title: next.title })
      : next.start.kind === "minutes"
        ? t("home.ready.nextIn", { title: next.title, count: next.start.minutes })
        : t("home.ready.nextAt", {
            title: next.title,
            time: next.start.at.toLocaleTimeString(i18n.language, {
              hour: "numeric",
              minute: "2-digit",
            }),
          })
    : null;

  return (
    <section
      aria-label={t("home.ready.region")}
      data-state={headline}
      className={cn(
        "mb-3 flex h-11 items-center gap-3 rounded-lg border px-3",
        status.kind === "listening" && "border-live/45 bg-live/8",
        (status.kind === "processing" || status.kind === "offline") &&
          "border-warning/40 bg-warning/8",
        status.kind === "ready" && "border-border bg-surface-1 dark:border-white/10"
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <CaptureGlyph status={status} headline={headline} />
        <span
          role="status"
          aria-live="polite"
          className="shrink-0 text-ui font-semibold tabular-nums text-foreground"
        >
          {headline === "setUp" ? (
            <button
              type="button"
              onClick={onSetUp}
              className="rounded-sm text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {label}
            </button>
          ) : (
            label
          )}
        </span>
        {headline === "setUp" && routeState && (
          <RouteStateChip
            state={routeState}
            className="hidden h-5 min-w-0 px-0 text-caption @min-[430px]:inline-flex"
          />
        )}
        {headline === "ready" && (
          <span className="hidden truncate text-caption text-muted-foreground @min-[430px]:inline">
            <Trans
              i18nKey={holdToTalk ? "home.ready.hold" : "home.ready.press"}
              values={{ key: hotkeyLabel }}
              components={{
                kbd: (
                  <kbd
                    dir="ltr"
                    className="rounded-md bg-background px-1.5 text-caption text-foreground shadow-sm"
                  />
                ),
              }}
            />
          </span>
        )}
      </span>
      {next && startLabel && (
        <span className="ms-auto flex min-w-0 max-w-[55%] shrink-0 items-center gap-2 @min-[960px]:hidden">
          <span dir="auto" className="truncate text-caption text-muted-foreground">
            {startLabel}
          </span>
          <button
            type="button"
            onClick={onTakeNotes}
            className="shrink-0 rounded-sm text-ui text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("home.ready.takeNotes")}
          </button>
        </span>
      )}
    </section>
  );
}
