import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { notify, dismissNotice } from "./ui/notices";
import type { GooglePendingRevokeEvent, GooglePendingRevokeStatus } from "../types/electron";
import {
  GOOGLE_REVOKE_NOTICE_ID,
  googleRevokeNotice,
  startupRevokeEvent,
} from "./googleRevokeNotice";

// Owner decision D-1. Headless: mount once in the control panel. Main owns the
// pending Google revoke (a sealed disconnect keeps one; main runs it after
// unsealing). This only says what main reports (googleRevokeNotice). A
// failure or an unreadable record from before this window loaded (including
// a sealed start, when main runs nothing) is read once from main.
export default function GoogleRevokeNoticeListener() {
  const { t } = useTranslation();
  useEffect(() => {
    const api = window.electronAPI;
    const show = (event: Pick<GooglePendingRevokeEvent, "kind" | "status">) => {
      const notice = googleRevokeNotice(event, t, api);
      if (notice) notify(notice);
      else dismissNotice(GOOGLE_REVOKE_NOTICE_ID, "replaced");
    };
    let live = true;
    const unsubscribe = api?.onGcalPendingRevoke?.((event) => {
      if (event?.status) show(event);
    });
    Promise.resolve(api?.gcalPendingRevokeStatus?.())
      .then((status: GooglePendingRevokeStatus | undefined) => {
        const event = startupRevokeEvent(status);
        if (live && event) show(event);
      })
      .catch(() => {});
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [t]);
  return null;
}
