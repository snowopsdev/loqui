import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Loader2,
  MessageSquare,
  Mic,
  NotebookPen,
  Square,
  Upload,
  AudioLines,
} from "lucide-react";
import { Button } from "./ui/button";
import { LevelBars } from "./ui/LevelBars";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  SPLIT_BUTTON_DIVIDER_CLASS,
  SPLIT_BUTTON_GROUP_CLASS,
  SPLIT_BUTTON_SEGMENT_CLASS,
} from "./ui/splitButton";
import { cn } from "./lib/utils";
import { formatElapsed, type CaptureStatus } from "../lib/captureStatus";
import { shortcutHint, type WorkspaceAction } from "../lib/workspaceShortcuts";

export type CaptureAction = "dictate" | "recordMeeting" | "upload" | "newNote" | "newChat";
// Public Capture contract stays colocated with its presentational menu.
// eslint-disable-next-line react-refresh/only-export-components
export const CAPTURE_ACTIONS: readonly CaptureAction[] = [
  "dictate",
  "recordMeeting",
  "upload",
  "newNote",
  "newChat",
];
export const LAST_CAPTURE_ACTION_KEY = "capture.lastAction";

// eslint-disable-next-line react-refresh/only-export-components
export function readLastCaptureAction(
  storage: Pick<Storage, "getItem"> | null | undefined
): CaptureAction {
  try {
    const value = storage?.getItem(LAST_CAPTURE_ACTION_KEY);
    return (CAPTURE_ACTIONS as readonly string[]).includes(value ?? "")
      ? (value as CaptureAction)
      : "dictate";
  } catch {
    return "dictate";
  }
}

const ICONS: Record<CaptureAction, typeof Mic> = {
  dictate: Mic,
  recordMeeting: AudioLines,
  upload: Upload,
  newNote: NotebookPen,
  newChat: MessageSquare,
};
const SHORTCUTS: Partial<Record<CaptureAction, WorkspaceAction>> = {
  recordMeeting: "recordMeeting",
  upload: "uploadAudio",
  newNote: "newNote",
  newChat: "newChat",
};

export interface CaptureMenuProps {
  status: Pick<CaptureStatus, "kind" | "source" | "startedAt">;
  now: number;
  readLevel: () => number;
  lastAction: CaptureAction;
  hotkeyLabel: string;
  platform: string;
  showChat: boolean;
  onRun: (action: CaptureAction) => void;
  onStop: () => void;
}

export default function CaptureMenu({
  status,
  now,
  readLevel,
  lastAction,
  hotkeyLabel,
  platform,
  showChat,
  onRun,
  onStop,
}: CaptureMenuProps) {
  const { t } = useTranslation();
  const selectedActionRef = useRef<CaptureAction | null>(null);
  const segmentClass = cn(
    SPLIT_BUTTON_SEGMENT_CLASS,
    "duration-[var(--motion-fast)] ease-[var(--motion-ease-std)] text-foreground"
  );
  const actions = CAPTURE_ACTIONS.filter((action) => showChat || action !== "newChat");
  const primary = showChat || lastAction !== "newChat" ? lastAction : "dictate";
  const PrimaryIcon = ICONS[primary];
  const hint = (action: CaptureAction) =>
    action === "dictate" ? hotkeyLabel : shortcutHint(SHORTCUTS[action]!, platform);

  let primarySegment: React.ReactNode;
  if (status.kind === "listening") {
    // D1: orange only while the mic is live. One click stops what is live.
    const elapsed = formatElapsed(status.startedAt == null ? 0 : now - status.startedAt);
    primarySegment = (
      <Button
        variant="live"
        size="sm"
        data-state="listening"
        data-elapsed={elapsed}
        aria-label={t(
          status.source === "meeting" ? "capture.stopRecording" : "capture.stopListening"
        )}
        onClick={onStop}
        className={cn(
          segmentClass,
          // The neutral split styles must not replace the live Button's ink.
          "text-live-foreground hover:text-live-foreground gap-2 tabular-nums rounded-none focus-visible:ring-offset-0 motion-reduce:transform-none"
        )}
      >
        <Square size={10} aria-hidden className="fill-current" />
        <LevelBars readLevel={readLevel} height={14} />
        <span>{t("capture.listening", { time: elapsed })}</span>
      </Button>
    );
  } else if (status.kind === "processing") {
    primarySegment = (
      <button
        type="button"
        disabled
        aria-busy="true"
        className={cn(segmentClass, "gap-2 ps-3 pe-3.5 text-ui")}
      >
        <Loader2
          size={14}
          aria-hidden
          className="text-muted-foreground motion-safe:animate-[spin_var(--motion-loop-blink)_linear_infinite]"
        />
        <span role="status">{t("capture.cleaningUp")}</span>
      </button>
    );
  } else {
    primarySegment = (
      <button
        type="button"
        onClick={() => onRun(primary)}
        className={cn(segmentClass, "gap-2 ps-3 pe-3.5 text-ui")}
      >
        <PrimaryIcon size={14} aria-hidden />
        <span>{t(`capture.short.${primary}`)}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(SPLIT_BUTTON_GROUP_CLASS, "h-8")}
      role="group"
      aria-label={t("capture.group")}
    >
      {primarySegment}
      <span className={SPLIT_BUTTON_DIVIDER_CLASS} aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("capture.moreOptions")}
            className={cn(segmentClass, "w-8 justify-center")}
          >
            <ChevronDown size={14} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[248px] duration-[var(--motion-fast)] motion-reduce:animate-none"
          onCloseAutoFocus={(event) => {
            const selected = selectedActionRef.current;
            selectedActionRef.current = null;
            if (selected === "newChat") event.preventDefault();
          }}
        >
          {actions.map((action) => {
            const Icon = ICONS[action];
            return (
              <div key={action}>
                {action === "newNote" && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  data-action={action}
                  onSelect={() => {
                    selectedActionRef.current = action;
                    onRun(action);
                  }}
                  className="h-9 gap-2.5 text-ui focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset duration-[var(--motion-fast)]"
                >
                  <Icon size={14} aria-hidden />
                  <span className="flex-1">{t(`capture.actions.${action}`)}</span>
                  <kbd dir="ltr" className="text-micro text-muted-foreground">
                    {hint(action)}
                  </kbd>
                </DropdownMenuItem>
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
