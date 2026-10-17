import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  routeSnapshotFromSettings,
  useResolvedRoutes,
  useRouteCopy,
  type ResolvedRoute,
  type RouteId,
} from "../../../lib/routes";
import { requestRouteChange, useRouteDraftStore } from "../../../stores/routeDraftStore";
import { ensureSealedSubscribed, useSealedStore } from "../../../stores/sealedStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { ChevronRight, Lock } from "../../icons";
import { Button } from "../../ui/button";
import { LocalityRing } from "../../ui/LocalityRing";
import { RouteDestinationChip, RouteStateChip } from "./RouteChips";
import {
  cablePath,
  compatReason,
  destinationKeyOf,
  destinationLabel,
  privacyTally,
  routeDestinationLabel,
  type Compatibility,
  type KeyState,
  type RouteDestination,
} from "./destinations";
import { providersForRoute } from "./providerCatalog";
import { usePatchbayBoard } from "./usePatchbayBoard";

export interface PatchbayCable {
  id: RouteId;
  d: string;
  locality: string;
  paused: boolean;
}

export interface PatchbayViewProps {
  routes: ResolvedRoute[];
  destinations: RouteDestination[];
  destinationOf: (route: ResolvedRoute) => string | null;
  compatOf: (dest: RouteDestination) => Compatibility | null;
  keyStateOf: (dest: RouteDestination) => KeyState | null;
  selectedId: RouteId | null;
  stagedRouteId: RouteId | null;
  sealed: boolean;
  message: string | null;
  onUndo: (() => void) | null;
  wide: boolean;
  cables?: PatchbayCable[];
  boardRef?: React.Ref<HTMLDivElement>;
  registerJack?: (key: string) => React.Ref<HTMLSpanElement>;
  onSelectTask: (id: RouteId) => void;
  onPickDestination: (dest: RouteDestination) => void;
  onOpenSettings: (route: ResolvedRoute) => void;
  onEscape?: () => boolean;
}

const GROUPS = ["speech", "text", "support"] as const;

export function PatchbayView(props: PatchbayViewProps) {
  const { t } = useTranslation();
  const { routes, destinations, selectedId, wide } = props;
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const tally = privacyTally(routes);
  const leaving = routes.filter((r) => r.sends !== null);
  const byId = new Map(destinations.map((d) => [d.id, d]));

  return (
    <div
      className="space-y-3"
      data-escape-active={selectedId ? "true" : "false"}
      onKeyDown={(e) => {
        if (e.key === "Escape" && props.onEscape?.()) e.stopPropagation();
      }}
    >
      {props.sealed && <p className="text-xs text-muted-foreground">{t("patchbay.sealed")}</p>}
      <div className="flex min-h-7 items-center gap-2">
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {props.message ??
            (selected
              ? t("patchbay.hint.pickDestination", { task: t(`routes.names.${selected.id}`) })
              : t("patchbay.hint.idle"))}
        </p>
        {props.onUndo && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-action="undo-route"
            onClick={props.onUndo}
          >
            {t("patchbay.undo")}
          </Button>
        )}
      </div>
      <div
        ref={props.boardRef}
        data-layout={wide ? "board" : "list"}
        className="patchbay-board relative"
      >
        {wide && (
          <svg aria-hidden="true" className="patchbay-cables">
            {(props.cables ?? []).map((c) => (
              <path
                key={c.id}
                d={c.d}
                data-locality={c.locality}
                data-paused={c.paused ? "true" : "false"}
                data-dim={selectedId && selectedId !== c.id ? "true" : "false"}
              />
            ))}
          </svg>
        )}
        <div role="group" aria-label={t("patchbay.tasks")} className="patchbay-tasks">
          {GROUPS.map((group) => (
            <div key={group} className="space-y-1">
              <p className="px-1 text-[11px] font-semibold text-muted-foreground">
                {t(`routes.groups.${group}`)}
              </p>
              {routes
                .filter((r) => r.kind === group)
                .map((route) => {
                  const locked = route.kind === "support";
                  return (
                    <div
                      key={route.id}
                      data-setting-id={`route-${route.id}`}
                      className="flex items-center gap-1"
                    >
                      <button
                        type="button"
                        data-task={route.id}
                        aria-pressed={selectedId === route.id}
                        aria-disabled={locked || undefined}
                        title={locked ? t(`patchbay.locked.${route.id}`) : undefined}
                        onClick={() => props.onSelectTask(route.id)}
                        data-staged={props.stagedRouteId === route.id ? "true" : "false"}
                        className="patchbay-task"
                      >
                        <span className="min-w-0 flex-1 text-start">
                          <span className="block truncate text-xs font-semibold text-foreground">
                            {t(`routes.names.${route.id}`)}
                          </span>
                          <RouteDestinationChip route={route} className="h-5" />
                        </span>
                        {locked ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            <span className="sr-only">{t(`patchbay.locked.${route.id}`)}</span>
                          </span>
                        ) : (
                          <RouteStateChip state={route.state} />
                        )}
                        <span
                          ref={props.registerJack?.(`task:${route.id}`)}
                          className="patchbay-jack"
                          data-locality={route.locality}
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onOpenSettings(route)}
                        aria-label={t("patchbay.openSettings", {
                          task: t(`routes.names.${route.id}`),
                        })}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
        <div role="group" aria-label={t("patchbay.destinations")} className="patchbay-destinations">
          {destinations.map((dest) => {
            const compat = props.compatOf(dest);
            const refused = compat !== null && compat.ok === false;
            const reason = compat !== null && compat.ok === false ? compatReason(compat, t) : null;
            const count = routes.filter(
              (r) => r.state.status !== "off" && props.destinationOf(r) === dest.id
            ).length;
            const name = destinationLabel(dest, t);
            const keyState = props.keyStateOf(dest);
            const http = [dest.urls.speech, dest.urls.text].some((u) => u?.startsWith("http:"));
            return (
              <button
                key={dest.id}
                type="button"
                data-destination={dest.id}
                data-compat={compat ? (compat.ok ? "ok" : "no") : undefined}
                aria-disabled={refused || undefined}
                title={reason ?? undefined}
                data-locality={dest.locality}
                onClick={() => props.onPickDestination(dest)}
                className="patchbay-destination"
              >
                <span
                  ref={props.registerJack?.(`dest:${dest.id}`)}
                  className="patchbay-jack"
                  data-locality={dest.locality}
                  aria-hidden="true"
                />
                <span className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                    <LocalityRing
                      locality={dest.locality}
                      label={
                        dest.locality === "remote" ? t("locality.remote", { provider: name }) : name
                      }
                      provider={dest.locality === "remote" ? name : null}
                      size={16}
                    />
                    <span className="truncate">{name}</span>
                  </span>
                  {dest.kind !== "addServer" && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t("patchbay.taskCount", { count })}
                    </span>
                  )}
                </span>
                {dest.host && (
                  <span
                    className="block truncate font-mono text-[11px] text-muted-foreground"
                    dir="ltr"
                  >
                    {dest.host}
                  </span>
                )}
                <span className="block text-[11px] text-muted-foreground">
                  {dest.kind === "device"
                    ? t("patchbay.dest.nothingLeaves")
                    : dest.kind === "addServer"
                      ? t("patchbay.dest.addServerHint")
                      : dest.kind === "server"
                        ? http
                          ? t("patchbay.dest.unencrypted")
                          : t("patchbay.dest.yourServer")
                        : dest.kind === "custom"
                          ? http
                            ? t("patchbay.dest.unencrypted")
                            : t("patchbay.dest.hosted")
                          : keyState === "saved"
                            ? t("patchbay.dest.keySaved")
                            : keyState === "missing"
                              ? t("patchbay.dest.noKey")
                              : keyState === "rejected"
                                ? t("patchbay.dest.keyRejected")
                                : keyState === "unknown"
                                  ? t("patchbay.dest.keyUnknown")
                                  : t("patchbay.dest.hosted")}
                </span>
                {reason && <span className="sr-only">{reason}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 sm:grid-cols-[minmax(240px,1fr)_1.4fr]">
        <div>
          <div
            role="img"
            aria-label={t("patchbay.meter.label", { count: tally.stay, total: tally.total })}
            className="flex gap-1"
          >
            {routes.map((r) => (
              <span
                key={r.id}
                className="patchbay-meter-seg"
                data-locality={r.sends === null ? "device" : r.locality}
              />
            ))}
          </div>
          <p className="mt-2 text-xs">
            {t("patchbay.meter.headline", { count: tally.stay, total: tally.total })}
            {tally.network > 0 && ` · ${t("patchbay.meter.network", { count: tally.network })}`}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {leaving.length === 0
            ? t("patchbay.leaves.none")
            : `${t("patchbay.leaves.prefix")} ${leaving
                .map((r) => {
                  const key = props.destinationOf(r);
                  const dest = key ? byId.get(key) : undefined;
                  return t("patchbay.leaves.item", {
                    task: t(`routes.names.${r.id}`),
                    destination: dest ? destinationLabel(dest, t) : routeDestinationLabel(r, t),
                  });
                })
                .join(" · ")}`}
        </p>
      </div>
    </div>
  );
}

export function Patchbay({ onNavigateToPath }: { onNavigateToPath?: (path: string) => void }) {
  const { t } = useTranslation();
  const routes = useResolvedRoutes();
  // Task 3's hook: memoised on t and the language, so `request` stays stable between renders.
  const copy = useRouteCopy();
  const sealed = useSealedStore((s) => s.sealed);
  const draft = useRouteDraftStore((s) => s.draft);
  const [wide, setWide] = useState(true);
  const [cables, setCables] = useState<PatchbayCable[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const jacks = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    ensureSealedSubscribed();
  }, []);

  // `routes` is rebuilt whenever settings, facts, sealed state or language
  // change, so the snapshot used for destinations is rebuilt with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useMemo(() => routeSnapshotFromSettings(useSettingsStore.getState()), [routes]);
  const request = useCallback(
    (id: RouteId, target: Parameters<typeof requestRouteChange>[1]) =>
      requestRouteChange(id, target, copy),
    [copy]
  );
  const board = usePatchbayBoard({
    routes,
    snapshot,
    sealed,
    providersFor: providersForRoute,
    request,
    copy,
    t,
  });

  const registerJack = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) jacks.current.set(key, el);
      else jacks.current.delete(key);
    },
    []
  );

  const measure = useCallback(() => {
    const el = boardRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setWide(box.width >= 720);
    const centre = (key: string) => {
      const jack = jacks.current.get(key);
      if (!jack) return null;
      const r = jack.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    };
    const rtl = getComputedStyle(el).direction === "rtl";
    const next: PatchbayCable[] = [];
    for (const route of routes) {
      // A drafted route has no cable until Apply; an off route sends nothing.
      if (route.state.status === "off" || draft?.routeId === route.id) continue;
      const destId = destinationKeyOf(route);
      if (destId === null) continue;
      const from = centre(`task:${route.id}`);
      const to = centre(`dest:${destId}`);
      if (!from || !to) continue;
      const [a, b] = rtl ? [to, from] : [from, to];
      next.push({
        id: route.id,
        d: cablePath(a, b),
        locality: route.locality,
        paused: route.state.status !== "ready",
      });
    }
    setCables(next);
  }, [routes, draft]);

  useLayoutEffect(() => {
    measure();
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, board.destinations]);

  return (
    <PatchbayView
      routes={routes}
      destinations={board.destinations}
      destinationOf={destinationKeyOf}
      compatOf={board.compatOf}
      keyStateOf={board.keyStateOf}
      selectedId={board.selectedId}
      stagedRouteId={draft?.routeId ?? null}
      sealed={sealed}
      message={board.message}
      onUndo={board.undo}
      wide={wide}
      cables={cables}
      boardRef={boardRef}
      registerJack={registerJack}
      onSelectTask={board.selectTask}
      onPickDestination={(dest) => void board.pickDestination(dest)}
      onOpenSettings={(route) => onNavigateToPath?.(route.settingsPath)}
      onEscape={board.clearSelection}
    />
  );
}
