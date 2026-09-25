import type { InferenceProvider, ProviderCapabilities } from "./types";
import { getLlmRequestTimeoutSeconds } from "../../../helpers/llmRequestTimeout.js";
import { wrapCleanupTranscript } from "../../../config/prompts";

export const TEXT_CAPABILITIES: ProviderCapabilities = {
  transcription: false,
  textGeneration: true,
  streaming: true,
  images: true,
  tools: true,
  webSearch: false,
};
export function mainProcessProvider(
  id: string,
  connectionType: "api-key" | "subscription" | "local" = "api-key",
  images = true
): InferenceProvider {
  return {
    id,
    connectionType,
    capabilities: {
      ...TEXT_CAPABILITIES,
      images,
      webSearch: ["openai", "anthropic", "gemini"].includes(id),
    },
    supportsImages: images,
    async call({ text, model, agentName, config, ctx }) {
      const provider = config.provider || id;
      const scope = config.inferenceScope || "dictationCleanup";
      const custom = provider === "custom" || provider === "lan";
      const result = await window.electronAPI.personalInference.textGenerate({
        requestId: crypto.randomUUID(),
        timeoutMs: getLlmRequestTimeoutSeconds({ scope }) * 1000,
        provider,
        model,
        inferenceScope: scope,
        credentialRef: custom
          ? `custom:${scope}`
          : connectionType === "api-key"
            ? provider
            : undefined,
        baseUrl: custom ? config.lanUrl || config.baseUrl : undefined,
        systemPrompt: config.systemPrompt || ctx.getSystemPrompt(agentName),
        messages: [
          { role: "user", content: config.systemPrompt ? text : wrapCleanupTranscript(text) },
        ],
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        disableThinking: config.disableThinking,
        webSearch: config.webSearch === true,
        requireCompleteOutput: config.requireCompleteOutput,
      });
      return result.text;
    },
  };
}
