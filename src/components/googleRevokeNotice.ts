import type { NoticeInput } from "./ui/notices";
import type { GooglePendingRevokeEvent } from "../types/electron";
import { GOOGLE_ACCOUNT_PERMISSIONS_URL } from "../utils/googleAccount";

// Owner decision D-1: the notice for what main reports about a pending Google
// revoke. Kept for later, done, or failed with Retry and the manual route
// (the Google Account page, opened through the guarded external opener).
export const GOOGLE_REVOKE_NOTICE_ID = "gcal-pending-revoke";
type T = (key: string) => string;
type Api = {
  openExternal?: (url: string) => unknown;
  gcalPendingRevokeRetry?: () => Promise<unknown>;
};

export function googleRevokeNotice(
  event: Pick<GooglePendingRevokeEvent, "kind" | "status">,
  t: T,
  api: Api | undefined
): NoticeInput | null {
  const openAccount = {
    label: t("sealedMode.calendar.revokeOpenAccount"),
    onClick: () => {
      void api?.openExternal?.(GOOGLE_ACCOUNT_PERMISSIONS_URL);
    },
    keepOpen: true,
  };
  if (event.kind === "queued")
    return {
      id: GOOGLE_REVOKE_NOTICE_ID,
      kind: "notice" as const,
      title: t("sealedMode.calendar.revokeQueuedTitle"),
      body: t("sealedMode.calendar.revokeQueued"),
    };
  if (event.kind === "revoked" && event.status.pending === 0)
    return {
      id: GOOGLE_REVOKE_NOTICE_ID,
      kind: "receipt" as const,
      title: t("sealedMode.calendar.revokeDoneTitle"),
      body: t("sealedMode.calendar.revokeDone"),
    };
  if (event.status.pending === 0) return null;
  return {
    id: GOOGLE_REVOKE_NOTICE_ID,
    kind: "alert" as const,
    persistent: true,
    title: t("sealedMode.calendar.revokeFailedTitle"),
    body: t("sealedMode.calendar.revokeFailed"),
    actions: [
      {
        label: t("sealedMode.calendar.revokeRetry"),
        primary: true,
        keepOpen: true,
        // The result arrives as another event, which replaces this notice.
        onClick: async () => {
          await api?.gcalPendingRevokeRetry?.();
        },
      },
      openAccount,
    ],
  };
}
