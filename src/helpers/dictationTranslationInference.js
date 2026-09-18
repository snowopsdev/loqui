import {
  resolveDictationTranslationReachability,
  resolveTranslationDisplayProvider,
  resolveTranslationProviderId,
} from "./dictationRouting.js";
import { isProviderValidForMode } from "../models/ModelRegistry";

// Shared by live dictation and Prompt Studio so both translation entry points
// use the same provider, endpoint, and credentials.
export function resolveDictationTranslationInference(settings) {
  const mode = settings.translationMode;
  const model = settings.translationModel?.trim() || "";
  const storedProvider = settings.translationProvider?.trim() || "";
  const providerForMode = isProviderValidForMode(storedProvider, mode) ? storedProvider : undefined;
  const provider = resolveTranslationProviderId({
    translationMode: mode,
    translationProvider: providerForMode,
  });
  const isSelfHosted = mode === "self-hosted" && !!settings.translationRemoteUrl?.trim();
  const isCustom = mode === "providers" && provider === "custom";

  return {
    reachable: resolveDictationTranslationReachability({
      useDictationTranslation: settings.useDictationTranslation,
      translationTargetLanguage: settings.translationTargetLanguage,
      translationMode: mode,
      translationProvider: provider,
      translationModel: model,
      isSelfHostedTranslation: isSelfHosted,
    }),
    model,
    displayProvider: resolveTranslationDisplayProvider({
      translationMode: mode,
      translationProvider: providerForMode,
    }),
    config: {
      inferenceScope: /** @type {const} */ ("dictationTranslation"),
      provider,
      language: settings.translationTargetLanguage,
      lanUrl: isSelfHosted ? settings.translationRemoteUrl : undefined,
      baseUrl: isCustom ? settings.translationCloudBaseUrl || undefined : undefined,
      credentialRef: isCustom || isSelfHosted ? "custom:dictationTranslation" : undefined,
      disableThinking: settings.translationDisableThinking,
    },
  };
}
