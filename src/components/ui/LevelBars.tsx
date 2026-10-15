import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import { LOGO_BAR_SHAPE, levelBarScale } from "./levelBarsMath";
import { startLevelBarsSampler } from "./levelBarsSampler";

const BAR_GRADIENT = "linear-gradient(180deg, #ff6a36, #e6007a)";

export interface LevelBarsProps {
  readLevel: () => number;
  height?: number;
  className?: string;
}

export function LevelBars({ readLevel, height = 20, className }: LevelBarsProps) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const frameRef = useRef({
    scales: LOGO_BAR_SHAPE.map((_, i) => levelBarScale(i, 0, 0.5)),
    peak: 0.01,
  });
  // Callers pass inline closures; keep the latest without restarting the timer.
  const readLevelRef = useRef(readLevel);
  readLevelRef.current = readLevel;
  const barWidth = Math.max(2, Math.round(height * 0.18));

  useEffect(
    () =>
      startLevelBarsSampler({
        frameRef,
        readLevel: () => readLevelRef.current(),
        onFrame: (frame) => {
          frame.scales.forEach((scale, i) => {
            const bar = barRefs.current[i];
            if (bar) bar.style.transform = `scaleY(${scale})`;
          });
        },
      }),
    []
  );

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex items-center", className)}
      style={{ height, gap: Math.round(barWidth * 0.8) }}
    >
      {LOGO_BAR_SHAPE.map((_, i) => (
        <span
          key={i}
          data-level-bar=""
          ref={(el) => {
            barRefs.current[i] = el;
          }}
          className="block rounded-full"
          style={{
            width: barWidth,
            height,
            background: BAR_GRADIENT,
            transform: `scaleY(${frameRef.current.scales[i]})`,
          }}
        />
      ))}
    </span>
  );
}
