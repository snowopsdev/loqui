import type { SystemProfile } from "../types/electron";
import {
  DEFAULT_ONBOARDING_SPEECH_MODEL_ID,
  ONBOARDING_SPEECH_MODELS,
  supportsSpeechLanguage,
} from "./onboardingSpeechModels";

// Detection uses OS language preferences and advisory disk space only. It never
// listens to speech or infers a language from the user's voice.
export type VoiceOutcome = "fastEnglish" | "manyLanguages" | "liveCaptions" | "liveMultilingual";

export type VoiceReason =
  | { kind: "english" }
  | { kind: "language"; language: string }
  | { kind: "multilingual"; languages: string[] }
  | { kind: "unsupported"; language: string };

export interface VoicePick {
  modelId: string | null;
  outcome: VoiceOutcome | null;
  languages: string[];
  reason: VoiceReason;
  disk: { neededBytes: number; freeBytes: number } | null;
}

/** parakeet.js needs size × 2.5 available to download and extract. */
export const DISK_HEADROOM = 2.5;

const OUTCOME_BY_MODEL: Record<string, VoiceOutcome> = {
  "parakeet-unified-en-0.6b": "fastEnglish",
  "orukeet-v0.1.0": "manyLanguages",
  "parakeet-tdt-0.6b-v3": "manyLanguages",
  "nemotron-speech-streaming-en-0.6b": "liveCaptions",
  "nemotron-3.5-asr-streaming-0.6b": "liveMultilingual",
};

export function outcomeFor(modelId: string): VoiceOutcome | null {
  return OUTCOME_BY_MODEL[modelId] ?? null;
}

export function modelDownloadBytes(modelId: string): number | null {
  const model = ONBOARDING_SPEECH_MODELS.find((entry) => entry.id === modelId);
  return model ? Math.round(model.sizeMb * 1_000_000) : null;
}

export function baseLanguages(locales: readonly string[]): string[] {
  const languages: string[] = [];
  for (const locale of locales) {
    const base = String(locale).trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
    if (/^[a-z]{2,3}$/.test(base) && !languages.includes(base)) languages.push(base);
  }
  return languages.length ? languages : ["en"];
}

const supportsAll = (modelId: string, languages: readonly string[]) =>
  languages.every((language) => supportsSpeechLanguage(modelId, language));

function chooseModel(languages: readonly string[]): {
  modelId: string | null;
  reason: VoiceReason;
} {
  const supported = languages.filter((language) =>
    ONBOARDING_SPEECH_MODELS.some((model) => supportsSpeechLanguage(model.id, language))
  );
  if (supported.length === 0)
    return { modelId: null, reason: { kind: "unsupported", language: languages[0] } };
  if (supported.every((language) => language === "en")) {
    return { modelId: DEFAULT_ONBOARDING_SPEECH_MODEL_ID, reason: { kind: "english" } };
  }

  const allLanguages =
    ONBOARDING_SPEECH_MODELS.find(
      (model) => model.runtime !== "online" && supportsAll(model.id, supported)
    ) ?? ONBOARDING_SPEECH_MODELS.find((model) => supportsAll(model.id, supported));
  if (allLanguages && supported.length > 1) {
    return { modelId: allLanguages.id, reason: { kind: "multilingual", languages: supported } };
  }

  const primary = supported[0];
  const primaryModel =
    allLanguages ??
    ONBOARDING_SPEECH_MODELS.find((model) => supportsSpeechLanguage(model.id, primary));
  return { modelId: primaryModel?.id ?? null, reason: { kind: "language", language: primary } };
}

export function detectVoice(profile: Pick<SystemProfile, "locales" | "freeDiskBytes">): VoicePick {
  const detectedLanguages = baseLanguages(profile.locales);
  const { modelId, reason } = chooseModel(detectedLanguages);
  const size = modelId ? modelDownloadBytes(modelId) : null;
  const neededBytes = size === null ? null : Math.round(size * DISK_HEADROOM);
  const freeBytes = profile.freeDiskBytes;
  return {
    modelId,
    outcome: modelId ? outcomeFor(modelId) : null,
    languages: modelId
      ? detectedLanguages.filter((language) => supportsSpeechLanguage(modelId, language))
      : [],
    reason,
    // This is advisory; main remains responsible for download admission.
    disk:
      neededBytes !== null && freeBytes !== null && freeBytes < neededBytes
        ? { neededBytes, freeBytes }
        : null,
  };
}

/** Apply detection only when there is no stored explicit model choice. */
export function shouldApplyDetectedVoice(storedParakeetModel: string | null): boolean {
  return storedParakeetModel === null;
}

export function isOnboardingVoice(modelId: string | null | undefined): modelId is string {
  return (
    typeof modelId === "string" && ONBOARDING_SPEECH_MODELS.some((entry) => entry.id === modelId)
  );
}

export function voiceSupportsAll(modelId: string, languages: readonly string[]): boolean {
  return (
    languages.length > 0 && languages.every((language) => supportsSpeechLanguage(modelId, language))
  );
}

/** Keep a compatible voice, otherwise select the first offline-compatible catalog voice. */
export function reconcileVoice(
  modelId: string | null,
  languages: readonly string[]
): { modelId: string | null; changed: boolean } {
  if (modelId && voiceSupportsAll(modelId, languages)) return { modelId, changed: false };
  const replacement =
    ONBOARDING_SPEECH_MODELS.find(
      (model) => model.runtime !== "online" && voiceSupportsAll(model.id, languages)
    ) ?? ONBOARDING_SPEECH_MODELS.find((model) => voiceSupportsAll(model.id, languages));
  const nextModelId = replacement?.id ?? null;
  return { modelId: nextModelId, changed: nextModelId !== modelId };
}

/** Preserve full OS locale tags for the languages heard by the selected voice. */
export function spokenLocalesFor(
  locales: readonly string[],
  languages: readonly string[]
): string[] {
  const matched = locales.filter((locale) => languages.includes(baseLanguages([locale])[0]));
  return matched.length ? [...new Set(matched)] : [...languages];
}
