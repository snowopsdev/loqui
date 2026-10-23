import { cn } from "../lib/utils";
import { useStickToBottom } from "../../hooks/useStickToBottom";
import { ChatMessage } from "./ChatMessage";
import type { Message } from "./types";

interface ChatMessagesProps {
  messages: Message[];
  emptyState?: React.ReactNode;
  onOpenNote?: (noteId: number) => void;
  /** Extra classes for the message column (e.g. a page-width cap); the scroll container stays full width. */
  contentClassName?: string;
  variant?: "bubble" | "document";
}

export function ChatMessages({
  messages,
  emptyState,
  onOpenNote,
  contentClassName,
  variant = "bubble",
}: ChatMessagesProps) {
  // Follow the stream only while the user is at the bottom; scrolling up to
  // re-read must not be yanked back down by the next token.
  const {
    scrollRef,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useStickToBottom<HTMLDivElement>(messages);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={cn("flex-1 overflow-y-auto agent-chat-scroll", "px-3 py-2")}
    >
      {messages.length === 0 ? (
        (emptyState ?? null)
      ) : (
        <div
          className={cn(
            "flex flex-col",
            variant === "document" ? "gap-6" : "gap-1.5",
            contentClassName
          )}
        >
          {messages
            .filter((msg) => msg.role !== "tool")
            .map((msg) => (
              <ChatMessage
                key={msg.id}
                role={msg.role as "user" | "assistant"}
                content={msg.content}
                isStreaming={msg.isStreaming}
                toolCalls={msg.toolCalls}
                context={msg.context}
                variant={variant}
                onOpenNote={onOpenNote}
              />
            ))}
        </div>
      )}
    </div>
  );
}
