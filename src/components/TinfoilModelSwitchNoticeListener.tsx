import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "./ui/notices";
import { buildModelSwitchNotice } from "./voiceNotices";
import { useResolvedRoute } from "../lib/routes";
import {
  consumeTinfoilModelSwitches,
  useTinfoilModelSwitchStore,
} from "../stores/tinfoilModelSwitchStore";
import { isDictationPanelWindow } from "../utils/windowContext";

/** Alerts the user when a retired Tinfoil model was switched out from under them. */
export default function TinfoilModelSwitchNoticeListener() {
  const { t } = useTranslation();
  const cleanupRoute = useResolvedRoute("dictationCleanup");

  const switchCount = useTinfoilModelSwitchStore((s) => s.events.length);

  useEffect(() => {
    if (switchCount === 0) return;
    // The panel may already be hidden after dictation; surface it so the toast is seen.
    if (isDictationPanelWindow()) {
      window.electronAPI?.showDictationPanel?.();
    }
    for (const event of consumeTinfoilModelSwitches()) {
      notify(
        buildModelSwitchNotice(event, t, {
          openSettings: () => void window.electronAPI?.openSettingsAt?.(cleanupRoute.settingsPath),
        })
      );
    }
  }, [switchCount, t, cleanupRoute.settingsPath]);

  return null;
}
