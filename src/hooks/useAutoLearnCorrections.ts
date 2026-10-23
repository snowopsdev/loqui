import { useCallback, useSyncExternalStore } from "react";

export const AUTO_LEARN_CHANGED_EVENT = "loqui-auto-learn-changed";
const KEY = "autoLearnCorrections";

// One persisted snapshot and one listener per renderer storage lifetime. Consumers
// never echo each other's events back to main; mount and change sync share a fence.
const stores = new WeakMap<Storage, ReturnType<typeof createStore>>();
function createStore(storage: Storage) {
  let enabled = true;
  let sent: boolean | undefined;
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      const value = storage.getItem(KEY);
      if (value === null) storage.setItem(KEY, "true");
      enabled = value !== "false";
    } catch {
      // Preserve the last readable value when storage is temporarily unavailable.
    }
    return enabled;
  };
  const syncMain = () => {
    if (sent === enabled || !window.electronAPI?.setAutoLearnEnabled) return;
    sent = enabled;
    window.electronAPI.setAutoLearnEnabled(enabled);
  };
  const changed = () => {
    read();
    syncMain();
    listeners.forEach((listener) => listener());
  };
  const onStorage = (event: StorageEvent) => {
    if (
      (event.storageArea === null || event.storageArea === storage) &&
      (event.key === null || event.key === KEY)
    ) {
      // The originating renderer already synchronized main. Receiving windows
      // only adopt persisted truth; they must not echo the same IPC write.
      read();
      sent = enabled;
      listeners.forEach((listener) => listener());
    }
  };
  return {
    read,
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        window.addEventListener(AUTO_LEARN_CHANGED_EVENT, changed);
        window.addEventListener("storage", onStorage);
      }
      listeners.add(listener);
      // Read at subscription time so an earlier consumer's newer intent wins.
      read();
      syncMain();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          window.removeEventListener(AUTO_LEARN_CHANGED_EVENT, changed);
          window.removeEventListener("storage", onStorage);
        }
      };
    },
    set(next: boolean) {
      if (read() === next) return;
      try {
        storage.setItem(KEY, String(next));
      } catch {
        return;
      }
      changed();
      window.dispatchEvent?.(new CustomEvent(AUTO_LEARN_CHANGED_EVENT, { detail: next }));
    },
  };
}

export function useAutoLearnCorrections(): readonly [boolean, (enabled: boolean) => void] {
  let store = stores.get(localStorage);
  if (!store) {
    store = createStore(localStorage);
    stores.set(localStorage, store);
  }
  const enabled = useSyncExternalStore(store.subscribe, store.read, store.read);
  const setEnabled = useCallback((next: boolean) => store.set(next), [store]);
  return [enabled, setEnabled] as const;
}
