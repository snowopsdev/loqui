import { useEffect, useRef } from "react";
import { LOGO_BAR_SHAPE, levelBarScale, nextLevelBarsFrame } from "../ui/levelBarsMath";
import {
  AGENT_TICK_COUNT,
  AGENT_TICK_SAMPLE_MS,
  agentTickLength,
  agentTickLevel,
} from "./agentOrbitMath";

// 20 + 11px tick + 1px round cap fits the 32px half-viewport at either dock.
const R = 20;

function tickEnd(index: number, length: number) {
  const a = (index / AGENT_TICK_COUNT) * Math.PI * 2;
  return { x: 32 + Math.sin(a) * (R + length), y: 32 - Math.cos(a) * (R + length) };
}

/**
 * Agent Mode identity (VO-R8 B). Listening: 24 violet radial ticks driven by
 * the level feed. Thinking: a 2.4s conic orbit with two satellites (slower
 * than dictation's 1.6s comet, "thinking" not "working"). Answering: a 1.2s
 * spin-up that dissolves on the exit tokens. Mounted only in those phases, so
 * its loops are gated. The screen-context glyph was cut (owner note, D9); the caption
 * above the pill says when screen context is on and where it goes.
 */
export function AgentOrbit({
  phase,
  readLevel,
}: {
  phase: "listening" | "thinking" | "answering";
  readLevel: () => number;
}) {
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  // Same pattern as LevelBars: keep the latest reader without restarting the timer.
  const readLevelRef = useRef(readLevel);
  readLevelRef.current = readLevel;

  useEffect(() => {
    if (phase !== "listening") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = { scales: LOGO_BAR_SHAPE.map((_, i) => levelBarScale(i, 0, 0.5)), peak: 0.01 };
    let level = 0;
    let last = performance.now();
    const id = setInterval(
      () => {
        const now = performance.now();
        let raw: unknown = 0;
        try {
          raw = readLevelRef.current();
        } catch {
          raw = 0;
        }
        // nextLevelBarsFrame owns the decaying peak and the silence floor.
        frame = nextLevelBarsFrame(frame, raw, now, now - last, reduce);
        last = now;
        const target = agentTickLevel(frame, raw);
        level = reduce ? target : level + (target - level) * 0.35;
        lineRefs.current.forEach((line, i) => {
          if (!line) return;
          const end = tickEnd(i, agentTickLength(i, level, now, reduce));
          line.setAttribute("x2", String(end.x));
          line.setAttribute("y2", String(end.y));
        });
      },
      reduce ? 100 : AGENT_TICK_SAMPLE_MS
    );
    return () => clearInterval(id);
  }, [phase]);

  return (
    <span className="agent-orbit" data-phase={phase} aria-hidden="true">
      {phase === "listening" ? (
        <svg className="agent-orbit__ticks" viewBox="0 0 64 64" overflow="visible">
          {Array.from({ length: AGENT_TICK_COUNT }, (_, i) => {
            const start = tickEnd(i, 0);
            const end = tickEnd(i, 2);
            return (
              <line
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
              />
            );
          })}
        </svg>
      ) : (
        <>
          <span className="agent-orbit__ring" />
          <span className="agent-orbit__satellite" />
          <span className="agent-orbit__satellite agent-orbit__satellite--b" />
        </>
      )}
    </span>
  );
}
