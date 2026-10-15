import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import {
  LEVEL_BARS_REDUCED_SAMPLE_MS,
  LEVEL_BARS_SAMPLE_MS,
  LOGO_BAR_SHAPE,
  barPhase,
  levelBarScale,
  smoothToward,
} from "./levelBarsMath";

// Normalise against a decaying session peak so any mic gain fills the range
// (same approach as LiveWaveform).
const PEAK_FLOOR = 0.01;
const PEAK_DECAY = 0.99;
const SMOOTHING = 0.3;
const BAR_GRADIENT = "linear-gradient(180deg, #ff6a36, #e6007a)";

export interface LevelBarsProps {
  readLevel: () => number;
  height?: number;
  className?: string;
}

export function LevelBars({ readLevel, height = 20, className }: LevelBarsProps) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const peakRef = useRef(PEAK_FLOOR);
  const scalesRef = useRef<number[]>(LOGO_BAR_SHAPE.map((_, i) => levelBarScale(i, 0, 0.5)));
  const barWidth = Math.max(2, Math.round(height * 0.18));

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const id = setInterval(
      () => {
        const raw = readLevel();
        const level = Number.isFinite(raw) ? Math.max(0, raw) : 0;
        peakRef.current = Math.max(level, peakRef.current * PEAK_DECAY, PEAK_FLOOR);
        const norm = level / peakRef.current;
        const now = performance.now();
        LOGO_BAR_SHAPE.forEach((_, i) => {
          const target = levelBarScale(i, norm, barPhase(i, now));
          const next = reduce ? target : smoothToward(scalesRef.current[i], target, SMOOTHING);
          scalesRef.current[i] = next;
          const bar = barRefs.current[i];
          if (bar) bar.style.transform = `scaleY(${next})`;
        });
      },
      reduce ? LEVEL_BARS_REDUCED_SAMPLE_MS : LEVEL_BARS_SAMPLE_MS
    );
    return () => clearInterval(id);
  }, [readLevel]);

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
            transform: `scaleY(${scalesRef.current[i]})`,
          }}
        />
      ))}
    </span>
  );
}
