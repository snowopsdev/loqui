// settingsSearchKeys.ts: keyboard rules for Settings search (SET-R2 A), pure so they are unit-tested.
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function isSearchShortcut(
  e: KeyLike,
  ctx: { typing: boolean; capturing: boolean }
): boolean {
  if (ctx.capturing) return false;
  if (e.key.toLowerCase() === "f") return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  return e.key === "/" && !ctx.typing && !e.metaKey && !e.ctrlKey && !e.altKey;
}

const TYPING = "input, textarea, select, [contenteditable='true'], [role='combobox']";

export function isTypingTarget(target: unknown): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return !!el?.closest?.(TYPING);
}

export function stepActiveIndex(index: number, count: number, key: string): number {
  if (count <= 0) return 0;
  const current = Math.min(Math.max(index, 0), count - 1);
  if (key === "ArrowDown") return Math.min(current + 1, count - 1);
  if (key === "ArrowUp") return Math.max(current - 1, 0);
  return current;
}
