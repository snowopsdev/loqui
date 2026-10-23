import { create } from "zustand";
import type { Attestation } from "../types/privacy";

// The one renderer authority for Sealed mode (spec §5.4). Plan 03 created this
// module and its shared API (useSealedStore, getSealed, ensureSealedSubscribed);
// Plan 07 owns the internals: main's attestation, staleness and versioned
// reads. Route hooks, the imperative route snapshot, the Apply bar, the
// Keyring, the dictation pre-flight and recovery all read this module, and no
// other renderer module reads sealed state from the privacy bridge.
// `known` is false until main has answered. Main enforces the seal either way.

export const useSealedStore = create<{ sealed: boolean; known: boolean }>()(() => ({
  sealed: false,
  known: false,
}));

// Route snapshots read this: unknown is false, because main enforces the seal anyway.
export function getSealed(): boolean {
  return useSealedStore.getState().sealed === true;
}

// Anything that makes a claim reads this: unknown is null, and claims nothing.
export type SealedSnapshot = { sealed: boolean | null; attestation: Attestation | null };

// Main re-broadcasts whenever the attestation changes; this bounds how old a
// claim on screen can be if a broadcast is lost. Measured from main's `at`.
export const ATTESTATION_MAX_AGE_MS = 30_000;

let attestation: Attestation | null = null;
// The newest version ever adopted or seen. It survives expiry and failed
// reads, so a late reply older than a claim already dropped never comes back.
let highestVersion = -1;
let snapshot: SealedSnapshot = Object.freeze({ sealed: null, attestation: null });
const listeners = new Set<() => void>();
let subscribed = false;
// Bumped by every seal event and by setSealedMode. The first fetch applies
// only if nothing newer arrived after it started (Plan 03).
let eventVersion = 0;
// Bumped by every attestation adoption or invalidation, so an in-flight read
// that fails cannot erase something newer than its own start.
let attestationEpoch = 0;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
let windowCleanup: (() => void) | null = null;

// One frozen object per change, so useSyncExternalStore sees a stable value.
function publish() {
  const { sealed, known } = useSealedStore.getState();
  const nextSealed = known ? sealed === true : null;
  if (nextSealed === snapshot.sealed && attestation === snapshot.attestation) return;
  snapshot = Object.freeze({ sealed: nextSealed, attestation });
  for (const listener of [...listeners]) listener();
}
useSealedStore.subscribe(publish);

const privacyApi = () => (typeof window === "undefined" ? undefined : window.electronAPI?.privacy);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// A claim is shown only while main's own timestamp is at most 30 s old. A
// timestamp further in the future than that cannot be trusted either.
export function isAttestationFresh(a: Attestation | null, now = Date.now()): boolean {
  if (!a || !isFiniteNumber(a.at) || !isFiniteNumber(now)) return false;
  const age = now - a.at;
  return age <= ATTESTATION_MAX_AGE_MS && -age <= ATTESTATION_MAX_AGE_MS;
}

function clearTimer() {
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = null;
}

function setAttestation(next: Attestation | null) {
  attestation = next;
  attestationEpoch += 1;
  publish();
}

function refetchAttestation() {
  const api = privacyApi();
  if (typeof api?.getAttestation !== "function") return;
  const epochAtStart = attestationEpoch;
  let read: Promise<Attestation>;
  try {
    read = Promise.resolve(api.getAttestation());
  } catch {
    if (attestationEpoch === epochAtStart) setAttestation(null);
    return;
  }
  read.then(
    (next) => adopt(next, epochAtStart),
    () => {
      // A failed read cannot vouch for anything, but it must not erase a
      // newer push that arrived while it was in flight.
      if (attestationEpoch === epochAtStart && attestation) {
        clearTimer();
        setAttestation(null);
      }
    }
  );
}

function expireNow() {
  clearTimer();
  if (attestation) setAttestation(null);
  refetchAttestation();
}

// Main versions every attestation. An older one (a late IPC reply) never
// wins, even after the newer one expired. A claim lives until main's `at`
// + 30 s and no longer: the timer gets only the remaining lifetime. A reply
// without a finite version and timestamp is not evidence of anything.
function adopt(next: unknown, epochAtStart: number | null = null) {
  const candidate = next as Attestation | null;
  if (!candidate || typeof candidate !== "object") {
    if (epochAtStart === null || attestationEpoch === epochAtStart) {
      clearTimer();
      if (attestation) setAttestation(null);
    }
    return;
  }
  if (!isFiniteNumber(candidate.version) || !isFiniteNumber(candidate.at)) {
    if (epochAtStart === null || attestationEpoch === epochAtStart) {
      clearTimer();
      if (attestation) setAttestation(null);
    }
    return;
  }
  if (candidate.version < highestVersion) return;
  highestVersion = candidate.version;
  clearTimer();
  const now = Date.now();
  if (!isAttestationFresh(candidate, now)) {
    // Stale on arrival: unknown, and ask main again. The watermark stays.
    if (attestation) setAttestation(null);
    else attestationEpoch += 1;
    if (epochAtStart === null) refetchAttestation();
    return;
  }
  setAttestation(candidate);
  const remaining = Math.min(candidate.at + ATTESTATION_MAX_AGE_MS - now, ATTESTATION_MAX_AGE_MS);
  staleTimer = setTimeout(expireNow, Math.max(0, remaining) + 1);
  (staleTimer as { unref?: () => void }).unref?.();
}

// Timers are throttled in a hidden window and paused across sleep, so age is
// rechecked whenever the window comes back, not only when the timer fires.
function recheckFreshness() {
  if (attestation && !isAttestationFresh(attestation)) expireNow();
}

export function ensureSealedSubscribed(): void {
  if (subscribed || typeof window === "undefined") return;
  subscribed = true;
  const privacy = privacyApi();
  if (!privacy?.getSealed && !privacy?.onSealedChange) {
    // This build has no sealed mode, so nothing can be sealed.
    useSealedStore.setState({ sealed: false, known: true });
    return;
  }
  privacy.onSealedChange?.((sealed) => {
    eventVersion += 1;
    useSealedStore.setState({ sealed: sealed === true, known: true });
  });
  privacy.onAttestation?.((next) => adopt(next));
  const target = window as Window & typeof globalThis;
  if (typeof target.addEventListener === "function") {
    target.addEventListener("focus", recheckFreshness);
    target.document?.addEventListener?.("visibilitychange", recheckFreshness);
    windowCleanup = () => {
      target.removeEventListener?.("focus", recheckFreshness);
      target.document?.removeEventListener?.("visibilitychange", recheckFreshness);
    };
  }
  const startedAt = eventVersion;
  Promise.resolve()
    .then(() => privacy.getSealed?.())
    .then(
      (sealed) => {
        if (typeof sealed !== "boolean" || eventVersion !== startedAt) return;
        useSealedStore.setState({ sealed, known: true });
      },
      () => {
        // Unknown stays unknown (main fails closed); the next event settles it.
      }
    );
  refetchAttestation();
}

// Subscribing starts the store; reading the snapshot never does (A12): the
// imperative readers stay free of IPC and side effects.
export function subscribeSealed(listener: () => void): () => void {
  ensureSealedSubscribed();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Stable and side-effect free. Expiry is enforced by the timer, by focus and
// visibility rechecks, and by consumers calling isAttestationFresh on render.
export const getSealedSnapshot = (): SealedSnapshot => snapshot;

// Main resolves after its sealing barrier, or with declined: true when the
// user kept the seal in main's own dialog. Either way, its answer is adopted.
export async function setSealedMode(
  sealed: boolean
): Promise<Attestation & { declined?: boolean }> {
  const api = privacyApi();
  if (typeof api?.setSealed !== "function") throw new Error("Sealed mode is unavailable");
  const result = await api.setSealed(sealed);
  if (typeof result?.sealed === "boolean") {
    eventVersion += 1;
    useSealedStore.setState({ sealed: result.sealed === true, known: true });
  }
  adopt(result);
  return result;
}

export function _resetSealedStoreForTests(): void {
  listeners.clear();
  subscribed = false;
  eventVersion = 0;
  attestationEpoch = 0;
  attestation = null;
  highestVersion = -1;
  clearTimer();
  windowCleanup?.();
  windowCleanup = null;
  useSealedStore.setState({ sealed: false, known: false });
  snapshot = Object.freeze({ sealed: null, attestation: null });
}
