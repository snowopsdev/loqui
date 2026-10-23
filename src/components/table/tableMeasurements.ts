/** One native delivery for all current Table cards, including intrinsic reflow. */
export function createTableMeasurements() {
  let observer: ResizeObserver | null = null;
  const targets = new Map<Element, () => void | (() => void)>();
  return {
    observe(outer: HTMLElement, body: HTMLElement | null, measure: () => void | (() => void)) {
      if (typeof ResizeObserver === "undefined") return () => {};
      observer ??= new ResizeObserver((entries) => {
        const affected = new Set(entries.map((entry) => targets.get(entry.target)));
        const paints: Array<() => void> = [];
        for (const callback of affected) {
          const paint = callback?.();
          if (paint) paints.push(paint);
        }
        for (const paint of paints) paint();
      });
      const owned = body ? [outer, body] : [outer];
      for (const target of owned) {
        targets.set(target, measure);
        observer.observe(target);
      }
      return () => {
        for (const target of owned) {
          targets.delete(target);
          observer?.unobserve(target);
        }
      };
    },
    dispose() {
      targets.clear();
      observer?.disconnect();
      observer = null;
    },
  };
}

export type TableMeasurements = ReturnType<typeof createTableMeasurements>;
