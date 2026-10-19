const test = require("node:test");
const assert = require("node:assert/strict");
const input = { messages: [{ role: "user", content: "fixture words" }], wordCount: 2 };
test("typed preview boundary retains original descriptor/request, refuses mutation/duplicates/stale completion, and resets", async () => {
  const { createCapturedTextBridge } = await import("../../src/preview/capturedTextBridge.ts");
  let release;
  const calls = [];
  let slow = false;
  const api = createCapturedTextBridge(async (descriptor, sentence) => {
    calls.push({ descriptor, sentence });
    if (slow)
      await new Promise((resolve) => {
        release = resolve;
      });
    return "Fixture.";
  });
  const descriptor = {
    provider: "custom",
    model: "a",
    baseUrl: "https://fixture.invalid/a",
    inferenceScope: "dictationCleanup",
  };
  const token = await api.captureTextOperation(descriptor);
  descriptor.model = "b";
  assert.deepEqual(await api.runTextOperation({ token, request: input }), { text: "Fixture." });
  assert.deepEqual(await api.runTextOperation({ token, request: input }), { text: "Fixture." });
  assert.equal(calls[1].descriptor.model, "a");
  assert.equal(calls[0].sentence, calls[1].sentence);
  await assert.rejects(api.runTextOperation({ token, request: { ...input, wordCount: 3 } }), {
    code: "CLEANUP_REQUEST_CHANGED",
  });
  slow = true;
  const pending = api.runTextOperation({ token, request: input });
  await assert.rejects(api.runTextOperation({ token, request: input }), {
    code: "CLEANUP_OPERATION_BUSY",
  });
  await api.retireTextOperation(token);
  release();
  await assert.rejects(pending, { code: "CLEANUP_OPERATION_UNAVAILABLE" });
  const next = await api.captureTextOperation(descriptor);
  api.reset();
  await assert.rejects(api.runTextOperation({ token: next, request: input }), {
    code: "CLEANUP_OPERATION_UNAVAILABLE",
  });
});
test("preview local captured operation uses admitted model/options and never accepts its token as remote inference", async () => {
  const { createCapturedTextBridge } = await import("../../src/preview/capturedTextBridge.ts");
  const calls = [];
  const api = createCapturedTextBridge(async (descriptor, text) => {
    calls.push({ descriptor, text });
    return "Local.";
  });
  const token = await api.captureTextOperation({
    provider: "local",
    model: "local-a",
    systemPrompt: "captured prompt",
    inferenceScope: "dictationCleanup",
  });
  await assert.rejects(api.runTextOperation({ token, request: input }), {
    code: "CLEANUP_OPERATION_UNAVAILABLE",
  });
  assert.deepEqual(
    await api.processLocalReasoning("fixture words", "changed-model-b", null, {
      textOperationToken: token,
      wordCount: 2,
    }),
    { success: true, text: "Local." }
  );
  assert.equal(calls[0].descriptor.model, "local-a");
  assert.equal(calls[0].descriptor.systemPrompt, "captured prompt");
});

test("fake captured boundary mirrors actual unsupported Codex/Tinfoil sources before text dispatch", async () => {
  const { createCapturedTextBridge } = await import("../../src/preview/capturedTextBridge.ts");
  let calls = 0;
  const api = createCapturedTextBridge(async () => {
    calls++;
    return "unexpected";
  });
  for (const provider of ["codex", "tinfoil"])
    await assert.rejects(
      api.captureTextOperation({ provider, model: "fixture", inferenceScope: "dictationCleanup" }),
      { code: "UNSUPPORTED_AUTH_SOURCE" }
    );
  assert.equal(calls, 0);
});
