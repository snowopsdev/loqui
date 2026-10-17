import { useEffect, useRef, useState } from "react";

export type PillHotkeySlot = "undoCancel" | "noticePrimary";

/** Show a shortcut only while main reports its temporary lease is held. */
export function usePillHotkey(
  slot: PillHotkeySlot,
  enabled: boolean,
  onPress: () => void,
  options: { ttlMs?: number } = {}
): { held: boolean } {
  const ttlMs = options.ttlMs;
  const [authority, setAuthority] = useState({ slot, ttlMs, held: false });
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    if (!enabled) return;
    const api = window.electronAPI;
    let leaseId = 0;
    let live = false;
    let disposed = false;
    const releasedBeforeReply = new Set<number>();
    const setHeld = (held: boolean) => setAuthority({ slot, ttlMs, held });
    // Cleanup and late replies are best-effort during renderer teardown; main
    // independently enforces owner loss and TTL even if IPC is unavailable.
    const release = (id: number) => {
      if (id) void api?.releasePillHotkey?.(id).catch(() => {});
    };
    const off = api?.onPillHotkeyPressed?.((press) => {
      if (!disposed && live && leaseId && press.slot === slot && press.leaseId === leaseId) {
        onPressRef.current();
      }
    });
    const offReleased = api?.onPillHotkeyReleased?.((released) => {
      if (disposed || released.slot !== slot || !released.leaseId) return;
      if (!leaseId) releasedBeforeReply.add(released.leaseId);
      if (released.leaseId === leaseId) {
        live = false;
        setHeld(false);
      }
    });
    void api
      ?.acquirePillHotkey?.(slot, { ttlMs })
      .then((result) => {
        if (disposed) {
          release(result.leaseId);
          return;
        }
        leaseId = result.leaseId;
        live = Boolean(leaseId && result.held && !releasedBeforeReply.has(leaseId));
        releasedBeforeReply.clear();
        setHeld(live);
      })
      .catch(() => {
        if (!disposed) setHeld(false);
      });
    return () => {
      disposed = true;
      live = false;
      off?.();
      offReleased?.();
      setHeld(false);
      release(leaseId);
    };
  }, [slot, enabled, ttlMs]);

  return {
    held: enabled && authority.slot === slot && authority.ttlMs === ttlMs && authority.held,
  };
}
