import {
  LEVEL_BARS_REDUCED_SAMPLE_MS,
  LEVEL_BARS_SAMPLE_MS,
  nextLevelBarsFrame,
  type LevelBarsFrame,
} from "./levelBarsMath";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface MediaQueryLike {
  matches: boolean;
  addEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
}

export interface LevelBarsSamplerEnv {
  matchMedia?: (query: string) => MediaQueryLike;
  now: () => number;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

const browserEnv = (): LevelBarsSamplerEnv => ({
  matchMedia: typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined,
  now: () => performance.now(),
  setInterval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: (id) => window.clearInterval(id as number),
});

// Drives the meter: reads the level on a timer, advances the frame, and hands
// it to `onFrame`. The sampling rate and the frame maths follow the live
// prefers-reduced-motion value, so toggling Reduce Motion while the meter is
// mounted takes effect immediately. Returns a stop function that clears both
// the timer and the media-query listener.
export function startLevelBarsSampler({
  frameRef,
  readLevel,
  onFrame,
  env = browserEnv(),
}: {
  frameRef: { current: LevelBarsFrame };
  readLevel: () => unknown;
  onFrame: (frame: LevelBarsFrame) => void;
  env?: LevelBarsSamplerEnv;
}): () => void {
  const query = env.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  let reduce = query?.matches ?? false;
  let last = env.now();
  let timer: unknown;

  const tick = () => {
    const now = env.now();
    let raw: unknown = 0;
    try {
      raw = readLevel();
    } catch {
      raw = 0;
    }
    frameRef.current = nextLevelBarsFrame(frameRef.current, raw, now, now - last, reduce);
    last = now;
    onFrame(frameRef.current);
  };

  const schedule = () => {
    timer = env.setInterval(tick, reduce ? LEVEL_BARS_REDUCED_SAMPLE_MS : LEVEL_BARS_SAMPLE_MS);
  };

  const onChange = (event: { matches: boolean }) => {
    reduce = event.matches;
    env.clearInterval(timer);
    schedule();
  };

  schedule();
  query?.addEventListener?.("change", onChange);

  return () => {
    env.clearInterval(timer);
    query?.removeEventListener?.("change", onChange);
  };
}
