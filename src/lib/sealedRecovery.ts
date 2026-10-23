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
};
let held: Held[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of [...listeners]) listener();
};

// Every terminal end closes the press-time reads and the tracker exactly once.
function close(entry: Held) {
  if (entry.closed) return;
  entry.closed = true;
  try {
    entry.operation.context?.release();
  } finally {
    entry.operation.tracker?.dispose?.();
  }
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

export function holdForRecovery(operation: HeldRecoveryOperation, now = Date.now()): number {
  expire(now);
  const id = nextId++;
  held = [...held, { id, operation, heldAt: now, claimed: false, closed: false }];
  // Over the bound, the oldest unclaimed hold goes; a claimed one is never dropped.
  while (held.length > RECOVERY_MAX) {
    const victim = held.findIndex((h) => !h.claimed && h.id !== id);
    if (victim === -1) break;
    close(held.splice(victim, 1)[0]);
  }
  notify();
  return id;
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
  if (done) {
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
