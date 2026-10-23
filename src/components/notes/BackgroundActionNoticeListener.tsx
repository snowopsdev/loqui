import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "../ui/notices";
import { sealedFailureMessage } from "../../utils/sealedModeError";
import { useActionProcessingStore, consumeErrorEvents } from "../../stores/actionProcessingStore";

/**
 * Headless. Mount once so background-action errors
 * surface even after the user navigates away from the notes view.
 */
export default function BackgroundActionNoticeListener() {
  const { t } = useTranslation();

  const errorCount = useActionProcessingStore((s) => s.errorEvents.length);

  useEffect(() => {
    if (errorCount === 0) return;
    for (const event of consumeErrorEvents()) {
      notify({
        title: t("notes.enhance.title"),
        body: event.messageKey
          ? t(event.messageKey, event.messageParams)
          : (sealedFailureMessage({ error: event.message }, t) ?? event.message),
        kind: "alert",
      });
    }
  }, [errorCount, t]);

  return null;
}
