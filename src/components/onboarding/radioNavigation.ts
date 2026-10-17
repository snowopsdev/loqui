// Radio-group keyboard model (WAI-ARIA APG): arrows move and select, skipping
// disabled options and wrapping; left/right follow reading direction.
export function nextRadioIndex(
  current: number,
  key: string,
  disabled: readonly boolean[],
  dir: "ltr" | "rtl" = "ltr"
): number | null {
  const count = disabled.length;
  if (count === 0 || disabled.every(Boolean)) return null;
  const step = (from: number, delta: 1 | -1): number | null => {
    let index = from;
    for (let tries = 0; tries < count; tries++) {
      index = (index + delta + count) % count;
      if (!disabled[index]) return index;
    }
    return null;
  };
  const forward = ["ArrowDown", dir === "rtl" ? "ArrowLeft" : "ArrowRight"];
  const backward = ["ArrowUp", dir === "rtl" ? "ArrowRight" : "ArrowLeft"];
  if (key === "Home") return step(count - 1, 1);
  if (key === "End") return step(0, -1);
  if (forward.includes(key)) return step(current, 1);
  if (backward.includes(key)) return step(current, -1);
  return null;
}

export function rovingTabIndex(
  index: number,
  selected: number,
  disabled: readonly boolean[]
): 0 | -1 {
  const stop =
    selected >= 0 && !disabled[selected] ? selected : disabled.findIndex((value) => !value);
  return index === stop ? 0 : -1;
}
