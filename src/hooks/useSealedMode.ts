import { useSyncExternalStore } from "react";
import { getSealedSnapshot, subscribeSealed, type SealedSnapshot } from "../stores/sealedStore";

export type { SealedSnapshot };

// The React view of src/stores/sealedStore.ts (spec §5.4). It holds no state.
// getSealedSnapshot doubles as the server snapshot, so SSR renders see the store.
export function useSealedMode(): SealedSnapshot {
  return useSyncExternalStore(subscribeSealed, getSealedSnapshot, getSealedSnapshot);
}
