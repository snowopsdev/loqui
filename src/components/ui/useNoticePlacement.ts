import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

/** Reservations belong to the nearest NoticeProvider, never to the window globally. */
export const NoticePlacementContext = createContext<
  ((owner: symbol, bottomInset: number | null) => void) | undefined
>(undefined);

// A surface counts as a bottom control surface while its top is in the window
// and its bottom reaches this band at the window's bottom edge. Any other
// on-screen surface is reserved only while the panel stack, at its default
// place, would actually cover it (vertical and horizontal overlap). A surface
// scrolled above the window can never push notices off screen.
const BOTTOM_BAND_PX = 96;
// notices.css: `.notice-stack[data-placement="panel"] { bottom: 20px }`.
const PANEL_STACK_BOTTOM_PX = 20;

// The panel NoticeStack registers its element here, so a composer measures the
// real stack (its height grows with each card or chip) instead of guessing.
let panelStack: HTMLElement | null = null;
const panelStackListeners = new Set<() => void>();
export function registerPanelNoticeStack(element: HTMLElement | null): void {
  panelStack = element;
  for (const listener of panelStackListeners) listener();
}

function stackWouldCover(rect: DOMRect, height: number): boolean {
  const stack = panelStack?.getBoundingClientRect();
  if (!stack || !(stack.height > 0)) return false;
  const defaultTop = height - PANEL_STACK_BOTTOM_PX - stack.height;
  const across = stack.left < rect.right && stack.right > rect.left;
  return across && defaultTop < rect.top + rect.height;
}

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
      const onScreen = rect.height > 0 && rect.top >= 0 && rect.top < height;
      const docked = rect.top + rect.height >= height - BOTTOM_BAND_PX;
      reserve(owner, onScreen && (docked || stackWouldCover(rect, height)) ? height - rect.top : 0);
    };
    const observer = new window.ResizeObserver(measure);
    let observedStack: HTMLElement | null = null;
    const followStack = () => {
      if (observedStack === panelStack) return;
      if (observedStack) observer.unobserve?.(observedStack);
      observedStack = panelStack;
      if (observedStack) observer.observe(observedStack);
    };
    const onStackChange = () => {
      followStack();
      measure();
    };
    followStack();
    measure();
    observer.observe(element);
    panelStackListeners.add(onStackChange);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      active = false;
      observer.disconnect();
      panelStackListeners.delete(onStackChange);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      reserve(owner, null);
    };
  }, [ref, reserve, enabled]);
}
