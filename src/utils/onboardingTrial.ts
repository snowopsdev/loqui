import type { OnboardingDemoEvent } from "../types/electron";

// The Say something trial, as a pure reduction of onboarding demo events. Phase
// names follow the dictation lifecycle (spec §5.2): recording, processing,
// cancelled; success and error are the trial's own outcomes.
export type TrialPhase = "idle" | "recording" | "processing" | "cancelled" | "success" | "error";
export type TrialErrorKind = "microphone" | "noAudio" | "memory" | "other";

export interface TrialState {
  phase: TrialPhase;
  text: string;
  rawText: string | null;
  cleanup: "applied" | "skipped" | "failed" | null;
  level: number;
  heardVoice: boolean;
  recordingSinceMs: number | null;
  errorKind: TrialErrorKind | null;
  errorMessage: string | null;
  successes: number;
  takeId: number;
  cleanupRetry: "idle" | "running" | "failed";
}

export type TrialInput =
  | (Pick<
      OnboardingDemoEvent,
      "status" | "text" | "rawText" | "message" | "code" | "level" | "cleanup"
    > & { atMs: number })
  | { status: "reset"; atMs: number }
  | { status: "cleanupRetry"; takeId: number; atMs: number }
  | { status: "cleanupResult"; takeId: number; text: string | null; atMs: number };

/** Absolute RMS that counts as a voice; room noise sits near 0.002–0.005. */
export const VOICE_LEVEL_FLOOR = 0.015;
/** A silent recording this long suggests checking the microphone. */
export const SILENCE_HINT_MS = 2500;

export const INITIAL_TRIAL_STATE: TrialState = {
  phase: "idle",
  text: "",
  rawText: null,
  cleanup: null,
  level: 0,
  heardVoice: false,
  recordingSinceMs: null,
  errorKind: null,
  errorMessage: null,
  successes: 0,
  takeId: 0,
  cleanupRetry: "idle",
};

const MICROPHONE_CODES = new Set([
  "NotAllowedError",
  "PermissionDeniedError",
  "SecurityError",
  "NotFoundError",
  "NotReadableError",
]);

export function classifyTrialError(code?: string): TrialErrorKind {
  if (code && MICROPHONE_CODES.has(code)) return "microphone";
  if (code === "NO_AUDIO") return "noAudio";
  if (code === "INSUFFICIENT_MEMORY") return "memory";
  return "other";
}

const fresh = (state: TrialState): TrialState => ({
  ...INITIAL_TRIAL_STATE,
  successes: state.successes,
  takeId: state.takeId,
});

export function reduceTrial(state: TrialState, input: TrialInput): TrialState {
  switch (input.status) {
    case "reset":
      return fresh(state);
    case "listening":
      return {
        ...fresh(state),
        phase: "recording",
        recordingSinceMs: input.atMs,
        takeId: state.takeId + 1,
      };
    case "cleanupRetry":
      if (input.takeId !== state.takeId || state.phase !== "success") return state;
      return { ...state, cleanupRetry: "running" };
    case "cleanupResult":
      if (input.takeId !== state.takeId || state.phase !== "success") return state;
      return input.text
        ? { ...state, text: input.text, cleanup: "applied", cleanupRetry: "idle" }
        : { ...state, cleanupRetry: "failed" };
    case "level": {
      if (state.phase !== "recording" || !Number.isFinite(input.level)) return state;
      const level = Math.min(1, Math.max(0, input.level as number));
      return { ...state, level, heardVoice: state.heardVoice || level > VOICE_LEVEL_FLOOR };
    }
    case "partial":
      if (state.phase !== "recording" && state.phase !== "processing") return state;
      return {
        ...state,
        text: input.text ?? state.text,
        heardVoice: state.heardVoice || Boolean(input.text?.trim()),
      };
    case "processing":
      return { ...state, phase: "processing", level: 0, text: input.text ?? state.text };
    case "success": {
      const text = input.text?.trim() ? input.text : "";
      if (!text)
        return { ...state, phase: "error", level: 0, errorKind: "noAudio", errorMessage: null };
      return {
        ...state,
        phase: "success",
        level: 0,
        text,
        rawText: input.rawText ?? null,
        cleanup: input.cleanup ?? "skipped",
        successes: state.successes + 1,
      };
    }
    case "error":
      return {
        ...state,
        phase: "error",
        level: 0,
        errorKind: classifyTrialError(input.code),
        errorMessage: input.message ?? null,
      };
    case "cancelled":
      return {
        ...state,
        phase: "cancelled",
        level: 0,
      };
    default:
      // Assistant and shared-cancellation events belong to other owners.
      return state;
  }
}

export function isSilent(state: TrialState, nowMs: number): boolean {
  return (
    state.phase === "recording" &&
    !state.heardVoice &&
    state.recordingSinceMs !== null &&
    nowMs - state.recordingSinceMs >= SILENCE_HINT_MS
  );
}

export type TrialCaption =
  "idle" | "goodLevel" | "waiting" | "processing" | "heard" | "discarded" | "error";

export function trialCaption(state: TrialState): TrialCaption {
  switch (state.phase) {
    case "recording":
      return state.heardVoice ? "goodLevel" : "waiting";
    case "processing":
      return "processing";
    case "success":
      return "heard";
    case "cancelled":
      return "discarded";
    case "error":
      return "error";
    default:
      return "idle";
  }
}
