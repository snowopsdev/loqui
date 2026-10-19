import type { MeetingPresence } from "../types/dictation";

export function meetingCapsuleState(p: MeetingPresence): "recording" | "quiet" | "lost" {
  if (p.interruption) return "lost";
  return p.quiet ? "quiet" : "recording";
}
