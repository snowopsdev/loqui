import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

/** Reservations belong to the nearest NoticeProvider, never to the window globally. */
export const NoticePlacementContext = createContext<
  ((owner: symbol, bottomInset: number | null) => void) | undefined
>(undefined);

// A surface counts as a bottom control surface while its top is in the window
// and its bottom reaches this band at the window's bottom edge. A composer
// mid-page or scrolled away leaves the default placement, and a surface above
// the window can never push notices off screen.
const BOTTOM_BAND_PX = 96;

/**
 * Keep standard workspace notices above a mounted bottom control surface.
 * `enabled` lets a host reserve a surface that mounts or hides after the host.
 */
export function useNoticeBottomBoundary(ref: RefObject<HTMLElement | null>, enabled = true) {
  const reserve = useContext(NoticePlacementContext);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!reserve || !element || !enabled) return;
    const owner = Symbol();
    let active = true;
    const measure = () => {
      if (!active) return;
      const rect = element.getBoundingClientRect();
      const height = window.innerHeight;
      const docked =
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.top < height &&
        rect.top + rect.height >= height - BOTTOM_BAND_PX;
      reserve(owner, docked ? height - rect.top : 0);
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
  }, [ref, reserve, enabled]);
}
