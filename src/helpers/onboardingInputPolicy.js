const ONBOARDING_DEMO_KINDS = new Set(["dictation", "assistant"]);
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

// The object onboarding-demo-publish broadcasts on onboarding-demo-event (§5.2).
function buildOnboardingDemoBroadcast(session, event) {
  const text = typeof event.text === "string" ? event.text.slice(0, 20000) : undefined;
  const message = typeof event.message === "string" ? event.message.slice(0, 500) : undefined;
  const tool = typeof event.tool === "string" ? event.tool.slice(0, 64) : undefined;
  const level = Number.isFinite(event.level) ? Math.min(1, Math.max(0, event.level)) : undefined;
  return {
    demoId: session.id,
    kind: session.kind,
    status: event.status,
    text,
    message,
    tool,
    level,
    ...sanitizeCancelledDemoFields(event),
  };
}

module.exports = {
  ONBOARDING_DEMO_KINDS,
  ONBOARDING_DEMO_STATUSES,
  isOnboardingInputAllowed,
  sanitizeCancelledDemoFields,
  buildOnboardingDemoBroadcast,
};
