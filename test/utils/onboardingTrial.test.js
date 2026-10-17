const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingTrial.ts");

async function play(events) {
  const { INITIAL_TRIAL_STATE, reduceTrial } = await load();
  return events.reduce(reduceTrial, INITIAL_TRIAL_STATE);
}

test("a first dictation goes from listening to words on screen", async () => {
  const { trialCaption } = await load();
  const listening = await play([{ status: "listening", atMs: 1000 }]);
  assert.equal(listening.phase, "recording");
  assert.equal(trialCaption(listening), "waiting");
  const state = await play([
    { status: "listening", atMs: 1000 },
    { status: "level", level: 0.002, atMs: 1080 },
    { status: "level", level: 0.08, atMs: 1160 },
    { status: "partial", text: "Remind me", atMs: 1400 },
    { status: "processing", atMs: 2000 },
    {
      status: "success",
      text: "Remind me to send the draft.",
      rawText: "um remind me to send the draft",
      cleanup: "applied",
      atMs: 2600,
    },
  ]);
  assert.equal(state.phase, "success");
  assert.equal(state.text, "Remind me to send the draft.");
  assert.equal(state.rawText, "um remind me to send the draft");
  assert.equal(state.cleanup, "applied");
  assert.equal(state.heardVoice, true);
  assert.equal(state.level, 0);
  assert.equal(state.successes, 1);
  assert.equal(trialCaption(state), "heard");
});

test("silence for 2.5 s suggests checking the microphone; a voice clears it", async () => {
  const { isSilent, reduceTrial } = await load();
  const quiet = await play([
    { status: "listening", atMs: 1000 },
    { status: "level", level: 0.003, atMs: 1100 },
  ]);
  assert.equal(isSilent(quiet, 3499), false);
  assert.equal(isSilent(quiet, 3500), true);
  const heard = reduceTrial(quiet, { status: "level", level: 0.05, atMs: 3600 });
  assert.equal(isSilent(heard, 9000), false);
});

test("errors are classified by code and keep their message", async () => {
  const { classifyTrialError } = await load();
  assert.equal(classifyTrialError("NotAllowedError"), "microphone");
  assert.equal(classifyTrialError("NotFoundError"), "microphone");
  assert.equal(classifyTrialError("NO_AUDIO"), "noAudio");
  assert.equal(classifyTrialError("INSUFFICIENT_MEMORY"), "memory");
  assert.equal(classifyTrialError(undefined), "other");
  const state = await play([
    { status: "listening", atMs: 0 },
    { status: "error", code: "NotAllowedError", message: "Permission denied", atMs: 5 },
  ]);
  assert.deepEqual(
    [state.phase, state.errorKind, state.errorMessage],
    ["error", "microphone", "Permission denied"]
  );
  const preListeningFailure = await play([
    { status: "error", code: "NotAllowedError", message: "Microphone unavailable", atMs: 1 },
  ]);
  assert.deepEqual(
    [preListeningFailure.phase, preListeningFailure.errorKind, preListeningFailure.errorMessage],
    ["error", "microphone", "Microphone unavailable"]
  );
});

test("an empty or blank success means nothing was heard, not a win", async () => {
  for (const text of ["", "   ", undefined]) {
    const state = await play([
      { status: "listening", atMs: 0 },
      { status: "success", text, atMs: 9 },
    ]);
    assert.equal(state.phase, "error", JSON.stringify(text));
    assert.equal(state.errorKind, "noAudio");
    assert.equal(state.successes, 0);
  }
});

test("a cancelled recording is discarded and stops the meter (spec §5.2 fallback)", async () => {
  const { trialCaption } = await load();
  const state = await play([
    { status: "listening", atMs: 0 },
    { status: "level", level: 0.4, atMs: 500 },
    { status: "cancelled", atMs: 1000 },
  ]);
  assert.deepEqual([state.phase, state.level, trialCaption(state)], ["cancelled", 0, "discarded"]);
});

test("a new take clears the last result but keeps the success count", async () => {
  const state = await play([
    { status: "listening", atMs: 0 },
    { status: "success", text: "One.", atMs: 5 },
    { status: "listening", atMs: 10 },
  ]);
  assert.deepEqual(
    [state.phase, state.text, state.rawText, state.cleanup, state.successes, state.takeId],
    ["recording", "", null, null, 1, 2]
  );
});

test("a cleanup retry applies only to the take it was started for (I08)", async () => {
  const { reduceTrial } = await load();
  const takeA = await play([
    { status: "listening", atMs: 0 },
    { status: "success", text: "um hi", rawText: "um hi", cleanup: "failed", atMs: 5 },
  ]);
  const running = reduceTrial(takeA, { status: "cleanupRetry", takeId: takeA.takeId, atMs: 6 });
  assert.equal(running.cleanupRetry, "running");
  const cleaned = reduceTrial(running, {
    status: "cleanupResult",
    takeId: takeA.takeId,
    text: "Hi.",
    atMs: 7,
  });
  assert.deepEqual(
    [cleaned.text, cleaned.cleanup, cleaned.cleanupRetry],
    ["Hi.", "applied", "idle"]
  );

  // Take B starts and succeeds before A's retry resolves: A's late result is dropped.
  let state = reduceTrial(running, { status: "listening", atMs: 8 });
  state = reduceTrial(state, {
    status: "success",
    text: "Take B.",
    rawText: "take b",
    cleanup: "skipped",
    atMs: 9,
  });
  const late = reduceTrial(state, {
    status: "cleanupResult",
    takeId: takeA.takeId,
    text: "Hi.",
    atMs: 10,
  });
  assert.equal(late, state);
  assert.equal(state.cleanupRetry, "idle", "a new take clears the retry state");

  const failed = reduceTrial(running, {
    status: "cleanupResult",
    takeId: takeA.takeId,
    text: null,
    atMs: 11,
  });
  assert.deepEqual([failed.text, failed.cleanupRetry], ["um hi", "failed"]);
});

test("out-of-phase and unknown events change nothing", async () => {
  const { INITIAL_TRIAL_STATE, reduceTrial } = await load();
  assert.equal(
    reduceTrial(INITIAL_TRIAL_STATE, { status: "level", level: 0.5, atMs: 0 }),
    INITIAL_TRIAL_STATE
  );
  assert.equal(
    reduceTrial(INITIAL_TRIAL_STATE, { status: "partial", text: "x", atMs: 0 }),
    INITIAL_TRIAL_STATE
  );
  assert.equal(
    reduceTrial(INITIAL_TRIAL_STATE, { status: "replying", atMs: 0 }),
    INITIAL_TRIAL_STATE
  );
  assert.equal(
    reduceTrial(INITIAL_TRIAL_STATE, { status: "cancelClosed", atMs: 0 }),
    INITIAL_TRIAL_STATE
  );
  const recording = await play([{ status: "listening", atMs: 0 }]);
  assert.equal(reduceTrial(recording, { status: "level", level: Number.NaN, atMs: 1 }), recording);
});
