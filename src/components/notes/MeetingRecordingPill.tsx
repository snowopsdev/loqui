import { useState } from "react";
import { LevelBars } from "../ui/LevelBars";
import { readMeetingMicLevel } from "../../utils/meetingMicLevel";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Square } from "../icons";
import { stopRecording, useMeetingRecordingStore } from "../../stores/meetingRecordingStore";
import { cn } from "../lib/utils";
import { isControlPanelWindow } from "../../utils/windowContext";

interface MeetingRecordingPillProps {
  activeView: string;
  activeNoteId: number | null;
  onReturnToNote: () => void;
}

const truncateTitle = (title: string) =>
  title.length > 20 ? `${title.slice(0, 19).trimEnd()}…` : title;

export default function MeetingRecordingPill({
  activeView,
  activeNoteId,
  onReturnToNote,
}: MeetingRecordingPillProps) {
  const { t } = useTranslation();
  const isRecording = useMeetingRecordingStore((s) => s.isRecording);
  const recordingNoteId = useMeetingRecordingStore((s) => s.recordingNoteId);
  const recordingNoteTitle = useMeetingRecordingStore((s) => s.recordingNoteTitle);
  const micCaptureStatus = useMeetingRecordingStore((s) => s.micCaptureStatus);
  const isWaitingForMic = micCaptureStatus === "reconnecting" || micCaptureStatus === "unavailable";
  const [isStopping, setIsStopping] = useState(false);

  const isViewingRecordingNote =
    activeView === "personal-notes" && activeNoteId === recordingNoteId;

  if (!isRecording || isViewingRecordingNote || !isControlPanelWindow()) {
    return null;
  }

  const handleStop = async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
      await stopRecording();
    } finally {
      setIsStopping(false);
    }
  };

  const title = truncateTitle(recordingNoteTitle ?? "");
  const returnLabel = t("notes.meetingPill.returnToNote");
  const stopLabel = t("notes.editor.stop");

  return createPortal(
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 z-30"
      style={
        {
          WebkitAppRegion: "no-drag",
          animation: "grow-to-bar var(--motion-slow) var(--motion-ease-enter) both",
        } as React.CSSProperties
      }
    >
      <div
        className={cn(
          "flex items-center gap-2 h-9 px-3 rounded-xl",
          "bg-card/95 dark:bg-surface-2/95",
          "backdrop-blur-xl",
          "border border-primary/25 dark:border-primary/30",
          "shadow-elevated"
        )}
      >
        <button
          type="button"
          onClick={onReturnToNote}
          aria-label={returnLabel}
          title={returnLabel}
          className={cn(
            "flex items-center gap-3 px-1 -mx-1 rounded-md",
            "transition-colors",
            "hover:bg-primary/8 active:bg-primary/14",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
          )}
        >
          {isWaitingForMic ? (
            <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
          ) : (
            <LevelBars readLevel={readMeetingMicLevel} height={16} />
          )}
          <span className="text-xs font-medium text-foreground/80 truncate max-w-[12rem]">
            {isWaitingForMic ? t("notes.meetingPill.waitingForMicrophone") : title}
          </span>
        </button>

        <button
          type="button"
          onClick={handleStop}
          disabled={isStopping}
          aria-label={stopLabel}
          title={stopLabel}
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded-lg",
            "transition-colors duration-(--motion-fast)",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30",
            isStopping
              ? "bg-primary/6 text-primary/40 cursor-not-allowed"
              : "bg-primary/10 hover:bg-primary/18 active:bg-primary/25 text-primary"
          )}
        >
          <Square size={12} fill="currentColor" />
        </button>
      </div>
    </div>,
    document.body
  );
}
