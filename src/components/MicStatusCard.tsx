import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { CircleAlert, Clock } from "./icons";
import { RouteDestinationChip, RouteStateChip } from "./settings/routing/RouteChips";
import {
  captureHeadline,
  formatElapsed,
  railLevelStep,
  type CaptureHeadline,
  type CaptureRole,
  type CaptureStatus,
} from "../lib/captureStatus";
import type { ResolvedRoute } from "../lib/routes";

export interface MicStatusCardProps {
  status: CaptureStatus;
  now: number;
  hotkeyLabel: string;
  role: CaptureRole;
  route: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state"> | null;
  textRoute?: Pick<ResolvedRoute, "locality" | "providerId" | "model" | "state"> | null;
  compact: boolean;
  onOpenSettings: () => void;
}

type RouteLike = NonNullable<MicStatusCardProps["route"]>;

// One line per route: the role in words, then Plan 03's destination chip
// (ring, provider through providerDisplayLabel, model). A route that is not
// ready adds Plan 03's state chip; `unknown` reads "Checking…" and is never
// shown as ready (§5.1 rule 1).
function RouteLine({
  role,
  route,
  t,
}: {
  role: string;
  route: RouteLike;
  t: (k: string) => string;
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
      <span className="shrink-0 text-foreground">{t(`micCard.role.${role}`)}</span>
      <RouteDestinationChip route={route} className="h-5 min-w-0 max-w-full text-caption" />
      {route.state.status !== "ready" && (
        <RouteStateChip state={route.state} className="h-5 px-0 text-caption" />
      )}
    </span>
  );
}

const LABEL_KEY: Record<CaptureHeadline, string> = {
  ready: "micCard.ready",
  checking: "routes.state.checking",
  setUp: "micCard.setUp",
  listening: "micCard.listening",
  processing: "micCard.cleaningUp",
  offline: "micCard.offline",
};

// Static glyphs. The live meter belongs to the Capture button and the edge
// rail; Plan 01's motion rule allows at most two focal motions at once.
// Green is reserved for a ready route; Checking and Set up stay neutral.
export function CaptureGlyph({
  status,
  headline = status.kind,
}: {
  status: CaptureStatus;
  headline?: CaptureHeadline;
}) {
  if (headline === "checking")
    return <Clock size={12} aria-hidden className="shrink-0 text-muted-foreground" />;
  if (headline === "setUp")
    return <CircleAlert size={12} aria-hidden className="shrink-0 text-muted-foreground" />;
  if (status.kind === "listening")
    return <span aria-hidden className="size-2 shrink-0 rounded-full bg-link dark:bg-live" />;
  if (status.kind === "processing")
    return (
      <Loader2
        size={12}
        aria-hidden
        className="shrink-0 text-warning-foreground dark:text-warning"
      />
    );
  if (status.kind === "offline")
    return (
      <AlertTriangle
        size={12}
        aria-hidden
        className="shrink-0 text-warning-foreground dark:text-warning"
      />
    );
  return <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />;
}

export function MicStatusCard({
  status,
  now,
  hotkeyLabel,
  role,
  route,
  textRoute,
  compact,
  onOpenSettings,
}: MicStatusCardProps) {
  const { t } = useTranslation();
  const headline = captureHeadline(status, route?.state);
  const elapsed =
    status.kind === "listening" && status.startedAt != null
      ? formatElapsed(now - status.startedAt)
      : null;
  const label = elapsed ? t("micCard.listeningFor", { time: elapsed }) : t(LABEL_KEY[headline]);
  const detail =
    status.kind === "offline"
      ? t(status.offlineReason === "device" ? "micCard.offlineDevice" : "micCard.offlinePermission")
      : null;

  // Configured routes are not a verified snapshot of the frozen recipient.
  // Settings edits apply to the next capture, including a meeting with lost mic.
  const nextCapture =
    status.kind === "listening" ||
    status.kind === "processing" ||
    (status.kind === "offline" && status.source === "meeting");

  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        data-state={headline}
        data-compact="true"
        title={label}
        className="mx-auto flex size-10 items-center justify-center rounded-md hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CaptureGlyph status={status} headline={headline} />
        <span className="sr-only" role="status" aria-live="polite">
          {label}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      data-state={headline}
      data-elapsed={elapsed ?? undefined}
      className="mx-2 mb-1 flex w-[calc(100%-1rem)] min-w-0 flex-col gap-1 rounded-lg border border-border/70 bg-background/60 px-2.5 py-2 text-start hover:bg-background dark:border-white/10 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-2">
        <CaptureGlyph status={status} headline={headline} />
        <span
          role="status"
          aria-live="polite"
          className="flex-1 truncate text-ui tabular-nums text-foreground"
        >
          {label}
        </span>
        {headline === "ready" && (
          <kbd dir="ltr" className="rounded-md bg-surface-3 px-1.5 text-micro text-foreground">
            {hotkeyLabel}
          </kbd>
        )}
      </span>
      {detail && <span className="text-caption text-muted-foreground">{detail}</span>}
      {(route || (textRoute && (role === "assistant" || role === "translation"))) && (
        <span className="flex min-w-0 flex-col gap-1">
          {nextCapture && (
            <span className="text-caption text-foreground">{t("micCard.nextCapture")}</span>
          )}
          {route && (
            <RouteLine role={role === "meeting" ? "meeting" : "dictation"} route={route} t={t} />
          )}
          {textRoute && (role === "assistant" || role === "translation") && (
            <RouteLine role={role} route={textRoute} t={t} />
          )}
        </span>
      )}
    </button>
  );
}

export interface CaptureRailProps {
  status: CaptureStatus;
  readLevel: () => number;
}

// WS-R3 C: a 2px rail on the sidebar's inline-end edge. The level reaches
// CSS through --capture-level at 15 Hz, and only while listening.
export function CaptureRail({ status, readLevel }: CaptureRailProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || status.kind !== "listening") return;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let id: number | undefined;
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
      el.style.removeProperty("--capture-level");
    };
    const syncMotion = () => {
      stop();
      if (media?.matches) return;
      let level = 0;
      id = window.setInterval(() => {
        level = railLevelStep(level, readLevel());
        el.style.setProperty("--capture-level", String(level));
      }, 66);
    };
    syncMotion();
    media?.addEventListener("change", syncMotion);
    return () => {
      stop();
      media?.removeEventListener("change", syncMotion);
    };
  }, [status.kind, readLevel]);
  return <div ref={ref} className="capture-rail" data-state={status.kind} aria-hidden="true" />;
}
