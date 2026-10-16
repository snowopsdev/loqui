// Roving-tabindex arrow handling for radio groups and option grids.
// Pure, so keyboard behaviour is testable without a DOM.

export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

// A vertical list moves with Up/Down; Left/Right are the secondary pair and
// swap in right-to-left layouts. Returns `index` unchanged for any other key.
export function stepLinear(
  index: number,
  key: string,
  disabled: readonly boolean[],
  rtl = false
): number {
  const n = disabled.length;
  if (n === 0 || disabled.every(Boolean)) return index;
  const scan = (from: number, dir: 1 | -1) => {
    let i = from;
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      if (!disabled[i]) return i;
    }
    return index;
  };
  const previous = rtl ? "ArrowRight" : "ArrowLeft";
  const next = rtl ? "ArrowLeft" : "ArrowRight";
  switch (key) {
    case "ArrowDown":
    case next:
      return scan(index, 1);
    case "ArrowUp":
    case previous:
      return scan(index, -1);
    case "Home":
      return scan(n - 1, 1);
    case "End":
      return scan(0, -1);
    default:
      return index;
  }
}
