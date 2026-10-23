import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { providerDisplayLabel } from "../../../lib/locality";
import type { ResolvedRoute, RouteState } from "../../../lib/routeGraph";
import { formatDecimalBytes } from "../../../utils/formatBytes";
import { cn } from "../../lib/utils";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  KeyRound,
  Lock,
  Minus,
  Server,
  WifiOff,
} from "../../icons";
import { LocalityRing } from "../../ui/LocalityRing";

// Route chips (DESIGN.md "Settings · Routing"): a state is always glyph plus
// words, and colour is a third, redundant cue. Chip text uses foreground,
// muted-foreground or the device role only; destructive hue lives on the glyph.

// eslint-disable-next-line react-refresh/only-export-components -- pure label helper shared with route review surfaces
export function routeStateLabel(
  state: RouteState,
  t: TFunction | ((key: string, options?: object) => string)
): string {
  switch (state.status) {
    case "ready":
      return t("routes.state.ready");
    case "off":
      return t("routes.state.off");
    case "unknown":
      return t("routes.state.checking");
    case "needsModel":
      return state.sizeBytes
        ? t("routes.state.download", { size: formatDecimalBytes(state.sizeBytes) })
        : t("routes.state.chooseModel");
    case "needsKey":
      return state.provider ? t("routes.state.addKey") : t("routes.state.chooseProvider");
    case "needsUrl":
      return t("routes.state.addUrl");
    case "unreachable":
      if (state.detail === "sealed") return t("routes.state.sealed");
      if (state.detail === "nativeUnavailable") return t("routes.state.nativeUnavailable");
      if (state.detail === "retired") return t("routes.state.retired");
      if (state.detail === "unsupported") return t("routes.state.unsupported");
      return t("routes.state.cantReach");
  }
}

const TEXT_STYLE: Record<RouteState["status"], string> = {
  ready: "text-locality-device",
  off: "text-muted-foreground",
  unknown: "text-muted-foreground",
  needsModel: "text-foreground",
  needsKey: "text-foreground",
  needsUrl: "text-foreground",
  unreachable: "text-foreground",
};

function glyphStyle(state: RouteState): string {
  switch (state.status) {
    case "ready":
      return "text-locality-device";
    case "off":
    case "unknown":
      return "text-muted-foreground";
    case "needsModel":
      return "text-foreground";
    case "needsKey":
    case "needsUrl":
      return "text-destructive";
    case "unreachable":
      // Sealed mode's own outcomes are settled facts, not faults to fix.
      return state.detail === "sealed" || state.detail === "nativeUnavailable"
        ? "text-muted-foreground"
        : "text-destructive";
  }
}

function StateGlyph({ state }: { state: RouteState }) {
  const cls = cn("h-3 w-3 shrink-0", glyphStyle(state));
  switch (state.status) {
    case "ready":
      return <CircleCheck className={cls} aria-hidden="true" />;
    case "off":
      return <Minus className={cls} aria-hidden="true" />;
    case "unknown":
      return <Clock className={cls} aria-hidden="true" />;
    case "needsModel":
      return <Download className={cls} aria-hidden="true" />;
    case "needsKey":
      return <KeyRound className={cls} aria-hidden="true" />;
    case "needsUrl":
      return <Server className={cls} aria-hidden="true" />;
    case "unreachable":
      if (state.detail === "sealed" || state.detail === "nativeUnavailable")
        return <Lock className={cls} aria-hidden="true" />;
      if (state.detail === "retired" || state.detail === "unsupported")
        return <CircleAlert className={cls} aria-hidden="true" />;
      return <WifiOff className={cls} aria-hidden="true" />;
  }
}

export function RouteStateChip({ state, className }: { state: RouteState; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      data-state={state.status}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium tabular-nums",
        TEXT_STYLE[state.status],
        className
      )}
    >
      <StateGlyph state={state} />
      {routeStateLabel(state, t)}
    </span>
  );
}

export function RouteDestinationChip({
  route,
  className,
}: {
  route: Pick<ResolvedRoute, "locality" | "providerId" | "model">;
  className?: string;
}) {
  const { t } = useTranslation();
  const providerName = route.providerId ? providerDisplayLabel(route.providerId, t) : null;
  const place =
    route.locality === "remote"
      ? (providerName ?? t("routes.place.chooseProvider"))
      : t(`locality.${route.locality}`);
  const ringLabel =
    route.locality === "remote"
      ? t("locality.remote", { provider: providerName ?? "" })
      : t(`locality.${route.locality}`);
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-0 max-w-[260px] items-center gap-1.5 text-xs font-medium text-foreground",
        className
      )}
    >
      <LocalityRing locality={route.locality} label={ringLabel} provider={providerName} size={16} />
      <span className="truncate" dir="auto">
        {route.model ? `${place} · ${route.model}` : place}
      </span>
    </span>
  );
}
