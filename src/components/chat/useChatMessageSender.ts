import { useCallback, useEffect, useRef } from "react";
import type { ChatPersistence, ChatSelection } from "./useChatPersistence";
import type { ChatStreaming, SendToAIOptions } from "./useChatStreaming";
import {
  chatAdmissionPresentation,
  type ChatAdmissionPresentation,
} from "./chatRequestPresentation";
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
  /** Optional display-only observer of a fresh typed admission; cleanup is owner-fenced. */
  onAdmissionPresentation?: (presentation: ChatAdmissionPresentation) => (() => void) | void;
  /** Local response notification for that same exact admitted display snapshot. */
  onAdmissionResponse?: (presentation: ChatAdmissionPresentation) => void;
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
  onAdmissionPresentation,
  onAdmissionResponse,
}: UseChatMessageSenderOptions): (text: string, options?: SendToAIOptions) => Promise<boolean> {
  const submissionLockRef = useRef<MessageSubmissionLock | null>(null);
  if (submissionLockRef.current === null) {
    submissionLockRef.current = createMessageSubmissionLock();
  }

  const presentationCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => presentationCleanupRef.current?.(), []);

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
          let finishPresentation: (() => void) | null = null;
          try {
            if (
              !options?.operation &&
              admittedOptions.inferenceSnapshot &&
              onAdmissionPresentation
            ) {
              const presentation = chatAdmissionPresentation(admittedOptions.inferenceSnapshot);
              const release = onAdmissionPresentation(presentation);
              if (onAdmissionResponse) {
                admittedOptions.onResponseContent = () => {
                  onAdmissionResponse(presentation);
                  options?.onResponseContent?.();
                };
              }
              let settled = false;
              finishPresentation = () => {
                if (settled) return;
                settled = true;
                if (typeof release === "function") release();
                if (presentationCleanupRef.current === finishPresentation)
                  presentationCleanupRef.current = null;
              };
              presentationCleanupRef.current = finishPresentation;
            }
            onSendingChange?.(true);
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
                onStreamComplete: (_id, content, toolCalls, context) =>
                  persistence.saveAssistantMessage?.(content, toolCalls, convId, context),
              },
            });
          } finally {
            finishPresentation?.();
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
      onAdmissionPresentation,
      onAdmissionResponse,
      persistence,
      streaming,
    ]
  );
}
