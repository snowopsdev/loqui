import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { landOnSetting } from "./settingFlash";
import { isSearchShortcut, isTypingTarget, stepActiveIndex } from "./settingsSearchKeys";
import {
  anchorIdFor,
  searchSettings,
  type SearchGroup,
  type SettingEntry,
} from "./settingsRegistry";

export interface SettingsSearch {
  query: string;
  setQuery(next: string): void;
  clear(): void;
  groups: SearchGroup[];
  activeId: string | null;
  activate(id: string): void;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void;
  jump(entry: SettingEntry): void;
  /** Escape handler for the field and the results pane: clears a non-empty query and reports it consumed the key. */
  consumeEscape(): boolean;
}

export function useSettingsSearch({
  open,
  navigateToPath,
  land = landOnSetting,
}: {
  open: boolean;
  navigateToPath: (path: string) => void;
  land?: typeof landOnSetting;
}): SettingsSearch {
  const { t } = useTranslation();
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingAnchor, setPendingAnchor] = useState<{
    id: string;
    request: number;
    fallbackAnchorId?: string;
  } | null>(null);
  const request = useRef(0);
  const cancelLanding = useRef<(() => void) | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => searchSettings(query, (key) => t(key)), [query, t]);
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const activeEntry = flat[Math.min(activeIndex, flat.length - 1)];
  const activeId = activeEntry?.id ?? null;

  const setQuery = useCallback((next: string) => {
    if (next) {
      // Retire the cue before search hides the page; interrupted animations may never end.
      cancelLanding.current?.();
      cancelLanding.current = undefined;
      setPendingAnchor(null);
    }
    setQueryState(next);
    setActiveIndex(0);
  }, []);
  const clear = useCallback(() => {
    cancelLanding.current?.();
    setPendingAnchor(null);
    setQuery("");
  }, [setQuery]);

  const jump = useCallback(
    (entry: SettingEntry) => {
      cancelLanding.current?.();
      setQuery("");
      navigateToPath(entry.path);
      setPendingAnchor({
        id: anchorIdFor(entry),
        request: ++request.current,
        fallbackAnchorId: entry.fallbackAnchorId,
      });
    },
    [navigateToPath, setQuery]
  );

  // After a jump the target mounts a frame or two later (section and sub-tab switches).
  useEffect(() => {
    if (!open || !pendingAnchor) return;
    const cancel = land(pendingAnchor.id, {
      root: document,
      fallbackAnchorId: pendingAnchor.fallbackAnchorId,
      raf: (cb) => requestAnimationFrame(cb),
      caf: (handle) => cancelAnimationFrame(handle),
    });
    cancelLanding.current = cancel;
    return () => {
      cancel();
      if (cancelLanding.current === cancel) cancelLanding.current = undefined;
    };
  }, [pendingAnchor, open, land]);

  useEffect(() => {
    if (!open) clear();
  }, [open, clear]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const capturing = !!document.querySelector("[data-capturing]");
      if (!isSearchShortcut(e, { typing: isTypingTarget(e.target), capturing })) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onSearchKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => stepActiveIndex(i, flat.length, e.key));
      } else if (e.key === "Enter" && activeEntry) {
        e.preventDefault();
        jump(activeEntry);
      }
    },
    [flat.length, activeEntry, jump]
  );

  const activate = useCallback(
    (id: string) => {
      const index = flat.findIndex((entry) => entry.id === id);
      if (index >= 0) setActiveIndex(index);
    },
    [flat]
  );

  const consumeEscape = useCallback(() => {
    if (!query) return false;
    clear();
    return true;
  }, [query, clear]);

  return {
    query,
    setQuery,
    clear,
    groups,
    activeId,
    activate,
    searchRef,
    onSearchKeyDown,
    jump,
    consumeEscape,
  };
}
