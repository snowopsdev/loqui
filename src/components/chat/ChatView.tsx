import type { ChatSelection } from "./useChatPersistence";
import { useChatRouteKey } from "./chatRouteKey";
import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useChatPersistence } from "./useChatPersistence";
import { useChatStreaming } from "./useChatStreaming";
import { useChatMessageSender } from "./useChatMessageSender";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { ChatModelChip } from "./ChatModelChip";
import { useResolvedRoute } from "../../lib/routes";
import { cn } from "../lib/utils";
import { ChatEmptyIllustration } from "./ChatEmptyIllustration";
import ConversationList from "./ConversationList";
import EmptyChatState from "./EmptyChatState";
import { ConfirmDialog } from "../ui/dialog";
import { PAGE_CONTENT_WIDTH_CLASS } from "../ui/pageWidth";
import { useDialogs } from "../../hooks/useDialogs";
import { seedForRequest, type ChatViewRequest, type ComposerSeed } from "./chatRequest";
export type { ChatViewRequest } from "./chatRequest";

const CommandSearch = lazy(() => import("../CommandSearch"));

interface ChatViewProps {
  request?: ChatViewRequest | null;
  onRequestHandled?: () => void;
  onOpenSettings?: (section?: string) => void;
}

function NewChatEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full -mt-6 select-none">
      <ChatEmptyIllustration />
      <p className="text-xs text-foreground/50 dark:text-foreground/45 text-center max-w-48 mt-4">
        {t("chat.newChatEmpty")}
      </p>
    </div>
  );
}

export default function ChatView({
  request = null,
  onRequestHandled,
  onOpenSettings,
}: ChatViewProps = {}) {
  const { t } = useTranslation();
  const chatRoute = useResolvedRoute("chat");
  const routeKey = useChatRouteKey("chatIntelligence");
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [isNewChat, setIsNewChat] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const { confirmDialog, showConfirmDialog, hideConfirmDialog } = useDialogs();

  const persistence = useChatPersistence({
    conversationId: activeConversationId,
    onConversationCreated: (id) => {
      setActiveConversationId(id);
    },
    onConversationStored: () => setRefreshKey((k) => k + 1),
  });

  const streaming = useChatStreaming({
    citations: true,
    conversationId: persistence.conversationId,
    messages: persistence.messages,
    setMessages: persistence.setMessages,
  });

  const handleSelectConversation = useCallback(
    async (id: number) => {
      if (id === activeConversationId) return;
      setActiveConversationId(id);
      setIsNewChat(false);
      await persistence.loadConversation(id);
    },
    [activeConversationId, persistence]
  );

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setIsNewChat(true);
    persistence.handleNewChat();
  }, [persistence]);

  const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null);
  const [seededNonce, setSeededNonce] = useState<number | null>(null);
  // Deliver the seed before any queued auto-send effect in this commit.
  // Keep it after acknowledgement, including for a composer that mounts later.
  if (request && request.nonce !== seededNonce) {
    setSeededNonce(request.nonce);
    setComposerSeed(seedForRequest(request));
  }
  useEffect(() => {
    if (!request) return;
    if (request.kind === "new") handleNewChat();
    else if (request.kind === "open") void handleSelectConversation(request.conversationId);
    onRequestHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per request nonce
  }, [request?.nonce]);

  const createConversation = useCallback(
    async (text: string, selection?: ChatSelection) => {
      const title = text.length > 50 ? `${text.slice(0, 50)}...` : text;
      return persistence.createConversation(title, undefined, undefined, selection);
    },
    [persistence]
  );
  const markChatStarted = useCallback(() => setIsNewChat(false), []);
  const handleTextSubmit = useChatMessageSender({
    conversationId: activeConversationId,
    persistence,
    streaming,
    createConversation,
    // Keep the first composer mounted until creation and persistence succeed.
    onMessagePersisted: markChatStarted,
  });

  const handleArchive = useCallback(
    async (id: number) => {
      await window.electronAPI?.archiveAgentConversation?.(id);
      if (activeConversationId === id) {
        handleNewChat();
      }
      setRefreshKey((k) => k + 1);
    },
    [activeConversationId, handleNewChat]
  );

  const handleDelete = useCallback(
    (id: number) => {
      showConfirmDialog({
        title: t("chat.delete"),
        description: t("chat.deleteConfirm"),
        onConfirm: async () => {
          await window.electronAPI?.deleteAgentConversation?.(id);
          if (activeConversationId === id) {
            handleNewChat();
          }
          setRefreshKey((k) => k + 1);
        },
        variant: "destructive",
      });
    },
    [activeConversationId, handleNewChat, showConfirmDialog, t]
  );

  const hasActiveChat =
    activeConversationId !== null || persistence.messages.length > 0 || isNewChat;

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />
      {showSearch && (
        <Suspense fallback={null}>
          <CommandSearch
            open={showSearch}
            onOpenChange={setShowSearch}
            mode="conversations"
            onConversationSelect={handleSelectConversation}
          />
        </Suspense>
      )}
      <div className="flex h-full">
        <div className="w-56 min-w-50 shrink-0 border-e border-border dark:border-white/10">
          <ConversationList
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            onNewChat={handleNewChat}
            onOpenSearch={() => setShowSearch(true)}
            onArchive={handleArchive}
            onDelete={handleDelete}
            refreshKey={refreshKey}
          />
        </div>
        <div className="flex-1 min-w-80 flex flex-col">
          {hasActiveChat ? (
            <>
              <ChatMessages
                variant="document"
                messages={persistence.messages}
                emptyState={<NewChatEmptyState />}
                contentClassName={PAGE_CONTENT_WIDTH_CLASS}
              />
              <div className="px-3 pb-3 pt-1">
                <div
                  className={cn(
                    PAGE_CONTENT_WIDTH_CLASS,
                    "flex flex-wrap items-center gap-2 pb-1.5"
                  )}
                >
                  <ChatModelChip
                    route={chatRoute}
                    onOpenSettings={(path) => onOpenSettings?.(path)}
                  />
                </div>
                <ChatInput
                  className={PAGE_CONTENT_WIDTH_CLASS}
                  agentState={streaming.agentState}
                  partialTranscript=""
                  seed={composerSeed}
                  onTextSubmit={handleTextSubmit}
                  queueKey={`chat|${activeConversationId ?? "new"}|${routeKey}`}
                  onCancel={streaming.cancelStream}
                  autoFocus={isNewChat}
                  voiceDraft
                />
              </div>
            </>
          ) : (
            <EmptyChatState />
          )}
        </div>
      </div>
    </>
  );
}
