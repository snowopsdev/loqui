const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "../..");

test("Undo from another window round-trips to the overlay and returns its result", async () => {
  const { EventEmitter } = require("node:events");
  const { requestFromRenderer } = require("../../src/helpers/rendererRequest.js");
  const ipcMain = new EventEmitter();
  // The overlay renderer: answers an undo request with its UndoResult.
  const overlay = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel, { token, sessionId }) => {
      if (channel === "undo-cancel-request") {
        setImmediate(() =>
          ipcMain.emit("undo-cancel-reply", { sender: overlay }, token, {
            restored: true,
            sessionId,
          })
        );
      }
    },
  });
  const result = await requestFromRenderer({
    ipcMain,
    webContents: overlay,
    channel: "undo-cancel-request",
    replyChannel: "undo-cancel-reply",
    payload: { sessionId: "rec-7" },
    timeoutMs: 2000,
    fallback: { restored: false, sessionId: "rec-7", reason: "unavailable" },
  });
  assert.deepEqual(result, { restored: true, sessionId: "rec-7" });
});

test("the demo channel accepts cancelled and cancelClosed with sanitised fields", async () => {
  const {
    ONBOARDING_DEMO_STATUSES,
    sanitizeCancelledDemoFields,
  } = require("../../src/helpers/onboardingInputPolicy.js");
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelled"));
  assert.ok(ONBOARDING_DEMO_STATUSES.has("cancelClosed"));
  const clean = sanitizeCancelledDemoFields({
    sessionId: "rec-7",
    cancelled: {
      sessionId: "rec-7",
      undoUntil: 5000,
      paused: false,
      remainingMs: 5000,
      remoteAlreadySent: {
        target: "openai",
        payload: "audio",
        evidence: "attested",
        alsoSentTo: ["anthropic", "host:gpu-box.lan", 7],
        extra: "x",
      },
      junk: 1,
    },
    reason: "nope",
  });
  assert.deepEqual(clean, {
    sessionId: "rec-7",
    cancelled: {
      sessionId: "rec-7",
      undoUntil: 5000,
      paused: false,
      remainingMs: 5000,
      // §5.2 (ff8c9cd): every RemoteDisclosure field survives, including alsoSentTo.
      remoteAlreadySent: {
        target: "openai",
        payload: "audio",
        evidence: "attested",
        alsoSentTo: ["anthropic", "host:gpu-box.lan"],
      },
    },
  });
  const bare = sanitizeCancelledDemoFields({
    sessionId: "rec-8",
    cancelled: {
      sessionId: "rec-8",
      undoUntil: 1,
      paused: false,
      remainingMs: 1,
      remoteAlreadySent: { target: "openai", payload: "text", evidence: "dispatched" },
    },
  });
  assert.deepEqual(
    bare.cancelled.remoteAlreadySent.alsoSentTo,
    [],
    "a missing list is the empty list, never undefined"
  );
  assert.equal(sanitizeCancelledDemoFields({ sessionId: "x".repeat(200) }).sessionId, undefined);
  assert.equal(
    sanitizeCancelledDemoFields({ sessionId: "rec-7", reason: "restored" }).reason,
    "restored"
  );
});

test("main.js routes before-quit through the coordinator", () => {
  const main = fs.readFileSync(path.join(repoRoot, "main.js"), "utf8");
  // Whitespace-insensitive: the registration spans several lines (R3-I2).
  assert.match(main, /app\.on\(\s*"before-quit",\s*createQuitCoordinator\(/);
  assert.doesNotMatch(main, /isShuttingDown/, "the coordinator owns the shutdown state");
});

test("the real broadcaster keeps every receiver, and disclosure copy names them all", async () => {
  const { buildOnboardingDemoBroadcast } = require("../../src/helpers/onboardingInputPolicy");
  const { disclosureCopy } = await import("../../src/helpers/dictationDisclosure.js");
  const broadcast = buildOnboardingDemoBroadcast(
    { id: "demo-1", kind: "dictation" },
    {
      kind: "dictation",
      status: "cancelled",
      sessionId: "rec-1",
      cancelled: {
        sessionId: "rec-1",
        undoUntil: 9000,
        paused: false,
        remainingMs: 5000,
        remoteAlreadySent: {
          target: "openai",
          payload: "audio",
          evidence: "attested",
          alsoSentTo: ["anthropic"],
        },
      },
    }
  );
  assert.deepEqual(broadcast.cancelled.remoteAlreadySent.alsoSentTo, ["anthropic"]);
  const t = (k, o) => (o ? `${k}|${o.provider}` : k);
  assert.equal(
    disclosureCopy(broadcast.cancelled.remoteAlreadySent, t),
    "pill.caption.remoteSeveral|OpenAI, Anthropic"
  );
});

test("actual onboarding handler broadcasts sanitised events and stale close A cannot clear B's cache", (t) => {
  const { undoBridge } = require("./harness/undoBridge");
  const f = undoBridge(t);
  const open = (sessionId) => ({
    kind: "dictation",
    status: "cancelled",
    sessionId,
    cancelled: {
      sessionId,
      undoUntil: 5000,
      remainingMs: 5000,
      paused: false,
      remoteAlreadySent: {
        target: "openai",
        payload: "audio",
        evidence: "attested",
        alsoSentTo: ["anthropic", 7],
        junk: "drop",
      },
      junk: 1,
    },
  });
  assert.equal(f.invoke("onboarding-demo-publish", open("forged"), {}), false);
  assert.equal(f.windowManager.lastCancelledDictation, null);
  assert.equal(f.invoke("onboarding-demo-publish", open("A")), true);
  assert.equal(f.invoke("onboarding-demo-publish", open("B")), true);
  assert.equal(
    f.invoke("onboarding-demo-publish", {
      kind: "dictation",
      status: "cancelClosed",
      sessionId: "A",
      reason: "expired",
    }),
    true
  );
  assert.deepEqual(f.windowManager.lastCancelledDictation, { sessionId: "B" });
  assert.deepEqual(f.broadcasts[1][1].cancelled.remoteAlreadySent.alsoSentTo, ["anthropic"]);
  assert.equal(f.broadcasts[1][1].cancelled.junk, undefined);
  f.invoke("onboarding-demo-publish", {
    kind: "dictation",
    status: "cancelClosed",
    sessionId: "B",
    reason: "bogus",
  });
  assert.deepEqual(f.windowManager.lastCancelledDictation, { sessionId: "B" });
  f.invoke("onboarding-demo-publish", {
    kind: "dictation",
    status: "cancelClosed",
    sessionId: "B",
    reason: "restored",
  });
  assert.equal(f.windowManager.lastCancelledDictation, null);
  f.invoke("onboarding-demo-publish", { kind: "dictation", status: "processing" });
  assert.deepEqual(
    f.broadcasts.slice(-2).map(([, e]) => e.status),
    ["cancelClosed", "processing"]
  );
  f.invoke("onboarding-demo-publish", open("C"));
  f.windowManager.onOnboardingDemoTeardown();
  assert.equal(f.windowManager.lastCancelledDictation, null);
  assert.equal(f.invoke("onboarding-demo-publish", open("D")), false);
});

test("actual WindowManager Undo targets overlay, stamps budget, ignores foreign sender/token and flush requires true ack", async (t) => {
  const { undoBridge } = require("./harness/undoBridge");
  const f = undoBridge(t);
  f.windowManager.lastCancelledDictation = { sessionId: "held" };
  const before = Date.now();
  const undo = f.windowManager.sendUndoCancelDictation();
  const [channel, request] = f.sent[0];
  assert.equal(channel, "undo-cancel-request");
  assert.equal(request.sessionId, "held");
  assert.ok(request.deadlineAt >= before + 1500 && request.deadlineAt <= Date.now() + 1500);
  f.ipcMain.emit("undo-cancel-reply", { sender: {} }, request.token, { restored: true });
  f.ipcMain.emit("undo-cancel-reply", { sender: f.overlay }, request.token + 1, { restored: true });
  const result = { restored: false, sessionId: "held", reason: "sealed" };
  f.ipcMain.emit("undo-cancel-reply", { sender: f.overlay }, request.token, result);
  assert.deepEqual(await undo, result);
  const flush = f.windowManager.flushDictationBeforeQuit({ timeoutMs: 50 });
  const flushRequest = f.sent.at(-1)[1];
  f.ipcMain.emit("dictation-flush-reply", { sender: f.overlay }, flushRequest.token, true);
  assert.equal(await flush, true);
  assert.equal(await f.windowManager.flushDictationBeforeQuit({ timeoutMs: 5 }), false);
  f.windowManager.mainWindow = null;
  assert.deepEqual(await f.windowManager.sendUndoCancelDictation("gone"), {
    restored: false,
    sessionId: "gone",
    reason: "unavailable",
  });
  assert.equal(f.ipcMain.listenerCount("undo-cancel-reply"), 0);
  assert.equal(f.overlay.listenerCount("did-start-navigation"), 0);
});
