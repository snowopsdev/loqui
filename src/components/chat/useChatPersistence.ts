import { useState, useRef, useCallback, useEffect } from "react";
import type { Message, ToolCallInfo } from "./types";
import type { ContainerScope } from "../../types/chat";

interface UseChatPersistenceOptions {
  conversationId?: number | null;
  onConversationCreated?: (id: number, title: string) => void;
}

export interface ChatPersistence {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  conversationId: number | null;
  createConversation: (
    title: string,
    noteId?: number | null,
    scope?: ContainerScope
  ) => Promise<number>;
  loadConversation: (id: number) => Promise<void>;
  /** Resolves only after the user message row has been saved. */
  saveUserMessage: (text: string) => Promise<void>;
  saveAssistantMessage: (content: string, toolCalls?: ToolCallInfo[]) => Promise<void>;
  handleNewChat: () => void;
}

export function useChatPersistence(options: UseChatPersistenceOptions = {}): ChatPersistence {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(
    options.conversationId ?? null
  );
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const createConversation = useCallback(
    async (title: string, noteId?: number | null, scope?: ContainerScope): Promise<number> => {
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
      conversationIdRef.current = id;
      setConversationId(id);
      options.onConversationCreated?.(id, title);
      return id;
    },
    [options]
  );

  const loadConversation = useCallback(async (id: number) => {
    const conv = await window.electronAPI?.getAgentConversation?.(id);
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
      return {
        id: crypto.randomUUID(),
        role: m.role as Message["role"],
        content: m.content,
        isStreaming: false,
        ...(toolCalls ? { toolCalls } : {}),
      };
    });
    setMessages(loaded);
  }, []);

  const saveUserMessage = useCallback(async (text: string) => {
    const id = conversationIdRef.current;
    const add = window.electronAPI?.addAgentMessage;
    if (!id || !add) throw new Error("No conversation to save the message to");
    const saved = await add(id, "user", text);
    if (!saved) throw new Error("The conversation is no longer available");
  }, []);

  const saveAssistantMessage = useCallback(async (content: string, toolCalls?: ToolCallInfo[]) => {
    if (conversationIdRef.current) {
      window.electronAPI?.addAgentMessage?.(
        conversationIdRef.current,
        "assistant",
        content,
        toolCalls?.length ? { toolCalls } : undefined
      );
    }
  }, []);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    conversationIdRef.current = null;
    setConversationId(null);
  }, []);

  return {
    messages,
    setMessages,
    conversationId,
    createConversation,
    loadConversation,
    saveUserMessage,
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
