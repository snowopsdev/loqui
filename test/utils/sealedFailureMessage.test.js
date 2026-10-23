const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// Final review I6: main's raw text, with its English [SEALED_MODE…] marker,
// must never reach a download, import or Codex surface. Each surface checks
// sealedFailureMessage first and shows the translated generic copy, by phase:
// "nothing was sent" only for a refusal; an interruption, or a code with no
// phase, says the provider may have received part of it.

const root = path.join(__dirname, "../..");
const t = (key, params) => (params ? `t:${key}${JSON.stringify(params)}` : `t:${key}`);
const REFUSED =
  "[SEALED_MODE] Sealed mode blocked modelDownload to huggingface.co before any socket opened; nothing was sent.";
const INTERRUPTED = "[SEALED_MODE:interrupted] Sealed mode stopped modelDownload mid-transfer";

test("sealedFailureMessage: translated generic copy by phase, null for anything else", async () => {
  const { sealedFailureMessage } = await import("../../src/utils/sealedModeError.ts");
  const blocked = "t:sealedMode.blocked.generic";
  const interrupted = "t:sealedMode.interrupted.generic";
  assert.equal(sealedFailureMessage(new Error(REFUSED), t), blocked);
  assert.equal(
    sealedFailureMessage(new Error(`Error invoking remote method 'x': Error: ${REFUSED}`), t),
    blocked
  );
  assert.equal(sealedFailureMessage(new Error(INTERRUPTED), t), interrupted);
  // Result envelopes (main's sealedEnvelope) carry code and phase.
  assert.equal(
    sealedFailureMessage({ success: false, error: "x", code: "SEALED_MODE", phase: "refused" }, t),
    blocked
  );
  assert.equal(
    sealedFailureMessage(
      { success: false, error: "x", code: "SEALED_MODE", phase: "interrupted" },
      t
    ),
    interrupted
  );
  // A code with no phase is never "nothing was sent" (T18-06).
  assert.equal(sealedFailureMessage({ code: "SEALED_MODE" }, t), interrupted);
  // A progress event: { error, code } with the marker in the text.
  assert.equal(sealedFailureMessage({ error: REFUSED, code: "DOWNLOAD_FAILED" }, t), blocked);
  for (const other of [
    null,
    undefined,
    "boom",
    new Error("HTTP 503"),
    { success: false, error: "Invalid URL", code: "INVALID_URL" },
  ])
    assert.equal(sealedFailureMessage(other, t), null, String(other?.error ?? other));
});

test("model downloads: a sealed failure is translated copy, never 'Download failed: [SEALED_MODE]…'", async () => {
  const { getDownloadErrorMessage } = await import("../../src/utils/modelDownloadErrorMessage.ts");
  const refused = getDownloadErrorMessage(t, REFUSED, "SEALED_MODE");
  assert.equal(refused, "t:sealedMode.blocked.generic");
  // The progress event's code is often generic; the marker still decides.
  assert.equal(
    getDownloadErrorMessage(t, REFUSED, "DOWNLOAD_FAILED"),
    "t:sealedMode.blocked.generic"
  );
  assert.equal(
    getDownloadErrorMessage(t, INTERRUPTED, "SEALED_MODE"),
    "t:sealedMode.interrupted.generic"
  );
  assert.equal(
    getDownloadErrorMessage(t, "x", "SEALED_MODE", "interrupted"),
    "t:sealedMode.interrupted.generic"
  );
  for (const text of [refused]) assert.doesNotMatch(text, /\[SEALED_MODE|nothing was sent/);
  // Other failures keep their existing mapping.
  assert.equal(
    getDownloadErrorMessage(t, "HTTP 503 Service Unavailable"),
    't:hooks.modelDownload.errors.server{"error":"HTTP 503 Service Unavailable"}'
  );
  assert.equal(
    getDownloadErrorMessage(t, "x", "TLS_ERROR"),
    "t:hooks.modelDownload.errors.tlsError"
  );
  assert.equal(
    getDownloadErrorMessage(t, "weird"),
    't:hooks.modelDownload.errors.generic{"error":"weird"}'
  );
});

test("URL import: a sealed failure is a translated key, in the single view and the batch queue", async () => {
  const { urlDownloadErrorKey, queueErrorText } =
    await import("../../src/components/notes/shared.ts");
  const refused = { success: false, error: REFUSED, code: "SEALED_MODE", phase: "refused" };
  const interrupted = { success: false, error: "x", code: "SEALED_MODE", phase: "interrupted" };
  assert.equal(urlDownloadErrorKey(refused), "sealedMode.blocked.generic");
  assert.equal(urlDownloadErrorKey(interrupted), "sealedMode.interrupted.generic");
  assert.equal(urlDownloadErrorKey({ code: "INVALID_URL" }), "urlInvalid");
  assert.equal(urlDownloadErrorKey({ code: "WHATEVER", error: "raw" }), undefined);
  // The queue shows a sealed key as itself, and other errors under notes.upload.*.
  assert.equal(queueErrorText("sealedMode.blocked.generic", t), "t:sealedMode.blocked.generic");
  assert.equal(
    queueErrorText("urlInvalid", t, { size: 25 }),
    't:notes.upload.urlInvalid{"defaultValue":"urlInvalid","size":25}'
  );
});

// Fix-wave round 2 (re-review N1 and its sweep): the exact texts main's
// refusals reach these surfaces with. The Codex model list gets the IPC
// wrapper's text; a local engine's test-load gets a result envelope; meeting
// and background-action toasts keep only the string.
test("sealedFailureMessage: Codex list, engine envelopes and bare strings from main", async () => {
  const { sealedFailureMessage, sealedGenericMessageKey } =
    await import("../../src/utils/sealedModeError.ts");
  const blocked = "t:sealedMode.blocked.generic";
  const codex =
    "Error invoking remote method 'personal-inference:codex-models': SealedModeError: [SEALED_MODE] Sealed mode blocked codex to chatgpt.com before any socket opened; nothing was sent.";
  assert.equal(sealedFailureMessage(new Error(codex), t), blocked);
  const engine =
    "[SEALED_MODE] Sealed mode blocked nativeLaunch to native-llama-server before any socket opened; nothing was sent.";
  assert.equal(sealedFailureMessage({ success: false, error: engine }, t), blocked);
  // A string a store kept (meeting and action toasts) is wrapped as { error }.
  assert.equal(sealedFailureMessage({ error: engine }, t), blocked);
  assert.equal(sealedFailureMessage({ error: INTERRUPTED }, t), "t:sealedMode.interrupted.generic");
  assert.equal(sealedGenericMessageKey(new Error(codex)), "sealedMode.blocked.generic");
  // Ordinary failures keep their own text.
  assert.equal(sealedFailureMessage({ error: "Model file is corrupt" }, t), null);
  assert.equal(sealedFailureMessage(new Error("socket hang up"), t), null);
});

// Fix-wave round 2, R2-m1: the two sites the first sweep missed. The cleanup
// step of a History translation retry rejects with an Error that carries main's
// text (ReasoningService.inferenceFailure adds no messageKey), and the custom
// endpoint's "List models" rejects with the IPC wrapper's text.
test("sealedFailureMessage: translation-chain cleanup errors and the custom endpoint model list", async () => {
  const { sealedFailureMessage } = await import("../../src/utils/sealedModeError.ts");
  const blocked = "t:sealedMode.blocked.generic";
  const interrupted = "t:sealedMode.interrupted.generic";
  // inferenceFailure: new Error(main's text), code only when main sent one.
  const cleanup = Object.assign(new Error(REFUSED), { code: undefined });
  assert.equal(sealedFailureMessage(cleanup, t), blocked);
  assert.equal(
    sealedFailureMessage(Object.assign(new Error("x"), { code: "SEALED_MODE" }), t),
    interrupted
  );
  const models =
    "Error invoking remote method 'personal-inference:models': SealedModeError: [SEALED_MODE:interrupted] Sealed mode stopped customEndpoint mid-transfer";
  assert.equal(sealedFailureMessage(new Error(models), t), interrupted);
  // An ordinary cleanup or listing failure keeps its own text.
  assert.equal(sealedFailureMessage(new Error("HTTP 401 Unauthorized"), t), null);
  assert.equal(sealedFailureMessage(Object.assign(new Error("boom"), { code: "x" }), t), null);
});

// Source ratchet beside the executed tests above: every I6 surface consults
// the helper (directly or through the two helpers built on it) before it
// would show main's text.
test("every I6 surface checks for a sealed failure before showing main's text", () => {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const sites = {
    "src/components/notes/UploadAudioView.tsx":
      /sealedFailureMessage\(fail, t\)[\s\S]*sealedFailureMessage\(e, t\)/,
    "src/stores/batchQueueStore.ts": /urlDownloadErrorKey\(fail\)[\s\S]*sealedErrorKey\(err\)/,
    "src/components/notes/BatchQueueView.tsx": /queueErrorText\(item\.error, t/,
    "src/hooks/useModelDownload.ts": /from "\.\.\/utils\/modelDownloadErrorMessage"/,
    "src/components/ReasoningModelSelector.tsx":
      /sealedFailureMessage\(result, t\)[\s\S]*sealedFailureMessage\(err, t\)/,
    "src/components/settings/LocalSupportModels.tsx": /sealedFailureMessage\(/,
    "src/components/TranscriptionModelPicker.tsx": /sealedFailureMessage\(/,
    "src/components/CodexConnection.tsx": /sealedFailureMessage\(/,
    // Fix-wave round 2: N1 and the raw-message sweep.
    "src/components/LocalModelPicker.tsx":
      /sealedFailureMessage\(result, t\)[\s\S]*sealedFailureMessage\(error, t\)[\s\S]*sealedFailureMessage\(result, t\)[\s\S]*sealedFailureMessage\(error, t\)/,
    "src/hooks/useTinfoilModels.ts": /sealedFailureMessage\(err, translate\)/,
    "src/components/chat/useVoiceDraft.ts":
      /sealedFailureMessage\(result, translate\)[\s\S]*sealedFailureMessage\(error, translate\)/,
    "src/components/ui/PromptStudio.tsx": /sealedFailureMessage\(error, t\)/,
    // R2-m1: the cleanup notice (:633) joins the failure and result sites.
    "src/components/ControlPanel.tsx":
      /sealedFailureMessage\(cleanupError, t\)[\s\S]*sealedFailureMessage\(failure, t\)[\s\S]*sealedFailureMessage\(result, t\)/,
    // TR-m1: the sealed test comes before the 401/403 mapping.
    "src/components/OpenAICompatiblePanel.tsx":
      /const sealedFailure = sealedFailureMessage\(error, t\);[\s\S]*const unauthorized = !sealedFailure && /,
    // TR-1: the live-dictation cleanup notice and its Retry alert.
    "src/components/voiceNotices.ts": /sealedFailureMessage\(failure, t\) \?\? failure\.message/,
    "src/helpers/retryDictationCleanup.js":
      /sealedFailureMessage\(error, t\) \?\? String\(error\?\.message \?\? error\)/,
    // Touch-up 3, TS2-1: every dictation card, whatever its code, checks the
    // marker in its text (the private take's refused FFmpeg merge).
    "src/utils/recordingErrors.ts":
      /isSealedModeError\(\{ message: error\.description \}\) \|\|\s*isSealedModeError\(\{ message: error\.message \}\)/,
    // Touch-up 3, O1: a sealed auto-paste is sealed copy by key, never main's text.
    "src/helpers/audioManager.js":
      /result\?\.code === "SEALED_MODE"[\s\S]*sealedPasteError\(result\.copiedToClipboard === true\)[\s\S]*isSealedModeError\(error\)[\s\S]*sealedPasteError\(false\)/,
    "src/components/settings/routing/usePatchbayBoard.ts": /sealedFailureMessage\(error, t\)/,
    "src/components/MeetingRecordingMount.tsx": /sealedFailureMessage\(\{ error \}, t\)/,
    "src/stores/meetingRecordingStore.ts":
      /meetingFailure\(startResult[\s\S]*meetingFailure\(result/,
    "src/stores/actionProcessingStore.ts": /sealedGenericMessageKey\(err\)/,
    "src/components/notes/BackgroundActionNoticeListener.tsx": /sealedFailureMessage\(/,
  };
  const reasoning = read("src/components/ReasoningModelSelector.tsx");
  // N1: the Codex "List models" alert.
  assert.match(
    reasoning,
    /setError\(sealedFailureMessage\(err, t\) \?\? \(err as Error\)\.message\)/
  );
  assert.doesNotMatch(reasoning, /setError\(\(err as Error\)\.message\)/);
  const upload = read("src/components/notes/UploadAudioView.tsx");
  assert.match(upload, /sealedFailureMessage\(res, t\)/);
  assert.match(upload, /sealedFailureMessage\(err, t\)/);
  assert.match(
    read("src/stores/batchQueueStore.ts"),
    /isSealedModeError\(transcriptionResult\)[\s\S]*transcriptionResult\.error \|\|/
  );
  // No swept surface puts a caught message on screen unchecked any more.
  for (const [file, raw] of [
    [
      "src/components/LocalModelPicker.tsx",
      /setOperationMessage\(error instanceof Error \? error\.message/,
    ],
    ["src/hooks/useTinfoilModels.ts", /setError\(\(err as Error\)\.message/],
    ["src/components/notes/UploadAudioView.tsx", /setError\(err instanceof Error \? err\.message/],
  ])
    assert.doesNotMatch(read(file), raw, file);
  for (const [file, pattern] of Object.entries(sites)) assert.match(read(file), pattern, file);
  // No surface shows a bare caught message any more.
  assert.doesNotMatch(
    read("src/components/CodexConnection.tsx"),
    /setError\(\(error as Error\)\.message\)/
  );
  assert.doesNotMatch(
    read("src/components/settings/LocalSupportModels.tsx"),
    /error: String\(error\)/
  );
  assert.doesNotMatch(read("src/hooks/useModelDownload.ts"), /function getDownloadErrorMessage/);
  // The GPU pack download now says why it failed.
  const picker = read("src/components/TranscriptionModelPicker.tsx");
  assert.match(picker, /setGpuError\(/);
  assert.match(picker, /role="alert"[^>]*>\s*\{gpuError\}/);
});
