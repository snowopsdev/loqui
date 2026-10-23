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
