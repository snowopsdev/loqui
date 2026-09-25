import { PARAKEET_MODEL_INFO } from "../models/ModelRegistry";
import { getASRModelOrganization } from "../helpers/localASROrganization";

export const ONBOARDING_SPEECH_MODELS = Object.entries(PARAKEET_MODEL_INFO)
  .filter(([id]) => ["oruk", "nvidia"].includes(getASRModelOrganization(id)))
  .map(([id, info]) => ({ id, ...info, organization: getASRModelOrganization(id) }))
  .sort((a, b) => Number(b.organization === "oruk") - Number(a.organization === "oruk"));

export const DEFAULT_ONBOARDING_SPEECH_MODEL_ID = "parakeet-unified-en-0.6b";

export function supportsSpeechLanguage(modelId: string, language: string): boolean {
  const model = ONBOARDING_SPEECH_MODELS.find((entry) => entry.id === modelId);
  return Boolean(model?.supportedLanguages.includes(language.split("-")[0].toLowerCase()));
}

export function firstCompatibleSpeechModel(language: string): string | undefined {
  return ONBOARDING_SPEECH_MODELS.find((model) => supportsSpeechLanguage(model.id, language))?.id;
}
