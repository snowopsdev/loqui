import { ChevronRight, FileText, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { formatElapsed } from "../../lib/captureStatus";
import type { HomeEntry } from "../../lib/homeFeed";

// eslint-disable-next-line react-refresh/only-export-components -- Task12 publishes this pure formatting API alongside feed rows.
export function formatClockTime(ms: number, locale?: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

type SessionEntry = Extract<HomeEntry, { kind: "session" }>;
type NoteEntry = Extract<HomeEntry, { kind: "note" | "meeting" }>;

export function SessionRow({
  entry,
  expanded,
  onToggle,
  children,
}: {
  entry: SessionEntry;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="border-s-2 border-s-foreground/20" data-session={entry.key}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="grid w-full grid-cols-[64px_1fr_auto] items-center gap-x-3 px-4 py-3 text-start hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="text-caption tabular-nums text-muted-foreground">
          {formatClockTime(entry.at, i18n.language)}
        </span>
        <span className="text-ui text-foreground">
          {t("home.history.session", {
            count: entry.items.length,
            duration: formatElapsed(entry.durationMs),
          })}
        </span>
        <span className="flex items-center gap-1 text-caption text-link">
          {t(expanded ? "home.history.collapse" : "home.history.expand")}
          <ChevronRight
            size={12}
            aria-hidden
            className={cn(
              "transition-transform duration-(--motion-fast) ease-(--motion-ease-std) motion-reduce:transition-none motion-reduce:transform-none",
              expanded && "rotate-90"
            )}
          />
        </span>
      </button>
      {expanded && <div className="divide-y divide-border/60">{children}</div>}
    </div>
  );
}

export function NoteFeedRow({
  entry,
  onOpen,
}: {
  entry: NoteEntry;
  onOpen: (noteId: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const Icon = entry.kind === "meeting" ? Users : FileText;
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.note.id)}
      className="grid w-full grid-cols-[64px_1fr_auto] items-center gap-x-3 px-4 py-3 text-start hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="text-caption tabular-nums text-muted-foreground">
        {formatClockTime(entry.at, i18n.language)}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          size={14}
          aria-hidden
          className={entry.kind === "meeting" ? "text-ai" : "text-muted-foreground"}
        />
        <span dir="auto" className="truncate text-body font-medium text-foreground">
          {entry.note.title || t("notes.list.untitledNote")}
        </span>
      </span>
      <span className="text-caption text-muted-foreground">
        {t(entry.kind === "meeting" ? "home.history.meetingRow" : "home.history.noteRow")}
      </span>
    </button>
  );
}
