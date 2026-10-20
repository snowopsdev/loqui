// Pure geometry for The Table (WS-M5). World coordinates are physical pixels
// at 100%; the viewport maps them to the screen: screen = world * scale + (x, y).
// The canvas is spatial like a map, so arrows and coordinates do not mirror in RTL.

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Viewport { x: number; y: number; scale: number }
export interface Size { width: number; height: number }
export type Direction = "left" | "right" | "up" | "down";
export interface Placed { id: string; rect: Rect }

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;
export const GRID = 8;
export const DOT_GRID = 24;
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function clampScale(scale: number): number {
  return Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : 1;
}

export function screenToWorld(p: Point, v: Viewport): Point {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

export function worldToScreen(p: Point, v: Viewport): Point {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

export function zoomAt(v: Viewport, factor: number, anchor: Point): Viewport {
  const scale = Number.isFinite(factor) ? clampScale(v.scale * factor) : clampScale(Number.NaN);
  const k = scale / v.scale;
  return { scale, x: anchor.x - (anchor.x - v.x) * k, y: anchor.y - (anchor.y - v.y) * k };
}

export function snapToGrid(n: number, grid: number = GRID): number {
  return Math.round(n / grid) * grid;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function lassoSelect(items: Placed[], screenRect: Rect, v: Viewport): string[] {
  const world: Rect = {
    x: (screenRect.x - v.x) / v.scale,
    y: (screenRect.y - v.y) / v.scale,
    w: screenRect.w / v.scale,
    h: screenRect.h / v.scale,
  };
  return items.filter((item) => rectsIntersect(item.rect, world)).map((item) => item.id);
}

export function visibleIds(
  items: Placed[],
  v: Viewport,
  size: Size,
  always: Iterable<string> = [],
  margin = 1.5
): Set<string> {
  const extraW = (size.width * (margin - 1)) / 2;
  const extraH = (size.height * (margin - 1)) / 2;
  const world: Rect = {
    x: (-extraW - v.x) / v.scale,
    y: (-extraH - v.y) / v.scale,
    w: (size.width * margin) / v.scale,
    h: (size.height * margin) / v.scale,
  };
  const out = new Set<string>(always);
  for (const item of items) if (rectsIntersect(item.rect, world)) out.add(item.id);
  return out;
}

export function ensureVisible(rect: Rect, v: Viewport, size: Size, pad = 24): Viewport {
  const s = worldToScreen(rect, v);
  const w = rect.w * v.scale;
  const h = rect.h * v.scale;
  let dx = 0;
  let dy = 0;
  if (s.x < pad) dx = pad - s.x;
  else if (s.x + w > size.width - pad) dx = size.width - pad - (s.x + w);
  if (s.y < pad) dy = pad - s.y;
  else if (s.y + h > size.height - pad) dy = size.height - pad - (s.y + h);
  return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
}

const DIRS: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function nearestInDirection(fromId: string, items: Placed[], dir: Direction): string | null {
  const from = items.find((item) => item.id === fromId);
  if (!from) return null;
  const [ux, uy] = DIRS[dir];
  const origin = center(from.rect);
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.id === fromId) continue;
    const c = center(item.rect);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const along = dx * ux + dy * uy;
    const across = Math.abs(dx * uy) + Math.abs(dy * ux);
    if (along > 0 && along * 1.2 > across) {
      const score = along + across * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = item.id;
      }
    }
  }
  return best;
}

export function connectorPath(a: Rect, b: Rect): string {
  const ac = center(a);
  const bc = center(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if (Math.abs(dx) > Math.abs(dy) * 0.8) {
    const x1 = a.x + (dx > 0 ? a.w : 0);
    const x2 = b.x + (dx > 0 ? 0 : b.w);
    const m = (x2 - x1) / 2;
    return `M${round1(x1)} ${round1(ac.y)} C${round1(x1 + m)} ${round1(ac.y)} ${round1(x2 - m)} ${round1(bc.y)} ${round1(x2)} ${round1(bc.y)}`;
  }
  const y1 = a.y + (dy > 0 ? a.h : 0);
  const y2 = b.y + (dy > 0 ? 0 : b.h);
  const n = (y2 - y1) / 2;
  return `M${round1(ac.x)} ${round1(y1)} C${round1(ac.x)} ${round1(y1 + n)} ${round1(bc.x)} ${round1(y2 - n)} ${round1(bc.x)} ${round1(y2)}`;
}

export function autoPlace(
  sizes: Array<{ w: number; h: number }>,
  occupied: Rect[],
  columns = 4,
  gap = 32
): Point[] {
  if (sizes.length === 0) return [];
  const top = occupied.length ? Math.max(...occupied.map((r) => r.y + r.h)) + gap * 2 : 32;
  const left = occupied.length ? Math.min(...occupied.map((r) => r.x)) : 32;
  const colW = Math.max(...sizes.map((s) => s.w)) + gap;
  const rowH = Math.max(...sizes.map((s) => s.h)) + gap;
  return sizes.map((_, i) => ({
    x: snapToGrid(left + (i % columns) * colW),
    y: snapToGrid(top + Math.floor(i / columns) * rowH),
  }));
}

export function fitViewport(rects: Rect[], size: Size, pad = 48): Viewport {
  if (rects.length === 0) return DEFAULT_VIEWPORT;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = round3(clampScale(Math.min((size.width - pad * 2) / bw, (size.height - pad * 2) / bh, 1)));
  return {
    scale,
    x: round1((size.width - bw * scale) / 2 - minX * scale),
    y: round1((size.height - bh * scale) / 2 - minY * scale),
  };
}
