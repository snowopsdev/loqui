import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectResolvedNoteFormatting, useSettingsStore } from "../stores/settingsStore";
import { noteActionsReadiness } from "../utils/noteActionsReadiness";
import { LOCAL_MODELS_CHANGED_EVENT } from "./useModelDownload";

/** Temporary local/self-hosted readiness. Plan 06 replaces this with
 * useResolvedRoute("noteFormatting"); remote readiness remains unknown (§5.1). */
export function useNoteActionsReady(): boolean | null {
  const config = useSettingsStore(
    useShallow((state) => {
      const resolved = selectResolvedNoteFormatting(state);
      return { mode: resolved.mode, model: resolved.model, remoteUrl: resolved.remoteUrl };
    })
  );
  const [downloaded, setDownloaded] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (config.mode !== "local") return undefined;
    let cancelled = false;
    const refresh = () => {
      void window.electronAPI
        ?.modelGetAll?.()
        .then((models) => {
          if (cancelled || !Array.isArray(models)) return;
          setDownloaded(new Set(models.filter((m) => m.isDownloaded).map((m) => m.id)));
        })
        .catch(() => {
          if (!cancelled) setDownloaded(null);
        });
    };
    refresh();
    // A download finishing elsewhere (Settings, onboarding) makes the model ready.
    window.addEventListener(LOCAL_MODELS_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(LOCAL_MODELS_CHANGED_EVENT, refresh);
    };
  }, [config.mode, config.model]);

  return noteActionsReadiness(config, downloaded);
}
