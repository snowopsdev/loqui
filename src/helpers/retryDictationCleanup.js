import { sealedFailureMessage } from "../utils/sealedModeError";

// UI dependencies load lazily; the operation itself is captured BEFORE this await.
async function loadDefaultDeps() {
  const [{ default: i18n }, { notify }, { writeClipboardText }] = await Promise.all([
    import("../i18n"),
    import("../components/ui/notices"),
    import("../utils/writeClipboardText"),
  ]);
  return { writeClipboard: writeClipboardText, notify, t: (key, options) => i18n.t(key, options) };
}

/**
 * Continue the failed recording's operation. Task 6 supplies processText bound
 * to immutable route, model, settings, privacy and enterprise tag values, and
 * revalidates main authority at dispatch. An absent/superseded operation must
 * fail; importing current settings here would silently reroute old words.
 */
export async function retryDictationCleanup(rawText, deps) {
  const processText = deps?.processText;
  const { writeClipboard, notify, t } =
    deps?.notify && deps?.t && deps?.writeClipboard
      ? deps
      : { ...(await loadDefaultDeps()), ...deps };
  try {
    if (typeof processText !== "function") {
      throw Object.assign(new Error("Captured cleanup operation unavailable"), {
        messageKey: "notices.cleanupFailed.unavailable",
      });
    }
    const cleaned = await processText(rawText);
    if (typeof cleaned !== "string" || !cleaned.trim() || cleaned.trim() === rawText.trim()) {
      notify({ kind: "receipt", title: t("notices.cleanupFailed.noChanges") });
      return "unchanged";
    }
    if ((await writeClipboard(cleaned)) !== true) {
      throw Object.assign(new Error("Clipboard write failed"), {
        messageKey: "notices.wordsCard.copyFailedHint",
      });
    }
    notify({
      kind: "receipt",
      title: t("notices.cleanupFailed.cleaned"),
      body: t("notices.cleanupFailed.cleanedBody"),
    });
    return "cleaned";
  } catch (error) {
    notify({
      id: "cleanup-recovery",
      kind: "alert",
      title: t("notices.cleanupFailed.retryFailed"),
      // A sealed refusal shows translated copy, never main's English text (TR-1).
      body: error?.messageKey
        ? t(error.messageKey)
        : (sealedFailureMessage(error, t) ?? String(error?.message ?? error)),
      words: rawText,
    });
    return "failed";
  }
}
