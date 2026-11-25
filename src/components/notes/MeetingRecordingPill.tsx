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
  workspaceActive?: boolean;
  /**
   * "inline" sits in the workspace top bar and shows only while the workspace
   * is visible; "floating" overlays the window only while it is hidden (setup),
   * when no top bar is on screen to hold it.
   */
  placement?: "inline" | "floating";
  activeView: string;
  activeNoteId: number | null;
  onReturnToNote: () => void;
}

const truncateTitle = (title: string) =>
  title.length > 20 ? `${title.slice(0, 19).trimEnd()}…` : title;

export default function MeetingRecordingPill({
  workspaceActive = true,
  placement = "floating",
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
    workspaceActive && activeView === "personal-notes" && activeNoteId === recordingNoteId;

  const inline = placement === "inline";
  if (
    !isRecording ||
    isViewingRecordingNote ||
    !isControlPanelWindow() ||
    inline !== workspaceActive
  ) {
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
  const returnLabel = t(
    workspaceActive ? "notes.meetingPill.returnToNote" : "setupFlow.ready.openWorkspace"
  );
  const stopLabel = t("notes.editor.stop");

  const pill = (
    <div
      // Inline it may shrink: the trailing top-bar slot also holds Capture and
      // the window controls, so the pill must never push them out of view.
      className={inline ? "min-w-0 max-w-full" : "fixed top-2 left-1/2 -translate-x-1/2 z-30"}
      style={
        {
          WebkitAppRegion: "no-drag",
          animation: "grow-to-bar var(--motion-slow) var(--motion-ease-enter) both",
        } as React.CSSProperties
      }
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 rounded-xl",
          inline ? "h-8 min-w-0" : "h-9",
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
            "flex min-w-0 items-center gap-3 px-1 -mx-1 rounded-md",
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
          {/* Narrow windows (the 1024px side-panel breakpoint) keep bars + Stop;
              the button's aria-label still names the destination. Inline, the
              title clamps to one line instead of nowrap truncation, which would
              make its min-content width the whole title. Wrapping anywhere lets
              the top bar's min-content column shrink it from 9rem to 4rem before
              the search field gives up any room. */}
          <span
            className={cn(
              "text-xs font-medium text-foreground/80",
              inline
                ? "line-clamp-1 wrap-anywhere min-w-16 max-w-[9rem] max-[1023px]:hidden"
                : "min-w-0 truncate max-w-[12rem]"
            )}
          >
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
            "flex shrink-0 items-center justify-center w-7 h-7 rounded-lg",
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
    </div>
  );

  // Inline it takes its own room in the top bar's trailing column, so it can
  // never cover the centred search field or a view's own header row.
  return inline ? pill : createPortal(pill, document.body);
}
