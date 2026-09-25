import { BaseReasoningService, type ReasoningConfig } from "./BaseReasoningService";
import { getSettings } from "../stores/settingsStore";
import { resolveInferenceProvider } from "../models/ModelRegistry";
import { wrapCleanupTranscript } from "../config/prompts";
import { localProvider } from "./ai/inferenceProviders/local";
import { PROVIDER_REGISTRY } from "./ai/inferenceProviders";
import { getLlmRequestTimeoutSeconds } from "../helpers/llmRequestTimeout.js";
import { createStreamingThinkFilter } from "./ai/streamingThinkFilter";
import type {
  PersonalInferenceAPI,
  TextRequest,
  InferenceEvent,
} from "./ai/personalInferenceTypes";
import type { ApplicationTool } from "./tools/ToolRegistry";

export type ToolMetadata = Record<string, unknown> | Array<Record<string, unknown>>;
export type AgentStreamChunk =
  | { type: "content"; text: string }
  | { type: "tool_calls"; calls: Array<{ id: string; name: string; arguments: string }> }
  | {
      type: "tool_result";
      callId: string;
      toolName: string;
      displayText: string;
      metadata?: ToolMetadata;
    }
  | { type: "done"; finishReason?: string };

function bridge(): PersonalInferenceAPI {
  const api = window.electronAPI?.personalInference;
  if (!api) throw new Error("Text processing is not available in this environment.");
  return api;
}

class ReasoningService extends BaseReasoningService {
  private activeRequests = new Set<string>();
  private streamAbortController: AbortController | null = null;

  private requestConfig(
    provider: string,
    model: string,
    config: ReasoningConfig
  ): Omit<TextRequest, "messages"> {
    if (!PROVIDER_REGISTRY[provider])
      throw new Error(`Unsupported reasoning provider: ${provider}`);
    if (!model.trim() && provider === "lan") model = "default";
    if (!model.trim()) throw new Error("No reasoning model selected");
    const inferenceScope = config.inferenceScope || "dictationCleanup";
    const custom = provider === "custom" || provider === "lan";
    return {
      requestId: crypto.randomUUID(),
      provider,
      model,
      inferenceScope,
      credentialRef: custom
        ? `custom:${inferenceScope}`
        : provider === "local" || provider === "codex"
          ? undefined
          : provider,
      baseUrl: custom || provider === "local" ? config.lanUrl || config.baseUrl : undefined,
      systemPrompt: config.systemPrompt,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      disableThinking: config.disableThinking,
      webSearch: config.webSearch === true,
      requireCompleteOutput: config.requireCompleteOutput,
      timeoutMs: getLlmRequestTimeoutSeconds({ scope: inferenceScope }) * 1000,
    };
  }

  async processText(
    text: string,
    model = "",
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    const settings = getSettings();
    const implicit = !config.provider && !config.baseUrl && !config.lanUrl;
    if (implicit)
      config = {
        ...config,
        provider:
          settings.cleanupMode === "local"
            ? "local"
            : settings.cleanupMode === "self-hosted"
              ? "lan"
              : settings.cleanupProvider,
        baseUrl: settings.cleanupCloudBaseUrl,
        lanUrl: settings.cleanupMode === "self-hosted" ? settings.cleanupRemoteUrl : undefined,
      };
    const provider = config.lanUrl ? "lan" : resolveInferenceProvider(config.provider, model);
    if (provider === "local") {
      return localProvider.call({
        text,
        model,
        agentName,
        config,
        ctx: {
          getSystemPrompt: this.getSystemPrompt.bind(this),
          getCustomDictionary: this.getCustomDictionary.bind(this),
          getPreferredLanguage: this.getPreferredLanguage.bind(this),
          getUiLanguage: this.getUiLanguage.bind(this),
          calculateMaxTokens: this.calculateMaxTokens.bind(this),
          getApiKey: async () => {
            throw new Error("Credentials are only available in the main process.");
          },
          callChatCompletionsApi: async () => {
            throw new Error("Use the main-process inference bridge.");
          },
        },
      });
    }
    const request: TextRequest = {
      ...this.requestConfig(provider || "", model, config),
      systemPrompt: config.systemPrompt || this.getSystemPrompt(agentName),
      messages: [
        {
          role: "user",
          content: config.screenContext
            ? [
                { type: "text", text: config.systemPrompt ? text : wrapCleanupTranscript(text) },
                {
                  type: "image",
                  image: `data:${config.screenContext.mediaType};base64,${config.screenContext.data}`,
                },
              ]
            : config.systemPrompt
              ? text
              : wrapCleanupTranscript(text),
        },
      ],
    };
    // No provider fallback: failures reach the existing cleanup retry UI while
    // audioManager keeps the original transcript.
    this.activeRequests.add(request.requestId);
    try {
      return (await bridge().textGenerate(request)).text;
    } finally {
      this.activeRequests.delete(request.requestId);
    }
  }

  async *processTextStreaming(
    messages: Array<{ role: string; content: string }>,
    model: string,
    provider: string,
    config: ReasoningConfig & { systemPrompt: string }
  ): AsyncGenerator<string, void, unknown> {
    for await (const chunk of this.processTextStreamingAI(messages, model, provider, config))
      if (chunk.type === "content") yield chunk.text;
  }

  async *processTextStreamingAI(
    messages: TextRequest["messages"],
    model: string,
    provider: string,
    config: ReasoningConfig & { systemPrompt: string },
    tools?: Record<string, ApplicationTool>
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    const api = bridge();
    const controller = new AbortController();
    this.streamAbortController = controller;
    let request: TextRequest | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      if (config.lanUrl) provider = "lan";
      else provider = resolveInferenceProvider(provider, model);
      if (provider === "local") {
        const server = await window.electronAPI.llamaServerStart(model);
        if (!server.success || !server.port)
          throw new Error(server.error || "Could not start the local text model.");
        config = { ...config, baseUrl: `http://127.0.0.1:${server.port}/v1` };
      }
      if (controller.signal.aborted) return;
      request = {
        ...this.requestConfig(provider, model, {
          ...config,
          inferenceScope: config.inferenceScope || "chatIntelligence",
        }),
        messages,
        tools: tools
          ? Object.entries(tools).map(([name, tool]) => {
              const schema = tool.inputSchema as { jsonSchema?: Record<string, unknown> };
              if (!schema?.jsonSchema) throw new Error(`Tool ${name} requires a JSON schema.`);
              return { name, description: tool.description || name, parameters: schema.jsonSchema };
            })
          : undefined,
      };
      this.activeRequests.add(request.requestId);
      const queue: InferenceEvent[] = [];
      let wake: (() => void) | undefined;
      const enqueue = (event: InferenceEvent) => {
        queue.push(event);
        wake?.();
      };
      const cancel = () => {
        void api.textCancel(request!.requestId);
        enqueue({ type: "end" });
      };
      controller.signal.addEventListener("abort", cancel, { once: true });
      unsubscribe = api.onTextEvent((event) => {
        if (event.requestId === request!.requestId) enqueue(event);
      });
      void api
        .textStream(request)
        .catch((error) => enqueue({ type: "error", error: error.message }));
      const filter =
        ["local", "lan"].includes(provider) && config.disableThinking !== false
          ? createStreamingThinkFilter()
          : null;
      while (!controller.signal.aborted) {
        if (!queue.length)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        wake = undefined;
        while (queue.length) {
          const event = queue.shift()!;
          if (event.type === "end") return;
          if (event.type === "error") throw new Error(event.error || "Text processing failed.");
          if (event.type === "chunk") {
            if (event.chunk?.type === "content") {
              const text = filter ? filter(event.chunk.text || "") : event.chunk.text;
              if (text) yield { type: "content", text };
            } else if (event.chunk?.type === "done") {
              const trailing = filter?.finish();
              if (trailing) yield { type: "content", text: trailing };
              yield { type: "done", finishReason: event.chunk.finishReason };
            }
          } else if (event.type === "tool") {
            const tool = tools?.[event.name];
            yield {
              type: "tool_calls",
              calls: [
                { id: event.callId, name: event.name, arguments: JSON.stringify(event.arguments) },
              ],
            };
            try {
              if (!tool?.execute) throw new Error("Tool is not available.");
              const result = await tool.execute(event.arguments as never, {
                toolCallId: event.callId,
                messages: [],
                abortSignal: controller.signal,
                context: undefined,
              });
              if (controller.signal.aborted) return;
              await api.textToolResult({
                requestId: request.requestId,
                callId: event.callId,
                result,
              });
              yield {
                type: "tool_result",
                callId: event.callId,
                toolName: event.name,
                displayText:
                  typeof result === "string"
                    ? result
                    : (result as { error?: string })?.error || "Done",
              };
            } catch (error) {
              await api.textToolResult({
                requestId: request.requestId,
                callId: event.callId,
                error: (error as Error).message,
              });
            }
          }
        }
      }
    } finally {
      unsubscribe?.();
      if (request) {
        this.activeRequests.delete(request.requestId);
        void api.textCancel(request.requestId);
      }
      if (this.streamAbortController === controller) this.streamAbortController = null;
    }
  }

  cancelActiveStream(): void {
    this.streamAbortController?.abort();
    this.streamAbortController = null;
  }
  cancelAllRequests(): void {
    this.cancelActiveStream();
    for (const requestId of this.activeRequests) void bridge().textCancel(requestId);
    this.activeRequests.clear();
  }
  async isAvailable(): Promise<boolean> {
    const settings = getSettings();
    const provider =
      settings.cleanupMode === "local"
        ? "local"
        : settings.cleanupMode === "self-hosted"
          ? "lan"
          : settings.cleanupProvider;
    try {
      if (provider === "local") return !!(await window.electronAPI.checkLocalReasoningAvailable());
      if (provider === "codex") return (await bridge().codexStatus()).account?.type === "chatgpt";
      // The main-process SDK can resolve AWS/Google credentials from the user's
      // local CLI configuration even when no API key is saved in this app.
      if (provider === "bedrock" || provider === "vertex") return true;
      if (provider === "lan" || provider === "custom")
        return !!(
          provider === "lan" ? settings.cleanupRemoteUrl : settings.cleanupCloudBaseUrl
        )?.trim();
      return (await bridge().credentialStatus(provider)).configured;
    } catch {
      return false;
    }
  }
  // Retained for settings callers; renderer no longer caches any credentials.
  clearApiKeyCache(_provider?: string): void {}
  destroy(): void {
    this.cancelAllRequests();
  }
}
export default new ReasoningService();
