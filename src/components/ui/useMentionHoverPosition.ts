import { useLayoutEffect, type RefObject } from "react";

const MARGIN = 8;
const GAP = 4;
type Bounds = { left: number; right: number; top: number; bottom: number };

export function mentionHoverPosition(
  trigger: Bounds,
  size: { width: number; height: number },
  bounds: Bounds,
  rtl: boolean
) {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, Math.max(min, max)));
  const above = trigger.bottom + size.height > bounds.bottom;
  return {
    left: clamp(
      rtl ? trigger.right - size.width : trigger.left,
      bounds.left,
      bounds.right - size.width
    ),
    top: clamp(
      above ? trigger.top - size.height : trigger.bottom,
      bounds.top,
      bounds.bottom - size.height
    ),
    above,
  };
}

/** Fixed descendant keeps native Tab order and the chip/card event boundary.
 * Constrain it to the trigger's visible scroll area, including room for rings.
 */
export function useMentionHoverPosition(
  triggerRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  open: boolean,
  directionKey: string
) {
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const card = cardRef.current;
    if (!open || !trigger || !card) return;
    const win = trigger.ownerDocument.defaultView!;
    const ancestors: HTMLElement[] = [];
    for (let el = trigger.parentElement; el; el = el.parentElement) ancestors.push(el);
    const place = () => {
      const bounds = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
      for (const el of ancestors) {
        const style = win.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          bounds.left = Math.max(bounds.left, rect.left + el.clientLeft);
          bounds.right = Math.min(bounds.right, rect.left + el.clientLeft + el.clientWidth);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          bounds.top = Math.max(bounds.top, rect.top + el.clientTop);
          bounds.bottom = Math.min(bounds.bottom, rect.top + el.clientTop + el.clientHeight);
        }
      }
      const rect = trigger.getBoundingClientRect();
      const visible =
        rect.bottom > bounds.top &&
        rect.top < bounds.bottom &&
        rect.right > bounds.left &&
        rect.left < bounds.right;
      Object.assign(card.style, {
        maxWidth: `${Math.max(0, bounds.right - bounds.left - MARGIN * 2)}px`,
        maxHeight: `${Math.max(0, bounds.bottom - bounds.top - MARGIN * 2)}px`,
      });
      const position = mentionHoverPosition(
        rect,
        card.getBoundingClientRect(),
        {
          left: bounds.left + MARGIN,
          right: bounds.right - MARGIN,
          top: bounds.top + MARGIN,
          bottom: bounds.bottom - MARGIN,
        },
        win.getComputedStyle(trigger).direction === "rtl"
      );
      Object.assign(card.style, {
        left: `${position.left}px`,
        top: `${position.top}px`,
        paddingTop: position.above ? "0px" : `${GAP}px`,
        paddingBottom: position.above ? `${GAP}px` : "0px",
        visibility: visible ? "visible" : "hidden",
      });
    };
    place();
    win.addEventListener("scroll", place, true);
    win.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    for (const el of [trigger, card, ...ancestors]) observer.observe(el);
    return () => {
      win.removeEventListener("scroll", place, true);
      win.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [triggerRef, cardRef, open, directionKey]);
}
