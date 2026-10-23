import { isSealedModeError } from "../utils/sealedModeError";
import type { captureDictationSession, createSessionContext } from "../helpers/dictationSession";
import type { createDisclosureTracker } from "../helpers/dictationDisclosure";

// Plan 04's own factory shapes (A9): the held operation keeps the exact
// objects those factories produced, opaque enterprise recipient tags included.
export type DictationSession = ReturnType<typeof captureDictationSession>;
export type SessionContext = ReturnType<typeof createSessionContext>;
export type DisclosureTracker = ReturnType<typeof createDisclosureTracker>;

export type HeldRecoveryOperation = Readonly<{
  owned: Readonly<{
    blob: Blob;
    sessionId: string;
    private: boolean;
    metadata: Readonly<Record<string, unknown>> | null;
  }>;
  session: DictationSession;
  // The detached Plan 04 operation, moved together (A10): the press-time reads
  // and the disclosure tracker stay with this recording until a terminal close.
  context: SessionContext | null;
  tracker: DisclosureTracker | null;
}>;

// Dictations that Sealed mode refused or interrupted, and whose audio no saver
// acknowledged keeping. Renderer memory only: never written to disk, gone on
// quit or reload, dropped after RECOVERY_TTL_MS, and bounded so a long sealed
// session cannot grow without limit.
export const RECOVERY_TTL_MS = 30 * 60 * 1000;
export const RECOVERY_MAX = 3;

type Held = {
  id: number;
  operation: HeldRecoveryOperation;
  heldAt: number;
  claimed: boolean;
  closed: boolean;
  // Its 30 minutes ran out while a replay had it claimed: it closes as soon
  // as that replay hands it back unfinished (fix round 1, M2).
  expiredWhileClaimed: boolean;
};
let held: Held[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
// One expiry timer per hold, keyed by hold id. Every terminal end clears its
// own, so no timer outlives the audio it guards.
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const notify = () => {
  for (const listener of [...listeners]) listener();
};

function clearExpiryTimer(id: number) {
  const timer = timers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
}

// Every terminal end closes the press-time reads and the tracker exactly once,
// and drops the entry's timer. The entry itself (and with it the only
// reference to the audio Blob) has already left `held`.
function close(entry: Held) {
  clearExpiryTimer(entry.id);
  if (entry.closed) return;
  entry.closed = true;
  try {
    entry.operation.context?.release();
  } finally {
    entry.operation.tracker?.dispose?.();
  }
}

// The "up to 30 minutes" promise is kept by this timer, not only by the next
// recovery call (fix round 1, M2). Unref'd so it never keeps a process alive.
function armExpiry(entry: Held) {
  const timer = setTimeout(() => {
    timers.delete(entry.id);
    if (!held.includes(entry)) return;
    if (entry.claimed) {
      entry.expiredWhileClaimed = true;
      return;
    }
    held = held.filter((h) => h !== entry);
    close(entry);
    notify();
  }, RECOVERY_TTL_MS);
  (timer as { unref?: () => void }).unref?.();
  timers.set(entry.id, timer);
}

function expire(now: number) {
  // A claimed operation remains owned during replay and never expires under it.
  const expired = held.filter((h) => !h.claimed && now - h.heldAt > RECOVERY_TTL_MS);
  if (!expired.length) return;
  held = held.filter((h) => !expired.includes(h));
  for (const entry of expired) close(entry);
  notify();
}

// Private takes are never persisted, so they are always held. Otherwise only
// a saver's `audioKept === true` acknowledgement is a recovery (A10).
export function shouldHoldInMemory(
  error: unknown,
  { audioKept = false, privateTake = false }: { audioKept?: boolean; privateTake?: boolean } = {}
): boolean {
  return isSealedModeError(error) && (privateTake || audioKept !== true);
}

// Over the bound, the oldest unclaimed hold goes; a claimed one is never
// dropped. The brief specifies eviction (it closes the context once), and the
// newest recording is the one the user just spoke, so it is the one kept.
// `evicted` lets the caller say so in the same notice (fix round 1, M2).
export function holdForRecoveryWithEvictions(
  operation: HeldRecoveryOperation,
  now = Date.now()
): { id: number; evicted: number } {
  expire(now);
  const id = nextId++;
  const entry: Held = {
    id,
    operation,
    heldAt: now,
    claimed: false,
    closed: false,
    expiredWhileClaimed: false,
  };
  held = [...held, entry];
  armExpiry(entry);
  let evicted = 0;
  while (held.length > RECOVERY_MAX) {
    const victim = held.findIndex((h) => !h.claimed && h.id !== id);
    if (victim === -1) break;
    close(held.splice(victim, 1)[0]);
    evicted++;
  }
  notify();
  return { id, evicted };
}

export function holdForRecovery(operation: HeldRecoveryOperation, now = Date.now()): number {
  return holdForRecoveryWithEvictions(operation, now).id;
}

export function recoveryCount(now = Date.now()): number {
  expire(now);
  return held.length;
}

// Replays claim a hold instead of taking it, so the only copy survives a
// failed, cancelled or empty replay. One claim at a time.
export function claimRecovery(
  now = Date.now()
): { id: number; operation: HeldRecoveryOperation; heldAt: number } | null {
  expire(now);
  if (held.some((h) => h.claimed)) return null;
  const first = held.find((h) => !h.claimed);
  if (!first) return null;
  first.claimed = true;
  notify();
  return { id: first.id, operation: first.operation, heldAt: first.heldAt };
}

// done: the replay produced a transcript; terminally close once. Otherwise the
// replay must already have returned the same session/context to this entry.
export function releaseRecovery(id: number, { done }: { done: boolean }): void {
  const entry = held.find((h) => h.id === id);
  if (!entry) return;
  if (done || entry.expiredWhileClaimed) {
    held = held.filter((h) => h.id !== id);
    close(entry);
  } else entry.claimed = false;
  notify();
}

// Closes every unclaimed hold; a hold being replayed stays with its replay.
export function discardRecovery(): void {
  const dropped = held.filter((h) => !h.claimed);
  if (!dropped.length) return;
  held = held.filter((h) => h.claimed);
  for (const entry of dropped) close(entry);
  notify();
}

export function subscribeRecovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Tests only: how many expiry timers are pending, so a test can prove none leak.
export function _recoveryTimersForTests(): number {
  return timers.size;
}
