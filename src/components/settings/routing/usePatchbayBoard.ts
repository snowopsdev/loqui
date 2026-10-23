import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ResolvedRoute,
  RouteCopy,
  RouteId,
  RouteSettingsSnapshot,
} from "../../../lib/routeGraph.ts";
import type { RouteChangeOutcome, RouteRequestResult } from "../../../stores/routeDraftStore.ts";
import type { RouteTarget } from "../../../lib/routePlanner.ts";
import {
  buildDestinations,
  checkCompatibility,
  compatContext,
  compatReason,
  destinationKeyOf,
  destinationKeyState,
  destinationLabel,
  destinationPlace,
  routePlace,
  targetForDestination,
  taskKind,
  type Compatibility,
  type KeyState,
  type RouteDestination,
} from "./destinations.ts";
import { sealedFailureMessage } from "../../../utils/sealedModeError.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface PatchbayBoardDeps {
  routes: ResolvedRoute[];
  snapshot: RouteSettingsSnapshot;
  sealed: boolean;
  providersFor: (id: RouteId) => readonly string[];
  request: (id: RouteId, target: RouteTarget) => Promise<RouteRequestResult>;
  copy: RouteCopy;
  t: Translate;
}

export interface PatchbayBoard {
  destinations: RouteDestination[];
  selectedId: RouteId | null;
  message: string | null;
  undo: (() => Promise<void>) | null;
  compatOf: (dest: RouteDestination) => Compatibility | null;
  keyStateOf: (dest: RouteDestination) => KeyState | null;
  selectTask: (id: RouteId) => void;
  pickDestination: (dest: RouteDestination) => Promise<void>;
  clearSelection: () => boolean;
}

export function usePatchbayBoard(deps: PatchbayBoardDeps): PatchbayBoard {
  const { routes, snapshot, sealed, providersFor, request, copy, t } = deps;
  const [selectedId, setSelectedId] = useState<RouteId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undo, setUndo] = useState<(() => Promise<void>) | null>(null);
  const busy = useRef(false);

  const destinations = useMemo(() => buildDestinations(snapshot, routes), [snapshot, routes]);
  const ctx = useMemo(
    () => compatContext(snapshot, sealed, providersFor),
    [snapshot, sealed, providersFor]
  );
  const selected = routes.find((r) => r.id === selectedId) ?? null;
  const taskName = (id: RouteId) => t(`routes.names.${id}`);

  const compatOf = (dest: RouteDestination) =>
    selected ? checkCompatibility(selected.id, dest, ctx) : null;
  const keyStateOf = (dest: RouteDestination) =>
    selected ? destinationKeyState(dest, snapshot.facts, taskKind(selected.id)) : null;

  const selectTask = useCallback(
    (id: RouteId) => {
      const route = routes.find((r) => r.id === id);
      if (!route) return;
      setUndo(null);
      if (route.kind === "support") {
        setSelectedId(null);
        setMessage(t(`patchbay.locked.${id}`));
        return;
      }
      setMessage(null);
      setSelectedId((current) => (current === id ? null : id));
    },
    [routes, t]
  );

  const clearSelection = useCallback((): boolean => {
    if (selectedId === null) return false;
    setSelectedId(null);
    setMessage(null);
    return true;
  }, [selectedId]);

  const runUndo = async (
    fn: () => Promise<RouteChangeOutcome | "staged" | "superseded" | "save-failed">,
    task: string
  ) => {
    setUndo(null);
    const result = await fn();
    if (result === "superseded") return;
    if (result === "save-failed") {
      setMessage(t("common.error"));
      return;
    }
    if (result === "staged") setMessage(t("patchbay.hint.undoStaged"));
    else
      setMessage(
        result.applied ? t("patchbay.hint.undone", { task }) : t("patchbay.hint.notApplied")
      );
  };

  const announce = (route: ResolvedRoute, dest: RouteDestination, outcome: RouteChangeOutcome) => {
    const task = taskName(route.id);
    if (outcome.plan.kind === "noop") {
      setMessage(t("patchbay.hint.already", { task, place: destinationPlace(dest, t) }));
      return;
    }
    if (!outcome.applied) {
      setMessage(t("patchbay.hint.notApplied"));
      return;
    }
    const own = outcome.plan.changes.find((c) => c.id === route.id);
    const place = own ? routePlace(own.after, t) : destinationPlace(dest, t);
    let text =
      route.state.status === "off"
        ? t("patchbay.hint.movedOff", { task, place })
        : t("patchbay.hint.moved", { task, place });
    const coupled = outcome.plan.changes.filter((c) => c.coupled);
    if (coupled.length > 0) {
      text += ` ${t("patchbay.hint.movedAlso", { tasks: copy.list(coupled.map((c) => taskName(c.id))) })}`;
    }
    setMessage(text);
    const undoFn = outcome.undo;
    if (undoFn) setUndo(() => () => runUndo(undoFn, task));
  };

  const pickDestination = useCallback(
    async (dest: RouteDestination) => {
      if (busy.current) return;
      if (!selected) {
        setMessage(t("patchbay.hint.pickTaskFirst"));
        return;
      }
      const compat = checkCompatibility(selected.id, dest, ctx);
      if (compat.ok === false) {
        setMessage(compatReason(compat, t));
        return;
      }
      const task = taskName(selected.id);
      busy.current = true;
      setUndo(null);
      try {
        const outcome = await request(selected.id, targetForDestination(selected.id, dest));
        setSelectedId(null);
        // Settings closed, Discard ran, or a newer request or an Undo on this route won
        // while this one waited (R2-8):
        // nothing was staged or committed, so say nothing.
        if (outcome === "superseded") return;
        if (outcome === "save-failed") {
          setMessage(t("common.error"));
          return;
        }
        if (outcome === "staged") {
          setMessage(t("patchbay.hint.staged", { task, destination: destinationLabel(dest, t) }));
        } else if (
          outcome.plan.kind === "noop" &&
          selected.state.status === "off" &&
          destinationKeyOf(selected) === dest.id
        ) {
          setMessage(t("patchbay.hint.off", { task }));
        } else {
          announce(selected, dest, outcome);
        }
      } catch (error) {
        setMessage(
          sealedFailureMessage(error, t) ??
            t("patchbay.hint.failed", { error: (error as Error).message })
        );
      } finally {
        busy.current = false;
      }
    },
    // announce/runUndo only close over t, copy and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, ctx, request, t, copy]
  );

  return {
    destinations,
    selectedId,
    message,
    undo,
    compatOf,
    keyStateOf,
    selectTask,
    pickDestination,
    clearSelection,
  };
}
