import { create } from "zustand";

// The one renderer authority for sealed mode (spec §5.4). Route hooks, the
// imperative route snapshot, the Apply bar and the Keyring all read this
// store and nothing else; no other renderer module calls privacy.getSealed or
// privacy.onSealedChange (Task 18 guards it). Keep the internals small and
// swappable: Plan 07 (its Task 13) replaces them (attestation, staleness,
// fail-closed reads), adds getSealedSnapshot() and subscribeSealed(cb) to this
// same module, and keeps useSealedStore/getSealed/ensureSealedSubscribed exactly.
// `known` is false until main has answered. Route snapshots map unknown
// (known: false) to sealed = false, because main enforces the seal either way.

export const useSealedStore = create<{ sealed: boolean; known: boolean }>()(() => ({
  sealed: false,
  known: false,
}));

export function getSealed(): boolean {
  return useSealedStore.getState().sealed;
}

let subscribed = false;
// Bumped by every seal event. The first fetch applies only if no event
// arrived after it started, so a slow fetch can never undo a newer event.
let eventVersion = 0;

export function ensureSealedSubscribed(): void {
  if (subscribed || typeof window === "undefined") return;
  subscribed = true;
  const privacy = window.electronAPI?.privacy;
  if (!privacy?.getSealed && !privacy?.onSealedChange) {
    // This build has no sealed mode, so nothing can be sealed.
    useSealedStore.setState({ sealed: false, known: true });
    return;
  }
  privacy.onSealedChange?.((sealed) => {
    eventVersion += 1;
    useSealedStore.setState({ sealed: sealed === true, known: true });
  });
  const startedAt = eventVersion;
  Promise.resolve()
    .then(() => privacy.getSealed?.())
    .then(
      (sealed) => {
        if (typeof sealed !== "boolean" || eventVersion !== startedAt) return;
        useSealedStore.setState({ sealed, known: true });
      },
      () => {
        // Unknown stays unknown; the next event settles it.
      }
    );
}
