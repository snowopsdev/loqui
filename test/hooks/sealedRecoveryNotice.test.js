const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const t = (key) => `t:${key}`;

test("sealed dictation copy is always translated and never a raw main-process message", async () => {
  const { getRecordingErrorTitle, getRecordingErrorDescription } =
    await import("../../src/utils/recordingErrors.ts");
  const raw = {
    code: "SEALED_MODE",
    title: "Transcription Error",
    description: "[SEALED_MODE] raw",
  };
  assert.equal(getRecordingErrorTitle(raw, t), "t:sealedMode.blocked.dictationTitle");
  assert.equal(getRecordingErrorDescription(raw, t), "t:sealedMode.blocked.generic");
  assert.equal(
    getRecordingErrorDescription({ ...raw, description: "[SEALED_MODE:interrupted] cut" }, t),
    "t:sealedMode.interrupted.generic",
    "an interruption never falls back to 'nothing was sent'"
  );
  const preflight = {
    code: "SEALED_MODE",
    title: "x",
    titleKey: "sealedMode.blocked.nativeUnavailableTitle",
    messageKey: "sealedMode.blocked.nativeUnavailableDetail",
  };
  assert.equal(getRecordingErrorTitle(preflight, t), "t:sealedMode.blocked.nativeUnavailableTitle");
  assert.equal(
    getRecordingErrorDescription(preflight, t),
    "t:sealedMode.blocked.nativeUnavailableDetail"
  );
  // T9-M1: Corti may still hold the interaction; Loqui says so.
  const corti = {
    code: "SEALED_MODE",
    title: "x",
    messageKey: "sealedMode.interrupted.dictationHeld",
    providerRetained: "corti",
  };
  assert.equal(
    getRecordingErrorDescription(corti, t),
    "t:sealedMode.interrupted.dictationHeld t:sealedMode.interrupted.cortiRetained"
  );
  assert.equal(
    getRecordingErrorTitle({ code: "NETWORK_ERROR", title: "x" }, t),
    "t:x",
    "others unchanged"
  );
});

// Touch-up 3, TS2-1: a dictation card whose code is not SEALED_MODE but whose
// text carries main's marker (the private take's refused FFmpeg merge, shown
// as AUDIO_CONVERSION_FAILED) is sealed copy too, never main's English text.
test("a dictation card with main's sealed marker under another code is translated sealed copy", async () => {
  const { getRecordingErrorTitle, getRecordingErrorDescription } =
    await import("../../src/utils/recordingErrors.ts");
  const merge = {
    title: "Transcription Error",
    description:
      "[SEALED_MODE] Sealed mode blocked nativeLaunch to native-ffmpeg before any socket opened; nothing was sent.",
    code: "AUDIO_CONVERSION_FAILED",
  };
  assert.equal(getRecordingErrorTitle(merge, t), "t:sealedMode.blocked.dictationTitle");
  assert.equal(getRecordingErrorDescription(merge, t), "t:sealedMode.blocked.generic");
  const wrapped = {
    title: "Streaming Error",
    message:
      "Error invoking remote method 'x': SealedModeError: [SEALED_MODE:interrupted] Sealed mode interrupted dictationStt to api.openai.com; the provider may have received part of the request.",
  };
  assert.equal(
    getRecordingErrorDescription(wrapped, t),
    "t:sealedMode.interrupted.generic",
    "the marker in `message` counts too, by phase"
  );
  for (const text of [getRecordingErrorDescription(merge, t), getRecordingErrorTitle(merge, t)])
    assert.doesNotMatch(text, /\[SEALED_MODE|nothing was sent/);
  // Ordinary conversion failures keep their own text and title.
  const plain = {
    title: "Transcription Error",
    description: "ffmpeg exited 1",
    code: "AUDIO_CONVERSION_FAILED",
  };
  assert.equal(getRecordingErrorTitle(plain, t), "Transcription Error");
  assert.equal(getRecordingErrorDescription(plain, t), "ffmpeg exited 1");
});

// Touch-up 3, O1: main settles a sealed auto-paste as a typed failure; the
// card says why, and claims the clipboard only when main said it copied.
test("a sealed paste card says Sealed mode stopped the paste, and the clipboard only when main copied", async () => {
  const { getRecordingErrorTitle, getRecordingErrorDescription } =
    await import("../../src/utils/recordingErrors.ts");
  const card = (messageKey) => ({
    code: "SEALED_MODE",
    title: "Paste Error",
    titleKey: "sealedMode.paste.title",
    messageKey,
  });
  assert.equal(
    getRecordingErrorTitle(card("sealedMode.paste.copied"), t),
    "t:sealedMode.paste.title"
  );
  assert.equal(
    getRecordingErrorDescription(card("sealedMode.paste.copied"), t),
    "t:sealedMode.paste.copied"
  );
  assert.equal(
    getRecordingErrorDescription(card("sealedMode.paste.notCopied"), t),
    "t:sealedMode.paste.notCopied"
  );
  const en = JSON.parse(fs.readFileSync(path.join(root, "src/locales/en/translation.json"), "utf8"))
    .sealedMode.paste;
  assert.match(en.copied, /clipboard/);
  assert.doesNotMatch(en.notCopied, /clipboard|History/, "no claim main did not make");
  assert.doesNotMatch(en.copied, /History|nothing was sent|verified/i);
});

test("a held-audio refusal is a persistent alert whose only way back is Transcribe", async () => {
  const { buildDictationErrorNotice, buildSealedRecoveryNotice } =
    await import("../../src/components/voiceNotices.ts");
  let transcribed = 0;
  const notice = buildDictationErrorNotice(
    { title: "T", description: "D", recoveryHeld: true, sessionKey: "s-1" },
    t,
    {
      retry: () => assert.fail("Retry would hit the same seal"),
      pasteAgain: async () => {},
      extraActions: [
        { label: t("sealedMode.recovery.transcribeOne"), onClick: () => transcribed++ },
      ],
    }
  );
  assert.equal(notice.persistent, true);
  assert.deepEqual(
    notice.actions.map((a) => a.label),
    ["t:sealedMode.recovery.transcribeOne"]
  );
  notice.actions[0].onClick();
  assert.equal(transcribed, 1);
  const unseal = buildSealedRecoveryNotice(t, { transcribe: async () => {}, discard: () => {} });
  assert.equal(unseal.persistent, true);
  assert.deepEqual(
    unseal.actions.map((a) => a.label),
    ["t:sealedMode.recovery.transcribe", "t:sealedMode.recovery.discard"]
  );
});

// Ratchet beside the executed tests above: the hook wires those builders.
test("useAudioRecording offers Transcribe for held audio and again on unseal, without toasts", () => {
  const hook = fs.readFileSync(path.join(root, "src/hooks/useAudioRecording.js"), "utf8");
  const block = hook.slice(
    hook.indexOf("const offSealed = subscribeSealed("),
    hook.indexOf("wasSealed = sealed;")
  );
  assert.ok(block.length > 0, "the unseal prompt exists");
  assert.match(block, /wasSealed === true && sealed === false && recoveryCount\(\) > 0/);
  assert.match(block, /notify\(\s*buildSealedRecoveryNotice\(t, \{\s*transcribe:/);
  assert.match(hook, /offSealed\(\);/, "unsubscribed in cleanup");
  assert.match(hook, /error\?\.recoveryHeld === true/);
  assert.match(hook, /sealedMode\.recovery\.transcribeOne/);
  assert.doesNotMatch(hook, /(^|[^.\w])toast\(\{/m);
});

// Task 13 fix round 2, N2: held-recording cards follow the hold they name.
// Executed against the real notice store and the real recovery store; only
// the 30-minute clock is mocked.
const heldOperation = (key) =>
  Object.freeze({
    owned: Object.freeze({
      blob: new Blob([`audio-${key}`]),
      sessionId: key,
      private: false,
      metadata: null,
    }),
    session: Object.freeze({ id: key }),
    context: null,
    tracker: null,
  });

async function heldCards(ctx) {
  ctx.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const notices = await import("../../src/components/ui/notices.ts");
  const recovery = await import("../../src/lib/sealedRecovery.ts");
  const voice = await import("../../src/components/voiceNotices.ts");
  const { watchHeldRecordingCards } = await import("../../src/components/heldRecordingCards.ts");
  const clear = () => {
    for (const n of notices.getNotices()) notices.dismissNotice(n.id, "user");
  };
  clear();
  recovery.discardRecovery();
  const cards = watchHeldRecordingCards(t);
  ctx.after(() => {
    cards.dispose();
    recovery.discardRecovery();
    clear();
  });
  const replayed = [];
  const card = (sessionKey, { words } = {}) => {
    const holdId = recovery.holdForRecovery(heldOperation(sessionKey));
    const action = cards.transcribeAction({
      holdId,
      label: t("sealedMode.recovery.transcribeOne"),
      transcribe: (id) => replayed.push(id),
    });
    const noticeId = notices.notify(
      voice.buildDictationErrorNotice(
        {
          title: t("sealedMode.blocked.dictationTitle"),
          description: t("sealedMode.blocked.dictationHeld"),
          recoveryHeld: true,
          sessionKey,
          words,
        },
        t,
        { retry: () => {}, pasteAgain: async () => {}, extraActions: [action] }
      )
    );
    cards.track(noticeId, holdId, action);
    return { holdId, noticeId, action };
  };
  const find = (id) => notices.getNotices().find((n) => n.id === id) ?? null;
  const labels = (id) => (find(id)?.actions ?? []).map((a) => a.label);
  return { notices, recovery, voice, cards, card, find, labels, replayed };
}

test("N2: a card's Transcribe names its own hold; at expiry the card says so and loses Transcribe", async (ctx) => {
  const h = await heldCards(ctx);
  const a = h.card("s-a");
  ctx.mock.timers.tick(60_000);
  const b = h.card("s-b");
  assert.deepEqual(h.labels(a.noticeId), ["t:sealedMode.recovery.transcribeOne"]);
  await a.action.onClick();
  await b.action.onClick();
  assert.deepEqual(h.replayed, [a.holdId, b.holdId], "each card replays its own hold");
  const bRevision = h.find(b.noticeId).revision;
  ctx.mock.timers.tick(h.recovery.RECOVERY_TTL_MS - 60_000 + 1);
  assert.equal(h.recovery.recoveryStatus(a.holdId), "expired");
  const gone = h.find(a.noticeId);
  assert.equal(gone.title, "t:sealedMode.recovery.goneTitle");
  assert.equal(gone.body, "t:sealedMode.recovery.goneExpired");
  assert.deepEqual(h.labels(a.noticeId), [], "no Transcribe for a recording that is gone");
  assert.equal(gone.persistent, true, "the user sees what happened to it");
  assert.equal(h.find(b.noticeId).revision, bRevision, "the other card is untouched");
  assert.deepEqual(h.labels(b.noticeId), ["t:sealedMode.recovery.transcribeOne"]);
  ctx.mock.timers.tick(60_000);
  assert.equal(h.find(b.noticeId).body, "t:sealedMode.recovery.goneExpired");
});

test("N2: an evicted hold's card says it made room; a card with words keeps them", async (ctx) => {
  const h = await heldCards(ctx);
  const first = h.card("s-1", { words: "words that arrived" });
  const rest = [2, 3].map((n) => h.card(`s-${n}`));
  const fourth = h.card("s-4");
  assert.equal(h.recovery.recoveryStatus(first.holdId), "evicted");
  const gone = h.find(first.noticeId);
  assert.equal(gone.title, "t:sealedMode.recovery.goneTitle");
  assert.equal(gone.body, "t:sealedMode.recovery.goneEvicted");
  assert.equal(gone.words, "words that arrived", "recovered words are never dropped");
  assert.deepEqual(h.labels(first.noticeId), ["t:notices.actions.pasteAgain"]);
  for (const c of [...rest, fourth])
    assert.deepEqual(h.labels(c.noticeId), ["t:sealedMode.recovery.transcribeOne"]);
});

test("N2: transcribed or discarded, the card leaves; one the user dismissed never comes back", async (ctx) => {
  const h = await heldCards(ctx);
  const done = h.card("s-done");
  const claim = h.recovery.claimRecoveryById(done.holdId);
  h.recovery.releaseRecovery(claim.id, { done: true });
  assert.equal(h.find(done.noticeId), null, "transcribed elsewhere: nothing left to offer");
  const dismissed = h.card("s-dismissed");
  h.notices.dismissNotice(dismissed.noticeId, "user");
  const discarded = h.card("s-discarded");
  h.recovery.discardRecovery();
  assert.equal(h.find(discarded.noticeId), null, "the user discarded it");
  assert.equal(h.find(dismissed.noticeId), null, "never recreated");
  const late = h.card("s-late");
  h.notices.dismissNotice(late.noticeId, "user");
  ctx.mock.timers.tick(h.recovery.RECOVERY_TTL_MS + 1);
  assert.equal(h.find(late.noticeId), null, "expiry recreates nothing the user dismissed");
});

test("N2: the unseal prompt leaves once nothing is held; dispose stops listening", async (ctx) => {
  const h = await heldCards(ctx);
  const a = h.card("s-a");
  ctx.mock.timers.tick(1000);
  const b = h.card("s-b");
  h.notices.notify(
    h.voice.buildSealedRecoveryNotice(t, { transcribe: async () => {}, discard: () => {} })
  );
  const prompt = () => h.find(h.voice.SEALED_RECOVERY_NOTICE_ID);
  assert.notEqual(prompt(), null);
  ctx.mock.timers.tick(h.recovery.RECOVERY_TTL_MS - 500);
  assert.equal(h.recovery.recoveryStatus(a.holdId), "expired");
  assert.notEqual(prompt(), null, "one recording is still held");
  h.cards.dispose();
  ctx.mock.timers.tick(1000);
  assert.equal(h.recovery.recoveryStatus(b.holdId), "expired");
  assert.deepEqual(
    h.labels(b.noticeId),
    ["t:sealedMode.recovery.transcribeOne"],
    "a disposed watcher changes nothing"
  );
  const again = (
    await import("../../src/components/heldRecordingCards.ts")
  ).watchHeldRecordingCards(t);
  ctx.after(() => again.dispose());
  const c = h.card("s-c");
  again.track(c.noticeId, c.holdId, c.action);
  h.recovery.discardRecovery();
  assert.equal(prompt(), null, "nothing held: the prompt leaves");
});

// Ratchet beside the executed tests above: the hook wires the watcher, and a
// card's Transcribe always names its hold.
test("useAudioRecording keys each held card's Transcribe to its hold and reconciles the cards", () => {
  const hook = fs.readFileSync(path.join(root, "src/hooks/useAudioRecording.js"), "utf8");
  assert.match(hook, /watchHeldRecordingCards\(t\)/);
  assert.match(hook, /heldCards\.dispose\(\);/, "unsubscribed in cleanup");
  assert.match(hook, /error\?\.recoveryId/);
  assert.match(hook, /transcribeRecovered\?\.\(\{ id \}\)/);
  assert.match(hook, /heldCards\.track\(/);
  const onError = hook.slice(hook.indexOf("onError: (error, onboardingTake, recording)"));
  assert.doesNotMatch(
    onError.slice(0, onError.indexOf("onNoAudio:")),
    /transcribeRecovered\?\.\(\)/,
    "a card never claims whichever hold is oldest"
  );
});
