import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStreaming } from "../components/chat/useChatStreaming";
import { buildAssistantDemoRequest } from "../utils/onboardingDemo";
import type { ChatImageAttachment, Message } from "../components/chat/types";
import type { OnboardingDemoEvent, OnboardingDemoTake } from "../types/electron";

export interface OnboardingAssistantCommand {
  text: string;
  attachment: ChatImageAttachment | null;
  onboardingTake?: OnboardingDemoTake;
}

type DemoEventInput = Omit<OnboardingDemoEvent, "demoId" | "kind">;

/**
 * Answers the onboarding assistant demo headlessly from the dictation window,
 * where the screenshot, tool registry and Voice Assistant scope live. The reply
 * travels back as demo events: "replying" while it streams, "success" once it
 * lands, and "error" when the stream ends without a reply.
 */
export function useOnboardingAssistantDemo(publish: (event: DemoEventInput) => void) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const repliedRef = useRef(false);
  const takeByUserId = useRef(new Map<string, OnboardingDemoTake | undefined>());
  const { agentState, activeToolName, sendToAI } = useChatStreaming({
    messages,
    setMessages,
    inferenceScope: "dictationAgent",
  });

  const reply = messages.find((message) => message.role === "assistant");
  const settled = agentState === "idle" && reply !== undefined && !reply.isStreaming;

  useEffect(() => {
    if (!reply) return;
    const userId = messages.find((message) => message.role === "user")?.id;
    if (!userId || !takeByUserId.current.has(userId)) return;
    const onboardingTake = takeByUserId.current.get(userId);
    if (!settled) {
      publish({
        ...onboardingTake,
        status: "replying",
        text: reply.content,
        tool: activeToolName || undefined,
      });
    } else if (!repliedRef.current) {
      publish({ ...onboardingTake, status: "error", message: reply.content });
    }
  }, [activeToolName, messages, publish, reply, settled]);

  return useCallback(
    (command: OnboardingAssistantCommand) => {
      repliedRef.current = false;
      const request = buildAssistantDemoRequest(command.text, {
        senderName: t("onboarding.rehaul.assistantDemo.email.senderName"),
        subject: t("onboarding.rehaul.assistantDemo.email.subject"),
        body: t("onboarding.rehaul.assistantDemo.email.body"),
      });
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: request,
        isStreaming: false,
      };
      const onboardingTake = command.onboardingTake;
      takeByUserId.current.clear();
      takeByUserId.current.set(userMessage.id, onboardingTake);
      setMessages([userMessage]);
      void sendToAI(request, [userMessage], {
        attachment: command.attachment ?? undefined,
        suppressResponseContent: true,
        onComplete: ({ content }) => {
          repliedRef.current = true;
          publish({ ...onboardingTake, status: "success", text: content });
        },
      });
    },
    [publish, sendToAI, t]
  );
}
