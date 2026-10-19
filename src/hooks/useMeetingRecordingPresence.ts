import { useSyncExternalStore } from "react";
import type { MeetingPresence } from "../types/dictation";

// Loading is private: the public presence remains exactly MeetingPresence | null.
// Both hooks share one subscription so an early notification reveal survives the
// initial unknown null, but an authoritative end/replacement retires it forever.
type Snapshot = {
  presence: MeetingPresence | null;
  known: boolean;
  revealedSessionId: string | null;
};
const unknown: Snapshot = { presence: null, known: false, revealedSessionId: null };
let snapshot = unknown;
const listeners = new Set<() => void>();
let dispose: (() => void) | undefined;
const publish = (next: Snapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!dispose) {
    let alive = true;
    let revision = 0;
    const accept = (presence: MeetingPresence | null) =>
      publish({
        presence,
        known: true,
        revealedSessionId: isMeetingRecorderRevealed(snapshot.revealedSessionId, presence)
          ? snapshot.revealedSessionId
          : null,
      });
    const api = window.electronAPI;
    // Subscribe before the getter. Events after this point outrank its reply.
    const offPresence = api?.onMeetingRecordingPresenceChanged?.((presence) => {
      if (!alive) return;
      revision++;
      accept(presence ?? null);
    });
    const offReveal = api?.onMeetingRecorderRevealRequested?.((sessionId) => {
      if (!alive) return;
      if (snapshot.known && !isMeetingRecorderRevealed(sessionId, snapshot.presence)) return;
      publish({ ...snapshot, revealedSessionId: sessionId });
    });
    const readRevision = revision;
    void api
      ?.getMeetingRecordingPresence?.()
      .then((presence) => {
        if (alive && revision === readRevision) accept(presence ?? null);
      })
      .catch(() => {
        // A failed read is not authoritative absence. The next event can settle it.
      });
    dispose = () => {
      alive = false;
      offPresence?.();
      offReveal?.();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    dispose?.();
    dispose = undefined;
    snapshot = unknown;
  };
};
const getSnapshot = () => snapshot;
const getServerSnapshot = () => unknown;

export function useMeetingRecordingPresence(): MeetingPresence | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).presence;
}

export function isMeetingRecorderRevealed(
  revealedSessionId: string | null,
  presence: MeetingPresence | null
): boolean {
  return Boolean(presence && revealedSessionId && presence.sessionId === revealedSessionId);
}

/** A notification click reveals only its live session, until its authoritative end. */
export function useMeetingRecorderRevealed(presence: MeetingPresence | null): boolean {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isMeetingRecorderRevealed(state.revealedSessionId, presence);
}
