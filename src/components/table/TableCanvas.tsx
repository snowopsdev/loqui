import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
  DragEvent as ReactDragEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_VIEWPORT,
  DOT_GRID,
  connectorPath,
  ensureVisible,
  lassoSelect,
  nearestInDirection,
  screenToWorld,
  visibleIds,
  zoomAt,
  type Point,
  type Rect,
  type Size,
  type Viewport,
} from "./tableGeometry";
import {
  cancel,
  keyAction,
  move,
  press,
  release,
  snapSize,
  wheel,
  type CardSize,
  type Gesture,
} from "./tableGestures";
import { createTableMeasurements } from "./tableMeasurements";
import { TableCard } from "./TableCard";
import { sameTableCard, type TableCardProps } from "./tableCardIdentity";
import type { ReactElement } from "react";
import { useTablePaintState, type TablePublication } from "./tablePublication";
import type { TableCardModel, TableSizing } from "./tableModel";

export const TABLE_REF_MIME = "application/x-loqui-table-ref";
const ZOOM_STEP = 1.2;

export interface TableCanvasProps {
  cards: TableCardModel[];
  edges: Array<{ a: string; b: string }>;
  viewport: Viewport;
  selection: string[];
  focused: string | null;
  expanded: string | null;
  label: string;
  onViewport: (v: Viewport, persist: boolean) => void;
  onMove: (positions: Record<string, Point>) => void;
  onDrop: (positions: Record<string, Point>) => void;
  onClickCard: (key: string, additive: boolean) => void;
  onSelect: (keys: string[]) => void;
  onFocus: (key: string | null) => void;
  onOpen: (key: string) => void;
  onRemove: (keys: string[]) => void;
  onNudge: (keys: string[], dx: number, dy: number) => void;
  onMeasure: (key: string, h: number) => void;
  onDropRef?: (key: string, world: Point) => void;
  onResize?: (size: Size) => void;
  onResizeCard?: (key: string, size: CardSize, commit: boolean) => void;
  onResizeCancel?: (key: string, sizing: TableSizing) => void;
  gestureScope?: number;
  publication?: TablePublication;
  subscribe?: (listener: () => void) => () => void;
  read?: () => Pick<TableCanvasProps, "cards" | "viewport" | "selection" | "focused">;
}

export function TableCanvas(props: TableCanvasProps) {
  const { cards, edges, viewport, selection, focused, expanded, label } = {
    ...props,
    ...props.read?.(),
  };
  const { t } = useTranslation();
  const propsRef = useRef(props);
  propsRef.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(
    new Map<string, { node: HTMLDivElement; overflow: (fixed?: boolean) => void }>()
  );
  const register = useCallback(
    (key: string, node: HTMLDivElement | null, overflow: (fixed?: boolean) => void) => {
      if (node) nodes.current.set(key, { node, overflow });
      else nodes.current.delete(key);
    },
    []
  );
  const current = () => ({ ...propsRef.current, ...propsRef.current.read?.() });
  const measurements = useMemo(createTableMeasurements, []);
  useEffect(() => () => measurements.dispose(), [measurements]);
  const paths = useRef(new Map<string, SVGPathElement>());
  const pathGeometry = useRef(new Map<string, [Rect, Rect]>());
  const pathElements = useRef(new Map<string, { d: string; element: ReactElement }>());
  const gestureRef = useRef<Gesture>({ kind: "idle" });
  const spaceHeld = useRef(false);
  const resizeRollback = useRef<{
    key: string;
    sizing: TableSizing;
    restore: TableCanvasProps["onResizeCancel"];
  } | null>(null);
  const frameOwner = useRef({ revision: 0 });
  const cancelRef = useRef<(restoreResize?: boolean) => void>(() => {});
  const [sizePaint, setSize, liveSize, , projectSize] = useTablePaintState<Size>(
    { width: 1200, height: 800 },
    props.publication
  );
  const size = props.publication ? liveSize.current : sizePaint;
  const [lasso, setLasso, liveLasso] = useTablePaintState<Rect | null>(null, props.publication);
  const lassoRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging, liveDragging] = useTablePaintState<string[]>([], props.publication);
  const [snapping, setSnapping, liveSnapping] = useTablePaintState<string[]>([], props.publication);
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null);
  const snapRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; owner: number }>({
    timer: null,
    owner: 0,
  });
  const sessionRef = useRef({
    selection,
    viewport,
    placed: cards.map((c) => ({ id: c.key, rect: c.rect })),
  });
  const onResizeRef = useRef(props.onResize);
  onResizeRef.current = props.onResize;
  // One pointer owns a gesture; a second touch never hijacks it.
  const pointerIdRef = useRef<number | null>(null);
  // Pointer moves are coalesced to one per animation frame.
  const frameRef = useRef<number | null>(null);
  const latestPoint = useRef<Point | null>(null);

  const placed = useMemo(() => cards.map((c) => ({ id: c.key, rect: c.rect })), [cards]);
  const byKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const always = useMemo(
    () => [
      ...selection,
      ...(focused ? [focused] : []),
      ...dragging,
      ...(focusRequest ? [focusRequest.key] : []),
    ],
    [selection, focused, dragging, focusRequest]
  );
  const visible = useMemo(
    () => visibleIds(placed, viewport, size, always),
    [placed, viewport, size, always]
  );
  const retention = useRef({ scope: props.gestureScope, keys: new Set<string>(), warmed: false });
  if (retention.current.scope !== props.gestureScope)
    retention.current = { scope: props.gestureScope, keys: new Set(), warmed: false };
  const retained = retention.current.keys;
  for (const key of retained) if (!byKey.has(key)) retained.delete(key);
  for (const key of visible) if (byKey.has(key)) retained.add(key);
  // Warm only offscreen semantic nodes in bounded chunks. Visible cards always
  // mount immediately; retention never substitutes a placeholder for content.
  const batch = retention.current.warmed ? 32 : 8;
  if (props.publication && retained.size < cards.length) {
    const left = -viewport.x / viewport.scale;
    const top = -viewport.y / viewport.scale;
    const width = Math.max(1, size.width / viewport.scale);
    const height = Math.max(1, size.height / viewport.scale);
    const distance = (rect: Rect) => {
      const dx = Math.max(left - rect.x - rect.w, rect.x - left - width, 0) / width;
      const dy = Math.max(top - rect.y - rect.h, rect.y - top - height, 0) / height;
      return Math.max(dx, dy);
    };
    // Canonical order still owns DOM/order/caps. Optional warming follows the
    // spatial neighborhood so a first pan/zoom does not warm the far end first.
    const nearby = cards
      .filter((card) => !retained.has(card.key))
      .map((card) => ({ card, distance: distance(card.rect) }))
      .sort((a, b) => a.distance - b.distance);
    for (const { card } of nearby.slice(0, batch)) retained.add(card.key);
  }
  if (cards.length) retention.current.warmed = true;
  const [retentionRevision, warm] = useTablePaintState(0, props.publication);
  useEffect(() => {
    if (!props.publication || retained.size >= cards.length) return;
    // Only optional offscreen preparation yields between batches. Newly visible
    // content continues to drain synchronously through the current paint owner.
    let active = true;
    let next: number | null = null;
    const first = requestAnimationFrame(() => {
      if (!active) return;
      next = requestAnimationFrame(() => {
        if (active) warm((value) => value + 1);
      });
    });
    return () => {
      active = false;
      cancelAnimationFrame(first);
      if (next !== null) cancelAnimationFrame(next);
    };
  }, [props.publication, cards, retained, retained.size, retentionRevision, warm]);
  const rendered = cards.filter((c) => retained.has(c.key));
  const elements = useRef(new Map<string, { props: TableCardProps; element: ReactElement }>());
  for (const key of elements.current.keys()) if (!retained.has(key)) elements.current.delete(key);

  // The tab stop is always a rendered card, so a restored viewport can never strand keyboard users.
  const edgeKeys = new Set(edges.map((edge) => `${edge.a}|${edge.b}`));
  for (const key of pathElements.current.keys())
    if (!edgeKeys.has(key)) {
      pathElements.current.delete(key);
      pathGeometry.current.delete(key);
    }
  const tabStop =
    focused && byKey.has(focused) && visible.has(focused)
      ? focused
      : (cards.find((card) => visible.has(card.key))?.key ?? null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (propsRef.current.publication) projectSize(next);
      else setSize(next);
      onResizeRef.current?.(next);
      paintRef.current();
    };
    // Establish actual entry bounds before a board response can mount content.
    if (propsRef.current.publication) measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [setSize, projectSize]);

  // React's onWheel is passive; zoom must preventDefault to stop page zoom.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const r = el.getBoundingClientRect();
      const live = current();
      live.onViewport(
        wheel(live.viewport, {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          point: { x: event.clientX - r.left, y: event.clientY - r.top },
        }),
        true
      );
      if (!propsRef.current.subscribe) paintRef.current();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Only an explicit keyboard operation requests DOM focus. Prop reloads,
  // zoom and pan cannot pull focus away from Ask or other canvas chrome.
  useLayoutEffect(() => {
    if (!focusRequest) return;
    const root = rootRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-card-key="${focusRequest.key}"]`);
    el?.focus({ preventScroll: true });
    setFocusRequest(null);
  }, [focusRequest]);

  const geometry = useRef<{
    cards: TableCardModel[];
    placed: { id: string; rect: Rect }[];
    byKey: Map<string, TableCardModel>;
  } | null>(null);
  const painted = useRef(
    new Map<
      string,
      {
        x: number;
        y: number;
        w: number;
        h: number | null;
        hidden: boolean;
        selected: boolean;
        tab: boolean;
        dragging: boolean;
        snapping: boolean;
        z: number;
      }
    >()
  );
  const paintGeometry = () => {
    const live = current();
    const root = rootRef.current;
    const world = root?.querySelector<HTMLElement>(".table-world");
    const transform = `translate3d(${live.viewport.x}px, ${live.viewport.y}px, 0) scale(${live.viewport.scale})`;
    if (world && world.style.transform !== transform) world.style.transform = transform;
    if (root) {
      if (gestureRef.current.kind === "pan") root.setAttribute("data-panning", "true");
      else root.removeAttribute("data-panning");
      const grid = `${DOT_GRID * live.viewport.scale}px ${DOT_GRID * live.viewport.scale}px`;
      const position = `${live.viewport.x}px ${live.viewport.y}px`;
      if (root.style.backgroundSize !== grid) root.style.backgroundSize = grid;
      if (root.style.backgroundPosition !== position) root.style.backgroundPosition = position;
    }
    if (geometry.current?.cards !== live.cards)
      geometry.current = {
        cards: live.cards,
        placed: live.cards.map((card) => ({ id: card.key, rect: card.rect })),
        byKey: new Map(live.cards.map((card) => [card.key, card])),
      };
    const byKeyNow = geometry.current.byKey;
    const visibleNow = visibleIds(geometry.current.placed, live.viewport, liveSize.current, [
      ...live.selection,
      ...(live.focused ? [live.focused] : []),
      ...liveDragging.current,
    ]);
    if (
      propsRef.current.publication &&
      [...visibleNow].some((key) => byKeyNow.has(key) && !nodes.current.has(key))
    ) {
      warm((value) => value + 1);
      // Offscreen warming is optional; newly visible semantic content is not.
      // Drain the paint owner synchronously when a viewport outruns retention.
      propsRef.current.publication.flushNow();
      return;
    }
    const overlay = lassoRef.current;
    if (overlay) {
      const rect = liveLasso.current;
      overlay.style.visibility = rect ? "" : "hidden";
      if (rect) {
        overlay.style.left = `${rect.x}px`;
        overlay.style.top = `${rect.y}px`;
        overlay.style.width = `${rect.w}px`;
        overlay.style.height = `${rect.h}px`;
      }
    }
    const tab =
      live.focused && visibleNow.has(live.focused)
        ? live.focused
        : live.cards.find((card) => visibleNow.has(card.key))?.key;
    for (const [key, entry] of nodes.current)
      if (!byKeyNow.has(key)) {
        entry.node.style.visibility = "hidden";
        painted.current.delete(key);
        entry.node.setAttribute("aria-hidden", "true");

        entry.node.tabIndex = -1;
      }
    const cardsByKey = byKeyNow;
    const equalRect = (a: Rect, b: Rect) =>
      a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    for (const [key, path] of paths.current) {
      const [a, b] = key.split("|");
      const ar = cardsByKey.get(a)?.rect,
        br = cardsByKey.get(b)?.rect;
      const previous = pathGeometry.current.get(key);
      if (ar && br && (!previous || !equalRect(ar, previous[0]) || !equalRect(br, previous[1]))) {
        path.setAttribute("d", connectorPath(ar, br));
        pathGeometry.current.set(key, [ar, br]);
      }
      const display = visibleNow.has(a) && visibleNow.has(b) ? "" : "none";
      if (path.style.display !== display) path.style.display = display;
    }
    for (const key of painted.current.keys())
      if (!nodes.current.has(key)) painted.current.delete(key);
    for (const card of live.cards) {
      const entry = nodes.current.get(card.key);
      if (!entry) continue;
      const previous = painted.current.get(card.key);
      const hidden = !visibleNow.has(card.key),
        selected = live.selection.includes(card.key),
        tabbed = card.key === tab,
        dragged = liveDragging.current.includes(card.key),
        snapped = liveSnapping.current.includes(card.key);
      if (
        previous &&
        previous.x === card.rect.x &&
        previous.y === card.rect.y &&
        previous.w === card.rect.w &&
        previous.h === (card.fixedH ?? null) &&
        previous.hidden === hidden &&
        previous.selected === selected &&
        previous.tab === tabbed &&
        previous.dragging === dragged &&
        previous.snapping === snapped &&
        previous.z === card.z
      )
        continue;
      const next = {
        x: card.rect.x,
        y: card.rect.y,
        w: card.rect.w,
        h: card.fixedH ?? null,
        hidden: !visibleNow.has(card.key),
        selected: live.selection.includes(card.key),
        tab: card.key === tab,
        dragging: liveDragging.current.includes(card.key),
        snapping: liveSnapping.current.includes(card.key),
        z: card.z,
      };
      const { node, overflow } = entry;
      if (!previous || previous.x !== next.x) node.style.left = `${next.x}px`;
      if (!previous || previous.y !== next.y) node.style.top = `${next.y}px`;
      const reflow = !previous || previous.w !== next.w || previous.h !== next.h;
      if (reflow) {
        node.style.width = `${next.w}px`;
        node.style.height = next.h == null ? "" : `${next.h}px`;
        node.style.overflow = next.h == null ? "" : "hidden";
        if (next.h != null) node.setAttribute("data-sized", "true");
        else node.removeAttribute("data-sized");
      }
      if (!previous || previous.hidden !== next.hidden) {
        // Offscreen retention preserves actual layout and measurements; only
        // visible/focused options participate in paint and interaction.
        node.style.visibility = next.hidden ? "hidden" : "";
        if (next.hidden) {
          node.setAttribute("aria-hidden", "true");
        } else {
          node.removeAttribute("aria-hidden");
        }
      }
      if (!previous || previous.tab !== next.tab || previous.hidden !== next.hidden)
        node.tabIndex = !next.hidden && next.tab ? 0 : -1;
      if (!previous || previous.selected !== next.selected)
        node.setAttribute("aria-selected", String(next.selected));
      if (!previous || previous.z !== next.z || previous.dragging !== next.dragging) {
        node.style.zIndex = String(next.dragging ? 1000 : next.z);
        if (next.dragging) node.setAttribute("data-dragging", "true");
        else node.removeAttribute("data-dragging");
      }
      if (!previous || previous.snapping !== next.snapping) {
        if (next.snapping) node.setAttribute("data-snapping", "true");
        else node.removeAttribute("data-snapping");
      }
      painted.current.set(card.key, next);
      if (reflow) overflow(next.h != null);
    }
  };
  useLayoutEffect(paintGeometry);
  const paintRef = useRef(paintGeometry);
  paintRef.current = paintGeometry;
  const subscribe = props.subscribe;
  useLayoutEffect(() => subscribe?.(() => paintRef.current()), [subscribe]);

  const focusAndReveal = (key: string) => {
    const live = current();
    const rect = live.cards.find((card) => card.key === key)?.rect;
    if (!rect) return;
    props.onFocus(key);
    const next = ensureVisible(rect, live.viewport, liveSize.current);
    if (next !== live.viewport) props.onViewport(next, true);
    paintGeometry();
    const node = nodes.current.get(key)?.node;
    if (props.publication && node) node.focus({ preventScroll: true });
    else setFocusRequest({ key });
  };

  const clearSnap = useCallback(() => {
    const snap = snapRef.current;
    snap.owner++;
    if (snap.timer !== null) clearTimeout(snap.timer);
    snap.timer = null;
  }, []);
  const startSnap = (keys: string[]) => {
    clearSnap();
    // CSS owns the duration. The token-derived timer also covers no-op position
    // transitions (which emit no transitionend) and removed/culled cards.
    const root = rootRef.current;
    const token = root
      ? window.getComputedStyle(root).getPropertyValue("--motion-slow").trim()
      : "";
    const duration = /^\d*\.?\d+(ms|s)$/.test(token)
      ? parseFloat(token) * (token.endsWith("ms") ? 1 : 1000)
      : 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || duration <= 0) {
      setSnapping((current) => (current.length ? [] : current));
      return;
    }
    setSnapping(keys);
    const owner = snapRef.current.owner;
    snapRef.current.timer = setTimeout(() => {
      if (snapRef.current.owner !== owner) return;
      snapRef.current.timer = null;
      setSnapping((current) => (current.length ? [] : current));
    }, duration);
  };

  // Cancel work and release capture while the root still exists on unmount.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scope = props.gestureScope;
    const frames = frameOwner.current;
    setDragging((current) => (current.length ? [] : current));
    setLasso(null);
    setSnapping((current) => (current.length ? [] : current));
    setFocusRequest(null);
    return () => {
      frames.revision++;
      const rollback = resizeRollback.current;
      resizeRollback.current = null;
      // Unmount can leave the board mounted; changing scope instead resets its
      // reducer, and must never send an old card's rollback into the new board.
      if (rollback && propsRef.current.gestureScope === scope)
        rollback.restore?.(rollback.key, rollback.sizing);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      latestPoint.current = null;
      const id = pointerIdRef.current;
      pointerIdRef.current = null;
      gestureRef.current = { kind: "idle" };
      spaceHeld.current = false;
      clearSnap();
      if (id !== null && root?.hasPointerCapture(id)) root.releasePointerCapture(id);
    };
  }, [clearSnap, props.gestureScope, setDragging, setLasso, setSnapping]);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || pointerIdRef.current !== null) return;
    const { cards, viewport, selection } = current();
    const placed = cards.map((card) => ({ id: card.key, rect: card.rect }));
    const byKey = new Map(cards.map((card) => [card.key, card]));
    clearSnap();
    setSnapping((current) => (current.length ? [] : current));
    pointerIdRef.current = event.pointerId;
    sessionRef.current = { selection: [...selection], viewport, placed };
    const cardEl = (event.target as HTMLElement).closest<HTMLElement>("[data-card-key]");
    const handle = (event.target as HTMLElement).closest("[data-resize-handle]");
    const resizeCard = handle && cardEl ? byKey.get(cardEl.dataset.cardKey!) : undefined;
    resizeRollback.current =
      resizeCard && !spaceHeld.current
        ? {
            key: resizeCard.key,
            sizing: {
              persisted: {
                w: resizeCard.entity.layout?.w ?? null,
                h: resizeCard.entity.layout?.h ?? null,
              },
              override: resizeCard.sizeOverride ? { ...resizeCard.sizeOverride } : null,
            },
            restore: props.onResizeCancel,
          }
        : null;
    const positions: Record<string, Point> = {};
    for (const c of cards) positions[c.key] = { x: c.rect.x, y: c.rect.y };
    gestureRef.current = press({
      point: local(event),
      cardKey: cardEl?.dataset.cardKey ?? null,
      shift: event.shiftKey,
      spaceHeld: spaceHeld.current,
      viewport,
      selection,
      positions,
      resizeKey: resizeCard?.key,
      sizes: resizeCard
        ? { [resizeCard.key]: { w: resizeCard.rect.w, h: resizeCard.rect.h } }
        : undefined,
    });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const applyPoint = (point: Point) => {
    const { gesture, effect } = move(gestureRef.current, point);
    gestureRef.current = gesture;
    if (!effect) return;
    const callbacks = current();
    if (effect.type === "size") {
      setDragging((previous) =>
        previous.length === 1 && previous[0] === effect.key ? previous : [effect.key]
      );
      callbacks.onResizeCard?.(effect.key, effect.size, false);
    }
    if (effect.type === "viewport") callbacks.onViewport(effect.viewport, false);
    if (effect.type === "positions") {
      const keys = Object.keys(effect.positions);
      setDragging((previous) =>
        previous.length === keys.length && previous.every((key, index) => key === keys[index])
          ? previous
          : keys
      );
      callbacks.onMove(effect.positions);
    }
    if (effect.type === "lasso") {
      setLasso(effect.rect);
      callbacks.onSelect(
        lassoSelect(sessionRef.current.placed, effect.rect, sessionRef.current.viewport)
      );
    }
    if (!propsRef.current.subscribe) paintGeometry();
  };
  const applyMove = () => {
    frameRef.current = null;
    const point = latestPoint.current;
    latestPoint.current = null;
    if (point && pointerIdRef.current !== null) applyPoint(point);
  };
  const cancelFrame = () => {
    frameOwner.current.revision++;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    latestPoint.current = null;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    latestPoint.current = local(event);
    if (frameRef.current === null) {
      const owner = frameOwner.current.revision;
      frameRef.current = requestAnimationFrame(() => {
        if (owner === frameOwner.current.revision) applyMove();
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    cancelFrame();
    const point = local(event);
    applyPoint(point); // Settle the final preview before committing the snapped result.
    const id = pointerIdRef.current;
    pointerIdRef.current = null;
    if (id !== null && rootRef.current?.hasPointerCapture(id))
      rootRef.current.releasePointerCapture(id);
    const effect = release(gestureRef.current, point);
    gestureRef.current = { kind: "idle" };
    resizeRollback.current = null;
    setDragging([]);
    setLasso(null);
    if (!effect) return;
    if (effect.type === "resized") props.onResizeCard?.(effect.key, effect.size, true);
    if (effect.type === "drop") {
      const keys = Object.keys(effect.positions);
      startSnap(keys);
      props.onDrop(effect.positions);
    }
    if (effect.type === "click-card") props.onClickCard(effect.key, effect.additive);
    if (effect.type === "click-background") props.onSelect([]);
    if (effect.type === "pan-end") props.onViewport(effect.viewport, true);
    if (effect.type === "lasso-end")
      props.onSelect(
        lassoSelect(sessionRef.current.placed, effect.rect, sessionRef.current.viewport)
      );
    paintGeometry();
  };

  const cancelGesture = (restoreResize = true) => {
    if (pointerIdRef.current === null) return;
    const id = pointerIdRef.current;
    pointerIdRef.current = null;
    cancelFrame();
    if (id !== null && rootRef.current?.hasPointerCapture(id))
      rootRef.current.releasePointerCapture(id);
    if (gestureRef.current.kind === "lasso") props.onSelect(sessionRef.current.selection);
    const rollback = resizeRollback.current;
    resizeRollback.current = null;
    if (restoreResize) rollback?.restore?.(rollback.key, rollback.sizing);
    const effect = cancel(gestureRef.current);
    gestureRef.current = { kind: "idle" };
    setDragging([]);
    setLasso(null);
    if (effect?.type === "positions") props.onMove(effect.positions);
    if (effect?.type === "viewport") props.onViewport(effect.viewport, false);
    paintGeometry();
  };

  cancelRef.current = (restoreResize = true) => {
    spaceHeld.current = false;
    cancelGesture(restoreResize);
  };
  useEffect(() => {
    const onBlur = () => cancelRef.current();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  useLayoutEffect(() => {
    const gesture = gestureRef.current;
    if (gesture.kind === "resize" && !byKey.has(gesture.key)) cancelRef.current(false);
  }, [byKey]);

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId === pointerIdRef.current) cancelGesture();
  };

  const zoomBy = useCallback(
    (factor: number) =>
      props.onViewport(
        zoomAt(current().viewport, factor, {
          x: liveSize.current.width / 2,
          y: liveSize.current.height / 2,
        }),
        true
      ),
    [props, liveSize]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const { cards, viewport, selection, focused } = current();
    const placed = cards.map((card) => ({ id: card.key, rect: card.rect }));
    const byKey = new Map(cards.map((card) => [card.key, card]));
    const inView = visibleIds(placed, viewport, liveSize.current, [], 1);
    const entryKey =
      (focused && inView.has(focused) ? focused : null) ??
      cards.find((card) => inView.has(card.key))?.key ??
      cards[0]?.key ??
      null;
    if (event.key === "Escape" && pointerIdRef.current !== null) {
      event.preventDefault();
      cancelGesture();
      return;
    }
    // A held pointer owns its sizing until release/cancel.
    if (gestureRef.current.kind === "resize") return;
    const cardKey =
      (event.target as HTMLElement).closest<HTMLElement>("[data-card-key]")?.dataset.cardKey ??
      null;
    if (event.key === " " && !cardKey) {
      spaceHeld.current = true;
      event.preventDefault();
    }
    const action = keyAction(event, cardKey !== null);
    if (!action) return;
    event.preventDefault();
    const targets = cardKey && selection.includes(cardKey) ? selection : cardKey ? [cardKey] : [];
    switch (action.type) {
      case "focusMove": {
        const next = cardKey ? nearestInDirection(cardKey, placed, action.dir) : null;
        if (!next) return;
        focusAndReveal(next);
        return;
      }
      case "resize": {
        const rect = cardKey ? byKey.get(cardKey)?.rect : undefined;
        if (cardKey && rect)
          props.onResizeCard?.(
            cardKey,
            snapSize({ w: rect.w + action.dw, h: rect.h + action.dh }),
            true
          );
        return;
      }
      case "nudge":
        return props.onNudge(targets, action.dx, action.dy);
      case "open":
        return cardKey ? props.onOpen(cardKey) : undefined;
      case "toggleSelect":
        return cardKey ? props.onClickCard(cardKey, true) : undefined;
      case "clearSelection":
        return props.onSelect([]);
      case "remove":
        return props.onRemove(targets);
      case "zoomIn":
        return zoomBy(ZOOM_STEP);
      case "zoomOut":
        return zoomBy(1 / ZOOM_STEP);
      case "resetView":
        return props.onViewport(DEFAULT_VIEWPORT, true);
      case "enterCards":
        return entryKey ? focusAndReveal(entryKey) : undefined;
    }
  };

  const onDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (props.onDropRef && event.dataTransfer.types.includes(TABLE_REF_MIME))
      event.preventDefault();
  };
  const onDropRef = (event: ReactDragEvent<HTMLDivElement>) => {
    const key = event.dataTransfer.getData(TABLE_REF_MIME);
    if (!key || !props.onDropRef) return;
    event.preventDefault();
    props.onDropRef(key, screenToWorld(local(event), current().viewport));
  };

  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-multiselectable="true"
      aria-roledescription={t("table.canvasRole")}
      aria-label={label}
      tabIndex={0}
      className="table-canvas"
      data-panning={gestureRef.current.kind === "pan" ? "true" : undefined}
      style={{
        backgroundSize: `${DOT_GRID * viewport.scale}px ${DOT_GRID * viewport.scale}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === " ") spaceHeld.current = false;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          spaceHeld.current = false;
          cancelGesture();
        }
      }}
      onFocus={(event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>("[data-card-key]")?.dataset
          .cardKey;
        if (key && nodes.current.get(key)?.node.getAttribute("aria-hidden") === "true")
          focusAndReveal(key);
        else if (key && key !== current().focused) props.onFocus(key);
      }}
      onDoubleClick={(event) => {
        // Pointer capture retargets click/dblclick to the root, so hit-test the point instead.
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        const key = hit?.closest<HTMLElement>("[data-card-key]")?.dataset.cardKey;
        if (key) props.onOpen(key);
      }}
      onDragOver={onDragOver}
      onDrop={onDropRef}
    >
      <div
        className="table-world"
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
        }}
      >
        <svg className="table-connectors" aria-hidden="true">
          {edges
            .filter(
              (edge) =>
                byKey.has(edge.a) &&
                byKey.has(edge.b) &&
                retained.has(edge.a) &&
                retained.has(edge.b)
            )
            .map((edge) => {
              const key = `${edge.a}|${edge.b}`;
              const d = connectorPath(byKey.get(edge.a)!.rect, byKey.get(edge.b)!.rect);
              const old = pathElements.current.get(key);
              if (old?.d === d) return old.element;
              const element = (
                <path
                  key={key}
                  d={d}
                  ref={(node) => {
                    if (node) paths.current.set(key, node);
                    else paths.current.delete(key);
                  }}
                />
              );
              pathElements.current.set(key, { d, element });
              return element;
            })}
        </svg>
        {rendered.map((card) => {
          const next: TableCardProps = {
            card,
            selected: selection.includes(card.key),
            focusable: card.key === tabStop,
            dragging: dragging.includes(card.key),
            snapping: snapping.includes(card.key),
            expanded: expanded === card.key,
            onMeasure: props.onMeasure,
            onNode: register,
            observe: props.publication ? measurements.observe : undefined,
          };
          const previous = elements.current.get(card.key);
          if (previous && sameTableCard(previous.props, next)) return previous.element;
          const element = <TableCard key={card.key} {...next} />;
          elements.current.set(card.key, { props: next, element });
          return element;
        })}
      </div>
      {lasso && (
        <div
          ref={lassoRef}
          className="table-lasso"
          style={{ left: lasso.x, top: lasso.y, width: lasso.w, height: lasso.h }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
