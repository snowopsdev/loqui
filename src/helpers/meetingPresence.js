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

function createMeetingPresence({ onChange, onOwnerLost } = {}) {
  let state = null;
  let ownerId = null;
  const commit = (next, owner) => {
    ownerId = next ? owner : null;
    if (same(state, next)) return;
    state = next;
    onChange?.(state);
  };
  return {
    set(owner, input) {
      commit(normalizePresence(input), owner);
    },
    clearIfOwner(owner) {
      if (ownerId === null || ownerId !== owner || !state) return;
      const lost = state.sessionId;
      commit(null, null);
      onOwnerLost?.(lost);
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
