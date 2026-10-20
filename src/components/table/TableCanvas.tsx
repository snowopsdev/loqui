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
import { cancel, keyAction, move, press, release, wheel, type Gesture } from "./tableGestures";
import { TableCard } from "./TableCard";
import type { TableCardModel } from "./tableModel";

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
}

export function TableCanvas(props: TableCanvasProps) {
  const { cards, edges, viewport, selection, focused, expanded, label } = props;
  const { t } = useTranslation();
  const propsRef = useRef(props);
  propsRef.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture>({ kind: "idle" });
  const spaceHeld = useRef(false);
  const [size, setSize] = useState<Size>({ width: 1200, height: 800 });
  const [lasso, setLasso] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState<string[]>([]);
  const [snapping, setSnapping] = useState<string[]>([]);
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
  const rendered = cards.filter((c) => visible.has(c.key));
  // The tab stop is always a rendered card, so a restored viewport can never strand keyboard users.
  const inViewport = visibleIds(placed, viewport, size, [], 1);
  const entryKey =
    (focused && inViewport.has(focused) ? focused : null) ??
    cards.find((c) => inViewport.has(c.key))?.key ??
    cards[0]?.key ??
    null;
  const tabStop =
    focused && byKey.has(focused) && visible.has(focused) ? focused : (rendered[0]?.key ?? null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize(next);
      onResizeRef.current?.(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // React's onWheel is passive; zoom must preventDefault to stop page zoom.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const r = el.getBoundingClientRect();
      const current = propsRef.current;
      current.onViewport(
        wheel(current.viewport, {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          point: { x: event.clientX - r.left, y: event.clientY - r.top },
        }),
        true
      );
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

  const focusAndReveal = (key: string) => {
    const rect = byKey.get(key)?.rect;
    if (!rect) return;
    props.onFocus(key);
    const next = ensureVisible(rect, viewport, size);
    if (next !== viewport) props.onViewport(next, true);
    setFocusRequest({ key });
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
      setSnapping([]);
      return;
    }
    setSnapping(keys);
    const owner = snapRef.current.owner;
    snapRef.current.timer = setTimeout(() => {
      if (snapRef.current.owner !== owner) return;
      snapRef.current.timer = null;
      setSnapping([]);
    }, duration);
  };

  // Cancel work and release capture while the root still exists on unmount.
  useLayoutEffect(() => {
    const root = rootRef.current;
    return () => {
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
  }, [clearSnap]);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || pointerIdRef.current !== null) return;
    clearSnap();
    setSnapping([]);
    pointerIdRef.current = event.pointerId;
    sessionRef.current = { selection: [...selection], viewport, placed };
    const cardEl = (event.target as HTMLElement).closest<HTMLElement>("[data-card-key]");
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
    });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const applyPoint = (point: Point) => {
    const { gesture, effect } = move(gestureRef.current, point);
    gestureRef.current = gesture;
    if (!effect) return;
    const callbacks = propsRef.current;
    if (effect.type === "viewport") callbacks.onViewport(effect.viewport, false);
    if (effect.type === "positions") {
      const keys = Object.keys(effect.positions);
      setDragging(keys);
      callbacks.onMove(effect.positions);
    }
    if (effect.type === "lasso") {
      setLasso(effect.rect);
      callbacks.onSelect(
        lassoSelect(sessionRef.current.placed, effect.rect, sessionRef.current.viewport)
      );
    }
  };
  const applyMove = () => {
    frameRef.current = null;
    const point = latestPoint.current;
    latestPoint.current = null;
    if (point && pointerIdRef.current !== null) applyPoint(point);
  };
  const cancelFrame = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    latestPoint.current = null;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    latestPoint.current = local(event);
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(applyMove);
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
    setDragging([]);
    setLasso(null);
    if (!effect) return;
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
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerIdRef.current) return;
    const id = pointerIdRef.current;
    pointerIdRef.current = null;
    cancelFrame();
    if (id !== null && rootRef.current?.hasPointerCapture(id))
      rootRef.current.releasePointerCapture(id);
    if (gestureRef.current.kind === "lasso") props.onSelect(sessionRef.current.selection);
    const effect = cancel(gestureRef.current);
    gestureRef.current = { kind: "idle" };
    setDragging([]);
    setLasso(null);
    if (effect?.type === "positions") props.onMove(effect.positions);
    if (effect?.type === "viewport") props.onViewport(effect.viewport, false);
  };

  const zoomBy = useCallback(
    (factor: number) =>
      props.onViewport(zoomAt(viewport, factor, { x: size.width / 2, y: size.height / 2 }), true),
    [props, viewport, size]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
    props.onDropRef(key, screenToWorld(local(event), viewport));
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
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          spaceHeld.current = false;
      }}
      onFocus={(event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>("[data-card-key]")?.dataset
          .cardKey;
        if (key && key !== focused) props.onFocus(key);
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
            .filter((e) => byKey.has(e.a) && byKey.has(e.b) && visible.has(e.a) && visible.has(e.b))
            .map((e) => (
              <path
                key={`${e.a}|${e.b}`}
                d={connectorPath(byKey.get(e.a)!.rect, byKey.get(e.b)!.rect)}
              />
            ))}
        </svg>
        {rendered.map((card) => (
          <TableCard
            key={card.key}
            card={card}
            selected={selection.includes(card.key)}
            focusable={card.key === tabStop}
            dragging={dragging.includes(card.key)}
            snapping={snapping.includes(card.key)}
            expanded={expanded === card.key}
            onMeasure={props.onMeasure}
          />
        ))}
      </div>
      {lasso && (
        <div
          className="table-lasso"
          style={{ left: lasso.x, top: lasso.y, width: lasso.w, height: lasso.h }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
