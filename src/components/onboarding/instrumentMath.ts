import { LOGO_BAR_SHAPE } from "../ui/levelBarsMath";
import { byteParts, clampPercent } from "../../utils/onboardingDownload";

// The five bars of the mark are setup's one hero (ONB-R1 C, ONB-M2): they
// breathe when idle, fill with the download, follow the voice, drop to 30% on
// error, settle into the mark and dock into the header on success.
export type InstrumentMode =
  | { kind: "idle" }
  | { kind: "download"; percent: number; downloadedBytes: number; totalBytes: number }
  | { kind: "listening"; heardVoice: boolean }
  | { kind: "processing" } // the take stopped and is being written; the live meter stays mounted (R3-M01)
  | { kind: "success" }
  | { kind: "error"; reason: "download" | "microphone" | "noAudio" | "other" };

export const INSTRUMENT_HEIGHT = 140;
export const ERROR_FILL = 0.3;
/** Stage 1 of M2: the live bars ease to rest, the mark's silhouette; equals --motion-hero. */
export const SETTLE_MS = 520;
/** Stage 2 of M2: the speech bubble draws around the settled bars; equals --motion-slow. */
export const DRAW_MS = 360;

export function barHeights(height = INSTRUMENT_HEIGHT): number[] {
  return LOGO_BAR_SHAPE.map((shape) => Math.round(shape * height));
}

export function instrumentFills(mode: InstrumentMode): number[] {
  if (mode.kind === "download") {
    const fill = clampPercent(mode.percent) / 100;
    return LOGO_BAR_SHAPE.map(() => fill);
  }
  if (mode.kind === "error") return LOGO_BAR_SHAPE.map(() => ERROR_FILL);
  return LOGO_BAR_SHAPE.map(() => 1);
}

type ByteParts = { value: string; unit: "mb" | "gb" };
export type InstrumentCaption =
  | {
      key:
        | "idle"
        | "goodLevel"
        | "waiting"
        | "processing"
        | "heard"
        | "downloadError"
        | "micError"
        | "nothingHeard"
        | "error";
    }
  | { key: "downloading"; percent: number; done: ByteParts; total: ByteParts };

const ERROR_CAPTIONS = {
  download: "downloadError",
  microphone: "micError",
  noAudio: "nothingHeard",
  other: "error",
} as const;

export function instrumentCaption(mode: InstrumentMode, locale?: string): InstrumentCaption {
  switch (mode.kind) {
    case "download":
      return {
        key: "downloading",
        percent: clampPercent(mode.percent),
        done: byteParts(mode.downloadedBytes, locale),
        total: byteParts(mode.totalBytes, locale),
      };
    case "listening":
      return { key: mode.heardVoice ? "goodLevel" : "waiting" };
    case "processing":
      return { key: "processing" };
    case "success":
      return { key: "heard" };
    case "error":
      return { key: ERROR_CAPTIONS[mode.reason] };
    default:
      return { key: "idle" };
  }
}

/** The success dock: a View Transition when allowed, otherwise an instant swap. */
export function dockMark(
  update: () => void,
  env: { reducedMotion: boolean; doc?: { startViewTransition?: (callback: () => void) => unknown } }
): "transition" | "instant" {
  const start = env.doc?.startViewTransition;
  if (!env.reducedMotion && typeof start === "function") {
    start.call(env.doc, update);
    return "transition";
  }
  update();
  return "instant";
}
