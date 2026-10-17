import { useCallback, useState } from "react";
import { useMeetingRecordingStore } from "../stores/meetingRecordingStore";
import { nextSidebarPreference, resolveSidebarMode, type SidebarMode } from "../lib/sidebarMode";

const STORAGE_KEY = "sidebarCollapsed";

export function useCollapsibleSidebar(sidePanelLayout: boolean): {
  mode: SidebarMode;
  toggle: () => void;
} {
  const windowWidth = useMeetingRecordingStore((s) => s.windowWidth);
  const [pref, setPref] = useState(() => ({
    userCollapsed: localStorage.getItem(STORAGE_KEY) === "true",
    narrowExpanded: false,
  }));
  const mode = resolveSidebarMode({ ...pref, windowWidth, sidePanelLayout });
  const toggle = useCallback(() => {
    setPref((current) => {
      const next = nextSidebarPreference({ ...current, windowWidth });
      localStorage.setItem(STORAGE_KEY, String(next.userCollapsed));
      return next;
    });
  }, [windowWidth]);
  return { mode, toggle };
}
