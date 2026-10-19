import { RouteTag } from "./ChatModelChip";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Copy,
  Check,
  Search,
  FileText,
  ChevronDown,
  ChevronRight,
  CircleAlert,
} from "../icons";
import { cn } from "../lib/utils";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";
import type { Message, ToolCallInfo } from "./types";
import { extractNoteCards } from "./noteCards";
import { toolIcons } from "./toolIcons";
import { collectSources, numberCitations } from "./citations";
import { remarkCitations } from "./remarkCitations";
import { SourcesRow } from "./SourcesRow";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming: boolean;
  toolCalls?: ToolCallInfo[];
  onOpenNote?: (noteId: number) => void;
  variant?: "bubble" | "document";
  context?: Message["context"];
}

function ToolCallStep({
  toolCall,
  presentation = "bubble",
}: {
  toolCall: ToolCallInfo;
  presentation?: "bubble" | "document";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const Icon = toolIcons[toolCall.name] || Search;
  const isExecuting = toolCall.status === "executing";
  const isError = toolCall.status === "error";
  const isCompleted = toolCall.status === "completed";
  const isClipboard = toolCall.name === "copy_to_clipboard" && isCompleted;

  const resultLines = toolCall.result?.split("\n") ?? [];
  const hasDetail = resultLines.length > 1 && !isClipboard;

  if (presentation === "document") {
    const interactive = hasDetail && !isExecuting;
    const Header = interactive ? "button" : "div";
    return (
      <div
        className={cn("mb-1 rounded-md border-s-2", isExecuting ? "border-agent" : "border-border")}
      >
        <Header
          {...(interactive
            ? {
                type: "button" as const,
                "aria-expanded": expanded,
                onClick: () => setExpanded((v) => !v),
              }
            : {})}
          className="flex w-full items-center gap-1.5 rounded-sm bg-surface-1 px-2.5 py-1.5 text-start text-caption text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon size={12} aria-hidden className="shrink-0" />
          {isError && <CircleAlert size={12} aria-hidden className="shrink-0" />}
          <span className="min-w-0 break-words">
            {isExecuting
              ? t(`agentMode.tools.${toolCall.name}Status`, { defaultValue: toolCall.name })
              : isClipboard
                ? t("agentMode.tools.copiedToClipboard")
                : toolCall.result?.split("\n")[0] || toolCall.name}
          </span>
          {interactive && (
            <ChevronDown
              size={12}
              aria-hidden
              className={cn("ms-auto shrink-0", expanded && "rotate-180")}
            />
          )}
        </Header>
        {interactive && expanded && (
          <pre
            dir="auto"
            className="whitespace-pre-wrap break-words px-2.5 pb-1.5 text-caption text-muted-foreground"
          >
            {toolCall.result}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative rounded-md mb-1 overflow-hidden",
        "border-s-2 transition-colors duration-300",
        isExecuting && "border-s-primary/60",
        isCompleted && !isError && "border-s-muted-foreground/20",
        isClipboard && "border-s-emerald-500/50",
        isError && "border-s-destructive/50"
      )}
    >
      {isExecuting && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ animation: "tool-step-shimmer 2s ease-in-out infinite" }}
        />
      )}

      <div
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5",
          "bg-surface-1/60",
          hasDetail && !isExecuting && "cursor-pointer"
        )}
        onClick={hasDetail && !isExecuting ? () => setExpanded((v) => !v) : undefined}
      >
        <Icon
          size={12}
          className={cn(
            "shrink-0 transition-colors duration-300",
            isExecuting && "text-link",
            isCompleted && !isError && !isClipboard && "text-muted-foreground",
            isClipboard && "text-emerald-500/70",
            isError && "text-destructive/60"
          )}
        />

        {isExecuting ? (
          <span className="text-caption text-muted-foreground">
            {t(`agentMode.tools.${toolCall.name}Status`, { defaultValue: toolCall.name })}
          </span>
        ) : isError ? (
          <div className="flex items-center gap-1">
            <CircleAlert size={10} className="text-destructive/60 shrink-0" />
            <span className="text-caption text-destructive">
              {toolCall.result || toolCall.name}
            </span>
          </div>
        ) : isClipboard ? (
          <div className="flex items-center gap-1">
            <span className="text-caption text-muted-foreground">
              {t("agentMode.tools.copiedToClipboard")}
            </span>
            <Check
              size={10}
              className="text-emerald-500 shrink-0"
              style={{ animation: "tool-check-pop 300ms ease-out both" }}
            />
          </div>
        ) : (
          <span className="text-caption text-muted-foreground">
            {toolCall.result || toolCall.name}
          </span>
        )}

        {hasDetail && !isExecuting && (
          <ChevronDown
            size={10}
            className={cn(
              "ms-auto text-muted-foreground shrink-0 transition-transform duration-200",
              expanded && "rotate-180"
            )}
          />
        )}
      </div>

      {hasDetail && !isExecuting && (
        <div
          className="overflow-hidden transition-all duration-200"
          style={{ maxHeight: expanded ? `${resultLines.length * 16 + 12}px` : "0px" }}
        >
          <pre
            dir="ltr"
            className="text-caption text-muted-foreground px-2.5 pb-1.5 whitespace-pre-wrap leading-tight"
          >
            {toolCall.result}
          </pre>
        </div>
      )}
    </div>
  );
}

function NoteCard({
  noteId,
  title,
  onOpenNote,
}: {
  noteId: number;
  title: string;
  onOpenNote?: (noteId: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      onClick={() =>
        onOpenNote ? onOpenNote(noteId) : window.electronAPI?.agentOpenNote?.(noteId)
      }
      className={cn(
        "focus-visible:ring-2 focus-visible:ring-ring",
        "flex items-center gap-2 w-full mt-2 px-2.5 py-2 rounded-md",
        "bg-foreground/5 border border-border",
        "hover:bg-foreground/5 hover:border-border",
        "active:scale-[0.99]",
        "transition-all duration-150",
        "text-start group/note"
      )}
    >
      <div className={cn("shrink-0 p-1 rounded", "bg-foreground/5")}>
        <FileText size={12} className="text-link" />
      </div>
      <div className="min-w-0 flex-1">
        <p dir="auto" className="text-caption font-medium text-foreground truncate">
          {title}
        </p>
        <p className="text-caption text-muted-foreground">{t("agentMode.tools.openNote")}</p>
      </div>
      <ChevronRight
        size={12}
        className="text-muted-foreground group-hover/note:text-link shrink-0 transition-colors duration-150 rtl:rotate-180"
      />
    </button>
  );
}

function CitationSup({
  node: _node,
  children,
  ...props
}: ComponentProps<"sup"> & { node?: unknown; "data-citation"?: number }) {
  if (props["data-citation"] == null) return <sup {...props}>{children}</sup>;
  // Explicit size wins over the browser's smaller default sup font.
  return (
    <sup {...props} className="citation-in ms-0.5 text-micro font-bold text-agent-text">
      {children}
    </sup>
  );
}
const citationComponents = { sup: CitationSup };

function ToolActivityDisclosure({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const running = toolCalls.find((call) => call.status === "executing");
  const failed = [...toolCalls].reverse().find((call) => call.status === "error");
  const searches = toolCalls.filter(
    (call) => call.name === "search_notes" && call.status === "completed"
  );
  const last = toolCalls.at(-1)!;
  const summary = running
    ? t(`agentMode.tools.${running.name}Status`, { defaultValue: running.name })
    : failed
      ? failed.result || failed.name
      : searches.length
        ? t("agentMode.tools.summary", { count: collectSources(searches, undefined).size })
        : last.name === "copy_to_clipboard"
          ? t("agentMode.tools.copiedToClipboard")
          : last.result?.split("\n")[0] ||
            t(`agentMode.tools.${last.name}Status`, { defaultValue: last.name });
  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-sm text-caption text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {summary}
      </button>
      {open && (
        <div className="mt-1">
          {toolCalls.map((call) => (
            <ToolCallStep key={call.id} toolCall={call} presentation="document" />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatMessage({
  role,
  content,
  isStreaming,
  toolCalls,
  onOpenNote,
  variant = "bubble",
  context,
}: ChatMessageProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      if (!mounted.current) return;
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  if (variant === "document" && role === "user") {
    return (
      <div data-variant="document" className="flex justify-end">
        <div className="max-w-[80%] rounded-xl bg-surface-3 px-3.5 py-2.5 text-ui text-foreground">
          <span dir="auto">{content}</span>
        </div>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div
        className="flex justify-end"
        style={{ animation: "agent-message-in 200ms ease-out both" }}
      >
        <div
          data-chat-bubble
          className={cn(
            "max-w-[80%] px-3 py-2 rounded-lg rounded-ee-sm",
            "bg-secondary text-foreground",
            "text-ui leading-relaxed"
          )}
        >
          <span dir="auto">{content}</span>
        </div>
      </div>
    );
  }

  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const hasContent = content.length > 0;
  const noteCards = extractNoteCards(toolCalls, t("notes.list.untitledNote"));

  if (variant === "document") {
    const candidates = collectSources(toolCalls, [
      ...(context?.ragNotes ?? []),
      ...(context?.pinnedNotes ?? []),
    ]);
    const { numbers, sources } = numberCitations(content, candidates);
    return (
      <div
        data-variant="document"
        className={cn(
          "group/msg border-s-2 ps-4",
          isStreaming ? "border-agent" : "border-transparent"
        )}
      >
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          <span
            aria-hidden
            className="flex size-[18px] items-center justify-center rounded-md bg-agent/20 text-agent-text"
          >
            <Sparkles size={11} />
          </span>
          <span className="text-ui font-medium text-foreground">{t("chat.assistant")}</span>
          {context?.route && <RouteTag route={context.route} />}
        </div>
        {hasToolCalls && <ToolActivityDisclosure toolCalls={toolCalls} />}
        {hasContent && (
          <MarkdownRenderer
            content={content}
            remarkPlugins={[[remarkCitations, { numbers }]]}
            components={citationComponents}
            className="max-w-[68ch] text-body leading-[1.6] [&_strong]:font-[650]"
          />
        )}
        {isStreaming && hasContent && (
          <span
            aria-hidden
            className="document-stream-cursor inline-block h-[15px] w-[2px] align-middle bg-foreground"
            style={{
              animation:
                "agent-cursor-blink var(--motion-loop-blink) var(--motion-ease-std) infinite",
            }}
          />
        )}
        {isStreaming && !hasContent && !hasToolCalls && (
          <span className="flex items-center gap-2 text-ui text-muted-foreground">
            <span className="thinking-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span>{t("agentMode.input.thinking")}</span>
          </span>
        )}
        <SourcesRow sources={sources} />
        {hasContent && !isStreaming && (
          <div className="mt-1.5 flex justify-start">
            <button
              type="button"
              aria-label={t(copied ? "common.copied" : "common.copy")}
              onClick={handleCopy}
              className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/8 hover:text-foreground opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="group/msg flex justify-start"
      style={{ animation: "agent-message-in 200ms ease-out both" }}
    >
      <div
        data-chat-bubble
        className={cn(
          "max-w-[85%] px-3 py-2 rounded-lg rounded-es-sm",
          "bg-surface-1 border border-border/70 text-foreground",
          "text-ui leading-relaxed"
        )}
      >
        {hasToolCalls && (
          <div
            className={cn(
              (hasContent || noteCards.length > 0) && "mb-2 pb-1.5 border-b border-border/70"
            )}
          >
            {toolCalls.map((tc) => (
              <ToolCallStep key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {hasContent && (
          <MarkdownRenderer
            content={content}
            className="text-ui leading-relaxed [&_p]:text-ui [&_li]:text-ui"
          />
        )}

        {isStreaming && hasContent && (
          <span
            className="inline-block w-[2px] h-[14px] bg-foreground/70 align-middle ms-0.5"
            style={{ animation: "agent-cursor-blink 1s ease-in-out infinite" }}
          />
        )}

        {isStreaming && !hasContent && !hasToolCalls && (
          <span className="text-ui font-medium select-none thinking-shimmer-text">
            {t("agentMode.input.thinking")}...
          </span>
        )}

        {noteCards.length > 0 && !isStreaming && (
          <div>
            {noteCards.map((card) => (
              <NoteCard
                key={card.noteId}
                noteId={card.noteId}
                title={card.title}
                onOpenNote={onOpenNote}
              />
            ))}
          </div>
        )}

        {hasContent && !isStreaming && (
          <div className="flex justify-start mt-1.5 -mb-0.5">
            <button
              onClick={handleCopy}
              className={cn(
                "p-1 rounded-sm",
                "text-muted-foreground hover:text-foreground hover:bg-foreground/8",
                "opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 transition-all duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
