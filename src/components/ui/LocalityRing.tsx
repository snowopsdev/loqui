import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { providerMonogram, type Locality } from "../../lib/locality";

export interface LocalityRingProps {
  locality: Locality;
  label: string;
  provider?: string | null;
  active?: boolean;
  size?: number;
  className?: string;
  children?: ReactNode;
}

// Solid ring: stays on this device. Dotted: your own server. Dashed orbit
// plus a monogram: sent to a provider. The orbit turns only while a request
// is in flight (data-active) and never under reduced motion.
export function LocalityRing({
  locality,
  label,
  provider,
  active = false,
  size = 24,
  className,
  children,
}: LocalityRingProps) {
  return (
    <span
      role="img"
      aria-label={label}
      data-locality={locality}
      data-active={active ? "true" : "false"}
      className={cn("locality-ring", className)}
      style={{ width: size, height: size }}
    >
      <svg className="locality-ring__svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10.75" pathLength="100" />
      </svg>
      {children ? <span className="locality-ring__content">{children}</span> : null}
      {locality === "remote" && provider ? (
        <span className="locality-ring__badge" aria-hidden="true">
          {providerMonogram(provider)}
        </span>
      ) : null}
    </span>
  );
}
