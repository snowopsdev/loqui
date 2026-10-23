import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Users } from "lucide-react";
import { useWorkspaceNavigation } from "../workspaceNavigation";
import { useHoverCard } from "../ui/useHoverCard";
import { useMentionHoverPosition } from "../ui/useMentionHoverPosition";
import type { CitationSource } from "./citations";

function SourceChip({ source }: { source: CitationSource }) {
  const { t, i18n } = useTranslation();
  const navigation = useWorkspaceNavigation();
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const { open, boundary } = useHoverCard(trigger);
  const tooltipId = useId();
  const showQuote = open && !!source.quote;
  useMentionHoverPosition(trigger, card, showQuote, i18n.resolvedLanguage ?? i18n.language);
  const Icon = source.kind === "meeting" ? Users : FileText;
  const title = source.title || t("notes.list.untitledNote");
  return (
    <span className="citation-in" {...boundary}>
      <button
        ref={trigger}
        type="button"
        data-kind={source.kind}
        data-source-id={source.noteId}
        aria-describedby={showQuote ? tooltipId : undefined}
        onClick={() => navigation.openNote(source.noteId)}
        className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full border border-border px-2.5 text-caption font-semibold text-foreground hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {source.n != null && <span className="text-agent-text">{source.n}</span>}
        <Icon size={12} aria-hidden className="shrink-0 text-muted-foreground" />
        <span dir="auto" className="truncate">
          {title}
        </span>
      </button>
      {showQuote && (
        <span
          ref={card}
          id={tooltipId}
          role="tooltip"
          className="fixed z-40 block w-80 overflow-y-auto"
          style={{ visibility: "hidden" }}
        >
          <span className="block rounded-lg border border-border bg-popover p-3 text-start shadow-lg">
            <span dir="auto" className="block break-words text-ui font-semibold text-foreground">
              {title}
            </span>
            <span className="block text-caption text-muted-foreground">
              {t(source.kind === "meeting" ? "chat.sources.meeting" : "chat.sources.note")}
              {source.date ? ` · ${source.date.slice(0, 10)}` : ""}
            </span>
            <span
              dir="auto"
              className="mt-2 line-clamp-2 border-s-2 border-agent ps-2 text-caption text-foreground"
            >
              {source.quote}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

export function SourcesRow({ sources }: { sources: CitationSource[] }) {
  const { t } = useTranslation();
  if (!sources.length) return null;
  return (
    <div data-sources className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-caption text-muted-foreground">{t("chat.sources.label")}</span>
      {sources.map((source) => (
        <SourceChip key={source.noteId} source={source} />
      ))}
    </div>
  );
}
