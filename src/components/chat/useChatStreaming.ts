import { isProviderSearchEnabled } from "../../utils/providerSearch";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  appendDictionarySuffix,
  appendCitationSuffix,
  appendScreenContextSuffix,
  getAgentSystemPrompt,
} from "../../config/prompts";
import { getAgentToolActivityRemainingMs } from "../../helpers/agentToolPresentation";
import { resolveChatStreamingInference } from "../../helpers/dictationAgentInference.js";
import { providerSupportsImages } from "../../services/ai/inferenceProviders";
import ReasoningService, { type AgentStreamChunk } from "../../services/ReasoningService";
import { createToolRegistry } from "../../services/tools";
import type { ToolRegistry } from "../../services/tools/ToolRegistry";
import { getSettings, useSettingsStore } from "../../stores/settingsStore";
import type { ContainerScope } from "../../types/chat";
import {
  buildAgentRequestText,
  type AgentSelectionContext,
} from "../../utils/agentSelectionContext";
import logger from "../../utils/logger";
import { getDictionaryHintWords } from "../../utils/snippets";
import type { AgentState, ChatImageAttachment, Message, MessageRoute, ToolCallInfo } from "./types";
import { buildRagContext } from "./ragContext";
import { resolveRoute, routeSnapshotFromSettings } from "../../lib/routes";
import { toMessageRoute } from "./messageRoute";
const STREAM_FLUSH_INTERVAL_MS = 32;

const LOCAL_TOOL_MIN_PARAMS_B = 4;

function estimateModelSizeB(modelId: string): number {
  const match = modelId.match(/-([\d.]+)[bB]/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Which settings scope answers a conversation. Typed chat surfaces stay on the
 * Chat scope; the voice assistant panel runs on the Voice Assistant scope so
 * the model picked under Settings > Voice Assistant is the one that answers
 * (see resolveChatStreamingInference for its Chat fallback).
 */
type ChatStreamingScope = "chatIntelligence" | "dictationAgent";

interface UseChatStreamingOptions {
  /** Display owner; changing threads clears activity without redirecting an admitted request. */
  conversationId?: number | null;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Settings scope the conversation resolves its provider and model from. */
  inferenceScope?: ChatStreamingScope;
  /** Optional note context to prepend to the system prompt (used by embedded note chat). */
  noteContext?: string;
  /** Optional container scope applied to RAG and the search_notes tool (container overview chat). */
  searchScope?: ContainerScope;
  onStreamComplete?: (
    assistantId: string,
    content: string,
    toolCalls?: ToolCallInfo[],
    context?: Message["context"]
  ) => void | Promise<void>;
  citations?: boolean;
  /** Fires exactly once when displayable assistant content or tool activity becomes available. */
  onResponseContent?: () => void;
}

export interface SendToAIOptions {
  /** Request ownership survives navigation and unmount; completion persists to its admitted conversation. */
  owner?: {
    conversationId: number;
    isCurrent: () => boolean;
    onStreamComplete: (
      assistantId: string,
      content: string,
      toolCalls?: ToolCallInfo[],
      context?: Message["context"]
    ) => void | Promise<void>;
  };
  /** Effective inference target captured synchronously when the sender admits a message. */
  inferenceSnapshot?: ChatInferenceSnapshot;
  /** Screenshot for this message; attached only when the resolved model can see it. */
  attachment?: ChatImageAttachment;
  /** Agent-response selection attached to this request without changing chat history. */
  selectedContext?: AgentSelectionContext;
  /** Keeps a caret-destined voice response in the compact pill while it streams. */
  suppressResponseContent?: boolean;
  /** Per-request completion hook used to deliver a finished voice response. */
  onComplete?: (result: {
    assistantId: string;
    content: string;
    toolCalls?: ToolCallInfo[];
  }) => void | Promise<void>;
}

export interface ChatInferenceSnapshot {
  settings: ReturnType<typeof getSettings>;
  inference: ReturnType<typeof resolveChatStreamingInference>;
  sentRoute: MessageRoute;
  webSearch: boolean;
  noteContext?: string;
  searchScope?: ContainerScope;
}

export interface ChatStreaming {
  captureInference: (options?: SendToAIOptions) => ChatInferenceSnapshot;
  agentState: AgentState;
  toolStatus: string;
  activeToolName: string;
  sendToAI: (userText: string, allMessages: Message[], options?: SendToAIOptions) => Promise<void>;
  cancelStream: () => void;
}

type HistoryMessage = { role: string; content: string | Array<Record<string, unknown>> };

// Walks backward to the newest user message; a null transform keeps walking.
function transformLastUserMessage(
  history: HistoryMessage[],
  transform: (message: HistoryMessage) => HistoryMessage | null
): void {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "user") continue;
    const replacement = transform(history[i]);
    if (replacement === null) continue;
    history[i] = replacement;
    break;
  }
}

export function useChatStreaming({
  conversationId,
  setMessages,
  inferenceScope = "chatIntelligence",
  noteContext: externalNoteContext,
  searchScope,
  onStreamComplete,
  citations = false,
  onResponseContent,
}: UseChatStreamingOptions): ChatStreaming {
  const { t } = useTranslation();
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [toolStatus, setToolStatus] = useState("");
  const [activeToolName, setActiveToolName] = useState("");
  const mountedRef = useRef(true);
  const activeConversationRef = useRef<number | null | undefined>(undefined);
  const noteContextRef = useRef(externalNoteContext);
  noteContextRef.current = externalNoteContext;
  const searchScopeRef = useRef(searchScope);
  searchScopeRef.current = searchScope;
  const toolRegistryRef = useRef<{ key: string; registry: ToolRegistry } | null>(null);
  const toolActivityStartedAtRef = useRef<number | null>(null);
  const toolActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToolActivityTimer = useCallback(() => {
    if (toolActivityTimerRef.current) {
      clearTimeout(toolActivityTimerRef.current);
      toolActivityTimerRef.current = null;
    }
  }, []);

  const clearToolActivity = useCallback(() => {
    clearToolActivityTimer();
    toolActivityStartedAtRef.current = null;
    if (!mountedRef.current) return;
    setToolStatus("");
    setActiveToolName("");
  }, [clearToolActivityTimer]);

  useEffect(() => {
    // Creating the admitted first conversation is not navigation away from it.
    if (conversationId !== activeConversationRef.current) {
      setAgentState("idle");
      clearToolActivity();
    }
  }, [conversationId, clearToolActivity]);

  const beginToolActivity = useCallback(
    (name: string, status: string) => {
      clearToolActivityTimer();
      toolActivityStartedAtRef.current = Date.now();
      setActiveToolName(name);
      setToolStatus(status);
    },
    [clearToolActivityTimer]
  );

  const completeToolActivity = useCallback(() => {
    const startedAt = toolActivityStartedAtRef.current;
    if (startedAt == null) {
      clearToolActivity();
      return;
    }

    const remainingMs = getAgentToolActivityRemainingMs(startedAt);
    clearToolActivityTimer();
    if (remainingMs === 0) {
      clearToolActivity();
      return;
    }

    toolActivityTimerRef.current = setTimeout(clearToolActivity, remainingMs);
  }, [clearToolActivity, clearToolActivityTimer]);

  const sendGenerationRef = useRef(0);
  // Generation stamped by the most recent cancel issued while still mounted
  // (Esc, a Stop button). The unmount cleanup below flips mountedRef off
  // before routing through cancelStream, so it never stamps this — which is
  // how sendToAI tells a user's cancel from an unmount mid-stream.
  const explicitCancelGenerationRef = useRef(0);
  const cancelStream = useCallback(() => {
    sendGenerationRef.current += 1;
    if (mountedRef.current) {
      explicitCancelGenerationRef.current = sendGenerationRef.current;
    }
    ReasoningService.cancelActiveStream();
    setAgentState("idle");
    clearToolActivity();
  }, [clearToolActivity]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Route through cancelStream so every cancellation path — Esc/Stop and
      // an unmount mid-stream alike — bumps the same generation counter.
      // Calling ReasoningService.cancelActiveStream() directly here (as this
      // used to) left sendToAI's cancelled() check unaware of an unmount
      // cancel, so its empty-response fallback still fired and persisted a
      // fabricated reply for a send the user never saw complete.
      cancelStream();
    };
  }, [cancelStream]);

  const captureInference = useCallback(
    (options?: SendToAIOptions): ChatInferenceSnapshot => {
      const settings = getSettings();
      const inference = resolveChatStreamingInference(settings, {
        inferenceScope,
        hasScreenContext: !!options?.attachment,
        isProviderImageWired: providerSupportsImages,
      });
      const config = inference.config;
      // Freeze disclosure at admission, before creation, user-save or RAG waits.
      // The shared hook may answer on the agent or its chosen vision override.
      const routeId =
        config.scope === "dictationAgentVision"
          ? "assistantVision"
          : config.scope === "dictationAgent"
            ? "voiceAssistant"
            : "chat";
      const sentRoute = toMessageRoute(resolveRoute(routeSnapshotFromSettings(settings), routeId));
      return {
        settings,
        sentRoute,
        noteContext: noteContextRef.current,
        searchScope: searchScopeRef.current ? { ...searchScopeRef.current } : undefined,
        inference: { ...inference, config: { ...config } },
        webSearch: isProviderSearchEnabled(
          config.scope === "dictationAgentVision" ? "dictationAgent" : config.scope,
          config.provider,
          config.mode
        ),
      };
    },
    [inferenceScope]
  );

  const sendToAI = useCallback(
    async (userText: string, allMessages: Message[], options?: SendToAIOptions) => {
      activeConversationRef.current = options?.owner?.conversationId;
      const isCurrent = () => options?.owner?.isCurrent() !== false;
      // Keep reply metadata independently of whichever thread the UI now displays.
      let requestMessages = allMessages;
      const updateMessages: typeof setMessages = (update) => {
        requestMessages = typeof update === "function" ? update(requestMessages) : update;
        setMessages((current) => {
          if (!isCurrent()) return current;
          return typeof update === "function" ? update(current) : update;
        });
      };
      const updateAgentState = (state: AgentState) => {
        setAgentState((current) => (isCurrent() ? state : current));
      };
      const completeRequest = options?.owner?.onStreamComplete ?? onStreamComplete;
      const sendGeneration = ++sendGenerationRef.current;
      const cancelled = () => sendGeneration !== sendGenerationRef.current;
      if (isCurrent()) clearToolActivity();
      let responseAnnounced = false;
      const announceResponse = () => {
        if (responseAnnounced) return;
        responseAnnounced = true;
        if (isCurrent() && !options?.suppressResponseContent) onResponseContent?.();
      };
      const snapshot = options?.inferenceSnapshot ?? captureInference(options);
      const settings = snapshot.settings;
      const { config: llmConfig, attachScreenContext } = snapshot.inference;
      const requestedAttachment = attachScreenContext ? (options?.attachment ?? null) : null;
      const llmMode = llmConfig.mode || "local";
      updateAgentState("thinking");

      const isLanAgent = llmMode === "self-hosted" && !!llmConfig.remoteUrl;
      const isCustomAgent = llmMode === "providers" && llmConfig.provider === "custom";
      const isLocalProvider = ![
        "codex",
        "bedrock",
        "azure",
        "vertex",
        "openai",
        "groq",
        "custom",
        "anthropic",
        "gemini",
        "tinfoil",
        "openrouter",
        "corti",
      ].includes(llmConfig.provider);
      const localModelCanUseTool =
        isLocalProvider && estimateModelSizeB(llmConfig.model) >= LOCAL_TOOL_MIN_PARAMS_B;
      const supportsTools = !isLocalProvider || localModelCanUseTool;

      const scope = snapshot.searchScope;
      let registry: ToolRegistry | null = null;
      if (supportsTools) {
        const scopeKey = scope ? `${scope.spaceId}:${scope.folderId ?? ""}` : "";
        // The calendar tool reads the shared provider-deduped events table,
        // so any connected provider enables it.
        const calendarConnected =
          settings.gcalConnected || settings.mcalConnected || settings.appleCalendarConnected;

        // Triggers ride in the tool description, so a snippet edit rebuilds the registry.
        const snippetKey = settings.snippets.map((s) => s.trigger).join("|");
        const cacheKey = `${calendarConnected}-${scopeKey}-${snippetKey}`;
        if (toolRegistryRef.current?.key === cacheKey) {
          registry = toolRegistryRef.current.registry;
        } else {
          registry = createToolRegistry({
            calendarConnected,
            searchScope: scope,
            vocabulary: {
              getDictionary: () => getSettings().customDictionary,
              updateDictionary: (changes) =>
                useSettingsStore.getState().updateCustomDictionary(changes),
              getSnippets: () => getSettings().snippets,
              setSnippets: (snippets) => useSettingsStore.getState().setSnippets(snippets),
            },
          });
          toolRegistryRef.current = { key: cacheKey, registry };
        }
      }

      const rag = await buildRagContext(window.electronAPI, userText, scope);
      const ragContext = rag.text;
      if (cancelled() || !mountedRef.current) return;
      const combinedContext = [snapshot.noteContext, ragContext].filter(Boolean).join("\n\n");
      // The user's dictionary rides on every conversation so replies use their
      // jargon — same suffix the dictation prompts carry.
      let systemPrompt = appendDictionarySuffix(
        getAgentSystemPrompt(
          registry?.getAll().map((t) => t.name),
          combinedContext || undefined
        ),
        getDictionaryHintWords(settings),
        settings.uiLanguage
      );

      // Only ChatView opts in; bubble-only chat surfaces keep their existing prompt.
      const hasSources = (registry?.getAll().length ?? 0) > 0 || ragContext.length > 0;
      if (citations && hasSources) systemPrompt = appendCitationSuffix(systemPrompt);

      const history: HistoryMessage[] = allMessages
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      const selectedContext = options?.selectedContext;
      if (selectedContext) {
        transformLastUserMessage(history, (message) =>
          typeof message.content === "string"
            ? { ...message, content: buildAgentRequestText(message.content, selectedContext) }
            : null
        );
      }

      // A screenshot the resolver kept rides with the command it came with:
      // BYOK models get it as an image part, the cloud agent as a dedicated
      // field the server vision-routes (older servers strip the unknown field,
      // which degrades to a plain command). A dropped one costs nothing but the
      // image — the command still runs.
      const attachment = requestedAttachment;

      if (attachment) {
        // The screenshot needs its grounding instruction, exactly like the
        // dictation path pairs the suffix with an attached image. Restore it
        // for cloud context once openwhispr-api#157 vision-routes that field.
        systemPrompt = appendScreenContextSuffix(systemPrompt, settings.uiLanguage);
      }
      if (attachment) {
        transformLastUserMessage(history, (message) => ({
          role: "user",
          content: [
            { type: "text", text: message.content as string },
            { type: "image", image: attachment.image, mediaType: attachment.mediaType },
          ],
        }));
      }

      const assistantId = crypto.randomUUID();
      updateMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
          context: { ragNotes: rag.notes, route: snapshot.sentRoute },
        },
      ]);
      updateAgentState("streaming");

      // Chat re-parses the whole answer through react-markdown on every
      // content write, so one write per streamed token made parse cost scale
      // with token count. Buffer and flush at most once per interval.
      let fullContent = "";
      let contentFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const cancelContentFlush = () => {
        if (contentFlushTimer === null) return;
        clearTimeout(contentFlushTimer);
        contentFlushTimer = null;
      };
      const flushContentNow = () => {
        cancelContentFlush();
        updateMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m))
        );
      };
      const scheduleContentFlush = () => {
        if (contentFlushTimer !== null) return;
        contentFlushTimer = setTimeout(flushContentNow, STREAM_FLUSH_INTERVAL_MS);
      };

      try {
        let stream: AsyncGenerator<AgentStreamChunk>;

        {
          const aiTools = registry?.toAISDKFormat();
          stream = ReasoningService.processTextStreamingAI(
            history,
            llmConfig.model,
            llmConfig.provider,
            {
              systemPrompt,
              // Policy and managed enforcement judge the scope that actually
              // answers: the panel's Chat fallback as Chat, and the vision
              // override as the agent scope whose image lane it is.
              inferenceScope:
                llmConfig.scope === "dictationAgentVision" ? "dictationAgent" : llmConfig.scope,
              lanUrl: isLanAgent ? llmConfig.remoteUrl : undefined,
              baseUrl: isCustomAgent ? llmConfig.cloudBaseUrl || undefined : undefined,
              customApiKey:
                isCustomAgent || isLanAgent ? llmConfig.customApiKey || undefined : undefined,
              disableThinking: llmConfig.disableThinking,
              webSearch: snapshot.webSearch,
            },
            aiTools
          );
        }

        for await (const chunk of stream) {
          if (!mountedRef.current) {
            ReasoningService.cancelActiveStream();
            break;
          }
          if (chunk.type === "content") {
            if (chunk.text) announceResponse();
            fullContent += chunk.text;
            scheduleContentFlush();
          } else if (chunk.type === "tool_calls") {
            // Text that arrived before a tool step must be on screen before the
            // step appears, not an interval after it.
            flushContentNow();
            if (chunk.calls.length > 0) announceResponse();
            for (const call of chunk.calls) {
              updateAgentState("tool-executing");
              if (isCurrent())
                beginToolActivity(
                  call.name,
                  t(`agentMode.tools.${call.name}Status`, { defaultValue: `Using ${call.name}...` })
                );
              updateMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: [
                          ...(m.toolCalls || []),
                          {
                            id: call.id,
                            name: call.name,
                            arguments: call.arguments,
                            status: "executing" as const,
                          },
                        ],
                      }
                    : m
                )
              );
            }
          } else if (chunk.type === "tool_result") {
            updateMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId && m.toolCalls
                  ? {
                      ...m,
                      toolCalls: m.toolCalls.map((tc) =>
                        tc.id === chunk.callId
                          ? {
                              ...tc,
                              status: "completed" as const,
                              result: chunk.displayText,
                              ...(chunk.metadata ? { metadata: chunk.metadata } : {}),
                            }
                          : tc
                      ),
                    }
                  : m
              )
            );
            updateAgentState("streaming");
            if (isCurrent()) completeToolActivity();
          }
        }

        if (cancelled() || !mountedRef.current) {
          flushContentNow();
          updateMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, isStreaming: false } : message
            )
          );
          // An unmount mid-stream (page navigation) keeps the partial reply in
          // history so the saved conversation matches what the user last saw;
          // an explicit cancel drops it. The unmount cleanup cancels too, so
          // cancelled() alone cannot tell the two apart. Neither path may run
          // the per-request delivery hook.
          const explicitlyCancelled = explicitCancelGenerationRef.current > sendGeneration;
          if (!explicitlyCancelled && fullContent.trim().length > 0) {
            const finalMsg = requestMessages.find((m) => m.id === assistantId);
            await completeRequest?.(
              assistantId,
              fullContent,
              finalMsg?.toolCalls,
              finalMsg?.context
            );
          }
          return;
        }

        flushContentNow();
        const hasDeliverableContent = fullContent.trim().length > 0;
        if (!responseAnnounced && !cancelled()) {
          // The stream ended without a visible token or tool call (think-only
          // local model, empty completion). Show that as a reply so every
          // listener — the assistant panel's thinking state included — sees a
          // terminal outcome.
          fullContent = t("agentMode.chat.emptyResponse");
          announceResponse();
          updateMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m))
          );
        }

        updateMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
        );

        const finalMsg = requestMessages.find((m) => m.id === assistantId);
        await completeRequest?.(assistantId, fullContent, finalMsg?.toolCalls, finalMsg?.context);
        // Persistence may yield while Stop or unmount cancels this request.
        // Its saved reply stays in history, but cancelled work must never deliver.
        if (hasDeliverableContent && !cancelled() && mountedRef.current) {
          await options?.onComplete?.({
            assistantId,
            content: fullContent,
            toolCalls: finalMsg?.toolCalls,
          });
        }
      } catch (error) {
        if (cancelled()) {
          flushContentNow();
          updateMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, isStreaming: false } : message
            )
          );
        } else {
          cancelContentFlush();
          logger.error(
            "Assistant request failed",
            {
              scope: llmConfig.scope,
              mode: llmMode,
              provider: llmConfig.provider,
              model: llmConfig.model,
              attachScreenContext,
              error: (error as Error).message,
            },
            "reasoning"
          );
          announceResponse();
          updateMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `${t("agentMode.chat.errorPrefix")}: ${(error as Error).message}`,
                    isStreaming: false,
                  }
                : m
            )
          );
        }
      }

      updateAgentState("idle");
      if (isCurrent()) completeToolActivity();
    },
    [
      captureInference,
      t,
      setMessages,
      onStreamComplete,
      citations,
      onResponseContent,
      clearToolActivity,
      beginToolActivity,
      completeToolActivity,
    ]
  );

  return {
    agentState,
    toolStatus,
    activeToolName,
    sendToAI,
    captureInference,
    cancelStream,
  };
}
