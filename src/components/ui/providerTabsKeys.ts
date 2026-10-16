export type TabDirection = "ltr" | "rtl";

/** Move focus in reading order, skipping disabled tabs and wrapping. */
export function nextEnabledTabIndex(
  disabled: readonly boolean[],
  current: number,
  key: string,
  direction: TabDirection
): number | null {
  const count = disabled.length;
  if (count === 0) return null;
  const forward = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  const backward = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
  let start: number;
  let step: number;
  if (key === forward) [start, step] = [current + 1, 1];
  else if (key === backward) [start, step] = [current - 1, -1];
  else if (key === "Home") [start, step] = [0, 1];
  else if (key === "End") [start, step] = [count - 1, -1];
  else return null;
  for (let i = 0; i < count; i++) {
    const index = (((start + i * step) % count) + count) % count;
    if (!disabled[index]) return index;
  }
  return null;
}
