import type { InferenceProvider } from "./types";
import { mainProcessProvider, TEXT_CAPABILITIES } from "./mainProcess";
import { localProvider } from "./local";

export const PROVIDER_REGISTRY: Readonly<Record<string, InferenceProvider>> = Object.freeze({
  openai: mainProcessProvider("openai"),
  custom: mainProcessProvider("custom"),
  openrouter: mainProcessProvider("openrouter"),
  anthropic: mainProcessProvider("anthropic"),
  gemini: mainProcessProvider("gemini"),
  groq: mainProcessProvider("groq"),
  tinfoil: mainProcessProvider("tinfoil", "api-key", false),
  corti: mainProcessProvider("corti", "api-key", false),
  xai: mainProcessProvider("xai"),
  bedrock: mainProcessProvider("bedrock"),
  azure: mainProcessProvider("azure"),
  vertex: mainProcessProvider("vertex"),
  codex: mainProcessProvider("codex", "subscription", false),
  local: {
    ...localProvider,
    connectionType: "local",
    capabilities: { ...TEXT_CAPABILITIES, images: false },
  },
  lan: mainProcessProvider("lan", "api-key", false),
});

export type {
  InferenceProvider,
  ProviderContext,
  ProviderCallParams,
  ProviderCapabilities,
} from "./types";
export const providerSupportsImages = (providerId: string | undefined): boolean =>
  !!(providerId && PROVIDER_REGISTRY[providerId]?.supportsImages);
export const providerSupports = (
  providerId: string,
  capability: keyof import("./types").ProviderCapabilities
): boolean => !!PROVIDER_REGISTRY[providerId]?.capabilities?.[capability];
