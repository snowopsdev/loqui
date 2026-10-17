// test/utils/onboardingDemo.test.js
const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/utils/onboardingDemo.ts");

test("success events carry the raw text and what cleanup did", async () => {
  const { buildDemoSuccessEvent } = await load();
  assert.deepEqual(
    buildDemoSuccessEvent("dictation", { text: "Remind me.", rawText: "um remind me" }),
    {
      kind: "dictation",
      status: "success",
      text: "Remind me.",
      rawText: "um remind me",
      cleanup: "applied",
    }
  );
  assert.equal(
    buildDemoSuccessEvent("dictation", { text: "hi", rawText: "hi" }).cleanup,
    "skipped"
  );
  assert.equal(
    buildDemoSuccessEvent("dictation", {
      text: "um hi",
      rawText: "um hi",
      cleanupFailure: { code: "TIMEOUT" },
    }).cleanup,
    "failed"
  );
  assert.equal(buildDemoSuccessEvent("dictation", { text: "hi" }).rawText, undefined);
});

test("error codes come from the error object, never from its message", async () => {
  const { demoErrorCode } = await load();
  assert.equal(demoErrorCode({ code: "NO_AUDIO" }), "NO_AUDIO");
  assert.equal(
    demoErrorCode({ name: "NotAllowedError", message: "Permission denied" }),
    "NotAllowedError"
  );
  assert.equal(demoErrorCode(new Error("boom")), undefined);
  assert.equal(demoErrorCode(null), undefined);
});
