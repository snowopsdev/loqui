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

// Grid navigation over `count` items laid out `columns` per row, in reading
// order. Left and right follow the reading direction, so they swap when `rtl`
// is true; up and down move by a row and stop at the ends rather than wrapping.
export function stepGrid(
  index: number,
  key: string,
  opts: { columns: number; count: number; rtl: boolean }
): number {
  const { columns, count, rtl } = opts;
  if (count === 0) return index;
  const last = count - 1;
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const backward = rtl ? "ArrowRight" : "ArrowLeft";
  switch (key) {
    case forward:
      return Math.min(last, index + 1);
    case backward:
      return Math.max(0, index - 1);
    case "ArrowDown":
      return Math.min(last, index + columns);
    case "ArrowUp":
      return index - columns >= 0 ? index - columns : index;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return index;
  }
}
