import { useCallback, useEffect, useReducer, useRef } from "react";

export const HOVER_CARD_CLOSE_DELAY_MS = 150;

export type HoverCardEvent =
  | { type: "pointerEnter" }
  | { type: "pointerLeave"; keepOpen?: boolean }
  | { type: "focusIn" }
  | { type: "focusOut"; staysInside: boolean; keepOpen?: boolean }
  | { type: "escape" }
  | { type: "closeTimer" };

export interface HoverCardState {
  open: boolean;
  closing: boolean;
  /** Escape closed it; focus returning to the trigger must not reopen it. */
  dismissed: boolean;
}

const CLOSED: HoverCardState = { open: false, closing: false, dismissed: false };

export function hoverCardReducer(state: HoverCardState, event: HoverCardEvent): HoverCardState {
  switch (event.type) {
    case "pointerEnter":
      return { open: true, closing: false, dismissed: false };
    case "focusIn":
      // The focus Escape returns to the chip lands here: stay closed until
      // focus or the pointer has left the boundary (dismissed-until-leave).
      return state.dismissed ? state : { open: true, closing: false, dismissed: false };
    case "pointerLeave":
      if (event.keepOpen) return { ...state, dismissed: false };
      return state.open ? { ...state, closing: true } : { ...state, dismissed: false };
    case "focusOut":
      if (event.staysInside) return state;
      return event.keepOpen && state.open ? { ...state, dismissed: false } : CLOSED;
    case "escape":
      return { open: false, closing: false, dismissed: true };
    case "closeTimer":
      return state.closing ? CLOSED : state;
  }
}

export function useHoverCard(triggerRef: React.RefObject<HTMLElement | null>) {
  const pointerInside = useRef(false);
  const focusInside = useRef(false);
  const [state, dispatch] = useReducer(hoverCardReducer, CLOSED);
  useEffect(() => {
    if (!state.closing) return;
    const id = window.setTimeout(() => dispatch({ type: "closeTimer" }), HOVER_CARD_CLOSE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [state.closing]);
  const boundary = {
    onMouseEnter: useCallback(() => {
      pointerInside.current = true;
      dispatch({ type: "pointerEnter" });
    }, []),
    onMouseLeave: useCallback(() => {
      pointerInside.current = false;
      dispatch({ type: "pointerLeave", keepOpen: focusInside.current });
    }, []),
    onFocus: useCallback(() => {
      focusInside.current = true;
      dispatch({ type: "focusIn" });
    }, []),
    onBlur: useCallback((e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      const staysInside = !!next && e.currentTarget.contains(next);
      focusInside.current = staysInside;
      dispatch({ type: "focusOut", staysInside, keepOpen: pointerInside.current });
    }, []),
    onKeyDown: useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        dispatch({ type: "escape" });
        triggerRef.current?.focus();
      },
      [triggerRef]
    ),
  };
  return { open: state.open, boundary };
}
