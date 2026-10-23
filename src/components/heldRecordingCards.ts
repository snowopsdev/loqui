import { dismissNotice, getNotices, notify, type NoticeAction } from "./ui/notices";
import { buildHeldRecordingGoneNotice, SEALED_RECOVERY_NOTICE_ID } from "./voiceNotices";
import { recoveryCount, recoveryStatus, subscribeRecovery } from "../lib/sealedRecovery";

type T = (key: string, options?: Record<string, unknown>) => string;

export interface HeldRecordingCards {
  /** The card's Transcribe: it always names its own hold. */
  transcribeAction(input: {
    holdId: number;
    label: string;
    transcribe: (holdId: number) => unknown;
  }): NoticeAction;
  /** Follow a card that names `holdId` through `action`. */
  track(noticeId: string, holdId: number, action: NoticeAction): void;
  dispose(): void;
}

/**
 * Plan 07 Task 13, fix round 2 (N2). A held-recording card names one hold.
 * When that hold ends, the card follows it:
 * - expired, evicted, or no longer known: the card says the recording is no
 *   longer held and loses Transcribe;
 * - transcribed or discarded: the card leaves, unless it carries recovered
 *   words, which are never dropped (the card is rewritten instead).
 * A card the user already dismissed, or one replaced by a newer revision
 * without this action, is left alone. The unseal prompt leaves once nothing
 * is held.
 */
export function watchHeldRecordingCards(t: T): HeldRecordingCards {
  const cards = new Map<string, { holdId: number; action: NoticeAction }>();
  let reconciling = false;
  let again = false;
  let disposed = false;

  const reconcileOnce = () => {
    for (const [noticeId, card] of [...cards]) {
      const status = recoveryStatus(card.holdId);
      if (status === "held" || status === "replaying" || status === "expiring") continue;
      cards.delete(noticeId);
      const current = getNotices().find((n) => n.id === noticeId);
      if (!current || !current.actions?.includes(card.action)) continue;
      const words = current.words;
      if ((status === "transcribed" || status === "discarded") && !words) {
        dismissNotice(noticeId, "action");
        continue;
      }
      notify(
        buildHeldRecordingGoneNotice(t, {
          id: noticeId,
          reason: status,
          words,
          actions: current.actions.filter((a) => a !== card.action),
        })
      );
    }
    if (recoveryCount() === 0) dismissNotice(SEALED_RECOVERY_NOTICE_ID, "replaced");
  };

  // recoveryCount() may itself drop an expired hold and notify; run again
  // instead of re-entering.
  const reconcile = () => {
    if (disposed) return;
    if (reconciling) {
      again = true;
      return;
    }
    reconciling = true;
    try {
      do {
        again = false;
        reconcileOnce();
      } while (again && !disposed);
    } finally {
      reconciling = false;
    }
  };

  const off = subscribeRecovery(reconcile);
  return {
    transcribeAction: ({ holdId, label, transcribe }) => ({
      label,
      onClick: () => {
        void transcribe(holdId);
      },
    }),
    track(noticeId, holdId, action) {
      if (disposed) return;
      cards.set(noticeId, { holdId, action });
      reconcile();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      off();
      cards.clear();
    },
  };
}
