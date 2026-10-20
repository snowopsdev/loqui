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
import { TableCard } from "./TableCard";
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
}

export function TableCanvas(props: TableCanvasProps) {
  const { cards, edges, viewport, selection, focused, expanded, label } = props;
  const { t } = useTranslation();
  const propsRef = useRef(props);
  propsRef.current = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture>({ kind: "idle" });
  const spaceHeld = useRef(false);
  const resizeRollback = useRef<{
    key: string;
    sizing: TableSizing;
    restore: TableCanvasProps["onResizeCancel"];
  } | null>(null);
  const frameOwner = useRef({ revision: 0 });
  const cancelRef = useRef<(restoreResize?: boolean) => void>(() => {});
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
    setDragging([]);
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
  }, [clearSnap, props.gestureScope]);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || pointerIdRef.current !== null) return;
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
    const callbacks = propsRef.current;
    if (effect.type === "size") {
      setDragging([effect.key]);
      callbacks.onResizeCard?.(effect.key, effect.size, false);
    }
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
      props.onViewport(zoomAt(viewport, factor, { x: size.width / 2, y: size.height / 2 }), true),
    [props, viewport, size]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          spaceHeld.current = false;
          cancelGesture();
        }
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
