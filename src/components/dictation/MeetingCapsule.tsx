import { useTranslation } from "react-i18next";
import type { MeetingPresence } from "../../types/dictation";
import { formatMmSs } from "../../utils/formatDuration";

export function meetingCapsuleState(p: MeetingPresence): "recording" | "quiet" | "lost" {
  if (p.interruption) return "lost";
  return p.quiet ? "quiet" : "recording";
}

/** VO-R12 A content inside the pill: dot, elapsed time, what was lost, Stop. */
export function MeetingCapsule({
  presence,
  now,
  onStop,
}: {
  presence: MeetingPresence;
  now: number;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const rs = meetingCapsuleState(presence);
  const elapsed = formatMmSs(Math.max(0, Math.floor((now - presence.startedAt) / 1000)));
  return (
    <span className="meeting-capsule" data-rs={rs}>
      <span className="meeting-capsule__dot" aria-hidden="true" />
      <span className="meeting-capsule__time">{elapsed}</span>
      {rs === "lost" ? (
        <span
          className="meeting-capsule__note"
          title={t(
            presence.interruption === "mic"
              ? "meetingRecorder.micLost"
              : "meetingRecorder.systemLost"
          )}
        >
          {t(
            presence.interruption === "mic"
              ? "meetingRecorder.micLost"
              : "meetingRecorder.systemLost"
          )}
        </span>
      ) : null}
      <button
        type="button"
        className="meeting-capsule__stop"
        aria-label={t("meetingRecorder.stopAria")}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onStop();
        }}
      />
    </span>
  );
}
