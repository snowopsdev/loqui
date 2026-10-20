import type { CSSProperties } from "react";

export interface LiveKeycapProps {
  label: string;
  sublabel: string;
  pressed: boolean;
  size?: 56 | 84 | 96;
  demo?: boolean; // tour art: presses on a loop (never under reduced motion)
  flashKey?: number; // bump to flash one press (a tap with no key-up)
}

/** The keycap that presses when the real shortcut does (ONB-R5 C, R7 B). Decorative. */
export function LiveKeycap({
  label,
  sublabel,
  pressed,
  size = 96,
  demo = false,
  flashKey,
}: LiveKeycapProps) {
  return (
    <span
      key={flashKey}
      className="onb-keycap"
      data-pressed={pressed || undefined}
      data-demo={demo || undefined}
      data-flash={flashKey ? true : undefined}
      style={{ "--keycap-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="onb-keycap__label">{label}</span>
      <span className="onb-keycap__sub">{sublabel}</span>
    </span>
  );
}
