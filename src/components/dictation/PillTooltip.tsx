import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { PillCaption } from "./PillCaption";

interface PillTooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  emoji?: string;
  align?: "left" | "right" | "center";
  disabled?: boolean;
  elementRef?: React.RefObject<HTMLDivElement | null>;
  onVisibilityChange?: (visible: boolean) => void;
}

/** The tooltip shares the caption's bounded, scrollable physical-dock geometry. */
export function PillTooltip({
  children,
  content,
  emoji,
  align = "center",
  disabled = false,
  elementRef,
  onVisibilityChange,
}: PillTooltipProps): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visible = (hovered || focused) && !disabled;
  useLayoutEffect(() => {
    // Removing a focused bubble need not dispatch blur. Reconcile after the
    // commit, preserving focus on a trigger that actually remains mounted.
    const anchor = anchorRef.current;
    if (focused && !anchor?.contains(anchor.ownerDocument.activeElement)) setFocused(false);
  }, [disabled, focused, children, content]);
  useEffect(() => {
    onVisibilityChange?.(visible);
    return () => onVisibilityChange?.(false);
  }, [visible, onVisibilityChange]);

  // These anchors follow the physical screen dock even for RTL text.
  const arrowClass =
    align === "right" ? "right-3" : align === "left" ? "left-3" : "left-1/2 -translate-x-1/2";

  return (
    <div
      ref={anchorRef}
      className="pill-tooltip-anchor relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {children}
      {visible && (
        <>
          <PillCaption
            elementRef={elementRef}
            horizontalDirection={align}
            role="tooltip"
            className="pill-tooltip text-xs rounded-lg"
          >
            <span className="flex flex-col gap-0.5">
              {emoji && <span>{emoji}</span>}
              {content}
            </span>
          </PillCaption>
          <span
            aria-hidden="true"
            className={`absolute bottom-full ${arrowClass} mb-1.5 z-10 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-popover`}
          />
        </>
      )}
    </div>
  );
}
