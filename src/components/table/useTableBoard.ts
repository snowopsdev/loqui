import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { TableBoardData, TableEntityRef, TablePlacement } from "../../types/table";
import type { Viewport } from "./tableGeometry";
import { parseEntityHref } from "./tableEdges";
import {
  cardsFor,
  initialTableState,
  parseRefKey,
  refKey,
  deriveEdges,
  tableReducer,
  type TableAction,
  type TableState,
} from "./tableModel";

const VIEWPORT_SAVE_MS = 400;
const LIFECYCLE_RELOAD_MS = 250;
type BoardAction =
  | Exclude<TableAction, { type: "loaded" }>
  | { type: "loaded"; board: TableBoardData; preserveViewport?: boolean }
  | { type: "reset" }
  | { type: "settled"; keys: string[]; sizeKeys: string[]; accepted: TablePlacement[] };
function reduce(state: TableState, action: BoardAction): TableState {
  if (action.type === "reset") return initialTableState();
  if (action.type === "settled") {
    const next = tableReducer(state, { type: "placed", placements: action.accepted });
    const present = new Set(next.board?.cards.map((e) => refKey(e.ref)));
    const overrides = Object.fromEntries(
      Object.entries(state.overrides).filter(([key]) => present.has(key))
    );
    for (const key of action.keys) delete overrides[key];
    const sizes = Object.fromEntries(
      Object.entries(state.sizes).filter(([key]) => present.has(key))
    );
    for (const key of action.sizeKeys) delete sizes[key];
    return { ...next, overrides, sizes };
  }
  const next = tableReducer(state, action);
  // A lifecycle read may finish between pointer frames. Keep the gesture preview
  // for retained entities; a drop settles only its own keys before reconciliation.
  if (action.type !== "loaded") return next;
  const present = new Set(action.board.cards.map((e) => refKey(e.ref)));
  return {
    ...next,
    viewport: action.preserveViewport ? state.viewport : next.viewport,
    overrides: Object.fromEntries(Object.entries(state.overrides).filter(([k]) => present.has(k))),
    sizes: Object.fromEntries(Object.entries(state.sizes).filter(([k]) => present.has(k))),
  };
}

/** ACKs describe mutations; main's read describes the canonical, capped projection. */
export function useTableBoard(spaceId: number) {
  const [state, reduceDispatch] = useReducer(reduce, undefined, initialTableState);
  const moves = useRef<Record<string, number>>({});
  const resizes = useRef<Record<string, number>>({});
  const placementWrites = useRef<Record<string, number>>({});
  const dispatch = useCallback((action: TableAction) => {
    if (action.type === "moved")
      for (const key of Object.keys(action.positions))
        moves.current[key] = (moves.current[key] ?? 0) + 1;
    if (action.type === "resized" || action.type === "sizeRestored")
      resizes.current[action.key] = (resizes.current[action.key] ?? 0) + 1;
    reduceDispatch(action);
  }, []);
  const [status, setStatus] = useState<"idle" | "full" | "saveFailed">("idle");
  const owner = useRef({ spaceId, generation: 0, mounted: true, read: 0, viewport: 0 });
  if (owner.current.spaceId !== spaceId) {
    owner.current = {
      spaceId,
      generation: owner.current.generation + 1,
      mounted: true,
      read: 0,
      viewport: 0,
    };
    reduceDispatch({ type: "reset" });
    moves.current = {};
    resizes.current = {};
    placementWrites.current = {};
    setStatus("idle");
  }
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useCallback(
    async (viewportRevision?: number) => {
      const scope = owner.current;
      if (scope.spaceId !== spaceId || !scope.mounted) return;
      const request = ++scope.read;
      const current = () => owner.current === scope && scope.mounted && scope.read === request;
      try {
        const board = await window.electronAPI?.getTableBoard?.(spaceId);
        if (!current()) return;
        if (!board || board.spaceId !== spaceId) {
          setStatus("saveFailed");
          return;
        }
        // A first read may outlive navigation on an otherwise empty board.
        // Only an untouched scope may restore the stored viewport.
        reduceDispatch({ type: "loaded", board, preserveViewport: scope.viewport !== 0 });
        if (viewportRevision !== undefined && scope.viewport === viewportRevision)
          dispatch({ type: "viewport", viewport: board.viewport ?? { x: 0, y: 0, scale: 1 } });
      } catch {
        if (current()) setStatus("saveFailed");
      }
    },
    [spaceId, dispatch]
  );

  useEffect(() => {
    const scope = owner.current;
    scope.mounted = true;
    void reload();
    return () => {
      scope.mounted = false;
      scope.read++;
      if (viewportTimer.current !== null) clearTimeout(viewportTimer.current);
      viewportTimer.current = null;
    };
  }, [reload]);

  useEffect(() => {
    const api = window.electronAPI;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), LIFECYCLE_RELOAD_MS);
    };
    const offs = [
      api?.onNoteAdded?.(soon),
      api?.onNoteUpdated?.(soon),
      api?.onNoteDeleted?.(soon),
      api?.onTranscriptionAdded?.(soon),
      api?.onTranscriptionUpdated?.(soon),
      api?.onTranscriptionDeleted?.(soon),
      api?.onTranscriptionsCleared?.(soon),
      api?.onAgentConversationDeleted?.(soon),
      api?.onAgentConversationArchived?.(soon),
    ];
    return () => {
      clearTimeout(timer);
      offs.forEach((off) => off?.());
    };
  }, [reload]);

  const place = useCallback(
    async (placements: TablePlacement[]) => {
      if (!placements.length) return true;
      const scope = owner.current;
      if (scope.spaceId === spaceId) scope.read++; // A read started before this transaction cannot undo its ACK.
      const preview = { ...moves.current };
      const sizePreview = { ...resizes.current };
      const writeVersions = new Map<string, number>();
      if (scope.spaceId === spaceId) {
        for (const placement of placements) {
          const key = refKey(placement);
          const revision = (placementWrites.current[key] ?? 0) + 1;
          placementWrites.current[key] = revision;
          writeVersions.set(key, revision);
        }
      }
      let acceptedPlacements: TablePlacement[] = [];
      let ok = false;
      let nextStatus: typeof status = "saveFailed";
      try {
        const result = await window.electronAPI?.placeTableCards?.(spaceId, placements);
        if (result?.success) {
          const accepted = new Set(result.placedKeys);
          acceptedPlacements = placements.filter((p) => accepted.has(refKey(p)));
          ok =
            result.placed === placements.length && placements.every((p) => accepted.has(refKey(p)));
          nextStatus = ok ? "idle" : "saveFailed";
        } else if (result && "code" in result && result.code === "TABLE_FULL") nextStatus = "full";
      } catch {
        /* Refusal and bridge failure both preserve underlying content. */
      }
      if (owner.current === scope && scope.mounted && scope.spaceId === spaceId) {
        // An old ACK must not replay geometry after a newer write has already
        // settled its preview. Nonoverlapping keys in a batch keep their owner.
        const ownsWrite = (key: string) => placementWrites.current[key] === writeVersions.get(key);
        reduceDispatch({
          type: "settled",
          sizeKeys: placements
            .map(refKey)
            .filter((key) => ownsWrite(key) && resizes.current[key] === sizePreview[key]),
          accepted: acceptedPlacements.filter((p) => ownsWrite(refKey(p))),
          keys: placements
            .map(refKey)
            .filter((key) => ownsWrite(key) && moves.current[key] === preview[key]),
        });
        setStatus(nextStatus);
        await reload(); // Also on all-ACK: new entities may displace automatic notes.
      }
      return ok;
    },
    [reload, spaceId]
  );

  const hide = useCallback(
    async (keys: string[]) => {
      const refs = keys.map(parseRefKey).filter((ref): ref is TableEntityRef => ref !== null);
      if (!refs.length) return;
      const scope = owner.current;
      if (scope.spaceId === spaceId) scope.read++;
      let ok = false;
      try {
        const result = await window.electronAPI?.hideTableCards?.(spaceId, refs);
        ok = result?.success === true && result.hidden === refs.length;
      } catch {
        /* Reload partial writes too. Never delete the original content. */
      }
      if (owner.current === scope && scope.mounted && scope.spaceId === spaceId) {
        setStatus(ok ? "idle" : "saveFailed");
        await reload();
      }
    },
    [reload, spaceId]
  );

  const link = useCallback(
    async (a: TableEntityRef, b: TableEntityRef): Promise<boolean> => {
      const scope = owner.current;
      if (scope.spaceId === spaceId) scope.read++;
      let ok = false;
      try {
        ok = (await window.electronAPI?.linkTableCards?.(spaceId, a, b))?.success === true;
      } catch {
        /* ACK failure */
      }
      if (owner.current === scope && scope.mounted && scope.spaceId === spaceId) {
        setStatus(ok ? "idle" : "saveFailed");
        await reload();
      }
      return ok;
    },
    [reload, spaceId]
  );

  const setViewport = useCallback(
    (viewport: Viewport, persist: boolean) => {
      const scope = owner.current;
      if (scope.spaceId !== spaceId || !scope.mounted) return;
      const revision = ++scope.viewport;
      dispatch({ type: "viewport", viewport });
      // A new preview invalidates a pending save of an older view.
      if (viewportTimer.current !== null) clearTimeout(viewportTimer.current);
      viewportTimer.current = null;
      if (!persist) return;
      viewportTimer.current = setTimeout(() => {
        viewportTimer.current = null;
        void (async () => {
          scope.read++;
          let ok = false;
          try {
            ok =
              (await window.electronAPI?.setTableViewport?.(spaceId, viewport))?.success === true;
          } catch {
            /* ACK failure */
          }
          if (owner.current === scope && scope.mounted && scope.spaceId === spaceId) {
            setStatus(ok ? "idle" : "saveFailed");
            await reload(revision);
          }
        })();
      }, VIEWPORT_SAVE_MS);
    },
    [reload, spaceId, dispatch]
  );
  // Chrome-only changes do not change card content or geometry. Preserve the
  // projection so viewport frames can reuse memoized card subtrees.
  const { board, measured, overrides, sizes } = state;
  const cards = useMemo(
    () => cardsFor({ board, measured, overrides, sizes }),
    [board, measured, overrides, sizes]
  );
  const edges = useMemo(
    () => deriveEdges(cards, state.board?.links ?? [], parseEntityHref),
    [cards, state.board?.links]
  );
  return { state, cards, edges, dispatch, reload, place, hide, link, setViewport, status };
}
