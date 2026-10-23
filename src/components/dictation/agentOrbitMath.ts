import { LEVEL_BARS_SILENCE_FLOOR, type LevelBarsFrame } from "../ui/levelBarsMath";

export const AGENT_TICK_COUNT = 24;
export const AGENT_TICK_SAMPLE_MS = 80;

/**
 * Length of radial tick `index` for a level in 0..1 (showcase formula). Under
 * reduced motion the per-tick phase is flat, matching LevelBars. Non-finite
 * levels rest at 2px.
 */
export function agentTickLength(
  index: number,
  level: number,
  timeMs: number,
  reduce = false
): number {
  const safe = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const w = reduce
    ? 0.5
    : 0.5 + 0.5 * Math.sin(timeMs / 130 + index * 1.7) * Math.sin(timeMs / 310 + index * 0.6);
  return Math.round((2 + safe * w * 9) * 100) / 100;
}

/**
 * The same normalisation LevelBars uses: raw below the silence floor is
 * silence, otherwise level / decaying peak. `frame` comes from
 * nextLevelBarsFrame, so the ticks and the bars agree on what "loud" is.
 */
export function agentTickLevel(frame: LevelBarsFrame, raw: unknown): number {
  const sane = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  if (sane < LEVEL_BARS_SILENCE_FLOOR || !(frame.peak > 0)) return 0;
  return Math.min(1, sane / frame.peak);
}
