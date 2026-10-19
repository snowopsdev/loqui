import type { ReactNode } from "react";

export function PillCaption({
  children,
  horizontalDirection,
}: {
  children: ReactNode;
  horizontalDirection: "left" | "right";
}) {
  return (
    <div
      className="pill-caption"
      data-direction={horizontalDirection}
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}
