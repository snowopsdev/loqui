// Integer timers must not exceed twelve samples per second.
export const MEETING_LEVEL_SAMPLE_MS = 84;

/** True after continuous measured silence; speech or unknown input resets it. */
export function createQuietDetector({ threshold = 0.01, holdMs = 4000 } = {}) {
  let quietSince: number | null = null;
  return (level: number, now: number): boolean => {
    if (!Number.isFinite(level) || level >= threshold) {
      quietSince = null;
      return false;
    }
    quietSince ??= now;
    return now - quietSince >= holdMs;
  };
}
