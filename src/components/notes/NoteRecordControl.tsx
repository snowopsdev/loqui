import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingRecordingStore } from "../../stores/meetingRecordingStore";
import { readMeetingMicLevel } from "../../utils/meetingMicLevel";
import { formatMmSs } from "../../utils/formatDuration";
import { Loader2, Mic, Square } from "../icons";
import { cn } from "../lib/utils";
import { LevelBars } from "../ui/LevelBars";
import { GRADIENT_CIRCLE } from "../ui/gradientCircle";

// Same near-opaque surface the ask bar wears while recording, so the two capsules match.
const RECORDING_SURFACE = "bg-surface-2/95 shadow-(--shadow-glass)";

/** Transcript-tab indicator while a meeting records: the real mic level (VO-Q13). */
export function RecordingWave({ className }: { className?: string }) {
  return <LevelBars readLevel={readMeetingMicLevel} height={12} className={className} />;
}

interface NoteRecordControlProps {
  isRecording: boolean;
  isProcessing: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** Record button for the note header: a brand circle that widens into a stop + live-wave + timer pill. */
export default function NoteRecordControl({
  isRecording,
  isProcessing,
  disabled = false,
  onStart,
  onStop,
}: NoteRecordControlProps) {
  const { t } = useTranslation();
  // Elapsed time comes from the session's start timestamp rather than a tick
  // count: this control remounts whenever the user switches notes, and counted
  // ticks would restart at zero (and drift while the window is throttled).
  const startedAt = useMeetingRecordingStore((s) => s.recordingStartedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRecording) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const elapsed = isRecording && startedAt != null ? Math.floor((now - startedAt) / 1000) : 0;

  return (
    <div
      className={cn(
        "h-[30px] shrink-0 overflow-hidden transition-[width] duration-(--motion-slow) ease-(--motion-ease-enter)",
        isRecording ? "w-40" : "w-[30px]"
      )}
    >
      {isRecording ? (
        <button
          type="button"
          onClick={onStop}
          aria-label={t("notes.editor.stop")}
          title={t("notes.editor.stop")}
          className={cn(
            "group flex h-[30px] w-full items-center gap-2 rounded-full ps-1 pe-3",
            RECORDING_SURFACE,
            "border border-primary/15 transition-[border-color] duration-(--motion-base) hover:border-primary/30",
            "dark:border-primary/25 dark:hover:border-primary/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          )}
        >
          <span
            className={cn(
              "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full",
              GRADIENT_CIRCLE,
              "transition-[filter] duration-(--motion-fast) group-hover:brightness-110"
            )}
          >
            <Square size={8} fill="currentColor" />
          </span>
          <LevelBars
            readLevel={readMeetingMicLevel}
            height={14}
            className="flex-1 justify-center"
          />
          <span className="shrink-0 text-xs font-medium tabular-nums text-foreground/85">
            {formatMmSs(elapsed)}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={disabled || isProcessing}
          aria-label={t("notes.editor.transcribe")}
          title={disabled ? t("personal.recordingUnavailable") : undefined}
          className={cn(
            "flex h-[30px] w-[30px] items-center justify-center rounded-full",
            GRADIENT_CIRCLE,
            "transition-[filter,transform] duration-(--motion-fast) hover:brightness-110 active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            disabled && "pointer-events-none opacity-40 saturate-0",
            isProcessing && "pointer-events-none"
          )}
        >
          {isProcessing ? (
            <Loader2 size={14} className="animate-spin text-live-foreground" />
          ) : (
            <Mic size={15} />
          )}
        </button>
      )}
    </div>
  );
}
