const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ONBOARDING_DEMO_KINDS,
  ONBOARDING_DEMO_STATUSES,
  admitDemoEvent,
  publishDemoEvent,
  sanitizeOnboardingDemoEvent,
  shouldReportDictationHotkey,
  trackCancelledDemo,
  isOnboardingInputAllowed,
} = require("../../src/helpers/onboardingInputPolicy");

test("normal global inputs remain available outside onboarding", () => {
  for (const kind of ["dictation", "assistant", "translation", "agent"]) {
    assert.equal(isOnboardingInputAllowed(false, null, kind), true);
  }
});

test("onboarding blocks every global input outside a demo", () => {
  for (const kind of ["dictation", "assistant", "translation", "agent"]) {
    assert.equal(isOnboardingInputAllowed(true, null, kind), false);
  }
});

test("each onboarding demo allows only its matching recording input", () => {
  assert.equal(isOnboardingInputAllowed(true, "dictation", "dictation"), true);
  assert.equal(isOnboardingInputAllowed(true, "dictation", "assistant"), false);
  assert.equal(isOnboardingInputAllowed(true, "assistant", "assistant"), true);
  assert.equal(isOnboardingInputAllowed(true, "assistant", "dictation"), false);
  assert.equal(isOnboardingInputAllowed(true, "assistant", "translation"), false);
  assert.equal(isOnboardingInputAllowed(true, "assistant", "agent"), false);
});

test("unknown demo kinds fail closed while onboarding is active", () => {
  assert.equal(isOnboardingInputAllowed(true, "unknown", "dictation"), false);
  assert.equal(isOnboardingInputAllowed(true, undefined, "assistant"), false);
});

// The assistant demo streams its reply back through the publish channel, so the
// main-process allowlist has to admit that status or the card never fills in.
test("the demo event allowlist covers the streamed assistant reply", () => {
  assert.equal(ONBOARDING_DEMO_STATUSES.has("replying"), true);
  assert.equal(ONBOARDING_DEMO_STATUSES.has("success"), true);
  assert.equal(ONBOARDING_DEMO_STATUSES.has("done"), false);
});

test("a shortcut demo observes presses but never starts a recording", () => {
  assert.ok(ONBOARDING_DEMO_KINDS.has("shortcut"));
  for (const input of ["dictation", "assistant", "translation", "agent"]) {
    assert.equal(isOnboardingInputAllowed(true, "shortcut", input), false, input);
  }
  assert.equal(shouldReportDictationHotkey(true, "shortcut"), true);
  assert.equal(shouldReportDictationHotkey(true, "dictation"), true);
  assert.equal(shouldReportDictationHotkey(true, "assistant"), false);
  assert.equal(shouldReportDictationHotkey(true, null), false);
  assert.equal(
    shouldReportDictationHotkey(false, "dictation"),
    false,
    "after setup, presses stay private"
  );
});

test("the cancelled and cancelClosed states can reach the setup window (§5.2)", () => {
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelled"));
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelClosed"));
});

test("a session admits nothing until its own take starts listening", () => {
  const session = { id: "demo-2", kind: "dictation", takeId: "take-2" };
  assert.equal(
    admitDemoEvent(session, "success"),
    false,
    "a late result from an earlier take is dropped"
  );
  assert.equal(admitDemoEvent(session, "level"), false);
  assert.equal(admitDemoEvent(session, "listening", { demoId: "demo-2", takeId: "take-2" }), true);
  assert.equal(admitDemoEvent(session, "success", { demoId: "demo-2", takeId: "take-2" }), true);
  assert.equal(admitDemoEvent({ id: "demo-3", kind: "shortcut" }, "error"), false);
});

test("main tracks the open cancel window by session, and only that session closes it (§5.2)", () => {
  const holder = { lastCancelledDictation: null };
  trackCancelledDemo(holder, { status: "cancelled" });
  assert.equal(holder.lastCancelledDictation, null, "the pre-Plan-04 fallback carries no session");
  trackCancelledDemo(holder, {
    status: "cancelled",
    sessionId: "rec-1",
    cancelled: { sessionId: "rec-1" },
  });
  assert.deepEqual(holder.lastCancelledDictation, { sessionId: "rec-1" });
  trackCancelledDemo(holder, { status: "cancelClosed", sessionId: "rec-0", reason: "expired" });
  assert.deepEqual(
    holder.lastCancelledDictation,
    { sessionId: "rec-1" },
    "a stale close cannot clear a newer window"
  );
  trackCancelledDemo(holder, { status: "cancelClosed", sessionId: "rec-1", reason: "restored" });
  assert.equal(holder.lastCancelledDictation, null);
});

test("publishing sanitises, admits, then tracks; a rejected event changes nothing", () => {
  const holder = { lastCancelledDictation: { sessionId: "keep" } };
  const session = { id: "demo-1", kind: "dictation", takeId: "take-1" };
  assert.equal(
    publishDemoEvent(
      { kind: "dictation", status: "cancelled", sessionId: "rec-9" },
      session,
      holder
    ),
    null,
    "not admitted before listening"
  );
  assert.deepEqual(holder.lastCancelledDictation, { sessionId: "keep" });
  assert.equal(
    publishDemoEvent(
      { demoId: "demo-1", takeId: "take-1", kind: "dictation", status: "listening" },
      session,
      holder
    ).status,
    "listening"
  );
});

test("the publish sanitizer keeps trial fields, clamps them, and drops everything else", () => {
  const session = { id: "demo-1", kind: "dictation" };
  const out = sanitizeOnboardingDemoEvent(
    {
      kind: "dictation",
      status: "success",
      text: "Hi",
      rawText: "um hi",
      cleanup: "applied",
      code: "X".repeat(100),
      level: 3,
      demoId: "spoofed",
      secret: "nope",
    },
    session
  );
  assert.deepEqual(out, {
    demoId: "demo-1",
    kind: "dictation",
    status: "success",
    text: "Hi",
    rawText: "um hi",
    message: undefined,
    code: "X".repeat(64),
    tool: undefined,
    level: 1,
    cleanup: "applied",
  });
  assert.equal(
    sanitizeOnboardingDemoEvent({ kind: "assistant", status: "success" }, session),
    null
  );
  assert.equal(sanitizeOnboardingDemoEvent({ kind: "dictation", status: "done" }, session), null);
  assert.equal(sanitizeOnboardingDemoEvent({ kind: "dictation", status: "success" }, null), null);
  const odd = sanitizeOnboardingDemoEvent(
    {
      kind: "dictation",
      status: "cancelled",
      cleanup: "maybe",
      undoUntil: 1700,
      remoteAlreadySent: "OpenAI",
      level: Number.NaN,
    },
    session
  );
  assert.equal(odd.cleanup, undefined);
  assert.equal(odd.level, undefined);
  assert.equal(
    "undoUntil" in odd,
    false,
    "the retired pair never passes; §5.2 uses cancelled: CancelledState"
  );
  assert.equal("remoteAlreadySent" in odd, false);
});

test("rich cancel publication binds original demo/take before sanitization and keeps every recipient", () => {
  const session = { id: "demo", kind: "dictation", takeId: "take", sawListening: true };
  const holder = { lastCancelledDictation: null };
  const event = {
    demoId: "demo",
    takeId: "take",
    kind: "dictation",
    status: "cancelled",
    sessionId: "recording",
    cancelled: {
      sessionId: "recording",
      undoUntil: 5000,
      remainingMs: 4000,
      paused: false,
      private: true,
      remoteAlreadySent: {
        target: "Speech",
        payload: "audio",
        evidence: "dispatched",
        alsoSentTo: ["Cleanup", "Second", null],
        secret: "discard",
      },
    },
  };
  for (const forged of [{ demoId: "other" }, { takeId: "other" }]) {
    assert.equal(publishDemoEvent({ ...event, ...forged }, session, holder), null);
    assert.equal(holder.lastCancelledDictation, null);
  }
  const accepted = publishDemoEvent(event, session, holder);
  assert.deepEqual(accepted.cancelled.remoteAlreadySent.alsoSentTo, ["Cleanup", "Second"]);
  assert.equal("private" in accepted.cancelled, false);
  assert.equal("secret" in accepted.cancelled.remoteAlreadySent, false);
  assert.deepEqual(holder.lastCancelledDictation, { sessionId: "recording" });
  assert.equal(publishDemoEvent({ ...event, sessionId: "other" }, session, holder), null);
  assert.equal(
    publishDemoEvent({ ...event, status: "cancelClosed", reason: "restored" }, session, holder)
      .reason,
    "restored"
  );
  assert.equal(holder.lastCancelledDictation, null);
});
