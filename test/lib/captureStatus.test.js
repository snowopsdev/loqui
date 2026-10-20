const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/lib/captureStatus.ts");
const idleMeeting = { isRecording: false, startedAt: null, micCaptureStatus: "inactive" };
const facts = (over = {}) => ({
  dictationState: "idle",
  dictationInputKind: "dictation",
  dictationStartedAt: null,
  meeting: idleMeeting,
  micGranted: true,
  ...over,
});

test("idle is Ready", async () => {
  const { resolveCaptureStatus } = await load();
  assert.deepEqual(resolveCaptureStatus(facts()), {
    kind: "ready",
    source: null,
    startedAt: null,
    offlineReason: null,
    inputKind: null,
  });
});

test("dictation recording maps known and unknown input kinds", async () => {
  const { resolveCaptureStatus } = await load();
  assert.deepEqual(
    resolveCaptureStatus(facts({ dictationState: "recording", dictationStartedAt: 1000 })),
    {
      kind: "listening",
      source: "dictation",
      startedAt: 1000,
      offlineReason: null,
      inputKind: "dictation",
    }
  );
  assert.equal(
    resolveCaptureStatus(facts({ dictationState: "recording", dictationInputKind: "assistant" }))
      .inputKind,
    "assistant"
  );
  assert.equal(
    resolveCaptureStatus(facts({ dictationState: "recording", dictationInputKind: "future" }))
      .inputKind,
    "dictation"
  );
});

test("meeting recording is Listening from the meeting start", async () => {
  const { resolveCaptureStatus } = await load();
  const status = resolveCaptureStatus(
    facts({ meeting: { isRecording: true, startedAt: 500, micCaptureStatus: "active" } })
  );
  assert.deepEqual(status, {
    kind: "listening",
    source: "meeting",
    startedAt: 500,
    offlineReason: null,
    inputKind: null,
  });
});

test("processing, mic loss, permission and unknown states follow precedence", async () => {
  const { resolveCaptureStatus } = await load();
  assert.equal(resolveCaptureStatus(facts({ dictationState: "processing" })).kind, "processing");
  for (const micCaptureStatus of ["unavailable", "reconnecting"]) {
    assert.deepEqual(
      resolveCaptureStatus(
        facts({
          dictationState: "recording",
          meeting: { isRecording: true, startedAt: 1, micCaptureStatus },
        })
      ),
      {
        kind: "offline",
        source: "meeting",
        startedAt: null,
        offlineReason: "device",
        inputKind: null,
      }
    );
  }
  assert.deepEqual(resolveCaptureStatus(facts({ micGranted: false })), {
    kind: "offline",
    source: null,
    startedAt: null,
    offlineReason: "permission",
    inputKind: null,
  });
  assert.equal(resolveCaptureStatus(facts({ micGranted: null })).kind, "ready");
  for (const dictationState of ["preparing", "cancelled", "somethingNew", null]) {
    assert.equal(
      resolveCaptureStatus(facts({ dictationState })).kind,
      "ready",
      String(dictationState)
    );
  }
  assert.equal(
    resolveCaptureStatus(facts({ dictationState: "unknown", dictationInputKind: "assistant" }))
      .kind,
    "ready"
  );
});

test("dictation start clock preserves recording and clears outside recording", async () => {
  const { nextDictationStartedAt } = await load();
  assert.equal(nextDictationStartedAt("idle", null, "recording", 42), 42);
  assert.equal(nextDictationStartedAt("recording", 42, "recording", 99), 42);
  assert.equal(nextDictationStartedAt("recording", 42, "processing", 99), null);
});

test("elapsed formatting handles minutes, hours and invalid values", async () => {
  const { formatElapsed } = await load();
  assert.equal(formatElapsed(7_400), "0:07");
  assert.equal(formatElapsed(760_000), "12:40");
  assert.equal(formatElapsed(3_723_000), "1:02:03");
  for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(formatElapsed(bad), "0:00");
});

test("route IDs describe selected category from capture lifecycle", async () => {
  const { resolveCaptureStatus, captureRouteIds } = await load();
  const meeting = resolveCaptureStatus(
    facts({ meeting: { isRecording: true, startedAt: 1, micCaptureStatus: "active" } })
  );
  assert.deepEqual(captureRouteIds(meeting), {
    role: "meeting",
    speech: "noteRecordingStt",
    text: null,
  });
  const assistant = resolveCaptureStatus(
    facts({ dictationState: "recording", dictationInputKind: "assistant" })
  );
  assert.deepEqual(captureRouteIds(assistant), {
    role: "assistant",
    speech: "dictationStt",
    text: "voiceAssistant",
  });
  const translation = resolveCaptureStatus(
    facts({ dictationState: "processing", dictationInputKind: "translation" })
  );
  assert.deepEqual(captureRouteIds(translation), {
    role: "translation",
    speech: "dictationStt",
    text: "translation",
  });
  assert.deepEqual(captureRouteIds(resolveCaptureStatus(facts())), {
    role: "dictation",
    speech: "dictationStt",
    text: null,
  });
});

test("rail smoothing attacks quickly, releases slowly, and clamps input", async () => {
  const { railLevelStep } = await load();
  assert.ok(railLevelStep(0, 1) > 0.6 && railLevelStep(0, 1) < 0.7);
  assert.ok(railLevelStep(1, 0) > 0.7 && railLevelStep(1, 0) < 0.8);
  assert.equal(railLevelStep(Number.NaN, 0.5), railLevelStep(0, 0.5));
  assert.equal(railLevelStep(0, 3), 0.65);
});
