import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

/** Reservations belong to the nearest NoticeProvider, never to the window globally. */
export const NoticePlacementContext = createContext<
  ((owner: symbol, bottomInset: number | null) => void) | undefined
>(undefined);

/** Keep standard workspace notices above a mounted bottom control surface. */
export function useNoticeBottomBoundary(ref: RefObject<HTMLElement | null>) {
  const reserve = useContext(NoticePlacementContext);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!reserve || !element) return;
    const owner = Symbol();
    let active = true;
    const measure = () => {
      if (!active) return;
      const rect = element.getBoundingClientRect();
      reserve(owner, rect.height > 0 ? Math.max(0, window.innerHeight - rect.top) : 0);
    };
    measure();
    const observer = new window.ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      reserve(owner, null);
    };
  }, [ref, reserve]);
}
