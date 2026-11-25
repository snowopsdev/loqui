import * as React from "react";

/**
 * Keeps a Radix dialog open when the click that dismissed a layer *above* it
 * lands on the dialog's own overlay.
 *
 * While a layer that disables outside pointer events is open over a dialog — a
 * popper (Select/Popover/DropdownMenu) or a stacked dialog — Radix sets
 * `pointer-events: none` on the dialog's content. A click aimed at the panel
 * therefore misses the content entirely and hits the full-viewport overlay
 * behind it, which Radix registers as the dialog's own dismiss affordance.
 *
 * Radix also defers a dialog's outside-click dismissal to a one-time document
 * `click` listener. By the time it runs, the upper layer has already closed and
 * handed pointer events back, so the check no longer sees anything above and
 * dismisses the dialog. So "was something above us" has to be snapshotted at
 * pointerdown capture time, ahead of every Radix handler.
 */

/** The subset of `Document` the probe reads, so the policy stays unit-testable. */
export interface LayerProbe {
  querySelector(selectors: string): Element | null;
  querySelectorAll(selectors: string): ArrayLike<Element>;
}

export function hasLayerAbove(content: HTMLElement | null, doc: LayerProbe): boolean {
  if (!content) return false;
  // Radix only writes `none` here when a higher layer disabled outside pointer
  // events — the exact condition that misroutes the click onto the overlay.
  if (content.style.pointerEvents === "none") return true;
  if (doc.querySelector("[data-radix-popper-content-wrapper]")) return true;
  // Later-mounted portals stack on top, so the last open dialog in DOM order is
  // the topmost one.
  const openDialogs = doc.querySelectorAll('[role="dialog"][data-state="open"]');
  return openDialogs.length > 0 && openDialogs[openDialogs.length - 1] !== content;
}

/**
 * Exit animations keep dialog content mounted while it fades out, and Radix
 * marks it `data-state="closed"` for that whole time. Make it `inert` then, so
 * no pointer input (even on `pointer-events-auto` descendants) or keyboard
 * input reaches content that has already been dismissed.
 */
export function inertWhileClosed(node: HTMLElement): () => void {
  // Inert content drops focus to <body>. Reopened mid-fade, the content is
  // reused rather than remounted, so Radix won't auto-focus it again: put focus
  // back where it was (or on the content itself) when it reopens.
  let restoreFocus: HTMLElement | null = null;
  const sync = () => {
    const closed = node.getAttribute("data-state") === "closed";
    if (closed === node.inert) return;
    if (closed) {
      const active = node.ownerDocument?.activeElement as HTMLElement | null | undefined;
      restoreFocus = active && node.contains(active) ? active : null;
      node.inert = true;
      return;
    }
    node.inert = false;
    const target = restoreFocus?.isConnected && node.contains(restoreFocus) ? restoreFocus : node;
    restoreFocus = null;
    target.focus({ preventScroll: true });
    // A disabled or hidden element silently refuses focus; fall back to the content.
    if (!node.contains(node.ownerDocument?.activeElement ?? null))
      node.focus({ preventScroll: true });
  };
  sync();
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(sync);
  observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });
  return () => observer.disconnect();
}

interface OutsideEvent {
  detail: { originalEvent: Event };
}

export function useDismissGuard<T extends HTMLElement>(forwardedRef?: React.ForwardedRef<T>) {
  const contentRef = React.useRef<T | null>(null);
  const stopInertSync = React.useRef<(() => void) | null>(null);
  const layerWasAboveRef = React.useRef(false);

  React.useEffect(() => {
    const snapshotLayersAbove = () => {
      layerWasAboveRef.current = hasLayerAbove(contentRef.current, document);
    };
    document.addEventListener("pointerdown", snapshotLayersAbove, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", snapshotLayersAbove, { capture: true });
    };
  }, []);

  /** Ref for the dialog content, composed with the caller's forwarded ref. */
  const registerContent = React.useCallback(
    (node: T | null) => {
      stopInertSync.current?.();
      stopInertSync.current = node ? inertWhileClosed(node) : null;
      contentRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef]
  );

  const shouldBlockDismiss = React.useCallback((event: OutsideEvent) => {
    // Focus-outside dismissals would read a snapshot left over from the last
    // pointerdown, however long ago — the guard is pointer-only.
    if (event.detail.originalEvent.type !== "pointerdown") return false;
    return layerWasAboveRef.current;
  }, []);

  return { registerContent, shouldBlockDismiss };
}
