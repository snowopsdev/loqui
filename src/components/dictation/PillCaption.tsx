import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

export function PillCaption({
  children,
  horizontalDirection,
  elementRef,
  gapPx = 8,
  role = "status",
  className,
}: {
  children: ReactNode;
  horizontalDirection: "left" | "right" | "center";
  elementRef?: RefObject<HTMLDivElement | null>;
  /** Extra clearance for the Agent listening ticks, within the same fixed window. */
  gapPx?: number;
  /** Tooltip reuses the same bounded reading surface without live announcements. */
  role?: "status" | "tooltip";
  className?: string;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const captionRef = elementRef ?? ownRef;
  useLayoutEffect(() => {
    const element = captionRef.current;
    if (!element) return;
    const fit = () => {
      const anchor = element.parentElement?.getBoundingClientRect();
      if (!anchor) return;
      const width = element.getBoundingClientRect().width;
      const preferred =
        horizontalDirection === "left"
          ? anchor.x
          : horizontalDirection === "center"
            ? anchor.x + (anchor.width - width) / 2
            : anchor.x + anchor.width - width;
      const left = Math.max(12, Math.min(preferred, window.innerWidth - 12 - width));
      element.style.left = `${left - anchor.x}px`;
      element.style.right = "auto";
      element.style.maxHeight = `${Math.max(0, anchor.y - gapPx - 12)}px`;
    };
    fit();
    // Track actual moving dock/footprint geometry, including CSS travel during
    // panel return. This bounded functional sampling exists only with a caption.
    const timer = setInterval(fit, 50);
    window.addEventListener("resize", fit);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", fit);
    };
  }, [captionRef, horizontalDirection, children, gapPx]);
  return (
    <div
      ref={captionRef}
      className={`pill-caption${className ? ` ${className}` : ""}`}
      style={gapPx === 8 ? undefined : { bottom: `calc(100% + ${gapPx}px)` }}
      tabIndex={0}
      data-direction={horizontalDirection}
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
    >
      {children}
    </div>
  );
}
