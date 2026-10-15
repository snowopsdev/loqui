// The five bars of the Loqui mark, as height ratios. At rest the meter *is*
// the logo; speech grows each bar inside its own silhouette (DESIGN.md).
export const LOGO_BAR_SHAPE = [0.42, 0.7, 1, 0.7, 0.42] as const;
export const LEVEL_BARS_SAMPLE_MS = 33;
export const LEVEL_BARS_REDUCED_SAMPLE_MS = 100;

const IDLE_LEVEL = 0.12;
const REST_FACTOR = 0.55;
const LEVEL_GAIN = 1.6;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function levelBarScale(index: number, level: number, phase: number): number {
  const shape = LOGO_BAR_SHAPE[index as 0 | 1 | 2 | 3 | 4] ?? 0;
  const safeLevel = Number.isFinite(level) ? clamp01(level) : 0;
  if (safeLevel < IDLE_LEVEL) return round3(shape * REST_FACTOR);
  const gain = REST_FACTOR + (1 - REST_FACTOR) * Math.min(1, safeLevel * LEVEL_GAIN);
  const safePhase = Number.isFinite(phase) ? clamp01(phase) : 0.5;
  return round3(shape * gain * (0.7 + 0.3 * safePhase));
}

export function barPhase(index: number, timeMs: number): number {
  return (Math.sin(timeMs / 160 + index * 1.3) + 1) / 2;
}

export function smoothToward(previous: number, target: number, factor: number): number {
  return round3(previous + (target - previous) * factor);
}

// Raw input below this counts as silence, so analyser noise cannot be
// normalised up against a fully decayed peak and wobble the resting logo.
export const LEVEL_BARS_SILENCE_FLOOR = 0.004;

const PEAK_FLOOR = 0.01;
const PEAK_DECAY_PER_SAMPLE = 0.99;
const SMOOTHING = 0.3;
const REDUCED_PHASE = 0.5;

export interface LevelBarsFrame {
  scales: number[];
  peak: number;
}

// One meter tick as a pure function. The session peak decays with elapsed
// time (not tick count) so the 33 ms and 100 ms sample rates behave alike;
// reduced motion drops smoothing and the per-bar phase wobble.
export function nextLevelBarsFrame(
  prev: LevelBarsFrame,
  raw: unknown,
  nowMs: number,
  dtMs: number,
  reduce: boolean
): LevelBarsFrame {
  const sane = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const level = sane < LEVEL_BARS_SILENCE_FLOOR ? 0 : sane;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const peak = Math.max(
    level,
    prev.peak * Math.pow(PEAK_DECAY_PER_SAMPLE, dt / LEVEL_BARS_SAMPLE_MS),
    PEAK_FLOOR
  );
  const norm = level / peak;
  const scales = LOGO_BAR_SHAPE.map((_, i) => {
    const target = levelBarScale(i, norm, reduce ? REDUCED_PHASE : barPhase(i, nowMs));
    return reduce ? target : smoothToward(prev.scales[i] ?? target, target, SMOOTHING);
  });
  return { scales, peak };
}
