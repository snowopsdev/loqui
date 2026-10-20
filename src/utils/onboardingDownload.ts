// Honest download progress for setup (ONB-R4): real percent, a measured speed
// and ETA that age to "unknown" during a stall, milestones for one polite live
// region, and kept progress only when main attests it.
export type VoiceDownloadState =
  | { status: "checking" }
  | { status: "idle" }
  | {
      status: "downloading";
      percent: number;
      downloadedBytes: number;
      totalBytes: number;
      bytesPerSecond: number | null;
      etaSeconds: number | null;
    }
  | { status: "installing" }
  | { status: "cancelling" }
  | { status: "cancelled" }
  | { status: "ready" }
  | { status: "error"; message: string; percent: number | null; progressKept: boolean | null };

export interface RateSample {
  atMs: number;
  bytes: number;
}

export const RATE_WINDOW_MS = 5000;
const MIN_RATE_SPAN_MS = 1000;

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
}

export function pushSample(samples: readonly RateSample[], sample: RateSample): RateSample[] {
  const last = samples.at(-1);
  if (last && sample.bytes < last.bytes) return [sample];
  return [...samples, sample].filter((entry) => sample.atMs - entry.atMs <= RATE_WINDOW_MS);
}

export function estimateRate(
  samples: readonly RateSample[],
  totalBytes: number
): { bytesPerSecond: number | null; etaSeconds: number | null } {
  const first = samples[0];
  const last = samples.at(-1);
  const none = { bytesPerSecond: null, etaSeconds: null };
  if (!first || !last || last.atMs - first.atMs < MIN_RATE_SPAN_MS) return none;
  const rate = (last.bytes - first.bytes) / ((last.atMs - first.atMs) / 1000);
  if (!(rate > 0)) return none;
  const eta = totalBytes > 0 ? Math.ceil(Math.max(0, totalBytes - last.bytes) / rate) : null;
  return { bytesPerSecond: Math.round(rate), etaSeconds: eta };
}

export interface DownloadFacts {
  installed: boolean | null;
  entry: {
    phase: "downloading" | "installing";
    progress: number;
    downloadedBytes: number;
    totalBytes: number;
  } | null;
  cancelling: boolean;
  cancelled: boolean;
  error: string | null;
  lastPercent: number | null;
  keptBytes: number | null;
  samples: readonly RateSample[];
}

export function deriveVoiceDownloadState(facts: DownloadFacts): VoiceDownloadState {
  if (facts.cancelling) return { status: "cancelling" };
  if (facts.entry?.phase === "installing") return { status: "installing" };
  if (facts.entry) {
    const { progress, downloadedBytes, totalBytes } = facts.entry;
    return {
      status: "downloading",
      percent: clampPercent(progress),
      downloadedBytes,
      totalBytes,
      ...estimateRate(facts.samples, totalBytes),
    };
  }
  if (facts.installed === true) return { status: "ready" };
  if (facts.error) {
    return {
      status: "error",
      message: facts.error,
      percent: facts.lastPercent,
      progressKept: facts.keptBytes === null ? null : facts.keptBytes > 0,
    };
  }
  if (facts.cancelled) return { status: "cancelled" };
  if (facts.installed === null) return { status: "checking" };
  return { status: "idle" };
}

export const DOWNLOAD_MILESTONES = [25, 50, 75] as const;
export type DownloadMilestone = (typeof DOWNLOAD_MILESTONES)[number];

export function milestoneCrossed(
  previousPercent: number | null,
  nextPercent: number
): DownloadMilestone | null {
  const before = previousPercent ?? -1;
  let crossed: DownloadMilestone | null = null;
  for (const milestone of DOWNLOAD_MILESTONES)
    if (before < milestone && nextPercent >= milestone) crossed = milestone;
  return crossed;
}

export function byteParts(bytes: number, locale?: string): { value: string; unit: "mb" | "gb" } {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe >= 1e9)
    return {
      value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(safe / 1e9),
      unit: "gb",
    };
  return {
    value: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(safe / 1e6),
    unit: "mb",
  };
}

export function etaParts(
  seconds: number | null
): { unit: "seconds" | "minutes"; count: number } | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return { unit: "seconds", count: Math.max(5, Math.ceil(seconds / 5) * 5) };
  return { unit: "minutes", count: Math.ceil(seconds / 60) };
}
