import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

/** Reservations belong to the nearest ToastProvider, never to the window globally. */
export const ToastPlacementContext = createContext<
  ((owner: symbol, bottomInset: number | null) => void) | undefined
>(undefined);

/** Keep standard workspace toasts above a mounted bottom control surface. */
export function useToastBottomBoundary(ref: RefObject<HTMLElement | null>) {
  const reserve = useContext(ToastPlacementContext);
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
