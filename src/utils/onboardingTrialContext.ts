import type { SettingsState } from "../stores/settingsStore";

/** Nonsecret recording choices, captured by the original overlay before waits.
 * This is proof metadata, never credential/readiness or recording authority.
 */
export function trialContext(settings: Partial<SettingsState>): string {
  return JSON.stringify([
    settings.transcriptionMode,
    settings.useLocalWhisper,
    settings.localTranscriptionProvider,
    settings.whisperModel,
    settings.parakeetModel,
    settings.cohereModel,
    settings.cloudTranscriptionProvider,
    settings.cloudTranscriptionModel,
    settings.cloudTranscriptionBaseUrl,
    settings.remoteTranscriptionUrl,
    settings.remoteTranscriptionModel,
    settings.preferredLanguage,
    settings.chineseScriptPreference,
    settings.spokenLanguages,
    settings.microphoneSelectionMode,
    settings.selectedMicDeviceId,
    settings.selectedMicDeviceLabel,
  ]);
}
