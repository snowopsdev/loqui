// Main owns temporary shortcuts, their accelerators and their lifetimes.
// Serial backend operations ensure an old async registration can be removed
// before another lease registers the same slot.
const PILL_HOTKEY_ACCELERATORS = Object.freeze({
  undoCancel: "Alt+Z",
  noticePrimary: "Alt+Enter",
  meetingAccept: "CommandOrControl+Alt+M",
});
const LEASE_MAX_TTL_MS = Object.freeze({
  undoCancel: 120_000,
  noticePrimary: 60_000,
  meetingAccept: 120_000,
});

function createHotkeyLeases({ hotkeyManager, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let seq = 0;
  const leases = new Map();
  const current = new Map();
  const queues = new Map();
  const backendOwners = new Map();
  const slotName = (slot) => `temp:${slot}`;
  const enqueue = (slot, operation) => {
    const next = (queues.get(slot) ?? Promise.resolve()).then(operation, operation);
    queues.set(
      slot,
      next.catch(() => {})
    );
    return next;
  };
  const unregister = async (lease) => {
    if (backendOwners.get(lease.slot) !== lease.leaseId) return;
    await hotkeyManager.unregisterSlot(slotName(lease.slot));
    backendOwners.delete(lease.slot);
  };

  function release(leaseId, ownerId, reason = "released") {
    const lease = leases.get(leaseId);
    if (!lease || (ownerId !== undefined && lease.ownerId !== ownerId)) return;
    lease.active = false;
    lease.held = false;
    clearTimer(lease.timer);
    leases.delete(leaseId);
    if (current.get(lease.slot) === leaseId) current.delete(lease.slot);
    // Queue before notifying: a release callback may acquire another lease.
    void enqueue(lease.slot, () => unregister(lease));
    try {
      lease.onRelease?.(reason);
    } catch {
      // A failed owner notification must not retain shortcut authority.
    }
  }

  async function acquire({ slot, ownerId, ttlMs, onPress, onRelease }) {
    if (!Object.hasOwn(PILL_HOTKEY_ACCELERATORS, slot)) {
      return { leaseId: 0, held: false, reason: "error" };
    }
    const previous = current.get(slot);
    const leaseId = ++seq;
    const lease = { leaseId, slot, ownerId, onRelease, active: true, held: false, timer: null };
    leases.set(leaseId, lease);
    current.set(slot, leaseId);
    const requestedTtl = Number(ttlMs);
    const ttl = Math.min(
      requestedTtl > 0 ? requestedTtl : LEASE_MAX_TTL_MS[slot],
      LEASE_MAX_TTL_MS[slot]
    );
    lease.timer = setTimer(() => release(leaseId, undefined, "ttl"), ttl);
    // Publish the new owner before notifying the old one. A notification may
    // synchronously acquire again, in which case that newer call supersedes us.
    if (previous) release(previous, undefined, "superseded");

    return enqueue(slot, async () => {
      if (!lease.active) return { leaseId, held: false, reason: "released" };
      let result;
      try {
        result = await hotkeyManager.registerSlot(
          slotName(slot),
          PILL_HOTKEY_ACCELERATORS[slot],
          () => {
            if (lease.active && lease.held) onPress();
          }
        );
      } catch {
        result = { success: false };
      }
      const held = result?.success === true;
      if (held) backendOwners.set(slot, leaseId);
      if (!lease.active) {
        // Still inside this slot's queue: remove a late registration even if a
        // newer lease is waiting. That newer lease has not registered yet.
        await unregister(lease);
        return { leaseId, held: false, reason: "released" };
      }
      lease.held = held;
      if (held) return { leaseId, held: true };
      clearTimer(lease.timer);
      leases.delete(leaseId);
      if (current.get(slot) === leaseId) current.delete(slot);
      return {
        leaseId,
        held: false,
        reason: result?.reason === "conflict" || result?.error ? "conflict" : "error",
      };
    });
  }

  function releaseOwner(ownerId) {
    for (const lease of [...leases.values()]) {
      if (lease.ownerId === ownerId) release(lease.leaseId, undefined, "owner");
    }
  }

  return {
    acquire,
    release,
    releaseOwner,
    isHeld: (leaseId) => Boolean(leases.get(leaseId)?.active && leases.get(leaseId)?.held),
  };
}

module.exports = { createHotkeyLeases, PILL_HOTKEY_ACCELERATORS, LEASE_MAX_TTL_MS };
