import { useEffect, useState } from "react";
import logger from "../utils/logger";

interface HyprlandConfigStatus {
  canWrite: boolean;
  path: string;
}

export interface HotkeyModeInfo {
  isUsingNativeShortcut: boolean;
  isUsingHyprland: boolean;
  supportsPushToTalk: boolean;
  pushToTalkUnavailableReason: string | null;
  hyprlandConfigStatus: HyprlandConfigStatus | null;
  /** False until main has answered; the defaults above are optimistic placeholders. */
  loaded: boolean;
}

const DEFAULT_INFO: HotkeyModeInfo = {
  isUsingNativeShortcut: false,
  isUsingHyprland: false,
  supportsPushToTalk: true,
  pushToTalkUnavailableReason: null,
  hyprlandConfigStatus: null,
  loaded: false,
};

/**
 * Resolves how the dictation hotkey is registered for the current session
 * (native shortcut, Hyprland) and, on Hyprland, whether its config is
 * persistable. `scope` tags log output for the calling surface.
 */
export function useHotkeyModeInfo(scope: string, hotkey?: string): HotkeyModeInfo {
  const [result, setResult] = useState<{
    scope: string;
    hotkey: string | undefined;
    info: HotkeyModeInfo;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    const checkHotkeyMode = async () => {
      try {
        const info = await window.electronAPI?.getHotkeyModeInfo?.(hotkey);
        if (!info || cancelled) return;
        const hyprlandConfigStatus = info.isUsingHyprland
          ? ((await window.electronAPI?.getHyprlandConfigStatus?.()) ?? null)
          : null;
        if (cancelled) return;
        setResult({
          scope,
          hotkey,
          info: {
            isUsingNativeShortcut: info.isUsingNativeShortcut,
            isUsingHyprland: info.isUsingHyprland,
            supportsPushToTalk: info.supportsPushToTalk === true,
            pushToTalkUnavailableReason: info.pushToTalkUnavailableReason,
            hyprlandConfigStatus,
            loaded: true,
          },
        });
      } catch (error) {
        logger.error("Failed to check hotkey mode", { error }, scope);
      }
    };
    checkHotkeyMode();
    return () => {
      cancelled = true;
    };
  }, [scope, hotkey]);

  // Mask old-key data during render, before the new query effect can run.
  return result?.scope === scope && result.hotkey === hotkey ? result.info : DEFAULT_INFO;
}
