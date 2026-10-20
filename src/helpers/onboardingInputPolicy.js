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

const CLOSE_REASONS = new Set(["expired", "restored", "replaced", "flushed"]);
const PAYLOADS = new Set(["audio", "text", "image"]);
const EVIDENCE = new Set(["attested", "dispatched"]);
const id = (v) => (typeof v === "string" && v.length > 0 && v.length <= 128 ? v : undefined);
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : undefined);
const target = (v) => typeof v === "string" && v.length <= 128;
const MAX_ALSO_SENT_TO = 8; // more receivers than routes in a dictation means a bad payload

function sanitizeCancelledDemoFields(event = {}) {
  const out = {};
  if (id(event.sessionId)) out.sessionId = event.sessionId;
  if (CLOSE_REASONS.has(event.reason)) out.reason = event.reason;
  const c = event.cancelled;
  if (
    c &&
    id(c.sessionId) &&
    c.sessionId === event.sessionId &&
    num(c.undoUntil) !== undefined &&
    num(c.remainingMs) !== undefined
  ) {
    const d = c.remoteAlreadySent;
    out.cancelled = {
      sessionId: c.sessionId,
      undoUntil: c.undoUntil,
      paused: Boolean(c.paused),
      remainingMs: c.remainingMs,
      remoteAlreadySent:
        d && target(d.target) && PAYLOADS.has(d.payload) && EVIDENCE.has(d.evidence)
          ? {
              target: d.target,
              payload: d.payload,
              evidence: d.evidence,
              alsoSentTo: (Array.isArray(d.alsoSentTo) ? d.alsoSentTo : [])
                .filter(target)
                .slice(0, MAX_ALSO_SENT_TO),
            }
          : null,
    };
  }
  return out;
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
    ...sanitizeCancelledDemoFields(event),
  };
}

// §5.2 bookkeeping for Plan 04's bridge: Undo asks the overlay for exactly this session.
function trackCancelledDemo(holder, payload) {
  if (!holder || !payload?.sessionId) return;
  if (payload.status === "cancelled" && payload.cancelled) {
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
  if (!session || event?.demoId !== session.id) return null;
  const payload = sanitizeOnboardingDemoEvent(event, session);
  if (!payload || !admitDemoEvent(session, payload.status, payload)) return null;
  trackCancelledDemo(holder, payload);
  return payload;
}

// F01/R1: listening is evidence only for the take main admitted at preparation.
// A current mic failure is valid before listening; an old start cannot open a
// new demo, including when a caller reuses a demo id after leaving the step.
function admitDemoEvent(session, status, event) {
  if (!session?.takeId || event?.demoId !== session.id || event?.takeId !== session.takeId)
    return false;
  if (status === "cancelled") {
    if (!event.cancelled) {
      if (!session.cancelRequested || event.sessionId || session.takeClosed) return false;
      session.takeClosed = true;
      return true;
    }
    if (event.cancelled.sessionId !== event.sessionId || session.takeClosed) return false;
    if (session.cancelSession && session.cancelSession !== event.sessionId) return false;
    session.cancelSession = event.sessionId;
    return true;
  }
  if (status === "cancelClosed") {
    if (session.cancelSession !== event.sessionId || !CLOSE_REASONS.has(event.reason)) return false;
    session.cancelSession = null;
    if (event.reason === "restored") {
      session.cancelRequested = false;
      session.takeClosed = false;
    } else session.takeClosed = true;
    return true;
  }
  if (session.cancelRequested) return status === "cancelled";
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
  sanitizeCancelledDemoFields,
  buildOnboardingDemoBroadcast: (session, event) => sanitizeOnboardingDemoEvent(event, session),
};
