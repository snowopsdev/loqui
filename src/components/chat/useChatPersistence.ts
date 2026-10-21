import { useState, useRef, useCallback, useEffect } from "react";
import type { Message, ToolCallInfo } from "./types";
import type { ContainerScope } from "../../types/chat";

/** Logical display ownership survives first creation, but never navigation or remount. */
export interface ChatSelection {
  isCurrent: () => boolean;
}

interface UseChatPersistenceOptions {
  conversationId?: number | null;
  onConversationCreated?: (id: number, title: string) => void;
  /** Refresh the admitted host's history without changing its selection. */
  onConversationStored?: (id: number) => void;
}

export interface ChatPersistence {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  conversationId: number | null;
  conversationGeneration: number;
  createConversation: (
    title: string,
    noteId?: number | null,
    scope?: ContainerScope,
    selection?: ChatSelection
  ) => Promise<number>;
  captureSelection: () => ChatSelection;
  loadConversation: (id: number) => Promise<void>;
  /** Resolves only after the user message row has been saved. */
  saveUserMessage: (text: string, conversationId?: number) => Promise<void>;
  isCurrentConversation: (id: number) => boolean;
  /** Pass the admitted id for request completion, independent of the selected thread. */
  saveAssistantMessage: (
    content: string,
    toolCalls?: ToolCallInfo[],
    conversationId?: number,
    context?: Message["context"]
  ) => Promise<void>;
  handleNewChat: () => void;
}

export function useChatPersistence(options: UseChatPersistenceOptions = {}): ChatPersistence {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(
    options.conversationId ?? null
  );
  const conversationIdRef = useRef(conversationId);

  const selectionGeneration = useRef(0);
  const [conversationGeneration, setConversationGeneration] = useState(0);
  const captureSelection = useCallback((): ChatSelection => {
    const generation = selectionGeneration.current;
    return { isCurrent: () => generation === selectionGeneration.current };
  }, []);

  useEffect(
    () => () => {
      selectionGeneration.current += 1;
    },
    []
  );

  const createConversation = useCallback(
    async (
      title: string,
      noteId?: number | null,
      scope?: ContainerScope,
      selection = captureSelection()
    ): Promise<number> => {
      const conv = await window.electronAPI?.createAgentConversation?.(
        title,
        noteId ?? undefined,
        scope?.spaceId,
        scope?.folderId ?? undefined
      );
      if (!conv) {
        throw new Error("Conversation scope is no longer available");
      }
      const id = conv.id;
      options.onConversationStored?.(id);
      if (selection.isCurrent()) {
        conversationIdRef.current = id;
        setConversationId(id);
        options.onConversationCreated?.(id, title);
      }
      return id;
    },
    [options, captureSelection]
  );

  const loadConversation = useCallback(
    async (id: number) => {
      selectionGeneration.current += 1;
      setConversationGeneration(selectionGeneration.current);
      const selection = captureSelection();
      // Invalidate the old request immediately, before the history read completes.
      conversationIdRef.current = id;
      setConversationId(id);
      setMessages([]);
      const conv = await window.electronAPI?.getAgentConversation?.(id);
      if (!selection.isCurrent()) return;
      if (!conv) {
        // The conversation was deleted elsewhere (e.g. ControlPanel history).
        // Clear the id, or every subsequent save silently no-ops against the
        // tombstoned row and the session is never persisted.
        conversationIdRef.current = null;
        setConversationId(null);
        return;
      }
      conversationIdRef.current = id;
      setConversationId(id);
      const loaded: Message[] = conv.messages.map((m) => {
        const parsed = m.metadata ? tryParseMetadata(m.metadata) : undefined;
        const toolCalls = parsed?.toolCalls as ToolCallInfo[] | undefined;
        const rawContext = parsed?.context as Message["context"];
        const context =
          rawContext &&
          typeof rawContext === "object" &&
          !Array.isArray(rawContext) &&
          (rawContext.ragNotes === undefined || Array.isArray(rawContext.ragNotes)) &&
          (rawContext.pinnedNotes === undefined || Array.isArray(rawContext.pinnedNotes))
            ? rawContext
            : undefined;
        return {
          id: crypto.randomUUID(),
          role: m.role as Message["role"],
          content: m.content,
          isStreaming: false,
          ...(toolCalls ? { toolCalls } : {}),
          ...(context ? { context } : {}),
        };
      });
      setMessages((current) => (selection.isCurrent() ? loaded : current));
    },
    [captureSelection]
  );

  const isCurrentConversation = useCallback((id: number) => conversationIdRef.current === id, []);

  const saveUserMessage = useCallback(async (text: string, targetId?: number) => {
    const id = targetId ?? conversationIdRef.current;
    const add = window.electronAPI?.addAgentMessage;
    if (!id || !add) throw new Error("No conversation to save the message to");
    const saved = await add(id, "user", text);
    if (!saved) throw new Error("The conversation is no longer available");
  }, []);

  const saveAssistantMessage = useCallback(
    async (
      content: string,
      toolCalls?: ToolCallInfo[],
      targetId?: number,
      context?: Message["context"]
    ) => {
      const id = targetId ?? conversationIdRef.current;
      if (id) {
        await window.electronAPI?.addAgentMessage?.(
          id,
          "assistant",
          content,
          toolCalls?.length || context
            ? { ...(toolCalls?.length ? { toolCalls } : {}), ...(context ? { context } : {}) }
            : undefined
        );
      }
    },
    []
  );

  const handleNewChat = useCallback(() => {
    selectionGeneration.current += 1;
    setConversationGeneration(selectionGeneration.current);
    setMessages([]);
    conversationIdRef.current = null;
    setConversationId(null);
  }, []);

  return {
    messages,
    setMessages,
    conversationId,
    conversationGeneration,
    createConversation,
    captureSelection,
    loadConversation,
    saveUserMessage,
    isCurrentConversation,
    saveAssistantMessage,
    handleNewChat,
  };
}

function tryParseMetadata(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
