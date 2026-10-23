import type { NoticeAction, NoticeInput } from "./ui/notices";
import type { CleanupFailure } from "../stores/cleanupFailureStore";

type T = (key: string, options?: Record<string, unknown>) => string;

/**
 * A dictation failure with no content shares this id: the next status
 * replaces it, and the next start or success clears it.
 */
export const DICTATION_STATUS_NOTICE_ID = "dictation-error";

/**
 * A failure that holds content (recovered words, or audio Plan 07 holds) gets
 * one notice per dictation session. Nothing automatic removes it (R2-C3).
 */
export function dictationRecoveryNoticeId(sessionKey: string): string {
  return `dictation-recovery:${sessionKey}`;
}

/** VO-Q7: dictation succeeded, cleanup did not. Amber, actionable, not an error. */
export function buildCleanupFailureNotice(
  failure: CleanupFailure,
  t: T,
  actions: {
    retry: () => Promise<void>;
    openSettings: () => void;
    copyCommand?: () => Promise<void>;
  }
): NoticeInput {
  const cause = failure.messageKey ? t(failure.messageKey, failure.messageParams) : failure.message;
  const guidance = failure.actionKey ? t(failure.actionKey) : failure.action;
  const body = [cause, guidance, failure.copyCommand].filter(Boolean).join("\n\n");
  return {
    id: "cleanup-failed",
    kind: "notice",
    title: t("notices.cleanupFailed.title"),
    ...(body ? { body } : {}),
    ...(failure.technicalDetails ? { details: failure.technicalDetails } : {}),
    actions: [
      ...(failure.rawText
        ? [{ label: t("notices.cleanupFailed.retry"), primary: true, onClick: actions.retry }]
        : []),
      { label: t("notices.cleanupFailed.settings"), onClick: actions.openSettings },
      ...(failure.copyCommand && actions.copyCommand
        ? [
            {
              label: t("reasoning.enterprise.technicalDetails.copyCommand"),
              keepOpen: true,
              onClick: actions.copyCommand,
            },
          ]
        : []),
    ],
  };
}

/** VO-Q21: a provider retired the model; the switch waits for acknowledgement. */
export function buildModelSwitchNotice(
  change: { from: string; to: string },
  t: T,
  actions: { openSettings: () => void }
): NoticeInput {
  return {
    id: "tinfoil-model-switch",
    kind: "notice",
    persistent: true,
    title: t("notices.modelChanged.title"),
    body: t("reasoning.tinfoil.modelRetired", change),
    actions: [
      { label: t("notices.modelChanged.accept"), primary: true, onClick: () => {} },
      { label: t("notices.modelChanged.choose"), onClick: actions.openSettings },
    ],
  };
}

/** VO-R6 B: words first. Without words it is a plain alert with Retry. */
export function buildDictationErrorNotice(
  input: {
    title: string;
    description?: string;
    words?: string;
    recoveryHeld?: boolean;
    sessionKey: string;
  },
  t: T,
  actions: {
    retry: () => void;
    pasteAgain: (words: string) => Promise<void>;
    extraActions?: NoticeAction[];
  }
): NoticeInput {
  const words = input.words?.trim() ? input.words : undefined;
  const holdsContent = Boolean(words || input.recoveryHeld);
  const primary: NoticeAction[] = words
    ? [
        {
          label: t("notices.actions.pasteAgain"),
          primary: true,
          keepOpen: true,
          onClick: () => actions.pasteAgain(words),
        },
      ]
    : input.recoveryHeld
      ? [] // Retry would hit the same seal; Plan 07's Transcribe (extraActions) is the way back
      : [{ label: t("common.retry"), primary: true, onClick: actions.retry }];
  return {
    id: holdsContent ? dictationRecoveryNoticeId(input.sessionKey) : DICTATION_STATUS_NOTICE_ID,
    kind: "alert",
    title: input.title,
    ...(input.description ? { body: input.description } : {}),
    ...(words ? { words } : {}),
    // §5.3: audio held in memory is user content at stake, so the alert never times out.
    ...(input.recoveryHeld ? { persistent: true } : {}),
    actions: [...primary, ...(actions.extraActions ?? [])],
  };
}

/** §5.3: Plan 07's recovery prompt once Sealed mode is off and recordings are held. */
export function buildSealedRecoveryNotice(
  t: T,
  actions: { transcribe: () => Promise<unknown>; discard: () => void }
): NoticeInput {
  return {
    id: "sealed-recovery",
    kind: "notice",
    persistent: true,
    title: t("sealedMode.recovery.availableTitle"),
    actions: [
      {
        label: t("sealedMode.recovery.transcribe"),
        primary: true,
        onClick: async () => {
          await actions.transcribe();
        },
      },
      { label: t("sealedMode.recovery.discard"), onClick: actions.discard },
    ],
  };
}
