import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useMentionSources } from "../../hooks/useMentionSources";
import { useWorkspaceNavigation } from "../workspaceNavigation";
import {
  searchMentionEntities,
  flattenMentionGroups,
  type MentionResult,
} from "../../lib/mentionSearch";
import MentionSuggestions, { type MentionSuggestionsHandle } from "../ui/MentionSuggestions";
import { isDialogOpen } from "../../lib/workspaceShortcuts";
import { getPlatform } from "../../utils/platform";
import {
  buildPinnedContext,
  buildRailModel,
  detectMentionQuery,
  removeMentionQuery,
  pinnedFromMention,
  RAIL_STORAGE_KEY,
  type PinnedContextItem,
} from "./contextRail";
import { ChatContextRail } from "./ChatContextRail";
import type { ChatSelection } from "./useChatPersistence";
import { useChatRouteKey } from "./chatRouteKey";
import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  lazy,
  Suspense,
} from "react";
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

const CONTEXT_KINDS = ["note", "meeting", "dictation", "folder"] as const;
const NO_PEOPLE: [] = [];
const FOCUS = "focus-visible:ring-2 focus-visible:ring-ring";
type MentionIntent = {
  start: number;
  query: string;
  source: "typed" | "button";
  text: string;
  caret: number;
  selection: number;
};
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
  const { t, i18n } = useTranslation();
  const chatRoute = useResolvedRoute("chat");
  const routeKey = useChatRouteKey("chatIntelligence");
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [isNewChat, setIsNewChat] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const { confirmDialog, showConfirmDialog, hideConfirmDialog } = useDialogs();

  const navigation = useWorkspaceNavigation();
  const mentionSourcesRef = useMentionSources(NO_PEOPLE);
  const { recentNotes, transcriptions, folders } = mentionSourcesRef.current;
  const sourceKey = useMemo(
    () => JSON.stringify([i18n.language, recentNotes, transcriptions, folders]),
    [i18n.language, recentNotes, transcriptions, folders]
  );
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const [pinned, setPinned] = useState<PinnedContextItem[]>([]);
  const pinnedRef = useRef(pinned);
  const [railOpen, setRailOpen] = useState(() => {
    const saved = window.localStorage.getItem(RAIL_STORAGE_KEY);
    return saved == null ? window.innerWidth >= 1280 : saved === "true";
  });
  const toggleRef = useRef<HTMLButtonElement>(null);
  const toggleRail = useCallback(
    () =>
      setRailOpen((open) => {
        window.localStorage.setItem(RAIL_STORAGE_KEY, String(!open));
        return !open;
      }),
    []
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(window.innerWidth);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setAvailableWidth(root.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const wideRail = availableWidth >= 784;
  const compact = availableWidth < 544;
  const selectionRef = useRef(0);
  const draftRef = useRef({ text: "", caret: 0 });
  const [mentionIntent, setMentionIntent] = useState<MentionIntent | null>(null);
  const intentRef = useRef<MentionIntent | null>(null);
  const mentionListRef = useRef<MentionSuggestionsHandle>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const composerAreaRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ left: 8, top: 8 });
  const [results, setResults] = useState<{
    intent: MentionIntent;
    sourceKey: string;
    items: MentionResult[];
  } | null>(null);
  const changeIntent = useCallback((intent: MentionIntent | null) => {
    intentRef.current = intent;
    setMentionIntent(intent);
    setResults(null);
  }, []);
  const clearConversationContext = useCallback(() => {
    selectionRef.current += 1;
    pinnedRef.current = [];
    setPinned([]);
    changeIntent(null);
  }, [changeIntent]);
  useEffect(
    () => () => {
      intentRef.current = null;
    },
    []
  );
  const onDraftChange = useCallback(
    (text: string, caret: number) => {
      draftRef.current = { text, caret };
      const match = detectMentionQuery(text, caret);
      const current = intentRef.current;
      // Focus/seed notifications for the same draft keep a button pick intact.
      // Any real edit or caret move retires its rows before the next command.
      if (
        current?.text === text &&
        current.caret === caret &&
        current.selection === selectionRef.current
      )
        return;
      if (match)
        changeIntent({ ...match, text, caret, source: "typed", selection: selectionRef.current });
      else changeIntent(null);
    },
    [changeIntent]
  );
  useEffect(() => {
    if (!mentionIntent) return;
    let alive = true;
    const intent = mentionIntent;
    void searchMentionEntities(intent.query, mentionSourcesRef.current, CONTEXT_KINDS)
      .then((groups) => {
        if (alive && intentRef.current === intent && sourceKeyRef.current === sourceKey)
          setResults({ intent, sourceKey, items: flattenMentionGroups(groups) });
      })
      .catch(() => {
        if (alive && intentRef.current === intent && sourceKeyRef.current === sourceKey)
          setResults({ intent, sourceKey, items: [] });
      });
    return () => {
      alive = false;
    };
  }, [mentionIntent, mentionSourcesRef, sourceKey]);
  const mentionItems =
    results?.intent === mentionIntent && results?.sourceKey === sourceKey ? results.items : [];
  useLayoutEffect(() => {
    if (!mentionIntent) return;
    const place = () => {
      const anchor = composerAreaRef.current?.getBoundingClientRect();
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const rtl = getComputedStyle(popup).direction === "rtl";
      const width = popup.getBoundingClientRect().width;
      setPopupPosition({
        left: Math.max(
          8,
          Math.min(rtl ? anchor.right - width : anchor.left, window.innerWidth - width - 8)
        ),
        top: Math.max(8, anchor.top - popup.getBoundingClientRect().height - 6),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (popupRef.current) observer.observe(popupRef.current);
    if (composerAreaRef.current) observer.observe(composerAreaRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [mentionIntent, sourceKey]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = getPlatform() === "darwin" ? event.metaKey : event.ctrlKey;
      if (
        !mod ||
        event.key !== "." ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        isDialogOpen(document)
      )
        return;
      event.preventDefault();
      toggleRail();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleRail]);
  const unpin = useCallback((item: PinnedContextItem) => {
    const next = pinnedRef.current.filter((p) => p.kind !== item.kind || p.id !== item.id);
    pinnedRef.current = next;
    setPinned(next);
  }, []);

  const persistence = useChatPersistence({
    conversationId: activeConversationId,
    onConversationCreated: (id) => {
      setActiveConversationId(id);
    },
    onConversationStored: () => setRefreshKey((k) => k + 1),
  });

  const streaming = useChatStreaming({
    citations: true,
    getPinnedContext: () =>
      buildPinnedContext(
        pinnedRef.current.map((item) => ({ ...item })),
        window.electronAPI
      ),
    conversationId: persistence.conversationId,
    messages: persistence.messages,
    setMessages: persistence.setMessages,
  });

  const handleSelectConversation = useCallback(
    async (id: number) => {
      if (id === activeConversationId) return;
      clearConversationContext();
      setActiveConversationId(id);
      setIsNewChat(false);
      await persistence.loadConversation(id);
    },
    [activeConversationId, persistence, clearConversationContext]
  );

  const handleNewChat = useCallback(() => {
    clearConversationContext();
    setActiveConversationId(null);
    setIsNewChat(true);
    persistence.handleNewChat();
  }, [persistence, clearConversationContext]);

  const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null);
  const seedSequenceRef = useRef(0);
  const [seededNonce, setSeededNonce] = useState<number | null>(null);
  // Deliver the seed before any queued auto-send effect in this commit.
  // Keep it after acknowledgement, including for a composer that mounts later.
  if (request && request.nonce !== seededNonce) {
    setSeededNonce(request.nonce);
    setComposerSeed({ ...seedForRequest(request), nonce: ++seedSequenceRef.current });
  }
  useEffect(() => {
    if (!request) return;
    if (request.kind === "new") {
      handleNewChat();
      // Child layout effects mirror the render-time seed before this navigation
      // effect. Admit its query against the new logical selection after cleanup.
      if (request.draft !== undefined) onDraftChange(draftRef.current.text, draftRef.current.caret);
    } else if (request.kind === "open") void handleSelectConversation(request.conversationId);
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

  const pickMention = (item: MentionResult) => {
    const intent = intentRef.current;
    if (
      !intent ||
      results?.intent !== intent ||
      results.sourceKey !== sourceKeyRef.current ||
      !results.items.includes(item) ||
      intent.selection !== selectionRef.current
    )
      return;
    // Selection can change before React delivers onSelect. Commands must check
    // the textarea itself as well as the intent/result ownership above.
    const textarea = composerAreaRef.current?.querySelector("textarea");
    if (!textarea) return;
    const draft = { text: textarea.value, caret: textarea.selectionStart };
    if (
      draft.text !== intent.text ||
      draft.caret !== intent.caret ||
      (intent.source === "typed" &&
        detectMentionQuery(draft.text, draft.caret)?.start !== intent.start)
    ) {
      onDraftChange(draft.text, draft.caret);
      return;
    }
    const next = pinnedFromMention(item);
    if (!next) return;
    if (!pinnedRef.current.some((p) => p.kind === next.kind && p.id === next.id)) {
      pinnedRef.current = [...pinnedRef.current, next];
      setPinned(pinnedRef.current);
    }
    changeIntent(null);
    if (intent.source === "typed") {
      const text = removeMentionQuery(draft.text, intent);
      setComposerSeed({
        text,
        caret: intent.start,
        nonce: ++seedSequenceRef.current,
        resetQueue: false,
      });
    }
  };

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
      {mentionIntent &&
        createPortal(
          <div
            ref={popupRef}
            dir={i18n.dir()}
            data-chat-context-picker
            style={{
              position: "fixed",
              zIndex: 50,
              left: popupPosition.left,
              top: popupPosition.top,
              maxWidth: "calc(100vw - 16px)",
              maxHeight: "min(236px, calc(100vh - 16px))",
              overflow: "auto",
            }}
          >
            <MentionSuggestions
              key={`${mentionIntent.selection}:${sourceKey}`}
              ref={mentionListRef}
              items={mentionItems}
              command={pickMention}
            />
          </div>,
          document.body
        )}
      <div
        ref={rootRef}
        className="grid h-full min-h-0 min-w-0"
        style={{
          gridTemplateColumns: compact
            ? "minmax(0, 1fr)"
            : wideRail && railOpen && hasActiveChat
              ? "224px minmax(0, 1fr) 240px"
              : "224px minmax(0, 1fr)",
          gridTemplateRows: compact
            ? "auto minmax(0, 1fr) auto"
            : !wideRail && railOpen && hasActiveChat
              ? "minmax(0, 1fr) auto"
              : "minmax(0, 1fr)",
        }}
      >
        <div
          className={cn(
            "min-h-0 overflow-y-auto border-e border-border dark:border-white/10",
            compact && "max-h-28"
          )}
        >
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
        <div className="min-h-0 min-w-0 flex flex-col">
          {hasActiveChat ? (
            <>
              <ChatMessages
                variant="document"
                messages={persistence.messages}
                emptyState={<NewChatEmptyState />}
                contentClassName={PAGE_CONTENT_WIDTH_CLASS}
              />
              <div ref={composerAreaRef} className="px-3 pb-3 pt-1">
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
                  {pinned.map((item) => (
                    <span
                      key={`${item.kind}-${item.id}`}
                      className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-border px-2 text-caption text-foreground"
                    >
                      <span dir="auto" className="min-w-0 truncate">
                        {item.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => unpin(item)}
                        aria-label={t("chat.rail.unpin", { label: item.label })}
                        className={cn("shrink-0 rounded p-0.5 text-muted-foreground", FOCUS)}
                      >
                        <X size={12} aria-hidden />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className={cn("h-7 rounded px-2 text-caption text-foreground", FOCUS)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      changeIntent({
                        start: draftRef.current.caret,
                        query: "",
                        source: "button",
                        ...draftRef.current,
                        selection: selectionRef.current,
                      });
                      setComposerSeed({
                        nonce: ++seedSequenceRef.current,
                        resetQueue: false,
                        caret: draftRef.current.caret,
                      });
                    }}
                  >
                    {t("chat.rail.addContext")}
                  </button>
                  <button
                    ref={toggleRef}
                    type="button"
                    aria-pressed={railOpen}
                    className={cn("ms-auto h-7 rounded px-2 text-caption text-foreground", FOCUS)}
                    onClick={toggleRail}
                  >
                    {t("chat.rail.toggle")}{" "}
                    <kbd className="text-caption">
                      {getPlatform() === "darwin" ? "⌘." : "Ctrl+."}
                    </kbd>
                  </button>
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
                  onDraftChange={onDraftChange}
                  interceptKeyDown={(event) => {
                    if (!intentRef.current) return false;
                    if (event.key === "Escape") {
                      changeIntent(null);
                      return true;
                    }
                    const handled = mentionListRef.current?.onKeyDown(event.nativeEvent) ?? false;
                    return handled || event.key === "Enter";
                  }}
                  voiceDraft
                />
              </div>
            </>
          ) : (
            <EmptyChatState />
          )}
        </div>
        {railOpen && hasActiveChat && (
          <div
            className={cn(
              "min-h-0 min-w-0 overflow-y-auto",
              !wideRail && "max-h-44 border-t border-border"
            )}
            style={!wideRail ? { gridColumn: "1 / -1" } : undefined}
          >
            <div className="flex justify-end px-3 pt-2">
              <button
                type="button"
                aria-label={t("common.close")}
                className={cn("rounded p-1 text-muted-foreground", FOCUS)}
                onClick={() => {
                  toggleRail();
                  toggleRef.current?.focus();
                }}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
            <ChatContextRail
              model={buildRailModel(
                persistence.messages,
                pinned,
                (tc) =>
                  tc.result ?? t(`agentMode.tools.${tc.name}Status`, { defaultValue: tc.name })
              )}
              onUnpin={unpin}
              onOpenNote={navigation.openNote}
            />
          </div>
        )}
      </div>
    </>
  );
}
