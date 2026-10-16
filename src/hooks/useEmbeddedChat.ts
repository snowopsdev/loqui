import type { ChatSelection } from "../components/chat/useChatPersistence";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useChatPersistence } from "../components/chat/useChatPersistence";
import { useChatStreaming } from "../components/chat/useChatStreaming";
import { useChatMessageSender } from "../components/chat/useChatMessageSender";
import type { Message, AgentState } from "../components/chat/types";

interface UseEmbeddedChatOptions {
  noteId: number | null;
  folderId: number | null;
  noteTitle: string;
  noteContent: string;
  noteTranscript?: string;
}

interface NoteConversationItem {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface UseEmbeddedChatReturn {
  messages: Message[];
  agentState: AgentState;
  sendMessage: (text: string) => Promise<boolean>;
  cancelStream: () => void;
  noteConversations: NoteConversationItem[];
  activeConversationId: number | null;
  switchConversation: (id: number) => Promise<void>;
  startNewChat: () => void;
}

export function useEmbeddedChat({
  noteId,
  folderId,
  noteTitle,
  noteContent,
  noteTranscript,
}: UseEmbeddedChatOptions): UseEmbeddedChatReturn {
  const [noteConversations, setNoteConversations] = useState<NoteConversationItem[]>([]);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const [prevNoteId, setPrevNoteId] = useState(noteId);

  const persistence = useChatPersistence();
  const conversationId = persistence.conversationId;

  const noteContext = useMemo(
    () =>
      [
        `Note ID: ${noteId}`,
        folderId != null ? `Folder ID: ${folderId}` : "",
        `Title: ${noteTitle}`,
        `Content:\n${noteContent}`,
        noteTranscript ? `\nTranscript:\n${noteTranscript}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    [folderId, noteContent, noteId, noteTitle, noteTranscript]
  );

  const streaming = useChatStreaming({
    conversationId: persistence.conversationId,
    messages: persistence.messages,
    setMessages: persistence.setMessages,
    noteContext,
  });

  const fetchNoteConversations = useCallback(async () => {
    if (!noteId) return;
    const conversations = await window.electronAPI?.getConversationsForNote?.(noteId);
    if (noteIdRef.current !== noteId) return;
    setNoteConversations(conversations ?? []);
    return conversations ?? [];
  }, [noteId]);

  if (noteId !== prevNoteId) {
    setPrevNoteId(noteId);
    persistence.handleNewChat();
    setNoteConversations([]);
  }

  useEffect(() => {
    noteIdRef.current = noteId;
    if (!noteId) return;

    let stale = false;
    const selection = persistence.captureSelection();
    (async () => {
      const conversations = await window.electronAPI?.getConversationsForNote?.(noteId);
      if (stale || noteIdRef.current !== noteId || !selection.isCurrent()) return;
      setNoteConversations(conversations ?? []);
      if (conversations?.length) {
        const mostRecent = conversations[0];
        await persistence.loadConversation(mostRecent.id);
      } else {
        persistence.handleNewChat();
      }
    })();

    return () => {
      stale = true;
    };
  }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchConversation = useCallback(
    async (id: number) => {
      await persistence.loadConversation(id);
    },
    [persistence]
  );

  const startNewChat = useCallback(() => {
    persistence.handleNewChat();
  }, [persistence]);

  const createConversation = useCallback(
    async (text: string, selection?: ChatSelection) => {
      const id = await persistence.createConversation(
        `Note: ${noteTitle || "Untitled"}`,
        noteId,
        undefined,
        selection
      );
      void fetchNoteConversations();
      return id;
    },
    [fetchNoteConversations, noteId, noteTitle, persistence]
  );
  const sendMessageWithResult = useChatMessageSender({
    conversationId,
    persistence,
    streaming,
    createConversation,
  });
  const sendMessage = useCallback(
    (text: string): Promise<boolean> => sendMessageWithResult(text),
    [sendMessageWithResult]
  );

  return {
    messages: persistence.messages,
    agentState: streaming.agentState,
    sendMessage,
    cancelStream: streaming.cancelStream,
    noteConversations,
    activeConversationId: conversationId,
    switchConversation,
    startNewChat,
  };
}
