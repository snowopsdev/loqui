import type { DisclosureTask } from "../types/dictation";
import { getCleanupSystemPrompt } from "../config/prompts";
import { getSettings } from "../stores/settingsStore";
import { resolveCleanupLanguage } from "../utils/chineseScript";
import { getDictionaryHintWords } from "../utils/snippets";
import type { InferenceScope } from "../config/inferenceScopes";
import type { ScreenContextImage } from "../types/electron";

export interface ReasoningConfig {
  disclosureTask?: DisclosureTask | null;
  settingsView?: Record<string, unknown>;
  correlationId?: string | null;
  dictationOperation?: true;
  dictationSessionId?: string | null;
  enterpriseRecipientTag?: string | null;
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
  systemPrompt?: string;
  lanUrl?: string;
  baseUrl?: string;
  /** Legacy caller compatibility only; keys are never read or sent by reasoning. */
  customApiKey?: string;
  credentialRef?: string;
  provider?: string;
  disableThinking?: boolean;
  /** Explicit opt-in to the selected provider's own hosted search tool. */
  webSearch?: boolean;
  /** Screenshot attached to voice-agent requests when screen context is on. */
  screenContext?: ScreenContextImage;
  /** Suffix-free prompt used when a screenshot-carrying request is retried text-only. */
  textOnlySystemPrompt?: string;
  language?: string;
  requireCompleteOutput?: boolean;
  requiresAgent?: boolean;
  inferenceScope?: InferenceScope;
}

export abstract class BaseReasoningService {
  protected isProcessing = false;

  protected getCustomDictionary(config: ReasoningConfig = {}): string[] {
    return getDictionaryHintWords(
      (config.settingsView ?? getSettings()) as ReturnType<typeof getSettings>
    );
  }

  // Auto must remain auto here: zh-CN/zh-TW instructions make cleanup write its
  // entire response in Chinese before the transcription language is known. The
  // final deterministic script pass handles likely-Chinese output instead. See #975.
  protected getPreferredLanguage(config: ReasoningConfig = {}): string {
    return resolveCleanupLanguage(
      (config.settingsView ?? getSettings()).preferredLanguage as string
    );
  }

  protected getUiLanguage(config: ReasoningConfig = {}): string {
    return String((config.settingsView ?? getSettings()).uiLanguage || "en");
  }

  protected getSystemPrompt(agentName: string | null, config: ReasoningConfig = {}): string {
    return getCleanupSystemPrompt(
      agentName,
      this.getCustomDictionary(config),
      this.getPreferredLanguage(config),
      this.getUiLanguage(config),
      config.settingsView
        ? ((config.settingsView.customPrompts ?? {}) as Record<string, string>)
        : undefined
    );
  }

  protected calculateMaxTokens(
    textLength: number,
    minTokens = 100,
    maxTokens = 2048,
    multiplier = 2
  ): number {
    return Math.max(minTokens, Math.min(textLength * multiplier, maxTokens));
  }

  abstract isAvailable(settingsView?: Record<string, unknown>): Promise<boolean>;

  abstract processText(
    text: string,
    modelId: string,
    agentName?: string | null,
    config?: ReasoningConfig
  ): Promise<string>;
}
