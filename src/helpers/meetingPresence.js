// D2: the pill window is the ambient meeting recorder. Presence is liveness
// only; whether a meeting was saved is a separate, explicit outcome
// (meeting-recording-outcome). Owner loss is reported as a failure.
const INTERRUPTIONS = new Set(["systemAudio", "mic"]);

function normalizePresence(input) {
  if (!input || input.recording !== true) return null;
  const startedAt = input.startedAt;
  const sessionId =
    typeof input.sessionId === "string" && input.sessionId.length <= 128 ? input.sessionId : null;
  if (!sessionId || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  return {
    sessionId,
    startedAt,
    interruption: INTERRUPTIONS.has(input.interruption) ? input.interruption : null,
    quiet: Boolean(input.quiet),
  };
}

const same = (a, b) =>
  a === b ||
  (a &&
    b &&
    a.sessionId === b.sessionId &&
    a.startedAt === b.startedAt &&
    a.interruption === b.interruption &&
    a.quiet === b.quiet);

// Liveness ends before asynchronous persistence/Stop acknowledgements. Keep
// only unfinished terminal results, privately, keyed by session and exact owner.
function normalizeOutcome(input) {
  const sessionId = input?.sessionId;
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 128) return null;
  if (input.kind === "saved") {
    if (
      !Number.isFinite(input.durationMs) ||
      input.durationMs < 0 ||
      !(input.noteId === null || typeof input.noteId === "string")
    )
      return null;
    return { sessionId, kind: "saved", durationMs: input.durationMs, noteId: input.noteId };
  }
  if (input.kind === "failed" && ["save", "stop", "ownerLost"].includes(input.reason)) {
    return { sessionId, kind: "failed", reason: input.reason };
  }
  return null;
}

function createMeetingPresence({ onChange, onOwnerLost } = {}) {
  let state = null;
  let liveOwner = null;
  const pendingResults = new Map();
  const commit = (next, owner) => {
    liveOwner = next ? owner : null;
    if (same(state, next)) return;
    state = next;
    onChange?.(state);
  };
  return {
    set(owner, input) {
      const next = normalizePresence(input);
      if (next) {
        const pendingOwner = pendingResults.get(next.sessionId);
        if (pendingResults.has(next.sessionId) && pendingOwner !== owner) return;
        // A repeated live update after an early outcome cannot reopen the same
        // current session's result. A new session acquires independent ownership.
        if (state?.sessionId !== next.sessionId || liveOwner !== owner) {
          pendingResults.set(next.sessionId, owner);
        }
        commit(next, owner);
      } else if (
        liveOwner === owner &&
        (!input?.sessionId || input.sessionId === state?.sessionId)
      ) {
        commit(null, null);
      }
    },
    settleOutcome(owner, input) {
      const outcome = normalizeOutcome(input);
      if (
        !outcome ||
        !pendingResults.has(outcome.sessionId) ||
        pendingResults.get(outcome.sessionId) !== owner
      )
        return null;
      pendingResults.delete(outcome.sessionId);
      return outcome;
    },
    clearIfOwner(owner) {
      const lost = [];
      for (const [sessionId, pendingOwner] of pendingResults) {
        if (pendingOwner !== owner) continue;
        pendingResults.delete(sessionId);
        lost.push(sessionId);
      }
      if (liveOwner === owner) commit(null, null);
      // Retire every record before callbacks, so reentrancy/duplicates cannot
      // settle it twice or touch a replacement acquired during delivery.
      for (const sessionId of lost) onOwnerLost?.(sessionId);
    },
    get: () => state,
  };
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function buildTrayRecordingItems(presence, { t, now = Date.now() }) {
  if (!presence) return [];
  const first =
    presence.interruption === "systemAudio"
      ? t("tray.meetingRecordingSystemLost")
      : presence.interruption === "mic"
        ? t("tray.meetingRecordingMicLost")
        : t("tray.meetingRecording", { elapsed: formatElapsed(now - presence.startedAt) });
  return [
    { label: first, enabled: false },
    { label: t("tray.stopMeetingRecording"), action: "stop" },
  ];
}

module.exports = {
  normalizePresence,
  createMeetingPresence,
  buildTrayRecordingItems,
  formatElapsed,
};
