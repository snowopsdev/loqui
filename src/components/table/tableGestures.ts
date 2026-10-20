import {
  GRID,
  normalizeRect,
  snapToGrid,
  zoomAt,
  type Direction,
  type Point,
  type Rect,
  type Viewport,
} from "./tableGeometry";

// Pointer and key handling for The Table as pure functions, so every rule is
// testable without a DOM. TableCanvas only forwards events and applies effects.

export const DRAG_THRESHOLD = 4;
const WHEEL_ZOOM_RATE = 0.01;

export type Gesture =
  | { kind: "idle" }
  | { kind: "pan"; start: Point; origin: Viewport; moved: boolean }
  | {
      kind: "drag";
      keys: string[];
      start: Point;
      origins: Record<string, Point>;
      scale: number;
      moved: boolean;
      pressed: string;
      additive: boolean;
    }
  | { kind: "lasso"; start: Point; current: Point };

export interface PressInput {
  point: Point;
  cardKey: string | null;
  shift: boolean;
  spaceHeld: boolean;
  viewport: Viewport;
  selection: string[];
  positions: Record<string, Point>;
}

export function press(input: PressInput): Gesture {
  if (input.cardKey && !input.spaceHeld) {
    const keys = input.selection.includes(input.cardKey) ? input.selection : [input.cardKey];
    const origins: Record<string, Point> = {};
    for (const key of keys) if (input.positions[key]) origins[key] = input.positions[key];
    return {
      kind: "drag",
      keys,
      start: input.point,
      origins,
      scale: input.viewport.scale,
      moved: false,
      pressed: input.cardKey,
      additive: input.shift,
    };
  }
  if (input.shift && !input.cardKey)
    return { kind: "lasso", start: input.point, current: input.point };
  return { kind: "pan", start: input.point, origin: input.viewport, moved: false };
}

export type MoveEffect =
  | { type: "viewport"; viewport: Viewport }
  | { type: "positions"; positions: Record<string, Point> }
  | { type: "lasso"; rect: Rect }
  | null;

const passed = (a: Point, b: Point) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > DRAG_THRESHOLD;

function panViewport(g: Extract<Gesture, { kind: "pan" }>, point: Point): Viewport {
  return {
    ...g.origin,
    x: g.origin.x + point.x - g.start.x,
    y: g.origin.y + point.y - g.start.y,
  };
}

function dragPositions(
  g: Extract<Gesture, { kind: "drag" }>,
  point: Point,
  snap: boolean
): Record<string, Point> {
  const dx = (point.x - g.start.x) / g.scale;
  const dy = (point.y - g.start.y) / g.scale;
  const out: Record<string, Point> = {};
  for (const [key, origin] of Object.entries(g.origins)) {
    out[key] = snap
      ? { x: snapToGrid(origin.x + dx), y: snapToGrid(origin.y + dy) }
      : { x: origin.x + dx, y: origin.y + dy };
  }
  return out;
}

export function move(gesture: Gesture, point: Point): { gesture: Gesture; effect: MoveEffect } {
  switch (gesture.kind) {
    case "pan": {
      const moved = gesture.moved || passed(gesture.start, point);
      const next = { ...gesture, moved };
      if (!moved) return { gesture: next, effect: null };
      return { gesture: next, effect: { type: "viewport", viewport: panViewport(gesture, point) } };
    }
    case "drag": {
      const moved = gesture.moved || passed(gesture.start, point);
      const next = { ...gesture, moved };
      return {
        gesture: next,
        effect: moved ? { type: "positions", positions: dragPositions(next, point, false) } : null,
      };
    }
    case "lasso": {
      const next = { ...gesture, current: point };
      return {
        gesture: next,
        effect: { type: "lasso", rect: normalizeRect(gesture.start, point) },
      };
    }
    default:
      return { gesture, effect: null };
  }
}

export type ReleaseEffect =
  | { type: "drop"; positions: Record<string, Point> }
  | { type: "click-card"; key: string; additive: boolean }
  | { type: "click-background" }
  | { type: "lasso-end"; rect: Rect }
  | { type: "pan-end"; viewport: Viewport }
  | null;

export function release(gesture: Gesture, point: Point): ReleaseEffect {
  switch (gesture.kind) {
    case "drag": {
      const moved = gesture.moved || passed(gesture.start, point);
      return moved
        ? { type: "drop", positions: dragPositions(gesture, point, true) }
        : { type: "click-card", key: gesture.pressed, additive: gesture.additive };
    }
    case "pan": {
      const moved = gesture.moved || passed(gesture.start, point);
      return moved
        ? { type: "pan-end", viewport: panViewport(gesture, point) }
        : { type: "click-background" };
    }
    case "lasso":
      return { type: "lasso-end", rect: normalizeRect(gesture.start, point) };
    default:
      return null;
  }
}

// A cancelled pointer (system gesture, lost capture) restores where things were.
export function cancel(gesture: Gesture): MoveEffect {
  if (gesture.kind === "drag" && gesture.moved)
    return { type: "positions", positions: { ...gesture.origins } };
  if (gesture.kind === "pan" && gesture.moved)
    return { type: "viewport", viewport: gesture.origin };
  return null;
}

export function wheel(
  v: Viewport,
  e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; point: Point }
): Viewport {
  // macOS trackpad pinch arrives as a wheel event with ctrlKey set.
  if (e.ctrlKey || e.metaKey) return zoomAt(v, Math.exp(-e.deltaY * WHEEL_ZOOM_RATE), e.point);
  return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
}

export type KeyAction =
  | { type: "focusMove"; dir: Direction }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "open" }
  | { type: "toggleSelect" }
  | { type: "clearSelection" }
  | { type: "remove" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "resetView" }
  | { type: "enterCards" };

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
const STEP: Record<Direction, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

export function keyAction(
  e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  onCard: boolean
): KeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const dir = ARROWS[e.key];
  if (dir && onCard) {
    if (e.shiftKey) return { type: "nudge", dx: STEP[dir][0] * GRID, dy: STEP[dir][1] * GRID };
    return { type: "focusMove", dir };
  }
  if (dir) return { type: "enterCards" };
  if (e.key === "+" || e.key === "=") return { type: "zoomIn" };
  if (e.key === "-") return { type: "zoomOut" };
  if (e.key === "0") return { type: "resetView" };
  if (e.key === "Escape") return { type: "clearSelection" };
  if (!onCard) return null;
  if (e.key === "Enter") return { type: "open" };
  if (e.key === " ") return { type: "toggleSelect" };
  if (e.key === "Delete" || e.key === "Backspace") return { type: "remove" };
  return null;
}
