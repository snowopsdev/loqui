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
  };
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
