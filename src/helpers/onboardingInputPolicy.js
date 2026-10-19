const ONBOARDING_DEMO_KINDS = new Set(["dictation", "assistant", "shortcut"]);
const ONBOARDING_DEMO_STATUSES = new Set([
  "listening",
  "level",
  "processing",
  "partial",
  "replying",
  "success",
  "error",
  "cancelled",
  "cancelClosed",
]);
const DEMO_CLEANUP_OUTCOMES = new Set(["applied", "skipped", "failed"]);

// A "shortcut" demo never equals a recording input kind, so while it runs the
// shortcut's presses are mirrored to setup (shouldReportDictationHotkey) but
// never start a dictation.
function isOnboardingInputAllowed(onboardingActive, demoKind, inputKind) {
  if (!onboardingActive) return true;
  return ONBOARDING_DEMO_KINDS.has(demoKind) && demoKind === inputKind;
}

function shouldReportDictationHotkey(onboardingActive, demoKind) {
  return onboardingActive === true && (demoKind === "dictation" || demoKind === "shortcut");
}

const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);

// The overlay publishes; every window receives. Only allowlisted fields of the
// current session's kind pass, and the id always comes from main's session.
function sanitizeOnboardingDemoEvent(event, session) {
  if (!session || !event || event.kind !== session.kind) return null;
  if (!ONBOARDING_DEMO_STATUSES.has(event.status)) return null;
  return {
    demoId: session.id,
    ...(typeof event.takeId === "string" ? { takeId: clip(event.takeId, 128) } : {}),
    kind: session.kind,
    status: event.status,
    text: clip(event.text, 20000),
    rawText: clip(event.rawText, 20000),
    ...(typeof event.context === "string" ? { context: clip(event.context, 4096) } : {}),
    ...(typeof event.cleanupCode === "string" ? { cleanupCode: clip(event.cleanupCode, 64) } : {}),
    ...(session.origin ? { origin: session.origin } : {}),
    ...(session.binding ? { binding: { ...session.binding } } : {}),
    message: clip(event.message, 500),
    code: clip(event.code, 64),
    tool: clip(event.tool, 64),
    level: Number.isFinite(event.level) ? Math.min(1, Math.max(0, event.level)) : undefined,
    cleanup: DEMO_CLEANUP_OUTCOMES.has(event.cleanup) ? event.cleanup : undefined,
    // Plan 04 (§5.2): ...sanitizeCancelledDemoFields(event),
    // Add that line now if Plan 04 has merged; otherwise Task 22 adds it.
  };
}

// §5.2 bookkeeping for Plan 04's bridge: Undo asks the overlay for exactly this session.
function trackCancelledDemo(holder, payload) {
  if (!holder || !payload?.sessionId) return;
  if (payload.status === "cancelled") {
    holder.lastCancelledDictation = { sessionId: payload.sessionId };
  } else if (
    payload.status === "cancelClosed" &&
    holder.lastCancelledDictation?.sessionId === payload.sessionId
  ) {
    holder.lastCancelledDictation = null;
  }
}

// The publish handler's whole body. One path in both merge orders (R2-I02).
function publishDemoEvent(event, session, holder) {
  const payload = sanitizeOnboardingDemoEvent(event, session);
  if (!payload || !admitDemoEvent(session, payload.status, event)) return null;
  trackCancelledDemo(holder, payload);
  return payload;
}

// F01/R1: listening is evidence only for the take main admitted at preparation.
// A current mic failure is valid before listening; an old start cannot open a
// new demo, including when a caller reuses a demo id after leaving the step.
function admitDemoEvent(session, status, event) {
  if (!session?.takeId || event?.demoId !== session.id || event?.takeId !== session.takeId)
    return false;
  if (session.cancelRequested) return status === "cancelled" || status === "cancelClosed";
  if (session.takeClosed) return status === "cancelClosed";
  if (status === "error") {
    session.takeClosed = true;
    return true;
  }
  if (status === "listening") {
    session.sawListening = true;
    return true;
  }
  if (!session.sawListening) return false;
  if (status === "success") session.takeClosed = true;
  return true;
}

module.exports = {
  ONBOARDING_DEMO_KINDS,
  ONBOARDING_DEMO_STATUSES,
  admitDemoEvent,
  isOnboardingInputAllowed,
  publishDemoEvent,
  sanitizeOnboardingDemoEvent,
  shouldReportDictationHotkey,
  trackCancelledDemo,
};
