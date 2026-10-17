const assert = require("node:assert/strict");
const test = require("node:test");

const t = (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key);
const load = () => import("../../src/components/voiceNotices.ts");

test("cleanup failure is an amber notice with Retry cleanup first, never red (VO-Q7)", async () => {
  const { buildCleanupFailureNotice } = await load();
  const notice = buildCleanupFailureNotice(
    { message: "Qwen3.5 2B timed out after 30s", rawText: "hello" },
    t,
    { retry: async () => {}, openSettings: () => {} }
  );
  assert.equal(notice.kind, "notice");
  assert.equal(notice.id, "cleanup-failed");
  assert.equal(notice.title, "notices.cleanupFailed.title");
  assert.equal(notice.body, "Qwen3.5 2B timed out after 30s");
  assert.deepEqual(
    notice.actions.map((a) => [a.label, !!a.primary]),
    [
      ["notices.cleanupFailed.retry", true],
      ["notices.cleanupFailed.settings", false],
    ]
  );
});

test("cleanup failure without the raw words offers Settings only", async () => {
  const { buildCleanupFailureNotice } = await load();
  const notice = buildCleanupFailureNotice({ message: "x" }, t, {
    retry: async () => {},
    openSettings: () => {},
  });
  assert.deepEqual(
    notice.actions.map((a) => a.label),
    ["notices.cleanupFailed.settings"]
  );
});

test("a model the user did not pick is a persistent notice with Accept (VO-Q21)", async () => {
  const { buildModelSwitchNotice } = await load();
  const notice = buildModelSwitchNotice({ from: "gpt-oss-120b", to: "Qwen3 235B" }, t, {
    openSettings: () => {},
  });
  assert.equal(notice.kind, "notice");
  assert.equal(notice.persistent, true);
  assert.equal(notice.id, "tinfoil-model-switch");
  assert.deepEqual(
    notice.actions.map((a) => a.label),
    ["notices.modelChanged.accept", "notices.modelChanged.choose"]
  );
  assert.match(notice.body, /gpt-oss-120b/);
});

test("a dictation error with recovered words becomes the words-first card, under its session's own id", async () => {
  const { buildDictationErrorNotice } = await load();
  const withWords = buildDictationErrorNotice(
    {
      title: "Couldn't paste into Slack",
      description: "couldn't reach app",
      words: "Hey Maya",
      sessionKey: "rec-1",
    },
    t,
    { retry: () => {}, pasteAgain: async () => {} }
  );
  assert.equal(withWords.kind, "alert");
  assert.equal(withWords.id, "dictation-recovery:rec-1");
  assert.equal(withWords.words, "Hey Maya");
  assert.equal(withWords.actions[0].label, "notices.actions.pasteAgain");
  assert.equal(withWords.actions[0].keepOpen, true);

  // No content: the stable status id, so the next status replaces it.
  const noWords = buildDictationErrorNotice(
    { title: "We didn't hear anything", sessionKey: "rec-2" },
    t,
    { retry: () => {}, pasteAgain: async () => {} }
  );
  assert.equal(noWords.id, "dictation-error");
  assert.equal(noWords.words, undefined);
  assert.equal(noWords.actions[0].label, "common.retry");
});

test("Plan 07's notices keep their §5.3 shapes", async () => {
  const { buildDictationErrorNotice, buildSealedRecoveryNotice } = await load();
  const transcribe = { label: "sealedMode.recovery.transcribe", onClick: () => {} };
  // A sealed refusal that holds audio in memory is an alert that never times out.
  const held = buildDictationErrorNotice(
    { title: "sealedMode.blocked.dictationPreflight", recoveryHeld: true, sessionKey: "rec-3" },
    t,
    { retry: () => {}, pasteAgain: async () => {}, extraActions: [transcribe] }
  );
  assert.equal(held.kind, "alert");
  assert.equal(held.persistent, true);
  // Held audio is content too: its own id, never the status id that a new start clears.
  assert.equal(held.id, "dictation-recovery:rec-3");
  assert.ok(
    held.actions.includes(transcribe),
    "Transcribe is reachable from the pill's notice slot"
  );

  const recovery = buildSealedRecoveryNotice(t, {
    transcribe: async () => true,
    discard: () => {},
  });
  assert.equal(recovery.kind, "notice");
  assert.equal(recovery.persistent, true);
  assert.deepEqual(
    recovery.actions.map((a) => a.label),
    ["sealedMode.recovery.transcribe", "sealedMode.recovery.discard"]
  );
});

// `ctx`, not `t`: the module-level `t` is the translator the builder needs.
test("a failed Retry cleanup leaves its explanation on screen (I10, real store)", async (ctx) => {
  const notices = await import("../../src/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  ctx.after(() => notices.__setNoticeClockForTests());
  const { buildCleanupFailureNotice } = await load();
  const { retryDictationCleanup } = await import("../../src/helpers/retryDictationCleanup.js");
  const deps = {
    processText: async () => {
      throw new Error("timeout");
    },
    writeClipboard: async () => {},
    notify: notices.notify,
    t: (k) => k,
  };
  const id = notices.notify(
    buildCleanupFailureNotice({ message: "x", rawText: "raw words" }, t, {
      retry: async () => {
        await retryDictationCleanup("raw words", deps);
      },
      openSettings: () => {},
    })
  );
  const retry = notices.getNotices()[0].actions.find((a) => a.primary);
  await notices.runNoticeAction(id, retry);
  const [left] = notices.getNotices();
  assert.equal(left.kind, "alert");
  assert.equal(left.title, "notices.cleanupFailed.retryFailed");
});

test("a failed cleanup Retry keeps its own words when a later cleanup fails", async (ctx) => {
  const notices = await import("../../src/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  ctx.after(() => notices.__setNoticeClockForTests());
  const { buildCleanupFailureNotice } = await load();
  const { retryDictationCleanup } = await import("../../src/helpers/retryDictationCleanup.js");
  const deps = {
    processText: undefined,
    writeClipboard: async () => false,
    notify: notices.notify,
    t,
  };
  const id = notices.notify(
    buildCleanupFailureNotice({ message: "first", rawText: "first raw" }, t, {
      retry: async () => {
        await retryDictationCleanup("first raw", deps);
      },
      openSettings: () => {},
    })
  );
  await notices.runNoticeAction(id, notices.getNotices()[0].actions[0]);
  const later = notices.notify(
    buildCleanupFailureNotice({ message: "second", rawText: "second raw" }, t, {
      retry: async () => {},
      openSettings: () => {},
    })
  );
  assert.equal(later, "cleanup-failed");
  assert.deepEqual(
    notices.wordsNotices(notices.getNotices()).map((n) => [n.id, n.words]),
    [["cleanup-recovery", "first raw"]]
  );
  assert.equal(notices.getNotices().find((n) => n.id === later).kind, "notice");
});
