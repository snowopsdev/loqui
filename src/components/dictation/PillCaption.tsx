import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

export function PillCaption({
  children,
  horizontalDirection,
  elementRef,
}: {
  children: ReactNode;
  horizontalDirection: "left" | "right";
  elementRef?: RefObject<HTMLDivElement | null>;
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
      const preferred = horizontalDirection === "left" ? anchor.x : anchor.x + anchor.width - width;
      const left = Math.max(12, Math.min(preferred, window.innerWidth - 12 - width));
      element.style.left = `${left - anchor.x}px`;
      element.style.right = "auto";
      element.style.maxHeight = `${Math.max(0, anchor.y - 8 - 12)}px`;
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
  }, [captionRef, horizontalDirection, children]);
  return (
    <div
      ref={captionRef}
      className="pill-caption"
      tabIndex={0}
      data-direction={horizontalDirection}
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}
