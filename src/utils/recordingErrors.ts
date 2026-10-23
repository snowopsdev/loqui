import { TFunction } from "i18next";
import { isSealedModeError, sealedGenericMessageKey } from "./sealedModeError";

type RecordingError = {
  code?: string;
  title: string;
  /** Sealed mode (Plan 07): a translation key for the title. */
  titleKey?: string;
  /** Sealed mode: a provider that may still hold part of the recording. */
  providerRetained?: string;
  /** Sealed mode: older held recordings dropped to make room for this one. */
  recoveryEvicted?: number;
  /** Sealed mode: a replay outlived its hold's 30 minutes, so nothing is held now. */
  recoveryExpired?: boolean;
  description?: string;
  /** Some cards carry main's text here instead of in `description`. */
  message?: string;
  messageKey?: string;
  /** Toast variant; defaults to destructive for genuine failures. */
  variant?: "default" | "destructive";
};

// Touch-up 3, TS2-1: a card is sealed by its code or by main's marker in its
// text, whatever its code. The private take's FFmpeg merge, refused while
// sealed, reaches the card as AUDIO_CONVERSION_FAILED with main's English text.
const isSealedRecordingError = (error: RecordingError): boolean =>
  error.code === "SEALED_MODE" ||
  isSealedModeError({ message: error.description }) ||
  isSealedModeError({ message: error.message });

export function getRecordingErrorTitle(error: RecordingError, t: TFunction): string {
  if (isSealedRecordingError(error))
    return t(
      error.titleKey?.startsWith("sealedMode.")
        ? error.titleKey
        : "sealedMode.blocked.dictationTitle"
    );
  if (error.code === "recipientUnknown" || error.code === "recipientChanged")
    return t("voiceOverlay.errors.recipientTitle");
  if (error.code?.startsWith("SELECTION_EDIT_")) {
    return t("hooks.audioRecording.selectionEditing.notAppliedTitle");
  }
  if (error.code === "NETWORK_ERROR") return t(error.title);
  if (error.code === "AUTH_EXPIRED" || error.code === "AUTH_REQUIRED") {
    return t("hooks.audioRecording.errorTitles.sessionExpired");
  }
  if (error.code === "OFFLINE") return t("hooks.audioRecording.errorTitles.offline");
  if (error.code === "AGENT_REASONING_FAILED") {
    return t("hooks.audioRecording.errorTitles.agentUnavailable");
  }
  if (error.code === "SCREEN_CONTEXT_SKIPPED") {
    return t("hooks.audioRecording.errorTitles.screenContextSkipped");
  }
  if (error.code === "LIMIT_REACHED")
    return t("hooks.audioRecording.errorTitles.dailyLimitReached");
  if (error.code === "PROVIDER_RATE_LIMITED")
    return t("hooks.audioRecording.errorTitles.providerRateLimited");
  return error.title;
}

export function getRecordingErrorDescription(error: RecordingError, t: TFunction): string {
  if (isSealedRecordingError(error)) {
    // Never a raw main-process message: sealed copy is always translated, and
    // "nothing was sent" only when main refused before anything left.
    const body = t(
      error.messageKey?.startsWith("sealedMode.")
        ? error.messageKey
        : sealedGenericMessageKey({ ...error, message: error.description ?? error.message })
    );
    // T9-M1: Corti keeps an interaction until it is deleted, and the delete
    // is refused while sealed. Fix round 1, M2: a full hold dropped the oldest.
    // Fix round 2, N4: a replay that outlived its hold says why nothing is held.
    const extra = [
      error.providerRetained === "corti" ? t("sealedMode.interrupted.cortiRetained") : null,
      (error.recoveryEvicted ?? 0) > 0 ? t("sealedMode.recovery.evictedOldest") : null,
      error.recoveryExpired === true ? t("sealedMode.recovery.expiredDuringReplay") : null,
    ].filter(Boolean);
    return [body, ...extra].join(" ");
  }
  if (error.messageKey) return t(error.messageKey);
  return error.description ?? "";
}
