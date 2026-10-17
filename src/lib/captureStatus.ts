// WS-R3 C: shared vocabulary for capture state across the workspace shell.
export type CaptureStatusKind = "ready" | "listening" | "processing" | "offline";
export type MicCaptureStatus = "inactive" | "active" | "reconnecting" | "unavailable";

export interface CaptureFacts {
  dictationState: string | null;
  dictationInputKind: string | null;
  dictationStartedAt: number | null;
  meeting: { isRecording: boolean; startedAt: number | null; micCaptureStatus: MicCaptureStatus };
  micGranted: boolean | null;
}

export interface CaptureStatus {
  kind: CaptureStatusKind;
  source: "dictation" | "meeting" | null;
  startedAt: number | null;
  offlineReason: "permission" | "device" | null;
  inputKind: "dictation" | "assistant" | "translation" | null;
}

const INPUT_KINDS = new Set(["dictation", "assistant", "translation"]);

const status = (
  kind: CaptureStatusKind,
  source: CaptureStatus["source"] = null,
  startedAt: number | null = null,
  offlineReason: CaptureStatus["offlineReason"] = null,
  inputKind: CaptureStatus["inputKind"] = null
): CaptureStatus => ({ kind, source, startedAt, offlineReason, inputKind });

export function resolveCaptureStatus(facts: CaptureFacts): CaptureStatus {
  const { meeting } = facts;
  const meetingMicLost =
    meeting.micCaptureStatus === "unavailable" || meeting.micCaptureStatus === "reconnecting";
  const inputKind = INPUT_KINDS.has(facts.dictationInputKind ?? "")
    ? (facts.dictationInputKind as CaptureStatus["inputKind"])
    : "dictation";
  if (meeting.isRecording && meetingMicLost) return status("offline", "meeting", null, "device");
  if (facts.dictationState === "recording") {
    return status("listening", "dictation", facts.dictationStartedAt, null, inputKind);
  }
  if (meeting.isRecording) return status("listening", "meeting", meeting.startedAt);
  if (facts.dictationState === "processing")
    return status("processing", "dictation", null, null, inputKind);
  if (facts.micGranted === false) return status("offline", null, null, "permission");
  return status("ready");
}

export type CaptureRole = "dictation" | "meeting" | "assistant" | "translation";

/** Selects the configured route category; it does not attest the recipient of a frozen active capture. */
export function captureRouteIds(status: Pick<CaptureStatus, "source" | "inputKind">): {
  role: CaptureRole;
  speech: "dictationStt" | "noteRecordingStt";
  text: "voiceAssistant" | "translation" | null;
} {
  if (status.source === "meeting")
    return { role: "meeting", speech: "noteRecordingStt", text: null };
  if (status.source === "dictation" && status.inputKind === "assistant") {
    return { role: "assistant", speech: "dictationStt", text: "voiceAssistant" };
  }
  if (status.source === "dictation" && status.inputKind === "translation") {
    return { role: "translation", speech: "dictationStt", text: "translation" };
  }
  return { role: "dictation", speech: "dictationStt", text: null };
}

export function nextDictationStartedAt(
  prevState: string | null,
  prevStartedAt: number | null,
  nextState: string,
  now: number
): number | null {
  if (nextState !== "recording") return null;
  return prevState === "recording" && prevStartedAt != null ? prevStartedAt : now;
}

export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

const ATTACK = 0.65;
const RELEASE = 0.24;
export function railLevelStep(previous: number, target: number): number {
  const from = Number.isFinite(previous) ? previous : 0;
  const to = Number.isFinite(target) ? Math.min(Math.max(target, 0), 1) : 0;
  const factor = to > from ? ATTACK : RELEASE;
  return Math.round((from + (to - from) * factor) * 1000) / 1000;
}
