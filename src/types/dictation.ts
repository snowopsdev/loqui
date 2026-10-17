export type DisclosurePayload = "audio" | "text" | "image";
export type DisclosureTask =
  "dictationStt" | "dictationCleanup" | "translation" | "voiceAssistant" | "assistantVision";
/** Who already received part of a dictation. `target` is a provider id ("openai", "custom") or "host:<hostname>"
 *  for the user's own server on the network. Render it with dispatchTargetLabel(target, t). */
export interface RemoteDisclosure {
  target: string;
  payload: DisclosurePayload; // strongest seen: audio > image > text
  evidence: "attested" | "dispatched"; // attested = main's EgressNotice; dispatched = main's transport hand-off
  alsoSentTo: string[]; // every other target that received part of this dictation (never hidden)
}
/** Main → the requesting window, immediately before a provider request, or a streaming session's
 *  first audio frame, leaves. The no-Plan-07 evidence. */
export interface DictationDispatch {
  correlationId: string;
  task: DisclosureTask;
  payload: DisclosurePayload;
}
export interface CancelledState {
  sessionId: string;
  undoUntil: number; // epoch ms the window closes; frozen while paused
  paused: boolean;
  remainingMs: number; // what is left of the window (equals undoUntil - now when running)
  remoteAlreadySent: RemoteDisclosure | null;
}
export type UndoResult =
  | { restored: true; sessionId: string }
  | {
      restored: false;
      sessionId: string | null;
      reason: "expired" | "busy" | "sealed" | "routeUnavailable" | "noAudio" | "unavailable";
    };
export type DictationOutcome =
  | { sessionId: string; kind: "pasted"; words: number; at: number }
  | { sessionId: string; kind: "failed"; at: number };
export interface MeetingPresence {
  sessionId: string;
  startedAt: number;
  interruption: "systemAudio" | "mic" | null;
  quiet: boolean;
}
export type MeetingOutcome =
  | { sessionId: string; kind: "saved"; durationMs: number; noteId: string | null }
  | { sessionId: string; kind: "failed"; reason: "save" | "stop" | "ownerLost" };
