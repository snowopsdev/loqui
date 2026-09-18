import type { ReasoningConfig } from "../../BaseReasoningService";

export interface ProviderContext {
  getApiKey(provider: string): Promise<string>;
  getSystemPrompt(agentName: string | null): string;
  getCustomDictionary(): string[];
  getPreferredLanguage(): string;
  getUiLanguage(): string;
  callChatCompletionsApi(
    endpoint: string,
    apiKey: string,
    model: string,
    text: string,
    agentName: string | null,
    config: ReasoningConfig,
    providerName: string
  ): Promise<string>;
  calculateMaxTokens(
    textLength: number,
    minTokens?: number,
    maxTokens?: number,
    multiplier?: number
  ): number;
}

export interface ProviderCallParams {
  text: string;
  model: string;
  agentName: string | null;
  config: ReasoningConfig;
  ctx: ProviderContext;
}

export interface ProviderCapabilities {
  transcription: boolean;
  textGeneration: boolean;
  streaming: boolean;
  images: boolean;
  tools: boolean;
  webSearch: boolean;
}

export interface InferenceProvider {
  readonly connectionType?: "local" | "api-key" | "subscription";
  readonly capabilities?: ProviderCapabilities;
  readonly id: string;
  /** True when this client can send `config.screenContext` as image content. */
  readonly supportsImages?: boolean;
  call(params: ProviderCallParams): Promise<string>;
}
