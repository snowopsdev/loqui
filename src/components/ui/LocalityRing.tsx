import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import type { Locality } from "../../lib/locality";

export interface LocalityRingProps {
  locality: Locality;
  label: string;
  size?: number;
  className?: string;
  children?: ReactNode;
}

// One solid ring for every locality; hue tells device, network and remote
// apart, and the label names the destination for assistive tech.
export function LocalityRing({
  locality,
  label,
  size = 24,
  className,
  children,
}: LocalityRingProps) {
  return (
    <span
      role="img"
      aria-label={label}
      data-locality={locality}
      className={cn("locality-ring", className)}
      style={{ width: size, height: size }}
    >
      <svg className="locality-ring__svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10.75" />
      </svg>
      {children ? <span className="locality-ring__content">{children}</span> : null}
    </span>
  );
}
