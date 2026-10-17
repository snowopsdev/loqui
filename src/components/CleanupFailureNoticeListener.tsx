import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { writeClipboardText } from "../utils/writeClipboardText";
import { notify } from "./ui/notices";
import { buildCleanupFailureNotice } from "./voiceNotices";
import { retryDictationCleanup } from "../helpers/retryDictationCleanup";
import { useResolvedRoute } from "../lib/routes";
import { consumeCleanupFailures, useCleanupFailureStore } from "../stores/cleanupFailureStore";
import { isDictationPanelWindow } from "../utils/windowContext";

/** Tells the user their dictation was pasted raw because AI cleanup failed. */
export default function CleanupFailureNoticeListener() {
  const { t } = useTranslation();
  const cleanupRoute = useResolvedRoute("dictationCleanup");

  const pending = useCleanupFailureStore((s) => s.pending);

  useEffect(() => {
    if (pending === 0) return;
    const state = useCleanupFailureStore.getState();
    const failure = state.lastFailure ?? { message: state.lastMessage };
    // Draining first keeps a re-run of this effect from toasting the same failure twice.
    if (consumeCleanupFailures() === 0) return;
    // The panel may already be hidden after dictation; surface it so the toast is seen.
    if (isDictationPanelWindow()) {
      window.electronAPI?.showDictationPanel?.();
    }
    // Keep the failed operation, never a closure that reads the next recording.
    const operation = failure.retryCleanup;
    const rawText = failure.rawText;
    const copyCommand = failure.copyCommand;
    notify(
      buildCleanupFailureNotice(failure, t, {
        retry: async () => {
          if (rawText) await retryDictationCleanup(rawText, { processText: operation });
        },
        openSettings: () => void window.electronAPI?.openSettingsAt?.(cleanupRoute.settingsPath),
        copyCommand: async () => {
          if (!copyCommand) return;
          const copied = await writeClipboardText(copyCommand);
          notify({
            id: "cleanup-command-copy",
            kind: copied ? "receipt" : "alert",
            title: t(copied ? "notices.wordsCard.copied" : "notices.wordsCard.copyFailed"),
            ...(!copied ? { body: t("notices.wordsCard.copyFailedHint") } : {}),
          });
        },
      })
    );
  }, [pending, t, cleanupRoute.settingsPath]);

  return null;
}
