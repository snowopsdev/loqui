import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "./ui/notices";
import { isDictationPanelWindow } from "../utils/windowContext";

/**
 * One-time notice that the legacy-layout migration cleared a GPU pack, which
 * otherwise degrades to a silent CPU fallback. The notice is persisted by the
 * main process (it happens before any window exists) and cleared once shown.
 * See #1606.
 */
export default function GpuPackMigrationNoticeListener() {
  const { t } = useTranslation();

  useEffect(() => {
    // Only the control panel shows it — the dictation panel is transient and
    // would burn the one-time notice where it's least likely to be read.
    if (isDictationPanelWindow()) return;
    let cancelled = false;
    window.electronAPI?.getGpuPackMigrationNotice?.().then((notice) => {
      if (cancelled || !notice) return;
      notify({
        title: t("app.toasts.gpuPackMigration.title"),
        body: t("app.toasts.gpuPackMigration.description", {
          packs: notice.packs.join(", "),
        }),
        kind: "notice",
        persistent: true,
      });
      window.electronAPI?.dismissGpuPackMigrationNotice?.();
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return null;
}
