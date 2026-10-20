import { useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, PanelRight, PanelRightClose } from "../icons";
import { cn } from "../lib/utils";
import { ChatMessages } from "../chat/ChatMessages";
import { ChatInput } from "../chat/ChatInput";
import { ChatModelChip } from "../chat/ChatModelChip";
import { useResolvedRoute } from "../../lib/routes";
import { useWorkspaceNavigation } from "../workspaceNavigation";
import type { ComposerSeed } from "../chat/chatRequest";
import type { Message, AgentState } from "../chat/types";
import type { ContainerConversationItem } from "../../hooks/useContainerChat";
import { ConversationPicker } from "./ConversationPicker";
import { FLOATING_CHAT_MAX_HEIGHT_CSS } from "./floatingChatLayout";

export type EmbeddedChatMode = "hidden" | "floating" | "sidebar";

interface EmbeddedChatProps {
  mode: EmbeddedChatMode;
  onModeChange: (mode: EmbeddedChatMode) => void;
  messages: Message[];
  agentState: AgentState;
  onTextSubmit: (text: string) => void | boolean | Promise<void | boolean>;
  queueKey?: string;
  composerSeed?: ComposerSeed | null;
  onCancel: () => void;
  noteConversations?: ContainerConversationItem[];
  activeConversationId?: number | null;
  onSwitchConversation?: (id: number) => void;
  onNewChat?: () => void;
  /** Floating panel ref; NoteEditor reserves scroll space with it. */
  floatingPanelRef?: React.Ref<HTMLDivElement>;
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center h-full select-none">
      <p className="text-xs text-foreground/45 dark:text-foreground/45 text-center max-w-44">
        {t("embeddedChat.emptyState")}
      </p>
    </div>
  );
}

export default function EmbeddedChat({
  mode,
  onModeChange,
  messages,
  agentState,
  onTextSubmit,
  queueKey,
  composerSeed,
  onCancel,
  noteConversations,
  activeConversationId,
  onSwitchConversation,
  onNewChat,
  floatingPanelRef,
}: EmbeddedChatProps) {
  const { t } = useTranslation();
  const chatRoute = useResolvedRoute("chat");
  const navigation = useWorkspaceNavigation();

  const lifetime = useRef(false);
  useEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false;
    };
  }, []);
  const handleOpenNote = useCallback(
    (noteId: number) => {
      navigation.openNote(noteId, { isEligible: () => lifetime.current });
    },
    [navigation]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "floating") {
        onModeChange("hidden");
      }
    },
    [mode, onModeChange]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const hasConversationSelector =
    noteConversations !== undefined && onSwitchConversation !== undefined;

  const headerTitle = hasConversationSelector ? (
    <ConversationPicker
      conversations={noteConversations}
      activeConversationId={activeConversationId}
      onSwitchConversation={onSwitchConversation}
      onNewChat={onNewChat}
      titleClassName="max-w-32"
    />
  ) : (
    <span className="text-xs font-medium text-foreground/50">{t("embeddedChat.title")}</span>
  );

  const header = (
    <div
      className={cn(
        "h-9 flex items-center px-3 shrink-0",
        mode === "sidebar" && "border-b border-border/70 dark:border-white/10"
      )}
    >
      {headerTitle}
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        {mode === "floating" ? (
          <button
            onClick={() => onModeChange("sidebar")}
            className="h-6 w-6 flex items-center justify-center rounded-md text-foreground/45 hover:bg-foreground/6 transition-colors"
            aria-label={t("embeddedChat.dock")}
          >
            <PanelRight size={13} className="rtl:scale-x-[-1]" />
          </button>
        ) : (
          <button
            onClick={() => onModeChange("floating")}
            className="h-6 w-6 flex items-center justify-center rounded-md text-foreground/45 hover:bg-foreground/6 transition-colors"
            aria-label={t("embeddedChat.undock")}
          >
            <PanelRightClose size={13} className="rtl:scale-x-[-1]" />
          </button>
        )}
        <button
          onClick={() => onModeChange("hidden")}
          className="h-6 w-6 flex items-center justify-center rounded-md text-foreground/45 hover:bg-foreground/6 transition-colors"
          aria-label={t("embeddedChat.close")}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );

  const chatContent = (
    <>
      {header}
      <div className="flex-1 min-h-0 flex flex-col **:data-chat-bubble:max-w-full">
        <ChatMessages messages={messages} emptyState={<EmptyState />} onOpenNote={handleOpenNote} />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-1.5">
        <ChatModelChip route={chatRoute} onOpenSettings={navigation.openSettings} />
      </div>
      <ChatInput
        agentState={agentState}
        partialTranscript=""
        onTextSubmit={onTextSubmit}
        queueKey={queueKey}
        seed={composerSeed}
        active={mode !== "hidden"}
        onCancel={onCancel}
        voiceDraft
      />
    </>
  );

  // One stable subtree owns the draft, unsent buffer and destination queue.
  // Changing placement never re-admits an old seed. Hidden chat stays inert.
  return (
    <div
      ref={mode === "floating" ? floatingPanelRef : undefined}
      hidden={mode === "hidden"}
      inert={mode === "hidden"}
      style={mode === "floating" ? { maxHeight: FLOATING_CHAT_MAX_HEIGHT_CSS } : undefined}
      className={cn(
        mode === "hidden" ? "hidden" : "flex flex-col min-h-0",
        mode === "floating" && [
          "absolute col-start-1 row-start-2 bottom-4 start-5 end-5 z-20 mx-auto max-w-[600px]",
          "min-h-50 bg-background/95 dark:bg-surface-2/95",
          "border border-black/15 dark:border-white/18",
          "ring-1 ring-inset ring-white/60 dark:ring-white/8 rounded-xl shadow-elevated backdrop-blur-2xl",
          "animate-[scale-in_200ms_ease-out]",
        ],
        mode === "sidebar" &&
          "col-start-2 row-start-1 row-span-2 w-85 border-s border-black/12 dark:border-white/14 bg-surface-1 dark:bg-surface-2"
      )}
    >
      {chatContent}
    </div>
  );
}
