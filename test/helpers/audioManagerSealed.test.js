const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");
const { admitStreamingTransportFixture } = require("./harness/streamingTransport");
const { fakePrivacy } = require("../hooks/fakePrivacy");

// Plan 07 Task 13: the real AudioManager, the real sealed store, the real
// recovery hold and Plan 04's real session/context factories. Only provider
// transports, persistence IPC and capture devices are fixtures.

const sealedError = (phase = "refused") =>
  Object.assign(
    new Error(
      phase === "interrupted"
        ? "[SEALED_MODE:interrupted] Sealed mode interrupted dictationStt to api.openai.com; the provider may have received part of the request."
        : "[SEALED_MODE] Sealed mode blocked dictationStt to api.openai.com before any socket opened; nothing was sent."
    ),
    { code: "SEALED_MODE" }
  );

const sessionSettings = {
  useLocalWhisper: false,
  localTranscriptionProvider: "nvidia",
  parakeetModel: "parakeet-tdt-0.6b-v3",
  cloudTranscriptionProvider: "openai",
  cloudTranscriptionModel: "whisper-1",
  transcriptionMode: "providers",
  cloudTranscriptionMode: "byok",
  useCleanupModel: false,
};

async function setup(t, settings = {}, mockModules = {}) {
  const loaded = await loadAudioManager(t, {
    cachePrefix: "loqui-audio-sealed-",
    settingsKey: "__audioSealedSettings",
    settings: { preferredLanguage: "en", ...sessionSettings, ...settings },
    mockModules,
  });
  const recovery = await loaded.vite.ssrLoadModule("/lib/sealedRecovery.ts");
  const store = await loaded.vite.ssrLoadModule("/stores/sealedStore.ts");
  const dictationSession = await loaded.vite.ssrLoadModule("/helpers/dictationSession.js");
  const { getSettings } = await loaded.vite.ssrLoadModule("/stores/settingsStore");
  store._resetSealedStoreForTests();
  recovery.discardRecovery();
  t.after(() => {
    recovery.discardRecovery();
    store._resetSealedStoreForTests();
  });
  const base = { preferredLanguage: "en", ...sessionSettings, ...settings };
  return {
    ...loaded,
    recovery,
    store,
    getSettings,
    retention: (value) => loaded.setSettings({ ...base, ...value }),
    ...dictationSession,
  };
}

// Production captures from the full live settings; so do these sessions.
const captured = (
  { captureDictationSession, getSettings },
  { privateTake = false, id, streaming = false } = {}
) =>
  captureDictationSession({
    settings: getSettings(),
    intents: { voiceAgentRequested: false, translationRequested: false, streaming },
    agentName: "Loqui",
    private: privateTake,
    id,
  });

function track(context) {
  const release = context.release.bind(context);
  let releaseCount = 0;
  context.release = () => {
    if (context.released) return;
    releaseCount++;
    release();
  };
  Object.defineProperty(context, "releaseCount", { get: () => releaseCount });
  return context;
}

function persistence(window, mode) {
  const counts = { rows: 0, audio: 0 };
  window.electronAPI.saveTranscription = async () => {
    counts.rows++;
    if (mode === "row-rejected") throw new Error("fixture row write rejected");
    return { id: "failed-row" };
  };
  window.electronAPI.saveTranscriptionAudio = async () => {
    counts.audio++;
    return { success: mode === "kept" };
  };
  return counts;
}

// A batch dictation whose speech request is refused by main's seal.
async function batchSealedFailure(fixtures, { retention, privateTake, mode, phase = "refused" }) {
  const { createManager, window } = fixtures;
  fixtures.retention(retention);
  const counts = persistence(window, mode);
  const errors = [];
  const completions = [];
  const audio = new Blob(["pcm"]);
  const selection = Promise.resolve({
    status: "selected",
    sessionId: "press",
    text: "press-time selection",
  });
  const screen = Promise.resolve({ data: "press-time screen", mediaType: "image/png" });
  const manager = createManager({
    isRecording: false,
    isProcessing: true,
    isStreaming: false,
    _localSpeechGateState: null,
    pendingCleanupFailure: null,
    pendingAssistantConversation: null,
    pendingSelectionEdit: null,
    processWithOpenAIAPI: async () => {
      throw sealedError(phase);
    },
    onError: (error) => errors.push(error),
    onTranscriptionComplete: (result) => completions.push(result),
    onStateChange() {},
  });
  manager.selectionCapturePromise = selection;
  manager.screenContextPromise = screen;
  const session = manager.beginDictationSession({}, captured(fixtures, { privateTake }));
  const context = track(manager._sessionContext);
  const tracker = manager._disclosure;
  manager._setOwnedAudio(audio, { sessionId: session.id, private: privateTake });
  const pipeline = manager._startProcessingPipeline();
  assert.equal(pipeline.context === context, true, "A9: the pipeline captured the live context");
  await manager.processAudio(audio, { durationSeconds: 2 }, pipeline);
  return {
    manager,
    errors,
    completions,
    counts,
    audio,
    session,
    context,
    tracker,
    selection,
    screen,
  };
}

for (const [label, retention, privateTake, held, mode] of [
  ["history off", { dataRetentionEnabled: false, audioRetentionDays: 30 }, false, true, "disabled"],
  [
    "audio retention 0",
    { dataRetentionEnabled: true, audioRetentionDays: 0 },
    false,
    true,
    "audio-zero",
  ],
  [
    "History acknowledged the audio",
    { dataRetentionEnabled: true, audioRetentionDays: 30 },
    false,
    false,
    "kept",
  ],
  [
    "audio write refused",
    { dataRetentionEnabled: true, audioRetentionDays: 30 },
    false,
    true,
    "audio-refused",
  ],
  [
    "row write rejected",
    { dataRetentionEnabled: true, audioRetentionDays: 30 },
    false,
    true,
    "row-rejected",
  ],
  [
    "private take with history on",
    { dataRetentionEnabled: true, audioRetentionDays: 30 },
    true,
    true,
    "private",
  ],
]) {
  test(`batch sealed failure, ${label}: held in memory = ${held}; History only on audioKept`, async (t) => {
    const fixtures = await setup(t);
    const r = await batchSealedFailure(fixtures, { retention, privateTake, mode });
    assert.equal(fixtures.recovery.recoveryCount(), held ? 1 : 0);
    assert.equal(r.completions.length, 0, "no empty success");
    const [error] = r.errors;
    assert.equal(error.code, "SEALED_MODE");
    assert.equal(error.recoveryHeld, held);
    assert.equal(
      error.messageKey,
      held ? "sealedMode.blocked.dictationHeld" : "sealedMode.blocked.dictationKept"
    );
    assert.equal(r.manager._activeSession ?? null, null, "the manager no longer owns the session");
    assert.equal(r.context.releaseCount, held ? 0 : 1, "held: still live; kept: closed once");
    assert.equal(
      r.counts.rows,
      ["disabled", "private"].includes(mode) ? 0 : 1,
      "one save, never two"
    );
    assert.equal(r.counts.audio, ["kept", "audio-refused"].includes(mode) ? 1 : 0);
    if (held) {
      const claim = fixtures.recovery.claimRecovery();
      assert.equal(claim.operation.owned.blob === r.audio, true, "the same bytes, not a copy");
      assert.equal(claim.operation.owned.private, privateTake);
      assert.equal(claim.operation.session === r.session, true, "Plan 04's own session object");
      assert.deepEqual(
        claim.operation.session.enterpriseRecipientTags,
        r.session.enterpriseRecipientTags
      );
      assert.equal(claim.operation.context === r.context, true);
      assert.equal(claim.operation.tracker === r.tracker, true, "the tracker moved with it");
      assert.equal(
        claim.operation.context.selection() === r.selection,
        true,
        "press-time selection kept"
      );
      assert.equal(claim.operation.context.screen() === r.screen, true);
      fixtures.recovery.releaseRecovery(claim.id, { done: false });
    }
  });
}

test("an interrupted batch request never says nothing was sent", async (t) => {
  const fixtures = await setup(t);
  const r = await batchSealedFailure(fixtures, {
    retention: { dataRetentionEnabled: false, audioRetentionDays: 0 },
    privateTake: false,
    mode: "disabled",
    phase: "interrupted",
  });
  assert.equal(r.errors[0].messageKey, "sealedMode.interrupted.dictationHeld");
  assert.equal(r.errors[0].phase, "interrupted");
});

test("a stale sealed callback never detaches or releases a newer session", async (t) => {
  const fixtures = await setup(t);
  const { createManager, createSessionContext, recovery } = fixtures;
  const manager = createManager();
  const oldSession = captured(fixtures, { id: "old" });
  const newer = captured(fixtures, { id: "new" });
  const newerContext = track(createSessionContext({ sessionId: newer.id }));
  manager.applySessionIntents(newer, { context: newerContext });
  const error = sealedError();
  const result = await manager._finishSealedFailure(error, {
    owned: Object.freeze({ blob: new Blob(["old"]), sessionId: oldSession.id, private: false }),
    session: oldSession,
  });
  assert.deepEqual(result, { recoveryHeld: false, audioKept: false });
  assert.equal(manager._activeSession === newer, true);
  assert.equal(manager._sessionContext === newerContext, true);
  assert.equal(newerContext.releaseCount, 0);
  assert.equal(recovery.recoveryCount(), 0);
});

function replayManager(createManager, transcribe, extra = {}) {
  const completions = [];
  const errors = [];
  const manager = createManager({
    isRecording: false,
    isProcessing: false,
    isStreaming: false,
    _startInProgress: false,
    _localSpeechGateState: null,
    pendingCleanupFailure: null,
    pendingAssistantConversation: null,
    pendingSelectionEdit: null,
    processWithOpenAIAPI: (...args) => transcribe(...args),
    onTranscriptionComplete: (result) => completions.push(result),
    onError: (error) => errors.push(error),
    onStateChange() {},
    ...extra,
  });
  return { manager, completions, errors };
}

function holdOne(fixtures, { id, privateTake = false, blob = new Blob(["pcm"]) } = {}) {
  const session = captured(fixtures, { id, privateTake });
  const context = track(
    fixtures.createSessionContext({
      sessionId: session.id,
      selection: Promise.resolve({
        status: "selected",
        sessionId: session.id,
        text: "press-time selection",
      }),
      screen: Promise.resolve({ data: `screen-${session.id}`, mediaType: "image/png" }),
    })
  );
  const holdId = fixtures.recovery.holdForRecovery(
    Object.freeze({
      owned: Object.freeze({
        blob,
        sessionId: session.id,
        private: privateTake,
        metadata: Object.freeze({ durationSeconds: 2 }),
      }),
      session,
      context,
      tracker: null,
    })
  );
  return { session, context, blob, holdId };
}

test("replay: a transcript removes the hold; the real pipeline ran on the same bytes and session", async (t) => {
  const fixtures = await setup(t);
  const { session, context, blob } = holdOne(fixtures, { id: "s-9" });
  const seen = [];
  const { manager, completions } = replayManager(
    fixtures.createManager,
    async (audio, metadata) => {
      seen.push([
        audio === blob,
        manager._activeSession === session,
        manager._sessionContext === context,
      ]);
      return { success: true, text: "hello" };
    }
  );
  assert.deepEqual(await manager.transcribeRecovered(), { started: true, succeeded: true });
  assert.deepEqual(seen, [[true, true, true]]);
  assert.equal(completions.at(-1)?.text, "hello");
  assert.equal(fixtures.recovery.recoveryCount(), 0);
  assert.equal(context.releaseCount, 1, "terminal success closes the context once");
  assert.equal(manager._activeSession ?? null, null);
});

test("a private replay keeps its original owner and privacy after a newer public take", async (t) => {
  const fixtures = await setup(t);
  const privateAudio = new Blob(["private-old"]);
  const { session: oldSession, context: oldContext } = holdOne(fixtures, {
    id: "private-old",
    privateTake: true,
    blob: privateAudio,
  });
  const { manager } = replayManager(fixtures.createManager, async (audio, metadata) => {
    assert.equal(audio === privateAudio, true);
    assert.equal(metadata.private, true);
    assert.equal(manager._activeSession === oldSession, true);
    assert.equal(manager.lastAudioBlobPrivate, true);
    return { success: true, text: "private transcript" };
  });
  const newer = captured(fixtures, { id: "public-new" });
  manager.beginDictationSession({}, newer);
  manager._endDictationSession(newer);
  manager._setOwnedAudio(new Blob(["public-new"]), { sessionId: newer.id, private: false });
  assert.deepEqual(await manager.transcribeRecovered(), { started: true, succeeded: true });
  assert.equal(oldContext.releaseCount, 1);
});

// Final review I2: Transcribe on a held take replays with that take's own
// recording context (privacy, no onboarding take), never the latest press's,
// so a private hold cannot reach History, paste or the clipboard. The newer
// press's context is back in place afterwards.
for (const [label, heldPrivate, newerPrivate] of [
  ["a private hold after a newer public press", true, false],
  ["a public hold after a newer private press", false, true],
])
  test(`Transcribe replays ${label} with the hold's own privacy`, async (t) => {
    const fixtures = await setup(t);
    const heldAudio = new Blob(["held"]);
    holdOne(fixtures, { id: "held", privateTake: heldPrivate, blob: heldAudio });
    const recordings = [];
    const { manager } = replayManager(
      fixtures.createManager,
      async () => ({ success: true, text: "held transcript" }),
      {
        onTranscriptionComplete: (_result, onboardingTake, recording) =>
          recordings.push({ onboardingTake, private: recording?.private }),
      }
    );
    const newer = captured(fixtures, { id: "newer", privateTake: newerPrivate });
    manager.beginDictationSession({}, newer);
    manager._endDictationSession(newer);
    const newerContext = { private: newerPrivate, sessionId: "newer" };
    manager._recordingContext = newerContext;
    manager._recordingPrivate = newerPrivate;
    manager._onboardingTake = newerPrivate ? { fixture: "onboarding" } : null;
    const newerTake = manager._onboardingTake;
    assert.deepEqual(await manager.transcribeRecovered(), { started: true, succeeded: true });
    assert.deepEqual(recordings, [{ onboardingTake: null, private: heldPrivate }]);
    assert.equal(manager._recordingContext === newerContext, true, "the newer press is restored");
    assert.equal(manager._recordingPrivate, newerPrivate);
    assert.equal(manager._onboardingTake === newerTake, true);
  });

test("the press-time context survives failed, sealed and cancelled replays, then closes once on success", async (t) => {
  const fixtures = await setup(t);
  const { session, context } = holdOne(fixtures, { id: "busy" });
  let transcribe = async () => {
    throw new Error("network down");
  };
  const { manager, errors } = replayManager(fixtures.createManager, (...args) =>
    transcribe(...args)
  );
  fixtures.window.electronAPI.saveTranscription = async () => {
    throw new Error("a replay must not persist again");
  };

  assert.deepEqual(await manager.transcribeRecovered(), { started: true, succeeded: false });
  assert.equal(fixtures.recovery.recoveryCount(), 1, "a non-sealed failure unclaims the same hold");
  assert.equal(context.releaseCount, 0);
  assert.equal((await context.selection()).text, "press-time selection");

  transcribe = async () => {
    throw sealedError();
  };
  await manager.transcribeRecovered();
  assert.equal(
    fixtures.recovery.recoveryCount(),
    1,
    "a sealed re-failure creates no duplicate hold"
  );
  assert.equal(errors.at(-1).recoveryHeld, true);
  assert.equal(errors.at(-1).messageKey, "sealedMode.blocked.dictationHeld");
  assert.equal(context.releaseCount, 0);

  let started;
  const requestStarted = new Promise((resolve) => (started = resolve));
  let rejectRequest;
  transcribe = () => {
    started();
    return new Promise((_resolve, reject) => (rejectRequest = reject));
  };
  const cancelled = manager.transcribeRecovered();
  await requestStarted;
  assert.equal(manager.cancelProcessing(), true);
  assert.equal(manager._undo?.peek?.() ?? null, null, "no ordinary Undo hold for a replay");
  rejectRequest(Object.assign(new Error("cancelled"), { code: "TRANSCRIPTION_CANCELLED" }));
  assert.deepEqual(await cancelled, { started: true, succeeded: false });
  assert.equal(fixtures.recovery.recoveryCount(), 1, "the claimed entry returns for retry");
  assert.equal(context.releaseCount, 0);

  transcribe = async () => {
    assert.equal(manager._sessionContext === context, true, "retry attaches the original context");
    assert.equal(manager._activeSession === session, true);
    return { success: true, text: "recovered" };
  };
  assert.deepEqual(await manager.transcribeRecovered(), { started: true, succeeded: true });
  assert.equal(fixtures.recovery.recoveryCount(), 0);
  assert.equal(context.releaseCount, 1);
  assert.equal(context.selection(), null);
});

test("replay: refused while busy, and only one replay at a time", async (t) => {
  const fixtures = await setup(t);
  holdOne(fixtures, { id: "one" });
  let release;
  const { manager } = replayManager(
    fixtures.createManager,
    () => new Promise((r) => (release = () => r({ success: true, text: "x" })))
  );
  manager.isRecording = true;
  assert.deepEqual(await manager.transcribeRecovered(), { started: false, reason: "busy" });
  manager.isRecording = false;
  const first = manager.transcribeRecovered();
  assert.deepEqual(await manager.transcribeRecovered(), { started: false, reason: "busy" });
  await new Promise((r) => setImmediate(r));
  release();
  assert.equal((await first).succeeded, true);
  assert.equal(fixtures.recovery.recoveryCount(), 0);
});

test("replay while still sealed for that route is not attempted; the hold stays", async (t) => {
  const fixtures = await setup(t);
  const { context } = holdOne(fixtures, { id: "still-sealed" });
  fixtures.store.useSealedStore.setState({ sealed: true, known: true });
  let calls = 0;
  const { manager, errors } = replayManager(fixtures.createManager, async () => {
    calls++;
    return { success: true, text: "no" };
  });
  assert.deepEqual(await manager.transcribeRecovered(), { started: false, reason: "sealed" });
  assert.equal(calls, 0, "nothing was sent to be refused again");
  // Fix round 1, M1: the recording exists and is still held, so the pre-flight's
  // "Nothing was recorded" would be false here.
  assert.equal(errors[0].code, "SEALED_MODE");
  assert.equal(errors[0].titleKey, "sealedMode.recovery.stillSealedTitle");
  assert.equal(errors[0].messageKey, "sealedMode.recovery.stillSealedDetail");
  assert.equal(errors[0].variant, "default", "information, not a new failure");
  const en = require("../../src/locales/en/translation.json").sealedMode.recovery;
  assert.doesNotMatch(en.stillSealedDetail, /nothing was recorded/i);
  assert.match(en.stillSealedDetail, /memory/i);
  assert.equal(fixtures.recovery.recoveryCount(), 1);
  assert.equal(context.releaseCount, 0, "the hold keeps its press-time reads");
});

// Fix round 1, M7: a replay that throws before its pipeline exists hands the
// exact session and context back to the claimed entry; nothing is released.
for (const [label, breakAt] of [
  ["applySessionIntents throws after attaching", "apply-after"],
  ["applySessionIntents throws before attaching", "apply-before"],
  ["_setOwnedAudio throws", "owned"],
  ["_startProcessingPipeline throws", "pipeline"],
]) {
  test(`replay: ${label} before the pipeline exists; the hold keeps its own session and context`, async (t) => {
    const fixtures = await setup(t);
    const { session, context, blob } = holdOne(fixtures, { id: `early-${breakAt}` });
    const { manager } = replayManager(fixtures.createManager, async () => ({
      success: true,
      text: "recovered",
    }));
    const restore = {};
    const boom = () => {
      throw new Error(`fixture: ${breakAt}`);
    };
    const patch = (name, fn) => {
      restore[name] = manager[name];
      manager[name] = fn;
    };
    if (breakAt === "apply-after")
      patch("applySessionIntents", function (...args) {
        restore.applySessionIntents.apply(this, args);
        boom();
      });
    if (breakAt === "apply-before") patch("applySessionIntents", boom);
    if (breakAt === "owned") patch("_setOwnedAudio", boom);
    if (breakAt === "pipeline") patch("_startProcessingPipeline", boom);
    await assert.rejects(manager.transcribeRecovered(), new RegExp(breakAt));
    assert.equal(manager._activeSession ?? null, null, "the manager gave the session back");
    assert.equal(manager._sessionContext === context, false);
    assert.equal(manager._recoveryReplay ?? null, null);
    assert.equal(context.releaseCount, 0, "the hold's context was not released");
    assert.equal(fixtures.recovery.recoveryCount(), 1, "the entry is unclaimed for another try");
    if (manager.lastAudioBlob === blob) assert.fail("the manager kept the held bytes");
    // A later dictation must not release the hold's reads (the M7 failure).
    const newer = manager.beginDictationSession({}, captured(fixtures, { id: "newer" }));
    manager._endDictationSession(newer);
    assert.equal(context.releaseCount, 0, "a newer session never releases the held context");
    for (const [name, fn] of Object.entries(restore)) manager[name] = fn;
    const seen = [];
    manager.processWithOpenAIAPI = async (audio) => {
      seen.push([
        audio === blob,
        manager._activeSession === session,
        manager._sessionContext === context,
      ]);
      return { success: true, text: "recovered" };
    };
    assert.deepEqual(await manager.transcribeRecovered(), { started: true, succeeded: true });
    assert.deepEqual(seen, [[true, true, true]], "the retry attached the very same objects");
    assert.equal(context.releaseCount, 1, "closed exactly once, on success");
  });
}

// Fix round 1, M2: a fourth hold drops the oldest, and the user is told so.
test("a fourth sealed hold says the oldest held recording was discarded", async (t) => {
  const fixtures = await setup(t);
  const older = [1, 2, 3].map((n) => holdOne(fixtures, { id: `older-${n}` }));
  const r = await batchSealedFailure(fixtures, {
    retention: { dataRetentionEnabled: false, audioRetentionDays: 30 },
    privateTake: false,
    mode: "disabled",
  });
  const [error] = r.errors;
  assert.equal(error.recoveryHeld, true);
  assert.equal(error.recoveryEvicted, 1);
  assert.equal(older[0].context.releaseCount, 1, "the oldest hold was closed once");
  assert.equal(older[1].context.releaseCount, 0);
  assert.equal(fixtures.recovery.recoveryCount(), fixtures.recovery.RECOVERY_MAX);
  const { getRecordingErrorDescription } = await fixtures.vite.ssrLoadModule(
    "/utils/recordingErrors.ts"
  );
  const text = getRecordingErrorDescription(error, (key) => `t:${key}`);
  assert.match(text, /t:sealedMode\.blocked\.dictationHeld/);
  assert.match(text, /t:sealedMode\.recovery\.evictedOldest/);
  const plain = getRecordingErrorDescription({ ...error, recoveryEvicted: 0 }, (k) => `t:${k}`);
  assert.doesNotMatch(plain, /evictedOldest/);
});

// Task 13 fix round 2, N2: each held card names its hold; its Transcribe
// replays that recording or nothing, never the oldest or another one.
test("N2: a sealed failure names its hold, and a replay's re-failure names the same one", async (t) => {
  const fixtures = await setup(t);
  const r = await batchSealedFailure(fixtures, {
    retention: { dataRetentionEnabled: false, audioRetentionDays: 30 },
    privateTake: false,
    mode: "disabled",
  });
  const [error] = r.errors;
  assert.equal(error.recoveryHeld, true);
  assert.equal(typeof error.recoveryId, "number");
  assert.equal(fixtures.recovery.recoveryStatus(error.recoveryId), "held");
  const { manager, errors } = replayManager(fixtures.createManager, async () => {
    throw sealedError();
  });
  assert.deepEqual(await manager.transcribeRecovered({ id: error.recoveryId }), {
    started: true,
    succeeded: false,
  });
  assert.equal(errors.at(-1).recoveryHeld, true);
  assert.equal(errors.at(-1).recoveryId, error.recoveryId, "the same hold, still held");
  assert.equal(fixtures.recovery.recoveryStatus(error.recoveryId), "held");
});

test("N2: Transcribe on a card replays that card's own recording, never the oldest or another", async (t) => {
  const fixtures = await setup(t);
  const older = holdOne(fixtures, { id: "older", blob: new Blob(["older"]) });
  const mine = holdOne(fixtures, { id: "mine", blob: new Blob(["mine"]) });
  const seen = [];
  const { manager } = replayManager(fixtures.createManager, async (audio) => {
    seen.push(audio === mine.blob ? "mine" : audio === older.blob ? "older" : "another recording");
    return { success: true, text: "recovered" };
  });
  assert.deepEqual(await manager.transcribeRecovered({ id: mine.holdId }), {
    started: true,
    succeeded: true,
  });
  assert.deepEqual(seen, ["mine"]);
  assert.equal(mine.context.releaseCount, 1);
  assert.equal(fixtures.recovery.recoveryStatus(older.holdId), "held", "the oldest is untouched");
  assert.equal(older.context.releaseCount, 0);

  // Its hold is gone: the click transcribes nothing, and never another recording.
  assert.deepEqual(await manager.transcribeRecovered({ id: mine.holdId }), {
    started: false,
    reason: "gone",
  });
  const evictors = [1, 2, 3].map((n) => holdOne(fixtures, { id: `newer-${n}` }));
  assert.equal(fixtures.recovery.recoveryStatus(older.holdId), "evicted");
  assert.deepEqual(await manager.transcribeRecovered({ id: older.holdId }), {
    started: false,
    reason: "gone",
  });
  assert.deepEqual(seen, ["mine"], "nothing else was transcribed");
  for (const { holdId } of evictors) assert.equal(fixtures.recovery.recoveryStatus(holdId), "held");
  // Callers without an id (the unseal notice's "Transcribe recordings") keep
  // the oldest-first order.
  assert.deepEqual(await manager.transcribeRecovered(), { started: true, succeeded: true });
  assert.equal(fixtures.recovery.recoveryStatus(evictors[0].holdId), "transcribed");
});

// Task 13 fix round 2, N4: a replay that runs past its hold's 30 minutes and
// then fails must not say that the audio is still held.
test("N4: a replay that outlives its hold and then fails sealed says the recording wasn't kept", async (t) => {
  const fixtures = await setup(t);
  const realSetTimeout = globalThis.setTimeout;
  t.after(() => (globalThis.setTimeout = realSetTimeout));
  let expireHold = null;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms !== fixtures.recovery.RECOVERY_TTL_MS) return realSetTimeout(fn, ms, ...rest);
    expireHold = fn; // the hold's own 30-minute timer, fired by hand below
    return realSetTimeout(() => {}, 0);
  };
  const hold = holdOne(fixtures, { id: "outlived" });
  globalThis.setTimeout = realSetTimeout;
  assert.equal(typeof expireHold, "function");
  const { manager, errors } = replayManager(fixtures.createManager, async () => {
    expireHold(); // 30 minutes pass while the provider is still answering
    throw sealedError();
  });
  assert.deepEqual(await manager.transcribeRecovered({ id: hold.holdId }), {
    started: true,
    succeeded: false,
  });
  const error = errors.at(-1);
  assert.equal(error.code, "SEALED_MODE");
  assert.equal(error.recoveryHeld, false, "nothing is held any more");
  assert.equal(error.recoveryId ?? null, null, "no card may offer Transcribe for it");
  assert.equal(error.messageKey, "sealedMode.blocked.dictationNotKept");
  assert.equal(error.recoveryExpired, true);
  const { getRecordingErrorDescription } = await fixtures.vite.ssrLoadModule(
    "/utils/recordingErrors.ts"
  );
  const text = getRecordingErrorDescription(error, (key) => `t:${key}`);
  assert.doesNotMatch(text, /dictationHeld/);
  assert.match(text, /t:sealedMode\.recovery\.expiredDuringReplay/);
  assert.equal(fixtures.recovery.recoveryCount(), 0);
  assert.equal(fixtures.recovery.recoveryStatus(hold.holdId), "expired");
  assert.equal(hold.context.releaseCount, 1, "closed once, on hand-back");
});

function streamingManager(fixtures, { stop, privateTake = false, partial = "" }) {
  const { createManager } = fixtures;
  const audio = new Blob(["fallback-pcm"]);
  const completions = [];
  const errors = [];
  const manager = createManager({
    isRecording: true,
    isProcessing: false,
    isStreaming: true,
    _streamingCancellationGeneration: 0,
    _streamingSessionGeneration: 3,
    _activeStreamingSessionId: 3,
    _streamingMicSwapPromise: null,
    _activeTranscriptionAbortController: null,
    recordingStartTime: Date.now() - 3000,
    micRecovery: { stop() {} },
    streamingProcessor: null,
    streamingSource: null,
    streamingStream: null,
    streamingFallbackRecorder: null,
    streamingFallbackChunks: [],
    _streamingFallbackSegments: [audio],
    streamingFinalText: "",
    streamingPartialText: partial,
    streamingCleanupFns: [],
    pendingAssistantConversation: null,
    pendingSelectionEdit: null,
    pendingCleanupFailure: null,
    finishStreamingFallbackSegment: async () => null,
    mergeRecordedSegments: async () => audio,
    awaitStreamingTextSettled: async () => {},
    getStreamingProvider: () => ({ awaitsFinalTranscript: true, finalize() {}, stop }),
    getStreamingProviderName: () => "deepgram",
    shouldUseStreaming: () => false,
    processTranscription: async (text) => text,
    onStateChange() {},
    onError: (error) => errors.push(error),
    onTranscriptionComplete: (result) => completions.push(result),
  });
  const session = manager.beginDictationSession(
    {},
    captured(fixtures, { privateTake, streaming: true, id: "stream" })
  );
  manager._recordingContext = { private: privateTake, sessionId: session.id };
  manager._streamingOperation = Object.freeze({ correlationId: session.id, operationId: "op-1" });
  admitStreamingTransportFixture(manager);
  const context = track(manager._sessionContext);
  return { manager, audio, completions, errors, session, context };
}

for (const [label, retention, held, mode] of [
  ["history off", { dataRetentionEnabled: false, audioRetentionDays: 30 }, true, "disabled"],
  [
    "History acknowledged the audio",
    { dataRetentionEnabled: true, audioRetentionDays: 30 },
    false,
    "kept",
  ],
  [
    "row saved, audio refused",
    { dataRetentionEnabled: true, audioRetentionDays: 30 },
    true,
    "audio-refused",
  ],
]) {
  test(`streaming: main's typed sealed stop with no text (${label}) keeps the audio, never an empty success`, async (t) => {
    const fixtures = await setup(t);
    fixtures.retention(retention);
    const counts = persistence(fixtures.window, mode);
    const s = streamingManager(fixtures, {
      // T9a-M1: main now resolves a typed failure for a seal before the first frame.
      stop: async () => ({
        success: false,
        text: "",
        code: "SEALED_MODE",
        phase: "interrupted",
        messageKey: "sealedMode.interrupted.generic",
        error:
          "[SEALED_MODE:interrupted] Sealed mode interrupted dictationStt; the provider may have received part of the request.",
      }),
    });
    assert.equal(await s.manager._finalizeStreamingRecording(3), true);
    assert.deepEqual(s.completions, [], "no empty success");
    const [error] = s.errors;
    assert.equal(error.code, "SEALED_MODE");
    assert.equal(error.phase, "interrupted");
    assert.equal(error.recoveryHeld, held);
    assert.equal(
      error.messageKey,
      held ? "sealedMode.interrupted.dictationHeld" : "sealedMode.interrupted.dictationKept"
    );
    assert.equal(fixtures.recovery.recoveryCount(), held ? 1 : 0);
    assert.equal(counts.rows, mode === "disabled" ? 0 : 1);
    if (held) {
      const claim = fixtures.recovery.claimRecovery();
      assert.equal(claim.operation.owned.blob === s.audio, true, "the owner-stamped fallback Blob");
      assert.equal(claim.operation.session === s.session, true);
      assert.equal(claim.operation.context === s.context, true);
      fixtures.recovery.releaseRecovery(claim.id, { done: false });
    } else assert.equal(s.context.releaseCount, 1);
  });
}

test("streaming: a rejected stop keeps its typed sealed error", async (t) => {
  const fixtures = await setup(t);
  fixtures.retention({ dataRetentionEnabled: false, audioRetentionDays: 0 });
  const s = streamingManager(fixtures, {
    stop: async () => {
      throw sealedError("interrupted");
    },
  });
  assert.equal(await s.manager._finalizeStreamingRecording(3), true);
  assert.equal(s.errors[0].phase, "interrupted");
  assert.equal(s.errors[0].recoveryHeld, true);
  assert.deepEqual(s.completions, []);
});

test("streaming: a seal broadcast during finalization, with an untyped empty stop, is still a sealed failure", async (t) => {
  const fixtures = await setup(t);
  fixtures.retention({ dataRetentionEnabled: false, audioRetentionDays: 0 });
  const listeners = {};
  fixtures.window.electronAPI.privacy = {
    getSealed: () => new Promise(() => {}),
    onSealedChange: (cb) => (listeners.sealed = cb),
  };
  const s = streamingManager(fixtures, {
    stop: async () => {
      listeners.sealed(true); // main broadcasts the seal while the stop is pending
      return { success: true, text: "" };
    },
  });
  assert.equal(await s.manager._finalizeStreamingRecording(3), true);
  assert.deepEqual(s.completions, []);
  assert.equal(s.errors[0].code, "SEALED_MODE");
  assert.equal(
    s.errors[0].phase,
    "interrupted",
    "an untyped cut-off never claims nothing was sent"
  );
  assert.equal(fixtures.recovery.recoveryCount(), 1);
});

test("streaming: words that arrived before the seal are kept, with interrupted copy", async (t) => {
  const fixtures = await setup(t);
  const s = streamingManager(fixtures, {
    partial: "words before the seal",
    stop: async () => ({ success: false, text: "", code: "SEALED_MODE", phase: "interrupted" }),
  });
  assert.equal(await s.manager._finalizeStreamingRecording(3), true);
  assert.equal(s.completions.at(-1).text, "words before the seal");
  assert.equal(s.errors[0].messageKey, "sealedMode.interrupted.dictationPartial");
  assert.equal(fixtures.recovery.recoveryCount(), 0);
});

test("streaming: an ordinary successful stop retains stop-result text and model", async (t) => {
  const fixtures = await setup(t);
  const s = streamingManager(fixtures, {
    stop: async () => ({
      success: true,
      text: "text only in stop result",
      model: "fixture-stop-model",
    }),
  });
  assert.equal(await s.manager._finalizeStreamingRecording(3), true);
  assert.equal(s.completions.at(-1).text, "text only in stop result");
  assert.equal(s.manager.lastAudioMetadata.model, "fixture-stop-model");
  assert.deepEqual(s.errors, []);
});

function startManager(fixtures) {
  const opened = [];
  const errors = [];
  const manager = fixtures.createManager({
    isRecording: false,
    isProcessing: false,
    isStreaming: false,
    _startInProgress: false,
    _streamingStopPromise: null,
    mediaRecorder: null,
    preparedMicCapture: {
      take: async () => {
        opened.push("prepared");
        return null;
      },
      prepare: async () => {
        opened.push("prepare");
        return null;
      },
      cancel() {},
    },
    getAudioConstraints: async () => {
      opened.push("constraints");
      return {};
    },
    _startPcmTap: () => {
      opened.push("tap");
      return null;
    },
    _acquireCaptureStream: async () => {
      opened.push("mic");
      throw new Error("mic opened");
    },
    onError: (error) => errors.push(error),
  });
  return { manager, opened, errors };
}

test("pre-flight: a remote speech route while sealed refuses before the microphone is prepared or opened", async (t) => {
  const fixtures = await setup(t);
  fixtures.store.useSealedStore.setState({ sealed: true, known: true });
  const { manager, opened, errors } = startManager(fixtures);
  assert.equal(await manager.prepareMicCapture(), null);
  assert.equal(await manager.startRecording(), false);
  assert.deepEqual(opened, [], "nothing about the microphone was touched");
  assert.equal(errors[0].code, "SEALED_MODE");
  assert.equal(errors[0].titleKey, "sealedMode.blocked.dictationPreflight");
  assert.equal(errors[0].messageKey, "sealedMode.blocked.dictationPreflightDetail");
  assert.equal(errors[0].variant, "default");
  const streaming = startManager(fixtures);
  assert.equal(await streaming.manager.startStreamingRecording(), false);
  assert.deepEqual(streaming.opened, []);
  assert.equal(streaming.errors[0].titleKey, "sealedMode.blocked.dictationPreflight");
});

test("pre-flight: a built-in local engine while sealed is unavailable in 07a; nothing is opened", async (t) => {
  const fixtures = await setup(t, {
    transcriptionMode: "local",
    useLocalWhisper: true,
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
  });
  // Fix round 1, I1: with no attestation from main yet, the engine still does
  // not start, and the copy claims nothing about this build.
  fixtures.store.useSealedStore.setState({ sealed: true, known: true });
  const unconfirmed = startManager(fixtures);
  assert.equal(await unconfirmed.manager.startRecording(), false);
  assert.deepEqual(unconfirmed.opened, []);
  assert.equal(unconfirmed.errors[0].titleKey, "sealedMode.blocked.nativeUnconfirmedTitle");
  assert.equal(unconfirmed.errors[0].messageKey, "sealedMode.blocked.nativeUnconfirmedDetail");
  // Main's 07a attestation: local engines are unavailable on this build.
  fixtures.window.electronAPI.privacy = fakePrivacy({ sealed: true }).api;
  await fixtures.store.setSealedMode(true);
  assert.equal(fixtures.store.getSealedSnapshot().attestation?.isolation.selfTest, "unavailable");
  const { manager, opened, errors } = startManager(fixtures);
  assert.equal(await manager.startRecording(), false);
  assert.deepEqual(opened, []);
  assert.equal(errors[0].titleKey, "sealedMode.blocked.nativeUnavailableTitle");
  assert.equal(errors[0].messageKey, "sealedMode.blocked.nativeUnavailableDetail");
});

test("pre-flight: an unknown seal never blocks; an open seal never blocks", async (t) => {
  const fixtures = await setup(t);
  for (const state of [
    { sealed: false, known: false },
    { sealed: false, known: true },
  ]) {
    fixtures.store.useSealedStore.setState(state);
    const { manager, opened, errors } = startManager(fixtures);
    await manager.startRecording().catch(() => {});
    assert.ok(opened.length > 0, "recording proceeds to the microphone");
    assert.equal(
      errors.some((e) => e?.code === "SEALED_MODE"),
      false
    );
  }
});

test("a refused cleanup after local speech-to-text keeps the local transcript", async (t) => {
  const fixtures = await setup(t, {
    useCleanupModel: true,
    useDictationAgent: false,
    useDictationTranslation: false,
  });
  const manager = fixtures.createManager({
    voiceAgentRequested: false,
    translationRequested: false,
    pendingCleanupFailure: null,
    pendingAssistantConversation: null,
    pendingSelectionEdit: null,
    isReasoningAvailable: async () => true,
    processWithReasoningModel: async () => {
      throw sealedError();
    },
  });
  assert.equal(
    await manager.processTranscriptionCore("original dictation", "local"),
    "original dictation"
  );
});
