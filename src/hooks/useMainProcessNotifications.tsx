import { useEffect } from "react";
import type { TFunction } from "i18next";
import { notify, dismissNotice } from "../components/ui/notices";

/** Main-owned outcomes surfaced in the dictation window. */
export function useMainProcessNotifications({ t }: { t: TFunction }): void {
  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      notify({
        kind: "notice",
        title: t("app.toasts.hotkeyChanged.title"),
        body: t("app.toasts.hotkeyChanged.description", {
          original: data.original,
          fallback: data.fallback,
        }),
      });
    });
    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.(() => {
      notify({
        kind: "notice",
        title: t("app.toasts.hotkeyUnavailable.title"),
        body: t("app.toasts.hotkeyUnavailable.description"),
      });
    });
    const showGpuFallbackNotice = () => {
      const id = notify({
        kind: "notice",
        title: t("app.toasts.gpuFallback.title"),
        body: t("app.toasts.gpuFallback.description"),
        actions: [
          {
            label: t("app.toasts.gpuFallback.retry"),
            primary: true,
            keepOpen: true,
            onClick: async () => {
              try {
                if ((await window.electronAPI?.whisperGpuRetry?.())?.success)
                  dismissNotice(id, "action");
              } catch {
                /* Keep the explanation available for another attempt. */
              }
            },
          },
        ],
      });
    };
    const unsubscribeCudaFallback =
      window.electronAPI?.onCudaFallbackNotification?.(showGpuFallbackNotice);
    const unsubscribeGpuFallback =
      window.electronAPI?.onGpuFallbackNotification?.(showGpuFallbackNotice);
    const unsubscribeCorrections = window.electronAPI?.onCorrectionsLearned?.((words) => {
      if (!words?.length) return;
      const id = notify({
        kind: "receipt",
        title: t("app.toasts.addedToDict", { words: words.map((w) => `“${w}”`).join(", ") }),
        actions: [
          {
            label: t("app.toasts.undo"),
            primary: true,
            keepOpen: true,
            onClick: async () => {
              try {
                if ((await window.electronAPI?.undoLearnedCorrections?.(words))?.success)
                  dismissNotice(id, "action");
              } catch {
                /* The dictionary still holds the words. */
              }
            },
          },
        ],
      });
    });
    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeCudaFallback?.();
      unsubscribeGpuFallback?.();
      unsubscribeCorrections?.();
    };
  }, [t]);
}
