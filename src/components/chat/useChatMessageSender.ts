import { useCallback, useRef } from "react";
import type { ChatPersistence, ChatSelection } from "./useChatPersistence";
import type { ChatStreaming, SendToAIOptions } from "./useChatStreaming";
import type { Message } from "./types";

interface PersistedMessageContext {
  conversationId: number;
  text: string;
  isFirstMessage: boolean;
}

interface UseChatMessageSenderOptions {
  conversationId: number | null;
  persistence: ChatPersistence;
  streaming: Pick<ChatStreaming, "sendToAI"> & Partial<Pick<ChatStreaming, "captureInference">>;
  createConversation: (text: string, selection?: ChatSelection) => Promise<number>;
  onBeforeSend?: () => void;
  onMessagePersisted?: (context: PersistedMessageContext) => void | Promise<void>;
  onSendingChange?: (sending: boolean) => void;
}

interface MessageSubmissionLock {
  run: (operation: () => Promise<void>) => Promise<boolean>;
}

export function createMessageSubmissionLock(): MessageSubmissionLock {
  let active = false;

  return {
    async run(operation: () => Promise<void>): Promise<boolean> {
      if (active) return false;
      active = true;
      try {
        await operation();
        return true;
      } finally {
        active = false;
      }
    },
  };
}

export function useChatMessageSender({
  conversationId,
  persistence,
  streaming,
  createConversation,
  onBeforeSend,
  onMessagePersisted,
  onSendingChange,
}: UseChatMessageSenderOptions): (text: string, options?: SendToAIOptions) => Promise<boolean> {
  const submissionLockRef = useRef<MessageSubmissionLock | null>(null);
  if (submissionLockRef.current === null) {
    submissionLockRef.current = createMessageSubmissionLock();
  }

  return useCallback(
    async (text: string, options?: SendToAIOptions) => {
      // true: the user's message reached the conversation (shown and saved),
      // even if the reply then failed; useChatStreaming renders reply errors
      // in the thread. false: another send held the lock. A rejection:
      // nothing reached the conversation (creating it or saving failed), so
      // the optimistic message is taken out and the caller keeps the words.
      // The voice-command path relies on false meaning "busy, retry".
      let reachedConversation = false;
      let optimisticId: string | null = null;
      try {
        return await submissionLockRef.current!.run(async () => {
          // Capture before callbacks or awaits can change the recipient settings.
          const selection = persistence.captureSelection?.();
          const previousMessages = [...persistence.messages];
          let admittedId = conversationId;
          const isCurrent = () =>
            selection?.isCurrent() ??
            (admittedId == null || persistence.isCurrentConversation?.(admittedId) !== false);
          const admittedOptions = {
            ...options,
            inferenceSnapshot: streaming.captureInference?.(options),
          };
          onSendingChange?.(true);
          try {
            onBeforeSend?.();
            const convId = conversationId ?? (await createConversation(text, selection));
            admittedId = convId;
            const userMessage: Message = {
              id: crypto.randomUUID(),
              role: "user",
              content: text,
              isStreaming: false,
            };

            persistence.setMessages((messages) =>
              isCurrent() ? [...messages, userMessage] : messages
            );
            optimisticId = userMessage.id;
            await persistence.saveUserMessage(text, convId);
            reachedConversation = true;
            // A saved A message must not change the state of a newly selected B composer.
            if (isCurrent()) {
              await onMessagePersisted?.({
                conversationId: convId,
                text,
                isFirstMessage: previousMessages.length === 0,
              });
            }
            await streaming.sendToAI(text, [...previousMessages, userMessage], {
              ...admittedOptions,
              owner: {
                conversationId: convId,
                isCurrent,
                onStreamComplete: (_id, content, toolCalls) =>
                  persistence.saveAssistantMessage?.(content, toolCalls, convId),
              },
            });
          } finally {
            onSendingChange?.(false);
          }
        });
      } catch (error) {
        if (!reachedConversation) {
          if (optimisticId) {
            const id = optimisticId;
            persistence.setMessages((messages) => messages.filter((m) => m.id !== id));
          }
          throw error;
        }
        console.error("Chat reply failed after the message was saved", error);
        return true;
      }
    },
    [
      conversationId,
      createConversation,
      onBeforeSend,
      onMessagePersisted,
      onSendingChange,
      persistence,
      streaming,
    ]
  );
}
